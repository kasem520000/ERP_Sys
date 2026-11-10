import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { startBoss, stopBoss } from "../../infra/jobs/boss";
import { TENANT_LIMITER } from "../../modules/identity/infrastructure/rate-limiter";
import {
  GA_OWNERS,
  GA_OWNER_PASSWORD,
  GA_TENANT_SPIKE_A,
  GA_TENANT_SPIKE_B,
  provisionGATenantWithOwner,
} from "./ga-fixtures";
import { AppModule } from "../../app.module";

/**
 * PHASE-025 T4a · the month-end spike scenario (PERFORMANCE_TEST_PLAN §2:
 * "5× jump in 2 min — graceful degradation: 429s before collapse; recovery
 * < 5 min"), executed at local-harness tier against the R-04 per-tenant API
 * burst limiter (PHASE-024 T5; tenant-rate-limit.middleware) over the real
 * HTTP surface of the booted app.
 *
 * Shape: one tenant fires a request storm past its sliding-window budget
 * (the limiter's DEFAULT production ceiling — 1000 per 10 s window,
 * TENANT_BURST_WINDOW_MS — read from the live singleton, never assumed)
 * at a pool-safe sustained rate — 10 concurrent lanes ≈ 150–170 req/s over
 * loopback ≈ 5.5× the §3 modeled large-tenant baseline (~30 req/s for 50
 * users): the month-end 5×-jump shape. (The first draft stormed at
 * 50-concurrency ≈ 800 req/s loopback — 8× the ceiling — and the DB pool
 * saturated BEFORE the limiter's ceiling: every request costs several
 * sequential withTenant transactions, the limiter's own tenant lookup
 * timed out with the pool, and the platform COLLAPSED with 5xx instead of
 * 429ing. That collapse mode is recorded as the honest SF-025-002 finding
 * — under loopback-speed storms the pool, not the limiter, is the first
 * ceiling; production-class runs carry real network latency (the k6 tier)
 * and pool sizing is the O-4 ladder. The passing shape below proves the
 * graceful-degradation CONTRACT at storm rates the modeled traffic can
 * actually produce.) The scenario asserts:
 * 1. saturation 429s THAT TENANT ONLY, with the quota headers
 *    (X-RateLimit-Limit/-Remaining) + Retry-After + the TENANT_RATE_LIMITED
 *    envelope (ERROR_MODEL §2 shape),
 * 2. ANOTHER tenant's budget is untouched (A/B isolation over the wire),
 * 3. zero 5xx anywhere in the storm (429s BEFORE collapse — the cheap
 *    rejection dominates; no DB strain surfaces as server errors),
 * 4. recovery: the window slides (10 s mechanics) and the tenant serves
 *    200s again well inside the < 5 min budget — the window expiry IS the
 *    recovery mechanism (documented honestly; no fabricated minutes).
 *
 * The production-class 5×-jump k6 run is the infra-gated GA obligation; the
 * `[ga-spike]` lines are the recorded local-tier evidence.
 */

const EMAIL_A = "ga-spike-a@fixture.test";
const EMAIL_B = "ga-spike-b@fixture.test";

let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let tokenA = "";
let tokenB = "";
let requests = 0;
let failures5xx = 0;
let networkErrors = 0;

interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: { data?: unknown; error?: { code: string } };
}

