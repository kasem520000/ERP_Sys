# PHASE-003 — Identity, Multi-Tenancy & Audit Core

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-003
- **Title:** Identity, Multi-Tenancy & Audit Core
- **Objective:** Deliver the platform's trust substrate: the full `identity` module
  (users, memberships, roles, permissions, sessions, devices schema, TOTP MFA,
  invitations) with argon2id authentication and server-side sessions per
  [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md), the email adapter for
  invitations/resets/notifications, login rate limiting with progressive lockout, RBAC
  enforcement decorators matching the normative
  [AUTHORIZATION_MATRIX](../../security/AUTHORIZATION_MATRIX.md) keys, tenant-context
  middleware implementing the [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md)
  request lifecycle end-to-end (session → membership → GUC → RLS), identity audit events
  recorded through the PHASE-002 `audit` module, and the **first full run** of the
  tenant-isolation attack suite (A1–A11 + API spoof scenarios) against real identity
  tables.
- **Business value:** Every later business module inherits authentication, authorization,
  tenant scoping, and auditability from this phase. Getting identity + isolation right
  once makes RISK-010 (cross-tenant leak — the product-ending risk) structurally
  defended and audited from the first business table onward.

## 2. Scope

In scope:

1. Migration `0003_identity_core.sql` creating the identity cluster exactly per
   [TABLES/tenancy-identity.md](../../database/TABLES/tenancy-identity.md): `users`
   (global, no `tenant_id`), `roles` (system templates with `tenant_id IS NULL`),
   `permissions` (global reference), `role_permissions`, `memberships` (tenant-owned,
   `UNIQUE (user_id, tenant_id)`, `branch_scope uuid[]`), `sessions` (hashed rotating
   tokens, `active_tenant_id` convenience-only), `devices` (schema only — sync is
   PHASE-020), `mfa_factors` (encrypted TOTP secret + hashed recovery codes),
   `invitations` (hashed one-time tokens, 72 h expiry). The `tenants` table stays at its
   PHASE-002 minimal shape — the profile additive migration belongs to PHASE-004.
2. Seeds: the full `permissions` catalog parsed from
   [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) (all modules' keys;
   routes 404 until their phase activates them — matrix §9.4) and the system role
   templates (`owner`, `accountant`, `sales`, `purchasing`, `warehouse`, `cashier`,
   `viewer`, `platform_admin`) with their template grants
   ([SEEDS/README.md](../../database/SEEDS/README.md)).
3. Authentication: argon2id hashing (ADR-0015 parameters: 64 MB / 3 iterations /
   parallelism 1, parameters stored per-hash for upgrades), password policy (min length
   10 + breached-password rejection, no forced rotation, no security questions), opaque
   server-side sessions (rotating id, DB stores hash only, absolute timeout 12 h + idle
   timeout 30 min, per-user revocation), `httpOnly`/`Secure`/`SameSite=Lax` cookie, and
   double-submit CSRF token for the BFF surface
   ([ADR-0003](../../architecture/ADR/ADR-0003-nextjs-nestjs.md)).
4. Login flow: credential verification, session issuance + rotation, progressive
   per-user lockout (`failed_login_count`/`locked_until` — never permanent without admin
   action), per-IP credential-stuffing limits (429 + `Retry-After`), login-notification
   email; identical counters across API/BFF/reset surfaces (R-07).
5. TOTP MFA (RFC 6238): enrollment (secret encrypted per
   [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) envelope rules,
   `confirmed_at` only after code verification), verification on login, one-time-use
   code enforcement, hashed single-use recovery codes with regeneration; user-enableable
   now, policy-mandatory later.
6. Account recovery: email-based single-use, short-lived password-reset links (hashed
   tokens, bound to account, audited); platform-admin-assisted recovery is deferred to
   PHASE-004's console.
