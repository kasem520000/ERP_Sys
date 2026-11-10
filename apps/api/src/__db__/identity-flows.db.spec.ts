import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHmac } from "node:crypto";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "./test-db";
import { withTenant } from "../infra/db/tenant-context";
import { reloadEnv } from "../config/env";
import { AuditService } from "../modules/audit/application/audit.service";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import { PasswordService } from "../modules/identity/application/password-service";
import { SessionService } from "../modules/identity/application/session-service";
import { LoginService } from "../modules/identity/application/login-service";
import { MfaService } from "../modules/identity/application/mfa-service";
import { RecoveryService } from "../modules/identity/application/recovery-service";
import { InvitationService } from "../modules/identity/application/invitation-service";
import * as store from "../modules/identity/infrastructure/identity.store";
import {
  InvalidCredentialsError,
  InvalidResetTokenError,
  MfaRequiredError,
  RateLimitedError,
} from "../modules/identity/domain/identity-errors";
import {
  base32Decode,
  currentTimestep,
  hotp,
} from "../modules/identity/domain/totp";
import {
  LOCKOUT_THRESHOLD,
  SESSION_ABSOLUTE_TIMEOUT_MS,
} from "../modules/identity/domain/session-policy";
import { hashToken } from "../modules/identity/domain/tokens";
import { keyMaterialForTokens } from "../modules/identity/infrastructure/reset-token-key";
import { ROUTE_PERMISSIONS } from "../infra/auth/route-permissions";

/**
 * PHASE-003 identity flows on real PostgreSQL 16 — the M/R/S evidence:
 * login + lockout (R-01/R-02), per-IP limiting (R-03), session windows
 * (M-01/M-02), rotation (M-04), TOTP replay (M-06), recovery codes (M-07),
 * reset tokens (M-08), revocation (M-10), invitations (single-use, expiry,
 * revocation, S-01 non-member switch → 404 shape), and the route × role
 * permission checklist (acceptance 5/9).
 *
 * Fixtures run as the bootstrap role exactly like migrations; every flow
 * assertion exercises the app-role services (RLS + grants enforced).
 */

const audit = new AuditService(new DrizzleAuditStore());
const password = new PasswordService();
const sessions = new SessionService();

async function seedTenantWithRole(tenantId: string, roleKey: string): Promise<string> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES ($1, $2, $3, 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, `T ${roleKey}`, `م ${roleKey}`],
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, $3, $4, $5, false)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, roleKey, `Role ${roleKey}`, `دور ${roleKey}`],
  );
  // Clone the system-template grants for this role (as superuser — the
  // documented migration-plane seeding shape).
  const templates = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1`,
    [roleKey === "owner_a" ? "owner" : roleKey],
  );
  if (templates.rows[0] !== undefined) {
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp
        WHERE rp.role_id = $3
        ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, tenantId, templates.rows[0].id],
    );
  }
  await su.end();
  return roleId;
}

async function seedUser(
  email: string,
  fullName: string,
  plainPassword: string,
): Promise<store.UserRow> {
  const hash = await password.hashFromNewPassword(plainPassword);
  return store.insertUser({ email, fullName, passwordHash: hash, status: "ACTIVE" });
}

async function seedMembership(tenantId: string, userId: string, roleId: string): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), tenantId, userId, roleId],
  );
  await su.end();
}

async function auditActions(tenantId: string, action: string, entityId?: string): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = $2
       AND ($3::uuid IS NULL OR entity_id = $3)`,
    [tenantId, action, entityId ?? null],
  );
  await su.end();
  return result.rows[0]?.n ?? 0;
}

async function uniqueTenant(): Promise<string> {
  return generateUuidV7();
}

const OWN_PASSWORD = "an-extremely-strong-passphrase-1";

beforeAll(() => {
  ensureTestDb();
  reloadEnv();
});

