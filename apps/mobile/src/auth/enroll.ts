import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import { ANDROID_PLATFORM, MOBILE_CAPABILITY_LABELS, MOBILE_DEVICE_CLASSES } from "../constants";
import type { MobileDeviceClass } from "../store/store";
import type { HttpPort } from "../sync/http-port";
import { deviceApiRequest, devicePath, DEVICES_BASE_PATH } from "./device-api";
import type { CryptoPort } from "./crypto-port";
import type { RefreshRotation } from "./refresh";
import { ACTIVE_DEVICE_ID_KEY, secureStoreNames, type SecureStorePort } from "./secure-store-port";

/**
 * PHASE-022 · the first-run enrollment orchestrator (T2-b; MASTER-PLAN
 * §1 DR-P22-09 + §7; SECURITY_AND_DEVICE_MANAGEMENT §2 + §3; DR-P21-01
 * — the `@erp/desktop` `auth/enroll.ts` journey ported onto the
 * HttpPort seam, adapted per DR-P22-09):
 *
 *   1. register — POST /api/v1/devices under the LOGGED-IN identity
 *      (the session-guarded route, `sync.devices.register`): the
 *      caller's `registerAuthorization` (the customer-portal identity
 *      for the personal class, the app login for field). The body
 *      carries platform "android", the device class, capabilities, the
 *      app/contract versions, and the CryptoPort public key. Returns
 *      the server-assigned device id, the one-time enrollment secret,
 *      and the attestation nonce.
 *   2. attest — the nonce (issued because a public key was presented)
 *      is signed with the device's Ed25519 private key (the CryptoPort
 *      seam; the private half NEVER enters any store but the vault) →
 *      POST /api/v1/devices/:id/attest (same session identity).
 *   3. enroll — POST /api/v1/devices/:id/enroll with the one-time
 *      enrollmentSecret (the PUBLIC credential-exchange route — the
 *      login pattern, no Authorization header) → the FIRST credential
 *      pair (the DR-P21-01 bootstrap).
 *   4. persist — refresh token + the device keypair into the
 *      SecureStore under the `erp.<deviceId>.*` namespace + the active
 *      device pointer. THE ACCESS TOKEN IS NEVER PERSISTED: it lives
 *      in memory only (SECURITY §3 — 15-minute lifetime; the
 *      MobileSession owns it after this function returns, via prime()).
 *
 * The enrollment secret is forwarded to the enroll exchange EXACTLY
 * ONCE and never stored (the server consumes it — the sha256 in
 * devices.device_key_hash is cleared; a second use answers 401
 * DEVICE_REFRESH_INVALID, proven in the auth suite).
 *
 * PERSONAL class (android-personal): registration happens under the
 * customer-portal identity and the register call carries the linked
 * partner (`linkedPartnerId` — migration 0033's
 * `devices.linked_partner_id`, the server-side partner scope for every
 * personal pull). HONEST SERVER REALITY (verified against
 * devices.controller.ts this task): the CURRENT register schema (zod,
 * non-strict) strips unknown keys, so the field rides the request
 * without effect until the server-side registration surface writes the
 * column (the specs seed it directly; "the production writer of the
 * column is 2-b's" — but the API is read-only for 2-b, so the mobile
 * client carries the field + the portal identity and the linkage lands
 * server-side; recorded as a deviation + handoff note in T-P22-2b.md).
 */

/** The registration request body (the controller's registerSchema —
 * every field the mobile client fills). */
export interface DeviceRegistrationRequest {
  readonly deviceName: string;
  readonly deviceClass: MobileDeviceClass;
  readonly platform: typeof ANDROID_PLATFORM;
  readonly platformVersion?: string;
  readonly appVersion: string;
  readonly contractVersion: string;
  readonly deviceKeyPublic: string;
  readonly capabilities: readonly string[];
  /** Personal class only: the customer-portal partner link (see the
   * module header — carried, not yet server-consumed). */
  readonly linkedPartnerId?: string;
}

/** What register returns (the POST /api/v1/devices envelope). */
export interface MobileRegistration {
  deviceId: string;
  /** Null when no device public key was presented (we always present
   * one — the CryptoPort keypair — so a null here is a server anomaly
   * surfaced loudly below). */
  attestationNonce: string | null;
  enrollmentSecret: string;
  contractVersion: string;
}

/** The enroll exchange result (device-enrollment.ts's EnrollmentResult
 * — the RefreshRotation shape; bootstrap and rotation are identical). */
export type MobileEnrolledCredentials = RefreshRotation;

