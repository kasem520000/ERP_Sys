import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import * as wms from "../infrastructure/wms-store";
import {
  AisleNotFoundError,
  BinBarcodeExistsError,
  BinCodeExistsError,
  BinContentNotFoundError,
  BinContentStateError,
  BinNotFoundError,
  LpnCodeExistsError,
  LpnClosedError,
  LpnNotFoundError,
  RackNotFoundError,
  UomConversionMissingError,
  ZoneCodeExistsError,
  ZoneNotFoundError,
} from "../domain/inventory-errors";

/**
 * WMS service (PHASE-044 T-03; §2.1/§2.2/§2.5/§2.8/§2.12): the location
 * tree (zones/aisles/racks/bins with scan barcodes), the bin-contents
 * board with its status transitions (AVAILABLE ↔ QUARANTINE/HOLD — the
 * T-08 quarantine board builds its dispositions on this substrate), LPN
 * handling, the serial-movement ledger read surface, the I-15 UOM
 * conversion math, and the nightly INV-029 reconciliation probe.
 *
 * The VALUATION writes never happen here: every qty-changing economic
 * move flows through the movement core (planReceipt/planIssue), whose
 * apply steps write bin_contents in the SAME transaction as item_stock
 * (INV-029's same-transaction law). This service owns the STRUCTURAL
 * moves — status transitions, LPN moves — which never touch item_stock
 * (the qty never changes warehouse or item; only the slot moves).
 *
 * The reconciliation probe is the nightly detector: per ACTIVE tenant it
 * folds Σ tenant-owned bin_contents vs item_stock per (warehouse, item)
 * and surfaces every mismatch as a critical `stock` notification in the
 * owner's inbox + a SYSTEM audit row. The BLOCKING side of INV-029 is
 * the movement core's BinContentsShortError — this job reports what
 * already drifted (backfill residue, manual SQL, or a bug), never
 * silently repairs it.
 */
const BIN_STATUS = new Set(["AVAILABLE", "QUARANTINE", "HOLD"]);
const ZONE_TYPES = new Set(["PICKING", "BULK", "QUARANTINE", "DOCK", "STAGE"]);

