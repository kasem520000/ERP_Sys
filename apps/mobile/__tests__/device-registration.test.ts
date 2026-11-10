import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";
import { metaGet, metaSet } from "@erp/sync-core";

import {
  MemorySecureStore,
  NodeCryptoDriver,
  ACTIVE_DEVICE_ID_KEY,
  secureStoreNames,
} from "../src/auth";
import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";
import { purgeOnRevocation } from "../src/sync/revocation";
import {
  deviceRevocationHandler,
  handleDeviceRevocation,
  registerMobileDevice,
} from "../src/device";
import type { TrustSignalsPort } from "../src/device";
import { MOBILE_DEVICE_CLASSES } from "../src/constants";
import type { HttpPort, HttpPortResponse } from "../src/sync/http-port";

/**
 * PHASE-022 T2-b unit evidence (MASTER-PLAN §7; DR-P22-09; SECURITY_
 * AND_DEVICE_MANAGEMENT §4 + §6.2; SECURITY_TEST_PLAN D-01): the
 * device-registration orchestrator (enroll + trust + capability
 * negotiation) and the D-01 revoke-flow client — over the REAL mobile
 * stores (openFieldStore / openPersonalStore on temp SQLite files, the
 * 2-a suite's convention) and a scripted HttpPort implementing the
 * REAL devices-registry semantics.
 */

const DEVICE_ID = "3b220000-0022-4000-8000-000000000022";
const BASE_URL = "https://api.erp.example";
const DAY_MS = 24 * 60 * 60 * 1000;

function rowCount(store: MobileStore, table: string): number {
  return Number(store.get(`SELECT count(*) AS n FROM ${table}`)?.n ?? 0);
}

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-reg-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

function ok(data: unknown): { status: number; text: string } {
  return { status: 200, text: JSON.stringify({ data, meta: { requestId: "req-reg-test" } }) };
}

function errorBody(status: number, code: string, message: string): { status: number; text: string } {
  return { status, text: JSON.stringify({ error: { code, message, retryable: false, traceId: "t" } }) };
}

/** Wrap a scripted response in the HttpPortResponse shape. */
function respond(response: { status: number; text: string }): HttpPortResponse {
  return { status: response.status, text: response.text, json: () => JSON.parse(response.text) };
}

/** A registry fake: enroll + the trust PATCH (the permission-guarded
 * admin plane — the D-07 best-effort surface). */
function fakeRegistry(options?: { patchStatus?: number }) {
  const requests: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
  const http: HttpPort = {
    request: async (method, url, requestOptions) => {
      const body = requestOptions?.body;
      requests.push({
        method,
        url,
        headers: { ...(requestOptions?.headers ?? {}) },
        body,
      });
      const path = url.slice(BASE_URL.length);
      if (method === "POST" && path === "/api/v1/devices") {
        return respond(
          ok({
            deviceId: DEVICE_ID,
            attestationNonce: "n".repeat(32),
            enrollmentSecret: "e".repeat(64),
            contractVersion: SYNC_CONTRACT_VERSION,
          }),
        );
      }
      if (method === "POST" && path === `/api/v1/devices/${DEVICE_ID}/attest`) {
        return respond(ok({ attestedAt: new Date().toISOString() }));
      }
      if (method === "POST" && path === `/api/v1/devices/${DEVICE_ID}/enroll`) {
        return respond(
          ok({
            refreshToken: "refresh-token-boot",
            accessToken: "access-token-boot",
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            refreshTokenExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
          }),
        );
      }
      if (method === "PATCH" && path === `/api/v1/devices/${DEVICE_ID}`) {
        if (options?.patchStatus !== undefined && options.patchStatus !== 200) {
          return respond(errorBody(options.patchStatus, "FORBIDDEN", "identity.devices.manage required"));
        }
        return respond(
          ok({ deviceId: DEVICE_ID, trustFlags: JSON.parse(body ?? "{}").trustFlags, dataExpiresAt: null }),
        );
      }
      return respond(errorBody(404, "NOT_FOUND", `no fake route for ${method} ${path}`));
    },
  };
  return {
    http,
    requests,
  };
}

