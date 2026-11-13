import { Inject, Injectable } from "@nestjs/common";
import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/inventory.store";
import * as wmsStore from "../infrastructure/wms-store";
import {
  BinNotFoundError,
  BatchNotFoundError,
  BatchRequiredError,
  ConsignmentPartnerInvalidError,
  ConsignmentStockShortError,
  InvalidQuantityError,
  ItemNotFoundError,
  LpnClosedError,
  LpnNotFoundError,
  SerialNotFoundError,
  SerialRequiredError,
} from "../domain/inventory-errors";

/**
 * Consignment / VMI ownership (PHASE-044 T-09; §2.9, I-10/I-11/I-19):
 * vendor-owned stock tracked at BIN level, EXCLUDED from the tenant's
 * valuation and ATP (BR-076 — the owner's rows never touch item_stock,
 * stock_moves, or the pick allocation source; INV-029's fold spans
 * tenant-owned rows only), with the consumption settlement against the
 * owner partner (G-44: DR COGS · CR 2135 CONSIGNATION_PAYABLE at the
 * agreed unit price, the owner partner stamped on both legs — fail-closed
 * PURPOSE_NOT_MAPPED until 2135 is mapped, the BR-077 discipline).
 *
 * The receive/return legs are STRUCTURAL (bin_contents writes only — no
 * journal: the stock is not the tenant's asset, INV-010's ledger stays the
 * tenant's own); the CONSUME leg is the economic one (the tenant now owes
 * the owner for what it used/sold — G-44 posts, the owner's bin rows
 * decrement, the serial ledger records CONSIGNMENT_IN/OUT).
 */
