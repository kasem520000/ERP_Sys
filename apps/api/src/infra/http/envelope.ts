import type { Response } from "express";

import { getCorrelationId } from "../observability/request-context";

/**
 * Success envelope (API_CONVENTIONS §3): `{ data, meta }` with
 * `meta.requestId` echoing the correlation id. Errors NEVER use this
 * shape (ERROR_MODEL envelope only — no 200-with-error anywhere).
 */

export function envelope<T>(data: T): { data: T; meta: { requestId: string } } {
  return { data, meta: { requestId: getCorrelationId() ?? "" } };
}

export interface PaginatedMeta {
  requestId: string;
  count: number;
  hasMore: boolean;
  nextCursor?: string;
}

/** Cursor pagination (API_CONVENTIONS §4): opaque cursor, limit ≤ 200. */
export function paginatedEnvelope<T>(
  data: T[],
  options: { limit: number; hasMore: boolean; nextCursor?: string },
): { data: T[]; meta: PaginatedMeta } {
  const meta: PaginatedMeta = {
    requestId: getCorrelationId() ?? "",
    count: data.length,
    hasMore: options.hasMore,
  };
  if (options.hasMore && options.nextCursor !== undefined) {
    meta.nextCursor = options.nextCursor;
  }
  return { data, meta };
}

/** Header carrier (Retry-After on 429 — AUTHENTICATION §5.2). */
export function setRetryAfter(response: Response, seconds: number): void {
  response.header("Retry-After", String(Math.max(1, seconds)));
}
