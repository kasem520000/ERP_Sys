# T14-UI — PHASE-008 Treasury web UI + UI package pattern

**Task ID:** T14-UI (PHASE-008 / Treasury)
**Status:** COMPLETE — every mandated gate green (web typecheck/lint/build, ui typecheck/lint/test, i18n parity, ui catalog).
**Scope:** `apps/web` + `packages/ui` + `packages/contracts` only. `apps/api` untouched (frozen & green).

## Context for the next agent

The bulk of this UI was already staged in the working tree when this agent picked the
task up (uncommitted: pages, components, ShiftPanel, stories, dictionary sections,
nav items, error mapper, wire types). This agent **audited every deliverable against
the task spec**, fixed the gaps found (below), re-ran the full verification matrix,
and wrote this record. Previous agents' record in this directory: `P5-T12-app-ui-migration.md`.

## Deliverables (all verified present + correct)

### Pages — `apps/web/app/[locale]/treasury/…` (11 routes, all in the build output)

| Route | Archetype | Server data (fetchApi via BFF) |
| --- | --- | --- |
| `/treasury/accounts` | list-search | cash-accounts + CoA accounts + branches + session perms |
| `/treasury/accounts/[id]` | detail | cash-accounts/:id + movements?limit=200 |
| `/treasury/receipts`, `/payments` | list-search | treasury/{kind} + partners (status + from/to filters, BFF refetch) |
| `/treasury/receipts/new`, `/payments/new` | transaction-entry | cash-accounts + partners + tenant profile (base currency) |
| `/treasury/receipts/[id]`, `/payments/[id]` | document-detail | treasury/{kind}/:id + refs + session perms |
| `/treasury/expenses` | list-search (combined) | expense-categories?includeInactive=true + expenses + cash-accounts + CoA + session perms |
| `/treasury/transfers` | list-search + inline create | cash-transfers + cash-accounts + session perms |
| `/treasury/shifts` | list-search + ShiftPanel | shifts + cash-accounts |
| `/treasury/bank-rec` | wizard | bank-statements + cash-accounts + import-adapters |

All pages: locale guard (`isLocale`/`notFound`), `requireSessionToken`, `fetchApi("treasury/…")`
relative paths, 401 → login redirect, FORBIDDEN → ErrorState without retry, other
errors → `localizedApiError` + RetryButton — same shape as the accounting/rates exemplar.

### Client components — `apps/web/components/treasury-*.tsx`

- `treasury-accounts.tsx` — accounts table (type filter, bilingual name, balance via
  `formatMoneyDisplay`), open form (GL picker/branch/currency), close with reason;
  `canManage` from session perms.
- `treasury-account-movements.tsx` — IN/OUT ledger drill-down with from/to filter.
- `treasury-docs-table.tsx` — receipts/payments list, one component for both sides
  (kind prop), status + date filters, FX + allocated columns.
- `treasury-doc-form.tsx` — create form + allocation panel wiring (POST draft → PUT
  allocations → route to detail). MoneyInput amount, optional manual FX rate.
- `treasury-allocation-editor.tsx` — INV-016 panel: partner open items load
  (`treasury/open-items?partnerId&side`), FIFO suggest button
  (`allocations/suggest`), checkbox+MoneyInput rows, live allocated/remainder bar
  (exact string math), save (detail mode) / draft callback (new mode), readOnly after post.
- `treasury-doc-detail.tsx` — DefList summary + submit/approve/post/reverse/cancel;
  post toast shows {no} + journal {entry}.
- `treasury-expenses.tsx` — claims list + lifecycle actions + claim form + category
  management (code/bilingual name/GL account/approval mode).
- `treasury-transfers.tsx` — list + create (from≠to guard) + submit/approve/post/cancel.
- `treasury-shifts.tsx` — list + open form + `ShiftPanel` (capture/close) + cancel.
- `treasury-bank-rec.tsx` — import wizard (FileReader→base64, adapter select, optional
  period + column mapping), statements list, lines workspace (auto-match, manual
  match against unmatched movements, unmatch), unmatched-aging panel, reconcile,
  INV-019 cash-check card.

