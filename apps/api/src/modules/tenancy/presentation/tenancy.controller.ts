import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { effectivePermissions } from "../../identity/infrastructure/identity.store";
import { NAV_ITEMS, resolveNavigation } from "@erp/contracts";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequireLimit } from "../../../infra/auth/require-limit.decorator";
import { publishTenancyEvent } from "../../configuration/api";
import { NotFoundError, UnauthenticatedError } from "../../identity/api/identity";
import { InvalidSettingValueError } from "../../configuration/api";
import { OnboardingService } from "../application/onboarding-service";
import { OffboardingService } from "../application/offboarding/offboarding-service";
import { BranchService } from "../application/branch-service";
import { SettingsService } from "../application/settings-service";
import { EntitlementsService } from "../application/entitlements-service";
import { SupportAccessService } from "../application/support-access-service";
import { SubscriptionService } from "../application/billing/subscription-service";
import { UsageService } from "../application/billing/usage-service";
import { TRIAL_DAYS } from "../application/billing/billing-config";
import * as store from "../infrastructure/tenancy.store";
import * as billingStore from "../infrastructure/billing.store";

/**
 * Tenant-plane tenancy routes (PHASE-004 §2.4/§2.6/§2.8/T6/T8; matrix §3.9):
 * the owner console — profile, typed settings, branches, onboarding
 * provisioning, the BR-039 derived entitlements payload, and the
 * tenant-side support-session surface. Every handler resolves the tenant
 * scope through the TenantContextInterceptor and enforces its matrix key
 * (the generated checklist iterates infra/auth/route-permissions.ts).
 */

const profileUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullish(),
  timezone: z.string().min(3).max(60).optional(),
});

const settingWriteSchema = z.object({ value: z.unknown() });

const branchCreateSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200).nullish(),
  address: z.unknown().nullish(),
});

const branchPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullish(),
  address: z.unknown().nullish(),
  isActive: z.boolean().optional(),
});

const provisionSchema = z.object({
  fiscalCalendarStartMonth: z.number().int().min(1).max(12).optional(),
  numberingAssignAt: z.enum(["approval", "posting"]).optional(),
});

const changePlanSchema = z.object({
  planKey: z.enum(["starter", "business", "enterprise"]),
  periodMonths: z.number().int().min(1).max(12).optional(),
});

const completeCheckoutSchema = z.object({
  outcome: z.enum(["succeeded", "failed"]).optional(),
});

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

function assertIanaTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new InvalidSettingValueError("tenancy.profile.timezone", "not a valid IANA timezone");
  }
}

const offboardingRequestSchema = z.object({
  confirmName: z.string().min(1).max(200),
});

@Controller("api/v1/tenancy")
export class TenancyController {
  constructor(
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(BranchService) private readonly branches: BranchService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
    @Inject(SupportAccessService) private readonly support: SupportAccessService,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(OffboardingService) private readonly offboarding: OffboardingService,
  ) {}

  // -- profile ---------------------------------------------------------------

  @Get("profile")
  @RequirePermissions("tenancy.settings.manage")
  async getProfile(): Promise<unknown> {
    return envelope(await store.getOwnTenant());
  }

  @Put("profile")
  @RequirePermissions("tenancy.settings.manage")
  async updateProfile(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    requireIdentity(request);
    const input = profileUpdateSchema.parse(body);
    if (input.timezone !== undefined) {
      assertIanaTimezone(input.timezone);
    }
    await store.updateTenantProfile({
      name: input.name,
      nameAr: input.nameAr ?? undefined,
      timezone: input.timezone,
    });
    const updated = await store.getOwnTenant();
    // CONFIGURATION_ENGINE §9: profile changes invalidate the full config.
    publishTenancyEvent({ type: "tenant.updated", tenantId: updated.id });
    return envelope(updated);
  }

  // -- typed settings (L5) ----------------------------------------------------

  @Get("settings")
  @RequirePermissions("tenancy.settings.manage")
  async listSettings(): Promise<unknown> {
    return envelope(await this.settings.effectiveConfig());
  }

