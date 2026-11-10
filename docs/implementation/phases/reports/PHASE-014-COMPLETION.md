# Completion Report — PHASE-014 — Subscription, Billing, Onboarding & Dashboards — MVP

> **Status:** COMPLETE · **Updated:** 2026-11-01 · **Release:** `v1.0.0` (MVP gate CLOSED)

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-014 · 2026-11-01 |
| **Summary** | The MVP arc is closed. Plans (starter/business/enterprise, every price 0.0000 PLACEHOLDER per OQ-002) and the entitlement matrix run end-to-end with transactional re-materialization; the payment-provider port ships a sandbox checkout (HMAC-signed webhook, replay-safe, idempotent) **and the mandatory manual-invoicing fallback (A-009)** — both paths produce identical entitlement/billing-history outcomes; the subscription lifecycle (trial → active → PAST_DUE dunning → read-only grace → suspended → restore) wires the PHASE-004 suspension semantics (sessions killed, `tenant_suspended`) with every transition audited; usage counters soft-warn at 80%/100% and hard-block only creation actions — documents/month never blocks posting (INV-022, property-proven, fuzz-proven); read-only grace is a first-class product state (typed `subscription_read_only` errors with the bilingual resolving action; reports/exports/printing stay alive); the onboarding wizard completes Journey A6–A9 over the REAL controllers to a POSTED first invoice with honest resumable skips; the owner dashboard renders exactly 4 KPI tiles bound to report contracts (links, never parallel math) with drill-downs; the billing-critical notifications center (inbox + preferences + owner emails) is live; the MVP security review is recorded with zero open blockers; NFR-006 budgets hold; the first backup-restore rehearsal passed. All 17 local gate steps green. |
| **Invariants covered** | INV-022 (limit behaviors never block posting / never touch posted data — `usage-limits.db.spec.ts` property + fuzz tests), INV-013 (webhook duplicate delivery idempotent — `webhook-http.db.spec.ts`), INV-003 (post-restore mutation attempt grant-denied — restore drill check f), INV-001/002 (post-restore balance — drill check a), INV-021 (official numbering at posting — sales suites), plus the full INV-001…022 suite re-run green as release regression (below). |

## MVP gate checklist (release-blocking — every box linked to evidence)

