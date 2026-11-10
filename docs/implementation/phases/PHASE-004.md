# PHASE-004 — Tenant Provisioning & Platform Administration

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-004
- **Title:** Tenant Provisioning & Platform Administration
- **Objective:** Make the platform commercially operable end-to-end: a public
  registration flow that creates a tenant with its owner membership; an onboarding
  backend that produces the initial workspace (industry-template choice, CoA template
  instantiation, system role instantiation, numbering defaults, jurisdiction binding);
  branches with branch-scoped membership enforcement; the entitlements service skeleton
  with server-side feature enforcement and manual plan assignment (billing is
  PHASE-014); and the platform admin console — tenant list/search, suspend/restore with
  session-kill + sync-rejection semantics, entitlement editing, audit review, and
  time-boxed audited support access. The `tenants` table grows from its PHASE-002
  minimal shape to the full profile via an additive migration.
- **Business value:** This phase converts the identity substrate into a working
  multi-tenant business: customers can sign themselves up, receive a correctly
  configured workspace in their country's shape, and platform staff can operate and
  support the tenant fleet safely (RISK-003: entitlement model decoupled from plan
  data; RISK-010: platform-scope actions audited).

## 2. Scope

In scope:

1. **Tenant profile migration** (additive, per
   [TABLES/tenancy-identity.md](../../database/TABLES/tenancy-identity.md)): add
   `name_ar`, `base_currency` (FK → seeded `currencies`), `country_code` (FK → seeded
   `countries`), `timezone` (IANA-validated), `industry_template_key`, `deleted_at` to
   the minimal PHASE-002 `tenants` table; extend the `status` check to
   `ACTIVE | SUSPENDED | OFFBOARDED`.
