import type { HttpPort } from "../sync/http-port";
import { ACTIVE_DEVICE_ID_KEY, secureStoreNames, type SecureStorePort } from "./secure-store-port";
import { deviceApiRequest, devicePath, errorCodeFromBody, MobileAuthHttpError } from "./device-api";

/**
 * PHASE-022 · the rotating refresh-token exchange (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §7; SECURITY_AND_DEVICE_MANAGEMENT §3 + §4; ADR-0015 §3)
 * — the `@erp/desktop` rotation contract ported onto the HttpPort seam:
 *
 * - POST `/api/v1/devices/:id/refresh` is PUBLIC (route-permissions
 *   PUBLIC_ROUTES — the login pattern: the one-time-use refresh token
 *   in the body IS the credential, no session can exist before
 *   credentials rotate). The server rotates on EVERY exchange: the
 *   presented token is marked used and a successor is minted.
 * - The CLIENT contract (the desktop session's, verbatim): persist the
 *   successor token to the vault BEFORE resolving — a caller that
 *   forgets dooms the NEXT exchange to present a consumed token.
 * - **Reuse detection (the theft signal, M-05 / ADR-0015 §3):**
 *   presenting a token the server has already rotated (or that is
 *   otherwise unknown/expired) answers 401 with the ERROR_MODEL code
 *   `DEVICE_REFRESH_INVALID` (error.filter.ts's device mapping) — and
 *   the server REVOKES the device + raises the reuse alarm. A 403
 *   `DEVICE_REVOKED` is the kill switch that already fired. Both are
 *   terminal for the local credential: {@link wipeDeviceCredentials}
 *   empties the vault (refresh token + device keys + the active-device
 *   pointer) and {@link ReLoginRequiredError} surfaces the re-login
 *   path (the D-01 consumer completes it with the store purge —
 *   device/registration.ts).
 *
 * Network-level failures (the port's own throw — offline/DNS/timeout)
 * propagate WITHOUT wiping: the token might still be perfectly valid;
 * the next trigger retries (the desktop session's honest distinction
 * between a failed exchange and a dead credential).
 */

/** The rotation envelope (device-tokens.ts's RefreshRotation shape —
 * field-for-field what POST /:id/enroll bootstrap returns, so the
 * client treats bootstrap and rotation identically). */
export interface RefreshRotation {
  /** The successor one-time-use refresh token (30-day window). */
  refreshToken: string;
  /** A fresh 15-min device access token (HS256 JWT — memory-only). */
  accessToken: string;
  /** The access token's expiry (ISO — the session schedules on it). */
  expiresAt: string;
  /** The successor refresh token's 30-day absolute window (ISO). */
  refreshTokenExpiresAt: string;
}

/** Why the local credential died and re-login is required. */
export type ReLoginReason =
  /** 401 DEVICE_REFRESH_INVALID on a token we believed current — reuse
   * (theft): the server already revoked the device (M-05). */
  | "REUSE_DETECTED"
  /** 403 DEVICE_REVOKED — the kill switch (admin/self/operator revoke
   * path, or the server-side reuse revocation beat us to it). */
  | "DEVICE_REVOKED";

/**
 * The terminal D-01 class: the local credential is dead (wiped), the
 * device is flagged server-side, and the only way forward is re-login
 * + re-enrollment. Thrown by {@link rotateDeviceRefreshToken} AFTER
 * the vault was wiped; the session's onRotationFailure hook receives
 * it as `failure.error` and the shell routes to the re-login screen.
 */
export class ReLoginRequiredError extends Error {
  readonly code = "DEVICE_RELOGIN_REQUIRED" as const;
  readonly reason: ReLoginReason;
  /** Always true — the vault entry is gone before this throws. */
  readonly credentialsWiped: boolean;

  constructor(reason: ReLoginReason, detail: string) {
    super(
      `device credential rejected (${reason}) — local credentials wiped, re-login required: ${detail}`,
    );
    this.name = "ReLoginRequiredError";
    this.reason = reason;
    this.credentialsWiped = true;
  }
}

/** Options for the exchange + the wipe. */
export interface RefreshOptions {
  /** The fetch-like seam (2-a's HttpPort — the ONLY network surface). */
  readonly http: HttpPort;
  /** API origin, e.g. `https://api.erp.example`. */
  readonly baseUrl: string;
  /** The enrolled device id (the route path + the vault namespace). */
  readonly deviceId: string;
  /** The credential vault. */
  readonly secureStore: SecureStorePort;
}

