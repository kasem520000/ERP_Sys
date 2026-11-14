# Gate Evidence — the PHASE-043 post-closure audit-fix wave (2026-11-14)

> **Scope:** the owner's independent audit of the PHASE-043 closure (head
> `8d73641`) raised eight items. Items 1–7 are code+test fixes, each with
> the practical pre-fix reproduction the audit demanded (code-reading
> findings were NEVER accepted as proof alone); item 8 is this evidence
> ledger + the documentation/archive corrections. Every gate result below
> was ACTUALLY RUN at the stated head — nothing is inferred, transferred
> from another session, or merged across runs. Failures encountered are
> listed as failures.

## 1. The audit items — fix → evidence

| # | The audit finding | The fix (commit) | Pre-fix evidence (run) | Post-fix evidence (run) |
|---|---|---|---|---|
| 1 | `check:id-ledger --self-test` failed probes 1/5/8/9b while the plain scan passed (the probes leaned on PHASE-043's live ledger state; its delivery flipped `isFuture` and the delivered-status exemption swallowed the checks) | The owner-based claim law + synthetic-fixture probes (1/5/8 on ids 880+ no canon reaches; 9/9b/9c/9d hold across both statuses) + the delivered-ownership map from §2's DELIVERED rows; the self-test added to `local-gate.sh` AND `ci.yml` (CI never ran this gate) — `817b276` | Self-test: probes (1)(5)(8)(9b) BROKEN ✗ (the run output captured verbatim in the commit) | Self-test **15/15 OK**; plain scan 0 errors/0 warnings; the NEGATIVE PROOF on the real scan path: mutating `PHASE-043.md`'s T-17 claim G-47→G-44 fails with `stale-claim … already implemented (PHASE-044)`, the revert restores 0 errors |
| 2 | The MRP scope dropped demand silently (signal-less components never planned in EITHER mode); deriveScopeItems requires an independent signal | The planning closure (transitive components ∪ substitutes ∪ co-product outputs) + the substitution wiring REWIRED to the component (the parent-keyed filter could never match) + the SINGLE-LEVEL explosion (the transitive kernel double-counted deep components) + the scoped LLC (a distant cross-BOM cycle killed every run) + the `replaceBomSubstitutions` `${undefined}` SQL hazard — `1b14700` | `mrp-scope-closure.spec` **3/3 failed** (NET_CHANGE scope = the FG alone, Array(1); REGENERATIVE missed the chain; the substitute got nothing); the zzz-position probe reproduced the `BomGraphCycleError` kill | `mrp-scope-closure.spec` **3/3** (the whole chain from the FG alone: mid MO + substitute PO 20 + the plain control PO 10 + co-product supply 5 + the qty-0 lineage row); the zzz probe green after the scoping |
| 3 | Suggestion-conversion races unprotected (the read→create→patch sequence; the unique index never prevented two DIFFERENT documents) | The LOCKED read (`SELECT … FOR UPDATE` in the caller's one withTenant UoW) + the `requireStatus` guarded patch; the overstatement comment corrected — `20dab71` | `mrp-conversion-race.spec` **both accepts created a document** (`[false, false]` replays — two MOs, one orphaned); accept-vs-dismiss produced BOTH effects | **3/3** — both accepts fulfill with ONE document and the loser's replay carrying the SAME documentId; exactly one effect per raced pair; the supersede pair consistent both ways |
| 4 | The MTO reservation lifecycle never reached the delivery (leaked ACTIVE holder); the delivery released EVERY line's reservation on ANY delivery; the link's contract implicit | The per-delivered-line PARTIAL settlement (MTO-first through `listActiveMtoReservationsForSalesLine` on the manufacturing application surface; `partiallyConsumeReservation`); the link's explicit contract (item + DRAFT + the WAREHOUSE match; qty deliberately unconstrained — documented) — `83d6023` | `mto-lifecycle.spec` **3/4 failed** (the full delivery left the MTO reservation ACTIVE: expected 0 got 1; the partial left it untouched at 10.000000; the warehouse mismatch resolved instead of rejecting) | **4/4** — the delivery CONSUMES the holder (0 ACTIVE left, stock 0, the non-delivered line keeps its coverage); the 4/10 partial settles to exactly 6.000000, the repeat consumes; the mismatch typed-rejected; cancel-before-completion clean |
| 5 | Over-reservation in every path (the policy engine verified RAW bins; the raw service/controller had NO check; nothing serialized; unbinned stock invisible) | The single creation choke point: `ReservationService.create` locks the item_stock row, then enforces new ≤ pickable bins + the unbinned fallback − the ACTIVE pool (the typed `ReservationQtyExceedsAvailableError`); the policy walk subtracts the pool too — `3c79a66` | `reservation-overcommit.spec` **ALL FIVE over-booked** (the policy 6+6 on 10; the raw route 6+6; BOTH concurrent reserves fulfilled; unbinned invisible; a stockless item accepted) | **5/5** — the second 6 typed-rejected with the pool exactly 6.000000; the exact remainder 4 ACCEPTED; concurrent = one winner, pool 6; unbinned through the fallback; stockless rejected |
| 6 | The ATP/CTP judgment ignored the requested date (available-now only); the truck promised (against BR-016); expiry ignored; undated legs promised | The six-law contract (expiry-aware basis; time-phased coverage over DATED legs; transfers/undated visible-never-promiseable; unreserved sibling demand does not reduce; past dates floored; OK-with-supply carries the informative landing date); the atp-position report's inbound fold aligned (transfers out) — `4930a76` | `atp-contract.spec` **4/5 failed** (dated supply in time → was SHORT; the expiring batch → was OK; the transfer's suggested date was THE AS-OF DATE — a promise off the truck) | **5/5** — every law asserted; the BR-080 golden unchanged |
| 7 | The horizon clamp (beyond-horizon signals landed in the last bucket); the surplus re-drawn per order; the in-flight fold SUM(qty)@MIN(due_date) | The explicit horizon boundary (beyond-horizon signals outside the plan; undated supply never counts); the finite per-warehouse surplus draw with multi-warehouse split; per-suggestion in-flight rows — `1cdd948` | `mrp-timing.spec` **3/3 failed** (the extra clamped MPS line; transfers [10, 10] = 20 off a 12 surplus; the in-flight [10.000000 @ 03-05] aggregate) | **3/3** — one order for the in-horizon demand (the beyond-horizon PO cannot suppress it); transfers [10, 2] = exactly 12, the remainder 8 bought; the in-flight legs [5 @ 03-05, 5 @ 03-15] and the honest net 5 bought @ 03-10 |
| 8 | Docs/evidence/archive honesty (§1 numbers, the async claim, the evidence report's run-vs-inferred distinction, the archive's purpose/completeness) | This ledger; the corrections listed in §3 below; the archive rebuilt per the explicit purpose+rule in §4 | — (documentation items) | `docs:validate` 33/33 at the final head |

**RISK-031 stays OPEN — deliberately.** Nothing in this wave touches the
INV-029 probe's semantics; no per-batch/per-serial correctness is claimed
on its behalf. These fixes do not represent production approval.

## 2. The gate sweep at the final head (every line ACTUALLY RUN, 2026-11-14)

| Gate | Command | Result |
|---|---|---|
| typecheck | `pnpm typecheck` | **8/8 packages**, zero errors |
| lint | `pnpm lint` | **8/8 packages** |
| boundaries | `pnpm lint:depcruise` | **no violations** (1,825 modules, 13,488 dependencies — the clean tree; the closure session's 3,147 counted the storybook build artifacts present in that environment) |
| permissions drift | `pnpm check:permissions-drift` | **291 = 291** (matrix §3.22 = the seed union) |
| id-ledger + self-test | `pnpm check:id-ledger -- --self-test` | **0 errors, 0 warnings; 15/15 probes OK** |
| manifests | `pnpm validate:manifests` | **13/13 valid** |
| docs | `pnpm docs:validate` | **33/33 checks passed** |
| unit + property | `pnpm test` | **8/8 packages** (api 616/616 — the kernel property tests unchanged) |
| negative boundary | `pnpm boundary:negative-test` | **PASS** (ESLint exits 1 on the fixture) |
| negative UI rules | `bash scripts/ci/negative-ui-rules-test.sh` | **all four rules fail their fixtures** |
| negative i18n | `pnpm boundary:negative-i18n-test` | **the drifting fixture fails the checker** |
| build | `pnpm build` | **8/8 packages** |
| design-system harness | `pnpm test:visual-harness-run` | FIRST RUN: 12 passed, **4 failed — the documented first-run baseline protocol** (`__image_snapshots__/` is gitignored; a fresh clone writes the baselines, the failure IS the write). SECOND RUN: **16 passed + perf 1 passed, EXIT=0** (axe clean both directions — the closure's PeriodGrid fix holds) |
| web security | `pnpm test:web-security` | **6/6 passed** |
| i18n parity | `pnpm check:i18n-parity` | **5,767 = 5,767, 100%** |
| token contrast | `pnpm check:token-contrast` | **all §16 pairs AA** |
| ui catalog | `pnpm check:ui-catalog` | **39 exports ↔ 62 rows, parity green** |
| **DB suite (the full chain)** | `pnpm test:db` (embedded PG16, migrations 0001–0079) | **216/216 files · 3,118/3,118 tests · EXIT=0** (the closure baseline was 211/3,098; +5 spec files +20 tests — the five audit specs) |

### Failures encountered on the way (honest list — all resolved, all re-run)

- The visual harness's first run "fails" 4 tests writing the gitignored
  baselines (the documented protocol — not a defect; the second run is the
  gate).
- The reservations-sweep and mrp-planning report specs needed re-basing
  under the item-5 guard (their fixtures reserved stockless items; the
  sweep's probe item now carries a standing stock row, the report's
  reservation a clean backing batch — the pinned arithmetic preserved
  exactly).
- The pre-fix evidence runs of the five audit specs (35 failing test
  results across items 2–7) are THE POINT of items 2–7 — captured in §1.

## 3. The documentation corrections (item 8)

- **ID_LEDGER §1**: the implemented inventory now reads G-01…G-49 ·
  INV-001…INV-030 · BR-001…BR-080 (through PHASE-043) — the table said
  "through PHASE-044" with the pre-043 counts.
- **PHASE-043.md**: the §7 mitigation no longer claims "async run
  execution with progress" — an explicit DEVIATION is recorded (the
  delivered engine runs synchronously within the caller's UoW, atomic
  all-or-nothing, bounded by the depth cap + the memoized kernel; the
  async+progress mode is future work, described as such nowhere else
  either); the acceptance criterion 1 states the honest migration range
  0074–0079 (the planned ≈0067…0072 slots were taken by 044).
- **The completion report**: the CR-36(g) note no longer calls the run
  "async … with progress"; §4 gains the audit-fix wave; §5 now points at
  THIS ledger (run-vs-transferred distinguished); §6 states the archive's
  purpose and inclusion rule (§4 below).
- **IMPLEMENTATION_STATUS**: the 043 narrative gains the audit-fix
  addendum.

## 4. The archive — purpose, inclusion rule, completeness proof

**Purpose:** a REVIEW/RESTORE SNAPSHOT of the repository's tracked source
at the delivery head — complete enough to review and to restore the
working tree from it (the git repository itself remains the authoritative
restore source).

**Inclusion rule:** EVERY git-tracked file at the head, EXCEPT the root
`ERP_PLATFORM_PHASE*.zip` archives (excluded to avoid nested-zip bloat and
the circular self-inclusion — the repository carries them; see below) and
the gitignored artifacts (node_modules, build outputs, the visual
baselines — not tracked by definition).

**Construction:** `git archive` (the tracked tree at the head — byte
for byte what git holds), then the previous archives deleted from the
stream. **Completeness proof:** the archive's file list equals
`git ls-files` minus the excluded zips — verified at build time with a
diff (recorded in the delivery commit).

**The circularity question:** the 043 zip is committed to the repository
AT delivery; building it from `git archive HEAD` would include the 042
zip (tracked) and — after its own commit — would attempt to include
itself on any REBUILD. The rule resolves it: previous archives are
excluded from the stream, and the delivered zip is built BEFORE its own
commit (the archive never contains itself; a rebuild from a later head
excludes it by the same rule).
