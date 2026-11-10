import { Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import { lastValueFrom, Observable } from "rxjs";

import { withPlatformScope, withTenant } from "../db/tenant-context";
import { isPlatformScoped, PLATFORM_SCOPE_KEY } from "../auth/platform-scope.decorator";
import { membershipOptions } from "../../modules/identity/infrastructure/identity.store";
import {
  TenantSuspendedError,
  TenantContextRequiredError,
} from "../../modules/identity/domain/identity-errors";
import { SubscriptionReadOnlyError } from "../../modules/tenancy/domain/subscription-errors";
import { RESOLVING_ACTIONS } from "../../modules/tenancy/application/billing/billing-config";
import * as billingStore from "../../modules/tenancy/infrastructure/billing.store";
import { identityOf, type SessionContext } from "../context/session-context";

/**
 * Tenant-context interceptor (PHASE-003 T11; MULTI_TENANCY §2 lifecycle;
 * PHASE-014 read-only-mode enforcement): establish (session → user →
 * active membership), validate (membership ACTIVE, tenant ACTIVE — S-02
 * enforcement; subscription read-only grace — PHASE-014 §2.3), propagate
 * (AsyncLocalStorage → `SET LOCAL` GUC via the PHASE-002 unit-of-work),
 * and clear on the way out. The handler (and everything it awaits) runs
 * INSIDE the tenant transaction: RLS covers every tenant-owned touch, and
 * audit events land in the same UoW. The correlation id flows from the
 * RequestIdMiddleware ALS scope into withTenant automatically. Suspended
 * tenants fail with 503 TENANT_SUSPENDED (M-09).
 *
 * PHASE-014 read-only grace: a GRACE_READ_ONLY subscription turns every
 * state-changing business action into the typed 403
 * `tenancy/subscription-read-only` (naming the resolving action) while
 * reads, reports, exports, printing, dashboards, notifications, and the
 * billing surfaces themselves continue — the grace is a first-class
 * product state, never an error page (SUBSCRIPTION §8).
 */

/** State-changing routes that REMAIN usable during read-only grace. */
const READ_ONLY_EXEMPT_PREFIXES: readonly string[] = [
  "/api/v1/reporting/", // runs + exports + print previews (read-only effects)
  "/api/v1/notifications", // inbox management + per-user preferences
  "/api/v1/tenancy/subscriptions", // the resolving action itself (pay/upgrade)
  "/api/v1/tenancy/usage", // usage reads/warnings
  "/api/v1/identity/password-change", // self plane stays usable
  "/api/v1/identity/mfa/", // self plane stays usable
  "/api/v1/identity/sessions/refresh", // session substrate
  "/api/v1/identity/sessions/switch-tenant", // session substrate
  "/api/v1/identity/sessions/current", // logout (DELETE) stays usable
];

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isReadOnlyExempt(path: string): boolean {
  // Longest-prefix match; the list is small and fixed.
  return READ_ONLY_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

interface IdentityWithReadOnly extends SessionContext {
  subscriptionStateCached?: billingStore.SubscriptionStateProjection | null;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const identity: SessionContext | undefined = identityOf(request);
    if (identity === undefined || identity.activeTenantId === null) {
      // Public + session-self routes run without a tenant scope; tenant
      // surfaces are guarded by RequirePermissions (which requires one).
      return next.handle();
    }
    const options =
      identity.memberships ?? (identity.memberships = await membershipOptions(identity.userId));
    const active = options.find(
      (option) =>
        option.tenantId === identity.activeTenantId && option.membershipStatus === "ACTIVE",
    );
    if (active === undefined) {
      throw new TenantContextRequiredError();
    }
    if (active.tenantStatus === "SUSPENDED") {
      // MULTI_TENANCY §3 rule 6: a suspended tenant keeps ONLY the admin
      // console accessible — never a tenant-scope session. (The platform
      // operations tenant is lifecycle-protected from suspension; if it
      // ever ends up suspended this fails closed too.)
      throw new TenantSuspendedError(); // 503 tenant_suspended (S-02)
    }
    // PHASE-014: read-only grace enforcement (§2.3). The subscription
    // state resolves through the migration-0021 pre-GUC projection and is
    // cached on the request identity (one query per request; no row → no
    // enforcement — legacy tenants ride entitlements only).
    if (STATE_CHANGING_METHODS.has(request.method) && !isReadOnlyExempt(request.path)) {
      const cached = identity as IdentityWithReadOnly;
      const state =
        cached.subscriptionStateCached ??
        (cached.subscriptionStateCached =
          (await billingStore.subscriptionStateProjection(identity.activeTenantId)) ?? null);
      if (state !== null && state.status === "GRACE_READ_ONLY") {
        throw new SubscriptionReadOnlyError({
          status: state.status,
          graceEndsAt: state.graceEndsAt,
          resolvingAction: RESOLVING_ACTIONS.readOnly,
        });
      }
    }
    identity.activeTenant = active;
    const platformRoute = isPlatformScoped(
      this.reflector.get<boolean | undefined>(PLATFORM_SCOPE_KEY, context.getHandler()),
      this.reflector.get<boolean | undefined>(PLATFORM_SCOPE_KEY, context.getClass()),
    );
    // Lazily enter the right UoW at subscription time: platform routes
    // run in the platform GUC envelope (ADR-0005 platform path; console
    // services add per-operation tenant scoping); every other route in
    // the tenant transaction (RLS on every tenant-owned touch; audit in
    // the same UoW). A business-tenant session on a platform route is
    // rejected by the permission guard BEFORE this interceptor commits
    // any scope — no cross-tenant envelope is ever handed to a tenant.
    return new Observable<unknown>((subscriber) => {
      void (platformRoute
        ? withPlatformScope(async () => {
            try {
              const result = await lastValueFrom(next.handle());
              subscriber.next(result);
              subscriber.complete();
            } catch (error) {
              subscriber.error(error);
            }
          })
        : withTenant(active.tenantId, async () => {
            try {
              const result = await lastValueFrom(next.handle());
              subscriber.next(result);
              subscriber.complete();
            } catch (error) {
              subscriber.error(error);
            }
          }));
    });
  }
}
