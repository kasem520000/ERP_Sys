import { sql } from "drizzle-orm";

import { Inject } from "@nestjs/common";

import { withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { NotFoundError } from "../domain/identity-errors";
import * as store from "../infrastructure/identity.store";
import { SessionService } from "./session-service";

/**
 * User management (identity.users.view / manage plane, PHASE-003 §2.14):
 * tenant-scoped listing joined with memberships, membership revocation,
 * session revocation (M-10), role editor primitives (list tenant roles +
 * system templates, clone template, adjust grants). Provisioning itself is
 * PHASE-004; here the owner manages the users it invited.
 */

export interface TenantUserRow {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  status: string;
  locale: string;
  lastLoginAt: string | null;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleNameAr: string | null;
  membershipStatus: string;
}

export class UsersService {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Users of the active tenant (tenant context from the interceptor). */
  async listForTenant(tenantId: string): Promise<readonly TenantUserRow[]> {
    const rows = await withTenant(tenantId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT m.id AS membership_id, u.id AS user_id, u.email, u.full_name,
               u.status, u.locale, u.last_login_at,
               r.id AS role_id, r.key AS role_key, r.name AS role_name,
               r.name_ar AS role_name_ar, m.status AS membership_status
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        JOIN roles r ON r.id = m.role_id
        WHERE m.tenant_id = ${tenantId}
        ORDER BY m.created_at
      `);
      return result.rows;
    });
    return (rows as Record<string, unknown>[]).map((row) => ({
      membershipId: row.membership_id as string,
      userId: row.user_id as string,
      email: row.email as string,
      fullName: row.full_name as string,
      status: row.status as string,
      locale: row.locale as string,
      lastLoginAt: row.last_login_at as string | null,
      roleId: row.role_id as string,
      roleKey: row.role_key as string,
      roleName: row.role_name as string,
      roleNameAr: row.role_name_ar as string | null,
      membershipStatus: row.membership_status as string,
    }));
  }

  /** Revoke a membership (status → REVOKED; audit linkage preserved). */
  async revokeMembership(input: {
    tenantId: string;
    membershipId: string;
    actorId: string;
  }): Promise<void> {
    await withTenant(input.tenantId, async () => {
      const membership = await store.findMembershipById(
        input.membershipId,
        input.tenantId,
      );
      if (membership === undefined) {
        throw new NotFoundError("membership");
      }
      await store.revokeMembership(input.membershipId);
      await this.audit.record({
        action: "membership.revoked",
        entityType: "membership",
        entityId: input.membershipId,
        actorId: input.actorId,
        before: { status: membership.status },
        after: { status: "REVOKED", user_id: membership.userId },
      });
    });
  }

  /** Owner revoking another user's session — dead immediately (M-10). */
  async revokeUserSession(input: {
    sessionId: string;
    actorId: string;
  }): Promise<void> {
    const session = await store.findSessionById(input.sessionId);
    if (session === undefined) {
      throw new NotFoundError("session");
    }
    await this.sessions.revokeById(input.sessionId);
    await this.audit.record({
      action: "session.revoked",
      entityType: "session",
      entityId: input.sessionId,
      actorId: input.actorId,
      after: { target_user_id: session.userId },
    });
  }

  // -- roles editor primitives (identity.roles.assign plane) ---------------

  async listTenantRoles(): Promise<readonly store.RoleRow[]> {
    return store.listTenantRoles();
  }

  async listSystemTemplates(): Promise<readonly store.RoleRow[]> {
    return store.listSystemTemplates();
  }

  async listRolePermissions(roleId: string): Promise<readonly string[]> {
    return store.listRolePermissions(roleId);
  }

  /** Clone a system template into a tenant role (grants included), audited. */
  async cloneTemplate(input: {
    templateKey: string;
    tenantId: string;
    actorId: string;
  }): Promise<store.RoleRow> {
    const role = await withTenant(input.tenantId, async () =>
      store.cloneSystemTemplate(input.templateKey, input.tenantId),
    );
    await this.audit.record({
      action: "role.updated",
      entityType: "role",
      entityId: role.id,
      actorId: input.actorId,
      after: { cloned_from: input.templateKey, key: role.key },
    });
    return role;
  }

  /** Adjust a tenant role's grants (replace set), audited with before/after. */
  async setRoleGrants(input: {
    roleId: string;
    keys: readonly string[];
    actorId: string;
  }): Promise<void> {
    const before = await store.listRolePermissions(input.roleId);
    await store.setRolePermissions(input.roleId, [...input.keys]);
    await this.audit.record({
      action: "role.updated",
      entityType: "role",
      entityId: input.roleId,
      actorId: input.actorId,
      before: { grants: before },
      after: { grants: [...input.keys] },
    });
  }
}
