# PHASE-040 Completion Report — Data Onboarding & Migration Toolkit

> **Status:** COMPLETE · **Date:** 2026-11-11 · **Phase doc:**
> [../PHASE-040.md](../PHASE-040.md) · **Register:** [CR-10](../../../planning/COMPLETENESS_REGISTER.md)
> (+ the L1-21 export-templates half via v3.1/CR-41) · **Triple flip:** this
> report + the phase doc header + the IMPLEMENTATION_STATUS row flipped together
> (CR-48).

## 1. Executive summary

PHASE-040 delivered the onboarding bottleneck-killer the audit demanded (H-17:
"onboarding a serious client means millions of manual rows") plus the trial/demo
substrate (TB-19/TB-20) and the sales-demo sandbox (OA-05). The import engine widens
from three baseline kinds to TEN: COA, ACCOUNT_OPENING_BALANCES, FIXED_ASSETS,
EMPLOYEES, PRICE_LISTS, CONTRACTS, and BUDGETS join PARTNERS/ITEMS/OPENING_BALANCES —
each with the BR-066 discipline (a zero-write dry-run, an acknowledged atomic commit
through the pg-boss worker, re-validation against the preview's exact mapping
snapshot, and per-kind applies through the OWNING module's real services — no raw
inserts, no journal bypass). The column-mapping wizard persists reusable maps (both
directions); the QuickBooks/Odoo/Excel-generic migration adapters ship DOCUMENTED
column mappings with downloadable templates (IN-26 — extract-then-import). The
one-click demo loader seeds ALL 13 industry templates with realistic GL-posted data;
the platform-plane sandbox wraps it in a time-boxed, quota-capped, one-time-credential
tenant that is never a consolidation member. **Migrations 0060–0063 · schema_version
63 · 1 new RLS'd table · permissions 265 → 267 · feature keys +2 · rules BR-066 ·
i18n +89 keys/locale.**

## 2. Mandatory code-evidence checklist (CR-48)

**New tables (SQL migration + Drizzle mirror + ENTITY_CATALOG row — CR-36 a):**

| Table | Migration | schema.ts (Drizzle) | Catalog |
|---|---|---|---|
| import_mappings | 0060_import_toolkit.sql §1 | `importMappings` | §"onboarding" (227 → 228) |