2. **Public registration endpoint + flow** (`platform.registration`): rate-limited
   public POST capturing business name (AR/EN), country, base currency, tax-registration
   status (+ number when registered — per
   [TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §1 registration concepts, stored
   provisionally in `tenant_settings` typed keys `tax.registration.*`; the
   `tax_registrations` table lands in PHASE-009 and migrates these values), and business
   activity selected from the seeded industry-template list. Creates: tenant → owner
   membership (system role template instantiation per
   [SEEDS/README.md](../../database/SEEDS/README.md)) → initial `entitlements`
   materialization → audit events (`tenant.created`, `membership.created`).
3. **Onboarding wizard backend** (`platform.onboarding`, backend only — guided UX is
   PHASE-014): a transactional `provisionWorkspace` service producing the initial
   workspace:
   - instantiate the bilingual **CoA template** from
     [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) §3 into tenant-owned
     `accounts` + `account_purposes` rows (template accounts + purpose markers; posting
     readiness — validations V1–V6, INV-015 guards — is PHASE-007);
   - instantiate the **system role templates** as tenant roles with template grants;
   - write **document-numbering defaults** (per-tenant/branch/type series policies per
     ADR-0006 / BR-029 — policy rows only; the numbering *service* ships in PHASE-007);
   - record the **jurisdiction pack binding** (tenant primary jurisdiction + pack key;
     the versioned `jurisdictions` registry and rates seed in PHASE-009, which
     formalizes the binding and can migrate the provisional keys);
   - seed the tenant's default `fiscal_calendar` preference (start month) as a setting —
     fiscal years/periods themselves are created in PHASE-007.
4. **Branches** (`platform.branches`): `branches` table (code, bilingual name, address
   JSONB, `is_active`), CRUD service, branch registry published to other modules, and
   **branch-scoped membership enforcement** — `memberships.branch_scope` filtering per
   [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §5 (tenant-wide or
   branch-id set; cross-branch references → 403).
5. **Entitlements service skeleton** (`platform.entitlements` +
   `tenancy.subscription` plumbing): seed `plans` (`starter`/`business`/`enterprise`
   per [DR-001](../../decisions/product/DR-001-pricing-tier-structure.md), limits +
   feature_keys as PLACEHOLDER values pending the pricing pass), minimal-schema
   `subscriptions` table (manual assignment rows; billing logic is PHASE-014),
   materialized `entitlements` rows (source `PLAN | MANUAL | PROMO | TRIAL`), server-side
   enforcement middleware: **feature key checked at module load and per action**
   (CONFIGURATION_ENGINE L4 + BR-039), UI visibility derived-only; manual plan/override
   assignment by platform admin (audited). Dependency-closure validation on activation
   (BR-040) against [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) `depends on`
   edges.
6. **`tenant_settings` typed key-value store** (L5): schema-validated writes, before/
   after audit events, cache-invalidation events (`tenant.updated`, `settings.changed`)
   per [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) §9.
7. **Platform admin console** (`platform.admin_console`,
   `platform.tenant_lifecycle`, `platform.support_access`) — provisional styling until
   the PHASE-005 design system:
   - tenant list + search (PlatformScope-marked cross-tenant reads, each use audited
     with `via_platform_admin`);
   - **suspend/restore**: `platform.tenants.suspend`/`restore` with the full
     MULTI_TENANCY §3 rule-6 semantics — sessions invalidated (`tenant.suspended` →
     identity), device pushes / sync pulls rejected with `tenant_suspended`, admin
     console access only; OFFBOARDED state is recorded but the purge flow is PHASE-014;
   - entitlement edit (grant/remove feature keys with source + audit);
   - **audit viewer** (`platform.audit.view`): cross-tenant platform audit review;
   - tenant detail: profile, plan, entitlements, branches, membership list.
8. **Time-boxed audited support access** per
   [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §7 and
   [SECURITY_ARCHITECTURE.md](../../architecture/SECURITY_ARCHITECTURE.md): requires
   `platform.support.access` + tenant opt-in or declared incident ticket; default max
   4 h with auto-expiry; actions execute as the support user with
   `via_platform_admin = true` on every audit event; read-all + explicitly enumerated
   actions only (risky tenant permissions stay with tenant users); tenant can terminate
   an opt-in session; session open/close + every action audited; tenant owners can
   review the support-session trail afterwards.
9. **Administrative audit trail**: platform-scope events (`tenant.created`,
   `tenant.suspended`, `tenant.restored`, `entitlement.granted`, `plan.assigned`,
   `support.session.opened/closed`) with `tenant_id NULL` platform-scope path +
   per-tenant visibility of their own events.
10. **State-machine abuse tests** per
    [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 PHASE-004 row:
    register→suspend→restore cycle abuse, entitlement escalation attempts (tenant-side
    attempts to grant features → 403 + audit), suspended-tenant route access (S-02
    completes: 401/403 `tenant_suspended`), and entitlement/dependency-closure rule
    tests (`entitlements.spec`, `dependency-closure.spec` — first enforcement of
    BR-039/BR-040 per [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) §8).

Out of scope (explicit):

- Billing, checkout, provider integration, dunning, plan pricing values
  (PHASE-014 — values are PLACEHOLDER per OQ-002).
- Onboarding **guided UX polish**, dashboards, role landing pages, tenant branding /
  accent injection (PHASE-014; DESIGN_SYSTEM §6).
- Full tenant data export + offboarding purge execution
  (`platform.data_export`/`tenancy.offboarding.execute` permissions exist in the seed;
  the flows land with PHASE-014 billing/offboarding work — FEATURE_CATALOG's `004`
  marker for `platform.data_export` is corrected then).
- Fiscal years/periods creation, numbering service, posting (PHASE-007).
- Jurisdiction pack data (rates, regimes — PHASE-009); e-invoicing (PHASE-023).
- In-app notification center (PHASE-015); email templates beyond registration/invite.
- Industry template **engine** (apply/switch machinery, manifests enforcement —
  PHASE-015; this phase only lists templates and stores the chosen key).

## 3. Prerequisites

- Required phases: **PHASE-003 COMPLETE** — consumed artifacts: identity tables +
  argon2id auth + sessions + invitations + MFA; `@RequirePermissions` decorator +
  permission seed; system role templates; tenant-context middleware with the
  `PlatformScope` marker; attack-suite registry + harness; audit interceptor. Verified
  via its completion report + green CI + IMPLEMENTATION_STATUS row.
- Required architecture decisions:
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (platform-scope GUC
  path on `tenants`, per-operation tenant scoping for admin actions),
  [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md) (session kill on
  suspension; audited admin-assisted recovery),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (numbering policy
  defaults), [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md)
  (pack binding concept), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)
  (suspension fan-out via events/jobs).
- Relevant documentation: [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)
  (platform module rows), [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md)
  (L3/L4/L5/L7 layers, precedence, cache invalidation),
  [SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-039/BR-040),
  [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) (template + purposes),
  [TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §1 (registration concepts),
  [MULTI_TENANCY.md](../../architecture/MULTI_TENANCY.md) §3 rule 6,
  [TENANT_ISOLATION.md](../../database/TENANT_ISOLATION.md) §3 (platform-scope tables),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.10/§7,
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2/§4,
  [TABLES/tenancy-identity.md](../../database/TABLES/tenancy-identity.md),
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md) row 20.

## 4. Design Impact

- **Database changes:** additive `tenants` profile migration; new tables `branches`,
  `plans` (platform-level, no tenant), `subscriptions` (minimal schema — full billing
  columns PHASE-014), `entitlements` (materialized, upserted by the service),
  `tenant_settings`, and — needed early by onboarding — `accounts` +
  `account_purposes` (tenant-owned; created here for CoA instantiation per
  [SEEDS/README.md](../../database/SEEDS/README.md) "P-004 (instantiation) / P-007
  (posting readiness)"). Note: [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md)
  marks `accounts`/`account_purposes` at PHASE-007; this phase creates the tables and
  the completion report updates the catalog phase column to `004 (schema+template) /
  007 (posting)` — flagged as a doc-sync item, not a silent drift. RLS on every
  tenant-owned table; `plans` is platform-scoped like `tenants`.
- **API changes:** public `POST /api/v1/platform/register` (rate-limited, no auth);
  tenant-scoped `branches`, `settings`, `onboarding` endpoints; platform-scoped
  `platform/tenants` (list/get/suspend/restore), `platform/entitlements`,
  `platform/support-sessions`, `platform/audit/events` — all `PlatformScope`-marked,
  permission-gated (`platform.*`), audited per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) conventions.
- **UI changes:** provisional-styled (pre-design-system) console + tenant settings
  screens: registration form, onboarding wizard screens (functional, unpolished — UX
  polish PHASE-014), branches, users/roles (from PHASE-003, extended with branches),
  platform console (tenant list/detail/suspend/restore/entitlements/audit/support).
  **Explicit note: all console UI is provisional styling until the PHASE-005 design
  system; onboarding UX polish is PHASE-014.**
- **Security & authorization:** new `platform.*` routes enforce the §3.10 catalog and
  are never tenant-assignable; `PlatformScope` cross-tenant reads exist only in the
  tenancy module's services with per-use audit + `via_platform_admin`; suspension
  kills sessions and rejects sync (S-02 becomes fully testable); support access is
  time-boxed, reason-required, and tenant-visible in audit. Attack tests: S-07
  (platform routes without permission → 403; with → audited), state-machine abuse rows
  (§2 row PHASE-004), entitlement escalation attempts.
- **Accounting implications:** no postings. The CoA template instantiation creates the
  purpose-mapping substrate the PHASE-007 posting engine resolves (fail-closed
  `PURPOSE_NOT_MAPPED` behavior begins there). INV-022 discipline: entitlements can
  never alter accounting math (enforced/tested from PHASE-007's config-fuzz suite;
  the resolution layer here already treats invariant checks as below-configuration).
- **Localization implications:** registration + onboarding + console strings AR+EN;
   bilingual plan labels; tenant country drives default locale/currency/date format
   display defaults (consumed from the seeded `countries` table);
   `tenant_settings.general.default_locale` (default `ar`) and
   `general.numeral_system` keys registered in the settings schema per
   [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) §4.
- **Offline implications:** none active; matrix row #20 (admin actions ONLINE-ONLY)
   enforcement confirmed for the new console routes; suspension→sync rejection
   semantics implemented on the API side now (device endpoints arrive PHASE-020).
- **Module dependencies:** `tenancy` (owner of tenants/branches/settings/entitlements)
   → `identity` (memberships, sessions) per
   [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2; `configuration`
   module skeleton registers the industry-template list (engine in PHASE-015);
   in-process events `tenant.suspended`/`tenant.updated`/`settings.changed`/
   `plan.changed`/`entitlements.changed` per
   [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) and
   CONFIGURATION_ENGINE §9.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | `tenants` profile additive migration + `branches`, `tenant_settings`, `plans`, `subscriptions` (minimal), `entitlements` tables; RLS + platform-scope path on `tenants`/`plans` | `apps/api/migrations/0004_tenancy_provisioning.sql` | migration fresh+regression; RLS catalog check; platform-scope mini-matrix (A1–A5 mirrored for the platform GUC path) |
| T2 | `accounts` + `account_purposes` tables (schema for onboarding instantiation) | `apps/api/migrations/0005_accounts_schema.sql` | RLS + composite FK catalog assertions |
| T3 | Plans + industry-template list + CoA template seeds (idempotent, natural keys) | `apps/api/seeds/plans.sql`, `seeds/industry_templates_index.sql`, `seeds/chart_of_accounts_template.sql` | seeds apply idempotently; template row count/purpose markers match [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) §3 |
| T4 | Registration flow: public endpoint + validation + tenant/owner-membership creation + audit | `apps/api/src/modules/tenancy/application/registration-service.ts`, `presentation/public/*` | register→tenant+owner+audit; duplicate email path; rate-limit on the public route |
| T5 | `provisionWorkspace` onboarding service: CoA instantiation + role instantiation + numbering defaults + jurisdiction binding + fiscal preference | `apps/api/src/modules/tenancy/application/onboarding-service.ts`, `apps/api/src/modules/configuration/**` | instantiation is idempotent per tenant; purposes mapped 1:1 (template markers); re-run surfaces diff, never duplicates |
| T6 | Branches CRUD + branch registry + branch-scoped membership enforcement | `apps/api/src/modules/tenancy/application/branch-service.ts`, `infra/auth/branch-scope.ts` | branch-scoped role sees only granted-branch data fixtures; cross-branch ref → 403 |
| T7 | Entitlements service: plan→feature-keys materialization, manual overrides, closure check, enforcement middleware (module load + per action), derived-visibility payload | `apps/api/src/modules/tenancy/application/entitlements-service.ts`, `apps/api/src/infra/auth/require-feature.ts` | `entitlements.spec` (BR-039: server-side only; UI payload is derived), `dependency-closure.spec` (BR-040: POS-style activation rejected when deps missing) |
| T8 | `tenant_settings` typed store + schema validation + change events | `apps/api/src/modules/tenancy/application/settings-service.ts` | unknown key rejected loudly; audit before/after; invalidation event fired |
| T9 | Tenant lifecycle: suspend/restore + session kill + sync-rejection response + `tenant.suspended` event fan-out | `apps/api/src/modules/tenancy/application/lifecycle-service.ts` | S-02 (suspended-tenant route → `tenant_suspended`); sessions dead; restore revives; state-machine abuse pack |
| T10 | Platform console endpoints (list/search, detail, entitlement edit, audit viewer) with `PlatformScope` + per-use audit | `apps/api/src/modules/tenancy/presentation/platform/*` | S-07 (403 without `platform.*`; audited with); escalation attempts (tenant token on platform routes) → 403 + audit |
| T11 | Support access service: grant, time-box expiry, action proxying with `via_platform_admin`, tenant-visible audit, termination | `apps/api/src/modules/tenancy/application/support-access-service.ts` | open requires permission+opt-in/ticket; auto-expiry (clock-advanced test); every action carries the flag; tenant termination works |
| T12 | Provisional console/settings UI screens (registration, onboarding, branches, console) + AR/EN strings | `apps/web/src/app/(public)/register/**`, `apps/web/src/app/(admin)/**` | Playwright smoke: register→onboard→console AR+EN; deep links locale-prefixed |
| T13 | Docs sync: catalog phase markers (`accounts` 004/007, `platform.data_export` deferral note), TABLES/ERD updates | `docs/database/**`, `docs/product/**` | docs validation + schema-catalog drift check green |

## 6. Verification

**Automated tests (required):**

- Isolation: every new tenant-owned table registered in `isolation/tables.registry.ts`
  and the generated A1–A10 suite runs against it; the platform-scope GUC path on
  `tenants` gets its own mini-matrix mirroring A1–A5 (wrong/missing platform GUC → 0
  rows) per [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) §9.4.
- Lifecycle abuse: register → suspend → restore cycles; suspended tenant's session on
  any tenant route → 401/403 `tenant_suspended`; suspended tenant's owner cannot log
  in; restore revives; concurrent suspend vs login race ends safely suspended.
- Entitlements: plan materialization matches plan `feature_keys[]`; manual override
  wins over plan while active; expiry (TRIAL/PROMO `expires_at`) drops the grant;
  enforcement middleware 403s on missing feature key with a typed error; UI payload
  contains only derived visibility (never a grant source of truth);
  dependency-closure rejections list the specific missing feature keys.
- Branch scoping: branch-scoped membership filters documents/fixtures per granted
  branches; tenant-wide roles see all; cross-branch reference → 403 (matrix §5).
- Support access: all §7 rules as tests (time-box, audit flag, risky-action
  denial, tenant termination).
- Onboarding: re-running `provisionWorkspace` is idempotent (no duplicate accounts,
  roles, settings); purposes resolve 1:1; a workspace provisioned for `SA`/`SAR`
  carries the expected template accounts (count + key purposes spot-checked).
- Permission checklist regenerated including all new platform routes (matrix-driven).

**Manual verification:**

1. Register a tenant through the public form (AR): tenant appears in the console with
   owner membership; owner logs in and lands in the (provisional) workspace.
2. Run the onboarding backend via the wizard screens: verify CoA instantiation
   (`\d accounts` rows with bilingual names + purpose mappings), role templates
   instantiated, numbering defaults present in settings.
3. Suspend the tenant as platform_admin → owner's next request fails with
   `tenant_suspended`; console still lists the tenant; restore → owner logs in again.
4. Grant a MANUAL entitlement to a tenant, verify a feature-flagged screen appears for
   its users and disappears after removal (derived visibility, server-enforced).
5. Open a support session (opt-in), act, verify every audit row shows
   `via_platform_admin`, and the tenant owner's audit view shows the session trail.

**Acceptance criteria (objective):**

1. A public registration creates tenant + owner membership + initial entitlements +
   audit events in one transaction; the endpoint is rate-limited and anonymous-safe
   (no enumeration).
2. The onboarding backend instantiates the CoA template (accounts + purpose markers
   per [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) §3), system roles,
   numbering defaults, jurisdiction binding, and fiscal preference — idempotently
   (re-run produces zero duplicates).
3. Branch CRUD works; a branch-scoped membership cannot read/act outside its branches
   (automated proof), and inactive branches reject new documents at the service layer
   (contract test with a stub document type).
4. Entitlements resolve server-side from plan + manual overrides; every feature-gated
   route enforces its feature key (403 + typed error without it); BR-039/BR-040 have
   green first-enforcement tests (`entitlements.spec`, `dependency-closure.spec`).
5. Suspend/restore implements MULTI_TENANCY §3 rule 6 exactly: sessions die, sync-style
   pushes are rejected with `tenant_suspended`, admin console remains accessible;
   every transition is audited with actor + reason.
6. All `platform.*` routes: no `platform.*` permission → 403; with it → success +
   `via_platform_admin` audit; cross-tenant reads outside `PlatformScope` are
   impossible (S-07 green).
7. Support access enforces time-box (auto-expiry proven), audit flagging on every
   action, risky-permission denial, and tenant-side termination + review (all §7
   rules automated).
8. The generated isolation suite is green on all new tables; the registry CI check
   fails if a new tenant-owned table is unregistered (negative proof maintained).
9. Zero GL postings and no fiscal/period/numbering-service code exist (grep + boundary
   check: `accounting` posting engine absent; `accounts` rows are master data only).
10. Plans/entitlements values are explicitly PLACEHOLDER (documented in seeds; OQ-002
    pricing pass pending) — no pricing presented to users anywhere in this phase.
11. Registration/onboarding/console journeys pass AR (RTL) and EN Playwright smokes;
    every new string exists in both catalogs (parity check green).

**Performance & security considerations:** registration endpoint has per-IP +
global rate limits (public surface); console list queries are `PlatformScope`-marked
and paginated (cursor) with statement timeouts; entitlement checks are context-cached
per request (never per query); support-access token expiry checked server-side on every
action; gitleaks/SAST green; plan/limits JSONB schema-validated (no arbitrary flags).

**Migration & rollback:** additive migrations `0004`–`0005` + seed migrations; the
`tenants` change is expand-only (new nullable columns + widened status check) —
previous release remains compatible. Forward-only per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md); rollback = previous
image. The provisional `tax.registration.*` settings keys are documented as migrated by
PHASE-009 (expand-migrate-contract).

## 7. Risks and Constraints

- RISK-003 (pricing/entitlement model wrong): mitigated by decoupling — entitlements
  materialize from plan data that is config; PLACEHOLDER values documented; no pricing
  UX ships here.
- RISK-010: platform-scope paths are new cross-tenant surface — the platform-GUC
  mini-matrix + per-use audit are mandatory, not optional.
- RISK-019/020 (drift): the accounts-tables-early decision is recorded here and synced
  in docs at completion (catalog update listed in §8) so the catalog never silently
  disagrees with reality.
- Support-access abuse (THREAT_MODEL S-05): time-box + opt-in + full audit + tenant
  visibility are all test-enforced in this phase.
- Constraint: onboarding is backend-complete but deliberately unpolished; resist
  building dashboards/branding (PHASE-014) or fiscal calendars (PHASE-007).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-004-COMPLETION.md` with: registration +
  onboarding transaction proofs (SQL row dumps), idempotency re-run diff, lifecycle
  abuse test outputs, entitlement/closure test results, S-02/S-07 outputs,
  support-access audit excerpts, isolation suite output for new tables, seed drift
  output, PLACEHOLDER-values attestation.
- **Documentation updates required:** [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-004 → COMPLETE + tag), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + TABLES + ERD (tenants
  profile; `accounts`/`account_purposes` phase markers corrected to 004/007;
  `platform.data_export` deferral note), [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)
  if any phase column changed, `docs/operations/DEVELOPMENT_SETUP.md` (registration +
  console walkthrough). Acceptance criteria copied into
  `planning/PHASE_ACCEPTANCE_CRITERIA.md` (planned file — see PHASE-003 note).
- **Exit criteria:** all 11 acceptance criteria green with evidence; CI green with the
  expanded isolation + permission suites; docs validation + schema-catalog drift check
  green; a second engineer/agent can register a tenant and operate the console cold.
- **Definition of Done:** register → onboard → log in → branch → suspend/restore →
  support session all work end-to-end from the quickstart, in AR and EN, with every
  platform action audited; no billing or pricing surface exists.
- **Handoff instructions:** read PHASE-003 + PHASE-004 completion reports. The
  workspace produced by onboarding (CoA + purposes + roles + entitlements + settings)
  is exactly the substrate PHASE-005's app shell will navigate and PHASE-007's posting
  engine will resolve. Provisional console styling will be replaced by the design
  system — do not invest in one-off styling. **Next eligible phase: PHASE-005 — Design
  System, i18n & RTL Foundation** (identify only; do not implement).
