# DR-005 — Payroll Scope: Financial Core Only, Zero Fabricated Jurisdiction Rates

> **Status:** ACCEPTED · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28 ·
> **Date:** opened 2026-10-28, accepted 2026-10-28 ·
> **Approver:** Product Owner (author: Accounting Domain Architecture) ·
> **Source:** [ED-05](../../EXPANSION_REGISTER.md) (Blueprint v2.0) ·
> **Related:** [INV-025](../../accounting/ACCOUNTING_INVARIANTS.md),
> [BR-052…BR-055](../../product/BUSINESS_RULES.md),
> G-29…G-31 golden postings ([../../accounting/JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7),
> v1.1 non-goal #1 (payroll/HR — now narrowed by ED-18),
> OQ-V2-1 ([../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md)), PHASE-029,
> umbrella record [product/DR-003](../product/DR-003-platform-expansion-v2.md)

## Context

v1.1 listed payroll as **non-goal #1** (SCOPE_AND_NON_GOALS). Comparative research shows
payroll — at least the financial part: salaries, deductions, loans, end-of-service — is
**table stakes** in the leading Arabic-market systems. Blueprint v2.0 moves payroll to
**planned scope at PHASE-029** with **financial scope only** (ED-05/ED-18): the module
posts money through the engine like every other module and explicitly does not become an
HR department.

The hazard is jurisdiction data: **GOSI-style social-insurance contribution rates and
EOS (end-of-service) legal scales are legal facts** that vary by country, contract type,
and year. The no-fabrication gate
([../../localization/compliance-matrix/README.md](../../localization/compliance-matrix/README.md))
forbids shipping them as product defaults. Payroll is also the most sensitive personal
data a company holds — salary data access must be tightly permissioned.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Financial payroll core, tenant-configured components (adopted)** | Employees, salary structures/components, monthly runs, employee loans, EOS provision — all money through runs; contribution/EOS rates tenant-configured | Closes the market gap honestly; engine-monopoly preserved; zero legal fabrication | Jurisdiction-specific automation absent until verified sources land (explicit open question) |
| **B. Full HR suite (attendance, leave, performance)** | Compete with HR platforms | Widest surface | Years of non-financial domain work (the underserved-market finding does **not** say SMEs lack HR suites); the market table-stakes finding is about the **financial** payroll |
| **C. Ship seeded jurisdiction rate tables (GOSI etc.)** | "Works out of the box" feel | Instant gratification | Fabricates legal rates; any stale/incorrect seeded rate becomes a compliance and trust liability — forbidden by the official-sources protocol |

## Decision

**Option A.** The `payroll` module ships at **PHASE-029** with **financial scope only**:

1. **In scope**: employees (registry), salary structures & components (allowances,
   deductions, employer contributions — FIXED / PERCENT_OF_BASIC / PERCENT_OF_GROSS calc),
   monthly **payroll runs**, **employee loans** (installment deduction), and the **EOS
   (end-of-service) provision**.
2. **Non-goals (unchanged)**: attendance, leave, performance management, recruitment,
   and HR operations — they remain excluded; adding any of them later requires a new
   decision record (ED-11 spirit, applied to HR).
3. **Jurisdiction contribution/EOS rates REQUIRE_VERIFICATION** per the
   official-sources protocol: **components are tenant-configured, and the platform ships
   zero fabricated rates** — no seeded GOSI percentage, no country EOS scale, until
   verified official sources exist behind a jurisdiction pack (OQ-V2-1 in
   [../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md)
   tracks this; BR-055: EOS accrual per tenant policy table).
4. **Payroll accounts post only via runs (BR-053 / INV-025)**: there are **no manual
   payroll journals**; a run (DRAFT → PENDING_APPROVAL → POSTED) posts G-29 (run:
   component expenses · net payable · third-party deductions payable), payout posts G-30,
   EOS settlement at termination posts G-31; posted runs are immutable, reversal-only
   (INV-025: totals equal Σ lines and net = gross − deductions exactly).
5. **Loans deduct per period with a cap** (BR-054: default ≤ 25% of net — PLACEHOLDER
   default, OQ-002 family); loan lines deduct inside runs, never as side journals.
6. **Sensitivity**: `payroll.employees.*` reads are restricted permissions in the
   authorization matrix (register §K) — payroll data is sensitivity-critical.

## Consequences

- Tables `employees`, `salary_structures`, `salary_components`, `payroll_runs`,
  `payroll_run_lines` (🔒), `employee_loans`, `employee_loan_lines` land at PHASE-029 per
  [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §C; feature keys `payroll.*`
  (8) per §D; reports `payroll.register`, `payroll.cost-summary`, `payroll.eos-provision`
  per §J.
- New CoA purposes `SALARIES_EXPENSE`, `SALARIES_PAYABLE`, `DEDUCTIONS_PAYABLE`,
  `EMPLOYER_CONTRIBUTIONS`, `EOS_PROVISION`, `EOS_PROVISION_EXPENSE` (register §E) are
  tenant-mapped before the first run.
- Mid-period structure changes create a **new structure version** (BR-052) — runs
  snapshot component values (`component_snapshot`), so posted history is reproducible.
- The v1.1 non-goal text is narrowed, not deleted: SCOPE_AND_NON_GOALS moves payroll from
  "non-goal #1" to planned **financial** scope per ED-18 — the HR-operations exclusion
  stays verbatim.
- Until jurisdiction tables are verified, onboarding templates may only pre-create
  **empty** component shells with documentation pointers — never rates.

## Revisit conditions

- Verified official sources for KSA GOSI/UAE/social-insurance scales land → a
  compliance-folder record may enable jurisdiction-specific **defaults** (tenant-configured
  remains the rule); zero rates ship before that.
- Design partners demand attendance-driven payroll → new product record re-scoping the
  boundary; expected to stay excluded per ED-05.
- EOS legal-scale disputes (per-country interpretation) → compliance record with sources;
  the provision math itself is accounting policy, unchanged.

## Approval

ACCEPTED 2026-10-28 — product owner, under the platform-expansion umbrella record
([product/DR-003](../product/DR-003-platform-expansion-v2.md)); the accounting domain owner
countersigns runs-only posting (BR-053/INV-025); the compliance reviewer countersigns the
zero-fabrication clause on contribution/EOS rates.
