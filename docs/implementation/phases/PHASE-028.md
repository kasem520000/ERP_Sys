# PHASE-028 — Budgeting & Variance Control

> **Status:** COMPLETE · **Updated:** 2026-11-08 (delivered per
> [reports/PHASE-028-COMPLETION.md](reports/PHASE-028-COMPLETION.md); the
> task-table drift was corrected in-delivery: the migration is `0039_budgeting.sql`
> (not 0028), the web pages live under `apps/web/app/[locale]/budgeting/**`, and
> the test suites under `apps/api/src/__db__/budgeting/**` — the repo
> conventions the master plan pinned)

## 1. Phase Overview

- **Phase ID:** PHASE-028
- **Title:** Budgeting & Variance Control
- **Objective:** Deliver the `budgeting` module per ED-04 and
  [DR-004](../../decisions/accounting/DR-004-budgeting.md): versioned budgets per
  fiscal year over four scopes (`budget_scope`: ACCOUNTS, COST_CENTERS, PROJECTS,
  BRANCHES) with period-level amounts, the DRAFT → PENDING_APPROVAL → ACTIVE →
  REVISED → CLOSED lifecycle with segregation-of-duties approval, a
  budget-vs-actual variance engine that consumes GL actuals **strictly read-only**,
  the `budgeting.budget-vs-actual` and `budgeting.variance-analysis` report
  contracts on the PHASE-013 engine, XLSX grid import/export, and **advisory-by-
  default** overspend controls (BR-051). Budgets are **not** ledger documents:
  the module defines no posting rules, creates no journal entries, and can never
  block the posting engine — a constraint this phase proves with a negative test,
  not just a promise.
- **Business value:** The budget is the compass of the fiscal year
  ("الموازنة بوصلة العام"): the accountant (P-02) plans the year in a familiar
  period grid per account/cost center/project/branch, the owner (P-01) sees
  variance per period without spreadsheets, and DRAFT documents warn before
  overspend — while the ledger stays untouched by planning data, so the books
  never stop being the single source of truth.

## 2. Scope

In scope:

