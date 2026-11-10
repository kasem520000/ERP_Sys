import { describe, expect, it } from "vitest";

import {
  BYTES_PER_ROW_APPROX,
  LocalStoreCorruptError,
  applyPullBatch,
  ROW_BUDGETS,
  SyncReadOnlyError,
  applyMigrations,
  applyResult,
  assertWritable,
  enqueue,
  markInFlight,
  markSaleSynced,
  memoryAdapter,
  metaGet,
  permissionWatermarkState,
  posAppliers,
  pruneStore,
  queueStats,
  recoveryPass,
  type StorageAdapter,
} from "../src";

/**
 * PHASE-020 · recovery + pruning + the write gates (MASTER-PLAN §13;
 * LOCAL_DATABASE §5/§6; SYNC_TESTS C-04/C-15/C-16 + D-04): the IN_FLIGHT
 * requeue, the integrity-check quarantine path, the per-class row-budget
 * pruning (byte-budget approximation), the permission watermark, and the
 * loud typed failures on refusal.
 */

function freshStore(): StorageAdapter {
  const adapter = memoryAdapter();
  applyMigrations(adapter);
  return adapter;
}

function insertItem(adapter: StorageAdapter, id: string, updatedAt: string, dirty = false): void {
  adapter.run(
    `INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version)
     VALUES (?, ?, ?, 'STOCK', 'ACTIVE', ?, ?, 1)`,
    [id, `SKU-${id}`, `Item ${id}`, updatedAt, dirty ? 1 : 0],
  );
}

function insertBarcode(adapter: StorageAdapter, id: string, itemId: string, updatedAt: string): void {
  adapter.run(
    `INSERT INTO barcodes (id, code, item_id, updated_at, version) VALUES (?, ?, ?, ?, 1)`,
    [id, `CODE-${id}`, itemId, updatedAt],
  );
}

describe("recoveryPass (LOCAL_DATABASE §6.3 + §6.4)", () => {
  it("C-04: requeues IN_FLIGHT commands and backfills the integrity checksums", () => {
    const adapter = freshStore();
    const { commandId } = enqueue(adapter, {
      entityType: "pos_sale",
      intent: "create",
      payload: { type: "pos_sale" },
      idempotencyKey: "recovery-inflight-1",
    });
    markInFlight(adapter, [commandId]);
    expect(queueStats(adapter).inFlight).toBe(1);

    const result = recoveryPass(adapter);
    expect(result.recoveredInFlight).toBe(1);
    expect(result.integrity).toBe("ok");
    expect(result.actions.join(" ")).toContain("requeued 1 IN_FLIGHT");
    expect(queueStats(adapter).pending).toBe(1);
    // Legacy store (no checksums yet) → backfilled, never flagged corrupt.
    expect(metaGet(adapter, "cursorCount")).toBe("0");
    expect(metaGet(adapter, "inboxCount")).toBe("0");
  });

  it("integrity mismatch → corrupt + quarantine + cursor reset, never a throw", () => {
    const adapter = freshStore();
    // A committed pull advances the cursor AND maintains cursorCount=1.
    const applied = applyPullBatch(
      adapter,
      {
        entityType: "items",
        cursor: "1",
        changes: [{ id: "item-2", seq: 1, op: "UPSERT", payload: { id: "item-2", sku: "S2", name: "Item Two" } }],
      },
      posAppliers,
    );
    expect(applied).toBe(1);
    expect(metaGet(adapter, "cursorCount")).toBe("1");

    // Tamper: a cursor row appears WITHOUT the maintained checksum.
    adapter.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES (?, ?, ?)", [
      "ghost-entity",
      "99",
      0,
    ]);

    const result = recoveryPass(adapter);
    expect(result.integrity).toBe("corrupt");
    expect(result.recoveredInFlight).toBe(0);
    expect(result.actions.join(" ")).toContain("cursorCount mismatch");
    expect(result.actions.join(" ")).toContain("quarantined");
    // Quarantine marker + cursors reset for re-bootstrap (§6.4).
    expect(metaGet(adapter, "quarantined")).toBe("true");
    expect(adapter.all("SELECT entity_type FROM cursors")).toHaveLength(0);
    expect(metaGet(adapter, "cursorCount")).toBe("0");

    // The loud failure surface: store operations refuse while quarantined.
    expect(() =>
      enqueue(adapter, { entityType: "pos_sale", intent: "create", payload: {}, idempotencyKey: "post-quarantine" }),
    ).toThrow(LocalStoreCorruptError);
    expect(() =>
      applyPullBatch(adapter, { entityType: "items", cursor: "2", changes: [] }, posAppliers),
    ).toThrow(LocalStoreCorruptError);
    expect(() => applyResult(adapter, { commandId: "x", status: "ACCEPTED" })).toThrow(LocalStoreCorruptError);
    expect(() => assertWritable(adapter)).toThrow(LocalStoreCorruptError);
  });

  it("inboxCount mismatches are caught the same way", () => {
    const adapter = freshStore();
    const { commandId } = enqueue(adapter, {
      entityType: "pos_sale",
      intent: "create",
      payload: {},
      idempotencyKey: "recovery-inbox-1",
    });
    applyResult(adapter, { commandId, status: "ACCEPTED", officialNo: "POS-T1-2611-00001" });
    expect(metaGet(adapter, "inboxCount")).toBe("1");
    // Tamper: an inbox row disappears without the checksum following.
    adapter.run("DELETE FROM inbox WHERE command_id = ?", [commandId]);
    const result = recoveryPass(adapter);
    expect(result.integrity).toBe("corrupt");
    expect(result.actions.join(" ")).toContain("inboxCount mismatch");
  });
});

