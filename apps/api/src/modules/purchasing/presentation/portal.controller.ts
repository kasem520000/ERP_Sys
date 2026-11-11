import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { getDb } from "../../../infra/db/client";
import { withTenant } from "../../../infra/db/tenant-context";
import { envelope } from "../../../infra/http/envelope";
import { RateLimiter } from "../../identity/infrastructure/rate-limiter";
import { SupplierQuoteService, hashPortalToken } from "../application/quotes";
import { PortalTokenInvalidError } from "../domain/sourcing-errors";

/**
 * The supplier-portal skeleton (PHASE-038 T-03; P-05): ONE quote-
 * submission endpoint with scoped, audited, rate-limited authentication —
 * the minimal external-facing surface the full portal (PHASE-060) shares
 * per the roadmap.
 *
 * Auth model: the invitation token IS the credential (the device-
 * enrollment/invitation patterns — a 256-bit random value minted by the
 * back-office route, hashed at rest, shown ONCE). The route is PUBLIC
 * (PUBLIC_ROUTES): the pre-GUC lookup runs through the SECURITY DEFINER
 * projection (erp.portal_resolve_rfq_token — the erp_definer discipline),
 * then the submission re-opens the resolved tenant scope withTenant(...)
 * and re-validates the SAME invite under RLS. The supplier identity comes
 * ONLY from the token; the request body can never claim another supplier,
 * another RFQ, or another tenant (the spoof battery proves each leg).
 *
 * Every submission is audited (purchasing.portal_quote_submitted) inside
 * the tenant scope; the limiter owns the anonymous surface (per-IP +
 * per-RFQ sliding window — the login limiter's Map pattern).
 */

const PORTAL_LIMITER = new RateLimiter(undefined, 10, 60_000);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");

const portalQuoteSchema = z.object({
  token: z.string().min(20).max(200),
  quoteRef: z.string().max(120).nullable().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
  validUntil: DATE.nullable().optional(),
  paymentTerms: z.string().max(300).nullable().optional(),
  portalContact: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        rfqLineId: z.string().uuid(),
        qty: z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)"),
        unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)"),
        leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
        note: z.string().max(300).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

interface PortalTokenResolution {
  tenantId: string;
  supplierId: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

@Controller("/api/v1/portal")
export class PortalController {
  constructor(private readonly quotes: SupplierQuoteService) {}

  @Post("rfqs/:rfqId/quotes")
  @HttpCode(HttpStatus.CREATED)
  async submitQuote(
    @Req() request: Request,
    @Param("rfqId") rfqId: string,
    @Body() body: unknown,
  ) {
    const input = portalQuoteSchema.parse(body);
    // Rate limit FIRST (before any identity work): per-IP + per-RFQ, the
    // login limiter's shape-uniform typed rejection.
    const ip = request.ip ?? "unknown";
    PORTAL_LIMITER.consume(`${ip}:${rfqId}`);

    // The pre-GUC resolution: the SECURITY DEFINER projection (erp_definer)
    // reads the rfq row cross-tenant by exact token hash only.
    const tokenHash = await hashPortalToken(input.token);
    const db = getDb();
    const rows = await db.execute(
      sql`SELECT * FROM erp.portal_resolve_rfq_token(${rfqId}::uuid, ${tokenHash})`,
    );
    const resolution = (rows.rows as unknown as PortalTokenResolution[])[0];
    if (resolution === undefined) {
      // Shape-uniform: unknown rfq, unknown token, revoked, expired —
      // the SAME typed rejection (no oracle).
      throw new PortalTokenInvalidError();
    }

    const submitted = await withTenant(resolution.tenantId, async () =>
      this.quotes.portalSubmit({
        rfqId,
        token: input.token,
        quoteRef: input.quoteRef ?? null,
        currencyCode: input.currencyCode,
        leadTimeDays: input.leadTimeDays ?? null,
        validUntil: input.validUntil ?? null,
        paymentTerms: input.paymentTerms ?? null,
        portalContact: input.portalContact ?? null,
        note: input.note ?? null,
        lines: input.lines.map((l) => ({
          rfqLineId: l.rfqLineId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          leadTimeDays: l.leadTimeDays ?? null,
          note: l.note ?? null,
        })),
      }),
    );
    return envelope(submitted);
  }
}
