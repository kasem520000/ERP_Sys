# PHASE-052 W-43 (THE FOUNDATION — GATE INCREMENT) evidence — 2026-11-27 (T-01 + T-02's gate share; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-43 steps 1–3
heads' tree (step 1 `7246506` · step 2 `f026f2a` · step 3 `b8c834f` —
every step pushed at its own commit per the owner's standing order
«عند الانتهاء من أي خطوة ادفعها إلى المستودع»; the same-session
evidence rule, the FIFTY-FIFTH consecutive wave — the owner's standing
record counts fifty-four through the W-0 plan wave). The wave is the
APPROVED PLAN's §3 W-43 under the owner's launch authorization (إذن
إطلاق ONLY, NEVER production approval — تسليم لا قبول; the rulings
(أ)–(د) carried; the reservations G-67 · INV-037 — NO BR this phase —
لا كتابة خارجها).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ b8c834f` (the W-43 step-3 head,
  pushed at its own completion); `phase/051` @ `c5175ff` (annotated
  `38b444e`) · `phase/050` @ `01f61a7` (`76dda77`) · `phase/049` @
  `41c3701` (`1fd74e9`) · `phase/048` @ `ba459ff` (`d46fa87`) ·
  `phase/047` @ `5b73bd1` (`90fd428`) · `phase/046` @ `4ddb39f`
  (`88568da`) — **the five annotated predecessors' six identifiers +
  the 051 tag intact, local = remote** (re-proven by this session's
  history-secrets run: all SIX anchors walked, 0 violations).
- **THE WORKING TREE RECONCILED TO THE REMOTE** (the TENTH environment
  reset, disclosed — the previous session ended mid-W-43 after pushing
  step 3): the sandbox's working copy was PARTIAL (1,839 tracked files
  missing from disk — the historical evidence dirs, the pre-0093
  migrations, the manufacturing specs, the zips, the config files;
  no git metadata of its own). The recovery: `git init` + `git remote
  add origin <kasem520000/ERP_Sys>` + `git fetch origin main --tags` +
  index at `b8c834f` + `git checkout --` the missing paths — **ZERO
  content differences beyond the session's own two carried artifacts**
  (the A-suite uuid fix, disclosed below, and this wave's evidence
  directory). The git-tracked evidence census: every prior wave's
  directory present after the restore (the 74 delivered + plan + this
  wave's own, additive only).
- Env-prep (this session's environment recovery, disclosed): node
  v24.22.3 + pnpm 9.15.9 via `npm i -g` (corepack's `/usr/bin` symlink
  refused EACCES — the W-0 disclosure standing) + the workspace
  install (27.4s, store-cached) + **the chromium 1248 pair provisioned
  BEFORE the chunk runs** (the fresh cache carried only the 1200 pair —
  playwright-core@1.64.1's manifest requires 1248; the first chunk-a
  attempt's four print-render skips re-run **0 skipped**, both facts
  disclosed at the claim site).

## The wave's acts (steps 1–3 pushed + this gate increment)

1. **STEP 1 — THE FOUNDATION** (`7246506`, T-01 + T-02's migration
   half): migrations `0127_workflow_definitions.sql` (the definitions
   register + the ordered steps — the CLOSED four-member trigger
   registry at the floor, the ruling (ج); the vocabulary mapping law
   PENDING_APPROVAL/SUBMITTED) · `0128_workflow_instances.sql` (the
   instances + the step instances — the immutable definition snapshot,
   ONE ACTIVE CHAIN PER DOCUMENT, the INV-037 terminal stamp floor, the
   ladder's stamp law, the TASK steps ARE the step instances — no
   seventh table) · `0129_delegations_escalations.sql` (the NO-SELF
   floor, the scope pair law, the strictly-positive window · the
   escalation events with the STRUCTURAL DEDUPE uq at the floor) ·
   `0130_approval_policies_bridge.sql` (the bridge substrate + THE
   DATA-ONLY GRANTS BLOCK — the nine `workflow.*` keys 357 → 366, the
   ruling (ب): never `platform.workflow.*`; the five feature flags on
   business+enterprise, STARTER at the declared neutral zero) + EVERY
   mirror/registry/catalog/matrix/pin in ONE increment (Drizzle +6 ·
   tables.registry +6 · ENTITY_CATALOG 354 → 360 · FEATURE_DEPS · the
   manifest widening · matrix §3.30 · both drift lists · the golden
   effective-configs' twenty-five pins re-pinned).
2. **STEP 2 — THE PURE FOLDS** (`f026f2a`, the unit-first law): the
   condition evaluator (D-06) · the instance/step state machine
   (D-13) · the delegation-graph fold (D-07 — the circularity walk +
   the G-67 effective-actor transitive closure) · the SLA fold (D-08)
   · the token fold (D-09's HMAC round-trip) — 5 files · 72 tests.
3. **STEP 3 — THE __db__/workflow/ FAMILY OPENS** (`b8c834f`, T-02's
   spec half): fixtures.ts (the LEAN fixture) + workflow-schema
   .db.spec.ts — 41 arms, every law refused BY NAME, every rejection
   arm on its OWN world; the three honest catches disclosed at the
   commit.
4. **THE GATE INCREMENT** (this commit): the wave's exit battery (this
   envelope) + the A-suite uuid parse fix (below) + the acceptance
   ledger's W-43 dated note (**ACCEPTANCE #1 GREEN**) + the
   NEXT_ACTION + IMPLEMENTATION_STATUS dated headers.

## THE SIX ISOLATES STANDALONE FIRST (the owner's عزل مسبق order — §0c (2); the set standing since W-34)

soak 1 · 1 (`db-isolate-soak.log`, 230.23s) · fcm 1 · 8
(`db-isolate-fcm.log`) · email 1 · 5 (`db-isolate-email.log`) · the
cmms sweep 1 · 4 (`db-isolate-sweep.log`) · the quality calibration
sweep 1 · 4 (`db-isolate-quality-sweep.log`) · the trade expiry sweep
1 · 6 (`db-isolate-trade-sweep.log`) — every stamp through THE
GUARDED WRAPPER (the vitest summary lines verified in addition to the
exit code). The workflow escalation sweep (the SEVENTH standing
isolate) does not exist yet — it ships at W-45 per the plan.

## THE ELEVEN-PART ENVELOPE — 316 files · 4,563 tests · 0 failed · 0 skipped

**The coverage verified BEFORE the first load run (the W-15 law):**
`coverage-inventory.txt` · `coverage-union.txt` ·
`coverage-proof.txt` — 316 = 316, missing NONE, extra NONE, duplicates
NONE, **VERDICT: COVERED** (roster: `parts.json` — the W-41 partition
standing + the ONE declared roster movement: the workflow family's
FIRST spec (workflow-schema) joins chunk-a at its alphabetical
position, 127 → 128).

| Part | Files · Tests | Time (inside the 570s ceiling) | Log |
|---|---|---|---|
| isolate-soak (standalone FIRST) | 1 · 1 | 230.23s | `db-isolate-soak.log` |
| isolate-fcm (standalone FIRST) | 1 · 8 | — | `db-isolate-fcm.log` |
| isolate-email (standalone FIRST) | 1 · 5 | — | `db-isolate-email.log` |
| isolate-sweep (standalone FIRST) | 1 · 4 | — | `db-isolate-sweep.log` |
| isolate-quality-sweep (standalone FIRST) | 1 · 4 | — | `db-isolate-quality-sweep.log` |
| isolate-trade-sweep (standalone FIRST) | 1 · 6 | — | `db-isolate-trade-sweep.log` |
| chunk-smoke | 3 · 2,035 | 22.02s | `db-chunk-smoke.log` |
| chunk-perf-rest | 5 · 23 | 90.31s | `db-chunk-perf-rest.log` |
| chunk-a | 128 · 1,141 | 168.58s | `db-chunk-a.log` |
| chunk-b-rest | 86 · 625 | 67.57s | `db-chunk-b-rest.log` |
| chunk-c | 88 · 711 | 79.39s | `db-chunk-c.log` |

The arithmetic: 316 = 1+1+1+1+1+1+3+5+128+86+88 EXACT · 4,563 =
1+8+5+4+4+6+2,035+23+1,141+625+711 EXACT. Every part inside the
amended 570s ceiling. Every stamp VITEST_EXIT=0 through the guarded
wrapper (the summary lines verified in addition to the exit code).
The provenance: 4,563 = 4,486 (the W-41/W-42 envelope) + 36 (the
A-suite's six tables × six generated arms — the smoke chunk's own
count 1,999 → 2,035) + 41 (the workflow-schema spec's arms) EXACT —
**declared before the first load run** (in `coverage-proof.txt`, with
the dated F1 correction below) and confirmed by the run. The
single-process run NOT attempted — split before attempted, the
amended ceiling law's own prescription.

## THE 130-CHAIN SCRATCH FROM ZERO — TWICE (السلسلة من الصفر مرتين)

`check-rls-scratch-130-run1.log` · `check-rls-scratch-130-run2.log` —
both runs CHAIN_130_APPLIED → [check-rls] OK — **360 catalog tables**
→ SCRATCH_STOPPED, EXIT=0, both logs kept (run 2 at its own
SCRATCH_PORT 5498) — **the chain 126 → 130 at this wave** (migrations
0127–0130 land; verified against the tree BEFORE the claim: 130 SQL
files · 130 journal entries; the script: `scratch-rls-proof.ts`, the
W-41 shape re-based to this wave's own count).

## THE STANDING BATTERY (every log this session, every stamp green, at the final code state)

| Check | Verdict | Log |
|---|---|---|
| typecheck | 8/8 (fresh-tree natural first run, 0 cached) | `typecheck.log` |
| lint | 8/8 | `lint.log` |
| depcruise | clean — 2,291 · 17,067 (+13/+28 dated — the thirteen W-43 files: the eleven domain files + the two __db__/workflow/ files; zero cycles) | `depcruise.log` |
| unit workspace | 8/8 — **189 files · 2,233 tests** (api 91·1,153 — the W-0's 86·1,081 + the pure folds' 5·72 · web 39·240 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36; 2,233 = 2,161+72 EXACT) | `unit-workspace.log` |
| ROUTE_PERMISSIONS | **1,215 standing** (the tsx recount — W-43 adds zero routes: the engine's service waves are W-44+, the 0130 §1 keys-seed-first precedent) | `route-permissions-recount.log` |
| permissions drift | **366 = 366** (the ruling (ب) delta 357 → 366 — zero-drift from the first increment) | `permissions-drift.log` |
| i18n parity | ar=7,582 = en=7,582 standing (no delta — the surface waves are W-48's) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · parity · derivations 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| docs:validate | 33/33 (the ledger edits ride this increment) | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 66 · INV 36 · BR 108 standing (the 052 flip is W-51's; probe 7 stands at G-67/PHASE-052, claimant PHASE-053) | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 7,657 allowlisted hits (the W-0 7,517 +140 — the window's shift: the 052 W-0/W-43 commits entering the last-200 sample; the SIX tag anchors walked, all untouched) | `history-secrets.log` |
| capabilities | agree | `capabilities.log` |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

## The honest catches (the wave's own first REDs, disclosed at the claim sites, no battery red standing)

1. **THE A-SUITE UUID PARSE FIX (the regression protocol's four
   quarters):** step 1's committed A-suite extension carried THREE
   invalid uuid literals — 11-char last groups
   (`…00000000d01/d02/d03` where the workflow_instances seeds and the
   A3 MISMATCHED_INSERT named the doc ids). The pre-fix RED captured
   on the step-3 head's own code (`db-red-a-suite-uuid-parse.log`,
   VITEST_EXIT=1): the seed boot fails at the parse —
   `invalid input syntax for type uuid` (22P02) — 2,016 arms skipped,
   the whole A-suite dead before any arm runs. The fix (the three
   literals re-formed to the 12-char groups `…d001/d002/d003`)
   re-verified GREEN standalone (`db-green-a-suite-uuid-fixed.log`, 1
   file · 2,016 tests, VITEST_EXIT=0) AND inside the smoke chunk
   (3 · 2,035) — the fix rides this gate increment with the RED shape
   described here.
2. **THE COVERAGE-PROOF F1 ARITHMETIC CORRECTION (declared before the
   first load run):** the proof's first draft (the prior session's
   artifact, re-generated this session) declared «4,527 = 4,486 + 41 —
   the A-suite's +36 rides INSIDE the smoke chunk's own count
   (1,999 → 2,035)» — an internal contradiction (the +36 declared in
   the same sentence yet never added to the total). Corrected BEFORE
   the first load run with the dated F1 note at the proof itself:
   4,563 = 4,486 + 36 + 41 EXACT — confirmed EXACT by the envelope's
   own run.
3. **The chromium-1248 provisioning (the env-prep disclosure):** the
   fresh environment's playwright cache carried only the 1200 pair;
   the first chunk-a attempt ran 1,137 passed | 4 skipped (the two
   print-render specs' render arms). The 1248 pair provisioned, the
   chunk re-run — **128 · 1,141 · 0 skipped** — the complete log
   replaces the partial at the same claim site, the slip disclosed
   here (the 051-plan wave's own invocation-slip precedent).

RISK-033: EIGHT incidents, ZERO new this wave — the row stays OPEN,
closing only by the owner's order.

The reservations G-67 · INV-037 — NO BR this phase — لا كتابة خارجها.

NEXT: W-44 (the engine core + the event bus — T-03 + T-07's bus half:
the WorkflowGateway documented contract + the four exemplar bindings,
the trigger resolution, the instance/step state machine, the seeded
conditional-chain scenario (PO > 50,000 → manager → finance → CEO),
the `workflow` notifications category at the additive 0131 WITH the
writer, the assignee notifications, the WorkflowEvent bus family) under
the standing order. NOT production approval — تسليم لا قبول.
