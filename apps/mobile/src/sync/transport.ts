import {
  PERSONAL_BACKGROUND_PULL_BUDGET_BYTES,
  SYNC_PULL_BUDGET_BYTES,
  SYNC_PUSH_BUDGET_BYTES,
} from "../constants";
import { pullEnvelopeSchema, type PullEnvelope, type PushItemResult, type PushItemResultV2 } from "@erp/contracts";
import type { SyncTransport } from "@erp/sync-core";

import type { HttpPort, HttpPortResponse } from "./http-port";

/**
 * PHASE-022 · the mobile sync transport (T2-a; MASTER-PLAN §7 — BINDING;
 * DR-P22-08 — the desktop BridgeTransport port): `SyncTransport` over
 * the `HttpPort` seam. Every request carries the 15-min device access
 * token (`Authorization: Bearer …`, read fresh from the memory-only
 * AccessTokenProvider on EVERY call — SECURITY_AND_DEVICE_MANAGEMENT §3;
 * task 2-b owns the session, this port only READS it) plus the
 * `x-device-id` header (the devices/sync controller convention —
 * verified against `apps/api/src/modules/sync/presentation/
 * sync.controller.ts`, where the pull route's query params are
 * `entity`/`cursor`/`limit` and the push body is
 * `{batchId?}|{contractVersion?} + {commands}`).
 *
 * Fail-closed credential rule: when the provider returns null (or an
 * empty string) the transport throws {@link MobileSessionExpiredError}
 * BEFORE any port call — sync STOPS, it never fires an anonymous
 * request. Non-2xx responses throw {@link MobileSyncHttpError} carrying
 * status + body; responses are unwrapped from the API success envelope
 * (`{ data, meta }` — `apps/api/src/infra/http/envelope.ts`); a
 * malformed envelope throws {@link MobileSyncResponseError}.
 *
 * BUDGET-AWARE (the client-side enforcement T-P22-1d documented — the
 * server enforces the ≤ 2 MB delta page cap for every entity, the
 * DEVICE enforces the per-cycle budgets): every pull response's payload
 * bytes (the raw response text) are counted against the cycle's pull
 * budget, every push request's serialized body bytes against the push
 * budget — {@link SyncBudgetExceededError} trips the cycle loud the
 * moment a side goes over. The host resets the guard per cycle with the
 * per-class/per-mode profile: field foreground {pull ≤ 8 MB, push ≤
 * 2 MB}, personal foreground {pull ≤ 8 MB}, personal BACKGROUND pulls ≤
 * 256 KB (the read-mostly companion profile must stay invisible on
 * metered batteries). Header bytes are excluded — payload accounting,
 * the honest measure of what the device moved.
 */

/** The device identity header (sync.controller DEVICE_HEADER — the
 * desktop constant value, byte-identical). */
export const DEVICE_ID_HEADER = "x-device-id";

/** Sync wire routes (sync.controller — SYNC_PROTOCOL §1 table; the
 * desktop constant values, byte-identical). */
export const SYNC_STATUS_PATH = "/api/v1/sync/status";
export const SYNC_PULL_PATH = "/api/v1/sync/pull";
export const SYNC_PUSH_PATH = "/api/v1/sync/push";
export const SYNC_PULL_ACK_PATH = "/api/v1/sync/pull/ack";
export const SYNC_PUSH_ACK_PATH = "/api/v1/sync/push/ack";

/**
 * No usable access token (never enrolled, purged by D-01, or the session
 * was cleared): sync must STOP — never degrade to an anonymous request
 * (SECURITY_AND_DEVICE_MANAGEMENT §3).
 */
export class MobileSessionExpiredError extends Error {
  readonly code = "MOBILE_SESSION_EXPIRED" as const;

  constructor(message: string) {
    super(message);
    this.name = "MobileSessionExpiredError";
  }
}

/** A non-2xx sync response — the host maps 401 to the session-expired
 * path; every other status is a transport failure (retry next trigger). */
