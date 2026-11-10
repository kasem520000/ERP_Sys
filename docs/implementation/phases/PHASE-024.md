# PHASE-024 — Security Hardening & Compliance Review

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-024
- **Title:** Security Hardening & Compliance Review
- **Objective:** Harden and externally validate everything built through PHASE-023 by
  executing the [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §11
  penetration test across its full scope (multi-tenancy/RLS, auth + MFA, POS, the API
  surface, sync endpoints, uploads/exports, native clients, e-invoicing sandbox
  surface, CI/CD exposure) with severity-mapped remediation SLAs; enforce MFA policies
  per role/plan; re-verify rate-limit/lockout behavior; execute one secrets-rotation
  drill; complete dependency triage (audit + SBOM review); ship tenant-admin audit
  review tooling; do the CSP/headers final pass; drive the privacy-notices legal review
  to a recorded retention decision (OQ-009); verify the tenant-offboarding purge job;
  review support-access auditing; and refresh the threat model for every surface added
  since PHASE-001 — leaving a findings log with retest proofs and regression tests.
- **Business value:** GA customers (and the GA gate itself) need demonstrated, not
  asserted, security: an external firm's report with closed findings, drills actually
  executed, and compliance statements that survive scrutiny
  ([MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) §GA gate: "pen-test findings
  closed").

## 2. Scope

In scope:

1. **Penetration test** per SECURITY_TEST_PLAN §11 — scope list executed verbatim:
   web app + BFF (auth flows, CSP), full API surface (all modules shipped by now),
   **multi-tenancy/RLS with a tenant-pair test setup**, POS flows, sync endpoints,
   file/export paths, desktop + Android clients, e-invoicing adapter surface (sandbox),
   CI/CD exposure. Method: external firm (first pen test) + internal re-runs; grey-box
   with a valid tenant account per tester; fixtures only (no real tenant data in
   payloads, §13 rule 4). Cadence anchor: PHASE-024 full scope; re-test before GA
   (PHASE-025).
2. **Findings program** per §11/§13/§14: findings log at
   `docs/operations/security-findings.md` (id, title, severity, surface, source,
   status, fix PR + regression links); **fix SLAs — Critical 7 days (release-blocking),
   High 30 days, Medium 90 days, Low next release; waivers only via decision record**;
   every fixed finding gets a retest proof + an automated regression test where
   automatable; findings ingested into the log the same day the report lands.
3. **MFA enforcement policies per role/plan** (completing
   [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md) §4 "mandatory-able per
   role/plan policy later"): tenant-level and plan-level policy configuration (e.g.,
   mandatory TOTP for owner/accountant role templates), enforcement at login (423
   MFA_REQUIRED), admin-assisted MFA reset (`identity.mfa.admin_reset`), recovery-code
   hygiene, and the WebAuthn/passkeys **decision record** (roadmap item for this
   phase — record the decision either way; not launch-blocking).
4. **Rate-limit & lockout hardening verification**: full re-run of scenarios R-01…R-08
   (progressive delays, per-IP/per-user/per-tenant limits, lockout bypass across
   surfaces, quota isolation, cheap sync rejection) plus header/session-fixation
   resistance; any gap found is a finding with SLA.
5. **Secrets rotation DRILL executed once** per
   [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) §3: rehearse at least
   the disruptive class in staging (session-signing key S-03 dual-accept window; DB app
   credentials S-01; webhook signers S-11 dual-secret window) with the §7
   revoke-first checklist walked tabletop-style; drill notes become runbook entries
   (§8 rule 3). S-10 certificate rotation is rehearsed only against the fake-authority
   harness (never with production authority material in staging).
6. **Dependency triage**: full `pnpm audit`-equivalent sweep + lockfile lint (no `*`
   ranges on prod deps), **SBOM review** of every shipped image and client bundle
   (server, worker, web, desktop, Android) against the CI-produced SBOMs
   ([DEPLOYMENT_ARCHITECTURE.md](../../architecture/DEPLOYMENT_ARCHITECTURE.md) release
   process), known-exploit triage with the §1 blocking rule (no known-critical in prod
   deps), and a gitleaks full-history scan.
7. **Audit trail review tooling for tenant admins**: filtered, paginated, exportable
   `audit_events` review UI (actor, action, object, correlation id, time range) with
   permission gating; completeness checks that financial questions are answered from
   the database, not log search
   ([MONITORING.md](../../operations/MONITORING.md) §6).
8. **CSP/headers final pass**: automated probe re-run per SECURITY_TEST_PLAN §8
   (HSTS, nosniff, frame-ancestors 'none', Referrer-Policy, CSP default-src 'self',
   no unsafe-inline scripts, object-src 'none', SRI on third-party assets,
   report-only capture in staging) across web + BFF + API origins, including the
   bidi/RTL spoofing payload class (THREAT_MODEL S-03).
9. **Privacy notices + retention decision (OQ-009)**: prepare and drive legal review
   of privacy notices and the offboarding retention period; the **decision record is
   required output** — 90-day-then-hard-delete remains the working assumption
   ([DATA_PROTECTION.md](../../security/DATA_PROTECTION.md)) until the record lands;
   the record updates DATA_PROTECTION + Journey H wording.
10. **Tenant offboarding purge job verification**: execute the documented purge job in
    staging end-to-end (read-only grace → export with manifest/checksums → suspension
    → retention window → purge with deletion certificate → platform audit trail),
    verify certificate paths are purged from the secret store
    (SECRETS_MANAGEMENT §6.6), and verify legal-hold blocking
    ([USER_JOURNEYS.md](../../product/USER_JOURNEYS.md) Journey H).
11. **Support-access audit review**: verify time-boxed support sessions
    (`platform.support.access`, ≤ 4 h, tenant opt-in or declared incident) are fully
    audited; run a review report over a staging window; close any gap in session
    capture ([AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §7).
12. **Threat model update cycle**: fold every surface added since PHASE-001 into
    [THREAT_MODEL.md](../../security/THREAT_MODEL.md) — offline devices/trust
    boundaries (B6 server↔device), sync endpoints, native clients, updater channels
    (S-15), e-invoicing certificates (S-10), webhook ingress — re-score the scenario
    catalog, and record residual risks with owners.
13. **Public disclosure policy**: publish the security@ contact + disclosure policy
    (§12 prerequisite for any future bug bounty — the bounty program itself stays a
    post-GA decision record).
14. **Full security gate re-run**: every per-phase gate from SECURITY_TEST_PLAN §1
    re-executed on the final GA-candidate build (tenant-isolation A1–A11 + expanded
    tables, permission matrix tests, session/MFA M-01…M-10, upload U-01…U-07, export
    E-01…E-06, device D-01…D-08, RLS canary) with the results attached as the
    PHASE-024 baseline that PHASE-025's GA checklist references.

Out of scope (explicit):

- The bug-bounty program itself (post-GA decision record — only the disclosure policy
  ships here).
- New product features; new endpoints; any architecture change (findings that imply
  architecture changes become decision records, not in-phase improvisation).
- The GA re-test (PHASE-025 re-runs scoped pen tests before GA per §11 cadence).
- Fixing findings beyond SLA waivers is mandatory — but "hardening" never widens into
  refactors (scope discipline,
  [CODE_REVIEW_TEMPLATE.md](../../implementation/templates/CODE_REVIEW_TEMPLATE.md)).

## 3. Prerequisites

- Required phases: **PHASE-023** COMPLETE (or COMPLETE with recorded INCOMPLETE gated
  items — the pen test tests what exists, and the report must state the adapter state
  honestly). All surfaces under test exist because phases 001–023 are COMPLETE per
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md).
- Required architecture decisions:
  [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md) (MFA roadmap, WebAuthn
  decision item), [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md)
  (isolation under test),
  [ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md)/[ADR-0013](../../architecture/ADR/ADR-0013-tauri-desktop.md)/[ADR-0014](../../architecture/ADR/ADR-0014-android-expo.md)
  (device/client surfaces).
- Relevant documentation:
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) (§1 gates, §5 rate
  limits, §6 sessions/MFA, §7 uploads, §8 headers/CSP, §9 exports, §10 devices, §11
  pen test, §12 bounty, §13 evidence, §14 maintenance),
  [THREAT_MODEL.md](../../security/THREAT_MODEL.md),
  [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md),
  [INCIDENT_RESPONSE.md](../../security/INCIDENT_RESPONSE.md) (severity mapping,
  comms templates for any finding disclosure),
  [DATA_PROTECTION.md](../../security/DATA_PROTECTION.md),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md),
  [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md),
  [TEST_STRATEGY.md](../../testing/TEST_STRATEGY.md),
  [REGRESSION_STRATEGY.md](../../testing/REGRESSION_STRATEGY.md),
  [USER_JOURNEYS.md](../../product/USER_JOURNEYS.md) (Journey H),
  [OQ-009](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) (retention decision),
  [MONITORING.md](../../operations/MONITORING.md),
  [TROUBLESHOOTING.md](../../operations/TROUBLESHOOTING.md).

