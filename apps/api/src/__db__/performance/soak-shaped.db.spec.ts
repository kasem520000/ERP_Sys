import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb, superuserClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { startBoss, stopBoss } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { runFeedHealth, runInboxRetention } from "../../modules/sync/application/maintenance-jobs";
import { newRunService, fullContext } from "../reporting/fixtures";
import { generateUuidV7 } from "@erp/domain-core";
import type { JournalSpec } from "../../modules/accounting/domain/posting-engine/journal-spec";
import {
  GA_ACTOR,
  GA_OWNERS,
  GA_OWNER_PASSWORD,
  GA_TENANT_SOAK,
  cleanupGALoadVolume,
  provisionGATenantWithOwner,
  provisionGAReportingWorld,
  seedGASingleTenantVolume,
} from "./ga-fixtures";
import { AppModule } from "../../app.module";

/**
 * PHASE-025 T5 · the compressed soak (PERFORMANCE_TEST_PLAN §2: "12 h
 * steady mid-load + nightly job noise on staging — no memory drift, no
 * queue runaway, error budget intact"). THE 12 h STAGING SOAK IS THE
 * INFRA-GATED GA OBLIGATION; this local-harness spec proves the ASSERTION
 * MACHINERY at compressed scale: a bounded steady window (~200 s) of
 * continuous mixed traffic at moderate rate (the §3 60/25/15
 * read/post/report mix) against a mid-tier tenant (10k documents), with
 * ~15 s sampling of (a) process heap, (b) pg-boss queue depth, (c) the
 * 5xx count, plus two real maintenance jobs (the sync nightly sweeps —
 * feed health + inbox retention, the MASTER-PLAN §11 handlers) fired
 * mid-window as the nightly-job noise.
 *
 * Drift assertion (documented tolerance): the last-third mean of
 * heapUsed must stay within first-third mean + 15% (GC/JIT noise
 * absorbed; raw float arithmetic — no rounding, ADR-0009 spirit). Queue
 * depth must not grow monotonically; the 5xx count must stay 0 (error
 * budget intact). `[soak-shaped]` lines are the recorded local-tier
 * evidence; the staging 12 h run carries the gate.
 */

const SOAK_OWNER_EMAIL = "ga-soak-owner@fixture.test";
const WINDOW_MS = 200_000;
const SAMPLE_INTERVAL_MS = 15_000;
const TRAFFIC_PACE_MS = 250;

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());

let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let soakToken = "";
let accounts: Record<string, string> = {};
let requests = 0;
let failures5xx = 0;
let opsRead = 0;
let opsPosted = 0;
let opsReport = 0;

interface SoakSample {
  t: number;
  heapUsed: number;
  depth: number;
  failed: number;
  fiveXX: number;
}

/**
 * A forced-GC handle (the v8/vm trick — no --expose-gc flag needed):
 * measures RETAINED heap, the real leak signal. Raw heapUsed under a
 * compressed window is dominated by uncollected allocation noise (V8 GC
 * is lazy; 200 s is far too short for the plateau), so each sample runs
 * a full GC first — a stable post-GC heap across the window = no leak;
 * growth in the un-collected number alone proves nothing (the first
 * draft's 22% "drift" was allocation ramp, not retention).
 */
