import { describe, expect, it } from "vitest";

import {
  NCR_DISPOSITIONS,
  NCR_SOURCES,
  NCR_STATUSES,
  nextNcrMove,
  ncrSourceShapeValid,
  scrapJournalScope,
  type NcrSource,
  type NcrStatus,
} from "./ncr-lifecycle";

/**
 * PHASE-050 (W-25 — T-06, 2026-11-23) THE NCR LIFECYCLE FOLD'S PROPERTY
 * TESTS (the unit-first law — the plan §4's own unit arm: "the NCR/CAPA
 * lifecycle folds (the closure gates' refusal shapes)"). The full status
 * × move matrix is walked cell-by-cell: every legal cell is named and
 * every refusal carries its shape. The vocabularies are pinned to the
 * 0114 CHECKs (a drift here is a drift against the DB floor).
 */

describe("nextNcrMove — the full status × move matrix (BR-102's ladder)", () => {
  const LEGAL: ReadonlyArray<[NcrStatus, "disposition" | "close"]> = [
    ["OPEN", "disposition"],
    ["DISPOSITIONED", "close"],
  ];

  it("allows exactly the two legal cells of the ladder", () => {
    for (const [status, move] of LEGAL) {
      const verdict = nextNcrMove(status, move);
      expect(verdict.allowed, `${status} × ${move} must be legal`).toBe(true);
      expect(verdict.refusal).toBeUndefined();
    }
  });

  it("refuses every other cell with its named shape (the total fold)", () => {
    const moves = ["disposition", "close"] as const;
    let refused = 0;
    for (const status of NCR_STATUSES) {
      for (const move of moves) {
        if (LEGAL.some(([s, m]) => s === status && m === move)) continue;
        const verdict = nextNcrMove(status, move);
        expect(verdict.allowed, `${status} × ${move} must be refused`).toBe(false);
        expect(verdict.reason).toBeTruthy();
        refused += 1;
      }
    }
    // 3 statuses × 2 moves − 2 legal = 4 refusal cells.
    expect(refused).toBe(4);
  });

  it("BR-102's own cell: the close on OPEN carries DISPOSITION_REQUIRED", () => {
    const verdict = nextNcrMove("OPEN", "close");
    expect(verdict.allowed).toBe(false);
    expect(verdict.refusal).toBe("DISPOSITION_REQUIRED");
    expect(verdict.reason).toMatch(/BR-102/);
  });

  it("the single-use disposition stamp: DISPOSITIONED × disposition is ALREADY_DISPOSITIONED", () => {
    const verdict = nextNcrMove("DISPOSITIONED", "disposition");
    expect(verdict.refusal).toBe("ALREADY_DISPOSITIONED");
  });

  it("the CLOSED register is evidence: every move is ALREADY_CLOSED", () => {
    expect(nextNcrMove("CLOSED", "disposition").refusal).toBe("ALREADY_CLOSED");
    expect(nextNcrMove("CLOSED", "close").refusal).toBe("ALREADY_CLOSED");
  });
});

describe("scrapJournalScope — G-62's journal gate (D-05 + the 0114 CHECK)", () => {
  it("posts the write-off ONLY on the SCRAP disposition of a batch-referencing NCR", () => {
    expect(
      scrapJournalScope({ disposition: "SCRAP", hasBatch: true }),
    ).toBe("POSTS_WRITE_OFF");
  });

  it("the batch-less SCRAP stamps with NO journal (the 0114 gate's own NULL allowance)", () => {
    expect(
      scrapJournalScope({ disposition: "SCRAP", hasBatch: false }),
    ).toBe("NO_JOURNAL");
  });

  it("REWORK/ACCEPT/RETURN_TO_SUPPLIER carry NO GL entry in every case (D-05's honest shape)", () => {
    for (const disposition of NCR_DISPOSITIONS) {
      if (disposition === "SCRAP") continue;
      expect(scrapJournalScope({ disposition, hasBatch: true })).toBe("NO_JOURNAL");
      expect(scrapJournalScope({ disposition, hasBatch: false })).toBe("NO_JOURNAL");
    }
  });

  it("the vocabularies are pinned to the 0114 CHECKs (closed sets, exact order)", () => {
    expect(NCR_STATUSES).toEqual(["OPEN", "DISPOSITIONED", "CLOSED"]);
    expect(NCR_DISPOSITIONS).toEqual([
      "REWORK",
      "SCRAP",
      "ACCEPT",
      "RETURN_TO_SUPPLIER",
    ]);
    expect(NCR_SOURCES).toEqual(["INSPECTION", "PRODUCTION", "COMPLAINT", "SUPPLIER"]);
  });
});

describe("ncrSourceShapeValid — the source-shape fold (0114's CHECK at the service floor)", () => {
  it("INSPECTION requires its inspection row", () => {
    expect(
      ncrSourceShapeValid({ source: "INSPECTION", hasInspection: false, hasPartner: false }),
    ).toBe(false);
    expect(
      ncrSourceShapeValid({ source: "INSPECTION", hasInspection: true, hasPartner: false }),
    ).toBe(true);
  });

  it("SUPPLIER and COMPLAINT require their partner", () => {
    for (const source of ["SUPPLIER", "COMPLAINT"] as const) {
      expect(
        ncrSourceShapeValid({ source, hasInspection: false, hasPartner: false }),
      ).toBe(false);
      expect(
        ncrSourceShapeValid({ source, hasInspection: false, hasPartner: true }),
      ).toBe(true);
    }
  });

  it("PRODUCTION carries the batch when known — no shape requirement (the fold's total)", () => {
    for (const source of NCR_SOURCES as readonly NcrSource[]) {
      if (source === "PRODUCTION") {
        expect(
          ncrSourceShapeValid({ source, hasInspection: false, hasPartner: false }),
        ).toBe(true);
      }
    }
  });
});
