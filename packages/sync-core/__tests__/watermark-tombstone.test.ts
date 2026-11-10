import { describe, expect, it } from "vitest";

import {
  applyMigrations,
  applyPullBatch,
  memoryAdapter,
  metaGet,
  posAppliers,
  readCursor,
  resetCursor,
  type PullAppliers,
  type PullBatchChange,
  type StorageAdapter,
} from "../src";

/**
 * PHASE-020 · the pull applier's v2 semantics (SYNC_PROTOCOL §2.6/§2.7;
 * MASTER-PLAN §10; LOCAL_DATABASE §1.2): tombstones remove the local row
 * AND its cached children in the same transaction, unknown-row
 * tombstones are no-ops, the version guard applies only strictly-newer
 * rows, the `permissions` entity updates the watermark, and the cursor
 * advances only after the batch commits.
 */

function freshStore(): StorageAdapter {
  const adapter = memoryAdapter();
  applyMigrations(adapter);
  return adapter;
}

function upsert(adapter: StorageAdapter, entityType: string, id: string, extra: Record<string, unknown> = {}): void {
  applyPullBatch(
    adapter,
    {
      entityType,
      cursor: `upsert-${id}`,
      changes: [
        {
          id,
          seq: 1,
          op: "UPSERT",
          payload: { id, ...(entityType === "items" ? { sku: `SKU-${id}`, name: `Item ${id}` } : {}), ...extra },
        },
      ],
    },
    posAppliers,
  );
}

describe("tombstones (SYNC_PROTOCOL §2.6)", () => {
  it("DELETE removes the local row AND its cached children in one transaction", () => {
    const adapter = freshStore();
    upsert(adapter, "items", "item-1");
    upsert(adapter, "barcodes", "barcode-1", { itemId: "item-1", code: "1001" });
    upsert(adapter, "barcodes", "barcode-2", { itemId: "item-1", code: "1002" });
    upsert(adapter, "barcodes", "barcode-3", { itemId: "item-2", code: "1003" });
    upsert(adapter, "price_list_items", "pli-1", { itemId: "item-1", priceListId: "pl-1", unitPrice: "10", minQty: "1" });
    expect(adapter.all("SELECT id FROM items")).toHaveLength(1);
    expect(adapter.all("SELECT id FROM barcodes")).toHaveLength(3);

    const applied = applyPullBatch(
      adapter,
      {
        entityType: "items",
        cursor: "tombstone-1",
        changes: [{ id: "item-1", seq: 9, op: "DELETE", payload: null }],
      },
      posAppliers,
    );

    expect(applied).toBe(1);
    // The item is gone; its barcodes + price-list lines went with it.
    expect(adapter.all("SELECT id FROM items")).toHaveLength(0);
    const barcodes = adapter.all("SELECT id FROM barcodes").map((row) => String(row.id));
    expect(barcodes).toEqual(["barcode-3"]); // other items' barcodes stay
    expect(adapter.all("SELECT id FROM price_list_items")).toHaveLength(0);
    // Cursor advanced in the same transaction.
    expect(readCursor(adapter, "items")).toBe("tombstone-1");
  });

  it("a tombstone for a row the device never had is a no-op (idempotent)", () => {
    const adapter = freshStore();
    upsert(adapter, "items", "item-1");
    const applied = applyPullBatch(
      adapter,
      {
        entityType: "items",
        cursor: "tombstone-unknown",
        changes: [{ id: "never-seen", seq: 1, op: "DELETE", payload: null }],
      },
      posAppliers,
    );
    expect(applied).toBe(1); // processed — but nothing existed to delete
    expect(adapter.all("SELECT id FROM items")).toHaveLength(1);
    expect(readCursor(adapter, "items")).toBe("tombstone-unknown");
    // Re-delivering the same tombstone stays a no-op.
    expect(() =>
      applyPullBatch(
        adapter,
        { entityType: "items", cursor: "tombstone-unknown", changes: [{ id: "never-seen", seq: 1, op: "DELETE", payload: null }] },
        posAppliers,
      ),
    ).not.toThrow();
  });
});

