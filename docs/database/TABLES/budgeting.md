# TABLES — Budgeting Cluster (PHASE-028)

> **Status:** DELIVERED (PHASE-028, migration `0039_budgeting.sql`, schema_version
> 39) · **Owner:** Database Architecture · **Updated:** 2026-11-08 · Column-level
> specs for the PHASE-028 cluster (the versioned budget register + its period
> grid), authored in-phase per the file header rule
> (ENTITY_CATALOG §budgeting is the catalog-level map; this file is the
> column-level truth). ADR-0009 precision discipline throughout: money quanta
> `numeric(19,4)` non-negative (decimal strings on the wire, never floats, no
> `Math.*`). RLS macro on every table; the isolation registry covers each
> (A1–A10). **No table here writes `journal_*` or `cash_movements` — budgets are
> NOT ledger documents (DR-004): the module reads the GL for variance and is
> structurally ledger-incapable (the rules suite's negative proof greps the
> store for journal-table writes and snapshots the journal counts before/after
> the full operation set).**

## §budgets — the version register (T2)

One row per budget version. `scope` CHECK `ACCOUNTS|COST_CENTERS|PROJECTS|BRANCHES`
(§9 `budget_scope` — scope is a filter, not a fork: all four share one engine and one
report set); `status` CHECK `DRAFT|PENDING_APPROVAL|ACTIVE|REVISED|CLOSED` (§9
`budget_status`; default DRAFT). **BR-050** is the core DB invariant: the partial
unique `uq_budgets_one_active (tenant_id, fiscal_year_id, scope) WHERE status =
'ACTIVE'` — exactly one ACTIVE version per (fiscal year, scope); the service flips
the ACTIVE predecessor to REVISED FIRST and only then activates the successor (one
ambient transaction, so the unique holds throughout; `BUDGET_ACTIVE_EXISTS` 409 is
the typed service message, the partial unique is the race backstop).
`revision_no` (int ≥ 1, DEFAULT 1 — NOT "version": the standard optimistic-lock
integer owns that column name) counts the supersede chain depth;
`supersedes_id` (composite FK → budgets, RESTRICT — same-(year, scope) enforced at
the service level) links a revision draft to its predecessor; revisions supersede,
never edit. `code` is the tenant-scoped natural key (DATA_DICTIONARY §12) minted
`BUD-<yearStart>-<seq>` per (tenant, year, scope) under a `FOR UPDATE` serialization
(CHECK `^BUD-[0-9]{4}-[0-9]{1,6}$` — **no official numbers**: a budget is planning
data, not a document, ADR-0006). `name` (NOT NULL, 1..200) + `name_ar` + the
`note`/`note_ar` memo pair. The lifecycle stamps with their shape CHECKs (the 027
CHECK-discipline lesson — encode exactly what the machine produces):
`ck_budgets_approved_shape` (status='DRAFT' ⇒ approved_at IS NULL — **one-directional**:
approve() stamps approved_at while the status is STILL PENDING_APPROVAL, so pre- and
post-approval both live there); `ck_budgets_activated_shape` ((status IN
ACTIVE/REVISED/CLOSED) = (activated_at IS NOT NULL) — bidirectional: the machine only
ever sets REVISED/CLOSED from an ACTIVE row); `ck_budgets_closed_shape` ((status
='CLOSED') = (closed_at IS NOT NULL)). Constraints: `uq_budgets_id_tenant`. Indexes:
`ix_budgets_tenant_year_scope_status` (the listing/activation-path guard pair),
`ix_budgets_tenant_supersedes` (the chain walk). Grants: SELECT/INSERT/UPDATE for
`erp_app` — **no DELETE**: the version chain is audited history, REVISED/CLOSED stay
readable for variance truth.

## §budget_lines — the period grid (T3)

One row per (dimension key × fiscal period) — 12 rows per account for a standard
year (the grid adapts to the tenant's actual REGULAR period count; the
OPENING/CLOSING system periods of the fiscal calendar are not planning columns).
`budget_id` composite FK → budgets (RESTRICT); `fiscal_period_id` composite FK →
fiscal_periods (RESTRICT — must belong to the parent budget's fiscal year, typed
`BUDGET_PERIOD_MISMATCH` at the service); `account_id` composite FK → accounts
(RESTRICT — postable only, `ACCOUNT_NOT_FOUND`); the optional dimensions
`cost_center_id`/`project_id`/`branch_id` (composite FKs, RESTRICT — exactly the
scope's dimension is REQUIRED per line and the others must be NULL,
`BUDGET_SCOPE_DIMENSION`; scope ACCOUNTS carries none). `amount` (19,4, CHECK ≥ 0).
**Mutable only while the parent is DRAFT** — 409 `IMMUTABLE_DOCUMENT` on non-DRAFT
bulk replace (the phase §4 contract); REVISED/CLOSED versions freeze rows at the
version level (the service never deletes a non-DRAFT parent's lines — the
whole-grid replace is DELETE+INSERT inside the ambient UoW, service-confined).
Constraints: `uq_budget_lines_id_tenant`. Indexes:
`ix_budget_lines_tenant_period_account` (the §4 performance index — consumption
queries bounded by (tenant, fiscal_period, account)), `ix_budget_lines_tenant_budget`
(the grid read), `ix_budget_lines_tenant_dimensions` (the dimension drill). Grants:
SELECT/INSERT/UPDATE/**DELETE** for `erp_app` — the DELETE exists for the DRAFT
bulk-replace path only (the 0038 `installment_lines` precedent).

## The consumption read model (T5 — the variance substrate, SELECT-only)

Actuals are read from the GL by the ONE shared query
(`infrastructure/budgeting.store.actualsForPeriods`): journal_lines ⟕ journal_entries
⟕ fiscal_periods grouped by (period, account, scope-dimension) — debit and credit
summed separately; the natural-direction convention applies at the consumer (actual =
debit−credit for ASSET/EXPENSE, credit−debit for LIABILITY/EQUITY/REVENUE). The
BRANCHES dimension derives through the entry's **source document**
(sales_invoices/supplier_invoices/credit_notes/debit_notes own `branch_id`) via a
LATERAL fold — lines whose entry carries no branch-attributable source land in the
NULL (unattributed) bucket, which the variance report renders explicitly (never
silently dropped, never double-counted). The `budget-ledger-tie` block-on-fail
assertion folds the dimension groups back per (period, account) and compares against
the accounting module's OWN trial-balance read for the same window (an independent
code path — aggregation drift surfaces as a blocked export, never a silently wrong
number; tolerance 0, whole tenant). The engine never writes journal tables
(ADR-0007/INV-022; the negative ledger proof).

## RLS, purge path, grants & roles

Both tables carry the house macro `erp.apply_tenant_policy` (TENANT_ISOLATION §2) +
the 0036-pattern `purge_path_delete`/`purge_path_update` policies confined to
`erp_migrate` + the GUC-named tenant. Grants per table as noted above
(`erp_readonly`/`erp_definer` get SELECT on both). The isolation registry covers both
(A1–A10; `budget_lines` deleteGranted for the DRAFT path; S-04 spoof battery over the
foreign year/period/account/cc/project/branch/budget ids → typed 404s, zero partial
creation).