## 4. Design Impact

- **Database changes:** minimal by intent — MFA policy configuration tables/fields and
  audit-review index support only; any finding-driven schema fix ships as an
  expand-contract migration with catalog updates in the same PR. No new modules.
- **API changes:** policy-driven MFA enforcement points (login + sensitive-action
   re-challenge per policy), audit-review query endpoints (tenant-admin scoped), and
   any finding-driven hardening of existing endpoints (payload limits, stricter
   validation). No new product surface.
- **UI changes:** tenant-admin audit review screens (filtering, export, correlation-id
  lookup), MFA policy settings, MFA enrollment prompts under enforcement, and
  disclosure/security policy pages.
- **Security & authorization:** this phase IS the security surface: findings log +
  SLAs; MFA mandatory per role/plan; support-access review tooling; secrets drills;
  permission-catalog drift re-check (seed vs
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) per
  [REGRESSION_STRATEGY.md](../../testing/REGRESSION_STRATEGY.md) §6); rate-limit
  regression suite permanent in CI.
- **Accounting implications:** none — but audit-review tooling must prove financial
  questions are answerable from `audit_events` + ledger (INV-003/INV-022 spirit), and
  export leakage tests (E-01…E-06) re-run against the final export pipeline.
- **Localization implications:** privacy notices and disclosure policy ship AR+EN;
  MFA/lockout messages localized; findings log is internal (EN) but tenant-facing
  security notices use the INCIDENT_RESPONSE AR+EN templates.
