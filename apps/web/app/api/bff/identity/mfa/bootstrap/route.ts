/**
 * PHASE-024 T4 — POST /api/bff/identity/mfa/bootstrap: the enrollment
 * bootstrap exchange. The login route answered 423 MFA_REQUIRED with
 * details.enrollmentRequired=true (policy-mandated role, no confirmed
 * factor); the browser re-sends the SAME credentials here, and the API
 * re-verifies the full login discipline before issuing the 15-minute
 * enrollment-only session. Cookie handling is EXACTLY the session login
 * route's contract (M-03): the httpOnly `erp_session` cookie is issued with
 * a fresh readable `erp_csrf` double-submit token and the raw token is
 * stripped from the JSON the browser receives.
 *
 * Public and CSRF-exempt like POST /api/bff/session (a credential exchange,
 * not a session-bearing mutation); upstream 401/409/423/429 envelopes pass
 * through as-is.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { hasToken, isSuccessEnvelope } from "@/lib/api-types";
import {
  applySessionCookies,
  badRequest,
  callApi,
  errorPassthrough,
  readJsonBody,
  readRawString,
  readString,
  strippedDataResponse,
} from "@/lib/bff";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (body === null) {
    return badRequest("a JSON object body is required");
  }
  const email = readString(body, "email");
  const password = readRawString(body, "password");
  if (email === undefined || password === undefined) {
    return badRequest("email and password are required");
  }

  const upstream = await callApi("identity/mfa/bootstrap", {
    method: "POST",
    body: { email, password },
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
