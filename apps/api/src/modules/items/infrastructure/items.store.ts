import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import * as schema from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Items data access (PHASE-006 §2.2; DEPENDENCY_RULES §1): pure storage in
 * the ambient tenant transaction. UoM conversion path resolution is here
 * (BFS over the factor graph) so the exact-decimal math lives with the rows.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("items access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- uoms ---------------------------------------------------------------------

export interface UomRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  isSystem: boolean;
  isActive: boolean;
}

const UOM_COLUMNS = {
  id: schema.uoms.id,
  code: schema.uoms.code,
  name: schema.uoms.name,
  nameAr: schema.uoms.nameAr,
  isSystem: schema.uoms.isSystem,
  isActive: schema.uoms.isActive,
} as const;

export async function listUoms(): Promise<UomRow[]> {
  const tx = tenantTx();
  const rows = await tx.select(UOM_COLUMNS).from(schema.uoms).orderBy(asc(schema.uoms.code));
  return rows as UomRow[];
}

export async function findUomById(id: string): Promise<UomRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(UOM_COLUMNS).from(schema.uoms).where(eq(schema.uoms.id, id)).limit(1);
  return (rows as UomRow[])[0];
}

export async function findUomByCode(code: string): Promise<UomRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(UOM_COLUMNS).from(schema.uoms).where(eq(schema.uoms.code, code)).limit(1);
  return (rows as UomRow[])[0];
}

export async function insertUom(input: {
  code: string;
  name: string;
  nameAr: string | null;
}): Promise<UomRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.uoms)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(UOM_COLUMNS);
  return rows[0] as UomRow;
}

export async function updateUom(
  id: string,
  patch: { name?: string; nameAr?: string | null; isActive?: boolean },
): Promise<UomRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.uoms)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.uoms.id, id))
    .returning(UOM_COLUMNS);
  return (rows as UomRow[])[0];
}

// -- uom conversions (exact decimal factors; BFS compose-exactly) --------------

export interface UomConversionRow {
  id: string;
  fromUomId: string;
  toUomId: string;
  factor: string;
}

export async function listUomConversions(): Promise<UomConversionRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.uomConversions.id,
      fromUomId: schema.uomConversions.fromUomId,
      toUomId: schema.uomConversions.toUomId,
      factor: schema.uomConversions.factor,
    })
    .from(schema.uomConversions);
  return rows as UomConversionRow[];
}

export async function findUomConversion(
  fromUomId: string,
  toUomId: string,
): Promise<UomConversionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.uomConversions.id,
      fromUomId: schema.uomConversions.fromUomId,
      toUomId: schema.uomConversions.toUomId,
      factor: schema.uomConversions.factor,
    })
    .from(schema.uomConversions)
    .where(
      and(
        eq(schema.uomConversions.fromUomId, fromUomId),
        eq(schema.uomConversions.toUomId, toUomId),
      ),
    )
    .limit(1);
  return (rows as UomConversionRow[])[0];
}

export async function insertUomConversion(input: {
  fromUomId: string;
  toUomId: string;
  factor: string;
}): Promise<UomConversionRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.uomConversions)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning({
      id: schema.uomConversions.id,
      fromUomId: schema.uomConversions.fromUomId,
      toUomId: schema.uomConversions.toUomId,
      factor: schema.uomConversions.factor,
    });
  return rows[0] as UomConversionRow;
}

// -- item categories -------------------------------------------------------------

export interface ItemCategoryRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  defaultTaxCodeId: string | null;
  status: string;
}

const CATEGORY_COLUMNS = {
  id: schema.itemCategories.id,
  code: schema.itemCategories.code,
  name: schema.itemCategories.name,
  nameAr: schema.itemCategories.nameAr,
  parentId: schema.itemCategories.parentId,
  defaultTaxCodeId: schema.itemCategories.defaultTaxCodeId,
  status: schema.itemCategories.status,
} as const;

