# Expansion Register — Blueprint v2.0 (Platform Depth & Breadth Expansion)

> **Status:** ACCEPTED · **Owner:** Product Owner & Platform Architecture · **Updated:** 2026-10-28
> **Supersedes:** nothing — extends [CONSOLIDATION_REGISTER.md](CONSOLIDATION_REGISTER.md) (v1.1) without altering any v1.1 decision.

This register is the **single canonical source** for Blueprint v2.0: the post-GA expansion of the
platform into a full-depth, multi-industry ERP competitive with the leading Arabic-market systems
(قيود Qoyod, أودكس Odex, وفق Wafeq, Deexe, iCore, رايتو Raito, إنفينيتي Infinity, DRB, Mdroo —
comparative research 2026-10-28). It fixes every identifier (phases, modules, feature keys,
entities, purposes, goldens, invariants, rules, enums, reports, templates) so that all updated
documents stay consistent. **Any document that conflicts with this register is wrong and must be
corrected; this register governs v2.0 additions only — v1.1 content (INV-001…022, BR-001…040,
G-01…G-20, CD-01…12, DEF-001…010) is untouched and remains binding.**

Research-confirmed gaps this expansion closes: cheques & post-dated notes (PDC), fixed assets &
depreciation, payroll (financial scope), installments, budgeting, multi-entity consolidation,
plus five industry templates (wholesale, mobile/electronics, healthcare, education, agriculture).

## A. Expansion decisions (ED-01…ED-19)

| # | Decision | Authority |
|---|----------|-----------|
| ED-01 | Platform expands post-GA into **stages 9–11** (PHASE-026…034). MVP gate (014) and GA gate (025) are **unchanged** — expansion never delays the commercial launch path. | [DR-003](decisions/product/DR-003-platform-expansion-v2.md) |
| ED-02 | New module `fixed_assets` (PHASE-026): register, categories, monthly depreciation runs, revaluation, disposal. | [DR-002](decisions/accounting/DR-002-fixed-assets.md) |
| ED-03 | New modules `notes` (cheques & promissory notes, PDC calendar, endorsement, dishonor, discounting) and `installments` (plans, schedules, late fees) in PHASE-027. The v1.1 `treasury.cheques` deferral chain (008→012) **terminates here**: cheques are delivered by the `notes` module. | [DR-003](decisions/accounting/DR-003-notes-and-installments.md) |
| ED-04 | New module `budgeting` (PHASE-028): versioned budgets by fiscal year over accounts/cost centers/projects/branches; budget-vs-actual variance; **advisory** controls by default. | [DR-004](decisions/accounting/DR-004-budgeting.md) |
| ED-05 | New module `payroll` (PHASE-029) with **financial scope only**: employees, salary structures/components, monthly runs, employee loans, end-of-service (EOS) provision. Attendance, leave, performance, and full HR remain non-goals. No country-specific contribution rates are fabricated — components are tenant-configured. | [DR-005](decisions/accounting/DR-005-payroll-scope.md) |
| ED-06 | New templates `industry.wholesale` and `industry.electronics` (PHASE-030) — configuration-layer templates over existing modules. | DR-003-product umbrella |
| ED-07 | New template `industry.healthcare` (PHASE-031): **commercial shell only** — patient financial files, insurance-claim billing, pharmacy stock. Clinical records/HIS stay non-goals. | DR-003-product umbrella |
| ED-08 | New template `industry.education` (PHASE-032): **commercial shell only** — tuition contracts, installment plans, sibling discounts. Academic operations/LMS stay non-goals. | DR-003-product umbrella |
| ED-09 | New template `industry.agriculture` (PHASE-033): **commercial shell only** — crop-cycle costing via BOM, harvest batches, livestock-as-serials. Precision agronomy stays a non-goal. | DR-003-product umbrella |
| ED-10 | Multi-entity **consolidation** (PHASE-034): a legal entity = a tenant; consolidation is a read-run over member books + elimination entries posted via the engine in the parent's consolidation books; **zero cross-tenant writes**. | [ADR-0018](architecture/ADR/ADR-0018-multi-entity-consolidation.md) + [DR-006](decisions/accounting/DR-006-consolidation.md) |
| ED-11 | Deep-vertical operations (HIS clinical, LMS academic, agronomy science) remain non-goals until a future decision record adds them. Commercial shells ship first. | DR-003-product umbrella |
| ED-12 | Navigation gains a **10th group** — الموظفون والرواتب / HR & Payroll (group table goes 9 → 10). Assets/budgets under Accounting, notes under Treasury, installments under Sales, consolidation under Reports. | §K below |
| ED-13 | Four new invariants **INV-023…INV-026** (assets, notes, payroll, consolidation). | §G below |
| ED-14 | Twelve new golden postings **G-21…G-32** (assets, notes, installments, payroll, consolidation). | §F below |
| ED-15 | Sixteen new business rules **BR-041…BR-056**. | §H below |
| ED-16 | Sixteen new CoA purposes (fixed assets, notes, payroll, late fees, consolidation). | §E below |
| ED-17 | `scripts/validate_docs.py` upgraded in the same revision: phase range → 001–034, manifests → 13, ADR set → 0001…0018, plus v2.0 structural checks. `scripts/extract_manifests.py` TEMPLATES gains the 5 new template files. | §N below |
| ED-18 | Fixed assets move from "deliberate deferral" (SCOPE §74) to **planned scope** (PHASE-026); payroll moves from non-goal #1 to **planned financial scope** (PHASE-029) — full HR ops stay excluded. | SCOPE_AND_NON_GOALS update |
| ED-19 | ENTITY_CATALOG gains the six v2.0 module sections at blueprint level (Phase column 026–029/034). The manufacturing/crm sections remain **phase-added** by PHASE-018/019 per the grow-per-phase rule — noted in the catalog to avoid ambiguity. | §C below |

