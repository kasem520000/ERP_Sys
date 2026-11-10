import type { EffectiveConfig, RequestOverlay, TenantStaticConfig } from "../../domain/layer-model";

/**
 * Tenant-static + request-overlay caches (CONFIGURATION_ENGINE §3 step 6,
 * §9 invalidation events).
 *
 * - The tenant-static merge (layers + policies + ui) is cached per tenant
 *   keyed by an INPUT FINGERPRINT (a cheap hash of the layer input
 *   versions: template hash, settings max(updated_at), entitlement count,
 *   plan key, branch max(updated_at), flags hash, approval-policy count).
 *   On every read the stored fingerprint is compared against the freshly
 *   recomputed one — a mismatch forces re-resolution, so a slow invalidation
 *   can never serve stale-but-wrong data (§9: "the cache key includes the
 *   content hash").
 * - The request overlay (L6) is cached per USER and never shared across
 *   principals; `role.updated` / `membership.updated` drop it (§9 last two
 *   rows) while the tenant-static cache stays untouched.
 */

interface CachedTenantStatic {
  readonly fingerprint: string;
  readonly config: TenantStaticConfig;
}

const tenantStaticCache = new Map<string, CachedTenantStatic>();

/**
 * Cache hit ONLY when the stored entry's input fingerprint matches the
 * freshly recomputed one (§9 hash-mismatch ⇒ re-resolve).
 */
export function cachedTenantStatic(
  tenantId: string,
  expectedFingerprint: string,
): TenantStaticConfig | undefined {
  const cached = tenantStaticCache.get(tenantId);
  if (cached === undefined || cached.fingerprint !== expectedFingerprint) {
    return undefined;
  }
  return cached.config;
}

export function storeTenantStatic(
  tenantId: string,
  fingerprint: string,
  config: TenantStaticConfig,
): void {
  tenantStaticCache.set(tenantId, { fingerprint, config });
}

/** Drop a tenant's cached static config (an invalidating event fired). */
export function invalidateTenantStaticConfig(tenantId: string): void {
  tenantStaticCache.delete(tenantId);
}

// ---------------------------------------------------------------------------
// Request overlay (L6) — per-user, never across principals
// ---------------------------------------------------------------------------

interface CachedOverlay {
  readonly tenantId: string;
  readonly staticHash: string;
  readonly overlay: RequestOverlay;
}

const requestOverlayCache = new Map<string, CachedOverlay>();
/** tenantId → cached overlay users (the role.updated sweep index). */
const overlayTenantIndex = new Map<string, Set<string>>();

/**
 * Cached overlay for `userId`, valid only for the same tenant AND the same
 * tenant-static hash (a template/plan/settings change underneath forces a
 * recompute even without an L6 event).
 */
export function cachedRequestOverlay(
  userId: string,
  tenantId: string,
  staticHash: string,
): RequestOverlay | undefined {
  const cached = requestOverlayCache.get(userId);
  if (cached === undefined || cached.tenantId !== tenantId || cached.staticHash !== staticHash) {
    return undefined;
  }
  return cached.overlay;
}

export function storeRequestOverlay(
  userId: string,
  tenantId: string,
  staticHash: string,
  overlay: RequestOverlay,
): void {
  requestOverlayCache.set(userId, { tenantId, staticHash, overlay });
  const users = overlayTenantIndex.get(tenantId) ?? new Set<string>();
  users.add(userId);
  overlayTenantIndex.set(tenantId, users);
}

/**
 * Drop a user's request overlay (L6 events: role.updated /
 * membership.updated — §9 "request overlay only, never the cached
 * tenant-static").
 */
export function dropRequestOverlay(userId: string): void {
  const cached = requestOverlayCache.get(userId);
  if (cached !== undefined) {
    const users = overlayTenantIndex.get(cached.tenantId);
    if (users !== undefined) {
      users.delete(userId);
      if (users.size === 0) {
        overlayTenantIndex.delete(cached.tenantId);
      }
    }
  }
  requestOverlayCache.delete(userId);
}

/**
 * Drop every overlay entry of a tenant — a role-wide change affects ALL
 * users holding the role, not just the editor's target.
 */
export function dropRequestOverlaysForTenant(tenantId: string): void {
  const users = overlayTenantIndex.get(tenantId);
  if (users === undefined) {
    return;
  }
  for (const userId of [...users]) {
    requestOverlayCache.delete(userId);
  }
  overlayTenantIndex.delete(tenantId);
}

/** Test hook: drop both caches (also wired into resetConfigurationCache). */
export function resetResolveCaches(): void {
  tenantStaticCache.clear();
  requestOverlayCache.clear();
  overlayTenantIndex.clear();
}

/** Test hook: cache sizes (asserting invalidation in specs). */
export function resolveCacheSizes(): { tenantStatic: number; requestOverlays: number } {
  return { tenantStatic: tenantStaticCache.size, requestOverlays: requestOverlayCache.size };
}

/** Type re-export for consumers of the cache API. */
export type { EffectiveConfig };
