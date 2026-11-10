# PHASE-013 — Reporting Engine, Financial Statements & Printing

> **Status:** COMPLETE · **Updated:** 2026-11-01

## 1. Phase Overview

- **Phase ID:** PHASE-013
- **Title:** Reporting Engine, Financial Statements & Printing
- **Objective:** Build the `reporting` module per
  [../../reporting/REPORTING_ARCHITECTURE.md](../../reporting/REPORTING_ARCHITECTURE.md)
  and [ADR-0011](../../architecture/ADR/ADR-0011-reporting-printing.md): the code-defined
  report-contract registry (validating every contract against the
  [../../reporting/REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md) schema at
  boot), inline vs pg-boss execution with run records and status polling, contract-level
  permission and scope enforcement, the four financial statements per
  [../../reporting/FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md)
  with comparative periods and as-of determinism and the full drill-down chain
  (statement → account → journal → source document), the operational report set
  (inventory, sales/purchasing analysis, AR/AP aging over live data, expenses, rich VAT
  return, audit/user activity), built-in reconciliation assertions that block exports on
  failure, and the print/export system — 4 versioned RTL-correct templates, Chromium
  (Playwright) server-side PDF rendering, exceljs XLSX with RTL views, CSV with BOM, and
  audited signed-URL artifacts through the files module.
- **Business value:** Trust becomes visible: an accountant (P-02) opens a trial balance
  that proves its own balance, drills from the balance sheet to the source invoice, and
  prints a bilingual RTL statement pack for the owner (Journey C's workspace, Journey E
  step E6) — the number on paper is the number in the ledger, or the report refuses to
  ship.

## 2. Scope

In scope:

1. **Report contract registry** (feature `reporting.engine`): TypeScript contract
   modules in `apps/api/src/modules/reporting/registry/`; boot-time zod validation
   against the REPORT_CONTRACT schema (malformed contract fails startup); unique id +
   monotonic version; registry snapshot (id, bilingual title, category, permissions)
   published to the web app driving report navigation and the command menu — a report
   without a registry entry is invisible by construction. Tenants save **parameter
   sets** (saved views), never new logic. Rows registered in this phase are the
   PHASE-013 set of [../../reporting/REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md)
   §1–§7 (data readiness §11 satisfied by phases 003–012).
2. **Run orchestration** (`report_runs` entity): `executionClass` per contract —
   **inline** for light bounded queries (p50 < 500 ms target) vs **pg-boss job** for
   heavy renders/consolidations (`QUEUED → RUNNING → succeeded/failed` with progress
   stage; client polls); permissions **re-resolved at execution time** (revoked grant
   kills a queued run — no TOCTOU); runs idempotent per `(report_id, params_hash)` —
   re-runs replace their own artifacts; result envelopes stored as the export source of
   truth (you print what you saw).
3. **Permission & scope enforcement at contract level (binding):**
   `requiredPermission` checked before parameter binding and again at job execution;
   effective scope = intersection of requested scope and user grants, never the request
   alone; drill-down links carry the same checks (disabled link with bilingual reason,
   never silent 403s in the money path); tenant isolation double-enforced (RLS +
   explicit tenant_id in every module query call).
4. **Financial statements** (feature `reporting.financial_statements`) per
   [../../reporting/FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md):
   - Trial Balance (`financial.trial-balance`): opening/period/closing per leaf account,
     one-side balances, group subtotals, zero suppression.
   - General Ledger (`financial.general-ledger`): account ledger with entry drill.
   - Income Statement (`financial.income-statement`): REVENUE/EXPENSE universe with
     **contra-account aggregation into parent presentation lines** (discounts/returns
     deduct from gross revenue — purpose mapping declares the parent, statements never
     guess by name); COGS section; fiscal-year boundary handling (period movement vs
     YTD).
   - Balance Sheet (`financial.balance-sheet`): as-of balances with the **retained
     earnings composition** (prior-year RE + closed current-year result − live YTD net
     income, counted exactly once — `bs-current-year-once`).
   - Cash Flow (`financial.cash-flow`): **indirect method** from IS + balance deltas
     with the **documented limitation displayed on the report itself** (untagged
     accounts aggregate into "أخرى / Other"); binding `cf-cash-tie` assertion against
     Δ cash+equivalents (INV-019).
   - Comparative periods: IS/CF one comparative column, BS prior-year asOf — always
     re-derived from posted lines, never stored snapshots.
   - As-of determinism: same `(scope, dates, asOf)` → byte-identical results (CI-tested);
     financial reports run as-of by default; "current" mode always renders freshness
     stamps.
