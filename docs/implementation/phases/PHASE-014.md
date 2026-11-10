# PHASE-014 — Subscription, Billing, Onboarding & Dashboards — MVP

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-014
- **Title:** Subscription, Billing, Onboarding & Dashboards — MVP
- **Objective:** Close the MVP arc: commercialize and polish. Plans and the entitlement
  matrix go end-to-end per
  [../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md);
  the payment-provider adapter ships with a sandbox checkout flow and the **mandatory**
  manual-invoicing fallback (A-009/OQ-003); the subscription lifecycle (trial → active →
  grace read-only → suspended) integrates with the PHASE-004 suspension semantics;
  usage counters implement soft-warn/hard-block limit behaviors that **never block
  posting**; the onboarding wizard UX is completed over the PHASE-004 backend (guided
  first-invoice journey, Journey A); owner/CEO dashboards ship as report-contract-bound
  KPI widgets with drill-down; the billing-critical notifications center lands; an MVP
  security review triages findings (pen-test stays PHASE-024); and a load smoke test
  validates NFR-006 budgets — ending in the **MVP gate** and the v1.0 release checklist
  per [../../planning/RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md).
- **Business value:** A real business can register, onboard, sell, buy, count, close,
  and pay for the product — in Arabic and English — without a human in the loop
  (MASTER_ROADMAP MVP gate). This phase turns 13 phases of engine into a product a
  stranger can buy.

## 2. Scope

In scope:

1. **Plans + entitlement matrix end-to-end** (features `platform.subscriptions`,
   `platform.entitlements` consumption): seed the three self-serve plans (Starter /
   Business / Enterprise) with feature keys exactly per the plan matrix
   ([../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
   §2 — every plan includes the financial core); entitlements re-materialize
   transactionally with subscription changes (`source`: plan / add_on / override /
   trial, `expires_at`), emitting cache-invalidation events to the configuration engine;
   **all prices and numeric limits are PLACEHOLDER values pending
   [OQ-002](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)** — the mechanism is normative,
   the numbers are configuration (RISK-003 mitigation).
2. **Payment provider adapter + sandbox checkout (feature `platform.subscriptions`):**
   adapter port (provider choice is a decision record per
   [OQ-003](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) — RISK-022) with a **sandbox-mode**
   checkout flow (plan select → checkout session → webhook confirmation → subscription
   activation, proration policy per billing rules); **manual invoicing fallback is
   mandatory and ships in the same phase** (A-009): platform staff record an offline
   payment / bank transfer against a subscription invoice in the admin console, and the
   tenant's billing history shows both paths identically. No production provider
   go-live is required at MVP — sandbox + manual must both be operational.
3. **Subscription lifecycle:** `trial → active → grace(read-only) → suspended` per
   §7–§8 of SUBSCRIPTION_AND_ENTITLEMENTS: trial = Business plan entitlements
   materialized like paid ones (no parallel code path); payment failure → dunning steps
   → **read-only grace period** (PLACEHOLDER duration; all users keep read + exports;
   postings fail with typed `subscription_read_only` errors naming the resolving
   action); grace expiry → suspension through the PHASE-004 semantics
   (`tenant.suspended`: sessions invalidated, sync pushes rejected, pulls return
   `tenant_suspended`); restore on payment; every transition audited. Read-only mode is
   a first-class product state — dashboards, reports, exports, and printing continue.
4. **Usage counters + limit behaviors:** counters for documents/month, users, branches,
   warehouses, terminals, devices per §6: **soft warnings at 80% and 100%** (in-app +
   email to owner; dashboard banner with usage-report link) vs **hard blocks only on
   creation actions** (invite user, create branch/warehouse, activate device); the
   documents/month limit **never hard-blocks posting** — per the binding product
   principle: *"Blocking a cash sale because of a billing counter is unacceptable for a
   POS-bearing product; billing pressure uses notifications + billing, not ledger
   locks"*; no limit behavior may affect posted data or reconciliation (INV-022 —
   limits gate new actions only). Counters visible to the owner; overage policy
   PLACEHOLDER per OQ-002.
5. **Marketing site pricing pages:** public bilingual (AR-first RTL) pricing page +
   plan comparison driven by the same plan seed data (single source of truth); prices
   rendered from configuration (PLACEHOLDER pending OQ-002) — no hard-coded numbers in
   the page; checkout entry points per plan; honest feature-matrix rendering from
   FEATURE_CATALOG keys.