export async function listCategories(): Promise<ItemCategoryRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select(CATEGORY_COLUMNS)
    .from(schema.itemCategories)
    .orderBy(asc(schema.itemCategories.code));
  return rows as ItemCategoryRow[];
}

export async function findCategoryById(id: string): Promise<ItemCategoryRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(CATEGORY_COLUMNS).from(schema.itemCategories).where(eq(schema.itemCategories.id, id)).limit(1);
  return (rows as ItemCategoryRow[])[0];
}

export async function findCategoryByCode(code: string): Promise<ItemCategoryRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(CATEGORY_COLUMNS).from(schema.itemCategories).where(eq(schema.itemCategories.code, code)).limit(1);
  return (rows as ItemCategoryRow[])[0];
}

export async function insertCategory(input: {
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  defaultTaxCodeId: string | null;
}): Promise<ItemCategoryRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.itemCategories)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(CATEGORY_COLUMNS);
  return rows[0] as ItemCategoryRow;
}

export async function updateCategory(
  id: string,
  patch: { name?: string; nameAr?: string | null; parentId?: string | null; defaultTaxCodeId?: string | null; status?: string },
): Promise<ItemCategoryRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.itemCategories)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.itemCategories.id, id))
    .returning(CATEGORY_COLUMNS);
  return (rows as ItemCategoryRow[])[0];
}

/** PHASE-009 (T5): an ACTIVE tenant tax code — the FK's existence check
 * surfaced as a clean typed error (direct table read; no module import —
 * DEPENDENCY_RULES §2 keeps items → accounting only). */
export async function findTaxCodeForItemAssignment(
  taxCodeId: string,
): Promise<{ id: string; code: string; status: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, status FROM tax_codes WHERE id = ${taxCodeId} LIMIT 1
  `);
  return (rows.rows as unknown as { id: string; code: string; status: string }[])[0];
}

/** Ancestor chain of a category (cycle proof walks this). */
export async function categoryAncestors(categoryId: string): Promise<string[]> {
  const tx = tenantTx();
  const result = await tx.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 0 AS depth FROM item_categories WHERE id = ${categoryId}::uuid
      UNION ALL
      SELECT c.id, c.parent_id, chain.depth + 1
        FROM item_categories c JOIN chain ON c.id = chain.parent_id
       WHERE chain.depth < 64
    )
    SELECT id FROM chain WHERE id <> ${categoryId}::uuid
  `);
  return (result.rows as unknown as { id: string }[]).map((row) => row.id);
}

// -- items -----------------------------------------------------------------------

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  kind: "STOCK" | "SERVICE" | "COMPOSITE";
  uomId: string;
  categoryId: string | null;
  taxCodeId: string | null;
  costingMethod: "WAC" | "FIFO";
  trackBatch: boolean;
  trackSerial: boolean;
  trackImei: boolean;
  hasExpiry: boolean;
  /** PHASE-018 (migration 0026): FG batch expiry = completion + shelf life. */
  shelfLifeDays: number | null;
  reorderLevel: string | null;
  reorderQty: string | null;
  basePrice: string | null;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const ITEM_COLUMNS = {
  id: schema.items.id,
  sku: schema.items.sku,
  name: schema.items.name,
  nameAr: schema.items.nameAr,
  kind: schema.items.kind,
  uomId: schema.items.uomId,
  categoryId: schema.items.categoryId,
  taxCodeId: schema.items.taxCodeId,
  costingMethod: schema.items.costingMethod,
  trackBatch: schema.items.trackBatch,
  trackSerial: schema.items.trackSerial,
  trackImei: schema.items.trackImei,
  hasExpiry: schema.items.hasExpiry,
  shelfLifeDays: schema.items.shelfLifeDays,
  reorderLevel: schema.items.reorderLevel,
  reorderQty: schema.items.reorderQty,
  basePrice: schema.items.basePrice,
  status: schema.items.status,
  deletedAt: schema.items.deletedAt,
  createdAt: schema.items.createdAt,
  updatedAt: schema.items.updatedAt,
  version: schema.items.version,
} as const;

