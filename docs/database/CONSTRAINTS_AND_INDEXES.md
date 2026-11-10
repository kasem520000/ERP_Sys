# Constraints & Indexes — Catalog and Rules

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-11-05

Catalog of the **critical** unique constraints, check constraints, and indexes with their
purpose — the ones encoding invariants or carrying hot query paths. Naming follows
[DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §1; the exhaustive per-table list
lives in the [TABLES/](TABLES/) specs and the migrations themselves (the Drizzle schema
is the machine-readable mirror). Rule zero: **no constraint or index without a documented
purpose** — if it is not here, in a TABLES spec, or in a migration comment, it does not
ship.

## 1. Unique constraints (business rules made structural)

| Constraint | Definition | Purpose / invariant | Phase |
|------------|------------|---------------------|-------|
| `uq_journal_entries_tenant_source_op` | `UNIQUE (tenant_id, source_type, source_id, operation)` on `journal_entries` | **Posting idempotency (INV-013)**: a posting operation executes at most once per source document; retries/duplicate sync deliveries return the original result |
| `uq_journal_entries_id_tenant` | `UNIQUE (id, tenant_id)` on `journal_entries` (and every tenant-owned parent of composite FKs) | Target of composite tenant-scoped FKs ([RELATIONSHIPS.md](RELATIONSHIPS.md) §1) |
| `uq_journal_entries_tenant_entry_no` | `UNIQUE (tenant_id, entry_no)` | Official journal numbers unique per tenant (INV-021 pattern) |
| Official document numbers | `UNIQUE (tenant_id, branch_id, number)` per single-type document table (e.g., `uq_sales_invoices_tenant_branch_number`); tables spanning numbering types add `doc_type` → `(tenant_id, branch_id, doc_type, number)` | **INV-021**: official numbers unique per (tenant, type, branch), immutable once assigned; voided numbers stay reserved |
| `uq_accounts_tenant_code` | `UNIQUE (tenant_id, code)` | CoA codes unique per tenant |
| `uq_items_tenant_sku` | `UNIQUE (tenant_id, sku)` | SKU unique per tenant |
| `uq_partners_tenant_code` | `UNIQUE (tenant_id, code)` | Partner codes unique per tenant |
| `uq_branches_tenant_code`, `uq_cost_centers_tenant_code`, `uoms_tenant_code`, `expense_categories_tenant_code` | `UNIQUE (tenant_id, code)` each | Per-tenant code namespaces (DATA_DICTIONARY §12) |
| `uq_account_purposes_tenant_purpose_active` | Partial unique index on `(tenant_id, purpose_key)` `WHERE active_to IS NULL` | **One active account per purpose**; history preserved via `active_from/active_to` rows |
| `uq_exchange_rates_tenant_currency_date` | `UNIQUE (tenant_id, currency_code, rate_date)` | One rate per currency per day per tenant (INV-008 determinism) |
| `uq_users_email` / `uq_users_phone` | `UNIQUE (lower(email))` / `UNIQUE (phone)` where not null | Global identity uniqueness (one user = one login across tenants) |
| `uq_sessions_token_hash`, `uq_devices_key_hash`, `uq_invitations_token_hash` | `UNIQUE (token_hash)` / `UNIQUE (key_hash)` | Session/device/invitation tokens are lookup keys — unique doubles as the hot-path index |
| `uq_entitlements_tenant_feature` | `UNIQUE (tenant_id, feature_key)` | Entitlement materialization: one row per tenant-feature (re-materialize = upsert) |
| `uq_tenant_settings_tenant_key` | `UNIQUE (tenant_id, key)` | Typed key-value config |
| `uq_einvoicing_submissions_live` | Partial unique index on `e_invoicing_submissions (tenant_id, source_type, source_id, adapter_id)` `WHERE status IN ('PENDING','GENERATED','SIGNED','SUBMITTED','ACCEPTED','REPORTED')` | **Registry idempotency — no double clearance**: ONE LIVE row per document × adapter; `REJECTED`/`FAILED` rows stay as immutable history and resubmission appends a new row chained via `retry_of_submission_id` (0035 expand-contract replacing 009's `uq_e_invoicing_submissions_source` — no legacy rows existed, the schema was test-only) |
| `uq_e_invoicing_certificates_path` | `UNIQUE (secret_path)` on `e_invoicing_certificates` | One registry row per secret-store path (the encrypted blob is external — S-10; the path is the identity) |
| `uq_einvoicing_adapter_settings` | `UNIQUE (tenant_id, adapter_id)` on `e_invoicing_adapter_settings` | One rollout flag per adapter per tenant (default OFF — DEPLOYMENT §7) |
| `uq_bank_parked_lines_slot` | `UNIQUE (statement_id, line_index)` on `bank_statement_parked_lines` | One parking slot per statement row (the manual-mapping queue key) |
| `uq_commerce_channel_orders_natural` | `UNIQUE (tenant_id, channel_adapter_id, channel_order_id)` on `commerce_channel_orders` | The channel-order natural key (upsert identity); financial drift on re-import flags `CONFLICT` — never LWW (ADR-0012) |
| `uq_commerce_imports_batch` | `UNIQUE (tenant_id, channel_adapter_id, batch_key)` on `commerce_channel_imports` | The Idempotency-Key per import batch — a duplicate batch replays the recorded outcome without re-pulling |
| `uq_billing_payouts_ref` | `UNIQUE (provider_id, provider_ref)` on `billing_payouts` | One row per provider-reported payout batch (idempotent sync) |
| `uq_role_permissions_pk` | `UNIQUE (role_id, permission_id)` | No duplicate grants |
| `excl_fiscal_periods_no_overlap` | `EXCLUDE USING gist (fiscal_year_id WITH =, daterange(start_date, end_date, '[]') WITH &&)` | Fiscal periods inside a year never overlap ([TABLES/core-accounting.md](TABLES/core-accounting.md)) |

## 2. Check constraints (value-domain enforcement)

| Check | Definition pattern | Purpose |
|-------|--------------------|---------|
| Positive ledger amounts | `ck_journal_lines_amount_positive CHECK (amount > 0)` (and `base_amount > 0`) | Direction lives in `direction` (DATA_DICTIONARY §5); a negative ledger amount is a bug, never a credit |
| Non-negative quantities | `CHECK (qty >= 0)` on document lines and stock/count lines | Sign carried by `direction IN/OUT` (stock) or flow type (documents) |
| Negative-stock guard | Trigger on `stock_moves` raising when resulting `item_stock.qty < 0` **unless** the tenant's `allow_negative_stock` setting is enabled (partial-tenant rule → trigger + setting, not a plain CHECK) | Never silently go negative; tenant opt-in is explicit and audited |
| Direction enums | `CHECK (direction IN ('DEBIT','CREDIT'))` / `('IN','OUT')` | Value-domain from the [DATA_DICTIONARY.md](DATA_DICTIONARY.md) §9 registry |
| Status enums | `CHECK (status IN (…))` with the table's exact legal subset | §9 registry; adding a value = migration + code PR |
| Date ordering | `CHECK (start_date <= end_date)` (fiscal years/periods, price-list validity); `CHECK (invoice_date <= due_date)`; `CHECK (effective_from <= effective_to)` (rates) | Calendar sanity at the storage layer |
| Rate positivity | `CHECK (exchange_rate > 0)` on foreign-currency entries (INV-008); `CHECK (rate > 0)` on exchange_rates | Zero/negative rates are input errors |
| Price non-negativity | `CHECK (unit_price >= 0)`, `CHECK (discount >= 0)` on lines/price list items | Prices are not negative; corrections flow through credit/debit notes |
| Balanced entry (belt-and-braces) | **Engine-enforced** first (posting engine validation #7 = INV-001/002), plus a **deferrable constraint trigger** on `journal_lines` asserting Σdebit = Σcredit per entry within tolerance 0, evaluated **at transaction commit** (`CREATE CONSTRAINT TRIGGER journal_entry_balanced AFTER INSERT OR UPDATE ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();` — the function re-checks the whole parent entry). **Consolidation correction DEF-010 (adopted from Folder 4):** an immediate row-level `AFTER INSERT` trigger would fire on the *first* inserted line of a multi-line posting and abort valid transactions (a single line never balances); deferral to commit is required for correctness. PHASE-007 must ship this trigger **plus one test that bypasses the posting engine** (direct SQL insert of an unbalanced entry must fail at commit) — engine bypass must never reach the ledger | Configuration or a future bug cannot bypass the engine; the deferred trigger is the second lock, and it is commit-atomic with the posting transaction ([DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §9 pattern — same philosophy as the INV-003 immutability triggers) |
| Append-only enforcement | Guard triggers rejecting UPDATE/DELETE on `journal_entries`, `journal_lines`, `stock_moves`, `audit_events` for the app role | INV-003; RLS + grants + triggers are three layers, deliberately |
| Payout arithmetic | `ck_billing_payouts_net CHECK (net_amount = gross_amount - fee_amount)` on `billing_payouts` | The provider report's internal arithmetic holds at rest; reconciliation compares windows and REPORTS drift — it never repairs the report |
| Rollout-flag shape | `ck_einvoicing_settings_enabled_shape CHECK (enabled = false OR (enabled_by IS NOT NULL AND enabled_at IS NOT NULL))` on `e_invoicing_adapter_settings` | An enabled adapter always carries its audited enabler (the gate is additionally service-enforced: ACTIVE certificate required) |
| Certificate path/window shapes | `ck_e_invoicing_cert_path_shape CHECK (secret_path LIKE 'einvoicing/%')` + `ck_e_invoicing_cert_window CHECK (not_after > not_before)` on `e_invoicing_certificates` | Secret paths stay inside the e-invoicing namespace; validity-window sanity for the 30/14/7 expiry ladder |

## 3. RLS standard note

Every tenant-owned table — no exceptions, including small lookup tables — carries the
standard policy from [TENANT_ISOLATION.md](TENANT_ISOLATION.md) §2:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING (tenant_id = erp.current_tenant_id())
  WITH CHECK (tenant_id = erp.current_tenant_id());
```

CI asserts presence for **every** table with `tenant_id` (probe table without policy must
fail the check — PHASE-002 acceptance). Global reference tables: no `tenant_id`, no RLS,
`GRANT SELECT` only for the app role. Platform tables (`tenants`, `plans`,
`subscriptions`) use the platform-scope GUC path with audit
([TENANT_ISOLATION.md](TENANT_ISOLATION.md) §3).

## 4. Critical indexes (hot paths; every FK additionally gets an index — [DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §8 rule 1)

| Index | Definition | Serves | Phase |
|-------|------------|-------|-------|
| `ix_journal_lines_tenant_account_date` | `(tenant_id, account_id, entry_date)` | GL queries, trial balance, account statements — the hottest read path | 007 |
| `ix_journal_lines_tenant_source` | `(tenant_id, source_type, source_id)` | Source-chain drill-down (report → document); idempotency checks | 007 |
| `ix_journal_lines_tenant_partner` | `(tenant_id, partner_id)` partial `WHERE partner_id IS NOT NULL` | AR/AP subledger statements + reconciliation (INV-009) | 007 |
| `ix_stock_moves_tenant_item_wh_date` | `(tenant_id, item_id, warehouse_id, moved_at)` | Stock ledger reads, WAC recalculation, on-hand per item×warehouse | 010 |
| `ix_sales_invoices_tenant_status_date` | `(tenant_id, status, invoice_date)` partial `WHERE status = 'POSTED'` | Posted-invoice lists/aging with RLS predicate on leading column | 012 |
| `ix_<doc>_tenant_partner_date` | e.g. `(tenant_id, partner_id, invoice_date DESC)` on trade documents | Partner statement generation (DATABASE_CONVENTIONS §8 example) | 011/012 |
| Trigram name search | `gin (name gin_trgm_ops)` on `partners.name`, `items.name` (+ `name_ar` where searched) | User-facing search boxes | 006 |
| `ix_change_log_tenant_entity_seq` | `(tenant_id, entity_type, seq)` on `change_log` | Sync pull cursors (ADR-0012); cursor stall alerts read this | 020 |
| `ix_report_runs_tenant_status_created` | `(tenant_id, status, created_at)` on `report_runs` | Report queue UX ("my reports"), queue-depth monitoring | 013 |
| `ix_einvoicing_submissions_tenant_status` | `ix_e_invoicing_tenant_status (tenant_id, country_code, status)` on `e_invoicing_submissions` | Submission funnel dashboard + per-tenant registry browsing (per-document lookup rides the natural-key partial unique; never a JOIN across `source_type`/`source_id`) | 009 |
| `ix_einvoicing_submissions_retry` | `(status, next_attempt_at)` on `e_invoicing_submissions`, partial `WHERE status IN ('PENDING','GENERATED','SIGNED','SUBMITTED')` | The pg-boss retry sweep's due-row scan (only live-retry states carry `next_attempt_at`); retry chains walk `ix_einvoicing_submissions_retry_of (tenant_id, retry_of_submission_id)` | 023 |
| `ix_subscriptions_tenant_status` | `(tenant_id, status, period_end)` on `subscriptions` | Billing/dunning sweeps read PAST_DUE by `period_end` | 014 |
| `ix_receipts_tenant_partner` / `ix_payments_tenant_partner` | `(tenant_id, partner_id)` on receipt/payment allocation sources | AR/AP allocation + statement generation (INV-016 checks) | 011/012 |
| Queue hygiene | pg-boss `boss.job` state maintenance per ADR-0008 (prune completed; monitor failed/expired) | DLQ triage + retention; no extra custom indexes on queue tables before measured need | 002 |
| FK indexes (catalog-wide) | one per FK column not already leading a composite | [DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §8 rule 1; join/RESTRICT performance + pool health | all |

## 5. Composite-order discipline

`(tenant_id, <most selective>, <sort order>)` matching real queries
([DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §8): RLS prepends `tenant_id =
<const>` to every plan, so leading `tenant_id` keeps plans index-driven
([TENANT_ISOLATION.md](TENANT_ISOLATION.md) §6 — EXPLAIN tests for the top-10 hot
queries are part of CI from PHASE-002). Sort columns go last; partial predicates match
the hot subset (`WHERE status='POSTED'`, `WHERE deleted_at IS NULL`).

Partial-index patterns approved for reuse (name the subset in the migration comment):

| Pattern | Example | When |
|---------|---------|------|
| Posted-only hot subset | `… ON sales_invoices (tenant_id, partner_id, invoice_date DESC) WHERE status = 'POSTED'` | Statements/aging only ever read POSTED |
| Live-rows subset | `… ON partners (tenant_id, code) WHERE deleted_at IS NULL` | Recycle-bin tables where most queries exclude deleted |
| Nullable-FK dimension | `… ON journal_lines (tenant_id, partner_id) WHERE partner_id IS NOT NULL` | Index small when most rows lack the dimension |
| One-active-version | `… ON account_purposes (tenant_id, purpose_key) WHERE active_to IS NULL` | Uniqueness or lookup on "current" rows only |

## 6. Change procedure for constraints & indexes (expand-contract applied here)

Constraint/index changes follow the same forward-only discipline as columns
([MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md) §3):

1. **New check constraint on a hot table**: `ADD CONSTRAINT … NOT VALID` in the expand
   migration → `VALIDATE CONSTRAINT` in a follow-up step (or post-deploy job) — never a
   full-table-validation lock inside the deploy-critical path.
2. **New unique constraint on a hot table**: build the unique **index** `CONCURRENTLY`
   first, then `ADD CONSTRAINT … USING INDEX` — the constraint attaches without a second
   scan. (Exception: backfill-then-validate must prove no existing duplicates first;
   duplicates found = fix data before the migration, never `DISTINCT ON` silence.)
3. **New index on a hot table**: `CREATE INDEX CONCURRENTLY` in a declared
   non-transactional migration step ([MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md) §3
   table); the migration runner supports and records such steps.
4. **Retiring an index/constraint**: expand release documents the replacement → one
   release of grace → drop in a contract step carrying the `-- CONTRACT:` marker. Every
   drop cites the replacement that covers its workload.
5. **Tightening nullability** (`SET NOT NULL`): only after the backfill proves zero NULLs
   remain (`CHECK` preflight in the migration script) — same release discipline as column
   type changes.
6. **Loosening** (dropping a check, widening values) is an expand step but **still needs a
   decision trail**: value-domain changes touch the enum registry
   ([DATA_DICTIONARY.md](DATA_DICTIONARY.md) §9) and the TS unions in `packages/contracts`
   in the same phase.

## 7. Index-review checklist (migration reviewers)

1. **Every new FK indexed** (Postgres does not auto-index FK columns)?
2. Composite order matches a **real, named query** (comment references the feature/report)?
3. Partial predicate justified by the hot subset (`POSTED`-only, non-deleted-only)?
4. No duplicate of an existing unique constraint (§1 doubles as index)?
5. Hot table? → `CREATE INDEX CONCURRENTLY` + non-transactional migration step declared
   ([MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md) §3; [../operations/DEPLOYMENT.md](../operations/DEPLOYMENT.md) §3).
6. Purpose documented **here, in the TABLES spec, or the migration comment** (rule zero)?
7. Lock risk assessed in the migration PR for tables > 1M projected rows
   ([MIGRATION_STRATEGY.md](MIGRATION_STRATEGY.md) §5)?
8. New table: RLS policy + composite tenant FK covered (§3, [RELATIONSHIPS.md](RELATIONSHIPS.md) §1)?
9. Any **unused** index retired (drop via expand-contract, one release of grace)?
10. `pg_stat_user_indexes` scan evidence attached when replacing an existing index?
11. Constraint additions follow the §6 procedure (NOT VALID → VALIDATE; unique via
    CONCURRENT index)?
12. Enum/`CHECK` value changes mirrored in the [DATA_DICTIONARY.md](DATA_DICTIONARY.md) §9
    registry and `packages/contracts` unions in the same PR?