export class MobileSyncHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly url: string;

  constructor(message: string, status: number, body: string, url: string) {
    super(message);
    this.name = "MobileSyncHttpError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/** A 2xx response that is not the API success envelope (non-JSON body,
 * missing `data`, a pull envelope failing the shared contract schema) —
 * the typed loud failure instead of garbage reaching sync-core. */
export class MobileSyncResponseError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "MobileSyncResponseError";
    this.url = url;
  }
}

/**
 * The per-cycle budget tripped (the client-side enforcement): the
 * transport refuses the NEXT request on the over-budget side — the
 * cycle surfaces it as a per-entity pull error / push error and retries
 * on the next trigger with a fresh budget.
 */
export class SyncBudgetExceededError extends Error {
  readonly code = "SYNC_BUDGET_EXCEEDED" as const;
  readonly side: "pull" | "push";
  readonly usedBytes: number;
  readonly limitBytes: number;

  constructor(side: "pull" | "push", usedBytes: number, limitBytes: number) {
    super(
      `sync ${side} budget exceeded: ${String(usedBytes)} payload bytes moved this cycle, ` +
        `the limit is ${String(limitBytes)} (the client-side per-cycle enforcement — the next ` +
        "cycle retries with a fresh budget)",
    );
    this.name = "SyncBudgetExceededError";
    this.side = side;
    this.usedBytes = usedBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * The GET /sync/status payload as the mobile app reads it (the
 * sync.controller response): the contract-version gate input (C-08),
 * the revocation check (C-06 / D-01), the remote data-expiry watermark
 * (SECURITY_AND_DEVICE_MANAGEMENT §6.2) and the authoritative server
 * time (§7). Structurally a superset of sync-core's optional `status()`
 * shape, so the returned transport satisfies `SyncTransport` verbatim.
 */
export interface MobileSyncStatusDevice {
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

export interface MobileSyncStatus {
  serverTime: string;
  contractVersion: string;
  feedGroup?: readonly string[];
  /** Undefined (not null) when the server had no device for the header. */
  device?: MobileSyncStatusDevice;
  suspended?: boolean;
  tenantId?: string;
}

/** The memory-only access-token provider (2-b owns the session; the
 * transport reads it fresh on every request — never caches it). */
export type AccessTokenProvider = () => string | null;

export interface MobileHttpTransportOptions {
  /** The fetch-like seam (the ONLY network surface — DR-P22-08). */
  readonly http: HttpPort;
  /** API origin, e.g. `https://api.erp.example` (trailing slashes trimmed). */
  readonly baseUrl: string;
  /** The memory-only device access token, read fresh per request. */
  readonly accessToken: AccessTokenProvider;
  /** The enrolled device id (the `x-device-id` value). */
  readonly deviceId: string;
}

/** What `mobileHttpTransport` returns: the full `SyncTransport` surface
 * with the five v2 members GUARANTEED (the mobile app is a v2
 * PHASE-020-wire client) and the rich `MobileSyncStatus` shape
 * statically visible to callers — still assignable anywhere a plain
 * `SyncTransport` is expected (the host, SyncClient). */
export interface MobileHttpTransport extends SyncTransport {
  status(): Promise<MobileSyncStatus>;
  pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]>;
  pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void>;
  pushAck(commandIds: readonly string[]): Promise<void>;
  /** The per-cycle budget controller (the host calls beginCycle per
   * cycle; the guard is per transport instance). */
  readonly budget: TransportBudgetController;
}

/**
 * A per-cycle transport budget profile (bytes). Defaults per mode:
 * field foreground — pull 8 MB / push 2 MB (the golden constants);
 * personal foreground — the same pull ceiling (user-initiated,
 * on-screen); personal BACKGROUND — pull ≤ 256 KB (the read-mostly
 * companion profile on metered batteries).
 */
export interface TransportBudgetProfile {
  readonly pullBytes: number;
  readonly pushBytes: number;
}

/** The per-cycle budget controller the host drives. */
export interface TransportBudgetController {
  /** Reset the counters + set this cycle's limits (called at cycle
   * start — the host chooses the per-class/per-mode profile). */
  beginCycle(profile: TransportBudgetProfile): void;
  /** The running usage + limits (the honest report the UI can render). */
  usage(): {
    readonly pullBytes: number;
    readonly pushBytes: number;
    readonly pullLimitBytes: number | null;
    readonly pushLimitBytes: number | null;
  };
}

/** The default profiles (the golden constants — MASTER-PLAN §0). */
export const FIELD_FOREGROUND_BUDGET: TransportBudgetProfile = {
  pullBytes: SYNC_PULL_BUDGET_BYTES,
  pushBytes: SYNC_PUSH_BUDGET_BYTES,
};

/** Personal foreground rides the generic pull ceiling (user-initiated,
 * on-screen; no push ever happens — pull-only class). */
export const PERSONAL_FOREGROUND_BUDGET: TransportBudgetProfile = {
  pullBytes: SYNC_PULL_BUDGET_BYTES,
  pushBytes: SYNC_PUSH_BUDGET_BYTES,
};

/** Personal BACKGROUND pulls ≤ 256 KB (MASTER-PLAN §0 bandwidth). */
export const PERSONAL_BACKGROUND_BUDGET: TransportBudgetProfile = {
  pullBytes: PERSONAL_BACKGROUND_PULL_BUDGET_BYTES,
  pushBytes: SYNC_PUSH_BUDGET_BYTES,
};

/**
 * The per-cycle byte guard: payload bytes moved per side (pull = the
 * raw response text of every pull; push = the serialized request body
 * of every push). Trips {@link SyncBudgetExceededError} at the moment a
 * side goes OVER its limit (the request that crossed it still completed
 * — the guard refuses the NEXT one; the cycle surfaces the typed error
 * per entity/per push and the next trigger starts a fresh budget).
 */
export class BudgetGuard implements TransportBudgetController {
  private pullUsed = 0;
  private pushUsed = 0;
  private pullLimit: number | null = null;
  private pushLimit: number | null = null;

  beginCycle(profile: TransportBudgetProfile): void {
    this.pullUsed = 0;
    this.pushUsed = 0;
    this.pullLimit = profile.pullBytes;
    this.pushLimit = profile.pushBytes;
  }

  usage(): {
    pullBytes: number;
    pushBytes: number;
    pullLimitBytes: number | null;
    pushLimitBytes: number | null;
  } {
    return {
      pullBytes: this.pullUsed,
      pushBytes: this.pushUsed,
      pullLimitBytes: this.pullLimit,
      pushLimitBytes: this.pushLimit,
    };
  }

  /** Count a pull response's payload bytes; throws when over. */
  accountPull(bytes: number): void {
    this.pullUsed += bytes;
    if (this.pullLimit !== null && this.pullUsed > this.pullLimit) {
      throw new SyncBudgetExceededError("pull", this.pullUsed, this.pullLimit);
    }
  }

  /** Count a push request's serialized body bytes; throws when over. */
  accountPush(bytes: number): void {
    this.pushUsed += bytes;
    if (this.pushLimit !== null && this.pushUsed > this.pushLimit) {
      throw new SyncBudgetExceededError("push", this.pushUsed, this.pushLimit);
    }
  }
}

interface TransportRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** Normalize the base URL (trailing slashes trimmed; empty refused). */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("mobileHttpTransport: baseUrl must be a non-empty API origin");
  }
  return trimmed.replace(/\/+$/, "");
}

