import {
  Inject,
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { identityOf } from "../context/session-context";
import { isPlatformScoped, PLATFORM_SCOPE_KEY } from "./platform-scope.decorator";
import { REQUIRE_LIMIT_KEY, type GuardableLimit } from "./require-limit.decorator";
import { LimitExceededError } from "../../modules/tenancy/domain/subscription-errors";
import { RESOLVING_ACTIONS, limitOf } from "../../modules/tenancy/application/billing/billing-config";
import * as store from "../../modules/tenancy/infrastructure/billing.store";
import type { SessionContext } from "../context/session-context";

/**
 * PHASE-014 usage-limit guard (PHASE-014 §4; SUBSCRIPTION §5/§6 — the
 * "Limit counters" enforcement point): server-side check of the route's
 * §6 hard-block limit against the tenant's live billing snapshot. Runs
 * with the permission + feature guards (pre-UoW); the snapshot resolves
 * through the migration-0021 definer projection and is cached on the
 * request's identity context — one round trip per request, never per
 * query. Platform-scoped routes and anonymous/self surfaces skip it
 * (limits are a tenant-plane concept).
 *
 * Resolving actions are bilingual and name the exact escape (upgrade or
 * free a slot). The documents/month limit has NO guard route by design —
 * INV-022: no limit behavior may block posting or touch posted data.
 */

const RESOLVERS: Record<GuardableLimit, { ar: string; en: string }> = {
  users: RESOLVING_ACTIONS.limitUsers,
  branches: RESOLVING_ACTIONS.limitBranches,
  warehouses: RESOLVING_ACTIONS.limitWarehouses,
};

const USAGE_KEYS: Record<GuardableLimit, "users" | "branches" | "warehouses"> = {
  users: "users",
  branches: "branches",
  warehouses: "warehouses",
};

interface IdentityWithCache extends SessionContext {
  billingSnapshotCached?: store.BillingSnapshot;
}

@Injectable()
export class UsageLimitGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = this.reflector.get<GuardableLimit | undefined>(
      REQUIRE_LIMIT_KEY,
      context.getHandler(),
    );
    if (limit === undefined) {
      return true;
    }
    const platformRoute = isPlatformScoped(
      this.reflector.get<boolean | undefined>(PLATFORM_SCOPE_KEY, context.getHandler()),
      this.reflector.get<boolean | undefined>(PLATFORM_SCOPE_KEY, context.getClass()),
    );
    if (platformRoute) {
      return true; // platform plane is permission-gated, not limit-gated
    }
    const request = context.switchToHttp().getRequest<Request>();
    const identity = identityOf(request);
    if (identity === undefined || identity.activeTenantId === null) {
      return true; // anonymous/self surfaces — permission guard owns those
    }
    const cached = identity as IdentityWithCache;
    const snapshot =
      cached.billingSnapshotCached ??
      (cached.billingSnapshotCached = await store.billingSnapshot(identity.activeTenantId));
    if (snapshot.plan === null) {
      return true; // no subscription row → no enforceable ceiling (fail-open)
    }
    const limitValue = limitOf(snapshot.plan.limits, limit);
    if (limitValue === "unlimited") {
      return true;
    }
    const usage = snapshot.usage[USAGE_KEYS[limit]];
    if (usage < limitValue) {
      return true;
    }
    throw new LimitExceededError({
      limit,
      limitValue,
      usage,
      resolvingAction: RESOLVERS[limit],
    });
  }
}
