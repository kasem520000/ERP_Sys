# PHASE-048 W-9 evidence — 2026-11-20 (this session, fresh clone at `916510f`)

Every log below was generated THIS session (the same-session evidence rule, the
SEVENTEENTH consecutive wave) in `/home/z/erp-w9/ERP_Sys` (a fresh clone at the
owner-accepted W-8 head `916510f`), captured through `scripts/capture-evidence.sh`
(the W-6 vitest-summary-guarded wrapper; the VERDICT rule everywhere: the summary
lines or the guarded stamp, never the raw process code alone — A-2/NF-12). The four
quarters of every test session (command, stdout+stderr, exit stamp, timestamps)
are preserved verbatim — NF-7's permanent rule.

## The logs (24 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at the W-9 head | EXIT=0 |
| `lint.log` | lint 8/8 packages (the ADR-0009 no-float law held — the pure layer's day-arithmetic refactored to exact integer division, no `Math.round`) | EXIT=0 |
| `depcruise.log` | no violations — **2,006 modules · 14,951 dependencies** (the W-8 baseline 1,993 · 14,855 — ADDITION-ONLY growth: +13 modules · +96 deps, the thirteen new W-9 files) | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — **api 61·739 (60·712 + the new pure spec 1·27)** · web 13·122 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-chunk-smoke.log` | **THE FULL DB SUITE (chunk 1 of 5 — the smoke)**: migrations + the isolation family — 3 files · **1,783 tests** (the W-8 full-run smoke count; the embedded PG16 booted + the 103-chain applied from zero in-process) | VITEST_EXIT=0 |
| `db-suite-chunk-perf.log` | chunk 2 (the perf family): 6 files · 24 tests | VITEST_EXIT=0 |
| `db-suite-chunk-a.log` | chunk 3: 86 files · 644 tests | VITEST_EXIT=0 |
| `db-suite-chunk-b.log` | chunk 4: 82 files · 646 tests (the payroll family whole — the true-up act green) | VITEST_EXIT=0 |
| `db-suite-chunk-c.log` | chunk 5: 84 files · 620 tests | VITEST_EXIT=0 |
| `db-suite-single-process-attempt-timeout.log` | **THE HONEST DISCLOSURE, kept verbatim** — the single-process full-suite attempt hit this session's 598s command cap and was killed mid-run (no summary lines — a killed run, never a verdict); its world showed ONE failure (`payroll/statutory-routes.spec.ts` — the 046 W-5 TRUE-UP arm, "expected +0 to be 1") that does NOT reproduce: the payroll family ALONE is green this session (11·88) AND the family-whole chunk-4 run is green — the documented DB-suite serial-order/timing sensitivity class (the watch item), not a head defect | (killed — no stamp) |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF** — initdb → the 103-chain from zero → `[check-rls] OK — 318 catalog tables` (0 violations) → the clean shutdown | EXIT=0 |
| `permissions-drift.log` | matrix **326 = seed 326** (unchanged — the fourteen W-8 keys stand; zero new keys at W-9) | EXIT=0 |
| `id-ledger.log` | 0 errors (the 048 reservations G-55…58 · INV-033 · BR-092…096 STAND — the flip is W-15's) | EXIT=0 |
| `id-ledger-self-test.log` | the self-test — all 14 probes OK ✓ | EXIT=0 |
| `i18n-parity.log` | ar=6,433 = en=6,433 (no delta — API-only wave, the standing precedent) | EXIT=0 |
| `mobile-i18n.log` | mobile ar=371 = en=371 | EXIT=0 |
| `mobile-tokens.log` | 50/50 token derivations | EXIT=0 |
| `manifests.log` | 13/13 valid (no template content touched) | EXIT=0 |
| `docs-validate.log` | 33/33 checks | EXIT=0 |
| `history-secrets.log` | 0 violations | EXIT=0 |
| `capabilities.log` | capabilities matrix and fixture agree | EXIT=0 |
| `desktop-shell.log` / `mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative.log` | the negative boundary meta-test PASS | EXIT=0 |

## The full DB suite — the count and the chunk law

**261 files · 3,717 tests · 0 failed · 0 skipped** — the W-8 baseline (259 ·
3,689) + the two new W-9 specs (`projects-wbs.db.spec.ts` 15 ·
`projects-budgets-actuals.db.spec.ts` 13 = +28). The suite ran in FIVE chunks
(the W-7 delivery's accepted pattern: the smoke 3 · 1,783 — migrations +
isolation; the perf 6 · 24; then 86 · 644 + 82 · 646 + 84 · 620 — each
top-level family WHOLE in its chunk, the round-robin split's cross-family
plan-shape sensitivity discovered and avoided this session, disclosed below).
Every chunk through the guarded wrapper; every stamp VITEST_EXIT=0; the
summary lines in each log.

## The three honest notes

1. **The unit-first law caught three real scale bugs BEFORE any consumer
   landed** (the 047 talent-math precedent, doing exactly its job): the pure
   layer's first shape carried a ×10^2 scale error in the weighted-rollup
   fold, a ×10^4 in the curve/overhead/percent folds (the
   `roundDivHalfUp` scale-argument convention), and a ×10^2 in the
   percent-component divisor (the rate is the PERCENT number at 4dp — the
   fraction divisor is 10^6). The unit spec's hand-computed examples went red
   14/27 on the first run; all three fixed BEFORE any store, service, or spec
   consumed the folds; zero DB-side rework.
2. **The chunking discovery**: the first chunking attempt (round-robin
   balanced, families split across chunks) produced ONE false failure —
   `manufacturing/explain-budgets.db.spec.ts`'s OEE plan probe (a
   context-sensitive plan shape: the planner's Memoize path vs the asserted
   regex when the manufacturing family's predecessors are absent — the
   documented serial-order sensitivity class). The chunk plan was rebuilt
   family-whole (each top-level family complete in one chunk, its intra-family
   alphabetical order intact) — the W-7 shape — and the probe is green in
   chunk-3. Zero production change; the chunk plan is session tooling
   (`/home/z/erp-w9/tools/`, never part of the repository).
3. **The true-up flake + the command cap**: the single-process full-suite
   attempt was killed at this session's 598s command cap (the W-8-era run took
   9m14s; this machine is slower) — its log kept verbatim above. Its one
   failure (the 046 true-up arm — a real-HTTP posting act) did not reproduce
   in the family-alone run NOR the family-whole chunk run; it is the
   documented order/timing sensitivity class (the watch item), disclosed with
   both logs. The verdict everywhere: the SUMMARY LINES or the guarded stamp
   (A-2/NF-12) — the five chunk stamps are the suite's verdict.

## Static recounts this session (no run needed)

The migrations journal **0103** (103 entries — ZERO new migrations, the W-9
code-wave law) · `ROUTE_PERMISSIONS` **1007 rows = 988 + 19** (the W-9 block:
wbs.view/manage · budget.view/manage · allocation.manage · evm.view — the
W-8 keys' first route binding, matrix §3.26's dated note at the block) ·
`ENTITY_CATALOG` **318** (unchanged) · the drift checker's list **326**
(unchanged) · `REPORT_CONTRACTS` **110** (the +4 are W-14's) · the settings
registry gains TWO null-default keys (`projects.labor_standard_monthly_hours`
+ `projects.overhead_distributor` — the D-02 config-row precedent; both
pin-neutral by construction: a null default is omitted from the §5 policies
map, a structured setting never enters the flat map).
