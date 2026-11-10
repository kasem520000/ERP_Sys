# Observability

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-27

## Principles

1. Tenant-aware by default, privacy-safe by construction: every log line carries
   `tenant_id` + `correlation_id`; no PII, no secrets, no full document payloads.
2. Health, logs, metrics, and traces are wired from PHASE-001 onward — observability is
   a phase exit criterion, not a GA-afterthought (directive §16).
3. Alerts point to runbooks ([../operations/TROUBLESHOOTING.md](../operations/TROUBLESHOOTING.md)).

## Structured logging

- Library: `pino` (API + workers + web). JSON to stdout; sinks collect per environment.
- Mandatory fields: `ts`, `level`, `correlation_id`, `tenant_id` (when in tenant scope),
   `module`, `action`, `duration_ms` (where relevant), `error.code` (never raw stack in
   prod-logged user requests; stacks go to the error tracker).
- Request correlation: BFF/API generates `correlation_id` (or accepts incoming
   `X-Request-Id` validated as UUID); propagated to jobs via job payload; returned in
   responses and error envelopes ([../api/ERROR_MODEL.md](../api/ERROR_MODEL.md)) — so
   users can quote an id to support.
- Redaction: a centralized serializer allow-lists fields; unknown objects are serialized
   with keys only (`[REDACTED-OBJECT]`) — fail-closed against accidental PII.

## Health & readiness

- `GET /health/live` (process up) and `GET /health/ready` (DB round-trip + migration
   state + job queue liveness) — used by LB and deploy gates.
- Worker heartbeat row; stale heartbeat pages on-call.

## Metrics (initial set)

| Area | Metrics |
|------|---------|
| HTTP | request count/latency by route, status; p95/p99 vs NFR-006 |
| Domain | documents posted/min by type, posting failures by invariant, sync push success/latency |
| Jobs | queue depth, attempts, dead-letter count per category |
| DB | connection pool saturation, slow queries (>250ms), cache hit ratio |
| Business SLO | failed logins spike, tenant suspension events, RLS denial counts (should be 0 in normal traffic — anything > 0 is investigated) |

Collection: Prometheus-style exporter endpoint initially; vendor-agnostic metric naming
(`erp_<module>_<name>_<unit>`).

## Error tracking & alerting

- Sentry (or equivalent) with tenant tag (id only) + correlation id; source maps
  uploaded in CI.
- Alert routing: SLO burn alerts, dead-letter growth, RLS denials, backup job failure,
   migration failure, certificate-expiry (TLS + e-invoicing certs —
   [../localization/E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md)).

## Tracing

- OpenTelemetry SDK wired from PHASE-002 (auto-instrumentation HTTP + pg); export
  enabled when a backend is chosen (budget decision post-MVP). Spans: request → module
  service → posting engine → SQL. The instrumentation contract is stable even if export
  is deferred.

## Audit vs telemetry

Audit events (`audit_events` table) are a **domain record**, not logs: immutable,
transactional, queryable by tenants/admins with permissions. Logs are operational and
ephemeral (retention 30d hot / 1y cold). Never rely on logs for financial audit.

## Dashboards & runbooks (built per phase)

- Phase adds dashboard: e.g., PHASE-007 adds "posting health" (invariant failures by
  rule), PHASE-020 adds "sync health" (push/pull success, conflicts by type).
- Every alert links a runbook section; runbooks live in [../operations/](../operations/MONITORING.md).
