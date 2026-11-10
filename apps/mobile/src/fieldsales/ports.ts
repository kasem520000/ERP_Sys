/**
 * PHASE-022 T-P22-2-e · the field-sales device ports (MASTER-PLAN §8 —
 * BINDING; DR-P22-01 the port-first convention): the ONLY seams the
 * field-sales flows and screens reach for hardware through.
 *
 * - {@link BarcodeScannerPort} — scan-to-cart / scan-to-count. The DEVICE
 *   implementation lives in `apps/mobile/native/drivers/barcode-scanner.ts`
 *   (expo-camera / ML-kit — source-only this phase, compiled by EAS CI);
 *   tests inject {@link FakeBarcodeScanner}. Codes NEVER mirror under RTL
 *   (RTL_DESIGN_RULES §3.2 — the scan→cart pipeline treats a code as an
 *   opaque LTR identifier and re-isolates it at render time via
 *   `bidiSerial`/`bidiIsolateStrong`).
 *
 * This module is PURE TS (zero react-native imports) — the flows stay
 * vitest-testable on Node (DR-P22-01).
 */

/** A scan outcome: the raw decoded code (barcode/QR payload, LTR run). */
export interface BarcodeScanResult {
  /** The decoded payload — opaque identifier bytes, never re-ordered. */
  readonly code: string;
  /** The symbology when the device reports it ("EAN13", "QR", …) — advisory. */
  readonly format?: string;
}

/** The camera scanner seam (scan-to-cart T-03, scan-to-count, scan-a-serial). */
export interface BarcodeScannerPort {
  /** Whether a camera scanner exists on this device at all. */
  isAvailable(): boolean;
  /**
   * Scan one code. Resolves with the decoded result; rejects with a typed
   * {@link BarcodeScanError} on permission denial or a camera failure —
   * NEVER a silent empty string (the k6 precedent: honest failures only).
   */
  scan(): Promise<BarcodeScanResult>;
}

/** The typed scan failure (permission / hardware / cancelled). */
export type BarcodeScanErrorKind = "permission" | "unavailable" | "cancelled" | "hardware";

export class BarcodeScanError extends Error {
  constructor(
    public readonly kind: BarcodeScanErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "BarcodeScanError";
  }
}

/**
 * The scripted fake (tests + the RN screens' Storybook-style harness): a
 * FIFO queue of codes; `scan()` resolves the next one, or rejects with
 * `kind: "cancelled"` when the queue is empty (the user closed the finder).
 */
export class FakeBarcodeScanner implements BarcodeScannerPort {
  private readonly queue: BarcodeScanResult[];

  constructor(codes: readonly (string | BarcodeScanResult)[] = []) {
    this.queue = codes.map((code) => (typeof code === "string" ? { code } : code));
  }

  isAvailable(): boolean {
    return true;
  }

  /** Queue one more code (a test may arm the fake mid-interaction). */
  push(code: string | BarcodeScanResult): void {
    this.queue.push(typeof code === "string" ? { code } : code);
  }

  async scan(): Promise<BarcodeScanResult> {
    const next = this.queue.shift();
    if (next === undefined) {
      throw new BarcodeScanError("cancelled", "the scripted scan queue is empty");
    }
    return next;
  }
}

/** A scanner that reports no camera (the no-harness device posture). */
export class UnavailableBarcodeScanner implements BarcodeScannerPort {
  isAvailable(): boolean {
    return false;
  }

  async scan(): Promise<BarcodeScanResult> {
    throw new BarcodeScanError("unavailable", "no camera scanner on this device");
  }
}
