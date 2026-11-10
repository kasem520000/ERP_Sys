import { describe, expect, it } from "vitest";

import {
  adminAckedAtFromTrustFlags,
  isTrustFlagged,
  onlineWriteGate,
  reportTrustSignals,
  trustPolicy,
  trustSignalsToFlags,
  type TrustSignals,
} from "../src/device";
import type { HttpPort } from "../src/sync/http-port";

/**
 * PHASE-022 T2-b unit evidence (MASTER-PLAN §7; DR-P22-09; SECURITY_AND_
 * DEVICE_MANAGEMENT §7 — the jailbreak/root posture; SECURITY_TEST_PLAN
 * D-07 — "degraded mode documented"): the trust-signal plane — the
 * devices.trustFlags PATCH surfacing (the exact patchSchema shape) and
 * the POLICY (flagged → online-only until admin ack; degrade, never
 * brick).
 */

const DEVICE_ID = "3b220000-0022-4000-8000-000000000022";
const BASE_URL = "https://api.erp.example";

function ok(data: unknown): { status: number; text: string } {
  return { status: 200, text: JSON.stringify({ data, meta: { requestId: "req-trust-test" } }) };
}

function errorBody(status: number, code: string, message: string): { status: number; text: string } {
  // The ERROR_MODEL envelope (apps/api/src/infra/http/error.filter.ts).
  return { status, text: JSON.stringify({ error: { code, message, retryable: false, traceId: "t" } }) };
}

function fakePatchPort(status: number) {
  const requests: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
  const http: HttpPort = {
    request: async (method, url, options) => {
      requests.push({ method, url, headers: { ...(options?.headers ?? {}) }, body: options?.body });
      const response =
        status === 200
          ? ok({ deviceId: DEVICE_ID, trustFlags: {}, dataExpiresAt: null })
          : errorBody(status, "FORBIDDEN", "identity.devices.manage required");
      return { status: response.status, text: response.text, json: () => JSON.parse(response.text) };
    },
  };
  return { http, requests };
}

describe("reportTrustSignals (the devices.trustFlags PATCH surface)", () => {
  it("signals → PATCH /api/v1/devices/:id with the exact patchSchema body { trustFlags } — positive flags only, never an invented signal", async () => {
    const port = fakePatchPort(200);
    const signals: TrustSignals = {
      isJailbrokenRooted: true,
      debuggableFlag: false,
      emulator: false,
      observedAt: "2026-11-05T10:00:00.000Z",
    };
    const outcome = await reportTrustSignals(port.http, BASE_URL, DEVICE_ID, signals, {
      authorization: "Bearer access-token-abc",
    });
    expect(outcome).toEqual({
      reported: true,
      trustFlags: {
        jailbrokenRooted: true,
        debuggable: false,
        emulator: false,
        reportedAt: "2026-11-05T10:00:00.000Z",
      },
    });

    expect(port.requests).toHaveLength(1);
    const request = port.requests[0]!;
    expect(request.method).toBe("PATCH");
    expect(request.url).toBe(`${BASE_URL}/api/v1/devices/${DEVICE_ID}`);
    expect(request.headers.Authorization).toBe("Bearer access-token-abc");
    expect(JSON.parse(request.body ?? "{}")).toEqual({
      trustFlags: {
        jailbrokenRooted: true,
        debuggable: false,
        emulator: false,
        reportedAt: "2026-11-05T10:00:00.000Z",
      },
    });
  });

  it("absent signals are simply not in the flags record (no guessing — §7.1 best-effort detection only)", () => {
    expect(trustSignalsToFlags({})).toEqual({});
    expect(trustSignalsToFlags({ debuggableFlag: true })).toEqual({ debuggable: true });
    expect(isTrustFlagged({})).toBe(false);
    expect(isTrustFlagged({ isJailbrokenRooted: false, debuggableFlag: false, emulator: false })).toBe(false);
  });

  it("D-07 best-effort: a 403 (the admin-plane guard) and a network failure are honest reported:false outcomes — NEVER a throw, NEVER a blocker", async () => {
    const port403 = fakePatchPort(403);
    const outcome403 = await reportTrustSignals(port403.http, BASE_URL, DEVICE_ID, { emulator: true });
    expect(outcome403).toEqual({ reported: false, reason: "http-error", status: 403, code: "FORBIDDEN" });

    const throwing: HttpPort = {
      request: async () => {
        throw new Error("offline");
      },
    };
    const outcomeOffline = await reportTrustSignals(throwing, BASE_URL, DEVICE_ID, { emulator: true });
    expect(outcomeOffline).toEqual({ reported: false, reason: "network-error" });
  });
});

