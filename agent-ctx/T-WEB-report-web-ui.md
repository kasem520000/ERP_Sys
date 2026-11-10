# T-WEB — PHASE-013 Reports workspace web UI

**Task ID:** T-WEB (PHASE-013 / reporting — the report workspace, report archetype §7)
**Status:** COMPLETE — every mandated gate green (web build+typecheck+lint, i18n parity, @erp/ui
nav test, contracts typecheck/lint, permissions-drift, dependency-cruiser).
**Scope:** `apps/web` + `packages/contracts` only. `apps/api` untouched (frozen; the reporting
API surface was already delivered). Previous agents' records in this directory:
`T14-UI-treasury-web-ui.md`, `T15-gate-evidence-PHASE-010.md`, `T16…`, `T17…`.

## Files created / changed

| File | Change |
| --- | --- |
| `apps/web/app/[locale]/reports/page.tsx` | **NEW** server page — locale guard → `notFound()`, `requireSessionToken`, `Promise.all` fetch of `reporting/reports` + `reporting/report-runs?limit=20` + `identity/sessions/current` via `fetchApi` (envelope-unwrapped), 401 → login redirect, 403/FORBIDDEN → honest `ErrorState` (no retry), else `<ReportWorkspace>`; `AppShell pagePath="reports" title=d.reportWorkspaceTitle`. Same recipe as `sales/ar` + `reports/vat-return`. NOTE: page sits one level shallower than vat-return → relative imports are `../../../` (3 up), not 4. |
| `apps/web/components/report-workspace.tsx` | **NEW** `"use client"` workspace (see below). |
| `apps/web/lib/api-types.ts` | +13 wire types: `ReportRegistryItem`, `ReportBilingual`, `ReportResultColumn/Group/Row/Total`, `ReportDrillLink`, `ReportAssertion`, `ReportResultEnvelope`, `ReportRunOutcome`, `ReportRunSummary`, `ReportRunStatus`, `ReportExportResult`, `ReportPrintPreview` — mirroring `apps/api/src/modules/reporting/application/contract.ts` + controller row shapes. |
| `apps/web/i18n/dictionaries.ts` | +40 keys appended at the END of the `Dictionary` interface, the `ar` literal and the `en` literal (navReports, reportsNavWorkspace, reportWorkspace* family incl. ColReport + NoRuns). Parity 1505/1505. |
| `packages/contracts/src/navigation.ts` | +1 `NAV_ITEMS` entry `{id:"reports.workspace", parentGroup:"reports", label:{ar:"تقارير المنشأة",en:"Reports"}, icon:"bar-chart", route:"/reports", permission:"reporting.reports.run", branchScoped:false, archetype:"report", order:5}` — placed before `reports.vat_return` (order 10); `featureKey` omitted per the file's convention for core items (≡ `featureKey: undefined`). |
| `apps/web/components/app-shell.tsx` | +1 `FALLBACK_CRUMBS` entry `reports: { group: "navReports", label: "reportsNavWorkspace" }` (registry-driven when navigation resolves; fallback covers nav-fetch failure). |

## The workspace component (report-workspace.tsx)

- **Catalog** — left column on `lg` (`grid-cols-[16rem_minmax(0,1fr)]`), top on mobile;
  `max-h-96 overflow-y-auto`; grouped by `category` (raw category as a mono LTR label —
  stable vocabulary, like `sourceType` elsewhere); bilingual titles (active + other locale);
  filtered client-side to `requiredPermission ∈ session.permissions`.
- **Parameter bar** — minimal declarative set: `dateFrom`/`dateTo` DatePickers (current-month
  defaults, `min` chaining), `asOf` DatePicker only when `semantics === "as-of"`, and the
  per-run report-locale Select (ar/en, defaults to page locale). accountId/branchIds stay
  hidden (never sent). Run button disabled until the window validates.
- **Saved views** — localStorage `erp-report-views`: `{id, label:{ar,en}, reportKey,
  params:{dateFrom,dateTo,asOf?,locale}}`; bilingual label via two Inputs (one filled →
  mirrors into the other slot); list + Apply + Delete; untrusted rows narrowed via
  `isSavedView` (`isRecord` chain); storage failures degrade silently to the in-memory list.
- **Run + poll** — `POST reporting/report-runs {reportKey, params}`; inline `result` renders
  immediately; queued outcome polls `GET report-runs/{id}` every 2s up to 60s with an
  `aria-live` stage line (QUEUED/RUNNING · stage), then loads `GET report-runs/{id}/result`.
  FAILED surfaces `reportWorkspaceStatusFailed (+ errorCode)`; poll misses retry until the
  deadline. History refreshes after every terminal transition.
