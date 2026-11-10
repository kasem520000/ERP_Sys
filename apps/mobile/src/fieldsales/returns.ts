/**
 * PHASE-022 T-P22-2-e · the van-return credit-note draft flow (MASTER-PLAN
 * §8 — BINDING; OFFLINE_CAPABILITIES_MATRIX row 27 android-field
 * **OFFLINE-DRAFT**; CONFLICT_RESOLUTION §2 drafts OWNER_DEVICE_WINS).
 *
 * The machine: `DRAFT_LOCAL → DRAFT` — the return is captured offline as a
 * DRAFT credit note through the `credit_note:create_draft` command (the
 * DR-P22-06 intent; payload schema `creditNoteCreateDraftPayloadSchema` —
 * the 2-c landed contract), NO posting (posting is online-only — the §12
 * ONLINE-ONLY rule). An ACKED command means the server created the DRAFT;
 * the submit/approve/post lifecycle stays online.
 *
 * The payload mirrors CreditNoteService.create's REAL input (the 2-c
 * deviation-1 record): `invoiceId` is REQUIRED and must reference a POSTED
 * invoice (BR-004 return window, INV-016 outstanding bound); lines key by
 * `invoiceLineId` (the server derives the item, the original price, the
 * tax snapshot and the W-3 issue-cost re-entry value from it — never
 * trusted from the device); `returnToStock` is the per-line stock-re-entry
 * flag; `batchId`/`serialIds` carry the row-35 capture (wire-complete on
 * THIS intent — the contract has the fields).
 *
 * HONEST SCOPE NOTE (deviation 3): the field feed group carries no
 * `sales_invoices` entity (FEED_GROUPS.field — DR-P22-05), so the device's
 * caches hold no invoice-line catalogue: the original-invoice reference and
 * its line ids arrive as CAPTURE INPUTS (the printed invoice's QR/manual
 * entry — the screen offers the fields; the flow validates structure only:
 * uuids, positive qty, non-empty lines). The server re-validates the
 * reference against the real invoice (BR-004) — a wrong reference rejects
 * VALIDATION_ERROR, honestly.
 *
 * The restock destination (returnsRestockVan / returnsRestockWarehouse —
 * the screen's picker): the wire contract carries only the per-line
 * `returnToStock` BOOLEAN — the van-vs-warehouse re-entry destination is
 * resolved SERVER-side at posting (the W-3 re-entry). The picker therefore
 * expresses the rep's intent for the LOCAL record and maps to the boolean;
 * the destination beyond it is not client-decidable (recorded in the
 * module header — the screen renders the same honesty note).
 */
import { generateUuidV7, Decimal } from "@erp/domain-core";
import type { CreditNoteCreateDraftPayload } from "@erp/contracts";
import {
  buildSyncCommandV2,
  enqueue,
  nextOfflineNumber,
  type StorageAdapter,
} from "@erp/sync-core";

import { patterns, type PrevalidationIssue, type PrevalidationResult } from "./prevalidation";
import {
  contextToday,
  flowRowByCommandId,
  flowStateFromRow,
  type FieldFlowContext,
  type HonestFlowState,
} from "./state-machine";

/** One return line (keyed by the ORIGINAL invoice's own line). */
export interface ReturnLineInput {
  /** The POSTED invoice's line id (the server derives item/price/tax from it). */
  readonly invoiceLineId: string;
  readonly qty: string;
  /** The per-line stock re-entry flag (van-vs-warehouse is server-resolved). */
  readonly returnToStock: boolean;
  /** Row 35 capture — wire-complete on this intent. */
  readonly batchId?: string | null;
  readonly serialIds?: readonly string[];
  readonly unitPrice?: string | null;
  readonly discountAmount?: string | null;
  readonly taxCodeId?: string | null;
  readonly description?: string | null;
  readonly note?: string | null;
}

/** The return capture. */
export interface ReturnDraftInput {
  /** The ORIGINAL POSTED invoice (REQUIRED — BR-004). */
  readonly invoiceId: string;
  /** ISO date — defaults to the context today. */
  readonly noteDate?: string;
  readonly note?: string | null;
  readonly noteAr?: string | null;
  readonly lines: readonly ReturnLineInput[];
}

/** The return save outcome (advisories ride along for the result banner). */
export interface ReturnSaveResult {
  readonly ok: boolean;
  readonly commandId?: string;
  readonly localRef?: string;
  readonly state?: HonestFlowState;
  readonly advisories: readonly PrevalidationIssue[];
  readonly blocking: readonly PrevalidationIssue[];
}