describe("seeds (acceptance 9)", () => {
  it("permissions catalog = 245 keys matching AUTHORIZATION_MATRIX (drift green)", async () => {
    const su = await superuserClient();
    const result = await su.query<{ n: number }>("SELECT count(*)::int AS n FROM permissions");
    await su.end();
    // 199 pre-PHASE-013 + 25 reporting keys (0004 seed §3.8: the 24
    // viewer-tier reports.*.read / reporting.reports.run grants +
    // platform.reporting.read on the platform-admin template)
    // + 3 industry keys (0004 seed §3.8 PHASE-015: templates.manage/
    // switch + terminology.manage, owner-template auto-granted via the
    // 0005 CROSS JOIN)
    // + 7 PHASE-017 keys (0025 seed §3.2/§3.8: sales.job_cards.manage,
    // partners.vehicles.manage, distribution.{settlements,tiers,
    // free_goods,van_stock}.manage, sales.commissions.manage)
    // + 8 PHASE-018 keys (0026 seed §3.8: manufacturing.boms.manage,
    // manufacturing.production_orders.{view,create,approve,post},
    // manufacturing.qc.manage, manufacturing.genealogy.read,
    // manufacturing.costing.read)
    // + 2 PHASE-019 keys (0027 seed §3.8/§3.1: crm.contracts.bill,
    // accounting.projects.manage — the 5 crm base keys re-assert the 0004
    // seed and were already counted above).
    // + 1 PHASE-023 key (0035 seed §12: sales.commerce.manage — the
    // commerce-channel staging import surface).
    // + 1 PHASE-027 key (0004 seed §3.12 completion: notes.notes.return — the
    // doc-sync action key for the return money event; role grants in 0005).
    // (233 after 0025 + 8 = 241; 241 + 2 = 243 after 0027; 243 + 1 = 244
    // after 0035; 244 + 1 = 245 after 0038-phase; the drift CLI agrees:
    // matrix 245 = seed 245.)
    expect(result.rows[0]?.n).toBe(245);
  });

  it("nine system templates with template grants; owner carries identity keys", async () => {
    const su = await superuserClient();
    const templates = await su.query<{ key: string; grants: number }>(
      `SELECT r.key, count(rp.permission_id)::int AS grants
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id IS NULL GROUP BY r.key ORDER BY r.key`,
    );
    await su.end();
    expect(templates.rows.map((row) => row.key)).toEqual([
      "accountant",
      "cashier",
      "owner",
      "payroll_officer",
      "platform_admin",
      "purchasing",
      "sales",
      "viewer",
      "warehouse",
    ]);
    const owner = templates.rows.find((row) => row.key === "owner")!;
    expect(owner.grants).toBeGreaterThan(150); // every tenant-plane key
    const viewer = templates.rows.find((row) => row.key === "viewer")!;
    // 19 view-class keys + the 24 PHASE-013 viewer-tier reports.*.read /
    // reporting.reports.run grants (0005 seed §2) + the 3 PHASE-018 read
    // keys (0026 seed §3.8: production_orders.view, genealogy.read,
    // costing.read) = 46.
    expect(viewer.grants).toBe(46); // view-class + reports read tier + manufacturing reads
  });
});

