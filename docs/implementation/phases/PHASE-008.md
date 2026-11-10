# PHASE-008 — Treasury: Cash, Banking & Expenses

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-008
- **Title:** Treasury: Cash, Banking & Expenses
- **Objective:** Deliver the `treasury` module: cash/bank/petty accounts linked to the
  CoA (each account IS a GL account), receipts and disbursements with partner
  allocations (including settlement of partner opening balances), petty cash with
  limits, account↔account transfers with bank charges, expense categories and claims
  with approval policies, cashier shifts with variance posting, bank statement import
  (CSV/XLSX format adapters) + matching + bank reconciliation per
  [RECONCILIATION.md](../../accounting/RECONCILIATION.md) §4, and realized FX
  difference posting at settlement — every money movement posting through the
  PHASE-007 engine using the canonical rules of [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md)
  §4, with treasury↔GL internal consistency (INV-019) continuously verified.
- **Business value:** Cash is the daily heartbeat of MENA small business ("أين ذهب
  النقد؟"): receipts, expenses, and bank reconciliation are the most-used back-office
  surfaces, partner opening balances become settleable on day one, and INV-019 makes
  every cash account self-proving against its movements.

## 2. Scope

In scope:

1. **Cash/bank/petty accounts** (`treasury.accounts`): `cash_accounts` table (type
   `CASH | BANK | PETTY`, `account_id` → CoA account — currency-restricted or free,
   optional `branch_id`, currency, status) with open/close lifecycle
   (`treasury.accounts.manage`, audited); opening an account requires an existing
   mapped GL account; closing blocks new documents and preserves history. Each
   account's ledger **is** its movements (INV-019: balance = Σ `cash_movements`).
2. **`cash_movements`**: immutable IN/OUT rows (amount, source_type/source_id,
   value_date) written only by treasury services inside the same transaction as their
   journal posting (INV-019's substrate).
3. **Receipts & disbursements** (`treasury.receipts_disbursements`): `receipts`
   (money-in: partner or on-account, method CASH/BANK/…, currency + rate, value date)
   and `payments` (money-out: partner/supplier or payee) with the
   DRAFT → POSTED lifecycle ([DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
   §3: no approval by default; policy may add). **Partner allocations** to open items
   (AR/AP subledger rows — at this phase, the partner opening-balance items posted in
   PHASE-007): FIFO suggestion by default, manual override before posting, partial
   allocations, unallocated remainders as explicit **on-account** open items (BR-027),
   `allocated ≤ amount` and `document allocated ≤ total` enforced (INV-016).
4. **Petty cash** (`treasury.petty_cash`, BR-020): fund with its own PETTY account,
   per-transaction and fund-balance caps (`treasury.petty_cash.single_tx_limit` /
   `max_balance` — PLACEHOLDER defaults pending the OQ-002 pricing pass, documented),
   reimbursement cycle (transfer into the fund), accountant override with audit.
5. **Transfers with bank charges** (`treasury.cash_transfers`, G-12): DRAFT → POSTED;
   DR destination A−F · DR `BANK_CHARGES` F · CR source A (fees post to the
   `BANK_CHARGES` purpose); two cash movements; INV-019 holds on both sides.
6. **Expenses** (`treasury.expenses` + `treasury.expense_categories`, BR-023):
   bilingual categories mapped to expense accounts with per-category approval policy;
   claims with receipt attachments (files module), amount + optional recoverable tax
   (tax-code FK arrives PHASE-009 — the field is reserved here), DRAFT →
   PENDING_APPROVAL → APPROVED → POSTED lifecycle; payout posting DR expense (+ VAT
   recoverable where eligible, from PHASE-009) · CR cash/bank/petty (G-11);
   receipt-required threshold `treasury.expense_receipt_threshold = 0` default.
7. **Cashier shifts** (`treasury.cashier_shifts`, BR-021): opening float, sales
   capture feed (real POS integration is PHASE-016; this phase ships the shift model
   + manual/tellering flows), closing count, difference handling — within tolerance:
   auto-post DR cash-difference expense · CR cash account with the shift as source;
   above tolerance: supervisor PIN + reason required before close (policy
   `treasury.shift_variance_tolerance = 0`, `shift_auto_post_small_variance = true`);
   every variance audited.
8. **Bank statement import + matching + reconciliation** (`treasury.bank_reconciliation`,
   [RECONCILIATION.md](../../accounting/RECONCILIATION.md) §4, BR-022 fixed):
   `bank_statements` + `bank_statement_lines`; import via CSV/XLSX with per-bank
   **format adapters** (pluggable parser registry + a generic column-mapping adapter);
   auto-match (amount + date window + reference), manual match remainder, unmatched
   aging on both sides, per-account per-period reconcile state that **locks the
   statement period for that account**; no "tolerance" absorption — every unmatched
   item stays listed and explainable.
9. **FX difference posting on settlement** (JOURNAL_RULES §4.2, G-06): realized
   differences post automatically when a receipt/payment settles an open item whose
   stored rate differs from the settlement rate — DR/CR cash at current rate, DR/CR
   control at the **original stored rate** (INV-008), explicit `FX_GAIN`/`FX_LOSS`
   residual line with partner + original document references; never dropped.
   **Unrealized revaluation is out** — the optional run already exists in accounting
   (PHASE-007) and is not extended here.
10. **Treasury↔GL reconciliation checks (INV-019)**: register the cash check in the
    PHASE-007 reconciliation job framework — every cash/bank account balance = Σ its
    movements across receipts/payments/transfers/fees/shift variances (RC-08), with
    seeded-drift detection (`BROKEN` + diff row + notification + period-close block).
11. **Posting rules implemented** (POSTING_ENGINE §4 rows owned by treasury, each via
    `PostingEngine.post` with its source/operation keys and INV-013 idempotency):
    receipt (G-05; FX variant G-06 + loss mirror), payment (G-10; FX mirrors G-06),
    expense (G-11), transfer (G-12). Bank-rec has no journal of its own (matching is
    informational; statement lines are not ledger entries).
12. **UI per archetypes** ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)): List+
    Search (receipts, payments, expenses, transfers, shifts, statements), Create/Edit
    + Transaction workspace (receipt/payment with allocation panel + `MoneySummaryBar`),
    bank-reconciliation workspace (import wizard → match grid → unmatched aging →
    lock), cash-account management, petty-cash fund view, shift close panel
    (`ShiftPanel` pattern + catalog entry + AR+EN baselines).
13. **Attack + rule tests**: new tables in the isolation registry; API spoof rows per
    [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 PHASE-008
    (receipt referencing a foreign partner/open-item id; allocations to foreign
    documents → 404/rejection, zero partial creation); treasury rule tests
    (`treasury-rules.spec`: BR-020…BR-023 defaults per [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md)
    §8 matrix).

Out of scope (explicit):

- Cheque status lifecycle (`treasury.cheques`, BR-024): FEATURE_CATALOG catalogs it
  at PHASE-008, but this phase document (authoritative per the roadmap reading rule)
  defers the full cheque lifecycle to PHASE-012 where sales/AP payment methods and
  document chains exist — flagged as a doc-sync note for the catalog.
  (Blueprint v2.0 reconciliation: the cheque/notes lifecycle is delivered in
  PHASE-027 via the `notes` module —
  [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-03.)
- POS-grade shift UX, terminals, offline shift events (PHASE-016); FX revaluation run
  (exists in PHASE-007); supplier-invoice/AR-invoice allocation (those documents land
  PHASE-011/012 — allocations here cover partner open items that already exist).
- Payment-provider integrations, bank API connections (statement import is
  file-based only), e-invoicing (PHASE-023).
- VAT recoverable computation on expenses (PHASE-009 wires the tax-code FK + GL
  effect; the expense table reserves the field).

## 3. Prerequisites

- Required phases: **PHASE-007 COMPLETE** — consumed artifacts: the posting engine
  contract (`post`/`reverse`, error taxonomy, idempotency), purpose mapping
  (`CASH`, `PETTY_CASH`, `BANK_CHARGES`, `FX_GAIN`, `FX_LOSS`, `AR_CONTROL`,
  `AP_CONTROL`), fiscal periods + period checks, numbering service (receipt/payment
  numbers), the reconciliation job framework (register the INV-019 check), approval
  policy service, GL drill-down. Verified via completion report + green CI +
  IMPLEMENTATION_STATUS row. Also consumed from earlier phases: partner open items
  (PHASE-006 drafts → PHASE-007 posting), files module (receipt attachments),
  design system (all screens).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (treasury
  never writes GL tables; JournalSpec only),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (amounts/rates as
  decimals; FX residual lines explicit),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (official receipt/
  payment numbers via the numbering service),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (statement-import parse
  jobs, reconciliation checks),
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (RLS on new tables).
- Relevant documentation: [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md)
  §4 (receipt/payment/expense/transfer rows), [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-016, INV-019, INV-008/009 context), [RECONCILIATION.md](../../accounting/RECONCILIATION.md)
  §1 row 5–6 + §4, [RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
  (allocations, on-account, open items), [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md)
  §4 (realized FX at settlement; unrealized deferred),
  [CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md) §4–5
  (FX residual cases), [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
  §3 (receipt/payment/expense/cash-transfer variations),
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (G-05/06/10/11/12,
  INV-016/019 suites, RC-08, CC-02), [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md)
  §4 (BR-020…BR-024) + §6 (BR-029 numbering), [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)
  §treasury, [ERD/treasury-tax.md](../../database/ERD/treasury-tax.md),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.4,
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2,
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md).

## 4. Design Impact

- **Database changes:** new tenant-owned tables `cash_accounts`, `cash_movements`
  (append-only 🔒 — written only by treasury services), `expenses`,
  `expense_categories`, `cash_transfers`, `cashier_shifts`, `bank_statements`,
  `bank_statement_lines`; `receipts`/`payments` tables (generic treasury documents —
  AP/AR-specific allocation columns extend in PHASE-011/012). All RLS'd + composite
  tenant FKs + cataloged in-phase; the treasury TABLES spec section is authored here
  (the ERD references `TABLES/treasury-tax.md`, which this phase creates per the
  catalog's grow-per-phase rule).
- **API changes:** `/api/v1/treasury/cash-accounts[/{id}]`, `/receipts[/{id}/post|
  /reverse|/allocations]`, `/payments[...]`, `/expenses[/{id}/submit|/approve|/post]`,
  `/expense-categories`, `/cash-transfers[/{id}/post]`, `/shifts[/{id}/close]`,
  `/bank-statements[/{id}/lines|/match|/reconcile]`, `/import-adapters` — all per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) (POST actions with
  `Idempotency-Key`, 409 `IMMUTABLE_DOCUMENT` on posted docs, 404 on foreign ids).
- **UI changes:** the الخزينة / Treasury navigation group goes live with List+Search,
  Create/Edit, Transaction-workspace (receipt/payment + allocations), Wizard (bank
  statement import), and a bank-rec match workspace; `ShiftPanel` pattern enters
  `packages/ui` with catalog entry + baselines.
- **Security & authorization:** the §3.4 permission set activates: risky keys
  (`sales.receipts.approve`, `purchasing.payments.approve`,
  `treasury.expenses.approve`, `treasury.transfers.approve`) are approval-separated +
  audited with SoD default; `treasury.bank_reconciliation.manage` locks periods;
  branch scoping applies to receipts/payments/expenses/shifts per matrix §5. New
  spoof rows: foreign partner/open-item/`cash_account_id` references rejected with
  zero partial creation; allocation to foreign documents impossible (A7 + S-04).
- **Accounting implications:** gains INV-016 + INV-019 enforcement and tests;
  golden G-05, G-06 (+ loss mirror), G-10, G-11, G-12 with mandatory failure packs
  (locked period, unmapped purpose, unbalanced, already-posted — zero residue);
  realized FX differences become automatic (JOURNAL_RULES §4.2); the reconciliation
  framework gains the INV-019 check (RC-08 + drift); period-close checklist gains the
  bank-rec check for bank/cash accounts ([PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md)
  §2 item 3).
- **Localization implications:** bilingual expense categories + shift/payment
  reasons; statement-import adapters handle Arabic bank exports (CSV BOM, XLSX,
  Arabic column headers via mapping); money rendering via MoneyInput/finance sign
  tokens; AR+EN baselines for every screen.
- **Offline implications:** per [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  rows 25/34: expense entry and cash transfers are OFFLINE-DRAFT from PHASE-021/022 —
  nothing offline ships here, but the document shapes (DRAFT-first, server-owned
  posting) keep those rows implementable without redesign.
- **Module dependencies:** `treasury` → `accounting` (posting engine, periods,
  numbering) + `partners` (open items, subledger writes via its api) per
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2; `files` for
  attachments; no module writes `cash_movements` except treasury services
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) write matrix).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0009_treasury.sql`: 10 tables + RLS/composite FKs/indexes + `cash_movements` append-only grants | `apps/api/migrations/0009_treasury.sql` | migration fresh+regression; RLS catalog; A1–A10 suite on all new tables |
| T2 | Cash-account service (open/close, purpose-linked, currency rules) + balance read model (Σ movements) | `apps/api/src/modules/treasury/application/account-service.ts` | open requires mapped GL account; close preserves history; balance = Σ movements fixture |
| T3 | Receipt/payment services: DRAFT→POSTED, methods, FX rate capture, numbering via PHASE-007 service | `apps/api/src/modules/treasury/application/receipt-service.ts`, `payment-service.ts` | G-05 golden (+failure pack); official numbers assigned at posting (INV-021) |
| T4 | Allocation service: FIFO suggestion, partial, on-account remainders, bounds | `apps/api/src/modules/treasury/application/allocation-service.ts` | INV-016 suite (500-on-300 rejected; over-invoice rejected; both sides unchanged); BR-027 on-account rows; CC-02 concurrent allocations |
| T5 | Realized FX difference posting at settlement | `apps/api/src/modules/treasury/application/fx-settlement.ts` | G-06 golden (gain 3.75→3.76) + loss mirror (3.74); original stored rate honored (INV-008) |
| T6 | Petty cash: fund, caps, reimbursement cycle, overrides | `apps/api/src/modules/treasury/application/petty-cash-service.ts` | BR-020: cap exceed → reimbursement/override path; PLACEHOLDER defaults documented |
| T7 | Transfer service with bank charges | `apps/api/src/modules/treasury/application/transfer-service.ts` | G-12 golden; INV-019 both sides; DRAFT→POSTED only |
| T8 | Expense categories + claims + approval flow + attachments | `apps/api/src/modules/treasury/application/expense-service.ts` | BR-023 (threshold 0 = receipts always); G-11 golden (VAT line reserved); lifecycle states |
| T9 | Cashier shifts: open/float/close/count/variance | `apps/api/src/modules/treasury/application/shift-service.ts` | BR-021 worked example (1,377.50 vs 1,380 → −2.50 posts with shift source); above-tolerance needs PIN+reason |
| T10 | Bank statement import: adapter registry, CSV/XLSX parsers, bounded jobs; statement lines | `apps/api/src/modules/treasury/infrastructure/bank-adapters/*`, `application/statement-import-service.ts` | import idempotent per file hash; row caps (U-07 pattern); Arabic-header mapping fixtures |
| T11 | Matching + reconciliation workspace service: auto-match rules, manual match, unmatched aging, period lock | `apps/api/src/modules/treasury/application/bank-rec-service.ts` | BR-022: lock per account+period; no tolerance absorption; drift test (movement without statement match stays listed, not netted) |
| T12 | Register INV-019 reconciliation check + period-close bank-rec check | `apps/api/src/modules/accounting/application/reconciliation/*` (registration), `treasury/**` | RC-08 green; seeded drift → `BROKEN` + notification + close blocked (PC-04) |
| T13 | Golden + invariant + rule suites | `tests/accounting/golden/G-05*,G-06*,G-10,G-11,G-12*`, `tests/accounting/invariants/INV-016*,INV-019*`, `tests/treasury/treasury-rules.spec.ts` | all green (blocking); failure packs zero-residue |
| T14 | UI screens + `ShiftPanel` pattern + baselines | `apps/web/src/app/(app)/treasury/**`, `packages/ui/src/patterns/shift-panel/*` | AR+EN baselines; axe + keyboard; allocation panel live totals |
| T15 | Attack registration + docs sync | `tests/isolation/**`, `docs/database/**`, `docs/product/FEATURE_CATALOG.md` (cheques deferral note) | isolation + permission checklists green; docs validation green |

## 6. Verification

**Automated tests (required):**

- Golden posting tests with **expected journal lines + subledger + movement effects**:
  G-05 (receipt, base currency: DR CASH A · CR AR_CONTROL A with partner), G-06 (FX
  receipt: DR CASH A×r₁ · CR AR_CONTROL A×r₀ · CR FX_GAIN residual — plus the loss
  mirror), G-10 (payment, FX mirrors G-06), G-11 (expense: DR EXPENSE · [VAT line
  reserved] · CR CASH/PETTY), G-12 (transfer with fee F). Every golden also asserts
  the source document state (`POSTED`, `postedJournalId`), official number
  assignment, and an audit event (ACCOUNTING_TESTS §1 conventions).
- Failure packs per golden: `PERIOD_LOCKED`, `PURPOSE_NOT_MAPPED` (unmap CASH /
  BANK_CHARGES / FX_GAIN), `ENTRY_NOT_BALANCED`, `ALREADY_POSTED`, and treasury
  specifics: allocation > receipt amount (INV-016 rejection), closed account target,
  zero/negative amount (`INVALID_AMOUNT`) — each with zero ledger/movement/subledger
  residue.
- INV-016 suite: over-allocation on receipt and on open item rejected; partial
  allocation bookkeeping exact; on-account remainder is an open item (BR-027);
  CC-02 concurrent allocations to one open item never exceed it.
- INV-019 suite + RC-08: after each operation set (receipts, payments, transfers
  with fees, expenses, shift variance), every cash/bank balance = Σ movements;
  seeded drift (movement row without ledger effect) → `BROKEN` with the offending id.
- Bank rec: auto-match correctness (amount+window+reference), manual match, unmatched
  aging, period lock per account; a statement line never becomes a ledger entry;
  import idempotency; adapter mapping fixtures (incl. Arabic headers).
- Rule tests: BR-020 caps + override, BR-021 tolerance + PIN + auto-post small
  variance, BR-022 fixed lock semantics, BR-023 receipt threshold + per-category
  approvals (treasury-rules.spec per BUSINESS_RULES §8).
- Isolation: A1–A10 on all new tables; foreign partner/open-item/account ids in
  nested payloads → typed rejection, no partial creation (S-04); A7 on all routes.
- Permission checklist for §3.4 incl. approval-limit boundaries where limits apply.

**Manual verification:**

1. Open a cash + a bank account (mapped purposes from the onboarding CoA); record a
   receipt allocating against a partner's opening-balance open item (partial + leave
   an on-account remainder) → check the GL drill-down lands on the journal and the
   partner statement view (draft-grade) reflects the settlement.
2. Settle a USD-denominated opening item when the rate moved → verify the explicit
   FX gain/loss line with references; mirror the rate the other way and repeat.
3. Transfer between cash and bank with a fee → both accounts' balances = Σ movements
   (INV-019 screen); fee lands in BANK_CHARGES.
4. Run a shift: open float → record teller activity → close short by 2.50 →
   difference posts with the shift as source; attempt an above-tolerance close
   without supervisor credentials → blocked.
5. Import a sample Arabic-header bank statement (CSV + XLSX), auto-match, manually
   match the remainder, reconcile the period → the account's statement period locks;
   attempt to re-reconcile → refused.

**Acceptance criteria (objective):**

1. Every treasury operation posts exactly through the engine with its canonical
   G-row shape (G-05/G-06/G-10/G-11/G-12 green with line-level expected-vs-actual
   asserts), official numbers from the numbering service (INV-021), and INV-013
   idempotency per source/operation.
2. INV-016 is enforced and tested: allocations can never exceed the receipt/payment
   amount nor the open item's outstanding total, including under concurrency (CC-02);
   on-account remainders are explicit open items.
3. INV-019 is enforced and tested: every cash/bank/petty account balance equals the
   sum of its movements after every operation type; seeded drift is detected as
   `BROKEN` and blocks period LOCK (RC-08 + PC-04).
4. Realized FX differences post automatically at settlement with the original stored
   rate honored on the control line (INV-008) and an explicit gain/loss line — never
   dropped or absorbed; both gain and loss mirrors are golden-tested.
5. Bank reconciliation implements RECONCILIATION §4 exactly: import adapters, auto +
   manual matching, unmatched aging, per-account period lock (BR-022); statement
   lines never create ledger entries; imports are idempotent and bounded.
6. Shifts enforce BR-021: within-tolerance differences auto-post with the shift as
   source; above-tolerance closes require supervisor PIN + reason; all variances
   audited.
7. Petty cash enforces BR-020 caps with the reimbursement/override path; PLACEHOLDER
   default values are explicitly documented in the settings schema (OQ-002).
8. All new tables are in the isolation registry with the A1–A10 suite green; foreign
   partner/open-item/account references are rejected with zero partial creation.
9. All §3.4 permissions enforce on their routes (generated checklist green); approve
   keys are SoD-guarded by default and audited on use.
10. Every treasury screen instantiates a sanctioned archetype with AR+EN baselines,
    axe + keyboard journeys green; `ShiftPanel` has a catalog entry.

**Performance & security considerations:** statement imports parse in bounded jobs
(pg-boss, row caps, cancelable); match queries index on
`(tenant_id, account, value_date)`; allocation concurrency serializes on the open
item (row lock) with statement-timeout headroom (CC-02); no bank credentials exist —
file-based import only; audit covers every approve/close/lock action; movement tables
are append-only (grant + trigger) so even repository misuse cannot rewrite cash
history.

**Migration & rollback:** additive migration `0009` (+ append-only grants/triggers on
`cash_movements`); no destructive changes; posted documents are immutable so
rollback = previous image (expand-compatible). Statement imports are idempotent by
file hash, safe to re-run after any rollback.

## 7. Risks and Constraints

- RISK-009 extends here: a wrong receipt/FX posting corrupts AR and cash
  simultaneously — mitigated by golden line-level tests + INV-008/009/016/019
  coverage before any UI polish counts as done.
- Bank-format adapter sprawl: the adapter registry is a plugin surface — each new
  bank format ships as an adapter + fixture file, never as core changes; unmapped
  formats fall back to the generic column-mapping adapter (tenant-operable).
- FX edge cases (3-decimal currencies, KWD-style rates): covered by the CURRENCY_AND
  _PRECISION residual rules + property tests from PHASE-007 extended with settlement
  fixtures.
- Constraint: cheques are deferred (documented against FEATURE_CATALOG); do not
  build half a cheque lifecycle inside receipts — the method enum reserves the value.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-008-COMPLETION.md` with: golden test
  outputs (G-05/06/10/11/12 incl. mirrors and failure packs), INV-016/019 suite
  outputs, RC-08 + drift outputs, bank-rec workspace evidence (import → match →
  lock), shift worked-example output (BR-021 numbers), isolation + permission
  checklist results, screen baseline inventory, and the cheque-deferral doc-sync
  note.
- **Documentation updates required:** [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-008 → COMPLETE + tag), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + the new TABLES
  treasury-tax spec section + [ERD/treasury-tax.md](../../database/ERD/treasury-tax.md)
  refresh, [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)
  (`treasury.cheques` phase marker corrected to PHASE-012 with this note),
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) (`ShiftPanel`),
  [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) (bank-rec check now live).
  Acceptance criteria copied into `planning/PHASE_ACCEPTANCE_CRITERIA.md` (planned
  file — see PHASE-003 note).
- **Exit criteria:** all 10 acceptance criteria green with evidence; INV-016/019 in
  the permanently-blocking CI set; a tenant can receive money against opening
  balances, pay, transfer, expense, run shifts, and reconcile a bank statement — in
  AR and EN — with the ledger provably consistent.
- **Definition of Done:** every money movement in the system has exactly one
  journal, one movement row, and one auditable source document; every cash account
  proves itself against its movements on demand.
- **Handoff instructions:** read the PHASE-008 completion report. Receipts/payments
  are the generic money documents that PHASE-011 (AP allocations) and PHASE-012 (AR
  allocations, cheque methods) extend; the INV-019 check and bank-rec lock are now
  part of the period-close contract. **Next eligible phase: PHASE-009 — Tax Engine &
  Jurisdiction Packs** (identify only; do not implement — its prerequisite PHASE-007
  is already complete; PHASE-010 requires both PHASE-008 and PHASE-009).
