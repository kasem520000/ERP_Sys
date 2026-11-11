import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../../../infra/db/client";
import { withTenant } from "../../../infra/db/tenant-context";
import { envelope } from "../../../infra/http/envelope";
import { RateLimitedError } from "../../identity/domain/identity-errors";
import { DunningService } from "../application/dunning";

/**
 * The collection-agency callback port (PHASE-039 L1-11): ONE public
 * endpoint where an agency's system reports referral status — the 038
 * supplier-portal pattern verbatim.
 *
 * Auth model: the agency's callback token IS the credential (issued by the
 * back-office route, sha256-hashed at rest, shown ONCE, revocable by
 * re-issue/suspend). The route is PUBLIC (PUBLIC_ROUTES): the pre-GUC
 * lookup runs through the SECURITY DEFINER projection
 * (erp.portal_resolve_agency_token — the erp_definer discipline), then the
 * service re-opens the resolved tenant scope withTenant(...) and
 * re-validates the SAME token under RLS. The agency identity comes ONLY
 * from the token; the request body can never claim another agency, another
 * referral, or another tenant.
 *
 * Rate limit: an in-memory FIXED-WINDOW limiter, 10 callbacks/minute per
 * TOKEN HASH (not per IP — an attacker spraying random tokens must not
 * saturate a legitimate agency's window; each unknown hash gets its own
 * throwaway window, and the legitimate agency's budget stays its own).
 * Fixed-window (not the login limiter's sliding window) keeps the
 * anonymous path allocation-free between windows; multi-instance
 * deployments move the counter to the shared plane with the first
 * scale-out phase (the RateLimiter Map precedent).
 *
 * Every accepted callback is audited inside the tenant scope
 * (sales.agency_callback_recorded).
 */

const CALLBACK_LIMIT = 10;
const CALLBACK_WINDOW_MS = 60_000;
const callbackWindows = new Map<string, { windowStart: number; count: number }>();

function callbackAllowed(tokenHash: string): boolean {
  const now = Date.now();
  const window = callbackWindows.get(tokenHash);
  if (window === undefined || now - window.windowStart >= CALLBACK_WINDOW_MS) {
    callbackWindows.set(tokenHash, { windowStart: now, count: 1 });
    return true;
  }
  window.count += 1;
  if (window.count > CALLBACK_LIMIT) {
    return false;
  }
  return true;
}

const callbackSchema = z.object({
  token: z.string().min(20).max(200),
  referralId: z.string().uuid(),
  status: z.enum(["ACKNOWLEDGED", "PARTIAL", "SETTLED"]),
  settledAmount: z
    .string()
    .regex(/^\d+\.\d{4}$/, "canonical 4-dp decimal")
    .nullable()
    .optional(),
});

interface AgencyTokenResolution {
  /** 0058's projection returns snake_case columns (unlike 0051's aliased
   *  rfq projection) — the RETURNS TABLE names are the contract. */
  tenant_id: string;
  agency_id: string;
  agency_status: string;
}

@Controller("/api/v1/portal/collection-agencies")
export class AgencyPortalController {
  constructor(private readonly dunning: DunningService) {}

  @Post("callback")
  @HttpCode(HttpStatus.OK)
  async callback(@Body() body: unknown) {
    const input = callbackSchema.parse(body);
    // Rate limit FIRST (before any identity work): per token HASH, fixed
    // window — the login limiter's shape-uniform typed rejection.
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    if (!callbackAllowed(tokenHash)) {
      throw new RateLimitedError(60);
    }

    // The pre-GUC resolution: the SECURITY DEFINER projection (erp_definer)
    // reads the agency row cross-tenant by exact token hash, ACTIVE only.
    const db = getDb();
    const rows = await db.execute(
      sql`SELECT * FROM erp.portal_resolve_agency_token(${tokenHash})`,
    );
    const resolution = (rows.rows as unknown as AgencyTokenResolution[])[0];
    if (resolution === undefined) {
      // Shape-uniform: unknown token, suspended agency, revoked — the SAME
      // typed rejection (no oracle).
      const { AgencyTokenInvalidError } = await import("../domain/sales-errors");
      throw new AgencyTokenInvalidError();
    }

    const referral = await withTenant(resolution.tenant_id, () =>
      this.dunning.agencyCallback({
        token: input.token,
        referralId: input.referralId,
        status: input.status,
        settledAmount: input.settledAmount ?? null,
      }),
    );
    return envelope({ referralId: referral.id, status: referral.status });
  }
}
