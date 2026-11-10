# PHASE-008 — Treasury: Cash, Banking & Expenses — COMPLETION REPORT

> **Status:** COMPLETE · **Date:** 2026-10-30 · **Tag:** `phase/008`
> **Spec:** [../PHASE-008.md](../PHASE-008.md) (authoritative) · **Prerequisite:** PHASE-007 COMPLETE (`phase/007`)

## Summary

PHASE-008 delivered the treasury module — the daily cash heartbeat of the platform and
the **first consumer of the posting engine's public contract**. Every money movement
(receipt, payment, transfer with fee, expense payout, shift variance) posts through
`PostingEngine.post` with its canonical G-row shape, writes exactly one immutable
`cash_movements` row in the same transaction, and leaves every cash/bank/petty account
provable against its movements (INV-019 — registered into the PHASE-007 reconciliation
framework with seeded-drift detection that blocks period lock, RC-08 + PC-04).
Partner opening balances posted in PHASE-007 became settleable on day one: allocations
with FIFO suggestion, partials, concurrency-safe bounds (INV-016/CC-02), and explicit
on-account remainders (BR-027). Realized FX differences post automatically at settlement
with the original stored rate honored on the control line (INV-008) and an explicit
FX_GAIN/FX_LOSS residual — golden-tested in both directions. Bank statement import ships
a pluggable adapter registry (generic CSV with Arabic-header mapping + generic XLSX,
sha-256 idempotency, row caps) feeding the matching workspace (auto + manual match,
unmatched aging on both sides, per-account period lock — BR-022; statement lines never
become ledger entries). The web treasury group (12 AR/EN routes) and the `ShiftPanel`
pattern (with AR+EN baselines) went live; i18n grew 733 → 974 keys at exact parity.

All 10 acceptance criteria pass with recorded output. `pnpm gate:local` is ALL GREEN.

**Reality-audit repairs:** this phase's gates surfaced a family of pre-existing latent
file-order couplings in the db suite (details in §"Order-independence repairs") —
observed live after treasury's five spec files perturbed vitest's scheduling — all
repaired with afterAll state restores, then proven with 4 shuffle-seed runs.

## Files created

**API — module** (`apps/api/src/modules/treasury/`):

| File | Role |
|------|------|
| `treasury.module.ts` | module wiring (registered in `app.module.ts`) |
| `presentation/treasury.controller.ts` | 60 routes under `/api/v1/treasury` (885 lines) |
| `application/account-service.ts` | T2 — open/close, currency rules, balance ≡ Σ movements |
| `application/receipt-service.ts` / `payment-service.ts` | T3 — DRAFT→POSTED, methods, FX capture, numbering |
| `application/allocation-service.ts` | T4 — FIFO suggest, partials, INV-016 bounds, on-account |
| `application/fx-settlement.ts` | T5 — SettlementCore: realized FX residual posting |
| `application/petty-cash-service.ts` | T6 — BR-020 caps + override |
| `application/transfer-service.ts` | T7 — G-12 with bank charges |
| `application/expense-service.ts` | T8 — categories + claims + approvals + attachments |
| `application/shift-service.ts` | T9 — BR-021 open/float/capture/close/variance |
| `application/statement-import-service.ts` | T10 — adapters, idempotency, row caps |
| `application/bank-rec-service.ts` | T11 — matching, aging, period lock |
| `application/treasury-reconciliation-service.ts` | T12 — INV-019/RC-08 check registration |
| `application/document-support.ts` | shared document lifecycle helpers |
| `domain/treasury-errors.ts` | 37 typed error codes (ERROR_MODEL mapping in the filter) |
| `infrastructure/treasury.store.ts` | tenant-scoped queries (app-role UoW) |
| `infrastructure/bank-adapters/index.ts` | adapter registry: `generic-csv`, `generic-xlsx` |

**API — migration + tests**:
`apps/api/migrations/0012_treasury.sql` (+ `meta/_journal.json`); db suite
`apps/api/src/__db__/treasury/` — `fixtures.ts` (idempotent dedicated tenant T, SAR base),
`golden.spec.ts` (13), `invariants.spec.ts` (7), `bank-rec.spec.ts` (11),
`treasury-rules.spec.ts` (7), `spoof.spec.ts` (5).

