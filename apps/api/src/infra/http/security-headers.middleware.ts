import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/**
 * PHASE-024 T9 — API-origin security headers (SECURITY_TEST_PLAN §8): a
 * fixed set on EVERY response this origin emits. A JSON API serves no
 * documents, no scripts, no frames — the CSP is `default-src 'none'` plus
 * the frame/base denials, deliberately stricter than the web origin's
 * nonce'd document CSP (apps/web/middleware.ts owns that one).
 *
 * Registered BEFORE any middleware that can short-circuit a response
 * (SessionMiddleware's 423 gate, the tenant limiter's 429) — headers set
 * before `next()` survive on every short-circuited response too.
 */

const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ["Strict-Transport-Security", "max-age=63072000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  ["Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"],
];

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    for (const [name, value] of SECURITY_HEADERS) {
      response.header(name, value);
    }
    next();
  }
}
