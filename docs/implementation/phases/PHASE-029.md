# PHASE-029 — Payroll: Salaries, Loans & End-of-Service

> **Status:** COMPLETE · **Updated:** 2026-11-08 (delivered per
> [reports/PHASE-029-COMPLETION.md](reports/PHASE-029-COMPLETION.md) — the
> planning-docs flip was honestly deferred at 029 commit time (commit `9b251a0`)
> and delivered with the PHASE-030 docs wave; the task-table drift was corrected
> in-delivery: the migration is `0040_payroll.sql` (not 0029), the web pages live
> under `apps/web/app/[locale]/payroll/**`, and the test suites under
> `apps/api/src/__db__/payroll/**` — the repo conventions)

## 1. Phase Overview

- **Phase ID:** PHASE-029
- **Title:** Payroll: Salaries, Loans & End-of-Service
- **Objective:** Deliver the `payroll` module in **financial scope only** per
  ED-05 and [DR-005](../../decisions/accounting/DR-005-payroll-scope.md): the
  PII-restricted employee financial file, versioned salary structures and
  components with per-component GL accounts, monthly payroll runs
  (DRAFT → PENDING_APPROVAL → POSTED) that post exactly one G-29 journal via
  the PHASE-007 engine with cost-center-allocated lines, payouts through
  treasury (G-30), employee loans with capped schedule deductions (BR-054), a
  tenant-policy-driven end-of-service provision with monthly accrual in the run
  and G-31 settlement at termination (BR-055 — **no jurisdiction rates
  fabricated**), the `payroll.register` / `payroll.cost-summary` /
  `payroll.eos-provision` reports, payslip printing on the PHASE-013 print
  system, and the new navigation group **الموظفون والرواتب / HR & Payroll**.
  Accounting constants apply unchanged: every posting goes through
  `PostingEngine.post` with source/operation keys and INV-013 idempotency;
  INV-025 makes run totals self-proving.
- **Business value:** Payroll is the biggest monthly expense of most MENA small
  businesses ("أكبر بند شهري"): the accountant (P-02) closes the month with one
  auditable run instead of spreadsheets, employee loans stop living in
  side-notes, and end-of-service accrual stops being a year-end surprise —
  while the ledger proves every rial of salary cost, and employee PII gets the
  strictest access discipline in the platform.

## 2. Scope

In scope:

