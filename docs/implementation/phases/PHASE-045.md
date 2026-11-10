# PHASE-045 — HR Core — Attendance, Leaves & Shifts

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 2 / Stage 13 · **Register:** [CR-15](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-05 · §10 HR-01…HR-04, HR-13 · §17 N-17 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §2 «الفجوة 2: الموارد البشرية»

## 1. Phase Overview

- **Phase ID:** PHASE-045
- **Title:** HR Core — Attendance, Leaves & Shifts (الموارد البشرية الأساسية)
- **Objective:** Close the **operational half** of the audit's HR gap: shifts with
  grace periods and breaks plus rotation rosters (employee × date), attendance
  records with manual / import / device sources and exception derivation, a
  **device-agnostic attendance-device import** (generic CSV adapter,
  ZKTeco-style layouts — no vendor SDK, no lock-in) with dedupe and anomaly checks,
  overtime rules with multiplier tiers and pre-approval, and the full leave family —
  types with accrual policies and carry-over caps, per-year balances, and requests
  with a simple approval chain (the full workflow engine stays PHASE-052 by
  decision). The phase also delivers the **employee ↔ user identity bridge**
  (HR-13) with segregation-of-duties care, jurisdiction-scoped public holiday
  calendars, and computed overtime/absence feeds that PHASE-046's payroll compliance
  engine will consume as variable lines.
- **Business value:** The audit scored HR 26% — "any company over 20 employees needs
  an external HR system, which means the ERP is not integrated by definition." With
  this phase, the same platform that runs sales and stock also runs the daily
  workforce truth: who worked, who was late, who is on leave, who is owed overtime —
  captured from the biometric devices companies already own (via generic import),
  reconciled into balances, and fed into payroll. Self-service tabs remove the HR
  clerk from routine queries.
- **الملخص التنفيذي (AR):** نواة الموارد البشرية التشغيلية: ورديات بفترات سماح
  واستراحات وجداول دورية لكل موظف/يوم، وسجل حضور وانصراف بمصادر يدوية أو مستوردة
  من أجهزة البصمة عبر محوّل عام متوافق مع صيغ ZKTeco دون ارتهان لمورّد، مع إزالة
  التكرار وفحص الشواذ، وقواعد عمل إضافي بطبقات معامل وموافقة مسبقة، وأنواع إجازات
  بسياسات استحقاق وترحيل وسقوف وأرصدة سنوية وطلبات بموافقة بسيطة (محرك سير العمل
  الكامل مؤجَّل للمرحلة 052)، مع ربط الموظف بالمستخدم وتقويمات عطل رسمية لكل
  ولاية قضائية — وكل ذلك يغذّي مكونات الرواتب المتغيرة في المرحلة 046.

## 2. Scope

In scope:

1. **Shifts** (`shifts`) (HR-04): start/end times, grace period, breaks, night flag,
   bilingual name; shift templates reusable across rosters.
2. **Rosters / rotations** (`shift_rotations`) (HR-04): employee × date roster grid;
   rotation patterns (weekly cycles) generating rosters in bulk; roster vs attendance
   cross-derivation.
3. **Attendance records** (`attendance_records`) (HR-01, H-05 operational part):
   check-in / check-out, source MANUAL / IMPORT / DEVICE, `device_ref`, optional
   geo coordinates, derived daily status (present / late / absent / missing punch /
   holiday / on-leave) from roster + holiday + leave data.
4. **Device import** (N-17): a generic CSV adapter covering ZKTeco-style layouts
   (user id, timestamp, direction, device id) plus a configurable column mapping —
   device-agnostic by design; import preview with **dedupe** (same employee +
   timestamp) and **anomaly checks** (out-of-range times, unknown employees,
   duplicate punches) quarantined for review; committed imports are logged with
   their source file fingerprint.
5. **Overtime rules and entries** (`overtime_rules`, `overtime_entries`) (HR-03):
   multiplier tiers (e.g., weekday / weekend / holiday), pre-approval-required flag
   per rule; approved entries carry hours, multiplier, and the linked approval
   request; unapproved worked time surfaces as an exception — never silently fed.
6. **Leave types, balances, requests** (`leave_types`, `leave_balances`,
   `leave_requests`) (HR-02): accrual policy (monthly grant, prorated joiners),
   carry-over cap, paid flag; balances per year (entitlement, used,
   `carried_forward`); requests with a simple approve / reject chain — the full
   multi-step workflow engine is explicitly deferred to PHASE-052 (decision record).
7. **Holiday calendars** (`holiday_calendars`, `holidays`) (HR-01/HR-04 support):
   per-jurisdiction public holiday calendars (bilingual names) feeding absence
   derivation, leave charge rules, and overtime tier selection.
8. **Employee ↔ user identity bridge** (`employees.user_id`) (HR-13): unique link
   with audit trail; employees without a user remain valid (field workforce);
   segregation-of-duties care — HR data visibility is governed by HR permissions,
   not by user administration (documented in the authorization matrix).
9. **Payroll variable feeds** (toward PHASE-046): computed overtime / absence /
   late feeds per pay period exported as variable-component inputs, plus leave
   balance snapshots at period close — consumed by the PHASE-046 statutory engine;
   the existing payroll components from the 029 baseline stay untouched.
10. **Screens** (12-template discipline, AR/EN parity, RTL, ⌘K registration):
    `/hr/attendance` (daily register + exception board + import wizard),
    `/hr/leave` (requests + balances), `/hr/shifts` (roster editor grid), and
    employee self-service tabs (own attendance calendar, leave request + balance,
    own roster).

Out of scope: statutory payroll / GOSI / PIT / EOSB computation (PHASE-046) ·
performance cycles, recruitment, training, org structure, documents (PHASE-047) ·
the multi-step workflow engine (PHASE-052) · direct biometric device APIs / SDKs
(generic file import only — device-agnostic) · expense claims and loans (already
shipped).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | NOT_STARTED — hard prerequisite |
| PHASE-034 (Enterprise-Depth consolidation) baseline | delivered 2026-11-09 |
| Employees + payroll substrate (029 baseline: `employees`, salary structure, components, runs) | delivered in the 034 baseline |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

Per the [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) dependency
graph, PHASE-035 is the only hard edge into this phase; it may run in parallel with
the manufacturing / WMS thread (042/044). PHASE-046 (Payroll Compliance) hard-depends
on this phase's feeds and the `employees.user_id` bridge.

## 4. Design Impact

- **Migrations**: the sequence continues from PHASE-044's last journal entry (≈ 0081;
  exact numbers taken at implementation time — planned ≈ 0082…0088): `shifts` +
  `shift_rotations` · `attendance_records` · `overtime_rules` + `overtime_entries` ·
  `leave_types` + `leave_balances` + `leave_requests` · `holiday_calendars` +
  `holidays` · `employees.user_id` extension · seed migration (permissions, feature
  grants, default leave types, import column maps — DATA-ONLY). Drizzle
  `_journal.json` + `migrations.ts/spec` updated per house convention.
