import type { Request } from "express";

import type { MembershipOption } from "../../modules/identity/infrastructure/identity.store";

/**
 * Request-scoped identity context (PHASE-003 §2.10): established by
 * SessionMiddleware from the X-Session-Token presented by the BFF
 * (ADR-0003) — never from cookies at the API plane, never from client
 * body/header tenant claims (S-03). The active tenant scope and effective
 * permissions are resolved by the guard/interceptor from the session.
 */

export interface SessionContext {
  sessionId: string;
  userId: string;
  user: { email: string; fullName: string; locale: string; status: string };
  activeTenantId: string | null;
  /** Resolved by PermissionsGuard (definer projection — pre-GUC). */
  memberships?: readonly MembershipOption[];
  /** Resolved lazily and cached per request by the guard. */
  permissions?: Set<string>;
  /** PHASE-004: active feature keys, resolved by the entitlements guard. */
  entitlements?: Set<string>;
  activeTenant?: MembershipOption;
}

/** Attach the identity to the request (SessionMiddleware only). */
export function setIdentity(request: Request, context: SessionContext): void {
  (request as Request & { identity?: SessionContext }).identity = context;
}

/** Typed accessor — undefined means anonymous (public routes only). */
export function identityOf(request: Request): SessionContext | undefined {
  return (request as Request & { identity?: SessionContext }).identity;
}

/**
 * PlatformScope marker (PHASE-003 §2.10): reserved for PHASE-004 platform
 * routes — platform staff authenticate through the same session substrate
 * but carry platform-plane permissions only (matrix §3.10) and never a
 * tenant membership. Deliberately opaque: nothing may construct one yet.
 */
export interface PlatformScope {
  readonly __platformScope: unique symbol;
}

/**
 * PHASE-004 resolution of the reserved marker: platform staff are users
 * with an ACTIVE membership in the dedicated platform-operations tenant
 * (migration 0006 `erp.seed_platform_tenant()`) holding the instantiated
 * platform_admin role — platform.* keys only, never a business-tenant
 * role (matrix §2/§3.10). Their sessions point at the operations tenant;
 * `@PlatformScope()` routes enter the platform GUC path instead of the
 * tenant GUC, with per-operation tenant scoping for tenant-plane reads
 * (ADR-0005). Business-tenant sessions are naturally 403-ed by the
 * permission guard — no platform.* key ever lives in a tenant role.
 */
export const PLATFORM_TENANT_ID = "20000000-0000-4000-8000-000000000001";
