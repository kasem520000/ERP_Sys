import { createPublicKey, verify as ed25519Verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";
import { metaSet } from "@erp/sync-core";

import {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  ACTIVE_DEVICE_ID_KEY,
  MobileAuthHttpError,
  MemorySecureStore,
  MobileSession,
  NodeCryptoDriver,
  ReLoginRequiredError,
  UnlockGate,
  enrollMobileDevice,
  rotateDeviceRefreshToken,
  secureStoreNames,
  verifyEd25519Signature,
  wipeDeviceCredentials,
  type SecureStorePort,
} from "../src/auth";
import type { HttpPort, HttpPortResponse } from "../src/sync/http-port";
import { openFieldStore, type MobileStore } from "../src/store";
import { MOBILE_DEVICE_CLASSES } from "../src/constants";

/**
 * PHASE-022 T2-b unit evidence (MASTER-PLAN §7; DR-P22-09; SECURITY_AND_
 * DEVICE_MANAGEMENT §2/§3; SECURITY_TEST_PLAN D-01/D-07): the mobile
 * auth modules — the @erp/desktop auth suite's SHAPES ported onto the
 * HttpPort seam (the desktop's apps/desktop/__tests__/auth.test.ts):
 *
 * 1. SecureStorePort: the vault seam + the erp.<deviceId>.* namespace;
 * 2. CryptoPort: REAL Ed25519 (the Node driver — the verifier is never
 *    mocked, the desktop precedent);
 * 3. enrollMobileDevice: register → attest (the nonce signature
 *    VERIFIED against the registered public key server-side) → enroll
 *    (the one-time secret forwarded exactly once, single-use proven)
 *    → vault (refreshToken + keypair) with the access token NEVER
 *    persisted;
 * 4. MobileSession: memory-only token, the expiry−60 s silent-refresh
 *    boundary (fake clock), the rotation mutex, the D-01
 *    rotation-failure hook;
 * 5. rotateDeviceRefreshToken: rotation happy path (successor persisted
 *    BEFORE resolve) + REUSE DETECTION (a second use of a rotated
 *    token → 401 DEVICE_REFRESH_INVALID → vault wipe + re-login) and
 *    the DEVICE_REVOKED kill switch;
 * 6. SECRET-SCAN (SECURITY §3): the full enroll + session + rotation
 *    flow over the REAL mobile store (openFieldStore on a temp SQLite
 *    file) — no token/key material EVER reaches the store;
 * 7. UnlockGate: the biometric-or-PIN state machine (biometric
 *    unavailable → PIN path; the wrong-PIN retry ladder + lockout,
 *    never a brick).
 */

const DEVICE_ID = "3b220000-0022-4000-8000-000000000022";
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_URL = "https://api.erp.example";
const ENROLLMENT_SECRET = "e".repeat(64);
const NONCE = "n".repeat(32);

const workDirs: string[] = [];
function tempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "erp-mobile-auth-"));
  workDirs.push(dir);
  return join(dir, `${prefix}.sqlite`);
}
afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

// -- the scripted fake device-registry server (the REAL client code against it) --

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

function ok(data: unknown): { status: number; text: string } {
  return { status: 200, text: JSON.stringify({ data, meta: { requestId: "req-auth-test" } }) };
}

function errorBody(status: number, code: string, message: string): { status: number; text: string } {
  // The ERROR_MODEL envelope (apps/api/src/infra/http/error.filter.ts).
  return { status, text: JSON.stringify({ error: { code, message, retryable: false, traceId: "t" } }) };
}

/** Wrap a scripted response in the HttpPortResponse shape (json()
 * parses the raw text — the fetch-like contract). */
function respond(response: { status: number; text: string }): HttpPortResponse {
  return { status: response.status, text: response.text, json: () => JSON.parse(response.text) };
}

/**
 * The fake devices registry: implements the REAL server semantics read
 * from devices.controller.ts + device-enrollment.ts + device-tokens.ts —
 * register issues the nonce + the ONE-TIME enrollment secret, attest
 * VERIFIES the Ed25519 signature against the registered public key,
 * enroll consumes the secret exactly once (a second use → 401
 * DEVICE_REFRESH_INVALID), refresh rotates one-time-use tokens (an
 * already-used token → 401 DEVICE_REFRESH_INVALID — the theft signal;
 * `revoked` → 403 DEVICE_REVOKED).
 */
