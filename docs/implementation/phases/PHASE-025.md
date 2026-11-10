# PHASE-025 — Performance, Reliability & GA Readiness

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-025
- **Title:** Performance, Reliability & GA Readiness
- **Objective:** Prove the platform is ready for General Availability with evidence,
  not assertion: the full-load test at **10× projected traffic** against the
  production-class hardware profile with targets T-01…T-08 (and the O-1…O-5 options
  ladder if any target misses), the soak run, the **DR drill** (region-loss tabletop +
  timed cross-region restore rehearsal per
  [DISASTER_RECOVERY.md](../../operations/DISASTER_RECOVERY.md) §5), the
  **second-engineer cold-run backup restore** per the
  [BACKUP_RESTORE_RUNBOOK.md](../../operations/BACKUP_RESTORE_RUNBOOK.md) §4 drill
  script, runbook validation by cold run, live SLO dashboards + error budgets, an
  observability completeness audit, the docs-drift final validation, and the **GA GATE
  CHECKLIST** — every item of the
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) GA definition enumerated and
  closed with evidence, including honest compliance statements (no compliance claim
  without evidence).
- **Business value:** GA is a paid, public commitment: load evidence protects the day-
  one experience (RISK-014), DR/restore evidence protects the tenants' livelihood
  (RISK-018), and the gate checklist converts "we think we're ready" into a checkable,
  reviewable release record.

## 2. Scope

In scope:

1. **Full load test** per [PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md)
   §2/§3: **10× projected traffic** on the **production-class profile** (§6 — passing
   on weaker hardware does NOT close the gate); tenant mix **1 large (≈100k documents,
   50 concurrent users) + 50 mid (≈10k, 5–10 users) + 500 small (≈1k, 1–2 users)**;
   document mix **60% sales / 25% purchases / 15% treasury**; business-hours curve with
   1.5× peak; month-end **spike scenario (5× in 2 min)**; deterministic seeded data
   with RLS on and realistic index state. Targets T-01…T-08 asserted: document list
   p95 < 500 ms @ 100k; posting p95 < 300 ms; POS scan < 2 s on reference clients;
   report tiers; sync round-trip p95 < 3 s; login/shell p95 < 1.5 s; 5xx < 0.1%;
   posting throughput ≥ 20 posts/s per large tenant. DB baselines §4 asserted
   (pool < 70% saturation, timeouts classified, **top-10 hot queries EXPLAIN-verified
   with the RLS predicate present and index-driven**, slow-query budget, queue health,
   no cross-tenant lock waits). Report per the §7 template (date, SHA, profile,
   volumes, p50/p95/p99, verdicts, artifacts).
2. **Options ladder on any miss** (§8): a FAIL routes through root-cause within 5
   business days, application of at least one documented option (O-1 defer heavy paths
   by flag · O-2 dedicated worker pools · O-3 read-replica activation honoring as-of
   determinism · O-4 scale-out + tuning · O-5 large-tenant extraction — each a decision
   record), and a **full-load re-run that passes before the gate closes**; single-target
   misses ≤ 20% over budget may be waived only by decision record naming the
   compensating option.
3. **Soak test** (§2): 12 h steady mid-load + nightly job noise on staging — no memory
   drift, no queue runaway, error budget intact; plus the report-hammer noisy-neighbor
   check (quota enforcement; other tenants unaffected).
4. **DR drill** per [DISASTER_RECOVERY.md](../../operations/DISASTER_RECOVERY.md) §5
   (mandatory GA gate): (a) **region-loss tabletop** (scenario S1) walked cold by
   on-call + engineering lead + product owner using only written runbooks — gaps
   recorded as actions; (b) **one cross-region restore rehearsal** executing
   [BACKUP_RESTORE_RUNBOOK.md](../../operations/BACKUP_RESTORE_RUNBOOK.md) §7
   end-to-end in the recovery region, **timed — the recorded wall time is the evidence
   for the RTO ≤ 8 h claim**; failure of either part blocks GA until repeated
   successfully. Drill records appended to runbook §8 + the GA release checklist.
5. **Backup restore cold-run** by a **second engineer** per runbook §4: PITR to a
   chosen timestamp using only the runbook (no tribal knowledge), timed, with the
   five-assertion invariant smoke (INV-001/002 balance, RLS guard, audit monotonicity,
   INV-006, INV-013 uniqueness), row-count comparison vs source, measured RTO ≤ 4 h /
   RPO ≤ 15 min, signed drill record.
