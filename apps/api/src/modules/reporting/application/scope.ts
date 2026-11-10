import type { ReportContract, ReportParams, RunContext } from "./contract";

/**
 * PHASE-013 T5 · contract-level permission + scope enforcement
 * (REPORTING_ARCHITECTURE §4–§5, binding):
 * - `requiredPermission` is checked BEFORE parameter binding and again at
 *   job execution (T4 re-resolution — no TOCTOU);
 * - the effective scope is the INTERSECTION of the requested scope and the
 *   user's branch grants — never the request alone;
 * - drill links are filtered by the target permission (a link the user
 *   cannot open renders disabled with a bilingual reason upstream — never
 *   a silent 403 in the money path).
 */

export class PermissionDeniedError extends Error {
  constructor(
    readonly reportKey: string,
    readonly permission: string,
  ) {
    super(`report ${reportKey} requires permission ${permission}`);
  }
}

/** Check the contract permission against the context's grant set. */
export function assertContractPermission(contract: ReportContract, ctx: RunContext): void {
  if (!ctx.permissions.has(contract.requiredPermission)) {
    throw new PermissionDeniedError(contract.id, contract.requiredPermission);
  }
}

export interface EffectiveScope {
  /** Requested branchIds ∩ user's branch grants (null = all branches). */
  readonly branchIds: readonly string[] | null;
  /** True when the request tried to widen beyond the user's grants. */
  readonly narrowed: boolean;
}

/**
 * Branch scope intersection (§5): a branch-scoped user cannot widen to
 * all-branches; the requested set is intersected with the grants.
 */
export function intersectBranchScope(
  ctx: Pick<RunContext, "effectiveBranchIds">,
  params: Pick<ReportParams, "branchIds">,
): EffectiveScope {
  if (ctx.effectiveBranchIds === null) {
    // Tenant-wide grants: the request may scope down but not widen (there
    // is nothing to widen to — null already means all).
    return {
      branchIds: params.branchIds == null ? null : [...params.branchIds],
      narrowed: false,
    };
  }
  const allowed = new Set(ctx.effectiveBranchIds);
  const requestedParam = params.branchIds ?? [];
  if (requestedParam.length === 0) {
    // Requested all-branches but the user is branch-scoped: intersect
    // down to the grants (never the request alone).
    return { branchIds: [...allowed], narrowed: true };
  }
  const requested = requestedParam.filter((id) => allowed.has(id));
  return { branchIds: requested, narrowed: requested.length < requestedParam.length };
}

/**
 * Drill-link permission filtering (§4): generate links only for targets the
 * user can open. Contracts call this when building row drillLinks.
 */
export function drillRoute(
  ctx: Pick<RunContext, "permissions">,
  route: string,
  permission: string,
): string | null {
  return ctx.permissions.has(permission) ? route : null;
}
