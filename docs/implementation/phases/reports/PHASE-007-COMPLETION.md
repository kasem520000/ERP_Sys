# PHASE-007 — Accounting Core & Posting Engine — COMPLETION REPORT

> **Phase ID:** PHASE-007 · **Status:** COMPLETE · **Date:** 2026-10-30 · **Tag:** `phase/007`
> Template: [COMPLETION_REPORT_TEMPLATE.md](../../../implementation/templates/COMPLETION_REPORT_TEMPLATE.md)

## Summary

The platform's financial heart: the **centralized posting engine** (ADR-0007) — a pure
domain package that is the ONLY writer of `journal_entries`/`journal_lines`, implementing
the POSTING_ENGINE.md validation pipeline 1–8 in order with the verbatim error taxonomy,
`(tenant, source_type, source_id, operation)` idempotency (INV-013/CC-01), and
reversal-only correction (INV-014) — plus everything that feeds and reads it: CoA posting
readiness (V1–V6 + fail-closed purpose resolution), the fiscal calendar
(OPEN→SOFT_CLOSED→LOCKED with audited reopen + anti-fraud alert), dated exchange rates,
manual journals with the draft→submit→approve→post lifecycle and SoD-guarded BR-034
policies, recurring journals (draft generation only), GL queries with INV-006 drill-down,
cost centers, the ADR-0006 numbering service (`JE-{yyyy}-{seq:6}`), opening-balance
posting through the OPENING period with per-partner AR/AP subledger rows from entry #1
(G-16), the idempotent unit-reversible year-end close (G-20/PC-05…07), the minimal FX
revaluation run (G-19/BR-036), and the reconciliation framework (RC-01…03) + close
checklist. Eight accounting web screens went live on the new `JournalEntryGrid` /
`MoneySummaryBar` / `ApprovalsQueue` patterns. 26 db spec files / 463 tests green;
`pnpm gate:local` ALL GREEN.

## Files created

- `apps/api/migrations/0010_accounting_core.sql` — fiscal_years + fiscal_periods
  (no-overlap exclusion, OPENING/CLOSING windows), exchange_rates, cost_centers,
  recurring_journals, approval_policies, numbering_sequences + number_assignments,
  reconciliation_runs; RLS macro ×N, composite FKs, tenant-first indexes, marker 10.
- `apps/api/migrations/0011_journal_tables.sql` — journal_entries/journal_lines
  (append-only grants, `uq_journal_entries_tenant_source_op`, balance + immutability +
  period-lock guard triggers), manual_journals/manual_journal_lines (DRAFT documents),
  journal_templates, partner_subledger_entries; hot indexes `(tenant, entry_date)`,
  `(tenant, account_id)`, `(tenant, source)`; marker 11.
- `apps/api/src/modules/accounting/**` — `domain/posting-engine/{posting-engine,
  journal-spec, posting-errors}.ts` (pure; zero infrastructure imports — depcruise-proven)
  + `posting-engine.spec.ts` (22 engine unit tests), `domain/accounting-errors.ts`
  (typed taxonomy), `domain/property.spec.ts` (5 property tests); `application/`
  (coa-service, period-service, fx-service, posting-service, journal-service,
  gl-queries, numbering-service, opening-balances-service, year-end-service,
  reconciliation-service, decimal-strings, partner-subledger-port);
  `infrastructure/{accounting,journal}.store.ts`; `presentation/{accounting,
  journals,gl}.controller.ts`; `api/accounting.ts`; module wiring.
- `apps/api/src/modules/partners/application/subledger-service.ts` — the sanctioned
  module-owned AR/AP subledger writer (same transaction as the posting).
- `apps/api/k6/posting-smoke.ts` — the T-01 smoke-tier k6 script (hosted-runner
  artifact; local substitute below).
- `apps/api/src/__db__/accounting/` — `fixtures.ts` (isolated SAR tenant, template CoA
  exactly like onboarding), `invariants/INV-001-009.spec.ts` (16),
  `invariants/INV-011-022.spec.ts` (8), `golden/golden.spec.ts` (8),
  `concurrency/concurrency.spec.ts` (4), `periods/periods.spec.ts` (5),
  `posting-smoke.local.spec.ts` (1), `gl-perf.db.spec.ts` (3).
