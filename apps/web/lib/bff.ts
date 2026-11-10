/**
 * Server-side BFF helpers (ADR-0003 / M-03 cookie-flags contract).
 *
 * The browser holds exactly ONE session credential: the httpOnly, Secure
 * (prod), SameSite=Lax cookie `erp_session` with the opaque session token.
 * Every call to the API is made server-side here with `X-Session-Token`.
 * A second, readable cookie `erp_csrf` carries the CSRF double-submit token;
 * the BFF rejects unsafe browser requests whose `X-CSRF-Token` header does
 * not echo it (the API plane itself is CSRF-exempt by construction).
 *
 * This module is server-only: it is imported by route handlers and server
 * components, never from client components.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  CSRF_COOKIE,
  SAFE_METHODS,
  SESSION_COOKIE,
  errorBodyOf,
  isSuccessEnvelope,
  isRecord,
  paginatedMetaOf,
  parseJsonOrUndefined,
  retrySecondsFrom,
  retrySecondsFromHeader,
  type ApiErrorBody,
  type ApiResult,
} from "./api-types";

/** Identity API base URL (NestJS, PHASE-003). */
export const API_BASE_URL = process.env.ERP_API_URL ?? "http://127.0.0.1:3001";

const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12h — matches the API session window
const secureCookies = process.env.NODE_ENV === "production";

export function apiEndpoint(path: string): string {
  return `${API_BASE_URL}/api/v1/${path}`;
}

/** Random 32-byte base64url value — the per-login CSRF token (M-03). */
export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface UpstreamCall {
  method?: string;
  body?: unknown;
  sessionToken?: string;
  idempotencyKey?: string;
  requestId?: string;
  forwardedFor?: string | null;
}

export interface UpstreamResponse {
  status: number;
  json: unknown;
  retryAfter: string | null;
}

/**
 * Calls the identity API with the BFF's header contract: X-Request-Id,
 * Idempotency-Key on unsafe methods (uuid when the caller has none),
 * X-Session-Token when a session is being forwarded, X-Forwarded-For.
 */
export async function callApi(path: string, init: UpstreamCall = {}): Promise<UpstreamResponse> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {
    "x-request-id": init.requestId ?? randomUUID(),
  };
  const forwardedFor = init.forwardedFor;
  if (forwardedFor !== undefined && forwardedFor !== null && forwardedFor !== "") {
    headers["x-forwarded-for"] = forwardedFor;
  }
  const sessionToken = init.sessionToken;
  if (sessionToken !== undefined && sessionToken !== "") {
    headers["x-session-token"] = sessionToken;
  }
  if (!SAFE_METHODS.has(method)) {
    headers["idempotency-key"] = init.idempotencyKey ?? randomUUID();
  }
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  let upstream: Response;
  try {
    upstream = await fetch(apiEndpoint(path), { method, headers, body, cache: "no-store" });
  } catch {
    return { status: 0, json: networkErrorEnvelope(), retryAfter: null };
  }
  const retryAfter = upstream.headers.get("retry-after");
  return {
    status: upstream.status,
    json: parseJsonOrUndefined(await upstream.text()),
    retryAfter,
  };
}

function networkErrorEnvelope(): { error: ApiErrorBody } {
  return { error: { code: "NETWORK_ERROR", message: "identity API is unreachable" } };
}

/** Parses an upstream response into the discriminated `ApiResult` (P4-T12a: also surfaces cursor-pagination meta). */
export function toApiResult<T>(upstream: UpstreamResponse): ApiResult<T> {
  if (isSuccessEnvelope(upstream.json)) {
    return { ok: true, data: upstream.json.data as T, meta: paginatedMetaOf(upstream.json) };
  }
  const error = errorBodyOf(upstream.json);
  return {
    ok: false,
    status: upstream.status === 0 ? 503 : upstream.status,
    error,
    retryAfterSeconds:
      retrySecondsFrom(error.details) ?? retrySecondsFromHeader(upstream.retryAfter) ?? undefined,
  };
}

/**
 * CSRF double-submit check. Unsafe methods are authorized when the request
 * carries NO session cookie (public login / password-reset / invitation
 * accept) or when `X-CSRF-Token` echoes the readable `erp_csrf` cookie.
 */
export function isCsrfAuthorized(input: {
  method: string;
  hasSession: boolean;
  headerToken: string | null;
  cookieToken: string | undefined;
}): boolean {
  if (SAFE_METHODS.has(input.method)) {
    return true;
  }
  if (!input.hasSession) {
    return true;
  }
  return (
    input.headerToken !== null &&
    input.headerToken !== "" &&
    input.cookieToken !== undefined &&
    input.cookieToken !== "" &&
    input.headerToken === input.cookieToken
  );
}

/** Sets the session cookie (httpOnly) + a fresh readable CSRF cookie. */
export function applySessionCookies(response: NextResponse, sessionToken: string): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.set({
    name: CSRF_COOKIE,
    value: newCsrfToken(),
    httpOnly: false,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Clears both cookies (logout / dead session). */
export function clearSessionCookies(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set({
    name: CSRF_COOKIE,
    value: "",
    httpOnly: false,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 0,
  });
}

/** 403 response for CSRF failures (M-03). */
export function csrfFailure(): NextResponse {
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message: "csrf token missing or mismatch", traceId: randomUUID() } },
    { status: 403 },
  );
}

/** 400 response for malformed BFF request bodies. */
export function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_ERROR", message, traceId: randomUUID() } },
    { status: 400 },
  );
}

/** Passes an upstream envelope through to the browser (status + Retry-After). */
export function errorPassthrough(upstream: UpstreamResponse): NextResponse {
  const status = upstream.status === 0 ? 502 : upstream.status;
  const payload = isRecord(upstream.json)
    ? upstream.json
    : { error: { code: "INTERNAL", message: "upstream error", traceId: randomUUID() } };
  const response = NextResponse.json(payload, { status });
  if (upstream.retryAfter !== null) {
    response.headers.set("retry-after", upstream.retryAfter);
  }
  return response;
}

/** Success envelope for the session routes, with the raw token removed. */
export function strippedDataResponse(
  data: { token: string } & Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json({ data: stripToken(data), meta: { requestId: randomUUID() } }, { status });
}

/**
 * Removes `token` from a success payload. The browser NEVER receives the
 * raw session token in a JSON body — the httpOnly cookie carries it.
 */
export function stripToken(data: { token: string } & Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "token") {
      rest[key] = value;
    }
  }
  return rest;
}

/** Reads and validates a JSON object body from the browser. */
export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** String field of a JSON object body, trimmed; undefined when absent/not a string. */
export function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * String field WITHOUT trimming — for secrets (passwords) where the BFF must
 * not mutate credentials before forwarding them.
 */
export function readRawString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }
  return value === "" ? undefined : value;
}

/** Rejects path segments that could escape the /api/v1/<path> namespace. */
export function isSafePathSegment(segment: string): boolean {
  return /^[A-Za-z0-9._~-]+$/.test(segment);
}
