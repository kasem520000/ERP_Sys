import { describe, expect, it } from "vitest";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";
import {
  BudgetGuard,
  mobileHttpTransport,
  MobileSessionExpiredError,
  MobileSyncHttpError,
  MobileSyncResponseError,
  SyncBudgetExceededError,
  type MobileHttpTransport,
  type MobileHttpTransportOptions,
} from "../src/sync";
import type { HttpPort, HttpPortResponse } from "../src/sync/http-port";
import { PERSONAL_BACKGROUND_PULL_BUDGET_BYTES, SYNC_PULL_BUDGET_BYTES, SYNC_PUSH_BUDGET_BYTES } from "../src/constants";

/**
 * PHASE-022 · the mobile transport suite (T2-a; MASTER-PLAN §7; SYNC_
 * PROTOCOL §1/§2/§3/§5 — the desktop bridge-transport suite ported onto
 * the HttpPort seam): a scripted HttpPort records every request and
 * serves API-envelope responses — asserting the REAL server conventions
 * (the `entity` query param, the `x-device-id` header, the {data, meta}
 * envelope, the push body shapes), every typed failure mode, and the
 * per-cycle byte budget guard (payload accounting + the trip). The only
 * faked piece is the HttpPort (the network seam) — everything else is
 * the real transport code.
 */

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

type Responder = (request: RecordedRequest) => { status: number; text: string };

function scriptedHttpPort(respond: Responder): {
  http: HttpPort;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const port: HttpPort = {
    request: async (method, path, options) => {
      const record: RecordedRequest = {
        method,
        url: path,
        headers: { ...(options?.headers ?? {}) },
        body: options?.body,
      };
      requests.push(record);
      const response = respond(record);
      const parsed: HttpPortResponse = {
        status: response.status,
        text: response.text,
        json: () => JSON.parse(response.text),
      };
      return parsed;
    },
  };
  return { http: port, requests };
}

/** The API success envelope (apps/api/src/infra/http/envelope.ts). */
function ok(data: unknown): { status: number; text: string } {
  return { status: 200, text: JSON.stringify({ data, meta: { requestId: "req-test" } }) };
}

function makeTransport(
  respond: Responder,
  accessToken: () => string | null = () => "access-token-abc123",
): { transport: MobileHttpTransport; requests: RecordedRequest[] } {
  const { http, requests } = scriptedHttpPort(respond);
  const options: MobileHttpTransportOptions = {
    http,
    baseUrl: "https://api.erp.example/",
    accessToken,
    deviceId: "31313131-1111-4111-8111-111111111111",
  };
  return { transport: mobileHttpTransport(options), requests };
}

const VALID_PULL_ENVELOPE = {
  entityType: "van_stocks",
  cursor: "42",
  nextCursor: "42",
  hasMore: false,
  changes: [
    {
      id: "vs-1",
      seq: 42,
      op: "UPSERT",
      payload: { id: "vs-1", warehouseId: "wh-1", itemId: "item-1", qty: "10.000000", value: "600.0000" },
      changedAt: "2026-11-04T00:00:00Z",
      version: 3,
    },
  ],
  serverTime: "2026-11-04T00:00:00Z",
  contractVersion: SYNC_CONTRACT_VERSION,
};

