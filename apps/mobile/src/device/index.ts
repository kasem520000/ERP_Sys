/**
 * PHASE-022 · the @erp/mobile device surface (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §2 package layout / §7):
 *
 * - `trust.ts` — the best-effort rooted/tamper signal plane (the
 *   TrustSignalsPort, the devices.trustFlags PATCH surfacing, and the
 *   D-07 POLICY: flagged → online-only until admin ack, degrade never
 *   brick);
 * - `watermark.ts` — the 7-day permission-snapshot watermark policy
 *   (the desktop application ported) + the writePolicy gate (beyond
 *   the window: read-only + online-required-for-writes, the as-of
 *   label for the UI; the snapshot gates UI only, server enforcement
 *   is final);
 * - `registration.ts` — the registration orchestrator (enroll + trust
 *   + capability negotiation) + the D-01 revoke flow client (purge via
 *   2-a's purgeOnRevocation + vault wipe + the re-login UX state);
 * - `secure-screen.ts` — the financial-screens screenshot policy (the
 *   SecureScreenPort + the FINANCIAL_SCREENS list);
 * - `drivers-registry.ts` — the port-name → implementation registry
 *   (the native App injects real drivers; tests inject fakes).
 *
 * Consumed through `@erp/mobile`'s root barrel by the native shell,
 * the screens waves (2-e/3-b), and the W3 chaos harness (3-a).
 */

export {
  type TrustSignals,
  type TrustSignalsPort,
  type TrustFlagsPatch,
  type TrustReportOutcome,
  type TrustPolicyMode,
  type OnlineWriteGate,
  adminAckedAtFromTrustFlags,
  isTrustFlagged,
  onlineWriteGate,
  reportTrustSignals,
  trustPolicy,
  trustSignalsToFlags,
} from "./trust";
export {
  SNAPSHOT_WATERMARK_MS,
  type PermissionWatermarkState,
  type OfflineWritePolicy,
  canWriteOffline,
  offlineWritePolicy,
  permissionWatermarkState,
  writePermissionWatermark,
} from "./watermark";
export {
  type RegisterMobileDeviceInput,
  type RegisterMobileDeviceResult,
  type DeviceRevocationInput,
  type DeviceRevocationOutcome,
  type RevocationDetectionInput,
  deviceRevocationHandler,
  handleDeviceRevocation,
  registerMobileDevice,
} from "./registration";
export {
  FINANCIAL_SCREENS,
  type SecureScreenOutcome,
  type SecureScreenPort,
  applySecureScreenPolicy,
  isFinancialScreen,
} from "./secure-screen";
export {
  type MobileDrivers,
  type MobileDriverName,
  createMobileDriverRegistry,
} from "./drivers-registry";
