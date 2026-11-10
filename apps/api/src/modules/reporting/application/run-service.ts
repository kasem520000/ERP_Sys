import { Inject, Injectable } from "@nestjs/common";

import type {
  ReportContract,
  ReportContent,
  ReportParams,
  ReportResult,
  RunContext,
} from "./contract";
import { ReportCache } from "./cache";
import {
  ReportNotFoundError,
  ReportParamsInvalidError,
  ForbiddenAtRunError,
} from "../domain/reporting-errors";
import { assertContractPermission } from "./scope";
import { onLedgerEvent } from "../../accounting/application/ledger-events";
import { processMetrics } from "../../../infra/observability/metrics";
import * as store from "../infrastructure/reporting.store";
import { REPORT_CONTRACTS } from "../registry";
import { generateUuidV7 } from "@erp/domain-core";

/**
 * PHASE-013 T3+T4 · the report executor / run service
 * (REPORTING_ARCHITECTURE §3): inline execution for light bounded queries
 * (p50 < 500 ms target) vs the pg-boss job path for heavy renders — with
 * permission re-resolution at execution time (a grant revoked mid-queue
 * kills the run: FORBIDDEN_AT_RUN, zero partial artifacts), progress
 * stages, and `(report_key, params_hash)` idempotency: a re-run replaces
 * its own artifacts, never duplicates. The stored result envelope is the
 * export source of truth — you print what you saw.
 */

const REPORT_JOB_QUEUE = "reporting-report-run";

export interface RunRequest {
  readonly reportKey: string;
  readonly params: Record<string, unknown>;
  readonly ctx: RunContext;
}

export interface RunOutcome {
  readonly runId: string;
  /** Present for completed inline runs (and cached job results). */
  readonly result?: ReportResult;
  /** Present when the run was enqueued (job path) — client polls. */
  readonly queued?: boolean;
  readonly status: "SUCCEEDED" | "QUEUED" | "FAILED";
}

export const REPORT_JOB_ENQUEUER_TOKEN = "REPORT_JOB_ENQUEUER";