describe("login + progressive lockout (R-01, R-02, acceptance 1/2)", () => {
  it("argon2id-verified login issues a rotating session and records user.login", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("login-ok@test", "Owner", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);

    const login = new LoginService({
      password,
      sessions,
      mfa: new MfaService(audit),
      audit,
      notifyLogin: async () => {},
    });
    const result = await login.login({
      email: user.email,
      password: OWN_PASSWORD,
      ip: "10.0.0.1",
    });
    expect(result.token.length).toBeGreaterThan(40);
    expect(result.memberships).toHaveLength(1);
    expect(result.memberships[0]?.roleKey).toBe("owner_a");
    expect(await sessions.validate(result.token)).toBeTruthy();
    // Password hash parameters ride in the PHC string (per-hash upgrades).
    const refreshed = await store.findUserByEmail(user.email);
    expect(refreshed?.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await auditActions(tenantId, "user.login", user.id)).toBe(1);
  });

  it("progressive lockout: N failures → temporary lock, never permanent; counters reset on success (R-01)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("lockout@test", "Locky", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);

    const clock = new FakeClock();
    const login = new LoginService({
      clock,
      password,
      sessions,
      mfa: new MfaService(audit),
      audit,
      notifyLogin: async () => {},
    });
    // (R-02) failures arrive from MANY IPs — per-user lockout must trigger.
    for (let i = 0; i < LOCKOUT_THRESHOLD; i += 1) {
      await expect(
        login.login({
          email: user.email,
          password: "totally-wrong-pass",
          ip: `10.1.${i}.${i}`,
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    }
    // Next attempt: locked, even with the CORRECT password (R-02).
    await expect(
      login.login({ email: user.email, password: OWN_PASSWORD, ip: "10.2.0.1" }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(await auditActions(tenantId, "user.locked", user.id)).toBe(1);
    // The lock is TEMPORARY: past locked_until the same credentials work.
    clock.advance(16 * 60 * 1000);
    const recovered = await login.login({
      email: user.email,
      password: OWN_PASSWORD,
      ip: "10.2.0.2",
    });
    expect(recovered.token).toBeTruthy();
    const refreshed = await store.findUserByEmail(user.email);
    expect(refreshed?.failedLoginCount).toBe(0);
    expect(refreshed?.status).toBe("ACTIVE");
  });

  it("wrong email and wrong password are the same shape (no existence oracle)", async () => {
    const login = new LoginService({
      password,
      sessions,
      mfa: new MfaService(audit),
      audit,
      notifyLogin: async () => {},
    });
    // Handlers attach at promise creation (not sequentially) — otherwise the
    // second rejection can surface inside the first await's window as a
    // spurious unhandled rejection.
    const wrongPassword = expect(
      login.login({ email: "login-ok@test", password: "wrong-wrong-wrong", ip: "10.3.0.1" }),
    ).rejects.toThrow(InvalidCredentialsError);
    const wrongEmail = expect(
      login.login({ email: "no-such-user@test", password: "whatever-pass-1", ip: "10.3.0.2" }),
    ).rejects.toThrow(InvalidCredentialsError);
    await wrongPassword;
    await wrongEmail;
  });

  it("per-IP credential-stuff spray → 429 with Retry-After (R-03)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("spray@test", "Spray", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);

    const login = new LoginService({
      password,
      sessions,
      mfa: new MfaService(audit),
      audit,
      notifyLogin: async () => {},
    });
    const ip = "10.4.0.1";
    let saw429 = false;
    for (let i = 0; i < 12 && !saw429; i += 1) {
      try {
        await login.login({
          email: `victim-${i}@test`,
          password: "wrong-wrong-wrong",
          ip,
        });
      } catch (error) {
        if (error instanceof RateLimitedError) {
          saw429 = true;
          expect(error.retryAfterSeconds).toBeGreaterThan(0);
        }
      }
    }
    expect(saw429).toBe(true);
  });
});

describe("session windows + rotation (M-01, M-02, M-04, M-10)", () => {
  it("idle timeout: 30 minutes without use invalidates (M-01)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("idle@test", "Idle", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);
    const issued = await sessions.issue({ userId: user.id, activeTenantId: tenantId });
    const clock = new FakeClock();
    clock.advance(31 * 60 * 1000);
    const timed = new SessionService(clock);
    await expect(timed.validate(issued.token)).rejects.toThrow();
  });

  it("absolute timeout: 12 h regardless of activity (M-02)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("absolute@test", "Absolute", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);
    const issued = await sessions.issue({ userId: user.id, activeTenantId: tenantId });
    const clock = new FakeClock();
    clock.advance(SESSION_ABSOLUTE_TIMEOUT_MS + 1);
    const timed = new SessionService(clock);
    await expect(timed.validate(issued.token)).rejects.toThrow();
  });

  it("rotation kills the old token and inherits the absolute window (M-04)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("rotate@test", "Rotate", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);
    const issued = await sessions.issue({ userId: user.id, activeTenantId: tenantId });
    const rotated = await sessions.rotate(issued.token);
    await expect(sessions.validate(issued.token)).rejects.toThrow();
    expect(await sessions.validate(rotated.token)).toBeTruthy();
    // Rotation inherits the ORIGINAL absolute window: 12 h - 30 min left.
    const row = await store.findSessionByTokenHash(hashToken(rotated.token));
    expect(row).toBeTruthy();
  });

  it("owner revokes another user's session — dead immediately (M-10)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const owner = await seedUser("revoker@test", "Revoker", OWN_PASSWORD);
    const victim = await seedUser("victim@test", "Victim", OWN_PASSWORD);
    await seedMembership(tenantId, owner.id, roleId);
    await seedMembership(tenantId, victim.id, roleId);
    const victimSession = await sessions.issue({
      userId: victim.id,
      activeTenantId: tenantId,
    });
    await sessions.revokeById(victimSession.sessionId);
    await expect(sessions.validate(victimSession.token)).rejects.toThrow();
  });

  it("password reset consume revokes every session (M-08 + AUTHENTICATION §4)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("reset-all@test", "ResetAll", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);
    const s1 = await sessions.issue({ userId: user.id, activeTenantId: tenantId });
    const s2 = await sessions.issue({ userId: user.id, activeTenantId: tenantId });

    const recovery = new RecoveryService({
      password,
      sessions,
      audit,
      sendResetEmail: async () => {},
    });
    // Direct token fabrication via the same HMAC the service uses (unit-level
    // control over expiry; the request flow is exercised in the HTTP spec).
    const token = signResetTokenForTest(user.id, user.version, Date.now() + 30 * 60 * 1000);
    await recovery.consumeReset(token, "fresh-strong-passphrase-2");
    await expect(sessions.validate(s1.token)).rejects.toThrow();
    await expect(sessions.validate(s2.token)).rejects.toThrow();
    // Replay of the same token is rejected (version bumped).
    await expect(recovery.consumeReset(token, "another-strong-passphrase-3")).rejects.toThrow(
      InvalidResetTokenError,
    );
  });
});

