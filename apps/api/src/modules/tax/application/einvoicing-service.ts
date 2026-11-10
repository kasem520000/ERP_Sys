import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/tax.store";
import {
  EInvoicingSubmissionNotFoundError,
  EInvoicingStateError,
  UnverifiedRegimeError,
} from "../domain/tax-errors";
import {
  FakeEInvoicingAdapter,
  type EInvoicingAdapter,
  type SubmissionPayload,
  type SubmissionOutcome,
} from "../domain/adapter-port";

/**
 * PHASE-009 T10 — the e-invoicing submission registry service: adapter
 * registration (the fake adapter + dormant slots), refusal while regime
 * facts are REQUIRES_VERIFICATION (RISK-005 — real adapters are PHASE-023,
 * gated on verified official specifications), and the test-only lifecycle
 * walkers that exercise the submission state machine without any external
 * call. The registry table (`e_invoicing_submissions`) ships schema-only.
 */
@Injectable()
export class EInvoicingService {
  private readonly adapters = new Map<string, EInvoicingAdapter>();

  constructor(@Inject(AuditService) private readonly audit: AuditService) {
    // The fake adapter is always registered (test surface); no real adapter
    // exists in this phase by design (PHASE-023 ships them behind verified
    // specs — RISK-005/007).
    this.registerAdapter(new FakeEInvoicingAdapter(false));
  }

  registerAdapter(adapter: EInvoicingAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  listAdapters(): { id: string; supportedCountries: readonly string[]; regimeVerified: boolean }[] {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      supportedCountries: adapter.supportedCountries,
      regimeVerified: adapter.regimeVerified,
    }));
  }

  async listSubmissions(filter: { countryCode?: string; status?: string }) {
    return store.listEInvoicingSubmissions(filter);
  }

  async findSubmission(id: string) {
    const row = await store.findEInvoicingSubmissionById(id);
    if (row === undefined) throw new EInvoicingSubmissionNotFoundError(id);
    return row;
  }

  /**
   * Submit through the port: REFUSES while the regime's facts are
   * REQUIRES_VERIFICATION (the explicit UNVERIFIED stub behavior the phase
   * demands — assertable), otherwise walks the fake lifecycle (tests) or a
   * real adapter's outcome (PHASE-023). No external network calls exist in
   * this module (phase §6).
   */
  async submit(input: { payload: SubmissionPayload; actorId: string | null }) {
    const adapter = this.adapters.get(input.payload.countryCode === "SA" ? "zatca" : "fake") ?? this.adapters.get("fake");
    if (adapter === undefined) {
      throw new EInvoicingStateError("no adapter available for the submission");
    }
    const jurisdiction = await store.findJurisdictionByCountry(input.payload.countryCode);
    if (jurisdiction === undefined || !adapter.supportedCountries.includes(input.payload.countryCode)) {
      // Dormant slot: no regime for this country (or adapter not opted in) —
      // the honest refusal, labeled non-authoritative.
      throw new EInvoicingStateError(
        `no e-invoicing regime is configured for ${input.payload.countryCode} (dormant adapter slot — E_INVOICING_ARCHITECTURE §5)`,
      );
    }
    if (!adapter.regimeVerified || jurisdiction.verificationStatus !== "VERIFIED") {
      // RISK-005: refuse — never a partial submission.
      throw new UnverifiedRegimeError({
        countryCode: input.payload.countryCode,
        adapterId: adapter.id,
        verificationStatus: jurisdiction.verificationStatus,
      });
    }
    const submissionId = await store.insertEInvoicingSubmission({
      countryCode: input.payload.countryCode,
      adapterId: adapter.id,
      sourceType: input.payload.sourceType,
      sourceId: input.payload.sourceId,
      payloadDigest: digestOf(input.payload),
    });
    const outcome: SubmissionOutcome = await adapter.submit(input.payload);
    await store.updateSubmissionStatus({
      id: submissionId,
      status: outcome.status,
      authorityReference: outcome.authorityReference,
      error: outcome.error,
    });
    await this.audit.record({
      action: "tax.einvoicing_submission_recorded",
      entityType: "e_invoicing_submission",
      entityId: submissionId,
      actorId: input.actorId ?? undefined,
      after: { adapterId: adapter.id, status: outcome.status },
    });
    return { submissionId, outcome };
  }

  /**
   * Test-only lifecycle walkers (the fake adapter's substrate): drive the
   * registry through PENDING → GENERATED → SUBMITTED → ACCEPTED/REJECTED
   * without any external call. Production flows never call these.
   */
  async walkLifecycle(input: {
    submissionId: string;
    steps: readonly ("GENERATED" | "SUBMITTED" | "ACCEPTED" | "REJECTED")[];
  }) {
    const submission = await this.findSubmission(input.submissionId);
    let status = submission.status;
    const order = ["PENDING", "GENERATED", "SUBMITTED", "ACCEPTED"];
    for (const step of input.steps) {
      const from = order.indexOf(status);
      const to = order.indexOf(step);
      if (step !== "REJECTED" && (from === -1 || to !== from + 1)) {
        throw new EInvoicingStateError(`invalid transition ${status} → ${step}`);
      }
      if (step === "REJECTED" && status !== "SUBMITTED") {
        throw new EInvoicingStateError(`invalid transition ${status} → REJECTED`);
      }
      status = step;
      await store.updateSubmissionStatus({
        id: input.submissionId,
        status: step,
        authorityReference: step === "ACCEPTED" ? "FAKE-ACCEPTED" : null,
      });
    }
    return this.findSubmission(input.submissionId);
  }
}

function digestOf(payload: SubmissionPayload): string {
  // Stable digest: JSON stringify with sorted top-level keys (determinism).
  const stable = JSON.stringify(payload.document, Object.keys(payload.document).sort());
  let hash = 0;
  for (let index = 0; index < stable.length; index += 1) {
    hash = (hash * 31 + stable.charCodeAt(index)) | 0;
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
