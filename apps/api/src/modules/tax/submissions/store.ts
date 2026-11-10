import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  assertLegalTransition,
  type SubmissionStatus,
} from "./state-machine";

/**
 * PHASE-023 T1 — the submission registry store (E_INVOICING §6): the ONLY
 * writer of e_invoicing_submissions' operational columns. Every statement
 * runs in the caller's tenant UoW (the stores-before pattern) so registry
 * transitions share the posting/jobs transaction — the registry row and
 * its effects commit or roll back together.
 *
 * State-machine discipline is enforced HERE (assertLegalTransition on every
 * transition), not just in services: no SQL path can move a row illegally
 * (directive §12 — the registry is the sole authority-truth surface).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("einvoicing submissions access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The operational registry row (PHASE-023 expand over the 009 shape). */
export interface SubmissionRow {
  readonly id: string;
  readonly countryCode: string;
  readonly adapterId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly status: SubmissionStatus;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly payloadDigest: string | null;
  readonly authorityReference: string | null;
  readonly authorityRefs: readonly unknown[];
  readonly payloadFileId: string | null;
  readonly responseFileId: string | null;
  readonly lastErrorCode: string | null;
  readonly errorDetail: Record<string, unknown> | null;
  readonly submittedAt: string | null;
  readonly respondedAt: string | null;
  readonly reportedAt: string | null;
  readonly retryOfSubmissionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const COLUMNS = sql`id, tenant_id AS "tenantId", country_code AS "countryCode", adapter_id AS "adapterId",
  source_type AS "sourceType", source_id::text AS "sourceId", status, attempts,
  next_attempt_at::text AS "nextAttemptAt", payload_digest AS "payloadDigest",
  authority_reference AS "authorityReference", authority_refs AS "authorityRefs",
  payload_file_id::text AS "payloadFileId", response_file_id::text AS "responseFileId",
  last_error_code AS "lastErrorCode", error_detail AS "errorDetail",
  submitted_at::text AS "submittedAt", responded_at::text AS "respondedAt",
  reported_at::text AS "reportedAt", retry_of_submission_id::text AS "retryOfSubmissionId",
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export interface RegistryFilter {
  readonly countryCode?: string;
  readonly adapterId?: string;
  readonly status?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly limit?: number;
}

export async function listSubmissions(filter: RegistryFilter): Promise<SubmissionRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${COLUMNS} FROM e_invoicing_submissions
    WHERE (${filter.countryCode ?? null}::text IS NULL OR country_code = ${filter.countryCode ?? null})
      AND (${filter.adapterId ?? null}::text IS NULL OR adapter_id = ${filter.adapterId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.sourceType ?? null}::text IS NULL OR source_type = ${filter.sourceType ?? null})
      AND (${filter.sourceId ?? null}::uuid IS NULL OR source_id = ${filter.sourceId ?? null}::uuid)
    ORDER BY created_at DESC
    LIMIT ${filter.limit ?? 200}
  `);
  return rows.rows as unknown as SubmissionRow[];
}

export async function findSubmission(id: string): Promise<SubmissionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${COLUMNS} FROM e_invoicing_submissions WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SubmissionRow[])[0];
}

export async function findSubmissionForDocument(input: {
  sourceType: string;
  sourceId: string;
  adapterId: string;
}): Promise<SubmissionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${COLUMNS} FROM e_invoicing_submissions
    WHERE source_type = ${input.sourceType} AND source_id = ${input.sourceId}::uuid
      AND adapter_id = ${input.adapterId}
    ORDER BY created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as SubmissionRow[])[0];
}

/**
 * Registry idempotency (no double clearance — acceptance criterion 4/5):
 * exactly ONE LIVE row per (tenant, source, adapter) — the partial unique
 * index uq_einvoicing_submissions_live. A duplicate enqueue for the same
 * document×adapter returns the EXISTING live row (idempotentReplay) — sync
 * duplicate pushes and job retries can never create a second submission.
 * REJECTED/FAILED rows are terminal history: a resubmission (chained via
 * retry_of_submission_id) inserts a fresh LIVE row — append-only history.
 */
