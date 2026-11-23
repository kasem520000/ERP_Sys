import { describe, expect, it } from "vitest";

import {
  CAPA_STATUSES,
  capaActionsValid,
  capaCloseGate,
  nextCapaMove,
  type CapaAction,
  type CapaMove,
  type CapaStatus,
} from "./capa-lifecycle";

/**
 * PHASE-050 (W-26 — T-07, 2026-11-23) the CAPA lifecycle fold's property
 * pack (the ncr-lifecycle.spec precedent): the TOTAL status × move
 * matrix walked cell by cell, the actions array's shape law refused at
 * every malformed axis, and BR-103's gate arms proven on both conditions
 * (the pending windows with their figures; the effectiveness record) —
 * the pure layer before any consumer lands (the unit-first law).
 */

const TODAY = "2026-11-23";

function action(partial: Partial<CapaAction>): CapaAction {
  return {
    title: partial.title ?? "The corrective action",
    ownerEmployeeId: partial.ownerEmployeeId ?? null,
    dueDate: partial.dueDate ?? null,
    completedAt: partial.completedAt ?? null,
  };
}

describe("PHASE-050 W-26 — T-07: the CAPA move matrix (the total grid)", () => {
  it("every status × move cell is decided — the grid walked in full", () => {
    const moves: CapaMove[] = ["root_cause", "actions", "external_cost", "close"];
    const decided = new Set<string>();
    for (const status of CAPA_STATUSES) {
      for (const move of moves) {
        const verdict = nextCapaMove(status as CapaStatus, move);
        decided.add(`${status}+${move}=${verdict.allowed ? "OK" : verdict.refusal}`);
        expect(verdict.reason === undefined || verdict.reason.length > 0).toBe(true);
      }
    }
    expect(decided).toEqual(
      new Set([
        "OPEN+root_cause=OK",
        "OPEN+actions=OK",
        "OPEN+external_cost=NOT_STARTED",
        "OPEN+close=NOT_STARTED",
        "IN_PROGRESS+root_cause=OK",
        "IN_PROGRESS+actions=OK",
        "IN_PROGRESS+external_cost=OK",
        "IN_PROGRESS+close=OK",
        "CLOSED+root_cause=ALREADY_CLOSED",
        "CLOSED+actions=ALREADY_CLOSED",
        "CLOSED+external_cost=ALREADY_CLOSED",
        "CLOSED+close=ALREADY_CLOSED",
      ]),
    );
  });

  it("CLOSED refuses every move — the register is evidence (the reason carried verbatim)", () => {
    for (const move of ["root_cause", "actions", "external_cost", "close"] as const) {
      const verdict = nextCapaMove("CLOSED", move);
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusal).toBe("ALREADY_CLOSED");
      expect(verdict.reason).toContain("the register is evidence");
    }
  });

  it("OPEN refuses the external_cost and the close — NOT_STARTED, the 0114 stamp gate's own wording", () => {
    const cost = nextCapaMove("OPEN", "external_cost");
    expect(cost.allowed).toBe(false);
    expect(cost.refusal).toBe("NOT_STARTED");
    expect(cost.reason).toContain("the 0114 stamp gate");
    const close = nextCapaMove("OPEN", "close");
    expect(close.allowed).toBe(false);
    expect(close.refusal).toBe("NOT_STARTED");
    expect(close.reason).toContain("from IN_PROGRESS");
  });

  it("the single-use cost stamp: IN_PROGRESS + the witness refuses COST_ALREADY_RECORDED (INV-013's sibling)", () => {
    expect(nextCapaMove("IN_PROGRESS", "external_cost").allowed).toBe(true);
    const stamped = nextCapaMove("IN_PROGRESS", "external_cost", { hasCostStamp: true });
    expect(stamped.allowed).toBe(false);
    expect(stamped.refusal).toBe("COST_ALREADY_RECORDED");
    expect(stamped.reason).toContain("single-use");
    // The witness never affects the other cells.
    expect(nextCapaMove("IN_PROGRESS", "close", { hasCostStamp: true }).allowed).toBe(true);
    expect(nextCapaMove("OPEN", "external_cost", { hasCostStamp: true }).refusal).toBe(
      "NOT_STARTED",
    );
  });
});

