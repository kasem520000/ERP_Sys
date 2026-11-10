import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { startBoss, stopBoss } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { newRunService, fullContext } from "../reporting/fixtures";
import {
  GA_OWNERS,
  GA_OWNER_PASSWORD,
  GA_TENANT_LARGE,
  GA_TENANT_SMALL,
  cleanupGALoadVolume,
  gaStats,
  gaTimed,
  provisionGATenantWithOwner,
  seedGALoadVolume,
  seedGASingleTenantVolume,
} from "./ga-fixtures";
import { AppModule } from "../../app.module";

/**
 * PHASE-025 T4b · the report-hammer noisy-neighbor scenario
 * (PERFORMANCE_TEST_PLAN §2: "one large tenant requests the heaviest
 * reports concurrently up to its quota; quota enforcement works; other
 * tenants unaffected" — MULTI_TENANCY §5), executed at local-harness tier.
 *
 * ## What the quota state actually is (the honest finding, T4b)
 *
 * MULTI_TENANCY §5 specifies "report job concurrency quotas" as an MVP
 * fairness measure. As of PHASE-025 HEAD, NO per-tenant report-run
 * quota/concurrency cap exists in the code: searched
 * modules/reporting + infra — the fairness mechanisms that DO exist are
 * (a) the R-04 per-tenant API burst window (PHASE-024 T5 — bounds ALL
 * authenticated /api/v1 requests incl. report-runs, 429-before-collapse
 * proven in ga-spike.db.spec.ts), (b) the GLOBAL Chromium render-pool
 * semaphore (RISK-013, reporting/render — render concurrency, not a
 * per-tenant report-run quota), and (c) the execution-class split (heavy
 * renders go to the pg-boss job path — ADR-0011 worker isolation). This
 * spec therefore implements the honest slice the phase task prescribes:
 * concurrent heaviest-report runs (trial-balance COMPUTE at the 100k
 * scale — every run a fresh compute, never a cache hit) for the large
 * tenant while a SMALL tenant's interactive report compute + document
 * reads stay within their own budgets (isolation evidence). The
 * per-tenant report-run quota itself remains a MULTI_TENANCY §5 gap the
 * GA report must carry (no new features this phase — §4 of PHASE-025).
 *
 * The production-class hammer is the infra-gated GA obligation; the
 * `[report-hammer]` lines are the recorded local-tier evidence.
 */

const SMALL_OWNER_EMAIL = "ga-small-owner@fixture.test";

let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let smallOwnerToken = "";
let requests = 0;
let failures5xx = 0;

async function listJournalEntries(token: string): Promise<number> {
  requests += 1;
  const response = await fetch(
    `${httpBase}/api/v1/accounting/journal-entries?limit=50`,
    { headers: { "x-session-token": token } },
  );
  if (response.status >= 500) {
    failures5xx += 1;
  }
  return response.status;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();

  // The noisy neighbor: the large tenant at its full documented tier
  // (100k entries + 200k lines). The witness: the small tenant (1k
  // entries + 2k lines, its own posting/reporting world + owner).
  await seedGALoadVolume({ cohorts: false });
  await provisionGATenantWithOwner({
    tenantId: GA_TENANT_SMALL,
    tenantName: "Tenant GA small (hammer witness)",
    ownerId: GA_OWNERS.small,
    ownerEmail: SMALL_OWNER_EMAIL,
  });
  await seedGASingleTenantVolume({
    tenantId: GA_TENANT_SMALL,
    slot: 4,
    entries: 1_000,
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
    body: JSON.stringify({ email: SMALL_OWNER_EMAIL, password: GA_OWNER_PASSWORD }),
  });
  const body = (await login.json()) as { data: { token: string } };
  smallOwnerToken = body.data.token;
}, 180_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await cleanupGALoadVolume();
  await closeDb();
});