/** Build the `credit_note:create_draft` payload (pure — zod-parse proof target). */
export function buildReturnPayload(
  ctx: FieldFlowContext,
  input: ReturnDraftInput,
): CreditNoteCreateDraftPayload {
  const payload: CreditNoteCreateDraftPayload = {
    invoiceId: input.invoiceId,
    noteDate: input.noteDate ?? contextToday(ctx),
    lines: input.lines.map((line) => ({
      invoiceLineId: line.invoiceLineId,
      qty: line.qty,
      returnToStock: line.returnToStock,
      ...(line.unitPrice !== undefined && line.unitPrice !== null ? { unitPrice: line.unitPrice } : {}),
      ...(line.discountAmount !== undefined && line.discountAmount !== null
        ? { discountAmount: line.discountAmount }
        : {}),
      ...(line.taxCodeId !== undefined && line.taxCodeId !== null ? { taxCodeId: line.taxCodeId } : {}),
      ...(line.batchId !== undefined && line.batchId !== null ? { batchId: line.batchId } : {}),
      ...(line.serialIds !== undefined && line.serialIds.length > 0 ? { serialIds: [...line.serialIds] } : {}),
      ...(line.description !== undefined && line.description !== null ? { description: line.description } : {}),
      ...(line.note !== undefined && line.note !== null ? { note: line.note } : {}),
    })),
  };
  if (input.note !== undefined && input.note !== null) payload.note = input.note;
  if (input.noteAr !== undefined && input.noteAr !== null) payload.noteAr = input.noteAr;
  return payload;
}

/** Structural gate: the original invoice reference, the line set, the shapes. */
export function validateReturnDraft(input: ReturnDraftInput): PrevalidationResult {
  const blocking: PrevalidationIssue[] = [];
  if (!patterns.isUuid(input.invoiceId)) {
    blocking.push({ code: "MALFORMED_ID", messageKey: "returnsOriginalRequired", context: {} });
  }
  if (input.lines.length === 0) {
    blocking.push({ code: "MISSING_ITEM", messageKey: "commonRequired", context: {} });
  }
  for (const [index, line] of input.lines.entries()) {
    const lineNo = index + 1;
    if (!patterns.isUuid(line.invoiceLineId)) {
      blocking.push({ code: "MISSING_ITEM", messageKey: "commonRequired", context: {}, line: lineNo });
      continue;
    }
    if (!patterns.isQty(line.qty) || new Decimal(line.qty).lessThanOrEqualTo(0)) {
      blocking.push({ code: "ZERO_QTY", messageKey: "errInvalidQty", context: {}, line: lineNo });
    }
  }
  return { advisories: [], blocking };
}

/**
 * Save the return draft: structural gate, then ONE transaction (offline
 * number + the sync-core `buildSyncCommandV2` envelope + enqueue). The
 * queued command is the DRAFT_LOCAL capture; the server ACK creates the
 * server-side DRAFT (`DRAFT_LOCAL → DRAFT` — row 27's machine; posting
 * stays online).
 */
export function saveReturnDraft(
  adapter: StorageAdapter,
  ctx: FieldFlowContext,
  input: ReturnDraftInput,
  uuid: () => string = generateUuidV7,
): ReturnSaveResult {
  const validation = validateReturnDraft(input);
  if (validation.blocking.length > 0) {
    return { ok: false, advisories: validation.advisories, blocking: validation.blocking };
  }
  const payload = buildReturnPayload(ctx, input);
  const saved = adapter.transaction(() => {
    const localRef = nextOfflineNumber(adapter, ctx.deviceCode, ctx.deviceId);
    const command = buildSyncCommandV2(
      {
        entityType: "credit_note",
        intent: "create_draft",
        payload,
        idempotencyKey: `credit_note:create_draft:${uuid()}`,
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

/** One saved return's honest-state view. */
export interface ReturnDocumentView {
  readonly commandId: string;
  readonly localRef: string | null;
  readonly state: HonestFlowState;
  readonly officialNo: string | null;
  readonly invoiceId: string;
  readonly lineCount: number;
  readonly savedAt: string;
}

/** The return document view for one command id. */
export function returnDocument(
  adapter: StorageAdapter,
  commandId: string,
): ReturnDocumentView | undefined {
  const row = flowRowByCommandId(adapter, commandId);
  if (row === undefined) return undefined;
  let payload: { invoiceId?: string; lines?: unknown[] } = {};
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
    invoiceId: String(payload.invoiceId ?? ""),
    lineCount: Array.isArray(payload.lines) ? payload.lines.length : 0,
    savedAt: row.clientCreatedAt,
  };
}
