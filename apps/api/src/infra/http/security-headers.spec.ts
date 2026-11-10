import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";

import { SecurityHeadersMiddleware } from "./security-headers.middleware";

/**
 * PHASE-024 T9 plain unit evidence (no DB): the fixed §8 header set on
 * every response the middleware touches. The HTTP-level proof (headers on
 * real API responses, incl. short-circuited 423/429 paths) lands in the
 * orchestrator's db suite; this pins the exact header values.
 */

function run(requestPath: string): {
  headers: Record<string, string>;
  nextCalls: number;
} {
  const headers: Record<string, string> = {};
  let nextCalls = 0;
  const response = {
    header(name: string, value: string) {
      headers[name] = value;
      return response;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    nextCalls += 1;
  };
  new SecurityHeadersMiddleware().use(
    { method: "GET", path: requestPath } as unknown as Request,
    response,
    next,
  );
  return { headers, nextCalls };
}

describe("SecurityHeadersMiddleware (T9 — SECURITY_TEST_PLAN §8, API origin)", () => {
  it("sets the full fixed header set on API routes", () => {
    const { headers, nextCalls } = run("/api/v1/partners");
    expect(nextCalls).toBe(1);
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["Content-Security-Policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
  });

  it("applies identically outside /api/v1 (health probes are API-origin too)", () => {
    const { headers, nextCalls } = run("/health/live");
    expect(nextCalls).toBe(1);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
  });

  it("overwrites nothing it does not know about — exactly six headers, no more", () => {
    const { headers } = run("/api/v1/identity/users");
    expect(Object.keys(headers).sort()).toEqual(
      [
        "Content-Security-Policy",
        "Permissions-Policy",
        "Referrer-Policy",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
      ].sort(),
    );
  });
});