**Web**: `apps/web/app/[locale]/treasury/**` — 12 `page.tsx` routes (accounts,
accounts/[id], receipts, receipts/new, receipts/[id], payments ×3, expenses, transfers,
shifts, bank-rec); 10 client components `apps/web/components/treasury-*.tsx`;
`apps/web/lib/exact-money.ts` (BigInt 4-dp exact string math).

**UI package**: `packages/ui/src/patterns/shift-panel.tsx` (ShiftPanel pattern),
`packages/ui/src/patterns/treasury-patterns.stories.tsx` (4 stories × AR+EN),
`packages/ui/src/utils/exact-decimal.ts` (addExact/subtractExact/compareExact/isZeroExact
— extracted so `money-summary-bar.tsx` and ShiftPanel share one implementation, ADR-0009);
8 AR+EN baseline PNGs under `packages/ui/__image_snapshots__/`.

**Docs**: `docs/database/TABLES/treasury-tax.md` (authored — the phase's §8 obligation).

## Files changed

- `apps/api/src/db/schema.ts` — 11 treasury `pgTable` mirrors; `app.module.ts` — TreasuryModule.
- `apps/api/src/infra/auth/route-permissions.ts` — §3.4 permission bindings for the 60 routes.
- `apps/api/src/infra/http/error.filter.ts` — treasury error codes → ERROR_MODEL HTTP mapping
  (not-founds → 404 with A7 parity).
- `apps/api/src/infra/db/migrations.ts` + `migrations.spec.ts` — `0012_treasury` registered
  (fresh + regression boot).
- `apps/api/src/infra/settings/setting-reader.ts` + `modules/configuration/domain/settings-schema.ts`
  — treasury keys: `petty_cash.single_tx_limit` / `max_balance` (BR-020, **PLACEHOLDER defaults
  pending OQ-002, documented in the schema**), `shift_variance_tolerance`,
  `shift_auto_post_small_variance`, `shift_supervisor_pin`, `expense_receipt_threshold` (0 default).
- `apps/api/src/modules/accounting/application/period-service.ts` — PC-04 lock gate extended to
  `CASH` runs; `reconciliation-service.ts` — close checklist's `reconciliation.cash` +
  `reconciliation.bank_rec` items now live (NOT_RUN → OK/NOT_APPLICABLE/BROKEN states, never a
  silent pass).
- `apps/api/src/__db__/isolation/tables.registry.ts` — 11 new tables (A1–A10 suite green);
  `identity-isolation.db.spec.ts` — treasury fixture rows (2 GL hosts + 2 treasury accounts
  per tenant, FK-consistent).
- `apps/api/src/__db__/accounting/*` — order-independence repairs (§ below) + the PHASE-008
  checklist test; `master-data-flows.db.spec.ts` — canonical branch row id convergence;
  `identity-flows.db.spec.ts` — `treasury.accounts.view` viewer-tier check.
- `packages/contracts/src/navigation.ts` — treasury nav group (7 items, icons, featureKeys,
  permissions; ICON_REGISTRY extended); `behavior.test.ts` — resolved order home, inventory,
  accounting, **treasury**, partners, settings.
- `apps/web`: `app-shell.tsx` (group rendering), `i18n/dictionaries.ts` (733 → 974 keys; 241
  treasury/navTreasury keys per section, AR = EN), `lib/api-types.ts` (all row types + result
  types), `lib/messages.ts` (`localizedTreasuryError` — all 37 codes, A7-sensitive not-founds
  collapse to the generic; type/method/status/shift/statement/match-mode localizers).
- `packages/ui`: `Button`/`Input`/`MoneyInput` `data-testid` passthrough; `index.ts` exports;
  `COMPONENT_CATALOG.md` ShiftPanel row (§6.3).
- `docs/database/ENTITY_CATALOG.md` (treasury rows: `treasury_allocations` added,
  `cash_movements` currency/rate/base_amount fields), `ERD/treasury-tax.md` (refresh:
  receipts/payments/treasury_allocations entities + relationships + invariants note),
  `docs/product/FEATURE_CATALOG.md` (cheque-deferral note now records the PHASE-008 provenance),
  `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` (008 row enriched).

## Database migrations

`0012_treasury.sql` (the phase doc's T1 names `0009_treasury.sql`; 0009–0011 were consumed
by PHASE-006/007 — the same drift the PHASE-007 report recorded for its own T2; ships as
0012). Eleven tenant-owned tables, all with the standard columns block, composite FKs,
RLS via `erp.apply_tenant_policy()`, and registry isolation:

- `cash_accounts` — `uq_cash_accounts_tenant_account` enforces the 1:1 GL link (INV-019
  unambiguity); closed-shape CHECK; bilingual name unique per tenant.
- `cash_movements` — append-only 🔒: `erp_app` holds SELECT/INSERT only (no UPDATE/DELETE
  grant at all) + `erp.cash_movements_guard()` BEFORE UPDATE/DELETE trigger — proven live
  (grant denial as the app role AND the trigger raise for superuser misuse);
  `uq_cash_movements_source_side` = movement-level idempotency mirror of INV-013;
  `base_amount` carries the exact base conversion the INV-019 check sums.
- `receipts` / `payments` — posted-shape CHECK (POSTED ⇔ number + journal set), INV-016
  `allocated_amount` bounds CHECK, lifecycle stamps, CHEQUE method value reserved.
- `treasury_allocations` — exactly-one-doc CHECK (`(receipt_id IS NULL) <> (payment_id IS
  NULL)`) with two partial unique indexes; real composite FKs to `partner_subledger_entries`
  (not a polymorphic hole). *(The phase doc's §4 table list undercounts this table — its
  §2.3 allocations + §6 INV-016 tests require durable rows; doc-reality reconciliation
  recorded here.)*
- `expense_categories` / `expenses` — bilingual categories; `tax_code_id` **reserved**
  (nullable placeholder — PHASE-009 wires the FK + GL effect); `receipt_file_id` → files.
- `cash_transfers` — from ≠ to, fee CHECKs (`0 ≤ fee < amount`).
- `cashier_shifts` — `uq_cashier_shifts_one_open_per_account` (partial unique); supervisor
  attestation columns.
- `bank_statements` — `uq_bank_statements_tenant_hash` (import idempotency); reconciled-shape
  CHECK; `bank_statement_lines` — match-shape CHECK, informational only.
- Widening: `reconciliation_runs.kind` += `BANK_REC`; `file_objects.owner_type` += `EXPENSE`
  (additive, no removals).

Fresh-boot + regression both proven (the db suite boots an embedded PostgreSQL 16 and
applies all 12 migrations in `global-setup`; `migrations.db.spec.ts` asserts the manifest
state). Additive only — rollback = previous image (expand-compatible); posted documents
are immutable; statement imports are idempotent by file hash (safe to re-run after any
rollback).

## API changes

60 routes under `/api/v1/treasury` (API_CONVENTIONS: POST actions with `Idempotency-Key`
presence guard, success envelopes, typed ERROR_MODEL failures, A7-parity 404s on
unknown-vs-foreign ids):

- `cash-accounts` CRUD-lite: list/create, `/:id`, `/:id/close`, `/:id/movements`; `petty-cash/:id` overview.
- `receipts` + `payments`: list/create/`/:id` + `/submit /approve /post /reverse /cancel`
  + `GET|PUT /:id/allocations`; `GET /open-items?partnerId&side`; `GET /allocations/suggest` (FIFO).
- `expense-categories` list/create; `expenses` list/create/`/:id` + `/submit /approve /post /cancel`.
- `cash-transfers`: list/create/`/:id` + `/submit /approve /post /cancel`.
- `shifts`: list/create/`/:id` + `/capture /close /cancel`.
- `bank-statements`: `GET /import-adapters`, `POST /import`, list, `/:id`, `/:id/lines`,
  `/:id/auto-match`, `/:id/match`, `/:id/reconcile`; `GET /unmatched-aging`.
- `POST /reconciliation/cash-check` (INV-019/RC-08 run).

Permissions per AUTHORIZATION_MATRIX §3.4 (route registry, drift-checked: 199 keys);
approve keys are SoD-guarded and audited on use; `treasury.bank_reconciliation.manage`
locks periods.

## UI changes

12 routes under `/[locale]/treasury` (archetypes per PAGE_ARCHETYPES; all: locale guard,
`requireSessionToken`, BFF `fetchApi` relative paths, 401 → login redirect, FORBIDDEN →
ErrorState without retry, other errors → `localizedApiError` + RetryButton):

| Route | Archetype |
| --- | --- |
| `/treasury/accounts` + `/[id]` | list-search + detail (movements drill-down, open/close forms) |
| `/treasury/receipts`, `/payments` (+ `/new`, `/[id]`) | list-search + transaction-entry + document-detail |
| `/treasury/expenses` | list-search (claims + categories management) |
| `/treasury/transfers` | list-search + inline create |
| `/treasury/shifts` | list-search + ShiftPanel console |
| `/treasury/bank-rec` | wizard (import → match grid → aging → reconcile lock) |

Allocation editor: partner open-items load, FIFO suggest, checkbox + MoneyInput rows,
live allocated/remainder bar in exact string math (`lib/exact-money.ts` — BigInt 4-dp,
mirrors the API MONEY regex). `ShiftPanel` in `packages/ui`: headless cashier console —
EXPECTED = opening + in − out via the shared `exact-decimal` helpers; supervisor id + PIN
fields for BR-021; CLOSED read-only summary; `data-testid` hooks; 4 bilingual stories;
AR+EN baselines (8 PNGs). Nav: treasury group (7 items) between accounting and partners.
i18n: **974 = 974 AR/EN keys, 100% parity, no empty values** (241 treasury/navTreasury keys
per section). Arabic-naturalness audit pass applied (5 glossary fixes + one no-literals
fix recorded in `agent-ctx/T14-UI-treasury-web-ui.md`).

## Security changes

- All 11 new tables RLS'd + composite tenant FKs + registered in the isolation registry —
  the generated A1–A10 suite runs against them in every db-suite execution.
- Spoof suite (SECURITY_TEST_PLAN §2 PHASE-008): foreign partner id / foreign cash-account
  id / foreign open-item id in nested payloads → typed rejection with **zero partial
  creation** (S-04); own-tenant other-partner open item → rejected (partner must match);
  A7 route id-probe parity (unknown ≡ foreign → identical 404s).
- `cash_movements` append-only by grants + trigger (even repository misuse cannot rewrite
  cash history) — both denial paths asserted live.
- §3.4 permission checklist green incl. approval-limit boundaries; approve actions audited.
- No bank credentials exist anywhere — statement import is file-based only.

## Tests executed

Db suite (embedded PostgreSQL 16, real migrations, app-role services — nothing inserts GL
rows directly): **31 files, 572 tests, 572 passed** (default gate order). The 43 treasury
tests:

- `golden.spec.ts` (13): G-05 canonical receipt (official number + movement + subledger +
  audit), partial allocation + on-account remainder (BR-027), ALREADY_POSTED idempotent
  replay (INV-013), INVALID_AMOUNT zero-residue, G-06 gain 3.75→3.76 + loss mirror
  3.75→3.74 (stored rate honored INV-008), PURPOSE_NOT_MAPPED (FX_GAIN unmapped)
  zero-residue, G-10 base + FX mirrors, PERIOD_LOCKED (December) zero-residue, G-11 payout
  (EXP number, movement OUT, reserved tax field travels), G-12 transfer with fee (two
  movements, INV-019 both sides), CASH_ACCOUNT_CLOSED zero-residue.
- `invariants.spec.ts` (7): INV-016 over-allocation on document (500-on-300) + on open item
  (zero residue BOTH sides); partial bookkeeping exact + remainder is an allocatable open
  item; CC-02 two parallel posts serialize on the row lock (final ≤ item total, zero loser
  residue); INV-019/RC-08 GL = Σ movements after every operation type; seeded drift →
  BROKEN with offending id + notification + PC-04 lock block; append-only denials (grant +
  trigger).
- `bank-rec.spec.ts` (11): Arabic-header CSV (BOM + التاريخ/المبلغ/المرجع/البيان),
  idempotent re-import, XLSX adapter, row caps (STATEMENT_TOO_LARGE > 5000), typed format
  errors + non-BANK refusal, auto-match (amount + window + direction), exact manual match
  (no tolerance absorption; wrong amounts + double-matching rejected), unmatched aging both
  sides, BR-022 period lock (re-reconcile refused, matching inside window refused),
  **statement lines never become ledger entries** (asserted from import through reconcile).
- `treasury-rules.spec.ts` (7): BR-020 single-tx cap + override with audit, fund-balance cap
  (reimbursement rejection + override), fund overview exposes caps + balance; BR-021 worked
  example (expected 1,380 vs counted 1,377.50 → −2.50 posts with the shift as source),
  within-tolerance auto-post, one-open-per-account + CASH-only shifts; BR-023 threshold 0
  default (receipt mandatory) + per-category approval routing.
- `spoof.spec.ts` (5): the S-04/A7 suite above.

Plus the full platform regression inside the same run (identity, tenancy, accounting,
isolation, master data, jobs, files, readiness — all green; 324-test generated isolation
suite included).

### Order-independence repairs (reality-audit finds, pre-existing latent defects)

Observed live: with treasury's five new spec files, vitest's file scheduling changed and
`gl-perf.db.spec.ts` crashed (`PERIOD_LOCKED` — posting at 2026-09-15 after
`periods.spec.ts` had soft-closed September on the shared FY2026 of tenant A). Root cause:
a family of cross-suite state couplings that had existed since PHASE-004..007 — the
default order had simply never exposed them. Repairs (all in-audit, documented):

1. `restorePeriodsOpen(months)` helper in the accounting fixtures: every state-mutating
   suite now restores the pristine all-OPEN period state in `afterAll` via the public
   INV-020 reopen flow — periods.spec (Jul/Sep/Oct), INV-011-022 (Mar/Apr/May),
   concurrency (Dec), accounting/golden (Nov).
2. INV-011-022's INV-022 fuzz corpus flipped tenant settings (notably
   `accounting.fx_revaluation_enabled=true`) and never restored them — afterAll now
   restores the default-absent state + drops the fuzz-only entitlement/policy.
