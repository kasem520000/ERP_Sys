import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import * as schema from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Partners data access (PHASE-006; DEPENDENCY_RULES §1 infrastructure layer):
 * pure storage inside the ambient tenant transaction, no business rules.
 * RLS confines every statement to the caller's tenant (A1–A10 green).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("partners access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- partners ----------------------------------------------------------------

export interface PartnerRow {
  id: string;
  tenantId: string;
  kind: "CUSTOMER" | "SUPPLIER" | "BOTH";
  code: string;
  name: string;
  nameAr: string | null;
  taxNumber: string | null;
  creditLimit: string | null;
  creditTermsId: string | null;
  priceListId: string | null;
  /** PHASE-017 (0025): the customer-tier assignment (BR-003 level 2 —
   * distribution owns the tier rows; this column is the per-partner link). */
  customerTierId: string | null;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PartnerListFilter {
  kind?: "CUSTOMER" | "SUPPLIER" | "BOTH";
  status?: string;
  q?: string;
}

const PARTNER_COLUMNS = {
  id: schema.partners.id,
  tenantId: schema.partners.tenantId,
  kind: schema.partners.kind,
  code: schema.partners.code,
  name: schema.partners.name,
  nameAr: schema.partners.nameAr,
  taxNumber: schema.partners.taxNumber,
  creditLimit: schema.partners.creditLimit,
  creditTermsId: schema.partners.creditTermsId,
  priceListId: schema.partners.priceListId,
  customerTierId: schema.partners.customerTierId,
  status: schema.partners.status,
  deletedAt: schema.partners.deletedAt,
  createdAt: schema.partners.createdAt,
  updatedAt: schema.partners.updatedAt,
  version: schema.partners.version,
} as const;

export async function insertPartner(input: {
  kind: string;
  code: string;
  name: string;
  nameAr: string | null;
  taxNumber: string | null;
  creditLimit: string | null;
  creditTermsId: string | null;
  priceListId: string | null;
}): Promise<PartnerRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.partners)
    .values({
      id: generateUuidV7(),
      ...input,
      kind: input.kind as PartnerRow["kind"],
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning();
  return rows[0] as PartnerRow;
}

export async function findPartnerById(id: string): Promise<PartnerRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(PARTNER_COLUMNS).from(schema.partners).where(eq(schema.partners.id, id)).limit(1);
  return (rows as PartnerRow[])[0];
}

export async function findPartnerByCode(code: string): Promise<PartnerRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(PARTNER_COLUMNS)
    .from(schema.partners)
    .where(eq(schema.partners.code, code))
    .limit(1);
  return (rows as PartnerRow[])[0];
}

export async function updatePartner(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    taxNumber?: string | null;
    creditLimit?: string | null;
    creditTermsId?: string | null;
    priceListId?: string | null;
    customerTierId?: string | null;
    status?: string;
    version?: number;
  },
): Promise<PartnerRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.partners)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.nameAr !== undefined ? { nameAr: patch.nameAr } : {}),
      ...(patch.taxNumber !== undefined ? { taxNumber: patch.taxNumber } : {}),
      ...(patch.creditLimit !== undefined ? { creditLimit: patch.creditLimit } : {}),
      ...(patch.creditTermsId !== undefined ? { creditTermsId: patch.creditTermsId } : {}),
      ...(patch.priceListId !== undefined ? { priceListId: patch.priceListId } : {}),
      ...(patch.customerTierId !== undefined ? { customerTierId: patch.customerTierId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.version !== undefined ? { version: patch.version + 1 } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.partners.id, id))
    .returning(PARTNER_COLUMNS);
  return (rows as PartnerRow[])[0];
}

/**
 * PHASE-017 tier-slice write (0025): sets/clears partners.customer_tier_id.
 * Distribution's TierService owns tier rows and calls this additive
 * primitive (partners owns partner rows) — the same documented slice
 * exception as the VAN warehouse columns.
 */
export async function updatePartnerTier(partnerId: string, tierId: string | null): Promise<PartnerRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.partners)
    .set({ customerTierId: tierId, updatedAt: sql`now()` })
    .where(eq(schema.partners.id, partnerId))
    .returning(PARTNER_COLUMNS);
  return (rows as PartnerRow[])[0];
}

