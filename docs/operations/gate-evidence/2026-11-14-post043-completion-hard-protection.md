# Gate evidence — PHASE-043 completion round: the reservation hard protection (2026-11-14)

**Scope:** the owner's directive after accepting the round-4 race fix at
`d817f84` — the MTO reservation must be protected ACTUALLY, per the
original phase criterion: (1) no other order or issue path can consume
the reserved quantity without an explicit authorized action; (2) the
correct beneficiary can consume it — partial delivery, cancellation,
closing, surplus, concurrency, and rollback all supported; (3) any
unlock needs a permission and a clear audit trail. Plus: ATP for
unreserved orders stays ADVISORY (OK is guidance, never a guarantee;
backorders remain possible; a shortage never blocks issuing a sales
order — the result is shown as unprotected until an allocation protects
it). RISK-032 stays open until the mitigation is implemented and tested
(it is, here — the risk remains open for the owner's review of this
head); RISK-031 stays open with its documented limits; the
async/progress deviation stays declared future work. The owner also
directed: PHASE-045 may START in parallel (starting 045 is not closure
of 043 nor production approval), the 043 head + evidence go for review
immediately without waiting for 045, and every completed step is pushed.

---

## Item 1 — the hard protection (the implemented mitigation)

**The pre-fix truth (the round-2 soft-model declaration, pinned until
this round):** a reservation was an availability-level hold only — it
netted ATP, the MRP basis, and later reservations' capacity, but the
issue paths checked ON-HAND only, so another order's delivery could
physically ship the reserved stock and leave an unbacked ACTIVE holder
(reservation-basis.spec test (c) pinned exactly this).

**THE GUARD (BR-081, implemented):** the movement core's single issue
choke point — `planIssue`, INSIDE the item_stock row lock every issue
already takes (CC-04) — enforces

```
onHand − qty ≥ reservedPool − allowance
```

where `reservedPool` = Σ ACTIVE non-expired `stock_reservations` at the
item+warehouse (`reservedQty` — one indexed fold,
`ix_stock_reservations_netting`), read UNDER the lock: every reservation
CREATION takes the same lock first (the round-2 choke point), so the
pool cannot grow beneath the issue; a concurrent release/consume only
SHRINKS the pool, which RELAXES the guard — fail-closed in the strict
direction (the only direction that could steal another holder's
coverage). `allowance` is carried ONLY by the delivery post (per
delivered line: the line's OWN ACTIVE non-expired reservation + the
ACTIVE MTO chain reservations feeding that line — the exact rows the
settlement retires). Every other caller — another order's delivery, a
standalone delivery, a manual issue, a transfer out, an adjustment, a
production consumption — passes none: FREE STOCK ONLY. The typed error
is `RESERVED_STOCK_PROTECTED` (machine-readable detail: on-hand, pool,
allowance, free-for-others). A negative-stock policy position exempts
the guard exactly as it exempts the on-hand floor (the same declared
policy).

**THE ALLOWANCE IS VERIFIED BY THE SETTLEMENT (the race-safety argument
— no new lock):** the delivery settlement retires the shipped qty
through EXACTLY the allowance's source rows (the MTO chain first, then
the line's own reservation — the round-2 contract, unchanged), and every
retirement is a conditional row update (`WHERE status='ACTIVE'`,
fail-closed on non-ACTIVE and on over-consume). A stale-high allowance
can therefore never commit: if any source row flips non-ACTIVE between
the allowance read and the settlement, the settlement THROWS and the
WHOLE delivery post rolls back (the issue with it); a release committing
after the settlement's row update finds the row CONSUMED and itself
fails. The stock_reservations ROW lock is the verifier.