function fakeDeviceRegistry(options?: { revoked?: boolean }) {
  const requests: RecordedRequest[] = [];
  let registeredPublicKey: string | null = null;
  let issuedNonce: string | null = null;
  let enrollmentSecretUsed = false;
  let currentRefreshToken: string | null = null;
  let rotations = 0;
  const attestSignatures: string[] = [];
  const refreshTokensPresented: string[] = [];

  const http: HttpPort = {
    request: async (method, url, requestOptions) => {
      const record: RecordedRequest = {
        method,
        url,
        headers: { ...(requestOptions?.headers ?? {}) },
        body: requestOptions?.body,
      };
      requests.push(record);
      const body: Record<string, unknown> =
        record.body === undefined ? {} : (JSON.parse(record.body) as Record<string, unknown>);
      const path = url.slice(BASE_URL.length);

      if (method === "POST" && path === "/api/v1/devices") {
        registeredPublicKey = String(body.deviceKeyPublic);
        issuedNonce = NONCE;
        return respond(
          ok({
            deviceId: DEVICE_ID,
            attestationNonce: issuedNonce,
            enrollmentSecret: ENROLLMENT_SECRET,
            contractVersion: SYNC_CONTRACT_VERSION,
          }),
        );
      }
      if (method === "POST" && path === `/api/v1/devices/${DEVICE_ID}/attest`) {
        const signature = String(body.signature);
        attestSignatures.push(signature);
        const publicKey = createPublicKey({
          key: Buffer.from(registeredPublicKey ?? "", "base64"),
          format: "der",
          type: "spki",
        });
        const verified = ed25519Verify(
          null,
          Buffer.from(issuedNonce ?? "", "utf8"),
          publicKey,
          Buffer.from(signature, "base64"),
        );
        if (!verified) {
          return respond(errorBody(400, "ATTESTATION_FAILED", "signature verification failed"));
        }
        return respond(ok({ attestedAt: new Date().toISOString(), trustFlags: { attested: true } }));
      }
      if (method === "POST" && path === `/api/v1/devices/${DEVICE_ID}/enroll`) {
        if (enrollmentSecretUsed || body.enrollmentSecret !== ENROLLMENT_SECRET) {
          return respond(
            errorBody(401, "DEVICE_REFRESH_INVALID", "enrollment secret invalid or already used"),
          );
        }
        enrollmentSecretUsed = true;
        currentRefreshToken = "refresh-token-boot";
        return respond(
          ok({
            refreshToken: currentRefreshToken,
            accessToken: "access-token-boot",
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            refreshTokenExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
          }),
        );
      }
      if (method === "POST" && path === `/api/v1/devices/${DEVICE_ID}/refresh`) {
        const presented = String(body.refreshToken);
        refreshTokensPresented.push(presented);
        if (options?.revoked === true) {
          return respond(
            errorBody(403, "DEVICE_REVOKED", "device is revoked — no new tokens are minted"),
          );
        }
        if (presented !== currentRefreshToken) {
          // The M-05 theft signal: the server answers 401 AND revokes.
          return respond(
            errorBody(401, "DEVICE_REFRESH_INVALID", "refresh token not recognized (reuse)"),
          );
        }
        rotations += 1;
        currentRefreshToken = `refresh-token-r${rotations}`;
        return respond(
          ok({
            refreshToken: currentRefreshToken,
            accessToken: `access-token-r${rotations}`,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            refreshTokenExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
          }),
        );
      }
      return respond(errorBody(404, "NOT_FOUND", `no fake route for ${method} ${path}`));
    },
  };

  return {
    http,
    requests,
    attestSignatures: () => attestSignatures.slice(),
    refreshTokensPresented: () => refreshTokensPresented.slice(),
    enrollmentSecretUsed: () => enrollmentSecretUsed,
    currentRefreshToken: () => currentRefreshToken,
  };
}

const enrollInput = (http: HttpPort, secureStore: SecureStorePort) => ({
  http,
  baseUrl: BASE_URL,
  secureStore,
  crypto: NodeCryptoDriver,
  deviceClass: MOBILE_DEVICE_CLASSES.field,
  deviceName: "rep-field-phone-01",
  appVersion: "1.0.0",
  platformVersion: "14",
  registerAuthorization: "Bearer portal-session-token",
});

// -- 1. SecureStorePort ------------------------------------------------------------

describe("SecureStorePort (SECURITY_AND_DEVICE_MANAGEMENT §3)", () => {
  it("MemorySecureStore: get/set/delete round-trip; absent → null; delete idempotent", async () => {
    const store = new MemorySecureStore();
    expect(await store.getItem("erp.x.refreshToken")).toBeNull();
    await store.setItem("erp.x.refreshToken", "secret-1");
    expect(await store.getItem("erp.x.refreshToken")).toBe("secret-1");
    await store.setItem("erp.x.refreshToken", "secret-2"); // overwrite
    expect(await store.getItem("erp.x.refreshToken")).toBe("secret-2");
    await store.deleteItem("erp.x.refreshToken");
    expect(await store.getItem("erp.x.refreshToken")).toBeNull();
    await store.deleteItem("erp.x.refreshToken"); // idempotent
    expect(await store.getItem("erp.x.refreshToken")).toBeNull();
  });

  it("secureStoreNames: the erp.<deviceId>.{refreshToken|devicePrivateKey|deviceKey|dbKey} namespace + the active-device pointer", () => {
    expect(secureStoreNames(DEVICE_ID)).toEqual({
      refreshToken: `erp.${DEVICE_ID}.refreshToken`,
      devicePrivateKey: `erp.${DEVICE_ID}.devicePrivateKey`,
      deviceKey: `erp.${DEVICE_ID}.deviceKey`,
      dbKey: `erp.${DEVICE_ID}.dbKey`,
    });
    expect(ACTIVE_DEVICE_ID_KEY).toBe("erp.activeDeviceId");
  });
});