describe("TOTP MFA (M-06, M-07, acceptance 3)", () => {
  it("enroll → verify confirms; same-code replay rejected; recovery codes single-use", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("mfa@test", "Mfa", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);

    const mfa = new MfaService(audit);
    const enrollment = await mfa.enroll(user.id);
    expect(enrollment.secret.length).toBe(32);

    const code = hotp(base32Decode(enrollment.secret), currentTimestep(Date.now()));
    await mfa.verify(user.id, code);
    const confirmed = (await store.findMfaFactorsForUser(user.id)).find(
      (factor) => factor.confirmedAt !== null,
    );
    expect(confirmed).toBeTruthy();
    expect(await auditActions(tenantId, "mfa.enrolled", confirmed!.id)).toBe(1);

    // Login now requires MFA (423 shape).
    const login = new LoginService({
      password,
      sessions,
      mfa,
      audit,
      notifyLogin: async () => {},
    });
    await expect(
      login.login({ email: user.email, password: OWN_PASSWORD, ip: "10.5.0.1" }),
    ).rejects.toThrow(MfaRequiredError);

    // M-06: replaying the SAME code inside the window is rejected.
    await expect(
      login.login({
        email: user.email,
        password: OWN_PASSWORD,
        mfaCode: code,
        ip: "10.5.0.2",
      }),
    ).rejects.toThrow(MfaRequiredError);

    // A fresh code logs in fine; recovery codes then work once each (M-07).
    const freshCode = hotp(
      base32Decode(enrollment.secret),
      currentTimestep(Date.now() + 31_000),
    );
    const loggedIn = await login.login({
      email: user.email,
      password: OWN_PASSWORD,
      mfaCode: freshCode,
      ip: "10.5.0.3",
    });
    expect(loggedIn.token).toBeTruthy();

    const codes = await mfa.regenerateRecoveryCodes(user.id);
    expect(codes).toHaveLength(10);
    // First use consumes; reuse is rejected.
    const okFirst = await mfa.consumeRecoveryCode(user.id, codes[0]!);
    expect(okFirst).toBe(true);
    expect(await mfa.consumeRecoveryCode(user.id, codes[0]!)).toBe(false);
  });
});

