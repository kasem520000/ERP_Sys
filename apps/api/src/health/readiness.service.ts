import { Injectable } from "@nestjs/common";

import { MIGRATIONS } from "../infra/db/migrations";
import { getPool } from "../infra/db/client";
import { isQueueLive } from "../infra/jobs/boss";
import { childLogger } from "../infra/observability/logger";

/**
 * Readiness probe (PHASE-002 §2.8, OBSERVABILITY §Health & readiness):
 * DB round-trip + migration-state + job-queue liveness. Used by deploy gates
 * and load balancers; a single failing check fails the probe (503) — partial
 * readiness is not readiness.
 */
export interface ReadinessCheck {
  name: "db" | "migrations" | "queue";
  status: "up" | "down";
  detail?: string;
}

export interface ReadinessReport {
  status: "ready" | "unavailable";
  checks: ReadinessCheck[];
}

const log = childLogger({ module: "health" });

@Injectable()
export class ReadinessService {
  async check(): Promise<ReadinessReport> {
    const checks = [
      await this.checkDb(),
      await this.checkMigrations(),
      await this.checkQueue(),
    ];
    const ready = checks.every((check) => check.status === "up");
    return { status: ready ? "ready" : "unavailable", checks };
  }

  private async checkDb(): Promise<ReadinessCheck> {
    try {
      // Date.now() is integer-ms by definition: no float rounding involved.
      const started = Date.now();
      await getPool().query("SELECT 1");
      return {
        name: "db",
        status: "up",
        detail: `round-trip ${Date.now() - started}ms`,
      };
    } catch (error) {
      log.error({ action: "readiness-db-down", err: error }, "db readiness failed");
      return { name: "db", status: "down" };
    }
  }

  private async checkMigrations(): Promise<ReadinessCheck> {
    try {
      const result = await getPool().query<{ v: string }>(
        "SELECT erp.schema_version()::text AS v",
      );
      const applied = Number.parseInt(result.rows[0]?.v ?? "", 10);
      if (applied === MIGRATIONS.length) {
        return { name: "migrations", status: "up", detail: `at ${MIGRATIONS.at(-1)}` };
      }
      return {
        name: "migrations",
        status: "down",
        detail: `schema_version=${applied}, build expects ${MIGRATIONS.length}`,
      };
    } catch (error) {
      log.error({ action: "readiness-migrations-down", err: error }, "migration check failed");
      return { name: "migrations", status: "down" };
    }
  }

  private async checkQueue(): Promise<ReadinessCheck> {
    try {
      if (await isQueueLive()) {
        return { name: "queue", status: "up" };
      }
      return { name: "queue", status: "down" };
    } catch (error) {
      log.error({ action: "readiness-queue-down", err: error }, "queue check failed");
      return { name: "queue", status: "down" };
    }
  }
}
