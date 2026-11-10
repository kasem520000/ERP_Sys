# DR-003 — Platform Expansion v2.0: Full Financial Depth & Five Industry Templates

> **Status:** ACCEPTED · **Owner:** Product Owner · **Updated:** 2026-10-28 ·
> **Date:** opened 2026-10-28, accepted 2026-10-28 · **Approver:** Product Owner ·
> **Source:** [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) — Blueprint v2.0
> canonical spec (ED-01…ED-19) ·
> **Related:** [accounting/DR-002](../accounting/DR-002-fixed-assets.md),
> [accounting/DR-003](../accounting/DR-003-notes-and-installments.md),
> [accounting/DR-004](../accounting/DR-004-budgeting.md),
> [accounting/DR-005](../accounting/DR-005-payroll-scope.md),
> [accounting/DR-006](../accounting/DR-006-consolidation.md),
> [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md),
> MVP gate [PHASE-014](../../planning/MASTER_ROADMAP.md), GA gate PHASE-025, stages 9–11 (PHASE-026…034)

## Context

Comparative research (2026-10-28) against the leading Arabic-market ERP/accounting systems
— **قيود Qoyod, أودكس Odex, وفق Wafeq, Deexe, iCore, رايتو Raito** — shows that the v1.1
launch scope, while rigorous, is not the competitive depth those products already offer:

- **Fixed assets & depreciation, PDC cheques & promissory notes, payroll (financial scope),
  customer installments, budgeting, and multi-entity consolidation are table stakes** in
  that market — their absence is a stated disqualifier for mid-market buyers evaluating
  against local incumbents.
- **Hospitals, schools, and agriculture are underserved commercially** by those same
  systems: vertical operations software exists but is separate and expensive, while the
  financial/commercial layer (patient billing & insurance claims, tuition contracts &
  installments, crop-cycle costing) is exactly the layer this platform's core already
  supports well.

The product owner directs expansion to **full competitive depth** post-GA, on these
premises: the financial core (posting engine, invariants, tenant isolation) is complete at
GA (PHASE-025) and every expansion area reuses it — no new ledger, no new isolation model.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Stay on v1.1 scope indefinitely** | Ship GA scope; add areas only on customer demand | Smallest roadmap; no new commitment | Concedes the table-stakes list to local incumbents; disqualifies the platform from mid-market evaluations in its own market |
| **B. Full depth + deep-vertical operations** | Add the six financial areas **and** build HIS clinical, LMS academic, and agronomy operations | Widest surface | Years of vertical-domain work before any of it ships; contradicts the honest non-goals discipline (SCOPE_AND_NON_GOALS) and the underserved-commercial-layer finding; enormous support/maintenance liability |
| **C. Full financial depth + industry commercial shells** | Add the six financial areas (stages 9–11, PHASE-026…034) and five industry templates as **configuration-layer commercial shells** over existing modules | Closes every table-stakes gap; commercial shells reuse the proven core; vertical boundaries stay explicit and honest; template economics (no forks) | Roadmap extends by three stages post-GA; consolidation carries a small cross-tenant-read architecture cost (contained by ADR-0018) |

## Decision

**Option C** — the product owner directs expansion to full competitive depth, executed as:

1. **Stages 9–11 (PHASE-026…034)** per
   [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-01…ED-19: modules
   `fixed_assets` (026), `notes` + `installments` (027), `budgeting` (028), `payroll`
   financial scope (029), and `consolidation` (034); wholesale/electronics templates (030),
   healthcare (031), education (032), agriculture (033).
2. **Five new industry templates (ED-06…ED-09)** — `industry.wholesale`,
   `industry.electronics`, `industry.healthcare`, `industry.education`,
   `industry.agriculture` — as **COMMERCIAL SHELLS**: configuration + light extension over
   existing modules, never forks.
3. **Deep-vertical operations remain non-goals (ED-11)**: HIS clinical records, LMS
   academic operations, and precision agronomy are out of scope until a future decision
   record adds them; commercial shells ship first and say so explicitly.
4. **MVP (PHASE-014) and GA (PHASE-025) gates are unchanged (ED-01)**: expansion is
   post-GA, additive staging — the commercial launch path is never delayed by v2.0 work.
5. **Timeline length accepted**: the product owner accepts the extended post-GA runway
   (stages 9–11) as the cost of full competitive depth.

## Consequences

- The platform's module count grows 16 → 22 and template manifests 8 → 13; the roadmap
  carries phases PHASE-026…034 (25 → 34 phase documents) — all per the canonical register.
- Every new area posts through the existing engine and obeys the existing invariants;
  the register's §O safeguards (v1.1 untouched, RLS unchanged, honest documentation) bind
  every phase that implements this decision.
- Per-area accounting policy is pinned by the accounting decision records
  ([DR-002](../accounting/DR-002-fixed-assets.md) fixed assets,
  [DR-003](../accounting/DR-003-notes-and-installments.md) notes & installments,
  [DR-004](../accounting/DR-004-budgeting.md) budgeting,
  [DR-005](../accounting/DR-005-payroll-scope.md) payroll scope,
  [DR-006](../accounting/DR-006-consolidation.md) consolidation); consolidation's
  architecture is fixed by [ADR-0018](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md).
- New feature keys (`fixed_assets.*`, `notes.*`, `installments.*`, `budgeting.*`,
  `payroll.*`, `consolidation.*`) enter the entitlement pool; tier assignment remains an
  open pricing decision (OQ-002 / [DR-001](DR-001-pricing-tier-structure.md)) — no numeric
  entitlement claims are made here.
- Sales/marketing boundary: commercial shells may be sold as financial/commercial layers
  for those industries; no claim of clinical, academic, or agronomy capability is allowed
  (anti-fabrication rule CD-05).
- Honest non-goals persist: ED-11 defers deep-vertical operations, and reopening them
  requires a new product decision record, not a phase document.

## Approval requirements

- Product owner signature on the stage plan (PHASE-026…034, sequencing per the register's
  §B phase table) — recorded here as accepted 2026-10-28.
- Architecture owner counter-signature on the consolidation read-service grant
  (ADR-0018) and on the statement that stages 9–11 require no change to any v1.1 ADR.
- Competitive-research evidence (Qoyod, Odex, Wafeq, Deexe, iCore, Raito feature
  matrices, 2026-10-28) recorded in the research notes feeding
  [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) — the register is the
  canonical spec for this decision.
- Revisit trigger: a stage-9/10 module failing its phase acceptance criteria twice, or
  GA (PHASE-025) slipping more than one release — then re-open this record as an
  amendment rather than silently re-sequencing.

## References

- [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) — Blueprint v2.0 canonical
  register: ED-01…ED-19 decisions, §B phase table, §D feature keys, §L templates.
- [../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) — MVP gate
  PHASE-014, GA gate PHASE-025, stages 9–11.
- [../../architecture/ADR/ADR-0018-multi-entity-consolidation.md](../../architecture/ADR/ADR-0018-multi-entity-consolidation.md)
  — multi-entity consolidation architecture.
- [../accounting/README.md](../accounting/README.md) — accounting policy records
  DR-002…DR-006 executing this decision.
- [../../industries/README.md](../../industries/README.md) — industry template framework
  the five new shells extend.
- [DR-001-pricing-tier-structure.md](DR-001-pricing-tier-structure.md) — tier/entitlement
  matrix remains the governing open pricing record (OQ-002).
