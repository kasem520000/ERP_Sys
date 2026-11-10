# TABLES — Tenancy & Identity Cluster

> **Status:** STABLE · **Owner:** Database Architecture · **Updated:** 2026-11-05 · **Phases:** 002–004 (subscriptions 014, devices-sync 020, billing payouts 023)

Column-level specification for the tenancy & identity cluster, consistent with
[ENTITY_CATALOG.md](../ENTITY_CATALOG.md), [DATABASE_CONVENTIONS.md](../DATABASE_CONVENTIONS.md),
[DATA_DICTIONARY.md](../DATA_DICTIONARY.md) (standard columns, enums, code rules), and
the [ERD/tenancy-identity.md](../ERD/tenancy-identity.md) diagram. Drizzle schema is the
machine-readable mirror (sync rule, [README.md](../README.md)). All tables below are
tenant-owned + RLS unless noted.

Standard columns (`id uuid PK UUIDv7`, `created_at`, `updated_at`, `version`, and
`created_by` where a user context exists) apply per [DATABASE_CONVENTIONS.md](../DATABASE_CONVENTIONS.md) §5
and are **listed once here, not repeated per table** unless a table deviates. Types per
[ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md); enums per
[DATA_DICTIONARY.md](../DATA_DICTIONARY.md) §9.

> **PHASE-003 delivery notes** (migration `0003_identity_core.sql` + seeds
> `0004_permissions_seed.sql` / `0005_system_role_templates_seed.sql`,
> honest deviations recorded in the phase report): all nine identity tables
> ship exactly per the column specs above. Deviations and additions:
> - `users` gains no extra columns; email shape is enforced (`lower(email)` +
> `@`), `failed_login_count` CHECK ≥ 0, status/locale CHECKs per DATA_DICTIONARY.
> - `sessions` re-anchors `created_at` on rotation so the 12 h absolute window
>   survives id-token rotation (AUTHENTICATION §1/M-02); `expires_at` carries
>   the sliding 30-min idle window.
> - `mfa_factors` gains `DELETE` grant for the app role (stale PENDING
>   enrollment replacement — the confirmed factor is unique per user via the
>   partial unique index; no other user-owned table allows DELETE).
> - `role_permissions` carries the composite FK columns `(role_id, tenant_id)`
>   per the §`role_permissions` spec (template grants: `tenant_id IS NULL`).
> - RLS shape: `memberships`/`invitations` via the PHASE-002 macro;
>   `roles`/`role_permissions` use command-specific variant policies
>   (SELECT: own rows + templates; UPDATE: templates visible but WITH CHECK
>   own-tenant only; INSERT/DELETE: own-tenant only) + a `template_seed`
>   policy (TO erp_migrate, `tenant_id IS NULL` only) — the app role can
>   never forge, mutate, or delete a system template (proven by the attack
>   suite; PostgreSQL ORs an ALL policy's USING into DELETE, hence the
>   command-specific split).
> - Pre-GUC identity resolution: three `SECURITY DEFINER` projections owned
>   by a dedicated NOLOGIN BYPASSRLS role `erp_definer`
>   (`erp.user_membership_options`, `erp.user_effective_permissions`,
>   `erp.invitation_by_token`) — FORCE RLS binds even the table owner, so the
>   definer functions MUST bypass it; they take a proven user id or an exact
>   token hash, never a forgeable tenant id (PHASE-003 §2.10/§2.11).
> - Seeds: `permissions` = 199 keys parsed verbatim from AUTHORIZATION_MATRIX
>   §3 (docs-drift checker `scripts/check-permissions-drift.ts`), 9 system
>   role templates (owner, accountant, sales, purchasing, warehouse, cashier,
>   viewer, payroll_officer, platform_admin) with 413 template grants;
>   `identity.mfa.manage` is self-scope ("every user (self)") — granted by
>   the permission evaluator at runtime, never through a template.
> - Expand-phase FK delivered as documented: `audit_events.actor_id →
>   users(id)` (device_id waits for PHASE-020 rows).