- `packages/ui/src/patterns/{journal-entry-grid,money-summary-bar,approvals-queue}.tsx`
  + `accounting-patterns.stories.tsx` (7 stories).
- `apps/web/app/[locale]/accounting/**` — `accounts/page.tsx`, `journals/page.tsx`,
  `journals/new/page.tsx`, `journals/[id]/page.tsx`, `gl/page.tsx`, `periods/page.tsx`,
  `approvals/page.tsx`, `rates/page.tsx`.
- `apps/web/components/{accounting-accounts,accounting-journals-table,journal-workspace,
  journal-detail-panel,accounting-gl,accounting-periods,accounting-approvals,
  accounting-rates,opening-post-panel}.tsx`.

## Files changed

- `apps/api`: `db/schema.ts` (new-table mirrors), `migrations.ts` + journal, `isolation/
  tables.registry.ts` (27 → 43 registered tenant tables), `identity-isolation.db.spec.ts`
  (A2/A4/A7 rows for the accounting tables + viewer-tier accounting view keys),
  `master-data-flows.db.spec.ts` (boundary probe fields), `route-permissions.ts`
  (accounting routes, matrix §3.1), `error.filter.ts` (taxonomy mappings),
  `app.module.ts` (accounting module), `configuration/domain/settings-schema.ts`
  (`accounting.fx_revaluation_enabled` BR-036 default false),
  `partners/infrastructure/partners.store.ts` + `tenancy/infrastructure/tenancy.store.ts`
  (subledger + period read surfaces), `package.json` (k6 script dep note).
- `packages/ui`: `primitives/tooltip.tsx` (self-contained Provider — reality-audit
  repair), `components/overlays.tsx` (Tabs content routing — repair),
  `components/controls.tsx` (Combobox `aria-label` passthrough + named clear button),
  `components/money-input.tsx` (input-level aria-label), `src/patterns/
  journal-entry-grid.tsx` (grid role on the table element, per-cell aria-labels, token
  min-width), `tokens/tokens.css` + `tokens.ts` + `__tests__/tokens.test.ts`
  (`--erp-width-journal-grid` via the governance path), `utils/__tests__/behavior.test.ts`
  (accounting nav group), `index.ts` (pattern exports), 14 new AR+EN baselines +
  overlays re-baselines (crash → real render).
- `apps/web`: `i18n/dictionaries.ts` (320 → 733 keys, parity-gated),
  `lib/api-types.ts` (accounting wire types), `lib/messages.ts`
  (localizedDocumentStatus/PeriodStatus/PeriodKind + localizedAccountingError taxonomy
  mapper), `components/card.tsx` (optional header actions rail),
  `app/[locale]/opening-balances/page.tsx` (PHASE-007 post step).
- Docs: `ENTITY_CATALOG.md`, `TABLES/core-accounting.md`, `ERD/accounting-core.md`,
  `COMPONENT_CATALOG.md` (3 pattern rows), `DESIGN_TOKENS.md` (§12 width token),
  `AUTHORIZATION_MATRIX.md` §3.1 rows, `ACCOUNTING_TESTS.md` coverage column,
  `IMPLEMENTATION_STATUS.md`, `CHANGELOG.md`, `CURRENT_STATE.md`, `NEXT_ACTION.md`,
  `PHASE-007.md` status.

## Database migrations

- `0010_accounting_core.sql` — additive, forward-only: the fiscal/FX/cost-center/
  recurring/approval/numbering/reconciliation cluster (RLS + composite FKs + indexes).
- `0011_journal_tables.sql` — additive, forward-only: the append-only ledger
  (journal_entries/lines + guard/balance/lock triggers + idempotency unique index),
  manual-journal DRAFT documents, templates, partner subledger, tenant-first hot indexes.

Both ran fresh + regression inside every db-suite boot (embedded PostgreSQL 16 via
`ensureTestDb`); `migrations.spec.ts` asserts journal + marker consistency.

## API changes

All under `/api/v1/accounting` (envelope + Idempotency-Key guarded; permissions per
matrix §3.1; 404 on foreign ids — A7 generated rows):