describe("mobileHttpTransport — request shapes (sync.controller conventions)", () => {
  it("pull: GET /api/v1/sync/pull?entity=…&cursor=…&limit=… with Bearer + x-device-id, envelope unwrapped", async () => {
    const { transport, requests } = makeTransport(() => ok(VALID_PULL_ENVELOPE));
    const envelope = await transport.pull("van_stocks", "41", 100);
    expect(envelope.entityType).toBe("van_stocks");
    expect(envelope.cursor).toBe("42");
    expect(envelope.changes).toHaveLength(1);
    // The LITE payload rides the envelope untouched (money TEXT).
    expect(envelope.changes[0]!.payload?.qty).toBe("10.000000");
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("GET");
    // The REAL query param is `entity` (sync.controller @Query("entity")).
    expect(request.url).toBe(
      "https://api.erp.example/api/v1/sync/pull?entity=van_stocks&cursor=41&limit=100",
    );
    expect(request.headers.Authorization).toBe("Bearer access-token-abc123");
    expect(request.headers["x-device-id"]).toBe("31313131-1111-4111-8111-111111111111");
    expect(request.body).toBeUndefined();
  });

  it("pull: cursor omitted when null (the server treats missing as bootstrap)", async () => {
    const { transport, requests } = makeTransport(() => ok(VALID_PULL_ENVELOPE));
    await transport.pull("items", null);
    expect(requests[0]!.url).toBe("https://api.erp.example/api/v1/sync/pull?entity=items");
  });

  it("pull: limit omitted when undefined", async () => {
    const { transport, requests } = makeTransport(() => ok(VALID_PULL_ENVELOPE));
    await transport.pull("items", "7");
    expect(requests[0]!.url).toBe("https://api.erp.example/api/v1/sync/pull?entity=items&cursor=7");
  });

  it("push (016 legacy): POST /api/v1/sync/push with {batchId, commands} + JSON content type", async () => {
    const { transport, requests } = makeTransport(() =>
      ok({
        results: [
          { id: "cmd-1", status: "ACCEPTED", idempotencyKey: "k1", result: { officialNo: "POS-1" } },
        ],
      }),
    );
    const results = await transport.push("batch:2026-11-04:cmd-1", [{ type: "pos_sale", id: "cmd-1" }]);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("ACCEPTED");
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://api.erp.example/api/v1/sync/push");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(request.body ?? "{}")).toEqual({
      batchId: "batch:2026-11-04:cmd-1",
      commands: [{ type: "pos_sale", id: "cmd-1" }],
    });
  });

  it("pushV2: POST /api/v1/sync/push with {contractVersion, commands}", async () => {
    const { transport, requests } = makeTransport(() =>
      ok({
        results: [
          {
            id: "cmd-1",
            commandId: "cmd-1",
            status: "ACCEPTED",
            idempotencyKey: "k1",
            result: {},
            officialNumber: "SAL-2026-000001",
            entity: { id: "partner-1", version: 2 },
          },
        ],
      }),
    );
    const results = await transport.pushV2({
      contractVersion: SYNC_CONTRACT_VERSION,
      commands: [{ commandId: "cmd-1", entityType: "partner", intent: "contact_merge", idempotencyKey: "k1", clientCreatedAt: "2026-11-04T00:00:00Z", payload: {} }],
    });
    expect(results[0]!.status).toBe("ACCEPTED");
    const body = JSON.parse(requests[0]!.body ?? "{}") as Record<string, unknown>;
    expect(body.contractVersion).toBe(SYNC_CONTRACT_VERSION);
    expect(Array.isArray(body.commands)).toBe(true);
  });

  it("status: GET /api/v1/sync/status, device:null normalized, rich fields passed through", async () => {
    const { transport, requests } = makeTransport(() =>
      ok({
        contractVersion: SYNC_CONTRACT_VERSION,
        serverTime: "2026-11-04T12:00:00Z",
        feedGroup: ["items", "van_stocks", "statements"],
        device: {
          id: "31313131-1111-4111-8111-111111111111",
          deviceClass: "android-field",
          revoked: true,
          trustFlags: {},
          dataExpiresAt: null,
          contractVersion: SYNC_CONTRACT_VERSION,
          contractSupported: true,
        },
        suspended: false,
        tenantId: "31313131-3131-4131-8131-313131313131",
      }),
    );
    const status = await transport.status();
    expect(status.contractVersion).toBe(SYNC_CONTRACT_VERSION);
    expect(status.serverTime).toBe("2026-11-04T12:00:00Z");
    expect(status.device?.revoked).toBe(true);
    expect(status.device?.dataExpiresAt).toBeNull();
    expect(status.suspended).toBe(false);
    expect(requests[0]!.url).toBe("https://api.erp.example/api/v1/sync/status");
    expect(requests[0]!.headers.Authorization).toBe("Bearer access-token-abc123");
  });

  it("status: device:null from the server becomes undefined (sync-core assignability)", async () => {
    const { transport } = makeTransport(() =>
      ok({ contractVersion: SYNC_CONTRACT_VERSION, serverTime: "2026-11-04T12:00:00Z", device: null }),
    );
    const status = await transport.status();
    expect(status.device).toBeUndefined();
  });

  it("pullAck/pushAck: POST the §5.1/§2.8 bodies", async () => {
    const { transport, requests } = makeTransport(() => ok({ acknowledged: 2 }));
    await transport.pullAck([{ entityType: "van_stocks", cursor: "42" }]);
    await transport.pushAck(["cmd-000000000001", "cmd-000000000002"]);
    expect(requests[0]!.url).toBe("https://api.erp.example/api/v1/sync/pull/ack");
    expect(JSON.parse(requests[0]!.body ?? "{}")).toEqual({
      positions: [{ entityType: "van_stocks", cursor: "42" }],
    });
    expect(requests[1]!.url).toBe("https://api.erp.example/api/v1/sync/push/ack");
    expect(JSON.parse(requests[1]!.body ?? "{}")).toEqual({
      commandIds: ["cmd-000000000001", "cmd-000000000002"],
    });
  });
});

