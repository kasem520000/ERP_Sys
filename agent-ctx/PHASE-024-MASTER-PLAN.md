# PHASE-024 Master Plan — Security Hardening & Compliance Review

> Spec: `docs/implementation/phases/PHASE-024.md` (T1–T15) · Protocol: verification
> gates + the no-fabrication discipline govern everything below · All timestamps
> Europe/Moscow working days unless the repo convention says otherwise.

## 0. Gating reality (read first)

- **External pen-test firm (§11 method) is infra-gated**: this delivery environment
  cannot engage an external firm (no external network reachability to a vendor, no
  procurement path). Per the NEXT_ACTION §How item 4 and the follow-up-obligations
  pattern (PHASE-001..014 precedents), the honest split is:
  - **Internal leg EXECUTED over the full §11 scope list** (the tenant-pair attack
    suite A1–A11 over the expanded registry, permission matrix, M/U/E/D/R series,
    headers/CSP probes incl. bidi payloads, e-invoicing sandbox surface via the
    fake-authority harnesses, CI/CD exposure via config review) — output = the
    PHASE-024 baseline attached to the completion report.
  - **External-firm leg = waived follow-up obligation** recorded verbatim in the
    findings log + IMPLEMENTATION_STATUS (like the hosted-k6 / Testcontainers
    precedents). A partial-scope report is an INCOMPLETE marker, not a pass — the
    report says exactly that.
- **OQ-009 (privacy/retention legal review)**: no legal counsel reachable from this
  environment → the decision record is filed as **BLOCKED-EXTERNAL with reason +
  owner + the working assumption** (90-day-then-hard-delete) kept; AR+EN notice
  DRAFTS prepared for the legal pass; DATA_PROTECTION + Journey H wording updated
  to point at the record. This is the acceptance criterion's "honestly BLOCKED"
  branch.
- **Findings discipline (§13)**: every gap the internal re-verification finds is
  logged in `docs/operations/security-findings.md` the same day with severity +
  SLA + fix + regression test + retest proof. Nothing is retroactively "found
  earlier" — the gaps below were found by the T2 internal re-verification run at
  phase start and are fixed in-phase per SLA (all Critical/High class items are
  in-phase release-blocking per §6).
- **No new permission keys** — every needed key already exists in the 244-catalog
  (`identity.mfa.admin_reset`, `tenancy.export.request`, `tenancy.offboarding.execute`,
  `platform.tenants.offboard`, `platform.plans.manage`, `audit.view`,
  `platform.support.access`); permissions-drift stays 244=244.
- **Feature keys** follow the `platform.support_access` precedent (registered in
  FEATURE_CATALOG + FEATURE_DEPS mirror, platform-provided, permission-gated, never
  plan-metered — security tooling is not paywalled): `identity.mfa_policy`,
  `audit.review_console`.

## 1. Database — migration `0036_security_hardening.sql`

1. **MFA policy substrate (T4)**:
   - `plans.mfa_required_role_keys text[] NOT NULL DEFAULT '{}'` (plan-level policy;
     seeded plans stay `{}` = opt-in current behavior);
   - `sessions.mfa_gate_passed boolean NOT NULL DEFAULT true` (the enrollment
     bootstrap gate — false only on the short-lived enrollment session).
2. **Offboarding purge substrate (T11)**:
   - `tenants.legal_hold boolean NOT NULL DEFAULT false` (Journey H guardrail);
   - `tenant_offboarding` (tenant-owned, RLS): the flow state machine
     REQUESTED → EXPORTED → EXECUTED (retention window) → PURGED with
     requested_by, grace_until, export_file_id, manifest_checksum, retention_until,
     purged_at, cancelled_at + the UNIQUE live-row partial index;
   - `purged_tenants` (platform-owned, no tenant_id — survives the purge):
     the deletion certificate rows — tenant name snapshot, hashed_tenant_id
     (HMAC-SHA256 with a platform salt), purged_at, performed_by, verification
     jsonb (per-table row counts + storage objects), pre_purge_export ref;
   - `purge_grants` (platform-owned): one-time nonces authorizing the audit
     anonymization definer call (issued by the platform-scope service, consumed
     exactly once by the definer function);
   - `audit_events` guard trigger: UPDATE stays globally denied for `erp_app`
     (grants unchanged) but the trigger itself permits the purge-path UPDATE when
     `current_setting('erp.purge_mode', true) = 'on'` — only
     `erp.purge_anonymize_tenant_audit(p_tenant, p_nonce)` (SECURITY DEFINER,
     pinned search_path, grant-validated, single-use nonce) can reach that path;
     DELETE stays denied for everyone.
   - audit-review index support (T8): `ix_audit_events_tenant_actor_at`,
     `ix_audit_events_tenant_correlation`.