// -- 2. CryptoPort (REAL Ed25519 — the verifier is never mocked) --------------------

describe("CryptoPort — NodeCryptoDriver (real Ed25519)", () => {
  it("generateKeypair + sign: the signature verifies against the public key (node:crypto + the port's own verifier)", async () => {
    const keypair = await NodeCryptoDriver.generateKeypair();
    expect(keypair.publicKey).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // base64 DER SPKI
    expect(keypair.privateKey).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // base64 PKCS8

    const signature = await NodeCryptoDriver.sign(NONCE, keypair.privateKey);
    // The port's test-side verifier (the server attest shape).
    expect(verifyEd25519Signature(NONCE, keypair.publicKey, signature)).toBe(true);
    // And node's own verifier against the imported SPKI key.
    expect(
      ed25519Verify(
        null,
        Buffer.from(NONCE, "utf8"),
        createPublicKey({ key: Buffer.from(keypair.publicKey, "base64"), format: "der", type: "spki" }),
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
    // A different payload does NOT verify (fail closed).
    expect(verifyEd25519Signature(NONCE + "x", keypair.publicKey, signature)).toBe(false);
    expect(verifyEd25519Signature(NONCE, keypair.publicKey, "not-a-signature")).toBe(false);
  });
});

// -- 3. enrollMobileDevice (register → attest → enroll → vault) ----------------------

describe("enrollMobileDevice (DR-P21-01 orchestration over the HttpPort)", () => {
  it("register → attest (REAL Ed25519, server-verified) → enroll: the exact request shapes + the vault writes; accessToken never persisted", async () => {
    const registry = fakeDeviceRegistry();
    const secureStore = new MemorySecureStore();
    const result = await enrollMobileDevice(enrollInput(registry.http, secureStore));

    expect(result.deviceId).toBe(DEVICE_ID);
    expect(result.contractVersion).toBe(SYNC_CONTRACT_VERSION);
    expect(result.accessToken).toBe("access-token-boot");

    // Exactly three HTTP calls, in order.
    expect(registry.requests).toHaveLength(3);
    const [register, attest, enroll] = registry.requests;

    // register: POST /api/v1/devices under the logged-in identity.
    expect(register!.method).toBe("POST");
    expect(register!.url).toBe(`${BASE_URL}/api/v1/devices`);
    expect(register!.headers.Authorization).toBe("Bearer portal-session-token");
    expect(JSON.parse(register!.body ?? "{}")).toEqual({
      deviceName: "rep-field-phone-01",
      deviceClass: "android-field",
      platform: "android",
      platformVersion: "14",
      appVersion: "1.0.0",
      contractVersion: SYNC_CONTRACT_VERSION,
      deviceKeyPublic: expect.any(String),
      capabilities: ["van_sales"],
    });

    // attest: the server VERIFIED the real Ed25519 signature (a bad
    // signature would have answered ATTESTATION_FAILED and failed the
    // flow) — assert it once more client-side for the record.
    expect(attest!.method).toBe("POST");
    expect(attest!.url).toBe(`${BASE_URL}/api/v1/devices/${DEVICE_ID}/attest`);
    expect(attest!.headers.Authorization).toBe("Bearer portal-session-token");
    expect(JSON.parse(attest!.body ?? "{}")).toEqual({ signature: registry.attestSignatures()[0] });

    // enroll: the PUBLIC exchange — NO Authorization header (the
    // one-time secret IS the credential), forwarded exactly once.
    expect(enroll!.method).toBe("POST");
    expect(enroll!.url).toBe(`${BASE_URL}/api/v1/devices/${DEVICE_ID}/enroll`);
    expect(enroll!.headers.Authorization).toBeUndefined();
    expect(JSON.parse(enroll!.body ?? "{}")).toEqual({ enrollmentSecret: ENROLLMENT_SECRET });

    // The vault: refresh token + the keypair record + the active pointer.
    const names = secureStoreNames(DEVICE_ID);
    expect(await secureStore.getItem(names.refreshToken)).toBe("refresh-token-boot");
    expect(await secureStore.getItem(names.deviceKey)).toBe(
      JSON.parse(register!.body ?? "{}").deviceKeyPublic,
    );
    expect(await secureStore.getItem(names.devicePrivateKey)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(await secureStore.getItem(ACTIVE_DEVICE_ID_KEY)).toBe(DEVICE_ID);
    // The access token is NOWHERE in the vault (memory-only, §3).
    expect(JSON.stringify(secureStore.snapshot())).not.toContain("access-token-boot");
    expect(JSON.stringify(secureStore.snapshot())).not.toContain(ENROLLMENT_SECRET);
  });

  it("personal class: the register body carries linkedPartnerId + capabilities ['personal_account']; a personal registration without the partner link fails loud BEFORE any call", async () => {
    const registry = fakeDeviceRegistry();
    const secureStore = new MemorySecureStore();
    const result = await enrollMobileDevice({
      ...enrollInput(registry.http, secureStore),
      deviceClass: MOBILE_DEVICE_CLASSES.personal,
      deviceName: "customer-phone-01",
      linkedPartnerId: "partner-0001",
    });
    expect(result.deviceId).toBe(DEVICE_ID);
    const registerBody = JSON.parse(registry.requests[0]!.body ?? "{}");
    expect(registerBody.deviceClass).toBe("android-personal");
    expect(registerBody.capabilities).toEqual(["personal_account"]);
    expect(registerBody.linkedPartnerId).toBe("partner-0001");

    // Without the link the client refuses (an unlinked personal device
    // pulls an empty partner scope by design — fail loud at enroll
    // time, never at first pull).
    const registry2 = fakeDeviceRegistry();
    await expect(
      enrollMobileDevice({
        ...enrollInput(registry2.http, new MemorySecureStore()),
        deviceClass: MOBILE_DEVICE_CLASSES.personal,
      }),
    ).rejects.toThrow(/linkedPartnerId/);
    expect(registry2.requests).toHaveLength(0); // refused BEFORE any HTTP call
  });

  it("the enrollment secret is SINGLE-USE: a second enroll exchange with the same secret answers 401 DEVICE_REFRESH_INVALID (typed)", async () => {
    const registry = fakeDeviceRegistry();
    const secureStore = new MemorySecureStore();
    await enrollMobileDevice(enrollInput(registry.http, secureStore));
    expect(registry.enrollmentSecretUsed()).toBe(true);

    // A replayed enroll call (e.g. a retry after a crash) is refused
    // by the server's one-time-proof semantics — the typed 401.
    const replay = await registry.http.request("POST", `${BASE_URL}/api/v1/devices/${DEVICE_ID}/enroll`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollmentSecret: ENROLLMENT_SECRET }),
    });
    expect(replay.status).toBe(401);
    expect((replay.json() as { error: { code: string } }).error.code).toBe("DEVICE_REFRESH_INVALID");
  });

  it("a failed hop persists NOTHING (all-or-nothing) — an attest rejection leaves the vault empty", async () => {
    // A registry whose attest step always fails: the tampered-signature
    // path (the server answers ATTESTATION_FAILED).
    const registry = fakeDeviceRegistry();
    const secureStore = new MemorySecureStore();
    const tamperingHttp: HttpPort = {
      request: (method, url, options) => {
        if (url.endsWith("/attest")) {
          return Promise.resolve(
            respond(errorBody(400, "ATTESTATION_FAILED", "signature verification failed")),
          );
        }
        return registry.http.request(method, url, options);
      },
    };
    await expect(enrollMobileDevice(enrollInput(tamperingHttp, secureStore))).rejects.toThrow(
      /ATTESTATION_FAILED|HTTP 400/,
    );
    // The desktop invariant ported: a failed enrollment writes NOTHING.
    expect(secureStore.snapshot()).toEqual({});
  });
});

