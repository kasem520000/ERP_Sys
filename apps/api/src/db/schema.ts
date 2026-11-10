import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * PHASE-002 infrastructure + PHASE-003 identity cluster (ADR-0004/0005,
 * DATABASE_CONVENTIONS §3–5; TABLES/tenancy-identity.md).
 *
 * Only infrastructure exists at this phase: the minimal `tenants` row (full
 * profile arrives with PHASE-004) and the append-only `audit_events` trail.
 * The PHASE-003 identity tables mirror migration `0003_identity_core.sql`
 * (sync rule, docs/database/README.md). Every tenant-owned table carries
 * `tenant_id uuid not null`, RLS policies, and `FORCE ROW LEVEL SECURITY` —
 * enforced by `scripts/check-rls.ts` in CI. Global/user-owned tables
 * (`users`, `permissions`, `sessions`, `devices`, `mfa_factors`) carry no
 * tenant RLS by design (PHASE-003 §4: service-mediated, permission-checked).
 */

/** Standard columns (DATABASE_CONVENTIONS §5). */
const standardColumns = {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  version: integer("version").notNull().default(1),
} as const;

/**
 * PHASE-002 minimal tenant row: id, name (bilingual per conventions §4), status.
 * The full tenant profile (currency, country, timezone, industry template,
 * deleted_at) arrives with PHASE-003 per the phase plan §2 item 5.
 *
 * RLS: `tenant_isolation` policy via `erp.current_tenant_id()` plus the
 * platform-scope GUC path for admin-plane access (TENANT_ISOLATION §3.2).
 */