export async function enqueueSubmission(input: {
  countryCode: string;
  adapterId: string;
  sourceType: string;
  sourceId: string;
  payloadDigest: string | null;
  actorId: string | null;
  retryOfSubmissionId?: string | null;
}): Promise<{ row: SubmissionRow; idempotentReplay: boolean }> {
  const tx = tenantTx();
  const id = generateUuidV7();
  const rows = await tx.execute(sql`
    INSERT INTO e_invoicing_submissions (id, tenant_id, country_code, adapter_id,
      source_type, source_id, status, payload_digest, created_by, retry_of_submission_id)
    VALUES (${id}, erp.current_tenant_id(), ${input.countryCode}, ${input.adapterId},
      ${input.sourceType}, ${input.sourceId}, 'PENDING', ${input.payloadDigest},
      ${input.actorId}, ${input.retryOfSubmissionId ?? null})
    ON CONFLICT ("tenant_id", "source_type", "source_id", "adapter_id")
      WHERE status IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'REPORTED')
      DO NOTHING
    RETURNING ${COLUMNS}
  `);
  const inserted = (rows.rows as unknown as SubmissionRow[])[0];
  if (inserted !== undefined) {
    return { row: inserted, idempotentReplay: false };
  }
  // A live row already exists — replay it (the no-double-clearance path).
  const live = await findLiveSubmissionForDocument({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    adapterId: input.adapterId,
  });
  if (live === undefined) {
    throw new Error("registry upsert race: conflict fired but no live row found");
  }
  return { row: live, idempotentReplay: true };
}

/** The latest LIVE (non-terminal) row for a document × adapter. */
export async function findLiveSubmissionForDocument(input: {
  sourceType: string;
  sourceId: string;
  adapterId: string;
}): Promise<SubmissionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${COLUMNS} FROM e_invoicing_submissions
    WHERE source_type = ${input.sourceType} AND source_id = ${input.sourceId}::uuid
      AND adapter_id = ${input.adapterId}
      AND status IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'REPORTED')
    ORDER BY created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as SubmissionRow[])[0];
}

/**
 * The single transition primitive: asserts legality IN SQL-ADJACENT CODE,
 * stamps the attempt/timestamp bookkeeping, and returns the fresh row.
 * Callers own auditing (registry-service) — this function is pure state.
 */
export async function transitionSubmission(input: {
  id: string;
  to: SubmissionStatus;
  /** Self-transitions (poll re-checks) may carry no status change. */
  authorityReference?: string | null;
  authorityRefs?: readonly unknown[] | null;
  errorCode?: string | null;
  errorDetail?: Record<string, unknown> | null;
  payloadFileId?: string | null;
  responseFileId?: string | null;
  /** Attempt bookkeeping: the sweep records each try. */
  incrementAttempts?: boolean;
  nextAttemptAt?: string | null;
}): Promise<SubmissionRow> {
  const current = await findSubmission(input.id);
  if (current === undefined) {
    throw new Error(`submission ${input.id} not found`);
  }
  const verdict = assertLegalTransition(current.status, input.to);
  if (!verdict.ok) {
    throw new Error(
      `illegal registry transition ${verdict.from} → ${verdict.attempted} (legal: ${verdict.legal.join(", ") || "terminal"})`,
    );
  }
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    UPDATE e_invoicing_submissions SET
      status = ${input.to},
      attempts = attempts + ${input.incrementAttempts === true ? 1 : 0},
      next_attempt_at = ${input.nextAttemptAt ?? null}::timestamptz,
      authority_reference = COALESCE(${input.authorityReference ?? null}, authority_reference),
      authority_refs = CASE WHEN ${input.authorityRefs === null || input.authorityRefs === undefined}
        THEN authority_refs ELSE ${JSON.stringify(input.authorityRefs ?? [])}::jsonb END,
      last_error_code = ${input.errorCode ?? null},
      error_detail = ${input.errorDetail !== undefined && input.errorDetail !== null ? JSON.stringify(input.errorDetail) : null}::jsonb,
      payload_file_id = COALESCE(${input.payloadFileId ?? null}::uuid, payload_file_id),
      response_file_id = COALESCE(${input.responseFileId ?? null}::uuid, response_file_id),
      submitted_at = CASE WHEN ${input.to} = 'SUBMITTED' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
      responded_at = CASE WHEN ${input.to} IN ('ACCEPTED', 'REJECTED', 'FAILED') THEN now() ELSE responded_at END,
      reported_at = CASE WHEN ${input.to} = 'REPORTED' THEN now() ELSE reported_at END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
    RETURNING ${COLUMNS}
  `);
  return (rows.rows as unknown as SubmissionRow[])[0]!;
}

/** The retry sweep's worklist: live rows whose next_attempt_at has arrived. */
export async function listDueSubmissions(input: {
  now: string;
  limit?: number;
}): Promise<SubmissionRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${COLUMNS} FROM e_invoicing_submissions
    WHERE status IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED')
      AND (next_attempt_at IS NULL OR next_attempt_at <= ${input.now}::timestamptz)
    ORDER BY COALESCE(next_attempt_at, created_at) ASC
    LIMIT ${input.limit ?? 50}
  `);
  return rows.rows as unknown as SubmissionRow[];
}

