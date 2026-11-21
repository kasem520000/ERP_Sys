# PHASE-049 Master Plan — CMMS — Asset Maintenance (صيانة الأصول)

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-049.md`
(T-01…T-19 are the canon task spine; this plan keeps those numbers and adds T-00).
Register: CR-19 · Wave 2 / Stage 13 · Roadmap ~3.5–4.5 weeks (the v3.2/CR-50 note).

Authority chain: PHASE-049.md → [CR-19](../docs/planning/COMPLETENESS_REGISTER.md)
→ the 044-asset-register substrate (no hard 048 prerequisite — the roadmap §5;
the 048 handoff notes reused where delivered) → the ID_LEDGER's 049 reservations
(**G-59…G-61 · INV-034 · BR-097…BR-100**, re-coordinated 2026-11-13/14) → this plan.

**Status: PROPOSED (2026-11-21, this session — per the owner's PHASE-049
dispatch: the plan is the FIRST deliverable, sent FOR REVIEW BEFORE LAUNCH, and
NO CODE WAVE opens before the owner's approval of it; the approval is a launch
authorization, NEVER production approval).** This plan's evidence envelope:
`audit-evidence/phase049-plan/` (every log same-session, the TWENTY-FOURTH
consecutive wave). **The dispatch's three amended laws are carried verbatim as
§0b (1)/(2)/(3) and red lines §6.13–§6.15; the three one-line clarifications
the dispatch demanded are answered in the delivery message and recorded §0c.**

## 0a. THE LOCAL = REMOTE VERIFICATION (the owner's new law — this session's FIRST act, before the first line)

The owner's ruling on the W-15 recovery: «البعيد مصدر الحقيقة الوحيد، وكل
موجة 049 تبدأ بالتحقق أن المحلي = البعيد قبل أول سطر» — the remote is the
single source of truth, and every 049 wave begins by verifying local = remote
before the first line. **This session executed exactly that, first:**

- **The remote verified first:** `main @ ba459ff2d26…` = the tag `phase/048`
  (annotated, the delivery head) — the W-15 closure exactly as the owner
  reconciled it; `phase/046` @ `4ddb39f` and `phase/047` @ `5b73bd1` in place,
  untouched. A FRESH CLONE was taken from the GitHub remote
  (`kasem520000/ERP_Sys`) — the clone's HEAD = the remote HEAD = `ba459ff`,
  byte-faithful.
- **The working tree then reconciled against the clone:** the sandbox had been
  reset AGAIN after the W-15 push (the environment's own snapshot history shows
  the reset — the third environment reset of the program; the PHASE-046 W-0 /
  W-15 recovery precedents apply). The tree diff found **ZERO content
  differences — and 312 missing files**: 274 evidence logs (the sandbox's
  snapshot mechanism drops `.log` files) + the `apps/web/__tests__/
  local-schema-parity.test.ts` unit file + `.env.example`, `next-env.d.ts` and
  the log-bearing evidence directories. **All 312 recovered from the remote
  clone** — after the restore, the tree diff is CLEAN (local = remote at
  `ba459ff`, excluding only `node_modules`/build artifacts). The missing web
  unit file is disclosed prominently: had the battery run on the unrestored
  tree, the web package would have counted 16 files — the owner's verified
  ledger says 17 · 147 (the total 141 · 1,803) — the recovery is what the new
  law exists for. **Honest env-prep note (the 046 W-0 precedent's shape):**
  pnpm 9.15.9 re-provisioned, the workspace install re-run, the embedded PG16
  re-fetched by the suite's own global setup, chromium headless-shell
  re-installed for the render/print specs (without it the browser-gated arms
  skip gracefully — the battery below required 0 skipped, so the shell was
  installed BEFORE the DB runs; the exact build disclosed in the evidence
  README). Only wall-clock lost.
- **THE LAW STANDING FOR EVERY 049 WAVE:** each wave's first act — before any
  edit — is the local-vs-remote verification (the fetch, the HEAD comparison,
  the clean-tree check), recorded in that wave's gate doc. A wave never opens
  on an unreconciled tree.

  **[Dated 2026-11-21 (W-19 — THE GATE-DOCUMENTATION DECISION, the owner's
  ruling on the 048-custom gap: «وثائق بوابة الموجة (عرف 048) توقفت في 049
  بصمت... اختر مصرّحًا» — option (a) ratified, the owner's stated
  preference).** 049's standing custom, codified HERE as law: **the wave's
  GATE RECORD is its evidence README** (`audit-evidence/phase049-w*/README.md`
  — the W-16…W-18 envelopes are the delivered precedent: the §0a record, the
  exit, the constants with dated deltas, the honest disclosures, the parts
  tables, the logs' declarations — every element the 048 wave-gate documents
  carried, same-session and additive-only), and **THE CENTRAL LEDGER —
  `docs/planning/PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-049 — is the
  accumulation place**: every criterion's ARMS and WAVES accumulate there
  from W-0 to the W-23 closure, giving W-23 its ONE CITABLE CUMULATIVE
  RECORD (the owner's own requirement). No retroactive gate documents for
  W-16…W-18 — their READMEs ARE their gate records (this note ratifies what
  already shipped, never rewrites it); the plan's every «wave gate doc»/
  «gate-evidence» reference reads as the evidence README from here on.

## 0b. The owner's W-15 acceptance + the THREE AMENDED LAWS (recorded 2026-11-21, binding on all 049 waves)

The owner's dispatch accepted W-15 and closed PHASE-048 at the tag `phase/048`
@ `ba459ff` **as DELIVERY, never acceptance-production** («تسليمًا لا قبولًا»),
after the owner's OWN cumulative reconciliation closed exactly: the eight-wave
table consistent, the unit ledger **1,803 = 816+147+840** (growth +129 = api
+104 + web +25; the six spaces stable since W-8), every phase diff matching the
declared. The four checks green: the core atomic by construction, the
reconciliation complete, the archive additive-only with the three tags in
place, the open items transferred explicitly. **Three amended laws enter 049
verbatim:**

1. **THE CEILING LAW (amended): السقف الفعلي = min(التوقع، حد الأمر −
   هامش).** The W-15 contradiction — a declared 680s ceiling above the
   harness's own 600s command cap — was honestly disclosed by the session and
   is now a structural law: **every timed run declares its ceiling as
   min(the evidence-based expectation, the harness command cap − a safety
   margin)** — for this program's harness (600s cap, 30s margin) that means
   **a declared ceiling never above 570s** for any single-command run, and any
   run whose expectation exceeds the cap is SPLIT (the eight-part envelope)
   BEFORE it is attempted, never after a timeout. Declared at the claim site
   before the run, every time.
2. **THE TIME-SENSITIVITY CLASS LAW (amended): the class stands at SEVEN
   incidents per the dispatch — a named open risk (خطر مسمّى مفتوح —
   §RISK-033 in the register, added with this plan), NEVER a closure
   criterion — and the isolate trio (soak · fcm · email) is declared IN THE
   PLAN from the start with pre-emptive isolation from the first DB wave.**
   This plan declares them here (§4/§5): the three isolates run standalone
   BEFORE any heavy envelope in EVERY wave that runs the DB suite, starting
   W-16. The two-head protocol with both logs kept remains the flake law at
   any appearance. **[Dated 2026-11-21 (this plan wave's own evidence
   envelope — the EIGHTH incident, a NEW VARIANT, named and recorded):**
   chunk-a's first two attempts each failed exactly ONE arm —
   `identity-flows.db.spec.ts`'s TOTP M-06/M-07 arm (`MfaRequiredError` on
   the fresh-code login): the spec computes the fresh code for
   `currentTimestep(Date.now() + 31_000)` and a generation in the LAST
   second of a 30s window resolves to the step after next (n+2), outside
   the verifier's ±1 drift — **a pure wall-clock boundary, NOT load-shaped**
   (the prior seven were async/queue races). The protocol executed: the
   spec standalone GREEN 21/21 immediately after (the green head); the
   chunk GREEN 86/86 on attempt 3; all three logs kept. The class count
   moves **seven → EIGHT** (RISK-033 records all eight); the spec-side
   one-liner forward fix (the step computed as `currentTimestep(Date.now())
   + 1`, or the clock pin — the W-8 pattern) is recorded for W-16's entry,
   the owner dispatches it at approval.**]
