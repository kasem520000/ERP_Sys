# TABLES — HR Talent Cluster (PHASE-047)

> **Status:** DELIVERED (PHASE-047, migrations `0095`–`0099`, journal 99) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-19 · Column-level
> specs for the PHASE-047 cluster (the performance/goals engine, the
> recruitment pipeline, the training/certification registers, the org
> structure, the HR-10 document register, and the sweep's config surface),
> authored in-phase per the file header rule
> (ENTITY_CATALOG §hr-talent is the catalog-level map; this file is the
> column-level truth). ADR-0009 precision discipline throughout: money
> quanta `numeric(19,4)` non-negative (decimal strings on the wire, never
> floats); the score/percent axes `numeric(5,2)`/`numeric(7,2)` crossing as
> exact 2dp strings. RLS macro on every table; the isolation registry
> covers each (A1–A10 — the generated suite's +84 for the fourteen, +6 for
> the config row, plus the dedicated `talent-rls.db.spec`'s FK-chained
> hostile worlds). **LEDGER-FREE BY DESIGN (the phase doc's D-05): no table
> here writes `journal_*` — the talent layer is structurally
> ledger-incapable; the family's only GL-adjacent surface is the 045/046
> payroll substrate it READS (D-01: the talent layer never writes the
> `employees` table — the placement card's position_id/probation_end are
> documented 0097 extensions the ORG plane owns).**

## §performance_cycles — the review cycle register (0095, T-01/T-05)

One row per review cycle. `status` CHECK `DRAFT|ACTIVE|CALIBRATION|CLOSED`
(the one-way lifecycle — the W-2 engine's CAS ladder: every transition is
ONE conditional UPDATE pinning the expected status, `WHERE id AND status =
${from}`; zero rows = the typed `CYCLE_STATE_CONFLICT` 409); a CLOSED cycle
is immutable history (every review-window guard refuses). `period_start`/
`period_end` (NOT NULL dates) + `review_due_date` (nullable — the
hr.review-due sweep's probe; NULL = no due alert, the fail-open law).
`scope_org_unit_ids` (jsonb array, DEFAULT '[]') — the participant scope.
The W-2 `wouldCreateCycle` pure guard refuses an overlapping same-status
window before any write (D-09's no-overlap law). Grants: SELECT/INSERT/
UPDATE/DELETE for erp_app (master data — the typed service guards own the
lifecycle; A5's expectation is the policy-confined 0-foreign-rows shape).

## §performance_reviews — the review rows (0095, T-01/T-05)

ONE row per (cycle, reviewee, reviewer, kind) — the natural unique
`uq_performance_reviews_cycle_reviewer_reviewee_kind`; `kind` CHECK
`MANAGER|SELF|PEER|SUBORDINATE` (**BR-090's substrate**: MANAGER carries
the review proper; the other three are the 360 INPUT rows — visible only
in aggregate at the ≥ 3 threshold, never an attributed source).
`status` CHECK `DRAFT|SUBMITTED|CALIBRATED` (SUBMITTED is one-way from
DRAFT — the submit CAS; the immutable-after law: a SUBMITTED review never
returns to DRAFT). **`ck_performance_reviews_self_kind`:
`(kind = 'SELF') = (reviewer_employee_id = reviewee_employee_id)`** — the
reviewer ≠ the reviewee on every non-SELF row (the anonymization floor;
the W-6/W-4 seeds' first red runs proved the CHECK bites). Scores:
`overall_score` `numeric(5,2)` CHECK 0..100 (NULL allowed at DRAFT; the
360 kinds REQUIRE it at submission, the manager's optional per the
contract), `goal_rollup` `numeric(7,2)` CHECK 0..100, `competency_scores`
jsonb (the per-competency levels — in-app only, never in any export).
The composite FKs `(cycle_id, tenant_id)` → cycles, `(reviewer_employee_id,
tenant_id)`/`(reviewee_employee_id, tenant_id)` → employees (A8's law).
Grants: SELECT/INSERT/UPDATE only — **no DELETE** (the 360 aggregate's
integrity depends on the source rows existing; the evidence discipline).

## §competencies + §competency_levels — the framework (0095, T-01/T-04)

The tenant competency dictionary (`code` tenant-unique, bilingual names,
`active` flag) + the 1–5 scale (`uq_competency_levels_tenant_level`; the
descriptor pair NOT NULL both locales). **The scale is tenant-configurable
DATA (BR-055's no-fabrication law): 0098 §4 seeds the documented AR/EN
default for existing tenants through the 0093-gated sweep; new tenants get
it through the onboarding hook — one source, both paths
(`talent-canonical.ts`).**

## §goals — the cascade (0095, T-01/T-06)

One row per goal: `cycle_id` + `owner_employee_id` (composite FKs) +
`parent_goal_id` (the cascade link, RESTRICT) + `title` (the natural key's
third axis — `uq_goals_cycle_employee_title`), `weight` `numeric(5,2)` NOT
NULL (BR-089's Σ = exactly 100% is the submission gate — zero residue on
refusal), `kri_target`/`kri_actual`/`progress_pct` (the KRI triad),
`status` CHECK `ACTIVE|ACHIEVED|AT_RISK|CANCELLED` (CANCELLED is the
terminal soft state). Grants: SELECT/INSERT/UPDATE only — no DELETE.

## §vacancies — the requisitions (0096, T-02/T-07)

`code` tenant-unique, `title` bilingual, `headcount` int > 0, `status`
CHECK `OPEN|ON_HOLD|FILLED|CANCELLED`, `opened_at`/`filled_at` stamps,
`position_id` (composite FK → positions, 0097's table — the plan's slot
ordering). Grants: full CRUD (master data).

## §applicants — the pipeline rows (0096, T-02/T-07)

**BR-088's substrate**: `stage` CHECK `NEW|SCREEN|INTERVIEW|OFFER|HIRED|
REJECTED` (the FIXED ladder — no tenant-custom stage sets; the rank order
is `talent-math`'s pure law), `stage_history` jsonb array (every
transition appends `{from, to, action, at, by}` — ADVANCE/REOPEN/HIRE),
`hired_employee_id` (composite FK → employees, ON DELETE SET NULL — the
written-once hire link: the CAS's WHERE carries `hired_employee_id IS
NULL` whenever the statement sets one, so a second hire collapses to the
typed conflict, never a rewrite). The applicant's personal data
(`full_name` bilingual, `email`, `phone`, `source`) is **PII-registered
(amendment A-4)**: read-restricted to the recruitment permission plane,
never in exports (the W-6 pipeline report ships COUNTS ONLY — structural).
Grants: SELECT/INSERT/UPDATE only — no DELETE (the hiring record).

## §interviews — the panel scorecards (0096, T-02/T-07)

ONE row per panelist slot per round
(`uq_interviews_applicant_round_panelist`): `round` int > 0,
`panelist_employee_id` (composite FK), `scheduled_start`/`scheduled_end`
timestamptz NOT NULL, `mode` CHECK `ONSITE|VIDEO|PHONE`, `scorecard` jsonb
(the panelist's ratings — PII-plane, never in exports), `verdict` (the
panelist's own). Grants: SELECT/INSERT/UPDATE only — no DELETE.

## §training_programs + §training_enrollments + §certifications (0097, T-03/T-08)

Programs: `code` tenant-unique, `kind` CHECK `INTERNAL|EXTERNAL` (**the
vocabulary is INTERNAL/EXTERNAL — the W-6 spec's first seed said
COURSE/WORKSHOP and the CHECK refused, exactly as designed**), `cost`
`numeric(19,4)` CHECK ≥ 0 (money — ADR-0009), `status` CHECK
`ACTIVE|RETIRED`. Enrollments: one per (program, employee)
(`uq_training_enrollments_program_employee`), `status` CHECK
`ENROLLED|IN_PROGRESS|COMPLETED|WITHDRAWN` (**the COMPLETED edge stamps `completed_at`
+ `result` CHECK `PENDING|PASSED|FAILED` in the same write and never
re-stamps** — the W-3 law), `attendance_pct`/`completion_pct`
`numeric(5,2)`. Certifications: `issuer` + `issue_date` NOT NULL (the
compliance record), `expiry_date` nullable (**the hr.certification-expiry
sweep's probe; NULL = no window, ever**), `certificate_number` (PII-plane
per amendment A-4's family note). Grants: programs full CRUD; enrollments
and certifications SELECT/INSERT/UPDATE only (renewal is the UPDATE).

## §org_units + §positions — the org plane (0097, T-03/T-08, D-09)

`org_units`: `code` tenant-unique, `parent_id` (RESTRICT self-FK),
`path` (the materialized path — every move validates no cycle at write
time through the pure `detectCycle` bound, then re-paths the subtree in
ONE transaction through the guarded API; **the W-4 NF-9 fix rides here:
the subtree match is `starts_with(path, ${oldPath} || '.')` — the
literal-prefix law, never a LIKE with an unescaped `_`** — the adversarial
close-code test proves `SALES_EAST.` never matches `SALESXEAST.`).
`positions`: `code` tenant-unique, `title` bilingual, `grade` (the free
slot — PHASE-048's picker source), `org_unit_id` + `reports_to` (composite
FKs; reports_to carries the same cycle guard). Grants: full CRUD (master
data). **The 0097 §5/§6 extensions on `employees`: `position_id` +
`probation_end` — D-01/D-02+A-1's documented extensions (nullable,
fail-open: NULL probation = not tracked, the sweep skips, no alert
fabricated; the field is PII-registered per the A-1 amendment).**

## §employee_documents — the HR-10 register (0097, T-03/T-09)

`kind` CHECK `PASSPORT|IQAMA|VISA|CONTRACT|CERTIFICATE|OTHER`, `number`
(**PII — amendment A-4: never in exports; masked in UI except at this
register's own permission plane `hr.documents.manage`**), `issued_on`/
`expires_on` nullable dates (**the hr.document-expiry sweep's probe; NULL
expiry = no window, ever — the fail-open law**). Grants: full CRUD
(replacement is a normal HR operation; the audit trail lives in
audit_events).

## §hr_alert_jobs — the sweep's config surface (0099, W-3, D-06)

One row per tenant per job kind (`uq_hr_alert_jobs_tenant_kind`; `job_kind`
CHECK `EXPIRY_SWEEP`): `thresholds` jsonb array of non-negative integers
(**the documented default [30,7,0] — BR-091/amendment A-2's law: the
thresholds are tenant-configurable DATA with documented fail-closed
defaults; NO row = the defaults fire, an explicit `is_active = false` row
is the off switch, absent ≠ inactive — the 044 inventory pattern**),
`is_active`, `last_run_at`/`last_flagged` (the stamped run stats). Grants:
SELECT/INSERT/UPDATE only (the config row is the register; the upsert is
the update path). The sweep itself is READ-ONLY over the talent plane (D-06
— never a repair; the notification + the run stats + the audit event are
the whole effect) and its dedupe is STRUCTURAL: the four-segment key
`hr:{kind}:{employeeId}:{documentId}:{threshold}` (BR-091's exact shape)
rides the notifications table's unique index — a re-run can never
double-alert.
