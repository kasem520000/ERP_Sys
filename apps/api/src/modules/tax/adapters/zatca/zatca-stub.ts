import { createHash } from "node:crypto";

import type { EInvoicingAdapter, SubmissionOutcome, SubmissionPayload } from "../../domain/adapter-port";
import { ZatcaPhase2NotImplementedError } from "../../domain/zatca/zatca-errors";

/**
 * PHASE-037 T-06 · the ZATCA (KSA) adapter in its honest PHASE-1
 * GENERATION mode (BR-061). PHASE-023 shipped this file as the
 * UNVERIFIED refuse-to-submit stub (RISK-005); the refusal discipline
 * for SUBMISSION is preserved verbatim — what changes is that Phase-1
 * generation is no longer hidden behind it:
 *
 *   GENERATION (this phase, real): the TLV-base64 QR payload, the ICV /
 *   PIH chain stamp, and the scannable QR image — all pure computation,
 *   zero external calls. The adapter exposes `generate()` and the ONLY
 *   outcomes it can ever produce are GENERATED / FAILED (BR-061's
 *   honest vocabulary — no SUBMITTED/ACCEPTED/REPORTED claim exists in
 *   this file, and the repo grep in the spec pins that).
 *
 *   SUBMISSION (PHASE-054): `submit()` remains a hard refusal, now with
 *   the HONEST reason — not "unverified specs" but a typed
 *   NOT_IMPLEMENTED (ZatcaPhase2NotImplementedError): clearance /
 *   reporting, the CSID lifecycle, UBL 2.1, and XAdES signing are
 *   explicitly out of Phase-1. The GATE-1..4 verification checklist
 *   below is preserved and documented for 054's entry evidence.
 *
 * E_INVOICING_ARCHITECTURE seam unchanged: the registry service still
 * enforces the gate before any adapter call (defense in depth).
 */

/** The unmet gate items Phase-2 submission names in every refusal (T3). */
export const ZATCA_UNMET_GATE_ITEMS: readonly { item: string; status: "NOT_VERIFIED" }[] = [
  { item: "GATE-1 official ZATCA specifications/SDK version pinned", status: "NOT_VERIFIED" },
  { item: "GATE-2 ZATCA sandbox environment exercised", status: "NOT_VERIFIED" },
  { item: "GATE-3 sample invoices validated against official rules", status: "NOT_VERIFIED" },
  { item: "GATE-4 legal review of invoice-content requirements", status: "NOT_VERIFIED" },
];

/**
 * BR-061: the COMPLETE status vocabulary this adapter can produce.
 * GENERATED = the Phase-1 artifact was computed locally; FAILED = the
 * generation input was invalid (or the Phase-2 surface was reached).
 * The vocabulary test greps this file: any clearance/reporting state
 * (SUBMITTED/ACCEPTED/REJECTED/REPORTED/SIGNED/PENDING) appearing as a
 * produced outcome is a spec failure.
 */
export const ZATCA_GENERATION_STATUS_VOCABULARY = ["GENERATED", "FAILED"] as const;

export type ZatcaGenerationOutcome =
  | {
      readonly status: "GENERATED";
      readonly payloadDigest: string;
      readonly generatedAt: string;
    }
  | {
      readonly status: "FAILED";
      readonly reason: string;
      readonly generatedAt: string;
    };

/** The Phase-2 refusal outcome — the ONLY result submit() ever returns. */
export function zatcaPhase2Refusal(payload?: Partial<SubmissionPayload>): SubmissionOutcome {
  const notImplemented = new ZatcaPhase2NotImplementedError("adapter.submit (clearance/reporting)");
  return {
    status: "FAILED",
    authorityReference: null,
    payloadDigest: null,
    error: {
      code: notImplemented.code,
      adapterId: "zatca",
      note: notImplemented.message,
      phase: "054",
      // The preserved GATE-1..4 discipline: the checklist stays attached
      // to every submission refusal (054's entry evidence base).
      unmetGateItems: ZATCA_UNMET_GATE_ITEMS.map((gate) => gate.item),
      decisionRecord: "docs/decisions/compliance/DR-001-zatca-scope-and-timing.md",
      countryCode: payload?.countryCode ?? null,
    },
  };
}

/**
 * The ZATCA adapter, Phase-1 GENERATION mode. `regimeVerified` stays
 * FALSE — the RISK-005 gate still blocks SUBMISSION paths; generation
 * does not claim any regime contact.
 */
export class ZatcaGenerationAdapter implements EInvoicingAdapter {
  readonly id = "zatca";
  readonly supportedCountries: readonly string[] = ["SA"];
  readonly regimeVerified = false;

  /**
   * PHASE-1 generation: compute the QR payload digest over the document
   * snapshot the caller assembled (the chain stamp itself lives in the
   * invoice post transaction — this adapter surface exists so the
   * submission-registry pipeline can record the generation step without
   * ever implying transmission). Fails typed on missing fields.
   */
  generate(document: Readonly<Record<string, unknown>>): ZatcaGenerationOutcome {
    const generatedAt = new Date().toISOString();
    const required = ["qrPayload"] as const;
    for (const key of required) {
      if (typeof document[key] !== "string" || (document[key] as string).length === 0) {
        return { status: "FAILED", reason: `missing ${key}`, generatedAt };
      }
    }
    const digest = createHash("sha256")
      .update(String(document.qrPayload), "utf8")
      .digest("base64");
    return { status: "GENERATED", payloadDigest: digest, generatedAt };
  }

  /**
   * The Phase-2 surface: ALWAYS the typed refusal. Never a wire call,
   * never a guessed format, never a clearance/reporting claim.
   */
  async submit(payload: SubmissionPayload): Promise<SubmissionOutcome> {
    return zatcaPhase2Refusal(payload);
  }
}

/**
 * Back-compat alias (the PHASE-023 registry registers the class under
 * its old name — the export shape stays stable for the registry and the
 * existing spec imports).
 */
export const ZatcaUnverifiedStubAdapter = ZatcaGenerationAdapter;
