import type { EInvoicingAdapter, SubmissionOutcome, SubmissionPayload } from "../../domain/adapter-port";

/**
 * PHASE-023 T4 — the ZATCA (KSA) adapter as the UNVERIFIED refuse-to-submit
 * stub (E_INVOICING §3 verification gate + DR-001 OPEN; phase §2.3
 * gated-shipping rule): the verification checklist has UNPASSED items, so
 * NO adapter capability ships. This is NOT a "best-effort" implementation
 * — it is the RISK-005 discipline made executable:
 *
 * Unmet verification-gate items (the completion report's INCOMPLETE list —
 * every item requires artifacts this environment cannot produce; see the
 * verification log, T3):
 *
 *   GATE-1  Official ZATCA specifications/SDK version pinned  — NOT_VERIFIED
 *           (no SDK artifact retrieved from an official source)
 *   GATE-2  Sandbox environment exercised                     — NOT_VERIFIED
 *           (no sandbox credentials/access)
 *   GATE-3  Sample invoices validated against official rules  — NOT_VERIFIED
 *   GATE-4  Legal review of invoice-content requirements      — NOT_VERIFIED
 *
 * DR-001 (ZATCA scope & timing) remains OPEN — option C (generation
 * features at launch, integration adapter as certified fast-follow) is the
 * recommendation; until the record is approved AND the gate passes, this
 * stub refuses EVERY regulated action (integrations README §4 rule 2:
 * "never a guessed wire format").
 */

/** The unmet gate items this stub names in every refusal (T3 evidence). */
export const ZATCA_UNMET_GATE_ITEMS: readonly { item: string; status: "NOT_VERIFIED" }[] = [
  { item: "GATE-1 official ZATCA specifications/SDK version pinned", status: "NOT_VERIFIED" },
  { item: "GATE-2 ZATCA sandbox environment exercised", status: "NOT_VERIFIED" },
  { item: "GATE-3 sample invoices validated against official rules", status: "NOT_VERIFIED" },
  { item: "GATE-4 legal review of invoice-content requirements", status: "NOT_VERIFIED" },
];

/** The explicit refusal outcome — the ONLY outcome this stub produces. */
export function zatcaRefusal(payload?: Partial<SubmissionPayload>): SubmissionOutcome {
  return {
    status: "FAILED",
    authorityReference: null,
    payloadDigest: null,
    error: {
      code: "UNVERIFIED_REGIME",
      adapterId: "zatca",
      note: "the ZATCA adapter is an UNVERIFIED stub and refuses real submissions — no wire format is guessed (RISK-005; E_INVOICING §3 verification gate; DR-001 OPEN)",
      unmetGateItems: ZATCA_UNMET_GATE_ITEMS.map((gate) => gate.item),
      decisionRecord: "docs/decisions/compliance/DR-001-zatca-scope-and-timing.md (OPEN)",
      countryCode: payload?.countryCode ?? null,
    },
  };
}

/**
 * The stub. `regimeVerified` is FALSE and the submit call returns the
 * explicit refusal — the registry service ALSO enforces the gate before
 * the call (defense in depth: the stub refusing + the service gate = the
 * asserted no-submission guarantee).
 */
export class ZatcaUnverifiedStubAdapter implements EInvoicingAdapter {
  readonly id = "zatca";
  readonly supportedCountries: readonly string[] = ["SA"];
  readonly regimeVerified = false;

  async submit(payload: SubmissionPayload): Promise<SubmissionOutcome> {
    return zatcaRefusal(payload);
  }
}
