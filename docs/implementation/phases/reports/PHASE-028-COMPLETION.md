# PHASE-028 Completion Report — Budgeting & Variance Control

> **Status:** COMPLETE · **Date:** 2026-11-08 · **Phase doc:**
> [../PHASE-028.md](../PHASE-028.md) · **Master plan:** `agent-ctx/PHASE-028-MASTER-PLAN.md`
> · **Decision:** [DR-004](../../../decisions/accounting/DR-004-budgeting.md) (option A —
> budgets are NOT ledger documents) · **Baseline:** PHASE-027 HEAD `502dc47`

## 1. The one-paragraph truth

PHASE-028 delivered the `budgeting` module per DR-004 option A: migration
`0039_budgeting.sql` (schema_version 39) landed the two RLS'd tenant tables —
`budgets` with the BR-050 partial unique (one ACTIVE per tenant/year/scope) and the
one-directional shape CHECKs, `budget_lines` the period grid over the four scope
dimensions — plus the notifications category widening and the six §22 plan grants
(the §3.13 permissions were pre-seeded in 0004/0005, so drift stayed 245=245 — the
docs-as-contract head start); the module itself shipped the version machine with SoD
approval and the atomic supersede flip, the DRAFT-only grid bulk replace, the
read-only dimension-grouped consumption engine with the ADR-0008 cache, the
advisory-by-default control guard (BR-051) with the daily sweep job, the XLSX
import/export, two report contracts on the PHASE-013 engine (registry 76→78, the
`budget-ledger-tie` block-on-fail assertion folding to the accounting module's own
trial-balance read), and the web screens with the new `PeriodGrid` pattern — and the
suite PROVES the ledger was never touched: journal counts byte-identical after the
full operation set, zero engine submissions, the store grep-clean (the negative
ledger proof the phase demanded, not a promise).

## 2. Task-by-task evidence

| # | Task | Delivered | Evidence |
|---|------|-----------|----------|
| T1 | Migration | `apps/api/migrations/0039_budgeting.sql` (2 tables, 2 §9 enum CHECKs, composite tenant FKs ×7, BR-050 partial unique, shape CHECKs ×3, purge_path ×2, grants, plan grants ×6, notifications widening, schema_version 39) + journal/manifest/migrations.spec pins in lockstep | migrations.db.spec 7/7; isolation A-suite 1,020/1,020 (registry +2); the DB-level second-ACTIVE insert rejected (`uq_budgets_one_active` — budgeting-rules.spec) |
| T2 | Budget version service | `application/budget-version-service.ts` (create/get/list/close, chain walk cap 50) + `domain/budgeting-errors.ts` | BR-050 suite: lifecycle, SoD `BUDGET_SELF_APPROVAL`, `BUDGET_NOT_APPROVED`, `BUDGET_ACTIVE_EXISTS`, closed-readable |
| T3 | Grid/lines service | `application/budget-grid-service.ts` (bulk replace, period∈year, scope-dimension consistency, 20k cap, dup-key guard, live totals) + `infrastructure/budgeting.store.ts` | 12-period fixture; out-of-year `BUDGET_PERIOD_MISMATCH`; scope shapes `BUDGET_SCOPE_DIMENSION`; zero residue on every rejection |
| T4 | Approval workflow | `application/approval-workflow.ts` (submit/approve/activate/supersede/close + the frozen transition table + audit per transition) | SoD blocked + zero residue; supersede chain + the atomic predecessor-first flip; exactly one ACTIVE remains |
| T5 | Consumption read model | `application/consumption-service.ts` + the shared `actualsForPeriods` SQL (dimension-grouped; BRANCHES via the source-document LATERAL with the honest NULL bucket; asOf-bounded) | the −25.0000% worked example; consumption banners with cache invalidation; the engine never writes (negative proof) |
| T6 | Advisory control guard | `application/control-guard.ts` (zero-overhead OFF gate, ADVISORY warn-once with the deduped notification + banner payload, ENFORCE_DRAFT typed audited block) + `infrastructure/control-evaluation.job.ts` (`budgeting.controls.sweep` 2:50 UTC) + the two settings keys | BR-051 suite: default warn (one notification), ENFORCE block (`BUDGET_EXCEEDED` + `budgeting.control_block` audit), under-budget zero noise |
| T7 | Variance reports | `registry/budgeting/{budgeting-queries,budget-vs-actual.contract,variance-analysis.contract}.ts` + registry wiring (SOURCE_MODULES + MODULE_DATA_PHASE 28 + window 28 + services + contract types) | registry 76→78 (unit + golden + industry-018/019 pins); ledger-tie PASS green + seeded drift FAIL; as-of determinism byte-equal |
| T8 | XLSX import/export | `infrastructure/xlsx-grid-adapter.ts` (exceljs, RTL views, tabular 4dp, AR+EN header fixtures) + `application/import-service.ts` (dry-run zero-writes, per-row typed AR+EN errors, 5k row cap, sha256 LRU idempotency) | round-trip 19,4 exact (12 periods → one grid row + totals); dry-run error report; bad file rejected whole |
| T9 | UI + PeriodGrid | `packages/ui/src/patterns/period-grid.tsx` (+stories, catalog row) + `/budgeting` pages ×5 + components ×4 + NAV_ITEMS `accounting.budgets` + FALLBACK_CRUMBS + api-types block + i18n +115/locale | web typecheck + vitest 73/73 green; i18n parity 3,914=3,914; contracts/ui vitest green (NAV specs) |
| T10 | Attack registration + docs sync | `__db__/budgeting/{fixtures,budgeting-rules.spec,spoof.spec}` + SECURITY_TEST_PLAN §2 row + TABLES/budgeting.md + IMPLEMENTATION_STATUS/CURRENT_STATE/NEXT_ACTION/CHANGELOG + ENTITY/FEATURE/REPORT/AUTH/DATA_DICTIONARY/NAVIGATION were pre-written (docs-as-contract — verified, no drift) + COMPONENT_CATALOG + this report + CURRENT_SHIPPED_PHASE 027→028 | S-04 spoof 7/7 (typed 404s, zero partial creation, foreign residue untouched); docs:validate 29/29 |

