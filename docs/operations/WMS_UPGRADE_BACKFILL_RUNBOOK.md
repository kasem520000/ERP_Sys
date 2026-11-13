# WMS Upgrade Runbook — The Legacy-Stock Bin Backfill (PHASE-044 T-20 + post-closure audit fix)

> **Status:** MANDATORY for every pre-0067 tenant before the binless grace may
> be retired · **Owner:** Operations · **Engine:**
> `pnpm --filter @erp/api backfill:bins` (`apps/api/scripts/backfill-bins.ts`) ·
> **Law:** INV-029 ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)) ·
> **Detector:** the nightly `inventory.bin-reconcile` probe (01:45 UTC)

## 1. What this runbook migrates

Migrations 0067–0073 introduced the bin substrate (`bin_contents`). Stock that
predates it — `item_stock` rows with no matching tenant-owned `bin_contents` —
violates the INV-029 fold (Σ tenant-owned `bin_contents` = `item_stock` per
warehouse × item) until it is placed. **Nothing places it automatically**:
receipts/issues after 0067 write bins in the same transaction as `item_stock`
(the same-transaction law); the pre-existing stock needs this ONE operator-run
backfill per tenant.

The backfill lands every provable shortfall on the warehouse's DEFAULT bin
(lazily materialized, barcode `BIN-<WH>-DEFAULT`, mixed-batches allowed) —
**distributed per batch/serial from the proven sources of truth** for tracked
items:

| Item kind | Source of truth for the distribution | Trust boundary |
|---|---|---|
| Untracked | `item_stock` itself | The position table IS the truth; one NULL-dimension row. |
| Batch-tracked (`track_batch`) | `stock_moves` per `(batch, warehouse)` — the SAME append-only ledger `batchOnHand`/`listFefoBatches` fold at runtime, netted against the bin rows each batch already holds | A batch with no ledger legs cannot be proven; a `WRITTEN_OFF` batch with a positive ledger balance is an anomaly (never pickable — left unwritten, reported). |
| Serialized (`track_serial`) | `stock_moves` per serial (net ±1 legs) for the warehouse + the `item_serials` registry status | `item_serials` has NO warehouse column — the ledger is the only warehouse attribution; a serial whose registry status contradicts its ledger (`sold` vs +1 here) is a CONFLICT, never placed. |