## `tenants` — customer organizations (PHASE-002 minimal → 003 full profile)

> **PHASE-002 delivered substrate** (migration `0001_core_infra.sql`): `id`, `name`,
> `name_ar`, `status` (ck: `PENDING | ACTIVE | SUSPENDED`), standard columns, RLS
> (ENABLE+FORCE) with the platform-scope policy `TO erp_app, erp_readonly`, grants
> SELECT/INSERT/UPDATE to `erp_app` (no DELETE), owner `erp_migrate`. The full profile
> columns below arrive with PHASE-003/004 as additive migrations.

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id` | uuid | no | — | PK (UUIDv7) | Technical identity |
| `name` | text | no | — | — | Primary (EN or AR) display name |
| `name_ar` | text | yes | — | — | Arabic name (bilingual pattern) |
| `status` | text | no | `ACTIVE` | ck: `ACTIVE \| SUSPENDED \| OFFBOARDED` | Suspension blocks logins+jobs; OFFBOARDED = retention window state (OQ-009) |
| `base_currency` | char(3) | no | — | FK → `currencies.code` | The single bookkeeping currency (A-003) |
| `country_code` | char(2) | no | — | FK → seeded countries | Primary jurisdiction (pack default) |
| `timezone` | text | no | `'UTC'` | IANA name (validated) | Display timezone for reports/audit |
| `industry_template_key` | text | yes | — | references seeded `industry_templates.key` | Applied template (nullable until onboarding picks one, PHASE-004/015) |
| `deleted_at` | timestamptz | yes | — | — | Offboarding soft-delete (data enters retention window) |

RLS: platform-scope GUC path ([TENANT_ISOLATION.md](../TENANT_ISOLATION.md) §3) — the
tenancy module's services are the only readers/writers.

## `branches` — operating units (PHASE-004)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` + standard | — | — | — | `UNIQUE (id, tenant_id)` | composite-FK anchor |
| `code` | text | no | — | `uq_branches_tenant_code` | Per-tenant code |
| `name` / `name_ar` | text | no / yes | — | — | Bilingual name |
| `address` | jsonb | yes | — | — | Structured address (line/city/country) — display data only |
| `is_active` | boolean | no | `true` | — | Inactive branches block new documents, keep history |

## `users` — global identity (PHASE-003)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id` | uuid | no | — | PK (UUIDv7) | Global (not tenant-scoped — no `tenant_id`) |
| `email` | text | no | — | `uq_users_email` (case-insensitive) | Login identity |
| `phone` | text | yes | — | `uq_users_phone` (where not null) | Optional second factor / recovery channel |
| `full_name` | text | no | — | — | Display name (single field; locale display is enough) |
| `password_hash` | text | no | — | — | Argon2id per [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md); never logged |
| `status` | text | no | `PENDING` | ck: `PENDING \| ACTIVE \| LOCKED \| DEACTIVATED` | PENDING = invited/never logged in; LOCKED = failed-login lockout (`locked_until`) |
| `locale` | text | no | `'ar'` | `ar \| en` | UI default; users switch per session |
| `failed_login_count` | int | no | `0` | — | Reset on success; drives lockout |
| `locked_until` | timestamptz | yes | — | — | Transient lockout timestamp |
| `last_login_at` | timestamptz | yes | — | — | Security monitoring |

## `memberships` — user ↔ tenant with role (PHASE-003)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` + standard | — | — | — | composite FKs | — |
| `user_id` | uuid | no | — | FK → `users(id)` | — |
| `role_id` | uuid | no | — | composite FK → `roles(id, tenant_id)` | Tenant role at join time |
| `branch_scope` | uuid[] | yes | — | all branches if null; else branch id list | Branch-scoped authorization (documents filtered per branch) |
| `status` | text | no | `ACTIVE` | ck: `ACTIVE \| REVOKED` | REVOKED preserves audit linkage |

`UNIQUE (user_id, tenant_id)` — one membership row per user per tenant (role changes are
updates, audited).

