# Technical (Operational) Decision Records

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-06

Operational-technical decisions: **vendor and tooling choices that do not change the
system's architecture** — which error-tracking SaaS, which log sink, which managed-scan
policy. Anything that *does* shape architecture (frameworks, data representation,
tenancy model, job backbone) is decided as an **ADR** in
[../../architecture/ADR/](../../architecture/ADR/) — when in doubt, it's an ADR.

## Index

| Record | Title | Status | Deadline |
|--------|-------|--------|----------|
| [DR-003-observability-vendors.md](DR-003-observability-vendors.md) | Observability vendors: error tracking + log sink | OPEN | Error tracking before staging provisioning (pre-MVP); log sink at staging provisioning; tracing export post-MVP |
| [DR-P25-06-observability-exporter.md](DR-P25-06-observability-exporter.md) | OTel exporter swap — the metrics pipeline picks up the in-process registry (SF-024-021) | **PROPOSED** (post-GA slot) | Together with DR-003 at staging provisioning |
| [DR-P25-07-report-quota.md](DR-P25-07-report-quota.md) | Per-tenant report-run quota (the MULTI_TENANCY §5 fairness mechanism PERF-A surfaced at GA) | **PROPOSED** (post-GA slot) | First report-run noisy-neighbor incident, first hosting scale-out step, or the post-GA review closing the §5 gap proactively |

The `DR-P25-NN` rows are **post-GA pointer stubs** (PHASE-025 T14): filed owning slots
for GA-deliberately-open items — context + options + trigger + owner recorded; not
decisions yet (see [../README.md](../README.md) §2).

## Process (differences from the parent process)

- Proposer: operations lead or any engineer via PR.
- Approver: **architecture owner** (cost/data-residency implications) with the product
  owner consulted on budget.
- Every record must state: monthly cost at MVP-scale estimates, data-residency posture
  (log/metric data is tenant-attributed but PII-free —
  [../../architecture/OBSERVABILITY.md](../../architecture/OBSERVABILITY.md) §principles),
  lock-in/exit cost, and how the observability **contracts** (metric naming, log fields,
  health endpoints) stay vendor-agnostic so the vendor can be swapped without code churn.
- Rejected vendors are recorded as REJECTED with the reason — re-proposing the same vendor
  requires new evidence (pricing change, new residency region, feature parity).

## Standing rule

The vendor-agnostic contracts in [../../architecture/OBSERVABILITY.md](../../architecture/OBSERVABILITY.md)
(pino JSON stdout, `erp_<module>_<name>_<unit>` metrics, OTel instrumentation, health
endpoint shapes) are **fixed by architecture**; decisions in this folder only choose who
consumes them. A vendor capability that would require breaking those contracts is
architecture work → ADR, not a DR.

## Records expected here (open the record when the trigger fires)

| Trigger | Record to open |
|---------|-----------------|
| Staging provisioning approaches (pre-MVP) | Close DR-003 (error tracking + log sink) — [../../operations/ENVIRONMENT_CONFIGURATION.md](../../operations/ENVIRONMENT_CONFIGURATION.md) §1 depends on it |
| Post-MVP tracing backend decision (OBSERVABILITY §5) | DR-003 amendment (OTel export target) |
| ADR-0008 triggers fire (Redis adoption) | Vendor choice for Redis-compatible service (hosted vs self-host) — new record |
| Managed-Postgres provider/provider-level features change | ADR-0004 review, then operational vendor notes as a record if procurement is involved |
| Backup tooling beyond pg_dump/provider-PITR is proposed | Must touch [../../database/BACKUP_AND_RECOVERY.md](../../database/BACKUP_AND_RECOVERY.md) — architecture change → ADR first |
