# ADR-0015 — Authentication: argon2id + Server Sessions + TOTP MFA + Device Tokens

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

Users are business owners, accountants, cashiers, reps, plus platform operators and
(later) external personal-account users. Threats include credential stuffing, XSS token
theft, CSRF, session hijacking, and insider misuse. Directive §7 requires password and
credential security, session management, MFA roadmap, API authentication, rate limiting,
and account recovery. No external identity provider is mandated; an in-house identity
module keeps the dependency surface small and offline/packaging simple.

## Decision

1. **Password hashing: argon2id** (memory 64MB, iterations 3, parallelism 1 — tuned at
   implementation; parameters stored per-hash for upgrades). Password policy: min length
   10 + breached-password rejection; no forced rotation; no security questions.
2. **Sessions for web**: opaque server-side session records (rotating id, hashed in DB,
   absolute timeout 12h + idle timeout 30min, server-side revocation list per user). The
   browser holds only an `httpOnly`, `Secure`, `SameSite=Lax` cookie. CSRF: double-submit
   token + `SameSite` for the BFF surface ([ADR-0003](ADR-0003-nextjs-nestjs.md)).
3. **Device tokens for desktop/Android**: per-device registration → refresh token
   (rotating, one-time-use, bound to device id + key attestation where available) +
   short-lived access tokens (15 min). Revocation kills the device's sync access
   immediately (ADR-0012).
4. **MFA: TOTP** (RFC 6238) with recovery codes, user-enableable from PHASE-003,
   mandatory-able per role/plan policy later. WebAuthn/passkeys are a roadmap item for
   PHASE-024+ (decision record), not launch-blocking.
5. **Rate limiting & lockout**: progressive delays + temporary lock on repeated
   failures (never permanent without admin action); login notifications via email.
6. **Account recovery**: email-based single-use, short-lived reset links (and
   platform-admin-assisted recovery for locked tenants), all audited.
7. **Tenant context** derives from the authenticated membership — never from client
   input (ADR-0005).

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| JWT access/refresh in browser localStorage | XSS theft; no server revocation; worse than cookies for our threat model. |
| OIDC provider (Auth0/Keycloak/Cognito) | Adds cost/dependency; Arabic-first branding constraints; offline packaging complexity; we still need device management + tenant model anyway. Can be introduced later behind the identity module's port if enterprise SSO is demanded. |
| bcrypt/scrypt | Acceptable but argon2id is the current recommendation (memory-hardness); node-argon2 is native but well-maintained. |

## Consequences

- Identity module owns sessions, devices, MFA, recovery; audit events for all of them.
- Enterprise SSO (SAML/OIDC federation) is not in MVP; the identity module defines a
  `UserDirectory` port so a federation adapter can be added without rework (PHASE-024+
  decision).
- Session store is Postgres (simple, durable, RLS-compatible); cache later if needed.

## Revisit triggers

- Enterprise SSO demand → add federated OIDC via the existing port + ADR.
- Passkey adoption in the region matures → promote WebAuthn to first-class.
