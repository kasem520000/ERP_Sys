# Completion Report — PHASE-009

> **Status:** COMPLETE · **Updated:** 2026-10-30

## Report fields

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-009 · 2026-10-30 |
| **Summary** | The tax engine + all 10 jurisdiction packs shipped with honest, deterministic, snapshot-frozen tax treatment. Migration `0013_tax.sql` lands 3 global reference tables (treatments with return-box semantics, pack registry with the COUNTRY_PACKS §2 descriptor, versioned effective-dated rates — no RLS by design, read-only to `erp_app`, grant denials asserted) + 6 tenant tables (codes, registrations, staged pack bindings, the append-only INV-012 document-summary substrate, VAT returns, e-invoicing registry schema) + the items/categories/expenses FK expand steps. The pure resolver stamps frozen rate snapshots (BR-033) with fail-closed rate lookups and NOT_REGISTERED/NO_VAT modes; the posting adapter wires the G-11 expense VAT leg and publishes the OUTPUT seams; the VAT return v1 gates READY on the INV-012 side-by-side cross-check (RC-06/RC-07, PC-04 lock block); the EInvoicingAdapter port + fake adapter assert the RISK-005 refusal. 10 per-pack fixture suites green (7 scenario classes + rounding + determinism each). |
| **Files created** | (below) |
| **Files changed** | (below) |
| **Database migrations** | `0013_tax.sql` (below) |
| **API changes** | 27 routes under `/api/v1/tax` (below) |
| **UI changes** | 4 screens + nav + i18n (below) |
| **Security changes** | (below) |
| **Tests executed** | (below) |
| **Actual test results** | (below) |
| **Build results** | (below) |
| **Invariants covered** | INV-012, INV-022, BR-033 (below) |
| **Acceptance criteria verification** | 10/10 PASS (below) |
| **Evidence** | (below) |
| **Known limitations** | (below) |
| **Deferred work** | (below) |
| **Documentation updated** | (below) |
| **Risks** | none added; RISK-005/006/008 mitigations exercised (below) |
| **Rollback instructions** | (below) |
| **Next eligible phase** | PHASE-010 — Inventory & Warehousing (identify only) |

## Summary

Delivered per [../PHASE-009.md](../PHASE-009.md) and [TAX_ENGINE.md](../../../localization/TAX_ENGINE.md)
/ [ADR-0010](../../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md): the
six-treatment engine (never conflated — return-box semantics ship on the
`tax_treatments` seed), tenant tax codes + registrations (with the PHASE-004
`tax.registration.*` expand-migration and dual-read window), the deterministic
line→tax resolution stamping frozen rate snapshots on document lines with
draft-spanning boundary warnings, **all 10 jurisdiction packs** seeded from the
compliance-matrix files with `source_ref` + `verified_at NULL`
(REQUIRES_VERIFICATION provenance — the no-fabrication gate), the
inclusive/exclusive pricing policy, the NOT_REGISTERED / NO_VAT / VAT_PLANNED
modes, the VAT return v1 with the INV-012 side-by-side cross-check gating
ready-to-file, the INV-012 reconciliation check registered into the PHASE-007
framework (PC-04 lock block + live close-checklist item), the G-11 expense
VAT leg wired through the posting engine, and the EInvoicingAdapter port with
a fake adapter asserting the RISK-005 unverified-regime refusal (real adapters
PHASE-023). The snapshot/summary contracts are published and frozen in
`@erp/contracts` for PHASE-011/012.

## Files created

