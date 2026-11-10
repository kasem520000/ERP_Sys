# DR-P25-07 — Per-Tenant Report-Run Quota (the MULTI_TENANCY §5 gap PERF-A surfaced)

> **Status:** PROPOSED (post-GA decision slot — PHASE-025 T14; the mechanism decision
> for the quota gap the GA load work surfaced) · **Date:** 2026-11-06 (opened) ·
> **Approver:** Architecture Owner (platform-fairness mechanism) with Platform
> Operations (the enforcement posture) · **Source:** the PHASE-025 T4b report-hammer
> finding — [MULTI_TENANCY.md](../../architecture/MULTI_TENANCY.md) §5 specifies
> "report job concurrency quotas" as an MVP fairness measure; **no per-tenant
> report-run quota/concurrency cap exists at GA** · **Related:**
> [PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md) §2 (the
> report-hammer scenario) + §8 (the O-2 dedicated-worker-pools option this record
> composes with), [ADR-0011](../../architecture/ADR/ADR-0011-reporting-printing.md)
> (worker isolation / the execution-class split), RISK-013 (render pool),
> SF-024-001/[security-findings.md](../../operations/security-findings.md) (the R-04
> per-tenant API burst limiter — the closest precedent),
> [GA-RELEASE-CHECKLIST.md](../../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
> open GA note A

## Context

The GA report-hammer run (`report-hammer.db.spec.ts`) proved what the platform **can**
prove today: under the large tenant's heaviest concurrent report load (trial-balance
COMPUTE at the 100k-document scale, every run a fresh compute), a small tenant's
interactive report compute + document reads stay within their own budgets —
**noisy-neighbor isolation holds**. What it honestly could not prove is *quota
enforcement*, because the quota does not exist: MULTI_TENANCY §5 lists "report job
concurrency quotas" among the MVP fairness measures, but the implemented fairness
mechanisms are (a) the R-04 per-tenant API burst window (bounds all authenticated
requests incl. report-runs; 429-before-collapse proven in the spike scenario), (b) the
**global** Chromium render-pool semaphore (RISK-013 — render concurrency, not a
per-tenant report-run budget), and (c) the ADR-0011 execution-class split (heavy
renders go to the pg-boss job path). PHASE-025 is tuning-only (§4: no new features),
so the quota lands as this decision record — the open GA note in the release checklist
points here.

## Options (sketch)

| Option | Mechanism | Consequences |
|--------|-----------|--------------|
| **A. Per-tenant concurrent report-run cap** | Count in-flight runs per tenant (interactive + job classes counted separately or together — to decide); over-cap ⇒ 429/queue with a typed rejection | Direct match to the §5 wording; needs the cap source (flat vs plan-tiered — SUBSCRIPTION_AND_ENTITLEMENTS interaction) + class semantics (does a 15-min heavy job occupy the same slot as an interactive run?) |
| **B. Per-tenant rolling report-run budget** | N runs/hour (or/day) per tenant, plan-tiered; over-budget ⇒ typed rejection with reset time | Bounds sustained abuse, not just concurrency; heavier UX question (a legitimate month-end burst hitting a daily cap is a support ticket) |
| **C. Status quo, documented** | R-04 API window + global render semaphore + execution-class split | Already proven to isolate at GA volumes; the §5 wording stays unimplemented — the gap remains an honest open note rather than closing |
| **D. O-2 dedicated worker pools per class** | Pools isolate heavy renders from interactive work fleet-wide | Composes with A/B (it is the §8 options-ladder mechanism, not a per-tenant quota); cost item |

## Recommendation (lean)

**A** (concurrency cap, plan-tiered, interactive and job classes counted separately) as
the quota proper, with **D** available through the existing §8 ladder if worker
pressure ever warrants — the R-04 limiter is the enforcement-pattern precedent
(429 + Retry-After, isolation-tested).

## Decision

**NOT YET MADE — this record is the owning slot.** Nothing about the shipped fairness
posture changes at GA: isolation is proven; the quota is the fairness *mechanism*
MULTI_TENANCY §5 names, and this record owns deciding it.

## Consequences

- Until decided: the GA checklist's open note A governs (isolation proven, quota open);
  MULTI_TENANCY §5's wording stays the specification this record resolves.
- When decided: implementation lands as a normal post-GA change (it will need its own
  tests — the A/B tenant-pair pattern from R-04 — and plan-tier wiring if tiered);
  update MULTI_TENANCY §5, SUBSCRIPTION_AND_ENTITLEMENTS (if tiered), the report-hammer
  scenario to assert enforcement, and `CHANGELOG.md` per the decision process
  ([../README.md](../README.md) §4).
- **Trigger:** the first noisy-neighbor incident on report runs, OR the first
  hosting/scale-out step (more tenants per node makes the fairness mechanism load-bearing),
  OR the post-GA review choosing to close the §5 gap proactively. **Owner:** platform
  architecture (mechanism) + platform operations (enforcement posture).

## Approval requirements

- Architecture-owner approval + operations counter-sign; evidence attached: the GA
  report-hammer isolation numbers (the baseline this decision improves on) + the chosen
  cap source (flat vs plan-tiered) with its SUBSCRIPTION_AND_ENTITLEMENTS impact.
