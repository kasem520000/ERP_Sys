# PHASE-048 W-12 evidence — 2026-11-20 (this session, the working clone at `8610310`)

Every log below was generated THIS session (the same-session evidence rule, the
TWENTIETH consecutive wave) in `/home/z/erp-w9/ERP_Sys` (the clone at the
owner-accepted W-11 head `8610310`, the step commits `92af971` (T-13) +
`47ee755` (T-14) + this delivery commit), captured through
`scripts/capture-evidence.sh` (the W-6 vitest-summary-guarded wrapper; the
VERDICT rule everywhere: the summary lines or the guarded stamp, never the raw
process code alone — A-2/NF-12). The four quarters of every test session
(command, stdout+stderr, exit stamp, timestamps) are preserved verbatim —
NF-7's permanent rule.

**THE EXIT CRITERIA, STATED EXPLICITLY (the owner's W-11 disciplinary note —
the acceptance numbers named in every report from here on): W-12's exit is
acceptance criterion #8's API arms green (the SLA test matrix — the dispatch
board assigns technicians; the response/resolution clocks honor pause states
and escalate on breach, BR-096; completion records notes and parts) AND
acceptance criterion #2's web arm (the WBS board renders the tree, the
dependencies and the %-complete). BOTH GREEN with the evidence below.**