export const tenants = pgTable(
  "tenants",
  {
    ...standardColumns,
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    status: text("status").notNull().default("ACTIVE"),
    // PHASE-004 profile expansion (migration 0006; TABLES/tenancy-identity.md)
    baseCurrency: varchar("base_currency", { length: 3 }).notNull(),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    industryTemplateKey: text("industry_template_key"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
    // PHASE-024 (migration 0036; Journey H guardrail): the platform-level
    // legal-hold flag — blocks the offboarding purge of a tenant held for
    // investigation (security sign-off required; INCIDENT_RESPONSE).
    legalHold: boolean("legal_hold").notNull().default(false),
  },
  (table) => [index("ix_tenants_status").on(table.status)],
);

/**
 * Append-only audit trail (TENANT_ISOLATION, OBSERVABILITY §Audit vs telemetry;
 * INV-003 substrate). UPDATE/DELETE are denied by both grants and the
 * `erp.audit_events_guard()` trigger — enforced by attack tests A1–A5/A10.
 *
 * `actor_id`/`device_id` have no FK until users (PHASE-003) and devices
 * (PHASE-020) exist — expand-phase pattern (MIGRATION_STRATEGY §3).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    // PHASE-004: NULL carries platform-scope rows (migration 0006 widening).
    tenantId: uuid("tenant_id"),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    correlationId: uuid("correlation_id"),
    deviceId: uuid("device_id"),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    // PHASE-004 (matrix §3.10/§7): true on every platform-admin-path action.
    viaPlatformAdmin: boolean("via_platform_admin").notNull().default(false),
  },
  (table) => [
    index("ix_audit_events_tenant_at").on(table.tenantId, table.at),
    index("ix_audit_events_tenant_entity_at").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.at,
    ),
  ],
);

/**
 * PHASE-003 identity cluster (TABLES/tenancy-identity.md; migration 0003).
 * users/permissions/sessions/devices/mfa_factors: global or user-owned — no
 * tenant RLS (service-mediated, permission-checked). roles/role_permissions
 * carry the documented template-variant RLS policy; memberships/invitations
 * the standard macro policy.
 */
export const users = pgTable(
  "users",
  {
    ...standardColumns,
    email: text("email").notNull(),
    phone: text("phone"),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: text("status").notNull().default("PENDING"),
    locale: text("locale").notNull().default("ar"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("ix_users_status").on(table.status)],
);

export const permissions = pgTable(
  "permissions",
  {
    key: text("key").primaryKey(),
    module: text("module").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("ix_permissions_module").on(table.module)],
);

export const roles = pgTable(
  "roles",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    isSystem: boolean("is_system").notNull().default(false),
  },
  (table) => [index("ix_roles_tenant").on(table.tenantId)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull(),
    tenantId: uuid("tenant_id"),
    permissionId: text("permission_id").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    grantedBy: uuid("granted_by"),
  },
  (table) => [index("ix_role_permissions_tenant").on(table.tenantId)],
);

export const memberships = pgTable(
  "memberships",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    branchScope: uuid("branch_scope").array(),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [
    index("ix_memberships_tenant_user").on(table.tenantId, table.userId),
    index("ix_memberships_user").on(table.userId),
  ],
);

export const devices = pgTable(
  "devices",
  {
    ...standardColumns,
    userId: uuid("user_id").notNull(),
    platform: text("platform").notNull(),
    name: text("name"),
    // PHASE-021 DR-P21-01 (migration 0032): nullable — NULL is the one-time
    // enrollment proof's "consumed" state (cleared by the enroll exchange);
    // every registration still writes the sha256 hash.
    deviceKeyHash: text("device_key_hash"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    // PHASE-016 narrow pos-terminal slice (SYNC_PROTOCOL §11): capability
    // scoping + terminal binding (no tenant_id — devices stays
    // service-mediated, PHASE-003 §4; tenant resolves via the terminal).
    capabilities: jsonb("capabilities"),
    terminalId: uuid("terminal_id"),
    // PHASE-020 registry widening (migration 0029; MASTER-PLAN §3/§9): the
    // device class drives feed groups + capability scoping (platform stays
    // for 003 compat); contract_version pins the wire protocol the device
    // speaks; attestation_* is the ed25519 challenge substrate; trust_flags
    // the audited admin plane; last_pull_at/last_push_at the outbox-lag
    // gauges; data_expires_at the lost-device remote expiry.
    contractVersion: text("contract_version"),
    deviceClass: text("device_class"),
    attestationPublicKey: text("attestation_public_key"),
    attestationNonce: text("attestation_nonce"),
    attestedAt: timestamp("attested_at", { withTimezone: true, mode: "string" }),
    trustFlags: jsonb("trust_flags").notNull().default(sql`'{}'::jsonb`),
    lastPullAt: timestamp("last_pull_at", { withTimezone: true, mode: "string" }),
    lastPushAt: timestamp("last_push_at", { withTimezone: true, mode: "string" }),
    dataExpiresAt: timestamp("data_expires_at", { withTimezone: true, mode: "string" }),
    // PHASE-022 · DR-P22-05a (migration 0033): the personal-account device's
    // linked partner — the server-side partner scope for the personal pull
    // feeds (statements / sales_invoices / receipts / notifications). Nullable
    // plain uuid (devices is service-mediated, no cross-plane FK); NULL = no
    // linkage → the personal pull serves an empty partner scope (fail closed).
    linkedPartnerId: uuid("linked_partner_id"),
  },
  (table) => [index("ix_devices_device_class").on(table.deviceClass)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    activeTenantId: uuid("active_tenant_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    ip: varchar("ip", { length: 45 }),
    deviceId: uuid("device_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    // PHASE-024 (migration 0036; ADR-0015 §4 enforcement): TRUE on every
    // normal session; FALSE only on the 15-minute enrollment-bootstrap
    // session issued when policy mandates MFA and the user has no confirmed
    // factor — the session middleware restricts it to the MFA endpoints.
    mfaGatePassed: boolean("mfa_gate_passed").notNull().default(true),
  },
  (table) => [
    index("ix_sessions_user_expires").on(table.userId, table.expiresAt),
    index("ix_sessions_active_tenant").on(table.activeTenantId),
  ],
);

export const mfaFactors = pgTable(
  "mfa_factors",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull().default("TOTP"),
    secretEnc: text("secret_enc").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
    recoveryCodesHash: text("recovery_codes_hash").array(),
  },
  (table) => [index("ix_mfa_factors_user").on(table.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    email: text("email").notNull(),
    roleId: uuid("role_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "string" }),
    status: text("status").notNull().default("PENDING"),
    invitedBy: uuid("invited_by").notNull(),
  },
  (table) => [index("ix_invitations_tenant_status").on(table.tenantId, table.status)],
);

// ---------------------------------------------------------------------------
// PHASE-004 tenancy provisioning cluster (migrations 0006–0008;
// TABLES/tenancy-identity.md + TABLES/core-accounting.md).
// ---------------------------------------------------------------------------

/** Global reference: ISO-4217 currencies (no tenant_id, no RLS — read-only). */
export const currencies = pgTable("currencies", {
  code: varchar("code", { length: 3 }).primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  minorUnits: integer("minor_units").notNull().default(2),
  symbol: text("symbol"),
  isActive: boolean("is_active").notNull().default(true),
});

/** Global reference: in-scope countries + display defaults. */
export const countries = pgTable("countries", {
  code: varchar("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  defaultLocale: text("default_locale").notNull().default("ar"),
  currencyCode: varchar("currency_code", { length: 3 }).notNull(),
  dateFormat: text("date_format").notNull().default("dd/MM/yyyy"),
  timeZone: text("time_zone").notNull().default("UTC"),
  isActive: boolean("is_active").notNull().default(true),
});

/** Global reference: industry-template index (list only; engine = PHASE-015). */
export const industryTemplates = pgTable("industry_templates", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  version: text("version").notNull().default("1.0.0"),
  manifest: jsonb("manifest").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // PHASE-015 (migration 0022): registry lifecycle (ACTIVE/DRAFT/RETIRED).
  status: text("status").notNull().default("ACTIVE"),
});

/** Global reference: default bilingual CoA template (CHART_OF_ACCOUNTS §3). */
export const chartOfAccountsTemplate = pgTable("chart_of_accounts_template", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  type: text("type").notNull(),
  isGroup: boolean("is_group").notNull().default(false),
  parentCode: text("parent_code"),
  purposeKey: text("purpose_key"),
});

/** Operating units (tenant-owned, macro RLS; deactivate — never delete). */
export const branches = pgTable(
  "branches",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    address: jsonb("address"),
    isActive: boolean("is_active").notNull().default(true),
    // PHASE-006 (migration 0009): BR-003 "branch default list" level.
    defaultPriceListId: uuid("default_price_list_id"),
  },
  (table) => [
    index("ix_branches_tenant").on(table.tenantId),
    uniqueIndex("uq_branches_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Typed key-value tenant settings (L5; macro RLS). */
export const tenantSettings = pgTable(
  "tenant_settings",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by"),
  },
  (table) => [
    index("ix_tenant_settings_tenant").on(table.tenantId),
    uniqueIndex("uq_tenant_settings_tenant_key").on(table.tenantId, table.key),
  ],
);

/** Platform-level subscription plans (RLS: tenant read + platform write path). */
export const plans = pgTable(
  "plans",
  {
    ...standardColumns,
    key: text("key").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    priceAmount: numeric("price_amount", { precision: 19, scale: 4 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    billingPeriod: text("billing_period").notNull().default("MONTHLY"),
    limits: jsonb("limits").notNull(),
    featureKeys: text("feature_keys").array().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // PHASE-014 marketing surface (migration 0021) — the pricing page
    // renders from these rows only; prices stay PLACEHOLDER (OQ-002).
    positioning: jsonb("positioning"),
    annualPriceAmount: numeric("annual_price_amount", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    highlight: boolean("highlight").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // PHASE-024 (migration 0036; ADR-0015 §4 "mandatory-able per role/plan"):
    // the plan-level MFA policy — role keys for which TOTP is mandatory.
    // Stays '{}' on every seeded plan (expand-contract: opt-in behavior
    // until a plan or tenant turns a policy on).
    mfaRequiredRoleKeys: text("mfa_required_role_keys").array().notNull().default([]),
  },
  (table) => [uniqueIndex("uq_plans_key").on(table.key)],
);

/** Tenant plan assignment (minimal — billing columns land PHASE-014). */
export const subscriptions = pgTable(
  "subscriptions",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    planId: uuid("plan_id").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    providerRef: text("provider_ref"),
    // PHASE-014 lifecycle columns (migration 0021): trial/grace windows,
    // dunning, provider refs, pending downgrade, journey completion.
    provider: text("provider"),
    providerCheckoutRef: text("provider_checkout_ref"),
    providerSubscriptionRef: text("provider_subscription_ref"),
    providerCustomerRef: text("provider_customer_ref"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: "string" }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true, mode: "string" }),
    dunningStep: integer("dunning_step").notNull().default(0),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    pendingPlanId: uuid("pending_plan_id"),
    journeyCompletedAt: timestamp("journey_completed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("ix_subscriptions_tenant").on(table.tenantId)],
);

/** Materialized feature grants (macro RLS; upserted by the entitlement service). */
export const entitlements = pgTable(
  "entitlements",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    featureKey: text("feature_key").notNull(),
    source: text("source").notNull().default("PLAN"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("ix_entitlements_tenant").on(table.tenantId),
    uniqueIndex("uq_entitlements_tenant_feature").on(table.tenantId, table.featureKey),
  ],
);

/** Time-boxed audited support sessions (matrix §7; macro RLS). */
export const supportSessions = pgTable(
  "support_sessions",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    platformUserId: uuid("platform_user_id").notNull(),
    optIn: boolean("opt_in").notNull().default(false),
    ticketRef: text("ticket_ref"),
    reason: text("reason").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by"),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [index("ix_support_sessions_tenant_status").on(table.tenantId, table.status)],
);

/** CoA nodes (created in 004 for onboarding instantiation; posting = 007). */
export const accounts = pgTable(
  "accounts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    type: text("type").notNull(),
    parentId: uuid("parent_id"),
    isPostable: boolean("is_postable").notNull().default(false),
    currencyCode: varchar("currency_code", { length: 3 }),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [
    index("ix_accounts_tenant_parent").on(table.tenantId, table.parentId),
    index("ix_accounts_tenant_type").on(table.tenantId, table.type),
    uniqueIndex("uq_accounts_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Purpose → account mapping (posting engine resolution substrate, 007). */
export const accountPurposes = pgTable(
  "account_purposes",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    purposeKey: text("purpose_key").notNull(),
    accountId: uuid("account_id").notNull(),
    activeFrom: date("active_from").notNull(),
    activeTo: date("active_to"),
  },
  (table) => [
    index("ix_account_purposes_tenant").on(table.tenantId),
    uniqueIndex("uq_account_purposes_tenant_purpose_active")
      .on(table.tenantId, table.purposeKey)
      .where(sql`${table.activeTo} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-006 master-data cluster (migration 0009; TABLES/trade-inventory.md).
// ---------------------------------------------------------------------------

/** Net-N payment terms; NET-7/15/30/60 seeded read-only per tenant (BR-026). */
export const creditTerms = pgTable(
  "credit_terms",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    days: integer("days").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
  },
  (table) => [
    index("ix_credit_terms_tenant").on(table.tenantId),
    uniqueIndex("uq_credit_terms_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Sale/purchase price lists (BR-003 level 1 source). */
export const priceLists = pgTable(
  "price_lists",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    kind: text("kind").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [index("ix_price_lists_tenant_kind").on(table.tenantId, table.kind)],
);

/** Unified customer/supplier directory (BR-025; soft-delete tombstone). */
export const partners = pgTable(
  "partners",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    taxNumber: text("tax_number"),
    creditLimit: numeric("credit_limit", { precision: 19, scale: 4 }),
    creditTermsId: uuid("credit_terms_id"),
    priceListId: uuid("price_list_id"),
    // PHASE-017 (migration 0025): tier assignment drives BR-003 resolution
    // (customer's list → tier list → branch default → base).
    customerTierId: uuid("customer_tier_id"),
    status: text("status").notNull().default("ACTIVE"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("ix_partners_tenant_kind").on(table.tenantId, table.kind),
    index("ix_partners_tenant_status").on(table.tenantId, table.status),
    index("ix_partners_tenant_credit_terms").on(table.tenantId, table.creditTermsId),
    uniqueIndex("uq_partners_tenant_code").on(table.tenantId, table.code),
  ],
);

export const partnerContacts = pgTable(
  "partner_contacts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    role: text("role"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (table) => [
    index("ix_partner_contacts_tenant_partner").on(table.tenantId, table.partnerId),
  ],
);

export const partnerAddresses = pgTable(
  "partner_addresses",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    type: text("type").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city"),
    countryCode: varchar("country_code", { length: 2 }),
    geo: jsonb("geo"),
  },
  (table) => [
    index("ix_partner_addresses_tenant_partner").on(table.tenantId, table.partnerId),
  ],
);

/** Bilingual item taxonomy tree (cycle-free by service invariant). */
export const itemCategories = pgTable(
  "item_categories",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    parentId: uuid("parent_id"),
    // PHASE-009 (migration 0013): category-default tax code (T5).
    defaultTaxCodeId: uuid("default_tax_code_id"),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [
    index("ix_item_categories_tenant_parent").on(table.tenantId, table.parentId),
    uniqueIndex("uq_item_categories_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Units of measure: 8 is_system rows per tenant + tenant extensions. */
export const uoms = pgTable(
  "uoms",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("ix_uoms_tenant").on(table.tenantId),
    uniqueIndex("uq_uoms_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Exact decimal conversion factors (compose-exactly property, T2). */
export const uomConversions = pgTable(
  "uom_conversions",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    fromUomId: uuid("from_uom_id").notNull(),
    toUomId: uuid("to_uom_id").notNull(),
    factor: numeric("factor", { precision: 19, scale: 6 }).notNull(),
  },
  (table) => [
    index("ix_uom_conversions_tenant_from").on(table.tenantId, table.fromUomId),
    index("ix_uom_conversions_tenant_to").on(table.tenantId, table.toUomId),
    uniqueIndex("uq_uom_conversions_tenant_pair").on(
      table.tenantId,
      table.fromUomId,
      table.toUomId,
    ),
  ],
);

/** Item master (sku rules; tax_code_id FK deferred to PHASE-009). */
export const items = pgTable(
  "items",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    kind: text("kind").notNull(),
    uomId: uuid("uom_id").notNull(),
    categoryId: uuid("category_id"),
    // Expand-migrate-contract (PHASE-009 adds the FK + validation).
    taxCodeId: uuid("tax_code_id"),
    costingMethod: text("costing_method").notNull().default("WAC"),
    trackBatch: boolean("track_batch").notNull().default(false),
    trackSerial: boolean("track_serial").notNull().default(false),
    trackImei: boolean("track_imei").notNull().default(false),
    hasExpiry: boolean("has_expiry").notNull().default(false),
    // PHASE-018 (migration 0026): shelf-life days for produced-batch expiry
    // (FG batch expiry = completion date + shelf_life_days when the policy
    // is on); nullable, validated 1..3650 at the service layer.
    shelfLifeDays: integer("shelf_life_days"),
    reorderLevel: numeric("reorder_level", { precision: 19, scale: 6 }),
    reorderQty: numeric("reorder_qty", { precision: 19, scale: 6 }),
    basePrice: numeric("base_price", { precision: 19, scale: 6 }),
    status: text("status").notNull().default("ACTIVE"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("ix_items_tenant_kind").on(table.tenantId, table.kind),
    index("ix_items_tenant_category").on(table.tenantId, table.categoryId),
    index("ix_items_tenant_status").on(table.tenantId, table.status),
    uniqueIndex("uq_items_tenant_sku").on(table.tenantId, table.sku),
  ],
);

/** Item barcodes, per UoM, tenant-wide scan-unique. */
export const barcodes = pgTable(
  "barcodes",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    uomId: uuid("uom_id").notNull(),
    code: text("code").notNull(),
  },
  (table) => [
    index("ix_barcodes_tenant_item").on(table.tenantId, table.itemId),
    uniqueIndex("uq_barcodes_tenant_code").on(table.tenantId, table.code),
    uniqueIndex("uq_barcodes_tenant_item_uom_code").on(
      table.tenantId,
      table.itemId,
      table.uomId,
      table.code,
    ),
  ],
);

/** Price list rows: per-UoM unit price with min-qty tiers. */
export const priceListItems = pgTable(
  "price_list_items",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    priceListId: uuid("price_list_id").notNull(),
    itemId: uuid("item_id").notNull(),
    uomId: uuid("uom_id").notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull(),
    minQty: numeric("min_qty", { precision: 19, scale: 6 }).notNull().default("1"),
  },
  (table) => [
    index("ix_price_list_items_tenant_list_item").on(
      table.tenantId,
      table.priceListId,
      table.itemId,
    ),
    uniqueIndex("uq_price_list_items_tier").on(
      table.tenantId,
      table.priceListId,
      table.itemId,
      table.uomId,
      table.minQty,
    ),
  ],
);

/** Partners-owned read model (draft-aware sums until PHASE-007 posts). */
export const partnerBalances = pgTable(
  "partner_balances",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    openBalance: numeric("open_balance", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    draftBalance: numeric("draft_balance", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    overdueAmount: numeric("overdue_amount", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    lastRecomputedAt: timestamp("last_recomputed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_partner_balances_tenant_partner").on(table.tenantId, table.partnerId),
  ],
);

/** Opening-balance DRAFT capture (status CHECK-locked to DRAFT here). */
export const openingBalanceDocs = pgTable(
  "opening_balance_docs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind").notNull(),
    partnerId: uuid("partner_id"),
    accountId: uuid("account_id"),
    itemId: uuid("item_id"),
    qty: numeric("qty", { precision: 19, scale: 6 }),
    unitCost: numeric("unit_cost", { precision: 19, scale: 6 }),
    amount: numeric("amount", { precision: 19, scale: 4 }),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    note: text("note"),
    status: text("status").notNull().default("DRAFT"),
  },
  (table) => [index("ix_obd_tenant_kind").on(table.tenantId, table.kind)],
);

/** Attachments (ENTITY_CATALOG: 002 infra / 006 usage) — owner linkage. */
export const fileObjects = pgTable(
  "file_objects",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    storageKey: text("storage_key").notNull(),
    name: text("name").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    checksum: text("checksum"),
    uploadedBy: uuid("uploaded_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("ix_file_objects_tenant_owner").on(
      table.tenantId,
      table.ownerType,
      table.ownerId,
    ),
    uniqueIndex("uq_file_objects_tenant_storage_key").on(table.tenantId, table.storageKey),
  ],
);

/** Preview-gated bulk import state (commit = idempotent per token). */
export const importJobs = pgTable(
  "import_jobs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind").notNull(),
    format: text("format").notNull(),
    uploadToken: text("upload_token").notNull(),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name"),
    status: text("status").notNull().default("PREVIEWING"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    committedRows: integer("committed_rows").notNull().default(0),
    report: jsonb("report"),
    error: text("error"),
    committedAt: timestamp("committed_at", { withTimezone: true, mode: "string" }),
    createdBy: uuid("created_by"),
  },
  (table) => [
    index("ix_import_jobs_tenant_status").on(table.tenantId, table.status),
    index("ix_import_jobs_tenant_created").on(table.tenantId, table.createdAt),
    uniqueIndex("uq_import_jobs_tenant_token").on(table.tenantId, table.uploadToken),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-007 accounting core (migrations 0010/0011; TABLES/core-accounting.md).
// ---------------------------------------------------------------------------

/** Fiscal years: idempotent by (tenant, name); CLOSE flips at year-end. */
export const fiscalYears = pgTable(
  "fiscal_years",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").notNull().default("OPEN"),
  },
  (table) => [
    index("ix_fiscal_years_tenant_window").on(table.tenantId, table.startDate, table.endDate),
    uniqueIndex("uq_fiscal_years_tenant_name").on(table.tenantId, table.name),
  ],
);

/** Fiscal periods: REGULAR months + special OPENING/CLOSING windows. */
export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    fiscalYearId: uuid("fiscal_year_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("REGULAR"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").notNull().default("OPEN"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true, mode: "string" }),
    reopenedBy: uuid("reopened_by"),
    reopenReason: text("reopen_reason"),
  },
  (table) => [
    index("ix_fiscal_periods_tenant_dates").on(table.tenantId, table.startDate, table.endDate),
    index("ix_fiscal_periods_tenant_year").on(table.tenantId, table.fiscalYearId),
  ],
);

/** Dated exchange rates — base per 1 foreign (INV-008). */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    rateDate: date("rate_date").notNull(),
    rate: numeric("rate", { precision: 19, scale: 8 }).notNull(),
    source: text("source").notNull().default("MANUAL"),
  },
  (table) => [
    index("ix_exchange_rates_tenant_currency_date").on(
      table.tenantId,
      table.currencyCode,
      sql`${table.rateDate} DESC`,
    ),
    uniqueIndex("uq_exchange_rates_tenant_currency_date").on(
      table.tenantId,
      table.currencyCode,
      table.rateDate,
    ),
  ],
);

/** Cost centers: analytical dimension (basic tree). */
export const costCenters = pgTable(
  "cost_centers",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    parentId: uuid("parent_id"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("ix_cost_centers_tenant_parent").on(table.tenantId, table.parentId),
    uniqueIndex("uq_cost_centers_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Projects: the PHASE-019 analytical dimension (the cost_centers clone
 * with status OPEN|CLOSED instead of is_active — CLOSED rejects new
 * journal-line stamps, typed PROJECT_CLOSED at the engine). */
export const projects = pgTable(
  "projects",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    parentId: uuid("parent_id"),
    status: text("status").notNull().default("OPEN"),
  },
  (table) => [
    uniqueIndex("uq_projects_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_projects_tenant_code").on(table.tenantId, table.code),
    index("ix_projects_tenant_parent").on(table.tenantId, table.parentId),
  ],
);

/** Recurring journal definitions (generation creates DRAFTs only). */
export const recurringJournals = pgTable(
  "recurring_journals",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    template: jsonb("template").notNull(),
    schedule: text("schedule").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    nextRunDate: date("next_run_date").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "string" }),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [
    index("ix_recurring_journals_tenant_due").on(table.tenantId, table.status, table.nextRunDate),
  ],
);

/** Per-doc-type approval policies (BR-034). */
export const approvalPolicies = pgTable(
  "approval_policies",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    docType: text("doc_type").notNull(),
    policy: jsonb("policy").notNull(),
    appliesFrom: date("applies_from").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("ix_approval_policies_tenant_type").on(table.tenantId, table.docType, table.appliesFrom),
    uniqueIndex("uq_approval_policies_tenant_type_from").on(
      table.tenantId,
      table.docType,
      table.appliesFrom,
    ),
  ],
);

/** ADR-0006 numbering store: per-(tenant, branch, type, period) sequences. */
export const numberingSequences = pgTable(
  "numbering_sequences",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    docType: text("doc_type").notNull(),
    branchId: uuid("branch_id"),
    periodKey: text("period_key"),
    nextValue: bigint("next_value", { mode: "bigint" }).notNull().default(1n),
    format: text("format").notNull().default("{PREFIX}-{SEQ:6}"),
  },
  (table) => [index("ix_numbering_sequences_tenant").on(table.tenantId)],
);

/** Numbering audit ledger (INV-021: voided numbers stay reserved). */
export const numberAssignments = pgTable(
  "number_assignments",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    docType: text("doc_type").notNull(),
    branchId: uuid("branch_id"),
    periodKey: text("period_key"),
    number: text("number").notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
    documentId: uuid("document_id"),
    voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
    voidedBy: uuid("voided_by"),
  },
  (table) => [
    index("ix_number_assignments_tenant_doc").on(table.tenantId, table.docType, table.createdAt),
  ],
);

/** Manual journal drafts (JOURNAL_RULES §1 lifecycle document). */
export const manualJournals = pgTable(
  "manual_journals",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    status: text("status").notNull().default("DRAFT"),
    entryDate: date("entry_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    rateSource: text("rate_source").notNull().default("TABLE"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    reference: text("reference"),
    recurrenceId: uuid("recurrence_id"),
    templateId: uuid("template_id"),
    postedJournalId: uuid("posted_journal_id"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    approvalStep: integer("approval_step").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    index("ix_manual_journals_tenant_status_date").on(table.tenantId, table.status, table.entryDate),
    index("ix_manual_journals_tenant_recurrence").on(table.tenantId, table.recurrenceId),
  ],
);

/** Manual journal draft lines (cascade with the draft). */
export const manualJournalLines = pgTable(
  "manual_journal_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    manualJournalId: uuid("manual_journal_id").notNull(),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id").notNull(),
    direction: text("direction").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    partnerId: uuid("partner_id"),
    itemId: uuid("item_id"),
    costCenterId: uuid("cost_center_id"),
    taxCodeId: uuid("tax_code_id"),
    projectId: uuid("project_id"),
    memo: text("memo"),
    memoAr: text("memo_ar"),
  },
  (table) => [
    index("ix_manual_journal_lines_tenant_entry").on(table.tenantId, table.manualJournalId),
    index("ix_manual_journal_lines_tenant_account").on(table.tenantId, table.accountId),
    uniqueIndex("uq_manual_journal_lines_entry_line").on(table.manualJournalId, table.lineNo),
  ],
);

/** Journal templates (line structure without amounts; documents, not postings). */
export const journalTemplates = pgTable(
  "journal_templates",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    lines: jsonb("lines").notNull(),
  },
  () => [],
);

/** Journal entries — append-only, the posting engine's artifact (INV-003/013). */
export const journalEntries = pgTable(
  "journal_entries",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    entryNo: text("entry_no"),
    entryDate: date("entry_date").notNull(),
    fiscalPeriodId: uuid("fiscal_period_id").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }).notNull().default("1"),
    status: text("status").notNull().default("POSTED"),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    operation: text("operation").notNull(),
    reversalOfId: uuid("reversal_of_id"),
    reversedById: uuid("reversed_by_id"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    postReason: text("post_reason"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    postedBy: uuid("posted_by"),
  },
  (table) => [
    index("ix_journal_entries_tenant_date").on(table.tenantId, table.entryDate),
    index("ix_journal_entries_tenant_period").on(table.tenantId, table.fiscalPeriodId),
    index("ix_journal_entries_tenant_source").on(table.tenantId, table.sourceType, table.sourceId),
    uniqueIndex("uq_journal_entries_tenant_source_op")
      .on(table.tenantId, table.sourceType, table.sourceId, table.operation)
      .where(sql`${table.sourceId} IS NOT NULL`),
    uniqueIndex("uq_journal_entries_tenant_entry_no")
      .on(table.tenantId, table.entryNo)
      .where(sql`${table.entryNo} IS NOT NULL`),
  ],
);

/** Journal lines — append-only, positive magnitudes (INV-003/008). */
export const journalLines = pgTable(
  "journal_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id").notNull(),
    direction: text("direction").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    baseAmount: numeric("base_amount", { precision: 19, scale: 4 }).notNull(),
    partnerId: uuid("partner_id"),
    itemId: uuid("item_id"),
    costCenterId: uuid("cost_center_id"),
    taxCodeId: uuid("tax_code_id"),
    projectId: uuid("project_id"),
    memo: text("memo"),
    memoAr: text("memo_ar"),
  },
  (table) => [
    index("ix_journal_lines_tenant_entry").on(table.tenantId, table.journalEntryId),
    index("ix_journal_lines_tenant_account").on(table.tenantId, table.accountId),
    index("ix_journal_lines_tenant_partner").on(table.tenantId, table.partnerId),
    index("ix_journal_lines_tenant_project").on(table.tenantId, table.projectId),
    uniqueIndex("uq_journal_lines_entry_line").on(table.journalEntryId, table.lineNo),
  ],
);

/** Partner subledger rows (partners-module-owned; INV-009 from entry #1). */
export const partnerSubledgerEntries = pgTable(
  "partner_subledger_entries",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull(),
    journalLineId: uuid("journal_line_id").notNull(),
    entryDate: date("entry_date").notNull(),
    direction: text("direction").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    baseAmount: numeric("base_amount", { precision: 19, scale: 4 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    memo: text("memo"),
  },
  (table) => [
    index("ix_partner_subledger_tenant_partner").on(table.tenantId, table.partnerId, table.entryDate),
    index("ix_partner_subledger_tenant_entry").on(table.tenantId, table.journalEntryId),
    uniqueIndex("uq_partner_subledger_entries_line").on(table.journalLineId),
  ],
);

/** Reconciliation run records (RC-01..03; PC-04 lock gate). */
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    kind: text("kind").notNull(),
    asOf: date("as_of").notNull(),
    fiscalPeriodId: uuid("fiscal_period_id"),
    status: text("status").notNull(),
    controlBalance: numeric("control_balance", { precision: 19, scale: 4 }).notNull(),
    subledgerBalance: numeric("subledger_balance", { precision: 19, scale: 4 }).notNull(),
    diffCount: integer("diff_count").notNull().default(0),
    diff: jsonb("diff"),
    runMode: text("run_mode").notNull().default("ON_DEMAND"),
    checkedBy: uuid("checked_by"),
  },
  (table) => [
    index("ix_reconciliation_runs_tenant_kind_date").on(table.tenantId, table.kind, table.asOf),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-008 — treasury cluster (migration 0012): cash/bank/petty accounts,
// the append-only movement ledger (INV-019), receipts/payments + allocations
// (INV-016), expense categories + claims (BR-023), transfers with charges
// (G-12), cashier shifts (BR-021), and bank statement import/matching (BR-022).
// ---------------------------------------------------------------------------

/** Treasury accounts — each IS a GL account (1:1 per tenant; INV-019). */
export const cashAccounts = pgTable(
  "cash_accounts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    type: text("type").notNull(),
    accountId: uuid("account_id").notNull(),
    branchId: uuid("branch_id"),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    status: text("status").notNull().default("ACTIVE"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by"),
    closeReason: text("close_reason"),
  },
  (table) => [
    uniqueIndex("uq_cash_accounts_tenant_account").on(table.tenantId, table.accountId),
    uniqueIndex("uq_cash_accounts_tenant_name").on(table.tenantId, table.name),
    index("ix_cash_accounts_tenant_type_status").on(table.tenantId, table.type, table.status),
  ],
);

/** Immutable IN/OUT money rows (INV-019 substrate; append-only 🔒). */
export const cashMovements = pgTable(
  "cash_movements",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    cashAccountId: uuid("cash_account_id").notNull(),
    direction: text("direction").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }).notNull().default("1"),
    baseAmount: numeric("base_amount", { precision: 19, scale: 4 }).notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    valueDate: date("value_date").notNull(),
    memo: text("memo"),
    memoAr: text("memo_ar"),
  },
  (table) => [
    uniqueIndex("uq_cash_movements_source_side").on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.cashAccountId,
      table.direction,
    ),
    index("ix_cash_movements_tenant_account_date").on(table.tenantId, table.cashAccountId, table.valueDate),
    index("ix_cash_movements_tenant_source").on(table.tenantId, table.sourceType, table.sourceId),
  ],
);

/** Receipts — money-in documents (G-05/G-06). */
export const receipts = pgTable(
  "receipts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    status: text("status").notNull().default("DRAFT"),
    receiptNo: text("receipt_no"),
    cashAccountId: uuid("cash_account_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    method: text("method").notNull(),
    payerName: text("payer_name"),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    valueDate: date("value_date").notNull(),
    reference: text("reference"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    allocatedAmount: numeric("allocated_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    fxGainLoss: numeric("fx_gain_loss", { precision: 19, scale: 4 }).notNull().default("0"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postedJournalId: uuid("posted_journal_id"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    index("ix_receipts_tenant_status_date").on(table.tenantId, table.status, table.valueDate),
    index("ix_receipts_tenant_partner").on(table.tenantId, table.partnerId),
  ],
);

/** Payments — the money-out mirror (G-10). */
export const payments = pgTable(
  "payments",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    status: text("status").notNull().default("DRAFT"),
    paymentNo: text("payment_no"),
    cashAccountId: uuid("cash_account_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    method: text("method").notNull(),
    payeeName: text("payee_name"),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    valueDate: date("value_date").notNull(),
    reference: text("reference"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    allocatedAmount: numeric("allocated_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    fxGainLoss: numeric("fx_gain_loss", { precision: 19, scale: 4 }).notNull().default("0"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postedJournalId: uuid("posted_journal_id"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    index("ix_payments_tenant_status_date").on(table.tenantId, table.status, table.valueDate),
    index("ix_payments_tenant_partner").on(table.tenantId, table.partnerId),
  ],
);

/** Settlement allocations (INV-016; exactly one of receipt/payment). */
export const treasuryAllocations = pgTable(
  "treasury_allocations",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    receiptId: uuid("receipt_id"),
    paymentId: uuid("payment_id"),
    // PHASE-027 (0038): notes own allocations too — exactly one of
    // receipt/payment/note (the CHECK owns the invariant; the settled-sum
    // read models add the note branch with no status filter).
    noteId: uuid("note_id"),
    openItemId: uuid("open_item_id").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_treasury_allocations_receipt_item").on(
      table.tenantId,
      table.receiptId,
      table.openItemId,
    ),
    uniqueIndex("uq_treasury_allocations_payment_item").on(
      table.tenantId,
      table.paymentId,
      table.openItemId,
    ),
    uniqueIndex("uq_treasury_allocations_note_item").on(
      table.tenantId,
      table.noteId,
      table.openItemId,
    ),
    index("ix_treasury_allocations_tenant_item").on(table.tenantId, table.openItemId),
  ],
);

/** Expense categories (BR-023): bilingual, mapped to expense accounts. */
export const expenseCategories = pgTable(
  "expense_categories",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    accountId: uuid("account_id").notNull(),
    approvalMode: text("approval_mode").notNull().default("single-approver"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("uq_expense_categories_tenant_code").on(table.tenantId, table.code),
    index("ix_expense_categories_tenant_active").on(table.tenantId, table.isActive),
  ],
);

/** Expense claims (BR-023; G-11; reserved tax_code_id → PHASE-009). */
export const expenses = pgTable(
  "expenses",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    status: text("status").notNull().default("DRAFT"),
    expenseNo: text("expense_no"),
    categoryId: uuid("category_id").notNull(),
    cashAccountId: uuid("cash_account_id").notNull(),
    payeeName: text("payee_name").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    taxCodeId: uuid("tax_code_id"),
    receiptFileId: uuid("receipt_file_id"),
    valueDate: date("value_date").notNull(),
    description: text("description"),
    descriptionAr: text("description_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postedJournalId: uuid("posted_journal_id"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    index("ix_expenses_tenant_status_date").on(table.tenantId, table.status, table.valueDate),
    index("ix_expenses_tenant_category").on(table.tenantId, table.categoryId),
  ],
);

/** Account↔account transfers with charges (G-12). */
export const cashTransfers = pgTable(
  "cash_transfers",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    status: text("status").notNull().default("DRAFT"),
    transferNo: text("transfer_no"),
    fromAccountId: uuid("from_account_id").notNull(),
    toAccountId: uuid("to_account_id").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    feeAmount: numeric("fee_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    valueDate: date("value_date").notNull(),
    reference: text("reference"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postedJournalId: uuid("posted_journal_id"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    index("ix_cash_transfers_tenant_status_date").on(table.tenantId, table.status, table.valueDate),
  ],
);

/** Cashier shifts (BR-021): float, manual capture feed, close + variance. */
export const cashierShifts = pgTable(
  "cashier_shifts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    status: text("status").notNull().default("OPEN"),
    shiftNo: text("shift_no"),
    cashAccountId: uuid("cash_account_id").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    openingAmount: numeric("opening_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    capturedIn: numeric("captured_in", { precision: 19, scale: 4 }).notNull().default("0"),
    capturedOut: numeric("captured_out", { precision: 19, scale: 4 }).notNull().default("0"),
    expectedAmount: numeric("expected_amount", { precision: 19, scale: 4 }),
    countedAmount: numeric("counted_amount", { precision: 19, scale: 4 }),
    difference: numeric("difference", { precision: 19, scale: 4 }),
    variancePostedJournalId: uuid("variance_posted_journal_id"),
    supervisorId: uuid("supervisor_id"),
    supervisorVerifiedAt: timestamp("supervisor_verified_at", { withTimezone: true, mode: "string" }),
    closeReason: text("close_reason"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by"),
    // PHASE-016 (T3): POS-grade linkage — the owning terminal, the
    // per-denomination blind count (BR-021), and the blind-count posture.
    posTerminalId: uuid("pos_terminal_id"),
    denominations: jsonb("denominations"),
    blindCount: boolean("blind_count").notNull().default(true),
  },
  (table) => [
    uniqueIndex("uq_cashier_shifts_one_open_per_account").on(table.tenantId, table.cashAccountId),
    index("ix_cashier_shifts_tenant_status").on(table.tenantId, table.status, table.openedAt),
    index("ix_cashier_shifts_tenant_terminal").on(table.tenantId, table.posTerminalId, table.status),
  ],
);

/** Imported bank statements (BR-022; idempotent per file hash). */
export const bankStatements = pgTable(
  "bank_statements",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    status: text("status").notNull().default("IMPORTED"),
    cashAccountId: uuid("cash_account_id").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    adapterId: text("adapter_id").notNull(),
    openingBalance: numeric("opening_balance", { precision: 19, scale: 4 }),
    closingBalance: numeric("closing_balance", { precision: 19, scale: 4 }),
    lineCount: integer("line_count").notNull().default(0),
    importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true, mode: "string" }),
    reconciledBy: uuid("reconciled_by"),
  },
  (table) => [
    uniqueIndex("uq_bank_statements_tenant_hash").on(table.tenantId, table.fileHash),
    index("ix_bank_statements_tenant_account_period").on(
      table.tenantId,
      table.cashAccountId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

/** Statement lines — informational only, never ledger entries. */
export const bankStatementLines = pgTable(
  "bank_statement_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    bankStatementId: uuid("bank_statement_id").notNull(),
    lineNo: integer("line_no").notNull(),
    lineDate: date("line_date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    reference: text("reference"),
    description: text("description"),
    matchedMovementId: uuid("matched_movement_id"),
    matchedAt: timestamp("matched_at", { withTimezone: true, mode: "string" }),
    matchedBy: uuid("matched_by"),
    matchMode: text("match_mode"),
  },
  (table) => [
    uniqueIndex("uq_bank_statement_lines_statement_no").on(table.bankStatementId, table.lineNo),
    index("ix_bank_statement_lines_tenant_statement").on(table.tenantId, table.bankStatementId, table.lineNo),
    index("ix_bank_statement_lines_tenant_movement").on(table.tenantId, table.matchedMovementId),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-009 — tax cluster (migration 0013): the six-treatment engine,
// jurisdiction packs (global reference data, ADR-0010), tenant tax codes +
// registrations + staged pack bindings, the INV-012 document-summary
// substrate, VAT returns, and the e-invoicing submission registry (schema
// only — adapters PHASE-023).
// ---------------------------------------------------------------------------

/** Tax treatments (TAX_ENGINE §1) — global reference, seed-only. */
export const taxTreatments = pgTable(
  "tax_treatments",
  {
    key: text("key").primaryKey(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    taxable: boolean("taxable").notNull(),
    outputTaxBox: text("output_tax_box"),
    inputTaxBox: text("input_tax_box"),
    sortOrder: integer("sort_order").notNull(),
  },
);

/** Jurisdiction packs (COUNTRY_PACKS §2–§5) — global reference, seed-only. */
export const jurisdictions = pgTable(
  "jurisdictions",
  {
    id: uuid("id").primaryKey(),
    countryCode: char("country_code", { length: 2 }).notNull().unique(),
    countryName: text("country_name").notNull(),
    countryNameAr: text("country_name_ar").notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    minorUnits: integer("minor_units").notNull(),
    vatStatus: text("vat_status").notNull(),
    packVersion: text("pack_version").notNull(),
    descriptor: jsonb("descriptor").notNull(),
    verificationStatus: text("verification_status").notNull().default("REQUIRES_VERIFICATION"),
    sourceRef: text("source_ref").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
);

/** Versioned effective-dated pack rates (TAX_ENGINE §3) — global reference. */
export const jurisdictionTaxRates = pgTable(
  "jurisdiction_tax_rates",
  {
    id: uuid("id").primaryKey(),
    jurisdictionId: uuid("jurisdiction_id").notNull(),
    treatment: text("treatment").notNull(),
    rate: numeric("rate", { precision: 8, scale: 4 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    sourceRef: text("source_ref").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_jurisdiction_rates_window").on(
      table.jurisdictionId,
      table.treatment,
      table.effectiveFrom,
    ),
    index("ix_jurisdiction_rates_lookup").on(
      table.jurisdictionId,
      table.treatment,
      table.effectiveFrom,
    ),
  ],
);

/** Tenant tax codes — the treatment binder bound to a jurisdiction pack. */
export const taxCodes = pgTable(
  "tax_codes",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    countryCode: char("country_code", { length: 2 }).notNull(),
    defaultTreatment: text("default_treatment").notNull(),
    snapshotPolicy: text("snapshot_policy").notNull().default("STAMP_AT_POSTING"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_tax_codes_tenant_code").on(table.tenantId, table.code),
    index("ix_tax_codes_tenant_country_status").on(
      table.tenantId,
      table.countryCode,
      table.status,
    ),
  ],
);

/** Tenant tax registrations per jurisdiction (TAX_ENGINE §1). */
export const taxRegistrations = pgTable(
  "tax_registrations",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    status: text("status").notNull(),
    registrationNumber: text("registration_number"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    deregisteredAt: date("deregistered_at"),
    note: text("note"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_tax_registrations_tenant_country").on(table.tenantId, table.countryCode),
    index("ix_tax_registrations_tenant_country").on(table.tenantId, table.countryCode),
  ],
);

/** Staged pack bindings — the tenant's pinned pack version per country. */
export const taxPackBindings = pgTable(
  "tax_pack_bindings",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    packVersion: text("pack_version").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    appliedBy: uuid("applied_by"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_tax_pack_bindings_tenant_country").on(table.tenantId, table.countryCode),
  ],
);

/** Document tax summaries — INV-012's document side, append-only. */
export const taxDocumentSummaries = pgTable(
  "tax_document_summaries",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    documentDate: date("document_date").notNull(),
    fiscalPeriodId: uuid("fiscal_period_id"),
    countryCode: char("country_code", { length: 2 }).notNull(),
    direction: text("direction").notNull(),
    treatment: text("treatment").notNull(),
    rate: numeric("rate", { precision: 8, scale: 4 }).notNull(),
    taxCodeId: uuid("tax_code_id"),
    taxableBase: numeric("taxable_base", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
  },
  (table) => [
    uniqueIndex("uq_tax_document_summaries_group").on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.direction,
      table.treatment,
      table.rate,
      table.taxCodeId,
    ),
    index("ix_tax_summaries_period").on(
      table.tenantId,
      table.countryCode,
      table.documentDate,
      table.direction,
    ),
    index("ix_tax_summaries_source").on(table.tenantId, table.sourceType, table.sourceId),
  ],
);

/** VAT returns — draft → ready (INV-012 green) → filed-by-human. */
export const vatReturns = pgTable(
  "vat_returns",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").notNull().default("DRAFT"),
    summary: jsonb("summary").notNull(),
    crossCheck: jsonb("cross_check").notNull(),
    crossCheckOk: boolean("cross_check_ok").notNull().default(false),
    preparedAt: timestamp("prepared_at", { withTimezone: true, mode: "string" }),
    preparedBy: uuid("prepared_by"),
    filedAt: timestamp("filed_at", { withTimezone: true, mode: "string" }),
    filedBy: uuid("filed_by"),
    filingReference: text("filing_reference"),
    filingNote: text("filing_note"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_vat_returns_window").on(
      table.tenantId,
      table.countryCode,
      table.periodStart,
      table.periodEnd,
    ),
    index("ix_vat_returns_tenant_period").on(
      table.tenantId,
      table.countryCode,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

/**
 * E-invoicing submission registry — OPERATIONAL since PHASE-023 (migration
 * 0035): 1:N per adapter (RELATIONSHIPS.md), retry chains via
 * retry_of_submission_id (append-only history — a resubmission is a NEW
 * row), sealed payload/response artifacts (files module), and the retry
 * sweep on (status, next_attempt_at).
 */
export const eInvoicingSubmissions = pgTable(
  "e_invoicing_submissions",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    adapterId: text("adapter_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    payloadDigest: text("payload_digest"),
    authorityReference: text("authority_reference"),
    // PHASE-023 (migration 0035) operational columns.
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "string" }),
    retryOfSubmissionId: uuid("retry_of_submission_id"),
    authorityRefs: jsonb("authority_refs").notNull().default([]),
    payloadFileId: uuid("payload_file_id"),
    responseFileId: uuid("response_file_id"),
    reportedAt: timestamp("reported_at", { withTimezone: true, mode: "string" }),
    lastErrorCode: text("last_error_code"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" }),
    errorDetail: jsonb("error_detail"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    // Registry idempotency: ONE LIVE row per document × adapter — REJECTED/
    // FAILED rows are history (the retry chain appends new rows).
    uniqueIndex("uq_einvoicing_submissions_live")
      .on(table.tenantId, table.sourceType, table.sourceId, table.adapterId)
      .where(
        sql`${table.status} IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'REPORTED')`,
      ),
    index("ix_einvoicing_submissions_retry_of").on(
      table.tenantId,
      table.retryOfSubmissionId,
    ),
    index("ix_einvoicing_submissions_retry")
      .on(table.status, table.nextAttemptAt)
      .where(sql`${table.status} IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED')`),
    index("ix_e_invoicing_tenant_status").on(
      table.tenantId,
      table.countryCode,
      table.status,
    ),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-023 · External Integrations cluster (migration
// 0035_external_integrations.sql; TABLES/tax-compliance.md §e-invoicing).
// The S-10 certificate registry (secret-store PATH only — key material
// lives in the files store), its append-only usage audit, the per-tenant
// adapter rollout flags (default OFF), the bank-statement parked lines +
// seeded format registry, the commerce channel staging tables, and the
// billing payout batches.
// ---------------------------------------------------------------------------

/**
 * S-10 certificate registry (SECRETS §6 HIGHEST): metadata + lifecycle
 * ONLY — the encrypted blob is external (files store
 * einvoicing/{jurisdiction}/{tenant}/…). Signing-job-only access; expiry
 * alerts 30/14/7 (expires_alerted_at dedupes per threshold); offboarding
 * purge removes secret paths.
 */
export const eInvoicingCertificates = pgTable(
  "e_invoicing_certificates",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    adapterId: text("adapter_id").notNull(),
    label: text("label").notNull(),
    keyVersion: text("key_version").notNull(),
    secretPath: text("secret_path").notNull(),
    fingerprint: text("fingerprint").notNull(),
    notBefore: timestamp("not_before", { withTimezone: true, mode: "string" }).notNull(),
    notAfter: timestamp("not_after", { withTimezone: true, mode: "string" }).notNull(),
    status: text("status").notNull().default("ACTIVE"),
    enrolledBy: uuid("enrolled_by"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    rotatedFromId: uuid("rotated_from_id"),
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
    expiresAlertedAt: jsonb("expires_alerted_at").notNull().default({}),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_e_invoicing_certificates_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_e_invoicing_certificates_path").on(table.secretPath),
    index("ix_einvoicing_certs_tenant").on(
      table.tenantId,
      table.adapterId,
      table.status,
    ),
  ],
);

/**
 * Append-only certificate usage audit — every decrypt/sign writes a row
 * (the signing-volume dashboard substrate). INSERT + SELECT only (grants);
 * retention sweeps bound growth.
 */
export const eInvoicingCertificateUsage = pgTable(
  "e_invoicing_certificate_usage",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    certificateId: uuid("certificate_id").notNull(),
    submissionId: uuid("submission_id"),
    operation: text("operation").notNull(),
    keyVersion: text("key_version").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_einvoicing_cert_usage_id_tenant").on(table.id, table.tenantId),
    index("ix_einvoicing_cert_usage_cert").on(
      table.tenantId,
      table.certificateId,
      table.usedAt,
    ),
  ],
);

/**
 * Per-tenant adapter rollout flag (T13) — default OFF; enabling requires a
 * provisioned ACTIVE certificate (service gate) and is audited. NEVER the
 * global feature_flags table (platform L8 vs tenant configuration).
 */
export const eInvoicingAdapterSettings = pgTable(
  "e_invoicing_adapter_settings",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    adapterId: text("adapter_id").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").notNull().default({}),
    enabledBy: uuid("enabled_by"),
    enabledAt: timestamp("enabled_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_e_invoicing_adapter_settings").on(table.tenantId, table.adapterId),
  ],
);

/**
 * Parked unparseable bank-statement rows (T7) — raw cells verbatim,
 * amounts NEVER guessed; resolution writes the mapped bank_statement_line
 * and links it; discard records why.
 */
export const bankStatementParkedLines = pgTable(
  "bank_statement_parked_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    statementId: uuid("statement_id").notNull(),
    lineIndex: integer("line_index").notNull(),
    rawCells: jsonb("raw_cells").notNull(),
    rawLine: text("raw_line").notNull(),
    parkedReason: text("parked_reason").notNull(),
    status: text("status").notNull().default("PARKED"),
    resolvedLineId: uuid("resolved_line_id"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
    resolutionNote: text("resolution_note"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_bank_parked_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_bank_parked_lines_slot").on(table.statementId, table.lineIndex),
    index("ix_bank_parked_tenant_status").on(table.tenantId, table.status),
  ],
);

/**
 * Commerce channel orders staged for the server-decision conflict policy
 * (T8) — upsert by natural key (tenant, channel, channel order id);
 * financial-field drift on re-import flags CONFLICT with the previous
 * payload preserved; resolution is an explicit human decision (ADR-0012 —
 * no LWW anywhere).
 */
export const commerceChannelOrders = pgTable(
  "commerce_channel_orders",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    channelAdapterId: text("channel_adapter_id").notNull(),
    channelOrderId: text("channel_order_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("IMPORTED"),
    conflictDetail: jsonb("conflict_detail"),
    importBatchId: uuid("import_batch_id"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
    resolution: text("resolution"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_commerce_channel_orders_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_commerce_channel_orders_natural").on(
      table.tenantId,
      table.channelAdapterId,
      table.channelOrderId,
    ),
    index("ix_commerce_orders_tenant_status").on(
      table.tenantId,
      table.channelAdapterId,
      table.status,
    ),
  ],
);

/**
 * Commerce import batch bookkeeping (T8) — the Idempotency-Key per batch
 * (a duplicate batch replays the recorded outcome without re-pulling),
 * cursors before/after, and the per-batch counters the UI surfaces.
 */
export const commerceChannelImports = pgTable(
  "commerce_channel_imports",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    channelAdapterId: text("channel_adapter_id").notNull(),
    batchKey: text("batch_key").notNull(),
    cursorBefore: jsonb("cursor_before"),
    cursorAfter: jsonb("cursor_after"),
    pulledCount: integer("pulled_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    conflictCount: integer("conflict_count").notNull().default(0),
    status: text("status").notNull().default("COMPLETED"),
    error: text("error"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_commerce_imports_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_commerce_imports_batch").on(
      table.tenantId,
      table.channelAdapterId,
      table.batchKey,
    ),
  ],
);

/**
 * Provider payout batches (T6) — the row records what the provider
 * REPORTED (gross/fee/net per batch); reconciliation compares against
 * settled platform payments in the window: RECONCILED or DRIFT with the
 * reported-vs-computed detail (drift NEVER auto-corrected). Sandbox-depth
 * until DR-002 decides the provider.
 */
export const billingPayouts = pgTable(
  "billing_payouts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerRef: text("provider_ref").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    grossAmount: numeric("gross_amount", { precision: 18, scale: 4 }).notNull(),
    feeAmount: numeric("fee_amount", { precision: 18, scale: 4 }).notNull(),
    netAmount: numeric("net_amount", { precision: 18, scale: 4 }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull(),
    status: text("status").notNull().default("PENDING"),
    settledPaymentCount: integer("settled_payment_count"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true, mode: "string" }),
    driftDetail: jsonb("drift_detail"),
    raw: jsonb("raw"),
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("uq_billing_payouts_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_billing_payouts_ref").on(table.providerId, table.providerRef),
    index("ix_billing_payouts_tenant").on(table.tenantId, table.status, table.periodEnd),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-010 inventory cluster (migrations 0014_inventory_core.sql +
// 0015_inventory_tracking.sql; TABLES/trade-inventory.md §inventory).

/** Warehouses: stock locations under a branch (G-15 account override). */
export const warehouses = pgTable(
  "warehouses",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    inventoryAccountId: uuid("inventory_account_id"),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "string" }),
    deactivatedBy: uuid("deactivated_by"),
    note: text("note"),
    // PHASE-017 (migration 0025): the VAN type + rep binding — a van is an
    // ordinary warehouse that a distribution rep carries (load-out/unload
    // are ordinary two-leg transfers; no valuation account of its own
    // unless the tenant maps branch-distinct inventory accounts).
    type: text("type").notNull().default("STANDARD"),
    repId: uuid("rep_id"),
    // PHASE-018 (migration 0026): the RAW/WIP/FG convention tag — display
    // and onboarding sugar only; no behavior depends on it.
    role: text("role"),
  },
  (table) => [
    uniqueIndex("uq_warehouses_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_warehouses_tenant_code").on(table.tenantId, table.code),
    uniqueIndex("uq_warehouses_tenant_name").on(table.tenantId, table.name),
    index("ix_warehouses_tenant_branch").on(table.tenantId, table.branchId),
    index("ix_warehouses_tenant_active").on(table.tenantId, table.isActive),
    index("ix_warehouses_tenant_type").on(table.tenantId, table.type, table.isActive),
  ],
);

/** Per-item-per-warehouse defaults (BR-019 reorder substrate). */
export const itemWarehouseSettings = pgTable(
  "item_warehouse_settings",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    reorderLevel: numeric("reorder_level", { precision: 19, scale: 6 })
      .notNull()
      .default("0"),
    minQty: numeric("min_qty", { precision: 19, scale: 6 })
      .notNull()
      .default("0"),
    lastReorderAlertedAt: timestamp("last_reorder_alerted_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    uniqueIndex("uq_item_warehouse_settings_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_item_warehouse_settings_tenant_item_wh").on(
      table.tenantId,
      table.itemId,
      table.warehouseId,
    ),
    index("ix_item_warehouse_settings_tenant_wh").on(table.tenantId, table.warehouseId),
  ],
);

/**
 * Stock movements — the append-only ledger 🔒 (INV-010/017/018). No
 * updated_at: the table is INSERT-only (grants + guard trigger mirror
 * cash_movements). qty is always positive; direction carries the sign;
 * value_amount is the exact 4-decimal journal quantum.
 */
export const stockMoves = pgTable(
  "stock_moves",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    direction: text("direction").notNull(),
    moveKind: text("move_kind").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 6 }).notNull(),
    valueAmount: numeric("value_amount", { precision: 19, scale: 4 }).notNull(),
    batchId: uuid("batch_id"),
    serialId: uuid("serial_id"),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    movedAt: date("moved_at").notNull(),
    reason: text("reason"),
    memo: text("memo"),
    memoAr: text("memo_ar"),
    postedJournalId: uuid("posted_journal_id"),
  },
  (table) => [
    uniqueIndex("uq_stock_moves_id_tenant").on(table.id, table.tenantId),
    index("ix_stock_moves_tenant_item_wh_date").on(
      table.tenantId,
      table.itemId,
      table.warehouseId,
      table.movedAt,
    ),
    index("ix_stock_moves_tenant_wh_date").on(table.tenantId, table.warehouseId, table.movedAt),
    index("ix_stock_moves_tenant_source").on(table.tenantId, table.sourceType, table.sourceId),
    index("ix_stock_moves_tenant_journal").on(table.tenantId, table.postedJournalId),
    index("ix_stock_moves_tenant_batch").on(table.tenantId, table.batchId),
    index("ix_stock_moves_tenant_serial").on(table.tenantId, table.serialId),
  ],
);

/** FIFO cost layers (created at receipt; consumed rows stay at qty 0). */
export const stockLayers = pgTable(
  "stock_layers",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    remainingQty: numeric("remaining_qty", { precision: 19, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 6 }).notNull(),
    sourceMoveId: uuid("source_move_id"),
    receivedAt: date("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_stock_layers_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_stock_layers_source_move").on(table.tenantId, table.sourceMoveId),
    index("ix_stock_layers_tenant_item_wh_received").on(
      table.tenantId,
      table.itemId,
      table.warehouseId,
      table.receivedAt,
    ),
  ],
);

/** On-hand read model (transactionally maintained; BR-013 negative policy). */
export const itemStock = pgTable(
  "item_stock",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 })
      .notNull()
      .default("0"),
    avgCost: numeric("avg_cost", { precision: 19, scale: 6 })
      .notNull()
      .default("0"),
  },
  (table) => [
    uniqueIndex("uq_item_stock_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_item_stock_tenant_item_wh").on(
      table.tenantId,
      table.itemId,
      table.warehouseId,
    ),
    index("ix_item_stock_tenant_wh").on(table.tenantId, table.warehouseId),
  ],
);

/** Stock transfers (DRAFT → IN_TRANSIT → POSTED; BR-16/G-15). */
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    transferNo: text("transfer_no"),
    fromWarehouseId: uuid("from_warehouse_id").notNull(),
    toWarehouseId: uuid("to_warehouse_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    dispatchDate: date("dispatch_date"),
    dispatchedBy: uuid("dispatched_by"),
    receiveDate: date("receive_date"),
    receivedBy: uuid("received_by"),
    postedJournalId: uuid("posted_journal_id"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_stock_transfers_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_stock_transfers_tenant_no").on(table.tenantId, table.transferNo),
    index("ix_stock_transfers_tenant_status").on(table.tenantId, table.status, table.createdAt),
    index("ix_stock_transfers_tenant_from").on(table.tenantId, table.fromWarehouseId),
    index("ix_stock_transfers_tenant_to").on(table.tenantId, table.toWarehouseId),
  ],
);

/** Transfer lines: one line per item per transfer. */
export const stockTransferLines = pgTable(
  "stock_transfer_lines",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    transferId: uuid("transfer_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_stock_transfer_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_stock_transfer_lines_no").on(table.transferId, table.lineNo),
    uniqueIndex("uq_stock_transfer_lines_item").on(table.tenantId, table.transferId, table.itemId),
    index("ix_stock_transfer_lines_tenant_transfer").on(table.tenantId, table.transferId, table.lineNo),
  ],
);

/** Manual stock adjustments (G-13/G-14; reason OTHER needs counter account). */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    adjustmentNo: text("adjustment_no"),
    warehouseId: uuid("warehouse_id").notNull(),
    itemId: uuid("item_id").notNull(),
    reason: text("reason").notNull(),
    deltaQty: numeric("delta_qty", { precision: 19, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 6 }),
    counterAccountId: uuid("counter_account_id"),
    status: text("status").notNull().default("DRAFT"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_stock_adjustments_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_stock_adjustments_tenant_no").on(table.tenantId, table.adjustmentNo),
    index("ix_stock_adjustments_tenant_status").on(table.tenantId, table.status, table.createdAt),
    index("ix_stock_adjustments_tenant_wh").on(table.tenantId, table.warehouseId),
  ],
);

/** Soft reservations (availability netting only — hard policies PHASE-015). */
export const stockReservations = pgTable(
  "stock_reservations",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    holderType: text("holder_type").notNull(),
    holderId: uuid("holder_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    status: text("status").notNull().default("ACTIVE"),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "string" }),
    releasedBy: uuid("released_by"),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_stock_reservations_id_tenant").on(table.id, table.tenantId),
    index("ix_stock_reservations_netting").on(
      table.tenantId,
      table.itemId,
      table.warehouseId,
      table.status,
    ),
  ],
);

/** Batch/lot registry (BR-017 FEFO basis). */
export const itemBatches = pgTable(
  "item_batches",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    itemId: uuid("item_id").notNull(),
    batchNo: text("batch_no").notNull(),
    expiryDate: date("expiry_date"),
    sourceRef: text("source_ref"),
    status: text("status").notNull().default("ACTIVE"),
    // PHASE-018 (migration 0026): the producing order for an FG batch —
    // set once at completion (produced-batch provenance, the genealogy
    // upstream edge; never re-pointed).
    productionOrderId: uuid("production_order_id"),
  },
  (table) => [
    uniqueIndex("uq_item_batches_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_item_batches_tenant_item_no").on(table.tenantId, table.itemId, table.batchNo),
    index("ix_item_batches_tenant_item_expiry").on(
      table.tenantId,
      table.itemId,
      table.expiryDate,
    ),
    index("ix_item_batches_tenant_status").on(table.tenantId, table.status),
    index("ix_item_batches_tenant_production_order")
      .on(table.tenantId, table.productionOrderId)
      .where(sql`${table.productionOrderId} IS NOT NULL`),
  ],
);

