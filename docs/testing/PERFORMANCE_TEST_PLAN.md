# Performance Test Plan

> **Status:** STABLE · **Owner:** Quality Engineering & Performance · **Updated:** 2026-10-27

Performance targets, scenarios, environments, and decision rules. Targets derive from
NFR-006 ([../PRODUCT_REQUIREMENTS.md](../PRODUCT_REQUIREMENTS.md) §2) and the
POS/report requirements; NFR-007 (99.5% monthly, RPO/RTO) is validated here for capacity
and in the DR drills ([../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md)).
Dashboards/SLO wiring: [../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md).
Load testing is a release gate at PHASE-025 (RISK-014) and a smoke gate per phase from
PHASE-007.

## 1. Targets (binding budgets)

| ID | Operation | Target | Notes |
|----|-----------|--------|-------|
| T-01 | Interactive document list (paged, filtered) | **p95 < 500 ms** at 100k documents/tenant | cursor pagination, tenant-scoped index; measured server-side (DB→API), with a browser-side p95 < 800 ms sanity on the E2E tier |
| T-02 | Invoice posting (approve→post incl. journals, stock, tax) | **p95 < 300 ms** | the critical path through the posting engine |
| T-03 | POS item-scan-to-cart (offline-cached lookup) | **< 2 s end-to-end** on mid-range Android/POS hardware | includes barcode decode + local SQLite read; network-free by design ([ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md)) |
| T-04 | Report generation tiers | Interactive reports p95 < 2 s; standard statements (TB/IS/BS, monthly, 100k-doc tenant) p95 < 10 s; heavy exports (XLSX > 50k rows) asynchronous with progress + ≤ 15 min p95 | tier list formalized with the report contracts ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md) at PHASE-013) |
| T-05 | Sync pull/push round-trip (typical batch ≤ 100 commands) | p95 < 3 s server processing | chaos suite provides correctness; this plan provides speed |
| T-06 | Login + app-shell interactive | p95 < 1.5 s | web, AR and EN |
| T-07 | API error-rate under target load | < 0.1% 5xx (excluding 4xx business rejections) | NFR-007 capacity input |
| T-08 | Posting engine throughput floor | ≥ 20 posts/s sustained per large tenant during batch windows (openings, day-end drain) | protects day-end POS drains |

## 2. k6 scenario catalog

| Scenario | Script shape | Thresholds | When it runs |
|----------|--------------|------------|--------------|
| **Smoke — core API** | 5 VUs / 1 min: health, login, list, one posting per module shipped so far | T-01/T-02 at trivial scale; zero 5xx | **Every phase ≥ PHASE-007** (part of CI; ≤ 20 min budget, [TEST_STRATEGY.md](TEST_STRATEGY.md) §6) |
| **Smoke — posting** | 20 VUs posting invoices + receipts against a seeded mid tenant for 5 min | T-02 p95 < 300 ms; no lock waits | every push after PHASE-007 (post-merge, staging) |
| **MVP candidate load** | Simulated day for the design-partner cohort: 20 tenants, business-hours profile (8h compressed to 30 min), document mix 60/25/15 (§3) | T-01/T-02/T-04-interactive/T-07 | pre-MVP (PHASE-014) on staging |
| **Soak** | 12 h steady mid-load + nightly job noise (reconciliation, exports) on staging | no memory drift; no queue runaway; error budget intact | staging, pre-MVP and pre-GA |
| **Full load — GA (PHASE-025)** | **10× projected traffic** with the tenant mix §3, business-hours profile + a 30-minute peak multiplier | all §1 targets under 10× | PHASE-025 gate |
| **Spike** | 5× jump in 2 min (month-end posting storm) | graceful degradation: 429s before collapse; recovery < 5 min | with full load at PHASE-025 |
| **Sync fleet** | 500 devices (simulated) pulling/pushing with fault-free profile + 5% revoked | T-05; rejection path cheap (R-06 rule) | PHASE-020/022 gates |
| **Report hammer** | one large tenant requests the heaviest reports concurrently up to its quota | quota enforcement works; other tenants unaffected (noisy-neighbor, [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §5) | PHASE-013 and PHASE-025 |

## 3. Load model (PHASE-025 full load)

- **Tenant mix**: **1 large** (≈100k documents/tenant profile, 50 concurrent users) +
  **50 mid** (≈10k docs, 5–10 users) + **500 small** (≈1k docs, 1–2 users).
- **Document mix**: **60% sales** (invoices/credit notes/receipts), **25% purchases**
  (POs/GRNs/supplier invoices/payments), **15% treasury** (expenses/transfers/shifts).
- **Traffic profile**: business-hours curve (08:00–20:00 local, double peak), compressed
  to fit the run window; peak multiplier 1.5× average; month-end day simulated as a final
  segment with the spike scenario.
- **Data seeding**: volume generator (deterministic, seeded) producing realistic
  distributions — line counts 1–15, partner/item cardinality, attachment presence; RLS on,
  realistic index bloat maintained (no freshly-vacuumed-utopia).
- **10× rule**: projected traffic is derived from design-partner telemetry × adoption
  forecast at GA; the derivation is written into the run report (not a round number from
  thin air).

## 4. Database baselines (asserted, not assumed)

| Baseline | Rule | Verification |
|----------|------|---------------|
| Connection pool sizing | pool = f(vCPU, tenants): baseline 20 conns/API pod for MVP scale; per-tenant partitioning remains a documented post-MVP option | saturation < 70% under 10× load; no `too many connections` in logs |
| Statement timeouts | tenant-scoped defaults (interactive 5 s, report queries 30 s, exports 15 min) enforced at the role/transaction level | timeout log shows rejections before DB strain; heavy queries classified correctly |
| Hot-query plans | **Top-10 hot queries EXPLAIN-verified with the RLS predicate present** and index-driven (`tenant_id` leading column — [../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md) §6) | CI job runs EXPLAIN on the 10 named queries at load-scale data; plan regression (seq scan, RLS predicate pushed to filter) fails the run |
| Slow-query watch | > 250 ms queries surface in metrics ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md) DB metrics) | count under load ≤ agreed budget in report |
| Job queue health | pg-boss depth stays within drain capacity during load | no dead-letter growth attributable to load |
| Lock contention | posting-engine serialization per tenant only | no cross-tenant lock waits; timeout-free month-end spike |

