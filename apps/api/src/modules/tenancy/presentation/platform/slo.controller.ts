import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";

import { identityOf, type SessionContext } from "../../../../infra/context/session-context";
import { RequirePermissions } from "../../../../infra/auth/require-permissions.decorator";
import { PlatformScope } from "../../../../infra/auth/platform-scope.decorator";
import { envelope } from "../../../../infra/http/envelope";
import { sloSnapshot, type SloSnapshot } from "../../../../infra/observability/slo";
import { UnauthenticatedError } from "../../../identity/api/identity";

/**
 * PHASE-025 T9d — the SLO/error-budget platform read (MONITORING §5; the
 * web `/[locale]/platform/slo` screen's source): `GET /api/v1/platform/slo`
 * returns the six finalized SLO evaluations + the SLOBurn alert set + the
 * raw in-process metrics view (SF-024-021 substrate — see
 * infra/observability/slo.ts for the honest window semantics).
 *
 * Guarding: the existing platform read-only observation key
 * `platform.audit.view` (matrix §3.10 — cross-tenant platform review, held
 * by the platform-operations platform_admin role only). The master plan
 * named `platform.admin.access`; that key is NOT in the permission seed
 * (matrix §3.10 carries exactly ten platform.* keys and the identity-flows
 * DB spec pins that set), so using it would 403 every caller and violate
 * the no-new-keys constraint — the audit-view key is the truthful existing
 * gate for a cross-tenant ops read. Platform reads are not audit-logged
 * per the local convention (supportReview/listTenants precedent: reads
 * carry no audit row; only state changes do).
 */
@PlatformScope()
@Controller("api/v1/platform")
export class PlatformSloController {
  /** The SLO dashboard aggregate (evaluated on demand — SLO_BURN_EVALUATION). */
  @Get("slo")
  @RequirePermissions("platform.audit.view")
  async slo(@Req() request: Request): Promise<{ data: SloSnapshot; meta: { requestId: string } }> {
    const identity: SessionContext | undefined = identityOf(request);
    if (identity === undefined) {
      throw new UnauthenticatedError();
    }
    return envelope(sloSnapshot());
  }
}