@Injectable()
export class ConsignmentService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  /** The board: the owner's rows (per partner or the whole consignment floor). */
  async board(filter: { ownerPartnerId?: string; warehouseId?: string; itemId?: string; limit?: number }) {
    return wmsStore.listBinContents({
      ownerPartnerId: filter.ownerPartnerId ?? null,
      warehouseId: filter.warehouseId,
      itemId: filter.itemId,
      limit: filter.limit ?? 300,
    });
  }

  /**
   * Receive vendor-owned stock (§2.9): bin_contents rows with the owner
   * set — NO item_stock, NO journal, NO stock_moves (INV-010's ledger is
   * the TENANT's; the owner's value never enters it). Batch/serial
   * tracking rides the tenant's registries (operational data); the serial
   * ledger records CONSIGNMENT_IN per unit.
   */
  async receive(input: {
    itemId: string;
    warehouseId: string;
    ownerPartnerId: string;
    qty: string;
    targetBinId: string | null;
    lpnId: string | null;
    batchId: string | null;
    batchNo: string | null;
    batchExpiry: string | null;
    serialIds: string[] | null;
    note: string | null;
    actorId: string | null;
  }) {
    await this.requireOwnerPartner(input.ownerPartnerId);
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) throw new ItemNotFoundError(input.itemId);
    if (!/^\d+(\.\d{1,6})?$/.test(input.qty) || Number(input.qty) <= 0) {
      throw new InvalidQuantityError("consignment receipt qty must be a positive decimal");
    }

    // Batch binding (BR-017's shape over the tenant registry).
    let batchId = input.batchId ?? null;
    let createdBatch: { id: string; batchNo: string; expiryDate: string | null } | null = null;
    if (item.trackBatch) {
      if (batchId === null && (input.batchNo ?? null) === null) {
        throw new BatchRequiredError(item.id);
      }
      if (batchId === null) {
        const existing = await store.findBatchByNo(item.id, input.batchNo!);
        if (existing !== undefined) {
          batchId = existing.id;
        } else {
          createdBatch = {
            id: generateUuidV7(),
            batchNo: input.batchNo!,
            expiryDate: input.batchExpiry ?? null,
          };
          batchId = createdBatch.id;
        }
      } else {
        const batch = await store.findBatchById(batchId);
        if (batch === undefined || batch.itemId !== item.id) {
          throw new BatchNotFoundError(batchId);
        }
      }
    }
    if (createdBatch !== null) {
      await store.insertBatch({
        id: createdBatch.id,
        itemId: item.id,
        batchNo: createdBatch.batchNo,
        expiryDate: createdBatch.expiryDate,
        sourceRef: "consignment_receipt",
        createdBy: input.actorId,
      });
    }

    // Serial binding (BR-018's shape): one unit per serial; returned units
    // re-shelf; every unit appends its CONSIGNMENT_IN ledger row.
    const serialIds = input.serialIds ?? [];
    if (item.trackSerial) {
      if (serialIds.length !== Number(input.qty)) {
        throw new SerialRequiredError(item.id);
      }
      for (const serialId of serialIds) {
        const serial = await store.findSerialById(serialId);
        if (serial === undefined || serial.itemId !== item.id) {
          throw new SerialNotFoundError(serialId);
        }
      }
    }

    // The bin endpoint: explicit or the warehouse DEFAULT (the lazy anchor).
    let binId = input.targetBinId;
    if (binId === null) {
      const bin = await wmsStore.findDefaultBin(input.warehouseId);
      binId = bin?.id ?? (await wmsStore.ensureDefaultBin(input.warehouseId)).id;
    } else {
      const bin = await wmsStore.findBinById(binId);
      if (bin === undefined) throw new BinNotFoundError(binId);
    }
    if (input.lpnId !== null) {
      const lpn = await wmsStore.findLpnById(input.lpnId);
      if (lpn === undefined) throw new LpnNotFoundError(input.lpnId);
      if (lpn.status !== "ACTIVE") throw new LpnClosedError(input.lpnId);
    }

    // One slot row per serial (qty 1 each) or one row for the lot.
    if (serialIds.length > 0) {
      for (const serialId of serialIds) {
        const serial = await store.findSerialById(serialId);
        if (serial !== undefined && serial.status === "returned") {
          await store.markSerialInStock(serialId);
        }
        await wmsStore.addToBinSlot({
          binId,
          warehouseId: input.warehouseId,
          itemId: item.id,
          batchId,
          serialId,
          lpnId: input.lpnId,
          ownerPartnerId: input.ownerPartnerId,
          status: "AVAILABLE",
          qty: "1",
          uomId: item.uomId,
          receivedAt: new Date().toISOString(),
          note: input.note,
          createdBy: input.actorId,
        });
        await wmsStore.appendSerialMovement({
          serialId,
          event: "CONSIGNMENT_IN",
          moveId: null,
          sourceType: "consignment_receipt",
          sourceId: input.ownerPartnerId,
          fromBinId: null,
          toBinId: binId,
          movedAt: new Date().toISOString(),
          note: input.note,
          createdBy: input.actorId,
        });
      }
    } else {
      await wmsStore.addToBinSlot({
        binId,
        warehouseId: input.warehouseId,
        itemId: item.id,
        batchId,
        serialId: null,
        lpnId: input.lpnId,
        ownerPartnerId: input.ownerPartnerId,
        status: "AVAILABLE",
        qty: input.qty,
        uomId: item.uomId,
        receivedAt: new Date().toISOString(),
        note: input.note,
        createdBy: input.actorId,
      });
    }

    await this.audit.record({
      action: "inventory.consignment_received",
      entityType: "bin_contents",
      entityId: input.ownerPartnerId,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: item.id,
        warehouseId: input.warehouseId,
        ownerPartnerId: input.ownerPartnerId,
        qty: input.qty,
        binId,
        batchId,
        serials: serialIds.length,
      },
    });
    return { itemId: item.id, warehouseId: input.warehouseId, binId, qty: input.qty, batchId };
  }

  /**
   * The consumption settlement (G-44): the tenant used/sold the owner's
   * stock — the owner's rows decrement (structural; item_stock NEVER
   * moves), the tenant books the payable at the agreed unit price
   * (DR COGS · CR 2135 CONSIGNATION_PAYABLE, the owner partner stamped on
   * both legs). Fail-closed until 2135 is mapped (BR-077's gate).
   */
  async consume(input: {
    ownerPartnerId: string;
    warehouseId: string;
    itemId: string;
    qty: string;
    unitPrice: string;
    /** The economic date of the settlement (ISO date). */
    valueDate: string;
    note: string | null;
    actorId: string | null;
  }) {
    const owner = await this.requireOwnerPartner(input.ownerPartnerId);
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) throw new ItemNotFoundError(input.itemId);
    if (!/^\d+(\.\d{1,6})?$/.test(input.qty) || Number(input.qty) <= 0) {
      throw new InvalidQuantityError("consignment consumption qty must be a positive decimal");
    }
    if (!/^\d+(\.\d{1,6})?$/.test(input.unitPrice) || Number(input.unitPrice) < 0) {
      throw new InvalidQuantityError("the settlement unit price must be a non-negative decimal");
    }

    // Allocate the owner's rows FIFO (received_at order).
    const rows = await wmsStore.listOwnerRows({
      ownerPartnerId: input.ownerPartnerId,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
    });
    const onHand = rows.reduce((sum, row) => sum + Number(row.qty), 0);
    if (onHand < Number(input.qty)) {
      throw new ConsignmentStockShortError({
        ownerPartnerId: input.ownerPartnerId,
        itemId: input.itemId,
        onHand: onHand.toFixed(6),
        requested: input.qty,
      });
    }
    const takes: { contentId: string; qty: number; binId: string; serialId: string | null }[] = [];
    let remaining = Number(input.qty);
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.qty), remaining);
      takes.push({ contentId: row.id, qty: take, binId: row.binId, serialId: row.serialId });
      remaining -= take;
    }

    const valueAmount = new Decimal(input.qty)
      .times(new Decimal(input.unitPrice))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    // The settlement's own id — the journal's exactly-once source key
    // (INV-013: one key per settlement, never per partner).
    const settlementId = generateUuidV7();

    // POST: G-44 (zero value ⇒ no journal — the honest floor).
    let journalEntryId: string | null = null;
    let entryNo: string | null = null;
    if (Number(valueAmount) > 0) {
      const memoEn = `Consignment settlement — ${owner.name} (${item.sku})`;
      const memoAr = `تسوية أمانة — ${owner.nameAr ?? owner.name} (${item.sku})`;
      const lines: JournalLineSpec[] = [
        {
          purpose: "COGS",
          direction: "DEBIT",
          amount: valueAmount,
          partnerId: input.ownerPartnerId,
          itemId: input.itemId,
          memo: { en: memoEn, ar: memoAr },
        },
        {
          purpose: "CONSIGNATION_PAYABLE",
          direction: "CREDIT",
          amount: valueAmount,
          partnerId: input.ownerPartnerId,
          itemId: input.itemId,
          memo: { en: memoEn, ar: memoAr },
        },
      ];
      const spec: JournalSpec = {
        source: { docType: "consignment_settlement", docId: settlementId, operation: "settle" },
        entryDate: input.valueDate,
        description: { en: memoEn, ar: memoAr },
        currency: await ownTenantBaseCurrency(),
        lines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = result.journalEntryId;
      entryNo = result.entryNo;
    }

    // APPLY: the owner's rows decrement (structural); the serial ledger
    // records CONSIGNMENT_OUT per unit; serialized units leave as sold
    // (the flip is direct — applySerialFlips would double-append its own
    // PICK event, breaking T-11's one-row-per-movement law).
    for (const take of takes) {
      await wmsStore.decrementBinContent(take.contentId, take.qty.toFixed(6));
      if (take.serialId !== null) {
        await store.markSerialSold({ id: take.serialId, soldAt: new Date().toISOString(), owner: null });
        await wmsStore.appendSerialMovement({
          serialId: take.serialId,
          event: "CONSIGNMENT_OUT",
          moveId: null,
          sourceType: "consignment_settlement",
          sourceId: settlementId,
          fromBinId: take.binId,
          toBinId: null,
          movedAt: new Date().toISOString(),
          note: input.note,
          createdBy: input.actorId,
        });
      }
    }

    await this.audit.record({
      action: "inventory.consignment_settled",
      entityType: "consignment_settlement",
      entityId: settlementId,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        ownerPartnerId: input.ownerPartnerId,
        qty: input.qty,
        unitPrice: input.unitPrice,
        valueAmount,
        journalEntryId,
        rows: takes.length,
      },
    });
    return { settlementId, journalEntryId, entryNo, valueAmount, rows: takes.length };
  }

  /**
   * Return the owner's stock to the owner (§2.9): structural only — the
   * rows leave the warehouse, no journal (the ownership never changed
   * hands), the serial ledger records the OUT per unit.
   */
  async returnToOwner(input: {
    ownerPartnerId: string;
    warehouseId: string;
    itemId: string;
    qty: string;
    note: string | null;
    actorId: string | null;
  }) {
    await this.requireOwnerPartner(input.ownerPartnerId);
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) throw new ItemNotFoundError(input.itemId);
    if (!/^\d+(\.\d{1,6})?$/.test(input.qty) || Number(input.qty) <= 0) {
      throw new InvalidQuantityError("consignment return qty must be a positive decimal");
    }
    const rows = await wmsStore.listOwnerRows({
      ownerPartnerId: input.ownerPartnerId,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
    });
    const onHand = rows.reduce((sum, row) => sum + Number(row.qty), 0);
    if (onHand < Number(input.qty)) {
      throw new ConsignmentStockShortError({
        ownerPartnerId: input.ownerPartnerId,
        itemId: input.itemId,
        onHand: onHand.toFixed(6),
        requested: input.qty,
      });
    }
    let remaining = Number(input.qty);
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.qty), remaining);
      await wmsStore.decrementBinContent(row.id, take.toFixed(6));
      if (row.serialId !== null) {
        await store.markSerialReturned({ id: row.serialId, returnedAt: new Date().toISOString(), owner: null });
        await wmsStore.appendSerialMovement({
          serialId: row.serialId,
          event: "CONSIGNMENT_OUT",
          moveId: null,
          sourceType: "consignment_return",
          sourceId: input.ownerPartnerId,
          fromBinId: row.binId,
          toBinId: null,
          movedAt: new Date().toISOString(),
          note: input.note,
          createdBy: input.actorId,
        });
      }
      remaining -= take;
    }
    await this.audit.record({
      action: "inventory.consignment_returned_to_owner",
      entityType: "bin_contents",
      entityId: input.ownerPartnerId,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        ownerPartnerId: input.ownerPartnerId,
        qty: input.qty,
      },
    });
    return { qty: input.qty };
  }

  /** The owner's on-hand per (warehouse, item) — the VMI view. */
  async ownerOnHand(ownerPartnerId: string, warehouseId?: string) {
    await this.requireOwnerPartner(ownerPartnerId);
    const rows = await this.board({ ownerPartnerId, warehouseId, limit: 1000 });
    const fold = new Map<string, { itemId: string; itemSku: string | null; qty: number }>();
    for (const row of rows) {
      if (Number(row.qty) <= 0) continue;
      const entry = fold.get(row.itemId) ?? { itemId: row.itemId, itemSku: row.itemSku, qty: 0 };
      entry.qty += Number(row.qty);
      fold.set(row.itemId, entry);
    }
    return [...fold.values()].sort((a, b) => a.itemSku?.localeCompare(b.itemSku ?? "") ?? 0);
  }

  private async requireOwnerPartner(partnerId: string) {
    const { findPartnerById } = await import("../../partners/infrastructure/partners.store");
    const partner = await findPartnerById(partnerId);
    if (partner === undefined) {
      throw new ConsignmentPartnerInvalidError(partnerId, "partner not found in this tenant");
    }
    if (partner.kind === "CUSTOMER") {
      throw new ConsignmentPartnerInvalidError(partnerId, "a consignment owner must be a SUPPLIER (or BOTH)");
    }
    return partner;
  }
}