1. **Employee financial file** (`payroll.employees`): `employees` table (code,
   name, name_ar, national_id, hire_date, termination_date?, contract_type,
   basic_salary, salary_structure_id, branch_id, cost_center_id?, bank fields,
   status) — **PII-sensitive**: `payroll.employees.view` is a restricted
   permission with role-template additions per
   [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.14/§K;
   national_id is stored per the
   [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) sensitivity
   classification (C-PII per
   [DATA_PROTECTION.md](../../security/DATA_PROTECTION.md) §1/§3): encrypted at
   rest, masked in UI, excluded from logs and from every non-payroll export by
   construction; employee reads are audit events. `employee_status` (ACTIVE,
   SUSPENDED, TERMINATED) and `employee_contract_type` (FULL_TIME, PART_TIME,
   CONTRACTOR) per DATA_DICTIONARY §9.
2. **Salary structures + components** (`payroll.salary_structures`):
   `salary_structures` (name, name_ar, currency, status ACTIVE/ARCHIVED) +
   `salary_components` (structure_id, key, name, name_ar, kind, calc, amount,
   rate, gl_account_id, is_eos_base). `salary_component_kind` = ALLOWANCE /
   DEDUCTION / EMPLOYER_CONTRIBUTION; `salary_component_calc` = FIXED /
   PERCENT_OF_BASIC / PERCENT_OF_GROSS (rates `7,4` per
   [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)). **BR-052**:
   runs require an ACTIVE structure; mid-period changes create a **new
   structure version** (previous row ARCHIVED, superseding row linked) — used
   structures are never edited in place. Every component carries its own
   `gl_account_id` (expense-side mapping, validated against the CoA);
   `is_eos_base` flags EOS-eligible components.
3. **Monthly payroll runs** (`payroll.runs` + `payroll.approvals`):
   `payroll_runs` (fiscal_period_id, status, gross_total, deductions_total,
   net_total, journal_entry_id) + `payroll_run_lines` 🔒 (run_id, employee_id,
   **component_snapshot jsonb** — the frozen per-employee component list at
   calculation time, gross/deductions/net per line). Lifecycle
   `payroll_run_status`: DRAFT → PENDING_APPROVAL → POSTED. **BR-053**: payroll
   accounts post **only via runs** — the engine gains a source-guard rejecting
   manual journals whose lines touch accounts mapped to the payroll purposes
   (typed `PAYROLL_ACCOUNT_ENGINE_ONLY`); **INV-025**: run totals equal Σ lines
   (gross, deductions, net) and net = gross − deductions **exactly**; posted
   runs are immutable (reversal-only, INV-003-style append-only grants on
   lines); posting is one JournalSpec through `PostingEngine.post` with
   INV-013 idempotency (source `payroll_run`, operation `post`) and official
   run numbers from the numbering service
   ([ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md), INV-021).
   **G-29 posting shape**: DR component expense accounts (`SALARIES_EXPENSE`,
   `EMPLOYER_CONTRIBUTIONS`, `EOS_PROVISION_EXPENSE`) · CR `SALARIES_PAYABLE`
   (net) · CR `DEDUCTIONS_PAYABLE` (third-party deductions + employer
   contributions payable); employee-loan recoveries credit the tenant-mapped
   loan control account (item 5). Run lines snapshot to `component_snapshot`
   so posted history never depends on later structure edits.
4. **Payout** (G-30): salary payout executes as treasury payments (PHASE-008
   payment service, payee = employee, bank fields from the employee file):
   DR `SALARIES_PAYABLE` · CR CASH/BANK per payment; batch payout per run
   (per-branch/per-bank grouping), idempotent per run; remaining
   `SALARIES_PAYABLE` balance = unpaid lines only. Payslips print per run
   (batch) or per employee through the PHASE-013 print system.
5. **Employee loans + schedule** (`payroll.loans`): `employee_loans`
   (employee_id, amount, installments_count, start_period_id, status) +
   `employee_loan_lines` (loan_id, fiscal_period_id, amount, payroll_run_id?,
   status PENDING/DEDUCTED/WAIVED). **BR-054**: loan deduction per period ≤
   cap percent of net (default **25% — PLACEHOLDER** pending the OQ-002
   pricing pass; policy key `payroll.loans.max_deduction_percent`); the run
   clamps/rejects above-cap schedules with an explicit warning. Disbursement is
   a treasury payment against the **tenant-mapped employee-loan control
   account** (policy key `payroll.loans.control_account_id`; typed
   `LOAN_ACCOUNT_UNMAPPED` until mapped) — **no new canonical CoA purpose is
   introduced** (§E list stays closed; the account is tenant-owned, e.g. سلف
   الموظفين / Employee loans & advances). `loan_status` = ACTIVE / CLOSED /
   WRITE_OFF; write-offs and waived lines require reason + audit. Run
   deductions credit the control account (receivable recovery), never
   `DEDUCTIONS_PAYABLE`.
6. **End-of-service (EOS) provision** (`payroll.eos_provision`): monthly
   accrual computed **inside the run** (Σ `is_eos_base` components × the
   tenant's accrual basis) and posted as the run journal's
   `EOS_PROVISION_EXPENSE` DR · `EOS_PROVISION` CR lines. **BR-055**: accrual
   is per **tenant policy** — policy keys `payroll.eos.enabled` (default
   `false`) and `payroll.eos.accrual_days_per_service_year` (**no default
   shipped** — an explicit tenant value is required to enable; PLACEHOLDER
   discipline documented) — **no jurisdiction rates are fabricated** (no GOSI/
   social-insurance/gratuity tables; see
   [official-sources protocol](../../localization/official-sources/README.md)
   and OQ-V2-1); onboarding templates may pre-create **empty** component
   shells with documentation pointers — never rates.
   **G-31 settlement at termination**: DR `EOS_PROVISION` (provision balance) ·
   CR CASH (settled) — residual to `EOS_PROVISION_EXPENSE`. The
   `payroll.eos-provision` report tracks provision movements per employee.
7. **Cost allocation to cost centers/projects** (`payroll.cost_allocation`):
   journal lines carry `cost_center_id` (and `project_id` where the employee is
   assigned to one) from the employee file, so salary expense lands in
   cost-center/project reporting and the `payroll.cost-summary` report
   reconciles to the GL by dimension (ledger-tie assertion).
8. **Reports** (`payroll.reports`, Report Page archetype):
   `payroll.register` (per-employee gross/deductions/net per run; totals tie to
   the run and its journal), `payroll.cost-summary` (by cost center/project ×
   period; GL tie), `payroll.eos-provision` (accruals, settlements, balance
   per employee). Employee-level detail requires the restricted
   `payroll.employees.view` permission; aggregates render for
   `payroll.runs.view`; every export is audited. Registered per
   [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) with provenance =
   payroll tables + GL (no source of truth → no report).
9. **UI per archetypes** ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)):
   employees List+Search (§2) + Create/Edit (§3, masked national_id/bank
   fields), the structure builder as a **Settings (§8) variant**, the run
   workspace as a Transaction Entry Workspace (§4) with per-employee line
   review + variance flags vs prior run, Approval Queue (§6) for run
   approvals, loans List+Search + Create/Edit + schedule Document Detail
   (§5), Report Page (§7) for the three reports, and **payslip printing via
   reporting templates** (a payroll-owned versioned print template on the
   PHASE-013 system — RTL-correct, AR+EN, Western digits LTR-isolated,
   `a4-document` derivative). **New navigation group 10 — الموظفون والرواتب /
   HR & Payroll** (icon `users-round`, per ED-12/register §K) with items:
   employees (الموظفون), salary structures (هياكل الرواتب), payroll runs
   (مسيرات الرواتب), loans (سلف الموظفين) —
   [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) group table goes 9 → 10
   (bump the "9 groups" wording wherever stated).