async function fire(token: string): Promise<ApiResponse> {
  requests += 1;
  try {
    const response = await fetch(`${httpBase}/api/v1/identity/sessions/current`, {
      headers: { "x-session-token": token },
    });
    if (response.status >= 500) {
      failures5xx += 1;
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const text = await response.text();
    return {
      status: response.status,
      headers,
      body: text === "" ? {} : (JSON.parse(text) as ApiResponse["body"]),
    };
  } catch {
    // A transport-level failure (connection timeout/reset) IS the collapse
    // signal this scenario must not see — counted separately from 5xx.
    networkErrors += 1;
    return { status: 0, headers: {}, body: {} };
  }
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${httpBase}/api/v1/identity/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: GA_OWNER_PASSWORD }),
  });
  const body = (await response.json()) as { data: { token: string } };
  return body.data.token;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();

  await provisionGATenantWithOwner({
    tenantId: GA_TENANT_SPIKE_A,
    tenantName: "Tenant GA spike A",
    ownerId: GA_OWNERS.spikeA,
    ownerEmail: EMAIL_A,
  });
  await provisionGATenantWithOwner({
    tenantId: GA_TENANT_SPIKE_B,
    tenantName: "Tenant GA spike B",
    ownerId: GA_OWNERS.spikeB,
    ownerEmail: EMAIL_B,
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

  tokenA = await login(EMAIL_A);
  tokenB = await login(EMAIL_B);
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("GA spike — 429 before collapse, A/B isolation, recovery (PHASE-025 T4a; PERFORMANCE_TEST_PLAN §2)", () => {
  it(
    "the storm: saturation 429s tenant A only, with quota headers; B untouched; recovery inside the window budget",
    { timeout: 300_000 },
    async () => {
      // The live ceiling of the process-wide R-04 singleton (the same
      // instance the middleware consults) — read, never assumed. The probe
      // draws from its OWN keyed namespace, never a tenant budget.
      const probe = TENANT_LIMITER.attempt(`ga-spike:probe:${Date.now()}`);
      const ceiling = probe.limit;
      expect(ceiling).toBeGreaterThanOrEqual(1);

      // Warm both tenants (JIT + pool warmup; A draws one attempt).
      const warmA = await fire(tokenA);
      expect(warmA.status).toBe(200);
      const warmB = await fire(tokenB);
      expect(warmB.status).toBe(200);

      // The storm: 10 bounded concurrent lanes, sustained past the window
      // budget (the 5×-jump shape — 10 lanes ≈ 165 req/s over loopback vs
      // the ~30 req/s modeled tenant baseline; pool-safe by construction:
      // 10 in-flight < the 20-connection pool, so the limiter's decision —
      // and its one indexed tenant lookup — always gets a connection and
      // the 429 path stays reachable). Stop at the FIRST 429 (the
      // graceful-degradation point) — the assertions then pin the contract,
      // and the recovery phase exercises the window mechanics.
      const LANES = 10;
      let fired = 0;
      let first429: ApiResponse | undefined;
      const stormDeadline = Date.now() + 90_000;
      while (
        first429 === undefined &&
        fired < ceiling + 600 &&
        Date.now() < stormDeadline
      ) {
        const wave = await Promise.all(
          Array.from({ length: LANES }, () => fire(tokenA)),
        );
        fired += wave.length;
        for (const response of wave) {
          if (response.status === 429 && first429 === undefined) {
            first429 = response;
          }
        }
      }
      expect(fired).toBeGreaterThan(0);
      console.log(
        `[ga-spike] burst fired=${fired + 1} ceiling=${ceiling}/10s-window (first-429 at attempt ≤ ${fired + 1}) — the month-end storm shape at the default R-04 ceiling`,
      );

      // (1) The saturation contract on the first 429.
      expect(first429, "the storm must saturate the tenant window (429 before collapse)").toBeDefined();
      const blocked = first429!;
      expect(blocked.status).toBe(429);
      expect(blocked.body.error?.code).toBe("TENANT_RATE_LIMITED");
      expect(Number(blocked.headers["x-ratelimit-limit"])).toBe(ceiling);
      expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
      expect(blocked.headers["retry-after"]).toMatch(/^\d+$/);
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(10);
      console.log(
        `[ga-spike] 429 contract: code=TENANT_RATE_LIMITED X-RateLimit-Limit=${blocked.headers["x-ratelimit-limit"]} X-RateLimit-Remaining=${blocked.headers["x-ratelimit-remaining"]} Retry-After=${blocked.headers["retry-after"]}s`,
      );

      // Sustained degradation (not a blip): a few more requests all 429.
      const sustained = await Promise.all([
        fire(tokenA),
        fire(tokenA),
        fire(tokenA),
      ]);
      for (const response of sustained) {
        expect(response.status).toBe(429);
        expect(response.headers["retry-after"]).toMatch(/^\d+$/);
      }

      // (2) A/B isolation: tenant A is saturated, tenant B serves normally
      // with its OWN untouched budget.
      const witness = await fire(tokenB);
      expect(witness.status).toBe(200);
      const bRemaining = Number(witness.headers["x-ratelimit-remaining"]);
      expect(Number.isFinite(bRemaining)).toBe(true);
      expect(bRemaining).toBeGreaterThanOrEqual(ceiling - 5);
      console.log(
        `[ga-spike] A/B isolation: tenant B 200 while A saturated (B X-RateLimit-Remaining=${bRemaining}/${ceiling} — B drew only its own warm+witness attempts)`,
      );

      // (3) Graceful degradation — no collapse: zero 5xx and zero transport
      // errors across the whole storm so far.
      expect(failures5xx).toBe(0);
      expect(networkErrors).toBe(0);

      // (4) Recovery: the 10 s sliding window frees the budget — poll
      // until tenant A serves a 200 again (honest wait inside the < 5 min
      // budget; the window expiry IS the mechanism, no time manipulation).
      const recoveryDeadline = Date.now() + 60_000;
      let recovered: ApiResponse | undefined;
      while (Date.now() < recoveryDeadline) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
        const attempt = await fire(tokenA);
        if (attempt.status === 200) {
          recovered = attempt;
          break;
        }
        expect(attempt.status).toBe(429);
      }
      expect(recovered, "the window must slide and restore tenant A's budget").toBeDefined();
      const recoveredRemaining = Number(recovered!.headers["x-ratelimit-remaining"]);
      expect(Number.isFinite(recoveredRemaining)).toBe(true);
      expect(recoveredRemaining).toBeGreaterThan(0);
      console.log(
        `[ga-spike] recovery: tenant A serving 200s again after the 10s sliding window expired (X-RateLimit-Remaining=${recoveredRemaining}) — recovery well inside the <5min budget (window expiry is the mechanism)`,
      );

      // Post-recovery: B still healthy (no cross-contamination anywhere).
      const witnessAfter = await fire(tokenB);
      expect(witnessAfter.status).toBe(200);

      // Whole-scenario error budget: zero 5xx, zero transport errors.
      console.log(
        `[ga-spike] degradation evidence: requests=${requests} 5xx=${failures5xx} transportErrors=${networkErrors} (429s before collapse — budget: 0)`,
      );
      expect(failures5xx).toBe(0);
      expect(networkErrors).toBe(0);
      expect(requests).toBeGreaterThan(ceiling);
    },
  );
});
