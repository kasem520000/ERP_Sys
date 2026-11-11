# PHASE-058 — Enterprise Identity & Governance

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0, scope extended by v3.1/CR-46) · **Wave:** 3 / Stage 14 · **Register:** [CR-28](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-20) · §19 (G-01…G-13, G-19, G-20) · §20 (UX-19) · §26.5 (IN-28…IN-32) · §28.3 (PP-28) · [gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md) (L1-13 signing-authority residual · L1-17 board resolutions · L1-18 risk-register ID binding · L1-19 contractual compliance — the v3.1 scope extension)

## 1. Phase Overview

- **Phase ID:** PHASE-058
- **Title:** Enterprise Identity & Governance (الهوية المؤسسية والحوكمة)
- **Objective:** Clear the security-review questionnaire that enterprise buyers send
  before any Wave-3 deal closes: federated identity (SAML 2.0 / OIDC SSO with JIT
  provisioning, SCIM 2.0 user lifecycle, LDAP bridge), passwordless hardening
  (WebAuthn passkeys alongside TOTP, tenant-enforced MFA policy — the documented
  `identity.mfa_policy` key goes live), and a governance suite: the GDPR/CCPA
  data-subject-request register, marketing consent records, retention policies with
  legal-hold override, the internal audit module with a risk register, a
  fraud-detection rules engine feeding a case queue, the real SoD matrix beyond
  `SELF_APPROVAL_BLOCKED`, field-level audit trail surfaces over the existing
  `audit_events` ledger, and audit-grade e-signature on documents and reports.
- **Business value:** SSO + SCIM is the single most common "no SSO, no deal" blocker
  in the audited market (H-20/IN-28); the governance register answers GDPR/CCPA,
  SOC 2-style, and tender security questionnaires from shipped surfaces instead of
  promises; e-signature (UX-19/PP-28) removes the last print-sign-scan loop around
  approvals and signed reports. Together with 055/057/059 this completes the
  Stage-14 "enterprise" gate.
- **الملخص التنفيذي (AR):** تُدخل هذه المرحلة هويةَ المؤسسات وحوكمتها: تسجيل دخول
  موحّد SAML/OIDC مع توفير تلقائي SCIM وجسر LDAP لكل مستأجر، ومفاتيح مرور WebAuthn
  إلى جانب TOTP مع سياسة MFA إلزامية على مستوى المستأجر، ثم سجل طلبات أصحاب البيانات
  (GDPR/CCPA) بإتمام تصدير/إخفاء موثّق، وإدارة موافقات التسويق، وسياسات استبقاء
  بأولوية الحجز القانوني، ووحدة تدقيق داخلي بسجل مخاطر، ومحرك كشف احتيال يغذّي طابور
  حالات، ومصفوفة فصل مهام حقيقية، وأسطح تدقيق على مستوى الحقل، وتوقيع إلكتروني بأثر
  تدقيقي — كل ذلك تحت الثابت INV-041: لا حذف مادي لسجلات مالية، بل إخفاء هوية مع
  حفظ سلامة القيد.

## 2. Scope

In scope:

1. **SSO — SAML 2.0 / OIDC** (H-20, IN-28): `sso_configurations` per tenant — SAML
   metadata XML import, OIDC discovery URL, attribute mapping to user fields, JIT
   provisioning rules, and verified email domains; login flow with tenant-resolved
   IdP redirect, signature validation for SAML, code + PKCE for OIDC, and an explicit
   account-linking policy. Screen `/settings/sso`.
2. **SCIM 2.0 provisioning** (IN-30): `/scim/v2` Users and Groups resources with
   bearer-token auth (`scim_tokens` — hashed, rotatable, last-used audited);
   create/update/deactivate mapped to platform users with role assignment via group
   rules. Screen `/settings/scim`.
3. **LDAP bridge** (IN-29): `ldap_configurations` per tenant (connector profile:
   host/LDAPS, bind DN, search base, group filters, attribute map, sync schedule);
   a server-side connector job verifies and syncs users — no direct browser LDAP.
   Screen `/settings/ldap`.
4. **Passkeys and MFA enforcement** (IN-31, IN-32, G-20): `user_passkeys` (WebAuthn
   credentials — public key, credential ID, transports, sign counter, nickname,
   last-used); passkey enrollment and management in the user security profile;
   passkeys as an MFA method alongside existing TOTP; the tenant settings key
   `identity.mfa_policy` goes live (none / optional / required with exception list).
5. **Session management center** (G-19): active-session list per user with device and
   last-seen; tenant-admin revocation.
