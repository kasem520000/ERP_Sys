import { pullEnvelopeSchema, type PullEnvelope, type PushItemResult, type PushItemResultV2 } from "@erp/contracts";
import type { SyncTransport } from "@erp/sync-core";

import type { DesktopBridge } from "../bridge/contract";

/**
 * PHASE-021 · the desktop sync transport (T4; MASTER-PLAN §5 — BINDING;
 * SYNC_PROTOCOL §1/§2/§3/§5 + §9; ADR-0015 §3): `SyncTransport` over the
 * bridge `http` member. Every request carries the 15-min device access
 * token (`Authorization: Bearer …`, read fresh from the in-memory
 * `DesktopSession` on EVERY call — SECURITY_AND_DEVICE_MANAGEMENT §3
 * "memory only") plus the `x-device-id` header (the devices/sync
 * controller convention — verified against
 * `apps/api/src/modules/sync/presentation/sync.controller.ts`, where the
 * pull route's query params are `entity`/`cursor`/`limit` and the push
 * body is `{batchId?}|{contractVersion?} + {commands}`).
 *
 * Fail-closed credential rule: when `session.current()` is null the
 * transport throws {@link DesktopSessionExpiredError} BEFORE any bridge
 * call — sync STOPS, it never fires an anonymous request. Non-2xx
 * responses throw {@link DesktopSyncHttpError} carrying status + body
 * (the host reacts to 401 through the session-expired path; everything
 * else is a transport failure). Responses are unwrapped from the API
 * success envelope (`{ data, meta }` — `apps/api/src/infra/http/envelope.ts`);
 * a malformed envelope throws {@link DesktopSyncResponseError} rather
 * than surfacing garbage to sync-core.
 */

/** The device identity header (sync.controller `DEVICE_HEADER`). */
export const DEVICE_ID_HEADER = "x-device-id";

/** Sync wire routes (sync.controller — SYNC_PROTOCOL §1 table). */
export const SYNC_STATUS_PATH = "/api/v1/sync/status";
export const SYNC_PULL_PATH = "/api/v1/sync/pull";
export const SYNC_PUSH_PATH = "/api/v1/sync/push";
export const SYNC_PULL_ACK_PATH = "/api/v1/sync/pull/ack";
export const SYNC_PUSH_ACK_PATH = "/api/v1/sync/push/ack";

/**
 * No usable access token (never enrolled, purged by D-01, or the session
 * was cleared by a rotation failure): sync must STOP — never degrade to
 * an anonymous request (SECURITY_AND_DEVICE_MANAGEMENT §3).
 */
export class DesktopSessionExpiredError extends Error {
  readonly code = "DESKTOP_SESSION_EXPIRED" as const;

  constructor(message: string) {
    super(message);
    this.name = "DesktopSessionExpiredError";
  }
}

/** A non-2xx sync response — the host maps 401 to the session-expired
 * path; every other status is a transport failure (retry next trigger). */
export class DesktopSyncHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly url: string;

  constructor(message: string, status: number, body: string, url: string) {
    super(message);
    this.name = "DesktopSyncHttpError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/** A 2xx response that is not the API success envelope (non-JSON body,
 * missing `data`) — the typed loud failure instead of undefined data
 * reaching sync-core. */
export class DesktopSyncResponseError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "DesktopSyncResponseError";
    this.url = url;
  }
}

/**
 * The GET /sync/status payload as the desktop reads it (the sync.controller
 * response): the contract-version gate input (C-08), the revocation check
 * (C-06 / D-01), the remote data-expiry watermark (SECURITY_AND_DEVICE_
 * MANAGEMENT §6.2) and the authoritative server time (§7). Structurally a
 * superset of sync-core's optional `status()` shape, so the returned
 * transport satisfies `SyncTransport` verbatim.
 */
