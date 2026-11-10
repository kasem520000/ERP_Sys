/**
 * PHASE-022 · the @erp/mobile auth surface (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §2 package layout / §7):
 *
 * - `secure-store-port.ts` — the credential-vault seam (Android
 *   Keystore on device; in-memory fake in tests) + the
 *   `erp.<deviceId>.*` namespace (SECURITY_AND_DEVICE_MANAGEMENT §3);
 * - `crypto-port.ts` — the Ed25519 device-keypair seam + the REAL
 *   node:crypto driver (tests + the W3 harness; the desktop auth
 *   precedent — the verifier is never mocked);
 * - `device-api.ts` — the shared devices-registry request core (the
 *   `{ data, meta }` envelope, the ERROR_MODEL codes, typed errors);
 * - `enroll.ts` — the register → attest → enroll orchestrator over the
 *   HttpPort (DR-P21-01 adapted per DR-P22-09);
 * - `session.ts` — the memory-only 15-min access-token manager with
 *   the expiry−60 s silent refresh + the D-01 rotation-failure hook +
 *   the AccessTokenProvider adapter for 2-a's transport;
 * - `refresh.ts` — the rotating refresh-token exchange with REUSE
 *   DETECTION (a 401 DEVICE_REFRESH_INVALID on a rotated token = theft
 *   → vault wipe + re-login; ADR-0015 §3);
 * - `unlock.ts` — the biometric-gate state machine (biometric optional
 *   + PIN fallback with the wrong-PIN ladder).
 *
 * The native shell (native/App.tsx) + the W3 chaos harness (3-a)
 * consume this barrel; the device area (src/device) composes it.
 */

export {
  type SecureStorePort,
  type SecureStoreNames,
  MemorySecureStore,
  ACTIVE_DEVICE_ID_KEY,
  secureStoreNames,
} from "./secure-store-port";
export {
  type CryptoPort,
  type DeviceKeypair,
  NodeCryptoDriver,
  verifyEd25519Signature,
} from "./crypto-port";
export {
  DEVICES_BASE_PATH,
  MobileAuthHttpError,
  MobileAuthResponseError,
  devicePath,
  deviceApiRequest,
  errorCodeFromBody,
  type DeviceApiRequest,
} from "./device-api";
export {
  type EnrollMobileDeviceInput,
  type EnrollMobileDeviceResult,
  type DeviceRegistrationRequest,
  type MobileRegistration,
  type MobileEnrolledCredentials,
  buildRegistrationBody,
  capabilitiesForDeviceClass,
  enrollMobileDevice,
} from "./enroll";
export {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  MobileSession,
  accessTokenProvider,
  type MobileSessionOptions,
  type RotationFailure,
  type SessionRefreshResult,
} from "./session";
export {
  ReLoginRequiredError,
  authErrorCode,
  rotateDeviceRefreshToken,
  wipeDeviceCredentials,
  type RefreshOptions,
  type RefreshRotation,
  type ReLoginReason,
} from "./refresh";
export {
  DEFAULT_MAX_PIN_ATTEMPTS,
  UnlockGate,
  type UnlockAttemptResult,
  type UnlockFailureReason,
  type UnlockGateOptions,
  type UnlockPhase,
  type UnlockPort,
} from "./unlock";
