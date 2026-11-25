import { describe, expect, it } from "vitest";

import {
  COLLECTION_MOVES,
  COLLECTION_STATUSES,
  COLLECTION_TERMS,
  collectionUsanceValid,
  nextCollectionMove,
  settlementPairValid,
  settlementWindow,
} from "./collections-lifecycle";

/**
 * PHASE-051 (W-35 — T-07) the documentary collections fold's PROPERTY
 * TESTS (the unit-first law — the pure layer proven BEFORE the service
 * renders it): the matrix's totality over the FULL status × move ×
 * terms product, the terminal law, the D/P vs D/A settlement windows,
 * the usance floor, the settlement pair law, and the stamp law's
 * OPEN-only exit.
 */

describe("the move matrix", () => {
  it("TOTAL: every status × move × terms carries a verdict — no undefined silence anywhere", () => {
    for (const status of COLLECTION_STATUSES) {
      for (const move of COLLECTION_MOVES) {
        for (const terms of COLLECTION_TERMS) {
          const verdict = nextCollectionMove(status, move, terms);
          expect(verdict.allowed === true || verdict.reason !== null).toBe(true);
          if (verdict.allowed) {
            expect(verdict.to).not.toBeNull();
            expect(COLLECTION_STATUSES).toContain(verdict.to);
          } else {
            expect(verdict.to).toBeNull();
            expect(verdict.reason!.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("THE TERMINAL LAW: no move leaves PAID or CANCELLED — the register is never rewritten", () => {
    for (const status of ["PAID", "CANCELLED"] as const) {
      for (const move of COLLECTION_MOVES) {
        for (const terms of COLLECTION_TERMS) {
          expect(nextCollectionMove(status, move, terms).allowed).toBe(false);
        }
      }
    }
  });

  it("THE D/P WINDOW (at sight): present → settle; the acceptance never exists", () => {
    expect(nextCollectionMove("OPEN", "present", "D/P")).toEqual({
      allowed: true,
      to: "PRESENTED",
      reason: null,
    });
    expect(nextCollectionMove("PRESENTED", "settle", "D/P")).toEqual({
      allowed: true,
      to: "PAID",
      reason: null,
    });
    for (const status of COLLECTION_STATUSES) {
      expect(nextCollectionMove(status, "accept", "D/P").allowed).toBe(false);
    }
  });

  it("THE D/A WINDOW (usance): present → accept → settle — the acceptance precedes the payment", () => {
    expect(nextCollectionMove("OPEN", "present", "D/A")).toEqual({
      allowed: true,
      to: "PRESENTED",
      reason: null,
    });
    expect(nextCollectionMove("PRESENTED", "accept", "D/A")).toEqual({
      allowed: true,
      to: "ACCEPTED",
      reason: null,
    });
    expect(nextCollectionMove("ACCEPTED", "settle", "D/A")).toEqual({
      allowed: true,
      to: "PAID",
      reason: null,
    });
  });

  it("THE USANCE SETTLEMENT GATE: a D/A collection refuses to settle before its acceptance", () => {
    const verdict = nextCollectionMove("PRESENTED", "settle", "D/A");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("accepts before it settles");
  });

  it("THE STAMP LAW'S EXIT: the cancellation window is OPEN only — the stamps are monotone evidence", () => {
    expect(nextCollectionMove("OPEN", "cancel", "D/P").allowed).toBe(true);
    expect(nextCollectionMove("OPEN", "cancel", "D/A").allowed).toBe(true);
    for (const status of ["PRESENTED", "ACCEPTED", "PAID", "CANCELLED"] as const) {
      for (const terms of COLLECTION_TERMS) {
        expect(nextCollectionMove(status, "cancel", terms).allowed).toBe(false);
      }
    }
  });

  it("the double presentation refuses by name — the stamp exists only on its own rung", () => {
    // PRESENTED/ACCEPTED: the stamp law's own message; PAID/CANCELLED:
    // the terminal law's (the terminal branch fires first — the
    // register is never rewritten at all).
    for (const terms of COLLECTION_TERMS) {
      expect(nextCollectionMove("PRESENTED", "present", terms).reason).toContain("presentation stamp");
      expect(nextCollectionMove("ACCEPTED", "present", terms).reason).toContain("presentation stamp");
      expect(nextCollectionMove("PAID", "present", terms).allowed).toBe(false);
      expect(nextCollectionMove("CANCELLED", "present", terms).allowed).toBe(false);
    }
  });
});

describe("the usance floor (0119's own constraint)", () => {
  it("a D/A collection carries its maturity from birth", () => {
    expect(collectionUsanceValid("D/A", "2027-03-31")).toEqual({ valid: true, reason: null });
    expect(collectionUsanceValid("D/A", null).valid).toBe(false);
    expect(collectionUsanceValid("D/A", null).reason).toContain("usance floor");
    expect(collectionUsanceValid("D/A", "").valid).toBe(false);
  });

  it("a D/P collection pays at sight — its due_date stays free", () => {
    expect(collectionUsanceValid("D/P", null)).toEqual({ valid: true, reason: null });
    expect(collectionUsanceValid("D/P", "2027-03-31")).toEqual({ valid: true, reason: null });
  });
});

describe("the settlement pair law (0119's XOR floor)", () => {
  it("the pair lands together or not at all", () => {
    expect(settlementPairValid(null, null)).toEqual({ valid: true, reason: null });
    expect(settlementPairValid("2027-01-05T10:00:00Z", "RECEIPT-2027-000123")).toEqual({
      valid: true,
      reason: null,
    });
    expect(settlementPairValid("2027-01-05T10:00:00Z", null).valid).toBe(false);
    expect(settlementPairValid(null, "RECEIPT-2027-000123").valid).toBe(false);
    expect(settlementPairValid(null, "RECEIPT-2027-000123").reason).toContain("XOR floor");
  });
});

describe("the settlement window (the D/P vs D/A pair as data)", () => {
  it("D/P settles from PRESENTED; D/A settles from ACCEPTED — the service reads this VERBATIM", () => {
    expect(settlementWindow("D/P")).toEqual(["PRESENTED"]);
    expect(settlementWindow("D/A")).toEqual(["ACCEPTED"]);
    for (const terms of COLLECTION_TERMS) {
      for (const from of settlementWindow(terms)) {
        expect(nextCollectionMove(from, "settle", terms).allowed).toBe(true);
      }
    }
  });
});
