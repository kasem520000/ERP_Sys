import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { listTenantMembers, listTenantRoles, systemClock } from "../../identity/api/identity";
import {
  withPlatformScope,
  withTenant,
  withTenantOnTx,
  type TenantDb,
} from "../../../infra/db/tenant-context";
import { NotFoundError } from "../../identity/api/identity";
import * as store from "../infrastructure/tenancy.store";
import {
  SupportAccessDeniedError,
  SupportSessionExpiredError,
  SupportSessionNotActiveError,
} from "../domain/tenancy-errors";
import type { SupportSessionRow } from "../infrastructure/tenancy.store";

/**
 * Time-boxed audited support access (PHASE-004 §2.8/T11;
 * AUTHORIZATION_MATRIX §7, SECURITY_ARCHITECTURE support access):
 *
 * 1. open requires the platform.support.access permission (route guard) +
 *    a tenant opt-in (platform.support.opt_in) OR a declared incident
 *    ticket reference;
 * 2. default max 4 h (a single extension = a NEW session requiring
 *    re-approval), expiry re-checked server-side on EVERY action with an
 *    EXPIRED write-back (lazy auto-expiry);
 * 3. actions execute as the support user with via_platform_admin = true
 *    on every audit event — never as a fabricated tenant user;
 * 4. read-all + explicitly enumerated actions only: SUPPORT_READ_RESOURCES
 *    is the whitelist (risky tenant permissions stay with tenant users —
 *    there is no write path through a support session);
 * 5. session open/close + every proxied action audited; tenant owners
 *    review the trail afterwards;
 * 6. the tenant can terminate an opt-in session at any time; suspension
 *    terminates the rest (LifecycleService → terminateAllActive).
 *
 * Scoping: every console operation carries its TARGET tenant id from the
 * route and enters that tenant's scope per-operation (ADR-0005) — the
 * RLS-confined session row itself proves the (tenantId, sessionId) pair,
 * so cross-tenant id probing is a plain 404.
 */

const DEFAULT_MAX_HOURS = 4;
const MAX_HOURS = 4;

/** Enumerated read-all resource whitelist (§7 rule 4). */
export const SUPPORT_READ_RESOURCES = [
  "users",
  "memberships",
  "roles",
  "branches",
  "settings",
  "entitlements",
  "subscription",
  "accounts",
  "audit-events",
] as const;

export type SupportReadResource = (typeof SUPPORT_READ_RESOURCES)[number];

