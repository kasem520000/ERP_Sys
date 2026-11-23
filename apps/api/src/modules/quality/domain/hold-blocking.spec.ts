/**
 * PHASE-050 (W-28 — T-13, 2026-11-23) THE HOLD-BLOCKING PROPERTY TESTS —
 * the fold's own totality (the ncr-lifecycle precedent's shape: every
 * cell walked, the deterministic laws pinned, the property arms
 * randomized).
 */
import { describe, expect, it } from "vitest";

import {
  heldBatchTarget,
  holdReleaseGate,
  type GateHoldRow,
} from "./hold-blocking";

function hold(id: string, batchId: string, reason = "investigation"): GateHoldRow {
  return { id, batchId, reason, heldAt: "2026-11-23T00:00:00.000Z" };
}

describe("heldBatchTarget — the refusal-target fold", () => {
  it("returns null when no batch is held (the free pass)", () => {
    expect(heldBatchTarget(["b1", "b2"], [])).toBeNull();
    expect(heldBatchTarget([], [hold("h1", "other")])).toBeNull();
  });

  it("names the held batch among the plan's resolved batches", () => {
    const target = heldBatchTarget(["b1", "b2"], [hold("h1", "b2")]);
    expect(target?.batchId).toBe("b2");
  });

  it("picks the lowest batchId when several resolved batches are held", () => {
    const target = heldBatchTarget(["b3", "b1", "b2"], [hold("h3", "b3"), hold("h1", "b1")]);
    expect(target?.batchId).toBe("b1");
  });

  it("is INVARIANT under the input order — the caller's slice order is not evidence (property ×50)", () => {
    const batchIds = ["b1", "b2", "b3", "b4"];
    const holds = [hold("h4", "b4"), hold("h2", "b2"), hold("h1", "b1")];
    const baseline = heldBatchTarget(batchIds, holds)?.id;
    expect(baseline).toBe("h1");
    let seed = 987654321;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const shuffled = [...batchIds];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const shuffledHolds = [...holds];
      for (let i = shuffledHolds.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [shuffledHolds[i], shuffledHolds[j]] = [shuffledHolds[j]!, shuffledHolds[i]!];
      }
      expect(heldBatchTarget(shuffled, shuffledHolds)?.id).toBe(baseline);
    }
  });

  it("carries the reason and the heldAt verbatim (the refusal's own figures)", () => {
    const target = heldBatchTarget(["b1"], [hold("h1", "b1", "customer complaint")]);
    expect(target?.reason).toBe("customer complaint");
    expect(target?.heldAt).toBe("2026-11-23T00:00:00.000Z");
  });
});

describe("holdReleaseGate — BR-101's release fold", () => {
  it("allows the release of an ACTIVE hold carrying the ncr link and the note", () => {
    expect(
      holdReleaseGate({ status: "ACTIVE", ncrId: "n1", releaseNote: "dispositioned SCRAP" }),
    ).toEqual({ allowed: true });
  });

  it("refuses a RELEASED hold — the register is evidence", () => {
    const verdict = holdReleaseGate({
      status: "RELEASED",
      ncrId: "n1",
      releaseNote: "again",
    });
    expect(verdict).toEqual({
      allowed: false,
      refusal: "NOT_ACTIVE",
      reason: expect.any(String),
    });
  });

  it("refuses the release without the disposition link — BR-101's own floor", () => {
    const verdict = holdReleaseGate({ status: "ACTIVE", ncrId: null, releaseNote: "note" });
    expect(verdict).toEqual({
      allowed: false,
      refusal: "DISPOSITION_LINK_REQUIRED",
      reason: expect.stringContaining("BR-101"),
    });
  });

  it("refuses the release with a blank note (the justification record)", () => {
    const verdict = holdReleaseGate({ status: "ACTIVE", ncrId: "n1", releaseNote: "   " });
    expect(verdict.allowed).toBe(false);
    expect(verdict).toHaveProperty("refusal", "DISPOSITION_LINK_REQUIRED");
  });

  it("the total matrix — every status × shape cell decided (the property walk)", () => {
    const statuses = ["ACTIVE", "RELEASED"] as const;
    const ncrShapes = [null, "n1"] as const;
    const noteShapes = [null, "  ", "justified"] as const;
    for (const status of statuses) {
      for (const ncrId of ncrShapes) {
        for (const releaseNote of noteShapes) {
          const verdict = holdReleaseGate({ status, ncrId, releaseNote });
          if (status !== "ACTIVE" || ncrId === null || releaseNote === null || releaseNote.trim().length === 0) {
            expect(verdict.allowed).toBe(false);
          } else {
            expect(verdict.allowed).toBe(true);
          }
        }
      }
    }
  });
});
