# Reconciliation

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-11-07

What must reconcile to what, how it is verified, and what happens on drift. Every check
below is (a) a scheduled job producing a reconciliation record, (b) part of period close
checklist, and (c) backed by an automated test with seeded drift scenarios.

## 1. Reconciliation map

| # | Subledger / statement | Reconciles to | Invariant |
|---|----------------------|---------------|-----------|
| 1 | Partner subledger (AR): Σ open+settled entries per partner | `AR_CONTROL` account balance | INV-009 |
| 2 | Partner subledger (AP) | `AP_CONTROL` account balance | INV-009 |
| 3 | Inventory valuation: Σ(qty × valuation) per item/warehouse | `INVENTORY` account(s) | INV-010 |
| 4 | WIP per production order | `WIP` account | INV-010 |
| 5 | Cash/bank account ledger | Cash/bank GL accounts (same account — internal consistency: movements vs. computed balance; then physical counts and bank statements) | INV-019 |
| 6 | Bank statement lines (imported) | System bank movements (bank reconciliation module) | — |
| 7 | Tax summaries per document | GL tax accounts (`VAT_PAYABLE`/`VAT_RECOVERABLE`/`VAT_EXPENSED`) | INV-012 |
| 8 | GRNI (received-not-invoiced) register | `GRNI` account balance | INV-010 |
| 9 | Payroll/salary accruals (if used) | Accrued liability account | deferred |
| 10 | Fixed assets register → depreciation (RC-10, `FIXED_ASSETS` kind) | Per category account: Σ gross current value = `FIXED_ASSET` balance; Σ accumulated = `ACCUM_DEPRECIATION` balance (INV-023) | PHASE-026 |
| 11 | Notes register → custody (RC-11, `NOTES` kind, PHASE-027 — migration 0038) | Per purpose side: Σ live received notes (amount × the note's stored rate, INV-008) = `NOTES_RECEIVABLE` balance; issued mirror on `NOTES_PAYABLE` (credit-positive read — the GRNI convention); resolved notes contribute zero (INV-024); a GL balance with no live register (external journals on a notes-purpose account) is surfaced per key | INV-024 |

## 2. Verification mechanics

- **Continuous**: a reconciliation job (pg-boss) per check runs nightly (or on demand),
  computing both sides as of "now" and per open period; results stored with the diff and
  the offending rows.
- **Deterministic as-of reporting**: statement/aging reports recompute subledger sums at
  the as-of date from immutable entries — identical results on re-run (no drift from
  caching).
- **Tolerance**: 0.00 for accounting checks (exact decimals); bank reconciliation
  tolerance is per-import (bank charges/timing differences are matched items, not
  tolerance fudge).

## 3. Discrepancy workflow

1. A check fails → reconciliation record status `BROKEN` with diff detail → notification
   to `accountant` role → incident noted in [../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md)
   discipline (RISK-009: Sev-1 if ledger-vs-subledger drift).
2. Fixes are **always additive documents** (reversals/adjustments) or configuration
   corrections with audit — never UPDATEs that "force-balance".
3. A period cannot be `LOCKED` with a `BROKEN` core check (AR/AP/inventory/VAT/cash, plus GRNI, WIP,
   fixed assets and notes since their registering phases — PC-04). RC-11 runs NIGHTLY (2:30 UTC
   pg-boss leg) and on demand (`POST /api/v1/notes/reconciliation/notes-check`); seeded drift
   (a note row without its journal, or an external journal on a notes-purpose account) →
   `BROKEN` with the offending note + critical notification + the close block.
4. Postmortem: drift above materiality threshold (per tenant, default 0) requires a
   written incident note attached to the reconciliation record.

## 4. Cash & bank specifics

- **Cash counts** (treasury shifts): counted cash vs. ledger → difference posts to
  cash-difference expense/revenue accounts with the shift as source document.
- **Bank reconciliation** (PHASE-008): import statement (CSV/Excel, per-bank format
  adapters) → auto-match (amount+date window+reference) → manual match remainder →
  reconcile state per statement period; unmatched system items and unmatched statement
  items listed with aging; reconciliation is per bank account per period and locks the
  statement period for that account.

## 5. VAT return reconciliation (per period)

Output tax by treatment + input tax (recoverable vs expensed) computed from document
tax summaries must equal the GL movements of the tax accounts for the same period
(INV-012). The VAT return report displays both sides side-by-side with drill-down; a
mismatch blocks the "file" status of the return draft (platform does not file — humans
file; the platform reports).

## 6. Reconciliation as a product surface

The reconciliation workspace is a first-class screen ([../ui/PAGE_ARCHETYPES.md](../ui/PAGE_ARCHETYPES.md)
"health center" variant) — real-time status tiles per check, drill-down to offending
rows, action buttons per workflow above. Accounting trust is built here; it is treated
as a flagship screen, not a utility.