/** Customer-tier existence read (validation only — the tier rows are
 * distribution-owned; read-only §6 precedent, priceListExists pattern). */
export async function customerTierExists(tierId: string): Promise<boolean> {
  const tx = tenantTx();
  const result = await tx.execute(
    sql`SELECT 1 FROM customer_tiers WHERE id = ${tierId}::uuid LIMIT 1`,
  );
  return result.rows.length > 0;
}

export async function updatePartnerKind(id: string, kind: string): Promise<PartnerRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.partners)
    .set({ kind: kind as PartnerRow["kind"], updatedAt: sql`now()` })
    .where(eq(schema.partners.id, id))
    .returning(PARTNER_COLUMNS);
  return (rows as PartnerRow[])[0];
}

export async function archivePartner(id: string): Promise<PartnerRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.partners)
    .set({ status: "ARCHIVED", deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.partners.id, id))
    .returning(PARTNER_COLUMNS);
  return (rows as PartnerRow[])[0];
}

export async function countPartnerPostings(_partnerId: string): Promise<number> {
  // No posting tables exist before PHASE-007 — BR-025's "has postings"
  // guard reads the interface that documents/sales will implement. The
  // count is structurally zero today; the contract (and its test) proves
  // kind changes stay impossible once postings arrive (acceptance 2).
  void _partnerId;
  return 0;
}

export interface PartnerListPage {
  rows: PartnerRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_MAX = 100;

export function decodeCursor(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return 0;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      offset?: number;
    };
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

export async function listPartners(
  filter: PartnerListFilter,
  cursor: string | undefined,
  limit: number,
): Promise<PartnerListPage> {
  const tx = tenantTx();
  const clamped = Math.min(Math.max(limit, 1), PAGE_MAX);
  const offset = decodeCursor(cursor);
  const conditions = [isNull(schema.partners.deletedAt)];
  if (filter.kind !== undefined) {
    conditions.push(eq(schema.partners.kind, filter.kind));
  }
  if (filter.status !== undefined) {
    conditions.push(eq(schema.partners.status, filter.status));
  }
  if (filter.q !== undefined && filter.q !== "") {
    conditions.push(
      sql`(name ILIKE ${"%" + filter.q + "%"} OR coalesce(name_ar, '') ILIKE ${"%" + filter.q + "%"})`,
    );
  }
  const rows = await tx
    .select(PARTNER_COLUMNS)
    .from(schema.partners)
    .where(and(...conditions))
    .orderBy(asc(schema.partners.code))
    .limit(clamped + 1)
    .offset(offset);
  const hasMore = rows.length > clamped;
  const page = (hasMore ? rows.slice(0, clamped) : rows) as PartnerRow[];
  return {
    rows: page,
    hasMore,
    nextCursor: hasMore ? encodeCursor(offset + clamped) : null,
  };
}

/**
 * Trigram search (T10; DATABASE_CONVENTIONS §8.5): exact code prefix first,
 * then similarity-ordered partial names across AR+EN. Runs on the
 * (tenant_id, name gin_trgm_ops, name_ar gin_trgm_ops) GIN index.
 */
export async function searchPartners(q: string, limit = 20): Promise<PartnerRow[]> {
  const tx = tenantTx();
  const term = q.trim();
  if (term === "") {
    return [];
  }
  const result = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", kind, code, name, name_ar AS "nameAr",
           tax_number AS "taxNumber", credit_limit AS "creditLimit",
           credit_terms_id AS "creditTermsId", price_list_id AS "priceListId",
           status, deleted_at AS "deletedAt", created_at AS "createdAt",
           updated_at AS "updatedAt", version
      FROM partners
     WHERE deleted_at IS NULL
       AND (code ILIKE ${term + "%"} OR name ILIKE ${"%" + term + "%"} OR coalesce(name_ar, '') ILIKE ${"%" + term + "%"})
     ORDER BY (code ILIKE ${term + "%"}) DESC, similarity(name, ${term}) DESC,
              CASE WHEN name_ar IS NULL THEN 0 ELSE similarity(name_ar, ${term}) END DESC,
              name ASC
     LIMIT ${limit}
  `);
  return result.rows as unknown as PartnerRow[];
}

/**
 * BR-025 auto-numbering: serializes per tenant with a transaction-local
 * advisory lock, then P-00000N from the highest existing P-prefixed code.
 */
export async function nextPartnerCode(): Promise<string> {
  const tx = tenantTx();
  const lock = await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('partners-code:' || erp.current_tenant_id()::text))`,
  );
  void lock;
  const result = await tx.execute(sql`
    SELECT coalesce(max((regexp_replace(code, '^P-', ''))::int), 0) + 1 AS next
      FROM partners
     WHERE code ~ '^P-[0-9]{1,10}$'
  `);
  const next = Number((result.rows[0] as { next: number | string }).next);
  return `P-${String(next).padStart(6, "0")}`;
}

