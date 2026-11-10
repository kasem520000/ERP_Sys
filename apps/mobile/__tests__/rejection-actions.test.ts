import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyResult,
  buildSyncCommandV2,
  enqueue,
  nextOfflineNumber,
  rejectedCommands,
  type OutboxRow,
} from "@erp/sync-core";

import { openFieldStore, type MobileStore } from "../src/store";
import {
  REJECTION_ACTION_TABLE,
  REJECTION_AUDIT_CAP,
  acceptPartial,
  acceptServerPrice,
  actionsForRejectionCode,
  cancelRejected,
  discardRejected,
  editAndResend,
  entityIdOfPayload,
  parkedActionLabelKey,
  rejectionAuditTrail,
  requestApprovalOnline,
  substituteAndResend,
  traceIdOfRow,
  type RejectionAuditEntry,
} from "../src/reconciliation";

/**
 * PHASE-022 T-P22-3-b · the parked-rejection actions (docs/offline/
 * CONFLICT_RESOLUTION §3 — THE TABLE, exactly): every typed reason → its
 * FIXED action set; the §3 resend rule (NEW commandId, SAME entity id,
 * FRESH idempotencyKey WHEN the payload changed); cancel/discard audited;
 * accept-server-price recomputes; accept-partial caps qty; the ONLINE-
 * ONLY request-approval is refused offline — never queued. Every choice
 * is audited with the rejecting response's traceId over a REAL
 * openFieldStore temp SQLite file (the 2-e suite shapes; state
 * transitions driven through sync-core's own applyResult, UNMODIFIED).
 */

const DEVICE_ID = "3b3b3b3b-0000-4111-8111-3b3b3b3b3b01";
const ITEM_A = "3b3b3b3b-2222-4111-8111-3b3b3b3b3b22";
const ITEM_B = "3b3b3b3b-2323-4111-8111-3b3b3b3b3b23";
const INVOICE_ID = "3b3b3b3b-4444-4111-8111-3b3b3b3b3b44";
const TRACE_ID = "trace-3b-reject-0001";

let dir: string;
let store: MobileStore;
let seq = 0;

/** A deterministic uuid sequence (the resend ids are assertable). */
function deterministicUuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

interface Seeded {
  row: OutboxRow;
  commandId: string;
}

/** Seed one REJECTED command with a typed lastError (traceId included). */
function seedRejected(
  entityType: string,
  intent: string,
  payload: Record<string, unknown>,
  reason: string,
  details: Record<string, unknown> = {},
): Seeded {
  const localRef = nextOfflineNumber(store, "F01", DEVICE_ID);
  const command = buildSyncCommandV2({ entityType, intent, payload, localRef }, deterministicUuid);
  const enqueued = store.transaction(() =>
    enqueue(store, {
      entityType: command.entityType,
      intent: command.intent,
      payload: command.payload as Record<string, unknown>,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      localRef,
    }),
  );
  applyResult(store, {
    commandId: enqueued.commandId,
    status: "REJECTED",
    rejectionReason: reason,
    rejectionAction: null,
    resubmittable: true,
    rejectionDetails: { traceId: TRACE_ID, ...details },
    error: `rejected for test: ${reason}`,
  });
  const row = rejectedCommands(store).find((candidate) => candidate.commandId === enqueued.commandId);
  if (row === undefined) throw new Error("seedRejected: the row did not land REJECTED");
  return { row, commandId: enqueued.commandId };
}

/** The last audit entry. */
function lastAudit(): RejectionAuditEntry {
  const trail = rejectionAuditTrail(store);
  return trail[trail.length - 1]!;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p22-3b-rejections-"));
  store = openFieldStore(join(dir, "field.db"));
});

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// -- THE §3 TABLE, exactly ------------------------------------------------------------

