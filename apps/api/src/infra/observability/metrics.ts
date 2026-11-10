/**
 * PHASE-025 T9a — the in-process metrics registry (MONITORING §1 metric
 * naming; OBSERVABILITY §"export enabled when a backend is chosen"): the
 * SF-024-021 substrate generalized. The OpenTelemetry providers are the
 * documented no-op seam (`infra/observability/otel.ts` — DR-003 vendor
 * decision pending), so every metric lives IN-PROCESS: monotonic counters
 * + fixed-capacity latency ring samplers, no external dependency (no
 * prom-client). The OTel exporter swap picks the SAME names up — that is
 * the contract: names are `erp_<module>_<name>_<unit>` (MONITORING §1),
 * stable, and never renamed without a docs pass.
 *
 * Honest window semantics: counters accumulate for the PROCESS LIFETIME
 * (restart resets them — no persistence by design; no new tables, the
 * PHASE-025 constraint). The SLO evaluator (slo.ts) therefore reports a
 * process-lifetime window and marks it as such; the 30-day error-budget
 * window is the metrics-pipeline concern, not fabricated here. Samplers
 * keep the most recent `SAMPLER_CAPACITY` samples per series (the sync
 * health aggregate's "percentile of the recent sample" approximation).
 *
 * This module is deliberately dependency-free (no env, no logger) so the
 * audit script (`scripts/check-observability.ts`) and unit specs can
 * import it standalone. Breach-class events (e.g. posting invariant
 * failures) log at THEIR wiring point (the SF-024-021 fatal-log triage
 * path), not here.
 */

/** The eight API route groups (MONITORING §1 "API golden signals" panel). */
export const ROUTE_GROUPS = [
  "identity",
  "accounting",
  "sales",
  "purchasing",
  "treasury",
  "inventory",
  "sync",
  "platform",
] as const;

export type RouteGroup = (typeof ROUTE_GROUPS)[number];

/**
 * NFR-006 / PERFORMANCE_TEST_PLAN §1 p95 budgets per route group (ms) —
 * the binding budget of the group's governing interaction class:
 * identity = T-06 (login + shell p95 < 1.5 s); the document-plane groups
 * (accounting/sales/purchasing/treasury/inventory) = T-01 (interactive
 * document list p95 < 500 ms); sync = T-05 (sync round-trip p95 < 3 s);
 * platform = T-04 interactive-report tier (p95 < 2 s) for the mixed
 * admin/reporting plane. Posting's engine-path 300 ms (T-02) is measured
 * by the posting duration sampler, and the statement/heavy export tiers
 * (10 s / 15 min) by the report render counters — never by one group
 * budget.
 */
export const ROUTE_GROUP_BUDGET_MS: Readonly<Record<RouteGroup, number>> = Object.freeze({
  identity: 1500,
  accounting: 500,
  sales: 500,
  purchasing: 500,
  treasury: 500,
  inventory: 500,
  sync: 3000,
  platform: 2000,
});

/** Report render tier budgets (PERFORMANCE_TEST_PLAN §1 T-04, by the
 * report contract's executionClass): inline = interactive reports
 * (p95 < 2 s); job = worker-isolated statements + heavy exports
 * (≤ 15 min p95). */
export const REPORT_CLASS_BUDGET_MS: Readonly<Record<"inline" | "job", number>> = Object.freeze({
  inline: 2000,
  job: 900_000,
});

/** Posting engine-path budget (T-02: invoice posting p95 < 300 ms) — the
 * display budget for the posting duration sampler. */
export const POSTING_BUDGET_MS = 300;

/**
 * The metric naming convention (MONITORING §1: `erp_<module>_<name>_<unit>`)
 * as a machine rule, shared by the unit spec and the observability audit.
 * The unit suffix is the FINAL segment; units in the corpus: total, ms,
 * count, ratio, devices, ops. Tokens with fewer than three segments
 * (erp_app, erp_migrate — database roles) are not metric names.
 */
