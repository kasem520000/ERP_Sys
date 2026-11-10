/**
 * PHASE-021 T2-b — the store-client suite: the async repository over
 * bridge.sql. Every assertion runs against the in-memory bridge double
 * (Map-backed sql) — the enqueue ordering (outbox FIRST, then the
 * projection), the crash window, the write gate refusals, the rejection
 * reads, the D-04 unlock decision, and the cached-read mappers.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";
import { buildPartnerCreate } from "../builders";
import type { DesktopBridge } from "../bridge";
import {
  appendLocalEvent,
  enqueueDraftCommand,
  readAsOf,
  readCachedInvoice,
  readCachedItems,
  readCachedPartners,
  readCachedCountSessions,
  readDrafts,
  readMeta,
  readOutbox,
  readRejections,
  readSalesInvoices,
  searchMasterData,
  ShellStoreRefusedError,
  unlockSnapshot,
  updateDraftStatus,
} from "../store-client";
import { createBridgeDouble, type BridgeDouble } from "./bridge-double";

afterEach(() => {
  delete (globalThis as { __erpDesktop?: unknown }).__erpDesktop;
});

const UUID_A = "21212121-0000-4000-8000-000000000001";
const UUID_B = "21212121-0000-4000-8000-000000000002";

function ready(options?: { sync?: boolean }): { double: BridgeDouble; bridge: DesktopBridge } {
  const double = createBridgeDouble(
    options === undefined ? undefined : { withSync: options.sync },
  );
  return { double, bridge: double.bridge };
}

/** Capture the typed refusal from an enqueue that must fail. */
async function expectRefusal(promise: Promise<unknown>): Promise<ShellStoreRefusedError> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ShellStoreRefusedError);
  return error as ShellStoreRefusedError;
}

function seededOutboxRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    command_id: "21212121-0000-4000-8000-0000000000aa",
    entity_type: "partner",
    intent: "create",
    payload: "{}",
    idempotency_key: "partner:create:k1",
    base_version: null,
    client_created_at: "2026-11-04T10:00:00.000Z",
    local_ref: null,
    status: "QUEUED",
    attempts: 0,
    next_attempt_at: 0,
    last_error: null,
    last_attempt_at: null,
    accepted_result: null,
    rejection_reason: null,
    rejection_action: null,
    official_no: null,
    acked_at: null,
    ...overrides,
  };
}

