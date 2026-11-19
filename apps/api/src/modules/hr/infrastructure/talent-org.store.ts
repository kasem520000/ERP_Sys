import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-047 (W-3 — T-08/T-09) — the org/documents store: the ONLY
 * writer for the org half of the 0097 cluster (org_units, positions,
 * employee_documents — the statutory.store precedent: one store per
 * family). All reads run under the ambient tenant UoW (RLS).
 *
 * THE ORG MOVE (D-09's cycle-safe law, the materialized-path
 * substrate): `moveOrgUnit` is the tree's ONE structural act — the
 * moved unit's own row re-parents and re-paths, and EVERY descendant
 * re-paths in the SAME set-based statement (the prefix rewrite:
 * `newPath || substring(path from length(oldPath)+1)` — the subtree
 * stays coherent atomically; the pure `wouldCreateCycle` guard and
 * the T-20 org-plane gate run BEFORE any of this, in the service).
 * The path grammar: dot-joined unit CODES, root = own code — the
 * service's dot-free org-code law keeps the grammar unambiguous.
 *
 * [Dated 2026-11-19 (W-4, the owner's W-3 verification finding NF-9):
 * the descendant match is `starts_with(path, oldPath || '.')` —
 * LITERAL prefix semantics, never a LIKE pattern. The W-3 shape
 * `path LIKE ${oldPath}.%` carried a real hole: org codes legally
 * contain the underscore (ORG_CODE_RE) and `_` is a single-character
 * WILDCARD in LIKE — proven on a live cluster, the pattern
 * 'SALES_EAST.%' matched BOTH `SALES_EAST.child` AND
 * `SALESXEAST.otherchild`, so a sibling tree whose code matched at
 * the underscore position would have its path corrupted by the move.
 * `starts_with` matches the literal prefix only — the adversarial
 * close-code arm (SALES_EAST vs SALESXEAST siblings) is pinned in
 * talent-training-org.db.spec.ts (d).]
 *
 * THE POSITIONS RE-PARENT: `updatePosition` rides the same pure guard
 * (reports_to); the reports_to edge set read (`listPositionEdges`) is
 * the guard's substrate.
 *
 * The documents register (HR-10): operational data incl. DELETE
 * (replacement is a normal HR operation; the audit trail lives in
 * audit_events) — the only DELETE writer in the W-3 plane.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface OrgUnitRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  path: string;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PositionRow {
  id: string;
  code: string;
  title: string;
  titleAr: string | null;
  grade: string | null;
  orgUnitId: string | null;
  reportsTo: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDocumentRow {
  id: string;
  employeeId: string;
  kind: string;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const ORG_UNIT_COLUMNS = sql`
  id, code, name, name_ar AS "nameAr", parent_id AS "parentId", path, active,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const POSITION_COLUMNS = sql`
  id, code, title, title_ar AS "titleAr", grade, org_unit_id AS "orgUnitId",
  reports_to AS "reportsTo", status,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const DOCUMENT_COLUMNS = sql`
  id, employee_id AS "employeeId", kind, number, issued_on::text AS "issuedOn",
  expires_on::text AS "expiresOn", notes,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

// ── org units (the cycle-safe tree, D-09) ──────────────────────────────────

export async function insertOrgUnit(input: {
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  parentPath: string | null;
  createdBy: string | null;
}): Promise<OrgUnitRow> {
  // The path grammar: dot-joined codes, root = own code (the service
  // validates the parent exists and the code is dot-free).
  const path = input.parentPath === null ? input.code : `${input.parentPath}.${input.code}`;
  const rows = await tenantTx().execute(sql`
    INSERT INTO org_units (id, tenant_id, code, name, name_ar, parent_id, path, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name},
            ${input.nameAr}, ${input.parentId}, ${path}, ${input.createdBy})
    RETURNING ${ORG_UNIT_COLUMNS}
  `);
  return (rows.rows as unknown as OrgUnitRow[])[0]!;
}

export async function findOrgUnitById(id: string): Promise<OrgUnitRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORG_UNIT_COLUMNS} FROM org_units WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as OrgUnitRow[])[0];
}

export async function findOrgUnitByCode(code: string): Promise<OrgUnitRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORG_UNIT_COLUMNS} FROM org_units WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as OrgUnitRow[])[0];
}

export async function listOrgUnits(): Promise<OrgUnitRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORG_UNIT_COLUMNS} FROM org_units ORDER BY path, code
  `);
  return rows.rows as unknown as OrgUnitRow[];
}

/** The D-09 guard's substrate: the tree's whole parent-edge set (the
 * pure `wouldCreateCycle` walks this — the service's read). */
