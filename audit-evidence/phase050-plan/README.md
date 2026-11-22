# PHASE-050 W-0 (THE MASTER PLAN WAVE) evidence — 2026-11-22 (the plan-first wave, سابقة 049-W0; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the fresh clone of the
owner-accepted 049 closure head `41c3701` = the tag `phase/049` (the
same-session evidence rule, the **THIRTY-FOURTH** consecutive wave — the
owner's standing record counts thirty-three through the 049 closure). The
wave is DOCS-ONLY: the master plan + the acceptance ledger opening + the
five dated corrections; the CODE tree stands at the W-23 head byte-identical,
so the battery's constants are the closure's own figures re-proven.

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ 41c3701` = the tag `phase/049`
  (annotated `1fd74e9` peeling to the W-23 archive head); `phase/048` @
  `ba459ff` · `phase/047` @ `5b73bd1` · `phase/046` @ `4ddb39f` — **the
  three annotated tags' six identifiers + the 049 tag intact** (the owner's
  standing rule).
- A FRESH CLONE taken from the GitHub remote — the clone's HEAD = the remote
  HEAD = `41c3701`; the working tree reconciled against it: **ZERO content
  differences, ZERO missing files** (the 879/879 git-tracked evidence-log
  census — no snapshot loss this session).
- Env-prep: pnpm 9.15.9 + the workspace install re-run in the fresh clone
  (store-cached, 6.7s); chromium headless-shell 1248 already provisioned —
  **0 skipped on every run below**.

## The wave's acts

1. **THE MASTER PLAN** `agent-ctx/PHASE-050-MASTER-PLAN.md` — PROPOSED, FOR
   REVIEW BEFORE LAUNCH; the implementation waves BLOCKED until the owner's
   approval dispatch (a launch authorization, NEVER production approval).
2. **THE ACCEPTANCE LEDGER OPENED** `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md`
   §PHASE-050 — the ten criteria with their ARMS and WAVES (the owner's
   framework law: the ledger opens with the plan and closes with the
   closure).
3. **THE FIVE DATED CORRECTIONS (the dispatch's order, all landed at their
   claim sites):** F-1 the 049 completion report's §1 wave table (the four
   head cells + the two counts corrected — verified against the git log this
   session, the dated note under the table) · F-2 the unit-ledger third term
   «940 → 840» at ALL FOUR evidence sites (w19/w20/w21/w22 gate READMEs —
   **the dispatch counted three positions; this session's sweep found the
   fourth of the same class; all four fixed, the count disclosed here and in
   the plan §0b; this session's own unit battery re-proves 1,868 =
   857+171+840 EXACT**) · F-3 the IMPLEMENTATION_STATUS header (the dated
   line prepended — the stale 048-era top line stood since 2026-11-20) ·
   F-4 the 050 archive form declared explicitly (the plan §5:
   `ERP_PLATFORM_PHASE050.zip` — the git-tracked tree at the closure head,
   the commit-hash first entry, ADDITIVE-ONLY, EXCLUDING every standing
   platform zip: أرشفة الأرشيف ممنوعة · the tag `phase/050` — DELIVERY,
   never acceptance) · the archive-form acknowledgment recorded (the plan
   §5's closing block).
4. **NEXT_ACTION** updated to the plan wave (the review boundary carried).

## The standing battery (every log this session, every stamp green)

| Check | Verdict | Log |
|---|---|---|
| docs:validate | **33/33** | `docs-validate.log` |
| id-ledger | **0 errors** — implemented G 61 · INV 34 · BR 100 · reservations 15 phases · 37 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-62/PHASE-050 — the 050 flip is W-32's) | `id-ledger-self-test.log` |
| permissions drift | 337 = 337 (the +10 keys are W-24's) | `permissions-drift.log` |
| i18n parity | ar=6,955 = en=6,955 | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities.log` |
| depcruise | clean — 2,110 · 15,821 (the W-22 count EXACT — a docs-only wave) | `depcruise.log` |
| typecheck | 8/8 | `typecheck.log` |
| lint | 8/8 | `lint.log` |
| unit workspace | 8/8 — **148 files · 1,868 tests** (api 68·857 · web 21·171 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36) — the ledger arithmetic **1,868 = 857+171+840 EXACT** | `unit-workspace.log` |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |
| history-secrets | **0 violations** · 6,543 allowlisted hits (the W-22 6,525 +18 — the window's shift: the two W-23 commits entered the last-200 sample) | `history-secrets.log` (+ `history-secrets-slice1/2/3.log` — the RESUMED slices 67+67+66, coverage EXACT 200/200; the FOUR tag anchors untouched) |

## The full DB suite — THE NINE-PART ENVELOPE (283 files · 3,984 tests · 0 failed · 0 skipped)

**The coverage verified BEFORE the first load run (the W-15 law):**
`coverage-inventory.txt` · `coverage-union.txt` · `coverage-proof.txt` —
283 = 283, missing NONE, extra NONE, duplicates NONE, **VERDICT: COVERED**
(roster: `parts.json`, the W-22 partition standing — a docs-only wave moves
nothing).

| Part | Files · Tests | Time (inside the 570s ceiling) | Log |
|---|---|---|---|
| isolate-soak (standalone FIRST) | 1 · 1 | 227.4s | `db-isolate-soak.log` |
| isolate-fcm (standalone FIRST) | 1 · 8 | 14.7s | `db-isolate-fcm.log` |
| isolate-email (standalone FIRST) | 1 · 5 | 12.3s | `db-isolate-email.log` |
| isolate-sweep (standalone FIRST) | 1 · 4 | 6.1s | `db-isolate-sweep.log` |
| chunk-smoke | 3 · 1,843 | 19.2s | `db-chunk-smoke.log` |
| chunk-perf-rest | 5 · 23 | 94.0s | `db-chunk-perf-rest.log` |
| chunk-a | 97 · 764 | 141.6s | `db-chunk-a.log` |
| chunk-b-rest | 86 · 625 | 63.9s | `db-chunk-b-rest.log` |
| chunk-c | 88 · 711 | 74.7s | `db-chunk-c.log` |

The arithmetic: 283 = 1+1+1+1+3+5+97+86+88 EXACT · 3,984 =
1+8+5+4+1,843+23+764+625+711 EXACT. The durations are the vitest summaries'
own printed figures (each inside its log). **The single-process full-suite run was
NOT attempted** — its expectation exceeds the 570s effective ceiling
(min(≈630s, 600−30)); the amended ceiling law's own prescription: split
before attempted. The nine parts above ARE the split.

## The 112-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-19/W-22 shape verbatim): initdb a scratch
embedded PG16 → apply the chain from zero → `check:rls` → clean shutdown —
run TWICE, both logs kept: **run 1** `check-rls-scratch-112-run1.log` and
**run 2** `check-rls-scratch-112-run2.log`, each CHAIN_112_APPLIED →
**[check-rls] OK — 328 catalog tables** → SCRATCH_STOPPED.

## The honest disclosures (two, both invocation slips — the F1 law; no battery red occurred anywhere this wave)

1. **The typecheck invocation slip:** the first attempt ran
   `pnpm typecheck -- --force`, forwarding `--force` through turbo into tsc
   (TS5093 — the option wants `--build`); the plain invocation re-run
   immediately — **8/8 green** (`typecheck.log` is the green run). The failed
   invocation's log was replaced by the correct one; the slip disclosed here
   (the 049 plan wave's i18n-checker slip precedent).
2. **The scratch invocation slip:** the first scratch attempt ran the proof
   script from `apps/api/`, where the workspace-root `check:rls` script is
   unreachable (`ERR_PNPM_NO_SCRIPT` — the chain itself had applied green);
   re-invoked from the repo root per the W-22 precedent — both runs green,
   both logs kept. The incomplete attempt's log was replaced by run 1's
   complete one; the slip disclosed here.

**NOT production approval — the plan is delivered FOR REVIEW; the
implementation waves are BLOCKED until the owner's approval dispatch
(تسليم لا قبول — ليست موافقة إنتاج).** The standing recalls ride the 049
completion report §4; the reservations G-62…G-63 · INV-035 · BR-101…BR-104
carry the لا-كتابة-خارجها law into every 050 wave.
