import { describe, expect, it } from "vitest";

import {
  AMENDMENT_CHANGE_TYPES,
  LC_MOVES,
  LC_STATUSES,
  amendmentTypedShapeValid,
  checklistTransitionValid,
  hasLiveMargin,
  marginAdjustmentPlan,
  nextLcMove,
} from "./lc-lifecycle";

/**
 * PHASE-051 (W-34 — T-05) the LC lifecycle fold's PROPERTY TESTS (the
 * unit-first law — the pure layer proven BEFORE the service renders it):
 * the matrix's totality, the terminal law, the margin exit law, the
 * typed-change law's four floors, the adjustment arithmetic's 4dp
 * exactness, and the checklist monotone law.
 */

describe("the move matrix", () => {
  it("TOTAL: every status × move carries a verdict — no undefined silence anywhere", () => {
    for (const status of LC_STATUSES) {
      for (const move of LC_MOVES) {
        const verdict = nextLcMove(status, move);
        expect(verdict.allowed === true || verdict.reason !== null).toBe(true);
        if (verdict.allowed) {
          expect(verdict.to).not.toBeNull();
          expect(LC_STATUSES).toContain(verdict.to);
        } else {
          expect(verdict.to).toBeNull();
          expect(verdict.reason!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("THE TERMINAL LAW: no move leaves RETIRED or CANCELLED — the register is never rewritten", () => {
    for (const status of ["RETIRED", "CANCELLED"] as const) {
      for (const move of LC_MOVES) {
        expect(nextLcMove(status, move).allowed).toBe(false);
      }
    }
  });

  it("the ladder's spine: DRAFT → ISSUED → RETIRED; the sweep's own rung ISSUED → EXPIRED; EXPIRED retires late", () => {
    expect(nextLcMove("DRAFT", "issue")).toEqual({ allowed: true, to: "ISSUED", reason: null });
    expect(nextLcMove("ISSUED", "retire")).toEqual({ allowed: true, to: "RETIRED", reason: null });
    expect(nextLcMove("ISSUED", "expire")).toEqual({ allowed: true, to: "EXPIRED", reason: null });
    expect(nextLcMove("EXPIRED", "retire")).toEqual({ allowed: true, to: "RETIRED", reason: null });
  });

  it("THE AMENDMENT WINDOW: amendments ride the ISSUED instrument only", () => {
    expect(nextLcMove("ISSUED", "amend").allowed).toBe(true);
    for (const status of ["DRAFT", "RETIRED", "EXPIRED", "CANCELLED"] as const) {
      expect(nextLcMove(status, "amend").allowed).toBe(false);
    }
  });

  it("THE CHECKLIST WINDOWS: the bank process rides ISSUED and EXPIRED (the instrument the bank holds)", () => {
    expect(nextLcMove("ISSUED", "checklist").allowed).toBe(true);
    expect(nextLcMove("EXPIRED", "checklist").allowed).toBe(true);
    for (const status of ["DRAFT", "RETIRED", "CANCELLED"] as const) {
      expect(nextLcMove(status, "checklist").allowed).toBe(false);
    }
  });

  it("THE FEE WINDOWS (T-06): fees ride the live instrument the bank holds — ISSUED and EXPIRED", () => {
    expect(nextLcMove("ISSUED", "fee").allowed).toBe(true);
    expect(nextLcMove("EXPIRED", "fee").allowed).toBe(true);
    for (const status of ["DRAFT", "RETIRED", "CANCELLED"] as const) {
      expect(nextLcMove(status, "fee").allowed).toBe(false);
    }
  });

  it("THE MARGIN EXIT LAW: the live carriers are ISSUED and EXPIRED (the stamp's own floors)", () => {
    expect(hasLiveMargin("ISSUED")).toBe(true);
    expect(hasLiveMargin("EXPIRED")).toBe(true);
    expect(hasLiveMargin("DRAFT")).toBe(false);
    expect(hasLiveMargin("RETIRED")).toBe(false);
    expect(hasLiveMargin("CANCELLED")).toBe(false);
  });
});

describe("the typed-change law (0119's floors)", () => {
  it("each typed dimension's own floor — the missing shape refused with its reason", () => {
    expect(
      amendmentTypedShapeValid({
        changeType: "VALUE",
        valueFrom: null,
        valueTo: "120000.0000",
        expiryFrom: null,
        expiryTo: null,
        documentsNote: null,
        summary: null,
      }).valid,
    ).toBe(false);
    expect(
      amendmentTypedShapeValid({
        changeType: "VALIDITY",
        valueFrom: null,
        valueTo: null,
        expiryFrom: "2027-01-31",
        expiryTo: null,
        documentsNote: null,
        summary: null,
      }).valid,
    ).toBe(false);
    expect(
      amendmentTypedShapeValid({
        changeType: "DOCUMENTS",
        valueFrom: null,
        valueTo: null,
        expiryFrom: null,
        expiryTo: null,
        documentsNote: null,
        summary: null,
      }).valid,
    ).toBe(false);
    expect(
      amendmentTypedShapeValid({
        changeType: "OTHER",
        valueFrom: null,
        valueTo: null,
        expiryFrom: null,
        expiryTo: null,
        documentsNote: null,
        summary: null,
      }).valid,
    ).toBe(false);
  });

  it("the legal shapes all pass", () => {
    expect(
      amendmentTypedShapeValid({
        changeType: "VALUE",
        valueFrom: "100000.0000",
        valueTo: "120000.0000",
        expiryFrom: null,
        expiryTo: null,
        documentsNote: null,
        summary: null,
      }).valid,
    ).toBe(true);
    expect(
      amendmentTypedShapeValid({
        changeType: "VALIDITY",
        valueFrom: null,
        valueTo: null,
        expiryFrom: "2027-01-31",
        expiryTo: "2027-03-31",
        documentsNote: null,
        summary: null,
      }).valid,
    ).toBe(true);
    expect(
      amendmentTypedShapeValid({
        changeType: "DOCUMENTS",
        valueFrom: null,
        valueTo: null,
        expiryFrom: null,
        expiryTo: null,
        documentsNote: "the invoice replaces the packing list",
        summary: null,
      }).valid,
    ).toBe(true);
    expect(
      amendmentTypedShapeValid({
        changeType: "OTHER",
        valueFrom: null,
        valueTo: null,
        expiryFrom: null,
        expiryTo: null,
        documentsNote: null,
        summary: "the advising bank changed",
      }).valid,
    ).toBe(true);
  });

  it("the vocabulary is closed — an unknown type refused BY NAME", () => {
    const verdict = amendmentTypedShapeValid({
      changeType: "MARGIN" as unknown as "VALUE",
      valueFrom: null,
      valueTo: null,
      expiryFrom: null,
      expiryTo: null,
      documentsNote: null,
      summary: null,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain("MARGIN");
    expect(AMENDMENT_CHANGE_TYPES).toEqual(["VALUE", "VALIDITY", "DOCUMENTS", "OTHER"]);
  });
});

describe("the G-64 margin adjustment arithmetic (D-05's pair)", () => {
  it("a null newMargin carries NO adjustment (the amendment touched another dimension)", () => {
    expect(marginAdjustmentPlan("25000.0000", null)).toEqual({
      direction: "NONE",
      delta: "0.0000",
    });
  });

  it("an increase deposits more; a decrease releases part — the pair symmetric, the delta absolute at 4dp", () => {
    expect(marginAdjustmentPlan("25000.0000", "40000.0000")).toEqual({
      direction: "INCREASE",
      delta: "15000.0000",
    });
    expect(marginAdjustmentPlan("40000.0000", "25000.0000")).toEqual({
      direction: "DECREASE",
      delta: "15000.0000",
    });
  });

  it("an unchanged margin is NO adjustment (the single-use key never fires on a no-op)", () => {
    expect(marginAdjustmentPlan("25000.0000", "25000.0000")).toEqual({
      direction: "NONE",
      delta: "0.0000",
    });
  });

  it("the 4dp exactness: half-up at the boundary (ADR-0009's money scale)", () => {
    expect(marginAdjustmentPlan("0.0000", "0.00005").delta).toBe("0.0001");
    expect(marginAdjustmentPlan("0.00005", "0.0000").delta).toBe("0.0001");
    expect(marginAdjustmentPlan("100.0000", "100.00004").delta).toBe("0.0000");
  });
});

describe("the checklist monotone law (the 0119 floors' fold)", () => {
  it("the monotone stamps: presentation and verification never regress", () => {
    expect(checklistTransitionValid({ presented: true, verified: false }, { presented: false, verified: false }).allowed).toBe(false);
    expect(checklistTransitionValid({ presented: true, verified: true }, { presented: true, verified: false }).allowed).toBe(false);
  });

  it("an unpresented document is never verified (the bank's own floor)", () => {
    expect(checklistTransitionValid({ presented: false, verified: false }, { presented: false, verified: true }).allowed).toBe(false);
  });

  it("the legal ceremonies: present → verify; the same-day composed step", () => {
    expect(checklistTransitionValid({ presented: false, verified: false }, { presented: true, verified: false }).allowed).toBe(true);
    expect(checklistTransitionValid({ presented: true, verified: false }, { presented: true, verified: true }).allowed).toBe(true);
    expect(checklistTransitionValid({ presented: false, verified: false }, { presented: true, verified: true }).allowed).toBe(true);
  });

  it("the settled state is idempotent (a re-write of the same stamps passes)", () => {
    expect(checklistTransitionValid({ presented: true, verified: true }, { presented: true, verified: true }).allowed).toBe(true);
    expect(checklistTransitionValid({ presented: false, verified: false }, { presented: false, verified: false }).allowed).toBe(true);
  });
});