## B. Canonical phase table (stages 9–11)

| Phase | Title | Stage | Prereqs (functional, after GA gate 025) | Module(s) |
|-------|-------|-------|------------------------------------------|-----------|
| PHASE-026 | Fixed Assets & Depreciation | 9 — Financial Depth | 007 (engine, periods), 013 (reports) | `fixed_assets` |
| PHASE-027 | Cheques, Promissory Notes & Installments | 9 | 008 (treasury), 012 (AR/AP chains), 013 | `notes`, `installments` |
| PHASE-028 | Budgeting & Variance Control | 9 | 007, 013 | `budgeting` |
| PHASE-029 | Payroll: Salaries, Loans & End-of-Service | 9 | 007, 008 (payouts), 013 | `payroll` |
| PHASE-030 | Wholesale & Electronics Templates | 10 — Industry Expansion II | 015 (framework), 017 (distribution features), 019 (service orders) | configuration over existing modules |
| PHASE-031 | Healthcare Commercial Shell | 10 | 015, 010 (pharmacy batches), 012 (AR), 019 (service orders), 027 (claims via notes) | configuration + light extension |
| PHASE-032 | Education Commercial Shell | 10 | 015, 027 (installments) | configuration + light extension |
| PHASE-033 | Agriculture Commercial Shell | 10 | 015, 018 (BOM/production costing) | configuration + light extension |
| PHASE-034 | Multi-Entity Consolidation | 11 — Enterprise Consolidation | 013, 026, 029 (+ dated FX from 007) | `consolidation` |

Sequencing: 026 ∥ 027 ∥ 028 ∥ 029 may run in parallel after GA (each depends only on pre-GA phases); 030…033 follow their functional prereqs; 034 closes stage 11. **Release gate: Enterprise Depth (after 034)** — consolidated statements reconcile to member books with eliminations proven.

## C. Canonical new entities (23 — all tenant-owned, RLS, UUIDv7, per catalog conventions)

