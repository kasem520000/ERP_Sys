# Data Dictionary — Shared Column Semantics

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-11-11 (PHASE-038 — §17 procurement sourcing columns · PHASE-039 — §18 returns & collections vocabulary)

The semantic dictionary for **recurring columns and value sets** across all tables. It
sits between [DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) (mechanical rules:
naming, types) and the [TABLES/](TABLES/) specs (per-table columns). Every TABLES spec
and migration review assumes this file: a column with a name listed here has the meaning
defined here — **no table may redefine a dictionary term**. Types come from
[ADR-0009](../architecture/ADR/ADR-0009-money-precision.md); identifiers from
[ADR-0006](../architecture/ADR/ADR-0006-identifiers.md).

## 1. Standard columns (every tenant-owned table)

| Column | Type | Rule | Meaning |
|--------|------|------|---------|
| `id` | `uuid` | PK; app-generated **UUIDv7**; immutable | Technical identity. Time-ordered for index locality; client-generated for offline-creatable entities (ADR-0006). URLs/logs carry ids; printed documents carry official numbers. |
| `tenant_id` | `uuid` | `NOT NULL`; FK → `tenants(id)`; leading column of hot indexes; RLS anchor | Owning tenant. Global reference tables (currencies, permissions, jurisdictions) deliberately lack it ([TENANT_ISOLATION.md](TENANT_ISOLATION.md) §3). |
| `version` | `int` | `NOT NULL DEFAULT 1`; incremented on every update | Optimistic concurrency; mutating API routes enforce `If-Match` ([DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §5). |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row creation time (UTC stored; display per tenant/user TZ). |
| `updated_at` | `timestamptz` | `NOT NULL`; app- or trigger-maintained | Last mutation. On append-only tables (🔒 in the catalog) it exists for convention but never changes — no UPDATE grants exist (INV-003). |
| `created_by` | `uuid` | NULL for system/platform actions | Acting user (resolved via memberships). Null on job-generated rows **and** platform-scope writes; both cases are distinguishable in `audit_events`. |
| `deleted_at` | `timestamptz` | NULL | Soft delete — **only** where the product has recycle behavior (e.g., partners, items). Financial documents are never soft-deleted; they use lifecycle states and, for sync-visible entities, tombstones (ADR-0012). |

**Posting metadata** (financial documents, set by the posting transaction —
[DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §2):

| Column | Meaning |
|--------|---------|
| `posted_at` / `posted_by` | When/who made the document effective; set atomically with the journals; immutable after set |
| `approved_by` (+ policy flag) | Approval actor when approve→post are separate actions; auto-post records both fields distinctly |
| `journal_entry_ids` (or equivalent FK set from `journal_entries.source`) | Ledger link required for any `POSTED` document (INV-006) |

## 2. Identity & official numbers (two systems — ADR-0006)

| Column family | Rule |
|---------------|------|
| `id uuid` | UUIDv7, see §1. Never re-used as a business identifier. |
| Official numbers: `entry_no`, `invoice_no`, `receipt_no`, `payment_no`, `order_no`, `receipt_no(GRN)`, `internal_no`, etc. | `text`; assigned **server-side at approval/posting time** (per tenant numbering policy: reserve-at-approval or assign-at-post) from per-tenant (and per-branch where configured) named sequences with a format (e.g., `INV-{BRANCH}-{YYYY}-{seq:6}`); unique per `(tenant_id, branch_id, doc_type, number)` (INV-021); **immutable**; gaps only via voided reservations that remain queryable; single-type tables encode `doc_type` implicitly (the constraint then reads `(tenant_id, branch_id, number)`); numbering formats and sequence state are tenant configuration, not code. |
| `offline_receipt_no` | `text`, NULL except POS offline sales (PHASE-016): the terminal's local receipt number (documented `OFF-…` scheme, [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md)). After sync, the row carries **both** the offline number (kept on the printed receipt, immutable) and the official number assigned by the server. |

## 3. Bilingual names

| Column | Rule |
|--------|------|
| `name` | Primary display name (Arabic or English — whatever the tenant typed first); `text`; searchable (trigram indexes). |
| `name_ar` | Arabic name; may be NULL (nullable-safe); UI resolves per display locale with graceful fallback to `name` — never machine-translated silently. |
| Applies to | tenants, branches, accounts, cost_centers, partners, items, item_categories, uoms, price_lists, expense_categories, roles, warehouses, tax_codes, … — any user-facing named entity. Pattern: `name` + `name_ar` pair ([DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §4). |

## 4. Status enums

Statuses are `text` + CHECK constraint + typed TS union in `packages/contracts` (never
native enums — [DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §7). Adding a value =
migration + code PR, never a silent string. The **core lifecycle** value list is exact
and shared; per-type variations are also fixed:

| Status set | Exact values | Semantics (authoritative: [DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §2) |
|------------|--------------|------------------------------|
| Core lifecycle | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `POSTED`, `REVERSED`, `CANCELLED` | Draft=editable/no number; PENDING_APPROVAL=locked for approval; APPROVED=number reserved-or-assigned; POSTED=immutable+numbered+journaled; REVERSED=negated by reversal doc (net zero, both visible); CANCELLED=abandoned, number voided forever |
| Quotation | `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED` | No ledger path; ACCEPTED converts to order |
| Purchase order | `DRAFT`, `ISSUED`, `CLOSED` | Amendments are new linked revisions; no ledger effect until GRN/invoice |
| Stock transfer | `DRAFT`, `IN_TRANSIT`, `POSTED` | Two-leg stock effect; in-transit visible, not sellable |
| Stock count | `DRAFT`, `COUNTED`, `VARIANCE_REVIEW`, `POSTED` | POSTED writes adjustment journals |
| Production order | `DRAFT`, `RELEASED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` | CANCELLED only before consumption |
| Journal entry | `POSTED`, `REVERSED` | Entries exist only as posted (reversal = counter-entry, never a state edit) |
| Fiscal period | `OPEN`, `SOFT_CLOSED`, `LOCKED` | LOCKED rejects engine writes (INV-011); reopen is permission+reason+audit (INV-020) |

Documents using a **subset** of core (e.g., receipts `DRAFT→POSTED`, expense claims
`DRAFT→PENDING_APPROVAL→APPROVED→POSTED`) declare their subset in the TABLES spec; the
CHECK constraint lists only legal values for that table.

## 5. Direction columns

| Column | Values | Used on | Rule |
|--------|--------|---------|------|
| `direction` (ledger) | `DEBIT`, `CREDIT` | `journal_lines` | Magnitude stays in `amount` (always positive); the side is the direction. Balanced entry = Σdebit = Σcredit per currency (INV-001/002). |
| `direction` (stock/cash) | `IN`, `OUT` | `stock_moves`, `cash_movements` | Sign is carried by direction, never by a negative qty/amount (checks enforce positivity). |

## 6. Money & quantity columns (all per ADR-0009)

All money as `numeric(19,4)`; quantities `numeric(19,6)`; rates `numeric(19,8)`;
percentages `numeric(7,4)`; prices/unit costs `numeric(19,6)`. JSON transport is decimal
**strings**. Never floats, anywhere.

| Column | Type | Meaning |
|--------|------|---------|
| `amount` | 19,4 | Ledger line magnitude in the **entry/document currency**, positive, direction per §5 |
| `base_amount` | 19,4 | Same amount converted to the tenant's **base currency**: `base_amount = amount × exchange_rate` exactly as stored — no recomputation drift (INV-008); rounding at final posting step |
| `net_amount` | 19,4 | Document line: `round(qty × unit_price − discount, minor units, half-up)` — the taxable base after discount |
| `tax_amount` | 19,4 | Document line: `round(taxable_base × rate, minor units, half-up)` per line per tax code; header `total_tax` = Σ line taxes |
| `total_net` / `total_tax` / `total_amount` | 19,4 | Header totals = Σ rounded lines; header-vs-Σ tolerance is exactly 0.00 or the residual posts to the rounding-difference purpose (INV-007) |
| `unit_price` | 19,6 | Per-UoM price on document lines / price list items |
| `unit_cost` | 19,6 | Valuation cost basis: WAC moving average or FIFO layer cost; 6-decimal internal precision; issue amounts round to 4 |
| `value_amount` | 19,4 | `stock_moves`: `qty × unit_cost` at issue/receipt — the amount the inventory journal uses (INV-010/018) |
| `qty` | 19,6 | Quantity, UoM-qualified (converted via `uom_conversions` before math); non-negative by check; sign never used |
| `credit_limit` | 19,4 | Partner-level exposure ceiling checked at sales posting/allocation |
| `rate` (FX) | 19,8 | See §7; percentage rates use `numeric(7,4)` and live inside snapshots/summaries, never as a money column |

## 7. Exchange rate convention

`exchange_rate numeric(19,8)` on any foreign-currency document/entry:
**base-currency units per 1 unit of document currency** (GLOSSARY). Therefore
`base_amount = amount × exchange_rate`, `rate > 0` (check), every foreign-currency entry
stores it (INV-008), and tenants keep exactly one base currency (A-003). Rounding rules
and display formatting: [../localization/CURRENCY_AND_PRECISION.md](../localization/CURRENCY_AND_PRECISION.md).

## 8. `tax_snapshot` jsonb shape

Stamped on **document lines at posting** (drafts recompute; posted lines never do):

```json
{
  "treatment": "STANDARD_RATED",     // enum §9 — mandatory
  "rate": "0.1500",                  // decimal string, numeric(7,4) equivalent — mandatory
  "jurisdiction": "SA",              // ISO country code — mandatory
  "version": "sa@2026-01"            // jurisdiction pack version id — mandatory
}
```

Rules: the object is a **frozen copy** of the resolved rate (per
[TAX_ENGINE.md](../localization/TAX_ENGINE.md) §1) — pack updates can never mutate posted
documents; recomputation of a draft must reproduce it exactly (determinism);
missing/invalid snapshot on a posting attempt is an engine rejection, not a default.
Optional keys (e.g., a source note) must be additive and documented in the pack.

## 9. Enum registry (single source of truth for value lists)

`text + CHECK` everywhere; value lists here are exhaustive. The registry is updated in
the same phase as the table that uses it (sync rule). Blueprint v2.0 rows (PHASE-026…034)
are pre-registered at blueprint level per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md)
§I; their tables arrive with their phases.

| Enum | Values | Used by (tables) | Phase |
|------|--------|-------------------|-------|
| `document_status_core` | DRAFT, PENDING_APPROVAL, APPROVED, POSTED, REVERSED, CANCELLED | sales_invoices, credit_notes, receipts, payments, expenses, cash_transfers, delivery_notes, supplier_invoices, goods_receipts, debit_notes | 008–012 |
| `quotation_status` | DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED | quotations | 012 |
| `purchase_order_status` | DRAFT, ISSUED, CLOSED | purchase_orders | 011 |
| `stock_transfer_status` | DRAFT, IN_TRANSIT, POSTED | stock_transfers | 010 |
| `stock_count_status` | DRAFT, COUNTED, VARIANCE_REVIEW, POSTED | stock_counts | 010 |
| `production_order_status` | DRAFT, RELEASED, IN_PROGRESS, COMPLETED, CANCELLED | production_orders | 018 |
| `journal_entry_status` | POSTED, REVERSED | journal_entries | 007 |
| `fiscal_period_status` | OPEN, SOFT_CLOSED, LOCKED | fiscal_periods | 007 |
| `fiscal_year_status` | OPEN, CLOSED | fiscal_years | 007 |
| `report_run_status` | QUEUED, RUNNING, COMPLETED, FAILED | report_runs | 013 |
| `account_type` | ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE | accounts | 007 |
| `account_status` | ACTIVE, ARCHIVED | accounts | 007 |
| `direction_ledger` | DEBIT, CREDIT | journal_lines | 007 |
| `direction_flow` | IN, OUT | stock_moves, cash_movements | 008/010 |
| `stock_move_kind` | RECEIPT, ISSUE, TRANSFER_IN, TRANSFER_OUT, ADJUSTMENT | stock_moves | 010 |
| `item_serial_status` | IN_STOCK, SOLD, RETURNED | item_serials | 010 |
| `costing_method` | WAC, FIFO | items ([accounting/DR-001](../decisions/accounting/DR-001-costing-method-default.md): WAC default) | 010 |
| `partner_kind` | CUSTOMER, SUPPLIER, BOTH | partners | 006 |
| `item_kind` | STOCK, SERVICE, COMPOSITE | items | 006 |
| `cash_account_type` | CASH, BANK, PETTY | cash_accounts | 008 |
| `tax_treatment` | STANDARD_RATED, ZERO_RATED, EXEMPT, OUT_OF_SCOPE, REVERSE_CHARGE, NOT_SUBJECT | tax_codes, tax_snapshot, tax summaries | 009 |
| `vat_applicability` | VAT_IN_FORCE, VAT_PLANNED, VAT_PLANNED_EINVOICING, NO_VAT | jurisdictions | 009 |
| `tax_registration_status` | REGISTERED, NOT_REGISTERED, DEREGISTERED | tax_registrations | 009 |
| `einvoice_submission_status` | PENDING, GENERATED, SIGNED, SUBMITTED, ACCEPTED, REJECTED, REPORTED, FAILED | e_invoicing_submissions | 023 (schema 009) |
| `einvoicing_certificate_status` | ACTIVE, EXPIRING_SOON, EXPIRED, REVOKED | e_invoicing_certificates | 023 |
| `einvoicing_certificate_operation` | SIGN, DECRYPT | e_invoicing_certificate_usage | 023 |
| `bank_parked_line_status` | PARKED, RESOLVED, DISCARDED | bank_statement_parked_lines | 023 |
| `bank_statement_format_family` | csv, xlsx | bank_statement_formats (seed) | 023 |
| `commerce_order_status` | IMPORTED, CONFLICT, RESOLVED | commerce_channel_orders | 023 |
| `commerce_import_status` | COMPLETED, FAILED | commerce_channel_imports | 023 |
| `billing_payout_status` | PENDING, RECONCILED, DRIFT | billing_payouts | 023 |
| `tenant_status` | ACTIVE, SUSPENDED, OFFBOARDED | tenants | 003 |
| `user_status` | PENDING, ACTIVE, LOCKED, DEACTIVATED | users | 003 |
| `membership_status` | ACTIVE, REVOKED | memberships | 003 |
| `invitation_status` | PENDING, ACCEPTED, EXPIRED, REVOKED | invitations | 004 |
| `subscription_status` | ACTIVE, PAST_DUE, CANCELLED | subscriptions | 014 |
| `entitlement_source` | PLAN, MANUAL, PROMO, TRIAL | entitlements | 004 |
| `device_platform` | DESKTOP, ANDROID | devices | 021/022 |
| `asset_status` | ACTIVE, FULLY_DEPRECIATED, DISPOSED, WRITTEN_OFF | assets | 026 |
| `depreciation_method` | STRAIGHT_LINE, DECLINING_BALANCE, UNITS_OF_PRODUCTION | assets, asset_categories | 026 |
| `disposal_kind` | SALE, SCRAP | asset_disposals | 026 |
| `revaluation_status` | DRAFT, POSTED | asset_revaluations | 026 |
| `depreciation_run_status` | DRAFT, POSTED | depreciation_runs | 026 |
| `note_kind` | CHEQUE, PROMISSORY_NOTE | notes | 027 |
| `note_direction` | RECEIVED, ISSUED | notes | 027 |
| `note_status` | IN_CUSTODY, ENDORSED_OUT, DEPOSITED, COLLECTED, DISHONORED, DISCOUNTED, RETURNED | notes | 027 |
| `note_event_kind` | ENDORSE, DEPOSIT, COLLECT, DISHONOR, DISCOUNT, RETURN, RECLASSIFY | note_events | 027 |
| `installment_frequency` | WEEKLY, BIWEEKLY, MONTHLY, QUARTERLY | installment_plans | 027 |
| `installment_line_status` | PENDING, DUE, PAID, OVERDUE, WAIVED | installment_lines | 027 |
| `installment_plan_status` | ACTIVE, CLOSED, DEFAULTED — **the column admits NULL = draft pre-activation** (delivered by migration 0038: the value list enumerates the activated lifecycle states only; draft is the absence of activation, `ck_installment_plans_activated_shape` ties status to `activated_at`) | installment_plans | 027 |
| `budget_scope` | ACCOUNTS, COST_CENTERS, PROJECTS, BRANCHES | budgets | 028 |
| `budget_status` | DRAFT, PENDING_APPROVAL, ACTIVE, REVISED, CLOSED | budgets | 028 |
| `employee_status` | ACTIVE, SUSPENDED, TERMINATED | employees | 029 |
| `employee_contract_type` | FULL_TIME, PART_TIME, CONTRACTOR | employees | 029 |
| `salary_component_kind` | ALLOWANCE, DEDUCTION, EMPLOYER_CONTRIBUTION | salary_components | 029 |
| `salary_component_calc` | FIXED, PERCENT_OF_BASIC, PERCENT_OF_GROSS | salary_components | 029 |
| `payroll_run_status` | DRAFT, PENDING_APPROVAL, POSTED | payroll_runs | 029 |
| `loan_status` | ACTIVE, CLOSED, WRITE_OFF | employee_loans | 029 |
| `loan_line_status` | PENDING, DEDUCTED, WAIVED | employee_loan_lines | 029 |
| `consolidation_run_status` | QUEUED, RUNNING, COMPLETED, FAILED | consolidation_runs | 034 |
| `custom_field_data_type` | TEXT, NUMBER, DATE, BOOLEAN, SELECT, MULTISELECT, REFERENCE | custom_field_definitions | 036 |
| `custom_field_status` | ACTIVE, ARCHIVED | custom_field_definitions, custom_picklists, custom_picklist_options, form_layouts | 036 |
| `invoice_classification` | STANDARD, SIMPLIFIED — **the column admits NULL = unclassified** (classification is captured at create — POS defaults to SIMPLIFIED, everything else to STANDARD; the explicit input is validated) | sales_invoices | 037 |
| `zatca_registration_status` | NOT_REGISTERED, PENDING, REGISTERED, REVOKED — **NOT_REGISTERED is the only value the Phase-1 surface writes** (BR-061 honesty: the CHECK admits the Phase-2 lifecycle so 054 evolves vocabulary, never reshape) | zatca_devices | 037 |

## 10. `memo` vs `description`

| Column | Level | Meaning |
|--------|-------|---------|
| `memo` | Ledger **line** (`journal_lines.memo`) | Short free text explaining this line to accountants. |
| `description` | **Document/entry header** (journal_entries, invoices, …) | The document's narrative (what/why). |

Rules: both are user-entered, never machine-parsed, never a data channel (amounts,
partners, tax codes live in real columns — DATABASE_CONVENTIONS §4 jsonb rule). Reversal
documents must reference the original in the `reversal_of` link — the memo alone is not
provenance ([RELATIONSHIPS.md](RELATIONSHIPS.md) §3).

## 11. Timestamps vs dates

`*_at` = `timestamptz` (when, in time: `posted_at`, `expires_at`, `moved_at`) ·
`*_date` = `date` (business calendar day: `entry_date`, `invoice_date`, `due_date`,
`maturity_date` (notes — see §14), `rate_date`, `active_from`). Fiscal/reporting logic reads `*_date` columns only
(DATABASE_CONVENTIONS §4); a document's `entry_date` determines its fiscal period and the
tax rates resolved at posting (TAX_ENGINE §2).

## 12. Codes (tenant-scoped natural keys)

`accounts.code`, `items.sku`, `partners.code`, `branches.code`, `uoms.code`,
`cost_centers.code`, `expense_categories.code`, `tax_codes.code`, `roles.key` etc.: `text`,
unique **per tenant** (not per table-global), never a PK/PK substitute, and treated as
immutable once referenced by posted data (renaming is a product decision, not a cleanup).
Global reference keys (`currencies.code`, `permissions.key`, `jurisdictions` codes) are
seeded and shared by all tenants.

## 13. Recurring point-in-time semantics (`expires_at`, `revoked_at`, `accepted_at`, …)

Several clusters of "state-changing moment" columns recur across clusters; their
null-semantics are fixed here so per-table specs only name them:

| Column | NULL means | Notes |
|--------|-----------|-------|
| `expires_at` | No expiry (valid while its owner is valid) | Used by invitations, entitlements, invitations/tokens, price-list validity where applicable; **expiry is enforced by the owning service at use time**, and near-expiry is alertable (certs, invitations) |
| `revoked_at` | Not revoked | Sessions, devices, invitations; revocation is append-only state change (no delete) and always pairs with an audit event |
| `accepted_at` | Not yet accepted | Invitations (acceptance creates the membership); support-access grants |
| `locked_until` | Not locked | Users (transient lockout); fiscal periods use `status` instead — never mix the two patterns in one table |
| `last_seen_at` / `last_used_at` / `last_login_at` | Never seen/used | Observability of activity; never used for authorization decisions on their own |

Rule: a timestamp is never a status — statuses are enum columns (§4/§9); timestamps
explain **when**, enums explain **what**. If a reviewer finds a table deriving behavior
from one of these columns instead of its status column, that is a design defect.

## 14. Blueprint v2.0 — financial-depth column semantics (PHASE-026…034)

Recurring columns introduced by the financial-depth modules
([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §C); same rules as every
dictionary term — no table may redefine them.

| Column | Type | Rule | Meaning |
|--------|------|------|---------|
| `opening_accumulated` | `numeric(19,4)` | §6 money; CHECK `0 ≤ opening_accumulated ≤ cost − salvage_value`; immutable after creation (the register's economic columns never change — corrections are revaluation/disposal documents) | `assets` (PHASE-026): the opening-variant accumulated-to-date input — the G-21 OPENING funding posts `DR OPENING_EQUITY · CR ACCUM_DEPRECIATION` for it so future runs resume from the true NBV (INV-023 from day one; the PHASE-007 opening-balances discipline) |
| `period_amount` / `accumulated_amount` | `numeric(19,4)` | `period_amount` CHECK > 0 (never a zero line); `accumulated_amount` CHECK ≥ 0; append-only 🔒 row | `depreciation_lines` (PHASE-026): the period's depreciation quantum and the asset's running accumulated AFTER the line — the NBV-floor proof chain (`cost − salvage − accumulated ≥ 0`, INV-023); history is never rewritten (grants + guard trigger) |
| `period_units` | `numeric(19,6)` | NULL or CHECK ≥ 0 | `depreciation_lines` (PHASE-026): the manual UNITS_OF_PRODUCTION usage for the period (DR-002 — no metering; entered per line in the run workspace, then re-assembled) |
| `net_book_value` / `accumulated_snapshot` / `gain_loss` | `numeric(19,4)` | Frozen at DRAFT, immutable after post (disposal snapshots) | `asset_disposals` (PHASE-026): the disposal-time register side — NBV = cost − accumulated, `gain_loss = proceeds − NBV`; the G-23 legs derive from these frozen values (never re-computed at post), so the posted journal and the document agree by construction |
| `new_gross_value` / `new_accumulated` / `delta` | `numeric(19,4)` | Revaluation basis: CHECK `new_gross_value > 0`, `new_accumulated ≥ 0`, `new_gross_value − new_accumulated ≥ 0`; `delta` frozen at DRAFT from the then-live NBV | `asset_revaluations` (PHASE-026): the restated basis + the NBV delta that posts to `REVALUATION_RESERVE` (BR-044 — never P&L, both directions); subsequent depreciation runs compute on the revalued basis (the snapshot chain is the audit trail; `reason` 1..500 is mandatory) |
| `maturity_date` | `date` | §11 timestamps-vs-dates | `notes`: the business calendar day a cheque/promissory note falls due — drives the PDC maturity calendar (BR-045) and notes aging; never a `timestamptz` |
| `component_snapshot` | `jsonb` | Frozen-copy rule, same discipline as §8 `tax_snapshot` | `payroll_run_lines`: frozen per-employee copy of the resolved salary components (amounts, rates, structure version) at run posting — structure edits never mutate posted lines (INV-025); recomputing a DRAFT run must reproduce it exactly (determinism); missing snapshot on a posting attempt is an engine rejection |
| `late_fee_policy` | `jsonb` | Policy blob, not a data channel ([DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §4); delivered shape `{rate, cap, grace_days, auto_charge, defaulted_after_lines}` with PLACEHOLDER defaults (rate 2% · cap 500 · grace 7 d · auto_charge off · defaulted_after 3 — never silent) | `installment_plans`: per-plan rate + cap + grace (BR-049) — defaults PLACEHOLDER pending [OQ-002](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md); enforced server-side, fee posts via the engine only (golden G-28); flat fees only — no interest computation or compounding path exists (DR-003) |
| `national_id` | `text` | Sensitive personal data — C-PII class | `employees`: national identity number; handled per [DATA_PROTECTION.md](../security/DATA_PROTECTION.md) §2/§3 (masked in UI, excluded from logs by the redaction allow-list, never in job payloads); reads gated by `payroll.employees.*` permissions ([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §K) |

## 15. The UDF key namespace (PHASE-036 · BR-058)

The extensibility core ([ADR-0019](../architecture/ADR/ADR-0019-custom-fields-typed-value-store.md),
migration `0049_custom_fields.sql`) introduces a tenant-owned identifier namespace: the
custom-field `key` on `custom_field_definitions` (and the picklist `key` on
`custom_picklists`). The discipline below is enforced by the **code-owned entity registry**
(`CUSTOM_FIELD_ENTITIES` in `apps/api/src/modules/configuration/domain/custom-fields-schema.ts`)
— the DB CHECKs are a syntax floor only; the registry is the rule.

| Rule | Value | Enforcement |
|------|-------|-------------|
| Syntax | lowercase `snake_case` matching `^[a-z][a-z0-9_]{0,63}$` — leading letter, letters/digits/underscore, **≤ 64 chars** | `ck_custom_field_definitions_key` (floor) + the registry's key guard (typed 422 `CUSTOM_FIELD_KEY_INVALID`) |
| Reserved platform stems — never valid on ANY entity | `id`, `tenant_id`/`tenantid`, `created_at`/`createdat`, `updated_at`/`updatedat`, `version`, `created_by`/`createdby`, `deleted_at`/`deletedat`, `status`, `custom_fields`/`customfields` (the API payload stem itself) | The registry's reserved-stem list (BR-058) |
| Per-entity native blocklist — never valid on the target entity | every `nativeFields` key of the target entity's registry descriptor (e.g. `partners`: `kind`, `code`, `name`, `nameAr`, `taxNumber`, `creditLimit`, `creditTermsId`, `priceListId`; `items`: `sku`, `uomId`, `categoryId`, `taxCodeId`, `basePrice`; …) | The registry descriptor lookup (BR-058) — a custom key can never shadow a native column |
| Future native columns | Any new native column is checked against the registry's native-field lists **at design time** — a migration adding a column that collides with an existing tenant key is a design defect, caught in review | The ADR-0019 additive-registration rule (registry line + `ENTITY_CATALOG` row in the same PR) |

**The `entity_type` vocabulary** is the code-owned registry's `entityType` strings —
deliberately identical to the sync `PULLED_ENTITY_TYPES` naming so values ride the feeds'
entity vocabulary unchanged. First wave (PHASE-036): `partners`, `items`,
`sales_invoices`, `purchase_orders`, `employees`, `projects`. Later phases register new
entities into the registry in the same PR (one registry line + the `ENTITY_CATALOG` row)
— zero migrations; there is **no DB-level entity CHECK** by design (ADR-0019).

**The `data_type` → typed-column mapping** (`custom_field_values`, one row per
`(tenant_id, entity_type, entity_id, field_id)`; exactly ONE typed column non-null — the
`num_nonnulls = 1` row law, BR-057):

| `data_type` | Stored in | Shape |
|-------------|-----------|-------|
| `TEXT` | `value_text` | free text; `validation_regex`/`min_length`/`max_length` rules apply (TEXT-only — the validation × data-type matrix) |
| `NUMBER` | `value_number numeric(19,6)` | `min_value`/`max_value` rules apply (NUMBER-only); display precision from `config.precision` (0–6, default 2) |
| `DATE` | `value_date` | ISO date (no time component — §11 timestamps-vs-dates) |
| `BOOLEAN` | `value_boolean` | true/false |
| `SELECT` | `value_text` | the chosen `custom_picklist_options.id` (uuid string); archived options rejected for NEW values, labels preserved for history (BR-057) |
| `MULTISELECT` | `value_json` | a **jsonb array of option ids** — `["<uuid>", …]`, array shape pinned by `ck_custom_field_values_multiselect_shape`; duplicates rejected by the guard |
| `REFERENCE` | `value_text` | the referenced entity row's `id` (uuid string); target entity must itself be a registry entity (`config.referenceEntity`), existence checked against the registry's physical table |

**The `config` jsonb keys** (`custom_field_definitions.config`, `{}` by default — a policy
blob, never a data channel, per [DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) §4):

| `data_type` | Required config | Forbidden config |
|-------------|-----------------|-------------------|
| `SELECT` / `MULTISELECT` | `picklistId` (uuid → `custom_picklists`) | `referenceEntity`, `precision` |
| `REFERENCE` | `referenceEntity` (a registry `entityType`) | `picklistId`, `precision` |
| `NUMBER` | — (`precision` optional, 0–6, default 2) | `picklistId`, `referenceEntity` |
| `TEXT` / `DATE` / `BOOLEAN` | — | all three keys |

Related semantics: form layouts (`form_layouts.sections` jsonb — ordered section groups of
native + custom field refs with `role_key` overrides, BR-059) and the ADR-0019 value guard
(full-replace writes; values ride the owning entity's permission) are documented in
[ADR-0019](../architecture/ADR/ADR-0019-custom-fields-typed-value-store.md) and
[BUSINESS_RULES.md](../product/BUSINESS_RULES.md) (BR-057…BR-059).

## 16. ZATCA Phase-1 chain columns (PHASE-037 · INV-027)

Migration `0050_zatca_phase1.sql` (schema_version 50) adds the Saudi e-invoicing
Phase-1 GENERATION substrate: seven additive NULLABLE columns on `sales_invoices` (zero
reshape of existing rows — the backfill fills history, never rewrites it) and the RLS'd
`zatca_devices` table (the chain anchor). Same rules as every dictionary term — no table
may redefine them.

**The `sales_invoices` addenda** (all NULL = unstamped/unclassified):

| Column | Type | Rule | Meaning |
|--------|------|------|---------|
| `zatca_device_id` | `uuid` | NULL = unstamped; composite tenant FK `(zatca_device_id, tenant_id) → zatca_devices (id, tenant_id)` ON DELETE RESTRICT (the house convention — both sides' tenant_id must agree) | The issuing ZATCA EIAS device — the INV-027 chain anchor; a device with issued invoices is archive-disabled (no DELETE grant on the registry) |
| `icv` | `integer` | NULL = unstamped; DB floor `uq_sales_invoices_tenant_device_icv` — partial UNIQUE `(tenant_id, zatca_device_id, icv)` WHERE stamped (a device can never mint the same counter twice, even under a minting race); chain-walk index `ix_sales_invoices_tenant_device_icv` | Invoice counter value — strictly monotonic 1..N per device, zero gaps (INV-027); minted inside the post transaction from the device's `icv_counter` (SELECT FOR UPDATE) |
| `previous_invoice_hash` | `text` | NULL = unstamped; base64 | PIH — the predecessor's stored `invoice_hash` on the same device chain; the first invoice carries the documented genesis `base64(SHA-256(ASCII "0"))` (`GENESIS_PIH`); never computed forward, always the stored fact |
| `invoice_hash` | `text` | NULL = unstamped; base64 | This invoice's hash digest over the canonical serialization (`invoiceHash` in `hash-chain.ts`) — the value the NEXT invoice's PIH must equal |
| `invoice_hash_version` | `text` | NULL = unstamped; carries the code-level version marker `invoice-hash-v1` | Digest-implementation marker — PHASE-054's UBL 2.1 digest re-derives the full walk under a new marker (PIH links survive; no chain rewrite) |
| `qr_payload` | `text` | NULL = unstamped; base64 TLV of the five mandated fields (tags 1..5; `PAYLOAD_SPEC_VERSION` `phase1-tlv-v1`) | The stored QR payload — **rendered to an image at print time only** (the image is NEVER stored, OA-06); the report layer surfaces presence (`qrPresent`), not the payload |
| `classification` | `text` | `ck_sales_invoices_classification`: NULL or STANDARD/SIMPLIFIED — deliberately OUTSIDE the stamp-shape CHECK (a DRAFT may be classified before it is stamped) | Invoice classification — STANDARD (B2B) / SIMPLIFIED (B2C); POS creates default SIMPLIFIED, everything else STANDARD; BR-060 fail-closes post+print for KSA-VAT tenants |

The stamp coherence law: `ck_sales_invoices_zatca_stamp_shape` — the six stamp columns
(`zatca_device_id`, `icv`, `previous_invoice_hash`, `invoice_hash`, `qr_payload`,
`invoice_hash_version`) are **all NULL or all NOT NULL** (the stamp lands atomically in
the post transaction or the backfill; no partial stamp can exist). BR-060's post/print
guards are APPLICATION guards above this floor — a DB-level "SIMPLIFIED ⇒ stamped"
equality would break the DRAFT lifecycle.

**The `zatca_devices` columns** (RLS'd tenant table; grants SELECT/INSERT/UPDATE —
**NO DELETE**; purge-path policies for offboarding):

| Column | Type | Nullability / default | Meaning |
|--------|------|----------------------|---------|
| `id` | `uuid` | NOT NULL, PK | Device row id; `(id, tenant_id)` UNIQUE — the composite-FK target convention |
| `tenant_id` | `uuid` | NOT NULL (FK RESTRICT) | Owner tenant |
| `name` / `name_ar` | `text` | name NOT NULL (1..160, UNIQUE per tenant) · name_ar NULL | Bilingual device display name (the tenant's own EIAS device label) |
| `device_uuid` | `text` | NULL; `ck_zatca_devices_device_uuid_shape` `^[0-9a-fA-F-]{36}$`; UNIQUE per tenant where set | The ZATCA-assigned device UUID — placeholder until the Phase-2 onboarding issues it; shape-validated when set, never guessed |
| `device_serial` | `text` | NULL | The ZATCA-assigned device serial (placeholder, same discipline) |
| `solution_provider_name` | `text` | NULL | The solution-provider vendor name — stored verbatim (PHASE-054 completes onboarding) |
| `solution_provider_vat` | `text` | NULL; `ck_zatca_devices_vat_shape` `^\d{15}$` | The solution-provider VAT number — 15 digits when set |
| `registration_status` | `text` | NOT NULL DEFAULT `'NOT_REGISTERED'`; CHECK IN (NOT_REGISTERED, PENDING, REGISTERED, REVOKED) | The registration lifecycle — **the Phase-1 surface writes NOT_REGISTERED only** (BR-061: no registry claims before PHASE-054); the CHECK admits the future states so 054 evolves vocabulary, never reshape |
| `icv_counter` | `integer` | NOT NULL DEFAULT 0; CHECK ≥ 0 | The chain anchor: the next ICV this device mints is `icv_counter + 1`; incremented transactionally inside the invoice post (SELECT FOR UPDATE) and re-synced by the backfill |
| `branch_id` | `uuid` | NULL; composite tenant FK RESTRICT | Optional branch binding (a device may serve one branch's terminals) |
| `note` | `text` | NULL | Free text — user-entered, never machine-parsed (§10 discipline) |
| `created_at` / `updated_at` / `version` / `created_by` | — | house standard | [DATABASE_CONVENTIONS.md](DATABASE_CONVENTIONS.md) standard columns |

## 17. Procurement sourcing & supplier collaboration (PHASE-038)

Migrations `0051_rfq_quotes.sql` → `0054_capex_tenders.sql` (schema_version 54) add the
sourcing cluster: thirteen RLS'd tenant tables (composite tenant FKs throughout — both
sides' `tenant_id` must agree; stamp-shape CHECKs pin the lifecycles per the 0050
discipline) plus the one additive `purchase_orders.contract_id` column. Same rules as
every dictionary term — no table may redefine them. House standard columns
(`created_at`/`updated_at`/`version`/`created_by`) apply where present and are not
repeated per row; all tables carry the `erp.apply_tenant_policy` RLS macro and the
purge-path policies. DELETE grants: only `rfq_lines` + `supplier_quotes_lines` (the
replace paths) — every other table is archive-not-delete.

**Migration `0051` — the RFQ negotiation loop:**

`rfqs` (the sourcing round header):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE (composite-FK target) |
| `branch_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → branches |
| `rfq_no` | `text` | NULL until ISSUE — reserved at the BR-029 boundary transition; UNIQUE per tenant |
| `title` / `title_ar` | `text` | title NOT NULL (CHECK 1..200); title_ar NULL (§3) |
| `mode` | `text` | NOT NULL DEFAULT `'INVITED'`; CHECK IN (OPEN, INVITED) |
| `status` | `text` | NOT NULL DEFAULT `'DRAFT'`; CHECK IN (DRAFT, ISSUED, QUOTED, AWARDED, CLOSED, CANCELLED) |
| `currency_code` | `varchar(3)` | NOT NULL; CHECK `^[A-Z]{3}$` |
| `due_at` | `timestamptz` | NULL = no stated due date |
| `invited_suppliers` | `jsonb` | NOT NULL DEFAULT `'[]'`; CHECK jsonb array — the INVITED allow-list (supplier uuid strings) |
| `portal_invites` | `jsonb` | NOT NULL DEFAULT `'[]'`; CHECK jsonb array — P-05 scoped tokens as **sha256 hashes only** (the plaintext is shown once at mint, never stored) |
| `issued_at` / `issued_by` | `timestamptz` / `uuid` | the ISSUE stamps (NULL in DRAFT — stamp-shape CHECK) |
| `quoted_at` | `timestamptz` | first quote arrival stamp (informational) |
| `awarded_at` / `awarded_by` | `timestamptz` / `uuid` | the award stamps (NULL until AWARDED) |
| `closed_at` / `closed_by` | `timestamptz` / `uuid` | the close stamps |
| `cancel_reason` | `text` | NULL unless CANCELLED |
| `note` / `note_ar` | `text` | §10 discipline |

`rfq_lines` (requested items; **DELETE grant** — replace-on-DRAFT-edit):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `rfq_id` | `uuid` | NOT NULL; composite tenant FK **CASCADE** → rfqs |
| `line_no` | `integer` | NOT NULL; UNIQUE per (tenant, rfq) |
| `item_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → items |
| `qty` | `numeric(19,6)` | NOT NULL; CHECK > 0 (§6) |
| `target_price` | `numeric(19,4)` | NULL or CHECK ≥ 0 — the buyer's ceiling (never a commitment) |
| `note` | `text` | NULL |

`supplier_quotes` (one quote per supplier per RFQ):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `rfq_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → rfqs |
| `supplier_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → partners; UNIQUE per (tenant, rfq, supplier) — one quote per supplier per round |
| `quote_ref` | `text` | the supplier's own reference, verbatim (never guessed) |
| `status` | `text` | NOT NULL DEFAULT `'SUBMITTED'`; CHECK IN (SUBMITTED, WITHDRAWN) |
| `submitted_via` | `text` | NOT NULL DEFAULT `'BACK_OFFICE'`; CHECK IN (PORTAL, BACK_OFFICE) |
| `currency_code` | `varchar(3)` | NOT NULL; CHECK `^[A-Z]{3}$` |
| `lead_time_days` | `integer` | NULL or CHECK ≥ 0 |
| `valid_until` | `date` | NULL — the offer's validity day (§11) |
| `payment_terms` | `text` | verbatim text, not a foreign key |
| `submitted_at` / `submitted_by` | `timestamptz` / `uuid` | submitted_at NOT NULL DEFAULT now(); back-office entry stamps the actor |
| `portal_contact` | `text` | portal submissions stamp the contact — **the token itself is never recorded** |
| `note` | `text` | NULL |

`supplier_quotes_lines` (offered prices; **DELETE grant** — the re-submit replace path):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `quote_id` | `uuid` | NOT NULL; composite tenant FK **CASCADE** → supplier_quotes |
| `rfq_line_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → rfq_lines |
| `line_no` | `integer` | NOT NULL; UNIQUE per (tenant, quote) |
| `qty` | `numeric(19,6)` | NOT NULL; CHECK > 0 |
| `unit_price` | `numeric(19,4)` | NOT NULL; CHECK ≥ 0 |
| `lead_time_days` | `integer` | NULL or CHECK ≥ 0 |
| `note` | `text` | NULL |

`quote_comparisons` (the frozen snapshot + award decision — no-delete evidence):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `rfq_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → rfqs; UNIQUE per (tenant, rfq) — the ONE-live-comparison BR-063 floor |
| `snapshot` | `jsonb` | NOT NULL; CHECK jsonb object — per-line offers + scores + supplier totals, frozen at prepare (the award never re-scores) |
| `status` | `text` | NOT NULL DEFAULT `'PREPARED'`; CHECK IN (PREPARED, AWARDED, CANCELLED) with award-stamp coherence (AWARDED ⇔ award + awarded_at NOT NULL) |
| `award` | `jsonb` | NULL until awarded; `{decisions: [{rfqLineId, quoteId, supplierId, qty, unitPrice}], note?, awardedAt}` — written once |
| `awarded_by` / `awarded_at` | `uuid` / `timestamptz` | the award actor/stamp |
| `award_note` / `award_note_ar` | `text` | §10 discipline |
| `generated_docs` | `jsonb` | traceability of generated documents: `[{kind: PURCHASE_ORDER\|BLANKET_RELEASE, id, supplierId, documentNo?, lineRefs}]` |

**Migration `0052` — blanket agreements + the contract linkage:**

`blanket_orders` (the standing supplier agreement):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `branch_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → branches |
| `blanket_no` | `text` | NOT NULL; UNIQUE per tenant (§12) |
| `supplier_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → partners |
| `contract_id` | `uuid` | NULL; composite tenant FK RESTRICT → crm.service_contracts (P-06) |
| `title` / `title_ar` | `text` | title NOT NULL (CHECK 1..200) |
| `currency_code` | `varchar(3)` | NOT NULL; CHECK `^[A-Z]{3}$` |
| `status` | `text` | NOT NULL DEFAULT `'ACTIVE'`; CHECK IN (ACTIVE, EXPIRED, CLOSED, CANCELLED); closed-stamp coherence CHECK (CLOSED/CANCELLED ⇒ closed_at NOT NULL) |
| `valid_from` / `valid_to` | `date` | NOT NULL; CHECK from ≤ to |
| `min_commitment` | `numeric(19,4)` | NOT NULL DEFAULT 0; CHECK ≥ 0 |
| `max_commitment` | `numeric(19,4)` | NOT NULL; CHECK ≥ 0 |
| `released_amount` | `numeric(19,4)` | NOT NULL DEFAULT 0; CHECK `0 ≤ released_amount ≤ max_commitment` — advanced transactionally in the same statement as the release (the service owns the typed over-release rejection; the CHECK is the DB floor) |
| `price_lock` | `jsonb` | NOT NULL DEFAULT `'[]'`; CHECK jsonb array — `[{itemId, unitPrice, note?}]` |
| `closed_at` / `closed_by` | `timestamptz` / `uuid` | the close stamps |
| `cancel_reason` | `text` | NULL unless CANCELLED |
| `note` / `note_ar` | `text` | §10 discipline |

`blanket_releases` (append-only ledger — **NO DELETE**):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `blanket_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → blanket_orders |
| `release_no` | `text` | NOT NULL; UNIQUE per tenant (§12) |
| `release_date` | `date` | NOT NULL (§11) |
| `lines` | `jsonb` | NOT NULL; CHECK jsonb array — `[{itemId, qty, unitPrice}]` (prices from the blanket lock or explicit per-line quotes) |
| `amount` | `numeric(19,4)` | NOT NULL; CHECK > 0 (§6) |
| `purchase_order_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → purchase_orders — the generated executable PO, created in the same transaction |
| `note` | `text` | NULL |

`purchase_orders.contract_id` (addendum): NULLABLE `uuid`; composite tenant FK RESTRICT →
`service_contracts (id, tenant_id)` — contract-linked purchasing (P-06); zero reshape of
existing rows.

**Migration `0053` — supplier collaboration:**

`supplier_ratings` (the scorecard store — recompute overwrites):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `supplier_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → partners; UNIQUE per tenant — ONE row per supplier (the window moves) |
| `window_start` / `window_end` | `date` | NOT NULL; CHECK start ≤ end — the rolling window |
| `delivery_score` / `quality_score` / `price_score` / `overall_score` | `numeric(5,2)` | NOT NULL; CHECK 0..100 each; the overall is the documented weighted fold (40/40/20 — the P-04 baseline) |
| `sample_size` | `integer` | NOT NULL DEFAULT 0; CHECK ≥ 0 |
| `detail` | `jsonb` | NOT NULL DEFAULT `'{}'`; CHECK jsonb object — `{grns, onTime, invoices, debitNotes, priceVariancePct, notes}` (the evidence) |
| `computed_by` / `computed_at` | `uuid` / `timestamptz` | computed_at NOT NULL DEFAULT now() |

`approved_supplier_items` (the approved-vendor-per-item list):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `supplier_id` / `item_id` | `uuid` | NOT NULL; composite tenant FKs RESTRICT → partners/items; UNIQUE per (tenant, supplier, item) |
| `status` | `text` | NOT NULL DEFAULT `'APPROVED'`; CHECK IN (APPROVED, SUSPENDED) — suspension, not deletion |
| `approved_by` / `approved_at` | `uuid` / `timestamptz` | approved_at NOT NULL DEFAULT now() |
| `expires_at` | `date` | NULL = no expiry (§13 — enforced by the service at use time) |
| `note` | `text` | NULL |

`supplier_advances` (P-12, golden G-33):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `supplier_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → partners |
| `advance_no` | `text` | NULL until DISBURSE (the posting stamp, the payroll PR- pattern); UNIQUE per tenant |
| `currency_code` | `varchar(3)` | NOT NULL; CHECK `^[A-Z]{3}$` |
| `amount` | `numeric(19,4)` | NOT NULL; CHECK > 0 |
| `status` | `text` | NOT NULL DEFAULT `'DRAFT'`; CHECK IN (DRAFT, APPROVED, DISBURSED, CLOSED, CANCELLED) with the lifecycle stamp-shape CHECK (DISBURSED ⇔ approved_at + disbursed_at + posted_journal_id NOT NULL) |
| `applied_amount` | `numeric(19,4)` | NOT NULL DEFAULT 0; CHECK `0 ≤ applied_amount ≤ amount` |
| `approved_by` / `approved_at` | `uuid` / `timestamptz` | SoD: the approver ≠ the creator (service-enforced) |
| `cash_account_id` | `uuid` | NULL until disbursement; composite tenant FK RESTRICT → cash_accounts |
| `entry_date` | `date` | NULL until DISBURSE (§11) |
| `posted_journal_id` / `entry_no` | `uuid` / `text` | the G-33 disbursement journal's back-refs |
| `disbursed_at` / `disbursed_by` | `timestamptz` / `uuid` | the disbursement stamps |
| `cancel_reason` | `text` | NULL unless CANCELLED |
| `note` / `note_ar` | `text` | §10 discipline |

`early_payment_discount_terms` (P-13, golden G-34):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `supplier_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → partners; UNIQUE per tenant — one terms row per supplier |
| `discount_pct` | `numeric(5,2)` | NOT NULL; CHECK `0 < pct ≤ 100` |
| `discount_days` | `integer` | NOT NULL; CHECK > 0 |
| `min_invoice_amount` | `numeric(19,4)` | NOT NULL DEFAULT 0; CHECK ≥ 0 |
| `status` | `text` | NOT NULL DEFAULT `'ACTIVE'`; CHECK IN (ACTIVE, INACTIVE) |
| `approved_by` / `approved_at` | `uuid` / `timestamptz` | SoD: terms must be APPROVED (creator ≠ approver) before any capture posts; approval-coherence CHECK (approved_by set ⇒ approved_at set) |
| `note` | `text` | NULL |

**Migration `0054` — CAPEX + tender intake:**

`capex_requests` (budget-checked capital requests):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `branch_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → branches |
| `request_no` | `text` | NULL until APPROVED (the PR discipline — drafts are scratch); UNIQUE per tenant; stamp-shape CHECK (APPROVED ⇒ request_no NOT NULL) |
| `title` / `title_ar` | `text` | title NOT NULL (CHECK 1..200) |
| `description` | `text` | NULL |
| `account_id` | `uuid` | NOT NULL; composite tenant FK RESTRICT → accounts — the budget guard's dimension key |
| `cost_center_id` / `project_id` | `uuid` | NULL; composite tenant FKs RESTRICT → cost_centers/projects (§6 dimension splits) |
| `estimated_amount` | `numeric(19,4)` | NOT NULL; CHECK > 0 |
| `currency_code` | `varchar(3)` | NOT NULL; CHECK `^[A-Z]{3}$` |
| `needed_by` | `date` | NULL (§11) |
| `status` | `text` | NOT NULL DEFAULT `'DRAFT'`; CHECK IN (DRAFT, PENDING_APPROVAL, APPROVED, CONVERTED, REJECTED, CANCELLED) with the lifecycle stamp-shape CHECK |
| `submitted_at` / `submitted_by` | `timestamptz` / `uuid` | the submit stamps (NULL in DRAFT) |
| `approved_by` / `approved_at` | `uuid` / `timestamptz` | SoD: creator ≠ approver (service-enforced) |
| `rejection_reason` / `cancel_reason` | `text` | typed reasons (BR-046 lineage — required when rejecting/cancelling by the service) |
| `converted_order_id` | `uuid` | NULL until CONVERT; composite tenant FK RESTRICT → purchase_orders |
| `budget_evaluation` | `jsonb` | NULL; the PHASE-028 guard's evaluation snapshot at submit (mode + warnings — the evidence the audit surfaces) |

`tender_intakes` (intake records ONLY — no bidding-platform claims):

| Column | Type | Notes |
|--------|------|-------|
| `id` / `tenant_id` | `uuid` | PK; `(id, tenant_id)` UNIQUE |
| `intake_no` | `text` | NOT NULL; UNIQUE per tenant (§12) |
| `title` / `title_ar` | `text` | title NOT NULL (CHECK 1..200) |
| `announcing_authority` | `text` | NOT NULL (CHECK 1..200) |
| `tender_ref_no` | `text` | the authority's reference, verbatim |
| `published_at` | `date` | NULL |
| `submission_deadline` | `timestamptz` | NULL |
| `estimated_value` | `numeric(19,4)` | NULL or CHECK ≥ 0 |
| `currency_code` | `varchar(3)` | NULL; shape-checked when set |
| `our_decision` | `text` | NOT NULL DEFAULT `'PENDING'`; CHECK IN (PENDING, WILL_BID, DECLINED, WON, LOST) — recorded, nothing auto-bids |
| `decided_at` / `decision_note` | `timestamptz` / `text` | the decision stamps |
| `gov_registration_no` | `text` | DF-52 — stored verbatim, never guessed |
| `gov_registration_expiry` | `date` | DF-52 |
| `classification_code` | `text` | DF-53 |
| `source_url` | `text` | the announcement's source link |
| `status` | `text` | NOT NULL DEFAULT `'OPEN'`; CHECK IN (OPEN, CLOSED) |
| `note` / `note_ar` | `text` | §10 discipline |

## 18. Returns & collections vocabulary (PHASE-039)

Migrations `0055_rma_warranty.sql` → `0059_supplier_rma.sql` (schema_version 55…59) add
the returns & collections cluster: ten RLS'd tenant tables (0055: 3 · 0056: 3 · 0058:
2 · 0059: 2) plus the additive partner credit-risk columns (0057 — zero reshape of the
catalogued `partners` table) and two CHECK widenings (0056 §8). Same rules as every
dictionary term — no table may redefine them; the value lists below are exhaustive (the
§9 registry discipline). Table-level shape detail lives in the
[ENTITY_CATALOG.md](ENTITY_CATALOG.md) PHASE-039 rows; the journal goldens in
[../accounting/JOURNAL_RULES.md](../accounting/JOURNAL_RULES.md) §7 (G-35…G-39); the
rules in [../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md) (BR-064/BR-065).

**The value vocabularies** (all `text` + CHECK + typed TS union, §4):

| Vocabulary | Values | Used by (tables) | Migration |
|-----------|--------|-------------------|-----------|
| `return_authorization_status` | REQUESTED, APPROVED, RECEIVED, INSPECTED, RESTOCKED, SCRAPPED, REFUNDED, CANCELLED | return_authorizations | 0055 |
| `return_reason_code` | DAMAGED, DEFECTIVE, WRONG_ITEM, LATE_DELIVERY, CUSTOMER_REMORSE, OTHER | return_authorizations | 0055 |
| `rma_disposition` | RESTOCK, SCRAP, REFUND — **NULL until inspection** (the disposition gate: NULL or status INSPECTED/terminal, BR-064); maps to the terminal RESTOCKED/SCRAPPED/REFUNDED via the explicit map, never string+"ED" | return_authorizations | 0055 |
| `supplier_return_authorization_status` | REQUESTED, APPROVED, SHIPPED, CREDITED, CANCELLED — CREDITED implies `debit_note_id` + `posted_journal_id` (the lifecycle-stamp CHECK) | supplier_return_authorizations | 0059 |
| `supplier_return_reason_code` | DAMAGED, DEFECTIVE, WRONG_ITEM, OVER_SHIPMENT, EXPIRED, RECALL, OTHER | supplier_return_authorizations | 0059 |
| `warranty_status` | ACTIVE, EXPIRED, VOID | warranty_registrations | 0055 |
| `warranty_coverage` (inside `terms` jsonb) | REPAIR, REPLACE, REFUND, LABOR_ONLY, PARTS_ONLY | warranty_registrations | 0055 |
| `warranty_basis` (inside `terms` jsonb) | INVOICE_DATE, DELIVERY_DATE — the anchor the start date was resolved from | warranty_registrations | 0055 |
| `dunning_policy_status` | DRAFT, ACTIVE, ARCHIVED (archived = read-only ladder history; only DRAFT/ARCHIVED activate; one ACTIVE default per tenant) | dunning_policies | 0056 |
| `dunning_step_channel` | EMAIL, WHATSAPP, SMS (per step in `steps` jsonb) | dunning_policies, dunning_letters | 0056 |
| `dunning_letter_status` | QUEUED, SENT, FAILED | dunning_letters | 0056 |
| `late_fee_mode` | DISABLED, CONTRACT_RATE, STATUTORY_CAP | dunning_policies | 0056 |
| `collection_action_type` | CALL, EMAIL, PROMISE_TO_PAY, DISPUTE, FIELD_VISIT, PAYMENT_PLAN, WRITE_OFF_REQUEST, AGENCY_REFERRAL, OTHER | collection_actions | 0056 |
| `collection_action_outcome` | PENDING, PROMISED, BROKEN, PAID, ESCALATED, NO_ANSWER, OTHER | collection_actions | 0056 |
| `collection_agency_status` | ACTIVE, SUSPENDED — agencies suspend, never delete (the referral history is compliance evidence) | collection_agencies | 0058 |
| `agency_commission_mode` | PCT_OF_COLLECTED (pct CHECK 0 < p ≤ 100), FLAT_FEE (fee CHECK > 0) — on the agency AND snapshotted verbatim on each referral (the register may change later; the referral keeps its own terms) | collection_agencies, collection_referrals | 0058 |
| `collection_referral_status` | REFERRED, ACKNOWLEDGED, PARTIAL, SETTLED, COMMISSION_POSTED, CLOSED, CANCELLED — settlement precedes commission; COMMISSION_POSTED implies `commission_amount` + `commission_journal_id` (the exactly-once G-39 stamps) | collection_referrals | 0058 |
| `partner_credit_score_class` | NULL or A, B, C, D | partners (additive) | 0057 |

**Warranty terms shape (S-15).** `warranty_registrations.terms` jsonb — the DB CHECK
pins the json object type only; the service validates the typed shape
`{ durationMonths: int 1..120, coverage, basis, mileageLimitKm?: int > 0 }`.
`end_date` = start + durationMonths in WHOLE UTC months, month-end clamped (Jan 31 + 1
month lands on Feb 28/29, never March 3). The daily expiry sweep notifies ACTIVE
warranties entering the 30/7/0-day windows — one inbox notification per window, deduped
by `warranty-expiry:{id}:{window}`, category `warranties`.

**Late-fee modes (L1-12) — REQUIRES_VERIFICATION.** `CONTRACT_RATE` requires its
positive rate pct (the tenant's contractual rate); `STATUTORY_CAP` requires the positive
rate **AND** its `late_fee_source` jurisdiction citation (3..500 chars) — the verified
evidence a statutory cap may lean on: the DB CHECK (`ck_dunning_policies_late_fee_shape`)
refuses the row without the source, and the charge path re-verifies at CHARGE time — a
statutory cap without verified source evidence refuses to charge (worksheet mode).
`DISABLED` carries nothing. Grace `late_fee_grace_days` 0..365; `late_fee_max_amount`
the optional cap.

**Letter delivery evidence.** EMAIL letters store the deterministic bilingual snapshot
(subject + body) and the contact email on the letter row and mark SENT — the register IS
the delivery evidence (the EmailService template union is closed; a partner with no
email on file FAILS the letter — the step stays consumed, the register never lies about
delivery). WHATSAPP/SMS letters persist QUEUED — delivered post-041 through the channel
port (the phase doc's explicit deferral).

**Promise discipline.** A `PROMISE_TO_PAY` action requires its `promised_date` (the DB
CHECK + the typed service pre-flight so the client sees a 422, never a driver error).

**The agency callback token.** `portal_token_hash` — a 256-bit random hex value,
sha256-hashed at rest (CHECK `^[a-f0-9]{64}$` + `token_issued_at`); the raw token is
shown ONCE at issuance and never stored (re-issuing rotates it). The public callback
route resolves the tenant pre-GUC through `erp.portal_resolve_agency_token` (a read-only
SECURITY DEFINER projection), then the service re-validates under RLS — the 038
supplier-portal pattern verbatim ([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md)
§3.17).

**Partner credit risk (0057, additive).** `credit_score_class` is tenant-entered or
rule-computed locally — **never an external scoring claim**. The tenant's blocked class
(setting `sales.credit_block_class`, default `D`) behaves EXACTLY like an over-limit
breach in the BR-001 credit check: same posture shape (warn/block/allow per
`sales.credit_limit_action`), reason `CREDIT_CLASS_BLOCKED`, and a review landing on the
blocked class raises the `collections` notification. The review clock:
`credit_review_frequency_days` NULL or ≥ 7, `next_credit_review_at` NULL or set —
both-or-neither (CHECK); NULL frequency = no periodic review. The review outcome history
rides the existing `audit_events` machinery (no new history table); the outcome stamps
`last_credit_review_at`/`by` + `credit_review_note` on the partner.

**The 0056 §8 CHECK widenings (the §11b 0051 discipline):**

- `notifications` + `notification_prefs` category += `collections` (dunning letters,
  escalations, credit reviews and class blocks, RMA completions) and `warranties` (the
  expiry sweep).
- `cash_movements` source_type += `return_authorization` — the G-37 refund leg's
  treasury movement (base at rate 1, the G-33 disbursement pattern).

**The stock-move source deviation (0059, documented).** The supplier-RMA ship leg's
inventory issues ride the GENERIC `manual_issue` stock-move source with the reason
marker `SUPPLIER_RETURN` and `source_id` = the SRMA — the `stock_moves` source CHECK was
deliberately NOT widened for a new source type (the 0059 no-widening note); the ledger
leg rides the G-38 ship journal (DR the mapped returns account · CR INVENTORY at issue
cost). Cross-link: [../accounting/JOURNAL_RULES.md](../accounting/JOURNAL_RULES.md)
§7/note 12.