10. **Isolation + PII audit + rule tests**: all seven tables enter the
    isolation registry (A1–A10; S-04 zero-partial on nested payloads; A7 on all
    routes); attack rows per
    [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 PHASE-029:
    cross-tenant employee/run/loan ids, **PII access-audit attack rows**
    (unentitled reads of employee rows / national_id / bank fields → opaque
    404 + audit event; log-payload scan asserts no PII; payroll register
    export without permission → 403/404 with audit); `payroll-rules.spec` for
    BR-052…BR-055 per [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) §8.

Out of scope (explicit):

- **Attendance, leave, performance, and HR operations** — non-goals per ED-05
  and [DR-005](../../decisions/accounting/DR-005-payroll-scope.md); payroll
  consumes no time-tracking inputs (components are structure- or loan-driven).
- **Country statutory contribution tables** (GOSI, social insurance, pension
  funds): REQUIRE_VERIFICATION per the
  [official-sources protocol](../../localization/official-sources/README.md) —
  contributions are **tenant-configured components** with tenant-entered rates;
  the platform ships no rates and no jurisdiction defaults.
- **Gratuity / EOS legal-rule automation per jurisdiction** — the accrual basis
  is tenant policy (BR-055); there is no per-country EOS legal engine.
- **Payroll bank-file formats** (SIF and bank transfer file layouts) — future
  adapter decision record; payouts ship as treasury payments only.
- **WPS (Wage Protection System) integrations** — none.
- Salary revision workflows, promotions, org charts — HR-ops territory, out.

## 3. Prerequisites

- Required phases: **PHASE-025 COMPLETE (GA gate)** — stage-9 entry per ED-01;
  PHASE-001…024 transitively COMPLETE
  ([IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) rows +
  completion reports + green CI).
- **PHASE-007** (accounting core) — consumed artifacts: the posting engine
  contract (`post`/`reverse`, 8-step validation, error taxonomy, INV-013
  idempotency on `(tenant, source_type, source_id, operation)`), purpose
  mapping fail-closed (`SALARIES_EXPENSE`, `SALARIES_PAYABLE`,
  `DEDUCTIONS_PAYABLE`, `EMPLOYER_CONTRIBUTIONS`, `EOS_PROVISION`,
  `EOS_PROVISION_EXPENSE` — mapped in the tenant CoA; the phase ships their
  bilingual purpose labels + onboarding doc-sync), fiscal periods + period
  checks (runs are period-bound), the numbering service (run + payslip
  numbers, INV-021), cost centers + journal-line dimension, approval-policy
  service, audit events, GL drill-down.
- **PHASE-008** (treasury) — consumed artifacts: the payment service + G-10
  path (loan disbursement and salary payout are treasury payments with
  payee/bank fields), cash/bank accounts, numbering, INV-019 consistency (the
  payout's cash movement + journal stay self-proving).
- **PHASE-013** (reporting engine) — consumed artifacts: report-contract
  registry + zod boot validation, run orchestration (inline vs pg-boss),
  permission re-resolution at execution, XLSX export pipeline, the print
  system (versioned templates, Chromium render, RTL rules) for payslips.
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)
  (payroll never writes GL tables; a run = one JournalSpec; BR-053 source-guard
  is an engine validation),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (amounts
  19,4; component rates 7,4; half-up rounding at each component),
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (RLS on all
  seven tables + isolation attack rows; PII columns get the strictest defaults),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (official run +
  payslip numbers via the numbering service; employee codes are tenant-scoped
  natural keys),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (run calculation as
  a bounded pg-boss job — no PII in job payloads, ids only
  ([TENANT_ISOLATION.md](../../database/TENANT_ISOLATION.md) §3); report jobs).
- Relevant documentation:
  [DR-005](../../decisions/accounting/DR-005-payroll-scope.md) + ED-05
  ([EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §A/§B),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §payroll (keys:
  `payroll.employees` · `payroll.salary_structures` · `payroll.runs` ·
  `payroll.approvals` · `payroll.loans` · `payroll.eos_provision` ·
  `payroll.cost_allocation` · `payroll.reports`),
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (blueprint-level
  `payroll` section per ED-19),
  [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §6 (19,4; bank/rate
  columns) + §9 (seven new enums) + the sensitivity note for national_id,
  [DATA_PROTECTION.md](../../security/DATA_PROTECTION.md) §1–§4 (C-PII
  handling, PII inventory, export/purge: payroll rows join the tenant
  offboarding export→purge flow),
  [ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md)
  (OQ-V2-1 — jurisdiction contribution/EOS tables REQUIRE_VERIFICATION, blocks
  jurisdiction defaults only, never this module; OQ-002 — PLACEHOLDER
  discipline for the 25% loan cap),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-052…BR-055),
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (goldens G-29…G-31
  rows),
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-025 new; INV-003/013/021 reused),
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (golden +
  failure-pack conventions; INV-025 suite),
  [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §3 (run +
  payout lifecycle variations),
  [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) (month-close
  checklist gains the payroll-run check),
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (three rows +
  provenance), [REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md),
  [PRINTING_AND_EXPORT.md](../../reporting/PRINTING_AND_EXPORT.md) (payslip
  template rules),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.14 +
  §4 (SoD `payroll.runs.approve`) + §5 (branch scoping) + role-template
  additions restricting `payroll.employees.*` reads,
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2,
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) (+ 404-opaque foreign-id
  rule), [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md),
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1/§2 (group 10),
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (no rows added — payroll is not an offline surface),
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2 +
  [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) (only
  payroll services write payroll tables; accounting reads payroll only via
  reporting contracts).

## 4. Design Impact

- **Database changes:** seven tenant-owned tables — `employees`,
  `salary_structures`, `salary_components`, `payroll_runs`, `payroll_run_lines`
  🔒 (append-only grants per INV-003: written once at calculation, never
  updated/deleted; corrections are reversals), `employee_loans`,
  `employee_loan_lines` — RLS + composite tenant FKs + indexes
  (`(tenant_id, fiscal_period_id, status)` on runs/loan lines; employee code
  trigram for search). `national_id` and bank fields are encrypted-at-rest
  columns per the C-PII class; `component_snapshot` jsonb shape is documented
  in DATA_DICTIONARY style (frozen component list: key, kind, calc, amount,
  rate, gl_account_id, is_eos_base + computed values). No GL schema changes;
  CoA gains **purposes only as mapping entries** (six payroll purposes; no
   employee-loan purpose — item 5 documents the tenant-mapped control account
   instead). ENTITY_CATALOG gains the `payroll` rows in-phase.
- **API changes:** `/api/v1/payroll/employees[/{id}]` (+`/suspend`
  `/terminate` `/reactivate`),
  `/api/v1/payroll/salary-structures[/{id}]` + `/salary-structures/{id}/components`,
  `/api/v1/payroll/runs[/{id}]` (+`/calculate` `/submit` `/approve` `/post`
  `/reverse` `/payout` `/payslips`), `/api/v1/payroll/loans[/{id}]`
  (+`/lines/{lineId}/waive`), reports via the PHASE-013 run API — all per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md): POST actions with
  `Idempotency-Key`, 404-opaque on foreign ids, 409 `IMMUTABLE_DOCUMENT` on
  posted runs; employee responses mask national_id/bank fields unless the
  caller holds the restricted read permission **and** the field is required by
  the screen context.
