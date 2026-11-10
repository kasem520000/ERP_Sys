/**
 * PHASE-022 T-P22-2-e · the van-sale capture flow (MASTER-PLAN §8 —
 * BINDING; OFFLINE_CAPABILITIES_MATRIX row 6 android-field **LOCAL-VALID†**
 * + row 35 serial/batch capture LOCAL-VALID†; CONFLICT_RESOLUTION §2
 * "Drafts" OWNER_DEVICE_WINS).
 *
 * The machine: a pure CART (immutable value + pure reducers the screen
 * drives) → {@link saveVanSale} which, in ONE local transaction (the §1.2
 * atomic-capture rule), takes the next offline number
 * (`nextOfflineNumber` — sync-core, UNMODIFIED reuse), builds the
 * `sales_invoice:create_draft` command through sync-core's
 * `buildDraftInvoiceCreate` (NEVER a hand-rolled envelope), and `enqueue`s
 * it — DRAFT_LOCAL capture becomes PENDING_SYNC, honest states only.
 *
 * Attribution + van context (the §8 "capture rep/device attribution + van
 * warehouse context" requirement): rep/device attribution rides the COMMAND
 * ENVELOPE by construction — the server stamps `owner_device_id` = the
 * pushing device and `created_by` = the device user (draft-invoice handler,
 * T-P20-2b) — so the flow's context carries the device identity for the
 * offline numbering and the van warehouse for the van-stock advisory, and
 * the wire payload never carries a rep field (the contract has none; a
 * client-asserted rep id would be untrusted input anyway).
 *
 * Row 35 — serial/batch capture on lines: the cart captures serials/batches
 * for tracked items (blocking until the serial count covers the qty); the
 * payload assembly attaches them ADDITIVELY (`serialIds`/`batchId` line
 * keys). HONEST GAP (recorded as this task's deviation 1, proven by test):
 * the server's `draftInvoiceCreateSchema` (packages/contracts, zod
 * non-strict) STRIPS unknown line keys, and the draft-invoice handler
 * passes `batchId: null, serialIds: null` to the sales service — the
 * capture rides the outbox payload (the local audit trail) but does not
 * reach the server-side draft through the CURRENT contract. The
 * credit-note intent (`credit_note:create_draft`) DOES carry
 * `batchId`/`serialIds` on its lines, so returns capture is wire-complete.
 */
import { Decimal, generateUuidV7 } from "@erp/domain-core";
import type { DraftInvoiceCreatePayload } from "@erp/contracts";
import {
  buildDraftInvoiceCreate,
  currentOfflineSeq,
  enqueue,
  nextOfflineNumber,
  type StorageAdapter,
  type SyncCommandV2Envelope,
} from "@erp/sync-core";

import {
  prevalidateVanSale,
  readCachedUnitPrice,
  readItem,
  readPartner,
  resolveBarcodeItem,
  type ItemSnapshot,
  type PrevalidationIssue,
  type PrevalidationResult,
} from "./prevalidation";
import {
  flowRowByCommandId,
  flowStateFromRow,
  contextToday,
  type FieldFlowContext,
  type HonestFlowState,
} from "./state-machine";

// -- the cart (pure value + reducers — the screen stays thin) ------------------------

/** One cart line: the captured item + qty + price + row-35 serial/batch capture. */
export interface VanSaleCartLine {
  readonly itemId: string;
  /** Display name (from the item cache at add time; re-rendered from cache when present). */
  readonly itemName: string;
  readonly qty: string;
  readonly unitPrice: string;
  readonly discountAmount: string | null;
  readonly taxCodeId: string | null;
  /** Row 35 capture: one serial per unit for serial/IMEI-tracked items. */
  readonly serialIds: readonly string[];
  /** Row 35 capture: the batch for batch-tracked items. */
  readonly batchId: string | null;
  /** Tracking flags (from the item cache at add time). */
  readonly trackedSerial: boolean;
  readonly trackedBatch: boolean;
}