// -- contacts + addresses ------------------------------------------------------

export interface PartnerContactRow {
  id: string;
  partnerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
}

export async function insertPartnerContact(input: {
  partnerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
}): Promise<PartnerContactRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.partnerContacts)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning({
      id: schema.partnerContacts.id,
      partnerId: schema.partnerContacts.partnerId,
      name: schema.partnerContacts.name,
      phone: schema.partnerContacts.phone,
      email: schema.partnerContacts.email,
      role: schema.partnerContacts.role,
      isPrimary: schema.partnerContacts.isPrimary,
    });
  return rows[0] as PartnerContactRow;
}

export async function listPartnerContacts(partnerId: string): Promise<PartnerContactRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.partnerContacts.id,
      partnerId: schema.partnerContacts.partnerId,
      name: schema.partnerContacts.name,
      phone: schema.partnerContacts.phone,
      email: schema.partnerContacts.email,
      role: schema.partnerContacts.role,
      isPrimary: schema.partnerContacts.isPrimary,
    })
    .from(schema.partnerContacts)
    .where(eq(schema.partnerContacts.partnerId, partnerId))
    .orderBy(desc(schema.partnerContacts.isPrimary), asc(schema.partnerContacts.createdAt));
  return rows as PartnerContactRow[];
}

export async function updatePartnerContact(
  id: string,
  patch: { name?: string; phone?: string | null; email?: string | null; role?: string | null },
): Promise<PartnerContactRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.partnerContacts)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.partnerContacts.id, id))
    .returning({
      id: schema.partnerContacts.id,
      partnerId: schema.partnerContacts.partnerId,
      name: schema.partnerContacts.name,
      phone: schema.partnerContacts.phone,
      email: schema.partnerContacts.email,
      role: schema.partnerContacts.role,
      isPrimary: schema.partnerContacts.isPrimary,
    });
  return (rows as PartnerContactRow[])[0];
}

export interface PartnerAddressRow {
  id: string;
  partnerId: string;
  type: string;
  line1: string;
  line2: string | null;
  city: string | null;
  countryCode: string | null;
}

export async function insertPartnerAddress(input: {
  partnerId: string;
  type: string;
  line1: string;
  line2: string | null;
  city: string | null;
  countryCode: string | null;
}): Promise<PartnerAddressRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.partnerAddresses)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning({
      id: schema.partnerAddresses.id,
      partnerId: schema.partnerAddresses.partnerId,
      type: schema.partnerAddresses.type,
      line1: schema.partnerAddresses.line1,
      line2: schema.partnerAddresses.line2,
      city: schema.partnerAddresses.city,
      countryCode: schema.partnerAddresses.countryCode,
    });
  return rows[0] as PartnerAddressRow;
}

export async function listPartnerAddresses(partnerId: string): Promise<PartnerAddressRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.partnerAddresses.id,
      partnerId: schema.partnerAddresses.partnerId,
      type: schema.partnerAddresses.type,
      line1: schema.partnerAddresses.line1,
      line2: schema.partnerAddresses.line2,
      city: schema.partnerAddresses.city,
      countryCode: schema.partnerAddresses.countryCode,
    })
    .from(schema.partnerAddresses)
    .where(eq(schema.partnerAddresses.partnerId, partnerId))
    .orderBy(asc(schema.partnerAddresses.createdAt));
  return rows as PartnerAddressRow[];
}