export async function insertItem(input: {
  sku: string;
  name: string;
  nameAr: string | null;
  kind: string;
  uomId: string;
  categoryId: string | null;
  taxCodeId: string | null;
  costingMethod: string;
  trackBatch: boolean;
  trackSerial: boolean;
  trackImei: boolean;
  hasExpiry: boolean;
  /** PHASE-018 (migration 0026): optional — absent inserts NULL. */
  shelfLifeDays?: number | null;
  reorderLevel: string | null;
  reorderQty: string | null;
  basePrice: string | null;
}): Promise<ItemRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.items)
    .values({
      id: generateUuidV7(),
      ...input,
      kind: input.kind as ItemRow["kind"],
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(ITEM_COLUMNS);
  return rows[0] as ItemRow;
}

export async function findItemById(id: string): Promise<ItemRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(ITEM_COLUMNS).from(schema.items).where(eq(schema.items.id, id)).limit(1);
  return (rows as ItemRow[])[0];
}

export async function findItemBySku(sku: string): Promise<ItemRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(ITEM_COLUMNS).from(schema.items).where(eq(schema.items.sku, sku)).limit(1);
  return (rows as ItemRow[])[0];
}

export async function findItemByBarcode(code: string): Promise<ItemRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(ITEM_COLUMNS)
    .from(schema.items)
    .innerJoin(schema.barcodes, eq(schema.barcodes.itemId, schema.items.id))
    .where(and(eq(schema.barcodes.code, code), isNull(schema.items.deletedAt)))
    .limit(1);
  return (rows as ItemRow[])[0];
}

export async function updateItem(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    categoryId?: string | null;
    taxCodeId?: string | null;
    costingMethod?: string;
    trackBatch?: boolean;
    trackSerial?: boolean;
    trackImei?: boolean;
    hasExpiry?: boolean;
    /** PHASE-018: null clears; undefined = untouched. */
    shelfLifeDays?: number | null;
    reorderLevel?: string | null;
    reorderQty?: string | null;
    basePrice?: string | null;
    status?: string;
    version?: number;
  },
): Promise<ItemRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.items)
    .set({
      ...patch,
      ...(patch.version !== undefined ? { version: patch.version + 1 } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.items.id, id))
    .returning(ITEM_COLUMNS);
  return (rows as ItemRow[])[0];
}

export async function archiveItem(id: string): Promise<ItemRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.items)
    .set({ status: "ARCHIVED", deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.items.id, id))
    .returning(ITEM_COLUMNS);
  return (rows as ItemRow[])[0];
}

export interface ItemListFilter {
  kind?: string;
  categoryId?: string;
  status?: string;
  q?: string;
}

