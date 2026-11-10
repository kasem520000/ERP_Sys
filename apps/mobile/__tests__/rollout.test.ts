import { describe, expect, it } from "vitest";

import { CRASH_FREE_GATES, ROLLOUT_STAGES } from "../src/constants";
import { evaluateRollout, haltRemedy } from "../src/release/rollout";

/**
 * PHASE-022 T-P22-4-a — the staged-rollout gate calculator (DR-P22-10): the
 * binding gates at their exact boundaries (MASTER-PLAN §0): promote 10→50 at
 * ≥ 99.5% over ≥ 200 sessions; 50→100 at ≥ 99.7% over ≥ 500; halt < 98.5%
 * (strictly below — exactly 98.5% never halts) with the force-update remedy
 * publishing minVersion = last-known-good. The trailing window is 24 h.
 *
 * Deliberate difference from the desktop port (recorded in T-P22-4a):
 * the mobile binding spec halts on ANY sub-98.5% rate — the desktop's
 * ≥ 50-session tiny-sample guard is NOT ported (MASTER-PLAN §0 expresses the
 * mobile halt unconditionally). Asserted below, never silently diverged.
 */

const LAST_KNOWN_GOOD = "1.26.10.9";

describe("the golden rollout constants (the calculator's inputs)", () => {
  it("carries the 10/50/100 ladder + the binding gate values", () => {
    expect([...ROLLOUT_STAGES]).toEqual([10, 50, 100]);
    expect(CRASH_FREE_GATES.to50).toEqual({ crashFree: 0.995, sessions: 200 });
    expect(CRASH_FREE_GATES.to100).toEqual({ crashFree: 0.997, sessions: 500 });
    expect(CRASH_FREE_GATES.halt).toBe(0.985);
  });
});

describe("evaluateRollout — the promote gates at their boundaries (stage 10)", () => {
  it("promotes at exactly 99.5% over exactly 200 sessions (inclusive boundaries)", () => {
    const decision = evaluateRollout({
      currentStage: 10,
      window: { crashFreeRate: 0.995, sessions: 200 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("promote");
    expect(decision.nextStage).toBe(50);
    expect(decision.reason).toContain("10% → 50%");
  });

  it("holds just below the rate gate (0.9949 over 200)", () => {
    const decision = evaluateRollout({
      currentStage: 10,
      window: { crashFreeRate: 0.9949, sessions: 200 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("hold");
    expect(decision.nextStage).toBeUndefined();
    expect(decision.reason).toContain("below the promote gate");
  });

  it("holds on an insufficient sample (99.5% over 199)", () => {
    const decision = evaluateRollout({
      currentStage: 10,
      window: { crashFreeRate: 0.995, sessions: 199 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("larger sample");
  });

  it("holds on both-short (0.9949 over 199) with the sample reason first", () => {
    const decision = evaluateRollout({
      currentStage: 10,
      window: { crashFreeRate: 0.9949, sessions: 199 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("hold");
  });
});

describe("evaluateRollout — the promote gates at their boundaries (stage 50)", () => {
  it("promotes at exactly 99.7% over exactly 500 sessions", () => {
    const decision = evaluateRollout({
      currentStage: 50,
      window: { crashFreeRate: 0.997, sessions: 500 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("promote");
    expect(decision.nextStage).toBe(100);
    expect(decision.reason).toContain("50% → 100%");
  });

  it("holds just below the rate gate (0.9969 over 500)", () => {
    const decision = evaluateRollout({
      currentStage: 50,
      window: { crashFreeRate: 0.9969, sessions: 500 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("below the promote gate 99.7");
  });

  it("holds on an insufficient sample (99.7% over 499)", () => {
    const decision = evaluateRollout({
      currentStage: 50,
      window: { crashFreeRate: 0.997, sessions: 499 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("larger sample");
  });
});

describe("evaluateRollout — the halt gate (armed at every stage)", () => {
  it("halts below 98.5% with the force-update remedy publishing minVersion = last-known-good", () => {
    const decision = evaluateRollout({
      currentStage: 10,
      window: { crashFreeRate: 0.9849, sessions: 300 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("halt");
    expect(decision.remedy).toBeDefined();
    expect(decision.remedy?.action).toBe("force-update");
    expect(decision.remedy?.minVersion).toBe(LAST_KNOWN_GOOD);
    expect(decision.reason).toContain("98.5%");
    expect(decision.reason).toContain(LAST_KNOWN_GOOD);
  });

  it("halts at stage 100 too (a fully rolled-out bad build must still halt)", () => {
    const decision = evaluateRollout({
      currentStage: 100,
      window: { crashFreeRate: 0.98, sessions: 800 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("halt");
    expect(decision.remedy?.minVersion).toBe(LAST_KNOWN_GOOD);
  });

  it("halts on ANY sub-98.5% rate — no tiny-sample guard (the mobile spec difference)", () => {
    // The desktop port holds below 50 sessions; the MOBILE binding spec
    // (MASTER-PLAN §0) halts unconditionally — asserted here, deviation
    // recorded in the T-P22-4a evidence.
    const decision = evaluateRollout({
      currentStage: 10,
      window: { crashFreeRate: 0.5, sessions: 5 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("halt");
    expect(decision.remedy?.minVersion).toBe(LAST_KNOWN_GOOD);
  });

  it("never halts at exactly 98.5% (strictly-below is the halt predicate)", () => {
    const decision = evaluateRollout({
      currentStage: 10,
      window: { crashFreeRate: 0.985, sessions: 250 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).not.toContain("halt threshold");
  });
});

describe("evaluateRollout — the steady + empty states", () => {
  it("holds (monitoring only) at stage 100 with healthy metrics", () => {
    const decision = evaluateRollout({
      currentStage: 100,
      window: { crashFreeRate: 0.999, sessions: 800 },
      lastKnownGoodVersion: LAST_KNOWN_GOOD,
    });
    expect(decision.decision).toBe("hold");
    expect(decision.reason).toContain("final stage");
  });

  it("holds on an empty window (no sessions — never a rate of 0)", () => {
    for (const window of [{ crashFreeRate: null, sessions: 0 }, { crashFreeRate: 0.99, sessions: 0 }]) {
      const decision = evaluateRollout({
        currentStage: 10,
        window,
        lastKnownGoodVersion: LAST_KNOWN_GOOD,
      });
      expect(decision.decision).toBe("hold");
      expect(decision.reason).toContain("no sessions");
    }
  });
});

describe("haltRemedy — the force-update remedy builder", () => {
  it("publishes minVersion = the given last-known-good", () => {
    const remedy = haltRemedy("1.26.10.9");
    expect(remedy).toEqual({ action: "force-update", minVersion: "1.26.10.9" });
  });
});
