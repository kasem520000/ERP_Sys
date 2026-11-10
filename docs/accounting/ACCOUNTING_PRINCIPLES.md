# Accounting Principles

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-27

The normative accounting foundation of the Platform. Every module that touches money
implements these principles through the posting engine
([POSTING_ENGINE.md](POSTING_ENGINE.md)); the testable form of this document is
[ACCOUNTING_INVARIANTS.md](ACCOUNTING_INVARIANTS.md) (INV-xxx).

## 1. Double-entry discipline

1. Every financial event is recorded as a **journal entry** of at least two lines, where
   total debits equal total credits — in document currency AND in base currency.
2. An entry affects exactly the accounts, partners, items, cost centers, and tax codes
   declared by its specification; partial or "lazy" entries (one-sided) are rejected.
3. Account balances are **derived** (SUM of posted lines), never stored as the primary
   fact. Cached/denormalized balances are allowed only as reconcilable read models.
4. Debit/credit semantics per account type:

| Account type | Normal balance | Increases with | Decreases with |
|--------------|----------------|----------------|-----------------|
| ASSET | Debit | Debit | Credit |
| LIABILITY | Credit | Credit | Debit |
| EQUITY | Credit | Credit | Debit |
| REVENUE | Credit | Credit | Debit |
| EXPENSE | Debit | Debit | Credit |

## 2. Accrual basis

The books are kept on the accrual basis: revenue is recognized when the performance
obligation is satisfied (goods delivered / service rendered — controlled by document
type and posting date), expenses when incurred. Cash movements are recorded as balance-
sheet transfers (cash/bank ↔ AR/AP or direct), never directly as revenue/expense unless
the transaction is genuinely cash-basis (e.g., a cash expense).

## 3. Document → ledger immutability

1. Business documents progress through the states defined in
   [DOCUMENT_LIFECYCLE.md](DOCUMENT_LIFECYCLE.md); only `POSTED` documents affect the
   ledger, and they affect it **in the same database transaction** in which they become
   `POSTED`.
2. A posted document is **immutable**: no edits, no deletes. Corrections are new
   documents (credit note, debit note, adjustment, reversal entry) referencing the
   original. Void-before-posting is allowed only in `DRAFT` (audit-logged).
3. Journal entries carry `source_type` + `source_id` + `operation` (e.g.,
   `sales_invoice:…:post`, `journal_entry:…:reverse`), giving every balance a complete
   provenance chain (drill-down requirement).

## 4. Posting integrity

1. **Idempotency**: a posting operation key may execute exactly once; retries return the
   original result (INV-013).
2. **Atomicity**: document state + stock + subledger + journal + audit commit together
   or not at all.
3. **Period integrity**: posting date must fall in an open (unlocked) fiscal period of
   the tenant (INV-011); period locks are enforced by the engine, not by UI convention.
4. **Reversals**: the only mechanism to negate a posted entry; the reversal references
   the original and vice versa; both remain visible forever. Reversal of a reversal is
   forbidden (create a fresh correction instead).

## 5. Money, currency, and rounding

1. The tenant keeps books in a single **base currency**; document currencies convert via
   dated exchange rates at posting time; the rate is stored on the entry (INV-008).
2. All amounts are exact decimals (ADR-0009). Rounding happens only at defined points
   (line net, line tax, totals, FX conversion) with per-currency minor units and
   half-up mode; residuals post to the rounding-purpose account — never dropped.
3. FX gains/losses: **realized** differences post when the settlement clears
   (receipt/payment/invoice in different currency at a new rate); **unrealized**
   revaluation of open AR/AP and cash positions is an optional, report-able, explicitly
   dated procedure (post-MVP; documented in
   [JOURNAL_RULES.md](JOURNAL_RULES.md) §6) — never automatic silent adjustment.

## 6. Subledgers and control accounts

1. Partners (AR/AP), inventory (per valuation method), cash/bank accounts, VAT by
   treatment are maintained as **subledgers** aggregated to control accounts.
2. At every instant: subledger total = control account balance (INV-009, INV-010);
   reconciliation tooling verifies continuously and at period close
   ([RECONCILIATION.md](RECONCILIATION.md)).
3. Control-account mappings are tenant-configurable through **account purposes**
   ([CHART_OF_ACCOUNTS.md](CHART_OF_ACCOUNTS.md)) — tenants keep their own CoA while
   the engine posts to the mapped accounts.

## 7. Inventory accounting

Perpetual system: stock receipts and issues update inventory asset accounts and COGS at
issue time, valued by the tenant's costing method (WAC default, FIFO optional)
([INVENTORY_ACCOUNTING.md](INVENTORY_ACCOUNTING.md)). Costing-method changes are
forward-only with an explicit revaluation posting at the switch date; no retroactive
restatement of issued costs. Manufacturing costs accumulate in WIP and transfer to
finished goods at actual production cost.

## 8. Tax accounting

Tax is not an afterthought of documents: every taxable document line carries a
**treatment** and a **rate snapshot**; tax totals post to tax purposes mapped per
jurisdiction pack (VAT payable/recoverable per ADR-0010). The VAT return derives from
posted tax summaries and must reconcile with GL tax accounts
([RECONCILIATION.md](RECONCILIATION.md) §5).

## 9. Fiscal calendar and closing

1. Fiscal years divide into monthly periods (custom periods allowed later); posting is
   only permitted into open periods; soft-close (warning state) precedes hard lock.
2. Period close is checklist-driven (reconciliations green) — see
   [PERIOD_CLOSING.md](PERIOD_CLOSING.md). Year-end close generates a single
   system-closing entry moving P&L balances to retained earnings; it is itself
   reversible as a unit.

## 10. Audit trail

Every state change on a financial document, journal entry, fiscal period, or
configuration affecting accounting (CoA mapping, tax code, rate) writes an audit event:
who, when, what (before/after), from where (request/device), under which correlation id.
Audit events are append-only and queryable by authorized roles
([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md)).

## 11. What this platform will NOT do

- No negative stock postings (unless explicitly enabled per tenant with documented
  reasons — default OFF; if ON, valuation must still balance).
- No "adjusting balances" without documents: partner balances, stock, and cash move only
  through documents/journals.
- No configuration that breaks invariants: entitlements/templates may not alter posting
  rules (directive §1.15); they alter only which accounts (purposes) and which features
  are available.
- No period-end "hard re-computation" that rewrites history: corrections are additive.
