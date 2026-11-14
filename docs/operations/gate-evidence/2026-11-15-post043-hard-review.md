# Gate evidence — PHASE-043 hard review: the two blocking defects reproduced and closed (2026-11-15)

**Scope:** the owner reopened the 043 protection review against the
unified head `1674849` with an independent reproduction of TWO BLOCKING
DEFECTS (delivered as
[audit-evidence/phase043-hard-review/probe.spec.ts](../../../audit-evidence/phase043-hard-review/probe.spec.ts)
+ [probe.log](../../../audit-evidence/phase043-hard-review/probe.log)
— the before-evidence at the unfixed head). The owner's directives this
round: (1) `allow_negative_stock` must NEVER disable the reservation
protection — the policy keeps its declared meaning for the UNRESERVED
quantity only, and a protected quota is consumable solely through the
authorized, audited release; (2) the delivery CREATE and POST verify the
order-line binding (the line belongs to the delivery's order, item and
warehouse match) and every beneficiary allowance traces to a LIVE
reservation matching item, warehouse, and beneficiary — never the
reservation id alone; duplicates, partial and concurrent settlements,
and atomic rollback are all tested; (3) ATP semantics: an explicit
UNPROTECTED / PARTIALLY_PROTECTED / FULLY_PROTECTED standing relative to
the REMAINING qty, with the quantities and the AR+EN warning at the
promise point, and backorders never blocked; (4) RISK-032 corrected —
the reservation-side closure claim REMOVED until the review passes; (5)
check-id-ledger `--self-test` fixed (9c/9d) with the real
conflict-detection tests preserved; (6) PHASE-045 continues in parallel
with separated evidence and coordinated migrations/ids. **NO closure of
043 and NO production approval are claimed — the fixed head + this
evidence go to the owner's review.**

---

## Item 1 — the reproduction (the before-evidence, at the unified head 1674849)

The probe (the auditor's standalone spec — OUTSIDE the app's DB suite,
its own vitest config booting the same embedded PostgreSQL 16 + the real
migration chain) ran against the UNMODIFIED head `1674849`:

```
cd apps/api && pnpm exec vitest run \
  --config ../../audit-evidence/phase043-hard-review/vitest.probe.config.ts
```

**Result (probe.log): 2/2 FAILED — both defects live.**

- **DEFECT 1 (the negative-stock bypass):** with
  `inventory.allow_negative_stock` enabled for the tenant, another
  order's delivery of the MTO-reserved stock **POSTED
  (DEL-2026-000001)** — `planIssue`'s reserved-pool guard rode
  `!allowNegative`, so the explicit BR-013 policy silently switched the
  ENTIRE protection off. The goods left, and the ACTIVE holder stayed
  unbacked.
- **DEFECT 2 (the delivery identity hole):** a delivery binding ANOTHER
  order's line was **accepted at create** (no order-line-belongs-to-the-
  order check, no item match, no warehouse consistency, no duplicate
  guard), and the beneficiary allowance trusted the reservation ID
  ALONE (`activeReservationQty` reads the qty with no
  item/warehouse/holder verification) — a crafted delivery counted
  another item's / another warehouse's reservation as its entitlement
  and could consume a third party's protected pool.

The pinning regression tests
([reservation-hard-review.spec.ts](../../../apps/api/src/__db__/manufacturing/reservation-hard-review.spec.ts)
— the two audit tests (k)/(l) + the ATP pin (m)) ran at the same unfixed
head: **3/3 FAILED** (regression-before.log).

## Item 2 — the fixes

### 2.1 The policy-independent pool floor (defect 1)

`planIssue`'s guard is REFORMULATED — the protected quota binds at ANY
policy position:

```
protectedForOthers = max(reservedPool − allowance, 0)
reject when  onHand − qty < protectedForOthers
```

- The negative-stock policy (BR-013) governs the **ZERO floor only**
  (the unreserved portion — free stock may still go negative at the
  last known average, pinned by test (k4) and the untouched
  valuation-ledger suite).
- When `protectedForOthers` is 0 (no pool, or the issue's entitlement
  covers it) the pool guard imposes NOTHING — BR-013's declared meaning
  survives intact for free stock.