describe("PHASE-022 T-P22-3-b · the CONFLICT_RESOLUTION §3 table (exact)", () => {
  it("every §3 code → its exact required action set", () => {
    expect(REJECTION_ACTION_TABLE.PERIOD_LOCKED).toEqual(["EDIT_AND_RESEND", "CANCEL"]);
    expect(REJECTION_ACTION_TABLE.PRICE_CHANGED).toEqual(["ACCEPT_SERVER_PRICE", "EDIT_AND_RESEND", "CANCEL"]);
    expect(REJECTION_ACTION_TABLE.INSUFFICIENT_STOCK).toEqual(["EDIT_AND_RESEND", "ACCEPT_PARTIAL", "CANCEL"]);
    expect(REJECTION_ACTION_TABLE.CREDIT_LIMIT_EXCEEDED).toEqual(["EDIT_AND_RESEND", "REQUEST_APPROVAL_ONLINE", "CANCEL"]);
    expect(REJECTION_ACTION_TABLE.STALE_VERSION).toEqual(["REVIEW_AND_MERGE", "DISCARD"]);
    expect(REJECTION_ACTION_TABLE.ITEM_INACTIVE).toEqual(["CANCEL", "SUBSTITUTE_AND_RESEND"]);
    expect(REJECTION_ACTION_TABLE.PARTNER_INACTIVE).toEqual(["CANCEL", "SUBSTITUTE_AND_RESEND"]);
    expect(REJECTION_ACTION_TABLE.VALIDATION_ERROR).toEqual(["EDIT_AND_RESEND"]);
  });

  it("DEVICE_REVOKED / TENANT_SUSPENDED: NO resubmission — the administrative surface", () => {
    for (const code of ["DEVICE_REVOKED", "TENANT_SUSPENDED"] as const) {
      const set = actionsForRejectionCode(code);
      expect(set.actions).toEqual([]);
      expect(set.administrative).toBe(true);
      expect(set.fallback).toBe(false);
    }
  });

  it("unknown codes → the registry fallback (message + traceId + support) — never a guessed action", () => {
    for (const code of ["SOMETHING_NEW", "DUPLICATE_COMMAND", "", "price_changed"]) {
      const set = actionsForRejectionCode(code);
      expect(set.fallback, code).toBe(true);
      expect(set.actions).toEqual([]);
      expect(set.administrative).toBe(false);
      expect(set.code).toBe("UNKNOWN");
    }
  });

  it("every §3 action has a catalog label key (the action* vocabulary)", () => {
    const labels = (["EDIT_AND_RESEND", "ACCEPT_SERVER_PRICE", "ACCEPT_PARTIAL", "CANCEL", "SUBSTITUTE_AND_RESEND", "REVIEW_AND_MERGE", "DISCARD", "REQUEST_APPROVAL_ONLINE"] as const).map(
      (action) => parkedActionLabelKey(action),
    );
    expect(new Set(labels).size).toBe(8);
    for (const key of labels) {
      expect(String(key)).toMatch(/^action[A-Z]/);
    }
  });
});

// -- the §3 executors (over the REAL store) -------------------------------------------