| Table | Module/Phase | Key fields (beyond standard columns) | OC |
|-------|--------------|----------------------------------------|----|
| `asset_categories` | fixed_assets / 026 | code, name, name_ar, useful_life_months_default, depreciation_method_default, asset_purpose_key, accum_depreciation_purpose_key, expense_purpose_key | no |
| `assets` | fixed_assets / 026 | code, name, name_ar, category_id, acquisition_date, cost, salvage_value, useful_life_months, depreciation_method, branch_id, custodian_user_id, status | no |
| `depreciation_runs` | fixed_assets / 026 | fiscal_period_id, status DRAFT/POSTED, totals, journal_entry_id | no |
| `depreciation_lines` 🔒 | fixed_assets / 026 | run_id, asset_id, period_amount, accumulated_amount | no |
| `asset_disposals` | fixed_assets / 026 | asset_id, disposal_date, kind SALE/SCRAP, proceeds, net_book_value, gain_loss, status DRAFT/POSTED, journal_entry_id | no |
| `asset_revaluations` | fixed_assets / 026 | asset_id, revaluation_date, new_gross_value, new_accumulated, delta, status, journal_entry_id | no |
| `notes` | notes / 027 | kind CHEQUE/PROMISSORY_NOTE, direction RECEIVED/ISSUED, partner_id, number, issuing_bank, amount, currency, exchange_rate, issue_date, maturity_date, status, source_type/source_id | no |
| `note_events` 🔒 | notes / 027 | note_id, event_kind, event_date, refs, journal_entry_id, created_by | no |
| `installment_plans` | installments / 027 | partner_id, source_type/source_id, total_amount, down_payment, count, start_date, frequency, late_fee_policy jsonb, status ACTIVE/CLOSED/DEFAULTED | no |
| `installment_lines` | installments / 027 | plan_id, seq, due_date, amount, status PENDING/DUE/PAID/OVERDUE/WAIVED, receipt_refs | no |
| `budgets` | budgeting / 028 | fiscal_year_id, scope, name, version, status DRAFT/PENDING_APPROVAL/ACTIVE/REVISED/CLOSED, supersedes_id | no |
| `budget_lines` | budgeting / 028 | budget_id, fiscal_period_id, account_id, cost_center_id?, project_id?, branch_id?, amount | no |
| `employees` | payroll / 029 | code, name, name_ar, national_id, hire_date, termination_date?, contract_type, basic_salary, salary_structure_id, branch_id, cost_center_id?, bank fields, status | no |
| `salary_structures` | payroll / 029 | name, name_ar, currency, status ACTIVE/ARCHIVED | no |
| `salary_components` | payroll / 029 | structure_id, key, name, name_ar, kind ALLOWANCE/DEDUCTION/EMPLOYER_CONTRIBUTION, calc FIXED/PERCENT_OF_BASIC/PERCENT_OF_GROSS, amount, rate, gl_account_id, is_eos_base | no |
| `payroll_runs` | payroll / 029 | fiscal_period_id, status DRAFT/PENDING_APPROVAL/POSTED, gross_total, deductions_total, net_total, journal_entry_id | no |
| `payroll_run_lines` 🔒 | payroll / 029 | run_id, employee_id, component_snapshot jsonb, gross_total, deductions_total, net_total | no |
| `employee_loans` | payroll / 029 | employee_id, amount, installments_count, start_period_id, status ACTIVE/CLOSED/Written off via WRITE_OFF | no |
| `employee_loan_lines` | payroll / 029 | loan_id, fiscal_period_id, amount, payroll_run_id?, status PENDING/DEDUCTED/WAIVED | no |
| `consolidation_groups` | consolidation / 034 | owner_tenant_id, name, name_ar, base_currency, status | no |
| `group_entities` | consolidation / 034 | group_id, member_tenant_id, ownership_percent, include_from, status | no |
| `elimination_entries` | consolidation / 034 | group_id, fiscal_period_id, description, status DRAFT/POSTED, journal_entry_ids | no |
| `consolidation_runs` | consolidation / 034 | group_id, fiscal_period_id, status QUEUED/RUNNING/COMPLETED/FAILED, output refs | no |

Money/quantity/rate types per ADR-0009 and [DATA_DICTIONARY.md](database/DATA_DICTIONARY.md) §6 (costs/proceeds 19,4; percentages 7,4). Append-only 🔒 tables follow INV-003 (no update/delete grants).

## D. Canonical feature keys (38 new — feature catalog grows 125 → 163 keys, 16 → 22 modules)

