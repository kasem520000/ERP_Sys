import { describe, expect, it } from "vitest";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";
import type { DesktopBridge } from "../src/bridge/contract";
import {
  bridgeTransport,
  DesktopSessionExpiredError,
  DesktopSyncHttpError,
  DesktopSyncResponseError,
  type BridgeTransportOptions,
} from "../src/sync";

/**
 * PHASE-021 · the bridge transport suite (T4; MASTER-PLAN §5; SYNC_
 * PROTOCOL §1/§2/§3/§5): a scripted bridge http member records every
 * request and serves API-envelope responses — asserting the REAL server
 * conventions (verified against apps/api sync.controller: the `entity`
 * query param, the `x-device-id` header, the {data, meta} envelope, the
 * push body shapes) and every typed failure mode. The transport is the
 * only piece faked here is the BRIDGE (the shell seam) — everything else
 * is the real transport code.
 */

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

type Responder = (request: RecordedRequest) => { status: number; body: string };

function scriptedBridge(respond: Responder): {
  bridge: Pick<DesktopBridge, "http">;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    bridge: {
      http: {
        request: async (input: {
          method: string;
          url: string;
          headers?: Record<string, string>;
          body?: string;
        }): Promise<{ status: number; body: string }> => {
          const record: RecordedRequest = {
            method: input.method,
            url: input.url,
            headers: { ...input.headers },
            body: input.body,
          };
          requests.push(record);
          return respond(record);
        },
      },
    },
  };
}

/** The API success envelope (apps/api/src/infra/http/envelope.ts). */
function ok(data: unknown): { status: number; body: string } {
  return { status: 200, body: JSON.stringify({ data, meta: { requestId: "req-test" } }) };
}

function makeTransport(
  respond: Responder,
  session: { current(): string | null } = { current: () => "access-token-abc123" },
): { transport: ReturnType<typeof bridgeTransport>; requests: RecordedRequest[] } {
  const { bridge, requests } = scriptedBridge(respond);
  const options: BridgeTransportOptions = {
    bridge,
    baseUrl: "https://api.erp.example/",
    session,
    deviceId: "21212121-1111-4111-8111-111111111111",
  };
  return { transport: bridgeTransport(options), requests };
}

const VALID_PULL_ENVELOPE = {
  entityType: "items",
  cursor: "42",
  nextCursor: "42",
  hasMore: false,
  changes: [
    {
      id: "item-1",
      seq: 42,
      op: "UPSERT",
      payload: { id: "item-1", sku: "SKU-1" },
      changedAt: "2026-11-04T00:00:00Z",
      version: 3,
    },
  ],
  serverTime: "2026-11-04T00:00:00Z",
  contractVersion: SYNC_CONTRACT_VERSION,
};

describe("bridgeTransport — request shapes (sync.controller conventions)", () => {
  it("pull: GET /api/v1/sync/pull?entity=…&cursor=…&limit=… with Bearer + x-device-id, envelope unwrapped", async () => {
    const { transport, requests } = makeTransport(() => ok(VALID_PULL_ENVELOPE));
    const envelope = await transport.pull("items", "41", 100);
    expect(envelope.entityType).toBe("items");
    expect(envelope.cursor).toBe("42");
    expect(envelope.changes).toHaveLength(1);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("GET");
    // The REAL query param is `entity` (sync.controller @Query("entity")).
    expect(request.url).toBe(
      "https://api.erp.example/api/v1/sync/pull?entity=items&cursor=41&limit=100",
    );
    expect(request.headers.Authorization).toBe("Bearer access-token-abc123");
    expect(request.headers["x-device-id"]).toBe("21212121-1111-4111-8111-111111111111");
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
          { id: "cmd-1", status: "ACCEPTED", idempotencyKey: "k1", result: { officialNo: "INV-1" } },
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
            officialNumber: "INV-1",
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
        feedGroup: ["items", "sales_invoices"],
        device: {
          id: "21212121-1111-4111-8111-111111111111",
          deviceClass: "tauri-desktop",
          revoked: true,
          trustFlags: {},
          dataExpiresAt: null,
          contractVersion: SYNC_CONTRACT_VERSION,
          contractSupported: true,
        },
        suspended: false,
        tenantId: "21212121-2121-2121-2121-212121212121",
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
    await transport.pullAck([{ entityType: "items", cursor: "42" }]);
    await transport.pushAck(["cmd-000000000001", "cmd-000000000002"]);
    expect(requests[0]!.url).toBe("https://api.erp.example/api/v1/sync/pull/ack");
    expect(JSON.parse(requests[0]!.body ?? "{}")).toEqual({
      positions: [{ entityType: "items", cursor: "42" }],
    });
    expect(requests[1]!.url).toBe("https://api.erp.example/api/v1/sync/push/ack");
    expect(JSON.parse(requests[1]!.body ?? "{}")).toEqual({
      commandIds: ["cmd-000000000001", "cmd-000000000002"],
    });
  });
});

