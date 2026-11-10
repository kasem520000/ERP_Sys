# DR-001 — ZATCA Integration Scope & Timing (KSA Launch Segment)

> **Status:** OPEN · **Date:** 2026-10-27 (opened) · **Approvers:** Product Owner +
> Compliance Review · **Source:** [OQ-004](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)
> (assumption A-001) · **Related:** [RISK-005](../../planning/RISK_REGISTER.md),
> [../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md),
> [../../localization/compliance-matrix/sa.md](../../localization/compliance-matrix/sa.md),
> PHASE-023, PHASE-025 GA gate

## Context

KSA is the primary launch market (A-001). ZATCA e-invoicing ("FATOORAH") has two phases:
**generation** (serialized invoices, QR/TLV, invoice hash, anti-tampering) and
**integration** (clearance of standard/tax invoices and reporting of simplified B2C
invoices, with cryptographic stamps, authority certificates, and submission APIs). The
integration phase reaches taxpayers in **waves by taxpayer thresholds** set by ZATCA —
which wave a customer belongs to determines what they legally need from us, and the
thresholds are set by the authority, not by us.

The blueprint's position (OQ-004 recommendation): build the **architecture now**
(adapter port, payload builder, submission registry —
[../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md)),
implement **only in PHASE-023** against verified official specifications. This record
decides the commercial scope question the roadmap left open: *which KSA taxpayer segment
the launch targets, and what we promise them.*

Forces:

- RISK-005: implementing against misread requirements is a compliance catastrophe;
  fabricating specs is prohibited absolutely.
- The GA gate wording depends on this record: "ZATCA adapter certified **or** the launch
  segment explicitly excludes e-invoicing-requiring taxpayers (documented decision)"
  ([../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) §GA gate).
- Certification/enrollment requires credentials, sandbox access, and legal review —
  lead time the roadmap cannot compress.

## Options

| Option | Launch segment | Compliance risk | Engineering cost | Market reach |
|--------|----------------|-----------------|------------------|--------------|
| **A. Non-integration-wave segment only** | Taxpayers not yet required to integrate: platform ships generation-phase features (serialized numbering, QR, hash); integration adapter stays `UNVERIFIED` stub refusing to submit | Low — we claim nothing we cannot prove; **must not** market to wave-mandated taxpayers | Lowest: PHASE-023 completes generation features + dormant adapter; no certification dependency on the GA critical path | Narrower initial TAM in KSA; honest and defensible |
| **B. Full phase-2 integration before KSA GA** | All KSA taxpayers incl. integration waves: clearance + reporting live at GA | High until certification is proven: sandbox evidence, cert enrollment, spec pinning all required; any spec drift is a launch blocker | Highest: PHASE-023 becomes GA-critical including external certification lead time | Broadest, and the eventual goal |
| **C. Phased: A at launch, B in first post-GA release** | Segment per option A for GA; integration delivery as a fast-follow with its own certification checklist | Low at GA; B-risk contained in the follow-up release | Sequenced: certification work starts during GA hardening, decoupled from the GA gate | Full reach shortly after GA without betting GA on external dependencies |

## Recommendation

**Option C.** It converts an external dependency (certification timelines we do not
control) into a sequencing plan: GA is not hostage to it, and the adapter work is
non-blocking fast-follow. Two non-negotiables regardless of option:

1. **The no-fabrication gate**: nothing ships claiming ZATCA compliance without the
   verification checklist in
   [../../localization/E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §3
   (pinned spec version, sandbox evidence, sample-invoice validation, legal content
   review). `UNVERIFIED` stubs refuse to submit — they never "try their best".
2. **Honest marketing boundary**: sales/onboarding material states exactly what the
   segment gets (generation features) and what it does not (clearance/reporting) —
   written into the compliance-matrix entry when this record is accepted.

## Consequences

- **If C is accepted**: the GA gate clause resolves as "launch segment excludes
  integration-wave taxpayers, documented here; integration adapter ships certified in the
  first post-GA release with its own checklist"; PHASE-023 scope splits accordingly
  (generation features + adapter completion plan); the KSA compliance-matrix entry gains
  the segment statement.
- **If A is accepted**: same GA outcome, but integration work has no committed slot —
  reopened later with re-scoped roadmap impact.
- **If B is accepted**: GA timing gains an external-risk item (RISK-005 escalates);
  certification milestones enter the GA release checklist; PHASE-023 grows a legal-review
  workstream that must start immediately.
- **No decision by the deadline**: option A behavior applies by default (most
  conservative), and the GA gate records the exclusion explicitly.

## Approval requirements

- Both signatures: product owner + compliance reviewer.
- Evidence attached: current ZATCA wave/threshold status from the
  compliance-matrix entry (with source dates), and — for option C/B — a certification
  path study (sandbox access status, enrollment steps, known lead times).
- On acceptance: update [../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)
  (OQ-004 → decided), `sa.md` compliance matrix, PHASE-023/025 phase documents if scope
  moved, and `CHANGELOG.md` per the decision process.