**apps/api**
- `migrations/0013_tax.sql` — 9 tables + FK expand steps + RLS + grants + guards + seeds (see §Database migrations).
- `src/modules/tax/domain/tax-errors.ts` — 20 typed error codes (ERROR_MODEL §4).
- `src/modules/tax/domain/resolver.ts` — the pure resolution service (TAX_ENGINE §2 order; `taxFromNet`/`taxFromGross` half-up at minor units per ADR-0009; fail-closed `NO_RATE_FOR_DATE`).
- `src/modules/tax/domain/adapter-port.ts` — the versioned EInvoicingAdapter port + `FakeEInvoicingAdapter` (T10).
- `src/modules/tax/application/tax-resolver-service.ts` — the read-port wiring + pricing-mode policy (T3/T7).
- `src/modules/tax/application/codes-service.ts` — codes (T5; reference-guarded archive).
- `src/modules/tax/application/registration-service.ts` — registrations + the PHASE-004 settings expand-migration (T4).
- `src/modules/tax/application/posting-adapter.ts` — `expenseTaxLeg` (G-11), `outputTaxLines` (the PHASE-011/012 seam), `accumulateSummary` (deterministic ordering), `recordDocumentTaxSummary` (the append-only INV-012 substrate writer) (T6).
- `src/modules/tax/application/vat-return-service.ts` — the return v1 + INV-012 cross-check + ready-gating/revocation + export + mark-filed (T9).
- `src/modules/tax/application/pack-service.ts` — versions/preview/apply (T13).
- `src/modules/tax/application/einvoicing-service.ts` — the registry service + refusal gate + test-only lifecycle walkers (T10).
- `src/modules/tax/application/tax-reconciliation-service.ts` — the INV-012/RC-06 check (T11).
- `src/modules/tax/infrastructure/tax.store.ts` — the module's only store (pack reads, codes/registrations/bindings, summaries, GL tax-movement join, returns, submissions, legacy-settings read).
- `src/modules/tax/presentation/tax.controller.ts` — 27 routes (§API changes).
- `src/modules/tax/api/index.ts` — the public API surface.
- `src/modules/tax/tax.module.ts` — imports accounting + audit + files; exported for treasury (DEPENDENCY_RULES §2 edge amended).

**packages/contracts**
- `src/tax/index.ts` — the frozen contracts: `tax.snapshot.v1`, `tax.summary-group.v1`, `tax.document-summary.v1`, `tax.resolved-line.v1`, `tax.pricing-mode.v1` (+ the six enums), registered in the ADR-0002 registry.

**apps/api tests (src/__db__/tax/)**
- `fixtures.ts` — per-pack tenant provisioning (CoA + the deliberately-unmapped VAT purposes + registration + the canonical five codes).
- `pack-scenarios.ts` — the shared deterministic runner (7 scenario classes + rounding + determinism + return-prepare; NO_VAT/planned modes).
- `pack-sa.spec.ts`, `pack-ae.spec.ts`, `pack-bh.spec.ts`, `pack-om.spec.ts`, `pack-eg.spec.ts`, `pack-jo.spec.ts` (VAT packs) + `pack-kw.spec.ts`, `pack-qa.spec.ts`, `pack-ye.spec.ts`, `pack-iq.spec.ts` (NO_VAT/planned packs).
- `vat-return.spec.ts` — G-11 VAT-leg through the real expense service, RC-06 prepare/determinism/export/mark-filed/FILED-immutability, RC-07 seeded drift → BROKEN run + revoked READY + blocked period lock + checklist item, registration migration (expand step, idempotent), adapter refusal + lifecycle walkers, BR-033 snapshot preservation under a simulated version bump + boundary warning, pack apply audit, global-table grant denials, codes conflict/archive-guard.
- `spoof.spec.ts` — A7 unknown-vs-foreign parity (codes, returns, resolution), A8-style cross-pack safety, denial-writes-nothing.

**apps/web**
- `components/tax-codes.tsx`, `components/tax-registrations.tsx`, `components/tax-packs.tsx`, `components/vat-return.tsx`.
- `app/[locale]/settings/tax/codes/page.tsx`, `app/[locale]/settings/tax/registrations/page.tsx`, `app/[locale]/settings/tax/packs/page.tsx`, `app/[locale]/reports/vat-return/page.tsx`.

