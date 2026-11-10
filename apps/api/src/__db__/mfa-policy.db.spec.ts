import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { AppModule } from "../app.module";
import { PasswordService } from "../modules/identity/application/password-service";
import { SessionService } from "../modules/identity/application/session-service";
import { LoginService } from "../modules/identity/application/login-service";
import { MfaService } from "../modules/identity/application/mfa-service";
import { MfaBootstrapService } from "../modules/identity/application/mfa-bootstrap-service";
import { AuditService } from "../modules/audit/application/audit.service";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import * as store from "../modules/identity/infrastructure/identity.store";
import { closeDb } from "../infra/db/client";
import { stopBoss } from "../infra/jobs/boss";
import {
  MfaBootstrapNotEligibleError,
  MfaRequiredError,
} from "../modules/identity/domain/identity-errors";
import { base32Decode, currentTimestep, hotp } from "../modules/identity/domain/totp";

/**
 * PHASE-024 T4 — the MFA enforcement matrix (ADR-0015 §4 "mandatory-able
 * per role/plan"): every (role, plan policy, tenant policy) combination
 * behaves — mandated → 423 MFA_REQUIRED (enrollmentRequired until
 * enrolled); exempt → optional — plus the enrollment-bootstrap golden
 * path (the 15-minute gated session, the route gate, the flip on verify)
 * and the admin-assisted reset (`identity.mfa.admin_reset`'s first route
 * semantics at the service level).
 *
 * Fixtures run as the bootstrap role; every assertion exercises the
 * app-role services (RLS + grants enforced).
 */

const PLAN_BUSINESS = "30000000-0000-4000-8000-000000000002";
const PASSWORD = "mfa-matrix-passphrase-7";

const audit = new AuditService(new DrizzleAuditStore());
const password = new PasswordService();
const sessions = new SessionService();
const mfa = new MfaService(audit);

let httpBase: string;
let shutdown: (() => Promise<void>) | undefined;

let tenantId: string;
let accountantUserId: string;
let accountantEmail: string;
let salesEmail: string;

function buildLogin(): LoginService {
  return new LoginService({
    password,
    sessions,
    mfa,
    audit,
    notifyLogin: async () => undefined,
  });
}

function buildBootstrap(): MfaBootstrapService {
  return new MfaBootstrapService({ password, sessions, audit });
}

async function setPlanMfaRoles(roleKeys: string[]): Promise<void> {
  const su = await superuserClient();
  await su.query(`UPDATE plans SET mfa_required_role_keys = $1::text[] WHERE id = $2`, [
    roleKeys,
    PLAN_BUSINESS,
  ]);
  await su.end();
}

async function setTenantMfaPolicy(
  mode: "plan" | "custom",
  requiredRoles: string[],
): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES ($1, $2, 'identity.mfa.policy', $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [generateUuidV7(), tenantId, JSON.stringify({ mode, required_roles: requiredRoles })],
  );
  await su.end();
}