## 5. Dashboards, SLOs, and in-production validation

- Every k6 run publishes to the same metric pipeline as production
  ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md)) so load-test
  panels and production SLO panels are visually comparable.
- **SLO error budget** (NFR-007 99.5% monthly): the PHASE-025 report must show the load
  run's burn rate would keep the monthly budget intact with 2× headroom.
- Post-GA: continuous low-level synthetic probes replay the smoke profile hourly against
  production (read-only + sandbox-tenant postings) to catch plan drift and regressions
  between formal load tests.

## 6. Hardware profiles (documented per result)

| Profile | Definition (documented per run) |
|---------|----------------------------------|
| **Staging-class (minimum bar)** | e.g., 4 vCPU / 16 GB API pods, managed Postgres 8 vCPU / 32 GB (IOPS-class storage), same region as runners — the profile MVP numbers are quoted against |
| **Production-class (GA)** | sized per deployment architecture ([../architecture/DEPLOYMENT_ARCHITECTURE.md](../architecture/DEPLOYMENT_ARCHITECTURE.md)) — the 10× run must pass HERE for the GA gate |
| **Client profiles** | POS scan target measured on a reference Android mid-ranger + a low-spec Windows POS terminal (Tauri); documented per run since these gate T-03 |

Every report row carries: date, commit SHA, profile, data volumes, k6 version, and raw
result artifacts (per-timeline CSV) — reproducibility over anecdote.

## 7. Pass/fail report template

```markdown
# Performance Run Report — <scenario> — <date> (phase gate: PHASE-0NN)
Environment: <hardware profile §6> · Data: <tenant mix + volumes> · Commit: <sha>
| Target | Threshold | Result (p50/p95/p99) | Verdict |
| T-01 document list | p95<500ms @100k | ... | PASS/FAIL |
| ... | | | |
Degradations observed: <429 counts, queue depth, timeout rejects>
Plan verification: top-10 EXPLAIN appendix (RLS predicate present: yes/no per query)
Anomalies & follow-ups: <tickets>
Verdict: PASS / PASS-with-waivers(decision-record links) / FAIL → §8
```

## 8. Failure & rollback criteria (PHASE-025 gate)

If targets are missed at full load, GA does not silently slip — the miss routes through
the **documented options ladder** (each is a decision record + feature-flag/config, no
code forks):

| Option | Mechanism | Trade-off documented |
|--------|-----------|----------------------|
| O-1 Defer heavy paths by flag | feature flags disable/reduce: scheduled reports, bulk exports, non-essential dashboard widgets | reduced capability for GA cohort, clearly communicated |
| O-2 Dedicated worker pools | isolate report/render/Chromium jobs (RISK-013) and batch postings onto separate worker fleets | cost; protects interactive T-01/T-02 |
| O-3 Read-replica activation | route heavy reads (reports, lists on large tenants, export reads) to a replica | replication lag constraints on "as-of" determinism must be honored ([../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §2 — statements stay source-of-truth computed) |
| O-4 Scale-out + tuning | pool sizing, index additions, query rewrites found by plan verification | standard first response; requires re-run |
| O-5 Large-tenant extraction | move the large tenant to a dedicated deployment (supported by the model, [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §6) | last resort; only via decision record |

**Rules**: a FAIL verdict requires (1) root-cause analysis within 5 business days,
(2) application of at least one documented option, (3) a full-load re-run that passes
before the GA gate closes; passing on a weaker hardware profile than §6 production-class
does not close the gate. Partial passes (single target miss ≤ 20% over budget) may be
waived only by decision record with the compensating option named — the same regression-
budget philosophy as [REGRESSION_STRATEGY.md](REGRESSION_STRATEGY.md) §9.

## 9. Maintenance protocol

1. New hot query (or query that becomes hot) ⇒ add to the top-10 list with its EXPLAIN
   assertion (the list is code, reviewed like schema).
2. New report tier or offline capability ⇒ new target row (§1) + scenario (§2) in the
   same phase.
3. Every production performance incident adds its profile to the scenario catalog
   (regression named after the ticket).
4. Hardware profiles re-documented whenever deployment architecture changes; historical
   results never re-quoted against new hardware without a re-run note.