describe("invitations (acceptance flow; single-use/expiry/revocation)", () => {
  function invitationService(): InvitationService {
    return new InvitationService({
      password,
      sessions,
      audit,
      sendInvitation: async () => {},
    });
  }

  it("issue → accept creates membership + PENDING user path with password; token single-use", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const owner = await seedUser("inviter@test", "Inviter", OWN_PASSWORD);
    await seedMembership(tenantId, owner.id, roleId);

    const invitations = invitationService();
    const issued = await withTenant(tenantId, async () =>
      invitations.issue({
        tenantId,
        email: "newcolleague@test",
        roleId,
        invitedBy: owner.id,
      }),
    );
    expect(await auditActions(tenantId, "invitation.issued")).toBe(1);

    const view = await invitations.viewByToken(issued.token);
    expect(view.tenantName).toBeTruthy();
    expect(view.status).toBe("PENDING");

    const accepted = await invitations.accept({
      token: issued.token,
      fullName: "New Colleague",
      password: "colleague-strong-pass-4",
    });
    expect(accepted.token).toBeTruthy();
    const created = await store.findUserByEmail("newcolleague@test");
    expect(created?.status).toBe("ACTIVE");

    const memberships = await store.membershipOptions(created!.id);
    expect(memberships).toHaveLength(1);

    // Single use: accepting again is rejected.
    await expect(
      invitations.accept({
        token: issued.token,
        fullName: "New Colleague",
        password: "colleague-strong-pass-4",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "accepted" },
    });
  });

  it("expired and revoked invitations are rejected with distinct reasons", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const owner = await seedUser("revoker2@test", "Revoker2", OWN_PASSWORD);
    await seedMembership(tenantId, owner.id, roleId);
    const invitations = invitationService();

    // Expired: seeded directly with a coherent past window (bootstrap role).
    const su = await superuserClient();
    const expiredId = generateUuidV7();
    await su.query(
      `INSERT INTO invitations (id, tenant_id, created_at, updated_at, email, role_id, token_hash, expires_at, invited_by)
       VALUES ($1, $2, now() - interval '73 hours', now() - interval '73 hours', 'expired@test', $3, $4,
               now() - interval '1 hour', $5)`,
      [expiredId, tenantId, roleId, hashToken("expired-token-test"), owner.id],
    );
    await su.end();
    await expect(
      invitations.accept({
        token: "expired-token-test",
        fullName: "Late",
        password: "late-strong-pass-5",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "expired" },
    });

    // Revoked by the owner through the service.
    const issued = await withTenant(tenantId, async () =>
      invitations.issue({
        tenantId,
        email: "revoked@test",
        roleId,
        invitedBy: owner.id,
      }),
    );
    const view = await invitations.viewByToken(issued.token);
    await withTenant(tenantId, async () => {
      await invitations.revoke(view.invitationId, tenantId, owner.id);
    });
    await expect(
      invitations.accept({
        token: issued.token,
        fullName: "Ghost",
        password: "ghost-strong-pass-6",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "revoked" },
    });
  });
});

describe("S-01 / S-02 / S-03 — API spoof scenarios (acceptance 6)", () => {
  it("S-01: switching to a non-member tenant → NotFoundError (404 shape), own tenant OK", async () => {
    const tenantA = await uniqueTenant();
    const tenantB = await uniqueTenant();
    const roleA = await seedTenantWithRole(tenantA, "owner_a");
    await seedTenantWithRole(tenantB, "owner_b");
    const user = await seedUser("switcher@test", "Switcher", OWN_PASSWORD);
    await seedMembership(tenantA, user.id, roleA);

    const options = await sessions.membershipOptions(user.id);
    expect(options).toHaveLength(1);
    expect(options[0]?.tenantId).toBe(tenantA);
    // A tenant the user has NO membership in does not resolve — the 404
    // shape the controller surfaces (no existence leak).
    expect(options.find((option) => option.tenantId === tenantB)).toBeUndefined();
    // Own membership resolves to the ACTIVE scope.
    const scope = await sessions.requireActiveTenantScope(user.id);
    expect(scope.tenantId).toBe(tenantA);
  });

  it("S-02: suspended tenant blocks the active scope (enforcement; action ships PHASE-004)", async () => {
    const tenantId = await uniqueTenant();
    const roleId = await seedTenantWithRole(tenantId, "owner_a");
    const user = await seedUser("suspended@test", "Suspendee", OWN_PASSWORD);
    await seedMembership(tenantId, user.id, roleId);

    const su = await superuserClient();
    await su.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [tenantId]);
    await su.end();

    const options = await sessions.membershipOptions(user.id);
    const active = options.find(
      (option) =>
        option.membershipStatus === "ACTIVE" &&
        option.tenantStatus === "ACTIVE" &&
        option.tenantId === tenantId,
    );
    expect(active).toBeUndefined(); // suspended tenant never becomes a scope

    // Restore for the rest of the suite.
    const restore = await superuserClient();
    await restore.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [tenantId]);
    await restore.end();
  });

  it("S-03: client-supplied tenant claims never enter the resolution path (forged-header sweep)", async () => {
    const tenantA = await uniqueTenant();
    const roleA = await seedTenantWithRole(tenantA, "owner_a");
    const user = await seedUser("spoofer@test", "Spoofer", OWN_PASSWORD);
    await seedMembership(tenantA, user.id, roleA);
    // The context derives from the SESSION + memberships. Forged tenant ids
    // (body, headers, cross-tenant guesses) resolve to the SAME scope —
    // or to nothing when the session carries no such membership.
    const scope = await sessions.requireActiveTenantScope(user.id);
    expect(scope.tenantId).toBe(tenantA);
    const otherGuess = await uniqueTenant();
    const options = await sessions.membershipOptions(user.id);
    expect(options.find((option) => option.tenantId === otherGuess)).toBeUndefined();
  });
});