// -- 4. MobileSession (memory-only; expiry−60 s silent refresh) ----------------------

describe("MobileSession (memory-only; expiry−60 s silent refresh)", () => {
  const T0 = 1_800_000_000_000; // a fixed epoch base

  /** The desktop rotation harness: a vault-backed exchange whose
   * contract — persist the successor BEFORE resolving — is implemented
   * for real, so a re-presented consumed token gets the typed reuse
   * error exactly like the server would answer. */
  function rotationHarness(initial: string) {
    const vault: SecureStorePort = new MemorySecureStore();
    void vault.setItem(secureStoreNames(DEVICE_ID).refreshToken, initial);
    let now = T0;
    let rotations = 0;
    const refresh = async (presented: string) => {
      const current = await vault.getItem(secureStoreNames(DEVICE_ID).refreshToken);
      if (presented !== current) {
        throw new ReLoginRequiredError("REUSE_DETECTED", "refresh token not recognized (reuse)");
      }
      rotations += 1;
      const successor = `refresh-token-${rotations + 1}`;
      await vault.setItem(secureStoreNames(DEVICE_ID).refreshToken, successor);
      return {
        accessToken: `access-token-${rotations + 1}`,
        expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(now + 30 * DAY_MS).toISOString(),
      };
    };
    return {
      vault,
      refresh,
      rotations: () => rotations,
      nowMs: () => now,
      setNow: (ms: number) => {
        now = ms;
      },
    };
  }

  it("the −60 s boundary: no refresh at expiry−61 s, refresh at expiry−60 s (fake clock); isExpired only at the true expiry", async () => {
    const harness = rotationHarness("refresh-token-1");
    const failures: string[] = [];
    const session = new MobileSession({
      getRefreshToken: () => harness.vault.getItem(secureStoreNames(DEVICE_ID).refreshToken),
      refresh: harness.refresh,
      clock: harness.nowMs,
      onRotationFailure: (failure) => failures.push(failure.kind),
    });

    const first = await session.silentRefreshIfDue(); // no token held → due now
    expect(first).toBe("access-token-2");
    expect(session.current()).toBe("access-token-2");
    expect(session.isExpired()).toBe(false);
    expect(harness.rotations()).toBe(1);

    // 15-min TTL (server ACCESS_TOKEN_TTL_SECONDS = 900).
    const expiry = T0 + 15 * 60 * 1000;
    harness.setNow(expiry - ACCESS_TOKEN_REFRESH_MARGIN_MS - 1000);
    expect(await session.silentRefreshIfDue()).toBe("access-token-2"); // not due yet
    expect(harness.rotations()).toBe(1);
    harness.setNow(expiry - ACCESS_TOKEN_REFRESH_MARGIN_MS);
    expect(await session.silentRefreshIfDue()).toBe("access-token-3"); // due at −60 s
    expect(harness.rotations()).toBe(2);

    // The scheduling hook: msUntilDue matches the −60 s re-arm point of
    // the HELD token (the second exchange's — acquired at expiry−60 s
    // with its own 15-min TTL).
    const heldExpiry = expiry - ACCESS_TOKEN_REFRESH_MARGIN_MS + 15 * 60 * 1000;
    harness.setNow(T0);
    expect(session.msUntilDue()).toBe(heldExpiry - ACCESS_TOKEN_REFRESH_MARGIN_MS - T0);

    // isExpired flips only at the HELD token's true expiry.
    const secondExpiry = expiry - ACCESS_TOKEN_REFRESH_MARGIN_MS + 15 * 60 * 1000;
    harness.setNow(secondExpiry - 1000);
    expect(session.isExpired()).toBe(false);
    harness.setNow(secondExpiry);
    expect(session.isExpired()).toBe(true);
    expect(failures).toEqual([]);
  });

  it("prime(): the enroll-time access token seeds memory without an exchange", async () => {
    const harness = rotationHarness("refresh-token-1");
    const session = new MobileSession({
      getRefreshToken: () => harness.vault.getItem(secureStoreNames(DEVICE_ID).refreshToken),
      refresh: harness.refresh,
      clock: harness.nowMs,
    });
    session.prime("access-token-boot", new Date(T0 + 15 * 60 * 1000).toISOString());
    harness.setNow(T0 + 1000);
    expect(await session.silentRefreshIfDue()).toBe("access-token-boot"); // not due
    expect(harness.rotations()).toBe(0); // no exchange happened
  });

  it("concurrency: simultaneous due refreshes share ONE exchange (the reuse mutex)", async () => {
    const harness = rotationHarness("refresh-token-1");
    let releaseRotation!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRotation = resolve;
    });
    const slowRefresh = async (presented: string) => {
      await gate;
      return harness.refresh(presented);
    };
    const session = new MobileSession({
      getRefreshToken: () => harness.vault.getItem(secureStoreNames(DEVICE_ID).refreshToken),
      refresh: slowRefresh,
      clock: harness.nowMs,
    });

    const first = session.silentRefreshIfDue();
    const second = session.silentRefreshIfDue();
    releaseRotation();
    expect(await first).toBe("access-token-2");
    expect(await second).toBe("access-token-2"); // the SAME exchange — no reuse
    expect(harness.rotations()).toBe(1);
  });

  it("rotation failure → D-01 hook fires, state clears, error rethrows; NO_CREDENTIAL when unenrolled", async () => {
    const harness = rotationHarness("refresh-token-1");
    const failures: { kind: string; requiresReEnrollment: boolean }[] = [];
    const session = new MobileSession({
      getRefreshToken: () => harness.vault.getItem(secureStoreNames(DEVICE_ID).refreshToken),
      refresh: async () => {
        throw new ReLoginRequiredError("DEVICE_REVOKED", "device is revoked");
      },
      clock: harness.nowMs,
      onRotationFailure: (failure) => {
        failures.push({ kind: failure.kind, requiresReEnrollment: failure.requiresReEnrollment });
      },
    });

    await expect(session.silentRefreshIfDue()).rejects.toThrow(ReLoginRequiredError);
    expect(failures).toEqual([{ kind: "ROTATION_FAILED", requiresReEnrollment: true }]);
    expect(session.current()).toBeNull(); // state cleared
    expect(session.isExpired()).toBe(true);

    // No credential at all (the D-01 purge end state): null, not a
    // throw, with the NO_CREDENTIAL hook — the UI routes to re-login.
    const failures2: string[] = [];
    const session2 = new MobileSession({
      getRefreshToken: async () => null,
      refresh: harness.refresh,
      clock: harness.nowMs,
      onRotationFailure: (failure) => failures2.push(failure.kind),
    });
    expect(await session2.silentRefreshIfDue()).toBeNull();
    expect(failures2).toEqual(["NO_CREDENTIAL"]);
  });
});

