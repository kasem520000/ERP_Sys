import type { HttpPort, HttpPortResponse } from "../sync/http-port";

/**
 * PHASE-022 · the device-registry API client core (T2-b; MASTER-PLAN §7
 * "auth/ + device/" — BINDING; the server surface is
 * `apps/api/src/modules/sync/presentation/devices.controller.ts`, read
 * verbatim before this file was written): the shared request helper +
 * route constants + typed errors every device-auth call rides — the
 * same conventions as 2-a's sync transport (the `{ data, meta }`
 * success envelope, the ERROR_MODEL `{ error: { code, … } }` body,
 * never an anonymous credential-bearing request where one is required).
 *
 * The four routes this module family calls (the controller's rows):
 *
 * | Route                                  | Auth                | Body |
 * |----------------------------------------|---------------------|------|
 * | POST   /api/v1/devices                 | session (`sync.devices.register`) | `{ deviceName, deviceClass, platform, platformVersion?, appVersion, contractVersion?, deviceKeyPublic?, capabilities?, platformAttestation? }` → 201 `{ deviceId, attestationNonce, enrollmentSecret, contractVersion }` |
 * | POST   /api/v1/devices/:id/attest      | session (`sync.devices.register`) | `{ signature }` |
 * | POST   /api/v1/devices/:id/enroll      | PUBLIC (the one-time enrollmentSecret IS the credential — the login pattern) | `{ enrollmentSecret }` → `{ refreshToken, accessToken, expiresAt, refreshTokenExpiresAt }` |
 * | POST   /api/v1/devices/:id/refresh     | PUBLIC (the refresh token IS the credential) | `{ refreshToken }` → the same rotation shape |
 * | PATCH  /api/v1/devices/:id             | session (`identity.devices.manage`) | `{ trustFlags?, dataExpiresAt? }` |
 *
 * Error statuses (the ERROR_MODEL filter's device mapping, verified
 * against error.filter.ts): `DEVICE_REFRESH_INVALID` → 401,
 * `DEVICE_REVOKED` → 403, `DeviceNotFound` → 404 — the codes the
 * refresh module's reuse detection classifies on.
 */

/** The devices registry base route (devices.controller @Controller). */
export const DEVICES_BASE_PATH = "/api/v1/devices";

/** `/api/v1/devices/:id` (+ optional `/suffix` for the child routes). */
export function devicePath(deviceId: string, suffix?: string): string {
  return `${DEVICES_BASE_PATH}/${encodeURIComponent(deviceId)}${suffix ?? ""}`;
}

/** A non-2xx device-registry response — status + raw body + the parsed
 * ERROR_MODEL `error.code` when present (the reuse-detection input). */
export class MobileAuthHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly url: string;
  /** The ERROR_MODEL code (`error.code`) when the body carried one. */
  readonly code: string | null;

  constructor(message: string, status: number, body: string, url: string, code: string | null) {
    super(message);
    this.name = "MobileAuthHttpError";
    this.status = status;
    this.body = body;
    this.url = url;
    this.code = code;
  }
}

/** A 2xx response that is not the API success envelope (non-JSON body,
 * missing `data`) — the typed loud failure instead of garbage reaching
 * the auth modules. */
export class MobileAuthResponseError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "MobileAuthResponseError";
    this.url = url;
  }
}

/** Extract the ERROR_MODEL `error.code` from a response body (`{ error:
 * { code, message, details, traceId, retryable } }` — error.filter.ts),
 * null when the body carries no recognizable code. */
export function errorCodeFromBody(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === "object" && error !== null && "code" in error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string" && code !== "") return code;
      }
    }
  } catch {
    // Non-JSON body — no code to extract.
  }
  return null;
}

/** Normalize the base URL (trailing slashes trimmed; empty refused) —
 * the sync transport's convention. */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("device auth: baseUrl must be a non-empty API origin");
  }
  return trimmed.replace(/\/+$/, "");
}

/** One device-registry API call. */
export interface DeviceApiRequest {
  readonly method: "GET" | "POST" | "PATCH";
  /** The route path (e.g. `devicePath(id, "/attest")`). */
  readonly path: string;
  /** JSON-serialized request body (undefined = none). */
  readonly body?: unknown;
  /** The full Authorization header value (e.g. `Bearer …`) — REQUIRED
   * on the session-guarded routes (register/attest/patch), omitted on
   * the PUBLIC credential exchanges (enroll/refresh — the credential
   * rides the body, the login pattern). */
  readonly authorization?: string;
}

/** Parse a 2xx body as the API success envelope and return `data`. */
function unwrapEnvelope<T>(response: HttpPortResponse, url: string): T {
  let parsed: unknown;
  try {
    parsed = response.json();
  } catch {
    throw new MobileAuthResponseError(`non-JSON response body from ${url}`, url);
  }
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    throw new MobileAuthResponseError(`response is not the API envelope { data, meta } (${url})`, url);
  }
  return (parsed as { data: T }).data;
}

/**
 * Run one device-registry request over the HttpPort: builds the URL,
 * applies the Authorization header when provided, JSON-serializes the
 * body, throws {@link MobileAuthHttpError} on any non-2xx status
 * (carrying the parsed `error.code`) and {@link MobileAuthResponseError}
 * on a malformed 2xx envelope. Network-level failures propagate as the
 * port's own throw (offline/DNS/timeout — retryable, never classified).
 */
export async function deviceApiRequest<T>(
  http: HttpPort,
  baseUrl: string,
  request: DeviceApiRequest,
): Promise<T> {
  const url = normalizeBaseUrl(baseUrl) + request.path;
  const headers: Record<string, string> = {};
  if (request.authorization !== undefined && request.authorization !== "") {
    headers.Authorization = request.authorization;
  }
  let body: string | undefined;
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.body);
  }
  const response = await http.request(request.method, url, { headers, body });
  if (response.status < 200 || response.status >= 300) {
    throw new MobileAuthHttpError(
      `${request.method} ${request.path} failed: HTTP ${String(response.status)}`,
      response.status,
      response.text,
      url,
      errorCodeFromBody(response.text),
    );
  }
  return unwrapEnvelope<T>(response, url);
}