**THE LOCK ORDER IS UNCHANGED (round-4's star, preserved):** the guard
adds NO lock (a plain indexed SUM under the already-held item_stock row
lock); the release/consume paths stay lock-free on item_stock (a
termination still acquires ONLY the sales header first — the round-4 law
"a termination never touches item_stock" holds); a delivery still never
locks the header. No cycle can form — the completion+cancel+close smoke
test of the race spec re-ran green, untouched.

**THE EXPLICIT AUTHORIZED UNLOCK:** there is deliberately NO bypass
parameter on any issue path. Taking reserved stock as anyone other than
the beneficiary requires the release first — the permission-gated route
(`inventory.reservations` feature + `inventory.stock.view` permission in
ROUTE_PERMISSIONS) whose service writes the `inventory.reservation_released`
audit event. The manual-issue path's rejection + the audited release +
the freed stock moving are all pinned by test (i).

**THE ROLLBACK HARDENING (found while proving this round's rollback
criterion):** the movement core's pending-position overlay keyed on the
drizzle tx handle, which R17 proved is STABLE across sequential
withTenant units-of-work — staged positions accumulated across
transactions, defended only by "committed values converge with the DB",
which is FALSE the moment a UoW rolls back after staging (the rolled-back
position stays overlaid for every later transaction in the process —
poison). The overlay now keys on the TenantContext OBJECT (the
R17-correct keying the bin-takes overlay already uses — entries die with
their transaction, by construction; commit and rollback BOTH clear
exactly when the transaction ends).

## Item 2 — the deterministic proof (`reservation-hard-protection.spec.ts`, NEW — 10 tests)

The harness (the race spec's patterns, per-scenario dedicated FG items):
`buildChain` parks a linked MTO chain one `complete()` away from done;
the completion lands the FG and creates the PRODUCTION_ORDER holder
(G-49's chain). Error codes are matched BY CODE (never by import), so
the spec RUNS at the pre-fix head — the before-run is the defect's own
proof.

**PRE-FIX (this session, at `d817f84` + the new spec only, verbatim):
8 failed | 2 passed** —

- (a) PREVENTION — the thief's delivery post RESOLVED (the steal):
  `promise resolved "{ delivery: { …(19) }, …(3) }" instead of rejecting`.
- (c) PARTIAL — the interleaved thief post RESOLVED (same steal shape).
- (d) SURPLUS — the blocked-surplus thief post RESOLVED.
- (e) TERMINATION — the pre-cancel thief post RESOLVED.
- (f) ROLLBACK — the thief-after-rollback post RESOLVED.
- (h) THE SERIALIZATION WINDOW — inside the observed window the thief
  committed and the beneficiary then failed:
  `expected '' to be 'RESERVED_STOCK_PROTECTED'` (the steal, observed
  under the lock).
- (i) ANOTHER ISSUE PATH — the manual issue of reserved stock RESOLVED
  (the unguarded path).
- (j) ATP STANDING — `expected undefined to be 'UNPROTECTED'` (the
  protection standing did not exist).
- (b) THE BENEFICIARY and (g) THE CONCURRENT RACE passed pre-fix (the
  beneficiary path worked without the guard; the race test's thief
  happened to lose the lock race that run — the steal is proven by the
  other eight).

**POST-FIX (this session, at the fix head): 10/10 passed** — every law
pinned: (a) the thief rejected with `RESERVED_STOCK_PROTECTED`, the
goods intact, the holder still backed, the delivery still DRAFT; (b) the
beneficiary ships the full 10, the holder CONSUMED, no orphan; (c)
partial 4 + thief-blocked + final 6, the remainder protected between
shipments; (d) the over-produced 15 held whole, released at the line's
full delivery (the released row carrying its REMAINING 5), the freed
surplus serving a new order; (e) cancel settles — the freed stock serves
another order; (f) a post failed at its LAST step (the DEL numbering,
docType-gated spy) leaves ZERO residue and the protection intact, the
retry succeeds; (g) the concurrent beneficiary+thief posts — no
deadlock, the beneficiary ALWAYS fulfills, the thief ALWAYS loses
(`RESERVED_STOCK_PROTECTED` or `INSUFFICIENT_STOCK` by serialization
order — never a steal); (h) the deterministic lock window: the thief's
post paused HOLDING the item_stock lock, the beneficiary observed
WAITING via `pg_locks`, the thief's guard rejected, its rollback
released the lock, the beneficiary shipped — the exact window where
pre-fix the thief stole; (i) the manual issue rejected, the audited
release (`inventory.reservation_released` asserted) opened the door, the
freed stock moved; (j) the UNRESERVED line's OK verdict carries
`UNPROTECTED` + the advisory note (the word "unprotected" verbatim), the
MTO-chain line carries `PROTECTED_BY_RESERVATION`, and a ZERO-stock
order still ISSUES (the backorder law — no ATP gate at issue, pinned).

## Item 3 — the flipped pins (the soft-model proofs rewritten)

- `reservation-basis.spec.ts` (c): the soft-model proof (the thief ships,
  the holder left unbacked) is rewritten as the hard-protection proof —
  the thief REJECTED, the goods intact, then the BENEFICIARY's own
  delivery ships and the holder retires CONSUMED.
- `reservation-basis.spec.ts` (c, the race): the dichotomy re-pinned —
  pre-completion the delivery ALWAYS fulfilled (the reserve-first arm
  left an unbacked pool of 6 on stock of 4 — the declared exposure);
  post-fix EXACTLY ONE side may take the stock (the reserve-first arm
  now ends with the delivery's `RESERVED_STOCK_PROTECTED`), and the
  pool-never-exceeds-stock invariant is asserted on both arms.

## Item 4 — the gate sweep at this round's final head (each row its OWN run, this session — never combined)

| Gate | Command | Result (this session, this head) |
|------|---------|----------------------------------|
| The hard-protection spec, PRE-FIX (at `d817f84` + spec only) | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/reservation-hard-protection.spec.ts` | **8 failed \| 2 passed** (verbatim above — the steal proofs) |
| The hard-protection spec, POST-FIX | the same command, at the fix head | **10/10 passed** |
| reservation-basis.spec (the rewritten (c) + (c, race)) | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/reservation-basis.spec.ts` | **6/6 passed** |
| The round-4 race spec (regression — the lock-order star untouched) | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/mto-cancel-complete-race.spec.ts` | **5/5 passed** |
| mto-surplus-cancel + reservation-overcommit + atp-unreserved-promise + mto-lifecycle + planning-goldens | folder runs during the sweep | **5+5+1+5+13 = 29/29 passed** |
| The manufacturing + sales + inventory folders | `vitest run --config vitest.db.config.ts src/__db__/manufacturing/ src/__db__/sales/ src/__db__/inventory/` | **62 files, 391/391 passed** (round-4's 61/381 + this round's new file and tests) |
| FULL DB suite, run 1 (pre-overlay-hardening) | `vitest run --config vitest.db.config.ts src/__db__/` | **1 file failed (mto-lifecycle, 2 tests — the consume path) \| 223 passed · 3,154 passed \| 2 skipped** — the failure's verbatim message was lost to the run's output window; it did NOT reproduce standalone (5 runs × 5/5) nor in any later full run |
| FULL DB suite, runs 2 and 3 (same tree, pre-overlay-hardening) | the same command | **224/224 files · 3,156 passed \| 2 skipped — 0 failed** (both runs) |
| FULL DB suite, run 4 (POST-ROLLBACK-HARDENING — the final head) | the same command | **224/224 files · 3,156 passed \| 2 skipped (3,158) — 0 failed** (started 11:17:19 UTC, duration 508.01s) |
| api typecheck | `tsc --noEmit -p tsconfig.json` (apps/api) | **clean** |
| lint (the changed files) | `eslint <the seven changed sources + the two specs>` | **clean** |
| docs validation | `pnpm docs:validate` | **33/33 passed** |
| id-ledger + self-test | `pnpm check:id-ledger -- --self-test` | **0 errors, 0 warnings; implemented: G 49 · INV 30 · BR 81** |

**The run-1 sensitivity, recorded honestly:** the first full-suite run
failed 2 mto-lifecycle tests at the MO-consume path; the verbatim error
was not captured (the tail window cut it) and the failure never
reproduced — standalone (5 consecutive runs green), in two further
full-suite runs on the SAME tree, or in the post-hardening run. The
investigation it triggered found and fixed a REAL latent defect in the
consume path's blast radius: the pending-position overlay's tx-handle
keying (R17's own finding) let a ROLLED-BACK unit-of-work poison every
later transaction's staged positions — the "committed values converge"
defense is false on rollback, and rollback support is this round's
explicit criterion. The overlay now keys on the TenantContext object
(entries die with their transaction). The run-1 failure itself is NOT
claimed as that defect's proof — it is recorded as an unreproduced
sensitivity on the pre-hardening tree, with the hardening delivered and
the final head's single-run evidence (run 4) green.

**NOT re-run this round (no web-side or design-system changes — the
last actually-run results stand at `d7a65d5`'s sweep, in
`2026-11-14-post043-audit-fixes.md`):** web build, web-security,
token-contrast, ui-catalog, i18n parity, the design-system visual
harness.

## Item 5 — the docs and the ledger

- `BUSINESS_RULES.md`: **BR-081** (the reservation hard protection) —
  the register's next sequential slot; the ID_LEDGER's coordinated
  ladder re-coordinated 2026-11-14 (every phase after 043 shifted +1:
  045 now BR-082…084 with the dated note in its posting-canon paragraph;
  046–051 likewise; the checker green at 0 errors).
- `RISK_REGISTER.md` RISK-032: the mitigation is implemented + tested
  (this round); the risk REMAINS OPEN for the owner's review of this
  head; the remaining policy choice (auto-reserve / blocking gate /
  advisory) stays the owner's; the owner's 2026-11-14 parallel-start
  directive recorded (045-start blocker lifted; starting 045 is not
  043-closure nor production approval).
- RISK-031: unchanged — open with its documented limits.
- The async/progress deviation: unchanged — declared future work, never
  described as delivered.
- `reservation-policy-service` / `atp-service` / `deliveries` /
  `orders` (checkLineAtp): the headers state the hard-protection
  contract and the advisory standing.

**THE OWNER'S OPEN DECISIONS, UNTOUCHED:** the remaining
unreserved-demand POLICY choice stays the owner's (RISK-032, open).
RISK-031 stays open with its documented limits. The async/progress mode
stays declared future work. PHASE-045 is STARTED per the owner's
parallel directive (its kickoff artifacts carry their own evidence) —
starting 045 is NOT closure of 043 and NOT production approval. This
head + this evidence go to the owner for review.