`fixed_assets` (7): `fixed_assets.register` · `fixed_assets.categories` · `fixed_assets.acquisition` · `fixed_assets.depreciation` · `fixed_assets.revaluation` · `fixed_assets.disposal` · `fixed_assets.reports` — all PHASE-026.
`notes` (7): `notes.received` · `notes.issued` · `notes.pdc_calendar` · `notes.endorsement` · `notes.dishonor` · `notes.discounting` · `notes.reports` — PHASE-027.
`installments` (5): `installments.plans` · `installments.schedules` · `installments.collections` · `installments.late_fees` · `installments.reports` — PHASE-027.
`budgeting` (6): `budgeting.budgets` · `budgeting.cost_center_budgets` · `budgeting.project_budgets` · `budgeting.approvals` · `budgeting.controls` · `budgeting.reports` — PHASE-028.
`payroll` (8): `payroll.employees` · `payroll.salary_structures` · `payroll.runs` · `payroll.approvals` · `payroll.loans` · `payroll.eos_provision` · `payroll.cost_allocation` · `payroll.reports` — PHASE-029.
`consolidation` (5): `consolidation.groups` · `consolidation.eliminations` · `consolidation.runs` · `consolidation.fx_translation` · `consolidation.reports` — PHASE-034.

**Reconciliation:** existing `treasury.cheques` key is re-pointed to PHASE-027 with note "delivered by the `notes` module (accounting DR-003, ED-03)".

## E. Canonical new CoA purposes (16)

`FIXED_ASSET` · `ACCUM_DEPRECIATION` · `DEPRECIATION_EXPENSE` · `ASSET_DISPOSAL_GAIN` / `ASSET_DISPOSAL_LOSS` · `REVALUATION_RESERVE` · `NOTES_RECEIVABLE` · `NOTES_PAYABLE` · `NOTES_DISCOUNT_EXPENSE` · `LATE_FEE_INCOME` · `SALARIES_EXPENSE` · `SALARIES_PAYABLE` · `DEDUCTIONS_PAYABLE` · `EMPLOYER_CONTRIBUTIONS` · `EOS_PROVISION` · `EOS_PROVISION_EXPENSE` · `CONSOLIDATION_ADJUSTMENT`.

## F. Canonical golden postings G-21…G-32

| # | Event | Posting shape (DR · CR) |
|---|-------|--------------------------|
| G-21 | Asset capitalization (from GRN/purchase or direct) | DR `FIXED_ASSET` (category account) · CR AP_CONTROL or CASH |
| G-22 | Monthly depreciation run | DR `DEPRECIATION_EXPENSE` · CR `ACCUM_DEPRECIATION` (per category account; run = one journal, lines per asset) |
| G-23 | Asset disposal — sale above NBV (loss mirror mandatory) | DR CASH (proceeds) · DR `ACCUM_DEPRECIATION` (accumulated) · CR `FIXED_ASSET` (cost) · CR `ASSET_DISPOSAL_GAIN` (residual); loss mirror posts `ASSET_DISPOSAL_LOSS` |
| G-24 | Note received into custody (against an invoice) | DR `NOTES_RECEIVABLE` · CR `AR_CONTROL` (settles open item) |
| G-25 | Note collected at maturity (deposited) | DR CASH/BANK · CR `NOTES_RECEIVABLE` |
| G-26 | Note dishonored (received note bounces) | DR `AR_CONTROL` (restore open item) · CR `NOTES_RECEIVABLE`; any bank fee via existing `BANK_CHARGES` |
| G-27 | Note issued (to supplier) | DR `AP_CONTROL` · CR `NOTES_PAYABLE`; paid-at-maturity mirror: DR `NOTES_PAYABLE` · CR CASH/BANK |
| G-28 | Installment late-fee posting | DR `AR_CONTROL` · CR `LATE_FEE_INCOME` (per plan policy; only via engine) |
| G-29 | Payroll run posting | DR component expense accounts (`SALARIES_EXPENSE`, `EMPLOYER_CONTRIBUTIONS`, `EOS_PROVISION_EXPENSE`) · CR `SALARIES_PAYABLE` (net) · CR `DEDUCTIONS_PAYABLE` (third-party deductions) |
| G-30 | Payroll payout | DR `SALARIES_PAYABLE` · CR CASH/BANK |
| G-31 | EOS settlement at termination | DR `EOS_PROVISION` (provision balance) · CR CASH (settled) — residual to `EOS_PROVISION_EXPENSE` |
| G-32 | Consolidation elimination (intercompany AR/AP) | DR `AP_CONTROL` (entity B intercompany) · CR `AR_CONTROL` (entity A intercompany) — posted in the parent's consolidation books only |

