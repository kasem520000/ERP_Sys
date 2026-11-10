import { generateKeyPairSync, sign as ed25519Sign, verify as ed25519Verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { memoryAdapter, metaSet, type MemoryAdapter, type StorageAdapter } from "@erp/sync-core";

import {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  DesktopSession,
  MemoryKeychain,
  SNAPSHOT_WATERMARK_MS,
  applyPermissionSnapshotPayload,
  applyPermissionSnapshotRows,
  enrollDesktopDevice,
  keychainNames,
  unlockWithSnapshot,
  type Keychain,
} from "../src/auth";

/**
 * PHASE-021 T3 unit evidence (MASTER-PLAN §4; SECURITY_AND_DEVICE_MANAGEMENT
 * §3): the desktop auth modules —
 *
 * 1. keychain: the vault seam + the erp.<deviceId>.* namespace;
 * 2. enrollDesktopDevice: register → (attest with a REAL ed25519 signature)
 *    → enroll → keychain entries (refreshToken + deviceKey), access token
 *    NEVER persisted, the enrollment secret forwarded exactly once;
 * 3. DesktopSession: memory-only token, the expiry−60 s silent-refresh
 *    boundary (fake clock), the rotation mutex (one exchange for
 *    concurrent callers), the D-01 rotation-failure hook;
 * 4. unlockWithSnapshot: the 7-day D-04 watermark boundary (6d23h full /
 *    7d1h readonly / no snapshot), the cached permission rows;
 * 5. SECRET-SCAN (SECURITY §3): the full enroll + session + unlock flow
 *    over a recording adapter — no token/key material is EVER written into
 *    the store (every run() param + every row of every known table scanned
 *    for the secret substrings).
 */

const DEVICE_ID = "d0000000-0000-4000-8000-000000000001";
const DAY_MS = 24 * 60 * 60 * 1000;

function ed25519KeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return { publicKey, publicKeyBase64: der.toString("base64"), privateKey };
}

describe("keychain (SECURITY_AND_DEVICE_MANAGEMENT §3)", () => {
  it("MemoryKeychain: get/set/delete round-trip; absent → null; delete idempotent", async () => {
    const keychain: Keychain = new MemoryKeychain();
    expect(await keychain.get("erp.x.refreshToken")).toBeNull();
    await keychain.set("erp.x.refreshToken", "secret-1");
    expect(await keychain.get("erp.x.refreshToken")).toBe("secret-1");
    await keychain.set("erp.x.refreshToken", "secret-2"); // overwrite
    expect(await keychain.get("erp.x.refreshToken")).toBe("secret-2");
    await keychain.delete("erp.x.refreshToken");
    expect(await keychain.get("erp.x.refreshToken")).toBeNull();
    await keychain.delete("erp.x.refreshToken"); // idempotent
    expect(await keychain.get("erp.x.refreshToken")).toBeNull();
  });

  it("keychainNames: the erp.<deviceId>.{refreshToken|deviceKey|dbKey} namespace", () => {
    expect(keychainNames(DEVICE_ID)).toEqual({
      refreshToken: `erp.${DEVICE_ID}.refreshToken`,
      deviceKey: `erp.${DEVICE_ID}.deviceKey`,
      dbKey: `erp.${DEVICE_ID}.dbKey`,
    });
  });
});

