/**
 * PHASE-022 T-P22-2-e · the van load/unload confirmation flow (MASTER-PLAN
 * §8 — BINDING; OFFLINE_CAPABILITIES_MATRIX row 12 android-field
 * **OFFLINE-COMPLETE** "against van snapshot"; CONFLICT_RESOLUTION §2 "Van
 * stock load/unload" SERVER_DECISION — "Van movements replay against the
 * current van ledger; server rejects double-loads or unloads beyond the
 * current van quantity with INSUFFICIENT_STOCK").
 *
 * The machine: `PENDING_SYNC → POSTED | REJECTED(editable)` for BOTH
 * commands —
 *
 *   `van:confirm_load`   the rep confirms an ALREADY-DISPATCHED load
 *                        transfer landed in the van. The transfer IS the
 *                        load document (its lines are the load — created +
 *                        dispatched online by the warehouse); the device
 *                        only confirms, so the payload carries the transfer
 *                        reference + the advisory moment. A double-confirm
 *                        (already POSTED) rejects STALE_VERSION; a
 *                        not-yet-dispatched transfer rejects
 *                        VALIDATION_ERROR (the 2-c handler contract).
 *
 *   `van:confirm_unload` the end-of-day return — lines of {itemId, qty}
 *                        against the CACHED van snapshot, one line per item
 *                        (the transfer service's uniqueness rule), qty in
 *                        the item's base unit (batches/slices resolve
 *                        server-side, FEFO). Unload beyond the current van
 *                        quantity rejects INSUFFICIENT_STOCK with
 *                        machine-readable `availableQty`; the CLIENT-side
 *                        check is the same ADVISORY posture as every
 *                        LOCAL-VALID† rule (never blocks — the van ledger
 *                        is server-authoritative).
 *
 * The confirmation screens show SNAPSHOT AS-OF labels: the cached van
 * mirror's newest `refreshedAt` stamp ({@link vanSnapshotAsOf}) — stale is
 * labeled, never guessed (asOfLabel/asOfNeverSynced).
 */
import { generateUuidV7, Decimal } from "@erp/domain-core";
import type { VanConfirmLoadPayload, VanConfirmUnloadPayload } from "@erp/contracts";
import {
  buildSyncCommandV2,
  enqueue,
  nextOfflineNumber,
  type StorageAdapter,
} from "@erp/sync-core";

import {
  patterns,
  readVanStockLines,
  readVanStockQty,
  vanSnapshotAsOf,
  type PrevalidationIssue,
  type PrevalidationResult,
  type VanStockLine,
} from "./prevalidation";
import {
  contextToday,
  flowRowByCommandId,
  flowStateFromRow,
  type FieldFlowContext,
  type HonestFlowState,
} from "./state-machine";

// -- van load (confirm an IN_TRANSIT transfer landed) --------------------------------

/** The van-load confirmation capture. */
export interface VanLoadInput {
  /** The load document: the IN_TRANSIT stock transfer delivering to the van. */
  readonly transferId: string;
  /** The advisory capture moment (ISO timestamp; the server clock is final). */
  readonly confirmedAt?: string | null;
}

/** The load/unload shared save outcome. */
export interface VanMovementSaveResult {
  readonly ok: boolean;
  readonly commandId?: string;
  readonly localRef?: string;
  readonly state?: HonestFlowState;
  readonly advisories: readonly PrevalidationIssue[];
  readonly blocking: readonly PrevalidationIssue[];
}

/** Build the `van:confirm_load` payload (pure — zod-parse proof target). */
export function buildVanLoadPayload(input: VanLoadInput): VanConfirmLoadPayload {
  const payload: VanConfirmLoadPayload = { transferId: input.transferId };
  if (input.confirmedAt !== undefined && input.confirmedAt !== null) {
    payload.confirmedAt = input.confirmedAt;
  }
  return payload;
}

