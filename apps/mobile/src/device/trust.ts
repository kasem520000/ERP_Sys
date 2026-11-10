import type { HttpPort } from "../sync/http-port";
import { deviceApiRequest, devicePath, MobileAuthHttpError } from "../auth/device-api";

/**
 * PHASE-022 · the device trust-signal plane (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §7; SECURITY_AND_DEVICE_MANAGEMENT §7 — the jailbreak /
 * root posture; SECURITY_TEST_PLAN D-07 — "attestation where
 * configured; degraded mode documented"):
 *
 * 1. **Best-effort detection ONLY** (§7.1): `TrustSignalsPort` collects
 *    the standard rooted/tamper signals (rooted Android, debuggable
 *    build flag, emulator environment). Detection is explicitly NOT a
 *    security boundary — the DEVICE implementation
 *    (`apps/mobile/native/drivers/trust.ts`) reads the platform
 *    surfaces (Build.TAGS/test-keys, `Settings.Global.ADB_ENABLED` +
 *    ApplicationInfo.FLAG_DEBUGGABLE, the emulator build fingerprints);
 *    tests inject a fake.
 * 2. **Surfacing** (§7.1): the signals land on the device profile —
 *    `devices.trustFlags` — via the registry's PATCH surface
 *    (`PATCH /api/v1/devices/:id` with `{ trustFlags }`, the exact
 *    patchSchema shape read from devices.controller.ts row 4; the
 *    registry MERGES the flags). The report is BEST-EFFORT by design
 *    (D-07): a non-2xx answer is an honest `{ reported: false, … }`
 *    outcome, never a throw at the caller, never a blocker. HONEST
 *    ROUTE REALITY: the PATCH route is permission-guarded
 *    (`identity.devices.manage`, the admin plane) — a plain field
 *    device's self-report is answered 403 by the current server build
 *    (the device access token resolves the session but the device user
 *    rarely holds the manage key); recorded as a deviation + handoff
 *    note in T-P22-2b.md (the server-side self-report widening is a
 *    server decision, out of 2-b's read-only scope).
 * 3. **Policy** (§7.2 + §7.3 — the D-07 doctrine): a flagged device
 *    degrades to ONLINE-ONLY (writes require live server
 *    authorization; local write caching disabled) until an admin
 *    acknowledges the risk — {@link trustPolicy}. NEVER a brick
 *    (§7.3): a false-positive root signal degrades writes, never
 *    locks the user out — reads stay available, the biometric gate is
 *    unaffected, and the admin console sees the flags with timestamps
 *    for the human decision.
 */

/** The best-effort rooted/tamper signals (§7.1 — detection, not a
 * boundary). All flags optional: a signal the platform cannot probe is
 * simply absent (never guessed true). */
export interface TrustSignals {
  /** A rooted/jailbroken environment was detected. */
  readonly isJailbrokenRooted?: boolean;
  /** The app runs under a debuggable build flag. */
  readonly debuggableFlag?: boolean;
  /** The environment looks like an emulator. */
  readonly emulator?: boolean;
  /** When this signal set was observed (ISO) — the admin-ack
   * comparison input (a detection AFTER the ack re-flags). */
  readonly observedAt?: string;
}

/** The trust-signal collection seam (device: platform probes; tests:
 * a fake with canned signals). */
export interface TrustSignalsPort {
  collectTrustSignals(): Promise<TrustSignals>;
}

/** The devices.trustFlags patch body shape (patchSchema: `{ trustFlags:
 * Record<string, unknown> }` — the registry merges the record into the
 * device's flags). */
export type TrustFlagsPatch = { trustFlags: Record<string, unknown> };

/** Convert collected signals into the PATCH body's trustFlags record
 * (the admin console's display shape: the flag names + when they were
 * observed, booleans only — never invents a signal that was not
 * probed). */
export function trustSignalsToFlags(signals: TrustSignals): Record<string, unknown> {
  const flags: Record<string, unknown> = {};
  if (signals.isJailbrokenRooted !== undefined) {
    flags.jailbrokenRooted = signals.isJailbrokenRooted;
  }
  if (signals.debuggableFlag !== undefined) {
    flags.debuggable = signals.debuggableFlag;
  }
  if (signals.emulator !== undefined) {
    flags.emulator = signals.emulator;
  }
  if (signals.observedAt !== undefined) {
    flags.reportedAt = signals.observedAt;
  }
  return flags;
}

/** Whether any signal in the set is a POSITIVE detection (a flagged
 * device). Absent/false signals never flag (§7.1 — no guessing). */
export function isTrustFlagged(signals: TrustSignals): boolean {
  return signals.isJailbrokenRooted === true || signals.debuggableFlag === true || signals.emulator === true;
}

