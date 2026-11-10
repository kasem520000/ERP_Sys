import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";

import { RequestIdMiddleware } from "./request-id.middleware";
import { getCorrelationId } from "./request-context";

function runMiddleware(headerValue?: string): {
  observed: string | undefined;
  echoed: string | undefined;
  statusCode: number;
} {
  const headers: Record<string, string> = {};
  if (headerValue !== undefined) {
    headers["x-request-id"] = headerValue;
  }
  const resHeaders: Record<string, string> = {};
  const finish = (): void => undefined;
  let observed: string | undefined;
  const res = {
    headers: resHeaders,
    statusCode: 200,
    setHeader(name: string, value: string) {
      resHeaders[name] = value;
    },
    on(_event: string, listener: () => void) {
      finishRef.listener = listener;
      return res;
    },
  } as unknown as Response;
  const finishRef = { listener: finish };
  const next: NextFunction = () => {
    // Inside the middleware's ALS scope: the request chain would run here.
    observed = getCorrelationId();
  };
  new RequestIdMiddleware().use(
    { headers, method: "GET", originalUrl: "/health/live" } as unknown as Request,
    res,
    next,
  );
  finishRef.listener(); // res 'finish' fires the access-log line after the chain.
  return { observed, echoed: resHeaders["X-Request-Id"], statusCode: res.statusCode };
}

describe("RequestIdMiddleware (OBSERVABILITY §Structured logging)", () => {
  it("generates a UUIDv7 correlation id and echoes it on the response", () => {
    const { observed, echoed } = runMiddleware();
    expect(observed).toBeDefined();
    expect(echoed).toBe(observed);
    expect(observed).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("accepts a valid incoming X-Request-Id verbatim", () => {
    const incoming = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const { observed, echoed } = runMiddleware(incoming);
    expect(observed).toBe(incoming);
    expect(echoed).toBe(incoming);
  });

  it("replaces a malformed incoming header (never trusted blindly)", () => {
    const { observed } = runMiddleware("drop table users; --");
    expect(observed).not.toContain("drop table");
    expect(observed).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
