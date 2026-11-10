/**
 * PHASE-022 T-P22-4-a · the staged-rollout gate calculator (MASTER-PLAN §0
 * rollout constants + §1 DR-P22-10 + §10; RELEASE_STRATEGY §Rollout) — the
 * desktop updater rollout service (apps/desktop/src/updater/rollout.ts, the
 * PHASE-021 T8 port) re-expressed against the MOBILE golden constants
 * (../constants CRASH_FREE_GATES carries to50/to100 with crashFree/sessions
 * field names — the desktop spelling was promote10to50/promote50to100 with
 * rate/minSessions).
 *
 * Binding gates (MASTER-PLAN §0, trailing 24 h window): promote 10% → 50%
 * needs ≥ 99.5% crash-free over ≥ 200 sessions; 50% → 100% needs ≥ 99.7%
 * over ≥ 500; a crash-free rate below 98.5% HALTS the rollout at ANY stage
 * and the remedy publishes `minVersion` = last-known-good (every device on
 * the bad build is force-updated off it — the release-policy consumer).
 *
 * Pure decision functions — no I/O, no clocks: the monitoring dashboard
 * feeds the trailing-window metrics in, the release operator applies the
 * returned decision (`.github/workflows/mobile-release.yml` documents the
 * staged-rollout config artifact these gates serialize into).
 */

import { CRASH_FREE_GATES, ROLLOUT_STAGES } from "../constants";

/** The canonical rollout stages (MASTER-PLAN §0: 10% → 50% → 100%). */
export type RolloutStage = (typeof ROLLOUT_STAGES)[number];

/** The trailing-window metrics input (24 h crash-free sessions). */
export interface RolloutWindow {
  /** Crash-free-session rate in [0, 1] — null when the window is empty. */
  readonly crashFreeRate: number | null;
  /** Sessions observed in the window. */
  readonly sessions: number;
}

export interface HaltRemedy {
  readonly action: "force-update";
  /** The minimum version to publish — last-known-good (the bad build's
   * predecessor); every device below it is force-updated off the bad build. */
  readonly minVersion: string;
}

export interface RolloutDecision {
  readonly decision: "promote" | "hold" | "halt";
  readonly nextStage?: RolloutStage;
  readonly reason: string;
  /** Present only on halt — the force-update remedy (publish minVersion). */
  readonly remedy?: HaltRemedy;
}

/**
 * The halt remedy (the DR-P21-05 port): publish the next manifest with
 * `minVersion` = last-known-good. Exported separately so the operator
 * tooling (and the tests) can build the remedy without a full evaluation.
 */
export function haltRemedy(lastKnownGoodVersion: string): HaltRemedy {
  return { action: "force-update", minVersion: lastKnownGoodVersion };
}

function nextStageOf(stage: RolloutStage): RolloutStage | undefined {
  const index = ROLLOUT_STAGES.indexOf(stage);
  return index >= 0 && index < ROLLOUT_STAGES.length - 1 ? ROLLOUT_STAGES[index + 1] : undefined;
}

/** The promote gate for a stage: 10 → to50 (99.5% / 200), 50 → to100 (99.7% / 500). */
function promoteGateFor(stage: RolloutStage): { crashFree: number; sessions: number } {
  return stage === 10 ? CRASH_FREE_GATES.to50 : CRASH_FREE_GATES.to100;
}

/**
 * Evaluate one stage transition. Order: halt (crash-free < 98.5% — armed at
 * EVERY stage: a bad build at 100% must still halt) → promote (rate AND
 * sample-size gates, both inclusive at the boundary) → hold. An empty
 * window (no sessions) HOLDS — a rate of 0 would spuriously halt every
 * fresh channel.
 */
export function evaluateRollout(input: {
  readonly currentStage: RolloutStage;
  readonly window: RolloutWindow;
  readonly lastKnownGoodVersion: string;
}): RolloutDecision {
  if (input.window.crashFreeRate === null || input.window.sessions <= 0) {
    return {
      decision: "hold",
      reason: `no sessions in the trailing window at stage ${input.currentStage}% — hold`,
    };
  }
  const rate = input.window.crashFreeRate;
  if (rate < CRASH_FREE_GATES.halt) {
    const remedy = haltRemedy(input.lastKnownGoodVersion);
    return {
      decision: "halt",
      reason:
        `crash-free rate ${(rate * 100).toFixed(3)}% over ${input.window.sessions} sessions is below the ` +
        `halt threshold ${(CRASH_FREE_GATES.halt * 100).toFixed(1)}% — halt the rollout and publish ` +
        `minVersion ${remedy.minVersion} (force-update off the bad build)`,
      remedy,
    };
  }
  const nextStage = nextStageOf(input.currentStage);
  if (nextStage === undefined) {
    return {
      decision: "hold",
      reason: `stage ${input.currentStage}% is the final stage — monitoring only (the halt gate stays armed)`,
    };
  }
  const gate = promoteGateFor(input.currentStage);
  if (rate >= gate.crashFree && input.window.sessions >= gate.sessions) {
    return {
      decision: "promote",
      nextStage,
      reason:
        `crash-free rate ${(rate * 100).toFixed(3)}% over ${input.window.sessions} sessions meets the ` +
        `${gate.crashFree * 100}% / ${gate.sessions}-session gate — promote ${input.currentStage}% → ${nextStage}%`,
    };
  }
  if (input.window.sessions < gate.sessions) {
    return {
      decision: "hold",
      reason:
        `crash-free rate ${(rate * 100).toFixed(3)}% meets the gate but only ${input.window.sessions} sessions ` +
        `(< ${gate.sessions}) — hold for a larger sample`,
    };
  }
  return {
    decision: "hold",
    reason:
      `crash-free rate ${(rate * 100).toFixed(3)}% is below the promote gate ${(gate.crashFree * 100).toFixed(1)}% ` +
      `over ${input.window.sessions} sessions — hold`,
  };
}