3. treasury G-11 golden find-or-creates the T-RENT category (the invariants suite creates
   the same code on the shared treasury tenant).
4. master-data-flows reuses the isolation suite's canonical `MAIN` branch row id
   (`uq_branches_tenant_code` made the two different-id inserts order-coupled).

Verification of the repair: `--sequence.shuffle.files --sequence.seed=…` across 4 seeds —
default order 572/572, **seed 7 → 572/572 fully green**; seeds 42/13/99 fail only on two
pre-existing classes (documented in §Known limitations, both deterministic-safe under the
default gate order).

## Actual test results

```
pnpm test:db  →  Test Files  31 passed (31) · Tests  572 passed (572)
                 (embedded PostgreSQL 16.14; migrations 0001–0012 applied in setup)
treasury-only →  golden 13 · invariants 7 · bank-rec 11 · rules 7 · spoof 5 = 43/43
shuffle seeds →  default 572/572 · seed 7 572/572 · 42/13/99: only the two documented
                 pre-existing classes (isolation pristine-count design; email deadline)
pnpm test     →  @erp/domain-core 38 · @erp/contracts 11 · @erp/ui 42 · @erp/api 80 = 171/171
```

## Build results

`pnpm build` (turbo): `@erp/api` tsc clean · `@erp/ui` tsc clean · `@erp/web` **✓ Compiled
successfully** (82/82 pages; all 12 treasury routes emitted). `pnpm typecheck` green across
all 6 packages.

