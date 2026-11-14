# Gate evidence — PHASE-043 audit round 2 (2026-11-15)

**Scope:** the six findings of the owner's independent review of `d7a65d5`
(the post-8-item audit-fix head). Every finding was confirmed or refuted
**on the live DB first** (the pre-fix reproductions below are verbatim
command output), then fixed, then re-proven. The test paths, the commands,
and both results ride every row. **Nothing in this ledger is inferred or
transferred from another run** — the actually-run commands and their
results are separated from what was NOT re-run this round (stated
explicitly at the end).

The five new spec files (all under `apps/api/src/__db__/manufacturing/`,
all run through the DB-suite runner — embedded PostgreSQL 16, singleFork,
one process, one database, sequential specs):

| # | File | Tests |
|----|------|-------|
| 1 | `mto-surplus-cancel.spec.ts` | 5 |
| 2 | `reservation-basis.spec.ts` | 6 |
| 3 | `atp-ctp-expiry.spec.ts` | 4 |
| 4 | `mrp-coproduct-order.spec.ts` | 3 |
| 5 | `atp-unreserved-promise.spec.ts` | 1 |

---

## Item 1 — the MTO surplus and the order-side terminations

**The finding (code reading, then proven):** the item-4 settlement fix
proved the per-delivery partial consume but left three leaks —
(a) an over-producing MO's SURPLUS (production 12 for a line of 10) stayed
ACTIVE forever after the full delivery (the line had nothing left to ship;
the `linkSalesOrder` comment claimed "the surplus flows to free stock" —
it did not); (b) `releaseOrderReservations` (cancel/close) released only
the LINES' OWN reservations — the PRODUCTION_ORDER holders feeding those
lines leaked; (c) the mixed case (the line's own reservation + MTO
covering the shipment) leaked the own reservation.

**The fix:** the settlement's step (5c) — the FULLY-DELIVERED
FINALIZATION (`deliveries.ts`): when a delivery completes the line
(cumulative POSTED delivered + this shipment ≥ the line qty, via the new
`sales.store.postedDeliveredQtyForOrderLine`), every reservation still
feeding it RELEASES — the MTO surplus AND the own-remainder — the surplus
flows to free stock. The order-side terminations
(`orders.ts releaseOrderReservations`) now release BOTH the lines' own
rows AND the MTO holders feeding their lines (the `deliveries.ts`
application-surface precedent; the stock itself stays on-hand for
disposition).

**Pre-fix reproduction** (one process, one DB —
`pnpm vitest run --config vitest.db.config.ts src/__db__/manufacturing/mto-surplus-cancel.spec.ts`):
**5/5 FAILED** —

- the surplus case: `expected [ { …(11) } ] to have a length of +0 but got 1` — the 2-unit surplus ACTIVE after the full 10/10 delivery;
- the multi-MO case (6+6, deliver 4 then 6): the youngest MO's surplus 2 ACTIVE after the line completed;
- cancel-after-completion: the ENTIRE 12 ACTIVE after `cancel`;
- partial-delivery-then-cancel (and the close twin): the remaining coverage ACTIVE;
- the mixed case: BOTH the MTO surplus and the line's own 10 ACTIVE (`length of +0 but got 2`).

**Post-fix proof:** same command, same file — **5/5 passed**, including
the FREE-STOCK proofs (`reservationAvailability.available` = the recovered
surplus — 2, 12, 8 — with the pool at 0) and the re-take proof (a fresh
holder reserves the freed surplus immediately).

## Item 2 — one reservation basis across every path + the soft-model declaration

**The findings (code reading, then proven):**
(a) `reserveForHolder` (the policy engine — the MTO completion's own
reservation path) verified against RAW bin rows only: an UNBINNED balance
was invisible to it while `ReservationService.create` accepted it (and
ATP + the engine counted it) — the same stock, three answers;
(b) the walk's exclusion set missed the batch-level state — a
QUARANTINED batch's bin rows stay AVAILABLE, so a reservation could hold
stock ATP refuses to promise (`listQualifiedOnHand` excludes
`ib.status <> 'ACTIVE'`), and an EXPIRED-but-never-written-off batch
counted everywhere; (c) the "hard reservation" language — the audit asked
whether another order's delivery can physically consume MTO-reserved
stock.