describe("mobileHttpTransport — typed failures", () => {
  it("no access token: MobileSessionExpiredError BEFORE any port call (never anonymous)", async () => {
    const { transport, requests } = makeTransport(() => ok({}), () => null);
    await expect(transport.pull("items", null)).rejects.toBeInstanceOf(MobileSessionExpiredError);
    await expect(
      transport.push("batch:2026-11-04T00:00:00Z", [{ type: "pos_sale", id: "x" }]),
    ).rejects.toBeInstanceOf(MobileSessionExpiredError);
    await expect(
      transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [] }),
    ).rejects.toBeInstanceOf(MobileSessionExpiredError);
    await expect(transport.status()).rejects.toBeInstanceOf(MobileSessionExpiredError);
    await expect(transport.pullAck([{ entityType: "items", cursor: "1" }])).rejects.toBeInstanceOf(
      MobileSessionExpiredError,
    );
    await expect(transport.pushAck(["cmd-000000000001"])).rejects.toBeInstanceOf(
      MobileSessionExpiredError,
    );
    expect(requests).toHaveLength(0);
  });

  it("empty-string token is treated as absent (fail-closed)", async () => {
    const { transport, requests } = makeTransport(() => ok({}), () => "");
    await expect(transport.pull("items", null)).rejects.toBeInstanceOf(MobileSessionExpiredError);
    expect(requests).toHaveLength(0);
  });

  it("non-2xx: MobileSyncHttpError carrying status + body + url", async () => {
    const { transport } = makeTransport(() => ({
      status: 404,
      text: JSON.stringify({ error: { code: "SYNC_ENTITY_NOT_FOUND", message: "no such entity" } }),
    }));
    const failure = await transport.pull("nope", null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MobileSyncHttpError);
    const httpError = failure as MobileSyncHttpError;
    expect(httpError.status).toBe(404);
    expect(httpError.body).toContain("SYNC_ENTITY_NOT_FOUND");
    expect(httpError.url).toContain("/api/v1/sync/pull");
  });

  it("HTTP 401 stays a typed MobileSyncHttpError the host maps to the session-expired path", async () => {
    const { transport } = makeTransport(() => ({ status: 401, text: '{"error":{"code":"UNAUTHENTICATED"}}' }));
    const failure = await transport.status().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MobileSyncHttpError);
    expect((failure as MobileSyncHttpError).status).toBe(401);
  });

  it("non-JSON 2xx body: MobileSyncResponseError", async () => {
    const { transport } = makeTransport(() => ({ status: 200, text: "<html>gateway</html>" }));
    await expect(transport.status()).rejects.toBeInstanceOf(MobileSyncResponseError);
  });

  it("2xx body without the {data} envelope: MobileSyncResponseError", async () => {
    const { transport } = makeTransport(() => ({ status: 200, text: JSON.stringify({ results: [] }) }));
    await expect(transport.status()).rejects.toBeInstanceOf(MobileSyncResponseError);
  });

  it("pull envelope failing the shared contracts schema: MobileSyncResponseError", async () => {
    const broken = { ...VALID_PULL_ENVELOPE, changes: "not-an-array" } as unknown as Record<string, unknown>;
    const { transport } = makeTransport(() => ok(broken));
    await expect(transport.pull("van_stocks", null)).rejects.toBeInstanceOf(MobileSyncResponseError);
  });

  it("push response without a results array: MobileSyncResponseError", async () => {
    const { transport } = makeTransport(() => ok({ something: "else" }));
    await expect(
      transport.push("batch:2026-11-04T00:00:00Z", [{ type: "pos_sale", id: "x" }]),
    ).rejects.toBeInstanceOf(MobileSyncResponseError);
  });
});

