import { SetMetadata } from "@nestjs/common";

/**
 * PlatformScope route marker (PHASE-004 §2.7; the shape reserved by
 * PHASE-003 session-context.ts): controllers on the platform plane
 * (matrix §3.10 — `platform.*` permission-gated, never
 * tenant-assignable) decorate their handlers with it. Effects:
 *
 * - TenantContextInterceptor enters the PLATFORM UoW
 *   (`withPlatformScope` — the `erp.platform_scope` GUC) instead of the
 *   tenant GUC; cross-tenant reads/writes resolve through the platform
 *   path with per-operation tenant scoping (ADR-0005);
 * - PermissionsGuard audits denials on the platform trail
 *   (tenant_id NULL, via_platform_admin) instead of a tenant row;
 * - RequireFeature skips the tenant entitlement check (the platform
 *   plane is not feature-gated — plan features are a tenant concept).
 *
 * Platform staff authenticate through the SAME session substrate with a
 * membership in the dedicated platform-operations tenant (migration
 * 0006) holding the instantiated platform_admin role — they never carry
 * business-tenant roles (matrix §2).
 */
export const PLATFORM_SCOPE_KEY = "tenancy:platformScope";

export function PlatformScope(): MethodDecorator & ClassDecorator {
  return SetMetadata(PLATFORM_SCOPE_KEY, true) as MethodDecorator & ClassDecorator;
}

/** Is the handler/controller platform-scoped? (handler metadata wins) */
export function isPlatformScoped(
  handlerMetadata: boolean | undefined,
  classMetadata: boolean | undefined,
): boolean {
  return handlerMetadata === true || (handlerMetadata === undefined && classMetadata === true);
}
