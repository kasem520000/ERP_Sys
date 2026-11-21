# PHASE-048 W-14 evidence — 2026-11-21/22 (this session, the working clone at `ce78bc7`)

Every log below was generated THIS session (the same-session evidence rule, the
TWENTY-SECOND consecutive wave) in `/home/z/erp-w9/ERP_Sys` (the clone at the
owner-accepted W-13 head `ce78bc7`, the step commits `0aae7f1` (T-17) +
`de09c8f` (T-18) + this delivery commit), captured through
`scripts/capture-evidence.sh` (the W-6 vitest-summary-guarded wrapper; the
VERDICT rule everywhere: the summary lines or the guarded stamp, never the raw
process code alone — A-2/NF-12). The four quarters of every test session
(command, stdout+stderr, exit stamp, timestamps) are preserved verbatim —
NF-7's permanent rule.

**THE EXIT, STATED EXPLICITLY (the acceptance numbers named): W-14's exit is
ACCEPTANCE CRITERION #6's GOLDEN TRANSCRIPTS + #9's RLS/OA-06 ARMS green —
the four rules each mirrored by a golden transcript with its mandatory failure
pack (the refusals WITH their full payloads, the zero residue, the
flip-and-restore), the INV-033 + IAS-23 goldens, the RLS attack matrix A1–A10
over all eleven tables with the standalone scratch chain, and the OA-06
EXPLAIN budgets (the rollup + the dispatch probes, index-driven, the plans
logged verbatim). MET — §8 of the gate doc. The cumulative ledger (§9 of the
gate doc) closes #6 WHOLE and #9's two remaining arms: #1…#9 all green; #10
is W-15's alone.**

## The owner's three standing recalls (every report, this one included)

- **(a) ROUTE_PERMISSIONS total: 1,052 — UNCHANGED.** W-14 is a zero-route
  wave: the four report contracts ride the EXISTING
  `/api/v1/reporting/report-runs` engine route (the reporting plane's own
  `reporting.reports.run` guard at the route; the per-contract key enforced
  AT RUN by the run service). The last dated block remains W-13's
  `(1051 + 1 = 1052)`.
- **(b) The five-package breakdown (the precomputed chunks, family-whole,
  coverage-verified BEFORE the first run — the union == the disk inventory
  271/271, the comm diff empty):** the smoke **3 files · 1,783 tests**
  (migrations + the isolation family, embedding the 104-chain boot from
  zero) + the perf **6 · 24** + **chunk a 82 · 596** + **chunk b 100 · 785
  (the projects family WHOLE at 12 files)** + **chunk c 80 · 619** = **271
  files · 3,807 tests** (W-13's 267 · 3,778 + the four new files' 29 tests).
- **(c) The new files' names (the families scope):**
  `apps/api/src/modules/reporting/registry/projects/evm-summary.contract.ts` ·
  `apps/api/src/modules/reporting/registry/projects/contract-progress.contract.ts` ·
  `apps/api/src/modules/reporting/registry/projects/retention-statement.contract.ts` ·
  `apps/api/src/modules/reporting/registry/projects/fieldservice-sla.contract.ts` ·
  `apps/api/src/__db__/projects/projects-reports.db.spec.ts` ·
  `apps/api/src/__db__/projects/projects-goldens.db.spec.ts` ·
  `apps/api/src/__db__/projects/projects-rls.db.spec.ts` ·
  `apps/api/src/__db__/projects/projects-explain-budgets.db.spec.ts`
  (eight: four contracts + four specs; the projects spec family 8 → 12).

