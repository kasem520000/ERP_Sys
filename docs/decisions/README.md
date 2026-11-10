# Decision Records

> **Status:** STABLE · **Owner:** Product Owner & Platform Architecture · **Updated:** 2026-11-06

Decision records (DRs) capture **product, accounting, compliance, and operational**
decisions that require explicit product-owner approval. They are the formal resolution
path for every open question in
[../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md): when a
question is decided, the record lands here, and the assumption/question file is updated
to point at it.

## 1. What belongs here vs ADRs

| | ADRs — [../architecture/ADR/](../architecture/ADR/) | Decision records — this directory |
|--|------------------------------------|------------------------------------|
| Subject | Technical **architecture**: structure, frameworks, data representation, patterns | **Business/commercial/policy**: pricing, providers, jurisdiction scope, accounting policy defaults, operational vendor choices |
| Question shape | "How do we build it?" | "What do we commit to as a product/company?" |
| Approver | Architecture owner (with product consultation when scope-impacting) | Product owner (with compliance reviewer for `compliance/`, architecture owner counter-sign when technical impact exists) |
| Lifecycle | [../architecture/ARCHITECTURE_DECISIONS.md](../architecture/ARCHITECTURE_DECISIONS.md) | This README + per-folder indexes |

A decision that changes **both** (e.g., a jurisdiction scope change that alters roadmap
ordering) produces a decision record **and** references/updates the affected ADRs and
phase documents. No decision record may weaken an accounting invariant — invariant changes
follow their own protocol ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) §Maintenance).

## 2. Directory layout

| Folder | Scope | Records |
|--------|-------|---------|
| [product/](product/README.md) | Pricing, packaging, payment providers, product-scope commitments | DR-001 (pricing tiers, OPEN), DR-002 (payment provider, OPEN), DR-003 (platform expansion v2.0, ACCEPTED) |
| [technical/](technical/README.md) | Operational-technical choices (vendors/tools) that do not change architecture — architecture decisions default to ADRs | DR-003 (observability vendors, OPEN) |
| [accounting/](accounting/README.md) | Accounting policy defaults (costing, period conventions, financial-depth module policies) | DR-001 (costing method default, ACCEPTED), DR-002 (fixed assets, ACCEPTED), DR-003 (notes & installments, ACCEPTED), DR-004 (budgeting, ACCEPTED), DR-005 (payroll scope, ACCEPTED), DR-006 (consolidation, ACCEPTED) |
| [compliance/](compliance/README.md) | Jurisdiction scope and timing (e-invoicing, tax reporting) | DR-001 (ZATCA scope/timing, OPEN), DR-002 (Yemen scope, OPEN), DR-003 (Egypt ETA scope, OPEN — draft, DEFERRED recommendation) |
| [security/](security/README.md) | Security-program commitments (disclosure/bounty programs, assurance cadences) | DR-P25-01 (bug bounty, PROPOSED — post-GA slot) |

Numbering: `DR-NNN` **per folder**; records are referenced folder-qualified
(`product/DR-001`) to stay unambiguous across folders.

**Post-GA pointer stubs (`DR-P25-NN`, PHASE-025 T14)** live in their subject folders
(security/product/compliance/technical) — each is a filed, indexed owning slot for a
deliberately-open GA item (bug bounty, support SLA, personal payments, ETA/UAE
follow-ups, iOS, the OTel exporter swap, the report-run quota): context + options +
recommendation lean + **trigger + owner**, status PROPOSED — per the phase's "no vague
aspirations" rule. Same mandatory format; superseded only by a new record.

