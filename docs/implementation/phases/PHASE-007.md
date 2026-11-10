# PHASE-007 — Accounting Core & Posting Engine

> **Status:** COMPLETE · **Updated:** 2026-10-30

## 1. Phase Overview

- **Phase ID:** PHASE-007
- **Title:** Accounting Core & Posting Engine
- **Objective:** Deliver the platform's financial heart exactly per
  [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md): the `accounting` module
  with chart-of-accounts posting readiness (purpose mapping, fail-closed), the fiscal
  calendar (years, OPEN/SOFT_CLOSED/LOCKED periods), dated exchange rates, the
  **posting engine** — the only writer of `journal_entries`/`journal_lines`
  ([ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)) with the
  8-step validation pipeline, stable error taxonomy, idempotency on
  `(tenant, source_type, source_id, operation)`, and reversal-only correction — plus
  manual and recurring journals with approval workflows and configurable limits, GL
  queries with drill-down, cost centers, the numbering service, opening-balance
  posting (from PHASE-006 drafts), year-end close, period-lock enforcement, and the
  **initial invariant test suite** mapping INV-xxx to named tests per
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md). This is the most critical
  phase of the platform: everything before it exists to feed it, everything after it
  posts through it.
- **Business value:** The ledger is the product's contract with its users
  (RISK-009): a single, centralized, invariant-enforced posting engine makes the
  books trustworthy, audits meaningful, and every trade module (P-008…P-012) cheap to
  build correctly.

## 2. Scope

In scope:

1. **CoA posting readiness** (tables exist from PHASE-004; the service completes
   here per [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md)): tree
   management (cycle-checked parents, homogeneous types V3), `is_postable` = leaf ∧
   not group (V5), currency restriction (V6/INV-005), archive/delete guards
   (INV-015: postings or children block; required-purpose accounts cannot be archived
   while mapped), code renumbering allowed only before first posting, and
   **`account_purposes` resolution** — exactly 1 active mapping per purpose per
   tenant (V1, partial unique `active_to IS NULL`); the engine fails closed with
   `PURPOSE_NOT_MAPPED`, never posts to a fallback.
2. **Fiscal calendar** (`accounting.fiscal_calendar`): `fiscal_years` +
   `fiscal_periods` per [TABLES/core-accounting.md](../../database/TABLES/core-accounting.md)
   — 12 monthly periods auto-created, no-overlap exclusion constraint, special
   `OPENING`/`CLOSING` periods, states `OPEN → SOFT_CLOSED → LOCKED` with audited
   transitions, soft-close posting path (`accounting.periods.post_to_soft_closed` +
   reason, PC-02), **reopen** (`accounting.periods.reopen` + reason + audit, INV-020,
   anti-fraud alert on > 2-month-old periods), year creation idempotent and
   N+1-while-N-open ([PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) §1/§4).
3. **Currencies & FX**: consume the PHASE-002 `currencies` seed; `exchange_rates`
   (dated, `rate > 0`, base-per-1-foreign per
   [CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md) §5,
   `MANUAL|IMPORTED` source), rate service (dated lookup + manual document-level
   override recorded on the entry), INV-008 storage rules, and the **optional
   unrealized FX revaluation run** (BR-036, `accounting.fx_revaluation_enabled`
   default `false`; dated, self-reversing pair, audited, reversible as a unit — G-19).