## `roles` — tenant roles + system templates (PHASE-003)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id` | uuid | no | — | PK | — |
| `tenant_id` | uuid | yes | — | `uq_roles_tenant_key (tenant_id, key)`; system templates have `tenant_id IS NULL` (partial unique) | NULL = seeded system template (admin, accountant, cashier…) |
| `key` | text | no | — | — | Machine key (`tenant_admin`) |
| `name` / `name_ar` | text | no / yes | — | — | Display labels |
| `is_system` | boolean | no | `false` | — | System roles can't be deleted; permissions editable only within template rules |

## `permissions` — atomic action catalog (seeded, PHASE-003)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `key` | text | no | — | **PK** (natural: `sales.invoices.post`) | Global reference table: no `tenant_id`, no RLS; read-only to app role |
| `module` | text | no | — | — | Owning module (matches feature-key prefix) |
| `description` | text | no | — | — | Review UI copy |
| `created_at` | timestamptz | no | now() | — | Seed version marker |

## `role_permissions` — grants (PHASE-003)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `role_id` | uuid | no | — | composite FK → `roles(id, tenant_id)`; `UNIQUE (role_id, permission_id)`; ON DELETE CASCADE | — |
| `permission_id` | text | no | — | FK → `permissions.key` | — |
| `granted_at` | timestamptz | no | now() | — | — |
| `granted_by` | uuid | yes | — | — | NULL for template seed grants |

## `sessions` — web sessions (PHASE-003)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id` | uuid | no | — | PK | — |
| `user_id` | uuid | no | — | FK → `users(id)`; `ix_sessions_user_expires` | — |
| `token_hash` | text | no | — | `uq_sessions_token_hash` | Server stores hash only ([ADR-0015](../../architecture/ADR/ADR-0015-authentication.md)) |
| `active_tenant_id` | uuid | yes | — | FK → `tenants(id)` | Selected tenant **convenience only** — authorization derives from `memberships`, never this column |
| `expires_at` | timestamptz | no | — | — | Sliding window per auth policy |
| `revoked_at` | timestamptz | yes | — | — | Explicit logout / security revoke |
| `ip` | inet | yes | — | — | Security audit |
| `device_id` | uuid | yes | — | FK → `devices(id)` | Native-client sessions |
| `last_seen_at` | timestamptz | no | now() | — | Session reaping + anomaly detection |

## `devices` — registered offline-capable clients (schema PHASE-003, sync PHASE-020)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id` | uuid | no | — | PK | — |
| `user_id` | uuid | no | — | FK → `users(id)` | Owning user (personal account device) |
| `platform` | text | no | — | ck: `DESKTOP \| ANDROID` | Client channel (PHASE-021/022) |
| `name` | text | yes | — | — | User label ("Samsung Tab A9") |
| `device_key_hash` | text | no | — | `uq_devices_key_hash` | Device credential (hash only) |
| `last_seen_at` | timestamptz | yes | — | — | Sync health per device |
| `revoked_at` | timestamptz | yes | — | — | Lost/stolen device revocation |

## `mfa_factors` — TOTP enrollment (PHASE-003)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `user_id` (+standard) | — | — | — | FK → `users(id)` | One active TOTP factor per user |
| `kind` | text | no | `'TOTP'` | ck: `TOTP` (extensible by decision record) | Factor type |
| `secret_enc` | text | no | — | — | Encrypted TOTP secret per [../../security/SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) envelope rules |
| `confirmed_at` | timestamptz | yes | — | — | Enrollment complete only after code verification |
| `enrolled_at` / `last_used_at` | timestamptz | no / yes | now() / — | — | Rotation + re-use detection stats |
| `recovery_codes_hash` | text[] | yes | — | — | Hashed one-time recovery codes |

## `invitations` — membership invitations (PHASE-004)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` (+standard) | — | — | — | — | — |
| `email` | text | no | — | — | Invite target (case-insensitive match to users.email) |
| `role_id` | uuid | no | — | composite FK → `roles(id, tenant_id)` | Granted role on acceptance |
| `token_hash` | text | no | — | `uq_invitations_token_hash` | One-time acceptance token (hash only) |
| `expires_at` | timestamptz | no | — | — | Default 72 h |
| `accepted_at` | timestamptz | yes | — | — | Set on acceptance; membership created |
| `status` | text | no | `PENDING` | ck: `PENDING \| ACCEPTED \| EXPIRED \| REVOKED` | — |
| `invited_by` | uuid | no | — | — | Auditable actor |

