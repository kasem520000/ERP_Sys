import { describe, expect, it } from "vitest";

import {
  createMetricsRegistry,
  isConformantMetricName,
  METRIC_NAME_PATTERN,
  percentileOf,
  processMetrics,
  ROUTE_GROUPS,
  type MetricsSnapshot,
} from "./metrics";
import {
  BURN_CAP,
  burnStateOf,
  computeBurnRate,
  evaluateSloBurnAlerts,
  evaluateSlos,
  sloSnapshot,
  type SloEvaluation,
} from "./slo";
import { routeGroupOf, statusClassOf } from "../http/metrics.middleware";

/**
 * PHASE-025 T9e — the seeded-burn spec (the gate item "SLOBurn alert fires
 * on seeded burn"): pure unit proofs of the SLO math over a synthetic
 * in-process registry — 2×/4× burn severities, healthy windows, NO_DATA
 * (never green-by-silence), the posting zero-tolerance leg, and the metric
 * naming convention (MONITORING §1) asserted programmatically.
 */

describe("metric naming convention (MONITORING §1: erp_<module>_<name>_<unit>)", () => {
  it("every name a registry ever registers is conformant", () => {
    const registry = createMetricsRegistry();
    // Drive every recording path once so every metric exists.
    registry.recordApiRequest("sales", "5xx", 10);
    registry.recordApiRequest("sales", "4xx", 10);
    registry.recordApiRequest("identity", "2xx", 10);
    registry.recordPostingAttempt();
    registry.recordPostingSuccess(5);
    registry.recordPostingFailure("PERIOD_LOCKED", false);
    registry.recordPostingFailure("ENTRY_NOT_BALANCED", true);
    registry.recordSyncPushOutcomes({ accepted: 1, rejected: 1, deferred: 1 });
    registry.recordRestoreSmokeOutcome(true);
    registry.recordReportRender({ executionClass: "inline", template: "t", durationMs: 1, ok: true });
    registry.recordReportRender({ executionClass: "job", template: "t2", durationMs: 1, ok: false });
    for (const name of registry.snapshot().metricNames) {
      expect(isConformantMetricName(name), `metric name ${name}`).toBe(true);
    }
    // The substrate's expected surface (spot-check the golden-signal trio).
    for (const expected of [
      "erp_api_requests_total",
      "erp_api_errors_total",
      "erp_api_request_duration_ms",
      "erp_posting_attempts_total",
      "erp_posting_invariant_failures_total",
      "erp_sync_push_attempts_total",
      "erp_backups_restore_smoke_attempts_total",
      "erp_reporting_render_duration_ms",
    ]) {
      expect(registry.snapshot().metricNames, expected).toContain(expected);
    }
  });

  it("the pattern rule itself (module + name + unit; roles like erp_app are not metrics)", () => {
    expect("erp_rls_denials_total").toMatch(METRIC_NAME_PATTERN);
    expect("erp_api_request_duration_ms").toMatch(METRIC_NAME_PATTERN);
    expect("erp_sync_outbox_lag_devices").toMatch(METRIC_NAME_PATTERN);
    expect("erp_app").not.toMatch(METRIC_NAME_PATTERN);
    expect("erp_migrate").not.toMatch(METRIC_NAME_PATTERN);
    expect("erp").not.toMatch(METRIC_NAME_PATTERN);
    expect("erpx_api_requests_total").not.toMatch(METRIC_NAME_PATTERN);
    expect("erp_api_requests").not.toMatch(METRIC_NAME_PATTERN);
    expect("erp_API_requests_total").not.toMatch(METRIC_NAME_PATTERN);
  });
});

describe("latency statistics (ADR-0009 house pattern)", () => {
  it("rank-selects p50/p95/p99 from sorted samples (null on empty)", () => {
    expect(percentileOf([], 0.95)).toBeNull();
    const oneToHundred = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentileOf(oneToHundred, 0.5)).toBe(50);
    expect(percentileOf(oneToHundred, 0.95)).toBe(95);
    expect(percentileOf(oneToHundred, 0.99)).toBe(99);
    expect(percentileOf([42], 0.95)).toBe(42);
  });
});