1. **Budget versions** (`budgeting.budgets`): `budgets` (fiscal_year_id, scope,
   name, version, status, supersedes_id) + `budget_lines` (budget_id,
   fiscal_period_id, account_id, cost_center_id?, project_id?, branch_id?,
   amount) — all tenant-owned, RLS, composite tenant FKs, UUIDv7 per
   [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md)/
   [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md). **BR-050**: at most
   one ACTIVE budget version per (fiscal year, scope) — partial unique index
   `(tenant_id, fiscal_year_id, scope) WHERE status = 'ACTIVE'`; revisions
   **supersede** (new version + `supersedes_id` chain), they never edit an
   ACTIVE budget. Budgets carry tenant-scoped codes
   ([DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §12) — **no official
   numbers**: a budget is planning data, not a document.
2. **Period-level amounts**: every dimension line (account, optionally cost
   center/project/branch) is entered as one `budget_lines` row **per fiscal
   period of the budget's fiscal year** (12 rows for a standard year; the grid
   adapts to the tenant's actual period count). Amounts are `19,4` per
   [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md); every period
   row must belong to the budget's `fiscal_year_id` (typed rejection otherwise);
   line totals, period totals, and year totals render live in the grid.
3. **Approval workflow** (`budgeting.approvals`): DRAFT → PENDING_APPROVAL →
   ACTIVE → REVISED → CLOSED (`budget_status` enum). Submit for approval,
   approve (`budgeting.budgets.approve` — **SoD row in
   [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §4**:
   creator cannot approve), activate (`budgeting.budgets.activate`), supersede
   (revision draft copies the superseded version's lines), close (year-end or
   manual; closed budgets stay readable for variance history). Every transition
   is audited; non-DRAFT budgets reject line edits (409 `IMMUTABLE_DOCUMENT`).
4. **Budget-vs-actual engine** (`budgeting.reports` substrate): actuals per
   (scope key, fiscal period) are read from the **accounting module's GL read
   services** — the same query services that feed the PHASE-013 financial
   reports — **read-only**; the engine never recomputes the GL, never writes
   journal tables ([ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)
   monopoly preserved), and caches consumption per
   [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) with invalidation on
   posting/reversal/period events; heavy variance recalculations execute as
   pg-boss jobs through the PHASE-013 run orchestration.
5. **Variance reports** (Report Page archetype): `budgeting.budget-vs-actual`
   (budget, actual, variance, variance % per account/cost center/project/branch
   × period, with drill-down to journals via the standard chain) and
   `budgeting.variance-analysis` (period trends, top over/under-budget lines,
   threshold highlighting). Registered in
   [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) with provenance =
   `budgeting` + accounting read models (REPORT_CATALOG rule: no source of truth
   → no report); each contract carries a ledger-tie assertion — Σ actuals per
   period = the trial balance's period movements — and a failed assertion blocks
   export (PHASE-013 semantics).
6. **ADVISORY controls** (`budgeting.controls`, BR-051): on DRAFT-stage document
   saves across sales/purchasing/treasury/expenses, a bounded guard job evaluates
   projected period consumption for the document's affected dimension keys and
   emits a warning (notification + banner) at/over budget. **Advisory by
   default** — policy keys documented in the settings schema:
   `budgeting.controls.mode = ADVISORY` (default) | `ENFORCE_DRAFT`, and
   `budgeting.controls.warn_threshold_percent = 100` (PLACEHOLDER default
   pending the OQ-002 pricing pass). Hard-block exists **only** when the tenant
   explicitly sets `ENFORCE_DRAFT` — and even then it applies **only** at the
   DRAFT-stage save/approval step of a document, as a typed, visible,
   **audited** `BUDGET_EXCEEDED` reason on the document, never as an engine
   side-effect ([DR-004](../../decisions/accounting/DR-004-budgeting.md):
   `PostingEngine.post` has no budget call site at all). **Honesty note
   (binding): the ledger is never blocked by budgets — not by default, not by
   policy; posted documents are never warned at or after posting.**
7. **Cost-center, project & branch budgets**: scope COST_CENTERS grids under
   `budgeting.cost_center_budgets`, scope PROJECTS under
   `budgeting.project_budgets` (projects + journal-line `project_id` exist from
   PHASE-019, transitively COMPLETE at GA), scope BRANCHES under
   `budgeting.budgets` (branch dimension on account lines). All four scopes
   share one engine and one report set — scope is a filter, not a fork.
8. **Import/export of budget grids** (`budgeting.budgets`): XLSX export through
   the PHASE-013 pipeline (exceljs, RTL-correct views, tabular-nums); XLSX
   import as a Wizard (§9) with dry-run validation (row caps, typed error
   report per row), idempotency per file hash (PHASE-008 statement-import
   pattern), Arabic-header mapping fixtures.
9. **UI per archetypes** ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)):
   List+Search (§2, budgets), a budget-grid workspace as a Transaction Entry
   Workspace (§4) **variant with fiscal-period columns** (spreadsheet-style
   keyboard navigation, live row/period/year totals, `MoneyInput` tokens),
   Approval Queue (§6, pending budgets), Wizard (§9, XLSX import), Report Page
   (§7, variance). Navigation item **الموازنات / Budgets** under المحاسبة /
   Accounting (group 5) per ED-12
   ([NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1 — registry row with
   bilingual label, archetype, permission `budgeting.budgets.view`, featureKey
   `budgeting.budgets`). The group count stays 9 until PHASE-029 adds group 10.
10. **Isolation & rule tests**: `budgets`/`budget_lines` enter the isolation
    registry (A1–A10; S-04 zero-partial on nested payloads; A7 on all routes);
    attack rows per [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md)
    §2 PHASE-028 (foreign fiscal_year_id / fiscal_period_id / account_id /
    cost_center_id / project_id / branch_id references → typed rejection);
    `budgeting-rules.spec` for BR-050/BR-051 per
    [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) §8 matrix.

Out of scope (explicit):

- **Budgets are not ledger documents**: no journal entries, no posting, no GL
  writes of any kind — budgeting defines zero rows in
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 and zero goldens; the
  module is a planning + variance layer over the ledger, and it must stay
  structurally incapable of ledger writes.
- Cash-flow forecasting (the indirect-method statement exists in PHASE-013;
  forward-looking cash plans are a future decision record).
- Driver-based planning models (headcount- or revenue-driver models).
- Multi-year rolling forecasts (future decision — see
  [DR-004](../../decisions/accounting/DR-004-budgeting.md)).
- Hard enforcement on posted documents — impossible by design, not merely by
  configuration: there is no code path from budgeting into the posting pipeline.

## 3. Prerequisites

- Required phases: **PHASE-025 COMPLETE (GA gate)** — stage-9 entry per ED-01;
  the gate guarantees PHASE-001…024 transitively COMPLETE (verified via
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) rows +
  completion reports + green CI), which is what makes fiscal periods, cost
  centers, projects, branches, and the reporting engine available to consume.
