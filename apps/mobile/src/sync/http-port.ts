/**
 * PHASE-022 · the mobile HTTP port (T2-a; MASTER-PLAN §7 — BINDING;
 * DR-P22-08): the fetch-like seam the sync transport runs over — the
 * ONLY network surface in the mobile runtime. Implementations:
 *
 * - **Device** (`apps/mobile/native/drivers/http.ts`): React Native
 *   `fetch` — `fetch(url, { method, headers, body })` maps 1:1 onto
 *   `request(...)`; `text()` → the raw body string; `json()` →
 *   `JSON.parse(text)` (a non-JSON body throws — the transport turns
 *   that into its typed ResponseError).
 * - **Tests + harness**: a scripted fake (the desktop scriptedBridge
 *   precedent — everything else in the transport is the REAL code).
 *
 * Synchronous bookkeeping note: the port is async (network I/O is
 * inherently async on every RN/Node runtime) — only the STORE layer is
 * synchronous (the driver-port bridging table); the transport awaits
 * the port and stays fully typed.
 *
 * PHASE-022 · T2-b (recorded widening): the method union gains
 * `"PATCH"` — the device-auth plane calls the devices registry's PATCH
 * route (`PATCH /api/v1/devices/:id` — trust flags,
 * devices.controller.ts row 4) over this same seam. Additive only: the
 * sync transport keeps using GET/POST; device drivers simply forward
 * the method string to `fetch`.
 */

/** A request through the port (method + path + headers + body — the
 * fetch triplet; the transport owns URL construction). */
export interface HttpPortRequest {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** The response (fetch-like: status + raw text + parsed JSON). */
export interface HttpPortResponse {
  readonly status: number;
  /** The raw body text ("" when the response carried none). */
  readonly text: string;
  /** The parsed JSON body — throws on a non-JSON text. */
  json(): unknown;
}

/** Options bag for the request call (headers + body). */
export interface HttpPortRequestOptions {
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/**
 * The fetch-like HTTP seam: `request(method, path, {headers, body})` →
 * `{status, json()}`. Implementations never throw for HTTP statuses —
 * a non-2xx IS a response (the transport types it); they throw only
 * for network-level failures (offline, DNS, timeout).
 */
export interface HttpPort {
  request(
    method: "GET" | "POST" | "PATCH",
    path: string,
    options?: HttpPortRequestOptions,
  ): Promise<HttpPortResponse>;
}
