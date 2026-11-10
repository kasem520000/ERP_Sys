/**
 * Feature-key registry seed (ADR-0002 rule 1: contracts own feature keys).
 * v0 is intentionally EMPTY: entitlement feature keys arrive with the
 * subscription/onboarding phases (PHASE-014) and are append-only.
 */
export const FEATURE_KEYS = {} as const;

export type FeatureKey = keyof typeof FEATURE_KEYS;
