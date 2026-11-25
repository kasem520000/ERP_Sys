import { describe, expect, it } from "vitest";

import {
  MILESTONE_RANKS,
  SHIPMENT_MILESTONES,
  driveDocumentStatus,
  isShipmentMilestone,
  milestoneRank,
} from "./tracking-fold";

/**
 * PHASE-051 (W-36 — T-13) the shipment tracking fold's PROPERTY TESTS
 * (the unit-first law — the pure layer proven BEFORE the service
 * renders it): the matrix's totality over the FULL status × event
 * product, the monotone ladder (the drive NEVER regresses — the
 * invariant asserted over the whole product), the idempotent diagonal,
 * the unknown-event and unknown-current typed refusals, and the rank
 * map's own shape.
 */

describe("the drive matrix (the total status × event product)", () => {
  it("TOTAL: every document rung × milestone carries a verdict — no undefined silence anywhere", () => {
    for (const current of SHIPMENT_MILESTONES) {
      for (const event of SHIPMENT_MILESTONES) {
        const verdict = driveDocumentStatus(current, event);
        expect(["ADVANCE", "NOOP", "REFUSED"]).toContain(verdict.outcome);
        expect(SHIPMENT_MILESTONES).toContain(verdict.from);
        if (verdict.outcome === "ADVANCE") {
          expect(verdict.to).not.toBeNull();
          expect(SHIPMENT_MILESTONES).toContain(verdict.to);
        } else {
          expect(verdict.to).toBeNull();
          expect(verdict.reason!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("THE MONOTONE LADDER (the invariant over the whole product): the drive never regresses — on ADVANCE the rung strictly rises, everywhere else the document never moves", () => {
    for (const current of SHIPMENT_MILESTONES) {
      for (const event of SHIPMENT_MILESTONES) {
        const verdict = driveDocumentStatus(current, event);
        const currentRank = MILESTONE_RANKS[current];
        if (verdict.outcome === "ADVANCE") {
          expect(MILESTONE_RANKS[verdict.to!]).toBeGreaterThan(currentRank);
          expect(verdict.to).toBe(event);
        } else {
          // NOOP or REFUSED — the document never moves.
          expect(verdict.to).toBeNull();
        }
      }
    }
  });

  it("THE SPINE: the ladder walks booked → departed → arrived → cleared → delivered, one rung at a time", () => {
    expect(driveDocumentStatus("BOOKED", "DEPARTED")).toEqual({
      outcome: "ADVANCE",
      from: "BOOKED",
      to: "DEPARTED",
      reason: null,
    });
    expect(driveDocumentStatus("DEPARTED", "ARRIVED").outcome).toBe("ADVANCE");
    expect(driveDocumentStatus("ARRIVED", "CLEARED").outcome).toBe("ADVANCE");
    expect(driveDocumentStatus("CLEARED", "DELIVERED").outcome).toBe("ADVANCE");
  });

  it("THE MULTI-RUNG LEAP: an event far above the current rung advances directly (the carrier reports the arrival of a booked shipment — the fold does not demand intermediate events)", () => {
    expect(driveDocumentStatus("BOOKED", "DELIVERED")).toEqual({
      outcome: "ADVANCE",
      from: "BOOKED",
      to: "DELIVERED",
      reason: null,
    });
    expect(driveDocumentStatus("BOOKED", "ARRIVED").to).toBe("ARRIVED");
    expect(driveDocumentStatus("DEPARTED", "CLEARED").to).toBe("CLEARED");
  });

  it("THE IDEMPOTENT DIAGONAL: the same-rung event re-asserts — the event records, the status stays", () => {
    for (const milestone of SHIPMENT_MILESTONES) {
      const verdict = driveDocumentStatus(milestone, milestone);
      expect(verdict.outcome).toBe("NOOP");
      expect(verdict.to).toBeNull();
      expect(verdict.reason).toContain("re-asserts");
    }
  });

  it("THE REGRESSING EVENT: every below-rung event refuses the drive — the refusal names the monotone ladder and both rungs", () => {
    const verdict = driveDocumentStatus("ARRIVED", "DEPARTED");
    expect(verdict.outcome).toBe("REFUSED");
    expect(verdict.to).toBeNull();
    expect(verdict.reason).toContain("never regresses");
    expect(verdict.reason).toContain("DEPARTED");
    expect(verdict.reason).toContain("ARRIVED");
    // The full strictly-below product refuses.
    for (const current of SHIPMENT_MILESTONES) {
      for (const event of SHIPMENT_MILESTONES) {
        if (MILESTONE_RANKS[event] < MILESTONE_RANKS[current]) {
          expect(driveDocumentStatus(current, event).outcome).toBe("REFUSED");
        }
      }
    }
  });

  it("THE UNKNOWN-EVENT TYPED REFUSAL (D-14's own demand): a milestone outside the vocabulary refuses with the vocabulary named", () => {
    for (const unknown of ["SAILING", "", "booked", "DELIVERED ", "CUSTOMS"]) {
      const verdict = driveDocumentStatus("BOOKED", unknown);
      expect(verdict.outcome).toBe("REFUSED");
      expect(verdict.reason).toContain("outside the carrier ladder");
      expect(verdict.reason).toContain(unknown);
    }
  });

  it("THE UNKNOWN-CURRENT REFUSAL: a document status outside the vocabulary never silently passes", () => {
    const verdict = driveDocumentStatus("LOST", "ARRIVED");
    expect(verdict.outcome).toBe("REFUSED");
    expect(verdict.reason).toContain("LOST");
    expect(verdict.reason).toContain("vocabulary floor");
  });
});

describe("the rank map (the fold's own substrate)", () => {
  it("the ladder's ranks: BOOKED 0 … DELIVERED 4, strictly increasing, exactly the 0122 vocabulary", () => {
    expect(SHIPMENT_MILESTONES).toEqual(["BOOKED", "DEPARTED", "ARRIVED", "CLEARED", "DELIVERED"]);
    expect(MILESTONE_RANKS.BOOKED).toBe(0);
    expect(MILESTONE_RANKS.DEPARTED).toBe(1);
    expect(MILESTONE_RANKS.ARRIVED).toBe(2);
    expect(MILESTONE_RANKS.CLEARED).toBe(3);
    expect(MILESTONE_RANKS.DELIVERED).toBe(4);
    let previous = -1;
    for (const milestone of SHIPMENT_MILESTONES) {
      expect(MILESTONE_RANKS[milestone]).toBeGreaterThan(previous);
      previous = MILESTONE_RANKS[milestone];
    }
  });

  it("the unknown probe: milestoneRank nulls outside the vocabulary; isShipmentMilestone guards the service's typed pre-check", () => {
    expect(milestoneRank("BOOKED")).toBe(0);
    expect(milestoneRank("NOPE")).toBeNull();
    expect(milestoneRank("")).toBeNull();
    expect(isShipmentMilestone("CLEARED")).toBe(true);
    expect(isShipmentMilestone("nope")).toBe(false);
  });
});
