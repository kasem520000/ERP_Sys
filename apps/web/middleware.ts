/**
 * Secure-headers middleware (PHASE-005 T11; SECURITY_TEST_PLAN §8):
 * per-request CSP nonce (no `unsafe-inline` scripts, ever), HSTS, nosniff,
 * frame-ancestors 'none', Referrer-Policy, object-src 'none'.
 *
 * PHASE-024 T9: the BFF's own JSON routes now carry a FIXED header set too
 * (no nonce logic — they serve JSON, not documents): nosniff, DENY,
 * Referrer-Policy, and the API-grade `default-src 'none'` CSP. Staging can
 * shadow the enforced CSP with a Report-Only variant (CSP_REPORT_ONLY=1)
 * that adds `report-uri /csp-report` (deprecated directive, universally
 * supported — `report-to` needs a Reporting-Endpoints header, not worth the
 * surface here); the capture route logs reports, never stores them.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Fixed headers for BFF JSON responses (T9) — mirrors the API origin set. */
function withBffHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/bff" || pathname.startsWith("/api/bff/")) {
    // BFF plane: fixed headers, no per-request nonce (no documents here).
    return withBffHeaders(NextResponse.next());
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self'`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  if (process.env.CSP_REPORT_ONLY === "1") {
    // Staging shadow: the SAME policy in report-only mode, plus the
    // deprecated-but-universal report-uri pointing at the capture route.
    response.headers.set("Content-Security-Policy-Report-Only", `${csp}; report-uri /csp-report`);
  }
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = {
  matcher: ["/((?!api/bff|_next/static|_next/image|favicon.ico).*)", "/api/bff/:path*"],
};