describe("enqueueDraftCommand (the crash-safe ordering)", () => {
  it("inserts the outbox row FIRST with the engine's 18-column shape, then the draft projection", async () => {
    const { double, bridge } = ready();
    const command = buildPartnerCreate({ kind: "CUSTOMER", name: "مؤسسة الريادة" });
    await enqueueDraftCommand(
      bridge,
      command,
      { localId: UUID_A, docType: "partner_create", entityId: null, payload: command.payload },
    );
    // ordering: outbox INSERT strictly before the draft upsert
    const draftIndex = double.calls.executed.findIndex((sql) => sql.startsWith("INSERT OR REPLACE INTO draft_docs"));
    const outboxIndex = double.calls.executed.findIndex((sql) => sql.startsWith("INSERT INTO outbox"));
    expect(outboxIndex).toBeGreaterThanOrEqual(0);
    expect(draftIndex).toBeGreaterThan(outboxIndex);

    const outbox = double.tables.get("outbox")!.get(command.commandId)!;
    expect(outbox.status).toBe("QUEUED");
    expect(outbox.entity_type).toBe("partner");
    expect(outbox.intent).toBe("create");
    expect(outbox.idempotency_key).toBe(command.idempotencyKey);
    // DR-P21-3b-1: the column carries the FULL v2 envelope (the engine sends
    // JSON.parse(row.payload) verbatim on the wire).
    expect(outbox.payload).toBe(JSON.stringify(command));
    expect(outbox.client_created_at).toBe(command.clientCreatedAt);
    expect(outbox.attempts).toBe(0);
    expect(outbox.official_no).toBeNull();

    const draft = double.tables.get("draft_docs")!.get(UUID_A)!;
    expect(draft.doc_type).toBe("partner_create");
    expect(draft.local_status).toBe("DRAFT_LOCAL");
    expect(draft.command_id).toBe(command.commandId);
    expect(draft.rejection).toBeNull();
  });

  it("loses only the PROJECTION in the crash window — the outbox command survives", async () => {
    const { double, bridge } = ready();
    double.failOn(/^INSERT OR REPLACE INTO draft_docs/);
    const command = buildPartnerCreate({ kind: "BOTH", name: "Rain Co" });
    await expect(
      enqueueDraftCommand(bridge, command, {
        localId: UUID_A,
        docType: "partner_create",
        entityId: null,
        payload: command.payload,
      }),
    ).rejects.toThrow(/injected failure/);
    // the honest window: the command IS queued (the source of truth), the
    // local projection row is absent — never the other way around.
    expect(double.tables.get("outbox")!.has(command.commandId)).toBe(true);
    expect(double.tables.get("draft_docs")?.has(UUID_A) ?? false).toBe(false);
  });

  it("re-points the SAME draft row on a resend (new commandId, same local entity id)", async () => {
    const { double, bridge } = ready();
    const first = buildPartnerCreate({ kind: "CUSTOMER", name: "Alpha" });
    await enqueueDraftCommand(bridge, first, {
      localId: UUID_A,
      docType: "partner_create",
      entityId: null,
      payload: first.payload,
    });
    const second = buildPartnerCreate({ kind: "CUSTOMER", name: "Alpha — edited" });
    expect(second.commandId).not.toBe(first.commandId);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    await enqueueDraftCommand(bridge, second, {
      localId: UUID_A,
      docType: "partner_create",
      entityId: null,
      payload: second.payload,
    });
    expect(double.tables.get("draft_docs")!.size).toBe(1);
    const draft = double.tables.get("draft_docs")!.get(UUID_A)!;
    expect(draft.command_id).toBe(second.commandId);
    expect(double.tables.get("outbox")!.size).toBe(2);
  });

  it("refuses BEFORE any write when the store is quarantined", async () => {
    const { double, bridge } = ready();
    double.seed("meta", [{ key: "quarantined", value: "true" }]);
    const command = buildPartnerCreate({ kind: "CUSTOMER", name: "x" });
    await expect(
      enqueueDraftCommand(bridge, command, {
        localId: UUID_A,
        docType: "partner_create",
        entityId: null,
        payload: command.payload,
      }),
    ).rejects.toBeInstanceOf(ShellStoreRefusedError);
    expect(double.tables.get("outbox")?.size ?? 0).toBe(0);
    expect(double.tables.get("draft_docs")?.size ?? 0).toBe(0);
  });

  it("refuses when the C-08 contract gate is tripped", async () => {
    const { double, bridge } = ready();
    double.seed("meta", [{ key: "contractGate", value: "read-only" }]);
    const command = buildPartnerCreate({ kind: "CUSTOMER", name: "x" });
    const refusal = await expectRefusal(
      enqueueDraftCommand(bridge, command, {
        localId: UUID_A,
        docType: "partner_create",
        entityId: null,
        payload: command.payload,
      }),
    );
    expect(refusal.refusal).toEqual({ kind: "contract-gate" });
  });

  it("refuses when the D-04 permission watermark is past 7 days", async () => {
    const { double, bridge } = ready();
    double.seed("meta", [
      { key: "permissionSnapshotAt", value: String(Date.now() - 8 * 86_400_000) },
    ]);
    const command = buildPartnerCreate({ kind: "CUSTOMER", name: "x" });
    const refusal = await expectRefusal(
      enqueueDraftCommand(bridge, command, {
        localId: UUID_A,
        docType: "partner_create",
        entityId: null,
        payload: command.payload,
      }),
    );
    expect(refusal.refusal.kind).toBe("stale-watermark");
  });
});

describe("updateDraftStatus + appendLocalEvent", () => {
  it("updates the status, the rejection reason, and the timestamp", async () => {
    const { double, bridge } = ready();
    double.seed("draft_docs", [
      { local_id: UUID_A, doc_type: "expense", entity_id: null, payload: "{}", local_status: "SYNC_FAILED", command_id: UUID_B, rejection: "PRICE_CHANGED", updated_at: "2026-11-04T09:00:00.000Z" },
    ]);
    await updateDraftStatus(bridge, UUID_A, "CANCELLED_LOCAL", "PRICE_CHANGED");
    const row = double.tables.get("draft_docs")!.get(UUID_A)!;
    expect(row.local_status).toBe("CANCELLED_LOCAL");
    expect(row.rejection).toBe("PRICE_CHANGED");
    expect(String(row.updated_at)).not.toBe("2026-11-04T09:00:00.000Z");
  });

  it("writes the rejection_choice audit row (7 explicit columns + JSON payload)", async () => {
    const { double, bridge } = ready();
    await appendLocalEvent(bridge, {
      kind: "rejection_choice",
      choice: "edit_and_resend",
      reason: "PRICE_CHANGED",
      traceId: "trace-1",
      commandId: UUID_B,
      payload: { line: 1 },
      at: "2026-11-04T12:00:00.000Z",
    });
    const events = [...(double.tables.get("local_events")?.values() ?? [])];
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("rejection_choice");
    expect(events[0]!.choice).toBe("edit_and_resend");
    expect(events[0]!.trace_id).toBe("trace-1");
    expect(events[0]!.payload).toBe(JSON.stringify({ line: 1 }));
  });
});

