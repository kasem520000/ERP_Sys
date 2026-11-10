import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../../infra/context/session-context";
import { RequirePermissions } from "../../../../infra/auth/require-permissions.decorator";
import { PlatformScope } from "../../../../infra/auth/platform-scope.decorator";
import { ambientAnyTx, withTenantOnTx } from "../../../../infra/db/tenant-context";
import { UnauthenticatedError } from "../../../identity/api/identity";
import { SubscriptionService } from "../../application/billing/subscription-service";
import {
  listPayouts,
  reconcilePayouts,
  refundSettledPayment,
  syncPayouts,
} from "../../application/billing/refund-payout-service";
import * as billingStore from "../../infrastructure/billing.store";

/**
 * PHASE-014 billing extensions to the platform admin console (PHASE-014
 * §2.2/§4; matrix §3.10): subscription search + billing history per
 * tenant, staff-created checkout sessions, the manual-invoicing fallback
 * (A-009 — reason + reference mandatory, audited via_platform_admin),
 * billing-driven suspend/restore (the PHASE-004 semantics), and the
 * on-demand daily pass.
 */

const checkoutSchema = z.object({
  tenantId: z.string().uuid(),
  planKey: z.enum(["starter", "business", "enterprise"]),
  periodMonths: z.number().int().min(1).max(12).optional(),
});

const manualPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  via: z.enum(["bank_transfer", "cash", "cheque"]),
  reference: z.string().min(3).max(100),
  reason: z.string().min(3).max(500),
});

const reasonSchema = z.object({ reason: z.string().min(3).max(500) });

const refundSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceNumber: z.string().min(1).max(80),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, "positive decimal"),
});

const payoutSyncSchema = z.object({
  tenantId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

@PlatformScope()
@Controller("api/v1/platform")
export class PlatformBillingController {
  constructor(
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {}

  // -- subscriptions (billing history + checkout + manual fallback) -------

  @Get("subscriptions")
  @RequirePermissions("platform.subscriptions.manage")
  async listSubscriptions(
    @Query("tenantId") tenantId?: string,
    @Query("limit") rawLimit?: string,
  ): Promise<unknown> {
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    if (tenantId !== undefined && tenantId !== "") {
      // Cross-tenant billing history for one tenant (per-operation tenant
      // scoping — the PHASE-004 console pattern).
      const tx = ambientAnyTx();
      const history = await withTenantOnTx(tenantId, tx!, async () => {
        const subscription = await billingStore.currentSubscriptionRow().catch(() => undefined);
        const invoices = await billingStore.listInvoices(
          Number.isFinite(limit) && limit! > 0 ? Math.min(limit!, 200) : 50,
        );
        const events = await billingStore.listBillingEvents(50);
        const plan =
          subscription === undefined
            ? undefined
            : await billingStore.findBillingPlanById(subscription.planId);
        return { subscription: subscription ?? null, plan: plan ?? null, invoices, events };
      });
      return envelope(history);
    }
    // No tenant filter: the definer worklist (latest row per tenant).
    const rows = await billingStore.platformListSubscriptionsNeedingAttention();
    return envelope({ subscriptions: rows });
  }

  @Post("subscriptions")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async createCheckout(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = checkoutSchema.parse(body);
    const tx = ambientAnyTx();
    const outcome = await withTenantOnTx(input.tenantId, tx!, async () => {
      const current = await billingStore.currentSubscriptionRow();
      if (current === undefined) {
        throw new Error("tenant has no active subscription row");
      }
      const plan = await billingStore.findBillingPlanByKey(input.planKey);
      if (plan === undefined) {
        throw new Error(`unknown plan ${input.planKey}`);
      }
      return this.subscriptions.createCheckoutSession(plan, current, input.periodMonths ?? 1);
    });
    return envelope({
      checkoutUrl: outcome.url,
      invoiceNumber: outcome.invoiceNumber,
      sessionRef: outcome.ref,
      createdBy: identity.userId,
    });
  }

  @Post("subscriptions/:id/manual-payment")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async recordManualPayment(@Req() request: Request, @Param("id") _id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = manualPaymentSchema.parse(body);
    const outcome = await this.subscriptions.recordManualPayment({
      invoiceId: input.invoiceId,
      via: input.via,
      reference: input.reference,
      reason: input.reason,
      staffActorId: identity.userId,
    });
    return envelope(outcome);
  }

  @Post("subscriptions/:id/suspend")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async suspendSubscription(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    const outcome = await this.subscriptions.suspendForBilling({
      subscriptionId: id,
      actorId: identity.userId,
      reason: input.reason,
    });
    return envelope(outcome);
  }

  @Post("subscriptions/:id/restore")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async restoreSubscription(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    const outcome = await this.subscriptions.restoreFromBilling({
      subscriptionId: id,
      actorId: identity.userId,
      reason: input.reason,
    });
    return envelope(outcome);
  }

  @Post("subscriptions/run-daily-pass")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async runDailyPass(@Req() request: Request): Promise<unknown> {
    const identity = requireIdentity(request);
    const outcome = await this.subscriptions.runDailyPass({
      runMode: "ON_DEMAND",
      actorId: identity.userId,
    });
    return envelope(outcome);
  }

  // -- PHASE-023 T6: refund + payout reconciliation (sandbox depth; DR-002 OPEN) --

  @Post("billing/refund")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async refund(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = refundSchema.parse(body);
    const tx = ambientAnyTx();
    const outcome = await withTenantOnTx(input.tenantId, tx!, async () =>
      refundSettledPayment({
        provider: this.subscriptions.provider,
        invoiceNumber: input.invoiceNumber,
        amount: input.amount,
        actorId: identity.userId,
      }),
    );
    return envelope(outcome);
  }

  @Post("billing/payouts/sync")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async syncPayoutBatches(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    requireIdentity(request);
    const input = payoutSyncSchema.parse(body);
    const tx = ambientAnyTx();
    const outcome = await withTenantOnTx(input.tenantId, tx!, async () => {
      const synced = await syncPayouts({
        provider: this.subscriptions.provider,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      });
      await reconcilePayouts();
      return synced;
    });
    return envelope(outcome);
  }

  @Get("billing/payouts")
  @RequirePermissions("platform.subscriptions.manage")
  async payouts(@Query("tenantId") tenantId?: string): Promise<unknown> {
    if (tenantId === undefined || tenantId === "") {
      return envelope({ payouts: [] });
    }
    const tx = ambientAnyTx();
    const payouts = await withTenantOnTx(tenantId, tx!, async () => listPayouts());
    return envelope({ payouts });
  }
}
