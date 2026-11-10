# DR-024-02 — Post-offboarding data retention (OQ-009): legal review BLOCKED-EXTERNAL, 90-day working assumption stands

> **Status:** BLOCKED-EXTERNAL (legal review required — see Context; the working
> assumption below governs until the record lands) · **Date:** 2026-11-06 (opened,
> PHASE-024 T10) · **Owner:** Platform security owner (role) — drives the legal
> review and lands the final record · **Approver (final record):** Product Owner +
> client's legal counsel · **Related:**
> [OQ-009](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) (the source question),
> [../security/DATA_PROTECTION.md](../security/DATA_PROTECTION.md) §4 step 5 + §5
> (retention table — both carry the pointer to this record),
> [../legal/PRIVACY_NOTICES.md](../legal/PRIVACY_NOTICES.md) (AR+EN DRAFT notices
> prepared for the same review),
> [../product/USER_JOURNEYS.md](../product/USER_JOURNEYS.md) Journey H
> (offboarding wording),
> [PHASE-024](../implementation/phases/PHASE-024.md) §T10 + acceptance criterion 9
> ("filed **or honestly BLOCKED with reason and owner**")

## Context

OQ-009 asks the retention period after tenant offboarding. The blueprint's working
assumption since
[DATA_PROTECTION.md](../security/DATA_PROTECTION.md) has been **90 days then hard
delete** (with a 14-day read-only grace before it), and PHASE-024 T11 shipped the
purge machinery that enforces it: the constants land as **named PLACEHOLDERs** in
`apps/api/src/modules/tenancy/application/offboarding/purge-service.ts` —
`OFFBOARDING_RETENTION_DAYS = 90` and `OFFBOARDING_GRACE_DAYS = 14` — so the
eventual legal decision is a two-constant change, not a re-engineering.

The phase required the **decision record** as output, with privacy notices
(AR+EN) prepared and legal review driven. **Honest status: the legal review is
blocked from this delivery environment.** The review requires the client's legal
counsel (per-market: KSA/UAE first, A-001); no counsel is reachable here, and the
decisions-folder no-fabrication rule ([README.md](README.md)) forbids inventing a
jurisdictional retention obligation or signing off a "compliance" number without a
legal source. Per PHASE-024's own acceptance criterion, this record therefore
files as **BLOCKED-EXTERNAL** — reason, owner, and working assumption recorded —
rather than pretending a decision happened.

## Options

| Option | Consequences |
|--------|--------------|
| **A. Decide 90 days now, status ACCEPTED** | Fabricated compliance: 90 is an engineering default with no legal source per market; an ACCEPTED record would let GA materials claim a reviewed retention period that counsel never saw — exactly what the no-fabrication gate exists to prevent |
| **B. BLOCKED-EXTERNAL with the working assumption kept, owner + revisit triggers recorded** | Honest state; the purge job, export flow, Journey H wording, and privacy-notice drafts all keep functioning on the placeholder constants; the GA checklist re-reads the BLOCKED status as a gate item until counsel signs; risk = the number changes late (a two-constant change + wording sync, deliberately small) |
| **C. Park retention entirely (no purge until reviewed)** | Removes a shipped, tested capability (PHASE-024 T11 end-to-end purge verification) and leaves departing tenants' data resident indefinitely — strictly worse for privacy than the 90-day working assumption |

## Recommendation

**Option B.** Keep the 90-day-then-hard-delete + 14-day-grace working assumption as
the enforced default; route this record + the AR+EN notice drafts
([../legal/PRIVACY_NOTICES.md](../legal/PRIVACY_NOTICES.md)) to the client's legal
counsel; land the final numbers as an amendment of this record (status
ACCEPTED/REJECTED history preserved) before or at the GA gate.

## Decision

**No final decision is possible in this environment — BLOCKED-EXTERNAL.** What
governs in the meantime (unchanged from the working assumption):

- **Retention:** 90 days after offboarding execution, then hard purge
  (`OFFBOARDING_RETENTION_DAYS`, PLACEHOLDER per this record).
- **Grace:** 14-day read-only grace before the retention window starts
  (`OFFBOARDING_GRACE_DAYS`, PLACEHOLDER per this record).
- **Surviving records:** the deletion certificate (`purged_tenants`, hashed tenant
  id, verification counts) and the anonymized audit trail (identifiers hashed) —
  DATA_PROTECTION §4 steps 6–8.
- The constants stay named PLACEHOLDERs in code so the final numbers are a
  one-place change; DATA_PROTECTION §4 step 5 and §5 point here.

## Consequences

- The working assumption (90 + 14) **remains in force** and is what the purge job
  enforces; nothing about the shipped flow changes.
- **Revisit triggers (hard):** before GA — the PHASE-025 GA checklist re-reads this
  record's BLOCKED-EXTERNAL status; either an amended ACCEPTED record with counsel
  sign-off lands, or GA materials must keep presenting the retention period as a
  placeholder pending legal review (no compliance claim). Secondary triggers: a
  new market entry (A-012 residency decisions), or counsel directing a different
  period — then: update the two constants, DATA_PROTECTION §4/§5, Journey H
  wording, and the privacy notices in one change; this record is superseded by the
  amendment, never edited in place.
- The AR+EN privacy-notice drafts ([../legal/PRIVACY_NOTICES.md](../legal/PRIVACY_NOTICES.md))
  inherit the same status: DRAFT — pending legal review per this record.
- Owner of driving the review: **platform security owner** (role); the final record
  needs product-owner + counsel signatures.

## Approval requirements

- Final (unblocking) record: client's legal counsel per launch market (KSA/UAE
  first) confirms the retention period and notice wording; product owner signs;
  evidence = counsel's written determination attached to the amendment.
- Evidence this record relies on (already attached, PHASE-024 T11): staging
  end-to-end purge drill (grace → export with manifest/checksums → suspension →
  retention window → purge → 0-row verification → deletion certificate → audit
  anonymization → secret-store certificate paths purged) and legal-hold blocking
  proof — the machinery works; only the number awaits counsel.