/** Serial/IMEI unit registry (BR-018 return binding). */
export const itemSerials = pgTable(
  "item_serials",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    itemId: uuid("item_id").notNull(),
    serialNo: text("serial_no").notNull(),
    imei: text("imei"),
    status: text("status").notNull().default("in_stock"),
    currentOwner: text("current_owner"),
    soldAt: date("sold_at"),
    returnedAt: date("returned_at"),
  },
  (table) => [
    uniqueIndex("uq_item_serials_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_item_serials_tenant_item_no").on(table.tenantId, table.itemId, table.serialNo),
    uniqueIndex("uq_item_serials_tenant_imei").on(table.tenantId, table.imei),
    index("ix_item_serials_tenant_item_status").on(table.tenantId, table.itemId, table.status),
  ],
);

/** Count sessions (DRAFT → COUNTED → VARIANCE_REVIEW → POSTED; BR-015). */
export const stockCounts = pgTable(
  "stock_counts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    countNo: text("count_no"),
    warehouseId: uuid("warehouse_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    blind: boolean("blind").notNull().default(false),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "string" }).notNull(),
    countedBy: uuid("counted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    supervisorOverride: boolean("supervisor_override").notNull().default(false),
    postingDate: date("posting_date"),
    postedJournalId: uuid("posted_journal_id"),
    variance: jsonb("variance"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_stock_counts_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_stock_counts_tenant_no").on(table.tenantId, table.countNo),
    index("ix_stock_counts_tenant_status").on(table.tenantId, table.status, table.createdAt),
    index("ix_stock_counts_tenant_wh").on(table.tenantId, table.warehouseId),
  ],
);

/** Count lines (frozen snapshot + counted qty + variance value impact). */
export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    stockCountId: uuid("stock_count_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id"),
    systemQty: numeric("system_qty", { precision: 19, scale: 6 }).notNull(),
    countedQty: numeric("counted_qty", { precision: 19, scale: 6 }),
    recounted: boolean("recounted").notNull().default(false),
    recountNote: text("recount_note"),
    valueImpact: numeric("value_impact", { precision: 19, scale: 4 }),
  },
  (table) => [
    uniqueIndex("uq_stock_count_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_stock_count_lines_no").on(table.stockCountId, table.lineNo),
    uniqueIndex("uq_stock_count_lines_count_item_plain").on(table.stockCountId, table.itemId),
    uniqueIndex("uq_stock_count_lines_count_item_batch").on(
      table.stockCountId,
      table.itemId,
      table.batchId,
    ),
    index("ix_stock_count_lines_tenant_count").on(table.tenantId, table.stockCountId, table.lineNo),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-011 purchasing cluster (migrations 0016/0017): procure-to-pay
// documents (PR/PO/GRN/supplier invoice/debit note), landed costs, and the
// audited AP re-allocation documents. Posted rows are immutable by service
// discipline + shape CHECKs (the treasury pattern).

/** Internal requisitions (approval routing → PO). */
export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    requestNo: text("request_no"),
    neededBy: date("needed_by"),
    status: text("status").notNull().default("DRAFT"),
    note: text("note"),
    noteAr: text("note_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" }),
    rejectedBy: uuid("rejected_by"),
    rejectionReason: text("rejection_reason"),
    convertedOrderId: uuid("converted_order_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_purchase_requests_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_purchase_requests_tenant_no").on(table.tenantId, table.requestNo),
    index("ix_purchase_requests_tenant_status").on(table.tenantId, table.status, table.createdAt),
    index("ix_purchase_requests_tenant_branch").on(table.tenantId, table.branchId),
  ],
);

