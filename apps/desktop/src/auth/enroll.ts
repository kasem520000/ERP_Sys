import { keychainNames, type Keychain } from "./keychain";

/**
 * PHASE-021 · the first-run enrollment orchestrator (T3; MASTER-PLAN §4.1;
 * SECURITY_AND_DEVICE_MANAGEMENT §2 + §3; DR-P21-01 — the server side is
 * `POST /api/v1/devices/:id/enroll`).
 *
 * The transport-agnostic journey (every network call is a caller-injected
 * closure, so this module is unit-testable on plain Node and reusable from
 * any host — the Tauri shell, the sandbox harness, a future CLI):
 *
 *   1. register  — the caller's authenticated register call (session-auth'd
 *      by the logged-in user OR the web flow); returns the server-assigned
 *      device id, the one-time enrollment secret, and (when a device public
 *      key was presented) the attestation nonce.
 *   2. attest    — OPTIONAL (the caller provides BOTH the `attest` transport
 *      and the keypair): sign the nonce with the device's ed25519 private
 *      key. The caller provides the signing closure so the private key
 *      NEVER enters this module (it stays in the OS keychain / HSM behind
 *      the closure — SECURITY §3); skipped when no nonce was issued.
 *   3. enroll    — exchange the one-time enrollment secret for the device's
 *      FIRST credential pair (the DR-P21-01 bootstrap).
 *   4. persist   — refresh token + device key into the Keychain under the
 *      `erp.<deviceId>.*` namespace. The ACCESS TOKEN IS NEVER PERSISTED:
 *      it lives in memory only (SECURITY §3 — 15-minute lifetime; the
 *      DesktopSession owns it after this function returns). The SQLite
 *      encryption key (dbKey) is NOT touched here — the store opens before
 *      enrollment can ever run (the keychain entry is written by the store
 *      bootstrap, not the credential bootstrap).
 */

/** What register returns (the POST /api/v1/devices envelope; the nonce is
 * null when no device public key was presented — attestation is optional). */
export interface DesktopRegistration {
  deviceId: string;
  attestationNonce: string | null;
  enrollmentSecret: string;
  contractVersion: string;
}

/** What the enroll exchange returns (the POST /api/v1/devices/:id/enroll
 * envelope — the RefreshRotation shape; field-for-field identical to a
 * later refresh rotation, so the client treats bootstrap and rotation the
 * same). */
export interface DesktopEnrolledCredentials {
  refreshToken: string;
  accessToken: string;
  expiresAt: string;
  refreshTokenExpiresAt: string;
}

/** The device keypair seam: the caller holds the private key (OS keychain /
 * HSM) and exposes only the public half + a signing closure. `publicKey` is
 * the base64 the caller already registered (DER SPKI or raw 32-byte — the
 * server accepts both); `sign(nonce)` returns the base64 ed25519 signature
 * over the nonce's UTF-8 bytes (the registry's attest verification shape). */
export interface DeviceKeyPair {
  publicKey: string;
  sign: (nonce: string) => string;
}

/** The enrollment orchestration input: every network hop is a closure. */
export interface EnrollDesktopDeviceInput {
  /** The authenticated register call (POST /api/v1/devices). */
  register: () => Promise<DesktopRegistration>;
  /** The attestation call (POST /api/v1/devices/:id/attest). Optional —
   * when provided, a deviceKeyPair must be too (the signature is produced
   * from it); skipped silently when registration issued no nonce. */
  attest?: (signature: string) => Promise<unknown>;
  /** The credential bootstrap (POST /api/v1/devices/:id/enroll) — receives
   * the one-time enrollment secret. */
  enroll: (enrollmentSecret: string) => Promise<DesktopEnrolledCredentials>;
  /** The credential vault (SECURITY §3). */
  keychain: Keychain;
  /** The device keypair — optional (attestation-lite is best-effort). */
  deviceKeyPair?: DeviceKeyPair;
  /** The device id the caller is enrolling (the keychain namespace). Must
   * match the register response — a mismatch means the transports disagree
   * about which device they are enrolling, which would write credentials
   * under the WRONG namespace: that is a fail-loud bug, never a fallback. */
  deviceId: string;
}

/** The enrollment outcome: what the caller needs to proceed (the session
 * primes itself with the access token from the enroll result — see
 * DesktopSession.prime; the credentials themselves live in the keychain). */
export interface EnrollDesktopDeviceResult {
  deviceId: string;
  contractVersion: string;
}

/**
 * Orchestrate the full first-run enrollment: register → (attest) → enroll →
 * keychain. Never throws on skipped-optional steps (attestation is
 * best-effort); throws (and writes NOTHING to the keychain) when any
 * mandatory hop fails or the transports disagree about the device id.
 */
export async function enrollDesktopDevice(
  input: EnrollDesktopDeviceInput,
): Promise<EnrollDesktopDeviceResult> {
  const registration = await input.register();

  if (registration.deviceId !== input.deviceId) {
    throw new Error(
      `enrollDesktopDevice: register returned device id ${registration.deviceId} but the caller enrolled as ${input.deviceId} — the keychain namespace would be wrong; aborting before any credential was written`,
    );
  }

  // Optional attestation-lite: only when the caller wired the transport AND
  // the keypair AND the server issued a challenge. A keypair without an
  // attest transport (or vice versa) is a misconfiguration — fail loud
  // rather than silently skipping a step the caller clearly intended.
  if (input.attest !== undefined) {
    if (input.deviceKeyPair === undefined) {
      throw new Error(
        "enrollDesktopDevice: attest transport provided without a deviceKeyPair — the nonce signature cannot be produced",
      );
    }
    if (registration.attestationNonce !== null) {
      await input.attest(input.deviceKeyPair.sign(registration.attestationNonce));
    }
  }

  const credentials = await input.enroll(registration.enrollmentSecret);

  // Persist exactly what SECURITY §3 allows: the rotating refresh token +
  // the device key record. The deviceKey entry carries the PUBLIC half (the
  // identifying material this module sees); the PRIVATE half never entered
  // this module — it lives behind the caller's sign closure, in the OS
  // keychain. The access token is deliberately NOT written anywhere.
  const names = keychainNames(registration.deviceId);
  await input.keychain.set(names.refreshToken, credentials.refreshToken);
  if (input.deviceKeyPair !== undefined) {
    await input.keychain.set(names.deviceKey, input.deviceKeyPair.publicKey);
  }

  return { deviceId: registration.deviceId, contractVersion: registration.contractVersion };
}
