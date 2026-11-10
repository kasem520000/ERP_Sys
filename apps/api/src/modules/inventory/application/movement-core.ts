import { Decimal } from "@erp/domain-core";
import { generateUuidV7 } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { findActivePurpose } from "../../accounting/infrastructure/accounting.store";
import { purposeNotMapped } from "../../accounting/domain/posting-engine/posting-errors";
import type { JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/inventory.store";
import {
  BatchNotFoundError,
  BatchNotOnHandError,
  BatchQuarantinedError,
  BatchRequiredError,
  InsufficientStockError,
  InvalidCostError,
  InvalidQuantityError,
  ItemNotFoundError,
  ItemNotStockedError,
  SerialNotFoundError,
  SerialNotInStockError,
  SerialRequiredError,
  WarehouseInactiveError,
  WarehouseNotFoundError,
} from "../domain/inventory-errors";
import { fifoConsume } from "../domain/valuation/fifo";
import { wacIssue, wacReceive } from "../domain/valuation/wac";

/**
 * Movement core (PHASE-010 T5; INV-010/INV-017/INV-018): the ONLY writer
 * of stock_moves + stock_layers + item_stock — as a PLAN → POST → APPLY
 * pipeline inside the caller's ambient tenant transaction:
 *
 *   1. plan*() — locks the position (SELECT … FOR UPDATE — CC-04), runs
 *      the valuation math, and returns the exact journal quantum. NO
 *      writes: an engine rejection leaves zero residue by construction
 *      (INV-018's atomicity is plan-then-write, not write-then-undo).
 *   2. the caller composes the journal spec and PostingService.post()
 *      commits the economic effect (ADR-0007 — inventory never writes
 *      GL tables itself).
 *   3. apply*() writes the move rows + layers + read model WITH the
 *      journal id at INSERT time — stock_moves is append-only (grants +
 *      guard, INV-010), so the linkage can never be an UPDATE.
 *
 * Valuation dispatch (ADR-0009 6-decimal costs): WAC items keep the
 * moving average on item_stock; FIFO items consume stock_layers
 * oldest-first. An item never mixes methods (BR-014). Costing–picking
 * decoupling (INVENTORY_ACCOUNTING §5): batch/serial tracking picks
 * WHICH units move (FEFO for has_expiry items, BR-017); the costing math
 * is untouched.
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const COST_RE = /^\d+(\.\d{1,6})?$/;

function dec(value: string): Decimal {
  return new Decimal(value);
}

export function requirePositiveQty(qty: string, what: string): string {
  if (!QTY_RE.test(qty) || dec(qty).lte(0)) {
    throw new InvalidQuantityError(`${what} must be a positive decimal (≤ 6dp): ${qty}`);
  }
  return dec(qty).toFixed(6);
}

export function requireNonNegativeCost(cost: string, what: string): string {
  if (!COST_RE.test(cost) || dec(cost).lt(0)) {
    throw new InvalidCostError(`${what} must be a non-negative decimal (≤ 6dp): ${cost}`);
  }
  return dec(cost).toFixed(6);
}

/** Active STOCK item in THIS tenant (A7: 404-shape on foreign/unknown). */
export async function requireStockItem(itemId: string) {
  const item = await store.findItemForInventory(itemId);
  if (item === undefined) throw new ItemNotFoundError(itemId);
  if (item.kind !== "STOCK") throw new ItemNotStockedError(itemId);
  return item;
}

export async function requireActiveWarehouse(warehouseId: string) {
  const warehouse = await store.findWarehouseById(warehouseId);
  if (warehouse === undefined) throw new WarehouseNotFoundError(warehouseId);
  if (!warehouse.isActive) throw new WarehouseInactiveError(warehouseId);
  return warehouse;
}

/** BR-013 policy read (registry default false). */
export async function negativeStockAllowed(): Promise<boolean> {
  return (await store.readSetting("inventory.allow_negative_stock")) === true;
}

/**
 * Resolve a warehouse's GL inventory account: explicit override first,
 * else the tenant's active INVENTORY purpose mapping (fail closed with
 * the engine's verbatim error when unmapped — same semantics as a
 * purpose line).
 */
export async function resolveInventoryAccount(warehouseId: string): Promise<string> {
  const warehouse = await store.findWarehouseById(warehouseId);
  if (warehouse !== undefined && warehouse.inventoryAccountId !== null) {
    return warehouse.inventoryAccountId;
  }
  const mapping = await findActivePurpose("INVENTORY");
  if (mapping === undefined) {
    throw purposeNotMapped({ purposeKey: "INVENTORY" });
  }
  return mapping.accountId;
}

/**
 * Per-transaction pending overlay: plans don't write, so multi-line
 * documents (count approvals, transfers) must compose — each plan sees the
 * prior plans' pending qty/avg for the same position. Keyed by the ambient
 * transaction handle (one UoW = one handle), cleared implicitly at commit.
 */
const overlayByTx = new WeakMap<object, Map<string, { qty: string; avgCost: string }>>();

function overlayKey(itemId: string, warehouseId: string): string {
  return `${itemId}:${warehouseId}`;
}

function pendingOverlay(tx: object): Map<string, { qty: string; avgCost: string }> {
  let map = overlayByTx.get(tx);
  if (map === undefined) {
    map = new Map();
    overlayByTx.set(tx, map);
  }
  return map;
}

/** The locked position (CC-04): the row is FOR UPDATE until commit, with
 * any in-flight pending plan deltas overlaid. */
export interface LockedPosition {
  itemId: string;
  warehouseId: string;
  qty: string;
  avgCost: string;
}

/** FIFO display average over live layers (Σ qty×cost / Σ qty). */
function layersAverage(
  layers: readonly { remainingQty: string; unitCost: string }[],
  fallback: string,
): string {
  const totalQty = layers.reduce((s, l) => s.plus(dec(l.remainingQty)), new Decimal(0));
  if (totalQty.isZero()) return fallback;
  const totalValue = layers.reduce(
    (s, l) => s.plus(dec(l.remainingQty).times(dec(l.unitCost))),
    new Decimal(0),
  );
  return totalValue.div(totalQty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

async function positionWithOverlay(
  itemId: string,
  warehouseId: string,
): Promise<{ qty: string; avgCost: string }> {
  const tx = store.inventoryTx();
  const overlay = pendingOverlay(tx);
  const pending = overlay.get(overlayKey(itemId, warehouseId));
  if (pending !== undefined) {
    return { qty: pending.qty, avgCost: pending.avgCost };
  }
  const locked = await store.lockItemStock(itemId, warehouseId);
  return { qty: locked?.qty ?? "0", avgCost: locked?.avgCost ?? "0" };
}

function commitOverlay(
  itemId: string,
  warehouseId: string,
  qty: string,
  avgCost: string,
): void {
  const tx = store.inventoryTx();
  pendingOverlay(tx).set(overlayKey(itemId, warehouseId), { qty, avgCost });
}

/**
 * Stage a plan's pending position into the per-transaction overlay BEFORE
 * its apply (PHASE-011): multi-line same-item documents (goods receipts)
 * plan every line up front — a later line's plan must see the earlier
 * lines' pending qty/avg or the cumulative position double-counts from the
 * DB snapshot. Pure in-memory; the apply's own commitOverlay is idempotent
 * with the same values.
 */
export function stagePendingOverlay(plan: {
  itemId: string;
  warehouseId: string;
  nextQty: string;
  nextAvgCost: string;
}): void {
  commitOverlay(plan.itemId, plan.warehouseId, plan.nextQty, plan.nextAvgCost);
}

// ---------------------------------------------------------------------------
// Receipt: plan → apply.

export interface ReceiptPlan {
  kind: "RECEIPT";
  /** INV-013 anchor: the journal's docId and the single move's id. */
  anchorId: string;
  itemId: string;
  warehouseId: string;
  qty: string;
  unitCost: string;
  /** The journal quantum (4dp) — qty × unitCost, half-up. */
  valueAmount: string;
  moveKind: "receipt" | "adjust" | "transfer_in";
  sourceType: string;
  sourceId: string;
  movedAt: string;
  reason: string | null;
  batchId: string | null;
  createdBatch: { id: string; batchNo: string; expiryDate: string | null } | null;
  serialIds: string[];
  memo: string | null;
  memoAr: string | null;
  /** Post-apply state (computed under the lock). */
  nextQty: string;
  nextAvgCost: string;
  /** FIFO layer to create at apply (unit_cost = the receipt cost). */
  createLayer: boolean;
  /** Batch slices for tracked multi-batch receipts (single here). */
}

/**
 * Plan a receipt: locks the position, binds batch/serial (creating
 * missing registry rows is an APPLY-side write — the plan only notes
 * what must be created), computes the new average. NO database writes.
 */
export async function planReceipt(input: {
  itemId: string;
  warehouseId: string;
  qty: string;
  unitCost: string;
  movedAt: string;
  moveKind: "receipt" | "adjust" | "transfer_in";
  sourceType: string;
  sourceId: string;
  reason?: string | null;
  batchId?: string | null;
  batchNo?: string | null;
  batchExpiry?: string | null;
  serialIds?: string[];
  memo?: string | null;
  memoAr?: string | null;
}): Promise<ReceiptPlan> {
  const item = await requireStockItem(input.itemId);
  await requireActiveWarehouse(input.warehouseId);
  const qty = requirePositiveQty(input.qty, "receipt qty");
  const unitCost = requireNonNegativeCost(input.unitCost, "receipt unit cost");
  const value = dec(qty).times(dec(unitCost)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

  // Batch binding (BR-017): tracked items REQUIRE a batch on receive — by
  // id (validated) or by number (create-or-get at apply).
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
        if (item.hasExpiry && (input.batchExpiry ?? null) === null) {
          throw new BatchRequiredError(item.id);
        }
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

  // Serial binding (BR-018): tracked items register their units. A
  // receipt is the unit's (re-)entry: in_stock units validate, sold
  // units re-enter via the customer-return flow (the apply + the
  // service-level RETURN flip own the lifecycle — the original sale
  // stays in history), returned units go back on the shelf.
  const serialIds = input.serialIds ?? [];
  if (item.trackSerial) {
    if (serialIds.length !== Number(qty)) {
      throw new SerialRequiredError(item.id);
    }
    for (const serialId of serialIds) {
      const serial = await store.findSerialById(serialId);
      if (serial === undefined || serial.itemId !== item.id) {
        throw new SerialNotFoundError(serialId);
      }
    }
  }

  const moveIdOfReceiptPlan = generateUuidV7();
  const { qty: onHand, avgCost: oldAvg } = await positionWithOverlay(
    input.itemId,
    input.warehouseId,
  );

  let nextAvgCost: string;
  let createLayer = false;
  if (item.costingMethod === "WAC") {
    nextAvgCost = wacReceive(onHand, oldAvg, qty, unitCost).avgCost;
  } else {
    createLayer = true;
    const liveLayers = await store.listLiveLayers(input.itemId, input.warehouseId);
    nextAvgCost = layersAverage(
      [
        ...liveLayers.map((l) => ({ remainingQty: l.remainingQty, unitCost: l.unitCost })),
        { remainingQty: qty, unitCost },
      ],
      unitCost,
    );
  }

  return {
    kind: "RECEIPT",
    anchorId: moveIdOfReceiptPlan,
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    qty,
    unitCost,
    valueAmount: value,
    moveKind: input.moveKind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    movedAt: input.movedAt,
    reason: input.reason ?? null,
    batchId,
    createdBatch,
    serialIds,
    memo: input.memo ?? null,
    memoAr: input.memoAr ?? null,
    nextQty: addExact(onHand, qty),
    nextAvgCost,
    createLayer,
  };
}

/** Apply a receipt AFTER its journal posted: rows only, all precomputed. */
export async function applyReceipt(plan: ReceiptPlan, journalEntryId: string | null): Promise<string> {
  const moveId = plan.anchorId;
  if (plan.createdBatch !== null) {
    await store.insertBatch({
      id: plan.createdBatch.id,
      itemId: plan.itemId,
      batchNo: plan.createdBatch.batchNo,
      expiryDate: plan.createdBatch.expiryDate,
      sourceRef: plan.sourceType,
      createdBy: null,
    });
  }
  await store.insertStockMove({
    id: moveId,
    itemId: plan.itemId,
    warehouseId: plan.warehouseId,
    direction: "IN",
    moveKind: plan.moveKind,
    qty: plan.qty,
    unitCost: plan.unitCost,
    valueAmount: plan.valueAmount,
    batchId: plan.batchId,
    serialId: plan.serialIds[0] ?? null,
    sourceType: plan.sourceType,
    sourceId: plan.sourceId,
    movedAt: plan.movedAt,
    reason: plan.reason,
    memo: plan.memo,
    memoAr: plan.memoAr,
    postedJournalId: journalEntryId,
  });
  if (plan.createLayer) {
    await store.insertLayer({
      id: generateUuidV7(),
      itemId: plan.itemId,
      warehouseId: plan.warehouseId,
      remainingQty: plan.qty,
      unitCost: plan.unitCost,
      sourceMoveId: moveId,
      receivedAt: plan.movedAt,
    });
  }
  for (const serialId of plan.serialIds) {
    const serial = await store.findSerialById(serialId);
    if (serial !== undefined && serial.status === "returned") {
      await store.markSerialInStock(serialId);
    }
  }
  await store.upsertItemStock({
    itemId: plan.itemId,
    warehouseId: plan.warehouseId,
    qty: plan.nextQty,
    avgCost: plan.nextAvgCost,
  });
  commitOverlay(plan.itemId, plan.warehouseId, plan.nextQty, plan.nextAvgCost);
  return moveId;
}

// ---------------------------------------------------------------------------
// Issue: plan → apply.

export interface IssuePlan {
  kind: "ISSUE";
  /** INV-013 anchor: the journal's docId (the slices carry their own ids). */
  anchorId: string;
  itemId: string;
  warehouseId: string;
  qty: string;
  /** Σ over slices at the 4dp journal quantum. */
  valueAmount: string;
  moveKind: "issue" | "adjust" | "transfer_out";
  sourceType: string;
  sourceId: string;
  movedAt: string;
  reason: string | null;
  memo: string | null;
  memoAr: string | null;
  slices: {
    moveId: string;
    qty: string;
    unitCost: string;
    valueAmount: string;
    batchId: string | null;
    serialId: string | null;
    /** FIFO decrements (layerId → qty) — applied at apply. */
    layerDecrements: { layerId: string; qty: string }[];
  }[];
  nextQty: string;
  nextAvgCost: string;
}

/**
 * Plan an issue: locks the position (CC-04), enforces BR-013, binds
 * serials (BR-018), picks slices (FEFO for has_expiry — BR-017), and
 * values them by the item's costing method. NO database writes.
 */
export async function planIssue(input: {
  itemId: string;
  warehouseId: string;
  qty: string;
  movedAt: string;
  moveKind: "issue" | "adjust" | "transfer_out";
  sourceType: string;
  sourceId: string;
  reason?: string | null;
  batchId?: string | null;
  serialIds?: string[];
  allowNegative?: boolean;
  /** PHASE-018 (T39): the QC fail-scrap flow (MASTER-PLAN §1 row 4) is the
   * SOLE caller allowed to bypass the explicit-batch quarantine hold — the
   * scrapping inspection issues the quarantined FG batch on purpose. Every
   * other explicit-batch issue on a QUARANTINED batch still throws
   * BATCH_QUARANTINED (the default below stays undefined → the guard fires). */
  allowQuarantinedBatch?: boolean;
  memo?: string | null;
  memoAr?: string | null;
}): Promise<IssuePlan> {
  const item = await requireStockItem(input.itemId);
  await requireActiveWarehouse(input.warehouseId);
  const qty = requirePositiveQty(input.qty, "issue qty");

  // Serial binding (BR-018): one unit per in-stock serial.
  const serialIds = input.serialIds ?? [];
  if (item.trackSerial) {
    if (serialIds.length !== Number(qty)) {
      throw new SerialRequiredError(item.id);
    }
    for (const serialId of serialIds) {
      const serial = await store.findSerialById(serialId);
      if (serial === undefined || serial.itemId !== item.id) {
        throw new SerialNotFoundError(serialId);
      }
      if (serial.status !== "in_stock") {
        throw new SerialNotInStockError(serial.serialNo, serial.status);
      }
    }
  }

  const anchorIdOfIssuePlan = generateUuidV7();
  const { qty: onHand, avgCost } = await positionWithOverlay(
    input.itemId,
    input.warehouseId,
  );
  const allowNegative = input.allowNegative ?? (await negativeStockAllowed());
  const after = subExact(onHand, qty);
  if (compareExact(after, "0") < 0 && !allowNegative) {
    throw new InsufficientStockError({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      onHand,
      requested: qty,
    });
  }

  // Picking slices: serial units → explicit batch → FEFO → single.
  const rawSlices = await resolveIssueSlices(item, input, qty);
  const slices: IssuePlan["slices"] = [];
  let totalValue = new Decimal(0);
  for (const raw of rawSlices) {
    let value: string;
    let unitCost: string;
    let layerDecrements: { layerId: string; qty: string }[] = [];
    if (item.costingMethod === "WAC") {
      const issue = wacIssue(avgCost, raw.qty);
      value = issue.valueAmount;
      unitCost = issue.unitCost;
    } else {
      const liveLayers = await store.listLiveLayers(input.itemId, input.warehouseId);
      const consumption = fifoConsume(
        liveLayers.map((l) => ({ id: l.id, remainingQty: l.remainingQty, unitCost: l.unitCost })),
        raw.qty,
      );
      value = consumption.valueAmount;
      unitCost = consumption.unitCost;
      layerDecrements = consumption.consumptions;
    }
    slices.push({
      moveId: generateUuidV7(),
      qty: raw.qty,
      unitCost,
      valueAmount: value,
      batchId: raw.batchId,
      serialId: raw.serialId,
      layerDecrements,
    });
    totalValue = totalValue.plus(dec(value));
  }

  // Read model: qty down. WAC issues never mutate the average; FIFO avg
  // re-derives from the post-consumption layers.
  let nextAvgCost = avgCost;
  if (item.costingMethod === "FIFO") {
    const liveLayers = await store.listLiveLayers(input.itemId, input.warehouseId);
    const remainingByLayer = new Map<string, string>();
    for (const layer of liveLayers) remainingByLayer.set(layer.id, layer.remainingQty);
    for (const slice of slices) {
      for (const decrement of slice.layerDecrements) {
        const current = remainingByLayer.get(decrement.layerId) ?? "0";
        remainingByLayer.set(decrement.layerId, subExact(current, decrement.qty));
      }
    }
    const remainingLayers = [...remainingByLayer.entries()]
      .map(([id, remainingQty]) => ({
        remainingQty,
        unitCost: liveLayers.find((l) => l.id === id)!.unitCost,
      }))
      .filter((l) => dec(l.remainingQty).gt(0));
    nextAvgCost = layersAverage(remainingLayers, "0.000000");
  }

  return {
    kind: "ISSUE",
    anchorId: anchorIdOfIssuePlan,
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    qty,
    valueAmount: totalValue.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    moveKind: input.moveKind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    movedAt: input.movedAt,
    reason: input.reason ?? null,
    memo: input.memo ?? null,
    memoAr: input.memoAr ?? null,
    slices,
    nextQty: after,
    nextAvgCost,
  };
}

/** Apply an issue AFTER its journal posted (or policy-none: NULL id). */
export async function applyIssue(plan: IssuePlan, journalEntryId: string | null): Promise<string[]> {
  for (const slice of plan.slices) {
    await store.insertStockMove({
      id: slice.moveId,
      itemId: plan.itemId,
      warehouseId: plan.warehouseId,
      direction: "OUT",
      moveKind: plan.moveKind,
      qty: slice.qty,
      unitCost: slice.unitCost,
      valueAmount: slice.valueAmount,
      batchId: slice.batchId,
      serialId: slice.serialId,
      sourceType: plan.sourceType,
      sourceId: plan.sourceId,
      movedAt: plan.movedAt,
      reason: plan.reason,
      memo: plan.memo,
      memoAr: plan.memoAr,
      postedJournalId: journalEntryId,
    });
    for (const decrement of slice.layerDecrements) {
      await store.decrementLayer(decrement.layerId, decrement.qty);
    }
    if (slice.serialId !== null) {
      await store.markSerialSold({ id: slice.serialId, soldAt: plan.movedAt, owner: null });
    }
  }
  await store.upsertItemStock({
    itemId: plan.itemId,
    warehouseId: plan.warehouseId,
    qty: plan.nextQty,
    avgCost: plan.nextAvgCost,
  });
  commitOverlay(plan.itemId, plan.warehouseId, plan.nextQty, plan.nextAvgCost);
  return plan.slices.map((slice) => slice.moveId);
}

/** Serial sale/return flips (apply-side; BR-018 states). */
export async function applySerialFlips(
  serialIds: readonly string[],
  action: "SOLD" | "RETURN",
  date: string,
): Promise<void> {
  for (const serialId of serialIds) {
    if (action === "SOLD") {
      await store.markSerialSold({ id: serialId, soldAt: date, owner: null });
    } else {
      await store.markSerialReturned({ id: serialId, returnedAt: date, owner: null });
    }
  }
}

/** Picking slices (BR-017 FEFO / BR-018 serial / explicit batch / single). */
async function resolveIssueSlices(
  item: { id: string; trackBatch: boolean; trackSerial: boolean },
  input: { batchId?: string | null; serialIds?: string[]; allowQuarantinedBatch?: boolean },
  qty: string,
): Promise<{ qty: string; batchId: string | null; serialId: string | null }[]> {
  if (item.trackSerial) {
    return (input.serialIds ?? []).map((serialId) => ({
      qty: "1.000000",
      batchId: null,
      serialId,
    }));
  }
  if (!item.trackBatch) {
    return [{ qty, batchId: null, serialId: null }];
  }
  if (input.batchId !== null && input.batchId !== undefined) {
    const batch = await store.findBatchById(input.batchId);
    if (batch === undefined || batch.itemId !== item.id) {
      throw new BatchNotFoundError(input.batchId);
    }
    // PHASE-018 (migration 0026): an explicit-batch issue on a QUARANTINED
    // batch is rejected (the QC hold). FEFO auto-pick never gets here —
    // listFefoBatches only lists status='ACTIVE'. The ONE bypass is the QC
    // fail-scrap flow (T39, MASTER-PLAN §1 row 4), which sets
    // allowQuarantinedBatch explicitly — nothing else may.
    if (batch.status === "QUARANTINED" && input.allowQuarantinedBatch !== true) {
      throw new BatchQuarantinedError(batch.batchNo);
    }
    const onHandBatch = await store.batchOnHand(batch.id);
    if (compareExact(onHandBatch, qty) < 0) {
      throw new BatchNotOnHandError({
        batchNo: batch.batchNo,
        onHand: onHandBatch,
        requested: qty,
      });
    }
    return [{ qty, batchId: batch.id, serialId: null }];
  }
  // FEFO: earliest expiry first (BR-017), then creation order.
  const fefo = await store.listFefoBatches(item.id);
  const slices: { qty: string; batchId: string | null; serialId: string | null }[] = [];
  let remaining = dec(qty);
  for (const batch of fefo) {
    if (remaining.lte(0)) break;
    const available = dec(batch.onHand);
    if (available.lte(0)) continue;
    const take = Decimal.min(available, remaining);
    slices.push({ qty: take.toFixed(6), batchId: batch.id, serialId: null });
    remaining = remaining.minus(take);
  }
  if (remaining.gt(0)) {
    throw new BatchRequiredError(item.id);
  }
  return slices;
}

/** DR/CR INVENTORY vs purpose counter-line (G-13/G-14/G-16 shape). */
export function inventoryJournalLines(input: {
  inventoryAccountId: string;
  direction: "IN" | "OUT";
  value: string;
  counterPurpose?: string;
  counterAccountId?: string;
  memoEn: string;
  memoAr: string;
}): JournalLineSpec[] {
  if (input.value === "0.0000") return [];
  const inventoryLine: JournalLineSpec = {
    accountId: input.inventoryAccountId,
    direction: input.direction === "IN" ? "DEBIT" : "CREDIT",
    amount: input.value,
    memo: { en: input.memoEn, ar: input.memoAr },
  };
  const counterLine: JournalLineSpec = {
    purpose: input.counterPurpose,
    accountId: input.counterAccountId,
    direction: input.direction === "IN" ? "CREDIT" : "DEBIT",
    amount: input.value,
    memo: { en: input.memoEn, ar: input.memoAr },
  };
  // Debit first — the goldens' canonical presentation (G-13/G-14/G-16).
  return counterLine.direction === "DEBIT" ? [counterLine, inventoryLine] : [inventoryLine, counterLine];
}

/** Aggregate helper for multi-line journals (counts: G-13 + G-14 pairs). */
export function sumValues(values: readonly string[]): string {
  return values.reduce((acc, value) => addExact(acc, value), "0.0000");
}