4. **Posting engine** — the deliverable, per [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md)
   **exactly**:
   - `PostingEngine.post(spec, ctx)` / `reverse(input, ctx)` / `isDatePostable(date,
     ctx)` service contract with the `JournalSpec`/`JournalLineSpec` types (source
     {docType, docId, operation}, entryDate, currency, rate, lines with
     purpose-or-account, direction, positive `Money` amounts, partnerId/itemId/
     costCenterId/taxCodeId, memo).
   - Validation pipeline 1–8 in order, first failure aborts: (1) idempotency →
     return stored result (INV-013); (2) schema-level (≥2 lines, ≥1 debit, ≥1 credit,
     amounts > 0); (3) currency/FX — rate required and > 0 when ≠ base, base amounts
     computed, **balance must hold in base currency**; (4) period — OPEN only
     (INV-011); (5) account resolution — active mappings, postable active leaves
     (INV-004), currency-compatible (INV-005); (6) subledger consistency — AR/AP
     control lines carry `partnerId` (INV-009), tax lines carry `taxCodeId`;
     (7) balanced — Σdebit = Σcredit in document AND base currency, 0 tolerance
     (INV-001/002; residuals must be explicit lines); (8) write phase — insert
     `POSTED` entry + lines + audit event, update source status/`postedJournalId`,
     write module-owned subledger rows, **one transaction** (§5; partial failure ⇒
     full rollback).
   - **Error taxonomy** verbatim: `ENTRY_NOT_BALANCED`, `PERIOD_LOCKED` /
     `PERIOD_NOT_FOUND`, `ACCOUNT_NOT_POSTABLE` / `ACCOUNT_ARCHIVED`,
     `CURRENCY_MISMATCH`, `PURPOSE_NOT_MAPPED`, `MISSING_PARTNER_ON_CONTROL`,
     `MISSING_FX_RATE`, `ALREADY_POSTED` / `ALREADY_REVERSED`, `INVALID_AMOUNT` —
     typed codes, localized messages, never strings.
   - **Idempotency**: unique index `(tenant_id, source_type, source_id, operation)`
     (`uq_journal_entries_tenant_source_op`, INV-013); concurrent duplicates
     serialize on insert conflict and return the existing entry (CC-01).
   - **Reversal flow** (INV-014): load original (must be POSTED, not already
     reversed), mirror accounts/partners/items/tax codes/amounts with flipped
     directions, new entry date ≤ today in an open period, same-currency rate =
     original rate, link `reversal_of_id`/`reversed_by_id`, original marked
     `REVERSED` (net zero, both visible).
   - **Immutability** (INV-003): append-only grants + guard triggers on
     `journal_entries`/`journal_lines` + balanced-entry trigger (INV-001/002
     double-check) + period-lock trigger double-check on insert (INV-011).
   - Engine has zero infrastructure dependencies (ADR-0007: no HTTP, no queue) —
     unit-testable; entry numbering `JE-{yyyy}-{seq:6}` per-tenant sequence inside
     the transaction (§6); indexes `(tenant_id, entry_date)`,
     `(tenant_id, account_id)` via lines, `(tenant_id, source_type, source_id)`.
   - No direct journal-insert API: even manual journals go through `post()` with
     source `journal_entry` (§7).
