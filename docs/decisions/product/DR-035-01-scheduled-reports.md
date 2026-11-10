# DR-035-01 — Scheduled reports: DEFERRED to PHASE-057 (grant key preserved)

> **Status:** ACCEPTED (decision: DEFER to PHASE-057; the PHASE-025-era "delivered"
> classification is RETRACTED) · **Owner:** Product Owner · **Updated:** 2026-11-10 ·
> **Date:** 2026-11-10 (opened + decided in-phase, PHASE-035 T-07) ·
> **Approver:** Product Owner ·
> **Source:** [PHASE-035](../../implementation/phases/PHASE-035.md) §2 item 6 (the
> silent-deviation resolution slot) ·
> **Related:** audit
> [§5.2 F-7](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) ("the most
> significant silent deviation"), [PHASE-057](../../implementation/phases/PHASE-057.md)
> (BI & Analytics), [REPORT_CATALOG §14](../../reporting/REPORT_CATALOG.md),
> [PERFORMANCE_TEST_PLAN §8](../../testing/PERFORMANCE_TEST_PLAN.md) (O-1),
> [SUBSCRIPTION_AND_ENTITLEMENTS §2](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)

## Context

`reporting.scheduled_reports` (التقارير المجدولة — scheduled generation + email
delivery) is documented as a priority-3 feature with phase column `025` in
[FEATURE_CATALOG §12](../../product/FEATURE_CATALOG.md),
[SCOPE_AND_NON_GOALS](../../SCOPE_AND_NON_GOALS.md) listed it as a deliberate deferral
that "must be completed by PHASE-025", and
[SUBSCRIPTION_AND_ENTITLEMENTS §2](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
grants the key to the **enterprise** plan only. Read together, the docs claimed a
delivered PHASE-025 feature.

The 2026-11-10 audit (§5.2 **F-7** — "the most significant silent deviation" it found)
found **no code**: no `report_schedules` table, no scheduler service, no API route,
no scheduling field on `report_runs` — and the granted key has **no consumer**. Grep
at record time confirms it: the only occurrences of `reporting.scheduled_reports` in
`apps/` are the dependency map in
`configuration/domain/feature-catalog.ts`, the 0008 plan seed
(`0008_platform_seeds.sql`, the enterprise grant), and test fixtures mirroring that
seed — bookkeeping, not behavior. Nothing schedules, runs, or delivers anything.

What was always honest: [REPORT_CATALOG §14](../../reporting/REPORT_CATALOG.md) speaks
seam-language ("Subscriptions (post-MVP seam): scheduled runs land through the pg-boss
schedule + notification email adapter described in PRINTING_AND_EXPORT §7; contracts
need no changes") — no retraction needed there; the seam statement stays true.

## Options

| Option | Consequences |
|--------|--------------|
| **A. Ship a minimal scheduler inside PHASE-035** | Closes F-7 with code, but grows the truth-restoration phase (whose §2 explicitly scopes it out: "scheduled-reports implementation (057)"); a rushed scheduler competes with PHASE-057's governed scheduling/alerting design and duplicates it |
| **B. DEFER to PHASE-057; preserve the enterprise grant key; retract the delivered claim** | The documentation matches the code the same day; PHASE-057 (BI & Analytics — report alerts, subscriptions, KPI engine) gets the scheduling surfaces with their natural owning phase; the entitlement contract is untouched |
| **C. Remove the key from the enterprise plan** | Would make the docs "consistent" by breaking the entitlement contract: removing a granted key is a breaking plan change (the additive-activation discipline — grants may grow, never silently shrink), and PHASE-057 would have to re-add it |

## Decision

**Option B.** `reporting.scheduled_reports` is re-classified **DEFERRED-to-PHASE-057**
(BI & Analytics). The PHASE-025-era "delivered" classification is **RETRACTED**. The
enterprise-plan grant key is **PRESERVED** exactly as seeded: removing it would be a
breaking entitlement change, and PHASE-057 implements the consumer the key awaits.

## Consequences

- [FEATURE_CATALOG §12](../../product/FEATURE_CATALOG.md) row corrected: phase column
  `025` → `057 (DEFERRED — DR-035-01, linked)`; priority stays 3.
- [SUBSCRIPTION_AND_ENTITLEMENTS §2](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  enterprise column annotated: the key is kept, its consumer ships with PHASE-057.
- [PERFORMANCE_TEST_PLAN §8](../../testing/PERFORMANCE_TEST_PLAN.md) option **O-1**
  ("feature flags disable/reduce: scheduled reports, bulk exports, non-essential
  dashboard widgets") is a **no-op for scheduled reports until 057**: grep at record
  time finds no scheduled-reports flag anywhere — the only flag surfaces in the code
  are the L8 platform `feature_flags` table (migration 0022, platform-delivery-only)
  and the per-tenant e-invoicing adapter rollout flags (migration 0035). The O-1 row
  stays (the options ladder is generic); its scheduled-reports example must not be
  read as an existing, flippable flag until PHASE-057 ships the scheduler.
- **PHASE-057 intake must register the scheduling surfaces against this record** —
  the schedule store, scheduler/delivery jobs, and the `reporting.schedule.manage`
  permission consumer — and its acceptance criteria reference DR-035-01.

## References

- [PHASE-035](../../implementation/phases/PHASE-035.md) §2 item 6 — the
  silent-deviation resolution scope this record executes.
- [PHASE-057](../../implementation/phases/PHASE-057.md) — BI & Analytics, the owning
  phase for the scheduler and its consumer.
- Audit [§5.2 F-7](../../planning/gap-analysis/PROJECT_EVALUATION_2026-11-10.md) —
  the finding this record resolves.
- [REPORT_CATALOG §14](../../reporting/REPORT_CATALOG.md) — the already-honest seam
  language (no change required).
