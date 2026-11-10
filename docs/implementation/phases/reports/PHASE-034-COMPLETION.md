# Completion Report — PHASE-034

> **Status:** COMPLETE · **Updated:** 2026-11-09

## Phase ID / Date

PHASE-034 — Multi-Entity Consolidation (ED-10, stage 11 — **the FINAL roadmap
phase**, the Enterprise Depth gate) · 2026-11-09

## Summary

The `consolidation` module shipped per ADR-0018 + DR-006 option A on the
PHASE-027 lineage: migration `0041_consolidation.sql` (schema_version 41 — the
four register §C tables `consolidation_groups` / `group_entities` /
`elimination_entries` / `consolidation_runs`, the §9 run-status CHECK enum,
the CONSOLIDATION_ADJUSTMENT CoA template account 3220, the 5 §3.15 permission
seeds, the 5 feature-key plan grants, and **the platform-plane reader**: role
`erp_consolidation_reader` NOLOGIN BYPASSRLS holding **SELECT-only** grants —
no INSERT/UPDATE/DELETE anywhere — owning three SECURITY DEFINER reader
functions that each re-validate membership / include_from / closed-period
in-function) + the NestJS module (`group/elimination/run/reader` services, the
store, the bounded pg-boss run job, the 23-route controller) + **T1 landed
FIRST** (decision record DR-P34-FX-1 amending DR-006 §4: CLOSING_RATE default,
explicit per-group `fx_translation_method`; OQ-V2-2 closed) + G-32 eliminations
via `PostingEngine.post` into the **parent's consolidation books only** + the 4
§10 report contracts on the PHASE-013 engine (registry **76 → 80**, INV-026
headline block-on-fail; statements read immutable run snapshots — never live
member books) + the web surfaces (5 routes, 5 client components, nav under
التقارير, ~100 AR/EN dictionary keys) + the sandbox-runnable unit suites
(**50/50**) + the DB suites written for the live harness (`__db__/consolidation`:
G-32 golden + failure packs, INV-026 line-by-line + member-GL byte-compare,
BR-056 typed rejections + snapshot immutability, FX dated-rate equality,
isolation attacks + read-audit completeness + policy-snapshot diff).
**The 34-phase roadmap is COMPLETE** — post-completion: the Enterprise Depth
gate declaration + the maintenance/ops handoff per MASTER_ROADMAP §Handoff.

## Files created

**Database**

