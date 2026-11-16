# PHASE-046 — the T-20 pinned technical notes, delivered BEFORE the floor's payroll adoption (2026-11-16)

Owner dispatch (the approval round): "before you adopt the T-20 floor in the
payroll writers, address or escalate these pinned notes on their track: (a)
normalize the UUID to canonical form before deriving the lock key, with two
permanent DB tests — overlapping attendance and overlapping leave in
parallel, the SAME uuid in two letter cases, the illegal state must not
save; (b) fix the deadlock probability between the day imports and the
overlapping derivation — do not be satisfied with app-side key sorting: do
not allow the lock set to expand after a partial set is reserved inside the
transaction, and make the acquisition order guaranteed at the database
level; re-test the two transactions on days 22/24 and 23/24 with the range
derivation 22–24 — no 40P01, correct final state; (c) harden the race
suite's synchronization — the current anyLockWaiter() checks for any
ungranted lock at the whole-DB level; bind the proof to the intended
transaction/lock or a specific test barrier." — These are NOT the §7(b)
documentation remarks (those stay an open W-7/T-15 input); they are
delivered here, on their own track, before W-3's payroll adoption.

## (a) THE CANONICAL KEY LAW — `modules/hr/infrastructure/atomic.ts`

`canonicalUuid()` (exported — PHASE-046's payroll key builders reuse it):
lowercase + optional dash-restoration, accepting every spelling PostgreSQL
accepts for the same uuid (upper/mixed case, undashed 32-hex); a non-uuid
fails LOUD (never a silently different key). Every key builder normalizes
its uuid components BEFORE composition — `attendanceDay`,
`attendanceDayKey` (the universe-key split), `leaveSpan`, `balanceCell`,
and the tenant prefix in `lockHrKeys` itself.

**The permanent proofs (duels 17–18, the race suite):** the same employee
raced through two letter cases of the SAME uuid (fixed letter-bearing
fixture uuids for A6/B8 — the shifts-roster all-digit-hex flake precedent):
- (17) MIXED-CASE ATTENDANCE — the uppercase loser blocks on the ONE
  canonical day key, then refuses typed `ATTENDANCE_SESSION_OVERLAP`;
  exactly one session, pairwise disjoint;
- (18) MIXED-CASE LEAVE — the uppercase loser blocks on the ONE canonical
  span key, then refuses typed `LEAVE_SPAN_OVERLAP`; exactly one request.

## (b) THE NO-EXPANSION LAW + THE DB-GUARANTEED ORDER

Two mechanisms, both in `lockHrKeys`:

1. **The database guarantees the order** — the lock statement now sorts the
   keys INSIDE PostgreSQL: `WITH ordered AS MATERIALIZED (SELECT k FROM
   unnest(...) AS k ORDER BY k COLLATE "C") SELECT pg_advisory_xact_lock(
   hashtextextended(k, 0)) FROM ordered`. The MATERIALIZED CTE stores the
   sorted rows before the outer scan evaluates the volatile lock function
   per row; `COLLATE "C"` pins byte order — EXACTLY the TypeScript `<`
   order on these ASCII keys, so the app-side ledger and the engine agree
   on one total order.
2. **The reservation LEDGER forbids the recipe** — a per-transaction
   WeakMap (keyed on the live UoW handle): re-entry of held keys is a
   no-op (advisory xact locks are re-entrant), strictly-ascending
   expansion is legal (provably equivalent to one sorted union call), and
   any key at-or-before the held maximum throws the typed
   `hr/lock-order-violation` BEFORE any lock statement runs. The wait-for
   graph stays a forest by construction.

**The writers restructured to the law (no expansion anywhere):**
- `leave approve` now takes its WHOLE set in ONE call — the new
  `lockLeaveApproval` gate (span + start-year cell together); the span
  re-check and the cap re-read both run under both locks;
- **the import commit reserves its WHOLE derive window up front** — the
  file's min…max dates × the file's employees (bounded by the import
  horizon, today−400d…tomorrow), not just the file's own pairs. Pre-fix
  this was the owner's exact 40P01 recipe: a file holding {22, 24} whose
  internal derivation then wanted 23 (a BACKWARDS expansion), against a
  concurrent import holding {23} wanting {24}. With the window reserved,
  the internal `deriveDays` acquisition is pure re-entry. The resolve
  path needed no change (its 1-day derive window is always the same day
  key it already holds).

**The permanent proofs:**
- (19) THE TWO-IMPORT × RANGE-DERIVATION DEADLOCK DUEL — import A on days
  {22, 24}, import B on days {23, 24}, and the range derivation 22–24
  (October 2026 — the import-horizon law) all in flight together: all
  three arms settle FULFILLED (no 40P01 anywhere, nothing refuses — the
  sessions are pairwise disjoint), and the final state is exact: 2/2/3
  disjoint sessions on days 22/23/24 (committed anchors + both files);
- (20) THE RESERVATION LEDGER — one whole-set call, re-entry, and
  ascending expansion are legal; the backwards expansion is the typed
  `hr/lock-order-violation` fired before any statement, and the
  transaction stays usable afterwards; a mixed held+backwards call is the
  same refusal.

## (c) THE BOUND WAITER PROOF — the race-suite hardening

`anyLockWaiter()` (any ungranted lock in the cluster — the false-positive
class) is REPLACED by per-duel bound expectations:
- **advisory duels** prove the loser waits on THE raced key: the waiter
  checks `pg_locks` for an ungranted advisory lock whose (classid, objid)
  equals the composed key's own `hashtextextended` tag — computed inside
  PostgreSQL, the same hash the floor uses;
- **row-lock duels** (the bridge's conditional CAS) prove the loser waits
  on THE WINNER'S transaction id — captured from the winner's own UoW at
  the split (`pg_current_xact_id()`), then matched against the ungranted
  `transactionid` wait.

**What the hardening found (the honest record):** duel (12) (accrual
recompute vs approve) had ALWAYS been proving the winner's ROW lock, not
the advisory cell lock — the accrual's `ensureBalanceCell(b5)` probes the
cell's unique index and waits on the winner's uncommitted UPDATE before
the run ever reaches its advisory bulk arm (empirically confirmed: the
loser's only ungranted lock was a transactionid wait). The duel's
expectation is now the truthful `{ winnerTx: true }`, and its post-window
legs still prove the cell gate's law (after the winner commits, the run
re-reads used=15.00 UNDER the cell lock and refuses typed
`LEAVE_ACCRUAL_INVALID`). The old whole-DB check masked this; the bound
proof records what actually serializes.

The ledger also caught a REAL fixture-batching shape in
`self-service.spec.ts` (one `withTenant` spanning two employees' leave
writers — a shape production never produces): the fixture now runs each
writer in its OWN UoW (the production shape — one request, one
transaction).

## The evidence (all in this environment, this session)

| Gate | Result |
|---|---|
| `pnpm --filter @erp/api typecheck` | clean |
| `pnpm --filter @erp/api lint` | clean |
| `pnpm typecheck` / `pnpm lint` | **8/8 packages** green |
| `pnpm lint:depcruise` | clean — 1,908 modules · 14,142 dependencies |
| `pnpm --filter @erp/api test` (unit) | **626/626** |
| The race suite | **20/20** (16 original duels on the hardened bound-proof harness + 17/18/19/20) — `pinned-notes-race-suite.log` |
| The hr folder | 13/13 files · 83/83 |
| payroll + isolation + spoof folders | 10/10 files · 1,649/1,649 |
| **THE FULL DB SUITE** (chunked, serial, foreground) | **240/240 files · 3,333/3,333 tests · 0 failed · 0 skipped** (3,329 + the 4 new permanent tests) — logs `pinned-notes-suite-chunk-*.log` |

**The T-20 floor is now canonical-keyed, expansion-proof, DB-ordered, and
bound-proven — ready for W-3's payroll adoption (D-09).**