Every distribution is reconciled against the `(warehouse, item)` total
**BEFORE any write** (never a blind NULL-dimension row on a tracked item —
such a row cannot be spent by the pick allocation walk, the audit's finding).

## 2. Prerequisites

1. **Migrations 0001–0073 applied** (`pnpm db:migrate` on the target).
2. **The app-role connection** — `DATABASE_URL` pointing at the `erp_app`
   role (non-owner, RLS enforced, 15s statement timeout). The tool enumerates
   ACTIVE tenants through the platform-scope GUC on the SAME role
   (`listActiveTenantIds`, the nightly jobs' pattern) and writes through
   per-tenant UoWs (`withTenant`, ADR-0005). **The migrate/bootstrap role is
   never used.** No superuser connection is opened.
3. **A fresh backup** ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §3 —
   the nightly-dump artifact shape). The backfill itself is additive-only,
   but the runbook's discipline is backup-before-any-migration.
4. **A maintenance window is NOT required** (see §6), but the FIRST live
   pass should target ONE tenant (`--tenant=<uuid>`) before the fleet.

## 3. The report's classification vocabulary

Every `(warehouse, item)` shortfall row in the report carries:

- `tracking` — `NONE` / `BATCH` / `SERIAL` (the item's flags).
- `classification`:
  - **`WRITABLE`** — the evidence proves the full distribution. The live
    pass writes it and the fold goes exact.
  - **`PARTIAL_UNATTRIBUTED`** — the proven distribution covers LESS than
    `item_stock` (e.g. pre-tracking NULL-batch moves, a registered serial
    with no ledger legs). **The unproven residue is NEVER written**: it stays
    visible to the nightly probe, it is no more spendable than before the
    backfill (the FEFO/BR-017 and named-unit/BR-018 laws were already the
    spend gate), and the live pass files ONE critical owner notification.
  - **`NON_RECONCILABLE`** — the sources DISAGREE (the per-batch ledger
    shortfalls, or the provable serial count, EXCEED the `item_stock`
    shortfall). The distribution is untrustworthy: **nothing is written for
    the item**; the operator must investigate (§5).
- `plannedWrites` — the dry-run's per-batch/per-serial write plan.
- `residueQty` — the unproven remainder (`0` when `WRITABLE`).
- `notes` — the named anomalies (the conflicting serial number, the
  written-off batch, the duplicated ledger legs).

## 4. The procedure (in order — no step may be skipped)

### 4.1 Dry-run (writes NOTHING — exit 0)

```bash
pnpm --filter @erp/api backfill:bins -- --dry-run --report=/tmp/backfill-dry.json
# one tenant first:
pnpm --filter @erp/api backfill:bins -- --dry-run --tenant=<uuid>
```

### 4.2 Review the report

For every row: is the classification expected? `plannedWrites` must name real
batches (`item_batches`) / real in-stock serials (`item_serials`); residues
must be explainable (pre-tracking stock, phantoms); a `NON_RECONCILABLE` row
is a data-integrity finding — investigate BEFORE applying (§5).

### 4.3 Backup

Take/verify the fresh dump (§2.3). Record its id with the change ticket.

### 4.4 Apply (live)

```bash
pnpm --filter @erp/api backfill:bins -- --tenant=<uuid> --report=/tmp/backfill-live.json
# then the fleet (every ACTIVE tenant):
pnpm --filter @erp/api backfill:bins -- --report=/tmp/backfill-live-all.json
```

**Exit codes:** `0` clean (every shortfall resolved or none) · `2` the pass
completed but unproven residue remains (§5 — the operator MUST review) ·
`1` an error (§6).

### 4.5 Verify

1. The tool's own post-write guard already verified per written item that
   Σ bins = `item_stock` − residue inside the same UoW (a violation rolls the
   tenant back whole — it cannot ship a hidden shortfall).
2. Independently (per tenant, through the app role):

   ```sql
   -- The fold must be EXACT for every WRITABLE item and equal
   -- stock − residue for PARTIAL ones (the probe lists the rest):
   SELECT w.code AS warehouse, i.sku,
          COALESCE(b.bin_qty, 0) AS bins, s.qty AS stock
   FROM item_stock s
   LEFT JOIN (SELECT warehouse_id, item_id, SUM(qty) AS bin_qty
              FROM bin_contents WHERE owner_partner_id IS NULL
              GROUP BY 1, 2) b ON b.warehouse_id = s.warehouse_id AND b.item_id = s.item_id
   LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = s.tenant_id
   LEFT JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
   WHERE s.qty <> COALESCE(b.bin_qty, 0);
   -- Expected: only the accepted PARTIAL/NON_RECONCILABLE rows (§5).
   ```

3. **Spend smoke** (the audit's core demand — the migrated stock must be
   spendable): issue a small quantity of a batch-tracked item (explicit batch
   and FEFO) and a serialized unit by its serial through the normal issue
   surfaces. Pre-fix behavior (the audit's finding) was a typed
   `BIN_CONTENTS_SHORT` on exactly these flows.
4. The next nightly `inventory.bin-reconcile` run must report the tenant
   clean except the accepted residue rows.

## 5. Unresolved cases (exit 2) — the decision protocol

The backfill NEVER invents balances and NEVER lets a partial pass hide the
shortfall. When the live pass exits 2:

- Every unproven unit stays unwritten; the drift remains in the probe's
  report every night (ONE critical owner notification per day), and the
  live pass itself filed ONE critical notification naming the items.
- For each unresolved item the operator EITHER:
  1. **Corrects the data** through a documented stock adjustment (the count
     wizard / adjustment surfaces — through the movement core, never raw
     SQL), then re-runs the backfill (the corrected stock becomes provable);
     OR
  2. **Accepts the drift** with a recorded decision (ticket id in the change
     log) — the residue stays visible forever; it is never spendable through
     the batch/serial paths (it never was).
- **`NON_RECONCILABLE` is never accepted silently**: the ledger claiming
  MORE than the position table is a data-integrity incident — find the
  divergent legs (the report's notes name the batches/serials) before any
  correction.

**There is no time-based auto-anything here.** The safety chain is:
the binless grace keeps pre-backfill tenants spendable (§7) → the operator
runs the documented procedure → the nightly probe detects whatever remains →
a human resolves it. The probe's 24-hour cadence is a DETECTOR, not a
deadline — nothing flips, blocks, or expires on a timer.

## 6. Error handling & resume

- **One tenant UoW per pass** — a tenant that fails rolls back WHOLE (the
  tool logs it, keeps processing the remaining tenants, exits 1). The pass
  is resumable by re-invocation: healed tenants are no-ops (idempotent), the
  failed tenant restarts its pass from scratch — there is never a partial
  tenant write.
- **Interruption (Ctrl-C / crash):** the current tenant's UoW dies uncommitted;
  every committed tenant stands. Re-run.
- **Concurrency:** a transaction-local advisory lock
  (`pg_advisory_xact_lock('erp:wms-bins-backfill:<tenant>')`) serializes
  per-tenant passes — two operators (or a double-invocation) converge: the
  loser re-reads the healed fold and writes nothing (proven by the tracked
  backfill spec's parallel-run test).
- **A SURPLUS** (bins > stock) is genuine drift the backfill NEVER touches —
  the probe owns it; investigate, never "fix" by writing more rows.

## 7. The binless grace — survival and the ONLY removal precondition

The movement core's binless path (`hasAnyBinContent` → the 0071 grace) lets
an item with NO bin rows issue/receive as before. **It stays.** It is the
safety net that keeps un-backfilled tenants spendable, and the backfill's
residue classification depends on it for the no-bins-at-all case. It may be
retired ONLY when: every ACTIVE tenant's backfill verification (§4.5) has
passed AND a release has explicitly re-planned the removal with its own
migration analysis — removing it earlier would strand exactly the stock this
runbook exists to place. INV-029's wording ("AT ALL TIMES") is the law for
every post-0067 economic move; the pre-existing stock is the migration-era
residue this runbook closes — the probe keeps the residue visible until it
is resolved, by design.

## 8. Rollback thinking

The backfill is additive-only (new `bin_contents` rows + audit + one
notification). There is no destructive rollback path — if a pass must be
undone, restore the backup taken at §4.3 (the whole-database restore drill,
[BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §4) — which is why the
backup step is mandatory.