// -- 5. rotateDeviceRefreshToken (rotation + REUSE DETECTION) ------------------------

describe("rotateDeviceRefreshToken (POST /:id/refresh — rotation + reuse detection)", () => {
  it("happy path: the successor is persisted to the vault BEFORE the call resolves; the server sees each token exactly once", async () => {
    const registry = fakeDeviceRegistry();
    const secureStore = new MemorySecureStore();
    await enrollMobileDevice(enrollInput(registry.http, secureStore));

    const options = {
      http: registry.http,
      baseUrl: BASE_URL,
      deviceId: DEVICE_ID,
      secureStore,
    };
    const first = await rotateDeviceRefreshToken(options);
    expect(first.accessToken).toBe("access-token-r1");
    // The vault holds the successor (persisted before resolve).
    expect(await secureStore.getItem(secureStoreNames(DEVICE_ID).refreshToken)).toBe("refresh-token-r1");
    // The server was asked with the vault's own token each time.
    expect(registry.refreshTokensPresented()).toEqual(["refresh-token-boot"]);

    const second = await rotateDeviceRefreshToken(options);
    expect(second.accessToken).toBe("access-token-r2");
    expect(await secureStore.getItem(secureStoreNames(DEVICE_ID).refreshToken)).toBe("refresh-token-r2");
    expect(registry.refreshTokensPresented()).toEqual(["refresh-token-boot", "refresh-token-r1"]);
  });

  it("REUSE DETECTION: a second use of a rotated token (401 DEVICE_REFRESH_INVALID) → vault WIPE + ReLoginRequiredError(REUSE_DETECTED) — the theft signal (ADR-0015 §3)", async () => {
    const registry = fakeDeviceRegistry();
    const secureStore = new MemorySecureStore();
    await enrollMobileDevice(enrollInput(registry.http, secureStore));
    const names = secureStoreNames(DEVICE_ID);

    // First rotation succeeds (boot → r1). Then the STALE boot token
    // is presented again — exactly what a thief (or a restored backup)
    // would do: the server answers the theft signal.
    await rotateDeviceRefreshToken({
      http: registry.http,
      baseUrl: BASE_URL,
      deviceId: DEVICE_ID,
      secureStore,
    });
    await expect(
      rotateDeviceRefreshToken({
        http: registry.http,
        baseUrl: BASE_URL,
        deviceId: DEVICE_ID,
        secureStore,
        presented: "refresh-token-boot", // the CONSUMED token, replayed
      }),
    ).rejects.toMatchObject({ reason: "REUSE_DETECTED" });

    // The vault was wiped (refresh token + keypair + the pointer).
    expect(await secureStore.getItem(names.refreshToken)).toBeNull();
    expect(await secureStore.getItem(names.devicePrivateKey)).toBeNull();
    expect(await secureStore.getItem(names.deviceKey)).toBeNull();
    expect(await secureStore.getItem(ACTIVE_DEVICE_ID_KEY)).toBeNull();

    // And a session presenting the SAME consumed token (a restored
    // backup / a thief's copy) surfaces it through the D-01 hook
    // (wipe + flag + re-login — the desktop behavior ported).
    const staleVault: SecureStorePort = new MemorySecureStore();
    await staleVault.setItem(names.refreshToken, "refresh-token-boot");
    const failures: { kind: string; error: unknown }[] = [];
    const session = new MobileSession({
      getRefreshToken: () => staleVault.getItem(names.refreshToken),
      refresh: (token) =>
        rotateDeviceRefreshToken({ http: registry.http, baseUrl: BASE_URL, deviceId: DEVICE_ID, secureStore: staleVault, presented: token }),
      onRotationFailure: (failure) => failures.push({ kind: failure.kind, error: failure.error }),
    });
    await expect(session.silentRefreshIfDue()).rejects.toBeInstanceOf(ReLoginRequiredError);
    expect(failures[0]!.kind).toBe("ROTATION_FAILED");
    expect(failures[0]!.error).toBeInstanceOf(ReLoginRequiredError);
    expect(session.current()).toBeNull();
    expect(await staleVault.getItem(names.refreshToken)).toBeNull(); // wiped
  });

  it("DEVICE_REVOKED (403): the kill switch wipes the vault + surfaces re-login; a NON-credential 404 is NOT a wipe", async () => {
    const registry = fakeDeviceRegistry({ revoked: true });
    const secureStore = new MemorySecureStore();
    await enrollMobileDevice(enrollInput(registry.http, secureStore));
    const names = secureStoreNames(DEVICE_ID);

    await expect(
      rotateDeviceRefreshToken({
        http: registry.http,
        baseUrl: BASE_URL,
        deviceId: DEVICE_ID,
        secureStore,
      }),
    ).rejects.toMatchObject({ reason: "DEVICE_REVOKED" });
    expect(await secureStore.getItem(names.refreshToken)).toBeNull();

    // A 404 (device row gone server-side) is an honest transport
    // error, NOT a credential rejection — the vault keeps its token.
    const missingDevice = fakeDeviceRegistry();
    const vault2 = new MemorySecureStore();
    await enrollMobileDevice(enrollInput(missingDevice.http, vault2));
    const unknownDevice: HttpPort = {
      request: async () =>
        respond(
          errorBody(404, "NOT_FOUND", "device not found"),
        ),
    };
    await expect(
      rotateDeviceRefreshToken({
        http: unknownDevice,
        baseUrl: BASE_URL,
        deviceId: DEVICE_ID,
        secureStore: vault2,
      }),
    ).rejects.toBeInstanceOf(MobileAuthHttpError);
    expect(await vault2.getItem(secureStoreNames(DEVICE_ID).refreshToken)).toBe("refresh-token-boot");

    // wipeDeviceCredentials is idempotent + keeps the dbKey (the store
    // bootstrap owns that entry).
    await vault2.setItem(names.dbKey, "db-key-material");
    await wipeDeviceCredentials(vault2, DEVICE_ID);
    await wipeDeviceCredentials(vault2, DEVICE_ID);
    expect(await vault2.getItem(names.refreshToken)).toBeNull();
    expect(await vault2.getItem(names.dbKey)).toBe("db-key-material");
  });
});

