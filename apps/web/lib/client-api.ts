/**
 * Browser-side fetch wrapper for the BFF (`/api/bff/*`).
 *
 * - unsafe methods echo the readable `erp_csrf` cookie in `X-CSRF-Token`
 *   (double-submit; the BFF answers 403 on mismatch — M-03);
 * - every unsafe request sends a fresh `Idempotency-Key` (one per browser
 *   attempt; the BFF generates one when absent);
 * - responses are narrowed into the same `ApiResult` the server side uses.
 */
import {
  CSRF_COOKIE,
  SAFE_METHODS,
  errorBodyOf,
  isSuccessEnvelope,
  paginatedMetaOf,
  parseJsonOrUndefined,
  retrySecondsFrom,
  retrySecondsFromHeader,
  type ApiResult,
} from "./api-types";

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }
  return undefined;
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function bffFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf !== undefined && csrf !== "") {
      headers.set("x-csrf-token", csrf);
    }
    headers.set("idempotency-key", randomId());
  }
  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(`/api/bff/${path}`, { method, headers, body, credentials: "same-origin" });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "NETWORK_ERROR", message: "network request failed" },
    };
  }

  const retryAfterHeader = response.headers.get("retry-after");
  const json = parseJsonOrUndefined(await response.text());
  if (isSuccessEnvelope(json)) {
    // P4-T12a: cursor-pagination meta (hasMore/nextCursor) rides along for
    // paginated endpoints; single-object endpoints simply carry no meta.
    return { ok: true, data: json.data as T, meta: paginatedMetaOf(json) };
  }
  const error = errorBodyOf(json);
  return {
    ok: false,
    status: response.status,
    error,
    retryAfterSeconds:
      retrySecondsFrom(error.details) ?? retrySecondsFromHeader(retryAfterHeader) ?? undefined,
  };
}
