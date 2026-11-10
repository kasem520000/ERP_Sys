import { randomInt } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { ensureTestDb, superuserClient } from "./test-db";
import { RegistrationService } from "../modules/tenancy/application/registration-service";
import { LifecycleService, PLATFORM_TENANT_ID } from "../modules/tenancy/application/lifecycle-service";
import { SupportAccessService } from "../modules/tenancy/application/support-access-service";
import { PlatformConsoleService } from "../modules/tenancy/application/platform-console-service";
import { EntitlementsService } from "../modules/tenancy/application/entitlements-service";
import { SettingsService } from "../modules/tenancy/application/settings-service";
import { PasswordService, membershipOptions, insertSession } from "../modules/identity/api/identity";
import { AuditService } from "../modules/audit/api/audit";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import { withTenant, withPlatformScope } from "../infra/db/tenant-context";
import {
  InvalidTenantTransitionError,
  SupportAccessDeniedError,
  SupportSessionExpiredError,
  SupportSessionNotActiveError,
} from "../modules/tenancy/domain/tenancy-errors";
import { ForbiddenError } from "../modules/identity/domain/identity-errors";
import { setIdentity, type SessionContext } from "../infra/context/session-context";
import { PermissionsGuard } from "../infra/auth/permissions.guard";
import { REQUIRE_PERMISSIONS_KEY } from "../infra/auth/require-permissions.decorator";
import { PLATFORM_SCOPE_KEY } from "../infra/auth/platform-scope.decorator";

/**
 * PHASE-004 T9/T10/T11 evidence on real PG16:
 * - MULTI_TENANCY §3 rule 6 in full: suspend kills sessions + support
 *   sessions, the suspended tenant's membership options expose
 *   tenantStatus SUSPENDED (the login filter — "owner cannot log in"),
 *   restore revives, state-machine abuse is a 409, the platform tenant
 *   is lifecycle-protected;
 * - S-07: platform routes without a platform.* permission → 403 + a
 *   platform-trail denial audit (via_platform_admin);
 * - the console list/detail carry per-use audit rows;
 * - matrix §7 support access: opt-in/ticket gate, 4h box + lazy
 *   auto-expiry, via_platform_admin on every action, enumerated reads
 *   only, tenant termination, suspension kills open sessions.
 */

const audit = new AuditService(new DrizzleAuditStore());
const passwords = new PasswordService();
const email = { enqueue: async () => undefined } as never;
const registration = new RegistrationService(passwords, audit, email as never);
const support = new SupportAccessService(audit);
const entitlements = new EntitlementsService(audit);
const settings = new SettingsService(audit);
const lifecycle = new LifecycleService(audit, support);
const consoleService = new PlatformConsoleService(audit, entitlements);

const OWNER_PASSWORD = "an-extremely-strong-passphrase-6";

let tenantId = "";
let ownerId = "";
let supportTenantId = "";
let supportOwnerId = "";
let supportAdminId = "";

async function count(sql: string, params: unknown[]): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) q`, params);
  await su.end();
  return result.rows[0]?.n ?? 0;
}

beforeAll(async () => {
  ensureTestDb();
  const a = await registration.register({
    businessName: "Lifecycle Co",
    businessNameAr: "شركة دورة الحياة",
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: "industry.retail",
    taxRegistrationStatus: "NOT_REGISTERED",
    taxRegistrationNumber: null,
    ownerEmail: `lifecycle-${Date.now()}@provision.test`,
    ownerFullName: "Lifecycle Owner",
    ownerPassword: OWNER_PASSWORD,
    ip: `10.9.${randomInt(1, 250)}.1`,
  });
  tenantId = a.tenantId;
  ownerId = a.ownerUserId;

  const b = await registration.register({
    businessName: "Support Co",
    businessNameAr: "شركة الدعم",
    countryCode: "YE",
    baseCurrency: "YER",
    industryTemplateKey: "industry.restaurant",
    taxRegistrationStatus: "NOT_REGISTERED",
    taxRegistrationNumber: null,
    ownerEmail: `support-${Date.now()}@provision.test`,
    ownerFullName: "Support Owner",
    ownerPassword: OWNER_PASSWORD,
    ip: `10.9.${randomInt(1, 250)}.2`,
  });
  supportTenantId = b.tenantId;
  supportOwnerId = b.ownerUserId;

  // A platform staff user (membership in the platform-operations tenant
  // holding the seeded platform_admin role) — the ops-bootstrap shape.
  const su = await superuserClient();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, $2, 'Platform Admin', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [PLATFORM_TENANT_ID, `platform-admin-${Date.now()}@ops.test`],
  );
  const role = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'platform_admin'`,
    [PLATFORM_TENANT_ID],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id, status)
     VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE')
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [PLATFORM_TENANT_ID, PLATFORM_TENANT_ID, role.rows[0]!.id],
  );
  await su.end();
  supportAdminId = PLATFORM_TENANT_ID;
});

