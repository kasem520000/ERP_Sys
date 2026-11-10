import { SetMetadata } from "@nestjs/common";

/**
 * `@RequirePermissions` (PHASE-003 T10; matrix §8 layer 1): the ONLY
 * admission point for client requests — route-level permission keys
 * resolved server-side from the session's active membership. `self: true`
 * marks self-scoped surfaces (matrix §3.9 "every user (self)").
 */
export interface RequirePermissionMetadata {
  readonly key: string;
  readonly self?: boolean;
}

export const REQUIRE_PERMISSIONS_KEY = "identity:require-permissions";

export const RequirePermissions = (key: string, options: { self?: boolean } = {}) =>
  SetMetadata<string, RequirePermissionMetadata>(REQUIRE_PERMISSIONS_KEY, {
    key,
    self: options.self,
  });
