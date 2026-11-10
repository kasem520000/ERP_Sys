# Documentation Index

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28

This is the authoritative documentation set for the Universal Business ERP Platform
("the Platform"). Documentation is the product blueprint: implementation phases consume
it, and implementation evidence updates it. All documents are written in English; the
product itself is Arabic-first with full English support.

**Document header convention.** Every document starts with a status line:
`> **Status:** STABLE | DRAFT | PROPOSED`. `STABLE` documents may only change through the
change-control process in [handoff/IMPLEMENTATION_PROTOCOL.md](handoff/IMPLEMENTATION_PROTOCOL.md).

## Reading order (for a new engineer or AI agent)

0. **Consolidated authoritative layer (2026-10-28):** start at
   [ARCHITECTURE_BASELINE.md](ARCHITECTURE_BASELINE.md) — the single authoritative summary of
   the selected architecture — then [ARCHITECTURE_DECISION_REGISTER.md](ARCHITECTURE_DECISION_REGISTER.md)
   and the domain summaries below. These documents consolidate the baseline and absorb the
   audited best of the competing plans; traceability lives in
   [CONSOLIDATION_REGISTER.md](CONSOLIDATION_REGISTER.md) and verification results in
   [CONSOLIDATION_VALIDATION_REPORT.md](CONSOLIDATION_VALIDATION_REPORT.md).
1. [PROJECT_VISION.md](PROJECT_VISION.md) — what we are building and for whom.
2. [SCOPE_AND_NON_GOALS.md](SCOPE_AND_NON_GOALS.md) — what we are explicitly NOT building.
3. [GLOSSARY.md](GLOSSARY.md) — controlled vocabulary (English ↔ Arabic). All other documents use these terms.
4. [architecture/SYSTEM_OVERVIEW.md](architecture/SYSTEM_OVERVIEW.md) and [architecture/ARCHITECTURE_DECISIONS.md](architecture/ARCHITECTURE_DECISIONS.md).
5. [planning/MASTER_ROADMAP.md](planning/MASTER_ROADMAP.md) — the 34 phases (stages 1–8 per v1.1; stages 9–11 per [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md)).
6. [handoff/AGENT_START_HERE.md](handoff/AGENT_START_HERE.md) — how to execute a phase.

## Consolidated authoritative documents (v2 layer)

| Document | Scope |
|----------|-------|
| [ARCHITECTURE_BASELINE.md](ARCHITECTURE_BASELINE.md) | Authoritative architecture summary, stack, module map, invariants |
| [ARCHITECTURE_DECISION_REGISTER.md](ARCHITECTURE_DECISION_REGISTER.md) | Master decision register (ADR index + consolidation decisions CD-xxx) |
| [CONSOLIDATION_REGISTER.md](CONSOLIDATION_REGISTER.md) | Dispositions of every meaningful idea from the source plans |
| [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md) | Blueprint v2.0 expansion register — canonical spec for post-GA stages 9–11 (PHASE-026…034: ED-01…ED-19, six depth modules, five industry templates) |
| [ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md) | Unresolved decisions, assumptions, risks |
| [CONSOLIDATION_VALIDATION_REPORT.md](CONSOLIDATION_VALIDATION_REPORT.md) | Defect log DEF-xxx, traceability matrix, validation evidence |
| [database/DATABASE_ARCHITECTURE.md](database/DATABASE_ARCHITECTURE.md) | Database principles, tenant boundaries, precision, migrations |
| [accounting/ACCOUNTING_ENGINE_SPECIFICATION.md](accounting/ACCOUNTING_ENGINE_SPECIFICATION.md) | Posting rules, journal invariants, lifecycle, reconciliation |
| [security/SECURITY_AND_TENANT_ISOLATION.md](security/SECURITY_AND_TENANT_ISOLATION.md) | Authorization, RLS, tenant context, privileged paths, security tests |
| [localization/REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE.md](localization/REGIONAL_TAX_AND_COMPLIANCE_ARCHITECTURE.md) | Country packs, tax engine boundaries, e-invoicing |
| [industries/INDUSTRY_MODULE_ARCHITECTURE.md](industries/INDUSTRY_MODULE_ARCHITECTURE.md) | Core vs optional modules, industry templates |
| [ui/UNIFIED_UI_DESIGN_SYSTEM.md](ui/UNIFIED_UI_DESIGN_SYSTEM.md) | Shared design system across web/desktop/Android |
| [reporting/REPORTING_AND_DOCUMENT_ENGINE.md](reporting/REPORTING_AND_DOCUMENT_ENGINE.md) | Reports, printing, document generation, reconciliation |
| [offline/OFFLINE_AND_SYNC_ARCHITECTURE.md](offline/OFFLINE_AND_SYNC_ARCHITECTURE.md) | Platforms, local storage, sync, conflict resolution |
| [planning/IMPLEMENTATION_ROADMAP.md](planning/IMPLEMENTATION_ROADMAP.md) | Consolidated roadmap with effort bands and deltas (34 phases: 25 v1.1 + v2.0 stages 9–11 per [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md)) |