export interface DesktopSyncStatusDevice {
  id?: string;
  deviceClass?: string | null;
  /** The D-01 kill switch (revoked_at !== null on the server). */
  revoked?: boolean;
  trustFlags?: Record<string, unknown>;
  /** The remote data-expiry instruction (§6.2 — honored on next contact). */
  dataExpiresAt?: string | null;
  contractVersion?: string | null;
  contractSupported?: boolean | null;
}

export interface DesktopSyncStatus {
  serverTime: string;
  contractVersion: string;
  feedGroup?: readonly string[];
  /** Undefined (not null) when the server had no device for the header. */
  device?: DesktopSyncStatusDevice;
  suspended?: boolean;
  tenantId?: string;
}

export interface BridgeTransportOptions {
  /** The shell HTTP member (the ONLY network seam — MASTER-PLAN §1 item 10). */
  readonly bridge: Pick<DesktopBridge, "http">;
  /** API origin, e.g. `https://api.erp.example` (no trailing slash needed). */
  readonly baseUrl: string;
  /** The in-memory device session — read fresh on every request. */
  readonly session: { current(): string | null };
  /** The enrolled device id (the `x-device-id` value). */
  readonly deviceId: string;
}

/** What `bridgeTransport` returns: the full `SyncTransport` surface with
 * the five v2 members GUARANTEED (the desktop is a v2 PHASE-020 client)
 * and the rich `DesktopSyncStatus` shape statically visible to callers —
 * still assignable anywhere a plain `SyncTransport` is expected (the
 * host, SyncClient). */
export interface BridgeTransport extends SyncTransport {
  status(): Promise<DesktopSyncStatus>;
  pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]>;
  pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void>;
  pushAck(commandIds: readonly string[]): Promise<void>;
}

interface BridgeRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** Normalize the base URL (trailing slashes trimmed; empty refused). */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("bridgeTransport: baseUrl must be a non-empty API origin");
  }
  return trimmed.replace(/\/+$/, "");
}

/** Parse a 2xx body as the API success envelope and return `data`. */
function unwrapEnvelope<T>(body: string, url: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DesktopSyncResponseError(`non-JSON response body from ${url}`, url);
  }
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    throw new DesktopSyncResponseError(`response is not the API envelope { data, meta } (${url})`, url);
  }
  return (parsed as { data: T }).data;
}

/**
 * Build the SyncTransport over the bridge http member. All five v2
 * members ship (status/pushV2/pullAck/pushAck) — the desktop is a v2
 * (PHASE-020 wire) client; `pull`/`push` keep the 016-compatible shapes
 * so the UNMODIFIED sync-core client can drive either path.
 */
