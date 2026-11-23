# PHASE-050 W-27 (THE SPC + SUPPLIER SCORES + COA ENGINES) evidence — 2026-11-23 (T-09 + T-10 + T-11; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-27 step-2 head
`fa71b27`'s tree + this gate increment's own repair (the same-session
evidence rule, the **THIRTY-EIGHTH** consecutive wave — the owner's standing
record counts thirty-seven through the W-26 delivery). The wave is the
APPROVED PLAN's §3 W-27 under the owner's standing order — «طيب واصل العمل
وعند الانتهاء من أي خطوة ادفعها إلى المستودع» (every step pushed at its
own commit: `20255ac` the engines → `fa71b27` the DB specs → this gate
increment): **T-09 the SPC pure module + service · T-10 the supplier
quality scores with the documented 038 feed contract · T-11 the COA
generation service (BR-104).**

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ fa71b27` (the W-27 step-2 head — the
  wave's first two commits already on the remote, pushed by the prior
  session per the owner's order); `phase/049` @ `41c3701` · `phase/048` @
  `ba459ff` · `phase/047` @ `5b73bd1` · `phase/046` @ `4ddb39f` — **the
  three annotated tags' six identifiers + the 049 tag intact** (the
  standing rule; re-verified by the history-secrets run's four anchors).
- The working tree: **THE EIGHTH ENVIRONMENT RESET RECOVERED BEFORE THE
  RUNS** — the prior session's clone was destroyed by the sandbox rebuild;
  a FRESH CLONE taken from the remote (the zero-diff source of truth —
  البعيد مصدر الحقيقة الوحيد), the tree clean at HEAD; pnpm 9.15.9 + the
  workspace install + the persistent-store embedded-PG16 binaries
  re-linked (`/home/z/.local/share/erp-env/` — the node_modules symlink,
  zero repo pollution) + the chromium 1200/1248 headless shells
  provisioned BEFORE the runs (the W-16/W-19/W-24 lesson applied).

## The wave's acts (three delivery commits, each pushed at its own step)

1. **THE ENGINES** (`20255ac`): the pure layers FIRST (D-12, the
   unit-first law) — `spc-statistics.ts` THE ONLY SPC ARITHMETIC (the
   pinned Shewhart constants n=2…10 · the subgroup chunk with the trailing
   partial group excluded and disclosed · X̄ᵢ/rᵢ at 6dp · X̄̄±A₂R̄ /
   D₃R̄/D₄R̄ · σ̂=R̄/d₂ · Cp/Cpk against the SPECIFICATION band with the
   no-fabrication nulls · the closed-interval flags on the PUBLISHED
   figures · the degenerate R̄=0 collapse) with 13 property tests on THREE
   PINNED REFERENCE DATASETS (A stable: Cp 1.163000 EXACT · Cpk 1.114542
   · UCLx 10.255800; B the X-chart mean shift; C the R-chart range spike)
   + the constants walk + the order-freedom ×50 + the independent
   JS-oracle ×100 · `supplier-score.ts` (the pinned 0.60/0.40 blend · the
   unmeasured zero · the drag cap — 10 property tests) · `coa-gate.ts`
   (BR-104's pure three-shape fold COMPOSING the tolerance fold — 11
   tests) · the services (SpcService — the chart read returns the PURE
   module's output VERBATIM, zero parallel computation; SupplierScoreService
   — the rolling fold reading the module's OWN register + the FAIL
   goods-receipt inspections + the 038 window's law VERBATIM, the
   calendar-month period, the idempotent upsert; CoaService — the
   provenance floors through the mapping contract's own chain, the
   accepted-deviation NCR validation, the official COA-{YYYY}-{SEQ:6}
   numbering, the FROZEN SNAPSHOT) · **THE 038 FEED CONTRACT (D-13)** —
   the purchasing scorecards' recompute detail carries the quality rows
   VERBATIM (the consumer reads, never re-computes) · the wiring
   (ROUTE_PERMISSIONS **1,125 + 9 = 1,134** — the THIRD keys-seed-first
   binding wave, dated at the block · the error filter's domainStatus rows
   in the same increment).
2. **THE DB SPECS** (`fa71b27`): the three service specs over real PG16 —
   `quality-spc.db.spec` 8 arms (the chart read vs the pure module
   VERBATIM on the pinned dataset A · the DESC-cap law · the trailing
   partial group excluded and disclosed · the ingestion floors with the
   NEGATIVE VALUE LEGAL arm · the batch provenance · the RLS boundary) ·
   `quality-supplier-scores.db.spec` 8 arms (the pinned world through the
   REAL purchasing services: PO → issued → GRN → POSTED through the REAL
   engine + one FAIL inspection + one SUPPLIER NCR → the pinned blend
   defectLeg 0 · deliveryLeg 50 · score 20.00 · the idempotent upsert ·
   the unmeasured zero · the documented 038 feed contract + the honest
   empty shape · the RLS boundary · the window law) ·
   `quality-coa.db.spec` 9 arms (BR-104's three shapes incl. the Arabic
   parameter names in the frozen snapshot · the zero-residue refusal ·
   the deviation floors · the provenance floors incl. the GRN per-line
   resolution · the frozen snapshot — a later spec PATCH never moves a
   stored certificate · the reads + the RLS boundary) + the fixtures'
   supplier world (freshQualitySupplier + seedSupplierDelivery — the FULL
   real chain through the REAL services and the REAL posting engine) +
   the coverage roster's declared movement (**chunk-a 102 → 105 · the
   roster 289 → 292**; `parts.json` + the three coverage files — 292 =
   292, missing NONE, extra NONE, duplicates NONE — VERDICT: COVERED; the
   full ten-part envelope re-runs at W-32's final head) + the
   affected-folder runs at the delta head.
3. **THIS GATE INCREMENT** — the battery (below) + the evidence envelope +
   the ledger accumulation (the acceptance ledger's W-27 dated note: #5
   CLOSED · #6's score arms CLOSED · #4's service arm DELIVERED ·
   NEXT_ACTION → W-28 · the IMPLEMENTATION_STATUS dated line) + the
   lint-repair of this increment's own honest catch.

## THE HONEST CATCHES (two — one per prior step, both RED-proven with the logs; no battery red stands)

1. **The step-2 catch (the 0109/0110 precedent, caught RED at the FIRST DB
   run, before any push of the spec increment):** the step-1 store's
   `spc_measurements` INSERT carried `note_ar` — a column the 0113 table
   does NOT have (the samples are operational rows, a single note column;
   the bilingual note_ar is the master-data registers' shape) — the first
   run's 42703 refused the INSERT BY NAME (`db-first-run-RED.log`, 8
   failed); the repair removes note_ar from the store row, the service
   input, and the controller schema, with the dated comment at the store's
   column block; GREEN 9·139.
2. **THIS INCREMENT's catch (the standing battery's own design — caught
   RED before the wave's close):** the step-1 `spc-statistics.ts:131`
   `Math.floor` — banned by the ADR-0009 floating-math lint rule — caught
   by the FIRST lint run of this gate increment (`lint-RED.log`, 7/8, the
   rule naming the file and line). **THE REPAIR:** the house bitwise
   integer-floor pattern (`(a / b) | 0`) with the dated comment — a pure
   subgroup COUNT, never a rounded measurement; the operands bounded by
   the DESC-cap ingestion law (the newest 20 samples) and the subgroup
   size 2…10, far inside the 2^31 safe range (the tax/hr/sync precedent).
   GREEN re-run 8/8; the affected folders re-run at the final head (the
   quality family 9·139 · the api unit 75·944) — the repair changes NO
   figure (the truncation equals the floor on the positive count domain).

**The honest disclosures (three invocation/environment slips, the F1 law —
no battery red anywhere this increment):** (1) the scratch proof's first
invocation omitted the explicit relative script path through the filter
exec (ERR_MODULE_NOT_FOUND before any DB work —
`scratch-invocation-slip.log` kept; re-invoked with the declared shape,
both runs green); (2) the first workspace-unit invocation passed the
turbo `--force` through the wrong pnpm shape (pnpm's own option parser
rejected `pnpm test --force`; the `-- --force` shape forwarded into
vitest — both rejected before any test ran; the correct
`pnpm run test --force` re-run immediately, 8/8 green, the correct log
kept); (3) the first api-unit run hit the not-yet-provisioned chromium
1248 shell (`unit-api-env-RED.log` kept — 74 passed/1 suite failed on
the missing BINARY, environmental never a code red; after the shell
provisioning: 75·944 GREEN).

## The isolates — THE FIVE standing (the pre-isolation mandate, §0c (2))

| The FIVE isolates (STANDALONE FIRST) | Files · Tests | Log |
|---|---|---|
| soak | 1·1 — 229.30s | `db-isolate-soak.log` |
| fcm | 1·8 — 15.65s | `db-isolate-fcm.log` |
| email | 1·5 | `db-isolate-email.log` |
| the cmms sweep | 1·4 | `db-isolate-sweep.log` |
| the quality calibration sweep | 1·4 | `db-isolate-quality-sweep.log` |

Every stamp VITEST_EXIT=0 through the guarded wrapper.

## The affected DB folders — re-run at the delta head, this session (the scope-label law)

| Folder | Files · Tests | Log |
|---|---|---|
| the quality family | **9 · 139 GREEN** (the schema 59 · the specs 11 · the NCR 13 · the CAPA 17 · the calibration 10 · the sweep 4 · the SPC 8 · the supplier scores 8 · the COA 9 — the family 114 → 139) | `db-affected-quality.log` |
| migrations + identity-flows | **2 · 28 GREEN** (the chain at 118 · the ROUTE_PERMISSIONS checklist over the **1,134** routes — the owner template grants every quality.* key) | `db-affected-migrations-identityflows.log` |

The full ten-part envelope rides at the standing counts **292 files** (the
declared roster movement verified this session: chunk-a 102 → 105 · 292 =
292, missing NONE, extra NONE, duplicates NONE, VERDICT: COVERED —
`parts.json` + `coverage-inventory.txt` + `coverage-union.txt` +
`coverage-proof.txt`) — **W-32 re-runs it at the final head**.

## The 118-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-25/W-26 shape, the chain stamp 118): initdb
a scratch embedded PG16 → apply the chain from zero → `check:rls` → clean
shutdown — run TWICE, both logs kept: **run 1**
`check-rls-scratch-118-run1.log` and **run 2**
`check-rls-scratch-118-run2.log`, each CHAIN_118_APPLIED → **[check-rls]
OK — 340 catalog tables** → SCRATCH_STOPPED, EXIT=0. (The invocation-shape
note, disclosed: `pnpm --filter @erp/api exec tsx
../../audit-evidence/phase050-w27/scratch-rls-proof.ts` from the repo
root — the process cwd is apps/api, so the script path is the explicit
relative one; one process, one log, the wrapper's goal.)

## The standing battery (every log this session, every stamp green)

| Check | Verdict | Log |
|---|---|---|
| typecheck | **8/8** (0 cached — the force re-run) | `typecheck.log` |
| lint | **8/8** (0 cached — the force re-run; the RED first run + the repair disclosed above, `lint-RED.log` kept) | `lint.log` |
| depcruise | clean — **2,147 modules · 16,074 dependencies** (+12/+82 dated) | `depcruise.log` |
| unit workspace | 8/8 (0 cached — the force re-run) — **155 files · 1,955 tests** (api **75·944** · web 21·171 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger arithmetic **1,955 = 944+171+840 EXACT**, the F-2 third term standing) | `unit-workspace.log` (+ `unit-api.log`) |
| permissions drift | **347 = 347** (zero delta — no new keys; the ten quality keys stand from W-24) | `permissions-drift.log` |
| i18n parity | ar=6,955 = en=6,955 (no delta, as declared — an API-DB wave) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities.log` |
| docs:validate | 33/33 | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 61 · INV 34 · BR 100 · reservations 15 phases · 37 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-62/PHASE-050 — the 050 flip is W-32's) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 6,654 allowlisted hits (the W-26 6,624 +30 — the window's shift: the W-27 session commits entering the last-200 sample; the FOUR tag anchors untouched) | `history-secrets.log` |
| ROUTE_PERMISSIONS | **1,125 + 9 = 1,134** (the tsx recount — the keys-seed-first THIRD binding wave) | (the static recount, this session) |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The static constants (recounted this session):** the chain **118
standing** (no migration this wave) · ENTITY_CATALOG **340** · the
registry **315 tenant-owned tables** · the drift **347** ·
ROUTE_PERMISSIONS **1,134** · the report registry **118** (zero change —
the +4 are W-30's) · the unit ledger **155 · 1,955** (72·910 → 75·944
api) · the DB suite roster **292 files** (139 quality-family tests at the
delta head; the full envelope at W-32).

