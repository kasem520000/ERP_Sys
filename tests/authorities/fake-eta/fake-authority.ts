import type {
  EInvoicingAdapter,
  SubmissionOutcome,
  SubmissionPayload,
} from "../../../apps/api/src/modules/tax/domain/adapter-port";

/**
 * PHASE-023 T9/T11 — the Egypt ETA evaluation-track fake (RISK-007):
 * the evaluation harness proving the PORT fits ETA-shaped flows WITHOUT
 * any implementation claim. DR-003 (Egypt ETA scope) ships as the DEFERRED
 * draft: e-invoice vs e-receipt scope is DECIDED BY RECORD before any
 * adapter work — this fake is the evaluation evidence pack's executable
 * artifact, and it stays in tests/ forever until that record approves an
 * adapter (integrations README §3.2 evaluation gate).
 *
 * Same port-only discipline as fake-zatca: NO ETA wire format is encoded —
 * not even "plausible" ones (NO-FABRICATION §4 rule 1).
 */
export class FakeEtaAuthority implements EInvoicingAdapter {
  readonly id = "fake-eta";
  readonly supportedCountries: readonly string[] = ["EG"];
  /** Evaluation harness only: always unverified — no implementation claim. */
  readonly regimeVerified = false;

  private readonly submissionsSeen: string[] = [];

  get submitCallCount(): number {
    return this.submissionsSeen.length;
  }

  async submit(payload: SubmissionPayload): Promise<SubmissionOutcome> {
    this.submissionsSeen.push(payload.sourceId);
    // The evaluation track refuses like any UNVERIFIED regime — the
    // harness proves the REFUSAL path is the honest default for EG until
    // DR-003 approves scope + the verification gate passes.
    return {
      status: "FAILED",
      authorityReference: null,
      payloadDigest: null,
      error: {
        code: "UNVERIFIED_REGIME",
        adapterId: "fake-eta",
        note: "Egypt ETA is the evaluation track — the adapter ships only after official API documentation review, enrollment confirmation, and an approving decision record (RISK-007; DR-003 draft)",
        decisionRecord: "docs/decisions/compliance/DR-003-egypt-eta-scope.md (DRAFT — recommendation DEFERRED)",
      },
    };
  }
}