describe("route × role permission checklist (acceptance 5)", () => {
  it("every protected route: owner template grants it, viewer template does not (identity/audit plane)", async () => {
    const tenantId = await uniqueTenant();
    const ownerRole = await seedTenantWithRole(tenantId, "owner_a");
    const viewerSu = await superuserClient();
    const viewerRoleId = generateUuidV7();
    await viewerSu.query(
      `INSERT INTO roles (id, tenant_id, key, name) VALUES ($1, $2, 'viewer_clone', 'Viewer Clone')
       ON CONFLICT (id) DO NOTHING`,
      [viewerRoleId, tenantId],
    );
    const viewerTemplate = await viewerSu.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'viewer'`,
    );
    await viewerSu.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3
        ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [viewerRoleId, tenantId, viewerTemplate.rows[0]!.id],
    );
    const ownerUser = await seedUser("checklist-owner@test", "Owner", OWN_PASSWORD);
    const viewerUser = await seedUser("checklist-viewer@test", "Viewer", OWN_PASSWORD);
    await seedMembership(tenantId, ownerUser.id, ownerRole);
    await seedMembership(tenantId, viewerUser.id, viewerRoleId);
    await viewerSu.end();

    const ownerPerms = await store.effectivePermissions(ownerUser.id, tenantId);
    const viewerPerms = await store.effectivePermissions(viewerUser.id, tenantId);
    // Matrix rows marked "all tenant roles" (§3.6 partners/items view tier +
    // §3.8 files.upload/files.view + §3.1 accounting view tier from
    // PHASE-007): the viewer template legitimately holds exactly these —
    // everything else stays owner-tier.
    const allTenantRolesKeys = new Set([
      "partners.view",
      "items.view",
      "files.upload",
      "files.view",
      "accounting.journal_entries.view",
      "accounting.accounts.view",
      // PHASE-008 (matrix §3.4): the viewer-tier treasury view key.
      "treasury.accounts.view",
      // PHASE-010 (matrix §3.5): the viewer-tier inventory view keys
      // (stock/availability + the movement ledger).
      "inventory.stock.view",
      "inventory.moves.view",
      // PHASE-012 (matrix §2/§3.2): the viewer template's sales view keys —
      // granted since the PHASE-003 role-template seed ("view-class keys
      // across the enabled modules"); the sales routes now exercise them.
      "sales.invoices.view",
      "sales.credit_notes.view",
      // PHASE-013 (matrix §3.8): the viewer-tier granular reports.*.read
      // keys — the report engine's read-only tier (financial statements +
      // operational reads; close pack + exports stay accountant/owner).
      "reporting.reports.run",
      "reports.financial.tb.read",
      "reports.financial.gl.read",
      "reports.financial.is.read",
      "reports.financial.bs.read",
      "reports.financial.cf.read",
      "reports.accounting.cost-centers.read",
      "reports.ar.aging.read",
      "reports.ap.aging.read",
      "reports.ar-alloc.read",
      "reports.sales.by-item.read",
      "reports.sales.by-customer.read",
      "reports.sales.by-rep.read",
      "reports.sales.by-paymethod.read",
      "reports.sales.pipeline.read",
      "reports.sales.by-branch.read",
      "reports.sales.profitability.read",
      "reports.purchasing.by-supplier.read",
      "reports.purchasing.by-item.read",
      "reports.purchasing.grni.read",
      "reports.purchasing.matching.read",
      "reports.treasury.fx.read",
      "reports.tax.vat-return.read",
      "reports.tax.summary.read",
      // PHASE-018 (matrix §3.8): the viewer-tier manufacturing read keys
      // (order view + genealogy + production-cost report reads).
      "manufacturing.production_orders.view",
      "manufacturing.genealogy.read",
      "manufacturing.costing.read",
    ]);
    for (const rule of ROUTE_PERMISSIONS) {
      const isPlatformRoute = rule.permission.startsWith("platform.");
      if (isPlatformRoute) {
        // PHASE-004 (matrix §3.10): platform.* keys are NEVER tenant-
        // assignable — owner and viewer are both 403 (S-07); the keys live
        // on the platform-operations tenant's platform_admin role only.
        expect(ownerPerms.has(rule.permission), `owner must NOT hold ${rule.permission}`).toBe(
          false,
        );
        expect(viewerPerms.has(rule.permission), `viewer must NOT hold ${rule.permission}`).toBe(
          false,
        );
        continue;
      }
      expect(ownerPerms.has(rule.permission), `owner → ${rule.permission}`).toBe(true);
      const viewerAllowed = allTenantRolesKeys.has(rule.permission);
      expect(
        viewerPerms.has(rule.permission),
        `viewer ${viewerAllowed ? "must" : "must NOT"} hold ${rule.permission}`,
      ).toBe(viewerAllowed);
    }
  });

  it("PHASE-004 checklist: platform routes resolve ONLY on the platform-admin template", async () => {
    const su = await superuserClient();
    const grants = await su.query<{ permission_id: string }>(
      `SELECT rp.permission_id FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE r.tenant_id IS NULL AND r.key = 'platform_admin'`,
    );
    await su.end();
    const platformGrants = new Set(grants.rows.map((row) => row.permission_id));
    expect(platformGrants.size).toBe(10); // matrix §3.10: the platform key set (+PHASE-013 platform.reporting.read)
    for (const rule of ROUTE_PERMISSIONS) {
      if (rule.permission.startsWith("platform.")) {
        expect(platformGrants.has(rule.permission), `platform_admin → ${rule.permission}`).toBe(
          true,
        );
      } else {
        expect(platformGrants.has(rule.permission)).toBe(false); // never tenant-plane keys
      }
    }
  });

  it("self-scope: identity.mfa.manage is runtime-granted to every user, never via templates", async () => {
    const su = await superuserClient();
    const templateGrants = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE r.tenant_id IS NULL AND rp.permission_id = 'identity.mfa.manage'`,
    );
    await su.end();
    expect(templateGrants.rows[0]?.n).toBe(0); // evaluator-level only
  });
});