const registrationInput = (http: HttpPort, secureStore: MemorySecureStore) => ({
  http,
  baseUrl: BASE_URL,
  secureStore,
  crypto: NodeCryptoDriver,
  deviceClass: MOBILE_DEVICE_CLASSES.field,
  deviceName: "rep-field-phone-01",
  appVersion: "1.0.0",
  registerAuthorization: "Bearer portal-session-token",
});

describe("registerMobileDevice (the orchestrator: enroll + trust + capability negotiation)", () => {
  it("full flow: enroll → best-effort trust report (reported:true) with the fresh access token; the contract version rides the result (the C-08 input)", async () => {
    const registry = fakeRegistry();
    const secureStore = new MemorySecureStore();
    const reports: string[] = [];
    const trust: TrustSignalsPort = {
      collectTrustSignals: async () => ({
        isJailbrokenRooted: false,
        debuggableFlag: false,
        emulator: false,
        observedAt: "2026-11-05T10:00:00.000Z",
      }),
    };

    const result = await registerMobileDevice({
      ...registrationInput(registry.http, secureStore),
      trust,
      onTrustReport: (outcome) => reports.push(outcome.reported ? "reported" : "not-reported"),
    });

    expect(result.deviceId).toBe(DEVICE_ID);
    expect(result.contractVersion).toBe(SYNC_CONTRACT_VERSION); // the C-08 gate input
    expect(result.trustReport?.reported).toBe(true);
    expect(reports).toEqual(["reported"]);

    // Four calls: register, attest, enroll, then the trust PATCH.
    expect(registry.requests).toHaveLength(4);
    const patch = registry.requests[3]!;
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toBe(`${BASE_URL}/api/v1/devices/${DEVICE_ID}`);
    // Under the FRESH device access token (the strongest credential
    // the app holds at report time).
    expect(patch.headers.Authorization).toBe("Bearer access-token-boot");
    expect(JSON.parse(patch.body ?? "{}")).toEqual({
      trustFlags: {
        jailbrokenRooted: false,
        debuggable: false,
        emulator: false,
        reportedAt: "2026-11-05T10:00:00.000Z",
      },
    });
  });

  it("D-07: a REJECTED trust report (403 — the admin-plane guard) NEVER fails the registration; the honest outcome rides the result", async () => {
    const registry = fakeRegistry({ patchStatus: 403 });
    const secureStore = new MemorySecureStore();
    const trust: TrustSignalsPort = {
      collectTrustSignals: async () => ({ isJailbrokenRooted: true }),
    };

    const result = await registerMobileDevice({
      ...registrationInput(registry.http, secureStore),
      trust,
    });
    expect(result.deviceId).toBe(DEVICE_ID); // enrollment succeeded
    expect(result.trustReport).toEqual({
      reported: false,
      reason: "http-error",
      status: 403,
      code: "FORBIDDEN",
    });
    // The credentials still landed in the vault.
    expect(await secureStore.getItem(secureStoreNames(DEVICE_ID).refreshToken)).toBe("refresh-token-boot");

    // A THROWING signal collector is best-effort too (an exotic device
    // never blocks registration).
    const throwing: TrustSignalsPort = {
      collectTrustSignals: async () => {
        throw new Error("probe unavailable");
      },
    };
    const result2 = await registerMobileDevice({
      ...registrationInput(registry.http, secureStore),
      trust: throwing,
    });
    expect(result2.deviceId).toBe(DEVICE_ID);
    expect(result2.trustReport).toEqual({ reported: false, reason: "network-error" });
  });
});

