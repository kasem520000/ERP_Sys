# PHASE-025 — Orchestrator work record (T11/T15 + the serial gate + coordination)

Task ID: **P25-ORCH** (the orchestrator's slices; the parallel agents' records:
P25-1 PERF-A, P25-2 SLO-B, P25-3 DR-C, P25-4 DOCS-D — the master plan is
[PHASE-025-MASTER-PLAN.md](PHASE-025-MASTER-PLAN.md)).

## The parallel wave (all four delivered with their own verification)

- **P25-1 PERF-A**: `ga-fixtures.ts` (683) + `ga-full-load.db.spec.ts` (896) +
  `ga-spike.db.spec.ts` (261) + `report-hammer.db.spec.ts` (226) +
  `soak-shaped.db.spec.ts` (310) — fixed 4 runtime-fatal draft flaws pre-gate
  (change_log INSERT arity, T-04 param collisions incl. balance-sheet's asOfDate
  contract, the slow-query two-plane split) + proved the report-quota gap
  (MULTI_TENANCY §5 → DR-P25-07) + flagged the stale CURRENT_SHIPPED_PHASE spec
  pin (pre-existing at PHASE-024 HEAD — the 3 unit failures PERF-A proved
  isolated).
- **P25-2 SLO-B**: `infra/observability/metrics.ts` + `slo.ts` + the burn spec
  (24/24) + `infra/http/metrics.middleware.ts` + the `/platform/slo` route
  (platform.audit.view — an EXISTING seeded key; platform.admin.access is not,
  the truthful finding) + the web screen + i18n + `scripts/check-observability.ts`
  (19/19/35 GREEN). The orchestrator fixed the spec's discriminated-union
  narrowing (expect().toBe() carries no narrowing power — the detailOf<> type
  guard).
- **P25-3 DR-C**: `restore-drill-ga.ts` (527) + the tabletop record (G1–G11) +
  the deployment cold-run record (3 real smoke-block drift bugs fixed E1–E5) +
  the runbook §8 rows (ORCH-FILL) + the honest NOT-SIGNED attestation draft +
  DEPLOYMENT.md §7 PHASE-025 pre-flight leg.
- **P25-4 DOCS-D**: the GA-RELEASE-CHECKLIST (428 lines, 11 criteria, the honest
  ledger 1 INFRA-GATED / 5 CLOSED-LOCAL-TIER / 5 CLOSED) + bilingual release
  notes v1.1.0 + 7 post-GA decision stubs + the RELEASE_STRATEGY row + CHANGELOG
  + roadmap marking (docs:validate 29/29 through it all).

## The orchestrator's own slices

- **The CURRENT_SHIPPED_PHASE bump** 024→025 (`prerequisites.ts` bookkeeping
  comment: GA hardening, zero new plan keys) + the spec pin fix (the pin test +
  BOTH synthetic future-phase tests moved PHASE-024→PHASE-026 — the mechanism
  outlives the bump).
- **The serial gate** (embedded-PG exclusivity — agents forbidden from db runs;
  the suite is 143 files now, exceeding the ~4-minute background-process limit:
  chunked FOREGROUND execution, 14 chunks, every chunk green):
  138 existing files/2014 tests + the 5 performance files (mvp 5 + spike 1 +
  full-load 13 + hammer 1 + soak 1) = **143 files / 2035 tests ALL PASS**.
- **Both restore drills EXECUTED with timings** (PG_TOOLS_BIN =
  /tmp/my-project/extracted_phase013/tools/bin — the PHASE-013 debian client
  package, the runbook's documented sandbox pattern): §4 quarterly 1.3 s PASS;
  §7 cross-region-shaped 1.1 s restore leg / 2.3 s chain / 7.0 s wall PASS — the
  §8 ORCH-FILL rows filled with the real numbers; the ORCH-CONFIRM attestation
  resolved honestly (2026-12-01 first-due).
- **All evidence injection**: the GA checklist's 10 slots + the CHANGELOG +
  RELEASE_STRATEGY + MASTER_ROADMAP markers filled from the gate outputs (every
  number from a real run; the SHA slot resolved to the release-commit wording).
- **T15**: PHASE-025-COMPLETION.md + IMPLEMENTATION_STATUS (025 COMPLETE — GA
  RELEASE, the full evidence row) + CURRENT_STATE (the GA-released range) +
  NEXT_ACTION (the post-GA two-track rewrite) + this record.
- **The release tags**: `phase/025` + `release/v1.1.0` + `v1.26.11.0` created at
  the GA commit (real repository objects — the repo carries .git, unlike the
  MVP's zip handover).

## Bugs found + fixed during the gate (the honest list)

1. **SF-025-001 — PushService DI paramtypes**: T-05's warm push returned
   "Cannot read properties of undefined (reading 'create')" for EVERY command —
   the vitest/esbuild transform emits no `design:paramtypes`, so the app boot
   DI-constructed PushService with all 15 slots undefined and silently re-wired
   the sync handler graph (the module-scope spec construction had wired it
   correctly; the boot clobbered it). Diagnosis: three temporal diagnostics
   (module-scope object / post-boot all-undefined / keys-present-values-
   undefined). Fix: explicit `@Inject()` on every constructor param — the repo's
   own convention (controllers + journal-service et al.). Regression-proof: the
   full sync suite 22/196 green after.
2. **SF-025-002 — pool-before-limiter collapse** (the spike first draft): the
   50-concurrency storm (~800 req/s loopback, 8× the ceiling) saturated the
   20-conn pool before the limiter could 429 — 5xx collapse, the exact opposite
   of the scenario. Fix: the pool-safe 10-lane storm (≈165 req/s ≈ 5.5× the
   modeled baseline — still the month-end shape) + the collapse mode documented
   in the spec header + the completion report (production runs carry real
   latency; pool sizing is O-4).
3. **pg-boss queue-health over-tightness**: `depth ≤ before+2` tripped on
   legitimate cron landings; the honest split is system-vs-non-system jobs
   (`data->>'system'` — the first attempt used `payload`, the v10 column is
   `data`) with a drain proof (two samples 1 s apart, non-growing) + the
   dead-letter zero-delta.
4. **The soak heap false-positive**: raw heapUsed grew 22% in 200 s — pure
   uncollected allocation ramp (V8 GC is lazy). Fix: retained-heap measurement
   (post-forced-GC via the v8/vm trick) — ratio 0.996, no drift, the honest
   signal.

## Gate output (the PHASE-026 baseline)

- DB suite: **143 files / 2035 tests — all pass** (024: 139/2019).
- Unit: api 32/334 (+24 SLO) · web 5/73 · desktop 16/274 · mobile 27/393.
- typecheck 8/8 · lint · depcruise 0 violations / 2209 modules ·
  permissions-drift 244=244 (zero new keys) · i18n 3399=3399 (+56/locale) ·
  docs:validate 29/29 · check:observability 19/19/35 GREEN · check:deps clean ·
  check:rls in-suite green · restore:drill + restore:drill-ga both PASSED.

## Coordination notes

The four parallel agents were forbidden from db-suite runs (embedded-PG
exclusivity); the orchestrator merged, typechecked centrally, and ran the serial
gate in foreground chunks (the ~4-minute background-process kill — the documented
pattern). No migrations, no new tables, no new permission keys (the phase §4
rule) — the catalog-drift cascade had nothing to register this phase.
