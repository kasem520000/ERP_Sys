import type { MobileDeviceClass, MobileStore } from "../store/store";
import { purgeOnRevocation, type PurgeReport } from "../sync/revocation";
import type { HttpPort } from "../sync/http-port";
import { enrollMobileDevice, type EnrollMobileDeviceResult } from "../auth/enroll";
import type { CryptoPort } from "../auth/crypto-port";
import type { SecureStorePort } from "../auth/secure-store-port";
import { wipeDeviceCredentials } from "../auth/refresh";
import { reportTrustSignals, type TrustReportOutcome, type TrustSignals, type TrustSignalsPort } from "./trust";

/**
 * PHASE-022 · the device-registration orchestrator + the D-01 revoke
 * flow client (T2-b; MASTER-PLAN §1 DR-P22-09 + §7 + §11 row 2-b;
 * SECURITY_AND_DEVICE_MANAGEMENT §4 + §6.2; SECURITY_TEST_PLAN D-01 —
 * "pushes rejected DEVICE_REVOKED; pulls return revocation; queued
 * local data wiped on next contact").
 *
 * `registerMobileDevice` glues the enrollment journey (auth/enroll.ts)
 * with the trust-signal plane (device/trust.ts) and the capability
 * negotiation (the class labels from constants — the register body;
 * the returned contractVersion is the C-08 gate input the sync host
 * compares on every cycle).
 *
 * `handleDeviceRevocation` / `deviceRevocationHandler` are the D-01
 * client the shell wires into `MobileSyncHost`'s `onRevocation` hook:
 * on DEVICE_REVOKED from ANY sync call — stop presenting credentials
 * (session clear FIRST), purge the local store via 2-a's
 * `purgeOnRevocation` (the "queued data purged on next contact"
 * behavior), wipe the vault (auth/refresh.ts), and surface the
 * re-login UX state (§6.2: "purge local tenant data (outbox included)
 * and require online re-login").
 */

/** The orchestrator input (enrollMobileDevice's input + the trust
 * plane + the report callback). */
export interface RegisterMobileDeviceInput {
  readonly http: HttpPort;
  readonly baseUrl: string;
  readonly secureStore: SecureStorePort;
  readonly crypto: CryptoPort;
  readonly deviceClass: MobileDeviceClass;
  readonly deviceName: string;
  readonly appVersion: string;
  readonly platformVersion?: string;
  /** Personal class: the customer-portal partner link (enroll.ts's
   * honest server-reality note applies). */
  readonly linkedPartnerId?: string;
  /** The register/attest Authorization value (the logged-in portal /
   * app identity — SECURITY §2.1). */
  readonly registerAuthorization: string;
  /** Optional trust-signal source: when provided, signals are
   * collected and reported best-effort right after a SUCCESSFUL
   * enrollment (DR-P22-09; D-07 — a failed report never fails
   * registration). */
  readonly trust?: TrustSignalsPort;
  /** Receives the trust-report outcome (the honest-state surface for
   * the shell's logging; reported:false outcomes included). */
  readonly onTrustReport?: (outcome: TrustReportOutcome) => void;
}

/** The orchestrated registration result (the enrollment outcome + the
 * best-effort trust report). */
export interface RegisterMobileDeviceResult extends EnrollMobileDeviceResult {
  /** The post-enrollment trust-signal report's outcome (absent when no
   * TrustSignalsPort was provided). */
  readonly trustReport?: TrustReportOutcome;
}

/**
 * The full first-run registration: enroll (keypair → register under
 * the logged-in identity → attest → the one-time-secret exchange →
 * vault) + the post-enrollment trust-signal report (best-effort —
 * D-07: a rejected/failed report is surfaced through `onTrustReport`
 * and NEVER fails the registration; the flags also ride the sync
 * status response's `device.trustFlags` for the admin plane).
 *
 * The returned `contractVersion` is the capability-negotiation verdict
 * (the C-08 gate input); `accessToken` primes the MobileSession
 * (memory-only).
 */