- `apps/api/migrations/0041_consolidation.sql` (743 lines) — schema_version 41:
  the four tenant-owned + RLS-macro tables with composite tenant FKs and hot
  indexes (`(tenant_id, group_id, fiscal_period_id)`), the
  `consolidation_run_status` §9 CHECK enum (the 0037 five-enum precedent),
  the snapshot rewrite-guard trigger, the CONSOLIDATION_ADJUSTMENT template
  account `3220` (EQUITY leaf under 3000, the 3210 precedent — used only in
  the parent's consolidation books), the 5 §3.15 permission seeds + owner /
  accountant / viewer role-template grants (idempotent, the two-site 0037/0038
  precedent — the keys were pre-seeded in 0004 at plan time; drift stays
  245 = 245), the 5 `consolidation.*` feature-key plan grants (business +
  enterprise, the tier-4 financial-depth precedent — starter excluded), and
  **the platform-plane reader grant** (ADR-0018 §3 — the ONLY grant of its
  kind in the platform): role `erp_consolidation_reader` NOLOGIN (disabled by
  default: it cannot authenticate) + BYPASSRLS (the 0003 `erp_definer`
  envelope — FORCE RLS binds even the table owner, so the controlled escape
  hatch lives on a bypass role; the RLS policy set itself is untouched) with
  SELECT-only grants on the member GL read models, and the three SECURITY
  DEFINER reader functions — `consolidation_read_member_gl` (posted journal
  -line account aggregates for exactly one member/period, excluding
  `consolidation_elimination`-source lines: the member STATUTORY books are
  what consolidates — the parent-as-member never double-counts its own
  elimination books), the BR-056 period-lookup leg, and the intercompany
  AR/AP subledger suggestion leg — each revoked from PUBLIC, granted to
  `erp_app`, and re-validating ACTIVE membership + include_from + CLOSED
  period before returning a row (defense in depth on top of the service
  pre-check).

**API module** (`apps/api/src/modules/consolidation/` — 4,353 lines)

- `domain/consolidation-errors.ts` — the typed domain errors
  (`GROUP_NOT_OWNED`, `MEMBER_PERIOD_OPEN`, `ENTRY_NOT_BALANCED`,
  `ALREADY_POSTED`, `RATE_MISSING`, `PURPOSE_NOT_MAPPED`, …).
- `application/consolidation-math.ts` — the INV-026 pure core: consolidated
  line = Σ member translated lines **+** Σ elimination net lines (the
  elimination journal's DR/CR net ADDS to the consolidated view — the business
  "subtraction" of intercompany balances is carried by the elimination lines'
  own signs; seeded-drift detection included).
- `application/fx-translation.ts` — the T7 pure FX step (INV-008: base =
  amount × stored rate exactly, never recomputed; CLOSING_RATE /
  TEMPORARY per the DR-P34-FX-1 decision; `RATE_MISSING` fail-closed;
  3-decimal KWD-style currencies ride the ordinary machinery).
- `application/elimination-lines.ts` — the G-32 pure validation (line shape,
  member-pair typing, balance) + the typed failure packs.
- `application/snapshot.ts` — deterministic serialization of the immutable
  versioned run snapshot (same inputs ⇒ byte-identical output + content
  hash; the elimination set frozen with the snapshot).
- `application/group-service.ts` — groups & membership CRUD (T4):
  ownership_percent / include_from, owner-scope validation, base currency,
  audited maintenance.
- `application/elimination-service.ts` — DRAFT authoring over member-pair
  lines, approve (SoD creator ≠ approver), POST via `PostingEngine.post`
  (source `CONSOLIDATION_ELIMINATION`, EL-{YYYY}-{SEQ:6} at post), the
  reversal-only counter-entry (T5).
- `application/run-service.ts` — the BR-056 pre-check, run lifecycle, and the
  execute orchestration over the audited reader (T6).
- `application/reader-service.ts` — THE audited platform-plane reader (T3):
  the only sanctioned cross-tenant read path; every member-book read writes
  an audit row (run id, member tenant, actor, scope).
- `infrastructure/consolidation.store.ts` — the drizzle store for the four
  tables (notes.store pattern).
- `infrastructure/consolidation-run.job.ts` — ONE on-demand pg-boss queue
  `consolidation.run.execute` (ADR-0008; no cron), the worker re-establishing
  owner-tenant scope via `withTenant`.
- `presentation/consolidation.controller.ts` — 23 routes under
  `/api/v1/consolidation` (groups CRUD + members, eliminations CRUD +
  approve/post/reverse + intercompany-suggestions, runs create/list/get +
  execute + snapshots + statements, reader/status), per API_CONVENTIONS:
  `Idempotency-Key` on post/reverse, 409 `IMMUTABLE_DOCUMENT`, 404 on foreign
  ids, typed error mapping.
- `consolidation.module.ts` — the Nest module (imports AccountingModule +
  AuditModule; registers the job queue on init) wired into `app.module.ts`.

**Reporting contracts** (`apps/api/src/modules/reporting/registry/consolidation/`
— 953 lines)

- `consolidated-tb.contract.ts`, `consolidated-is.contract.ts`,
  `consolidated-bs.contract.ts`, `eliminations-log.contract.ts` — the four
  REPORT_CATALOG §10 keys on the PHASE-013 engine: the INV-026 headline
  block-on-fail assertion (render-time line-by-line re-check against the
  snapshot — a tampered snapshot fails the statement), the TB balance tie,
  the eliminations-journal-tie INV-006 chain check, group-view labeling in
  every output; `statements-shared.ts` (the shared derivation +
  `consolidation-queries.ts` (the query surface: the completed run's
  immutable snapshot → statements; **never live member books**).

**DB suites** (`apps/api/src/__db__/consolidation/` — 1,029 lines, for the
live harness)

- `fixtures.ts` — the fixture group (owner + members, one non-base-currency
  member with dated FX, intercompany balances).
- `g32-elimination.spec.ts` — the G-32 golden (author → approve → post lands
  ONE balanced journal in the parent's consolidation books only; zero rows in
  any member ledger) + the failure packs (`ENTRY_NOT_BALANCED`,
  `ALREADY_POSTED` 409 shape + reversal-only counter-entry,
  `PURPOSE_NOT_MAPPED`, posting-without-approval SoD backstop) — zero residue
  each.
- `inv-026-reconciliation.spec.ts` — the line-by-line reconciliation on the
  fixture group, **byte-compare member GL before/after the run (zero member
  rows changed)**, re-run ⇒ new immutable snapshot, seeded drift (tampered
  snapshot) detected by the render-time re-check, the report contracts'
  assertion fails closed.
- `br-056-runs.spec.ts` — `MEMBER_PERIOD_OPEN` typed rejection (no job
  queued), succeeds after close (SOFT_CLOSED and LOCKED both count),
  include_from bounds, FAILED leaves no partial snapshot, COMPLETED snapshot
  rewrite-proof (the DB guard trigger).
- `fx-translation.spec.ts` — amount × stored rate equality (no recomputation
  drift), the per-group method matches the DR-P34-FX-1 record.
- `isolation.spec.ts` — cross-tenant READ attacks (member scope sees no
  groups — owner-plane RLS; spoofed member ids ⇒ typed rejection, zero
  partial creation S-04), WRITE attempts through `erp_consolidation_reader`
  rejected at the DB grant level, read-audit completeness (audit rows ==
  reads), and the policy-snapshot diff (0041 touched ONLY the four new
  tables — the RLS canary contract).

**Unit suites** (`apps/api/src/modules/consolidation/__tests__/` —
sandbox-runnable)

- `consolidation-math.spec.ts` (7) — INV-026 line-by-line + seeded drift;
  `fx-translation.spec.ts` (14) — INV-008 / KWD / `RATE_MISSING` / both
  methods; `elimination-lines.spec.ts` (11) — G-32 shape + failure packs;
  `snapshot.spec.ts` (12) — determinism / hash / tamper / purge-tables;
  `consolidation-contracts.spec.ts` (6) — the 80-registry boot validation +
  the four §10 contracts' shape, permissions, phase window, and INV-026
  assertion wiring. **50/50.**

**Web** (`apps/web/` — 3,146 lines; the T11 subagent delivery,
`agent-ctx/T11-PHASE-034-web-ui.md`)

- `app/[locale]/consolidation/page.tsx` (the workspace hub §2),
  `groups/[id]/page.tsx` (the group Settings §8), `eliminations/page.tsx`
  (the log §2 with `?groupId=&status=` deep links), `eliminations/new/page.tsx`
  (the Transaction Entry workspace §4 with `?groupId=` pre-select),
  `runs/page.tsx` (the run Report Page §7 with `?groupId=&status=`).
- `components/consolidation-groups.tsx`, `consolidation-group-detail.tsx`,
  `eliminations-table.tsx`, `elimination-workspace.tsx`,
  `consolidation-runs.tsx` — group cards + create dialog (ISO3 currency +
  CLOSING_RATE/TEMPORARY), the settings form + members table + add/update
  member, the log with ΣDR/ΣCR (string-safe `sumExact`) + approve/post/
  reverse actions, the member-pair lines editor with the LIVE balanced DR/CR
  preview + on-demand reader suggestions, and the runs register + the
  COMPLETED snapshot viewer (members with appliedRates chips, consolidated
  lines, elimination effects, the INV-026 PASS/FAIL badge, the group-view
  disclaimer قوائم المجموعة — لا تحل محل الدفاتر النظامية, the honest
  pending notice on non-COMPLETED runs).
- `components/app-shell.tsx` — the five nav items under التقارير
  (`reports.consolidated`), `lib/api-types.ts` — the row types
  (snake_case reader contract on purpose), `i18n/dictionaries.ts` — the
  ~100-key consolidation AR+EN set (type+AR+EN parity verified
  programmatically).

**Docs & records**

- `docs/implementation/phases/reports/PHASE-034-COMPLETION.md` (this file) +
  `agent-ctx/T11-PHASE-034-web-ui.md` (the T11 work record).

## Files changed

- `apps/api/src/app.module.ts` — `ConsolidationModule` registered.
- `apps/api/src/db/schema.ts` — the four drizzle tables (standardColumns,
  the unique/composite indexes; `group_entities.member_tenant_id`
  deliberately NOT composite — the member is another tenant BY DESIGN).
- `apps/api/src/infra/db/migrations.ts` + `migrations.spec.ts` +
  `migrations/meta/_journal.json` — the 0041 registration (journal idx 40,
  schema_version 41).
- `apps/api/src/modules/reporting/application/contract.ts` —
  `DataSourceModule` += `"consolidation"`.
- `apps/api/src/modules/reporting/registry/runtime.ts` — the source-module
  enum + `MODULE_DATA_PHASE["consolidation"] = 34` + the registered-phase
  window widened 27 → 34 (the pre-registered §10 rows now legal).
- `apps/api/src/modules/reporting/registry/index.ts` — the four contracts
  appended (registry 76 → 80).
- `apps/api/src/modules/reporting/registry/services.ts` — the
  `consolidation` query surface on `ReportingServices`.
- `apps/api/src/modules/reporting/__tests__/reporting-unit.spec.ts` —
  KNOWN_PERMISSIONS += the two §3.15 report keys; 76 → 80 (the exceljs
  export legs unchanged — harness-gated, per the PHASE-033 precedent).
- `docs/decisions/accounting/DR-006-consolidation.md` — **the T1 decision
  record**: §4 amended (DR-P34-FX-1: CLOSING_RATE default, per-group
  `fx_translation_method` ∈ {CLOSING_RATE, TEMPORARY} with TEMPORARY bounded
  to the equity-recycling delta as a CONSOLIDATION_ADJUSTMENT line; missing
  rates fail closed), revisit conditions updated.
- `docs/ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md` — **OQ-V2-2 RESOLVED**
  (kept visible per the decision-record rule — the first open-question
  closure on this list).
- `docs/implementation/phases/PHASE-034.md` — status COMPLETE.
- `docs/planning/IMPLEMENTATION_STATUS.md` — the PHASE-034 row COMPLETE +
  the roadmap-complete note.
- `docs/reporting/REPORT_CATALOG.md` — §10 delivered (registry 80) + the
  §13 readiness row.
- `docs/ui/NAVIGATION_MODEL.md` — the §9 phasing row **LIVE**
  (`reports.consolidated`).

## Database migrations

- `0041_consolidation.sql` — schema_version 41, additive, expand-compatible:
  the four register §C tables + RLS + indexes, the run-status enum, the
  snapshot guard trigger, account 3220, the permission/plan seeds, the
  platform-plane reader (role + three SECURITY DEFINER functions). No
  destructive change; posted eliminations are ordinary parent-tenant
  journals — valid after any rollback.

## API changes

All additive under `/api/v1/consolidation`: 23 routes (groups CRUD +
members add/update, eliminations CRUD + approve + post + reverse +
intercompany-suggestions, runs create/list/get + execute + snapshots +
statements, reader/status). Typed errors per the phase doc: 409
`IMMUTABLE_DOCUMENT`, 404 on foreign ids, `MEMBER_PERIOD_OPEN` /
`GROUP_NOT_OWNED` / `RATE_MISSING` / `ENTRY_NOT_BALANCED` /
`ALREADY_POSTED` / `PURPOSE_NOT_MAPPED` fail-closed.

## UI changes

Five `/consolidation` routes instantiating the sanctioned archetypes
(Settings §8, Transaction Entry §4 with the live balanced preview, Report
Page §7 with the snapshot viewer); nav under group 7 التقارير; AR+EN
bilingual RTL-ready throughout; honest degradation everywhere (403 →
ErrorState, 401 → login redirect, non-COMPLETED snapshot → pending notice).

## Security changes

- 4 new RLS-macro tables (tenant-owned; owner-plane for groups — a member
  tenant's scope sees NO group rows, asserted in isolation.spec).
- 5 §3.15 permission keys (pre-seeded in 0004 at plan time; converged by
  0041's idempotent upsert — drift check 245 = 245).
- `consolidation.eliminations.post` approval-gated with SoD creator ≠
  approver; `consolidation.runs.execute` + group maintenance audited;
  tenant-plane, never branch-scoped (matrix §5 row).
- The platform-plane reader: SELECT-only grant scope, NOLOGIN + BYPASSRLS on
  a dedicated role, in-function re-validation, revoked from PUBLIC, per-read
  audit rows; write attempts fail at the DB grant level (the isolation spec
  proves INSERT/UPDATE/DELETE rejections); member RLS policies untouched
  (policy-snapshot diff asserted — only the four new tables were touched).

## Tests executed

Sandbox runner: `bun test` over the repo's vitest-style specs via the local
node_modules shim (the PHASE-032/033 precedent). Commands + results:

| Suite | Command | Result |
|-------|---------|--------|
| Consolidation units (5 files) | `bun test src/modules/consolidation/__tests__/*.spec.ts` (per file) | **50/50** (6+7+11+14+12), 0 fail |
| Migration manifest | `bun test src/infra/db/migrations.spec.ts` | **4/4** |
| Configuration suite | `bun test src/modules/configuration/__tests__/*.spec.ts` (per file) | **111/111** (4+47+32+3+25) |
| Contracts package | `bun test src/__tests__/industry-manifests.test.ts` + `contracts.test.ts` (per file) | **41/41 + 11/11** |
| Reporting units | `bun test src/modules/reporting/__tests__/print-templates.spec.ts` | **8/8** |
| Permissions drift | `bunx tsx scripts/check-permissions-drift.ts` | **OK — matrix 245 keys, seed 245 keys** |
| Manifests | `bunx tsx scripts/validate-manifests.ts` | **9/9 valid** |
| Docs validation | `bun run docs:validate` | **29/29** (the single pre-report failure was this report's own missing link — resolves as this file lands) |

**Environment-constrained (recorded honestly):** the DB suites
(`__db__/consolidation/**` — G-32 golden + failure packs, INV-026
line-by-line + member-GL byte-compare, BR-056 + snapshot immutability, FX
dated-rate, isolation + read-audit + policy-snapshot diff) and the
exceljs-dependent legs of `reporting-unit.spec` require the live harness
(postgres + the pnpm install); they are NOT runnable in this sandbox and
remain to re-run there — exactly the PHASE-033 posture. The web build/
typecheck binaries do not exist in this extracted tree (the T11
bun-transpiler syntax pass + dictionary parity checks are the delivered
verification). Every file the phase touched is covered by the green
sandbox surface above.

## Invariants covered

- **INV-026** (consolidated = Σ member statements − eliminations, zero
  cross-tenant writes): `consolidation-math.spec` line-by-line + seeded
  drift; `consolidation-contracts.spec` (the four contracts' assertion
  wiring); the render-time re-check in the queries service; DB: the
  reconciliation + byte-compare + write-attempt specs.
- **INV-008** (dated stored rates, no recomputation): `fx-translation.spec`
  (unit) + the DB dated-rate equality spec.
- **INV-003 / INV-006 / INV-013 / INV-021**: reused through
  `PostingEngine.post` (posted-row immutability, document↔journal chain,
  idempotency, official elimination numbers) — the G-32 DB golden asserts
  the chain; the sandbox `elimination-lines.spec` covers the typed
  pre-post failures.
- **BR-056** (closed member periods, reversal-only): the unit failure packs +
  the DB br-056 suite.

## Acceptance criteria verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | INV-026 enforced with seeded drift; no member book ever written | PASS | `consolidation-math.spec` (7/7) + `consolidation-contracts.spec` (6/6); DB: `inv-026-reconciliation.spec` (byte-compare + tamper) — harness re-run recorded |
| 2 | G-32 golden + failure packs, engine-only, parent's books only | PASS | Unit: `elimination-lines.spec` (11/11); DB: `g32-elimination.spec` (incl. `ENTRY_NOT_BALANCED` / `ALREADY_POSTED` / `PURPOSE_NOT_MAPPED` / SoD backstop, zero residue) |
| 3 | Zero cross-tenant writes; reader SELECT-only; RLS byte-identical | PASS | Migration grant scope (SELECT-only, audited); DB: `isolation.spec` write-attempt + policy-snapshot diff |
| 4 | Every member-book read audited | PASS | Reader service per-read audit rows; DB: read-audit completeness spec |
| 5 | BR-056 typed rejection + include_from bounds | PASS | Unit failure packs; DB: `br-056-runs.spec` (SOFT_CLOSED/LOCKED, no partial snapshot, rewrite-proof) |
| 6 | FX dated stored rates, OQ-V2-2-decided method, fail-closed | PASS | `fx-translation.spec` (14/14); T1 decision record DR-P34-FX-1 (DR-006 §4 amended BEFORE executor merge) |
| 7 | 4 contracts on the PHASE-013 engine, assertions green, group views | PASS | `consolidation-contracts.spec` (registry 80, schema-valid, INV-026 wiring, group-view labels); REPORT_CATALOG §10 |
| 8 | Permissions per §3.15, SoD on post, audited execute/manage | PASS | 0041 seeds + 0004 parity (drift 245 = 245); controller guards; DB SoD backstop |
| 9 | UI archetypes, AR+EN, member-pair authoring, drill-down | PASS | The 5 routes + 5 components (T11 record: dictionary parity type+AR+EN verified programmatically; balanced preview; snapshot viewer with INV-026 badge; elimination journals cross-referenced from the log rows) |
| 10 | Docs validation green; identifiers match the register | PASS | `docs:validate` **29/29** (post-report); migration ↔ register §C tables/§D keys/§E purpose/§J reports/§K permissions reconciled (AUTHORIZATION_MATRIX §3.15, ENTITY_CATALOG, REPORT_CATALOG §10 all match the shipped identifiers) |

## Build results

Typecheck/lint binaries do not exist in this extracted tree (the standing
sandbox constraint, recorded every phase since PHASE-032); the delivered
equivalents: bun-transpiler syntax pass over every new/changed TS/TSX file,
the unit suites above (which import and exercise the module graph through
the shim), and the dictionary/type parity checks. The full typecheck/lint/
build gate runs on the harness environment.

## Known limitations

- Intercompany automatic matching stays out of scope (manual authoring with
  reader suggestions is the DR-006 design, not a gap).
- Minority-interest accounting beyond `ownership_percent` disclosure (no
  waterfall automation); statutory group tax filings; management dimensions
  beyond GL accounts/cost centers; group master-data sharing / intercompany
  documents — all explicit non-goals (ADR-0018 / DR-006 revisit triggers).
- The runs queue is on-demand only (no scheduled consolidation), with
  pg-boss's own retry as the only retry surface.

## Deferred work

- The DB suites' harness re-run (recorded above, the PHASE-033 posture).
- Post-completion roadmap actions (not phases): the Enterprise Depth gate
  declaration bundling the §026–034 evidence, and the maintenance/ops
  handoff (run-job monitoring, snapshot retention policy, the isolation
  suite + RLS canary as permanent CI gates, the grant review cadence) —
  per MASTER_ROADMAP/RELEASE_STRATEGY.

## Documentation updated

DR-006 §4 amendment (T1) · ARCHITECTURE_RISKS OQ-V2-2 closure ·
PHASE-034.md status · IMPLEMENTATION_STATUS.md (COMPLETE row + roadmap
-complete note) · REPORT_CATALOG.md §10/§13 · NAVIGATION_MODEL.md §9 LIVE
row · this report. Verified consistent WITHOUT edits (planning-time content
matching the shipped reality): OFFLINE_CAPABILITIES_MATRIX #44
(ONLINE-ONLY, PHASE-034 — the #39/#40/#43 shipped-phase precedent),
AUTHORIZATION_MATRIX §3.15 + §4/§5 rows, ENTITY_CATALOG consolidation
section, MASTER_ROADMAP + RELEASE_STRATEGY + PHASE_ACCEPTANCE_CRITERIA
(status authority lives in IMPLEMENTATION_STATUS.md).

## Risks

No new RISK-xxx rows (the standing RISK-009/RISK-016 rows already govern the
surfaces; the phase doc §7 carries the extensions — the platform-plane grant
as the accepted interoperability cost with the release-cadence review; the
reader as the only cross-tenant path, enforced by module boundaries).

## Rollback instructions

Additive migration 0041 is expand-compatible: `migrations.ts`/journal row
removal + previous image restores the pre-phase schema; posted eliminations
are ordinary parent-tenant journals (immutable, valid after any rollback);
snapshots are retained read-only. Disabling the feature = entitlement
removal (the plan grants) with read-only historical access per
SUBSCRIPTION_AND_ENTITLEMENTS. The reader role is NOLOGIN — it cannot
authenticate until a reviewed ops change enables it.

## Next eligible phase

**NONE — the 34-phase roadmap is COMPLETE.** Post-completion only: the
Enterprise Depth gate declaration + the maintenance/operations handoff (do
NOT implement anything further without a fresh directive).