/** Parse a 2xx body as the API success envelope and return `data`. */
function unwrapEnvelope<T>(response: HttpPortResponse, url: string): T {
  let parsed: unknown;
  try {
    parsed = response.json();
  } catch {
    throw new MobileSyncResponseError(`non-JSON response body from ${url}`, url);
  }
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    throw new MobileSyncResponseError(`response is not the API envelope { data, meta } (${url})`, url);
  }
  return (parsed as { data: T }).data;
}

/**
 * Build the SyncTransport over the HttpPort seam. All five v2 members
 * ship (status/pushV2/pullAck/pushAck) — the mobile app is a v2
 * (PHASE-020 wire) client; `pull`/`push` keep the 016-compatible shapes
 * so the UNMODIFIED sync-core client can drive either path.
 */
export function mobileHttpTransport(opts: MobileHttpTransportOptions): MobileHttpTransport {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const guard = new BudgetGuard();

  const request = async <T>(input: TransportRequest): Promise<{ data: T; response: HttpPortResponse }> => {
    // Fail-closed credential rule: read the token FRESH per request;
    // null/empty ⇒ stop before any port call (never anonymous).
    const token = opts.accessToken();
    if (token === null || token === "") {
      throw new MobileSessionExpiredError(
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
    const response = await opts.http.request(input.method, url, {
      headers,
      body,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new MobileSyncHttpError(
        `${input.method} ${input.path} failed: HTTP ${String(response.status)}`,
        response.status,
        response.text,
        url,
      );
    }
    return { data: unwrapEnvelope<T>(response, url), response };
  };

  const requireResultsArray = (data: unknown, path: string): PushItemResultV2[] => {
    if (typeof data !== "object" || data === null || !Array.isArray((data as { results?: unknown }).results)) {
      throw new MobileSyncResponseError(
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
    budget: guard,

    async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
      // sync.controller @Query("entity") — the REAL param name.
      const query: Record<string, string> = { entity: entityType };
      if (cursor !== null && cursor !== "") query.cursor = cursor;
      if (limit !== undefined) query.limit = String(limit);
      const url = `${SYNC_PULL_PATH}?${Object.entries(query)
        .map(([key, value]) => `${key}=${value}`)
        .join("&")}`;
      // Budget refusal BEFORE the port call (a fresh budget trips the
      // next request — the previous one already completed and counted).
      const usage = guard.usage();
      if (usage.pullLimitBytes !== null && usage.pullBytes > usage.pullLimitBytes) {
        throw new SyncBudgetExceededError("pull", usage.pullBytes, usage.pullLimitBytes);
      }
      const { data, response } = await request<PullEnvelope>({ method: "GET", path: SYNC_PULL_PATH, query });
      // Payload byte accounting: the raw response text of this pull.
      guard.accountPull(response.text.length);
      const parsed = pullEnvelopeSchema.safeParse(data);
      if (!parsed.success) {
        throw new MobileSyncResponseError(
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
      const serialized = JSON.stringify({ batchId, commands });
      guard.accountPush(serialized.length);
      const { data } = await request<unknown>({ method: "POST", path: SYNC_PUSH_PATH, body: { batchId, commands } });
      return requireLegacyResultsArray(data, SYNC_PUSH_PATH);
    },

    async status(): Promise<MobileSyncStatus> {
      const { data } = await request<unknown>({ method: "GET", path: SYNC_STATUS_PATH });
      if (typeof data !== "object" || data === null) {
        throw new MobileSyncResponseError(
          `status response is not an object (${SYNC_STATUS_PATH})`,
          baseUrl + SYNC_STATUS_PATH,
        );
      }
      const record = data as Record<string, unknown>;
      if (typeof record.serverTime !== "string" || typeof record.contractVersion !== "string") {
        throw new MobileSyncResponseError(
          `status response missing serverTime/contractVersion (${SYNC_STATUS_PATH})`,
          baseUrl + SYNC_STATUS_PATH,
        );
      }
      // device: null (server had no row for the header) normalizes to
      // undefined so the shape stays assignable to sync-core's status().
      const device =
        typeof record.device === "object" && record.device !== null
          ? (record.device as MobileSyncStatusDevice)
          : undefined;
      const status: MobileSyncStatus = {
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
      const serialized = JSON.stringify({
        contractVersion: requestBody.contractVersion,
        commands: requestBody.commands,
      });
      guard.accountPush(serialized.length);
      const { data } = await request<unknown>({
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