describe("reads (outbox, rejections, drafts, as-of)", () => {
  it("maps outbox rows snake_case → camelCase and filters by status", async () => {
    const { double, bridge } = ready();
    double.seed("outbox", [
      seededOutboxRow({ command_id: UUID_A, status: "ACKED", official_no: "INV-0001", accepted_result: "{}", acked_at: "2026-11-04T11:00:00.000Z" }),
      seededOutboxRow({ command_id: UUID_B, status: "REJECTED", rejection_reason: "PRICE_CHANGED", rejection_action: "ACCEPT_SERVER_PRICE", last_error: "{\"reason\":\"PRICE_CHANGED\"}" }),
    ]);
    const all = await readOutbox(bridge);
    expect(all).toHaveLength(2);
    const acked = all.find((row) => row.commandId === UUID_A)!;
    expect(acked.officialNo).toBe("INV-0001");
    expect(acked.status).toBe("ACKED");
    const queued = await readOutbox(bridge, ["QUEUED"]);
    expect(queued).toHaveLength(0);
    const rejected = await readRejections(bridge);
    expect(rejected.map((row) => row.commandId)).toEqual([UUID_B]);
    expect(rejected[0]!.rejectionReason).toBe("PRICE_CHANGED");
  });

  it("derives the as-of stamp from cursors (max synced_at; null when empty)", async () => {
    const { double, bridge } = ready();
    expect(await readAsOf(bridge)).toBeNull();
    double.seed("cursors", [
      { entity_type: "items", last_seq: "9", synced_at: 1_790_000_000_000 },
      { entity_type: "partners", last_seq: "4", synced_at: 1_790_000_500_000 },
    ]);
    expect(await readAsOf(bridge)).toBe(1_790_000_500_000);
  });

  it("filters drafts by doc type and orders newest first", async () => {
    const { double, bridge } = ready();
    double.seed("draft_docs", [
      { local_id: UUID_A, doc_type: "expense", entity_id: null, payload: "{}", local_status: "DRAFT_LOCAL", command_id: UUID_B, rejection: null, updated_at: "2026-11-04T09:00:00.000Z" },
      { local_id: UUID_B, doc_type: "expense", entity_id: null, payload: "{}", local_status: "MERGED", command_id: UUID_A, rejection: null, updated_at: "2026-11-04T10:00:00.000Z" },
    ]);
    const expenses = await readDrafts(bridge, "expense");
    expect(expenses.map((row) => row.localId)).toEqual([UUID_B, UUID_A]);
    const merged = await readDrafts(bridge, "expense");
    expect(merged[0]!.localStatus).toBe("MERGED");
  });

  it("reads one cached invoice by id (the reprint source)", async () => {
    const { double, bridge } = ready();
    double.seed("sales_invoices", [
      { id: UUID_A, doc_no: "INV-77", partner_id: UUID_B, status: "POSTED", issue_date: "2026-11-01", total_gross: "115.0000", total_tax: "15.0000", currency: "SAR", payload: "{}", version: 3, updated_at: null, dirty: 0 },
    ]);
    const invoice = await readCachedInvoice(bridge, UUID_A);
    expect(invoice?.docNo).toBe("INV-77");
    expect(invoice?.totalGross).toBe("115.0000");
    expect(await readCachedInvoice(bridge, UUID_B)).toBeNull();
    const list = await readSalesInvoices(bridge);
    expect(list).toHaveLength(1);
  });
});

