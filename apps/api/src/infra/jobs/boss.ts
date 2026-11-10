import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import PgBoss from "pg-boss";

import { env } from "../../config/env";
import { getPool } from "../db/client";
import { childLogger } from "../observability/logger";

/**
 * pg-boss background jobs on PostgreSQL (ADR-0008): queue tables live in the
 * dedicated `boss` schema (created by migration 0001, owned by `erp_app`),
 * carry no tenant data in SQL, and payloads stay tenant-scoped by contract —
 * handlers re-establish the tenant context (A9 hard-error rule).
 *
 * `WORKER_MODE=1` selects the worker entrypoint of the same image (see
 * main.ts): it registers job handlers and never listens for HTTP. The API
 * process (WORKER_MODE=0) still starts the boss client so any module can
 * `publish`.
 */

const log = childLogger({ module: "jobs" });

let bossInstance: PgBoss | undefined;

/** Lazy singleton; tests reuse the same instance through `getBoss()`. */
export function getBoss(): PgBoss {
  if (bossInstance === undefined) {
    const connectionString = requireConnectionString();
    bossInstance = new PgBoss({
      connectionString,
      schema: "boss",
      // Queue traffic shares the platform PG pool budget (ADR-0008): modest
      // dedicated pool, well below the app's 20-connection baseline.
      max: 5,

    });
    // PHASE-024 (the race PROVEN pre-existing at PHASE-022/023 HEAD and
    // flagged for this phase): concurrent createQueue calls from modules
    // booting in parallel deadlock on the boss schema's catalog rows
    // (pg-boss creates/locks queue rows non-idempotently under
    // concurrency). Serialize every createQueue behind one promise chain —
    // caller semantics identical, the boot race gone.
    const originalCreateQueue = bossInstance.createQueue.bind(bossInstance);
    let createQueueChain: Promise<unknown> = Promise.resolve();
    bossInstance.createQueue = ((name: string, options?: unknown) => {
      const run = createQueueChain.then(() =>
        originalCreateQueue(name, options as never),
      );
      createQueueChain = run.catch(() => undefined);
      return run;
    }) as PgBoss["createQueue"];
  }
  return bossInstance;
}

function requireConnectionString(): string {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured: pg-boss requires the app-role connection (see .env.example)",
    );
  }
  return env.DATABASE_URL;
}

/** Boots the queue client exactly once per process. */
export async function startBoss(): Promise<void> {
  const boss = getBoss();
  try {
    await boss.start();
    log.info({ action: "boss-started" }, "pg-boss queue client started");
  } catch (error) {
    log.error({ action: "boss-start-failed", err: error }, "pg-boss start failed");
    throw error;
  }
}

/** Graceful drain (Nest shutdown hook + worker signals). */
export async function stopBoss(): Promise<void> {
  if (bossInstance !== undefined) {
    await bossInstance.stop();
    bossInstance = undefined;
    log.info({ action: "boss-stopped" }, "pg-boss queue client stopped");
  }
}

/** Queue-liveness probe used by `/health/ready` (OBSERVABILITY §Health). */
export async function isQueueLive(): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM boss.job",
  );
  return result.rowCount !== null;
}

/**
 * Test category contract (PHASE-002 §2.6): every job payload carries the
 * tenant id + correlation id; handlers are idempotent (duplicate `jobId`
 * enqueues execute exactly once — proven by the db test suite); retries are
 * safe by contract; secrets never enter payloads (references only).
 */
export interface JobPayloadBase {
  tenantId: string;
  correlationId?: string;
}

export interface PublishOptions {
  /** Dedupe key: same jobId enqueued twice executes once (pg-boss contract). */
  jobId?: string;
  /** Retry budget before dead-lettering (exponential backoff is built in). */
  maxAttempts?: number;
}

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await startBoss();
  }

  async onModuleDestroy(): Promise<void> {
    await stopBoss();
  }

  /**
   * Publish to a queue. pg-boss v10 named queues are explicit: publish
   * ensures the queue exists (idempotent) before sending.
   */
  async publish<P extends JobPayloadBase>(
    queue: string,
    payload: P,
    options: PublishOptions = {},
  ): Promise<string | null> {
    const boss = getBoss();
    await boss.createQueue(queue).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/exist/i.test(message)) {
        throw error;
      }
    });
    return boss.send(queue, payload, {
      id: options.jobId,
      retryLimit: options.maxAttempts ?? 3,
    });
  }
}