describe("pruneStore (LOCAL_DATABASE §5 — row-budget approximation)", () => {
  it("prunes oldest-synced rows only: budgets respected, machinery + dirty + unsynced untouched", () => {
    const adapter = freshStore();
    // 9 items (the oldest one dirty), 4 barcodes, 2 pos_sales (one
    // PENDING_SYNC, one SYNCED) — 15 business rows against a budget of 10.
    insertItem(adapter, "item-dirty", "2026-11-01T00:00:00Z", true);
    for (let i = 1; i <= 8; i += 1) {
      insertItem(adapter, `item-${i}`, `2026-11-0${Math.min(9, 2)}T00:00:0${Math.min(9, i)}Z`);
    }
    for (let i = 1; i <= 4; i += 1) {
      insertBarcode(adapter, `barcode-${i}`, "item-1", `2026-11-03T00:00:0${i}Z`);
    }
    adapter.run(
      `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, order_type, invoice_date,
          total_gross, tenders, lines, local_status, created_at)
       VALUES ('sale-pending', 'OFF-T1-00001', 't1', 'COUNTER', '2026-11-04', '1', '[]', '[]', 'PENDING_SYNC', '2026-11-04T00:00:00Z')`,
    );
    adapter.run(
      `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, order_type, invoice_date,
          total_gross, tenders, lines, local_status, official_no, synced_at, created_at)
       VALUES ('sale-synced', 'OFF-T1-00002', 't1', 'COUNTER', '2026-11-04', '1', '[]', '[]', 'SYNCED', 'POS-1', '2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z')`,
    );
    // Machinery rows that must survive ANY pruning.
    enqueue(adapter, { entityType: "pos_sale", intent: "create", payload: {}, idempotencyKey: "prune-outbox-1" });
    adapter.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES ('items', '5', 0)");
    const outboxBefore = adapter.all("SELECT command_id FROM outbox").length;
    const cursorsBefore = adapter.all("SELECT entity_type FROM cursors").length;

    const result = pruneStore(adapter, "pos-terminal", { budgetRows: 10 });
    expect(result.pruned).toBe(5);
    expect(result.budgetBytesApprox).toBe(10 * BYTES_PER_ROW_APPROX);
    // Items lost exactly 5 oldest non-dirty rows (the dirty one survives).
    const remainingItems = adapter.all("SELECT id FROM items").map((row) => String(row.id));
    expect(remainingItems).toHaveLength(4);
    expect(remainingItems).toContain("item-dirty");
    expect(remainingItems).not.toContain("item-1"); // oldest non-dirty → pruned
    expect(remainingItems).not.toContain("item-5");
    expect(remainingItems).toContain("item-6");
    // Barcodes untouched (items was the fullest table and covered the excess).
    expect(adapter.all("SELECT id FROM barcodes")).toHaveLength(4);
    // Write-set honesty: PENDING_SYNC survives; the SYNCED row is prunable
    // but was not needed here.
    const saleIds = adapter.all("SELECT id FROM pos_sales").map((row) => String(row.id));
    expect(saleIds).toContain("sale-pending");
    // Machinery NEVER pruned.
    expect(adapter.all("SELECT command_id FROM outbox")).toHaveLength(outboxBefore);
    expect(adapter.all("SELECT entity_type FROM cursors")).toHaveLength(cursorsBefore);
  });

  it("spills to the next fullest table when one exhausts its prunable rows", () => {
    const adapter = freshStore();
    // items: 5 rows but only 1 prunable (4 dirty); barcodes: 2 prunable.
    for (let i = 1; i <= 4; i += 1) {
      insertItem(adapter, `item-dirty-${i}`, `2026-11-01T00:00:0${i}Z`, true);
    }
    insertItem(adapter, "item-clean", "2026-11-01T00:00:05Z");
    insertBarcode(adapter, "barcode-1", "item-clean", "2026-11-02T00:00:00Z");
    insertBarcode(adapter, "barcode-2", "item-clean", "2026-11-02T00:00:01Z");

    const result = pruneStore(adapter, "android-field", { budgetRows: 4 }); // 7 rows → excess 3
    expect(result.pruned).toBe(3);
    // Only the clean item was prunable; the rest spilled to barcodes.
    const items = adapter.all("SELECT id FROM items").map((r) => String(r.id));
    expect(items).toHaveLength(4);
    expect(items).not.toContain("item-clean");
    expect(adapter.all("SELECT id FROM barcodes")).toHaveLength(0);
  });

  it("no-ops without the optional adapter methods (016 browser bridge)", () => {
    const adapter = freshStore();
    insertItem(adapter, "item-1", "2026-11-01T00:00:00Z");
    const minimal: StorageAdapter = {
      transaction: (fn) => fn(),
      run: (sql, params) => adapter.run(sql, params),
      all: (sql, params) => adapter.all(sql, params),
      get: (sql, params) => adapter.get(sql, params),
    };
    expect(pruneStore(minimal, "pos-terminal")).toEqual({ pruned: 0, budgetBytesApprox: 0 });
    expect(adapter.all("SELECT id FROM items")).toHaveLength(1);
  });

  it("honors the real per-class budgets (android-personal 10k rows)", () => {
    const adapter = freshStore();
    const overBudget = ROW_BUDGETS["android-personal"]! + 3;
    const baseMs = 1_760_000_000_000;
    for (let i = 0; i < overBudget; i += 1) {
      // Deterministic oldest-first ordering: strictly increasing stamps.
      adapter.run(
        `INSERT INTO items (id, sku, name, kind, status, updated_at, dirty, version)
         VALUES (?, ?, ?, 'STOCK', 'ACTIVE', ?, 0, 1)`,
        [`item-${String(i).padStart(6, "0")}`, `SKU-${i}`, "Item", new Date(baseMs + i * 1000).toISOString()],
      );
    }
    const result = pruneStore(adapter, "android-personal");
    expect(result.pruned).toBe(3);
    expect(adapter.all("SELECT id FROM items")).toHaveLength(ROW_BUDGETS["android-personal"]!);
    // The OLDEST rows were pruned first (LRU, §5.2).
    const remaining = adapter.all("SELECT id FROM items").map((row) => String(row.id));
    expect(remaining).not.toContain("item-000000");
    expect(remaining).not.toContain("item-000001");
    expect(remaining).not.toContain("item-000002");
    expect(remaining).toContain(`item-${String(overBudget - 1).padStart(6, "0")}`);
    expect(result.budgetBytesApprox).toBe(ROW_BUDGETS["android-personal"]! * BYTES_PER_ROW_APPROX);
  });
});

