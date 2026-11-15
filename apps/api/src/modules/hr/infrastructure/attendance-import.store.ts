import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-05) — the device-import store: the import log
 * (attendance_import_batches — the file FINGERPRINT floor), the anomaly
 * quarantine (attendance_import_anomalies), the mapping setting
 * (tenant_settings key `hr.attendance.import.map` — the communication
 * module's direct-key precedent), and the import-specific reads
 * (employee code → id, the existing sessions as TENANT-TZ WALL-CLOCK
 * milliseconds — the analysis space; the naive→instant conversion
 * happens ONLY here at the DB boundary, `AT TIME ZONE` the tenant's
 * tz — never in float-parsed TS date strings).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface ImportBatchRow {
  id: string;
  fileName: string;
  fileSha256: string;
  fileSize: number;
  rowCount: number;
  importedCount: number;
  quarantineCount: number;
  deviceRef: string | null;
  mapping: unknown;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
}

export interface ImportAnomalyRow {
  id: string;
  batchId: string;
  lineNo: number;
  employeeCode: string | null;
  punchAt: string | null;
  direction: string | null;
  reason: string;
  detail: string | null;
  rawLine: string;
  status: string;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** An existing session in the ANALYSIS space: the punch instants as
 * tenant-tz WALL-CLOCK milliseconds (the same space the file's parsed
 * timestamps live in — comparisons are exact integer math). */
export interface ExistingSessionRow {
  employeeId: string;
  workDate: string;
  checkInWcMs: number | null;
  checkOutWcMs: number | null;
}

export const MAPPING_SETTING_KEY = "hr.attendance.import.map";

// -- the import log -----------------------------------------------------------------

export async function findImportBatchByFingerprint(sha256: string): Promise<ImportBatchRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, file_name AS "fileName", file_sha256::text AS "fileSha256",
           file_size AS "fileSize", row_count AS "rowCount",
           imported_count AS "importedCount", quarantine_count AS "quarantineCount",
           device_ref AS "deviceRef", mapping, note, note_ar AS "noteAr",
           created_at::text AS "createdAt"
    FROM attendance_import_batches
    WHERE file_sha256 = ${sha256}::char(64)
    LIMIT 1
  `);
  return (rows.rows as unknown as ImportBatchRow[])[0];
}

export async function insertImportBatch(input: {
  fileName: string;
  fileSha256: string;
  fileSize: number;
  rowCount: number;
  importedCount: number;
  quarantineCount: number;
  deviceRef: string | null;
  mapping: unknown;
  note: string | null;
  createdBy: string | null;
}): Promise<ImportBatchRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO attendance_import_batches (id, tenant_id, file_name, file_sha256, file_size,
                                           row_count, imported_count, quarantine_count,
                                           device_ref, mapping, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.fileName}, ${input.fileSha256}::char(64),
            ${input.fileSize}, ${input.rowCount}, ${input.importedCount}, ${input.quarantineCount},
            ${input.deviceRef}, ${JSON.stringify(input.mapping)}::jsonb, ${input.note}, ${input.createdBy})
  `);
  const rows = await tenantTx().execute(sql`
    SELECT id, file_name AS "fileName", file_sha256::text AS "fileSha256",
           file_size AS "fileSize", row_count AS "rowCount",
           imported_count AS "importedCount", quarantine_count AS "quarantineCount",
           device_ref AS "deviceRef", mapping, note, note_ar AS "noteAr",
           created_at::text AS "createdAt"
    FROM attendance_import_batches WHERE id = ${id}
  `);
  return (rows.rows as unknown as ImportBatchRow[])[0]!;
}

export async function listImportBatches(filter: {
  limit: number;
  offset: number;
}): Promise<ImportBatchRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, file_name AS "fileName", file_sha256::text AS "fileSha256",
           file_size AS "fileSize", row_count AS "rowCount",
           imported_count AS "importedCount", quarantine_count AS "quarantineCount",
           device_ref AS "deviceRef", mapping, note, note_ar AS "noteAr",
           created_at::text AS "createdAt"
    FROM attendance_import_batches
    ORDER BY created_at DESC
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `);
  return rows.rows as unknown as ImportBatchRow[];
}

export async function countImportBatches(): Promise<number> {
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM attendance_import_batches
  `);
  return rows.rows[0]!.n;
}

// -- the quarantine ------------------------------------------------------------------

/** The anomaly inserts ride ONE chunked statement family (bounded at
 * 500 rows per statement — an import file's quarantine is bounded by
 * its line count; the rotation chunk law's shape). */