- `accounts[/:id]` (+`/:id/archive`), `purposes[/:key/supersede]`
- `fiscal-years[/:id[/periods]]`, `periods/:id/{soft-close,lock,reopen,checklist}`
- `exchange-rates`, `cost-centers[/:id]`
- `journal-entries[/:id[/submit|/approve|/post|/reverse|/cancel|/preview]]`
- `approvals/queue`, `approval-policies`
- `recurring-journals[/:id/status|/generate-due]`
- `opening-balances/:yearId/post`, `year-end-close/:yearId/{execute,reverse}`
- `gl/accounts[/:id/movements]`, `gl/journal-register`, `gl/entries/:id`
- `numbering/assignments`, `reconciliation/{run,runs}`

## UI changes

Eight screens in the accounting group (المحاسبة), all on @erp/ui catalog components
+ the three new patterns: CoA editor + purpose-mapping panel; journal list with the
full lifecycle actions + recurring section; the journal workspace (archetype 4 —
JournalEntryGrid with the embedded MoneySummaryBar live Σdebit/Σcredit/Δ mirroring
INV-001, Ctrl+D/Alt+Enter keyboard model, inline partner-required rule); journal
detail (immutable-after-post notice + reversal form); GL browser (trial balance →
movements with running balance → entry drill-down + journal register); period
management (years, state actions, reopen with reason, close checklist with explicit
NOT_APPLICABLE, AR/AP reconciliation runs, year-end execute/reverse); approvals queue
(ApprovalsQueue pattern + read-only policy display); exchange-rate editor; plus the
opening-balances post step on the existing workspace. i18n 320 → 733 keys (AR=EN
parity gate green).

## Security changes

- 16 new tenant-owned tables registered in the isolation registry — the generated
  A1–A10 suite covers each (foreign GUC, UPDATE/id-probe A4/A7).
- Risky keys are approval-separated and audited on use: `journal_entries.approve/post/
  reverse`, `periods.lock/reopen/post_to_soft_closed`, `accounts.archive`,
  `opening_balances.post`, `year_end_close.execute` (all pre-seeded in 0004 — drift
  check green at 199 keys).
- SoD: creator≠approver default enforced in `journal-service` (server-side;
  `SELF_APPROVAL_BLOCKED`), surfaced as the queue hint.
- Append-only ledger: erp_app INSERT/UPDATE-only grants + guard triggers + balance +
  period-lock triggers (proven as `erp_app` in INV-003/011).
- k6 script `apps/api/k6/posting-smoke.ts` + the local k6-equivalent harness.

## Tests executed

```
pnpm gate:local                    # ALL GREEN (the CI-equivalent record)
pnpm --filter @erp/api test        # 80 unit (incl. 22 engine + 5 property)
pnpm test:db                       # 463 across 26 files on embedded PG16
pnpm --filter @erp/ui test         # 42 (tokens 4, behavior 21, components 17)
pnpm test:visual-harness-run       # 16 passed (AR+EN ×87 baselines, axe 0)
pnpm --filter @erp/web build       # 64/64 pages (8 new accounting routes)
pnpm check:i18n-parity             # ar=733, en=733, 100% parity
pnpm check:permissions-drift       # matrix 199 = seed 199
pnpm lint:depcruise                # 831 modules, 0 violations
pnpm docs:validate                 # 29/29
```

## Actual test results

| Suite | Result |
|-------|--------|
| api unit (incl. engine pipeline 1–8 + property) | **80 passed** (22 engine, 5 property, 53 prior) |
| db suite (26 files) | **463 passed, 0 failed** — accounting cluster: invariants 24, goldens 8, concurrency 4, periods/RC 5, posting smoke 1, GL perf 3 |
| domain-core / contracts / ui unit | 38 / 11 / 42 passed |
| visual harness | **16 passed** (threshold-0, both directions, axe 0 violations, coverage 87 baselines) |
| perf gate | 10k-row overhead 1.03 ms ≤ 6 ms |
| web CSP probe | 4 passed |
| Full `pnpm gate:local` | **ALL LOCAL GATES GREEN** |

Notable outputs (verbatim):

```
[posting-smoke] n=100 p50=26.1ms p95=50.3ms max=82.1ms failures=0   (budget p95 < 500 ms)
CC-03 — 50 parallel posts → 50 unique official numbers, no gaps/collisions, no deadlocks
G-20 — year-end close golden (PC-05 numbers: R=10,000 / E=7,500 / net=2,500)
G-16 — opening balances: per-partner subledger rows + OPENING_EQUITY, once only
```