describe("permission watermark (D-04) + the write gates", () => {
  it("readOnly only when a snapshot EXISTS and is older than 7 days", () => {
    const adapter = freshStore();
    // Never pulled a snapshot (016 store): writable.
    expect(permissionWatermarkState(adapter)).toEqual({ snapshotAt: null, readOnly: false, ageDays: 0 });
    expect(() => assertWritable(adapter)).not.toThrow();

    // Fresh snapshot: writable.
    const now = Date.now();
    adapter.run("INSERT INTO meta (key, value) VALUES (?, ?)", ["permissionSnapshotAt", String(now)]);
    const fresh = permissionWatermarkState(adapter);
    expect(fresh.snapshotAt).toBe(now);
    expect(fresh.readOnly).toBe(false);
    expect(() => assertWritable(adapter)).not.toThrow();

    // 8 days old: read-only — captures fail loudly, reads unaffected.
    adapter.run("UPDATE meta SET value = ? WHERE key = ?", [
      String(now - 8 * 86_400_000),
      "permissionSnapshotAt",
    ]);
    const stale = permissionWatermarkState(adapter);
    expect(stale.readOnly).toBe(true);
    expect(stale.ageDays).toBeGreaterThan(7);
    expect(() => assertWritable(adapter)).toThrow(SyncReadOnlyError);
    expect(() =>
      enqueue(adapter, { entityType: "pos_sale", intent: "create", payload: {}, idempotencyKey: "stale-watermark" }),
    ).toThrow(SyncReadOnlyError);
    // Reads are NOT gated: pull application still works (§2.3 — the
    // store stays fresh so the user sees current data).
    expect(() =>
      applyPullBatch(adapter, { entityType: "items", cursor: "1", changes: [] }, posAppliers),
    ).not.toThrow();

    // A fresh watermark arriving via pull re-enables writes.
    adapter.run("UPDATE meta SET value = ? WHERE key = ?", [String(now), "permissionSnapshotAt"]);
    expect(() => assertWritable(adapter)).not.toThrow();
  });

  it("markSaleSynced + applyResult keep the honest state trail (regression)", () => {
    const adapter = freshStore();
    const { commandId } = enqueue(adapter, {
      entityType: "pos_sale",
      intent: "create",
      payload: { sale: { clientId: "sale-1" } },
      idempotencyKey: "watermark-regression-1",
      commandId: "cmd-watermark-1",
    });
    adapter.run(
      `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, order_type, invoice_date,
          total_gross, tenders, lines, local_status, created_at)
       VALUES ('sale-1', 'OFF-T1-00001', 't1', 'COUNTER', '2026-11-04', '10', '[]', '[]', 'PENDING_SYNC', '2026-11-04T00:00:00Z')`,
    );
    applyResult(adapter, { commandId, status: "ACCEPTED", officialNo: "POS-T1-2611-00042" });
    markSaleSynced(adapter, { saleId: "sale-1", officialNo: "POS-T1-2611-00042", journalEntryId: "je-1" });
    const sale = adapter.get("SELECT * FROM pos_sales WHERE id = ?", ["sale-1"]);
    expect(sale!.local_status).toBe("SYNCED");
    expect(sale!.official_no).toBe("POS-T1-2611-00042");
    expect(queueStats(adapter).acked).toBe(1);
  });
});
