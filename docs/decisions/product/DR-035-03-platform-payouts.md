# DR-035-03 — platform.payouts: DEFERRED to PHASE-059; the SHIPPED-PHASE-023 claim retracted

> **Status:** ACCEPTED (decision: DEFER the platform feature surface to PHASE-059;
> the "SHIPPED PHASE-023" claim is RETRACTED) · **Owner:** Product Owner ·
> **Updated:** 2026-11-10 ·
> **Date:** 2026-11-10 (opened + decided in-phase, PHASE-035 T-07) ·
> **Approver:** Product Owner ·
> **Source:** [PHASE-035](../../implementation/phases/PHASE-035.md) §2 item 6 (the
> silent-deviation resolution slot) ·
> **Related:** audit
> [§5.2 F-9](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md),
> [PHASE-059](../../implementation/phases/PHASE-059.md) (Platform Operations &
> Trust), [DR-002-payment-provider-selection.md](DR-002-payment-provider-selection.md)
> (OPEN — governing for provider depth),
> [SUBSCRIPTION_AND_ENTITLEMENTS §2](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
> (operator-console paragraph)

## Context

The [FEATURE_CATALOG §3](../../product/FEATURE_CATALOG.md) `platform.payouts` row
(الاستردادات وتسوية دفعات المزوّد) claimed: "**SHIPPED PHASE-023** (migration 0035):
the provider refund call … + payout-batch reconciliation (the runPayoutReconciliation
job)". The audit (§5.2 **F-9**) found the claim unsupported as a *feature*: **no
feature-key grant array includes `platform.payouts`, no screen** — the key resolves
for no one and is consumed by nothing. (F-9 also recorded "no API route";
re-verification at record time shows the three permission-gated platform-plane
billing routes — refund, payouts sync, payouts list, all under
`platform.subscriptions.manage` — do exist; what does not exist is any route, screen,
or check that reads the `platform.payouts` key itself.)

Stated honestly, the **substrate exists** — migration 0035 DID ship it:

- The `billing_payouts` table (provider-reported gross/fee/net batches +
  reconciliation outcome: RECONCILED or DRIFT with detail, never auto-corrected) on
  top of the 0021 append-only `billing_events` refund bookkeeping (audited
  `payment.refunded` event — the invoice stays PAID, history append-only).
- The refund + payout-reconciliation service (`refundSettledPayment`, `syncPayouts`,
  `reconcilePayouts`, `runPayoutReconciliation` — the job) and the three
  platform-plane routes above.
- The `__db__` job test pinning it:
  `apps/api/src/__db__/billing/payout-reconciliation.db.spec.ts`.

The **platform feature surface does not**: no operator console screen, no grant array
carrying the key (deliberately operator-only per the 0035 comment — but with no
console there is nothing for the key to gate), no entitlement consumer. DR-002 stays
OPEN and governing: sandbox-adapter depth only, no production cutover claim.

## Options

| Option | Consequences |
|--------|--------------|
| **A. Ship the operator console in PHASE-035** | Turns the truth-restoration phase into a platform-console build; payout/refund operations belong with PHASE-059's operator trust work (its §2 scope), which is where the roadmap already puts it |
| **B. DEFER the feature surface to PHASE-059; retract the SHIPPED claim; keep the substrate described exactly as it is** | The catalog stops over-claiming the same day; the 0035 substrate (tables + job + test) stays live and consumed by 059; DR-002 keeps governing provider depth |
| **C. Delete the key and the substrate** | Throws away tested, pinned reconciliation code the 059 console builds on; the key is the registry hook PHASE-059 needs — removal is churn with no entitlement impact (no plan carries it) |

## Decision

**Option B.** The `platform.payouts` **feature surface is DEFERRED-to-PHASE-059**
(Platform Operations & Trust, CR-29). The "SHIPPED PHASE-023" classification is
**RETRACTED** and replaced with: "**SUBSTRATE SHIPPED 0035** (tables + reconciliation
job test); the platform feature surface is **DEFERRED-059**".
[DR-002](DR-002-payment-provider-selection.md) stays governing: everything here is
sandbox-adapter depth until the provider decision lands.

## Consequences

- [FEATURE_CATALOG §3](../../product/FEATURE_CATALOG.md) row corrected: the "SHIPPED
  PHASE-023 (migration 0035)…" sentence replaced by the substrate/surface split;
  phase column → `059 (substrate 0035; DR-035-03; DR-002 OPEN)`, keeping the DR-002
  OPEN context.
- [SUBSCRIPTION_AND_ENTITLEMENTS §2](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  operator-console paragraph corrected to the same substrate/surface split. The
  adjacent tenant-key sentence ("Both tenant keys resolve **live** at
  CURRENT_SHIPPED_PHASE 23 … parking surface, parsers, commerce staging import are
  shipped") stays: it was always true of `treasury.bank_statement_parking` and
  `sales.commerce_channels`, which are code-backed.
- **PHASE-059 intake consumes this record**: the payout/refund operator console
  registers against DR-035-03 and builds on the 0035 substrate (billing_payouts +
  runPayoutReconciliation + the pinned job test) rather than re-deriving it.
- No code change in PHASE-035: the routes, job, and `__db__` spec stay as the
  substrate; nothing is deleted or renamed.

## References

- [PHASE-059](../../implementation/phases/PHASE-059.md) — Platform Operations &
  Trust, the owning phase.
- [DR-002-payment-provider-selection.md](DR-002-payment-provider-selection.md) — the
  governing provider-selection record (OPEN; sandbox depth until decided).
- Audit [§5.2 F-9](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) —
  the finding this record resolves.