- When `protectedForOthers > 0` the floor binds ABOVE zero regardless
  of the policy — the pool beyond the issue's own entitlement is
  untouchable at any policy position (tests (k1)/(k2)/(k5): another
  order's delivery REJECTED, a manual issue REJECTED, the free portion
  of a reserved position still ships, one unit deeper REJECTED).
- The lock discipline is UNCHANGED: the pool is still one indexed SUM
  read inside the already-held item_stock row lock (CC-04); no new
  lock, no new lock order (round-4's star preserved); the settlement's
  conditional row updates remain the stale-allowance verifier.

### 2.2 The delivery identity contract (defect 2)

`verifyDeliveryLineIdentity` — verified at CREATE and RE-VERIFIED AT
POST (the defense-in-depth arm: a store-written / pre-fix / rogue row
dies at post, BEFORE any stock plan, with zero residue):

1. a bound order line BELONGS to the delivery's own order (a foreign
   order's line → `DELIVERY_LINE_IDENTITY`, never trusted by id);
2. the delivery line's ITEM matches the order line's item;
3. a delivery binding order lines ships from the ORDER's warehouse
   (the fulfillment warehouse where its reservations live);
4. no order line is bound TWICE within one delivery (duplicates
   double-count one entitlement; partial shipments are separate
   deliveries — the partial path itself re-pinned by (l6)).

THE ALLOWANCE NEVER TRUSTS THE RESERVATION ID ALONE: the own-reservation
counts only when its LIVE row (`findLiveReservationRow` — ACTIVE,
non-expired: the same "live" definition the pool nets) matches the
line's item, the delivery's warehouse, AND the beneficiary holder
(`SALES_ORDER` holder = this order); a dead or mismatched row counts
NOTHING (free stock only — fail-closed). The MTO chain read
(`listActiveMtoHolderReservationsForLine`) is identity-complete by
construction (item + warehouse + the sales-line link) and is now
EXPIRY-ALIGNED (an expired row can no longer inflate the allowance
against a pool that excludes it). The settlement contract is unchanged
and re-pinned: partial settlements retire exactly (l6), concurrent
partial settlements leave exactly one winner where the stock floor says
so (l7), and a post that fails after its plans leaves ZERO residue with
the protection intact for the retry (l8).

### 2.3 The ATP standing at the promise point (the semantics directive)

`checkLineAtp` answers the THREE-VALUED standing RELATIVE TO THE
REMAINING qty (line qty − the already-POSTED delivered qty, floored at
0), with the quantities and the bilingual advisory note:

- `UNPROTECTED` — no allocation feeds the line; the verdict is ADVISORY
  ONLY (the full remaining qty is exposed; a backorder remains
  possible);
- `PARTIALLY_PROTECTED` — an ACTIVE allocation covers part of the
  remaining qty (`protectedQty` of `remainingQty`; the uncovered
  `unprotectedQty` is exposed exactly as UNPROTECTED);
- `FULLY_PROTECTED` — the ACTIVE allocation(s) cover the FULL remaining
  qty (its own reservation or its MTO chain — stock the issue choke
  point physically holds for the beneficiary).

The response carries `remainingQty` / `reservedForLineQty` /
`protectedQty` / `unprotectedQty` + the AR/EN advisory note stating the
standing with its numbers verbatim; the audit event carries them too.
The standing's own-reservation read is the same identity-verified live
row as the delivery allowance (one definition everywhere). The verdict
stamps and the no-ATP-gate-at-issue law are UNCHANGED — a shortage
NEVER blocks issuing a sales order (the backorder stays legal, pinned
by (m4) and (j3)).

### 2.4 check-id-ledger --self-test (9c/9d) fixed

The two probes leaned on the LIVE ledger (the REAL 045/046 shapes with
the pre-re-coordination ids), so they broke the day the 043-completion
round consumed BR-081 and shifted the ladder (+1 through 051) — the
probes-1/5/8 disease. They are now SYNTHETIC-FIXTURE probes (their own
9xx reservation world, ids no canon will ever reach) shaped EXACTLY
like the real 045/046 posting-canon paragraphs, with the REAL
conflict-detection arms preserved (the mutated G-44 claims are real
implemented ids — the stale-claim rejection still fires; the
implemented G-29 still rides the claim clause as a proximity-demoted
reference and is never flagged). **Self-test 16/16 OK; the normal
checker 0 errors / 0 warnings** (implemented: G 49 · INV 30 · BR 81).

## Item 3 — the evidence runs (each its own run, never combined)

| Run | Command | Result |
|-----|---------|--------|
| Probe BEFORE (at 1674849) | `vitest run --config …/vitest.probe.config.ts` | **2/2 FAILED** — both defects reproduced (probe.log) |
| Regression BEFORE (at 1674849) | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/reservation-hard-review.spec.ts` | **3/3 FAILED** (regression-before.log) |
| Probe AFTER (the fixed head) | same | **2/2 PASSED** (probe-after.log) |
| Regression AFTER | same | **3/3 PASSED** (k/l/m — regression-after.log) |
| Targeted 1 — the reservation/ATP/valuation cluster | `vitest run --config vitest.db.config.ts reservation-hard-protection reservation-basis reservation-overcommit mto-lifecycle mto-surplus-cancel atp-unreserved-promise planning-goldens inventory/valuation-ledger` | **8 files · 51/51 PASSED** |
| Targeted 2 — the delivery-path cluster | `… sales/golden distribution/tiers-foc inventory/wms-picking sync/policies sync/desktop-intents sync/push sync/field-intents` | **7 files · 89/89 PASSED** |
| api typecheck | `tsc --noEmit -p tsconfig.json` (apps/api) | **clean (exit 0)** |
| check-id-ledger + self-test | `pnpm run check:id-ledger -- --self-test` | **0 errors / 0 warnings · self-test 16/16** |

**The FULL DB SUITE (one serial run, the unified head):**
`pnpm --filter @erp/api exec vitest run --config vitest.db.config.ts` —
**225/225 files · 3,219 passed | 2 skipped (browser-env render) · 0
failed · 502.53s** (the single-run summary is preserved verbatim in
[full-db-suite-after.log](../../../audit-evidence/phase043-hard-review/full-db-suite-after.log);
225 = the prior 224 + this round's reservation-hard-review.spec; the
2 skipped are the pre-existing browser-env render skips — the known
environmental set, unchanged).

## Item 4 — the governance corrections

- **RISK-032 (the register row REWRITTEN):** the reservation-side
  closure claim is WITHDRAWN — the row now records the hard-review
  findings (the two blocking defects, verbatim), the fixes, and the
  standing: **the reservation side is NOT closed until the independent
  review passes the fixed head.** The unreserved-demand POLICY choice
  remains the owner's (auto-reserve at issue / a blocking gate / the
  declared advisory model).
- **IMPLEMENTATION_STATUS:** the hard-review entry appended (the probe
  results, the fixes, the evidence links); the PHASE-045 row corrected
  to IN_PROGRESS (the substrate was delivered 2026-11-14 — the row had
  stayed NOT_STARTED after the parallel start).
- RISK-031 stays open with its documented limits; the async/progress
  deviation stays declared future work; no closure of 043 and no
  production approval are claimed.

## Item 5 — the parallel-work separation (PHASE-045)

The 043 hard-review round touched: movement-core, the inventory +
manufacturing stores, sales deliveries/orders/errors, the reservation
specs, the id-ledger checker, and this evidence. The 045 track touches
NONE of them (new hr.* tables/services; the only shared surfaces are
the migration journal — the hard-review round took NO migrations — and
the planning docs, updated in its own commits). Test runs stay
sequential (one embedded-PG data dir per machine — recorded); the 045
evidence stays in its own ledger
([2026-11-14-phase045-start-substrate.md](2026-11-14-phase045-start-substrate.md)
+ this round's 045 increment commit); the shared gates re-run ONCE on
the unified head after the merges (each its own run, this file).

## Item 6 — the delivery archive (the round-1 item-8 rule, unchanged)

`ERP_PLATFORM_PHASE043.zip` is REBUILT at this round's final content
head (a `git archive` review/restore snapshot of every git-tracked
file, EXCLUDING the root `ERP_PLATFORM_PHASE*.zip` archives and
gitignored artifacts; built before its own commit, which adds only the
zip itself). The completeness proof is recorded in the delivery commit
message (the tracked-file count + the exclusion list, the same comm
comparison the owner used to catch the round-3 staleness).