describe("mobileHttpTransport — the per-cycle byte budget guard", () => {
  it("counts pull payload bytes (the response text) and push body bytes; reports usage", async () => {
    // A path-aware responder: pull routes get the envelope, push routes
    // get a results array (the same wire the real server serves).
    const respond: Responder = (request) =>
      request.url.endsWith("/sync/push")
        ? ok({ results: [{ id: "cmd-1", commandId: "cmd-1", status: "ACCEPTED", idempotencyKey: "k1", result: {} }] })
        : ok(VALID_PULL_ENVELOPE);
    const { transport } = makeTransport(respond);
    transport.budget.beginCycle({ pullBytes: SYNC_PULL_BUDGET_BYTES, pushBytes: SYNC_PUSH_BUDGET_BYTES });
    expect(transport.budget.usage()).toEqual({
      pullBytes: 0,
      pushBytes: 0,
      pullLimitBytes: SYNC_PULL_BUDGET_BYTES,
      pushLimitBytes: SYNC_PUSH_BUDGET_BYTES,
    });
    await transport.pull("van_stocks", null);
    const pullBytes = transport.budget.usage().pullBytes;
    expect(pullBytes).toBe(JSON.stringify({ data: VALID_PULL_ENVELOPE, meta: { requestId: "req-test" } }).length);
    await transport.pushV2({
      contractVersion: SYNC_CONTRACT_VERSION,
      commands: [{ commandId: "cmd-1", entityType: "partner", intent: "contact_merge", idempotencyKey: "key-12345678", clientCreatedAt: "2026-11-04T00:00:00Z", payload: {} }],
    });
    expect(transport.budget.usage().pushBytes).toBeGreaterThan(0);
  });

  it("trips SyncBudgetExceededError when a side goes over (the client-side enforcement)", async () => {
    // A 300-byte pull budget: the first VALID_PULL_ENVELOPE response
    // (~250 B) fits; a second pull pushes over → the typed trip.
    const { transport, requests } = makeTransport(() => ok(VALID_PULL_ENVELOPE));
    const small = JSON.stringify({ data: VALID_PULL_ENVELOPE, meta: { requestId: "req-test" } }).length;
    transport.budget.beginCycle({ pullBytes: small + 40, pushBytes: SYNC_PUSH_BUDGET_BYTES });
    await transport.pull("van_stocks", null); // fits
    await expect(transport.pull("van_stocks", null)).rejects.toBeInstanceOf(SyncBudgetExceededError);
    const failure = await transport.pull("van_stocks", null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncBudgetExceededError);
    const budgetError = failure as SyncBudgetExceededError;
    expect(budgetError.side).toBe("pull");
    expect(budgetError.limitBytes).toBe(small + 40);
    expect(budgetError.usedBytes).toBeGreaterThan(budgetError.limitBytes);
    // The refusal fires BEFORE any further port call (a fresh budget
    // trips the next request — no more wire work on the dead side).
    const requestsSoFar = requests.length;
    await expect(transport.pull("van_stocks", null)).rejects.toBeInstanceOf(SyncBudgetExceededError);
    expect(requests.length).toBe(requestsSoFar);
  });

  it("push accounting trips too (a serialized body over the push limit)", async () => {
    const { transport } = makeTransport(() =>
      ok({ results: [{ id: "cmd-1", status: "ACCEPTED", idempotencyKey: "k1", result: {} }] }),
    );
    transport.budget.beginCycle({ pullBytes: SYNC_PULL_BUDGET_BYTES, pushBytes: 60 });
    // The {batchId, commands} body is well over 60 bytes.
    await expect(
      transport.push("batch:2026-11-04T00:00:00Z", [{ type: "pos_sale", id: "x" }]),
    ).rejects.toBeInstanceOf(SyncBudgetExceededError);
  });

  it("beginCycle resets the counters (a fresh budget per cycle)", async () => {
    const { transport } = makeTransport(() => ok(VALID_PULL_ENVELOPE));
    transport.budget.beginCycle({ pullBytes: 40, pushBytes: SYNC_PUSH_BUDGET_BYTES });
    await expect(transport.pull("van_stocks", null)).rejects.toBeInstanceOf(SyncBudgetExceededError);
    transport.budget.beginCycle({ pullBytes: SYNC_PULL_BUDGET_BYTES, pushBytes: SYNC_PUSH_BUDGET_BYTES });
    await transport.pull("van_stocks", null); // fresh budget — fits
    expect(transport.budget.usage().pullBytes).toBeLessThanOrEqual(SYNC_PULL_BUDGET_BYTES);
  });

  it("the BudgetGuard standalone (the host injects it as the controller)", () => {
    const guard = new BudgetGuard();
    guard.beginCycle({ pullBytes: 100, pushBytes: 100 });
    guard.accountPull(60);
    guard.accountPush(40);
    expect(guard.usage()).toEqual({ pullBytes: 60, pushBytes: 40, pullLimitBytes: 100, pushLimitBytes: 100 });
    expect(() => guard.accountPull(41)).toThrow(SyncBudgetExceededError);
    // The golden constants the profiles ride.
    expect(SYNC_PULL_BUDGET_BYTES).toBe(8_388_608);
    expect(SYNC_PUSH_BUDGET_BYTES).toBe(2_097_152);
    expect(PERSONAL_BACKGROUND_PULL_BUDGET_BYTES).toBe(262_144);
  });
});

describe("mobileHttpTransport — construction guards", () => {
  it("empty baseUrl refused loudly", () => {
    const { http } = scriptedHttpPort(() => ok({}));
    expect(() =>
      mobileHttpTransport({
        http,
        baseUrl: "  ",
        accessToken: () => "token",
        deviceId: "d1",
      }),
    ).toThrow(/baseUrl/);
  });

  it("trailing slashes on the baseUrl are normalized (one canonical origin)", async () => {
    const { http, requests } = scriptedHttpPort(() => ok(VALID_PULL_ENVELOPE));
    const transport = mobileHttpTransport({
      http,
      baseUrl: "https://api.erp.example///",
      accessToken: () => "token",
      deviceId: "d1",
    });
    await transport.pull("items", null);
    expect(requests[0]!.url).toBe("https://api.erp.example/api/v1/sync/pull?entity=items");
  });
});
