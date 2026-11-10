import { SetMetadata } from "@nestjs/common";

/**
 * PHASE-014 usage-limit route marker (PHASE-014 §4; SUBSCRIPTION §6): the
 * creation actions the §6 matrix hard-blocks at the plan ceiling — invite
 * user, create branch, create warehouse (terminal/device activation lands
 * with their phases). The UsageLimitGuard reads the marker and resolves
 * the tenant's billing snapshot (pre-GUC definer projection) — a limit at
 * or above the ceiling fails with the typed `tenancy/limit-exceeded`
 * error naming the limit, usage, and the resolving action. Documents/month
 * is NEVER guarded (INV-022: no limit behavior may block posting).
 */

export const REQUIRE_LIMIT_KEY = "erp:require-limit";

export type GuardableLimit = "users" | "branches" | "warehouses";

export const RequireLimit = (limit: GuardableLimit) => SetMetadata(REQUIRE_LIMIT_KEY, limit);