export const purchaseRequestLines = pgTable(
  "purchase_request_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    requestId: uuid("request_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_purchase_request_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_purchase_request_lines_req_line").on(
      table.tenantId,
      table.requestId,
      table.lineNo,
    ),
    index("ix_purchase_request_lines_tenant_item").on(table.tenantId, table.itemId),
  ],
);

/** Supplier orders (DRAFT → ISSUED → CLOSED; amendments as linked revisions). */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    orderNo: text("order_no"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    revisionOfId: uuid("revision_of_id"),
    revisionNo: integer("revision_no").notNull().default(1),
    status: text("status").notNull().default("DRAFT"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSummary: jsonb("tax_summary"),
    note: text("note"),
    noteAr: text("note_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" }),
    rejectedBy: uuid("rejected_by"),
    rejectionReason: text("rejection_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }),
    issuedBy: uuid("issued_by"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_purchase_orders_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_purchase_orders_tenant_no").on(table.tenantId, table.orderNo),
    index("ix_purchase_orders_tenant_status").on(table.tenantId, table.status, table.orderDate),
    index("ix_purchase_orders_tenant_supplier").on(table.tenantId, table.supplierId, table.orderDate),
    index("ix_purchase_orders_tenant_branch").on(table.tenantId, table.branchId),
    index("ix_purchase_orders_revision_chain").on(table.tenantId, table.revisionOfId),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    priceSource: text("price_source").notNull().default("MANUAL"),
    requestLineId: uuid("request_line_id"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_purchase_order_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_purchase_order_lines_order_line").on(table.tenantId, table.orderId, table.lineNo),
    index("ix_purchase_order_lines_tenant_item").on(table.tenantId, table.itemId),
  ],
);

/** Goods-in documents (POSTED receives stock + GRNI accrual; golden G-07). */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    poId: uuid("po_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    receiptNo: text("receipt_no"),
    receiptDate: date("receipt_date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    poLessReason: text("po_less_reason"),
    totalValue: numeric("total_value", { precision: 19, scale: 4 }).notNull().default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_goods_receipts_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_goods_receipts_tenant_no").on(table.tenantId, table.receiptNo),
    index("ix_goods_receipts_tenant_status").on(table.tenantId, table.status, table.receiptDate),
    index("ix_goods_receipts_tenant_supplier").on(table.tenantId, table.supplierId, table.receiptDate),
    index("ix_goods_receipts_tenant_po").on(table.tenantId, table.poId),
    index("ix_goods_receipts_tenant_wh").on(table.tenantId, table.warehouseId),
  ],
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    lineNo: integer("line_no").notNull(),
    poLineId: uuid("po_line_id"),
    itemId: uuid("item_id").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 6 }).notNull().default("0"),
    valueAmount: numeric("value_amount", { precision: 19, scale: 4 }).notNull(),
    accountId: uuid("account_id"),
    batchNo: text("batch_no"),
    batchExpiry: date("batch_expiry"),
    serialIds: jsonb("serial_ids"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_goods_receipt_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_goods_receipt_lines_receipt_line").on(
      table.tenantId,
      table.receiptId,
      table.lineNo,
    ),
    index("ix_goods_receipt_lines_tenant_item").on(table.tenantId, table.itemId),
    index("ix_goods_receipt_lines_po_line").on(table.tenantId, table.poLineId),
  ],
);

/** AP invoices (G-08; match outcome recorded before approval — BR-009). */
export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    invoiceNo: text("invoice_no").notNull(),
    internalNo: text("internal_no"),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    poId: uuid("po_id"),
    status: text("status").notNull().default("DRAFT"),
    matchStatus: text("match_status").notNull().default("PENDING"),
    matchResult: jsonb("match_result"),
    duplicateWarning: jsonb("duplicate_warning"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSummary: jsonb("tax_summary"),
    note: text("note"),
    noteAr: text("note_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_supplier_invoices_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_supplier_invoices_tenant_internal").on(table.tenantId, table.internalNo),
    index("ix_supplier_invoices_tenant_status").on(table.tenantId, table.status, table.invoiceDate),
    index("ix_supplier_invoices_tenant_supplier_due").on(
      table.tenantId,
      table.supplierId,
      table.dueDate,
    ),
    index("ix_supplier_invoices_tenant_supplier_no").on(
      table.tenantId,
      table.supplierId,
      table.invoiceNo,
    ),
    index("ix_supplier_invoices_tenant_po").on(table.tenantId, table.poId),
  ],
);

export const supplierInvoiceLines = pgTable(
  "supplier_invoice_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    lineNo: integer("line_no").notNull(),
    grnLineId: uuid("grn_line_id"),
    poLineId: uuid("po_line_id"),
    itemId: uuid("item_id"),
    accountId: uuid("account_id"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    vatRecoverable: boolean("vat_recoverable").notNull().default(true),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSnapshot: jsonb("tax_snapshot"),
    grniClearedValue: numeric("grni_cleared_value", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    stockRevalueValue: numeric("stock_revalue_value", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_supplier_invoice_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_supplier_invoice_lines_invoice_line").on(
      table.tenantId,
      table.invoiceId,
      table.lineNo,
    ),
    index("ix_supplier_invoice_lines_tenant_item").on(table.tenantId, table.itemId),
    index("ix_supplier_invoice_lines_grn_line").on(table.tenantId, table.grnLineId),
  ],
);

/** AP corrections mirroring supplier invoices (golden G-09). */
export const debitNotes = pgTable(
  "debit_notes",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    refInvoiceId: uuid("ref_invoice_id").notNull(),
    noteNo: text("note_no"),
    noteDate: date("note_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    status: text("status").notNull().default("DRAFT"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSummary: jsonb("tax_summary"),
    note: text("note"),
    noteAr: text("note_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_debit_notes_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_debit_notes_tenant_no").on(table.tenantId, table.noteNo),
    index("ix_debit_notes_tenant_status").on(table.tenantId, table.status, table.noteDate),
    index("ix_debit_notes_tenant_supplier").on(table.tenantId, table.supplierId, table.noteDate),
    index("ix_debit_notes_ref_invoice").on(table.tenantId, table.refInvoiceId),
  ],
);

export const debitNoteLines = pgTable(
  "debit_note_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    noteId: uuid("note_id").notNull(),
    lineNo: integer("line_no").notNull(),
    invoiceLineId: uuid("invoice_line_id"),
    itemId: uuid("item_id"),
    accountId: uuid("account_id"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    vatRecoverable: boolean("vat_recoverable").notNull().default(true),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSnapshot: jsonb("tax_snapshot"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_debit_note_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_debit_note_lines_note_line").on(table.tenantId, table.noteId, table.lineNo),
    index("ix_debit_note_lines_tenant_item").on(table.tenantId, table.itemId),
  ],
);

/** Landed costs (PHASE-011 baseline — allocation math + remaining-qty constraint). */
export const landedCosts = pgTable(
  "landed_costs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    grnId: uuid("grn_id").notNull(),
    costNo: text("cost_no"),
    costType: text("cost_type").notNull(),
    vendorId: uuid("vendor_id"),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    allocationMethod: text("allocation_method").notNull().default("VALUE"),
    chargeAccountId: uuid("charge_account_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    allocatedToStock: numeric("allocated_to_stock", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    allocatedToCogs: numeric("allocated_to_cogs", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_landed_costs_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_landed_costs_tenant_no").on(table.tenantId, table.costNo),
    index("ix_landed_costs_tenant_grn").on(table.tenantId, table.grnId),
    index("ix_landed_costs_tenant_status").on(table.tenantId, table.status),
  ],
);

export const landedCostAllocations = pgTable(
  "landed_cost_allocations",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    landedCostId: uuid("landed_cost_id").notNull(),
    grnLineId: uuid("grn_line_id").notNull(),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    qtyAtAllocation: numeric("qty_at_allocation", { precision: 19, scale: 6 }).notNull(),
    remainingQty: numeric("remaining_qty", { precision: 19, scale: 6 }).notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 19, scale: 4 }).notNull(),
    cogsAdjustmentAmount: numeric("cogs_adjustment_amount", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    revalueAppliedAt: timestamp("revalue_applied_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_landed_cost_allocations_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_landed_cost_allocations_cost_line").on(
      table.tenantId,
      table.landedCostId,
      table.grnLineId,
    ),
    index("ix_landed_cost_allocations_tenant_item").on(
      table.tenantId,
      table.itemId,
      table.warehouseId,
    ),
  ],
);

/** Audited AP re-allocation documents (post-allocation moves, BR-027/§3.3). */
export const purchaseReallocations = pgTable(
  "purchase_reallocations",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    docNo: text("doc_no"),
    paymentId: uuid("payment_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("POSTED"),
    totalAmount: numeric("total_amount", { precision: 19, scale: 4 }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_purchase_reallocations_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_purchase_reallocations_tenant_no").on(table.tenantId, table.docNo),
    index("ix_purchase_reallocations_tenant_payment").on(table.tenantId, table.paymentId),
    index("ix_purchase_reallocations_tenant_supplier").on(
      table.tenantId,
      table.supplierId,
      table.createdAt,
    ),
  ],
);

export const purchaseReallocationLines = pgTable(
  "purchase_reallocation_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    reallocationId: uuid("reallocation_id").notNull(),
    lineNo: integer("line_no").notNull(),
    fromOpenItemId: uuid("from_open_item_id"),
    toOpenItemId: uuid("to_open_item_id"),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_purchase_reallocation_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_purchase_reallocation_lines_doc_line").on(
      table.tenantId,
      table.reallocationId,
      table.lineNo,
    ),
    index("ix_purchase_reallocation_lines_tenant_doc").on(
      table.tenantId,
      table.reallocationId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-012 sales cluster (migrations 0018_sales_core + 0019_sales_ar).
// Mirror rule: column-for-column with the SQL (sync docs rule); draft-
// lifecycle tables (SELECT/INSERT/UPDATE), posted rows immutable by service
// discipline + shape CHECKs; the re-allocation pair is INSERT-only.
// ---------------------------------------------------------------------------

/** Sales reps (§2.10 T12): attribution only — commissions are PHASE-017. */
export const salesReps = pgTable(
  "sales_reps",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by"),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    email: text("email"),
    phone: text("phone"),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
    // PHASE-017 (migration 0025): commission rule columns (T12) — flat
    // percentage or tiered bands on the INVOICED or COLLECTED base; runs
    // accrue at run time (POSTING_ENGINE §4 row).
    commissionMethod: text("commission_method").notNull().default("NONE"),
    commissionRate: numeric("commission_rate", { precision: 7, scale: 4 }).notNull().default("0"),
    commissionBasis: text("commission_basis").notNull().default("INVOICED"),
    commissionTiers: jsonb("commission_tiers"),
  },
  (table) => [
    uniqueIndex("uq_sales_reps_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_sales_reps_tenant_code").on(table.tenantId, table.code),
    index("ix_sales_reps_tenant_status").on(table.tenantId, table.status, table.code),
  ],
);

/** Quotations (§2.1; BR-006 validity, no ledger effect). */
export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by"),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    salesRepId: uuid("sales_rep_id"),
    quoteNo: text("quote_no"),
    quoteDate: date("quote_date").notNull(),
    validUntil: date("valid_until").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    status: text("status").notNull().default("DRAFT"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    sentBy: uuid("sent_by"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "string" }),
    acceptedBy: uuid("accepted_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" }),
    rejectedBy: uuid("rejected_by"),
    rejectionReason: text("rejection_reason"),
    convertedOrderId: uuid("converted_order_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_quotations_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_quotations_tenant_no").on(table.tenantId, table.quoteNo),
    index("ix_quotations_tenant_status").on(table.tenantId, table.status, table.quoteDate),
    index("ix_quotations_tenant_customer").on(table.tenantId, table.customerId, table.quoteDate),
  ],
);

export const quotationLines = pgTable(
  "quotation_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    quotationId: uuid("quotation_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").notNull(),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_quotation_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_quotation_lines_quote_line").on(table.tenantId, table.quotationId, table.lineNo),
    index("ix_quotation_lines_tenant_quote").on(table.tenantId, table.quotationId),
  ],
);

/** Sales orders (§2.2): soft-reservation seam + BR-029 numbering at issue. */
export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by"),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    salesRepId: uuid("sales_rep_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    quotationId: uuid("quotation_id"),
    orderNo: text("order_no"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    status: text("status").notNull().default("DRAFT"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }),
    issuedBy: uuid("issued_by"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_sales_orders_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_sales_orders_tenant_no").on(table.tenantId, table.orderNo),
    index("ix_sales_orders_tenant_status").on(table.tenantId, table.status, table.orderDate),
    index("ix_sales_orders_tenant_customer").on(table.tenantId, table.customerId, table.orderDate),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").notNull(),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    reservationId: uuid("reservation_id"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_sales_order_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_sales_order_lines_order_line").on(table.tenantId, table.orderId, table.lineNo),
    index("ix_sales_order_lines_tenant_order").on(table.tenantId, table.orderId),
  ],
);

/** Delivery notes (§2.3; BR-007 flow A; golden G-03 COGS, no AR). */
export const deliveryNotes = pgTable(
  "delivery_notes",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by"),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    salesRepId: uuid("sales_rep_id"),
    orderId: uuid("order_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    deliveryNo: text("delivery_no"),
    deliveryDate: date("delivery_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    status: text("status").notNull().default("DRAFT"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    cogsValue: numeric("cogs_value", { precision: 19, scale: 4 }).notNull().default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    convertedInvoiceId: uuid("converted_invoice_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_delivery_notes_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_delivery_notes_tenant_no").on(table.tenantId, table.deliveryNo),
    index("ix_delivery_notes_tenant_status").on(table.tenantId, table.status, table.deliveryDate),
    index("ix_delivery_notes_tenant_customer").on(
      table.tenantId,
      table.customerId,
      table.deliveryDate,
    ),
  ],
);

export const deliveryNoteLines = pgTable(
  "delivery_note_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    deliveryId: uuid("delivery_id").notNull(),
    lineNo: integer("line_no").notNull(),
    orderLineId: uuid("order_line_id"),
    itemId: uuid("item_id").notNull(),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    batchId: uuid("batch_id"),
    serialIds: jsonb("serial_ids"),
    issueUnitCost: numeric("issue_unit_cost", { precision: 19, scale: 6 }),
    issueValue: numeric("issue_value", { precision: 19, scale: 4 }),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_delivery_note_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_delivery_note_lines_delivery_line").on(
      table.tenantId,
      table.deliveryId,
      table.lineNo,
    ),
    index("ix_delivery_note_lines_tenant_delivery").on(table.tenantId, table.deliveryId),
  ],
);