/** The outcome of one best-effort report (never thrown — D-07). */
export type TrustReportOutcome =
  | { readonly reported: true; readonly trustFlags: Record<string, unknown> }
  | {
      readonly reported: false;
      readonly reason: "http-error" | "network-error";
      readonly status?: number;
      readonly code?: string;
    };

/**
 * Report trust signals onto the device profile: `PATCH
 * /api/v1/devices/:id` with the patchSchema body `{ trustFlags }`.
 * BEST-EFFORT (D-07): any failure — the permission guard's 401/403, a
 * 5xx, or the port's network-level throw — is returned as an honest
 * `reported: false` outcome, never a throw, never a blocker for the
 * caller (a trust report must never stop registration or syncing).
 */
export async function reportTrustSignals(
  httpPort: HttpPort,
  baseUrl: string,
  deviceId: string,
  signals: TrustSignals,
  options?: {
    /** The Authorization header value (the device access token or an
     * admin/portal session — the route is permission-guarded). */
    readonly authorization?: string;
  },
): Promise<TrustReportOutcome> {
  const trustFlags = trustSignalsToFlags(signals);
  try {
    await deviceApiRequest<unknown>(httpPort, baseUrl, {
      method: "PATCH",
      path: devicePath(deviceId),
      body: { trustFlags } satisfies TrustFlagsPatch,
      ...(options?.authorization !== undefined && options.authorization !== ""
        ? { authorization: options.authorization }
        : {}),
    });
    return { reported: true, trustFlags };
  } catch (error) {
    if (error instanceof MobileAuthHttpError) {
      return {
        reported: false,
        reason: "http-error",
        status: error.status,
        ...(error.code !== null ? { code: error.code } : {}),
      };
    }
    return { reported: false, reason: "network-error" };
  }
}

/** The trust policy verdict (§7.2). */
export type TrustPolicyMode = "normal" | "online-only";

/** Read the admin acknowledgement timestamp from the server-side
 * trustFlags record (the sync status response's `device.trustFlags` —
 * the admin console writes `adminAckedAt` through the same PATCH
 * surface). Null when nobody acknowledged. */
export function adminAckedAtFromTrustFlags(flags: Record<string, unknown> | undefined | null): string | null {
  if (typeof flags !== "object" || flags === null) return null;
  const value = (flags as { adminAckedAt?: unknown }).adminAckedAt;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The D-07 POLICY (§7.2 + §7.3): a flagged device runs ONLINE-ONLY
 * until an admin acknowledges the risk.
 *
 * - no positive signal → `"normal"`;
 * - flagged, no ack → `"online-only"` (writes require live
 *   authorization; local write caching disabled — degrade, never
 *   brick);
 * - flagged + acked → `"normal"` UNLESS the signal set was observed
 *   AFTER the ack (a fresh detection re-flags — the ack covers one
 *   episode, not eternity). Signals without `observedAt` are treated
 *   as covered by the ack (fail-open toward the user, §7.3's
 *   false-positive posture — the admin saw the flags).
 */
export function trustPolicy(
  signals: TrustSignals,
  adminAckedAt: string | null,
): TrustPolicyMode {
  if (!isTrustFlagged(signals)) {
    return "normal";
  }
  if (adminAckedAt === null) {
    return "online-only";
  }
  if (signals.observedAt !== undefined) {
    const ackedMs = Date.parse(adminAckedAt);
    const observedMs = Date.parse(signals.observedAt);
    if (!Number.isNaN(ackedMs) && !Number.isNaN(observedMs) && observedMs > ackedMs) {
      return "online-only"; // a NEW detection after the ack re-flags
    }
  }
  return "normal";
}

/** The online-only write gate's verdict for one write attempt. */
export interface OnlineWriteGate {
  /** The write may proceed NOW. */
  readonly allowed: boolean;
  /** Local write caching (the outbox queue) is allowed for this write. */
  readonly queueLocally: boolean;
  readonly reason: "NORMAL" | "TRUST_FLAGGED_ONLINE_ONLY" | "TRUST_FLAGGED_OFFLINE";
}

/**
 * The write gate a flagged device runs under (§7.2): online-only means
 * every write requires LIVE connectivity (server authorization every
 * time) and local write caching is DISABLED. NEVER a brick (§7.3): an
 * offline flagged device refuses the WRITE with an honest reason —
 * reads, the biometric gate, and every non-write surface stay fully
 * available; the write proceeds the moment connectivity returns.
 */
export function onlineWriteGate(mode: TrustPolicyMode, online: boolean): OnlineWriteGate {
  if (mode === "normal") {
    return { allowed: true, queueLocally: true, reason: "NORMAL" };
  }
  if (online) {
    return { allowed: true, queueLocally: false, reason: "TRUST_FLAGGED_ONLINE_ONLY" };
  }
  return { allowed: false, queueLocally: false, reason: "TRUST_FLAGGED_OFFLINE" };
}
