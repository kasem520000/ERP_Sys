# Accounting Decision Records

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28

Accounting **policy defaults** that the product ships with — the choices tenants see in
onboarding and that industry templates inherit. Process and format: [../README.md](../README.md).
Approver: **product owner**, with the accounting domain owner as author/reviewer.

## Scope boundary (read first)

This folder decides *defaults and scope*, never *rules*:

- The [invariants](../../accounting/ACCOUNTING_INVARIANTS.md) are non-negotiable and are
  **not** decided here (INV-022: configuration cannot override accounting mathematics;
  invariant changes follow the invariants file's own maintenance protocol).
- Posting mechanics, journal rules, and the reversal-only correction model are
  architecture/spec decisions in [../../accounting/](../../accounting/) documents and
  ADRs — linking, not duplicating, them is this folder's job.
- What *does* belong here: costing-method default, fiscal-calendar conventions beyond
  the documented assumptions, depreciation/rounding policy defaults if/when introduced,
  and any accounting-behavior option exposed to tenants onboarding.

## Index

| Record | Title | Status | Notes |
|--------|-------|--------|-------|
| [DR-001-costing-method-default.md](DR-001-costing-method-default.md) | Costing method default (WAC, FIFO opt-in) | **ACCEPTED** 2026-10-27 | Formalizes assumption A-005; governs PHASE-010 |
| [DR-002-fixed-assets.md](DR-002-fixed-assets.md) | Fixed assets: register, run-only depreciation, NBV floor, revaluation reserve | **ACCEPTED** 2026-10-28 | Blueprint v2.0 (ED-02); governs PHASE-026; no fabricated jurisdiction depreciation rules |
| [DR-003-notes-and-installments.md](DR-003-notes-and-installments.md) | Notes & installments: PDC lifecycle, exact dishonor restoration, flat-fee plans | **ACCEPTED** 2026-10-28 | Blueprint v2.0 (ED-03); governs PHASE-027; terminates the `treasury.cheques` deferral chain; riba exclusion explicit |
| [DR-004-budgeting.md](DR-004-budgeting.md) | Budgeting: versioned statements, advisory controls, not ledger documents | **ACCEPTED** 2026-10-28 | Blueprint v2.0 (ED-04); governs PHASE-028; the ledger is never silently blocked |
| [DR-005-payroll-scope.md](DR-005-payroll-scope.md) | Payroll financial scope only; runs-only posting; zero fabricated rates | **ACCEPTED** 2026-10-28 | Blueprint v2.0 (ED-05); governs PHASE-029; HR ops remain non-goals; jurisdiction rates REQUIRE_VERIFICATION |
| [DR-006-consolidation.md](DR-006-consolidation.md) | Consolidation policy: read-only members, engine-posted eliminations | **ACCEPTED** 2026-10-28 | Blueprint v2.0 (ED-10); governs PHASE-034; policy side of [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md) |

## Inputs expected in records here

1. The linked assumption/ADR/accounting spec sections the default interacts with.
2. The tenant-facing consequence (what onboarding shows, what is changeable later, and at
   what cost — e.g., INV-017's dated-revaluation requirement for method switches).
3. Industry-template impact: which templates (if any) override the default and under
   which documented rule.

## Records expected here (open the record when the topic becomes real)

| Topic | Notes |
|-------|-------|
| Fiscal-calendar conventions beyond A-004 (e.g., a tenant-requested Hijri fiscal year variant) | Open only if customer evidence appears; isolated to the `accounting` module per A-004's consequence note |
| Depreciation policy defaults | Realized by [DR-002](DR-002-fixed-assets.md) — fixed assets enter planned scope at PHASE-026 (Blueprint v2.0, ED-18); further policy defaults follow amendments there |
| Rounding-difference posting policy refinements | Only if a jurisdiction pack requires a documented deviation from ADR-009 defaults (compliance folder would co-own) |
| Any proposal to expose a second costing default per industry template beyond [DR-001](DR-001-costing-method-default.md)'s rule | Amendment to DR-001 — template manifests are the only override path |
