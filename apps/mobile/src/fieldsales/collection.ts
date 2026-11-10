/**
 * PHASE-022 T-P22-2-e · the field collection receipt flow (MASTER-PLAN §8 —
 * BINDING; OFFLINE_CAPABILITIES_MATRIX row 9 android-field
 * **OFFLINE-COMPLETE**; CONFLICT_RESOLUTION §2 financial documents
 * SERVER_DECISION — never LWW).
 *
 * The machine: `PENDING_SYNC → POSTED | REJECTED(editable)` — the receipt
 * is captured fully offline, queued as the `receipt:create_field_collection`
 * command (the DR-P22-06 intent; payload schema
 * `receiptCreateFieldCollectionPayloadSchema` in @erp/contracts — the 2-c
 * landed contract), and POSTS AT SYNC through the treasury
 * ReceiptService create→post chain (the official RCV number + the journal
 * exist only after the server ACCEPTED — state honesty §5).
 *
 * The collection payload mirrors ReceiptService.create's input: `valueDate`
 * is the SERVER-FINAL business date (period locks ride it); `collectedAt`
 * is the advisory capture moment; the optional `allocations` settle
 * specific open items (INV-016/BR-027) — omitted, the receipt posts fully
 * on-account (the field default). The rep attribution is server-stamped
 * (`created_by` = the device user + the device audit event — the 2-c
 * deviation-2 record: receipts carry no rep column; the field rep IS the
 * device user).
 *
 * HONEST GAP (this task's deviation 2): the auto-allocation PLAN runs
 * oldest-first over the cached statement entries (the collection screen's
 * display), but the entries' `docRef` is a document NUMBER — the statements
 * LITE projection carries no `openItemId` uuid, so a device-built
 * allocation set cannot be expressed on the wire. The flow therefore
 * accepts explicit `{openItemId, amount}` allocations (a caller that knows
 * the ids — e.g. a future open-items feed or a scanned invoice QR) and
 * otherwise posts on-account (BR-027's explicit unallocated remainder — a
 * legitimate business path, never a blocker).
 */
import { generateUuidV7 } from "@erp/domain-core";
import type { ReceiptCreateFieldCollectionPayload } from "@erp/contracts";
import {
  buildSyncCommandV2,
  enqueue,
  nextOfflineNumber,
  type StorageAdapter,
} from "@erp/sync-core";

import { Decimal } from "@erp/domain-core";
import {
  prevalidateCollection,
  readStatement,
  type PrevalidationIssue,
  type PrevalidationResult,
} from "./prevalidation";
import {
  contextToday,
  flowRowByCommandId,
  flowStateFromRow,
  type FieldFlowContext,
  type HonestFlowState,
} from "./state-machine";

/** The collection methods the field app offers (the contract enum). */
export type CollectionMethod = ReceiptCreateFieldCollectionPayload["method"];

/** One explicit open-item allocation (the caller must know the openItemId). */
export interface CollectionAllocationInput {
  readonly openItemId: string;
  readonly amount: string;
}

/** The field collection capture. */
export interface FieldCollectionInput {
  readonly partnerId: string;
  /** Defaults to the context's cash account (the rep's configured account). */
  readonly cashAccountId?: string;
  readonly method: CollectionMethod;
  /** Defaults to the context's tenant base currency (advisory; server-final). */
  readonly currencyCode?: string;
  readonly amount: string;
  /** ISO date — defaults to the context today (the SERVER-final business date). */
  readonly valueDate?: string;
  readonly reference?: string | null;
  readonly payerName?: string | null;
  readonly description?: string | null;
  readonly descriptionAr?: string | null;
  /** The advisory capture moment (audit provenance only). */
  readonly collectedAt?: string | null;
  readonly allocations?: readonly CollectionAllocationInput[];
}

/** The collection save outcome (advisories ride along for the result banner). */
export interface CollectionSaveResult {
  readonly ok: boolean;
  readonly commandId?: string;
  readonly localRef?: string;
  readonly state?: HonestFlowState;
  readonly advisories: readonly PrevalidationIssue[];
  readonly blocking: readonly PrevalidationIssue[];
}

/**
 * Build the `receipt:create_field_collection` payload (pure — the zod-parse
 * proof in the test suite runs against this output; money TEXT canonical
 * decimal strings, ADR-0009).
 */
export function buildCollectionPayload(
  ctx: FieldFlowContext,
  input: FieldCollectionInput,
): ReceiptCreateFieldCollectionPayload {
  const valueDate = input.valueDate ?? contextToday(ctx);
  const currencyCode = input.currencyCode ?? ctx.currencyCode ?? "SAR";
  const cashAccountId = input.cashAccountId ?? ctx.cashAccountId ?? "";
  const payload: ReceiptCreateFieldCollectionPayload = {
    partnerId: input.partnerId,
    cashAccountId,
    method: input.method,
    currencyCode,
    amount: input.amount,
    valueDate,
    ...(input.collectedAt !== undefined ? { collectedAt: input.collectedAt } : {}),
    ...(input.reference !== undefined && input.reference !== null ? { reference: input.reference } : {}),
    ...(input.payerName !== undefined && input.payerName !== null ? { payerName: input.payerName } : {}),
    ...(input.description !== undefined && input.description !== null ? { description: input.description } : {}),
    ...(input.descriptionAr !== undefined && input.descriptionAr !== null ? { descriptionAr: input.descriptionAr } : {}),
  };
  if (input.allocations !== undefined && input.allocations.length > 0) {
    payload.allocations = input.allocations.map((allocation) => ({
      openItemId: allocation.openItemId,
      amount: allocation.amount,
    }));
  }
  return payload;
}

