# PHASE-049 W-16 evidence — 2026-11-21 (this session, the fresh clone at `20b56d3` — §0a verified)

Every log below was generated THIS session (the same-session evidence rule, the
TWENTY-FIFTH consecutive wave) in `/home/z/my-project/ERP_Sys` (a FRESH CLONE at the
owner-approved plan head `20b56d3` — **§0a THE SESSION'S FIRST ACT: the remote verified
(`main` @ `20b56d3`, the plan commit on the delivery head `ba459ff` = the tag `phase/048`;
the three tags in place, untouched) → the clone → the working tree CLEAN — المحلي =
البعيد قبل أول سطر**), captured through `scripts/capture-evidence.sh` (the W-6
vitest-summary-guarded wrapper; the NF-12 verdict rule everywhere: the summary lines or
the guarded stamp, never the raw process code alone). The four quarters of every test
session are preserved verbatim (NF-7).

**THE EXIT, STATED EXPLICITLY: W-16's exit is ACCEPTANCE CRITERION #1's foundation
arms** — the four migrations 0105–0108 + EVERY mirror/registry/catalog/matrix/pin in ONE
increment (the Drizzle mirrors +8 tables + the assets column family · tables.registry
+8 → the A-suite +48 · ENTITY_CATALOG 318 → 326 · the journal/manifest/spec pins to
108 · +10 permission keys 326 → 336 with zero drift · the two flags D-16 · the four
template manifests' coherent change with every hash re-pinned · the TOTP fix under its
ordered acceptance · the `__db__/cmms/` family opened per the hr precedent) — the chain
re-proven from zero TWICE, the full DB suite at the new count in the EIGHT-PART
ENVELOPE with the three isolates standalone FIRST, every standing checker green.
**NOT production approval. The phase's acceptance #1 closes at W-23 with the rest of
the ledger.**

## The constants declared after the wave (the owner's framework item 6)

- **The migration journal: 0108** (idx 107, 108 files; the manifest ↔ journal ↔ files
  spec pin extended to `0108_cmms_asset_extensions`).
- **ENTITY_CATALOG: 326 table rows** (318 + the CMMS cluster's EIGHT — the check:rls
  scratch proof says `OK — 326 catalog tables` on BOTH from-zero runs).