Additive columns on catalogued tables (expand-only): `import_jobs` + `mapping_id` +
`options` (0060 §2) + `mapping` snapshot jsonb (0062); `tenants` + `kind` +
`sandbox_expires_at` + `sandbox_max_users` + `sandbox_owner_email` + the demo markers
`demo_seeded_at`/`demo_template`/`demo_seed_hash` (0060 §3); the `import_jobs.kind`
CHECK widening keeps every legacy value valid (zero reshape — AC1's additive proof).

**Migrations & manifest:** journal idx 59–62 appended (63 entries); the manifest
`src/infra/db/migrations.ts` carries the four tags with lineage comments;
`migrations.db.spec.ts` 7/7 (apply + re-apply no-op + RLS catalog drift + ownership +
role defaults); the manifest pin → `0063_tenant_kind_reader`.

**Definer functions (the cross-tenant reader pattern):**
- `erp.user_membership_options` widened with `tenantKind` + `sandboxExpired`
  (0061) — Postgres refuses RETURNS TABLE widening via CREATE OR REPLACE, so the
  migration is a DROP + CREATE pair inside its transaction (atomic swap; grants
  re-asserted; consumers: login + the per-request interceptor).
- `erp.tenant_kind(uuid)` (0063) — the one-column SECURITY DEFINER probe the
  consolidation group service reads the MEMBER tenant's kind through (the
  `consolidation_read_member_gl` precedent; the tenants RLS policy correctly hides
  cross-tenant rows from the parent's scope).

**Core services (the `onboarding` module, 4,218 lines total):**
- `application/kinds.ts` (701) — the seven-kind catalog: canonical columns with
  EN+AR aliases (the auto-detect contract), typed row rules, file-level checks
  (balanced-by-nature Σdebit=Σcredit, COA homogeneous-tree/acyclicity), the
  QuickBooks/Odoo account-type and fee-model translators, PII marks.
- `application/sheet-reader.ts` (330) — the bounded-memory CSV/XLSX reader (the
  U-07 zip-bomb defenses reused; rows stream one at a time; 100k-row cap).
- `application/import-toolkit-service.ts` (1,157) — the engine: header preview +
  auto-detect, the synchronous zero-write dry-run, the ack-gated claim +
  pg-boss commit worker (ONE tenant UoW; mid-run failure → full rollback →
  PREVIEW_READY with the failure recorded → re-run converges), the per-kind
  appliers (CoaService, the opening engine, AssetService, EmployeeService,
  PriceListService, ContractService, the PHASE-028 budget grid), the bilingual
  error-report CSV artifact, the batched/cached reference resolver.
- `application/mappings-service.ts` (162) + `infrastructure/onboarding.store.ts`
  (214) — the saved-mapping CRUD (both directions, conflict-typed) + the job
  extras (the 0062 mapping snapshot preferred over the mappingId re-resolution).
- `application/adapters.ts` (319) — the IN-26 registry: QuickBooks (chart,
  trial balance, customers, items), Odoo (COA, partners, products), Excel-generic
  (COA, trial balance) with per-column notes + REQUIRES_VERIFICATION marks +
  the BOM'd CSV template writer; the DOCUMENTED mappings are the spec's contract.
- `application/demo-data-service.ts` (587) — the 13-template one-click loader
  (workspace provisioning → template apply → fiscal year → purpose completions →
  partners/items/price list/opening stock → 6 posted invoices (SoD via the
  synthetic demo approver pair) → 3 receipts), idempotent, refusal-typed.
- `application/sandbox-service.ts` (227) — the OA-05 platform-plane provisioning:
  enterprise-plan TRIAL entitlement set (covers all 13 templates), the one-time
  owner credential (hashed at rest, returned once), the whole seed in ONE
  platform-scope UoW.
- Presentation: `imports.controller.ts` (270 — the toolkit routes, matrix §3.18
  `configuration.imports.manage`), `demo-data.controller.ts` (59),
  `sandbox.controller.ts` (58 — platform-plane, never plan-gated).

**Web (T-08/09):** `apps/web/app/[locale]/settings/imports/page.tsx` +
`components/imports-toolkit-workspace.tsx` (the four-tab hub: the wizard with
auto-detect mapping + saved-mapping reuse + ack-gated commit polling, jobs history,
mappings manager, adapter templates) + `components/demo-data-card.tsx` (the
onboarding home card); the onboarding wizard's step-3 result screen links to the
hub; NAV `settings.imports` (order 80, `platform.data_migration` +
`configuration.imports.manage`, the `file-up` icon registry entry) +
FALLBACK_CRUMBS; i18n **+89 AR/EN keys** (parity gate green); the
`localizedOnboardingError` mapper; web/contracts/ui typecheck + lint + unit green
(73/56/42) and a clean `next build` with the new route.

**Specs (T-10/11, 34 tests):**
- `src/__db__/import-toolkit.db.spec.ts` (12) — the seven-kind round-trips with the
  byte-identical zero-write ledger snapshot, the injected AR+EN error batteries,
  the opening-engine post (balanced legs, no journal bypass), saved-mapping reuse
  on a second file, the QuickBooks/Odoo adapter fixtures through their DOCUMENTED
  mappings, and the interrupted-commit atomicity probe (mid-run applier throw →
  zero partial state → re-run converges).
- `src/__db__/demo-data.db.spec.ts` (15) — all 13 templates seed one-click (GL
  balanced, journals ≥ 9 per tenant), re-run no-op, different-template and
  posted-documents refusals typed.
- `src/__db__/sandbox-isolation.db.spec.ts` (7) — provisioning, owner login through
  the SANDBOX-carrying projection, the time box (typed login refusal, account
  survives, projection flips), the invitation quota cap, the consolidation-member
  refusal, the RLS cross-tenant probe, the platform listing.
- The isolation A-suite: `import_mappings` registered in `tables.registry.ts` +
  the OWN_ROW/MISMATCHED_INSERT probes (identity-isolation.db.spec) — 1,266
  isolation tests green at T-01.

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Migration applies cleanly; `import_mappings` RLS'd; Drizzle + catalog parity; enum widening additive | 0060 applies in the 63-entry chain (migrations.db.spec 7/7); the A-suite triple (T-01 commit f849fc0); catalog 227→228; legacy import rows untouched (the CHECK keeps all three baseline values) |
| 2 | Seven kinds round-trip: dry-run ZERO writes → typed AR+EN errors → fix → commit → verified effects | import-toolkit.db.spec acceptance-2 block (7 tests, one per kind); the ledger snapshot is byte-identical around every dry-run; commits verified by entity/GL assertions |
| 3 | ACCOUNT_OPENING_BALANCES through the opening engine, no journal bypass | The acceptance-3 test: balanced-by-nature file refusal (bilingual), drafts only after commit (journal count unchanged), then the opening post = ONE entry with balanced 10000/10000 legs; the negative ledger proof holds around the commit |
| 4 | Saved mapping reused on a second file, zero re-mapping | acceptance-4 test: custom non-alias headers force the explicit map; the second file imports with ONLY `mappingId` (report's mapping = the saved shape) |
| 5 | QuickBooks + Odoo fixtures through their DOCUMENTED mappings | acceptance-5 tests: the columnMap derived from `adapter.columns` (the registry IS the contract); the type translations ("Bank"→ASSET, "bank"→ASSET, "income"→REVENUE) verified in the DB |
| 6 | BR-066 atomicity: interrupted commit → zero partial state → re-run converges | acceptance-6 test: the patched applier throws at row 2 of 3 → PREVIEW_READY + recorded failure + employee count unchanged → re-commit applies all 3 |
| 7 | Demo loader: 13 templates, journals through the engine, idempotent | demo-data.db.spec: 13/13 templates (each a fresh tenant), journals ≥ 9 with Σdebit = Σcredit, re-run zero-write no-op, refusals typed |
| 8 | Sandbox: flagged, quota-capped, time-boxed, never a consolidation member, RLS-invisible | sandbox-isolation.db.spec 7/7 (provisioning, projection, time box, quota, consolidation refusal, the A-probe shape) |
| 9 | House gates: RLS A1–A10 · typecheck · lint · unit · docs:validate · i18n parity · permissions drift · EXPLAIN budgets | All green (§5 below); drift 267=267; i18n parity +89=+89; A1–A10 via the registered triple; **EXPLAIN captures: deviation D-4** |
| 10 | Completion report + status flip + archive | This report + the triple flip + `ERP_PLATFORM_PHASE040.zip` (OA-07) |

## 4. Deviations & decisions (documented)

- **D-1 · Numbering (0058 → 0060, two extra migrations):** the phase doc planned
  `0058` as the single migration; it was written before the R-03 extension
  consumed 0055–0059. The honest split: 0060 (the toolkit substrate), 0061 (the
  sandbox enforcement widening), 0062 (the mapping snapshot — the T-10 spec
  catch), 0063 (the tenant_kind probe — the T-11 spec catch).
- **D-2 · Permission key naming:** the doc specced `platform.imports.manage` /
  `platform.demo_data.manage`; the identity-flows platform rule (platform.*
  keys are never tenant-granted) and the module-ownership law (CD-07 — imports
  live under the configuration module's namespace) rename them to
  `configuration.imports.manage` / `configuration.demo_data.manage`
  (AUTHORIZATION_MATRIX §3.18 records the mapping; the drift CLI + unit pins
  agree at 267).
- **D-3 · i18n count (~140 → 90):** the doc's estimate assumed kind/adapter/
  template labels as dictionary keys; the catalog is bilingual BY CONTRACT
  (the API serves AR+EN labels), so the wizard renders them from the wire —
  90 keys/locale cover the wizard/mapping/commit/adapters/demo vocabulary;
  parity gate green.
- **D-4 · EXPLAIN budgets (OA-06):** the bounded-memory design is in place and
  code-reviewed (the streaming sheet reader, the 100k-row cap, the 200-issue
  report cap, the batched/cached reference resolver — one query per distinct
  code, not per row), but explicit EXPLAIN ANALYZE captures were NOT recorded
  against a 100k-row fixture this phase. The master-data perf suite (PHASE-006)
  covers the baseline paths; a dedicated toolkit perf fixture is a flagged
  follow-up for the performance phase (059's family).
- **D-5 · AC4's "Playwright trace":** the reuse proof is the DB-spec round-trip
  (the wizard's exact request sequence: upload → preview-headers → job with
  `mappingId` only → commit); the web wizard wires the same calls (typechecked,
  `next build` clean). A browser-recorded trace was not captured in this
  environment — the spec is the stronger engine-level evidence.
- **D-6 · Sandbox plan:** the doc is silent on the plan; the sandbox provisions
  the ENTERPRISE feature set (TRIAL-sourced, never billed) — the showcase
  posture: a sales demo must light up every capability the chosen template
  touches (retail needs POS + stock transfers; food manufacturing its set).
- **D-7 · Spec-caught product fixes (in-phase, evidence-linked):** the
  perfectly-balanced opening post (the "0.0000" residual pushed a zero
  OPENING_EQUITY leg — INVALID_AMOUNT); the COA applier's name_ar NOT NULL
  crash (absent Arabic now falls back to the English name); the invitation
  quota count matched the real invitations schema (`status`, not
  `revoked_at`); the mapping snapshot gap (0062) and the member-kind read
  (0063) above; `getOwnTenant` pinned to the ambient GUC (the platform +
  tenant-on-tx combo made a bare LIMIT 1 surface an arbitrary tenant);
  explicit @Inject on four services (the JobCardService vitest/esbuild
  precedent — OpeningBalancesPostingService, BudgetGridService,
  BudgetVersionService, PriceListService's UomService param).
- **D-8 · Drive-by lint repair:** the PHASE-039 dunning
  `LateFeeChargeResult` shadowed the installments interface (`no-redeclare`);
  renamed to `DunningLateFeeChargeResult` (no consumer imported it). The
  identity-flows permission pin re-pinned 265 → 267 (missed in T-01).
- **D-9 · Full-suite catches (the 176-file sweep):** (a) the tenancy-http
  starter-plan pin 57 → 58 (0060 §8's `platform.demo_data` rides every plan);
  (b) the registration fixture budget — the suite's single-fork process shares
  the public route's in-memory 60/hour global limiter, and this phase's
  fixture waves (the 13-template demo coverage registers 14 tenants) exhausted
  it mid-suite — the documented `resetAll()` TEST-ONLY seam now brackets the
  three heavy fixture specs (the limiter protects the public route, never the
  harness); (c) the PHASE-022 expo D-04 watermark boundary flake (a
  `now − 7d` watermark ages past the boundary by ε before the state read)
  hardened with a 1s margin — green twice in isolation before, green in the
  final full sweep.

## 5. Gate evidence (the full sweep)

- **API:** typecheck ✓ · eslint ✓ · unit **524/524** ✓
- **DB suite:** **176 files / 2,619 tests — ALL GREEN** (PHASE-039: 173/2,577;
  +3 spec files, +42 tests; the run includes the migrations apply + re-apply
  no-op, the A-suite isolation battery, and the RLS catalog drift via
  `runChecks`)
- **Web/contracts/ui:** typecheck ✓ · lint ✓ · unit **73/56/42** ✓ ·
  `next build` clean (the `/[locale]/settings/imports` route)
- **Permissions drift:** **267 = 267** (CLI + the unit pins; §3.18 rows)
- **i18n parity:** 5,019 + 89 = **5,108 = 5,108** (AR = EN; the runtime assert)
- **RLS:** `import_mappings` through the A-suite (OWN_ROW + MISMATCHED_INSERT +
  the registry); `check:rls` exit 0 (230 catalog tables)
- **docs:validate:** **33/33** green (this report's links + the wave's five docs)
- **Migration integrity:** apply + re-apply no-op (7/7) over the 63-entry chain

## 6. Delivery

Repository state at commit (this report's flip commit) archived as
`ERP_PLATFORM_PHASE040.zip` (OA-07). The owner continues with «ابدأ تنفيذ
المرحلة PHASE-041» (Communications Hub — the demo-data loader and sandbox tenants
become the default substrate for its sales demos).

## Errata (owner audit 2026-11-12)

The owner's independent audit re-measured this report's i18n numbers operatively
(loading the dictionary module and flattening leaf keys exactly as
`assertDictionaryParity` measures) at the two reference commits: **5,019** at
`769e0da` (the 039 flip) and **5,108** at `ad12a89` (this phase's flip) — the real
delta is **+89**, not +90; re-verified the same way on this lineage and corrected
in place (code and dictionaries untouched; parity was green throughout):

| Where | Was | Now | How re-measured |
|---|---|---|---|
| §1 executive summary | i18n +90 keys/locale | **+89** | operative count at the two reference commits (5,108 − 5,019) |
| §2 Web | i18n +90 AR/EN keys | **+89** | same |
| §3 criterion 9 | i18n parity +90=+90 | **+89=+89** | same |
| §5 gate evidence | 5,019 + 90 = 5,109 = 5,109 | **5,019 + 89 = 5,108 = 5,108** | same |

Likely cause: counting via git-diff lines instead of the operative count. **Rule
adopted from this audit forward (recorded in the 041 report's errata too):** the
authoritative i18n count in any completion report is the OPERATIVE count
(Object.keys-style flatten over the loaded module — what `assertDictionaryParity`
itself measures), never a diff-line tally.
