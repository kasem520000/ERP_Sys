import { beforeAll, describe, expect, it } from "vitest";

import { appClient, ensureTestDb, seedTenants, superuserClient, TENANT_A, TENANT_B } from "../test-db";
import {
  TENANT_TABLE_NAMES,
  TENANT_TABLES_REGISTRY,
} from "./tables.registry";

/**
 * PHASE-003 T13 — the FIRST FULL RUN of the tenant-isolation attack suite
 * (TENANT_ISOLATION_TESTS §2; SECURITY_TEST_PLAN §2) over every registered
 * tenant-owned table, generated from the registry:
 *
 * - A1 no-GUC reads fail closed                     - A7 id-based probes see nothing
 * - A2 foreign-GUC reads never leak this tenant     - A8 aggregates stay empty
 * - A3 mismatched-tenant INSERTs are policy-denied  - A9 join shapes stay confined
 * - A4 foreign-GUC UPDATEs touch 0 rows             - A10 union/CTE shapes confined
 * - A5 DELETE is denied by grants (no DELETE grant)
 * - Structural: FORCE RLS + USING/WITH CHECK per table; registry completeness
 *   (a tenant-owned table missing from the registry fails the build).
 *
 * Fixtures are seeded by the bootstrap role (superuser) exactly like a
 * migration would; every ATTACK runs as `erp_app` (RLS enforced).
 *
 * Variant-policy tables (roles, role_permissions): template rows
 * (tenant_id IS NULL) are intentionally readable by every tenant — the
 * generated A2 expectation for them counts ONLY tenant-owned rows, and the
 * write attacks still must not cross tenants. Dedicated template-guard
 * tests prove the app role can never INSERT/UPDATE/DELETE a template row.
 */

const VARIANT = new Set(
  TENANT_TABLES_REGISTRY.filter((row) => row.variantTemplateRows).map((row) => row.table),
);

/** Tables whose app-role DELETE grant is by-design (A5: 0 foreign rows). */
const DELETE_GRANTED = new Set(
  TENANT_TABLES_REGISTRY.filter((row) => row.deleteGranted).map((row) => row.table),
);

/** Tables with NO app-role UPDATE grant at all (A4: the denial itself proves
 * the row cannot be touched — journal_lines/partner_subledger_entries are
 * append-only by grants per INV-003/INV-009, like audit_events). */
const NO_UPDATE_GRANT = new Set([
  "audit_events",
  "journal_lines",
  "partner_subledger_entries",
  "cash_movements",
  "treasury_allocations",
  // PHASE-016 (migration 0024): the sync change feed is append-only.
  "change_log",
  // PHASE-009 (migration 0013): INV-012's append-only substrate.
  "tax_document_summaries",
  // PHASE-010 (migration 0014): the append-only stock ledger (INV-010/
  // INV-017 — grants + guard trigger mirror cash_movements).
  "stock_moves",
  // PHASE-011 (migration 0017): the audited re-allocation documents are
  // INSERT-only by grants (status CHECK admits only POSTED — the trail
  // cannot be rewritten).
  "purchase_reallocations",
  "purchase_reallocation_lines",
  // PHASE-020 (migration 0029): the push dedupe ledger is INSERT + DELETE
  // only (the retention job's sweep) — replays rewrite nothing, ever.
  "inbox_commands",
  // PHASE-012 (migration 0019): the sales mirror — INSERT-only by grants.
  "sales_reallocations",
  "sales_reallocation_lines",
  // PHASE-014 (migration 0021): the append-only billing trail (grants +
  // guard trigger — the audit_events pattern).
  "billing_events",
  // PHASE-023 (migration 0035): the certificate usage audit is
  // INSERT + SELECT only (grants) — every decrypt/sign is append-only
  // history; retention is the DELETE-granted sweep.
  "e_invoicing_certificate_usage",
  // PHASE-026 (migration 0037): the per-asset depreciation lines are
  // append-only 🔒 (INV-003 pattern): UPDATE is grant-denied outright
  // (proven here); DELETE is grant-CAPABLE but policy-owned by the
  // erp.depreciation_lines_guard trigger (posted-run lines are immutable
  // history — DELETE passes only for purge_mode or DRAFT-run assembly
  // resets). The column fallback below (updated_at) exists on the table,
  // so the A4 denial proves the grant shape directly.
  "depreciation_lines",
  // PHASE-029 (migration 0040): the per-employee run lines are append-only
  // 🔒 (INV-003/INV-025 pattern): UPDATE is grant-denied outright (proven
  // here); DELETE is grant-CAPABLE but policy-owned by the
  // erp.payroll_run_lines_guard trigger (posted-run lines are immutable
  // history — DELETE passes only for purge_mode or DRAFT-run recalculation
  // resets). The updated_at column exists, so the A4 denial proves the
  // grant shape directly.
  "payroll_run_lines",
  // PHASE-027 (migration 0038): the append-only 🔒 custody log (INV-003/
  // INV-024 pattern): UPDATE is grant-denied outright (proven here); DELETE
  // is grant-CAPABLE but policy-owned by the erp.note_events_guard trigger
  // (custody history is immutable — DELETE passes only under purge_mode).
  "note_events",
]);

/** Fixture rows seeded per tenant (A2's total-count expectation). The
 * default is exactly one per registered table; uoms carries two (KG + G —
 * the conversion fixture needs a valid from≠to pair); journal_lines carries
 * two (a balanced DEBIT+CREDIT pair — the INV-001/002 deferred trigger
 * enforces balance on every committed entry, fixture or not). */
const EXPECTED_ROWS_PER_TENANT: Record<string, number> = {
  uoms: 2,
  journal_lines: 2,
  // PHASE-008: two GL hosts (the 1:1 cash-account link needs distinct
  // accounts) + two treasury accounts (CASH + BANK — transfers require
  // from ≠ to).
  accounts: 2,
  cash_accounts: 2,
  // PHASE-010: two warehouses per tenant (transfers require from ≠ to).
  warehouses: 2,
  // PHASE-015: the stock fixture + the COMPOSITE fixture (item_components
  // needs two distinct items per tenant — the distinct-component CHECK).
  items: 2,
};
function expectedRowsFor(table: string): number {
  return EXPECTED_ROWS_PER_TENANT[table] ?? 1;
}

