import { eq, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import * as schema from "../../../db/schema";
import { getDb, type TenantDb } from "../../../infra/db/client";
import { ambientTx } from "../../../infra/db/tenant-context";

/**
 * Identity data access (PHASE-003): pure storage, no business rules
 * (DEPENDENCY_RULES §1 infrastructure layer). Global tables (users,
 * sessions, mfa_factors) are accessed through the app pool directly — no
 * tenant GUC exists for them by design. Tenant-owned tables (memberships,
 * invitations, tenant roles) run inside the ambient `withTenant`
 * transaction (RLS-enforced); the pre-GUC resolution paths use the
 * SECURITY DEFINER projections from migration 0003.
 */

const db = () => getDb();

/** Ambient tenant transaction (services run inside TenantContextInterceptor). */
function tenantTx(): TenantDb {
  const tx = ambientTx();
  if (tx === undefined) {
    throw new Error("tenant-scoped identity access requires an ambient withTenant scope");
  }
  return tx;
}

// ---------------------------------------------------------------------------
// users (global)

export interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  passwordHash: string;
  status: string;
  locale: string;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  version: number;
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const normalized = email.trim().toLowerCase();
  const rows = await db()
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${normalized}`)
    .limit(1);
  return rows[0] as UserRow | undefined;
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const rows = await db().select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows[0] as UserRow | undefined;
}

export interface NewUser {
  email: string;
  fullName: string;
  passwordHash: string;
  locale?: string;
  phone?: string;
  status?: string;
}

export async function insertUser(
  input: NewUser,
  /** PHASE-004: shared-transaction variant (registration atomicity). */
  tx?: TenantDb,
): Promise<UserRow> {
  const [row] = await (tx ?? db())
    .insert(schema.users)
    .values({
      id: generateUuidV7(),
      updatedAt: new Date().toISOString(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      status: input.status ?? "PENDING",
      locale: input.locale ?? "ar",
    })
    .returning();
  return row as UserRow;
}

export async function updateUserRow(id: string, patch: Partial<UserRow>): Promise<void> {
  await db()
    .update(schema.users)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(schema.users.id, id));
}

/** Successful login: reset counters, stamp last_login_at, activate PENDING
 * and clear expired LOCKED states (the temporary lock is exactly that). */
export async function markLoginSuccess(id: string, tx?: TenantDb): Promise<void> {
  const handle = tx ?? db();
  await handle.execute(sql`
    UPDATE users SET
      failed_login_count = 0,
      locked_until = NULL,
      last_login_at = now(),
      updated_at = now(),
      status = CASE WHEN status IN ('PENDING', 'LOCKED') THEN 'ACTIVE' ELSE status END
    WHERE id = ${id}
  `);
}

/** Failed login: bump the durable per-user counter (R-02 — IP-independent). */
export async function markLoginFailure(id: string): Promise<number> {
  const result = await db().execute(sql`
    UPDATE users SET
      failed_login_count = failed_login_count + 1,
      updated_at = now()
    WHERE id = ${id}
    RETURNING failed_login_count AS failed_login_count
  `);
  const rows = result.rows as { failed_login_count: number }[];
  return rows[0]?.failed_login_count ?? 0;
}

/** Temporary lock (AUTHENTICATION §5.2): never permanent without admin. */
export async function lockUser(id: string, lockedUntil: string): Promise<void> {
  await db()
    .update(schema.users)
    .set({ status: "LOCKED", lockedUntil, updatedAt: new Date().toISOString() })
    .where(eq(schema.users.id, id));
}

// ---------------------------------------------------------------------------
// sessions (user-owned)

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  activeTenantId: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string | null;
  lastSeenAt: string;
  /** PHASE-024: false only on the enrollment-bootstrap session. */
  mfaGatePassed: boolean;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  activeTenantId: string | null;
  expiresAt: string;
  ip?: string;
  /** PHASE-024: defaults true; the bootstrap passes false. */
  mfaGatePassed?: boolean;
}

export async function insertSession(input: NewSession): Promise<SessionRow> {
  const [row] = await db()
    .insert(schema.sessions)
    .values({
      id: generateUuidV7(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      activeTenantId: input.activeTenantId,
      expiresAt: input.expiresAt,
      ip: input.ip,
      mfaGatePassed: input.mfaGatePassed ?? true,
    })
    .returning();
  return row as SessionRow;
}

export async function findSessionByTokenHash(tokenHash: string): Promise<SessionRow | undefined> {
  const rows = await db()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .limit(1);
  return rows[0] as SessionRow | undefined;
}

/** Minimal tenant reference a session token resolves to (R-04 hot path). */
export interface SessionTenantRef {
  activeTenantId: string | null;
}

/**
 * PHASE-024 (R-04): the tenant-rate-limit middleware's ONE indexed query —
 * active tenant only, no session-row hydration, no expiry re-validation
 * (the SessionMiddleware/guard chain owns that; a revoked row must not
 * consume a tenant's burst budget, hence the revoked_at filter). `sessions`
 * is a global table (no RLS) — a plain app-pool read is correct here.
 */
export async function findSessionTenantByTokenHash(
  tokenHash: string,
): Promise<SessionTenantRef | undefined> {
  const result = await db().execute(
    sql`SELECT active_tenant_id FROM sessions WHERE token_hash = ${tokenHash} AND revoked_at IS NULL LIMIT 1`,
  );
  const row = (result.rows as unknown as { active_tenant_id: string | null }[])[0];
  return row === undefined ? undefined : { activeTenantId: row.active_tenant_id };
}

export async function findSessionById(id: string): Promise<SessionRow | undefined> {
  const rows = await db()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  return rows[0] as SessionRow | undefined;
}

export async function revokeSession(id: string, tx?: TenantDb): Promise<void> {
  const handle = tx ?? db();
  await handle.execute(
    sql`UPDATE sessions SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL`,
  );
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db().execute(
    sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`,
  );
}