5. **Drill-down chain:** statement line → GL (account + period + asOf) → journal entry
   (all lines, balanced) → source document (via `source_type` + `source_id`) → audit/
   reversal pair; deep links preserve scope and require the per-hop read permission
   ([../../reporting/FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md)
   §10).
6. **Report self-assertions** (features `reporting.exports` gating) per
   [../../reporting/REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md):
   every financial contract carries the minimum §11 set of
   FINANCIAL_REPORT_RULES (`tb-debits-equal-credits` ↔ INV-001, `tb-closing-net-zero`,
   `gl-entry-balance`, `is-tb-tie`, `bs-tb-tie`, `bs-current-year-once`,
   `is-net-equals-bs-current-result`, `cf-cash-tie` ↔ INV-019) as **executable checks**
   with exact-decimal tolerance 0; operational reports whose totals intersect GL carry
   at least one ledger-tie assertion (e.g., `sales-gl-tie`, inventory INV-010 tie, VAT
   INV-012 tie, subledger INV-009 ties); on FAIL the result is stored with
   `ASSERTION_FAILED`, the viewer shows the danger banner, and **export/print are
   blocked server-side**.
7. **Operational reports** (feature `reporting.operational_reports`) over module query
   services (registry respects data-readiness §11):
   - Inventory: `inventory.stock-on-hand`, `inventory.movement`,
     `inventory.valuation`, `inventory.expiry`, `inventory.count-variance`,
     `inventory.transfer-log`, `inventory.serial-tracking`,
     `inventory.slow-moving` (INV-010 footer ties).
   - Sales analysis: `sales.by-item`, `sales.by-customer`, `sales.by-rep`,
     `sales.by-payment-method`, `sales.by-branch`, `sales.document-flow`,
     `sales.profitability` (revenue − COGS by item/customer/rep/branch).
   - Purchasing: `purchasing.by-supplier`, `purchasing.by-item`,
     `purchasing.grni`, `purchasing.po-status`, `purchasing.matching-exceptions`.
   - AR/AP refresh to live data: `ar.aging`, `ap.aging`, `partner.statement`,
     `supplier.statement`, `ar.allocations`, `partner.balances` — registered now over
     the PHASE-011/012 query services (replacing the interim module screens' data paths
     with the same services; screens remain, contracts add export/print).
   - Treasury/expenses: `treasury.daily-cash`, `treasury.receipts-register`,
     `treasury.payments-register`, `treasury.expenses`, `treasury.petty-cash`,
     `treasury.fx-differences`, `treasury.shifts`, `treasury.bank-recon` (INV-019 ties).
   - Tax: **VAT return v2 (rich)** — `tax.vat-return` rendering both sides
     (document summaries vs GL movements) side-by-side with drill-down and treatment/
     rate-version buckets, plus `tax.summary-by-treatment` (INV-012 gating).
   - Platform: `platform.audit-trail`, `platform.user-activity`,
     `platform.report-runs`, `platform.subscription-usage`.
8. **Caching & freshness:** cache key `(tenant, report_id, contract_version,
   params_hash)` with as-of semantics in the key; invalidation on posting/reversal/
   period-lock events; "current" runs cached ≤ 60 s with computed-at stamps and stale
   badges; exports always render from the stored run envelope.