describe("version guard (SYNC_PROTOCOL §2.7 — apply only if version > local)", () => {
  it("skips older/equal versions, applies strictly newer ones, absent version always applies", () => {
    const adapter = freshStore();
    const change = (version: number | null | undefined, name: string): PullBatchChange => ({
      id: "item-1",
      seq: 1,
      op: "UPSERT",
      payload: { id: "item-1", sku: "SKU-1", name },
      ...(version === undefined ? {} : { version }),
    });

    // v5 lands.
    expect(applyPullBatch(adapter, { entityType: "items", cursor: "c5", changes: [change(5, "fifth")] }, posAppliers)).toBe(1);
    expect(adapter.get("SELECT * FROM items WHERE id = ?", ["item-1"])!.name).toBe("fifth");

    // v3 (older) is skipped — the local row keeps the v5 state, but the
    // cursor still advances (the page was processed).
    expect(applyPullBatch(adapter, { entityType: "items", cursor: "c3", changes: [change(3, "third")] }, posAppliers)).toBe(0);
    const row = adapter.get("SELECT * FROM items WHERE id = ?", ["item-1"])!;
    expect(row.name).toBe("fifth");
    expect(row.version).toBe(5);
    expect(readCursor(adapter, "items")).toBe("c3");

    // v5 (equal) is skipped too — strictly newer only.
    expect(applyPullBatch(adapter, { entityType: "items", cursor: "c5b", changes: [change(5, "fifth-again")] }, posAppliers)).toBe(0);
    expect(adapter.get("SELECT * FROM items WHERE id = ?", ["item-1"])!.name).toBe("fifth");

    // v6 applies.
    expect(applyPullBatch(adapter, { entityType: "items", cursor: "c6", changes: [change(6, "sixth")] }, posAppliers)).toBe(1);
    expect(adapter.get("SELECT * FROM items WHERE id = ?", ["item-1"])!.name).toBe("sixth");

    // Absent version (the 016 envelope): always applies.
    expect(applyPullBatch(adapter, { entityType: "items", cursor: "c016", changes: [change(undefined, "legacy")] }, posAppliers)).toBe(1);
    expect(adapter.get("SELECT * FROM items WHERE id = ?", ["item-1"])!.name).toBe("legacy");
  });
});

describe("permissions entity (MASTER-PLAN §10 — the D-04 watermark)", () => {
  it("applying a permissions change records the snapshot watermark (epoch + ISO normalized)", () => {
    const adapter = freshStore();
    const epochSnapshot = 1_760_000_000_000;
    expect(
      applyPullBatch(
        adapter,
        {
          entityType: "permissions",
          cursor: "perm-1",
          changes: [
            {
              id: "user-1:page:1",
              seq: 1,
              op: "UPSERT",
              payload: { userId: "user-1", permissions: ["sync.push"], snapshotAt: epochSnapshot },
            },
          ],
        },
        posAppliers,
      ),
    ).toBe(1);
    expect(metaGet(adapter, "permissionSnapshotAt")).toBe(String(epochSnapshot));

    // ISO string snapshots normalize to epoch ms.
    applyPullBatch(
      adapter,
      {
        entityType: "permissions",
        cursor: "perm-2",
        changes: [
          {
            id: "user-1:page:1",
            seq: 2,
            op: "UPSERT",
            payload: { userId: "user-1", permissions: ["sync.push"], snapshotAt: "2026-11-04T00:00:00Z" },
          },
        ],
      },
      posAppliers,
    );
    expect(metaGet(adapter, "permissionSnapshotAt")).toBe(String(Date.parse("2026-11-04T00:00:00Z")));

    // An unparseable snapshotAt never corrupts the watermark.
    applyPullBatch(
      adapter,
      {
        entityType: "permissions",
        cursor: "perm-3",
        changes: [
          { id: "user-1:page:1", seq: 3, op: "UPSERT", payload: { userId: "user-1", permissions: [], snapshotAt: null } },
        ],
      },
      posAppliers,
    );
    expect(metaGet(adapter, "permissionSnapshotAt")).toBe(String(Date.parse("2026-11-04T00:00:00Z")));
    // No local permissions table exists — only the watermark moved.
    expect(adapter.get("SELECT * FROM cursors WHERE entity_type = ?", ["permissions"])!.last_seq).toBe("perm-3");
  });
});

describe("cursor advance only after the batch commits (§2.7)", () => {
  it("a mid-batch applier failure leaves the cursor untouched (same page re-pulls)", () => {
    const adapter = freshStore();
    const boom: PullAppliers = {
      upsert: (store, entityType, payload) => {
        if (payload.id === "item-2") throw new Error("simulated mid-batch crash");
        posAppliers.upsert(store, entityType, payload, null);
      },
      remove: posAppliers.remove,
      readVersion: posAppliers.readVersion,
    };
    expect(() =>
      applyPullBatch(
        adapter,
        {
          entityType: "items",
          cursor: "page-1",
          changes: [
            { id: "item-1", seq: 1, op: "UPSERT", payload: { id: "item-1", sku: "S1", name: "One" } },
            { id: "item-2", seq: 2, op: "UPSERT", payload: { id: "item-2", sku: "S2", name: "Two" } },
          ],
        },
        boom,
      ),
    ).toThrow("simulated mid-batch crash");
    // The cursor did NOT advance: the crash re-pulls the same page.
    expect(readCursor(adapter, "items")).toBeNull();
    // The integrity checksum was not maintained either (nothing committed).
    expect(metaGet(adapter, "cursorCount")).toBeNull();
  });

  it("resetCursor re-positions one entity without touching the others (C-12)", () => {
    const adapter = freshStore();
    upsert(adapter, "items", "item-1");
    upsert(adapter, "partners", "partner-1", { code: "P1", name: "Partner", kind: "CUSTOMER", status: "ACTIVE" });
    resetCursor(adapter, "items", "0");
    expect(readCursor(adapter, "items")).toBe("0");
    expect(readCursor(adapter, "partners")).toContain("partner-1");
    expect(metaGet(adapter, "cursorCount")).toBe("2");
  });
});