  @Put("settings/:key")
  @RequirePermissions("tenancy.settings.manage")
  async writeSetting(
    @Req() request: Request,
    @Param("key") key: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = settingWriteSchema.parse(body);
    return envelope(await this.settings.write(identity.userId, key, input.value));
  }

  // -- offboarding (PHASE-024 T11; Journey H — the tenant plane) -------------

  /** H1: the owner requests offboarding (typed-name confirmation). */
  @Post("offboarding/request")
  @RequirePermissions("tenancy.offboarding.execute")
  async requestOffboarding(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    if (identity.activeTenantId === null) {
      throw new NotFoundError("tenant");
    }
    const input = offboardingRequestSchema.parse(body);
    const row = await this.offboarding.request({
      tenantId: identity.activeTenantId,
      requestedBy: identity.userId,
      confirmName: input.confirmName,
    });
    return envelope({ status: row.status, graceUntil: row.graceUntil });
  }

  /** H2: the full export package (tenancy.export.request — the seeded key). */
  @Post("offboarding/export")
  @RequirePermissions("tenancy.export.request")
  async triggerExport(@Req() request: Request): Promise<unknown> {
    const identity = requireIdentity(request);
    if (identity.activeTenantId === null) {
      throw new NotFoundError("tenant");
    }
    const result = await this.offboarding.triggerExport({
      tenantId: identity.activeTenantId,
      actorId: identity.userId,
    });
    return envelope({
      manifestChecksum: result.manifestChecksum,
      downloadUrl: result.downloadUrl,
      artifacts: result.artifacts,
    });
  }

  /** H4 edge: the owner cancels during grace. */
  @Post("offboarding/cancel")
  @RequirePermissions("tenancy.offboarding.execute")
  async cancelOffboarding(@Req() request: Request): Promise<unknown> {
    const identity = requireIdentity(request);
    if (identity.activeTenantId === null) {
      throw new NotFoundError("tenant");
    }
    await this.offboarding.cancel({
      tenantId: identity.activeTenantId,
      actorId: identity.userId,
    });
    return envelope({ cancelled: true });
  }

  // -- branches ---------------------------------------------------------------

  @Get("branches")
  @RequirePermissions("tenancy.branches.manage")
  async listBranches(@Req() request: Request): Promise<unknown> {
    const identity = requireIdentity(request);
    const active = identity.activeTenant;
    if (active === undefined) {
      throw new NotFoundError("current tenant");
    }
    return envelope(
      await this.branches.listForMembership({ branchScope: active.branchScope }),
    );
  }

  @Post("branches")
  @RequirePermissions("tenancy.branches.manage")
  @RequireLimit("branches")
  @HttpCode(HttpStatus.OK)
  async createBranch(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = branchCreateSchema.parse(body);
    return envelope(
      await this.branches.create(identity.userId, {
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        address: input.address ?? null,
      }),
    );
  }

  @Patch("branches/:id")
  @RequirePermissions("tenancy.branches.manage")
  async patchBranch(
    @Req() request: Request,
    @Param("id") branchId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = branchPatchSchema.parse(body);
    return envelope(
      await this.branches.update(identity.userId, branchId, {
        name: input.name,
        nameAr: input.nameAr ?? undefined,
        address: input.address === undefined ? undefined : (input.address as string | null),
        isActive: input.isActive,
      }),
    );
  }

  // -- onboarding (provisionWorkspace backend) --------------------------------

  @Post("onboarding/provision")
  @RequirePermissions("tenancy.settings.manage")
  @RequireFeature("platform.onboarding")
  @HttpCode(HttpStatus.OK)
  async provision(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = provisionSchema.parse(body);
    return envelope(
      await this.onboarding.provision(identity.userId, {
        fiscalCalendarStartMonth: input.fiscalCalendarStartMonth,
        numberingAssignAt: input.numberingAssignAt,
      }),
    );
  }

  // -- entitlements derived payload (BR-039) ---------------------------------

  /** Session-authenticated (SESSION_ROUTES): the derived-only UI payload. */
  @Get("entitlements")
  async derivedEntitlements(@Req() request: Request): Promise<unknown> {
    requireIdentity(request);
    return envelope(await this.entitlements.derivedVisibilityPayload());
  }

