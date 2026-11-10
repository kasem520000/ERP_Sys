/**
 * PHASE-021 T8 · staged-rollout service logic (MASTER-PLAN §0 constants +
 * §7; RELEASE_STRATEGY §Rollout; MONITORING §1 client-stability dashboard):
 * stage transitions 10% → 50% → 100% read crash-free-session metrics and
 * apply the binding gates from CRASH_FREE_GATES (../index — the golden
 * constants module): promote 10→50 needs ≥ 99.5% over ≥ 200 sessions,
 * 50→100 needs ≥ 99.7% over ≥ 500, and a crash-free rate below 98.5%
 * (over ≥ 50 sessions — the tiny-sample guard) HALTS the rollout
 * (DR-P21-05). The halt remedy is a manifest minimum-version bump: every
 * device below the last-good version is force-updated off the bad build.
 *
 * Pure decision functions — no I/O, no clocks: the deploy-side service
 * (W2-c) feeds dashboard metrics in and applies the returned manifest block.
 */

import { CRASH_FREE_GATES, ROLLOUT_STAGES } from "../constants";

/** The client-stability dashboard input shape (trailing window). */
export interface CrashFreeMetrics {
  readonly sessions: number;
  readonly crashFreeSessions: number;
}

/** The canonical rollout stages (MASTER-PLAN §0: 10% → 50% → 100%). */
export type RolloutStage = (typeof ROLLOUT_STAGES)[number];

export interface StageTransitionDecision {
  readonly decision: "promote" | "hold" | "halt";
  readonly nextStage?: RolloutStage;
  readonly reason: string;
}

export interface RolloutBlock {
  readonly stagePercent: RolloutStage;
  readonly cohortSeed: string;
}

/**
 * Crash-free-session rate: `crashFreeSessions / sessions`, or null when
 * there are no sessions (the dashboard's empty-window case — never a rate
 * of 0, which would halt every fresh channel). Defensive normalization:
 * negative crash counts read as 0, counts above sessions clamp to sessions
 * (a gauge feeding the gates must never produce a rate outside [0, 1]).
 */
export function crashFreeRate(metrics: CrashFreeMetrics): number | null {
  if (typeof metrics.sessions !== "number" || typeof metrics.crashFreeSessions !== "number") return null;
  if (metrics.sessions <= 0) return null;
  const crashFree = Math.min(Math.max(metrics.crashFreeSessions, 0), metrics.sessions);
  return crashFree / metrics.sessions;
}

function nextStageOf(stage: RolloutStage): RolloutStage | undefined {
  const index = ROLLOUT_STAGES.indexOf(stage);
  return index >= 0 && index < ROLLOUT_STAGES.length - 1 ? ROLLOUT_STAGES[index + 1] : undefined;
}

function promoteGateFor(stage: RolloutStage): { rate: number; minSessions: number } {
  // stage 10 → gate promote10to50; stages 50/100 → promote50to100 (100 has
  // no promotion — see evaluateStageTransition).
  return stage === 10 ? CRASH_FREE_GATES.promote10to50 : CRASH_FREE_GATES.promote50to100;
}

/**
 * Evaluate one stage transition against the binding gates. Order: halt
 * (crash-free < 98.5% over ≥ 50 sessions — applies at EVERY stage, a fully
 * rolled-out bad build must still halt) → promote (rate AND sample-size
 * gates) → hold. Tiny-sample guard recorded honestly: a rate below the halt
 * threshold with fewer than 50 sessions HOLDS (a handful of crashes in a
 * fresh cohort is noise, not a signal).
 */