## 3. Final gate (serial, foreground — recorded 2026-11-08)

- **typecheck**: 8/8 workspaces green (`turbo run typecheck`).
- **lint**: 8/8 green (incl. boundaries); **depcruise**: 0 violations (1,472 modules,
  10,222 dependencies).
- **unit tests**: 8/8 packages green (api 370 incl. the re-pinned golden-effective-configs
  hashes for the two new settings keys + six feature-key plan grants; web 73; ui 42;
  contracts 50).
- **DB suite**: **153/156 files green — 2,206/2,209 tests** (migrations 0001–0039 fresh
  + regression on the embedded PG16). The 3 failures are the documented environmental
  set, none touching budgeting paths: `ga-full-load` EXPLAIN + `report-hammer` p95
  (this machine measures ~5–10× slower than the PHASE-025 measurement box — the
  hammer's deliberate concurrent-identical-upsert contention exceeds the 15 s
  statement timeout; ga-full-load is green standalone 13/13) and the `crm/time.spec`
  ordering sensitivity (flaky at the PHASE-027 baseline too — the runbook note's
  family). All three pass standalone/small-chunk.
- **docs:validate**: 29/29. **permissions-drift**: 245=245 (§3.13 pre-seeded — nothing
  to add). **check:rls**: green via the migrations spec's `runChecks` on the real
  schema (violations = []; both new tables catalogued — 203→205).
  **i18n parity**: 3,914=3,914 (3,799 + 115 budgeting keys). **capabilities**:
  GREEN (25 PASS rows).

## 4. Engineering notes paid for (the lessons worth carrying)

1. **The fixture must be idempotent across spec files**: the DB suite shares one
   persistent embedded database while each spec file re-instantiates the module-level
   fixture — the first run collided on the tenant-scoped natural keys (account 5210)
   and would have re-minted the GL world. Every fixture creation now existence-checks
   (account/CC/project/partner by code) and the GL-world minting gates on a
   zero-journal probe per dedicated tenant.
2. **`fiscal_periods` carries no `name_ar`** (and the year creation yields 12 REGULAR
   + OPENING/CLOSING system periods): the store's `listPeriodsOfYear` initially
   selected `name_ar` (SQL 42703) and mapped all 14 periods into the grid — the
   delivered shape filters `kind = 'REGULAR'` (the G-16 posting windows are not
   planning columns) and reads name only.
3. **The reporting boot's `KNOWN_PERMISSION_KEYS` needed the in-phase
   `budgeting.reports.view` addition** — the DB suite's app-boot validation caught it
   (the SF-027-001 lesson enforced by the suite itself: registration is expected
   in-phase, and a missed one fails every HTTP-booting spec, not just the registry's
   own unit test).
4. **The variance-percentage scale**: the first draft computed (actual−budget)/budget
   without the ×100 carry in the BigInt long division (−0.2500 instead of −25.0000) —
   the phase's own worked example is the tripwire, exactly as designed.
5. **exceljs row-1 semantics**: the export initially wrote bilingual title rows above
   the header while the parser treats sheet row 1 as the header — the round-trip
   contract now pins header-first (and the import excludes the tolerated trailing
   Total column from the period mapping).
