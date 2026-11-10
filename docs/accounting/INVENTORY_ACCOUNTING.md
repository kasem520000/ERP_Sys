# Inventory Accounting

> **Status:** STABLE · **Owner:** Accounting & Inventory Domain Architecture · **Updated:** 2026-10-27

How stock movements become ledger effects and how inventory value is maintained and
reconciled. Stock mechanics (moves, batches, serials) live with the inventory module
([../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md) §inventory); this file
defines the accounting rules. Perpetual inventory is the platform default (A-006).

## 1. Valuation methods

| Method | Rule | Change policy |
|--------|------|---------------|
| **WAC (default)** | After each receipt: `newAvg = (qtyOnHand × oldAvg + qtyIn × unitCost) / (qtyOnHand + qtyIn)`; issues price at current average, kept at 6-decimal precision | Per tenant; per-item lock once transactions exist |
| **FIFO** | Issues consume oldest cost layers (`stock_layers`); layers created at receipt with unit cost | Same |

- Method is **per tenant with per-item consistency** — an item never mixes methods.
- Switching method for an item requires: no open transactions in-flight, an explicit
  **revaluation posting** at switch date (DR/CR inventory vs. appreciation/shrinkage
  purpose), and audit trail. No retroactive restatement of past issues (INV-017).
- Negative stock is forbidden by default (`allow_negative_stock=false`); when explicitly
  enabled per tenant, issues price at last known average and the ledger still balances
  (quantity negative, value consistent) — flagged in reports.

## 2. Stock movements → journals

| Movement | Ledger effect |
|----------|---------------|
| Goods receipt (purchase) | DR `INVENTORY` · CR `GRNI` (until supplier invoice clears it; landed cost revalues layer) |
| Issue for sale (delivery/POS) | DR `COGS` · CR `INVENTORY` at issue cost |
| Sales return re-entry | DR `INVENTORY` · CR `COGS` at **original issue cost** (not current average) — the credit note pairs with this |
| Transfer (same valuation account) | No journal; stock_move rows only |
| Transfer (branch-distinct accounts) | DR dest. inventory account · CR source inventory account |
| Count variance loss / gain | DR `INVENTORY_SHRINKAGE` · CR `INVENTORY`, or inverse via `INVENTORY_APPRECIATION` |
| Damage/scrap | Same as shrinkage with reason code |
| Opening stock | DR `INVENTORY` · CR opening-balance equity line (see [POSTING_ENGINE.md](POSTING_ENGINE.md) §4) |
| Production completion | DR `INVENTORY` (finished goods at production cost) · CR `WIP` |
| Material consumption (production) | DR `WIP` · CR `INVENTORY` at issue cost |

**Atomicity rule:** stock_moves and their journals commit in the same transaction
(INV-018). A movement without its journal (or vice versa) can never exist.

## 3. Landed costs (PHASE-011 baseline)

Freight, customs, insurance added to a goods receipt allocate across received lines by
value or quantity (configured), revaluing the affected WAC/layers **before any issue from
that stock** where operationally possible; if stock was already issued at the lower cost,
landed cost allocates to remaining quantity and the difference posts to COGS adjustment
(documented, auditable). No silent back-dating.

## 4. Cost of goods sold discipline

- COGS is recognized at issue time (perpetual) with the item's valuation method.
- Returns re-enter at original cost (per §2) so gross margin reports stay truthful.
- Sale discounts/promotions never touch COGS — they affect revenue (contra) only.

## 5. Batch, expiry, serial, and IMEI accounting impact

- Tracked dimensions affect **which units** are issued (FEFO for expiry-enabled items at
  POS/food templates) but not the valuation math; each `stock_move` references batch/
  serial IDs when the item is flagged for tracking. **Costing–picking decoupling
  (adopted from Folder 4, BR-INV-04 formulation):** a FIFO-costed item may still be
  picked by nearest-expiry for operational/food-safety reasons — costing method
  (WAC/FIFO per tenant policy) and picking preference (FEFO/serial/arrival order per
  tracked dimension) are separate attributes on the same movement/batch record and are
  never conflated; changing a picking preference never changes costing math.
- Write-offs on expiry post as shrinkage with reason `EXPIRED` (industry templates
  default this workflow for food businesses).

## 6. Reconciliation

Inventory subledger per item per warehouse (qty × valuation) must equal the `INVENTORY`
account (and per-branch accounts where split) — checked continuously by a scheduled job
and at period close (INV-010; [RECONCILIATION.md](RECONCILIATION.md) §3). Drift is a
Sev-1 data-integrity incident (RISK-009), not a report to ignore.

## 7. Reports

Stock valuation report (at cost, at any date), movement analysis, COGS margin analysis,
aging of stock, expiry reports — all derive from `stock_moves` + `stock_layers` and
reconcile to the ledger (report rules in [../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md)).