describe("PHASE-022 T-P22-3-b · the §3 executors", () => {
  it("resend: NEW commandId, SAME entity id, FRESH idempotencyKey when the payload changed; the rejected row voided; audited with the traceId", () => {
    const seeded = seedRejected(
      "sales_invoice",
      "update_draft",
      { invoiceId: INVOICE_ID, orderDate: "2026-11-18", lines: [{ itemId: ITEM_A, qty: "3", unitPrice: "2.5000" }] },
      "PERIOD_LOCKED",
    );
    const edited = {
      invoiceId: INVOICE_ID, // the SAME entity id (§3's rule)
      orderDate: "2026-11-19", // the edit (an open period)
      lines: [{ itemId: ITEM_A, qty: "3", unitPrice: "2.5000" }],
    };
    const outcome = editAndResend(store, seeded.row, edited, { uuid: deterministicUuid });

    expect(outcome.payloadChanged).toBe(true);
    expect(outcome.newCommandId).not.toBe(seeded.commandId); // NEW commandId
    expect(outcome.row.commandId).toBe(outcome.newCommandId);
    expect(outcome.row.status).toBe("QUEUED"); // a fresh, drainable command
    expect(outcome.row.idempotencyKey).not.toBe(seeded.row.idempotencyKey); // FRESH key
    expect(outcome.row.idempotencyKey).toMatch(/^sales_invoice:update_draft:/);
    const newPayload = JSON.parse(outcome.row.payload) as Record<string, unknown>;
    expect(newPayload.invoiceId).toBe(INVOICE_ID); // SAME entity id

    // The rejected row is voided (kept for audit, never deleted).
    const stillRejected = rejectedCommands(store).filter((row) => row.commandId === seeded.commandId);
    expect(stillRejected).toHaveLength(0);
    const voided = store.get("SELECT status FROM outbox WHERE command_id = ?", [seeded.commandId]);
    expect(voided?.status).toBe("CANCELLED");

    // The audit entry: the choice + the rejecting traceId + the linkage.
    const entry = lastAudit();
    expect(entry).toMatchObject({
      code: "PERIOD_LOCKED",
      action: "EDIT_AND_RESEND",
      commandId: seeded.commandId,
      entityId: INVOICE_ID,
      traceId: TRACE_ID,
      newCommandId: outcome.newCommandId,
    });
  });

  it("resend with an UNCHANGED payload: new commandId + a fresh local key (a REJECTED command was never executed server-side — nothing to dedupe)", () => {
    const payload = { invoiceId: INVOICE_ID, lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.5000" }] };
    const seeded = seedRejected("sales_invoice", "update_draft", payload, "VALIDATION_ERROR");
    const outcome = editAndResend(store, seeded.row, payload, { uuid: deterministicUuid });
    expect(outcome.payloadChanged).toBe(false);
    expect(outcome.newCommandId).not.toBe(seeded.commandId);
    // The local outbox's UNIQUE(idempotency_key) + the never-executed
    // rejection make the fresh key the correct unchanged-payload reading.
    expect(outcome.row.idempotencyKey).not.toBe(seeded.row.idempotencyKey);
    expect(outcome.row.idempotencyKey).toMatch(/^sales_invoice:update_draft:/);
  });

  it("accept-server-price: recompute from the server's prices, then resend (fresh key — the payload changed)", () => {
    const seeded = seedRejected(
      "sales_invoice",
      "create_draft",
      { customerId: "cust", orderDate: "2026-11-18", lines: [{ itemId: ITEM_A, qty: "3", unitPrice: "2.5000" }] },
      "PRICE_CHANGED",
      { server: "3.0000", cached: "2.5000" },
    );
    const outcome = acceptServerPrice(store, seeded.row, { serverPrices: { [ITEM_A]: "3.0000" } }, { uuid: deterministicUuid });
    expect(outcome.payloadChanged).toBe(true);
    const payload = JSON.parse(outcome.row.payload) as { lines: { itemId: string; unitPrice: string }[] };
    expect(payload.lines[0]!.unitPrice).toBe("3.0000"); // recomputed
    expect(outcome.row.idempotencyKey).not.toBe(seeded.row.idempotencyKey);
    expect(lastAudit()).toMatchObject({ code: "PRICE_CHANGED", action: "EDIT_AND_RESEND", traceId: TRACE_ID });
  });

  it("accept-partial: cap qty at the server's available (zero-qty lines drop), then resend", () => {
    const seeded = seedRejected(
      "sales_invoice",
      "create_draft",
      {
        customerId: "cust",
        orderDate: "2026-11-18",
        lines: [
          { itemId: ITEM_A, qty: "5", unitPrice: "2.5000" },
          { itemId: ITEM_B, qty: "2", unitPrice: "1.0000" },
        ],
      },
      "INSUFFICIENT_STOCK",
      { available: "3" },
    );
    const outcome = acceptPartial(store, seeded.row, { availableQty: { [ITEM_A]: "3", [ITEM_B]: "0" } }, { uuid: deterministicUuid });
    const payload = JSON.parse(outcome.row.payload) as { lines: { itemId: string; qty: string }[] };
    expect(payload.lines).toHaveLength(1); // ITEM_B's zero-qty line dropped
    expect(payload.lines[0]!).toMatchObject({ itemId: ITEM_A, qty: "3" }); // capped, never above
    expect(lastAudit()).toMatchObject({ code: "INSUFFICIENT_STOCK", traceId: TRACE_ID });
  });

  it("substitute-and-resend: replace the deactivated master data, then resend", () => {
    const seeded = seedRejected(
      "sales_invoice",
      "create_draft",
      { customerId: "cust", orderDate: "2026-11-18", lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.5000" }] },
      "ITEM_INACTIVE",
    );
    const outcome = substituteAndResend(store, seeded.row, { itemId: ITEM_B }, { uuid: deterministicUuid });
    const payload = JSON.parse(outcome.row.payload) as { lines: { itemId: string }[] };
    expect(payload.lines[0]!.itemId).toBe(ITEM_B);
    const partnerSeeded = seedRejected("credit_note", "create_draft", { partnerId: "old-partner" }, "PARTNER_INACTIVE");
    const partnerOutcome = substituteAndResend(store, partnerSeeded.row, { partnerId: "new-partner" }, { uuid: deterministicUuid });
    expect(JSON.parse(partnerOutcome.row.payload)).toMatchObject({ partnerId: "new-partner" });
  });

  it("cancel: void + audit record (§3 — keep the audit record)", () => {
    const seeded = seedRejected("receipt", "create_field_collection", { partnerId: "cust", amount: "50.0000" }, "PERIOD_LOCKED");
    cancelRejected(store, seeded.row);
    expect(rejectedCommands(store).filter((row) => row.commandId === seeded.commandId)).toHaveLength(0);
    expect(store.get("SELECT status FROM outbox WHERE command_id = ?", [seeded.commandId])?.status).toBe("CANCELLED");
    expect(lastAudit()).toMatchObject({
      code: "PERIOD_LOCKED",
      action: "CANCEL",
      commandId: seeded.commandId,
      traceId: TRACE_ID,
      newCommandId: null,
    });
  });

  it("discard (STALE_VERSION): void + audited", () => {
    const seeded = seedRejected("sales_invoice", "update_draft", { invoiceId: INVOICE_ID }, "STALE_VERSION", { currentVersion: 7 });
    discardRejected(store, seeded.row);
    expect(store.get("SELECT status FROM outbox WHERE command_id = ?", [seeded.commandId])?.status).toBe("CANCELLED");
    expect(lastAudit()).toMatchObject({ code: "STALE_VERSION", action: "DISCARD", traceId: TRACE_ID });
  });

  it("request-approval-online: ONLINE-ONLY — offline → refused, never queued; online → audited", () => {
    const seeded = seedRejected("sales_invoice", "create_draft", { customerId: "cust", amount: "900.0000" }, "CREDIT_LIMIT_EXCEEDED", { limit: "100.0000", due: "950.0000" });
    const before = rejectionAuditTrail(store).length;
    const offline = requestApprovalOnline(store, seeded.row, false);
    expect(offline).toEqual({ ok: false, reason: "offline" });
    expect(rejectionAuditTrail(store)).toHaveLength(before); // NOTHING recorded — refused, not queued
    expect(rejectedCommands(store).some((row) => row.commandId === seeded.commandId)).toBe(true); // still parked

    const online = requestApprovalOnline(store, seeded.row, true);
    expect(online).toEqual({ ok: true, reason: null });
    expect(lastAudit()).toMatchObject({
      code: "CREDIT_LIMIT_EXCEEDED",
      action: "REQUEST_APPROVAL_ONLINE",
      commandId: seeded.commandId,
      traceId: TRACE_ID,
    });
  });

  it("the traceId + entity-id readers (the audit keys)", () => {
    const seeded = seedRejected("sales_invoice", "update_draft", { invoiceId: INVOICE_ID }, "PRICE_CHANGED");
    expect(traceIdOfRow(seeded.row)).toBe(TRACE_ID);
    expect(entityIdOfPayload(JSON.parse(seeded.row.payload) as Record<string, unknown>)).toBe(INVOICE_ID);
    const legacy = seedRejected("receipt", "create_field_collection", { partnerId: "p1" }, "VALIDATION_ERROR");
    store.run("UPDATE outbox SET last_error = ? WHERE command_id = ?", ["plain legacy text", legacy.commandId]);
    const legacyRow = rejectedCommands(store).find((row) => row.commandId === legacy.commandId)!;
    expect(traceIdOfRow(legacyRow)).toBeNull();
  });

  it("the audit trail is bounded (the meta list cap — oldest entries drop off)", () => {
    const capDir = mkdtempSync(join(tmpdir(), "p22-3b-rejections-cap-"));
    const capStore = openFieldStore(join(capDir, "field.db"));
    for (let i = 0; i < REJECTION_AUDIT_CAP + 5; i += 1) {
      const command = buildSyncCommandV2(
        { entityType: "receipt", intent: "create_field_collection", payload: { partnerId: `p${i}` } },
        deterministicUuid,
      );
      const enqueued = capStore.transaction(() =>
        enqueue(capStore, {
          entityType: command.entityType,
          intent: command.intent,
          payload: command.payload as Record<string, unknown>,
          idempotencyKey: command.idempotencyKey,
          commandId: command.commandId,
        }),
      );
      applyResult(capStore, { commandId: enqueued.commandId, status: "REJECTED", rejectionReason: "VALIDATION_ERROR" });
      const row = rejectedCommands(capStore).find((candidate) => candidate.commandId === enqueued.commandId)!;
      cancelRejected(capStore, row);
    }
    const trail = rejectionAuditTrail(capStore);
    expect(trail).toHaveLength(REJECTION_AUDIT_CAP); // bounded, oldest dropped
    expect(trail[0]!.entityId).toBe(`p5`); // the first 5 dropped off
    capStore.close();
    rmSync(capDir, { recursive: true, force: true });
  });
});
