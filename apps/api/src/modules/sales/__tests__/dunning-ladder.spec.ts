import { describe, expect, it } from "vitest";

import {
  advanceStep,
  resolveCurrentStep,
  validateDunningSteps,
  validateLateFeeConfig,
  type DunningStep,
} from "../application/dunning";
import {
  DunningPolicyStepsInvalidError,
  LateFeeConfigInvalidError,
} from "../domain/sales-errors";

/**
 * PHASE-039 · the dunning ladder (pure unit — the rma-bounding precedent):
 * BR-065's monotonic shape — target = min(resolveCurrentStep, advanceStep)
 * — a 200-day overdue item still STARTS at step 1, advances one step per
 * run, never skips, never regresses; referToAgency is terminal-only; the
 * STATUTORY_CAP late-fee mode refuses without its verified source
 * (REQUIRES_VERIFICATION).
 */

const LADDER: DunningStep[] = [
  { stepNo: 1, daysOverdue: 7, channel: "EMAIL", templateKey: "dunning.reminder.1", escalate: false, referToAgency: false },
  { stepNo: 2, daysOverdue: 30, channel: "EMAIL", templateKey: "dunning.reminder.2", escalate: false, referToAgency: false },
  { stepNo: 3, daysOverdue: 60, channel: "EMAIL", templateKey: "dunning.final", escalate: true, referToAgency: true },
];

const rawLadder = (overrides: Partial<Record<string, unknown>>[] = []): Record<string, unknown>[] =>
  LADDER.map((step, index) => ({ ...step, ...(overrides[index] ?? {}) }));

describe("resolveCurrentStep + advanceStep (BR-065)", () => {
  it("resolves null before the first threshold, the top step deep in overdue", () => {
    expect(resolveCurrentStep(LADDER, 6)).toBeNull();
    expect(resolveCurrentStep(LADDER, 7)).toBe(1);
    expect(resolveCurrentStep(LADDER, 29)).toBe(1);
    expect(resolveCurrentStep(LADDER, 30)).toBe(2);
    expect(resolveCurrentStep(LADDER, 59)).toBe(2);
    expect(resolveCurrentStep(LADDER, 60)).toBe(3);
    expect(resolveCurrentStep(LADDER, 200)).toBe(3);
  });

  it("0 → 1 at 200 days overdue: the sweep target caps at lastStep + 1 (never skips)", () => {
    const daysOverdue = 200;
    const lastStep = 0;
    expect(Math.min(resolveCurrentStep(LADDER, daysOverdue)!, advanceStep(LADDER, lastStep))).toBe(1);
  });

  it("1 → 2 on the next run, then 2 → 3, then the ladder holds its top", () => {
    expect(Math.min(resolveCurrentStep(LADDER, 200)!, advanceStep(LADDER, 1))).toBe(2);
    expect(Math.min(resolveCurrentStep(LADDER, 200)!, advanceStep(LADDER, 2))).toBe(3);
    // At the top: target == lastStep — the sweep's `target <= lastStep` guard
    // skips (no re-fire; the letters UNIQUE is the backstop).
    expect(Math.min(resolveCurrentStep(LADDER, 200)!, advanceStep(LADDER, 3))).toBe(3);
    expect(advanceStep(LADDER, 3) <= 3).toBe(true);
  });

  it("never regresses: a shorter overdue span after a deeper one holds the register (no new letter)", () => {
    // lastStep 2 fired long ago; daysOverdue shrank to 35 (a receipt moved
    // the due date) — the earned step is 2, so the target min(2, 3) == 2 ==
    // lastStep and the sweep's `target <= lastStep` guard SKIPS: the item
    // holds at step 2 (no re-fire, no regression — the register is
    // append-only evidence) until it re-earns step 3.
    expect(Math.min(resolveCurrentStep(LADDER, 35)!, advanceStep(LADDER, 2))).toBe(2);
    // Re-earning the deeper step is what advances: 200 days after step 2 → 3.
    expect(Math.min(resolveCurrentStep(LADDER, 200)!, advanceStep(LADDER, 2))).toBe(3);
    // Even a cursor BELOW the earned span can never write a regressing
    // letter: lastStep 3, daysOverdue 8 → target min(1, 4) == 1 ≤ 3 → skip.
    expect(Math.min(resolveCurrentStep(LADDER, 8)!, advanceStep(LADDER, 3))).toBe(1);
    // And when the item no longer earns ANY step, the sweep does nothing.
    expect(resolveCurrentStep(LADDER, 5)).toBeNull();
  });

  it("advanceStep clamps at the ladder's length for runaway cursors", () => {
    expect(advanceStep(LADDER, 0)).toBe(1);
    expect(advanceStep(LADDER, 99)).toBe(3);
  });
});