describe("PHASE-050 W-26 — T-07: the actions array's shape law (the canonical jsonb shape)", () => {
  it("the canonical array parses to the canonical cells (nulls explicit)", () => {
    const verdict = capaActionsValid([
      {
        title: "Replace the gasket",
        ownerEmployeeId: "5a5a5a5a-0000-4000-8000-0000000005a1",
        dueDate: "2026-11-15",
        completedAt: "2026-11-14T09:30:00.000Z",
      },
      { title: "Retrain the operator", ownerEmployeeId: null, dueDate: null, completedAt: null },
    ]);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.actions).toHaveLength(2);
      expect(verdict.actions[0]!.completedAt).toBe("2026-11-14T09:30:00.000Z");
      expect(verdict.actions[1]!.ownerEmployeeId).toBeNull();
    }
  });

  it("a non-object cell is refused with its index", () => {
    const verdict = capaActionsValid(["not an object"]);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("actions[0]");
  });

  it("the title law (1…500) and the malformed axes are refused each naming the cell and field", () => {
    expect((capaActionsValid([{ title: "" }]) as { ok: false }).ok).toBe(false);
    const longTitle = capaActionsValid([{ title: "x".repeat(501) }]);
    expect(longTitle.ok).toBe(false);
    const badOwner = capaActionsValid([
      { title: "T", ownerEmployeeId: "not-a-uuid" },
    ]);
    expect(badOwner.ok).toBe(false);
    if (!badOwner.ok) expect(badOwner.reason).toContain("ownerEmployeeId");
    const badDue = capaActionsValid([{ title: "T", dueDate: "15/11/2026" }]);
    expect(badDue.ok).toBe(false);
    if (!badDue.ok) expect(badDue.reason).toContain("dueDate");
    const badStamp = capaActionsValid([{ title: "T", completedAt: "yesterday" }]);
    expect(badStamp.ok).toBe(false);
    if (!badStamp.ok) expect(badStamp.reason).toContain("completedAt");
  });
});

describe("PHASE-050 W-26 — T-07: BR-103's gate (D-10's two conditions, exactly)", () => {
  it("an empty array + the recorded check closes (the two conditions met)", () => {
    const verdict = capaCloseGate({
      actions: [],
      effectiveness: { summary: "Verified", effective: true },
      today: TODAY,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("a completed action never blocks — even one with a future due date", () => {
    const verdict = capaCloseGate({
      actions: [action({ dueDate: "2027-01-01", completedAt: "2026-11-20T10:00:00.000Z" })],
      effectiveness: { summary: "Verified", effective: true },
      today: TODAY,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("an open action with a FUTURE due date BLOCKS — the refusal carries the figures (D-10)", () => {
    const verdict = capaCloseGate({
      actions: [action({ dueDate: TODAY }), action({ dueDate: "2026-12-01" })],
      effectiveness: { summary: "Verified", effective: true },
      today: TODAY,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.refusal).toBe("ACTIONS_PENDING");
    expect(verdict.figures).toEqual({
      openActionCount: 2,
      pendingCount: 1,
      pendingDueDates: ["2026-12-01"],
    });
  });

  it("an open action with NO due date BLOCKS — no declared window can never prove its passage (fail-closed)", () => {
    const verdict = capaCloseGate({
      actions: [action({ dueDate: null })],
      effectiveness: { summary: "Verified", effective: true },
      today: TODAY,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.figures).toEqual({
      openActionCount: 1,
      pendingCount: 1,
      pendingDueDates: [null],
    });
  });

  it("an open action whose window ELAPSED does not block (the effectiveness check records what happened)", () => {
    const verdict = capaCloseGate({
      actions: [action({ dueDate: "2026-10-01" })],
      effectiveness: { summary: "Verified late — the window elapsed", effective: false },
      today: TODAY,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("the boundary is inclusive: an open action due TODAY has its window elapsed", () => {
    const yesterday = capaCloseGate({
      actions: [action({ dueDate: "2026-11-22" })],
      effectiveness: { summary: "V", effective: true },
      today: TODAY,
    });
    expect(yesterday.allowed).toBe(true);
    const today = capaCloseGate({
      actions: [action({ dueDate: TODAY })],
      effectiveness: { summary: "V", effective: true },
      today: TODAY,
    });
    expect(today.allowed).toBe(true);
    const tomorrow = capaCloseGate({
      actions: [action({ dueDate: "2026-11-24" })],
      effectiveness: { summary: "V", effective: true },
      today: TODAY,
    });
    expect(tomorrow.allowed).toBe(false);
  });

  it("the effectiveness condition: a missing check refuses EVEN with every window elapsed", () => {
    const verdict = capaCloseGate({
      actions: [action({ dueDate: "2026-10-01", completedAt: "2026-10-02T00:00:00.000Z" })],
      effectiveness: null,
      today: TODAY,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.refusal).toBe("EFFECTIVENESS_REQUIRED");
  });

  it("the pending windows are checked FIRST — the figures carry the temporal half (the refusal order law)", () => {
    const verdict = capaCloseGate({
      actions: [action({ dueDate: "2026-12-01" })],
      effectiveness: null,
      today: TODAY,
    });
    expect(verdict.refusal).toBe("ACTIONS_PENDING");
  });

  it("the outcome is the tenant's honest record — a negative check with every window elapsed closes (D-10 demands the CHECK RECORDED, never a forced verdict)", () => {
    const verdict = capaCloseGate({
      actions: [action({ dueDate: "2026-10-01", completedAt: "2026-10-05T00:00:00.000Z" })],
      effectiveness: { summary: "Not effective — escalation opened", effective: false },
      today: TODAY,
    });
    expect(verdict.allowed).toBe(true);
  });
});
