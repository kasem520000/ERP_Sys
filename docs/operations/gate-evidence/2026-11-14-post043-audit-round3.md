# Gate evidence — PHASE-043 audit round 3 (2026-11-14)

**Scope:** the owner's round-3 review of `2b1f20f` (the round-2 delivery
head). The owner PROVED two defects independently on PostgreSQL (both
confirmed here on the live DB first, then fixed, then re-proven), asked
for the three still-unproven observations to be tested the same way
(the MTO cycle after the order's cancellation, the reservation query
limits, the G-49 contradiction), and instructed: every completed step
pushed to the repository; the risks and deviations stay OPEN; PHASE-045
is NOT started.

The six items of this round (all under `apps/api`, all run through the
DB-suite runner — embedded PostgreSQL 16, singleFork, one process, one
database, sequential specs):

| # | File | Tests |
|----|------|-------|
| 1 | `atp-ctp-expiry.spec.ts` (the round-3 edge appended) | 5 |
| 2 | `mrp-coproduct-order.spec.ts` (the P5 scope-expansion case appended) | 4 |
| 3 | `mto-lifecycle.spec.ts` (the dead-line guard appended) | 5 |
| 4 | `mto-reservation-page.spec.ts` (NEW — the query-limits spec) | 2 |
| 5 | `planning-goldens.spec.ts` (the G-49 actual-qty probe appended; the first G-49 title corrected) | 13 |
| 6 | `reservation-basis.spec.ts` (unchanged — the G-49 soft-model pin re-run) | 6 |

---

## Item 1 — the CTP floor's coverage (the owner's proven defect)

**The owner's reproduction (confirmed verbatim here):** a batch of 10
that died YESTERDAY (before the as-of date) + a LATE open inbound of 10
expected the day before (a RAW candidate date at which the batch was
still alive: 10 + 10 = 20 covered) + a demand of 20 produced SHORT with
`suggestedDate` = TODAY — a date at which only 10 exist. The walk judged
the coverage at the RAW leg date (`basisAt(leg.date)`) and floored the
ANSWER afterwards — the expiry falling between the raw date and the
floored date was never re-judged.

**The fix:** the floor precedes the judgment — the candidate the promise
would actually NAME is `max(leg date, as-of)`, computed FIRST, and the
coverage (the expiry-aware basis AT the floored date + the dated legs
landing on/before it) answers for THAT date. An insufficient floored
candidate is REFUSED and the walk continues to the next leg.

**Pre-fix proof** (`... atp-ctp-expiry.spec.ts`, the round-3 test):
**1 failed** — `expected '2026-11-14' to be null` (suggestedDate was
TODAY — exactly the owner's finding). **Post-fix: 5/5** (the minimal
case: SHORT, availableNow 0, suggestedDate NULL; the walk-past variant:
the same dead batch + the late 10 + a future 12 at day(15) → the
suggestion is day(15), never today). The four round-2 laws unchanged.

## Item 2 — the co-product scope expansion (the owner's proven defect)

**The owner's reproduction (confirmed verbatim here):** the P4
beyond-co-supply case re-scoped to `scopeItemIds: [p.main]` — the
co-product's OWN make order existed (its MPS 14 netted against the
run's co-supply 10 → 4) but its COMPONENT (`craw`) received NOTHING:
`expected [] to have a length of 1 but got +0`. The closure treated
co-product outputs as SUPPLY-ONLY members ("no traversal") — a
co-product with its own BOM and independent demand is a PRODUCER in its
own right, and its recipe's members never joined the plan: the make
order's explosion demand landed on an item the walk never visited and
VANISHED (the item-2 silent-drop family through the output edge).

**The fix:** `scopeClosure` TRAVERSES co-product outputs like any
member — the output's own recipe's members (components, substitutes,
its own co-outputs, transitively) join the closure. The Set guard keeps
the traversal finite; the leveling's OUTPUT edge still guarantees
producer-before-co-product; the plan stays deterministic in both id
orders.

**Pre-fix proof** (the owner's modified P4, reproduced with debug
output this session: the co's suggestion PRODUCTION_ORDER 4 existed,
`craw` had no suggestion and no snapshot demand row). **Post-fix: 4/4**
(the new P5 test with scope `[p.main]`: the closure records
{main, co, raw, craw} with `requestedItemIds = [main]`; main MO 10;
raw PO 10; the co's own make order 4 @ 03-12; craw PO 4; the
CO_PRODUCT supply line and the craw BOM_EXPLOSION demand row (parent =
the CO) ride the snapshot). The FULL manufacturing folder +
reporting/mrp-planning re-run: **25 files, 153/153** (the round-2
id-swap, scope-closure chain, timing, conversion-race, goldens,
explain-budgets all unchanged).

## Item 3 — the MTO cycle AFTER the order's cancellation (the owner's unproven observation — now proven)