/** Sales invoices (§2.4; goldens G-01/G-02/G-03; W-1). */
export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by"),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    salesRepId: uuid("sales_rep_id"),
    kind: text("kind").notNull(),
    invoiceNo: text("invoice_no"),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    orderId: uuid("order_id"),
    deliveryId: uuid("delivery_id"),
    warehouseId: uuid("warehouse_id"),
    cashAccountId: uuid("cash_account_id"),
    status: text("status").notNull().default("DRAFT"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    cogsValue: numeric("cogs_value", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSummary: jsonb("tax_summary"),
    creditCheck: jsonb("credit_check"),
    offlineReceiptNo: text("offline_receipt_no"),
    einvoiceStatus: text("einvoice_status"),
    // PHASE-016 (T5): the POS channel — a POS sale IS a sales invoice
    // (channel='POS') with terminal/order-type/check provenance + the
    // tender split that shapes the G-02 debit (cash → till, card →
    // CARD_RECEIVABLE).
    channel: text("channel").notNull().default("STANDARD"),
    posTerminalId: uuid("pos_terminal_id"),
    orderType: text("order_type"),
    // PHASE-017 (migration 0025): job-card provenance + per-vehicle history.
    jobCardId: uuid("job_card_id"),
    vehicleId: uuid("vehicle_id"),
    posTableId: uuid("pos_table_id"),
    tenders: jsonb("tenders"),
    // PHASE-019 (migration 0027): the service-billing provenance trio —
    // contract (the recurring-billing link), service order (the work-order
    // invoice), project (the analytical stamp carried onto every journal
    // line of the post + COGS journals).
    contractId: uuid("contract_id"),
    serviceOrderId: uuid("service_order_id"),
    projectId: uuid("project_id"),
    // PHASE-020 (migration 0029): the drafts owner-device stamp
    // (OWNER_DEVICE_WINS, MASTER-PLAN §7) — create_draft stamps the
    // creating device; update_draft rejects non-owners + stale versions;
    // the admin reassign route re-stamps.
    ownerDeviceId: uuid("owner_device_id"),
    note: text("note"),
    noteAr: text("note_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    postedCogsJournalId: uuid("posted_cogs_journal_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_sales_invoices_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_sales_invoices_tenant_no").on(table.tenantId, table.invoiceNo),
    index("ix_sales_invoices_tenant_customer_due").on(
      table.tenantId,
      table.customerId,
      table.dueDate,
    ),
    index("ix_sales_invoices_tenant_status").on(table.tenantId, table.status, table.invoiceDate),
    index("ix_sales_invoices_tenant_order").on(table.tenantId, table.orderId),
    index("ix_sales_invoices_tenant_delivery").on(table.tenantId, table.deliveryId),
    index("ix_sales_invoices_tenant_contract")
      .on(table.tenantId, table.contractId)
      .where(sql`${table.contractId} IS NOT NULL`),
    index("ix_sales_invoices_tenant_service_order")
      .on(table.tenantId, table.serviceOrderId)
      .where(sql`${table.serviceOrderId} IS NOT NULL`),
    index("ix_sales_invoices_tenant_project")
      .on(table.tenantId, table.projectId)
      .where(sql`${table.projectId} IS NOT NULL`),
    index("ix_sales_invoices_tenant_owner_device").on(table.tenantId, table.ownerDeviceId),
    index("ix_sales_invoices_owner_device")
      .on(table.ownerDeviceId)
      .where(sql`${table.ownerDeviceId} IS NOT NULL`),
  ],
);

export const salesInvoiceLines = pgTable(
  "sales_invoice_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id"),
    accountId: uuid("account_id"),
    deliveryLineId: uuid("delivery_line_id"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSnapshot: jsonb("tax_snapshot"),
    batchId: uuid("batch_id"),
    serialIds: jsonb("serial_ids"),
    issueUnitCost: numeric("issue_unit_cost", { precision: 19, scale: 6 }),
    issueValue: numeric("issue_value", { precision: 19, scale: 4 }),
    // PHASE-017 (migration 0025): BR-008 FOC reason code — zero-price lines
    // still issue stock and post COGS; the reason rides the line.
    focReasonCode: text("foc_reason_code"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_sales_invoice_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_sales_invoice_lines_invoice_line").on(
      table.tenantId,
      table.invoiceId,
      table.lineNo,
    ),
    index("ix_sales_invoice_lines_tenant_invoice").on(table.tenantId, table.invoiceId),
    index("ix_sales_invoice_lines_tenant_delivery_line").on(
      table.tenantId,
      table.deliveryLineId,
    ),
  ],
);

/** Credit notes (§2.5; BR-004; golden G-04/W-3). */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by"),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    salesRepId: uuid("sales_rep_id"),
    invoiceId: uuid("invoice_id").notNull(),
    // PHASE-017 (migration 0025): the warranty credit note's card link.
    jobCardId: uuid("job_card_id"),
    noteNo: text("note_no"),
    noteDate: date("note_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 8 }),
    status: text("status").notNull().default("DRAFT"),
    totalNet: numeric("total_net", { precision: 19, scale: 4 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 19, scale: 4 }).notNull().default("0"),
    totalGross: numeric("total_gross", { precision: 19, scale: 4 }).notNull().default("0"),
    reentryValue: numeric("reentry_value", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSummary: jsonb("tax_summary"),
    note: text("note"),
    noteAr: text("note_ar"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postingDate: date("posting_date"),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedJournalId: uuid("posted_journal_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("uq_credit_notes_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_credit_notes_tenant_no").on(table.tenantId, table.noteNo),
    index("ix_credit_notes_tenant_status").on(table.tenantId, table.status, table.noteDate),
    index("ix_credit_notes_tenant_invoice").on(table.tenantId, table.invoiceId),
  ],
);

export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    noteId: uuid("note_id").notNull(),
    lineNo: integer("line_no").notNull(),
    invoiceLineId: uuid("invoice_line_id").notNull(),
    itemId: uuid("item_id"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxSnapshot: jsonb("tax_snapshot"),
    returnToStock: boolean("return_to_stock").notNull().default(false),
    batchId: uuid("batch_id"),
    serialIds: jsonb("serial_ids"),
    reentryUnitCost: numeric("reentry_unit_cost", { precision: 19, scale: 6 }),
    reentryValue: numeric("reentry_value", { precision: 19, scale: 4 }),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_credit_note_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_credit_note_lines_note_line").on(table.tenantId, table.noteId, table.lineNo),
    index("ix_credit_note_lines_tenant_note").on(table.tenantId, table.noteId),
  ],
);

/** Audited AR re-allocation documents (post-allocation moves, BR-027/§3.3). */
export const salesReallocations = pgTable(
  "sales_reallocations",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    docNo: text("doc_no"),
    receiptId: uuid("receipt_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("POSTED"),
    totalAmount: numeric("total_amount", { precision: 19, scale: 4 }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_sales_reallocations_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_sales_reallocations_tenant_no").on(table.tenantId, table.docNo),
    index("ix_sales_reallocations_tenant_receipt").on(table.tenantId, table.receiptId),
    index("ix_sales_reallocations_tenant_customer").on(
      table.tenantId,
      table.customerId,
      table.createdAt,
    ),
  ],
);

export const salesReallocationLines = pgTable(
  "sales_reallocation_lines",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    reallocationId: uuid("reallocation_id").notNull(),
    lineNo: integer("line_no").notNull(),
    fromOpenItemId: uuid("from_open_item_id"),
    toOpenItemId: uuid("to_open_item_id"),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_sales_reallocation_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_sales_reallocation_lines_doc_line").on(
      table.tenantId,
      table.reallocationId,
      table.lineNo,
    ),
    index("ix_sales_reallocation_lines_tenant_doc").on(table.tenantId, table.reallocationId),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-013 · reporting (migration 0020_reporting_core.sql)
//
// The reporting module owns exactly these two tables (ADR-0011;
// MODULE_BOUNDARIES §"reporting"): run orchestration + the print-template
// registry. All business truth stays in the owning modules — reports read
// through module-owned authorized query services only (RISK-016).
// ---------------------------------------------------------------------------

export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    reportKey: text("report_key").notNull(),
    contractVersion: integer("contract_version").notNull(),
    params: jsonb("params").notNull(),
    paramsHash: text("params_hash").notNull(),
    executionClass: text("execution_class").notNull(),
    status: text("status").notNull().default("QUEUED"),
    stage: text("stage"),
    requestedBy: uuid("requested_by"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    errorDetail: jsonb("error_detail"),
    assertionStatus: text("assertion_status"),
    result: jsonb("result"),
    assertions: jsonb("assertions"),
    artifacts: jsonb("artifacts"),
    correlationId: text("correlation_id"),
  },
  (table) => [
    uniqueIndex("uq_report_runs_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_report_runs_tenant_key_params").on(
      table.tenantId,
      table.reportKey,
      table.paramsHash,
    ),
    index("ix_report_runs_tenant_created").on(table.tenantId, table.createdAt),
    index("ix_report_runs_tenant_requested_by").on(
      table.tenantId,
      table.requestedBy,
      table.createdAt,
    ),
  ],
);

export const printTemplates = pgTable(
  "print_templates",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    localeVariants: jsonb("locale_variants").notNull(),
    metadata: jsonb("metadata"),
  },
  (table) => [
    uniqueIndex("uq_print_templates_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_print_templates_tenant_key").on(table.tenantId, table.key),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-014 · subscriptions, billing, usage & notifications (migration
// 0021_subscriptions_billing.sql): the billing history both payment paths
// write identically (A-009), the append-only billing trail (webhook
// idempotency keys = replay protection), the §6 usage read model, and the
// in-app inbox + per-user preferences.
// ---------------------------------------------------------------------------

/** Billing history rows (OPEN → PAID/VOID/UNCOLLECTIBLE). */
export const subscriptionInvoices = pgTable(
  "subscription_invoices",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    subscriptionId: uuid("subscription_id").notNull(),
    number: text("number").notNull(),
    planKey: text("plan_key").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    status: text("status").notNull().default("OPEN"),
    source: text("source").notNull(),
    providerRef: text("provider_ref"),
    dueDate: date("due_date").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "string" }),
    paidVia: text("paid_via"),
    paidReference: text("paid_reference"),
    recordedBy: uuid("recorded_by"),
    reason: text("reason"),
    placeholderPrice: boolean("placeholder_price").notNull().default(true),
  },
  (table) => [
    uniqueIndex("uq_subscription_invoices_number").on(table.tenantId, table.number),
    index("ix_subscription_invoices_tenant").on(table.tenantId, table.createdAt),
  ],
);

/** Append-only billing event trail (guard trigger in SQL; SELECT/INSERT grants). */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    idempotencyKey: text("idempotency_key"),
    actorId: uuid("actor_id"),
    viaPlatformAdmin: boolean("via_platform_admin").notNull().default(false),
    correlationId: text("correlation_id"),
  },
  (table) => [
    uniqueIndex("uq_billing_events_idempotency").on(table.idempotencyKey),
    index("ix_billing_events_tenant").on(table.tenantId, table.createdAt),
  ],
);

/** Usage read model (documents/month per YYYY-MM; structural 'CURRENT' stamps). */
export const usageCounters = pgTable(
  "usage_counters",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    counterKey: text("counter_key").notNull(),
    period: text("period").notNull(),
    value: integer("value").notNull().default(0),
  },
  (table) => [
    uniqueIndex("uq_usage_counters_tenant_key_period").on(
      table.tenantId,
      table.counterKey,
      table.period,
    ),
    index("ix_usage_counters_tenant").on(table.tenantId, table.counterKey),
  ],
);

/** In-app inbox rows (bilingual jsonb payloads; dedupe_key once-per-event). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    userId: uuid("user_id"),
    category: text("category").notNull(),
    severity: text("severity").notNull().default("info"),
    title: jsonb("title").notNull(),
    body: jsonb("body").notNull().default(sql`'{}'::jsonb`),
    actionLabel: jsonb("action_label"),
    actionUrl: text("action_url"),
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_notifications_dedupe").on(table.tenantId, table.dedupeKey),
    index("ix_notifications_tenant_created").on(table.tenantId, table.createdAt),
    index("ix_notifications_unread").on(table.tenantId, table.readAt),
  ],
);

/** Per-user channel toggles per category (absent rows = both channels on). */
export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    category: text("category").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
  },
  (table) => [
    uniqueIndex("uq_notification_prefs_user_category").on(table.userId, table.category),
    index("ix_notification_prefs_tenant").on(table.tenantId, table.userId),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-015 · industry configuration framework (migration
// 0022_industry_configuration.sql): the applied-template state per tenant
// (additive-only switching per BR-038 — archives ride as jsonb snapshots,
// never extra rows), platform-owned L8 rollout flags (no tenant_id, no RLS),
// and composite-product component definitions (items.composite_products:
// explosion at posting reads these rows).
// ---------------------------------------------------------------------------

/**
 * Applied industry-template state — exactly one row per tenant
 * (uq_tenant_industry_config_tenant); applied_manifest_hash pins the exact
 * manifest content applied so switch/extend can diff against it.
 */
export const tenantIndustryConfig = pgTable(
  "tenant_industry_config",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    templateKey: text("template_key").notNull(),
    appliedVersion: text("applied_version").notNull(),
    appliedManifestHash: text("applied_manifest_hash").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    appliedBy: uuid("applied_by"),
    status: text("status").notNull().default("ACTIVE"),
    overrides: jsonb("overrides").notNull().default(sql`'{}'::jsonb`),
    archivedTerminology: jsonb("archived_terminology").notNull().default(sql`'[]'::jsonb`),
    archivedNavigation: jsonb("archived_navigation").notNull().default(sql`'[]'::jsonb`),
    archivedCapabilities: jsonb("archived_capabilities").notNull().default(sql`'[]'::jsonb`),
    conflictNotes: jsonb("conflict_notes").notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    uniqueIndex("uq_tenant_industry_config_tenant").on(table.tenantId),
    index("ix_tenant_industry_config_tenant").on(table.tenantId),
  ],
);

/** Global reference: L8 platform rollout flags (read-only to the app). */
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  scope: text("scope").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  rules: jsonb("rules").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

/** Composite-product definitions: one row per (composite, component) pair. */
export const itemComponents = pgTable(
  "item_components",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    compositeItemId: uuid("composite_item_id").notNull(),
    componentItemId: uuid("component_item_id").notNull(),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_item_components_pair").on(table.compositeItemId, table.componentItemId),
    index("ix_item_components_tenant").on(table.tenantId),
    index("ix_item_components_composite").on(table.compositeItemId),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-016 · Point of Sale (migration 0024). The pos module is the
// terminal layer over sales: terminals bound to branches/devices/tills,
// the ledger-free table-service floor, the narrow sync slice (§11), and
// the POS channel columns on sales_invoices (added above).
// ---------------------------------------------------------------------------

/** POS terminal registry (T2): one row per branch counter — till binding,
 * receipt size, activate/deactivate lifecycle, per-terminal OFF- sequence. */
export const posTerminals = pgTable(
  "pos_terminals",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    branchId: uuid("branch_id").notNull(),
    deviceId: uuid("device_id"),
    cashAccountId: uuid("cash_account_id").notNull(),
    warehouseId: uuid("warehouse_id"),
    receiptSize: text("receipt_size").notNull().default("80mm"),
    status: text("status").notNull().default("ACTIVE"),
    quickKeys: jsonb("quick_keys"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "string" }),
    offlineSeq: integer("offline_seq").notNull().default(0),
  },
  (table) => [
    uniqueIndex("uq_pos_terminals_tenant_code").on(table.tenantId, table.code),
    uniqueIndex("uq_pos_terminals_tenant_device").on(table.tenantId, table.deviceId),
    index("ix_pos_terminals_tenant_branch").on(table.tenantId, table.branchId, table.status),
  ],
);

/** Floor-plan tables (T6): zones + labels; ledger-free by design. */
export const posTables = pgTable(
  "pos_tables",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    zone: text("zone").notNull().default("MAIN"),
    zoneAr: text("zone_ar"),
    label: text("label").notNull(),
    seats: integer("seats").notNull().default(4),
    status: text("status").notNull().default("FREE"),
    sortKey: integer("sort_key").notNull().default(0),
  },
  (table) => [index("ix_pos_tables_tenant_branch").on(table.tenantId, table.branchId, table.zone, table.sortKey)],
);

/** Open guest checks (T6): unpaid = NO ledger effect; lines jsonb is the
 * working order document (send/merge/transfer/split); converts to a POS
 * sale at payment and only then posts. */
export const posChecks = pgTable(
  "pos_checks",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    checkNo: text("check_no").notNull(),
    tableId: uuid("table_id"),
    orderType: text("order_type").notNull().default("DINE_IN"),
    guestCount: integer("guest_count").notNull().default(1),
    status: text("status").notNull().default("OPEN"),
    lines: jsonb("lines").notNull().default(sql`'[]'::jsonb`),
    openedBy: uuid("opened_by"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    invoiceId: uuid("invoice_id"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_pos_checks_tenant_no").on(table.tenantId, table.checkNo),
    index("ix_pos_checks_tenant_branch_status").on(table.tenantId, table.branchId, table.status, table.openedAt),
  ],
);

/** Printed kitchen tickets (T6): print-only — screen KDS is a roadmap
 * extension; tickets never touch the ledger. */
export const posKitchenTickets = pgTable(
  "pos_kitchen_tickets",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    checkId: uuid("check_id").notNull(),
    ticketNo: text("ticket_no").notNull(),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("PRINTED"),
    printedAt: timestamp("printed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_pos_kitchen_tickets_tenant_no").on(table.tenantId, table.ticketNo),
    index("ix_pos_kitchen_tickets_tenant_check").on(table.tenantId, table.checkId, table.printedAt),
  ],
);

/** Sync change feed — the NARROW POS slice (T8; SYNC_PROTOCOL §11): one
 * feed group (items/barcodes/uoms/price_list_items/partners/tax_codes +
 * terminal config). PHASE-020 generalizes; never shrinks this contract. */