/** The cart value: customer + payment posture + lines. */
export interface VanSaleCart {
  readonly customerId: string | null;
  readonly customerName: string | null;
  /** CASH = walk-in (customerId null); CREDIT = on-account (customer required). */
  readonly payment: "CASH" | "CREDIT";
  readonly lines: readonly VanSaleCartLine[];
}

/** The empty cart. */
export function emptyVanSaleCart(payment: "CASH" | "CREDIT" = "CASH"): VanSaleCart {
  return { customerId: null, customerName: null, payment, lines: [] };
}

/** A cart line's net (qty × price − discount, Decimal — ADR-0009). */
export function vanSaleLineNet(line: VanSaleCartLine): string {
  const net = new Decimal(line.qty)
    .times(new Decimal(line.unitPrice))
    .minus(new Decimal(line.discountAmount ?? "0"));
  return net.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** The cart's gross total (the checkout banner). */
export function vanSaleCartTotal(cart: VanSaleCart): string {
  let total = new Decimal(0);
  for (const line of cart.lines) {
    total = total.plus(new Decimal(vanSaleLineNet(line)));
  }
  return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** Resolve the item snapshot for a line (display + tracking flags, fresh read). */
export function cartLineItem(adapter: StorageAdapter, line: VanSaleCartLine): ItemSnapshot | undefined {
  return readItem(adapter, line.itemId);
}

/**
 * Scan/resolve one item into the cart: resolves the barcode (or takes the
 * item id directly), merges into an existing line for the same item (qty
 * adds), prices from the partner's cached tier price (or the item's base
 * price) — the LOCAL-VALID† price the tolerance advisory later compares
 * against. Returns the unchanged cart when the code resolves to nothing
 * (the screen then surfaces countUnknownBarcode).
 */
export function addItemToCart(
  adapter: StorageAdapter,
  cart: VanSaleCart,
  input: { code?: string; itemId?: string; qty?: string },
): VanSaleCart {
  let item: ItemSnapshot | undefined;
  if (input.itemId !== undefined) {
    item = readItem(adapter, input.itemId);
  } else if (input.code !== undefined) {
    item = resolveBarcodeItem(adapter, input.code);
  }
  if (item === undefined) return cart;
  const qty = input.qty !== undefined && /^-?\d+(\.\d+)?$/.test(input.qty) ? input.qty : "1";
  const price = readCachedUnitPrice(adapter, cart.customerId, item.id) ?? item.basePrice ?? "0";
  const existing = cart.lines.findIndex((line) => line.itemId === item!.id);
  if (existing >= 0) {
    const prior = cart.lines[existing]!;
    const merged: VanSaleCartLine = {
      ...prior,
      qty: new Decimal(prior.qty).plus(new Decimal(qty)).toFixed(6),
    };
    const lines = [...cart.lines];
    lines[existing] = merged;
    return { ...cart, lines };
  }
  const line: VanSaleCartLine = {
    itemId: item.id,
    itemName: item.name,
    qty,
    unitPrice: price,
    discountAmount: null,
    taxCodeId: null,
    serialIds: [],
    batchId: null,
    trackedSerial: item.trackSerial || item.trackImei,
    trackedBatch: item.trackBatch,
  };
  return { ...cart, lines: [...cart.lines, line] };
}

/** Set a line's qty (string in; unparseable input keeps the prior value). */
export function setCartLineQty(cart: VanSaleCart, itemId: string, qty: string): VanSaleCart {
  return updateLine(cart, itemId, (line) =>
    /^-?\d+(\.\d+)?$/.test(qty) ? { ...line, qty } : line,
  );
}

/** Set a line's unit price (unparseable input keeps the prior value). */
export function setCartLinePrice(cart: VanSaleCart, itemId: string, unitPrice: string): VanSaleCart {
  return updateLine(cart, itemId, (line) =>
    /^\d+(\.\d+)?$/.test(unitPrice) ? { ...line, unitPrice } : line,
  );
}

/** Append one serial to a line's row-35 capture (deduped — a duplicate is
 * the SERIAL_REUSE advisory's territory, but a same-line repeat is noise). */
export function addCartLineSerial(cart: VanSaleCart, itemId: string, serial: string): VanSaleCart {
  const trimmed = serial.trim();
  if (trimmed === "") return cart;
  return updateLine(cart, itemId, (line) =>
    line.serialIds.includes(trimmed) ? line : { ...line, serialIds: [...line.serialIds, trimmed] },
  );
}

/** Set a line's batch (row 35 batch capture). */
export function setCartLineBatch(cart: VanSaleCart, itemId: string, batchId: string): VanSaleCart {
  return updateLine(cart, itemId, (line) => ({ ...line, batchId: batchId.trim() === "" ? null : batchId.trim() }));
}

/** Remove a line. */
export function removeCartLine(cart: VanSaleCart, itemId: string): VanSaleCart {
  return { ...cart, lines: cart.lines.filter((line) => line.itemId !== itemId) };
}

/** Point the cart at a customer (the route visit's partner). */
export function setCartCustomer(cart: VanSaleCart, customerId: string | null, customerName: string | null): VanSaleCart {
  return { ...cart, customerId, customerName };
}

/** Switch the payment posture (CASH clears the customer — a walk-in sale). */
export function setCartPayment(cart: VanSaleCart, payment: "CASH" | "CREDIT"): VanSaleCart {
  return payment === "CASH" ? { ...cart, payment, customerId: null, customerName: null } : { ...cart, payment };
}

function updateLine(
  cart: VanSaleCart,
  itemId: string,
  update: (line: VanSaleCartLine) => VanSaleCartLine,
): VanSaleCart {
  const lines = cart.lines.map((line) => (line.itemId === itemId ? update(line) : line));
  return { ...cart, lines };
}

// -- pre-validation (the two-lane LOCAL-VALID† surface) -------------------------------

/** The cart as a pre-validation capture. */
export function vanSaleCapture(cart: VanSaleCart, ctx: FieldFlowContext): Parameters<typeof prevalidateVanSale>[1] {
  return {
    customerId: cart.customerId,
    payment: cart.payment,
    vanWarehouseId: ctx.vanWarehouseId ?? null,
    lines: cart.lines.map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      serialIds: line.serialIds,
    })),
  };
}