- **The permissions drift: 336 = 336** (326 + the ten assets.* keys, matrix §3.27).
- **ROUTE_PERMISSIONS: 1,052 — UNCHANGED** (keys-seed-first: zero new routes at W-16,
  the `/api/v1/assets/*` families bind the keys as W-17…W-19 ship; the matrix §3.27
  dated note records it — W-13's `(1051 + 1 = 1052)` block remains the last route delta).
- **i18n: 6,620 = 6,620 + mobile 371 = 371 — NO DELTA, exactly as declared** (the
  migrations-only wave, the API-only precedent; the first surface wave is W-20).
- **depcruise: 2,056 modules · 15,380 dependencies** (the W-0 baseline 2,054 · 15,372
  +2 modules · +8 dependencies — the cmms family's two files: `fixtures.ts` +
  `cmms-schema.db.spec.ts`; the environmental-delta disclosure law).
- **The unit battery: 8/8 packages — 140 files · 1,803 tests** (api 65·816 · web
  **16**·147 · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core
  6·38 · sync-core 5·36) — **see disclosure 1: the F1 file-count correction; the TESTS
  arithmetic 1,803 = 816+147+840 is EXACT and untouched.**
- **The full DB suite: 272 files · 3,885 tests · 0 failed · 0 skipped** (the W-15
  271 · 3,807 + the A-suite's 48 arms over the eight new tables + the cmms family's
  first spec 1·30) — the EIGHT-PART ENVELOPE below.
- **id-ledger: 0 errors + self-test all-probes-OK** (implemented G 58 · INV 33 · BR 96;
  reservations 16 phases · 45 ids — the owner's clarified arithmetic; the 049 flip is
  W-23's).

## The logs (36 physical files — every one declared)

| Log | What it proves | Stamp |
|---|---|---|
| `check-rls-scratch-run1.log` | **THE CHAIN FROM ZERO — RUN 1**: initdb a scratch embedded PG16 → the 108-chain applies from zero → `[check-rls] OK — 326 catalog tables` → clean shutdown | EXIT=0 |
| `check-rls-scratch-run2.log` | **THE CHAIN FROM ZERO — RUN 2** (السلسلة من الصفر مرتين): the same proof, again — 108 applied, 326, clean | EXIT=0 |
| `db-isolate-soak.log` | **THE PRE-ISOLATION MANDATE, isolate 1** (run standalone FIRST, before any heavy envelope — §0b (2)): soak 1 file · 1 test | VITEST_EXIT=0 |
| `db-isolate-fcm.log` | **isolate 2**: fcm 1 · 8 | VITEST_EXIT=0 |
| `db-isolate-email.log` | **isolate 3**: email 1 · 5 | VITEST_EXIT=0 |
| `coverage-inventory.txt` / `coverage-union.txt` / `coverage-proof.txt` | **THE COVERAGE VERIFIED BEFORE THE FIRST LOAD RUN**: the disk inventory == the parts union — **272 = 272, missing NONE, extra NONE, duplicates NONE** (the W-15 parts plan + the cmms spec joining chunk-a) | static |
| `parts.json` | The W-16 eight-part plan (the W-15 restructure carried + the cmms family's first spec) | static |
| `db-chunk-smoke.log` | **THE SMOKE FAMILY 3 files · 1,831 tests** (1,783 + the A-suite's +48 over the eight registered tables) — migrations + the isolation family, embedding the 108-chain boot from zero; **kept: this is the re-run after the two honest catches below** | VITEST_EXIT=0 |
| `db-chunk-perf-rest.log` | perf-rest **5 · 23** | VITEST_EXIT=0 |
| `db-chunk-a.log` | **chunk-a 87 · 681** (86·651 + the cmms schema spec 1·30) — GREEN ON THE FIRST ATTEMPT: the TOTP fix IN-PART (identity-flows rides chunk-a — the plan wave's flake was here), the template specs' enablement arms green | VITEST_EXIT=0 |
| `db-chunk-b-rest.log` | **chunk-b-rest 86 · 625 · 0 skipped** (the re-run after disclosure 2) | VITEST_EXIT=0 |
| `db-chunk-c-first-red.log` | **THE HONEST FIRST RED, kept verbatim** — 2 failed: the provisioning/HTTP CoA count pins (76/53 → the three 0108 §4 markers) | VITEST_EXIT=1 |
| `db-chunk-c-second-red.log` | **kept**: 1 failed — the third pin site (the accounts array length) | VITEST_EXIT=1 |
| `db-chunk-c-third-red.log` | **kept**: 1 failed — the idempotency existing-counts pair | VITEST_EXIT=1 |
| `db-chunk-c.log` | **chunk-c 88 · 711** (the W-15 count EXACT — zero new specs in the part) | VITEST_EXIT=0 |
| `db-cmms-schema.log` | **THE `__db__/cmms/` FAMILY OPENS** (the hr/projects precedent): `cmms-schema.db.spec.ts` 1 file · 30 tests — the machine's stamp law refused BY NAME · BR-097's single-open partial unique (a COMPLETED order re-arms the plan) · the plans' XOR trigger shape + the METER-only anchor gate · the odometer law (KM-only + ONE per asset — R-10) · the readings' JOB-link XOR · the spares/tags floors · the transfers' verdict-XOR ladder + the G-61 journal gate · the not-self parent floor + the cost-center FK — **every rejection arm on its OWN world** (أذرع الرفض كلٌّ على عالمه) | VITEST_EXIT=0 |
| `db-totp-fix-standalone.log` | **THE TOTP FIX — STANDALONE GREEN 21/21** (the exact count the incident record named): `currentTimestep(Date.now()) + 1` — the deterministic derivation the owner ordered (the mfa-policy PHASE-038 repair's shape); the dated F1 comment at the site carries the boundary arithmetic | VITEST_EXIT=0 |
| `typecheck.log` | typecheck **8/8 packages** (re-swept after the last edit) | EXIT=0 |
| `lint.log` | lint **8/8 packages** (re-swept) | EXIT=0 |
| `depcruise.log` | no violations — **2,056 modules · 15,380 dependencies** (the dated +2/+8 delta) | EXIT=0 |
| `unit-workspace.log` | unit **8/8 packages — 140 files · 1,803 tests** (the F1-corrected file count; the tests ledger EXACT) — the totp domain spec 7/7 (the in-unit leg of the TOTP acceptance) | EXIT=0 |
| `i18n-parity.log` | ar=6,620 = en=6,620 (no delta — the API-only precedent) | EXIT=0 |
| `mobile-i18n.log` | mobile ar=371 = en=371 | EXIT=0 |
| `mobile-tokens.log` | 50/50 token derivations (canonical ⊆ mobile) | EXIT=0 |
| `manifests.log` | **13/13 valid** (the four CMMS-carrying templates at their NEW hashes) | EXIT=0 |
| `docs-validate.log` | **33/33 checks** (the new catalog section + the matrix §3.27 covered by the corpus-wide checks 1a/2 + the structure checks) | EXIT=0 |
| `id-ledger.log` | 0 errors (the 049 reservations G-59…G-61 · INV-034 · BR-097…100 STAND — the flip is W-23's) | EXIT=0 |
| `id-ledger-self-test.log` | the self-test all-probes-OK (probes 1–9d) | EXIT=0 |
| `history-secrets.log` | **0 violations** · 6,401 allowlisted fixture hits across **12** documented paths (the dated audit-evidence/ entry — disclosure 4) | EXIT=0 |
| `capabilities.log` | capabilities matrix and fixture agree | EXIT=0 |
| `desktop-shell.log` / `mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative.log` | the negative boundary meta-test PASS | EXIT=0 |
| `scratch-rls-proof.ts` | The scratch proof's source (the W-16 variant of the plan wave's script — the 108 label; committed so the log's four quarters reproduce) | source |

Static recounts this session (verified against the artifacts, F1): the journal
**108** (the manifest ↔ journal ↔ files spec green) · ROUTE_PERMISSIONS **1,052**
(the tsx recount; zero rows added) · the report registry **114** (zero change — the +4
contracts are W-22's) · the registry **301** tenant-owned tables (293 + 8) ·
ENTITY_CATALOG **326** (both scratch runs) · the CoA template markers **+3** (5310 ·
2138 · 2137 — the provisioning pins moved 76/53 → 79/56, the dated notes at all four
sites).

## THE PARTS-LEDGER MOVEMENT NOTE (dated 2026-11-21, W-18 — retroactive, استرجاعًا قائمًا)

**The owner's parts-ledger arithmetic found an informational gap in THIS README's
`a 87 · 681` declaration, and the investigation closes it here (the new law: a
metrics/tree conflict opens the investigation in its OWN wave, never the next):**
the movement into chunk-a did NOT happen during W-16 — it happened at THE PLAN WAVE
(`20b56d3`, the same 2026-11-21), when `parts.json` was introduced and the three load
chunks were **re-partitioned by domain family**: **162 of the 260 load files moved
between the parts (gross)** — `a→b 26 · a→c 34 · b→a 26 · b→c 25 · c→a 38 · c→b 13`
(verified: the W-15 logs' per-file rosters vs the plan wave's `parts.json`; the
coverage union identical, 271 = 271 — a pure re-partition) — with the NET deltas
**chunk-a 82·596 → 86·651 (+4 files · +55 tests) · chunk-b-rest 98·772 → 86·625
(−12 · −147) · chunk-c 80·619 → 88·711 (+8 · +92)**, the total unchanged
271 · 3,807. **W-16 itself moved NOTHING between parts**: `a 87·681` = the plan
wave's `86·651` + the declared cmms schema spec `1·30` EXACT. The plan wave's README
declared its own parts but never declared the RE-PARTITION as a movement against
W-15's — the gap. The owner's lower bound («4 ملفات·7 اختبارات على الأقل») is
correctED here to the exact figures: **+4 files · +55 tests net into a** (the gross
162 files named above). Standing law from W-18: every future re-partition declares
its movement — the file list, the net and the gross — in its own wave's report.

## THE FIVE HONEST DISCLOSURES

1. **THE F1 WEB FILE-COUNT CORRECTION (dated 2026-11-21, W-16 — the original claim
   sites: the W-13/W-14/W-15 evidence READMEs + the PHASE-048 completion report +
   the plan-wave §0a note):** the web unit package has counted **16 files · 147
   tests in EVERY actual log since W-13** (W-13's own log: `Test Files 16 passed
   (16)`; W-14, W-15, the plan wave, and W-16's logs all agree) and every tree
   from `00fc42f` through `20b56d3` carries exactly 16 web test files — while the
   recorded ledger said **17 · 147** (total 141 · 1,803). The origin: W-13's README
   line «web 17·147 (16·144: …)» — the arithmetic it meant was W-12's 14·144 + the
   contracting-print spec + the fieldservice spec = **16·147**; the 17 (and the
   141 total) is a phantom +1 carried through W-14's table, the completion report,
   and the plan wave's §0a note (which built the "16 would have been counted"
   recovery story on it — the recovery itself was REAL: the parity file WAS missing
   from the unrestored sandbox snapshot and WAS restored; the count it would have
   produced is 15, not 16, and the restored count is 16, not 17). **The owner's own
   verification arithmetic — 1,803 = 816+147+840 — is EXACT and UNTOUCHED** (the
   tests column was always right); the FILE-count column carries the correction:
   web 17 → **16**, total 141 → **140**, dated today at this claim site, the F1
   law's exact prescription. The old evidence READMEs stay as-committed (the
   additive-only archive law) with this correction pointing at them.
2. **THE CHUNK-B-REST FIRST RUN'S THREE SKIPS (environment, repaired mid-envelope):**
   the browser-gated print-render arms skipped — the plan wave's env-prep step
   (chromium headless-shell **1248**) was initially missed in this session's
   re-provisioning (the sandbox cache carried only 1200). Installed
   (`pnpm exec playwright install chromium-headless-shell`), the launch probe OK,
   the re-run **625 · 0 skipped**. The first run's log (86 files · 622 passed |
   3 skipped, VITEST_EXIT=0) was replaced by the re-run — the four quarters of the
   replaced run: the same chunk command, `622 passed | 3 skipped`, exit stamp 0,
   17:35:46–17:36:48 UTC; the honest env-prep disclosure (the 046 W-0 precedent's
   shape).
3. **THE CHUNK-C THREE REDS (four logs kept — the honest re-pin sequence):** the
   first run failed 2 (the tenancy-http + tenancy-provisioning CoA count pins);
   the second failed 1 (the accounts array length — a third site of the same
   class); the third failed 1 (the idempotency existing-counts pair); the fourth
   **88 · 711 green**. All four logs kept verbatim; the pins re-pinned with the
   dated notes (76/53 → 79/56 + the 0108 §4 marker arithmetic at every site).
4. **THE HISTORY-SECRETS ALLOWLIST EXTENSION (dated, the checker's own
   same-class procedure):** the scan's first run failed on the plan wave's
   committed `scratch-rls-proof.ts` (the embedded-PG `postgres:postgres@127.0.0.1`
   dev URL) — the plan wave's own scan ran pre-commit (honest at capture time);
   the committed file is immutable evidence (the additive-only archive law). The
   dated `audit-evidence/` entry added (the twelfth documented path — exactly the
   `scripts/` class, the pattern the checker's header prescribes for same-class
   extensions); 0 violations after.
5. **THE SMOKE CHUNK'S TWO CATCHES (the first-red log replaced by the re-run —
   both disclosed here):** (a) the A-suite's fixture maps needed the eight CMMS
   tables (the W-8 extension class: `OWN_ROW` + `seedFixtures` + the
   mismatched-tenant attack inserts — the fc-prefixed id family); (b) the transfers
   fixture needed a SECOND branch per tenant (the from ≠ to law — the
   `abababab-2000` pair, the `branches: 2` expected-rows entry with the dated
   note). The first run's log (the fixture crash, 19 passed of the isolation
   file's collect) and the second (the `branches` expected-2-vs-1 catch) were
   replaced by the green re-run — the re-run is the envelope's log; the sequence
   recorded here (the F1 discipline: the replaced runs' summaries preserved in
   this note, both exit-stamped red at capture).

## THE TOTP FIX — THE ORDERED ACCEPTANCE, ALL THREE LEGS GREEN

The owner's W-16 order: «اشتقاق حتمي currentTimestep(now)+1 … قبوله أخضر منفردًا
وفي الجزء وفي الأحادي والسجلات الحمراء محفوظة». Executed: the spec-side one-liner
(`identity-flows.db.spec.ts` — the fresh code now `currentTimestep(Date.now()) + 1`,
the mfa-policy PHASE-038 repair's exact shape, the dated comment carrying the
boundary arithmetic) — **standalone 21/21** (`db-totp-fix-standalone.log`; the exact
count the incident record named) · **in-part** (chunk-a 87 · 681 green on the first
attempt — identity-flows rides chunk-a, where the plan wave's two REDs lived) ·
**in-unit** (the totp domain spec 7/7 inside the 8/8 battery) · **the red logs
preserved** (the plan wave's two chunk-a RED attempts stand in
`audit-evidence/phase049-plan/` — the archive law). **RISK-033's counter: the class
stands at EIGHT incidents; ZERO new this wave** — the eighth's fix landed under the
owner's order; the register row stays OPEN per its own law (the review closes only by
the owner's order).

## THE INTERPRETATIONS DECLARED (one line each, for the owner's review)

- **«الإعدادات بصفر محايد مصرّحة»** read as the PLAN-GRANTS starter posture: the
  0108 §2 block grants the two flags to business + enterprise with STARTER AT THE
  DECLARED NEUTRAL ZERO (the tier-4 posture verbatim; zero starter keys move) —
  the plan defines no new tenant-settings key for 049 (the sweep's thresholds are
  W-19's job registration row; the account mappings are tenant DATA).
- **«عائلة db للـCMMS تبدأ بسابقة hr»** read as the family START per the hr/projects
  precedent: `__db__/cmms/` opens with `fixtures.ts` (the lean tenant-CM world) +
  `cmms-schema.db.spec.ts` (the structural laws; every rejection arm on its own
  world) — the service specs land with their W-17/W-18 waves.
- **THE CoA TEMPLATE MARKERS (0108 §4)**: D-04's own dependency (the G-59/G-61
  purposes must resolve; new tenants materialize the template at onboarding) —
  the 0077 §6 additive pattern, declared in the migration header + the catalog +
  the matrix §3.27 note. The parts leg rides the EXISTING INVENTORY purpose; G-61
  rides the EXISTING per-branch FIXED_ASSET mapping.

**NOT production approval. The next wave — W-17, the work-order engine + plans
(T-05 + T-06 + T-07) — waits on the owner's dispatch.**