export const METRIC_NAME_PATTERN = /^erp_[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(?:total|ms|count|ratio|devices|ops)$/;

/** Conformance helper (spec + audit share this exact rule). */
export function isConformantMetricName(name: string): boolean {
  return METRIC_NAME_PATTERN.test(name);
}

// -- metric name constants (the OTel exporter swap picks these up) ---------------

export const METRIC_API_REQUESTS_TOTAL = "erp_api_requests_total";
export const METRIC_API_ERRORS_TOTAL = "erp_api_errors_total";
export const METRIC_API_REQUEST_OVER_BUDGET_TOTAL = "erp_api_request_over_budget_total";
export const METRIC_API_REQUEST_DURATION_MS = "erp_api_request_duration_ms";
export const METRIC_POSTING_ATTEMPTS_TOTAL = "erp_posting_attempts_total";
export const METRIC_POSTING_SUCCESS_TOTAL = "erp_posting_success_total";
export const METRIC_POSTING_FAILURES_TOTAL = "erp_posting_failures_total";
export const METRIC_POSTING_INVARIANT_FAILURES_TOTAL = "erp_posting_invariant_failures_total";
export const METRIC_POSTING_DURATION_MS = "erp_posting_duration_ms";
export const METRIC_SYNC_PUSH_ATTEMPTS_TOTAL = "erp_sync_push_attempts_total";
export const METRIC_SYNC_PUSH_SUCCESS_TOTAL = "erp_sync_push_success_total";
export const METRIC_SYNC_PUSH_DEFERRED_TOTAL = "erp_sync_push_deferred_total";
export const METRIC_BACKUPS_RESTORE_SMOKE_ATTEMPTS_TOTAL = "erp_backups_restore_smoke_attempts_total";
export const METRIC_BACKUPS_RESTORE_SMOKE_SUCCESS_TOTAL = "erp_backups_restore_smoke_success_total";
export const METRIC_REPORTING_RENDER_ATTEMPTS_TOTAL = "erp_reporting_render_attempts_total";
export const METRIC_REPORTING_RENDER_SUCCESS_TOTAL = "erp_reporting_render_success_total";
export const METRIC_REPORTING_RENDER_OVER_BUDGET_TOTAL = "erp_reporting_render_over_budget_total";
export const METRIC_REPORTING_RENDER_DURATION_MS = "erp_reporting_render_duration_ms";

// -- latency statistics (ADR-0009 house pattern: raw float arithmetic) -----------

/**
 * Rank-selected percentile of SORTED ascending samples. The Math.* ban
 * (ADR-0009) forbids rounding helpers; rank selection is the sanctioned
 * `no-restricted-properties` exemption (the mvp-candidate `p95()` /
 * ga-fixtures `gaPercentile` shape) — latency statistics, never money
 * math. Returns null for an empty sample (no data ≠ zero).
 */
export function percentileOf(sortedSamples: readonly number[], fraction: number): number | null {
  if (sortedSamples.length === 0) {
    return null;
  }
  // eslint-disable-next-line no-restricted-properties -- latency-statistics rank selection (ADR-0009 exemption), never money math.
  const rank = Math.ceil(sortedSamples.length * fraction);
  const index = Math.min(sortedSamples.length, Math.max(1, rank)) - 1;
  return sortedSamples[index] ?? 0;
}

/** Fixed-capacity ring of recent latency samples (most recent SAMPLER_CAPACITY). */
class LatencySamples {
  private readonly buffer = new Float64Array(SAMPLER_CAPACITY);
  private writeIndex = 0;
  private size = 0;

  observe(valueMs: number): void {
    this.buffer[this.writeIndex] = valueMs;
    this.writeIndex = (this.writeIndex + 1) % SAMPLER_CAPACITY;
    if (this.size < SAMPLER_CAPACITY) {
      this.size += 1;
    }
  }

  /** Sorted ascending copy (snapshot-time only — never per sample). */
  sorted(): number[] {
    const values: number[] = [];
    for (let index = 0; index < this.size; index += 1) {
      values.push(this.buffer[index]!);
    }
    return values.sort((a, b) => a - b);
  }

  get count(): number {
    return this.size;
  }
}

/** Ring capacity per series: recent-window percentiles at sandbox cost. */
const SAMPLER_CAPACITY = 512;

export interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function statsOf(samples: LatencySamples): LatencyStats {
  const sorted = samples.sorted();
  return {
    n: sorted.length,
    p50: percentileOf(sorted, 0.5) ?? 0,
    p95: percentileOf(sorted, 0.95) ?? 0,
    p99: percentileOf(sorted, 0.99) ?? 0,
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1]!,
  };
}

// -- labeled storage ---------------------------------------------------------------

interface LabeledSeries {
  readonly labelNames: readonly string[];
  /** key: label values joined by "|" (fixed cardinality per metric). */
  readonly values: Map<string, number>;
}

