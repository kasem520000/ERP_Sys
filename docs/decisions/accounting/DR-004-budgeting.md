# DR-004 — Budgeting: Versioned Statements, Advisory Controls, No Ledger Documents

> **Status:** ACCEPTED · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28 ·
> **Date:** opened 2026-10-28, accepted 2026-10-28 ·
> **Approver:** Product Owner (author: Accounting Domain Architecture) ·
> **Source:** [ED-04](../../EXPANSION_REGISTER.md) (Blueprint v2.0) ·
> **Related:** [BR-050…BR-051](../../product/BUSINESS_RULES.md),
> budget reports ([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §J),
> INV-022 (configuration cannot override accounting),
> PHASE-028, umbrella record [product/DR-003](../product/DR-003-platform-expansion-v2.md)

## Context

Budgeting is table stakes in the leading Arabic-market systems (الموازنة التقديرية —
register preamble research) and is the natural next layer over the accounting core the
platform already has: fiscal years/periods, accounts, cost centers, projects, and
branches. Blueprint v2.0 adds the `budgeting` module at **PHASE-028** (ED-04).

The central design question is **what a budget is**: a budget is *plan data compared
against* the ledger — not a ledger document. If budgets could post journals, the platform
would acquire a second, competing notion of financial truth, and INV-022's "configuration
and planning can never alter accounting mathematics" would be eroded from a new direction.
A second question is enforcement: hard budget blocks on posting would make
`budgeting.controls` a silent ledger gatekeeper — a behavior the posting engine's
single-writer discipline ([ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md))
was built to avoid.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Planning artifact, advisory controls (adopted)** | Budgets are versioned documents over accounts/cost centers/projects/branches; comparison reports read the GL; controls warn by default | Zero ledger contamination; honest variance reporting; the close process is never hostage to a budget | Tenants wanting hard enforcement must opt in explicitly (per-policy) |
| **B. Budgets as ledger documents with journal postings** | Budget journals post to memo/budgetary ledgers | "Complete" budgetary accounting story | Second financial truth beside the journal; reconciliation doubles; violates the derived-artifact principle the platform uses everywhere (consolidation reports follow the same logic — ADR-0018) |
| **C. Hard-block controls by default** | Postings over budget are rejected unless overridden | Strongest spend discipline | A planning tool silently blocking the ledger is an operational foot-gun at close time; wrong for the SME segment; contradicts advisory-first market behavior |

## Decision

**Option A.** The `budgeting` module ships at **PHASE-028** with this policy:

1. **Budgets are NOT ledger documents — no journals, ever.** A budget is a versioned
   statement of planned amounts per (fiscal period, account, optional cost center/project/
   branch). It posts nothing; it is read against the GL for variance.
2. **One ACTIVE budget version per (fiscal year, scope)** (BR-050): scopes are
   `ACCOUNTS`, `COST_CENTERS`, `PROJECTS`, `BRANCHES`; revisions **supersede**, never edit
   — status path DRAFT → PENDING_APPROVAL → ACTIVE → REVISED → CLOSED with
   `supersedes_id` linkage.
3. **Controls are advisory by default (BR-051)**: over-budget postings generate a warning
   and are recorded in variance reporting; **the ledger is never silently blocked**. A
   tenant may explicitly enable hard-block policy per scope — and even then the block
   happens at document approval with a visible, auditable reason, never as an engine
   side-effect.

## Consequences

- Tables `budgets`, `budget_lines` land at PHASE-028 per
  [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §C; feature keys
  `budgeting.*` (6) per §D; reports `budgeting.budget-vs-actual`,
  `budgeting.variance-analysis` per §J — both read posted ledger data (report-provenance
  rule: no source of truth → no report).
- **No new invariants**: budgeting touches no ledger table, so it adds none; INV-022
  covers the boundary (planning data can never alter journal math).
- The posting engine is untouched: controls live at the approval/validation layer of
  business documents, not inside `PostingEngine.post`.
- Approval workflow uses the standard document-lifecycle states; `budgeting.budgets.approve`
  is an approval-gated, SoD-listed permission (register §K).
- If a future tenant class demands fund/budgetary accounting (governmental encumbrance),
  that is a new decision record with a dedicated memo-ledger design — not an amendment
  here.

## Revisit conditions

- Design partners show advisory controls are uniformly ignored → tighten **defaults** via
  an amendment (hard-block opt-in stays per-policy and per-scope).
- A governmental bidding requirement demands encumbrance accounting → new record (see
  above); out of scope for the SME core.
- Evidence that PROJECTS-scope budgets double-count against project budgeting inside
  manufacturing/CRM → reconcile the boundaries in an amendment.

## Approval

ACCEPTED 2026-10-28 — product owner, under the platform-expansion umbrella record
([product/DR-003](../product/DR-003-platform-expansion-v2.md)); the accounting domain
owner countersigns the "budgets are not ledger documents" boundary as permanent policy.
