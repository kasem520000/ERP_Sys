import { sql } from "drizzle-orm";

import { getDb } from "../../../infra/db/client";
import type { TenantDb } from "../../../infra/db/tenant-context";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-013 · reporting infrastructure store (migration 0020): the run
 * orchestration rows + the print-template registry. Plain exported
 * functions on the ambient tenant transaction — the established store
 * pattern (RLS + explicit tenant_id double-enforced).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("reporting access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface ReportRunRow {
  id: string;
  reportKey: string;
  contractVersion: number;
  params: Record<string, unknown>;
  paramsHash: string;
  executionClass: "inline" | "job";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string | null;
  requestedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorDetail: Record<string, unknown> | null;
  assertionStatus: "PASS" | "FAIL" | null;
  result: Record<string, unknown> | null;
  assertions: unknown[] | null;
  artifacts: unknown[] | null;
  correlationId: string | null;
  createdAt: string;
}

interface RunRowShape {
  id: string;
  report_key: string;
  contract_version: number;
  params: Record<string, unknown>;
  params_hash: string;
  execution_class: string;
  status: string;
  stage: string | null;
  requested_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_detail: Record<string, unknown> | null;
  assertion_status: string | null;
  result: Record<string, unknown> | null;
  assertions: unknown[] | null;
  artifacts: unknown[] | null;
  correlation_id: string | null;
  created_at: string;
}

function toRow(row: RunRowShape): ReportRunRow {
  return {
    id: row.id,
    reportKey: row.report_key,
    contractVersion: row.contract_version,
    params: row.params,
    paramsHash: row.params_hash,
    executionClass: row.execution_class as ReportRunRow["executionClass"],
    status: row.status as ReportRunRow["status"],
    stage: row.stage,
    requestedBy: row.requested_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    assertionStatus: (row.assertion_status as ReportRunRow["assertionStatus"]) ?? null,
    result: row.result,
    assertions: row.assertions,
    artifacts: row.artifacts,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

const RUN_COLUMNS = sql`id, report_key, contract_version, params, params_hash,
  execution_class, status, stage, requested_by, started_at, finished_at,
  duration_ms, error_code, error_detail, assertion_status, result, assertions,
  artifacts, correlation_id, created_at`;

export interface InsertRunInput {
  id: string;
  reportKey: string;
  contractVersion: number;
  params: Record<string, unknown>;
  paramsHash: string;
  executionClass: "inline" | "job";
  requestedBy: string | null;
  correlationId: string | null;
}

/**
 * Insert-or-take-over the run row: unique (tenant, report_key, params_hash)
 * means a re-run REPLACES its own record (idempotent — artifacts never
 * duplicate). The previous attempt's artifacts list is cleared here; the
 * export service re-writes artifacts under the same run id.
 */
export async function upsertRun(input: InsertRunInput): Promise<ReportRunRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO report_runs (id, tenant_id, report_key, contract_version, params,
                             params_hash, execution_class, status, stage,
                             requested_by, correlation_id)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.reportKey},
            ${input.contractVersion}, ${JSON.stringify(input.params)}::jsonb, ${input.paramsHash},
            ${input.executionClass}, ${input.executionClass === "job" ? "QUEUED" : "RUNNING"},
            ${input.executionClass === "job" ? "queued" : "querying"},
            ${input.requestedBy}, ${input.correlationId})
    ON CONFLICT (tenant_id, report_key, params_hash) DO UPDATE SET
      id = EXCLUDED.id,
      contract_version = EXCLUDED.contract_version,
      execution_class = EXCLUDED.execution_class,
      status = EXCLUDED.status,
      stage = EXCLUDED.stage,
      requested_by = EXCLUDED.requested_by,
      correlation_id = EXCLUDED.correlation_id,
      started_at = NULL,
      finished_at = NULL,
      duration_ms = NULL,
      error_code = NULL,
      error_detail = NULL,
      assertion_status = NULL,
      result = NULL,
      assertions = NULL,
      artifacts = NULL,
      created_at = now()
    RETURNING ${RUN_COLUMNS}
  `);
  return toRow((rows.rows as unknown as RunRowShape[])[0]!);
}

export async function markRunning(runId: string, stage: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE report_runs SET status = 'RUNNING', stage = ${stage},
      started_at = COALESCE(started_at, now())
    WHERE id = ${runId}
  `);
}

export async function setStage(runId: string, stage: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE report_runs SET stage = ${stage} WHERE id = ${runId}
  `);
}

export interface CompleteRunInput {
  result: Record<string, unknown>;
  assertions: readonly unknown[];
  assertionStatus: "PASS" | "FAIL";
  durationMs: number;
}

export async function completeRun(runId: string, input: CompleteRunInput): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE report_runs SET
      status = 'SUCCEEDED',
      stage = 'done',
      finished_at = now(),
      duration_ms = ${input.durationMs},
      result = ${JSON.stringify(input.result)}::jsonb,
      assertions = ${JSON.stringify(input.assertions)}::jsonb,
      assertion_status = ${input.assertionStatus}
    WHERE id = ${runId}
  `);
}

