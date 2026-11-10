import { beforeAll, describe, expect, it } from "vitest";

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
