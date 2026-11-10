# PHASE-025 — Master Plan (Performance, Reliability & GA Readiness)

> Phase doc: `docs/implementation/phases/PHASE-025.md` (T1–T15, GA GATE CHECKLIST §6).
> The honest-split discipline continues from 023/024: everything the platform can
> build, drill, and prove in this environment is EXECUTED with evidence; the
> genuinely hosted legs (production-class hardware k6 run, the 12 h staging soak,
> the real cross-region recovery region, the external pen-test firm) carry the
> standing owner-directive waiver pattern (2026-10-28, PHASE-014 §v1.0.0 notes)
> with local-equivalent evidence + named follow-up obligations. **A missed item =
> a documented INCOMPLETE, never a quiet pass.**

## Non-negotiable constraints

1. **No new migrations, no new tables, no new permission keys** (phase §4: tuning
   only; "no new permissions" verbatim). The SLO substrate is in-process — the
   SF-024-021 substrate pattern (the OTel exporter swap picks the names up).
2. **Math.* ban (ADR-0009 house rule)**: latency/window statistics use raw float
   values + `no-restricted-properties` eslint-disable comments where rank/index
   selection is needed (the mvp-candidate.local.spec.ts `p95()` precedent).
3. **Embedded-PG exclusivity**: ONE db-suite run at a time. Subagents are
   FORBIDDEN from `test:db`, `restore:drill*`, and any embedded-PG boot. The
   orchestrator runs the gate serially.
4. **No fabricated numbers**: every reported p50/p95/p99 comes from a real run in
   this environment; every hosted-tier claim is marked infra-gated with the
   waiver reference. The 10× derivation is written arithmetic from the documented
   §3 mix, not a round number from thin air.
5. Catalog drift discipline: **nothing new to register this phase** (no tables,
   no keys) — but every docs file touched must keep `docs:validate` green
   (29/29 or its post-GA count).

## The 10× derivation (written into the run report — PERFORMANCE_TEST_PLAN §3)

- MVP-candidate cohort (PHASE-014, the design-partner tier): 20 mid-profile
  tenants ≈ 100–120 concurrent active users at business-hours peak.
- GA §3 mix: 1 large (50 users) + 50 mid (5–10, avg 7.5 → 375) + 500 small
  (1–2, avg 1.5 → 750) = **1,175 concurrent users ≈ 10–11× the MVP cohort**.
- Doc volumes: 100k (large) + 50×10k + 500×1k = **1.1M documents**, mix 60/25/15
  (sales/purchases/treasury), RLS on, deterministic seed (T1).
- Local-harness tier: embedded PostgreSQL 16 (same major as compose) on this
  sandbox — a fraction of staging-class; the production-class hosted run is the
  infra-gated GA obligation recorded in the checklist (§8 waiver discipline:
  passing on weaker hardware does NOT close the gate — the checklist says so).

## Task split (the parallel agents + orchestrator)