// -- credit terms ---------------------------------------------------------------

export interface CreditTermsRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  days: number;
  description: string | null;
  isSystem: boolean;
}

export async function insertCreditTerms(input: {
  code: string;
  name: string;
  nameAr: string | null;
  days: number;
  description: string | null;
}): Promise<CreditTermsRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.creditTerms)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning({
      id: schema.creditTerms.id,
      code: schema.creditTerms.code,
      name: schema.creditTerms.name,
      nameAr: schema.creditTerms.nameAr,
      days: schema.creditTerms.days,
      description: schema.creditTerms.description,
      isSystem: schema.creditTerms.isSystem,
    });
  return rows[0] as CreditTermsRow;
}

export async function listCreditTerms(): Promise<CreditTermsRow[]> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.creditTerms.id,
      code: schema.creditTerms.code,
      name: schema.creditTerms.name,
      nameAr: schema.creditTerms.nameAr,
      days: schema.creditTerms.days,
      description: schema.creditTerms.description,
      isSystem: schema.creditTerms.isSystem,
    })
    .from(schema.creditTerms)
    .orderBy(asc(schema.creditTerms.days));
  return rows as CreditTermsRow[];
}

export async function findCreditTermsById(id: string): Promise<CreditTermsRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.creditTerms.id,
      code: schema.creditTerms.code,
      name: schema.creditTerms.name,
      nameAr: schema.creditTerms.nameAr,
      days: schema.creditTerms.days,
      description: schema.creditTerms.description,
      isSystem: schema.creditTerms.isSystem,
    })
    .from(schema.creditTerms)
    .where(eq(schema.creditTerms.id, id))
    .limit(1);
  return (rows as CreditTermsRow[])[0];
}

export async function findCreditTermsByCode(code: string): Promise<CreditTermsRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      id: schema.creditTerms.id,
      code: schema.creditTerms.code,
      name: schema.creditTerms.name,
      nameAr: schema.creditTerms.nameAr,
      days: schema.creditTerms.days,
      description: schema.creditTerms.description,
      isSystem: schema.creditTerms.isSystem,
    })
    .from(schema.creditTerms)
    .where(eq(schema.creditTerms.code, code))
    .limit(1);
  return (rows as CreditTermsRow[])[0];
}

export async function updateCreditTerms(
  id: string,
  patch: { name?: string; nameAr?: string | null; days?: number; description?: string | null },
): Promise<CreditTermsRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.creditTerms)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.creditTerms.id, id))
    .returning({
      id: schema.creditTerms.id,
      code: schema.creditTerms.code,
      name: schema.creditTerms.name,
      nameAr: schema.creditTerms.nameAr,
      days: schema.creditTerms.days,
      description: schema.creditTerms.description,
      isSystem: schema.creditTerms.isSystem,
    });
  return (rows as CreditTermsRow[])[0];
}

// -- partner_balances read model (MODULE_BOUNDARIES: partners-owned) -----------

export interface PartnerBalanceRow {
  partnerId: string;
  openBalance: string;
  draftBalance: string;
  overdueAmount: string;
}

export async function findPartnerBalance(partnerId: string): Promise<PartnerBalanceRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select({
      partnerId: schema.partnerBalances.partnerId,
      openBalance: schema.partnerBalances.openBalance,
      draftBalance: schema.partnerBalances.draftBalance,
      overdueAmount: schema.partnerBalances.overdueAmount,
    })
    .from(schema.partnerBalances)
    .where(eq(schema.partnerBalances.partnerId, partnerId))
    .limit(1);
  return (rows as PartnerBalanceRow[])[0];
}

/**
 * Recompute a partner's read-model row from opening-balance drafts (the
 * only source that exists at this phase; PHASE-007+ extends the source set
 * per MODULE_BOUNDARIES — this function stays the single maintenance point).
 */