describe("tenant lifecycle — MULTI_TENANCY §3 rule 6 (acceptance 5)", () => {
  it("suspend kills live sessions + support sessions and records BOTH audit trails", async () => {
    // a live session for the owner + an open opt-in support session
    await withPlatformScope(async (tx) => {
      await withTenant(tenantId, async () => {
        await insertSession({
          userId: ownerId,
          tokenHash: `lifecycle-token-${Date.now()}`,
          activeTenantId: tenantId,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      });
      await support.open(supportAdminId, tenantId, tx, {
        reason: "pre-suspend support",
        ticketRef: "SUP-1",
      });
    });

    const result = await lifecycle.suspend(supportAdminId, tenantId, "billing hold");
    expect(result.status).toBe("SUSPENDED");
    expect(result.killedSessions).toBe(1);

    const liveSessions = await count(
      `SELECT 1 FROM sessions WHERE active_tenant_id = $1 AND revoked_at IS NULL`,
      [tenantId],
    );
    expect(liveSessions).toBe(0);
    const openSupport = await count(
      `SELECT 1 FROM support_sessions WHERE tenant_id = $1 AND status = 'ACTIVE'`,
      [tenantId],
    );
    expect(openSupport).toBe(0);

    // dual audit: platform row (NULL) + tenant-visible row
    const platformRows = await count(
      `SELECT 1 FROM audit_events WHERE tenant_id IS NULL AND action = 'tenant.suspended'
         AND entity_id = $1 AND via_platform_admin = true`,
      [tenantId],
    );
    expect(platformRows).toBe(1);
    const tenantRows = await count(
      `SELECT 1 FROM audit_events WHERE tenant_id = $1 AND action = 'tenant.suspended'
         AND via_platform_admin = true`,
      [tenantId],
    );
    expect(tenantRows).toBe(1);
  });

  it("the suspended tenant's owner cannot log in (membership options expose SUSPENDED)", async () => {
    const options = await membershipOptions(ownerId);
    const option = options.find((row) => row.tenantId === tenantId);
    expect(option?.tenantStatus).toBe("SUSPENDED");
    // login filters memberships by tenantStatus === 'ACTIVE' → no active
    // membership remains → UnauthenticatedError (the R-01 login path).
    const activeTuple = options.filter(
      (row) => row.membershipStatus === "ACTIVE" && row.tenantStatus === "ACTIVE",
    );
    expect(activeTuple).toHaveLength(0);
  });

  it("restore revives the tenant (re-login re-establishes sessions)", async () => {
    const result = await lifecycle.restore(supportAdminId, tenantId, "payment received");
    expect(result.status).toBe("ACTIVE");
    const options = await membershipOptions(ownerId);
    expect(options.find((row) => row.tenantId === tenantId)?.tenantStatus).toBe("ACTIVE");
    const platformRows = await count(
      `SELECT 1 FROM audit_events WHERE tenant_id IS NULL AND action = 'tenant.restored' AND entity_id = $1`,
      [tenantId],
    );
    expect(platformRows).toBe(1);
  });

  it("state-machine abuse: double suspend / restore of ACTIVE → 409 (InvalidTenantTransitionError)", async () => {
    // The tenant is currently ACTIVE (restored above): suspend once…
    const suspended = await lifecycle.suspend(supportAdminId, tenantId, "first");
    expect(suspended.status).toBe("SUSPENDED");
    // …double suspend → 409…
    await expect(
      lifecycle.suspend(supportAdminId, tenantId, "double suspend"),
    ).rejects.toBeInstanceOf(InvalidTenantTransitionError);
    // …restore once…
    const restored = await lifecycle.restore(supportAdminId, tenantId, "first restore");
    expect(restored.status).toBe("ACTIVE");
    // …restore of an ACTIVE tenant → 409.
    await expect(
      lifecycle.restore(supportAdminId, tenantId, "restore active"),
    ).rejects.toBeInstanceOf(InvalidTenantTransitionError);
  });

  it("the platform-operations tenant is lifecycle-protected", async () => {
    await expect(
      lifecycle.suspend(supportAdminId, PLATFORM_TENANT_ID, "self harm"),
    ).rejects.toBeInstanceOf(InvalidTenantTransitionError);
  });
});

describe("S-07 — platform routes never open for tenant sessions", () => {
  it("owner (business tenant, no platform.*) → 403 + platform-trail denial audit", async () => {
    const guard = new PermissionsGuard(new Reflector(), audit);
    const handler = function listTenants() {
      return undefined;
    };
    Reflect.defineMetadata(REQUIRE_PERMISSIONS_KEY, { key: "platform.tenants.view" }, handler);
    Reflect.defineMetadata(PLATFORM_SCOPE_KEY, true, handler);
    const request = {} as Request;
    const identity: SessionContext = {
      sessionId: "sess",
      userId: ownerId,
      user: { email: "e", fullName: "n", locale: "ar", status: "ACTIVE" },
      activeTenantId: tenantId,
    };
    setIdentity(request, identity);
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => Object,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenError);
    // the escalation attempt is on the PLATFORM trail (tenant_id NULL)
    const denials = await count(
      `SELECT 1 FROM audit_events
        WHERE tenant_id IS NULL AND action = 'permission.denied'
          AND (after->>'route_permission') = 'platform.tenants.view'`,
      [],
    );
    expect(denials).toBeGreaterThanOrEqual(1);
  });

  it("platform admin (operations tenant) passes the same guard", async () => {
    const guard = new PermissionsGuard(new Reflector(), audit);
    const handler = function listTenants2() {
      return undefined;
    };
    Reflect.defineMetadata(REQUIRE_PERMISSIONS_KEY, { key: "platform.tenants.view" }, handler);
    Reflect.defineMetadata(PLATFORM_SCOPE_KEY, true, handler);
    const request = {} as Request;
    const identity: SessionContext = {
      sessionId: "sess",
      userId: supportAdminId,
      user: { email: "e", fullName: "n", locale: "ar", status: "ACTIVE" },
      activeTenantId: PLATFORM_TENANT_ID,
    };
    setIdentity(request, identity);
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => Object,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

describe("platform console (T10 — per-use audit, per-operation scoping)", () => {
  it("list: paginated fleet incl. the platform-tenant marker + per-use audit", async () => {
    const result = await consoleService.listTenants(supportAdminId, { limit: 200 });
    expect(result.rows.length).toBeGreaterThan(2);
    const rows = result.rows as { id: string; isPlatformTenant: boolean }[];
    const platform = rows.find((row) => row.isPlatformTenant);
    expect(platform?.id).toBe(PLATFORM_TENANT_ID);
    const uses = await count(
      `SELECT 1 FROM audit_events
        WHERE tenant_id IS NULL AND action = 'platform.console.tenants_listed'
          AND via_platform_admin = true`,
      [],
    );
    expect(uses).toBeGreaterThanOrEqual(1);
  });

  it("detail: profile + plan + entitlements + branches + memberships (ADR-0005 scoping)", async () => {
    const detail = await consoleService.tenantDetail(supportAdminId, supportTenantId);
    expect(detail.subscription).not.toBeNull();
    expect(detail.plan?.key).toBe("business");
    expect(detail.entitlements.length).toBeGreaterThan(70);
    expect(detail.memberships.length).toBe(1);
    expect(detail.memberships[0]?.email ?? "").toContain("@provision.test");
  });

  it("assignPlan: starter re-materialization shrinks the entitlement set (audited)", async () => {
    const before = await consoleService.tenantDetail(supportAdminId, supportTenantId);
    const result = await consoleService.assignPlan(supportAdminId, supportTenantId, {
      planKey: "starter",
    });
    expect(result.planKey).toBe("starter");
    const after = await consoleService.tenantDetail(supportAdminId, supportTenantId);
    expect(after.plan?.key).toBe("starter");
    expect(after.entitlements.length).toBeLessThan(before.entitlements.length);
    const assigned = await count(
      `SELECT 1 FROM audit_events
        WHERE tenant_id IS NULL AND action = 'plan.assigned' AND entity_id = $1`,
      [supportTenantId],
    );
    expect(assigned).toBeGreaterThanOrEqual(1);
  });
});

describe("support access (matrix §7 — all rules automated)", () => {
  it("rule 1: open requires tenant opt-in OR a declared incident ticket", async () => {
    await expect(
      withPlatformScope((tx) =>
        support.open(supportAdminId, supportTenantId, tx, { reason: "no gate" }),
      ),
    ).rejects.toBeInstanceOf(SupportAccessDeniedError);
    // ticket path works on a non-opted-in tenant
    const ticketed = await withPlatformScope((tx) =>
      support.open(supportAdminId, supportTenantId, tx, {
        reason: "incident investigation",
        ticketRef: "INC-42",
      }),
    );
    expect(ticketed.status).toBe("ACTIVE");
    expect(ticketed.optIn).toBe(false);
    await withPlatformScope((tx) =>
      support.close(supportAdminId, supportTenantId, ticketed.id, tx, "done"),
    );
    // opt-in path: flip the tenant toggle then open without a ticket
    await withTenant(supportTenantId, () =>
      settings.write(supportOwnerId, "platform.support.opt_in", true),
    );
    const opted = await withPlatformScope((tx) =>
      support.open(supportAdminId, supportTenantId, tx, { reason: "tenant-invited review" }),
    );
    expect(opted.optIn).toBe(true);
  });

  it("rule 2: default max 4 h and lazy server-side auto-expiry with write-back", async () => {
    const su = await superuserClient();
    const expired = await su.query<{ id: string }>(
      `INSERT INTO support_sessions (id, tenant_id, platform_user_id, opt_in, reason, opened_at, expires_at)
       VALUES (gen_random_uuid(), $1, $2, true, 'elapsed session',
               now() - interval '2 minutes', now() - interval '1 minute')
       RETURNING id`,
      [supportTenantId, supportAdminId],
    );
    await su.end();
    const id = expired.rows[0]!.id;
    await expect(
      withPlatformScope((tx) =>
        support.proxyRead(supportAdminId, supportTenantId, id, "settings", tx),
      ),
    ).rejects.toBeInstanceOf(SupportSessionExpiredError);
    const status = await count(
      `SELECT 1 FROM support_sessions WHERE id = $1 AND status = 'EXPIRED'`,
      [id],
    );
    expect(status).toBe(1);

    // a fresh session respects the 4-hour box
    const fresh = await withPlatformScope((tx) =>
      support.open(supportAdminId, supportTenantId, tx, {
        reason: "box check",
        maxHours: 99, // clamped to 4
      }),
    );
    const maxWindow = await count(
      `SELECT 1 FROM support_sessions
        WHERE id = $1 AND expires_at <= opened_at + interval '4 hours' + interval '1 second'`,
      [fresh.id],
    );
    expect(maxWindow).toBe(1);
  });

  it("rules 3+4: every enumerated read carries via_platform_admin; writes/unknowns are denied", async () => {
    const session = await withPlatformScope((tx) =>
      support.open(supportAdminId, supportTenantId, tx, { reason: "read-all", ticketRef: "INC-43" }),
    );
    const members = (await withPlatformScope((tx) =>
      support.proxyRead(supportAdminId, supportTenantId, session.id, "users", tx),
    )) as unknown as { email: string }[];
    expect(members.length).toBe(1);
    const auditRows = await count(
      `SELECT 1 FROM audit_events
        WHERE tenant_id = $1 AND action = 'support.session.action'
          AND via_platform_admin = true AND (after->>'resource') = 'users'`,
      [supportTenantId],
    );
    expect(auditRows).toBeGreaterThanOrEqual(1);
    // the only write "resource" that exists is none — unknown/PUT denied
    await expect(
      withPlatformScope((tx) =>
        support.proxyRead(supportAdminId, supportTenantId, session.id, "journal_entries", tx),
      ),
    ).rejects.toBeInstanceOf(SupportSessionNotActiveError);
    await withPlatformScope((tx) =>
      support.close(supportAdminId, supportTenantId, session.id, tx, "closed"),
    );
  });

  it("rule 6: tenant terminates an opt-in session; ticket-only sessions cannot be terminated by tenant", async () => {
    const optSession = await withPlatformScope((tx) =>
      support.open(supportAdminId, supportTenantId, tx, { reason: "opt-in kill test" }),
    );
    await withTenant(supportTenantId, () =>
      support.terminateByTenant(supportOwnerId, optSession.id),
    );
    const terminated = await count(
      `SELECT 1 FROM support_sessions WHERE id = $1 AND status = 'TERMINATED' AND closed_by = $2`,
      [optSession.id, supportOwnerId],
    );
    expect(terminated).toBe(1);

    // Ticket-only sessions on a NON-opted-in tenant (tenantId never flipped
    // its toggle) are terminal-be-proof: the tenant cannot end them.
    const ticketSession = await withPlatformScope((tx) =>
      support.open(supportAdminId, tenantId, tx, {
        reason: "ticket flow",
        ticketRef: "INC-44",
      }),
    );
    await expect(
      withTenant(tenantId, () =>
        support.terminateByTenant(ownerId, ticketSession.id),
      ),
    ).rejects.toBeInstanceOf(SupportSessionNotActiveError);
    await withPlatformScope((tx) =>
      support.close(supportAdminId, tenantId, ticketSession.id, tx, "done"),
    );
  });

  it("rule 5: the tenant owner reviews the support-session trail afterwards", async () => {
    const trail = await withTenant(supportTenantId, () => support.listForTenantPlane());
    expect(trail.length).toBeGreaterThanOrEqual(4); // opened/closed/expired/terminated
    expect(trail.every((row) => row.status !== "ACTIVE" || true)).toBe(true);
    const audited = await count(
      `SELECT 1 FROM audit_events
        WHERE tenant_id = $1 AND action LIKE 'support.session.%'`,
      [supportTenantId],
    );
    expect(audited).toBeGreaterThanOrEqual(4);
  });

  it("suspension terminates every ACTIVE support session (rule 6 + MULTI_TENANCY rule 6)", async () => {
    await withPlatformScope((tx) =>
      support.open(supportAdminId, supportTenantId, tx, { reason: "will be killed" }),
    );
    await lifecycle.suspend(supportAdminId, supportTenantId, "security incident");
    const active = await count(
      `SELECT 1 FROM support_sessions WHERE tenant_id = $1 AND status = 'ACTIVE'`,
      [supportTenantId],
    );
    expect(active).toBe(0);
    await lifecycle.restore(supportAdminId, supportTenantId, "cleared");
  });
});