3. **THE ARCHIVE LAW (amended): أرشفة الأرشيف ممنوعة — the zip ALWAYS
   excludes the standing archives.** The 049 archive
   (`ERP_PLATFORM_PHASE049.zip`, OA-07) excludes every pre-existing
   `ERP_PLATFORM_PHASE*.zip` — the 048 delivery's own convention ("the content
   tree minus the fourteen standing platform zips") is now standing law,
   stated verbatim: **the zip never contains another zip**.

## 0c. The three one-line clarifications (the dispatch's demand — answered in the delivery; recorded here for the canon)

1. **«reservations 16 · 45» unpacked:** the `check:id-ledger` summary after
   the 048 flip counts the REMAINING reservation ladder — **16 phase rows**
   (PHASE-049…PHASE-064; three of them — 057/059/062 — claim no ids) covering
   **45 reserved ids in total: 21 goldens G-59…G-79 + 12 invariants
   INV-034…INV-045 + 12 business rules BR-097…BR-108**, contiguous, no
   overlap (the checker re-derives this arithmetic from the ledger's §2 —
   the coordination paragraph's own three lists).
2. **The TABLES doc's checker, and why 33/33:** the checker is
   `pnpm docs:validate` (`scripts/validate_docs.py`); the new
   `docs/database/TABLES/projects-contracting.md` is covered by the
   CORPUS-WIDE checks — check **1a** walks EVERY markdown file under `docs/`
   (`rglob("*.md")`, the new file included) and verifies every relative link
   resolves, and check **2** scans every file for out-of-range PHASE
   references — plus the structure checks its parent docs. **33/33 is the
   checker's own check count** (1a+1b+2 · 3a…3q · 4a…4i · 8a…8d = 33
   individual checks), all passing — not a document count.
3. **The five-part division after the 98-restructure, and the third
   isolate:** the W-14 five-chunk plan became the W-15 EIGHT-PART envelope —
   the five LOAD parts now carry **268 files · 3,793 tests** (smoke 3·1,783 +
   perf-rest 5·23 + chunk a 82·596 + chunk b-rest **98·772** + chunk c
   80·619) and the THREE isolates carry **3 files · 14 tests** (soak 1·1 +
   fcm 1·8 + email 1·5) — together **271 · 3,807**, the coverage proof's union
   == the disk inventory. **The 98 is chunk b AFTER shedding the email spec**
   (99 → 98): the email spec
   (`notifications-email.db.spec.ts`, 1 file · 5 tests) became **the third
   isolate** when chunk b's first attempt flaked under the 99-file load (the
   pg-boss async delivery race — disclosure 1), joining soak and fcm per the
   pre-isolation mandate.

## 0. Inputs consumed (the plan-first reads — one focused pass over the `ba459ff` head, 2026-11-21, this session)

- `docs/implementation/phases/PHASE-049.md` (spec §1–§8 — T-01…T-19, the
  v3.2/CR-50 fleet-light addition item 10) · COMPLETENESS_REGISTER CR-19 ·
  COMPLETENESS_ROADMAP §6.2/§6.5 · the gap analysis: ERP_FULL_GAP_ANALYSIS §2
  (H-15) + §9 (F-01…F-09, F-11/F-12/F-13) + GAP_ANALYSIS_LAYER3_RESIDUAL
  (R-10 fleet light — the owner's light-version-only decision, full
  fuel/violations a sectoral non-goal) · ID_LEDGER row 46 (049 = G-59…G-61 ·
  INV-034 · BR-097…100, re-coordinated 2026-11-13/14; the checker's probe (7)
  already points at G-59/PHASE-049 with claimant PHASE-050).