6. **Runbook validation (second-engineer cold runs)**: the deployment runbook
   ([DEPLOYMENT.md](../../operations/DEPLOYMENT.md)) executed cold by an engineer who
   did not write the recent changes — including the rollback workflow and smoke tests;
   every "what was hard" note becomes a runbook fix; the §7 per-phase additions
   (PHASE-020 change_log pre-flight, PHASE-021/022 client-channel rules, PHASE-023
   certificate provisioning, PHASE-025 DR/restore pre-flight inputs) verified live.
7. **SLO dashboards + error budgets live** per
   [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md) and
   [MONITORING.md](../../operations/MONITORING.md) §5: SLOs go live at GA — API
   availability 99.9% monthly; API latency p95 within NFR-006; posting success ≥ 99.99%
   with **zero** invariant failures (Sev-1 regardless of budget); backup + restore-smoke
   100% of scheduled runs; sync push success ≥ 99.5% within 24 h (PHASE-020+); report
   render SLA per template. Burn alerts (2× Sev-2 / 4× Sev-1) wired; the
   error-budget policy (feature releases pause on exhaustion) recorded in the GA
   release checklist; load-test burn-rate evidence must show the monthly budget intact
   with 2× headroom (PERFORMANCE_TEST_PLAN §5).
8. **Observability completeness audit**: every dashboard in MONITORING §1 exists and is
   populated; **every alert links a runbook section** (no alert without one); metric
   naming `erp_<module>_<name>_<unit>` consistent; log retention (30 d hot / 1 y cold)
   configured and verified; redaction fail-closed spot checks.
9. **Docs-drift final validation** per
   [REGRESSION_STRATEGY.md](../../testing/REGRESSION_STRATEGY.md) §6: schema catalog
   vs actual migrations (every tenant-owned table cataloged + RLS-checked), permissions
   seed vs [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md), INV-xxx →
   test-suite mapping complete
   ([ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md)), capabilities matrix vs
   implemented gates, roadmap/phase tables vs `docs/implementation/phases/` files —
   all CI docs-validation checks green.
10. **GA release process** per [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md):
    only phases COMPLETE with evidence ship; CalVer release tag; quality gates re-run
    (CI green, migration rehearsal, security checklist, perf smoke, docs freeze);
    rollout by cohort (dogfood → design partners → GA cohorts) with client channels
    staged; bilingual release notes from CHANGELOG.
11. **GA GATE CHECKLIST** — the enumerated close-out of
    [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) §GA gate (see §6 acceptance
    criteria): load evidence; DR drill within RTO; restore-from-backup proven;
    pen-test findings closed; runbooks validated; error-budget process live; and the
    e-invoicing clause — ZATCA adapter certified per official requirements **or** the
    launch segment explicitly excludes e-invoicing-requiring taxpayers (documented
    decision — DR-001); compliance status statements honest everywhere.
12. **Post-GA roadmap pointer**: record what GA deliberately leaves open — bug-bounty
    decision, support SLA commitments (OQ-008 finalized after the GA readiness
    review), personal-account payments (OQ-007), ETA/UAE adapter follow-ups per their
    decision records, iOS decision, read-replica/Redis triggers — each with its owning
    decision-record slot, not vague aspirations.

Out of scope (explicit):

- New features, new modules, new endpoints — GA hardening only.
- Production multi-region failover as a capability (A-012: single region at GA; the
  cross-region path is rehearsed for DR, not offered as active-active).
- Compressing or waiving gate items under schedule pressure: a missed item = a
  documented INCOMPLETE, never a quiet pass (waivers only via decision record).
- Bug bounty launch, personal-account payments, iOS — post-GA items (pointer only).

## 3. Prerequisites

- Required phases: **PHASE-024** COMPLETE (pen-test closure + hardening evidence are
  GA gate inputs); transitively all of 001–024 COMPLETE per
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) — with any
  INCOMPLETE gated items (PHASE-023 adapters) explicitly carried into the gate
  checklist honestly.
- Required architecture decisions: NFR-006/NFR-007 budgets
  ([PRODUCT_REQUIREMENTS.md](../../PRODUCT_REQUIREMENTS.md) §2),
  [DEPLOYMENT_ARCHITECTURE.md](../../architecture/DEPLOYMENT_ARCHITECTURE.md)
  (production-class sizing + client distribution),
  [ADR-0011](../../architecture/ADR/ADR-0011-reporting-printing.md) (worker
  isolation under load), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md).