describe("GA report hammer — noisy-neighbor isolation (PHASE-025 T4b; PERFORMANCE_TEST_PLAN §2; MULTI_TENANCY §5)", () => {
  it(
    "the large tenant's concurrent heaviest-report runs leave the small tenant inside its own budgets",
    { timeout: 180_000 },
    async () => {
      const runs = newRunService();

      // Hammer waves: 3 waves × 4 concurrent trial-balance COMPUTES on the
      // 100k-scale large tenant (same params within a wave — the classic
      // concurrent-identical-heavy-request shape; distinct across waves so
      // every run is a fresh compute, never a cache hit). Concurrently with
      // each wave, the small tenant's interactive report compute + document
      // read are measured (the isolation witness).
      const witnessReportSamples: number[] = [];
      const witnessListSamples: number[] = [];
      const hammerDurations: number[] = [];
      const waveCount = 3;
      const lanesPerWave = 4;

      for (let wave = 0; wave < waveCount; wave += 1) {
        const dateFrom = `2026-01-0${1 + wave}`;
        const hammerWave = (async () => {
          const started = Date.now();
          const outcomes = await Promise.all(
            Array.from({ length: lanesPerWave }, () =>
              withTenant(GA_TENANT_LARGE, () =>
                runs.run({
                  reportKey: "financial.trial-balance",
                  params: { dateFrom, dateTo: "2026-01-28", locale: "en" },
                  ctx: fullContext(GA_TENANT_LARGE),
                }),
              ),
            ),
          );
          hammerDurations.push(Date.now() - started);
          return outcomes;
        })();

        // The witness samples run WHILE the hammer wave is in flight.
        const reportMs = await withTenant(GA_TENANT_SMALL, () =>
          gaTimed(() =>
            runs.run({
              reportKey: "financial.trial-balance",
              params: { dateFrom: `2026-01-1${wave}`, dateTo: "2026-01-28", locale: "en" },
              ctx: fullContext(GA_TENANT_SMALL),
            }),
          ),
        );
        witnessReportSamples.push(reportMs);
        const listMs = await gaTimed(async () => {
          const status = await listJournalEntries(smallOwnerToken);
          expect(status).toBe(200);
        });
        witnessListSamples.push(listMs);

        const outcomes = await hammerWave;
        for (const outcome of outcomes) {
          expect(outcome.status).toBe("SUCCEEDED");
        }
      }

      // A second witness pass with more samples (the budgets assert p95).
      for (let round = 0; round < 3; round += 1) {
        const reportMs = await withTenant(GA_TENANT_SMALL, () =>
          gaTimed(() =>
            runs.run({
              reportKey: "financial.trial-balance",
              params: {
                dateFrom: `2026-01-2${8 - round}`,
                dateTo: "2026-01-28",
                locale: "en",
              },
              ctx: fullContext(GA_TENANT_SMALL),
            }),
          ),
        );
        witnessReportSamples.push(reportMs);
        const listMs = await gaTimed(async () => {
          const status = await listJournalEntries(smallOwnerToken);
          expect(status).toBe(200);
        });
        witnessListSamples.push(listMs);
      }

      const reportStats = gaStats(witnessReportSamples);
      const listStats = gaStats(witnessListSamples);
      const hammerMax = hammerDurations.reduce((acc, ms) => (ms > acc ? ms : acc), 0);
      console.log(
        `[report-hammer] large-tenant hammer: ${waveCount} waves × ${lanesPerWave} concurrent trial-balance COMPUTES @100k (wave wall ${hammerDurations.join("/")}ms, max ${hammerMax}ms) — all SUCCEEDED`,
      );
      console.log(
        `[report-hammer] noisy-neighbor isolation: small-tenant interactive report (TB compute @1k) p95=${reportStats.p95}ms (p50=${reportStats.p50} p99=${reportStats.p99} n=${reportStats.n}) budget=2000ms; document list p95=${listStats.p95}ms (n=${listStats.n}) budget=500ms`,
      );
      console.log(
        `[report-hammer] quota state (honest marker): NO per-tenant report-run quota exists at PHASE-025 HEAD (MULTI_TENANCY §5 gap carried to the GA report); fairness exercised as far as it exists = R-04 per-tenant API window (ga-spike spec) + global render-pool semaphore + inline/job execution-class split`,
      );

      expect(hammerDurations.length).toBe(waveCount);
      expect(reportStats.p95).toBeLessThan(2000);
      expect(listStats.p95).toBeLessThan(500);
      expect(failures5xx).toBe(0);
      expect(requests).toBeGreaterThanOrEqual(6);
    },
  );
});