const ANOMALY_CHUNK_ROWS = 500;

export async function insertImportAnomalies(
  rowsInput: readonly {
    batchId: string;
    lineNo: number;
    employeeCode: string | null;
    punchAt: string | null;
    direction: string | null;
    reason: string;
    detail: string | null;
    rawLine: string;
    createdBy: string | null;
  }[],
): Promise<number> {
  if (rowsInput.length === 0) return 0;
  for (let start = 0; start < rowsInput.length; start += ANOMALY_CHUNK_ROWS) {
    const chunk = rowsInput.slice(start, start + ANOMALY_CHUNK_ROWS);
    const values = chunk.map(
      (row) => sql`(${generateUuidV7()}, erp.current_tenant_id(), ${row.batchId}, ${row.lineNo},
                     ${row.employeeCode}, ${row.punchAt}, ${row.direction}, ${row.reason}::text,
                     ${row.detail}, ${row.rawLine}, 'PENDING', ${row.createdBy})`,
    );
    await tenantTx().execute(sql`
      INSERT INTO attendance_import_anomalies (id, tenant_id, batch_id, line_no, employee_code,
                                                punch_at, direction, reason, detail, raw_line,
                                                status, created_by)
      VALUES ${sql.join(values, sql`, `)}
    `);
  }
  return rowsInput.length;
}

export async function listImportAnomalies(filter: {
  batchId?: string;
  status?: string;
  limit: number;
  offset: number;
}): Promise<ImportAnomalyRow[]> {
  const batchFilter = filter.batchId === undefined ? sql`true` : sql`batch_id = ${filter.batchId}::uuid`;
  const statusFilter = filter.status === undefined ? sql`true` : sql`status = ${filter.status}::text`;
  const rows = await tenantTx().execute(sql`
    SELECT id, batch_id::text AS "batchId", line_no AS "lineNo",
           employee_code AS "employeeCode", punch_at AS "punchAt", direction, reason,
           detail, raw_line AS "rawLine", status,
           resolution_note AS "resolutionNote", resolved_by::text AS "resolvedBy",
           resolved_at::text AS "resolvedAt", created_at::text AS "createdAt"
    FROM attendance_import_anomalies
    WHERE ${batchFilter} AND ${statusFilter}
    ORDER BY line_no
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `);
  return rows.rows as unknown as ImportAnomalyRow[];
}

export async function countImportAnomalies(filter: {
  batchId?: string;
  status?: string;
}): Promise<number> {
  const batchFilter = filter.batchId === undefined ? sql`true` : sql`batch_id = ${filter.batchId}::uuid`;
  const statusFilter = filter.status === undefined ? sql`true` : sql`status = ${filter.status}::text`;
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM attendance_import_anomalies
    WHERE ${batchFilter} AND ${statusFilter}
  `);
  return rows.rows[0]!.n;
}

export async function findImportAnomalyById(id: string): Promise<ImportAnomalyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, batch_id::text AS "batchId", line_no AS "lineNo",
           employee_code AS "employeeCode", punch_at AS "punchAt", direction, reason,
           detail, raw_line AS "rawLine", status,
           resolution_note AS "resolutionNote", resolved_by::text AS "resolvedBy",
           resolved_at::text AS "resolvedAt", created_at::text AS "createdAt"
    FROM attendance_import_anomalies
    WHERE id = ${id}
    LIMIT 1
  `);
  return (rows.rows as unknown as ImportAnomalyRow[])[0];
}

/** The resolution write — one-shot (WHERE status = 'PENDING'); a row
 * already resolved touches zero rows and the caller renders the typed
 * lifecycle conflict. */