- Relevant documentation:
  [PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md) (targets,
  scenarios, baselines, options ladder, report template),
  [TEST_STRATEGY.md](../../testing/TEST_STRATEGY.md) (budgets),
  [DISASTER_RECOVERY.md](../../operations/DISASTER_RECOVERY.md) (§5 drill, §7
  readiness inventory), [BACKUP_RESTORE_RUNBOOK.md](../../operations/BACKUP_RESTORE_RUNBOOK.md)
  (§3 smoke, §4 cold drill, §7 cross-region, §8 log/attestation),
  [DEPLOYMENT.md](../../operations/DEPLOYMENT.md) (runbook + §7 phase additions),
  [MONITORING.md](../../operations/MONITORING.md) (§1/§3/§5),
  [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md),
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) (GA gate),
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §11 (GA re-test
  cadence), [REGRESSION_STRATEGY.md](../../testing/REGRESSION_STRATEGY.md) §6/§8
  (docs-drift, RC checklist), [DR-001-zatca-scope-and-timing.md](../../decisions/compliance/DR-001-zatca-scope-and-timing.md)
  (the e-invoicing gate clause), [OQ-007](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)/
  OQ-008 (post-GA pointers).

## 4. Design Impact

- **Database changes:** none (tuning only — indexes/pool parameters are O-4 territory
  with decision records; no new tables).
- **API changes:** none (rate-limit/quota configuration tuning only, behind existing
  flags).
- **UI changes:** GA-cohort rollout affordances (status page links, release notes
  surfacing); SLO dashboard views for internal ops; no new user features.
- **Security & authorization:** GA re-test slice per SECURITY_TEST_PLAN §11 cadence
  (scoped re-runs before GA; full re-test after significant new surfaces); SLOBurn
  alerts live; no new permissions.
- **Accounting implications:** none — but the load run's ledger oracle and the
  invariant smoke on every restored backup re-prove INV-001/002/006/013 on GA-scale
  data; report reconciliation asserts TB/IS/BS correctness at 100k-document scale
  ([FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md)).
- **Localization implications:** release notes, status page, and DR comms templates
  exercised bilingually (AR+EN) during the drill (DISASTER_RECOVERY §3 templates are
  the artifacts).
- **Offline implications:** sync fleet at 10× (T-05) and the staged client channels'
  behavior during server deploys (breaking-change windows respect lagging offline
  clients — RELEASE_STRATEGY) verified in the load window.
- **Module dependencies:** cross-cutting operations over all modules; no code-module
  changes expected — performance fixes land inside existing module boundaries with
  decision records for anything architectural.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Seed the load model: deterministic volume generator (tenant mix §3, doc mix, RLS on, realistic bloat) on the production-class profile | `tests/performance/fixtures/**` | seeded dataset validated (counts, distributions) |
| T2 | Full-load run (10× + peak + month-end segment) with T-01…T-08 assertions + DB baselines (EXPLAIN top-10 with RLS predicate) | `tests/performance/ga-full.js`, run report | §7-template report: PASS / PASS-with-waivers / FAIL→T3 |
| T3 | (Conditional) options ladder: RCA ≤ 5 business days, apply O-1…O-5 with decision records, full re-run passes | decision records + re-run report | re-run PASS on production-class profile (gate closes only then) |
| T4 | Spike + report-hammer scenarios (429-before-collapse, noisy-neighbor isolation) | `tests/performance/spike.js`, `report-hammer.js` | graceful degradation + recovery < 5 min; quota enforcement |
| T5 | Soak: 12 h mid-load + nightly jobs on staging | `tests/performance/soak.js` | no memory drift; queue depths stable; budget intact |
| T6 | DR drill: S1 tabletop (cold, runbooks only) + timed cross-region restore rehearsal (§7) in the recovery region | drill records → runbook §8 log + GA checklist | recorded wall time vs RTO ≤ 8 h; gaps → actions with owners |
| T7 | Backup-restore cold run by second engineer: PITR to chosen timestamp, invariant smoke (5 assertions), row counts, signed record | drill record → runbook §8 log | RTO ≤ 4 h / RPO ≤ 15 min measured; suite green |
| T8 | Deployment runbook cold validation by a second engineer incl. rollback workflow + §7 phase-addition checks | runbook annotations | cold run completes from written steps only; fixes applied |
| T9 | SLO dashboards + burn alerts live; error-budget policy recorded in GA checklist; load burn-rate evidence (2× headroom) | dashboards + `docs/operations/**` | SLOBurn alert fires on seeded burn; panels populated from prod pipeline |
| T10 | Observability completeness audit (dashboards, alert→runbook links, naming, retention, redaction) | audit checklist artifact | 100% alerts linked; retention verified |
| T11 | Docs-drift final validation: catalog/permissions/invariants/matrix/roadmap checks | CI docs validation + drift jobs | all green; any mismatch fixed in-phase |
| T12 | GA re-test slice (scoped pen-test re-runs) + findings closure confirmation | security-findings log | no open Critical/High (or recorded waivers); retest proofs |
| T13 | GA release execution: CalVer tag, quality gates, cohort rollout, bilingual release notes, staged client channels | release checklist + tags | release checklist fully checked; cohorts proceed per gates |
| T14 | Post-GA roadmap pointer record (bug bounty, OQ-008 SLA, OQ-007 payments, adapter follow-ups, iOS) | `docs/decisions/**` stubs + roadmap note | every open item has an owning decision-record slot |
| T15 | Final status/docs updates: IMPLEMENTATION_STATUS, CHANGELOG, CURRENT_STATE, VALIDATION_REPORT | `docs/**` | docs validation green; statuses honest |

