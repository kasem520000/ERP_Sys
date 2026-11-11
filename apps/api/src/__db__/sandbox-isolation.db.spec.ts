/**
 * PHASE-040 T-10/T-11 — the sandbox isolation evidence suite (§6
 * acceptance 9 / OA-05) on real PostgreSQL 16:
 *
 * - the platform-plane provisioning (SandboxService): a flagged, time-boxed,
 *   quota-capped SANDBOX tenant carrying the FULL demo seed, with a
 *   one-time owner credential returned once (hashed at rest);
 * - the owner logs in with it (the projection carries tenantKind SANDBOX,
 *   sandboxExpired false);
 * - the time box: an expired sandbox refuses login with the typed
 *   SandboxTenantExpiredError (the account survives — the user row stays
 *   ACTIVE) and the projection flips sandboxExpired for the interceptor
 *   (the per-request enforcement rides the same column);
 * - the invitation quota: ACTIVE memberships + open invitations cap at
 *   sandbox_max_users (typed SandboxUserQuotaExceededError);
 * - a SANDBOX tenant is NEVER a consolidation member (typed refusal);
 * - RLS: the sandbox's data is invisible to another tenant's session
 *   (the A-suite probe shape).
 */
import { randomInt } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { AppModule } from "../app.module";
import { withTenant, withPlatformScope } from "../infra/db/tenant-context";
import { closeDb } from "../infra/db/client";
import { stopBoss } from "../infra/jobs/boss";
import { RegistrationService, __resetRegistrationLimitersForTests } from "../modules/tenancy/application/registration-service";
import { SandboxService } from "../modules/onboarding/application/sandbox-service";
import { InvitationService } from "../modules/identity/application/invitation-service";
import { PasswordService } from "../modules/identity/application/password-service";
import { SessionService } from "../modules/identity/application/session-service";
import { AuditService } from "../modules/audit/api/audit";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import { LoginService } from "../modules/identity/application/login-service";
import { insertUser, membershipOptions } from "../modules/identity/infrastructure/identity.store";
import {
  SandboxTenantExpiredError,
  SandboxUserQuotaExceededError,
} from "../modules/identity/domain/identity-errors";
import { SandboxConsolidationMemberError } from "../modules/onboarding/domain/onboarding-errors";
import { GroupService } from "../modules/consolidation/application/group-service";
import * as tenancyStore from "../modules/tenancy/infrastructure/tenancy.store";

const OWNER_PASSWORD = "sandbox-owner-passphrase-7";

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let sandboxes: SandboxService;
let loginService: LoginService;
let groups: GroupService;
let registration: RegistrationService;

let normalTenantId = "";
let normalOwnerId = "";
let platformAdminId = "";
let sandboxTenantId = "";
let sandboxOwnerId = "";
let oneTimePassword = "";

beforeAll(async () => {
  ensureTestDb();
  __resetRegistrationLimitersForTests();
  reloadEnv();
  const created = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  app = created;
  await created.init();
  sandboxes = created.get(SandboxService);
  loginService = created.get(LoginService);
  groups = created.get(GroupService);
  registration = created.get(RegistrationService);

  // A NORMAL tenant (the consolidation-group parent + the RLS prober).
  const normal = await registration.register({
    businessName: "Consolidating Parent",
    businessNameAr: "الشركة الأم",
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: "industry.professional_services",
    taxRegistrationStatus: "NOT_REGISTERED",
    taxRegistrationNumber: null,
    ownerEmail: `parent-${Date.now()}@provision.test`,
    ownerFullName: "Parent Owner",
    ownerPassword: OWNER_PASSWORD,
    ip: `10.60.${randomInt(1, 250)}.1`,
  });
  normalTenantId = normal.tenantId;
  normalOwnerId = normal.ownerUserId;

  // A REAL platform operator (audit_events.actor_id is FK-bound to users —
  // the provisioning actor must exist, the platform-lifecycle pattern).
  const platformAdmin = await insertUser({
    email: `sbx-platform-${Date.now()}@provision.test`,
    fullName: "Platform Operator",
    passwordHash: await new PasswordService().hashFromNewPassword(OWNER_PASSWORD),
    locale: "en",
    status: "ACTIVE",
  });
  platformAdminId = platformAdmin.id;
}, 240_000);

