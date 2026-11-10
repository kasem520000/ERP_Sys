import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { hashToken } from "../../modules/identity/domain/tokens";
import * as store from "../../modules/identity/infrastructure/identity.store";
import {
  TENANT_LIMITER,
  type RateLimiter,
  type RateLimitDecision,
} from "../../modules/identity/infrastructure/rate-limiter";
import { isPublicRoute } from "../auth/route-permissions";
import { getCorrelationId } from "../observability/request-context";

/**
 * PHASE-024 T5 — R-04 per-tenant API burst limiter (SECURITY_TEST_PLAN §5):
 * authenticated `/api/v1/` traffic draws from ONE sliding-window budget
 * keyed by the session's active tenant — saturation 429s that tenant ONLY
 * (isolation by keyed construction) with Retry-After + X-RateLimit-* quota
 * headers; every other tenant's budget is untouched.
 *
 * Scope decisions (deliberate):
 * - Public routes are skipped via the route-permissions registry — anonymous
 *   traffic never carries a tenant budget (login/reset limiters own it).
 * - Device-token traffic (Authorization: Bearer, PHASE-020) is out of scope:
 *   it presents no `x-session-token`; the sync plane carries its own
 *   throttle (`SyncRateLimitedError`).
 * - The tenant is resolved by this middleware's OWN indexed lookup
 *   (token-hash → active_tenant_id), NOT from the session context: the
 *   limiter must stay decoupled from where SessionMiddleware happens to run
 *   in the chain (order-independent), and revoked sessions must not draw a
 *   tenant budget. That lookup is ONE indexed query per request — the
 *   accepted cost of keying the budget server-side (R-06 spirit: still
 *   cheap; no tenant-scoped work happens before the decision).
 */

/** Test seam: the two things this middleware touches beyond req/res. */
export interface TenantRateLimitDeps {
  readonly limiter: RateLimiter;
  readonly findSessionTenant: typeof store.findSessionTenantByTokenHash;
}

export function tenantRateLimitDeps(): TenantRateLimitDeps {
  return { limiter: TENANT_LIMITER, findSessionTenant: store.findSessionTenantByTokenHash };
}

/**
 * The enforcement step, split from the Nest class so the plain unit suite
 * can drive it with a fake limiter/store and a manual clock.
 */
export async function enforceTenantRateLimit(
  request: Request,
  response: Response,
  next: NextFunction,
  deps: TenantRateLimitDeps,
): Promise<void> {
  // Nest's per-route middleware mounting resets request.path to "/" — the
  // original full path survives only on originalUrl (query stripped).
  const path = (request.originalUrl ?? request.path).split("?")[0] ?? request.path;
  if (!path.startsWith("/api/v1/") || isPublicRoute(request.method, path)) {
    next();
    return;
  }
  const token = request.header("x-session-token");
  if (token === undefined || token === "") {
    // Anonymous on a protected route: no tenant key, nothing to draw from.
    // The guard chain 401s it; the login/reset limiters own the flood face.
    next();
    return;
  }
  // Always exactly one lookup — the tenant key is required for every
  // limited request (no cheap-path skip is possible by construction).
  const session = await deps.findSessionTenant(hashToken(token)).catch(() => undefined);
  if (session === undefined || session.activeTenantId === null) {
    next();
    return;
  }
  const decision: RateLimitDecision = deps.limiter.attempt(`tenant:${session.activeTenantId}`);
  response.header("X-RateLimit-Limit", String(decision.limit));
  response.header("X-RateLimit-Remaining", String(decision.remaining));
  if (!decision.allowed) {
    response.header("Retry-After", String(decision.retryAfterSeconds));
    // Same envelope shape ErrorModelFilter emits (ERROR_MODEL §2), written
    // directly: middleware short-circuits never reach the exception filter.
    response.status(429).json({
      error: {
        code: "TENANT_RATE_LIMITED",
        message: "tenant API burst limit reached — retry later",
        retryable: false,
        traceId: getCorrelationId() ?? "",
      },
    });
    return;
  }
  next();
}

@Injectable()
export class TenantRateLimitMiddleware implements NestMiddleware {
  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    await enforceTenantRateLimit(request, response, next, tenantRateLimitDeps());
  }
}