- **PHASE-007** (accounting core) — consumed artifacts: fiscal years/periods
  (exclusion constraint, OPEN/SOFT_CLOSED/LOCKED statuses), the cost-center
  dimension on journal lines (scope COST_CENTERS), the GL balance/query
  services + drill-down chain that the variance engine reads, the approval-
  policy service pattern (reused for budget approvals), and audit events.
- **PHASE-013** (reporting engine) — consumed artifacts: the report-contract
  registry (zod boot validation), run orchestration (inline vs pg-boss),
  permission re-resolution at execution, the XLSX export pipeline, and the
  a4-report print template for variance packs.
- Transitive at GA: PHASE-019 (`projects` table + journal-line `project_id` —
  scope PROJECTS), PHASE-004 (branches — scope BRANCHES).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)
  (budgeting never writes GL tables; actuals are read-only),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (amounts 19,4;
  variance percentages 7,4),
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (RLS on both new
  tables + isolation attack rows),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (budgets get
  tenant-scoped codes, never official numbers — no document identity),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (variance
  recalculation jobs, advisory-control evaluation jobs, import parse jobs).
- Relevant documentation:
  [DR-004](../../decisions/accounting/DR-004-budgeting.md) + ED-04
  ([EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §A/§B),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §budgeting (keys:
  `budgeting.budgets` · `budgeting.cost_center_budgets` ·
  `budgeting.project_budgets` · `budgeting.approvals` · `budgeting.controls` ·
  `budgeting.reports`),
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (blueprint-level
  `budgeting` section per ED-19),
  [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §6 (19,4) + §9
  (`budget_scope`, `budget_status`),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-050, BR-051),
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (rows
  `budgeting.budget-vs-actual`, `budgeting.variance-analysis`; provenance +
  §13 cross-catalog rules),
  [REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md) (contract schema),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.13
  (`budgeting.budgets.view|create|approve|activate`) + §4 (SoD
  `budgeting.budgets.approve`),
  [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) (budget close vs
  period close — no new close checks; budgets ride the calendar),
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (nothing new — INV-001…026 untouched; INV-022 is the boundary that keeps
  planning data from ever altering journal math, cited to make the zero-delta
  explicit),
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md),
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md),
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1/§2,
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (no rows added — planning data is not an offline surface),
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2 +
  [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) (new declared
  edge: trade-document DRAFT-save flows may call the budgeting guard api, only
  when `budgeting.controls` is entitled — zero overhead otherwise).

## 4. Design Impact