export async function touchSessionLastSeen(id: string): Promise<void> {
  await db().execute(
    sql`UPDATE sessions SET last_seen_at = now() WHERE id = ${id}`,
  );
}

/** Re-anchor created_at (rotation inherits the original absolute window). */
export async function anchorSessionCreatedAt(id: string, createdAt: string): Promise<void> {
  await db().execute(
    sql`UPDATE sessions SET created_at = ${createdAt} WHERE id = ${id}`,
  );
}

/** Switch the session's active tenant (convenience column — S-01 verified). */
export async function updateSessionActiveTenant(id: string, tenantId: string): Promise<void> {
  await db().execute(
    sql`UPDATE sessions SET active_tenant_id = ${tenantId} WHERE id = ${id}`,
  );
}

export async function listSessionsForUser(userId: string): Promise<SessionRow[]> {
  return (await db()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))) as SessionRow[];
}

export async function listSessionsForTenant(tenantId: string): Promise<SessionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.user_id AS "userId", s.token_hash AS "tokenHash",
           s.active_tenant_id AS "activeTenantId", s.created_at AS "createdAt",
           s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt", s.ip,
           s.last_seen_at AS "lastSeenAt", s.mfa_gate_passed AS "mfaGatePassed"
    FROM sessions s
    JOIN memberships m ON m.user_id = s.user_id
    WHERE m.tenant_id = ${tenantId} AND m.status = 'ACTIVE'
      AND s.revoked_at IS NULL AND s.expires_at > now()
  `);
  return rows.rows as unknown as SessionRow[];
}

// ---------------------------------------------------------------------------
// memberships (tenant-owned — ambient withTenant scope only)

export interface MembershipRow {
  id: string;
  tenantId: string;
  userId: string;
  roleId: string;
  branchScope: string[] | null;
  status: string;
  createdBy: string | null;
}

export async function findMembershipForUserInTenant(
  userId: string,
  tenantId: string,
): Promise<MembershipRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, tenant_id AS "tenantId", user_id AS "userId", role_id AS "roleId",
           branch_scope AS "branchScope", status, created_by AS "createdBy"
    FROM memberships WHERE user_id = ${userId} AND tenant_id = ${tenantId} LIMIT 1
  `);
  return (rows.rows as unknown as MembershipRow[])[0];
}

