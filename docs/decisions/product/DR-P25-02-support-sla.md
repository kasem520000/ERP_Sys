# DR-P25-02 — Support SLA Commitments per Plan (OQ-008 finalization)

> **Status:** PROPOSED (post-GA decision slot — PHASE-025 T14; OQ-008's owning record) ·
> **Date:** 2026-11-06 (opened) · **Approver:** Product Owner (with the support/on-call
> lead's staffing reality-check attached) · **Source:**
> [OQ-008](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) ("Support SLA commitments per plan
> (response times)? — recommended: define after GA readiness review (PHASE-025)") ·
> **Related:**
> [MONITORING.md](../../operations/MONITORING.md) §4 (the paging policy this record must
> not contradict) + §3 (the alert severities),
> [../security/INCIDENT_RESPONSE.md](../../security/INCIDENT_RESPONSE.md) §1 (the
> incident SLAs already committed internally),
> [../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
> (where per-plan commitments would publish),
> [GA-RELEASE-CHECKLIST.md](../../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
> criterion 10

## Context

OQ-008 defers the customer-facing support-SLA definition to "after the GA readiness
review" — that review is now done (this release, v1.1.0), so the question is live. The
constraint that shapes every option: **the on-call reality**. What exists today and is
already committed *internally*: the MONITORING §4 paging policy (Sev-1 pages the primary
on-call immediately, secondary after 10 min unanswered; Sev-2 pages within business
hours, ticket otherwise; Sev-3 ticket-only) and the INCIDENT_RESPONSE §1 incident SLAs
(ack ≤ 15 min on-call, all-hands ≤ 1 h for SEV-1, customer comms ≤ 4 h). A published
customer SLA may promise **less** than the internal machine does, but never more than
the staffing can honor — the release notes (v1.1.0) state honestly that no SLA is
promised before this record lands.

## Options (sketch)

| Option | Shape | Consequences |
|--------|-------|--------------|
| **A. Best-effort, no published SLA** | Support channels + response targets stated as aims, not commitments | Honest at current staffing; weakens enterprise procurement; the v1.1.0 notes' wording becomes permanent |
| **B. Single-tier SLA for all plans** | One response/resolution commitment per severity, every tenant | Simple, credible if modest; gives away a plan differentiator |
| **C. Per-plan tiers (Starter/Business/Enterprise)** | Faster response + phone/callback + named-contact tiers as plan features | Matches the subscription model; requires the staffing + on-call coverage per tier to be real before publishing |
| **D. Availability-only commitment** | Publish the 99.9% API SLO (already live) as the sole SLA; support stays best-effort | Anchors on what's already measured; sidesteps the staffing question; incomplete as a support promise |

## Recommendation (lean, to be tested at the trigger)

**C (or B as its first stage)** — per-severity response targets per plan, derived
strictly from what the MONITORING §4 paging policy + incident SLAs already deliver
internally, minus a safety margin; resolution targets expressed per severity as
*targets with escalation*, never as guarantees (financial remedies/credits are a
pricing decision and belong in the pricing record, not here).

## Decision

**NOT YET MADE — this record is the owning slot.** Inputs required at the trigger: the
staffing plan (on-call coverage hours, business-hours definition per market — KSA/UAE
first per A-001), the measured baseline from the first post-GA months of tickets, and
the per-severity ladder (response/resolution targets for Sev-1…Sev-3).

## Consequences

- Until decided: **no SLA commitment appears anywhere customer-facing** (the v1.1.0
  release-notes wording governs); support processes run on the internal paging policy.
- When decided: publish into
  [SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  (per-plan matrix), the onboarding/help surfaces (AR+EN), and update this record +
  `CHANGELOG.md` per the decision process ([../README.md](../README.md) §4). Affects
  staffing, not architecture (OQ-008's own scope note).
- **Trigger:** the post-GA review once the staffing model for the first GA cohorts is
  known (target: before the first Enterprise-plan cohort). **Owner:** product owner
  (decision); support/on-call lead (the reality-check evidence).

## Approval requirements

- Product-owner signature; the support/on-call lead's written capacity statement
  (coverage hours × severity × plan tier) attached — the record may not publish a
  target the paging policy cannot deliver.
- If financial remedies (credits) are included: co-decided with the pricing record
  ([DR-001-pricing-tier-structure.md](DR-001-pricing-tier-structure.md), OPEN).
