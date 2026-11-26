# PHASE-051 W-40 (THE REPORTS — GATE INCREMENT) evidence — 2026-11-26 (T-15's gate share; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-40 step-2 head
`31ed950`'s tree (the same-session evidence rule, the **FIFTY-SECOND**
consecutive wave — the owner's standing record counts fifty-one through
the W-39 gate). The wave is the APPROVED PLAN's §3 W-40 under the owner's
launch authorization (the plan ratified as the binding phase program —
إذن إطلاق ONLY, NEVER production approval; the rulings (أ)–(د) carried;
the standing order «عند الانتهاء من أي خطوة ادفعها إلى المستودع» honored —
every step pushed at its own commit: the report contracts `39fe961` →
the DB spec `31ed950` → this gate increment).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ 31ed950` at the wave's spec head (the
  W-40 step-2 head, pushed at its own commit); `phase/050` @ `01f61a7` ·
  `phase/049` @ `41c3701` · `phase/048` @ `ba459ff` · `phase/047` @
  `5b73bd1` · `phase/046` @ `4ddb39f` — **the four annotated tags' six
  identifiers + the 050 tag intact, local = remote** (the tag OBJECT ids
  verified pairwise: 88568da · 90fd428 · d46fa87 · 1fd74e9 · 76dda77;
  the owner's standing rule, re-proven by the history-secrets run: all
  FIVE anchors walked, 0 violations).
- The working tree IS this session's own clone (the W-39 gate's fresh
  clone, the same environment standing: pnpm 9.15.9 · the workspace
  install with the embedded-PG16 16.14 binaries · the chromium-1248
  pair) — 0 skipped on every run below.

## The wave's acts (two delivery commits + this gate increment — every step pushed at its own commit per the owner's standing order)

1. **THE REPORT CONTRACTS** (`39fe961`, T-15 — D-18): the four trade
   contracts (`trade.lc-register` · `trade.customs-declaration-register`
   · `trade.shipment-status` · `trade.duty-drawback-status`) + the
   TradeReportQueriesService query surface + the wiring (the `trade`
   category + data-source module + phase 51 + the window 50 → 51) +
   **ALL PIN SITES TOGETHER** (the eight count pins + the
   known-permission catalogs + REPORT_CATALOG's header/§9/§13/
   reconciliation) — registry **122 → 126**.
2. **THE DB SPEC** (`31ed950`): `trade-reports.db.spec` — 7 arms, every
   arm on ITS OWN world (the per-arm-world law): the verbatim ties
   against the store's own reads + the REAL folds (the sweep's band
   fold, the duty/VAT line fold) + the REAL TrackingService's driven
   statuses + the deny paths + the isolation floor + the registry's
   four rows. THE HONEST CATCHES (the spec's own first REDs, repaired
   in the same session): the lc_documents presented-shape floor · the
   declarations accepted-shape stamp law · the HS-code digits-only
   floor · the store's unaliased issuing_bank key + the family-run's
   tenant-global label.
3. **THE GATE INCREMENT** (this commit): the evidence envelope + the
   acceptance ledger's W-40 dated note (criterion #9's report arms
   GREEN) + the NEXT_ACTION + IMPLEMENTATION_STATUS dated headers.

## THE SIX ISOLATES STANDALONE FIRST (the owner's عزل مسبق order — §0c (2); the set standing since W-34)

soak 1 · 1 (`db-isolate-soak.log`, 228.14s) · fcm 1 · 8
(`db-isolate-fcm.log`, 16.59s) · email 1 · 5 (`db-isolate-email.log`,
13.12s) · the cmms sweep 1 · 4 (`db-isolate-sweep.log`, 7.26s) · the
quality calibration sweep 1 · 4 (`db-isolate-quality-sweep.log`, 7.86s)
· the trade expiry sweep 1 · 6 (`db-isolate-trade-sweep.log`, 7.31s) —
every stamp through THE GUARDED WRAPPER (the W-36 gate's hardened shape:
the vitest summary lines verified in addition to the exit code).

## THE ELEVEN-PART ENVELOPE — 312 files · 4,463 tests · 0 failed · 0 skipped

**The coverage verified BEFORE the first load run (the W-15 law):**
`coverage-inventory.txt` · `coverage-union.txt` ·
`coverage-proof.txt` — 312 = 312, missing NONE, extra NONE, duplicates
NONE, **VERDICT: COVERED** (roster: `parts.json` — the W-39 partition
standing + the ONE declared roster movement: the trade-reports spec
joins chunk-a at its alphabetical position, 123 → 124, the family
precedent's own move; the roster 311 → 312).

| Part | Files · Tests | Time (inside the 570s ceiling) | Log |
|---|---|---|---|
| isolate-soak (standalone FIRST) | 1 · 1 | 228.14s | `db-isolate-soak.log` |
| isolate-fcm (standalone FIRST) | 1 · 8 | 16.59s | `db-isolate-fcm.log` |
| isolate-email (standalone FIRST) | 1 · 5 | 13.12s | `db-isolate-email.log` |
| isolate-sweep (standalone FIRST) | 1 · 4 | 7.26s | `db-isolate-sweep.log` |
| isolate-quality-sweep (standalone FIRST) | 1 · 4 | 7.86s | `db-isolate-quality-sweep.log` |
| isolate-trade-sweep (standalone FIRST) | 1 · 6 | 7.31s | `db-isolate-trade-sweep.log` |
| chunk-smoke | 3 · 1,999 | 21.07s | `db-chunk-smoke.log` |
| chunk-perf-rest | 5 · 23 | 96.81s | `db-chunk-perf-rest.log` |
| chunk-a | 124 · 1,077 | 147.97s (the green re-run) | `db-chunk-a.log` |
| chunk-b-rest | 86 · 625 | 62.50s | `db-chunk-b-rest.log` |
| chunk-c | 88 · 711 | 74.83s | `db-chunk-c.log` |

The arithmetic: 312 = 1+1+1+1+1+1+3+5+124+86+88 EXACT · 4,463 =
1+8+5+4+4+6+1,999+23+1,077+625+711 EXACT. Every part inside the amended
570s ceiling. Every stamp VITEST_EXIT=0 through the guarded wrapper
(the summary lines verified in addition to the exit code). The
provenance: 4,463 = 4,456 (the W-39 envelope) + 7 (the trade-reports
spec's arms) EXACT, declared before the first load run (in
`coverage-proof.txt`) and confirmed by it. The single-process run NOT
attempted — split before attempted, the amended ceiling law's own
prescription.

## THE 126-CHAIN SCRATCH FROM ZERO — TWICE (السلسلة من الصفر مرتين)

`check-rls-scratch-126-run1.log` · `check-rls-scratch-126-run2.log` —
both runs CHAIN_126_APPLIED → [check-rls] OK — 354 catalog tables →
SCRATCH_STOPPED, EXIT=0, both logs kept — run 2 at its own SCRATCH_PORT
5498; the chain STANDS at 126 — **the wave added NO migration** (the
contracts are read-only surfaces over the delivered registers; the
window widening 50 → 51 is a RUNTIME declaration, not a schema act),
verified against the tree BEFORE the claim: 126 SQL files · 126 journal
entries; the invocation through the filter's apps/api cwd from the
FIRST try (the script: `scratch-rls-proof.ts`).

## THE STANDING BATTERY (every log this session, every stamp green, at the final code state)

| Check | Verdict | Log |
|---|---|---|
| typecheck | 8/8 (0 cached, --force) | `typecheck.log` |
| lint | 8/8 (0 cached, --force) | `lint.log` |
| depcruise | clean — 2,275 · 16,970 (+6/+48 dated — the W-40 reports wave: the four contract files + the queries module + the DB spec; zero cycles) | `depcruise.log` |
| unit workspace | 8/8 — **184 files · 2,161 tests** (api 86·1,081 · web 39·240 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36) — the ledger arithmetic **2,161 = 1,081 + 240 + 840 EXACT** (unchanged — the reports wave adds DB-family specs, not unit specs) | `unit-workspace.log` |
| ROUTE_PERMISSIONS | **1,215 standing** (the tsx recount — the reports wave binds ZERO new routes: the contracts are registry rows run through the reporting engine's own run endpoint) | `route-permissions-recount.log` |
| permissions drift | 357 = 357 (no key minted — the §12 module-register convention: the four contracts ride the EXISTING 0122-seeded keys) | `permissions-drift.log` |
| i18n parity | ar=7,582 = en=7,582 (standing — no delta, an API-reports wave; the registry titles are registry-bilingual, never dictionary keys) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · parity 130/130 · derivations 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| docs:validate | 33/33 (re-verified at the final docs state — the catalog edits ride the step-1 increment) | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 63 · INV 35 · BR 104 standing (the 051 flip is W-42's) | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-64/PHASE-051 — the 051 flip is W-42's) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 7,361 allowlisted hits (the W-39 7,289 +72 — the window's shift: this session's commits entering the last-200 sample; the FIVE tag anchors walked, all untouched) | `history-secrets.log` |
| capabilities | agree | `capabilities.log` |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

## The honest catches (the wave's own first REDs, disclosed at the claim sites, no battery red standing)

1. **THE NINTH COUNT PIN** (the envelope's own catch — the two-head
   protocol with both logs kept): the W-40 envelope's FIRST chunk-a run
   RED-named `quality-reviews-hazards.db.spec`'s own registry-snapshot
   pin (`toHaveLength(122)` got 126 — the quality family's own
   report-contract arm, missed by the step-1 sweep's file list; caught
   by the envelope's own coverage discipline exactly as the
   partial-anchoring law demands) — the pin moved to 126 with the dated
   note in the same session; the pre-fix state re-run for the RED log
   (`db-chunk-a-first-red.log`, both logs kept per the two-head
   protocol), the re-run GREEN 124 · 1,077.
2. **THE STAMP-TRUTH CATCH** (the NF-12 verdict rule exercised and
   dated at the claim site): the first-red log's hand-rolled capture
   first stamped the process code 0 while the log's own vitest summary
   reported "1 failed" — the exact W-6 class the guarded wrapper's
   summary guard exists for; the stamp corrected to the SUMMARY VERDICT
   (`VITEST_EXIT=1`) with the dated correction note inside the log, and
   the guarded wrapper (scripts/capture-evidence.sh) remained the only
   capture path for every other log of this wave.
3. The step-2 spec's own first REDs (the 0119/0121 CHECKs' floors +
   the store's unaliased key + the family-run's tenant-global label) —
   disclosed at the step-2 commit, the re-runs GREEN.

RISK-033: EIGHT incidents, ZERO new this wave — the row stays OPEN,
closing only by the owner's order.

The reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة خارجها.

NEXT: W-41 (the proof pack — T-16: the golden transcripts G-64/G-65/
G-66 with the MANDATORY failure packs + the INV-036 completeness
golden + the bonded blocking-matrix golden + the RLS attack matrix
A1–A10 over the FOURTEEN tables + the OA-06 EXPLAIN budgets) under the
standing order. NOT production approval — تسليم لا قبول.