7. Invitations: issue (email + tenant role), accept (existing user → membership; new
   user → `PENDING` user + password setup), revoke, expire; every transition audited.
   *Note:* [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) provisionally marks
   `invitations` at PHASE-004; this phase document is authoritative (roadmap reading
   rule) and moves the table + flow to PHASE-003 because the user-management screens and
   email adapter land here — the catalog phase column is corrected at completion
   (§8 documentation updates).
8. Email adapter (`notifications` module skeleton): SMTP adapter with mailpit in dev
   compose; bilingual templates for invitation, password reset, and login notification;
   sends via pg-boss job (ADR-0008 tenant-scoped, idempotent handler rules).
9. RBAC enforcement: `@RequirePermissions` route decorator (the only admission point —
   matrix §8 layer 1), service-layer checks (layer 2), branch-scope resolution primitive
   (stored on membership now; consumed by branch-scoped modules from PHASE-004+),
   permission evaluation in the request context, and the matrix-driven generated
   permission-test checklist (route × role template → 200/403).
10. Tenant-context middleware completing the
    [MULTI_TENANCY.md](../../architecture/MULTI_TENANCY.md) §2 lifecycle: establish
    (session → user → active membership), validate (membership ACTIVE, tenant ACTIVE),
    propagate (AsyncLocalStorage → `SET LOCAL` GUC via the PHASE-002 unit-of-work),
    enforce, clear — plus `POST /identity/sessions/switch-tenant`
    ([API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) §11) and the `PlatformScope`
    marker reserved for PHASE-004 platform routes.
11. Audit wiring: identity actions (`user.login`, `user.login_failed`, `user.locked`,
    `session.revoked`, `membership.created/revoked`, `role.updated`, `mfa.enrolled`,
    `invitation.issued/accepted`, `password.reset_requested`) recorded through the
    PHASE-002 `audit.recordEvent` interceptor — never direct inserts; audit query
    endpoint gated by `audit.view`.
12. Tenant-isolation attack suite, **first full run** per
    [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §1: A1–A10 generated
    over every tenant-owned table via the registry (`isolation/tables.registry.ts`), the
    S-01/S-02/S-03 API spoof scenarios for session/membership routes, session-fixation
    and body-`tenant_id` sweeps, plus the structural catalog assertions (RLS + FORCE +
    `USING`/`WITH CHECK` + composite tenant FKs).
13. Session/MFA and rate-limit abuse suites M-01…M-10 and R-01…R-08
    ([SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §5–6) as automated
    CI tests.
14. Minimal in-app user management screens with **admin-neutral provisional styling**
    (no design system yet — PHASE-005 restyles): login, MFA setup, users list, invite
    form, roles editor, active-sessions revoke. All strings AR+EN via the i18n
    scaffolding (locale switch sets `<html lang dir>` per
    [RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md) §2).

Out of scope (explicit):

- Tenant registration / onboarding / tenant profile columns / branches / entitlements /
  plans / platform admin console (all PHASE-004).
- Any design-system components or visual baselines (PHASE-005).
- Device token issuance + sync flows — `devices` schema exists, nothing reads it
  (PHASE-020/021/022).
- WebAuthn/passkeys and federated SSO — the `UserDirectory` port is *declared* in the
  identity module's api surface, no adapter (ADR-0015 revisit triggers; PHASE-024+).
- In-app notification center (PHASE-015) — only the email adapter ships here.
- Personal-account portal identities ([AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  §6 — PHASE-022).
- CSP verification probe (SECURITY_TEST_PLAN §8 — lands with the app shell, PHASE-005).

## 3. Prerequisites

- Required phases: **PHASE-002 COMPLETE** — consumed artifacts: Drizzle migration
  workflow + `NNNN_description.sql` convention, RLS policy macro + CI catalog check,
  `audit_events` append-only table + `audit` module (`recordEvent`/query), tenant
  unit-of-work (`SET LOCAL erp.tenant_id` + AsyncLocalStorage), pg-boss on `boss`
  schema, `files` module, `/health/ready`, Testcontainers CI job. Verified via
  `docs/implementation/phases/reports/PHASE-002-COMPLETION.md` + green CI +
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) row.
- Required architecture decisions:
  [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md) (argon2id, sessions,
  CSRF, TOTP, lockout policy — binding parameters), [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md)
  (context from session, never client input; 3-layer isolation),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (UUIDv7 ids),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (tenant-scoped idempotent
  job handlers for email), [ADR-0002](../../architecture/ADR/ADR-0002-typescript-monorepo.md)
  (contracts-first), [ADR-0003](../../architecture/ADR/ADR-0003-nextjs-nestjs.md)
  (BFF session surface).
- Relevant documentation:
  [TABLES/tenancy-identity.md](../../database/TABLES/tenancy-identity.md) column
  specs, [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §tenancy-identity,
  [DATABASE_CONVENTIONS.md](../../database/DATABASE_CONVENTIONS.md) (standard columns,
  enum policy, composite FKs), [MULTI_TENANCY.md](../../architecture/MULTI_TENANCY.md),
  [TENANT_ISOLATION.md](../../database/TENANT_ISOLATION.md),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md),
  [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md),
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md),
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md),
  [AUTHENTICATION.md](../../api/AUTHENTICATION.md),
  [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md),
  [THREAT_MODEL.md](../../security/THREAT_MODEL.md) (S-02 stolen session, S-11
  permission elevation, S-12 rate-limit evasion).

