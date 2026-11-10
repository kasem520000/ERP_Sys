import { generateUuidV7 } from "@erp/domain-core";

import { LocalStoreCorruptError } from "../errors";
import {
  isQuarantined,
  maintainCursorCount,
  metaGet,
  metaSet,
  type StorageAdapter,
} from "./adapter";

/**
 * PHASE-016 · local pull application (T7; SYNC_PROTOCOL §2): apply a
 * pull batch inside ONE local transaction — cursor advance happens ONLY
 * after every change applied (the §2 rule the chaos suite asserts; a
 * crash mid-batch re-pulls the batch, which is idempotent by primary
 * key). Tombstones delete in the same transaction.
 *
 * PHASE-020 v2 (MASTER-PLAN §13; SYNC_PROTOCOL §2.6/§2.7): each change
 * may carry the server row `version` — UPSERTs apply ONLY when the
 * incoming version is strictly newer than the local one (absent version
 * = always apply, 016 compat); DELETE entries (tombstones) remove the
 * local row AND its cached children in the same transaction; the
 * synthetic `permissions` entity updates the permission-snapshot
 * watermark (LOCAL_DATABASE meta `permissionSnapshotAt`, D-04).
 */

export interface LocalCursor {
  entityType: string;
  lastSeq: string;
  syncedAt: number;
}

/** One feed change as the applier accepts it (the wire shape minus the
 * envelope; `version`/`changedAt` optional for 016-compat callers). */
export interface PullBatchChange {
  id: string;
  seq: number;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;
  changedAt?: string;
  /** Server row version (null on DELETE feed entries) — the optimistic-
   * concurrency source for the apply guard. */
  version?: number | null;
}

/** Per-entity-type appliers the embedding app provides (the POS terminal
 * maps them onto its local projections). `readVersion` opts the applier
 * set into the v2 version guard. */
export interface PullAppliers {
  upsert: (
    adapter: StorageAdapter,
    entityType: string,
    payload: Record<string, unknown>,
    version?: number | null,
  ) => void;
  remove: (adapter: StorageAdapter, entityType: string, id: string) => void;
  /** The locally stored server version for one row (null = unknown/absent
   * → the guard always applies). */
  readVersion?: (adapter: StorageAdapter, entityType: string, id: string) => number | null;
}

export function readCursor(adapter: StorageAdapter, entityType: string): string | null {
  const row = adapter.get("SELECT * FROM cursors WHERE entity_type = ?", [entityType]);
  return row === undefined ? null : String(row.last_seq);
}

/** Apply a batch + advance the cursor atomically. Returns the applied
 * count (stale-version skips and no-op tombstones still advance the
 * cursor — the page was processed either way; re-delivery is harmless). */
export function applyPullBatch(
  adapter: StorageAdapter,
  input: {
    entityType: string;
    cursor: string;
    changes: readonly PullBatchChange[];
  },
  appliers: PullAppliers,
): number {
  if (isQuarantined(adapter)) {
    throw new LocalStoreCorruptError(
      `applyPullBatch refused: store quarantined (entityType ${input.entityType}) — run the LOCAL_DATABASE §6.4 corruption path`,
    );
  }
  return adapter.transaction(() => {
    let applied = 0;
    for (const change of input.changes) {
      if (change.op === "DELETE") {
        // Tombstone: local row + cached children, same transaction; an
        // unknown row is a no-op (idempotent — §2.6).
        appliers.remove(adapter, input.entityType, change.id);
        applied += 1;
      } else if (change.payload !== null) {
        // Version guard (§2.7): apply only when strictly newer; absent
        // version (016 envelope) always applies.
        if (
          change.version !== undefined &&
          change.version !== null &&
          appliers.readVersion !== undefined
        ) {
          const local = appliers.readVersion(adapter, input.entityType, change.id);
          if (local !== null && change.version <= local) {
            continue;
          }
        }
        appliers.upsert(adapter, input.entityType, change.payload, change.version ?? null);
        applied += 1;
      } else {
        applied += 1;
      }
    }
    advanceCursor(adapter, input.entityType, input.cursor);
    return applied;
  });
}

/** Write the cursor position (INSERT or UPDATE) + maintain the
 * `cursorCount` integrity checksum — called ONLY from inside the batch's
 * transaction, so a crash before commit leaves the cursor untouched
 * (the §2.7 persistence rule). */
