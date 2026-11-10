# DR-P25-06 — OTel Observability Exporter Swap (SF-024-021 resolution)

> **Status:** PROPOSED (post-GA decision slot — PHASE-025 T14; SF-024-021's resolution
> record) · **Date:** 2026-11-06 (opened) · **Approver:** Architecture Owner (the
> vendor/infra dimension per this folder's rules; product owner consulted on budget) ·
> **Source:** [SF-024-021](../../operations/security-findings.md) (the in-process
> metrics substrate finding) + the PHASE-025 T9 SLO substrate handoff · **Related:**
> [MONITORING.md](../../operations/MONITORING.md) §1/§3/§5 (the dashboards, alerts, and
> SLOs the pipeline completes),
> [OBSERVABILITY.md](../../architecture/OBSERVABILITY.md) (the vendor-agnostic
> contracts), [DR-003-observability-vendors.md](DR-003-observability-vendors.md) (OPEN —
> the vendor decision this swap executes), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)
> trigger pattern (the same infra-provisioning dependency class),
> [GA-RELEASE-CHECKLIST.md](../../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
> criterion 6

## Context

The metrics substrate is deliberately **in-process**: `apps/api/src/infra/observability/metrics.ts`
(counters + latency samplers, `erp_<module>_<name>_<unit>` naming),
`metrics.middleware.ts` (request rate/error rate by class + p95 per route group — the
golden-signals source), and `slo.ts` (the §5 six-SLO evaluator + burn 2×/4× +
`SLOBurn` surfacing at `GET /api/v1/platform/slo`). SF-024-021 records the honest gap:
`erp_rls_denials_total` (and now the whole metric family) lives in-process + logs —
**the OTel providers are the documented no-op** — so a metrics-pipeline consumer needs
the exporter swap. The PHASE-025 handoff is exact: **the names are live; the pipeline
picks them up unchanged.** What the swap unlocks: pipeline-evaluated 30-day
error-budget windows (the in-process window is honestly process-lifetime — restarts
reset counters, no persistence by design), populated §1 dashboards, and the backup-SLO
leg that today reports **NO_DATA** (the nightly restore-smoke runs out-of-process;
only the `recordRestoreSmokeOutcome` seam exists).

## Options (sketch)

| Option | Shape | Consequences |
|--------|-------|--------------|
| **A. OTLP export to the DR-003-chosen vendor** | Configure the real OTel exporters against the selected backend | The documented path (OBSERVABILITY contracts end here); closes DR-003's metric leg together with this record |
| **B. Prometheus-style scrape endpoint** | Expose the registry on a scrape endpoint; the platform's collector pulls | Keeps the app push-free; adds an exposition surface (auth/networking policy needed); vendor-neutral |
| **C. Keep in-process + logs only (status quo)** | No pipeline | Rejected as an end state: the §5 SLO windows and §1 dashboards remain unpopulated and the backup SLO stays NO_DATA — MONITORING §5 already records this honestly |

## Recommendation (lean)

**A** — the OTLP export per the OBSERVABILITY contracts, decided **together with**
[DR-003-observability-vendors.md](DR-003-observability-vendors.md) (the vendor is the
open input; the metric names/units/log fields are already vendor-agnostic by
architecture, so the swap itself is configuration, not code churn — that is the point
of the substrate).

## Decision

**NOT YET MADE — this record is the owning slot.** What is already true (no decision
needed): the metric family, the evaluator, the alerts wiring, and the platform SLO
screen are live; NO_DATA never shows green; the swap changes where metrics are
consumed, not what is measured.

## Consequences

- Until decided: the in-process window semantics govern (MONITORING §5's honest note);
  dashboards evaluate on demand at the platform screen; the backup SLO leg stays
  NO_DATA — never silently green.
- When decided + provisioned: pipeline-evaluated 30-day windows, populated §1 panels,
  the backup SLO fed via the `recordRestoreSmokeOutcome` seam, SF-024-021 closes in
  the findings log, and MONITORING §5's window-semantics note updates.
- **Trigger:** staging/hosted infrastructure provisioning (the same event that closes
  DR-003 — "at staging provisioning" per its deadline). **Owner:** platform
  operations (drives) + architecture owner (approves).

## Approval requirements

- Architecture-owner approval with the DR-003 vendor decision attached (or in the same
  change); the record must state cost-at-scale, data-residency posture, and the
  contracts-stay-vendor-agnostic confirmation (this folder's standing rule).