## 4. Design Impact

- **Database changes:** 9 new tables (8 identity + invitations) + 2 seed sets
  (`permissions`, `system_role_templates`). `users`, `permissions`, `devices`,
  `mfa_factors` are global/user-owned (no `tenant_id`, no tenant RLS — access is
  service-mediated and permission-checked); `memberships`, `invitations` are tenant-owned
  with the standard RLS policy via the PHASE-002 macro; `sessions` is user-owned with
  `active_tenant_id` as convenience only. Composite tenant FKs where parents are
  tenant-scoped (`memberships.role_id` → `roles(id, tenant_id)`). All entries added to
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + TABLES + ERD in-phase (sync
  rule, [MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md) §6).
- **API changes:** `/api/v1/identity/auth/login|logout`, `/identity/sessions` (list,
  revoke, `switch-tenant`), `/identity/users`, `/identity/invitations` (+ `/accept`),
  `/identity/mfa/enroll|verify|recovery-codes`, `/identity/password/reset-request|reset`,
  `/audit/events` (query). All follow
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md): plural kebab resources,
  `Idempotency-Key` required on POSTs, cursor pagination, ERROR_MODEL envelopes,
  `X-Request-Id` propagation, 404-on-foreign-id (A7). Contracts in
  `packages/contracts/src/identity`.
- **UI changes:** provisional-styled auth + user-management screens (no archetypes
  formally instantiated — PHASE-005 introduces them; these screens are re-skinned then).
  RTL/LTR locale switch proven on every screen.
- **Security & authorization:** permission keys seeded verbatim from
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) (identity.*,
  tenancy.*, audit.*, platform.* catalog rows; unused-before-phase keys exist but their
  routes 404). New attack-surface tests: A1–A10 on `memberships`/`invitations`, S-01
  membership switch, S-02 suspended tenant (state exists; enforcement completes in
  PHASE-004 when suspension action ships), S-03 forged tenant headers, M-01…M-10, R-01…R-08.
- **Accounting implications:** none functional. The audit trail and per-actor/
  correlation-id discipline built here are the substrate for future INV enforcement
  (posted-document audit events, `via_platform_admin` flagging from PHASE-004).
- **Localization implications:** AR+EN string catalogs for all auth flows (i18n
  scaffolding: typed keys, parity check); `Accept-Language`-driven error messages with
  locale-independent codes; bilingual role names (`name`/`name_ar`) rendered per locale;
  Arabic emails render RTL (plain-text-first templates).