Phase-scoped **implementation-deviation records** (`DR-<phase>-NN`) live at this
directory's root — they record a shipped deviation from a phase's binding constraints
(e.g. [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §11) that a later phase
must reconcile: [DR-016-01-pos-web-outbox-bridge.md](DR-016-01-pos-web-outbox-bridge.md),
[DR-016-02-card-receivable-mapping.md](DR-016-02-card-receivable-mapping.md),
[DR-016-03-pos-device-transport.md](DR-016-03-pos-device-transport.md) (PHASE-016;
reconciled in PHASE-020/021). Same mandatory format as folder records; numbered per
phase and superseded only by a new record.

## 3. Record format (mandatory)

```markdown
# DR-NNN — <short title>

> **Status:** OPEN | ACCEPTED | REJECTED | SUPERSEDED (by <folder>/DR-NNN) ·
> **Date:** <YYYY-MM-DD (opened / decided)> · **Approver:** <role/name>

## Context            — the forces in play; linked OQ/assumption/ADR IDs
## Options            — table of realistic options with consequences
## Recommendation     — the recommended option and why (only in OPEN records)
## Decision           — (ACCEPTED records) what was decided, exactly
## Consequences       — what becomes true/required after deciding
## Approval requirements — who must sign, what evidence must accompany the signature
```

Rules: no record without an **Options** section (decisions without alternatives are not
decisions); status changes never rewrite history — a changed decision **supersedes** with
a new record linking the old; compliance records must cite **official sources** or remain
OPEN (the no-fabrication gate, the agent hard rules ([../handoff/AGENT_START_HERE.md](../handoff/AGENT_START_HERE.md)).

## 4. Process

1. **Open**: any stakeholder files a record with status OPEN (context + options +
   recommendation). The linked OQ in
   [../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) gains a
   `→ <folder>/DR-NNN` pointer.
2. **Review**: discussion happens on the record's PR; affected documents are listed in the
   record (they will be edited in the same change or a linked one).
3. **Decide**: approver flips status to ACCEPTED (or REJECTED with rationale kept —
   rejected records are still history); **Date** updated; decision + consequences sections
   finalized.
4. **Propagate**: update (a) the OQ/assumption file, (b) affected phase/area documents,
   (c) `docs/handoff/CHANGELOG.md`, (d) [../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md)
   if a risk's mitigation changed. Records affecting phase scope trigger the
   cross-document validation checklist in `docs/handoff/VALIDATION_REPORT.md`.
5. **Deadline discipline**: a record whose decision deadline (e.g., "before PHASE-014")
   passes without a decision escalates to the product owner as a schedule risk — the
   blueprint's provisional assumption keeps governing until then
   ([../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) preamble).

## 5. Current open list

Every open question OQ-001…OQ-010 maps to a record here or to a record **to be opened**.
Open record status:

| Source | Topic | Record | Status |
|--------|-------|--------|--------|
| OQ-001 | Product branding (legal entity name, domain) | *(to be opened under `product/` — blocking only marketing surfaces; placeholder "the Platform" governs)* | Not yet opened |
| OQ-002 | Pricing tiers & entitlement matrix | [product/DR-001-pricing-tier-structure.md](product/DR-001-pricing-tier-structure.md) | OPEN — decide before PHASE-014 |
| OQ-003 | Payment provider selection | [product/DR-002-payment-provider-selection.md](product/DR-002-payment-provider-selection.md) | OPEN — decide before PHASE-014 |
| OQ-004 | ZATCA integration scope & timing | [compliance/DR-001-zatca-scope-and-timing.md](compliance/DR-001-zatca-scope-and-timing.md) | OPEN — decide before PHASE-023 planning |
| OQ-005 | Yemen sales-tax filing formats at GA | [compliance/DR-002-yemen-scope.md](compliance/DR-002-yemen-scope.md) | OPEN — decide before PHASE-023 evaluation |
| OQ-006 | Manufacturing depth at GA (MRP vs execution+costing) | *(to be opened under `product/` — assumption A-006 governs until then)* | Not yet opened |
| OQ-007 | Personal-account app online payments at GA | *(to be opened under `product/` — deferred per recommendation)* | Not yet opened |
| OQ-008 | Support SLA commitments per plan | *(to be opened under `product/` after PHASE-025 readiness review)* | Not yet opened |
| OQ-009 | Data-retention window after offboarding | [DR-024-02](DR-024-02-privacy-retention-oq009.md) — BLOCKED-EXTERNAL (legal counsel unreachable from the delivery environment); the 90-day working assumption stays in force with named constants | Opened PHASE-024 |
| OQ-010 | Arabic-only support channel at MVP | *(to be opened under `product/` — bilingual processes documented meanwhile)* | Not yet opened |
| — | Observability vendors (error tracking + log sink) | [technical/DR-003-observability-vendors.md](technical/DR-003-observability-vendors.md) | OPEN — decide at staging provisioning |
| A-005 | Costing method default (WAC/FIFO) | [accounting/DR-001-costing-method-default.md](accounting/DR-001-costing-method-default.md) | **ACCEPTED** 2026-10-27 |

When a "to be opened" item becomes urgent, copy its context from the OQ table — do not
paraphrase from memory.
- [DR-024-01 — WebAuthn/passkeys: DEFER post-GA](DR-024-01-webauthn-passkeys.md) (PHASE-024 T4; ADR-0015 §4's roadmap decision recorded either way)
- [DR-024-02 — OQ-009 privacy/retention: BLOCKED-EXTERNAL, working assumption in force](DR-024-02-privacy-retention-oq009.md) (PHASE-024 T10; the 90-day placeholder keeps its named constants until the legal review lands)

**Post-GA pointer stubs (PHASE-025 T14 — filed 2026-11-06 at the GA gate; every open GA
item has an owning slot, status PROPOSED with trigger + owner):**

- [security/DR-P25-01 — Bug-bounty launch](security/DR-P25-01-bug-bounty.md) (disclosure-policy linkage from PHASE-024 T14; scope tiers + reward model open; trigger: post-GA review)
- [product/DR-P25-02 — Support SLA (OQ-008)](product/DR-P25-02-support-sla.md) (response/resolution targets per severity vs the MONITORING §4 on-call reality; trigger: post-GA review with staffing known)
- [product/DR-P25-03 — Personal-account payments (OQ-007)](product/DR-P25-03-personal-payments.md) (read-only posture governs; what changes if personal accounts open; trigger: demand + DR-002 resolution)
- [compliance/DR-P25-04 — Egypt ETA / UAE adapter follow-ups](compliance/DR-P25-04-eta-uae-followup.md) (DR-003 DEFERRED + RISK-007 + the fake-eta harness state; UAE waits for official specs; triggers: evaluation-pack access / spec publication)
- [product/DR-P25-05 — iOS client](product/DR-P25-05-ios-client.md) (the ADR-0014 "out of scope until a decision record" slot; the PHASE-022 Android precedent; trigger: demand signal)
- [technical/DR-P25-06 — OTel exporter swap (SF-024-021)](technical/DR-P25-06-observability-exporter.md) (the names are live, the pipeline picks them up; decided with technical/DR-003; trigger: staging provisioning)
- [technical/DR-P25-07 — Per-tenant report-run quota](technical/DR-P25-07-report-quota.md) (the MULTI_TENANCY §5 gap the GA report-hammer surfaced — isolation proven, quota mechanism open; trigger: first noisy-neighbor incident or scale-out)
