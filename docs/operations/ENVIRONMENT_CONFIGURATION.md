# Environment Configuration

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-10-27

Which configuration exists in each environment, how it is loaded, who owns it, and how it
changes. Topology per environment: [../architecture/DEPLOYMENT_ARCHITECTURE.md](../architecture/DEPLOYMENT_ARCHITECTURE.md).
Local machine bootstrap: [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md).

## 1. Environment matrix

Four environments, one codebase, one configuration contract.

| Config area | `local` | `ci` | `staging` | `production` |
|-------------|---------|------|-----------|--------------|
| Database | Compose `postgres:16` (`erp_dev`, disposable data) | Ephemeral PostgreSQL 16 via Testcontainers per job | Managed PostgreSQL 16 (staging instance), anonymized/synthetic data | Managed PostgreSQL 16, WAL archiving/PITR on ([../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md)) |
| DB credentials | `.env` (dev roles `erp_migrate`/`erp_app`) | Generated in-job, thrown away | Managed secret store | Managed secret store, rotation on schedule |
| Object storage | MinIO (compose) | Testcontainers MinIO (adapter tests only) | Managed object storage, staging bucket (versioning on) | Managed object storage; app bucket + **WORM backup bucket** (object-lock) |
| SMTP | Mailpit (localhost:1025, UI :8025) | None — tests assert spool/contract, no network | Provider sandbox or Mailpit instance | Production email provider (A-008: email-only channel at MVP) |
| Secrets source | `.env` (git-ignored; `.env.example` committed) | OIDC-federated, ephemeral per run | Managed secret store (named env `staging`) | Managed secret store (named env `production`), strict read audit |
| Feature flags | Dev defaults: everything the phase shipped, on | Fixture-pinned per test | Mirror production + test-only flags | Entitlement-driven + rollout flags ([§4](#4-feature-flag-governance)) |
| Log level | `debug` | `info` | `info` | `info` (`debug` forbidden; see [../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md)) |
| Rate limits | Relaxed (never blocks local flows) | N/A (per-test middleware) | Mirror production | Production values per [../architecture/SECURITY_ARCHITECTURE.md](../architecture/SECURITY_ARCHITECTURE.md) |
| Sync intervals (from PHASE-020) | Seconds (fast cycles for testing) | N/A (contract tests) | Production-like | Defaults per [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) |
| Error tracking | None (stdout only) | Not exported (source-map upload only) | Sentry staging project | Sentry production project ([MONITORING.md](MONITORING.md)) |

## 2. Configuration loading rules (normative)

1. **Environment variables only.** Process configuration comes exclusively from the
   environment. There are no config files committed for runtime use, no admin-editable
   process config, and no database-driven process configuration. (`tenant_settings` is
   *domain data* configuring tenant behavior — not process config; the process must run
   with zero tenant rows present.)
2. **Validated at boot by zod.** Every variable is parsed by a zod schema in
   `packages/config` at process start — including worker mode. The parsed, typed result is
   the only way code reads config.
3. **Fail-fast.** A missing or invalid variable aborts boot with a non-zero exit **before
   the process serves traffic or consumes jobs**. No warning-and-continue for
   security-affecting values (`SESSION_SECRET`, DB URLs, storage keys).
4. **No silent production defaults.** Defaults exist only for dev-safe values (ports, log
   level). Anything security- or tenant-affecting must be explicitly set in staging/prod;
   the schema marks such fields `.required()` with no default.
5. **Unknown variables are logged by name only** (never values) at boot — drift between
   `.env.example` and deployment shows up in the first deploy instead of surprising anyone
   later.
6. **Secrets never logged.** Boot logs a non-secret config fingerprint (sorted key names +
   hash of non-secret values) so runs are comparable; the redaction serializer
   ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md)) fail-closes
   accidental serialization of secret-shaped fields.
7. **One template.** `.env.example` is generated from the same zod schema definition (keys,
   examples, comments) — schema and template cannot drift silently; CI's docs/lint gate
   checks the template covers every schema key.

## 3. Secrets per environment

Ownership, storage, and rotation follow [../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md);
summary of responsibilities:

| Environment | Storage | Access | Rotation |
|-------------|---------|--------|----------|
| local | `.env` (git-ignored) + `.env.example` template | Developer | Disposable; regenerate freely |
| ci | GitHub Actions environment secrets + OIDC federation to cloud secret store | Workflows, per-run | Provider-managed, short-lived tokens via OIDC — no long-lived PATs ([CI_CD.md](CI_CD.md) §9) |
| staging | Managed secret store | Deploy pipeline + named engineers (audited) | Quarterly + on staff change |
| production | Managed secret store | Deploy pipeline + on-call leads (break-glass, audited) | Quarterly; session secrets and provider keys per their own policy; DB credentials rotated without downtime using role password change + rolling restart |

Checklist before promoting any environment: no secret in env-var *lists* in docs/wiki; no
secret in job payloads (ids only — ADR-0008 rules); e-invoicing private keys are the
highest-sensitivity class and live only in the secret store with signing-job-only access.

## 4. Feature flag governance

Two mechanisms with different lifecycles — never conflated:

| Property | **Entitlements** | **Rollout flags** |
|----------|------------------|-------------------|
| Purpose | Grant a *plan-purchased* feature to a tenant | Temporarily control exposure of shipped code |
| Storage | `entitlements` (materialized, PHASE-004) from `plans`/subscriptions | `feature_flags` table (PHASE-015) + env-level kill switches for infra concerns |
| Who flips | Billing/admin console actions (audited) | Ops, via admin console or controlled env change |
| Lifetime | As long as the subscription grants it | **Temporary** — every rollout flag carries `expires_at` + owner; expiry reviewed at each release |
| Visibility | Tenant-facing (plan matrix) | Invisible to tenants |

Rules:

1. Entitlement keys are stable `module.feature` identifiers
   ([../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../product/SUBSCRIPTION_AND_ENTITLEMENTS.md));
   they are never reused as rollout flags.
2. Risky paths ship dark: code gated by rollout flag AND entitlement where applicable
   ([../architecture/DEPLOYMENT_ARCHITECTURE.md](../architecture/DEPLOYMENT_ARCHITECTURE.md) §Release).
3. A rollout flag that has been 100%-on for one full release is removed by the owning
   phase's follow-up task — no zombie flags.
4. Rollout-flag flips in production are recorded (who/when/why) in the ops log and
   summarized in `CHANGELOG.md` ops notes; entitlement changes are domain events and write
   `audit_events`.

## 5. Change control for configuration

- **Tenant-affecting config** (`tenant_settings`, plan limits, entitlement overrides,
  approval policies, numbering formats): changes flow through API/admin console endpoints
  only → every change writes an `audit_events` row with before/after. No direct DB edits
  in any environment except scripted migrations.
- **Environment-level config** (env vars for staging/prod): changed via the secret store /
  deployment configuration, then a rolling restart. Each change is announced in the deploy
  note with: variable name (never value), reason, owner, rollback.
- **New variables or changed defaults**: PR that updates (a) the zod schema, (b)
  `.env.example`, (c) this file's matrix, (d) affected runbooks — reviewed like code; a
  new *default* that changes behavior for existing tenants additionally requires a
  decision record ([../decisions/README.md](../decisions/README.md)).
- **Config changes are deploy-independent until restarted**: document which variables need
  a restart (all, by rule §2.2 — config is read at boot only) so nobody "verifies" a
  change that cannot have taken effect.
- **Audit trail**: staging/prod config changes are recorded by the secret store's own
  audit log; tenant-affecting changes by `audit_events`; both are checked during quarterly
  access reviews.