6. **The audit-writes-before-throw visibility discipline**: the ENFORCE_DRAFT block
   audits then throws; the spec must read the audit row AFTER the ambient UoW closes
   (`expect().rejects` captures the throw inside the callback, so the transaction
   commits — the su() probe outside `withTenant` sees the row; an inside-callback
   probe would read a different, uncommitted connection).

## 5. Findings (SF-028-xxx)

- **SF-028-001 (docs drift in the phase doc, corrected in-delivery)**: the phase
  contract's task table named `0028_budgeting.sql`, `apps/web/src/app/(app)/budgeting/**`,
  and `tests/budgeting/**` — the actual repo conventions are `0039_budgeting.sql`
  (the migration chain is at 39), `apps/web/app/[locale]/budgeting/**`, and
  `apps/api/src/__db__/budgeting/**`. The master plan pinned the corrected paths
  before implementation; the phase doc header now records the correction. No code
  impact.
- **Carried watch items (unchanged, not 028's)**: SF-026-001 (purge vs guards),
  SF-026-002 (RC-10 accum sign seeded-drift DB proof); the environmental runbook note
  (ga-full-load/report-hammer/notifications-email want dedicated small-chunk runs)
  gained report-hammer as a measured-red-on-slow-box item this session.

## 6. Honest deferrals (explicit, none silently shipped)

1. **The declared-edge guard call-site wiring**: DEPENDENCY_RULES §2 sanctions
   trade-document DRAFT-save flows calling `ControlGuard.evaluateDraftSave` when
   `budgeting.controls` is entitled; the guard API + the daily sweep job ship, but NO
   production sales/purchasing/treasury save flow calls it yet (the phase's own
   acceptance tests the guard semantics directly). Wiring the first production call
   site (treasury expense draft-save is the natural surface) is the recommended
   PHASE-029+/follow-up item — a small, audited patch.
2. **Import hash-idempotency scope**: the in-module 256-entry LRU (restart loses it)
   + the global HTTP Idempotency-Key guard; re-committing the same file converges to
   the same grid anyway because the replace is whole-grid. A durable hash table would
   need a register §C change — deliberately not smuggled in.
3. **BRANCHES attribution**: journal lines carry no branch; the derivation runs
   through the entry's source document (four document types own branch_id), and
   unattributable lines render in an explicit NULL bucket — documented in
   TABLES/budgeting.md rather than invented away.

## 7. Acceptance criteria ×10 — verdicts

1. ✅ Isolation: registry +2, A1–A10 green (1,020/1,020), S-04 spoof 7/7 with zero
   partial creation, A7 parity (foreign budget id == unknown id).
2. ✅ BR-050 at both levels: DB partial unique rejects the second ACTIVE outright;
   service 409 `BUDGET_ACTIVE_EXISTS`; supersede-never-edit with the atomic flip;
   `IMMUTABLE_DOCUMENT` on non-DRAFT edits; closed budgets readable.
3. ✅ Lifecycle + SoD: creator-approval blocked (`BUDGET_SELF_APPROVAL`); every
   transition audited (`budgeting.*` actions asserted in the suite).
4. ✅ Read-only actuals: the ledger-tie assertion PASS green over the real GL;
   negative proof — journal counts byte-identical + zero engine submissions + the
   structural grep.
5. ✅ Reports registered per REPORT_CONTRACT: 78 frozen contracts (golden.spec),
   provenance/permission/as-of determinism/drill/export-block verified.
6. ✅ BR-051: ADVISORY default (warn-once), ENFORCE_DRAFT typed audited block on the
   DRAFT save only, posted documents never touched (no code path exists), both policy
   keys in the settings schema with PLACEHOLDER defaults.
7. ✅ XLSX round-trip exact (19,4), row caps typed, AR headers, hash idempotency
   (scope honestly documented above).
8. ✅ §3.13 permissions enforce on every route (controller decorators; keys pre-seeded
   — drift 245=245); the SoD approve key audited on use.
9. ✅ Screens per archetypes with AR+EN baselines; `PeriodGrid` catalog row + stories;
   الموازنات / Budgets renders under المحاسبة (NAV_ITEMS row + entitlement gating).
10. ✅ Criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

## 8. Handoff

Budget data is available to the reporting engine (the two variance contracts) and to
PHASE-034 consolidation as presentation-layer inputs only. **Next eligible:
PHASE-029 (Payroll — the remaining stage-9 sibling), then PHASE-034** per
EXPANSION_REGISTER §B sequencing (identify only; do not implement without a fresh
phase order). Recommended follow-ups (small, audited, any phase): the first
production guard call-site wiring (see deferral 1) and the RC-10 seeded-drift DB
proof (the carried 026 item).
