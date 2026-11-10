# P28-D — PHASE-028 Task D (web UI) — Budgeting screens + PeriodGrid pattern

**Task ID:** P28-D · **Agent:** P28-D (budgeting web: 5 pages + 4 client components + PeriodGrid + nav/registry/i18n wiring)
**Status:** COMPLETE — all five Definition-of-Done gates green (evidence tails below).

## Scope (PHASE-028 T9; the P28-D brief)

`packages/contracts` NAV_ITEMS row `accounting.budgets`, `packages/ui`
`PeriodGrid` pattern (+ stories + index re-export), `apps/web` api-types wire
rows, `localizedBudgetStatus/Scope/Error` helpers, ONE PHASE-028 dictionary
block (AR authored first, exact runtime parity — 115 keys × 3 blocks), the
app-shell FALLBACK_CRUMBS + dynamic `budgeting/[id]` rule, 5 server pages +
4 client components under `apps/web/app/[locale]/budgeting/**`. **No backend
changes** (`apps/api` untouched — the budgeting module from P28-A/B/C stands
as-is; `git status` shows only the parallel tasks' pre-existing api edits).

## Files created

### Server pages (the notes-page pattern verbatim: doc comment → isLocale/notFound → getDictionary → requireSessionToken → fetchApi with 401→login / 403→ErrorState(no retry) / 404→notFound / supporting reads degrade to [] → AppShell + client component)

| File | Fetches |
| --- | --- |
| `apps/web/app/[locale]/budgeting/page.tsx` (76 L) | primary `budgeting/budgets` (NO limit param — the route has none; never a fabricated server param) + `accounting/fiscal-years` (year-name resolution, degrades to []). |
| `apps/web/app/[locale]/budgeting/new/page.tsx` (63 L) | `accounting/fiscal-years` (the same route accounting/periods + opening-balances use). |
| `apps/web/app/[locale]/budgeting/[id]/page.tsx` (132 L) | primary `budgeting/budgets/:id` (404→notFound) + `budgeting/budgets/:id/grid`; supporting `accounting/fiscal-years`, `accounting/accounts?limit=500`, `accounting/cost-centers`, `accounting/projects`, `tenancy/branches` (all degrade to []) + the successor pool `budgeting/budgets?fiscalYearId&scope` (same (year, scope) — revisions supersede within it). |
| `apps/web/app/[locale]/budgeting/import/page.tsx` (77 L) | `budgeting/budgets?status=DRAFT` + the UUID-validated `?budgetId=` deep link (the workspace's "import grid" preselect). |
| `apps/web/app/[locale]/budgeting/reports/page.tsx` (103 L) | the notes/reports clone with `REPORT_KEY_PREFIX = "budgeting."`: registry filter + run-history filter + `ReportWorkspace` (registry/initialRuns/permissions/canExport/reportKeyPrefix — the exact prop set the notes page passes); empty → honest InfoNotice. |

### Client components ("use client"; @erp/ui public imports only — Badge, Button, DataTable, Select, PeriodGrid, formatMoneyDisplay, useToast; locale prop + getDictionary; bffFetch; ErrorNotice/InfoNotice/SuccessNotice; exact-money folds)

| File | Screen surface |
| --- | --- |
| `components/budgets-table.tsx` (293 L) | register list: status/scope/fiscal-year filters (server refetch — the API's own vocabulary), free-text search client-side (no search param — honest degrade), code-link/name/year/scope/r{n}/lines/year-total/status columns, rowActions open; rail links new/import/reports. |
| `components/budget-form.tsx` (144 L) | create DRAFT: fiscal year + scope select + name/nameAr/note/noteAr → POST `budgeting/budgets` → toast + router.push to the workspace. |
| `components/budget-workspace.tsx` (703 L) | header DefList (code/name/year/scope/revision/lineCount/yearTotal/createdAt/supersedes/supersededBy) + BR-050 lifecycle bar (DRAFT→submit; PENDING_APPROVAL unstamped→approve, stamped(approvedAt)→activate; ACTIVE→supersede+close (+hint); REVISED→close) · DRAFT-only grid editor: add-line (postable-account select + the scope's dimension select), PeriodGrid onCellChange/onRemoveRow, PUT `:id/grid` whole-grid replace (empty cells carry no line; all-empty rows pruned post-save) · export card (GET `:id/export?locale=ar|en` → base64 Blob → anchor download) · consumption card (GET `:id/consumption` on mount + after every move: computedAt + stale chip, per-period budget/actual/variance chips ONLY when Σactual > 0, over-budget warning tone, the advisory note "الرقابة استشارية — لن يُمنع أي ترحيل") · version-chain card (predecessor chain + successors, code links + status badges). |
| `components/budget-import-wizard.tsx` (317 L) | 2-step wizard: setup (DRAFT budget select + .xlsx file input → FileReader base64, 15 MB client cap) → dry-run POST `:id/import/dry-run` (rowCount/validRows/totalsPreview DefList + bilingual per-row error table — locale picks messageAr/messageEn; clean → SuccessNotice) → commit POST `:id/import/commit` (disabled while errors exist) → done card with open-budget push; rowCap note surfaces the 5,000-row bound. |

### packages/ui

| File | Notes |
| --- | --- |
| `packages/ui/src/patterns/period-grid.tsx` (368 L) | PeriodGrid pattern: sticky inline-start dimension column, per-period money inputs (dir=ltr isolate, tabular-nums, sanitizeMoneyInput @4dp, non-negative), keyboard grid navigation (Enter/↓ next row, ↑ prev row, ←/→ hop columns at the caret edge — mirrored under locale=ar so arrows follow the VISUAL direction), live row-total column (addExact fold), caller-owned totals footer + computed year cell, optional trailing remove-row column (journal-grid precedent), role=grid/row/gridcell + per-cell aria-labels, `dir="rtl"` wrapper under ar (the grid owns its direction — its column order is semantic). |
| `packages/ui/src/patterns/period-grid.stories.tsx` (115 L) | AR+EN visual-baseline stories (timeline-panel precedent): EditableArabic (live totals via addExact — no float math), ReadOnlyEnglish, Empty. |
| `packages/ui/src/index.ts` | PeriodGrid + 5 types re-exported (the TimelinePanel export block precedent). |

## Files modified

| File | Change |
| --- | --- |
| `packages/contracts/src/navigation.ts` (+18 L) | NAV_ITEMS row `accounting.budgets` — parentGroup accounting, icon "bar-chart", route /budgeting, featureKey `budgeting.budgets`, permission `budgeting.budgets.view`, archetype list-search, **order 80** (after fixed-assets' 70). |
| `apps/web/components/app-shell.tsx` (+20 L) | FALLBACK_CRUMBS `budgeting` / `budgeting/new` / `budgeting/import` / `budgeting/reports` (navAccounting group) + the dynamic `budgeting/[id]` rule (the notes/[id] shape). |
| `apps/web/lib/api-types.ts` (+137 L) | PHASE-028 wire block: BudgetListRow, BudgetDetailRow, FiscalPeriodView, GridAccountView, BudgetLineView, BudgetGridTotals, BudgetGridResponse, BudgetGridSaveResult, ConsumptionKeyRowView, ConsumptionResponse, ImportDryRunResponse, ExportResponse, ControlEvaluationResult. |
| `apps/web/lib/messages.ts` (+72 L) | `localizedBudgetStatus` / `localizedBudgetScope` / `localizedBudgetsError` (the module's 14-code failure pack → not-found family, BR-050 state/SoD/immutable/active-exists, BR-051 exceeded, import format/row-limit/row). |
| `apps/web/i18n/dictionaries.ts` (+405 L) | ONE PHASE-028 block: 115 keys × interface/ar/en — nav, register, statuses/scopes, columns, form, grid workspace, lifecycle, consumption, import wizard, export, reports, chain, 13-key error pack. |

## API routes consumed (all under /api/v1 via bffFetch/fetchApi)

`GET budgeting/budgets[?fiscalYearId&scope&status]` · `POST budgeting/budgets`
· `GET budgeting/budgets/:id` · `GET/PUT budgeting/budgets/:id/grid` ·
`GET budgeting/budgets/:id/consumption` · `GET budgeting/budgets/:id/export?locale`
· `POST …/submit|approve|activate|supersede|close` · `POST …/import/dry-run|commit`.
Reference pools: `accounting/fiscal-years`, `accounting/accounts?limit=500`,
`accounting/cost-centers`, `accounting/projects`, `tenancy/branches` — all
routes the existing accounting/fixed-assets pages already use (no missing
route; no fallback needed).

## Deviations from the P28-D brief (small, justified)

1. **BudgetListRow gained `approvedAt: string | null`** beyond the brief's
   field list — the real API row carries it and the workspace needs it to
   gate the Activate button honestly (PENDING_APPROVAL + stamp); the brief's
   own detail keys (supersedes/supersededBy) had no other honest source for
   the two-step gate.
2. **PeriodGrid gained an optional `onRemoveRow` + `labels.removeRow`** (+
   trailing × column, journal-entry-grid precedent) — the brief's prop list
   had no remove affordance while the whole-grid replace makes row removal a
   real workspace need.
3. **The brief's `budgetGridWorkspaceTitle` is shipped as `budgetGridTitle`**
   (same meaning, module-consistent naming); the reports keys use
   `budgetReportsTitle` / `budgetReportVsActual` / `budgetReportVarianceAnalysis`.
4. **Budget tabs strip omitted** — the brief names exactly 4 client
   components + 5 pages (no tabs component); the register's rail links
   (new/import/reports) cover the sibling-surface navigation the notes tabs
   provide.

## Verification (Definition of Done — all green)

```
cd /home/z/erp/apps/web && pnpm exec tsc --noEmit -p tsconfig.json   # exit 0
cd /home/z/erp/apps/web && pnpm test                                   # 5 files, 73 tests passed
cd /home/z/erp && pnpm --filter @erp/contracts exec tsc --noEmit       # exit 0
cd /home/z/erp && pnpm check:i18n-parity                               # ar=3914 keys, en=3914 keys; 100% parity; no empty values
cd /home/z/erp && pnpm --filter @erp/ui exec tsc --noEmit              # exit 0
```

Extra (not required, guarded anyway): `pnpm --filter @erp/contracts test`
(50 passed), `pnpm --filter @erp/ui test` (42 passed — the NAV_ITEMS-driven
navigation-resolution specs stay green with the new row), eslint clean on
every touched file. `apps/api` untouched (Do NOT run the API DB suite —
respected).
