# PHASE-052 W-0 (THE MASTER PLAN WAVE) evidence — 2026-11-27 (the plan-first wave, سابقة 049-W0/050-W0/051-W0; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the working tree
reconciled to the owner-launched 051 closure head `c5175ff` = the tag
`phase/051` (the same-session evidence rule, the **FIFTY-FOURTH**
consecutive wave — the owner's standing record counts fifty-three through
the 051 closure: the 051-plan wave the forty-fourth, W-33…W-42 the
forty-fifth through the fifty-third; this wave is the next of them). The
wave is DOCS-ONLY: the master plan + the acceptance ledger opening + the
status/NEXT_ACTION headers; the CODE tree stands at the closure head
byte-identical, so the battery's constants are the closure's own figures
re-proven.

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ c5175ff` = the tag `phase/051`
  (annotated `38b444e` peeling to the W-42 archive head); `phase/050` @
  `01f61a7` (annotated `76dda77`) · `phase/049` @ `41c3701` (`1fd74e9`) ·
  `phase/048` @ `ba459ff` (`d46fa87`) · `phase/047` @ `5b73bd1`
  (`90fd428`) · `phase/046` @ `4ddb39f` (`88568da`) — **the five
  annotated predecessors' six identifiers + the 051 tag intact** (the
  owner's standing rule, re-proven by this session's history-secrets run:
  all SIX anchors walked, 0 violations).
- **THE WORKING TREE RECONCILED TO THE REMOTE** (the ninth environment
  reset recovered, disclosed): the sandbox carried a STALE working copy
  (the 050-W26-era tree, no git metadata of its own — the sandbox's
  checkpoint system is a separate outer repo with UUID-message commits,
  never the project's history). The recovery: `git init` + `git remote
  add origin <kasem520000/ERP_Sys>` + `git fetch origin main --tags` +
  `git reset --hard origin/main` — **HEAD = the remote HEAD = `c5175ff`,
  the tree clean at HEAD: ZERO content differences, ZERO missing files,
  ZERO untracked leftovers** (the only ignored entries this session's own
  fresh `node_modules`). The git-tracked evidence-log census re-counted
  this session: **1,699 tracked files across the 74 delivered evidence
  directories** — every prior wave's logs present, no snapshot loss; this
  wave's own directory the 75th, additive only.
- Env-prep (this session's environment recovery, disclosed): node
  v24.22.3 + pnpm 9.15.9 (corepack's `/usr/bin` symlink refused EACCES
  in this sandbox — pnpm installed via `npm i -g pnpm@9.15.9`, the exact
  pinned version) + the workspace install re-run (store-cached, 24.3s);
  the embedded-PG16 binaries present with the install; **the chromium
  1248 shells provisioned BEFORE the runs** (the same dated disclosure as
  the 051-plan wave: this sandbox's playwright cache carried only the
  1200 pair — playwright-core@1.64.1's own browsers manifest requires
  1248; both pairs now provisioned) — 0 skipped on every run below.

## The wave's acts

1. **THE MASTER PLAN** `agent-ctx/PHASE-052-MASTER-PLAN.md` — PROPOSED,
   FOR REVIEW BEFORE LAUNCH; the implementation waves W-43…W-51 BLOCKED
   until the owner's approval dispatch (a launch authorization, NEVER
   production approval). The plan's §1 carries the sixteen settled design
   decisions D-01…D-16 (the honest slots 0127–0130 + the declared
   additive 0131 WITH the writer · the nine `workflow.*` keys 357 → 366
   (the 0060 law — the doc's `platform.workflow.*` letter stale, §7 (ب))
   · the five flags on business+enterprise at the declared neutral zero ·
   the FOUR exemplar bindings through the WorkflowGateway contract
   (`manual_journals` · `purchase_orders` · the 048 change orders · the
   051 drawback claims — the 051 completion report §5's declared base,
   §7 (ج)) · the G-67 effective-actor transitive closure · the INV-037
   terminal floor · the stateless-HMAC deep links with the step-instance
   CAS single-use · the WorkflowEvent bus family (the 055 handoff
   surface) · the TASK steps ARE the step instances (no seventh table) ·
   the bridge's four-mode mapping + the compatibility mode).
2. **THE ACCEPTANCE LEDGER OPENED**
   `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-052 — the ten
   criteria with their ARMS and WAVES (the owner's framework law: the
   ledger opens with the plan and closes with the closure).
3. **THE STATUS HEADER + NEXT_ACTION + THE PHASE TABLE ROW** updated to
   the plan wave (the review boundary carried; the implementation waves
   BLOCKED; the reservations G-67 · INV-037 — NO BR this phase — لا
   كتابة خارجها — and the open-items log transferred verbatim recorded
   at the header).

## The standing battery (every log this session, every stamp green)