export async function listOrgUnitEdges(): Promise<
  ReadonlyArray<{ id: string; parentId: string | null }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, parent_id AS "parentId" FROM org_units
  `);
  return rows.rows as unknown as { id: string; parentId: string | null }[];
}

/**
 * THE ORG MOVE (D-09 + the materialized path): TWO guarded statements
 * in the ONE ambient tenant UoW — (1) the unit's own re-parent/re-path
 * (the WHERE pins the CURRENT parent, so a raced move matches zero
 * rows and the whole act refuses, nothing written); (2) every
 * descendant's prefix rewrite (`newPath || substring(path from
 * length(oldPath)+1)`), excluding the moved unit itself — the subtree
 * stays coherent atomically. The cycle guard + the T-20 org-plane
 * gate have already run (the service).
 */
export async function moveOrgUnit(input: {
  id: string;
  expectedParentId: string | null;
  newParentId: string | null;
  newPath: string;
  oldPath: string;
}): Promise<OrgUnitRow | undefined> {
  const own = await tenantTx().execute(sql`
    UPDATE org_units SET
      parent_id = ${input.newParentId}, path = ${input.newPath},
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND parent_id IS NOT DISTINCT FROM ${input.expectedParentId}
    RETURNING ${ORG_UNIT_COLUMNS}
  `);
  const moved = (own.rows as unknown as OrgUnitRow[])[0];
  if (moved === undefined) return undefined;
  await tenantTx().execute(sql`
    UPDATE org_units SET
      path = ${input.newPath} || substring(path from ${sql`length(${input.oldPath}) + 1`}),
      updated_at = now(), version = version + 1
    WHERE starts_with(path, ${input.oldPath} || '.') AND id <> ${input.id}
  `);
  return moved;
}

/** The rename/active patch (no re-parent — the move is the dedicated
 * act; a rename does NOT rewrite paths: codes are immutable, the path
 * grammar rides them). */
export async function patchOrgUnit(input: {
  id: string;
  name?: string;
  nameAr?: string | null;
  active?: boolean;
}): Promise<OrgUnitRow | undefined> {
  const arms: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`version = version + 1`];
  if (input.name !== undefined) arms.push(sql`name = ${input.name}`);
  if (input.nameAr !== undefined) arms.push(sql`name_ar = ${input.nameAr}`);
  if (input.active !== undefined) arms.push(sql`active = ${input.active}`);
  await tenantTx().execute(sql`
    UPDATE org_units SET ${sql.join(arms, sql`, `)}
    WHERE id = ${input.id}
  `);
  return findOrgUnitById(input.id);
}

// ── positions (the bilingual slots + reports_to) ───────────────────────────

export async function insertPosition(input: {
  code: string;
  title: string;
  titleAr: string | null;
  grade: string | null;
  orgUnitId: string | null;
  reportsTo: string | null;
  createdBy: string | null;
}): Promise<PositionRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO positions
      (id, tenant_id, code, title, title_ar, grade, org_unit_id, reports_to, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.title},
            ${input.titleAr}, ${input.grade}, ${input.orgUnitId}, ${input.reportsTo},
            ${input.createdBy})
    RETURNING ${POSITION_COLUMNS}
  `);
  return (rows.rows as unknown as PositionRow[])[0]!;
}

export async function findPositionById(id: string): Promise<PositionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${POSITION_COLUMNS} FROM positions WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PositionRow[])[0];
}

export async function findPositionByCode(code: string): Promise<PositionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${POSITION_COLUMNS} FROM positions WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as PositionRow[])[0];
}

export async function listPositions(filter: {
  orgUnitId?: string;
  limit: number;
}): Promise<PositionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${POSITION_COLUMNS} FROM positions
    WHERE (${filter.orgUnitId ?? null}::uuid IS NULL OR org_unit_id = ${filter.orgUnitId ?? null})
    ORDER BY code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as PositionRow[];
}

