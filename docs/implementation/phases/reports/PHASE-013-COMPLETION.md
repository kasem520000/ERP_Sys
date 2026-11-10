# Completion Report — PHASE-013

> **Status:** COMPLETE · **Updated:** 2026-11-01

| Field | Value |
|---|---|
| Phase ID / Date | PHASE-013 — Reporting, Statements & Printing · 2026-11-01 |
| Summary | The `reporting` module per ADR-0011 + REPORTING_ARCHITECTURE: the code-defined report-contract registry (48 contracts, boot-validated), inline + pg-boss execution with permission re-resolution (FORBIDDEN_AT_RUN), as-of-keyed cache with ledger-event invalidation, the §11 assertion engine blocking exports server-side, the four financial statements (FINANCIAL_REPORT_RULES exact) with the drill chain, the operational report set over module query services, the 4 versioned RTL-correct print templates with a Chromium render service, exceljs XLSX (RTL views, values-only), CSV BOM, tafqit, and audited signed-URL artifacts — plus the `/reports` web workspace. |
| Files created / changed | (below) |
| Database migrations | `0020_reporting_core.sql` (below) |
| API changes | 8 routes under `/api/v1/reporting` (below) |
| UI changes | `/[locale]/reports` workspace (below) |
| Security changes | 26 granular `reports.*.read` keys + `platform.reporting.read` (below) |
| Tests executed | unit suite + db suite + visual harness + web security probe + docs validation (below) |
| Actual test results | 142/142 unit · 1075/1075 db (×2 consecutive) · 16/16 visual harness stories · 29/29 docs (below) |
| Build results | `pnpm gate:local` ALL 17 STEPS GREEN, `FINAL_GATE_EXIT_CODE=0` (below) |
| Acceptance criteria | 11/11 PASS (below) |
| Evidence | `/tmp/gate.log` transcript + agent-ctx worklogs (below) |
| Known limitations | (below) |
| Deferred work | (below) |
| Next eligible phase | PHASE-014 (identify only) |

## Summary

PHASE-013 delivers the trust-becomes-visible layer: every report is a code-defined,
boot-validated contract; every financial report self-checks the §11 assertions with
exact-decimal tolerance 0 and **refuses to export on failure — server-side**; every
statement derives exclusively from posted journal lines under an as-of posted_at
cutoff that makes re-runs byte-identical (CI-proven); and the number on paper is the
number in the ledger because exports render from the stored run envelope through the
same versioned templates the web preview shows.

## Files created (selected)

- `apps/api/migrations/0020_reporting_core.sql` + journal idx 19 + drizzle schema rows
- `apps/api/src/modules/reporting/` — `reporting.module.ts` (boot registry validation),
  `domain/reporting-errors.ts`, `application/{contract,run-service,scope,assertions,cache}.ts`,
  `application/export/{csv,xlsx,tafqit,export-service,pdf-print}.ts`,
  `application/render/{render-engine,engine-holder,pdf-a}.ts`,
  `infrastructure/reporting.store.ts`, `presentation/reporting.controller.ts`,
  `registry/` (runtime, kit, services, feed, financial/{statements,close-pack},
  operational/{ar-ap,sales,purchasing,inventory,treasury-tax-platform}) — 48 contracts
- New module query services: sales `sales-analytics.ts`, purchasing `ap-analytics.ts`,
  inventory `inventory-queries.ts`, treasury `treasury-queries.ts`, partners
  `partner-queries.ts`, tax `tax-queries.ts`, identity `user-queries.ts`;
  accounting `statement-queries.ts` (T6) + `ledger-events.ts` (cache-invalidation bus)
- `packages/ui/print/` — `templates.ts`, `print-css.ts`, `fonts.ts` (embedded woff2),
  `generate-fonts.mjs`; package export `@erp/ui/print` (sanctioned in the erp-ui
  import-path rule)
- Web: `apps/web/app/[locale]/reports/page.tsx`, `components/report-workspace.tsx`
- Tests: `apps/api/src/modules/reporting/__tests__/{reporting-unit,print-templates}.spec.ts`,
  `apps/api/src/__db__/reporting/{fixtures,golden,asof,runs,exports,render}.spec.ts`

## Files changed (selected)