- **Database changes:** two tenant-owned tables `budgets` + `budget_lines`,
  RLS + composite FKs + indexes (`(tenant_id, fiscal_year_id, scope, status)`,
  `(tenant_id, fiscal_period_id, account_id)`), and the BR-050 partial unique
  index; `budget_lines` are mutable **only while the parent budget is DRAFT**
  (enforced in the service layer + audited; no append-only grants here — this
  is planning data, and REVISED/CLOSED versions freeze rows at the version
  level). No journal/GL schema changes; no new CoA purposes (budgeting works
  over the tenant's existing accounts/dimensions). ENTITY_CATALOG gains the
  `budgeting` rows in-phase.
- **API changes:** `/api/v1/budgeting/budgets[/{id}]` (+`/submit` `/approve`
  `/activate` `/supersede` `/close`), `/budgets/{id}/lines` (bulk grid replace,
  DRAFT-only), `/budgets/{id}/consumption` (live per-period read for grid
  banners), `/budgets/{id}/export`, `/budgets/import` (dry-run then commit) —
  all per [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md): POST actions with
  `Idempotency-Key`, 404 on foreign ids (opaque), 409 `IMMUTABLE_DOCUMENT` on
  non-DRAFT edits. Report execution runs through the PHASE-013 run API with
  report ids `budgeting.budget-vs-actual` / `budgeting.variance-analysis`.
- **UI changes:** المحاسبة group gains الموازنات / Budgets; a period-column grid
  workspace variant enters `packages/ui` as the `PeriodGrid` pattern (catalog
  entry + AR+EN baselines: RTL column mirroring, sticky dimension column,
  tabular-nums, keyboard grid navigation); approval queue rows for pending
  budgets; import wizard; Report Page for variance with drill-down.
- **Security & authorization:** §3.13 keys enforce on every route (generated
  checklist); `budgeting.budgets.approve` is approval-separated (SoD default) and
  audited; `budgeting.budgets.activate` audited; branch scoping applies where
  the tenant uses branches (matrix §5). Attack rows: cross-tenant fiscal-year/
  period/account/cost-center/project/branch ids in nested line payloads → typed
  rejection with zero partial creation (S-04); A7 route coverage.
- **Accounting implications:** none gained, none weakened — no posting rules,
  no goldens, no invariant changes; the only accounting interaction is
   **reading** GL read models. The negative proof is part of the suite: after
  the full budgeting test run, `journal_entries`/`journal_lines` row counts are
  byte-identical (and no `JournalSpec` was ever submitted — engine spy).
  Variance contracts carry the ledger-tie assertion to the trial balance so
  "actual" can never silently diverge from the books.
- **Localization implications:** bilingual budget names + account labels (from
  the CoA); AR-first grid with Western digits LTR-isolated in money cells;
  period columns labeled with the fiscal calendar's AR month names; XLSX export
  honors RTL views; every screen ships AR+EN baselines.
- **Offline implications:** none — budgeting is office-grade planning data; no
  offline matrix rows are added, and nothing in the module creates sync
  surface (documented so the matrix stays honest).
- **Module dependencies:** `budgeting` → `accounting` (read-only: periods, cost
  centers, balances) + `reporting` (contract registry, run orchestration, XLSX
  pipeline) + `tenancy`/`partners` (branches, read-only) + `projects` dimension
  (PHASE-019, read-only). No module reads budgeting data except the budgeting
  guard api consumed by DRAFT-save hooks (declared edge, entitlement-gated);
  nothing ever calls budgeting from the posting pipeline.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0028_budgeting.sql`: `budgets` + `budget_lines`, RLS/composite FKs/indexes, BR-050 partial unique index | `apps/api/migrations/0028_budgeting.sql` | migration fresh+regression; RLS catalog; A1–A10 on both tables; second-ACTIVE insert rejected at the DB level |
| T2 | Budget version service: lifecycle states, supersede chain, codes, totals validation, DRAFT-only line edits | `apps/api/src/modules/budgeting/application/budget-version-service.ts` | BR-050 suite: uniqueness, supersede-never-edit, 409 on non-DRAFT edit, closed stays readable |
| T3 | Grid/lines service: period-column bulk ops, period∈fiscal_year validation, dimension FK validation | `apps/api/src/modules/budgeting/application/budget-grid-service.ts` | 12-period fixture; out-of-year period rejected; foreign dimension ids → zero partial creation (S-04) |
| T4 | Approval workflow: submit/approve/activate/supersede/close + SoD + audit events | `apps/api/src/modules/budgeting/application/approval-workflow.ts` | approve without grant → 403; self-approve blocked (SoD); every transition audited |
| T5 | Consumption read model: per (scope key, period) actuals from GL read services (read-only), ADR-0008 cache + invalidation on posting/reversal/period events | `apps/api/src/modules/budgeting/application/consumption-service.ts` | consumption ties to trial balance fixture; cache-invalidation test; read-only proof (no GL write calls — spy) |
| T6 | Advisory control guard: DRAFT-save evaluation, warning emission, policy keys (`budgeting.controls.mode`, `warn_threshold_percent`) | `apps/api/src/modules/budgeting/application/control-guard.ts`, `infrastructure/control-evaluation.job.ts` | BR-051 suite: default ADVISORY (warn-only); ENFORCE_DRAFT blocks only DRAFT saves with `BUDGET_EXCEEDED`; posted documents and posting pipeline provably untouched |
| T7 | Variance reports: `budgeting.budget-vs-actual` + `budgeting.variance-analysis` contracts (registry, pg-boss executionClass, ledger-tie assertion, saved params) | `apps/api/src/modules/reporting/registry/budgeting/*.ts` | as-of determinism; ledger-tie FAIL blocks export; threshold highlighting fixture |
| T8 | XLSX import/export: grid export via PHASE-013 pipeline; import wizard with dry-run, row caps, file-hash idempotency, Arabic headers | `apps/api/src/modules/budgeting/infrastructure/xlsx-grid-adapter.ts`, `application/import-service.ts` | import idempotent per hash; row caps (U-07 pattern); Arabic-header fixtures |
| T9 | UI screens + `PeriodGrid` pattern + baselines: List+Search, grid workspace variant, Approval Queue, Wizard, Report Page; nav item الموازنات under المحاسبة | `apps/web/src/app/(app)/budgeting/**`, `packages/ui/src/patterns/period-grid/**` | AR+EN baselines; axe + keyboard grid journeys; live totals; nav registry row resolves (entitlement AND permission) |
| T10 | Attack registration + rule suites + docs sync (ENTITY_CATALOG, FEATURE_CATALOG, REPORT_CATALOG, BUSINESS_RULES, DATA_DICTIONARY §9, AUTHORIZATION_MATRIX §3.13/§4, SECURITY_TEST_PLAN §2, NAVIGATION_MODEL) | `tests/budgeting/budgeting-rules.spec.ts`, `tests/isolation/**`, `docs/**` | isolation + permission checklists green; BR-050/051 green; docs validation green |

## 6. Verification

**Automated tests (required):**

- BR-050 suite: second ACTIVE version per (fiscal year, scope) rejected at
  service **and** DB level; supersede creates a new DRAFT with a linked chain
  and flips the old version to REVISED **only at activation** (atomic
  transition); ACTIVE/REVISED/CLOSED versions reject line edits; DRAFT lines
  accept bulk replace with exact totals.
- BR-051 suite: default mode is ADVISORY — an over-budget DRAFT save succeeds
  and emits exactly one warning (notification + banner payload); with
  `budgeting.controls.mode = ENFORCE_DRAFT` the same save fails with typed
  `BUDGET_EXCEEDED` (audited reason on the document) and zero document residue;
  a **posted** document over budget is never blocked or warned retroactively;
  the posting pipeline contains no budget call (engine-spy proof); policy
  default is documented in the settings schema (PLACEHOLDER per OQ-002).
- Variance fixtures: budget 12,000.00 over 12 periods (1,000.00 each), actual
  9,750.00 in period 4 → variance −250.00, variance % −25.00% (`7,4`); scope
  COST_CENTERS/PROJECTS/BRANCHES fixtures filter actuals by the journal-line
  dimensions; as-of determinism (same scope + dates + asOf → byte-identical
  results); ledger-tie assertion fails on seeded drift and blocks export.
- Negative ledger proof: after the entire budgeting suite (including ENFORCE
  runs), `journal_entries`/`journal_lines` counts and the INV-001/002 checks are
  identical to pre-run snapshots; no `JournalSpec` submission is recorded.
- Import/export: XLSX round-trip preserves every line (19,4 exact); import
  idempotent per file hash; row caps reject oversized files with a typed
  error; per-row dry-run error report lists AR+EN messages.
- Isolation: A1–A10 on both tables; nested foreign-id payloads → typed
  rejection, zero partial creation (S-04); A7 on all routes; permission
  checklist for §3.13 including the SoD approve boundary.

**Manual verification:**

1. Create an ACCOUNTS-scope budget for the current fiscal year, fill the
   12-period grid for two accounts, submit → approve as a different user →
   activate; attempt to edit lines → refused (409).
2. Record real expenses against a budgeted account, open
   `budgeting.budget-vs-actual` in AR and drill from a variance line to the
   journal; verify the numbers tie to the trial balance.
3. Save a DRAFT invoice that exceeds the period budget → warning banner +
   notification appear, the draft saves; post it → posts normally (advisory
   proof in the UI).
4. Set `budgeting.controls.mode = ENFORCE_DRAFT`, repeat the draft save →
   blocked with the audited `BUDGET_EXCEEDED` reason; post an already-saved
   draft that is over budget → posts normally (the block lives on the document
   flow, never on the engine).
5. Supersede the budget with a higher amount, activate the revision → old
   version shows REVISED with a chain link; export the grid as XLSX (AR), edit
   one row, re-import with dry-run → commit updates lines exactly.

**Acceptance criteria (objective):**

1. `budgets` + `budget_lines` exist tenant-owned with RLS and pass the full
   isolation registry suite (A1–A10, S-04, A7) with zero partial creation on
   foreign dimension references.
2. BR-050 is enforced at the database and service level: exactly one ACTIVE
   version per (fiscal year, scope); revisions supersede via the chain and
   never edit an ACTIVE version; non-DRAFT budgets are immutable.
3. The approval lifecycle (DRAFT → PENDING_APPROVAL → ACTIVE → REVISED →
   CLOSED) enforces `budgeting.budgets.approve` with SoD (creator cannot
   approve) and audits every transition.
4. The variance engine computes actuals read-only from GL read models: every
   consumption figure ties to the trial balance (assertion-tested), and the
   suite's negative proof shows zero journal-table writes and zero JournalSpec
   submissions after the full run.
5. `budgeting.budget-vs-actual` and `budgeting.variance-analysis` are
   registered per REPORT_CONTRACT with provenance, permissions, as-of
   determinism, drill-down, and export-blocked-on-assertion-failure behavior.
6. BR-051 holds: controls are advisory by default; hard-block exists only via
   the explicit `budgeting.controls.mode = ENFORCE_DRAFT` tenant policy, acts
   only at the DRAFT-stage save/approval step with an audited reason, and
   never affects posted documents or the posting engine; both policy keys are
   documented in the settings schema with their PLACEHOLDER defaults.
7. XLSX import/export round-trips grids exactly (19,4), is idempotent per file
   hash, bounded by row caps, and handles Arabic headers.
8. All §3.13 permissions enforce on their routes (generated checklist green);
   the SoD approve key is audited on use.
9. Every budgeting screen instantiates a sanctioned archetype with AR+EN
   baselines; the `PeriodGrid` pattern has a catalog entry; the الموازنات /
   Budgets item renders under المحاسبة per the nav resolution rule.
10. Acceptance criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

**Performance & security considerations:** consumption queries are bounded by
the `(tenant, fiscal_period, account)` index and cached per ADR-0008 with
event invalidation; variance reports run as pg-boss jobs (heavy class) with the
PHASE-013 quota/noisy-neighbor protections; import parsing is a bounded
cancelable job; the control guard adds zero latency for tenants without the
`budgeting.controls` entitlement (hook compiled out at the feature-gate); no
PII exists in budgeting; audit covers every state transition and every
approve/activate action.

**Migration & rollback:** additive migration `0027` only; no destructive
changes, no GL schema touch; posted-ledger state is untouched by construction,
so rollback = previous image (expand-compatible); planning data re-imports
idempotently from its XLSX exports after any restore.

## 7. Risks and Constraints

- Perceived enforcement: users will assume budgets block spending — mitigated
  by ADVISORY badges in the UI, the honest docs note (BR-051), and the test
  that proves posted documents are never blocked; support macros state it.
- Grid performance at scale (many accounts × 12+ period columns): virtualized
  grid, server-side period totals, paged dimension rows; budgets are yearly
  artifacts so write volume is low — the read path is what must stay fast.
- Consumption-key explosion (account × cost_center × project × branch):
  scope-filtered pre-aggregation per period with the ADR-0008 cache; the
  ledger-tie assertion catches any aggregation drift as a blocked export, not
  a silent wrong number.
- Revision-chain confusion for accountants: the supersede chain renders in
  the UI (version history drawer) and every flip is audited; DRAFT copies are
  explicit so no one edits history unknowingly.
- PROJECTS-scope overlap: project budgeting inside manufacturing/CRM could
  double-count with scope PROJECTS budgets — a DR-004 revisit condition; this
  phase ships scope PROJECTS as a plain filter and documents the boundary
  instead of inventing a reconciliation.
- Constraint: this module must remain ledger-incapable — any future feature
  request that makes budgets post or block posting requires an
  EXPANSION_REGISTER amendment plus a DR-004 revision, not a quiet change.
  Fund/budgetary (encumbrance) accounting is explicitly a new decision record,
  never an amendment here.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-028-COMPLETION.md` with: BR-050/051
  suite outputs, variance fixture outputs (including the −25.00% worked
  example), the negative ledger proof (journal-table snapshots + engine spy),
  import/export round-trip evidence, isolation + permission checklist results,
  screen baseline inventory, and the settings-schema documentation of both
  policy keys.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-028 → COMPLETE + tag), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (`budgeting` rows
  live), [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §budgeting,
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-050/051 rows + §8
  matrix), [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §9
  (`budget_scope`, `budget_status`),
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (two rows +
  provenance), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  (§3.13 + §4 SoD row), [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md)
  §2 PHASE-028 rows, [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md)
  (المحاسبة += الموازنات), [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md)
  (`PeriodGrid`). Explicitly **not** updated:
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) (no goldens, no rows)
  and [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (no new invariants) — the zero-delta is the point.
- **Exit criteria:** all 10 acceptance criteria green with evidence; a tenant
  can plan, approve, activate, revise, and close budgets in AR and EN, see
  variance that ties to the trial balance, receive advisory overspend
  warnings — with the ledger provably untouched.
- **Definition of Done:** budgeting is a first-class planning and variance
  layer over the ledger that is structurally incapable of writing to it;
  every "actual" on a budget screen traces to the books; every warning is
  advisory unless the tenant explicitly chose otherwise.
- **Handoff instructions:** read the PHASE-028 completion report. Budget data
  is now available to the reporting engine (variance contracts) and to
  PHASE-034 consolidation as presentation-layer inputs only — consolidation
  never needs budget tables. **Next eligible phases: PHASE-026, PHASE-027,
  PHASE-029** — the remaining stage-9 siblings that run in parallel after the
  GA gate per [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B
  sequencing (identify only; do not implement).