6. **Data-subject-request register** (G-01): `data_subject_requests` — GDPR/CCPA
   intake → verification → fulfillment (access export / erase / portability /
   rectification) with SLA clocks and a full audit trail. Screen `/governance/dsr`.
7. **Consent management** (G-02): `consent_records` — marketing consent per partner
   contact (purpose, channel, granted/withdrawn timestamps, evidence source); the
   PHASE-041 channel sends perform a suppression check against it.
8. **Retention policies with legal hold** (G-03): `retention_policies` — per entity
   class, period, action (anonymize or purge), legal-hold override; an automation job
   with dry-run preview and audited execution. Screen `/governance/retention`.
9. **Internal audit module and risk register** (G-05, G-06 — **the L1-18 home
   since v3.1/CR-46**): `internal_audit_programs`
   (programs, engagements, findings with severity and CAPA links) and `risk_registers`
   (likelihood/impact, mitigation, owner, review cycle). Screen `/governance/audit`.
   The v3.1 binding adds the corporate-risk catalog surface with review cycles
   feeding the audit program (L1-18's full closure).
10. **Fraud-detection rules engine** (G-07): `fraud_rules` (GL and user-behavior
    heuristics — threshold rules, deviation-from-pattern rules, schedules) and
    `fraud_cases` (case queue: opened from rule hits, investigation states,
    disposition, audit) — the rule substrate that PHASE-064 detection builds on.
    Screen `/governance/fraud`.
11. **SoD matrix** (G-10): `sod_rules` — role-pair conflict rules beyond
    `SELF_APPROVAL_BLOCKED`, severity, compensating-control notes, and an exception
    approval path; evaluated at role-grant time. Screen `/governance/sod`.
12. **Field-level audit trail surfaces** (G-09): the existing `audit_events` ledger
    rendered per record (history drawer) and per field where recorded — read surface
    over shipped infrastructure, no new ledger.
13. **E-signature** (UX-19, PP-28): `signature_requests` (document hash, signer
    identity — platform user or partner contact — evidence trail, audit-grade
    timestamps) and `signature_events` (append-only sent/viewed/signed/declined with
    IP/UA and hash verification); signature flow on documents and on report snapshots
    from PHASE-057.
14. **Compliance readiness records** (G-04, G-11, G-12, G-13): data-residency option
    documentation, a scheduled-and-recorded penetration-test engagement record, a
    bug-bounty policy stub, and a SOC 2 / ISO 27001 readiness controls-matrix report
    generator — external certification itself stays out of scope and is recorded as
    such.
15. **Signing-authority matrix** (**L1-13 residual — added by v3.1/CR-46**):
    `signing_authority_rules` — the consolidated authority matrix (role × document
    type × amount ceiling × currency, effective-dated) generalizing the shipped
    per-doc-type `approval_policies` (BR-034) into one queryable surface
    ("who may sign what up to how much"), time-boxed **delegation of authority**
    (delegator, delegatee, scope, expiry — auto-expiring), binding into the
    PHASE-052 workflow engine's amount branching, and checked at e-signature time
    (item 13 — a signature request outside the matrix is a typed rejection).
    Screen `/governance/authority`.
16. **Board & shareholder resolutions register** (**L1-17 — added by v3.1/CR-46**):
    `board_resolutions` (meeting date, resolution text AR/EN, effective date,
    attachments, links to the transactions they authorize — dividends, guarantees,
    major CAPEX, financing) with append-only amendment history and audit-trail
    reads. Screen `/governance/resolutions`.
17. **Contractual compliance register** (**L1-19 residual — added by v3.1/CR-46**):
    `contract_obligations` — the obligation-level register across contract families
    (service contracts, purchasing contracts from 038, subcontractor agreements
    from 048): each obligation (party, duty, due/recurrence, penalty exposure,
    evidence link, status), renewal/expiry alert rules feeding the notification
    center, and the compliance posture report per counterparty. Screen
    `/governance/contracts`.

Out of scope: external CA-qualified signatures (this is audit-grade e-signature, not
a licensed trust-service provider) · the compliance calendar (054) · AI anomaly
detection (064 — this phase ships the deterministic rules substrate) · IP whitelisting
and edge controls (059) · any change to the existing password/2FA login stack beyond
adding methods and policy.

**v3.1 scope note (CR-46):** the signing-authority matrix (L1-13 residual — the
structured role × document × ceiling surface over the shipped BR-034 policies), the
board-resolutions register (L1-17), the corporate-risk surface on the risk register
(L1-18 ID binding), and the contractual-compliance register (L1-19 residual) were
consolidated into this phase — governance owns the authority/compliance registers;
the effort estimate moves from ~4–5 to ~5–7 weeks.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration — v3.0 entry point) | PLANNED (Blueprint v3.0) — must be COMPLETE before this phase starts |
| Delivered auth stack (sessions, TOTP MFA, `audit_events` append-only ledger, RLS isolation) | shipped in stages 1–11 (audit §21 — do not touch) |
| PHASE-041 channel ports (consent-aware sends) and PHASE-057 report snapshots (signed reports) | PLANNED — recommended; soft edges recorded in the roadmap graph |