5. **Manual journals** (`accounting.journal_entries`, per
   [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §1): draft → submit →
   approve → post lifecycle; bilingual memos; account (leaf)/direction/amount lines
   with optional partner/item/cost-center/tax-code; FX rate from table or recorded
   manual override; drafts editable/deletable before posting (audit-logged);
   **journal templates** (line structure without amounts) as documents, not postings.
6. **Recurring journals** (`accounting.recurring_journals`, JOURNAL_RULES §2):
   definition = template JSONB + schedule + start/end + next-run + amount policy;
   pg-boss job generates **DRAFT entries only** (never auto-posts); skip rules
   (period locked → notification, inactive, end passed); generated entries carry
   `recurrence_id`; edits affect future generations only.
7. **Approval workflow** (`accounting.approvals`, JOURNAL_RULES §3 +
   BR-034): `approval_policies` per doc type — `none | single-approver | two-step |
   amount-threshold` (thresholds compare **total base-currency amount**); SoD —
   creator cannot approve unless `approvals.allow_self_approval = true` (default
   OFF), server-enforced; approver preview generated by **the same engine code that
   will post** (no preview/post divergence); delegation post-MVP only.
8. **GL queries + drill-down** (`accounting.general_ledger`): account balances +
   period movements, journal register data feed (`accounting.journal-register` per
   [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) — engine data ready at this
   phase; statement rendering arrives PHASE-013), line-level drill from account →
   entries → source document (`source_type/source_id` chain, INV-006); filters
   mirror the GL report parameters.
9. **Cost centers** (`accounting.cost_centers`, basic tree): CRUD + dimension on
   journal lines (inactive centers reject new lines).
10. **Numbering service** (BR-029 / INV-021 / [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md)):
    per-(tenant, branch, type) sequences, format templates, assign at
    approval-reserve or posting per `numbering.<doctype>.assign_at` policy,
    immutable once assigned, voided numbers reserved forever (gap documented),
    row-lock/sequence concurrency safety (CC-03), numbering audit view. Consumed by
    document modules from PHASE-008; the journal `entry_no` uses it from day one.
11. **Opening balances posting** (`accounting.opening_balances` post step,
    BR-035): post once through the OPENING period from PHASE-006
    `opening_balance_docs` — partner kinds create per-partner AR/AP subledger rows
    (INV-009 exact from entry #1) and account kinds post declared balances;
    balancing via `OPENING_EQUITY` purpose (G-16 shape); stock drafts remain DRAFT
    (they post in PHASE-010 with the stock ledger). Corrections afterwards are normal
    journals in open periods (BR-035 fixed).
12. **Year-end close** (`accounting.year_end_close`, [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md)
    §3): precondition all periods LOCKED except optional CLOSING; system-generated
    closing entry (source `year_end_close`, one per year, idempotent): DR revenue
    accounts / CR `CLOSING`; DR `CLOSING` / CR expense accounts; net → `CLOSING` ↔
    `RETAINED_EARNINGS`; reversible as a unit only (`year_end_close:reverse`,
    PC-06); prior-year statements immutable (PC-07 discipline begins here).
13. **Reconciliation job framework** (`accounting.reconciliation` jobs — workspace
    ships PHASE-013): pg-boss nightly + on-demand checks per
    [RECONCILIATION.md](../../accounting/RECONCILIATION.md) producing stored
    reconciliation records; at this phase the framework + **AR/AP checks (INV-009)**
    run (RC-01/RC-02 + seeded-drift RC-03); cash (INV-019), VAT (INV-012),
    inventory (INV-010), GRNI checks register as their modules ship; a period
    cannot LOCK with a BROKEN core check (PC-04).
14. **Period close checklist service** ([PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md)
    §2): checklist rendered from live checks (subledgers, unposted drafts listed,
    recurring journals generated-or-skipped, FX revaluation run-or-waived);
    module-owned checks not yet shipped display an explicit "not yet applicable"
    state, never a silent pass.
15. **Invariant test suite — initial coverage** per
    [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §2, mapping every
    covered invariant to its named test file:
    - `invariants/INV-001…009, 011, 013, 014, 015, 020, 021, 022.spec.ts` — each with
      the positive + violation scenario exactly as specified (violation asserts the
      typed error code **and zero residue**). Deferred with owning phase (tracked in
      the coverage checklist): INV-010/017/018 (PHASE-010), INV-016/019 (PHASE-008),
      INV-012 (PHASE-009).
    - **Golden posting harness + the subset executable in this phase**: G-16
      (opening balances), G-20 (year-end close), G-19 (FX revaluation, minimal —
      full open-item fixtures with trade documents land PHASE-012), plus engine-level
      goldens for manual journal post, FX entry, reversal mirror, recurring
      generation, rounding-residual lines. G-01…G-15, G-17, G-18 land with their
      owning modules (P-008/010/011/012/018) per the ACCOUNTING_TESTS §9 maintenance
      protocol — each future phase appends its G-rows in the same PR as its posting
      rules.
    - Property tests (ACCOUNTING_TESTS §4): rounding monotonicity/residual
      conservation, line-net/tax/header conservation, FX base conversion.
    - Concurrency: CC-01 (duplicate post), CC-03 (sequence race, 50 parallel),
      CC-05 (period lock race), CC-06 (reversal vs re-post).
    - Period-close: PC-01…PC-07 (lock enforcement, soft-close discipline, reopen
      audit, checklist gates, year-end correctness/reversibility/prior-year
      immutability).
    - k6 posting smoke from this phase (TEST_STRATEGY §2.7: posting p95 budget).
16. **UI** (on PHASE-005 components; the `JournalEntryGrid` pattern is built here
    per [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) §6.3 — grid semantics,
    live Σdebit/Σcredit/Δ bar, partner-required inline rule mirroring the engine,
    `Ctrl+D`/`Alt+Enter` keyboard model — with its catalog entry + AR+EN baselines):
    CoA tree editor (+ purpose mapping), journal entry workspace (archetype 4 with
    `MoneySummaryBar`), manual/recurring journal lists + editor, **GL browser**
    (account → lines drill-down), period management screens (years, states, close
    checklist, reopen), approval queue (`ApprovalsQueue` pattern), opening balances
    workspace, exchange-rate editor.

Out of scope (explicit):

- Trade/treasury/tax document posting rules (their G-rows): sales/purchasing
  documents (PHASE-011/012), receipts/payments/expenses/transfers (PHASE-008),
  inventory journals + stock opening posting (PHASE-010), production (PHASE-018).
- Financial statement rendering (TB/IS/BS/CF) — the report engine is PHASE-013;
  this phase ships the GL data feeds + drill-down only.
- Tax codes/resolution (PHASE-009; `journal_lines.tax_code_id` column exists, FK
  lands with `tax_codes`); reconciliation workspace UI + VAT/inventory/GRNI checks
  (PHASE-009/010/013).
- Tenant-configurable posting formulas — permanently out
  ([POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §7, directive §1.15) — as
  are "temporary" postings outside open periods (§7).

## 3. Prerequisites

- Required phases: **PHASE-006 COMPLETE** — consumed artifacts: partners/items
  tables (FK targets for `journal_lines.partner_id/item_id`), opening-balance drafts
  (input to the opening posting), design-system components for all screens. Verified
  via completion report + green CI + IMPLEMENTATION_STATUS row. (PHASE-004's
  instantiated CoA + purposes are the resolution substrate; PHASE-002's
  audit/RLS/job infra is assumed operational.)
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (the
  engine is the only GL writer; JournalSpec; idempotency keys; no configurable
  posting), [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)
  (NUMERIC(19,4)/decimal.js/strings; rounding points),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (entry numbers +
  sequences), [ADR-0004](../../architecture/ADR/ADR-0004-postgresql-drizzle.md),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (recurring +
  reconciliation jobs), [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md)
  (RLS on every new table).
- Relevant documentation: [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md)
  (normative contract), [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-001…INV-022), [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md),
  [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md),
  [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) (state machine +
  status vocabulary), [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md),
  [RECONCILIATION.md](../../accounting/RECONCILIATION.md),
  [ACCOUNTING_PRINCIPLES.md](../../accounting/ACCOUNTING_PRINCIPLES.md),
  [CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md),
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (the test bible),
  [TEST_STRATEGY.md](../../testing/TEST_STRATEGY.md) (non-negotiables §3),
  [TABLES/core-accounting.md](../../database/TABLES/core-accounting.md),
  [ERD/accounting-core.md](../../database/ERD/accounting-core.md),
  [CONSTRAINTS_AND_INDEXES.md](../../database/CONSTRAINTS_AND_INDEXES.md),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.1,
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §accounting,
  [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) (L10 policy
  layer), [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) archetypes 2/4,
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) §6.3.

## 4. Design Impact

- **Database changes:** new tables `fiscal_years`, `fiscal_periods`, `exchange_rates`,
  `journal_entries` (append-only 🔒, `uq_journal_entries_tenant_source_op` INV-013,
  `entry_no` unique per tenant), `journal_lines` (append-only 🔒, balanced-entry +
  immutability + lock triggers), `cost_centers`, `recurring_journals`,
  `approval_policies`, plus a numbering sequences store (per ADR-0006 — sequence
  table with row locks). `accounts`/`account_purposes` gain posting-readiness
  enforcement (V-rules as check constraints + service guards). Partner subledger
  rows are written by the `partners` module api (module-owned, same transaction —
  MODULE_BOUNDARIES write matrix). All tables RLS'd + composite-FK'd + cataloged
  in-phase.
- **API changes:** `/api/v1/accounting/accounts[/{id}]` (+ purposes subresource),
  `/fiscal-years[/{id}/periods[/{id}/soft-close|/lock|/reopen]]`,
  `/exchange-rates`, `/journal-entries` (draft CRUD, `/submit`, `/approve`, `/post`,
  `/reverse`), `/recurring-journals`, `/approval-policies`, `/cost-centers`,
  `/gl/accounts/{id}/movements`, `/gl/journal-register`, `/opening-balances/{id}/post`,
  `/year-end-close` — action endpoints POST with `Idempotency-Key`; every mutation
  permission-gated per matrix §3.1; 404 on foreign ids (A7); `409 IMMUTABLE_DOCUMENT`
  on posted entries.
- **UI changes:** the accounting navigation group (المحاسبة) goes live: CoA tree
  editor, journal workspace (archetype 4 with `JournalEntryGrid` + `MoneySummaryBar`),
  journal lists (archetype 2), GL browser (drill-down), period management screens,
  approvals queue, opening balances workspace, rate editor. `JournalEntryGrid` +
  `ApprovalsQueue` + `MoneySummaryBar` patterns enter `packages/ui` with catalog
  entries and AR+EN baselines.
- **Security & authorization:** the full `accounting.*` permission set activates
  (§3.1): risky keys (`journal_entries.approve/post/reverse`, `periods.lock/reopen`,
  `periods.post_to_soft_closed`, `accounts.archive`, `opening_balances.post`,
  `year_end_close.execute`) are approval-separated, audited on use, and SoD-guarded
  (creator ≠ approver default). API spoof scenarios per SECURITY_TEST_PLAN §2
  PHASE-007 row: journal `accountId` from another tenant → **404 not 403**;
  foreign period/fiscal-year ids → 404; matrix-driven checklist extended to all new
  routes.
- **Accounting implications:** this phase *is* them — INV-001…INV-009, INV-011,
  INV-013, INV-014, INV-015, INV-020, INV-021 gain enforcement + tests; INV-022
  (config cannot override) gains its `config-fuzz.spec` seed here (fuzz layer/
  entitlement/policy permutations against posting attempts) which every later phase
  extends. Deferred invariants are tracked by owner (see §2.15).
- **Localization implications:** bilingual account/cost-center names (display-first
  AR), bilingual journal memos (`description` per dictionary §10), localized error
  messages for the taxonomy (code stable, message per `Accept-Language`), Hijri
  display in period/date pickers (fiscal dates stay Gregorian — A-004), AR+EN
  baselines for every new screen.
- **Offline implications:** per [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  rows 15–18: manual journal entry, approvals, posting, period close are
  **ONLINE-ONLY** (engine-only writer, official numbers + ledger server-side);
  the matrix rows are enforced as route policy now and tested.
- **Module dependencies:** `accounting` → `tenancy` (context only) per
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2 rule 2 — the
  engine imports no other module; `partners` exposes the subledger-write api the
  opening posting calls (same transaction); everything after this phase calls the
  engine. No cross-module table writes beyond the sanctioned matrix.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0007_accounting_core.sql`: fiscal years/periods (exclusion constraint), exchange_rates, cost_centers, recurring_journals, approval_policies, numbering store + RLS/composite FKs/indexes | `apps/api/migrations/0007_accounting_core.sql` | migration fresh+regression; RLS catalog; A1–A10 suite on new tables |
| T2 | Migration `0008_journal_tables.sql`: journal_entries/lines (append-only grants), unique `(tenant,source_type,source_id,operation)`, guard + balance + lock triggers, hot indexes | `apps/api/migrations/0008_journal_tables.sql`, trigger SQL | INV-003/011 trigger tests (direct UPDATE/DELETE/insert-into-locked rejected as `erp_app`) |
| T3 | CoA readiness service: tree rules V1–V6, purpose resolution (1 active per purpose), archive guards | `apps/api/src/modules/accounting/application/coa-service.ts` | INV-015 guards; V-rule unit tests; `PURPOSE_NOT_MAPPED` fail-closed proof |
| T4 | Fiscal calendar service: years, period generation, state transitions, reopen + anti-fraud alert | `apps/api/src/modules/accounting/application/period-service.ts` | PC-01/02/03; idempotent year creation; N+1-while-N-open |
| T5 | Exchange-rate service + manual override recording | `apps/api/src/modules/accounting/application/fx-service.ts` | INV-008 storage tests; dated lookup boundaries |
| T6 | **Posting engine domain service** (pure): JournalSpec validation pipeline 1–8, error taxonomy, result contract | `apps/api/src/modules/accounting/domain/posting-engine/*` | full engine unit suite: each validation step positive+negative; pipeline ordering (first-failure aborts); zero-residue asserts |
| T7 | Engine infrastructure wiring: transaction orchestration, entry numbering `JE-{yyyy}-{seq:6}`, idempotent insert-conflict path, subledger/partners + audit calls | `apps/api/src/modules/accounting/application/posting-service.ts`, `infrastructure/*` | CC-01 duplicate post (sequential + concurrent); CC-03 numbering race; CC-05 lock race; CC-06 reversal-vs-repost |
| T8 | Reversal service | `apps/api/src/modules/accounting/application/reversal-service.ts` | INV-014 mirror/link/once (reverse-twice → `ALREADY_REVERSED`; non-POSTED → error) |
| T9 | Manual journals: draft/submit/approve/post lifecycle + templates | `apps/api/src/modules/accounting/application/journal-service.ts` | JOURNAL_RULES §1 constraints; SoD default-OFF proof; preview-equals-posting |
| T10 | Recurring journals: definitions + pg-boss draft generation (never posts) | `apps/api/src/modules/accounting/application/recurring-service.ts`, `infra/jobs/*` | generated entries are DRAFTs with `recurrence_id`; skip rules; INV-013 idempotency per run |
| T11 | Approval policies service (thresholds in base currency, two-step) | `apps/api/src/modules/accounting/application/approval-service.ts` | BR-034 threshold boundary (at-limit pass, +0.01 fail `APPROVAL_LIMIT_EXCEEDED`); self-approval blocked/flagged |
| T12 | GL query services + journal-register feed + drill-down | `apps/api/src/modules/accounting/application/gl-queries.ts` | drill chain asserts INV-006 both directions; filters mirror report params; EXPLAIN checks |
| T13 | Numbering service (per-tenant/branch/type, reserve/assign/void) | `apps/api/src/modules/accounting/application/numbering-service.ts` | INV-021 uniqueness + void-reserved; CC-03 race |
| T14 | Opening balances posting (partner + account kinds) via partners subledger api | `apps/api/src/modules/accounting/application/opening-balances-service.ts`, `partners/application/subledger-service.ts` | G-16 golden (per-partner rows, `OPENING_EQUITY` balance, INV-009 from entry #1); BR-035 once-only |
| T15 | Year-end close + revaluation run services | `apps/api/src/modules/accounting/application/year-end-service.ts`, `fx-revaluation-service.ts` | PC-05 (10,000/7,500/2,500 fixture), PC-06 reversibility, PC-07 prior-year immutability; G-19 minimal |
| T16 | Reconciliation job framework + AR/AP checks (INV-009) + close checklist service | `apps/api/src/modules/accounting/application/reconciliation/*`, `close-checklist-service.ts` | RC-01/RC-02 + RC-03 seeded drift (`BROKEN` + notification); PC-04 lock blocked while BROKEN |
| T17 | **Invariant + golden + property + concurrency + period suites** (§2.15) | `tests/accounting/invariants/INV-*.spec.ts`, `tests/accounting/golden/*`, `tests/accounting/property/*`, `tests/accounting/concurrency/*`, `tests/accounting/periods/*`, `k6/posting-smoke.ts` | every listed test green in CI (blocking); k6 posting p95 within budget; invariant coverage checklist query |
| T18 | UI screens + `JournalEntryGrid`/`ApprovalsQueue`/`MoneySummaryBar` patterns + baselines | `apps/web/src/app/(app)/accounting/**`, `packages/ui/src/patterns/*` | AR+EN baselines; axe + keyboard (grid model §6.3); live-balance bar mirrors INV-001 |
| T19 | Docs sync: catalog/TABLES/ERD, invariant coverage table, G-row ownership ledger | `docs/database/**`, `docs/testing/ACCOUNTING_TESTS.md` (coverage column only if changed), `docs/accounting/**` | docs validation + drift checks green |

## 6. Verification

**Automated tests (required):** the §2.15 suites are the contract —
`invariants/INV-001…009,011,013,014,015,020,021,022.spec.ts` with positive +
violation (typed code + zero residue) each; golden harness + G-16/G-20 (+G-19
minimal, engine-level goldens); property tests (rounding, conservation, FX);
concurrency CC-01/CC-03/CC-05/CC-06; period-close PC-01…PC-07; reconciliation
RC-01/RC-02/RC-03; isolation A1–A10 on all new tables + A7 on every route +
accountId/period spoof rows; permission checklist for the whole §3.1 set incl. SoD
scenarios; config-fuzz seed (INV-022): flip entitlements/policies/numbering config
against a golden dataset → byte-identical journals; k6 posting smoke (p95 budget per
[PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md) T-01 smoke tier).
Failure packs mandatory on every golden: locked period, unmapped purpose, unbalanced
spec, already-posted — all zero-residue (ACCOUNTING_TESTS §3).

**Manual verification:**

1. Post a manual journal through the workspace AR: grid Σ bar hits 0.00 → Post →
   entry appears POSTED with `JE-` number; attempt an edit → impossible (UI + API +
   SQL triple proof).
2. Reverse it with a reason → counter-entry mirrors every line; original shows
   REVERSED; drill-down from the GL account lands on both.
3. Lock the period → post a dated twin → `PERIOD_LOCKED`; reopen with permission +
   reason → audit event + (old period) anti-fraud alert; re-close.
4. Unmap `VAT_PAYABLE` (edit a purpose) → any spec requiring it fails closed
   `PURPOSE_NOT_MAPPED` — no fallback posting, ever.
5. Post opening balances from the PHASE-006 drafts → per-partner subledger rows
   exist; reconciliation job → `OK`; delete a subledger row via test tooling → job
   reports `BROKEN` with the diff; restore.
6. Run year-end close on the seeded fixture year → closing entry matches PC-05
   numbers; reverse + regenerate → idempotent, statements unchanged.

**Acceptance criteria (objective):**

1. The posting engine implements the POSTING_ENGINE.md validation pipeline 1–8 in
   order with the exact error-taxonomy codes; pipeline-order tests prove first-
   failure abort; the engine package has zero infrastructure imports (lint).
2. INV-013 idempotency: sequential retry and concurrent duplicate post of the same
   `(tenant, source_type, source_id, operation)` produce exactly one entry and the
   loser returns the stored result (CC-01 green).
3. INV-003/011: UPDATE/DELETE on posted entries/lines is rejected at grant, trigger,
   and RLS layers; direct insert into a locked period is blocked by the trigger;
   all proven as `erp_app`.
4. INV-014: reversal mirrors accounts/partners/items/tax codes/amounts, links
   bidirectionally, and is at-most-once; reversing a reversal or a non-POSTED entry
   errors typed.
5. Purpose resolution is 1:1 active per purpose and fail-closed: with any required
   purpose unmapped, dependent specs return `PURPOSE_NOT_MAPPED` with zero residue.
6. Fiscal periods enforce OPEN/SOFT_CLOSED/LOCKED semantics: soft-close posting
   requires permission + reason; reopen requires permission + reason + audit with
   the >2-month alert; period LOCK is blocked while a core reconciliation is BROKEN
   (PC-01…PC-04 green).
7. Opening balances post once through the OPENING period creating per-partner
   subledger rows; Σ partner subledger = AR/AP control exactly from entry #1
   (RC-01/RC-02 green; G-16 golden green); stock drafts remain DRAFT.
8. Year-end close generates the single idempotent closing entry per year, reversible
   as a unit, prior-year history unchanged (PC-05/06/07 green).
9. The invariant coverage checklist shows every INV-001…022 row either green-tested
   in this phase or explicitly assigned to its owning later phase (INV-010/016/017/
   018/019/012) — no invariant is silently uncovered; every green row has positive +
   violation tests.
10. k6 posting smoke meets its p95 budget; the top GL/journal queries are
    index-driven with tenant-first plans (EXPLAIN assertions in CI).
11. Every accounting screen instantiates a sanctioned archetype, passes axe +
    keyboard journeys, and has AR+EN baselines; `JournalEntryGrid`'s live Δ bar
    matches the engine's balance verdict on the same fixtures.
12. All new routes enforce matrix §3.1 permissions (generated checklist green);
    SoD blocks creator-approval by default; foreign accountId/periodId → 404 (A7).

**Performance & security considerations:** engine writes serialize per tenant by
design (ADR-0007 consequence) — measured, not assumed, via k6 smoke; sequence
contention is per-tenant only; statement timeouts leave headroom for CC-03's
50-parallel race; no dynamic SQL; risky permissions audited in-transaction; audit
events never carry secrets; RLS denial counter canary still green.

**Migration & rollback:** additive migrations `0007`–`0008` (+ trigger functions);
no destructive change; posted-entry immutability makes rollback semantics trivially
safe (there is nothing to un-post). Forward-only per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md); expand-migrate-
contract applies to `journal_lines.tax_code_id` (FK lands PHASE-009).

## 7. Risks and Constraints

- RISK-009 (accounting bugs destroy trust) — *the* risk of this phase: the invariant
  suite + golden harness are the deliverable; ANY invariant failure in any environment
  is a release-blocking Sev-1 (register trigger); no failing test may be deleted to
  get green (TEST_STRATEGY §7).
- RISK-014 (performance under real volumes): tenant-first indexes + EXPLAIN
  assertions + k6 smoke from day one; query review is part of the code-review
  template.
- RISK-012 (Drizzle friction) first real contact with triggers/exclusion
  constraints: hand-written SQL migrations are expected (MIGRATION_STRATEGY §2.2);
  record raw-SQL usage in the report.
- Preview/post divergence (BR-034): the approver preview MUST call the same engine
  code path — enforced by a test that posts the previewed spec byte-for-byte.
- Constraint: no trade/treasury/tax posting rules sneak in early — G-rows land with
  their modules; a new posting rule without its golden test cannot merge
  (ACCOUNTING_TESTS §9.1).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-007-COMPLETION.md` with: full invariant
  suite output (per INV file), golden outputs incl. G-16/G-20 line-by-line expected-
  vs-actual, concurrency + period + reconciliation results, k6 smoke report, EXPLAIN
  outputs, isolation + permission checklist results, config-fuzz corpus summary,
  screen baseline inventory, and the **invariant coverage ledger** (which INV-xxx
  gained coverage here; which are assigned to P-008/009/010).
- **Documentation updates required:** [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-007 → COMPLETE + tag), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + TABLES + ERD sync,
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) (new patterns),
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) coverage annotations if
  test names shifted, and the G-row ownership ledger appended to the phase report.
  Acceptance criteria copied into `planning/PHASE_ACCEPTANCE_CRITERIA.md` (planned
  file — see PHASE-003 note).
- **Exit criteria:** all 12 acceptance criteria green with evidence; the engine +
  invariants + golden suites are wired as blocking CI checks; a clean-clone
  demo tenant can: set up CoA → open year → post manual + opening + recurring
  journals → GL drill-down → close period → year-end — all in AR and EN.
- **Definition of Done:** the ledger is alive and provably correct: every posting
  flows through one invariant-enforced engine with idempotency, reversal-only
  correction, and a test suite that makes regression visible to the commit that
  causes it.
- **Handoff instructions:** read the PHASE-007 completion report + the invariant
  coverage ledger first. PHASE-008 (treasury) and PHASE-009 (tax) both depend only
  on this phase and may run in either order (parallel for human teams —
  [PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md) §parallelism;
  agents still execute one phase at a time). Both consume the engine contract, the
  purpose map, the numbering service, period checks, and the G-row protocol. **Next
  eligible phase: PHASE-008 — Treasury: Cash, Banking & Expenses** (identify only;
  do not implement; PHASE-009 — Tax Engine & Jurisdiction Packs — is the parallel
  alternative).
