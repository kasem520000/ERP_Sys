# PHASE-048 W-10 evidence — 2026-11-20 (this session, the working clone at `e5efb29`)

Every log below was generated THIS session (the same-session evidence rule, the
EIGHTEENTH consecutive wave) in `/home/z/erp-w9/ERP_Sys` (the clone at the
owner-accepted W-9 head `e5efb29`), captured through `scripts/capture-evidence.sh`
(the W-6 vitest-summary-guarded wrapper; the VERDICT rule everywhere: the summary
lines or the guarded stamp, never the raw process code alone — A-2/NF-12). The four
quarters of every test session (command, stdout+stderr, exit stamp, timestamps)
are preserved verbatim — NF-7's permanent rule.

## The logs (24 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at the W-10 head | EXIT=0 |
| `lint.log` | lint 8/8 packages (the ADR-0009 no-float law held — the W-10 pure layer is all exact scaled-integer BigInt; the day/date arithmetic reuses the W-9 integrality-guarded helpers) | EXIT=0 |
| `depcruise.log` | no violations — **2,018 modules · 15,056 dependencies** (the W-9 baseline 2,006 · 14,951 — ADDITION-ONLY growth: +12 modules · +105 deps, the twelve new W-10 files) | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — **api 62·776 (60·712 + the W-9 pure spec 1·27 + the new W-10 pure spec 1·37)** · web 13·122 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-full-single-process.log` | **THE FULL DB SUITE IN ONE PROCESS — 264/264 files · 3,743/3,743 · 0 failed · 0 skipped, Duration 554.04s** (within this session's command cap). THE HONEST PROVENANCE: the first chunk invocation carried a mistyped chunk-list path (`../../tools-w10/` — one level short), so `$(cat …)` expanded EMPTY and vitest ran the ENTIRE suite instead of the smoke chunk; the run is completely real (the stamp + the counts + the duration are the run's own), the log is kept under its true name, and the five precomputed chunks were then executed as planned below — BOTH envelopes in evidence, the stronger reading | VITEST_EXIT=0 |
| `db-suite-chunk-smoke.log` | chunk 1 of the precomputed five (the smoke family): migrations + the isolation family — 3 files · **1,783 tests** (the embedded PG16 booted + the 103-chain applied from zero in-process) | VITEST_EXIT=0 |
| `db-suite-chunk-perf.log` | chunk 2 (the perf family): 6 files · 24 tests | VITEST_EXIT=0 |
| `db-suite-chunk-a.log` | chunk 3: 86 files · 644 tests | VITEST_EXIT=0 |
| `db-suite-chunk-b.log` | chunk 4: **85 files · 672 tests — the projects family WHOLE at the new count** (the W-9 pair + the three new W-10 specs 9 + 7 + 10 = +26) | VITEST_EXIT=0 |
| `db-suite-chunk-c.log` | chunk 5: 84 files · 620 tests | VITEST_EXIT=0 |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF** — initdb → the 103-chain from zero → `[check-rls] OK — 318 catalog tables` (0 violations) → the clean shutdown | EXIT=0 |
| `permissions-drift.log` | matrix **326 = seed 326** (unchanged — the fourteen W-8 keys stand; zero new keys at W-10: the routes bind EXISTING keys) | EXIT=0 |
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

**264 files · 3,743 tests · 0 failed · 0 skipped** — the W-9 baseline (261 ·
3,717) + the three new W-10 specs (`projects-change-orders.db.spec.ts` 9 ·
`projects-evm.db.spec.ts` 7 · `projects-ias23.db.spec.ts` 10 = +26). The
precomputed plan (the owner's W-10 item 7, built BEFORE the first run and
coverage-verified against the repo inventory — 264/264, no duplicates): the
smoke 3 · 1,783 + the perf 6 · 24 + 86 · 644 + **85 · 672 (the projects family
whole)** + 84 · 620 — every top-level family COMPLETE in its chunk (the W-7/W-9
accepted pattern). Every chunk through the guarded wrapper; every stamp
VITEST_EXIT=0; the summary lines in each log. The single-process full run above
is the same count in one envelope.

## The three honest notes

1. **THE UNIT-FIRST CATCH (the W-9 precedent repeating)**: the pure layer's
   first shape carried a ×10² scale error in `aggregateWeightedPercent` — the
   percent divisor multiplied `weightSum` by 10² when the weightedPct(minor-6)/
   weightSum(minor-4) ratio ALREADY sits at the percent's own minor-2 scale (the
   W-9 rollup's own scale note), rendering 0.56 for the 56.44 world. The unit
   spec's hand-computed arm went red on the first run (5 failed of 37 — three of
   them the same scale bug's arms, two the spec's own hand-computation slips,
   corrected at the claim site); the fix landed BEFORE any store, service, or
   db spec consumed the fold.
2. **THE MISTYPED FIRST CHUNK COMMAND (kept verbatim, both envelopes)**: the
   first chunk invocation's list path was one level short, `$(cat …)` expanded
   empty, and vitest ran the ENTIRE suite — which COMPLETED GREEN at 554.04s
   (the W-9 session's slower machine had been killed at its 598s cap; this
   session's machine made it). The log is kept under its true name
   (`db-suite-full-single-process.log`); the five precomputed chunks were then
   executed exactly as planned. The verdict everywhere: the summary lines or the
   guarded stamp (A-2/NF-12).
3. **THE FAMILY ORDER DISCOVERY + THE FORWARD FIX (disclosed)**: the
   `__db__/projects/` family's vitest file order is NOT alphabetical (it shifts
   with file mtimes) — the W-9 spec's beforeAll seeded its coherent world
   UNCONDITIONALLY, so any order that ran a W-10 spec first (whose
   `ensureP1BudgetWorld` fixture helper builds the SAME world to be
   standalone-runnable) double-minted the entries/journals and broke the W-9
   arms (observed live in one family run: 13 W-9 arms skipped). REPAIRED
   test-only, the minimal guard: the W-9 spec's beforeAll gains the SAME probe
   the fixture helper uses (the W-9 entry's own narrative) — its ARMS stay
   byte-identical; the change-order spec's unmapped-refusal arm gains the
   supersede-then-map order-robustness (a sibling spec may have mapped the G-58
   pair first). The family then verified green in MULTIPLE observed orders
   (including the previously-failing one) and in the chunk + the full run.
   Zero production change.

## The W-10 constants (the owner's item 6, all held)

- **Zero migrations** — the journal stays at 0103; the chain re-proven from
  zero twice this session (the suite's embedded boot + the standalone scratch).
- **ENTITY_CATALOG 318** — no new tables (W-10 is a code wave over the W-8
  schema).
- **Drift 326 = 326** — zero new permission keys; the eleven new routes bind
  EXISTING W-8 keys.
- **ROUTE_PERMISSIONS 1007 → 1018 (+11, dated at the block)** — evm.view (the
  engine's own surface) · change_order.view (the authoring + reads — BR-094's
  gate makes authoring safe) · change_order.approve (THE GATE) ·
  budget.view/budget.manage (the IAS-23 rides the budget plane — D-11's own
  scope law, the dated reading recorded at the block).
- **i18n 6,433 + 371** — no delta (the web screens are W-12/W-13's).
- **The report registry 110** — W-14's.
- **The ID_LEDGER reservations STAND** — the flip is W-15's.
