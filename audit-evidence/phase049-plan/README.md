# PHASE-049 PLAN-WAVE evidence — 2026-11-21 (this session, the working tree at the `ba459ff` delivery head — the tag `phase/048`)

Every log below was generated THIS session (the same-session evidence rule,
the TWENTY-FOURTH consecutive wave) in `/home/z/my-project/ERP_Sys` (the
working tree RESTORED BYTE-FAITHFUL from the GitHub remote at `ba459ff` after
the environment reset — §0a of the plan; the 312-file recovery disclosed
below), captured through `scripts/capture-evidence.sh` (the W-6
vitest-summary-guarded wrapper; the NF-12 verdict rule everywhere: the summary
lines or the guarded stamp, never the raw process code alone). The four
quarters of every test session (command, stdout+stderr, exit stamp, timestamps)
are preserved verbatim — NF-7's permanent rule. **The two RED attempts of the
chunk-a TOTP boundary incident are KEPT as their own logs** (the owner's
clause 9 — both logs kept at every flake).

**THE EXIT, STATED EXPLICITLY: the plan wave's exit is the plan document
(`agent-ctx/PHASE-049-MASTER-PLAN.md`) + the acceptance-criteria ledger OPENED
(`docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-049) + RISK-033 added to
the register + this baseline envelope green at the delivered head. ZERO
production code ships (the tree diff vs `ba459ff` is docs/evidence-only). The
implementation waves are BLOCKED until the owner's approval dispatch — the
plan is sent FOR REVIEW BEFORE LAUNCH; approval is a launch authorization,
NEVER production approval.**

## The order of the envelope (the pre-isolation mandate executed at the plan wave itself)

1. **The three time-sensitive isolates FIRST** (the plan §0b (2) — the
   isolate trio declared from the start): soak standalone GREEN
   (1 · 1, 228.34s — W-15's 228.83s, the machines speed-equal) · fcm
   standalone GREEN (1 · 8, 14.91s) · email standalone GREEN (1 · 5, 12.96s).
2. Then the five load parts (the coverage proof — built BEFORE the first run,
   `coverage-proof.txt`: union == the disk inventory 271 == 271, unique 271,
   comm diff empty; the lists `coverage-inventory.txt` +
   `coverage-union.txt` + `parts.json`).

## The evidence table

| Log | Result |
|---|---|
| `typecheck.log` | typecheck **8/8 packages** (the `--force` fresh run) — EXIT=0 |
| `lint.log` | lint **8/8 packages** — EXIT=0 |
| `lint-depcruise.log` | no violations — **2,054 modules · 15,372 dependencies** (the W-15 count EXACT — zero production code) |
| `unit-workspace.log` | unit **8/8 packages — 141 files · 1,803 tests** (api 65·816 · web 17·147 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the owner's verified ledger EXACT: 1,803 = 816+147+840) |
| `db-isolate-soak.log` | **ISOLATE 1** — the soak standalone GREEN **BEFORE the heavy runs**: 1 · 1, **228.34s**, queue-health healthy |
| `db-isolate-fcm.log` | **ISOLATE 2** — the fcm channel standalone GREEN: 1 · 8, 14.91s |
| `db-isolate-email.log` | **ISOLATE 3 (the flake isolate)** — the email adapter standalone GREEN: 1 · 5, 12.96s |
| `db-suite-chunk-smoke.log` | smoke: migrations + the isolation family — 3 files · **1,783 tests** GREEN (the W-15 count EXACT; the embedded PG16 + the 104-chain from zero in-process) |
| `db-suite-chunk-perf-rest.log` | the perf family minus soak — 5 · **23** GREEN |
| `db-suite-chunk-a-attempt1-RED.log` | **THE KEPT RED (disclosure 2, attempt 1 of 2):** the 86-file chunk-a — 1 failed \| 650 passed; the failing arm NAMED: `identity-flows.db.spec.ts > TOTP MFA (M-06, M-07, acceptance 3) > enroll → verify confirms; same-code replay rejected; recovery codes single-use` — `MfaRequiredError` |
| `db-identity-flows-standalone.log` | **the two-head protocol's GREEN head:** the spec standalone **21/21 GREEN** immediately after the first red |
| `db-suite-chunk-a-attempt2-RED.log` | **THE KEPT RED (attempt 2):** the same single arm red again under the chunk (the boundary re-rolled badly twice) |
| `db-suite-chunk-a.log` | **chunk-a GREEN on attempt 3: 86 · 651** (the boundary re-rolled clean) |
| `db-suite-chunk-b-rest.log` | chunk b-rest: **86 · 625 GREEN** |
| `db-suite-chunk-c.log` | chunk c: **88 · 711 GREEN** |
| **THE ENVELOPE TOTAL** | **271/271 files · 3,807/3,807 tests · 0 failed · 0 skipped** (the owner's verified count EXACT; the parts' sum 640.61s across EIGHT PG boots — every part's full command far inside the amended 570s effective ceiling; the single-process one-command run was NOT attempted: its full-command expectation ≈ 615s exceeds the effective ceiling — **split before attempted, the §0b (1) law's own prescription**) |
| `check-rls-scratch.log` + `scratch-rls-proof.ts` | **THE STANDALONE SCRATCH PROOF:** initdb → **the 104-chain applied from zero** → `[check-rls] OK — 318 catalog tables` (0 violations) → the clean shutdown — EXIT=0 (the proof script preserved beside its log — the exact procedure) |
| `check-drift.log` | matrix **326 = seed 326** — EXIT=0 |
| `check-i18n.log` | **ar=6,620 = en=6,620** (the W-15 count EXACT) — EXIT=0 |
| `check-mobile-i18n.log` | mobile **ar=371 = en=371** — EXIT=0 |
| `check-mobile-tokens.log` | **130/130** token parity + **50/50** derivations — EXIT=0 |
| `check-manifests.log` | **13/13** valid — EXIT=0 |
| `check-docs-validate.log` | **33/33** checks — EXIT=0 |
| `check-id-ledger.log` | **0 errors — implemented G 58 · INV 33 · BR 96 \| reservations 16 phases · 45 ids** (68 phase docs scanned; 95 claim ids; 2,517 reference ids) — EXIT=0 |
| `id-ledger-self-test.log` | the self-test — **all probes OK** (probe (7) at G-59/PHASE-049, claimant PHASE-050) — EXIT=0 |
| `check-history-secrets.log` | **0 violations** (sampled 200/226 commits across all refs + **the THREE tag anchors** — `phase/046` @ `4ddb39f` · `phase/047` @ `5b73bd1` · `phase/048` @ `ba459ff` — all verified untouched; 6,400 allowlisted fixture hits across 11 documented paths) — EXIT=0 |
| `check-capabilities.log` | capabilities matrix and fixture agree — EXIT=0 |
| `check-desktop-shell.log` / `check-mobile-shell.log` | PASS / PASS — EXIT=0 |
| `boundary-negative-test.log` | the negative boundary meta-test **PASS** — EXIT=0 |

## The honest disclosures (three, all recorded at the claim sites)

1. **THE ENVIRONMENT-RESET RECOVERY + THE 312-FILE RESTORE (§0a of the plan —
   the owner's new law executed as the session's FIRST act).** The sandbox was
   reset again after the W-15 push; the fresh clone from the GitHub remote at
   `ba459ff` verified `main` = the tag `phase/048`; the working tree diff then
   found **ZERO content differences but 312 missing files** (274 evidence
   `.log` files the sandbox snapshot drops + `apps/web/__tests__/
   local-schema-parity.test.ts` + `.env.example` + `next-env.d.ts` + the
   log-bearing evidence directories) — **all 312 recovered from the remote
   clone; the post-restore diff CLEAN**. The missing web unit file is named
   prominently: on the unrestored tree the web package would have counted 16
   files against the owner's verified 17 · 147 — the restore is what the new
   law exists for. Env-prep: pnpm 9.15.9 + the workspace install + the
   embedded PG16 (the suite's own global setup) + **chromium headless-shell
   1248** (installed BEFORE the DB runs — the render/print arms required 0
   skipped; no superseded captures this time).
2. **THE TOTP WINDOW-BOUNDARY FLAKE (the time-sensitivity class's EIGHTH
   incident — a NEW VARIANT, named; three logs kept: two RED attempts + the
   standalone GREEN).** Chunk-a's first TWO attempts failed exactly ONE arm
   each: `identity-flows.db.spec.ts`'s TOTP M-06/M-07 arm — the `freshCode`
   login rejected with `MfaRequiredError`. **The root cause (read at the
   claim site, `identity-flows.db.spec.ts:489-494`):** the spec generates the
   fresh code for `currentTimestep(Date.now() + 31_000)` — when the
   generation lands in the LAST second of a 30s window (t ≥ 29s), +31s
   resolves to the step AFTER next (n+2), outside the verifier's ±1 drift —
   a wall-clock boundary condition, NOT load-shaped (a new sub-class variant:
   the W-11…W-15 incidents were async/queue races; this one is a pure
   time-window boundary). **The protocol executed:** the spec re-run
   standalone **GREEN 21/21** immediately after the first red (the two-head
   protocol's green head); the chunk retried — red once more (the boundary
   re-rolled badly), then **GREEN 86/86 · 651/651 on attempt 3**; ALL THREE
   logs kept verbatim. The two-head structural evidence: the tree is
   byte-identical to the owner-verified `ba459ff` (§0a) — no code regression
   is possible. **The forward fix (a SPEC-side one-liner: compute the step as
   `currentTimestep(Date.now()) + 1` instead of `+ 31_000` wall-millis, or
   pin the clock — the W-8 date-defect repair pattern) is RECORDED for W-16's
   entry, NOT dispatched by this plan wave (zero code ships here); the owner
   dispatches it at approval.** The class count moves **seven → EIGHT**
   (RISK-033's register row records all eight).
3. **THE TWO INVOCATION SLIPS ON THE I18N CHECKER CAPTURES (evidence
   hygiene; both replaced immediately, disclosed).** The first
   `check-i18n.log` / `check-mobile-i18n.log` captures forwarded `--silent`
   through `pnpm run` into tsx's module resolution (the scripts take no
   args — `Cannot find module '--silent'`); the correct invocations were run
   immediately and their logs kept (the table's rows above). No checker
   result was ever red — the slip was my invocation, not the tree; disclosed
   for the record's completeness (the F1 law).

## The constants (recounted this session, every number the session's own run — the plan §0)

**The migration chain 0104 (idx 103 — 104 journal entries, the last tag
`0104_projects_contracting_stamps`)** · **the catalog 318** (the scratch
proof) · **the drift 326 = 326** · **the report registry 114** ·
**ROUTE_PERMISSIONS 1,052** · **i18n 6,620 web + 371 mobile** · **implemented
G 58 · INV 33 · BR 96 (reservations 16 phases · 45 ids)** · **the DB suite
271 files · 3,807 tests** · **depcruise 2,054 · 15,372** · **the unit suite
141 files · 1,803 tests (8/8 packages)**.

NOT production approval — the plan wave is a documentation act; the
implementation waves are BLOCKED until the owner's approval dispatch.
