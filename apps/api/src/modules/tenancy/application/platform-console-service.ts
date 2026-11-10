import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import {
  AuditService,
  type AuditEventRow,
  type PlatformAuditQuery,
} from "../../audit/api/audit";
import { NotFoundError } from "../../identity/api/identity";
import { listTenantMembers } from "../../identity/api/identity";
import { withPlatformScope, withTenantOnTx } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/tenancy.store";
import { PLATFORM_TENANT_ID } from "./lifecycle-service";
import { EntitlementsService } from "./entitlements-service";

/**
 * Platform admin console service (PHASE-004 §2.7/T10): the PlatformScope
 * cross-tenant reads — tenant list/search, tenant detail (profile, plan,
 * entitlements, branches, memberships), the cross-tenant audit viewer, and
 * manual plan assignment. Every use is audited with via_platform_admin
 * (matrix §3.10: per-use audit on platform-scope reads); per-operation
 * tenant scoping (ADR-0005) enters the TARGET tenant's scope on the same
 * console UoW — never a blanket tenant GUC.
 */

export interface ConsoleTenantSummary {
  id: string;
  name: string;
  nameAr: string | null;
  status: string;
  countryCode: string;
  baseCurrency: string;
  industryTemplateKey: string | null;
  createdAt: string;
  isPlatformTenant: boolean;
}

export interface ConsoleTenantDetail extends ConsoleTenantSummary {
  subscription: store.SubscriptionRow | null;
  plan: { key: string; name: string; nameAr: string } | null;
  entitlements: store.EntitlementRow[];
  branches: store.BranchRow[];
  memberships: {
    membershipId: string;
    userId: string;
    email: string;
    fullName: string;
    roleKey: string;
    membershipStatus: string;
  }[];
}