6. **Onboarding UX completion** (feature `platform.onboarding`, UX layer): polish the
   PHASE-004 wizard backend into the guided journey (Wizard archetype): activity
   picker → workspace provisioning preview → CoA/numbering confirmation → opening-
   balances-or-skip (banner reminder, never blocking, Journey A5) → **guided first
   invoice** (Journey A steps A6–A9: first item, first customer, first invoice with
   live tax preview, post, and print via the PHASE-013 engine); completion state
   tracked; "skip" always honest and resumable.
7. **Dashboards** (feature `reporting.dashboards`): role-appropriate owner/CEO dashboard
   built ONLY on the PHASE-013 widget-binding seam — `KPIStatCard`/`ChartCard` widgets
   bound to report contracts in `current` freshness mode with pinned parameters; MVP
   widget set: **sales today**, **cash position**, **AR overdue** (aging contract),
   **stock alerts** (low-stock/reorder candidates from inventory queries); clicking a
   widget opens the underlying report with those parameters (widgets are links, not
   parallel implementations — [../../reporting/REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md)
   §12); max 6 tiles per screen per the component catalog.
8. **Notifications center (billing-critical subset):** in-app inbox + preferences for
   the events billing and limits depend on: limit warnings (80%/100%), subscription
   state changes (trial expiring, grace entered, suspended, restored), reconciliation/
   assertion failures (from PHASE-007/013 jobs), and `invoice.overdue`; email adapter
   (live since PHASE-003) for owner-facing notices. The generalized event-driven
   notifications product surface (e.g., `stock.below_reorder` in-app alerting) remains
   PHASE-015 per [../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)
   `platform.notifications` — the split is noted there and in the worklog.
9. **MVP security review (scoped, findings triaged):** per
   [../../security/SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md)
   per-phase gates: dependency audit + SAST on the full MVP codebase, permission-review
   sweep of every route shipped in 001–013, CSP/rate-limit/session config verification
   against [../../security/THREAT_MODEL.md](../../security/THREAT_MODEL.md) scenarios,
   and a triaged findings register (severity, owner, fix-or-defer decision with reasons;
   blockers fixed in-phase). **Scope split (explicit): the external penetration test and
   its remediation are PHASE-024** — this review is the internal gate that makes the MVP
   surface reviewable, not the final hardening.
10. **Load smoke test vs NFR-006:** run the "MVP candidate load" k6 scenario
    ([../../testing/PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md)
    §2 — simulated design-partner day: 20 tenants, business-hours profile, 60/25/15
    document mix) on staging; assert T-01 (document list p95 < 500 ms @ 100k docs),
    T-02 (invoice posting p95 < 300 ms), T-04 interactive report tier, T-06 (login +
    shell p95 < 1.5 s AR+EN), T-07 (< 0.1% 5xx); failures route through the O-1…O-5
    options ladder with a decision record if any target misses.
11. **MVP gate evidence + v1.0 release execution:** assemble the gate checklist (§6),
    run the release quality gates per
    [../../planning/RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md) (CI green
    incl. invariants/isolation/visual AR+EN; migration rehearsal on staging; security
    checklist; performance smoke; documentation freeze), tag `release/v1.0.0` CalVer
    (`v1.26.10.0` format per strategy), and update status files.

Out of scope (explicit):

- Production payment-provider go-live beyond sandbox verification (provider onboarding,
  reconciliation depth) — decision record per OQ-003 when the provider is chosen.
- Industry add-on storefront, plan-change proration analytics, dunning automation
  beyond provider adapter steps (post-MVP billing refinements).
- The generalized in-app notifications product + SMS/push adapters (PHASE-015+).
- Industry templates, POS, configuration-engine template application (PHASE-015+) —
  onboarding applies only the general defaults at MVP (Journey A2's honest banner).
- External penetration testing, MFA-policy hardening, rate-limit tuning beyond config
  verification (PHASE-024).
- Full 10× load (PHASE-025), DR drill beyond the single restore rehearsal (PHASE-025).
- Offline/mobile clients (PHASE-020+).

## 3. Prerequisites

- Required phases: **PHASE-013** COMPLETE — billing needs export/print + the report
  contract for invoices/statements and the dashboard widget seam
  ([../../planning/PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md)
  edge 013→014). Transitive: PHASE-004 (provisioning backend, entitlements service,
  suspension semantics, admin console), PHASE-003 (sessions/audit for suspension
  effects), PHASE-005 (design system + marketing-site-compatible tokens), PHASE-006…012
  (the entire business surface the gate exercises), PHASE-002 (files/jobs).
- Required architecture decisions:
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (tenant status machinery
  the lifecycle drives), [ADR-0011](../../architecture/ADR/ADR-0011-reporting-printing.md)
  (widget seam + print), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)
  (counters jobs, dunning scheduling).
