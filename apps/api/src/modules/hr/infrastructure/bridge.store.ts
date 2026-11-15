import { sql } from "drizzle-orm";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-09) — the employee ↔ user identity-bridge store (HR-13).
 * The link lives on the employees row (`user_id`, migration 0085) — the
 * tenant-scoped reads/writes ride the ambient tenant transaction (RLS);
 * the USERS side (the global table) is the identity module's surface and
 * is read through its api barrel by the service, never here.
 *
 * THE GUARD (0085): the partial UNIQUE (tenant_id, user_id) WHERE
 * user_id IS NOT NULL — one user maps to at most ONE employee per
 * tenant at any moment; the service refuses a taken user BEFORE the
 * write and the floor catches the race (23505 surfaced typed).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface BridgeEmployeeRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  status: string;
  userId: string | null;
}

const COLUMNS = sql`
  id, code, name, name_ar AS "nameAr", status, user_id::text AS "userId"
`;

/** The tenant-scoped employee read the bridge reasons over (RLS: a
 * foreign tenant's employee is indistinguishable from an unknown id —
 * the A7 law). */
export async function findBridgeEmployeeById(id: string): Promise<BridgeEmployeeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COLUMNS} FROM employees WHERE id = ${id}::uuid LIMIT 1
  `);
  return (rows.rows as unknown as BridgeEmployeeRow[])[0];
}

/** THE UNIQUENESS GUARD'S READ: the employee (if any) a user is already
 * linked to in THIS tenant — the pre-write check + the OWN-rows scope
 * resolver (the self-service substrate, T-14). */
export async function findEmployeeByUser(userId: string): Promise<BridgeEmployeeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COLUMNS} FROM employees WHERE user_id = ${userId}::uuid LIMIT 1
  `);
  return (rows.rows as unknown as BridgeEmployeeRow[])[0];
}

/** Write the link (the service has proven: the employee exists, carries
 * no link, and the user is an unlinked active member). */
export async function linkUser(employeeId: string, userId: string): Promise<BridgeEmployeeRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE employees SET user_id = ${userId}::uuid, updated_at = now(), version = version + 1
    WHERE id = ${employeeId}::uuid
  `);
  return findBridgeEmployeeById(employeeId);
}

/** Clear the link (the audited way a link moves — never an overwrite). */
export async function unlinkUser(employeeId: string): Promise<BridgeEmployeeRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE employees SET user_id = NULL, updated_at = now(), version = version + 1
    WHERE id = ${employeeId}::uuid
  `);
  return findBridgeEmployeeById(employeeId);
}

/** The ACTIVE-membership check (memberships is tenant-RLS'd — under the
 * ambient scope this reads THIS tenant's rows only, never another
 * tenant's membership facts). */
export async function userHasActiveMembership(userId: string): Promise<boolean> {
  const rows = await tenantTx().execute<{ present: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM memberships WHERE user_id = ${userId}::uuid AND status = 'ACTIVE'
    ) AS present
  `);
  return rows.rows[0]?.present === true;
}