describe("route grouping + status classes (the golden-signal buckets)", () => {
  it("classifies the real /api/v1 namespaces into the eight groups", () => {
    expect(routeGroupOf("/api/v1/identity/sessions/current")).toBe("identity");
    expect(routeGroupOf("/api/v1/tenancy/profile")).toBe("identity");
    expect(routeGroupOf("/api/v1/accounting/journals")).toBe("accounting");
    expect(routeGroupOf("/api/v1/audit/events")).toBe("accounting");
    expect(routeGroupOf("/api/v1/sales/invoices")).toBe("sales");
    expect(routeGroupOf("/api/v1/pos/shifts")).toBe("sales");
    expect(routeGroupOf("/api/v1/partners/partners")).toBe("sales");
    expect(routeGroupOf("/api/v1/purchasing/orders")).toBe("purchasing");
    expect(routeGroupOf("/api/v1/treasury/receipts")).toBe("treasury");
    expect(routeGroupOf("/api/v1/tax/vat-return")).toBe("treasury");
    expect(routeGroupOf("/api/v1/inventory/moves")).toBe("inventory");
    expect(routeGroupOf("/api/v1/items/items")).toBe("inventory");
    expect(routeGroupOf("/api/v1/manufacturing/orders")).toBe("inventory");
    expect(routeGroupOf("/api/v1/sync/push")).toBe("sync");
    expect(routeGroupOf("/api/v1/devices")).toBe("sync");
    expect(routeGroupOf("/api/v1/platform/tenants")).toBe("platform");
    expect(routeGroupOf("/api/v1/reporting/runs")).toBe("platform");
    expect(routeGroupOf("/health/ready")).toBe("platform");
    // Prefix anchoring: /api/v1/salesfulfillment is NOT the sales group.
    expect(routeGroupOf("/api/v1/salesfulfillment/x")).toBe("platform");
  });

  it("buckets status classes", () => {
    expect(statusClassOf(200)).toBe("2xx");
    expect(statusClassOf(302)).toBe("3xx");
    expect(statusClassOf(403)).toBe("4xx");
    expect(statusClassOf(429)).toBe("4xx");
    expect(statusClassOf(500)).toBe("5xx");
    expect(statusClassOf(503)).toBe("5xx");
  });
});

describe("burn math (MONITORING §3 SLOBurn: 2× Sev-2 / 4× Sev-1)", () => {
  it("burn = observed ÷ allowed; the BURN_CAP sentinel covers 100% targets", () => {
    expect(computeBurnRate(0.001, 0.001)).toBe(1);
    expect(computeBurnRate(0.002, 0.001)).toBe(2);
    expect(computeBurnRate(0.004, 0.001)).toBe(4);
    expect(computeBurnRate(0, 0)).toBe(0);
    expect(computeBurnRate(1, 0)).toBe(BURN_CAP);
    expect(burnStateOf(1.99)).toBe("OK");
    expect(burnStateOf(2)).toBe("BURNING_2X");
    expect(burnStateOf(3.9)).toBe("BURNING_2X");
    expect(burnStateOf(4)).toBe("BURNING_4X");
  });
});

/** Drive N synthetic API requests through a fresh registry. */
function seedApi(
  registry: ReturnType<typeof createMetricsRegistry>,
  counts: { group: (typeof ROUTE_GROUPS)[number]; ok: number; err5xx: number },
): void {
  for (let index = 0; index < counts.ok; index += 1) {
    registry.recordApiRequest(counts.group, "2xx", 10);
  }
  for (let index = 0; index < counts.err5xx; index += 1) {
    registry.recordApiRequest(counts.group, "5xx", 10);
  }
}

function sloById(slos: readonly SloEvaluation[], id: SloEvaluation["id"]): SloEvaluation {
  const found = slos.find((slo) => slo.id === id);
  if (found === undefined) {
    throw new Error(`missing SLO evaluation: ${id}`);
  }
  return found;
}

/** Type-guard helpers — narrow the discriminated `detail` union (expect()
 * .toBe() carries no narrowing power of its own). */
function detailOf<
  K extends SloEvaluation["detail"]["kind"],
>(slo: SloEvaluation, kind: K): Extract<SloEvaluation["detail"], { kind: K }> {
  if (slo.detail.kind !== kind) {
    throw new Error(`SLO ${slo.id} detail is ${slo.detail.kind}, expected ${kind}`);
  }
  return slo.detail as Extract<SloEvaluation["detail"], { kind: K }>;
}

