# DR-001 — Pricing Tier Structure & Entitlement Matrix

> **Status:** OPEN · **Owner:** Product Owner · **Updated:** 2026-10-27 ·
> **Date:** 2026-10-27 (opened) · **Approver:** Product Owner ·
> **Source:** [OQ-002](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) ·
> **Related:** [RISK-003](../../planning/RISK_REGISTER.md),
> [../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md),
> PHASE-014

## Context

PHASE-014 ships subscriptions, billing, and entitlement enforcement. The entitlement
engine is deliberately decoupled from plan data (plans are seeded configuration —
[../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §tenancy), so the
**architecture is complete without this decision**, but the **commercial product is not**:
tenants cannot be sold anything until tier boundaries exist. A draft matrix exists in
[../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
(Starter / Business / Enterprise with placeholder limits); every number there is a
placeholder until this record is ACCEPTED.

Forces in play:

- Target segment: KSA + UAE small/medium businesses (A-001), Arabic-first back-office
  launch, POS and industry templates arrive post-MVP (PHASE-015–017).
- Competing local products commonly price per-user (seat) with module add-ons.
- Costs track data volume (documents, storage, report renders) more than seats.
- Entitlement keys (`module.feature`) are already the gating primitive — the tier model
  must be expressible as feature-key sets + plan `limits` (PHASE-004 schema).

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Seat-based tiers** | Starter/Business/Enterprise differ mainly by user count caps | Simplest to sell; familiar to market | Under-monetizes heavy-data tenants; punishes small-but-busy shops |
| **B. Module-based tiers** | Core included; industry templates (POS, manufacturing, CRM) priced as add-on modules | Aligns revenue with the industry strategy (PHASE-015+); clear upgrade story | Complex matrix early; MVP has few sellable modules — thin tiers at launch |
| **C. Hybrid: seats + volume + module bundles** | Base seat tiers, plus document/storage volume limits per tier, plus industry module bundles post-MVP | Matches cost drivers; keeps a simple front door ("per user") while protecting margin | Requires the draft matrix to be made concrete now, including overage behavior |

## Recommendation

**Option C**, decided in two steps:

1. **Before PHASE-014**: fix the three tiers' seat ranges, base prices (KSA/UAE), and the
   volume limits (documents/month, storage, report renders) — these are enforced by plan
   `limits` and must exist at billing time. Overage policy: hard-stop with upgrade prompt
   at MVP (simplest honest behavior; no surprise invoices).
2. **At PHASE-015 planning**: layer industry module bundles as entitlement sets
   (`pos.*`, `manufacturing.*`, …) — this part of the record can be amended later without
   touching billing plumbing.

## Consequences

- **If C is accepted**: the placeholder matrix in
  [../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  becomes authoritative; plan seeds are updated; PHASE-014 acceptance tests assert limit
  enforcement per tier. Wrong guesses are then **configuration** changes (RISK-003
  mitigation), not code changes.
- **If A or B is accepted**: entitlement materialization logic is unchanged, but
  SUBSCRIPTION_AND_ENTITLEMENTS and the onboarding plan-picker UX are rewritten
  accordingly; B additionally defers most monetizable differentiation to PHASE-015.
- **No decision by the deadline**: PHASE-014 proceeds with the placeholder matrix marked
  "internal pilot pricing only" — general availability of self-serve signup slips until
  this record is accepted.

## Approval requirements

- Product owner signature on the concrete tier matrix (prices, seat caps, volume limits,
  overage policy).
- Evidence attached: at least 5 design-partner willingness-to-pay conversations (or
  documented market comparables) — recorded in the record's PR, not here.
- Architecture owner counter-signature confirming the matrix is expressible in
  `plans.limits` + `feature_keys` with no schema change.
- Revisit trigger: < 25% of signups choosing the intended tier, or > 30% hitting limits in
  month 1 → open the amendment record (option C step 2 style).