**The finding (code reading, then proven):** the completion created the
availability holder whenever `salesOrderLineId <> null` — with NO check
that the linked sales order was still alive. The reproduction: the
order CANCELLED while the MO is in progress (the cancel's release runs
and finds nothing — holders exist only from completion: clean BY
CONSTRUCTION at that instant), then the MO completes → the holder is
created FOR THE CANCELLED LINE, and NOBODY can ever settle it: no
delivery can post for a cancelled order (ISSUED-only) and the cancel's
release had already run — an ACTIVE row netting availability FOREVER
(the round-2 item-1 leak family through the completion door).

**The fix:** the dead-line guard at the completion — the linked line's
sales-order status read through a thin named query
(`findSalesOrderStatusByLine`); CANCELLED/CLOSED (or a vanished line)
creates NO holder: the made-for-order stock lands FREE, the skip is
AUDITED (`mtoSkipReason` in the completion's audit after-record). The
completion itself is never blocked by the dead link.

**Pre-fix proof** (`... mto-lifecycle.spec.ts`, the round-3 test):
**1 failed** — `expected [ { …(11) } ] to have a length of +0 but got 1`
(the leaked holder). **Post-fix: 5/5** (zero ACTIVE holders after the
completion; the produced 10 recover fully in `reservationAvailability`;
the completion's own controls unchanged).

## Item 4 — the reservation query limits (the owner's unproven observation — now proven, BOTH arms)

**The finding (code reading, then proven):** the MTO settlement fold
`listActiveMtoReservationsForSalesLine` — the ONE input of the delivery
settlement (step 5a), the fully-delivered finalization (5c), and the
order-side terminations (cancel/close) — composed TWO PAGINATED reads:
`listProductionOrders(salesOrderLineId, limit 100, OLDEST-first)` then
`invStore.listReservations(itemId, warehouse, ACTIVE, limit 500)` —
**CLAMPED TO 200 BY THE STORE, NEWEST-first**. A busy item's MTO holder
fell off EITHER page and the fold returned NOTHING for it: the
settlement retired nothing, the cancel released nothing — the holder
leaked ACTIVE forever (the round-2 item-1 leak family through the
pagination door).

**The fix:** ONE EXACT JOIN — `listActiveMtoHolderReservationsForLine`
(the manufacturing store): every ACTIVE PRODUCTION_ORDER-holder
reservation whose production order is linked to the line, oldest MO
first, NO LIMIT, NO page. A line's MTO chain is business-bounded, and
the settlement must see ALL of it.

**Pre-fix proofs** (`mto-reservation-page.spec.ts`, the NEW round-3
spec, deterministic — each withTenant block is ONE transaction and
PostgreSQL now() is the transaction-start timestamp, so rows in
SEPARATE sequential transactions carry strictly increasing created_at):
**2/2 FAILED** — `expected 'ACTIVE' to be 'RELEASED'` in BOTH arms:
- **arm (a) the 200-reservation page:** the holder (tx1) + 201 NEWER
  manual reservations (tx2) — the newest-200 page (the fold's exact
  pre-fix input, asserted: length 200, the holder NOT in it) held no
  PRODUCTION_ORDER row → the cancel released nothing;
- **arm (b) the 100-MO page:** 100 filler DRAFT MOs linked to the line
  (tx1, the oldest 100 the ASC page keeps) + the victim MO completed
  LAST (tx2, the 101st, strictly newer — never in the fold's MO set) →
  its holderId never matched → the cancel released nothing.

**Post-fix: 2/2** (both holders RELEASED; the freed stock recovers in
`reservationAvailability` — arm (a): 310 on hand − 201 held = 109;
arm (b): 10 − 0 = 10). The full manufacturing folder + the sales folder
+ the inventory reservation sweeps re-run: **36 files, 234/234**.

## Item 5 — the G-49 contradiction (the owner's unproven observation — now verified and closed honestly)

**The verification (all behaviors pinned by tests, this session):** the
G-49 golden row's own text contradicted the shipped, tested behavior in
THREE places and described a mechanism that does not exist in a fourth:
1. "creates the HARD reservation" — the shipped hold is
   AVAILABILITY-level (the soft model): reservation-basis.spec test (c)
   proves another order's delivery PHYSICALLY CONSUMES the
   MTO-reserved 10. **6/6 re-run this session.**
2. "planned qty" — the holder carries the ACTUAL completed qty. **NEW
   PROBE** (planning-goldens G-49, the round-3 correction test):
   planned 12, consumed 9, completed 9 → the ACTIVE holder holds
   9.000000, never the planned 12. **13/13 this session.**
3. "released only on unbind" — the release paths are the delivery
   settlement (per shipped unit, MTO-first), the fully-delivered
   finalization, and the order's cancel/close (mto-surplus-cancel
   **5/5**), plus the round-3 dead-line guard (mto-lifecycle **5/5**).
4. "routes the output to the linked sales delivery — a DRAFT delivery
   note pinning the produced batch … the hook records the failure" —
   NO auto-draft delivery hook exists anywhere in the completion
   (verified by search); what ships: the FG batch lands at the linked
   order's warehouse (the link's warehouse contract) at the MO's actual
   cost, and the DN is raised MANUALLY with the batch pinnable per
   line.

**The corrections (in place, marked + dated 2026-11-14 — the round-2
"14/15" correction precedent, never a silent rewrite):**
JOURNAL_RULES G-49 (the authoritative row, with the correction note
quoting the original wording), ENTITY_CATALOG, PHASE-043-COMPLETION
(§3 + acceptance row 6), FEATURE_CATALOG, and the first G-49 golden
test's TITLE ("hard-reserved" → availability-reserved, the soft model,
RISK-032 open).