function advanceCursor(adapter: StorageAdapter, entityType: string, cursor: string): void {
  const now = Date.now();
  const existing = adapter.get("SELECT * FROM cursors WHERE entity_type = ?", [entityType]);
  if (existing === undefined) {
    adapter.run("INSERT INTO cursors (entity_type, last_seq, synced_at) VALUES (?, ?, ?)", [
      entityType,
      cursor,
      now,
    ]);
  } else {
    adapter.run("UPDATE cursors SET last_seq = ?, synced_at = ? WHERE entity_type = ?", [
      cursor,
      now,
      entityType,
    ]);
  }
  maintainCursorCount(adapter);
}

/** Reset one entity's cursor to a given position (the C-12 `resync`
 * directive's bounded restart + the §6.4 re-bootstrap) — the next pull
 * resumes from exactly here. */
export function resetCursor(adapter: StorageAdapter, entityType: string, cursor: string): void {
  adapter.transaction(() => {
    advanceCursor(adapter, entityType, cursor);
  });
}

/**
 * The POS terminal's standard appliers (§1.1 projections): UPSERT maps
 * the feed payload onto the local table by primary key (recording the
 * server `version`); DELETE removes the row + its cached children
 * (tombstones apply immediately, §5 rule 4).
 */
export const posAppliers: PullAppliers & {
  readVersion: (adapter: StorageAdapter, entityType: string, id: string) => number | null;
} = {
  upsert(
    adapter: StorageAdapter,
    entityType: string,
    payload: Record<string, unknown>,
    version: number | null = null,
  ): void {
    // The permissions snapshot payload has NO id field (the change id is
    // the page key `userId:page:N`); every other projection embeds its
    // row id in the payload.
    if (entityType === "permissions") {
      writePermissionWatermark(adapter, payload.snapshotAt);
      return;
    }
    const id = String(payload.id ?? "");
    if (id === "") return;
    switch (entityType) {
      case "items":
        adapter.run(
          `INSERT OR REPLACE INTO items (id, sku, name, name_ar, kind, uom_id, category_id,
              tax_code_id, base_price, track_batch, track_serial, track_imei, status, updated_at, dirty, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            id,
            String(payload.sku ?? ""),
            String(payload.name ?? ""),
            payload.nameAr ?? null,
            String(payload.kind ?? "STOCK"),
            payload.uomId ?? null,
            payload.categoryId ?? null,
            payload.taxCodeId ?? null,
            payload.basePrice ?? null,
            payload.trackBatch === true ? 1 : 0,
            payload.trackSerial === true ? 1 : 0,
            payload.trackImei === true ? 1 : 0,
            String(payload.status ?? "ACTIVE"),
            String(payload.changedAt ?? new Date().toISOString()),
            version,
          ],
        );
        break;
      case "barcodes":
        adapter.run(
          `INSERT OR REPLACE INTO barcodes (id, code, item_id, uom_id, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, String(payload.code ?? ""), String(payload.itemId ?? ""), payload.uomId ?? null, String(payload.changedAt ?? ""), version],
        );
        break;
      case "uoms":
        adapter.run(
          `INSERT OR REPLACE INTO uoms (id, code, name, name_ar, is_active, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, String(payload.code ?? ""), String(payload.name ?? ""), payload.nameAr ?? null, payload.isActive === false ? 0 : 1, String(payload.changedAt ?? ""), version],
        );
        break;
      case "price_list_items":
        adapter.run(
          `INSERT OR REPLACE INTO price_list_items (id, price_list_id, item_id, uom_id, unit_price, min_qty, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            String(payload.priceListId ?? ""),
            String(payload.itemId ?? ""),
            payload.uomId ?? null,
            String(payload.unitPrice ?? "0"),
            String(payload.minQty ?? "1"),
            String(payload.changedAt ?? ""),
            version,
          ],
        );
        break;
      case "partners":
        adapter.run(
          `INSERT OR REPLACE INTO partners (id, code, name, name_ar, kind, status, credit_limit,
              price_list_id, tax_number, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            String(payload.code ?? ""),
            String(payload.name ?? ""),
            payload.nameAr ?? null,
            String(payload.kind ?? "CUSTOMER"),
            String(payload.status ?? "ACTIVE"),
            payload.creditLimit ?? null,
            payload.priceListId ?? null,
            payload.taxNumber ?? null,
            String(payload.changedAt ?? ""),
            version,
          ],
        );
        break;
      case "tax_codes":
        adapter.run(
          `INSERT OR REPLACE INTO tax_codes (id, code, name, name_ar, country_code,
              default_treatment, rate, status, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            String(payload.code ?? ""),
            String(payload.name ?? ""),
            payload.nameAr ?? null,
            String(payload.countryCode ?? ""),
            String(payload.defaultTreatment ?? "NOT_SUBJECT"),
            payload.rate === undefined || payload.rate === null ? null : String(payload.rate),
            String(payload.status ?? "ACTIVE"),
            String(payload.changedAt ?? ""),
            version,
          ],
        );
        break;
      default:
        break;
    }
  },
  remove(adapter: StorageAdapter, entityType: string, id: string): void {
    switch (entityType) {
      case "items":
        // The item's cached children go in the SAME transaction (§2.6):
        // barcodes + price-list lines referencing the deleted item.
        adapter.run("DELETE FROM items WHERE id = ?", [id]);
        adapter.run("DELETE FROM barcodes WHERE item_id = ?", [id]);
        adapter.run("DELETE FROM price_list_items WHERE item_id = ?", [id]);
        break;
      case "permissions":
        break; // no local row — a permissions DELETE is a no-op
      default:
        adapter.run(`DELETE FROM ${entityType} WHERE id = ?`, [id]);
        break;
    }
  },
  readVersion(adapter: StorageAdapter, entityType: string, id: string): number | null {
    if (!isPosCacheTable(entityType)) return null;
    const row = adapter.get(`SELECT version FROM ${entityType} WHERE id = ?`, [id]);
    if (row === undefined || row.version === undefined || row.version === null) return null;
    return Number(row.version);
  },
};

