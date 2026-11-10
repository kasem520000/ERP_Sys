# Data Dictionary — Shared Column Semantics

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-11-07

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
