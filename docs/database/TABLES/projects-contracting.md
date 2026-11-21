# TABLES — Projects & Contracting Cluster (PHASE-048)

> **Status:** DELIVERED (PHASE-048, migrations `0100`–`0104`, journal 104) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-22 · Column-level
> specs for the PHASE-048 cluster (the WBS tree, the budget cost-curve, the
> resource allocations, the change-order gate, the contracting core —
> subcontracts + certificates + the retention ledger + progress billing —
> the field-service visits, and the IAS-23 scope tracking), authored
> in-phase per the file header rule (ENTITY_CATALOG §projects-contracting
> is the catalog-level map; this file is the column-level truth).
> ADR-0009 precision discipline throughout: money quanta `numeric(19,4)`
> non-negative (decimal strings on the wire, never floats); the percent
> axes `numeric(5,2)`/`numeric(7,4)` crossing as exact strings. RLS macro
> on every table; the isolation registry covers each (A1–A10 — the
> generated suite's +66 for the eleven, plus the dedicated
> `projects-rls.db.spec`'s FK-chained hostile worlds with the composite-FK
> law proven live). **The planning substrate is LEDGER-FREE by design (the
> W-8 scope law): no table here writes `journal_*` — the cluster's ledger
> surfaces are the ENGINES' postings through the centralized engine (the
> goldens G-55…G-58 + the IAS-23 capitalization; JOURNAL_RULES §7 note 18);
> the 0104 stamp columns are the single-consumption evidence links, never
> journal writes.** The grants split follows the master-data vs
> evidence-discipline law: planning tables (WBS/budget lines/allocations/
> agreements) carry DELETE for the typed service guards' lifecycles; the
> evidence tables (certificates/change orders/retention/visits/ias23)
> carry SELECT/INSERT/UPDATE only — NO DELETE anywhere on the commercial
> history.

## §project_wbs_tasks — the work-breakdown tree (0100, T-01/D-03)

Around the FROZEN six-column 019 `projects` substrate (D-01: extended,
never replaced). `parent_task_id`/`predecessor_task_id` self composite-FKs
(RESTRICT — children first, the evidence order; the multi-edge dependency
graph composes through intermediate tasks); `ck_project_wbs_tasks_parent_
not_self`/`ck_project_wbs_tasks_predecessor_not_self` (no self-edges);
`uq_project_wbs_tasks_tenant_project_code` (tenant, project, wbs_code);
`weight` nullable `numeric(7,4)` 0…100 (the weighted rollup's coefficient);
`percent_complete` `numeric(5,2)` 0…100 NOT NULL DEFAULT 0 — **the task's
OWN report; the rollup is RECOMPUTED FROM THE LEAVES on every read (BR-095)
— never a stored stale sum**; `ck_project_wbs_tasks_window` (end ≥ start);
`is_milestone` (the zero-duration marker); the bilingual title/note pairs.
Cycle safety is the pure guard at the engine (`detectDependencyCycle` +
`wouldCreateParentCycle` — both run before EVERY write; the API is the only
move path; the illegal state never saves). Grants: SELECT/INSERT/UPDATE/
DELETE (planning data — the typed service guards own the tree lifecycles);
the tree dies with its project (CASCADE on the project FK).

## §crm_time_entries.wbs_task_id — the labor dimension (0100, the "+1 column family")

The additive nullable `wbs_task_id` uuid + composite FK → project_wbs_tasks
(RESTRICT) + the partial `ix_crm_time_entries_tenant_wbs`. 0027's table is
otherwise untouched. The task ∈ the entry's project coherence is the
collector's WRITE-TIME validation (W-9 — cross-row, engine-side, never a
guessed default; absent ≡ NULL keeps the 019-era specs byte-identical).

## §project_budgets + §project_budget_lines — the cost curve (0101, T-02/D-04)

`project_budgets`: `uq_project_budgets_tenant_project_name`; `status` CHECK
`DRAFT|APPROVED|CLOSED` with `ck_project_budgets_approval` (non-DRAFT
carries approved_at) — **the ONE-APPROVED law (D-07)**: the engine's CAS
ladder refuses a second APPROVED budget per project; the APPROVED curve
ALONE feeds PV (the exact pure fold); the DRAFT bulk-replace rides the
lines' DELETE grant (budgets themselves: NO DELETE — the approved curve is
the variance truth). `project_budget_lines`: `cost_type` CHECK
`LABOR|MATERIAL|SUBCONTRACT|OVERHEAD`; `planned_amount` `numeric(19,4)`
≥ 0; `ck_project_budget_lines_window` (end ≥ start); **THE CELL LAW** —
one planned amount per (budget, cost_type, node, period_start) via the
partial-unique pair `uq_project_budget_lines_cell_task` (node-bound) +
`uq_project_budget_lines_cell_project` (project-level NULL-node — the
pullable-index precedent's WHERE shape; the typed 23505 refusal on a
duplicate cell). Grants: budgets SELECT/INSERT/UPDATE; lines
SELECT/INSERT/UPDATE/DELETE (the DRAFT bulk-replace).

