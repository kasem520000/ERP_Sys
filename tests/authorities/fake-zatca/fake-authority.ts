import type {
  EInvoicingAdapter,
  SubmissionOutcome,
  SubmissionPayload,
} from "../../../apps/api/src/modules/tax/domain/adapter-port";

/**
 * PHASE-023 T11 — the fake-authority harness (fake-zatca): an in-process
 * authority SIMULATOR driving the real registry + jobs through the full
 * scenario matrix (phase §6: submit → accept(uuid stored) / reject(codes
 * surfaced) / timeout → retry per policy / dead-letter + alert; duplicate
 * submission attempts dedupe via the registry — no double clearance).
 *
 * This is TEST-ONLY authority simulation — it lives in tests/ (never in
 * apps/) and encodes NO ZATCA wire-format knowledge: the fake speaks the
 * adapter PORT, not any authority protocol (NO-FABRICATION §4 rule 2 —
 * even the fake's response shapes are port-shaped, not "reversed"
 * authority shapes).
 *
 * Scriptable behaviors per submission id (deterministic):
 * - ACCEPT with a synthetic UUID + ICV-style counter (compliance payload
 *   fields ONLY — never platform document identity, ADR-0006)
 * - REJECT with reason codes (the rejection UX surface)
 * - TIMEOUT N times then ACCEPT (the retry path)
 * - POISON (always timeout → the dead-letter path after capped retries)
 */

export interface FakeAuthorityScript {
  /** "accept" | "reject" | "timeout-then-accept:<n>" | "poison" | "report" */
  readonly behavior: string;
  readonly rejectionCodes?: readonly string[];
}

/** A scripted, deterministic fake authority adapter (the port only). */
export class FakeZatcaAuthority implements EInvoicingAdapter {
  readonly id = "fake-zatca";
  readonly supportedCountries: readonly string[] = ["SA"];
  /** The harness flips this to true AFTER simulating a passed gate. */
  regimeVerified: boolean;

  private readonly scripts = new Map<string, FakeAuthorityScript>();
  private readonly timeoutsSeen = new Map<string, number>();
  private readonly submissionsSeen: string[] = [];
  private counter = 0;

  constructor(regimeVerified = true) {
    this.regimeVerified = regimeVerified;
  }

  /** Script a submission source id's behavior (deterministic per run). */
  script(sourceId: string, script: FakeAuthorityScript): this {
    this.scripts.set(sourceId, script);
    return this;
  }

  /** How many submit calls reached the fake (dedupe assertions). */
  get submitCallCount(): number {
    return this.submissionsSeen.length;
  }

  get submittedSourceIds(): readonly string[] {
    return [...this.submissionsSeen];
  }

  async submit(payload: SubmissionPayload): Promise<SubmissionOutcome> {
    this.submissionsSeen.push(payload.sourceId);
    if (!this.regimeVerified) {
      return {
        status: "FAILED",
        authorityReference: null,
        payloadDigest: null,
        error: { code: "UNVERIFIED_REGIME", note: "fake authority honors the verification gate" },
      };
    }
    const script = this.scripts.get(payload.sourceId) ?? { behavior: "accept" };
    const timeoutMatch = /^timeout-then-accept:(\d+)$/.exec(script.behavior);
    if (timeoutMatch !== null) {
      const required = Number(timeoutMatch[1]);
      const seen = (this.timeoutsSeen.get(payload.sourceId) ?? 0) + 1;
      this.timeoutsSeen.set(payload.sourceId, seen);
      if (seen <= required) {
        return {
          status: "FAILED",
          authorityReference: null,
          payloadDigest: null,
          error: { code: "AUTHORITY_TIMEOUT", note: `simulated timeout ${seen}/${required}` },
        };
      }
      return this.accepted(script.behavior === "timeout-then-accept:0" ? "report" : "accept");
    }
    switch (script.behavior) {
      case "reject":
        return {
          status: "REJECTED",
          authorityReference: null,
          payloadDigest: null,
          error: {
            code: "AUTHORITY_REJECTED",
            reasonCodes: script.rejectionCodes ?? ["SAMPLE-REJECT-1"],
            note: "simulated rejection with reason codes (user action required)",
          },
        };
      case "poison":
        return {
          status: "FAILED",
          authorityReference: null,
          payloadDigest: null,
          error: { code: "AUTHORITY_TIMEOUT", note: "poison message: always times out" },
        };
      case "report":
        return this.accepted("report");
      default:
        return this.accepted("accept");
    }
  }

  private accepted(mode: "accept" | "report"): SubmissionOutcome {
    this.counter += 1;
    const uuid = `FAKE-ZATCA-UUID-${String(this.counter).padStart(6, "0")}`;
    return {
      status: mode === "report" ? "ACCEPTED" : "ACCEPTED",
      authorityReference: uuid,
      payloadDigest: null,
      error: null,
    };
  }
}

/** A raw HTTP-shaped fake for webhook/ingress-style contract tests (fake-ETA shares the shape). */
export interface FakeAuthorityHttpResponse {
  readonly status: number;
  readonly body: string;
}

export function fakeAuthorityResponse(kind: "ok" | "rejected" | "timeout"): FakeAuthorityHttpResponse | null {
  switch (kind) {
    case "ok":
      return { status: 200, body: JSON.stringify({ accepted: true, uuid: "FAKE-ETA-UUID-000001" }) };
    case "rejected":
      return {
        status: 422,
        body: JSON.stringify({ accepted: false, reasonCodes: ["ETA-SAMPLE-1"] }),
      };
    case "timeout":
      return null; // connection silence — the retry path
  }
}
