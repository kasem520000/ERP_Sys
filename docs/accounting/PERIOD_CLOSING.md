# Period Closing

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-11-07

Fiscal calendar, period states, close checklist, and year-end procedures.

## 1. Fiscal calendar

- Fiscal year: start/end dates (default: Gregorian January–December; configurable start
  month at tenant creation). Year creates 12 monthly periods automatically
  (`fiscal_periods` with start/end, status).
- Period states: `OPEN` → `SOFT_CLOSED` (warning banner; posting allowed with permission
  `accounting.periods.post_to_soft_closed` + reason) → `LOCKED` (no posting — enforced
  by the posting engine, INV-011). Special periods: `OPENING` (the tenant's opening
  balance period before go-live) and `CLOSING` (year-end adjustment period if used).
- Only `accounting.period_close` roles may change states; every transition is audited.

## 2. Month-end close checklist (system-verified, human-approved)

The close workspace renders the checklist from live checks:

1. All subledgers reconciled to control accounts (AR, AP, inventory, VAT, cash/bank) —
   automated reconciliation jobs green ([RECONCILIATION.md](RECONCILIATION.md)).
2. Unposted drafts in the period: listed, acknowledged (blocked from posting after lock
   anyway; the checklist surfaces them for explicit disposition).
3. Bank reconciliations completed for all bank/cash accounts.
4. Recurring journals generated (or explicitly skipped with reason).
5. FX revaluation run or explicitly waived (multi-currency tenants).
6. Stock counts pending variance review: zero (or waived with reason).
7. Tax summary for the period verified (VAT return draft matches GL tax accounts).
8. Depreciation run POSTED for the closing period (advisory, PHASE-026 — a DRAFT or
   missing run warns, never blocks: late-registered assets legitimately depreciate in a
   later period; the item is NOT_APPLICABLE when the tenant holds no live assets).

Closing actions: mark checklist reviewed → set `SOFT_CLOSED` → (after final review, e.g.,
audit adjustments) set `LOCKED`. The period may be re-opened only by
`accounting.periods.reopen` with reason + audit, and the reopen window is monitored
(alert on reopen of a period older than 2 months — anti-fraud control).

## 3. Year-end close

1. Precondition: all periods of the year `LOCKED` except the optional `CLOSING` period.
2. The system generates the **closing entry** (source: `year_end_close`, one per year):
   - DR all REVENUE accounts (with balances) · CR `CLOSING` summary
   - CR all EXPENSE accounts (with balances) · DR `CLOSING` summary
   - Net result transfers: net profit → DR `CLOSING` · CR `RETAINED_EARNINGS`
     (net loss reversed).
3. The closing entry posts into a designated year-end period; it is itself reversible as
   a unit (`year_end_close:reverse`) if corrections are discovered — the system then
   regenerates it; individual line edits are impossible.
4. Prior-year comparatives in financial statements read from posted history; statements
   for prior years must never change (immutability). If a prior-year error is material,
   the correction posts in the current period with full memo/disclosure — never by
   restating posted history (directive §5: no silent modification).

## 4. Opening a new year

- Creating fiscal year N+1 is allowed while N is still open (business continues);
  posting into N+1 before closing N is normal. Retained earnings lines reflect
  "unaudited" until the N closing entry posts — statements label this state.
- Period creation is idempotent and generates no journal effects.

## 5. Audit and controls

- All close-related state changes + checklist reviews are audit events with actor.
- The close workspace is a designed page archetype ([../ui/PAGE_ARCHETYPES.md](../ui/PAGE_ARCHETYPES.md))
  showing real-time checklist status; completion evidence (reconciliation run IDs) is
  stored with the period close record.