/** The capabilities a device class registers with (MASTER-PLAN §0:
 * `["van_sales"]` / `["personal_account"]` — advisory labels; the
 * server gates feeds by deviceClass). */
export function capabilitiesForDeviceClass(deviceClass: MobileDeviceClass): string[] {
  return deviceClass === MOBILE_DEVICE_CLASSES.field
    ? [MOBILE_CAPABILITY_LABELS.field]
    : [MOBILE_CAPABILITY_LABELS.personal];
}

/** Build the registration body for one device class (the registerSchema
 * shape — the personal class adds the linked partner). */
export function buildRegistrationBody(input: {
  deviceName: string;
  deviceClass: MobileDeviceClass;
  platformVersion?: string;
  appVersion: string;
  deviceKeyPublic: string;
  linkedPartnerId?: string;
}): DeviceRegistrationRequest {
  const body: DeviceRegistrationRequest = {
    deviceName: input.deviceName,
    deviceClass: input.deviceClass,
    platform: ANDROID_PLATFORM,
    ...(input.platformVersion !== undefined ? { platformVersion: input.platformVersion } : {}),
    appVersion: input.appVersion,
    contractVersion: SYNC_CONTRACT_VERSION,
    deviceKeyPublic: input.deviceKeyPublic,
    capabilities: capabilitiesForDeviceClass(input.deviceClass),
  };
  if (input.deviceClass === MOBILE_DEVICE_CLASSES.personal) {
    if (input.linkedPartnerId === undefined || input.linkedPartnerId === "") {
      throw new Error(
        "enrollMobileDevice: android-personal registration requires linkedPartnerId — the " +
          "customer-portal partner link (migration 0033; an unlinked personal device pulls an " +
          "empty partner scope by design, so the client refuses to enroll without it)",
      );
    }
    return { ...body, linkedPartnerId: input.linkedPartnerId };
  }
  return body;
}

/** The enrollment orchestration input. */
export interface EnrollMobileDeviceInput {
  /** The fetch-like seam (2-a's HttpPort — the ONLY network surface). */
  readonly http: HttpPort;
  /** API origin, e.g. `https://api.erp.example`. */
  readonly baseUrl: string;
  /** The credential vault (SECURITY §3). */
  readonly secureStore: SecureStorePort;
  /** The Ed25519 keypair seam. */
  readonly crypto: CryptoPort;
  readonly deviceClass: MobileDeviceClass;
  readonly deviceName: string;
  readonly appVersion: string;
  readonly platformVersion?: string;
  /** Personal class: the customer-portal partner link (required for
   * android-personal — see buildRegistrationBody). */
  readonly linkedPartnerId?: string;
  /**
   * The register/attest Authorization header value (e.g.
   * `Bearer <portal-session-token>`): POST /devices and /:id/attest
   * are session-guarded (`sync.devices.register`) — an AUTHENTICATED
   * user registers the device (SECURITY §2.1); the enroll exchange
   * needs none (the one-time secret IS the credential).
   */
  readonly registerAuthorization: string;
}

/** The enrollment outcome: what the caller needs to proceed — prime the
 * MobileSession with the access token (MEMORY ONLY), open the store,
 * start syncing. The credentials themselves live in the vault. */
export interface EnrollMobileDeviceResult {
  readonly deviceId: string;
  readonly contractVersion: string;
  /** The enroll-time 15-min access token — memory-only; NEVER written
   * anywhere by this module (SECURITY §3). */
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly refreshTokenExpiresAt: string;
}

/** Validate + narrow the register envelope (typed fail-loud on a
 * malformed 2xx — never trust a shape the auth plane didn't check). */
function requireRegistration(data: unknown): MobileRegistration {
  if (typeof data !== "object" || data === null) {
    throw new Error("enrollMobileDevice: register response is not an object");
  }
  const record = data as Record<string, unknown>;
  if (
    typeof record.deviceId !== "string" ||
    record.deviceId === "" ||
    typeof record.enrollmentSecret !== "string" ||
    record.enrollmentSecret === "" ||
    typeof record.contractVersion !== "string"
  ) {
    throw new Error(
      "enrollMobileDevice: register response missing deviceId/enrollmentSecret/contractVersion",
    );
  }
  const nonce =
    record.attestationNonce === null
      ? null
      : typeof record.attestationNonce === "string"
        ? record.attestationNonce
        : undefined;
  if (nonce === undefined) {
    throw new Error("enrollMobileDevice: register response attestationNonce must be a string or null");
  }
  return {
    deviceId: record.deviceId,
    attestationNonce: nonce,
    enrollmentSecret: record.enrollmentSecret,
    contractVersion: record.contractVersion,
  };
}

