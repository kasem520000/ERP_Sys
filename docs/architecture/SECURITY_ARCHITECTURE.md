# Security Architecture

> **Status:** STABLE · **Owner:** Security Architecture · **Updated:** 2026-10-27

Summary of the security architecture; deep detail lives in [../security/](../security/THREAT_MODEL.md)
(threat model, authorization matrix, data protection, secrets, test plan, incident
response). This document defines the architectural decisions those documents elaborate.

## Trust boundaries and defenses

| Boundary | Threats | Defenses |
|----------|---------|----------|
| Internet → web/app clients | XSS, CSRF, clickjacking | httpOnly cookies (no tokens in JS), CSP, CSRF tokens + SameSite, security headers, SRI for third-party assets |
| Client → API | Credential stuffing, session hijack, injection, tenant spoofing | argon2id + progressive lockout (ADR-0015), rate limiting, zod validation at edge, tenant context from session only, RLS (ADR-0005) |
| API modules ↔ data | Authorization bypass, cross-module leaks | Permission decorators per route, module boundaries (DEPENDENCY_RULES), RLS, tenant-scoped indexes |
| Platform ops ↔ tenants | Insider abuse, support-access misuse | Time-boxed audited support access, least-privilege roles, platform admin approval flows, immutable audit trail |
| Server ↔ external services | Key leakage, callback spoofing | Secrets in vault/env with rotation (see below), adapter isolation (ADR-0010), egress allow-lists per adapter |
| Backups / exports / files | Data exfiltration | Encrypted backups, signed URLs with expiry, export audit events, DLP-lite checks on exports |
| Offline devices | Device loss, tampering, revoked access | Encrypted local DB, OS keychain, device registration + revocation, offline permission snapshots (ADR-0012) |

## Authentication & authorization

- AuthN: sessions (web) / device tokens (native) per [ADR-0015](ADR/ADR-0015-authentication.md).
- AuthZ model: **roles → permissions → scope** (tenant-wide or branch-scoped), evaluated
  server-side on every request; UI visibility is derived and never authoritative
  (directive §9). Matrix: [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md).
- Financial approvals are separate permissions (`*.approve` distinct from `*.create`,
  `*.post`), with configurable approval limits per role (see
  [../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)).

## Data protection

- In transit: TLS 1.2+ everywhere; HSTS on web origins.
- At rest: encrypted volumes (managed DB + object storage encryption); encrypted local
  SQLite on devices; secrets never in code or logs.
- PII minimization: partner contact data limited to business needs; national IDs only
  where a jurisdiction pack requires them for e-invoicing (documented per pack).
- Deletion: tenant offboarding exports then purges per retention policy
  ([../security/DATA_PROTECTION.md](../security/DATA_PROTECTION.md)); audit events are
  retained (integrity chain), with tenant identifiers hashed in retention-exceeding
  archives per legal review (OQ-009).

## Secrets management

- Dev: `.env` files (gitignored) + docker-compose secrets; CI: OIDC-based cloud creds or
  scoped tokens; Production: managed secret store (cloud KMS-backed) with documented
  rotation runbook ([../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md)).
- Tax-authority signing keys (ZATCA certificates) are the highest-sensitivity secrets:
  stored encrypted, accessed only by the signing job, usage audited
  ([../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md)).

## Audit

- `audit_events` are append-only (no UPDATE/DELETE grants to the app role), recorded by
  an interceptor + explicit domain calls, carrying: actor, tenant, action, entity
  before/after (JSONB), request correlation id, device id where applicable.
- Audit writes occur in the same transaction as the state change when possible; when
  not (async notification side effects), the event references the originating
  transaction id.

## Security testing gates (per phase)

Each phase's exit criteria include the applicable gates from
[../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md): dependency audit
(npm audit + lockfile lint), SAST pass, tenant-isolation attack tests for new tables,
permission tests for new routes, rate-limit tests on new public endpoints, secrets scan
(gitleaks) — all wired into CI from PHASE-001.

## Incident response

Severity ladder, on-call expectations, communication templates, and postmortem process:
[../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md). Platform-level
incidents (cross-tenant) are Severity-1 by definition.