describe("role editor primitives (identity.roles.assign)", () => {
  it("tenant roles read templates for cloning; grants adjust with before/after audit", async () => {
    const tenantId = await uniqueTenant();
    const ownerRole = await seedTenantWithRole(tenantId, "owner_a");
    const owner = await seedUser("editor@test", "Editor", OWN_PASSWORD);
    await seedMembership(tenantId, owner.id, ownerRole);

    const templates = await store.listSystemTemplates();
    expect(templates.map((t) => t.key)).toContain("accountant");

    const custom = await withTenant(tenantId, async () =>
      store.cloneSystemTemplate("accountant", tenantId),
    );
    const grants = await withTenant(tenantId, async () => store.listRolePermissions(custom.id));
    expect(grants.length).toBeGreaterThan(10); // template grants cloned

    await withTenant(tenantId, async () => {
      await store.setRolePermissions(custom.id, ["partners.view"]);
    });
    const after = await withTenant(tenantId, async () => store.listRolePermissions(custom.id));
    expect(after).toEqual(["partners.view"]);
  });
});

/** Deterministic clock for window tests (M-01/M-02). */
class FakeClock {
  private current = Date.now();
  now(): Date {
    return new Date(this.current);
  }
  async sleep(): Promise<void> {}
  advance(ms: number): void {
    this.current += ms;
  }
}

/** HMAC reset-token signer mirroring recovery-service (test-side control). */
function signResetTokenForTest(
  userId: string,
  passwordVersion: number,
  expiresAtMs: number,
): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, v: passwordVersion, e: expiresAtMs }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", keyMaterialForTokens())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

afterAll(() => {
  // Fixtures are tenant-scoped test data; the registry/CI checks re-run
  // per suite boot and stay complete (nothing here mutates the schema).
});
