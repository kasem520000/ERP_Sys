import { SetMetadata } from "@nestjs/common";

/**
 * Feature-entitlement enforcement marker (PHASE-004 §2.5/T7; BR-039 —
 * "enforced at module load and per action"): feature-gated module
 * routes declare the catalog feature key they belong to. The
 * FeatureEntitlementsGuard resolves the tenant's materialized
 * entitlements server-side (pre-GUC definer projection, cached per
 * request) and rejects with the typed `feature_not_entitled` error —
 * UI visibility is derived-only and never a control.
 */
export const REQUIRE_FEATURE_KEY = "tenancy:requireFeature";

export function RequireFeature(featureKey: string): MethodDecorator {
  return SetMetadata(REQUIRE_FEATURE_KEY, featureKey) as MethodDecorator;
}
