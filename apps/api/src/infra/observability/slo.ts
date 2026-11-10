/**
 * PHASE-025 T9c — the SLO evaluator + error budgets (MONITORING §5; the
 * six SLOs go live at GA per RELEASE_STRATEGY). This module FINALIZES the
 * §5 candidate table (the "finalized in PHASE-025" note) over the
 * in-process metrics substrate (SF-024-021 — `infra/observability/
 * metrics.ts`): pure functions from a MetricsSnapshot to per-SLO
 * evaluations (target, observed, budget remaining, burn rate, state) and
 * the SLOBurn alert set (MONITORING §3: 2× → Sev-2, 4× → Sev-1, runbook
 * §5 + TROUBLESHOOTING §api — every alert links a runbook).
 *
 * SLO_BURN_EVALUATION (ops cadence): there is no background scheduler —
 * evaluation happens ON DEMAND at `GET /api/v1/platform/slo` (this makes
 * the state inspectable now) and is designed to be evaluated PER SCRAPE
 * by the future metrics pipeline (the OTel exporter swap); the paging
 * policy is the §3 SLOBurn row (Sev-2 pages in business hours, Sev-1
 * pages immediately).
 *
 * Honest window semantics: the in-process registry accumulates for the
 * PROCESS LIFETIME (restarts reset it — no persistence, no new tables).
 * Every evaluation therefore carries window.kind = "process-lifetime";
 * the 30-day error-budget window is the pipeline's concern and is never
 * fabricated here. NO_DATA is a first-class state — an SLO without
 * samples is NEVER green by silence (the backup/restore-smoke leg lives
 * in NO_DATA until the pipeline lands: the nightly smoke runs
 * out-of-process; only the recordRestoreSmokeOutcome seam exists).
 *
 * Burn math (MONITORING §3 SLOBurn): burn = observed error rate ÷ allowed
 * error rate over the window; ≥ 2 → BURNING_2X (Sev-2), ≥ 4 →
 * BURNING_4X (Sev-1). For 100%-target SLOs (allowed = 0) any failure
 * exhausts the budget instantly — burn is reported as the BURN_CAP
 * sentinel (999) and the escalation ladder is the catalog row (a single
 * restore-smoke miss pages Sev-2; a repeat is Sev-1).
 */

import {
  processMetrics,
  REPORT_CLASS_BUDGET_MS,
  ROUTE_GROUP_BUDGET_MS,
  type LatencyStats,
  type MetricsSnapshot,
  type RouteGroup,
} from "./metrics";

// -- the finalized six (MONITORING §5; targets finalized here, PHASE-025) -------

export type SloId =
  | "api_availability"
  | "api_latency"
  | "posting_success"
  | "backup_restore_smoke"
  | "sync_push_success"
  | "report_render_sla";

export type SloState = "OK" | "BURNING_2X" | "BURNING_4X" | "NO_DATA";

/** Burn sentinel for zero-budget (100%-target) SLOs (see header). */
export const BURN_CAP = 999;

export const SLO_TARGETS: Readonly<Record<SloId, { target: string; allowedErrorRate: number }>> =
  Object.freeze({
    api_availability: { target: "99.9% non-5xx (monthly)", allowedErrorRate: 0.001 },
    // p95 within budget ⟺ ≤ 5% of requests over budget (the percentile's
    // definition) — the latency SLO's allowed error rate.
    api_latency: { target: "p95 within NFR-006 budget per route group", allowedErrorRate: 0.05 },
    posting_success: { target: "≥ 99.99% engine attempts; zero invariant failures", allowedErrorRate: 0.0001 },
    backup_restore_smoke: { target: "100% of scheduled runs", allowedErrorRate: 0 },
    sync_push_success: { target: "≥ 99.5% within 24 h", allowedErrorRate: 0.005 },
    report_render_sla: { target: "p95 within the tier budget per report class", allowedErrorRate: 0.05 },
  });

/** Pure: burn = observed ÷ allowed (BURN_CAP sentinel when allowed = 0). */
export function computeBurnRate(observedErrorRate: number, allowedErrorRate: number): number {
  if (allowedErrorRate <= 0) {
    return observedErrorRate > 0 ? BURN_CAP : 0;
  }
  return observedErrorRate / allowedErrorRate;
}