No schema prerequisite beyond the v3.0 baseline; the auth and audit infrastructure
this phase consumes is already delivered and on the "do not touch" list.

## 4. Design Impact

- **Migrations:** next in sequence (≈0115…0119 at authoring time; exact numbers are
  bound at implementation start — counts and contents claimed, not fixed journal
  numbers): `identity_federation` (sso_configurations, ldap_configurations,
  scim_tokens, user_passkeys), `governance_privacy` (data_subject_requests,
  consent_records, retention_policies), `governance_audit` (internal_audit_programs,
  risk_registers, fraud_rules, fraud_cases, sod_rules), `governance_signatures`
  (signature_requests, signature_events), plus one DATA-ONLY grants entry for
  `identity.*`/`governance.*` plan entitlements. Drizzle mirror, `_journal.json`, and
  migration spec updated per house convention.
- **Entities/catalog parity:** +14 new tables (the fourteen above); every table ships
  SQL + Drizzle + an `ENTITY_CATALOG.md` row (CR-36 a).
- **Permissions:** +12 keys — `identity.sso`, `identity.scim`, `identity.ldap`,
  `identity.passkeys`, `governance.dsr`, `governance.consent`, `governance.retention`,
  `governance.audit`, `governance.risk`, `governance.fraud`, `governance.sod`,
  `governance.signatures`; zero-drift equality re-run at the extended running base
  (CR-36 b).
- **i18n:** ~220–260 new dictionary keys (settings screens, governance suite,
  signature flow, session center) ×2 AR/EN; parity equality extended (CR-36 c).
- **Docs:** `NAVIGATION_MODEL.md` (new `governance` group + settings entries) · new
  `GOVERNANCE.md` (DSR/retention/SoD operating model) · new `SSO_PROVISIONING.md`
  (SAML/OIDC/SCIM/LDAP configuration guide) · `SECURITY.md` extended (passkeys, MFA
  policy, session center).
- **Reports:** +2 code-level contracts — `governance.dsr-register` (register export
  with SLA aging) and `governance.fraud-case-summary`; catalog rows mandatory.
- **Feature flags:** `identity.enterprise_sso` and `governance.suite` —
  template-composable grants, enterprise-first entitlement migration (CR-36 f).
- **Invariants:** INV-041 (new) — ledger-preserving erasure and legal-hold supremacy:
  DSR erase fulfillment and retention automation must never hard-delete
  journal-bearing financial records; they anonymize PII while preserving posting
  integrity, and a legal hold blocks both. Enforced by an invariant test plus a
  golden close-cycle run.
- **Architecture:** one new ADR (next in the ADR sequence) records the
  identity-federation architecture (protocol adapters, account-linking policy, SCIM
  trust model); no change to the posting engine or RLS model.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations (≈0115…0119) + Drizzle mirror + `ENTITY_CATALOG.md` rows | api |
| T-02 | SSO core: `sso_configurations` CRUD, SAML metadata import + signature validation, OIDC discovery + PKCE flow | api |
| T-03 | Login integration: tenant-resolved IdP redirect, callback, JIT provisioning, account-linking policy | api |
| T-04 | SCIM 2.0 endpoints (Users/Groups) + `scim_tokens` bearer auth + provisioning audit | api |
| T-05 | LDAP connector profile + server-side sync/verify job | jobs |
| T-06 | WebAuthn passkeys: enrollment, challenge/verify, recovery path; `identity.mfa_policy` enforcement middleware | api |
| T-07 | Session management center (list/revoke) + field-level audit surfaces over `audit_events` | web |
| T-08 | DSR register: intake → verification → export/erase fulfillment workflows + SLA clocks + audit | api |
| T-09 | Consent records + channel-send suppression hook (041 ports) | api |
| T-10 | Retention policies: dry-run preview + automation job + legal-hold override + INV-041 tests | jobs |
| T-11 | Internal audit programs, risk register, fraud rules engine + case queue | api/jobs |
| T-12 | SoD rules: conflict evaluation at role grant + exception approval path | api |
| T-13 | E-signature: requests + append-only events + document/report hash verification + signer flow | api |
| T-14 | Screens: `/settings/sso`, `/settings/scim`, `/settings/ldap`, `/governance/dsr`, `/governance/retention`, `/governance/audit`, `/governance/sod`, `/governance/fraud`, signature flow | web |
| T-15 | ADR + GOVERNANCE.md + SSO_PROVISIONING.md + catalog/report rows + ⌘K registration (OA-04) | docs |
| T-16 | RLS attack tests A1–A10 on all 14 tables + full local gates + evidence pack | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. A tenant configures SAML via metadata import and OIDC via discovery URL; both
   login flows complete against a test IdP with signature/PKCE validation enforced,
   JIT provisioning creates the mapped user, and unverified domains are rejected.