describe("seeded SLO burn (the gate item: SLOBurn fires on seeded burn)", () => {
  it("a fresh registry evaluates NO_DATA everywhere and NEVER alerts (no green-by-silence)", () => {
    const registry = createMetricsRegistry();
    const slos = evaluateSlos(registry.snapshot());
    expect(slos).toHaveLength(6);
    for (const slo of slos) {
      expect(slo.state, slo.id).toBe("NO_DATA");
      expect(slo.observed, slo.id).toBeNull();
      expect(slo.burnRate, slo.id).toBeNull();
      expect(slo.budgetRemaining, slo.id).toBeNull();
    }
    // The backup leg carries the honest external-cadence marker.
    const backup = sloById(slos, "backup_restore_smoke");
    expect(backup.detail.kind).toBe("backup_restore_smoke");
    expect(detailOf(backup, "backup_restore_smoke").noDataReason).toContain(
      "no data (external cadence)",
    );
    expect(evaluateSloBurnAlerts(slos)).toEqual([]);
  });

  it("seeded 5xx at 4× the availability budget fires SLOBurn Sev-1", () => {
    const registry = createMetricsRegistry();
    // 0.4% 5xx against the 0.1% allowed budget = exactly 4× burn.
    seedApi(registry, { group: "sales", ok: 996, err5xx: 4 });
    const slos = evaluateSlos(registry.snapshot());
    const availability = sloById(slos, "api_availability");
    expect(availability.state).toBe("BURNING_4X");
    expect(availability.burnRate).toBe(4);
    expect(availability.observed).toContain("99.600% non-5xx");
    const alerts = evaluateSloBurnAlerts(slos);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      name: "SLOBurn",
      severity: "sev-1",
      slo: "api_availability",
      runbook: "docs/operations/MONITORING.md §5 + docs/operations/TROUBLESHOOTING.md §api",
    });
  });

  it("seeded 5xx at 2× (not 4×) fires SLOBurn Sev-2 only", () => {
    const registry = createMetricsRegistry();
    seedApi(registry, { group: "accounting", ok: 998, err5xx: 2 });
    const slos = evaluateSlos(registry.snapshot());
    const availability = sloById(slos, "api_availability");
    expect(availability.state).toBe("BURNING_2X");
    expect(availability.burnRate).toBe(2);
    const alerts = evaluateSloBurnAlerts(slos);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("sev-2");
  });

  it("a healthy seeded window is OK with no alerts; exact-budget burn (1×) holds OK but reports zero budget remaining", () => {
    const registry = createMetricsRegistry();
    seedApi(registry, { group: "sales", ok: 999, err5xx: 1 });
    const slos = evaluateSlos(registry.snapshot());
    const availability = sloById(slos, "api_availability");
    expect(availability.state).toBe("OK");
    expect(availability.burnRate).toBe(1);
    // 0.1% observed = the whole monthly budget spent (freeze-policy signal),
    // yet the page threshold (2×) has not been crossed — no alert.
    expect(availability.budgetRemaining).toBeLessThanOrEqual(0);
    expect(evaluateSloBurnAlerts(slos)).toEqual([]);
  });

  it("4xx business rejections never burn the availability budget (NFR-007/T-07)", () => {
    const registry = createMetricsRegistry();
    for (let index = 0; index < 100; index += 1) {
      registry.recordApiRequest("sales", "4xx", 10);
    }
    const availability = sloById(evaluateSlos(registry.snapshot()), "api_availability");
    expect(availability.state).toBe("OK");
    expect(availability.burnRate).toBe(0);
  });
});

describe("the latency SLO (per route group, NFR-006 budgets)", () => {
  it("seeded over-budget fraction at 2× the allowed 5% fires per-group burn", () => {
    const registry = createMetricsRegistry();
    // sales budget is 500 ms: 10% of requests over budget = 2× the allowed
    // 5% (p95 within budget ⟺ ≤5% over budget).
    for (let index = 0; index < 90; index += 1) {
      registry.recordApiRequest("sales", "2xx", 10);
    }
    for (let index = 0; index < 10; index += 1) {
      registry.recordApiRequest("sales", "2xx", 501);
    }
    const latency = sloById(evaluateSlos(registry.snapshot()), "api_latency");
    expect(latency.state).toBe("BURNING_2X");
    expect(latency.detail.kind).toBe("api_latency");
    const sales = detailOf(latency, "api_latency").groups.find(
      (row: { group: string }) => row.group === "sales",
    );
    expect(sales?.overBudgetFraction).toBeCloseTo(0.1, 10);
    expect(sales?.budgetMs).toBe(500);
    expect(sales?.stats.p95).toBe(501);
    const alerts = evaluateSloBurnAlerts([latency]);
    expect(alerts[0]).toMatchObject({ name: "SLOBurn", severity: "sev-2", slo: "api_latency" });
  });

  it("the sync group carries the T-05 3 s budget; identity the T-06 1.5 s budget", () => {
    const registry = createMetricsRegistry();
    registry.recordApiRequest("sync", "2xx", 2900);
    registry.recordApiRequest("identity", "2xx", 1400);
    const latency = sloById(evaluateSlos(registry.snapshot()), "api_latency");
    expect(
      detailOf(latency, "api_latency").groups.find(
        (row: { group: string }) => row.group === "sync",
      )?.budgetMs,
    ).toBe(3000);
    expect(
      detailOf(latency, "api_latency").groups.find(
        (row: { group: string }) => row.group === "identity",
      )?.budgetMs,
    ).toBe(1500);
    expect(latency.state).toBe("OK");
  });
});