- Relevant documentation:
  [../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  (binding mechanism; §6 limit-behavior table; §10 checkout mechanics),
  [../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (§platform,
  §reporting dashboards),
  [../../product/USER_JOURNEYS.md](../../product/USER_JOURNEYS.md) (Journey A — the
  guided first invoice; Journey H interplay for offboarding grace),
  [../../product/CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md)
  (entitlement → config cache events, BR-039),
  [../../architecture/MULTI_TENANCY.md](../../architecture/MULTI_TENANCY.md) §6
  (suspension semantics),
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  (§3.9/§3.10 subscription + platform keys),
  [../../security/SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md)
  (per-phase gates; PHASE-024 split),
  [../../testing/PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md)
  (MVP candidate scenario),
  [../../planning/RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md),
  [../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) (MVP gate
  definition), [../../operations/BACKUP_RESTORE_RUNBOOK.md](../../operations/BACKUP_RESTORE_RUNBOOK.md)
  (restore rehearsal).

## 4. Design Impact

- **Database changes:** `subscriptions` goes live (entity exists from the catalog; full
   columns: plan_id, status, period, provider_ref, billing events) plus additive
   `usage_counters` rows (tenant, counter_key, period, value — read-model maintained by
   posting/counting jobs); `plans` seeds materialize (global table, platform-managed);
   `notifications` table for the in-app inbox (tenant-scoped, RLS, registry + A-tests).
   No business-table changes; no invariant-relevant schema.
- **API changes:** public: `GET /api/v1/public/plans` (pricing page data);
   tenant-owner: `POST /api/v1/tenancy/subscriptions/change-plan`,
   `GET /tenancy/usage`, `GET /api/v1/notifications` + `PATCH …/{id}/read`,
   preferences endpoints; platform: `POST /api/v1/platform/subscriptions` (checkout
   session), `POST /platform/billing/webhook` (adapter, signature-verified),
   `POST /platform/subscriptions/{id}/manual-payment` (fallback path),
   `POST /platform/subscriptions/{id}/suspend|restore` (audited, existing P-004
   semantics). Read-only-mode enforcement is middleware-level: state-changing routes
   return `403 subscription_read_only` with the resolving action; the entitlement
   middleware gains limit checks (`429/422 limit_exceeded` naming limit + usage) —
   per [../../api/API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) envelopes.
- **UI changes:** marketing site (public pricing pages AR/EN RTL), onboarding wizard
   polish (Wizard archetype), owner dashboard (KPIStatCard grid + drill-down links),
   notifications center (inbox + preferences), billing history + usage screens for the
   owner, admin-console billing extensions (manual payment recording, subscription
   search); read-only mode is a product state (banners explaining, exports/printing
   enabled, action buttons disabled with bilingual reasons) — never an error page.
- **Security & authorization:** new keys seeded per matrix §3.9/§3.10:
   `tenancy.subscription.manage` (owner, billing history/plan changes),
   `platform.subscriptions.manage`, `platform.plans.manage` (platform staff); webhook
   endpoint signature verification + replay protection; manual-payment recording is
   audited `via_platform_admin` with mandatory reason; pricing page is public
   rate-limited (no tenant data); entitlement enforcement remains server-side
   (BR-039) — the pricing page is marketing, not an authority.
- **Accounting implications:** none new — the phase must NOT touch posting rules; the
   load smoke and gate re-run the full invariant + golden suites as release evidence.
   INV-022 is the boundary the limit system itself must respect (tested).
- **Localization implications:** pricing page, plan comparison, onboarding wizard,
   dashboards, notifications, billing history — all bilingual AR/EN with RTL-first
   layout; currency display per tenant/locale; the marketing site is the first
   public-facing RTL surface (visual snapshots both directions).
- **Offline implications:** none active (clients are PHASE-020+); suspension semantics
   documented for future sync (`tenant_suspended` push rejection) and tested at the API
   layer only.
- **Module dependencies:** `tenancy` (plans/subscriptions/entitlements/usage) drives
   `identity` (session invalidation on suspend) and publishes entitlement events to
   `configuration`; `notifications` consumed by tenancy/treasury/reporting jobs;
   dashboards consume `reporting` contracts only; marketing site reads plan seeds
   read-only. No new modules beyond the notifications module activation
   ([../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Plan seeds + entitlement matrix materialization + subscription entity wiring + config cache events | `apps/api/seeds/plans.seed.ts`, `apps/api/src/modules/tenancy/application/subscriptions.ts` | entitlement resolution tests per plan (BR-039/040); re-materialize transactional on change |
| T2 | Payment provider adapter port + sandbox checkout flow + webhook (signature-verified, replay-safe) | `apps/api/src/modules/tenancy/application/billing/**` | sandbox e2e: select → checkout → webhook → active; duplicate/replayed webhook idempotent (INV-013 discipline) |
| T3 | Manual invoicing fallback (admin console recording + billing history parity) | `apps/api/src/modules/tenancy/application/billing/manual.ts`, admin console UI | manual path activates identical entitlements; audited `via_platform_admin`; both paths in one billing history |
| T4 | Subscription lifecycle state machine (trial/active/grace/suspended/restore) + suspension semantics wiring | `apps/api/src/modules/tenancy/application/lifecycle.ts` | transition tests incl. sessions killed on suspend; restore flow; every transition audited |
| T5 | Read-only mode enforcement (middleware typed errors + UI product state) | `apps/api/src/infra/middleware/**`, `apps/web/**` | posting blocked with `subscription_read_only`; reports/exports/print still work; banner honest |
| T6 | Usage counters + limit behaviors (soft warn/hard block matrix; documents/month never blocks posting) | `apps/api/src/modules/tenancy/application/usage.ts` | §6 matrix tests: 80%/100% warnings fire; user/branch/warehouse blocks create; **posting never blocked** (property test); INV-022 respected |
| T7 | Marketing pricing pages from plan seeds (AR/EN, public, rate-limited) | `apps/web/app/{locale}/(marketing)/**` | visual snapshots AR+EN; no hard-coded prices (fixture-driven render test) |
| T8 | Onboarding wizard UX completion + guided first invoice (Journey A) + completion tracking | `apps/web/app/{locale}/onboarding/**` | Playwright bilingual E2E of full Journey A1–A9 incl. print step (A9) |
| T9 | Owner dashboard: KPI widgets bound to report contracts (sales today, cash position, AR overdue, stock alerts) + drill-down | `apps/web/app/{locale}/dashboard/**` | widgets open pinned-parameter reports; data equals contract runs (no parallel math) |
| T10 | Notifications center (in-app inbox + preferences + owner emails) for billing/limit/reconciliation/overdue events | `apps/api/src/modules/notifications/**`, `apps/web/**` | event → inbox row + email fixture tests; unread counts; preferences honored |
| T11 | MVP security review execution + findings register (triage, blockers fixed in-phase) | `docs/security/MVP_SECURITY_REVIEW.md` (report), fixes across repo | dependency-audit/SAST outputs attached; route-permission sweep matrix complete; findings triaged with owners |
| T12 | Load smoke test (MVP candidate scenario) on staging + NFR-006 evidence | `tests/performance/mvp-candidate/**`, staging run artifacts | T-01/T-02/T-04/T-06/T-07 thresholds green; misses → O-ladder decision record |
| T13 | Backup-restore rehearsal (once, staging) per runbook | staging artifacts + `docs/operations/BACKUP_RESTORE_RUNBOOK.md` drill record | restore completes within runbook time; RLS + audit guards intact post-restore (INV-003 test re-run) |
| T14 | MVP gate assembly + release v1.0 execution (quality gates, tags, status/docs freeze) | `docs/implementation/phases/reports/PHASE-014-COMPLETION.md`, release notes | gate checklist §6 fully checked with links to evidence; `release/v1.0.0` tagged |

## 6. Verification

**Automated tests (required):**

- **Entitlement/plan tests:** every plan's feature keys materialize exactly per the
  matrix; add-on closure rule (BR-040) enforced; override grants carry `expires_at`
  (must expire); entitlement changes emit configuration cache events; UI visibility is
  derived-only (server rejects unentitled action even when UI hid it — BR-039).
- **Checkout/billing tests:** sandbox flow end-to-end (plan → session → webhook →
  active subscription + entitlements); webhook signature + replay protection;
  duplicate delivery idempotent; manual payment path produces the same entitlement
  state and billing-history rows; downgrade blocked while usage exceeds target limits
  with the specific blocker named (§8).
- **Lifecycle tests:** trial expiry without payment → read-only grace (postings typed-
  errored, reads/exports fine) → suspension (sessions die; API returns
  `tenant_suspended`); payment during grace → active; admin manual suspension is
  immediate + reason-recorded; restore re-enables; all transitions audited.
- **Limit-behavior tests (the binding matrix):** 80% + 100% warnings (in-app + email);
  hard block on user invite / branch / warehouse / device activation at limit;
  **documents/month: property test that posting NEVER fails due to the counter** at any
  usage level; INV-022 fuzz: flipping plans/entitlements mid-dataset changes no posting
  math (extends the INV-022 suite).
- **Dashboard tests:** each widget's numbers equal the bound contract's run for the
  same pinned parameters (no side-channel math); drill-down opens with parameters
  preserved; widgets fail honestly when the underlying report asserts FAIL.
- **Notifications tests:** billing/limit/reconciliation/overdue events produce inbox
  rows + owner emails; preferences suppress correctly; unread state accurate.
- **Read-only mode tests:** a seeded grace tenant: every state-changing route returns
  `subscription_read_only` with resolving-action detail; report/export/print routes
  succeed; UI shows the product-state banner.
- **Security review evidence:** dependency audit + SAST outputs (0 criticals or
  triaged-with-reason); route-permission sweep covers 100% of shipped routes
  (drift-check green); THREAT_MODEL scenario spot-checks (S-01…S-13 applicable subset)
  re-run green.
- **Performance evidence:** MVP-candidate k6 run meets T-01/T-02/T-04/T-06/T-07 on
  staging; report includes the pass/fail template from
  [../../testing/PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md) §9.
- **Release regression:** full CI green (invariants INV-001…022, golden G-01…G-20,
  isolation A1–A11 + spoofing, visual AR+EN, E2E bilingual).

**Manual verification:**

1. Register a fresh tenant via the public site (AR): complete the wizard, post the
   guided first invoice, print it — Journey A1–A9 unassisted (the gate's human proof).
2. Buy the Business plan via sandbox checkout; then simulate payment failure → observe
   grace read-only behavior (post blocked with clear bilingual reason; dashboards/
   exports live) → pay via the manual fallback in the admin console → observe restore.
3. Push a Starter tenant to its user limit: warning at 80%, invite blocked at 100%,
   posting unaffected throughout.
4. Open the owner dashboard in both locales; click each widget through to its report.
5. Review the MVP security findings register with the security owner; confirm blockers
   are fixed and deferrals have reasons + tickets.

**Acceptance criteria (objective):**

1. Plans/entitlements/subscription lifecycle operate end-to-end per
   SUBSCRIPTION_AND_ENTITLEMENTS with every numeric limit/pricing value marked
   PLACEHOLDER (OQ-002) in seeds and rendered from configuration only.
2. Sandbox checkout AND manual invoicing fallback are both operational and produce
   identical entitlement/billing-history outcomes (A-009 satisfied).
3. Limit behaviors match the §6 matrix exactly; posting is never blocked by any limit
   (property-proven); INV-022 holds under entitlement fuzzing.
4. Read-only grace and suspension are first-class states with typed errors and full
   read/export/print capability in grace; suspension follows PHASE-004 semantics.
5. Journey A (register → onboard → first invoice → print) completes in AR and EN in a
   single unassisted run (E2E + manual evidence).
6. Dashboards render only widget-bound contract data with working drill-downs; the
   notifications center delivers the billing-critical event set.
7. MVP security review complete with triaged findings (blockers fixed); the PHASE-024
   pen-test scope split is documented in the review.
8. MVP-candidate load smoke meets NFR-006 budgets (T-01/02/04/06/07) with evidence.
9. Backup-restore rehearsal completed once in staging with post-restore invariant
   checks green (RISK-018 first drill).
10. Release v1.0 executed per RELEASE_STRATEGY quality gates: CI green, migration
    rehearsal done, security checklist, perf smoke, documentation freeze, tags.
11. Acceptance rows mirrored in
    [../../planning/PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
    (PHASE-014 row) once that file lands.

**MVP gate checklist (release-blocking — from
[../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) MVP gate; every
box requires linked evidence in the completion report):**

- [ ] **End-to-end business journey works in Arabic and English**: register → onboard →
      configure CoA → record opening balances → buy (PO→GRN→invoice) → sell
      (order→delivery→invoice→receipt) → count stock → close a period → print financial
      statements + VAT return — executed on a fresh staging tenant in AR, re-key-checks
      in EN (Journey A + C + D + E transcripts).
- [ ] **All accounting invariants green**: INV-001…INV-022 suite output attached, zero
      failures (any failure is Sev-1, RISK-009).
- [ ] **Tenant isolation suite green**: A1–A11 + API spoofing + signed-URL scope
      tests; RLS denial counter at 0 in staging traffic.
- [ ] **Backups configured and a restore rehearsed once in staging** (drill record with
      timings; post-restore INV-003/RLS checks green — RISK-018).
- [ ] **Subscription billing operational, both paths**: sandbox provider checkout AND
      manual invoicing fallback (A-009); downgrade blocks while usage exceeds limits;
      grace/suspension/restore demonstrated.
- [ ] **Security review of the MVP surface complete** (findings triaged; blockers
      fixed; PHASE-024 pen-test explicitly out of this gate's scope).
- [ ] **Load smoke vs NFR-006 green** (T-01/T-02/T-04/T-06/T-07).
- [ ] **Docs/status updated**: IMPLEMENTATION_STATUS shows 001–014 COMPLETE with
      reports; CHANGELOG + release notes; docs validation green.

**Performance & security considerations:** the gate IS the performance/security
evidence bundle; no phase may trade an NFR-006 miss for schedule — misses go through
the options ladder with decision records. Webhook security (signatures, replay,
least-privilege secrets per
[../../security/SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md)); public
pricing pages rate-limited and tenant-data-free; admin billing actions audited.

**Migration & rollback:** additive migrations only (subscriptions columns live,
usage_counters, notifications). Dev rollback = revert + drop; production forward-only
per [../../database/MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md). A
release rollback follows RELEASE_STRATEGY §Rollback (feature flags + entitlement
gating, not data rollback); posted data is untouchable in every path.

## 7. Risks and Constraints

- RISK-022 (provider choice blocks billing): mandatory manual fallback + adapter port
  are the mitigation — both paths ship or the phase does not complete.
- RISK-003 (pricing model wrong, OQ-002): all numbers are PLACEHOLDER configuration;
  the entitlement engine is decoupled from plan data — changing numbers later is a
  seed change, not a code change.
- RISK-001 (MVP scope): this phase's out-of-scope list is enforced hard — POS, industry
  templates, and pen-test pull-forwards all require decision records.
- RISK-014 (performance collapse): the load smoke is a gate, not a report — misses
  escalate via O-1…O-5 with decision records.
- RISK-018 (untested restores): the staging rehearsal is the first drill; the runbook
  must be cold-runnable by a second engineer.
- RISK-019/RISK-020 (agent drift/docs drift): the gate requires the evidence bundle +
  docs freeze; the completion report links every checklist box.
- Constraint: no limit behavior, plan, or entitlement may touch posting math or any
  invariant (INV-022) — enforced by the fuzz suite, not by review alone.
- Constraint: pricing numbers are NOT to be invented to "finish" the phase — the
  PLACEHOLDER discipline is part of the gate (OQ-002 is open).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-014-COMPLETION.md` containing the **MVP gate
  checklist with every box linked to evidence**: journey transcripts (AR+EN), invariant
  suite output, isolation suite output, restore drill record, both billing-path
  walkthroughs, security findings register, load-smoke report, docs-freeze proof, and
  the `release/v1.0.0` tag. This report doubles as the MVP release record.
- **Documentation updates required:** IMPLEMENTATION_STATUS (PHASE-014 → COMPLETE; MVP
  RELEASE noted), CHANGELOG + release notes,
  [../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  (mark delivered mechanics; keep OQ-002 placeholders), FEATURE_CATALOG phase notes if
  the notifications split (014 billing-critical / 015 generalized) is recorded,
  RELEASE_STRATEGY execution log.
- **Exit criteria:** MVP gate checklist fully green with evidence; release v1.0 tagged
  per RELEASE_STRATEGY; all 001–014 completion reports present; zero open gate
  blockers.
- **Definition of Done:** a stranger can register, onboard, run their business
  (buy/sell/count/close/print), and pay — in Arabic or English — on the released v1.0,
  with invariants, isolation, restore, billing, security review, and load evidence
  archived in the completion report.
- **Handoff instructions:** next agent reads the PHASE-014 completion report (MVP
  release record) and the open items register (OQ-002 pricing, OQ-003 provider,
  deferred notifications surface, security deferrals with tickets).
  **Next eligible phase: PHASE-015 — Industry Framework & Priority Templates**
  (identify only; do not implement).