// -- snapshot views (what the SLO evaluator + endpoint consume) ---------------------

export interface ApiMetricsView {
  requestsByGroup: Record<RouteGroup, number>;
  /** 4xx/5xx errors by class and group (3xx are not errors — NFR-007/T-07). */
  errors: { statusClass: "4xx" | "5xx"; group: RouteGroup; value: number }[];
  /** Requests whose duration exceeded the group's ROUTE_GROUP_BUDGET_MS. */
  overBudgetByGroup: Record<RouteGroup, number>;
  /** Recent-window percentiles per group (sampler, not full-window). */
  latencyByGroup: { group: RouteGroup; stats: LatencyStats }[];
}

export interface PostingMetricsView {
  attempts: number;
  successes: number;
  failuresByCode: { code: string; value: number }[];
  /** Zero-tolerance (RISK-009): ENTRY_NOT_BALANCED-class engine failures. */
  invariantFailures: number;
  latency: LatencyStats;
}

export interface SyncPushMetricsView {
  /** Terminal outcomes only (ACCEPTED + REJECTED); DEFERRED is excluded —
   * the sync health aggregate's successRate definition. */
  attempts: number;
  successes: number;
  deferred: number;
}

export interface RestoreSmokeMetricsView {
  attempts: number;
  successes: number;
}

export interface ReportingRenderMetricsView {
  byClass: {
    executionClass: "inline" | "job";
    attempts: number;
    successes: number;
    overBudget: number;
    budgetMs: number;
  }[];
  /** Per-template recent-window percentiles (the "per template" view). */
  byTemplate: { template: string; stats: LatencyStats }[];
}

/** The serializable, typed view of the whole registry. */
export interface MetricsSnapshot {
  generatedAt: string;
  /** Process start (epoch ms) — the honest in-process window start. */
  processStartedAtMs: number;
  api: ApiMetricsView;
  posting: PostingMetricsView;
  syncPush: SyncPushMetricsView;
  restoreSmoke: RestoreSmokeMetricsView;
  reporting: ReportingRenderMetricsView;
  /** Every registered metric name (naming audit + the OTel swap doc). */
  metricNames: string[];
}

// -- the registry -------------------------------------------------------------------

export class MetricsRegistry {
  private readonly unlabeled = new Map<string, number>();
  private readonly labeled = new Map<string, LabeledSeries>();
  private readonly samplers = new Map<string, LatencySamples>();
  readonly startedAtMs: number;

  constructor() {
    this.startedAtMs = Date.now();
  }

  // -- generic bumps (fixed cardinality; the only Map growth is by label value)

  private bump(metric: string): void {
    this.unlabeled.set(metric, (this.unlabeled.get(metric) ?? 0) + 1);
  }

  private read(metric: string): number {
    return this.unlabeled.get(metric) ?? 0;
  }

  private bump1(metric: string, labelName: string, labelValue: string): void {
    let series = this.labeled.get(metric);
    if (series === undefined) {
      series = { labelNames: [labelName], values: new Map() };
      this.labeled.set(metric, series);
    }
    series.values.set(labelValue, (series.values.get(labelValue) ?? 0) + 1);
  }

  private bump2(
    metric: string,
    labelName1: string,
    value1: string,
    labelName2: string,
    value2: string,
  ): void {
    const key = `${value1}|${value2}`;
    let series = this.labeled.get(metric);
    if (series === undefined) {
      series = { labelNames: [labelName1, labelName2], values: new Map() };
      this.labeled.set(metric, series);
    }
    series.values.set(key, (series.values.get(key) ?? 0) + 1);
  }

  private read1(metric: string, labelValue: string): number {
    return this.labeled.get(metric)?.values.get(labelValue) ?? 0;
  }

  private readAll(metric: string): { values: Map<string, number>; labelNames: readonly string[] } {
    const series = this.labeled.get(metric);
    return { values: series?.values ?? new Map<string, number>(), labelNames: series?.labelNames ?? [] };
  }

  private sample(metric: string, labelValue: string, valueMs: number): void {
    const key = `${metric}|${labelValue}`;
    let samples = this.samplers.get(key);
    if (samples === undefined) {
      samples = new LatencySamples();
      this.samplers.set(key, samples);
    }
    samples.observe(valueMs);
  }

