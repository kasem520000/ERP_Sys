import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { generateUuidV7 } from "@erp/domain-core";

import { ambientTx } from "../../infra/db/tenant-context";
import { recordJobFailureAfterRollback } from "../../modules/reporting/application/run-service";
import { defineReport } from "../../modules/reporting/registry/kit";

import {
  fullContext,
  newRunService,
  setupReportingFixture,
  su,
  TENANT_R,
  withTenant,
} from "./fixtures";
import { ForbiddenAtRunError } from "../../modules/reporting/domain/reporting-errors";

/**
 * PHASE-013 run lifecycle (REPORTING_ARCHITECTURE §3): the report_runs row
 * contract — inline runs land SUCCEEDED/PASS with the stored envelope; the
 * (tenant, report_key, params_hash) unique key makes re-runs REPLACE their
 * own row (never duplicate); the job path enqueues QUEUED through the
 * enqueuer port; executeJob re-resolves permissions AT EXECUTION so a revoked
 * grant kills the queued run with FORBIDDEN_AT_RUN and a FAILED row.
 */

beforeAll(async () => {
  await setupReportingFixture();
});

async function runRow(runId: string): Promise<{
  status: string;
  assertionStatus: string | null;
  hasResult: boolean;
  errorCode: string | null;
}> {
  const client = await su();
  const result = await client.query(
    `SELECT status, assertion_status, error_code, (result IS NOT NULL) AS has_result
       FROM report_runs WHERE tenant_id = $1 AND id = $2`,
    [TENANT_R, runId],
  );
  await client.end();
  const row = result.rows[0];
  if (row === undefined) throw new Error(`report_runs row ${runId} missing`);
  return {
    status: row.status,
    assertionStatus: row.assertion_status,
    hasResult: row.has_result,
    errorCode: row.error_code,
  };
}

describe("inline runs", () => {
  it("lands SUCCEEDED / assertion PASS with a stored result envelope", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "financial.trial-balance",
        params: { dateFrom: "2026-03-01", dateTo: "2026-03-31", locale: "en" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.queued).toBeUndefined();
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    expect(outcome.result!.reportId).toBe("financial.trial-balance");
    expect(outcome.result!.runId).toBe(outcome.runId);

    const row = await runRow(outcome.runId);
    expect(row.status).toBe("SUCCEEDED");
    expect(row.assertionStatus).toBe("PASS");
    expect(row.hasResult).toBe(true);
  });

  it("re-running identical params keeps exactly one row (params_hash idempotency)", async () => {
    const second = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "financial.trial-balance",
        params: { dateFrom: "2026-03-01", dateTo: "2026-03-31", locale: "en" },
        ctx: fullContext(),
      }),
    );
    expect(second.status).toBe("SUCCEEDED");

    const client = await su();
    const counted = await client.query(
      `SELECT count(*)::int AS n FROM report_runs
        WHERE tenant_id = $1 AND report_key = 'financial.trial-balance'
          AND params->>'dateFrom' = '2026-03-01'`,
      [TENANT_R],
    );
    await client.end();
    expect(counted.rows[0]!.n).toBe(1);
    // The re-run took over the row (upsert id = EXCLUDED.id): it is live.
    expect((await runRow(second.runId)).status).toBe("SUCCEEDED");
  });
});