export async function registerMobileDevice(
  input: RegisterMobileDeviceInput,
): Promise<RegisterMobileDeviceResult> {
  const enrolled: EnrollMobileDeviceResult = await enrollMobileDevice({
    http: input.http,
    baseUrl: input.baseUrl,
    secureStore: input.secureStore,
    crypto: input.crypto,
    deviceClass: input.deviceClass,
    deviceName: input.deviceName,
    appVersion: input.appVersion,
    ...(input.platformVersion !== undefined ? { platformVersion: input.platformVersion } : {}),
    ...(input.linkedPartnerId !== undefined ? { linkedPartnerId: input.linkedPartnerId } : {}),
    registerAuthorization: input.registerAuthorization,
  });

  if (input.trust === undefined) {
    return enrolled;
  }

  // Best-effort trust report under the FRESH device access token (the
  // strongest credential the app holds at this moment; the route's
  // permission guard may still answer 403 — an honest reported:false).
  let signals: TrustSignals;
  try {
    signals = await input.trust.collectTrustSignals();
  } catch {
    // Signal COLLECTION is best-effort too (a probe that throws on an
    // exotic device never blocks registration — D-07).
    const outcome: TrustReportOutcome = { reported: false, reason: "network-error" };
    input.onTrustReport?.(outcome);
    return { ...enrolled, trustReport: outcome };
  }
  const trustReport = await reportTrustSignals(input.http, input.baseUrl, enrolled.deviceId, signals, {
    authorization: `Bearer ${enrolled.accessToken}`,
  });
  input.onTrustReport?.(trustReport);
  return { ...enrolled, trustReport };
}

/** The D-01 revocation input. */
export interface DeviceRevocationInput {
  /** An OPEN mobile store (either profile — purgeOnRevocation derives
   * the table list from `store.deviceClass`). */
  readonly store: MobileStore;
  /** The credential vault (wiped). */
  readonly secureStore: SecureStorePort;
  /** The revoked device id (the vault namespace). */
  readonly deviceId: string;
  /** The memory session (cleared FIRST — stop presenting credentials
   * before anything else happens). */
  readonly session?: { clear(): void };
}

/** The D-01 outcome — the re-login UX state (§6.2: purge + require
 * online re-login; the screens wave renders this). */
export interface DeviceRevocationOutcome {
  readonly requiresReLogin: true;
  readonly reason: "DEVICE_REVOKED";
  /** 2-a's purge report (per-table counts — never a silent wipe). */
  readonly purged: PurgeReport;
  /** The vault's device credentials were wiped (refresh token +
   * keypair record + the active-device pointer). */
  readonly credentialsWiped: boolean;
  /** The memory session was cleared (false when no session was
   * provided — the shell clears its own). */
  readonly sessionCleared: boolean;
  /** When the purge ran (ISO). */
  readonly at: string;
}

/**
 * The D-01 revoke flow: session clear → store purge (2-a's
 * `purgeOnRevocation` — outbox + inbox + read models per profile, one
 * transaction, the honest per-table report) → vault wipe (refresh
 * token + device keys; the SQLCipher key stays for the corruption
 * drill) → the re-login state. Order matters: the session clears
 * FIRST so no in-flight code re-presents the dead credential; the
 * purge is the audited data removal; the wipe is last so a failure in
 * either earlier step still leaves the terminal state visible.
 */
export async function handleDeviceRevocation(
  input: DeviceRevocationInput,
): Promise<DeviceRevocationOutcome> {
  input.session?.clear();
  const purged = purgeOnRevocation(input.store);
  await wipeDeviceCredentials(input.secureStore, input.deviceId);
  return {
    requiresReLogin: true,
    reason: "DEVICE_REVOKED",
    purged,
    credentialsWiped: true,
    sessionCleared: input.session !== undefined,
    at: new Date().toISOString(),
  };
}

/** The shape of `MobileSyncHost`'s `onRevocation` hook payload (2-a's
 * RevocationDetection — the source, device/…/host.ts). */
export interface RevocationDetectionInput {
  readonly source: string;
  readonly at: string;
  readonly detail: string;
}

/**
 * The `onRevocation` handler factory: wires {@link handleDeviceRevocation}
 * into `MobileSyncHost`'s options (`onRevocation: deviceRevocationHandler(
 * { store, secureStore, deviceId, session })`) — the D-01 path from ANY
 * sync call (revoked status, DEVICE_REVOKED rejection, an expired
 * dataExpiresAt).
 */
export function deviceRevocationHandler(
  deps: DeviceRevocationInput,
): (detection: RevocationDetectionInput) => Promise<DeviceRevocationOutcome> {
  return async (_detection: RevocationDetectionInput) => handleDeviceRevocation(deps);
}