@Injectable()
export class SupportAccessService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Rules 1 + 2: open a session (opt-in or ticket; ≤ 4 h). */
  async open(
    actorId: string,
    tenantId: string,
    tx: TenantDb,
    input: { reason: string; ticketRef?: string; maxHours?: number },
  ): Promise<SupportSessionRow> {
    const now = systemClock.now();
    return withTenantOnTx(tenantId, tx, async () => {
      const optInRow = await store.findSetting("platform.support.opt_in");
      const optIn = optInRow?.value === true;
      const ticketRef = input.ticketRef?.trim() ?? null;
      if (!optIn && ticketRef === null) {
        throw new SupportAccessDeniedError();
      }
      const hours = Math.min(MAX_HOURS, Math.max(1, input.maxHours ?? DEFAULT_MAX_HOURS));
      const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
      const session = await store.insertSupportSession({
        platformUserId: actorId,
        optIn,
        ticketRef,
        reason: input.reason,
        expiresAt,
      });
      await this.audit.record({
        action: "support.session.opened",
        entityType: "support_session",
        entityId: session.id,
        actorId,
        viaPlatformAdmin: true,
        after: {
          ticket_ref: ticketRef,
          opt_in: optIn,
          expires_at: expiresAt,
          reason: input.reason,
        },
      });
      return session;
    });
  }

  /** Rule 5: platform-side close. */
  async close(
    actorId: string,
    tenantId: string,
    sessionId: string,
    tx: TenantDb,
    reason: string,
  ): Promise<void> {
    await withTenantOnTx(tenantId, tx, async () => {
      const session = await this.requireActive(sessionId);
      await store.transitionSupportSession(sessionId, "CLOSED", actorId);
      await this.audit.record({
        action: "support.session.closed",
        entityType: "support_session",
        entityId: sessionId,
        actorId,
        viaPlatformAdmin: true,
        after: { reason, ticket_ref: session.ticketRef },
      });
    });
  }

  /** Rule 6: tenant-side termination of an opt-in session (tenant plane). */
  async terminateByTenant(actorId: string, sessionId: string): Promise<void> {
    const session = await store.findSupportSession(sessionId);
    if (session === undefined) {
      throw new NotFoundError(`support_session ${sessionId}`);
    }
    if (session.status !== "ACTIVE") {
      throw new SupportSessionNotActiveError(session.status);
    }
    if (!session.optIn) {
      throw new SupportSessionNotActiveError("NOT_OPT_IN");
    }
    await store.transitionSupportSession(sessionId, "TERMINATED", actorId);
    await this.audit.record({
      action: "support.session.terminated",
      entityType: "support_session",
      entityId: sessionId,
      actorId,
      after: { by: "tenant", ticket_ref: session.ticketRef },
    });
  }

  /**
   * Rule 6 + MULTI_TENANCY rule 6: suspension terminates every ACTIVE
   * session of the tenant (called by the lifecycle service inside its UoW).
   */
  async terminateAllActive(
    tenantId: string,
    tx: TenantDb,
    actorId: string | null,
    reason: string,
  ): Promise<number> {
    return withTenantOnTx(tenantId, tx, async () => {
      const rows = await store.listSupportSessions();
      let killed = 0;
      for (const session of rows) {
        if (session.status !== "ACTIVE") {
          continue;
        }
        const closed = await store.transitionSupportSession(session.id, "TERMINATED", actorId);
        if (closed !== undefined) {
          killed += 1;
          await this.audit.record({
            action: "support.session.terminated",
            entityType: "support_session",
            entityId: session.id,
            actorId: actorId ?? undefined,
            viaPlatformAdmin: true,
            after: { by: "tenant.suspended", reason },
          });
        }
      }
      return killed;
    });
  }

  /** Rule 4: the enumerated read-all proxy (audited on every action). */
  async proxyRead(
    actorId: string,
    tenantId: string,
    sessionId: string,
    resource: string,
    tx: TenantDb,
  ): Promise<unknown> {
    if (!SUPPORT_READ_RESOURCES.includes(resource as SupportReadResource)) {
      throw new SupportSessionNotActiveError("UNKNOWN_RESOURCE");
    }
    return withTenantOnTx(tenantId, tx, async () => {
      await this.requireActive(sessionId);
      const data = await this.readResource(resource as SupportReadResource);
      await this.audit.record({
        action: "support.session.action",
        entityType: "support_session",
        entityId: sessionId,
        actorId,
        viaPlatformAdmin: true,
        after: { resource, via: "support-proxy" },
      });
      return data;
    });
  }

  /** Tenant review trail (§7 rule 5) — runs in the tenant-plane route. */
  async listForTenantPlane(): Promise<SupportSessionRow[]> {
    return store.listSupportSessions();
  }

  /** Console listing (platform plane, per-operation scoping). */
  /**
   * PHASE-024 T12 (matrix §7): the review report over a window — every
   * support session that opened (or was still live) inside [fromAt, toAt],
   * with its grant (who/when, opt-in or ticket), its end (closed/expired),
   * the count of proxied reads, and the EXPLICIT gap list:
   *   · expired-unclosed — status ACTIVE past expires_at (the lazy
   *     write-back should have caught it; a row here is a capture gap);
   *   · zero-action — a session that opened but never proxied a read
   *     (suspicious grant or honest no-op; reviewer decides);
   *   · orphaned-reads — proxied reads in the window whose session is not
   *     in the window's list (data drift by definition).
   */
  async reviewReport(input: {
    fromAt: string;
    toAt: string;
  }): Promise<{
    window: { fromAt: string; toAt: string };
    sessions: {
      id: string;
      tenantId: string;
      platformUserId: string;
      optIn: boolean;
      ticketRef: string | null;
      reason: string;
      openedAt: string;
      expiresAt: string;
      closedAt: string | null;
      status: string;
      proxiedReads: number;
    }[];
    gaps: { kind: "expired-unclosed" | "zero-action" | "orphaned-reads"; detail: string }[];
    fullyAudited: boolean;
  }> {
    // The session universe is discovered CROSS-TENANT from the
    // platform-widened audit trail (every open() is audited), then each
    // session row is fetched through its TARGET tenant's own scope —
    // support_sessions itself carries the STRICT macro (ADR-0005
    // per-operation scoping, never a blanket platform GUC).
    const index = await withPlatformScope(async () =>
      store.supportSessionWindowIndex(input.fromAt, input.toAt),
    );
    const byTenant = new Map<string, string[]>();
    for (const entry of index) {
      const list = byTenant.get(entry.tenantId) ?? [];
      list.push(entry.sessionId);
      byTenant.set(entry.tenantId, list);
    }
    const sessions: SupportSessionRow[] = [];
    for (const [tenantId, sessionIds] of byTenant) {
      const rows = await store.findSupportSessionsByIds(tenantId, sessionIds);
      sessions.push(...rows);
    }
    const readCounts = await withPlatformScope(async () =>
      store.supportActionCounts(input.fromAt, input.toAt),
    );
    {
      const sessionIds = new Set(sessions.map((row) => row.id));
      const countsById = new Map(readCounts.map((row) => [row.sessionId, row.count]));
      const orphaned = readCounts.filter((row) => !sessionIds.has(row.sessionId));
      const gaps: { kind: "expired-unclosed" | "zero-action" | "orphaned-reads"; detail: string }[] = [];
      const enriched = sessions.map((row) => {
        const proxiedReads = countsById.get(row.id) ?? 0;
        if (row.status === "ACTIVE" && Date.parse(row.expiresAt) < Date.now()) {
          gaps.push({ kind: "expired-unclosed", detail: `session ${row.id} past expires_at without close` });
        }
        if (proxiedReads === 0) {
          gaps.push({ kind: "zero-action", detail: `session ${row.id} proxied no reads` });
        }
        return {
          id: row.id,
          tenantId: row.tenantId,
          platformUserId: row.platformUserId,
          optIn: row.optIn,
          ticketRef: row.ticketRef,
          reason: row.reason,
          openedAt: row.openedAt,
          expiresAt: row.expiresAt,
          closedAt: row.closedAt,
          status: row.status,
          proxiedReads,
        };
      });
      for (const row of orphaned) {
        gaps.push({
          kind: "orphaned-reads",
          detail: `${row.count} proxied read(s) reference session ${row.sessionId} outside the window`,
        });
      }
      return {
        window: { fromAt: input.fromAt, toAt: input.toAt },
        sessions: enriched,
        gaps,
        fullyAudited: gaps.length === 0,
      };
    }
  }

  async listForConsole(tenantId: string, tx: TenantDb): Promise<SupportSessionRow[]> {
    return withTenantOnTx(tenantId, tx, () => store.listSupportSessions());
  }

  /** Rule 2: server-side expiry check on every action + EXPIRED write-back. */
  private async requireActive(sessionId: string): Promise<SupportSessionRow> {
    const session = await store.findSupportSession(sessionId);
    if (session === undefined) {
      throw new NotFoundError(`support_session ${sessionId}`);
    }
    if (session.status !== "ACTIVE") {
      throw new SupportSessionNotActiveError(session.status);
    }
    if (Date.parse(session.expiresAt) <= systemClock.now().getTime()) {
      // The EXPIRED marker is a fact about the clock, not about this
      // request — write it on its own UoW so the throwing request's
      // rollback cannot un-mark a session that HAS elapsed.
      await withTenant(session.tenantId, async () => {
        await store.transitionSupportSession(sessionId, "EXPIRED", null);
      });
      throw new SupportSessionExpiredError();
    }
    return session;
  }

  private async readResource(resource: SupportReadResource): Promise<unknown> {
    switch (resource) {
      case "users":
      case "memberships":
        return listTenantMembers();
      case "roles":
        return listTenantRoles();
      case "branches":
        return store.listBranches(null);
      case "settings":
        return store.listSettings();
      case "entitlements":
        return store.listEntitlements();
      case "subscription":
        return store.currentSubscription();
      case "accounts":
        return {
          accounts: await store.listAccounts(),
          purposes: await store.listAccountPurposes(),
        };
      case "audit-events":
        return (await this.audit.list({ limit: 100 })).map((row) => ({
          at: row.at,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          actorId: row.actorId,
          viaPlatformAdmin: row.viaPlatformAdmin,
        }));
      default: {
        const exhaustive: never = resource;
        throw new SupportSessionNotActiveError(String(exhaustive));
      }
    }
  }
}