/** Pure: the burn-state ladder (MONITORING §3 SLOBurn: 2× Sev-2 / 4× Sev-1).
 * A 1e-9 float tolerance absorbs binary-representation noise at the
 * thresholds (a seeded exact-2× window computes 1.9999999999999996 —
 * 0.1/0.05 is not exact in binary; severity must not flip on 1e-15
 * artifacts — documented, deliberate, never applied to money math). */
export const BURN_THRESHOLD_EPSILON = 1e-9;

export function burnStateOf(burnRate: number): Exclude<SloState, "NO_DATA"> {
  if (burnRate >= 4 - BURN_THRESHOLD_EPSILON) {
    return "BURNING_4X";
  }
  if (burnRate >= 2 - BURN_THRESHOLD_EPSILON) {
    return "BURNING_2X";
  }
  return "OK";
}

/** Pure: remaining error-budget fraction (may go negative = exhausted;
 * zero-budget SLOs are binary — any failure exhausts the budget). */
export function budgetRemainingOf(
  observedErrorRate: number,
  allowedErrorRate: number,
): number {
  if (allowedErrorRate <= 0) {
    return observedErrorRate > 0 ? -1 : 1;
  }
  return (allowedErrorRate - observedErrorRate) / allowedErrorRate;
}

// -- evaluation payloads ------------------------------------------------------------

export interface ApiLatencyGroupRow {
  group: RouteGroup;
  requests: number;
  overBudget: number;
  overBudgetFraction: number;
  budgetMs: number;
  stats: LatencyStats;
  state: Exclude<SloState, "NO_DATA">;
}

export interface ReportClassRow {
  executionClass: "inline" | "job";
  attempts: number;
  successes: number;
  overBudget: number;
  withinBudgetFraction: number;
  budgetMs: number;
  state: Exclude<SloState, "NO_DATA">;
}

export interface SloEvaluation {
  id: SloId;
  /** Ops-facing English title (the web screen localizes by id). */
  title: string;
  target: string;
  /** Human summary of the observed window; null only when NO_DATA. */
  observed: string | null;
  /** Remaining error-budget fraction (≤ 1; negative = exhausted). */
  budgetRemaining: number | null;
  burnRate: number | null;
  state: SloState;
  detail:
    | { kind: "api_availability"; totalRequests: number; errors5xx: number }
    | { kind: "api_latency"; groups: ApiLatencyGroupRow[] }
    | {
        kind: "posting_success";
        attempts: number;
        successes: number;
        failuresByCode: { code: string; value: number }[];
        invariantFailures: number;
        latency: LatencyStats;
      }
    | {
        kind: "backup_restore_smoke";
        attempts: number;
        successes: number;
        /** Honest marker: the nightly smoke is pipeline-external today. */
        noDataReason: string | null;
      }
    | { kind: "sync_push_success"; attempts: number; successes: number; deferred: number }
    | {
        kind: "report_render_sla";
        classes: ReportClassRow[];
        templates: { template: string; stats: LatencyStats }[];
      };
}

// -- per-SLO evaluators (pure over the snapshot) -----------------------------------

function evaluateApiAvailability(snapshot: MetricsSnapshot): SloEvaluation {
  const totalRequests = Object.values(snapshot.api.requestsByGroup).reduce(
    (sum, value) => sum + value,
    0,
  );
  const errors5xx = snapshot.api.errors
    .filter((row) => row.statusClass === "5xx")
    .reduce((sum, row) => sum + row.value, 0);
  const target = SLO_TARGETS.api_availability;
  if (totalRequests === 0) {
    return noData("api_availability", "API availability", target.target, {
      kind: "api_availability",
      totalRequests: 0,
      errors5xx: 0,
    });
  }
  const observedErrorRate = errors5xx / totalRequests;
  const burnRate = computeBurnRate(observedErrorRate, target.allowedErrorRate);
  return {
    id: "api_availability",
    title: "API availability",
    target: target.target,
    observed: `${((1 - observedErrorRate) * 100).toFixed(3)}% non-5xx over ${totalRequests} requests (${errors5xx} 5xx)`,
    budgetRemaining: budgetRemainingOf(observedErrorRate, target.allowedErrorRate),
    burnRate,
    state: burnStateOf(burnRate),
    detail: { kind: "api_availability", totalRequests, errors5xx },
  };
}