All money values stay strings; app-side math goes through `apps/web/lib/exact-money.ts`
(BigInt 4-dp minor units — same approach as the ui package's `exact-decimal`).

### UI package pattern — `packages/ui`

- `src/patterns/shift-panel.tsx` — headless cashier console (data + `onCapture`/
  `onClose` callbacks, labels via props), EXPECTED = opening+in−out via the shared
  `exact-decimal` helpers (extracted from money-summary-bar so both patterns use one
  implementation — ADR-0009), supervisor id+PIN fields for BR-021 variance, CLOSED
  read-only summary, `data-testid` hooks (`shift-panel`, `shift-panel-status`,
  `shift-panel-cash-in/out`, `shift-panel-counted`, `shift-panel-reason`,
  `shift-panel-supervisor`, `shift-panel-supervisor-pin`, capture/close submits).
- `src/patterns/treasury-patterns.stories.tsx` — 4 stories (ShiftOpenCapture,
  ShiftCloseVariance, ShiftClosedSummary, ShiftSupervisorRequired), same CSF +
  bilingual-inline-label conventions as accounting-patterns.stories.tsx.
- `src/utils/exact-decimal.ts` — addExact/subtractExact/compareExact/isZeroExact
  (BigInt 4-dp); `money-summary-bar.tsx` refactored to import it (no local copy).
- `Button`/`Input`/`MoneyInput` gained a `data-testid` prop passthrough (play targets).
- Exported from `src/index.ts`; `docs/ui/COMPONENT_CATALOG.md` row present (§6.3).

### Contracts — `packages/contracts/src/navigation.ts`

Treasury group with all 7 NAV_ITEMS exactly as specced (ids treasury.accounts /
receipts / payments / expenses / transfers / shifts / bank_reconciliation; featureKeys
from FEATURE_CATALOG; permissions from the seeded matrix; icons banknote, receipt,
send, file-check, arrow-left-right, clock, landmark — all registered in ICON_REGISTRY,
which was extended for the three new ones). `behavior.test.ts` updated: resolved group
order now home, inventory, accounting, **treasury**, partners, settings.

### Web libs

- `lib/api-types.ts` — all 11 row types verbatim + SettlementPostResult,
  ImportAdapterRow, AllocationSuggestionRow, UnmatchedAgingData,
  StatementImportResult, AgedCashMovementRow, TreasuryCashCheckResult.
- `lib/messages.ts` — `localizedTreasuryError` maps all 37 treasury codes (A7-sensitive
  not-founds collapse to the generic errorsNotFound), plus localizedCashAccountType /
  localizedTreasuryMethod / localizedShiftStatus / localizedStatementStatus /
  localizedMatchMode helpers.
- `lib/exact-money.ts` — app-side exact string math (sum/add/subtract/compare/isZero +
  isPositiveDecimal mirror of the API MONEY regex).

## Fixes applied by this agent (audit pass)

1. **Arabic naturalness** (Arabic-first glossary compliance):
   - `treasuryBankRecAgingAsOf`: «كائن تاريخ التقادم» → **«تاريخ احتساب التقادم»**
     («كائن» was a literal "as of" mistranslation).
   - `treasuryBankRecCashCheckAsOf`: «كائن التاريخ» → **«كما في تاريخ»** (standard
     financial-statement "as of").
   - `treasuryBankRecAdapter`: «مؤشر الاستيراد» → **«محول الاستيراد»** (adapter =
     converter, not pointer), also fixed inside `treasuryErrStatementFormat`.
   - `treasuryBankRecColControlBalance`: «رصيد الحساب النظامي» → **«رصيد حساب الرقابة»**
     (control account = حساب الرقابة, the standard term).
   - `treasuryAccountTypePetty`: «صندوق صغير» → **«الصندوق النقدي الصغير»** (task glossary term).
2. **No-literals rule**: `treasury-doc-form.tsx` built the Arabic-description label as
   `` `${d.treasuryDocDescription} (AR)` `` — replaced with a dedicated key
   **`treasuryDocDescriptionAr`** («الوصف (عربي)» / "Description (Arabic)") added to
   interface + AR + EN (parity 973 → 974).

## i18n key count

**241 treasury/navTreasury keys** in each of the three sections (interface, AR, EN),
sets identical. Total catalog parity: **ar=974 = en=974**, no empty values.

## Verification (final run, after the fixes)

- `pnpm --filter @erp/web typecheck` → green (no errors)
- `pnpm --filter @erp/web lint` → green (erp-ui rules: no physical-direction/hex/px/deep-import/raw-radix)
- `pnpm --filter @erp/web build` → **✓ Compiled successfully**, 82/82 pages, all 11 treasury routes emitted
- `pnpm --filter @erp/ui typecheck` → green
- `pnpm --filter @erp/ui lint` → green
- `pnpm --filter @erp/ui test` → **42/42 passed** (3 files)
- `pnpm check:i18n-parity` → **ar=974 keys, en=974 keys … 100% key parity; no empty values**
- `pnpm check:ui-catalog` → **37 component exports ↔ 60 catalog rows, parity green** (ShiftPanel row already present)

Not run (per constraints): `test:visual-harness-run`, `gate:local`, storybook build.

## Deviations / notes for the orchestrator

1. **Transfers actions**: the task's endpoint list abbreviated transfers to
   `+/:id/post, /cancel`, but the shipped (frozen) API also exposes
   `cash-transfers/:id/submit` and `/:id/approve` (controller lines 686/694). The UI
   wires submit/approve like receipts/payments; no API change was needed.
2. **AgedCashMovementRow** is typed `ageDays?: number | null` — one defensive notch
   wider than the spec's `ageDays: number`; renders `ageDays ?? "—"`.
3. **File input** in bank-rec uses a raw `<input type="file">` (the catalog has no
   FileInput) styled identically to the pre-existing inventory import-wizard input —
   consistent with the established app pattern.
4. **Partner pickers** in doc forms are plain `Select` over `partners?limit=100`
   (server-loaded reference) — the PartnerPicker pattern expects a live search API
   this surface doesn't have; Select follows the accounting exemplars.
5. `treasuryBankRecFilterAccount` and a handful of sibling keys are currently defined
   but unreferenced (reserved for the statement-list account filter); keys are
   append-only per the i18n policy.
