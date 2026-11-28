import { requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/workflow.store";
import {
  assertWorkflowTokenUsable,
  decodeWorkflowActionToken,
} from "../domain/action-token";
import {
  WorkflowInputInvalidError,
  WorkflowStepAlreadyActedError,
  WorkflowStepInstanceNotFoundError,
} from "../domain/workflow-errors";
import {
  readDocumentFacts,
  WorkflowEngine,
} from "./workflow-engine";

/**
 * PHASE-052 (W-47 — T-06, dated 2026-11-27) THE DEEP-LINK SERVICE (D-09 —
 * the signed one-time links' own service layer). The W-43 token fold
 * carries the HMAC law; this service is its IO shell (the trade-engine
 * precedent's own shape — the folds render every move, this file binds
 * them to the store and the engine):
 *
 *   THE LINK RENDERING (the email leg's own material): the approve and
 *   reject tokens for a step assignment — the claims bound to user +
 *   instance + step + action with the DEADLINE LAW (the step's own
 *   due_at when the SLA set one, else the 72-hour default window from
 *   the assignment — the declared interpretation at the domain fold).
 *   The `${WEB_BASE_URL}/{locale}/workflow/act?token=…` URL shape is
 *   the EMAIL LEG's own rendering (the recipient's locale is the leg's
 *   resolution — the module wiring, never this service: the tokens are
 *   locale-free by design, one token renders in either locale).
 *
 *   THE ACT (D-09's own law, the acceptance #6 spine): the token is
 *   decoded (ANY tamper/shape failure is the typed WORKFLOW_INPUT_
 *   INVALID refusal — the cursor-tokens law: no partial parse, no
 *   lenient field), the claims asserted USABLE (the deadline → the
 *   typed WORKFLOW_TOKEN_EXPIRED; the actor → the typed
 *   WORKFLOW_TOKEN_ACTOR_MISMATCH — the link is bound to its user,
 *   the ACTING user is the session's own), then the act routes
 *   THROUGH THE ENGINE'S OWN PATH (actOnCurrentStep — the G-67 floor,
 *   the delegation resolution, the actor law, the CAS single-use
 *   stamp, the pointer walk, the notifications, the bus: every floor
 *   the module's own approve act rides, VERBATIM — never a parallel
 *   act path).
 *
 *   THE ONE-TIME PROPERTY (the CAS law): the step instance's OWN
 *   acted_at stamp is the ledger — a replayed link meets a non-PENDING
 *   step (or a step the pointer has passed) and takes the typed
 *   WORKFLOW_STEP_ALREADY_ACTED refusal. NO TOKEN TABLE (the stateless
 *   law — the stamp IS the single-use record).
 *
 *   THE ONLINE-ONLY LAW (the OFFLINE_CAPABILITIES_MATRIX row 16): the
 *   approve act is never queued, never faked offline — this service is
 *   the API's own synchronous surface; the mobile companion opens the
 *   link ONLINE and the act lands through this path or not at all.
 */
export class WorkflowDeepLinkService {
  constructor(private readonly engine: WorkflowEngine) {}

  /** THE ACT through a deep-link token (the acceptance #6 spine). The
   * actor is the SESSION's own user (never the claims' — the mismatch
   * refusal compares the two; the link authorizes, the session
   * authenticates). The verdict is the engine's own ChainVerdict
   * shape: the module-bound surfaces and the inbox/deep-link surfaces
   * see the SAME outcome contract. */
  async actThroughToken(input: {
    readonly token: string;
    readonly actorId: string;
    readonly comment: string | null;
  }): Promise<DeepLinkActOutcome> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("the deep-link act requires an ambient tenant scope");
    }
    // (1) THE DECODE — any tamper/shape failure is the typed input
    // refusal (no partial parse, no lenient field).
    const claims = decodeWorkflowActionToken(input.token);
    if (claims === undefined) {
      throw new WorkflowInputInvalidError({
        field: "token",
        reason: "the workflow action token failed verification (tampered, malformed, or not a workflow-action token)",
      });
    }
    // (2) THE CLAIMS' OWN FLOORS — the deadline and the actor binding
    // (the DB's own clock decides the expiry — the clock law, never a
    // JS wall clock; the reading below re-reads now() from the store's
    // own world through the step row's rendering).
    const step = await store.findStepInstanceById(claims.stepInstanceId);
    if (step === undefined) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: claims.stepInstanceId });
    }
    // The claims' instance must match the step's own instance (the
    // token binds all three; a mixed-up token is a tamper-class input
    // refusal — the HMAC would have caught a forged mix, this catches
    // the honest-but-stale reuse of a valid token against the wrong row).
    if (step.instanceId !== claims.instanceId) {
      throw new WorkflowInputInvalidError({
        field: "token",
        reason: `the token's instance ${claims.instanceId} does not match the step's own instance ${step.instanceId}`,
      });
    }
    const dbNow = await store.readDbNow();
    assertWorkflowTokenUsable(claims, { now: dbNow, actorId: input.actorId });
    // (3) THE CAS PRE-CHECK (the one-time property's own face): the
    // token's step must be the chain's CURRENT PENDING step — a step
    // already acted (or passed by the pointer) takes the typed
    // ALREADY_ACTED refusal BEFORE the engine's act path runs (the
    // engine acts on the CURRENT step; a stale token must never act on
    // the step the pointer has moved past).
    const instance = await store.findInstanceById(step.instanceId);
    if (instance === undefined) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: claims.stepInstanceId });
    }
    if (
      instance.status !== "ACTIVE" ||
      instance.currentStepOrder !== step.stepOrder ||
      step.status !== "PENDING"
    ) {
      throw new WorkflowStepAlreadyActedError({
        stepInstanceId: step.id,
        status: step.status === "PENDING" ? `passed by the pointer (instance ${instance.status})` : step.status,
      });
    }
    // (4) THE ENGINE'S OWN PATH — the G-67 floor, the delegation
    // resolution, the actor law, the CAS stamp, the pointer walk, the
    // notifications, the bus (VERBATIM — never a parallel act path).
    const facts = await readDocumentFacts(
      instance.triggerEntity as Parameters<typeof readDocumentFacts>[0],
      instance.triggerEntityId,
    );
    const outcome = await this.engine.actOnCurrentStep({
      instance,
      actorId: input.actorId,
      verdict: claims.action === "approve" ? "APPROVE" : "REJECT",
      comment: input.comment,
      facts,
    });
    return {
      action: claims.action,
      stepInstanceId: step.id,
      ...outcome,
    };
  }

  /** THE LINK PREVIEW (the act page's own read — the W-48 web plane
   * renders it; the API carries it so the page never parses the
   * claims itself): the step's rendering facts for a USABLE token.
   * The same decode/expire/actor floors as the act (a preview of a
   * dead link takes the same typed refusals — the page renders the
   * honest refusal, never a stale approval form). */
  async previewToken(input: {
    readonly token: string;
    readonly actorId: string;
  }): Promise<DeepLinkPreview> {
    requireTenantContext();
    const claims = decodeWorkflowActionToken(input.token);
    if (claims === undefined) {
      throw new WorkflowInputInvalidError({
        field: "token",
        reason: "the workflow action token failed verification (tampered, malformed, or not a workflow-action token)",
      });
    }
    const step = await store.findStepInstanceById(claims.stepInstanceId);
    if (step === undefined || step.instanceId !== claims.instanceId) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: claims.stepInstanceId });
    }
    const dbNow = await store.readDbNow();
    assertWorkflowTokenUsable(claims, { now: dbNow, actorId: input.actorId });
    const instance = await store.findInstanceById(step.instanceId);
    if (instance === undefined) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: claims.stepInstanceId });
    }
    const snapshot = instance.definitionSnapshot as {
      steps?: readonly { stepOrder: number; name: string; nameAr: string }[];
    };
    const meta = snapshot?.steps?.find((candidate) => candidate.stepOrder === step.stepOrder);
    const facts = await readDocumentFacts(
      instance.triggerEntity as Parameters<typeof readDocumentFacts>[0],
      instance.triggerEntityId,
    );
    return {
      action: claims.action,
      stepInstanceId: step.id,
      stepOrder: step.stepOrder,
      stepName: meta?.name ?? `Step ${step.stepOrder}`,
      stepNameAr: meta?.nameAr ?? `الخطوة ${step.stepOrder}`,
      instanceId: instance.id,
      triggerEntity: instance.triggerEntity,
      documentId: instance.triggerEntityId,
      documentNo: facts.docNo,
      amountBase: facts.amountBase,
      currency: facts.currency,
      deadline: claims.deadline,
      awaiting:
        instance.status === "ACTIVE" &&
        instance.currentStepOrder === step.stepOrder &&
        step.status === "PENDING",
    };
  }
}

/** The deep-link act's outcome (the engine's own verdict shape + the
 * link's own members — the API surface's typed contract). */
export interface DeepLinkActOutcome {
  readonly action: "approve" | "reject";
  readonly stepInstanceId: string;
  readonly completed: boolean;
  readonly remaining: number;
  readonly currentStepOrder: number | null;
  readonly completedSteps: number;
}

/** The link preview's rendering facts (the act page's own read). */
export interface DeepLinkPreview {
  readonly action: "approve" | "reject";
  readonly stepInstanceId: string;
  readonly stepOrder: number;
  readonly stepName: string;
  readonly stepNameAr: string;
  readonly instanceId: string;
  readonly triggerEntity: string;
  readonly documentId: string;
  readonly documentNo: string | null;
  readonly amountBase: string;
  readonly currency: string;
  readonly deadline: string;
  readonly awaiting: boolean;
}
