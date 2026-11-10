import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

import {
  RateLimiter,
  TENANT_BURST_MAX_DEFAULT,
  tenantRateLimitMax,
  tenantRateLimiter,
} from "../../modules/identity/infrastructure/rate-limiter";
import {
  enforceTenantRateLimit,
  type TenantRateLimitDeps,
} from "./tenant-rate-limit.middleware";

/**
 * PHASE-024 T5 (R-04) plain unit evidence (no DB): quota headers on pass,
 * the 429 envelope + Retry-After on saturation, tenant-key isolation, the
 * skip cases, and the env-tunable ceiling. The end-to-end HTTP proof (real
 * session rows, two tenants over the wire) lands in the orchestrator's db
 * suite; this pins the middleware decision logic deterministically.
 */

/** Manual clock — drives the 10 s window without sleeping. */
function manualClock() {
  const state = { nowMs: 1_700_000_000_000 };
  return {
    state,
    clock: {
      now: () => new Date(state.nowMs),
      sleep: async () => undefined,
    },
  };
}

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function fakeRequest(input: { method?: string; path: string; token?: string }): Request {
  const headers: Record<string, string> = {};
  if (input.token !== undefined) {
    headers["x-session-token"] = input.token;
  }
  return {
    method: input.method ?? "GET",
    path: input.path,
    header: (name: string) => headers[name],
  } as unknown as Request;
}

function fakeResponse(): {
  response: Response;
  headers: Record<string, string>;
  statusCode: () => number | undefined;
  body: () => unknown;
} {
  const headers: Record<string, string> = {};
  let status: number | undefined;
  let jsonBody: unknown;
  const response = {
    header(name: string, value: string) {
      headers[name] = value;
      return response;
    },
    status(code: number) {
      status = code;
      return {
        json(payload: unknown) {
          jsonBody = payload;
        },
      };
    },
  } as unknown as Response;
  return {
    response,
    headers,
    statusCode: () => status,
    body: () => jsonBody,
  };
}

function deps(limiter: RateLimiter, tenantId: string | null | undefined): TenantRateLimitDeps {
  return {
    limiter,
    findSessionTenant: vi.fn(async () =>
      tenantId === undefined ? undefined : { activeTenantId: tenantId },
    ),
  };
}

async function run(
  request: Request,
  limiter: RateLimiter,
  tenantId: string | null | undefined,
): Promise<{ nextCalls: number; headers: Record<string, string>; status: () => number | undefined; body: () => unknown }> {
  let nextCalls = 0;
  const { response, headers, statusCode, body } = fakeResponse();
  await enforceTenantRateLimit(
    request,
    response,
    (() => {
      nextCalls += 1;
    }) as NextFunction,
    deps(limiter, tenantId),
  );
  return { nextCalls, headers, status: statusCode, body };
}

