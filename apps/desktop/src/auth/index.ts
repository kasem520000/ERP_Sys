/**
 * PHASE-021 · the desktop auth surface (T3; MASTER-PLAN §2/§4):
 *
 * - `keychain.ts` — the credential-vault seam + MemoryKeychain + the
 *   `erp.<deviceId>.*` namespace (SECURITY_AND_DEVICE_MANAGEMENT §3);
 * - `enroll.ts` — the transport-agnostic first-run orchestrator
 *   (register → attest → enroll → keychain; DR-P21-01);
 * - `session.ts` — the memory-only 15-min access-token manager with the
 *   expiry−60 s silent refresh + the D-01 rotation-failure hook;
 * - `unlock.ts` — the offline unlock decision against the cached
 *   permission snapshot + the 7-day D-04 watermark.
 *
 * The W2 sync host consumes this barrel; apps/web's shell bridge re-exports
 * the browser-safe subset (keychain types + unlock) for the Offline
 * Console's capability gates.
 */
export {
  type Keychain,
  type KeychainNames,
  MemoryKeychain,
  keychainNames,
} from "./keychain";
export {
  type DesktopEnrolledCredentials,
  type DesktopRegistration,
  type DeviceKeyPair,
  type EnrollDesktopDeviceInput,
  type EnrollDesktopDeviceResult,
  enrollDesktopDevice,
} from "./enroll";
export {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  DesktopSession,
  type DesktopSessionOptions,
  type RotationFailure,
  type SessionRefreshResult,
} from "./session";
export {
  SNAPSHOT_WATERMARK_MS,
  applyPermissionSnapshotPayload,
  applyPermissionSnapshotRows,
  type PermissionSnapshotPayload,
  type UnlockDecision,
  unlockWithSnapshot,
} from "./unlock";
