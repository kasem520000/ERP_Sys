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

import {
  FIELD_BUSINESS_TABLES,
  PERSONAL_READ_MODELS,
  openFieldStore,
  openPersonalStore,
  type MobileStore,
} from "../src/store";
import {
  purgeOnRevocation,
  revocationPurgedTables,
  FIELD_REVOCATION_PURGED_TABLES,
  PERSONAL_REVOCATION_PURGED_TABLES,
  REVOCATION_DELETED_META_KEYS,
  type PurgeReport,
} from "../src/sync";

/**
 * PHASE-022 · the D-01 revocation purge suite (T2-a; MASTER-PLAN §7; the
 * binding rule: "purge local tenant data (outbox included — its commands
 * are already server-rejected by policy) and require online re-login";
 * SECURITY_AND_DEVICE_MANAGEMENT §4 + §6.2): REAL temp SQLite stores
 * seeded across every table family per profile — the field store's
 * business caches (POS base + the v4 field caches + the pos_sales write
 * set) + the outbox (one ACKED command via the real engine, one QUEUED)
 * + cursors + checksums + the identity meta keys; the personal store's
 * read models + cursors (no outbox exists — honest zeros, never a
 * throw) — purged, then asserted table by table with the honest report.
 * Only the purge is exercised here (nothing is faked).
 */

const workDirs: string[] = [];
const openStores: MobileStore[] = [];