/** Pre-validate the cart (advisories render as warnings; blocking refuses the save). */
export function validateVanSaleCart(
  adapter: StorageAdapter,
  cart: VanSaleCart,
  ctx: FieldFlowContext,
): PrevalidationResult {
  return prevalidateVanSale(adapter, vanSaleCapture(cart, ctx));
}

// -- the save (command build + atomic enqueue) -----------------------------------------

/** The van-sale save outcome (advisories ride along for the result banner). */
export interface VanSaleSaveResult {
  readonly ok: boolean;
  readonly commandId?: string;
  readonly localRef?: string;
  readonly state?: HonestFlowState;
  readonly advisories: readonly PrevalidationIssue[];
  readonly blocking: readonly PrevalidationIssue[];
}

/**
 * Build the `sales_invoice:create_draft` payload from the cart (pure — the
 * zod-parse proof in the test suite runs against this output).
 *
 * Row 35 additive capture: `serialIds`/`batchId` attach to the line objects
 * ONLY when captured (the deviation-1 gap: the server's current contract
 * strips them — the outbox payload keeps the capture as the local record).
 */
export function buildVanSalePayload(
  cart: VanSaleCart,
  ctx: FieldFlowContext,
): DraftInvoiceCreatePayload & {
  lines: (DraftInvoiceCreatePayload["lines"][number] & {
    serialIds?: readonly string[];
    batchId?: string | null;
  })[];
} {
  const customerId = cart.payment === "CASH" ? null : cart.customerId;
  return {
    customerId,
    orderDate: contextToday(ctx),
    lines: cart.lines.map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      ...(line.discountAmount !== null ? { discountAmount: line.discountAmount } : {}),
      ...(line.taxCodeId !== null ? { taxCodeId: line.taxCodeId } : {}),
      ...(line.serialIds.length > 0 ? { serialIds: [...line.serialIds] } : {}),
      ...(line.batchId !== null ? { batchId: line.batchId } : {}),
    })),
  };
}