/** The D-09 guard's substrate for the reports_to edges. */
export async function listPositionEdges(): Promise<
  ReadonlyArray<{ id: string; reportsTo: string | null }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, reports_to AS "reportsTo" FROM positions
  `);
  return rows.rows as unknown as { id: string; reportsTo: string | null }[];
}

/** The position patch — the re-parent arm rides the pure cycle guard
 * (the service's check-then-write window closes under the T-20
 * org-plane gate); the WHERE pins the CURRENT reports_to so a raced
 * re-parent matches zero rows. */
export async function updatePosition(input: {
  id: string;
  expectedReportsTo: string | null;
  title?: string;
  titleAr?: string | null;
  grade?: string | null;
  orgUnitId?: string | null;
  reportsTo?: string | null;
  status?: string;
}): Promise<PositionRow | undefined> {
  const arms: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`version = version + 1`];
  if (input.title !== undefined) arms.push(sql`title = ${input.title}`);
  if (input.titleAr !== undefined) arms.push(sql`title_ar = ${input.titleAr}`);
  if (input.grade !== undefined) arms.push(sql`grade = ${input.grade}`);
  if (input.orgUnitId !== undefined) arms.push(sql`org_unit_id = ${input.orgUnitId}`);
  if (input.reportsTo !== undefined) arms.push(sql`reports_to = ${input.reportsTo}`);
  if (input.status !== undefined) arms.push(sql`status = ${input.status}`);
  const rows = await tenantTx().execute(sql`
    UPDATE positions SET ${sql.join(arms, sql`, `)}
    WHERE id = ${input.id} AND reports_to IS NOT DISTINCT FROM ${input.expectedReportsTo}
    RETURNING ${POSITION_COLUMNS}
  `);
  return (rows.rows as unknown as PositionRow[])[0];
}

// ── employee documents (the register, HR-10) ───────────────────────────────

export async function insertEmployeeDocument(input: {
  employeeId: string;
  kind: string;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  createdBy: string | null;
}): Promise<EmployeeDocumentRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO employee_documents
      (id, tenant_id, employee_id, kind, number, issued_on, expires_on, notes, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.employeeId}, ${input.kind},
            ${input.number},
            ${input.issuedOn === null ? null : sql`${input.issuedOn}::date`},
            ${input.expiresOn === null ? null : sql`${input.expiresOn}::date`},
            ${input.notes}, ${input.createdBy})
    RETURNING ${DOCUMENT_COLUMNS}
  `);
  return (rows.rows as unknown as EmployeeDocumentRow[])[0]!;
}

export async function findEmployeeDocumentById(
  id: string,
): Promise<EmployeeDocumentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DOCUMENT_COLUMNS} FROM employee_documents WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as EmployeeDocumentRow[])[0];
}

export async function listEmployeeDocuments(filter: {
  employeeId?: string;
  kind?: string;
  limit: number;
}): Promise<EmployeeDocumentRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DOCUMENT_COLUMNS} FROM employee_documents
    WHERE (${filter.employeeId ?? null}::uuid IS NULL OR employee_id = ${filter.employeeId ?? null})
      AND (${filter.kind ?? null}::text IS NULL OR kind = ${filter.kind ?? null})
    ORDER BY employee_id, kind, created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as EmployeeDocumentRow[];
}

export async function updateEmployeeDocument(input: {
  id: string;
  number?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
}): Promise<EmployeeDocumentRow | undefined> {
  const arms: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`version = version + 1`];
  if (input.number !== undefined) arms.push(sql`number = ${input.number}`);
  if (input.issuedOn !== undefined) {
    arms.push(
      input.issuedOn === null ? sql`issued_on = NULL` : sql`issued_on = ${input.issuedOn}::date`,
    );
  }
  if (input.expiresOn !== undefined) {
    arms.push(
      input.expiresOn === null
        ? sql`expires_on = NULL`
        : sql`expires_on = ${input.expiresOn}::date`,
    );
  }
  if (input.notes !== undefined) arms.push(sql`notes = ${input.notes}`);
  await tenantTx().execute(sql`
    UPDATE employee_documents SET ${sql.join(arms, sql`, `)}
    WHERE id = ${input.id}
  `);
  return findEmployeeDocumentById(input.id);
}

/** The register's one DELETE (operational data — replacement is a
 * normal HR operation; the audit event is the service's record). */
export async function deleteEmployeeDocument(id: string): Promise<EmployeeDocumentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    DELETE FROM employee_documents WHERE id = ${id} RETURNING ${DOCUMENT_COLUMNS}
  `);
  return (rows.rows as unknown as EmployeeDocumentRow[])[0];
}

// ── the substrate reads (the frozen employees table — READ ONLY, D-01) ─────

/** The hire link's existence check + the sweep's label read: the
 * employee's code/name under RLS (never a write — D-01's law). */
export async function findEmployeeBrief(
  employeeId: string,
): Promise<{ id: string; code: string; name: string; probationEnd: string | null } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, probation_end::text AS "probationEnd"
    FROM employees WHERE id = ${employeeId} LIMIT 1
  `);
  return (rows.rows as unknown as { id: string; code: string; name: string; probationEnd: string | null }[])[0];
}