@Injectable()
export class PlatformConsoleService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  /** List + search (cursor-paginated, statement-timeout budgeted by RLS role). */
  async listTenants(
    actorId: string,
    input: { query?: string; cursor?: { createdAt: string; id: string }; limit?: number },
  ): Promise<{ rows: ConsoleTenantSummary[]; hasMore: boolean; nextCursor?: string }> {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    return withPlatformScope(async () => {
      const tenants = await store.platformListTenants({
        query: input.query,
        cursor: input.cursor,
        limit: limit + 1,
      });
      const hasMore = tenants.length > limit;
      const page = tenants.slice(0, limit);
      await this.audit.recordPlatform({
        action: "platform.console.tenants_listed",
        entityType: "tenant",
        entityId: PLATFORM_TENANT_ID,
        actorId,
        after: { query: input.query ?? null, count: page.length },
      });
      const rows = page.map(toSummary);
      const nextCursor =
        hasMore && page.length > 0
          ? JSON.stringify({ createdAt: page[page.length - 1]!.createdAt, id: page[page.length - 1]!.id })
          : undefined;
      return { rows, hasMore, nextCursor };
    });
  }

  /** Tenant detail — per-operation scoping into the target tenant. */
  async tenantDetail(actorId: string, tenantId: string): Promise<ConsoleTenantDetail> {
    return withPlatformScope(async (tx) => {
      const tenant = await store.platformGetTenant(tenantId);
      if (tenant === undefined) {
        throw new NotFoundError(`tenant ${tenantId}`);
      }
      const detail = await withTenantOnTx(tenantId, tx, async () => {
        const subscription = await store.currentSubscription();
        let plan: ConsoleTenantDetail["plan"] = null;
        if (subscription !== undefined) {
          const planRow = await store.findPlanById(subscription.planId);
          if (planRow !== undefined) {
            plan = { key: planRow.key, name: planRow.name, nameAr: planRow.nameAr };
          }
        }
        const [entitlements, branches, memberships] = await Promise.all([
          store.listEntitlements(),
          store.listBranches(null),
          listTenantMembers(),
        ]);
        return { subscription: subscription ?? null, plan, entitlements, branches, memberships };
      });
      await this.audit.recordPlatform({
        action: "platform.console.tenant_viewed",
        entityType: "tenant",
        entityId: tenantId,
        actorId,
        after: { target: tenantId },
      });
      return { ...toSummary(tenant), ...detail };
    });
  }

  /** Cross-tenant platform audit review (platform.audit.view). */
  async auditEvents(actorId: string, query: PlatformAuditQuery): Promise<{
    rows: AuditEventRow[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    return withPlatformScope(async () => {
      const rows = await this.audit.listPlatform({ ...query, limit: limit + 1 });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      await this.audit.recordPlatform({
        action: "platform.console.audit_viewed",
        entityType: "audit_events",
        entityId: PLATFORM_TENANT_ID,
        actorId,
        after: { filters: { tenantId: query.tenantId ?? null, action: query.action ?? null } },
      });
      const nextCursor =
        hasMore && page.length > 0
          ? JSON.stringify({ at: page[page.length - 1]!.at, id: page[page.length - 1]!.id })
          : undefined;
      return { rows: page, hasMore, nextCursor };
    });
  }

  /**
   * PHASE-024 T4 (ADR-0015 §4): the plan-level MFA policy lever
   * (platform.plans.manage). Rewrites plans.mfa_required_role_keys under
   * the platform scope and audits the change as a platform event — the
   * enforcement itself lives in the login flow (tenants may override via
   * the `identity.mfa.policy` tenant setting).
   */
  async setPlanMfaPolicy(
    actorId: string,
    planKey: string,
    requiredRoleKeys: readonly string[],
  ): Promise<{ planKey: string; requiredRoleKeys: string[] }> {
    return withPlatformScope(async (tx) => {
      const plan = await store.findPlanByKey(planKey);
      if (plan === undefined) {
        throw new NotFoundError("plan");
      }
      const deduped = [...new Set(requiredRoleKeys)];
      await tx.execute(
        sql`UPDATE plans SET mfa_required_role_keys = ${deduped}, updated_at = now()
            WHERE key = ${planKey}`,
      );
      await this.audit.recordPlatform({
        action: "plan.mfa_policy_updated",
        entityType: "plan",
        entityId: plan.id,
        actorId,
        before: { required_role_keys: plan.mfaRequiredRoleKeys ?? [] },
        after: { required_role_keys: deduped },
      });
      return { planKey, requiredRoleKeys: deduped };
    });
  }

  /** Manual plan assignment (platform.subscriptions.manage; audited dual). */
  async assignPlan(
    actorId: string,
    tenantId: string,
    input: { planKey: string; trialDays?: number },
  ): Promise<{ planKey: string; grantedKeys: number }> {
    const source = input.trialDays !== undefined && input.trialDays > 0 ? "TRIAL" : "PLAN";
    const expiresAt =
      source === "TRIAL"
        ? new Date(Date.now() + input.trialDays! * 24 * 60 * 60 * 1000).toISOString()
        : null;
    const result = await withPlatformScope(async (tx) => {
      const tenant = await store.platformGetTenant(tenantId);
      if (tenant === undefined) {
        throw new NotFoundError(`tenant ${tenantId}`);
      }
      await this.audit.recordPlatform({
        action: "plan.assigned",
        entityType: "tenant",
        entityId: tenantId,
        actorId,
        after: { plan: input.planKey, source },
      });
      return withTenantOnTx(tenantId, tx, async () => {
        const assigned = await this.entitlements.assignPlan(actorId, {
          planKey: input.planKey,
          source,
          expiresAt,
        });
        return { planKey: assigned.planKey, grantedKeys: assigned.grantedKeys };
      });
    });
    return result;
  }
}

function toSummary(tenant: store.TenantProfileRow): ConsoleTenantSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    nameAr: tenant.nameAr,
    status: tenant.status,
    countryCode: tenant.countryCode,
    baseCurrency: tenant.baseCurrency,
    industryTemplateKey: tenant.industryTemplateKey,
    createdAt: tenant.createdAt,
    isPlatformTenant: tenant.id === PLATFORM_TENANT_ID,
  };
}