export function bridgeTransport(opts: BridgeTransportOptions): BridgeTransport {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);

  const request = async <T>(input: BridgeRequest): Promise<T> => {
    // Fail-closed credential rule: read the token FRESH per request; null
    // ⇒ stop before any bridge call (never an anonymous request).
    const token = opts.session.current();
    if (token === null || token === "") {
      throw new DesktopSessionExpiredError(
        "no device access token in the session — refusing to send an anonymous sync request " +
          "(SECURITY_AND_DEVICE_MANAGEMENT §3; re-enroll or unlock first)",
      );
    }
    const url =
      baseUrl +
      input.path +
      (input.query === undefined
        ? ""
        : `?${Object.entries(input.query)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join("&")}`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      [DEVICE_ID_HEADER]: opts.deviceId,
    };
    let body: string | undefined;
    if (input.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    const response = await opts.bridge.http.request({ method: input.method, url, headers, body });
    if (response.status < 200 || response.status >= 300) {
      throw new DesktopSyncHttpError(
        `${input.method} ${input.path} failed: HTTP ${String(response.status)}`,
        response.status,
        response.body,
        url,
      );
    }
    return unwrapEnvelope<T>(response.body, url);
  };

  const requireResultsArray = (data: unknown, path: string): PushItemResultV2[] => {
    if (typeof data !== "object" || data === null || !Array.isArray((data as { results?: unknown }).results)) {
      throw new DesktopSyncResponseError(
        `push response missing the results array (${path})`,
        baseUrl + path,
      );
    }
    return (data as { results: PushItemResultV2[] }).results;
  };
  // The 016 legacy wire narrows per-item REJECTED reasons to the POS
  // registry (a legacy command can only earn a POS reason server-side;
  // the narrow union is the 016 contract — SYNC_PROTOCOL §11 rule 3).
  const requireLegacyResultsArray = (data: unknown, path: string): PushItemResult[] =>
    requireResultsArray(data, path) as PushItemResult[];

  return {
    async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
      // sync.controller @Query("entity") — the REAL param name (not entityType).
      const query: Record<string, string> = { entity: entityType };
      if (cursor !== null && cursor !== "") query.cursor = cursor;
      if (limit !== undefined) query.limit = String(limit);
      const url = `${SYNC_PULL_PATH}?${Object.entries(query)
        .map(([key, value]) => `${key}=${value}`)
        .join("&")}`;
      const data = await request<PullEnvelope>({ method: "GET", path: SYNC_PULL_PATH, query });
      const parsed = pullEnvelopeSchema.safeParse(data);
      if (!parsed.success) {
        throw new DesktopSyncResponseError(
          `pull envelope failed the shared contract schema (${url}): ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`,
          url,
        );
      }
      return parsed.data;
    },

    async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
      // The 016 legacy wire: {batchId, commands} (SYNC_PROTOCOL §11 rule 3).
      const data = await request<unknown>({
        method: "POST",
        path: SYNC_PUSH_PATH,
        body: { batchId, commands },
      });
      return requireLegacyResultsArray(data, SYNC_PUSH_PATH);
    },

    async status(): Promise<DesktopSyncStatus> {
      const data = await request<unknown>({ method: "GET", path: SYNC_STATUS_PATH });
      if (typeof data !== "object" || data === null) {
        throw new DesktopSyncResponseError(
          `status response is not an object (${SYNC_STATUS_PATH})`,
          baseUrl + SYNC_STATUS_PATH,
        );
      }
      const record = data as Record<string, unknown>;
      if (typeof record.serverTime !== "string" || typeof record.contractVersion !== "string") {
        throw new DesktopSyncResponseError(
          `status response missing serverTime/contractVersion (${SYNC_STATUS_PATH})`,
          baseUrl + SYNC_STATUS_PATH,
        );
      }
      // device: null (server had no row for the header) normalizes to
      // undefined so the shape stays assignable to sync-core's status().
      const device =
        typeof record.device === "object" && record.device !== null
          ? (record.device as DesktopSyncStatusDevice)
          : undefined;
      const status: DesktopSyncStatus = {
        serverTime: record.serverTime,
        contractVersion: record.contractVersion,
        device,
      };
      if (Array.isArray(record.feedGroup)) {
        status.feedGroup = (record.feedGroup as unknown[]).filter(
          (entry): entry is string => typeof entry === "string",
        );
      }
      if (typeof record.suspended === "boolean") status.suspended = record.suspended;
      if (typeof record.tenantId === "string") status.tenantId = record.tenantId;
      return status;
    },

    async pushV2(requestBody: {
      contractVersion: string;
      commands: readonly Record<string, unknown>[];
    }): Promise<PushItemResultV2[]> {
      // The v2 wire (SYNC_PROTOCOL §3.2): {contractVersion, commands} —
      // the same POST /sync/push route; the server distinguishes by body.
      const data = await request<unknown>({
        method: "POST",
        path: SYNC_PUSH_PATH,
        body: { contractVersion: requestBody.contractVersion, commands: requestBody.commands },
      });
      return requireResultsArray(data, SYNC_PUSH_PATH);
    },

    async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
      await request<unknown>({ method: "POST", path: SYNC_PULL_ACK_PATH, body: { positions } });
    },

    async pushAck(commandIds: readonly string[]): Promise<void> {
      await request<unknown>({ method: "POST", path: SYNC_PUSH_ACK_PATH, body: { commandIds } });
    },
  };
}