- `accounting/application/posting-service.ts` + `period-service.ts` — publish
  `journal.posted` / `period.locked` ledger events (the reporting cache invalidation seam)
- `accounting/infrastructure/journal.store.ts` — statement substrate (window/balances/
  ledger/unbalanced/cost-centers/FX feeds + purpose-account resolution)
- `sales/application/ar-queries.ts` + `sales/infrastructure/sales.store.ts` — the
  `ar.allocations` reporting feed (Σ allocations == Σ receipts.allocated_amount tie)
- `audit/` — `AuditQuery` gains `actorId`/`action` filters (user-activity report feed)
- `infra/http/error.filter.ts` — FORBIDDEN_AT_RUN (403) + ASSERTION_FAILED /
  PARAMS_INVALID / CONTRACT_VERSION_MISMATCH (422)
- `infra/auth/route-permissions.ts` — 8 reporting routes; `infra/concurrency/semaphore.ts` (new)
- `migrations/0004/0005` — 26 granular keys + role-template grants; matrix §3.8/§3.10;
  permissions-drift 224 = 224
- `packages/ui/lint/plugin.mjs` — `@erp/ui/print` sanctioned on the import-path surface;
  print palette exempted from no-raw-design-values (versioned template artifact)
- `packages/contracts/src/navigation.ts` — `reports.workspace` nav item;
  `apps/web/i18n/dictionaries.ts` 1465 → 1505 keys (both locales)
- Status docs: IMPLEMENTATION_STATUS, CURRENT_STATE, NEXT_ACTION (→ PHASE-014),
  CHANGELOG, REPORT_CATALOG §13/§14, ENTITY_CATALOG §reporting, PHASE-013.md header

## Database migrations

`0020_reporting_core.sql`: `report_runs` (execution records — status/stage lifecycle,
params + params_hash, assertion_status, the stored result envelope, artifacts,
**unique (tenant_id, report_key, params_hash)**: re-runs replace their own artifacts,
never duplicate) and `print_templates` (per-tenant registry of the 4 code-defined base
templates, idempotently synced). RLS + grants (SELECT/INSERT/UPDATE, no DELETE) +
erp_readonly/erp_definer; both tables registered in the isolation A-test registry
(612-test generated suite green). No business tables — the reporting module owns zero
business data (binding principle, RISK-016).

## API changes

`GET /api/v1/reporting/reports` (registry snapshot — navigation + command menu);
`POST /reporting/report-runs` (execute — inline returns the envelope, heavy returns a
run id); `GET /report-runs` + `GET /report-runs/:id` (history/polling);
`GET /report-runs/:id/result`; `POST /report-runs/:id/exports` (PDF/XLSX/CSV via the
files module — signed URL, sha256, audited); `GET /print-preview/:id`; `GET
/print-templates`. Errors typed per ERROR_MODEL: `FORBIDDEN_AT_RUN` (403 — permission
revoked mid-queue, zero partial artifacts), `ASSERTION_FAILED` (422 — export block),
`PARAMS_INVALID`, `CONTRACT_VERSION_MISMATCH`, `FEATURE_NOT_ENTITLED` (existing guard).

## UI changes

The Report Page archetype at `/[locale]/reports`: registry-driven catalog grouped by
category (permission-filtered), declarative parameter bar + **saved views**
(localStorage parameter sets — no new tables per the phase constraint), run +
QUEUED→RUNNING polling with stages, ReportViewer (group tree, check totals with the
lock glyph, assertion footer — danger banner disables exports on FAIL, freshness
"كما في … / as of …", drill links), export menu (signed URLs), print preview
(iframe srcDoc — the same HTML the renderer prints), run history. NAV item
`reports.workspace`; i18n 1465 → 1505 (AR+EN parity enforced).

## Security changes

26 granular `reports.*.read` keys + `platform.reporting.read` seeded (0004 §3.8 +
AUTHORIZATION_MATRIX; drift check 224 = 224 GREEN). Role templates: viewer holds the
read tier (statements + operational reads), accountant adds close pack + export,
owner holds all; platform_admin 9 → 10 platform keys (identity-flows checklist
updated; catalog 199 → 224). Export permission (`reporting.reports.export`) is
separate from run permission. Drill-link generation checks target permissions;
scope = intersection of requested and granted branches (never the request alone).

## Tests executed (gate transcript `/tmp/gate.log`)

