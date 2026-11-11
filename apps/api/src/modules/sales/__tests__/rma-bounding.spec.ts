import { describe, expect, it } from "vitest";

import { computeReturnAvailability } from "../application/rma";

/**
 * PHASE-039 · the return-availability fold (pure unit): available =
 * invoiced − already credited − open-RMA qty, floored at zero, canonical
 * 6dp — the bound every RMA line is checked against at create.
 */

describe("computeReturnAvailability", () => {
  it("returns the full invoiced qty when nothing is credited or open", () => {
    expect(computeReturnAvailability("10", "0", "0")).toBe("10.000000");
  });

  it("subtracts credited and open quantities (the three-way fold)", () => {
    expect(computeReturnAvailability("10", "3", "4")).toBe("3.000000");
  });

  it("equal — the exact remaining qty is available (boundary is inclusive)", () => {
    expect(computeReturnAvailability("10", "4", "6")).toBe("0.000000");
  });

  it("exceed — an over-credited/open invoice floors at zero, never negative", () => {
    expect(computeReturnAvailability("10", "8", "5")).toBe("0.000000");
  });

  it("zero — an uninvoiced line has nothing available", () => {
    expect(computeReturnAvailability("0", "0", "0")).toBe("0.000000");
  });

  it("folds fractional qtys at the 6dp qty quantum", () => {
    expect(computeReturnAvailability("10.5", "1.25", "0.000005")).toBe("9.249995");
  });

  it("handles decimal strings of mixed precision", () => {
    expect(computeReturnAvailability("100.000000", "33.5", "16.25")).toBe("50.250000");
  });
});
