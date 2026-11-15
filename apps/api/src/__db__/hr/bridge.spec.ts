import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { BridgeService } from "../../modules/hr/application/bridge-service";
import { effectivePermissions, insertUser } from "../../modules/identity/api/identity";
import { H_ACTOR, setupHrFixture, superuserClient } from "./fixtures";

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

/**
 * PHASE-045 (T-09) — the employee ↔ user identity bridge pinned (HR-13):
 *
 * - THE LINK LAW: ONE employee ↔ ONE user at any moment — the employee
 *   carries at most one link (a second attempt is the typed refusal);
 *   a user maps to at most ONE employee (the 0085 partial-UNIQUE floor —
 *   the pre-write check AND the DB floor itself, proven by a direct
 *   second write failing 23505); the link is AUDITED
 *   (hr.employee_user_linked / _unlinked);
 * - THE MEMBERSHIP + LIFECYCLE LAWS: the user must be an ACTIVE member
 *   of the acting tenant (a foreign/non-member user is the typed
 *   refusal, never an orphan link); a TERMINATED employee is never
 *   linked (the honest lifecycle);
 * - THE SoD LAW (acceptance 8): linking an employee to a user grants
 *   NOTHING — effectivePermissions is IDENTICAL before/after the link
 *   (no hr.* / payroll.* key appears), and a user-ADMINISTRATION role
 *   (identity.users.manage + identity.roles.assign) holds NO HR read —
 *   HR data visibility rides HR permissions, never user administration
 *   nor the link itself;
 * - THE TENANT BOUNDARY: the own-rows resolver resolves the linked
 *   employee ONLY in the owning tenant (undefined in another tenant);
 *   the employee read is RLS-walled (the A7 law).
 */

const audit = new AuditService(new DrizzleAuditStore());
const bridgeSvc = new BridgeService(audit);

interface BridgeSpecFixture {
  employeeB1Id: string;
  employeeB2Id: string;
  employeeB3Id: string;
  userU1: string;
  userU2: string;
  userU3NoMembership: string;
  userAdmin: string;
}

const spec: { fixture?: BridgeSpecFixture } = {};

async function su(): Promise<Client> {
  return superuserClient();
}