export interface ItemListPage {
  rows: ItemRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

const PAGE_MAX = 100;

export function decodeCursor(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return 0;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { offset?: number };
    // Cursor values are produced by encodeCursor — integers by construction.
    return typeof parsed.offset === "number" && Number.isInteger(parsed.offset) && parsed.offset >= 0
      ? parsed.offset
      : 0;
  } catch {
    return 0;
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

export async function listItems(
  filter: ItemListFilter,
  cursor: string | undefined,
  limit: number,
): Promise<ItemListPage> {
  const tx = tenantTx();
  const clamped = Math.min(Math.max(limit, 1), PAGE_MAX);
  const offset = decodeCursor(cursor);
  const conditions = [isNull(schema.items.deletedAt)];
  if (filter.kind !== undefined) {
    conditions.push(eq(schema.items.kind, filter.kind));
  }
  if (filter.categoryId !== undefined) {
    conditions.push(eq(schema.items.categoryId, filter.categoryId));
  }
  if (filter.status !== undefined) {
    conditions.push(eq(schema.items.status, filter.status));
  }
  if (filter.q !== undefined && filter.q !== "") {
    conditions.push(
      sql`(sku ILIKE ${"%" + filter.q + "%"} OR name ILIKE ${"%" + filter.q + "%"} OR coalesce(name_ar, '') ILIKE ${"%" + filter.q + "%"})`,
    );
  }
  const rows = await tx
    .select(ITEM_COLUMNS)
    .from(schema.items)
    .where(and(...conditions))
    .orderBy(asc(schema.items.sku))
    .limit(clamped + 1)
    .offset(offset);
  const hasMore = rows.length > clamped;
  const page = (hasMore ? rows.slice(0, clamped) : rows) as ItemRow[];
  return { rows: page, hasMore, nextCursor: hasMore ? encodeCursor(offset + clamped) : null };
}

/** Trigram search (T10): exact SKU/barcode first, then AR+EN similarity. */
export async function searchItems(q: string, limit = 20): Promise<ItemRow[]> {
  const tx = tenantTx();
  const term = q.trim();
  if (term === "") {
    return [];
  }
  const result = await tx.execute(sql`
    SELECT i.id, i.sku, i.name, i.name_ar AS "nameAr", i.kind, i.uom_id AS "uomId",
           i.category_id AS "categoryId", i.tax_code_id AS "taxCodeId",
           i.costing_method AS "costingMethod", i.track_batch AS "trackBatch",
           i.track_serial AS "trackSerial", i.track_imei AS "trackImei",
           i.has_expiry AS "hasExpiry", i.reorder_level AS "reorderLevel",
           i.reorder_qty AS "reorderQty", i.base_price AS "basePrice", i.status,
           i.deleted_at AS "deletedAt", i.created_at AS "createdAt",
           i.updated_at AS "updatedAt", i.version,
           (EXISTS (SELECT 1 FROM barcodes b WHERE b.item_id = i.id AND b.code = ${term})) AS exact_barcode
      FROM items i
     WHERE i.deleted_at IS NULL
       AND (
         i.sku ILIKE ${term + "%"}
         OR i.name ILIKE ${"%" + term + "%"}
         OR coalesce(i.name_ar, '') ILIKE ${"%" + term + "%"}
         OR EXISTS (SELECT 1 FROM barcodes b WHERE b.item_id = i.id AND b.code ILIKE ${term + "%"})
       )
     ORDER BY exact_barcode DESC, (i.sku ILIKE ${term + "%"}) DESC,
              similarity(i.name, ${term}) DESC,
              CASE WHEN i.name_ar IS NULL THEN 0 ELSE similarity(i.name_ar, ${term}) END DESC,
              i.sku ASC
     LIMIT ${limit}
  `);
  return result.rows as unknown as ItemRow[];
}

// -- barcodes ----------------------------------------------------------------------

export interface BarcodeRow {
  id: string;
  itemId: string;
  uomId: string;
  code: string;
}

export async function insertBarcode(input: {
  itemId: string;
  uomId: string;
  code: string;
}): Promise<BarcodeRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.barcodes)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning({
      id: schema.barcodes.id,
      itemId: schema.barcodes.itemId,
      uomId: schema.barcodes.uomId,
      code: schema.barcodes.code,
    });
  return rows[0] as BarcodeRow;
}

export async function listBarcodes(itemId: string): Promise<BarcodeRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.barcodes.id,
      itemId: schema.barcodes.itemId,
      uomId: schema.barcodes.uomId,
      code: schema.barcodes.code,
    })
    .from(schema.barcodes)
    .where(eq(schema.barcodes.itemId, itemId))
    .orderBy(asc(schema.barcodes.code));
  return rows as BarcodeRow[];
}

export async function findBarcodeByCode(code: string): Promise<BarcodeRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.barcodes.id,
      itemId: schema.barcodes.itemId,
      uomId: schema.barcodes.uomId,
      code: schema.barcodes.code,
    })
    .from(schema.barcodes)
    .where(eq(schema.barcodes.code, code))
    .limit(1);
  return (rows as BarcodeRow[])[0];
}

