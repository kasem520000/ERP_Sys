import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { SessionService } from "../../modules/identity/application/session-service";
import * as store from "../../modules/identity/infrastructure/identity.store";
import { verifyAccessToken } from "../../modules/sync/application/device-tokens";
import { setIdentity, type SessionContext } from "../context/session-context";
import { getCorrelationId } from "../observability/request-context";

/**
 * Session middleware (PHASE-003 T11): resolves the BFF-presented
 * X-Session-Token into a request-scoped identity context — the API plane
 * never reads cookies (CSRF-exempt by construction, AUTHENTICATION §1).
 * Failure here is deferred: public routes stay reachable without a
 * session; protected surfaces reject through the PermissionsGuard.
 *
 * PHASE-020 (ADR-0015 §3; SYNC_PROTOCOL §1.4): native offline clients
 * present a 15-min device access token (`Authorization: Bearer <jwt>`
 * with {sub, deviceId, capabilities} claims) instead of a web session —
 * the same identity context resolves (user + active membership tenant),
 * and the sync services re-verify the device row (revocation is enforced
 * per request, never by token lifetime alone). Session tokens keep
 * priority when both are presented (the BFF path).
 *
 * PHASE-024 (ADR-0015 §4 enforcement): an enrollment-bootstrap session
 * (mfa_gate_passed = false) is short-circuited to 423 MFA_ENROLLMENT_REQUIRED
 * outside the MFA enrollment allowlist — the restricted session unlocks
 * nothing but the enrollment surface + whoami/logout until a valid TOTP
 * confirmation flips the gate (MfaService.verify).
 */

/** Routes a gated enrollment session may still reach. */
const MFA_ENROLLMENT_ALLOWLIST: readonly RegExp[] = [
  /^\/api\/v1\/identity\/mfa(\/|$)/,
  /^\/api\/v1\/identity\/sessions\/current$/,
];

/**
 * Nest's per-route middleware mounting resets `request.path`/`request.url`
 * to "/" — the ORIGINAL full path survives only on `originalUrl` (query
 * string stripped; the allowlist anchors on `$`).
 */
function routePathOf(request: Request): string {
  const original = request.originalUrl ?? request.path;
  return original.split("?")[0] ?? original;
}

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    const presented = request.header("x-session-token");
    if (presented !== undefined && presented !== "") {
      try {
        const validation = await this.sessions.validate(presented);
        const user = await store.findUserById(validation.userId);
        if (user !== undefined && user.status !== "DEACTIVATED") {
          if (
            validation.mfaGatePassed === false &&
            !MFA_ENROLLMENT_ALLOWLIST.some((pattern) => pattern.test(routePathOf(request)))
          ) {
            // The enrollment gate: same envelope shape the error filter
            // emits, 423 per the MFA_REQUIRED contract.
            response.status(423).json({
              error: {
                code: "MFA_ENROLLMENT_REQUIRED",
                message:
                  "multi-factor enrollment must be completed before this session can proceed",
                retryable: false,
                traceId: getCorrelationId() ?? "",
              },
            });
            return;
          }
          const context: SessionContext = {
            sessionId: validation.sessionId,
            userId: user.id,
            user: {
              email: user.email,
              fullName: user.fullName,
              locale: user.locale,
              status: user.status,
            },
            activeTenantId: validation.activeTenantId,
          };
          setIdentity(request, context);
          // Sliding window bookkeeping (M-01): cheap, off the critical path.
          await store.touchSessionLastSeen(validation.sessionId).catch(() => undefined);
        }
      } catch {
        // Invalid/expired/revoked token → anonymous; guards will 401 where
        // the surface requires a session (uniform shape, no oracle).
      }
    } else {
      // PHASE-020: the device-token path — Bearer JWT, verified
      // timing-safe; the active tenant resolves from the user's ACTIVE
      // membership (the device never names a tenant — MULTI_TENANCY §3;
      // the definer projection is pre-GUC by design, migration 0003).
      const authorization = request.header("authorization");
      if (authorization !== undefined && authorization.startsWith("Bearer ")) {
        const claims = verifyAccessToken(authorization.slice("Bearer ".length));
        if (claims !== undefined) {
          const user = await store.findUserById(claims.sub).catch(() => undefined);
          if (user !== undefined && user.status !== "DEACTIVATED") {
            const options = await store
              .membershipOptions(user.id)
              .catch(() => [] as store.MembershipOption[]);
            const active = options.find(
              (option) =>
                option.membershipStatus === "ACTIVE" && option.tenantStatus === "ACTIVE",
            );
            if (active !== undefined) {
              setIdentity(request, {
                // No web session backs a device token — the placeholder
                // keeps the SessionContext shape (guards never read it for
                // device traffic; the sync services verify the device row).
                sessionId: `device:${claims.deviceId}`,
                userId: user.id,
                user: {
                  email: user.email,
                  fullName: user.fullName,
                  locale: user.locale,
                  status: user.status,
                },
                activeTenantId: active.tenantId,
              });
            }
          }
        }
      }
    }
    next();
  }
}