// -- 6. SECRET-SCAN (SECURITY §3: no token material ever reaches the store) ----------

describe("SECRET-SCAN (SECURITY §3: no token material ever reaches the store)", () => {
  it("full enroll + session + rotation flow over the REAL store (openFieldStore, temp SQLite): no secret in any row of any table", async () => {
    const store: MobileStore = openFieldStore(tempDbPath("secret-scan"));
    try {
      // Legitimate store traffic: a permissions watermark + a cached row.
      metaSet(store, "permissionSnapshotAt", String(Date.now()));
      store.run(
        "INSERT INTO items (id, sku, name, kind, status) VALUES (?, ?, ?, ?, ?)",
        ["item-1", "SKU-1", "Cached item", "GOODS", "ACTIVE"],
      );

      const registry = fakeDeviceRegistry();
      const secureStore = new MemorySecureStore();
      const enrolled = await enrollMobileDevice(enrollInput(registry.http, secureStore));

      const failures: string[] = [];
      let now = Date.now();
      const session = new MobileSession({
        getRefreshToken: () => secureStore.getItem(secureStoreNames(DEVICE_ID).refreshToken),
        refresh: (token) =>
          rotateDeviceRefreshToken({
            http: registry.http,
            baseUrl: BASE_URL,
            deviceId: DEVICE_ID,
            secureStore,
            presented: token,
          }),
        clock: () => now,
        onRotationFailure: (failure) => failures.push(failure.kind),
      });
      session.prime(enrolled.accessToken, enrolled.expiresAt);
      now += 15 * 60 * 1000; // force due → a REAL rotation over HTTP
      await session.silentRefreshIfDue();
      expect(failures).toEqual([]);
      expect(session.current()).toBe("access-token-r1"); // the positive control

      // THE SCAN: no secret material in any table the store hosts.
      const secrets = [
        "access-token-boot",
        "access-token-r1",
        "refresh-token-boot",
        "refresh-token-r1",
        ENROLLMENT_SECRET,
        secureStore.snapshot()[secureStoreNames(DEVICE_ID).devicePrivateKey] ?? "",
      ];
      const tables = [
        ...store.listBusinessTables(),
        "meta",
        "outbox",
        "inbox",
        "cursors",
        "schema_migrations",
      ];
      for (const table of tables) {
        const rows = store.all(`SELECT * FROM ${table}`);
        for (const row of rows) {
          const serialized = JSON.stringify(row);
          for (const secret of secrets) {
            expect(serialized, `table ${table} carries secret material`).not.toContain(secret);
          }
        }
      }
    } finally {
      store.close();
    }
  });
});

