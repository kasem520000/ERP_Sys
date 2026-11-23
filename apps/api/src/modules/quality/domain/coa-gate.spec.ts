import { describe, expect, it } from "vitest";

import { coaGateFold, type CoaSpecInput } from "./coa-gate";

/**
 * PHASE-050 (W-27 — T-11, 2026-11-23) THE COA GATE FOLD'S TESTS —
 * BR-104's three shapes + the coverage law + the frozen snapshot's own
 * shape (the plan §4's unit arm: within/outside/accepted-deviation).
 */

const SPECS: CoaSpecInput[] = [
  {
    id: "spec-1",
    parameter: "Viscosity",
    parameterAr: "اللزوجة",
    unit: "cP",
    targetValue: "100.000000",
    ucl: "110.000000",
    lcl: "90.000000",
  },
  {
    id: "spec-2",
    parameter: "pH",
    parameterAr: "الحموضة",
    unit: null,
    targetValue: "7.000000",
    ucl: "7.500000",
    lcl: "6.500000",
  },
  {
    id: "spec-3",
    parameter: "Color (visual)",
    parameterAr: "اللون",
    unit: null,
    targetValue: "0.000000",
    ucl: null,
    lcl: null,
  },
];

const ACCEPTED = new Set(["ncr-accepted"]);

describe("PHASE-050 W-27 — the COA gate fold (BR-104's three shapes)", () => {
  it("SHAPE 1 — within (and unbanded): the certificate passes, the snapshot carries the verdicts verbatim", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "100.500000" },
        { specId: "spec-2", value: "7.200000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(false);
    expect(result.firstFailure).toBeNull();
    expect(result.missing).toEqual([]);
    expect(result.foreign).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.entries.map((entry) => entry.gate)).toEqual([
      "PASS",
      "PASS",
      "PASS_UNBANDED",
    ]);
    expect(result.entries.map((entry) => entry.toleranceVerdict)).toEqual([
      "WITHIN",
      "WITHIN",
      "UNBANDED",
    ]);
    // The frozen entry carries the spec's own band + the measured value.
    expect(result.entries[0]).toMatchObject({
      specId: "spec-1",
      parameter: "Viscosity",
      parameterAr: "اللزوجة",
      unit: "cP",
      targetValue: "100.000000",
      ucl: "110.000000",
      lcl: "90.000000",
      value: "100.500000",
      breachedLimit: null,
      ncrId: null,
    });
  });

  it("the INCLUSIVE band law rides the gate: a value exactly ON a limit is WITHIN (the closed interval)", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "110.000000" },
        { specId: "spec-2", value: "6.500000" },
        { specId: "spec-3", value: "1.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(false);
    expect(result.entries.map((entry) => entry.toleranceVerdict)).toEqual([
      "WITHIN",
      "WITHIN",
      "UNBANDED",
    ]);
  });

  it("SHAPE 2 — outside without a reference: blocked, the first failure named with the parameter and BOTH figures", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "118.000000" },
        { specId: "spec-2", value: "7.100000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(true);
    expect(result.firstFailure).toEqual({
      parameter: "Viscosity",
      value: "118.000000",
      breachedLimit: "110.000000",
    });
    expect(result.entries[0]!.gate).toBe("FAIL_OUTSIDE");
    expect(result.entries[0]!.breachedLimit).toBe("110.000000");
    // The passing parameters still carry their own verdicts:
    expect(result.entries[1]!.gate).toBe("PASS");
  });

  it("the BELOW_LCL arm: the refusal names the LOWER limit", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "95.000000" },
        { specId: "spec-2", value: "6.100000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(true);
    expect(result.firstFailure).toEqual({
      parameter: "pH",
      value: "6.100000",
      breachedLimit: "6.500000",
    });
  });

  it("SHAPE 3 — outside WITH an accepted-deviation reference: passes as DEVIATION_ACCEPTED, the NCR recorded", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "112.000000", ncrId: "ncr-accepted" },
        { specId: "spec-2", value: "7.000000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(false);
    expect(result.entries[0]!.gate).toBe("PASS_DEVIATION_ACCEPTED");
    expect(result.entries[0]!.ncrId).toBe("ncr-accepted");
    expect(result.entries[0]!.toleranceVerdict).toBe("ABOVE_UCL");
    // The tolerance verdict stays the fold's own truth — the deviation
    // is accepted, never re-judged into "within".
    expect(result.entries[0]!.breachedLimit).toBe("110.000000");
  });

  it("an OUTSIDE value with a NON-accepted reference still fails (the acceptance is the register's own verdict)", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "112.000000", ncrId: "ncr-not-in-the-set" },
        { specId: "spec-2", value: "7.000000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(true);
    expect(result.entries[0]!.gate).toBe("FAIL_OUTSIDE");
  });

  it("an accepted reference NEVER rescues a WITHIN parameter into a deviation verdict (no cosmetic deviations)", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "100.000000", ncrId: "ncr-accepted" },
        { specId: "spec-2", value: "7.000000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(false);
    expect(result.entries[0]!.gate).toBe("PASS");
    expect(result.entries[0]!.ncrId).toBeNull();
  });

  it("THE COVERAGE LAW — a missing parameter blocks with the parameter named", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "100.000000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(true);
    expect(result.missing).toEqual(["pH"]);
    expect(result.firstFailure).toBeNull();
    // The covered parameters still fold (the entries are the evidence).
    expect(result.entries.map((entry) => entry.parameter)).toEqual(["Viscosity", "Color (visual)"]);
  });

  it("THE COVERAGE LAW — a foreign spec id blocks, named", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "100.000000" },
        { specId: "spec-2", value: "7.000000" },
        { specId: "spec-3", value: "0.000000" },
        { specId: "spec-other", value: "1.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(true);
    expect(result.foreign).toEqual(["spec-other"]);
  });

  it("THE COVERAGE LAW — a duplicate measurement blocks, named", () => {
    const result = coaGateFold(
      SPECS,
      [
        { specId: "spec-1", value: "100.000000" },
        { specId: "spec-1", value: "101.000000" },
        { specId: "spec-2", value: "7.000000" },
        { specId: "spec-3", value: "0.000000" },
      ],
      ACCEPTED,
    );
    expect(result.blocked).toBe(true);
    expect(result.duplicates).toEqual(["spec-1"]);
    // The FIRST measurement is the one folded — deterministic.
    expect(result.entries[0]!.value).toBe("100.000000");
  });

  it("an empty register passes an empty measurement set (the honest no-parameters shape — nothing to certify)", () => {
    const result = coaGateFold([], [], ACCEPTED);
    expect(result.blocked).toBe(false);
    expect(result.entries).toEqual([]);
  });
});
