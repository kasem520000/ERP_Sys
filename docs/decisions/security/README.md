# Security Decision Records

> **Status:** STABLE · **Owner:** Platform Security Owner (role) · **Updated:** 2026-11-06

Security-program decisions that are **business/policy commitments rather than
architecture**: vulnerability-disclosure and bounty programs, security-assurance
commitments to customers, and the operational security cadences the product signs up
for. Process and format: [../README.md](../README.md) (parent index). The approver for
this folder is the **product owner** with the **platform security owner** driving;
records with engineering consequences are counter-signed by the architecture owner.

What does **not** belong here: technical hardening choices (→ ADRs in
[../../architecture/ADR/](../../architecture/ADR/) when they shape architecture), and
per-finding remediation tracking (→ the living findings log
[../../operations/security-findings.md](../../operations/security-findings.md)).

## Index

| Record | Title | Status | Trigger |
|--------|-------|--------|---------|
| [DR-P25-01-bug-bounty.md](DR-P25-01-bug-bounty.md) | Bug-bounty program launch (scope tiers, disclosure-policy linkage, reward model) | **PROPOSED** (post-GA slot) | Post-GA review (first post-GA cycle) |

The P25 series are **post-GA pointer stubs** (PHASE-025 T14 — the "no vague
aspirations" rule): each is a filed, indexed owning slot with context, options sketch,
recommendation lean, trigger, and owner; none is a decision yet. Phase-scoped numbering
(`DR-P25-NN`) per the parent README's phase-record convention; records are referenced
folder-qualified.

## Records expected here (open the record when the trigger fires)

| Trigger | Record to open |
|---------|-----------------|
| Post-GA review (the first post-GA cycle after v1.1.0) | Close [DR-P25-01](DR-P25-01-bug-bounty.md) — the bounty launch decision |
| A customer/procurement commitment that binds security assurances (e.g. enterprise SOC/pen-test cadence contracts) | New record — the commitment and its evidence cadence |
| External pen-test firm engagement actually starts (first hosted availability) | Engagement-scope note referencing the §11 waiver record it retires |