/** Pre-validate the collection (row 9: structural blocking + the BR-027
 * on-account ADVISORY — the credit limit and the period are the server's). */
export function validateCollection(
  adapter: StorageAdapter,
  ctx: FieldFlowContext,
  input: FieldCollectionInput,
): PrevalidationResult {
  return prevalidateCollection(adapter, {
    partnerId: input.partnerId,
    cashAccountId: input.cashAccountId ?? ctx.cashAccountId ?? "",
    amount: input.amount,
    valueDate: input.valueDate ?? contextToday(ctx),
  });
}

/**
 * Save the field collection: structural gate first (blocking refuses —
 * nothing is enqueued), then ONE transaction (offline number + the
 * sync-core `buildSyncCommandV2` envelope + enqueue — atomic local
 * capture). The command is QUEUED (PENDING_SYNC); the official RCV number
 * appears only after the server ACCEPTED.
 */
export function saveFieldCollection(
  adapter: StorageAdapter,
  ctx: FieldFlowContext,
  input: FieldCollectionInput,
  uuid: () => string = generateUuidV7,
): CollectionSaveResult {
  const validation = validateCollection(adapter, ctx, input);
  if (validation.blocking.length > 0) {
    return { ok: false, advisories: validation.advisories, blocking: validation.blocking };
  }
  const payload = buildCollectionPayload(ctx, input);
  const saved = adapter.transaction(() => {
    const localRef = nextOfflineNumber(adapter, ctx.deviceCode, ctx.deviceId);
    const command = buildSyncCommandV2(
      {
        entityType: "receipt",
        intent: "create_field_collection",
        payload,
        idempotencyKey: `receipt:create_field_collection:${uuid()}`,
      },
      uuid,
    );
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

// -- the oldest-first allocation plan (display — the deviation-2 record) --------------

/** One planned allocation slice against a cached open item. */
export interface AllocationPlanRow {
  /** The open item's document reference (the statement entry's docRef). */
  readonly docRef: string | null;
  /** The entry date (the oldest-first ordering key). */
  readonly entryDate: string;
  /** The planned slice (never more than the outstanding). */
  readonly amount: string;
  /** The outstanding BEFORE this slice. */
  readonly outstanding: string;
  /** The openItemId when the caller can supply one (null — the LITE gap). */
  readonly openItemId: string | null;
}

/** The oldest-first allocation plan over the cached statement entries. */
export interface AllocationPlan {
  readonly rows: readonly AllocationPlanRow[];
  /** The amount the plan could not place (on-account remainder, BR-027). */
  readonly unallocated: string;
  /** The total placed. */
  readonly allocated: string;
}

/**
 * Plan an allocation oldest-first over the partner's CACHED open invoice
 * entries (the collection screen's "auto-allocate — oldest first" display).
 *
 * HONEST SCOPE (deviation 2): the statements LITE projection carries
 * `docRef` (a document number) but no `openItemId` uuid, so every row's
 * `openItemId` is null — the plan is DISPLAY-ONLY; the wire allocations
 * need a caller that knows the uuids (explicit
 * {@link FieldCollectionInput.allocations}). The unallocated remainder is
 * BR-027's explicit on-account path, never a blocker.
 */
export function planAllocationOldestFirst(
  adapter: StorageAdapter,
  partnerId: string,
  amount: string,
): AllocationPlan {
  const statement = readStatement(adapter, partnerId);
  const rows: AllocationPlanRow[] = [];
  if (statement === undefined || !/^-?\d+(\.\d+)?$/.test(amount)) {
    return { rows, unallocated: amount, allocated: "0.0000" };
  }
  let remaining = new Decimal(amount);
  let placed = new Decimal(0);
  const open = statement.entries
    .filter((entry) => entry.sourceType === "sales_invoice" && new Decimal(entry.outstanding).greaterThan(0))
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  for (const entry of open) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const outstanding = new Decimal(entry.outstanding);
    const slice = Decimal.min(remaining, outstanding);
    rows.push({
      docRef: entry.docRef,
      entryDate: entry.entryDate,
      amount: slice.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      outstanding: entry.outstanding,
      openItemId: null,
    });
    remaining = remaining.minus(slice);
    placed = placed.plus(slice);
  }
  return {
    rows,
    unallocated: remaining.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    allocated: placed.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
  };
}

// -- the document view (honest state per command) --------------------------------------

/** One saved collection's honest-state view. */
export interface CollectionDocumentView {
  readonly commandId: string;
  readonly localRef: string | null;
  readonly state: HonestFlowState;
  readonly officialNo: string | null;
  readonly partnerId: string;
  readonly amount: string;
  readonly method: string;
  readonly savedAt: string;
}

/** The collection document view for one command id. */
export function collectionDocument(
  adapter: StorageAdapter,
  commandId: string,
): CollectionDocumentView | undefined {
  const row = flowRowByCommandId(adapter, commandId);
  if (row === undefined) return undefined;
  let payload: { partnerId?: string; amount?: string; method?: string } = {};
  try {
    payload = JSON.parse(row.payload) as typeof payload;
  } catch {
    payload = {};
  }
  return {
    commandId: row.commandId,
    localRef: row.localRef,
    state: flowStateFromRow(row),
    officialNo: row.officialNo,
    partnerId: String(payload.partnerId ?? ""),
    amount: String(payload.amount ?? "0"),
    method: String(payload.method ?? "CASH"),
    savedAt: row.clientCreatedAt,
  };
}