describe("the posting SLO (≥ 99.99% + ZERO invariant failures)", () => {
  it("healthy postings are OK; the duration sampler carries the engine path", () => {
    const registry = createMetricsRegistry();
    registry.recordPostingAttempt();
    registry.recordPostingSuccess(120);
    const posting = sloById(evaluateSlos(registry.snapshot()), "posting_success");
    expect(posting.state).toBe("OK");
    expect(posting.burnRate).toBe(0);
    expect(posting.detail.kind).toBe("posting_success");
    if (posting.detail.kind === "posting_success") {
      expect(posting.detail.invariantFailures).toBe(0);
      expect(posting.detail.latency.n).toBe(1);
    }
  });

  it("a seeded invariant failure fires PostingInvariantFail Sev-1 regardless of the success rate", () => {
    const registry = createMetricsRegistry();
    for (let index = 0; index < 100_000; index += 1) {
      registry.recordPostingAttempt();
      registry.recordPostingSuccess(5);
    }
    registry.recordPostingAttempt();
    registry.recordPostingFailure("ENTRY_NOT_BALANCED", true);
    const posting = sloById(evaluateSlos(registry.snapshot()), "posting_success");
    // 99.999% success — far above target — but zero tolerance wins:
    expect(posting.state).toBe("BURNING_4X");
    const alerts = evaluateSloBurnAlerts([posting]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      name: "PostingInvariantFail",
      severity: "sev-1",
      runbook: "docs/operations/TROUBLESHOOTING.md §api",
    });
  });

  it("seeded posting failures past 0.01% burn the budget (2× at 0.02%)", () => {
    const registry = createMetricsRegistry();
    for (let index = 0; index < 9_998; index += 1) {
      registry.recordPostingAttempt();
      registry.recordPostingSuccess(5);
    }
    for (let index = 0; index < 2; index += 1) {
      registry.recordPostingAttempt();
      registry.recordPostingFailure("PERIOD_LOCKED", false);
    }
    const posting = sloById(evaluateSlos(registry.snapshot()), "posting_success");
    expect(posting.state).toBe("BURNING_2X");
    expect(posting.burnRate).toBeCloseTo(2, 5);
    if (posting.detail.kind === "posting_success") {
      expect(posting.detail.failuresByCode).toEqual([{ code: "PERIOD_LOCKED", value: 2 }]);
    }
  });
});

describe("the backup + restore-smoke SLO (100% of scheduled runs)", () => {
  it("stays honestly NO_DATA with no in-process producer (the seam exists, the cadence is external)", () => {
    const registry = createMetricsRegistry();
    const backup = sloById(evaluateSlos(registry.snapshot()), "backup_restore_smoke");
    expect(backup.state).toBe("NO_DATA");
  });

  it("a seeded smoke failure is BURNING (single Sev-2 class; repeated Sev-1 class)", () => {
    const registry = createMetricsRegistry();
    registry.recordRestoreSmokeOutcome(true);
    registry.recordRestoreSmokeOutcome(false);
    let backup = sloById(evaluateSlos(registry.snapshot()), "backup_restore_smoke");
    expect(backup.state).toBe("BURNING_2X");
    expect(backup.burnRate).toBe(BURN_CAP);
    expect(backup.budgetRemaining).toBe(-1);

    const repeated = createMetricsRegistry();
    repeated.recordRestoreSmokeOutcome(true);
    repeated.recordRestoreSmokeOutcome(false);
    repeated.recordRestoreSmokeOutcome(false);
    backup = sloById(evaluateSlos(repeated.snapshot()), "backup_restore_smoke");
    expect(backup.state).toBe("BURNING_4X");
    expect(evaluateSloBurnAlerts([backup])[0]).toMatchObject({ severity: "sev-1" });
  });
});

