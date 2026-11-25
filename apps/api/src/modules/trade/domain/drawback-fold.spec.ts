import { describe, expect, it } from "vitest";

import {
  DRAWBACK_MOVES,
  DRAWBACK_STATUSES,
  drawbackEvidenceSatisfied,
  isExportDeclarationType,
  nextDrawbackMove,
  type DrawbackMove,
} from "./drawback-fold";

/**
 * PHASE-051 (W-38 — T-12) the drawback workflow fold's property tests
 * (the plan's §4 unit-first law: the PURE module FIRST — the service
 * renders the fold's verdicts VERBATIM, so the ladder and the evidence
 * gate are the contract).
 */

const DECL = "11111111-1111-4111-8111-111111111111";
const BL = "22222222-2222-4222-8222-222222222222";

describe("the drawback workflow fold (D-12 — the ladder)", () => {
  it("THE LADDER: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED; APPROVED → PAID", () => {
    expect(nextDrawbackMove("DRAFT", "submit")).toEqual({ allowed: true, to: "SUBMITTED", reason: null });
    expect(nextDrawbackMove("SUBMITTED", "review")).toEqual({ allowed: true, to: "UNDER_REVIEW", reason: null });
    expect(nextDrawbackMove("UNDER_REVIEW", "approve")).toEqual({ allowed: true, to: "APPROVED", reason: null });
    expect(nextDrawbackMove("UNDER_REVIEW", "reject")).toEqual({ allowed: true, to: "REJECTED", reason: null });
    expect(nextDrawbackMove("APPROVED", "pay")).toEqual({ allowed: true, to: "PAID", reason: null });
  });

  it("THE TERMINAL RUNGS: REJECTED and PAID refuse EVERY move — the register is the audit trail", () => {
    for (const status of ["REJECTED", "PAID"] as const) {
      for (const move of DRAWBACK_MOVES) {
        const verdict = nextDrawbackMove(status, move);
        expect(verdict.allowed).toBe(false);
        expect(verdict.to).toBeNull();
      }
    }
  });

  it("THE LINK ACT rides the DRAFT rung ONLY — once submitted, the proof of export is the authority's own record", () => {
    expect(nextDrawbackMove("DRAFT", "link")).toEqual({ allowed: true, to: "DRAFT", reason: null });
    const refused = nextDrawbackMove("SUBMITTED", "link");
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toContain("DRAFT rung only");
  });

  it("THE DRAFT-ONLY SUBMISSION WINDOW: no rung re-submits (the submitted_at stamp never un-stamps)", () => {
    for (const status of DRAWBACK_STATUSES) {
      if (status === "DRAFT") {
        continue;
      }
      const verdict = nextDrawbackMove(status, "submit");
      expect(verdict.allowed).toBe(false);
    }
  });

  it("THE VERDICT RUNGS: approve and reject enter from UNDER_REVIEW only — the review is the rung", () => {
    for (const status of DRAWBACK_STATUSES) {
      const approve = nextDrawbackMove(status, "approve");
      const reject = nextDrawbackMove(status, "reject");
      if (status === "UNDER_REVIEW") {
        expect(approve.allowed).toBe(true);
        expect(reject.allowed).toBe(true);
      } else {
        expect(approve.allowed).toBe(false);
        expect(reject.allowed).toBe(false);
      }
    }
  });

  it("THE PAY RUNG: only APPROVED pays — the refund's own rung (the money lands through treasury, 053's surface)", () => {
    for (const status of DRAWBACK_STATUSES) {
      const verdict = nextDrawbackMove(status, "pay");
      if (status === "APPROVED") {
        expect(verdict.allowed).toBe(true);
      } else {
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toContain("treasury");
      }
    }
  });

  it("THE UNKNOWN MOVE refuses with the vocabulary's own reason (the fold never throws)", () => {
    const verdict = nextDrawbackMove("DRAFT", "cancel" as DrawbackMove);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("unknown move");
  });

  it("PROPERTY: the full product — every (status, move) pair carries a verdict and the allowed pairs form exactly the ladder's edges", () => {
    const allowedEdges = new Set<string>();
    for (const status of DRAWBACK_STATUSES) {
      for (const move of DRAWBACK_MOVES) {
        const verdict = nextDrawbackMove(status, move);
        if (verdict.allowed) {
          allowedEdges.add(`${status} --${move}--> ${verdict.to}`);
          // Every allowed move lands on the ladder's own rung (or holds
          // DRAFT for the link act).
          expect(DRAWBACK_STATUSES).toContain(verdict.to);
        } else {
          expect(verdict.reason).not.toBeNull();
        }
      }
    }
    expect(allowedEdges.size).toBe(6); // link, submit, review, approve, reject, pay — one edge each
    expect(allowedEdges.has("DRAFT --link--> DRAFT")).toBe(true);
    expect(allowedEdges.has("DRAFT --submit--> SUBMITTED")).toBe(true);
    expect(allowedEdges.has("SUBMITTED --review--> UNDER_REVIEW")).toBe(true);
    expect(allowedEdges.has("UNDER_REVIEW --approve--> APPROVED")).toBe(true);
    expect(allowedEdges.has("UNDER_REVIEW --reject--> REJECTED")).toBe(true);
    expect(allowedEdges.has("APPROVED --pay--> PAID")).toBe(true);
  });
});

describe("BR-108's export-evidence gate (D-12 — the submission's own proof)", () => {
  it("THE GATE: satisfied when the export declaration OR the export bill of lading is linked", () => {
    expect(drawbackEvidenceSatisfied({ exportDeclarationId: DECL, exportBillOfLadingId: null }).satisfied).toBe(true);
    expect(drawbackEvidenceSatisfied({ exportDeclarationId: null, exportBillOfLadingId: BL }).satisfied).toBe(true);
    expect(drawbackEvidenceSatisfied({ exportDeclarationId: DECL, exportBillOfLadingId: BL }).satisfied).toBe(true);
  });

  it("THE TYPED REFUSAL: no evidence at all — the reason names the claim's missing proof (BR-108's own wording)", () => {
    const verdict = drawbackEvidenceSatisfied({ exportDeclarationId: null, exportBillOfLadingId: null });
    expect(verdict.satisfied).toBe(false);
    expect(verdict.reason).toContain("BR-108");
    expect(verdict.reason).toContain("export declaration");
    expect(verdict.reason).toContain("bill of lading");
  });

  it("THE EXPORT-TYPE LAW: only an EXPORT declaration is proof of export (an IMPORT or TRANSIT declaration is not)", () => {
    expect(isExportDeclarationType("EXPORT")).toBe(true);
    expect(isExportDeclarationType("IMPORT")).toBe(false);
    expect(isExportDeclarationType("TRANSIT")).toBe(false);
    expect(isExportDeclarationType("export")).toBe(false);
  });
});