- `pnpm test` (unit): **Test Files 17 passed (17), Tests 142 passed (142)** — registry
  meta-tests (malformed/dup/unknown-perm/missing-§11 fail boot validation), cache
  (order-insensitive hash, TTL, 60 s current cap, ledger-event invalidation), scope
  intersection, §11 assertion helpers, tafqit ×12 (per locale + 3-dp currencies),
  CSV BOM/RFC4180/CRLF, XLSX RTL/values-only, semaphore bounds, print templates
- `pnpm test:db`: **Test Files 62 passed (62), Tests 1075 passed (1075)** — run twice
  consecutively, both green. Reporting specs: golden envelopes (TB debits==credits,
  AR closing 880.0000, IS net 900.0000, BS difference 0.0000, bs-current-year-once,
  CF cash tie, snapshot 48, byte-identical fixed-asOf re-runs), as-of freeze
  (later-dated posts + later-created pre-dated entries invisible to an earlier asOf),
  run lifecycle (idempotent re-run count 1, QUEUED job path, FORBIDDEN_AT_RUN with
  zero artifacts), exports (signed URL + sha256 + artifacts row + `report.exported`
  audit; seeded unbalanced entry → assertion FAIL → export blocked), real-Chromium
  render (≥2 pages with repeated thead, PDF/A stamp preserves pages), isolation
  A-tests over both new tables
- Visual harness: **16 passed (1.5m)**; web security probe: **1 passed (34.8s)**;
  docs validation: **29/29 checks passed**
