# DR-P25-01 — Bug-Bounty Program Launch (Scope Tiers, Disclosure-Policy Linkage, Reward Model)

> **Status:** PROPOSED (post-GA decision slot — PHASE-025 T14; not a decision yet) ·
> **Date:** 2026-11-06 (opened) · **Approver:** Product Owner (driving: platform
> security owner; architecture owner counter-sign for any scope that requires
> engineering changes) · **Related:** the public disclosure policy page AR+EN
> (PHASE-024 T14 — `/{locale}/security` + the login-page link),
> [../operations/security-findings.md](../../operations/security-findings.md) (the
> findings log + the §11 engagement record whose external leg this program would
> eventually complement),
> [../security/SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §11
> (re-test cadence), [../security/THREAT_MODEL.md](../../security/THREAT_MODEL.md)
> (residual-risk owners),
> [GA-RELEASE-CHECKLIST.md](../../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
> criterion 10 (this slot's origin)

## Context

PHASE-024 T14 shipped the **public security-disclosure policy** (AR+EN, linked from the
login page): how to report, what the response commitments are, and safe-harbor wording
for good-faith research. The bounty question — *whether, when, and how the platform pays
for vulnerability reports* — was deliberately left post-GA (PHASE-025 §2 item 12: the
bug-bounty decision is a pointer, not GA scope). GA (v1.1.0) ships with: the disclosure
policy live, the findings log operating same-day per §13/§14, the internal §11
re-verification green, and the external-firm leg on the standing infra-gated waiver.
Nothing in the current posture requires a bounty for the security posture to be honest —
a bounty is a **reach multiplier**, not a gap fill.

## Options (sketch)

| Option | Shape | Consequences |
|--------|-------|--------------|
| **A. Private/invite-only program first** | A small vetted researcher set, monetary rewards, tight scope | Controlled triage load; validates the intake + reward process before public exposure; slower finding flow |
| **B. Public program with tiered scope at launch** | Anyone can submit; scope tiers decide eligibility/reward | Maximum reach; requires hardened triage capacity, clear out-of-scope rules (no DoS, no social engineering, no physical), fraud handling, and a published reward table |
| **C. Recognition-only (no monetary bounty)** | Hall of fame + swag; the disclosure policy carries the process | Cheapest; low incentive for serious researchers; fine as a stage, weak as an end state |
| **D. Keep disclosure policy only, no program** | Status quo | Honest but stationary; the disclosure page already promises response commitments a bounty would amplify, not create |

## Recommendation (lean, to be tested at the trigger)

**A → B staged**: start private/invite-only once post-GA operations stabilize, expand to
a tiered public program after the triage process proves itself. Scope tiers mirror the
§11 scope list (web+BFF, API surface, multi-tenancy/RLS, clients) with explicit
out-of-scope rules; reward tiers by severity per the findings-log ladder
(Critical > High > Medium > Low).

## Decision

**NOT YET MADE — this record is the owning slot.** Open questions to resolve at the
trigger: reward model (monetary tiers vs fixed vs recognition mix), budget + payout
process (regional payment rails for KSA/UAE researchers), program platform (self-hosted
intake vs a managed bounty platform), legal safe-harbor expansion beyond the current
disclosure-policy wording, and the triage staffing commitment (who owns the inbox SLA —
the findings-log same-day discipline extended to external reports).

## Consequences

- Until decided: the disclosure policy (live) governs all external reporting; no bounty
  is advertised anywhere; external findings enter
  [security-findings.md](../../operations/security-findings.md) through the same
  same-day intake.
- When decided: update the disclosure-policy page (AR+EN), the findings log's intake
  section, [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §11 (external
  research as an assurance input), and `CHANGELOG.md` per the decision process
  ([../README.md](../README.md) §4).
- **Trigger:** the post-GA review (the first post-GA cycle after v1.1.0). **Owner:**
  platform security owner (drives the proposal); product owner decides.

## Approval requirements

- Product-owner signature (budget + public commitment); platform security owner
  co-signs (scope + triage capacity is real); legal review of the program terms
  (safe-harbor, eligibility, payout conditions).
- Evidence to attach at decision time: the triage-capacity statement (who handles
  inbound reports at what SLA), the reward table, and the out-of-scope rules — no
  public launch without all three published.