- **UI changes:** navigation gains group 10 (users-round icon) with four
  items per the nav resolution rule (entitlement AND permission); the
  structure builder ships as a Settings-archetype variant (drag-free, row per
  component with kind/calc/account columns and live preview against a sample
  employee); the run workspace shows per-employee lines with prior-run
  variance flags; payslip template added to `packages/ui/print` (versioned,
  RTL-correct, AR+EN, tabular-nums, masked national_id on print per tenant
  policy); PII-masking form controls + an audit note on the employee screen.
- **Security & authorization:** §3.14 keys enforce on every route
  (`payroll.employees.view|manage`, `payroll.runs.view|create|approve|post`,
  `payroll.loans.manage`); `payroll.runs.approve` is SoD-guarded by default
  (matrix §4) and audited on use; role templates ship with payroll reads
  **excluded** from broad roles (owner/accountant explicit only); branch
  scoping applies to employees/runs/loans per matrix §5. Attack rows: the
  PII-access set of §2 item 10 (read-audit rows, export-audit rows, log-scan
  rows) plus cross-tenant id spoofing (A1–A10, S-04, A7).
- **Accounting implications:** goldens G-29 (run posting), G-30 (payout), G-31
  (EOS settlement) with mandatory failure packs (`PERIOD_LOCKED`,
  `PURPOSE_NOT_MAPPED` × 6, `ALREADY_POSTED`, `ENTRY_NOT_BALANCED`,
  `PAYROLL_ACCOUNT_ENGINE_ONLY` on manual journals, cap-exceeded deductions,
  structure-not-ACTIVE); **INV-025** enters the permanently-blocking invariant
  suite; INV-003/013/021 reused as-is; BR-052…BR-055 rule tests; the
  period-close checklist gains "payroll run posted (or explicitly deferred)"
  for periods with active employees
  ([PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) §2 addition).