export async function findMembershipById(
  membershipId: string,
  tenantId: string,
): Promise<MembershipRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, tenant_id AS "tenantId", user_id AS "userId", role_id AS "roleId",
           branch_scope AS "branchScope", status, created_by AS "createdBy"
    FROM memberships WHERE id = ${membershipId} AND tenant_id = ${tenantId} LIMIT 1
  `);
  return (rows.rows as unknown as MembershipRow[])[0];
}

export async function insertMembership(input: {
  tenantId: string;
  userId: string;
  roleId: string;
  createdBy?: string;
}): Promise<MembershipRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO memberships (id, tenant_id, user_id, role_id, created_by, status)
    VALUES (${generateUuidV7()}, ${input.tenantId}, ${input.userId}, ${input.roleId},
            ${input.createdBy ?? null}, 'ACTIVE')
    RETURNING id, tenant_id AS "tenantId", user_id AS "userId", role_id AS "roleId",
              branch_scope AS "branchScope", status, created_by AS "createdBy"
  `);
  return (rows.rows as unknown as MembershipRow[])[0]!;
}

export async function revokeMembership(id: string): Promise<void> {
  await tenantTx().execute(
    sql`UPDATE memberships SET status = 'REVOKED', updated_at = now() WHERE id = ${id}`,
  );
}

/**
 * PHASE-004 (MULTI_TENANCY §3 rule 6): revoke every live session whose
 * active tenant is `tenantId` — the synchronous session-kill half of the
 * suspension semantics (runs inside the suspend UoW; the interceptor's
 * tenant-status check is the race backstop).
 */
export async function revokeSessionsForTenant(tenantId: string, tx?: TenantDb): Promise<number> {
  const handle = tx ?? db();
  const result = await handle.execute(sql`
    UPDATE sessions SET revoked_at = now()
    WHERE active_tenant_id = ${tenantId} AND revoked_at IS NULL
    RETURNING id
  `);
  return result.rows.length;
}

/**
 * PHASE-004 support-access read-all proxy: members of the current tenant
 * (users × memberships × roles) inside the ambient tenant scope — the
 * enumerated console read, never a write surface.
 */
export async function listTenantMembers(): Promise<
  { membershipId: string; userId: string; email: string; fullName: string; userStatus: string; roleKey: string; roleAr: string | null; membershipStatus: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT m.id AS "membershipId", u.id AS "userId", u.email, u.full_name AS "fullName",
           u.status AS "userStatus", r.key AS "roleKey", r.name_ar AS "roleAr",
           m.status AS "membershipStatus"
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    JOIN roles r ON r.id = m.role_id
    WHERE m.tenant_id = erp.current_tenant_id()
    ORDER BY m.created_at
  `);
  return rows.rows as unknown as {
    membershipId: string; userId: string; email: string; fullName: string;
    userStatus: string; roleKey: string; roleAr: string | null; membershipStatus: string;
  }[];
}

/**
 * PHASE-004 onboarding idempotency probe: the tenant's instantiated role
 * for a template key, when it already exists (clone is skipped then).
 */
export async function findTenantRoleByKey(
  tenantId: string,
  key: string,
): Promise<RoleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, tenant_id AS "tenantId", key, name, name_ar AS "nameAr", is_system AS "isSystem"
    FROM roles WHERE tenant_id = ${tenantId} AND key = ${key} AND is_system = false
    LIMIT 1
  `);
  return (rows.rows as unknown as RoleRow[])[0];
}