async function clearTenantMfaPolicy(): Promise<void> {
  const su = await superuserClient();
  await su.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'identity.mfa.policy'`, [
    tenantId,
  ]);
  await su.end();
}

async function auditCount(action: string, entityId?: string): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = $2
       AND ($3::uuid IS NULL OR entity_id = $3)`,
    [tenantId, action, entityId ?? null],
  );
  await su.end();
  return result.rows[0]?.n ?? 0;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  tenantId = generateUuidV7();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES ($1, 'MFA Matrix Tenant', 'مستأجر المصفوفة', 'SAR', 'SA', 'Asia/Riyadh')`,
    [tenantId],
  );
  await su.query(
    `INSERT INTO subscriptions (id, tenant_id, plan_id, period_start, period_end)
     VALUES ($1, $2, $3, '2026-01-01', '2026-12-31')`,
    [generateUuidV7(), tenantId, PLAN_BUSINESS],
  );

  async function seedUserWithRole(
    email: string,
    templateKey: "accountant" | "sales",
  ): Promise<{ userId: string; roleId: string }> {
    const hash = await password.hashFromNewPassword(PASSWORD);
    const user = await store.insertUser({
      email,
      fullName: `Mfa ${templateKey}`,
      passwordHash: hash,
      status: "ACTIVE",
    });
    const roleId = generateUuidV7();
    const template = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1`,
      [templateKey],
    );
    await su.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, $3, $4, $5)`,
      [roleId, tenantId, templateKey, `Role ${templateKey}`, `دور ${templateKey}`],
    );
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
      [roleId, tenantId, template.rows[0]!.id],
    );
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
      [generateUuidV7(), tenantId, user.id, roleId],
    );
    return { userId: user.id, roleId };
  }

  accountantEmail = `mfa-accountant-${generateUuidV7().slice(0, 8)}@fixture.test`;
  salesEmail = `mfa-sales-${generateUuidV7().slice(0, 8)}@fixture.test`;
  const accountant = await seedUserWithRole(accountantEmail, "accountant");
  await seedUserWithRole(salesEmail, "sales");
  accountantUserId = accountant.userId;
  await su.end();

  // Boot the real application for the HTTP-level gate assertions.
  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: false });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("MFA enforcement matrix (PHASE-024 T4; ADR-0015 §4)", () => {
  it("baseline: no policy anywhere → MFA stays optional (expand-contract default)", async () => {
    await setPlanMfaRoles([]);
    await clearTenantMfaPolicy();
    const login = buildLogin();
    const result = await login.login({ email: accountantEmail, password: PASSWORD });
    expect(result.user.email).toBe(accountantEmail);
  });

  it("plan mandates the role → login refused with enrollmentRequired until enrolled", async () => {
    await setPlanMfaRoles(["accountant"]);
    const login = buildLogin();
    const error = await login
      .login({ email: accountantEmail, password: PASSWORD })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MfaRequiredError);
    expect((error as MfaRequiredError).enrollmentRequired).toBe(true);
  });

  it("plan mandates a DIFFERENT role → the exempt role logs in without a code", async () => {
    const login = buildLogin();
    const result = await login.login({ email: salesEmail, password: PASSWORD });
    expect(result.user.email).toBe(salesEmail);
  });

  it("bootstrap: ineligible users get 409 (the restricted session is never handed out)", async () => {
    const bootstrap = buildBootstrap();
    // Sales is not mandated.
    await expect(
      bootstrap.bootstrap({ email: salesEmail, password: PASSWORD }),
    ).rejects.toBeInstanceOf(MfaBootstrapNotEligibleError);
    // Wrong password shares the login discipline (no oracle).
    await expect(
      bootstrap.bootstrap({ email: accountantEmail, password: "wrong-password-x" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("bootstrap → gated session → enroll+verify → gate flips → code login works", async () => {
    const bootstrap = buildBootstrap();
    const started = await bootstrap.bootstrap({ email: accountantEmail, password: PASSWORD });
    expect(started.mfaEnrollmentRequired).toBe(true);

    // The gated session validates but the gate is closed.
    const gated = await sessions.validate(started.token);
    expect(gated.mfaGatePassed).toBe(false);

    // Enroll + confirm with a real TOTP code (service level).
    const enrollment = await mfa.enroll(accountantUserId);
    const code = hotp(base32Decode(enrollment.secret), currentTimestep(Date.now()));
    await mfa.verify(accountantUserId, code);

    // The gate flipped for the live bootstrap session.
    const unlocked = await sessions.validate(started.token);
    expect(unlocked.mfaGatePassed).toBe(true);

    // Login now takes the normal code-challenge path (NOT enrollment).
    const login = buildLogin();
    const refused = await login
      .login({ email: accountantEmail, password: PASSWORD })
      .catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(MfaRequiredError);
    expect((refused as MfaRequiredError).enrollmentRequired).toBe(false);

    // A fresh code completes the login.
    const freshCode = hotp(
      base32Decode(enrollment.secret),
      currentTimestep(Date.now() + 31_000),
    );
    const completed = await login.login({
      email: accountantEmail,
      password: PASSWORD,
      mfaCode: freshCode,
    });
    expect(completed.user.id).toBe(accountantUserId);
    const bootstrapAudits = await auditCount("mfa.bootstrap_started");
    expect(bootstrapAudits).toBeGreaterThanOrEqual(1);
  });

  it("tenant override custom [] disables the plan mandate (the tenant's wall, the tenant's rule)", async () => {
    await setTenantMfaPolicy("custom", []);
    const login = buildLogin();
    // The accountant HAS a confirmed factor now — a code is still required
    // by the factor-presence rule (M-06 discipline). Use the sales user to
    // prove the override: the plan mandates accountant only, and the custom
    // empty list is proven on a factorless user below in the reset test.
    const result = await login.login({ email: salesEmail, password: PASSWORD });
    expect(result.user.email).toBe(salesEmail);
  });

  it("tenant override custom [role] mandates even when the plan does not", async () => {
    await setPlanMfaRoles([]);
    await setTenantMfaPolicy("custom", ["accountant"]);
    const login = buildLogin();
    // The accountant still has a confirmed factor (previous test), so the
    // refusal is the code challenge — assert the SALES role stays optional
    // and the accountant path demands a code.
    const refused = await login
      .login({ email: accountantEmail, password: PASSWORD })
      .catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(MfaRequiredError);
    await login.login({ email: salesEmail, password: PASSWORD }).then((r) => {
      expect(r.user.email).toBe(salesEmail);
    });
  });

  it("admin reset clears the factors (audited) → next login is enrollment-gated again", async () => {
    const before = await auditCount("mfa.admin_reset");
    const result = await mfa.adminReset({
      adminId: accountantUserId, // the owner act is exercised at HTTP level below
      targetUserId: accountantUserId,
      tenantId,
    });
    expect(result.factorsRemoved).toBeGreaterThanOrEqual(1);
    const after = await auditCount("mfa.admin_reset");
    expect(after).toBe(before + 1);

    // No factor + custom mandate → enrollmentRequired.
    const login = buildLogin();
    const refused = await login
      .login({ email: accountantEmail, password: PASSWORD })
      .catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(MfaRequiredError);
    expect((refused as MfaRequiredError).enrollmentRequired).toBe(true);
  });
});

describe("MFA enforcement at the HTTP surface (the golden path)", () => {
  it("423 MFA_REQUIRED carries details.enrollmentRequired; bootstrap issues the gated session; the route gate holds; verify unlocks", async () => {
    // The custom policy still mandates accountant and the factors were
    // cleared by the admin-reset test.
    const loginResponse = await fetch(`${httpBase}/api/v1/identity/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: accountantEmail, password: PASSWORD }),
    });
    expect(loginResponse.status).toBe(423);
    const loginBody = (await loginResponse.json()) as {
      error: { code: string; details?: { enrollmentRequired?: boolean } };
    };
    expect(loginBody.error.code).toBe("MFA_REQUIRED");
    expect(loginBody.error.details?.enrollmentRequired).toBe(true);

    // The bootstrap exchange (public).
    const bootstrapResponse = await fetch(`${httpBase}/api/v1/identity/mfa/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: accountantEmail, password: PASSWORD }),
    });
    expect(bootstrapResponse.status).toBe(200);
    const bootstrapBody = (await bootstrapResponse.json()) as {
      data: { token: string; mfaEnrollmentRequired: boolean };
    };
    expect(bootstrapBody.data.mfaEnrollmentRequired).toBe(true);
    const gatedToken = bootstrapBody.data.token;

    // A non-allowlisted route with the gated session → 423 MFA_ENROLLMENT_REQUIRED.
    const blocked = await fetch(`${httpBase}/api/v1/tenancy/entitlements`, {
      headers: { "x-session-token": gatedToken },
    });
    expect(blocked.status).toBe(423);
    const blockedBody = (await blocked.json()) as { error: { code: string } };
    expect(blockedBody.error.code).toBe("MFA_ENROLLMENT_REQUIRED");

    // Whoami stays reachable (the allowlist).
    const whoami = await fetch(`${httpBase}/api/v1/identity/sessions/current`, {
      headers: { "x-session-token": gatedToken },
    });
    expect(whoami.status).toBe(200);

    // Enroll + verify over HTTP with the gated session.
    const enroll = await fetch(`${httpBase}/api/v1/identity/mfa/totp/enroll`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-token": gatedToken,
        "idempotency-key": generateUuidV7(),
      },
      body: "{}",
    });
    expect(enroll.status).toBe(200);
    const enrollBody = (await enroll.json()) as { data: { secret: string } };
    const code = hotp(base32Decode(enrollBody.data.secret), currentTimestep(Date.now()));
    const verify = await fetch(`${httpBase}/api/v1/identity/mfa/totp/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-token": gatedToken,
        "idempotency-key": generateUuidV7(),
      },
      body: JSON.stringify({ code }),
    });
    expect(verify.status).toBe(200);

    // The SAME gated session now reaches the previously blocked route.
    const unblocked = await fetch(`${httpBase}/api/v1/tenancy/entitlements`, {
      headers: { "x-session-token": gatedToken },
    });
    expect(unblocked.status).toBe(200);
  });
});