3. Grants per house style (erp_app/erp_readonly/erp_definer on new tables;
   EXECUTE on the definer function to erp_app); `_schema_state` → 36;
   catalog drift discipline: ENTITY_CATALOG + tables.registry + A-series fixtures
   for `tenant_offboarding`; check-rls green.

## 2. MFA enforcement policies per role/plan (T4)

- **Policy model** (expand-contract, default = current opt-in):
  - plan level: `plans.mfa_required_role_keys`;
  - tenant level: SETTINGS_REGISTRY key `identity.mfa.policy`
    `{ mode: 'plan' | 'custom', required_roles: string[] }` (mode 'plan' default =
    inherit; 'custom' with `[]` = explicitly optional even when the plan mandates).
  - resolution: tenant 'custom' beats plan; roles matched by role key in the
    login-selected active tenant membership.
- **Enforcement at login** (`LoginService`): mandated role + confirmed factor →
  existing 423 code path (code required); mandated role + NO factor →
  423 `MFA_REQUIRED` with `details.enrollmentRequired = true` (the deadlock is
  real otherwise — enrollment needs a session).
- **Enrollment bootstrap**: `POST /api/v1/identity/mfa/bootstrap` (public; same
  per-IP limiter + per-user counters + argon2 verify; 15-min idle session with
  `mfa_gate_passed = false`; audit `mfa.bootstrap_started`). The session middleware
  short-circuits non-MFA routes with 423 `MFA_ENROLLMENT_REQUIRED` (allowlist:
  `identity/mfa/*`, logout, whoami); `MfaService.verify` flips
  `mfa_gate_passed` for the user's live sessions.
- **Admin-assisted reset** (first route for the seeded
  `identity.mfa.admin_reset`): `DELETE /api/v1/identity/users/:userId/mfa` —
  removes the target's factors + recovery codes, audited `mfa.admin_reset`.
- **Web**: settings → MFA policy card (mode + role multi-select), login form
  handles `enrollmentRequired` → routes to /mfa with the bootstrap exchange,
  /mfa shows the enforced-enrollment notice. i18n AR+EN.
- **WebAuthn/passkeys decision record**: `docs/decisions/DR-024-01-webauthn-passkeys.md`
  — DEFER post-GA (ADR-0015 §4 says not launch-blocking; rationale + revisit
  triggers recorded).
- **Tests**: enforcement matrix (role × plan × tenant-override) db-spec; bootstrap
  flow end-to-end (issue → restricted routes 423 → enroll+verify → gate passes →
  normal routes 200); admin reset + re-gating; M-06/M-07 re-run intact.

## 3. Audit review tooling for tenant admins (T8)

- `/api/v1/audit/events` gains `actorId`, `action`, `correlationId` filters
  (service-side substrates already exist; correlationId added to the store query).
- `GET /api/v1/audit/events/export` — bounded (10k rows) CSV export, audited
  `audit.exported` with the filter set (E-04 discipline).
- Web `/[locale]/audit` — filter form (actor/action/entity/correlation/time range),
  paginated table, correlation-id lookup, export button; NAV_ITEMS entry gated
  `audit.view` (settings group); i18n AR+EN.
- Tests: viewer 403 + denial audit vs owner 200; a seeded forensic question
  ("who posted this invoice") answered from the endpoint alone; export audited +
  bounded.

## 4. Rate-limit & lockout hardening (T5)

- **R-04** per-tenant burst limiter: in-memory keyed limiter in the session
  middleware path (after tenant resolution — authenticated traffic only; the
  anonymous surface stays behind the login/reset limiters), default 1000 req/10 s
  per tenant (env-tunable), 429 `TENANT_RATE_LIMITED` + Retry-After +
  X-RateLimit-* headers; isolation by keyed construction.
- **R-05** per-account reset limiter: `reset-account:{userId}` window (3/h) in
  `RecoveryService` — saturated accounts still get the uniform 200 (no oracle)
  but the email is skipped (no bombing).
- **R-07** cross-surface test: per-user counters shared API/BFF/reset (singleton
  construction asserted at HTTP level across surfaces).
- **R-08** HTTP-level test: header case/XFF-toggle cannot reset windows; IPv6
  rotation is contained by the per-user lockout (R-02 pairing).
- **M-03** cookie DOM probe added to the web security probe suite.

## 5. CSP/headers final pass (T9)

- API origin: global `SecurityHeadersMiddleware` (HSTS, nosniff, DENY +
  frame-ancestors 'none', Referrer-Policy, Permissions-Policy, CSP
  default-src 'none' — JSON API).
- BFF: fixed header set on BFF JSON responses (matcher extension + branch).
- Report-only capture in staging: `CSP_REPORT_ONLY=1` env adds the Report-Only
  variant on the web origin + a capture route that logs + counts.