/**
 * Save the van sale: LOCAL-VALID† gate first (structural blocking refuses —
 * nothing is enqueued), then ONE transaction (offline number + command
 * build + enqueue — atomic local capture). The command envelope comes from
 * sync-core's `buildDraftInvoiceCreate`, UNMODIFIED reuse.
 */
export function saveVanSale(
  adapter: StorageAdapter,
  ctx: FieldFlowContext,
  cart: VanSaleCart,
  uuid: () => string = generateUuidV7,
): VanSaleSaveResult {
  const validation = validateVanSaleCart(adapter, cart, ctx);
  if (validation.blocking.length > 0) {
    return { ok: false, advisories: validation.advisories, blocking: validation.blocking };
  }
  const payload = buildVanSalePayload(cart, ctx);
  const saved = adapter.transaction(() => {
    const localRef = nextOfflineNumber(adapter, ctx.deviceCode, ctx.deviceId);
    const command = buildDraftInvoiceCreate(payload as DraftInvoiceCreatePayload, uuid);
    enqueue(adapter, {
      entityType: command.entityType,
      intent: command.intent,
      payload: command.payload as Record<string, unknown>,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      localRef,
    });
    return { commandId: command.commandId, localRef };
  });
  return {
    ok: true,
    commandId: saved.commandId,
    localRef: saved.localRef,
    state: "PENDING_SYNC",
    advisories: validation.advisories,
    blocking: [],
  };
}

// -- the document view (honest state per command) --------------------------------------

/** One saved van sale's honest-state view (the saved-documents list row). */
export interface VanSaleDocumentView {
  readonly commandId: string;
  readonly localRef: string | null;
  readonly state: HonestFlowState;
  readonly officialNo: string | null;
  readonly customerName: string | null;
  readonly total: string;
  readonly savedAt: string;
}

/** The van-sale document view for one command id. */
export function vanSaleDocument(
  adapter: StorageAdapter,
  commandId: string,
): VanSaleDocumentView | undefined {
  const row = flowRowByCommandId(adapter, commandId);
  if (row === undefined) return undefined;
  let payload: { customerId?: string | null; lines?: { qty?: string; unitPrice?: string; discountAmount?: string | null }[] } = {};
  try {
    payload = JSON.parse(row.payload) as typeof payload;
  } catch {
    payload = {};
  }
  let total = new Decimal(0);
  for (const line of payload.lines ?? []) {
    if (line.qty !== undefined && line.unitPrice !== undefined) {
      total = total.plus(
        new Decimal(line.qty).times(new Decimal(line.unitPrice)).minus(new Decimal(line.discountAmount ?? "0")),
      );
    }
  }
  const partner =
    payload.customerId !== undefined && payload.customerId !== null
      ? readPartner(adapter, payload.customerId)
      : undefined;
  return {
    commandId: row.commandId,
    localRef: row.localRef,
    state: flowStateFromRow(row),
    officialNo: row.officialNo,
    customerName: partner?.name ?? null,
    total: total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    savedAt: row.clientCreatedAt,
  };
}

/** The device's current offline sequence (diagnostics/UX — no advance). */
export function vanSaleOfflineSeq(adapter: StorageAdapter, ctx: FieldFlowContext): number {
  return currentOfflineSeq(adapter, ctx.deviceId);
}

/** The command envelope type this flow builds (re-exported for tests/3-b). */
export type VanSaleCommandEnvelope = SyncCommandV2Envelope;