**WHAT STAYS OPEN (the owner's decision, untouched):** the hard-vs-soft
POLICY choice itself — RISK-032 remains open exactly as round 2 left
it; the corrections state what IS shipped and pinned, never what should
be.

## Item 6 — the owner's full-suite run notes (recorded, not attributed to the project per the owner's instruction)

- `ga-spike` failed in the owner's independent full-suite run then
  PASSED standalone. **Standalone here: PASSED** (11.6s — the same
  environment-load sensitivity family the round-2 ledger already
  records for the soak queue-depth spike; reported separately, never
  merged into a combined claim).
- Three spec files failed to START in the owner's audit environment due
  to a missing dependency, then passed after installing it — an
  environment gap, not a project defect (the owner's own framing;
  nothing changed here for it).
- One render test skipped in the owner's environment (browser env) —
  the web-side gates were NOT re-run this round either (this round
  touches `apps/api` + `docs/` only; `d7a65d5`'s web sweep stands).

---

## The gate sweep at this round's final head (actually run, this session)

| Gate | Command | Result (this session, this head) |
|------|---------|----------------------------------|
| The six round-3 spec files | `vitest run --config vitest.db.config.ts <the six files>` | **35/35 passed** (atp-ctp-expiry 5 · mrp-coproduct-order 4 · mto-lifecycle 5 · mto-reservation-page 2 · planning-goldens 13 · reservation-basis 6) |
| The FULL manufacturing folder + reporting/mrp-planning | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/ src/__db__/reporting/mrp-planning.spec.ts` | **25 files, 153/153 passed** (post fix-2) |
| The manufacturing + sales folders + the inventory reservation sweeps | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/ src/__db__/inventory/reservations-sweep.spec.ts src/__db__/inventory/reservation-sweep.spec.ts src/__db__/sales/` | **36 files, 234/234 passed** (post fix-4) |
| ga-spike standalone | `vitest run --config vitest.db.config.ts src/__db__/performance/ga-spike.db.spec.ts` | **PASSED** (1/1, 11.6s) |
| api typecheck | `tsc --noEmit -p tsconfig.json` (apps/api) | **clean** |
| lint (the changed files) | `eslint <the five changed sources + the manufacturing specs folder>` | **clean** |
| docs validation | `pnpm docs:validate` | **33/33 passed** |
| id-ledger + self-test | `pnpm check:id-ledger -- --self-test` | **0 errors, 0 warnings; 14/14 probes OK** |
| FULL DB suite (one process, one embedded PG, sequential specs) | `vitest run --config vitest.db.config.ts src/__db__/` | see the result appended below (run at this round's head, this session) |

**FULL DB SUITE RESULT (this session, at `bf081b4` + this ledger, one
process, one embedded PG, sequential specs — started 04:48:24 UTC,
duration 512.11s):**
**222/222 files passed · 3,141 passed | 2 skipped (3,143) — 0 failed.**
The 222 = the round-2 sweep's 221 + the new `mto-reservation-page.spec`;
the 3,143 = the round-2 total 3,137 + this round's 6 new tests (the CTP
floor's coverage, the co-product P5 scope expansion, the MTO dead-line
guard, the reservation-page arms (a)+(b), the G-49 actual-qty probe).
The 2 skips are `reporting/render.spec.ts` (the browser-environment
skip — the same one the owner's independent run skipped; an environment
conditional, not a regression). The soak-shaped queue-depth spec PASSED
INSIDE the full run this time (213.4s, budget intact — the
environment-load sensitivity history stays recorded above and in the
round-2 ledger; both observations stand as stated, never merged into a
combined claim). The four "POSTING INVARIANT FAILURE" log lines in the
output are the negative tests' EXPECTED rejections (INV-001/002
unbalanced-entry fixtures), not failures.

**NOT re-run this round (no web-side or design-system changes — the
last actually-run results stand at `d7a65d5`'s sweep, in
`2026-11-14-post043-audit-fixes.md`):** web build, web-security,
token-contrast, ui-catalog, i18n parity, the design-system visual
harness.

**RISK-031 and RISK-032 remain OPEN. PHASE-045 is NOT started. Nothing
here is production approval.**