9. **Print system** (feature `reporting.print_templates`) per
   [../../reporting/PRINTING_AND_EXPORT.md](../../reporting/PRINTING_AND_EXPORT.md):
   - **4 versioned base templates** in `packages/ui/print` — `a4-document` (invoices,
     notes, statements, vouchers with bilingual legal footers from the jurisdiction
     pack), `a4-report` (statement/operational prints), `receipt-80`, `receipt-58`
     (RTL-correct receipt rules: Western digits LTR-isolated, physical QR/barcode
     blocks, condensed 58 mm mode; consumed by POS in PHASE-016).
   - **Chromium render service** (worker): pooled headless Chromium, same HTML payload
     as web preview, `@page` + real `<thead>` repetition, bottom-start page numbers,
     embedded woff2 fonts, tabular-nums, 60 s/300 s timeouts, PDF/A-2b for archive-class
     packs (period close), no user-supplied HTML, no network fetch inside render.
   - **exceljs XLSX**: RTL sheet views when run locale is Arabic, typed columns,
     identifiers as text, **values only (no formulas)**, bilingual title rows, footer
     block with asOf/computedAt/assertions.
   - **CSV**: UTF-8 **BOM**, ISO-8601 dates, decimal strings, RFC 4180 quoting.
   - **Artifacts**: stored via the `files` module with metadata (template version,
     sha256); short-lived signed URLs (15 min default); every download audited;
     retention per policy (document PDFs ≥ document retention; report artifacts 30 days
     default; period-close packs permanent); reprint uses posting-time template version
     where the pack requires it.
10. **Golden dataset CI suite** per
    [../../reporting/REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md)
    §3–§4: fixture journal sets (opening balances, sales+VAT+receipt cycles, FX,
    reversals/credit notes, close + year-end, multi-branch) with hand-verified **full
    result envelopes**; TB/GL/IS/BS/CF/aging/VAT run against every dataset; property
    tests with randomized balanced entries asserting BS balances, IS net = BS
    current-year line, CF ties; **as-of reproducibility tests** (post later-dated
    entries + later-created pre-dated reversals → re-run byte-identical) and cache
    invalidation correctness; export identity across regenerations.
11. **UI** per [../../ui/PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) §7 (Report
    Page archetype) + §6 approval-style run list: report workspace (FilterBar with
    declarative parameters + saved views, ReportViewer with group tree, subtotals,
    check-totals with lock glyph, assertion footer, freshness "كما في … / as of …",
    drill links, export menu), run-history/polling states, print preview (screen preview
    = paper), command-menu integration.
12. **Dashboard widget seam (for PHASE-014):** the binding contract only — widgets
    (`KPIStatCard`/`ChartCard`) bind to report contracts in `current` mode with pinned
    parameters; clicking opens the underlying report. **No dashboards ship in this
    phase** (`reporting.dashboards` is PHASE-014 per
    [../../reporting/REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) §12).

Out of scope (explicit):

- Dashboards/KPI screens themselves (PHASE-014) — only the widget-to-contract binding
  seam.
- Scheduled reports + email delivery (post-MVP seam documented in
  [../../reporting/PRINTING_AND_EXPORT.md](../../reporting/PRINTING_AND_EXPORT.md) §7;
  `reporting.scheduled_reports` is PHASE-025).
- Industry-namespaced reports (PHASE-015+), commissions reports (PHASE-017),
  e-invoicing log (PHASE-023).
- Direct-method cash flow (post-MVP enhancement — the indirect limitation is documented,
  not "fixed").
- Any report logic outside the contract registry — no per-screen bespoke queries, no raw
  cross-module SQL, no client-side aggregation of unscoped data
  ([../../reporting/REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md) §5).
- New business-data tables: the reporting module owns only `report_runs` and
  `print_templates`.

## 3. Prerequisites

- Required phases: **PHASE-012** COMPLETE — statements/reports reconcile against real
  transactional data from every trade module
  ([../../planning/PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md)
  edge 012→013); module query services must exist and be permission-guarded
  (`glQueries.*`, `statementQueries.*`, `arQueries.*`, `apQueries.*`,
  `salesAnalytics.*`, `valuationQueries.*`, `stockQueries.*`, `expenseQueries.*`,
  `returnQueries.*`, `auditQueries.*`, `userQueries.*`). Transitive: PHASE-002 (pg-boss,
  files module + signed URLs), PHASE-005 (design system print CSS), PHASE-007 (journal
  data + periods), PHASE-008/009/010/011/012 (data domains).
- Required architecture decisions:
  [ADR-0011](../../architecture/ADR/ADR-0011-reporting-printing.md) (contract registry,
  Chromium PDF, exceljs, values-only workbooks — binding),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (pg-boss execution),
  [ADR-0016](../../architecture/ADR/ADR-0016-ui-tailwind-radix.md) (shared print CSS),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (decimal-string money
  in envelopes).
