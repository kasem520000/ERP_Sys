# PHASE-048 W-11 evidence — 2026-11-20 (this session, the working clone at `8a3534c`)

Every log below was generated THIS session (the same-session evidence rule, the
NINETEENTH consecutive wave) in `/home/z/erp-w9/ERP_Sys` (the clone at the
owner-accepted W-10 head `8a3534c`), captured through `scripts/capture-evidence.sh`
(the W-6 vitest-summary-guarded wrapper; the VERDICT rule everywhere: the summary
lines or the guarded stamp, never the raw process code alone — A-2/NF-12). The four
quarters of every test session (command, stdout+stderr, exit stamp, timestamps)
are preserved verbatim — NF-7's permanent rule.

## The logs (26 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at the W-11 head | EXIT=0 |
| `lint.log` | lint 8/8 packages (ADR-0009 held — the W-11 pure layer is all exact scaled-integer BigInt) | EXIT=0 |
| `depcruise.log` | no violations — **2,026 modules · 15,129 dependencies** (the W-10 baseline 2,018 · 15,056 — ADDITION-ONLY growth: +8 modules · +73 deps, the eight new W-11 files) | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — **api 63·792 (62·776 + the new W-11 pure spec 1·16)** · web 13·122 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-chunk-smoke.log` | chunk 1 of the precomputed five (the smoke family): migrations + the isolation family — 3 files · **1,783 tests** (the embedded PG16 booted + the **104-chain** applied from zero in-process) | VITEST_EXIT=0 |
| `db-suite-chunk-perf.log` | chunk 2 (the perf family): 6 files · 24 tests | VITEST_EXIT=0 |
| `db-suite-chunk-a.log` | chunk 3: 86 files · 644 tests | VITEST_EXIT=0 |
| `db-suite-chunk-b.log` | chunk 4: **86 files · 683 tests — the projects family WHOLE at the new count** (the W-9/W-10 five + the new contracting spec 11 = +11) | VITEST_EXIT=0 |
| `db-suite-chunk-c.log` | chunk 5: 84 files · 620 tests | VITEST_EXIT=0 |
| `db-suite-full-single-process.log` | **THE FULL DB SUITE IN ONE PROCESS — 265/265 files · 3,753/3,754 passed · 546.25s** (within this session's cap; the projection said ~555s). THE HONEST FLAKE: the ONE red is the `identity-flows` TOTP-MFA arm (`MfaRequiredError` at login — the 30-second TOTP window crossed during the 546-second run's scheduling; the runbook's documented serial-order/timing-sensitivity class, ZERO relation to W-11's surface) — re-proven GREEN standalone immediately (the next log) and green in every chunk | VITEST_EXIT=1 |
| `identity-flows-standalone-rerun.log` | the flake's re-proof: the identity-flows spec standalone — **21/21 green** | VITEST_EXIT=0 |
| `db-suite-full-single-process-retry.log` | **THE RETRY — THE FULL DB SUITE GREEN IN ONE PROCESS: 265/265 · 3,754/3,754 · 0 failed · 0 skipped · 552.58s** — BOTH single-run logs kept under their true names (the first's stamp is its own truth; the retry is the clean envelope) | VITEST_EXIT=0 |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF** — initdb → the **104-chain** from zero (0104 applied clean) → `[check-rls] OK — 318 catalog tables` (0 violations — the columns add no tables) → the clean shutdown | EXIT=0 |
| `permissions-drift.log` | matrix **326 = seed 326** (unchanged — zero new keys at W-11: the twenty routes bind EXISTING W-8 keys) | EXIT=0 |
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

**265 files · 3,754 tests · 0 failed · 0 skipped** — the W-10 baseline (264 ·
3,743) + the one new W-11 spec (`projects-contracting.db.spec.ts` — 11 arms).
The precomputed plan (the owner's W-11 clause 8, built BEFORE the first run and
coverage-verified against the repo inventory — **265/265, no duplicates**: the
diff of the disk list against the chunks' union is empty): the smoke 3 · 1,783 +
the perf 6 · 24 + 86 · 644 + **86 · 683 (the projects family whole)** + 84 · 620
— every top-level family COMPLETE in its chunk (the W-7/W-9/W-10 accepted
pattern). Every chunk through the guarded wrapper; every stamp VITEST_EXIT=0;
the summary lines in each log. **THE TIME CEILING COMPUTED BEFORE COMMITTING**
(clause 8): the W-10 single-process run was 554.04s; the new spec measured
~1s in the family context → projected ~555s against this session's 592s command
timeout — the commitment made, and the actual runs (546.25s · 552.58s) landed
inside it. The schema changed (0104) → the FULL suite re-ran per the scope-label
law (red line 7), in BOTH envelopes.

## The four-envelope proof (the W-10 law)

Each new spec verified STANDALONE (the first runs), in the FAMILY (6 files · 65
green), in the CHUNK (86 · 683), and in the FULL suite (both single-process
runs above) — order-robustness included (the change-orders spec's beforeAll
supersedes the G-58 pair for its own arms; the contracting spec maps the pair
idempotently inside its own ceiling arm, verified green in every order the
runner produced).