- **Entities/catalog parity**: +10 tables (`shifts`, `shift_rotations`,
  `attendance_records`, `overtime_rules`, `overtime_entries`, `leave_types`,
  `leave_balances`, `leave_requests`, `holiday_calendars`, `holidays`) — each with
  SQL + Drizzle mirror + `ENTITY_CATALOG.md` row (CR-36 (a)); `employees.user_id`
  is an extension column with a uniqueness guard.
- **Permissions**: +6 keys (`hr.attendance`, `hr.attendance.import`, `hr.shifts`,
  `hr.overtime`, `hr.leave`, `hr.self_service`); zero-drift check extended to the
  new baseline — seeded set equal on both sides (CR-36 (b)).
- **i18n**: ~200 new AR/EN dictionary keys (registers, exception boards, import
  wizard, roster grid, self-service tabs); parity check extended.
- **Reports**: +3 contracts into `REPORT_CATALOG.md` (`hr.attendance-register`,
  `hr.leave-balances`, `hr.overtime-summary`); catalog ↔ registry reconciliation
  check extended.
- **Posting canon**: goldens G-51 (period-end leave accrual run — policy-gated) and
  G-52 (leave encashment settlement through the payroll payout machinery) added to
  `JOURNAL_RULES.md` §7 with a note that attendance, rosters, and overtime entries
  are **not ledger documents**. Invariant INV-030 (attendance / leave exactness)
  added to `ACCOUNTING_INVARIANTS.md`; BR-068…BR-070 added to
  `BUSINESS_RULES.md`.
