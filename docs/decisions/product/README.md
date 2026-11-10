# Product Decision Records

> **Status:** STABLE · **Owner:** Product Owner · **Updated:** 2026-11-06

Commercial and product-scope decisions: pricing, packaging, payment providers, and
product commitments that bind roadmap phases. Process and format:
[../README.md](../README.md) (parent index). The approver for this folder is the
**product owner**; records with engineering consequences are counter-signed by the
architecture owner.

## Index

| Record | Title | Status | Decision deadline |
|--------|-------|--------|-------------------|
| [DR-001-pricing-tier-structure.md](DR-001-pricing-tier-structure.md) | Pricing tier structure & entitlement matrix | OPEN | Before PHASE-014 (billing implementation) |
| [DR-002-payment-provider-selection.md](DR-002-payment-provider-selection.md) | Payment provider selection | OPEN | Before PHASE-014 (checkout implementation) |
| [DR-003-platform-expansion-v2.md](DR-003-platform-expansion-v2.md) | Platform expansion v2.0 — full financial depth (stages 9–11) + five industry commercial shells | **ACCEPTED** 2026-10-28 | Decided — binds post-GA staging (PHASE-026…034); MVP/GA gates unchanged |
| [DR-P25-02-support-sla.md](DR-P25-02-support-sla.md) | Support SLA commitments per plan (OQ-008) | **PROPOSED** (post-GA slot) | Post-GA review, once staffing for the first GA cohorts is known (target: before the first Enterprise cohort) |
| [DR-P25-03-personal-payments.md](DR-P25-03-personal-payments.md) | Personal-account online payments (OQ-007) | **PROPOSED** (post-GA slot) | Demand signal + DR-002 resolution (whichever is later) |
| [DR-P25-05-ios-client.md](DR-P25-05-ios-client.md) | iOS client decision slot (the ADR-0014 deferral) | **PROPOSED** (post-GA slot) | iOS demand signal in the KSA/UAE target market, or an enterprise procurement requirement |

The `DR-P25-NN` rows are **post-GA pointer stubs** (PHASE-025 T14): filed owning slots
for GA-deliberately-open items — context + options + trigger + owner recorded; not
decisions yet (see [../README.md](../README.md) §2).

## When a record is required (this folder)

- Any change to plan pricing, tier boundaries, or the entitlement matrix published to
  customers.
- Any provider selection that the product depends on for revenue (payments) — including
  the decision to *defer* a provider and run manual-only for a market.
- Scope commitments that later phases inherit (e.g., manufacturing depth, support SLA
  tiers) — open a record rather than letting an assumption harden silently.

## Inputs the product owner should expect in every record

1. The linked open question or assumption from
  [../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md).
2. Options with consequences (never a single-option "decision").
3. The engineering cost/impact statement (what the adapter/configuration surfaces already
   support vs. what a decision would add).
4. A reversal statement: what it costs to change the decision in 6/12 months — pricing and
   provider decisions are customer-visible and expensive to reverse.

## Definition of done for an ACCEPTED record (this folder)

- [ ] Tier/pricing numbers or provider selection written into the affected product docs
      (SUBSCRIPTION_AND_ENTITLEMENTS, onboarding flows, checkout specs).
- [ ] Plan seeds or adapter scope updated with the phase that implements them (PHASE-014
      unless the record says otherwise) — the phase document's acceptance criteria
      reference the record by ID.
- [ ] Sales/marketing boundary statements reviewed (what we claim, what we explicitly do
      not claim).
- [ ] `CHANGELOG.md` entry + OQ pointer updated in
      [../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md).
