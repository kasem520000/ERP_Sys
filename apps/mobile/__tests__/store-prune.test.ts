import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { enqueue } from "@erp/sync-core";

import {
  FIELD_BUSINESS_TABLES,
  PERSONAL_READ_MODELS,
  mobileStoreBytes,
  openFieldStore,
  openPersonalStore,
  pruneMobileStore,
  PRUNE_BATCH_ROWS,
  type MobileStore,
} from "../src/store";
import type { SqliteDriverPort } from "../src/store/driver-port";
import { createNodeDriver } from "../src/store/node-driver";
import { MOBILE_STORAGE_BUDGET_BYTES, SYNC_FOREGROUND_INTERVAL_MS } from "../src/constants";

/**
 * PHASE-022 · the byte-exact pruning suite (T2-a; the DR-P21-03 port
 * under the 128 MB golden constant; LOCAL_DATABASE §5/§5.2): the
 * pruning surface semantics per profile (never machinery, never dirty,
 * write-set rows only after server ack, oldest-synced first), the
 * identifier allowlist guard, `tableBytes` via dbstat, the budget loop
 * with a tiny simulated budget, the 128 MB default, and the
 * fake-dbststat driver seam (the prune loop honors whatever the DRIVER
 * measures — the port is the measurement authority). All against REAL
 * SQLite files.
 */

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-prune-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

function insertVanStock(
  store: MobileStore,
  id: string,
  updatedAt: string,
  dirty: number,
): void {
  store.run(
    "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, version, updated_at, dirty) VALUES (?, 'wh-1', 'item-1', '1.000000', '1.0000', '{}', 1, ?, ?)",
    [id, updatedAt, dirty],
  );
}

