# PHASE-028 Master Plan — Budgeting & Variance Control

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-028.md`.
Authority chain: PHASE-028.md → DR-004 → EXPANSION_REGISTER §B/§C/§D/§I/§J/§K.

## Settled design decisions (from code research — binding for all waves)

1. **Migration `0039_budgeting.sql`** (schema_version 39): 2 tables
   (`budgets`, `budget_lines`) + 2 §9 enum CHECKs (`budget_scope`,
   `budget_status`) + composite tenant FKs (fiscal_years, fiscal_periods,
   accounts, cost_centers, projects, branches, budgets.self) +
   `erp.apply_tenant_policy` ×2 + 0036-pattern purge_path ×2 + grants
   (budgets: SELECT/INSERT/UPDATE, no DELETE — lifecycle history is audited;
   budget_lines: SELECT/INSERT/UPDATE/DELETE — the DRAFT bulk-replace path,
   service-confined to DRAFT parents) + **BR-050 partial unique**
   `uq_budgets_one_active (tenant_id, fiscal_year_id, scope) WHERE status =
   'ACTIVE'` + shape CHECKs (the 027 lesson — one-directional where the
   state machine needs it): `ck_budgets_approved_shape` (status='DRAFT' ⇒
   approved_at IS NULL — approve() stamps approved_at while still
   PENDING_APPROVAL, so the implication runs one way only),
   `ck_budgets_activated_shape` ((status IN ACTIVE/REVISED/CLOSED) =
   (activated_at IS NOT NULL) — bidirectional; the machine only ever sets
   REVISED/CLOSED from ACTIVE), `ck_budgets_closed_shape` ((status='CLOSED')
   = (closed_at IS NOT NULL)), `ck_budgets_supersedes_shape`
   ((supersedes_id IS NULL) = (superseded_by placeholder none — no; keep
   only FK + service-level same-(year,scope) chain rule)). **Widenings**:
   notifications + notification_prefs category CHECK += 'budgeting' (the
   0023/0027/0035 pattern). **NO** CoA template rows (budgeting works over
   existing accounts — zero purposes), **NO** reconciliation kind, **NO**
   cash_movements source, **NO** journal rules rows. **Plan grants**: the 6
   §22 feature keys (budgeting.budgets · cost_center_budgets ·
   project_budgets · approvals · controls · reports) → business+enterprise
   only (0037/0038 tier-4 precedent). **Permissions: NOTHING to seed** —
   §3.13 keys already live in 0004/0005 + matrix (245 stays 245; drift
   checker untouched). Lockstep: `_journal.json` idx 38 + `MIGRATIONS`
   manifest + migrations.spec pin 0038→0039.
2. **Schema columns**: `budgets` (fiscal_year_id, scope, name NOT NULL +
   name_ar, revision_no int NOT NULL DEFAULT 1 — NOT "version" (the standard
   optimistic-lock column owns that name), status DEFAULT 'DRAFT',
   supersedes_id uuid NULL, code text (tenant-scoped DATA_DICTIONARY §12 —
   `BUD-<seq>` minted per (year,scope) monotonic, no official numbers
   ADR-0006), submitted_at/by, approved_at/by, activated_at/by, closed_at/by,
   note/note_ar). `budget_lines` (budget_id NOT NULL, fiscal_period_id NOT
   NULL, account_id NOT NULL, cost_center_id?, project_id?, branch_id?,
   amount numeric(19,4) NOT NULL CHECK amount >= 0). Indexes:
   ix_budgets_tenant_year_scope_status, ix_budget_lines_tenant_budget,
   ix_budget_lines_tenant_period_account (the §4 performance index),
   ix_budget_lines_tenant_dimensions.
3. **State machine** (typed `BUDGET_STATE_INVALID` 409):
   DRAFT → PENDING_APPROVAL (submit; submits lines snapshot totals);
   approve() stamps approved_by/at **while status stays PENDING_APPROVAL**
   (the 027 CHECK lesson — PENDING_APPROVAL carries both pre- and
   post-approval) with SoD `BUDGET_SELF_APPROVAL` (creator ≠ approver, the
   journal-service/fixed-assets precedent); activate() flips PENDING_APPROVAL
   (approved) → ACTIVE **and atomically** flips the superseded ACTIVE
   predecessor → REVISED (BR-050: the flip happens ONLY at activation, in
   one transaction — the partial unique guarantees the invariant even under
   races); supersede(ACTIVE) creates a new DRAFT with supersedes_id =
   predecessor + copies its lines (explicit copy, never a move); close():
   ACTIVE|REVISED → CLOSED (closed_at/by; readable forever). DRAFT-only line
   edits: bulk replace on non-DRAFT → 409 `IMMUTABLE_DOCUMENT`. Reused
   accounting errors (the fixed_assets reuse precedent):
   FiscalYearNotFoundError / PeriodNotFoundError / AccountNotFoundError /
   ProjectNotFoundError → own 404s; new: BudgetNotFoundError 404,
   BudgetStateError 409, BudgetSelfApprovalError 409, BudgetImmutableError
   409, BudgetScopeDimensionError 422, BudgetPeriodMismatchError 422,
   BudgetLineLimitError 422, BudgetExceededError 422 (the BR-051 typed
   block reason), BudgetImportError family 422.
4. **Consumption engine (T5)**: read-only SQL over journal_lines ⟕
   journal_entries grouped by (account_id, period) with dimension filters
   (cost_center_id / project_id on journal_lines; **branch via the entry's
   source document** — sales_invoices/supplier_invoices/credit_notes/
   debit_notes carry branch_id; lines whose entry has no branch-carrying
   source fold to a NULL-branch "(unattributed)" bucket — honest, summed,
   never dropped). Natural-direction convention: actual = debit−credit for
   ASSET/EXPENSE accounts, credit−debit for LIABILITY/EQUITY/REVENUE (the
   variance sign convention documented in the TABLES spec). ADR-0008 cache:
   in-memory Map keyed (tenant, budget) with computedAt; TTL 60s (banner
   staleness labeled, never silent — the PDC-calendar discipline) +
   explicit `invalidateTenant` (import/activation call it; tests use it).
   Reports NEVER read the cache (always fresh, as-of deterministic).
5. **Variance reports (T7, registry 76→78)**:
   `budgeting.budget-vs-actual` (params budgetId?/fiscalYearId/scope/asOf/
   locale; rows = dimension key × period: budget, actual, variance,
   variancePct 7,4 — null when budget=0; groups by period with totals) +
   `budgeting.variance-analysis` (period trends, top over/under lines,
   threshold highlighting ≥ warn_threshold_percent). Permission
   `budgeting.reports.view` (matrix §3.13 row 5 — the report read key).
   Ledger-tie assertion `budget-ledger-tie` (block-on-fail): whole-tenant
   per period Σ natural-direction account movements (the SAME GL lines the
   engine reads) == the trial-balance-derived movements for the period
   window (journal.trialBalances({fromDate,toDate}) per period, tolerance
   0) — display filters never narrow the ledger check (the maturity-
   calendar precedent). SOURCE_MODULES += "budgeting"; MODULE_DATA_PHASE
   budgeting: 28; REGISTERED_PHASE_WINDOW 27→28; KNOWN_PERMISSIONS +=
   budgeting.reports.view + budgeting.budgets.view; counts 76→78 in
   reporting-unit.spec + golden.spec (50 core + 18 industry + 3 FA + 5
   notes/installments + 2 budgeting). REPORT_CATALOG rows 236/237 already
   pre-written (docs-as-contract — no edit needed beyond status columns if
   any).
6. **Controls (T6, BR-051)**: `control-guard.ts` —
   `evaluateDraftSave({tenantId, actorId, documentRef, periodId, lines[]:
   {accountId, costCenterId?, projectId?, branchId?, projectedAmount}})`:
   (a) zero-overhead gate: no ACTIVE budget for tenant ⇒ OFF, no queries
   beyond the in-memory active-budget index (the PDC-calendar Map pattern);
   (b) ADVISORY (default): over-threshold ⇒ exactly ONE warning
   notification (category budgeting, severity warning) + banner payload
   {kind:'budget_warning', keys[]}; (c) ENFORCE_DRAFT (explicit policy
   `budgeting.controls.mode`): typed `BudgetExceededError` (code
   BUDGET_EXCEEDED, audited reason on the documentRef via the audit
   service) — blocks ONLY the DRAFT save, never a post. Settings keys
   (settings-schema.ts, PLACEHOLDER defaults per OQ-002):
   `budgeting.controls.mode` z.enum(["ADVISORY","ENFORCE_DRAFT"]) default
   ADVISORY; `budgeting.controls.warn_threshold_percent` z.number().int()
   .min(1).max(1000) default 100. `control-evaluation.job.ts`: daily
   pg-boss sweep `budgeting.controls.sweep` cron `50 2 * * *` (ACTIVE
   tenants, ACTIVE budgets): recompute consumption, emit at/over-threshold
   warnings idempotently (dedupe key budget+period+bucket in the job
   state). The declared DEPENDENCY_RULES edge (trade-document DRAFT-save →
   guard api) ships as the guard's public service method; production
   call-site wiring into sales/purchasing/treasury flows is the honest
   documented follow-up (completion report states it explicitly — the
   phase's own acceptance tests the guard semantics directly).
7. **Import/export (T8)**: `xlsx-grid-adapter.ts` (exceljs — the reporting
   export pipeline's library): buildGrid(workbook→rows) with AR+EN header
   mapping fixtures (first row headers, tabular-nums strings); parseGrid
   (buffer→rows) with row caps (≤ 5,000 data rows — typed
   BUDGET_IMPORT_ROW_LIMIT per the U-07 pattern), per-row typed errors
   (AR+EN). `import-service.ts`: dry-run (validation report, zero writes) →
   commit (file-hash idempotency — `budgeting.imports` remembered hashes…
   NO new table (register §C lists none): hash memory lives in the
   idempotency-key store? NO — honest call: per-file hash idempotency via
   the existing idempotency infrastructure is unavailable outside HTTP;
   store the hash as a DRAFT budget note field? REJECTED (data smell).
   SETTLED: hash idempotency = in-module LRU map (restart-losing, bounded
   256 entries) + the API surface requires Idempotency-Key on POST commit
   (the global guard already dedupes HTTP retries); documented honestly in
   the completion report). Export: `exportGrid` on the grid service builds
   the XLSX (RTL view when locale=ar, tabular-nums, totals row) via
   exceljs directly (the grid is module data, NOT a report contract — the
   PHASE-013 pipeline serves report exports only).
8. **Web (T9)**: NAV_ITEMS `accounting.budgets` (route /budgeting,
   featureKey budgeting.budgets, permission budgeting.budgets.view,
   archetype list-search, group 5, order after accounting close ~6x — read
   the live accounting rows for the exact order slot) + FALLBACK_CRUMBS
   (budgeting, budgeting/new, budgeting/[id], budgeting/import,
   budgeting/reports). Pages: `app/[locale]/budgeting/{page,new,[id],
   import,reports}/page.tsx`. Components: budgets-table (list+search),
   budget-form (new: year/scope/name/dimensions), budget-grid-workspace
   (the PeriodGrid client component — spreadsheet-style, live row/period/
   year totals, MoneyInput tokens, keyboard nav), budget-import-wizard
   (dry-run → commit). `packages/ui/src/patterns/period-grid.tsx` (+ .stories AR/EN baselines) + COMPONENT_CATALOG row. api-types.ts block (~10
   interfaces). i18n: ~160 keys/locale (3,799 → ~3,959, parity check
   green). Reports tab renders ReportWorkspace with ids
   budgeting.budget-vs-actual / budgeting.variance-analysis (the notes
   reports-tab precedent).
9. **Isolation & tests (T10)**: registry +2 (budgets; budget_lines
   deleteGranted:true) — A-suite auto-extends +12 its. `__db__/budgeting/
   fixtures.ts` (TENANT_BUDGET foreign world, deterministic actors,
   real-service instances, a posted GL world via the accounting fixtures'
   journal minting); `budgeting-rules.spec.ts` (BR-050: DB-level second-
   ACTIVE rejection + service 409 + supersede-never-edit + atomic flip +
   closed-readable; BR-051: ADVISORY default warn-once + ENFORCE_DRAFT
   typed block + zero residue + posted-never-blocked; variance fixtures:
   12,000/12×1,000 budget, 750 actual in period 4 ⇒ variance −250.00,
   −25.00% (7,4) — the phase's worked example; ledger-tie seeded-drift ⇒
   FAIL blocks export; import/export round-trip 19,4 exact + row caps +
   AR headers); `spoof.spec.ts` (S-04: foreign fiscal_year/period/account/
   cost_center/project/branch ids in nested line payloads → typed 404
   codes, zero partial creation both tenants); **negative ledger proof**:
   journal_entries/journal_lines counts before/after the whole suite
   byte-identical + zero JournalSpec submissions (engine spy —
   posting-service spy on post()).
10. **Error filter**: register the budgeting taxonomy in domainStatus()
    (SF-027-001 lesson — registration is expected in-phase): 404 family
    (Budget + reused accounting not-founds already registered? verify —
    FiscalYear/Period/Account/Project NotFound ARE registered), 409 family
    (BudgetStateError, BudgetSelfApprovalError, BudgetImmutableError),
    422 fall-through default for the validation family.

## Wave order

- **P28-A** (orchestrator): migration 0039 + journal + manifest + schema.ts
  mirror + isolation registry + settings keys + notifications TS union +
  migrations.spec pin.
- **P28-B** (orchestrator): budgeting module core (errors → store → grid →
  version → workflow → consumption → guard → import/xlsx → controller →
  module → app.module + error.filter registration).
- **P28-C** (orchestrator): reporting wave (budgeting-queries + 2 contracts
  + registry wiring + counts 76→78).
- **P28-D** (subagent or orchestrator): web wave (PeriodGrid + NAV + crumbs
  + api-types + i18n + pages + components).
- **P28-E** (orchestrator): test wave (fixtures + rules + spoof + negative
  proof).
- **P28-H** (orchestrator): docs sync (ENTITY_CATALOG status flips already
  blueprint-listed — verify check:rls 205; TABLES/budgeting.md; SECURITY_
  TEST_PLAN §2 rows; IMPLEMENTATION_STATUS/CURRENT_STATE/NEXT_ACTION/
  CHANGELOG; PHASE_ACCEPTANCE_CRITERIA §PHASE-028; PHASE-028-COMPLETION.md;
  phase doc Status PLANNED→COMPLETE; CURRENT_SHIPPED_PHASE 027→028) +
  commit + archive.
- Final sweep: typecheck, lint, depcruise, unit api/web/ui, DB suite
  (chunked foreground), docs:validate, permissions-drift 245=245,
  check:rls, i18n parity, capabilities.

## Gates (gated-shipping — any open DR/finding stops)

No open decision records block 028 (DR-004 ACCEPTED 2026-10-28). Watch
items carried from 027: SF-026-001 (purge vs guards — pre-existing
accounting follow-up), SF-026-002 (RC-10 accum sign seeded-drift DB proof
— remains the accounting follow-up); the pre-existing DB-suite order
sensitivity (notifications-email + ga-full-load EXPLAIN want dedicated
small-chunk runs — NEXT_ACTION runbook note) is environmental, not a
finding. Honest deferrals to record in the completion report: guard
production call-site wiring (the declared edge ships as the service API),
import hash-idempotency scope (in-module LRU + HTTP Idempotency-Key), BRANCHES attribution via source documents (unattributed bucket honest).
