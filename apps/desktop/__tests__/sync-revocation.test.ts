import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyResult,
  buildSyncCommandV2,
  enqueue,
  maintainCursorCount,
  markQueueUnresolvable,
  metaGet,
  metaSet,
  queueUnresolvableReason,
  recoveryPass,
} from "@erp/sync-core";

import { openDesktopStore, DESKTOP_BUSINESS_TABLES, type DesktopStore } from "../src/store";
import { purgeOnRevocation, REVOCATION_PURGED_TABLES, type PurgeReport } from "../src/sync";

/**
 * PHASE-021 · the D-01 revocation purge suite (T4; MASTER-PLAN §5;
 * SECURITY_AND_DEVICE_MANAGEMENT §4 + §6.2 — the BINDING rule: "purge
 * local tenant data (outbox included — its commands are already
 * server-rejected by policy) and require online re-login"; LOCAL_DATABASE
 * §5.2 local_events exclusion; FAILURE_RECOVERY §2.4's audited
 * exception): a REAL temp SQLite store seeded across every table family —
 * business caches, the draft write set, the outbox (one ACKED command via
 * the real engine, one QUEUED), cursors + checksums, local_events, and
 * the identity meta keys — purged, then asserted table by table with the
 * honest report. Only the purge is exercised here (nothing is faked).
 */

const workDirs: string[] = [];
const openStores: DesktopStore[] = [];