describe("enrollDesktopDevice (DR-P21-01 orchestration)", () => {
  it("register → attest (REAL ed25519 signature) → enroll → keychain; accessToken never persisted", async () => {
    const key = ed25519KeyPair();
    const keychain = new MemoryKeychain();
    const enrollmentSecret = "a".repeat(64);
    const credentials = {
      refreshToken: "refresh-token-1",
      accessToken: "access-token-1",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    };
    const nonce = "n".repeat(32);
    let attestSignature: string | null = null;
    let enrolledWith: string | null = null;

    const result = await enrollDesktopDevice({
      deviceId: DEVICE_ID,
      keychain,
      deviceKeyPair: {
        publicKey: key.publicKeyBase64,
        sign: (challenge) =>
          ed25519Sign(null, Buffer.from(challenge, "utf8"), key.privateKey).toString("base64"),
      },
      register: async () => ({
        deviceId: DEVICE_ID,
        attestationNonce: nonce,
        enrollmentSecret,
        contractVersion: "2026-11-04.1",
      }),
      attest: async (signature) => {
        attestSignature = signature;
        return { attestedAt: new Date().toISOString() };
      },
      enroll: async (secret) => {
        enrolledWith = secret;
        return credentials;
      },
    });

    // The orchestration result.
    expect(result).toEqual({ deviceId: DEVICE_ID, contractVersion: "2026-11-04.1" });

    // Attestation ran with a REAL ed25519 signature over the nonce that
    // verifies against the registered public key (the registry's shape).
    expect(attestSignature).not.toBeNull();
    expect(
      ed25519Verify(
        null,
        Buffer.from(nonce, "utf8"),
        key.publicKey,
        Buffer.from(attestSignature!, "base64"),
      ),
    ).toBe(true);

    // The one-time secret was forwarded to the enroll exchange exactly once.
    expect(enrolledWith).toBe(enrollmentSecret);

    // The keychain holds the refresh token + the device key record, and
    // NOTHING else — the access token is memory-only (SECURITY §3).
    const names = keychainNames(DEVICE_ID);
    expect(await keychain.get(names.refreshToken)).toBe(credentials.refreshToken);
    expect(await keychain.get(names.deviceKey)).toBe(key.publicKeyBase64);
    expect(await keychain.get(names.dbKey)).toBeNull(); // the store bootstrap owns it
    const vaultContents = JSON.stringify(
      await Promise.all(
        [names.refreshToken, names.deviceKey, names.dbKey, "erp.other.refreshToken"].map((name) =>
          keychain.get(name),
        ),
      ),
    );
    expect(vaultContents).not.toContain(credentials.accessToken);
  });

  it("attestation skipped without a keypair; a keyless attest transport fails loud", async () => {
    const keychain = new MemoryKeychain();

    // No keypair + no attest transport → plain register+enroll.
    const plain = await enrollDesktopDevice({
      deviceId: DEVICE_ID,
      keychain,
      register: async () => ({
        deviceId: DEVICE_ID,
        attestationNonce: null, // no key presented → no challenge
        enrollmentSecret: "b".repeat(64),
        contractVersion: "2026-11-04.1",
      }),
      enroll: async () => ({
        refreshToken: "refresh-token-2",
        accessToken: "access-token-2",
        expiresAt: new Date().toISOString(),
        refreshTokenExpiresAt: new Date().toISOString(),
      }),
    });
    expect(plain.deviceId).toBe(DEVICE_ID);
    expect(await keychain.get(keychainNames(DEVICE_ID).refreshToken)).toBe("refresh-token-2");
    expect(await keychain.get(keychainNames(DEVICE_ID).deviceKey)).toBeNull(); // no keypair → no entry

    // An attest transport without a keypair is a misconfiguration — never
    // a silent skip.
    await expect(
      enrollDesktopDevice({
        deviceId: DEVICE_ID,
        keychain,
        attest: async () => undefined,
        register: async () => ({
          deviceId: DEVICE_ID,
          attestationNonce: "n".repeat(32),
          enrollmentSecret: "c".repeat(64),
          contractVersion: "2026-11-04.1",
        }),
        enroll: async () => {
          throw new Error("must not be reached");
        },
      }),
    ).rejects.toThrow(/deviceKeyPair/);
  });

  it("a register/deviceId mismatch aborts BEFORE any credential is written", async () => {
    const keychain = new MemoryKeychain();
    await expect(
      enrollDesktopDevice({
        deviceId: DEVICE_ID,
        keychain,
        register: async () => ({
          deviceId: "d0000000-0000-4000-8000-000000000002",
          attestationNonce: null,
          enrollmentSecret: "d".repeat(64),
          contractVersion: "2026-11-04.1",
        }),
        enroll: async () => {
          throw new Error("must not be reached");
        },
      }),
    ).rejects.toThrow(/namespace/);
    expect(await keychain.get(keychainNames(DEVICE_ID).refreshToken)).toBeNull();
  });
});