export async function recomputePartnerBalance(partnerId: string): Promise<PartnerBalanceRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO partner_balances AS pb (id, tenant_id, partner_id, open_balance, draft_balance, overdue_amount, last_recomputed_at)
    VALUES (
      ${generateUuidV7()}::uuid,
      erp.current_tenant_id(),
      ${partnerId}::uuid,
      0,
      coalesce((SELECT amount FROM opening_balance_docs
                 WHERE partner_id = ${partnerId}::uuid AND kind = 'PARTNER' AND status = 'DRAFT'), 0),
      0,
      now()
    )
    ON CONFLICT (tenant_id, partner_id) DO UPDATE
      SET draft_balance = coalesce((SELECT amount FROM opening_balance_docs
                 WHERE partner_id = ${partnerId}::uuid AND kind = 'PARTNER' AND status = 'DRAFT'), 0),
          last_recomputed_at = now(),
          updated_at = now(),
          version = pb.version + 1
    RETURNING partner_id AS "partnerId", open_balance AS "openBalance",
              draft_balance AS "draftBalance", overdue_amount AS "overdueAmount"
  `);
  return (rows.rows as unknown as PartnerBalanceRow[])[0]!;
}

// -- opening-balance drafts -----------------------------------------------------

export interface OpeningBalanceDocRow {
  id: string;
  kind: "PARTNER" | "ACCOUNT" | "STOCK";
  partnerId: string | null;
  accountId: string | null;
  itemId: string | null;
  qty: string | null;
  unitCost: string | null;
  amount: string | null;
  currencyCode: string;
  note: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const OBD_COLUMNS = {
  id: schema.openingBalanceDocs.id,
  kind: schema.openingBalanceDocs.kind,
  partnerId: schema.openingBalanceDocs.partnerId,
  accountId: schema.openingBalanceDocs.accountId,
  itemId: schema.openingBalanceDocs.itemId,
  qty: schema.openingBalanceDocs.qty,
  unitCost: schema.openingBalanceDocs.unitCost,
  amount: schema.openingBalanceDocs.amount,
  currencyCode: schema.openingBalanceDocs.currencyCode,
  note: schema.openingBalanceDocs.note,
  status: schema.openingBalanceDocs.status,
  createdAt: schema.openingBalanceDocs.createdAt,
  updatedAt: schema.openingBalanceDocs.updatedAt,
  version: schema.openingBalanceDocs.version,
} as const;

export async function insertOpeningBalanceDoc(input: {
  kind: string;
  partnerId: string | null;
  accountId: string | null;
  itemId: string | null;
  qty: string | null;
  unitCost: string | null;
  amount: string | null;
  currencyCode: string;
  note: string | null;
}): Promise<OpeningBalanceDocRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.openingBalanceDocs)
    .values({
      id: generateUuidV7(),
      ...input,
      kind: input.kind as OpeningBalanceDocRow["kind"],
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(OBD_COLUMNS);
  return rows[0] as OpeningBalanceDocRow;
}

export async function findOpeningBalanceDocById(id: string): Promise<OpeningBalanceDocRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(OBD_COLUMNS)
    .from(schema.openingBalanceDocs)
    .where(eq(schema.openingBalanceDocs.id, id))
    .limit(1);
  return (rows as OpeningBalanceDocRow[])[0];
}

/** Duplicate-DRAFT checks (service rule mirroring the partial uniques). */
export async function findOpeningBalanceDocForPartner(
  partnerId: string,
): Promise<OpeningBalanceDocRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(OBD_COLUMNS)
    .from(schema.openingBalanceDocs)
    .where(and(eq(schema.openingBalanceDocs.kind, "PARTNER"), eq(schema.openingBalanceDocs.partnerId, partnerId)))
    .limit(1);
  return (rows as OpeningBalanceDocRow[])[0];
}

export async function findOpeningBalanceDocForAccount(
  accountId: string,
): Promise<OpeningBalanceDocRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(OBD_COLUMNS)
    .from(schema.openingBalanceDocs)
    .where(and(eq(schema.openingBalanceDocs.kind, "ACCOUNT"), eq(schema.openingBalanceDocs.accountId, accountId)))
    .limit(1);
  return (rows as OpeningBalanceDocRow[])[0];
}

export async function findOpeningBalanceDocForItem(
  itemId: string,
): Promise<OpeningBalanceDocRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(OBD_COLUMNS)
    .from(schema.openingBalanceDocs)
    .where(and(eq(schema.openingBalanceDocs.kind, "STOCK"), eq(schema.openingBalanceDocs.itemId, itemId)))
    .limit(1);
  return (rows as OpeningBalanceDocRow[])[0];
}

/** Account existence read (validation only — no cross-module writes). */
export async function accountExists(accountId: string): Promise<boolean> {
  const tx = tenantTx();
  const result = await tx.execute(
    sql`SELECT 1 FROM accounts WHERE id = ${accountId}::uuid LIMIT 1`,
  );
  return result.rows.length > 0;
}

/** Price-list existence read (validation only — no cross-module writes). */
export async function priceListExists(priceListId: string): Promise<boolean> {
  const tx = tenantTx();
  const result = await tx.execute(
    sql`SELECT 1 FROM price_lists WHERE id = ${priceListId}::uuid LIMIT 1`,
  );
  return result.rows.length > 0;
}

/** Account id by natural code (import resolution; RLS-confined). */
export async function accountIdByCode(code: string): Promise<string | undefined> {
  const tx = tenantTx();
  const result = await tx.execute(
    sql`SELECT id FROM accounts WHERE code = ${code} LIMIT 1`,
  );
  return (result.rows as unknown as { id: string }[])[0]?.id;
}

export async function updateOpeningBalanceDoc(
  id: string,
  patch: {
    amount?: string | null;
    qty?: string | null;
    unitCost?: string | null;
    note?: string | null;
    version?: number;
  },
): Promise<OpeningBalanceDocRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.openingBalanceDocs)
    .set({
      ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
      ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
      ...(patch.unitCost !== undefined ? { unitCost: patch.unitCost } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.version !== undefined ? { version: patch.version + 1 } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.openingBalanceDocs.id, id))
    .returning(OBD_COLUMNS);
  return (rows as OpeningBalanceDocRow[])[0];
}

export async function listOpeningBalanceDocs(
  kind: string | undefined,
  cursor: string | undefined,
  limit: number,
): Promise<PartnerListPage> {
  const tx = tenantTx();
  const clamped = Math.min(Math.max(limit, 1), PAGE_MAX);
  const offset = decodeCursor(cursor);
  const conditions =
    kind !== undefined
      ? and(eq(schema.openingBalanceDocs.kind, kind))
      : undefined;
  const rows = await tx
    .select(OBD_COLUMNS)
    .from(schema.openingBalanceDocs)
    .where(conditions)
    .orderBy(desc(schema.openingBalanceDocs.createdAt))
    .limit(clamped + 1)
    .offset(offset);
  const hasMore = rows.length > clamped;
  const page = hasMore ? rows.slice(0, clamped) : rows;
  return {
    rows: page as unknown as PartnerRow[],
    hasMore,
    nextCursor: hasMore ? encodeCursor(offset + clamped) : null,
  };
}

// ---------------------------------------------------------------------------
// opening-balance drafts — posting-side reads (PHASE-007 T14; read seam the
// accounting module consumes through this module's api surface)

export interface OpeningBalanceDocForPosting {
  id: string;
  kind: "PARTNER" | "ACCOUNT" | "STOCK";
  partnerId: string | null;
  accountId: string | null;
  itemId: string | null;
  amount: string | null;
  qty: string | null;
  unitCost: string | null;
  currencyCode: string;
  status: string;
}

export async function listOpeningBalanceDocsForPosting(
  kind?: string,
): Promise<OpeningBalanceDocForPosting[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, kind, partner_id AS "partnerId", account_id AS "accountId", item_id AS "itemId",
           amount, qty, unit_cost AS "unitCost", currency_code AS "currencyCode", status
    FROM opening_balance_docs
    WHERE (${kind ?? null}::text IS NULL OR kind = ${kind ?? null})
    ORDER BY created_at
  `);
  return rows.rows as unknown as OpeningBalanceDocForPosting[];
}