  // -- navigation resolution (PHASE-005 T8; NAVIGATION_MODEL §2) --------------

  /**
   * Session-authenticated (SESSION_ROUTES): the derived-only navigation
   * payload — the server resolves the registry (entitlement AND permission,
   * BR-039); the client renders it and never decides visibility. Ungranted
   * routes are opaque 404-equivalents. Platform-plane items are
   * permission-gated only (matrix §3.10 — same rule as the guards).
   */
  @Get("navigation")
  async navigation(@Req() request: Request): Promise<unknown> {
    const identity = requireIdentity(request);
    const tenantId = identity.activeTenantId;
    const featureKeys: Set<string> =
      identity.entitlements ??
      (tenantId !== null
        ? new Set((await store.tenantActiveEntitlements(tenantId)).map((row) => row.featureKey))
        : new Set());
    const permissions: Set<string> =
      identity.permissions ??
      (tenantId !== null ? await effectivePermissions(identity.userId, tenantId) : new Set());
    return envelope(resolveNavigation(NAV_ITEMS, { featureKeys, permissions }));
  }

  // -- subscriptions / billing (PHASE-014; matrix §3.9) -----------------------

  @Get("subscriptions")
  @RequirePermissions("tenancy.subscription.manage")
  async billingHistory(): Promise<unknown> {
    const current = await billingStore.currentSubscriptionRow().catch(() => undefined);
    const invoices = await billingStore.listInvoices(50).catch(() => []);
    const events = await billingStore.listBillingEvents(50).catch(() => []);
    const plan =
      current === undefined
        ? null
        : await billingStore.findBillingPlanById(current.planId).catch(() => undefined);
    return envelope({
      subscription: current ?? null,
      plan:
        plan === undefined || plan === null
          ? null
          : {
              key: plan.key,
              name: plan.name,
              nameAr: plan.nameAr,
              priceAmount: plan.priceAmount,
              annualPriceAmount: plan.annualPriceAmount,
              currencyCode: plan.currencyCode,
              positioning: plan.positioning,
            },
      invoices,
      events,
      trialDaysPlaceholder: TRIAL_DAYS,
    });
  }

  @Post("subscriptions/change-plan")
  @RequirePermissions("tenancy.subscription.manage")
  @HttpCode(HttpStatus.OK)
  async changePlan(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    requireIdentity(request);
    const input = changePlanSchema.parse(body);
    const outcome = await this.subscriptions.changePlan({
      planKey: input.planKey,
      periodMonths: input.periodMonths,
    });
    return envelope(outcome);
  }

  @Post("subscriptions/checkout/:ref/complete")
  @RequirePermissions("tenancy.subscription.manage")
  @HttpCode(HttpStatus.OK)
  async completeCheckout(
    @Req() request: Request,
    @Param("ref") ref: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    requireIdentity(request);
    const input = completeCheckoutSchema.parse(body ?? {});
    const outcome = await this.subscriptions.completeCheckout({
      sessionRef: ref,
      outcome: input.outcome,
    });
    return envelope(outcome);
  }

  @Get("usage")
  @RequirePermissions("tenancy.subscription.manage")
  async usageSnapshot(): Promise<unknown> {
    // Freshness point: reading usage also (re)evaluates the §6 soft
    // warnings — deduped once per (counter, period, threshold).
    const snapshot = await this.usage.snapshotForOwner();
    const warnings = await this.usage.evaluateLimitWarnings().catch(() => ({ warned: 0 }));
    return envelope({ ...snapshot, warningsEvaluated: warnings.warned });
  }

  // -- support sessions (tenant side, matrix §7 rules 5/6) --------------------

  @Get("support-sessions")
  @RequirePermissions("tenancy.settings.manage")
  async listSupportSessions(): Promise<unknown> {
    return envelope(await this.support.listForTenantPlane());
  }

  @Delete("support-sessions/:id")
  @RequirePermissions("tenancy.settings.manage")
  async terminateSupportSession(
    @Req() request: Request,
    @Param("id") sessionId: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    await this.support.terminateByTenant(identity.userId, sessionId);
    return envelope({ terminated: true });
  }
}