## G. Canonical new invariants

- **INV-023** — For every asset: Σ depreciation ≤ cost − salvage_value; NBV ≥ 0 always; disposal only once and only from status ACTIVE/FULLY_DEPRECIATED.
- **INV-024** — Note custody equals its journal effects: a COLLECTED/DISCOUNTED/RETURNED note carries zero `NOTES_RECEIVABLE` balance; a DISHONORED note restores the AR open item exactly (amount + references).
- **INV-025** — Payroll run totals equal Σ lines (gross, deductions, net) and net = gross − deductions exactly; posted runs are immutable (reversal-only).
- **INV-026** — Consolidation runs never write member books; consolidated statement = Σ member statements (group currency, dated FX) − eliminations; every elimination is a balanced journal in the consolidation books.

## H. Canonical new business rules BR-041…BR-056

BR-041 asset categories map asset/accumulated/expense purposes before use · BR-042 depreciation posts only via runs (no manual asset journals); runs period-locked · BR-043 NBV floor at salvage; disposal locks the asset · BR-044 revaluation optional, audited, delta to `REVALUATION_RESERVE` · BR-045 notes require partner + maturity; PDC calendar auto-derived · BR-046 dishonor requires reason, restores AR exactly, fee optional via `BANK_CHARGES` · BR-047 endorsement moves custody without journal (journal only on collect/dishonor/return/discount) · BR-048 installment plan total must equal source document total; schedule immutable after activation · BR-049 late-fee policy per plan (rate + cap + grace — PLACEHOLDER defaults, OQ-002 family) · BR-050 one ACTIVE budget version per (fiscal year, scope); revisions supersede, never edit · BR-051 budget controls advisory by default; hard-block requires explicit tenant policy · BR-052 payroll runs require an ACTIVE salary structure; mid-period changes create a new structure version · BR-053 payroll accounts post only via runs · BR-054 loan deduction per period ≤ cap percent of net (default 25% — PLACEHOLDER) · BR-055 EOS accrual per tenant policy table; no jurisdiction rates fabricated · BR-056 consolidation members must have closed fiscal periods; eliminations reversible only by counter-entry.

## I. Canonical new enums (DATA_DICTIONARY §9 additions)

`asset_status` (ACTIVE, FULLY_DEPRECIATED, DISPOSED, WRITTEN_OFF) · `depreciation_method` (STRAIGHT_LINE, DECLINING_BALANCE, UNITS_OF_PRODUCTION) · `disposal_kind` (SALE, SCRAP) · `revaluation_status` (DRAFT, POSTED) · `depreciation_run_status` (DRAFT, POSTED) · `note_kind` (CHEQUE, PROMISSORY_NOTE) · `note_direction` (RECEIVED, ISSUED) · `note_status` (IN_CUSTODY, ENDORSED_OUT, DEPOSITED, COLLECTED, DISHONORED, DISCOUNTED, RETURNED) · `note_event_kind` (ENDORSE, DEPOSIT, COLLECT, DISHONOR, DISCOUNT, RETURN, RECLASSIFY) · `installment_frequency` (WEEKLY, BIWEEKLY, MONTHLY, QUARTERLY) · `installment_line_status` (PENDING, DUE, PAID, OVERDUE, WAIVED) · `installment_plan_status` (ACTIVE, CLOSED, DEFAULTED) · `budget_scope` (ACCOUNTS, COST_CENTERS, PROJECTS, BRANCHES) · `budget_status` (DRAFT, PENDING_APPROVAL, ACTIVE, REVISED, CLOSED) · `employee_status` (ACTIVE, SUSPENDED, TERMINATED) · `employee_contract_type` (FULL_TIME, PART_TIME, CONTRACTOR) · `salary_component_kind` (ALLOWANCE, DEDUCTION, EMPLOYER_CONTRIBUTION) · `salary_component_calc` (FIXED, PERCENT_OF_BASIC, PERCENT_OF_GROSS) · `payroll_run_status` (DRAFT, PENDING_APPROVAL, POSTED) · `loan_status` (ACTIVE, CLOSED, WRITE_OFF) · `loan_line_status` (PENDING, DEDUCTED, WAIVED) · `consolidation_run_status` (QUEUED, RUNNING, COMPLETED, FAILED).