describe("deleteOldestSynced — LOCAL_DATABASE §5.2 semantics (per profile)", () => {
  it("field read caches: dirty rows are never pruned; clean rows go oldest-first", () => {
    const store = openFieldStore(tempDbPath("field-lru"));
    try {
      const insert = (id: string, updatedAt: string, dirty: number): void => {
        store.run(
          "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, version, updated_at, dirty) VALUES (?, 'wh-1', 'item-1', '1.000000', '1.0000', '{}', 1, ?, ?)",
          [id, updatedAt, dirty],
        );
      };
      insert("vs-dirty", "2026-11-01T00:00:00Z", 1); // oldest row, but dirty → precious
      insert("vs-clean-1", "2026-11-02T00:00:00Z", 0);
      insert("vs-clean-2", "2026-11-03T00:00:00Z", 0);
      insert("vs-clean-3", "2026-11-04T00:00:00Z", 0);
      expect(store.deleteOldestSynced("van_stocks", 2)).toBe(2);
      const remaining = store.all("SELECT id FROM van_stocks").map((r) => String(r.id));
      expect(remaining.sort()).toEqual(["vs-clean-3", "vs-dirty"]);
    } finally {
      store.close();
    }
  });

  it("pos_sales: PENDING_SYNC is precious, SYNCED is prunable (the 016 write-set parity)", () => {
    const store = openFieldStore(tempDbPath("possales"));
    try {
      store.run(
        `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, order_type, invoice_date,
            total_gross, tenders, lines, local_status, official_no, synced_at, created_at)
         VALUES ('sale-pending', 'OFF-1', 't1', 'COUNTER', '2026-11-04', '1', '[]', '[]', 'PENDING_SYNC', NULL, NULL, '2026-11-04T00:00:00Z')`,
      );
      store.run(
        `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, order_type, invoice_date,
            total_gross, tenders, lines, local_status, official_no, synced_at, created_at)
         VALUES ('sale-synced-old', 'OFF-2', 't1', 'COUNTER', '2026-11-04', '1', '[]', '[]', 'SYNCED', 'POS-1', '2026-11-02T00:00:00Z', '2026-11-04T00:00:00Z'),
                ('sale-synced-new', 'OFF-3', 't1', 'COUNTER', '2026-11-04', '1', '[]', '[]', 'SYNCED', 'POS-2', '2026-11-05T00:00:00Z', '2026-11-04T00:00:00Z')`,
      );
      expect(store.deleteOldestSynced("pos_sales", 1)).toBe(1);
      const ids = store.all("SELECT id FROM pos_sales").map((r) => String(r.id));
      expect(ids).toContain("sale-pending"); // precious — never pruned
      expect(ids).toContain("sale-synced-new"); // newest synced survives the partial batch
      expect(ids).not.toContain("sale-synced-old"); // oldest synced went first
    } finally {
      store.close();
    }
  });

  it("allowlist guard: machinery, unknown and injected table names are rejected LOUDLY", () => {
    const store = openFieldStore(tempDbPath("allowlist"));
    try {
      for (const table of ["outbox", "inbox", "cursors", "meta", "schema_migrations", "nope"]) {
        expect(() => store.deleteOldestSynced(table, 5)).toThrow(/not a prunable business table/);
      }
      // SQL-injection shaped identifiers never reach the SQL text.
      expect(() => store.deleteOldestSynced("items; DROP TABLE items", 5)).toThrow(
        /not a prunable business table/,
      );
      expect(() => store.deleteOldestSynced("items --", 5)).toThrow(/not a prunable business table/);
      // The store is intact after every refused attempt.
      expect(store.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'")).toHaveLength(1);
      expect(store.countRows("outbox")).toBe(0);
      // The personal profile's allowlist is its read models only.
      expect(() => store.deleteOldestSynced("sales_invoices", 5)).toThrow(/not a prunable business table/);
    } finally {
      store.close();
    }
  });

  it("listBusinessTables: the per-profile frozen allowlists — never machinery", () => {
    const field = openFieldStore(tempDbPath("list-field"));
    try {
      expect(field.listBusinessTables()).toEqual([...FIELD_BUSINESS_TABLES]);
      for (const forbidden of ["outbox", "inbox", "cursors", "meta", "schema_migrations"]) {
        expect(field.listBusinessTables()).not.toContain(forbidden);
      }
    } finally {
      field.close();
    }
    const personal = openPersonalStore(tempDbPath("list-personal"));
    try {
      expect(personal.listBusinessTables()).toEqual([...PERSONAL_READ_MODELS]);
      expect(personal.listBusinessTables()).not.toContain("outbox");
    } finally {
      personal.close();
    }
  });

  it("personal read models are prunable LRU (the personal profile has its own prune specs)", () => {
    const store = openPersonalStore(tempDbPath("personal-lru"));
    try {
      const insert = (id: string, updatedAt: string, dirty: number): void => {
        store.run(
          "INSERT INTO notifications (id, user_id, category, severity, title, body, payload, version, updated_at, dirty) VALUES (?, 'u-1', 'limits', 'info', '{}', '{}', '{}', 1, ?, ?)",
          [id, updatedAt, dirty],
        );
      };
      insert("n-dirty", "2026-11-01T00:00:00Z", 1);
      insert("n-clean-1", "2026-11-02T00:00:00Z", 0);
      insert("n-clean-2", "2026-11-03T00:00:00Z", 0);
      expect(store.deleteOldestSynced("notifications", 5)).toBe(2);
      const remaining = store.all("SELECT id FROM notifications").map((r) => String(r.id));
      expect(remaining).toEqual(["n-dirty"]);
    } finally {
      store.close();
    }
  });
});

describe("tableBytes — the DR-P21-03 byte measurement", () => {
  it("dbstat is live on this build: >0 for a seeded table; 0 for empty and missing; whole pages", () => {
    const store = openFieldStore(tempDbPath("bytes"));
    try {
      expect(store.info.byteMeasurement).toBe("dbstat");
      store.run(
        "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, version, updated_at, dirty) VALUES (?, 'wh-1', 'item-1', '1.000000', '1.0000', ?, 1, '2026-11-04T00:00:00Z', 0)",
        ["vs-fat", `fat row payload ${"x".repeat(2000)}`],
      );
      expect(store.tableBytes("van_stocks")).toBeGreaterThan(0);
      expect(store.tableBytes("van_stocks") % 4096).toBe(0); // whole pages, byte-exact
      // Existing-but-empty table → 0 data bytes; missing table → 0, no throw.
      expect(store.tableBytes("routes")).toBe(0);
      expect(store.tableBytes("no_such_table")).toBe(0);
      // dbstatBytes: the footprint across the whole business set.
      expect(store.dbstatBytes()).toBe(store.tableBytes("van_stocks"));
      // The identifier guard applies to measurements too.
      expect(() => store.tableBytes("van_stocks; DROP TABLE van_stocks")).toThrow(/not a valid table identifier/);
      expect(() => store.countRows("van_stocks; DROP TABLE van_stocks")).toThrow(/not a valid table identifier/);
    } finally {
      store.close();
    }
  });
});

describe("pruneMobileStore — the byte-exact 128 MB budget loop", () => {
  it("tiny budget: deletes oldest in LRU batches, keeps dirty + machinery, converges honestly", () => {
    const path = tempDbPath("budget");
    const store = openFieldStore(path);
    try {
      // 600 fat van_stocks rows (~2 KB each), every 120th dirty — the
      // dirty rows are the oldest-of-their-page guards.
      store.transaction(() => {
        for (let i = 0; i < 600; i += 1) {
          store.run(
            "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, version, updated_at, dirty) VALUES (?, 'wh-1', 'item-1', '1.000000', '1.0000', ?, 1, ?, ?)",
            [
              `vs-${String(i).padStart(4, "0")}`,
              `Item ${i} ${"x".repeat(2000)}`,
              new Date(1_760_000_000_000 + i * 60_000).toISOString(),
              i % 120 === 0 ? 1 : 0,
            ],
          );
        }
        // Machinery that must survive ANY pruning: a real outbox command
        // (through the sync-core engine, the production writer) + cursors.
        enqueue(store, {
          entityType: "pos_sale",
          intent: "create",
          payload: { clientId: "prune-guard" },
          idempotencyKey: "prune-machinery-guard-1",
        });
        store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('van_stocks', '5', 0)");
      });

      const startBytes = mobileStoreBytes(store);
      expect(startBytes).toBeGreaterThan(0);
      // Byte math (not money): an integer floor via modulo — the repo's
      // ADR-0009 rule bans Math.floor for float-rounding reasons.
      const budgetBytes = startBytes * 0.55 - ((startBytes * 0.55) % 1); // must shed ~45%

      const result = pruneMobileStore(store, { budgetBytes });
      expect(result.estimated).toBe(false); // dbstat-exact on this build
      expect(result.stillOverBudget).toBe(false); // converged under budget
      expect(result.freedBytes).toBeGreaterThan(0);
      expect(mobileStoreBytes(store)).toBeLessThanOrEqual(budgetBytes);
      // The per-table row ledger matches the actual deletions.
      const rowsDeleted = Object.values(result.perTable).reduce((sum, n) => sum + n, 0);
      expect(rowsDeleted).toBe(600 - store.countRows("van_stocks"));
      expect(result.iterations).toBeGreaterThan(0);
      // Batch shape: at most PRUNE_BATCH_ROWS per table per LRU pass.
      expect(Object.values(result.perTable)[0]).toBeLessThanOrEqual(result.iterations * PRUNE_BATCH_ROWS);

      // Oldest-first: the earliest clean rows are gone, the newest remain.
      const remaining = store.all("SELECT id FROM van_stocks ORDER BY id").map((r) => String(r.id));
      expect(remaining).not.toContain("vs-0001");
      expect(remaining).not.toContain("vs-0100");
      expect(remaining).toContain("vs-0599");
      // Every dirty row survived.
      expect(store.all("SELECT id FROM van_stocks WHERE dirty = 1")).toHaveLength(5);
      // Machinery NEVER pruned.
      expect(store.countRows("outbox")).toBe(1);
      expect(store.countRows("cursors")).toBe(1);
      expect(store.all("SELECT entity_type FROM cursors")).toEqual([{ entity_type: "van_stocks" }]);
    } finally {
      store.close();
    }
  });

  it("the 128 MB default: an ordinary store is an honest no-op pass", () => {
    const store = openFieldStore(tempDbPath("default-budget"));
    try {
      insertVanStock(store, "vs-1", "2026-11-04T00:00:00Z", 0);
      // No opts → the MOBILE_STORAGE_BUDGET_BYTES default (128 MB).
      expect(pruneMobileStore(store)).toEqual({
        freedBytes: 0,
        estimated: false,
        perTable: {},
        iterations: 0,
        stillOverBudget: false,
      });
      expect(store.countRows("van_stocks")).toBe(1);
      // The golden constants the budget + schedule ride (spot).
      expect(MOBILE_STORAGE_BUDGET_BYTES).toBe(134_217_728);
      expect(SYNC_FOREGROUND_INTERVAL_MS).toBe(120_000);
    } finally {
      store.close();
    }
  });

  it("nothing prunable (all rows dirty) → stillOverBudget is reported honestly, never a silent pass", () => {
    const store = openFieldStore(tempDbPath("stuck"));
    try {
      store.run(
        "INSERT INTO van_stocks (id, warehouse_id, item_id, qty, value, payload, version, updated_at, dirty) VALUES (?, 'wh-1', 'item-1', '1.000000', '1.0000', ?, 1, '2026-11-04T00:00:00Z', 1)",
        ["vs-dirty", `fat ${"x".repeat(4000)}`],
      );
      const result = pruneMobileStore(store, { budgetBytes: 1024 }); // impossibly small
      expect(result.perTable).toEqual({});
      expect(result.freedBytes).toBe(0);
      expect(result.iterations).toBe(1);
      expect(result.stillOverBudget).toBe(true); // the loud honest flag
      expect(store.countRows("van_stocks")).toBe(1); // the dirty row survived
    } finally {
      store.close();
    }
  });

  it("the fake-dbststat driver seam: the loop honors whatever the DRIVER measures (the port is the authority)", () => {
    // A driver wrapper reporting a FIXED per-table footprint — the prune
    // loop must converge on the DRIVER's numbers, not the real dbstat
    // (the honest seam: a device driver without dbstat degrades the
    // same way, reported as estimated row-approx there).
    const path = tempDbPath("fake-dbststat");
    const realDriver = createNodeDriver();
    const reported = new Map<string, number>();
    const fakeDriver: SqliteDriverPort = {
      open: (p, key) => realDriver.open(p, key),
      close: () => realDriver.close(),
      get isOpen() {
        return realDriver.isOpen;
      },
      run: (sql, params) => realDriver.run(sql, params),
      all: (sql, params) => realDriver.all(sql, params),
      get: (sql, params) => realDriver.get(sql, params),
      transaction: (fn) => realDriver.transaction(fn),
      pragma: (stmt) => realDriver.pragma(stmt),
      tableBytes: (table) => {
        if (!realDriver.isOpen) throw new Error("fake driver closed");
        const rows = realDriver.get(`SELECT count(*) AS n FROM ${table}`) as { n: number } | undefined;
        const count = rows === undefined ? 0 : Number(rows.n);
        const bytes = count * 3_000; // the fake measurement: 3 KB per row
        reported.set(table, bytes);
        return bytes;
      },
      get byteMeasurement() {
        return "row-approx" as const; // the honest degraded report
      },
      integrityCheck: () => realDriver.integrityCheck(),
    };
    const store = openFieldStore(path, { driver: fakeDriver });
    try {
      for (let i = 0; i < 100; i += 1) {
        insertVanStock(store, `vs-${i}`, new Date(1_760_000_000_000 + i * 60_000).toISOString(), 0);
      }
      expect(store.info.byteMeasurement).toBe("row-approx"); // the honest report
      // 100 rows × 3 KB = 300 KB reported; budget 150 KB → must shed ~half.
      const result = pruneMobileStore(store, { budgetBytes: 150_000 });
      expect(result.estimated).toBe(true); // never claims exactness it did not measure
      expect(result.stillOverBudget).toBe(false);
      expect(result.freedBytes).toBeGreaterThan(0);
      expect(result.perTable["van_stocks"]).toBeGreaterThan(0);
      // The measured footprint (by the DRIVER's own numbers) is under budget.
      expect(mobileStoreBytes(store)).toBeLessThanOrEqual(150_000);
      // And the loop really deleted rows (the store's own count).
      expect(store.countRows("van_stocks")).toBeLessThan(100);
    } finally {
      store.close();
    }
  });
});
