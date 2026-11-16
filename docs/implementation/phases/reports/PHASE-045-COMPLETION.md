# PHASE-045 Completion Report — HR Core: Attendance, Leaves & Shifts

> **Status:** COMPLETE · **Date:** 2026-11-16 · **Phase doc:**
> [../PHASE-045.md](../PHASE-045.md) · **Register:** [CR-15](../../../planning/COMPLETENESS_REGISTER.md)
> · **Triple flip:** this report + the phase doc header + the IMPLEMENTATION_STATUS
> row flipped together (CR-48) · **Wave 2's third phase** — the platform that runs
> sales and stock now runs the daily workforce truth, and PHASE-046 (Payroll
> Compliance) is unblocked (this phase is its only hard prerequisite).
> **Scope discipline:** completing 045 is NOT closure of the 043 hard review and
> NOT production approval — RISK-031/RISK-032 stay OPEN per the governance record.

## 1. Executive summary

PHASE-045 closed the audit's **operational HR gap** (the HR-01…HR-04, H-05
operational, N-17, and HR-13 findings — HR scored 26%: "any company over 20
employees needs an external HR system"): the workforce now runs on **shift
templates** (grace periods, paid breaks, the night crossing) + the
**employee × date roster grid** (the rotation pattern generator — bulk 200 × 92
runs under the chunked write), **punch sessions** with the **DERIVED daily
status** (the day is the unit: HOLIDAY > ON_LEAVE > ABSENT / MISSING_PUNCH /
LATE / PRESENT with the exact minute facts, the tenant's timezone, INV-031's
non-overlap law at every capture), the **device-agnostic import** (the generic
CSV adapter covering ZKTeco-style layouts + configurable mapping, preview →
dedupe → anomaly quarantine → commit with the file's sha256 fingerprint — the
same file never commits twice), the **overtime engine** (tier matching with the
holiday-calendar integration, SQL-NUMERIC multiplier math, BR-084's
pre-approval feeding law — unapproved time is an exception, never silently
fed), and the full **leave family** (types with accrual policies and
carry-over caps, per-year balance cells, requests with the simple approval —
the full workflow engine stays PHASE-052 by the DR-045-01 decision record).
The phase also delivered the **employee ↔ user identity bridge** (HR-13, the
SoD law pinned: linking grants nothing), **jurisdiction-scoped holiday
calendars**, the **payroll variable feeds** (overtime / absence / late +
leave-balance snapshots — PHASE-046's exact inputs), the goldens **G-50/G-51**
(policy-gated, the payroll payout machinery), and the web plane: four office
boards + the **employee self-service tabs** (own attendance calendar, own
leave, own roster — the runtime-granted `hr.self_service` scope resolved from
the identity bridge, never a client-supplied id). **Migrations
0080–0088 (schema_version 88) · +12 RLS'd tables · permissions 291 → 297 ·
feature keys on business + enterprise (the four workforce manifests enabled,
0088) · report registry 101 → 104 · i18n 6,007 keys/locale · INV-031 ·
BR-082…084 · the full DB suite 239/239 files · 3,313/3,313.**

## 2. Mandatory code-evidence checklist (CR-48)

**New tables (SQL migration + Drizzle mirror + ENTITY_CATALOG row — CR-36 a):**
12 tables (the plan's 10 + the T-05 import log + quarantine), the catalog's
"HR core" §with the full row set; every table carries the house RLS triple +
the master-data grants, and the A1–A10 attack suite covers each (identity
isolation re-anchored at every landing).

| Table | Migration | Notes |
|---|---|---|
| shifts / shift_rotations | 0080 | the roster grid's ONE-row-per-cell unique; the tenant-date + tenant-employee indexes |
| attendance_records | 0081 | the (tenant, employee, date, check_in) dedupe floor; four indexes (tenant-date, tenant-employee-date, the exception partial, the import-batch partial) — the OA-06 P1–P3 budgets ride them |
| overtime_rules / overtime_entries | 0082 | the tier CHECK family; BR-084's stamps law |
| leave_types / leave_balances / leave_requests | 0083 | the (tenant, employee, type, year) cell unique; the decided-stamps law |
| holiday_calendars / holidays | 0084 | one calendar per jurisdiction (the uq), one holiday per (calendar, date) |
| employees.user_id (the HR-13 bridge — an extension column, no new row) | 0085 | the partial-UNIQUE (tenant, user) guard, proven by a direct 23505 write |
| attendance_import_batches / attendance_import_anomalies | 0087 | the sha256 fingerprint floor; the append-only log (NO_UPDATE_GRANT) + the quarantine (no DELETE — the evidence) |
| (DATA-ONLY: the seeds — permissions, feature grants, module segment) | 0086 | the per-tenant first-use default decision (no global leave row — the BR-055 discipline) |
| (DATA-ONLY: the workforce manifests) | 0088 | the deferred kickoff decision, ONE coherent change with the canonical hashes |

**Migrations & manifest:** journal idx 79/80…87/88 appended (88 entries);
`migrations.db.spec.ts` green across the full-suite runs (apply + re-apply
no-op + the RLS catalog drift probe); the numbering notes recorded at the
kickoff (the plan's ≈0082…0088 predates the journal's actual end at 0079 —
the honest slots were 0080…0086, +0087/+0088 shipped with their feature
tasks per the house convention).

**Permissions (CR-36 b):** the six 0086 keys (matrix §3.23) —
`hr.attendance`, `hr.attendance.import`, `hr.shifts`, `hr.overtime`,
`hr.leave`, `hr.self_service` — catalog 291 → 297, seed = matrix (zero
drift, the checker's list extended with 0086); every hr route §8-registered;
the T-16 report contracts reuse the module keys (the §12 convention — no new
permission).

**Feature flags (CR-36 f):** the keys on business + enterprise (0086 §2);
the four workforce-bearing stored manifests (restaurant, automotive,
food_manufacturing, healthcare) gain the hr block (0088 — the kickoff's
deferred decision landed as T-15's ONE coherent change: canonical +
stored + docs mirrors + every pinned hash moved together, the 0066 §9
procedure; all 37 golden effective-configs re-pinned).

**Sync surface (CR-36 g):** N/A-recorded in the phase doc §4 (registers and
rosters are office surfaces); the attendance kiosk on the field client is
listed as a follow-up extension, not delivered here.

**i18n:** 6,007 = 6,007 (the T-12/T-13 wave's 206 keys + the T-14
self-service 12 — AR/EN parity green at every increment).

**Docs:** JOURNAL_RULES §7 (the canonical G-50/G-51 rows + entry 16 + THE
NON-LEDGER NOTE — attendance, rosters, and overtime entries are NOT ledger
documents; the two leave goldens are the cluster's only ledger surfaces) ·
ACCOUNTING_INVARIANTS INV-031 (the Workforce-exactness section) ·
BUSINESS_RULES BR-082…084 · ENTITY_CATALOG's HR section · FEATURE_CATALOG
§28 · REPORT_CATALOG +3 (§9's PHASE-045 subsection) · NAVIGATION_MODEL
(group 11 + the four rows incl. hr.self's no-permission-key law) ·
AUTHORIZATION_MATRIX §3.23 (the SoD note) · DR-045-01 (the simple-approval
decision record) · ID_LEDGER's PHASE-045 row DELIVERED.

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Migrations apply cleanly; Drizzle + catalog parity for all 10 tables; RLS A1–A10 per new tenant table incl. the cross-employee isolation attack on attendance_records | 0080–0088 apply + re-apply no-op over the 88-entry chain (`migrations.db.spec.ts` in the full suite); the catalog's HR section complete (12 rows + the bridge note); the generated A1–A10 attacks cover every new table (`isolation/identity-isolation.db.spec.ts` — 1,572/1,572 at the T-02 landing, re-anchored at every table addition, green in the final 239/239 run); the DEDICATED cross-employee law on `attendance_records`: the self-service scope law (ONLY the own days/cells/requests — the colleague's rows invisible by construction, `self-service.spec` (b)/(c)/(e)/(f)) + the A7 parity (another employee's id and an unknown id INDISTINGUISHABLE, (h)) + the register's own A1/A2 isolation employees (never the shared H1/H2) |
| 2 | INV-031 holds: intervals never overlap (imported + manual); leave used ≤ entitlement + carried at any moment (property tests incl. mid-year joiners + carry-over boundaries); overtime non-negative within caps | `inv031.spec` 7/7 — P1 the non-overlap law ORDER-INDEPENDENT (six seeded permutations; the IMPORT path shares the law — an overlapping session quarantines at commit); P2 the balance-cap property matrix (12 generated configurations through the REAL engine, INV-031 after every approve, the +1-day typed refusal, the year-boundary rollover); P3 the overtime day-cap law over decision sequences; P4 the feed-totals tie (the feed == the report == an independent SQL enumeration) |
| 3 | Device import: ZKTeco-style fixture imports with dedupe + anomaly quarantine; the log carries the fingerprint; a re-import creates zero new records | `attendance-import.spec` 5/5 — the ZKTeco-style fixture, the analysis pipeline (preview = zero writes; every refused line quarantined with its raw evidence), the sha256 floor (the same file never commits twice), the re-import zero-new-records proof, and the review surface (REJECT or IMPORT-with-corrections riding the SAME capture laws) |
| 4 | Daily derivation exact over fixtures; exceptions surface on the register board | `attendance.spec` 5/5 — the derivation law (PRESENT within grace with the exact minute facts; LATE past grace; an open session is MISSING_PUNCH; HOLIDAY over the roster from the tenant-jurisdiction calendar; ON_LEAVE over an APPROVED span; the NIGHT crossing on +1; the ABSENT synthesis — past + rostered only); the register joins the dims; the exception board paginates; the idempotent re-derive writes nothing; `holiday.spec` 3/3 pins the calendar integration end-to-end |
| 5 | Overtime: pre-approval-required rules block unapproved entries from the feed and surface them as exceptions (BR-084); approved entries carry hours, multiplier, the linked request | `overtime.spec` 4/4 (the tier-matching law — HOLIDAY > WEEKEND (the tenant's setting, no fabricated default) > WEEKDAY; an ambiguity is a typed refusal) + BR-084 at every surface: the entry (`overtime.spec`), the feed (`feed.spec` 4/4 — a required rule's PENDING exception NEVER silently fed), and the report (the T-16 exception column); the multiplier math in SQL NUMERIC (never float) |
| 6 | Leave lifecycle: request → approve → decrement → snapshot at close; carry-over truncates with an audit line; the simple-approval decision record exists pointing to PHASE-052 | `leave.spec` 5/5 (the span law, INV-031 at the approve boundary, the BR-055 0-accrual refusal, the accrual run's idempotent recompute with joiner proration, the rollover's min(remaining, cap) with the audit line) + `feed.spec` (the period-close snapshot) + **DR-045-01** (the product decision record — engine-ready by construction, PHASE-052 consumes the lifecycle tables without data migration) |
| 7 | Goldens G-50/G-51 green with failure packs: the accrual run posts only when the tenant policy enables it; encashment settles through the payroll payout machinery without new account purposes | `leave-posting.spec` 3/3 — G-50 (the policy-gated period-end accrual: DR SALARIES_EXPENSE · CR SALARIES_PAYABLE at the monthly slice × basic/30; the BR-055 OFF default; exactly-once per type+month under INV-013 with the CC-01 replay) + G-51 (the encashment settlement: INV-031 at the encash boundary; DR SALARIES_PAYABLE · CR CASH + the payroll_payout treasury movement — no new purposes, no new kinds, no migrations); the failure packs pinned at (a)/(c) |
| 8 | Employee ↔ user bridge: uniqueness holds, the link is audited, and a test proves HR data visibility is independent of user-administration permissions (SoD documented) | `bridge.spec` 3/3 — ONE employee ↔ ONE user per tenant at any moment (both arms typed; the 0085 partial-UNIQUE floor proven by a direct 23505 write), the membership law (only an ACTIVE member), the lifecycle law (TERMINATED never linked), the audited link/unlink, **THE SoD LAW** (linking grants NOTHING: effectivePermissions identical before/after; a user-administration role holds no hr.*/payroll.employees.* key); the matrix §3.23 dated note |
| 9 | All house gates green; OA-06 budgets met; sync-surface N/A-recorded | §5 below — the full sweep + the OA-06 EXPLAIN budgets 6/6; the N/A record in the phase doc §4 |
| 10 | Completion report appended with evidence; status row flipped; the OA-07 archive | This report; the triple flip (the phase doc header + IMPLEMENTATION_STATUS + NEXT_ACTION → PHASE-046); `ERP_PLATFORM_PHASE045.zip` |

## 4. Deviations & decisions (documented)

- **Migration numbering 0080–0088, not the planned ≈0082…0088.** The plan's
  slots predate the journal's actual end at 0079 — the honest next slots were
  0080…0086 (recorded at the kickoff in the phase doc, the journal, and the
  manifest); 0087 (the import log + quarantine) and 0088 (the workforce
  manifests) shipped with their feature tasks.
- **BR-082…084, not the planned BR-081…083.** BR-081 was consumed by the
  043-completion round (the reservation hard protection) — re-coordinated
  2026-11-14 with dated notes in every post-043 phase doc.
- **The per-tenant first-use default (the seed-scope decision).** The plan's
  "default leave types" seed item maps to NO global row — `leave_types` is
  tenant-scoped and accrual stays 0.00 until the tenant configures it (the
  BR-055 no-fabricated-defaults discipline); recorded at the kickoff.
- **The workforce-manifest enablement deferred to T-15.** The DB half alone
  (the 0078 §4 shape) would desync the stored manifests from the canonical
  hash the apply service verifies — landed as ONE coherent change with the
  canonical templates + every pinned hash (the 0066 §9 procedure).
- **The simple approval is a DOCUMENTED COMPROMISE (DR-045-01).** One-step
  chains do not cover deep hierarchies; the states/stamps/audit events are
  PHASE-052's interface (no data migration at the upgrade).
- **Gate repairs the full-suite runs surfaced (recorded honestly, the 041
  D-7 precedent):** (a) T-05's registry-completeness failure (the law the
  check exists for — repaired and re-run green, both recorded); (b) the
  serial-order interplays of T-08/T-10 (the shared SA calendar + vitest's
  size-descending fresh-cache order — both specs' worlds made idempotent);
  (c) T-14's ENVELOPE LAW repair — every hr controller site (69 across the
  10 controllers) now awaits its service call INSIDE envelope(...) (the
  pre-T-14 shape made every hr error path a silent 200-empty); the same
  latent pattern in the shipped modules' unawaited sites is recorded for
  the owner's dispatch, out of this phase's scope; (d) T-17's bridge-spec
  interplay (the EMP-B* → EMP-M* rename); (e) **T-19's
  ORDER-DEPENDENT CAPTURE CLASSIFICATION** — the first full-suite run on
  the unified head failed exactly one test (the dedupe floor's typed code
  was heap-order-dependent: `listDerivationRows` carries no ORDER BY, and a
  single interleaved pass let PostgreSQL's physical row order pick
  SESSION_OVERLAP before the exact-match row was reached) — repaired as the
  pure domain law `classifyCaptureConflict` (the exact-match decision over
  the whole day BEFORE any overlap comparison, the import path's proven
  shape), pinned 5/5 in both row orders; all three runs logged in
  [audit-evidence/phase045-t19/](../../../../audit-evidence/phase045-t19/).
- **The environmental note (not code):** the T-19 gate round ran in a fresh
  sandbox — the first unit pass failed `zatca-qr-decode.spec` on the absent
  Playwright Chromium headless shell; after the browser install the spec
  passed 3/3 and the full unit gate re-ran green (api 621 → 626 with the
  new pin).

## 5. Gate evidence (the full sweep — the T-19 round, 2026-11-16)

- **typecheck:** 8/8 packages, zero errors. **lint:** 8/8. **boundaries
  (dependency-cruiser):** 1,903 modules, 14,103 dependencies — no violations
  (the 044 baseline was 1,785/13,131).
- **unit:** 8/8 packages — api **626/626** (55 files: +5 the classification
  pin) · web 77/77 · contracts 56 · ui 42 · sync-core 36 · desktop 274 ·
  mobile 393 · domain-core 38.
- **DB suite (embedded PG16, the 88-migration chain):**
  **239/239 files · 3,313/3,313 — 0 failed, 0 skipped (535.31s)** (the T-17
  baseline was 238/238 · 3,307; +6 the OA-06 budget spec; the first-run
  failure is the §4 (e) repair — three runs logged).
- **The hr spec ledger (13 files · 72 tests):** shifts-roster 7 ·
  attendance 5 · attendance-import 5 · overtime 4 · leave 5 · holiday 3 ·
  bridge 3 · feed 4 · leave-posting 3 · self-service 11 · inv031 7 ·
  oa06-budgets 6 (63 in the hr folder) + hr-reports 9 (reporting).
- **docs:validate:** 33/33. **i18n parity:** 6,007 = 6,007 (web) · 371 = 371
  (mobile). **permissions drift:** 297 = 297. **manifests:** 13/13 valid.
  **capabilities matrix:** agree. **id-ledger:** 0 errors (implemented: G 51
  · INV 31 · BR 84) + the self-test all-probes-OK. **shells:** PASS (both).
  **history-secrets:** 0 violations.
- **OA-06 EXPLAIN budgets:** **6/6** — on a dedicated tenant's
  representative corpus (10,800 attendance rows + 360 balance cells,
  ANALYZEd, `enable_seqscan=off`, the 041/044 method), pinned as the
  permanent `oa06-budgets.spec`: P1 the daily register walk
  (`ix_attendance_records_tenant_date`) · P2 the exception board (the
  PARTIAL `ix_attendance_records_tenant_exception`) · P3 the employee-day
  derivation/dedupe lookup (`ix_attendance_records_tenant_employee_date`) ·
  P4 the balance cell (`uq_leave_balances_cell`) · P5 the per-employee
  balance panel (`ix_leave_balances_tenant_employee_year`) · P6 the
  tenant-year snapshot walk (the composite's tenant prefix) — every probe
  index-driven, zero seq-scans (plans in
  [oa06-explain-plans.log](../../../../audit-evidence/phase045-t19/oa06-explain-plans.log)).
- **The evidence ledger:** [2026-11-14 start](../../../operations/gate-evidence/2026-11-14-phase045-start-substrate.md)
  · [T-03](../../../operations/gate-evidence/2026-11-15-phase045-t03.md) ·
  [joint review](../../../operations/gate-evidence/2026-11-15-joint-review-fixes.md)
  · [81f09e9](../../../operations/gate-evidence/2026-11-15-81f09e9-review-round.md)
  · [T-04](../../../operations/gate-evidence/2026-11-15-phase045-t04.md) ·
  [T-05](../../../operations/gate-evidence/2026-11-15-phase045-t05.md) ·
  [T-06](../../../operations/gate-evidence/2026-11-15-phase045-t06.md) ·
  [T-07](../../../operations/gate-evidence/2026-11-15-phase045-t07.md) ·
  [T-08](../../../operations/gate-evidence/2026-11-15-phase045-t08.md) ·
  [T-09](../../../operations/gate-evidence/2026-11-15-phase045-t09.md) ·
  [T-10](../../../operations/gate-evidence/2026-11-15-phase045-t10.md) ·
  [T-11](../../../operations/gate-evidence/2026-11-15-phase045-t11.md) ·
  [T-14](../../../operations/gate-evidence/2026-11-16-phase045-t14.md) ·
  [T-15](../../../operations/gate-evidence/2026-11-16-phase045-t15.md) ·
  [T-16](../../../operations/gate-evidence/2026-11-16-phase045-t16.md) ·
  [T-17](../../../operations/gate-evidence/2026-11-16-phase045-t17.md) ·
  [T-18](../../../operations/gate-evidence/2026-11-16-phase045-t18.md) ·
  [T-19](../../../operations/gate-evidence/2026-11-16-phase045-t19.md).

## 6. Delivery and handoff

The per-phase archive `ERP_PLATFORM_PHASE045.zip` (OA-07) accompanies this
report. With 045 delivered, **PHASE-046 (Payroll Compliance & Statutory
Deductions) is unblocked** — its only hard prerequisite is this phase. The
exact inputs shipped:

- **The variable feeds** (overtime / absence / late per pay period) and the
  **leave-balance snapshots** at period close are the statutory engine's
  variable-component lines (the 029 components untouched).
- **The `employees.user_id` bridge** enables per-employee payslip delivery
  through the existing notification channels; the SoD law keeps HR
  visibility on the hr keys, never user administration.
- **The holiday calendars** feed PIT/EOSB period boundaries; the derivation's
  six-verdict vocabulary is the absence truth the compliance engine consumes.
- **Handoff notes for PHASE-047** (HR Administration): org structure and
  positions attach to the employees table extended here; the self-service
  tabs are the substrate for the talent portal.
- **Carried watch items** (the owner's dispatch, unchanged): the shipped
  modules' unawaited controller sites (the T-14 envelope-law finding's
  sibling pattern), SF-026-001/002, the 028/029/030/037 environmental
  items, and RISK-031/RISK-032 (the 043 review — OPEN).