- **Offline implications:** D-01…D-08 device tests re-run on final clients
  (PHASE-020–022 surfaces); offline permission-snapshot and watermark behavior
  verified against final policies; updater signing (S-15) included in dependency/
  key-hygiene review.
- **Module dependencies:** cross-cutting over `identity` (MFA, sessions, devices,
  audit), `files` (uploads), `reporting` (exports), `sync` (endpoints), `tax`
  (adapter surface), `tenancy` (purge job) — no new modules; hardening happens inside
  existing boundaries.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Engage external firm; produce tenant-pair + per-surface test setups (fixtures only); schedule windows | `docs/operations/security-findings.md` (log scaffold), pen-test repo area | engagement plan recorded; staging tenant fixtures verified synthetic |
| T2 | Pen test execution + report ingestion: same-day findings-log rows, severity mapping to SEV ladder, SLA clocks started | `docs/operations/security-findings.md` | 100% of report findings logged with ids; no unlogged findings |
| T3 | Findings remediation: fix-per-SLA, retest proof per finding, regression test per automatable finding | fix PRs + `tests/**` regressions named after finding ids | retest proofs attached; regression suite green; SLA report in completion evidence |
| T4 | MFA enforcement policies per role/plan: policy config, login enforcement, admin reset, recovery-code hygiene, WebAuthn decision record | `apps/api/src/modules/identity/mfa-policy/**`, `apps/web` settings, `docs/decisions/**` | M-series re-run; enforcement matrix test (role × plan × policy); record filed |
| T5 | Rate-limit/lockout hardening verification: R-01…R-08 re-run + fixes | `apps/api/src/infra/rate-limit/**` | R-series green; lockout indistinguishable from credential failure (oracle test) |
| T6 | Secrets rotation drill: execute S-03/S-01/S-11 rotations in staging with runbook-only execution; tabletop the §7 revoke-first checklist; runbook entries for what-was-hard | `docs/operations/**` drill records | drill log with timings; dual-accept window verified; old secret fails canary |
| T7 | Dependency triage: audit sweep + lockfile lint + SBOM review of all images/bundles + gitleaks full-history | CI jobs + `docs/operations/security-findings.md` | no known-critical in prod deps (blocking rule); SBOM diff reviewed |
| T8 | Audit review tooling for tenant admins: query UI + export + correlation-id lookup, permission-gated | `apps/api/src/modules/audit/query/**`, `apps/web/src/app/audit/**` | permission tests (viewer denied, owner allowed); completeness assertions |
| T9 | CSP/headers final pass: probe re-run across origins incl. RTL-spoofing payloads; report-only findings fixed | edge/BFF configs | §8 probe assertions green on all origins |
| T10 | Privacy/retention legal review (OQ-009): notices prepared (AR+EN), legal review driven, decision record filed; DATA_PROTECTION/Journey H updated | `docs/decisions/**`, `docs/security/DATA_PROTECTION.md`, product pages | decision record exists (or BLOCKED-with-reason recorded honestly) |
| T11 | Offboarding purge verification: staging end-to-end run (grace→export→suspend→retention→purge→certificate paths→legal hold) | purge job + drill script | deletion certificate + platform audit trail evidenced; cert paths purged; legal-hold blocks |
| T12 | Support-access audit review: session capture verification + review report over a staging window | `apps/api/src/modules/identity/support/**` | every support session audited with grant + end; gaps fixed |
| T13 | Threat model update: add B6 device boundary, sync/clients/updater/cert/webhook surfaces; re-score scenarios; residual-risk owners | `docs/security/THREAT_MODEL.md` | validation: every new surface since P-001 has a threat-table row |
| T14 | Disclosure policy publication (security@ + policy pages AR+EN) | public docs/pages | policy reachable; contact routed to on-call triage path |
| T15 | Full security gate re-run on GA-candidate build (A1–A11 expanded, M/U/E/D/R series, RLS canary, permission drift check) | CI security workflow | gate output attached as the PHASE-025 baseline evidence |