## 6. Verification

**Automated tests (required):**

- Full-load, spike, report-hammer, and soak runs with machine-checked thresholds
  (T-01…T-08, degradation rules, DB baselines) — reports with p50/p95/p99 + artifacts
  per [PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md) §7.
- Nightly restore-smoke continues green through the phase; the §4 cold drill's
  invariant suite output attached (INV-001/002/006/013 + RLS guard + audit
  monotonicity).
- Docs-drift CI jobs: schema catalog, permissions seed vs matrix, invariants mapping,
  phase-table consistency — all green on the release tag.
- Chaos + isolation + accounting suites green on the GA-candidate SHA (they are the
  standing CI gates; their green runs on the release tag are gate evidence).

**Manual verification:**

1. Walk the GA GATE CHECKLIST item by item with the evidence links in front of you
   (see acceptance criteria) — every box checked or explicitly INCOMPLETE with an
   owner.
2. Time-box the tabletop: region loss from a cold start, only written runbooks; record
   decision points and gaps.
3. Observe a GA-cohort rollout: client channels staged, crash gates reading live
   panels, rollback path rehearsed once in staging.
4. Review the SLO dashboards during the load window: burn alerts would have fired on
   seeded burn; error-budget policy statement is in the release checklist.

**Acceptance criteria (objective) — the GA GATE CHECKLIST:**

1. **Load evidence**: full-load 10× run PASSES on the production-class profile with all
   T-01…T-08 within budget (or a decision-record waiver naming the compensating
   option); DB baselines asserted; spike degrades gracefully; soak clean; report
   attached.
2. **DR drill evidence**: region-loss tabletop executed with recorded actions; the
   cross-region restore rehearsal completed end-to-end with recorded wall time within
   RTO ≤ 8 h — or GA is blocked until repeated successfully.
3. **Restore evidence**: second-engineer cold PITR restore within RTO ≤ 4 h and
   measured RPO ≤ 15 min, invariant smoke green, signed drill record in runbook §8;
   nightly restore-smoke ≥ 27/30 days in the attestation month.
4. **Pen-test closure**: PHASE-024 findings closed per SLA (no open Critical; High
   closed or waiver-recorded); the scoped GA re-test is green; regression tests for
   every fixed finding remain in CI.
5. **Runbooks validated**: deployment + backup/DR runbooks cold-run by second
   engineers with fixes landed; every alert links a runbook (audit output).
6. **Error-budget process live**: SLO dashboards populated, burn alerts wired, the
   freeze-on-exhaustion policy recorded in the GA release checklist, load-run burn
   evidence shows 2× headroom.
7. **Compliance status honest**: the e-invoicing clause resolves exactly as
   [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) §GA gate requires — ZATCA
   adapter certified per official requirements **or** the launch segment explicitly
   excludes e-invoicing-requiring taxpayers via the documented decision
   ([DR-001](../../decisions/compliance/DR-001-zatca-scope-and-timing.md)); every
   compliance statement in docs/release notes traces to verification-log evidence —
   **no compliance claims without evidence anywhere**.
