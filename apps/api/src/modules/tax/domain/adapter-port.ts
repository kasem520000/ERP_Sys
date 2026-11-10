/**
 * PHASE-009 T10 — the EInvoicingAdapter port (E_INVOICING_ARCHITECTURE §1:
 * payload builder → adapter → submission registry). This is the VERSIONED
 * seam PHASE-023 implements real adapters (ZATCA/ETA) against — gated on
 * verified official specifications (RISK-005/007). The registry table ships
 * in this phase (schema only); the fake adapter below exercises the full
 * submission lifecycle states in tests WITHOUT any external call.
 */

export type EInvoicingStatus =
  | "PENDING"
  | "GENERATED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "FAILED";

export interface SubmissionPayload {
  readonly countryCode: string;
  readonly sourceType: string;
  readonly sourceId: string;
  /** Structured, adapter-neutral document data (frozen per contract). */
  readonly document: Readonly<Record<string, unknown>>;
}

export interface SubmissionOutcome {
  readonly status: EInvoicingStatus;
  readonly authorityReference: string | null;
  readonly payloadDigest: string | null;
  readonly error: Readonly<Record<string, unknown>> | null;
}

/**
 * The adapter contract. `regimeVerified` is the RISK-005 gate: adapters
 * whose regime facts are still REQUIRES_VERIFICATION MUST refuse to
 * submit — the einvoicing service enforces this before any adapter call,
 * and the refusal is the explicit UNVERIFIED stub behavior the phase
 * demands (real submission flows wait for PHASE-023).
 */
export interface EInvoicingAdapter {
  readonly id: string;
  readonly supportedCountries: readonly string[];
  /** The compliance-matrix verification state of this adapter's regime. */
  readonly regimeVerified: boolean;
  /** Refuses (or submits when verified) — never partial. */
  submit(payload: SubmissionPayload): Promise<SubmissionOutcome>;
}

/**
 * The fake adapter (test-only): refuses while the regime is unverified
 * (the asserted RISK-005 behavior) and walks the lifecycle states in
 * tests via the registry walkers the service exposes — no external calls
 * exist anywhere in the module (phase §6 security note).
 */
export class FakeEInvoicingAdapter implements EInvoicingAdapter {
  readonly id = "fake";
  /** Test surface: the fake supports every seeded pack so the RISK-005
   * verification gate (not the dormant-slot branch) is the assertable refusal. */
  readonly supportedCountries: readonly string[] = [
    "SA", "AE", "BH", "KW", "OM", "QA", "YE", "EG", "JO", "IQ",
  ];
  constructor(readonly regimeVerified: boolean = false) {}

  async submit(_payload: SubmissionPayload): Promise<SubmissionOutcome> {
    // The fake never performs a real submission: while unverified it is a
    // refusal stub (the assertable behavior); when a test flips
    // regimeVerified it simulates the happy lifecycle outcome.
    if (!this.regimeVerified) {
      return {
        status: "FAILED",
        authorityReference: null,
        payloadDigest: null,
        error: { code: "UNVERIFIED_REGIME", note: "fake adapter refuses while regime facts are REQUIRES_VERIFICATION (RISK-005)" },
      };
    }
    return {
      status: "ACCEPTED",
      authorityReference: "FAKE-ACCEPTED-0001",
      payloadDigest: null,
      error: null,
    };
  }
}