async function forcedGc(): Promise<void> {
  const v8 = await import("node:v8");
  const vm = await import("node:vm");
  v8.setFlagsFromString("--expose_gc");
  const gc = vm.runInNewContext("gc") as () => void;
  gc();
  gc();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readViaHttp(): Promise<void> {
  requests += 1;
  const response = await fetch(`${httpBase}/api/v1/accounting/journal-entries?limit=50`, {
    headers: { "x-session-token": soakToken },
  });
  if (response.status >= 500) {
    failures5xx += 1;
  }
  // Drain the body (keep-alive hygiene).
  await response.text();
  opsRead += 1;
}

function soakPostSpec(): JournalSpec {
  return {
    source: { docType: "journal_entry", docId: generateUuidV7(), operation: "post" },
    entryDate: "2026-01-20",
    description: { en: "ga soak post", ar: "ترحيل النقع" },
    currency: "SAR",
    lines: [
      { accountId: accounts["1111"]!, direction: "DEBIT", amount: "10.0000" },
      { accountId: accounts["3100"]!, direction: "CREDIT", amount: "10.0000" },
    ],
  };
}

async function bossStates(): Promise<Record<string, number>> {
  const su = await superuserClient();
  try {
    const rows = await su.query<{ state: string; n: number }>(
      `SELECT state, count(*)::int AS n FROM boss.job GROUP BY state`,
    );
    const out: Record<string, number> = {};
    for (const row of rows.rows) {
      out[row.state] = row.n;
    }
    return out;
  } finally {
    await su.end();
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();

  await provisionGATenantWithOwner({
    tenantId: GA_TENANT_SOAK,
    tenantName: "Tenant GA soak (mid)",
    ownerId: GA_OWNERS.soak,
    ownerEmail: SOAK_OWNER_EMAIL,
  });
  const world = await provisionGAReportingWorld(GA_TENANT_SOAK);
  accounts = world.accounts as Record<string, string>;
  // The mid-tier steady-load substrate: 10k documents + balanced lines
  // (slot 10 — the soak tenant's dedicated id namespace).
  await seedGASingleTenantVolume({
    tenantId: GA_TENANT_SOAK,
    slot: 10,
    entries: 10_000,
    withLines: true,
  });

  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
  const login = await fetch(`${httpBase}/api/v1/identity/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SOAK_OWNER_EMAIL, password: GA_OWNER_PASSWORD }),
  });
  const body = (await login.json()) as { data: { token: string } };
  soakToken = body.data.token;
}, 180_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await cleanupGALoadVolume();
  await closeDb();
});

describe("GA compressed soak — no heap drift, stable queues, budget intact (PHASE-025 T5; PERFORMANCE_TEST_PLAN §2)", () => {
  it(
    "the steady window: mixed 60/25/15 traffic + nightly-job noise, sampled every ~15 s",
    { timeout: 300_000 },
    async () => {
      const runs = newRunService();
      const samples: SoakSample[] = [];
      const baseline = await bossStates();
      const baselineDepth = (baseline.created ?? 0) + (baseline.active ?? 0);
      const baselineFailed = baseline.failed ?? 0;
      const started = Date.now();

      // The nightly-job noise: two real maintenance handlers fired
      // mid-window (concurrently with traffic — the staging soak's
      // "reconciliation + exports during load" shape, MASTER-PLAN §11).
      const maintenance = (async () => {
        await sleep(60_000);
        const feed = await runFeedHealth();
        console.log(
          `[soak-shaped] nightly-job noise t=60s: sync.feed-health sweep (tenants=${feed.tenants} stalls=${feed.stalls})`,
        );
        await sleep(60_000);
        const inbox = await runInboxRetention();
        console.log(
          `[soak-shaped] nightly-job noise t=120s: sync.inbox-retention sweep (tenants=${inbox.tenants} deleted=${inbox.deleted})`,
        );
      })();

      // The sampler: retained heap (post-GC) + queue depth + 5xx every ~15 s.
      const sampler = (async () => {
        while (Date.now() - started < WINDOW_MS) {
          await sleep(SAMPLE_INTERVAL_MS);
          const states = await bossStates();
          await forcedGc();
          const sample: SoakSample = {
            t: Date.now() - started,
            heapUsed: process.memoryUsage().heapUsed,
            depth: (states.created ?? 0) + (states.active ?? 0),
            failed: states.failed ?? 0,
            fiveXX: failures5xx,
          };
          samples.push(sample);
          console.log(
            `[soak-shaped] sample t=${(sample.t / 1000).toFixed(0)}s heap=${(sample.heapUsed / (1024 * 1024)).toFixed(1)}MB depth=${sample.depth} failed=${sample.failed} 5xx=${sample.fiveXX}`,
          );
        }
      })();

      // The traffic: steady moderate rate, the §3 60/25/15 mix
      // (12 read : 5 post : 3 report per 20 ops).
      const traffic = (async () => {
        let op = 0;
        while (Date.now() - started < WINDOW_MS) {
          const slot = op % 20;
          if (slot <= 11) {
            await readViaHttp();
          } else if (slot <= 16) {
            await withTenant(GA_TENANT_SOAK, () =>
              posting.post(soakPostSpec(), { postedBy: GA_ACTOR }),
            );
            opsPosted += 1;
          } else {
            await withTenant(GA_TENANT_SOAK, () =>
              runs.run({
                reportKey: "financial.trial-balance",
                params: {
                  dateFrom: `2026-01-0${1 + (op % 5)}`,
                  dateTo: "2026-01-28",
                  locale: "en",
                },
                ctx: fullContext(GA_TENANT_SOAK),
              }),
            );
            opsReport += 1;
          }
          op += 1;
          await sleep(TRAFFIC_PACE_MS);
        }
      })();

      await Promise.all([maintenance, sampler, traffic]);

      // -- (a) No memory drift beyond the documented tolerance -------------
      expect(samples.length).toBeGreaterThanOrEqual(10);
      // Integer floor via the house `| 0` idiom (ADR-0009: no Math.* — the
      // rate-limiter precedent); thirds never smaller than one sample.
      let third = (samples.length / 3) | 0;
      if (third < 1) {
        third = 1;
      }
      const firstThird = samples.slice(0, third).map((s) => s.heapUsed);
      const lastThird = samples.slice(samples.length - third).map((s) => s.heapUsed);
      const firstMean = mean(firstThird);
      const lastMean = mean(lastThird);
      const driftRatio = lastMean / firstMean;
      console.log(
        `[soak-shaped] heap-drift first-third mean=${(firstMean / (1024 * 1024)).toFixed(1)}MB last-third mean=${(lastMean / (1024 * 1024)).toFixed(1)}MB ratio=${driftRatio.toFixed(3)} (tolerance: last ≤ first + 15%) — no upward drift beyond noise`,
      );
      expect(lastMean).toBeLessThanOrEqual(firstMean * 1.15);

      // -- (b) No queue runaway ---------------------------------------------
      const depths = samples.map((s) => s.depth);
      const maxDepth = depths.reduce((acc, depth) => (depth > acc ? depth : acc), 0);
      const lastDepth = depths[depths.length - 1] ?? 0;
      const lastFailed = samples[samples.length - 1]?.failed ?? 0;
      console.log(
        `[soak-shaped] queue-health baseline-depth=${baselineDepth} sampled max=${maxDepth} last=${lastDepth} failed baseline=${baselineFailed} last=${lastFailed} (depth stable, no dead-letter growth)`,
      );
      expect(maxDepth).toBeLessThanOrEqual(baselineDepth + 3);
      expect(lastDepth).toBeLessThanOrEqual(baselineDepth + 2);
      expect(lastFailed - baselineFailed).toBe(0);

      // -- (c) Error budget intact -------------------------------------------
      const mixTotal = opsRead + opsPosted + opsReport;
      console.log(
        `[soak-shaped] error-budget 5xx=${failures5xx}/${requests} http reads (mix: reads=${opsRead} posts=${opsPosted} reports=${opsReport}, total ops=${mixTotal} over ${(WINDOW_MS / 1000).toFixed(0)}s) — budget intact (0 required)`,
      );
      expect(failures5xx).toBe(0);
      expect(requests).toBeGreaterThan(100);
      expect(mixTotal).toBeGreaterThan(200);
      // The mix sanity: reads dominate, then posts, then reports (60/25/15).
      expect(opsRead).toBeGreaterThan(opsPosted);
      expect(opsPosted).toBeGreaterThan(opsReport);

      // The 12 h staging soak remains the infra-gated GA obligation; this
      // spec proves the assertion machinery (drift slopes, queue
      // stability, budget) at compressed scale.
      console.log(
        `[soak-shaped] window closed: ${(WINDOW_MS / 1000).toFixed(0)}s compressed — the 12 h staging soak is the infra-gated GA obligation (PERFORMANCE_TEST_PLAN §2/§8)`,
      );
    },
  );
});