## 6. Verification

**Automated tests (required):**

- **New findings regression tests**: one named, automated test per fixed finding where
  automatable (named after the finding id), kept green permanently
  ([REGRESSION_STRATEGY.md](../../testing/REGRESSION_STRATEGY.md) §5).
- **Full gate re-run** on the GA candidate: tenant-isolation attack suite A1–A11 across
  the expanded table registry; generated permission checklist (route × role); session/
  MFA M-01…M-10 under the new policies; upload U-01…U-07; export leakage E-01…E-06;
  device D-01…D-08; rate-limit R-01…R-08; RLS canary (`erp_rls_denials_total` = 0);
  permissions-seed vs AUTHORIZATION_MATRIX drift check.
- MFA enforcement matrix tests: every (role template, plan, policy) combination
  behaves (mandatory → 423 until enrolled; exempt → optional); recovery codes single-use.
- Purge-job test: post-purge tenant data irrecoverable across DB, object storage,
  secret-store certificate paths; deletion certificate written; legal-hold flag blocks.

**Manual verification:**

1. Walk the findings log with the external firm's report side by side: every finding
   has status, fix, retest proof — no orphans.
2. Attempt the R-07 lockout-bypass path manually across BFF/API/reset surfaces.
3. Use the tenant-admin audit UI to answer a seeded "who approved/posted/printed this
   document" question end-to-end.
4. Execute the support-access flow with a staged incident ticket; verify the full
   session is captured and the review report renders it.
5. Confirm the disclosure policy page is live in AR+EN and the contact routes.

**Acceptance criteria (objective):**

1. External pen test executed over the full §11 scope with the report ingested; every
   finding logged the same day with severity, surface, and status.
2. Remediation SLAs met: Critical 7 days (none open at exit — release-blocking), High
   30 days, Medium 90 days (status + waiver decision-record links otherwise); every
   fixed finding has a retest proof.
3. MFA enforcement is configurable per role/plan and enforced at login; the
   WebAuthn/passkeys decision record exists either way.
4. R-01…R-08 all green on the GA candidate; lockout responses indistinguishable from
   credential failures; per-tenant quota isolation verified.