One pre-existing vitest artifact (not introduced by this phase, suite exits 0, all
tests pass): `identity-flows.db.spec.ts` logs an unhandled `INVALID_CREDENTIALS`
rejection from the PHASE-003 no-existence-oracle test's intentionally-floating
promises — recorded here for honesty; a fix belongs to the identity owner, not this
phase (no test-editing outside scope per TEST_STRATEGY §7).

## Build results

- `pnpm typecheck` green (api, web, ui, contracts, domain-core, config).
- `pnpm lint` green everywhere (incl. the four erp-ui rules; the raw `960px` in the
  new pattern was caught and routed through a DESIGN_TOKENS-governed token).
- `pnpm build` green; web 64/64 pages; storybook --test build green.

## Invariants covered

Ledger (test → file):

- INV-001/002 balanced doc+base, 0 tolerance → `INV-001-009.spec.ts`
- INV-003 immutability (grants+triggers+RLS as erp_app) → `INV-001-009.spec.ts`
- INV-004 postable active leaves → `INV-001-009.spec.ts` (+ engine unit)
- INV-005 currency restriction → `INV-001-009.spec.ts`
- INV-006 source chain both directions → `INV-001-009.spec.ts` + golden drill
- INV-007 residual conservation → property tests + `INV-001-009.spec.ts`
- INV-008 FX storage determinism → `INV-001-009.spec.ts` + property
- INV-009 AR/AP partner + Σ subledger = control → `INV-001-009.spec.ts` + RC-01/02/03
- INV-011 lock enforcement (engine + trigger) → `INV-011-022.spec.ts` + PC-01
- INV-013 idempotency (sequential + concurrent) → `INV-011-022.spec.ts` + CC-01
- INV-014 reversal mirror/link/once → `INV-011-022.spec.ts`
- INV-015 archive/delete guards → `INV-011-022.spec.ts`
- INV-020 reopen reason + audit + anti-fraud alert → `INV-011-022.spec.ts`
- INV-021 numbering uniqueness + void-reserved → `INV-011-022.spec.ts` + CC-03
- INV-022 config-fuzz seed (settings/entitlements/policy flips → byte-identical math)
  → `INV-011-022.spec.ts` (extended by every later phase per the phase doc)
- **Deferred to owners:** INV-010/017/018 → PHASE-010; INV-016/019 → PHASE-008;
  INV-012 → PHASE-009 (per §2.15 — the coverage checklist shows no silently
  uncovered row).

Golden ledger (G-row ownership): G-16, G-19 (minimal), G-20 + engine-level goldens
(manual post lifecycle, FX entry, recurring generation, rounding-residual lines,
failure pack zero-residue) → `golden.spec.ts`. G-01…G-15, G-17, G-18 land with their
owning modules (P-008/010/011/012/018) per ACCOUNTING_TESTS §9.

## Acceptance criteria verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Pipeline 1–8 in order, exact taxonomy, zero infra imports | **PASS** | `posting-engine.spec.ts` 22 tests (per-step + ordering); depcruise 0 violations |
| 2 | INV-013 idempotency sequential + concurrent → one entry, loser replays | **PASS** | INV-013 test + CC-01 (417 ms 50-race green) |
| 3 | INV-003/011 UPDATE/DELETE rejected at grant+trigger+RLS as erp_app; locked insert blocked | **PASS** | INV-003 (both branches), INV-011 trigger proof |
| 4 | INV-014 mirror/link/at-most-once; typed errors on abuse | **PASS** | INV-014 positive + violation (ALREADY_REVERSED, non-POSTED) |
| 5 | Purpose 1:1 active, fail-closed, zero residue | **PASS** | engine unit (5) unmapped purpose; INV-015 archive guard; golden failure pack |
| 6 | Period semantics OPEN/SOFT_CLOSED/LOCKED; PC-01…04 green | **PASS** | `periods.spec.ts` PC-01/02 + RC-03 lock-blocked + reopen audit |
| 7 | Opening balances once, per-partner rows, Σ = control from #1; stock stays DRAFT | **PASS** | G-16 golden + RC-01/02 |
| 8 | Year-end single idempotent closing entry, unit-reversible, prior-year immutable | **PASS** | G-20 (PC-05/06/07) |
| 9 | Invariant coverage ledger — every INV green or owner-assigned | **PASS** | table above (INV-010/012/016/017/018/019 assigned) |
| 10 | k6 smoke p95 within budget; EXPLAIN index-driven tenant-first | **PASS** | p95 50.3 ms < 500 ms; `gl-perf.db.spec.ts` 3 tests (no seq scans) |
| 11 | Screens on sanctioned archetypes, axe + keyboard, AR+EN baselines; grid Δ matches engine | **PASS** | harness 16 passed, 87 baselines, axe 0; BigInt-exact Σ bar mirrors INV-001 on the same fixtures |
| 12 | Matrix §3.1 on all routes (generated checklist); SoD default; foreign id → 404 | **PASS** | route-permissions + generated A-rows; `SELF_APPROVAL_BLOCKED`; A7 id-probe rows |