## `plans` — subscription plans (seeded + admin, PHASE-004)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id` | uuid | no | — | PK | Platform-level table (no tenant) |
| `key` | text | no | — | `uq_plans_key` | `starter / business / enterprise` ([product/DR-001](../../decisions/product/DR-001-pricing-tier-structure.md)) |
| `name` | text | no | — | — | Display label |
| `price_amount` | numeric(19,4) | no | — | `CHECK (price_amount >= 0)` | Recurring price |
| `currency_code` | char(3) | no | — | FK → `currencies.code` | Price currency |
| `billing_period` | text | no | `'MONTHLY'` | ck: `MONTHLY \| YEARLY` | — |
| `limits` | jsonb | no | — | — | Tier limits: seats, documents/month, storage, reports (schema owned by billing module; DR-001 makes values concrete) |
| `feature_keys` | text[] | no | — | — | Entitlement keys granted by this plan |
| `is_active` | boolean | no | `true` | — | Retired plans keep history |

## `subscriptions` — tenant plan assignment (PHASE-014; schema minimal earlier)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` (+standard) | — | — | — | — | — |
| `plan_id` | uuid | no | — | FK → `plans(id)` | Current plan |
| `status` | text | no | `ACTIVE` | ck: `ACTIVE \| PAST_DUE \| CANCELLED` | PAST_DUE drives dunning + soft entitlement expiry |
| `period_start` / `period_end` | date | no / no | — | `CHECK (period_start <= period_end)` | Billed period |
| `provider_ref` | text | yes | — | — | Payment-provider subscription id ([product/DR-002](../../decisions/product/DR-002-payment-provider-selection.md)); NULL = manual invoicing |

## `billing_payouts` — provider payout batches (PHASE-023, migration `0035_external_integrations.sql`)

The PHASE-014 billing substrate's payout leg (T6 payment hardening; the
subscription_invoices/billing_events siblings live in
[ENTITY_CATALOG.md](../ENTITY_CATALOG.md) §reporting & platform jobs — catalog rows
since 014). The row records what the provider **REPORTED** (gross/fee/net per
batch); the refund-payout-service's reconciliation compares against settled
platform payments in the window and reports `RECONCILED` or `DRIFT` with the
reported-vs-computed detail — **drift is NEVER auto-corrected**. Sandbox depth
until [product/DR-002](../../decisions/product/DR-002-payment-provider-selection.md)
decides the provider (production cutover INCOMPLETE with that pointer); refunds
write the `payment.refunded` billing event (the 0035 widen) — the invoice row
stays PAID, history is append-only.

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` (+standard) | — | — | — | `UNIQUE (id, tenant_id)` | — |
| `provider_id` / `provider_ref` | text | no / no | — | `uq_billing_payouts_ref (provider_id, provider_ref)` | Provider identity + its batch reference (idempotent sync) |
| `period_start` / `period_end` | date | no / no | — | `CHECK (period_end >= period_start)` | The reconciliation window |
| `gross_amount` / `fee_amount` / `net_amount` | numeric(18,4) | no | — | `CHECK (net_amount = gross_amount - fee_amount)` | The provider-reported arithmetic, held at rest |
| `currency_code` | char(3) | no | — | — | Settlement currency |
| `status` | text | no | `PENDING` | ck: `PENDING \| RECONCILED \| DRIFT` | The reconciliation outcome |
| `settled_payment_count` | integer | yes | — | — | Platform-computed settlements in the window |
| `reconciled_at` | timestamptz | yes | — | — | Set when RECONCILED |
| `drift_detail` | jsonb | yes | — | — | The reported-vs-computed detail (never auto-corrected) |
| `raw` | jsonb | yes | — | — | The provider row verbatim |

Index: `ix_billing_payouts_tenant (tenant_id, status, period_end)` — the
reconciliation job's PENDING scan + the finance list. Grants:
SELECT/INSERT/UPDATE for `erp_app` (reconciliation marks); RLS macro + isolation
registry.

## `entitlements` — materialized feature grants (PHASE-004)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` (+standard) | — | — | — | `uq_entitlements_tenant_feature` | Re-materialized by the entitlement service (upsert) |
| `feature_key` | text | no | — | — | `module.feature` (permissions catalog prefix space) |
| `source` | text | no | `'PLAN'` | ck: `PLAN \| MANUAL \| PROMO \| TRIAL` | Manual overrides are audited admin actions |
| `expires_at` | timestamptz | yes | — | — | NULL = while source holds; TRIAL/PROMO carry expiry |

