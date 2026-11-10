# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-10 (Blueprint v3.0 planning complete)

## The single next action

**The 34-phase blueprint is CLOSED — Enterprise Depth delivered — and Blueprint v3.0
(the completeness program) is now PLANNED: the next eligible phase is
PHASE-035 — Activation & Truth Restoration** (the 2026-11-09 delivery completion
closed the final two audit findings; the 2026-11-10 planning session authored the
31-phase v3.0 program). Implementation of v3.0 follows the same phase-by-phase
protocol: read [../planning/COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md)
+ [../planning/COMPLETENESS_ROADMAP.md](../planning/COMPLETENESS_ROADMAP.md) + the
phase document [../implementation/phases/PHASE-035.md](../implementation/phases/PHASE-035.md),
then execute per [AGENT_START_HERE.md](AGENT_START_HERE.md); on completion append the
report, flip the [../planning/IMPLEMENTATION_STATUS.md](../planning/IMPLEMENTATION_STATUS.md)
row, and deliver the archive `ERP_PLATFORM_PHASE035.zip` (OA-07). The wave-1 entry
condition **OQ-002 (plan pricing)** remains an owner decision recorded in
SUBSCRIPTION_AND_ENTITLEMENTS.md (CR-39).

The completed lineage for context: GA shipped 2026-11-06 (PHASE-025; release `v1.1.0` /
CalVer `v1.26.11.0`), stages 9–11 (026–034) completed 2026-11-08/09 with the Enterprise
Depth gate, and the 2026-11-09 delivery completion shipped the marketing landing + the
thirteenth template. Post-GA governance continues on three tracks (no vague aspirations —
every item has a home):

1. **The v3.0 completeness releases (stages 12–15 — PHASE-035…065)** per
   [../planning/COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md) +
   [../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) — additive releases
   that never alter the MVP/GA/Enterprise-Depth gate criteria (CR-01). **Next eligible
   phase: PHASE-035** (activation & truth restoration — prerequisites 034 ✓).
2. **The decision-record queue** (the PHASE-025 T14 stubs + the standing records):
   DR-P25-01 bug bounty · DR-P25-02 support SLA (OQ-008) · DR-P25-03 personal
   payments (OQ-007) · DR-P25-04 ETA/UAE adapter follow-ups · DR-P25-05 iOS ·
   DR-P25-06 the observability exporter swap (SF-024-021 → the live in-process
   substrate's pipeline leg) · DR-P25-07 the report-run quota — plus the standing
   open records GA shipped with: DR-001 (ZATCA option C — the launch segment
   excludes e-invoicing-requiring taxpayers; certification path per the
   verification gate), DR-002 (payment production cutover), DR-003 (Egypt ETA),
   DR-024-02 (OQ-009 legal review — BLOCKED-EXTERNAL, 90-day working assumption).

Why now: GA shipped with the honest ledger — the internal evidence legs are ALL
GREEN (143 files/2035 tests; the 10× local load harness T-01…T-08 within every
budget; both restore drills PASSED with timings; SLOs/error budgets live with the
seeded-burn proof; the observability audit green; docs-drift battery green), and
the hosted legs carry the standing owner-directive waiver pattern with named
follow-up obligations: **the production-class hosted k6 full-load + the 12 h
staging soak + the recovery-region wall time** (PERFORMANCE_TEST_PLAN §8 —
passing on weaker hardware does not close the hosted gate; re-run before any
production-scale claim is re-quoted), **the external pen-test firm leg** (the
PHASE-024 waiver re-read at the GA checklist), and **the November backup
attestation honestly NOT SIGNED** (first due 2026-12-01 — the first full month
post-GA; the nightly smoke exists as an executable procedure, not 30 calendar
days of scheduled runs).

How (the standing operating rules, now the product's operating system):

1. The maintenance protocols of every governing document own the cadences: test
   plan §14 (new hot queries → the top-10 EXPLAIN list), performance §9
   (historical results never re-quoted without a re-run note), secrets §8
   (rotation drills), chaos §9, compliance matrix §6 (official-source
   monitoring), backup runbook §8 (quarterly cold drills + monthly
   attestations), DR §7 (readiness inventory quarterly).
2. Every new phase intake follows the handoff protocol: read the completion
   report + the consumed-as-is specs first; register intake keys per
   FEATURE_CATALOG §25 BEFORE code (catalog drift: migrations manifest +
   ENTITY_CATALOG + AUTHORIZATION_MATRIX + schema.ts mirror + runtime
   FEATURE_DEPS + check-rls + attack-suite fixtures for every new table).
3. Do not mark a hosted leg green without its hosted evidence (the honest-marker
   discipline: a documented INCOMPLETE beats a fabricated pass — directive
   §1.10–1.11).
4. The staged client channels' crash gates (10/50/100, halt < 98.5%) stay live
   through and after every rollout; error-budget exhaustion pauses feature
   releases (MONITORING §5 — the policy recorded in the GA checklist).
