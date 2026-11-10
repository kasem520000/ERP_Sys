# Compliance Decision Records

> **Status:** STABLE · **Owner:** Product Owner & Compliance Review · **Updated:** 2026-11-06

Jurisdiction scope and timing decisions: which regulatory regimes the platform targets,
for which taxpayer segments, and by when. Process and format: [../README.md](../README.md).
Approvers: **product owner + compliance reviewer** (both signatures required in this
folder).

## Hard rule — the no-fabrication gate

No record in this folder may approve implementing against **unverified** official
specifications. Every ACCEPTED record that enables an integration must cite its official
sources (specification version + date + retrieval point, as recorded in
[../../localization/compliance-matrix/](../../localization/compliance-matrix/README.md));
until then the corresponding adapter features stay `UNVERIFIED` stubs that **refuse to
submit** ([../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §3,
agent hard rules ([../../handoff/AGENT_START_HERE.md](../../handoff/AGENT_START_HERE.md), RISK-005). A record cannot waive this gate —
not even a product-owner signature.

## Index

| Record | Title | Status | Decision deadline |
|--------|-------|--------|-------------------|
| [DR-001-zatca-scope-and-timing.md](DR-001-zatca-scope-and-timing.md) | ZATCA integration scope & timing (KSA launch segment) | OPEN | Before PHASE-023 planning; affects GA gate wording |
| [DR-002-yemen-scope.md](DR-002-yemen-scope.md) | Yemen scope at GA (no-VAT pack only vs. sales-tax reporting) | OPEN | Before PHASE-023 evaluation window |
| [DR-003-egypt-eta-scope.md](DR-003-egypt-eta-scope.md) | Egypt ETA scope at GA (e-invoice vs e-receipt vs both; taxpayer segments; timeline) | OPEN — draft (PHASE-023 T9), DEFERRED recommendation | Before the Egypt launch segment planning |
| [DR-P25-04-eta-uae-followup.md](DR-P25-04-eta-uae-followup.md) | Egypt ETA & UAE e-invoicing adapter follow-ups (post-GA slot) | **PROPOSED** (post-GA slot) | ETA evaluation-pack external access (RISK-007) / official UAE spec publication / segment demand |

The `DR-P25-NN` row is a **post-GA pointer stub** (PHASE-025 T14): the filed owning
slot for the GA release's "ETA/UAE adapter follow-ups" pointer — DR-003 remains the
Egypt decision record; [ae.md](../../localization/compliance-matrix/ae.md) the UAE
status row; no adapter claim exists for either market (see
[../README.md](../README.md) §2).

## Inputs expected in records here

1. The linked open question (OQ-004/005/…) and the jurisdiction's
   [compliance-matrix](../../localization/compliance-matrix/README.md) entry with
   verification status.
2. Segment analysis: which taxpayers (by registration status/turnover thresholds) the
   option serves — compliance scope is a *segment* decision, not a country boolean.
3. Engineering timing consequences: which phase absorbs the work; what ships as dormant
   architecture (adapter slots, payload builders) versus implemented integration.
4. Explicit statement of what the platform will **not claim** (e.g., "no e-invoicing
   compliance is claimed for integration-wave taxpayers under option A") — over-claiming
   is the compliance failure mode this folder exists to prevent.

## Records expected here (open the record when the trigger fires)

| Trigger | Record |
|---------|--------|
| OQ-009 becomes due (pre-GA legal review of post-offboarding retention) | New record: retention window + purge-job policy (co-owned with [../../security/DATA_PROTECTION.md](../../security/DATA_PROTECTION.md)) |
| ETA (Egypt) evaluation completes (RISK-007) | New record approving/deferring ETA implementation scope |
| A jurisdiction announces a VAT/e-invoicing change (RISK-006/008 monitoring fires) | Pack-version decision note; implementation scope only if a new regime is required |
| Payment/e-commerce adapters with compliance surface (PHASE-023) | Scope record only if the adapter makes a regulatory claim; otherwise stays technical/product |
