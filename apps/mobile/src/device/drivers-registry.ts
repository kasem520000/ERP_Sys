import type { HttpPort } from "../sync/http-port";
import type { CryptoPort } from "../auth/crypto-port";
import type { SecureStorePort } from "../auth/secure-store-port";
import type { UnlockPort } from "../auth/unlock";
import type { TrustSignalsPort } from "./trust";
import type { SecureScreenPort } from "./secure-screen";

/**
 * PHASE-022 · the mobile drivers registry (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §2 package layout — "drivers-registry.ts: a tiny
 * registry mapping port names → implementations"): the ONE place the
 * native shell's real drivers and the tests' fakes plug in. The
 * desktop never needed this (its ports were injected ad hoc by the
 * Tauri bridge); the mobile runtime has SIX device seams, so the
 * registry keeps the wiring auditable — `native/App.tsx` calls
 * `createMobileDriverRegistry({ …real drivers })` once at boot and
 * hands the result to the app composition root; tests build the same
 * record with fakes.
 *
 * The registry is minimal BY DESIGN (the task brief: "keep it
 * minimal"): a typed frozen record + a fail-loud completeness check —
 * a missing driver is a boot bug (an undefined slot would surface as
 * a cryptic TypeError deep in the auth flow instead of a clear
 * at-boot error, the desktop shell-bridge convention).
 */

/** The driver record: one slot per device seam. */
export interface MobileDrivers {
  /** The fetch-like HTTP seam (2-a's HttpPort — the ONLY network
   * surface; device impl: native/drivers/http.ts over RN fetch). */
  readonly http: HttpPort;
  /** The credential vault (device impl: expo-secure-store). */
  readonly secureStore: SecureStorePort;
  /** The Ed25519 keypair seam (device impl: the platform crypto). */
  readonly crypto: CryptoPort;
  /** The biometric/PIN gate (device impl: expo-local-authentication). */
  readonly unlock: UnlockPort;
  /** The best-effort rooted/tamper probes (device impl: platform
   * surfaces; D-07 — detection, not a boundary). */
  readonly trust: TrustSignalsPort;
  /** The FLAG_SECURE screenshot block (device impl: expo
   * ScreenCapture). */
  readonly secureScreen: SecureScreenPort;
}

/** The driver slot names (the registry's keys — the audit surface). */
export type MobileDriverName = keyof MobileDrivers;

const DRIVER_NAMES: readonly MobileDriverName[] = [
  "http",
  "secureStore",
  "crypto",
  "unlock",
  "trust",
  "secureScreen",
];

/**
 * Build the driver registry: asserts EVERY slot is present (a missing
 * driver throws at boot with the slot's name — fail loud, never a
 * deep undefined) and returns the frozen record. Both the native shell
 * (real drivers) and the tests (fakes) construct through here so the
 * completeness check runs in both worlds.
 */
export function createMobileDriverRegistry(drivers: MobileDrivers): Readonly<MobileDrivers> {
  for (const name of DRIVER_NAMES) {
    if (drivers[name] === undefined || drivers[name] === null) {
      throw new Error(
        `createMobileDriverRegistry: the "${name}" driver is missing — every port slot must be ` +
          "wired (native/App.tsx injects the real drivers; tests inject fakes; a missing driver " +
          "is a boot bug, never a runtime undefined)",
      );
    }
  }
  return Object.freeze({ ...drivers });
}