## J. Canonical new reports (17 — catalog grows 50 → 67)

`fixed_assets.asset-register` · `fixed_assets.depreciation-schedule` · `fixed_assets.movements` (PHASE-026) · `notes.maturity-calendar` · `notes.aging` · `notes.dishonored-register` · `installments.schedule` · `installments.aging` (PHASE-027) · `budgeting.budget-vs-actual` · `budgeting.variance-analysis` (PHASE-028) · `payroll.register` · `payroll.cost-summary` · `payroll.eos-provision` (PHASE-029) · `consolidation.consolidated-tb` · `consolidation.consolidated-is` · `consolidation.consolidated-bs` · `consolidation.eliminations-log` (PHASE-034). Perms follow §K keys; provenance = owning module + tables (REPORT_CATALOG rule: no source of truth → no report).

## K. Canonical navigation & authorization changes

**Navigation (NAVIGATION_MODEL §1 → 10 groups):** new group 10 — **الموظفون والرواتب / HR & Payroll** (icon `users-round`): employees, salary structures, payroll runs, loans. Added items in existing groups: المبيعات += خطة الأقساط/Installment plans; المحاسبة += الأصول الثابتة/Fixed assets + الموازنات/Budgets; الخزينة += الشيكات والأوراق التجارية/Cheques & notes (+ تقويم الاستحقاق/Maturity calendar); التقارير += consolidated statements items (post-034). Every new item: bilingual label, archetype, permission, featureKey per [§D]. Bump NAVIGATION_MODEL's "9 groups" wording to 10 wherever stated.

**Authorization (AUTHORIZATION_MATRIX):** new sections §3.11 `fixed_assets` (PHASE-026), §3.12 `notes` & `installments` (PHASE-027), §3.13 `budgeting` (PHASE-028), §3.14 `payroll` (PHASE-029), §3.15 `consolidation` (PHASE-034). Permission key style: `fixed_assets.assets.view|create|manage|approve`, `fixed_assets.depreciation_runs.run|post`, `fixed_assets.disposals.approve`, `notes.notes.view|create|endorse|deposit|record_dishonor`, `installments.plans.manage`, `installments.lines.waive`, `budgeting.budgets.view|create|approve|activate`, `payroll.employees.view|manage`, `payroll.runs.view|create|approve|post`, `payroll.loans.manage`, `consolidation.groups.manage`, `consolidation.eliminations.create|post`, `consolidation.runs.execute`. Approval-gated + SoD rows in §4: `fixed_assets.disposals.approve`, `budgeting.budgets.approve`, `payroll.runs.approve`, `consolidation.eliminations.post`. Payroll data is sensitivity-critical: `payroll.employees.*` read restricted (role template additions).

## L. Canonical industry templates (5 new — ids, files, phases)

| Machine id | Name (EN · AR) | Phase | Manifest file | Doc file | Flagship keys |
|---|---|---|---|---|---|
| `industry.wholesale` | Wholesale & trade · الجملة والتجارة | 030 | manifest.wholesale.json | wholesale.md | `items.price_lists` (qty-break), `partners.credit_terms`, `sales.credit_limits`, `distribution.routes` OPT, `notes.received` |
| `industry.electronics` | Mobile & electronics · الجوالات والإلكترونيات | 030 | manifest.electronics.json | electronics.md | `inventory.serial_tracking` (IMEI), `crm.service_orders` (repairs), `pos.*`, trade-in via purchasing |
| `industry.healthcare` | Healthcare (commercial shell) · الرعاية الصحية | 031 | manifest.healthcare.json | healthcare.md | insurance-claim billing (AR per claim), `inventory.batch_tracking` (pharmacy), `notes.received` (claims cheques), `crm.service_orders` (visits) |
| `industry.education` | Education (commercial shell) · التعليم | 032 | manifest.education.json | education.md | `installments.plans` (tuition), `crm.service_contracts` (enrollment years), sibling discounts via pricing, dunning |
| `industry.agriculture` | Agriculture (commercial shell) · الزراعة | 033 | manifest.agriculture.json | agriculture.md | `manufacturing.bom` (crop cycles), `inventory.batch_tracking` (harvest), livestock as serial-tracked items, `accounting.projects` (per-field costing) |

