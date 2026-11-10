/**
 * PHASE-022 · the app-unlock biometric gate (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §7 — "`UnlockPort`: biometric optional + PIN fallback";
 * SECURITY_AND_DEVICE_MANAGEMENT §3 — the Android Keystore posture):
 * the state machine that gates the whole app behind biometric-or-PIN —
 *
 *                       ┌──────────────────────────┐
 *      lock()           │          locked          │◄──────────────┐
 *    ┌─────────────────►│  (boot + backgrounding)  │               │
 *    │                  └──────────┬───────────────┘               │
 *    │                             │ unlockWithBiometric(reason)   │
 *    │                             │   or unlockWithPin(pin)       │
 *    │                             ▼                               │
 *    │                  ┌──────────────────────────┐               │
 *    └──────────────────┤         unlocked         ├───────────────┘
 *                       └──────────────────────────┘
 *
 * The `UnlockPort` is the ONLY seam (the desktop's port-first
 * convention; DR-P22-01): the DEVICE implementation
 * (`apps/mobile/native/drivers/unlock.ts`) maps onto
 * `expo-local-authentication` — `isBiometricAvailable` →
 * `LocalAuthentication.hasHardwareAsync() && hasEnrolledBiometrics­Async()`,
 * `authenticateBiometric` → `authenticateAsync({ promptMessage: reason })`,
 * `verifyPin` → the device-credential fallback
 * (`authenticateAsync({ disableDeviceFallback: false })` or the
 * app-PIN verifier the settings screen owns — the native author's
 * call, documented there); tests inject a fake.
 *
 * Retry policy (the wrong-PIN ladder): a wrong PIN increments the
 * attempt counter; at `maxPinAttempts` (default 5) the PIN path is
 * LOCKED OUT — further `unlockWithPin` calls are refused WITHOUT
 * consulting the port (the credential verifier never sees a PIN after
 * lockout), until `clearPinAttempts()` (the shell's cool-down timer /
 * app restart). NEVER a brick (the D-07 degrade-don't-lockout
 * doctrine): the biometric path stays available while the PIN is
 * locked out, a successful unlock of EITHER kind resets the counter,
 * and reads are never gated by this module at all (the store cache is
 * encrypted at rest; the gate protects the SESSION, not the file).
 */

/** The biometric/PIN credential-verification seam. */
export interface UnlockPort {
  /** Whether a biometric sensor with enrolled biometrics exists. */
  isBiometricAvailable(): Promise<boolean>;
  /** Run the biometric prompt (`reason` is the user-facing prompt
   * string); true when the sensor authenticated the user. */
  authenticateBiometric(reason: string): Promise<boolean>;
  /** Verify a PIN (the app-PIN verifier or the device credential —
   * the device impl owns which); true when the PIN matches. The
   * verifier NEVER sees a PIN after PIN lockout (the gate refuses
   * first). */
  verifyPin(pin: string): Promise<boolean>;
}

/** The gate's phase. */
export type UnlockPhase = "locked" | "unlocked";

/** How a failed unlock attempt failed. */
export type UnlockFailureReason =
  | "BIOMETRIC_UNAVAILABLE"
  | "BIOMETRIC_FAILED"
  | "PIN_INCORRECT"
  | "PIN_LOCKED_OUT"
  | "ALREADY_UNLOCKED";

/** One unlock attempt's verdict. */
export type UnlockAttemptResult =
  | { readonly unlocked: true; readonly method: "biometric" | "pin" }
  | {
      readonly unlocked: false;
      readonly reason: UnlockFailureReason;
      /** PIN attempts remaining before lockout (PIN failures only). */
      readonly attemptsRemaining?: number;
    };

/** Default wrong-PIN ladder depth (attempts before PIN lockout). */
export const DEFAULT_MAX_PIN_ATTEMPTS = 5;

export interface UnlockGateOptions {
  /** The credential-verification seam. */
  readonly port: UnlockPort;
  /** Wrong-PIN attempts before PIN lockout (default 5). */
  readonly maxPinAttempts?: number;
}

