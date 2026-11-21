# PHASE-048 W-15 evidence — 2026-11-21 (this session, the working clone at `a932b1e` + the step commits)

Every log below was generated THIS session (the same-session evidence rule,
the TWENTY-THIRD consecutive wave) in `/home/z/my-project/ERP_Sys` (a FRESH
CLONE after the environment reset — the repository rebuilt from the GitHub
remote at the owner-accepted W-14 head `a932b1e`; the toolchain + embedded
PG16 + chromium headless-shell 1248 re-provisioned as the honest env-prep,
the PHASE-046 W-0 precedent's shape), captured through
`scripts/capture-evidence.sh` (the W-6 vitest-summary-guarded wrapper; the
VERDICT rule everywhere: the summary lines or the guarded stamp, never the
raw process code alone — A-2/NF-12). The four quarters of every test session
(command, stdout+stderr, exit stamp, timestamps) are preserved verbatim —
NF-7's permanent rule. **The two RED attempts are KEPT as their own logs**
(the owner's clause 9 — both logs kept at every flake).

**THE EXIT, STATED EXPLICITLY: W-15's exit is ACCEPTANCE CRITERION #10 —
the closure wave: the canon docs in the D-18 wordings (step commit
`35c8239`), the ID_LEDGER flip atomic with them (every 048 reservation
resolved — G-55…G-58 · INV-033 · BR-092…096 — nothing silently dropped, the
seals consumed once, no intermediate state), THE FULL GATE SWEEP at the
final head green in BOTH envelopes (the eight-part coverage-verified plan
with the three time-sensitive isolates + the single-process run inside the
declared ceiling), every standing checker green — the completion report +
the triple flip + the archive + the tag `phase/048` ride this delivery
commit. The phase closure is NOT production approval.**

## The owner's three standing recalls (every report, this one included)

- **(a) ROUTE_PERMISSIONS total: 1,052 — UNCHANGED.** W-15 is a zero-route
  wave (docs + the checker's self-test fixture only; zero production code).
  The last dated block remains W-13's `(1051 + 1 = 1052)`.
- **(b) The battery scope map — THE EIGHT-PART BREAKDOWN (the W-14
  five-chunk plan RESTRUCTURED with the three time-sensitive specs isolated;
  the regrouping DECLARED at every site):** the smoke **3 files · 1,783
  tests** (migrations + the isolation family, embedding the 104-chain boot
  from zero) + **the soak ISOLATE 1 · 1** + the perf-rest **5 · 23** + **the
  fcm ISOLATE 1 · 8** + **the email ISOLATE 1 · 5** (the flake isolate,
  disclosure 1) + chunk a **82 · 596** + chunk b-rest **98 · 772** (the
  W-14 chunk b minus fcm minus email) + chunk c **80 · 619** = **271 files
  · 3,807 tests** — W-14's delivered count UNCHANGED (zero new specs in
  W-15). The coverage verified BEFORE the first run: the union == the disk
  inventory 271/271, unique 271, the comm diff empty (`coverage-proof.txt`
  + `coverage-union.txt` + `coverage-inventory.txt`).
- **(c) The new files' names:** ZERO new spec files (the closure adds no
  test surface). The wave's new evidence artifacts: this envelope's 33
  files (declared below) + the canon docs + the TABLES doc (step commit
  `35c8239`'s nine files).

## The logs (33 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `coverage-proof.txt` + `coverage-union.txt` + `coverage-inventory.txt` | THE PRECOMPUTED COVERAGE PROOF (built BEFORE the first run): the eight-part plan, the union == inventory 271/271, the comm diff empty, the ceiling computation (680s declared, computed before the full run) | — |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF**: initdb → the **104-chain from zero** → `[check:rls] OK — 318 catalog tables` (0 violations) → the clean shutdown | EXIT=0 |
| `typecheck.log` | typecheck 8/8 packages at the final head (the `--force` fresh run — disclosure 4) | EXIT=0 |
| `lint.log` | lint 8/8 packages (fresh) | EXIT=0 |
| `lint-depcruise.log` | no violations — **2,054 modules · 15,372 dependencies (UNCHANGED from W-14 — zero production code)** | EXIT=0 |
| `unit-workspace.log` | unit 8/8 — **api 65·816 · web 17·147 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 (ALL UNCHANGED)** | EXIT=0 |
| `db-isolate-soak.log` | **THE TIME-SENSITIVE ISOLATE 1** — the soak standalone GREEN BEFORE the heavy runs: 1 · 1, 228.83s, queue-health baseline=1 max=2 last=0 | VITEST_EXIT=0 |
| `db-isolate-fcm.log` | **THE TIME-SENSITIVE ISOLATE 2** — the fcm channel standalone GREEN: 1 · 8, 15.04s | VITEST_EXIT=0 |
| `db-isolate-email.log` | **THE TIME-SENSITIVE ISOLATE 3 (the flake isolate)** — the email adapter standalone GREEN 5/5 in 6.9s, immediately after its chunk-b red (disclosure 1) | VITEST_EXIT=0 |
| `db-suite-chunk-smoke.log` | chunk 1: migrations + the isolation family — 3 files · **1,783 tests** (the embedded PG16 + the 104-chain from zero in-process) | VITEST_EXIT=0 |
| `db-suite-chunk-perf-rest.log` | chunk 2: the perf family minus the soak — 5 · **23** | VITEST_EXIT=0 |
| `db-suite-chunk-a.log` | chunk 3: 82 · **596** (the re-run after the chromium env-prep — disclosure 3; the kept log is the complete run) | VITEST_EXIT=0 |
| `db-suite-chunk-b-attempt1-RED.log` | **THE KEPT RED (disclosure 1):** the first 99-file chunk-b attempt — 2 failed | 775 passed (the email arms' pg-boss race under load; the verbatim failures preserved) | VITEST_EXIT=1 |
| `db-suite-chunk-b-rest.log` | chunk 4 (the restructure): **98 · 772** GREEN (the W-14 chunk b minus fcm minus email) | VITEST_EXIT=0 |
| `db-suite-chunk-c.log` | chunk 5: 80 · **619** | VITEST_EXIT=0 |
| `db-suite-full-attempt1-RED.log` | **THE KEPT RED (disclosure 2):** the single-process run's first attempt — the soak's steady-window margin (`expected 5 to be less than or equal to 3` at soak-shaped.db.spec.ts:311; 270/271 files, 3,806/3,807 — ONLY that arm red) | VITEST_EXIT=1 |
| `db-suite-full-single-process.log` | **THE FULL DB SUITE GREEN IN ONE PROCESS — 271/271 files · 3,807/3,807 tests · 0 failed · 0 skipped · 553.18s INSIDE THE DECLARED 680s CEILING** (the retry; the soak's queue-health healthy in-run) | VITEST_EXIT=0 |
| `check-permissions-drift.log` | matrix **326 = seed 326** (zero new keys) | EXIT=0 |
| `check-i18n-parity.log` | **ar=6,620 = en=6,620 (ZERO DELTA — the canon rows are documentation, never dictionary keys)** | EXIT=0 |
| `check-mobile-i18n.log` | mobile ar=371 = en=371 (unchanged) | EXIT=0 |
| `check-mobile-tokens.log` | 130/130 token parity + **50/50 derivations** | EXIT=0 |
| `validate-manifests.log` | **13/13** valid (no template content touched) | EXIT=0 |
| `docs-validate.log` | **33/33** checks (the canon rows + the new TABLES doc + §29/§1.11 all validate) | EXIT=0 |
| `check-id-ledger.log` | **0 errors — implemented G 58 · INV 33 · BR 96 · reservations 16 phases · 45 ids** (the flip of §2 of the gate doc) | EXIT=0 |
| `id-ledger-self-test.log` | the self-test — all probes OK (probe (7) at G-59/PHASE-049, claimant PHASE-050) | EXIT=0 |
| `check-history-secrets.log` | 0 violations (sampled 200/223 commits + **the two tag anchors — `phase/046` @ `4ddb39f` and `phase/047` @ `5b73bd1` verified untouched**) | EXIT=0 |
| `check-capabilities-matrix.log` | capabilities matrix and fixture agree | EXIT=0 |
| `check-desktop-shell.log` / `check-mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative-test.log` | the negative boundary meta-test PASS | EXIT=0 |

## The honest disclosures (four, all recorded at the claim sites — §5 of the gate doc)

1. **The email chunk flake** — chunk b's first attempt's two reds (the
   pg-boss async race under the 99-file load); the spec standalone GREEN
   5/5 in 6.9s immediately after; the two-head evidence (apps/packages
   byte-identical between `a932b1e` and the W-15 head — the empty diff);
   the restructure to the third isolate; the chunk retry GREEN. Both logs
   kept.
2. **The soak full-run flake** — the single-process first attempt's one red
   (`expected 5 ≤ 3`, the W-14 disclosure-1 precedent's exact class); the
   soak isolate had already proven GREEN standalone BEFORE the run; the
   retry GREEN 553.18s inside the ceiling. Both logs kept.
3. **The environment-reset recovery** — the fresh clone from the remote at
   `a932b1e`, the toolchain + PG16 + chromium headless-shell 1248
   re-provisioned (the render spec's two skip-graceful arms needed the
   shell; the first chunk-a capture's 2-skipped log superseded by the
   complete 596/596 run — disclosed).
4. **The typecheck cache-hit replacement** — the kept log is the `--force`
   fresh run (evidence hygiene; zero result change).