  private statsFor(metric: string, labelValue: string): LatencyStats {
    return statsOf(this.samplers.get(`${metric}|${labelValue}`) ?? new LatencySamples());
  }

  // -- recording API (the domain wiring points; every name is a constant above)

  /**
   * One API request (the metrics middleware): route-grouped request +
   * status-class error + over-budget counters and the latency sample.
   */
  recordApiRequest(group: RouteGroup, statusClass: "2xx" | "3xx" | "4xx" | "5xx", durationMs: number): void {
    this.bump1(METRIC_API_REQUESTS_TOTAL, "route_group", group);
    if (statusClass === "4xx" || statusClass === "5xx") {
      this.bump2(METRIC_API_ERRORS_TOTAL, "class", statusClass, "route_group", group);
    }
    if (durationMs > ROUTE_GROUP_BUDGET_MS[group]) {
      this.bump1(METRIC_API_REQUEST_OVER_BUDGET_TOTAL, "route_group", group);
    }
    this.sample(METRIC_API_REQUEST_DURATION_MS, group, durationMs);
  }

  /** A PostingService engine attempt (post or reverse — one call = one attempt). */
  recordPostingAttempt(): void {
    this.bump(METRIC_POSTING_ATTEMPTS_TOTAL);
  }

  /** A completed posting (fresh or idempotent replay — both are successes). */
  recordPostingSuccess(durationMs: number): void {
    this.bump(METRIC_POSTING_SUCCESS_TOTAL);
    this.sample(METRIC_POSTING_DURATION_MS, "engine", durationMs);
  }

  /** A thrown posting; `invariant` marks the zero-tolerance class (RISK-009). */
  recordPostingFailure(code: string, invariant: boolean): void {
    this.bump1(METRIC_POSTING_FAILURES_TOTAL, "code", code);
    if (invariant) {
      this.bump(METRIC_POSTING_INVARIANT_FAILURES_TOTAL);
    }
  }

  /** Terminal sync push outcomes for one batch (deferred excluded from attempts). */
  recordSyncPushOutcomes(counts: { accepted: number; rejected: number; deferred: number }): void {
    const attempts = counts.accepted + counts.rejected;
    if (attempts > 0) {
      this.unlabeled.set(
        METRIC_SYNC_PUSH_ATTEMPTS_TOTAL,
        this.read(METRIC_SYNC_PUSH_ATTEMPTS_TOTAL) + attempts,
      );
      this.unlabeled.set(
        METRIC_SYNC_PUSH_SUCCESS_TOTAL,
        this.read(METRIC_SYNC_PUSH_SUCCESS_TOTAL) + counts.accepted,
      );
    }
    if (counts.deferred > 0) {
      this.unlabeled.set(
        METRIC_SYNC_PUSH_DEFERRED_TOTAL,
        this.read(METRIC_SYNC_PUSH_DEFERRED_TOTAL) + counts.deferred,
      );
    }
  }

  /**
   * A restore-smoke run outcome. NO in-process producer exists today (the
   * nightly smoke + drills run out-of-process — MONITORING §1 "Backup
   * success" is pipeline-fed), so the SLO state stays honestly NO_DATA
   * until the pipeline lands; the seam is the SF-024-021 contract.
   */
  recordRestoreSmokeOutcome(success: boolean): void {
    this.bump(METRIC_BACKUPS_RESTORE_SMOKE_ATTEMPTS_TOTAL);
    if (success) {
      this.bump(METRIC_BACKUPS_RESTORE_SMOKE_SUCCESS_TOTAL);
    }
  }

  /** A report run outcome (run-service completion point). */
  recordReportRender(input: {
    executionClass: "inline" | "job";
    template: string;
    durationMs: number;
    ok: boolean;
  }): void {
    this.bump1(METRIC_REPORTING_RENDER_ATTEMPTS_TOTAL, "class", input.executionClass);
    if (!input.ok) {
      return;
    }
    this.bump1(METRIC_REPORTING_RENDER_SUCCESS_TOTAL, "class", input.executionClass);
    if (input.durationMs > REPORT_CLASS_BUDGET_MS[input.executionClass]) {
      this.bump1(METRIC_REPORTING_RENDER_OVER_BUDGET_TOTAL, "class", input.executionClass);
    }
    this.sample(METRIC_REPORTING_RENDER_DURATION_MS, input.template, input.durationMs);
  }

  // -- the snapshot ----------------------------------------------------------------