**The fix:** ONE basis everywhere — `reserveForHolder` now verifies on
`reservationAvailability` (pickable + unbinned − the ACTIVE pool — the
same read the choke point enforces under the `item_stock` row lock);
`listPickableRows` and `reservationAvailability`'s pickable fold gain the
batch-state exclusion (batch ACTIVE AND not expired — the same set the
MRP qualified on-hand and the ATP basis apply). Consignment never entered
any basis (BR-076 — the owner's rows never touch `item_stock`; proven,
not changed). The SOFT MODEL is declared in the headers
(`reservation-policy-service.ts`, `production-order-service.ts`,
`JOURNAL_RULES.md` G-49, the T-09 row): a reservation is an
AVAILABILITY-level hold — it nets ATP and later reservations' capacity,
never the physical pick.

**Pre-fix reproduction**
(`... reservation-basis.spec.ts`): **5 failed | 1 passed (6)** —
- (a) unbinned: `the FIFO walk cannot cover 6.000000 … pickable 0.000000 … available 0.000000` (the policy engine blind to the unbinned 10);
- (b) quarantined batch: `promise resolved "{ …(3) }" instead of rejecting` (a reservation created against QC-held stock);
- (b-twin) expired batch: same — a reservation created against lapsed stock;
- (d) consignment: the harness correction (the batch is required on receive) — the EXCLUSION itself then passed unchanged;
- (c) the soft model: the tail failed on the item-1 leak (the cancel did not release the robbed holder); the PROOF itself passed — **the delivery for another order POSTED against the MTO-reserved 10** (the goods shipped, the reservation still ACTIVE at 10, on-hand 0);
- the race PASSED pre-fix (it proves the existing serialization discipline, not a defect).

**Post-fix proof:** same command — **6/6 passed**: the unbinned accept
through the policy engine (the MTO holder shape) with the honest-pool
rejection beyond it; the quarantined and expired batches typed-rejected on
BOTH paths with ATP agreeing (availableNow 0); consignment typed-rejected
on both paths; the soft-model chain end-to-end (the theft posts, the
state is declared, the cancel settles the unbacked holder — zero ACTIVE);
the race's dichotomy pinned (the delivery always fulfills; the reserve
either fails closed with a TYPED error — the policy error or the choke
point's `ReservationQtyExceedsAvailableError` when its early check raced a
pre-commit snapshot — or holds its 6 with the over-commit exposure
visible).

## Item 3 — the CTP coverage vs batch expiry at every candidate date

**The finding (code reading, then proven):** the CTP walk computed the
shortfall against `availableNow` (the basis expiry-filtered at the
REQUESTED date) and walked the dated legs forward — a batch VALID at the
requested date but EXPIRED by a later candidate date kept backing the
promise: demand 20, 10 on hand (alive at the request, dead days later),
an inbound 10 → the suggested date was the inbound's, a date at which
only 10 units exist. Also: a LATE open PO (expected in the past, still
open) produced a suggested date IN THE PAST.