- **Localization implications:** bilingual component names/labels and payslip
  layout; AR-first payslip with Western digits LTR-isolated (PHASE-013 RTL
  rules); month labels from the fiscal calendar; masked national_id rendering
  in both locales; AR+EN baselines for every screen.
- **Offline implications:** none — payroll is office-grade; no offline matrix
  rows added, no sync surface created (documented to keep the matrix honest).
- **Module dependencies:** `payroll` → `accounting` (engine, periods,
  numbering, cost centers, purposes) + `treasury` (payments: payout, loan
  disbursement) + `reporting` (contracts, print, export) + `tenancy`
  (branches) per [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md)
  §2; nothing writes payroll tables but payroll services
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) write
  matrix); no other module reads employee PII.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0029_payroll.sql`: 7 tables + RLS/composite FKs/indexes + append-only grants on `payroll_run_lines` + C-PII column protection (national_id, bank fields) | `apps/api/migrations/0029_payroll.sql` | migration fresh+regression; RLS catalog; A1–A10 on all seven; append-only violation rejected as `erp_app`; encrypted-column assertions |
| T2 | Employee file service: CRUD, status lifecycle, PII guards (masking, audit-on-read), branch scoping | `apps/api/src/modules/payroll/application/employee-service.ts` | unentitled read → opaque 404 + audit event; masked payload shape fixture; log-scan asserts zero PII |
| T3 | Salary structure service: structures + components, BR-052 versioning (superseding rows, ARCHIVED), per-component `gl_account_id` + `is_eos_base` validation | `apps/api/src/modules/payroll/application/structure-service.ts` | BR-052: run requires ACTIVE; edit-in-use creates a new version; archived structure cannot enter a run; foreign `gl_account_id` rejected |
| T4 | Run calculation service: per-employee computation from the structure (order: basic → PERCENT_OF_BASIC → PERCENT_OF_GROSS → FIXED, half-up per component), loan deductions with BR-054 cap, employer contributions, EOS accrual per BR-055 policy; bounded pg-boss job (ids-only payload) | `apps/api/src/modules/payroll/application/run-calculation-service.ts`, `infrastructure/run-calculation.job.ts` | INV-025 fixture (worked example below); cap clamps 26%→25% with warning; missing EOS policy → accrual skipped + explicit warning; snapshot freeze |
| T5 | Run posting service: one G-29 JournalSpec via `PostingEngine.post` (cost_center_id/project_id on lines), INV-013 idempotency, numbering, BR-053 source-guard registration | `apps/api/src/modules/payroll/application/run-posting-service.ts` | G-29 golden + failure packs (PERIOD_LOCKED, PURPOSE_NOT_MAPPED ×6, ALREADY_POSTED, UNBALANCED, PAYROLL_ACCOUNT_ENGINE_ONLY); double-post → same journal |
| T6 | Approval workflow: DRAFT → PENDING_APPROVAL → POSTED with SoD `payroll.runs.approve` + audit | `apps/api/src/modules/payroll/application/approval-workflow.ts` | approve without grant → 403; self-approve blocked; every transition audited |
| T7 | Payout service: G-30 treasury payments per run (batch grouping, bank fields), payslip generation hooks | `apps/api/src/modules/payroll/application/payout-service.ts` | G-30 golden; full payout → `SALARIES_PAYABLE` balance zero for the run; partial payout leaves exact remainder; idempotent per run |
| T8 | Loan services: disbursement via treasury payment to the control account, schedule generation, run-deduction integration, WAIVED/WRITE_OFF with audit | `apps/api/src/modules/payroll/application/loan-service.ts` | BR-054 suite (cap %, net-floor protection, clamping); schedule immutable after activation; `LOAN_ACCOUNT_UNMAPPED` until mapped; recovery credits the control account, never `DEDUCTIONS_PAYABLE` |
| T9 | EOS services: accrual in-run + termination settlement (G-31) + provision balances | `apps/api/src/modules/payroll/application/eos-service.ts` | G-31 golden: DR `EOS_PROVISION` · CR CASH · residual to `EOS_PROVISION_EXPENSE`; provision never negative; disabled-by-default fixture |
| T10 | Reports: `payroll.register`, `payroll.cost-summary`, `payroll.eos-provision` contracts (permission gating, GL ledger-tie assertions, XLSX export audited) | `apps/api/src/modules/reporting/registry/payroll/*.ts` | register ties to run + journal totals; cost-summary ties by dimension; assertion FAIL blocks export; employee detail requires `payroll.employees.view` |
| T11 | UI screens + payslip print template + navigation group 10 (employees, structures, runs, loans) | `apps/web/src/app/(app)/payroll/**`, `packages/ui/print/templates/a4-payslip/**`, nav registry rows | AR+EN baselines; axe + keyboard; RTL payslip fixture (digits isolated); group renders only with entitlement AND permission |
| T12 | Isolation + PII audit attack rows + rule suites + docs sync | `tests/payroll/payroll-rules.spec.ts`, `tests/isolation/**`, `tests/accounting/golden/G-29*,G-30*,G-31*`, `tests/accounting/invariants/INV-025*`, `docs/**` | A1–A10; PII read-audit + export-audit asserts; BR-052…055 green; docs validation green |

## 6. Verification

**Automated tests (required):**

- **G-29 golden (worked example)** — structure: basic 8,000.00 + housing
  allowance 2,000.00 (gross 10,000.00); employee deductions 1,500.00
  (third-party 1,000.00 + loan installment 500.00); employer contribution
  1,000.00; EOS accrual 800.00 (enabled tenant); net 8,500.00. Expected
  journal: DR `SALARIES_EXPENSE` 10,000.00 · DR `EMPLOYER_CONTRIBUTIONS`
  1,000.00 · DR `EOS_PROVISION_EXPENSE` 800.00 · CR `DEDUCTIONS_PAYABLE`
  2,000.00 (1,000.00 employee third-party + 1,000.00 employer) · CR employee-
  loan control account 500.00 · CR `SALARIES_PAYABLE` 8,500.00 — balanced
  11,800.00 = 11,800.00; every line carries the employee's `cost_center_id`;
  run totals satisfy INV-025 exactly (10,000.00 / 1,500.00 / 8,500.00);
  `component_snapshot` frozen; official run number assigned (INV-021); audit
  event present.
- G-30 golden: payout payment posts DR `SALARIES_PAYABLE` 8,500.00 · CR BANK
  with the run as source linkage; INV-019 cash movement consistency on the
  bank account; payslip count = paid lines.
- G-31 golden: terminated employee with provision balance 4,200.00, settled
  4,000.00 → DR `EOS_PROVISION` 4,200.00 · CR CASH 4,000.00 · CR
  `EOS_PROVISION_EXPENSE` 200.00 (residual release); mirror case (settle above
  balance) rejected.
- Failure packs (zero residue each): `PERIOD_LOCKED`, `PURPOSE_NOT_MAPPED`
  (unmap each of the six purposes), `ALREADY_POSTED`,
  `ENTRY_NOT_BALANCED`, `PAYROLL_ACCOUNT_ENGINE_ONLY` (manual journal on a
  payroll-purpose account), structure not ACTIVE (BR-052), deduction above
  BR-054 cap, run without employees, EOS enabled without an accrual basis.
- INV-025 suite: run totals = Σ lines for gross/deductions/net; net = gross −
  deductions exactly; posted-run line mutation rejected at the DB level;
  reversal is the only correction path.
- BR-052…055 rule tests (`payroll-rules.spec`): structure versioning;
  engine-only posting; cap math (500 ≤ 25% × 8,500.00 passes; 3,000.00
  clamps with warning; net-floor never negative); EOS per policy table with no
  shipped rates.
- Isolation + PII: A1–A10 on all seven tables; cross-tenant employee/run/loan
  id spoofing → opaque 404, zero partial creation (S-04); A7 on all routes;
  unentitled `national_id`/bank-field read → 404 + audit event; log payload
  scan (PII-laden object) redacts by construction
  ([OBSERVABILITY.md](../../architecture/OBSERVABILITY.md) allow-list proof);
  payroll export without permission → 403/404 + audit; permission checklist
  for §3.14 + SoD approve boundary.

**Manual verification:**

1. Onboard an employee (masked national_id entry), build a salary structure
   (allowance + third-party deduction + employer contribution), assign cost
   center + branch; verify a broad-role user cannot see the employee at all.
2. Calculate the monthly run → review the workspace lines + prior-run variance
   flags → approve as a different user (SoD) → post → GL drill-down lands on
   the balanced run journal with cost-center lines.
3. Execute payout via a bank treasury payment → `SALARIES_PAYABLE` nets to the
   unpaid remainder; print payslips in AR and EN (RTL fixtures).
4. Issue a loan (schedule visible, control account mapped), run the next
   month → deduction appears in the run, credits the control account, cap
   respected; waive one installment with reason → audited.
5. Terminate an employee → EOS settlement posts G-31 with the residual rule;
   check `payroll.eos-provision` report balance; attempt a manual journal on
   `SALARIES_PAYABLE` → typed rejection (BR-053).

**Acceptance criteria (objective):**

1. All seven tables exist tenant-owned with RLS and pass the isolation
   registry suite (A1–A10, S-04, A7) including the PII-access attack rows, with
   audit events on every restricted read and every export.
2. BR-052 holds: runs require an ACTIVE structure; mid-period changes create a
   new version; archived/used structures are never edited in place; run lines
   freeze `component_snapshot`.
3. G-29 posts exactly through the engine with line-level expected-vs-actual
   asserts (worked example), official numbers (INV-021), cost-center/project
   allocation on every line, and INV-013 idempotency per run.
4. INV-025 is enforced and in the permanently-blocking CI suite: run totals
   equal Σ lines and net = gross − deductions exactly; posted runs and their
   lines are immutable (reversal-only).
5. BR-053 holds: payroll-purpose accounts post only via runs (manual journals
   rejected with `PAYROLL_ACCOUNT_ENGINE_ONLY`); no other code path can post
   to them.
6. Payouts execute as treasury payments with the G-30 shape, INV-019
   consistency on the paying account, exact remainder tracking, and idempotency
   per run.
7. Loans enforce BR-054 (cap percent of net, default 25% PLACEHOLDER,
   documented in the settings schema), recover through the tenant-mapped
   control account (no new canonical purpose), and make every waive/write-off
   an audited, reason-required action.
8. EOS follows BR-055: accrual per tenant policy (disabled by default; no
   shipped rates), G-31 settlement with the residual rule; the platform
   contains no jurisdiction rate tables (grep-verifiable).
9. The three reports are registered per REPORT_CONTRACT with provenance, GL
   ledger-tie assertions, permission gating (employee detail requires
   `payroll.employees.view`), and export-blocked-on-assertion-failure.
10. All §3.14 permissions enforce on their routes (generated checklist green);
    `payroll.runs.approve` is SoD-guarded and audited; role templates exclude
    payroll reads from broad roles.
11. Navigation group 10 الموظفون والرواتب / HR & Payroll renders with its four
    items per the nav resolution rule; NAVIGATION_MODEL's group wording is 10
    everywhere; every screen has AR+EN baselines with axe + keyboard journeys;
    the payslip template prints RTL-correct in both locales. Criteria copied
    into [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

**Performance & security considerations:** run calculation is a bounded,
cancelable pg-boss job with an ids-only payload (no PII in jobs/queues per
TENANT_ISOLATION §3) and a 500-employee/20-component fixture inside the job
budget; run posting is a single transaction (one JournalSpec); employee search
indexes (trigram, tenant-first); national_id/bank columns encrypted at rest,
masked in API responses, and audit-on-read; exports rate-limited + audited
(DATA_PROTECTION export rules); period-lock concurrency on run-post vs
period-LOCK serialized by the engine's existing checks (CC-02 pattern).

**Migration & rollback:** additive migration `0028` only; no destructive
changes; posted runs are immutable so rollback = previous image
(expand-compatible); payroll rows are included in the tenant offboarding
export→purge flow per DATA_PROTECTION §4 (doc-sync note); EOS/loan policy keys
default to disabled/PLACEHOLDER so a rollback never leaves enforcement
surprises.

## 7. Risks and Constraints

- **PII breach surface (highest-sensitivity data in the platform)**: mitigated
  by restricted permission defaults in role templates, masking, audit-on-read,
  encrypted-at-rest columns, ids-only job payloads, log allow-lists, and the
  dedicated attack rows — any regression here is a release blocker.
- **Fabricated-rates risk (legal honesty)**: BR-055 ships no GOSI/social-
  insurance/EOS rates; contribution and EOS values are tenant-entered; future
  country packs require the REQUIRE_VERIFICATION protocol before any rate
  ships. This is a constraint, not a gap to "fix" quietly.
- **Computation drift** (component order, rounding, gross-dependent
  components): calculation order is fixed and documented, rounding is half-up
  per component per ADR-0009, and the snapshot freezes the basis — property
  tests extend the PHASE-007 money fixtures with payroll cases.
- **Month-close ordering**: runs are period-bound; posting after LOCK fails
  cleanly (`PERIOD_LOCKED`); the close checklist addition documents the
  run → post → payout → close order; the deferral is explicit, never silent.
- **Bank-file expectations**: users may expect SIF/WPS transfer files —
  explicitly deferred (adapter decision record); payouts ship as audited
  treasury payments; support macros state the boundary.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-029-COMPLETION.md` with: golden
  outputs (G-29 worked example, G-30, G-31 + all failure packs with zero
  residue), INV-025 suite outputs, BR-052…055 rule-test outputs, isolation +
  PII attack-row results (read-audit, export-audit, log-scan), permission
  checklist results, screen baseline inventory, AR+EN payslip print fixtures,
  and the grep proof that no jurisdiction rate table exists.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-029 → COMPLETE + tag), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (`payroll` rows live),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §payroll,
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-052…055 rows + §8
  matrix), [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §9 (seven
  enums; `component_snapshot` shape; national_id sensitivity note
  confirmation), [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7
  (G-29…G-31 rows), [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md)
  (G-29/30/31 + INV-025 suite mappings),
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-025), [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (three
  rows), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  (§3.14 + §4 SoD row + role-template additions),
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 PHASE-029
  rows, [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) (group 10 + 9→10
  wording), [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) (payroll
  check), [PRINTING_AND_EXPORT.md](../../reporting/PRINTING_AND_EXPORT.md)
  (payslip template), [DATA_PROTECTION.md](../../security/DATA_PROTECTION.md)
  §3 (employee PII inventory rows + §4 purge scope).
- **Exit criteria:** all 11 acceptance criteria green with evidence; a tenant
  can onboard employees, build structures, calculate/approve/post a monthly
  run, pay out, deduct a loan, accrue and settle EOS — in AR and EN — with the
  GL provably consistent (INV-025 + ledger ties) and employee PII provably
  guarded (attack rows + audit trail).
- **Definition of Done:** every rial of salary cost has exactly one run
  journal with cost-center-allocated lines; every employee-level ledger effect
  traces to a frozen run-line snapshot; PII access is auditable end-to-end; no
  jurisdiction rate exists anywhere in the codebase.
- **Handoff instructions:** read the PHASE-029 completion report. Payroll cost
  allocations, the EOS provision accounts, and the payroll reports are the
  inputs **PHASE-034 — Multi-Entity Consolidation** consumes later (034
  lists PHASE-029 among its prereqs; identify only, do not implement). The
  stage-9 siblings PHASE-026/027/028 may proceed in parallel after the GA gate
  per [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B sequencing.
