# AGENT_START_HERE — Authoritative Entry Point for AI Coding Agents

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-11-10 (Blueprint v3.0 program added)

You are an AI coding agent about to implement a phase of the Universal Business ERP
Platform. This document is your single entry point. Follow the 15 steps below **in
order**. Do not skip steps; do not improvise shortcuts. The companion rules live in
[IMPLEMENTATION_PROTOCOL.md](IMPLEMENTATION_PROTOCOL.md).

## Context in one paragraph

The repository is a **documentation-driven** project: `docs/` is the authoritative
blueprint (**65-phase roadmap — v1.1 stages 1–8 + v2.0 stages 9–11 in
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) + v3.0 stages 12–15 in
[../planning/COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md)** —
stages 1–34 are ALL COMPLETE; stages 12–15 (PHASE-035…065) are the
Full-ERP completion program — PHASE-035 and PHASE-036 delivered 2026-11-10,
037…065
planned), and implementation happens strictly
phase-by-phase. The Platform is a multi-tenant SaaS ERP for MENA/GCC — Arabic-first
RTL, double-entry accounting with a centralized posting engine, PostgreSQL with
Row-Level Security, modular monolith (NestJS) + Next.js web + Tauri desktop + Expo
Android. The architecture is decided in 18 ADRs; do not relitigate them without the
change-control process. **If your requested phase is ≥ 035**, you MUST also read
[../planning/COMPLETENESS_ROADMAP.md](../planning/COMPLETENESS_ROADMAP.md) (the v3.0
index + gap→phase mapping + the Arabic usage protocol §0) — every v3.0 phase ships
under the CR-36 discipline gates and is delivered as the per-phase archive
`ERP_PLATFORM_PHASE0NN.zip` (OA-07).

## The 15-step protocol (mandatory)

1. **Inspect the repository and current Git state.** `git status`, `git log --oneline -20`,
   top-level layout. Note uncommitted changes (there should be none; if any exist, stop
   and report).
2. **Read the project instructions:** root `AGENTS.md`, this file,
   [IMPLEMENTATION_PROTOCOL.md](IMPLEMENTATION_PROTOCOL.md).
3. **Read the master roadmap:** [../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md).
4. **Read the phase dependency graph:** [../planning/PHASE_DEPENDENCY_GRAPH.md](../planning/PHASE_DEPENDENCY_GRAPH.md).
5. **Read current state and implementation status:**
   [CURRENT_STATE.md](CURRENT_STATE.md), [../planning/IMPLEMENTATION_STATUS.md](../planning/IMPLEMENTATION_STATUS.md),
   [NEXT_ACTION.md](NEXT_ACTION.md).
6. **Read the requested phase document:**
   [../implementation/phases/PHASE-0NN.md](../implementation/phases/PHASE-001.md).
7. **Read all prerequisite phase completion reports** (if prerequisites are COMPLETE):
   `../implementation/phases/reports/PHASE-XXX-COMPLETION.md`. If a report is missing
   for a phase marked COMPLETE, treat the status as suspect and report it.
8. **Inspect the actual code, database schema, migrations, and tests.** Reconcile what
   the docs claim against what exists: run the test suite, check `apps/api/migrations/`,
   verify the schema docs' sync claims. **Never assume a phase is complete merely
   because the roadmap says so.**
9. **Reconcile documentation with implementation before making changes.** If you find
   contradictions (docs say X, code says Y), document them and propose the resolution
   in your report — do not silently pick a side.
10. **Identify missing prerequisites or contradictions.** If prerequisites for your
    requested phase are incomplete or failed verification, **STOP**: explain the gap and
    propose the safest resolution (usually: implement the prerequisite phase first, or
    a narrowly-scoped repair under a decision record). Never implement a later phase
    whose foundation is missing; never silently implement the prerequisite yourself.
11. **Implement only the requested phase.** Follow its section 5 task order, its scope
    boundaries (§2, including the explicit out-of-scope list), and its acceptance
    criteria (§6). No future-phase features; no refactoring tangents.
12. **Run the full verification gate:** typecheck, lint (incl. module-boundary rules),
    unit + integration + applicable E2E tests, migrations (fresh + regression), the
    tenant-isolation attack suite for any new tenant-owned tables, the docs validation
    script, and security checks the phase requires. All must pass.
13. **Update documentation and implementation status:** the docs your phase's §8
    "Documentation updates required" lists — at minimum
    [../planning/IMPLEMENTATION_STATUS.md](../planning/IMPLEMENTATION_STATUS.md),
    [CURRENT_STATE.md](CURRENT_STATE.md), [NEXT_ACTION.md](NEXT_ACTION.md), affected
    database/entity/ERD docs, and [CHANGELOG.md](CHANGELOG.md).
14. **Produce a completion report with evidence** at
    `../implementation/phases/reports/PHASE-NNN-COMPLETION.md` using the
    [template](../implementation/templates/COMPLETION_REPORT_TEMPLATE.md). Evidence
    means command outputs, test names/results, CI links — not adjectives. **Never
    report success when critical tests failed or were skipped without explicit
    justification.**
15. **Identify the next eligible phase** in your report — but **do not implement it**.

## Hard prohibitions

- Do not silently rewrite completed phases or alter foundational architecture
  (ADR-bound decisions). Any architectural change requires: reason, impact analysis,
  migration plan, affected phases, an updated ADR, and regression tests — see
  [IMPLEMENTATION_PROTOCOL.md](IMPLEMENTATION_PROTOCOL.md) §Architecture changes.
- Do not mark anything COMPLETE without evidence (directive §1.10–1.11).
- Do not fabricate tax rates, legal rules, or official API behavior — verify against
  [../localization/compliance-matrix/](../localization/compliance-matrix/README.md)
  sources (directive §1.12–1.13).
- Do not bypass tenant isolation, the posting engine, or the invariants
  (INV-001…INV-026 in [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)).
- Do not use last-write-wins for any financial/stock/receipt/journal data.

## If the user requests a later phase while prerequisites are incomplete

Explain exactly which prerequisites are missing and the evidence, then propose the
safest resolution: (a) implement the missing prerequisite phase(s) in order, or
(b) a documented, minimal repair path under a decision record. Never fast-forward.

## Reading map (quick links)

| Need | Document |
|------|----------|
| What to build in this phase | [../implementation/phases/](../implementation/phases/PHASE-001.md) |
| What v2.0 adds post-GA (stages 9–11) | [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) — canonical Blueprint v2.0 expansion register (ED-01…ED-19: PHASE-026…034, six depth modules, BR-041…056, INV-023…026, five templates) |
| Why an architectural choice | [../architecture/ARCHITECTURE_DECISIONS.md](../architecture/ARCHITECTURE_DECISIONS.md) + `ADR/` |
| Business rules & feature keys | [../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md), [../product/FEATURE_CATALOG.md](../product/FEATURE_CATALOG.md) |
| Accounting correctness | [../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md), [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) |
| Database rules | [../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md), [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) |
| API rules | [../api/API_CONVENTIONS.md](../api/API_CONVENTIONS.md), [../api/ERROR_MODEL.md](../api/ERROR_MODEL.md) |
| UI rules | [../ui/DESIGN_TOKENS.md](../ui/DESIGN_TOKENS.md), [../ui/COMPONENT_CATALOG.md](../ui/COMPONENT_CATALOG.md) |
| Testing obligations | [../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) |
| Security obligations | [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md), [../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) |