- **Feature flags**: `hr.attendance.*`, `hr.leave.*`, `hr.shifts.*` —
  template-composable grants (CR-36 (f)); enabled by default on templates whose
  industries carry workforces.
- **Custom fields**: attendance records, leave requests, and overtime entries
  registered as custom-field surfaces in the PHASE-036 entity registry.
- **Sync surface (CR-36 (g))**: N/A-recorded by default (registers and rosters are
  office surfaces); an attendance kiosk on the field client is listed as a follow-up
  extension, not delivered here.
- **Docs touched**: `JOURNAL_RULES.md` · `ACCOUNTING_INVARIANTS.md` ·
  `BUSINESS_RULES.md` · `ENTITY_CATALOG.md` · `FEATURE_CATALOG.md` ·
  `REPORT_CATALOG.md` · `NAVIGATION_MODEL.md` · `AUTHORIZATION_MATRIX.md`
  (employee↔user SoD note) · `IMPLEMENTATION_STATUS.md` · `NEXT_ACTION.md`.
- **No new ADR** — the simple-approval decision is recorded as a decision record
  referencing PHASE-052 as the upgrade path; CR-36 gates apply.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations ≈ 0082…0088 (shifts, rotations, attendance, overtime family, leave family, holidays, `employees.user_id`, seeds) + journal/spec updates | api |
| T-02 | Drizzle mirrors, `ENTITY_CATALOG.md` rows, RLS policies + attack tests A1–A10 for the ten new tables | api |
| T-03 | Shift service + roster grid backend + rotation pattern generator (employee × date) | api |
| T-04 | Attendance service: record capture, daily status derivation (roster + holidays + leave), exception computation, immutability window (BR-068) | api |
| T-05 | Device import: generic CSV adapter (ZKTeco-style layouts + configurable mapping), preview, dedupe, anomaly quarantine, commit with file fingerprint, import log | api |
| T-06 | Overtime engine: tier matching, multiplier application, pre-approval enforcement, approved entries + exception surfacing (BR-070) | api |
| T-07 | Leave engine: accrual policy runs, carry-over cap, per-year balances, request lifecycle with simple approval (INV-030) | api |
| T-08 | Holiday calendars per jurisdiction + absence/overtime-tier integration | api |
| T-09 | Employee ↔ user bridge: link service, uniqueness guard, audit trail, SoD documentation | api |
| T-10 | Payroll variable-feed service: overtime / absence / late feeds per pay period + leave balance snapshots (PHASE-046 inputs) | api |
| T-11 | Golden G-51 (leave accrual run, policy-gated) + G-52 (encashment settlement) + posting-engine source keys | api |
| T-12 | Build `/hr/attendance` (daily register, exception board, import wizard) | web |
| T-13 | Build `/hr/leave` (requests + balances) and `/hr/shifts` (roster editor grid) | web |
| T-14 | Employee self-service tabs (own attendance calendar, leave request + balance, own roster) gated by `hr.self_service` | web |
| T-15 | NAV_ITEMS + ⌘K registration, permissions seeding, feature grants, i18n keys | web |
| T-16 | Implement the 3 report contracts + tests + `REPORT_CATALOG.md` rows | api |
| T-17 | INV-030 suite (non-overlapping intervals, balance caps, feed totals) + BR-068…070 guards + golden failure packs | api |
| T-18 | Docs: JOURNAL_RULES §7 rows + non-ledger note, ACCOUNTING_INVARIANTS INV-030, BUSINESS_RULES BR rows, FEATURE_CATALOG keys, NAVIGATION_MODEL entries, AUTHORIZATION_MATRIX SoD note, simple-approval decision record | docs |
| T-19 | Run full local gates + OA-06 EXPLAIN budgets (`attendance_records`, `leave_balances` hot paths); record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations ≈ 0082…0088 apply cleanly; Drizzle mirrors + `ENTITY_CATALOG.md` parity
   for all 10 tables (CR-36 (a)); RLS attack tests A1–A10 pass for every new tenant
   table — including a dedicated cross-employee data-isolation attack on
   `attendance_records` (CR-36 (e)).