- The 048 delivery records: the completion report §11 handoff (the work-order
  status machine + the board patterns + THE SINGLE CLOCK SERVICE reused by
  maintenance work orders; the `project_resource_allocations` asset side as
  the cross-branch asset movement context; the 044 asset register the
  substrate), the 048 master plan (the wave/gate/red-line pattern this plan
  inherits), `agent-ctx/NEXT_ACTION.md` (the 049 intake with the standing
  constraints).
- Code research (this session, read-only): the 044 `assets` substrate
  (`schema.ts` — code/name/nameAr/category/acquisition/cost/salvage/
  openingAccumulated/usefulLife/depreciationMethod/totalEstimatedUnits/
  branchId/custodianUserId/status/sourceType/sourceId/disposedAt/
  writtenOffAt; `cost_centers` exists with its own tenant tree — the grouping
  rides it, never a new dimension), the 048 field-service substrate
  (`service_orders`/`service_order_lines` — the PENDING/RESERVED/ISSUED/
  INVOICED/VOID tombstone-line shape; `fieldservice-math.ts` — the pure
  pause-aware single-clock arithmetic; the dispatch board controller), the
  posting engine + JOURNAL_RULES G-01…G-58 (the six-column golden-row canon
  shape; the purpose-mapped fail-closed discipline; INV-013 idempotency), the
  044 WMS issue paths (the move's own value; the no-negative-stock floors),
  ACCOUNTING_INVARIANTS through INV-033, BUSINESS_RULES through BR-096, the
  reporting registry (114 contracts, the W-14 pin-site law), the jobs infra
  (pg-boss; the `hr_alert_jobs` config-row precedent), the web `[locale]`
  screens + NAV_ITEMS + ⌘K, the print-template machinery (`bi()` + the
  deterministic byte-identical law), the `__db__/fixed-assets/` family (the
  spec home the CMMS family extends), the identity/capability signing
  patterns (the unguessable-code substrate for tags).
- **Baselines — RECOUNTED THIS SESSION at `ba459ff`** (every number this
  session's own run or recount, `audit-evidence/phase049-plan/` — the
  strongest F1 position; the numbers below are the battery's VERIFIED
  results, the logs beside this plan): typecheck 8/8 (the `--force` fresh
  run) · lint 8/8 · depcruise clean **2,054 modules · 15,372 dependencies**
  (the W-15 count EXACT — zero production code) · unit 8/8 packages (api
  65·816 · web 17·147 · mobile 27·393 · desktop 16·274 · ui 3·43 ·
  contracts 2·56 · domain-core 6·38 · sync-core 5·36 = **141 files · 1,803
  tests — the owner's verified ledger EXACT: 1,803 = 816+147+840**) · **THE
  FULL DB SUITE 271/271 files · 3,807/3,807 tests · 0 failed · 0 skipped —
  THE EIGHT-PART ENVELOPE** (the three isolates standalone FIRST per §0b
  (2) — soak 228.34s, fcm, email — then the five load parts: smoke 3·1,783
  + perf-rest 5·23 + a 86·651 + b-rest 86·625 + c 88·711; the coverage
  verified BEFORE the first run — the union == the disk inventory 271/271,
  the comm diff empty; the parts' sum 640.61s across EIGHT PG boots; **the
  single-process one-command run was NOT attempted — its full-command
  expectation ≈ 615s exceeds the amended 570s effective ceiling, so it was
  SPLIT BEFORE ATTEMPTED (the §0b (1) law's own prescription)**; the
  TOTP-boundary incident's two RED attempts kept and disclosed — §0b (2)) · the standalone scratch `check:rls` **318/0** (the
  104-chain from zero) · drift **326 = 326** · i18n **6,620 = 6,620** +
  mobile **371 = 371** + tokens **130/130 + 50/50** · manifests **13/13** ·
  docs:validate **33/33** · id-ledger **0 errors + self-test all-probes-OK**
  (implemented G 58 · INV 33 · BR 96; reservations 16 phases · 45 ids) ·
  history-secrets **0** (the THREE tag anchors verified untouched:
  `phase/046` @ `4ddb39f` · `phase/047` @ `5b73bd1` · `phase/048` @
  `ba459ff`) · capabilities **agree** · shells **PASS/PASS** · the boundary
  negative **PASS** · ROUTE_PERMISSIONS **1,052** · the report registry
  **114** · the migration journal **0104** (idx 103 — this session's own
  recount of `meta/_journal.json`: 104 entries, last tag
  `0104_projects_contracting_stamps`) · ENTITY_CATALOG **318**.

## 1. Settled design decisions (from the plan-first reads — binding for all waves, amendable only by the owner's dated dispatch)

**D-01 — The 044 asset register is the substrate, EXTENDED never replaced
(the frozen-substrate law).** The `assets` table keeps its shape and every
existing column/index; the CMMS world lands AROUND it (eight new tables, §2)
plus ONE column family on `assets` itself (0108): `warranty_expiry` ·
`insurance_expiry` · `license_expiry` · `inspection_expiry` (the R-10
fleet-light fourth, nullable — used where a tenant tracks inspections) +
`cost_center_id` (the grouping FK — riding the EXISTING `cost_centers` tree,
never a new dimension) + `parent_asset_id` (the component link — components
carry their own meters and spares and roll up into the parent's service
history; a parent is never its own ancestor, the cycle guard at write time —
the 047 org-tree precedent). **Disposed/written-off assets open no work
order, plan or transfer** (the status guard at every authoring path — the
typed refusal). The depreciation engine is UNTOUCHED (the 044 runs continue
per period regardless of transfers — D-06's NBV move is the branch
dimension, never the asset's own carrying value).

**D-02 — Migration slots pinned honestly: 0105–0108** (the journal ends at
`0104`, idx 103 — this session's recount; the phase doc's "0083…0086" are
stale blueprint slots, its own note defers to the journal at implementation
time — the 047 D-03/048 D-02 precedent). Shapes in §2. **The honest table
count: +8** (`maintenance_work_orders` · `maintenance_plans` ·
`maintenance_plan_tasks` · `asset_meters` · `asset_meter_readings` ·
`asset_spares` · `asset_transfers` · `asset_tags`) — the phase doc §4's own
"+8"; **check:rls/ENTITY_CATALOG 318 → 326** (if implementation lands a
ninth table — e.g. a work-order cost-lines table instead of columns — the
dated note records the +9 and the catalog delta; nothing silent).

**D-03 — The work-order status machine (the phase doc's own ladder).**
`REQUESTED → PLANNED → IN_PROGRESS → ON_HOLD → COMPLETED` — forward-only
with the ON_HOLD pause states (IN_PROGRESS ↔ ON_HOLD both ways — the pause
law, never a regression past IN_PROGRESS); the machine is a guarded CAS per
transition (the 048 D-12 field-service shape; the single-clock reuse below).
**The completion gate (BR-098): completion is BLOCKED while any checklist
step is open OR any cost line is unposted/unpriced** — the typed refusal
carries the open count and the offending lines (never a silent partial).
Cost collectors on the order: **labor** (technician hours — employees are HR
reads, the 048 payroll read-only law extended: 049 never writes an HR table;
the cost rate snapshotted at line creation, the `crm_time_entries.unitRate`
precedent; an unset rate = UNPRICED, a typed completion refusal — never a
fabricated rate) · **parts** (lines drawn from the asset's spares BOM, §D-05)
· **external** (service bills — the partner-side accrual leg).

**D-04 — G-59 (the PROPOSED canon wording — the six-column shape, D-18
style; binding wording settles at the W-23 canon carry):** *Source
`maintenance_work_order`, operation `complete` (INV-013 idempotent — the
replay is the typed refusal; the single-use `completed_at` stamp written only
after the posting succeeded, the same ambient transaction, the all-or-nothing
rollback — the G-58 pattern): at completion, through the REAL engine — **DR
the purpose-mapped `MAINTENANCE_EXPENSE` (the labor + parts + external
total)** · **CR the purpose-mapped INVENTORY account for the parts at the
issue's own value** (this leg carries the G-60 discipline — §D-05) · **CR the
purpose-mapped `LABOR_CLEARING` for the labor** (the snapshotted rates; the
payroll tables READ-ONLY) · **CR the purpose-mapped `EXTERNAL_ACCRUAL` for
the external services** (the supplier bill's own posting supersedes the
accrual leg when it lands — the 038 pattern; a tenant preferring direct AC
records the presentation decision at implementation, the G-55
decision-record precedent) — **the asset's `cost` and every depreciation
column UNTOUCHED** (maintenance is an expense, never a capitalization — the
capitalizable-improvement flow is OUT OF SCOPE by the phase doc's own
decision); worked: labor 1,200 + parts 800 + external 500 → DR 6410 2,500 ·
CR 1310 800 · CR 6110 1,200 · CR 2140 500, the INV-034 reconciliation green
by construction.*

**D-05 — G-60 + the spares discipline (BR-099):** the parts leg of the
completion act IS the inventory issue: the stock decrements through the REAL
WMS issue path (the 044 discipline — the move's own value, the tombstone
lines) **in the same ambient transaction as the G-59 entry**; the
no-negative-stock floor is checked at LINE CREATION (the refusal names the
shortfall and the warehouse — never a silent backorder inside a work order)
and re-asserted at the issue itself. The `asset_spares` BOM rows reference
the item master (FK — the phase doc's own drift mitigation; discontinued
items refuse at BOM save). **One completion act, two golden numbers, no
double-count** — G-59's DR carries the total, G-60's law governs the parts
credit leg (the G-55/G-57 fused-entry presentation precedent; the decision
record carried to the canon at W-23). The golden transcript at W-22 proves
the fused shape end-to-end; **if implementation lands the two-entry shape
instead (G-60 as its own journal at the issue, G-59 then covering labor +
external only), the dated note records the presentation decision and INV-034
holds EITHER WAY — the invariant is the reconciliation, never the entry
count.**

**D-06 — G-61 + the transfer law (BR-100):** `asset_transfers`
(from/to branch, reason, the DRAFT→SUBMITTED→APPROVED/REJECTED ladder with
the verdict stamps — the 048 change-order gate shape). *Source
`asset_transfer`, operation `approve` (INV-013 idempotent, the single-use
stamp, the all-or-nothing rollback): on approval, in ONE transaction — the
asset's `branch_id` flips to the destination · **the NBV reclassification:
DR the destination branch's mapped asset account · CR the source branch's
mapped asset account** (the NBV at the transfer date = cost − accumulated
depreciation; the branch↔account mapping resolved fail-closed
`PURPOSE_NOT_MAPPED` until the tenant maps the pair — the 038/0077
discipline, the mapping check BEFORE the flip with the clear error surface,
the phase doc's own mitigation) — **posted exactly once (BR-100; the replay
is the typed refusal)**; worked: NBV 42,500 → DR 1521 42,500 · CR 1511
42,500, the asset row's cost/accumulated columns untouched (the branch
dimension carries the move; the depreciation engine continues unimpeded).*
The transfer history feeds the service-history timeline (D-10).

**D-07 — The meters model:** `asset_meters` (type
HOURS/KM/PRODUCTION/CUSTOM, unit, the last-reading snapshot) +
`asset_meter_readings` (value, effective date, source MANUAL/JOB/IMPORT —
JOB readings arrive from completed work orders, the technician's entry; the
odometer designation for R-10 is the KM-type meter bound in the meter row).
**The monotonic law: a reading below the meter's current snapshot is refused
(the typed error carrying both values)** — the phase doc's own mitigation;
effective-date semantics order the log (a back-dated-but-higher reading is
LEGAL and inserts at its date position; the snapshot recomputes to the max);
the usage views derive from the log, never a stored sum (the BR-089
zero-residue spirit). **The METER trigger evaluation is EVENT-DRIVEN in the
reading's own transaction** (the plan evaluation runs on insert — D-08).

**D-08 — The plans model (BR-097 + BR-098):** `maintenance_plans` — trigger
CALENDAR (interval days) or METER (a meter FK + a delta threshold);
`maintenance_plan_tasks` — the checklist steps carried onto generated orders
with per-step results. **Evaluation:** CALENDAR — due when today ≥
`next_due` (recomputed from the last generation, never wall-clock drift);
METER — due when `reading.value − last_generation_anchor ≥ threshold` (the
anchor is the generation's own reading stamp). **BR-097: at most ONE open
order per asset per trigger window** — the typed refusal + the structural
guard (the partial unique on open generated orders per (asset, plan)); a
generated order enters at PLANNED with the checklist copied. **Back-dated
readings cannot double-trigger: the anchor is the GENERATION's stamp, so a
back-dated reading evaluates against its own position — a window already
generated never re-arms** (the phase doc's acceptance #5 arm, unit-tested
first). The plan-evaluation arithmetic is a PURE layer, unit-first (§4).

**D-09 — The tags:** `asset_tags` (the asset FK, the code, created/printed
stamps). **Unguessable signed codes** (the platform's existing HMAC signing
capability — 256-bit entropy, the capability-token precedent), unique per
tenant; **the scan surface resolves the code to the asset card through the
standard auth + RLS stack** (a foreign tenant's scan is a typed 404 — never
a cross-tenant oracle; an unsigned/forged code refuses at the signature,
never at a lookup). The print sheet: AR/EN both directions, RTL-correct,
**`bi()` exclusively + deterministic byte-identical across runs** (the W-13
print law verbatim); one sheet per tag batch, the QR itself rendering the
signed code.

**D-10 — The expiry sweep + the fleet-light register (R-10):** the daily
`asset-expiry-sweep` pg-boss job fires **30/7/0-day alerts for warranty,
insurance, license — and inspection where a tenant tracks it (the R-10
class)** — deduplicated (the notification key per asset+class+window+day —
the 047 escalation-dedupe pattern; one notification per asset per class per
day, the 30/7/0 windows each their own class instance). The fleet-light
register view (R-10, the owner's CR-50 light-only decision): vehicle-class
assets grouped with their document status (the four expiry chips) + the
odometer binding (the KM meter) — **a VIEW over the substrate, zero new
tables; full fuel/violations management stays the recorded sectoral
non-goal.**

**D-11 — The web plane:** three screens + two extensions —
`/assets/maintenance` (the orders board + the plans admin + the checklist
entry; the 048 board patterns verbatim — the data-slot shape immune to the
045 Tabs defect), `/assets/meters`, `/assets/transfers`, the QR scan route
(resolves to the asset card), and the extended asset card (the
service-history timeline — work orders, readings, transfers in one
chronology; the expiry chips; the components via the parent link; the
cost-center grouping). The 12-template discipline; ⌘K registration (OA-04);
NAV_ITEMS registry rows; **the feature flags `assets.maintenance` +
`assets.transfer`** (the D-16 composable-units law — business + enterprise;
automotive-workshop, rental-logistics, healthcare and food-manufacturing
compose them by default). **i18n: ~+220 AR/EN pairs (the phase doc's own
estimate), BY BOTH COUNTS from the first surface wave** (§0b's framework
item — each web wave declares its delta AND the mobile count; §5).

**D-12 — The reports:** +4 contracts — `assets.maintenance-costs` ·
`assets.maintenance-backlog` (overdue plans and orders) ·
`assets.meter-readings` · `assets.expiry-register` — **registry 114 → 118**,
every pin site re-pinned together (the W-14 pin-site law), zero new
permissions beyond the +10 (the reports ride them).

**D-13 — RLS:** the A1–A10 attack matrix over all EIGHT new tables (the
generated suite + the dedicated FK-chained hostile worlds — the 048 W-14
pattern; the composite-FK law proven offensively: a hostile tenant's probe
through every FK path that reaches a CMMS table).

**D-14 — OA-06 budgets:** the readings insert path, the board queries, the
service-history timeline aggregate, the backlog report — index-driven, the
plans logged verbatim, never forced (the W-9 assertion law).

**D-15 — The offline sync assessment (OA-02):** meter readings and
work-order completion are flagged as FUTURE offline candidates for
technicians (the phase doc's own note); **N/A-recorded for this phase** (no
synced entity added).

## 2. Migration inventory (the honest slots — journal ends at `0104`, idx 103; the fingerprint declared by design)

| Slot | File | Contents |
|---|---|---|
| 0105 | `0105_cmms_work_orders.sql` | `maintenance_work_orders` (the status machine + the cost totals + the completion stamp) + `maintenance_plans` (the trigger columns) + `maintenance_plan_tasks` (the checklist) |
| 0106 | `0106_cmms_meters_spares.sql` | `asset_meters` (+ the odometer designation) + `asset_meter_readings` + `asset_spares` (the BOM) + `asset_tags` (the signed codes) |
| 0107 | `0107_cmms_transfers.sql` | `asset_transfers` (from/to branch, reason, the approval ladder + the verdict stamps) |
| 0108 | `0108_cmms_asset_extensions.sql` | THE ALTER on `assets`: `warranty_expiry` · `insurance_expiry` · `license_expiry` · `inspection_expiry` · `cost_center_id` · `parent_asset_id` + THE DATA-ONLY grants block (the 0098/0103 pattern) |

**[Dated 2026-11-21 (W-19 — THE HONEST SLOTS' AMENDMENT, the D-02 disclosure
law's own prescription): 0111 `0111_cmms_sweep_settings.sql` + 0112
`0112_cmms_notifications_category_repair.sql` — the sweep settings page +
the notifications category widening + the union repair.]** The W-19 wave
(T-11/T-12) lands the owner-ordered provisions: 0111 §1 the notifications
category widening ('assets' joins BOTH CHECK domains — the 0023/0056/0099
pattern) + §2 THE DATA PAGE (the 0098 pattern): the sweep threshold key
`assets.expiry.manage` (the drift 336 → 337, dated) over THE FIRST 049
SETTINGS KEYS (`assets.expiry_sweep_thresholds` — the typed registry key,
the documented fail-closed default [30,7/0]); **0112 — THE UNION REPAIR
(the 0110 precedent's exact shape, the wave's own schema arm's catch):
0043 §12 widened both category domains with 'payroll' and 0051's DROP+ADD
silently rebuilt both lists without it (the G-48 class, a latent drift —
nothing ever wrote the category); the slot restores the complete
SEVENTEEN-member union.** **THE FINAL EXPECTED FINGERPRINT (announced in
the wave's own envelope, the new law's FIRST APPLICATION — AMENDED by the
0112 catch, the F1 dated correction at this original site): the chain 112
· ENTITY_CATALOG 328 (zero table delta) · the drift 337 ·
ROUTE_PERMISSIONS 1,093 + 9 = 1,102.** (0109/0110 — the W-17 provision +
the source-shape repair — are recorded in the phase doc §4's dated
amendment; the slots-pinned-honestly law stands.)

All four: tenant_id prefix + RLS policies (the A1–A10 law), Drizzle mirrors,
`tables.registry.ts` +8 (318 → 326), ENTITY_CATALOG rows (318 → 326),
journal/manifest/spec pins to 108 with the chain re-proven from zero at
W-16 and at every full sweep. **THE MIGRATION FINGERPRINT (declared by
design — the owner's framework item): the chain 104 → 108; the catalog 318
→ 326; the drift 326 → 336 (+10 keys); ROUTE_PERMISSIONS 1,052 → 1,052+n
(the keys bind as W-17…W-21 ship, every change dated at the block — the
keys-seed-first discipline); the report registry 114 → 118 (W-22); i18n
6,620 → 6,620+~220 (declared per surface wave) + mobile 371 standing.**

## 3. Task waves (the canon T-01…T-19; the wave numbering — §7 (a))

### W-0 — The owner's approval wave (T-00, orchestrator) — THIS WAVE
The plan delivered for review with the same-session baseline envelope at
`ba459ff` (§0; the evidence `audit-evidence/phase049-plan/`); the
acceptance-criteria ledger OPENED with this plan
(`PHASE_ACCEPTANCE_CRITERIA.md` §PHASE-049 — the owner's framework law: the
ledger opens with the plan and closes with the closure); RISK-033 added to
the register (§0b (2) — the named open risk). **The implementation waves
are BLOCKED until the owner's approval dispatch** (the dispatch's own
boundary: الإطلاق بإذن بعد موافقة الخطة — وليست موافقة إنتاج).
**Exit:** the plan APPROVED with amendments (recorded as §1a on the 046/047/
048 pattern); the approval head baselined if it moved.

### W-16 — The foundation (T-01 + T-02 + T-03 + T-04, orchestrator)
Migrations 0105–0108 + every mirror/registry/catalog/matrix/pin in ONE
increment (D-02's shapes; **+10 keys 326 → 336** —
`assets.maintenance.view/manage/plan`, `assets.meters.view/record`,
`assets.spares.manage`, `assets.transfer.view/approve`,
`assets.tags.manage`, `assets.expiry.view` — zero-drift from the first
increment; the flags + the four template manifests — D-11/D-16;
ROUTE_PERMISSIONS stays 1,052 keys-seed-first with the dated note). **The
pre-isolation mandate begins HERE: the three isolates (soak · fcm · email)
run standalone before the wave's DB envelope** (§0b (2)).
**Exit:** acceptance #1 green (migrations + catalog 318 → 326 + zero-drift
336 = 336); the chain re-proven from zero; the full DB suite at the new
count (271 + the new spec files).

### W-17 — The work-order engine + plans (T-05 + T-06 + T-07, orchestrator)
The PURE layer first (the plan-evaluation arithmetic — calendar due dates,
meter thresholds, the single-open window, the anchor semantics — unit-first,
the 047/048 law); the work-order API (the status machine D-03, the cost
collectors, the completion gate BR-098); **G-59's posting** (D-04); the
plans API (BR-097's single-open + the checklist carry-over, D-08).
**Exit:** acceptance #2's arms + #3's G-59 arm + #5's calendar side green
with evidence.

### W-18 — Meters + spares + transfers (T-08 + T-09 + T-10, orchestrator)
The meters API (the monotonic law, the snapshot, the usage views — D-07; the
METER trigger evaluation completing #5); the spares BOM + the parts lines +
**G-60/BR-099** (D-05); the transfers approval + **G-61/BR-100** (D-06).
**Exit:** acceptance #5's meter side + #6 + #3's G-60/G-61 arms green.

### W-19 — Tags + the sweep + fleet light (T-11 + T-12, orchestrator)
The signed codes + the scan resolution route + the print-sheet API side
(D-09); the `asset-expiry-sweep` job (30/7/0, the dedupe, the inspection
class — D-10); the fleet-light register bindings (R-10 — the view + the
odometer designation).
**Exit:** acceptance #7's API arms + #8 green (the job log + the
notification records).

### W-20 — The web plane I (T-13, orchestrator)
`/assets/maintenance` — the orders board + the plans admin + the checklist
entry (D-11; the 048 board patterns). **i18n BY BOTH COUNTS from this wave**
(the first surface wave — the declared delta + mobile 371 standing, §5).
**Exit:** the board renders the engines' figures VERBATIM; the flag-gating
verified; the declared i18n delta green.

### W-21 — The web plane II + the print pack (T-14 + T-15, orchestrator)
`/assets/meters` + `/assets/transfers` + the QR scan surface + the extended
asset card (the timeline, the chips, the components, the grouping) + **the
tag print sheet** (`bi()` exclusively, deterministic — the W-13 law).
**Exit:** acceptance #7's surface arms closed; the card's timeline
reconciles with the log.

### W-22 — Reports + proof (T-16 + T-17, orchestrator)
The four report contracts (registry 114 → 118, all pins together — D-12);
**the golden transcripts G-59…G-61 with the MANDATORY failure packs** (the
typed refusals WITH their full payloads, the zero residue, the
flip-and-restore with the green re-run — the 048 W-14 pattern) + **the
INV-034 golden** (the poisoned world's typed refusal carrying the per-leg
breakdown) + **the RLS A1–A10** (D-13) + **the OA-06 budgets** (D-14).
**Exit:** acceptance #3/#4 closed whole + #9's arms closed — #1…#9 ALL
GREEN.

### W-23 — Docs + gates + closure (T-18 + T-19, orchestrator)
The canon docs (JOURNAL_RULES G-59…G-61 in the binding wordings + INV-034 +
BUSINESS_RULES BR-097…BR-100 in the register's six-column shape +
NAVIGATION_MODEL §1.x + the §9 LIVE row + FEATURE_CATALOG + **the
fixed-assets TABLES doc extended** (`docs/database/TABLES/fixed-assets.md`)
+ the PHASE_ACCEPTANCE_CRITERIA §PHASE-049 ledger CLOSED) + **THE ID_LEDGER
FLIP** (atomic with the canon rows — implemented G 61 · INV 34 · BR 100;
the checker's self-test probe (7) moves to G-62/PHASE-050, claimant
PHASE-051 — the 048 precedent's shape) + **the full sweep at the final
head** (both envelopes; the amended ceiling law §6.13; the three isolates
first) + the completion report (the cumulative ledger walked and closed +
the battery scope map + the FULL unit-package table + the open-items log
transferred) + the triple flip + **the archive `ERP_PLATFORM_PHASE049.zip`
(OA-07 — EXCLUDING every standing platform zip, §0b (3) verbatim; members
byte-verified)** + **the tag `phase/049`** (the §1a (c) pattern — DELIVERY,
never acceptance).
**Exit:** acceptance #10 green; the phase closed at the delivery head.

## 4. Test matrix (the permanent suites; the pre-isolation mandate from W-16)

- **Unit (pure, first):** the plan-evaluation arithmetic (calendar due
  dates, meter thresholds, the single-open window, the back-dated anchor
  semantics — D-08); the tag code signing/uniqueness folds (D-09); the
  sweep window arithmetic (the 30/7/0 classes, the dedupe keys — D-10); the
  INV-034 reconciliation fold (the per-leg typed breakdown); the NBV
  reclassification arithmetic (D-06); the monotonic/effective-date
  validation folds (D-07).
- **DB specs (the `__db__/cmms/` family, beside `fixed-assets/` — the
  hr/projects precedent):** `cmms-workorders.db.spec` (the machine's legal
  ladder + the illegal transitions refused by name + the completion gates —
  the open-step and unpriced-line refusals + the cost collectors) ·
  `cmms-plans.db.spec` (the calendar walk, the meter threshold, the
  single-open refusal, the back-dated no-double-trigger) ·
  `cmms-meters.db.spec` (the monotonic refusal, the effective-date order,
  the snapshot reconciliation, the JOB-source readings) ·
  `cmms-spares.db.spec` (the BOM FK law, the availability floor BR-099, the
  parts leg at completion) · `cmms-transfers.db.spec` (the approval ladder,
  G-61's exactly-once, the NBV move, the unmapped-purpose refusal) ·
  `cmms-tags.db.spec` (the code entropy/uniqueness, the signature
  verification, the scan resolution + the foreign-tenant 404) ·
  `cmms-expiry-sweep.db.spec` (the three windows + the inspection class,
  the dedupe) · `cmms-goldens.db.spec` (G-59…G-61 with the failure packs +
  INV-034's poisoned world) · `cmms-rls.db.spec` (A1–A10 × the eight
  tables, the hostile worlds) · `cmms-explain-budgets.db.spec` (OA-06) ·
  the migration chain spec extended to 108.
- **Web:** the three families' render + parity + flag-gating specs; the
  scan surface; the asset-card extension; **the tag print spec (AR/EN +
  RTL + deterministic byte-identical — the REAL Chromium test, both
  directions)**.
- **THE PRE-ISOLATION MANDATE (from W-16, every DB wave):** the three
  time-sensitive isolates — `performance/soak-shaped.db.spec.ts` ·
  `notifications/fcm-channel.spec.ts` · `notifications-email.db.spec.ts` —
  run STANDALONE FIRST, before any heavy envelope (§0b (2); the W-15
  restructure made standing). The full-suite envelope: the eight-part plan
  (the five load parts + the three isolates) with the coverage verified
  BEFORE the first run (the union == the disk inventory, the comm diff
  empty) + the single-process run inside the amended ceiling.

## 5. Gate list (the exit bar — same as 043–048, no relaxations — PLUS the amended laws)

typecheck 8/8 · lint 8/8 · depcruise clean (the fresh count re-baselined at
W-0; the environmental-delta disclosure law) · unit 8/8 packages (the FULL
unit-package table in every closure report) · **the full DB suite green at
the new count — the three isolates standalone FIRST, the coverage verified
before the first run, the single-process run INSIDE THE AMENDED CEILING
min(expectation, 600 − 30 = 570s), the declaration at the claim site before
the run (§6.13)** · docs:validate green (the new canon rows; 33/33 or the
extended count declared) · **i18n parity BY BOTH COUNTS from the first
surface wave (W-20): every web wave declares its delta (6,620+n = 6,620+n)
AND the mobile count (371 = 371)** · permissions drift **326 → 336 = 336 at
every wave** · manifests 13/13 · id-ledger 0 errors + self-test OK (the
flip at W-23: implemented G 61 · INV 34 · BR 100) · history-secrets 0 (the
THREE tag anchors verified untouched) · `check:rls` clean at **326** · OA-06
budgets green · the standing checks (boundary-negative, shells,
capabilities) per the 048 gate table · **every evidence log through the
guarded wrapper (the vitest summary guard — judge by the SUMMARY LINES,
never the raw exit code, the NF-12 verdict rule)** · the exact commit count
declared at every delivery · same-session evidence only · **the
local-vs-remote verification as every wave's first act (§0a)**.

## 6. Governance red lines (carried, unchanged — plus the three amended laws)

1. One phase per run; the phase doc is the contract; out-of-scope is
   prohibition (the fleet-light R-10 boundary verbatim: full
   fuel/violations management is a sectoral NON-GOAL).
2. Doc precedence (ARCHITECTURE_BASELINE + ADRs + CD-01…12); discrepancies
   recorded, never silently rewritten.
3. Never weaken: tenant isolation (RLS), the posting-engine monopoly,
   INV-001…033 (…034 at delivery), auditability — every G-59…G-61 posting
   rides the engine with registered source keys under INV-013 idempotency.
4. No binary floating point for money (ADR-0009) — the cost collectors,
   the NBV, the sweep figures, the reports.
5. No fabricated compliance content (BR-055 family): the labor rates come
   from the payroll/HR data READ-ONLY (an unset rate = UNPRICED, never a
   fabricated rate); the branch↔account mappings are tenant DATA
   (fail-closed until mapped).
6. **The F1 literal-truth law:** every record claim — counts, paths,
   attributions — verified against the artifact before it is written; dated
   corrections at the original claim site when found.
7. **The same-session evidence rule** (twenty-three consecutive waves and
   counting) + the scope-label law (claim only the affected surface; the
   full DB suite re-runs on migration/schema changes — W-16 and W-23 run
   it; the mid waves run their folders).
8. **The OA-06 assertion law (the W-9 ruling):** probes assert the stable
   index-driven law, accept the planner's legitimate paths, log the
   observed plan verbatim — never force a plan, never isolate the context.
9. The evidence-log capture convention (NF-3/NF-4, structurally through
   `scripts/capture-evidence.sh` with the W-6 vitest summary guard; the
   NF-12 verdict rule — the summary lines, never the raw exit code).
10. **THE CONSTANTS LAW:** migrations integrate from 0105 — no renumbering,
    no touching any published migration; the routes ledger's every change
    carries a dated note (the 1,052 baseline anchor); ENTITY_CATALOG
    appends (318 now, +8 at W-16); **no evidence archiving or deletion —
    the full envelope at every delivery**; **ALL TAGS immutable**
    (`phase/046` @ `4ddb39f` · `phase/047` @ `5b73bd1` · `phase/048` @
    `ba459ff` — دائم لا يُمسّ); the evidence archive ADDITIVE-ONLY (new
    files only, no moving, no deleting, no renaming of any existing
    evidence directory).
11. **THE DELIVERY LAW:** every delivery declares its commit count
    precisely; evidence from the same session only; the owner's
    independent verification runs on fresh clones.
12. **THE REGRESSION PROTOCOL LAW:** a regression test that does not go RED
    on the pre-fix code is not accepted no matter how green after — with
    the four-quarter logs and the F1 dated comments at every modified
    site.
13. **THE AMENDED CEILING LAW (the owner's 2026-11-21 dispatch, §0b (1)):
    السقف الفعلي = min(التوقع، حد الأمر − هامش)** — never again a declared
    ceiling above the harness cap; runs whose expectation exceeds the cap
    are split BEFORE they are attempted; the declaration at the claim site
    before every timed run.
14. **THE TIME-SENSITIVITY CLASS LAW (§0b (2)):** the class NUMBERED OPEN
    at seven incidents — RISK-033 in the register, a named open risk,
    never a closure criterion; **the isolate trio (soak · fcm · email)
    declared in the plan from the start, isolated standalone BEFORE any
    heavy envelope from the first DB wave (W-16)**; the two-head protocol
    with both logs kept at every appearance.
15. **THE AMENDED ARCHIVE LAW (§0b (3)): أرشفة الأرشيف ممنوعة — the zip
    ALWAYS excludes the standing archives** — every pre-existing
    `ERP_PLATFORM_PHASE*.zip` stays out of `ERP_PLATFORM_PHASE049.zip`;
    the members byte-verified; the standing zips verified untouched.

## 7. Open inputs for the owner (ruled at the approval dispatch — the plan is BLOCKED until then)

- **(a) THE WAVE NUMBERING.** The dispatch says «العوازل الزمنية من W-1» —
  read by this plan as "from the FIRST implementation wave" (the parallel
  phrasing «i18n بالعددين من أول موجة سطح» = the first surface wave). The
  standing no-collision law (the §1a (b) precedent: the global sequence,
  no renumbering) puts 049's waves at **W-16…W-23** (W-1…W-7 exist in
  047's delivered records; W-8…W-15 in 048's). This plan proposes
  **W-16…W-23**; the owner confirms or overrides to a phase-relative
  restart at approval — either way the LAWS bind from the first
  implementation wave whatever its number.
- **(b) THE RISK-033 REGISTER ENTRY (proposed with this plan).** The
  time-sensitivity class recorded as a named open risk at seven incidents
  (the dispatch's own framing «خطر مسمّى مفتوح») — the row added to
  `RISK_REGISTER.md` with this plan wave; the owner confirms or amends the
  wording at approval.
- **(c) THE G-59/G-60 PRESENTATION DECISION (D-05).** The fused-entry
  shape is proposed (one completion act, two golden numbers, INV-034
  either way); the owner may rule the two-entry shape at approval — the
  golden transcripts prove whichever is ruled.
- **(d) THE STANDING CARRIED ITEMS (never restated, never folded —
  transferred explicitly per the dispatch's list):** the 043 hard review
  OPEN · RISK-031/032 OPEN (the register's own records) · §7(b)'s three
  PHASE-045 final-audit remarks + PHASE-047's §7(b) remarks (the owner's
  open inputs) · the register's exactly-two narrowed items (SANED 15,000 +
  EOSB M/51 Art. 84) · the 045 self-board Tabs defect (the owner
  dispatches; the 048/049 boards are immune — the data-slot shape) · the
  time-sensitivity class at seven (RISK-033 here) · **NOT production
  approval — the approval dispatch is a launch authorization only.**

**The implementation waves are BLOCKED until the owner's approval dispatch**
(the dispatch's own boundary: الإطلاق بإذني بعد موافقة الخطة، وليست موافقة
إنتاج). PHASE-048 stands COMPLETE at `ba459ff` (W-8…W-15 delivered and the
owner's cumulative reconciliation closed exactly); PHASE-049's plan is this
document, its evidence envelope beside it, its acceptance ledger OPENED.
