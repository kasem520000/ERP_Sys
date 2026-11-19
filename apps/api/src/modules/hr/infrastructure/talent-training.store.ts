import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-047 (W-3 — T-08) — the training store: the ONLY writer for the
 * training/certification half of the 0097 cluster (training_programs,
 * training_enrollments, certifications — the statutory.store
 * precedent: one store per family). All reads run under the ambient
 * tenant UoW (RLS); the cost and the percentage fields cross the
 * boundary as EXACT 2-dp decimal strings (::text, never a JS number —
 * ADR-0009's money law extended to the training budget figure).
 *
 * The evidence discipline (0097's grants): no DELETE on enrollments
 * (WITHDRAWN is the soft path) or certifications (renewal is the
 * UPDATE — the register is the compliance record); programs carry
 * DELETE (the typed RETIRED lifecycle is the service's own soft
 * path, the delete grant is the master-data floor).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface TrainingProgramRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  kind: string;
  provider: string | null;
  cost: string | null;
  status: string;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingEnrollmentRow {
  id: string;
  programId: string;
  employeeId: string;
  status: string;
  attendancePct: string | null;
  completionPct: string | null;
  result: string | null;
  completedAt: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CertificationRow {
  id: string;
  employeeId: string;
  name: string;
  nameAr: string | null;
  issuer: string;
  issueDate: string;
  expiryDate: string | null;
  certificateNumber: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const PROGRAM_COLUMNS = sql`
  id, code, name, name_ar AS "nameAr", kind, provider, cost::text AS "cost", status, notes,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const ENROLLMENT_COLUMNS = sql`
  id, program_id AS "programId", employee_id AS "employeeId", status,
  attendance_pct::text AS "attendancePct", completion_pct::text AS "completionPct",
  result, completed_at::text AS "completedAt", notes,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const CERTIFICATION_COLUMNS = sql`
  id, employee_id AS "employeeId", name, name_ar AS "nameAr", issuer,
  issue_date::text AS "issueDate", expiry_date::text AS "expiryDate",
  certificate_number AS "certificateNumber", notes,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

// ── training programs (the catalog) ────────────────────────────────────────

export async function insertProgram(input: {
  code: string;
  name: string;
  nameAr: string | null;
  kind: string;
  provider: string | null;
  cost: string | null;
  notes: string | null;
  createdBy: string | null;
}): Promise<TrainingProgramRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO training_programs
      (id, tenant_id, code, name, name_ar, kind, provider, cost, status, notes, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name},
            ${input.nameAr}, ${input.kind}, ${input.provider},
            ${input.cost === null ? null : sql`${input.cost}::numeric(19,4)`},
            'ACTIVE', ${input.notes}, ${input.createdBy})
    RETURNING ${PROGRAM_COLUMNS}
  `);
  return (rows.rows as unknown as TrainingProgramRow[])[0]!;
}

export async function findProgramById(id: string): Promise<TrainingProgramRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROGRAM_COLUMNS} FROM training_programs WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TrainingProgramRow[])[0];
}

export async function findProgramByCode(code: string): Promise<TrainingProgramRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROGRAM_COLUMNS} FROM training_programs WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as TrainingProgramRow[])[0];
}

export async function listPrograms(filter: {
  status?: string;
  limit: number;
}): Promise<TrainingProgramRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROGRAM_COLUMNS} FROM training_programs
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TrainingProgramRow[];
}

export async function updateProgram(input: {
  id: string;
  name?: string;
  nameAr?: string | null;
  provider?: string | null;
  cost?: string | null;
  status?: string;
  notes?: string | null;
}): Promise<TrainingProgramRow | undefined> {
  const arms: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`version = version + 1`];
  if (input.name !== undefined) arms.push(sql`name = ${input.name}`);
  if (input.nameAr !== undefined) arms.push(sql`name_ar = ${input.nameAr}`);
  if (input.provider !== undefined) arms.push(sql`provider = ${input.provider}`);
  if (input.cost !== undefined) {
    arms.push(
      input.cost === null
        ? sql`cost = NULL`
        : sql`cost = ${input.cost}::numeric(19,4)`,
    );
  }
  if (input.status !== undefined) arms.push(sql`status = ${input.status}`);
  if (input.notes !== undefined) arms.push(sql`notes = ${input.notes}`);
  await tenantTx().execute(sql`
    UPDATE training_programs SET ${sql.join(arms, sql`, `)}
    WHERE id = ${input.id}
  `);
  return findProgramById(input.id);
}

// ── training enrollments (the per-(program, employee) record) ──────────────

export async function insertEnrollment(input: {
  programId: string;
  employeeId: string;
  notes: string | null;
  createdBy: string | null;
}): Promise<TrainingEnrollmentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO training_enrollments
      (id, tenant_id, program_id, employee_id, status, notes, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.programId}, ${input.employeeId},
            'ENROLLED', ${input.notes}, ${input.createdBy})
    ON CONFLICT ("tenant_id", "program_id", "employee_id") DO NOTHING
    RETURNING ${ENROLLMENT_COLUMNS}
  `);
  // DO NOTHING: zero rows = the (program, employee) pair already holds
  // a record — the typed DuplicateEnrollmentError is the service's.
  return (rows.rows as unknown as TrainingEnrollmentRow[])[0];
}

export async function findEnrollmentById(id: string): Promise<TrainingEnrollmentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ENROLLMENT_COLUMNS} FROM training_enrollments WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TrainingEnrollmentRow[])[0];
}

export async function findEnrollmentByNaturalKey(input: {
  programId: string;
  employeeId: string;
}): Promise<TrainingEnrollmentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ENROLLMENT_COLUMNS} FROM training_enrollments
    WHERE program_id = ${input.programId} AND employee_id = ${input.employeeId}
    LIMIT 1
  `);
  return (rows.rows as unknown as TrainingEnrollmentRow[])[0];
}

