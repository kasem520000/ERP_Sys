import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  closureViolations,
  isKnownFeatureKey,
  missingClosure,
  publishTenancyEvent,
} from "../../configuration/api";
import * as store from "../infrastructure/tenancy.store";
import * as billingStore from "../infrastructure/billing.store";
import type { EntitlementRow } from "../infrastructure/tenancy.store";
import {
  FeatureDependenciesMissingError,
  ManualGrantExpiryRequiredError,
  PlanClosureInvalidError,
  PlanNotFoundError,
  UnknownFeatureKeyError,
} from "../domain/tenancy-errors";

/**
 * Entitlements service (PHASE-004 §2.5/T7; SUBSCRIPTION_AND_ENTITLEMENTS
 * §4/§9; BR-039/BR-040): plan → materialized `entitlements` rows, manual
 * overrides with precedence, expiry discipline, dependency-closure
 * validation at apply time, and the derived-only UI payload. Enforcement
 * itself is the `@RequireFeature` guard (server-side, module load + per
 * action) — this service is the single resolution source it reads.
 *
 * Precedence: MANUAL overrides win while active (never overwritten by
 * re-materialization); TRIAL/PROMO carry expiry and drop on elapse;
 * PLAN-sourced rows refresh transactionally with the subscription record.
 */

export type EntitlementSource = "PLAN" | "MANUAL" | "PROMO" | "TRIAL";

export interface GrantInput {
  featureKey: string;
  source: Extract<EntitlementSource, "MANUAL" | "PROMO" | "TRIAL">;
  expiresAt: string | null;
  reason: string;
}

@Injectable()
export class EntitlementsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Materialize a plan's keys for the current tenant (subscription row first). */
  async assignPlan(
    actorId: string | null,
    input: { planKey: string; source: EntitlementSource; expiresAt: string | null },
  ): Promise<{ planKey: string; grantedKeys: number; expiresAt: string | null }> {
    const plan = await store.findPlanByKey(input.planKey);
    if (plan === undefined) {
      throw new PlanNotFoundError(input.planKey);
    }
    // BR-040 at apply time: the plan's own key set must satisfy closure.
    const violations = closureViolations(plan.featureKeys);
    if (violations.length > 0) {
      throw new PlanClosureInvalidError(plan.key, violations);
    }

    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = input.expiresAt !== null ? input.expiresAt.slice(0, 10) : "2999-12-31";
    await store.supersedeSubscriptions();
    await store.insertSubscription({
      planId: plan.id,
      periodStart,
      periodEnd,
      providerRef: null,
    });
    await store.deleteExpiredEntitlements();
    for (const featureKey of plan.featureKeys) {
      await store.upsertPlanEntitlement({ featureKey, expiresAt: input.expiresAt });
    }
    // Stale subscription-derived grants from the replaced plan drop so the
    // materialized set is exactly plan ∪ active overrides (§4: never
    // mid-state; §9: MANUAL/PROMO overrides survive).
    await store.deleteStalePlanEntitlements(plan.featureKeys);
    const tenant = await store.getOwnTenant();
    await this.audit.record({
      action: "plan.assigned",
      entityType: "tenant",
      entityId: tenant.id,
      actorId: actorId ?? undefined,
      viaPlatformAdmin: true,
      after: {
        plan: plan.key,
        source: input.source,
        keys: plan.featureKeys.length,
      },
    });
    publishTenancyEvent({ type: "plan.changed", tenantId: tenant.id, planKey: plan.key });
    for (const key of plan.featureKeys) {
      publishTenancyEvent({
        type: "entitlements.changed",
        tenantId: tenant.id,
        featureKey: key,
        change: "granted",
      });
    }
    return { planKey: plan.key, grantedKeys: plan.featureKeys.length, expiresAt: input.expiresAt };
  }

  /** Manual/promo/trial grant with closure validation (BR-040) + audit. */
  async grant(actorId: string, input: GrantInput): Promise<EntitlementRow> {
    if (!isKnownFeatureKey(input.featureKey)) {
      throw new UnknownFeatureKeyError(input.featureKey);
    }
    // §9 mandatory discipline: overrides MUST expire (renew deliberately).
    if (input.source === "MANUAL" && (input.expiresAt === null || input.expiresAt === "")) {
      throw new ManualGrantExpiryRequiredError();
    }
    const active = await store.listActiveEntitlements();
    const activeKeys = new Set(active.map((row) => row.featureKey));
    const missing = missingClosure(input.featureKey, activeKeys);
    if (missing.length > 0) {
      throw new FeatureDependenciesMissingError(input.featureKey, missing);
    }
    const row = await store.insertEntitlement({
      featureKey: input.featureKey,
      source: input.source,
      expiresAt: input.expiresAt,
    });
    const tenant = await store.getOwnTenant();
    await this.audit.record({
      action: "entitlement.granted",
      entityType: "tenant",
      entityId: tenant.id,
      actorId,
      viaPlatformAdmin: true,
      before: active.some((r) => r.featureKey === input.featureKey)
        ? { existed: true }
        : undefined,
      after: {
        feature_key: input.featureKey,
        source: input.source,
        expires_at: input.expiresAt,
        reason: input.reason,
      },
    });
    publishTenancyEvent({
      type: "entitlements.changed",
      tenantId: tenant.id,
      featureKey: input.featureKey,
      change: "granted",
    });
    return row;
  }

  /** Revoke a grant (manual rows vanish; plan rows return on re-materialization — durable negative overrides land with the PHASE-014 billing pass, recorded in the completion report). */
  async revoke(
    actorId: string,
    featureKey: string,
    reason: string,
  ): Promise<void> {
    const before = await store.findEntitlement(featureKey);
    await store.deleteEntitlement(featureKey);
    const tenant = await store.getOwnTenant();
    await this.audit.record({
      action: "entitlement.revoked",
      entityType: "tenant",
      entityId: tenant.id,
      actorId,
      viaPlatformAdmin: true,
      before: before === undefined ? undefined : { source: before.source },
      after: { feature_key: featureKey, reason },
    });
    publishTenancyEvent({
      type: "entitlements.changed",
      tenantId: tenant.id,
      featureKey,
      change: "revoked",
    });
  }

  /**
   * BR-39 derived-only UI payload: the active key list for the tenant —
   * visibility hint, never a source of truth (the server re-checks every
   * action through @RequireFeature). PHASE-014 adds the subscription state
   * projection (read-only banner input; the server enforces, the client
   * renders the product-state banner honestly).
   */
  async derivedVisibilityPayload(): Promise<{
    featureKeys: string[];
    sources: { featureKey: string; source: string; expiresAt: string | null }[];
    subscription:
      | {
          status: string;
          readOnly: boolean;
          graceEndsAt: string | null;
          trialEndsAt: string | null;
          periodEnd: string | null;
        }
      | null;
  }> {
    const rows = await store.listActiveEntitlements();
    const subscription = await billingStore.currentSubscriptionRow().catch(() => undefined);
    return {
      featureKeys: rows.map((row) => row.featureKey),
      sources: rows.map((row) => ({
        featureKey: row.featureKey,
        source: row.source,
        expiresAt: row.expiresAt,
      })),
      subscription:
        subscription === undefined
          ? null
          : {
              status: subscription.status,
              readOnly: subscription.status === "GRACE_READ_ONLY",
              graceEndsAt: subscription.graceEndsAt,
              trialEndsAt: subscription.trialEndsAt,
              periodEnd: subscription.periodEnd,
            },
    };
  }
}