describe("job runs (pg-boss path through the enqueuer port)", () => {
  const PACK_PARAMS = { dateFrom: "2026-03-01", dateTo: "2026-03-31", locale: "ar" };

  it("run() enqueues QUEUED; executeJob with grants completes SUCCEEDED", async () => {
    const runs = newRunService(); // no-op enqueuer: the row stays QUEUED
    const outcome = await withTenant(TENANT_R, () =>
      runs.run({ reportKey: "financial.fiscal-close-pack", params: PACK_PARAMS, ctx: fullContext() }),
    );
    expect(outcome.status).toBe("QUEUED");
    expect(outcome.queued).toBe(true);
    expect(outcome.result).toBeUndefined();
    expect((await runRow(outcome.runId)).status).toBe("QUEUED");

    await withTenant(TENANT_R, () =>
      runs.executeJob({
        runId: outcome.runId,
        reportKey: "financial.fiscal-close-pack",
        permissions: fullContext().permissions,
        tenantId: TENANT_R,
        userId: fullContext().userId,
        baseCurrency: "SAR",
        effectiveBranchIds: null,
      }),
    );
    const row = await runRow(outcome.runId);
    expect(row.status).toBe("SUCCEEDED");
    expect(row.assertionStatus).toBe("PASS");
    expect(row.hasResult).toBe(true);
  });

  it("executeJob with a revoked grant fails the row FORBIDDEN_AT_RUN (no TOCTOU)", async () => {
    const runs = newRunService();
    const outcome = await withTenant(TENANT_R, () =>
      runs.run({ reportKey: "financial.fiscal-close-pack", params: PACK_PARAMS, ctx: fullContext() }),
    );
    // The upsert reset the row to QUEUED for this attempt.
    expect((await runRow(outcome.runId)).status).toBe("QUEUED");

    await expect(
      withTenant(TENANT_R, () =>
        runs.executeJob({
          runId: outcome.runId,
          reportKey: "financial.fiscal-close-pack",
          permissions: new Set<string>(), // grant revoked mid-queue
          tenantId: TENANT_R,
          userId: fullContext().userId,
          baseCurrency: "SAR",
          effectiveBranchIds: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenAtRunError);

    const row = await runRow(outcome.runId);
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toBe("FORBIDDEN_AT_RUN");
    expect(row.hasResult).toBe(false);
  });

  it("different params create a fresh run row (count +1)", async () => {
    await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "financial.fiscal-close-pack",
        params: { dateFrom: "2026-03-01", dateTo: "2026-03-30", locale: "ar" },
        ctx: fullContext(),
      }),
    );
    const client = await su();
    const counted = await client.query(
      `SELECT count(*)::int AS n FROM report_runs
        WHERE tenant_id = $1 AND report_key = 'financial.fiscal-close-pack'
          AND params->>'dateFrom' = '2026-03-01'`,
      [TENANT_R],
    );
    await client.end();
    expect(counted.rows[0]!.n).toBe(2); // 03-31 + 03-30 windows
  });
});

/**
 * The 59085a0 review round (the owner's full-suite run): the report
 * FAILURE path under an ABORTED ambient transaction. The owner's ga-full-load
 * group run hit the pool's 15 s statement_timeout on the trial-balance
 * compute; the timeout (pg 57014) aborted the UoW, and executeInline's
 * in-tx failRun write then died with 25P02 "current transaction is
 * aborted" — REPLACING the true error in the test output and recording
 * nothing. These regressions pin the two laws of the fixed failure path:
 * (1) the ORIGINAL error always surfaces (never the aborted-tx mask); (2)
 * the worker shape records the terminal FAILED state AFTER the UoW rolls
 * back (isolated, conditional — the PHASE-013 failRunIsolated precedent
 * extended to compute failures), so a job row can never stay QUEUED
 * forever retrying into the same wall.
 */
