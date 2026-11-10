import { EventEmitter } from "node:events";

import {
  dropRequestOverlay,
  dropRequestOverlaysForTenant,
  invalidateTenantStaticConfig,
  resetResolveCaches,
} from "./resolve/cache";

/**
 * In-process domain events (PHASE-004 §4 module dependencies;
 * MODULE_BOUNDARIES.md; CONFIGURATION_ENGINE §9 cache-invalidation table):
 * `tenant.updated`, `tenant.suspended`, `settings.changed`,
 * `entitlements.changed`, `plan.changed`, `branch.updated` — emitted by
 * the tenancy module, consumed by configuration (config-cache
 * invalidation) and identity (suspension semantics fan-out; ADR-0008 —
 * the in-process bus is the PHASE-004 substrate, pg-boss carries the
 * job-driven variants with the later device/sync phases).
 *
 * PHASE-015 extends the §9 table with the engine's own lifecycle events
 * (`template.applied` / `template.switched`, `pack.upgraded`,
 * `module.installed` / `module.deactivated`, `policy.changed` — tenant-
 * static invalidation) and the L6 events (`role.updated`,
 * `membership.updated` — request-overlay invalidation ONLY; the
 * tenant-static cache is untouched by them, §9 last two rows).
 *
 * The bus is deliberately tiny: typed publish/subscribe with no
 * persistence — consumers act inside the emitting request's envelope;
 * anything that must survive a crash belongs to a queue, not here.
 */

export type TenancyEvent =
  | { readonly type: "tenant.updated"; readonly tenantId: string }
  | { readonly type: "tenant.suspended"; readonly tenantId: string; readonly reason: string }
  | { readonly type: "tenant.restored"; readonly tenantId: string; readonly reason: string }
  | { readonly type: "settings.changed"; readonly tenantId: string; readonly key: string }
  | {
      readonly type: "entitlements.changed";
      readonly tenantId: string;
      readonly featureKey: string;
      readonly change: "granted" | "revoked";
    }
  | { readonly type: "plan.changed"; readonly tenantId: string; readonly planKey: string }
  | { readonly type: "branch.updated"; readonly tenantId: string; readonly branchId: string };

/**
 * PHASE-015 §9 lifecycle events. Emitters: configuration itself
 * (template.applied/switched at apply/switch time; module.installed/
 * deactivated at add-on install/deactivate), tax (pack.upgraded at staged
 * pack apply), the policy editors' owning modules (policy.changed), and
 * identity (role.updated / membership.updated). The engine subscribes to
 * all of them below — an emitter publishing an event gets the documented
 * invalidation for free, and a MISSED event cannot serve stale-but-wrong
 * data anyway because the tenant-static cache re-verifies its input
 * fingerprint on every read (§9 "a hash mismatch forces re-resolution").
 */
export type ConfigurationLifecycleEvent =
  | {
      readonly type: "template.applied";
      readonly tenantId: string;
      readonly templateKey: string;
      readonly version: string;
    }
  | {
      readonly type: "template.switched";
      readonly tenantId: string;
      readonly fromTemplateKey: string;
      readonly toTemplateKey: string;
    }
  | {
      readonly type: "pack.upgraded";
      readonly tenantId: string;
      readonly countryCode: string;
      readonly fromVersion: string;
      readonly toVersion: string;
    }
  | {
      readonly type: "module.installed";
      readonly tenantId: string;
      readonly module: string;
    }
  | {
      readonly type: "module.deactivated";
      readonly tenantId: string;
      readonly module: string;
    }
  | {
      readonly type: "policy.changed";
      readonly tenantId: string;
      /** Policy scope tag: an approvals docType, "numbering", a settings key… */
      readonly scope: string;
    }
  | {
      readonly type: "role.updated";
      readonly tenantId: string;
      readonly roleId: string;
      /** The affected user when known (the overlay cache is keyed by user). */
      readonly userId?: string;
    }
  | {
      readonly type: "membership.updated";
      readonly tenantId: string;
      readonly userId: string;
    };

const BUS = new EventEmitter();
BUS.setMaxListeners(50); // per-process consumers; leak-safe for the phase scope

/** Publish a tenancy event to every in-process consumer. */
export function publishTenancyEvent(event: TenancyEvent): void {
  BUS.emit(event.type, event);
}

