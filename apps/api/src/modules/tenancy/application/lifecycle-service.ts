import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { publishTenancyEvent } from "../../configuration/api";
import { revokeSessionsForTenant } from "../../identity/api/identity";
import { withPlatformScope, withTenantOnTx } from "../../../infra/db/tenant-context";
import { childLogger } from "../../../infra/observability/logger";
import * as store from "../infrastructure/tenancy.store";
import { InvalidTenantTransitionError } from "../domain/tenancy-errors";
import { SupportAccessService } from "./support-access-service";

/**
 * Tenant lifecycle service (PHASE-004 §2.7/T9; MULTI_TENANCY §3 rule 6,
 * ADR-0015 session-kill, ADR-0008 event fan-out): platform-plane
 * suspend/restore with the FULL rule-6 semantics —
 *
 * - suspension kills every live session of the tenant (synchronous revoke
 *   in the SAME UoW; the login flow additionally refuses suspended
 *   tenants, and the interceptor's tenant-status check is the backstop
 *   that wins any register-vs-suspend race),
 * - pushes/pulls of a suspended tenant are rejected `tenant_suspended`
 *   (device endpoints arrive PHASE-020; the API-side semantics — dead
 *   sessions + 503 tenant_suspended — are what PHASE-004 proves),
 * - the admin console (platform plane) stays reachable for the suspended
 *   tenant — cross-tenant reads never depended on the tenant GUC,
 * - every transition is audited with actor + reason on BOTH trails
 *   (platform NULL-tenant row + tenant-visible row, §2.9).
 */

const log = childLogger({ module: "tenancy-lifecycle" });

/** Fixed platform-operations tenant id (migration 0006 seed). */
export const PLATFORM_TENANT_ID = "20000000-0000-4000-8000-000000000001";

@Injectable()
export class LifecycleService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SupportAccessService) private readonly supportAccess: SupportAccessService,
  ) {}

  async suspend(
    actorId: string,
    tenantId: string,
    reason: string,
  ): Promise<{ tenantId: string; status: string; killedSessions: number }> {
    this.assertNotPlatformTenant(tenantId, "suspend");
    const outcome = await withPlatformScope(async (tx) => {
      const tenant = await store.platformTransitionTenant(tenantId, "SUSPENDED", "ACTIVE");
      if (tenant === null) {
        const current = await store.platformGetTenant(tenantId);
        throw new InvalidTenantTransitionError(current?.status ?? "UNKNOWN", "suspend");
      }
      // Platform trail row (§2.9).
      await this.audit.recordPlatform({
        action: "tenant.suspended",
        entityType: "tenant",
        entityId: tenantId,
        actorId,
        after: { reason, status: "SUSPENDED" },
      });
      // Rule 6 session kill + support-session termination + tenant-visible
      // trail row on the SAME tx.
      const killedSessions = await revokeSessionsForTenant(tenantId, tx);
      const killedSupportSessions = await this.supportAccess.terminateAllActive(
        tenantId,
        tx,
        actorId,
        `tenant suspended: ${reason}`,
      );
      await withTenantOnTx(tenantId, tx, async () => {
        await this.audit.record({
          action: "tenant.suspended",
          entityType: "tenant",
          entityId: tenantId,
          actorId,
          viaPlatformAdmin: true,
          after: {
            reason,
            killed_sessions: killedSessions,
            killed_support_sessions: killedSupportSessions,
          },
        });
      });
      return { tenantId, status: tenant.status, killedSessions };
    });
    // ADR-0008 fan-out (in-process now; devices/sync consume from PHASE-020).
    publishTenancyEvent({ type: "tenant.suspended", tenantId, reason });
    log.warn({ tenant_id: tenantId, killed_sessions: outcome.killedSessions }, "tenant suspended");
    return outcome;
  }

  async restore(
    actorId: string,
    tenantId: string,
    reason: string,
  ): Promise<{ tenantId: string; status: string }> {
    this.assertNotPlatformTenant(tenantId, "restore");
    const outcome = await withPlatformScope(async (tx) => {
      const tenant = await store.platformTransitionTenant(tenantId, "ACTIVE", "SUSPENDED");
      if (tenant === null) {
        const current = await store.platformGetTenant(tenantId);
        throw new InvalidTenantTransitionError(current?.status ?? "UNKNOWN", "restore");
      }
      await this.audit.recordPlatform({
        action: "tenant.restored",
        entityType: "tenant",
        entityId: tenantId,
        actorId,
        after: { reason, status: "ACTIVE" },
      });
      // Sessions re-establish by re-login (no zombie revival — rule 6 lift).
      await withTenantOnTx(tenantId, tx, async () => {
        await this.audit.record({
          action: "tenant.restored",
          entityType: "tenant",
          entityId: tenantId,
          actorId,
          viaPlatformAdmin: true,
          after: { reason },
        });
      });
      return { tenantId, status: tenant.status };
    });
    publishTenancyEvent({ type: "tenant.restored", tenantId, reason });
    return outcome;
  }

  private assertNotPlatformTenant(tenantId: string, action: string): void {
    if (tenantId === PLATFORM_TENANT_ID) {
      throw new InvalidTenantTransitionError("PLATFORM_OPS", action);
    }
  }
}