describe("DesktopSession (memory-only; expiry−60 s silent refresh)", () => {
  const T0 = 1_800_000_000_000; // a fixed epoch base

  /** A keychain-backed rotation harness: the transport contract — persist
   * the successor refresh token BEFORE resolving — is implemented for real,
   * so a session that re-presents a consumed token gets the typed reuse
   * error exactly like the server would answer. */
  function rotationHarness(initial: string) {
    const keychain: Keychain = new MemoryKeychain();
    void keychain.set(keychainNames(DEVICE_ID).refreshToken, initial);
    let now = T0;
    let rotations = 0;
    const refresh = async (presented: string) => {
      const current = await keychain.get(keychainNames(DEVICE_ID).refreshToken);
      if (presented !== current) {
        throw new Error("DEVICE_REFRESH_INVALID: refresh token not recognized (reuse)");
      }
      rotations += 1;
      const successor = `refresh-token-${rotations + 1}`;
      await keychain.set(keychainNames(DEVICE_ID).refreshToken, successor);
      return {
        accessToken: `access-token-${rotations + 1}`,
        expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(now + 30 * DAY_MS).toISOString(),
      };
    };
    return {
      keychain,
      refresh,
      rotations: () => rotations,
      nowMs: () => now,
      setNow: (ms: number) => {
        now = ms;
      },
    };
  }

  it("the −60 s boundary: no refresh at expiry−61 s, refresh at expiry−60 s (fake clock)", async () => {
    const harness = rotationHarness("refresh-token-1");
    const failures: string[] = [];
    const session = new DesktopSession({
      getRefreshToken: () => harness.keychain.get(keychainNames(DEVICE_ID).refreshToken),
      refresh: harness.refresh,
      clock: harness.nowMs,
      onRotationFailure: (failure) => failures.push(failure.kind),
    });

    // Bootstrap exchange: no token held → due immediately.
    const first = await session.silentRefreshIfDue();
    expect(first).toBe("access-token-2");
    expect(session.current()).toBe("access-token-2");
    expect(session.isExpired()).toBe(false);
    expect(harness.rotations()).toBe(1);

    // 15-min TTL (server ACCESS_TOKEN_TTL_SECONDS = 900): at expiry−60 s
    // exactly, the refresh fires; one second earlier it must NOT (≥, not >).
    const expiry = T0 + 15 * 60 * 1000;
    harness.setNow(expiry - ACCESS_TOKEN_REFRESH_MARGIN_MS - 1000);
    expect(await session.silentRefreshIfDue()).toBe("access-token-2"); // not due yet
    expect(harness.rotations()).toBe(1);

    harness.setNow(expiry - ACCESS_TOKEN_REFRESH_MARGIN_MS);
    expect(await session.silentRefreshIfDue()).toBe("access-token-3"); // due at −60 s
    expect(harness.rotations()).toBe(2);

    // isExpired flips only at the true expiry of the HELD token.
    const secondExpiry = expiry - ACCESS_TOKEN_REFRESH_MARGIN_MS + 15 * 60 * 1000;
    harness.setNow(secondExpiry - 1000);
    expect(session.isExpired()).toBe(false);
    harness.setNow(secondExpiry);
    expect(session.isExpired()).toBe(true);

    expect(failures).toEqual([]); // no rotation failures on the happy path
  });

  it("prime(): the enroll-time access token seeds memory without an exchange", async () => {
    const harness = rotationHarness("refresh-token-1");
    const session = new DesktopSession({
      getRefreshToken: () => harness.keychain.get(keychainNames(DEVICE_ID).refreshToken),
      refresh: harness.refresh,
      clock: harness.nowMs,
    });
    session.prime("primed-access-token", new Date(T0 + 15 * 60 * 1000).toISOString());
    harness.setNow(T0 + 1000);
    expect(await session.silentRefreshIfDue()).toBe("primed-access-token"); // not due
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
    const session = new DesktopSession({
      getRefreshToken: () => harness.keychain.get(keychainNames(DEVICE_ID).refreshToken),
      refresh: slowRefresh,
      clock: harness.nowMs,
    });

    const first = session.silentRefreshIfDue();
    const second = session.silentRefreshIfDue();
    releaseRotation();
    expect(await first).toBe("access-token-2");
    expect(await second).toBe("access-token-2"); // the SAME exchange — no reuse
    expect(harness.rotations()).toBe(1); // exactly one underlying rotation
  });

  it("rotation failure → D-01 hook fires, state clears, error rethrows; NO_CREDENTIAL when unenrolled", async () => {
    const harness = rotationHarness("refresh-token-1");
    const failures: { kind: string; requiresReEnrollment: boolean }[] = [];
    const session = new DesktopSession({
      getRefreshToken: () => harness.keychain.get(keychainNames(DEVICE_ID).refreshToken),
      refresh: async () => {
        throw new Error("DEVICE_REVOKED: device is revoked");
      },
      clock: harness.nowMs,
      onRotationFailure: (failure) => {
        failures.push({ kind: failure.kind, requiresReEnrollment: failure.requiresReEnrollment });
      },
    });

    await expect(session.silentRefreshIfDue()).rejects.toThrow(/DEVICE_REVOKED/);
    expect(failures).toEqual([{ kind: "ROTATION_FAILED", requiresReEnrollment: true }]);
    expect(session.current()).toBeNull(); // state cleared
    expect(session.isExpired()).toBe(true);

    // No credential at all (the D-01 purge end state): null, not a throw,
    // with the NO_CREDENTIAL hook — the UI routes to re-enrollment.
    const failures2: string[] = [];
    const session2 = new DesktopSession({
      getRefreshToken: async () => null,
      refresh: harness.refresh,
      clock: harness.nowMs,
      onRotationFailure: (failure) => failures2.push(failure.kind),
    });
    expect(await session2.silentRefreshIfDue()).toBeNull();
    expect(failures2).toEqual(["NO_CREDENTIAL"]);
  });
});

