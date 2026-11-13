import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import * as wms from "../infrastructure/wms-store";
import * as stockStore from "../infrastructure/inventory.store";
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
      throw new BinContentStateError(
        `zone type must be one of PICKING/BULK/QUARANTINE/DOCK/STAGE: ${input.zoneType}`,
      );
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
      throw new BinContentStateError(
        `zone type must be one of PICKING/BULK/QUARANTINE/DOCK/STAGE: ${patch.zoneType}`,
      );
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
    if ((await wms.findZoneById(input.zoneId)) === undefined)
      throw new ZoneNotFoundError(input.zoneId);
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
    if ((await wms.findAisleById(input.aisleId)) === undefined)
      throw new AisleNotFoundError(input.aisleId);
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
    if ((await wms.findRackById(input.rackId)) === undefined)
      throw new RackNotFoundError(input.rackId);
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
  async moveLpn(input: {
    lpnId: string;
    toBinId: string;
    note: string | null;
    actorId: string | null;
  }) {
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
  async reconcileAllTenants(): Promise<{
    tenants: number;
    mismatchedTenants: number;
    mismatches: number;
  }> {
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
              .map(
                (row) =>
                  `${row.itemSku ?? row.itemId} @ ${row.warehouseCode ?? row.warehouseId}: bins ${row.binQty} vs stock ${row.stockQty}`,
              )
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

  /** The per-(warehouse, item) classification of one shortfall row: what
   * the evidence PROVES, what may be written, and what stays unwritten
   * with a named reason (the post-closure audit fix — never a blind
   * NULL-dimension row on a tracked item, never an invented balance).
   * WAVE-3: a named source conflict (a batch whose bins exceed its ledger,
   * a conflicting serial) additionally FORBIDS the totals-matching
   * WRITABLE — writing the proven parts would equal the aggregate and hide
   * the conflict from the nightly probe (the only recurring detector), so
   * the whole position stays unwritten and visible. */
  private async classifyShortfall(row: wms.BinBackfillRow): Promise<BackfillPlanRow> {
    const base = {
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouseCode,
      itemId: row.itemId,
      itemSku: row.itemSku,
      binQty: row.binQty,
      stockQty: row.stockQty,
      shortfall: row.shortfall,
    };
    const tracking = await wms.findItemTracking(row.itemId);
    if (tracking === undefined) {
      return {
        ...base,
        tracking: "NONE" as const,
        classification: "NON_RECONCILABLE" as const,
        writes: [],
        residueQty: row.shortfall,
        notes: ["item row not found — nothing written"],
      };
    }
    const total = new Decimal(row.shortfall);
    if (!tracking.trackBatch && !tracking.trackSerial) {
      return {
        ...base,
        tracking: "NONE" as const,
        classification: "WRITABLE" as const,
        writes: [
          { batchId: null, serialId: null, batchNo: null, serialNo: null, qty: row.shortfall },
        ],
        residueQty: "0.000000",
        notes: [],
      };
    }
    if (tracking.trackSerial) {
      // Serialized: one provable bin row (qty 1) per serial whose ledger
      // position is EXACTLY +1 at THIS warehouse and EXACTLY +1 across all
      // warehouses (a single physical unit cannot be netted twice here nor
      // simultaneously owed to another warehouse — anything else is a
      // CONFLICT, never a "provable" placement), whose registry status is
      // in_stock, and which no tenant-owned bin row already places.
      const serials = await wms.listSerialDistribution(row.warehouseId, row.itemId);
      const provable: { serialId: string; serialNo: string }[] = [];
      const notes: string[] = [];
      for (const s of serials) {
        const netHere = new Decimal(s.netAtWarehouse);
        const netAll = new Decimal(s.netTotal);
        const binnedHere = new Decimal(s.binnedHereQty);
        const binnedElsewhere = new Decimal(s.binnedElsewhereQty);
        // Placement precedence (never duplicate, never hide a conflict):
        // a POSITIVE bin row already places the single unit — the serial is
        // never written again (an over-placed shape — >1 here, or also
        // elsewhere — is a NAMED conflict, not a silent skip). A ZERO-qty
        // history row places NOTHING (the honest history floor): such a
        // serial stays a migration candidate and the upsert below lands its
        // unit on the existing slot without duplicating the fold. WAVE-4: a
        // single-unit placement the LEDGER does not corroborate (the ledger
        // netting anything other than exactly 1 here, or anything other
        // than 1 across all warehouses — e.g. a bin row for a serial with
        // ZERO ledger legs, the bins-without-ledger batch's exact serial
        // analogue) is a NAMED conflict too — pre-fix it was silently
        // accepted as "already placed", so a provable sibling's placement
        // landed the aggregate exactly on item_stock and hid it from the
        // nightly probe.
        if (binnedHere.greaterThan(0)) {
          if (binnedHere.greaterThan(1) || binnedElsewhere.greaterThan(0)) {
            notes.push(
              `serial ${s.serialNo}: bin rows place ${s.binnedHereQty} unit(s) here` +
                (binnedElsewhere.greaterThan(0)
                  ? ` and ${s.binnedElsewhereQty} at other warehouse(s)`
                  : "") +
                " — a single-unit serial cannot sit in multiple slots, placement over-subscribed",
            );
          } else if (!netHere.equals(1) || !netAll.equals(1)) {
            notes.push(
              `serial ${s.serialNo}: bin rows place ${s.binnedHereQty} unit(s) here but the ledger nets ${s.netAtWarehouse} here (${s.netTotal} across all warehouses) — the sources disagree (a placement the ledger does not corroborate; resolve through a documented adjustment, runbook §5)`,
            );
          }
          continue;
        }
        if (binnedElsewhere.greaterThan(0)) {
          notes.push(
            `serial ${s.serialNo}: bin rows place ${s.binnedElsewhereQty} unit(s) at another warehouse while its ledger nets ${s.netAtWarehouse} here — the sources disagree`,
          );
          continue;
        }
        if (netAll.greaterThan(1)) {
          notes.push(
            `serial ${s.serialNo}: ledger net ${s.netTotal} across warehouses — duplicated legs, placement ambiguous`,
          );
          continue;
        }
        if (netHere.greaterThan(1)) {
          notes.push(
            `serial ${s.serialNo}: ledger nets ${s.netAtWarehouse} at this warehouse (global net ${s.netTotal}) — a single-unit serial counted more than once here, conflicting distribution`,
          );
          continue;
        }
        if (!netHere.equals(1)) continue; // not provably at this warehouse
        if (!netAll.equals(1)) {
          notes.push(
            `serial ${s.serialNo}: ledger nets ${s.netTotal} across ALL warehouses while this warehouse nets 1 — legs elsewhere contradict a unit here, conflicting distribution`,
          );
          continue;
        }
        if (s.registryStatus !== "in_stock") {
          notes.push(
            `serial ${s.serialNo}: ledger says in stock but registry status is ${s.registryStatus} — conflicting sources`,
          );
          continue;
        }
        provable.push({ serialId: s.serialId, serialNo: s.serialNo });
      }
      if (provable.length > Number(total)) {
        return {
          ...base,
          tracking: "SERIAL" as const,
          classification: "NON_RECONCILABLE" as const,
          writes: [],
          residueQty: row.shortfall,
          notes: [
            `ledger proves ${provable.length} in-stock serial(s) at this warehouse but item_stock shortfall is only ${row.shortfall} — the sources disagree, nothing written`,
            ...notes.slice(0, 5),
          ],
        };
      }
      const residue = total.minus(provable.length);
      // WAVE-3 — the same totals-matching guard for serialized positions:
      // a NAMED serial conflict (an over-placed serial, a cross-warehouse
      // contradiction, a registry mismatch) with a zero residue would be
      // HIDDEN by placing the provable units — Σ bins would land exactly on
      // item_stock and the nightly probe would go green while the
      // conflicting serial's drift stayed invisible (the batch-path
      // hiding's exact analogue). Nothing is written; the full shortfall
      // stays visible to the probe; the notes already name the conflicts.
      // A residue > 0 keeps the probe visible anyway — its provable writes
      // stay legitimate (PARTIAL_UNATTRIBUTED, the tested TBF-S-0004
      // shape).
      if (residue.isZero() && notes.length > 0) {
        return {
          ...base,
          tracking: "SERIAL" as const,
          classification: "NON_RECONCILABLE" as const,
          writes: [],
          residueQty: row.shortfall,
          notes: [
            `the provable in-stock serials (${provable.length}) exactly cover the item_stock shortfall ${row.shortfall}, but the sources disagree elsewhere at this position — placing the provable units would make Σ bins == item_stock and HIDE the named conflict(s) from the nightly probe; nothing written, the position stays whole to the probe (resolve per runbook §5)`,
            ...notes.slice(0, 5),
          ],
        };
      }
      return {
        ...base,
        tracking: "SERIAL" as const,
        classification: residue.isZero()
          ? ("WRITABLE" as const)
          : ("PARTIAL_UNATTRIBUTED" as const),
        writes: provable.map((s) => ({
          batchId: null,
          serialId: s.serialId,
          batchNo: null,
          serialNo: s.serialNo,
          qty: "1.000000",
        })),
        residueQty: residue.toFixed(6),
        notes: residue.isZero()
          ? notes.slice(0, 5)
          : [
              `${residue.toFixed(6)} unit(s) of item_stock have no provable in-stock serial at this warehouse — left unwritten and left visible to the nightly probe. NOTE (test-proven consequence): landing the proven rows ENDS the binless grace for this (warehouse, item) — the unproven units become BLOCKED at the bin gate (BinContentsShortError) until resolved through a documented adjustment (runbook §5); a phantom unit is never sellable through the named-unit path again`,
              ...notes.slice(0, 5),
            ],
      };
    }
    // Batch-tracked: one row per batch whose warehouse ledger balance
    // exceeds its tenant bin qty (ACTIVE batches only — a WRITTEN_OFF batch
    // with a positive balance is itself an anomaly, never a pickable row).
    // WAVE-3 (the batch-conflict hiding fix): a batch whose BINS EXCEED ITS
    // LEDGER at this warehouse is a NAMED per-batch source conflict — the
    // clamped shortfall (GREATEST(ledger − bins, 0)) keeps the write plan
    // honest, but the conflict is never again a silent clamp-to-zero skip,
    // and it can never hide behind a totals-matching WRITABLE (the guard
    // below). WAVE-4 (the union population): the comparison spans the
    // batches present in the LEDGER or the BOXES, so the wave-3 §5
    // limitation's hiding shape — a batch whose bins hold stock with ZERO
    // ledger legs at this warehouse (invisible to the ledger-driven
    // population while its bins still count toward Σ bins and the probe) —
    // is listed and named with its exact shape; a batch whose legs NET to
    // zero or negative keeps the wave-3 netting phrasing.
    const batches = await wms.listBatchDistribution(row.warehouseId, row.itemId);
    const notes: string[] = [];
    const writes: BackfillWrite[] = [];
    let proven = new Decimal(0);
    for (const b of batches) {
      const ledgerQty = new Decimal(b.ledgerQty);
      const binQty = new Decimal(b.binQty);
      if (binQty.greaterThan(ledgerQty)) {
        notes.push(
          b.ledgerLegs === 0
            ? `batch ${b.batchNo}: bins hold ${b.binQty} but the ledger has NO movements for this batch at this warehouse — the per-batch sources disagree (drift the backfill never heals; resolve through a documented adjustment, runbook §5)`
            : `batch ${b.batchNo}: bins hold ${b.binQty} but the ledger nets ${b.ledgerQty} here — the per-batch sources disagree (drift the backfill never heals; resolve through a documented adjustment, runbook §5)`,
        );
        continue; // never a write for a conflicting batch (its clamped shortfall is 0)
      }
      const shortfall = new Decimal(b.shortfall);
      if (shortfall.lte(0)) continue;
      if (b.batchStatus !== "ACTIVE") {
        notes.push(
          `batch ${b.batchNo}: ledger balance ${b.ledgerQty} but status ${b.batchStatus} — not pickable, left unwritten`,
        );
        continue;
      }
      writes.push({
        batchId: b.batchId,
        serialId: null,
        batchNo: b.batchNo,
        serialNo: null,
        qty: shortfall.toFixed(6),
      });
      proven = proven.plus(shortfall);
    }
    if (proven.greaterThan(total)) {
      return {
        ...base,
        tracking: "BATCH" as const,
        classification: "NON_RECONCILABLE" as const,
        writes: [],
        residueQty: row.shortfall,
        notes: [
          `per-batch ledger shortfalls sum to ${proven.toFixed(6)} but the item_stock shortfall is only ${row.shortfall} — the sources disagree, nothing written`,
          ...notes.slice(0, 5),
        ],
      };
    }
    const residue = total.minus(proven);
    // WAVE-3 — the totals-matching guard: writing the proven parts of a
    // position that carries a NAMED anomaly (a per-batch conflict or a
    // non-pickable written-off balance) would land Σ bins exactly on
    // item_stock and turn the nightly probe GREEN — hiding the conflict
    // from the only recurring detector. The owner's case: batch A ledger 5
    // / bins 8, batch B ledger 2 / bins 0, item_stock 10 — the pre-fix pass
    // wrote 2 for B, classified the position WRITABLE, and the aggregate
    // difference vanished from the probe while A's per-batch disagreement
    // stayed invisible forever. A position whose sources disagree anywhere
    // is NEVER healed by this job: nothing is written, the FULL shortfall
    // stays visible to the probe, and the notes name every conflicting
    // batch (a position whose residue > 0 keeps the probe visible anyway —
    // its proven writes stay legitimate, PARTIAL_UNATTRIBUTED).
    if (residue.isZero() && notes.length > 0) {
      return {
        ...base,
        tracking: "BATCH" as const,
        classification: "NON_RECONCILABLE" as const,
        writes: [],
        residueQty: row.shortfall,
        notes: [
          `the per-batch proven shortfalls sum to ${proven.toFixed(6)} == the item_stock shortfall ${row.shortfall}, but the per-batch sources disagree at this position — writing the proven parts would make Σ bins == item_stock and HIDE the named conflict(s) from the nightly probe; nothing written, the position stays whole to the probe (resolve per runbook §5)`,
          ...notes.slice(0, 5),
        ],
      };
    }
    return {
      ...base,
      tracking: "BATCH" as const,
      classification: residue.isZero() ? ("WRITABLE" as const) : ("PARTIAL_UNATTRIBUTED" as const),
      writes,
      residueQty: residue.toFixed(6),
      notes: residue.isZero()
        ? notes.slice(0, 5)
        : [
            `${residue.toFixed(6)} unit(s) of item_stock carry no batch on the ledger (pre-tracking legacy moves) — left unwritten: no more spendable than before the backfill (the FEFO law only issues batch-attributed stock), stays visible to the nightly probe until corrected through a documented adjustment`,
            ...notes.slice(0, 5),
          ],
    };
  }

  /**
   * PHASE-044 T-20 — the legacy-stock backfill (§7's mitigation): stock
   * that predates the bin substrate (item_stock rows with no matching
   * tenant-owned bin_contents) lands on the warehouse's DEFAULT bin so
   * INV-029 holds from the first post-upgrade night. DRY-RUN reports the
   * shortfalls without writing; a SURPLUS (bins > stock) is genuine drift
   * this job never touches (the detector owns it). Audited; idempotent
   * (a second run finds no shortfall).
   *
   * POST-CLOSURE AUDIT FIX (2026-11-13): tracked items (batch/serial) are
   * DISTRIBUTED from the proven sources of truth — the stock_moves ledger
   * per (batch, warehouse) and per serial, reconciled against the
   * (warehouse, item) total BEFORE any write. Unprovable residue
   * (PARTIAL_UNATTRIBUTED) and source disagreements (NON_RECONCILABLE) are
   * NEVER written: the residue stays visible to the nightly probe, and the
   * live pass files ONE critical owner notification when anything stays
   * unresolved. The whole tenant pass is serialized by a transaction-local
   * advisory lock (concurrent runs converge — the loser re-reads an
   * already-healed fold).
   *
   * CONCURRENCY AUDIT FIX (this wave — the migration-vs-movement race):
   * the advisory lock only serializes backfill-vs-backfill. Inventory
   * movements (issue/receive/transfer/…) serialize on the item_stock ROW
   * lock (CC-04's `lockItemStock`, taken FIRST in every movement UoW, held
   * to commit). The live pass now joins THAT protocol — the movement
   * core's own lock, in its own order:
   *
   * 1. advisory lock (backfill-vs-backfill, unchanged);
   * 2. PRE-PASS: every candidate (warehouse, item) position row is locked
   *    `FOR UPDATE` in ONE canonical order (warehouseId, itemId) BEFORE
   *    any write — the same first-lock the movements take, so a movement
   *    UoW for a locked position now queues behind this UoW and, once it
   *    unblocks, its binless check (`hasAnyBinContent`) — which runs AFTER
   *    its position lock — observes the healed bin rows and switches to
   *    the binned path (never a binless write over a binned position);
   * 3. FRESH RE-DERIVE: the shortfall list is RE-READ under the held
   *    position locks. Every number the plan and its post-write
   *    verification use — stockQty, bin fold, batch/serial distribution —
   *    is therefore stable: no movement can commit between the shortage
   *    read and the verification (the pre-fix race: a binless issue or a
   *    receipt committing in that window made the verification compare a
   *    FRESH fold against the STALE row.stockQty — either a spurious
   *    whole-tenant rollback or, worse, an oversubscribed fold that SHIPPED
   *    silently). A fresh shortfall row outside the locked candidate set
   *    is a protocol violation and aborts the pass (fail-closed) — by the
   *    movement invariants it cannot occur (a position not short in the
   *    unlocked snapshot cannot become short), so this guard only fires on
   *    a regression;
   * 4. classify → write → verify per FRESH row (the verification law is
   *    unchanged: Σ bins == stock − residue, a violation rolls the whole
   *    tenant UoW back).
   *
   * Deadlock discipline (the price of joining the movement protocol): lock
   * acquisition is a SINGLE canonical order, but a MULTI-position movement
   * (a multi-line document or a transfer: source then destination) locks
   * its positions in ITS OWN order — an inverse-order overlap on ≥2 shared
   * positions can deadlock; Postgres resolves it within deadlock_timeout
   * and the operator tool RETRIES the tenant pass (bounded, idempotent —
   * a rolled-back pass re-derives from scratch). The runbook §6 documents
   * the protocol and the retry contract.
   */
  async backfillDefaultBins(input: {
    dryRun: boolean;
    actorId: string | null;
  }): Promise<BackfillResult> {
    // Serialize concurrent backfills on this tenant (the lock releases at
    // UoW end — a racing run waits here, then sees the healed fold below).
    await wms.lockBackfill();
    const candidates = await wms.listBinShortfalls();
    if (input.dryRun || candidates.length === 0) {
      // The dry-run report is a SNAPSHOT (advisory-locked against other
      // backfills, never row-locked against movements — a read-only report
      // must not block the store). The live pass re-derives everything
      // under the position locks, so a movement committing between the two
      // can change the numbers safely (never the fold's exactness).
      const plan: BackfillPlanRow[] = [];
      for (const row of candidates) {
        plan.push(await this.classifyShortfall(row));
      }
      return {
        dryRun: input.dryRun,
        warehouses: new Set(plan.map((row) => row.warehouseId)).size,
        items: plan.length,
        rows: 0,
        written: 0,
        resolvedItems: 0,
        partialItems: plan.filter((row) => row.classification === "PARTIAL_UNATTRIBUTED").length,
        nonReconcilableItems: plan.filter((row) => row.classification === "NON_RECONCILABLE")
          .length,
        report: plan.map((row) => ({
          warehouseCode: row.warehouseCode,
          itemSku: row.itemSku,
          binQty: row.binQty,
          stockQty: row.stockQty,
          shortfall: row.shortfall,
          tracking: row.tracking,
          classification: row.classification,
          plannedWrites: input.dryRun
            ? row.writes.map((w) => ({ batchNo: w.batchNo, serialNo: w.serialNo, qty: w.qty }))
            : [],
          residueQty: row.residueQty,
          notes: row.notes,
        })),
      };
    }
    // (2) The pre-pass — join the movement core's lock protocol BEFORE any
    // write, in ONE canonical order (warehouseId, itemId).
    const lockedPositions = new Set<string>();
    const canonical = [...candidates].sort((a, b) =>
      a.warehouseId === b.warehouseId
        ? a.itemId < b.itemId
          ? -1
          : a.itemId > b.itemId
            ? 1
            : 0
        : a.warehouseId < b.warehouseId
          ? -1
          : 1,
    );
    for (const candidate of canonical) {
      await stockStore.lockItemStock(candidate.itemId, candidate.warehouseId);
      lockedPositions.add(`${candidate.warehouseId}:${candidate.itemId}`);
    }
    // (3) The fresh re-derive — every decision below is made on numbers no
    // movement can change while this UoW holds the position locks.
    const shortfalls = await wms.listBinShortfalls();
    for (const row of shortfalls) {
      if (!lockedPositions.has(`${row.warehouseId}:${row.itemId}`)) {
        throw new BinContentStateError(
          `backfill locking protocol violated: item ${row.itemSku ?? row.itemId} at warehouse ` +
            `${row.warehouseCode ?? row.warehouseId} surfaced as a fresh shortfall outside the locked candidate set — ` +
            "nothing written, the tenant rolls back whole (fail-closed)",
        );
      }
    }
    const plan: BackfillPlanRow[] = [];
    for (const row of shortfalls) {
      plan.push(await this.classifyShortfall(row));
    }
    const binByWarehouse = new Map<string, string>();
    let written = 0;
    for (const row of plan) {
      if (row.writes.length === 0) continue;
      let binId = binByWarehouse.get(row.warehouseId);
      if (binId === undefined) {
        const bin = await wms.ensureDefaultBin(row.warehouseId);
        binId = bin.id;
        binByWarehouse.set(row.warehouseId, binId);
      }
      for (const w of row.writes) {
        await wms.insertBackfillContent({
          binId,
          warehouseId: row.warehouseId,
          itemId: row.itemId,
          batchId: w.batchId,
          serialId: w.serialId,
          qty: w.qty,
          note:
            "INV-029 legacy-stock backfill (PHASE-044 T-20" +
            (w.serialId !== null || w.batchId !== null ? ", tracked distribution" : "") +
            ")",
          createdBy: input.actorId,
        });
        written += 1;
      }
      // Post-write verification (the audit fix's guard): the fold for a
      // written item must land EXACTLY on stock − residue — both sides are
      // the FRESH numbers re-derived under the held position locks (the
      // concurrency fix: never the stale snapshot's row.stockQty) — a
      // violation throws and rolls the whole tenant UoW back (never a
      // partial write that hides the shortfall).
      const fold = await wms.foldTenantBinQty(row.warehouseId, row.itemId);
      const expected = new Decimal(row.stockQty).minus(new Decimal(row.residueQty));
      if (!fold.equals(expected)) {
        throw new BinContentStateError(
          `backfill verification failed for item ${row.itemSku ?? row.itemId} at warehouse ${row.warehouseCode ?? row.warehouseId}: Σ bins ${fold.toFixed(6)} ≠ stock − residue ${expected.toFixed(6)} — rolled back`,
        );
      }
    }
    const partial = plan.filter((row) => row.classification === "PARTIAL_UNATTRIBUTED");
    const nonReconcilable = plan.filter((row) => row.classification === "NON_RECONCILABLE");
    await this.audit.record({
      action: "inventory.wms_bins_backfilled",
      entityType: "bin_contents",
      // A writeless pass (only unprovable residue) anchors on the tenant —
      // the reconcile-mismatch precedent (entity_id is a NOT NULL uuid).
      entityId: binByWarehouse.values().next().value ?? requireTenantContext().tenantId,
      actorId: input.actorId ?? undefined,
      after: {
        rows: written,
        warehouses: binByWarehouse.size,
        partialItems: partial.length,
        nonReconcilableItems: nonReconcilable.length,
      },
    });
    // The CLEAR ALERT the audit demands: one critical owner notification
    // whenever anything stayed unresolved (partial residue or source
    // disagreement) — the drift is never silently absorbed.
    if (partial.length + nonReconcilable.length > 0) {
      const target = await this.inbox.ownerTarget();
      if (target !== null) {
        const prefs = await this.inbox.prefsFor(target.userId, "stock");
        if (prefs.inApp) {
          const named = [...partial, ...nonReconcilable]
            .slice(0, 5)
            .map(
              (row) =>
                `${row.itemSku ?? row.itemId} @ ${row.warehouseCode ?? row.warehouseId}: ${row.classification} (${row.residueQty} unproven)`,
            )
            .join("؛ ");
          await this.inbox.record({
            category: "stock",
            severity: "critical",
            title: {
              ar: `ترحيل الصناديق ترك ${partial.length + nonReconcilable.length} حالة غير محسومة`,
              en: `Bin backfill left ${partial.length + nonReconcilable.length} case(s) unresolved`,
            },
            body: {
              ar:
                `تعذّر إثبات توزيع جزء من الرصيد على دفعات/أرقام تسلسلية في ${partial.length} حالة، وتعارضت المصادر في ${nonReconcilable.length} حالة (INV-029)` +
                (named === "" ? "" : `: ${named}`) +
                ". لم تُكتب أرصدة غير مثبتة — راجع تقرير الترحيل الجاف.",
              en:
                `${partial.length} case(s) had unprovable batch/serial distribution and ${nonReconcilable.length} had disagreeing sources (INV-029)` +
                (named === "" ? "" : `: ${named}`) +
                ". No unproven balance was written — review the dry-run backfill report.",
            },
            actionLabel: { ar: "فتح شاشة المواقع", en: "Open the locations screen" },
            actionUrl: "/inventory/locations",
            dedupeKey: `stock.bins_backfill_unresolved:${new Date().toISOString().slice(0, 13)}`,
            userId: target.userId,
          });
        }
      }
    }
    return {
      dryRun: false,
      warehouses: binByWarehouse.size,
      items: plan.length,
      rows: written,
      written,
      resolvedItems: plan.filter((row) => row.classification === "WRITABLE").length,
      partialItems: partial.length,
      nonReconcilableItems: nonReconcilable.length,
      report: plan.map((row) => ({
        warehouseCode: row.warehouseCode,
        itemSku: row.itemSku,
        binQty: row.binQty,
        stockQty: row.stockQty,
        shortfall: row.shortfall,
        tracking: row.tracking,
        classification: row.classification,
        plannedWrites: [],
        residueQty: row.residueQty,
        notes: row.notes,
      })),
    };
  }
}

/** One proven write of the backfill plan (a tracked row names its batch or
 * serial; an untracked row keeps the historical NULL dimensions). */
interface BackfillWrite {
  batchId: string | null;
  serialId: string | null;
  batchNo: string | null;
  serialNo: string | null;
  qty: string;
}

/** The classification outcome for one (warehouse, item) shortfall. */
interface BackfillPlanRow {
  warehouseId: string;
  warehouseCode: string | null;
  itemId: string;
  itemSku: string | null;
  binQty: string;
  stockQty: string;
  shortfall: string;
  tracking: "NONE" | "BATCH" | "SERIAL";
  classification: "WRITABLE" | "PARTIAL_UNATTRIBUTED" | "NON_RECONCILABLE";
  writes: BackfillWrite[];
  residueQty: string;
  notes: string[];
}

/** The backfill's public result (dry-run and live): the per-item report
 * carries the classification, the proven writes, the unproven residue, and
 * the honest notes — the operator runbook's review surface. */
export interface BackfillResult {
  dryRun: boolean;
  warehouses: number;
  items: number;
  rows: number;
  written: number;
  resolvedItems: number;
  partialItems: number;
  nonReconcilableItems: number;
  report: {
    warehouseCode: string | null;
    itemSku: string | null;
    binQty: string;
    stockQty: string;
    shortfall: string;
    tracking: "NONE" | "BATCH" | "SERIAL";
    classification: "WRITABLE" | "PARTIAL_UNATTRIBUTED" | "NON_RECONCILABLE";
    plannedWrites: { batchNo: string | null; serialNo: string | null; qty: string }[];
    residueQty: string;
    notes: string[];
  }[];
}
