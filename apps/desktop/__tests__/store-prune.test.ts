import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { enqueue } from "@erp/sync-core";

import {
  DESKTOP_BUSINESS_TABLES,
  desktopStoreBytes,
  openDesktopStore,
  pruneDesktopStore,
  PRUNE_BATCH_ROWS,
} from "../src/store";

/**
 * PHASE-021 · the byte-exact pruning suite (DR-P21-03; MASTER-PLAN §3;
 * LOCAL_DATABASE §5/§5.2): the pruning surface semantics (never
 * machinery, never dirty, write-set rows only after server ack,
 * oldest-synced first), the identifier allowlist guard, `tableBytes`
 * via dbstat, and the budget loop with a tiny simulated budget — all
 * against REAL SQLite files.
 */

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-desktop-store-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

function insertDraft(
  store: ReturnType<typeof openDesktopStore>,
  localId: string,
  status: string,
  updatedAt: string,
): void {
  store.run(
    "INSERT INTO draft_docs (local_id, doc_type, payload, local_status, updated_at) VALUES (?, ?, ?, ?, ?)",
    [localId, "sales_invoice", `{"localId":"${localId}"}`, status, updatedAt],
  );
}

describe("deleteOldestSynced — LOCAL_DATABASE §5.2 semantics", () => {
  it("draft_docs: DRAFT_LOCAL/PENDING_MERGE/SYNC_FAILED are precious; MERGED/CANCELLED_LOCAL prunable oldest-first", () => {
    const store = openDesktopStore({ path: tempDbPath("draft-prune") });
    try {
      insertDraft(store, "d-merged-oldest", "MERGED", "2026-11-01T00:00:00Z");
      insertDraft(store, "d-merged-newest", "MERGED", "2026-11-05T00:00:00Z");
      insertDraft(store, "d-cancelled", "CANCELLED_LOCAL", "2026-11-02T00:00:00Z");
      insertDraft(store, "d-draft-local", "DRAFT_LOCAL", "2026-11-03T00:00:00Z");
      insertDraft(store, "d-pending-merge", "PENDING_MERGE", "2026-11-03T06:00:00Z");
      insertDraft(store, "d-sync-failed", "SYNC_FAILED", "2026-11-03T12:00:00Z");

      // A partial batch takes ONLY the oldest prunable row.
      expect(store.deleteOldestSynced("draft_docs", 1)).toBe(1);
      expect(store.all("SELECT local_id FROM draft_docs ORDER BY local_id").map((r) => String(r.local_id))).not
        .toContain("d-merged-oldest");

      // The rest of the prunable set goes oldest-first…
      expect(store.deleteOldestSynced("draft_docs", 10)).toBe(2);
      const remaining = store.all("SELECT local_id FROM draft_docs").map((r) => String(r.local_id));
      // …while every un-acked honest state survives.
      expect(remaining.sort()).toEqual(["d-draft-local", "d-pending-merge", "d-sync-failed"]);
    } finally {
      store.close();
    }
  });

  it("pos_sales: PENDING_SYNC is precious, SYNCED is prunable (016 write-set parity)", () => {
    const store = openDesktopStore({ path: tempDbPath("possales-prune") });
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

  it("read caches: dirty rows are never pruned; clean rows go oldest-first", () => {
    const store = openDesktopStore({ path: tempDbPath("items-prune") });
    try {
      const insert = (id: string, updatedAt: string, dirty: number): void => {
        store.run(
          "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
          [id, `SKU-${id}`, `Item ${id}`, "STOCK", "ACTIVE", updatedAt, dirty],
        );
      };
      insert("item-dirty", "2026-11-01T00:00:00Z", 1); // oldest row, but dirty → precious
      insert("item-clean-1", "2026-11-02T00:00:00Z", 0);
      insert("item-clean-2", "2026-11-03T00:00:00Z", 0);
      insert("item-clean-3", "2026-11-04T00:00:00Z", 0);
      expect(store.deleteOldestSynced("items", 2)).toBe(2);
      const remaining = store.all("SELECT id FROM items").map((r) => String(r.id));
      expect(remaining.sort()).toEqual(["item-clean-3", "item-dirty"]);
    } finally {
      store.close();
    }
  });

  it("allowlist guard: machinery, the audit trail, unknown and injected table names are rejected LOUDLY", () => {
    const store = openDesktopStore({ path: tempDbPath("allowlist") });
    try {
      for (const table of ["outbox", "inbox", "cursors", "meta", "schema_migrations", "local_events", "nope"]) {
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
    } finally {
      store.close();
    }
  });

  it("listBusinessTables: the frozen business allowlist — never machinery, never local_events", () => {
    const store = openDesktopStore({ path: tempDbPath("list") });
    try {
      const listed = store.listBusinessTables();
      expect(listed).toEqual([...DESKTOP_BUSINESS_TABLES]);
      for (const forbidden of ["outbox", "inbox", "cursors", "meta", "schema_migrations", "local_events"]) {
        expect(listed).not.toContain(forbidden);
      }
    } finally {
      store.close();
    }
  });
});

describe("tableBytes — DR-P21-03 byte measurement", () => {
  it("dbstat is live on this build: >0 for a seeded table; 0 for empty and missing tables (never a throw)", () => {
    const store = openDesktopStore({ path: tempDbPath("bytes") });
    try {
      // Recorded observation: better-sqlite3 12.x compiles
      // SQLITE_ENABLE_DBSTAT_VTAB — the measurement is exact, not estimated.
      expect(store.info.byteMeasurement).toBe("dbstat");
      store.run(
        "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["i-1", "S1", `fat row payload ${"x".repeat(2000)}`, "STOCK", "ACTIVE", "2026-11-04T00:00:00Z", 0, 1],
      );
      expect(store.tableBytes("items")).toBeGreaterThan(0);
      expect(store.tableBytes("items") % 4096).toBe(0); // whole pages, byte-exact
      // Existing-but-empty table → 0 data bytes; missing table → 0, no throw.
      expect(store.tableBytes("quotations")).toBe(0);
      expect(store.tableBytes("no_such_table")).toBe(0);
      // The identifier guard applies to measurements too.
      expect(() => store.tableBytes("items; DROP TABLE items")).toThrow(/not a valid table identifier/);
      expect(() => store.countRows("items; DROP TABLE items")).toThrow(/not a valid table identifier/);
    } finally {
      store.close();
    }
  });
});

describe("pruneDesktopStore — the byte-exact 1 GB budget loop", () => {
  it("tiny budget: deletes oldest synced in LRU batches, keeps dirty + machinery, converges honestly", () => {
    const path = tempDbPath("budget");
    const store = openDesktopStore({ path });
    try {
      // 600 fat item rows (~2 KB each ≈ 300+ pages), every 120th dirty —
      // the dirty rows are the oldest-of-their-page guards.
      store.transaction(() => {
        for (let i = 0; i < 600; i += 1) {
          store.run(
            "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
            [
              `item-${String(i).padStart(4, "0")}`,
              `SKU-${i}`,
              `Item ${i} ${"x".repeat(2000)}`,
              "STOCK",
              "ACTIVE",
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
        store.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('items', '5', 0)");
      });

      const startBytes = desktopStoreBytes(store);
      expect(startBytes).toBeGreaterThan(0);
      // Byte math (not money): an integer floor via modulo — the repo's
      // ADR-0009 rule bans Math.floor for float-rounding reasons.
      const budgetBytes = startBytes * 0.55 - ((startBytes * 0.55) % 1); // must shed ~45%

      const result = pruneDesktopStore(store, { budgetBytes });
      expect(result.estimated).toBe(false); // dbstat-exact on this build
      expect(result.stillOverBudget).toBe(false); // converged under budget
      expect(result.freedBytes).toBeGreaterThan(0);
      expect(desktopStoreBytes(store)).toBeLessThanOrEqual(budgetBytes);
      // The per-table row ledger matches the actual deletions.
      const rowsDeleted = Object.values(result.perTable).reduce((sum, n) => sum + n, 0);
      expect(rowsDeleted).toBe(600 - store.countRows("items"));
      expect(result.iterations).toBeGreaterThan(0);
      // Batch shape: at most PRUNE_BATCH_ROWS per table per LRU pass.
      expect(Object.values(result.perTable)[0]).toBeLessThanOrEqual(result.iterations * PRUNE_BATCH_ROWS);

      // Oldest-first: the earliest clean rows are gone, the newest remain.
      const remaining = store.all("SELECT id FROM items ORDER BY id").map((r) => String(r.id));
      expect(remaining).not.toContain("item-0001");
      expect(remaining).not.toContain("item-0100");
      expect(remaining).toContain("item-0599");
      // Every dirty row survived.
      expect(store.all("SELECT id FROM items WHERE dirty = 1")).toHaveLength(5);
      // Machinery NEVER pruned.
      expect(store.countRows("outbox")).toBe(1);
      expect(store.countRows("cursors")).toBe(1);
      expect(store.all("SELECT entity_type FROM cursors")).toEqual([{ entity_type: "items" }]);
    } finally {
      store.close();
    }
  });

  it("under budget → an honest no-op pass", () => {
    const store = openDesktopStore({ path: tempDbPath("noop") });
    try {
      store.run(
        "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["i-1", "S1", "small", "STOCK", "ACTIVE", "2026-11-04T00:00:00Z", 0, 1],
      );
      expect(pruneDesktopStore(store, { budgetBytes: 1_073_741_824 })).toEqual({
        freedBytes: 0,
        estimated: false,
        perTable: {},
        iterations: 0,
        stillOverBudget: false,
      });
      expect(store.countRows("items")).toBe(1);
    } finally {
      store.close();
    }
  });

  it("nothing prunable (all rows dirty) → stillOverBudget is reported honestly, never a silent pass", () => {
    const store = openDesktopStore({ path: tempDbPath("stuck") });
    try {
      store.run(
        "INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["dirty-1", "S1", `fat ${"x".repeat(4000)}`, "STOCK", "ACTIVE", "2026-11-04T00:00:00Z", 1, 1],
      );
      const result = pruneDesktopStore(store, { budgetBytes: 1024 }); // impossibly small
      expect(result.perTable).toEqual({});
      expect(result.freedBytes).toBe(0);
      expect(result.iterations).toBe(1);
      expect(result.stillOverBudget).toBe(true); // the loud honest flag
      expect(store.countRows("items")).toBe(1); // the dirty row survived
    } finally {
      store.close();
    }
  });
});