- **Offline implications:** none active. `devices` schema exists for PHASE-020; the
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md) row
  #20 (admin actions ONLINE-ONLY) is registered as policy.
- **Module dependencies:** `identity` (new) → `shared-kernel`; `tenancy` context
  primitive extended (membership resolution); `audit` consumed via interceptor (no
  direct writes); `notifications` email adapter skeleton → `identity` (user lookup) —
  matches the dependency graph in [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0003_identity_core.sql`: 8 identity tables + invitations; constraints, composite tenant FKs, RLS via macro, `ix_sessions_user_expires` | `apps/api/migrations/0003_identity_core.sql`, `apps/api/src/modules/identity/infrastructure/schema/*` | migration fresh+regression CI; RLS catalog check; A1–A5 generated suite green |
| T2 | Seeds: `permissions` catalog + system role templates; docs-drift CI check (seed ↔ AUTHORIZATION_MATRIX table diff) | `apps/api/seeds/permissions*.sql`, `apps/api/seeds/system_role_templates.sql`, `scripts/check-permissions-drift.ts` | drift script exits 0 on current docs; negative fixture (missing key) fails |
| T3 | Argon2id password service + policy (length, breached-password list check) | `apps/api/src/modules/identity/domain/password.ts`, `application/password-service.ts` | unit: hash/verify, param storage, policy rejects weak/breached |
| T4 | Session service: issue/rotate/revoke, timeouts (12 h absolute / 30 min idle), cookie + CSRF double-submit, revocation list | `apps/api/src/modules/identity/application/session-service.ts`, `presentation/*` | M-01, M-02, M-03 (DOM probe), M-04 rotation/fixation |
| T5 | Login flow + progressive lockout + per-IP rate limits + login-notification email | `apps/api/src/modules/identity/application/login-service.ts`, `infra/rate-limiter/*` | R-01…R-08 (lockout progression, cross-IP per-user lock, 429 + Retry-After, counter persistence across surfaces) |
| T6 | TOTP MFA: enrollment (encrypted secret), verify, one-time-use, recovery codes (hashed, regenerating) | `apps/api/src/modules/identity/application/mfa-service.ts` | M-06 (code replay rejected), M-07 (recovery single-use + audit) |
| T7 | Password reset: single-use short-lived token (hashed), reset flow, audit | `apps/api/src/modules/identity/application/recovery-service.ts` | M-08 (reuse/expired/cross-account rejected) |
| T8 | Invitations: issue/accept/revoke/expire; membership creation on accept; PENDING user path | `apps/api/src/modules/identity/application/invitation-service.ts` | accept creates membership; expired/revoked rejected; token single-use |
| T9 | Email adapter: SMTP + mailpit dev profile; AR/EN templates (invitation, reset, login notice); pg-boss send job (tenant-scoped, idempotent) | `apps/api/src/modules/notifications/**` | job executes once per duplicate enqueue; mailpit receives rendered AR + EN bodies |
| T10 | RBAC: `@RequirePermissions` decorator + permission evaluator + branch-scope context; generated route×role permission checklist in CI | `apps/api/src/infra/auth/*`, `packages/contracts/src/identity/permissions.ts` | anonymous→401; no-permission→403+audit; matrix checklist green |
| T11 | Tenant-context middleware + `switch-tenant` endpoint + `PlatformScope` marker type | `apps/api/src/infra/context/*` | S-01 (own membership switch OK; non-member → 404), S-03 (headers ignored, generated sweep) |
| T12 | Audit wiring for all identity actions + `/audit/events` query (audit.view-gated) | `apps/api/src/modules/identity/**`, `apps/api/src/modules/audit/presentation/*` | every action writes one event; UPDATE/DELETE on audit_events still rejected (P-002 guards hold) |
| T13 | Attack suite registration + first full A1–A10 run + structural assertions | `tests/isolation/**`, `tests/isolation/tables.registry.ts` | full suite green on fresh PG; registry CI check (new tenant table without row fails) |
| T14 | Provisional UI screens + i18n scaffolding (AR+EN catalogs, parity check script) | `apps/web/src/app/(auth)/**`, `apps/web/src/app/(admin)/users/**`, `apps/web/src/i18n/*` | login journey AR (RTL) + EN via Playwright smoke; key-parity script green |
| T15 | Docs sync: ENTITY_CATALOG/TABLES/ERD phase markers, DEVELOPMENT_SETUP auth section | `docs/database/**`, `docs/operations/DEVELOPMENT_SETUP.md` | docs validation script green |

## 6. Verification

**Automated tests (required):**

- Isolation: A1–A10 generated per registered tenant-owned table (`memberships`,
  `invitations`, plus re-run of `audit_events`), with expected outcomes exactly per
  [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) §2; A7 404
  parity on every id route (timing-insensitive); S-01/S-02/S-03 scenario tests.
- Sessions/MFA: M-01 (idle 30 min), M-02 (absolute 12 h), M-03 (cookie flags + JS probe
  finds no token), M-04 (rotation kills old id), M-06 (TOTP replay), M-07 (recovery
  single-use), M-08 (reset token reuse/expiry), M-10 (owner revokes another user's
  session → dead immediately).
- Rate limiting/lockout: R-01…R-08 including R-04 (per-tenant burst isolation with
  quota headers) and R-07 (same counters via API/BFF/reset).
- Permissions: generated checklist (route × role template → 2xx/403), risky-action audit
  on success and denial; seed↔matrix drift check.
- Unit: argon2 param handling, password policy, token hashing, TOTP window logic,
  email template rendering (AR+EN byte snapshots).
- Failure cases are mandatory for each flow: wrong password (no user-existence leak in
  response shape/timing), locked account, expired invitation, revoked session, CSRF
  token missing/mismatched → 403.

**Manual verification:**

1. `docker compose up` → register a seeded test tenant (fixture path), log in AR locale
   → RTL login screen; switch to EN → LTR; session cookie flags visible in devtools.
2. Invite a new user via mailpit → accept → set password → membership appears with the
   chosen role; reusing the invitation link fails.
3. Enable TOTP (scan secret), verify a code, use one recovery code, confirm reuse is
   rejected and audit rows exist.
4. Trip the lockout with repeated failures → temporary lock, then recovery via reset
   email; confirm admin cannot be permanently locked without admin action.
5. Inspect `\d memberships` → RLS enabled+forced with USING/WITH CHECK; run one attack
   query by hand as `erp_app` without GUC → 0 rows.

**Acceptance criteria (objective):**

1. A user logs in with argon2id-verified credentials and receives a rotating,
   httpOnly/Secure/SameSite=Lax session cookie; M-03 DOM probe proves no token readable
   from JS.
2. Repeated failed logins produce progressive delays → temporary lock
   (`locked_until`), never permanent without admin action; success resets
   `failed_login_count`; counters are shared across API/BFF/reset (R-01/02/07 green).
3. TOTP enrollment only sets `confirmed_at` after code verification; same-code replay
   and recovery-code reuse are rejected with audit events (M-06/M-07).
4. Idle 30 min and absolute 12 h timeouts invalidate the session (M-01/M-02); login and
   membership switch rotate the session id and kill the old one (M-04).
5. Every protected route enforces its AUTHORIZATION_MATRIX permission: anonymous → 401,
   wrong role → 403 + audit, correct role → 2xx; generated checklist is green in CI.
6. Tenant context is never client-supplied: body/header `tenant_id` and forged
   `X-Tenant-Id` variants are ignored or rejected (S-03 sweep); switching to a
   non-member tenant returns 404 with no information leak (S-01).
7. A1–A10 pass against every registered tenant-owned table; adding a tenant-owned table
   without a registry row fails CI (negative proof); UPDATE/DELETE on `audit_events`
   remains impossible.
8. Every identity action in scope writes exactly one audit event (actor, action,
   entity, before/after where applicable, correlation id); the audit query endpoint is
   gated by `audit.view`.
9. `permissions` seed diff against [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
   is empty (docs-drift check green).
10. Invitation + reset + login-notification emails are delivered through mailpit in dev,
    rendered in both AR and EN, with single-use hashed tokens.
11. Zero GL/business tables touched: `journal_*`, trade tables absent; grep proves no
    business module code beyond identity/tenancy/audit/notifications skeleton.
12. All auth strings exist in both AR and EN catalogs; the parity check is green and the
    login journey passes a Playwright smoke in both directions.

**Performance & security considerations:** argon2 parameters documented + measured
(login p95 ≤ 1 s dev-class hardware); rate limiter counters are cheap (no DB write on
the hot path beyond failed attempts); sessions indexed for reaping (`ix_sessions_user_expires`)
with a reaper job; no secrets in logs (redaction serializer covers tokens/hashes);
gitleaks + SAST gates stay green; password hashes and TOTP secrets never appear in
audit `before`/`after` payloads.

**Migration & rollback:** single additive migration `0003` + idempotent seed migrations;
no destructive change to PHASE-002 objects. Forward-only per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md); dev/staging rollback =
revert application image (expand-phase compatible).

## 7. Risks and Constraints

- RISK-010 (cross-tenant leak): the attack suite is the phase's core deliverable, not a
  garnish — a red A-row blocks completion regardless of feature pressure.
- RISK-019 (agent drift): scope discipline — no tenant provisioning, no design system,
  no device flows here; "while I'm here" additions are review blockers.
- Native-dependency risk: `node-argon2` build failures — pin exact version, verify in CI
  matrix on day one; fallback to `@node-rs/argon2` only via decision record.
- Email deliverability is explicitly out of budget: dev uses mailpit; production SMTP
  provider selection is an operations decision record (post-phase).
- Constraint: sessions live in Postgres (ADR-0015 consequence) — fine at this scale;
  cache layering is a documented revisit trigger, not phase scope.

## 8. Completion and Handoff

- **Completion evidence:** completion report at
  `docs/implementation/phases/reports/PHASE-003-COMPLETION.md` containing: full A1–A10
  suite output per registered table, S-01/S-02/S-03 results, M-01…M-10 and R-01…R-08
  results, permission-checklist summary, seed↔matrix drift output, mailpit screenshots
  (secondary) + rendered template text, migration CI logs, and the list of invariants
  gaining audit-substrate coverage (none yet — stated explicitly).
- **Documentation updates required:** [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-003 → COMPLETE + tag), CHANGELOG entry,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + TABLES + ERD (phase markers;
  `invitations` corrected 004→003), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  §3.9 if any key names changed (they must not — matrix is normative),
  `docs/operations/DEVELOPMENT_SETUP.md` (auth/mailpit section). Acceptance criteria
  copied into `planning/PHASE_ACCEPTANCE_CRITERIA.md` (file planned by the planning
  workstream — currently a dangling reference repo-wide; noted in this phase's report).
- **Exit criteria:** all 12 acceptance criteria green with evidence; CI green including
  the isolation suite as a required check; docs validation green; no TODOs in the
  identity module.
- **Definition of Done:** a clean clone boots compose, a fixture tenant's owner can log
  in, invite a colleague, enable MFA, and every request they make is tenant-scoped and
  permission-checked — provable from CI artifacts alone.
- **Handoff instructions:** read PHASE-002 + PHASE-003 completion reports first. The
  identity/audit/isolation substrate is now frozen — changes need decision records
  (implementation README ground rule 5). The `PlatformScope` marker and system role
  templates are the entry points the next phase consumes. **Next eligible phase:
  PHASE-004 — Tenant Provisioning & Platform Administration** (identify only; do not
  implement).