export const changeLog = pgTable(
  "change_log",
  {
    seq: bigserial({ mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op").notNull(),
    payload: jsonb("payload"),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [index("ix_change_log_tenant_entity_seq").on(table.tenantId, table.entityType, table.seq)],
);

/** Per-device pull positions (SYNC_PROTOCOL §2): opaque cursors advanced
 * server-side only on acknowledged batches. */
export const syncCursors = pgTable(
  "sync_cursors",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    entityType: text("entity_type").notNull(),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_sync_cursors_device_entity").on(table.deviceId, table.entityType),
    index("ix_sync_cursors_tenant_device").on(table.tenantId, table.deviceId),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-020 · Offline Synchronization Foundation (migration
// 0029_sync_foundation.sql; MASTER-PLAN §3). tombstones + inbox_commands
// are tenant-owned (RLS macro); device_refresh_tokens is identity-owned,
// service-mediated (the sessions pattern — no RLS by design).
// ---------------------------------------------------------------------------

/** The soft-delete GC ledger (MASTER-PLAN §3/§5.7): feed entries (change_log
 * op:'DELETE' rows) are the transport; this table tracks the GC boundary so
 * the weekly sweep is bounded and a device that missed a delete within the
 * horizon can still be told. deleted_at AND gc_after are app-provided. */
export const tombstones = pgTable(
  "tombstones",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }).notNull(),
    gcAfter: timestamp("gc_after", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_tombstones_tenant_entity").on(table.tenantId, table.entityType, table.entityId),
    index("ix_tombstones_tenant_gc").on(table.tenantId, table.gcAfter),
  ],
);

/** The push dedupe ledger (MASTER-PLAN §6): one row per EXECUTED command
 * (ACCEPTED or REJECTED — DEFERRED commands are never recorded); a
 * redelivery replays the stored result with duplicate:true (C-01/C-04). */
export const inboxCommands = pgTable(
  "inbox_commands",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    commandId: text("command_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    entityType: text("entity_type").notNull(),
    intent: text("intent").notNull(),
    status: text("status").notNull(),
    result: jsonb("result").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_inbox_commands_device_command").on(
      table.tenantId,
      table.deviceId,
      table.commandId,
    ),
    index("ix_inbox_commands_tenant_idempotency").on(table.tenantId, table.idempotencyKey),
    index("ix_inbox_commands_tenant_processed").on(table.tenantId, table.processedAt),
  ],
);

/** Device refresh tokens (identity-owned, service-mediated — the sessions
 * pattern; MASTER-PLAN §1.4/§9): hash-at-rest, one-time-use rotation chain.
 * used_at is the reuse-detection tripwire (reuse revokes the device);
 * predecessor_id links a successor to its consumed predecessor. */
export const deviceRefreshTokens = pgTable(
  "device_refresh_tokens",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    predecessorId: uuid("predecessor_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_device_refresh_tokens_token_hash").on(table.tokenHash),
    index("ix_device_refresh_tokens_device").on(table.deviceId),
  ],
);

/**
 * PHASE-022 · DR-P22-07a: the FCM skeleton's device-token opt-in store
 * (migration 0034_device_push_tokens.sql — the device_refresh_tokens
 * pattern: identity-owned, service-mediated, NO RLS by PHASE-003 §4; the
 * devices table has no natural JSON column for push tokens — capabilities
 * jsonb is the feed-scoping slice, trust_flags jsonb the admin plane).
 * One active row per device (uq device_id — the PUT upsert key); a token
 * never belongs to two devices (uq token). opted_in defaults FALSE —
 * tokens are per-device, opt-in explicit (integrations §3.5: tokens come
 * from the device registry, opt-in per device); locale is the device's
 * notification locale, resolved BEFORE the channel call; revocation
 * clears the rows (the devices kill switch).
 */
export const devicePushTokens = pgTable(
  "device_push_tokens",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform"),
    optedIn: boolean("opted_in").notNull().default(false),
    locale: text("locale").notNull().default("ar"),
  },
  (table) => [
    uniqueIndex("uq_device_push_tokens_device").on(table.deviceId),
    uniqueIndex("uq_device_push_tokens_token").on(table.token),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-017 · Industry Templates: Automotive & Distribution (migration
// 0025). Sales-owned job cards + commissions, partners-owned vehicles,
// distribution-owned tiers/free-goods/routes/visits/van mirror/settlements.
// ---------------------------------------------------------------------------

/** Per-partner vehicle registry (T5; partners-owned): make/model/VIN/plate/
 * odometer; linked from job cards and invoices (service history source). */
export const vehicles = pgTable(
  "vehicles",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    partnerId: uuid("partner_id").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    modelYear: integer("model_year"),
    chassisNo: text("chassis_no"),
    plateNo: text("plate_no"),
    color: text("color"),
    engineNo: text("engine_no"),
    odometerKm: numeric("odometer_km", { precision: 12, scale: 1 }),
    odometerAt: date("odometer_at"),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_vehicles_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_vehicles_tenant_chassis")
      .on(table.tenantId, table.chassisNo)
      .where(sql`${table.chassisNo} IS NOT NULL`),
    index("ix_vehicles_tenant_partner").on(table.tenantId, table.partnerId, table.status),
    index("ix_vehicles_tenant_plate")
      .on(table.tenantId, table.plateNo)
      .where(sql`${table.plateNo} IS NOT NULL`),
  ],
);

/** Workshop job cards (T3; sales-owned): DRAFT → IN_PROGRESS → COMPLETED →
 * INVOICED (+ CANCELLED, audited, no ledger). Parts issue policy `reserve`
 * (availability hold via stock_reservations) or `issue_immediate` (COGS
 * journal at issue, move references the card). */
export const jobCards = pgTable(
  "job_cards",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    cardNo: text("card_no"),
    customerId: uuid("customer_id").notNull(),
    vehicleId: uuid("vehicle_id"),
    status: text("status").notNull().default("DRAFT"),
    partsIssueMode: text("parts_issue_mode").notNull().default("reserve"),
    warehouseId: uuid("warehouse_id").notNull(),
    complaints: text("complaints"),
    complaintsAr: text("complaints_ar"),
    diagnosis: text("diagnosis"),
    diagnosisAr: text("diagnosis_ar"),
    odometerKm: numeric("odometer_km", { precision: 12, scale: 1 }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: "string" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    quotationId: uuid("quotation_id"),
    invoiceId: uuid("invoice_id"),
    creditNoteId: uuid("credit_note_id"),
    laborHoursTotal: numeric("labor_hours_total", { precision: 19, scale: 6 })
      .notNull()
      .default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_job_cards_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_job_cards_tenant_card_no")
      .on(table.tenantId, table.cardNo)
      .where(sql`${table.cardNo} IS NOT NULL`),
    index("ix_job_cards_tenant_status").on(table.tenantId, table.status, table.createdAt),
    index("ix_job_cards_tenant_vehicle").on(table.tenantId, table.vehicleId),
    index("ix_job_cards_tenant_customer").on(table.tenantId, table.customerId, table.status),
  ],
);

/** Job-card lines (T3): PARTS lines (stock items) and LABOR lines (service
 * items priced from labor-rate price lists; hours are billing data only —
 * no payroll module, actual technician cost is not tracked). */
export const jobCardLines = pgTable(
  "job_card_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    jobCardId: uuid("job_card_id").notNull(),
    lineNo: integer("line_no").notNull(),
    lineType: text("line_type").notNull(),
    itemId: uuid("item_id").notNull(),
    description: text("description"),
    descriptionAr: text("description_ar"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    estimatedHours: numeric("estimated_hours", { precision: 19, scale: 6 }),
    loggedHours: numeric("logged_hours", { precision: 19, scale: 6 }).notNull().default("0"),
    discountAmount: numeric("discount_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    status: text("status").notNull().default("PENDING"),
    reservationId: uuid("reservation_id"),
    issueUnitCost: numeric("issue_unit_cost", { precision: 19, scale: 6 }),
    issueValue: numeric("issue_value", { precision: 19, scale: 4 }),
    issueJournalId: uuid("issue_journal_id"),
    invoiceLineId: uuid("invoice_line_id"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_job_card_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_job_card_lines_card_line").on(table.tenantId, table.jobCardId, table.lineNo),
    index("ix_job_card_lines_reservation").on(table.tenantId, table.reservationId),
  ],
);

/** Customer price tiers (T11; distribution-owned): tier → price list +
 * discount cap + visit frequency; partners.customer_tier_id references it.
 * BR-003: customer's own list wins over the tier list; a tier never
 * overrides an explicitly quoted price. */
export const customerTiers = pgTable(
  "customer_tiers",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    priceListId: uuid("price_list_id"),
    discountCapPct: numeric("discount_cap_pct", { precision: 5, scale: 2 }),
    visitFrequencyDays: integer("visit_frequency_days"),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_customer_tiers_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_customer_tiers_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Free-goods promotion rules (T11; BR-008): buy-X-get-Y, optionally
 * tier-scoped and windowed; FOC lines are zero-price, reason-coded, and
 * still issue stock + post COGS. */
export const freeGoodsRules = pgTable(
  "free_goods_rules",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    ruleType: text("rule_type").notNull().default("BUY_X_GET_Y"),
    buyItemId: uuid("buy_item_id").notNull(),
    buyQty: numeric("buy_qty", { precision: 19, scale: 6 }).notNull(),
    getItemId: uuid("get_item_id").notNull(),
    getQty: numeric("get_qty", { precision: 19, scale: 6 }).notNull(),
    perMultiple: boolean("per_multiple").notNull().default(true),
    maxFreePerOrder: numeric("max_free_per_order", { precision: 19, scale: 6 }),
    tierId: uuid("tier_id"),
    reasonCode: text("reason_code").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_free_goods_rules_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_free_goods_rules_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Van-sales routes (T7; planning-only — drives no posting). */
export const routes = pgTable(
  "routes",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    salesRepId: uuid("sales_rep_id"),
    vanWarehouseId: uuid("van_warehouse_id"),
    dayPattern: jsonb("day_pattern").notNull().default(sql`'["MON","TUE","WED","THU","FRI"]'::jsonb`),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_routes_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_routes_tenant_code").on(table.tenantId, table.code),
  ],
);

/** Route customer composition (T7): ordered customer list per route. */
export const routeCustomers = pgTable(
  "route_customers",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    routeId: uuid("route_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    visitOrder: integer("visit_order").notNull().default(0),
    isPinned: boolean("is_pinned").notNull().default(false),
  },
  (table) => [
    uniqueIndex("uq_route_customers_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_route_customers_route_customer").on(
      table.tenantId,
      table.routeId,
      table.customerId,
    ),
  ],
);

/** Route visits (T7): planned vs actual per customer per date — PLANNED →
 * COMPLETED/SKIPPED/MISSED; actuals link the sales documents or explicit
 * check-ins. Planning data only (CAPABILITY_MATRIX §2.4). */
export const routeVisits = pgTable(
  "route_visits",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    routeId: uuid("route_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    plannedDate: date("planned_date").notNull(),
    status: text("status").notNull().default("PLANNED"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: "string" }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true, mode: "string" }),
    salesInvoiceId: uuid("sales_invoice_id"),
    creditNoteId: uuid("credit_note_id"),
    receiptId: uuid("receipt_id"),
    salesRepId: uuid("sales_rep_id"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_route_visits_id_tenant").on(table.id, table.tenantId),
    index("ix_route_visits_tenant_date").on(table.tenantId, table.plannedDate),
    index("ix_route_visits_tenant_route").on(table.tenantId, table.routeId, table.plannedDate),
    index("ix_route_visits_tenant_status").on(table.tenantId, table.status, table.plannedDate),
  ],
);

/** Van stock read-model mirror (T8; distribution-owned): stock_moves stays
 * the source of truth; this mirror is refreshed inside the owning
 * transaction and ties to the moves (reports assert the tie). */
export const vanStocks = pgTable(
  "van_stocks",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    warehouseId: uuid("warehouse_id").notNull(),
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull().default("0"),
    value: numeric("value", { precision: 19, scale: 4 }).notNull().default("0"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_van_stocks_id_tenant").on(table.id, table.tenantId),
    index("ix_van_stocks_tenant_warehouse").on(table.tenantId, table.warehouseId),
  ],
);

/** Rep settlements (T10): STL- documents; expected = opening + cash sales +
 * collections − cash refunds − approved rep expenses; variance ALWAYS posts
 * (BR-021 family, approval-gated, never netted); POSTED locks the rep's
 * day (corrections are new documents). */
export const repSettlements = pgTable(
  "rep_settlements",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    settlementNo: text("settlement_no"),
    salesRepId: uuid("sales_rep_id").notNull(),
    vanWarehouseId: uuid("van_warehouse_id"),
    shiftId: uuid("shift_id"),
    settlementDate: date("settlement_date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    openingCash: numeric("opening_cash", { precision: 19, scale: 4 }).notNull().default("0"),
    cashSales: numeric("cash_sales", { precision: 19, scale: 4 }).notNull().default("0"),
    collections: numeric("collections", { precision: 19, scale: 4 }).notNull().default("0"),
    cashRefunds: numeric("cash_refunds", { precision: 19, scale: 4 }).notNull().default("0"),
    repExpenses: numeric("rep_expenses", { precision: 19, scale: 4 }).notNull().default("0"),
    expectedCash: numeric("expected_cash", { precision: 19, scale: 4 }).notNull().default("0"),
    countedCash: numeric("counted_cash", { precision: 19, scale: 4 }),
    variance: numeric("variance", { precision: 19, scale: 4 }),
    varianceDirection: text("variance_direction"),
    varianceReason: text("variance_reason"),
    varianceJournalId: uuid("variance_journal_id"),
    depositAccountId: uuid("deposit_account_id"),
    depositAmount: numeric("deposit_amount", { precision: 19, scale: 4 }),
    depositJournalId: uuid("deposit_journal_id"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    cancelReason: text("cancel_reason"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_rep_settlements_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_rep_settlements_tenant_no")
      .on(table.tenantId, table.settlementNo)
      .where(sql`${table.settlementNo} IS NOT NULL`),
    uniqueIndex("uq_rep_settlements_rep_day")
      .on(table.tenantId, table.salesRepId, table.settlementDate)
      .where(sql`${table.status} <> 'CANCELLED'`),
    index("ix_rep_settlements_tenant_status").on(table.tenantId, table.status, table.settlementDate),
  ],
);

/** Settlement component lines (T10): the audited expected-cash breakdown
 * (opening, cash sale, collection, refund, expense, variance, deposit). */
export const repSettlementLines = pgTable(
  "rep_settlement_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    settlementId: uuid("settlement_id").notNull(),
    lineNo: integer("line_no").notNull(),
    component: text("component").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    description: text("description"),
    descriptionAr: text("description_ar"),
  },
  (table) => [
    uniqueIndex("uq_rep_settlement_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_rep_settlement_lines_settlement_line").on(
      table.tenantId,
      table.settlementId,
      table.lineNo,
    ),
  ],
);

/** Commission runs (T12): compute from posted, non-reversed sales in a
 * period; the accrual journal (DR COMMISSION_EXPENSE · CR
 * COMMISSION_ACCRUAL) posts exactly at run time — never per sale. */
export const commissionRuns = pgTable(
  "commission_runs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    basis: text("basis").notNull(),
    status: text("status").notNull().default("DRAFT"),
    totalBase: numeric("total_base", { precision: 19, scale: 4 }).notNull().default("0"),
    totalCommission: numeric("total_commission", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    journalEntryId: uuid("journal_entry_id"),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "string" }),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_commission_runs_id_tenant").on(table.id, table.tenantId),
    index("ix_commission_runs_tenant_period").on(table.tenantId, table.periodFrom, table.periodTo),
  ],
);

/** Per-rep commission run lines (T12): base, applied rate, amount, payout
 * state (payouts are ordinary treasury payments). */
export const commissionRunLines = pgTable(
  "commission_run_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    runId: uuid("run_id").notNull(),
    salesRepId: uuid("sales_rep_id").notNull(),
    baseAmount: numeric("base_amount", { precision: 19, scale: 4 }).notNull().default("0"),
    rateApplied: numeric("rate_applied", { precision: 7, scale: 4 }).notNull().default("0"),
    commissionAmount: numeric("commission_amount", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    detail: jsonb("detail"),
    payoutStatus: text("payout_status").notNull().default("ACCRUED"),
    paymentId: uuid("payment_id"),
  },
  (table) => [
    uniqueIndex("uq_commission_run_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_commission_run_lines_run_rep").on(
      table.tenantId,
      table.runId,
      table.salesRepId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-018 manufacturing cluster (migration 0026_manufacturing.sql):
// bills of materials + lines, production orders + lines, consumptions,
// scraps, inspections. Draft-lifecycle tables (SELECT/INSERT/UPDATE; POSTED
// immutability is service discipline + shape CHECKs) except bom_lines which
// carries DELETE (the DRAFT full-replace). Cost math per ADR-0009: qty/rate
// 19,6; money quanta 19,4; percentages 7,4.

/** Versioned recipe per item (manufacturing-owned): DRAFT → ACTIVE →
 * ARCHIVED with exactly one ACTIVE version per item (partial unique);
 * yield_pct is stored per version (80.0000 = 80%). */
export const billsOfMaterials = pgTable(
  "bills_of_materials",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    itemId: uuid("item_id").notNull(),
    versionNo: integer("version_no").notNull(),
    status: text("status").notNull().default("DRAFT"),
    outputUomId: uuid("output_uom_id").notNull(),
    yieldPct: numeric("yield_pct", { precision: 7, scale: 4 }).notNull().default("100.0000"),
    effectiveFrom: date("effective_from"),
    note: text("note"),
    noteAr: text("note_ar"),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_bills_of_materials_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_bills_of_materials_tenant_item_version").on(
      table.tenantId,
      table.itemId,
      table.versionNo,
    ),
    uniqueIndex("uq_bills_of_materials_active_item")
      .on(table.tenantId, table.itemId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index("ix_bills_of_materials_tenant_status").on(table.tenantId, table.status),
  ],
);

/** Component lines (DELETE granted for the DRAFT full-replace). */
export const bomLines = pgTable(
  "bom_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    bomId: uuid("bom_id").notNull(),
    lineNo: integer("line_no").notNull(),
    componentItemId: uuid("component_item_id").notNull(),
    uomId: uuid("uom_id").notNull(),
    qtyPerOutput: numeric("qty_per_output", { precision: 19, scale: 6 }).notNull(),
    scrapPct: numeric("scrap_pct", { precision: 7, scale: 4 }).notNull().default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_bom_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_bom_lines_bom_line").on(table.tenantId, table.bomId, table.lineNo),
    index("ix_bom_lines_tenant_component").on(table.tenantId, table.componentItemId),
  ],
);

/** Production orders (manufacturing-owned): DRAFT → RELEASED (number + BOM
 * bind + level-1 snapshot) → IN_PROGRESS → COMPLETED / CANCELLED; per-order
 * WIP nets to exactly zero at completion. */
export const productionOrders = pgTable(
  "production_orders",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    orderNo: text("order_no"),
    status: text("status").notNull().default("DRAFT"),
    bomId: uuid("bom_id"),
    itemId: uuid("item_id").notNull(),
    uomId: uuid("uom_id").notNull(),
    plannedQty: numeric("planned_qty", { precision: 19, scale: 6 }).notNull(),
    plannedDate: date("planned_date"),
    actualQty: numeric("actual_qty", { precision: 19, scale: 6 }).notNull().default("0"),
    materialsWarehouseId: uuid("materials_warehouse_id").notNull(),
    fgWarehouseId: uuid("fg_warehouse_id").notNull(),
    laborRate: numeric("labor_rate", { precision: 19, scale: 6 }).notNull().default("0"),
    overheadRate: numeric("overhead_rate", { precision: 19, scale: 6 }).notNull().default("0"),
    costCenterId: uuid("cost_center_id"),
    yieldSnapshot: numeric("yield_snapshot", { precision: 7, scale: 4 }),
    fgBatchId: uuid("fg_batch_id"),
    fgJournalId: uuid("fg_journal_id"),
    fgValue: numeric("fg_value", { precision: 19, scale: 4 }).notNull().default("0"),
    wipCreditValue: numeric("wip_credit_value", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    laborValue: numeric("labor_value", { precision: 19, scale: 4 }).notNull().default("0"),
    overheadValue: numeric("overhead_value", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    note: text("note"),
    noteAr: text("note_ar"),
    cancelReason: text("cancel_reason"),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "string" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_production_orders_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_production_orders_tenant_no")
      .on(table.tenantId, table.orderNo)
      .where(sql`${table.orderNo} IS NOT NULL`),
    index("ix_production_orders_tenant_status").on(table.tenantId, table.status),
    index("ix_production_orders_tenant_item").on(table.tenantId, table.itemId),
  ],
);

/** The frozen level-1 explosion snapshot bound at release; over_plan flags
 * the variance review once cumulative consumption crosses the threshold. */
export const productionOrderLines = pgTable(
  "production_order_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    orderId: uuid("order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    componentItemId: uuid("component_item_id").notNull(),
    uomId: uuid("uom_id").notNull(),
    plannedQty: numeric("planned_qty", { precision: 19, scale: 6 }).notNull(),
    scrapPct: numeric("scrap_pct", { precision: 7, scale: 4 }).notNull().default("0"),
    actualQty: numeric("actual_qty", { precision: 19, scale: 6 }).notNull().default("0"),
    overPlan: boolean("over_plan").notNull().default(false),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_production_order_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_production_order_lines_order_line").on(
      table.tenantId,
      table.orderId,
      table.lineNo,
    ),
    index("ix_production_order_lines_tenant_order_item").on(
      table.tenantId,
      table.orderId,
      table.componentItemId,
    ),
  ],
);

/** Batch-linked material issues — the genealogy upstream edges; one journal
 * per consume call (DR WIP · CR inventory at actual issue cost, per batch). */
export const productionConsumptions = pgTable(
  "production_consumptions",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    orderId: uuid("order_id").notNull(),
    itemId: uuid("item_id").notNull(),
    batchId: uuid("batch_id"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 19, scale: 6 }).notNull(),
    value: numeric("value", { precision: 19, scale: 4 }).notNull(),
    journalId: uuid("journal_id"),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }).notNull(),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_production_consumptions_id_tenant").on(table.id, table.tenantId),
    index("ix_production_consumptions_tenant_order").on(table.tenantId, table.orderId),
    index("ix_production_consumptions_tenant_item").on(table.tenantId, table.itemId),
    index("ix_production_consumptions_tenant_batch")
      .on(table.tenantId, table.batchId)
      .where(sql`${table.batchId} IS NOT NULL`),
  ],
);

/** Reason-coded pre-completion WIP scrap (DR PRODUCTION_SCRAP · CR WIP; no
 * stock move — stock left at consumption; ≤ running WIP is enforced by the
 * service). */
export const productionScraps = pgTable(
  "production_scraps",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    orderId: uuid("order_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    value: numeric("value", { precision: 19, scale: 4 }).notNull(),
    journalId: uuid("journal_id"),
    scrappedAt: timestamp("scrapped_at", { withTimezone: true, mode: "string" }).notNull(),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_production_scraps_id_tenant").on(table.id, table.tenantId),
    index("ix_production_scraps_tenant_order").on(table.tenantId, table.orderId),
  ],
);

/** QC inspections: pass/fail (+ sampled/sample_size) with dispositions
 * (required on FAIL); production-order or goods-receipt targets. */