| Check | Verdict | Log |
|---|---|---|
| docs:validate | **33/33** | `docs-validate.log` |
| id-ledger | **0 errors** — implemented G 66 · INV 36 · BR 108 · reservations 13 phases · 22 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-64/PHASE-051 — the 052 flip is W-51's) | `id-ledger-self-test.log` |
| permissions drift | 357 = 357 (the +9 keys are W-43's) | `permissions-drift.log` |
| i18n parity | ar=7,582 = en=7,582 | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · parity 130/130 · derivations 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities.log` |
| depcruise | clean — 2,278 · 17,039 (the closure count EXACT — a docs-only wave) | `depcruise.log` |
| typecheck | 8/8 (0 cached — the fresh tree's natural first run) | `typecheck.log` |
| lint | 8/8 (0 cached) | `lint.log` |
| unit workspace | 8/8 — **184 files · 2,161 tests** (api 86·1,081 · web 39·240 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36) — the ledger arithmetic **2,161 = 1,081+240+840 EXACT** | `unit-workspace.log` |
| ROUTE_PERMISSIONS | **1,215** (the tsx recount, standing — a docs-only wave) | `route-permissions-recount.log` |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |
| history-secrets | **0 violations** · 7,517 allowlisted hits (the W-42 7,463 +54 — the window's shift: the closure session's commits entering the last-200 sample; sampled 200/319 + the SIX tag anchors, all walked, all untouched) | `history-secrets.log` |

## The full DB suite — THE ELEVEN-PART ENVELOPE (315 files · 4,486 tests · 0 failed · 0 skipped)

**The coverage verified BEFORE the first load run (the W-15 law):**
`coverage-inventory.txt` · `coverage-union.txt` · `coverage-proof.txt` —
315 = 315, missing NONE, extra NONE, duplicates NONE, **VERDICT: COVERED**
(roster: `parts.json`, the W-41 partition standing — a docs-only wave moves
nothing).

| Part | Files · Tests | Time (inside the 570s ceiling) | Log |
|---|---|---|---|
| isolate-soak (standalone FIRST) | 1 · 1 | 230.31s | `db-isolate-soak.log` |
| isolate-fcm (standalone FIRST) | 1 · 8 | — | `db-isolate-fcm.log` |
| isolate-email (standalone FIRST) | 1 · 5 | — | `db-isolate-email.log` |
| isolate-sweep (standalone FIRST) | 1 · 4 | — | `db-isolate-sweep.log` |
| isolate-quality-sweep (standalone FIRST) | 1 · 4 | — | `db-isolate-quality-sweep.log` |
| isolate-trade-sweep (standalone FIRST) | 1 · 6 | — | `db-isolate-trade-sweep.log` |
| chunk-smoke | 3 · 1,999 | — | `db-chunk-smoke.log` |
| chunk-perf-rest | 5 · 23 | — | `db-chunk-perf-rest.log` |
| chunk-a | 127 · 1,100 | 152.55s | `db-chunk-a.log` |
| chunk-b-rest | 86 · 625 | — | `db-chunk-b-rest.log` |
| chunk-c | 88 · 711 | — | `db-chunk-c.log` |

The arithmetic: 315 = 1+1+1+1+1+1+3+5+127+86+88 EXACT · 4,486 =
1+8+5+4+4+6+1,999+23+1,100+625+711 EXACT. Every part inside the amended
570s ceiling. Every stamp VITEST_EXIT=0 through the guarded wrapper.

## The 126-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-42 shape verbatim, copied to this wave's
evidence dir and re-run this session — the chain still stands at 126, a
docs-only wave): initdb a scratch embedded PG16 → apply the chain from
zero → `check:rls` → clean shutdown — run TWICE, both logs kept:
**run 1** `check-rls-scratch-126-run1.log` and **run 2**
`check-rls-scratch-126-run2.log`, each CHAIN_126_APPLIED →
**[check-rls] OK — 354 catalog tables** → SCRATCH_STOPPED, EXIT=0.

## The honest disclosures (two invocation slips + the recovery — the F1 law; no battery red occurred anywhere this wave)

1. **The perf-rest invocation slip:** the first `db-chunk-perf-rest.log`
   invocation carried `master-data-perf.db.spec.ts` under the wrong
   folder (`src/__db__/performance/` instead of the parts.json's own
   `src/__db__/` root) — 4 files · 20 tests ran GREEN, one file silently
   absent; caught by the part-count check against the declared 5 · 23,
   re-invoked with the parts.json's exact paths — **5 · 23 GREEN**, the
   partial log replaced by the complete run, the slip disclosed here
   (the 051-plan wave's own scratch-slip precedent).
2. **The history-secrets command-cap kill:** the first
   `check:history-secrets` attempt was killed by the session's own 300s
   command cap mid-walk (no verdict recorded, no log kept — the killed
   run produced no stamp); re-run with the extended window — green in
   full (the 051-W14 soak-cap precedent class). Both facts disclosed.
3. **The environment recovery** — §0a's ninth-reset record (the stale
   050-W26-era tree reconciled to the remote by init+fetch+reset; pnpm
   via npm -g after corepack's EACCES; the chromium 1248 pair
   provisioned BEFORE the runs).

**NOT production approval — the plan is delivered FOR REVIEW; the
implementation waves are BLOCKED until the owner's approval dispatch
(تسليم لا قبول — ليست موافقة إنتاج).** The standing recalls ride the 051
completion report §4 (transferred verbatim): the 043 hard review OPEN ·
RISK-031/032 OPEN · the §7(b) remarks · the register's exactly-two
narrowed items (SANED 15,000 + EOSB M/51 Art. 84) · the 045 self-board
Tabs defect (the owner dispatches; every 052 board immune — the data-slot
shape) · RISK-033 at EIGHT incidents (ZERO new across 051; the row closes
only by the owner's order). The reservations G-67 · INV-037 — NO BR this
phase — carry the لا-كتابة-خارجها law into every 052 wave.
