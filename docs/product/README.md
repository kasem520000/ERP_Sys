# Product Documentation

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-10-27

Product-level specification for the Platform: who it serves, what it does, what rules
govern behavior, how capabilities are packaged and configured. This directory is the
product truth that [../planning/](../planning/MASTER_ROADMAP.md) phases implement and
[../architecture/](../architecture/MODULE_BOUNDARIES.md) modules enforce. Terminology is
controlled by [../GLOSSARY.md](../GLOSSARY.md); requirements baseline is
[../PRODUCT_REQUIREMENTS.md](../PRODUCT_REQUIREMENTS.md).

## Reading order

1. **[USER_PERSONAS.md](USER_PERSONAS.md)** — the nine people we build for; everything else
   traces back to them.
2. **[USER_JOURNEYS.md](USER_JOURNEYS.md)** — concrete step-by-step flows (the "storyboard").
3. **[BUSINESS_WORKFLOWS.md](BUSINESS_WORKFLOWS.md)** — canonical operational workflows as
   flowcharts (the "choreography" — states, postings, failure exits).
4. **[BUSINESS_RULES.md](BUSINESS_RULES.md)** — the numbered rule catalog (BR-001…) with
   defaults and policy keys.
5. **[FEATURE_CATALOG.md](FEATURE_CATALOG.md)** — the canonical feature registry
   (`module.feature_name` keys) consumed by entitlements and phases.
6. **[INDUSTRY_CATALOG.md](INDUSTRY_CATALOG.md)** — the eight industry templates and what
   each emphasizes.
7. **[SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md)** — plans,
   limits, entitlement resolution, and lifecycle (trial/suspend/downgrade).
8. **[CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md)** — the ten-layer configuration
   resolution architecture (read before touching anything config-shaped).

New engineers should read 1–4 for *why*; 5–8 for *what* and *how it's packaged*.

## Document map

| Document | Answers | Key artifacts | Status |
|---|---|---|---|
| [USER_PERSONAS.md](USER_PERSONAS.md) | Who uses the Platform and what do they need? | Personas P-01…P-09, persona→role→screens matrix | STABLE |
| [USER_JOURNEYS.md](USER_JOURNEYS.md) | How does real work flow end-to-end? | Journeys A–H with steps, error branches, audit events, phases | STABLE |
| [BUSINESS_WORKFLOWS.md](BUSINESS_WORKFLOWS.md) | What are the canonical document flows? | 9 Mermaid workflows + postings + failure exits | STABLE |
| [BUSINESS_RULES.md](BUSINESS_RULES.md) | Which rules govern configurable behavior? | BR-001…BR-040 with enforcement points and policy keys | STABLE |
| [FEATURE_CATALOG.md](FEATURE_CATALOG.md) | What features exist and how are they keyed? | ~120 feature keys across 16 modules, naming rules, maintenance protocol | STABLE |
| [INDUSTRY_CATALOG.md](INDUSTRY_CATALOG.md) | What does each industry template include? | 8 templates (`industry.*`), phases, manifest pointers | STABLE |
| [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md) | How do plans, limits, and entitlements work? | Plan matrix (PLACEHOLDER pricing per [OQ-002](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)), pipeline, limit behaviors | STABLE |
| [CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) | How does configuration resolve safely? | 10 layers, resolution algorithm, schema, safety rules, invalidation events | STABLE |

## Cross-reference conventions

1. **Feature keys** — `module.feature_name` — defined only in
   [FEATURE_CATALOG.md](FEATURE_CATALOG.md); referenced by plans
   ([SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md)), templates
   ([INDUSTRY_CATALOG.md](INDUSTRY_CATALOG.md)), dependency closure
   ([CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) §7), and phase scope tables.
2. **Business rules** — `BR-xxx` — defined only in [BUSINESS_RULES.md](BUSINESS_RULES.md);
   referenced by journeys, workflows, and phase acceptance criteria. Each rule names its
   enforcement module/permission and its tenant policy key.
3. **Personas** — `P-nn` — defined only in [USER_PERSONAS.md](USER_PERSONAS.md); journeys
   name actors by persona id; UX decisions cite personas.
4. **Invariants** — `INV-xxx` — defined in
   [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md); product
   docs cite them as hard boundaries (configuration can never override them — INV-022).
5. **Phases** — `PHASE-001`…`PHASE-025` — indexed in
   [../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md); product docs state which
   phase first delivers each capability, never the reverse (phases own delivery dates).
6. **Open decisions** — `OQ-nnn` — tracked in
   [../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md); wherever a
   number or policy depends on one (e.g., pricing), the doc marks it PLACEHOLDER and cites
   the OQ rather than inventing a decision.

## Change control

These documents are STABLE: changes that alter feature keys, rules (BR-xxx), plan mechanics,
or the ten-layer configuration model require a decision record under
[../decisions/](../decisions/) plus a `CHANGELOG.md` entry, following the blueprint's
change-control process. Additive clarifications (examples, links, formatting) follow normal
review. Any change that conflicts with an accounting invariant or an authorization control
is rejected by definition — those live in
[../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) and the
security architecture, not in product configuration.
