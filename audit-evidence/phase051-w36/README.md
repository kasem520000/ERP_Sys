# PHASE-051 W-36 (TRANSPORT DOCUMENTS + SHIPMENT TRACKING) evidence — 2026-11-25 (T-09 + T-13; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-35 gate head
`0fc3d4c`'s tree + this wave's own increments (the same-session evidence
rule, the **FORTY-EIGHTH** consecutive wave — the owner's standing record
counts forty-seven through the W-35 gate). The wave is the APPROVED PLAN's
§3 W-36 under the owner's launch authorization (the plan ratified as the
binding phase program — إذن إطلاق ONLY, NEVER production approval; the
rulings (a)–(د) carried; the standing order «عند الانتهاء من أي خطوة
ادفعها إلى المستودع» honored — every step pushed at its own commit).

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ 5653574` at the wave's spec head (the
  W-36 step-2 head, pushed at its own commit); `phase/050` @ `01f61a7` ·
  `phase/049` @ `41c3701` · `phase/048` @ `ba459ff` · `phase/047` @
  `5b73bd1` · `phase/046` @ `4ddb39f` — **the four annotated tags' six
  identifiers + the 050 tag intact, local = remote** (the owner's standing
  rule; re-verified by the history-secrets run: all FIVE anchors walked,
  0 violations).
- A FRESH CLONE taken from the GitHub remote (`kasem520000/ERP_Sys`) — the
  clone's HEAD = the remote HEAD (`5653574`), the tree clean (0 tracked
  changes at the verification moment; this gate increment's own files land
  in THIS commit). Env-prep (the NINTH environment reset recovered BEFORE
  the runs — the prior session's clone destroyed by the sandbox rebuild):
  pnpm 9.15.9 provisioned at the user prefix (`~/.local/bin`, the corepack
  pack) · the workspace install re-run (the embedded-PG16 16.14 binaries
  present with the install, `initdb --version` verified) · the chromium
  1248 pair provisioned (chromium-1248 + chromium_headless_shell-1248 —
  playwright 1.64.1's own revisions; the 1200 pair standing in the cache)
  — 0 skipped on every run below.

## The wave's acts (two delivery commits + this gate increment — every step pushed at its own commit per the owner's standing order)

1. **THE TRANSPORT + TRACKING ENGINES** (`258c49a`, T-09 + T-13): THE PURE
   FOLD FIRST (D-14 — the unit-first law): `tracking-fold.ts` — the total
   status × event matrix (the carrier ladder BOOKED/DEPARTED/ARRIVED/
   CLEARED/DELIVERED, ranks 0…4; strictly above → ADVANCE (the multi-rung
   leap allowed); the diagonal → NOOP (the idempotent re-assert); strictly
   below → REFUSED as a drive (THE MONOTONE LADDER — the event still
   records in the append-only log; the 0122 comment's own law); the unknown
   event/current → the typed vocabulary refusals) with 10 property tests
   (the full 5×5 product walked, the never-regress invariant asserted over
   the whole product) → the transport documents API (createBl with the
   official BL-{YYYY}-{SEQ:6} · the multimodal vocabulary · the commercial
   links — the PO import leg + the delivery-note export leg · the container
   refs as JSONB data · the shipment_status NEVER by hand (the transport
   service exposes NO status write) · findBl's own chain (the B/L + its
   packing lists + its events) · listBls · createPackingList with the
   official PL-{YYYY}-{SEQ:6} · THE ANCHOR LAW (the B/L link required at
   the service floor — the declared interpretation recorded at the claim
   site) · the pack lines' floors AND THE PHYSICAL LAW (gross ≥ net)) →
   the shipment tracking API (appendEvent: the anchor B/L typed 404 → the
   milestone vocabulary's typed pre-check → the event shapes → the
   optional declaration link's typed 404 (the read-only documented
   contract — the declarations ENGINE is W-37's own wave) → THE APPEND
   (append-only S/I/U, NO DELETE) → THE DRIVE rendered VERBATIM (the
   fold's verdicts per document: the anchor B/L + the packing lists under
   it + the event's OWN linked declaration; each ADVANCE a race-safe CAS
   with the from-rung pinned) · the event-log reads) → THE SEVEN-ROUTE
   CONTROLLER (trade.shipments.view over the reads ·
   trade.shipments.manage over the creates and THE APPEND) + the wiring
   (the error filter's domainStatus chain — the W-36 codes registered in
   the SAME increment; ROUTE_PERMISSIONS 1,181 + 7 = **1,188** — the
   keys-seed-first THIRD trade binding wave). **NO MIGRATION THIS WAVE**
   (the 0120/0122 floors landed at W-33; the chain stands at 124 — the
   declared slots' constants law, zero additive slot demanded by this
   wave's writers).
2. **THE DB SPECS** (`5653574`): the trade family's service specs GROW —
   `trade-transport.db.spec` (6 arms: the B/L golden create with the PO
   import leg through the REAL PO service · the doc-type vocabulary's
   refusal · the B/L's own floors · the unknown B/L's typed 404 · the
   packing list's anchor + shapes + THE PHYSICAL LAW · the list surfaces)
   + `trade-tracking.db.spec` (9 arms: the golden ladder · the monotone
   law at the service · the multi-rung leap · the declaration drive · the
   milestone vocabulary's typed refusal · the event shapes · the unknown
   B/L's typed 404 · the declaration link's typed 404 · the event-log
   reads) — every arm on ITS OWN world per the owner's «أذرع الرفض كلٌّ
   على عالمه» law.
3. **THE GATE INCREMENT** (this commit): the evidence envelope + the
   acceptance ledger's W-36 dated note (criterion #7's ENGINE arms green
   + #8's chain-navigable transport link; the board arms wait on W-39) +
   the NEXT_ACTION + IMPLEMENTATION_STATUS dated headers.

## THE SIX ISOLATES STANDALONE FIRST (the owner's عزل مسبق order — §0c (2); the set standing since W-34)

soak 1 · 1 (`db-isolate-soak.log`, 228.29s — the GREEN re-run; run 1's
environmental red disclosed below, its log kept) · fcm 1 · 8
(`db-isolate-fcm.log`, 15.65s) · email 1 · 5 (`db-isolate-email.log`,
12.77s) · the cmms sweep 1 · 4 (`db-isolate-sweep.log`, 6.96s) · the
quality calibration sweep 1 · 4 (`db-isolate-quality-sweep.log`, 7.42s) ·
the trade expiry sweep 1 · 6 (`db-isolate-trade-sweep.log`, 7.00s) —
every stamp through THE GUARDED WRAPPER (this session's hardened shape —
see the honest catch #1: the vitest summary lines verified in addition
to the exit code).

## THE ELEVEN-PART ENVELOPE — 307 files · 4,422 tests · 0 failed · 0 skipped

**The coverage verified BEFORE the first load run (the W-15 law):**
`coverage-inventory.txt` · `coverage-union.txt` ·
`coverage-proof.txt` — 307 = 307, missing NONE, extra NONE, duplicates
NONE, **VERDICT: COVERED** (roster: `parts.json` — the W-35 partition
standing + the ONE declared movement: the trade-tracking +
trade-transport specs join chunk-a at their alphabetical positions,
117 → 119 — the W-24/W-34/W-35 quality-schema/trade-lc/trade-collections
precedent's own move).

| Part | Files · Tests | Time (inside the 570s ceiling) | Log |
|---|---|---|---|
| isolate-soak (standalone FIRST) | 1 · 1 | 228.29s | `db-isolate-soak.log` |
| isolate-fcm (standalone FIRST) | 1 · 8 | 15.65s | `db-isolate-fcm.log` |
| isolate-email (standalone FIRST) | 1 · 5 | 12.77s | `db-isolate-email.log` |
| isolate-sweep (standalone FIRST) | 1 · 4 | 6.96s | `db-isolate-sweep.log` |
| isolate-quality-sweep (standalone FIRST) | 1 · 4 | 7.42s | `db-isolate-quality-sweep.log` |
| isolate-trade-sweep (standalone FIRST) | 1 · 6 | 7.00s | `db-isolate-trade-sweep.log` |
| chunk-smoke | 3 · 1,999 | 21.03s | `db-chunk-smoke.log` |
| chunk-perf-rest | 5 · 23 | 90.91s | `db-chunk-perf-rest.log` |
| chunk-a | 119 · 1,036 | 151.54s | `db-chunk-a.log` |
| chunk-b-rest | 86 · 625 | 65.26s | `db-chunk-b-rest.log` |
| chunk-c | 88 · 711 | 77.11s | `db-chunk-c.log` |

The arithmetic: 307 = 1+1+1+1+1+1+3+5+119+86+88 EXACT · 4,422 =
1+8+5+4+4+6+1,999+23+1,036+625+711 EXACT. **The provenance declared:**
4,422 = 4,407 (the W-35 envelope) + 15 (the two trade specs — tracking 9
+ transport 6) EXACT (declared BEFORE the first load run in
`coverage-proof.txt`; the run confirms it). The durations are the vitest
summaries' own printed figures. The single-process full-suite run was
NOT attempted — its expectation exceeds the 570s effective ceiling; the
amended ceiling law's own prescription: split before attempted. The
eleven parts above ARE the split.

## The 124-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-19/W-22/W-0/W-33/W-34/W-35 shape, the
invocation through `pnpm --filter @erp/api exec tsx
../../audit-evidence/phase051-w36/scratch-rls-proof.ts`, the path
relative to the filter's apps/api cwd): initdb a scratch embedded PG16 →
apply the chain from zero (NO migration this wave — the chain 124
standing) → `check:rls` → clean shutdown — run TWICE, both logs kept:
**run 1** `check-rls-scratch-124-run1.log` and **run 2**
`check-rls-scratch-124-run2.log` (run 2 at its own SCRATCH_PORT 5498),
each CHAIN_124_APPLIED → **[check-rls] OK — 354 catalog tables** →
SCRATCH_STOPPED, EXIT=0.

## THE HONEST CATCHES (three disclosures this gate — no battery red standing anywhere)

1. **THE EXIT-CODE DISCOVERY (this session's own — the guarded wrapper
   hardened in response; disclosed at the acceptance ledger's + the
   NEXT_ACTION's claim sites too):** on DB-suite runs the vitest process
   EXIT CODE IS NOT TRUSTWORTHY ON RED. Proven by a deliberate failing
   diagnostic spec (created, run, deleted — the tree never carried it):
   vitest reports "Tests 1 failed (1)" and the process STILL exits 0.
   Root cause: embedded-postgres registers async-exit-hook's beforeExit
   handler at import time; when the vitest main process finishes (its
   exitCode=1 pending), Node fires beforeExit, the hook runs the PG
   graceful shutdown and calls `exit(code !== undefined && code !==
   null, code)` with the hook's OWN code 0 — an explicit
   `process.exit(0)` that CLOBBERS the pending failure code. The prior
   waves' `VITEST_EXIT=0` stamps were valid only because those runs were
   green (exit 0 = pass). This session's wrapper therefore verifies the
   vitest SUMMARY lines in addition to the exit stamp — every part log
   carries `SUMMARY_VERIFY` + `GUARDED_VERDICT: … GREEN` lines (the
   guard demands zero failed files AND zero failed tests).
2. **THE SOAK ISOLATE'S ENVIRONMENTAL RED (run 1, the log kept at
   `db-isolate-soak-env-RED.log`):** the end-of-window sample caught a
   5-deep tail backlog — lastDepth 5 vs the assertion's baseline 1+2=3
   (the queue-health runaway signal; maxDepth passed at baseline+4, the
   dead-letter budget 0). The machine was still settling (the fresh
   clone + install minutes earlier; the soak path touches NO trade code
   — W-36 changed nothing in its dependency closure). The re-run on the
   settled machine: GREEN 1 · 1 at 228.29s, the drain restored
   (queue-health last=0, the samples' own console lines in the log).
   Environmental, never a code red.
3. **THE SCRATCH INVOCATION SLIP (the W-0/W-33 class — the log kept at
   `scratch-invocation-slip.log`):** run 1's first invocation passed the
   repo-root-relative script path to the filter's apps/api cwd —
   ERR_MODULE_NOT_FOUND before any DB work. Re-invoked with the declared
   relative shape (`../../audit-evidence/phase051-w36/…`), both runs
   green. No code touched.

## The standing battery (every log this session, every stamp green — captured at the FINAL code state)

| Check | Verdict | Log |
|---|---|---|
| typecheck | **8/8** (0 cached — the turbo `--force` re-run) | `typecheck.log` |
| lint | **8/8** (0 cached — the turbo `--force` re-run) | `lint.log` |
| depcruise | clean — **2,228 modules · 16,614 dependencies** (+7/+46 dated) | `depcruise.log` |
| unit workspace | 8/8 — **172 files · 2,082 tests** (api 83·1,038 · web 30·204 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger arithmetic **2,082 = 1,038+204+840 EXACT**, an API-DB wave) | `unit-workspace.log` |
| permissions drift | **357 = 357** (unchanged — no key this wave; the W-36 routes bind the EXISTING 0122-seeded keys: trade.shipments.view over the reads, trade.shipments.manage over the creates and the append) | `permissions-drift.log` |
| i18n parity | ar=en catalogs 100% key parity (no delta, as declared — an API-DB wave) | `i18n-parity.log` |
| mobile i18n / tokens | parity standing (371 = 371) · canonical ⊆ mobile | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities-matrix.log` |
| docs:validate | 33/33 (re-run green AFTER this wave's doc edits — the log the post-edit run's own) | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 63 · INV 35 · BR 104 · reservations 14 phases · 30 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-64/PHASE-051 — the 051 flip is W-42's) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 7,091 allowlisted hits (the window's shift: the W-36 session's commits entering the last-200 sample; the FIVE tag anchors untouched — phase/046 `4ddb39f` · phase/047 `5b73bd1` · phase/048 `ba459ff` · phase/049 `41c3701` · phase/050 `01f61a7`) | `history-secrets.log` |
| ROUTE_PERMISSIONS | **1,181 + 7 = 1,188** (the keys-seed-first THIRD trade binding wave, dated at the block — the transport + tracking families' seven routes; the tsx recount this session, ROUTE_PERMISSIONS_COUNT=1188) | (the static recount, this session) |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The static constants (recounted this session):** the chain **124
standing** (NO migration this wave — the 0120/0122 floors landed at
W-33) · ENTITY_CATALOG **354** (no change — no tables this wave) · the
drift **357 = 357** (no key change) · ROUTE_PERMISSIONS **1,188** (+7,
dated) · the report registry **122** (zero change — the +4 are W-40's)
· the unit ledger **172 · 2,082** (+1/+10 — the tracking fold's property
tests) · the DB suite **305 → 307 · 4,407 → 4,422** (+2/+15 — the two
trade specs) · the i18n catalogs **7,253 standing** (an API-DB wave) ·
the tenancy CoA pins **82 accounts · 59 purposes** (unchanged — the 0122
markers standing).

## The physical-file census (the exact-commit-count law)

The wave's commits, in order: `258c49a` (the transport + tracking
engines — 10 files: the fold + its spec · the two services · the errors
· the store extension · the controller · the module wiring · the route
permissions · the error filter) · `5653574` (the DB specs — 3 files:
the two trade specs + the store's one-line extension) · this gate
increment (the evidence envelope — the README + parts.json + the three
coverage files + the scratch proof ts + the logs — + the acceptance
ledger + NEXT_ACTION + IMPLEMENTATION_STATUS). Every push declared its
copy count at the time; the battery evidence is this final increment's
own session.

**NOT production approval — تسليم لا قبول.** W-37 (the customs engine —
T-10: the declarations + lines API, the HS registry extension, the duty
computation into the landed costs (G-65 — D-06) with INV-036's
completeness gate (D-07); the duty/VAT line fold a PURE module FIRST)
waits on the owner's dispatch under the standing order. RISK-033:
EIGHT incidents, ZERO new this wave — the row stays OPEN, closing only
by the owner's order. The standing recalls ride the 050 completion
report §4. The reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا
كتابة خارجها — as reserved, never narrower.
