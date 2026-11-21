# PHASE-049 W-18 evidence — 2026-11-21 (this session, the fresh clone at `adb5644` — §0a verified)

Every log below was generated THIS session (the same-session evidence rule, the
TWENTY-SEVENTH consecutive wave) in `/home/z/my-project/ERP_Sys` (a FRESH CLONE at the
owner-authorized W-17 head `adb5644` — **§0a THE SESSION'S FIRST ACT: the remote verified
(`main` @ `adb5644` = the W-17 delivery head; the three tags in place, untouched:
`phase/046` @ `4ddb39f` · `phase/047` @ `5b73bd1` · `phase/048` @ `ba459ff`) → the clone →
the working tree CLEAN — المحلي = البعيد قبل أول سطر**). Every timed log ran through
`scripts/capture-evidence.sh` (the W-6 vitest-summary-guarded wrapper; the NF-12 verdict
rule everywhere). The four quarters of every test session are preserved verbatim (NF-7).

**THE EXIT, STATED EXPLICITLY: W-18's exit is T-08+T-09+T-10** — the meters API (R-10's
write path + the monotonic readings + THE EVENT-DRIVEN EVALUATION), the spares BOM (the
discontinued-item floor + the exclusively-real-WMS consumption declaration), and the
transfers ladder (the XOR/CAS verdicts + **THE G-61 GOLDEN** with the seals after the
operation in the same transaction) — GREEN WITH EVIDENCE (the cmms family now **6 files ·
72 tests** over real PG16). Acceptance #3's G-60/G-61 arms stand delivered; the golden
TRANSCRIPTS with the mandatory failure packs close at W-22 per the plan's own wave map —
موجة الأسطح تُسلّم ولا تُغلق. NOT production approval. The stepwise pushes (the owner's
own order) landed six checkpoints: `fa24490` (the fingerprint amendment + the movement
note) → `578ed77` (the pure layer's NBV fold) → `7bef8f2` (the services + the routes) →
`24366ab` (the specs + the union arm) → the evidence steps → this head.

## The constants declared after the wave (the owner's framework item 4 — the dated deltas)

- **The migration journal: 110 — UNCHANGED** (no new migration this wave: the meters/
  spares/transfers tables landed at W-16's 0106/0107; the services are the plane over
  them). THE FINGERPRINT per the amended plan document (step 1, the owner's ratification):
  **the chain 110 · ENTITY_CATALOG 328** — and per the new D-02 disclosure law, THIS wave
  plants NO D-02 expectation in any migration, so the fingerprint it reports is final:
  **110 · 328 through W-23 unless a dated provision lands.**
- **ENTITY_CATALOG: 328 table rows — UNCHANGED** (both from-zero scratch runs say
  `[check-rls] OK — 328 catalog tables`; the registry 303 tenant-owned tables stands).
- **The permissions drift: 336 = 336** (unchanged — no new keys; the ten 0108 keys bind
  the 16 new route rows).
- **ROUTE_PERMISSIONS: 1,093 = 1,077 + 16 — THE DATED DELTA** (the tsx recount this
  session): the `/api/v1/assets/meters*` family (6 rows — the reads on
  `assets.meters.view`; THE READINGS, the event surface, on `assets.meters.record`; the
  meter AUTHORING + R-10's odometer designation on `assets.maintenance.manage` — the
  DECLARED INTERPRETATION, the matrix §3.27 W-18 dated note) · the `/api/v1/assets/spares*`
  family (4 rows on `assets.spares.manage`) · the `/api/v1/assets/transfers*` family (6
  rows with THE SoD SPLIT: the reads on `assets.transfer.view`; the authoring + submission
  on `assets.maintenance.manage` — the CREATOR's key; the verdicts — the G-61 gate — on
  `assets.transfer.approve` — the APPROVER's key). **41 rows on the assets.* keys**
  (25 + 16).
- **i18n: 6,620 = 6,620 + mobile 371 = 371 — NO DELTA, exactly as declared** (the API-only
  wave; the first surface wave is W-20).
- **The report registry: 114 — unchanged** (the registry recount; the +4 contracts are
  W-22's).
- **depcruise: 2,075 modules · 15,539 dependencies** (the W-17 baseline 2,066 · 15,455
  +9 modules · +84 dependencies — the W-18 files: the three services, the three
  controllers, the three DB specs; the environmental-delta disclosure law).
- **The unit battery: 8/8 packages — 141 files · 1,826 tests** (api 66·839 = the W-17
  66·835 + the pure spec's four NBV arms · web 16·147 · mobile 27·393 · desktop 16·274 ·
  ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36) — the ledger arithmetic
  1,826 = 839+147+840 EXACT (840 = 393+274+43+56+38+36).
- **The full DB suite: 277 files · 3,939 tests · 0 failed · 0 skipped** (the W-17
  274 · 3,921 + the cmms family's +3 spec files · +17 tests + the schema spec's +1 union
  arm) — the EIGHT-PART ENVELOPE below.
- **id-ledger: 0 errors + self-test all-probes-OK** (implemented G 58 · INV 33 · BR 96;
  reservations 16 phases · 45 ids — the 049 flip is W-23's).

## THE EIGHT-PART ENVELOPE (the W-15 restructure carried; every duration observed, every
part inside the amended ceiling min(expectation, 600 − 30 = 570s) — the declaration at
the claim site)

| Part | Files · tests | Duration | Log |
|---|---|---|---|
| isolate-soak (STANDALONE FIRST — §0b (2)) | 1 · 1 | 228.8s | `db-isolate-soak.log` |
| isolate-fcm (STANDALONE FIRST) | 1 · 8 | 17.5s | `db-isolate-fcm.log` |
| isolate-email (STANDALONE FIRST) | 1 · 5 | 13.6s | `db-isolate-email.log` |
| chunk-smoke (the isolation family + the migration spec — the 110-chain boot from zero) | 3 · 1,843 | 19.6s | `db-chunk-smoke.log` |
| chunk-perf-rest | 5 · 23 | 89.6s | `db-chunk-perf-rest.log` |
| chunk-a (the cmms family rides here) | 92 · 723 | 151.9s | `db-chunk-a.log` |
| chunk-b-rest | 86 · 625 | 65.4s | `db-chunk-b-rest.log` |
| chunk-c | 88 · 711 | 75.8s | `db-chunk-c.log` |

**The coverage verified BEFORE the first load run** (`parts.json` +
`coverage-inventory.txt` / `coverage-union.txt` / `coverage-proof.txt`): the disk
inventory == the parts union — **277 = 277, missing NONE, extra NONE, duplicates NONE**.
**THE ONE REASSEMBLY MOVEMENT DECLARED** (the new law, step 1's own standing rule): the
cmms family's +3 specs (cmms-transfers · cmms-meters · cmms-spares) join chunk-a beside
the family's standing files — net chunk-a +3 files · +18 tests (89·705 → 92·723); no other
part changed.

## THE FIVE-PART TABLE AT adb5644 (the owner's requested table — the exact figures)

| Part (load) | Files · tests at `adb5644` |
|---|---|
| chunk-smoke | 3 · 1,843 |
| chunk-perf-rest | 5 · 23 |
| chunk-a | 89 · 705 |
| chunk-b-rest | 86 · 625 |
| chunk-c | 88 · 711 |

(+ the three isolates 1·1 · 1·8 · 1·5 → the W-17 totals 274 · 3,921 ✓ — the arithmetic
3,921 = 1,843+23+705+625+711+14 EXACT.)

**THE CLOSING-FORMULA CORRECTION (the owner's «تصديق أو تصحيح»)**: the proposed
`a 89·717 · b 94·765 · c 80·619` is CORRECTED to the actual `a 89·705 · b-rest 86·625 ·
c 88·711`. Three corrections, each named: (1) the +12 in the proposed a is the A-suite's
+12 arms over the two 0109 tables — they ride **chunk-smoke** (1,843 = 1,831 + 12 — the
migrations spec's A-suite lives in the smoke part), never a; (2) the proposed b 94·765
models only a 4·7 movement out of b — the actual b-rest at adb5644 is 86·625 (the plan
wave's re-partition netted −12·−147 out of b, see the movement note below); (3) the
proposed c 80·619 (W-15's count, unchanged) — the actual c is 88·711 (the re-partition
netted +8·+92 in). The verified five-part sum at adb5644: **271 load files · 3,907 load
tests + smoke 1,843 + perf 23 + isolates 14 = 274 · 3,921** — the ledger closes EXACT.

**THE PARTS-LEDGER MOVEMENT (the informational gap, closed in step 1)**: the owner's
arithmetic — «a=87·681 المعلن عند W-16 يُلزم بانتقال 4 ملفات·7 اختبارات على الأقل من b
أو c إلى a خلال W-16» — found a REAL gap, corrected to the exact figures (the dated note
now standing in the W-16 evidence README + the law planted in the plan document): the
movement happened at **THE PLAN WAVE** (`20b56d3`, the same 2026-11-21 — `parts.json`
introduced, the three load chunks re-partitioned by domain family): **162 of the 260 load
files moved between the parts (gross)** — `a→b 26 · a→c 34 · b→a 26 · b→c 25 · c→a 38 ·
c→b 13` (verified: the W-15 logs' per-file rosters vs the plan wave's `parts.json`; the
coverage union identical 271 = 271) — net **a +4·+55 · b-rest −12·−147 · c +8·+92**, the
total unchanged 271·3,807. **W-16 itself moved NOTHING** (a 87·681 = the plan wave's
86·651 + the declared cmms spec 1·30 EXACT). The owner's «على الأقل 4 ملفات·7 اختبارات»
lower bound is corrected to the exact **+4 files · +55 tests net into a**. Standing law
from W-18: every re-partition declares its movement — file list, net and gross — in its
own wave's report.

## THE OWNER'S EIGHT W-18 ITEMS, ONE BY ONE

1. **كتابة R-10 بالإسناد الواحد ودلتا المرساة ورفض مُنمّط ولا تسليح للنوافذ المولَّدة** —
   delivered: R-10's write path made typed at BOTH surfaces (ODOMETER_NOT_KM — the
   KM-only law; ODOMETER_ALREADY_DESIGNATED carrying the standing one — الإسناد الواحد,
   the one-per-asset law; at authoring AND at the designation patch, with the honest
   flow — undesignate then designate the other KM meter); دلتا المرساة — the reading's
   evaluation reads the anchor DELTA through the pure folds (meterDue over the plan's
   anchor); ولا تسليح — **a reading NEVER arms a generated window**: the anchor moves
   ONLY at the generation act (proven on the plan row: after the generation's 15,200
   stamp, two later readings — one not-due, one due-but-window-open — moved nothing);
   the named skips (PLAN_NOT_DUE · PLAN_WINDOW_OPEN) surface in the reading's own
   report, never truncated, never exceptions.
2. **G-61 بـXOR وسلالم CAS والأختام بعد نجاح العملية في المعاملة نفسها** — delivered:
   the verdict XOR is the floor (0107's stamp law) and every illegal move refuses BY
   NAME (TRANSFER_STATE_ERROR with both ends); one guarded CAS per move (the
   submission, the approval's single-consumption seal, the rejection); **THE SEALS
   (approved_at/approved_by + the journal link) land in ONE guarded UPDATE AFTER the
   G-61 posting and the branch flip succeeded — the same ambient transaction** (the
   0105 completion-stamp precedent; the golden proves the order and the atomicity).
3. **القطع عبر WMS الحقيقي حصرًا والمقاصة ذرّية** — delivered as the declared reading +
   the exclusivity proof: the BOM never issues stock (its whole lifecycle touches
   NEITHER item_stock NOR stock_moves — the spares spec's footprint arm); the
   consumption surface is the work-order PARTS lines through the W-17 completion act's
   REAL WMS path (planIssue/applyIssue sourced `maintenance_work_order`), whose ATOMIC
   CLEARING (together-or-nothing, zero residue, the retry completes) the W-17
   all-nothing arm already proved — the exclusivity is now pinned on both sides.
4. **الثوابت المعدلة** — declared above: the journal **110** (unchanged — no dated
   delta, no D-02 provision planted this wave; the amended fingerprint 110 · 328 final
   through W-23 unless dated) · the catalog **328** · the drift **336** · the routes
   **1,093 = 1,077 + 16 dated** · i18n **no delta as declared** (6,620 = 6,620 · 371 =
   371) · the reports **114**.
5. **ملاحظة تعديل البصمة في وثيقة الخطة** — delivered in the wave's FIRST commit
   (`fa24490`): the dated amendment note in PHASE-049.md §4 — the chain 110 · the
   catalog 328 (was 0108·326), the deviation accepted by mechanism per the owner's
   ratification — **plus THE TWO LAWS**: the D-02 disclosure law (a wave that plants a
   provision reports the final expected fingerprint in its own envelope) and the
   shared-scope UNION law (a shared-domain constraint recomputes from the union of
   every member every migration ever defined).
6. **ذراع نطاق stock_moves في مواصفة المخطط** — delivered (the schema spec's 31st arm):
   parses EVERY migration for the constraint's definitions (the ten sites enumerated
   by name: 0014 · 0016 · 0018 · 0025 · 0026 · 0027 · 0073 · 0077 · 0109 · 0110),
   unions every member ever defined, and asserts the LIVE constraint equals that union
   — **the 23 members enumerated explicitly** (the owner's «تعدّ أعضاء نطاق stock_moves
   صراحة»); a future partial DROP+ADD goes RED naming the missing member.
7. **العوازل أولًا والسقف والتغطية قبل التشغيل وجدول الأجزاء بالأعداد — استرجاعًا
   قائمًا** — delivered: the three isolates standalone FIRST (soak 228.8s · fcm 17.5s ·
   email 13.6s); the ceiling 570s = min(expectation, 600−30) with every observed
   duration inside it (the table above); the coverage verified BEFORE the first load
   run (277 = 277, missing NONE, extra NONE, duplicates NONE); the parts table with
   the counts in this report — and the W-16/W-17 envelopes stand covered by the same
   law retroactively (the movement note in the W-16 README, step 1).
8. **الاسترجاعات كاملة وجدول الوحدات وأرقام المعايير وعدّاد RISK-033 والملفات مسمّاة
   والوسوم كاملة وقوانين الجلسة مع §0a** — the standing recalls carried below; the
   unit table above (8/8 — 141 · 1,826); the standards numbers: typecheck 8/8 · lint
   8/8 · depcruise 2,075·15,539 · drift 336=336 · i18n 6,620=6,620 + 371=371 ·
   manifests 13/13 · docs:validate 33/33 · id-ledger 0 errors + self-test OK ·
   history-secrets 0 violations (6,432 allowlisted fixture hits across the same 12
   documented paths) · capabilities agree · shells PASS/PASS · boundary-negative PASS
   · the identity-flows checklist 3/3 (every new route resolves on the owner template)
   · the readonly sweep 6/6 (**all 1,093 routes live in the real Nest pipeline** — the
   new families exercised through the typed read-only 403s); **RISK-033: EIGHT
   incidents, ZERO new this wave** (every run green on its first attempt — the only
   re-runs were the env-prep class below, a deterministic skip, never a red); every
   file named in the tables; the six tag identifiers complete (below); §0a at the top.

## THE FIVE CLARIFICATIONS (سطرًا لكل — one line each)

1. **اسما جدولي 0109 ومعنى +9/+10 وتاريخ ملاحظة 0105**: the two tables are
   `maintenance_cost_lines` (the three cost collectors — **the +9**) and
   `maintenance_work_order_steps` (the carried checklist with per-step results — **the
   +10**); the +9/+10 are 0105's own TWO recorded provisions — the +9 named verbatim in
   the 0105 header («the cost LINES are W-17's collectors: if that wave lands a
   cost-lines table instead of columns, the dated note records the +9 per D-02's own
   provision — nothing silent») and the +10 its sibling («the results land with W-17's
   generation API» — the carry-over law's storage); both landed in slot 0109 (the
   next slot after W-16's 0108, exactly as provisioned); **the note's date:
   2026-11-21, the W-16 delivery commit `9e34ddc`** (18:02:24 UTC) — the proof line
   below.
2. **تسمية أذرع A-suite الـ12**: the A-suite (the generated attack suite A1–A10,
   `identity-isolation.db.spec.ts`) runs SIX arms per registered table — the two 0109
   tables' twelve: **A1** SELECT without GUC → 0 tenant rows · **A2** foreign GUC never
   exposes this tenant's rows · **A3** INSERT with mismatched tenant_id → 42501 ·
   **A4/A7** UPDATE and id-probe under own GUC touch 0 foreign rows · **A5** DELETE of
   the other tenant's row denied or 0 rows · **A8/A9/A10** aggregates, joins, and
   union/CTE shapes stay confined — once for `maintenance_cost_lines` (fed by the
   fc8c8c8c fixture rows) and once for `maintenance_work_order_steps` (the fc9c9c9c
   rows), each against the mismatched-tenant attack rows (FK-consistent, RLS-refused).
3. **الجدول أعلاه** — the five-part table at adb5644 (smoke 3·1,843 · perf-rest 5·23 ·
   a 89·705 · b-rest 86·625 · c 88·711) with the closing-formula correction and the
   movement note, both above.
4. **فك (76/53→79/56)** — unpacked (the third and final time, with the law standing —
   compressed symbols forbidden, every number unpacked at first occurrence): the
   tenant's instantiated chart of accounts at onboarding moved from **76 account rows
   to 79 account rows** and from **53 purpose mappings to 56 purpose mappings** — the
   three 0108 §4 markers (the accounts 5310 · 2138 · 2137; the purposes
   MAINTENANCE_EXPENSE · LABOR_CLEARING · EXTERNAL_ACCRUAL). The pin sites:
   `tenancy-http.db.spec.ts` (accounts.created 79 · purposes.created 56) and
   `tenancy-provisioning.db.spec.ts` (the first provision 79/56 · the idempotent
   re-run existing 79/56 · the counts row {accounts: 79, purposes: 56, roles: 8}).
5. **الوسوم الستة كاملة**: the repo carries **THREE annotated tags — six identifiers**
   (each tag's object SHA + its dereferenced commit SHA), all verified untouched at
   §0a: `phase/046` (tag object `88568da` → commit `4ddb39f`) · `phase/047` (tag object
   `90fd428` → commit `5b73bd1`) · `phase/048` (tag object `d46fa87` → commit
   `ba459ff`). No other refs exist (one head: `main`).

## THE 0105-NOTE PROOF LINE (للسجل — the owner's request)

`git show 9e34ddc:apps/api/migrations/0105_cmms_work_orders.sql` — the W-16 delivery
commit itself — carries the note verbatim at lines 33–36 of the file:
`the cost LINES are W-17's collectors: if that wave lands a cost-lines table instead of
columns, the dated note records the +9 per D-02's own provision — nothing silent` —
**the note was IN the W-16 commit before W-17 wrote its first line** (committed
2026-11-21 18:02:24 UTC, `9e34ddc`, «PHASE-049 W-16 — THE FOUNDATION»).

## THE W-18 INTERPRETATIONS DECLARED (one line each, for the owner's review)

- **THE JOB-LINK COMPLETION READING**: «JOB readings arrive from completed work orders
  (the technician's entry)» reads as the completion-time entry — a JOB reading's
  linked order must be COMPLETED (the typed refusal carries the order's state); a
  mid-job reading is the MANUAL source.
- **THE METER'S ZERO START**: the meter enters at position zero (the usage truth lives
  in the log — the snapshot never claims a position the log does not carry; a meter
  installed mid-life takes its first reading at its current position).
- **THE ZERO-NBV TRANSFER**: a fully-depreciated asset transfers with NO journal entry
  (NBV 0 — the engine writes only positive amounts; the 0107 journal gate's
  «journal_entry_id IS NULL OR status = 'APPROVED'» clause is exactly this path's
  floor) — the branch flips, the seals land, the golden's zero-NBV arm proves it.
- **THE PER-BRANCH FIXED_ASSET MAPPING**: G-61 resolves each branch's asset account
  through the EXISTING purpose-mapping mechanism with the derived key
  `FIXED_ASSET_{BRANCH_CODE}` (the branch code normalized to the purpose-key shape) —
  0108's «G-61 rides the EXISTING per-branch FIXED_ASSET mapping — no new marker»
  made concrete: the tenant maps each branch that participates in transfers;
  unmapped fails closed BY NAME (PURPOSE_NOT_MAPPED carrying the branch + the expected
  key), the check BEFORE the flip.
- **THE METER-AUTHORING KEY**: the meters family's authoring (the register + R-10's
  odometer designation) rides `assets.maintenance.manage` — the meters keys are
  view/record only (the matrix's own set), and the designation is a
  maintenance-management act (the matrix §3.27 W-18 dated note).
- **THE TRANSFERS SoD SPLIT**: the authoring + submission ride the CREATOR's key
  (`assets.maintenance.manage`), the verdicts — approve AND reject — ride the
  APPROVER's key (`assets.transfer.approve`); creator ≠ approver at the key plane AND
  at the service's SoD backstop (the disposal/treasury pattern; a system-created row
  never trips).
- **THE EVENT-DRIVEN PROPAGATION READING**: a raced window-open during the reading's
  evaluation walk PROPAGATES (the whole reading rolls back and retries — the
  aborted-transaction law forbids catch-and-continue inside the reading's own
  transaction; the W-17 plans-spec honest catch #2's own lesson); on the retry the
  fold skips BY NAME. The pre-checked path (the standing open order) never races —
  the skip is the report's named row.

## The logs (32 physical files — every one declared)

| Log | What it proves | Stamp |
|---|---|---|
| `check-rls-scratch-110-run1.log` / `run2.log` | **THE 110-CHAIN FROM ZERO — BOTH RUNS** (السلسلة من الصفر مرتين): initdb a scratch embedded PG16 → the 110-chain applies → `[check-rls] OK — 328 catalog tables` → clean shutdown | EXIT=0 |
| `scratch-rls-proof.ts` | The scratch proof's source (the W-17 shape ported, the 110 label; committed so every log's four quarters reproduce) | source |
| `db-isolate-soak.log` · `db-isolate-fcm.log` · `db-isolate-email.log` | **THE PRE-ISOLATION MANDATE** (standalone FIRST, before any heavy envelope): 1·1 · 1·8 · 1·5 | VITEST_EXIT=0 |
| `parts.json` + `coverage-*` | The eight-part plan + **the coverage verified BEFORE the first load run** — 277 = 277, missing NONE, extra NONE, duplicates NONE; the one reassembly movement declared | static |
| `db-chunk-smoke.log` | smoke **3 · 1,843** (the migrations spec on the 110 chain — the A-suite + the manifest↔journal↔files pins) | VITEST_EXIT=0 |
| `db-chunk-perf-rest.log` | perf-rest **5 · 23** | VITEST_EXIT=0 |
| `db-chunk-a.log` | **chunk-a 92 · 723** (89·705 + the cmms family's +3 · +18) — the transfers golden, the meters event, the spares exclusivity, the union arm all ride here | VITEST_EXIT=0 |
| `db-chunk-b-rest.log` | chunk-b-rest **86 · 625 · 0 skipped** (the re-run after the env prep — disclosure 1) | VITEST_EXIT=0 |
| `db-chunk-c.log` | chunk-c **88 · 711 · 0 skipped** (the re-run after the env prep — disclosure 1) | VITEST_EXIT=0 |
| `typecheck.log` / `lint.log` | typecheck **8/8** · lint **8/8** (re-swept at the final head) | EXIT=0 |
| `depcruise.log` | no violations — **2,075 modules · 15,539 dependencies** (+9/+84 dated) | EXIT=0 |
| `unit-workspace.log` | unit **8/8 — 141 files · 1,826 tests** (the full table above) | EXIT=0 |
| `i18n-parity.log` / `mobile-i18n.log` / `mobile-tokens.log` | ar=6,620 = en=6,620 (no delta, as declared) · mobile 371 = 371 · canonical ⊆ mobile | EXIT=0 |
| `permissions-drift.log` | **336 = 336** (no new keys; the ten bind the 16 new route rows) | EXIT=0 |
| `manifests.log` | 13/13 valid | EXIT=0 |
| `docs-validate.log` | **33/33 checks** (the plan document's amendment note + the matrix §3.27 W-18 dated note covered by the corpus-wide checks) | EXIT=0 |
| `id-ledger.log` / `id-ledger-self-test.log` | 0 errors + the self-test all-probes-OK (the flip is W-23's) | EXIT=0 |
| `history-secrets.log` | **0 violations** · 6,432 allowlisted fixture hits across the same **12** documented paths | EXIT=0 |
| `capabilities.log` | capabilities matrix and fixture agree | EXIT=0 |
| `desktop-shell.log` / `mobile-shell.log` | PASS / PASS | EXIT=0 |
| `boundary-negative.log` | the negative boundary meta-test PASS | EXIT=0 |

Static recounts this session (verified against the artifacts, F1): the journal **110**
(the manifest ↔ journal ↔ files spec green in smoke) · ENTITY_CATALOG **328** (both
110-chain scratch runs) · the registry **303** tenant-owned tables · ROUTE_PERMISSIONS
**1,093** (the tsx recount; 41 on the assets.* keys) · the report registry **114** (the
registry recount — zero change).

## THE HONEST DISCLOSURES

1. **THE ENV PREP (the W-16 disclosure-2 / W-17 disclosure-3 class)**: the fresh
   sandbox initially carried only the 1200 headless-shell; the first chunk-b-rest run
   showed 3 skipped and the first chunk-c run 2 skipped (the browser-gated print
   arms: `projects-print-render` 3 · `reporting/render` 2 — deterministic skips, never
   reds). `pnpm exec playwright install chromium-headless-shell` (1248) installed; the
   re-runs **625 · 0 skipped** and **711 · 0 skipped** — the re-runs are the envelope's
   logs; the first runs' summaries (622 passed | 3 skipped and 709 passed | 2 skipped,
   both exit 0) recorded here per the replaced-run law (the four quarters of the
   replaced runs preserved in this note).
2. **THE ROUTE-COUNT CHECKER SCRIPT NAMES**: the first capture sweep of the standing
   checkers used wrong script spellings (254-class failures — `check:i18n-parity` is a
   colon-script; `validate:manifests` not `validate-manifests`); one wrong spelling was
   SILENT-green — `pnpm docs` (the docs-URL echo, exit 0) stood in the docs-validate
   log until the content check caught it (the log must carry the PASS lines, never a
   URL echo); the re-runs with the correct names are the envelope's set of logs
   (docs-validate re-captured: **33 PASS lines, 0 FAIL**). Recorded here for the
   four-quarters honesty (the failed invocations never ran the checkers themselves).

## THE STANDING RECALLS (الاسترجاعات — carried, none closed)

The register's standing items stand untouched: the 043 hard review OPEN · RISK-031/032
OPEN · the §7(b) remarks · the register's exactly-two narrowed items (SANED 15,000 +
EOSB M/51 Art. 84) · the 045 self-board Tabs defect (the owner dispatches; the 049
boards are immune — the data-slot shape) · RISK-033 at EIGHT (the row stays OPEN —
closes only by the owner's order).

**NOT production approval. The next wave — W-19 (the tags + the expiry sweep:
T-11+T-12) — waits on the owner's dispatch.**
