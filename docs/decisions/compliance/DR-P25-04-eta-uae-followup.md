# DR-P25-04 — Egypt ETA & UAE E-Invoicing Adapter Follow-Ups (Post-GA)

> **Status:** PROPOSED (post-GA decision slot — PHASE-025 T14; the follow-up record the
> phase's §2 item 12 names for "ETA/UAE adapter follow-ups per their decision records") ·
> **Date:** 2026-11-06 (opened) · **Approvers:** Product Owner + Compliance Review ·
> **Related:** [DR-003-egypt-eta-scope.md](DR-003-egypt-eta-scope.md) (OPEN — draft,
> DEFERRED recommendation), [RISK-007](../../planning/RISK_REGISTER.md) (Egypt ETA
> scope creep), [DR-001](DR-001-zatca-scope-and-timing.md) (the KSA counterpart — OPEN,
> option C), [ae.md](../../localization/compliance-matrix/ae.md) (the UAE row: adapter
> NOT_IMPLEMENTED, waits for official specs), [eg.md](../../localization/compliance-matrix/eg.md)
> (the Egypt row), [PHASE-023](../../implementation/phases/PHASE-023.md) (the shipped
> adapter-neutral substrate + the fake-authority harnesses),
> [GA-RELEASE-CHECKLIST.md](../../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
> criterion 7 (the honest no-claim state this record preserves)

## Context

Two jurisdiction follow-ups are deliberately left open at GA, both for the same reason:
**the no-fabrication gate** (this folder's hard rule — no implementation against
unverified official specifications):

- **Egypt (ETA):** [DR-003](DR-003-egypt-eta-scope.md) is an OPEN draft with a DEFERRED
  recommendation — the evaluation pack (official API documentation review +
  certificate-enrollment process confirmation) **could not run** in the delivery
  environment (no external access; nothing was fabricated: no API shape guessed, no
  spec version invented). The `fake-eta` harness (PHASE-023 T11) drives the **real**
  registry + jobs end-to-end and is the base any future implementation builds on; the
  adapter row honestly reads NOT_STARTED, and no Egyptian e-invoicing claim exists
  anywhere. RISK-007 (scope creep between the e-invoice and e-receipt systems) is
  mitigated precisely by keeping this decision gated on the evaluation pack.
- **UAE:** the [ae.md](../../localization/compliance-matrix/ae.md) e-invoicing row reads
  NOT_IMPLEMENTED — the adapter slot stays **dormant until official specifications
  exist** (the UAE regime was baseline research with REQUIRES_VERIFICATION status; the
  jurisdiction pack `ae` ships VAT 5% with the dormant e-invoicing slot and the refusal
  asserted). The same adapter-neutral substrate (registry, state machine, jobs,
  certificate registry, rollout flags — PHASE-023) serves the UAE when specs land.

## Options (sketch)

| Option | Shape | Consequences |
|--------|-------|--------------|
| **A. Keep both deferred; monitor official sources** | Status quo; the compliance-matrix monitoring cadence (RISK-006/008) watches for spec publication | Zero compliance risk; demand routed to this record's amendment process; the honest NOT_STARTED/NOT_IMPLEMENTED rows govern |
| **B. Run the ETA evaluation pack when external access exists** | The DR-003 prerequisite executes; then DR-003 decides e-invoice/e-receipt/both per the taxpayer segment | Unblocks the Egypt segment decision on evidence; requires hosted/external access (the infra-gated follow-up pattern) |
| **C. UAE specs review when official documents land** | Same evaluation-gated path for `ae` (its own record/amendment when the regime publishes API specs) | Positions the platform for the UAE timeline without claiming anything now |

## Recommendation (lean)

**A now, B and C as their triggers fire** — the two legs are independent; neither has a
GA dependency. A → B/C transition requires archived official-source evidence per the
compliance-matrix verification protocol (two-person rule), never a guessed API shape.

## Decision

**NOT YET MADE — this record is the owning slot.** It exists so the GA release's
"adapter follow-ups" pointer lands on a named, indexed record instead of a vague
aspiration; DR-003 remains the Egypt decision record and ae.md the UAE status row.

## Consequences

- Until decided: no ETA or UAE adapter work; no e-invoicing claim for either market in
  any customer-facing material (the v1.1.0 release notes carry the honest wording);
  per-tenant rollout flags stay default OFF.
- When a trigger fires: the evaluation pack runs with archived official sources →
  DR-003 amendment (Egypt) / a new `ae`-scoped record (UAE) → only then
  implementation planning on the PHASE-023 substrate.
- **Triggers:** external/official-source access for the ETA evaluation pack (RISK-007);
  official UAE e-invoicing specification publication (the ae.md monitoring row); market
  demand from an eligible (non-integration-mandated) segment. **Owner:** compliance
  reviewer (drives evaluation) + product owner (scope decision).

## Approval requirements

- Both signatures (product owner + compliance reviewer) for any implementation-enabling
  amendment; evidence = the completed evaluation pack with archived official sources
  (spec/API versions + dates + retrieval points) filed as the compliance-matrix
  verification entries — the no-fabrication gate cannot be waived, not even here.
