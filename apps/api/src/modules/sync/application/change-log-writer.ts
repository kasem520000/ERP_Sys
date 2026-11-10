import { sql } from "drizzle-orm";
import { generateUuidV7 } from "@erp/domain-core";

import { PULLED_ENTITY_TYPES } from "@erp/contracts";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-016 · the POS feed-group change-log writer (T8; SYNC_PROTOCOL §2/
 * §11 — the NARROW slice): a catch-up writer that runs at pull time — it
 * reads the POS feed group's source tables for rows changed since the
 * feed's last watermark and appends `change_log` rows inside the pull
 * transaction. The frozen substrate modules (items/partners/tax) are NOT
 * modified to write the feed (their invariants stay untouched); the feed
 * is a read-model projection they never know about.
 *
 * PHASE-020 · the generalized writer (T5; SYNC_PROTOCOL §2 + MASTER-PLAN
 * §1.3/§5): the same catch-up pattern widened from the 016 POS subset to
 * every registered FEED-GROUP entity (pos_terminals + cashier_shifts join
 * the pos group; sales_invoices headers join the desktop group — lines
 * are NOT pulled in 020, desktop doc-detail is online), each projected
 * payload carries the source row's `version` (the optimistic-concurrency
 * source, CONFLICT_RESOLUTION §4), and soft-deleted rows (items/partners
 * `deleted_at`) now ALSO upsert a `tombstones` row — the feed entry is
 * the transport (op:'DELETE', payload null on the wire), the tombstones
 * table is the GC-boundary ledger (0029). Sources without a soft-delete
 * lifecycle (pos_terminals/cashier_shifts — 0024: "no delete — documents
 * reference terminals"; uoms/tax_codes/barcodes/price_list_items) never
 * tombstone: their deactivation is ordinary data (status INACTIVE /
 * ARCHIVED rides the UPSERT payload).
 *
 * PHASE-022 · DR-P22-05 — the mobile feed entities (MASTER-PLAN §0 golden
 * constants + §6): routes / settlement_templates (the rep_settlements
 * read model) / receipts / notifications join the generic catch-up as
 * ordinary table-backed projections — every one of them has `updated_at` +
 * `version` and NO delete lifecycle (deactivation/cancellation rides
 * status), so they never tombstone (the 020 no-soft-delete rule).
 * `van_stocks` is the one 022 source with a hard-delete lifecycle: the
 * PHASE-017 mirror is rebuilt by delete+insert inside the owning
 * transaction (refreshVanStockMirror), so its row ids churn on every
 * refresh. It rides a DEDICATED catch-up (syncVanStockFeed) that (a)
 * re-emits the touched warehouse slice as ordinary UPSERTs and (b)
 * diffs the last-fed state against the current mirror to emit DELETE
 * entries (+ tombstones) for keys that vanished since the previous
 * catch-up — a device's van stock cache converges exactly.
 * `statements` is NOT table-backed (the PHASE-12/13 per-partner statement
 * read model, computed at pull time) and is routed by the pull service
 * to the dedicated statement feed (./statement-feed); its case below is
 * defensive only.
 *
 * The watermark per entity type lives ON the change_log tail (the max
 * source changedAt already fed) — restart-safe and idempotent: re-feeding
 * a source row appends another UPSERT (seq order preserved; clients apply
 * last-writer-wins), never a duplicate primary effect.
 */

/** The POS feed group (016 §11 — kept verbatim for the 016 compat surface). */
export const POS_FEED_ENTITIES = [
  "items",
  "barcodes",
  "uoms",
  "price_list_items",
  "partners",
  "tax_codes",
] as const;

export type PosFeedEntity = (typeof POS_FEED_ENTITIES)[number];

export function isPosFeedEntity(entityType: string): entityType is PosFeedEntity {
  return (POS_FEED_ENTITIES as readonly string[]).includes(entityType);
}

/** Every feed-group entity the generalized writer can project (contracts). */
export type FeedEntity = (typeof PULLED_ENTITY_TYPES)[number];

export function isFeedEntity(entityType: string): entityType is FeedEntity {
  return (PULLED_ENTITY_TYPES as readonly string[]).includes(entityType);
}

interface ProjectedChange {
  changedAt: string;
  id: string;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;
}

/** Source projection per entity type: (changedAt, id, op, payload) rows —
 * the pulled read-cache shape (LOCAL_DATABASE §1.1). Every source table
 * carries a `version` column (verified per migration: 0009 items/
 * partners/barcodes/uoms/price_list_items, 0013 tax_codes, 0012
 * cashier_shifts, 0018 sales_invoices, 0024 pos_terminals) — it rides the
 * payload verbatim; DELETE projections keep the source payload in
 * change_log (the watermark reads payload->>'changedAt') but the pull
 * envelope nulls it (op:'DELETE' + payload:null, MASTER-PLAN §1.1). */
async function projectSource(
  entityType: FeedEntity,
  since: string | null,
  limit: number,
): Promise<ProjectedChange[]> {
  const tx = requireTenantContext().tx!;
  const sinceClause = since === null ? sql`IS NULL` : sql`> ${since}`;
  const sinceFallback = since === null;
  switch (entityType) {
    case "items": {
      const rows = await tx.execute(sql`
        SELECT i.id, i.updated_at AS "changedAt", i.version, i.sku, i.name, i.name_ar AS "nameAr",
               i.kind, i.uom_id AS "uomId", i.category_id AS "categoryId",
               i.tax_code_id AS "taxCodeId", i.base_price AS "basePrice",
               i.track_batch AS "trackBatch", i.track_serial AS "trackSerial",
               i.track_imei AS "trackImei", i.status, i.deleted_at AS "deletedAt"
        FROM items i
        WHERE (${sinceFallback}::boolean AND i.updated_at IS NOT NULL)
           OR i.updated_at ${sinceClause}
        ORDER BY i.updated_at NULLS FIRST, i.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    case "barcodes": {
      const rows = await tx.execute(sql`
        SELECT b.id, b.updated_at AS "changedAt", b.version, b.code, b.item_id AS "itemId", b.uom_id AS "uomId"
        FROM barcodes b
        WHERE (${sinceFallback}::boolean AND b.updated_at IS NOT NULL)
           OR b.updated_at ${sinceClause}
        ORDER BY b.updated_at NULLS FIRST, b.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    case "uoms": {
      const rows = await tx.execute(sql`
        SELECT u.id, u.updated_at AS "changedAt", u.version, u.code, u.name, u.name_ar AS "nameAr",
               u.is_system AS "isSystem", u.is_active AS "isActive"
        FROM uoms u
        WHERE (${sinceFallback}::boolean AND u.updated_at IS NOT NULL)
           OR u.updated_at ${sinceClause}
        ORDER BY u.updated_at NULLS FIRST, u.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    case "price_list_items": {
      const rows = await tx.execute(sql`
        SELECT p.id, p.updated_at AS "changedAt", p.version, p.price_list_id AS "priceListId",
               p.item_id AS "itemId", p.uom_id AS "uomId", p.unit_price AS "unitPrice",
               p.min_qty AS "minQty"
        FROM price_list_items p
        JOIN price_lists l ON l.id = p.price_list_id AND l.tenant_id = p.tenant_id
        WHERE l.status = 'ACTIVE'
          AND ((${sinceFallback}::boolean AND p.updated_at IS NOT NULL) OR p.updated_at ${sinceClause})
        ORDER BY p.updated_at NULLS FIRST, p.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    case "partners": {
      const rows = await tx.execute(sql`
        SELECT p.id, p.updated_at AS "changedAt", p.version, p.code, p.name, p.name_ar AS "nameAr",
               p.kind, p.status, p.credit_limit AS "creditLimit",
               p.price_list_id AS "priceListId", p.tax_number AS "taxNumber",
               p.deleted_at AS "deletedAt"
        FROM partners p
        WHERE (${sinceFallback}::boolean AND p.updated_at IS NOT NULL)
           OR p.updated_at ${sinceClause}
        ORDER BY p.updated_at NULLS FIRST, p.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    case "tax_codes": {
      const rows = await tx.execute(sql`
        SELECT t.id, t.updated_at AS "changedAt", t.version, t.code, t.name, t.name_ar AS "nameAr",
               t.country_code AS "countryCode", t.default_treatment AS "defaultTreatment",
               t.snapshot_policy AS "snapshotPolicy", t.status
        FROM tax_codes t
        WHERE (${sinceFallback}::boolean AND t.updated_at IS NOT NULL)
           OR t.updated_at ${sinceClause}
        ORDER BY t.updated_at NULLS FIRST, t.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-020 (020 pos group): the terminal registry projection — the
    // device's own configuration feed (0024 columns; no deleted_at —
    // terminals have no delete lifecycle, deactivation rides status).
    case "pos_terminals": {
      const rows = await tx.execute(sql`
        SELECT t.id, t.updated_at AS "changedAt", t.version, t.code, t.name, t.name_ar AS "nameAr",
               t.branch_id AS "branchId", t.cash_account_id AS "cashAccountId",
               t.warehouse_id AS "warehouseId", t.receipt_size AS "receiptSize", t.status,
               t.device_id AS "deviceId", t.offline_seq AS "offlineSeq"
        FROM pos_terminals t
        WHERE (${sinceFallback}::boolean AND t.updated_at IS NOT NULL)
           OR t.updated_at ${sinceClause}
        ORDER BY t.updated_at NULLS FIRST, t.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-020 (020 pos group): the cashier-shift projection — the
    // operational subset (0012 + 0024 columns: terminal linkage, blind
    // count, supervisor verification; no deleted_at — shifts are closed,
    // never deleted).
    case "cashier_shifts": {
      const rows = await tx.execute(sql`
        SELECT s.id, s.updated_at AS "changedAt", s.version,
               s.pos_terminal_id AS "terminalId", s.status,
               s.opened_at AS "openedAt", s.closed_at AS "closedAt",
               s.opening_amount AS "openingAmount", s.counted_amount AS "countedAmount",
               s.difference, s.denominations,
               s.supervisor_id AS "supervisorId", s.supervisor_verified_at AS "supervisorVerifiedAt"
        FROM cashier_shifts s
        WHERE (${sinceFallback}::boolean AND s.updated_at IS NOT NULL)
           OR s.updated_at ${sinceClause}
        ORDER BY s.updated_at NULLS FIRST, s.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-020 (020 desktop group): the sales-invoice HEADER projection
    // — DRAFT+POSTED read cache. Lines are NOT pulled in 020: desktop
    // doc-detail is online (MASTER-PLAN §1.5 scope honesty). Money rides
    // the row's numeric totals (total_gross = the document amount).
    case "sales_invoices": {
      const rows = await tx.execute(sql`
        SELECT v.id, v.updated_at AS "changedAt", v.version, v.invoice_no AS "invoiceNo",
               v.status, v.kind, v.channel, v.customer_id AS "customerId",
               v.invoice_date AS "orderDate", v.total_gross AS "totalAmount",
               v.currency_code AS "currency", v.owner_device_id AS "ownerDeviceId"
        FROM sales_invoices v
        WHERE (${sinceFallback}::boolean AND v.updated_at IS NOT NULL)
           OR v.updated_at ${sinceClause}
        ORDER BY v.updated_at NULLS FIRST, v.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-022 (field group): the van-stock mirror projection — but the
    // 017 mirror has a hard-delete lifecycle (delete+insert rebuild), so
    // this entity never rides the generic catch-up; the pull service
    // routes it to syncVanStockFeed (below). Defensive only — an empty
    // projection keeps the feed honest if the routing ever regresses.
    case "van_stocks":
      return [];
    // PHASE-022 (field group): route headers + their ordered customer
    // lists (route_customers) — the route-customers read model rides the
    // route row (0025 columns; no delete lifecycle, INACTIVE rides status).
    case "routes": {
      const rows = await tx.execute(sql`
        SELECT r.id, r.updated_at AS "changedAt", r.version, r.code, r.name,
               r.name_ar AS "nameAr", r.sales_rep_id AS "salesRepId",
               r.van_warehouse_id AS "vanWarehouseId", r.day_pattern AS "dayPattern",
               r.status,
               COALESCE((
                 SELECT json_agg(json_build_object(
                           'partnerId', rc.customer_id, 'visitOrder', rc.visit_order,
                           'isPinned', rc.is_pinned)
                         ORDER BY rc.visit_order, rc.customer_id)
                 FROM route_customers rc
                 WHERE rc.route_id = r.id AND rc.tenant_id = r.tenant_id
               ), '[]'::json) AS customers
        FROM routes r
        WHERE ((${sinceFallback}::boolean AND r.updated_at IS NOT NULL)
            OR r.updated_at ${sinceClause})
        ORDER BY r.updated_at NULLS FIRST, r.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-022 (field group): the rep settlement day template — the
    // PHASE-017 rep_settlements header (settlement_no is NULL until
    // numbering assigns it at posting; CANCELLED rides status — ordinary
    // data, the 020 no-soft-delete rule). Money as TEXT decimal strings
    // (ADR-0009).
    case "settlement_templates": {
      const rows = await tx.execute(sql`
        SELECT s.id, s.updated_at AS "changedAt", s.version,
               s.settlement_no AS "settlementNo", s.sales_rep_id AS "salesRepId",
               s.van_warehouse_id AS "vanWarehouseId", s.shift_id AS "shiftId",
               s.settlement_date::text AS "settlementDate", s.status,
               s.opening_cash::text AS "openingCash", s.cash_sales::text AS "cashSales",
               s.collections::text AS "collections", s.cash_refunds::text AS "cashRefunds",
               s.rep_expenses::text AS "repExpenses", s.expected_cash::text AS "expectedCash",
               s.counted_cash::text AS "countedCash", s.variance::text AS "variance",
               s.variance_direction AS "varianceDirection",
               s.deposit_amount::text AS "depositAmount"
        FROM rep_settlements s
        WHERE ((${sinceFallback}::boolean AND s.updated_at IS NOT NULL)
            OR s.updated_at ${sinceClause})
        ORDER BY s.updated_at NULLS FIRST, s.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-022 (personal group): the treasury receipt header (0012; no
    // delete lifecycle, CANCELLED rides status — ordinary data). partnerId
    // is the partner-scope key the personal serve filter reads
    // (LOCAL_DATABASE §1.1 rule 2). receipt_no is NULL until posting.
    case "receipts": {
      const rows = await tx.execute(sql`
        SELECT r.id, r.updated_at AS "changedAt", r.version, r.receipt_no AS "receiptNo",
               r.status, r.partner_id AS "partnerId", r.method, r.currency_code AS "currencyCode",
               r.amount::text AS "amount", r.value_date::text AS "valueDate",
               r.reference, r.posted_at AS "postedAt"
        FROM receipts r
        WHERE ((${sinceFallback}::boolean AND r.updated_at IS NOT NULL)
            OR r.updated_at ${sinceClause})
        ORDER BY r.updated_at NULLS FIRST, r.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-022 (personal group): the per-user notification cache (0021;
    // never deleted — read_at flips, categories append). userId is the
    // per-user scope key the personal serve filter reads (a NULL-user row
    // is a broadcast that no personal feed ever serves).
    case "notifications": {
      const rows = await tx.execute(sql`
        SELECT n.id, n.updated_at AS "changedAt", n.version, n.user_id AS "userId",
               n.category, n.severity, n.title, n.body,
               n.action_label AS "actionLabel", n.action_url AS "actionUrl",
               n.read_at AS "readAt"
        FROM notifications n
        WHERE ((${sinceFallback}::boolean AND n.updated_at IS NOT NULL)
            OR n.updated_at ${sinceClause})
        ORDER BY n.updated_at NULLS FIRST, n.id LIMIT ${limit}
      `);
      return (rows.rows as unknown as Record<string, unknown>[]).map(mapRow);
    }
    // PHASE-022: the per-partner statement snapshots — NOT table-backed
    // (computed at pull time by ./statement-feed, routed by the pull
    // service before the generic catch-up). Defensive only.
    case "statements":
      return [];
  }
}

function mapRow(row: Record<string, unknown>): ProjectedChange {
  const deleted = row.deletedAt !== null && row.deletedAt !== undefined;
  // pg hands timestamptz back as Date: JSON.stringify (the payload write)
  // renders ISO, and the explicit changedAt/tombstone values must be ISO
  // too (a bare String(Date) is the locale format pg cannot re-parse).
  const changedAt =
    row.changedAt instanceof Date ? row.changedAt.toISOString() : String(row.changedAt);
  return {
    changedAt,
    id: String(row.id),
    op: deleted ? "DELETE" : "UPSERT",
    // The source payload is kept on DELETE rows in change_log (the
    // watermark reads payload->>'changedAt'); the pull envelope nulls it.
    payload: row,
  };
}

/**
 * The tombstone upsert (MASTER-PLAN §5.7 — idempotent on the 0029 UQ
 * (tenant_id, entity_type, entity_id); gc_after = deleted_at + 90d, the
 * weekly GC sweep's boundary).
 */
async function upsertTombstone(entityType: string, entityId: string, deletedAt: string): Promise<void> {
  const tx = requireTenantContext().tx!;
  await tx.execute(sql`
    INSERT INTO tombstones (id, tenant_id, entity_type, entity_id, deleted_at, gc_after)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${entityType}, ${entityId},
            ${deletedAt}::timestamptz, ${deletedAt}::timestamptz + interval '90 days')
    ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
      SET deleted_at = EXCLUDED.deleted_at, gc_after = EXCLUDED.gc_after
  `);
}

/** Feed the change log from the sources (catch-up), return the new
 * watermark for the entity type. Chunked per SYNC_PROTOCOL §2.5. */
export async function syncFeed(entityType: FeedEntity, chunk = 500): Promise<string | null> {
  // PHASE-022 · DR-P22-05: the van-stock mirror's hard-delete rebuild
  // (delete+insert per refresh) needs the vanished-key DELETE diff — the
  // generic watermark projection cannot express it. Every other entity
  // rides the generic catch-up below.
  if (entityType === "van_stocks") {
    return syncVanStockFeed();
  }
  const tx = requireTenantContext().tx!;
  const watermarkRow = await tx.execute(sql`
    SELECT max((payload->>'changedAt')) AS wm FROM change_log WHERE entity_type = ${entityType}
  `);
  let watermark: string | null = null;
  const tail = (watermarkRow.rows as unknown as { wm: string | null }[])[0];
  if (tail !== undefined && tail.wm !== null && tail.wm !== undefined) {
    watermark = tail.wm;
  }
  const projected = await projectSource(entityType, watermark, chunk);
  for (const change of projected) {
    await tx.execute(sql`
      INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload)
      VALUES (erp.current_tenant_id(), ${entityType}, ${change.id}, ${change.op},
              ${JSON.stringify(change.payload)}::jsonb)
    `);
    if (change.op === "DELETE") {
      await upsertTombstone(entityType, change.id, change.changedAt);
    }
  }
  if (projected.length === chunk) {
    // Keep draining until under a chunk (bounded recursion; the writer is
    // bounded per call and the next pull drains the rest — §2.5 chunking).
    return syncFeed(entityType, chunk);
  }
  return projected.length > 0 ? projected[projected.length - 1]!.changedAt : watermark;
}

// -- PHASE-022 · DR-P22-05 · the van-stock feed (dedicated catch-up) ---------------
//
// The PHASE-017 mirror is rebuilt by delete+insert inside the owning
// transaction (distribution.store.refreshVanStockMirror): every refresh
// drops the previous rows and inserts fresh ones (new uuids, updated_at =
// now), scoped to the touched warehouses. Two consequences the generic
// watermark projection cannot express:
//
//  (1) UPSERT side — ordinary: rows with updated_at > watermark are the
//      freshly (re-)inserted slice; clients apply last-writer-wins by id.
//      After any van movement the whole touched slice re-feeds (bounded
//      by the mirror's size; idempotent re-feeding, §2.5 chunking).
//  (2) DELETE side — the mirror row a device previously fetched can
//      VANISH (the key's net qty hit 0, or the warehouse emptied), and a
//      hard delete leaves no tombstone substrate. This catch-up diffs the
//      LAST-FED state (the latest change_log entry per entity id for the
//      'van_stocks' slice) against the CURRENT mirror: an id whose last
//      fed op is UPSERT but which is absent from the mirror now is fed as
//      op:'DELETE' (+ a tombstones row, the 0029 GC ledger). The diff is
//      idempotent — once the DELETE is appended, the id's last-fed op
//      becomes DELETE and the next catch-up emits nothing for it, so a
//      quiet tenant's feed stays quiet.

/** The per-entity-type watermark over the change_log tail (shared shape). */
async function feedWatermark(entityType: "van_stocks"): Promise<string | null> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT max((payload->>'changedAt')) AS wm FROM change_log WHERE entity_type = ${entityType}
  `);
  const tail = (rows.rows as unknown as { wm: string | null }[])[0];
  return tail !== undefined && tail.wm !== null && tail.wm !== undefined ? tail.wm : null;
}

/** Append one feed entry (+ its tombstone on DELETE) — the shared insert. */
async function appendFeedEntry(
  entityType: "van_stocks",
  change: ProjectedChange,
): Promise<void> {
  const tx = requireTenantContext().tx!;
  await tx.execute(sql`
    INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload)
    VALUES (erp.current_tenant_id(), ${entityType}, ${change.id}, ${change.op},
            ${change.payload === null ? sql`NULL` : sql`${JSON.stringify(change.payload)}::jsonb`})
  `);
  if (change.op === "DELETE") {
    await upsertTombstone(entityType, change.id, change.changedAt);
  }
}

/** The current mirror state (all rows — the diff baseline + the LITE
 * projection source; 0025 columns, money/qty as TEXT decimal strings). */
async function currentVanStocks(): Promise<
  { id: string; row: Record<string, unknown>; changedAt: string }[]
> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT v.id, v.updated_at AS "changedAt", v.version,
           v.warehouse_id AS "warehouseId", v.item_id AS "itemId", v.batch_id AS "batchId",
           v.qty::text AS "qty", v.value::text AS "value",
           v.refreshed_at AS "refreshedAt"
    FROM van_stocks v
    ORDER BY v.updated_at NULLS FIRST, v.id
  `);
  return (rows.rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    row,
    changedAt: row.changedAt instanceof Date ? row.changedAt.toISOString() : String(row.changedAt),
  }));
}

/** The last-fed op per entity id over the van_stocks slice. */
async function lastFedVanStockOps(): Promise<Map<string, "UPSERT" | "DELETE">> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT DISTINCT ON (entity_id) entity_id AS "entityId", op
    FROM change_log
    WHERE entity_type = 'van_stocks'
    ORDER BY entity_id, seq DESC
  `);
  const ops = new Map<string, "UPSERT" | "DELETE">();
  for (const row of rows.rows as unknown as { entityId: string; op: "UPSERT" | "DELETE" }[]) {
    ops.set(row.entityId, row.op);
  }
  return ops;
}

/** The van-stock catch-up: watermark projection + the vanished-key diff. */
async function syncVanStockFeed(): Promise<string | null> {
  const watermark = await feedWatermark("van_stocks");
  const current = await currentVanStocks();

  // (1) Ordinary UPSERTs: rows (re-)inserted since the watermark. The
  // comparison mirrors the generic writer's `updated_at > since` clause in
  // TS so the DELETE baseline (the same rows) is read once, whole.
  let lastChangedAt = watermark;
  for (const entry of current) {
    const isNew =
      watermark === null ? entry.changedAt !== "" : entry.changedAt > watermark;
    if (!isNew) {
      continue;
    }
    await appendFeedEntry("van_stocks", {
      changedAt: entry.changedAt,
      id: entry.id,
      op: "UPSERT",
      payload: entry.row,
    });
    lastChangedAt = entry.changedAt;
  }

  // (2) The vanished-key diff: ids fed as UPSERT that are gone from the
  // mirror now — op:'DELETE' + a tombstones row (bounded by the vanished
  // set; idempotent: their last-fed op flips to DELETE, so a quiet
  // tenant's feed stays quiet).
  const lastFed = await lastFedVanStockOps();
  const currentIds = new Set(current.map((entry) => entry.id));
  const vanishedAt = new Date().toISOString();
  for (const [entityId, op] of lastFed) {
    if (op === "UPSERT" && !currentIds.has(entityId)) {
      await appendFeedEntry("van_stocks", {
        changedAt: vanishedAt,
        id: entityId,
        op: "DELETE",
        payload: null,
      });
    }
  }
  return lastChangedAt;
}

/** One in-transaction feed entry (the pushed-command writer, below). */
export interface FeedEntry {
  entityType: string;
  entityId: string;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;
  changedAt?: string;
}

/**
 * PHASE-020 · the in-transaction feed writer for pushed-command execution
 * (SYNC_PROTOCOL §9 note 4 — feed propagation is transactional with
 * command execution): appends `change_log` rows for the entities a
 * command touched, called by the push side AFTER command execution in the
 * SAME ambient tenant tx. The payload rides verbatim (JSON-stringified
 * like the catch-up writer; its `version` field is the row version the
 * pull envelope surfaces — null on DELETE). DELETE ops also upsert the
 * tombstones row. Empty input is a no-op.
 */
export async function publishFeedEntries(entries: readonly FeedEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const tx = requireTenantContext().tx!;
  for (const entry of entries) {
    const changedAt = entry.changedAt ?? new Date().toISOString();
    await tx.execute(sql`
      INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload, changed_at)
      VALUES (erp.current_tenant_id(), ${entry.entityType}, ${entry.entityId}, ${entry.op},
              ${entry.payload === null ? sql`NULL` : sql`${JSON.stringify(entry.payload)}::jsonb`},
              ${changedAt}::timestamptz)
    `);
    if (entry.op === "DELETE") {
      await upsertTombstone(entry.entityType, entry.entityId, changedAt);
    }
  }
}
