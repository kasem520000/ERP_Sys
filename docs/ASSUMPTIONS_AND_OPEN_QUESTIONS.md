# Assumptions and Open Questions

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-11-06

Per the operating principles, unresolved product decisions never block the blueprint. Each
item below records an **assumption** (safe provisional decision used by the blueprint) or an
**open question** (requires product-owner approval), with consequences and a recommended
decision. Formal records live under [../decisions/](decisions/README.md); when a decision is
made, update this file, the linked documents, and `CHANGELOG.md`.

## A. Assumptions (provisional decisions used by the blueprint)

| ID | Assumption | Consequences if wrong |
|----|------------|----------------------|
| A-001 | The initial commercial target is KSA and UAE businesses (highest willingness to pay, active e-invoicing regimes); other jurisdictions are configuration-first, integration-later. | Roadmap ordering of ZATCA/ETA work changes; no architectural impact. |
| A-002 | Single legal entity per tenant at MVP; multi-entity groups are post-GA. | `FR` scope holds; consolidation features deferred (already a non-goal). |
| A-003 | One base currency per tenant; no dual-books (e.g., no parallel IFRS/zakat books at MVP). | Zakat-specific reporting becomes a later jurisdiction-pack feature. |
| A-004 | Fiscal years are Gregorian with month periods; Hijri is display/search only. | If customers require Hijri fiscal calendars, fiscal-period model needs extension (isolated in `accounting` module). |
| A-005 | Default costing method is WAC; FIFO is opt-in per tenant and fixed per item thereafter. | Re-education cost only; engine supports both from PHASE-010. |
| A-006 | Perpetual inventory (COGS at issue time) is the default; periodic inventory is not offered. | Simplifies posting rules; acceptable for target market. |
| A-007 | Web-first delivery; desktop and Android follow the offline foundation (PHASE-020…022). | Sequencing choice, reversible. |
| A-008 | Email is the only outbound channel at MVP (invitations, notifications); SMS/push are adapters later. | Notification module keeps an adapter port from day one. |
| A-009 | Billing is monthly/yearly card payments via a payment-provider adapter, with manual invoicing fallback for markets without cards. | PHASE-014 must ship both paths; provider choice is a decision record. |
| A-010 | Official document numbers are assigned at approval/posting time, per tenant/branch/type sequence, and are immutable. | Affects offline POS numbering (offline sequence with reconciliation). |
| A-011 | POS offline sales are permitted with a local sequence and server reconciliation; all other financial documents require connectivity to post. | Scope of PHASE-016 (POS queue) vs PHASE-020 (general sync framework). |
| A-012 | Tenant data residency is a single region at MVP; per-country residency is a deployment decision later. | Deployment architecture keeps region-per-environment possible. |
| A-013 | Initial supported languages: Arabic and English, both complete. Additional languages are additive. | i18n architecture already supports it. |
| A-014 | Cheques are supported as a payment method with status tracking, but no bank cheque-management integration at MVP. | Treasury scope controlled. |

## B. Open questions (product-owner approval required)

| ID | Question | Recommended decision | Consequences of each option |
|----|----------|---------------------|------------------------------|
| OQ-001 | Legal entity name of the product (branding) and domain? | Placeholder "the Platform" until branding decision. | Cosmetic; docs use generic name. |
| OQ-002 | Pricing tiers and exact entitlement matrix ( Starter / Business / Enterprise)? | Draft matrix in [../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](product/SUBSCRIPTION_AND_ENTITLEMENTS.md); treat limits as placeholders. | Wrong guesses change plan-limit enforcement only, not architecture. |
| OQ-003 | Which payment provider first (e.g., a regional gateway vs Stripe)? | Adapter-first design; manual invoicing fallback mandatory. | Provider capabilities drive auto-reconciliation depth. |
| OQ-004 | ZATCA integration scope and timing (Phase 2 "integration" waves depend on taxpayer thresholds and certification)? | Architecture now ([../localization/E_INVOICING_ARCHITECTURE.md](localization/E_INVOICING_ARCHITECTURE.md)), implementation only in PHASE-023 against verified official specs. | Compliance risk if rushed without verified specs. |
| OQ-005 | Do we support Yemen-specific sales-tax filing formats at GA? | No; Yemen ships as a no-VAT jurisdiction pack with standard invoicing. | Small format work if yes. |
| OQ-006 | Manufacturing depth at GA: full MRP or production execution + costing only? | Execution + costing + BOM (no MRP scheduling). | MRP would add a planning module and phase. |
| OQ-007 | Should customers' personal-account mobile app allow online payments at GA? | Defer payment features; balance/statement/offline cache first. | Requires verified provider adapters + PCI considerations. |
| OQ-008 | Support SLA commitments per plan (response times)? | Define after GA readiness review (PHASE-025). | Affects staffing, not architecture. |
| OQ-009 | Data-retention period after tenant offboarding (export window)? | 90 days then hard delete, with documented purge job. | Legal review needed per jurisdiction before GA. |
| OQ-010 | Does the platform promise Arabic-only support channel at MVP? | Bilingual support processes documented; tooling out of scope. | Operational, not architectural. |

> OQ-009 pointer → decision record
> [DR-024-02](decisions/DR-024-02-privacy-retention-oq009.md) filed 2026-11-06
> (PHASE-024 T10): **BLOCKED-EXTERNAL** — the legal review requires the client's
> legal counsel; the 90-day-then-hard-delete working assumption (with the 14-day
> read-only grace) **remains in force** until the record lands; revisit before GA
> (the PHASE-025 gate re-reads the BLOCKED status).

## C. How to resolve an item

1. Record the decision under [../decisions/](decisions/README.md) (product/technical/
   accounting/compliance) with rationale and date.
2. Update affected documents and their `Status` lines; add a `CHANGELOG.md` entry.
3. If the decision invalidates phase scope, update the phase document(s) and re-run the
   cross-document validation checklist in
   [../handoff/VALIDATION_REPORT.md](handoff/VALIDATION_REPORT.md).