/** Subscribe (returns the unsubscribe handle). Test/audit surface. */
export function onTenancyEvent(
  type: TenancyEvent["type"],
  listener: (event: TenancyEvent) => void,
): () => void {
  BUS.on(type, listener);
  return () => {
    BUS.off(type, listener);
  };
}

/** Publish a configuration lifecycle event (§9 PHASE-015 rows). */
export function publishConfigurationEvent(event: ConfigurationLifecycleEvent): void {
  BUS.emit(event.type, event);
}

/** Subscribe to a lifecycle event (returns the unsubscribe handle). */
export function onConfigurationEvent(
  type: ConfigurationLifecycleEvent["type"],
  listener: (event: ConfigurationLifecycleEvent) => void,
): () => void {
  BUS.on(type, listener as (event: TenancyEvent | ConfigurationLifecycleEvent) => void);
  return () => {
    BUS.off(type, listener as (event: TenancyEvent | ConfigurationLifecycleEvent) => void);
  };
}

/**
 * Configuration cache (CONFIGURATION_ENGINE §9 "resolution" + cache
 * invalidation): tenant-static L5 snapshot keyed by tenant id, dropped
 * on every invalidating event. The full L1→L10 merge engine is PHASE-015;
 * PHASE-004 caches exactly the settings snapshot its services resolve.
 */
interface CachedSettings {
  entries: Readonly<Record<string, unknown>>;
  loadedAt: number;
}

const settingsCache = new Map<string, CachedSettings>();

export function cachedTenantSettings(
  tenantId: string,
): Readonly<Record<string, unknown>> | undefined {
  const cached = settingsCache.get(tenantId);
  if (cached === undefined) {
    return undefined;
  }
  return cached.entries;
}

export function storeTenantSettingsCache(
  tenantId: string,
  entries: Readonly<Record<string, unknown>>,
): void {
  settingsCache.set(tenantId, { entries, loadedAt: Date.now() });
}

export function invalidateTenantConfig(tenantId: string): void {
  settingsCache.delete(tenantId);
}

// Wire the §9 invalidation rules: tenant-level events drop the whole
// snapshot; settings.changed drops it too (targeted dependents — e.g.
// numbering displays — re-resolve lazily through the same cache miss).
for (const type of [
  "tenant.updated",
  "tenant.suspended",
  "tenant.restored",
  "settings.changed",
  "entitlements.changed",
  "plan.changed",
  "branch.updated",
] as const) {
  BUS.on(type, (event: TenancyEvent) => {
    invalidateTenantConfig(event.tenantId);
  });
}

// PHASE-015 §9: the same tenancy events ALSO drop the tenant-static
// effective-config cache — every one of them feeds a tenant-static layer
// (tenant profile; L5; L3+L4; L3; L7), and the fingerprint re-check only
// guards against a MISSED event, not a substitute for correct wiring.
for (const type of [
  "tenant.updated",
  "tenant.suspended",
  "tenant.restored",
  "settings.changed",
  "entitlements.changed",
  "plan.changed",
  "branch.updated",
] as const) {
  BUS.on(type, (event: TenancyEvent) => {
    invalidateTenantStaticConfig(event.tenantId);
  });
}

// PHASE-015 §9 new rows — tenant-static invalidation (L1/L2/L8/L10 + the
// L9 values derived from them). None of these is a full-invalidate row, so
// the L5 settings snapshot cache stays (a template apply only adds
// defaults for UNSET keys — stored settings rows never change, BR-038).
for (const type of [
  "template.applied",
  "template.switched",
  "pack.upgraded",
  "module.installed",
  "module.deactivated",
  "policy.changed",
] as const) {
  BUS.on(type, (event: ConfigurationLifecycleEvent) => {
    invalidateTenantStaticConfig(event.tenantId);
  });
}

// PHASE-015 §9 L6 rows — request overlay ONLY (never the cached
// tenant-static). membership.updated names the user; role.updated is a
// ROLE-wide change (every holder of the role is affected), so it sweeps
// all of the tenant's cached overlays.
BUS.on("role.updated", (event: ConfigurationLifecycleEvent) => {
  if (event.type === "role.updated") {
    dropRequestOverlaysForTenant(event.tenantId);
  }
});
BUS.on("membership.updated", (event: ConfigurationLifecycleEvent) => {
  if (event.type === "membership.updated") {
    dropRequestOverlay(event.userId);
  }
});

/** Test hook: drop everything (between specs). */
export function resetConfigurationCache(): void {
  settingsCache.clear();
  resetResolveCaches();
}
