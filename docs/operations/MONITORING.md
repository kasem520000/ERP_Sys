# Monitoring

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-06

Operationalization of [../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md):
dashboards, the alert catalog with runbook links, on-call basics, SLO/error-budget
tracking, log retention, and the health-endpoint contract. Principles stay as in the
architecture doc: tenant-aware and privacy-safe logs, alerts that point to runbooks, and
observability wired from PHASE-001/002 as a phase exit criterion.

## 1. Dashboards inventory

| Dashboard | Introduced | Key panels | Purpose / thresholds |
|-----------|------------|-----------|----------------------|
| API golden signals | PHASE-002 | Request rate, error rate by class, p50/p95/p99 per route group, event-loop lag | Compare vs NFR-006 latency budgets; p95 breach pages the alert, doesn't just color |
| Database health | PHASE-002 | Pool saturation, connections by role, slow queries (>250 ms), cache hit ratio, statement timeouts | Slow-query panel feeds [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §database |
| Jobs & dead-letters | PHASE-002 | Queue depth per pg-boss category, attempts, retries, failed/expired (dead-letter) counts, worker heartbeat age | Heartbeat age > 5 min is a page; DLQ growth is ticket-or-page per §3 |
| Posting health | PHASE-007 | Documents posted/min by type, posting engine validation failures by invariant code, reversal rate | Invariant failures are **zero-tolerance** (RISK-009): any occurrence is Sev-1 |
| Backup success | PHASE-002 (config), MVP (drills) | Last dump age, restore-smoke result, PITR window oldest point, WORM config check | Feeds release pre-flight ([DEPLOYMENT.md](DEPLOYMENT.md) §1) and monthly attestation |
| Tenant isolation | PHASE-003 | **RLS denial counter — target 0**, policy-violation errors, cross-tenant 404-vs-403 audit | Any nonzero count is investigated immediately (RISK-010) |
| Sync health | PHASE-020 (**LIVE 2026-11-04**) | Push success/p95 latency (7-day window), pull cursor lag by entity, conflicts by type, rejected pushes by reason code, `outbox.lag` gauge buckets (`never\|lt1h\|lt6h\|lt24h\|lt7d\|gt7d` devices), `device.revoked.pending_ops` (devices, pending commands, owned drafts), tombstone GC ledger size, the alert feed | `GET /api/v1/sync/admin/health` (60 s tenant cache) renders the `/[locale]/platform/sync-health` screen; feeds [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §sync |
| E-invoicing funnel | PHASE-023 (**LIVE 2026-11-05**) | Submissions by state (PENDING→GENERATED→SIGNED→SUBMITTED→ACCEPTED/REJECTED→REPORTED; FAILED = dead-letters), latency p50/p95, rejection reasons by `last_error_code`, the 15-min rejection-rate gauge, dead-letter count, certificate-expiry countdowns (30/14/7 ladder) | `GET /api/v1/tax/einvoicing/funnel` (per-tenant aggregate, `tax.einvoicing.manage`) renders the `/[locale]/platform/einvoicing-funnel` screen; alerts land in the notifications inbox (category `einvoicing`); feeds [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §e-invoicing |
| Client stability | PHASE-021 (**LIVE 2026-11-04** — desktop) / 022 (**LIVE 2026-11-05** — Android) | Crash-free sessions per device class, update-channel distribution (`stagePercent` cohorts), min-version enforcement hits, update adoption | Staged-rollout gates (10%→50%→100%) read from this dashboard |
| Business SLO | PHASE-014+ | Failed-login spike, tenant suspension events, signups/onboarding funnel, entitlement overrides | Suspensions are high-signal: they precede churn or abuse |
| SLO & error budgets | PHASE-025 (**LIVE 2026-11-06**) | The six §5 SLO cards (target, observed, error-budget bar, burn state), route-group p50/p95/p99 vs NFR-006 budgets, report render tiers, the SLOBurn alert feed | `GET /api/v1/platform/slo` (evaluated on demand; `platform.audit.view`) renders the `/[locale]/platform/slo` screen from the in-process metrics registry (SF-024-021 — §5 note); the metrics pipeline evaluates per scrape when the exporter swap lands |

Metric naming is vendor-agnostic (`erp_<module>_<name>_<unit>`); collection starts as a
Prometheus-style exporter endpoint with sink choice per
[../decisions/technical/DR-003-observability-vendors.md](../decisions/technical/DR-003-observability-vendors.md).
The sync gauges ship with PHASE-020 (2026-11-04): `erp_sync_outbox_lag_devices` (the
`outbox.lag` bucket histogram — devices per staleness bucket, from
`devices.last_pull_at`/`last_push_at` watermarks) and
`erp_sync_device_revoked_pending_ops` (revoked devices / pending inbox commands /
owned drafts on the reconciliation queue — the same `reconciliation_dismissed` filter
as the queue screen, so the gauge and the screen agree on "close the queue to zero").
Both are computed by the tenant-scoped health aggregate
(`GET /api/v1/sync/admin/health`, 60 s cache) behind `sync.settings.manage`.

The client-stability telemetry shipped with PHASE-021 (2026-11-04): the desktop client's
crash module (`apps/desktop/src/telemetry/crash.ts`) redacts every event before it leaves
the device (token/key/`Authorization` values and file paths stripped; tenant tag kept;
the no-secrets-in-logs posture is scan-tested) and maintains the `CrashFreeSessions`
rolling counter — the **trailing-24 h crash-free-session rate** is the input the rollout
gates read (`CRASH_FREE_GATES`: promote 10→50 at ≥ 99.5% over ≥ 200 sessions, 50→100 at
≥ 99.7% over ≥ 500, **halt below 98.5%** with the `minVersion` force-update remedy —
DR-P21-05; runbook: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §desktop). With the desktop
client live, the sync-health dashboard's device rows and the devices registry screen now
carry real `tauri-desktop`-class devices alongside POS terminals (per-device sync state,
outbox lag buckets, revocation queue) — the same aggregate, no separate pipeline.

The e-invoicing funnel shipped with PHASE-023 (2026-11-05): the per-tenant aggregate
(`GET /api/v1/tax/einvoicing/funnel`, behind `tax.einvoicing.manage`) computes from
`e_invoicing_submissions` the state funnel, latency p50/p95, rejection reasons, the
dead-letter count, and the 15-minute rejection window that feeds `EInvoiceRejectSpike`
(the `einvoicing.reject.spike` sweep evaluates every 5 min, fires at > 5% with ≥ 5
submissions in the window, deduped per 15-min window per tenant). Certificate countdowns
come from the certificates surface (`GET /api/v1/tax/einvoicing/certificates` — metadata
+ signing volume ONLY, never key material) with the `CertExpiry` ladder evaluated by the
daily `einvoicing.cert.expiry` sweep (each 30/14/7-day threshold fires exactly once —
`e_invoicing_certificates.expires_alerted_at`). All e-invoicing alerts land in the
notifications inbox (category `einvoicing` — reject spike, dead-letter watch, cert
expiry). Honest state: the ZATCA adapter is the `UNVERIFIED` refuse-to-submit stub until
the verification gate passes (DR-001 OPEN), so the funnel shows pipeline health —
exercised end-to-end by the fake-authority harnesses (`tests/authorities/fake-zatca`,
`fake-eta`) driving the real registry + jobs — never real authority acceptance.

## 2. Health endpoint contract (summary)

| Endpoint | Checks | Used by | Failure semantics |
|----------|--------|---------|-------------------|
| `GET /health/live` | Process up; build info | LB liveness, deploy smoke | 200 while the process can serve at all — no dependencies |
| `GET /health/ready` | DB round-trip, migration state, pg-boss queue liveness | LB readiness, deploy gates ([DEPLOYMENT.md](DEPLOYMENT.md) §2), alerting | 503 until all checks pass; partial-failure detail in `checks[]` (never secrets) |
| Worker heartbeat | `WORKER_MODE` process updates a heartbeat row (DB) on a fixed interval | Monitoring | Heartbeat age > 5 min → worker presumed stuck/dead → page |

Responses are JSON with `status`, `correlation_id` (echo of `X-Request-Id` or generated),
and a `checks[]` array (name, ok, latency_ms). Every alert below links a runbook section —
no alert exists without one.

## 3. Alert catalog

| Alert | Condition | Severity | Runbook | Paging policy |
|-------|-----------|----------|---------|---------------|
| `RLSDenial` | Any RLS policy violation observed in traffic (counter > 0) | **Sev-1** | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §tenant-isolation | Page immediately, any hour (RISK-010) |
| `PostingInvariantFail` | Posting engine rejected on invariant breach in production (should never fire — engine-internal bugs) | **Sev-1** | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §api | Page immediately (RISK-009) |
| `BackupJobFailed` | Nightly dump job errored | Sev-2 | [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §9 | Ticket + notify; 2 consecutive → page |
| `RestoreSmokeFailed` | Nightly restore-smoke failed (restore step or invariant step) | Sev-2 (Sev-1 if repeated) | [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §3, §9 | Ticket immediately; page on repeat |
| `WorkerHeartbeatStale` | Heartbeat age > 5 min | Sev-2 (Sev-1 if queue depth also rising) | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §jobs | Page after 10 min unexplained |
| `DeadLetterGrowth` | Failed/expired jobs +N (>10) in 15 min in any category | Sev-2 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §jobs | Ticket; page if growth continues |
| `Api5xxSpike` | 5xx rate > 2% for 5 min | Sev-2 (Sev-1 > 10%) | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §api | Page for Sev-1; ticket Sev-2 |
| `ApiP95Breach` | p95 > NFR-006 budget for 10 min | Sev-3 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §api | Ticket |
| `PoolSaturation` | DB pool wait/queue metrics above threshold 10 min | Sev-2 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §api | Ticket; page if errors result |
| `SlowQueryRate` | >10 queries > 250 ms per minute, 10 min sustained | Sev-3 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §database | Ticket |
| `MigrationFailed` | Deploy migration job non-zero exit | **Sev-1** | [DEPLOYMENT.md](DEPLOYMENT.md) §3 (abort criteria) | Page deploy on-call — deploy is aborted |
| `SLOBurn` | Error-budget burn 2× (Sev-2) / 4× (Sev-1) (PHASE-025; **live 2026-11-06** — the in-process evaluator computes burn = observed ÷ allowed error rate per §5 SLO and surfaces the fired alerts at `GET /api/v1/platform/slo`; the metrics pipeline evaluates per scrape) | Sev-2/1 | §5 + [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §api | Page per severity |
| `CertExpiry` | TLS or e-invoicing certificate < 30 days (Sev-3) / < 7 days (Sev-2); the e-invoicing leg is **live 2026-11-05** — the daily `einvoicing.cert.expiry` sweep walks ACTIVE/EXPIRING_SOON certificates and fires each 30/14/7-day threshold exactly once (`e_invoicing_certificates.expires_alerted_at` per-threshold dedupe; critical inbox severity at 7 days) | Sev-3→Sev-2 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §e-invoicing | Ticket → page under 7 days |
| `EInvoiceRejectSpike` | Rejection rate > 5% of submissions in 15 min (PHASE-023; **live 2026-11-05** — the `einvoicing.reject.spike` sweep evaluates every 5 min from the funnel aggregate, fires at > 5% with ≥ 5 submissions in the 15-min window, deduped per window per tenant) | Sev-2 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §e-invoicing | Ticket; page if tenant-wide outage |
| `SyncPushFailSpike` | Push failure > 5% in 15 min (PHASE-020+; **live 2026-11-04** — the in-product health aggregate fires it at successRate < 90% with ≥ 20 commands over the 7-day window; the metrics pipeline refines to the 15-minute threshold) | Sev-2 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §sync | Ticket |
| `SyncCursorStall` | Any entity cursor lag > threshold (e.g., 15 min of change_log ahead; **live 2026-11-04** — the in-product health aggregate + the daily `sync.cursor.compact` lag audit fire at > 7-day `now() − acknowledged_at`, with deduped owner notifications) | Sev-3 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §sync | Ticket |
| `ClientCrashRate` | Crash-free sessions below staged-rollout gate (PHASE-021+; **live 2026-11-04** — the trailing-24 h rate from the desktop telemetry feeds the gates; from PHASE-022 the Android channel reads the same gate table — halt below 98.5% publishes the `minVersion` force-update at any sample size) | Sev-2 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §desktop / §android | Ticket; rollout halt is automatic per gates |
| `StorageGrowth` | DB storage > 80% of provisioned | Sev-3 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §database | Ticket; capacity review |
| `ReplicationLag` | Replica lag > 30 s (when read replica exists) | Sev-3 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §database | Ticket |

## 4. On-call rotation (basics)

- **Primary + secondary**, weekly shifts, documented handoff note (open incidents, watch
  items, pending drills). Handoff overlaps 30 minutes.
- **Paging policy**: Sev-1 pages primary immediately, secondary after 10 min unanswered;
  Sev-2 pages within business hours, ticket otherwise; Sev-3 is ticket-only.
- **Escalation**: engineering lead after 30 min on an active Sev-1; product owner joins
  when tenant comms or data-loss decisions arise ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §2);
  incident command per [../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md).
- Every page requires an acknowledgment + a runbook link click-through in the incident
  channel — the alert catalog makes "what do I do" one click away.
- Quarterly: the on-call pair runs the cold backup drill
  ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §4) — on-call readiness and DR
  readiness are the same muscle.

## 5. SLOs & error budgets

SLOs went live at GA (PHASE-025 — "error budget process live",
[../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md)); from MVP the same
metrics were tracked as budgets-without-teeth so targets had history before they gate.

The six SLOs below are **finalized (PHASE-025, 2026-11-06)** — measured by the
in-process registry (SF-024-021 substrate: `apps/api/src/infra/observability/metrics.ts`,
names `erp_<module>_<name>_<unit>`; the OTel exporter swap picks them up unchanged) and
evaluated on demand at `GET /api/v1/platform/slo` + the `/[locale]/platform/slo` screen.
Honest window semantics: the in-process window is the **process lifetime** (restarts
reset counters — no persistence by design); the 30-day error-budget window is the
metrics pipeline's concern and is never fabricated. An SLO without samples reports
**NO_DATA — never green by silence** (the backup leg lives there until the pipeline
lands: the nightly restore-smoke runs out-of-process; only the
`recordRestoreSmokeOutcome` seam exists).

| SLO (finalized PHASE-025) | Target | Measurement (wiring point) | Error budget consequence |
|------------------------------------------|--------|----------------------------|--------------------------|
| API availability | 99.9% monthly (non-5xx; 4xx business rejections excluded per NFR-007/T-07) | `erp_api_requests_total`/`erp_api_errors_total{class}` from the request metrics middleware (all routes, 8 route groups) | Budget exhausted → feature releases pause; fixes only |
| API latency p95 | Within NFR-006/T budgets per route group (identity 1.5 s T-06; document-plane groups 500 ms T-01; sync 3 s T-05; platform/reporting 2 s T-04) — p95 within budget ⟺ ≤ 5% of requests over budget | `erp_api_request_over_budget_total{route_group}` + `erp_api_request_duration_ms` sampler (the same middleware) | Burn 4× → page + capacity review |
| Posting success | ≥ 99.99% of engine attempts; **zero** invariant failures (`ENTRY_NOT_BALANCED` — INV-001/002; any occurrence is Sev-1 regardless of budget, `PostingInvariantFail`) | `erp_posting_attempts_total`/`erp_posting_success_total`/`erp_posting_invariant_failures_total` + the `erp_posting_duration_ms` sampler, wrapped around `PostingService.post()/reverse()` (the single engine choke point; idempotent replays count as successes) | Any invariant failure is Sev-1 regardless of budget |
| Backup + restore-smoke | 100% of scheduled runs (a single miss exhausts the budget; repeated = Sev-1 per the `RestoreSmokeFailed` row) | `erp_backups_restore_smoke_attempts_total`/`erp_backups_restore_smoke_success_total` — **NO_DATA today** (external cadence: the nightly smoke + drills run out-of-process; the seam feeds this SLO when the pipeline lands) | Missed smoke blocks next release pre-flight |
| Sync push success (PHASE-020+) | ≥ 99.5% within 24 h (terminal outcomes: ACCEPTED/(ACCEPTED+REJECTED); DEFERRED is backpressure, excluded — the health aggregate's definition) | `erp_sync_push_attempts_total`/`erp_sync_push_success_total` recorded at the sync push service's batch completion (in-process window: process lifetime) | Budget burn halts staged client rollouts |
| Report render SLA (PHASE-013) | p95 within the T-04 tier budget per report class (interactive/inline 2 s; worker/job tier 15 min) — ≤ 5% of renders over budget | `erp_reporting_render_attempts_total`/`erp_reporting_render_over_budget_total{class}` + the per-template `erp_reporting_render_duration_ms` sampler, at the run service's completion point (both execution classes; cache hits excluded) | Sustained breach → worker capacity action |

Burn-rate math: burn = observed error rate ÷ allowed error rate over the window;
≥ 2× pages Sev-2, ≥ 4× pages Sev-1 (the `SLOBurn` row above, live). The evaluator
(`apps/api/src/infra/observability/slo.ts`) is exercised by the seeded-burn unit spec
(`slo.burn.spec.ts`) — 2× and 4× seeded rates fire the right severities; NO_DATA never
alerts and never shows green. Burn alerts (2×/4×) are wired per §3; the error-budget
policy (freeze feature deploys when a budget is exhausted) follows
[../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) and is recorded in
the GA release checklist.

## 6. Log retention & what logs are *not*

- Retention: **30 days hot** (queryable) / **1 year cold** (archived, slower, for incident
  and audit-adjacent searches). Retention is a sink configuration, verified at
  attestation time.
- Logs are operational telemetry: they never substitute for `audit_events`, which are the
  domain-level, immutable, tenant-queryable record
  ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md) §Audit vs telemetry).
  Financial audit questions are answered from the database, never from log search.
- PII policy: `tenant_id` + `correlation_id` in every line; no payloads, no secrets; the
  redaction serializer fail-closes unknown objects. Quoting a `correlation_id` to support
  must be enough to find the request trail.