describe("unlockWithSnapshot (D-04: the 7-day permission watermark)", () => {
  /** A fixed "now" base (deterministic boundaries). */
  const NOW = Date.parse("2026-11-04T12:00:00.000Z");

  it("no snapshot at all → readonly NO_SNAPSHOT", () => {
    const adapter = memoryAdapter();
    expect(unlockWithSnapshot(adapter, { now: new Date(NOW) })).toEqual({
      mode: "readonly",
      reason: "NO_SNAPSHOT",
    });
  });

  it("6d23h old → full with the cached keys; 7d1h old → readonly SNAPSHOT_EXPIRED", () => {
    const adapter = memoryAdapter();
    applyPermissionSnapshotRows(adapter, ["sales.invoices.view", "items.view"]);
    const freshAge = 6 * DAY_MS + 23 * 60 * 60 * 1000;
    metaSet(adapter, "permissionSnapshotAt", String(NOW - freshAge));

    const full = unlockWithSnapshot(adapter, { now: new Date(NOW) });
    expect(full).toEqual({
      mode: "full",
      permissions: ["items.view", "sales.invoices.view"], // sorted by the writer
      snapshotAt: new Date(NOW - freshAge),
    });

    const staleAge = 7 * DAY_MS + 60 * 60 * 1000;
    metaSet(adapter, "permissionSnapshotAt", String(NOW - staleAge));
    const expired = unlockWithSnapshot(adapter, { now: new Date(NOW) });
    expect(expired).toEqual({
      mode: "readonly",
      reason: "SNAPSHOT_EXPIRED",
      snapshotAt: new Date(NOW - staleAge),
    });
  });

  it("the watermark constant + the payload writer (rows AND watermark, replaced atomically)", () => {
    expect(SNAPSHOT_WATERMARK_MS).toBe(7 * 24 * 60 * 60 * 1000);

    const adapter = memoryAdapter();
    applyPermissionSnapshotPayload(adapter, {
      userId: "user-1",
      permissions: ["pos.sales.sell", "items.view"],
      snapshotAt: new Date(NOW - DAY_MS).toISOString(), // ISO accepted
      watermarkDays: 7,
    });
    // The watermark landed (epoch ms — the sync-core shape).
    const full = unlockWithSnapshot(adapter, { now: new Date(NOW) });
    expect(full.mode).toBe("full");
    expect(full.mode === "full" ? full.permissions : []).toEqual(["items.view", "pos.sales.sell"]);

    // A later snapshot REPLACES the key set atomically (revoked keys drop out).
    applyPermissionSnapshotPayload(adapter, {
      userId: "user-1",
      permissions: ["items.view"],
      snapshotAt: String(NOW), // numeric-string epoch ms accepted too
      watermarkDays: 7,
    });
    const replaced = unlockWithSnapshot(adapter, { now: new Date(NOW) });
    expect(replaced.mode === "full" ? replaced.permissions : []).toEqual(["items.view"]);
  });
});

