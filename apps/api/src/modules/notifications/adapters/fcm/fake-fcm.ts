import type { FcmMessage, FcmResponse, FcmTransport } from "./fcm-transport";

/**
 * PHASE-022 · DR-P22-07 — the fake FCM transport for contract tests (the
 * SmtpCaptureServer precedent from the PHASE-003 db suite, lifted to the
 * adapters/fcm/** tree the phase doc names). Records every wire call
 * verbatim (byte-assertable) and offers configurable failures for the
 * retry/quota paths. NEVER bound in production wiring — it is a test
 * double (the module factory only ever builds Disabled or Http).
 */

/** The public failure configuration (immutable per request). */
export interface FakeFcmFailure {
  /** How many times this failure fires before the fake recovers. */
  readonly times: number;
  /** HTTP status the fake reports (0 = network-style). */
  readonly status: number;
  /** transient=true → the adapter retries; false → permanent 4xx shape. */
  readonly transient: boolean;
  readonly error?: string;
}

/** The internal mutable countdown mirror of a queued failure. */
interface PendingFailure {
  remaining: number;
  status: number;
  transient: boolean;
  error?: string;
}

export class FakeFcmTransport implements FcmTransport {
  readonly disabled = false;
  /** Every wire call, in order (the byte-assertable record). */
  readonly calls: FcmMessage[] = [];
  private readonly failures: PendingFailure[] = [];
  private sent = 0;

  /** Queue a failure shape: the next `times` calls report it, then the
   * fake succeeds again (the retry tests configure this). */
  failWith(failure: FakeFcmFailure): void {
    this.failures.push({
      remaining: failure.times,
      status: failure.status,
      transient: failure.transient,
      ...(failure.error === undefined ? {} : { error: failure.error }),
    });
  }

  postMessage(message: FcmMessage): Promise<FcmResponse> {
    this.calls.push(message);
    this.sent += 1;
    const failure = this.failures[0];
    if (failure !== undefined) {
      failure.remaining -= 1;
      if (failure.remaining <= 0) {
        this.failures.shift();
      }
      return Promise.resolve({
        status: failure.status,
        transient: failure.transient,
        ...(failure.error === undefined ? {} : { error: failure.error }),
      });
    }
    return Promise.resolve({
      status: 200,
      transient: false,
      name: `projects/fake-project/messages/fcm-${String(this.sent).padStart(4, "0")}`,
    });
  }
}