function evaluateApiLatency(snapshot: MetricsSnapshot): SloEvaluation {
  const target = SLO_TARGETS.api_latency;
  const groups: ApiLatencyGroupRow[] = [];
  let worst: Exclude<SloState, "NO_DATA"> = "OK";
  let worstRow: ApiLatencyGroupRow | undefined;
  let anyRequests = false;
  for (const row of snapshot.api.latencyByGroup) {
    const requests = snapshot.api.requestsByGroup[row.group] ?? 0;
    const overBudget = snapshot.api.overBudgetByGroup[row.group] ?? 0;
    if (requests > 0) {
      anyRequests = true;
    }
    const overBudgetFraction = requests === 0 ? 0 : overBudget / requests;
    const burnRate = computeBurnRate(overBudgetFraction, target.allowedErrorRate);
    const state = burnStateOf(burnRate);
    groups.push({
      group: row.group,
      requests,
      overBudget,
      overBudgetFraction,
      budgetMs: ROUTE_GROUP_BUDGET_MS[row.group],
      stats: row.stats,
      state,
    });
    // The headline row: the worst state, tie-broken by the largest
    // over-budget fraction (all-OK windows surface the worst-behaving
    // group, not an arbitrary one).
    const candidate = groups[groups.length - 1]!;
    if (
      worstRow === undefined ||
      (state !== "OK" && worst === "OK") ||
      (state === "BURNING_4X" && worst === "BURNING_2X") ||
      (state === worst && candidate.overBudgetFraction > worstRow.overBudgetFraction)
    ) {
      worst = state;
      worstRow = candidate;
    }
  }
  if (!anyRequests) {
    return noData("api_latency", "API latency p95", target.target, {
      kind: "api_latency",
      groups,
    });
  }
  const headline = worstRow ?? groups[0]!;
  return {
    id: "api_latency",
    title: "API latency p95",
    target: target.target,
    observed: `worst group ${headline.group}: ${(headline.overBudgetFraction * 100).toFixed(1)}% of requests over its ${headline.budgetMs} ms budget (p95 ${headline.stats.p95} ms)`,
    budgetRemaining: budgetRemainingOf(headline.overBudgetFraction, target.allowedErrorRate),
    burnRate: computeBurnRate(headline.overBudgetFraction, target.allowedErrorRate),
    state: worst,
    detail: { kind: "api_latency", groups },
  };
}

function evaluatePostingSuccess(snapshot: MetricsSnapshot): SloEvaluation {
  const target = SLO_TARGETS.posting_success;
  const { attempts, successes, failuresByCode, invariantFailures, latency } = snapshot.posting;
  if (attempts === 0) {
    return noData("posting_success", "Posting success", target.target, {
      kind: "posting_success",
      attempts: 0,
      successes: 0,
      failuresByCode,
      invariantFailures: 0,
      latency,
    });
  }
  const failureRate = (attempts - successes) / attempts;
  const burnRate = computeBurnRate(failureRate, target.allowedErrorRate);
  // Zero-tolerance leg (RISK-009 / MONITORING §3 PostingInvariantFail):
  // any invariant failure is Sev-1 REGARDLESS of budget — the SLO state
  // escalates to the Sev-1 burn class even when the success rate holds.
  const state: SloState =
    invariantFailures > 0 ? "BURNING_4X" : burnStateOf(burnRate);
  const successRate = successes / attempts;
  return {
    id: "posting_success",
    title: "Posting success",
    target: target.target,
    observed: `${(successRate * 100).toFixed(3)}% of ${attempts} engine attempts (${invariantFailures} invariant failures, p95 ${latency.p95} ms)`,
    budgetRemaining: budgetRemainingOf(failureRate, target.allowedErrorRate),
    burnRate,
    state,
    detail: { kind: "posting_success", attempts, successes, failuresByCode, invariantFailures, latency },
  };
}

function evaluateBackupRestoreSmoke(snapshot: MetricsSnapshot): SloEvaluation {
  const target = SLO_TARGETS.backup_restore_smoke;
  const { attempts, successes } = snapshot.restoreSmoke;
  if (attempts === 0) {
    return noData("backup_restore_smoke", "Backup + restore-smoke", target.target, {
      kind: "backup_restore_smoke",
      attempts: 0,
      successes: 0,
      /** Honest marker: the nightly smoke is pipeline-external today. */
      noDataReason:
        "no data (external cadence): the nightly restore-smoke and the drills run out-of-process — the recordRestoreSmokeOutcome seam (SF-024-021) feeds this SLO when the metrics pipeline lands",
    });
  }
  const failures = attempts - successes;
  // 100% target: any miss exhausts the budget; escalation per the §3
  // RestoreSmokeFailed row (single miss Sev-2, repeat Sev-1).
  const state: SloState = failures >= 2 ? "BURNING_4X" : failures === 1 ? "BURNING_2X" : "OK";
  return {
    id: "backup_restore_smoke",
    title: "Backup + restore-smoke",
    target: target.target,
    observed: `${successes}/${attempts} smoke runs succeeded`,
    budgetRemaining: failures > 0 ? -1 : 1,
    burnRate: computeBurnRate(failures > 0 ? 1 : 0, target.allowedErrorRate),
    state,
    detail: { kind: "backup_restore_smoke", attempts, successes, noDataReason: null },
  };
}