## The logs (24 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at the W-14 head | EXIT=0 |
| `lint.log` | lint 8/8 packages | EXIT=0 |
| `lint-depcruise.log` | no violations — **2,054 modules · 15,372 dependencies** (the W-13 baseline 2,046 · 15,280 — ADDITION-ONLY: +8 · +92 across the two steps) | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — **api 65·816** (the fieldservice refactor behavior-preserving) · web 17·147 (unchanged — zero web delta) · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-chunk-smoke.log` | chunk 1 of the precomputed five: migrations + the isolation family — 3 files · **1,783 tests** (the embedded PG16 booted + the **104-chain** applied from zero in-process — the chain UNCHANGED at 0104; ZERO migrations ship in W-14) | VITEST_EXIT=0 |
| `db-suite-chunk-perf.log` | chunk 2 (the perf family): 6 files · 24 tests | VITEST_EXIT=0 |
| `db-suite-chunk-a.log` | chunk 3: 82 files · 596 tests | VITEST_EXIT=0 |
| `db-suite-chunk-b.log` | chunk 4: **100 files · 785 tests — the projects family WHOLE at 12** (the W-13 eight + the four W-14 specs). The first attempt carried ONE red (the fcm channel's async record race — disclosure 2 of the gate doc); the retry GREEN — this log | VITEST_EXIT=0 |
| `db-suite-chunk-c.log` | chunk 5: 80 files · 619 tests | VITEST_EXIT=0 |
| `db-suite-full-single-process.log` | **THE FULL DB SUITE GREEN IN ONE PROCESS — 271/271 files · 3,807/3,807 tests · 0 failed · 0 skipped · 554.42s** (W-13's 267 · 3,778 + reports 8 + goldens 7 + rls 10 + explain 4). The first attempt carried ONE red (the soak's queue-depth timing margin — disclosure 1, re-proven at BOTH heads); the retry GREEN — this log | VITEST_EXIT=0 |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF**: initdb → the **104-chain** from zero → `[check:rls] OK — 318 catalog tables` (0 violations) → the clean shutdown | EXIT=0 |
| `check-permissions-drift.log` | matrix **326 = seed 326** (unchanged — zero new keys; the three report keys are the W-8 seeds) | EXIT=0 |
| `check-i18n-parity.log` | **ar=6,620 = en=6,620 (ZERO DELTA DECLARED — the contracts' titles/descriptions are registry-bilingual inside the contracts, never dictionary keys)** | EXIT=0 |
| `check-mobile-i18n.log` | mobile ar=371 = en=371 (unchanged) | EXIT=0 |
| `check-mobile-tokens.log` | 50/50 token derivations | EXIT=0 |
| `validate-manifests.log` | 13/13 valid (no template content touched) | EXIT=0 |
| `docs-validate.log` | 33/33 checks | EXIT=0 |
| `check-id-ledger.log` | 0 errors (the 048 reservations G-55…58 · INV-033 · BR-092…096 STAND — the flip is W-15's) | EXIT=0 |
| `id-ledger-self-test.log` | the self-test — all probes OK | EXIT=0 |
| `check-history-secrets.log` | 0 violations | EXIT=0 |
| `check-capabilities-matrix.log` | capabilities matrix and fixture agree | EXIT=0 |
| `check-desktop-shell.log` / `check-mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative-test.log` | the negative boundary meta-test PASS | EXIT=0 |

## The full DB suite — the count and the ceiling law

**271 files · 3,807 tests · 0 failed · 0 skipped** — the W-13 baseline (267 ·
3,778) + the four new specs (`projects-reports.db.spec.ts` 8 arms ·
`projects-goldens.db.spec.ts` 7 · `projects-rls.db.spec.ts` 10 ·
`projects-explain-budgets.db.spec.ts` 4). The precomputed plan (the owner's
standing clause 8, built BEFORE the first run and coverage-verified against
the repo inventory — **271/271, no duplicates, family-whole**): the smoke 3 ·
1,783 + the perf 6 · 24 + a 82 · 596 + **b 100 · 785 (the projects family
whole)** + c 80 · 619. **THE TIME CEILING COMPUTED BEFORE COMMITTING**: the
projection ~590s (W-13's clean 541.39s + the four specs' measured standalone
times + the heavier-process margin; the goldens weighed carefully per the
owner's clause) — the actual run **554.42s, GREEN, inside the ceiling** (the
retry after the named soak flake — disclosure 1).

## The four-envelope proof (the W-10 law)

Every new spec verified STANDALONE (reports 8/8 · goldens 7/7 · rls 10/10 ·
explain 4/4), in the FAMILY (the projects chunk 100 · 785 — the family
proven green TWICE consecutively for the order-robustness proof), in the
CHUNK, and in the FULL suite (the single-process run above). The registry's
own pin-site specs green beside them (golden 6/6 · industry-018/019 22/22 ·
unit + wiring + consolidation 53/53 — captured in the step runs).

## The honest disclosures (four, all recorded at the claim sites — §7 of the gate doc)

1. The soak timing flake (the first full-run attempt's one red — re-proven
   standalone at BOTH the W-14 and the W-13 heads, the retry GREEN; the
   verbatim failure detail preserved in the gate doc).
2. The fcm channel flake (the first chunk-b attempt's one red — the async
   record race under the 100-file load; standalone + with-the-projects-specs
   green, the chunk retry GREEN).
3. The contracting spec's order-robustness repair (the change-orders spec's
   own supersede precedent — zero production changes; the family proven
   twice).
4. The probe's own finding corrected at the claim site (the poisoned penny's
   credit side moved off the 5210 overhead pool to the dedicated 4999 sink).
