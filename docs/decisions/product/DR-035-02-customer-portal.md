# DR-035-02 — Customer portal (S-20): PLANNED PHASE-060

> **Status:** ACCEPTED (decision: classify PLANNED PHASE-060) ·
> **Owner:** Product Owner · **Updated:** 2026-11-10 ·
> **Date:** 2026-11-10 (opened + decided in-phase, PHASE-035 T-07) ·
> **Approver:** Product Owner ·
> **Source:** [PHASE-035](../../implementation/phases/PHASE-035.md) §2 item 6 (the
> silent-deviation resolution slot) ·
> **Related:** audit
> [§5.2 F-8](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md),
> [PHASE-060](../../implementation/phases/PHASE-060.md) (Sales & CRM Depth),
> [COMPLETENESS_REGISTER CR-30](../../planning/COMPLETENESS_REGISTER.md),
> [ERP_FULL_GAP_ANALYSIS S-20](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md),
> [AUTHORIZATION_MATRIX §6](../../security/AUTHORIZATION_MATRIX.md)

## Context

`partners.customer_portal` (S-20, بوابة العملاء — web self-service: statements,
invoice download, dispute messages) sat in
[FEATURE_CATALOG §5](../../product/FEATURE_CATALOG.md) as an unclassified
"priority 3 / phases 023–025" row — a phase column implying delivery in that window.
Nothing shipped in it: the audit (§5.2 **F-8**) found no route, no screen, no
controller, and no customer-scoped token surface (the PHASE-022 personal-account
experience is the read-only mobile leg, `partners.personal_accounts` — a dependency of
this row, not the portal itself). The classification was never updated to DEFERRED,
which is exactly the "documentation implies delivery" pattern the audit flags.

The record was already half-written elsewhere, honestly:
[ERP_FULL_GAP_ANALYSIS S-20](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md)
records the customer portal as **deferred by decision — no implementation**, and the
Blueprint v3.0 completeness roadmap assigns it to **PHASE-060** (Sales & CRM Depth,
[CR-30](../../planning/COMPLETENESS_REGISTER.md)) as item 12 (`portal_accounts` —
customer-contact scoped logins), sharing portal infrastructure with the P-05
supplier-portal skeleton (PHASE-038, CR-08) — a recorded soft edge in PHASE-060 §3.

What was missing was the catalog telling that truth.

## Options

| Option | Consequences |
|--------|--------------|
| **A. Leave the row as "priority 3 / 023–025"** | The stale implication persists — the exact silent deviation F-8 names; every future audit re-finds it |
| **B. Classify PLANNED PHASE-060 with an explicit marker** | The catalog states the real plan (roadmap-assigned, infrastructure-shared); the deferral becomes a recorded decision instead of an ambiguity |
| **C. Drop the row from the catalog** | Loses the S-20 registry hook PHASE-060 consumes; the feature exists in the gap analysis, roadmap, and authorization matrix — deleting the catalog row creates a new inconsistency rather than fixing one |

## Decision

**Option B.** `partners.customer_portal` is classified **PLANNED PHASE-060** (Sales &
CRM Depth, CR-30), sharing portal infrastructure with the P-05 supplier-portal leg.
Priority stays 3; the FEATURE_CATALOG phase column now says so explicitly and links
this record.

## Consequences

- [FEATURE_CATALOG §5](../../product/FEATURE_CATALOG.md) row corrected: phase column
  `023–025` → `060 (PLANNED — DR-035-02, linked)`; priority stays 3; the
  `partners.personal_accounts` dependency is unchanged.
- [AUTHORIZATION_MATRIX §6](../../security/AUTHORIZATION_MATRIX.md) — the
  personal-account (customer portal) permission set (`portal.account.view`,
  `portal.invoices.view`/`download`, `portal.statements.view`,
  `portal.receipts.download`, `portal.payments.view`) — stays the **recorded seam**:
  no change needed; it documents the portal scope PHASE-060 implements, honestly
  ahead of the code.
- **PHASE-060 intake consumes this record**: item 12 (customer portal,
  `portal_accounts`) registers against DR-035-02, with the PHASE-038 shared
  portal-infrastructure dependency (the recorded soft edge) resolved or honored at
  intake.
- No code change and no entitlement change in PHASE-035: the row was never granted to
  any plan, so nothing is preserved or retracted — only the classification is set.

## References

- [PHASE-060](../../implementation/phases/PHASE-060.md) — Sales & CRM Depth, the
  owning phase (item 12: the customer portal).
- [COMPLETENESS_REGISTER CR-30](../../planning/COMPLETENESS_REGISTER.md) — the
  roadmap assignment this record makes canonical in the catalog.
- Audit [§5.2 F-8](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) —
  the finding this record resolves.
- [ERP_FULL_GAP_ANALYSIS S-20](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md)
  — the pre-existing "deferred by decision" record.