afterAll(() => {
  for (const store of openStores) store.close();
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

function seededStore(): DesktopStore {
  const dir = mkdtempSync(join(tmpdir(), "erp-desktop-syncrevocation-"));
  workDirs.push(dir);
  const store = openDesktopStore({ path: join(dir, "store.sqlite") });
  openStores.push(store);

  // Read caches (the v1 pull-projection columns).
  for (let index = 1; index <= 3; index += 1) {
    store.run(
      "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, 'STOCK', 'ACTIVE', ?, 0, 1)",
      [`item-${index}`, `SKU-${index}`, `Item ${index}`, "2026-11-04T00:00:00Z"],
    );
  }
  store.run(
    "INSERT INTO partners (id, code, name, kind, status) VALUES (?, ?, ?, 'CUSTOMER', 'ACTIVE')",
    ["partner-1", "P-1", "Partner 1"],
  );
  // The v4 desktop read cache.
  store.run(
    "INSERT INTO sales_invoices (id, doc_no, status, payload, version, updated_at, dirty) VALUES (?, ?, 'DRAFT', ?, 4, ?, 0)",
    ["inv-1", "DRF-1", JSON.stringify({ id: "inv-1" }), "2026-11-04T00:00:00Z"],
  );
  // The desktop write set (the unified draft store).
  store.run(
    "INSERT INTO draft_docs (local_id, doc_type, payload, local_status, updated_at) VALUES (?, 'invoice', ?, 'DRAFT_LOCAL', ?)",
    ["draft-1", JSON.stringify({ lines: [] }), "2026-11-04T00:00:00Z"],
  );
  store.run(
    "INSERT INTO draft_docs (local_id, doc_type, payload, local_status, updated_at) VALUES (?, 'invoice', ?, 'PENDING_MERGE', ?)",
    ["draft-2", JSON.stringify({ lines: [] }), "2026-11-04T00:00:00Z"],
  );
  // The 016 write set.
  store.run(
    `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, order_type, invoice_date, total_gross,
        tenders, lines, local_status, created_at) VALUES (?, ?, ?, 'COUNTER', '2026-11-04', '12.00', '[]', '[]', 'PENDING_SYNC', ?)`,
    ["sale-1", "OFF-T1-00001", "21212121-3333-4333-8333-333333333331", "2026-11-04T00:00:00Z"],
  );

  // The outbox through the REAL engine: one command ACKED (inbox mirror
  // recorded), one left QUEUED — both are purged by D-01.
  const acked = buildSyncCommandV2({
    entityType: "partner",
    intent: "contact_merge",
    payload: { partnerId: "partner-1", phone: "+97330000000" },
    idempotencyKey: "partner:contact_merge:acked",
  });
  const queued = buildSyncCommandV2({
    entityType: "sales_invoice",
    intent: "create_draft",
    payload: { customerId: null, orderDate: "2026-11-04", lines: [] },
    idempotencyKey: "sales_invoice:create_draft:queued",
  });
  store.transaction(() => {
    enqueue(store, {
      entityType: acked.entityType,
      intent: acked.intent,
      payload: acked as unknown as Record<string, unknown>,
      idempotencyKey: acked.idempotencyKey,
      commandId: acked.commandId,
    });
    enqueue(store, {
      entityType: queued.entityType,
      intent: queued.intent,
      payload: queued as unknown as Record<string, unknown>,
      idempotencyKey: queued.idempotencyKey,
      commandId: queued.commandId,
    });
  });
  applyResult(store, {
    commandId: acked.commandId,
    status: "ACCEPTED",
    officialNo: "INV-2611-00001",
    acceptedResult: { officialNo: "INV-2611-00001" },
  });

  // Cursors + the integrity checksum.
  store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('items', '3', 0)");
  store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('partners', '1', 0)");
  maintainCursorCount(store);

  // The audit trail: two local_events — one with a tenant-data payload,
  // one without. The ROWS survive; the payload CONTENT is scrubbed.
  store.run(
    "INSERT INTO local_events (kind, choice, reason, trace_id, command_id, payload, at) VALUES (?, 'ACCEPT_SERVER_PRICE', 'PRICE_CHANGED', 'trace-1', ?, ?, ?)",
    [
      "rejection_choice",
      acked.commandId,
      JSON.stringify({ before: "10.00", after: "11.00", partnerId: "partner-1" }),
      "2026-11-04T00:00:00Z",
    ],
  );
  store.run(
    "INSERT INTO local_events (kind, choice, reason, trace_id, command_id, at) VALUES (?, 'CANCEL_WITH_REASON', 'ITEM_INACTIVE', 'trace-2', ?, ?)",
    ["rejection_choice", queued.commandId, "2026-11-04T00:01:00Z"],
  );

  // Identity + queue-state meta (the D-01 reset targets).
  metaSet(store, "enrolledDeviceId", "21212121-1111-4111-8111-111111111111");
  metaSet(store, "permissionSnapshotAt", String(Date.now()));
  markQueueUnresolvable(store, "DEVICE_REVOKED");
  return store;
}

describe("purgeOnRevocation — D-01 (SECURITY_AND_DEVICE_MANAGEMENT §6.2)", () => {
  it("empties every business table + the outbox + inbox + cursors with honest per-table counts", () => {
    const store = seededStore();
    const purged = purgeOnRevocation(store);

    // The exhaustive purged-table list: the frozen business allowlist +
    // outbox + inbox + cursors — nothing else, never machinery structure.
    expect(REVOCATION_PURGED_TABLES).toEqual([...DESKTOP_BUSINESS_TABLES, "outbox", "inbox", "cursors"]);
    expect(Object.keys(purged.tables).sort()).toEqual([...REVOCATION_PURGED_TABLES].sort());

    // Honest counts, table by table.
    expect(purged.tables["items"]).toBe(3);
    expect(purged.tables["partners"]).toBe(1);
    expect(purged.tables["sales_invoices"]).toBe(1);
    expect(purged.tables["draft_docs"]).toBe(2);
    expect(purged.tables["pos_sales"]).toBe(1);
    expect(purged.tables["outbox"]).toBe(2); // ACKED + QUEUED — both purged (§6.2)
    expect(purged.tables["inbox"]).toBe(1);
    expect(purged.tables["cursors"]).toBe(2);

    // Everything actually empty.
    for (const table of REVOCATION_PURGED_TABLES) {
      expect(store.countRows(table)).toBe(0);
    }

    // local_events: the audit trail SURVIVES, payloads scrubbed.
    expect(purged.localEventsKept).toBe(2);
    expect(purged.localEventsPayloadsScrubbed).toBe(1);
    expect(store.countRows("local_events")).toBe(2);
    for (const row of store.all("SELECT payload FROM local_events")) {
      expect(row.payload).toBeNull();
    }

    // Meta: the identity reset, honestly reported.
    expect(purged.metaKeysDeleted).toEqual(
      expect.arrayContaining(["enrolledDeviceId", "permissionSnapshotAt", "queueUnresolvable"]),
    );
    expect(metaGet(store, "enrolledDeviceId")).toBeNull();
    expect(metaGet(store, "permissionSnapshotAt")).toBeNull();
    expect(queueUnresolvableReason(store)).toBeNull();
    expect(purged.metaKeysKept).toEqual(
      expect.arrayContaining(["contractVersion", "deviceClass", "rolloutChannel", "cursorCount", "inboxCount"]),
    );
    // The store's compiled-in contract floor STAYS (LOCAL_DATABASE §2).
    expect(metaGet(store, "contractVersion")).toBe("2026-11-04.1");

    // Integrity checksums recomputed — the next recoveryPass is clean.
    expect(metaGet(store, "cursorCount")).toBe("0");
    expect(metaGet(store, "inboxCount")).toBe("0");
    expect(recoveryPass(store).integrity).toBe("ok");

    // Machinery structure intact: the migration history survived.
    expect(
      store.all("SELECT version FROM schema_migrations ORDER BY version").map((row) => Number(row.version)),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(purged.purgedAt).toBeDefined();
  });

  it("is idempotent: a second purge reports zeros and keeps the audit trail", () => {
    const store = seededStore();
    purgeOnRevocation(store);
    const second = purgeOnRevocation(store);
    for (const count of Object.values(second.tables)) {
      expect(count).toBe(0);
    }
    expect(second.localEventsKept).toBe(2);
    expect(second.localEventsPayloadsScrubbed).toBe(0);
    expect(second.metaKeysDeleted).toEqual([]);
    expect(second.metaKeysKept).toEqual(
      expect.arrayContaining(["contractVersion", "deviceClass", "rolloutChannel"]),
    );
  });

  it("scrubs EVERY local_events payload when all rows carry one", () => {
    const store = seededStore();
    store.run(
      "INSERT INTO local_events (kind, choice, payload, at) VALUES (?, 'EDIT_AND_RESEND', ?, ?)",
      ["rejection_choice", JSON.stringify({ note: "tenant data" }), "2026-11-04T00:02:00Z"],
    );
    const purged = purgeOnRevocation(store);
    expect(purged.localEventsKept).toBe(3);
    expect(purged.localEventsPayloadsScrubbed).toBe(2); // both payload-bearing rows
    for (const row of store.all("SELECT payload FROM local_events")) {
      expect(row.payload).toBeNull();
    }
  });

  it("the report shape is the documented one (tables/kept/scrubbed/meta/at)", () => {
    const store = seededStore();
    const purged: PurgeReport = purgeOnRevocation(store);
    expect(typeof purged.purgedAt).toBe("string");
    expect(Number.isNaN(Date.parse(purged.purgedAt))).toBe(false);
    for (const [table, count] of Object.entries(purged.tables)) {
      expect(typeof table).toBe("string");
      expect(count).toBeGreaterThanOrEqual(0);
    }
    expect(Array.isArray(purged.metaKeysDeleted)).toBe(true);
    expect(Array.isArray(purged.metaKeysKept)).toBe(true);
  });
});