- Relevant documentation:
  [../../reporting/REPORTING_ARCHITECTURE.md](../../reporting/REPORTING_ARCHITECTURE.md)
  (module design — binding),
  [../../reporting/REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md) (schema +
  result envelope + worked TB/Sales-by-item examples),
  [../../reporting/REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (registry rows
  + provenance + readiness matrix),
  [../../reporting/FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md)
  (derivation math + §11 assertion set),
  [../../reporting/REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md)
  (assertions + golden datasets + as-of tests),
  [../../reporting/PRINTING_AND_EXPORT.md](../../reporting/PRINTING_AND_EXPORT.md)
  (templates, render contract, XLSX/CSV rules, artifact policy),
  [../../accounting/RECONCILIATION.md](../../accounting/RECONCILIATION.md),
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.8,
  [../../testing/PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md)
  (T-04 report tiers).

## 4. Design Impact

- **Database changes:** only `report_runs` (tenant_id, report_key, contract_version,
  params jsonb/params_hash, status, stage, requested_by, duration, assertion results,
  artifact refs) and `print_templates` (key, locale variants, version) per
  [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §reporting —
  both RLS + registry + A-tests. **No business tables** — the reporting module owns
  zero business data (binding principle).
- **API changes:** `GET /api/v1/reporting/reports` (registry snapshot for navigation);
  `POST /api/v1/reporting/report-runs` (execute — inline returns the envelope, heavy
  returns a run id); `GET /report-runs/{id}` (status/stage polling);
  `GET /report-runs/{id}/result` (envelope); `POST /report-runs/{id}/exports` +
  `GET …/artifacts/{format}` (signed URL issuance via files module);
  `POST /api/v1/reporting/print/{documentType}/{id}` (document PDF via `a4-document`
  template — the endpoint the chain screens' print buttons call);
  `GET /reporting/print-preview/…` (preview HTML for the viewer). Errors typed per
  [../../api/ERROR_MODEL.md](../../api/ERROR_MODEL.md) incl.
  `FORBIDDEN_AT_RUN`, `ASSERTION_FAILED`, `FEATURE_NOT_ENTITLED`.
- **UI changes:** report workspace archetype screens; `ReportViewer`,
  `FilterBar` (saved views), `DataTable` read-only rendering of envelopes, run-history
  list with status polling, print preview modal, export menu; drill links as real deep
  URLs preserving filters; assertion footer with check ids; freshness badges — all per
  [../../ui/COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) §6.5 and
  [../../ui/PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) §7.
- **Security & authorization:** seed `reporting.reports.run`, `reporting.reports.export`,
  `reporting.templates.manage` (matrix §3.8) **and add the granular `reports.*.read`
  permission keys** declared by REPORT_CATALOG §12 (`reports.financial.tb.read`,
  `reports.financial.gl.read`, `reports.financial.is.read`, `reports.financial.bs.read`,
  `reports.financial.cf.read`, `reports.financial.close.read`,
  `reports.sales.by-item.read`, … `reports.ar.aging.read`,
  `reports.purchasing.matching.read`, `reports.tax.vat-return.read`, …) to the
  permission seeds + AUTHORIZATION_MATRIX update in the same phase (catalog rule: every
  permission must exist in the role matrix before the report's phase completes); export
  actions audited; drill-link generation checks target permissions.
- **Accounting implications:** no new posting rules; this phase is the verification
  surface for INV-001/002 (TB assertions), INV-008 (posted-rates presentation),
  INV-009/010/012/019 (subledger/stock/tax/cash ties displayed as footer badges),
  INV-003/014 (drill chain completeness, reversals visible); statement derivation is
  exclusive to posted journal lines ([../../accounting/ACCOUNTING_PRINCIPLES.md](../../accounting/ACCOUNTING_PRINCIPLES.md)
  §3 — never document tables, never cached balances as source).
- **Localization implications:** every contract carries bilingual titles/labels/
  assertion messages (locale parity is a catalog consistency rule); exports follow the
  run locale (RTL sheet views, RTL PDF, bottom-start page numbers as the sanctioned
  physical exception); numerals Western at MVP; Hijri/Gregorian parameter pickers.
- **Offline implications:** none — reports are online-only; export artifacts are
  downloadable files (portal/mobile consumption is read-only web).
- **Module dependencies:** `reporting` depends on the **published query services** of
  `accounting`, `sales`, `purchasing`, `inventory`, `treasury`, `tax`, `partners`,
  `audit`, `identity`, `tenancy` + `files` (artifacts) + jobs infrastructure; it depends
  on **no module's tables** and nothing depends on reporting except the UI; posting
  events flow in for cache invalidation
  ([../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migrations: `report_runs` + `print_templates` + RLS + registry | `apps/api/migrations/NNNN_reporting_core.sql` | fresh + regression apply; RLS check |
| T2 | Contract registry runtime: zod boot validation, unique id/version, registry snapshot endpoint | `apps/api/src/modules/reporting/registry/**` | malformed-contract fixture fails startup (meta-test); snapshot serves navigation |
| T3 | Executor: inline path + envelope builder (decimal-string money, groups, totals, drill links) | `apps/api/src/modules/reporting/application/executor.ts` | envelope shape tests vs REPORT_CONTRACT §2 worked examples |
| T4 | Job path: pg-boss run lifecycle, permission re-resolution, `(report_id, params_hash)` idempotency, progress stages | `apps/api/src/modules/reporting/application/run-service.ts` | TOCTOU test (revoke mid-queue → `FORBIDDEN_AT_RUN`, no partial artifacts); retry/idempotency tests |
| T5 | Permission/scope gate: contract-level check + grant intersection + drill-link permission filtering | `apps/api/src/modules/reporting/application/scope.ts` | branch-scoped user cannot widen scope; disabled-drill-link behavior test |
| T6 | Accounting statement query services: TB, GL, IS (contra aggregation), BS (RE composition), CF indirect | `apps/api/src/modules/accounting/application/statement-queries.ts` | golden envelopes per FINANCIAL_REPORT_RULES §2–§5 |
| T7 | Assertion engine: executable checks (§11 set), exact-decimal compare, `ASSERTION_FAILED` + block-export flag | `apps/api/src/modules/reporting/application/assertions.ts` | seeded-balance corruption → FAIL + export blocked server-side |
| T8 | Financial contracts registration: TB, GL, IS, BS, CF, fiscal-close-pack (as-of, comparatives, zero suppression) | `apps/api/src/modules/reporting/registry/financial/**` | golden dataset suite: byte-identical re-runs (RC-10 discipline) |
| T9 | Operational contracts registration: inventory, sales, purchasing, AR/AP, treasury, VAT v2, platform | `apps/api/src/modules/reporting/registry/{inventory,sales,purchasing,ar-ap,treasury,tax,platform}/**` | per-contract provenance boot checks; ledger-tie assertions green on golden data |
| T10 | Cache layer: as-of-keyed entries, invalidation event wiring, freshness stamps | `apps/api/src/modules/reporting/application/cache.ts` | invalidation on `invoice.posted`/`period.locked` fixtures; ≤60 s current TTL |
| T11 | Print templates: 4 base templates (RTL rules), versioned; print preview parity | `packages/ui/print/**` | visual snapshots AR+EN per template; `<thead>` repetition + page-break rules verified in PDF |
| T12 | Chromium render worker: pool, timeouts, PDF/A-2b class, no-network contract | `apps/api/src/modules/reporting/application/render/**`, worker image | render contract tests (timeout, pool bounds); PDF/A flag on close pack |
| T13 | Exports: exceljs XLSX (RTL views, values-only, typed cols) + CSV BOM + artifact storage via files + signed URLs + audit | `apps/api/src/modules/reporting/application/export/**` | XLSX open-and-verify fixtures (RTL view, text IDs); CSV BOM byte check; download audit row |
| T14 | Golden dataset CI suite + property tests + as-of reproducibility + export identity | `apps/api/src/modules/reporting/testing/golden/**` | full suite green in CI; property identities across scopes |
| T15 | UI: report workspace, run history, print preview, command-menu integration, saved views | `apps/web/app/{locale}/reporting/**` | Playwright bilingual E2E: run TB → drill account → journal → document; assertion-banner state; visual snapshots |
| T16 | Permission seeds + AUTHORIZATION_MATRIX/report catalog sync + docs updates | `apps/api/seeds/**`, `docs/security/**`, `docs/reporting/**` | seed-vs-matrix drift check; docs validation green |

## 6. Verification

**Automated tests (required):**

- **Registry meta-tests:** malformed contract (missing dataSources / non-existent
  permission / forbidden raw SQL marker) fails boot; duplicate id or version regression
  fails; readiness cross-check (contract dataSources vs module phase) enforced.
- **Golden dataset suite** ([../../reporting/REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md)
  §3): TB, GL, IS, BS, CF, aging, VAT return against every fixture set — full result
  envelopes compared (columns/rows/totals/assertions); zero-suppression, rounding, and
  comparative modes have dedicated cases; year-end closing entry case (PC-05 numbers
  flow into BS RE composition).
- **Assertion tests (success + failure):** every §11 financial assertion passes on
  golden data; seeded corruption (unbalanced fixture, subledger drift, cash tie break)
  → `ASSERTION_FAILED` stored, banner flag set, **export/print endpoints return the
  block** (server-side, tested at API level, not just UI); assertion results persist
  with compared values.
- **As-of reproducibility (§4):** run at `asOf = T`; post entries dated after T +
  create reversals dated before T afterwards; re-run → **byte-identical envelope**;
  cache invalidation when a period reopen inserts into a cached as-of window (INV-020
  fixture).
- **Property tests:** randomized balanced journal sets → BS balances; IS net = BS
  current-year result line; CF ties to Δ cash across many scopes/periods.
- **Execution-path tests:** heavy contract enqueues and polls to success; worker crash
  → retry → failure path with correlation id; `(report_id, params_hash)` re-run replaces
  artifacts (no duplicates); permission revoked mid-queue → `FORBIDDEN_AT_RUN` with zero
  partial artifacts.
- **Permission/scope tests:** branch-scoped user + `all-branches` request → intersection
  applied; `reports.*.read` keys enforced per contract; export permission separate from
  run permission; platform reports admin-only.
- **Export correctness:** XLSX — RTL `views.rightToLeft` when locale=ar, identifiers
  text-typed (leading zeros preserved), no formulas (workbook inspected), footer block
  present; CSV — BOM bytes, ISO dates, decimal strings; PDF — template version stamped,
  repeated headers on multi-page, fonts embedded; signed-URL expiry + download audit
  row; retention flags (period-close pack permanent).
- **Tenant isolation:** A-tests on `report_runs`/`print_templates`; export signed-URL
  scope tests (F-series per
  [../../testing/TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) §6)
  — cross-tenant run id → 404, artifact URL tenant-bound.
- **Performance:** T-04 tiers — interactive reports p95 < 2 s; TB/IS/BS monthly at
  100k-doc tenant p95 < 10 s; >50k-row XLSX async ≤ 15 min p95; inline path p50 < 500 ms.

**Manual verification:**

1. Run the Trial Balance as-of a past period in AR and EN; export PDF, XLSX, CSV;
   confirm identical numbers across screen and all three artifacts.
2. Drill: BS receivable line → GL → journal entry → the source sales invoice document;
   then reverse-hint shows the credit note pair where one exists.
3. Seed a drift (test tooling) and open the tied report: observe the failure banner and
   attempt an export — the server refuses (bilingual message).
4. Print a sales invoice via `a4-document` in Arabic: check RTL mirroring, physical
   bottom-start page numbers, bilingual legal footer from the jurisdiction pack, and
   that screen preview matches the PDF page-for-page.
5. Open a heavy report (consolidated sales by item across branches): watch QUEUED →
   RUNNING (stage) → result; re-run it and confirm artifacts replace, not duplicate.

**Acceptance criteria (objective):**

1. Registry validates all registered contracts at boot; every registered report has
   provenance (module + service + tables), an existing `reports.*.read` or module read
   permission, and phase-ready data sources (catalog §14 checklist enforced).
2. TB/GL/IS/BS/CF implement FINANCIAL_REPORT_RULES exactly: contra aggregation, RE
   composition counted once, indirect CF with displayed limitation, comparatives
   re-derived, as-of byte-identical re-runs.
3. All §11 financial assertions + operational ledger-tie assertions execute per run,
   persist results, and block export/print server-side on FAIL.
4. The drill chain statement → account → journal → source document is complete for
   every golden fixture (no orphan lines) with per-hop permissions.
5. Golden dataset suite + property tests + as-of reproducibility suite green in CI; any
   derivation-rule change visibly updates a golden file.
6. 4 print templates versioned and RTL-correct (visual baselines AR+EN); Chromium
   worker renders within contract (timeouts, pool bounds, PDF/A-2b for close packs).
7. XLSX/CSV exports follow PRINTING_AND_EXPORT rules (RTL views, values-only, BOM,
   decimal strings); artifacts stored via files module with signed URLs, audited
   downloads, and retention flags.
8. AR/AP aging + statements refresh to live data through contracts (the PHASE-011/012
   screens' data paths now served by the same query services).
9. `reports.*.read` permission keys exist in seeds and the role matrix (updated in-phase).
10. T-04 performance tiers met on the seeded 100k-document tenant.
11. Acceptance rows mirrored in
    [../../planning/PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
    (PHASE-013 row) once that file lands.

**Performance & security considerations:** report work never runs on the interactive
posting path — heavy renders isolated to workers (RISK-013); queue smooths Chromium pool
saturation; inline path budget p50 < 500 ms; no stale financial data (invalidation
wiring); exports are read-only evidence of stored envelopes. Security: no user-supplied
HTML into the renderer; no network fetch during render; signed URLs short-lived; every
download audited; permission re-resolution at execution; contract-level scope
intersection.

**Migration & rollback:** two new tables only (expand-only). Dev rollback = revert +
drop; production forward-only per
[../../database/MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md). Report
runs/artifacts are regenerable — rollback must not corrupt source data (it cannot: no
business tables touched).

## 7. Risks and Constraints

- RISK-013 (Chromium-in-worker operational burden): worker isolation, bounded pool,
  queue smoothing, render budgets — the render contract is the control surface;
  escalate via the O-2 dedicated-worker option only with a decision record.
- RISK-009: assertion failures are Sev-1 visible — the block-export behavior plus
  accountant notification is mandatory, not optional polish.
- RISK-014: statement queries at 100k+ documents — EXPLAIN-reviewed queries, as-of
  caching, T-04 gates; the golden tenant doubles as the perf fixture.
- RISK-015 (Arabic shaping/RTL): Chromium choice (ADR-0011) + visual snapshots both
  locales + PDF inspection tests (page numbers, thead repetition).
- RISK-016: reporting must never query business tables directly — only declared module
  services; the provenance boot-check + boundary lint enforce it.
- RISK-020: REPORT_CATALOG rows ↔ registry must stay 1:1 — a docs-sync CI note is part
  of the exit gate.
- Constraint: statements derive **exclusively from posted journal lines** — no document-
  table shortcuts, no cached balances as source (INV-003 immutability makes this safe).
- Constraint: dashboards ship in PHASE-014; this phase delivers only the widget-binding
  seam — no KPI screens sneak in early.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-013-COMPLETION.md` with: golden suite
  output (every dataset × every statement), assertion failure/block-export proof, as-of
  reproducibility outputs, export artifact samples (XLSX RTL view screenshot +
  CSV BOM hex, PDF metadata), T-04 latency table, isolation/signed-URL test outputs,
  registry boot-check log.
- **Documentation updates required:** REPORT_CATALOG §13/§16 status sync (registered
  rows marked delivered), AUTHORIZATION_MATRIX + seeds (`reports.*.read` keys),
  ENTITY_CATALOG §reporting sync, IMPLEMENTATION_STATUS (PHASE-013 → COMPLETE),
  CHANGELOG; golden-dataset addition rule noted for all future financial-report changes.
- **Exit criteria:** all acceptance criteria green with evidence; golden + property +
  isolation suites green in CI; docs validation green; `reports.*.read` keys in the
  matrix; zero TODOs.
- **Definition of Done:** `main` contains the reporting module with the full PHASE-013
  catalog registered, assertions blocking exports, 4 templates with AR+EN visual
  baselines, exports audited via signed URLs, and the dashboard widget seam documented
  for PHASE-014.
- **Handoff instructions:** next agent reads the PHASE-013 completion report and the
  widget-binding seam (REPORT_CATALOG §14) — PHASE-014 builds dashboards on it and the
  MVP gate. **Next eligible phase: PHASE-014 — Subscription, Billing, Onboarding &
  Dashboards (MVP)** (identify only; do not implement).