2. SCIM 2.0 create/update/deactivate round-trips a user with role assignment from
   group rules; bearer tokens are hashed at rest, rotatable, and leak nothing in
   logs; last-used timestamps are recorded.
3. The LDAP connector syncs and verifies users on schedule without any browser-side
   LDAP; failures surface in the job console with actionable errors.
4. A user enrolls a WebAuthn passkey and completes MFA with it alongside TOTP; with
   `identity.mfa_policy` set to required, a non-MFA login is blocked and the
   exception list is honored; the session center lists and revokes sessions.
5. A DSR access request produces a complete per-subject export; an erase request
   anonymizes PII while INV-041 holds — journal-bearing records remain posted and
   balanced, and a legal-held entity is untouched by the retention job.
6. The fraud rules engine fires on seeded GL/user-behavior heuristics and opens
   auditable cases; the case queue shows investigation states and disposition.
7. SoD: granting a conflicting role pair is blocked with a readable explanation,
   and the exception path records approver, reason, and expiry; the conflict matrix
   is configurable beyond `SELF_APPROVAL_BLOCKED`.
8. E-signature: a document (and a PHASE-057 report snapshot) is signed with a
   verified hash chain, append-only evidence events, and audit-grade timestamps;
   any later document mutation invalidates the signature visibly.
9. CR-36 gates: SQL + Drizzle + `ENTITY_CATALOG.md` for all 14 tables · permissions
   zero-drift at the extended base · AR/EN parity equality · `docs:validate` green ·
   RLS attack tests A1–A10 pass · feature-flag gating · sync-surface assessment
   recorded (identity/governance are online-only; explicit N/A record per OA-02).
10. Completion report `docs/implementation/phases/reports/PHASE-058-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive delivered
    as `ERP_PLATFORM_PHASE058.zip` (OA-07).

## 7. Risks and Constraints

- **SAML implementation pitfalls** — protocol-level XML and signature errors are the
  classic outage source. Mitigated by a vetted library, metadata-first
  configuration, a strict-verification harness (reject unsigned/audience-mismatched
  assertions), and a per-tenant "test this configuration" button before enforcement.
- **JIT provisioning abuse** — an unverified domain could let an attacker
  auto-provision accounts. Mitigated by mandatory domain verification before SSO
  activation and an explicit allowlist in the JIT rules.
- **Retention automation destroying financial truth** — the highest-consequence risk
  in the phase. Mitigated by INV-041 as a hard invariant, dry-run previews with
  counts, legal-hold override, and a golden close-cycle test that must stay green.
- **E-signature legal weight overstatement** — this is audit-grade e-signature, not
  a qualified trust-service signature. Mitigated by explicit wording in the UI,
  GOVERNANCE.md, and the completion report; hash + evidence trail is the deliverable.
- **SCIM token leakage** — long-lived bearer tokens are sensitive. Mitigated by
  hashing at rest, rotation, last-used auditing, and revocation from the console.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-058-COMPLETION.md`
  (evidence per acceptance criterion, IdP/SCIM test transcripts, INV-041 test output,
  governance operating notes, gate outputs).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-058 row → COMPLETE; `NEXT_ACTION.md`
  points to the next eligible phase PHASE-059 (Platform Operations & Trust) per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE058.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-059».
- Handoff notes for PHASE-059: `fraud_cases` and DSR SLA clocks become KPI datasets
  in the 057 registry; the trust-center surfaces in 065 cite the governance
  register shipped here; the secrets adapter in 059 stores the SCIM/LDAP connector
  credentials through the new adapter rather than plain env vars.