// -- 7. UnlockGate (biometric optional + PIN fallback — DR-P22-09) --------------------

describe("UnlockGate (biometric-gate state machine)", () => {
  function fakeUnlockPort(options?: { biometricAvailable?: boolean; biometricSucceeds?: boolean; correctPin?: string }) {
    let pinCalls = 0;
    let biometricCalls = 0;
    const port = {
      isBiometricAvailable: async () => options?.biometricAvailable ?? true,
      authenticateBiometric: async () => {
        biometricCalls += 1;
        return options?.biometricSucceeds ?? true;
      },
      verifyPin: async (pin: string) => {
        pinCalls += 1;
        return pin === (options?.correctPin ?? "1234");
      },
    };
    return {
      port,
      pinCalls: () => pinCalls,
      biometricCalls: () => biometricCalls,
    };
  }

  it("locked → biometric → unlocked; lock() re-locks (the state machine)", async () => {
    const fake = fakeUnlockPort({ biometricAvailable: true, biometricSucceeds: true });
    const gate = new UnlockGate({ port: fake.port });
    expect(gate.phase).toBe("locked");
    const result = await gate.unlockWithBiometric("Unlock ERP field app");
    expect(result).toEqual({ unlocked: true, method: "biometric" });
    expect(gate.phase).toBe("unlocked");
    expect(fake.biometricCalls()).toBe(1);
    gate.lock();
    expect(gate.phase).toBe("locked");
  });

  it("biometric UNAVAILABLE → the PIN path (DR-P22-09: biometric optional + PIN fallback)", async () => {
    const fake = fakeUnlockPort({ biometricAvailable: false, correctPin: "9999" });
    const gate = new UnlockGate({ port: fake.port });
    expect(await gate.isBiometricAvailable()).toBe(false);

    const biometricAttempt = await gate.unlockWithBiometric("Unlock");
    expect(biometricAttempt).toEqual({ unlocked: false, reason: "BIOMETRIC_UNAVAILABLE" });
    expect(fake.biometricCalls()).toBe(0); // the sensor was never even prompted

    // The PIN fallback unlocks.
    const wrong = await gate.unlockWithPin("0000");
    expect(wrong.unlocked).toBe(false);
    const correct = await gate.unlockWithPin("9999");
    expect(correct).toEqual({ unlocked: true, method: "pin" });
    expect(gate.phase).toBe("unlocked");
  });

  it("the wrong-PIN retry ladder: attempts count up → PIN_LOCKED_OUT at the max; the port never sees a PIN after lockout; biometric STILL works (never a brick); clearPinAttempts re-arms", async () => {
    const fake = fakeUnlockPort({ biometricAvailable: true, biometricSucceeds: true, correctPin: "4321" });
    const gate = new UnlockGate({ port: fake.port, maxPinAttempts: 3 });

    const first = await gate.unlockWithPin("0000");
    expect(first).toEqual({ unlocked: false, reason: "PIN_INCORRECT", attemptsRemaining: 2 });
    const second = await gate.unlockWithPin("1111");
    expect(second).toEqual({ unlocked: false, reason: "PIN_INCORRECT", attemptsRemaining: 1 });
    const third = await gate.unlockWithPin("2222");
    expect(third).toEqual({ unlocked: false, reason: "PIN_LOCKED_OUT", attemptsRemaining: 0 });
    expect(gate.pinLockedOut).toBe(true);
    expect(fake.pinCalls()).toBe(3);

    // After lockout the verifier is NEVER consulted (4th call → the
    // port saw exactly 3 PINs).
    const fourth = await gate.unlockWithPin("4321");
    expect(fourth).toEqual({ unlocked: false, reason: "PIN_LOCKED_OUT", attemptsRemaining: 0 });
    expect(fake.pinCalls()).toBe(3); // the correct PIN was not even checked

    // NEVER a brick (D-07's degrade doctrine applied to the gate): the
    // biometric path still unlocks while the PIN is locked out.
    const biometric = await gate.unlockWithBiometric("Unlock ERP field app");
    expect(biometric).toEqual({ unlocked: true, method: "biometric" });
    expect(gate.phase).toBe("unlocked");
    expect(gate.pinAttempts).toBe(0); // any successful unlock resets the ladder
    expect(gate.pinLockedOut).toBe(false);

    // The cool-down reset re-arms the PIN path for the next episode.
    gate.lock();
    gate.clearPinAttempts();
    expect(await gate.unlockWithPin("4321")).toEqual({ unlocked: true, method: "pin" });
  });
});