afterAll(async () => {
  __resetRegistrationLimitersForTests();
  if (app !== undefined) {
    await app.close();
  }
  await stopBoss();
  await closeDb();
});

describe("acceptance 9 — sandbox provisioning & isolation (OA-05)", () => {
  it("provisions a time-boxed, quota-capped SANDBOX tenant with the full demo seed", { timeout: 180_000 }, async () => {
    const provisioned = (await sandboxes.provision(platformAdminId, {
      name: "Acme Demo",
      templateKey: "industry.retail",
      ownerEmail: `acme-demo-${Date.now()}@provision.test`,
      days: 30,
      maxUsers: 3,
    })) as {
      tenantId: string;
      ownerUserId: string;
      ownerEmail: string;
      oneTimePassword: string;
      expiresAt: string;
      maxUsers: number;
      seed: { created: { invoices: number; partners: number; receipts: number } };
    };
    sandboxTenantId = provisioned.tenantId;
    sandboxOwnerId = provisioned.ownerUserId;
    oneTimePassword = provisioned.oneTimePassword;

    expect(provisioned.maxUsers).toBe(3);
    expect(provisioned.seed.created.invoices).toBe(6);
    expect(provisioned.seed.created.partners).toBeGreaterThanOrEqual(15);
    expect(provisioned.oneTimePassword).not.toContain(OWNER_PASSWORD);

    const su = await superuserClient();
    const tenantRow = await su.query<{
      kind: string;
      status: string;
      demo_template: string;
      sandbox_max_users: number;
      owner_email: string;
    }>(
      `SELECT kind, status, demo_template, sandbox_max_users, sandbox_owner_email AS owner_email
         FROM tenants WHERE id = $1`,
      [sandboxTenantId],
    );
    // The credential never lands in plain text anywhere.
    const storedHash = await su.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [sandboxOwnerId],
    );
    // The platform trail (via: sandbox-provisioning).
    const auditRows = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id IS NULL AND entity_id = $1 AND action = 'tenant.created'`,
      [sandboxTenantId],
    );
    await su.end();
    expect(tenantRow.rows[0]!.kind).toBe("SANDBOX");
    expect(tenantRow.rows[0]!.status).toBe("ACTIVE");
    expect(tenantRow.rows[0]!.demo_template).toBe("industry.retail");
    expect(tenantRow.rows[0]!.sandbox_max_users).toBe(3);
    expect(auditRows.rows[0]!.n).toBeGreaterThanOrEqual(1);
    expect(storedHash.rows[0]!.password_hash).not.toContain(oneTimePassword);
  });

  it("the owner logs in with the one-time credential; the projection carries the SANDBOX plane", { timeout: 60_000 }, async () => {
    const su = await superuserClient();
    const emailRow = await su.query<{ email: string }>(
      `SELECT sandbox_owner_email AS email FROM tenants WHERE id = $1`,
      [sandboxTenantId],
    );
    await su.end();
    const result = await loginService.login({
      email: emailRow.rows[0]!.email,
      password: oneTimePassword,
      ip: "10.7.7.7",
    });
    expect(result.user.id).toBe(sandboxOwnerId);
    const active = result.memberships.find((membership) => membership.active);
    expect(active?.tenantId).toBe(sandboxTenantId);
    expect(active?.roleKey).toBe("owner");

    const options = await membershipOptions(sandboxOwnerId);
    const sandboxOption = options.find((option) => option.tenantId === sandboxTenantId);
    expect(sandboxOption?.tenantKind).toBe("SANDBOX");
    expect(sandboxOption?.sandboxExpired).toBe(false);
  });

  it("the time box: an expired sandbox refuses login (typed, account survives) + the projection flips", { timeout: 60_000 }, async () => {
    const su = await superuserClient();
    const emailRow = await su.query<{ email: string }>(
      `SELECT sandbox_owner_email AS email FROM tenants WHERE id = $1`,
      [sandboxTenantId],
    );
    await su.query(`UPDATE tenants SET sandbox_expires_at = now() - interval '1 hour' WHERE id = $1`, [
      sandboxTenantId,
    ]);
    await su.end();

    const options = await membershipOptions(sandboxOwnerId);
    const sandboxOption = options.find((option) => option.tenantId === sandboxTenantId);
    expect(sandboxOption?.sandboxExpired).toBe(true);

    await expect(
      loginService.login({ email: emailRow.rows[0]!.email, password: oneTimePassword, ip: "10.7.7.8" }),
    ).rejects.toBeInstanceOf(SandboxTenantExpiredError);

    // The account survives: the user row stays ACTIVE (the demo dies, not
    // the identity).
    const su2 = await superuserClient();
    const userRow = await su2.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [
      sandboxOwnerId,
    ]);
    await su2.end();
    expect(userRow.rows[0]!.status).toBe("ACTIVE");
  });

  it("the invitation quota caps ACTIVE memberships + open invitations at sandbox_max_users", { timeout: 60_000 }, async () => {
    // Back inside the time box for the quota flow.
    const su = await superuserClient();
    await su.query(`UPDATE tenants SET sandbox_expires_at = now() + interval '30 days' WHERE id = $1`, [
      sandboxTenantId,
    ]);
    const roleIdRow = await su.query<{ id: string }>(
      `SELECT r.id FROM roles r WHERE r.tenant_id = $1 AND r.key = 'accountant' LIMIT 1`,
      [sandboxTenantId],
    );
    await su.end();
    // Provisioning clones the system templates — accountant exists.
    expect(roleIdRow.rows.length).toBeGreaterThan(0);
    const roleId = roleIdRow.rows[0]!.id;

    // Usage starts at 1 (the owner). Two invitations fill the cap of 3.
    await withTenant(sandboxTenantId, async () => {
      for (const seat of [1, 2]) {
        const invitation = await invitationIssue({
          tenantId: sandboxTenantId,
          email: `seat-${seat}-${Date.now()}@provision.test`,
          roleId,
          invitedBy: sandboxOwnerId,
        });
        expect(invitation.invitationId).toEqual(expect.any(String));
      }
      // The third seat: the typed quota refusal.
      await expect(
        invitationIssue({
          tenantId: sandboxTenantId,
          email: `seat-3-${Date.now()}@provision.test`,
          roleId,
          invitedBy: sandboxOwnerId,
        }),
      ).rejects.toBeInstanceOf(SandboxUserQuotaExceededError);
    });
  });

  it("a SANDBOX tenant is never a consolidation member (typed refusal)", { timeout: 60_000 }, async () => {
    const group = await withTenant(normalTenantId, () =>
      groups.createGroup({
        name: "Parent group",
        nameAr: "مجموعة الأم",
        baseCurrency: "SAR",
        actorId: normalOwnerId,
      }),
    );
    await expect(
      withTenant(normalTenantId, () =>
        groups.addMember({
          groupId: group.id,
          memberTenantId: sandboxTenantId,
          ownershipPercent: "100.00",
          actorId: normalOwnerId,
        }),
      ),
    ).rejects.toBeInstanceOf(SandboxConsolidationMemberError);
  });

  it("RLS: the sandbox's data is invisible to another tenant's session (the A-probe shape)", { timeout: 60_000 }, async () => {
    const su = await superuserClient();
    await su.query("BEGIN");
    await su.query("SELECT set_config('erp.tenant_id', $1, true)", [normalTenantId]);
    await su.query("SET ROLE erp_app");
    const visible = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM partners WHERE tenant_id = $1`,
      [sandboxTenantId],
    );
    await su.query("ROLLBACK");
    await su.end();
    expect(visible.rows[0]?.n).toBe(0);
  });

  it("the platform listing surfaces sandbox tenants with their state", { timeout: 60_000 }, async () => {
    const listed = (await withPlatformScope(() => tenancyStore.platformListTenants({ limit: 500 }))).find(
      (row) => row.id === sandboxTenantId,
    );
    expect(listed?.kind).toBe("SANDBOX");
    expect(listed?.sandboxExpiresAt).not.toBeNull();
  });
});

// -- InvitationService without the email side effects (the module factory shape) ----
// Constructed directly with a no-op sender (the identity module's own
// useFactory shape — the spec never enqueues invitation emails).
const invitationService = new InvitationService({
  password: new PasswordService(),
  sessions: new SessionService(),
  audit: new AuditService(new DrizzleAuditStore()),
  sendInvitation: async () => undefined,
});

async function invitationIssue(input: {
  tenantId: string;
  email: string;
  roleId: string;
  invitedBy: string;
}) {
  return invitationService.issue(input);
}