describe("bridgeTransport — typed failures", () => {
  it("no access token: DesktopSessionExpiredError BEFORE any bridge call (never anonymous)", async () => {
    const { transport, requests } = makeTransport(() => ok({}), { current: () => null });
    await expect(transport.pull("items", null)).rejects.toBeInstanceOf(DesktopSessionExpiredError);
    await expect(
      transport.push("batch:2026-11-04T00:00:00Z", [{ type: "pos_sale", id: "x" }]),
    ).rejects.toBeInstanceOf(DesktopSessionExpiredError);
    await expect(
      transport.pushV2({ contractVersion: SYNC_CONTRACT_VERSION, commands: [] }),
    ).rejects.toBeInstanceOf(DesktopSessionExpiredError);
    await expect(transport.status()).rejects.toBeInstanceOf(DesktopSessionExpiredError);
    await expect(transport.pullAck([{ entityType: "items", cursor: "1" }])).rejects.toBeInstanceOf(
      DesktopSessionExpiredError,
    );
    await expect(transport.pushAck(["cmd-000000000001"])).rejects.toBeInstanceOf(
      DesktopSessionExpiredError,
    );
    expect(requests).toHaveLength(0);
  });

  it("empty-string token is treated as absent (fail-closed)", async () => {
    const { transport, requests } = makeTransport(() => ok({}), { current: () => "" });
    await expect(transport.pull("items", null)).rejects.toBeInstanceOf(DesktopSessionExpiredError);
    expect(requests).toHaveLength(0);
  });

  it("non-2xx: DesktopSyncHttpError carrying status + body", async () => {
    const { transport } = makeTransport(() => ({
      status: 404,
      body: JSON.stringify({ error: { code: "SYNC_ENTITY_NOT_FOUND", message: "no such entity" } }),
    }));
    const failure = await transport.pull("nope", null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DesktopSyncHttpError);
    const httpError = failure as DesktopSyncHttpError;
    expect(httpError.status).toBe(404);
    expect(httpError.body).toContain("SYNC_ENTITY_NOT_FOUND");
    expect(httpError.url).toContain("/api/v1/sync/pull");
  });

  it("HTTP 401 stays a typed DesktopSyncHttpError the host maps to the session-expired path", async () => {
    const { transport } = makeTransport(() => ({ status: 401, body: '{"error":{"code":"UNAUTHENTICATED"}}' }));
    const failure = await transport.status().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DesktopSyncHttpError);
    expect((failure as DesktopSyncHttpError).status).toBe(401);
  });

  it("non-JSON 2xx body: DesktopSyncResponseError", async () => {
    const { transport } = makeTransport(() => ({ status: 200, body: "<html>gateway</html>" }));
    await expect(transport.status()).rejects.toBeInstanceOf(DesktopSyncResponseError);
  });

  it("2xx body without the {data} envelope: DesktopSyncResponseError", async () => {
    const { transport } = makeTransport(() => ({ status: 200, body: JSON.stringify({ results: [] }) }));
    await expect(transport.status()).rejects.toBeInstanceOf(DesktopSyncResponseError);
  });

  it("pull envelope failing the shared contracts schema: DesktopSyncResponseError", async () => {
    const broken = { ...VALID_PULL_ENVELOPE, changes: "not-an-array" } as unknown as Record<string, unknown>;
    const { transport } = makeTransport(() => ok(broken));
    await expect(transport.pull("items", null)).rejects.toBeInstanceOf(DesktopSyncResponseError);
  });

  it("push response without a results array: DesktopSyncResponseError", async () => {
    const { transport } = makeTransport(() => ok({ something: "else" }));
    await expect(
      transport.push("batch:2026-11-04T00:00:00Z", [{ type: "pos_sale", id: "x" }]),
    ).rejects.toBeInstanceOf(DesktopSyncResponseError);
  });
});

describe("bridgeTransport — construction guards", () => {
  it("empty baseUrl refused loudly", () => {
    const { bridge } = scriptedBridge(() => ok({}));
    expect(() =>
      bridgeTransport({
        bridge,
        baseUrl: "  ",
        session: { current: () => "token" },
        deviceId: "d1",
      }),
    ).toThrow(/baseUrl/);
  });

  it("trailing slashes on the baseUrl are normalized (one canonical origin)", async () => {
    const { bridge, requests } = scriptedBridge(() => ok(VALID_PULL_ENVELOPE));
    const transport = bridgeTransport({
      bridge,
      baseUrl: "https://api.erp.example///",
      session: { current: () => "token" },
      deviceId: "d1",
    });
    await transport.pull("items", null);
    expect(requests[0]!.url).toBe("https://api.erp.example/api/v1/sync/pull?entity=items");
  });
});
