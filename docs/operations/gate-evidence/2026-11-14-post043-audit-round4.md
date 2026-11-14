# Gate evidence — PHASE-043 audit round 4 (2026-11-14)

**Scope:** the owner's round-4 review of `65c3226` (the round-3 delivery
head). The owner independently verified the round-3 head (the six spec
files 35/35, then the owner's own full DB bundle: 222 files, 3,141
passed | 2 skipped — the owner's run, recorded here as the owner's, never
merged with any run below), then **PROVED the cancel/complete race on
the live DB**: pausing the completion AFTER its guard read of the sales
order's status, committing the sales order's cancellation in an
independent transaction inside that window, and then letting the
completion create the reservation — the order ended CANCELLED with an
ACTIVE MTO reservation of 10 nobody can ever settle. The owner asked
for: a safe serialization protocol between the completion and
cancel/close (lock order + deadlock considered), a deterministic test
reproducing the overlap, the reverse winning order and the close path
too (created-then-settled OR prevented — never an orphan), the archive
rebuilt or explicitly declared a stale snapshot (the owner's comparison
against the current head found 2 missing files and 14 different ones),
the affected gates re-run with results attached WITHOUT combining
separate runs, and instructed: the hard-vs-soft reservation decision and
RISK-032 stay with the owner (a description change is not a standard
change), RISK-031 and the async/progress deviation stay visible, PHASE-045
is NOT started until the new head is reviewed, and every completed step
is pushed to the repository.

---

## Item 1 — the cancel/complete race (the owner's proven defect)

**The owner's reproduction (restated deterministically here, PRE-FIX):**
the round-3 dead-line guard read the linked order's status with a PLAIN
`SELECT` and only then created the holder — a window between the two.
The round-3 test covered cancel-BEFORE-completion only; the owner's
interleave lands the cancel INSIDE the window.

**The deterministic harness** (`mto-cancel-complete-race.spec.ts`, NEW —
5 tests): `vi.spyOn` on the guard read (the budgeting spec's module-spy
precedent) splits the completion's ONE UoW exactly at the owner's
window — the REAL guard read runs inside the completion's transaction,
then the termination starts in its OWN `withTenant` UoW on its own
pooled connection, is observed from fresh committed reads, and only then
does the completion continue toward its holder decision. The observation
classifies the world without any timing dependence:

- **"slipped"** — the termination's effect COMMITTED inside the window
  (the sales order's committed status flipped while the MO's committed
  status was still IN_PROGRESS — the overlap itself, proven, not
  assumed). This is the pre-fix shape; it is the owner's proof.