export async function updateMembershipRole(id: string, roleId: string): Promise<void> {
  await tenantTx().execute(
    sql`UPDATE memberships SET role_id = ${roleId}, updated_at = now(), version = version + 1
        WHERE id = ${id}`,
  );
}

// ---------------------------------------------------------------------------
// roles (tenant rows via ambient scope; system templates via definer-free
// direct read — roles RLS exposes template rows to every tenant GUC, and the
// identity service reads templates for the roles editor / cloning)

export interface RoleRow {
  id: string;
  tenantId: string | null;
  key: string;
  name: string;
  nameAr: string | null;
  isSystem: boolean;
}

export async function listTenantRoles(): Promise<RoleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, tenant_id AS "tenantId", key, name, name_ar AS "nameAr", is_system AS "isSystem"
    FROM roles WHERE tenant_id = erp.current_tenant_id()
    ORDER BY is_system DESC, key
  `);
  return rows.rows as unknown as RoleRow[];
}

export async function listSystemTemplates(): Promise<RoleRow[]> {
  // Template rows (tenant_id IS NULL) are readable under every tenant GUC by
  // the variant RLS policy; outside tenant scope the definer path is not
  // needed — templates carry no tenant data.
  const rows = await db().execute(sql`
    SELECT id, tenant_id AS "tenantId", key, name, name_ar AS "nameAr", is_system AS "isSystem"
    FROM roles WHERE tenant_id IS NULL ORDER BY key
  `);
  return rows.rows as unknown as RoleRow[];
}

export async function findRoleInTenant(tenantId: string, roleId: string): Promise<RoleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, tenant_id AS "tenantId", key, name, name_ar AS "nameAr", is_system AS "isSystem"
    FROM roles WHERE id = ${roleId} AND tenant_id = ${tenantId}
  `);
  return (rows.rows as unknown as RoleRow[])[0];
}