describe("TenantRateLimitMiddleware (R-04 — per-tenant API burst)", () => {
  beforeEach(() => {
    delete process.env.TENANT_RATE_LIMIT_MAX;
  });

  it("passes under budget: X-RateLimit headers set, chain continues, remaining decrements", async () => {
    const { clock } = manualClock();
    const limiter = new RateLimiter(clock, 3, 10_000);
    const first = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    expect(first.nextCalls).toBe(1);
    expect(first.headers["X-RateLimit-Limit"]).toBe("3");
    expect(first.headers["X-RateLimit-Remaining"]).toBe("2");
    const second = await run(
      fakeRequest({ path: "/api/v1/items", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    expect(second.headers["X-RateLimit-Remaining"]).toBe("1");
    expect(second.status()).toBeUndefined(); // nothing short-circuited
  });

  it("saturates: 429 envelope exactly as the error filter shapes it + Retry-After", async () => {
    const { clock } = manualClock();
    const limiter = new RateLimiter(clock, 3, 10_000);
    for (let i = 0; i < 3; i += 1) {
      await run(fakeRequest({ path: "/api/v1/partners", token: "tok-a" }), limiter, TENANT_A);
    }
    const blocked = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    expect(blocked.nextCalls).toBe(0); // short-circuited — no downstream work
    expect(blocked.status()).toBe(429);
    expect(blocked.body()).toEqual({
      error: {
        code: "TENANT_RATE_LIMITED",
        message: "tenant API burst limit reached — retry later",
        retryable: false,
        traceId: "", // no ALS correlation scope in the unit harness
      },
    });
    expect(blocked.headers["X-RateLimit-Limit"]).toBe("3");
    expect(blocked.headers["X-RateLimit-Remaining"]).toBe("0");
    expect(blocked.headers["Retry-After"]).toBe("10"); // full 10 s window, ceil
  });

  it("Retry-After is the ceil of the remaining window (integer arithmetic, never 0)", async () => {
    const { clock, state } = manualClock();
    const limiter = new RateLimiter(clock, 3, 10_000);
    for (let i = 0; i < 4; i += 1) {
      await run(fakeRequest({ path: "/api/v1/partners", token: "tok-a" }), limiter, TENANT_A);
    }
    // 4 s into the window: oldest attempt still 6 s from expiry → ceil 6.
    state.nowMs += 4_000;
    const blocked = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    expect(blocked.headers["Retry-After"]).toBe("6");
    // Window slides fully at +10 s: budget is back — the T+4s attempt is
    // still inside the window (6 s left of it), so 3 − 2 in-flight = 1 left.
    state.nowMs += 6_001;
    const fresh = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    expect(fresh.nextCalls).toBe(1);
    expect(fresh.headers["X-RateLimit-Remaining"]).toBe("1");
  });

  it("tenant isolation: A's saturation does not touch B's budget (R-04 core)", async () => {
    const { clock } = manualClock();
    const limiter = new RateLimiter(clock, 3, 10_000);
    for (let i = 0; i < 6; i += 1) {
      await run(fakeRequest({ path: "/api/v1/partners", token: "tok-a" }), limiter, TENANT_A);
    }
    const blockedA = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    expect(blockedA.status()).toBe(429);
    const passesB = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-b" }),
      limiter,
      TENANT_B,
    );
    expect(passesB.nextCalls).toBe(1);
    expect(passesB.status()).toBeUndefined();
    expect(passesB.headers["X-RateLimit-Remaining"]).toBe("2"); // B drew ONE attempt — its own budget
  });

  it("skips public routes, non-API paths, anonymous requests, and tenantless sessions", async () => {
    const { clock } = manualClock();
    const limiter = new RateLimiter(clock, 1, 10_000); // saturates after 1
    // Public route (registry row incl. method) — no session lookup at all.
    const lookup = vi.fn(async () => ({ activeTenantId: TENANT_A }));
    let calls = 0;
    await enforceTenantRateLimit(
      fakeRequest({ method: "POST", path: "/api/v1/identity/sessions" }),
      fakeResponse().response,
      (() => {
        calls += 1;
      }) as NextFunction,
      { limiter, findSessionTenant: lookup },
    );
    expect(calls).toBe(1);
    expect(lookup).not.toHaveBeenCalled();
    // Path-param public route (reset consume).
    await enforceTenantRateLimit(
      fakeRequest({ method: "PUT", path: "/api/v1/identity/password-resets/abc123" }),
      fakeResponse().response,
      (() => {
        calls += 1;
      }) as NextFunction,
      { limiter, findSessionTenant: lookup },
    );
    expect(lookup).not.toHaveBeenCalled();
    // Outside /api/v1 (health plane).
    const health = await run(fakeRequest({ path: "/health/live", token: "tok-a" }), limiter, TENANT_A);
    expect(health.nextCalls).toBe(1);
    // No session token at all.
    const anonymous = await run(fakeRequest({ path: "/api/v1/partners" }), limiter, TENANT_A);
    expect(anonymous.nextCalls).toBe(1);
    // Session unresolvable (unknown/revoked token hash).
    const unknown = await run(
      fakeRequest({ path: "/api/v1/partners", token: "garbage" }),
      limiter,
      undefined,
    );
    expect(unknown.nextCalls).toBe(1);
    expect(unknown.headers["X-RateLimit-Limit"]).toBeUndefined();
    // Session exists but has no active tenant yet (pre-switch session).
    const tenantless = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-none" }),
      limiter,
      null,
    );
    expect(tenantless.nextCalls).toBe(1);
    expect(tenantless.headers["X-RateLimit-Limit"]).toBeUndefined();
  });

  it("TENANT_RATE_LIMIT_MAX is read at factory construction (env-tunable for tests)", async () => {
    process.env.TENANT_RATE_LIMIT_MAX = "2";
    expect(tenantRateLimitMax()).toBe(2);
    const { clock } = manualClock();
    const limiter = tenantRateLimiter(clock);
    const first = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    const second = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    const third = await run(
      fakeRequest({ path: "/api/v1/partners", token: "tok-a" }),
      limiter,
      TENANT_A,
    );
    expect(first.headers["X-RateLimit-Limit"]).toBe("2");
    expect(second.headers["X-RateLimit-Remaining"]).toBe("0");
    expect(third.status()).toBe(429);
  });

  it("unset or invalid env falls back to the documented default ceiling", () => {
    expect(tenantRateLimitMax()).toBe(TENANT_BURST_MAX_DEFAULT);
    process.env.TENANT_RATE_LIMIT_MAX = "";
    expect(tenantRateLimitMax()).toBe(TENANT_BURST_MAX_DEFAULT);
    process.env.TENANT_RATE_LIMIT_MAX = "not-a-number";
    expect(tenantRateLimitMax()).toBe(TENANT_BURST_MAX_DEFAULT);
  });
});