- **"blocked"** — the termination is WAITING on an ungranted lock
  (`pg_locks`) while the completion's UoW holds the row — the
  post-fix shape, the serialization engaged. The pre-fix code holds no
  lock the termination could wait on (a plain SELECT never conflicts
  with the termination's writes), and the post-fix code makes the wait
  unavoidable — each world forces its own observation.

**PRE-FIX proof (this session, at `65c3226`, verbatim):**

- THE OVERLAP, cancel — **1 failed**: `the orphan check — an ACTIVE
  holder on a CANCELLED order is the leak (the owner's round-4 proof):
  expected [ { …(11) } ] to have a length of +0 but got 1` (observed
  shape "slipped": the order CANCELLED while the MO was IN_PROGRESS —
  the exact interleave, then the holder created for the dead line).
- THE OVERLAP, close — **1 failed**: the same leak on a CLOSED order
  (`expected [ { …(11) } ] to have a length of +0 but got 1`).
- THE PROTOCOL SMOKE (completion + cancel + close all in flight) —
  **1 failed**: `expected [ { status: 'fulfilled', …(1) }, …(1) ] to
  have a length of 1 but got 2` — BOTH terminations fulfilled pre-fix:
  two plain status reads, two status writes, the second silently
  overwriting the first (the termination-vs-termination door of the same
  race).
- The two REVERSE-WIN tests passed pre-fix (they pin the round-3
  sequential behavior under the race harness — the fix must not and did
  not change that arm).

**Pre-fix: 3 failed | 2 passed.**

**THE PROTOCOL (implemented, both lock sites documented):** the
`sales_orders` HEADER ROW of the linked order is the serialization
point —

1. **The completion side:** `findSalesOrderStatusByLine` (the planning
   store, the manufacturing module's own mirror) is now a LOCKING read —
   `SELECT … FOR UPDATE OF o` — held to the completion UoW's COMMIT,
   acquired at the latest-possible point (after the FG receipts and the
   posting, immediately before the holder decision), keeping the
   critical section to the reserve + patch + audit tail.
2. **The termination side:** `close`/`cancel` acquire the SAME row
   FIRST — the sales store's new `lockSalesOrderHeader`
   (`SELECT … FOR UPDATE`) runs BEFORE the status check, the status
   write, and the reservation release, so every termination serializes
   against every completion AND against every other termination (the
   loser of cancel-vs-close now sees the winner's terminal status under
   the lock and fails with the typed `SalesDocumentStateError`, never an
   overwrite).

**The two legal outcomes of the overlap (both pinned):**

- **Created-then-settled:** the termination waits on the row; the
  completion commits the holder; the termination's locked read returns
  (READ COMMITTED — the row was locked, never modified, by the
  completion, so no EvalPlanQual surprise), its status check passes, and
  its release loop sees the COMMITTED holder through its fresh snapshot
  and RELEASES it. Asserted: the holder row `RELEASED` at the full
  10.000000, the completion's audit `mtoReservationId` set,
  `reservationAvailability` recovers the full 10.000000, the observation
  recorded the order still ISSUED + the MO still IN_PROGRESS inside the
  window (a real overlap, not a sequential after-the-fact cancel).
- **Prevented:** the termination won the row and committed first; the
  completion's blocked read returns the POST-termination status and the
  round-3 guard skips — `mtoSkipReason` `LINKED_ORDER_CANCELLED` /
  `LINKED_ORDER_CLOSED` audited, no holder ever exists, the completion
  itself never blocked (the round-3 law preserved, re-asserted under the
  harness).

Never an ACTIVE holder on a dead order.

**LOCK ORDER (deadlock-free BY CONSTRUCTION — the wait-for graph around
the header row is a star):** the completion acquires its `item_stock`
rows (the FG receipts) BEFORE the header and never touches the sales
order's lines or reservations; a termination acquires the header FIRST
and never touches `item_stock` (its release path updates reservation
rows and line links only); a delivery never locks the header at all.
Whoever holds the header can always finish, so no cycle can form — the
smoke test races completion + cancel + close TOGETHER (three UoWs,
`allSettled`) and proves it empirically: no deadlock, exactly ONE
termination effect, the loser the typed state error, the completion
always fulfills, never an orphan.

**POST-FIX: 5/5** (both overlap tests observed the "blocked" shape —
the serialization engaged; both reverse-win tests skipped via the
audited reasons; the smoke's single winner + typed loser).

**Regression (each its own run, never merged):** the manufacturing +
sales + inventory folders **61 files, 381/381 passed**; the FULL DB
SUITE in ONE process, one embedded PG, sequential specs **(502.97s):
223/223 files passed · 3,146 passed | 2 skipped (3,148) — 0 failed**
(the round-3 single-run totals 222/3,143 + this round's 5 tests and 1
new file; the 2 skips are the browser-env render conditional, the same
one the owner's independent run skipped).

## Item 2 — the archive (the owner's staleness finding — confirmed, then rebuilt)

**The owner's comparison, confirmed here the same way** (`comm` against
`git ls-files` at `65c3226`): the delivered `ERP_PLATFORM_PHASE043.zip`
was built at `2b1f20f`'s content head (`afe0751`) — a snapshot of that
earlier head, NOT of the round-3 delivery head. Against `65c3226` it
showed exactly what the owner found: **2 missing files** (the round-3
additions `mto-reservation-page.spec.ts` and the round-3 evidence
ledger) and **14 different files** (the round-3 corrections carried at
their pre-round-3 content). The round-3 delivery commit updated the
ledger and the code without rebuilding the archive — the staleness was
real, and the round-3 ledger's "delivery" row did not disclose it. That
omission is corrected here: the archive is REBUILT at this round's final
head, and the rebuild rule now runs with every delivery.

**The rebuild (the round-1 item-8 rule, unchanged):** a review/restore
snapshot of EVERY git-tracked file at the delivery head (`git archive`,
byte-for-byte what git holds), EXCLUDING the root
`ERP_PLATFORM_PHASE*.zip` archives (the 11 phase zips the repository
carries — nested-zip bloat and the circular self-inclusion) and the
gitignored artifacts (not tracked by definition). The delivered zip is
built BEFORE its own commit from the content head (the docs commit that
carries this ledger); the delivery commit adds only the zip itself,
which the exclusion rule omits — so the archive is complete against the
FINAL head too, not just its build head. **COMPLETENESS PROOF (run at
build time, this session): recorded in the delivery commit message**
(the zip's file list vs `git ls-files` at the head, both `comm`
directions empty after the 11-zip exclusion).

---

## The gate sweep at this round's final head (each row its OWN run, this session — never combined)

| Gate | Command | Result (this session, this head) |
|------|---------|----------------------------------|
| The race spec, PRE-FIX (at `65c3226`, before the fix) | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/mto-cancel-complete-race.spec.ts` | **3 failed \| 2 passed** (the overlap-cancel orphan, the overlap-close orphan, the smoke's double termination — verbatim above) |
| The race spec, POST-FIX | the same command, at the fix head | **5/5 passed** |
| The manufacturing + sales + inventory folders | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/ src/__db__/sales/ src/__db__/inventory/` | **61 files, 381/381 passed** |
| FULL DB suite (one process, one embedded PG, sequential specs) | `vitest run --config vitest.db.config.ts src/__db__/` | **223/223 files passed · 3,146 passed \| 2 skipped (3,148) — 0 failed** (started 05:45:31 UTC, duration 502.97s) |
| api typecheck | `tsc --noEmit -p tsconfig.json` (apps/api) | **clean** |
| lint (the changed files) | `eslint <the four changed sources + the new spec>` | **clean** |
| docs validation | `pnpm docs:validate` | **33/33 passed** |
| id-ledger + self-test | `pnpm check:id-ledger -- --self-test` | **0 errors, 0 warnings; 14/14 probes OK** |

The full-suite run above had **no** environment-sensitivity incidents
this time (no ga-spike flake, no soak spike — both passed inside the
run); the round-2/round-3 sensitivity history stands as recorded there,
and this run is reported as its own run, never merged with the owner's
or with any earlier one.

**NOT re-run this round (no web-side or design-system changes — the
last actually-run results stand at `d7a65d5`'s sweep, in
`2026-11-14-post043-audit-fixes.md`):** web build, web-security,
token-contrast, ui-catalog, i18n parity, the design-system visual
harness.

**THE OWNER'S OPEN DECISIONS, UNTOUCHED:** the hard-reservation vs
soft-model POLICY choice and RISK-032 remain the owner's (the round-3
description corrections state what IS shipped and pinned, never what
should be — a description change is not a standard change). RISK-031
and the async/progress deviation remain open and stated. PHASE-045 is
NOT started — this head awaits the owner's review.

**RISK-031 and RISK-032 remain OPEN. PHASE-045 is NOT started. Nothing
here is production approval.**