5. One secrets-rotation drill executed with a written drill record; old secrets fail
   canary checks; drill learnings landed as runbook entries.
6. Dependency triage complete: no known-critical in production dependencies; SBOMs
   reviewed for server, worker, web, desktop, Android; gitleaks full-history clean.
7. Audit-review tooling live for tenant admins with correct permission gating; a
   seeded forensic question is answerable from the UI + `audit_events` alone.
8. CSP/headers probe green on all origins including bidi-spoofing payloads; no
   `unsafe-inline` scripts; SRI verified on any third-party asset.
9. OQ-009 decision record filed (or honestly BLOCKED with reason and owner) — privacy
   notices reviewed by legal; retention wording consistent across DATA_PROTECTION and
   Journey H.
10. Offboarding purge verified end-to-end in staging incl. secret-store certificate
    paths and legal-hold blocking; deletion certificate + audit trail evidenced.
11. Support-access sessions are 100% audited (grant, window, end) over the review
    period; gaps fixed.
12. Threat model updated: every surface shipped through PHASE-023 has threat rows,
    scores, and residual-risk owners.
13. Full security gate re-run attached as baseline evidence; findings regression tests
    in CI; criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

**Performance & security considerations:** hardening changes (stricter limits,
re-challenges) must not break NFR-006 latency budgets — re-run the k6 smoke tier after
gate changes; rate-limit rejection stays cheap (R-06); drill rotations in staging
only; never move production secrets into test scopes
([SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) §2/§5).

**Migration & rollback:** any finding-driven migration is expand-contract with catalog
updates; policy tables default to current behavior (no forced MFA until a tenant
enables it); rollback = previous image + flags off; findings log and drill records are
append-only evidence — never edited after the fact.

## 7. Risks and Constraints

- **RISK-010** (cross-tenant leak) is the catastrophic finding class: any pen-test
  isolation finding is treated as SEV-1 process (auto-SEV-1 triggers align) and is
  release-blocking regardless of SLA arithmetic.
- External-firm scheduling risk: book the engagement at phase start; if the window
  slips, the phase extends rather than narrowing scope (a partial-scope report is an
  INCOMPLETE marker, not a pass).
- "Findings fatigue" risk (waiver pressure near GA): waivers exist only via decision
  record with named compensating controls — the GA checklist will re-read them.
- **RISK-019** (agent drift): hardening must not become refactoring; architectural
  findings become decision records + phase-scope changes, not in-phase rewrites.
- Constraint: fixtures only in testing (no real tenant data in payloads — §13 rule 4);
  constraint: the bounty program decision is post-GA; only the disclosure policy ships.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-024-COMPLETION.md` with: pen-test report
  reference + findings log (statuses, SLA dates, waiver records), retest proofs, the
  secrets-drill record, MFA enforcement matrix output, R/M/U/E/D/A-series gate outputs,
  purge-job evidence, OQ-009 decision record link, threat-model diff summary,
  disclosure-policy link, docs validation output.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-024 →
  COMPLETE), `docs/handoff/CURRENT_STATE.md`, `docs/handoff/CHANGELOG.md`,
  [THREAT_MODEL.md](../../security/THREAT_MODEL.md) (update cycle executed),
  [DATA_PROTECTION.md](../../security/DATA_PROTECTION.md) (retention record),
  `docs/operations/security-findings.md` (living log — remains open past this phase),
  runbooks for drill learnings, FEATURE_CATALOG status if any hardening changed
  feature flags.
- **Exit criteria:** all acceptance criteria green with evidence; no Critical findings
  open; High findings closed or waiver-recorded; regression tests for findings in CI;
  disclosure policy live; docs synchronized.
- **Definition of Done:** the security posture of the GA candidate is fully evidenced:
  external report + closed findings + drills executed + gates green; findings log is a
  living artifact with an owner; `phase/024` tag.
- **Handoff instructions:** PHASE-025 consumes this phase's outputs directly — the
  gate baseline becomes GA evidence, and the §11 cadence requires a scoped re-test
  before GA. Any finding that recurs post-GA follows the findings-log + regression
  protocol, not ad-hoc fixes. **Next eligible phase: PHASE-025 — Performance,
  Reliability & GA Readiness.** Identify only; do not implement.