describe("SECRET-SCAN (SECURITY §3: no token material ever reaches the store)", () => {
  it("full enroll + session + unlock flow over a recording adapter: no secret in any run() param or row", async () => {
    const recording = recordingAdapter(memoryAdapter());
    const key = ed25519KeyPair();
    const keychain = new MemoryKeychain();
    const credentials = {
      refreshToken: "SCAN-refresh-token-9f1c2d",
      accessToken: "SCAN-access-token-8b3e4f",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    };
    const enrollmentSecret = "SCAN-enrollment-secret-7a5b9c";
    const deviceKeyMaterial = key.publicKeyBase64;

    // The full first-run flow: permission-cache writes (legitimate store
    // traffic) + enroll + a primed session that later rotates once.
    applyPermissionSnapshotPayload(recording, {
      userId: "user-1",
      permissions: ["items.view", "pos.sales.sell"],
      snapshotAt: new Date().toISOString(),
    });
    const enrolled = await enrollDesktopDevice({
      deviceId: DEVICE_ID,
      keychain,
      deviceKeyPair: {
        publicKey: deviceKeyMaterial,
        sign: (nonce) =>
          ed25519Sign(null, Buffer.from(nonce, "utf8"), key.privateKey).toString("base64"),
      },
      register: async () => ({
        deviceId: DEVICE_ID,
        attestationNonce: "nonce".repeat(8),
        enrollmentSecret,
        contractVersion: "2026-11-04.1",
      }),
      attest: async () => undefined,
      enroll: async () => credentials,
    });
    expect(enrolled.deviceId).toBe(DEVICE_ID);

    const failures: string[] = [];
    let now = Date.now();
    const session = new DesktopSession({
      getRefreshToken: () => keychain.get(keychainNames(DEVICE_ID).refreshToken),
      refresh: async (presented) => {
        if (presented !== credentials.refreshToken) {
          throw new Error("DEVICE_REFRESH_INVALID");
        }
        return {
          accessToken: "SCAN-access-token-rotated-1a2b3c",
          expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(now + 30 * DAY_MS).toISOString(),
        };
      },
      clock: () => now,
      onRotationFailure: (failure) => failures.push(failure.kind),
    });
    session.prime(credentials.accessToken, credentials.expiresAt);
    now += 15 * 60 * 1000; // force due
    await session.silentRefreshIfDue();
    expect(failures).toEqual([]);

    // Unlock reads the store (legitimate) — the decision is unaffected.
    const decision = unlockWithSnapshot(recording, { now: new Date(now) });
    expect(decision.mode).toBe("full");

    // THE SCAN: no secret material in any recorded mutating statement...
    const secrets = [
      credentials.refreshToken,
      credentials.accessToken,
      "SCAN-access-token-rotated-1a2b3c",
      enrollmentSecret,
      deviceKeyMaterial,
    ];
    expect(recording.writes.length).toBeGreaterThan(0); // the scan has traffic to scan
    for (const entry of recording.writes) {
      for (const param of entry.params) {
        for (const secret of secrets) {
          expect(String(param), `store write "${entry.sql}" carried secret material`).not.toContain(
            secret,
          );
        }
      }
    }
    // ...and none in any row of every table the adapter knows.
    for (const table of ["meta", "permissions", "outbox", "inbox", "cursors", "items", "partners"]) {
      for (const row of recording.all(`SELECT * FROM ${table}`)) {
        const serialized = JSON.stringify(row);
        for (const secret of secrets) {
          expect(serialized, `table ${table} carries secret material`).not.toContain(secret);
        }
      }
    }
  });
});

/** One recorded mutating statement (the SECRET-SCAN probe). */
interface RecordedWrite {
  sql: string;
  params: readonly unknown[];
}

/** Wrap an adapter, recording every mutating statement — SECURITY §3's
 * "no secrets in SQLite" invariant asserted against the exact params the
 * store would have persisted. */
function recordingAdapter(inner: MemoryAdapter): StorageAdapter & { writes: RecordedWrite[] } {
  const writes: RecordedWrite[] = [];
  return {
    writes,
    transaction: (fn) => inner.transaction(fn),
    run: (sql, params) => {
      writes.push({ sql, params: params ?? [] });
      inner.run(sql, params);
    },
    all: (sql, params) => inner.all(sql, params),
    get: (sql, params) => inner.get(sql, params),
  };
}