describe("trustPolicy (D-07: flagged → online-only until admin ack; degrade, never brick)", () => {
  const CLEAN: TrustSignals = { isJailbrokenRooted: false, debuggableFlag: false, emulator: false };
  const FLAGGED: TrustSignals = { isJailbrokenRooted: true, observedAt: "2026-11-05T10:00:00.000Z" };

  it("clean signals → normal (a false-positive-free device is never degraded)", () => {
    expect(trustPolicy(CLEAN, null)).toBe("normal");
    expect(trustPolicy({}, null)).toBe("normal");
  });

  it("flagged + NO ack → online-only (writes require live authorization; local write caching disabled)", () => {
    expect(trustPolicy(FLAGGED, null)).toBe("online-only");
    expect(trustPolicy({ emulator: true }, null)).toBe("online-only");
    expect(trustPolicy({ debuggableFlag: true }, null)).toBe("online-only");
  });

  it("admin ack CLEARS the degradation; a NEW detection after the ack re-flags (the ack covers one episode)", () => {
    // The ack timestamp AFTER the observation → normal again.
    expect(trustPolicy(FLAGGED, "2026-11-06T10:00:00.000Z")).toBe("normal");
    // The ack timestamp BEFORE the observation (a fresh detection) →
    // re-flagged: the admin acknowledged the OLD episode, not this one.
    expect(trustPolicy(FLAGGED, "2026-11-04T10:00:00.000Z")).toBe("online-only");
    // Signals without observedAt are covered by the ack (fail-open
    // toward the user — §7.3's false-positive posture).
    expect(trustPolicy({ isJailbrokenRooted: true }, "2026-11-04T10:00:00.000Z")).toBe("normal");
  });

  it("adminAckedAtFromTrustFlags: the sync status surface's device.trustFlags carries the ack", () => {
    expect(adminAckedAtFromTrustFlags({ adminAckedAt: "2026-11-06T10:00:00.000Z" })).toBe(
      "2026-11-06T10:00:00.000Z",
    );
    expect(adminAckedAtFromTrustFlags({})).toBeNull();
    expect(adminAckedAtFromTrustFlags(undefined)).toBeNull();
    expect(adminAckedAtFromTrustFlags(null)).toBeNull();
  });

  it("the write gate: normal queues locally; online-only + online = LIVE write only; online-only + offline = the write degrades (refused with a reason) — reads never gated, NEVER a brick", () => {
    // Normal: full offline capability (queue + write).
    expect(onlineWriteGate("normal", false)).toEqual({ allowed: true, queueLocally: true, reason: "NORMAL" });
    expect(onlineWriteGate("normal", true)).toEqual({ allowed: true, queueLocally: true, reason: "NORMAL" });

    // Flagged + online: the write goes through LIVE (server
    // authorization every time), local write caching DISABLED.
    expect(onlineWriteGate("online-only", true)).toEqual({
      allowed: true,
      queueLocally: false,
      reason: "TRUST_FLAGGED_ONLINE_ONLY",
    });

    // Flagged + offline: the WRITE is refused with an honest reason —
    // the app degraded to online-only, it did not lock the user out
    // (reads, the unlock gate, and every non-write surface stay up;
    // the write proceeds the moment connectivity returns).
    expect(onlineWriteGate("online-only", false)).toEqual({
      allowed: false,
      queueLocally: false,
      reason: "TRUST_FLAGGED_OFFLINE",
    });
  });
});