export async function updateBarcode(
  id: string,
  patch: { uomId?: string; code?: string },
): Promise<BarcodeRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.barcodes)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.barcodes.id, id))
    .returning({
      id: schema.barcodes.id,
      itemId: schema.barcodes.itemId,
      uomId: schema.barcodes.uomId,
      code: schema.barcodes.code,
    });
  return (rows as BarcodeRow[])[0];
}

// -- price lists ----------------------------------------------------------------------

export interface PriceListRow {
  id: string;
  name: string;
  nameAr: string | null;
  kind: "SALE" | "PURCHASE";
  currencyCode: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
}

const PL_COLUMNS = {
  id: schema.priceLists.id,
  name: schema.priceLists.name,
  nameAr: schema.priceLists.nameAr,
  kind: schema.priceLists.kind,
  currencyCode: schema.priceLists.currencyCode,
  validFrom: schema.priceLists.validFrom,
  validTo: schema.priceLists.validTo,
  status: schema.priceLists.status,
} as const;

export async function insertPriceList(input: {
  name: string;
  nameAr: string | null;
  kind: string;
  currencyCode: string;
  validFrom: string | null;
  validTo: string | null;
}): Promise<PriceListRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.priceLists)
    .values({
      id: generateUuidV7(),
      ...input,
      kind: input.kind as PriceListRow["kind"],
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(PL_COLUMNS);
  return rows[0] as PriceListRow;
}

export async function findPriceListById(id: string): Promise<PriceListRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(PL_COLUMNS).from(schema.priceLists).where(eq(schema.priceLists.id, id)).limit(1);
  return (rows as PriceListRow[])[0];
}

export async function listPriceLists(kind: string | undefined): Promise<PriceListRow[]> {
  const tx = tenantTx();
  const conditions = kind !== undefined ? eq(schema.priceLists.kind, kind) : undefined;
  const rows = await tx
    .select(PL_COLUMNS)
    .from(schema.priceLists)
    .where(conditions)
    .orderBy(asc(schema.priceLists.name));
  return rows as PriceListRow[];
}

export async function updatePriceList(
  id: string,
  patch: { name?: string; nameAr?: string | null; validFrom?: string | null; validTo?: string | null; status?: string },
): Promise<PriceListRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.priceLists)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.priceLists.id, id))
    .returning(PL_COLUMNS);
  return (rows as PriceListRow[])[0];
}

export interface PriceListItemRow {
  id: string;
  priceListId: string;
  itemId: string;
  uomId: string;
  unitPrice: string;
  minQty: string;
}

const PLI_COLUMNS = {
  id: schema.priceListItems.id,
  priceListId: schema.priceListItems.priceListId,
  itemId: schema.priceListItems.itemId,
  uomId: schema.priceListItems.uomId,
  unitPrice: schema.priceListItems.unitPrice,
  minQty: schema.priceListItems.minQty,
} as const;

export async function insertPriceListItem(input: {
  priceListId: string;
  itemId: string;
  uomId: string;
  unitPrice: string;
  minQty: string;
}): Promise<PriceListItemRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.priceListItems)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(PLI_COLUMNS);
  return rows[0] as PriceListItemRow;
}

export async function listPriceListItems(priceListId: string): Promise<PriceListItemRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select(PLI_COLUMNS)
    .from(schema.priceListItems)
    .where(eq(schema.priceListItems.priceListId, priceListId))
    .orderBy(asc(schema.priceListItems.minQty));
  return rows as PriceListItemRow[];
}

export async function updatePriceListItem(
  id: string,
  patch: { unitPrice?: string; minQty?: string },
): Promise<PriceListItemRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.priceListItems)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.priceListItems.id, id))
    .returning(PLI_COLUMNS);
  return (rows as PriceListItemRow[])[0];
}

/**
 * Tier resolution for a (list, item, qty): the row with the highest
 * min_qty ≤ qty; no row → undefined (caller falls to the next level).
 */
