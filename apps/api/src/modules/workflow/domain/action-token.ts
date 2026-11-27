import { createHmac } from "node:crypto";

import { keyMaterialForTokens } from "../../identity/infrastructure/reset-token-key";
import {
  WorkflowTokenActorMismatchError,
  WorkflowTokenExpiredError,
} from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law, 2026-11-27) THE DEEP-LINK
 * ACTION TOKEN (D-09 — the stateless HMAC law, the cursor-tokens
 * pattern's FOURTH derivation from the one identity secret: reset
 * tokens · sync cursors · device tokens · NOW workflow actions — one
 * secret, four domain-prefixed derivations, one rotation story).
 *
 * THE TOKEN: `${payload}.${signature}` where the payload is the
 * base64url claims and the signature is HMAC-SHA256 over
 * `workflow-action:${payload}` (the domain-prefixed derivation — never
 * the raw session, never the session token embedded). The claims:
 * `{userId, instanceId, stepInstanceId, action approve|reject,
 * deadline}` — the link is BOUND to user + instance + action and
 * expires at its own claimed deadline.
 *
 * THE ONE-TIME PROPERTY (D-09's own law): the CAS is the step
 * instance's OWN single-use acted_at stamp — a replayed link meets a
 * non-PENDING step and takes the typed WORKFLOW_STEP_ALREADY_ACTED
 * refusal (the state machine's own fold, never a token table). NO
 * TOKEN TABLE (the CAS is the ledger).
 *
 * THE TYPED REFUSALS: the expiry is the claim's own deadline
 * (WORKFLOW_TOKEN_EXPIRED); the wrong actor the typed
 * WORKFLOW_TOKEN_ACTOR_MISMATCH. The comment captures with the act
 * (the state machine's fold). The mobile companion affordance stays
 * ONLINE-ONLY (the OFFLINE_CAPABILITIES_MATRIX row 16 law — the
 * approve act is never queued, never faked offline).
 *
 * THE LINK SHAPE (the W-47 service renders it):
 * `${WEB_BASE_URL}/{locale}/workflow/act?token=…`.
 */

/** The deep-link claims — bound to user + instance + step + action
 * with the claim's own deadline. */
export interface WorkflowActionClaims {
  readonly userId: string;
  readonly instanceId: string;
  readonly stepInstanceId: string;
  readonly action: "approve" | "reject";
  /** The expiry — the claim's OWN deadline (ISO instant), never a
   * stored TTL. */
  readonly deadline: string;
}

function sign(payload: string): string {
  return createHmac("sha256", keyMaterialForTokens())
    .update(`workflow-action:${payload}`)
    .digest("base64url");
}

/** Encode the action claims into the opaque token the email/mobile
 * legs carry (the 041 hub's templates render it into the link). */
export function encodeWorkflowActionToken(claims: WorkflowActionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Decode + verify; returns undefined on ANY tamper/shape failure (the
 * cursor-tokens law: no partial parse, no lenient field). */
export function decodeWorkflowActionToken(token: string): WorkflowActionClaims | undefined {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length) return undefined;
  if (!timingSafeEqualString(signature, expected)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof claims.userId !== "string" ||
      typeof claims.instanceId !== "string" ||
      typeof claims.stepInstanceId !== "string" ||
      (claims.action !== "approve" && claims.action !== "reject") ||
      typeof claims.deadline !== "string"
    ) {
      return undefined;
    }
    return {
      userId: claims.userId,
      instanceId: claims.instanceId,
      stepInstanceId: claims.stepInstanceId,
      action: claims.action,
      deadline: claims.deadline,
    };
  } catch {
    return undefined;
  }
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Assert the decoded claims are USABLE at this act: the deadline
 * (the claim's own) and the actor (the link's bound user) — the typed
 * refusals name each (the ALREADY_ACTED refusal is the state
 * machine's own fold, exercised after this check by the act itself). */
export function assertWorkflowTokenUsable(
  claims: WorkflowActionClaims,
  input: { readonly now: string; readonly actorId: string },
): void {
  if (new Date(input.now).getTime() > new Date(claims.deadline).getTime()) {
    throw new WorkflowTokenExpiredError({ deadline: claims.deadline, now: input.now });
  }
  if (claims.userId !== input.actorId) {
    throw new WorkflowTokenActorMismatchError({
      expectedUserId: claims.userId,
      actualUserId: input.actorId,
    });
  }
}
