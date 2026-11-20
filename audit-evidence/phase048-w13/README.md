# PHASE-048 W-13 evidence — 2026-11-20/21 (this session, the working clone at `52681bf`)

Every log below was generated THIS session (the same-session evidence rule, the
TWENTY-FIRST consecutive wave) in `/home/z/erp-w9/ERP_Sys` (the clone at the
owner-accepted W-12 head `52681bf`, the step commits `b269071` (T-15) +
`3f57952` (T-16a) + `597685a` (T-16b) + this delivery commit), captured through
`scripts/capture-evidence.sh` (the W-6 vitest-summary-guarded wrapper; the
VERDICT rule everywhere: the summary lines or the guarded stamp, never the raw
process code alone — A-2/NF-12). The four quarters of every test session
(command, stdout+stderr, exit stamp, timestamps) are preserved verbatim —
NF-7's permanent rule.

**THE EXIT, STATED EXPLICITLY (the acceptance numbers named): W-13's exit is
ACCEPTANCE CRITERION #9's SCREEN/PRINT/I18N ARMS green — the two screens
render under their flags with the engines' own figures (feature-flag/template
gating verified), the three bilingual contracting prints render AR/EN with
RTL correctness (the actual print test, both directions, long tables
paginating), and the i18n parity holds at the declared delta. The RLS/OA-06
arms of #9 remain W-14's (the plan's own division). MET — §8 of the gate
doc.**

## The logs (25 files — every physical file declared)

