/**
 * PHASE-024 T8 — GET /api/bff/audit/events/export: the tenant-admin CSV
 * download. The generic BFF proxy is JSON-only (it parses every upstream
 * body as an envelope and would mangle a text/csv attachment into an
 * INTERNAL error envelope), so the export gets this dedicated streaming
 * route: it forwards the session cookie as X-Session-Token, re-broadcasts
 * the SAME filter set the list page used, and passes the API's CSV through
 * with its Content-Type + Content-Disposition intact. An anchor with
 * `href="/api/bff/audit/events/export?…"` carries the session cookie
 * same-origin, so no window.open/fetch gymnastics are needed.
 *
 * Non-200 upstream answers (403 viewer, 400 bad filter values, 429) pass
 * through as the normal JSON error envelope with the upstream status.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, parseJsonOrUndefined } from "@/lib/api-types";
import { apiEndpoint } from "@/lib/bff";

/** The audit controller's accepted query keys (zod-validated upstream). */
const FILTER_KEYS = [
  "entityType",
  "entityId",
  "actorId",
  "action",
  "correlationId",
  "fromAt",
  "toAt",
  "limit",
] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (sessionToken === "") {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "no session", traceId: randomUUID() } },
      { status: 401 },
    );
  }

  // Re-broadcast only the known filter keys (never the raw search string).
  const incoming = new URL(request.url).searchParams;
  const search = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = incoming.get(key);
    if (value !== null && value !== "") {
      search.set(key, value);
    }
  }

  let upstream: Response;
  try {
    const headers: Record<string, string> = {
      "x-request-id": randomUUID(),
      "x-session-token": sessionToken,
    };
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor !== null && forwardedFor !== "") {
      headers["x-forwarded-for"] = forwardedFor;
    }
    upstream = await fetch(`${apiEndpoint("audit/events/export")}?${search.toString()}`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: { code: "NETWORK_ERROR", message: "identity API is unreachable", traceId: randomUUID() } },
      { status: 502 },
    );
  }

  if (upstream.status !== 200) {
    // The API answers non-200 as the standard JSON error envelope.
    const payload = parseJsonOrUndefined(await upstream.text());
    const body =
      payload ?? { error: { code: "INTERNAL", message: "empty upstream response", traceId: randomUUID() } };
    const response = NextResponse.json(body, { status: upstream.status });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter !== null) {
      response.headers.set("retry-after", retryAfter);
    }
    return response;
  }

  const csv = await upstream.text();
  const headers = new Headers();
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? "text/csv; charset=utf-8",
  );
  headers.set(
    "content-disposition",
    upstream.headers.get("content-disposition") ?? 'attachment; filename="audit-events.csv"',
  );
  return new NextResponse(csv, { status: 200, headers });
}