Every new template doc follows the existing format (embedded ```json manifest = schema of [../industries/README.md §3](industries/README.md), target businesses, feature keys, sample nav AR+EN, terminology overrides, signature workflow, defaults, reports, **explicit out-of-scope: deep-vertical operations**). `scripts/extract_manifests.py` TEMPLATES dict gains the 5 filename→family pairs; run it to regenerate. CAPABILITY_MATRIX gains columns WHL · ELC · HLT · EDU · AGR and new rows `pdc_notes`, `installment_terms`, `insurance_claim_billing`, `crop_cycle_costing`, `harvest_batches` (+ existing-row values for the new columns; N/A where not applicable).

## M. Canonical workflows (BUSINESS_WORKFLOWS §10…§15)

§10 PDC note lifecycle (receive→custody→endorse/deposit→collect or dishonor→journal) · §11 Asset lifecycle (acquire→depreciate→(revalue)→dispose) · §12 Installment sale & collection (credit invoice→plan activation→dues→collect→late fee) · §13 Monthly payroll run (structure→draft→approve→post→payout) · §14 Budget cycle (draft→approve→activate→monitor variance→revise→close) · §15 Consolidation close (member period close→FX translate→eliminations→consolidated statements). Format matches existing §§ (Mermaid + posting notes).

## N. Validator & script upgrade (binding for this revision)

`validate_docs.py`: (1) phase range check → 001–034; (2) manifest expected list + 5 families (13 total, check renamed "13 extracted manifests…"); (3) ADR set 0001…0018; (4) phase document count → 34; (5) new structural checks — EXPANSION_REGISTER.md exists with ED-01…ED-19 table; FEATURE_CATALOG contains all 6 new module headers; ENTITY_CATALOG contains `asset_categories`, `notes`, `installment_plans`, `budgets`, `employees`, `consolidation_groups`; ADR-0018 present + indexed in ARCHITECTURE_DECISIONS; the 5 new manifest JSONs parse with `industry.*` ids; PHASE-026…034 files exist with all 8 section headings. Historical strings (e.g. "202 total markdown files" in VALIDATION_REPORT.md) describe the v1.1 snapshot and must remain intact.

## O. Safeguards (non-negotiable)

1. v1.1 decisions, DEF fixes, and CD-01…12 integrations remain byte-for-byte in effect; this register only **adds**.
2. Accounting constants (ADR-0009 precision, posting-engine monopoly, INV-001…022) apply unchanged to every new module — all new postings go through `PostingEngine.post` with source/operation keys and INV-013 idempotency.
3. Tenant isolation: every new table is tenant-owned + RLS + isolation attack rows; consolidation reads cross-tenant via an explicit, audited, read-only service (ADR-0018) — never by relaxing RLS.
4. Folders 1/2/4 (reference archives) are untouched; only folder 3 evolves.
5. MVP gate (PHASE-014) and GA gate (PHASE-025) acceptance criteria are unchanged — stages 9–11 are additive releases.
6. Every updated document keeps the repository's cross-reference discipline: feature keys cite [FEATURE_CATALOG.md](product/FEATURE_CATALOG.md), goldens cite [JOURNAL_RULES.md](accounting/JOURNAL_RULES.md) §7, permissions cite [AUTHORIZATION_MATRIX.md](security/AUTHORIZATION_MATRIX.md), phases cite their phase documents. All relative links must resolve (validator check 1a).
7. Documentation stays honest: no fabricated country rates, no PLACEHOLDER removal, no claims of implementation — new phases are `PLANNED` until executed with evidence.