function evaluateSyncPushSuccess(snapshot: MetricsSnapshot): SloEvaluation {
  const target = SLO_TARGETS.sync_push_success;
  const { attempts, successes, deferred } = snapshot.syncPush;
  if (attempts === 0) {
    return noData("sync_push_success", "Sync push success", target.target, {
      kind: "sync_push_success",
      attempts: 0,
      successes: 0,
      deferred,
    });
  }
  const failureRate = (attempts - successes) / attempts;
  const burnRate = computeBurnRate(failureRate, target.allowedErrorRate);
  return {
    id: "sync_push_success",
    title: "Sync push success",
    target: target.target,
    observed: `${((successes / attempts) * 100).toFixed(2)}% of ${attempts} terminal push outcomes (${deferred} deferred, excluded)`,
    budgetRemaining: budgetRemainingOf(failureRate, target.allowedErrorRate),
    burnRate,
    state: burnStateOf(burnRate),
    detail: { kind: "sync_push_success", attempts, successes, deferred },
  };
}

function evaluateReportRenderSla(snapshot: MetricsSnapshot): SloEvaluation {
  const target = SLO_TARGETS.report_render_sla;
  const classes: ReportClassRow[] = [];
  let worst: Exclude<SloState, "NO_DATA"> = "OK";
  let worstClass: ReportClassRow | undefined;
  let anyAttempts = false;
  for (const row of snapshot.reporting.byClass) {
    if (row.attempts > 0) {
      anyAttempts = true;
    }
    const withinBudgetFraction =
      row.attempts === 0 ? 1 : (row.successes - row.overBudget) / row.attempts;
    const overFraction = 1 - withinBudgetFraction;
    const burnRate = computeBurnRate(overFraction, target.allowedErrorRate);
    const state = burnStateOf(burnRate);
    classes.push({
      executionClass: row.executionClass,
      attempts: row.attempts,
      successes: row.successes,
      overBudget: row.overBudget,
      withinBudgetFraction,
      budgetMs: REPORT_CLASS_BUDGET_MS[row.executionClass],
      state,
    });
    // The headline row: the worst state, tie-broken by the largest
    // over-budget fraction.
    const candidate = classes[classes.length - 1]!;
    if (
      worstClass === undefined ||
      (state !== "OK" && worst === "OK") ||
      (state === "BURNING_4X" && worst === "BURNING_2X") ||
      (state === worst && 1 - candidate.withinBudgetFraction > 1 - worstClass.withinBudgetFraction)
    ) {
      worst = state;
      worstClass = candidate;
    }
  }
  if (!anyAttempts) {
    return noData("report_render_sla", "Report render SLA", target.target, {
      kind: "report_render_sla",
      classes,
      templates: snapshot.reporting.byTemplate,
    });
  }
  const headline = worstClass ?? classes[0]!;
  const overFraction = 1 - headline.withinBudgetFraction;
  return {
    id: "report_render_sla",
    title: "Report render SLA",
    target: target.target,
    observed: `${headline.executionClass} class: ${(overFraction * 100).toFixed(1)}% of ${headline.attempts} renders over the ${headline.budgetMs} ms tier budget`,
    budgetRemaining: budgetRemainingOf(overFraction, target.allowedErrorRate),
    burnRate: computeBurnRate(overFraction, target.allowedErrorRate),
    state: worst,
    detail: { kind: "report_render_sla", classes, templates: snapshot.reporting.byTemplate },
  };
}

function noData(
  id: SloId,
  title: string,
  target: string,
  detail: SloEvaluation["detail"],
): SloEvaluation {
  return {
    id,
    title,
    target,
    observed: null,
    budgetRemaining: null,
    burnRate: null,
    state: "NO_DATA",
    detail,
  };
}