/** Structural gate for the load confirmation (a malformed transfer ref blocks). */
export function validateVanLoad(input: VanLoadInput): PrevalidationResult {
  const blocking: PrevalidationIssue[] = [];
  if (!patterns.isUuid(input.transferId)) {
    blocking.push({ code: "MALFORMED_ID", messageKey: "commonRequired", context: {} });
  }
  return { advisories: [], blocking };
}

/**
 * Save the load confirmation: ONE transaction (offline number + the
 * sync-core `buildSyncCommandV2` envelope + enqueue). PENDING_SYNC until
 * the server ACCEPTED (the van mirror + the IN leg post at sync).
 */
export function saveVanLoadConfirmation(
  adapter: StorageAdapter,
  ctx: FieldFlowContext,
  input: VanLoadInput,
  uuid: () => string = generateUuidV7,
): VanMovementSaveResult {
  const validation = validateVanLoad(input);
  if (validation.blocking.length > 0) {
    return { ok: false, advisories: validation.advisories, blocking: validation.blocking };
  }
  const payload = buildVanLoadPayload(input);
  const saved = adapter.transaction(() => {
    const localRef = nextOfflineNumber(adapter, ctx.deviceCode, ctx.deviceId);
    const command = buildSyncCommandV2(
      {
        entityType: "van",
        intent: "confirm_load",
        payload,
        idempotencyKey: `van:confirm_load:${uuid()}`,
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
    advisories: [],
    blocking: [],
  };
}

// -- van unload (the end-of-day return against the cached snapshot) ------------------

/** One unload line: {itemId, qty} — one line per item (the service's rule). */
export interface VanUnloadLineInput {
  readonly itemId: string;
  readonly qty: string;
}

/** The van-unload confirmation capture. */
export interface VanUnloadInput {
  readonly vanWarehouseId: string;
  readonly toWarehouseId: string;
  readonly lines: readonly VanUnloadLineInput[];
  readonly note?: string | null;
  readonly noteAr?: string | null;
  readonly confirmedAt?: string | null;
}

/** Build the `van:confirm_unload` payload (pure — zod-parse proof target). */
export function buildVanUnloadPayload(input: VanUnloadInput): VanConfirmUnloadPayload {
  const payload: VanConfirmUnloadPayload = {
    vanWarehouseId: input.vanWarehouseId,
    toWarehouseId: input.toWarehouseId,
    lines: input.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
  };
  if (input.note !== undefined && input.note !== null) payload.note = input.note;
  if (input.noteAr !== undefined && input.noteAr !== null) payload.noteAr = input.noteAr;
  if (input.confirmedAt !== undefined && input.confirmedAt !== null) {
    payload.confirmedAt = input.confirmedAt;
  }
  return payload;
}

/**
 * Validate the unload: structural blocking (empty lines / malformed qty /
 * malformed ids / a repeated item — the service's one-line-per-item rule)
 * + the VAN_STOCK_LOW advisory (qty beyond the CACHED van snapshot — never
 * blocks; the server's INSUFFICIENT_STOCK with machine-readable
 * `availableQty` decides).
 */
export function validateVanUnload(
  adapter: StorageAdapter,
  input: VanUnloadInput,
): PrevalidationResult {
  const advisories: PrevalidationIssue[] = [];
  const blocking: PrevalidationIssue[] = [];
  if (!patterns.isUuid(input.vanWarehouseId) || !patterns.isUuid(input.toWarehouseId)) {
    blocking.push({ code: "MALFORMED_ID", messageKey: "commonRequired", context: {} });
  }
  if (input.lines.length === 0) {
    blocking.push({ code: "MISSING_ITEM", messageKey: "vanLoadEmpty", context: {} });
  }
  const seenItems = new Set<string>();
  for (const [index, line] of input.lines.entries()) {
    const lineNo = index + 1;
    if (!patterns.isUuid(line.itemId)) {
      blocking.push({ code: "MISSING_ITEM", messageKey: "commonRequired", context: {}, line: lineNo });
      continue;
    }
    if (seenItems.has(line.itemId)) {
      blocking.push({ code: "MISSING_ITEM", messageKey: "commonRequired", context: {}, line: lineNo });
      continue;
    }
    seenItems.add(line.itemId);
    if (!patterns.isQty(line.qty) || new Decimal(line.qty).lessThanOrEqualTo(0)) {
      blocking.push({ code: "ZERO_QTY", messageKey: "vanSaleQtyInvalid", context: {}, line: lineNo });
      continue;
    }
    const available = readVanStockQty(adapter, input.vanWarehouseId, line.itemId);
    if (new Decimal(line.qty).greaterThan(new Decimal(available))) {
      advisories.push({
        code: "VAN_STOCK_LOW",
        messageKey: "vanUnloadQtyExceedsStock",
        context: { requested: line.qty, available },
        line: lineNo,
      });
    }
  }
  return { advisories, blocking };
}

/**
 * Save the unload confirmation: structural gate, then ONE transaction
 * (offline number + the sync-core envelope + enqueue). PENDING_SYNC until
 * the server ACCEPTED (the OUT leg + the van mirror refresh post at sync).
 */
export function saveVanUnloadConfirmation(
  adapter: StorageAdapter,
  ctx: FieldFlowContext,
  input: VanUnloadInput,
  uuid: () => string = generateUuidV7,
): VanMovementSaveResult {
  const validation = validateVanUnload(adapter, input);
  if (validation.blocking.length > 0) {
    return { ok: false, advisories: validation.advisories, blocking: validation.blocking };
  }
  const payload = buildVanUnloadPayload(input);
  const saved = adapter.transaction(() => {
    const localRef = nextOfflineNumber(adapter, ctx.deviceCode, ctx.deviceId);
    const command = buildSyncCommandV2(
      {
        entityType: "van",
        intent: "confirm_unload",
        payload,
        idempotencyKey: `van:confirm_unload:${uuid()}`,
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

// -- the snapshot view (the confirmation screens' cached context) ---------------------

/** The van snapshot view: the cached lines + the honest as-of stamp. */
export interface VanSnapshotView {
  readonly vanWarehouseId: string;
  readonly lines: readonly VanStockLine[];
  /** The newest refreshedAt across the van's rows (null → never synced). */
  readonly asOf: string | null;
}

/**
 * The cached van snapshot for a warehouse (the unload picker's item source
 * + the load screen's context). READ-CACHED with the as-of label — the
 * mirror is the PHASE-017 server-side projection, never client-computed.
 */
export function vanSnapshot(adapter: StorageAdapter, vanWarehouseId: string): VanSnapshotView {
  return {
    vanWarehouseId,
    lines: readVanStockLines(adapter, vanWarehouseId),
    asOf: vanSnapshotAsOf(adapter, vanWarehouseId),
  };
}

// -- the document views (honest state per command) ------------------------------------

/** One saved van movement's honest-state view. */
export interface VanMovementDocumentView {
  readonly commandId: string;
  readonly intent: "confirm_load" | "confirm_unload";
  readonly localRef: string | null;
  readonly state: HonestFlowState;
  readonly officialNo: string | null;
  readonly savedAt: string;
}

/** The movement document view for one command id. */
export function vanMovementDocument(
  adapter: StorageAdapter,
  commandId: string,
): VanMovementDocumentView | undefined {
  const row = flowRowByCommandId(adapter, commandId);
  if (row === undefined) return undefined;
  return {
    commandId: row.commandId,
    intent: row.intent === "confirm_unload" ? "confirm_unload" : "confirm_load",
    localRef: row.localRef,
    state: flowStateFromRow(row),
    officialNo: row.officialNo,
    savedAt: row.clientCreatedAt,
  };
}

/** The context's resolved business date, re-exported for the screens. */
export { contextToday };