export async function listEnrollments(filter: {
  programId?: string;
  employeeId?: string;
  limit: number;
}): Promise<TrainingEnrollmentRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ENROLLMENT_COLUMNS} FROM training_enrollments
    WHERE (${filter.programId ?? null}::uuid IS NULL OR program_id = ${filter.programId ?? null})
      AND (${filter.employeeId ?? null}::uuid IS NULL OR employee_id = ${filter.employeeId ?? null})
    ORDER BY created_at DESC, employee_id LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TrainingEnrollmentRow[];
}

/**
 * The enrollment update — the status ladder's tri-state arms (the
 * goals' update precedent: undefined = keep, null = clear; the
 * COALESCE idiom cannot express "set to NULL").
 */
export async function updateEnrollment(input: {
  id: string;
  status?: string;
  attendancePct?: string | null;
  completionPct?: string | null;
  result?: string | null;
  notes?: string | null;
}): Promise<TrainingEnrollmentRow | undefined> {
  const arms: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`version = version + 1`];
  if (input.status !== undefined) {
    arms.push(sql`status = ${input.status}`);
    // The COMPLETED edge stamps completed_at (the completion act's own
    // record — one write, the stamp rides the same statement).
    arms.push(
      input.status === "COMPLETED"
        ? sql`completed_at = now()`
        : sql`completed_at = completed_at`,
    );
  }
  if (input.attendancePct !== undefined) {
    arms.push(
      input.attendancePct === null
        ? sql`attendance_pct = NULL`
        : sql`attendance_pct = ${input.attendancePct}::numeric(5,2)`,
    );
  }
  if (input.completionPct !== undefined) {
    arms.push(
      input.completionPct === null
        ? sql`completion_pct = NULL`
        : sql`completion_pct = ${input.completionPct}::numeric(5,2)`,
    );
  }
  if (input.result !== undefined) arms.push(sql`result = ${input.result}`);
  if (input.notes !== undefined) arms.push(sql`notes = ${input.notes}`);
  await tenantTx().execute(sql`
    UPDATE training_enrollments SET ${sql.join(arms, sql`, `)}
    WHERE id = ${input.id}
  `);
  return findEnrollmentById(input.id);
}

// ── certifications (the register + the sweep's probe) ──────────────────────

export async function insertCertification(input: {
  employeeId: string;
  name: string;
  nameAr: string | null;
  issuer: string;
  issueDate: string;
  expiryDate: string | null;
  certificateNumber: string | null;
  notes: string | null;
  createdBy: string | null;
}): Promise<CertificationRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO certifications
      (id, tenant_id, employee_id, name, name_ar, issuer, issue_date, expiry_date,
       certificate_number, notes, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.employeeId}, ${input.name},
            ${input.nameAr}, ${input.issuer}, ${input.issueDate}::date,
            ${input.expiryDate === null ? null : sql`${input.expiryDate}::date`},
            ${input.certificateNumber}, ${input.notes}, ${input.createdBy})
    RETURNING ${CERTIFICATION_COLUMNS}
  `);
  return (rows.rows as unknown as CertificationRow[])[0]!;
}

export async function findCertificationById(id: string): Promise<CertificationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CERTIFICATION_COLUMNS} FROM certifications WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CertificationRow[])[0];
}

export async function listCertifications(filter: {
  employeeId?: string;
  limit: number;
}): Promise<CertificationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CERTIFICATION_COLUMNS} FROM certifications
    WHERE (${filter.employeeId ?? null}::uuid IS NULL OR employee_id = ${filter.employeeId ?? null})
    ORDER BY employee_id, issue_date DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as CertificationRow[];
}

/** The renewal act — the register's UPDATE path (no DELETE; the
 * re-issued window replaces the expiry, the issuer/number may change). */
export async function updateCertification(input: {
  id: string;
  name?: string;
  nameAr?: string | null;
  issuer?: string;
  issueDate?: string;
  expiryDate?: string | null;
  certificateNumber?: string | null;
  notes?: string | null;
}): Promise<CertificationRow | undefined> {
  const arms: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`version = version + 1`];
  if (input.name !== undefined) arms.push(sql`name = ${input.name}`);
  if (input.nameAr !== undefined) arms.push(sql`name_ar = ${input.nameAr}`);
  if (input.issuer !== undefined) arms.push(sql`issuer = ${input.issuer}`);
  if (input.issueDate !== undefined) arms.push(sql`issue_date = ${input.issueDate}::date`);
  if (input.expiryDate !== undefined) {
    arms.push(
      input.expiryDate === null
        ? sql`expiry_date = NULL`
        : sql`expiry_date = ${input.expiryDate}::date`,
    );
  }
  if (input.certificateNumber !== undefined) arms.push(sql`certificate_number = ${input.certificateNumber}`);
  if (input.notes !== undefined) arms.push(sql`notes = ${input.notes}`);
  await tenantTx().execute(sql`
    UPDATE certifications SET ${sql.join(arms, sql`, `)}
    WHERE id = ${input.id}
  `);
  return findCertificationById(input.id);
}