export function evaluateStageTransition(input: {
  readonly currentStagePercent: RolloutStage;
  readonly metrics: CrashFreeMetrics;
}): StageTransitionDecision {
  const rate = crashFreeRate(input.metrics);
  if (rate === null) {
    return {
      decision: "hold",
      reason: `no sessions in the trailing window at stage ${input.currentStagePercent}%`,
    };
  }
  if (rate < CRASH_FREE_GATES.halt) {
    if (input.metrics.sessions >= 50) {
      return {
        decision: "halt",
        reason:
          `crash-free rate ${(rate * 100).toFixed(3)}% over ${input.metrics.sessions} sessions is below the ` +
          `halt threshold ${(CRASH_FREE_GATES.halt * 100).toFixed(1)}% — halt the rollout and force-update ` +
          "(haltRemedy applies the minimum-version bump)",
      };
    }
    return {
      decision: "hold",
      reason:
        `crash-free rate ${(rate * 100).toFixed(3)}% is below the halt threshold but only ` +
        `${input.metrics.sessions} sessions (< 50) — tiny-sample guard holds instead of halting`,
    };
  }
  const nextStage = nextStageOf(input.currentStagePercent);
  if (nextStage === undefined) {
    return {
      decision: "hold",
      reason: `stage ${input.currentStagePercent}% is the final stage — monitoring only (halt gate stays armed)`,
    };
  }
  const gate = promoteGateFor(input.currentStagePercent);
  if (rate >= gate.rate && input.metrics.sessions >= gate.minSessions) {
    return {
      decision: "promote",
      nextStage,
      reason:
        `crash-free rate ${(rate * 100).toFixed(3)}% over ${input.metrics.sessions} sessions meets the ` +
        `${gate.rate * 100}% / ${gate.minSessions}-session gate — promote ${input.currentStagePercent}% → ${nextStage}%`,
    };
  }
  if (input.metrics.sessions < gate.minSessions) {
    return {
      decision: "hold",
      reason:
        `crash-free rate ${(rate * 100).toFixed(3)}% meets the gate but only ${input.metrics.sessions} sessions ` +
        `(< ${gate.minSessions}) — hold for a larger sample`,
    };
  }
  return {
    decision: "hold",
    reason:
      `crash-free rate ${(rate * 100).toFixed(3)}% is below the promote gate ${(gate.rate * 100).toFixed(1)}% ` +
      `over ${input.metrics.sessions} sessions — hold`,
  };
}

/**
 * The halt remedy (DR-P21-05): publish the next manifest with
 * `minVersion` set — every device older than the last-good/fixed version is
 * force-updated off the bad build. Remedy manifests publish at
 * stagePercent 100 so the minimum-version gate is reached regardless of
 * cohort (client gate order: cohort precedes the min-version gate).
 */
export function haltRemedy(currentVersion: string): { readonly action: "force-update"; readonly minVersion: string } {
  return { action: "force-update", minVersion: currentVersion };
}

function seedFor(version: string, stage: RolloutStage, carried?: string): string {
  // Deterministic rollout-epoch id: identifies which stage block a manifest
  // belongs to on the dashboards. The cohort hash itself binds to
  // deviceId:channel:version (manifest.isCohortSelected — binding); the
  // seed is audit metadata, never part of the hash.
  return carried ?? `${version}:${stage}`;
}

/**
 * Pure reducer: apply a stage decision to the current manifest rollout
 * block. promote → the next canonical stage (fresh epoch seed); hold/halt →
 * the stage stays where it is (a halt freezes serving; the REMEDY is the
 * haltRemedy minimum-version bump, not a stage change).
 */
export function applyStageDecision(input: {
  readonly version: string;
  readonly current: Readonly<{ stagePercent: RolloutStage; cohortSeed?: string }>;
  readonly decision: StageTransitionDecision;
}): RolloutBlock {
  if (input.decision.decision === "promote" && input.decision.nextStage !== undefined) {
    return { stagePercent: input.decision.nextStage, cohortSeed: seedFor(input.version, input.decision.nextStage) };
  }
  return {
    stagePercent: input.current.stagePercent,
    cohortSeed: seedFor(input.version, input.current.stagePercent, input.current.cohortSeed),
  };
}