/**
 * The funnel aggregate (MONITORING §1 PHASE-023): submissions by state,
 * latency percentiles (p50/p95 from responded_at - submitted_at), rejection
 * reasons by code, and the dead-letter count — computed per tenant (the
 * platform ops endpoint iterates tenants through the system-job pattern).
 */
export async function funnelStats(): Promise<{
  byStatus: Record<string, number>;
  rejectionReasons: { code: string; count: number }[];
  deadLetter: number;
  latencyMs: { p50: number | null; p95: number | null };
  rejectionWindow: { total: number; rejected: number; ratePct: number | null };
}> {
  const tx = tenantTx();
  const byStatusRows = await tx.execute(sql`
    SELECT status, count(*)::int AS n FROM e_invoicing_submissions GROUP BY status
  `);
  const byStatus: Record<string, number> = {};
  for (const row of byStatusRows.rows as unknown as { status: string; n: number }[]) {
    byStatus[row.status] = row.n;
  }
  const reasonRows = await tx.execute(sql`
    SELECT last_error_code AS code, count(*)::int AS n
    FROM e_invoicing_submissions
    WHERE status = 'REJECTED' AND last_error_code IS NOT NULL
    GROUP BY last_error_code ORDER BY n DESC LIMIT 10
  `);
  const latencyRows = await tx.execute(sql`
    SELECT
      percentile_disc(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (responded_at - submitted_at)) * 1000, 0))::bigint AS p50,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (responded_at - submitted_at)) * 1000, 0))::bigint AS p95
    FROM e_invoicing_submissions
    WHERE responded_at IS NOT NULL AND submitted_at IS NOT NULL
  `);
  const windowRows = await tx.execute(sql`
    SELECT
      count(*) FILTER (WHERE status IN ('ACCEPTED', 'REJECTED', 'REPORTED'))::int AS total,
      count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected
    FROM e_invoicing_submissions
    WHERE updated_at > now() - interval '15 minutes'
  `);
  const latency = (latencyRows.rows as unknown as { p50: string | null; p95: string | null }[])[0];
  const window = (windowRows.rows as unknown as { total: number; rejected: number }[])[0];
  const deadLetterRows = await tx.execute(sql`
    SELECT count(*)::int AS n FROM e_invoicing_submissions WHERE status = 'FAILED'
  `);
  return {
    byStatus,
    rejectionReasons: reasonRows.rows as unknown as { code: string; count: number }[],
    deadLetter: (deadLetterRows.rows as unknown as { n: number }[])[0]?.n ?? 0,
    latencyMs: {
      p50: latency?.p50 !== undefined && latency.p50 !== null ? Number(latency.p50) : null,
      p95: latency?.p95 !== undefined && latency.p95 !== null ? Number(latency.p95) : null,
    },
    rejectionWindow: {
      total: window?.total ?? 0,
      rejected: window?.rejected ?? 0,
      ratePct:
        window !== undefined && window.total > 0
          // Per-mille integer division (house pattern, cf. rate-limiter.ts) —
          // Math.round is banned by the ADR-0009 floating-math lint rule.
          ? ((window.rejected * 1000) / window.total | 0) / 10
          : null,
    },
  };
}
