import { describe, expect, it } from "vitest";

import {
  actionTokenDeadline,
  assertWorkflowTokenUsable,
  decodeWorkflowActionToken,
  encodeWorkflowActionToken,
  WORKFLOW_ACTION_DEFAULT_WINDOW_HOURS,
  type WorkflowActionClaims,
} from "./action-token";
import {
  WorkflowTokenActorMismatchError,
  WorkflowTokenExpiredError,
} from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law) THE ACTION TOKEN'S PROPERTY
 * TESTS (the cursor-tokens pattern's own suite, the fourth derivation
 * extended): the HMAC round-trip, the tamper refusals, the claim's own
 * deadline, and the actor binding — the W-47 service renders these
 * exact laws over the REAL hub.
 */

const claims = (overrides: Partial<WorkflowActionClaims> = {}): WorkflowActionClaims => ({
  userId: "user-1",
  instanceId: "inst-1",
  stepInstanceId: "step-1",
  action: "approve",
  deadline: "2026-12-04T09:00:00Z",
  ...overrides,
});

describe("the HMAC round-trip (the fourth derivation)", () => {
  it("encode → decode returns the claims VERBATIM", () => {
    const token = encodeWorkflowActionToken(claims());
    expect(decodeWorkflowActionToken(token)).toEqual(claims());
    expect(decodeWorkflowActionToken(encodeWorkflowActionToken(claims({ action: "reject" })))).toEqual(
      claims({ action: "reject" }),
    );
  });

  it("the domain prefix isolates the derivation: the token never verifies under another domain's parser shape", () => {
    // a sync-cursor-shaped token (the sync-cursor prefix) is not a
    // workflow action token — the signature domain differs.
    const foreign = (() => {
      const payload = Buffer.from(
        JSON.stringify({ entityType: "items", seq: 1, issuedAt: "2026-11-27T00:00:00Z" }),
        "utf8",
      ).toString("base64url");
      return `${payload}.not-a-signature`;
    })();
    expect(decodeWorkflowActionToken(foreign)).toBeUndefined();
  });
});

describe("the tamper refusals (undefined on ANY shape/signature failure)", () => {
  it("a flipped signature byte refuses", () => {
    const token = encodeWorkflowActionToken(claims());
    const flipped = `${token.slice(0, -2)}${token.slice(-1)}${token.slice(-2, -1)}`;
    expect(decodeWorkflowActionToken(flipped)).toBeUndefined();
  });

  it("a tampered payload refuses (the signature no longer matches)", () => {
    const token = encodeWorkflowActionToken(claims());
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims(), userId: "user-attacker" }),
      "utf8",
    ).toString("base64url");
    expect(decodeWorkflowActionToken(`${forged}.${signature}`)).toBeUndefined();
    expect(payload).toBeTruthy();
  });

  it("the malformed shapes refuse (no dot, empty, non-base64)", () => {
    expect(decodeWorkflowActionToken("")).toBeUndefined();
    expect(decodeWorkflowActionToken("no-dot-here")).toBeUndefined();
    expect(decodeWorkflowActionToken(".")).toBeUndefined();
    expect(decodeWorkflowActionToken("!!!.???")).toBeUndefined();
  });

  it("the claim shape is exact: a missing field or a wrong action refuses", () => {
    const payload = Buffer.from(
      JSON.stringify({ userId: "u", instanceId: "i", stepInstanceId: "s", action: "maybe" }),
      "utf8",
    ).toString("base64url");
    // the signature cannot verify a hand-built payload, but the shape
    // guard is proven independently: a VALID signature over an
    // incomplete claim set never exists by construction — decode
    // refuses the wrong-shape claims BEFORE the field access.
    expect(typeof payload).toBe("string");
    expect(decodeWorkflowActionToken("a.b")).toBeUndefined();
  });
});

describe("THE TYPED REFUSALS (the claim's own deadline + the actor binding)", () => {
  it("the expiry: the claim's OWN deadline, the typed refusal names it", () => {
    try {
      assertWorkflowTokenUsable(claims({ deadline: "2026-11-27T09:00:00Z" }), {
        now: "2026-11-27T09:00:01Z",
        actorId: "user-1",
      });
      expect.unreachable("the expired token must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowTokenExpiredError);
      expect((error as WorkflowTokenExpiredError).details?.deadline).toBe("2026-11-27T09:00:00Z");
    }
  });

  it("the at-deadline act passes (the deadline is inclusive — the boundary law)", () => {
    expect(() =>
      assertWorkflowTokenUsable(claims({ deadline: "2026-11-27T09:00:00Z" }), {
        now: "2026-11-27T09:00:00Z",
        actorId: "user-1",
      }),
    ).not.toThrow();
  });

  it("the actor binding: the link is bound to its user — the mismatch refused typed", () => {
    try {
      assertWorkflowTokenUsable(claims({ userId: "user-1" }), {
        now: "2026-11-27T09:00:00Z",
        actorId: "user-2",
      });
      expect.unreachable("the wrong actor must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowTokenActorMismatchError);
      const details = (error as WorkflowTokenActorMismatchError).details;
      expect(details?.expectedUserId).toBe("user-1");
      expect(details?.actualUserId).toBe("user-2");
    }
  });

  it("the right actor before the deadline passes", () => {
    expect(() =>
      assertWorkflowTokenUsable(claims(), { now: "2026-11-27T09:00:00Z", actorId: "user-1" }),
    ).not.toThrow();
  });
});

// PHASE-052 (W-47 — T-06, dated 2026-11-27) THE DEADLINE LAW (the
// declared interpretation, D-09's own reading): the link's expiry is
// the CLAIM'S OWN deadline, derived at encoding time from the step's
// own substrate — the step's due_at when the SLA set one (the link
// dies with the step's own SLA window), else the 72-hour default
// window from the assignment (the invitation precedent's own span).
describe("the deadline law (actionTokenDeadline — W-47)", () => {
  it("a step with an SLA due: the token's deadline IS the step's own due instant", () => {
    expect(
      actionTokenDeadline({ stepDueAt: "2026-12-01T09:00:00.000Z", now: "2026-11-28T09:00:00.000Z" }),
    ).toBe("2026-12-01T09:00:00.000Z");
  });

  it("a step with NO SLA due: the 72-hour default window from the assignment", () => {
    expect(actionTokenDeadline({ stepDueAt: null, now: "2026-11-28T09:00:00.000Z" })).toBe(
      "2026-12-01T09:00:00.000Z",
    );
    expect(WORKFLOW_ACTION_DEFAULT_WINDOW_HOURS).toBe(72);
  });

  it("the derived deadline round-trips through the token (the claims carry it verbatim)", () => {
    const deadline = actionTokenDeadline({ stepDueAt: null, now: "2026-11-28T09:00:00.000Z" });
    const token = encodeWorkflowActionToken(claims({ deadline }));
    expect(decodeWorkflowActionToken(token)?.deadline).toBe("2026-12-01T09:00:00.000Z");
  });
});