export async function failRun(
  runId: string,
  errorCode: string,
  errorDetail: Record<string, unknown>,
  durationMs: number,
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE report_runs SET
      status = 'FAILED',
      stage = 'failed',
      -- PHASE-013 fix (T-TESTS): a pre-execution failure (FORBIDDEN_AT_RUN)
      -- hits a QUEUED row whose started_at is still NULL; the
      -- ck_report_runs_finished_requires_started check then rejected the
      -- finished_at write, so the typed error never surfaced. Start the
      -- attempt at the failure moment when nothing ran before it.
      started_at = COALESCE(started_at, now()),
      finished_at = now(),
      duration_ms = ${durationMs},
      error_code = ${errorCode},
      error_detail = ${JSON.stringify(errorDetail)}::jsonb,
      artifacts = NULL
    WHERE id = ${runId}
  `);
}

/**
 * PHASE-013 fix (T-TESTS): the FORBIDDEN_AT_RUN failure record must SURVIVE
 * the caller's rollback. `executeJob` writes the failure row and then throws
 * ForbiddenAtRunError; when the caller wraps it in `withTenant` (the pg-boss
 * worker path does), the thrown error rolls the whole UoW back — including
 * the failure write — so the run row stayed QUEUED forever (pg-boss retried
 * into the same wall). This variant commits on its own pooled connection
 * with the tenant GUC set transaction-locally, exactly like withTenant but
 * independent of the ambient (about-to-roll-back) transaction.
 */
export async function failRunIsolated(input: {
  tenantId: string;
  runId: string;
  errorCode: string;
  errorDetail: Record<string, unknown>;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('erp.tenant_id', ${input.tenantId}, true)`);
    await tx.execute(sql`
      UPDATE report_runs SET
        status = 'FAILED',
        stage = 'failed',
        started_at = COALESCE(started_at, now()),
        finished_at = now(),
        duration_ms = 0,
        error_code = ${input.errorCode},
        error_detail = ${JSON.stringify(input.errorDetail)}::jsonb,
        artifacts = NULL
      WHERE id = ${input.runId}
    `);
  });
}

export async function storeArtifacts(
  runId: string,
  artifacts: readonly unknown[],
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE report_runs SET artifacts = ${JSON.stringify(artifacts)}::jsonb
    WHERE id = ${runId}
  `);
}

export async function findRunById(runId: string): Promise<ReportRunRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RUN_COLUMNS} FROM report_runs WHERE id = ${runId}
  `);
  const list = rows.rows as unknown as RunRowShape[];
  return list.length === 0 ? undefined : toRow(list[0]!);
}

export interface ListRunsFilter {
  reportKey?: string;
  requestedBy?: string;
  status?: string;
  limit?: number;
}

export async function listRuns(filter: ListRunsFilter = {}): Promise<ReportRunRow[]> {
  const limit = Math.min(filter.limit ?? 50, 200);
  const rows = await tenantTx().execute(sql`
    SELECT ${RUN_COLUMNS} FROM report_runs
    WHERE (${filter.reportKey ?? null}::text IS NULL OR report_key = ${filter.reportKey ?? null})
      AND (${filter.requestedBy ?? null}::uuid IS NULL OR requested_by = ${filter.requestedBy ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return (rows.rows as unknown as RunRowShape[]).map(toRow);
}

// ---------------------------------------------------------------------------
// Print templates (registry rows synced from the code-defined catalog).
// ---------------------------------------------------------------------------

export interface PrintTemplateRow {
  id: string;
  key: string;
  version: number;
  localeVariants: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

/** Idempotent sync of one code-defined template into the tenant registry. */
export async function syncPrintTemplate(input: {
  id: string;
  key: string;
  version: number;
  localeVariants: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<PrintTemplateRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO print_templates (id, tenant_id, key, version, locale_variants, metadata)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.key},
            ${input.version}, ${JSON.stringify(input.localeVariants)}::jsonb,
            ${JSON.stringify(input.metadata ?? {})}::jsonb)
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      version = EXCLUDED.version,
      locale_variants = EXCLUDED.locale_variants,
      metadata = EXCLUDED.metadata,
      updated_at = now()
    RETURNING id, key, version, locale_variants, metadata
  `);
  return rows.rows[0] as unknown as PrintTemplateRow;
}

export async function listPrintTemplates(): Promise<PrintTemplateRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, key, version, locale_variants, metadata FROM print_templates
    ORDER BY key
  `);
  return rows.rows as unknown as PrintTemplateRow[];
}