describe("the sync push SLO (≥ 99.5% within 24 h)", () => {
  it("seeded rejection rate past 0.5% burns (4× at 2%)", () => {
    const registry = createMetricsRegistry();
    // 98 terminal outcomes, 2 rejected = 2.04% failure = ~4× the 0.5% budget.
    registry.recordSyncPushOutcomes({ accepted: 96, rejected: 2, deferred: 50 });
    const sync = sloById(evaluateSlos(registry.snapshot()), "sync_push_success");
    expect(sync.state).toBe("BURNING_4X");
    expect(sync.burnRate).toBeGreaterThan(4);
    if (sync.detail.kind === "sync_push_success") {
      // DEFERRED is backpressure: excluded from the SLI, reported separately.
      expect(sync.detail.attempts).toBe(98);
      expect(sync.detail.deferred).toBe(50);
    }
  });

  it("healthy pushes are OK", () => {
    const registry = createMetricsRegistry();
    registry.recordSyncPushOutcomes({ accepted: 995, rejected: 5, deferred: 0 });
    const sync = sloById(evaluateSlos(registry.snapshot()), "sync_push_success");
    expect(sync.state).toBe("OK");
  });
});

describe("the report render SLO (per tier class, T-04 budgets)", () => {
  it("seeded over-budget inline renders burn; per-template percentiles are carried", () => {
    const registry = createMetricsRegistry();
    // inline budget 2000 ms: 10 of 100 renders at 2500 ms = 10% over = 2×.
    for (let index = 0; index < 90; index += 1) {
      registry.recordReportRender({
        executionClass: "inline",
        template: "sales.daily-summary",
        durationMs: 500,
        ok: true,
      });
    }
    for (let index = 0; index < 10; index += 1) {
      registry.recordReportRender({
        executionClass: "inline",
        template: "sales.daily-summary",
        durationMs: 2500,
        ok: true,
      });
    }
    registry.recordReportRender({
      executionClass: "job",
      template: "financial.fiscal-close-pack",
      durationMs: 1000,
      ok: true,
    });
    const report = sloById(evaluateSlos(registry.snapshot()), "report_render_sla");
    expect(report.state).toBe("BURNING_2X");
    if (report.detail.kind === "report_render_sla") {
      const inline = report.detail.classes.find((row) => row.executionClass === "inline");
      expect(inline?.budgetMs).toBe(2000);
      expect(inline?.attempts).toBe(100);
      expect(inline?.overBudget).toBe(10);
      const job = report.detail.classes.find((row) => row.executionClass === "job");
      expect(job?.budgetMs).toBe(900_000);
      expect(job?.state).toBe("OK");
      const template = report.detail.templates.find((row) => row.template === "sales.daily-summary");
      expect(template?.stats.p95).toBe(2500);
    }
  });

  it("failed renders count against the SLI (not within-budget renders)", () => {
    const registry = createMetricsRegistry();
    registry.recordReportRender({ executionClass: "inline", template: "t", durationMs: 100, ok: true });
    registry.recordReportRender({ executionClass: "inline", template: "t", durationMs: 100, ok: false });
    const report = sloById(evaluateSlos(registry.snapshot()), "report_render_sla");
    // 1 success + 1 failure = 50% not-within-budget = 10× the allowed 5%.
    expect(report.state).toBe("BURNING_4X");
  });
});

describe("the endpoint snapshot (GET /api/v1/platform/slo shape)", () => {
  it("carries the honest window + substrate markers", () => {
    const registry = createMetricsRegistry();
    seedApi(registry, { group: "platform", ok: 5, err5xx: 0 });
    const snapshot = sloSnapshot(registry);
    expect(snapshot.substrate).toBe("in-process (SF-024-021)");
    expect(snapshot.window.kind).toBe("process-lifetime");
    expect(new Date(snapshot.window.startedAt).getTime()).toBeGreaterThan(0);
    expect(snapshot.slos).toHaveLength(6);
    expect(Array.isArray(snapshot.burnAlerts)).toBe(true);
    // JSON-serializable (the endpoint payload must survive a response).
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    const roundTrip = JSON.parse(JSON.stringify(snapshot)) as {
      metrics: MetricsSnapshot;
      slos: SloEvaluation[];
    };
    expect(roundTrip.slos).toHaveLength(6);
    expect(roundTrip.metrics.api.requestsByGroup.platform).toBe(5);
  });

  it("the process singleton is a live registry (the middleware writes into it)", () => {
    // The shared substrate: recording through the singleton is visible to
    // the SLO snapshot (the endpoint's data path, end to end).
    const before = processMetrics.snapshot().api.requestsByGroup.platform;
    processMetrics.recordApiRequest("platform", "2xx", 5);
    expect(processMetrics.snapshot().api.requestsByGroup.platform).toBe(before + 1);
    expect(typeof processMetrics.snapshot().generatedAt).toBe("string");
  });
});