| Task ID | Owner | Phase tasks | Deliverables |
|---|---|---|---|
| **P25-1** (PERF-A) | subagent | T1, T2, T4, T5 | `apps/api/src/__db__/performance/ga-fixtures.ts` (T1 volume generator), `ga-full-load.db.spec.ts` (T2: T-01…T-08 + DB baselines + EXPLAIN top-10 w/ RLS predicate), `ga-spike.db.spec.ts` (T4a: 429-before-collapse via the R-04 tenant limiter, recovery), `report-hammer.db.spec.ts` (T4b: quota enforcement + noisy-neighbor isolation), `soak-shaped.db.spec.ts` (T5: compressed soak — heap/queue-depth/budget sampling with no-drift assertions; 12 h staging = gated) |
| **P25-2** (SLO-B) | subagent | T9, T10 | `apps/api/src/infra/observability/metrics.ts` (in-process registry: counters + HDR-ish latency sampler, `erp_<module>_<name>_<unit>` naming), `apps/api/src/infra/http/metrics.middleware.ts` (request rate/error rate by class/p95 per route group — the golden-signals panels' source), `apps/api/src/infra/observability/slo.ts` (the MONITORING §5 six SLOs + burn 2×/4× + SLOBurn alert + snapshot), platform controller route `GET /api/v1/platform/slo` (gated `platform.admin.access` — existing key), web `/[locale]/platform/slo` screen + i18n AR/EN, `scripts/check-observability.ts` (T10 audit: every MONITORING §3 alert → runbook anchor exists; §1 dashboards enumerated; naming convention; retention config presence), unit spec `slo.burn.spec.ts` (seeded burn fires SLOBurn at 2× and 4×) |
| **P25-3** (DR-C) | subagent | T6, T7, T8 | `apps/api/scripts/restore-drill-ga.ts` + package script `restore:drill-ga` (the §7 cross-region-shaped rehearsal: fresh embedded env + full migration chain + nightly-shaped dump restore + timed + §3 invariant smoke + row counts — local tier), the S1 tabletop record `docs/operations/dr-drill-2026-11-06.md` (cold walk, decision points, gaps as actions), drill-log §8 entries (BACKUP_RESTORE_RUNBOOK), deployment cold-run record + DEPLOYMENT.md §7 PHASE-025 pre-flight additions, DR readiness-inventory §7 re-check |
| **P25-4** (DOCS-D) | subagent | T12, T13, T14 | GA release checklist `docs/implementation/phases/reports/GA-RELEASE-CHECKLIST.md` (the 11 acceptance criteria × evidence slots), bilingual release notes `docs/operations/release-notes/v1.1.0.ar.md` + `.en.md` from CHANGELOG, post-GA decision-record stubs (`docs/decisions/security/DR-P25-01-bug-bounty.md`, `docs/decisions/product/DR-P25-02-support-sla.md` (OQ-008), `DR-P25-03-personal-payments.md` (OQ-007), compliance follow-ups note for ETA/UAE + iOS pointer), RELEASE_STRATEGY release-log row + CalVer `v1.26.11.0`/`release/v1.1.0` tag instructions, CHANGELOG GA entry, MASTER_ROADMAP GA-gate marking scaffold |
| **P25-ORCH** | orchestrator | T11, T15, gate | merge + central typecheck, the serial gate (db suite w/ new specs → restore drills → check:observability → all drift checks → unit suites), evidence injection into the checklist + completion report, IMPLEMENTATION_STATUS/CURRENT_STATE/VALIDATION_REPORT/NEXT_ACTION, CURRENT_SHIPPED_PHASE 024→025, git commit + `phase/025` + release tags, the ZIP |

## Gate sequence (serial, orchestrator-only)

1. `pnpm --filter @erp/api typecheck` + root typecheck/lint (fast feedback).
2. DB suite: `pnpm --filter @erp/api test:db` — the full 139+files / 2019+tests +
   the new perf specs (T-01..T-08 evidence comes from THIS run).
3. `pnpm --filter @erp/api restore:drill` (the §4 quarterly re-proof) then
   `restore:drill-ga` (the new §7-shaped rehearsal) — timed, records captured.
4. `pnpm check:observability` (T10 green).
5. The drift battery: `docs:validate`, `check:permissions-drift`, `check:rls`,
   `check:capabilities-matrix`, `check:i18n-parity`, `lint:depcruise`,
   `check:deps`, unit suites (api/web/desktop/mobile).
6. T12 closure confirmation from the security findings log (0 Critical open;
   SF-024-016..018 SLA state re-read).
7. Docs finalization + completion report + commit + tags.

## Honest markers the GA checklist carries (decided up front)

- Production-class hosted k6 full-load = infra-gated (local-equivalent evidence
  at documented volumes; §8: weaker hardware ≠ gate closure — recorded).
- 12 h staging soak = gated; the compressed soak proves the assertion machinery
  (no-drift slopes) at sandbox scale.
- Cross-region rehearsal = the §7 procedure executed at local tier (fresh env +
  full chain + timed restore); the recovery-region wall time is a hosted number.
- External pen-test firm leg = the standing infra-gated waiver (PHASE-024
  record; the GA checklist re-reads it — internal §11 re-verification green).
- OQ-009 = BLOCKED-EXTERNAL (DR-024-02) — unchanged.
- T-03 client-hardware leg = the device-farm deferral line (PHASE-022 record);
  the local SQLite-read substrate timing recorded where measurable.
- DR-001 resolution = option C recorded (launch segment excludes
  e-invoicing-requiring taxpayers) — the gate clause's documented decision.