## `tenant_settings` — typed key-value config (PHASE-004)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id`, `tenant_id` (+standard) | — | — | — | `uq_tenant_settings_tenant_key` | — |
| `key` | text | no | — | — | Setting key; value schema validated by owning module (INV-022: settings configure, never override math) |
| `value` | jsonb | no | — | — | Typed JSON value; changes write `audit_events` (before/after) |
| `updated_by` | uuid | yes | — | — | Last actor |

## `_schema_state` — migration-state mirror (PHASE-002, `erp` schema, infrastructure)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `key` | text | no | — | PK; ck: length 1..100 | State key (`schema_version`) |
| `value` | bigint | no | — | — | Applied-migration count; every migration upserts its own number (convention, machine-checked by `apps/api` unit tests) |
| `at` | timestamptz | no | now() | — | Last update time |

Reader: `erp.schema_version()` (STABLE, granted to `erp_app`/`erp_readonly`) — the
`/health/ready` migration-state check compares it against the build's migration
manifest. Owner `erp_migrate`; no RLS (no tenant data; infrastructure bookkeeping).

## `audit_events` — immutable audit trail (PHASE-002, append-only 🔒)

| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| `id` | uuid | no | — | PK (UUIDv7) | — |
| `tenant_id` | uuid | yes | — | FK → `tenants(id)`; NULL = platform-scope event | RLS via tenant GUC; platform events via platform-scope path |
| `actor_id` | uuid | yes | — | — | NULL = system/job action (never "unknown user" — the action column says who/what) |
| `action` | text | no | — | — | `entity.updated`, `document.posted`, `user.login`, … (catalog of actions owned by modules) |
| `entity_type` | text | no | — | — | `sales_invoice`, `journal_entry`, `tenant_setting`, … |
| `entity_id` | uuid | yes | — | — | Polymorphic target (audit-only; consumers use `ix_audit_events_tenant_entity_at`) |
| `before` / `after` | jsonb | yes | — | — | State snapshots (redacted per [../../architecture/OBSERVABILITY.md](../../architecture/OBSERVABILITY.md) rules — no secrets, no file bodies) |
| `correlation_id` | uuid | yes | — | — | Request/job correlation (quoted by support) |
| `device_id` | uuid | yes | — | — | Offline-client origin where applicable |
| `at` | timestamptz | no | now() | — | Event time (this is domain data, not a log — OBSERVABILITY §audit-vs-telemetry) |

**Append-only enforcement:** no UPDATE/DELETE grants for `erp_app` + guard triggers
(INV-003 pattern) + RLS both ways. `audit_events` is the substrate every module's audit
requirement builds on ([ENTITY_CATALOG.md](../ENTITY_CATALOG.md) §tenancy).

> **PHASE-002 delivery notes** (migration `0001_core_infra.sql`, honest deviations
> recorded in the phase report): `tenant_id` and `entity_id` ship **NOT NULL** —
> tenant-scoped events are the PHASE-002 surface; the nullable platform-scope variant
> widens via an expand migration when platform actions need auditing (PHASE-004).
> `actor_id`/`device_id` gain their FKs when `users` (PHASE-003) and `devices`
> (PHASE-020) arrive. Indexes as delivered: `ix_audit_events_tenant_at (tenant_id, at)`
> and `ix_audit_events_tenant_entity_at (tenant_id, entity_type, entity_id, at)`.
> Role-level statement timeout (15s) + pool-level timeout form the defense-in-depth
> baseline; grants SELECT/INSERT to `erp_app`, SELECT to `erp_readonly`.

