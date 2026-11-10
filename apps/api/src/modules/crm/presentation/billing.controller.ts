import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { BillingRunService } from "../application/billing-run-service";

/**
 * Billing-run routes (PHASE-019 §11 rows 30–31; AUTHORIZATION_MATRIX §3.8):
 * the manual run (POST — permission `crm.contracts.bill`, feature
 * `crm.recurring_billing`) and its history (GET — over the `crm.billing_run`
 * audit events; migration 0027 shipped NO billing_runs table, the
 * documented §5 choice). The run drafts through the ordinary
 * SalesInvoiceService chain and NEVER auto-posts (BR-034); idempotency is
 * the contract_invoices guards' (INV-013) plus the global Idempotency-Key
 * guard. Foreign or unknown ids are 404-shaped (A7).
 *
 * Shares the `api/v1/crm` prefix with the T45/T46 controllers so the
 * registered route-permissions rows match byte-for-byte.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const LIMIT = z.coerce.number().int().min(1).max(500);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const runSchema = z
  .object({
    asOf: DATE.optional(),
  })
  .default({});

@Controller("api/v1/crm")
export class BillingController {
  constructor(@Inject(BillingRunService) private readonly billingRuns: BillingRunService) {}

  /** Row 30 — run history (the crm.billing_run audit events, newest first). */
  @Get("billing-runs")
  @RequirePermissions("crm.contracts.bill")
  @RequireFeature("crm.recurring_billing")
  async history(@Query("limit") limit?: string) {
    return envelope(await this.billingRuns.listRuns(LIMIT.parse(limit ?? 100)));
  }

  /** Row 31 — the manual run (asOf defaults to today; INV-013 idempotent). */
  @Post("billing-runs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("crm.contracts.bill")
  @RequireFeature("crm.recurring_billing")
  async run(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = runSchema.parse(body ?? {});
    return envelope(
      await this.billingRuns.run({
        asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
        actorId: identity.userId,
      }),
    );
  }
}
