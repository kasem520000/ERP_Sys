/**
 * Server-component data access. Server pages render from the identity API
 * through the same internal helpers the BFF proxy uses — never by
 * self-fetching their own HTTP routes, and never by exposing the token.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { SESSION_COOKIE, type ApiResult } from "./api-types";
import { callApi, toApiResult } from "./bff";
import type { Locale } from "../i18n/dictionaries";

/** The opaque session token from the httpOnly cookie, if any. */
export async function getSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  return value !== undefined && value !== "" ? value : undefined;
}

/** Internal (server-to-server) API call with the current session, if any. */
export async function fetchApi<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const sessionToken = await getSessionToken();
  const upstream = await callApi(path, {
    method: init.method,
    body: init.body,
    sessionToken,
    requestId: randomUUID(),
  });
  return toApiResult<T>(upstream);
}

/** Redirects to `/{locale}/login` when there is no session cookie. */
export async function requireSessionToken(locale: Locale): Promise<string> {
  const token = await getSessionToken();
  if (token === undefined) {
    redirect(`/${locale}/login`);
  }
  return token;
}