/** A tenant-owned row per registered table, seeded as the bootstrap role. */
async function seedFixtures(superuser: {
  query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number | null }>;
}): Promise<void> {
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES
       ('dddddddd-0000-4000-8000-000000000001', $1, 'owner_a', 'Owner A', 'مالك أ', false),
       ('dddddddd-0000-4000-8000-000000000002', $2, 'owner_b', 'Owner B', 'مالك ب', false)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     VALUES ('dddddddd-0000-4000-8000-000000000001', $1, 'partners.view'),
            ('dddddddd-0000-4000-8000-000000000002', $2, 'partners.view')
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // users are global; one per tenant for memberships/invitations/sessions.
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES
       ('eeeeeeee-0000-4000-8000-000000000001', 'iso-a@test', 'A', 'x', 'ACTIVE'),
       ('eeeeeeee-0000-4000-8000-000000000002', 'iso-b@test', 'B', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
  );
  // PHASE-004 fixtures (migrations 0006/0007): one row per registered
  // table per tenant, FK-consistent, idempotent.
  await superuser.query(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES
       ('abababab-0000-4000-8000-000000000001', $1, 'MAIN', 'Branch A', 'فرع أ'),
       ('abababab-0000-4000-8000-000000000002', $2, 'MAIN', 'Branch B', 'فرع ب')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES
       ('acacacac-0000-4000-8000-000000000001', $1, 'general.default_locale', '"ar"'::jsonb),
       ('acacacac-0000-4000-8000-000000000002', $2, 'general.default_locale', '"ar"'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO subscriptions (id, tenant_id, plan_id, period_start, period_end)
     VALUES
       ('adadadad-0000-4000-8000-000000000001', $1,
        '30000000-0000-4000-8000-000000000002', '2026-01-01', '2026-12-31'),
       ('adadadad-0000-4000-8000-000000000002', $2,
        '30000000-0000-4000-8000-000000000002', '2026-01-01', '2026-12-31')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES
       ('aeaeaeae-0000-4000-8000-000000000001', $1, 'platform.branches', 'PLAN'),
       ('aeaeaeae-0000-4000-8000-000000000002', $2, 'platform.branches', 'PLAN')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO support_sessions (id, tenant_id, platform_user_id, opt_in, ticket_ref, reason, expires_at)
     VALUES
       ('afafafaf-0000-4000-8000-000000000001', $1,
        'eeeeeeee-0000-4000-8000-000000000001', false, 'ISO-1', 'iso fixture',
        now() + interval '4 hours'),
       ('afafafaf-0000-4000-8000-000000000002', $2,
        'eeeeeeee-0000-4000-8000-000000000002', false, 'ISO-2', 'iso fixture',
        now() + interval '4 hours')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES
       ('b0b0b0b0-0000-4000-8000-000000000001', $1, '1000', 'Assets A', 'الأصول', 'ASSET', false),
       ('b0b0b0b0-0000-4000-8000-000000000002', $2, '1000', 'Assets B', 'الأصول', 'ASSET', false)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
     VALUES
       ('b1b1b1b1-0000-4000-8000-000000000001', $1, 'AR_CONTROL',
        'b0b0b0b0-0000-4000-8000-000000000001', '2026-01-01'),
       ('b1b1b1b1-0000-4000-8000-000000000002', $2, 'AR_CONTROL',
        'b0b0b0b0-0000-4000-8000-000000000002', '2026-01-01')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES
       ('ffffffff-0000-4000-8000-000000000001', $1, 'eeeeeeee-0000-4000-8000-000000000001',
        'dddddddd-0000-4000-8000-000000000001'),
       ('ffffffff-0000-4000-8000-000000000002', $2, 'eeeeeeee-0000-4000-8000-000000000002',
        'dddddddd-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO invitations (id, tenant_id, email, role_id, token_hash, expires_at, invited_by)
     VALUES
       ('eeeeeeee-1000-4000-8000-000000000001', $1, 'iso-a@test',
        'dddddddd-0000-4000-8000-000000000001', 'iso-token-a', now() + interval '72 hours',
        'eeeeeeee-0000-4000-8000-000000000001'),
       ('eeeeeeee-1000-4000-8000-000000000002', $2, 'iso-b@test',
        'dddddddd-0000-4000-8000-000000000002', 'iso-token-b', now() + interval '72 hours',
        'eeeeeeee-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id)
     VALUES
       ('eeeeeeee-2000-4000-8000-000000000001', $1, 'iso.seed', 'iso_fixture', $1),
       ('eeeeeeee-2000-4000-8000-000000000002', $2, 'iso.seed', 'iso_fixture', $2)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-006 fixtures (migration 0009): one row per registered table per
  // tenant, FK-consistent, idempotent. (The migration's per-tenant uom/
  // credit-terms backfill only covers tenants existing at migration time —
  // the suite's tenants are created after the fresh boot, so the canonical
  // `is_system` rows are instantiated here exactly like onboarding does.)
  await superuser.query(
    `INSERT INTO uoms (id, tenant_id, code, name, name_ar, is_system)
     VALUES
       ('b2b2b2b2-0000-4000-8000-000000000001', $1, 'KG', 'Kilogram', 'كيلوجرام', true),
       ('b2b2b2b2-0000-4000-8000-000000000002', $2, 'KG', 'Kilogram', 'كيلوجرام', true)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO uoms (id, tenant_id, code, name, name_ar, is_system)
     VALUES
       ('b2b2b2b2-1000-4000-8000-000000000001', $1, 'G', 'Gram', 'جرام', true),
       ('b2b2b2b2-1000-4000-8000-000000000002', $2, 'G', 'Gram', 'جرام', true)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO credit_terms (id, tenant_id, code, name, name_ar, days, is_system)
     VALUES
       ('b3b3b3b3-0000-4000-8000-000000000001', $1, 'NET-30', 'Net 30 days', 'صافي 30 يومًا', 30, true),
       ('b3b3b3b3-0000-4000-8000-000000000002', $2, 'NET-30', 'Net 30 days', 'صافي 30 يومًا', 30, true)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO price_lists (id, tenant_id, name, name_ar, kind, currency_code)
     VALUES
       ('b4b4b4b4-0000-4000-8000-000000000001', $1, 'ISO List A', 'قائمة أ', 'SALE', 'SAR'),
       ('b4b4b4b4-0000-4000-8000-000000000002', $2, 'ISO List B', 'قائمة ب', 'SALE', 'SAR')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar, credit_terms_id, price_list_id)
     VALUES
       ('b5b5b5b5-0000-4000-8000-000000000001', $1, 'CUSTOMER', 'ISO-A', 'Partner A', 'جهة أ',
        'b3b3b3b3-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000001'),
       ('b5b5b5b5-0000-4000-8000-000000000002', $2, 'CUSTOMER', 'ISO-B', 'Partner B', 'جهة ب',
        'b3b3b3b3-0000-4000-8000-000000000002', 'b4b4b4b4-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO partner_contacts (id, tenant_id, partner_id, name)
     VALUES
       ('b6b6b6b6-0000-4000-8000-000000000001', $1, 'b5b5b5b5-0000-4000-8000-000000000001', 'Contact A'),
       ('b6b6b6b6-0000-4000-8000-000000000002', $2, 'b5b5b5b5-0000-4000-8000-000000000002', 'Contact B')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO partner_addresses (id, tenant_id, partner_id, type, line1)
     VALUES
       ('b7b7b7b7-0000-4000-8000-000000000001', $1, 'b5b5b5b5-0000-4000-8000-000000000001', 'BILLING', 'Line A'),
       ('b7b7b7b7-0000-4000-8000-000000000002', $2, 'b5b5b5b5-0000-4000-8000-000000000002', 'BILLING', 'Line B')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO item_categories (id, tenant_id, code, name, name_ar)
     VALUES
       ('b8b8b8b8-0000-4000-8000-000000000001', $1, 'CAT-A', 'Category A', 'فئة أ'),
       ('b8b8b8b8-0000-4000-8000-000000000002', $2, 'CAT-B', 'Category B', 'فئة ب')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO uom_conversions (id, tenant_id, from_uom_id, to_uom_id, factor)
     VALUES
       ('b9b9b9b9-0000-4000-8000-000000000001', $1,
        'b2b2b2b2-0000-4000-8000-000000000001', 'b2b2b2b2-1000-4000-8000-000000000001', 1000),
       ('b9b9b9b9-0000-4000-8000-000000000002', $2,
        'b2b2b2b2-0000-4000-8000-000000000002', 'b2b2b2b2-1000-4000-8000-000000000002', 1000)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, category_id)
     VALUES
       ('babababa-0000-4000-8000-000000000001', $1, 'ISO-ITEM-A', 'Item A', 'صنف أ', 'STOCK',
        'b2b2b2b2-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000001'),
       ('babababa-0000-4000-8000-000000000002', $2, 'ISO-ITEM-B', 'Item B', 'صنف ب', 'STOCK',
        'b2b2b2b2-0000-4000-8000-000000000002', 'b8b8b8b8-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO barcodes (id, tenant_id, item_id, uom_id, code)
     VALUES
       ('bbbbbbbb-0000-4000-8000-000000000001', $1,
        'babababa-0000-4000-8000-000000000001', 'b2b2b2b2-0000-4000-8000-000000000001', '1234567890128'),
       ('bbbbbbbb-0000-4000-8000-000000000002', $2,
        'babababa-0000-4000-8000-000000000002', 'b2b2b2b2-0000-4000-8000-000000000002', '1234567890129')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO price_list_items (id, tenant_id, price_list_id, item_id, uom_id, unit_price)
     VALUES
       ('bcbcbcbc-0000-4000-8000-000000000001', $1,
        'b4b4b4b4-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001',
        'b2b2b2b2-0000-4000-8000-000000000001', 10),
       ('bcbcbcbc-0000-4000-8000-000000000002', $2,
        'b4b4b4b4-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
        'b2b2b2b2-0000-4000-8000-000000000002', 10)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO partner_balances (id, tenant_id, partner_id, draft_balance)
     VALUES
       ('bdbdbdbd-0000-4000-8000-000000000001', $1, 'b5b5b5b5-0000-4000-8000-000000000001', 100),
       ('bdbdbdbd-0000-4000-8000-000000000002', $2, 'b5b5b5b5-0000-4000-8000-000000000002', 100)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO opening_balance_docs (id, tenant_id, kind, partner_id, amount, currency_code)
     VALUES
       ('bebebebe-0000-4000-8000-000000000001', $1, 'PARTNER',
        'b5b5b5b5-0000-4000-8000-000000000001', 100, 'SAR'),
       ('bebebebe-0000-4000-8000-000000000002', $2, 'PARTNER',
        'b5b5b5b5-0000-4000-8000-000000000002', 100, 'SAR')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
     VALUES
       ('bfbfbfbf-0000-4000-8000-000000000001', $1, 'PARTNER', 'b5b5b5b5-0000-4000-8000-000000000001',
        'iso/fixture-a.pdf', 'fixture-a.pdf', 1234, 'application/pdf'),
       ('bfbfbfbf-0000-4000-8000-000000000002', $2, 'PARTNER', 'b5b5b5b5-0000-4000-8000-000000000002',
        'iso/fixture-b.pdf', 'fixture-b.pdf', 1234, 'application/pdf')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO import_jobs (id, tenant_id, kind, format, upload_token, file_key, created_by)
     VALUES
       ('c0c0c0c0-0000-4000-8000-000000000001', $1, 'PARTNERS', 'CSV', 'iso-token-a',
        'iso/partners-a.csv', 'eeeeeeee-0000-4000-8000-000000000001'),
       ('c0c0c0c0-0000-4000-8000-000000000002', $2, 'PARTNERS', 'CSV', 'iso-token-b',
        'iso/partners-b.csv', 'eeeeeeee-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-007 fixtures (migrations 0010/0011): one row per registered table
  // per tenant, FK-consistent, idempotent. journal_lines carries the
  // balanced DEBIT+CREDIT pair the deferred INV-001/002 trigger demands;
  // partner_subledger_entries references the AR line (INV-009 shape).
  await superuser.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date)
     VALUES
       ('c1c1c1c1-0000-4000-8000-000000000001', $1, 'FY2026', '2026-01-01', '2026-12-31'),
       ('c1c1c1c1-0000-4000-8000-000000000002', $2, 'FY2026', '2026-01-01', '2026-12-31')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date)
     VALUES
       ('c2c2c2c2-0000-4000-8000-000000000001', $1, 'c1c1c1c1-0000-4000-8000-000000000001',
        '2026-01', 'REGULAR', '2026-01-01', '2026-01-31'),
       ('c2c2c2c2-0000-4000-8000-000000000002', $2, 'c1c1c1c1-0000-4000-8000-000000000002',
        '2026-01', 'REGULAR', '2026-01-01', '2026-01-31')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO exchange_rates (id, tenant_id, currency_code, rate_date, rate)
     VALUES
       ('c3c3c3c3-0000-4000-8000-000000000001', $1, 'USD', '2026-01-15', 3.75),
       ('c3c3c3c3-0000-4000-8000-000000000002', $2, 'USD', '2026-01-15', 3.75)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO cost_centers (id, tenant_id, code, name, name_ar)
     VALUES
       ('c4c4c4c4-0000-4000-8000-000000000001', $1, 'CC-A', 'HQ', 'المركز الرئيسي'),
       ('c4c4c4c4-0000-4000-8000-000000000002', $2, 'CC-A', 'HQ', 'المركز الرئيسي')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO recurring_journals (id, tenant_id, name, template, schedule, start_date, next_run_date)
     VALUES
       ('c5c5c5c5-0000-4000-8000-000000000001', $1, 'ISO rent',
        '{"lines": []}'::jsonb, 'MONTHLY', '2026-01-01', '2026-02-01'),
       ('c5c5c5c5-0000-4000-8000-000000000002', $2, 'ISO rent',
        '{"lines": []}'::jsonb, 'MONTHLY', '2026-01-01', '2026-02-01')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO approval_policies (id, tenant_id, doc_type, policy, applies_from)
     VALUES
       ('c6c6c6c6-0000-4000-8000-000000000001', $1, 'journal_entry',
        '{"mode": "single-approver"}'::jsonb, '2026-01-01'),
       ('c6c6c6c6-0000-4000-8000-000000000002', $2, 'journal_entry',
        '{"mode": "single-approver"}'::jsonb, '2026-01-01')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO numbering_sequences (id, tenant_id, doc_type, period_key, next_value)
     VALUES
       ('c7c7c7c7-0000-4000-8000-000000000001', $1, 'journal_entry', '2026', 2),
       ('c7c7c7c7-0000-4000-8000-000000000002', $2, 'journal_entry', '2026', 2)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO number_assignments (id, tenant_id, doc_type, period_key, number, value)
     VALUES
       ('c8c8c8c8-0000-4000-8000-000000000001', $1, 'journal_entry', '2026', 'JE-2026-000001', 1),
       ('c8c8c8c8-0000-4000-8000-000000000002', $2, 'journal_entry', '2026', 'JE-2026-000001', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO manual_journals (id, tenant_id, created_by, status, entry_date, currency_code)
     VALUES
       ('c9c9c9c9-0000-4000-8000-000000000001', $1, 'eeeeeeee-0000-4000-8000-000000000001',
        'DRAFT', '2026-01-20', 'SAR'),
       ('c9c9c9c9-0000-4000-8000-000000000002', $2, 'eeeeeeee-0000-4000-8000-000000000002',
        'DRAFT', '2026-01-20', 'SAR')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount)
     VALUES
       ('cacacaca-0000-4000-8000-000000000001', $1, 'c9c9c9c9-0000-4000-8000-000000000001',
        1, 'b0b0b0b0-0000-4000-8000-000000000001', 'DEBIT', 50),
       ('cacacaca-0000-4000-8000-000000000002', $2, 'c9c9c9c9-0000-4000-8000-000000000002',
        1, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 50)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO journal_templates (id, tenant_id, created_by, name, lines)
     VALUES
       ('cbcbcbcb-0000-4000-8000-000000000001', $1, 'eeeeeeee-0000-4000-8000-000000000001',
        'ISO template', '[{"direction": "DEBIT"}]'::jsonb),
       ('cbcbcbcb-0000-4000-8000-000000000002', $2, 'eeeeeeee-0000-4000-8000-000000000002',
        'ISO template', '[{"direction": "DEBIT"}]'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, fiscal_period_id,
                                  currency_code, source_type, operation)
     VALUES
       ('cccccccc-0000-4000-8000-000000000001', $1, 'JE-2026-000001', '2026-01-20',
        'c2c2c2c2-0000-4000-8000-000000000001', 'SAR', 'iso_fixture', 'post'),
       ('cccccccc-0000-4000-8000-000000000002', $2, 'JE-2026-000001', '2026-01-20',
        'c2c2c2c2-0000-4000-8000-000000000002', 'SAR', 'iso_fixture', 'post')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id,
                               direction, amount, base_amount, partner_id)
     VALUES
       ('cdcdcdcd-0000-4000-8000-000000000001', $1, 'cccccccc-0000-4000-8000-000000000001',
        1, 'b0b0b0b0-0000-4000-8000-000000000001', 'DEBIT', 50, 50,
        'b5b5b5b5-0000-4000-8000-000000000001'),
       ('cdcdcdcd-1000-4000-8000-000000000001', $1, 'cccccccc-0000-4000-8000-000000000001',
        2, 'b0b0b0b0-0000-4000-8000-000000000001', 'CREDIT', 50, 50, NULL),
       ('cdcdcdcd-0000-4000-8000-000000000002', $2, 'cccccccc-0000-4000-8000-000000000002',
        1, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 50, 50,
        'b5b5b5b5-0000-4000-8000-000000000002'),
       ('cdcdcdcd-1000-4000-8000-000000000002', $2, 'cccccccc-0000-4000-8000-000000000002',
        2, 'b0b0b0b0-0000-4000-8000-000000000002', 'CREDIT', 50, 50, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id,
                                            journal_line_id, entry_date, direction, amount,
                                            base_amount, currency_code, source_type)
     VALUES
       ('cececece-0000-4000-8000-000000000001', $1, 'b5b5b5b5-0000-4000-8000-000000000001',
        'cccccccc-0000-4000-8000-000000000001', 'cdcdcdcd-0000-4000-8000-000000000001',
        '2026-01-20', 'DEBIT', 50, 50, 'SAR', 'iso_fixture'),
       ('cececece-0000-4000-8000-000000000002', $2, 'b5b5b5b5-0000-4000-8000-000000000002',
        'cccccccc-0000-4000-8000-000000000002', 'cdcdcdcd-0000-4000-8000-000000000002',
        '2026-01-20', 'DEBIT', 50, 50, 'SAR', 'iso_fixture')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO reconciliation_runs (id, tenant_id, kind, as_of, status, control_balance, subledger_balance)
     VALUES
       ('cfcfcfcf-0000-4000-8000-000000000001', $1, 'AR', '2026-01-31', 'OK', 50, 50),
       ('cfcfcfcf-0000-4000-8000-000000000002', $2, 'AR', '2026-01-31', 'OK', 50, 50)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-008 fixtures (migration 0012): two GL hosts per tenant (the
  // treasury 1:1 account link requires distinct accounts) + the eleven
  // treasury tables' FK-consistent rows, seeded exactly like onboarding.
  await superuser.query(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES
       ('b0b0b0b0-1000-4000-8000-000000000001', $1, '1001', 'Cash Host A', 'نقدي أ', 'ASSET', false),
       ('b0b0b0b0-1000-4000-8000-000000000002', $2, '1001', 'Cash Host B', 'نقدي ب', 'ASSET', false)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO cash_accounts (id, tenant_id, name, name_ar, type, account_id, currency_code)
     VALUES
       ('d0d0d0d0-0000-4000-8000-000000000001', $1, 'Main Cash A', 'الصندوق أ', 'CASH',
        'b0b0b0b0-0000-4000-8000-000000000001', 'SAR'),
       ('d0d0d0d0-0000-4000-8000-000000000002', $2, 'Main Cash B', 'الصندوق ب', 'CASH',
        'b0b0b0b0-0000-4000-8000-000000000002', 'SAR'),
       ('d1d1d1d1-0000-4000-8000-000000000001', $1, 'Bank A', 'بنك أ', 'BANK',
        'b0b0b0b0-1000-4000-8000-000000000001', 'SAR'),
       ('d1d1d1d1-0000-4000-8000-000000000002', $2, 'Bank B', 'بنك ب', 'BANK',
        'b0b0b0b0-1000-4000-8000-000000000002', 'SAR')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO cash_movements (id, tenant_id, cash_account_id, direction, amount, currency_code,
                                 exchange_rate, base_amount, source_type, source_id, value_date)
     VALUES
       ('d2d2d2d2-0000-4000-8000-000000000001', $1, 'd0d0d0d0-0000-4000-8000-000000000001', 'IN',
        100, 'SAR', 1, 100, 'receipt', 'd3d3d3d3-0000-4000-8000-000000000001', '2027-01-05'),
       ('d2d2d2d2-0000-4000-8000-000000000002', $2, 'd0d0d0d0-0000-4000-8000-000000000002', 'IN',
        100, 'SAR', 1, 100, 'receipt', 'd3d3d3d3-0000-4000-8000-000000000002', '2027-01-05')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO receipts (id, tenant_id, status, cash_account_id, partner_id, method, currency_code,
                           amount, value_date, allocated_amount)
     VALUES
       ('d3d3d3d3-0000-4000-8000-000000000001', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'CASH', 'SAR', 100, '2027-01-05', 0),
       ('d3d3d3d3-0000-4000-8000-000000000002', $2, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 100, '2027-01-05', 0)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO payments (id, tenant_id, status, cash_account_id, partner_id, method, currency_code,
                           amount, value_date, allocated_amount)
     VALUES
       ('d4d4d4d4-0000-4000-8000-000000000001', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'CASH', 'SAR', 50, '2027-01-06', 0),
       ('d4d4d4d4-0000-4000-8000-000000000002', $2, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 50, '2027-01-06', 0)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO treasury_allocations (id, tenant_id, receipt_id, open_item_id, amount)
     VALUES
       ('d5d5d5d5-0000-4000-8000-000000000001', $1, 'd3d3d3d3-0000-4000-8000-000000000001',
        'cececece-0000-4000-8000-000000000001', 40),
       ('d5d5d5d5-0000-4000-8000-000000000002', $2, 'd3d3d3d3-0000-4000-8000-000000000002',
        'cececece-0000-4000-8000-000000000002', 40)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO expense_categories (id, tenant_id, code, name, name_ar, account_id)
     VALUES
       ('d6d6d6d6-0000-4000-8000-000000000001', $1, 'RENT-A', 'Rent A', 'إيجار أ',
        'b0b0b0b0-0000-4000-8000-000000000001'),
       ('d6d6d6d6-0000-4000-8000-000000000002', $2, 'RENT-B', 'Rent B', 'إيجار ب',
        'b0b0b0b0-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO expenses (id, tenant_id, status, category_id, cash_account_id, payee_name,
                           currency_code, amount, value_date)
     VALUES
       ('d7d7d7d7-0000-4000-8000-000000000001', $1, 'DRAFT', 'd6d6d6d6-0000-4000-8000-000000000001',
        'd0d0d0d0-0000-4000-8000-000000000001', 'Landlord A', 'SAR', 25, '2027-01-07'),
       ('d7d7d7d7-0000-4000-8000-000000000002', $2, 'DRAFT', 'd6d6d6d6-0000-4000-8000-000000000002',
        'd0d0d0d0-0000-4000-8000-000000000002', 'Landlord B', 'SAR', 25, '2027-01-07')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO cash_transfers (id, tenant_id, status, from_account_id, to_account_id, currency_code,
                                 amount, fee_amount, value_date)
     VALUES
       ('d8d8d8d8-0000-4000-8000-000000000001', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000001',
        'd1d1d1d1-0000-4000-8000-000000000001', 'SAR', 80, 2, '2027-01-08'),
       ('d8d8d8d8-0000-4000-8000-000000000002', $2, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
        'd1d1d1d1-0000-4000-8000-000000000002', 'SAR', 80, 2, '2027-01-08')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO cashier_shifts (id, tenant_id, status, cash_account_id, currency_code, opening_amount, closed_at)
     VALUES
       ('d9d9d9d9-0000-4000-8000-000000000001', $1, 'CLOSED', 'd0d0d0d0-0000-4000-8000-000000000001',
        'SAR', 50, now()),
       ('d9d9d9d9-0000-4000-8000-000000000002', $2, 'CLOSED', 'd0d0d0d0-0000-4000-8000-000000000002',
        'SAR', 50, now())
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO bank_statements (id, tenant_id, status, cash_account_id, period_start, period_end,
                                  file_name, file_hash, adapter_id, line_count)
     VALUES
       ('dadadada-0000-4000-8000-000000000001', $1, 'IMPORTED', 'd1d1d1d1-0000-4000-8000-000000000001',
        '2027-01-01', '2027-01-31', 'iso-a.csv', 'a' || repeat('0', 63), 'generic-csv', 1),
       ('dadadada-0000-4000-8000-000000000002', $2, 'IMPORTED', 'd1d1d1d1-0000-4000-8000-000000000002',
        '2027-01-01', '2027-01-31', 'iso-b.csv', 'b' || repeat('0', 63), 'generic-csv', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO bank_statement_lines (id, tenant_id, bank_statement_id, line_no, line_date, amount)
     VALUES
       ('dbdbdbdb-0000-4000-8000-000000000001', $1, 'dadadada-0000-4000-8000-000000000001',
        1, '2027-01-10', 100),
       ('dbdbdbdb-0000-4000-8000-000000000002', $2, 'dadadada-0000-4000-8000-000000000002',
        1, '2027-01-10', 100)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-009 tax cluster (migration 0013): one row per registered table
  // per tenant, FK-consistent, idempotent. The summary references the
  // tenant's own tax_codes row (composite FK) and the vat_return carries
  // the neutral DRAFT shape (summary/cross_check '{}').
  await superuser.query(
    `INSERT INTO tax_codes (id, tenant_id, code, name, country_code, default_treatment)
     VALUES
       ('e0e0e0e0-0000-4000-8000-000000000001', $1, 'ATK-TAX', 'Attack Tax A', 'SA', 'STANDARD_RATED'),
       ('e0e0e0e0-0000-4000-8000-000000000002', $2, 'ATK-TAX', 'Attack Tax B', 'SA', 'STANDARD_RATED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO tax_registrations (id, tenant_id, country_code, status, registration_number, effective_from)
     VALUES
       ('e1e1e1e1-0000-4000-8000-000000000001', $1, 'SA', 'REGISTERED', '300000000000003', '2026-01-01'),
       ('e1e1e1e1-0000-4000-8000-000000000002', $2, 'SA', 'REGISTERED', '300000000000004', '2026-01-01')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO tax_pack_bindings (id, tenant_id, country_code, pack_version)
     VALUES
       ('e2e2e2e2-0000-4000-8000-000000000001', $1, 'SA', '1.0.0-baseline'),
       ('e2e2e2e2-0000-4000-8000-000000000002', $2, 'SA', '1.0.0-baseline')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO tax_document_summaries (id, tenant_id, source_type, source_id, document_date,
        country_code, direction, treatment, rate, taxable_base, tax_amount, snapshot, tax_code_id)
     VALUES
       ('e3e3e3e3-0000-4000-8000-000000000001', $1, 'iso_fixture', $1, '2027-01-10', 'SA',
        'OUTPUT', 'STANDARD_RATED', 15.0000, 100, 15, '{"treatment":"STANDARD_RATED"}'::jsonb,
        'e0e0e0e0-0000-4000-8000-000000000001'),
       ('e3e3e3e3-0000-4000-8000-000000000002', $2, 'iso_fixture', $2, '2027-01-10', 'SA',
        'OUTPUT', 'STANDARD_RATED', 15.0000, 100, 15, '{"treatment":"STANDARD_RATED"}'::jsonb,
        'e0e0e0e0-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO vat_returns (id, tenant_id, country_code, period_start, period_end, summary, cross_check)
     VALUES
       ('e4e4e4e4-0000-4000-8000-000000000001', $1, 'SA', '2027-01-01', '2027-01-31', '{}'::jsonb, '{}'::jsonb),
       ('e4e4e4e4-0000-4000-8000-000000000002', $2, 'SA', '2027-01-01', '2027-01-31', '{}'::jsonb, '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO e_invoicing_submissions (id, tenant_id, country_code, adapter_id, source_type, source_id, status)
     VALUES
       ('e5e5e5e5-0000-4000-8000-000000000001', $1, 'SA', 'fake', 'iso_fixture', $1, 'PENDING'),
       ('e5e5e5e5-0000-4000-8000-000000000002', $2, 'SA', 'fake', 'iso_fixture', $2, 'PENDING')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-010 inventory cluster (migrations 0014/0015): two warehouses per
  // tenant (transfers require from ≠ to) + one FK-consistent row per
  // registered table, idempotent. The stock_move references the tenant's
  // own item + warehouse (composite FKs); its layer rides that move; the
  // transfer stays DRAFT (no dispatch shape needed for isolation math).
  await superuser.query(
    `INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
     VALUES
       ('f0f0f0f0-1000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001', 'WH1', 'Main WH A'),
       ('f0f0f0f0-1000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002', 'WH1', 'Main WH B'),
       ('f0f0f0f0-2000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001', 'WH2', 'Second WH A'),
       ('f0f0f0f0-2000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002', 'WH2', 'Second WH B')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO item_warehouse_settings (id, tenant_id, item_id, warehouse_id, reorder_level, min_qty)
     VALUES
       ('f1f1f1f1-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', 5, 2),
       ('f1f1f1f1-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', 5, 2)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date)
     VALUES
       ('f2f2f2f2-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001', 'B-001', '2027-06-30'),
       ('f2f2f2f2-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002', 'B-001', '2027-06-30')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO item_serials (id, tenant_id, item_id, serial_no, status)
     VALUES
       ('f3f3f3f3-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001', 'SN-001', 'in_stock'),
       ('f3f3f3f3-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002', 'SN-001', 'in_stock')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty,
                              unit_cost, value_amount, source_type, source_id, moved_at)
     VALUES
       ('f4f4f4f4-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', 'IN', 'receipt', 10, 2.5, 25,
        'manual_receipt', 'f4f4f4f4-0000-4000-8000-000000000001', '2027-01-05'),
       ('f4f4f4f4-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', 'IN', 'receipt', 10, 2.5, 25,
        'manual_receipt', 'f4f4f4f4-0000-4000-8000-000000000002', '2027-01-05')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_layers (id, tenant_id, item_id, warehouse_id, remaining_qty, unit_cost,
                               source_move_id, received_at)
     VALUES
       ('f5f5f5f5-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', 10, 2.5,
        'f4f4f4f4-0000-4000-8000-000000000001', '2027-01-05'),
       ('f5f5f5f5-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', 10, 2.5,
        'f4f4f4f4-0000-4000-8000-000000000002', '2027-01-05')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
     VALUES
       ('f6f6f6f6-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', 10, 2.5),
       ('f6f6f6f6-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', 10, 2.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_transfers (id, tenant_id, from_warehouse_id, to_warehouse_id, status)
     VALUES
       ('f7f7f7f7-0000-4000-8000-000000000001', $1, 'f0f0f0f0-1000-4000-8000-000000000001',
        'f0f0f0f0-2000-4000-8000-000000000001', 'DRAFT'),
       ('f7f7f7f7-0000-4000-8000-000000000002', $2, 'f0f0f0f0-1000-4000-8000-000000000002',
        'f0f0f0f0-2000-4000-8000-000000000002', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_transfer_lines (id, tenant_id, transfer_id, line_no, item_id, qty)
     VALUES
       ('f8f8f8f8-0000-4000-8000-000000000001', $1, 'f7f7f7f7-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', 4),
       ('f8f8f8f8-0000-4000-8000-000000000002', $2, 'f7f7f7f7-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', 4)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, item_id, reason, delta_qty)
     VALUES
       ('f9f9f9f9-0000-4000-8000-000000000001', $1, 'f0f0f0f0-1000-4000-8000-000000000001',
        'babababa-0000-4000-8000-000000000001', 'DAMAGE', -1),
       ('f9f9f9f9-0000-4000-8000-000000000002', $2, 'f0f0f0f0-1000-4000-8000-000000000002',
        'babababa-0000-4000-8000-000000000002', 'DAMAGE', -1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_reservations (id, tenant_id, item_id, warehouse_id, qty, holder_type)
     VALUES
       ('fafafafa-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', 2, 'MANUAL'),
       ('fafafafa-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', 2, 'MANUAL')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_counts (id, tenant_id, warehouse_id, status, snapshot_at)
     VALUES
       ('fbfbfbfb-0000-4000-8000-000000000001', $1, 'f0f0f0f0-1000-4000-8000-000000000001',
        'DRAFT', '2027-01-10T09:00:00Z'),
       ('fbfbfbfb-0000-4000-8000-000000000002', $2, 'f0f0f0f0-1000-4000-8000-000000000002',
        'DRAFT', '2027-01-10T09:00:00Z')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO stock_count_lines (id, tenant_id, stock_count_id, line_no, item_id, system_qty)
     VALUES
       ('fcfcfcfc-0000-4000-8000-000000000001', $1, 'fbfbfbfb-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', 10),
       ('fcfcfcfc-0000-4000-8000-000000000002', $2, 'fbfbfbfb-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', 10)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-011 purchasing cluster (migrations 0016/0017): one DRAFT
  // document chain per tenant — PR → PO → GRN → supplier invoice → debit
  // note (referencing the invoice) + landed cost on the GRN + a POSTED
  // re-allocation document on the tenant's fixture payment. All FKs stay
  // within the tenant's own fixture rows (composite tenant FKs).
  await superuser.query(
    `INSERT INTO purchase_requests (id, tenant_id, branch_id, needed_by, status)
     VALUES
       ('5a5a5a5a-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001', '2027-03-01', 'DRAFT'),
       ('5a5a5a5a-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002', '2027-03-01', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO purchase_request_lines (id, tenant_id, request_id, line_no, item_id, qty)
     VALUES
       ('5b5b5b5b-0000-4000-8000-000000000001', $1, '5a5a5a5a-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', 5),
       ('5b5b5b5b-0000-4000-8000-000000000002', $2, '5a5a5a5a-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', 5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, order_date, currency_code, status)
     VALUES
       ('5c5c5c5c-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', '2027-02-01', 'SAR', 'DRAFT'),
       ('5c5c5c5c-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', '2027-02-01', 'SAR', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO purchase_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES
       ('5d5d5d5d-0000-4000-8000-000000000001', $1, '5c5c5c5c-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', 5, 2.5, 12.5),
       ('5d5d5d5d-0000-4000-8000-000000000002', $2, '5c5c5c5c-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO goods_receipts (id, tenant_id, branch_id, supplier_id, po_id, warehouse_id, receipt_date, status, total_value)
     VALUES
       ('5e5e5e5e-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', '5c5c5c5c-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', '2027-02-05', 'DRAFT', 12.5),
       ('5e5e5e5e-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', '5c5c5c5c-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', '2027-02-05', 'DRAFT', 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO goods_receipt_lines (id, tenant_id, receipt_id, line_no, po_line_id, item_id, qty, unit_cost, value_amount)
     VALUES
       ('5f5f5f5f-0000-4000-8000-000000000001', $1, '5e5e5e5e-0000-4000-8000-000000000001', 1,
        '5d5d5d5d-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001', 5, 2.5, 12.5),
       ('5f5f5f5f-0000-4000-8000-000000000002', $2, '5e5e5e5e-0000-4000-8000-000000000002', 1,
        '5d5d5d5d-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO supplier_invoices (id, tenant_id, branch_id, supplier_id, invoice_no, invoice_date, due_date, currency_code, status, total_net, total_tax, total_gross)
     VALUES
       ('60606060-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'ISO-001', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT', 12.5, 0, 12.5),
       ('60606060-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'ISO-001', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT', 12.5, 0, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO supplier_invoice_lines (id, tenant_id, invoice_id, line_no, grn_line_id, item_id, qty, unit_price, net_amount)
     VALUES
       ('61616161-0000-4000-8000-000000000001', $1, '60606060-0000-4000-8000-000000000001', 1,
        '5f5f5f5f-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001', 5, 2.5, 12.5),
       ('61616161-0000-4000-8000-000000000002', $2, '60606060-0000-4000-8000-000000000002', 1,
        '5f5f5f5f-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO debit_notes (id, tenant_id, branch_id, supplier_id, ref_invoice_id, note_date, currency_code, status, total_net, total_tax, total_gross)
     VALUES
       ('62626262-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', '60606060-0000-4000-8000-000000000001', '2027-02-15', 'SAR', 'DRAFT', 1, 0, 1),
       ('62626262-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', '60606060-0000-4000-8000-000000000002', '2027-02-15', 'SAR', 'DRAFT', 1, 0, 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO debit_note_lines (id, tenant_id, note_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES
       ('63636363-0000-4000-8000-000000000001', $1, '62626262-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', 1, 1, 1),
       ('63636363-0000-4000-8000-000000000002', $2, '62626262-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', 1, 1, 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO landed_costs (id, tenant_id, grn_id, cost_type, amount, allocation_method, charge_account_id, status)
     VALUES
       ('64646464-0000-4000-8000-000000000001', $1, '5e5e5e5e-0000-4000-8000-000000000001',
        'freight', 2, 'VALUE', 'b0b0b0b0-0000-4000-8000-000000000001', 'DRAFT'),
       ('64646464-0000-4000-8000-000000000002', $2, '5e5e5e5e-0000-4000-8000-000000000002',
        'freight', 2, 'VALUE', 'b0b0b0b0-0000-4000-8000-000000000002', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO landed_cost_allocations (id, tenant_id, landed_cost_id, grn_line_id, item_id, warehouse_id, qty_at_allocation, remaining_qty, allocated_amount)
     VALUES
       ('65656565-0000-4000-8000-000000000001', $1, '64646464-0000-4000-8000-000000000001',
        '5f5f5f5f-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', 5, 5, 2),
       ('65656565-0000-4000-8000-000000000002', $2, '64646464-0000-4000-8000-000000000002',
        '5f5f5f5f-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', 5, 5, 2)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO purchase_reallocations (id, tenant_id, doc_no, payment_id, supplier_id, reason, total_amount)
     VALUES
       ('66666666-0000-4000-8000-000000000001', $1, 'RAL-ISO-1', 'd4d4d4d4-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'iso fixture re-allocation', 1),
       ('66666666-0000-4000-8000-000000000002', $2, 'RAL-ISO-1', 'd4d4d4d4-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'iso fixture re-allocation', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO purchase_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
     VALUES
       ('67676767-0000-4000-8000-000000000001', $1, '66666666-0000-4000-8000-000000000001', 1,
        'cececece-0000-4000-8000-000000000001', 1),
       ('67676767-0000-4000-8000-000000000002', $2, '66666666-0000-4000-8000-000000000002', 1,
        'cececece-0000-4000-8000-000000000002', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-012 sales cluster (migrations 0018/0019): one FK-consistent
  // DRAFT row per registered table per tenant (the B row doubles as the
  // A4/A7 foreign probe target). Re-allocations are POSTED-at-create
  // documents (the INSERT-only audit trail).
  await superuser.query(
    `INSERT INTO sales_reps (id, tenant_id, code, name, status)
     VALUES
       ('70707070-0000-4000-8000-000000000001', $1, 'REP-ISO', 'Iso Rep A', 'ACTIVE'),
       ('70707070-0000-4000-8000-000000000002', $2, 'REP-ISO', 'Iso Rep B', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO quotations (id, tenant_id, branch_id, customer_id, sales_rep_id, quote_date,
                            valid_until, currency_code, status, total_net, total_tax, total_gross)
     VALUES
       ('71717171-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', '70707070-0000-4000-8000-000000000001',
        '2027-02-01', '2027-03-03', 'SAR', 'DRAFT', 100, 15, 115),
       ('71717171-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', '70707070-0000-4000-8000-000000000002',
        '2027-02-01', '2027-03-03', 'SAR', 'DRAFT', 100, 15, 115)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO quotation_lines (id, tenant_id, quotation_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES
       ('72727272-0000-4000-8000-000000000001', $1, '71717171-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', 5, 2.5, 12.5),
       ('72727272-0000-4000-8000-000000000002', $2, '71717171-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO sales_orders (id, tenant_id, branch_id, customer_id, warehouse_id, quotation_id,
                              order_date, currency_code, status, total_net, total_tax, total_gross)
     VALUES
       ('73737373-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'f0f0f0f0-1000-4000-8000-000000000001',
        '71717171-0000-4000-8000-000000000001', '2027-02-02', 'SAR', 'DRAFT', 100, 15, 115),
       ('73737373-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
        '71717171-0000-4000-8000-000000000002', '2027-02-02', 'SAR', 'DRAFT', 100, 15, 115)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO sales_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES
       ('74747474-0000-4000-8000-000000000001', $1, '73737373-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', 5, 2.5, 12.5),
       ('74747474-0000-4000-8000-000000000002', $2, '73737373-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO delivery_notes (id, tenant_id, branch_id, customer_id, order_id, warehouse_id,
                                 delivery_date, currency_code, status, total_net, total_tax, total_gross, cogs_value)
     VALUES
       ('75757575-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', '73737373-0000-4000-8000-000000000001',
        'f0f0f0f0-1000-4000-8000-000000000001', '2027-02-05', 'SAR', 'DRAFT', 12.5, 0, 12.5, 0),
       ('75757575-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', '73737373-0000-4000-8000-000000000002',
        'f0f0f0f0-1000-4000-8000-000000000002', '2027-02-05', 'SAR', 'DRAFT', 12.5, 0, 12.5, 0)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO delivery_note_lines (id, tenant_id, delivery_id, line_no, order_line_id, item_id, qty, unit_price, net_amount)
     VALUES
       ('76767676-0000-4000-8000-000000000001', $1, '75757575-0000-4000-8000-000000000001', 1,
        '74747474-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001', 5, 2.5, 12.5),
       ('76767676-0000-4000-8000-000000000002', $2, '75757575-0000-4000-8000-000000000002', 1,
        '74747474-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_date, due_date,
                                 currency_code, status, total_net, total_tax, total_gross)
     VALUES
       ('77777777-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'CREDIT', '2027-02-10', '2027-03-12',
        'SAR', 'DRAFT', 12.5, 0, 12.5),
       ('77777777-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'CREDIT', '2027-02-10', '2027-03-12',
        'SAR', 'DRAFT', 12.5, 0, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, delivery_line_id, qty, unit_price, net_amount)
     VALUES
       ('78787878-0000-4000-8000-000000000001', $1, '77777777-0000-4000-8000-000000000001', 1,
        'babababa-0000-4000-8000-000000000001', '76767676-0000-4000-8000-000000000001', 5, 2.5, 12.5),
       ('78787878-0000-4000-8000-000000000002', $2, '77777777-0000-4000-8000-000000000002', 1,
        'babababa-0000-4000-8000-000000000002', '76767676-0000-4000-8000-000000000002', 5, 2.5, 12.5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO credit_notes (id, tenant_id, branch_id, customer_id, invoice_id, note_date,
                               currency_code, status, total_net, total_tax, total_gross, reentry_value)
     VALUES
       ('79797979-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001',
        '2027-02-15', 'SAR', 'DRAFT', 1, 0, 1, 0),
       ('79797979-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', '77777777-0000-4000-8000-000000000002',
        '2027-02-15', 'SAR', 'DRAFT', 1, 0, 1, 0)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO credit_note_lines (id, tenant_id, note_id, line_no, invoice_line_id, item_id, qty, unit_price, net_amount, return_to_stock)
     VALUES
       ('7a7a7a7a-0000-4000-8000-000000000001', $1, '79797979-0000-4000-8000-000000000001', 1,
        '78787878-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001', 1, 1, 1, false),
       ('7a7a7a7a-0000-4000-8000-000000000002', $2, '79797979-0000-4000-8000-000000000002', 1,
        '78787878-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 1, 1, 1, false)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO sales_reallocations (id, tenant_id, doc_no, receipt_id, customer_id, reason, total_amount)
     VALUES
       ('7b7b7b7b-0000-4000-8000-000000000001', $1, 'SRAL-ISO-1', 'd3d3d3d3-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'iso fixture sales re-allocation', 1),
       ('7b7b7b7b-0000-4000-8000-000000000002', $2, 'SRAL-ISO-1', 'd3d3d3d3-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'iso fixture sales re-allocation', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO sales_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
     VALUES
       ('7c7c7c7c-0000-4000-8000-000000000001', $1, '7b7b7b7b-0000-4000-8000-000000000001', 1,
        'cececece-0000-4000-8000-000000000001', 1),
       ('7c7c7c7c-0000-4000-8000-000000000002', $2, '7b7b7b7b-0000-4000-8000-000000000002', 1,
        'cececece-0000-4000-8000-000000000002', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-013 reporting cluster (migration 0020): one orchestration row
  // (a QUEUED trial-balance run) + one registry row (the a4-report
  // template) per tenant — the B rows double as the A4/A7 foreign probes.
  await superuser.query(
    `INSERT INTO report_runs (id, tenant_id, report_key, contract_version, params,
                              params_hash, execution_class, status)
     VALUES
       ('7d7d7d7d-0000-4000-8000-000000000001', $1, 'financial.trial-balance', 1,
        '{"dateFrom": "2026-01-01", "dateTo": "2026-01-31", "locale": "en"}'::jsonb,
        'iso-fixture-a', 'inline', 'QUEUED'),
       ('7d7d7d7d-0000-4000-8000-000000000002', $2, 'financial.trial-balance', 1,
        '{"dateFrom": "2026-01-01", "dateTo": "2026-01-31", "locale": "en"}'::jsonb,
        'iso-fixture-b', 'inline', 'QUEUED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO print_templates (id, tenant_id, key, version, locale_variants)
     VALUES
       ('7e7e7e7e-0000-4000-8000-000000000001', $1, 'a4-report', 1, '{"ar": 1, "en": 1}'::jsonb),
       ('7e7e7e7e-0000-4000-8000-000000000002', $2, 'a4-report', 1, '{"ar": 1, "en": 1}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-014 fixtures (migration 0021): one row per registered table per
  // tenant, FK-consistent (invoices hang off the adadadad subscriptions),
  // idempotent.
  await superuser.query(
    `INSERT INTO subscription_invoices (
       id, tenant_id, subscription_id, number, plan_key, period_start, period_end,
       amount, currency_code, status, source, due_date, placeholder_price)
     VALUES
       ('1a1a1a1a-0000-4000-8000-000000000001', $1, 'adadadad-0000-4000-8000-000000000001',
        'BI-2026-0001', 'business', '2026-01-01', '2026-01-31', '0.0000', 'SAR', 'OPEN',
        'checkout', '2026-01-08', true),
       ('1a1a1a1a-0000-4000-8000-000000000002', $2, 'adadadad-0000-4000-8000-000000000002',
        'BI-2026-0002', 'business', '2026-01-01', '2026-01-31', '0.0000', 'SAR', 'OPEN',
        'checkout', '2026-01-08', true)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO billing_events (id, tenant_id, type, payload, idempotency_key)
     VALUES
       ('1b1b1b1b-0000-4000-8000-000000000001', $1, 'trial.started', '{}'::jsonb, 'iso-a-1'),
       ('1b1b1b1b-0000-4000-8000-000000000002', $2, 'trial.started', '{}'::jsonb, 'iso-b-1')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO usage_counters (id, tenant_id, counter_key, period, value)
     VALUES
       ('1c1c1c1c-0000-4000-8000-000000000001', $1, 'documents_per_month', '2026-01', 3),
       ('1c1c1c1c-0000-4000-8000-000000000002', $2, 'documents_per_month', '2026-01', 3)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO notifications (id, tenant_id, user_id, category, severity, title, body)
     VALUES
       ('1d1d1d1d-0000-4000-8000-000000000001', $1, 'eeeeeeee-0000-4000-8000-000000000001',
        'subscription', 'info', '{"ar":"أ","en":"A"}'::jsonb, '{"ar":"ب","en":"B"}'::jsonb),
       ('1d1d1d1d-0000-4000-8000-000000000002', $2, 'eeeeeeee-0000-4000-8000-000000000002',
        'subscription', 'info', '{"ar":"أ","en":"A"}'::jsonb, '{"ar":"ب","en":"B"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO notification_prefs (id, tenant_id, user_id, category, in_app, email)
     VALUES
       ('1e1e1e1e-0000-4000-8000-000000000001', $1, 'eeeeeeee-0000-4000-8000-000000000001',
        'limits', true, true),
       ('1e1e1e1e-0000-4000-8000-000000000002', $2, 'eeeeeeee-0000-4000-8000-000000000002',
        'limits', true, true)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-015 fixtures (migration 0022): one applied-template state row per
  // tenant; one COMPOSITE item per tenant (the pair partner is the existing
  // babababa stock fixture) + the item_components definition row hanging
  // off it. FK-consistent, idempotent.
  await superuser.query(
    `INSERT INTO tenant_industry_config (
       id, tenant_id, template_key, applied_version, applied_manifest_hash)
     VALUES
       ('21212121-0000-4000-8000-000000000001', $1, 'industry.retail', '1.0.0', 'iso-fixture-a'),
       ('21212121-0000-4000-8000-000000000002', $2, 'industry.retail', '1.0.0', 'iso-fixture-b')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, category_id)
     VALUES
       ('1f1f1f1f-0000-4000-8000-000000000001', $1, 'ISO-COMBO-A', 'Combo A', 'وجبة أ',
        'COMPOSITE', 'b2b2b2b2-0000-4000-8000-000000000001', 'b8b8b8b8-0000-4000-8000-000000000001'),
       ('1f1f1f1f-0000-4000-8000-000000000002', $2, 'ISO-COMBO-B', 'Combo B', 'وجبة ب',
        'COMPOSITE', 'b2b2b2b2-0000-4000-8000-000000000002', 'b8b8b8b8-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO item_components (id, tenant_id, composite_item_id, component_item_id, qty)
     VALUES
       ('20202020-0000-4000-8000-000000000001', $1,
        '1f1f1f1f-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001', 2),
       ('20202020-0000-4000-8000-000000000002', $2,
        '1f1f1f1f-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 2)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-016 fixtures (migration 0024): one terminal per tenant (till =
  // the existing b0b0b0b0 accounts fixture), one floor table, one open
  // check, one kitchen ticket, one change_log row, one cursor. FK-light
  // (cash_account_id is not FK-constrained on pos_terminals), idempotent.
  await superuser.query(
    `INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id, status)
     VALUES
       ('22222222-0000-4000-8000-000000000001', $1, 'ISO-T1', 'Iso Terminal A',
        'abababab-0000-4000-8000-000000000001', 'b0b0b0b0-0000-4000-8000-000000000001', 'ACTIVE'),
       ('22222222-0000-4000-8000-000000000002', $2, 'ISO-T2', 'Iso Terminal B',
        'abababab-0000-4000-8000-000000000002', 'b0b0b0b0-0000-4000-8000-000000000002', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO pos_tables (id, tenant_id, branch_id, zone, label, seats)
     VALUES
       ('23232323-0000-4000-8000-000000000001', $1,
        'abababab-0000-4000-8000-000000000001', 'MAIN', 'T1', 4),
       ('23232323-0000-4000-8000-000000000002', $2,
        'abababab-0000-4000-8000-000000000002', 'MAIN', 'T2', 4)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO pos_checks (id, tenant_id, branch_id, check_no, table_id, order_type, status)
     VALUES
       ('24242424-0000-4000-8000-000000000001', $1,
        'abababab-0000-4000-8000-000000000001', 'ISO-CHK-A',
        '23232323-0000-4000-8000-000000000001', 'DINE_IN', 'OPEN'),
       ('24242424-0000-4000-8000-000000000002', $2,
        'abababab-0000-4000-8000-000000000002', 'ISO-CHK-B',
        '23232323-0000-4000-8000-000000000002', 'DINE_IN', 'OPEN')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO pos_kitchen_tickets (id, tenant_id, check_id, ticket_no)
     VALUES
       ('25252525-0000-4000-8000-000000000001', $1,
        '24242424-0000-4000-8000-000000000001', 'KT-A'),
       ('25252525-0000-4000-8000-000000000002', $2,
        '24242424-0000-4000-8000-000000000002', 'KT-B')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO change_log (tenant_id, entity_type, entity_id, op)
     VALUES
       ($1, 'items', 'babababa-0000-4000-8000-000000000001', 'UPSERT'),
       ($2, 'items', 'babababa-0000-4000-8000-000000000002', 'UPSERT')`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO sync_cursors (id, tenant_id, device_id, entity_type, last_seq)
     VALUES
       ('26262626-0000-4000-8000-000000000001', $1,
        'dddddddd-0000-4000-8000-000000000001', 'items', 1),
       ('26262626-0000-4000-8000-000000000002', $2,
        'dddddddd-0000-4000-8000-000000000002', 'items', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-020 fixtures (migration 0029): the sync cluster — one GC-ledger
  // row + one push-dedupe row per tenant (device_id is a bare uuid, no FK
  // — the same shape the sync_cursors fixtures ride). Idempotent.
  await superuser.query(
    `INSERT INTO tombstones (id, tenant_id, entity_type, entity_id, deleted_at, gc_after)
     VALUES
       ('3c3c3c3c-0000-4000-8000-000000000001', $1, 'items',
        '3c3c3c3c-0000-4000-8000-00000000aa01', now(), now() + interval '90 days'),
       ('3c3c3c3c-0000-4000-8000-000000000002', $2, 'items',
        '3c3c3c3c-0000-4000-8000-00000000aa02', now(), now() + interval '90 days')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
                                entity_type, intent, status, result, processed_at)
     VALUES
       ('3d3d3d3d-0000-4000-8000-000000000001', $1, 'dddddddd-0000-4000-8000-000000000001',
        'iso-inbox-cmd-a', 'iso-inbox-key-a', 'pos_sale', 'create', 'ACCEPTED', '{}'::jsonb, now()),
       ('3d3d3d3d-0000-4000-8000-000000000002', $2, 'dddddddd-0000-4000-8000-000000000002',
        'iso-inbox-cmd-b', 'iso-inbox-key-b', 'pos_sale', 'create', 'ACCEPTED', '{}'::jsonb, now())
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-017 fixtures (migration 0025): the automotive/distribution
  // cluster — one row per registered table per tenant, FK-consistent
  // against the partners/items/warehouses/sales_reps fixtures, idempotent.
  await superuser.query(
    `INSERT INTO vehicles (id, tenant_id, partner_id, make, model, chassis_no, plate_no)
     VALUES
       ('27272727-0000-4000-8000-000000000001', $1, 'b5b5b5b5-0000-4000-8000-000000000001',
        'Toyota', 'Hilux', 'JT800000000011A', 'ISO 1111'),
       ('27272727-0000-4000-8000-000000000002', $2, 'b5b5b5b5-0000-4000-8000-000000000002',
        'Nissan', 'Patrol', 'JT800000000022B', 'ISO 2222')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO job_cards (id, tenant_id, branch_id, card_no, customer_id, vehicle_id,
                            warehouse_id, status, parts_issue_mode)
     VALUES
       ('28282828-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'JC-ISO-A', 'b5b5b5b5-0000-4000-8000-000000000001',
        '27272727-0000-4000-8000-000000000001', 'f0f0f0f0-1000-4000-8000-000000000001',
        'DRAFT', 'reserve'),
       ('28282828-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'JC-ISO-B', 'b5b5b5b5-0000-4000-8000-000000000002',
        '27272727-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
        'DRAFT', 'reserve')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO job_card_lines (id, tenant_id, job_card_id, line_no, line_type, item_id, qty)
     VALUES
       ('29292929-0000-4000-8000-000000000001', $1,
        '28282828-0000-4000-8000-000000000001', 1, 'PARTS',
        'babababa-0000-4000-8000-000000000001', 1),
       ('29292929-0000-4000-8000-000000000002', $2,
        '28282828-0000-4000-8000-000000000002', 1, 'PARTS',
        'babababa-0000-4000-8000-000000000002', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO customer_tiers (id, tenant_id, code, name, price_list_id)
     VALUES
       ('2a2a2a2a-0000-4000-8000-000000000001', $1, 'ISO-TIER-A', 'Tier A',
        'b4b4b4b4-0000-4000-8000-000000000001'),
       ('2a2a2a2a-0000-4000-8000-000000000002', $2, 'ISO-TIER-B', 'Tier B',
        'b4b4b4b4-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO free_goods_rules (id, tenant_id, code, name, buy_item_id, buy_qty,
                                   get_item_id, get_qty, reason_code)
     VALUES
       ('2b2b2b2b-0000-4000-8000-000000000001', $1, 'ISO-FOC-A', 'FOC A',
        'babababa-0000-4000-8000-000000000001', 10,
        'babababa-0000-4000-8000-000000000001', 1, 'ISO-PROMO'),
       ('2b2b2b2b-0000-4000-8000-000000000002', $2, 'ISO-FOC-B', 'FOC B',
        'babababa-0000-4000-8000-000000000002', 10,
        'babababa-0000-4000-8000-000000000002', 1, 'ISO-PROMO')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO routes (id, tenant_id, code, name, sales_rep_id)
     VALUES
       ('2c2c2c2c-0000-4000-8000-000000000001', $1, 'ISO-RT-A', 'Route A',
        '70707070-0000-4000-8000-000000000001'),
       ('2c2c2c2c-0000-4000-8000-000000000002', $2, 'ISO-RT-B', 'Route B',
        '70707070-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO route_customers (id, tenant_id, route_id, customer_id, visit_order)
     VALUES
       ('2d2d2d2d-0000-4000-8000-000000000001', $1,
        '2c2c2c2c-0000-4000-8000-000000000001', 'b5b5b5b5-0000-4000-8000-000000000001', 1),
       ('2d2d2d2d-0000-4000-8000-000000000002', $2,
        '2c2c2c2c-0000-4000-8000-000000000002', 'b5b5b5b5-0000-4000-8000-000000000002', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO route_visits (id, tenant_id, route_id, customer_id, planned_date, status)
     VALUES
       ('2e2e2e2e-0000-4000-8000-000000000001', $1,
        '2c2c2c2c-0000-4000-8000-000000000001', 'b5b5b5b5-0000-4000-8000-000000000001',
        '2026-02-02', 'PLANNED'),
       ('2e2e2e2e-0000-4000-8000-000000000002', $2,
        '2c2c2c2c-0000-4000-8000-000000000002', 'b5b5b5b5-0000-4000-8000-000000000002',
        '2026-02-02', 'PLANNED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO van_stocks (id, tenant_id, warehouse_id, item_id, qty, value)
     VALUES
       ('2f2f2f2f-0000-4000-8000-000000000001', $1,
        'f0f0f0f0-2000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001', 5, 100),
       ('2f2f2f2f-0000-4000-8000-000000000002', $2,
        'f0f0f0f0-2000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 5, 100)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO rep_settlements (id, tenant_id, settlement_no, sales_rep_id,
                                  van_warehouse_id, settlement_date, status)
     VALUES
       ('30303030-0000-4000-8000-000000000001', $1, 'STL-ISO-A',
        '70707070-0000-4000-8000-000000000001', 'f0f0f0f0-2000-4000-8000-000000000001',
        '2026-02-02', 'DRAFT'),
       ('30303030-0000-4000-8000-000000000002', $2, 'STL-ISO-B',
        '70707070-0000-4000-8000-000000000002', 'f0f0f0f0-2000-4000-8000-000000000002',
        '2026-02-02', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO rep_settlement_lines (id, tenant_id, settlement_id, line_no, component, amount)
     VALUES
       ('31313131-0000-4000-8000-000000000001', $1,
        '30303030-0000-4000-8000-000000000001', 1, 'OPENING_CASH', 0),
       ('31313131-0000-4000-8000-000000000002', $2,
        '30303030-0000-4000-8000-000000000002', 1, 'OPENING_CASH', 0)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO commission_runs (id, tenant_id, period_from, period_to, basis, status)
     VALUES
       ('32323232-0000-4000-8000-000000000001', $1, '2026-02-01', '2026-02-28', 'INVOICED', 'DRAFT'),
       ('32323232-0000-4000-8000-000000000002', $2, '2026-02-01', '2026-02-28', 'INVOICED', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO commission_run_lines (id, tenant_id, run_id, sales_rep_id, base_amount,
                                       rate_applied, commission_amount)
     VALUES
       ('33333333-0000-4000-8000-000000000001', $1,
        '32323232-0000-4000-8000-000000000001', '70707070-0000-4000-8000-000000000001',
        1000, 2, 20),
       ('33333333-0000-4000-8000-000000000002', $2,
        '32323232-0000-4000-8000-000000000002', '70707070-0000-4000-8000-000000000002',
        1000, 2, 20)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-018 fixtures (migration 0026): the manufacturing cluster — one
  // row per registered table per tenant, FK-consistent against the
  // items/uoms/branches/warehouses fixtures (boms need items; orders need
  // branches + items + warehouses + boms; consumptions keep batch_id NULL;
  // scraps need orders; inspections use the production-order target with
  // fg_batch_id/grn_id NULL), idempotent.
  await superuser.query(
    `INSERT INTO bills_of_materials (id, tenant_id, item_id, version_no, status,
                                     output_uom_id, yield_pct)
     VALUES
       ('34343434-0000-4000-8000-000000000001', $1, 'babababa-0000-4000-8000-000000000001',
        1, 'ACTIVE', 'b2b2b2b2-0000-4000-8000-000000000001', 80),
       ('34343434-0000-4000-8000-000000000002', $2, 'babababa-0000-4000-8000-000000000002',
        1, 'ACTIVE', 'b2b2b2b2-0000-4000-8000-000000000002', 80)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO bom_lines (id, tenant_id, bom_id, line_no, component_item_id, uom_id,
                            qty_per_output, scrap_pct)
     VALUES
       ('35353535-0000-4000-8000-000000000001', $1,
        '34343434-0000-4000-8000-000000000001', 1, '1f1f1f1f-0000-4000-8000-000000000001',
        'b2b2b2b2-0000-4000-8000-000000000001', 2, 0),
       ('35353535-0000-4000-8000-000000000002', $2,
        '34343434-0000-4000-8000-000000000002', 1, '1f1f1f1f-0000-4000-8000-000000000002',
        'b2b2b2b2-0000-4000-8000-000000000002', 2, 0)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO production_orders (id, tenant_id, branch_id, status, bom_id, item_id, uom_id,
                                    planned_qty, materials_warehouse_id, fg_warehouse_id)
     VALUES
       ('36363636-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'DRAFT', '34343434-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001',
        'b2b2b2b2-0000-4000-8000-000000000001', 10,
        'f0f0f0f0-1000-4000-8000-000000000001', 'f0f0f0f0-2000-4000-8000-000000000001'),
       ('36363636-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'DRAFT', '34343434-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
        'b2b2b2b2-0000-4000-8000-000000000002', 10,
        'f0f0f0f0-1000-4000-8000-000000000002', 'f0f0f0f0-2000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO production_order_lines (id, tenant_id, order_id, line_no, component_item_id,
                                         uom_id, planned_qty)
     VALUES
       ('37373737-0000-4000-8000-000000000001', $1,
        '36363636-0000-4000-8000-000000000001', 1, '1f1f1f1f-0000-4000-8000-000000000001',
        'b2b2b2b2-0000-4000-8000-000000000001', 5),
       ('37373737-0000-4000-8000-000000000002', $2,
        '36363636-0000-4000-8000-000000000002', 1, '1f1f1f1f-0000-4000-8000-000000000002',
        'b2b2b2b2-0000-4000-8000-000000000002', 5)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO production_consumptions (id, tenant_id, order_id, item_id, qty,
                                          unit_cost, value, consumed_at)
     VALUES
       ('38383838-0000-4000-8000-000000000001', $1,
        '36363636-0000-4000-8000-000000000001', 'babababa-0000-4000-8000-000000000001',
        2, 2.5, 5, now()),
       ('38383838-0000-4000-8000-000000000002', $2,
        '36363636-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
        2, 2.5, 5, now())
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO production_scraps (id, tenant_id, order_id, reason_code, qty, value,
                                    scrapped_at)
     VALUES
       ('39393939-0000-4000-8000-000000000001', $1,
        '36363636-0000-4000-8000-000000000001', 'ISO-SCRAP', 1, 2.5, now()),
       ('39393939-0000-4000-8000-000000000002', $2,
        '36363636-0000-4000-8000-000000000002', 'ISO-SCRAP', 1, 2.5, now())
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO inspections (id, tenant_id, target_type, order_id, result, inspected_at)
     VALUES
       ('3a3a3a3a-0000-4000-8000-000000000001', $1, 'production_order',
        '36363636-0000-4000-8000-000000000001', 'PASS', now()),
       ('3a3a3a3a-0000-4000-8000-000000000002', $2, 'production_order',
        '36363636-0000-4000-8000-000000000002', 'PASS', now())
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-019 fixtures (migration 0027): the crm/service-billing cluster —
  // one row per registered table per tenant, FK-consistent against the
  // partners/items/branches/warehouses/receipts/sales_invoices fixtures
  // (projects standalone; leads keep partner NULL at NEW; tasks/activities
  // point at the own lead — polymorphic, no FK; contracts need partners;
  // schedule/advances need contracts + items/receipts; contract_invoices
  // needs contracts + sales_invoices with period_key NULL — the schedule
  // fixture holds the period key; service orders need partners + branches
  // + warehouses; time entries need projects + contracts + items),
  // idempotent.
  await superuser.query(
    `INSERT INTO projects (id, tenant_id, code, name, name_ar, status)
     VALUES
       ('a1a1a1a1-0000-4000-8000-000000000001', $1, 'ISO', 'Project A', 'مشروع أ', 'OPEN'),
       ('a1a1a1a1-0000-4000-8000-000000000002', $2, 'ISO', 'Project B', 'مشروع ب', 'OPEN')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO leads (id, tenant_id, name, source, status)
     VALUES
       ('91919191-0000-4000-8000-000000000001', $1, 'Lead A', 'WEBSITE', 'NEW'),
       ('91919191-0000-4000-8000-000000000002', $2, 'Lead B', 'WEBSITE', 'NEW')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO crm_tasks (id, tenant_id, title, related_type, related_id, status)
     VALUES
       ('92929292-0000-4000-8000-000000000001', $1, 'Task A', 'LEAD',
        '91919191-0000-4000-8000-000000000001', 'OPEN'),
       ('92929292-0000-4000-8000-000000000002', $2, 'Task B', 'LEAD',
        '91919191-0000-4000-8000-000000000002', 'OPEN')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO crm_activities (id, tenant_id, kind, related_type, related_id,
                                 occurred_at, summary)
     VALUES
       ('93939393-0000-4000-8000-000000000001', $1, 'NOTE', 'LEAD',
        '91919191-0000-4000-8000-000000000001', now(), 'Activity A'),
       ('93939393-0000-4000-8000-000000000002', $2, 'NOTE', 'LEAD',
        '91919191-0000-4000-8000-000000000002', now(), 'Activity B')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO service_contracts (id, tenant_id, partner_id, project_id, title, fee_model,
                                    start_date, end_date, monthly_amount, currency_code, status)
     VALUES
       ('94949494-0000-4000-8000-000000000001', $1, 'b5b5b5b5-0000-4000-8000-000000000001',
        'a1a1a1a1-0000-4000-8000-000000000001', 'Contract A', 'RETAINER',
        '2027-01-01', '2027-06-30', 100, 'SAR', 'DRAFT'),
       ('94949494-0000-4000-8000-000000000002', $2, 'b5b5b5b5-0000-4000-8000-000000000002',
        'a1a1a1a1-0000-4000-8000-000000000002', 'Contract B', 'RETAINER',
        '2027-01-01', '2027-06-30', 100, 'SAR', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO contract_billing_schedule (id, tenant_id, contract_id, entry_type, period_key,
                                             period_start, period_end, bill_date, amount,
                                             fee_item_id, status)
     VALUES
       ('95959595-0000-4000-8000-000000000001', $1, '94949494-0000-4000-8000-000000000001',
        'RETAINER_PERIOD', '2027-01', '2027-01-01', '2027-01-31', '2027-01-01', 100,
        'babababa-0000-4000-8000-000000000001', 'PLANNED'),
       ('95959595-0000-4000-8000-000000000002', $2, '94949494-0000-4000-8000-000000000002',
        'RETAINER_PERIOD', '2027-01', '2027-01-01', '2027-01-31', '2027-01-01', 100,
        'babababa-0000-4000-8000-000000000002', 'PLANNED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO contract_invoices (id, tenant_id, contract_id, invoice_id, period_key, status)
     VALUES
       ('96969696-0000-4000-8000-000000000001', $1, '94949494-0000-4000-8000-000000000001',
        '77777777-0000-4000-8000-000000000001', NULL, 'GENERATED'),
       ('96969696-0000-4000-8000-000000000002', $2, '94949494-0000-4000-8000-000000000002',
        '77777777-0000-4000-8000-000000000002', NULL, 'GENERATED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO contract_advances (id, tenant_id, contract_id, receipt_id, amount, status)
     VALUES
       ('97979797-0000-4000-8000-000000000001', $1, '94949494-0000-4000-8000-000000000001',
        'd3d3d3d3-0000-4000-8000-000000000001', 50, 'HELD'),
       ('97979797-0000-4000-8000-000000000002', $2, '94949494-0000-4000-8000-000000000002',
        'd3d3d3d3-0000-4000-8000-000000000002', 50, 'HELD')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO service_orders (id, tenant_id, branch_id, partner_id, warehouse_id, status)
     VALUES
       ('98989898-0000-4000-8000-000000000001', $1, 'abababab-0000-4000-8000-000000000001',
        'b5b5b5b5-0000-4000-8000-000000000001', 'f0f0f0f0-1000-4000-8000-000000000001', 'DRAFT'),
       ('98989898-0000-4000-8000-000000000002', $2, 'abababab-0000-4000-8000-000000000002',
        'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO service_order_lines (id, tenant_id, order_id, line_no, line_type, item_id,
                                      estimated_hours, unit_price, qty, status)
     VALUES
       ('99999999-0000-4000-8000-000000000001', $1, '98989898-0000-4000-8000-000000000001',
        1, 'SERVICE', 'babababa-0000-4000-8000-000000000001', 3, 150, 1, 'PENDING'),
       ('99999999-0000-4000-8000-000000000002', $2, '98989898-0000-4000-8000-000000000002',
        1, 'SERVICE', 'babababa-0000-4000-8000-000000000002', 3, 150, 1, 'PENDING')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO crm_time_entries (id, tenant_id, entry_date, hours, fee_item_id, project_id,
                                   contract_id, unit_rate, narrative, billable, status)
     VALUES
       ('a0a0a0a0-0000-4000-8000-000000000001', $1, '2027-02-03', 2,
        'babababa-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001',
        '94949494-0000-4000-8000-000000000001', 250, 'Drafting', true, 'DRAFT'),
       ('a0a0a0a0-0000-4000-8000-000000000002', $2, '2027-02-03', 2,
        'babababa-0000-4000-8000-000000000002', 'a1a1a1a1-0000-4000-8000-000000000002',
        '94949494-0000-4000-8000-000000000002', 250, 'Drafting', true, 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-023 fixtures (migration 0035): the external-integrations cluster —
  // one row per registered table per tenant, FK-consistent (usage → the
  // tenant's own certificate; parked line → the tenant's own statement),
  // idempotent. secret_path is globally UNIQUE → tenant-templated; the
  // payout provider_ref likewise (po_iso_a/b).
  await superuser.query(
    `INSERT INTO e_invoicing_certificates (id, tenant_id, country_code, adapter_id, label,
        key_version, secret_path, fingerprint, not_before, not_after, status)
     VALUES
       ('a2a2a2a2-0000-4000-8000-000000000001', $1, 'SA', 'fake', 'Iso fixture',
        'k1', 'einvoicing/SA/iso-a', 'fp-iso-a', '2026-01-01', '2027-01-01', 'ACTIVE'),
       ('a2a2a2a2-0000-4000-8000-000000000002', $2, 'SA', 'fake', 'Iso fixture',
        'k1', 'einvoicing/SA/iso-b', 'fp-iso-b', '2026-01-01', '2027-01-01', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO e_invoicing_certificate_usage (id, tenant_id, certificate_id, operation, key_version)
     VALUES
       ('a3a3a3a3-0000-4000-8000-000000000001', $1, 'a2a2a2a2-0000-4000-8000-000000000001',
        'SIGN', 'k1'),
       ('a3a3a3a3-0000-4000-8000-000000000002', $2, 'a2a2a2a2-0000-4000-8000-000000000002',
        'SIGN', 'k1')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO e_invoicing_adapter_settings (id, tenant_id, adapter_id, country_code, enabled)
     VALUES
       ('a4a4a4a4-0000-4000-8000-000000000001', $1, 'fake', 'SA', false),
       ('a4a4a4a4-0000-4000-8000-000000000002', $2, 'fake', 'SA', false)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO bank_statement_parked_lines (id, tenant_id, statement_id, line_index,
        raw_cells, raw_line, parked_reason, status)
     VALUES
       ('a5a5a5a5-0000-4000-8000-000000000001', $1, 'dadadada-0000-4000-8000-000000000001',
        1, '["a","b"]'::jsonb, 'unparseable row', 'iso fixture', 'PARKED'),
       ('a5a5a5a5-0000-4000-8000-000000000002', $2, 'dadadada-0000-4000-8000-000000000002',
        1, '["a","b"]'::jsonb, 'unparseable row', 'iso fixture', 'PARKED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO commerce_channel_orders (id, tenant_id, channel_adapter_id, channel_order_id,
        payload, status)
     VALUES
       ('a6a6a6a6-0000-4000-8000-000000000001', $1, 'fake-shop', 'iso-a', '{}'::jsonb, 'IMPORTED'),
       ('a6a6a6a6-0000-4000-8000-000000000002', $2, 'fake-shop', 'iso-b', '{}'::jsonb, 'IMPORTED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO commerce_channel_imports (id, tenant_id, channel_adapter_id, batch_key, status)
     VALUES
       ('a7a7a7a7-0000-4000-8000-000000000001', $1, 'fake-shop', 'iso-batch', 'COMPLETED'),
       ('a7a7a7a7-0000-4000-8000-000000000002', $2, 'fake-shop', 'iso-batch', 'COMPLETED')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO billing_payouts (id, tenant_id, provider_id, provider_ref, period_start,
        period_end, gross_amount, fee_amount, net_amount, currency_code, status,
        settled_payment_count)
     VALUES
       ('a8a8a8a8-0000-4000-8000-000000000001', $1, 'sandbox', 'po_iso_a', '2027-01-01',
        '2027-01-31', 100, 1, 99, 'SAR', 'PENDING', 0),
       ('a8a8a8a8-0000-4000-8000-000000000002', $2, 'sandbox', 'po_iso_b', '2027-01-01',
        '2027-01-31', 100, 1, 99, 'SAR', 'PENDING', 0)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // -- PHASE-024 (migration 0036): one offboarding flow row per tenant
  // (REQUESTED — the read-only grace state).
  await superuser.query(
    `INSERT INTO tenant_offboarding (id, tenant_id, status, requested_by)
     VALUES
       ('a9a9a9a9-0000-4000-8000-000000000001', $1, 'REQUESTED',
        'eeeeeeee-0000-4000-8000-000000000001'),
       ('a9a9a9a9-0000-4000-8000-000000000002', $2, 'REQUESTED',
        'eeeeeeee-0000-4000-8000-000000000002')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-026 fixtures (migration 0037): the fixed-assets cluster — one
  // FK-consistent row per registered table per tenant (category → the
  // tenant's own branch/period/asset chain; the B rows double as the A4/A7
  // foreign probe targets). All money shapes honor the migration CHECKs
  // (cost ≥ 0, salvage ≤ cost, opening ≤ cost − salvage, period_amount > 0,
  // revaluation basis ≥ 0).
  await superuser.query(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, depreciation_method_default, asset_purpose_key,
        accum_depreciation_purpose_key, expense_purpose_key, active)
     VALUES
       ('fa0a0a0a-0000-4000-8000-000000000001', $1, 'VEH', 'Vehicles', 'مركبات',
        60, 'STRAIGHT_LINE', 'FIXED_ASSET', 'ACCUM_DEPRECIATION', 'DEPRECIATION_EXPENSE', true),
       ('fa0a0a0a-0000-4000-8000-000000000002', $2, 'VEH', 'Vehicles', 'مركبات',
        60, 'STRAIGHT_LINE', 'FIXED_ASSET', 'ACCUM_DEPRECIATION', 'DEPRECIATION_EXPENSE', true)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id,
        acquisition_date, cost, salvage_value, opening_accumulated, useful_life_months,
        depreciation_method, branch_id, status)
     VALUES
       ('fa1a1a1a-0000-4000-8000-000000000001', $1, 'A-ISO-001', 'Isolation truck', 'شاحنة العزل',
        'fa0a0a0a-0000-4000-8000-000000000001', '2026-01-15', 12000, 0, 0, 60,
        'STRAIGHT_LINE', 'abababab-0000-4000-8000-000000000001', 'ACTIVE'),
       ('fa1a1a1a-0000-4000-8000-000000000002', $2, 'A-ISO-001', 'Isolation truck', 'شاحنة العزل',
        'fa0a0a0a-0000-4000-8000-000000000002', '2026-01-15', 12000, 0, 0, 60,
        'STRAIGHT_LINE', 'abababab-0000-4000-8000-000000000002', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO depreciation_runs (id, tenant_id, fiscal_period_id, status,
        asset_count, total_amount)
     VALUES
       ('fa2a2a2a-0000-4000-8000-000000000001', $1,
        'c2c2c2c2-0000-4000-8000-000000000001', 'DRAFT', 1, 200),
       ('fa2a2a2a-0000-4000-8000-000000000002', $2,
        'c2c2c2c2-0000-4000-8000-000000000002', 'DRAFT', 1, 200)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO depreciation_lines (id, tenant_id, run_id, asset_id, line_no,
        period_amount, accumulated_amount)
     VALUES
       ('fa3a3a3a-0000-4000-8000-000000000001', $1,
        'fa2a2a2a-0000-4000-8000-000000000001', 'fa1a1a1a-0000-4000-8000-000000000001',
        1, 200, 200),
       ('fa3a3a3a-0000-4000-8000-000000000002', $2,
        'fa2a2a2a-0000-4000-8000-000000000002', 'fa1a1a1a-0000-4000-8000-000000000002',
        1, 200, 200)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO asset_disposals (id, tenant_id, asset_id, kind, disposal_date,
        proceeds, net_book_value, accumulated_snapshot, gain_loss, status)
     VALUES
       ('fa4a4a4a-0000-4000-8000-000000000001', $1,
        'fa1a1a1a-0000-4000-8000-000000000001', 'SCRAP', '2026-06-30',
        0, 11800, 200, -11800, 'DRAFT'),
       ('fa4a4a4a-0000-4000-8000-000000000002', $2,
        'fa1a1a1a-0000-4000-8000-000000000002', 'SCRAP', '2026-06-30',
        0, 11800, 200, -11800, 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO asset_revaluations (id, tenant_id, asset_id, revaluation_date,
        new_gross_value, new_accumulated, delta, status, reason)
     VALUES
       ('fa5a5a5a-0000-4000-8000-000000000001', $1,
        'fa1a1a1a-0000-4000-8000-000000000001', '2026-06-15',
        13000, 200, 1000, 'DRAFT', 'iso fixture'),
       ('fa5a5a5a-0000-4000-8000-000000000002', $2,
        'fa1a1a1a-0000-4000-8000-000000000002', '2026-06-15',
        13000, 200, 1000, 'DRAFT', 'iso fixture')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-027 (migration 0038) — notes & installments cluster: the 027-marked
  // id block (a027027N notes / b027027N events / c027027N plans / d027027N
  // lines × tenant 1/2). Partner refs use the own-tenant partners fixture
  // (b5b5b5b5) so the composite tenant FKs stay satisfied; note_events points
  // at the own-tenant notes fixture; lines at the own-tenant plans fixture.
  // The plan's late_fee_policy carries the PLACEHOLDER default shape.
  await superuser.query(
    `INSERT INTO notes (id, tenant_id, kind, direction, partner_id, number,
        issuing_bank, amount, currency, exchange_rate, issue_date, maturity_date, status)
     VALUES
       ('a0270271-0000-4000-8000-000000000001', $1, 'CHEQUE', 'RECEIVED',
        'b5b5b5b5-0000-4000-8000-000000000001', 'ISO-CHK-1', 'Attack-free Bank',
        1000, 'SAR', 1, '2026-06-01', '2026-07-01', 'IN_CUSTODY'),
       ('a0270271-0000-4000-8000-000000000002', $2, 'CHEQUE', 'RECEIVED',
        'b5b5b5b5-0000-4000-8000-000000000002', 'ISO-CHK-1', 'Attack-free Bank',
        1000, 'SAR', 1, '2026-06-01', '2026-07-01', 'IN_CUSTODY')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO note_events (id, tenant_id, note_id, event_kind, event_date)
     VALUES
       ('b0270271-0000-4000-8000-000000000001', $1,
        'a0270271-0000-4000-8000-000000000001', 'DEPOSIT', '2026-06-20'),
       ('b0270271-0000-4000-8000-000000000002', $2,
        'a0270271-0000-4000-8000-000000000002', 'DEPOSIT', '2026-06-20')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO installment_plans (id, tenant_id, partner_id, source_type, source_id,
        source_no, total_amount, down_payment, line_count, start_date, frequency,
        late_fee_policy, status)
     VALUES
       ('c0270271-0000-4000-8000-000000000001', $1,
        'b5b5b5b5-0000-4000-8000-000000000001', 'sales_invoice',
        'a0270271-0000-4000-8000-000000000001', 'ISO-INV-1',
        12000, 2000, 10, '2026-07-01', 'MONTHLY',
        '{"rate":"0.0200","cap":"500.0000","grace_days":7,"auto_charge":false,"defaulted_after_lines":3}', NULL),
       ('c0270271-0000-4000-8000-000000000002', $2,
        'b5b5b5b5-0000-4000-8000-000000000002', 'sales_invoice',
        'a0270271-0000-4000-8000-000000000002', 'ISO-INV-1',
        12000, 2000, 10, '2026-07-01', 'MONTHLY',
        '{"rate":"0.0200","cap":"500.0000","grace_days":7,"auto_charge":false,"defaulted_after_lines":3}', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO installment_lines (id, tenant_id, plan_id, seq, due_date, amount, status)
     VALUES
       ('d0270271-0000-4000-8000-000000000001', $1,
        'c0270271-0000-4000-8000-000000000001', 1, '2026-08-01', 1000, 'PENDING'),
       ('d0270271-0000-4000-8000-000000000002', $2,
        'c0270271-0000-4000-8000-000000000002', 1, '2026-08-01', 1000, 'PENDING')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-028 (migration 0039) — budgeting cluster: the 028-marked id block
  // (e028028N budgets / f028028N lines × tenant 1/2). fiscal_year refs use
  // the own-tenant fiscal_years fixture (c1c1c1c1), period refs the own-
  // tenant fiscal_periods fixture (c2c2c2c2), account refs the own-tenant
  // accounts fixture (b0b0b0b0) so the composite tenant FKs stay satisfied;
  // lines point at the own-tenant budgets fixture.
  await superuser.query(
    `INSERT INTO budgets (id, tenant_id, code, fiscal_year_id, scope, name, name_ar,
        revision_no, status)
     VALUES
       ('e0280281-0000-4000-8000-000000000001', $1, 'BUD-2026-1',
        'c1c1c1c1-0000-4000-8000-000000000001', 'ACCOUNTS', 'FY2026 budget',
        'موازنة 2026', 1, 'DRAFT'),
       ('e0280281-0000-4000-8000-000000000002', $2, 'BUD-2026-1',
        'c1c1c1c1-0000-4000-8000-000000000002', 'ACCOUNTS', 'FY2026 budget',
        'موازنة 2026', 1, 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO budget_lines (id, tenant_id, budget_id, fiscal_period_id, account_id, amount)
     VALUES
       ('f0280281-0000-4000-8000-000000000001', $1,
        'e0280281-0000-4000-8000-000000000001',
        'c2c2c2c2-0000-4000-8000-000000000001',
        'b0b0b0b0-0000-4000-8000-000000000001', 1000),
       ('f0280281-0000-4000-8000-000000000002', $2,
        'e0280281-0000-4000-8000-000000000002',
        'c2c2c2c2-0000-4000-8000-000000000002',
        'b0b0b0b0-0000-4000-8000-000000000002', 1000)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-027 (migration 0038) — notes & installments cluster: the 027-marked
  // id block (a027027N notes / b027027N events / c027027N plans / d027027N
  // lines × tenant 1/2). partner refs use the own-tenant partners fixture
  // (b5b5b5b5) so the composite tenant FKs stay satisfied; note_events points
  // at the own-tenant notes fixture; lines at the own-tenant plans fixture.
  await superuser.query(
    `INSERT INTO notes (id, tenant_id, kind, direction, partner_id, number,
        issuing_bank, amount, currency, exchange_rate, issue_date, maturity_date, status)
     VALUES
       ('a0270271-0000-4000-8000-000000000001', $1, 'CHEQUE', 'RECEIVED',
        'b5b5b5b5-0000-4000-8000-000000000001', 'ISO-CHK-1', 'Attack-free Bank',
        1000, 'SAR', 1, '2026-06-01', '2026-07-01', 'IN_CUSTODY'),
       ('a0270271-0000-4000-8000-000000000002', $2, 'CHEQUE', 'RECEIVED',
        'b5b5b5b5-0000-4000-8000-000000000002', 'ISO-CHK-1', 'Attack-free Bank',
        1000, 'SAR', 1, '2026-06-01', '2026-07-01', 'IN_CUSTODY')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO note_events (id, tenant_id, note_id, event_kind, event_date)
     VALUES
       ('b0270271-0000-4000-8000-000000000001', $1,
        'a0270271-0000-4000-8000-000000000001', 'DEPOSIT', '2026-06-20'),
       ('b0270271-0000-4000-8000-000000000002', $2,
        'a0270271-0000-4000-8000-000000000002', 'DEPOSIT', '2026-06-20')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO installment_plans (id, tenant_id, partner_id, source_type, source_id,
        source_no, total_amount, down_payment, line_count, start_date, frequency,
        late_fee_policy, status)
     VALUES
       ('c0270271-0000-4000-8000-000000000001', $1,
        'b5b5b5b5-0000-4000-8000-000000000001', 'sales_invoice',
        'a0270271-0000-4000-8000-000000000001', 'ISO-INV-1',
        12000, 2000, 10, '2026-07-01', 'MONTHLY',
        '{"rate":"0.0200","cap":"500.0000","grace_days":7,"auto_charge":false,"defaulted_after_lines":3}', NULL),
       ('c0270271-0000-4000-8000-000000000002', $2,
        'b5b5b5b5-0000-4000-8000-000000000002', 'sales_invoice',
        'a0270271-0000-4000-8000-000000000002', 'ISO-INV-1',
        12000, 2000, 10, '2026-07-01', 'MONTHLY',
        '{"rate":"0.0200","cap":"500.0000","grace_days":7,"auto_charge":false,"defaulted_after_lines":3}', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO installment_lines (id, tenant_id, plan_id, seq, due_date, amount, status)
     VALUES
       ('d0270271-0000-4000-8000-000000000001', $1,
        'c0270271-0000-4000-8000-000000000001', 1, '2026-08-01', 1000, 'PENDING'),
       ('d0270271-0000-4000-8000-000000000002', $2,
        'c0270271-0000-4000-8000-000000000002', 1, '2026-08-01', 1000, 'PENDING')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  // PHASE-028 (migration 0039) — budgeting cluster (same 028-marked ids as
  // the seed above; the B row doubles as the A4/A7 foreign probe target).
  await superuser.query(
    `INSERT INTO budgets (id, tenant_id, code, fiscal_year_id, scope, name, name_ar,
        revision_no, status)
     VALUES
       ('e0280281-0000-4000-8000-000000000001', $1, 'BUD-2026-1',
        'c1c1c1c1-0000-4000-8000-000000000001', 'ACCOUNTS', 'FY2026 budget',
        'موازنة 2026', 1, 'DRAFT'),
       ('e0280281-0000-4000-8000-000000000002', $2, 'BUD-2026-1',
        'c1c1c1c1-0000-4000-8000-000000000002', 'ACCOUNTS', 'FY2026 budget',
        'موازنة 2026', 1, 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO budget_lines (id, tenant_id, budget_id, fiscal_period_id, account_id, amount)
     VALUES
       ('f0280281-0000-4000-8000-000000000001', $1,
        'e0280281-0000-4000-8000-000000000001',
        'c2c2c2c2-0000-4000-8000-000000000001',
        'b0b0b0b0-0000-4000-8000-000000000001', 1000),
       ('f0280281-0000-4000-8000-000000000002', $2,
        'e0280281-0000-4000-8000-000000000002',
        'c2c2c2c2-0000-4000-8000-000000000002',
        'b0b0b0b0-0000-4000-8000-000000000002', 1000)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // PHASE-029 (migration 0040) — payroll cluster (029-marked ids; the B
  // rows double as the A4/A7 foreign probe targets). FKs reference each
  // tenant's own fixtures (fiscal period c2c2c2c2…N, account b0b0b0b0…N)
  // so the composite tenant FKs stay satisfied.
  await superuser.query(
    `INSERT INTO salary_structures (id, tenant_id, code, name, currency, status)
     VALUES
       ('a0290291-0000-4000-8000-000000000001', $1, 'ST-ISO', 'Isolation structure', 'SAR', 'ACTIVE'),
       ('a0290291-0000-4000-8000-000000000002', $2, 'ST-ISO', 'Isolation structure', 'SAR', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO salary_components (id, tenant_id, structure_id, key, name, kind, calc, amount, gl_account_id, is_eos_base, seq)
     VALUES
       ('b0290291-0000-4000-8000-000000000001', $1, 'a0290291-0000-4000-8000-000000000001',
        'ISO-ALLOW', 'Isolation allowance', 'ALLOWANCE', 'FIXED', 100, 'b0b0b0b0-0000-4000-8000-000000000001', false, 1),
       ('b0290291-0000-4000-8000-000000000002', $2, 'a0290291-0000-4000-8000-000000000002',
        'ISO-ALLOW', 'Isolation allowance', 'ALLOWANCE', 'FIXED', 100, 'b0b0b0b0-0000-4000-8000-000000000002', false, 1)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, salary_structure_id, status)
     VALUES
       ('c0290291-0000-4000-8000-000000000001', $1, 'EMP-ISO', 'Isolation Employee', '2025-01-01', 'FULL_TIME', 5000,
        'a0290291-0000-4000-8000-000000000001', 'ACTIVE'),
       ('c0290291-0000-4000-8000-000000000002', $2, 'EMP-ISO', 'Isolation Employee', '2025-01-01', 'FULL_TIME', 5000,
        'a0290291-0000-4000-8000-000000000002', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO payroll_runs (id, tenant_id, run_no, fiscal_period_id, status)
     VALUES
       ('d0290291-0000-4000-8000-000000000001', $1, NULL, 'c2c2c2c2-0000-4000-8000-000000000001', 'DRAFT'),
       ('d0290291-0000-4000-8000-000000000002', $2, NULL, 'c2c2c2c2-0000-4000-8000-000000000002', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO payroll_run_lines (id, tenant_id, run_id, employee_id, component_snapshot,
        gross_amount, deductions_amount, net_amount)
     VALUES
       ('e0290291-0000-4000-8000-000000000001', $1, 'd0290291-0000-4000-8000-000000000001',
        'c0290291-0000-4000-8000-000000000001',
        '{"structure":{"id":"a","code":"ST-ISO","name":"X"},"components":[],"loanDeductions":[],"eos":{"enabled":false,"accrual":"0"},"basicSalary":"5000"}'::jsonb,
        5000, 0, 5000),
       ('e0290291-0000-4000-8000-000000000002', $2, 'd0290291-0000-4000-8000-000000000002',
        'c0290291-0000-4000-8000-000000000002',
        '{"structure":{"id":"a","code":"ST-ISO","name":"X"},"components":[],"loanDeductions":[],"eos":{"enabled":false,"accrual":"0"},"basicSalary":"5000"}'::jsonb,
        5000, 0, 5000)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO employee_loans (id, tenant_id, code, employee_id, amount, installments_count, start_period_id, status)
     VALUES
       ('f0290291-0000-4000-8000-000000000001', $1, 'LON-ISO', 'c0290291-0000-4000-8000-000000000001', 300, 1,
        'c2c2c2c2-0000-4000-8000-000000000001', 'ACTIVE'),
       ('f0290291-0000-4000-8000-000000000002', $2, 'LON-ISO', 'c0290291-0000-4000-8000-000000000002', 300, 1,
        'c2c2c2c2-0000-4000-8000-000000000002', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await superuser.query(
    `INSERT INTO employee_loan_lines (id, tenant_id, loan_id, fiscal_period_id, amount, status)
     VALUES
       ('0a290291-0000-4000-8000-000000000001', $1, 'f0290291-0000-4000-8000-000000000001',
        'c2c2c2c2-0000-4000-8000-000000000001', 300, 'PENDING'),
       ('0a290291-0000-4000-8000-000000000002', $2, 'f0290291-0000-4000-8000-000000000002',
        'c2c2c2c2-0000-4000-8000-000000000002', 300, 'PENDING')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );

  // -- seedFixtures end --

}

/** Where each table's tenant-owned row id lives, per table. */
const OWN_ROW: Record<string, [string, string]> = {
  audit_events: ["eeeeeeee-2000-4000-8000-000000000001", "eeeeeeee-2000-4000-8000-000000000002"],
  memberships: ["ffffffff-0000-4000-8000-000000000001", "ffffffff-0000-4000-8000-000000000002"],
  invitations: ["eeeeeeee-1000-4000-8000-000000000001", "eeeeeeee-1000-4000-8000-000000000002"],
  roles: ["dddddddd-0000-4000-8000-000000000001", "dddddddd-0000-4000-8000-000000000002"],
  role_permissions: [
    "dddddddd-0000-4000-8000-000000000001",
    "dddddddd-0000-4000-8000-000000000002",
  ],
  branches: ["abababab-0000-4000-8000-000000000001", "abababab-0000-4000-8000-000000000002"],
  tenant_settings: ["acacacac-0000-4000-8000-000000000001", "acacacac-0000-4000-8000-000000000002"],
  subscriptions: ["adadadad-0000-4000-8000-000000000001", "adadadad-0000-4000-8000-000000000002"],
  entitlements: ["aeaeaeae-0000-4000-8000-000000000001", "aeaeaeae-0000-4000-8000-000000000002"],
  support_sessions: ["afafafaf-0000-4000-8000-000000000001", "afafafaf-0000-4000-8000-000000000002"],
  accounts: ["b0b0b0b0-0000-4000-8000-000000000001", "b0b0b0b0-0000-4000-8000-000000000002"],
  account_purposes: ["b1b1b1b1-0000-4000-8000-000000000001", "b1b1b1b1-0000-4000-8000-000000000002"],
  uoms: ["b2b2b2b2-0000-4000-8000-000000000001", "b2b2b2b2-0000-4000-8000-000000000002"],
  credit_terms: ["b3b3b3b3-0000-4000-8000-000000000001", "b3b3b3b3-0000-4000-8000-000000000002"],
  price_lists: ["b4b4b4b4-0000-4000-8000-000000000001", "b4b4b4b4-0000-4000-8000-000000000002"],
  partners: ["b5b5b5b5-0000-4000-8000-000000000001", "b5b5b5b5-0000-4000-8000-000000000002"],
  partner_contacts: ["b6b6b6b6-0000-4000-8000-000000000001", "b6b6b6b6-0000-4000-8000-000000000002"],
  partner_addresses: ["b7b7b7b7-0000-4000-8000-000000000001", "b7b7b7b7-0000-4000-8000-000000000002"],
  item_categories: ["b8b8b8b8-0000-4000-8000-000000000001", "b8b8b8b8-0000-4000-8000-000000000002"],
  uom_conversions: ["b9b9b9b9-0000-4000-8000-000000000001", "b9b9b9b9-0000-4000-8000-000000000002"],
  items: ["babababa-0000-4000-8000-000000000001", "babababa-0000-4000-8000-000000000002"],
  barcodes: ["bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002"],
  price_list_items: ["bcbcbcbc-0000-4000-8000-000000000001", "bcbcbcbc-0000-4000-8000-000000000002"],
  partner_balances: ["bdbdbdbd-0000-4000-8000-000000000001", "bdbdbdbd-0000-4000-8000-000000000002"],
  opening_balance_docs: ["bebebebe-0000-4000-8000-000000000001", "bebebebe-0000-4000-8000-000000000002"],
  file_objects: ["bfbfbfbf-0000-4000-8000-000000000001", "bfbfbfbf-0000-4000-8000-000000000002"],
  import_jobs: ["c0c0c0c0-0000-4000-8000-000000000001", "c0c0c0c0-0000-4000-8000-000000000002"],
  fiscal_years: ["c1c1c1c1-0000-4000-8000-000000000001", "c1c1c1c1-0000-4000-8000-000000000002"],
  fiscal_periods: ["c2c2c2c2-0000-4000-8000-000000000001", "c2c2c2c2-0000-4000-8000-000000000002"],
  exchange_rates: ["c3c3c3c3-0000-4000-8000-000000000001", "c3c3c3c3-0000-4000-8000-000000000002"],
  cost_centers: ["c4c4c4c4-0000-4000-8000-000000000001", "c4c4c4c4-0000-4000-8000-000000000002"],
  recurring_journals: ["c5c5c5c5-0000-4000-8000-000000000001", "c5c5c5c5-0000-4000-8000-000000000002"],
  approval_policies: ["c6c6c6c6-0000-4000-8000-000000000001", "c6c6c6c6-0000-4000-8000-000000000002"],
  numbering_sequences: ["c7c7c7c7-0000-4000-8000-000000000001", "c7c7c7c7-0000-4000-8000-000000000002"],
  number_assignments: ["c8c8c8c8-0000-4000-8000-000000000001", "c8c8c8c8-0000-4000-8000-000000000002"],
  manual_journals: ["c9c9c9c9-0000-4000-8000-000000000001", "c9c9c9c9-0000-4000-8000-000000000002"],
  manual_journal_lines: ["cacacaca-0000-4000-8000-000000000001", "cacacaca-0000-4000-8000-000000000002"],
  journal_templates: ["cbcbcbcb-0000-4000-8000-000000000001", "cbcbcbcb-0000-4000-8000-000000000002"],
  journal_entries: ["cccccccc-0000-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000002"],
  journal_lines: ["cdcdcdcd-0000-4000-8000-000000000001", "cdcdcdcd-0000-4000-8000-000000000002"],
  partner_subledger_entries: [
    "cececece-0000-4000-8000-000000000001",
    "cececece-0000-4000-8000-000000000002",
  ],
  reconciliation_runs: ["cfcfcfcf-0000-4000-8000-000000000001", "cfcfcfcf-0000-4000-8000-000000000002"],
  // PHASE-008 treasury cluster: [own-A row, own-B row] per table (the B row
  // doubles as the A4/A7 foreign probe target).
  cash_accounts: [
    "d0d0d0d0-0000-4000-8000-000000000001",
    "d0d0d0d0-0000-4000-8000-000000000002",
  ],
  cash_movements: ["d2d2d2d2-0000-4000-8000-000000000001", "d2d2d2d2-0000-4000-8000-000000000002"],
  receipts: ["d3d3d3d3-0000-4000-8000-000000000001", "d3d3d3d3-0000-4000-8000-000000000002"],
  payments: ["d4d4d4d4-0000-4000-8000-000000000001", "d4d4d4d4-0000-4000-8000-000000000002"],
  treasury_allocations: ["d5d5d5d5-0000-4000-8000-000000000001", "d5d5d5d5-0000-4000-8000-000000000002"],
  expense_categories: ["d6d6d6d6-0000-4000-8000-000000000001", "d6d6d6d6-0000-4000-8000-000000000002"],
  expenses: ["d7d7d7d7-0000-4000-8000-000000000001", "d7d7d7d7-0000-4000-8000-000000000002"],
  cash_transfers: ["d8d8d8d8-0000-4000-8000-000000000001", "d8d8d8d8-0000-4000-8000-000000000002"],
  cashier_shifts: ["d9d9d9d9-0000-4000-8000-000000000001", "d9d9d9d9-0000-4000-8000-000000000002"],
  bank_statements: ["dadadada-0000-4000-8000-000000000001", "dadadada-0000-4000-8000-000000000002"],
  bank_statement_lines: ["dbdbdbdb-0000-4000-8000-000000000001", "dbdbdbdb-0000-4000-8000-000000000002"],
  // PHASE-009 tax cluster (migration 0013).
  tax_codes: ["e0e0e0e0-0000-4000-8000-000000000001", "e0e0e0e0-0000-4000-8000-000000000002"],
  tax_registrations: ["e1e1e1e1-0000-4000-8000-000000000001", "e1e1e1e1-0000-4000-8000-000000000002"],
  tax_pack_bindings: ["e2e2e2e2-0000-4000-8000-000000000001", "e2e2e2e2-0000-4000-8000-000000000002"],
  tax_document_summaries: [
    "e3e3e3e3-0000-4000-8000-000000000001",
    "e3e3e3e3-0000-4000-8000-000000000002",
  ],
  vat_returns: ["e4e4e4e4-0000-4000-8000-000000000001", "e4e4e4e4-0000-4000-8000-000000000002"],
  e_invoicing_submissions: [
    "e5e5e5e5-0000-4000-8000-000000000001",
    "e5e5e5e5-0000-4000-8000-000000000002",
  ],
  // PHASE-010 inventory cluster (migrations 0014/0015): warehouses lists
  // the [WH1-A, WH1-B] pair (the transfer fixture's from side); the second
  // warehouses (WH2) exist only for the transfer fixture's to side.
  warehouses: [
    "f0f0f0f0-1000-4000-8000-000000000001",
    "f0f0f0f0-1000-4000-8000-000000000002",
  ],
  item_warehouse_settings: [
    "f1f1f1f1-0000-4000-8000-000000000001",
    "f1f1f1f1-0000-4000-8000-000000000002",
  ],
  stock_moves: ["f4f4f4f4-0000-4000-8000-000000000001", "f4f4f4f4-0000-4000-8000-000000000002"],
  stock_layers: ["f5f5f5f5-0000-4000-8000-000000000001", "f5f5f5f5-0000-4000-8000-000000000002"],
  item_stock: ["f6f6f6f6-0000-4000-8000-000000000001", "f6f6f6f6-0000-4000-8000-000000000002"],
  stock_transfers: [
    "f7f7f7f7-0000-4000-8000-000000000001",
    "f7f7f7f7-0000-4000-8000-000000000002",
  ],
  stock_transfer_lines: [
    "f8f8f8f8-0000-4000-8000-000000000001",
    "f8f8f8f8-0000-4000-8000-000000000002",
  ],
  stock_adjustments: [
    "f9f9f9f9-0000-4000-8000-000000000001",
    "f9f9f9f9-0000-4000-8000-000000000002",
  ],
  stock_reservations: [
    "fafafafa-0000-4000-8000-000000000001",
    "fafafafa-0000-4000-8000-000000000002",
  ],
  item_batches: ["f2f2f2f2-0000-4000-8000-000000000001", "f2f2f2f2-0000-4000-8000-000000000002"],
  item_serials: ["f3f3f3f3-0000-4000-8000-000000000001", "f3f3f3f3-0000-4000-8000-000000000002"],
  stock_counts: ["fbfbfbfb-0000-4000-8000-000000000001", "fbfbfbfb-0000-4000-8000-000000000002"],
  stock_count_lines: [
    "fcfcfcfc-0000-4000-8000-000000000001",
    "fcfcfcfc-0000-4000-8000-000000000002",
  ],
  // PHASE-011 purchasing cluster (migrations 0016/0017): one FK-consistent
  // DRAFT row per registered table per tenant (the B row doubles as the
  // A4/A7 foreign probe target).
  purchase_requests: ["5a5a5a5a-0000-4000-8000-000000000001", "5a5a5a5a-0000-4000-8000-000000000002"],
  purchase_request_lines: ["5b5b5b5b-0000-4000-8000-000000000001", "5b5b5b5b-0000-4000-8000-000000000002"],
  purchase_orders: ["5c5c5c5c-0000-4000-8000-000000000001", "5c5c5c5c-0000-4000-8000-000000000002"],
  purchase_order_lines: ["5d5d5d5d-0000-4000-8000-000000000001", "5d5d5d5d-0000-4000-8000-000000000002"],
  goods_receipts: ["5e5e5e5e-0000-4000-8000-000000000001", "5e5e5e5e-0000-4000-8000-000000000002"],
  goods_receipt_lines: ["5f5f5f5f-0000-4000-8000-000000000001", "5f5f5f5f-0000-4000-8000-000000000002"],
  supplier_invoices: ["60606060-0000-4000-8000-000000000001", "60606060-0000-4000-8000-000000000002"],
  supplier_invoice_lines: ["61616161-0000-4000-8000-000000000001", "61616161-0000-4000-8000-000000000002"],
  debit_notes: ["62626262-0000-4000-8000-000000000001", "62626262-0000-4000-8000-000000000002"],
  debit_note_lines: ["63636363-0000-4000-8000-000000000001", "63636363-0000-4000-8000-000000000002"],
  landed_costs: ["64646464-0000-4000-8000-000000000001", "64646464-0000-4000-8000-000000000002"],
  landed_cost_allocations: ["65656565-0000-4000-8000-000000000001", "65656565-0000-4000-8000-000000000002"],
  purchase_reallocations: ["66666666-0000-4000-8000-000000000001", "66666666-0000-4000-8000-000000000002"],
  purchase_reallocation_lines: ["67676767-0000-4000-8000-000000000001", "67676767-0000-4000-8000-000000000002"],
  // PHASE-012 sales cluster (migrations 0018/0019): one FK-consistent
  // row per registered table per tenant (the B row doubles as the A4/A7
  // foreign probe target).
  sales_reps: ["70707070-0000-4000-8000-000000000001", "70707070-0000-4000-8000-000000000002"],
  quotations: ["71717171-0000-4000-8000-000000000001", "71717171-0000-4000-8000-000000000002"],
  quotation_lines: ["72727272-0000-4000-8000-000000000001", "72727272-0000-4000-8000-000000000002"],
  sales_orders: ["73737373-0000-4000-8000-000000000001", "73737373-0000-4000-8000-000000000002"],
  sales_order_lines: ["74747474-0000-4000-8000-000000000001", "74747474-0000-4000-8000-000000000002"],
  delivery_notes: ["75757575-0000-4000-8000-000000000001", "75757575-0000-4000-8000-000000000002"],
  delivery_note_lines: ["76767676-0000-4000-8000-000000000001", "76767676-0000-4000-8000-000000000002"],
  sales_invoices: ["77777777-0000-4000-8000-000000000001", "77777777-0000-4000-8000-000000000002"],
  sales_invoice_lines: ["78787878-0000-4000-8000-000000000001", "78787878-0000-4000-8000-000000000002"],
  credit_notes: ["79797979-0000-4000-8000-000000000001", "79797979-0000-4000-8000-000000000002"],
  credit_note_lines: ["7a7a7a7a-0000-4000-8000-000000000001", "7a7a7a7a-0000-4000-8000-000000000002"],
  sales_reallocations: ["7b7b7b7b-0000-4000-8000-000000000001", "7b7b7b7b-0000-4000-8000-000000000002"],
  sales_reallocation_lines: ["7c7c7c7c-0000-4000-8000-000000000001", "7c7c7c7c-0000-4000-8000-000000000002"],
  // PHASE-013 reporting cluster (migration 0020): one orchestration row +
  // one template registry row per tenant.
  report_runs: ["0d0d0d0d-0000-4000-8000-000000000001", "0d0d0d0d-0000-4000-8000-000000000002"],
  print_templates: ["0e0e0e0e-0000-4000-8000-000000000001", "0e0e0e0e-0000-4000-8000-000000000002"],
  // PHASE-014 billing cluster (migration 0021).
  subscription_invoices: [
    "1a1a1a1a-0000-4000-8000-000000000001",
    "1a1a1a1a-0000-4000-8000-000000000002",
  ],
  billing_events: ["1b1b1b1b-0000-4000-8000-000000000001", "1b1b1b1b-0000-4000-8000-000000000002"],
  usage_counters: ["1c1c1c1c-0000-4000-8000-000000000001", "1c1c1c1c-0000-4000-8000-000000000002"],
  notifications: ["1d1d1d1d-0000-4000-8000-000000000001", "1d1d1d1d-0000-4000-8000-000000000002"],
  notification_prefs: [
    "1e1e1e1e-0000-4000-8000-000000000001",
    "1e1e1e1e-0000-4000-8000-000000000002",
  ],
  // PHASE-015 industry configuration cluster (migration 0022).
  tenant_industry_config: [
    "21212121-0000-4000-8000-000000000001",
    "21212121-0000-4000-8000-000000000002",
  ],
  item_components: [
    "20202020-0000-4000-8000-000000000001",
    "20202020-0000-4000-8000-000000000002",
  ],
  // PHASE-016 POS cluster (migration 0024). change_log carries no `id`
  // column — its probes key on entity_id (see A1/A2 id-column override).
  pos_terminals: [
    "22222222-0000-4000-8000-000000000001",
    "22222222-0000-4000-8000-000000000002",
  ],
  pos_tables: [
    "23232323-0000-4000-8000-000000000001",
    "23232323-0000-4000-8000-000000000002",
  ],
  pos_checks: [
    "24242424-0000-4000-8000-000000000001",
    "24242424-0000-4000-8000-000000000002",
  ],
  pos_kitchen_tickets: [
    "25252525-0000-4000-8000-000000000001",
    "25252525-0000-4000-8000-000000000002",
  ],
  change_log: [
    "babababa-0000-4000-8000-000000000001",
    "babababa-0000-4000-8000-000000000002",
  ],
  sync_cursors: [
    "26262626-0000-4000-8000-000000000001",
    "26262626-0000-4000-8000-000000000002",
  ],
  // PHASE-020 sync cluster (migration 0029): the soft-delete GC ledger +
  // the push dedupe ledger (both deleteGranted — the retention/GC jobs).
  tombstones: [
    "3c3c3c3c-0000-4000-8000-000000000001",
    "3c3c3c3c-0000-4000-8000-000000000002",
  ],
  inbox_commands: [
    "3d3d3d3d-0000-4000-8000-000000000001",
    "3d3d3d3d-0000-4000-8000-000000000002",
  ],
  // PHASE-017 automotive & distribution cluster (migration 0025).
  vehicles: [
    "27272727-0000-4000-8000-000000000001",
    "27272727-0000-4000-8000-000000000002",
  ],
  job_cards: [
    "28282828-0000-4000-8000-000000000001",
    "28282828-0000-4000-8000-000000000002",
  ],
  job_card_lines: [
    "29292929-0000-4000-8000-000000000001",
    "29292929-0000-4000-8000-000000000002",
  ],
  customer_tiers: [
    "2a2a2a2a-0000-4000-8000-000000000001",
    "2a2a2a2a-0000-4000-8000-000000000002",
  ],
  free_goods_rules: [
    "2b2b2b2b-0000-4000-8000-000000000001",
    "2b2b2b2b-0000-4000-8000-000000000002",
  ],
  routes: [
    "2c2c2c2c-0000-4000-8000-000000000001",
    "2c2c2c2c-0000-4000-8000-000000000002",
  ],
  route_customers: [
    "2d2d2d2d-0000-4000-8000-000000000001",
    "2d2d2d2d-0000-4000-8000-000000000002",
  ],
  route_visits: [
    "2e2e2e2e-0000-4000-8000-000000000001",
    "2e2e2e2e-0000-4000-8000-000000000002",
  ],
  van_stocks: [
    "2f2f2f2f-0000-4000-8000-000000000001",
    "2f2f2f2f-0000-4000-8000-000000000002",
  ],
  rep_settlements: [
    "30303030-0000-4000-8000-000000000001",
    "30303030-0000-4000-8000-000000000002",
  ],
  rep_settlement_lines: [
    "31313131-0000-4000-8000-000000000001",
    "31313131-0000-4000-8000-000000000002",
  ],
  commission_runs: [
    "32323232-0000-4000-8000-000000000001",
    "32323232-0000-4000-8000-000000000002",
  ],
  commission_run_lines: [
    "33333333-0000-4000-8000-000000000001",
    "33333333-0000-4000-8000-000000000002",
  ],
  // PHASE-018 manufacturing cluster (migration 0026).
  bills_of_materials: [
    "34343434-0000-4000-8000-000000000001",
    "34343434-0000-4000-8000-000000000002",
  ],
  bom_lines: [
    "35353535-0000-4000-8000-000000000001",
    "35353535-0000-4000-8000-000000000002",
  ],
  production_orders: [
    "36363636-0000-4000-8000-000000000001",
    "36363636-0000-4000-8000-000000000002",
  ],
  production_order_lines: [
    "37373737-0000-4000-8000-000000000001",
    "37373737-0000-4000-8000-000000000002",
  ],
  production_consumptions: [
    "38383838-0000-4000-8000-000000000001",
    "38383838-0000-4000-8000-000000000002",
  ],
  production_scraps: [
    "39393939-0000-4000-8000-000000000001",
    "39393939-0000-4000-8000-000000000002",
  ],
  inspections: [
    "3a3a3a3a-0000-4000-8000-000000000001",
    "3a3a3a3a-0000-4000-8000-000000000002",
  ],
  // PHASE-019 crm/service-billing cluster (migration 0027).
  projects: [
    "a1a1a1a1-0000-4000-8000-000000000001",
    "a1a1a1a1-0000-4000-8000-000000000002",
  ],
  leads: [
    "91919191-0000-4000-8000-000000000001",
    "91919191-0000-4000-8000-000000000002",
  ],
  crm_tasks: [
    "92929292-0000-4000-8000-000000000001",
    "92929292-0000-4000-8000-000000000002",
  ],
  crm_activities: [
    "93939393-0000-4000-8000-000000000001",
    "93939393-0000-4000-8000-000000000002",
  ],
  service_contracts: [
    "94949494-0000-4000-8000-000000000001",
    "94949494-0000-4000-8000-000000000002",
  ],
  contract_billing_schedule: [
    "95959595-0000-4000-8000-000000000001",
    "95959595-0000-4000-8000-000000000002",
  ],
  contract_invoices: [
    "96969696-0000-4000-8000-000000000001",
    "96969696-0000-4000-8000-000000000002",
  ],
  contract_advances: [
    "97979797-0000-4000-8000-000000000001",
    "97979797-0000-4000-8000-000000000002",
  ],
  service_orders: [
    "98989898-0000-4000-8000-000000000001",
    "98989898-0000-4000-8000-000000000002",
  ],
  service_order_lines: [
    "99999999-0000-4000-8000-000000000001",
    "99999999-0000-4000-8000-000000000002",
  ],
  crm_time_entries: [
    "a0a0a0a0-0000-4000-8000-000000000001",
    "a0a0a0a0-0000-4000-8000-000000000002",
  ],
  // PHASE-023 external-integrations cluster (migration 0035): the S-10
  // certificates + usage audit + rollout flags + parked bank lines +
  // commerce staging + payout batches.
  e_invoicing_certificates: [
    "a2a2a2a2-0000-4000-8000-000000000001",
    "a2a2a2a2-0000-4000-8000-000000000002",
  ],
  e_invoicing_certificate_usage: [
    "a3a3a3a3-0000-4000-8000-000000000001",
    "a3a3a3a3-0000-4000-8000-000000000002",
  ],
  e_invoicing_adapter_settings: [
    "a4a4a4a4-0000-4000-8000-000000000001",
    "a4a4a4a4-0000-4000-8000-000000000002",
  ],
  bank_statement_parked_lines: [
    "a5a5a5a5-0000-4000-8000-000000000001",
    "a5a5a5a5-0000-4000-8000-000000000002",
  ],
  // PHASE-024 security hardening cluster (migration 0036).
  tenant_offboarding: [
    "a9a9a9a9-0000-4000-8000-000000000001",
    "a9a9a9a9-0000-4000-8000-000000000002",
  ],
  commerce_channel_orders: [
    "a6a6a6a6-0000-4000-8000-000000000001",
    "a6a6a6a6-0000-4000-8000-000000000002",
  ],
  commerce_channel_imports: [
    "a7a7a7a7-0000-4000-8000-000000000001",
    "a7a7a7a7-0000-4000-8000-000000000002",
  ],
  billing_payouts: [
    "a8a8a8a8-0000-4000-8000-000000000001",
    "a8a8a8a8-0000-4000-8000-000000000002",
  ],
  // PHASE-026 fixed-assets cluster (migration 0037): the fa-prefixed
  // hex ids (fa0=categories, fa1=assets, fa2=runs, fa3=lines,
  // fa4=disposals, fa5=revaluations — the B row doubles as the A4/A7
  // foreign probe target).
  asset_categories: [
    "fa0a0a0a-0000-4000-8000-000000000001",
    "fa0a0a0a-0000-4000-8000-000000000002",
  ],
  assets: ["fa1a1a1a-0000-4000-8000-000000000001", "fa1a1a1a-0000-4000-8000-000000000002"],
  depreciation_runs: [
    "fa2a2a2a-0000-4000-8000-000000000001",
    "fa2a2a2a-0000-4000-8000-000000000002",
  ],
  depreciation_lines: [
    "fa3a3a3a-0000-4000-8000-000000000001",
    "fa3a3a3a-0000-4000-8000-000000000002",
  ],
  asset_disposals: [
    "fa4a4a4a-0000-4000-8000-000000000001",
    "fa4a4a4a-0000-4000-8000-000000000002",
  ],
  asset_revaluations: [
    "fa5a5a5a-0000-4000-8000-000000000001",
    "fa5a5a5a-0000-4000-8000-000000000002",
  ],
  // PHASE-027 (0038): the notes & installments cluster — the B row doubles
  // as the A4/A7 foreign probe target.
  notes: ["a0270271-0000-4000-8000-000000000001", "a0270271-0000-4000-8000-000000000002"],
  note_events: [
    "b0270271-0000-4000-8000-000000000001",
    "b0270271-0000-4000-8000-000000000002",
  ],
  installment_plans: [
    "c0270271-0000-4000-8000-000000000001",
    "c0270271-0000-4000-8000-000000000002",
  ],
  installment_lines: [
    "d0270271-0000-4000-8000-000000000001",
    "d0270271-0000-4000-8000-000000000002",
  ],
  // PHASE-028 (0039): the budgeting cluster — the B row doubles as the
  // A4/A7 foreign probe target.
  budgets: ["e0280281-0000-4000-8000-000000000001", "e0280281-0000-4000-8000-000000000002"],
  budget_lines: [
    "f0280281-0000-4000-8000-000000000001",
    "f0280281-0000-4000-8000-000000000002",
  ],
  // PHASE-029 (0040): the payroll cluster — the B rows double as the
  // A4/A7 foreign probe targets.
  salary_structures: ["a0290291-0000-4000-8000-000000000001", "a0290291-0000-4000-8000-000000000002"],
  salary_components: ["b0290291-0000-4000-8000-000000000001", "b0290291-0000-4000-8000-000000000002"],
  employees: ["c0290291-0000-4000-8000-000000000001", "c0290291-0000-4000-8000-000000000002"],
  payroll_runs: ["d0290291-0000-4000-8000-000000000001", "d0290291-0000-4000-8000-000000000002"],
  payroll_run_lines: ["e0290291-0000-4000-8000-000000000001", "e0290291-0000-4000-8000-000000000002"],
  employee_loans: ["f0290291-0000-4000-8000-000000000001", "f0290291-0000-4000-8000-000000000002"],
  employee_loan_lines: ["0a290291-0000-4000-8000-000000000001", "0a290291-0000-4000-8000-000000000002"],
};

/** Mismatched-tenant INSERT shapes per table (A3) — explicit columns so the
 * attack isolates the RLS WITH CHECK, never an incidental PK conflict.
 * Single parameter $1 = the FOREIGN tenant id, applied under the caller's
 * own GUC. */
const MISMATCHED_INSERT: Record<string, string> = {
  audit_events: `INSERT INTO audit_events (id, tenant_id, action, entity_type, entity_id)
     VALUES ('eeeeeeee-3000-4000-8000-000000000003', $1, 'iso.attack', 'iso_fixture', $1)`,
  memberships: `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ('ffffffff-3000-4000-8000-000000000003', $1,
             'eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002')`,
  invitations: `INSERT INTO invitations (id, tenant_id, email, role_id, token_hash, expires_at, invited_by)
     VALUES ('eeeeeeee-4000-4000-8000-000000000003', $1, 'iso-attack@test',
             'dddddddd-0000-4000-8000-000000000002', 'iso-attack-token', now() + interval '72 hours',
             'eeeeeeee-0000-4000-8000-000000000002')`,
  roles: `INSERT INTO roles (id, tenant_id, key, name)
     VALUES ('dddddddd-3000-4000-8000-000000000003', $1, 'attack_role', 'Attack Role')`,
  role_permissions: `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     VALUES ('dddddddd-0000-4000-8000-000000000002', $1, 'partners.view')`,
  branches: `INSERT INTO branches (id, tenant_id, code, name)
     VALUES ('abababab-3000-4000-8000-000000000003', $1, 'ATK', 'Attack Branch')`,
  tenant_settings: `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES ('acacacac-3000-4000-8000-000000000003', $1, 'sales.credit_limit_action', '"warn"'::jsonb)`,
  subscriptions: `INSERT INTO subscriptions (id, tenant_id, plan_id, period_start, period_end)
     VALUES ('adadadad-3000-4000-8000-000000000003', $1,
             '30000000-0000-4000-8000-000000000002', '2026-01-01', '2026-12-31')`,
  entitlements: `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES ('aeaeaeae-3000-4000-8000-000000000003', $1, 'pos.sales', 'MANUAL')`,
  support_sessions: `INSERT INTO support_sessions (id, tenant_id, platform_user_id, opt_in, ticket_ref, reason, expires_at)
     VALUES ('afafafaf-3000-4000-8000-000000000003', $1,
             'eeeeeeee-0000-4000-8000-000000000001', false, 'ISO-ATK', 'attack fixture',
             now() + interval '4 hours')`,
  accounts: `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES ('b0b0b0b0-3000-4000-8000-000000000003', $1, '2000', 'Attack Account', 'حساب هجوم', 'ASSET', false)`,
  account_purposes: `INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
     VALUES ('b1b1b1b1-3000-4000-8000-000000000003', $1, 'AP_CONTROL',
             'b0b0b0b0-0000-4000-8000-000000000002', '2026-01-01')`,
  uoms: `INSERT INTO uoms (id, tenant_id, code, name)
     VALUES ('b2b2b2b2-3000-4000-8000-000000000003', $1, 'ATK-U', 'Attack Unit')`,
  credit_terms: `INSERT INTO credit_terms (id, tenant_id, code, name, days)
     VALUES ('b3b3b3b3-3000-4000-8000-000000000003', $1, 'ATK-NET', 'Attack Terms', 90)`,
  price_lists: `INSERT INTO price_lists (id, tenant_id, name, kind, currency_code)
     VALUES ('b4b4b4b4-3000-4000-8000-000000000003', $1, 'Attack List', 'SALE', 'SAR')`,
  partners: `INSERT INTO partners (id, tenant_id, kind, code, name)
     VALUES ('b5b5b5b5-3000-4000-8000-000000000003', $1, 'CUSTOMER', 'ATK-P', 'Attack Partner')`,
  partner_contacts: `INSERT INTO partner_contacts (id, tenant_id, partner_id, name)
     VALUES ('b6b6b6b6-3000-4000-8000-000000000003', $1,
             'b5b5b5b5-0000-4000-8000-000000000002', 'Attack Contact')`,
  partner_addresses: `INSERT INTO partner_addresses (id, tenant_id, partner_id, type, line1)
     VALUES ('b7b7b7b7-3000-4000-8000-000000000003', $1,
             'b5b5b5b5-0000-4000-8000-000000000002', 'SHIPPING', 'Attack Line')`,
  item_categories: `INSERT INTO item_categories (id, tenant_id, code, name)
     VALUES ('b8b8b8b8-3000-4000-8000-000000000003', $1, 'ATK-CAT', 'Attack Category')`,
  uom_conversions: `INSERT INTO uom_conversions (id, tenant_id, from_uom_id, to_uom_id, factor)
     VALUES ('b9b9b9b9-3000-4000-8000-000000000003', $1,
             'b2b2b2b2-0000-4000-8000-000000000002', 'b2b2b2b2-1000-4000-8000-000000000002', 999)`,
  items: `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id)
     VALUES ('babababa-3000-4000-8000-000000000003', $1, 'ATK-ITEM', 'Attack Item', 'STOCK',
             'b2b2b2b2-0000-4000-8000-000000000002')`,
  barcodes: `INSERT INTO barcodes (id, tenant_id, item_id, uom_id, code)
     VALUES ('bbbbbbbb-3000-4000-8000-000000000003', $1,
             'babababa-0000-4000-8000-000000000002', 'b2b2b2b2-0000-4000-8000-000000000002', '9999999999999')`,
  price_list_items: `INSERT INTO price_list_items (id, tenant_id, price_list_id, item_id, uom_id, unit_price, min_qty)
     VALUES ('bcbcbcbc-3000-4000-8000-000000000003', $1,
             'b4b4b4b4-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
             'b2b2b2b2-0000-4000-8000-000000000002', 42, 99)`,
  partner_balances: `INSERT INTO partner_balances (id, tenant_id, partner_id, draft_balance)
     VALUES ('bdbdbdbd-3000-4000-8000-000000000003', $1,
             'b5b5b5b5-0000-4000-8000-000000000002', 777)`,
  opening_balance_docs: `INSERT INTO opening_balance_docs (id, tenant_id, kind, account_id, amount, currency_code)
     VALUES ('bebebebe-3000-4000-8000-000000000003', $1, 'ACCOUNT',
             'b0b0b0b0-0000-4000-8000-000000000002', 100, 'SAR')`,
  file_objects: `INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
     VALUES ('bfbfbfbf-3000-4000-8000-000000000003', $1, 'PARTNER',
             'b5b5b5b5-0000-4000-8000-000000000002', 'iso/attack.pdf', 'attack.pdf', 10, 'application/pdf')`,
  import_jobs: `INSERT INTO import_jobs (id, tenant_id, kind, format, upload_token, file_key)
     VALUES ('c0c0c0c0-3000-4000-8000-000000000003', $1, 'ITEMS', 'CSV', 'iso-attack-token',
             'iso/attack.csv')`,
  fiscal_years: `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date)
     VALUES ('c1c1c1c1-3000-4000-8000-000000000003', $1, 'ATK', '2027-01-01', '2027-12-31')`,
  fiscal_periods: `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date)
     VALUES ('c2c2c2c2-3000-4000-8000-000000000003', $1, 'c1c1c1c1-0000-4000-8000-000000000002',
             '2027-01', 'REGULAR', '2027-01-01', '2027-01-31')`,
  exchange_rates: `INSERT INTO exchange_rates (id, tenant_id, currency_code, rate_date, rate)
     VALUES ('c3c3c3c3-3000-4000-8000-000000000003', $1, 'EUR', '2026-02-01', 4.05)`,
  cost_centers: `INSERT INTO cost_centers (id, tenant_id, code, name)
     VALUES ('c4c4c4c4-3000-4000-8000-000000000003', $1, 'ATK', 'Attack Center')`,
  recurring_journals: `INSERT INTO recurring_journals (id, tenant_id, name, template, schedule, start_date, next_run_date)
     VALUES ('c5c5c5c5-3000-4000-8000-000000000003', $1, 'ATK', '{"lines": []}'::jsonb,
             'MONTHLY', '2026-02-01', '2026-03-01')`,
  approval_policies: `INSERT INTO approval_policies (id, tenant_id, doc_type, policy, applies_from)
     VALUES ('c6c6c6c6-3000-4000-8000-000000000003', $1, 'journal_entry',
             '{"mode": "none"}'::jsonb, '2026-02-01')`,
  numbering_sequences: `INSERT INTO numbering_sequences (id, tenant_id, doc_type, period_key, next_value)
     VALUES ('c7c7c7c7-3000-4000-8000-000000000003', $1, 'journal_entry', '2027', 1)`,
  number_assignments: `INSERT INTO number_assignments (id, tenant_id, doc_type, period_key, number, value)
     VALUES ('c8c8c8c8-3000-4000-8000-000000000003', $1, 'journal_entry', '2027', 'JE-2027-000001', 1)`,
  manual_journals: `INSERT INTO manual_journals (id, tenant_id, status, entry_date, currency_code)
     VALUES ('c9c9c9c9-3000-4000-8000-000000000003', $1, 'DRAFT', '2026-02-05', 'SAR')`,
  manual_journal_lines: `INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount)
     VALUES ('cacacaca-3000-4000-8000-000000000003', $1, 'c9c9c9c9-0000-4000-8000-000000000002',
             1, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 10)`,
  journal_templates: `INSERT INTO journal_templates (id, tenant_id, name, lines)
     VALUES ('cbcbcbcb-3000-4000-8000-000000000003', $1, 'ATK template', '[{"direction": "DEBIT"}]'::jsonb)`,
  journal_entries: `INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code, source_type, operation)
     VALUES ('cccccccc-3000-4000-8000-000000000003', $1, '2026-02-05',
             'c2c2c2c2-0000-4000-8000-000000000002', 'SAR', 'iso_attack', 'post')`,
  journal_lines: `INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id, direction, amount, base_amount)
     VALUES ('cdcdcdcd-3000-4000-8000-000000000003', $1, 'cccccccc-0000-4000-8000-000000000002',
             3, 'b0b0b0b0-0000-4000-8000-000000000002', 'DEBIT', 10, 10)`,
  partner_subledger_entries: `INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id,
                                            journal_line_id, entry_date, direction, amount, base_amount, currency_code, source_type)
     VALUES ('cececece-3000-4000-8000-000000000003', $1, 'b5b5b5b5-0000-4000-8000-000000000002',
             'cccccccc-0000-4000-8000-000000000002', 'cdcdcdcd-0000-4000-8000-000000000002',
             '2026-01-20', 'DEBIT', 10, 10, 'SAR', 'iso_attack')`,
  reconciliation_runs: `INSERT INTO reconciliation_runs (id, tenant_id, kind, as_of, status, control_balance, subledger_balance)
     VALUES ('cfcfcfcf-3000-4000-8000-000000000003', $1, 'AP', '2026-02-28', 'OK', 0, 0)`,
  cash_accounts: `INSERT INTO cash_accounts (id, tenant_id, name, type, account_id, currency_code)
     VALUES ('d0d0d0d0-3000-4000-8000-000000000003', $1, 'Attack Cash', 'CASH',
             'b0b0b0b0-0000-4000-8000-000000000002', 'SAR')`,
  cash_movements: `INSERT INTO cash_movements (id, tenant_id, cash_account_id, direction, amount, currency_code, exchange_rate, base_amount, source_type, source_id, value_date)
     VALUES ('d2d2d2d2-3000-4000-8000-000000000003', $1, 'd0d0d0d0-0000-4000-8000-000000000002', 'OUT',
             10, 'SAR', 1, 10, 'expense', 'd0d0d0d0-0000-4000-8000-000000000002', '2027-02-01')`,
  receipts: `INSERT INTO receipts (id, tenant_id, status, cash_account_id, partner_id, method, currency_code, amount, value_date)
     VALUES ('d3d3d3d3-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 10, '2027-02-01')`,
  payments: `INSERT INTO payments (id, tenant_id, status, cash_account_id, partner_id, method, currency_code, amount, value_date)
     VALUES ('d4d4d4d4-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'CASH', 'SAR', 10, '2027-02-01')`,
  treasury_allocations: `INSERT INTO treasury_allocations (id, tenant_id, receipt_id, open_item_id, amount)
     VALUES ('d5d5d5d5-3000-4000-8000-000000000003', $1, 'd3d3d3d3-0000-4000-8000-000000000002',
             'cececece-0000-4000-8000-000000000002', 5)`,
  expense_categories: `INSERT INTO expense_categories (id, tenant_id, code, name, name_ar, account_id)
     VALUES ('d6d6d6d6-3000-4000-8000-000000000003', $1, 'ATK', 'Attack', 'هجوم',
             'b0b0b0b0-0000-4000-8000-000000000002')`,
  expenses: `INSERT INTO expenses (id, tenant_id, status, category_id, cash_account_id, payee_name, currency_code, amount, value_date)
     VALUES ('d7d7d7d7-3000-4000-8000-000000000003', $1, 'DRAFT', 'd6d6d6d6-0000-4000-8000-000000000002',
             'd0d0d0d0-0000-4000-8000-000000000002', 'Attack Payee', 'SAR', 10, '2027-02-01')`,
  cash_transfers: `INSERT INTO cash_transfers (id, tenant_id, status, from_account_id, to_account_id, currency_code, amount, fee_amount, value_date)
     VALUES ('d8d8d8d8-3000-4000-8000-000000000003', $1, 'DRAFT', 'd0d0d0d0-0000-4000-8000-000000000002',
             'd1d1d1d1-0000-4000-8000-000000000002', 'SAR', 10, 0, '2027-02-01')`,
  cashier_shifts: `INSERT INTO cashier_shifts (id, tenant_id, status, cash_account_id, currency_code, opening_amount)
     VALUES ('d9d9d9d9-3000-4000-8000-000000000003', $1, 'OPEN', 'd0d0d0d0-0000-4000-8000-000000000002',
             'SAR', 10)`,
  bank_statements: `INSERT INTO bank_statements (id, tenant_id, status, cash_account_id, period_start, period_end, file_name, file_hash, adapter_id)
     VALUES ('dadadada-3000-4000-8000-000000000003', $1, 'IMPORTED', 'd1d1d1d1-0000-4000-8000-000000000002',
             '2027-02-01', '2027-02-28', 'attack.csv', repeat('c', 64), 'generic-csv')`,
  bank_statement_lines: `INSERT INTO bank_statement_lines (id, tenant_id, bank_statement_id, line_no, line_date, amount)
     VALUES ('dbdbdbdb-3000-4000-8000-000000000003', $1, 'dadadada-0000-4000-8000-000000000002',
             2, '2027-02-05', 25)`,
  // PHASE-009 tax cluster (migration 0013) — FK targets are the FOREIGN
  // tenant's own rows so the RLS WITH CHECK is the isolated rejection.
  tax_codes: `INSERT INTO tax_codes (id, tenant_id, code, name, country_code, default_treatment)
     VALUES ('e0e0e0e0-3000-4000-8000-000000000003', $1, 'ATK-INS', 'Attack Insert', 'SA', 'STANDARD_RATED')`,
  tax_registrations: `INSERT INTO tax_registrations (id, tenant_id, country_code, status, registration_number, effective_from)
     VALUES ('e1e1e1e1-3000-4000-8000-000000000003', $1, 'SA', 'REGISTERED', '300000000000009', '2026-01-01')`,
  tax_pack_bindings: `INSERT INTO tax_pack_bindings (id, tenant_id, country_code, pack_version)
     VALUES ('e2e2e2e2-3000-4000-8000-000000000003', $1, 'SA', '1.0.0-baseline')`,
  tax_document_summaries: `INSERT INTO tax_document_summaries (id, tenant_id, source_type, source_id, document_date,
        country_code, direction, treatment, rate, taxable_base, tax_amount, snapshot, tax_code_id)
     VALUES ('e3e3e3e3-3000-4000-8000-000000000003', $1, 'iso_fixture', $1, '2027-02-01', 'SA',
        'INPUT', 'STANDARD_RATED', 15.0000, 100, 15, '{"treatment":"STANDARD_RATED"}'::jsonb,
        'e0e0e0e0-0000-4000-8000-000000000002')`,
  vat_returns: `INSERT INTO vat_returns (id, tenant_id, country_code, period_start, period_end, summary, cross_check)
     VALUES ('e4e4e4e4-3000-4000-8000-000000000003', $1, 'SA', '2027-02-01', '2027-02-28', '{}'::jsonb, '{}'::jsonb)`,
  e_invoicing_submissions: `INSERT INTO e_invoicing_submissions (id, tenant_id, country_code, adapter_id, source_type, source_id, status)
     VALUES ('e5e5e5e5-3000-4000-8000-000000000003', $1, 'SA', 'fake', 'iso_fixture', $1, 'PENDING')`,
  // PHASE-010 inventory cluster (migrations 0014/0015) — warehouse refs
  // point at the FOREIGN tenant's own fixture rows so the RLS WITH CHECK
  // is the only failing constraint (FKs would otherwise fire first).
  warehouses: `INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
     VALUES ('f0f0f0f0-3000-4000-8000-000000000003', $1,
             'abababab-0000-4000-8000-000000000002', 'ATK', 'Attack WH')`,
  item_warehouse_settings: `INSERT INTO item_warehouse_settings (id, tenant_id, item_id, warehouse_id, reorder_level, min_qty)
     VALUES ('f1f1f1f1-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', 5, 2)`,
  stock_moves: `INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost, value_amount, source_type, source_id, moved_at)
     VALUES ('f4f4f4f4-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', 'IN', 'receipt', 10, 2.5, 25,
             'manual_receipt', 'f4f4f4f4-3000-4000-8000-000000000003', '2027-01-05')`,
  stock_layers: `INSERT INTO stock_layers (id, tenant_id, item_id, warehouse_id, remaining_qty, unit_cost, source_move_id, received_at)
     VALUES ('f5f5f5f5-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', 10, 2.5,
             'f4f4f4f4-3000-4000-8000-000000000003', '2027-01-05')`,
  item_stock: `INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
     VALUES ('f6f6f6f6-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', 10, 2.5)`,
  stock_transfers: `INSERT INTO stock_transfers (id, tenant_id, from_warehouse_id, to_warehouse_id, status)
     VALUES ('f7f7f7f7-3000-4000-8000-000000000003', $1, 'f0f0f0f0-1000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', 'DRAFT')`,
  stock_transfer_lines: `INSERT INTO stock_transfer_lines (id, tenant_id, transfer_id, line_no, item_id, qty)
     VALUES ('f8f8f8f8-3000-4000-8000-000000000003', $1, 'f7f7f7f7-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 4)`,
  stock_adjustments: `INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, item_id, reason, delta_qty)
     VALUES ('f9f9f9f9-3000-4000-8000-000000000003', $1, 'f0f0f0f0-2000-4000-8000-000000000002',
             'babababa-0000-4000-8000-000000000002', 'DAMAGE', -1)`,
  stock_reservations: `INSERT INTO stock_reservations (id, tenant_id, item_id, warehouse_id, qty, holder_type)
     VALUES ('fafafafa-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', 2, 'MANUAL')`,
  item_batches: `INSERT INTO item_batches (id, tenant_id, item_id, batch_no)
     VALUES ('f2f2f2f2-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002', 'ATK-B')`,
  item_serials: `INSERT INTO item_serials (id, tenant_id, item_id, serial_no)
     VALUES ('f3f3f3f3-3000-4000-8000-000000000003', $1, 'babababa-0000-4000-8000-000000000002', 'ATK-SN')`,
  stock_counts: `INSERT INTO stock_counts (id, tenant_id, warehouse_id, status, snapshot_at)
     VALUES ('fbfbfbfb-3000-4000-8000-000000000003', $1, 'f0f0f0f0-2000-4000-8000-000000000002',
             'DRAFT', '2027-01-10T09:00:00Z')`,
  stock_count_lines: `INSERT INTO stock_count_lines (id, tenant_id, stock_count_id, line_no, item_id, batch_id, system_qty)
     VALUES ('fcfcfcfc-3000-4000-8000-000000000003', $1, 'fbfbfbfb-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000002', 10)`,
  // PHASE-011 purchasing cluster (migrations 0016/0017) — FK targets are
  // the FOREIGN tenant's own fixture rows so the RLS WITH CHECK is the
  // isolated rejection.
  purchase_requests: `INSERT INTO purchase_requests (id, tenant_id, branch_id, status)
     VALUES ('5a5a5a5a-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002', 'DRAFT')`,
  purchase_request_lines: `INSERT INTO purchase_request_lines (id, tenant_id, request_id, line_no, item_id, qty)
     VALUES ('5b5b5b5b-3000-4000-8000-000000000003', $1, '5a5a5a5a-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5)`,
  purchase_orders: `INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, order_date, currency_code, status)
     VALUES ('5c5c5c5c-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', '2027-02-01', 'SAR', 'DRAFT')`,
  purchase_order_lines: `INSERT INTO purchase_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES ('5d5d5d5d-3000-4000-8000-000000000003', $1, '5c5c5c5c-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)`,
  goods_receipts: `INSERT INTO goods_receipts (id, tenant_id, branch_id, supplier_id, po_id, warehouse_id, receipt_date, status)
     VALUES ('5e5e5e5e-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', '5c5c5c5c-0000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', '2027-02-05', 'DRAFT')`,
  goods_receipt_lines: `INSERT INTO goods_receipt_lines (id, tenant_id, receipt_id, line_no, item_id, qty, unit_cost, value_amount)
     VALUES ('5f5f5f5f-3000-4000-8000-000000000003', $1, '5e5e5e5e-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)`,
  supplier_invoices: `INSERT INTO supplier_invoices (id, tenant_id, branch_id, supplier_id, invoice_no, invoice_date, due_date, currency_code, status)
     VALUES ('60606060-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'ATK-001', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT')`,
  supplier_invoice_lines: `INSERT INTO supplier_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES ('61616161-3000-4000-8000-000000000003', $1, '60606060-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)`,
  debit_notes: `INSERT INTO debit_notes (id, tenant_id, branch_id, supplier_id, ref_invoice_id, note_date, currency_code, status)
     VALUES ('62626262-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', '60606060-0000-4000-8000-000000000002', '2027-02-15', 'SAR', 'DRAFT')`,
  debit_note_lines: `INSERT INTO debit_note_lines (id, tenant_id, note_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES ('63636363-3000-4000-8000-000000000003', $1, '62626262-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 1, 1, 1)`,
  landed_costs: `INSERT INTO landed_costs (id, tenant_id, grn_id, cost_type, amount, allocation_method, charge_account_id, status)
     VALUES ('64646464-3000-4000-8000-000000000003', $1, '5e5e5e5e-0000-4000-8000-000000000002',
             'freight', 2, 'VALUE', 'b0b0b0b0-0000-4000-8000-000000000002', 'DRAFT')`,
  landed_cost_allocations: `INSERT INTO landed_cost_allocations (id, tenant_id, landed_cost_id, grn_line_id, item_id, warehouse_id, qty_at_allocation, remaining_qty, allocated_amount)
     VALUES ('65656565-3000-4000-8000-000000000003', $1, '64646464-0000-4000-8000-000000000002',
             '5f5f5f5f-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
             'f0f0f0f0-2000-4000-8000-000000000002', 5, 5, 2)`,
  purchase_reallocations: `INSERT INTO purchase_reallocations (id, tenant_id, doc_no, payment_id, supplier_id, reason, total_amount)
     VALUES ('66666666-3000-4000-8000-000000000003', $1, 'RAL-ATK-1', 'd4d4d4d4-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'attack re-allocation', 1)`,
  purchase_reallocation_lines: `INSERT INTO purchase_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
     VALUES ('67676767-3000-4000-8000-000000000003', $1, '66666666-0000-4000-8000-000000000002', 2,
             'cececece-0000-4000-8000-000000000002', 1)`,
  // PHASE-012 sales cluster (migrations 0018/0019) — FK targets are the
  // FOREIGN tenant's own fixture rows so the RLS WITH CHECK is the
  // isolated rejection.
  sales_reps: `INSERT INTO sales_reps (id, tenant_id, code, name, status)
     VALUES ('70707070-3000-4000-8000-000000000003', $1, 'ATK-REP', 'Attack Rep', 'ACTIVE')`,
  quotations: `INSERT INTO quotations (id, tenant_id, branch_id, customer_id, quote_date, valid_until, currency_code, status)
     VALUES ('71717171-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', '2027-02-01', '2027-03-03', 'SAR', 'DRAFT')`,
  quotation_lines: `INSERT INTO quotation_lines (id, tenant_id, quotation_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES ('72727272-3000-4000-8000-000000000003', $1, '71717171-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)`,
  sales_orders: `INSERT INTO sales_orders (id, tenant_id, branch_id, customer_id, warehouse_id, order_date, currency_code, status)
     VALUES ('73737373-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
             '2027-02-02', 'SAR', 'DRAFT')`,
  sales_order_lines: `INSERT INTO sales_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES ('74747474-3000-4000-8000-000000000003', $1, '73737373-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)`,
  delivery_notes: `INSERT INTO delivery_notes (id, tenant_id, branch_id, customer_id, warehouse_id, delivery_date, currency_code, status)
     VALUES ('75757575-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002',
             '2027-02-05', 'SAR', 'DRAFT')`,
  delivery_note_lines: `INSERT INTO delivery_note_lines (id, tenant_id, delivery_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES ('76767676-3000-4000-8000-000000000003', $1, '75757575-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)`,
  sales_invoices: `INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_date, due_date, currency_code, status)
     VALUES ('77777777-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'CREDIT', '2027-02-10', '2027-03-12', 'SAR', 'DRAFT')`,
  sales_invoice_lines: `INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, qty, unit_price, net_amount)
     VALUES ('78787878-3000-4000-8000-000000000003', $1, '77777777-0000-4000-8000-000000000002', 2,
             'babababa-0000-4000-8000-000000000002', 5, 2.5, 12.5)`,
  credit_notes: `INSERT INTO credit_notes (id, tenant_id, branch_id, customer_id, invoice_id, note_date, currency_code, status)
     VALUES ('79797979-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', '77777777-0000-4000-8000-000000000002',
             '2027-02-15', 'SAR', 'DRAFT')`,
  credit_note_lines: `INSERT INTO credit_note_lines (id, tenant_id, note_id, line_no, invoice_line_id, item_id, qty, unit_price, net_amount)
     VALUES ('7a7a7a7a-3000-4000-8000-000000000003', $1, '79797979-0000-4000-8000-000000000002', 2,
             '78787878-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 1, 1, 1)`,
  sales_reallocations: `INSERT INTO sales_reallocations (id, tenant_id, doc_no, receipt_id, customer_id, reason, total_amount)
     VALUES ('7b7b7b7b-3000-4000-8000-000000000003', $1, 'SRAL-ATK-1', 'd3d3d3d3-0000-4000-8000-000000000002',
             'b5b5b5b5-0000-4000-8000-000000000002', 'attack sales re-allocation', 1)`,
  sales_reallocation_lines: `INSERT INTO sales_reallocation_lines (id, tenant_id, reallocation_id, line_no, to_open_item_id, amount)
     VALUES ('7c7c7c7c-3000-4000-8000-000000000003', $1, '7b7b7b7b-0000-4000-8000-000000000002', 2,
             'cececece-0000-4000-8000-000000000002', 1)`,
  // PHASE-013 reporting cluster (migration 0020) — the attack rows carry
  // distinct params_hash / template keys so the RLS WITH CHECK is the
  // isolated rejection, never the (tenant, key) unique constraint.
  report_runs: `INSERT INTO report_runs (id, tenant_id, report_key, contract_version, params,
                                      params_hash, execution_class, status)
     VALUES ('7d7d7d7d-3000-4000-8000-000000000003', $1, 'financial.trial-balance', 1,
             '{"locale": "ar"}'::jsonb, 'iso-attack', 'inline', 'QUEUED')`,
  print_templates: `INSERT INTO print_templates (id, tenant_id, key, version, locale_variants)
     VALUES ('7e7e7e7e-3000-4000-8000-000000000003', $1, 'receipt-58', 1, '{"ar": 1}'::jsonb)`,
  subscription_invoices: `INSERT INTO subscription_invoices (
       id, tenant_id, subscription_id, number, plan_key, period_start, period_end,
       amount, currency_code, status, source, due_date, placeholder_price)
     VALUES ('71717171-3000-4000-8000-000000000003', $1,
       'adadadad-0000-4000-8000-000000000002', 'BI-2026-0099', 'business',
       '2026-01-01', '2026-01-31', '0.0000', 'SAR', 'OPEN', 'checkout', '2026-01-08', true)`,
  billing_events: `INSERT INTO billing_events (id, tenant_id, type, payload, idempotency_key)
     VALUES ('72727272-3000-4000-8000-000000000003', $1, 'trial.started', '{}'::jsonb, 'iso-attack-1')`,
  usage_counters: `INSERT INTO usage_counters (id, tenant_id, counter_key, period, value)
     VALUES ('73737373-3000-4000-8000-000000000003', $1, 'documents_per_month', '2026-01', 5)`,
  notifications: `INSERT INTO notifications (id, tenant_id, category, severity, title, body)
     VALUES ('74747474-3000-4000-8000-000000000003', $1, 'subscription', 'info',
       '{"ar":"س","en":"S"}'::jsonb, '{"ar":"ب","en":"B"}'::jsonb)`,
  notification_prefs: `INSERT INTO notification_prefs (id, tenant_id, user_id, category, in_app, email)
     VALUES ('75757575-3000-4000-8000-000000000003', $1,
       'eeeeeeee-0000-4000-8000-000000000001', 'limits', true, true)`,
  tenant_industry_config: `INSERT INTO tenant_industry_config (
       id, tenant_id, template_key, applied_version, applied_manifest_hash)
     VALUES ('76767676-3000-4000-8000-000000000003', $1, 'industry.grocery', '1.0.0', 'iso-attack')`,
  item_components: `INSERT INTO item_components (id, tenant_id, composite_item_id, component_item_id, qty)
     VALUES ('77777777-3000-4000-8000-000000000003', $1,
       'babababa-0000-4000-8000-000000000002', '1f1f1f1f-0000-4000-8000-000000000002', 1)`,
  // PHASE-016 POS cluster (migration 0024).
  pos_terminals: `INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id)
     VALUES ('78787878-3000-4000-8000-000000000003', $1, 'ISO-ATK', 'Attack Terminal',
       'abababab-0000-4000-8000-000000000002', 'b0b0b0b0-0000-4000-8000-000000000002')`,
  pos_tables: `INSERT INTO pos_tables (id, tenant_id, branch_id, zone, label)
     VALUES ('79797979-3000-4000-8000-000000000003', $1,
       'abababab-0000-4000-8000-000000000002', 'MAIN', 'ATK')`,
  pos_checks: `INSERT INTO pos_checks (id, tenant_id, branch_id, check_no)
     VALUES ('7a7a7a7a-3000-4000-8000-000000000003', $1,
       'abababab-0000-4000-8000-000000000002', 'ISO-ATK')`,
  pos_kitchen_tickets: `INSERT INTO pos_kitchen_tickets (id, tenant_id, check_id, ticket_no)
     VALUES ('7b7b7b7b-3000-4000-8000-000000000003', $1,
       '24242424-0000-4000-8000-000000000002', 'KT-ATK')`,
  change_log: `INSERT INTO change_log (tenant_id, entity_type, entity_id, op)
     VALUES ($1, 'items', 'iso-attack-row', 'UPSERT')`,
  sync_cursors: `INSERT INTO sync_cursors (id, tenant_id, device_id, entity_type, last_seq)
     VALUES ('7c7c7c7c-3000-4000-8000-000000000003', $1,
       'dddddddd-0000-4000-8000-000000000002', 'items', 1)`,
  tombstones: `INSERT INTO tombstones (id, tenant_id, entity_type, entity_id, deleted_at, gc_after)
     VALUES ('3c3c3c3c-0000-4000-8000-000000000003', $1, 'items',
       '3c3c3c3c-0000-4000-8000-00000000aa03', now(), now() + interval '90 days')`,
  inbox_commands: `INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
                                              entity_type, intent, status, result, processed_at)
     VALUES ('3d3d3d3d-0000-4000-8000-000000000003', $1, 'dddddddd-0000-4000-8000-000000000002',
       'iso-attack-inbox-cmd', 'iso-attack-inbox-key', 'pos_sale', 'create', 'REJECTED',
       '{}'::jsonb, now())`,
  // PHASE-017 automotive & distribution cluster (migration 0025).
  vehicles: `INSERT INTO vehicles (id, tenant_id, partner_id, make, model)
     VALUES ('7d7d7d7d-3000-4000-8000-000000000003', $1,
       'b5b5b5b5-0000-4000-8000-000000000002', 'Attack', 'Make')`,
  job_cards: `INSERT INTO job_cards (id, tenant_id, branch_id, card_no, customer_id, warehouse_id)
     VALUES ('7e7e7e7e-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
       'JC-ATK', 'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002')`,
  job_card_lines: `INSERT INTO job_card_lines (id, tenant_id, job_card_id, line_no, line_type, item_id, qty)
     VALUES ('7f7f7f7f-3000-4000-8000-000000000003', $1,
       '28282828-0000-4000-8000-000000000002', 9, 'PARTS',
       'babababa-0000-4000-8000-000000000002', 1)`,
  customer_tiers: `INSERT INTO customer_tiers (id, tenant_id, code, name)
     VALUES ('80808080-3000-4000-8000-000000000003', $1, 'ISO-ATK-TIER', 'Attack Tier')`,
  free_goods_rules: `INSERT INTO free_goods_rules (id, tenant_id, code, name, buy_item_id, buy_qty,
                                     get_item_id, get_qty, reason_code)
     VALUES ('81818181-3000-4000-8000-000000000003', $1, 'ISO-ATK-FOC', 'Attack FOC',
       'babababa-0000-4000-8000-000000000002', 10,
       'babababa-0000-4000-8000-000000000002', 1, 'ISO-ATK')`,
  routes: `INSERT INTO routes (id, tenant_id, code, name)
     VALUES ('82828282-3000-4000-8000-000000000003', $1, 'ISO-ATK-RT', 'Attack Route')`,
  route_customers: `INSERT INTO route_customers (id, tenant_id, route_id, customer_id, visit_order)
     VALUES ('83838383-3000-4000-8000-000000000003', $1,
       '2c2c2c2c-0000-4000-8000-000000000002', 'b5b5b5b5-0000-4000-8000-000000000002', 9)`,
  route_visits: `INSERT INTO route_visits (id, tenant_id, route_id, customer_id, planned_date, status)
     VALUES ('84848484-3000-4000-8000-000000000003', $1,
       '2c2c2c2c-0000-4000-8000-000000000002', 'b5b5b5b5-0000-4000-8000-000000000002',
       '2026-02-03', 'PLANNED')`,
  van_stocks: `INSERT INTO van_stocks (id, tenant_id, warehouse_id, item_id, qty, value)
     VALUES ('85858585-3000-4000-8000-000000000003', $1,
       'f0f0f0f0-2000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002', 1, 10)`,
  rep_settlements: `INSERT INTO rep_settlements (id, tenant_id, settlement_no, sales_rep_id,
                                    settlement_date, status)
     VALUES ('86868686-3000-4000-8000-000000000003', $1, 'STL-ATK',
       '70707070-0000-4000-8000-000000000002', '2026-02-03', 'DRAFT')`,
  rep_settlement_lines: `INSERT INTO rep_settlement_lines (id, tenant_id, settlement_id, line_no,
                                          component, amount)
     VALUES ('87878787-3000-4000-8000-000000000003', $1,
       '30303030-0000-4000-8000-000000000002', 9, 'OPENING_CASH', 0)`,
  commission_runs: `INSERT INTO commission_runs (id, tenant_id, period_from, period_to, basis)
     VALUES ('88888888-3000-4000-8000-000000000003', $1, '2026-03-01', '2026-03-31', 'INVOICED')`,
  commission_run_lines: `INSERT INTO commission_run_lines (id, tenant_id, run_id, sales_rep_id,
                                            base_amount, rate_applied, commission_amount)
     VALUES ('89898989-3000-4000-8000-000000000003', $1,
       '32323232-0000-4000-8000-000000000002', '70707070-0000-4000-8000-000000000002',
       100, 1, 1)`,
  // PHASE-018 manufacturing cluster (migration 0026) — FK targets are the
  // FOREIGN tenant's own fixture rows so the RLS WITH CHECK is the isolated
  // rejection (line_no/version_no 9 avoid the sibling fixtures' uniques).
  bills_of_materials: `INSERT INTO bills_of_materials (id, tenant_id, item_id, version_no, status,
                                          output_uom_id, yield_pct)
     VALUES ('8a8a8a8a-3000-4000-8000-000000000003', $1,
       'babababa-0000-4000-8000-000000000002', 9, 'DRAFT',
       'b2b2b2b2-0000-4000-8000-000000000002', 100)`,
  bom_lines: `INSERT INTO bom_lines (id, tenant_id, bom_id, line_no, component_item_id, uom_id,
                          qty_per_output, scrap_pct)
     VALUES ('8b8b8b8b-3000-4000-8000-000000000003', $1,
       '34343434-0000-4000-8000-000000000002', 9, 'babababa-0000-4000-8000-000000000002',
       'b2b2b2b2-0000-4000-8000-000000000002', 1, 0)`,
  production_orders: `INSERT INTO production_orders (id, tenant_id, branch_id, status, bom_id, item_id,
                                       uom_id, planned_qty, materials_warehouse_id,
                                       fg_warehouse_id)
     VALUES ('8c8c8c8c-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
       'DRAFT', '34343434-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
       'b2b2b2b2-0000-4000-8000-000000000002', 10,
       'f0f0f0f0-1000-4000-8000-000000000002', 'f0f0f0f0-2000-4000-8000-000000000002')`,
  production_order_lines: `INSERT INTO production_order_lines (id, tenant_id, order_id, line_no,
                                            component_item_id, uom_id, planned_qty)
     VALUES ('8d8d8d8d-3000-4000-8000-000000000003', $1,
       '36363636-0000-4000-8000-000000000002', 9, 'babababa-0000-4000-8000-000000000002',
       'b2b2b2b2-0000-4000-8000-000000000002', 1)`,
  production_consumptions: `INSERT INTO production_consumptions (id, tenant_id, order_id, item_id,
                                            qty, unit_cost, value, consumed_at)
     VALUES ('8e8e8e8e-3000-4000-8000-000000000003', $1,
       '36363636-0000-4000-8000-000000000002', 'babababa-0000-4000-8000-000000000002',
       1, 2.5, 2.5, now())`,
  production_scraps: `INSERT INTO production_scraps (id, tenant_id, order_id, reason_code, qty,
                                     value, scrapped_at)
     VALUES ('8f8f8f8f-3000-4000-8000-000000000003', $1,
       '36363636-0000-4000-8000-000000000002', 'ISO-ATK', 1, 2.5, now())`,
  inspections: `INSERT INTO inspections (id, tenant_id, target_type, order_id, result, inspected_at)
     VALUES ('90909090-3000-4000-8000-000000000003', $1, 'production_order',
       '36363636-0000-4000-8000-000000000002', 'PASS', now())`,
  // PHASE-019 crm/service-billing cluster (migration 0027) — FK targets are
  // the FOREIGN tenant's own fixture rows so the RLS WITH CHECK is the
  // isolated rejection (period keys/line numbers 9 avoid the sibling
  // fixtures' uniques; contract_invoices keeps period_key NULL so the
  // schedule fixture's partial unique is untouched).
  projects: `INSERT INTO projects (id, tenant_id, code, name, status)
     VALUES ('91919191-3000-4000-8000-000000000003', $1, 'ATK', 'Attack Project', 'OPEN')`,
  leads: `INSERT INTO leads (id, tenant_id, name, source, status)
     VALUES ('92929292-3000-4000-8000-000000000003', $1, 'Attack Lead', 'CALL', 'NEW')`,
  crm_tasks: `INSERT INTO crm_tasks (id, tenant_id, title, related_type, related_id, status)
     VALUES ('93939393-3000-4000-8000-000000000003', $1, 'Attack Task', 'LEAD',
       '91919191-0000-4000-8000-000000000002', 'OPEN')`,
  crm_activities: `INSERT INTO crm_activities (id, tenant_id, kind, related_type, related_id,
                                    occurred_at, summary)
     VALUES ('94949494-3000-4000-8000-000000000003', $1, 'NOTE', 'LEAD',
       '91919191-0000-4000-8000-000000000002', now(), 'Attack Activity')`,
  service_contracts: `INSERT INTO service_contracts (id, tenant_id, partner_id, title, fee_model,
                                        start_date, end_date, monthly_amount,
                                        currency_code, status)
     VALUES ('95959595-3000-4000-8000-000000000003', $1, 'b5b5b5b5-0000-4000-8000-000000000002',
       'Attack Contract', 'RETAINER', '2027-01-01', '2027-06-30', 100, 'SAR', 'DRAFT')`,
  contract_billing_schedule: `INSERT INTO contract_billing_schedule (id, tenant_id, contract_id,
                                              entry_type, period_key, period_start,
                                              period_end, bill_date, amount,
                                              fee_item_id, status)
     VALUES ('96969696-3000-4000-8000-000000000003', $1, '94949494-0000-4000-8000-000000000002',
       'RETAINER_PERIOD', '2027-09', '2027-09-01', '2027-09-30', '2027-09-01', 100,
       'babababa-0000-4000-8000-000000000002', 'PLANNED')`,
  contract_invoices: `INSERT INTO contract_invoices (id, tenant_id, contract_id, invoice_id, status)
     VALUES ('97979797-3000-4000-8000-000000000003', $1, '94949494-0000-4000-8000-000000000002',
       '77777777-0000-4000-8000-000000000002', 'GENERATED')`,
  contract_advances: `INSERT INTO contract_advances (id, tenant_id, contract_id, receipt_id,
                                        amount, status)
     VALUES ('98989898-3000-4000-8000-000000000003', $1, '94949494-0000-4000-8000-000000000002',
       'd3d3d3d3-0000-4000-8000-000000000002', 25, 'HELD')`,
  service_orders: `INSERT INTO service_orders (id, tenant_id, branch_id, partner_id, warehouse_id,
                                  status)
     VALUES ('99999999-3000-4000-8000-000000000003', $1, 'abababab-0000-4000-8000-000000000002',
       'b5b5b5b5-0000-4000-8000-000000000002', 'f0f0f0f0-1000-4000-8000-000000000002', 'DRAFT')`,
  service_order_lines: `INSERT INTO service_order_lines (id, tenant_id, order_id, line_no, line_type,
                                        item_id, estimated_hours, unit_price, qty, status)
     VALUES ('a0a0a0a0-3000-4000-8000-000000000003', $1, '98989898-0000-4000-8000-000000000002',
       9, 'SERVICE', 'babababa-0000-4000-8000-000000000002', 3, 150, 1, 'PENDING')`,
  crm_time_entries: `INSERT INTO crm_time_entries (id, tenant_id, entry_date, hours, fee_item_id,
                                   project_id, contract_id, unit_rate, narrative,
                                   billable, status)
     VALUES ('a1a1a1a1-3000-4000-8000-000000000003', $1, '2027-02-03', 1,
       'babababa-0000-4000-8000-000000000002', 'a1a1a1a1-0000-4000-8000-000000000002',
       '94949494-0000-4000-8000-000000000002', 250, 'Attack entry', true, 'DRAFT')`,
  // PHASE-023 external-integrations cluster (migration 0035) — FK targets
  // are the FOREIGN tenant's own rows (the certificate, the statement) so
  // the RLS WITH CHECK stays the isolated rejection; unique shapes
  // (secret_path, provider_ref, natural keys) use fresh attack values.
  e_invoicing_certificates: `INSERT INTO e_invoicing_certificates (id, tenant_id, country_code,
        adapter_id, label, key_version, secret_path, fingerprint, not_before, not_after, status)
     VALUES ('a2a2a2a2-3000-4000-8000-000000000003', $1, 'SA', 'fake', 'Attack insert',
       'k1', 'einvoicing/SA/iso-attack', 'fp-atk', '2026-01-01', '2027-01-01', 'ACTIVE')`,
  e_invoicing_certificate_usage: `INSERT INTO e_invoicing_certificate_usage (id, tenant_id,
        certificate_id, operation, key_version)
     VALUES ('a3a3a3a3-3000-4000-8000-000000000003', $1,
       'a2a2a2a2-0000-4000-8000-000000000002', 'SIGN', 'k1')`,
  e_invoicing_adapter_settings: `INSERT INTO e_invoicing_adapter_settings (id, tenant_id,
        adapter_id, country_code, enabled)
     VALUES ('a4a4a4a4-3000-4000-8000-000000000003', $1, 'fake-attack', 'SA', false)`,
  bank_statement_parked_lines: `INSERT INTO bank_statement_parked_lines (id, tenant_id, statement_id,
        line_index, raw_cells, raw_line, parked_reason, status)
     VALUES ('a5a5a5a5-3000-4000-8000-000000000003', $1, 'dadadada-0000-4000-8000-000000000002',
       9, '["x"]'::jsonb, 'attack row', 'attack insert', 'PARKED')`,
  commerce_channel_orders: `INSERT INTO commerce_channel_orders (id, tenant_id, channel_adapter_id,
        channel_order_id, payload, status)
     VALUES ('a6a6a6a6-3000-4000-8000-000000000003', $1, 'fake-shop', 'attack-1',
       '{}'::jsonb, 'IMPORTED')`,
  commerce_channel_imports: `INSERT INTO commerce_channel_imports (id, tenant_id, channel_adapter_id,
        batch_key, status)
     VALUES ('a7a7a7a7-3000-4000-8000-000000000003', $1, 'fake-shop', 'attack-batch', 'COMPLETED')`,
  billing_payouts: `INSERT INTO billing_payouts (id, tenant_id, provider_id, provider_ref,
        period_start, period_end, gross_amount, fee_amount, net_amount, currency_code, status)
     VALUES ('a8a8a8a8-3000-4000-8000-000000000003', $1, 'sandbox', 'po_iso_attack', '2027-01-01',
       '2027-01-31', 100, 1, 99, 'SAR', 'PENDING')`,
  // PHASE-024 (migration 0036): the offboarding flow row (REQUESTED — the
  // requested_by FK is the attacker tenant's own user so the RLS WITH
  // CHECK stays the isolated rejection).
  tenant_offboarding: `INSERT INTO tenant_offboarding (id, tenant_id, status, requested_by)
     VALUES ('a9a9a9a9-3000-4000-8000-000000000003', $1, 'REQUESTED',
       'eeeeeeee-0000-4000-8000-000000000001')`,
  // PHASE-026 (migration 0037): the fixed-assets cluster. FK columns point
  // at the ATTACKER tenant's (B's) own isolation fixtures so the composite
  // tenant FKs stay satisfied and the RLS WITH CHECK is the isolated
  // rejection (the partners pattern — foreign tenant id, own-tenant refs).
  asset_categories: `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, depreciation_method_default, asset_purpose_key,
        accum_depreciation_purpose_key, expense_purpose_key)
     VALUES ('fa0a0a0a-3000-4000-8000-000000000003', $1, 'ATK-FA', 'Attack Category', 'فئة هجوم',
       36, 'STRAIGHT_LINE', 'FIXED_ASSET', 'ACCUM_DEPRECIATION', 'DEPRECIATION_EXPENSE')`,
  assets: `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id,
        acquisition_date, cost, salvage_value, opening_accumulated, useful_life_months,
        depreciation_method, branch_id, status)
     VALUES ('fa1a1a1a-3000-4000-8000-000000000003', $1, 'ATK-ASSET', 'Attack Asset', 'أصل هجوم',
       'fa0a0a0a-0000-4000-8000-000000000002', '2026-01-15', 12000, 0, 0, 60,
       'STRAIGHT_LINE', 'abababab-0000-4000-8000-000000000002', 'ACTIVE')`,
  depreciation_runs: `INSERT INTO depreciation_runs (id, tenant_id, fiscal_period_id, status,
        asset_count, total_amount)
     VALUES ('fa2a2a2a-3000-4000-8000-000000000003', $1,
       'c2c2c2c2-0000-4000-8000-000000000002', 'DRAFT', 0, 0)`,
  depreciation_lines: `INSERT INTO depreciation_lines (id, tenant_id, run_id, asset_id, line_no,
        period_amount, accumulated_amount)
     VALUES ('fa3a3a3a-3000-4000-8000-000000000003', $1,
       'fa2a2a2a-0000-4000-8000-000000000002', 'fa1a1a1a-0000-4000-8000-000000000002',
       1, 200, 200)`,
  asset_disposals: `INSERT INTO asset_disposals (id, tenant_id, asset_id, kind, disposal_date,
        proceeds, net_book_value, accumulated_snapshot, gain_loss, status)
     VALUES ('fa4a4a4a-3000-4000-8000-000000000003', $1,
       'fa1a1a1a-0000-4000-8000-000000000002', 'SCRAP', '2026-06-30',
       0, 11800, 200, -11800, 'DRAFT')`,
  asset_revaluations: `INSERT INTO asset_revaluations (id, tenant_id, asset_id, revaluation_date,
        new_gross_value, new_accumulated, delta, status, reason)
     VALUES ('fa5a5a5a-3000-4000-8000-000000000003', $1,
       'fa1a1a1a-0000-4000-8000-000000000002', '2026-06-15',
       13000, 200, 1000, 'DRAFT', 'attack fixture')`,
  // PHASE-027 (0038): FKs (partner/note/plan) point at the ATTACKER
  // tenant's (B's) own fixtures so the composite tenant FKs stay satisfied
  // and the RLS WITH CHECK is the isolated rejection.
  notes: `INSERT INTO notes (id, tenant_id, kind, direction, partner_id, number,
        issuing_bank, amount, currency, exchange_rate, issue_date, maturity_date, status)
     VALUES ('a0270271-3000-4000-8000-000000000003', $1, 'CHEQUE', 'RECEIVED',
       'b5b5b5b5-0000-4000-8000-000000000002', 'ATK-CHK', 'Attack Bank',
       500, 'SAR', 1, '2026-06-01', '2026-07-01', 'IN_CUSTODY')`,
  note_events: `INSERT INTO note_events (id, tenant_id, note_id, event_kind, event_date)
     VALUES ('b0270271-3000-4000-8000-000000000003', $1,
       'a0270271-0000-4000-8000-000000000002', 'DEPOSIT', '2026-06-20')`,
  installment_plans: `INSERT INTO installment_plans (id, tenant_id, partner_id, source_type,
        source_id, source_no, total_amount, down_payment, line_count, start_date, frequency,
        late_fee_policy, status)
     VALUES ('c0270271-3000-4000-8000-000000000003', $1,
       'b5b5b5b5-0000-4000-8000-000000000002', 'sales_invoice',
       'a0270271-0000-4000-8000-000000000002', 'ATK-INV', 12000, 2000, 10, '2026-07-01',
       'MONTHLY', '{"rate":"0.0200","cap":"500.0000","grace_days":7,"auto_charge":false,"defaulted_after_lines":3}', NULL)`,
  installment_lines: `INSERT INTO installment_lines (id, tenant_id, plan_id, seq, due_date, amount, status)
     VALUES ('d0270271-3000-4000-8000-000000000003', $1,
       'c0270271-0000-4000-8000-000000000002', 1, '2026-08-01', 1000, 'PENDING')`,
  // PHASE-028 (0039): the budgeting cluster — FKs reference tenant B's own
  // fixtures (fiscal year c1c1c1c1…2, period c2c2c2c2…2, account b0b0b0b0…2,
  // budget e0280281…2) so the composite tenant FKs stay satisfied and the
  // RLS WITH CHECK is the isolated rejection.
  budgets: `INSERT INTO budgets (id, tenant_id, code, fiscal_year_id, scope, name, name_ar,
        revision_no, status)
     VALUES ('e0280281-3000-4000-8000-000000000003', $1, 'BUD-2026-2',
       'c1c1c1c1-0000-4000-8000-000000000002', 'ACCOUNTS', 'Attack budget',
       'موازنة هجوم', 1, 'DRAFT')`,
  budget_lines: `INSERT INTO budget_lines (id, tenant_id, budget_id, fiscal_period_id, account_id, amount)
     VALUES ('f0280281-3000-4000-8000-000000000003', $1,
       'e0280281-0000-4000-8000-000000000002',
       'c2c2c2c2-0000-4000-8000-000000000002',
       'b0b0b0b0-0000-4000-8000-000000000002', 1000)`,
  // PHASE-029 (0040): the payroll cluster — FKs reference tenant B's own
  // fixtures (structure a0290291…2, employee c0290291…2, run d0290291…2,
  // loan f0290291…2, period c2c2c2c2…2, account b0b0b0b0…2) so the
  // composite tenant FKs stay satisfied and the RLS WITH CHECK is the
  // isolated rejection.
  salary_structures: `INSERT INTO salary_structures (id, tenant_id, code, name, currency, status)
     VALUES ('a0290291-3000-4000-8000-000000000003', $1, 'ST-ATK', 'Attack structure', 'SAR', 'ACTIVE')`,
  salary_components: `INSERT INTO salary_components (id, tenant_id, structure_id, key, name, kind, calc, amount, gl_account_id, is_eos_base, seq)
     VALUES ('b0290291-3000-4000-8000-000000000003', $1, 'a0290291-0000-4000-8000-000000000002',
       'ATK', 'Attack component', 'ALLOWANCE', 'FIXED', 50, 'b0b0b0b0-0000-4000-8000-000000000002', false, 1)`,
  employees: `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, salary_structure_id, status)
     VALUES ('c0290291-3000-4000-8000-000000000003', $1, 'EMP-ATK', 'Attack Employee', '2025-01-01', 'FULL_TIME', 1000,
       'a0290291-0000-4000-8000-000000000002', 'ACTIVE')`,
  payroll_runs: `INSERT INTO payroll_runs (id, tenant_id, fiscal_period_id, status)
     VALUES ('d0290291-3000-4000-8000-000000000003', $1, 'c2c2c2c2-0000-4000-8000-000000000002', 'DRAFT')`,
  payroll_run_lines: `INSERT INTO payroll_run_lines (id, tenant_id, run_id, employee_id, component_snapshot,
        gross_amount, deductions_amount, net_amount)
     VALUES ('e0290291-3000-4000-8000-000000000003', $1, 'd0290291-0000-4000-8000-000000000002',
       'c0290291-0000-4000-8000-000000000002',
       '{"structure":{"id":"a","code":"S","name":"X"},"components":[],"loanDeductions":[],"eos":{"enabled":false,"accrual":"0"},"basicSalary":"1000"}'::jsonb,
       1000, 0, 1000)`,
  employee_loans: `INSERT INTO employee_loans (id, tenant_id, code, employee_id, amount, installments_count, start_period_id, status)
     VALUES ('f0290291-3000-4000-8000-000000000003', $1, 'LON-ATK', 'c0290291-0000-4000-8000-000000000002', 100, 1,
       'c2c2c2c2-0000-4000-8000-000000000002', 'ACTIVE')`,
  employee_loan_lines: `INSERT INTO employee_loan_lines (id, tenant_id, loan_id, fiscal_period_id, amount, status)
     VALUES ('0a290291-3000-4000-8000-000000000003', $1, 'f0290291-0000-4000-8000-000000000002',
       'c2c2c2c2-0000-4000-8000-000000000002', 100, 'PENDING')`,
};

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await seedFixtures(su);
  await su.end();
});

describe("registry completeness (negative proof — new tenant table must register)", () => {
  it("every public table with a tenant_id column is registered", async () => {
    const su = await superuserClient();
    const tables = await su.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    const inDb = tables.rows.map((row) => row.table_name).sort();
    await su.end();
    expect(inDb).toEqual([...TENANT_TABLE_NAMES].sort());
  });

  it("registered names resolve to real tables (no stale registry rows)", async () => {
    const su = await superuserClient();
    const tables = await su.query<{ table_name: string }>(
      `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = new Set(tables.rows.map((row) => row.table_name));
    await su.end();
    for (const name of TENANT_TABLE_NAMES) {
      expect(names.has(name)).toBe(true);
    }
  });
});

describe("structural catalog assertions (FORCE RLS + USING/WITH CHECK)", () => {
  it("every registered table: ENABLE+FORCE RLS with the macro policy applicable to erp_app", async () => {
    const su = await superuserClient();
    const rows = await su.query<{
      tablename: string;
      rls_forced: boolean;
      usings: string | null;
      with_checks: string | null;
      applies: boolean | null;
    }>(
      `SELECT c.relname AS tablename, c.relforcerowsecurity AS rls_forced,
              (SELECT string_agg(p.qual, ' OR ') FROM pg_policies p
                WHERE p.schemaname='public' AND p.tablename=c.relname AND p.policyname='tenant_isolation') AS usings,
              (SELECT string_agg(p.with_check, ' OR ') FROM pg_policies p
                WHERE p.schemaname='public' AND p.tablename=c.relname AND p.policyname='tenant_isolation') AS with_checks,
              (SELECT bool_or('erp_app' = ANY(p.roles)) FROM pg_policies p
                WHERE p.schemaname='public' AND p.tablename=c.relname AND p.policyname='tenant_isolation') AS applies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='public' AND c.relname = ANY($1)`,
      [TENANT_TABLE_NAMES],
    );
    await su.end();
    expect(rows.rows).toHaveLength(TENANT_TABLE_NAMES.length);
    for (const row of rows.rows) {
      expect(row.rls_forced, `${row.tablename} FORCE RLS`).toBe(true);
      expect(row.applies, `${row.tablename} policy TO erp_app`).toBe(true);
      expect(row.usings, `${row.tablename} USING`).toMatch(/tenant_id = erp\.current_tenant_id\(\)/);
      expect(row.with_checks, `${row.tablename} WITH CHECK`).toMatch(
        /tenant_id = erp\.current_tenant_id\(\)/,
      );
    }
  });
});

describe("generated attack suite A1–A10 — as erp_app", () => {
  for (const table of TENANT_TABLE_NAMES) {
    const [, foreignRow] = OWN_ROW[table]!;
    // change_log has no `id` column (the bigserial seq is the PK) — its
    // probes key on entity_id; everything else is `id` (role_permissions
    // → role_id).
    const idColumn =
      table === "role_permissions" ? "role_id" : table === "change_log" ? "entity_id" : "id";

    it(`A1 ${table}: SELECT without GUC → 0 tenant rows`, async () => {
      const app = await appClient();
      const result = await app.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id IS NOT NULL`,
      );
      await app.end();
      expect(result.rows[0]?.n).toBe(0);
    });

    it(`A2 ${table}: foreign GUC never exposes this tenant's rows`, async () => {
      const app = await appClient();
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_B]);
      const own = await app.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
        [TENANT_A],
      );
      const total = await app.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id IS NOT NULL`,
      );
      await app.query("COMMIT");
      await app.end();
      expect(own.rows[0]?.n).toBe(0);
      // Only tenant B's own rows (variant tables additionally expose the
      // tenant_id IS NULL templates — never tenant A's rows).
      if (VARIANT.has(table)) {
        expect(total.rows[0]?.n).toBe(expectedRowsFor(table));
      } else {
        expect(total.rows[0]?.n).toBe(expectedRowsFor(table));
      }
    });

    it(`A3 ${table}: INSERT with mismatched tenant_id → 42501`, async () => {
      const app = await appClient();
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
      await expect(app.query(MISMATCHED_INSERT[table]!, [TENANT_B])).rejects.toMatchObject({
        code: "42501",
      });
      await app.query("ROLLBACK");
      await app.end();
    });

    it(`A4/A7 ${table}: UPDATE and id-probe under own GUC touch 0 foreign rows`, async () => {
      const app = await appClient();
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
      const probe = await app.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${idColumn} = $1`,
        [foreignRow],
      );
      if (NO_UPDATE_GRANT.has(table)) {
        // UPDATE is grant-denied (append-only tables: audit_events per
        // PHASE-002, journal_lines/partner_subledger_entries per PHASE-007
        // INV-003/INV-009, cash_movements per PHASE-008 INV-019, and
        // treasury_allocations whose sanctioned mutation is DELETE+INSERT
        // (draft replacement)): the denial itself proves the row cannot be
        // touched. Some of these carry no updated_at column — probe a real
        // column instead.
        const column =
          table === "audit_events"
            ? "action"
            : table === "cash_movements"
              ? "memo"
              : table === "treasury_allocations"
                ? "amount"
                : table === "tax_document_summaries"
                  ? "taxable_base"
                  : table === "stock_moves"
                    ? "memo"
                    : table === "purchase_reallocations"
                      ? "reason"
                      : table === "purchase_reallocation_lines"
                        ? "amount"
                        : table === "sales_reallocations"
                          ? "reason"
                          : table === "sales_reallocation_lines"
                            ? "amount"
                            : table === "billing_events"
                              ? "type"
                              : table === "change_log"
                                ? "payload"
                                : table === "inbox_commands"
                                  ? "result"
                                  : table === "e_invoicing_certificate_usage"
                                    ? "key_version"
                                    // PHASE-027 (0038): the append-only 🔒 custody log
                                    // carries NO UPDATE grant by design (the
                                    // erp.note_events_guard trigger owns the
                                    // policy below the grants) — any UPDATE is
                                    // grant-denied outright.
                                    : table === "note_events"
                                      ? "updated_at"
                                      : "updated_at";
        await expect(
          app.query(`UPDATE ${table} SET ${column} = ${column} WHERE ${idColumn} = $1`, [
            foreignRow,
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      } else if (table === "role_permissions") {
        // Association table: no UPDATE grant by design (grants change via
        // delete + insert — migration 0003) → any UPDATE is grant-denied.
        await expect(
          app.query(`UPDATE ${table} SET granted_at = granted_at WHERE role_id = $1`, [
            foreignRow,
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      } else if (table === "report_runs") {
        // Orchestration state carries no updated_at (created/started/
        // finished only — migration 0020): probe the mutable stage column.
        const touched = await app.query(
          `UPDATE report_runs SET stage = stage WHERE id = $1`,
          [foreignRow],
        );
        expect(touched.rowCount).toBe(0);
      } else if (table === "item_components") {
        // Definition lines carry no updated_at (created only — migration
        // 0022): probe the mutable qty column.
        const touched = await app.query(
          `UPDATE item_components SET qty = qty WHERE id = $1`,
          [foreignRow],
        );
        expect(touched.rowCount).toBe(0);
      } else if (table === "tombstones") {
        // PHASE-020 (migration 0029): the GC ledger carries no updated_at
        // (created + deleted_at/gc_after horizons only) — probe gc_after.
        const touched = await app.query(
          `UPDATE tombstones SET gc_after = gc_after WHERE id = $1`,
          [foreignRow],
        );
        expect(touched.rowCount).toBe(0);
      } else {
        const touched = await app.query(
          `UPDATE ${table} SET updated_at = now() WHERE id = $1`,
          [foreignRow],
        );
        expect(touched.rowCount).toBe(0);
      }
      await app.query("COMMIT");
      await app.end();
      expect(probe.rows[0]?.n).toBe(0);
    });

    it(`A5 ${table}: DELETE of the OTHER tenant's row is denied or touches 0 rows`, async () => {
      const app = await appClient();
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
      if (VARIANT.has(table) || DELETE_GRANTED.has(table)) {
        // roles/role_permissions DO carry DELETE (custom-role lifecycle,
        // migration 0003) and entitlements carry it too (the materiali-
        // zation upsert's symmetric half) — the policy confines deletes to
        // own-tenant rows, so a foreign-row DELETE affects exactly 0 rows.
        const result = await app.query(`DELETE FROM ${table} WHERE ${idColumn} = $1`, [
          foreignRow,
        ]);
        expect(result.rowCount).toBe(0);
      } else {
        // audit_events/memberships/invitations: no DELETE grant by design.
        await expect(
          app.query(`DELETE FROM ${table} WHERE ${idColumn} = $1`, [foreignRow]),
        ).rejects.toMatchObject({ code: "42501" });
      }
      await app.query("ROLLBACK");
      await app.end();
    });

    it(`A8/A9/A10 ${table}: aggregates, joins, and union/CTE shapes stay confined`, async () => {
      const app = await appClient();
      const aggregate = await app.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id IS NOT NULL`,
      );
      const joined = await app.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} t JOIN tenants x ON x.id = t.tenant_id`,
      );
      const unioned = await app.query<{ n: number }>(
        `WITH u AS (SELECT tenant_id FROM ${table} UNION ALL SELECT tenant_id FROM ${table})
         SELECT count(*)::int AS n FROM u WHERE tenant_id IS NOT NULL`,
      );
      await app.end();
      expect(aggregate.rows[0]?.n).toBe(0);
      expect(joined.rows[0]?.n).toBe(0);
      expect(unioned.rows[0]?.n).toBe(0);
    });
  }
});

describe("template guards (roles/role_permissions variant policy)", () => {
  it("erp_app can never INSERT, UPDATE, or DELETE a system-template row", async () => {
    // Each rejection runs in its OWN transaction: a denied statement aborts
    // the surrounding transaction, so a shared BEGIN would mask later codes
    // (25P02) — the same discipline as the PHASE-002 append-only proofs.
    const app = await appClient();
    const expectRejectedInTx = async (sql: string) => {
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
      try {
        await app.query(sql);
        expect.unreachable("must be rejected");
      } catch (error) {
        expect((error as { code?: string }).code).toBe("42501");
      } finally {
        await app.query("ROLLBACK");
      }
    };

    // INSERT forging a template row → WITH CHECK requires the own tenant.
    await expectRejectedInTx(
      `INSERT INTO roles (id, tenant_id, key, name, is_system)
       VALUES ('dddddddd-9999-4999-8999-999999999999', NULL, 'forged', 'Forged', true)`,
    );
    // UPDATE of a template row → WITH CHECK denies the NULL-tenant result.
    await expectRejectedInTx(
      `UPDATE roles SET name = 'HACKED' WHERE tenant_id IS NULL AND key = 'owner'`,
    );

    // DELETE attacks: the delete-guard policy makes template rows
    // INVISIBLE to the DELETE command — the statement succeeds but must
    // affect exactly 0 rows (nothing silently disappears for any tenant).
    const delApp = await appClient();
    await delApp.query("BEGIN");
    await delApp.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
    const rolesDeleted = await delApp.query(
      `DELETE FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
    );
    const grantsDeleted = await delApp.query(
      `DELETE FROM role_permissions rp
         USING roles r
        WHERE r.id = rp.role_id AND r.tenant_id IS NULL AND r.key = 'owner'`,
    );
    await delApp.query("ROLLBACK");
    await delApp.end();
    expect(rolesDeleted.rowCount).toBe(0);
    expect(grantsDeleted.rowCount).toBe(0);
  });

  it("erp_migrate CAN seed template rows (template_seed policy) — and only NULL-tenant rows", async () => {
    const su = await superuserClient();
    await su.query("SET ROLE erp_migrate");
    await su.query("BEGIN");
    await expect(
      su.query(
        `INSERT INTO roles (id, tenant_id, key, name, is_system)
         VALUES ('dddddddd-8888-4888-8888-888888888888', NULL, 'seed_probe', 'Seed Probe', true)`,
      ),
    ).resolves.toBeTruthy();
    // But erp_migrate cannot forge a TENANT row through the seed path.
    await expect(
      su.query(
        `INSERT INTO roles (id, tenant_id, key, name, is_system)
         VALUES ('dddddddd-7777-4777-8777-777777777777', $1, 'tenant_probe', 'Tenant Probe', false)`,
        [TENANT_A],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await su.query("ROLLBACK");
    await su.query("RESET ROLE");
    await su.end();
  });

  it("A6 composite FK: membership cannot reference another tenant's role", async () => {
    const su = await superuserClient();
    await expect(
      su.query(
        `INSERT INTO memberships (id, tenant_id, user_id, role_id)
         VALUES ('ffffffff-1111-4111-8111-111111111111', $1,
                 'eeeeeeee-0000-4000-8000-000000000002',
                 'dddddddd-0000-4000-8000-000000000002')`,
        [TENANT_A], // tenant A membership pointing at tenant B's role id
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await su.end();
  });
});