> **PHASE-004 delivery notes** (migrations `0006_tenancy_provisioning.sql` +
> `0007_accounts_schema.sql` + seed migration `0008_platform_seeds.sql`):
> delivered exactly per this table with the following recorded reconciliations —
> **tenants**: profile columns added expand-only (legacy rows backfilled SA/SAR,
> the primary-market default); the status CHECK is the union
> `PENDING|ACTIVE|SUSPENDED|OFFBOARDED` (the delivered PHASE-002 constraint had
> PENDING; the swap keeps legacy rows valid while adding OFFBOARDED — no code
> path creates PENDING tenants). **audit_events**: `tenant_id` is now NULLable +
> `via_platform_admin boolean` added; the single `tenant_isolation` policy
> widened to the platform path (`USING tenant GUC OR platform GUC`;
> `WITH CHECK (tenant GUC) OR (tenant_id IS NULL AND platform GUC)` — a tenant
> session can never forge a platform row and vice versa). **branches**:
> composite anchor `uq_branches_id_tenant (id, tenant_id)` added for future
> document FKs; `ck_branches_code_shape` restricts codes to
> `[A-Za-z0-9_-]{1,20}`. **plans**: additive `name_ar` column (bilingual plan
> labels per PHASE-004 §4; the table spec listed only `name`); RLS = tenant-GUC
> catalog reads OR platform-GUC writes; `plan_seed` policy TO `erp_migrate`
> (seed updates ship as migrations). **subscriptions**: minimal schema only —
> provider lifecycle columns land with PHASE-014. **entitlements**: the upsert
> preserves MANUAL/PROMO rows during plan re-materialization; stale PLAN/TRIAL
> rows from the replaced subscription delete transactionally with it.
> **support_sessions**: `ck_support_sessions_opt_in_or_ticket` enforces the §7
> rule-1 gate at rest; expiry is re-checked lazily on every action (the EXPIRED
> write-back commits on its own UoW). **currencies/countries** were assigned
> P-002 but never delivered — created + seeded in 0006 (12 currencies with
> verified minor units; 10 country records; no `countries` column spec existed
> anywhere — the shape follows SEEDS/README + COUNTRY_PACKS §3, recorded as a
> docs-gap closure). **industry_templates**: list-level rows only (key + labels
> + version + minimal manifest marker); the versioned manifests + apply/switch
> engine land with PHASE-015. **chart_of_accounts_template**: the 42-row §3
> template with 16 purpose markers (1:1 enforced by partial unique index);
> `is_group` resolves the doc's "+ implied" group rows structurally (every
> parent is a group node per V5). **accounts/account_purposes**: created here
> per the phase's documented early-delivery decision (catalog markers synced
> to 004/007); the §2 purposes WITHOUT §3 markers (CASH, PETTY_CASH,
> VAT_RECOVERABLE, ROUNDING_*, OPENING_EQUITY) are deliberately NOT invented —
> instantiation is verbatim 1:1 and the fail-closed `PURPOSE_NOT_MAPPED`
> behavior begins in PHASE-007. The platform-operations tenant
> (`20000000-0000-4000-8000-000000000001`, `Platform Operations` / `عمليات
> المنصة`) is seeded via `erp.seed_platform_tenant()` (SECURITY DEFINER, owned
> by `erp_definer`) with its instantiated platform_admin role — matrix §2
> "platform staff never hold tenant roles" realized on the standard membership
> substrate; the first staff USER is provisioned out-of-band by ops (same
> envelope as role passwords). The pre-GUC entitlement projection
> `erp.tenant_active_entitlements(tenant_id)` (SECURITY DEFINER) feeds the
> BR-039 enforcement guard, mirroring the PHASE-003 identity projections.