beforeAll(async () => {
  await setupHrFixture();
  const client = await su();

  // Three employees on the payroll substrate: B1/B2 ACTIVE, B3 TERMINATED
  // (the terminal status carries its termination_date — the CHECK shape).
  const employeeRows = await client.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, status, termination_date, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-B1', 'Bridget Al-Link', '2026-01-05', 'FULL_TIME', 8000, 'ACTIVE', NULL, $2),
       (gen_random_uuid(), $1, 'EMP-B2', 'Basil Al-Bridge', '2026-02-01', 'FULL_TIME', 8500, 'ACTIVE', NULL, $2),
       (gen_random_uuid(), $1, 'EMP-B3', 'Tarek Al-Terminal', '2024-01-01', 'FULL_TIME', 9000, 'TERMINATED', '2026-06-30', $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  const byCode = new Map(employeeRows.rows.map((row) => [row.code, row.id]));

  // U1/U2: ACTIVE members of tenant H under an EMPTY role (zero grants —
  // the SoD arms need users that hold nothing); U3: exists, member of
  // NOTHING (the orphan-link refusal arm).
  const stamp = Date.now() % 100000;
  const u1 = await insertUser({
    email: `bridge-u1-${stamp}@fixture.test`,
    fullName: "Bridge User One",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const u2 = await insertUser({
    email: `bridge-u2-${stamp}@fixture.test`,
    fullName: "Bridge User Two",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const u3 = await insertUser({
    email: `bridge-u3-${stamp}@fixture.test`,
    fullName: "Bridge User Three (no membership)",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const userAdmin = await insertUser({
    email: `bridge-admin-${stamp}@fixture.test`,
    fullName: "Bridge User Admin",
    passwordHash: "x",
    status: "ACTIVE",
  });

  const emptyRoleId = (
    await client.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, key, name) VALUES (gen_random_uuid(), $1, 'bridge_empty_${stamp}', 'Bridge empty role (T-09)')
       RETURNING id`,
      [TENANT_H],
    )
  ).rows[0]!.id;
  await client.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES
       (gen_random_uuid(), $1, $2, $3), (gen_random_uuid(), $1, $4, $3)
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [TENANT_H, u1.id, emptyRoleId, u2.id],
  );

  // The user-ADMINISTRATION role: identity.users.manage + identity.roles.
  // assign ONLY — the SoD arm proves these keys open NO HR read.
  const adminRoleId = (
    await client.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, key, name) VALUES (gen_random_uuid(), $1, 'bridge_useradmin_${stamp}', 'Bridge user-admin role (T-09)')
       RETURNING id`,
      [TENANT_H],
    )
  ).rows[0]!.id;
  await client.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, p.key FROM permissions p
      WHERE p.key IN ('identity.users.manage', 'identity.roles.assign')
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [adminRoleId, TENANT_H],
  );
  await client.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES (gen_random_uuid(), $1, $2, $3)
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [TENANT_H, userAdmin.id, adminRoleId],
  );

  await client.end();

  spec.fixture = {
    employeeB1Id: byCode.get("EMP-B1")!,
    employeeB2Id: byCode.get("EMP-B2")!,
    employeeB3Id: byCode.get("EMP-B3")!,
    userU1: u1.id,
    userU2: u2.id,
    userU3NoMembership: u3.id,
    userAdmin: userAdmin.id,
  };
});

describe("PHASE-045 T-09 — the employee ↔ user identity bridge: the link law, the audit trail, the SoD law, the boundary", () => {
  it("(a) THE LINK LAW — one employee ↔ one user, the memberships + lifecycle refusals, the audit trail, the resolver", async () => {
    const f = spec.fixture!;

    // U1's effective permissions BEFORE the link (the SoD baseline).
    const permsBefore = await withTenant(TENANT_H, () => effectivePermissions(f.userU1, TENANT_H));

    // The link lands.
    const linked = await withTenant(TENANT_H, () =>
      bridgeSvc.link({ employeeId: f.employeeB1Id, userId: f.userU1, actorId: H_ACTOR }),
    );
    expect(linked.code).toBe("EMP-B1");
    expect(linked.userId).toBe(f.userU1);
    expect(linked.status).toBe("ACTIVE");

    // The audit trail.
    const audited = await su();
    const linkEvents = await audited.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'hr.employee_user_linked' AND entity_id = $2`,
      [TENANT_H, f.employeeB1Id],
    );
    await audited.end();
    expect(Number(linkEvents.rows[0]!.n)).toBe(1);

    // THE EMPLOYEE ARM: a second link on the same employee is typed.
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.link({ employeeId: f.employeeB1Id, userId: f.userU2, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BRIDGE_ALREADY_LINKED" });

    // THE USER ARM: the taken user is refused for ANOTHER employee.
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.link({ employeeId: f.employeeB2Id, userId: f.userU1, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BRIDGE_ALREADY_LINKED" });

    // The unknown employee (A7 — unknown == foreign, RLS-indistinct).
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.link({
          employeeId: "00000000-0000-4000-8000-000000000b0f",
          userId: f.userU2,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });

    // The unknown user.
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.link({
          employeeId: f.employeeB2Id,
          userId: "00000000-0000-4000-8000-000000000b0e",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BRIDGE_USER_NOT_FOUND" });

    // THE MEMBERSHIP LAW: a user with no ACTIVE membership in this tenant
    // is never linked (an orphan link can never reach its rows).
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.link({ employeeId: f.employeeB2Id, userId: f.userU3NoMembership, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BRIDGE_USER_NOT_MEMBER" });

    // THE LIFECYCLE LAW: a TERMINATED employee is never linked.
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.link({ employeeId: f.employeeB3Id, userId: f.userU2, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BRIDGE_INVALID" });

    // THE OWN-ROWS RESOLVER: the linked employee resolves by user.
    const resolved = await withTenant(TENANT_H, () => bridgeSvc.resolveByUser(f.userU1));
    expect(resolved?.id).toBe(f.employeeB1Id);
    expect(resolved?.code).toBe("EMP-B1");

    // The bridge read.
    const state = await withTenant(TENANT_H, () => bridgeSvc.get(f.employeeB1Id));
    expect(state.userId).toBe(f.userU1);

    // THE SoD LAW: the link granted NOTHING — the effective permission set
    // is IDENTICAL before/after (no hr.* / payroll.* key appeared).
    const permsAfter = await withTenant(TENANT_H, () => effectivePermissions(f.userU1, TENANT_H));
    expect([...permsAfter].sort()).toEqual([...permsBefore].sort());
    expect(permsAfter.has("hr.self_service")).toBe(false);
    expect(permsAfter.has("hr.attendance")).toBe(false);
    expect(permsAfter.has("payroll.employees.view")).toBe(false);
  });

  it("(b) THE UNLINK LAW — the audited way a link moves; the freed user relinks; the not-linked refusal", async () => {
    const f = spec.fixture!;

    // Unlink of an unlinked employee: typed.
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.unlink({ employeeId: f.employeeB2Id, actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BRIDGE_NOT_LINKED" });

    // The unlink lands + audits.
    const unlinked = await withTenant(TENANT_H, () =>
      bridgeSvc.unlink({ employeeId: f.employeeB1Id, actorId: H_ACTOR }),
    );
    expect(unlinked.userId).toBeNull();
    const audited = await su();
    const unlinkEvents = await audited.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'hr.employee_user_unlinked' AND entity_id = $2`,
      [TENANT_H, f.employeeB1Id],
    );
    await audited.end();
    expect(Number(unlinkEvents.rows[0]!.n)).toBe(1);

    // THE FREED USER: the link moves the audited way — U1 now takes B2.
    const moved = await withTenant(TENANT_H, () =>
      bridgeSvc.link({ employeeId: f.employeeB2Id, userId: f.userU1, actorId: H_ACTOR }),
    );
    expect(moved.code).toBe("EMP-B2");
    expect(moved.userId).toBe(f.userU1);

    // The unknown employee on unlink (A7).
    await expect(
      withTenant(TENANT_H, () =>
        bridgeSvc.unlink({ employeeId: "00000000-0000-4000-8000-000000000b0d", actorId: H_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });
  });

  it("(c) THE SoD LAW — user administration opens NO HR read; the 0085 floor; the tenant boundary", async () => {
    const f = spec.fixture!;

    // The user-administration role (identity.users.manage +
    // identity.roles.assign) holds NO hr.* / payroll.employees.* key —
    // HR data visibility rides HR permissions, NEVER user administration.
    const adminPerms = await withTenant(TENANT_H, () => effectivePermissions(f.userAdmin, TENANT_H));
    expect(adminPerms.has("identity.users.manage")).toBe(true);
    expect(adminPerms.has("identity.roles.assign")).toBe(true);
    for (const key of adminPerms) {
      expect(key.startsWith("hr."), `${key} must not be an hr key`).toBe(false);
      expect(key.startsWith("payroll."), `${key} must not be a payroll key`).toBe(false);
    }

    // THE 0085 FLOOR ITSELF: a direct SQL second write of the taken user
    // violates the partial UNIQUE — the floor exists independent of the
    // service's pre-write check (the race arm; the INV-011 precedent's
    // raw-client shape — unique indexes bind every role).
    const floorClient = await su();
    await expect(
      floorClient.query(
        `UPDATE employees SET user_id = $1, updated_at = now(), version = version + 1
          WHERE id = $2 AND tenant_id = $3`,
        [f.userU1, f.employeeB1Id, TENANT_H],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await floorClient.end();

    // THE TENANT BOUNDARY: the resolver answers ONLY in the owning tenant.
    const foreign = await withTenant(TENANT_H_RLS, () => bridgeSvc.resolveByUser(f.userU1));
    expect(foreign).toBeUndefined();

    // The employee read is RLS-walled (the A7 law — tenant H's employee is
    // indistinguishable from an unknown id under the boundary tenant).
    await expect(
      withTenant(TENANT_H_RLS, () => bridgeSvc.get(f.employeeB2Id)),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });
  });
});