export async function resolvePriceListTier(
  priceListId: string,
  itemId: string,
  qty: string,
): Promise<{ row: PriceListItemRow | undefined; converted: boolean }> {
  const tx = tenantTx();
  const result = await tx.execute(sql`
    SELECT id, price_list_id AS "priceListId", item_id AS "itemId", uom_id AS "uomId",
           unit_price AS "unitPrice", min_qty AS "minQty"
      FROM price_list_items
     WHERE price_list_id = ${priceListId}::uuid AND item_id = ${itemId}::uuid
       AND min_qty <= ${qty}::numeric
     ORDER BY min_qty DESC
     LIMIT 1
  `);
  const row = (result.rows as unknown as PriceListItemRow[])[0];
  return { row, converted: false };
}

/** BR-003 level-1 read: the partner's assigned price list (RLS-confined). */
export async function partnerForPricing(
  partnerId: string,
): Promise<{ priceListId: string | null } | undefined> {
  const tx = tenantTx();
  const result = await tx.execute(sql`
    SELECT price_list_id, deleted_at FROM partners WHERE id = ${partnerId}::uuid
  `);
  const row = (result.rows as unknown as { price_list_id: string | null; deleted_at: string | null }[])[0];
  if (row === undefined || row.deleted_at !== null) {
    return undefined;
  }
  return { priceListId: row.price_list_id };
}

/** BR-003 level-2 read: the branch's default price list (migration 0009). */
export async function branchDefaultPriceListId(
  branchId: string,
): Promise<string | null | undefined> {
  const tx = tenantTx();
  const result = await tx.execute(sql`
    SELECT default_price_list_id FROM branches WHERE id = ${branchId}::uuid
  `);
  const row = (result.rows as unknown as { default_price_list_id: string | null }[])[0];
  return row === undefined ? undefined : row.default_price_list_id;
}

// -- import jobs ------------------------------------------------------------------------

export interface ImportJobRow {
  id: string;
  kind: "PARTNERS" | "ITEMS" | "OPENING_BALANCES";
  format: "CSV" | "XLSX";
  uploadToken: string;
  fileKey: string;
  fileName: string | null;
  status: "PREVIEWING" | "PREVIEW_READY" | "COMMITTING" | "COMMITTED" | "FAILED";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  committedRows: number;
  report: unknown;
  error: string | null;
  committedAt: string | null;
  createdBy: string | null;
}

const JOB_COLUMNS = {
  id: schema.importJobs.id,
  kind: schema.importJobs.kind,
  format: schema.importJobs.format,
  uploadToken: schema.importJobs.uploadToken,
  fileKey: schema.importJobs.fileKey,
  fileName: schema.importJobs.fileName,
  status: schema.importJobs.status,
  totalRows: schema.importJobs.totalRows,
  validRows: schema.importJobs.validRows,
  invalidRows: schema.importJobs.invalidRows,
  duplicateRows: schema.importJobs.duplicateRows,
  committedRows: schema.importJobs.committedRows,
  report: schema.importJobs.report,
  error: schema.importJobs.error,
  committedAt: schema.importJobs.committedAt,
  createdBy: schema.importJobs.createdBy,
} as const;

export async function insertImportJob(input: {
  kind: string;
  format: string;
  uploadToken: string;
  fileKey: string;
  fileName: string | null;
  createdBy: string;
}): Promise<ImportJobRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.importJobs)
    .values({
      id: generateUuidV7(),
      ...input,
      kind: input.kind as ImportJobRow["kind"],
      format: input.format as ImportJobRow["format"],
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(JOB_COLUMNS);
  return rows[0] as ImportJobRow;
}

export async function findImportJobById(id: string): Promise<ImportJobRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(JOB_COLUMNS).from(schema.importJobs).where(eq(schema.importJobs.id, id)).limit(1);
  return (rows as ImportJobRow[])[0];
}

export async function findImportJobByToken(token: string): Promise<ImportJobRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(JOB_COLUMNS).from(schema.importJobs).where(eq(schema.importJobs.uploadToken, token)).limit(1);
  return (rows as ImportJobRow[])[0];
}

