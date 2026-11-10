# DR-003 — Observability Vendors: Error Tracking & Log Sink

> **Status:** OPEN · **Owner:** Platform Operations · **Updated:** 2026-10-27 ·
> **Date:** 2026-10-27 (opened) · **Approver:** Architecture Owner
> (budget: Product Owner) · **Related:**
> [../../architecture/OBSERVABILITY.md](../../architecture/OBSERVABILITY.md),
> [../../operations/MONITORING.md](../../operations/MONITORING.md), PHASE-001/002 wiring,
> tracing export = post-MVP budget decision

## Context

The observability **contracts** are already fixed by
[../../architecture/OBSERVABILITY.md](../../architecture/OBSERVABILITY.md): pino JSON to
stdout, tenant + correlation fields with fail-closed redaction, vendor-agnostic metric
names, OTel SDK wired from PHASE-002 with export deferred, health endpoints, and
"Sentry (or equivalent)" for error tracking with tenant tag + correlation id. Two
procurement decisions remain open and block only *sink provisioning*, not any phase:

1. **Error tracking**: which SaaS (or self-hosted equivalent) receives errors + source
   maps.
2. **Log sink**: which collector/storage serves the 30-day hot / 1-year cold retention
   ([../../operations/MONITORING.md](../../operations/MONITORING.md) §6) for staging and
   production.

Constraints: staging and production must have **parity** (same vendor, same schemas —
staging is where alert tuning happens); cost must be estimable from the NFR-006 traffic
budgets; data residency posture must be acceptable for MENA operations (logs are
tenant-attributed ids, no PII by construction, but residence still matters to some
buyers); worker (Chromium) and API both ship pino logs from the same image.

## Options — error tracking

| Option | Pros | Cons |
|--------|------|------|
| **A. Sentry SaaS** | Zero ops; best-in-class source maps, alerting, tracing-adjacent features; matches the blueprint's "Sentry-ready" design | Data leaves region (residency objection possible); per-event pricing needs volume estimates |
| **B. Self-hosted Sentry (or compatible OSS)** | Residency controlled; fixed infra cost | Real operational burden — a monitoring outage of the monitoring system; worker host sizing |
| **C. Lightweight OSS alternative** (e.g., a minimal error collector) | Cheapest | Loses source-map UX + release tagging the runbooks assume; re-training cost |

## Options — log sink

| Option | Pros | Cons |
|--------|------|------|
| **A. Managed Loki/Elastic-style service** on the same cloud as the app | Low ops; retention controls map cleanly to 30d/1y; query UX for on-call | Cost at volume; vendor-specific query syntax (kept inside dashboards, not app code) |
| **B. Self-hosted Loki/Elastic on the worker-adjacent nodes** | Cost predictable; residency native | Index/storage ops + disk capacity is a new failure domain for on-call |
| **C. Cloud-native observability suite (logs+metrics+traces bundled)** | One pane of glass; simplest billing | Deepest lock-in; contract-breaking pressure risk (standing rule in folder README); often region-limited |

## Recommendation

- **Error tracking: Option A (Sentry SaaS)** for MVP and GA unless a design-partner or
  legal review objects to the data path — the blueprint is Sentry-ready, so this is a
  provisioning task, not an integration project. Record residency objection → fall back
  to B with a documented ops cost.
- **Log sink: Option A (managed service on the app cloud)** — staging/prod parity, and
  hot/cold retention is configuration. Option C is explicitly discouraged while the
  Prometheus-style exporter contract holds.
- **Tracing export**: remains deferred (post-MVP budget decision per OBSERVABILITY §5);
  when revisited, treat as an amendment to this record — the OTel SDK is already wired.

## Consequences

- Chosen vendors consume the fixed contracts; swapping later touches deployment
  configuration and dashboards, not application code (the standing rule).
- Alert catalog ([../../operations/MONITORING.md](../../operations/MONITORING.md) §3) is
  implemented against the chosen vendors at staging bring-up; every alert keeps its
  runbook link regardless of vendor.
- Cost reviews quarterly at phase boundaries using actual event/log volumes; > 30%
  deviation from estimate reopens this record.

## Approval requirements

- Architecture owner signature (contracts remain vendor-agnostic — verify no SDK lock-in
  beyond the error/log clients).
- Product owner acknowledgment of monthly cost estimate + residency posture.
- Ops runbook updated ([../../operations/MONITORING.md](../../operations/MONITORING.md))
  with the concrete sink names at provisioning time — this record links the runbook as
  its implementation record.