| Log | What it proves | Stamp |
|---|---|---|
| `typecheck.log` | typecheck 8/8 packages at the W-13 head | EXIT=0 |
| `lint.log` | lint 8/8 packages (ADR-0009 held — no float math anywhere in the wave) | EXIT=0 |
| `depcruise.log` | no violations — **2,046 modules · 15,280 dependencies** (the W-12 baseline 2,035 · 15,206 — ADDITION-ONLY growth: +11 modules · +74 deps across the three steps) | EXIT=0 |
| `unit-workspace.log` | unit 8/8 packages — **api 65·816 (64·810 + the new contracting-print spec 1·6)** · **web 17·147 (16·144: the contracting spec 8→11 arms + the fieldservice spec 1·7)** · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 | EXIT=0 |
| `db-suite-chunk-smoke.log` | chunk 1 of the precomputed five: migrations + the isolation family — 3 files · **1,783 tests** (the embedded PG16 booted + the **104-chain** applied from zero in-process — the chain is UNCHANGED at 0104; zero migrations ship in W-13) | VITEST_EXIT=0 |
| `db-suite-chunk-perf.log` | chunk 2 (the perf family): 6 files · 24 tests | VITEST_EXIT=0 |
| `db-suite-chunk-a.log` | chunk 3: 86 files · 644 tests | VITEST_EXIT=0 |
| `db-suite-chunk-b.log` | chunk 4: **88 files · 707 tests — the projects family WHOLE at the new count** (the W-12 seven + the print-render spec 3 arms + the fieldservice spec's new arm (i) 20→21) | VITEST_EXIT=0 |
| `db-suite-chunk-c.log` | chunk 5: 84 files · 620 tests | VITEST_EXIT=0 |
| `db-suite-full-single-process.log` | **THE FULL DB SUITE GREEN IN ONE PROCESS — 267/267 files · 3,778/3,778 tests · 0 failed · 0 skipped · 541.39s** (W-12's 266 · 3,774 + the one new spec 1·3 + the fieldservice +1 arm) | VITEST_EXIT=0 |
| `check-rls-scratch.log` | **THE STANDALONE SCRATCH PROOF**: initdb → the **104-chain** from zero → `[check-rls] OK — 318 catalog tables` (0 violations) → the clean shutdown | EXIT=0 |
| `permissions-drift.log` | matrix **326 = seed 326** (unchanged — the ONE new route binds an EXISTING W-8 key; ROUTE_PERMISSIONS 1,051 → **1,052**, dated at the block) | EXIT=0 |
| `id-ledger.log` | 0 errors (the 048 reservations G-55…58 · INV-033 · BR-092…096 STAND — the flip is W-15's) | EXIT=0 |
| `id-ledger-self-test.log` | the self-test — all probes OK ✓ | EXIT=0 |
| `i18n-parity.log` | **ar=6,620 = en=6,620 (THE DECLARED DELTA +138 in three step deltas: +76 (T-15) +43 (T-16a) +19 (T-16b) over W-12's 6,482 — D-14's web-plane remainder)** | EXIT=0 |
| `mobile-i18n.log` | mobile ar=371 = en=371 (unchanged) | EXIT=0 |
| `mobile-tokens.log` | 50/50 token derivations | EXIT=0 |
| `manifests.log` | 13/13 valid (no template content touched) | EXIT=0 |
| `docs-validate.log` | 33/33 checks | EXIT=0 |
| `history-secrets.log` | 0 violations | EXIT=0 |
| `capabilities.log` | capabilities matrix and fixture agree | EXIT=0 |
| `desktop-shell.log` / `mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative.log` | the negative boundary meta-test PASS | EXIT=0 |

## The full DB suite — the count and the chunk law

**267 files · 3,778 tests · 0 failed · 0 skipped** — the W-12 baseline (266 ·
3,774) + the one new spec (`projects-print-render.db.spec.ts` — 3 arms, the
REAL-Chromium actual print test) + the fieldservice spec's new arm (i) (the
presentation join, 20 → 21). The precomputed plan (the owner's standing
clause 8, built BEFORE the first run and coverage-verified against the repo
inventory — **267/267, no duplicates**: the W-12 chunk union (266) + exactly
the one new file = the disk list; the comm diff empty): the smoke 3 · 1,783 +
the perf 6 · 24 + 86 · 644 + **88 · 707 (the projects family whole)** + 84 ·
620. **THE TIME CEILING COMPUTED BEFORE COMMITTING**: the W-12 clean run
541.39s vs 567.68s — this session's machine ran the identical-family suite
faster; the projection ~573s (W-12's 567.68 + the print renders ~4s + the
fieldservice arm ~1s) and the actual run (**541.39s, GREEN ON THE FIRST
RUN**, zero flakes, no retry) landed well inside it.

## The four-envelope proof (the W-10 law)

The new spec verified STANDALONE (the first run: 3/3 in 1.5s with the real
Chromium), in the FAMILY (the projects chunk 88 · 707), in the CHUNK, and in
the FULL suite (the single-process run above). The fieldservice arm verified
standalone (21/21) and in every envelope likewise. The pure template layer
additionally proven in the api unit envelope (65 · 816).

## The honest disclosures (six, all recorded at the claim sites — §7 of the gate doc)

1. The web specs' first runs carried getBy collisions (the fieldservice
   spec's five: the status label × the filter's own `<option>`, the actions
   header × the row button, the shared-figure duplicates — and the missing
   `afterEach(cleanup)` in the first draft) — ALL the specs' own slips, zero
   production changes, corrected at the claim sites (the W-12 disclosure-3
   precedent's repeat).
2. The single-process run's first ATTEMPT rode a detached background launch
   the sandbox reaped before ANY test ran (the log stayed at the PG boot
   lines — zero test output, nothing counted); the run that counts is the
   foreground run above (the only complete one). Disclosed for the record.
3. That first attempt ALSO carried a shell-glob slip the process listing
   caught before any test ran (`src/__db__/**/*.spec.ts` without globstar
   expands one level — the two-level families would have been missed); the
   corrected invocation rides the vitest config's own include (no file
   args). Zero evidence impact — the run was replaced, not rerun.
4. THE 045 TABS DEFECT — NOT TOUCHED, NOT AGGRAVATED: the contracting board
   rides the DATA-SLOT shape exclusively (all four panes render after
   switching — the test arm is the recorded proof); the fieldservice board
   has NO tabs (one pane — the defect cannot reach it).
5. The retention statement's print carries NO totals block BY DESIGN (a
   cross-kind total would be a client-side sum — the zero-parallel-
   computation law applied to the print; the register's own figures are the
   statement's figures; the payload type itself has no totals field).
6. The base template-registry freeze test extended (4 → 7 keys) alongside
   the additive registry (the W-12 ROUTE_PERMISSIONS precedent's mirror);
   and the print letterhead's tenant name degrades to the generic "ERP"
   placeholder on a failed session read (the pdf-print precedent — never a
   fabricated tenant).

## The W-13 constants (the owner's clause 7, declared)

The chain **0104** (zero migrations — the wave is web + print over the 0103
substrate) · zero seeded migrations · the catalog **318** (the scratch proof
above) · drift **326 = 326** · reports **110 UNCHANGED — the three print
templates are NOT report contracts** (the owner's clause 6: they ride the
print-template package + the web payload builders, NOT the reports registry;
the four report contracts remain W-14's D-15; had they been registered the
110 would have broken by design — it did not) · i18n **6,482 → 6,620 (+138
declared in three step deltas)** + mobile 371 · ROUTE_PERMISSIONS
**1,051 → 1,052** (+1 the contracting pool, dated at the block) · the DB
suite **266 → 267 files · 3,774 → 3,778 tests**.