These documents **summarize and bind**; the detailed domain documents listed below remain
the normative source for their scope. Where a consolidated document and a detail document
conflict without a recorded DEF/CD correction, file a defect — do not silently pick one.

## Directory responsibilities

| Directory | Responsibility | Key documents |
|-----------|----------------|---------------|
| `architecture/` | System structure, ADRs, module boundaries, dependency rules, data flow, security/multi-tenancy/deployment/observability architecture | `SYSTEM_OVERVIEW.md`, `ADR/` (18 records) |
| `planning/` | Roadmap (34 phases), phase dependency graph, acceptance criteria, implementation status, release strategy, risk register | `MASTER_ROADMAP.md` |
| `database/` | PostgreSQL conventions, entity catalog, data dictionary, ERDs, tenant isolation, migration & backup strategy | `DATABASE_CONVENTIONS.md`, `ENTITY_CATALOG.md` |
| `product/` | Personas, journeys, workflows, business rules, feature catalog, industry catalog (13 templates), subscriptions & entitlements, configuration engine | `FEATURE_CATALOG.md`, `CONFIGURATION_ENGINE.md` |
| `accounting/` | Double-entry core: principles, chart of accounts, posting engine, document lifecycle, journal rules, AR/AP, inventory accounting, period closing, reconciliation, invariants | `POSTING_ENGINE.md`, `ACCOUNTING_INVARIANTS.md` |
| `industries/` | Industry template manifests, capability matrix, industry workflows, industry report catalog | `templates/`, `capabilities/CAPABILITY_MATRIX.md` |
| `localization/` | Localization architecture, RTL/LTR rules, currency & precision, country packs, tax engine, e-invoicing architecture, per-country compliance matrices, official sources | `TAX_ENGINE.md`, `E_INVOICING_ARCHITECTURE.md`, `compliance-matrix/` |
| `api/` | API conventions, authentication, error model, idempotency, versioning, OpenAPI strategy, integration adapters | `API_CONVENTIONS.md` |
| `ui/` | Design principles, tokens, design system, component catalog, page archetypes, navigation, RTL design rules, accessibility, motion, visual testing | `DESIGN_TOKENS.md`, `COMPONENT_CATALOG.md` |
| `reporting/` | Reporting architecture, report contract, report catalog, financial report rules, printing & export, report reconciliation | `REPORT_CONTRACT.md` |
| `offline/` | Offline architecture, local database, sync protocol, conflict resolution, idempotency & retries, device management, capabilities matrix, failure recovery | `SYNC_PROTOCOL.md` |
| `security/` | Threat model, authorization matrix, data protection, secrets management, security test plan, incident response | `THREAT_MODEL.md`, `AUTHORIZATION_MATRIX.md` |
| `testing/` | Test strategy and per-domain test plans (accounting, tenant isolation, sync, regression, performance) | `TEST_STRATEGY.md` |
| `operations/` | Development setup, environments, CI/CD, deployment, backup/restore runbook, disaster recovery, monitoring, troubleshooting | `BACKUP_RESTORE_RUNBOOK.md` |
| `implementation/` | Phase documents (29 mandatory sections each) and templates (phase, completion report, code review) | `phases/PHASE-001.md` … `PHASE-034.md` (026–034 per [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md)) |
| `decisions/` | Decision records requiring product-owner approval, grouped by domain (product, technical, accounting, compliance) | `product/`, `technical/`, `accounting/`, `compliance/` |
| `handoff/` | Agent entry point, implementation protocol, current state, next action, changelog, blueprint validation report | `AGENT_START_HERE.md` |

## Cross-reference rules

1. Link to documents with relative Markdown links (e.g., `../accounting/POSTING_ENGINE.md`).
2. Phases are referenced as `PHASE-001` … `PHASE-034` (three digits, hyphenated).
3. Architecture decisions are referenced as `ADR-0001` … `ADR-0018`.
4. Accounting invariants are referenced as `INV-001` … (see `accounting/ACCOUNTING_INVARIANTS.md`).
5. Business rules are referenced as `BR-xxx` (see `product/BUSINESS_RULES.md`).
6. Feature keys follow `module.feature_name` (see `product/FEATURE_CATALOG.md`).
7. Requirements are referenced as `FR-<AREA>-nnn` (see `PRODUCT_REQUIREMENTS.md`).
8. Risks are referenced as `RISK-nnn` (see `planning/RISK_REGISTER.md`).

## Change control

Documentation changes that affect architecture, accounting rules, security, compliance,
or phase scope require an ADR or decision record plus a `CHANGELOG.md` entry. See
[handoff/IMPLEMENTATION_PROTOCOL.md](handoff/IMPLEMENTATION_PROTOCOL.md).