describe("cached read filters (the pickers' sources)", () => {
  it("keeps only ACTIVE items/partners and searches by display text", async () => {
    const { double, bridge } = ready();
    double.seed("items", [
      { id: UUID_A, sku: "SKU-1", name: "Espresso", name_ar: "إسبريسو", kind: "STOCK", uom_id: null, category_id: null, tax_code_id: null, base_price: "12.0000", track_batch: 0, track_serial: 0, track_imei: 0, status: "ACTIVE", updated_at: null, dirty: 0, version: 1 },
      { id: UUID_B, sku: "SKU-2", name: "Old cup", name_ar: null, kind: "STOCK", uom_id: null, category_id: null, tax_code_id: null, base_price: "3.0000", track_batch: 0, track_serial: 0, track_imei: 0, status: "ARCHIVED", updated_at: null, dirty: 0, version: 1 },
    ]);
    double.seed("partners", [
      { id: UUID_A, code: "P-000001", name: "Rain Co", name_ar: "شركة المطر", kind: "CUSTOMER", status: "ACTIVE", credit_limit: null, price_list_id: null, tax_number: null, updated_at: null, version: 1 },
    ]);
    const items = await readCachedItems(bridge);
    expect(items.map((item) => item.sku)).toEqual(["SKU-1"]);
    const byArabic = await searchMasterData(bridge, "items", "إسبريسو");
    expect(byArabic).toHaveLength(1);
    const partners = await readCachedPartners(bridge);
    expect(partners[0]!.nameAr).toBe("شركة المطر");
    const byCode = await searchMasterData(bridge, "partners", "P-000001");
    expect(byCode).toHaveLength(1);
  });

  it("exposes only DRAFT count sessions (online-created, snapshot frozen server-side)", async () => {
    const { double, bridge } = ready();
    double.seed("stock_counts", [
      { id: UUID_A, doc_no: "CNT-1", status: "DRAFT", counted_at: null, payload: "{}", version: 1, updated_at: null, dirty: 0 },
      { id: UUID_B, doc_no: "CNT-2", status: "COUNTED", counted_at: null, payload: "{}", version: 1, updated_at: null, dirty: 0 },
    ]);
    const sessions = await readCachedCountSessions(bridge);
    expect(sessions.map((session) => session.docNo)).toEqual(["CNT-1"]);
  });

  it("reads meta keys (machinery state)", async () => {
    const { double, bridge } = ready();
    expect(await readMeta(bridge, "contractGate")).toBeNull();
    double.seed("meta", [{ key: "contractGate", value: "read-only" }]);
    expect(await readMeta(bridge, "contractGate")).toBe("read-only");
  });
});

describe("unlockSnapshot (D-04 — 1-b's semantics against async reads)", () => {
  const NOW = new Date("2026-11-04T12:00:00.000Z");

  it("NO_SNAPSHOT when the watermark is absent", async () => {
    const { bridge } = ready();
    expect(await unlockSnapshot(bridge, NOW)).toEqual({ mode: "readonly", reason: "NO_SNAPSHOT" });
  });

  it("SNAPSHOT_EXPIRED strictly beyond 7 days (8 days here)", async () => {
    const { double, bridge } = ready();
    double.seed("meta", [
      { key: "permissionSnapshotAt", value: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() },
    ]);
    const decision = await unlockSnapshot(bridge, NOW);
    expect(decision.mode).toBe("readonly");
    if (decision.mode === "readonly" && decision.reason === "SNAPSHOT_EXPIRED") {
      expect(decision.snapshotAt.getTime()).toBe(NOW.getTime() - 8 * 86_400_000);
    } else {
      throw new Error("expected SNAPSHOT_EXPIRED");
    }
  });

  it("full mode within 7 days, carrying the cached keys (6d23h)", async () => {
    const { double, bridge } = ready();
    double.seed("meta", [
      { key: "permissionSnapshotAt", value: String(NOW.getTime() - 6 * 86_400_000 - 23 * 3_600_000) },
    ]);
    double.seed("permissions", [{ key: "sales.quotes.send" }, { key: "inventory.counts.enter" }]);
    const decision = await unlockSnapshot(bridge, NOW);
    expect(decision).toEqual({
      mode: "full",
      permissions: ["sales.quotes.send", "inventory.counts.enter"],
      snapshotAt: new Date(NOW.getTime() - 6 * 86_400_000 - 23 * 3_600_000),
    });
  });

  it("normalizes ISO, numeric-string, and epoch forms like 1-b", async () => {
    const { double, bridge } = ready();
    const iso = new Date(NOW.getTime() - 86_400_000).toISOString();
    double.seed("meta", [{ key: "permissionSnapshotAt", value: iso }]);
    const viaIso = await unlockSnapshot(bridge, NOW);
    double.seed("meta", [{ key: "permissionSnapshotAt", value: String(Date.parse(iso)) }]);
    const viaEpoch = await unlockSnapshot(bridge, NOW);
    expect(viaIso.mode).toBe("full");
    expect(viaEpoch.mode).toBe("full");
  });
});

describe("the builders ride the enqueue path end to end", () => {
  it("a full partner:create draft command satisfies the outbox + projection contract", async () => {
    const { double, bridge } = ready();
    const localId = generateUuidV7();
    const command = buildPartnerCreate({
      kind: "SUPPLIER",
      code: "SUP-9",
      name: "Gulf Parts",
      nameAr: "قطع الخليج",
      creditLimit: "5000.0000",
    });
    await enqueueDraftCommand(bridge, command, {
      localId,
      docType: "partner_create",
      entityId: null,
      payload: command.payload,
      initialStatus: "DRAFT_LOCAL",
    });
    const outbox = double.tables.get("outbox")!.get(command.commandId)!;
    expect(outbox.payload).toContain("Gulf Parts");
    expect(outbox.idempotency_key).toMatch(/^partner:create:[0-9a-f-]{36}$/);
  });
});