/**
 * The biometric-gate state machine. One instance per app run; the
 * shell re-`lock()`s on backgrounding (the keystore posture: the
 * session lives in memory, the gate guards its use).
 */
export class UnlockGate {
  private readonly port: UnlockPort;
  private readonly maxPinAttempts: number;
  private phaseValue: UnlockPhase = "locked";
  private pinAttemptsValue = 0;
  private lockedOutValue = false;

  constructor(options: UnlockGateOptions) {
    this.port = options.port;
    this.maxPinAttempts =
      options.maxPinAttempts !== undefined && options.maxPinAttempts > 0
        ? options.maxPinAttempts
        : DEFAULT_MAX_PIN_ATTEMPTS;
  }

  /** The current phase. */
  get phase(): UnlockPhase {
    return this.phaseValue;
  }

  /** Consecutive wrong-PIN attempts so far (reset on any success or
   * clearPinAttempts). */
  get pinAttempts(): number {
    return this.pinAttemptsValue;
  }

  /** Whether the PIN path is locked out (the wrong-PIN ladder spent). */
  get pinLockedOut(): boolean {
    return this.lockedOutValue;
  }

  /** Whether a biometric sensor with enrolled biometrics exists (the
   * unlock screen's routing input: biometric-first UI vs PIN-only). */
  async isBiometricAvailable(): Promise<boolean> {
    return this.port.isBiometricAvailable();
  }

  /** Attempt the biometric unlock. A failed/cancelled prompt leaves
   * the gate locked (BIOMETRIC_FAILED — the user may retry the sensor
   * or switch to PIN); biometric failures NEVER count toward the PIN
   * ladder (separate channels, separate verifiers). */
  async unlockWithBiometric(reason: string): Promise<UnlockAttemptResult> {
    if (this.phaseValue === "unlocked") {
      return { unlocked: false, reason: "ALREADY_UNLOCKED" };
    }
    if (!(await this.port.isBiometricAvailable())) {
      return { unlocked: false, reason: "BIOMETRIC_UNAVAILABLE" };
    }
    if (await this.port.authenticateBiometric(reason)) {
      this.enterUnlocked();
      return { unlocked: true, method: "biometric" };
    }
    return { unlocked: false, reason: "BIOMETRIC_FAILED" };
  }

  /** Attempt the PIN unlock. A wrong PIN climbs the ladder; at the top
   * the PIN path locks out (the port is never consulted again until
   * clearPinAttempts — the verifier never sees a locked-out PIN). A
   * correct PIN unlocks even on the last attempt. */
  async unlockWithPin(pin: string): Promise<UnlockAttemptResult> {
    if (this.phaseValue === "unlocked") {
      return { unlocked: false, reason: "ALREADY_UNLOCKED" };
    }
    if (this.lockedOutValue) {
      return { unlocked: false, reason: "PIN_LOCKED_OUT", attemptsRemaining: 0 };
    }
    if (await this.port.verifyPin(pin)) {
      this.enterUnlocked();
      return { unlocked: true, method: "pin" };
    }
    this.pinAttemptsValue += 1;
    if (this.pinAttemptsValue >= this.maxPinAttempts) {
      this.lockedOutValue = true;
      return { unlocked: false, reason: "PIN_LOCKED_OUT", attemptsRemaining: 0 };
    }
    return {
      unlocked: false,
      reason: "PIN_INCORRECT",
      attemptsRemaining: this.maxPinAttempts - this.pinAttemptsValue,
    };
  }

  /** Clear the wrong-PIN ladder (the shell's cool-down timer / app
   * restart) — the PIN path becomes available again. */
  clearPinAttempts(): void {
    this.pinAttemptsValue = 0;
    this.lockedOutValue = false;
  }

  /** Re-lock (app backgrounded / explicit lock). Idempotent. */
  lock(): void {
    this.phaseValue = "locked";
  }

  private enterUnlocked(): void {
    this.phaseValue = "unlocked";
    // A successful unlock of EITHER kind resets the PIN ladder —
    // possession was proven; never a brick.
    this.pinAttemptsValue = 0;
    this.lockedOutValue = false;
  }
}