/**
 * Wipe every device credential from the vault (D-01 / the reuse
 * signal): the refresh token, the device keypair record, and the
 * active-device pointer. Idempotent; the SQLCipher dbKey is DELIBERATELY
 * KEPT (the store's at-rest key outlives the credential purge — the
 * corruption drill may still need to read staged survivors; a fresh
 * enrollment reuses the same DB key).
 */
export async function wipeDeviceCredentials(
  secureStore: SecureStorePort,
  deviceId: string,
): Promise<void> {
  const names = secureStoreNames(deviceId);
  await secureStore.deleteItem(names.refreshToken);
  await secureStore.deleteItem(names.devicePrivateKey);
  await secureStore.deleteItem(names.deviceKey);
  await secureStore.deleteItem(ACTIVE_DEVICE_ID_KEY);
}

/** Classify a non-2xx refresh response into the re-login reason, or
 * null when the status is not credential-terminal (retryable). */
function classifyCredentialRejection(error: MobileAuthHttpError): ReLoginReason | null {
  if (error.status === 401 && error.code === "DEVICE_REFRESH_INVALID") {
    return "REUSE_DETECTED";
  }
  if (error.status === 403 && error.code === "DEVICE_REVOKED") {
    return "DEVICE_REVOKED";
  }
  return null;
}

/**
 * One rotation: read the current refresh token from the vault, exchange
 * it (PUBLIC route — credential in body, no Authorization header), and
 * persist the successor BEFORE resolving (the client contract). On a
 * credential-terminal rejection (401 DEVICE_REFRESH_INVALID — reuse of
 * a rotated token, the theft signal; 403 DEVICE_REVOKED — the kill
 * switch) the vault is wiped and {@link ReLoginRequiredError} throws.
 * Any OTHER non-2xx surfaces as {@link MobileAuthHttpError} (no wipe —
 * e.g. a 404 DeviceNotFound is a server-side data issue the shell must
 * see raw); network failures propagate untouched.
 *
 * Wires straight into `MobileSession`:
 * `refresh: (token) => rotateDeviceRefreshToken({ ...opts, presented: token })`
 * — or call without `presented` to let the vault be read.
 */
export async function rotateDeviceRefreshToken(
  options: RefreshOptions & {
    /** The token to present — defaults to the vault's current entry
     * (the session passes its own read; the two must agree). */
    readonly presented?: string;
  },
): Promise<RefreshRotation> {
  const refreshToken =
    options.presented ?? (await options.secureStore.getItem(secureStoreNames(options.deviceId).refreshToken));
  if (refreshToken === null || refreshToken === "") {
    // No credential at all (never enrolled / already purged — the D-01
    // end state). NOT a rejection: nothing was presented, so nothing
    // was revoked — a plain loud error (the session surfaces its own
    // NO_CREDENTIAL kind before ever reaching here).
    throw new Error(
      "rotateDeviceRefreshToken: no refresh token in the vault — the device was never " +
        "enrolled or its credentials were already purged (D-01)",
    );
  }

  let rotation: RefreshRotation;
  try {
    rotation = await deviceApiRequest<RefreshRotation>(options.http, options.baseUrl, {
      method: "POST",
      path: devicePath(options.deviceId, "/refresh"),
      body: { refreshToken },
    });
  } catch (error) {
    if (error instanceof MobileAuthHttpError) {
      const reason = classifyCredentialRejection(error);
      if (reason !== null) {
        // THEFT SIGNAL / kill switch: the server already revoked (the
        // 401/403 IS the revocation answer) — wipe the vault, flag the
        // device state, surface re-login (ADR-0015 §3; the desktop
        // behavior ported).
        await wipeDeviceCredentials(options.secureStore, options.deviceId);
        throw new ReLoginRequiredError(reason, error.message);
      }
    }
    throw error;
  }

  // Client contract: persist the successor BEFORE resolving. A crash
  // between the server's rotation and this write loses the chain (the
  // token was consumed server-side) — that state is the honest
  // DEVICE_REFRESH_INVALID on next boot, indistinguishable from theft
  // by design (fail closed, SECURITY §3).
  await options.secureStore.setItem(
    secureStoreNames(options.deviceId).refreshToken,
    rotation.refreshToken,
  );
  return rotation;
}

/** Extract the ERROR_MODEL code from an arbitrary error's body when it
 * is a {@link MobileAuthHttpError} (the shell's logging/classification
 * helper — codes, never secret material). */
export function authErrorCode(error: unknown): string | null {
  if (error instanceof MobileAuthHttpError) {
    return error.code ?? errorCodeFromBody(error.body);
  }
  return null;
}