## §project_resource_allocations — the people/asset plan (0101, T-03/D-04)

`resource_kind` CHECK `EMPLOYEE|ASSET` with `ck_project_resource_
allocations_target` (the kind-exclusive law: EMPLOYEE ↔ employee_id set +
asset_id NULL; ASSET the mirror); employee/asset composite FKs (RESTRICT);
`allocation_percent` `numeric(5,2)` > 0 and ≤ 100; `ck_..._window`
(end ≥ start). **The over-allocation warning is a READ SIGNAL** (the
overlapping-window sweep across all the tenant's projects — never a write
refusal; 0101's recorded law). Grants: SELECT/INSERT/UPDATE/DELETE
(planning data).

## §change_orders — the re-planning gate (0102, T-04/D-07)

`uq_change_orders_tenant_project_no`; `price_delta` `numeric(19,4)` NOT
NULL (signed — the G-58 posting's sign); `ck_change_orders_schedule_delta`
(NULL or ≠ 0); `status` CHECK `DRAFT|SUBMITTED|APPROVED|REJECTED`;
`ck_change_orders_submission` (non-DRAFT carries submitted_at);
**`ck_change_orders_approval_link`** (exactly one terminal verdict: APPROVED
carries approved_at/by with no rejection stamps; REJECTED carries
rejected_at/by + the MANDATORY rejection_reason; DRAFT/SUBMITTED carry
neither — the 045 simple-approval shape); **`ck_change_orders_effect_gated`
— BR-094's structural floor: `effect_applied_at` IS NULL OR status =
'APPROVED'** (no effect before approval, IN SQL). The ceiling reads count
APPROVED alone (`ix_change_orders_tenant_effect` — the partial read path);
`ceiling()` recomputes on every read (the register's value + Σ the
approved deltas — no stored sum to go stale). Grants: SELECT/INSERT/
UPDATE — **NO DELETE (the contract history is audited evidence)**.

## §subcontractor_agreements — the sub contract register (0103, T-10/D-08)

`uq_subcontractor_agreements_tenant_project_no`; `agreement_value`
`numeric(19,4)` > 0; `retention_percent` `numeric(5,2)` 0…100 (BR-092's
per-agreement DATA — the certificate's pair is DERIVED from it);
`currency_code` NOT NULL (the FX discipline at posting); `status` CHECK
`DRAFT|ACTIVE|CLOSED|CANCELLED` with `ck_subcontractor_agreements_
lifecycle` (ACTIVE carries activated_at, no close/cancel stamps; CLOSED
carries both activation and close; CANCELLED carries the MANDATORY
cancel_reason with no close stamp; DRAFT carries none — the CAS ladder's
verifiable floor). **The ACTIVATION opens the agreement's SUBCONTRACTOR
retention row — the SAME ledger, one row per agreement** (the partial
unique below). Grants: SELECT/INSERT/UPDATE/DELETE (master data — the
typed service guards own the lifecycle).

## §subcontractor_certificates — the sub progress certificate (0103, T-10/D-08)

`uq_subcontractor_certificates_tenant_no` (tenant, agreement, no);
`progress_percent` 0…100; **`ck_subcontractor_certificates_amounts` — the
arithmetic floor IN SQL: retention_withheld + net_payable = gross_value**
(all three ≥ 0); `status` CHECK `DRAFT|APPROVED|VOID` with
`ck_..._approval` (APPROVED ⟺ approved_at) — **the APPROVED history is
TERMINAL** (VOID pins to the never-approved path). 0104 adds
`ap_journal_entry_id` (nullable uuid + composite FK → journal_entries,
RESTRICT) — **the single-consumption AP-linkage stamp**: the engine's
guarded UPDATE writes it ONLY after both postings (the linkage + G-55's
hold) succeeded, in the SAME ambient transaction (the all-or-nothing
rollback leaves the certificate DRAFT, nothing posted, nothing accrued).
Grants: SELECT/INSERT/UPDATE (evidence discipline).

## §retention_accounts — the ONE ledger, both sides (0103, T-11/D-09)

`kind` CHECK `CUSTOMER|SUBCONTRACTOR` with **`ck_retention_accounts_side_
shape` — the side law IN SQL**: the CUSTOMER row (the contract's commercial
spine: contract_value > 0 + currency_code + hold_percent NOT NULL, no
agreement link) vs the SUBCONTRACTOR row (the agreement link NOT NULL, the
commercial columns NULL — one source of truth, the agreement owns the
terms). The partial uniques: **ONE customer register per project**
(`uq_retention_accounts_tenant_project_customer`) + **one sub row per
agreement** (`uq_..._agreement_sub`). `accrued_balance`/`released_amount`
≥ 0; `status` CHECK `ACTIVE|RELEASED` with `ck_..._release` (RELEASED ⟺
released_at); `taking_over_date`/`defect_liability_date` (G-56's schedule
gates — the release fold reads them). 0104 adds `customer_id` (the
contract's customer, composite FK → partners) — **the IMMUTABLE CORE**:
value/currency/customer never move after creation (the engine's typed
refusal — the approved change order is the ONLY re-planning path); the
patchable terms are the hold %, the schedule and the notes. Grants:
SELECT/INSERT/UPDATE (evidence discipline).

## §progress_certificates — the customer billing event (0103, T-12/D-10)

`uq_progress_certificates_tenant_no`; `kind` CHECK `PROGRESS|ADVANCE|FINAL`;
`cumulative_percent` 0…100; **`ck_progress_certificates_amounts` — the
arithmetic floor IN SQL: retention_amount + net_value = gross_value** (all
three ≥ 0; the engine DERIVES the pair from the register's hold %, BR-092);
`status` CHECK `DRAFT|SUBMITTED|APPROVED|VOID` with
`ck_..._approval_link` (the one-verdict shape) + **`ck_..._invoice_gated`
(the sales_invoice_id stamp exists only on the approved path)** — the
in-transaction POSTED invoice (its journal IS the G-57 entry; the stamp
lands only after everything succeeded). 0104 adds
`advance_applied_amount` `numeric(19,4)` NOT NULL DEFAULT 0 with
`ck_progress_certificates_advance_applied` (0 ≤ applied ≤ gross_value AND
(kind = 'ADVANCE' OR applied = 0) — a non-advance certificate carries
exactly 0; the G-33-mirror amortization's state). The ceiling read rides
`ix_progress_certificates_tenant_ceiling` (the approved-gross partial).
Grants: SELECT/INSERT/UPDATE (evidence discipline).

## §service_visits — the dispatch board's row (0103, T-13/D-12)

On the EXISTING `service_orders` (the presentation join reads the parent
order's own number — W-13). `status` CHECK
`NEW|SCHEDULED|DISPATCHED|IN_PROGRESS|COMPLETED|CLOSED` with
**`ck_service_visits_stamps` — the machine's stamp law IN SQL** (exactly
the stamps of the passed states: NEW/SCHEDULED none; DISPATCHED
dispatched_at; IN_PROGRESS + started_at; COMPLETED + completed_at; CLOSED
+ closed_at); `ck_service_visits_window` (scheduled_end > scheduled_start);
**`ck_service_visits_pause_gated`** (`is_paused` = false OR status =
'IN_PROGRESS' — the single clock service's state; NEW/SCHEDULED/COMPLETED/
CLOSED never pause; the completed-while-paused law releases the flag in
the SAME CAS); **`ck_service_visits_technician_gated`** (the technician
required from DISPATCHED). The pause/resume events ride the operations
audit trail (`crm.service_visit.paused`/`.resumed`); BR-096's clocks are
RECOMPUTED reads (the pure fold — no stored clock state). Grants:
SELECT/INSERT/UPDATE (evidence discipline).

## §ias23_capitalizations — the borrowing-costs scope (0103, D-11)

`uq_ias23_capitalizations_line_window` (tenant, budget_line, window_start
— one slice per line per window); `expenditures/capitalized/expensed
_amount` ≥ 0 with `ck_..._amounts` (capitalized + expensed ≤ expenditures);
`rate_snapshot` `numeric(9,6)` 0…1 (the register's evidence trail); status
CHECK `DRAFT|POSTED` with `ck_..._posting` (POSTED ⟺ posted_at) — **the
single-use POSTED scope rows refuse re-capitalization of the same (line,
slice); the history is computation evidence, no delete; a re-planned
window opens a NEW slice, never a re-post**. The rate register itself is
the planted settings key `projects.ias23_capitalization_rate`
(REQUIRES_VERIFICATION — never a table, the gosi_establishment_no
no-default precedent). Grants: SELECT/INSERT/UPDATE (evidence discipline).

## The settings keys (the D-02 config-row law — never tables)

`projects.ias23_capitalization_rate` (the IAS-23 register — {rate,
source_evidence, verified}; both arms refuse typed IAS23_RATE_UNVERIFIED
while unset/malformed/unverified), `projects.labor_standard_monthly_hours`
+ `projects.overhead_distributor` (the collectors' config, null-default +
pin-neutral — the honest UNPRICED warning, never a fabricated rate), the
SLA targets register (BR-096's fail-closed defaults — no row = the honest
'—', never a fabricated target), and the `projects.*` feature flags'
composition (0103 §3's manifest enablements — the canonical templates.ts
+ the stored registry + the docs mirrors moved together in W-8's one
increment).