export const inspections = pgTable(
  "inspections",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    targetType: text("target_type").notNull(),
    orderId: uuid("order_id"),
    grnId: uuid("grn_id"),
    fgBatchId: uuid("fg_batch_id"),
    result: text("result").notNull(),
    sampled: boolean("sampled").notNull().default(false),
    sampleSize: integer("sample_size"),
    disposition: text("disposition"),
    inspectedAt: timestamp("inspected_at", { withTimezone: true, mode: "string" }).notNull(),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_inspections_id_tenant").on(table.id, table.tenantId),
    index("ix_inspections_tenant_order")
      .on(table.tenantId, table.orderId)
      .where(sql`${table.orderId} IS NOT NULL`),
    index("ix_inspections_tenant_grn")
      .on(table.tenantId, table.grnId)
      .where(sql`${table.grnId} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-019 · CRM, Service Contracts & Projects (migration 0027_crm_projects.sql):
// the crm cluster (leads, tasks, activities, contracts + billing schedule +
// invoices guard + advances, service orders + lines, time entries). Cost math
// per ADR-0009: hours/rates 19,6; money quanta 19,4. All draft/status-
// lifecycled (SELECT/INSERT/UPDATE — no DELETE grants; tombstone + status
// flips carry the lifecycle).

/** Leads: the intake pipeline (NEW → QUALIFIED → CONVERTED/LOST); the
 * converted lead links partner_id forever (provenance — no numbering series,
 * no ledger effect). */
export const leads = pgTable(
  "leads",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    phone: text("phone"),
    email: text("email"),
    company: text("company"),
    source: text("source").notNull().default("OTHER"),
    status: text("status").notNull().default("NEW"),
    lostReason: text("lost_reason"),
    ownerUserId: uuid("owner_user_id"),
    partnerId: uuid("partner_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true, mode: "string" }),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_leads_id_tenant").on(table.id, table.tenantId),
    index("ix_leads_tenant_status").on(table.tenantId, table.status),
    index("ix_leads_tenant_owner").on(table.tenantId, table.ownerUserId),
  ],
);

/** CRM tasks: future work (OPEN/DONE/CANCELLED) + the reminder sweep
 * substrate (remind_at/notified_at). */
export const crmTasks = pgTable(
  "crm_tasks",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    title: text("title").notNull(),
    relatedType: text("related_type").notNull(),
    relatedId: uuid("related_id").notNull(),
    assigneeUserId: uuid("assignee_user_id"),
    dueDate: date("due_date"),
    remindAt: timestamp("remind_at", { withTimezone: true, mode: "string" }),
    notifiedAt: timestamp("notified_at", { withTimezone: true, mode: "string" }),
    status: text("status").notNull().default("OPEN"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_crm_tasks_id_tenant").on(table.id, table.tenantId),
    index("ix_crm_tasks_tenant_status_due").on(table.tenantId, table.status, table.dueDate),
    index("ix_crm_tasks_tenant_related").on(table.tenantId, table.relatedType, table.relatedId),
    index("ix_crm_tasks_pending_reminders")
      .on(table.tenantId, table.remindAt)
      .where(sql`${table.remindAt} IS NOT NULL AND ${table.notifiedAt} IS NULL`),
  ],
);

/** CRM activities: logged past interactions (the timeline per
 * lead/partner/contract, ordered by occurred_at). */
export const crmActivities = pgTable(
  "crm_activities",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    kind: text("kind").notNull(),
    relatedType: text("related_type").notNull(),
    relatedId: uuid("related_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    summary: text("summary").notNull(),
    durationMinutes: integer("duration_minutes"),
    actorUserId: uuid("actor_user_id"),
  },
  (table) => [
    uniqueIndex("uq_crm_activities_id_tenant").on(table.id, table.tenantId),
    index("ix_crm_activities_tenant_related").on(
      table.tenantId,
      table.relatedType,
      table.relatedId,
    ),
  ],
);

/** Service contracts: the CT- document (posts nothing itself). NO
 * contract-level fee_item_id — the schedule rows are the fee-item home
 * (§18 lesson 1). */
export const serviceContracts = pgTable(
  "service_contracts",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    contractNo: text("contract_no"),
    partnerId: uuid("partner_id").notNull(),
    projectId: uuid("project_id"),
    title: text("title").notNull(),
    titleAr: text("title_ar"),
    scope: text("scope"),
    feeModel: text("fee_model").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    monthlyAmount: numeric("monthly_amount", { precision: 19, scale: 4 }),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    status: text("status").notNull().default("DRAFT"),
    renewedToContractId: uuid("renewed_to_contract_id"),
    cancelReason: text("cancel_reason"),
    note: text("note"),
    noteAr: text("note_ar"),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_service_contracts_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_service_contracts_tenant_no")
      .on(table.tenantId, table.contractNo)
      .where(sql`${table.contractNo} IS NOT NULL`),
    index("ix_service_contracts_tenant_status").on(table.tenantId, table.status),
    index("ix_service_contracts_tenant_partner").on(table.tenantId, table.partnerId),
  ],
);

/** Contract billing schedule: the expanded grid (re-runnable, additive) —
 * RETAINER_PERIOD / MILESTONE / HOURLY_PERIOD rows; the fee-item home. */
export const contractBillingSchedule = pgTable(
  "contract_billing_schedule",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    contractId: uuid("contract_id").notNull(),
    entryType: text("entry_type").notNull(),
    periodKey: text("period_key"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    billDate: date("bill_date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }),
    feeItemId: uuid("fee_item_id").notNull(),
    milestoneLabel: text("milestone_label"),
    milestoneLabelAr: text("milestone_label_ar"),
    status: text("status").notNull().default("PLANNED"),
    invoiceId: uuid("invoice_id"),
  },
  (table) => [
    uniqueIndex("uq_contract_billing_schedule_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_contract_billing_schedule_tenant_entry_period")
      .on(table.tenantId, table.contractId, table.entryType, table.periodKey)
      .where(sql`${table.periodKey} IS NOT NULL`),
    uniqueIndex("uq_contract_billing_schedule_tenant_milestone")
      .on(table.tenantId, table.contractId, table.milestoneLabel)
      .where(sql`${table.entryType} = 'MILESTONE'`),
    index("ix_contract_billing_schedule_tenant_bill").on(
      table.tenantId,
      table.contractId,
      table.billDate,
    ),
  ],
);

/** Contract invoices: the idempotency guard — the two partial uniques make
 * concurrent double-fire a constraint violation ⇒ graceful skip. */
export const contractInvoices = pgTable(
  "contract_invoices",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    contractId: uuid("contract_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    periodKey: text("period_key"),
    milestoneScheduleId: uuid("milestone_schedule_id"),
    status: text("status").notNull().default("GENERATED"),
  },
  (table) => [
    uniqueIndex("uq_contract_invoices_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_contract_invoices_tenant_period")
      .on(table.tenantId, table.contractId, table.periodKey)
      .where(sql`${table.periodKey} IS NOT NULL`),
    uniqueIndex("uq_contract_invoices_tenant_milestone")
      .on(table.tenantId, table.contractId, table.milestoneScheduleId)
      .where(sql`${table.milestoneScheduleId} IS NOT NULL`),
    index("ix_contract_invoices_tenant_contract").on(table.tenantId, table.contractId),
    index("ix_contract_invoices_tenant_invoice").on(table.tenantId, table.invoiceId),
  ],
);

/** Contract advances: on-account receipts tagged to a contract (HELD →
 * RELEASED at the releasing invoice's post; the journal anchors are plain
 * uuids — the production fg_journal_id precedent). */
export const contractAdvances = pgTable(
  "contract_advances",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    contractId: uuid("contract_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    status: text("status").notNull().default("HELD"),
    deferJournalId: uuid("defer_journal_id"),
    releasedJournalId: uuid("released_journal_id"),
    releasedInvoiceId: uuid("released_invoice_id"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_contract_advances_id_tenant").on(table.id, table.tenantId),
    index("ix_contract_advances_tenant_contract_status").on(
      table.tenantId,
      table.contractId,
      table.status,
    ),
  ],
);

/** Service orders: the job-card generalization (SO- numbering reserved at
 * creation; contract linkage does NOT alter any journal). */
export const serviceOrders = pgTable(
  "service_orders",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    branchId: uuid("branch_id").notNull(),
    orderNo: text("order_no"),
    partnerId: uuid("partner_id").notNull(),
    contractId: uuid("contract_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    note: text("note"),
    noteAr: text("note_ar"),
    cancelReason: text("cancel_reason"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_service_orders_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_service_orders_tenant_no")
      .on(table.tenantId, table.orderNo)
      .where(sql`${table.orderNo} IS NOT NULL`),
    index("ix_service_orders_tenant_status").on(table.tenantId, table.status),
    index("ix_service_orders_tenant_partner").on(table.tenantId, table.partnerId),
  ],
);

/** Service-order lines: tombstone-based (no DELETE grant) — the
 * job_card_lines shape (PENDING/RESERVED/ISSUED/INVOICED/VOID). */
export const serviceOrderLines = pgTable(
  "service_order_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    orderId: uuid("order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    lineType: text("line_type").notNull(),
    itemId: uuid("item_id").notNull(),
    description: text("description"),
    descriptionAr: text("description_ar"),
    estimatedHours: numeric("estimated_hours", { precision: 19, scale: 6 }),
    unitPrice: numeric("unit_price", { precision: 19, scale: 6 }).notNull().default("0"),
    qty: numeric("qty", { precision: 19, scale: 6 }).notNull(),
    loggedHours: numeric("logged_hours", { precision: 19, scale: 6 }).notNull().default("0"),
    status: text("status").notNull().default("PENDING"),
    reservationId: uuid("reservation_id"),
    issueUnitCost: numeric("issue_unit_cost", { precision: 19, scale: 6 }),
    issueValue: numeric("issue_value", { precision: 19, scale: 4 }),
    issueJournalId: uuid("issue_journal_id"),
    invoiceLineId: uuid("invoice_line_id"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_service_order_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_service_order_lines_order_line").on(
      table.tenantId,
      table.orderId,
      table.lineNo,
    ),
    index("ix_service_order_lines_tenant_reservation")
      .on(table.tenantId, table.reservationId)
      .where(sql`${table.reservationId} IS NOT NULL`),
  ],
);

/** CRM time entries: timeslips (rates snapshotted at recording — never
 * recomputed; billable feeds billing ONLY, no payroll). */
export const crmTimeEntries = pgTable(
  "crm_time_entries",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    entryDate: date("entry_date").notNull(),
    hours: numeric("hours", { precision: 19, scale: 6 }).notNull(),
    feeItemId: uuid("fee_item_id").notNull(),
    projectId: uuid("project_id"),
    contractId: uuid("contract_id"),
    feeEarnerUserId: uuid("fee_earner_user_id"),
    unitRate: numeric("unit_rate", { precision: 19, scale: 6 }).notNull(),
    narrative: text("narrative"),
    billable: boolean("billable").notNull().default(true),
    status: text("status").notNull().default("DRAFT"),
    billedInvoiceId: uuid("billed_invoice_id"),
  },
  (table) => [
    uniqueIndex("uq_crm_time_entries_id_tenant").on(table.id, table.tenantId),
    index("ix_crm_time_entries_tenant_project_date").on(
      table.tenantId,
      table.projectId,
      table.entryDate,
    ),
    index("ix_crm_time_entries_tenant_status").on(table.tenantId, table.status),
    index("ix_crm_time_entries_pullable")
      .on(table.tenantId, table.entryDate)
      .where(sql`${table.billedInvoiceId} IS NULL AND ${table.status} = 'APPROVED'`),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-024 · Security Hardening cluster (migration 0036_security_hardening.sql;
// DATA_PROTECTION §4 + Journey H). The offboarding flow state is tenant-owned
// (dies with the tenant in the purge it tracks); the deletion-certificate
// registry is platform-owned and SURVIVES the purge it certifies.
// ---------------------------------------------------------------------------

/** Offboarding flow state (Journey H1–H5; tenant-owned, macro RLS). */
export const tenantOffboarding = pgTable(
  "tenant_offboarding",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    requestedBy: uuid("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    graceUntil: timestamp("grace_until", { withTimezone: true, mode: "string" }),
    // No FK: the export artifact is a file_objects row of the SAME tenant —
    // it dies in the purge; purged_tenants keeps the checksum snapshot.
    exportFileId: uuid("export_file_id"),
    manifestChecksum: text("manifest_checksum"),
    exportedAt: timestamp("exported_at", { withTimezone: true, mode: "string" }),
    executedBy: uuid("executed_by"),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "string" }),
    retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "string" }),
    purgedAt: timestamp("purged_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_tenant_offboarding_live")
      .on(table.tenantId)
      .where(sql`${table.status} <> 'CANCELLED'`),
    index("ix_tenant_offboarding_retention").on(table.status, table.retentionUntil),
  ],
);

/**
 * Deletion certificates (Journey H5 "what/when/by-whom retained in platform
 * audit"; platform-owned — the plans pattern). hashed_tenant_id is the only
 * post-purge correlation handle: the tenant's audit rows are anonymized to
 * tenant_id NULL by the purge (DATA_PROTECTION §4 step 8).
 */
export const purgedTenants = pgTable(
  "purged_tenants",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tenantIdAtPurge: uuid("tenant_id_at_purge").notNull(),
    hashedTenantId: text("hashed_tenant_id").notNull(),
    tenantNameSnapshot: text("tenant_name_snapshot").notNull(),
    manifestChecksum: text("manifest_checksum"),
    exportFileId: uuid("export_file_id"),
    performedBy: uuid("performed_by").notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    tableRowCounts: jsonb("table_row_counts").notNull().default({}),
    storageObjectsDeleted: integer("storage_objects_deleted").notNull().default(0),
    auditRowsAnonymized: integer("audit_rows_anonymized").notNull().default(0),
    verification: jsonb("verification").notNull().default({}),
  },
  (table) => [
    uniqueIndex("uq_purged_tenants_tenant").on(table.tenantIdAtPurge),
    uniqueIndex("uq_purged_tenants_hash").on(table.hashedTenantId),
  ],
);

// ---------------------------------------------------------------------------
// fixed_assets (PHASE-026 — migration 0037; DR-002 option A). Six tenant-
// owned tables, all RLS'd; depreciation_lines is append-only 🔒 (INV-003
// pattern: SELECT/INSERT grants + the erp.depreciation_lines_guard trigger;
// the offboarding purge path admits DELETE only under erp.purge_mode).
// ---------------------------------------------------------------------------

/** Asset categories (T2): tenant-scoped code, bilingual names, life/method
 * defaults, and the three purpose links (BR-041: unusable until all three
 * resolve to active accounts — the category service checks at create/
 * update, first asset use, and every posting, fail-closed). */
export const assetCategories = pgTable(
  "asset_categories",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    usefulLifeMonthsDefault: integer("useful_life_months_default").notNull(),
    depreciationMethodDefault: text("depreciation_method_default")
      .notNull()
      .default("STRAIGHT_LINE"),
    assetPurposeKey: text("asset_purpose_key").notNull().default("FIXED_ASSET"),
    accumDepreciationPurposeKey: text("accum_depreciation_purpose_key")
      .notNull()
      .default("ACCUM_DEPRECIATION"),
    expensePurposeKey: text("expense_purpose_key").notNull().default("DEPRECIATION_EXPENSE"),
    active: boolean("active").notNull().default(true),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_asset_categories_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_asset_categories_tenant_code").on(table.tenantId, table.code),
    index("ix_asset_categories_tenant_active").on(table.tenantId, table.active),
  ],
);

/** The asset register (T3): code (tenant-scoped natural key), category,
 * acquisition date/cost, salvage floor, life/method, branch/custodian,
 * status machine (asset_status §9). opening_accumulated is the opening-
 * variant accumulated-to-date (G-21 opening leg). NBV = cost −
 * opening_accumulated − Σ posted lines ≥ salvage (INV-023). */
export const assets = pgTable(
  "assets",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    categoryId: uuid("category_id").notNull(),
    acquisitionDate: date("acquisition_date").notNull(),
    cost: numeric("cost", { precision: 19, scale: 4 }).notNull(),
    salvageValue: numeric("salvage_value", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    openingAccumulated: numeric("opening_accumulated", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    usefulLifeMonths: integer("useful_life_months").notNull(),
    depreciationMethod: text("depreciation_method").notNull().default("STRAIGHT_LINE"),
    totalEstimatedUnits: numeric("total_estimated_units", { precision: 19, scale: 6 }),
    branchId: uuid("branch_id").notNull(),
    custodianUserId: uuid("custodian_user_id"),
    status: text("status").notNull().default("ACTIVE"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    note: text("note"),
    noteAr: text("note_ar"),
    disposedAt: timestamp("disposed_at", { withTimezone: true, mode: "string" }),
    writtenOffAt: timestamp("written_off_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_assets_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_assets_tenant_code").on(table.tenantId, table.code),
    index("ix_assets_tenant_cat_status_branch").on(
      table.tenantId,
      table.categoryId,
      table.status,
      table.branchId,
    ),
    index("ix_assets_tenant_custodian").on(table.tenantId, table.custodianUserId),
    index("ix_assets_tenant_source").on(table.tenantId, table.sourceType, table.sourceId),
  ],
);

/** Monthly depreciation batches (T6/T7): ONE per (tenant, fiscal period)
 * (BR-042; the UNIQUE is the dedupe — second assembly same period → 409).
 * DRAFT assembly (bounded pg-boss job, ADR-0008) → explicit POST (G-22).
 * Reversal is engine-only (INV-014): counter-entry + reversed_at; the
 * append-only lines stay for audit. */
export const depreciationRuns = pgTable(
  "depreciation_runs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    fiscalPeriodId: uuid("fiscal_period_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    assetCount: integer("asset_count").notNull().default(0),
    totalAmount: numeric("total_amount", { precision: 19, scale: 4 })
      .notNull()
      .default("0"),
    assemblyJobId: text("assembly_job_id"),
    assembledAt: timestamp("assembled_at", { withTimezone: true, mode: "string" }),
    assembledBy: uuid("assembled_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    journalEntryId: uuid("journal_entry_id"),
    reversalJournalEntryId: uuid("reversal_journal_entry_id"),
    reversedAt: timestamp("reversed_at", { withTimezone: true, mode: "string" }),
    reversalReason: text("reversal_reason"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_depreciation_runs_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_depreciation_runs_tenant_period").on(
      table.tenantId,
      table.fiscalPeriodId,
    ),
    index("ix_depreciation_runs_tenant_status").on(table.tenantId, table.status),
  ],
);

/** Append-only 🔒 per-asset run lines (T6 — INV-003 pattern): one line per
 * (run, asset); period_units is the manual UoP usage; accumulated_amount
 * is the asset accumulated AFTER the line (the NBV floor proof chain). */
export const depreciationLines = pgTable(
  "depreciation_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    runId: uuid("run_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    lineNo: integer("line_no").notNull(),
    periodUnits: numeric("period_units", { precision: 19, scale: 6 }),
    periodAmount: numeric("period_amount", { precision: 19, scale: 4 }).notNull(),
    accumulatedAmount: numeric("accumulated_amount", { precision: 19, scale: 4 }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_depreciation_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_depreciation_lines_run_asset").on(table.runId, table.assetId),
    index("ix_depreciation_lines_tenant_asset").on(table.tenantId, table.assetId),
  ],
);

/** SALE/SCRAP disposal documents (T9): official disposal_no (numbering
 * service, INV-021), frozen NBV/accumulated snapshots, gain_loss = proceeds
 * − NBV (G-23 with the MANDATORY loss mirror). The §4 SoD approval
 * (second user) is service-enforced + audited; posting locks the asset. */
export const assetDisposals = pgTable(
  "asset_disposals",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    assetId: uuid("asset_id").notNull(),
    disposalNo: text("disposal_no"),
    kind: text("kind").notNull(),
    disposalDate: date("disposal_date").notNull(),
    proceeds: numeric("proceeds", { precision: 19, scale: 4 }).notNull().default("0"),
    netBookValue: numeric("net_book_value", { precision: 19, scale: 4 }).notNull(),
    accumulatedSnapshot: numeric("accumulated_snapshot", { precision: 19, scale: 4 }).notNull(),
    gainLoss: numeric("gain_loss", { precision: 19, scale: 4 }).notNull(),
    status: text("status").notNull().default("DRAFT"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    journalEntryId: uuid("journal_entry_id"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_asset_disposals_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_asset_disposals_tenant_no")
      .on(table.tenantId, table.disposalNo)
      .where(sql`${table.disposalNo} IS NOT NULL`),
    index("ix_asset_disposals_tenant_asset").on(table.tenantId, table.assetId),
    index("ix_asset_disposals_tenant_status_date").on(
      table.tenantId,
      table.status,
      table.disposalDate,
    ),
  ],
);

/** Audited revaluations (T8 — BR-044): the NBV delta posts to
 * REVALUATION_RESERVE (never P&L), both directions golden-tested; reason
 * mandatory; subsequent runs compute on the revalued basis. */
export const assetRevaluations = pgTable(
  "asset_revaluations",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    assetId: uuid("asset_id").notNull(),
    revaluationDate: date("revaluation_date").notNull(),
    newGrossValue: numeric("new_gross_value", { precision: 19, scale: 4 }).notNull(),
    newAccumulated: numeric("new_accumulated", { precision: 19, scale: 4 }).notNull(),
    delta: numeric("delta", { precision: 19, scale: 4 }).notNull(),
    status: text("status").notNull().default("DRAFT"),
    reason: text("reason").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    journalEntryId: uuid("journal_entry_id"),
  },
  (table) => [
    uniqueIndex("uq_asset_revaluations_id_tenant").on(table.id, table.tenantId),
    index("ix_asset_revaluations_tenant_asset").on(table.tenantId, table.assetId),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-027 (migration 0038) — notes & installments (DR-003/ED-03): the
// notes register with custody states + the append-only 🔒 custody log, and
// installment plans + lines. The v1.1 treasury.cheques deferral chain
// terminates here (cheques are delivered by the notes module).
// ---------------------------------------------------------------------------

/** Notes register (T2 — BR-045): kind/direction/partner + REQUIRED maturity
 * date; the instrument's own number as data (ADR-0006); stored rate INV-008;
 * custody states note_status §9; source = origin invoice/supplier invoice
 * (service-validated own-tenant); cash_account_id is the treasury account
 * for the money legs (stored at DEPOSIT); journal_entry_id = the G-24/G-27
 * entry. */
export const notes = pgTable(
  "notes",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    kind: text("kind").notNull(),
    direction: text("direction").notNull(),
    partnerId: uuid("partner_id").notNull(),
    number: text("number"),
    issuingBank: text("issuing_bank"),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 19, scale: 6 }).notNull(),
    issueDate: date("issue_date"),
    maturityDate: date("maturity_date").notNull(),
    status: text("status").notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    cashAccountId: uuid("cash_account_id"),
    journalEntryId: uuid("journal_entry_id"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_notes_id_tenant").on(table.id, table.tenantId),
    index("ix_notes_tenant_status_maturity").on(table.tenantId, table.status, table.maturityDate),
    index("ix_notes_tenant_direction_status").on(table.tenantId, table.direction, table.status),
    index("ix_notes_tenant_partner").on(table.tenantId, table.partnerId),
    index("ix_notes_tenant_source").on(table.tenantId, table.sourceType, table.sourceId),
  ],
);

/** Append-only 🔒 custody log (T2 — INV-003 pattern, the INV-024 audit
 * substrate): ENDORSE/DEPOSIT/RECLASSIFY carry NO journal (BR-047 — the
 * shape CHECK enforces it); money events carry their entry id. UPDATE
 * never; DELETE only under erp.purge_mode (guard trigger). */
export const noteEvents = pgTable(
  "note_events",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    noteId: uuid("note_id").notNull(),
    eventKind: text("event_kind").notNull(),
    eventDate: date("event_date").notNull(),
    refs: jsonb("refs"),
    journalEntryId: uuid("journal_entry_id"),
    memo: text("memo"),
    memoAr: text("memo_ar"),
  },
  (table) => [
    uniqueIndex("uq_note_events_id_tenant").on(table.id, table.tenantId),
    index("ix_note_events_tenant_note").on(table.tenantId, table.noteId, table.eventDate),
  ],
);

/** Installment plans (T8 — BR-048): a collection overlay over a credit
 * invoice/service contract (the AR open item remains the invoice). status
 * NULL = draft (the §9 enum lists the activated states); activation is the
 * BR-048 gate (plan total = source total) and the schedule is immutable
 * after. late_fee_policy jsonb per plan (PLACEHOLDER defaults, OQ-002
 * family) — flat fees only (DR-003: no interest, no compounding). */
export const installmentPlans = pgTable(
  "installment_plans",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    partnerId: uuid("partner_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceNo: text("source_no"),
    totalAmount: numeric("total_amount", { precision: 19, scale: 4 }).notNull(),
    downPayment: numeric("down_payment", { precision: 19, scale: 4 }).notNull(),
    lineCount: integer("line_count").notNull(),
    startDate: date("start_date").notNull(),
    frequency: text("frequency").notNull(),
    lateFeePolicy: jsonb("late_fee_policy").notNull(),
    status: text("status"),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
    activatedBy: uuid("activated_by"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    defaultedAt: timestamp("defaulted_at", { withTimezone: true, mode: "string" }),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_installment_plans_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_installment_plans_tenant_source").on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
    ),
    index("ix_installment_plans_tenant_partner").on(table.tenantId, table.partnerId, table.status),
  ],
);

/** Plan lines (T9/T10): seq/due_date/amount immutable after activation;
 * status job-derived only (the daily sweep — no manual path exists) except
 * WAIVED (sole manual transition, permission + reason + audit). receipt_refs
 * jsonb accumulates attributed receipt slices; late_fee_* = the G-28 charge
 * (once per line, INV-013). */
export const installmentLines = pgTable(
  "installment_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    planId: uuid("plan_id").notNull(),
    seq: integer("seq").notNull(),
    dueDate: date("due_date").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    status: text("status").notNull(),
    receiptRefs: jsonb("receipt_refs").notNull(),
    collectedAmount: numeric("collected_amount", { precision: 19, scale: 4 }).notNull(),
    waivedAt: timestamp("waived_at", { withTimezone: true, mode: "string" }),
    waivedBy: uuid("waived_by"),
    waiveReason: text("waive_reason"),
    lateFeeAmount: numeric("late_fee_amount", { precision: 19, scale: 4 }),
    lateFeeEntryId: uuid("late_fee_entry_id"),
    lateFeeChargedAt: timestamp("late_fee_charged_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("uq_installment_lines_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_installment_lines_plan_seq").on(table.planId, table.seq),
    index("ix_installment_lines_tenant_plan_due").on(table.tenantId, table.planId, table.dueDate),
    index("ix_installment_lines_tenant_status_due").on(table.tenantId, table.status, table.dueDate),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-034 (migration 0041) — multi-entity consolidation (ADR-0018 / DR-006
// option A / ED-10, stage 11 — the final roadmap phase): groups as
// CONFIGURATION in the owner tenant's plane (a legal entity = a tenant,
// unchanged); eliminations as DRAFT→POSTED documents whose POST runs through
// the posting engine into the PARENT tenant's consolidation books (source
// CONSOLIDATION_ELIMINATION, G-32); runs as read-only aggregations over
// member books through the ONE audited platform-plane reader
// (erp.consolidation_read_member_gl — SECURITY DEFINER, SELECT-only grant
// scope, BR-056 re-verified in-function); snapshots as immutable versioned
// derived artifacts (ADR-0017 — never a second ledger). Zero cross-tenant
// writes at the grant level (INV-026).
// ---------------------------------------------------------------------------

/** Consolidation groups (T4): owner-plane configuration — bilingual names,
 * the GROUP reporting currency, the OQ-V2-2-decided FX method (DR-P34-FX-1
 * amending DR-006 §4: CLOSING_RATE default, TEMPORARY bounded), status. */
export const consolidationGroups = pgTable(
  "consolidation_groups",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    baseCurrency: varchar("base_currency", { length: 3 }).notNull(),
    fxTranslationMethod: text("fx_translation_method").notNull().default("CLOSING_RATE"),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_consolidation_groups_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_consolidation_groups_tenant_name").on(table.tenantId, table.name),
    index("ix_consolidation_groups_tenant_status").on(table.tenantId, table.status),
  ],
);

/** Group membership (T4): the configuration edge ADR-0018 sanctions —
 * member_tenant_id deliberately NOT composite (the member is another tenant
 * BY DESIGN; every read through it is audited). ownership_percent is
 * disclosure/minority-interest presentation only (DR-006); include_from
 * bounds the member's consolidated periods (NULL = from inception). */
export const groupEntities = pgTable(
  "group_entities",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    groupId: uuid("group_id").notNull(),
    memberTenantId: uuid("member_tenant_id").notNull(),
    ownershipPercent: numeric("ownership_percent", { precision: 7, scale: 4 }).notNull().default("100"),
    includeFrom: date("include_from"),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_group_entities_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_group_entities_group_member").on(table.groupId, table.memberTenantId),
    index("ix_group_entities_tenant_group").on(table.tenantId, table.groupId, table.status),
    index("ix_group_entities_member").on(table.memberTenantId, table.status),
  ],
);

/** Elimination documents (T5): DRAFT over member-pair lines (jsonb manual
 * authoring — the auto-matcher is out of scope) → POST via
 * PostingEngine.post (source CONSOLIDATION_ELIMINATION, G-32 intercompany
 * shape; investment/equity lines through CONSOLIDATION_ADJUSTMENT) into the
 * PARENT's consolidation books ONLY. Posted = immutable (INV-003);
 * reversal-only counter-entries (BR-056) as new DRAFT→POSTED pairs. */
export const eliminationEntries = pgTable(
  "elimination_entries",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    groupId: uuid("group_id").notNull(),
    fiscalPeriodId: uuid("fiscal_period_id").notNull(),
    eliminationNo: text("elimination_no"),
    kind: text("kind").notNull().default("INTERCOMPANY"),
    description: text("description").notNull(),
    memberATenantId: uuid("member_a_tenant_id"),
    memberBTenantId: uuid("member_b_tenant_id"),
    lines: jsonb("lines").notNull().default([]),
    status: text("status").notNull().default("DRAFT"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    journalEntryIds: jsonb("journal_entry_ids").notNull().default([]),
    reversalOf: uuid("reversal_of"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_elimination_entries_id_tenant").on(table.id, table.tenantId),
    index("ix_elimination_entries_tenant_group_period").on(
      table.tenantId,
      table.groupId,
      table.fiscalPeriodId,
    ),
    index("ix_elimination_entries_tenant_status").on(table.tenantId, table.status),
    index("ix_elimination_entries_reversal_of").on(table.tenantId, table.reversalOf),
  ],
);

/** Consolidation runs (T6): QUEUED→RUNNING→COMPLETED/FAILED (the §9
 * consolidation_run_status enum) as bounded pg-boss jobs. snapshot = the
 * immutable versioned derived artifact (member extracts at dated stored
 * rates INV-008 + the frozen elimination set); re-run = NEW row; FAILED
 * leaves no partial snapshot. The DB guard trigger (migration 0041 §5)
 * makes COMPLETED snapshots rewrite-proof. */
export const consolidationRuns = pgTable(
  "consolidation_runs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    groupId: uuid("group_id").notNull(),
    fiscalPeriodId: uuid("fiscal_period_id").notNull(),
    status: text("status").notNull().default("QUEUED"),
    snapshotVersion: integer("snapshot_version").notNull().default(1),
    snapshot: jsonb("snapshot"),
    jobId: text("job_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    errorCode: text("error_code"),
    errorDetail: jsonb("error_detail"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("uq_consolidation_runs_id_tenant").on(table.id, table.tenantId),
    index("ix_consolidation_runs_tenant_group_period").on(
      table.tenantId,
      table.groupId,
      table.fiscalPeriodId,
    ),
    index("ix_consolidation_runs_tenant_status").on(table.tenantId, table.status),
  ],
);

// ────────────────────────────────────────────────────────────────────────
// RESTORED LINEAGE (phases 028–029, merged post-034 from the pre-reset
// archive): the budgeting + payroll tables below keep their definitions
// byte-faithful to migration 0042_budgeting / 0043_payroll (renumbered
// from 0039/0040 at restoration — see the restoration report).
// ────────────────────────────────────────────────────────────────────────

// PHASE-028 (migration 0039) — budgeting (DR-004/ED-04): versioned budgets
// by fiscal year & scope with period-level amounts over account/cost-center/
// project/branch dimensions. Budgets are NOT ledger documents — zero journal
// rules, zero goldens, structurally ledger-incapable (the module reads the
// GL for variance, never writes it; ADR-0007/INV-022).
// ---------------------------------------------------------------------------

/** Budget versions (T2 — BR-050): the version register — scope budget_scope
 * §9 (ACCOUNTS/COST_CENTERS/PROJECTS/BRANCHES); revision_no counts the
 * supersede chain (1 = original; the standard optimistic-lock "version"
 * integer owns that column name); supersedes_id links a revision to its
 * predecessor (same-(year,scope), service-validated); code is the
 * tenant-scoped natural key BUD-<year>-<seq> (DATA_DICTIONARY §12 — no
 * official numbers: planning data, not a document, ADR-0006). Lifecycle
 * stamps with the shape CHECKs: approved_at is one-directional (approve()
 * stamps it while status is still PENDING_APPROVAL — pre- and
 * post-approval both live there); activated_at is bidirectional on
 * ACTIVE/REVISED/CLOSED (the machine only ever sets REVISED/CLOSED from an
 * ACTIVE row); closed_at on CLOSED. The BR-050 partial unique
 * (one ACTIVE per tenant/year/scope) lives in the SQL — see
 * uq_budgets_one_active. */
export const budgets = pgTable(
  "budgets",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    fiscalYearId: uuid("fiscal_year_id").notNull(),
    scope: text("scope").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    revisionNo: integer("revision_no").notNull(),
    status: text("status").notNull(),
    supersedesId: uuid("supersedes_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }),
    activatedBy: uuid("activated_by"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_budgets_id_tenant").on(table.id, table.tenantId),
    index("ix_budgets_tenant_year_scope_status").on(
      table.tenantId,
      table.fiscalYearId,
      table.scope,
      table.status,
    ),
    index("ix_budgets_tenant_supersedes").on(table.tenantId, table.supersedesId),
  ],
);

/** Budget lines (T3): the period grid — one row per (dimension key × fiscal
 * period), amount 19,4 (ADR-0009) non-negative. account_id REQUIRED;
 * cost_center/project/branch optional per scope (scope is a filter, not a
 * fork). The period must belong to the parent budget's fiscal year
 * (service-validated, BUDGET_PERIOD_MISMATCH). Mutable only while the
 * parent is DRAFT (409 IMMUTABLE_DOCUMENT on non-DRAFT replace) —
 * REVISED/CLOSED versions freeze rows at the version level. */
export const budgetLines = pgTable(
  "budget_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    budgetId: uuid("budget_id").notNull(),
    fiscalPeriodId: uuid("fiscal_period_id").notNull(),
    accountId: uuid("account_id").notNull(),
    costCenterId: uuid("cost_center_id"),
    projectId: uuid("project_id"),
    branchId: uuid("branch_id"),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_budget_lines_id_tenant").on(table.id, table.tenantId),
    index("ix_budget_lines_tenant_period_account").on(
      table.tenantId,
      table.fiscalPeriodId,
      table.accountId,
    ),
    index("ix_budget_lines_tenant_budget").on(table.tenantId, table.budgetId),
    index("ix_budget_lines_tenant_dimensions").on(
      table.tenantId,
      table.costCenterId,
      table.projectId,
      table.branchId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// PHASE-029 (migration 0040) — payroll (salaries, loans & end-of-service;
// DR-005/ED-05 financial scope): the PII-restricted employee financial
// file, versioned salary structures + per-component GL accounts, monthly
// runs posting exactly one G-29 journal through the engine (BR-053),
// frozen per-employee component snapshots 🔒 append-only run lines
// (INV-003/INV-025), and employee loans with the BR-054-capped schedule.
// ---------------------------------------------------------------------------

/** Salary structure versions (T3 — BR-052): ACTIVE/ARCHIVED with the
 * superseded_by chain — mid-period changes create a NEW version, used
 * structures are never edited in place (the run's component_snapshot is
 * the frozen truth). Every component carries its own gl_account_id +
 * the is_eos_base flag (BR-055 accrual basis). */
export const salaryStructures = pgTable(
  "salary_structures",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: text("status").notNull(),
    supersededById: uuid("superseded_by_id"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_salary_structures_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_salary_structures_tenant_code").on(table.tenantId, table.code),
    index("ix_salary_structures_tenant_status").on(table.tenantId, table.status),
  ],
);

/** Salary components (T3): the per-structure list — kind ALLOWANCE/
 * DEDUCTION/EMPLOYER_CONTRIBUTION, calc FIXED/PERCENT_OF_BASIC/
 * PERCENT_OF_GROSS (one driver per the SQL calc shape CHECK; rate 7,4),
 * per-component gl_account_id (expense-side CoA mapping) + is_eos_base.
 * Editable only while the parent structure is unused (BR-052). */
export const salaryComponents = pgTable(
  "salary_components",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    structureId: uuid("structure_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    kind: text("kind").notNull(),
    calc: text("calc").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }),
    rate: numeric("rate", { precision: 7, scale: 4 }),
    glAccountId: uuid("gl_account_id").notNull(),
    isEosBase: boolean("is_eos_base").notNull().default(false),
    seq: integer("seq").notNull().default(1),
  },
  (table) => [
    uniqueIndex("uq_salary_components_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_salary_components_structure_key").on(
      table.tenantId,
      table.structureId,
      table.key,
    ),
    index("ix_salary_components_tenant_structure").on(table.tenantId, table.structureId),
  ],
);

/** Employees (T2): the PII-restricted employee financial file. national_id
 * + bank fields are C-PII (DATA_PROTECTION §1): masked in API responses,
 * audit-on-read, never in logs, never in non-payroll exports. Status
 * ACTIVE/SUSPENDED/TERMINATED (termination_date ⇔ TERMINATED); the
 * salary_structure/branch/cost_center/project ids are the run-calculation
 * dimensions. Status-lifecycled — no delete (TERMINATED rows are the
 * EOS/audit history). */
export const employees = pgTable(
  "employees",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    nationalId: text("national_id"),
    hireDate: date("hire_date").notNull(),
    terminationDate: date("termination_date"),
    terminationReason: text("termination_reason"),
    contractType: text("contract_type").notNull(),
    basicSalary: numeric("basic_salary", { precision: 19, scale: 4 }).notNull(),
    salaryStructureId: uuid("salary_structure_id"),
    branchId: uuid("branch_id"),
    costCenterId: uuid("cost_center_id"),
    projectId: uuid("project_id"),
    bankName: text("bank_name"),
    bankIban: text("bank_iban"),
    bankAccount: text("bank_account"),
    eosSettledAmount: numeric("eos_settled_amount", { precision: 19, scale: 4 }),
    eosSettlementJournalEntryId: uuid("eos_settlement_journal_entry_id"),
    eosSettledAt: timestamp("eos_settled_at", { withTimezone: true, mode: "string" }),
    status: text("status").notNull().default("ACTIVE"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_employees_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_employees_tenant_code").on(table.tenantId, table.code),
    index("ix_employees_tenant_status").on(table.tenantId, table.status),
    index("ix_employees_tenant_structure").on(table.tenantId, table.salaryStructureId),
  ],
);

/** Payroll runs (T4): the monthly register — DRAFT → PENDING_APPROVAL →
 * POSTED (SoD approval; the approved stamp lands while STILL
 * PENDING_APPROVAL). INV-025 is a row-level CHECK (net = gross −
 * deductions exactly); run_no is the official PR-{YYYY}-{SEQ:6} number
 * (INV-021); journal_entry_id ⇔ POSTED; reversal-only corrections
 * (reversal_journal_entry_id — POSTED stays POSTED, INV-003). One live
 * (non-DRAFT) run per period — the partial unique in the SQL. */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    runNo: text("run_no"),
    fiscalPeriodId: uuid("fiscal_period_id").notNull(),
    status: text("status").notNull(),
    grossTotal: numeric("gross_total", { precision: 19, scale: 4 }).notNull(),
    deductionsTotal: numeric("deductions_total", { precision: 19, scale: 4 }).notNull(),
    netTotal: numeric("net_total", { precision: 19, scale: 4 }).notNull(),
    paidNetTotal: numeric("paid_net_total", { precision: 19, scale: 4 }).notNull(),
    employerContributionsTotal: numeric("employer_contributions_total", {
      precision: 19,
      scale: 4,
    }).notNull(),
    eosAccrualTotal: numeric("eos_accrual_total", { precision: 19, scale: 4 }).notNull(),
    journalEntryId: uuid("journal_entry_id"),
    entryNo: text("entry_no"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    postedBy: uuid("posted_by"),
    reversalJournalEntryId: uuid("reversal_journal_entry_id"),
    reversedAt: timestamp("reversed_at", { withTimezone: true, mode: "string" }),
    reversedBy: uuid("reversed_by"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_payroll_runs_id_tenant").on(table.id, table.tenantId),
    index("ix_payroll_runs_tenant_period_status").on(
      table.tenantId,
      table.fiscalPeriodId,
      table.status,
    ),
  ],
);

/** Payroll run lines 🔒 (T4): per-employee frozen pay lines — append-only
 * (INV-003; UPDATE grant-denied, DELETE policy-owned by the
 * erp.payroll_run_lines_guard trigger: DRAFT recalc resets + purge only).
 * component_snapshot jsonb freezes the calculation basis (BR-052); the
 * totals carry the INV-025 row-level law; dimensions stamp the G-29
 * expense lines. */
export const payrollRunLines = pgTable(
  "payroll_run_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    runId: uuid("run_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    componentSnapshot: jsonb("component_snapshot").notNull(),
    grossAmount: numeric("gross_amount", { precision: 19, scale: 4 }).notNull(),
    deductionsAmount: numeric("deductions_amount", { precision: 19, scale: 4 }).notNull(),
    netAmount: numeric("net_amount", { precision: 19, scale: 4 }).notNull(),
    employerContributions: numeric("employer_contributions", {
      precision: 19,
      scale: 4,
    }).notNull(),
    eosAccrual: numeric("eos_accrual", { precision: 19, scale: 4 }).notNull(),
    costCenterId: uuid("cost_center_id"),
    projectId: uuid("project_id"),
    branchId: uuid("branch_id"),
  },
  (table) => [
    uniqueIndex("uq_payroll_run_lines_id_tenant").on(table.id, table.tenantId),
    index("ix_payroll_run_lines_tenant_run").on(table.tenantId, table.runId),
    index("ix_payroll_run_lines_tenant_employee").on(table.tenantId, table.employeeId),
  ],
);

/** Employee loans (T8): disbursement posts DR <tenant-mapped loan control
 * account> · CR CASH (source employee_loan/disburse — the control account
 * via the payroll.loans.control_account_id policy key, NOT a canonical
 * purpose) + the treasury cash movement (INV-019). Status ACTIVE/CLOSED/
 * WRITE_OFF (write-off requires reason + audit); BR-054 caps the per-
 * period deduction at payroll.loans.max_deduction_percent of net. */
export const employeeLoans = pgTable(
  "employee_loans",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    code: text("code").notNull(),
    employeeId: uuid("employee_id").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    installmentsCount: integer("installments_count").notNull(),
    startPeriodId: uuid("start_period_id").notNull(),
    status: text("status").notNull(),
    cashAccountId: uuid("cash_account_id"),
    disbursementJournalEntryId: uuid("disbursement_journal_entry_id"),
    disbursedAt: timestamp("disbursed_at", { withTimezone: true, mode: "string" }),
    disbursedBy: uuid("disbursed_by"),
    writeOffReason: text("write_off_reason"),
    writeOffAt: timestamp("write_off_at", { withTimezone: true, mode: "string" }),
    writeOffBy: uuid("write_off_by"),
    note: text("note"),
    noteAr: text("note_ar"),
  },
  (table) => [
    uniqueIndex("uq_employee_loans_id_tenant").on(table.id, table.tenantId),
    uniqueIndex("uq_employee_loans_tenant_code").on(table.tenantId, table.code),
    index("ix_employee_loans_tenant_employee_status").on(
      table.tenantId,
      table.employeeId,
      table.status,
    ),
  ],
);

/** Employee loan lines (T8): the per-period deduction schedule — immutable
 * after disbursement; PENDING → DEDUCTED (stamps the deducting run) /
 * WAIVED (reason required, sticky). */
export const employeeLoanLines = pgTable(
  "employee_loan_lines",
  {
    ...standardColumns,
    tenantId: uuid("tenant_id").notNull(),
    createdBy: uuid("created_by"),
    loanId: uuid("loan_id").notNull(),
    fiscalPeriodId: uuid("fiscal_period_id").notNull(),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    status: text("status").notNull(),
    payrollRunId: uuid("payroll_run_id"),
    waivedReason: text("waived_reason"),
    waivedAt: timestamp("waived_at", { withTimezone: true, mode: "string" }),
    waivedBy: uuid("waived_by"),
  },
  (table) => [
    uniqueIndex("uq_employee_loan_lines_id_tenant").on(table.id, table.tenantId),
    index("ix_employee_loan_lines_tenant_period_status").on(
      table.tenantId,
      table.fiscalPeriodId,
      table.status,
    ),
    index("ix_employee_loan_lines_tenant_loan").on(table.tenantId, table.loanId),
  ],
);
