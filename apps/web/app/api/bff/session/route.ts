/**
 * Dedicated BFF session route: POST = login, PUT = switch tenant,
 * DELETE = logout. Cookie handling is explicit here (the M-03 contract):
 * on login/switch success the httpOnly `erp_session` cookie is (re)issued
 * with a fresh readable `erp_csrf` double-submit token and the raw token
 * is stripped from the JSON the browser receives; logout clears both.
 *
 * POST (login) is public and CSRF-exempt; PUT/DELETE with a session
 * require the CSRF echo.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { CSRF_COOKIE, SESSION_COOKIE, hasToken, isSuccessEnvelope } from "@/lib/api-types";
import {
  applySessionCookies,
  badRequest,
  callApi,
  clearSessionCookies,
  csrfFailure,
  errorPassthrough,
  isCsrfAuthorized,
  readJsonBody,
  readRawString,
  readString,
  strippedDataResponse,
} from "@/lib/bff";

/** POST /api/bff/session — login (public). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (body === null) {
    return badRequest("a JSON object body is required");
  }
  const email = readString(body, "email");
  const password = readRawString(body, "password");
  const mfaCode = readString(body, "mfaCode");
  if (email === undefined || password === undefined) {
    return badRequest("email and password are required");
  }
  const loginBody: Record<string, string> = { email, password };
  if (mfaCode !== undefined) {
    loginBody.mfaCode = mfaCode;
  }

  const upstream = await callApi("identity/sessions", {
    method: "POST",
    body: loginBody,
    requestId: randomUUID(),
    forwardedFor: request.headers.get("x-forwarded-for"),
  });

  if (upstream.status === 200 && isSuccessEnvelope(upstream.json) && hasToken(upstream.json.data)) {
    const data = upstream.json.data;
    const response = strippedDataResponse(data);
    applySessionCookies(response, data.token);
    return response;
  }
  return errorPassthrough(upstream);
}

/** PUT /api/bff/session — switch active tenant (session + CSRF required). */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const hasSession = sessionToken !== "";
  if (!hasSession) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "no session", traceId: randomUUID() } },
      { status: 401 },
    );
  }
  if (
    !isCsrfAuthorized({
      method: "PUT",
      hasSession,
      headerToken: request.headers.get("x-csrf-token"),
      cookieToken: request.cookies.get(CSRF_COOKIE)?.value,
    })
  ) {
    return csrfFailure();
  }

  const body = await readJsonBody(request);
  const tenantId = body === null ? undefined : readString(body, "tenantId");
  if (tenantId === undefined) {
    return badRequest("tenantId is required");
  }

  const upstream = await callApi("identity/sessions/switch-tenant", {
    method: "POST",
    body: { tenantId },
    sessionToken,
    requestId: randomUUID(),
    forwardedFor: request.headers.get("x-forwarded-for"),
  });

  if (upstream.status === 200 && isSuccessEnvelope(upstream.json) && hasToken(upstream.json.data)) {
    const data = upstream.json.data;
    const response = strippedDataResponse(data);
    applySessionCookies(response, data.token);
    return response;
  }
  if (upstream.status === 401) {
    const response = errorPassthrough(upstream);
    clearSessionCookies(response);
    return response;
  }
  return errorPassthrough(upstream);
}

/**
 * DELETE /api/bff/session — logout. Always clears both cookies; the
 * upstream revocation is attempted first but a dead session must not
 * trap the user in a signed-in browser.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const hasSession = sessionToken !== "";
  if (
    hasSession &&
    !isCsrfAuthorized({
      method: "DELETE",
      hasSession,
      headerToken: request.headers.get("x-csrf-token"),
      cookieToken: request.cookies.get(CSRF_COOKIE)?.value,
    })
  ) {
    return csrfFailure();
  }

  if (hasSession) {
    await callApi("identity/sessions/current", {
      method: "DELETE",
      sessionToken,
      requestId: randomUUID(),
      forwardedFor: request.headers.get("x-forwarded-for"),
    });
  }
  const response = NextResponse.json({ data: { revoked: true }, meta: { requestId: randomUUID() } });
  clearSessionCookies(response);
  return response;
}