  snapshot(): MetricsSnapshot {
    const requestsByGroup = {} as Record<RouteGroup, number>;
    const overBudgetByGroup = {} as Record<RouteGroup, number>;
    const latencyByGroup: ApiMetricsView["latencyByGroup"] = [];
    for (const group of ROUTE_GROUPS) {
      requestsByGroup[group] = this.read1(METRIC_API_REQUESTS_TOTAL, group);
      overBudgetByGroup[group] = this.read1(METRIC_API_REQUEST_OVER_BUDGET_TOTAL, group);
      latencyByGroup.push({ group, stats: this.statsFor(METRIC_API_REQUEST_DURATION_MS, group) });
    }
    const errors: ApiMetricsView["errors"] = [];
    const errorSeries = this.readAll(METRIC_API_ERRORS_TOTAL);
    for (const [key, value] of errorSeries.values) {
      const [statusClass, group] = key.split("|");
      if (statusClass === "4xx" || statusClass === "5xx") {
        errors.push({ statusClass, group: group as RouteGroup, value });
      }
    }
    errors.sort((a, b) => b.value - a.value || a.group.localeCompare(b.group));

    const failuresByCode = [...this.readAll(METRIC_POSTING_FAILURES_TOTAL).values.entries()]
      .map(([code, value]) => ({ code, value }))
      .sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));

    const reportingByClass: ReportingRenderMetricsView["byClass"] = (["inline", "job"] as const).map(
      (executionClass) => ({
        executionClass,
        attempts: this.read1(METRIC_REPORTING_RENDER_ATTEMPTS_TOTAL, executionClass),
        successes: this.read1(METRIC_REPORTING_RENDER_SUCCESS_TOTAL, executionClass),
        overBudget: this.read1(METRIC_REPORTING_RENDER_OVER_BUDGET_TOTAL, executionClass),
        budgetMs: REPORT_CLASS_BUDGET_MS[executionClass],
      }),
    );
    const byTemplate: ReportingRenderMetricsView["byTemplate"] = [];
    for (const key of this.samplers.keys()) {
      if (!key.startsWith(`${METRIC_REPORTING_RENDER_DURATION_MS}|`)) {
        continue;
      }
      const template = key.slice(METRIC_REPORTING_RENDER_DURATION_MS.length + 1);
      byTemplate.push({ template, stats: this.statsFor(METRIC_REPORTING_RENDER_DURATION_MS, template) });
    }
    byTemplate.sort((a, b) => b.stats.p95 - a.stats.p95 || a.template.localeCompare(b.template));

    return {
      generatedAt: new Date().toISOString(),
      processStartedAtMs: this.startedAtMs,
      api: { requestsByGroup, errors, overBudgetByGroup, latencyByGroup },
      posting: {
        attempts: this.read(METRIC_POSTING_ATTEMPTS_TOTAL),
        successes: this.read(METRIC_POSTING_SUCCESS_TOTAL),
        failuresByCode,
        invariantFailures: this.read(METRIC_POSTING_INVARIANT_FAILURES_TOTAL),
        latency: this.statsFor(METRIC_POSTING_DURATION_MS, "engine"),
      },
      syncPush: {
        attempts: this.read(METRIC_SYNC_PUSH_ATTEMPTS_TOTAL),
        successes: this.read(METRIC_SYNC_PUSH_SUCCESS_TOTAL),
        deferred: this.read(METRIC_SYNC_PUSH_DEFERRED_TOTAL),
      },
      restoreSmoke: {
        attempts: this.read(METRIC_BACKUPS_RESTORE_SMOKE_ATTEMPTS_TOTAL),
        successes: this.read(METRIC_BACKUPS_RESTORE_SMOKE_SUCCESS_TOTAL),
      },
      reporting: { byClass: reportingByClass, byTemplate },
      metricNames: this.metricNames(),
    };
  }

  /** Every registered metric name (unlabeled + labeled + samplers). */
  metricNames(): string[] {
    const names = new Set<string>([...this.unlabeled.keys(), ...this.labeled.keys()]);
    for (const key of this.samplers.keys()) {
      names.add(key.split("|")[0]!);
    }
    return [...names].sort();
  }
}

/** Factory (specs + any future multi-registry consumer). */
export function createMetricsRegistry(): MetricsRegistry {
  return new MetricsRegistry();
}

/** The process-wide registry (the SF-024-021 in-process substrate). */
export const processMetrics = new MetricsRegistry();