- Probe suite extension: API-origin header assertions (db-spec HTTP),
  BFF-origin probe, RTL/bidi payload re-run (ui suite reference).

## 6. Tenant offboarding purge (T11)

- `tenancy/application/offboarding/`: OffboardingService (request → read-only
  grace via the subscription read-only machinery → full export → suspend +
  retention window (90-day OQ-009 placeholder) → purge sweep → verification →
  certificate), ExportService (the DATA_PROTECTION §4 step-2 entity list as
  JSON+CSV artifacts + manifest.json with sha256 checksums + entity counts +
  schema version + the ZIP bundle via the files module), PurgeService
  (FK-topological batched delete over the tenant-owned table registry, storage
  prefix wipe, session/device revocation, audit anonymization via the definer +
  one-time nonce, verification count query, `purged_tenants` certificate row,
  platform audit `tenant.purged` + `offboarding.verified`).
- pg-boss daily sweep `tenancy.offboarding.purge` (+ manual platform trigger);
  legal-hold blocks (flag + audit `legal_hold.applied`/`released`); idempotent +
  resumable (state machine on `tenant_offboarding`).
- Platform endpoints: execute (two-person: owner request must exist + platform
  admin), state read, legal-hold set/clear. Tenant endpoints: request (owner,
  typed-name confirmation), export trigger, cancel-during-grace.
- Tests: staging end-to-end drill spec (grace → export manifest checksums →
  suspend → retention elapsed → purge → 0-rows verification → certificate →
  audit anonymized → storage prefix empty → restore impossible); legal-hold
  blocks; cancel path; two-person refusal.

## 7. RLS canary (§3) + support-access review (T12)

- `security.rls_canary` pg-boss job (*/5): known-bad no-GUC SELECT counts over
  the crown-jewel tenant tables — must all be 0; counter + log + alert wiring per
  the funnel-monitoring precedent (any non-zero = SEV-1 process per RISK-010).
- Support-access review: `GET /api/v1/platform/support-sessions/review` over a
  window — every session with grant + end + per-session action counts + the
  explicit gap list (expired-unclosed, zero-action, orphaned proxied reads);
  review-report spec over a staged window.

## 8. Secrets rotation drill (T6) + dependency triage (T7)

- Drill EXECUTED (not described) as db-specs with recorded timings:
  S-01 (DB app password rotation + reconnect), S-03-class app secrets
  (IDENTITY_SECRET_KEY dual-accept window — the envelope keyId already versions
  it; add previous-key acceptance), S-11 (webhook signer dual-secret window),
  S-10 certificate rotation against the fake-authority harness only. §7
  revoke-first checklist walked tabletop-style → recorded in the drill record.
  Drill notes become runbook entries (`docs/operations/SECRETS_ROTATION_RUNBOOK.md`).
- Dependency triage: `scripts/check-deps.ts` (lockfile lint: no `*` ranges on
  prod deps) + `pnpm audit` wiring (CI + local record) + SBOM generation for
  server/web (CI job; local run recorded) + gitleaks full-history local
  substitute (targeted git-history secret scan; the CI gitleaks job is the
  authoritative full-history gate) — all outputs recorded in the findings log
  §dependency triage.

## 9. Docs & compliance surface (T10/T13/T14)

- `docs/operations/security-findings.md` — the living findings log (T1 scaffold,
  T2 same-day ingestion, T3 fix+retest proofs).
- OQ-009 decision record + AR+EN privacy-notice drafts (T10).
- THREAT_MODEL.md update cycle (T13): every surface shipped through PHASE-023
  has rows (submission registry, certs, commerce import, payouts, bank parsers,
  sync endpoints, native clients, updater S-15, webhook ingress), re-scored,
  residual-risk owners named.
- Public disclosure policy page AR+EN (`/[locale]/security`) + security@ contact
  + on-call routing note (T14).
- FEATURE_CATALOG §25 protocol for the two new keys; ENTITY_CATALOG row for
  `tenant_offboarding` (+ the two platform tables noted); SUBSCRIPTION_AND_
  ENTITLEMENTS platform-provided note.

## 10. Gates (T15) + completion

- Full security gate re-run on the GA candidate: A1–A11 expanded, M/U/E/D/R
  series, RLS canary green, permissions-drift 244=244, i18n parity, docs
  validation — output attached as the PHASE-025 baseline evidence.
- Completion report + IMPLEMENTATION_STATUS (PHASE-024 COMPLETE with the
  honestly-recorded external-leg + OQ-009 BLOCKED-EXTERNAL items) +
  CURRENT_STATE + CHANGELOG + NEXT_ACTION → PHASE-025.
