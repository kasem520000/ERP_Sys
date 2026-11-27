import { describe, expect, it } from "vitest";

import {
  assertAcyclic,
  assertNotSelfApproval,
  effectiveActor,
  type DelegationEdge,
} from "./delegation-graph";
import {
  WorkflowDelegationCircularError,
  WorkflowSelfApprovalBlockedError,
} from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law) THE DELEGATION GRAPH'S
 * PROPERTY TESTS (the D-07 fold proven BEFORE the resolution plane
 * renders it): the circularity walk's chain-naming refusals, the
 * effective-actor transitive closure, and G-67's own block — the
 * golden's own pure substrate (the W-50 transcript renders these exact
 * laws over the REAL store).
 */

const edge = (from: string, to: string): DelegationEdge => ({ fromUserId: from, toUserId: to });

describe("THE CIRCULARITY LAW (rejected at save — the typed refusal names the chain)", () => {
  it("a clean chain accepts the closing window's absence (no cycle)", () => {
    expect(() => assertAcyclic([edge("A", "B")], edge("C", "A"))).not.toThrow();
    expect(() => assertAcyclic([edge("A", "B"), edge("B", "C")], edge("D", "A"))).not.toThrow();
  });

  it("the DIRECT back-edge closes a cycle: A → B + B → A refused, the chain named", () => {
    try {
      assertAcyclic([edge("A", "B")], edge("B", "A"));
      expect.unreachable("the back-edge must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowDelegationCircularError);
      expect((error as WorkflowDelegationCircularError).details?.chain).toEqual(["B", "A", "B"]);
    }
  });

  it("THE TRANSITIVE CYCLE: C → A over A → B → C refused, the FULL closed chain named", () => {
    try {
      assertAcyclic([edge("A", "B"), edge("B", "C")], edge("C", "A"));
      expect.unreachable("the transitive cycle must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowDelegationCircularError);
      expect((error as WorkflowDelegationCircularError).details?.chain).toEqual([
        "C",
        "A",
        "B",
        "C",
      ]);
      expect((error as Error).message).toContain("C → A → B → C");
    }
  });

  it("the trivial cycle (from === to) refused — the DB floor's own class, defended here", () => {
    expect(() => assertAcyclic([], edge("A", "A"))).toThrow(WorkflowDelegationCircularError);
  });

  it("a LONGER transitive closure walks the whole chain (the four-hop cycle)", () => {
    try {
      assertAcyclic(
        [edge("A", "B"), edge("B", "C"), edge("C", "D")],
        edge("D", "A"),
      );
      expect.unreachable("the four-hop cycle must refuse");
    } catch (error) {
      expect((error as WorkflowDelegationCircularError).details?.chain).toEqual([
        "D",
        "A",
        "B",
        "C",
        "D",
      ]);
    }
  });

  it("a corrupt standing graph (a pre-existing cycle ON THE WALK) refuses rather than loops", () => {
    // the walk from the candidate's `to` meets the corrupt A ↔ B cycle
    // before it could ever reach the candidate's `from` — the defensive
    // guard refuses with the partial chain rather than looping forever.
    try {
      assertAcyclic([edge("A", "B"), edge("B", "A")], edge("C", "A"));
      expect.unreachable("the corrupt walk must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowDelegationCircularError);
      expect((error as WorkflowDelegationCircularError).details?.chain).toEqual([
        "A",
        "B",
        "A",
      ]);
    }
  });

  it("a corrupt cycle UNREACHABLE from the candidate's walk does not block the candidate (the save-time law checks the candidate's own closure)", () => {
    expect(() => assertAcyclic([edge("A", "B"), edge("B", "A")], edge("C", "D"))).not.toThrow();
  });
});

describe("THE EFFECTIVE-ACTOR WALK (the transitive closure)", () => {
  it("no window: the actor is his own effective actor (the chain of one)", () => {
    const walk = effectiveActor([], "A");
    expect(walk.effectiveActorId).toBe("A");
    expect(walk.chain).toEqual(["A"]);
  });

  it("the chain walks to its TERMINAL (the user whose authority the act exercises)", () => {
    const walk = effectiveActor([edge("A", "B"), edge("B", "C")], "A");
    expect(walk.effectiveActorId).toBe("C");
    expect(walk.chain).toEqual(["A", "B", "C"]);
  });

  it("a mid-chain entry walks from the actor's own window only", () => {
    const walk = effectiveActor([edge("A", "B"), edge("B", "C")], "B");
    expect(walk.effectiveActorId).toBe("C");
    expect(walk.chain).toEqual(["B", "C"]);
  });
});

describe("G-67 — THE GOLDEN'S OWN BLOCK (the reserved wording)", () => {
  it("THE DIRECT CASE: the creator is the step's own assignee (the chain of one)", () => {
    try {
      assertNotSelfApproval({ documentCreatorId: "A", stepAssigneeId: "A", edges: [] });
      expect.unreachable("the direct self-approval must block");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowSelfApprovalBlockedError);
      const details = (error as WorkflowSelfApprovalBlockedError).details;
      // the block names the chain and BOTH endpoints
      expect(details?.actorId).toBe("A");
      expect(details?.documentCreatorId).toBe("A");
      expect(details?.chain).toEqual(["A"]);
    }
  });

  it("THE TRANSITIVE CASE: another user's window names the creator as the delegate — the chain routes the act BACK to the creator, BLOCKED with the chain and both endpoints named", () => {
    // the step is assigned to X; X delegates to Y; Y delegates to C —
    // the document's own creator. The resolution chain X → Y → C makes
    // the creator his own document's approver through the chain.
    try {
      assertNotSelfApproval({
        documentCreatorId: "C",
        stepAssigneeId: "X",
        edges: [edge("X", "Y"), edge("Y", "C")],
      });
      expect.unreachable("the transitive self-approval must block");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowSelfApprovalBlockedError);
      const details = (error as WorkflowSelfApprovalBlockedError).details;
      expect(details?.actorId).toBe("C");
      expect(details?.documentCreatorId).toBe("C");
      expect(details?.chain).toEqual(["X", "Y", "C"]);
      expect((error as Error).message).toContain("X → Y → C");
      expect((error as Error).message).toContain("G-67");
    }
  });

  it("THE ONE-HOP TRANSITIVE CASE: X delegates directly to the creator", () => {
    try {
      assertNotSelfApproval({
        documentCreatorId: "C",
        stepAssigneeId: "X",
        edges: [edge("X", "C")],
      });
      expect.unreachable("the one-hop routed-back act must block");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowSelfApprovalBlockedError);
      expect((error as WorkflowSelfApprovalBlockedError).details?.chain).toEqual(["X", "C"]);
    }
  });

  it("A CLEAN CHAIN PASSES: the creator delegating HIS OWN step away is legal (the delegate approves)", () => {
    // the creator C is the assignee; C's absence window routes to A;
    // A acts — the terminal is A, not the creator. The legitimate
    // absence delegation.
    expect(() =>
      assertNotSelfApproval({
        documentCreatorId: "C",
        stepAssigneeId: "C",
        edges: [edge("C", "B"), edge("B", "A")],
      }),
    ).not.toThrow();
  });

  it("a clean chain with an unrelated creator passes", () => {
    expect(() =>
      assertNotSelfApproval({
        documentCreatorId: "D",
        stepAssigneeId: "X",
        edges: [edge("X", "Y"), edge("Y", "Z")],
      }),
    ).not.toThrow();
  });

  it("THE BR-034 DEFAULT-OFF ESCAPE: allowSelfApproval passes ONLY as the recorded decision", () => {
    expect(() =>
      assertNotSelfApproval({
        documentCreatorId: "A",
        stepAssigneeId: "A",
        edges: [],
        allowSelfApproval: true,
      }),
    ).not.toThrow();
    // the default (absent) stays BLOCKED — never a fallback flip
    expect(() =>
      assertNotSelfApproval({
        documentCreatorId: "A",
        stepAssigneeId: "A",
        edges: [],
        allowSelfApproval: false,
      }),
    ).toThrow(WorkflowSelfApprovalBlockedError);
  });
});