/** All six SLOs, in MONITORING §5 table order. Pure over the snapshot. */
export function evaluateSlos(snapshot: MetricsSnapshot): SloEvaluation[] {
  return [
    evaluateApiAvailability(snapshot),
    evaluateApiLatency(snapshot),
    evaluatePostingSuccess(snapshot),
    evaluateBackupRestoreSmoke(snapshot),
    evaluateSyncPushSuccess(snapshot),
    evaluateReportRenderSla(snapshot),
  ];
}

// -- the SLOBurn alert set (MONITORING §3 rows: SLOBurn + the posting leg) --------

export interface SloBurnAlert {
  name: "SLOBurn" | "PostingInvariantFail";
  severity: "sev-1" | "sev-2";
  slo: SloId;
  /** Ops-facing English message (the ops channel language). */
  message: string;
  /** Every alert links a runbook (MONITORING §2 rule) — the catalog rows. */
  runbook: string;
  burnRate: number | null;
}

/** The SLOBurn row's runbook (§5 + TROUBLESHOOTING §api), verbatim. */
const SLO_BURN_RUNBOOK = "docs/operations/MONITORING.md §5 + docs/operations/TROUBLESHOOTING.md §api";
/** The PostingInvariantFail row's runbook (TROUBLESHOOTING §api). */
const POSTING_INVARIANT_RUNBOOK = "docs/operations/TROUBLESHOOTING.md §api";

/**
 * The fired burn alerts: every BURNING_2X SLO → SLOBurn Sev-2; every
 * BURNING_4X SLO → SLOBurn Sev-1; any posting invariant failure →
 * PostingInvariantFail Sev-1 (zero tolerance, RISK-009 — "should never
 * fire"; engine-internal bug class). NO_DATA never alerts (silence is
 * not green, but it is not a page either — it is a wiring gap).
 */
export function evaluateSloBurnAlerts(slos: readonly SloEvaluation[]): SloBurnAlert[] {
  const alerts: SloBurnAlert[] = [];
  for (const slo of slos) {
    const postingDetail =
      slo.id === "posting_success" && slo.detail.kind === "posting_success" ? slo.detail : undefined;
    if (postingDetail !== undefined && postingDetail.invariantFailures > 0) {
      // The posting zero-tolerance leg replaces the generic SLOBurn entry
      // when it fires: PostingInvariantFail IS the catalog's alert for
      // that class (same Sev-1) — emitting both would page twice for one
      // cause.
      alerts.push({
        name: "PostingInvariantFail",
        severity: "sev-1",
        slo: slo.id,
        message: `posting engine rejected on invariant breach ${postingDetail.invariantFailures} time(s) — zero tolerance (RISK-009), investigate immediately`,
        runbook: POSTING_INVARIANT_RUNBOOK,
        burnRate: slo.burnRate,
      });
      continue;
    }
    if (slo.state === "BURNING_2X" || slo.state === "BURNING_4X") {
      alerts.push({
        name: "SLOBurn",
        severity: slo.state === "BURNING_4X" ? "sev-1" : "sev-2",
        slo: slo.id,
        message: `error-budget burn ${slo.burnRate === null ? "≥" : `${slo.burnRate.toFixed(1)}×`} on ${slo.title} (target ${slo.target}; observed ${slo.observed ?? "n/a"})`,
        runbook: SLO_BURN_RUNBOOK,
        burnRate: slo.burnRate,
      });
    }
  }
  return alerts;
}

// -- the endpoint snapshot ------------------------------------------------------------

export interface SloSnapshot {
  generatedAt: string;
  substrate: "in-process (SF-024-021)";
  window: { kind: "process-lifetime"; startedAt: string };
  slos: SloEvaluation[];
  burnAlerts: SloBurnAlert[];
  metrics: MetricsSnapshot;
}

/**
 * The full SLO snapshot for `GET /api/v1/platform/slo` (the dashboard's
 * source): evaluations + burn alerts + the raw metrics view.
 */
export function sloSnapshot(registry: { snapshot(): MetricsSnapshot } = processMetrics): SloSnapshot {
  const metrics = registry.snapshot();
  const slos = evaluateSlos(metrics);
  return {
    generatedAt: metrics.generatedAt,
    substrate: "in-process (SF-024-021)",
    window: { kind: "process-lifetime", startedAt: new Date(metrics.processStartedAtMs).toISOString() },
    slos,
    burnAlerts: evaluateSloBurnAlerts(slos),
    metrics,
  };
}
