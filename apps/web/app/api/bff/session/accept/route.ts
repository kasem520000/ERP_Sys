/**
 * POST /api/bff/session/accept — public invitation acceptance. On success
 * the API returns a fresh session token; this route converts it into the
 * httpOnly session cookie (plus a new CSRF cookie) and strips the raw
 * token from the response body. When the browser already holds a session
 * the CSRF echo is required like any other unsafe request.
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

const MIN_PASSWORD_LENGTH = 10;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const hasSession = sessionToken !== "";
  if (
    hasSession &&
    !isCsrfAuthorized({
      method: "POST",
      hasSession,
      headerToken: request.headers.get("x-csrf-token"),
      cookieToken: request.cookies.get(CSRF_COOKIE)?.value,
    })
  ) {
    return csrfFailure();
  }

  const body = await readJsonBody(request);
  if (body === null) {
    return badRequest("a JSON object body is required");
  }
  const token = readString(body, "token");
  const fullName = readString(body, "fullName");
  const password = readRawString(body, "password");
  const locale = readString(body, "locale");
  if (
    token === undefined ||
    token.length < 10 ||
    fullName === undefined ||
    password === undefined ||
    password.length < MIN_PASSWORD_LENGTH
  ) {
    return badRequest("token, fullName and a password of at least 10 characters are required");
  }

  const acceptBody: Record<string, string> = { token, fullName, password };
  if (locale === "ar" || locale === "en") {
    acceptBody.locale = locale;
  }

  const upstream = await callApi("identity/invitations/accept", {
    method: "POST",
    body: acceptBody,
    sessionToken: hasSession ? sessionToken : undefined,
    requestId: randomUUID(),
    forwardedFor: request.headers.get("x-forwarded-for"),
  });

  if (upstream.status === 200 && isSuccessEnvelope(upstream.json) && hasToken(upstream.json.data)) {
    const data = upstream.json.data;
    const response = strippedDataResponse(data);
    applySessionCookies(response, data.token);
    return response;
  }
  if (upstream.status === 401 && hasSession) {
    const response = errorPassthrough(upstream);
    clearSessionCookies(response);
    return response;
  }
  return errorPassthrough(upstream);
}
