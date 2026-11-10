/**
 * PHASE-022 T-P22-2-e · the stock-count line entry flow (MASTER-PLAN §8 —
 * BINDING; OFFLINE_CAPABILITIES_MATRIX row 11 android-field
 * **OFFLINE-DRAFT**; CONFLICT_RESOLUTION §2 "Stock count lines"
 * SERVER_DECISION-aggregate).
 *
 * The machine: `DRAFT_LOCAL → DRAFT` (row 11: `DRAFT_LOCAL → DRAFT →
 * COUNTED`, the rest online). Counted quantities are FACTS, not mutations:
 * the count document carries them; VARIANCE CALCULATION AND ADJUSTMENT
 * POSTING ARE SERVER-ONLY (DOCUMENT_LIFECYCLE §3 "Stock count" — the
 * matrix row note). This flow therefore computes NO variance, NO
 * system-qty comparison, NO adjustment — it captures counted lines against
 * an EXISTING count session (`countId` — sessions are created online; the
 * system-qty snapshot is frozen server-side at session start) and queues
 * them as the `stock_count:submit_lines` command (payload schema
 * `stockCountSubmitLinesPayloadSchema` — the DR-P21-08 desktop contract
 * the field class reuses).
 *
 * A counted qty of 0 is LEGITIMATE (a loss) — the structural gate rejects
 * malformed quantities and duplicate (itemId, batchRef) lines, never a
 * counted zero. Barcode scan adds lines through the shared
 * `resolveBarcodeItem` snapshot reader (an unknown code surfaces the
 * countUnknownBarcode honesty string, never a guessed item).
 */
import { generateUuidV7 } from "@erp/domain-core";
import type { StockCountSubmitLinesPayload } from "@erp/contracts";
import {
  buildSyncCommandV2,
  enqueue,
  nextOfflineNumber,
  type StorageAdapter,
} from "@erp/sync-core";

import {
  patterns,
  resolveBarcodeItem,
  type ItemSnapshot,
  type PrevalidationIssue,
  type PrevalidationResult,
} from "./prevalidation";
import {
  flowRowByCommandId,
  flowStateFromRow,
  type FieldFlowContext,
  type HonestFlowState,
} from "./state-machine";

/** One counted line: the FACT as counted (batch disambiguator optional). */
export interface CountLineInput {
  readonly itemId: string;
  readonly countedQty: string;
  /** Batch disambiguator for multi-batch items (matches the session line's batch). */
  readonly batchRef?: string | null;
}

/** The count submission capture. */
export interface CountLinesInput {
  /** The EXISTING count session (created online — the system qty is frozen server-side). */
  readonly countId: string;
  readonly lines: readonly CountLineInput[];
}

/** The count save outcome. */
export interface CountSaveResult {
  readonly ok: boolean;
  readonly commandId?: string;
  readonly localRef?: string;
  readonly state?: HonestFlowState;
  readonly advisories: readonly PrevalidationIssue[];
  readonly blocking: readonly PrevalidationIssue[];
}

/** Build the `stock_count:submit_lines` payload (pure — zod-parse proof target). */
export function buildCountLinesPayload(input: CountLinesInput): StockCountSubmitLinesPayload {
  return {
    countId: input.countId,
    lines: input.lines.map((line) => {
      const payloadLine: { itemId: string; countedQty: string; batchRef?: string } = {
        itemId: line.itemId,
        countedQty: line.countedQty,
      };
      if (line.batchRef !== undefined && line.batchRef !== null) {
        payloadLine.batchRef = line.batchRef;
      }
      return payloadLine;
    }),
  };
}

/**
 * Structural gate: the session reference, the line set, the qty shapes, the
 * one-line-per-(item,batch) rule (the session line resolution's key). A
 * counted ZERO passes (a loss is a fact). NO variance math — server-only.
 */
export function validateCountLines(input: CountLinesInput): PrevalidationResult {
  const blocking: PrevalidationIssue[] = [];
  if (!patterns.isUuid(input.countId)) {
    blocking.push({ code: "MALFORMED_ID", messageKey: "commonRequired", context: {} });
  }
  if (input.lines.length === 0) {
    blocking.push({ code: "MISSING_ITEM", messageKey: "countEmpty", context: {} });
  }
  const seen = new Set<string>();
  for (const [index, line] of input.lines.entries()) {
    const lineNo = index + 1;
    if (!patterns.isUuid(line.itemId)) {
      blocking.push({ code: "MISSING_ITEM", messageKey: "commonRequired", context: {}, line: lineNo });
      continue;
    }
    const key = `${line.itemId}:${line.batchRef ?? "-"}`;
    if (seen.has(key)) {
      blocking.push({ code: "MISSING_ITEM", messageKey: "commonRequired", context: {}, line: lineNo });
      continue;
    }
    seen.add(key);
    if (!patterns.isQty(line.countedQty) || /^-/.test(line.countedQty)) {
      blocking.push({ code: "MALFORMED_QTY", messageKey: "errInvalidQty", context: {}, line: lineNo });
    }
  }
  return { advisories: [], blocking };
}

/**
 * Save the counted lines: structural gate, then ONE transaction (offline
 * number + the sync-core `buildSyncCommandV2` envelope + enqueue). The
 * queued command is the DRAFT_LOCAL capture; the server applies the lines
 * through CountService.enterCounts (the blind-safe line-entry path —
 * submit/review/approve stay online server decisions).
 */
export function saveCountLines(
  adapter: StorageAdapter,
  ctx: FieldFlowContext,
  input: CountLinesInput,
  uuid: () => string = generateUuidV7,
): CountSaveResult {
  const validation = validateCountLines(input);
  if (validation.blocking.length > 0) {
    return { ok: false, advisories: validation.advisories, blocking: validation.blocking };
  }
  const payload = buildCountLinesPayload(input);
  const saved = adapter.transaction(() => {
    const localRef = nextOfflineNumber(adapter, ctx.deviceCode, ctx.deviceId);
    const command = buildSyncCommandV2(
      {
        entityType: "stock_count",
        intent: "submit_lines",
        payload,
        idempotencyKey: `stock_count:submit_lines:${uuid()}`,
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

// -- scan-to-count (the shared barcode reader) ----------------------------------------

/** The scan-to-count outcome: the resolved item, or null (unknown code). */
export function scanCountItem(adapter: StorageAdapter, code: string): ItemSnapshot | undefined {
  return resolveBarcodeItem(adapter, code);
}

/** One saved count submission's honest-state view. */
export interface CountDocumentView {
  readonly commandId: string;
  readonly localRef: string | null;
  readonly state: HonestFlowState;
  readonly officialNo: string | null;
  readonly countId: string;
  readonly lineCount: number;
  readonly savedAt: string;
}

/** The count document view for one command id. */
export function countDocument(
  adapter: StorageAdapter,
  commandId: string,
): CountDocumentView | undefined {
  const row = flowRowByCommandId(adapter, commandId);
  if (row === undefined) return undefined;
  let payload: { countId?: string; lines?: unknown[] } = {};
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
    countId: String(payload.countId ?? ""),
    lineCount: Array.isArray(payload.lines) ? payload.lines.length : 0,
    savedAt: row.clientCreatedAt,
  };
}
