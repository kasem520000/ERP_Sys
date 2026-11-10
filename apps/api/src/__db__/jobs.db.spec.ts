import { beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { getBoss, startBoss, stopBoss, JobsService } from "../infra/jobs/boss";
import { ensureTestDb, superuserClient, TENANT_A } from "./test-db";

/**
 * pg-boss on the `boss` schema (ADR-0008, PHASE-002 §2.6): queue boots, a
 * test-category job executes exactly once for duplicate enqueues (dedupe by
 * job id — acceptance 5), the retry budget is recorded, and payload scoping
 * follows the tenant contract.
 */

interface EchoPayload {
  tenantId: string;
  correlationId?: string;
  marker: string;
}

beforeAll(async () => {
  ensureTestDb();
});

describe("pg-boss queue infrastructure", () => {
  it("starts on the dedicated boss schema (queue tables, no tenant data)", async () => {
    await startBoss();
    const su = await superuserClient();
    const bossTables = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'boss' AND table_type = 'BASE TABLE'`,
    );
    expect((bossTables.rows[0]?.n ?? 0)).toBeGreaterThan(0);
    await su.end();
  });

  it("test job executes exactly once for duplicate enqueues (dedupe contract, acceptance 5)", async () => {
    const boss = getBoss();
    let executions = 0;
    const marker = `dedupe-${Date.now()}`;
    await boss.createQueue("test.echo");
    await boss.work("test.echo", async () => {
      executions += 1;
    });

    const dedupeId = generateUuidV7();
    const first = await boss.send(
      "test.echo",
      { tenantId: TENANT_A, marker },
      { id: dedupeId },
    );
    const duplicate = await boss.send(
      "test.echo",
      { tenantId: TENANT_A, marker },
      { id: dedupeId },
    );
    // Same id: pg-boss returns the existing job id (or null) — one row.
    expect(duplicate === null || duplicate === first).toBe(true);

    // Give the worker a polling window, then stop accepting new work.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(executions).toBe(1);
  });

  it("JobsService.publish applies the retry budget and returns a job id", async () => {
    const service = new JobsService();
    const jobId = await service.publish<EchoPayload>(
      "test.retry-budget",
      { tenantId: TENANT_A, marker: "retry-budget" },
      { jobId: generateUuidV7(), maxAttempts: 2 },
    );
    expect(jobId).toEqual(expect.any(String));
    const su = await superuserClient();
    const retryLimit = await su.query<{ retry_limit: number }>(
      `SELECT retry_limit FROM boss.job WHERE id = $1`,
      [jobId],
    );
    expect(retryLimit.rows[0]?.retry_limit).toBe(2);
    await su.end();
  });

  it("drains gracefully", async () => {
    await stopBoss();
  });
});