## Invariants covered

| Invariant | Where enforced | Test evidence |
| --- | --- | --- |
| INV-016 | allocation service (bounds under row lock) + DB CHECK | over-allocation on document AND open item rejected zero-residue; partial exact; CC-02 parallel |
| INV-019 | movement substrate + reconciliation check | GL = Σ movements after every op type; seeded drift → BROKEN + PC-04 block; append-only grants + trigger |
| INV-008 | SettlementCore (control line at original stored rate) | G-06 gain + loss mirrors, G-10 FX payment mirrors |
| INV-013 | `uq_cash_movements_source_side` + engine key | ALREADY_POSTED idempotent replay golden |
| INV-021 | numbering at posting | receipt/payment/expense/transfer numbers asserted in goldens |
| RC-08 | `TreasuryReconciliationService.runCashCheck` | registered in the framework; checklist states live |
| BR-020/021/022/023 | petty-cash / shift / bank-rec / expense services | treasury-rules.spec + bank-rec.spec |

INV-016 and INV-019 are inside the permanently-blocking db suite (every `pnpm gate:local`
execution).

## Acceptance criteria verification

1. **Canonical posting shapes** — G-05/G-06 (+loss mirror)/G-10 (+mirrors)/G-11/G-12 green
   with line-level expected-vs-actual asserts, official numbers, INV-013 idempotency; every
   failure pack asserts zero ledger/movement/subledger residue. ✅