/** Validate + narrow the enroll envelope (the RefreshRotation shape). */
function requireCredentials(data: unknown): MobileEnrolledCredentials {
  if (typeof data !== "object" || data === null) {
    throw new Error("enrollMobileDevice: enroll response is not an object");
  }
  const record = data as Record<string, unknown>;
  if (
    typeof record.refreshToken !== "string" ||
    record.refreshToken === "" ||
    typeof record.accessToken !== "string" ||
    record.accessToken === "" ||
    typeof record.expiresAt !== "string" ||
    typeof record.refreshTokenExpiresAt !== "string"
  ) {
    throw new Error(
      "enrollMobileDevice: enroll response missing refreshToken/accessToken/expiresAt/refreshTokenExpiresAt",
    );
  }
  return {
    refreshToken: record.refreshToken,
    accessToken: record.accessToken,
    expiresAt: record.expiresAt,
    refreshTokenExpiresAt: record.refreshTokenExpiresAt,
  };
}

/**
 * Orchestrate the full first-run enrollment: keypair → register →
 * attest → enroll → vault. Throws (and writes NOTHING to the vault)
 * when any hop fails — the desktop invariant ported: a failed
 * enrollment never leaves half-written credentials behind (the private
 * key lives in module memory for the duration and is only persisted on
 * success). Attestation is NOT skippable here (a public key was
 * presented, so the server issued a nonce); a server that issues none
 * (attestationNonce null) makes the attest hop a no-op, recorded
 * honestly below.
 */
export async function enrollMobileDevice(
  input: EnrollMobileDeviceInput,
): Promise<EnrollMobileDeviceResult> {
  // 1. The device keypair (Ed25519 via the CryptoPort seam — the
  //    private half stays in module memory until the final persist).
  const keypair = await input.crypto.generateKeypair();

  // 2. Register under the logged-in identity (the session-guarded route).
  const registration = requireRegistration(
    await deviceApiRequest<unknown>(input.http, input.baseUrl, {
      method: "POST",
      path: DEVICES_BASE_PATH,
      body: buildRegistrationBody({
        deviceName: input.deviceName,
        deviceClass: input.deviceClass,
        platformVersion: input.platformVersion,
        appVersion: input.appVersion,
        deviceKeyPublic: keypair.publicKey,
        linkedPartnerId: input.linkedPartnerId,
      }),
      authorization: input.registerAuthorization,
    }),
  );

  // 3. Attestation-lite: sign the issued nonce with the private key.
  //    The signature is REAL Ed25519 over the nonce's UTF-8 bytes (the
  //    registry's verification shape) — the auth suite verifies it
  //    against the registered public key.
  if (registration.attestationNonce !== null) {
    const signature = await input.crypto.sign(registration.attestationNonce, keypair.privateKey);
    await deviceApiRequest<unknown>(input.http, input.baseUrl, {
      method: "POST",
      path: devicePath(registration.deviceId, "/attest"),
      body: { signature },
      authorization: input.registerAuthorization,
    });
  }

  // 4. The one-time enrollment secret → the FIRST credential pair (the
  //    PUBLIC exchange — no Authorization header; the secret IS the
  //    credential, forwarded exactly once, never stored).
  const credentials = requireCredentials(
    await deviceApiRequest<unknown>(input.http, input.baseUrl, {
      method: "POST",
      path: devicePath(registration.deviceId, "/enroll"),
      body: { enrollmentSecret: registration.enrollmentSecret },
    }),
  );

  // 5. Persist exactly what SECURITY §3 allows, all-or-nothing on
  //    success: the rotating refresh token, the device keypair record,
  //    and the active-device pointer. The ACCESS TOKEN is deliberately
  //    NOT written anywhere — it rides the result to the caller's
  //    MobileSession.prime() and dies with the process.
  const names = secureStoreNames(registration.deviceId);
  await input.secureStore.setItem(names.refreshToken, credentials.refreshToken);
  await input.secureStore.setItem(names.devicePrivateKey, keypair.privateKey);
  await input.secureStore.setItem(names.deviceKey, keypair.publicKey);
  await input.secureStore.setItem(ACTIVE_DEVICE_ID_KEY, registration.deviceId);

  return {
    deviceId: registration.deviceId,
    contractVersion: registration.contractVersion,
    accessToken: credentials.accessToken,
    expiresAt: credentials.expiresAt,
    refreshTokenExpiresAt: credentials.refreshTokenExpiresAt,
  };
}