## Evidence

- Gate transcript: `pnpm gate:local` → `=== ALL LOCAL GATES GREEN ===` (captured in
  this session's run; the 17-step chain covers typecheck/lint/depcruise/drift/unit/
  db/build/contrast/i18n/catalog/harness+CSP/docs/negatives).
- Posting smoke: `[posting-smoke] n=100 p50=26.1ms p95=50.3ms max=82.1ms failures=0`.
- EXPLAIN: `Index Scan using ix_journal_entries_tenant_source …` (+ register/balance
  assertions; no `Seq Scan on journal_lines|journal_entries`).
- Visual: 87 baselines (14 new accounting pattern AR+EN pairs + overlays re-baselines
  replacing crashed-render captures).
- Config-fuzz corpus: 1 seed corpus (settings/entitlements/policy permutations vs the
  golden dataset) — extendable per phase.

## Known limitations

- `gl-queries.accountMovements.openingBalance` is a fixed `"0"` — full-history from
  entry #1 at this phase (documented in code; period-bound openings arrive with the
  reporting phase's as-of semantics).
- The approvals preview renders the engine-generated spec as formatted JSON — a rich
  preview canvas is PHASE-013 report territory (the spec equality itself is the
  deliverable here and is engine-generated).
- The k6 binary run remains a hosted-runner item (local k6-equivalent recorded;
  follow-up obligation listed in NEXT_ACTION).
- Journal templates ship as a schema + `templateId` pass-through; a template CRUD UI
  was judged beyond the §2.16 screen list (documents-not-postings; no screen listed).

## Deferred work

- Hosted CI green run, compose healthcheck, Testcontainers run, mailpit capture
  (PHASE-001 standing waivers — first infra availability).
- Hosted k6 T-01 smoke (this phase) — local substitute recorded.
- Deferred invariants by owner (INV-010/017/018 → P-010, INV-016/019 → P-008,
  INV-012 → P-009) and G-rows with their modules (ACCOUNTING_TESTS §9 protocol).

## Documentation updated

`IMPLEMENTATION_STATUS.md` (007 → COMPLETE + tag), `CHANGELOG.md`,
`CURRENT_STATE.md`, `NEXT_ACTION.md`, `ENTITY_CATALOG.md`, `TABLES/core-accounting.md`,
`ERD/accounting-core.md`, `COMPONENT_CATALOG.md` (3 pattern rows + hooks table),
`DESIGN_TOKENS.md` (§12 width token), `ACCOUNTING_TESTS.md` (coverage column),
`AUTHORIZATION_MATRIX.md` §3.1, `PHASE-007.md` (status), this report.

## Risks

- RISK-009 (accounting bugs destroy trust): the invariant suite + golden harness are
  now the release-blocking spine; any failure anywhere is Sev-1 per the register
  trigger — no test was deleted or weakened to get green.
- RISK-014 (performance under volume): tenant-first indexes + EXPLAIN assertions +
  posting smoke recorded; CC-03's 50-parallel race leaves statement-timeout headroom.
- No new risks added; no rating changes.

## Rollback instructions

Forward-only per MIGRATION_STRATEGY; posted-entry immutability makes rollback
semantically safe (nothing to un-post). Emergency revert = revert the phase commits
(`git revert` from `phase/007`) + re-run `pnpm gate:local`; the two migrations are
purely additive (drop tables cascade-free in a scratch env if ever needed).

## Next eligible phase

**PHASE-008 — Treasury: Cash, Banking & Expenses** (PHASE-009 — Tax Engine &amp;
Jurisdiction Packs — is the parallel alternative). Prerequisites confirmed: PHASE-007
COMPLETE with this report + green gate. **Do NOT implement here.**