export async function resolveImportAnomaly(input: {
  id: string;
  status: "RESOLVED" | "REJECTED";
  resolutionNote: string | null;
  resolvedBy: string | null;
}): Promise<ImportAnomalyRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE attendance_import_anomalies SET
      status = ${input.status}::text, resolution_note = ${input.resolutionNote},
      resolved_by = ${input.resolvedBy}, resolved_at = now(),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'PENDING'
  `);
  return findImportAnomalyById(input.id);
}

// -- the import-specific reads ---------------------------------------------------------

/** Map employee CODES → ids under RLS (the import's code axis — device
 * files identify people by their printed code, not by uuid). */
export async function employeeIdsByCodes(codes: readonly string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const distinct = [...new Set(codes)];
  const rows = await tenantTx().execute<{ code: string; id: string }>(sql`
    SELECT code, id::text AS id FROM employees
    WHERE status = 'ACTIVE' AND code IN (${sql.join(
      distinct.map((code) => sql`${code}`),
      sql`, `,
    )})
  `);
  return new Map(rows.rows.map((row) => [row.code, row.id]));
}

/** The existing sessions of a date window as TENANT-TZ WALL-CLOCK
 * milliseconds — the analysis space (the naive local instants the
 * device file carries, compared exactly). */
export async function listExistingSessionsWallClock(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
}): Promise<ExistingSessionRow[]> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`a.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = await tenantTx().execute<{
    employeeId: string;
    workDate: string;
    checkInWc: string | null;
    checkOutWc: string | null;
  }>(sql`
    SELECT a.employee_id::text AS "employeeId", a.work_date::text AS "workDate",
           (EXTRACT(EPOCH FROM (a.check_in AT TIME ZONE
              (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()))) * 1000)::bigint::text AS "checkInWc",
           (EXTRACT(EPOCH FROM (a.check_out AT TIME ZONE
              (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()))) * 1000)::bigint::text AS "checkOutWc"
    FROM attendance_records a
    WHERE a.check_in IS NOT NULL
      AND a.work_date >= ${filter.from}::date AND a.work_date <= ${filter.to}::date
      AND ${employeeFilter}
  `);
  return rows.rows.map((row) => ({
    employeeId: row.employeeId,
    workDate: row.workDate,
    checkInWcMs: row.checkInWc === null ? null : Number(row.checkInWc),
    checkOutWcMs: row.checkOutWc === null ? null : Number(row.checkOutWc),
  }));
}

/** Insert an IMPORTED session: the punch instants arrive as NAIVE
 * tenant-local wall-clock strings (`YYYY-MM-DD HH:MM:SS` — the device
 * file's space) and convert to timestamptz HERE, `AT TIME ZONE` the
 * tenant's tz — the single conversion point. The 0081 CHECKs
 * (import-shape ⇔ batch, device-ref ⇔ DEVICE) are the floor; the
 * service validated everything typed BEFORE this write. */
export async function insertImportedRecord(input: {
  employeeId: string;
  workDate: string;
  checkInNaive: string;
  checkOutNaive: string | null;
  importBatchId: string;
  note: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO attendance_records (id, tenant_id, employee_id, work_date, check_in, check_out,
                                    source, device_ref, import_batch_id, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.employeeId},
            ${input.workDate}::date,
            (${input.checkInNaive}::timestamp AT TIME ZONE
               (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id())),
            ${input.checkOutNaive === null
              ? null
              : sql`(${input.checkOutNaive}::timestamp AT TIME ZONE
                       (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()))`},
            'IMPORT', NULL, ${input.importBatchId}, ${input.note}, ${input.createdBy})
  `);
}

// -- the tenant's wall-clock helpers ----------------------------------------------------

/** Today's date in the tenant's timezone (the analysis horizon's
 * anchor — a device file's dates are wall-clock dates). */
export async function tenantTodayNaive(): Promise<string> {
  const rows = await tenantTx().execute<{ today: string }>(sql`
    SELECT (now() AT TIME ZONE
              (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()))::date::text AS today
  `);
  return rows.rows[0]!.today;
}

/** An ISO instant → the tenant's NAIVE local wall-clock string — the
 * resolve-IMPORT path's conversion (the reviewer sends instants; the
 * capture laws compare in the file's wall-clock space). */
export async function instantToNaiveLocal(instant: string): Promise<string> {
  const rows = await tenantTx().execute<{ naive: string }>(sql`
    SELECT to_char((${instant}::timestamptz) AT TIME ZONE
              (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()),
              'YYYY-MM-DD HH24:MI:SS') AS naive
  `);
  return rows.rows[0]!.naive;
}

// -- the mapping setting (tenant_settings — the direct-key precedent) -------------------

export async function readMappingSetting(): Promise<unknown | undefined> {
  const rows = await tenantTx().execute<{ value: unknown }>(sql`
    SELECT value FROM tenant_settings
    WHERE key = ${MAPPING_SETTING_KEY} AND tenant_id = erp.current_tenant_id()
    LIMIT 1
  `);
  return rows.rows[0]?.value;
}

export async function saveMappingSetting(value: unknown, updatedBy: string | null): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${MAPPING_SETTING_KEY},
            ${JSON.stringify(value)}::jsonb, ${updatedBy})
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
          updated_at = now(), version = tenant_settings.version + 1
  `);
}
