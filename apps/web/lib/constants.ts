/**
 * P4-T12a — PHASE-004 web constants (tenant provisioning + platform admin).
 *
 * These mirror frozen API-side facts (apps/api is the source of truth; the
 * values below are duplicated here on purpose so the web app never imports
 * API internals — DEPENDENCY_RULES.md §3):
 */

/**
 * Fixed platform-operations tenant id (seeded by apps/api migration 0006;
 * apps/api/src/modules/tenancy/application/lifecycle-service.ts
 * `PLATFORM_TENANT_ID`). A session whose ACTIVE tenant is this id belongs to
 * platform staff — the app shell reveals the platform nav section then.
 */
export const PLATFORM_TENANT_ID = "20000000-0000-4000-8000-000000000001";

/** Feature key gating the onboarding provision route (API `RequireFeature`). */
export const ONBOARDING_FEATURE_KEY = "platform.onboarding";

/** Common IANA zones offered as datalist suggestions on the settings screen. */
export const TIMEZONE_SUGGESTIONS: readonly string[] = [
  "Asia/Riyadh",
  "Asia/Dubai",
  "Africa/Cairo",
  "Asia/Aden",
  "Asia/Amman",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Asia/Baghdad",
  "UTC",
];

/** Seeded subscription plan keys (platform manual plan assignment). */
export const PLAN_KEYS = ["starter", "business", "enterprise"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Entitlement grant sources (SUBSCRIPTION_AND_ENTITLEMENTS §9). */
export const ENTITLEMENT_SOURCES = ["MANUAL", "PROMO", "TRIAL"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/**
 * Enumerated support-session read resources — mirrors the API whitelist
 * (apps/api SUPPORT_READ_RESOURCES, authorization-matrix §7 rule 4).
 */
export const SUPPORT_READ_RESOURCES = [
  "users",
  "memberships",
  "roles",
  "branches",
  "settings",
  "entitlements",
  "subscription",
  "accounts",
  "audit-events",
] as const;
export type SupportReadResource = (typeof SUPPORT_READ_RESOURCES)[number];