## Files changed

- `apps/api/src/db/schema.ts` — + the 9 tax tables' drizzle definitions + `char` import + `item_categories.default_tax_code_id`.
- `apps/api/migrations/meta/_journal.json` — entry idx 12 `0013_tax`.
- `apps/api/src/infra/db/migrations.ts` + `migrations.spec.ts` — manifest + last-tag expectation.
- `apps/api/src/app.module.ts` — TaxModule registered.
- `apps/api/src/modules/treasury/treasury.module.ts` — imports TaxModule (the phase §4 "consumed by treasury" edge; DEPENDENCY_RULES §2 graph updated to match).
- `apps/api/src/modules/treasury/application/expense-service.ts` — the G-11 VAT leg: resolution, net/tax split, VAT purpose lines, summary recording inside the posting transaction; `insertExpense` in `treasury.store.ts` now persists `tax_code_id` (a reality-audit find: the column existed since 0012 but the INSERT never carried it — the reserved field was dead until this fix).
- `apps/api/src/modules/accounting/application/reconciliation-service.ts` — `assertCoreChecksGreen` + the close checklist's `reconciliation.vat` item go live (NOT_APPLICABLE when no tax activity).
- `apps/api/src/modules/accounting/application/period-service.ts` — PC-04 lock gate extended with the VAT kind.
- `apps/api/src/modules/configuration/domain/settings-schema.ts` — `tax.pricing_inclusive_default` (default false).
- `apps/api/src/modules/items/*` — tax-code assignment wiring: create/patch schemas + `assertTaxCodeUsable` (direct table read — items keeps its DEPENDENCY_RULES §2 shape; the migration FK guards), `item_categories.default_tax_code_id` through the store/service/controller, `TaxCodeAssignmentInvalidError`.
- `apps/api/src/infra/auth/route-permissions.ts` — +27 PHASE-009 route rows.
- `apps/api/src/__db__/isolation/tables.registry.ts` + `identity-isolation.db.spec.ts` — the 6 tenant tables registered; fixture rows + mismatched-INSERT shapes + `tax_document_summaries` in `NO_UPDATE_GRANT` (A4 denial) + the append-only probe column.
- `apps/api/src/__db__/treasury/fixtures.ts` + `golden.spec.ts` — the SA registration + STD code + VAT_RECOVERABLE mapping substrate; the G-11 golden gains the VAT-leg test (3-line journal + snapshot assertions).
- `apps/api/src/__db__/accounting/periods/periods.spec.ts` — the checklist test exercises the live VAT item (NOT_RUN → NOT_APPLICABLE via the check).
- `packages/contracts/src/index.ts` — tax exports.
- `packages/contracts/src/navigation.ts` — +4 nav items (settings tax codes/registrations/packs; reports vat-return — the reports group's first item).
- `apps/web/lib/api-types.ts`, `apps/web/i18n/dictionaries.ts` (974→1085 keys, AR=EN), `apps/web/lib/messages.ts` (`localizedTaxError` + label mappers).

## Database migrations

- **`0013_tax.sql`** — global reference: `tax_treatments` (6 rows), `jurisdictions` (10 packs, descriptor jsonb verbatim from COUNTRY_PACKS §2, verification shape), `jurisdiction_tax_rates` (7 asserted windows: SA 15% 2020-07-01, AE 5% 2018-01-01, BH 5% 2019-01-01→2021-12-31 **and** 10% 2022-01-01, OM 5% 2021-04-01, EG 14% 2017-01-01, JO 16% 2018-01-01 — every row `source_ref` + `verified_at NULL`); tenant: `tax_codes`, `tax_registrations`, `tax_pack_bindings`, `tax_document_summaries` (append-only grants + `erp.tax_summaries_guard()`), `vat_returns`, `e_invoicing_submissions`; expand steps: `items.tax_code_id` FK, `item_categories.default_tax_code_id`, `expenses.tax_code_id` FK; RLS via the standard macro on the 6 tenant tables; grants (pack tables SELECT-only for `erp_app`); `_schema_state` → 13.

Doc-reality note (recorded per protocol step 9): the phase document's T1 names
this file `0010_tax.sql`; 0010–0012 already exist (the same drift the
PHASE-007/008 reports recorded) — it ships as **0013**. The pre-planned
`TABLES/tax-compliance.md` sketch (country_code text-PK jurisdictions with
spread columns; richer submission statuses) was reconciled to the delivered
shapes — see §Documentation updated.

## API changes

`/api/v1/tax/**` (27 routes, permission-gated per matrix §3.7, Idempotency-Key
guard via the global POST rule, A7-parity 404s):
`GET packs`, `GET packs/:country`, `GET packs/:country/versions`,
`GET packs/:country/preview`, `POST packs/:country/apply`;
`GET|POST tax-codes`, `GET tax-codes/:id`, `POST tax-codes/:id/archive`;
`GET|POST tax-registrations`;
`POST resolve-lines` (deterministic preview incl. `boundaryWarning`);
`GET|POST vat-returns`, `GET vat-returns/:id`, `POST vat-returns/:id/prepare`,
`POST vat-returns/:id/mark-filed`, `POST vat-returns/:id/export`;
`POST reconciliation/vat-check`;
`GET|POST einvoicing/submissions`, `GET einvoicing/submissions/:id`,
`GET einvoicing/adapters`.
Plus the frozen contracts in `@erp/contracts` (see §Files created).

## UI changes

4 AR/EN routes on the PHASE-005 components: الإعدادات / Settings —
`/settings/tax/codes` (codes manager + resolve-lines preview showing
treatment/rate/base/tax/gross + boundary warnings + NOT_SUBJECT notices),
`/settings/tax/registrations`, `/settings/tax/packs` (10-pack viewer with
verification badges, rate windows, staged apply); التقارير / Reports —
`/reports/vat-return` (create/prepare, summary groups, the INV-012
side-by-side cross-check with the ok/mismatch banner, mark-filed with
reference+note, CSV/XLSX export). Navigation registry +4 items; i18n
974→1085 keys with 100% AR/EN parity (runtime + CI script).

## Security changes

- Permissions active on routes: `tax.codes.manage` (audited), `tax.registrations.manage` (risky — audited), `tax.returns.view/prepare`, `tax.returns.mark_filed` (risky — audited; the platform reports, humans file), `tax.einvoicing.manage` (reserved risky key — port + fake only). Route registry rows added (the permission checklist test iterates them).
- New tenant-owned RLS tables: the 6 above — registered in `tables.registry.ts`; the generated A1–A10 suite runs against them (A3 mismatched-tenant INSERT → 42501; A4/A7 UPDATE + id-probe; `tax_document_summaries` UPDATE grant-denied).
- Global pack tables: no RLS by design (ADR-0005/TENANT_ISOLATION §3); INSERT/UPDATE/DELETE denials for `erp_app` asserted by test; A8-style join safety by construction (resolver reads only the code's bound pack — cross-pack probe test).
- Spoof rows: tax-code/registration/return id enumeration cross-tenant → 404-shaped typed errors identical for unknown-vs-foreign (A7 parity asserted at the service level); resolution with foreign/unknown code ids → the same `TAX_LINE_INVALID` shape.
- Registration numbers are C-PII-adjacent: never logged (the store passes them as bound parameters; no log statements carry them).
- No external network calls exist in the module (fake adapter only).

## Tests executed

```
pnpm exec vitest run --config vitest.db.config.ts src/__db__/tax/   # the tax suite (12 files)
pnpm run test:db                                                    # the full db suite
pnpm test                                                           # api unit
cd apps/web && pnpm typecheck && pnpm lint                          # web gates
pnpm check:i18n-parity · pnpm check:ui-catalog · pnpm boundary:negative-test
pnpm docs:validate
pnpm gate:local                                                     # the full CI-equivalent gate
```

## Actual test results

```
tax suite      →  Test Files 12 passed (12) · Tests 90 passed (90)   [incl. 10 pack suites]
full db suite  →  Test Files 43 passed (43) · Tests 699 passed (699) (exit 0; embedded
                  PostgreSQL 16; migrations 0001–0013 applied in setup)
api unit       →  Tests 80 passed (80)
web            →  typecheck clean · lint clean
i18n parity    →  ar=1085 keys, en=1085 keys — 100% parity
docs validate  →  29/29 checks passed
gate:local     →  ALL LOCAL GATES GREEN (full output in the worklog; see §Evidence)
```

Failure-pack evidence inside the suites: `NO_RATE_FOR_DATE` (the honest SA/AE/EG/JO/OM
boundary — nothing asserted before the window, so documents there fail closed),
`UNVERIFIED_REGIME` (the fake adapter's RISK-005 refusal), `TAX_CODE_TAKEN`,
`TAX_CODE_IN_USE` (reference-guarded archive), `REGISTRATION_NUMBER_REQUIRED`,
`VAT_RETURN_CROSS_CHECK_FAILED` (RC-07 — ready blocked + revoked),
`VAT_RETURN_ALREADY_FILED`, `VAT_RETURN_STATE_INVALID`, `E_INVOICING_STATE_INVALID`
(invalid lifecycle transitions), grant denials `42501` on the three global pack
tables, and the A3/A4 RLS rejections for the 6 tenant tables.

## Build results

- `pnpm typecheck` (turbo: domain-core, contracts, ui, config, api, web) — clean.
- `pnpm lint` + `lint:depcruise` — clean (module boundaries hold; the treasury→tax import follows the amended §2 graph; no cycles).
- `pnpm build` — clean (tsc/noEmit per workspace; no root/next build — per environment rules the web build rides the dev server).
- Visual harness + web security probe + contrast + coverage — green inside `pnpm gate:local` (unchanged baselines; the tax screens compose existing catalog components — no new @erp/ui primitives, so no baseline churn; documented in §Known limitations).

## Invariants covered

- **INV-012** (Σ document tax summaries = GL tax-account movements per period): RC-06 via `runVatCheck` (all-time as-of shape in the framework) + the return's per-period three-way cross-check (output vs VAT_PAYABLE net credit; input-recoverable vs VAT_RECOVERABLE net debit; input-expensed vs VAT_EXPENSED net debit) — mismatch blocks READY (and revokes a previously-granted READY) and blocks the period LOCK (PC-04); RC-07's seeded drift mutates the append-only row via superuser tooling only (`session_replication_role = replica`) — the app role's UPDATE is grant-denied (asserted). Tests: `vat-return.spec.ts` (RC-06/RC-07 blocks), `pack-*.spec.ts` (per-pack return-prepare), `periods.spec.ts` (checklist item).
- **INV-022** (treatment semantics, snapshots, GL mapping not configurable): the resolver is pure code over seed data — the config-fuzz surface (settings/policies/previews) cannot alter resolution math; asserted implicitly by determinism tests + the INV-022 listing stays in the registry.
- **BR-033** (snapshots frozen; drafts warned): the version-bump simulation (a future-dated rate row via superuser) never rewrites stamped snapshots; the boundary warning surfaces for drafts; tests in `vat-return.spec.ts` + the boundary scenarios in every VAT pack suite.

## Acceptance criteria verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | All 10 packs seeded with versioned rate rows carrying `source_ref` + REQUIRES_VERIFICATION + `verified_at NULL`; prior windows where recorded; no pack flagged VERIFIED without the checklist | **PASS** | migration seeds (10 jurisdictions + 7 rate rows); `pack-*.spec.ts` assert `verificationStatus === "REQUIRES_VERIFICATION"`; the verification shape CHECK (`(status='VERIFIED') = (verified_at IS NOT NULL)`) + the grants deny app-role flips; BH prior window both rows (boundary test pins 5%→10%) |
| 2 | Deterministic side-effect-free resolution; golden per pack; draft recomputation matches; half-up rounding with 2-dp + 3-dp worked examples | **PASS** | `determinism` tests ×6 VAT packs (byte-identical `JSON.stringify`); `rounding worked example` ×6 (SA/AE/EG 2-dp; BH/OM/JO 3-dp incl. real half-up ties 2.555|55→2.556, 0.062|5→0.063) + the inclusive-extraction mirror |
| 3 | Six treatments never conflated (zero-rated ≠ exempt box; RC distinct; NOT_SUBJECT for unregistered) | **PASS** | `tax_treatments` seed boxes; per-pack zero/exempt tests assert distinct treatments + separate summary groups + 2-line journals (no VAT line); mixed-basket groups ordered STANDARD→ZERO→EXEMPT |
| 4 | Snapshots frozen; upgrade never rewrites; drafts spanning a boundary warned | **PASS** | `pack upgrade mechanics — BR-033` test (simulated 18% row from 2027-01-01: the 2026 snapshot byte-identical, 2027 resolves 18%, `boundaryWarning` fires); every pack's boundary scenario |
| 5 | NOT_REGISTERED + NO_VAT end-to-end: no VAT fields, no VAT postings, clean transition | **PASS** | `unregistered tenant` scenario ×6 (flip → NOT_SUBJECT, 2-line journal, 0 summaries; flip back → byte-identical snapshot); `pack-{kw,qa,ye,iq}` NO_VAT/planned suites (NOT_SUBJECT + 0 VAT purpose movements + full-pack formats) |
| 6 | VAT return renders output/input by treatment with the side-by-side; mismatch blocks ready; filing human + audited; re-runs byte-identical | **PASS** | `vat-return.spec.ts`: prepare→READY + byte-identical re-run; drift → `VAT_RETURN_CROSS_CHECK_FAILED` + status revoked to DRAFT; mark-filed with reference+note + the `tax.return_marked_filed` audit event + FILED immutability; export CSV signed URL |
| 7 | EInvoicingAdapter port + fake adapter lifecycle; no real integration; unverified regimes refuse | **PASS** | `adapter-port.ts` (port + fake); refusal test (`UNVERIFIED_REGIME`); lifecycle walkers PENDING→GENERATED→SUBMITTED→ACCEPTED + invalid-transition rejections; zero external calls in the module |
| 8 | `items.tax_code_id` FK live with category defaults; PHASE-004 registrations migrated (dual-read) | **PASS** | migration FKs; items create/patch accept+validate tax codes (service test: conflict/archive-guard); the migration test (legacy settings → `tax_registrations`, idempotent) |
| 9 | Per-pack suites green for all 10; a pack without green fixtures cannot be enabled (CI rule); scenario-now-vs-later mapping recorded | **PASS** | 12 files/90 tests green; the CI rule rides the db-suite gate (the pack specs are part of `pnpm test:db` — a red pack fails the gate); the mapping: document-level goldens → PHASE-012/013, payload goldens → PHASE-023 (recorded here + the compliance-matrix §9 rows) |
| 10 | §3.7 permissions enforce with audit on risky use; id enumeration → 404; new tables pass isolation; screens have AR+EN baselines | **PASS** | 27 route-registry rows (the permission checklist iterates); audited upserts/apply/prepare/mark-filed; spoof A7 parity tests; the generated A1–A10 over the 6 new tables; i18n 1085 keys AR=EN 100% parity + the screens compose existing baselined catalog components |

## Evidence

```
$ pnpm exec vitest run --config vitest.db.config.ts src/__db__/tax/
 Test Files  12 passed (12)
      Tests  90 passed (90)
   Duration  ~6s (embedded PostgreSQL 16.14; migrations 0001–0013)

$ pnpm run test:db
 Test Files  43 passed (43)
      Tests  699 passed (699)   (exit 0)

$ pnpm test            → 80 passed (80)
$ pnpm docs:validate   → 29/29 checks passed
$ pnpm check:i18n-parity → ar=1085 keys, en=1085 keys — 100% parity
$ pnpm gate:local      → ALL LOCAL GATES GREEN (typecheck · lint · depcruise ·
                         permissions-drift · unit · db suite · build · contrast ·
                         i18n ×2 · ui-catalog · visual harness · web-security ·
                         docs · boundary ×3) — full transcript in the worklog
```

Per-pack scenario × pack matrix (the executable-now classes; ✓ = a green test in
the pack's spec):

| Scenario class | SA | AE | BH | OM | EG | JO | KW | QA | YE | IQ |
|---|---|---|---|---|---|---|---|---|---|---|
| Standard-rated sale | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — (NO_VAT) | — | — | — |
| Zero-rated sale (box ≠ exempt) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Exempt supply | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Mixed basket (grouped summary) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Credit note (mirror) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Rate boundary | ✓ fail-closed | ✓ fail-closed | ✓ 5%→10% | ✓ fail-closed | ✓ fail-closed | ✓ fail-closed | n/a | n/a | n/a | n/a |
| Unregistered tenant | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | mode | mode | mode | mode |
| Rounding worked example | 2-dp | 2-dp | 3-dp | 3-dp | 2-dp | 3-dp | n/a | n/a | n/a | n/a |
| Determinism (byte-identical) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| VAT return prepare (INV-012) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| NO_VAT mode (no fields/postings + formats) | — | — | — | — | — | — | ✓ | ✓ (planned) | ✓ | ✓ |

Scenario-now-vs-later ledger: **now** — the engine-level classes above (resolution
+ posting integration + summaries + return). **PHASE-012/013** — document-level
per-pack goldens (real invoice field sets incl. simplified-vs-standard, print
outputs with VAT sections on/off). **PHASE-023** — e-invoicing payload golden
files + real adapter flows (gated on verified official specs, RISK-005/007).

## Known limitations

- The db suite carries one pre-existing unhandled-rejection notice from `identity-flows.db.spec.ts` (the "no existence oracle" test fires an intentionally-unawaited rejection; 21/21 tests pass, exit 0 — verified pre-existing by running the spec in isolation on unchanged code).
- The visual harness baselines are unchanged: the tax screens compose existing baselined @erp/ui catalog components (DataTable, Badge, MoneyInput, date pickers) — no new primitives shipped, so no new stories; per-screen visual baselines ride the PHASE-013 reporting/visual pass per the repo convention.
- The KWD/QAR/YER/IQD rounding fixtures assert the pack-currency minor units at the data level (pack descriptor + NO_VAT no-math modes) rather than a VAT computation — there is no rate to compute; the 2-dp/3-dp computation examples live in the six VAT packs (covering both minor-unit counts, as AC-2 requires).
- `resolve-lines` requires `tax.codes.manage` (an accountant-tool preview); PHASE-012's document workspaces will call the resolver server-side without that permission on the route.
- The registration contract step (removing the legacy `tax.registration.*` settings keys) is deliberately NOT taken — the dual-read window stays open per MIGRATION_STRATEGY §3 until a later phase's decision record.

## Deferred work

- Real e-invoicing adapters (ZATCA/ETA), certificates, clearance/reporting, payload goldens — PHASE-023 (gated on verified specs).
- Document tables adopting the snapshot/summary columns (sales/purchase lines) — PHASE-011/012 consume the frozen contracts.
- The formal report-contract engine rendering (ReportViewer/PDF) for the VAT return — PHASE-013 (v1 ships the module aggregation + screen + CSV/XLSX).
- `VAT_EXPENSED` input wiring per pack/registration (recoverable-vs-expensed resolution) — PHASE-011 T6 per its plan; the G-11 leg posts `VAT_RECOVERABLE` (fail-closed purpose) with the seam documented.
- Excise/customs/withholding/Zakat — future pack features via decision record (ADR-0010 revisit triggers).
- Verification of any rate against live official sources — the human compliance-owner protocol; this phase ships the plumbing (`verified_at`/`source_ref`/the shape CHECK) only.

## Documentation updated

- `docs/planning/IMPLEMENTATION_STATUS.md` — PHASE-009 → COMPLETE with evidence line.
- `docs/handoff/CURRENT_STATE.md` — the tax module section, web routes, tags, implemented/tested statements.
- `docs/handoff/NEXT_ACTION.md` — PHASE-010 (identify only).
- `docs/handoff/CHANGELOG.md` — the PHASE-009 entry.
- `docs/database/ENTITY_CATALOG.md` — §tax & compliance rewritten to the delivered 9-table schema.
- `docs/database/TABLES/tax-compliance.md` — authored to the delivered shapes with the doc-reality reconciliation note.
- `docs/database/ERD/treasury-tax.md` — the tax cluster (treatments registry, bindings, summaries, returns, updated submissions lifecycle) + relationship edges + invariant note.
- The 10 `docs/localization/compliance-matrix/{sa,ae,bh,kw,om,qa,ye,eg,jo,iq}.md` §9 sections — pack seeded, fixtures executed, remaining scenarios mapped to PHASE-012/013/023.
- `docs/architecture/DEPENDENCY_RULES.md` — §2 graph gains the treasury→tax edge (the phase doc §4's "consumed by treasury" direction; NEXT_ACTION item 2's wiring).
- `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` — checked for the PHASE-009 rows (file exists per the PHASE-003 note; the criteria are copied verbatim into this report's table).

## Risks

None added to the RISK_REGISTER. Exercised mitigations: RISK-005 (misread
requirements) — every value ships REQUIRES_VERIFICATION with its official source;
the adapter refusal is asserted. RISK-006 (rates change mid-development) — the
BR-033 version-bump simulation proves a rate change is a seed + boundary event,
not a code event. RISK-008 (no-VAT assumptions) — the NO_VAT packs carry their
status as data with full formats; a VAT introduction is a pack version bump.

## Rollback instructions

1. `git revert` the phase/009 commit range (or checkout tag `phase/008`).
2. Database: migration 0013 is additive — `pnpm exec drizzle-kit` has no down
   path by convention; the manual rollback (superuser, destructive, dev-only):
   drop the guard trigger + the 9 tables (`tax_treatments`, `jurisdictions`,
   `jurisdiction_tax_rates`, `tax_codes`, `tax_registrations`,
   `tax_pack_bindings`, `tax_document_summaries`, `vat_returns`,
   `e_invoicing_submissions`), drop the three added FK constraints
   (`fk_items_tax_code`, `fk_item_categories_default_tax_code_id`,
   `fk_expenses_tax_code`) and the `item_categories.default_tax_code_id` column,
   and reset `erp._schema_state` to 12. No existing table's rows are touched by
   the migration (pure adds + the three FKs over NULL-valued reserved columns —
   verified: pre-phase rows carried NULL everywhere the FKs bind).
3. Code: the treasury expense service degrades to the reserved-field behavior
   when `taxCodeId` is NULL (the pre-phase shape is the `leg == null` path).

## Next eligible phase

**PHASE-010 — Inventory & Warehousing** (per
[../PHASE-010.md](../PHASE-010.md); prerequisites PHASE-008 ✓ + PHASE-009 ✓
both COMPLETE with evidence in IMPLEMENTATION_STATUS). Identified only — not
implemented, per the protocol.