8. **Docs-drift final validation green**: schema catalog, permissions, invariants
   mapping, capabilities matrix, phase tables — all CI checks green on the release
   tag; IMPLEMENTATION_STATUS reflects every phase (and every INCOMPLETE gated item)
   honestly.
9. **Release process executed per** [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md):
   CalVer tag, quality gates, cohort rollout with staged client channels, bilingual
   release notes; no partially verified phase shipped.
10. **Post-GA pointer recorded**: open items (bug bounty, OQ-008 SLAs, OQ-007
    payments, ETA/UAE follow-ups, iOS) each have an owning decision-record slot.
11. Criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) and the
    GA release checklist.

**Performance & security considerations:** the 10× run is the phase's purpose — no
target may be "visually close"; partial passes follow §8 waiver discipline only.
Security at GA means the closed-findings state + live SLOBurn/RLS canaries; no new
attack surface is added. Client staged-rollout crash gates remain active through and
after GA.

**Migration & rollback:** no schema migrations expected (tuning only); the GA release
itself follows the standard deploy gates (migration rehearsal, expand-contract,
rollback image identified); a GA-blocking failure routes to the incident process —
GA does not ship on a red gate; forward-fix preferred, PITR last resort per
[DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §5.

## 7. Risks and Constraints

- **RISK-014** (performance collapse under real volumes) is the primary risk: the
  options ladder + re-run discipline prevent a quiet slip; historical results are
  never re-quoted against new hardware without a re-run note (PERFORMANCE_TEST_PLAN §9).
- **RISK-018** (backups untested): the drill evidence IS the mitigation; a failed
  drill blocks GA and repeats within 2 weeks (runbook §4 rule).
- **RISK-001-adjacent schedule pressure**: the gate checklist converts pressure into
  explicit INCOMPLETE markers + decision records — an honest partial GA beats a
  fabricated full one (directive §1.10–1.11 culture).
- External dependencies (certification lead times) are kept off the critical path by
  the DR-001 option-C sequencing; the gate clause handles either outcome.
- Constraint: single-region at GA (A-012) — the cross-region rehearsal proves the
  recovery path, not an active multi-region product.
- Constraint: findings waivers are decision records read at the gate — "we'll fix it
  after GA" without a record is a gate failure.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-025-COMPLETION.md` + the **GA release
  checklist** with links for every item: full-load/spike/soak reports (§7 template),
  DR drill records (tabletop + timed rehearsal), cold-restore drill record, runbook
  cold-run notes, SLO/burn wiring proof, observability audit, docs-drift CI outputs,
  security findings closure state, the DR-001 clause resolution, release tag + cohort
  rollout record, post-GA pointer record.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-025 →
  COMPLETE; GA RELEASE recorded), `docs/handoff/CURRENT_STATE.md`,
  `docs/handoff/CHANGELOG.md` (GA release notes source),
  [BACKUP_RESTORE_RUNBOOK.md](../../operations/BACKUP_RESTORE_RUNBOOK.md) §8 drill log
  + attestation, [DISASTER_RECOVERY.md](../../operations/DISASTER_RECOVERY.md) drill
  records, [MONITORING.md](../../operations/MONITORING.md) (SLOs live),
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) (GA gate marked with evidence
  links), decision-record stubs for post-GA items.
- **Exit criteria:** GA GATE CHECKLIST fully closed (every item evidenced or
  explicitly INCOMPLETE with owner + follow-up slot); the GA release shipped per
  RELEASE_STRATEGY with all quality gates green; SLOs live; post-GA pointer recorded;
  docs synchronized; zero TODOs.
- **Definition of Done:** the platform is **GA**: the release tag is public, cohorts
  roll, SLOs and error budgets govern ongoing work, the drill/attestation cadences
  (quarterly cold drills, monthly attestations, official-source monitoring) continue
  as living processes, and every open thread has a named decision-record home.
- **Handoff instructions:** post-GA work is governed by the release tiers
  ([RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md)): v2.x industry and
  multi-platform releases, scoped pen-test re-runs per major tier, bug-bounty decision
  record, SLA definition per OQ-008, and adapter follow-ups per their compliance
  decision records. The maintenance protocols of every governing document (test plan
  §14, secrets §8, performance §9, chaos §9, compliance matrix §6) are now the
  operating system of the product. **No next implementation phase — this phase closes
  the 25-phase roadmap; post-GA scope is defined by decision records, not by this
  blueprint.**
