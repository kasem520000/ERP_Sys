# DR-P25-03 — Personal-Account Online Payments (OQ-007 finalization)

> **Status:** PROPOSED (post-GA decision slot — PHASE-025 T14; OQ-007's owning record) ·
> **Date:** 2026-11-06 (opened) · **Approver:** Product Owner (architecture owner
> counter-sign if the personal write-path opens) · **Source:**
> [OQ-007](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) ("Should customers'
> personal-account mobile app allow online payments at GA?" — recommended: defer;
> balance/statement/offline cache first) · **Related:**
> [ADR-0014](../../architecture/ADR/ADR-0014-android-expo.md) (the two-capability model:
> tenant field-sales + personal accounts),
> [DR-002-payment-provider-selection.md](DR-002-payment-provider-selection.md) (OPEN —
> the provider decision this record depends on), OQ-003 (provider choice),
> [PHASE-022](../../implementation/phases/PHASE-022.md) (the personal-account experience
> shipped read-only),
> [GA-RELEASE-CHECKLIST.md](../../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
> criterion 10

## Context

The Android app (PHASE-022) serves **two capability experiences** per ADR-0014: tenant
field sales (writes through the sync protocol) and **tenants' customers' personal
accounts** — balances, statements, invoices, notifications. OQ-007's deferred question
is whether personal accounts should be able to **pay** (settle their invoices online).
The current posture, shipped and proven: personal accounts are **read-mostly with no
write path** (three-layer proof: import-graph structural test, host hard guard, zero
write controls — PHASE-022); business-side payments run through the billing checkout
(provider adapter, sandbox-hardened; production cutover pending DR-002) or manual
invoicing.

What changes if personal payments open: a **personal write path** (payments by the
tenant's customer, not the tenant), PCI/scope considerations for card data on mobile,
the provider's customer-facing payment flows (or a second provider decision), refund
handling from the business side against personal payments, fraud/limits policy, and the
ADR-0014 §5 scope rule ("no attempt to replicate the full back-office UI") staying
intact — payments would be one carefully-scoped write surface, not a general write
path.

## Options (sketch)

| Option | Shape | Consequences |
|--------|-------|--------------|
| **A. Keep read-only (status quo)** | Balances/statements/invoices/notifications only | Zero PCI surface; the OQ-007 recommendation continues to govern; demand pressure builds if tenants ask their customers to pay in-app |
| **B. Open personal payments (invoice settlement)** | Personal account can pay its own outstanding invoices via the provider flow | Real convenience value; requires DR-002 resolution + provider customer-payment support + PCI scope review + refund policy; the first personal write path — a boundary change with its own threat-model rows |
| **C. Defer with a trigger list (recommended lean)** | Status quo + explicit demand/dependency triggers recorded | Honest; the slot exists (this record); no commitment the platform cannot evidence |

## Recommendation (lean, to be tested at the trigger)

**C** — the read-only posture governs until (1) DR-002 resolves with a provider whose
customer-facing payment flow is verified, (2) a demand signal exists (tenants asking
their customers to settle in-app), and (3) the PCI/scope review is done. Then reopen as
option B with its own threat-model update.

## Decision

**NOT YET MADE — this record is the owning slot.** The v1.1.0 release notes state the
current posture verbatim ("personal accounts are read-only today — no payment
actions").

## Consequences

- Until decided: no payment affordance ships in the personal-account experience; the
  PHASE-022 no-write proofs remain the standing guarantee.
- When decided (option B): a new threat-model boundary (personal payment writes),
  ADR-0014 §5 scope note updated, DR-002 dependency resolved first, sync/inbox rules
  for the personal write path, AR+EN UX, and `CHANGELOG.md` per the decision process
  ([../README.md](../README.md) §4).
- **Trigger:** demand signal + DR-002 resolution (whichever is later); the post-GA
  review re-reads this record. **Owner:** product owner.

## Approval requirements

- Product-owner signature; architecture-owner counter-sign (the personal write-path
  boundary); evidence attached: the provider's verified customer-payment capability
  (DR-002's production cutover) + the PCI scope review conclusion.