describe("validateDunningSteps", () => {
  it("accepts the canonical ladder and normalizes the flags", () => {
    const steps = validateDunningSteps(rawLadder());
    expect(steps).toHaveLength(3);
    expect(steps[2]).toMatchObject({ escalate: true, referToAgency: true });
  });

  it("rejects the empty ladder", () => {
    expect(() => validateDunningSteps([])).toThrow(DunningPolicyStepsInvalidError);
  });

  it("rejects non-1..N step numbering", () => {
    expect(() =>
      validateDunningSteps([
        { stepNo: 2, daysOverdue: 7, channel: "EMAIL", templateKey: "dunning.reminder.1" },
      ]),
    ).toThrow(DunningPolicyStepsInvalidError);
  });

  it("rejects non-ascending (and non-positive) daysOverdue", () => {
    expect(() =>
      validateDunningSteps(
        rawLadder([{ daysOverdue: 90 }, { daysOverdue: 30 }, {}]),
      ),
    ).toThrow(DunningPolicyStepsInvalidError);
    expect(() =>
      validateDunningSteps(rawLadder([{ daysOverdue: 0 }, {}, {}])),
    ).toThrow(DunningPolicyStepsInvalidError);
  });

  it("rejects channels outside the vocabulary and empty template keys", () => {
    expect(() =>
      validateDunningSteps(rawLadder([{ channel: "CARRIER_PIGEON" }, {}, {}])),
    ).toThrow(DunningPolicyStepsInvalidError);
    expect(() =>
      validateDunningSteps(rawLadder([{ templateKey: "   " }, {}, {}])),
    ).toThrow(DunningPolicyStepsInvalidError);
  });

  it("referToAgency is the TERMINAL flag only", () => {
    expect(() =>
      validateDunningSteps(rawLadder([{ referToAgency: true }, {}, {}])),
    ).toThrow(DunningPolicyStepsInvalidError);
    // On the last step it is the agency handoff marker — valid.
    expect(() => validateDunningSteps(rawLadder([{}, {}, { referToAgency: true }]))).not.toThrow();
  });
});

describe("validateLateFeeConfig (REQUIRES_VERIFICATION)", () => {
  it("DISABLED carries nothing", () => {
    expect(() => validateLateFeeConfig("DISABLED", null, null)).not.toThrow();
  });

  it("CONTRACT_RATE needs its positive rate", () => {
    expect(() => validateLateFeeConfig("CONTRACT_RATE", "1.50", null)).not.toThrow();
    expect(() => validateLateFeeConfig("CONTRACT_RATE", null, null)).toThrow(LateFeeConfigInvalidError);
    expect(() => validateLateFeeConfig("CONTRACT_RATE", "0", null)).toThrow(LateFeeConfigInvalidError);
  });

  it("STATUTORY_CAP refuses without its verified jurisdiction source", () => {
    expect(() => validateLateFeeConfig("STATUTORY_CAP", "5.00", null)).toThrow(
      LateFeeConfigInvalidError,
    );
    expect(() => validateLateFeeConfig("STATUTORY_CAP", "5.00", "  ")).toThrow(
      LateFeeConfigInvalidError,
    );
    // The verified citation unlocks the statutory cap.
    expect(() =>
      validateLateFeeConfig("STATUTORY_CAP", "5.00", "SA Commercial Courts Law art. 76(2) — verified 2026-01"),
    ).not.toThrow();
  });

  it("unknown modes are typed rejections", () => {
    expect(() => validateLateFeeConfig("VIBES", "1", null)).toThrow(LateFeeConfigInvalidError);
  });
});
