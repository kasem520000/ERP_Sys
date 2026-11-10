# DR-002 — Payment Provider Selection

> **Status:** OPEN · **Owner:** Product Owner · **Updated:** 2026-10-27 ·
> **Date:** 2026-10-27 (opened) · **Approver:** Product Owner ·
> **Source:** [OQ-003](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) (assumption A-009) ·
> **Related:** [RISK-022](../../planning/RISK_REGISTER.md), PHASE-014,
> [DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7

## Context

PHASE-014 bills subscriptions via a **payment-provider adapter port** with a **mandatory
manual-invoicing fallback** (A-009, RISK-022). The adapter-first design means no provider
choice blocks architecture — but checkout cannot ship without a concrete first provider,
and the provider's capabilities determine how much of subscription reconciliation is
automatic vs. manual work for finance.

The launch markets are KSA and UAE (A-001): card penetration is real but not universal,
local debit schemes (e.g., mada in KSA) matter, and cross-border acquiring by global PSPs
is sometimes available but priced worse than local acquiring.

## Evaluation criteria (weighted)

| Criterion | Weight | What "good" looks like | Why it matters here |
|-----------|--------|------------------------|---------------------|
| Regional coverage & acquiring | High | KSA + UAE acquiring; local debit schemes; settlement in local currency | Non-negotiable for launch markets; otherwise FX fees erode pricing |
| Checkout UX (AR/RTL) | High | Hosted or embedded checkout with first-class Arabic + RTL; mobile-web friendly | Cart abandonment in a bilingual market is a checkout-language problem ([../../localization/RTL_AND_LTR.md](../../localization/RTL_AND_LTR.md)) |
| Settlement & reconciliation API quality | High | Machine-readable payouts/fees, webhook events with ids + idempotent retries, refund/subscription APIs | Drives auto-reconciliation depth: weak APIs = manual finance ops forever |
| Sandbox quality | Medium | Stable sandbox, realistic decline/refund flows, no shared test-only credentials | Determines how testable PHASE-014 is; weak sandboxes leak bugs to prod |
| Pricing | Medium | MDR + setup + cross-border + payout fees, transparent | Feeds tier pricing (DR-001); hidden fees break unit economics |
| Compliance scope (PCI/SAQ) | Medium | Minimal merchant compliance burden (hosted fields/checkout) | Keeps the platform out of PCI scope ([../../security/THREAT_MODEL.md](../../security/THREAT_MODEL.md)) |

## Options

| Option | Pros | Cons |
|--------|------|------|
| **A. Regional gateway first** (KSA/UAE-focused acquirer gateway) | Best local coverage/schemes; local settlement; Arabic support likely | Reconciliation APIs vary in quality; smaller vendors = integration risk; two vendors needed if expanding markets |
| **B. Global PSP first** (e.g., a global subscriptions-capable PSP) | Excellent APIs/docs/sandbox; one vendor for many markets; subscription primitives built-in | KSA/UAE coverage + local schemes may require their local acquiring partners anyway; pricing often worse locally |
| **C. Both, phased** | De-risks A with B as second market/backup | Cost + complexity before revenue justifies it |

## Recommendation

**Evidence spike, then decide between A and B** — do not decide from vendor marketing:

1. PHASE-013 window: run a 2-week spike hitting each finalist's sandbox with the real
   subscription flows (signup, renew, decline, refund, webhook idempotency, payout
   reconciliation report) and score them against the table above; capture screenshots of
   Arabic/RTL checkout.
2. Default if evidence is inconclusive: **A (regional gateway)** for launch markets with
   the adapter port ready to add a global PSP later (option C as growth path) — local
   coverage wins in the launch segment.
3. The **manual-invoicing fallback ships regardless** (RISK-022): markets/tenants without
   card capability are invoiced manually; this is a product feature, not a degraded mode.

## Consequences

- Chosen provider's adapter is the **only** one implemented at PHASE-014; a second adapter
  is additive later (port unchanged).
- Auto-reconciliation depth = whatever the provider's payout/fee APIs allow; the remainder
  is a documented manual finance procedure until upgraded.
- Provider rejection/delay does not block MVP: manual fallback + this record's status
  (still OPEN) is the documented state.

## Approval requirements

- Product owner signature after reviewing the spike evidence (sandbox results + fee
  sheets + reconciliation API samples attached to the record's PR).
- Security review sign-off for the provider's integration model (checkout/hosted-fields
  scope, webhook verification) per
  [../../architecture/SECURITY_ARCHITECTURE.md](../../architecture/SECURITY_ARCHITECTURE.md).
- Finance counter-signature on settlement currency + payout schedule compatibility.
- Revisit trigger: provider fee change > 20%, service outage SLO breach, or new-market
  expansion the provider cannot acquire → open amendment record.