**The fix:** law 6 in the service contract — the coverage is computed PER
CANDIDATE DATE (`basisAt(date)` — the expiry-aware basis recomputed
against each dated leg's arrival date, reservations netted at every
date); the suggested date never precedes the as-of date (the late leg's
informative landing floors to today — law 5's mirror). The `availableNow`
semantics is documented as what it is: the promiseable basis at the
EFFECTIVE REQUESTED DATE (not "free stock today") — asserted by test.

**Pre-fix reproduction** (`... atp-ctp-expiry.spec.ts`):
**2 failed | 2 passed (4)** — the two failures ARE the finding:
- the audit's exact case: `expected '2026-11-24' to be '2026-11-29'` — the suggested date was the day(10) inbound (the dead batch counted as covering there) instead of the day(15) date the full 20 exist (10 + 12);
- the late PO: `expected '2026-11-11' to be '2026-11-14'` — a PAST suggested date instead of the as-of floor.
(The reservations-reduce-the-basis and availableNow-semantics laws passed
pre-fix — they document existing correct behavior, now pinned.)

**Post-fix proof:** same command — **4/4 passed** (the honest day(15)
suggestion, the as-of floor, the per-date basis, the documented
availableNow semantics with its own two-batch test).

## Item 4 — the co-product planning order (the id-swap)

**The finding (code reading, then proven — with a correction to the
audit's own model):** the leveling knew only component + substitution
edges; a co-product output carried NO edge to its producer. The walk
order between a producer and its co-product was decided by the LLC
STRING TIE-BREAK (both sit at LLC 0 when parentless — the audit's "LLC 0
vs ≥ 1" reading was corrected by the run: a parentless producer is ALSO
at LLC 0), so the plan CHANGED with the items' id creation order: an
id-first co-product planned BEFORE its producer — its independent demand
generated a full coverage suggestion for goods the producer's suggestion
was about to output (double-planning), and its components exploded for
the over-planned qty.

**The fix:** the OUTPUT leveling edge (producer → its BOM's outputs) in
`mrp-engine-service.ts` — a co-product's planning always nets AFTER every
producer feeding it; THIS RUN's own production suggestions count as its
inbound BEFORE its coverage suggestion is issued, deterministically in
BOTH id orders. A degenerate mutual-production pair now fails closed with
the typed `BomGraphCycleError` (documented).

**Pre-fix reproduction** (`... mrp-coproduct-order.spec.ts`): **3/3
FAILED** —
- the co-first pair without a BOM: the co-product received a `PURCHASE_ORDER 10` (the producer's make order 10 was about to output it);
- the id-swap pair WITH BOMs: `expected [ { …(25) } ] to have a length of +0 but got 1` — the co-first ordering issued the co-product's own make order (over-planned by the whole co-output); the main-first ordering (run in the same test) planned it right — the position dependence itself;
- the beyond-co-supply case: `expected 14 to be 4` — the co-product planned its FULL 14 demand (the co-supply 10 unseen), never the uncovered 4.

**Post-fix proof:** same command — **3/3 passed**: both id orders produce
the IDENTICAL plan shape (asserted equal — `PRODUCTION_ORDER:10|||PURCHASE_ORDER:10`);
the co-product with demand beyond the co-supply (14 − 10) drives its own
make order for exactly 4 with its component exploding for 4 — never
dropped, never over-planned; the CO_PRODUCT supply line and the MPS
demand rows ride the snapshot (the evidence trail).

## Item 5 — the unreserved double promise (an OPEN decision, raised not made)

**The proof (the behavior is asserted, deliberately unchanged):**
`... atp-unreserved-promise.spec.ts` — **1/1 passed** (pre- AND post-fix:
this spec proves the exposure, it does not fix it): two customers, two
ISSUED UNRESERVED lines of 10 against the ONLY 10 units — **BOTH stamp
OK** with `availableNow 10.000000`. The protection boundary is pinned in
the same test: the moment ONE line reserves, the other's re-check flips
SHORT (availableNow 0) — only reservations hold. **The answer to the
audit's question: the ATP "OK" is an ADVISORY availability check at
check-time — it reserves nothing, holds nothing, protects nothing.**

**The raise:** the decision is now OPEN BY RECORD, not settled by
documentation — **RISK-032** in `docs/planning/RISK_REGISTER.md` (the
policy is DOCUMENTED but NOT APPROVED): the owner must choose (a)
auto-reserve at issue, (b) a blocking ATP gate at issue, or (c) the
declared soft model with the exposure surfaced at the point of promise.
The service header's law 4 carries the open-decision declaration. The
decision is on the PHASE-045 start-review path.

## Item 6 — the self-test count, the visual-baseline distinction, the open deviations

- **The 14 vs 15 discrepancy — a transcription error, corrected:** the
  self-test script prints exactly **14 probe lines** — (1)(2)(3)(4)(5)
  (5b)(5c)(6)(7)(8)(9)(9b)(9c)(9d) — verified by reading the `check()`
  calls in `scripts/check-id-ledger.ts` AND by the run output; the
  previous ledger and the completion report said "15/15" — a count of a
  line that does not exist. Both documents are corrected IN PLACE with
  the correction marked and dated (the runs themselves never changed:
  0 errors / 0 warnings then and now).
- **The visual-baseline distinction stands:** the design-system harness's
  two-run protocol (first run WRITES the gitignored baselines per the
  documented first-run protocol, the second run COMPARES) is stated as
  what it is in the completion report §5 — it is NOT a comparison against
  a trusted historical reference; the baselines are local by design.
  Unchanged this round (no web-side changes — see the gate table).
- **The async/progress deviation stays open:** the delivered engine runs
  synchronously within the caller's UoW (the PHASE-043.md §4/§7 deviation
  records); the async+progress mode remains future work.
- **RISK-031 stays open** — none of these fixes represents production
  approval, and RISK-032 joins it on the open list.

---

## The gate sweep at this round's final head (actually run, this session)

| Gate | Command | Result (this session, this head) |
|------|---------|----------------------------------|
| FULL DB suite (one process, one embedded PG, sequential specs) | `vitest run --config vitest.db.config.ts src/__db__/` (apps/api) | **220/221 files · 3,136/3,137 tests passed; 1 failed** — the `performance/soak-shaped.db.spec.ts` queue-depth spike (maxDepth 7 vs the budget baseline+4=5, at the t=61s nightly-job injection instant). **Standalone rerun of that one spec: PASSED** (maxDepth 2, far inside the budget) — an environment-load sensitivity of the 2-core sandbox under the full-suite warm process (the spec is unchanged this round; the previous round's evidence already carries the "soak peak margin +1" sensitivity history). NOT merged into a combined claim: the full-run failure and the standalone pass are reported as exactly that. |
| The five new audit specs | `vitest run --config vitest.db.config.ts <the five files>` | **19/19 passed** (post-fix; the pre-fix failures are quoted per item above) |
| api unit + property | `pnpm test` (root, all packages) | **8/8 tasks · 616+38+36 unit tests passed** |
| typecheck | `pnpm typecheck` (root) | **8/8 clean** |
| lint (canonical, module boundaries) | `pnpm -w lint` | **8/8 clean** |
| dependency-cruiser | `pnpm lint:depcruise` (2905 modules) | **no violations** |
| id-ledger + self-test | `pnpm check:id-ledger -- --self-test` | **0 errors, 0 warnings; 14/14 probes OK** |
| permissions drift | `pnpm check:permissions-drift` | **291 = 291** |
| industry manifests | `pnpm validate:manifests` | **13/13 valid** |
| docs validation | `pnpm docs:validate` | **33/33 passed** |
| negative boundary meta-test | `pnpm boundary:negative-test` | **PASS** (the fixture fails as required) |
| negative erp-ui lint meta-test | `scripts/ci/negative-ui-rules-test.sh` | **PASS** (all four rules fail their fixtures) |
| negative i18n parity meta-test | `pnpm boundary:negative-i18n-test` | **PASS** (the drifting fixture fails) |

**NOT re-run this round (no web-side or design-system changes — the last
actually-run results stand at `d7a65d5`'s sweep, in
`2026-11-14-post043-audit-fixes.md`):** web build 8/8, web-security 6/6,
token-contrast AA, ui-catalog 39↔62, i18n parity 5,767 = 5,767, the
design-system visual harness. This round's changes touch `apps/api` (five
services + two stores) and `docs/` only.

**RISK-031 and RISK-032 remain OPEN. Nothing here is production approval.**