/** The read-cache tables the local schema tracks (version-guard scope). */
function isPosCacheTable(entityType: string): boolean {
  return (
    entityType === "items" ||
    entityType === "barcodes" ||
    entityType === "uoms" ||
    entityType === "price_list_items" ||
    entityType === "partners" ||
    entityType === "tax_codes"
  );
}

/** Normalize a permissions-snapshot `snapshotAt` (epoch ms number, numeric
 * string, or ISO 8601 string) to epoch ms; null when unparseable. */
function normalizeSnapshotAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const asNumber = Number(value);
      return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Record the permission-snapshot watermark (D-04): the pull applier for
 * the `permissions` entity calls this with the change payload's
 * snapshotAt. */
export function writePermissionWatermark(adapter: StorageAdapter, snapshotAt: unknown): void {
  const normalized = normalizeSnapshotAt(snapshotAt);
  if (normalized !== null) {
    metaSet(adapter, "permissionSnapshotAt", String(normalized));
  }
}

// -- meta helpers (016 export names — the canonical implementations live in
// ./adapter as metaGet/metaSet) ------------------------------------------------------

export { metaGet as readMeta, metaSet as writeMeta };

/** Local capture of a POS sale: the business row + the outbox command in
 * ONE transaction (§3 rule 1 — a crash between them is impossible). */
export function capturePosSale(
  adapter: StorageAdapter,
  input: {
    /** Explicit sale id (deterministic harnesses); generated when omitted. */
    clientId?: string;
    offlineReceiptNo: string;
    terminalId: string;
    customerId: string | null;
    orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "COUNTER";
    invoiceDate: string;
    totalGross: string;
    tenders: { method: "CASH" | "CARD"; amount: string; reference?: string | null }[];
    lines: {
      itemId: string;
      qty: string;
      unitPrice: string;
      discountAmount?: string | null;
      taxCodeId?: string | null;
      serialIds?: string[] | null;
    }[];
    enqueueCommand: (adapter: StorageAdapter) => void;
  },
): string {
  const clientId = input.clientId ?? generateUuidV7();
  adapter.transaction(() => {
    adapter.run(
      `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, customer_id, order_type,
          invoice_date, total_gross, tenders, lines, local_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SYNC', ?)`,
      [
        clientId,
        input.offlineReceiptNo,
        input.terminalId,
        input.customerId,
        input.orderType,
        input.invoiceDate,
        input.totalGross,
        JSON.stringify(input.tenders),
        JSON.stringify(input.lines),
        new Date().toISOString(),
      ],
    );
    input.enqueueCommand(adapter);
  });
  return clientId;
}

/** Mark a captured sale synced (official number recorded alongside). */
export function markSaleSynced(
  adapter: StorageAdapter,
  input: { saleId: string; officialNo: string; journalEntryId: string | null },
): void {
  adapter.run(
    `UPDATE pos_sales SET local_status = 'SYNCED', official_no = ?, journal_entry_id = ?, synced_at = ?
     WHERE id = ?`,
    [input.officialNo, input.journalEntryId, new Date().toISOString(), input.saleId],
  );
}

/** Mark a captured sale rejected (the reconciliation screen's subject). */
export function markSaleRejected(adapter: StorageAdapter, saleId: string): void {
  adapter.run("UPDATE pos_sales SET local_status = 'REJECTED' WHERE id = ?", [saleId]);
}