describe("handleDeviceRevocation (the D-01 revoke-flow client)", () => {
  it("field profile: session clear FIRST → store purge (outbox included) → vault wipe → the re-login state", async () => {
    const store = openFieldStore(tempDbPath("revoke-field"));
    try {
      // A dirty outbox + a cached row + the device identity meta — the
      // data the §6.2 purge owns.
      store.run(
        "INSERT INTO outbox (command_id, entity_type, intent, payload, idempotency_key, client_created_at, status) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["cmd-1", "sales_invoice", "create_draft", "{}", "key-1", "2026-11-05T10:00:00Z", "QUEUED"],
      );
      store.run(
        "INSERT INTO items (id, sku, name, kind, status) VALUES (?, ?, ?, ?, ?)",
        ["item-1", "SKU-1", "Cached item", "GOODS", "ACTIVE"],
      );
      metaSet(store, "enrolledDeviceId", DEVICE_ID);
      metaSet(store, "permissionSnapshotAt", String(Date.now()));

      const secureStore = new MemorySecureStore();
      await secureStore.setItem(secureStoreNames(DEVICE_ID).refreshToken, "refresh-token-boot");
      await secureStore.setItem(secureStoreNames(DEVICE_ID).devicePrivateKey, "private-key-material");
      await secureStore.setItem(ACTIVE_DEVICE_ID_KEY, DEVICE_ID);

      let sessionCleared = 0;
      const outcome = await handleDeviceRevocation({
        store,
        secureStore,
        deviceId: DEVICE_ID,
        session: {
          clear: () => {
            sessionCleared += 1;
          },
        },
      });

      expect(sessionCleared).toBe(1); // credentials stopped FIRST
      expect(outcome.requiresReLogin).toBe(true);
      expect(outcome.reason).toBe("DEVICE_REVOKED");
      expect(outcome.sessionCleared).toBe(true);
      expect(outcome.credentialsWiped).toBe(true);
      // The purge: outbox + items emptied (the per-table report).
      expect(outcome.purged.tables["outbox"]).toBe(1);
      expect(outcome.purged.tables["items"]).toBe(1);
      expect(outcome.purged.metaKeysDeleted).toContain("enrolledDeviceId");
      expect(rowCount(store, "outbox")).toBe(0);
      // The vault: every device credential gone.
      expect(await secureStore.getItem(secureStoreNames(DEVICE_ID).refreshToken)).toBeNull();
      expect(await secureStore.getItem(secureStoreNames(DEVICE_ID).devicePrivateKey)).toBeNull();
      expect(await secureStore.getItem(ACTIVE_DEVICE_ID_KEY)).toBeNull();
      // The device identity meta is reset (the re-login path re-enrolls).
      expect(metaGet(store, "enrolledDeviceId")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("personal profile: the read models + cursors purge (no outbox exists — honest zeros, never a throw)", async () => {
    const store: MobileStore = openPersonalStore(tempDbPath("revoke-personal"));
    try {
      store.run(
        "INSERT INTO notifications (id, user_id, title, body, payload) VALUES (?, ?, ?, ?, ?)",
        ["note-1", "user-1", "t", "b", "{}"],
      );
      const secureStore = new MemorySecureStore();
      await secureStore.setItem(secureStoreNames(DEVICE_ID).refreshToken, "refresh-token-boot");

      const outcome = await handleDeviceRevocation({
        store,
        secureStore,
        deviceId: DEVICE_ID,
      });
      expect(outcome.sessionCleared).toBe(false); // no session provided — the shell owns it
      expect(outcome.purged.tables["notifications"]).toBe(1);
      expect(outcome.purged.tables["outbox"]).toBeUndefined(); // personal never had one
      expect(await secureStore.getItem(secureStoreNames(DEVICE_ID).refreshToken)).toBeNull();
    } finally {
      store.close();
    }
  });

  it("deviceRevocationHandler: the MobileSyncHost onRevocation wiring shape", async () => {
    const store = openFieldStore(tempDbPath("revoke-handler"));
    try {
      const secureStore = new MemorySecureStore();
      const handler = deviceRevocationHandler({ store, secureStore, deviceId: DEVICE_ID });
      const outcome = await handler({ source: "status", at: "2026-11-05T10:00:00Z", detail: "revoked" });
      expect(outcome.requiresReLogin).toBe(true);
      // An empty store purges honestly (zeros, no throw) — the
      // purgeOnRevocation contract (2-a's suite proves the full one).
      expect(outcome.purged.tables["outbox"]!).toBe(0);
      expect(rowCount(store, "outbox")).toBe(0);
      expect(purgeOnRevocation(store).purgedAt).toBeTruthy();
    } finally {
      store.close();
    }
  });
});
