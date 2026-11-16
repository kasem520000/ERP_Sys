# NEXT ACTION — post-PHASE-045

PHASE-045 (HR Core — Attendance, Leaves & Shifts) is COMPLETE — the audit's
operational HR gap (HR scored 26%) is closed: migrations `0080`–`0088`
(schema_version 88; the shift/attendance/overtime/leave/holiday families +
the employee↔user bridge + the seeds + the import log + the workforce
manifests), +12 RLS'd tables, the roster grid with the rotation generator,
the DERIVED daily status (HOLIDAY > ON_LEAVE > ABSENT/MISSING_PUNCH/LATE/
PRESENT — the day is the unit, INV-031's non-overlap at every capture, the
T-19 classification law order-independent), the device-agnostic import
(the sha256 fingerprint floor — the same file never commits twice), the
overtime engine (BR-084's feeding law), the leave family (the simple
approval — DR-045-01, PHASE-052 is the upgrade path), the identity bridge
(the SoD law pinned: linking grants nothing), the variable feeds +
leave-balance snapshots, the goldens G-50/G-51, and the web plane (four
office boards + the self-service tabs). CURRENT_SHIPPED_PHASE =
"PHASE-045" (permissions 297=297; i18n 6,007=6,007; report registry 104;
ENTITY_CATALOG's HR section; DB suite 239/239 files · 3,313/3,313; api
unit 626/626; docs 33/33; typecheck/lint 8/8; OA-06 budgets 6/6). The
completion report is
`docs/implementation/phases/reports/PHASE-045-COMPLETION.md`; the archive
is `ERP_PLATFORM_PHASE045.zip` (OA-07).

**Next eligible: PHASE-046 (HR Payroll Compliance — GOSI/PIT/EOSB, CR-16)**
— prerequisites: PHASE-045 COMPLETE ✓ (its only hard prerequisite is this
phase; the roadmap's hard ordering "045 before 046 before 047" holds).
Start with `docs/implementation/phases/PHASE-046.md` (T-01…T-16: the
statutory contribution profiles under the REQUIRES_VERIFICATION
discipline, the PIT withholding engine, the EOSB automation with the 029
provision true-up, the variable-line consumption, the GOSI remittance
export; goldens G-52…G-54, INV-032, BR-085…087 — the id-ledger's
coordinated slots).

Key handoffs from 045 (read the PHASE-045 completion report first):

- **The variable feeds are the exact statutory inputs**: the per-pay-period
  overtime / absence / late feeds + the leave-balance snapshots
  (`feed.store`, the `payroll.runs.view` read) land as PHASE-046's
  variable lines with run-time multiplier application; leave encashment
  rides the G-51 settlement delivered here — no new machinery.
- **The derivation's six-verdict vocabulary is the absence truth**: the
  compliance engine consumes PRESENT/LATE/ABSENT/MISSING_PUNCH/HOLIDAY/
  ON_LEAVE + the minute facts as computed (MISSING_PUNCH is its own count,
  never folded into absence — the T-10 law).
- **The `employees.user_id` bridge enables per-employee payslip delivery**
  through the existing notification channels; the SoD law keeps HR
  visibility on the hr keys (a user-administration role holds no
  hr.*/payroll.employees.* key — reuse the pattern when 046's screens
  scope per-employee views).
- **The holiday calendars feed PIT/EOSB period boundaries**; the
  jurisdiction-scoped calendar (one per jurisdiction, the active flag) is
  the same shape the statutory profiles should follow — and the
  REQUIRES_VERIFICATION discipline is the BR-055 no-fabrication law
  extended to rates (only the officially verified GOSI profile seeds
  active; UAE/Egypt/Jordan stay blocked until verified, fail-closed).
- **The BR-055 family discipline**: accrual 0.00 until configured, no
  fabricated defaults, tenant-configurable policies — 046's rates, caps,
  and tiers must not invent statutory numbers (the phase doc's own
  verification regime is the enforcement).
- **The T-14 envelope law**: every controller site awaits its service call
  INSIDE envelope(...) — the hr controllers' 69 repaired sites are the
  reference implementation; NEW controllers must never hand Express a
  floating promise.
- **Watch items carried** (the owner's dispatch, unchanged): the shipped
  modules' unawaited controller sites (the envelope-law sibling pattern —
  sales/inventory/purchasing/sourcing/wms/tax/…), SF-026-001/002, the
  028/029/030/037 environmental items, RISK-031/RISK-032 (the 043 hard
  review — OPEN; completing 045 was NOT its closure), and the 043 review
  round's standing rule: separate commits + separate evidence per phase,
  the shared gates re-run on the unified head, each its own run.