@Injectable()
export class WmsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  // -- the location tree (§2.1) -------------------------------------------------------

  async listZones(filter: { warehouseId?: string; limit?: number }) {
    return wms.listZones({ warehouseId: filter.warehouseId, limit: filter.limit ?? 200 });
  }

  async createZone(input: {
    warehouseId: string;
    code: string;
    name: string;
    nameAr: string | null;
    zoneType: string;
    isDefault: boolean;
    note: string | null;
    actorId: string | null;
  }) {
    if (!ZONE_TYPES.has(input.zoneType)) {
      throw new BinContentStateError(`zone type must be one of PICKING/BULK/QUARANTINE/DOCK/STAGE: ${input.zoneType}`);
    }
    const zones = await wms.listZones({ warehouseId: input.warehouseId, limit: 500 });
    if (zones.some((z) => z.code === input.code)) {
      throw new ZoneCodeExistsError(input.code);
    }
    if (input.isDefault && zones.some((z) => z.isDefault)) {
      throw new BinContentStateError(
        `warehouse ${input.warehouseId} already has a default zone — unset it first (one default per warehouse)`,
      );
    }
    const zone = await wms.insertZone({
      warehouseId: input.warehouseId,
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      zoneType: input.zoneType,
      isDefault: input.isDefault,
      note: input.note,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.wms_zone_created",
      entityType: "warehouse_zone",
      entityId: zone.id,
      actorId: input.actorId ?? undefined,
      after: { code: zone.code, warehouseId: zone.warehouseId, zoneType: zone.zoneType },
    });
    return zone;
  }

  async updateZone(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      zoneType?: string;
      isDefault?: boolean;
      note?: string | null;
    },
    actorId: string | null,
  ) {
    const zone = await wms.findZoneById(id);
    if (zone === undefined) throw new ZoneNotFoundError(id);
    if (patch.zoneType !== undefined && !ZONE_TYPES.has(patch.zoneType)) {
      throw new BinContentStateError(`zone type must be one of PICKING/BULK/QUARANTINE/DOCK/STAGE: ${patch.zoneType}`);
    }
    if (patch.isDefault === true && !zone.isDefault) {
      const siblings = await wms.listZones({ warehouseId: zone.warehouseId, limit: 500 });
      if (siblings.some((z) => z.isDefault)) {
        throw new BinContentStateError(
          `warehouse ${zone.warehouseId} already has a default zone — unset it first`,
        );
      }
    }
    await wms.updateZone(id, patch);
    await this.audit.record({
      action: "inventory.wms_zone_updated",
      entityType: "warehouse_zone",
      entityId: id,
      actorId: actorId ?? undefined,
      after: patch,
    });
    return wms.findZoneById(id);
  }

  async listAisles(zoneId: string) {
    if ((await wms.findZoneById(zoneId)) === undefined) throw new ZoneNotFoundError(zoneId);
    return wms.listAisles(zoneId);
  }

  async createAisle(input: {
    zoneId: string;
    code: string;
    name: string;
    nameAr: string | null;
    actorId: string | null;
  }) {
    if ((await wms.findZoneById(input.zoneId)) === undefined) throw new ZoneNotFoundError(input.zoneId);
    const existing = await wms.listAisles(input.zoneId);
    if (existing.some((a) => a.code === input.code)) {
      throw new ZoneCodeExistsError(input.code);
    }
    const aisle = await wms.insertAisle({
      zoneId: input.zoneId,
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.wms_aisle_created",
      entityType: "warehouse_aisle",
      entityId: aisle.id,
      actorId: input.actorId ?? undefined,
      after: { code: aisle.code, zoneId: aisle.zoneId },
    });
    return aisle;
  }

  async listRacks(aisleId: string) {
    if ((await wms.findAisleById(aisleId)) === undefined) throw new AisleNotFoundError(aisleId);
    return wms.listRacks(aisleId);
  }

  async createRack(input: {
    aisleId: string;
    code: string;
    name: string;
    nameAr: string | null;
    actorId: string | null;
  }) {
    if ((await wms.findAisleById(input.aisleId)) === undefined) throw new AisleNotFoundError(input.aisleId);
    const existing = await wms.listRacks(input.aisleId);
    if (existing.some((r) => r.code === input.code)) {
      throw new ZoneCodeExistsError(input.code);
    }
    const rack = await wms.insertRack({
      aisleId: input.aisleId,
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.wms_rack_created",
      entityType: "warehouse_rack",
      entityId: rack.id,
      actorId: input.actorId ?? undefined,
      after: { code: rack.code, aisleId: rack.aisleId },
    });
    return rack;
  }

  async listBins(filter: { warehouseId?: string; zoneId?: string; limit?: number }) {
    return wms.listBins({
      warehouseId: filter.warehouseId,
      zoneId: filter.zoneId,
      limit: filter.limit ?? 500,
    });
  }

  async findBin(id: string) {
    const bin = await wms.findBinById(id);
    if (bin === undefined) throw new BinNotFoundError(id);
    return bin;
  }

  async findBinByBarcode(barcode: string) {
    const bin = await wms.findBinByBarcode(barcode);
    if (bin === undefined) throw new BinNotFoundError(barcode);
    return bin;
  }

  async createBin(input: {
    warehouseId: string;
    rackId: string;
    code: string;
    barcode: string;
    name: string;
    nameAr: string | null;
    pickSequence: number | null;
    capacity: string | null;
    allowMixedBatches: boolean;
    isDefault: boolean;
    note: string | null;
    actorId: string | null;
  }) {
    if ((await wms.findRackById(input.rackId)) === undefined) throw new RackNotFoundError(input.rackId);
    const bins = await wms.listBins({ warehouseId: input.warehouseId, limit: 1000 });
    if (bins.some((b) => b.code === input.code)) {
      throw new BinCodeExistsError(input.code);
    }
    if (bins.some((b) => b.barcode === input.barcode)) {
      throw new BinBarcodeExistsError(input.barcode);
    }
    if (input.isDefault && bins.some((b) => b.isDefault)) {
      throw new BinContentStateError(
        `warehouse ${input.warehouseId} already has a default bin — unset it first (BR-073's one-default floor)`,
      );
    }
    const bin = await wms.insertBin({
      warehouseId: input.warehouseId,
      rackId: input.rackId,
      code: input.code,
      barcode: input.barcode,
      name: input.name,
      nameAr: input.nameAr,
      pickSequence: input.pickSequence,
      capacity: input.capacity,
      allowMixedBatches: input.allowMixedBatches,
      isDefault: input.isDefault,
      note: input.note,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.wms_bin_created",
      entityType: "warehouse_bin",
      entityId: bin.id,
      actorId: input.actorId ?? undefined,
      after: { code: bin.code, barcode: bin.barcode, warehouseId: bin.warehouseId },
    });
    return bin;
  }

  async updateBin(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      pickSequence?: number | null;
      capacity?: string | null;
      allowMixedBatches?: boolean;
      note?: string | null;
    },
    actorId: string | null,
  ) {
    await this.findBin(id);
    await wms.updateBin(id, patch);
    await this.audit.record({
      action: "inventory.wms_bin_updated",
      entityType: "warehouse_bin",
      entityId: id,
      actorId: actorId ?? undefined,
      after: patch,
    });
    return wms.findBinById(id);
  }

  /** The T-14 tree shape: zones → aisles → racks → bins in one read. */
  async locationTree(warehouseId: string) {
    const zones = await wms.listZones({ warehouseId, limit: 200 });
    const bins = await wms.listBins({ warehouseId, limit: 1000 });
    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const binsByRack = new Map<string, wms.BinRow[]>();
    for (const bin of bins) {
      const list = binsByRack.get(bin.rackId) ?? [];
      list.push(bin);
      binsByRack.set(bin.rackId, list);
    }
    const tree: {
      id: string;
      code: string;
      name: string;
      zoneType: string;
      isDefault: boolean;
      aisles: {
        id: string;
        code: string;
        name: string;
        racks: { id: string; code: string; name: string; bins: wms.BinRow[] }[];
      }[];
    }[] = [];
    for (const zone of zones) {
      const aisles = await wms.listAisles(zone.id);
      const aisleNodes = [];
      for (const aisle of aisles) {
        const racks = await wms.listRacks(aisle.id);
        aisleNodes.push({
          id: aisle.id,
          code: aisle.code,
          name: aisle.name,
          racks: racks.map((rack) => ({
            id: rack.id,
            code: rack.code,
            name: rack.name,
            bins: binsByRack.get(rack.id) ?? [],
          })),
        });
      }
      tree.push({
        id: zone.id,
        code: zone.code,
        name: zone.name,
        zoneType: zone.zoneType,
        isDefault: zone.isDefault,
        aisles: aisleNodes,
      });
    }
    return { zones: tree, zoneById: [...zoneById.keys()] };
  }

  // -- bin contents (§2.2) --------------------------------------------------------

  async listBinContents(filter: {
    binId?: string;
    warehouseId?: string;
    itemId?: string;
    status?: string;
    ownerPartnerId?: string | null;
    lpnId?: string;
    limit?: number;
  }) {
    return wms.listBinContents({
      binId: filter.binId,
      warehouseId: filter.warehouseId,
      itemId: filter.itemId,
      status: filter.status,
      ownerPartnerId: filter.ownerPartnerId,
      lpnId: filter.lpnId,
      limit: filter.limit ?? 500,
    });
  }

  /** T-06 (§2.5): the LPN-bound contents view — every live row riding the
   * plate (the pallet manifest), newest receipts first. */
  async lpnContents(lpnId: string) {
    const lpn = await wms.findLpnById(lpnId);
    if (lpn === undefined) throw new LpnNotFoundError(lpnId);
    const rows = await wms.listBinContents({ lpnId, limit: 500 });
    return { lpn, contents: rows.filter((row) => Number(row.qty) > 0) };
  }

  /** Bin-level ATP (AVAILABLE, tenant-owned rows only — BR-076's exclusion). */
  async availableQtyByBin(warehouseId: string, itemId: string) {
    return wms.availableQtyByBin({ warehouseId, itemId });
  }

  /**
   * Status transition (§2.8): AVAILABLE ↔ QUARANTINE/HOLD over ONE
   * bin_contents row — a structural slot move (same bin, new status);
   * item_stock NEVER moves (the qty did not economically change — INV-029
   * folds ALL statuses). A serialized row appends its QUARANTINE/RELEASE
   * ledger event. The T-08 board owns the approval + disposition flows on
   * top of this primitive.
   */
  async transitionStatus(
    contentId: string,
    toStatus: string,
    input: { note: string | null; actorId: string | null },
  ) {
    if (!BIN_STATUS.has(toStatus)) {
      throw new BinContentStateError(`status must be AVAILABLE/QUARANTINE/HOLD: ${toStatus}`);
    }
    const row = await wms.findBinContentById(contentId);
    if (row === undefined) throw new BinContentNotFoundError(contentId);
    if (row.status === toStatus) {
      throw new BinContentStateError(`bin_contents ${contentId} is already ${toStatus}`);
    }
    if (row.ownerPartnerId !== null) {
      throw new BinContentStateError(
        `consignment rows (owner set) transition through the consignment service (BR-076)`,
      );
    }
    const targetContentId = await wms.moveBetweenSlots({
      fromContentId: contentId,
      qty: row.qty,
      toBinId: row.binId,
      toStatus,
      note: input.note,
    });
    if (row.serialId !== null) {
      await wms.appendSerialMovement({
        serialId: row.serialId,
        event: toStatus === "AVAILABLE" ? "RELEASE" : "QUARANTINE",
        moveId: null,
        sourceType: "bin_status_transition",
        sourceId: contentId,
        fromBinId: row.binId,
        toBinId: row.binId,
        movedAt: new Date().toISOString(),
        note: input.note,
        createdBy: input.actorId,
      });
    }
    await this.audit.record({
      action: "inventory.wms_bin_status_transitioned",
      entityType: "bin_content",
      entityId: contentId,
      actorId: input.actorId ?? undefined,
      after: { from: row.status, to: toStatus, qty: row.qty, itemId: row.itemId },
    });
    return wms.findBinContentById(targetContentId);
  }

  // -- LPNs (§2.5) -----------------------------------------------------------------

  async listLpns(filter: { status?: string; limit?: number }) {
    return wms.listLpns({ status: filter.status, limit: filter.limit ?? 100 });
  }

  async createLpn(input: { lpnCode: string; note: string | null; actorId: string | null }) {
    if ((await wms.findLpnByCode(input.lpnCode)) !== undefined) {
      throw new LpnCodeExistsError(input.lpnCode);
    }
    const lpn = await wms.insertLpn({
      lpnCode: input.lpnCode,
      note: input.note,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.wms_lpn_created",
      entityType: "lpn",
      entityId: lpn.id,
      actorId: input.actorId ?? undefined,
      after: { lpnCode: lpn.lpnCode },
    });
    return lpn;
  }

  async closeLpn(id: string, actorId: string | null) {
    const lpn = await wms.findLpnById(id);
    if (lpn === undefined) throw new LpnNotFoundError(id);
    await wms.closeLpn(id);
    await this.audit.record({
      action: "inventory.wms_lpn_closed",
      entityType: "lpn",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return wms.findLpnById(id);
  }

  /** Bind a bin_contents row to an ACTIVE LPN (the move-by-LPN substrate). */
  async bindContentToLpn(contentId: string, lpnId: string, actorId: string | null) {
    const row = await wms.findBinContentById(contentId);
    if (row === undefined) throw new BinContentNotFoundError(contentId);
    const lpn = await wms.findLpnById(lpnId);
    if (lpn === undefined) throw new LpnNotFoundError(lpnId);
    if (lpn.status !== "ACTIVE") {
      throw new LpnClosedError(lpnId);
    }
    await wms.bindContentToLpn(contentId, lpnId);
    await this.audit.record({
      action: "inventory.wms_lpn_bound",
      entityType: "bin_content",
      entityId: contentId,
      actorId: actorId ?? undefined,
      after: { lpnId, qty: row.qty },
    });
    return wms.findBinContentById(contentId);
  }

  /**
   * Move-by-LPN (§2.5, T-06): every qty>0 row of the LPN moves into the
   * target bin KEEPING ITS OWN STATUS (a QUARANTINE pallet stays
   * quarantined at the new slot) — the structural move; item_stock never
   * moves. A CLOSED plate never moves again (LpnClosedError).
   */
  async moveLpn(input: { lpnId: string; toBinId: string; note: string | null; actorId: string | null }) {
    const lpn = await wms.findLpnById(input.lpnId);
    if (lpn === undefined) throw new LpnNotFoundError(input.lpnId);
    if (lpn.status !== "ACTIVE") {
      throw new LpnClosedError(input.lpnId);
    }
    const bin = await wms.findBinById(input.toBinId);
    if (bin === undefined) throw new BinNotFoundError(input.toBinId);
    const moved = await wms.moveLpnContents({
      lpnId: input.lpnId,
      toBinId: input.toBinId,
      note: input.note,
    });
    await this.audit.record({
      action: "inventory.wms_lpn_moved",
      entityType: "lpn",
      entityId: input.lpnId,
      actorId: input.actorId ?? undefined,
      after: { toBinId: input.toBinId, rows: moved },
    });
    return { movedRows: moved };
  }

  // -- the serial ledger (§2.12) ----------------------------------------------------

  async listSerialMovements(filter: { serialId?: string; itemId?: string; limit?: number }) {
    return wms.listSerialMovements({
      serialId: filter.serialId,
      itemId: filter.itemId,
      limit: filter.limit ?? 200,
    });
  }

  // -- UOM conversion (I-15) ----------------------------------------------------------

  /**
   * The I-15 conversion math: exact Decimal factors (the direct row, the
   * mirrored 1/factor, or the typed UomConversionMissingError). Every
   * bin-move surface (putaway scan, pick confirmation, count entry) that
   * expresses a qty in a non-stock UOM converts through HERE — one law,
   * one rounding point (6dp half-up, ADR-0009).
   */
  async convertQty(fromUomId: string, toUomId: string, qty: string): Promise<string> {
    const conversion = await wms.findUomConversion(fromUomId, toUomId);
    if (conversion === null) {
      throw new UomConversionMissingError(fromUomId, toUomId);
    }
    const factor = conversion.reverse
      ? new Decimal(1).div(new Decimal(conversion.factor))
      : new Decimal(conversion.factor);
    return new Decimal(qty).times(factor).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
  }

  // -- the INV-029 reconciliation probe (§2.2) -----------------------------------------

  /** The report surface: every (warehouse, item) fold where bins ≠ stock. */
  async reconcile(filter: { warehouseId?: string }) {
    return wms.reconcileBins({ warehouseId: filter.warehouseId });
  }

  /**
   * The nightly system pass (pg-boss `inventory.bin-reconcile`): every
   * ACTIVE tenant gets its probe; a non-empty result is ONE critical
   * `stock` notification in the owner's inbox + a SYSTEM audit row. The
   * job NEVER repairs (blocking is the movement core's job — this is the
   * detector). Returns the aggregate counts for the worker log.
   */
  async reconcileAllTenants(): Promise<{ tenants: number; mismatchedTenants: number; mismatches: number }> {
    const tenantIds = await listActiveTenantIds();
    let mismatchedTenants = 0;
    let mismatches = 0;
    for (const tenantId of tenantIds) {
      // One UoW per tenant (ADR-0005) — a failure in one tenant never
      // blocks the rest of the nightly pass.
      const result = await withTenant(tenantId, async () => {
        const rows = await wms.reconcileBins({});
        if (rows.length === 0) return { notified: false, count: 0 };
        mismatches += rows.length;
        const target = await this.inbox.ownerTarget();
        if (target !== null) {
          const prefs = await this.inbox.prefsFor(target.userId, "stock");
          if (prefs.inApp) {
            const named = rows
              .slice(0, 5)
              .map((row) => `${row.itemSku ?? row.itemId} @ ${row.warehouseCode ?? row.warehouseId}: bins ${row.binQty} vs stock ${row.stockQty}`)
              .join("؛ ");
            await this.inbox.record({
              category: "stock",
              severity: "critical",
              title: {
                ar: `انحراف محتويات الصناديق عن الدفتر (${rows.length})`,
                en: `${rows.length} bin-content reconciliation mismatch(es)`,
              },
              body: {
                ar:
                  `Σ محتويات الصناديق لا يساوي رصيد الصنف في ${rows.length} حالة (INV-029)` +
                  (named === "" ? "" : `: ${named}`) +
                  ". راجع تقرير المطابقة — لا يتم أي تصحيح تلقائي.",
                en:
                  `Σ bin contents ≠ item stock in ${rows.length} case(s) (INV-029)` +
                  (named === "" ? "" : `: ${named}`) +
                  ". Review the reconciliation report — nothing is auto-repaired.",
              },
              actionLabel: { ar: "فتح تقرير المطابقة", en: "Open the reconciliation report" },
              actionUrl: "/inventory/locations",
              dedupeKey: `stock.bin_reconcile:${new Date().toISOString().slice(0, 10)}`,
              userId: target.userId,
            });
          }
        }
        await this.audit.record({
          action: "inventory.wms_bin_reconcile_mismatch",
          entityType: "bin_contents",
          entityId: tenantId,
          after: { mismatches: rows.length, sample: rows.slice(0, 5) },
        });
        return { notified: true, count: rows.length };
      });
      if (result.count > 0) mismatchedTenants += 1;
    }
    return { tenants: tenantIds.length, mismatchedTenants, mismatches };
  }
}