describe("the failure path under an aborted UoW (the 59085a0 round)", () => {
  /** A contract whose compute dies with a QUERY error on the ambient
   * transaction — any pg error aborts the UoW (the statement_timeout
   * 57014 shape); it never reaches its own throw. */
  const explodingContract = defineReport({
    id: "test.exploding-statement",
    version: 1,
    title: { ar: "بيان فاشل (اختبار)", en: "Exploding statement (test)" },
    category: "financial",
    description: {
      ar: "استعلام يفشل داخل معاملة الاختبار",
      en: "A query that fails inside the test transaction",
    },
    parameters: z.object({ locale: z.enum(["ar", "en"]) }),
    requiredPermission: "reporting.reports.run",
    dataSources: [],
    assertions: [],
    executionClass: "inline",
    run: async () => {
      await ambientTx()!.execute(sql`SELECT 1/0`);
      throw new Error("unreachable — the query above already failed");
    },
  });

  it("a compute failure that ABORTS the UoW surfaces the ORIGINAL error, never the 25P02 aborted-tx mask", async () => {
    const runs = newRunService();
    const runId = generateUuidV7();
    // Pre-fix this rejected with "current transaction is aborted, commands
    // ignored until end of transaction block" — the failRun write's own
    // failure masking the compute's query error.
    const surfaced = await withTenant(TENANT_R, () =>
      runs.executeInline({
        runId,
        contract: explodingContract,
        params: { locale: "en" },
        ctx: fullContext(),
        cacheKey: "spec/exploding-inline",
      }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    const message = surfaced instanceof Error ? surfaced.message : String(surfaced);
    // The ORIGINAL query failure surfaces (drizzle wraps it as "Failed
    // query: SELECT 1/0") — never the failRun UPDATE's own failure (whose
    // message embeds the failing UPDATE) and never the aborted-tx mask.
    expect(message).toMatch(/SELECT 1\/0/);
    expect(message).not.toMatch(/UPDATE report_runs/);
    expect(message).not.toMatch(/current transaction is aborted/);

    // The first-run attempt rolled back whole — nothing dangles behind a
    // failed inline run (no row, no polling surface, no half state).
    const client = await su();
    const residue = await client.query(
      `SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = $1 AND id = $2`,
      [TENANT_R, runId],
    );
    await client.end();
    expect(residue.rows[0]!.n).toBe(0);
  });

  it("the worker shape: the terminal FAILED state lands AFTER the UoW rollback and never overwrites a terminal row", async () => {
    const runs = newRunService(); // no-op enqueuer: the row stays QUEUED
    const outcome = await withTenant(TENANT_R, () =>
      runs.run({
        reportKey: "financial.fiscal-close-pack",
        params: { dateFrom: "2026-05-01", dateTo: "2026-05-31", locale: "ar" },
        ctx: fullContext(),
      }),
    );
    expect((await runRow(outcome.runId)).status).toBe("QUEUED");

    // The worker's exact shape (reporting.module handleReportJob): the UoW
    // wraps the compute; the catch records AFTER the rollback, when the
    // markRunning row lock is released — inside the UoW the isolated write
    // would block on its own lock, and the aborted UoW rejects the in-tx
    // write with 25P02.
    const workerSurfaced = await (async () => {
      try {
        await withTenant(TENANT_R, () =>
          runs.executeInline({
            runId: outcome.runId,
            contract: explodingContract,
            params: { locale: "en" },
            ctx: fullContext(),
            cacheKey: "spec/exploding-worker",
          }),
        );
      } catch (error) {
        await recordJobFailureAfterRollback({
          tenantId: TENANT_R,
          runId: outcome.runId,
          reportKey: "financial.fiscal-close-pack",
          error,
        });
        return error;
      }
      return undefined;
    })();
    const workerMessage =
      workerSurfaced instanceof Error ? workerSurfaced.message : String(workerSurfaced);
    expect(workerMessage).toMatch(/SELECT 1\/0/);
    expect(workerMessage).not.toMatch(/UPDATE report_runs/);
    expect(workerMessage).not.toMatch(/current transaction is aborted/);

    // The terminal state survived the rollback (recorded outside the dead
    // UoW): the queued job row can no longer retry into the same wall
    // unreadable — it FAILED, with the ORIGINAL error as its code.
    const row = await runRow(outcome.runId);
    expect(row.status).toBe("FAILED");
    expect(row.errorCode).toMatch(/SELECT 1\/0/);
    expect(row.errorCode).not.toMatch(/UPDATE report_runs/);
    expect(row.hasResult).toBe(false);

    // The conditional guard: a LATER recording (the racing-redelivery /
    // FORBIDDEN_AT_RUN-authority case) never overwrites a terminal row.
    await recordJobFailureAfterRollback({
      tenantId: TENANT_R,
      runId: outcome.runId,
      reportKey: "financial.fiscal-close-pack",
      error: new Error("a later, different failure"),
    });
    expect((await runRow(outcome.runId)).errorCode).toMatch(/SELECT 1\/0/);
  });
});