export async function cloneSystemTemplate(
  templateKey: string,
  tenantId: string,
): Promise<RoleRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
    SELECT ${generateUuidV7()}, ${tenantId}, r.key, r.name, r.name_ar, false
    FROM roles r WHERE r.key = ${templateKey} AND r.tenant_id IS NULL
    RETURNING id, tenant_id AS "tenantId", key, name, name_ar AS "nameAr", is_system AS "isSystem"
  `);
  const role = (rows.rows as unknown as RoleRow[])[0];
  if (role === undefined) {
    throw new Error(`system role template not found: ${templateKey}`);
  }
  await tenantTx().execute(sql`
    INSERT INTO role_permissions (role_id, tenant_id, permission_id)
    SELECT ${role.id}, ${tenantId}, rp.permission_id
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    WHERE r.key = ${templateKey} AND r.tenant_id IS NULL
    ON CONFLICT (role_id, permission_id) DO NOTHING
  `);
  return role;
}

export async function listRolePermissions(roleId: string): Promise<string[]> {
  const rows = await tenantTx().execute(sql`
    SELECT permission_id FROM role_permissions WHERE role_id = ${roleId}
  `);
  return (rows.rows as { permission_id: string }[]).map((r) => r.permission_id);
}

export async function setRolePermissions(roleId: string, keys: string[]): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM role_permissions WHERE role_id = ${roleId}`);
  for (const key of keys) {
    await tx.execute(sql`
      INSERT INTO role_permissions (role_id, tenant_id, permission_id)
      VALUES (${roleId}, erp.current_tenant_id(), ${key})
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);
  }
}

// ---------------------------------------------------------------------------
// definer projections (pre-GUC identity resolution — migration 0003)

export interface MembershipOption {
  tenantId: string;
  tenantName: string;
  tenantNameAr: string | null;
  tenantStatus: string;
  membershipId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleNameAr: string | null;
  branchScope: string[] | null;
  membershipStatus: string;
}

export async function membershipOptions(userId: string): Promise<MembershipOption[]> {
  const rows = await db().execute(
    sql`SELECT * FROM erp.user_membership_options(${userId})`,
  );
  return rows.rows as unknown as MembershipOption[];
}

export async function effectivePermissions(userId: string, tenantId: string): Promise<Set<string>> {
  const rows = await db().execute(
    sql`SELECT permission_key FROM erp.user_effective_permissions(${userId}, ${tenantId})`,
  );
  return new Set((rows.rows as { permission_key: string }[]).map((r) => r.permission_key));
}

// ---------------------------------------------------------------------------
// invitations (tenant-owned writes in ambient scope; token lookup pre-auth)

export interface InvitationRow {
  id: string;
  tenantId: string;
  email: string;
  roleId: string;
  tokenHash: string;
  expiresAt: string;
  acceptedAt: string | null;
  status: string;
  invitedBy: string;
}

export interface InvitationView {
  invitationId: string;
  tenantId: string;
  tenantName: string;
  tenantNameAr: string | null;
  tenantStatus: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleNameAr: string | null;
  status: string;
  expiresAt: string;
}

export async function insertInvitation(input: {
  tenantId: string;
  email: string;
  roleId: string;
  tokenHash: string;
  expiresAt: string;
  invitedBy: string;
  createdBy: string;
}): Promise<InvitationRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO invitations (id, tenant_id, email, role_id, token_hash, expires_at,
                             status, invited_by, created_by)
    VALUES (${generateUuidV7()}, ${input.tenantId}, ${input.email}, ${input.roleId},
            ${input.tokenHash}, ${input.expiresAt}, 'PENDING', ${input.invitedBy},
            ${input.createdBy})
    RETURNING id, tenant_id AS "tenantId", email, role_id AS "roleId",
              token_hash AS "tokenHash", expires_at AS "expiresAt",
              accepted_at AS "acceptedAt", status, invited_by AS "invitedBy"
  `);
  return (rows.rows as unknown as InvitationRow[])[0]!;
}

export async function invitationByTokenHash(tokenHash: string): Promise<InvitationView | undefined> {
  const rows = await db().execute(
    sql`SELECT * FROM erp.invitation_by_token(${tokenHash})`,
  );
  return (rows.rows as unknown as InvitationView[])[0];
}

export async function listInvitationsForTenant(tenantId: string): Promise<InvitationView[]> {
  const rows = await tenantTx().execute(sql`
    SELECT i.id AS "invitationId", i.tenant_id AS "tenantId", t.name AS "tenantName",
           t.name_ar AS "tenantNameAr", i.email, i.role_id AS "roleId",
           r.key AS "roleKey", r.name AS "roleName", r.name_ar AS "roleNameAr",
           i.status, i.expires_at AS "expiresAt"
    FROM invitations i
    JOIN tenants t ON t.id = i.tenant_id
    JOIN roles r ON r.id = i.role_id
    WHERE i.tenant_id = ${tenantId}
    ORDER BY i.created_at DESC
  `);
  return rows.rows as unknown as InvitationView[];
}

export async function markInvitationAccepted(id: string, tenantId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE invitations
    SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'PENDING'
  `);
}

export async function revokeInvitation(id: string, tenantId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE invitations
    SET status = 'REVOKED', updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'PENDING'
  `);
}

