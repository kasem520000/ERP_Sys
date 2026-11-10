# DR-003 — Egypt ETA Scope at GA (E-Invoice vs E-Receipt vs Both)

> **Status:** OPEN (draft — DEFERRED recommendation) · **Date:** 2026-11-05 (opened) ·
> **Approvers:** Product Owner + Compliance Review · **Source:**
> [RISK-007](../../planning/RISK_REGISTER.md) (Egypt ETA scope creep) + the ETA regime
> row in [eg.md](../../localization/compliance-matrix/eg.md) (REQUIRES_VERIFICATION) ·
> **Related:**
> [../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §4
> (evaluation track), [DR-001](DR-001-zatca-scope-and-timing.md) (the KSA counterpart
> record), [PHASE-023](../../implementation/phases/PHASE-023.md) (T9 — evaluation pack +
> this draft; completion report
> `docs/implementation/phases/reports/PHASE-023-COMPLETION.md`)

## Context

Egypt operates **two** mandatory e-invoicing systems (baseline research,
[eg.md](../../localization/compliance-matrix/eg.md) §2/§4 — REQUIRES_VERIFICATION): the
**e-invoice** system (B2B, mandatory in phases since 2021) and the **e-receipt** system
for retail, rolling out. This record decides the commercial scope question the roadmap
left open: *which systems the Egypt launch segment targets (e-invoice, e-receipt, or
both), for which taxpayer segments, and by when* — scope creep between the two systems
is exactly what RISK-007 exists to prevent.

The architecture's standing position
([E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §4): the
adapter follows the same `EInvoicingAdapter` port, but implementation begins **only
after** official API documentation review, certificate-enrollment process confirmation,
and a decision record approving scope. PHASE-023 T9 was scoped to deliver the evaluation
evidence pack (official API doc review + enrollment process confirmation) plus this
decision-record draft.

**Honest status (2026-11-05): the evaluation pack could not run.** The delivery
environment has no external access to the official ETA documentation or the enrollment
process, and this folder's hard rule ([README.md](README.md) — no-fabrication gate)
forbids approving an integration against unverified official specifications. Nothing was
fabricated: no API shape was guessed, no spec version invented. This record therefore
ships as a **draft with a DEFERRED recommendation**; no implementation-enabling option
can be ACCEPTED until the evaluation pack completes with archived official-source
evidence (the verification protocol in
[compliance-matrix/README.md](../../localization/compliance-matrix/README.md) §4).

## Options

| Option | Scope at the Egypt launch segment | Compliance risk | Engineering cost | Market reach |
|--------|----------------------------------|-----------------|------------------|--------------|
| **A. Defer the ETA adapter (evaluation-gated)** | No ETA integration: standard tax invoices print normally; the payload builder produces compliance-ready archives labeled non-authoritative (eg.md §4); adapter stays NOT_STARTED | Lowest — nothing is claimed; the e-invoice/e-receipt split is decided by deferral, not assumption (RISK-007 honored) | None beyond the shipped adapter-neutral substrate (registry/state machine/jobs + the fake-eta harness, PHASE-023) | No Egyptian e-invoicing claim; tenants file from their own figures |
| **B. E-invoice (B2B) first** | Adapter implements the e-invoice system; e-receipt deferred to its own later record | The evaluation pack (API doc review + enrollment confirmation) must be verified first — the no-fabrication gate blocks any shortcut | Medium: one system's spec + enrollment flow | Egyptian B2B taxpayers only |
| **C. E-receipt (retail) first** | Adapter implements the e-receipt system (POS-heavy segments); e-invoice deferred | Same evaluation-pack dependency; the retail mandate timing is itself unverified baseline research | Medium; POS-coupled (receipts are generated at the point of sale) | Egyptian retail segments only |
| **D. Both e-invoice + e-receipt** | Full ETA scope at the Egypt launch segment | Highest: two systems' specifications, two enrollment flows, two verification burdens — all unverified today | Highest; doubles the verification surface and the rollout-gating work | Broadest in Egypt |

## Recommendation

**Option A — DEFERRED.** The evaluation pack (official API documentation review,
certificate-enrollment process confirmation) could not run in this environment without
external access, and the no-fabrication hard rule in [README.md](README.md) forbids
approving implementation against unverified official specifications. Deferring honors
RISK-007 — the evaluation track may legitimately end in "not now" — and matches the
honest PHASE-023 outcome: the ETA adapter row in
[eg.md](../../localization/compliance-matrix/eg.md) §9 records NOT_STARTED, and no ETA
integration claim is made anywhere. Reopening requires the completed evaluation pack
with archived official sources; a guessed API shape is never an acceptable substitute.

## Consequences

- **If A is accepted**: `eg.md` keeps the NOT_STARTED adapter row with this record as
  the pointer; sales/onboarding material must not imply Egyptian e-invoicing support;
  any Egyptian e-invoicing demand routes to this record's amendment process after the
  evaluation pack runs; per-tenant rollout flags stay default OFF.
- **If B/C/D is accepted**: the evaluation pack must complete first with archived
  official-source evidence (spec/API versions + dates, enrollment steps) filed as the
  `eg.md` compliance-matrix verification entries; the two-person rule applies
  (compliance-matrix README §4); PHASE-023's adapter-neutral substrate (registry, state
  machine, jobs, fake-eta harness) is the base it builds on.
- **No decision by the deadline**: option A governs by default (the conservative path),
  per the assumptions-file protocol.

## Approval requirements

- Both signatures: product owner + compliance reviewer.
- Evidence required for any implementation-enabling option (B/C/D): the completed
  evaluation pack — official API documentation review + certificate-enrollment process
  confirmation, archived official sources with versions/dates — filed as `eg.md`
  verification entries. **Not available in this environment; nothing was fabricated.**
- On acceptance: update `eg.md` (implementation status row + segment statement), the
  Egypt launch-segment planning inputs, and `CHANGELOG.md` per the decision process
  ([../README.md](../README.md) §4).
