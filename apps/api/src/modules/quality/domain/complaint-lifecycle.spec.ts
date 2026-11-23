/**
 * PHASE-050 (W-28 — T-12, 2026-11-23) THE COMPLAINT LIFECYCLE PROPERTY
 * TESTS — the fold's own totality (the ncr-lifecycle precedent's shape:
 * the full matrix walked, the windows pinned, the resolution-pair law on
 * both sides).
 */
import { describe, expect, it } from "vitest";

import {
  COMPLAINT_CHANNELS,
  COMPLAINT_SEVERITIES,
  COMPLAINT_STATUSES,
  complaintNcrLinkWindow,
  complaintResolutionShapeValid,
  nextComplaintMove,
} from "./complaint-lifecycle";

describe("nextComplaintMove — the total status × move matrix", () => {
  it("the ladder walks its four rungs in order", () => {
    expect(nextComplaintMove("NEW", "triage").allowed).toBe(true);
    expect(nextComplaintMove("TRIAGED", "progress").allowed).toBe(true);
    expect(nextComplaintMove("IN_PROGRESS", "resolve").allowed).toBe(true);
    expect(nextComplaintMove("RESOLVED", "close").allowed).toBe(true);
  });

  it("every illegal cell is refused BY NAME (the full matrix walk)", () => {
    const moves = ["triage", "progress", "resolve", "close"] as const;
    for (const status of COMPLAINT_STATUSES) {
      for (const move of moves) {
        const verdict = nextComplaintMove(status, move);
        const ladderOk =
          (status === "NEW" && move === "triage") ||
          (status === "TRIAGED" && move === "progress") ||
          (status === "IN_PROGRESS" && move === "resolve") ||
          (status === "RESOLVED" && move === "close");
        expect(verdict.allowed).toBe(ladderOk);
        if (!ladderOk) {
          expect(verdict.refusal).toBeDefined();
          expect(verdict.reason).toBeTruthy();
        }
      }
    }
  });

  it("every refusal names its rung (the typed-reason law)", () => {
    expect(nextComplaintMove("NEW", "close").refusal).toBe("NOT_NEW");
    expect(nextComplaintMove("TRIAGED", "resolve").refusal).toBe("NOT_TRIAGED");
    expect(nextComplaintMove("IN_PROGRESS", "close").refusal).toBe("NOT_IN_PROGRESS");
    expect(nextComplaintMove("RESOLVED", "progress").refusal).toBe("NOT_RESOLVED");
    expect(nextComplaintMove("CLOSED", "close").refusal).toBe("ALREADY_CLOSED");
  });
});

describe("complaintNcrLinkWindow — the NCR link's own window", () => {
  it("is open at TRIAGED and IN_PROGRESS (the working window)", () => {
    expect(complaintNcrLinkWindow("TRIAGED").open).toBe(true);
    expect(complaintNcrLinkWindow("IN_PROGRESS").open).toBe(true);
  });

  it("is closed at NEW — the triage act carries the first link", () => {
    const verdict = complaintNcrLinkWindow("NEW");
    expect(verdict.open).toBe(false);
    expect(verdict.reason).toContain("triage");
  });

  it("is closed past the window — the link is evidence", () => {
    for (const status of ["RESOLVED", "CLOSED"] as const) {
      const verdict = complaintNcrLinkWindow(status);
      expect(verdict.open).toBe(false);
      expect(verdict.reason).toContain("evidence");
    }
  });
});

describe("complaintResolutionShapeValid — ck_complaints_resolved_shape at the fold", () => {
  it("the resolved statuses carry exactly the pair", () => {
    expect(
      complaintResolutionShapeValid({
        status: "RESOLVED",
        hasResolution: true,
        hasResolvedAt: true,
      }),
    ).toBe(true);
    expect(
      complaintResolutionShapeValid({
        status: "CLOSED",
        hasResolution: true,
        hasResolvedAt: true,
      }),
    ).toBe(true);
  });

  it("never one without the other (the half-pair refusals)", () => {
    for (const status of ["RESOLVED", "CLOSED"] as const) {
      expect(
        complaintResolutionShapeValid({ status, hasResolution: true, hasResolvedAt: false }),
      ).toBe(false);
      expect(
        complaintResolutionShapeValid({ status, hasResolution: false, hasResolvedAt: true }),
      ).toBe(false);
      expect(
        complaintResolutionShapeValid({ status, hasResolution: false, hasResolvedAt: false }),
      ).toBe(false);
    }
  });

  it("the working statuses carry neither stamp (the honest open shape)", () => {
    for (const status of ["NEW", "TRIAGED", "IN_PROGRESS"] as const) {
      expect(
        complaintResolutionShapeValid({ status, hasResolution: false, hasResolvedAt: false }),
      ).toBe(true);
      expect(
        complaintResolutionShapeValid({ status, hasResolution: true, hasResolvedAt: true }),
      ).toBe(false);
    }
  });
});

describe("the vocabularies — the 0114 CHECK domains verbatim", () => {
  it("the channel vocabulary (six members)", () => {
    expect([...COMPLAINT_CHANNELS]).toEqual([
      "PHONE",
      "EMAIL",
      "WALK_IN",
      "PORTAL",
      "SOCIAL",
      "OTHER",
    ]);
  });

  it("the severity vocabulary (the NCR sibling)", () => {
    expect([...COMPLAINT_SEVERITIES]).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it("the status vocabulary (five rungs)", () => {
    expect([...COMPLAINT_STATUSES]).toEqual([
      "NEW",
      "TRIAGED",
      "IN_PROGRESS",
      "RESOLVED",
      "CLOSED",
    ]);
  });
});