2. INV-030 holds: attendance intervals never overlap per employee-day (imported and
   manual alike); leave used never exceeds entitlement + carried-forward at any
   moment (property tests incl. mid-year joiners and carry-over boundaries);
   overtime hours are non-negative and within configured caps.
3. Device import: a ZKTeco-style fixture file imports with dedupe (same employee +
   timestamp collapses to one record) and anomaly rows quarantined for review —
   nothing lands silently; the import log carries the file fingerprint; a re-import
   of the same file creates zero new records.
4. Daily derivation is exact over fixtures: present / late (past grace) / absent /
   missing punch / holiday / on-leave statuses match the roster, holiday calendar,
   and leave tables; exceptions surface on the register board.
5. Overtime: pre-approval-required rules block unapproved entries from the feed and
   surface them as exceptions (BR-070); approved entries carry hours, multiplier,
   and the linked request.
6. Leave lifecycle: request → approve → balance decrement → snapshot at period
   close; carry-over cap truncates excess with an audit line; the simple-approval
   decision record exists and points to PHASE-052 as the upgrade path.
7. Goldens G-51/G-52 green with failure packs: the accrual run posts only when the
   tenant policy enables it (BR-055-style no-defaults discipline); encashment
   settles through the payroll payout machinery without new account purposes.
8. Employee ↔ user bridge: uniqueness holds, the link is audited, and a test proves
   HR data visibility is independent of user-administration permissions (SoD note
   documented in the authorization matrix).
9. All house gates green: typecheck · lint · boundaries · unit tests ·
   `docs:validate` · i18n parity · permissions drift equality · manifests; OA-06
   budgets met; sync-surface assessment N/A-recorded (CR-36 (g)).
10. Completion report `reports/PHASE-045-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE045.zip` (OA-07).

## 7. Risks and Constraints

- **Import data quality is the #1 operational risk** — device files are messy:
  mitigated by preview + dedupe + anomaly quarantine, file fingerprints, and a
  committed-imports log that makes every record traceable.
- **Identity bridge SoD** — linking employees to users could leak HR data through
  user administration: mitigated by permission separation (HR visibility keys, not
  admin keys), a dedicated attack test, and the authorization-matrix note.
- **Simple approvals are a documented compromise** — one-step chains do not cover
  deep hierarchies: mitigated by the decision record naming PHASE-052 as the engine
  that will retro-fit leave and overtime approvals without data migration.
- **Balance arithmetic drift** — accrual, carry-over, and proration interact:
  mitigated by INV-030 property tests, period-close snapshots (reconstructable
  balances), and boundary fixtures (year-end, joiners, terminations).
- **Labor-law variability** — accrual policies and caps are jurisdiction-specific:
  mitigated by tenant-configurable policies with no fabricated defaults (the
  BR-055 discipline), while jurisdiction claims begin only in PHASE-046 under the
  verification regime.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-045-COMPLETION.md`
  (evidence per acceptance criterion, gate outputs, golden pack results, import
  fixture results, OA-06 EXPLAIN evidence).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-045 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase per the roadmap — PHASE-046 (Payroll Compliance) is now
  unblocked (its only hard prerequisite is this phase).
- Delivery: repository state archived as `ERP_PLATFORM_PHASE045.zip` (OA-07); the
  owner continues with «ابدأ تنفيذ المرحلة PHASE-046».
- Handoff notes for PHASE-046: the variable feeds (overtime / absence / late) and
  leave balance snapshots delivered here are the exact inputs the statutory engine
  consumes as variable lines; the `employees.user_id` bridge enables per-employee
  payslip delivery through existing notification channels; the holiday calendars
  feed PIT/EOSB period boundaries. Handoff notes for PHASE-047: org structure and
  positions will attach to the employees table extended here, and self-service tabs
  are the substrate for the talent portal.