- **Result** — group header rows (`groupKey` → envelope group label, `scope="rowgroup"`
  colSpan), read-only table with `max-h-[70vh] overflow-auto` + sticky thead; numeric columns
  `text-end` + `font-mono tabular-nums` LTR runs; null → "—"; drill links rendered as anchors
  in a trailing column (only when any row carries them); totals in tfoot (`kind:"check"` gets
  the 🔒 prefix, `aria-hidden`); notes as InfoNotices; freshness line `كما في {asOf} · وقت
  الاحتساب {computedAt}` (asOf segment omitted when absent) + mono runId.
- **Assertions** — footer chips (id · PASS/FAIL, success/danger tones); any FAIL renders the
  DANGER banner listing failed ids and disables ALL export buttons (server blocks them anyway
  with 403/422 ASSERTION_FAILED). Print preview stays enabled on FAIL (the API's
  print-preview route only needs `reporting.reports.run` — only exports are assertion-gated).
- **Exports** — per-format buttons from the registry row's `exportFormats` (PDF/XLSX/CSV
  labels), `disabled={!canExport || assertionsFailed}`; `POST …/exports {format}` →
  `window.open(url)` + `exportExpiresNote` notice; `ASSERTION_FAILED` → local bilingual
  message, `PARAMS_INVALID`/`CONTRACT_VERSION_MISMATCH` → `errorsValidation`, else
  `localizedApiError`.
- **Run history** — full-width DataTable below (reportKey mono, status chip, assertion chip,
  `durationMs` numeric, createdAt mono; `commonOpen` row action loads a SUCCEEDED row's
  stored result — also selects its reportKey in the catalog) + Refresh button.
- **Print preview** — Dialog (`size="lg"`) with `<iframe srcDoc={html}>` from
  `GET reporting/print-preview/{id}`; null payload → the empty-state string.
- **RTL** — logical utilities only (`ms-/me-/text-start/text-end`), verified against the
  erp-ui `no-physical-direction` rule.

## Verification (all green)

- `pnpm --filter @erp/web build` — exit 0; route `ƒ /[locale]/reports` emitted.
- `pnpm --filter @erp/web typecheck` / `lint` — clean.
- `pnpm check:i18n-parity` — `ar=1505 keys, en=1505 keys`, no empty values.
- `pnpm --filter @erp/ui test` — 42/42; the navigation behavior test needed NO changes (it
  asserts the entitled GROUP list, and adding an item under the existing `reports` group
  leaves the expected output intact — verified by run, not assumed).
- `pnpm --filter @erp/contracts typecheck` / `lint` — clean.
- `pnpm check:permissions-drift` — OK (224/224; `reporting.reports.run`/`.export` are seeded
  matrix keys — migrations 0004/0005).
- `pnpm lint:depcruise` — no violations (1291 modules).

## Deviations / notes for the next agent

1. **Date params use the catalog `DatePicker`**, not raw `<input type="date">` — the
   established date input in this codebase (vat-return, sales-ar) and locale-aware
   (Saturday-first AR grid). The task's "text inputs type=date" is satisfied in spirit.
2. **40 i18n keys, not ~25** — the spec's own bullet list (status vocabulary SUCCEEDED/FAILED,
   stage, catalog column label, view-name inputs, empty-history state) required the extras.
   All keys are used; parity enforced at 1505.
3. **Generic parameter bar limitation (by spec)** — the minimal `{dateFrom, dateTo, asOf?,
   locale}` body passes every contract that needs only date params (zod strips undeclared
   keys per contract; windowed and as-of shapes both validate). Contracts with extra REQUIRED
   ids (`partner.statement`/`supplier.statement` need `partnerId`, `financial.general-ledger`
   needs `accountId`) return `PARAMS_INVALID`, surfaced bilingually as `errorsValidation`.
   The registry snapshot carries no parameter-schema metadata, so the generic bar cannot
   satisfy them — dedicated surfaces (or snapshot parameter metadata) are future work.
4. **`selected === null` + result present** — opening a history row whose reportKey is no
   longer in the user's permitted catalog still renders the stored result (the API allows
   result reads with `reporting.reports.run`; the run itself was permission-checked at
   execution). The result card renders independently of the parameter card for this reason.
5. Polling is a plain `sleep` loop (2s × ≤60s) inside the click handler — no timer
   infrastructure; safe against overlapping runs because the Run button is `loading`-disabled
   for the whole poll.