afterAll(() => {
  for (const store of openStores) store.close();
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

function seededFieldStore(): MobileStore {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-revocation-field-"));
  workDirs.push(dir);
  const store = openFieldStore(join(dir, "store.sqlite"));
  openStores.push(store);

  // Read caches (the v1 pull-projection columns + the v4 field caches).
  for (let index = 1; index <= 3; index += 1) {
    store.run(
      "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, 'STOCK', 'ACTIVE', ?, 0, 1)",
      [`item-${index}`, `SKU-${index}`, `Item ${index}`, "2026-11-04T00:00:00Z"],
    );
  }
  store.run(
    "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, version, updated_at, dirty) VALUES (?, 'wh-1', 'item-1', '10.000000', '600.0000', '{}', 1, '2026-11-04T00:00:00Z', 0)",
    ["vs-1"],
  );
  store.run(
    "INSERT INTO statements (id, customer_code, customer_name, opening_balance, payload, updated_at) VALUES ('partner-1', 'P-1', 'Partner 1', '10.0000', '{}', '2026-11-04T00:00:00Z')",
  );
  // The 016 write set.
  store.run(
    `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, order_type, invoice_date, total_gross,
        tenders, lines, local_status, created_at) VALUES (?, ?, ?, 'COUNTER', '2026-11-04', '12.00', '[]', '[]', 'PENDING_SYNC', ?)`,
    ["sale-1", "OFF-T1-00001", "31313131-3333-4333-8333-333333333331", "2026-11-04T00:00:00Z"],
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
    officialNo: "SAL-2026-000001",
    acceptedResult: { officialNo: "SAL-2026-000001" },
  });

  // Cursors + the integrity checksum.
  store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('items', '3', 0)");
  store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('van_stocks', '1', 0)");
  maintainCursorCount(store);

  // Identity + queue-state meta (the D-01 reset targets).
  metaSet(store, "enrolledDeviceId", "31313131-1111-4111-8111-111111111111");
  metaSet(store, "permissionSnapshotAt", String(Date.now()));
  markQueueUnresolvable(store, "DEVICE_REVOKED");
  return store;
}

function seededPersonalStore(): MobileStore {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-revocation-personal-"));
  workDirs.push(dir);
  const store = openPersonalStore(join(dir, "store.sqlite"));
  openStores.push(store);

  // The personal read models + the cursors (the profile's whole state —
  // there is no outbox/inbox by construction, DR-P22-08b).
  store.run(
    "INSERT INTO statements (id, customer_code, customer_name, opening_balance, payload, updated_at) VALUES ('partner-1', 'P-1', 'Partner 1', '100.0000', '{}', '2026-11-04T00:00:00Z')",
  );
  store.run(
    "INSERT INTO receipts (id, status, partner_id, method, amount, value_date, payload, updated_at) VALUES ('rc-1', 'POSTED', 'partner-1', 'CASH', '250.0000', '2026-11-04', '{}', '2026-11-04T00:00:00Z')",
  );
  store.run(
    "INSERT INTO notifications (id, user_id, category, severity, title, body, payload, updated_at) VALUES ('n-1', 'u-1', 'limits', 'info', '{}', '{}', '{}', '2026-11-04T00:00:00Z')",
  );
  store.run(
    "INSERT INTO sales_invoices (id, status, customer_id, order_date, total_amount, currency, payload, updated_at) VALUES ('inv-1', 'DRAFT', 'partner-1', '2026-11-04', '120.0000', 'SAR', '{}', '2026-11-04T00:00:00Z')",
  );
  store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('statements', '3', 0)");
  maintainCursorCount(store);
  metaSet(store, "enrolledDeviceId", "31313131-1111-4111-8111-111111111112");
  metaSet(store, "permissionSnapshotAt", String(Date.now()));
  return store;
}

describe("purgeOnRevocation — D-01, field profile (SECURITY_AND_DEVICE_MANAGEMENT §6.2)", () => {
  it("empties every business table + the outbox + inbox + cursors with honest per-table counts", () => {
    const store = seededFieldStore();
    const purged = purgeOnRevocation(store);

    // The exhaustive purged-table list: the frozen per-profile allowlist +
    // outbox + inbox + cursors — nothing else, never machinery structure.
    expect(FIELD_REVOCATION_PURGED_TABLES).toEqual([...FIELD_BUSINESS_TABLES, "outbox", "inbox", "cursors"]);
    expect(revocationPurgedTables("android-field")).toEqual(FIELD_REVOCATION_PURGED_TABLES);
    expect(Object.keys(purged.tables).sort()).toEqual([...FIELD_REVOCATION_PURGED_TABLES].sort());

    // Honest counts, table by table.
    expect(purged.tables["items"]).toBe(3);
    expect(purged.tables["van_stocks"]).toBe(1);
    expect(purged.tables["statements"]).toBe(1);
    expect(purged.tables["pos_sales"]).toBe(1);
    expect(purged.tables["outbox"]).toBe(2); // ACKED + QUEUED — both purged (§6.2)
    expect(purged.tables["inbox"]).toBe(1);
    expect(purged.tables["cursors"]).toBe(2);

    // Everything actually empty.
    for (const table of FIELD_REVOCATION_PURGED_TABLES) {
      expect(store.countRows(table)).toBe(0);
    }

    // Meta: the identity reset, honestly reported.
    expect(purged.metaKeysDeleted).toEqual(
      expect.arrayContaining(["enrolledDeviceId", "permissionSnapshotAt", "queueUnresolvable"]),
    );
    expect(metaGet(store, "enrolledDeviceId")).toBeNull();
    expect(metaGet(store, "permissionSnapshotAt")).toBeNull();
    expect(queueUnresolvableReason(store)).toBeNull();
    expect(purged.metaKeysKept).toEqual(
      expect.arrayContaining([
        "contractVersion", "deviceClass", "storageBudgetBytes", "cursorCount", "inboxCount",
      ]),
    );
    // The store's compiled-in contract floor STAYS (LOCAL_DATABASE §2).
    expect(metaGet(store, "contractVersion")).toBe("2026-11-04.1");
    expect(metaGet(store, "deviceClass")).toBe("android-field");

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

  it("is idempotent: a second purge reports zeros", () => {
    const store = seededFieldStore();
    purgeOnRevocation(store);
    const second = purgeOnRevocation(store);
    for (const count of Object.values(second.tables)) {
      expect(count).toBe(0);
    }
    expect(second.metaKeysDeleted).toEqual([]);
    expect(second.metaKeysKept).toEqual(
      expect.arrayContaining(["contractVersion", "deviceClass", "storageBudgetBytes"]),
    );
  });

  it("the report shape is the documented one (tables/meta/at)", () => {
    const store = seededFieldStore();
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

describe("purgeOnRevocation — D-01, personal profile (the read models + cursors)", () => {
  it("empties the read models + the cursors; there is no outbox to purge (honest zeros, never a throw)", () => {
    const store = seededPersonalStore();
    const purged = purgeOnRevocation(store);

    // The exhaustive purged-table list for personal: the read models +
    // cursors ONLY — no outbox/inbox rows exist to purge.
    expect(PERSONAL_REVOCATION_PURGED_TABLES).toEqual([...PERSONAL_READ_MODELS, "cursors"]);
    expect(revocationPurgedTables("android-personal")).toEqual(PERSONAL_REVOCATION_PURGED_TABLES);
    expect(Object.keys(purged.tables).sort()).toEqual([...PERSONAL_REVOCATION_PURGED_TABLES].sort());

    // Honest counts.
    expect(purged.tables["statements"]).toBe(1);
    expect(purged.tables["receipts"]).toBe(1);
    expect(purged.tables["notifications"]).toBe(1);
    expect(purged.tables["sales_invoices"]).toBe(1);
    expect(purged.tables["cursors"]).toBe(1);

    // Everything actually empty.
    for (const table of PERSONAL_REVOCATION_PURGED_TABLES) {
      expect(store.countRows(table)).toBe(0);
    }

    // Meta: the identity reset; queueUnresolvable never existed on
    // personal (no queue by construction) — honestly absent from the
    // deleted list.
    expect(purged.metaKeysDeleted).toEqual(
      expect.arrayContaining(["enrolledDeviceId", "permissionSnapshotAt"]),
    );
    expect(purged.metaKeysDeleted).not.toContain("queueUnresolvable");
    expect(metaGet(store, "enrolledDeviceId")).toBeNull();
    expect(metaGet(store, "deviceClass")).toBe("android-personal");
    expect(metaGet(store, "contractVersion")).toBe("2026-11-04.1");

    // Integrity checksums recomputed (cursorCount only — no inbox exists,
    // so recoveryPass itself is NOT runnable on personal: its inbox read
    // would throw "no such table" — the honest profile boundary).
    expect(metaGet(store, "cursorCount")).toBe("0");
    expect(metaGet(store, "inboxCount")).toBeNull();

    // Machinery structure intact: the personal chain survived.
    expect(
      store.all("SELECT version FROM schema_migrations ORDER BY version").map((row) => Number(row.version)),
    ).toEqual([1, 2]);
  });

  it("is idempotent on the personal profile too", () => {
    const store = seededPersonalStore();
    purgeOnRevocation(store);
    const second = purgeOnRevocation(store);
    for (const count of Object.values(second.tables)) {
      expect(count).toBe(0);
    }
    expect(second.metaKeysDeleted).toEqual([]);
  });
});

describe("the purge lists are the frozen identifiers (the injection guard)", () => {
  it("every name in both lists is a bare SQL identifier", () => {
    const pattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (const table of [...FIELD_REVOCATION_PURGED_TABLES, ...PERSONAL_REVOCATION_PURGED_TABLES, ...REVOCATION_DELETED_META_KEYS]) {
      expect(pattern.test(table)).toBe(true);
    }
  });
});