export interface ReportJobEnqueuer {
  (input: {
    queue: string;
    jobId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

@Injectable()
export class RunService {
  readonly cache = new ReportCache();

  constructor(@Inject(REPORT_JOB_ENQUEUER_TOKEN) private readonly enqueueJob: ReportJobEnqueuer) {
    // Posting/lock events drop the tenant's cache entries
    // (REPORTING_ARCHITECTURE §6.3 — no stale financial data).
    this.cache.attachLedgerEvents(onLedgerEvent);
  }

  /** Registry access (snapshot + lookup for the controller). */
  contracts(): readonly ReportContract[] {
    return REPORT_CONTRACTS;
  }

  contract(reportKey: string): ReportContract {
    const contract = REPORT_CONTRACTS.find((c) => c.id === reportKey);
    if (contract === undefined) {
      throw new ReportNotFoundError(reportKey);
    }
    return contract;
  }

  /**
   * Execute a report (the POST /report-runs entry). Inline contracts run
   * synchronously and return the envelope; job contracts enqueue and return
   * the run id for polling.
   */
  async run(request: RunRequest): Promise<RunOutcome> {
    const contract = this.contract(request.reportKey);
    assertContractPermission(contract, request.ctx);

    const parsed = contract.parameters.safeParse(request.params);
    if (!parsed.success) {
      throw new ReportParamsInvalidError(
        contract.id,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }
    const params = parsed.data as ReportParams;
    const paramsHash = ReportCache.paramsHash(params as Record<string, unknown>);
    const cacheKey = ReportCache.cacheKey({
      tenantId: request.ctx.tenantId,
      reportId: contract.id,
      contractVersion: contract.version,
      params: params as Record<string, unknown>,
    });

    const cached = this.cache.get(cacheKey, { semantics: contract.freshness.semantics });
    if (cached !== undefined) {
      return { runId: cached.result.runId, result: cached.result, status: "SUCCEEDED" };
    }

    const runId = generateUuidV7();
    await store.upsertRun({
      id: runId,
      reportKey: contract.id,
      contractVersion: contract.version,
      params: params as Record<string, unknown>,
      paramsHash,
      executionClass: contract.executionClass,
      requestedBy: request.ctx.userId,
      correlationId: request.ctx.correlationId ?? null,
    });

    if (contract.executionClass === "job") {
      await this.enqueueJob({
        queue: REPORT_JOB_QUEUE,
        jobId: `report-run:${runId}`,
        payload: {
          tenantId: request.ctx.tenantId,
          runId,
          reportKey: contract.id,
          userId: request.ctx.userId,
          correlationId: request.ctx.correlationId ?? null,
        },
      });
      return { runId, queued: true, status: "QUEUED" };
    }

    return this.executeInline({ runId, contract, params, ctx: request.ctx, cacheKey });
  }

  /** The inline path (T3): query → aggregate → assert → envelope → store.
   *
   * PHASE-025 T9c wiring — the report-render SLO (MONITORING §5 "per
   * template budget"; PERFORMANCE_TEST_PLAN T-04 tiers): this is the
   * single completion point for BOTH execution classes (executeJob
   * delegates here), so the render counters + the per-template duration
   * sampler record here. Cache hits in run() are not renders and never
   * reach this method — correctly excluded. */
  async executeInline(input: {
    runId: string;
    contract: ReportContract;
    params: ReportParams;
    ctx: RunContext;
    cacheKey: string;
  }): Promise<RunOutcome> {
    const started = Date.now();
    await store.markRunning(input.runId, "querying");
    try {
      const content = await input.contract.run(input.ctx, input.params);
      await store.setStage(input.runId, "asserting");
      const status = content.assertionResults.some((r) => r.status === "FAIL")
        ? ("FAIL" as const)
        : ("PASS" as const);
      const envelope = this.buildEnvelope({
        runId: input.runId,
        contract: input.contract,
        params: input.params,
        content,
        ctx: input.ctx,
        cacheState: "recomputed",
      });
      await store.completeRun(input.runId, {
        result: envelope as unknown as Record<string, unknown>,
        assertions: content.assertionResults,
        assertionStatus: status,
        durationMs: Date.now() - started,
      });
      processMetrics.recordReportRender({
        executionClass: input.contract.executionClass,
        template: input.contract.id,
        durationMs: Date.now() - started,
        ok: true,
      });
      this.cache.setForTenant(
        input.ctx.tenantId,
        input.cacheKey,
        envelope,
        input.contract.freshness.cacheTtlSeconds * 1000,
      );
      return { runId: input.runId, result: envelope, status: "SUCCEEDED" };
    } catch (error) {
      processMetrics.recordReportRender({
        executionClass: input.contract.executionClass,
        template: input.contract.id,
        durationMs: Date.now() - started,
        ok: false,
      });
      await store.failRun(
        input.runId,
        error instanceof Error ? error.message.slice(0, 120) : "REPORT_RUN_FAILED",
        { message: error instanceof Error ? error.message : String(error) },
        Date.now() - started,
      );
      throw error;
    }
  }

  /**
   * The job worker path (T4): re-resolves permissions AT EXECUTION — a
   * revoked grant kills the queued run with FORBIDDEN_AT_RUN and zero
   * partial artifacts (no TOCTOU leaks).
   */
  async executeJob(input: {
    runId: string;
    reportKey: string;
    permissions: ReadonlySet<string>;
    tenantId: string;
    userId: string | null;
    baseCurrency: string;
    effectiveBranchIds: readonly string[] | null;
    correlationId?: string;
  }): Promise<void> {
    const contract = this.contract(input.reportKey);
    const run = await store.findRunById(input.runId);
    if (run === undefined) {
      throw new ReportNotFoundError(input.reportKey);
    }
    // Permission re-resolution at execution time (§3, binding).
    if (!input.permissions.has(contract.requiredPermission)) {
      // PHASE-013 fix (T-TESTS): the failure record must survive the caller's
      // rollback (withTenant rolls back on the thrown ForbiddenAtRunError —
      // the QUEUED row would otherwise never reach FAILED and pg-boss would
      // retry into the same wall forever).
      await store.failRunIsolated({
        tenantId: input.tenantId,
        runId: input.runId,
        errorCode: "FORBIDDEN_AT_RUN",
        errorDetail: { reportKey: contract.id },
      });
      throw new ForbiddenAtRunError(contract.id);
    }
    const ctx: RunContext = {
      tenantId: input.tenantId,
      userId: input.userId,
      effectiveBranchIds: input.effectiveBranchIds,
      baseCurrency: input.baseCurrency,
      permissions: input.permissions,
      correlationId: input.correlationId,
    };
    const cacheKey = ReportCache.cacheKey({
      tenantId: input.tenantId,
      reportId: contract.id,
      contractVersion: contract.version,
      params: run.params,
    });
    await this.executeInline({ runId: input.runId, contract, params: run.params as ReportParams, ctx, cacheKey });
  }

  /** Envelope builder (REPORT_CONTRACT §2, normative shape). */
  buildEnvelope(input: {
    runId: string;
    contract: ReportContract;
    params: ReportParams;
    content: ReportContent;
    ctx: RunContext;
    cacheState: "fresh" | "stale" | "recomputed";
  }): ReportResult {
    return {
      reportId: input.contract.id,
      contractVersion: input.contract.version,
      runId: input.runId,
      paramsEcho: input.params as Record<string, unknown>,
      columns: input.content.columns,
      groups: input.content.groups,
      rows: input.content.rows,
      totals: input.content.totals,
      assertions: input.content.assertionResults,
      freshness: {
        computedAt: new Date().toISOString(),
        asOf:
          (input.params.asOf as string | undefined) ??
          (input.params.dateTo as string | undefined),
        cacheState: input.cacheState,
      },
      formatting: {
        baseCurrency: input.ctx.baseCurrency,
        numerals: "western",
        locale: input.params.locale ?? "ar",
      },
      notes: input.content.notes,
    };
  }
}


export { REPORT_JOB_QUEUE };