## The physical-file census (the exact-commit-count law)

The wave's commits, in order: (1) **THE ENGINES** (`20255ac` — the 16
new/extended code files incl. the three pure modules + the three services
+ the store/controller/module extensions + the purchasing scorecards feed
contract + route-permissions + the error filter); (2) **THE DB SPECS**
(`fa71b27` — the three spec files + the fixtures' supplier world + the
note_ar repair + `parts.json` + the three coverage files + the two
affected-folder logs + `db-first-run-RED.log`); (3) **THIS GATE
INCREMENT** (the battery logs — the five isolate logs + the
affected-folder logs re-run at the final head + both scratch logs + the
standing checks — + the lint repair with its RED log + this README + the
ledger accumulation: the acceptance criteria's W-27 dated note +
NEXT_ACTION → W-28 + the IMPLEMENTATION_STATUS dated line). Every push
declared its copy count at the time (1 + 1 + 1); the battery evidence is
this final increment's own session.

**NOT production approval — تسليم لا قبول.** W-28 (complaints + holds +
recall — T-12 the complaints API with the NCR link · **T-13 THE SHARED
BLOCKING VALIDATION SERVICE wired into every baseline issue/ship path
(INV-035 + BR-101 — D-07)** · T-14 the recall drill on the batch/serial
ledger) waits on the owner's dispatch under the standing order. The
standing recalls ride the 049 completion report §4; RISK-033 at EIGHT
with ZERO new this wave — the row stays OPEN, closing only by the owner's
order. The reservations G-62…G-63 · INV-035 · BR-101…BR-104 carry the
لا-كتابة-خارجها law into every remaining 050 wave.
