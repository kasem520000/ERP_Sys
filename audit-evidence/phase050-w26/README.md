# PHASE-050 W-26 (THE CAPA + CALIBRATION ENGINES) evidence — 2026-11-23 (T-07 + T-08; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-25 delivery head
`b4cc743`'s tree + this wave's own increments (the same-session evidence
rule, the **THIRTY-SEVENTH** consecutive wave — the owner's standing record
counts thirty-six through the W-25 delivery). The wave is the APPROVED
PLAN's §3 W-26 under the owner's standing order — «طيب واصل العمل وعند
الانتهاء من أي خطوة ادفعها إلى المستودع» (every step pushed at its own
commit: `b8333a6` the engines → `041a163` the DB specs → this gate
increment): **T-07 the CAPA engine with BR-103's effectiveness gate and
G-63's posting · T-08 the calibration register (D-08's instrument-asset
binding) + the `quality-calibration-due` sweep — THE FIFTH STANDING
ISOLATE from this wave.**

## §0a FIRST — the local-vs-remote verification (the wave's first act)

- The remote verified first: `main @ b4cc743` (the W-25 delivery head —
  the W-25 wave's three commits already on the remote, pushed by the prior
  session per the owner's order); `phase/049` @ `41c3701` · `phase/048` @
  `ba459ff` · `phase/047` @ `5b73bd1` · `phase/046` @ `4ddb39f` — **the
  three annotated tags' six identifiers + the 049 tag intact** (the
  standing rule; re-verified by the history-secrets run's four anchors).
- The working tree: the prior session's clone, reconciled — clean at HEAD
  (`git status` empty, zero local-only files at the wave's opening); the
  environment standing (pnpm 9.15.9, the workspace install, the
  embedded-PG16 binaries, the chromium shells — every DB run below boots
  the embedded server fresh with the full chain from zero).

## The wave's acts (three delivery commits, each pushed at its own step)

1. **THE ENGINES** (`b8333a6`): the CAPA plane (the pure fold FIRST —
   `capa-lifecycle.ts`: the total status × move matrix, the actions array's
   canonical shape law, BR-103's `capaCloseGate` (D-10's two conditions
   exactly — every open action's window elapsed (undated open = the
   fail-closed BLOCK; future-dated = the BLOCK with the figures) AND the
   effectiveness check recorded (the outcome the tenant's honest record,
   never a forced verdict); 16 property tests) · the CAPA service (the
   official `CAPA-{YYYY}-{SEQ:6}` numbering · the NCR link's typed
   pre-check through the module's OWN row · the root-cause-act-IS-the-start
   declared interpretation (OPEN → IN_PROGRESS in the same CAS; at
   IN_PROGRESS the analysis re-records, the stamp refreshed) · **THE G-63
   EXTERNAL-COST ACT** (D-06): DR QUALITY_EXPENSE (5320) · CR
   EXTERNAL_ACCRUAL (2137) through the REAL engine, fail-closed
   PURPOSE_NOT_MAPPED, INV-013 exactly-once on the single-use source key
   `(capa_record, id, external_cost)`, the cost + the journal link in ONE
   guarded CAS (journal_entry_id IS NULL + external_cost = 0 pinned), ONE
   ambient transaction all-or-nothing · **THE CLOSE ACT**: BR-103's typed
   refusals + the checkedAt fabrication guard) + the calibration plane
   (D-08's instrument-AS-asset binding through the fixed-assets module's
   OWN `findAssetCard` with the typed not-found · the official
   `CAL-{YYYY}-{SEQ:6}` numbering · the due-after floor's typed pre-check
   naming BOTH dates · **G-63 AT THE CREATE ACT** — the record id
   PRE-GENERATED (uuidv7) so the INV-013 source key names the row before
   it exists, the posting + the insert ONE ambient transaction; the
   zero-cost in-house shape carries NO entry) + **THE
   QUALITY-CALIBRATION SWEEP** (the pure folds FIRST —
   `calibration-sweep-math.ts`, the 0111 cmms sibling in this module's own
   home, D-08's own dedupe axes `quality:calibration:{assetId}:{threshold}:
   {dueDate}` (the DAY axis the DUE DATE the alert names — the per-cycle
   re-alert with the convergence held within a cycle); 11 property tests ·
   the sweep service (the clock law: every date derived from the
   DATABASE'S OWN CURRENT_DATE in the probe's SQL; the structural dedupe;
   the owner target + the 'quality' prefs gate; THE SEAL
   `quality.calibration_sweep_run` in the same ambient transaction) · the
   pg-boss job (the phase doc's verbatim queue name
   `quality-calibration-due`, daily 04:45 UTC, the 'quality' entitlement
   gate, registered on boot) · **THE SETTINGS SURFACE — the FIRST 050
   SETTINGS KEYS** (`quality.calibration_sweep_thresholds` on the typed
   registry, fail-closed default [30,7,0], the SAME tenant_settings row +
   the SAME publishTenancyEvent invalidation)) · the wiring (12 new
   routes · ROUTE_PERMISSIONS **1,113 + 12 = 1,125** dated at the block —
   the keys-seed-first SECOND binding wave · the error filter's
   domainStatus rows in the same increment · **MIGRATION
   0118_quality_notifications_category.sql** — 'quality' joins BOTH
   notifications CHECK domains (the 18-member union, the shared-scope
   union law), the journal 117 → 118, no tables — the catalog stays 340;
   both scratch runs CHAIN_118_APPLIED → [check-rls] OK — 340).
2. **THE DB SPECS** (`041a163`): the `__db__/quality/` family grows —
   `quality-capa.db.spec` 17 arms (the golden-class G-63 arm DR 5320 · CR
   2137 · INV-013's exactly-once with the single journal standing · the
   unmapped-purpose fail-closed with the ZERO residue + the
   flip-and-restore re-run · the cost at OPEN refused NOT_STARTED ·
   BR-103's three cells (the pending figures; the elapsed-window boundary;
   the CLOSED evidence law) · the fabrication guard · the honest negative
   check) + `quality-calibration.db.spec` 10 arms (the binding's typed
   not-found · the closed result vocabulary · the due-after floor's typed
   pre-check · G-63 at the create act (the unmapped EXTERNAL_ACCRUAL
   leaves NO row and NO journal — the whole create rolls back, INV-018 —
   while the in-house create stays GREEN throughout: a tenant without the
   mapping keeps calibrating, the honest shape) · the newest-first
   per-asset history) + `quality-calibration-sweep.db.spec` 4 arms (**THE
   FIFTH STANDING ISOLATE**): the default ladder firing each band once
   with the severities and the dedupe keys asserted EXACT · the structural
   DEDUPE (the re-run converges) · **THE PER-CYCLE RE-ALERT** (D-08's day
   axis: the re-calibration moves the due far → the instrument stops; the
   next near-dated cycle alerts AGAIN through its new due-date key) · the
   settings surface (the typed write · the custom ladder governs · the
   garbage row fails-closed) + the fixtures' `freshQualityInstrument`
   helper (the per-arm-world law) + the coverage roster's declared
   movement (**chunk-a 100 → 102 · isolate-quality-sweep the new part ·
   the roster 286 → 289**; `parts.json` + the three coverage files —
   289 = 289, missing NONE, extra NONE, duplicates NONE — VERDICT:
   COVERED; the full ten-part envelope re-runs at W-32's final head).
3. **THIS GATE INCREMENT** — the battery (below) + the evidence envelope +
   the ledger accumulation (the acceptance ledger's W-26 dated note: #2's
   CAPA arms + #8's sweep arms DELIVERED, the golden transcripts W-31's ·
   NEXT_ACTION → W-27 · the IMPLEMENTATION_STATUS dated line).

## THE HONEST CATCHES OF THE WAVE (two, both RED-proven with the four-quarter logs — no battery red stands)

1. **The cmms-schema spec's union arms (the G-48 class, caught by W-26's
   own RED run before any push):** the W-25 scope-label run had left the
   stock_moves union arm's EXPLICIT bookkeeping stale at 0117's new
   constraint site — 0117 (the W-25 stock-moves source widening admitting
   `ncr_record` for G-62's write-off moves) defined
   `ck_stock_moves_source_shape` at a NEW migration site, and the arm's
   own design (the owner's «تعدّ الأعضاء صراحة» law — the lineage + the
   members enumerated explicitly) went RED the moment the migrations dir
   carried it: `db-cmms-schema-union-RED.log` (VITEST_EXIT=1 — the
   lineage missing `0117_quality_ncr_source_shape.sql`, the members
   missing `ncr_record`). **THE REPAIR:** the dated notes at every
   modified site (the lineage 10 → 11 sites; the members 23 → 24) —
   `db-cmms-schema-union-GREEN.log` (32/32). The notifications arm's
   enumeration grew 17 → 18 with `quality` in the same repair (0118's
   own demand). The union LAW's dynamic check (live == the all-migrations
   union) had stayed green throughout — the drift was in the arms'
   explicit bookkeeping only, the exact class the arms exist to catch.
2. **The sweep probe's LATEST-FIRST LAW (caught by the per-cycle arm RED
   at the first family run):** the band filter originally sat INSIDE the
   per-instrument DISTINCT ON collapse, so a re-calibrated instrument
   (its newest record due +300) still flagged on its superseded +15 row —
   `db-sweep-probe-RED.log` (VITEST_EXIT=1 — expected 4 flagged, the
   renewed instrument among them). **THE REPAIR:** the collapse runs
   BEFORE the band filter (the instrument's CURRENT obligation is its
   newest due date — the dated comment at the claim site); GREEN 114/114
   (`db-affected-quality.log`). The RED log is the honest reproduction
   against the pre-fix probe shape (the four-quarter discipline).

**The declared interpretations (three, the wave README's table):**

1. **The root-cause act IS the start act** (the CAPA ladder's own move):
   recording the root-cause analysis moves OPEN → IN_PROGRESS in the same
   CAS — the analysis begins the working life; at IN_PROGRESS the act
   re-records (the analysis evolved, root_cause_at refreshed). The 0114
   stamp gate's own shape (the G-63 journal exists only at
   IN_PROGRESS/CLOSED) is satisfied: a cost never lands on an unstarted
   record.
2. **The effectiveness record's OUTCOME is the tenant's honest evidence**
   (D-10 demands the CHECK RECORDED, never a forced "effective" verdict):
   a negative check closes the CAPA with the honest record preserved; the
   gate's temporal half is the due-date pass (the refusal carrying the
   open action/due-date figures). THE checkedAt FLOOR (the service's own
   fabrication guard): a future-dated check is refused; a backdated check
   is the tenant's honest record of when it actually happened.
3. **D-08's «per instrument+window+day» dedupe axes** — the DAY is the
   DUE DATE the alert names (never the current day: the convergence law
   forbids a per-day accumulation): a re-calibrated instrument's new due
   date forms NEW keys, so the next cycle alerts again (the cmms
   once-ever shape would go silent after one cycle exactly where a
   calibration program lives on cycles); within one cycle re-runs, the
   nightly cron, and raced concurrent passes all CONVERGE (the same key
   dedupes).

## The isolates — THE FIVE now (the pre-isolation mandate, §0c (2): the sweep joins the standing set the wave it ships)

| The FIVE isolates (STANDALONE FIRST) | Files · Tests | Log |
|---|---|---|
| soak | 1·1 — 229.11s | `db-isolate-soak.log` |
| fcm | 1·8 | `db-isolate-fcm.log` |
| email | 1·5 | `db-isolate-email.log` |
| the cmms sweep | 1·4 | `db-isolate-sweep.log` |
| **the quality calibration sweep — the NEW FIFTH** | 1·4 | `db-isolate-quality-sweep.log` |

Every stamp VITEST_EXIT=0 through the guarded wrapper.

## The affected DB folders — re-run at the delta head, this session (the scope-label law)

| Folder | Files · Tests | Log |
|---|---|---|
| the quality family | **6 · 114 GREEN** (the schema 59 · the NCR 13 · the specs 11 · the CAPA 17 · the calibration 10 · the sweep 4 — the family 83 → 114) | `db-affected-quality.log` |
| migrations + identity-flows | **2 · 28 GREEN** (the chain at 118 · the ROUTE_PERMISSIONS checklist over the 1,125 routes — the owner template grants every quality.* key) | `db-affected-migrations-identityflows.log` |
| the cmms schema (the shared domain's own claim site) | **1 · 32 GREEN** (the repaired union arms) | `db-affected-cmms-schema.log` |

The full ten-part envelope rides at the standing counts **289 files** (the
declared roster movement verified: chunk-a 100 → 102 · isolate-quality-sweep
the new part; `parts.json` + `coverage-inventory.txt` + `coverage-union.txt` +
`coverage-proof.txt` — 289 = 289, missing NONE, extra NONE, duplicates NONE,
VERDICT: COVERED) — **W-32 re-runs it at the final head**.

## The 118-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts` (the W-25 shape, the chain stamp 118): initdb a
scratch embedded PG16 → apply the chain from zero → `check:rls` → clean
shutdown — run TWICE, both logs kept: **run 1**
`check-rls-scratch-118-run1.log` and **run 2**
`check-rls-scratch-118-run2.log`, each CHAIN_118_APPLIED → **[check-rls]
OK — 340 catalog tables** → SCRATCH_STOPPED, EXIT=0. (The invocation-shape
note, disclosed: `pnpm --filter @erp/api exec tsx
../../audit-evidence/phase050-w26/scratch-rls-proof.ts` from the repo root —
the process cwd is apps/api, so the script path is the explicit relative
one; one process, one log, the wrapper's goal.)

## The standing battery (every log this session, every stamp green)

| Check | Verdict | Log |
|---|---|---|
| typecheck | **8/8** (0 cached — the force re-run) | `typecheck.log` |
| lint | **8/8** (0 cached — the force re-run) | `lint.log` |
| depcruise | clean — **2,135 modules · 15,992 dependencies** (+11/+86 dated) | `depcruise.log` |
| unit workspace | 8/8 (0 cached — the force re-run) — **152 files · 1,921 tests** (api **72·910** · web 21·171 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — the ledger arithmetic **1,921 = 910+171+840 EXACT**, the F-2 third term standing) | `unit-workspace.log` |
| permissions drift | **347 = 347** (zero delta — no new keys; the ten quality keys stand from W-24) | `permissions-drift.log` |
| i18n parity | ar=6,955 = en=6,955 (no delta, as declared — an API-DB wave) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities.log` |
| docs:validate | 33/33 | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 61 · INV 34 · BR 100 · reservations 15 phases · 37 ids | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-62/PHASE-050 — the 050 flip is W-32's) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 6,624 allowlisted hits (the W-25 6,579 +45 — the window's shift: the W-26 session commits entering the last-200 sample; the FOUR tag anchors untouched) | `history-secrets.log` |
| ROUTE_PERMISSIONS | **1,113 + 12 = 1,125** (the tsx recount — the keys-seed-first SECOND binding wave) | (the static recount, this session) |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The static constants (recounted this session):** the chain **117 → 118**
(0118 — the notifications-category widening, no tables) · ENTITY_CATALOG
**340** (the dated note on the quality header) · the registry **315
tenant-owned tables** · the drift **347** · ROUTE_PERMISSIONS **1,125** ·
the report registry **118** (zero change — the +4 are W-30's) · the unit
ledger **152 · 1,921** (70·883 → 72·910 api) · the DB suite roster **289
files** (114 quality-family tests at the delta head; the full envelope at
W-32).

## The physical-file census (the exact-commit-count law)

The wave's commits, in order: (1) **THE ENGINES** (`b8333a6` — the module's
9 new/extended code files + the migration 0118 + `meta/_journal.json` +
`migrations.ts` + `migrations.spec.ts` + `route-permissions.ts` +
`error.filter.ts` + `inbox-service.ts` + `settings-schema.ts` + the
ENTITY_CATALOG dated note + the cmms-schema spec's repaired union arms +
the first 12 evidence files incl. the RED/GREEN union pair and both scratch
logs); (2) **THE DB SPECS** (`041a163` — the three spec files + the
fixtures extension + the probe's LATEST-FIRST repair + `parts.json` + the
three coverage files + the family log); (3) **THIS GATE INCREMENT** (the
battery logs — the five isolate logs + the affected-folder logs + the
standing checks — + the probe's RED reproduction log + this README + the
ledger accumulation: the acceptance criteria's W-26 dated note +
NEXT_ACTION → W-27 + the IMPLEMENTATION_STATUS dated line). Every push
declared its copy count at the time (1 + 1 + 1); the battery evidence is
this final increment's own session.

**NOT production approval — تسليم لا قبول.** W-27 (SPC + supplier scores +
COA — the SPC pure module FIRST on pinned reference datasets per D-12, the
038 feed contract per D-13, BR-104's tolerance gate per D-11) waits on the
owner's dispatch under the standing order. The standing recalls ride the
049 completion report §4; RISK-033 at EIGHT with ZERO new this wave — the
row stays OPEN, closing only by the owner's order. The reservations
G-62…G-63 · INV-035 · BR-101…BR-104 carry the لا-كتابة-خارجها law into
every remaining 050 wave.