2. **INV-016 enforced + tested incl. concurrency; on-account remainders explicit open
   items.** ✅ (invariants.spec INV-016 ×3 + CC-02; golden BR-027)
3. **INV-019 enforced + tested; seeded drift → BROKEN + PC-04 lock block (RC-08).** ✅
4. **Realized FX automatic at settlement; stored rate honored (INV-008); explicit gain/loss
   line never dropped; both mirrors golden-tested.** ✅
5. **Bank rec per RECONCILIATION §4**: adapters, auto + manual match, unmatched aging,
   per-account period lock (BR-022); statement lines never ledger entries; imports
   idempotent + bounded. ✅
6. **Shifts enforce BR-021** — within-tolerance auto-post with shift source;
   above-tolerance needs supervisor PIN + reason; variances audited. ✅ (worked example
   −2.50 exactly as the phase doc's numbers)
7. **Petty cash BR-020 caps + reimbursement/override path; PLACEHOLDER defaults explicitly
   documented in the settings schema (OQ-002).** ✅
8. **All new tables in the isolation registry, A1–A10 green; foreign references rejected
   with zero partial creation.** ✅ (324-test generated suite + spoof 5)
9. **§3.4 permissions enforce on routes; approve keys SoD-guarded + audited.** ✅
   (route registry + `check:permissions-drift` green: matrix 199 = seed 199; identity-flows
   viewer-tier `treasury.accounts.view` check)
10. **Every screen instantiates a sanctioned archetype with AR+EN baselines; axe +
    keyboard journeys green; ShiftPanel has a catalog entry.** ✅ (visual harness: all
    stories AR+EN threshold-0, axe 0 violations both directions, both-directions coverage
    check; ShiftPanel row in COMPONENT_CATALOG §6.3 — 37 exports ↔ 60 rows parity)

## Evidence

`pnpm gate:local` — **ALL GREEN** (executed 2026-10-30, every step recorded):

```
typecheck                        EXIT=0 (6 packages)
lint (incl. module boundaries)   EXIT=0
lint:depcruise                   EXIT=0
permissions docs-drift           OK — matrix 199 keys, seed 199 keys
unit + property tests             171/171 (domain-core 38, contracts 11, ui 42, api 80)
db suite (embedded PG16)          31 files / 572 tests — 572 passed
build                             EXIT=0 (web ✓ Compiled successfully)
design-token contrast (§16)       EXIT=0
i18n key parity                   ar=974 = en=974 — 100% parity; no empty values
ui catalog coverage               37 component exports ↔ 60 catalog rows
visual harness                    storybook build OK · 16 passed (1.5m) ·
                                 axe 0 violations · both-directions coverage OK
perf gate                         floor=16.57ms table=16.76ms overhead=0.18ms (≤6ms budget)
web secure-headers/CSP probe      4 passed
docs validation                   29/29 checks passed
negative boundary meta-test       EXIT=0
negative erp-ui lint meta-test    EXIT=0
negative i18n parity meta-test    EXIT=0
```

Manual-verification items from §6 were exercised as service-level flows inside the db
suite (receipt against a partner opening item with partial + on-account remainder; FX
settlement both directions; transfer with fee INV-019 both sides; the BR-021 shift worked
example; Arabic-header statement import → auto-match → manual match → reconcile → lock →
re-reconcile refused). The browser-journey equivalents ride on the BFF screens (built,
12 routes emitted) — hosted-CI/Playwright journeys remain waived per the standing owner
directive (local-gate equivalence recorded since PHASE-001).

## Known limitations

1. **Pre-existing (documented, not introduced here) db-suite order sensitivities**,
   observable only under artificial file-order shuffling, both deterministic-safe under the
   default gate order (which the repo's `pnpm gate:local` always uses): (a) the
   `identity-isolation` suite asserts *pristine* per-table row counts on the shared seed
   tenants — it must run before suites that add rows there (it does, deterministically,
   under the default order; a dedicated-tenant refactor for the master-data suites is the
   proper long-term repair and belongs to a future decision record, not this phase);
   (b) the `notifications-email` suite has a 10-second pg-boss delivery deadline that can
   be missed when it runs late behind a loaded queue (default order runs it early — green
   consistently).
2. Transfer UI wires `submit`/`approve` (the frozen API exposes them; the phase doc's
   endpoint list abbreviated to post/cancel only).
3. `AgedCashMovementRow.ageDays` is typed `number | null` defensively (renders "—").
4. Bank-rec file input is a raw `<input type="file">` styled like the inventory import
   wizard (the catalog has no FileInput component); partner pickers are Select over
   server-loaded references (no live-search surface here — follows the accounting
   exemplars).
5. A handful of reserved i18n keys (`treasuryBankRecFilterAccount` et al.) are defined but
   unreferenced (append-only policy).

## Deferred work

- **Cheques** (`treasury.cheques`, BR-024): method enum reserves CHEQUE; the full lifecycle
  is delivered by the `notes` module (PHASE-027 per the v2.0 reconciliation /
  EXPANSION_REGISTER ED-03 — the catalog row now records the PHASE-008 deferral
  provenance). No half lifecycle was built inside receipts, exactly per the phase doc.
- **VAT recoverable on expenses**: `tax_code_id` reserved; PHASE-009 wires the FK + GL
  effect and extends the G-11 golden with the VAT leg.
- POS-grade shift UX (PHASE-016); unrealized revaluation (already in PHASE-007);
  supplier-invoice/AR-invoice allocations (PHASE-011/012); bank API connections
  (file-based import only, by design).
- Standing waived evidence (first infra availability): hosted CI run, compose healthcheck,
  Testcontainers run, mailpit capture, hosted k6.

## Documentation updated

[IMPLEMENTATION_STATUS.md](../../../planning/IMPLEMENTATION_STATUS.md) (PHASE-008 →
COMPLETE + row) · [CURRENT_STATE.md](../../../handoff/CURRENT_STATE.md) ·
[NEXT_ACTION.md](../../../handoff/NEXT_ACTION.md) (→ PHASE-009) · [CHANGELOG.md](../../../handoff/CHANGELOG.md) ·
[ENTITY_CATALOG.md](../../../database/ENTITY_CATALOG.md) · **[TABLES/treasury-tax.md]
(../../../database/TABLES/treasury-tax.md) — authored this phase** ·
[ERD/treasury-tax.md](../../../database/ERD/treasury-tax.md) — refreshed ·
[FEATURE_CATALOG.md](../../../product/FEATURE_CATALOG.md) — cheque-deferral note ·
[COMPONENT_CATALOG.md](../../../ui/COMPONENT_CATALOG.md) — ShiftPanel (§6.3, already
staged by the UI task) · [PHASE_ACCEPTANCE_CRITERIA.md](../../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
— 008 row enriched. Docs validation 29/29 after all edits.

## Risks

- RISK-009 extension (wrong receipt/FX posting corrupts AR + cash simultaneously):
  mitigated before any UI polish counted as done — golden line-level tests + INV-008/009/
  016/019 coverage all green with zero-residue failure packs.
- Adapter sprawl: contained — the registry is a plugin surface; unmapped formats fall back
  to the generic column-mapping adapter (tenant-operable); Arabic headers covered by
  fixtures.
- FX edge cases (3-decimal currencies): the settlement math rides the PHASE-007 decimal
  primitives; residual rules per CURRENCY_AND_PRECISION §4–5.

## Rollback instructions

Additive migration only; posted documents immutable → rollback = previous image
(expand-compatible). `cash_movements` grants/triggers drop with the migration's DOWN
shape; statement imports are idempotent by file hash — safe to re-run after any rollback.
The order-independence repairs are test-only changes (no production surface).

## Next eligible phase

**PHASE-009 — Tax Engine & Jurisdiction Packs** (identify only — not implemented here).
Its prerequisite PHASE-007 is COMPLETE; PHASE-008 (this phase) is now also complete, so
PHASE-010 (Inventory) becomes eligible once PHASE-009 lands. Read
[NEXT_ACTION.md](../../../handoff/NEXT_ACTION.md) first: it names the reserved `expenses.tax_code_id`
wiring + the G-11 VAT leg as this phase's explicit hand-off points, and re-states the
no-fabrication gate for all jurisdiction data.