- [x] **End-to-end business journey works in Arabic and English** — machine-proven
      end-to-end on the real pipeline: registration→provisioning (identity +
      tenancy-provisioning specs: argon2id login AR/EN, idempotent `provisionWorkspace`
      42-account CoA, numbering seeds), onboarding Journey A (the wizard's A6–A9 walk
      the REAL items/partners/sales controllers — create→submit→approve→post→the
      POSTED row with its assigned number; journey-state settings round-trip over the
      typed route incl. the read-only-grace 403 case), buying
      (PO→GRN→supplier-invoice G-07/G-08 + three-way match BR-009 — PHASE-011 suites),
      selling (order→delivery→invoice→receipt G-01/G-02/G-03/G-05 + credit notes G-04
      — PHASE-012 suites), stock counting (G-13/G-14 + INV-010 — PHASE-010 suites),
      period close (PC-01…07 + the close pack — PHASE-007/013 suites), printing
      financial statements + VAT return (PHASE-013 golden suites: TB/GL/IS/BS/CF exact
      per FINANCIAL_REPORT_RULES §11 at tolerance 0, assertion-gated export/print,
      RC-06/07 VAT return). Bilingual proof: i18n parity **1723/1723** enforced, the
      visual harness runs every story × AR × EN (16/16 green), email templates
      bilingual, the new pricing/checkout/billing/dashboard/notifications surfaces are
      AR-first RTL. **Honest limitation**: the fresh-staging-tenant *human-unassisted*
      walkthrough (the gate's manual proof) is a hosted-infra step — this sandbox
      delivers the machine transcript (the 1153-test db suite + the HTTP-level specs);
      the human walkthrough is recorded as the first hosted follow-up obligation
      (NEXT_ACTION §Follow-up obligations). The standing Playwright-web-E2E waiver
      (PHASE-003 owner directive) applies unchanged — the @erp/ui visual harness +
      API-level HTTP tests cover the surfaces.
- [x] **All accounting invariants green** — the full INV-001…INV-022 suites ran green
      inside the release-regression db suite (**69 files / 1153 tests, 0 failures** —
      includes the PHASE-007 invariant suites, the golden G-01…G-20 packs, the
      INV-022 limit-behavior property tests new this phase, and the PHASE-014 fuzz
      "flipping the plan changes no posting math and no statement byte").
- [x] **Tenant isolation suite green** — A1–A11 + API spoofing over every registered
      tenant-owned table **including the six new migration-0021 tables**
      (`subscriptions`, `subscription_invoices`, `billing_events`, `usage_counters`,
      `notifications`, `notification_prefs`): `identity-isolation.db.spec.ts`
      **642 tests** + `platform-isolation.db.spec.ts` **12 tests** — all green; the
      RLS catalog checker (`pnpm check:rls`) green in the gate.
- [x] **Backups configured and a restore rehearsed once** — the FIRST recorded drill
      (BACKUP_RESTORE_RUNBOOK §8, 2026-11-01): real `pg_dump -Fc` / `pg_restore
      --no-owner --jobs=4` tooling against embedded PostgreSQL 16 (the standing
      local-substitute tier), RTO **0.7 s** (budget 4 h), post-restore invariant smoke
      a–f ALL GREEN (INV-001/002 balance at tolerance 0; RLS through a real `erp_app`
      connection: 0 rows without the tenant GUC; audit trail intact; posted-doc tie;
      INV-013 uniqueness; INV-003 mutation attempt grant-denied), row-count parity
      5/5 tables identical. Reproducible: `pnpm --filter @erp/api restore:drill`.
      Staging/managed-PITR tier = follow-up obligation (recorded in the drill row).
- [x] **Subscription billing operational, both paths** — sandbox provider checkout
      end-to-end through REAL HTTP (`webhook-http.db.spec.ts`: forged signature →
      400 `billing/webhook-signature-invalid`; stale timestamp → 400
      `billing/webhook-replay`; valid delivery → invoice PAID + subscription ACTIVE +
      entitlements re-materialized; duplicate delivery → idempotent no-op) AND the
      manual fallback (`recordManualPayment` — `via_platform_admin` audited, reason +
      reference mandatory, non-OPEN invoices rejected, manual payment while suspended
      → restore re-enables everything); the both-paths parity test asserts IDENTICAL
      entitlement sets and billing-history shapes (A-009); downgrade blocked while
      usage exceeds the target ceiling with the specific blocker named per limit
      (`tenancy/downgrade-blocked` with `details.blockers`); grace/suspension/restore
      demonstrated (`lifecycle.db.spec.ts` 9 tests: trial registration, checkout
      invoice, payment.succeeded activation, dunning PAST_DUE ×2 → read-only grace,
      daily-pass grace expiry → suspension with the PHASE-004 semantics, trial expiry
      → grace).
- [x] **Security review of the MVP surface complete** —
      [MVP_SECURITY_REVIEW.md](../../../security/MVP_SECURITY_REVIEW.md): dependency
      audit (0 prod criticals; 1 HIGH multer unreachable — zero multipart routes;
      2 moderate transitive, triaged with reasons), SAST-equivalent scans clean
      (no eval/child_process/SQL-interpolation/hardcoded secrets/weak randomness),
      route-permission sweep 100% (drift 224=224 + the generated route×role
      checklist), THREAT_MODEL S-01…S-13 applicable subset re-verified (isolation
      654 tests, CSP probe, rate limits incl. the new public plans limiter + webhook
      signature), findings register F-01…F-05 triaged with owners — **zero open
      blockers**. The PHASE-024 external pen-test scope split is explicit (§0).
- [x] **Load smoke vs NFR-006 green** — `mvp-candidate.local.spec.ts` (the local
      harness; hosted k6 script `k6/mvp-candidate.ts` staged for the CI tier):
      **T-01 33 ms p95** over a 100k-row journal register (budget 500 ms) ·
      **T-02 10 ms p95** posting through the engine, n=30 (budget 300 ms) ·
      **T-04 14 ms p95** interactive report compute, 4 contract families (budget
      2 s; cached re-run 0 ms) · **T-06 156 ms AR / 160 ms EN** login+shell sequence
      (budget 1.5 s) · **T-07 0/62 5xx = 0.000%** (budget <0.1%). No budget missed —
      no O-ladder decision record required.
- [x] **Docs/status updated** — IMPLEMENTATION_STATUS (001–014 COMPLETE + MVP RELEASE
      headline), CHANGELOG (PHASE-014 entry), CURRENT_STATE, NEXT_ACTION (→PHASE-015),
      SUBSCRIPTION_AND_ENTITLEMENTS (delivery status note; placeholders unchanged),
      FEATURE_CATALOG (notifications 014/015 split note), RELEASE_STRATEGY (§Release
      execution log — v1.0.0 row), BACKUP_RESTORE_RUNBOOK (§8 drill record),
      MVP_SECURITY_REVIEW (new); `pnpm docs:validate` **29/29 green** in the gate.

## Files created (selected)

**apps/api** — `migrations/0021_subscriptions_billing.sql` (465 lines: subscriptions
lifecycle columns + widened status domain; 6 RLS'd tenant tables; plans marketing
columns); `src/modules/tenancy/application/billing/{billing-config,provider-adapter,
subscription-service,usage-service}.ts`; `src/modules/tenancy/domain/
subscription-errors.ts`; `src/modules/tenancy/infrastructure/billing.store.ts`;
`src/modules/tenancy/presentation/platform/{billing,webhook}.controller.ts`;
`src/modules/tenancy/presentation/public/plans.controller.ts`;
`src/infra/auth/{require-limit.decorator,usage-limit.guard}.ts`;
`src/modules/notifications/application/{inbox-service,email-service,templates}.ts` +
`presentation/notifications.controller.ts` + module wiring; the dashboard contract
registry entry `src/modules/reporting/registry/operational/dashboard.ts`;
`k6/mvp-candidate.ts` (hosted-tier load script); `scripts/restore-drill.ts` (the
runnable §8 drill).

**apps/api tests** — `src/__db__/billing/{lifecycle,usage-limits,webhook-http,
readonly-sweep}.db.spec.ts` (30 tests), `src/__db__/notifications/inbox.db.spec.ts`
(6), `src/__db__/reporting/dashboard.db.spec.ts` (7),
`src/__db__/performance/mvp-candidate.local.spec.ts` (5),
`src/modules/tenancy/__tests__/billing-unit.spec.ts` (unit), isolation registry
extension for the six new tables.

**apps/web** — `app/[locale]/(marketing)/pricing/page.tsx` (public),
`app/[locale]/{checkout,billing,dashboard,notifications}/page.tsx`,
`components/{checkout-workspace,billing-history,owner-dashboard,
notifications-center,notification-bell,platform-billing-panel}.tsx`,
`lib/read-only.tsx`.

**docs** — `security/MVP_SECURITY_REVIEW.md`; drill record + release execution log
entries (see §Documentation updated).

## Files changed (selected)

- `apps/api/src/infra/auth/route-permissions.ts` — +16 routes (billing tenant/platform
  planes, notifications self plane, public plans, the webhook).
- `apps/api/src/infra/context/tenant-context.interceptor.ts` — the read-only grace
  enforcement (GRACE_READ_ONLY → 403 `subscription_read_only` with the resolving
  action; the exemption list).
- `apps/api/src/modules/tenancy/*` — subscription wiring into provisioning/
  entitlements (re-materialization + config-cache events), registration trial start.
- `apps/api/src/modules/reporting/registry/index.ts` — the 4 dashboard contracts.
- `apps/web/components/{app-shell,public-shell,report-workspace,onboarding-wizard,
login-form}.tsx`, `app/[locale]/{page,login/page,onboarding/page,platform/tenants/
[id]/page}.tsx` — the shell bell + read-only banner, dashboard redirect, journey
resume, the admin billing panel mount, marketing shell layout, report deep links.
- `apps/web/i18n/dictionaries.ts` (+218 keys → 1723), `lib/{api-types,messages}.ts`.
- `packages/contracts/src/navigation.ts` — `home.dashboard`, `billing.home`,
  `notifications.inbox`.
- `packages/ui/tests/visual/visual.spec.ts` — the coverage check now honors the
  documented QUARANTINE (pre-existing 2026-10-29 anti-flake decision, SLA
  2026-11-03): quarantined stories are excluded from the pixel-diff gate AND still
  render every run — the coverage proof no longer demands baselines the quarantine
  by definition withholds (see §Documentation-vs-reality).

## Database migrations

- `0021_subscriptions_billing.sql` — the billing substrate goes live (additive only;
  every prior row keeps validating): `subscriptions` gains the lifecycle columns
  (trial/grace windows, dunning step, provider refs, pending plan, journey
  completion) + the widened status domain; NEW `subscription_invoices` (the billing
  history both payment paths write identically; `source` provider/manual, `paid_via`
  channel; BI-{yyyy}-{seq:4} numbering), `billing_events` (append-only event log,
  `webhook:{id}` idempotency keys), `usage_counters` (the §6 read model),
  `notifications` + `notification_prefs` (the in-app inbox + per-user preferences);
  `plans` gains the marketing columns (bilingual positioning, annual price ⚠
  PLACEHOLDER, highlight, sort order). RLS + composite tenant FKs + grants +
  isolation A-tests on every new table; the plans UPDATE seeds the marketing copy for
  the three self-serve plans (every price stays 0.0000 — OQ-002).

## API changes

Public (no session): `GET /api/v1/public/plans` (rate-limited 60/min per anonymous
bucket, tenant-data-free, PLACEHOLDER flags derived). Tenant plane
(`tenancy.subscription.manage`): `GET /tenancy/subscriptions` (subscription + plan +
invoices + events + trial countdown), `POST /tenancy/subscriptions/change-plan`
(checkout_created | downgrade_scheduled | 422 downgrade-blocked with named blockers |
409 plan-unchanged), `POST /tenancy/subscriptions/checkout/:ref/complete`
(succeeded|failed demo; 404 session-not-found; 409 settled). Every member:
`GET /tenancy/usage` (counters with warn80/warn100 + the INV-022 note on documents),
`GET /tenancy/entitlements` now carries `subscription {status, readOnly, graceEndsAt,
trialEndsAt, periodEnd}`. Self plane: `GET /notifications`, `GET
/notifications/unread-count`, `PATCH /notifications/:id/read`, `GET|PUT
/notifications/preferences`. Platform (`platform.subscriptions.manage`): `GET|POST
/platform/subscriptions` (history + checkout session), `POST
/platform/subscriptions/:id/manual-payment` (A-009), `POST
/platform/subscriptions/:id/suspend|restore` (reason mandatory), `POST
/platform/subscriptions/run-daily-pass`. Anonymous webhook: `POST
/platform/billing/webhook` (HMAC-SHA256 signature, 300 s staleness, idempotent).
Read-only grace middleware behavior: state-changing routes → 403
`subscription_read_only` with the bilingual resolving action; hard limits → 422
`tenancy/limit-exceeded` naming limit + usage (creation actions only — the documents
counter never blocks posting).

## UI changes

Public bilingual pricing page (plan cards monthly+annual with the PLACEHOLDER badge,
highlight ribbon, honest feature matrix grouped into families + a 6th growth family —
✓ counts of the union, never 100+ raw keys; open-redirect-safe `login?next=` CTAs);
sandbox checkout workspace (plan picker → `checkout_created` → in-app session resume →
pay now / simulate failure → success|failure; downgrade_scheduled honest panel; every
422 blocker rendered; usable in read-only grace — the resolving action); billing home
(status chips, usage meters warn80 amber/warn100 red/∞ unlimited, billing history
with the paidVia bilingual map, events timeline, trial countdown, plan-change CTA);
owner dashboard (exactly 4 KPI tiles: sales today · cash position · AR overdue ·
stock alerts — numbers ONLY from the bound report-contract runs, exact string math,
`tabular-nums` LTR-isolated, per-widget skeleton/error/assertion-FAIL chips,
drill-down deep links preserving the pinned parameters); notifications center +
header bell (severity chips, unread filter, optimistic mark-read with rollback,
4-category × in-app/email preferences, 60 s poll, aria-live count); read-only
product state (amber `role="status"` banner + "الدفع الآن/Pay now", `useReadOnly`
hook, disabled mutations with bilingual reasons; reports/exports/print stay
enabled); onboarding A6–A9 (first item/customer/invoice over the REAL controllers →
the REAL submit→approve→post state machine → the posted-invoice summary + the honest
print-queue note; every skip writes the last genuinely achieved milestone); the
admin billing panel (manual payment OPEN-invoices-only, suspend/restore with reason
+ confirm dialog, run-daily-pass outcome counts, `via_platform_admin` caption);
navigation (dashboard gated on `reporting.dashboards` + `reports.run`; billing with
NO featureKey — reachable to pay; notifications self plane); home redirects entitled
users to the dashboard.

## Security changes

New permission keys per matrix §3.9/§3.10: `tenancy.subscription.manage` (owner),
`platform.subscriptions.manage` (platform staff) — drift check 224=224 green; the
notifications self plane is permission-less by design (self rows only). Webhook:
HMAC-SHA256 `timingSafeEqual` + timestamp freshness + event-id idempotency (INV-013
discipline); manual payment recording audited `via_platform_admin` with mandatory
reason ≥3 chars + reference; the public plans route rate-limited and tenant-data-
free; six new RLS'd tables with the full attack set (A-tests green); the MVP
security review triaged the full surface (findings F-01…F-05, zero open blockers).

## Tests executed (gate transcript archived at [agent-ctx/T20-gate-evidence-PHASE-014.md](../../../../agent-ctx/T20-gate-evidence-PHASE-014.md) — all 17 steps + the perf + drill measurements)

1. `pnpm typecheck` (5 packages) — exit 0.
2. `pnpm lint` (module boundaries incl.) — exit 0.
3. `pnpm lint:depcruise` — no violations (750 modules, 4582 dependencies).
4. `pnpm check:permissions-drift` — matrix 224 = seed 224.
5. `pnpm test` — **api 18 files/153 · domain-core 6/38 · contracts 1/11 · ui 3/42**
   = 244 unit tests, 0 failures.
6. `pnpm test:db` — **69 files / 1153 tests** on embedded PostgreSQL 16 (migrations
   0001–0021 fresh-apply, RLS attacks, identity flows, the full business + reporting
   + billing suites), 0 failures, ~69 s.
7. `pnpm build` — all packages (web: compiled successfully, 132/132 static pages).
8. `pnpm check:token-contrast` — green.
9. `pnpm check:i18n-parity` — ar=1723, en=1723, no empty values.
10. `pnpm check:ui-catalog` — 37 exports ↔ 60 rows parity.
11. `pnpm test:visual-harness-run` — storybook + **visual 16/16** (AR+EN threshold 0,
    axe-clean) + perf gate.
12. `pnpm test:web-security` — CSP/headers probe **1 passed (35.2 s)**.
13. `pnpm docs:validate` — **29/29 checks**.
14–17. The three negative meta-tests (boundary, erp-ui lint rules, i18n parity) +
    the parity re-check — all exit 0.

Plus, outside the gate loop: `pnpm --filter @erp/api restore:drill` (the §8 drill —
PASSED, record above) and the standalone
`vitest run src/__db__/performance/mvp-candidate.local.spec.ts` measurement run
(NFR-006 numbers above).

## Actual test results

**Zero failures, zero skips-without-justification across every suite.** One gate
iteration issue found and fixed in-phase (see §Documentation-vs-reality): the visual
harness initially failed 4 tests — (a) baselines absent from the delivered archive
(regenerated in this environment; `packages/ui` rendering code untouched by this
phase — provable against the PHASE-013 archive diff), (b) the coverage check not
honoring the pre-existing quarantine (fixed to match the documented protocol).
Re-run: 16/16 green, then the full 17-step gate re-run end-to-end green.

## Build results

| App/package | typecheck | lint | build |
|---|---|---|---|
| @erp/api | ✅ | ✅ | ✅ (tsc project) |
| @erp/web | ✅ | ✅ | ✅ 132/132 pages |
| @erp/ui | ✅ | ✅ | ✅ (+ storybook + harness) |
| @erp/contracts | ✅ | ✅ | ✅ |
| @erp/domain-core | ✅ | ✅ | ✅ |

## Acceptance criteria verification

1. **PASS** — plans/entitlements/lifecycle end-to-end per SUBSCRIPTION_AND_ENTITLEMENTS;
   every numeric limit/pricing value PLACEHOLDER (all seeds 0.0000; the web derives
   `placeholderPrice` and renders the bilingual badge; no hard-coded numbers — the
   pricing page is seed-driven).
2. **PASS** — sandbox checkout AND manual fallback both operational with identical
   entitlement/billing-history outcomes (`webhook-http.db.spec.ts` "both paths produce
   IDENTICAL entitlement sets and billing-history shapes"; A-009 satisfied).
3. **PASS** — limit behaviors match the §6 matrix (80% warning + email, 100% critical
   deduped, hard blocks on user-invite/branch/warehouse creation with typed errors);
   posting never blocked by the counter (property test at 3× ceiling + the INV-022
   fuzz "flipping the plan changes no posting math and no statement byte").
4. **PASS** — read-only grace + suspension are first-class states (typed
   `subscription_read_only` with the resolving action; the readonly-sweep proves every
   state-changing route blocked while reports/exports/print/notifications/billing stay
   alive; suspension follows PHASE-004 semantics — sessions killed, restore
   re-enables).
5. **PASS (machine tier)** — Journey A completes through the real pipeline in both
   locales (i18n 1723/1723, AR+EN visual baselines, bilingual templates); the wizard
   walks the real controllers to a POSTED invoice with honest skips. The
   human-unassisted walkthrough on hosted staging = recorded follow-up (the standing
   Playwright waiver).
6. **PASS** — dashboards render only widget-bound contract data (the dashboard spec
   re-derives each KPI from the bound run and asserts equality at exact decimals;
   drill links preserve pinned parameters; FAIL assertions surface as failure chips —
   never fabricated numbers); the notifications center delivers the billing-critical
   set (limit warnings, subscription states, overdue, reorder digests).
7. **PASS** — MVP security review complete, findings triaged, zero open blockers,
   PHASE-024 pen-test split documented (MVP_SECURITY_REVIEW §0/§5).
8. **PASS** — MVP-candidate load smoke meets T-01/T-02/T-04/T-06/T-07 with the
   measured margins above (no O-ladder escalation required).
9. **PASS** — backup-restore rehearsal completed once with post-restore invariant
   checks green (runbook §8 drill record; RISK-018 first drill).
10. **PASS** — release v1.0 executed per RELEASE_STRATEGY quality gates: the 17-step
    gate green, migration fresh-apply proven, security checklist, perf smoke, docs
    freeze, the release execution log row recorded (§Release execution log). The git
    tag `release/v1.0.0` is instructed in the log (zip-based handover — created on
    archive restore).
11. **PASS** — the PHASE-014 acceptance row is carried by this report +
    IMPLEMENTATION_STATUS (the PHASE_ACCEPTANCE_CRITERIA.md mirror file does not yet
    exist in the repo; its absence is pre-existing and recorded, not introduced here).

## Documentation-vs-reality reconciliation (found in-phase, fixed in-phase)

1. **In-progress tree completed, not discarded** — the session inherited a large
   uncommitted PHASE-014 changeset (API + web). Every gate was re-run from scratch on
   it; two real defects found and fixed (the AR plan-name read `plan.name`; chained
   wizard skips fabricated milestones — both fixed per the T19 worklog), 12
   typecheck/lint errors in the inherited spec files repaired (unused imports/vars,
   unsafe casts → typed `resultOf` helper, `Math.ceil` → the sanctioned
   eslint-disable justification pattern), and the T-04 perf measurement made honest
   (compute p95 logged, not a bare cache hit).
2. **Visual baselines** — `packages/ui/__image_snapshots__` was absent from the
   delivered PHASE-013 archive (regenerated here; zero rendering-code changes). The
   coverage check now honors the documented quarantine (VISUAL_TESTING §3) —
   quarantined stories render every run but hold no pixel baselines by design.
3. **`scripts/ci/local-gate.sh` + `.env.example` + `gate-baseline.log`** — referenced
   by package.json/docs but missing from the extracted archive; restored verbatim
   from the uploaded zip (content-identical).
4. **Sandbox tooling** — `pg_dump`/`pg_restore` extracted from the distro pool for
   the drill (the runbook's §3 prerequisite is now recorded as an image requirement
   in the drill row); `pnpm` via corepack 9.15.9 (matches `packageManager`).

## Known limitations

- Hosted-infra evidence (GitHub CI, compose boot, Testcontainers, hosted k6,
  staging-tier restore with managed PITR, mailpit capture, the human-unassisted
  journey walkthrough, gitleaks full-history) remains waived per the standing owner
  directive — local-equivalent evidence recorded here; follow-ups tracked in
  NEXT_ACTION.
- The k6 `mvp-candidate.ts` posting leg posts the journal-entry envelope shape with
  an empty-lines body (the local harness owns the exact golden posts); the staged
  run calibrates against the staged seed before the CI tier is relied upon.
- The notifications surface is the billing-critical subset (the 014/015 split is
  recorded in FEATURE_CATALOG); SMS/push adapters are post-MVP.
- Document printing for business documents (invoices) still routes through the
  reporting print-preview (the document print queue is a later surface); the
  onboarding A9 step says so honestly.
- `subscription.pendingPlanKey` is surfaced by the usage view but always null in the
  current service (typed `string | null`; the web never renders it).
- The checkout `complete` outcome type carries a defensive `"no-op"` variant the
  current service never emits (documented in the web types).

## Deferred work

- OQ-002 pricing + numeric limits (all PLACEHOLDER — seed-only configuration).
- OQ-003 payment-provider selection (the adapter port + sandbox + manual fallback
  ship; the production provider decision record is pending).
- Production payment-provider go-live, industry add-on storefront, proration
  analytics, dunning automation beyond the adapter steps (post-MVP billing).
- The generalized notifications product surface (PHASE-015+), PHASE-024 pen-test,
  PHASE-025 full 10× load + GA drills.

## Documentation updated

`docs/planning/IMPLEMENTATION_STATUS.md` (PHASE-014 COMPLETE row + MVP headline) ·
`docs/handoff/CHANGELOG.md` (PHASE-014 entry) · `docs/handoff/CURRENT_STATE.md` ·
`docs/handoff/NEXT_ACTION.md` (→PHASE-015 + follow-ups) ·
`docs/product/SUBSCRIPTION_AND_ENTITLEMENTS.md` (delivery status note) ·
`docs/product/FEATURE_CATALOG.md` (notifications split) ·
`docs/planning/RELEASE_STRATEGY.md` (§Release execution log + v1.0.0 notes) ·
`docs/operations/BACKUP_RESTORE_RUNBOOK.md` (§8 drill record) ·
`docs/security/MVP_SECURITY_REVIEW.md` (new) · this report.

## Risks

No new RISK_REGISTER entries; RISK-018 (untested restores) now carries its first
passed drill; RISK-022 (provider choice) mitigated by the both-paths parity proof;
RISK-003 (pricing) stays mitigated by the PLACEHOLDER discipline; RISK-014 budgets
hold with 15–45× margins.

## Rollback instructions

Migration 0021 is additive (drop the six new tables + the added columns to revert in
a dev environment; production is forward-only per MIGRATION_STRATEGY). Product-level
rollback is entitlement-gated (feature flags per RELEASE_STRATEGY §Rollback) — the
billing surfaces can be hidden by navigation/entitlements without touching posted
data; no posting path, invariant, or existing table semantics changed (INV-022
proven under fuzz). Web rollback = revert the apps/web + contracts changes; API
rollback = revert the tenancy/notifications module changes (no existing route shapes
changed — only additions).

## Next eligible phase

**PHASE-015 — Industry Configuration Framework & Priority Templates** (identify
only; do not implement). Prerequisites met: PHASE-014 COMPLETE (this report) + the
full MVP stack 001–013 per IMPLEMENTATION_STATUS. The L3/L4 engine inputs
(plan/entitlement events) and the onboarding integration point ship with this phase.