## The logs (25 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at the W-12 head | EXIT=0 |
| `lint.log` | lint 8/8 packages (ADR-0009 held — the SLA clock's register conversion runs in exact decimal; the first Math.round was caught by the lint law itself and replaced) | EXIT=0 |
| `depcruise.log` | no violations — **2,035 modules · 15,206 dependencies** (the W-11 baseline 2,026 · 15,129 — ADDITION-ONLY growth: +9 modules · +77 deps, the eight T-13 files + the board + the page + the test) | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — **api 64·810 (63·792 + the new W-12 pure spec 1·18)** · web 14·129 (13·122 + the board spec 1·7) · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-chunk-smoke.log` | chunk 1 of the precomputed five (the smoke family): migrations + the isolation family — 3 files · **1,783 tests** (the embedded PG16 booted + the **104-chain** applied from zero in-process — the chain is UNCHANGED at 0104; zero migrations ship in W-12) | VITEST_EXIT=0 |
| `db-suite-chunk-perf.log` | chunk 2 (the perf family): 6 files · 24 tests | VITEST_EXIT=0 |
| `db-suite-chunk-a.log` | chunk 3: 86 files · 644 tests | VITEST_EXIT=0 |
| `db-suite-chunk-b.log` | chunk 4: **87 files · 703 tests — the projects family WHOLE at the new count** (the W-9/W-10/W-11 six + the new fieldservice spec 20 = +20) | VITEST_EXIT=0 |
| `db-suite-chunk-c.log` | chunk 5: 84 files · 620 tests | VITEST_EXIT=0 |
| `db-suite-full-single-process.log` | **THE FULL DB SUITE GREEN IN ONE PROCESS ON THE FIRST RUN — 266/266 files · 3,774/3,774 tests · 0 failed · 0 skipped · 567.68s** (W-11's 265 · 3,754 + the one new spec 1 · 20) | VITEST_EXIT=0 |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF** (belt-and-braces — zero migrations ship, the standing gate still proven): initdb → the **104-chain** from zero → `[check-rls] OK — 318 catalog tables` (0 violations) → the clean shutdown | EXIT=0 |
| `permissions-drift.log` | matrix **326 = seed 326** (unchanged — the thirteen new routes bind EXISTING W-8 keys; ROUTE_PERMISSIONS 1,038 → **1,051**, dated at the two blocks) | EXIT=0 |
| `id-ledger.log` | 0 errors (the 048 reservations G-55…58 · INV-033 · BR-092…096 STAND — the flip is W-15's) | EXIT=0 |
| `id-ledger-self-test.log` | the self-test — all probes OK ✓ | EXIT=0 |
| `i18n-parity.log` | **ar=6,482 = en=6,482 (THE DECLARED DELTA +49 — D-14's first slice: the board's AR/EN pairs; the standing 6,433 breaks BY DESIGN at the first web wave)** | EXIT=0 |
| `mobile-i18n.log` | mobile ar=371 = en=371 (unchanged) | EXIT=0 |
| `mobile-tokens.log` | 50/50 token derivations | EXIT=0 |
| `manifests.log` | 13/13 valid (no template content touched) | EXIT=0 |
| `docs-validate.log` | 33/33 checks | EXIT=0 |
| `history-secrets.log` | 0 violations | EXIT=0 |
| `capabilities.log` | capabilities matrix and fixture agree | EXIT=0 |
| `desktop-shell.log` / `mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative.log` | the negative boundary meta-test PASS | EXIT=0 |

## The full DB suite — the count and the chunk law

**266 files · 3,774 tests · 0 failed · 0 skipped** — the W-11 baseline (265 ·
3,754) + the one new W-12 spec (`projects-fieldservice.db.spec.ts` — 20 arms).
The precomputed plan (the owner's standing clause 8, built BEFORE the first
run and coverage-verified against the repo inventory — **266/266, no
duplicates**: the diff of the disk list against the chunks' union is empty):
the smoke 3 · 1,783 + the perf 6 · 24 + 86 · 644 + **87 · 703 (the projects
family whole)** + 84 · 620 — every top-level family COMPLETE in its chunk
(the W-7/W-9/W-10/W-11 accepted pattern). **THE TIME CEILING COMPUTED BEFORE
COMMITTING**: the W-11 clean single-process run was 552.58s; the new spec
measured ~1s standalone and ~12–15s in the family context → projected ~568s
against this session's ~592s command cap — the commitment made, and the
actual run (**567.68s, GREEN ON THE FIRST RUN, zero flakes, no retry
needed**) landed inside it.

## The four-envelope proof (the W-10 law)

The new spec verified STANDALONE (the first runs), in the FAMILY (7 files ·
85 green), in the CHUNK (87 · 703), and in the FULL suite (the single-process
run above). The pure layer additionally proven in the api unit envelope
(64 · 810).

## The five honest disclosures (the W-11 count, all recorded at the claim sites)

1. **The unit-first law caught ONE hand-slip** in the pure spec's own first
   draft: the live-pause arm mis-stated the pause as one hour (it lasts from
   the pause event to now — two hours in the arm's world); THE FOLD WAS
   RIGHT, the arm corrected at the claim site (the W-11 precedent's repeat).
2. **The DB spec's first run carried three reds, ALL THREE the spec's own
   slips — zero production changes**: (i) the seeded pause interval came out
   8ms long (two separate SQL statements' `now()` differ by the
   inter-statement skew) — fixed by seeding the PAUSED/RESUMED pair in ONE
   statement (one `now()`); (ii) the pause-refusal sub-arm used an
   IN_PROGRESS visit, where pause legitimately SUCCEEDS — the arm's own
   world slip, corrected to the DISPATCHED visit; (iii) the seeding UNION's
   untyped `$1` param needed the explicit `::uuid` cast.
3. **The web spec's turbo-only leak**: the project-switch arm's mock returned
   an array for the EVM envelope — the test's own bug (standalone it passed;
   the fuller turbo run surfaced the unhandled continuation) — fixed with the
   path-dispatched mock + the settle-wait inside the arm. A robustness note
   recorded with it: the board trusts the BFF's typed envelope (the
   `ApiResult` contract) exactly as every other screen does.
4. **THE 045 TABS DEFECT — NOT TOUCHED, NOT AGGRAVATED (the owner's clause
   8)**: the board rides the DATA-SLOT shape exclusively (the immune shape,
   the W-5 boards' own precedent — every pane carries
   `data-slot="{value}"` and routes through the slots map); the component
   test's tab-switching arm is the recorded proof (all three panes render
   after switching, tree → timeline → EVM → back). The defect itself
   (hr-self-board's conditional-expression children) remains 045 scope,
   untouched by this wave.
5. **The ESLint ADR-0009 law caught the first `Math.round`** in the pure
   layer's register conversion (`hoursToMs`) — replaced with the exact-decimal
   multiply (`new Decimal(hours).times(3_600_000)`), Number() only at the
   integer-ms boundary. The law working as designed, disclosed for the
   record.

## The W-12 constants (the owner's clause 6, declared)

The chain **0104** (zero migrations — the wave is engine + web over the 0103
substrate) · zero seeded migrations · the catalog **318** (the scratch proof
above) · drift **326 = 326** · reports **110** (the four contracts are W-14's
D-15) · i18n **6,433 → 6,482 (+49 declared)** + mobile 371 · ROUTE_PERMISSIONS
**1,038 → 1,051** (+12 fieldservice + 1 the board's project pool, dated at
the blocks) · the DB suite **265 → 266 files · 3,754 → 3,774 tests**.