export async function updateImportJob(
  id: string,
  patch: {
    status?: string;
    totalRows?: number;
    validRows?: number;
    invalidRows?: number;
    duplicateRows?: number;
    committedRows?: number;
    report?: unknown;
    error?: string | null;
    committedAt?: string | null;
  },
): Promise<ImportJobRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.importJobs)
    .set({
      ...patch,
      ...(patch.status !== undefined ? { status: patch.status as ImportJobRow["status"] } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.importJobs.id, id))
    .returning(JOB_COLUMNS);
  return (rows as ImportJobRow[])[0];
}

/**
 * Atomic PREVIEW_READY → COMMITTING transition (single-apply guarantee for
 * concurrent duplicate commits; the loser sees undefined → typed conflict).
 */
export async function claimImportJobForCommit(id: string): Promise<ImportJobRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.importJobs)
    .set({ status: "COMMITTING", updatedAt: sql`now()` })
    .where(and(eq(schema.importJobs.id, id), eq(schema.importJobs.status, "PREVIEW_READY")))
    .returning(JOB_COLUMNS);
  return (rows as ImportJobRow[])[0];
}

export async function listImportJobs(
  cursor: string | undefined,
  limit: number,
): Promise<{ rows: ImportJobRow[]; hasMore: boolean; nextCursor: string | null }> {
  const tx = tenantTx();
  const clamped = Math.min(Math.max(limit, 1), PAGE_MAX);
  const offset = decodeCursor(cursor);
  const rows = await tx
    .select(JOB_COLUMNS)
    .from(schema.importJobs)
    .orderBy(desc(schema.importJobs.createdAt))
    .limit(clamped + 1)
    .offset(offset);
  const hasMore = rows.length > clamped;
  const page = hasMore ? rows.slice(0, clamped) : rows;
  return { rows: page as ImportJobRow[], hasMore, nextCursor: hasMore ? encodeCursor(offset + clamped) : null };
}

// -- composite components (PHASE-015 T9; items.composite_products) ---------------
//
// `item_components` (migration 0022): one row per (composite, component)
// pair — the definition lines a COMPOSITE-kind item explodes into at sale
// posting. Full-replace semantics live in the service; the store stays a
// pure row adapter over the ambient tenant transaction.

export interface ItemComponentRow {
  id: string;
  compositeItemId: string;
  componentItemId: string;
  componentSku: string;
  componentName: string;
  componentKind: string;
  qty: string;
}

const COMPONENT_COLUMNS = {
  id: schema.itemComponents.id,
  compositeItemId: schema.itemComponents.compositeItemId,
  componentItemId: schema.itemComponents.componentItemId,
  componentSku: schema.items.sku,
  componentName: schema.items.name,
  componentKind: schema.items.kind,
  qty: schema.itemComponents.qty,
} as const;

/** The component definition of one composite, in stable component-sku order. */
export async function listItemComponents(compositeItemId: string): Promise<ItemComponentRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select(COMPONENT_COLUMNS)
    .from(schema.itemComponents)
    .innerJoin(schema.items, eq(schema.items.id, schema.itemComponents.componentItemId))
    .where(eq(schema.itemComponents.compositeItemId, compositeItemId))
    .orderBy(asc(schema.items.sku), asc(schema.itemComponents.createdAt));
  return rows as ItemComponentRow[];
}

/**
 * Replace the whole definition in one statement pair (delete + insert) —
 * the service validates BEFORE calling, so the ambient transaction either
 * lands the complete new set or nothing (idempotent full replace).
 */
export async function replaceItemComponents(
  compositeItemId: string,
  components: readonly { componentItemId: string; qty: string }[],
): Promise<void> {
  const tx = tenantTx();
  await tx.delete(schema.itemComponents).where(eq(schema.itemComponents.compositeItemId, compositeItemId));
  if (components.length > 0) {
    await tx.insert(schema.itemComponents).values(
      components.map((component) => ({
        id: generateUuidV7(),
        tenantId: sql`erp.current_tenant_id()`,
        compositeItemId,
        componentItemId: component.componentItemId,
        qty: component.qty,
      })),
    );
  }
}