- `pnpm gate:local`: **all 17 steps exit 0 — "ALL LOCAL GATES GREEN"`,
  `FINAL_GATE_EXIT_CODE=0` (re-executed end-to-end after the transcript run)

## Acceptance criteria verification

1. **PASS** — registry validates all 48 contracts at boot (zod + provenance +
   permission + §13 phase-readiness + §11 minimum set); meta-tests prove the failure
   modes; every contract declares dataSources with bilingual purpose.
2. **PASS** — TB/GL/IS/BS/CF per FINANCIAL_REPORT_RULES: contra aggregation via
   purposes (never by name), RE composition counted once (bs-current-year-once),
   indirect CF with the displayed "أخرى / Other" limitation, comparatives re-derived,
   as-of byte-identical re-runs (golden suite).
3. **PASS** — §11 assertions + operational ledger-tie assertions (sales-gl-tie,
   purchasing-gl-tie, INV-009/010/012/019 ties) execute per run, persist with compared
   values, and block export/print server-side (exports.spec seeded-corruption proof).
4. **PASS** — the drill chain statement → GL (accountId drill) → journal entry
   (entryId drill) → source document (sourceType/sourceId on every entry) with
   per-hop permissions on the contract drillTargets.
5. **PASS** — golden + property identities green; derivation-rule changes visibly
   update the golden expectations (the specs pin exact envelope values).
6. **PASS** — 4 print templates versioned (PRINT_TEMPLATE_VERSIONS) + RTL rules
   (dir=rtl, Western digits LTR-isolated via tabular mono, physical QR blocks,
   bottom-start footer template); Chromium render within contract (pool bound 2,
   60/300 s budgets, no-network routing, embedded woff2).
7. **PASS** — XLSX (RTL views, values-only — workbook inspected, zero formulas, typed
   columns) / CSV (BOM bytes asserted, ISO dates, decimal strings); artifacts via the
   files module with sha256 + 15-min signed URLs + audited issuance.
8. **PASS** — ar.aging / ap.aging / partner.statement / supplier.statement /
   ar.allocations registered over the PHASE-011/012 query services (the module
   screens' data paths unchanged — same services; the §3.4 gross-open presentation
   carried forward).
9. **PASS** — 26 `reports.*.read` keys in seeds + role matrix (drift 224 = 224).
10. **PASS** — statement queries run index-friendly window aggregations (the golden
    tenant doubles as the perf fixture; T-04 tier evidence recorded in the gate run —
    the full-suite db time budget held: 62 files / 1075 tests inside the gate).
11. **PASS** — the PHASE-013 row pre-exists in PHASE_ACCEPTANCE_CRITERIA.md (the file
    landed 2026-10-28); no deviation.

## Documentation-vs-reality reconciliation (found in-phase, fixed in-phase)

- **Journal substrate carries no branch dimension** (migrations 0001–0020): statements
  are consolidated by construction — financial contracts declare `branches:
  "fixed-all"` and the BS/IS notes state it; FINANCIAL_REPORT_RULES §1 branch subsets
  land with a branch-dimensioned journal substrate (documented in the module header,
  CURRENT_STATE, and here).
- **Chromium cannot emit conformance-level PDF/A**: the archive class renders as
  Chromium PDF 1.7 + the PDF/A-2b identification XMP stamp (pdf-lib) + artifact
  metadata recording the class honestly; true conformance-level PDF/A is post-MVP
  with a dedicated processor.
- **`salesAnalytics.*` / `userQueries.*` did not exist** despite being listed among
  the phase prerequisites — built in-phase as module-owned query services (the gap
  was flagged by the PHASE-012 handoff notes and is now closed).
- **Web E2E Playwright** (T15) remains waived to first infra availability per the
  standing PHASE-003 owner directive; coverage rides the API-level HTTP tests, the
  unit suites, and the @erp/ui harness.
- The phase doc's T15 path `apps/web/app/{locale}/reporting/**` vs the shipped
  navigation model: the workspace lives at `/reports` (the nav registry + existing
  reports-group convention) — same route family the catalog and command menu use.
- Route-checklist / drift constants updated in the same phase (catalog 199 → 224,
  platform set 9 → 10) — no silent side-picking.

## Known limitations

- Consolidated statements (no branch dimension on journal lines — above).
- PDF/A-2b = XMP identification stamp (above).
- The generic parameter bar covers the standard parameters; contracts requiring
  entity ids (partner statements, single-account GL) accept them via the API params
  and are surfaced through deep links/drill (the registry snapshot carries no zod
  schema — a FilterBar schema endpoint is a natural follow-up).
- Receipt templates are consumed by POS in PHASE-016 (rendered + tested now, unused
  by screens).

## Deferred work

- Scheduled reports + email delivery (`reporting.scheduled_reports` — PHASE-025 seam
  documented in PRINTING_AND_EXPORT §7).
- Dashboards/KPI screens (PHASE-014) — only the widget-binding seam documented in
  REPORT_CATALOG §14 (widgets are links, not parallel implementations).
- Industry-namespaced reports (PHASE-015+), commissions (PHASE-017), e-invoicing log
  (PHASE-023), direct-method CF (post-MVP enhancement, not a fix).

## Documentation updated

IMPLEMENTATION_STATUS (PHASE-013 → COMPLETE, header ..013), CURRENT_STATE (reporting
narrative + web + print package + tag `phase/013`), NEXT_ACTION (→ PHASE-014),
CHANGELOG (2026-11-01 entry), REPORT_CATALOG §13/§14 (48 rows delivered; saved views
note), ENTITY_CATALOG §reporting (columns synced to migration reality),
AUTHORIZATION_MATRIX §3.8/§3.10 (+ platform.reporting.read), this report.
`pnpm docs:validate` 29/29 green.

## Risks

- RISK-013 (Chromium-in-worker): bounded pool (2) + queue smoothing + the render
  contract as the control surface — honored.
- RISK-009: assertion failures are Sev-1 visible — the block-export behavior + banner
  + the failed run retained in history with compared values — honored.
- RISK-015 (Arabic shaping/RTL): Chromium (ADR-0011) + embedded woff2 + real-render
  PDF inspection tests (thead repetition, page count) — honored.
- RISK-016 (no direct table reads): contracts consume the module query services; the
  partners module's accidental journal.store import was removed in-phase (boundary
  scan).

## Rollback instructions

Revert the phase commits (tag `phase/013`) and drop tables `report_runs` /
`print_templates` (dev rollback; production forward-only per MIGRATION_STRATEGY).
No business tables touched — rollback cannot corrupt source data; runs/artifacts are
regenerable.

## Next eligible phase

**PHASE-014 — Subscription, Billing, Onboarding & Dashboards (MVP)** (identify only;
do not implement). It builds on this phase's export/print + report contracts (the
dependency edge 013→014: "Billing needs export/print + report contract for
invoices/statements") and the dashboard widget seam (REPORT_CATALOG §14: widgets bind
to report contracts in `current` mode with pinned parameters — widgets are links).
