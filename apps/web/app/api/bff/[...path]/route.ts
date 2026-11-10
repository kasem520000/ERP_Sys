/**
 * Generic BFF proxy: /api/bff/<anything> → ${ERP_API_URL}/api/v1/<anything>.
 *
 * - forwards the `erp_session` cookie value as `X-Session-Token`;
 * - unsafe methods from a session-holding browser must echo the `erp_csrf`
 *   cookie in `X-CSRF-Token` (double-submit), otherwise 403 FORBIDDEN;
 * - unsafe requests get an `Idempotency-Key` (browser-supplied or generated
 *   here) plus a generated `X-Request-Id`; `X-Forwarded-For` is forwarded;
 * - the upstream envelope + status (+ Retry-After) pass through as-is;
 * - defense in depth: if an upstream success payload ever carries a raw
 *   `token`, it is moved into the session cookie and stripped from the
 *   body before the browser sees it.
 *
 * Login/logout/switch/accept do NOT go through here — they use the explicit
 * cookie routes at /api/bff/session and /api/bff/session/accept.
 *
 * P4-T12a: PATCH joins the exported methods — the PHASE-004 branch toggle
 * (PATCH /tenancy/branches/:id) flows through the same proxy pipeline
 * (CSRF double-submit + Idempotency-Key are already method-agnostic below).
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  CSRF_COOKIE,
  SAFE_METHODS,
  SESSION_COOKIE,
  hasToken,
  isSuccessEnvelope,
  parseJsonOrUndefined,
} from "@/lib/api-types";
import {
  API_BASE_URL,
  applySessionCookies,
  apiEndpoint,
  csrfFailure,
  isCsrfAuthorized,
  isSafePathSegment,
} from "@/lib/bff";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, await context.params);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, await context.params);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, await context.params);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, await context.params);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, await context.params);
}

async function proxy(request: NextRequest, params: { path: string[] }): Promise<NextResponse> {
  const segments = params.path;
  if (segments.length === 0 || !segments.every(isSafePathSegment)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "unknown bff route", traceId: randomUUID() } },
      { status: 404 },
    );
  }
  const path = segments.join("/");

  const method = request.method.toUpperCase();
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const hasSession = sessionToken !== "";

  if (
    !SAFE_METHODS.has(method) &&
    !isCsrfAuthorized({
      method,
      hasSession,
      headerToken: request.headers.get("x-csrf-token"),
      cookieToken: request.cookies.get(CSRF_COOKIE)?.value,
    })
  ) {
    return csrfFailure();
  }

  const search = new URL(request.url).search;
  const headers: Record<string, string> = {
    "x-request-id": request.headers.get("x-request-id") ?? randomUUID(),
  };
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor !== null) {
    headers["x-forwarded-for"] = forwardedFor;
  }
  if (hasSession) {
    headers["x-session-token"] = sessionToken;
  }
  if (!SAFE_METHODS.has(method)) {
    headers["idempotency-key"] = request.headers.get("idempotency-key") ?? randomUUID();
  }
  let body: string | undefined;
  if (!SAFE_METHODS.has(method)) {
    body = await request.text();
    if (body !== "") {
      headers["content-type"] = request.headers.get("content-type") ?? "application/json";
    } else {
      body = undefined;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiEndpoint(path)}${search}`, {
      method,
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: { code: "NETWORK_ERROR", message: `identity API at ${API_BASE_URL} is unreachable`, traceId: randomUUID() } },
      { status: 502 },
    );
  }

  const json = parseJsonOrUndefined(await upstream.text());

  let payload: unknown = json;
  let newSessionToken: string | undefined;
  if (isSuccessEnvelope(payload) && hasToken(payload.data)) {
    newSessionToken = payload.data.token;
    payload = { ...payload, data: stripToken(payload.data) };
  }
  if (payload === undefined) {
    payload = { error: { code: "INTERNAL", message: "empty upstream response", traceId: randomUUID() } };
  }

  const response = NextResponse.json(payload, { status: upstream.status });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null) {
    response.headers.set("retry-after", retryAfter);
  }
  if (newSessionToken !== undefined) {
    applySessionCookies(response, newSessionToken);
  }
  return response;
}

/** Removes `token` from an upstream success payload (never reaches the browser). */
function stripToken(data: { token: string } & Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "token") {
      rest[key] = value;
    }
  }
  return rest;
}
