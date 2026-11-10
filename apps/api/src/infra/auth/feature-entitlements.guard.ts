import {
  Inject,
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { identityOf } from "../context/session-context";
import {
  isPlatformScoped,
  PLATFORM_SCOPE_KEY,
} from "./platform-scope.decorator";
import { REQUIRE_FEATURE_KEY } from "./require-feature.decorator";
import {
  tenantActiveEntitlements,
} from "../../modules/tenancy/infrastructure/tenancy.store";
import { FeatureNotEntitledError } from "../../modules/tenancy/domain/tenancy-errors";

/**
 * Feature-entitlements guard (BR-039 first enforcement, PHASE-004 T7):
 * server-side check of the route's catalog feature key against the
 * tenant's materialized grants — at request time (the modular-monolith
 * equivalent of "module load") AND per action. Runs after the permission
 * guard; platform-scoped routes and anonymous/self surfaces skip it
 * (entitlements are a tenant-plane concept). Resolution uses the
 * migration-0006 pre-GUC definer projection and is cached on the
 * request's identity context — one query per request, never per query.
 */

@Injectable()
export class FeatureEntitlementsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();
    const featureKey = this.reflector.get<string | undefined>(
      REQUIRE_FEATURE_KEY,
      handler,
    );
    if (featureKey === undefined) {
      return true;
    }
    const platformRoute = isPlatformScoped(
      this.reflector.get<boolean | undefined>(PLATFORM_SCOPE_KEY, handler),
      this.reflector.get<boolean | undefined>(PLATFORM_SCOPE_KEY, controller),
    );
    if (platformRoute) {
      return true; // platform plane is permission-gated, not feature-gated
    }
    const request = context.switchToHttp().getRequest<Request>();
    const identity = identityOf(request);
    if (identity === undefined || identity.activeTenantId === null) {
      return true; // anonymous/self surfaces — permission guard owns those
    }
    const entitlements =
      identity.entitlements ??
      (identity.entitlements = new Set(
        (await tenantActiveEntitlements(identity.activeTenantId)).map(
          (row) => row.featureKey,
        ),
      ));
    if (!entitlements.has(featureKey)) {
      throw new FeatureNotEntitledError(featureKey);
    }
    return true;
  }
}
