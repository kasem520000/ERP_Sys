import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ReadinessService } from "../health/readiness.service";
import { getDb } from "../infra/db/client";
import { isQueueLive, startBoss, stopBoss } from "../infra/jobs/boss";
import { MIGRATIONS } from "../infra/db/migrations";
import { ensureTestDb, superuserClient } from "./test-db";

/**
 * `/health/ready` dependencies (PHASE-002 §2.8) against real infrastructure:
 * the happy path is exercised end-to-end here; the failure mode (any check
 * down → `unavailable`) is unit-proven by health.controller.spec.ts.
 */

beforeAll(async () => {
  ensureTestDb();
  // The queue liveness probe expects a booted pg-boss (the InfrastructureModule
  // does this in the running app; the spec mirrors that lifecycle).
  await startBoss();
});

afterAll(async () => {
  await stopBoss();
});

describe("readiness (OBSERVABILITY §Health & readiness)", () => {
  it("DB round-trip works as the app role", async () => {
    const db = getDb();
    const result = await db.execute<{ ok: number }>("SELECT 1 AS ok");
    expect(result.rows[0]?.ok).toBe(1);
  });

  it("migration state matches the build manifest (erp.schema_version)", async () => {
    const su = await superuserClient();
    const version = await su.query<{ v: string }>("SELECT erp.schema_version()::text AS v");
    expect(Number(version.rows[0]?.v)).toBe(MIGRATIONS.length);
    await su.end();
  });

  it("queue liveness probe hits the boss schema", async () => {
    await expect(isQueueLive()).resolves.toBe(true);
  });

  it("the full probe reports ready with every check up", async () => {
    const report = await new ReadinessService().check();
    expect(report.status).toBe("ready");
    expect(report.checks.map((check) => `${check.name}:${check.status}`)).toEqual([
      "db:up",
      "migrations:up",
      "queue:up",
    ]);
  });
});