/** Expire stale invitations (idempotent maintenance, PHASE-003 §2.7). */
export async function expireStaleInvitations(tenantId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE invitations
    SET status = 'EXPIRED', updated_at = now()
    WHERE tenant_id = ${tenantId} AND status = 'PENDING' AND expires_at <= now()
  `);
}

// ---------------------------------------------------------------------------
// mfa_factors (user-owned)

export interface MfaFactorRow {
  id: string;
  userId: string;
  kind: string;
  secretEnc: string;
  confirmedAt: string | null;
  enrolledAt: string;
  lastUsedAt: string | null;
  recoveryCodesHash: string[] | null;
}

export async function findMfaFactorsForUser(userId: string): Promise<MfaFactorRow[]> {
  return (await db()
    .select()
    .from(schema.mfaFactors)
    .where(eq(schema.mfaFactors.userId, userId))) as MfaFactorRow[];
}

export async function insertMfaFactor(input: {
  userId: string;
  secretEnc: string;
}): Promise<MfaFactorRow> {
  const [row] = await db()
    .insert(schema.mfaFactors)
    .values({ id: generateUuidV7(), userId: input.userId, secretEnc: input.secretEnc })
    .returning();
  return row as MfaFactorRow;
}

export async function confirmMfaFactor(id: string, at: string): Promise<void> {
  await db().execute(sql`
    UPDATE mfa_factors SET confirmed_at = ${at}, last_used_at = ${at}
    WHERE id = ${id}
  `);
}

export async function removeMfaFactor(id: string): Promise<void> {
  await db().execute(sql`DELETE FROM mfa_factors WHERE id = ${id}`);
}

export async function clearPendingMfaFactors(userId: string): Promise<void> {
  await db().execute(sql`
    DELETE FROM mfa_factors
    WHERE user_id = ${userId} AND confirmed_at IS NULL
  `);
}

export async function setMfaLastUsed(id: string, at: string): Promise<void> {
  await db().execute(sql`UPDATE mfa_factors SET last_used_at = ${at} WHERE id = ${id}`);
}

export async function setRecoveryCodes(id: string, hashes: string[]): Promise<void> {
  // Query builder (not raw sql``): drizzle binds text[] columns correctly —
  // a raw parameter would arrive as a record and 42804.
  await db()
    .update(schema.mfaFactors)
    .set({ recoveryCodesHash: hashes })
    .where(eq(schema.mfaFactors.id, id));
}

// ---------------------------------------------------------------------------
// PHASE-024 · MFA policy (ADR-0015 §4 enforcement — migration 0036)

/**
 * The plan-level mandatory role keys for the tenant's CURRENT subscription
 * (plans.mfa_required_role_keys). Runs inside the ambient tenant scope
 * (withTenant): subscriptions are tenant-visible, plans are visible to any
 * authenticated tenant context (the plans select policy).
 */
export async function findPlanMfaRequiredRoleKeys(tenantId: string): Promise<string[]> {
  const tx = tenantTx();
  const result = await tx.execute(sql`
    SELECT p.mfa_required_role_keys AS "requiredRoleKeys"
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.tenant_id = ${tenantId}
      AND s.status IN ('ACTIVE', 'TRIAL', 'PAST_DUE', 'GRACE_READ_ONLY')
    ORDER BY s.created_at DESC
    LIMIT 1
  `);
  const row = (result.rows as unknown as { requiredRoleKeys: string[] | null }[])[0];
  return row?.requiredRoleKeys ?? [];
}

/**
 * Flip the enrollment gate on every live session of the user (the TOTP
 * confirmation inside MfaService.verify) — the proof happened once; all
 * bootstrap sessions for that user unlock together.
 */
export async function passMfaGateForUser(userId: string): Promise<void> {
  await db().execute(
    sql`UPDATE sessions SET mfa_gate_passed = true
        WHERE user_id = ${userId} AND revoked_at IS NULL AND mfa_gate_passed = false`,
  );
}

/**
 * Admin-assisted MFA reset (identity.mfa.admin_reset — SECRETS §3 S-05
 * emergency column): removes EVERY factor of the target (confirmed AND
 * pending) so a locked-out user starts clean. Audited by the caller.
 * Returns the number of factors removed.
 */
export async function clearMfaFactorsForUser(userId: string): Promise<number> {
  const result = await db().execute(
    sql`DELETE FROM mfa_factors WHERE user_id = ${userId}`,
  );
  return result.rowCount ?? 0;
}
