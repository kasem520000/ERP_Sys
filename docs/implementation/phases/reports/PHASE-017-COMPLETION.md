# Completion Report — PHASE-017

> **Status:** COMPLETE · **Updated:** 2026-11-03

## Phase ID / Date

PHASE-017 — Industry Templates: Automotive & Distribution · 2026-11-03

## Summary

The two harder industry templates shipped on the unmodified PHASE-015 engine
with the module features they require. **Automotive/workshop**: job cards as
a sales-module document (DRAFT → IN_PROGRESS → COMPLETED → INVOICED +
CANCELLED) combining parts lines (STOCK items, reserved or issued-immediately
per policy) and labor lines (SERVICE items billed at estimated-hours ×
per-hour rate, priced from labor-rate price lists), quotation-from-card
through the real QuotationService, completion invoices with **two revenue
natures** (SALES_REVENUE for parts / SERVICE_REVENUE for labor), warranty
credit notes that re-enter parts at the original issue cost, and a
per-partner vehicle registry with a service-history timeline.
**Distribution/field sales**: the new `distribution` module — routes and
visits (planning-only, provably journal-free), van stock as VAN-typed
warehouses fed by ordinary two-leg transfers (in-transit never sellable,
conservation tied), day-end rep settlements (STL-, expected-cash from the
ledgers, variance always posts approval-gated never netted, POSTED locks the
day), customer price tiers driving BR-003 resolution, rule-based free goods
(BR-008 zero-price reason-coded lines that still issue stock and post COGS),
and rep commissions with the accrual journal exactly at run time. Seven
industry reports on the PHASE-013 contract with GL tie-outs, 62 new API
routes, seven web screens, both templates apply/switch-verified, all
bilingual RTL.

## Files created

**Migration & schema**
- `apps/api/migrations/0025_automotive_distribution.sql` — 15 new RLS'd tenant
  tables + additive columns + widenings + CoA markers + template seeds +
  permission/plan/role seeds (schema_version 25)

**Sales module (job cards + commissions)**
- `apps/api/src/modules/sales/job-cards/domain/job-card-errors.ts`
- `apps/api/src/modules/sales/job-cards/application/job-card-service.ts`
- `apps/api/src/modules/sales/job-cards/application/posting/job-card-posting.ts`
- `apps/api/src/modules/sales/infrastructure/job-cards.store.ts`
- `apps/api/src/modules/sales/presentation/job-cards.controller.ts`
- `apps/api/src/modules/sales/commissions/domain/commission-errors.ts`
- `apps/api/src/modules/sales/commissions/application/commission-service.ts`
- `apps/api/src/modules/sales/infrastructure/commissions.store.ts`
- `apps/api/src/modules/sales/presentation/commissions.controller.ts`
- `apps/api/src/modules/sales/commissions.module.ts`

**Partners module (vehicles)**
- `apps/api/src/modules/partners/vehicles/domain/vehicle-errors.ts`
- `apps/api/src/modules/partners/vehicles/application/vehicle-service.ts`
- `apps/api/src/modules/partners/infrastructure/vehicles.store.ts`
- `apps/api/src/modules/partners/presentation/vehicles.controller.ts`

**Distribution module (NEW)**
- `apps/api/src/modules/distribution/distribution.module.ts`
- `apps/api/src/modules/distribution/domain/distribution-errors.ts`
- `apps/api/src/modules/distribution/application/route-service.ts`
- `apps/api/src/modules/distribution/application/visit-service.ts`
- `apps/api/src/modules/distribution/application/van-stock-service.ts`
- `apps/api/src/modules/distribution/application/settlement-service.ts`
- `apps/api/src/modules/distribution/application/tier-service.ts`
- `apps/api/src/modules/distribution/application/free-goods-service.ts`
- `apps/api/src/modules/distribution/infrastructure/distribution.store.ts`
- `apps/api/src/modules/distribution/presentation/distribution.controller.ts`

**Reporting (7 contracts + query services)**
- `apps/api/src/modules/reporting/registry/industry/phase017.ts`
- `apps/api/src/modules/reporting/registry/industry/automotive-queries.ts`
- `apps/api/src/modules/reporting/registry/industry/distribution-queries.ts`

**Tests (DB)**
- `apps/api/src/__db__/sales/job-cards.spec.ts` (5)
- `apps/api/src/__db__/sales/job-card-posting.spec.ts` (5)
- `apps/api/src/__db__/sales/commissions.spec.ts` (11)
- `apps/api/src/__db__/partners/vehicles.spec.ts` (13)
- `apps/api/src/__db__/distribution/core.spec.ts` (6)
- `apps/api/src/__db__/distribution/settlements.spec.ts` (4 packs / 12 asserts)
- `apps/api/src/__db__/distribution/tiers-foc.spec.ts` (18)
- `apps/api/src/__db__/reporting/industry-017.spec.ts` (10)
- `apps/api/src/__db__/configuration/templates-017.spec.ts` (6)

**Web**
- `apps/web/app/[locale]/job-cards/page.tsx` + `apps/web/components/job-cards.tsx`
- `apps/web/app/[locale]/vehicles/page.tsx` + `apps/web/components/vehicles.tsx`
- `apps/web/app/[locale]/distribution/routes/page.tsx` + `apps/web/components/distribution-routes.tsx`
- `apps/web/app/[locale]/distribution/van/page.tsx` + `apps/web/components/distribution-van.tsx`
- `apps/web/app/[locale]/distribution/settlements/page.tsx` + `apps/web/components/distribution-settlements.tsx`
- `apps/web/app/[locale]/distribution/tiers/page.tsx` + `apps/web/components/distribution-tiers.tsx`
- `apps/web/app/[locale]/sales/commissions/page.tsx` + `apps/web/components/commissions.tsx`

**Docs**
- `docs/database/TABLES/automotive-distribution.md`
- `docs/database/ERD/automotive-distribution.md`
- Implementation-agent evidence reports: `agent-ctx/T25…T35` (10 files)

## Files changed

- `apps/api/src/db/schema.ts` — the 15 new tables + additive columns
  (warehouses.type/rep_id, partners.customer_tier_id, sales_reps commission
  columns, sales_invoices job_card_id/vehicle_id, sales_invoice_lines
  foc_reason_code, credit_notes job_card_id)
- `apps/api/src/infra/db/migrations.ts` + `migrations.spec.ts` + `meta/_journal.json` — 0025 registered
- `apps/api/src/modules/identity/infrastructure/permissions-drift.ts` (+ spec) — 0025 joins the seed union
- `apps/api/src/infra/auth/route-permissions.ts` — 62 new routes
- `apps/api/src/__db__/isolation/tables.registry.ts` + `identity-isolation.db.spec.ts` — 13 new tables + fixtures/attacks
- `apps/api/src/modules/sales/application/invoices.ts` — focReasonCode +
  jobCardId/vehicleId provenance + the revenue-nature split (STOCK/COMPOSITE →
  SALES_REVENUE, SERVICE → SERVICE_REVENUE; flow-B planning skips SERVICE lines)
- `apps/api/src/modules/sales/application/credit-notes.ts` — jobCardId + optional reentryWarehouseId
- `apps/api/src/modules/sales/application/pricing.ts` — the BR-003 tier level
  (customer's own list → **tier list** → base → manual; source
  `TIER_PRICE_LIST`)
- `apps/api/src/modules/sales/infrastructure/sales.store.ts` — 0025 columns on rows
- `apps/api/src/modules/partners/infrastructure/partners.store.ts` — customerTierId + updatePartnerTier
- `apps/api/src/modules/sales/sales.module.ts`, `partners.module.ts`,
  `app.module.ts` (DistributionModule + CommissionsModule)
- `apps/api/src/infra/http/error.filter.ts` — vehicle/settlement/commission error mappings
- `apps/api/src/__db__/sales/fixtures.ts` — opening stock ×10 (200/100 — the
  shared-db suite outgrew ×20/×10; stock asserts are delta-based so the size
  is invisible to goldens), SERVICE_REVENUE/COMMISSION purpose mappings
- `packages/contracts/src/industry/templates.ts` — AUTOMOTIVE/DISTRIBUTION
  manifests (byte-equal to the seeds) + SHIPPED_TEMPLATE_MANIFESTS (5)
- `packages/contracts/src/navigation.ts` — sales.job_cards, sales.commissions,
  partners.vehicles NAV_ITEMS
- `apps/web/lib/effective-config.ts` — 7 report targets +
  TARGET_ROUTE_ALIASES (distribution screens + inventory.on_hand/pos.counter/
  distribution.collections aliasing)
- `apps/web/lib/api-types.ts`, `apps/web/lib/messages.ts`,
  `apps/web/components/app-shell.tsx` (crumbs),
  `apps/web/i18n/dictionaries.ts` (309 new keys: 78 automotive + 231
  distribution/commissions — parity 2348/2348)
- Reporting registry wiring (`registry/index.ts`, `runtime.ts` —
  distribution data-source module + phase window 17, `services.ts`) + counts
  56→63 in the unit spec
- Configuration: `prerequisites.ts` (CURRENT_SHIPPED_PHASE 17),
  `feature-catalog.ts` (FEATURE_DEPS sales.job_cards), POLICY_REGISTRY +11
  keys, golden effective-config pins
- Docs: ENTITY_CATALOG, TABLES/ERD, POSTING_ENGINE §4 (commission accrual +
  job-card issue + settlement variance/deposit rows), FEATURE_CATALOG,
  SUBSCRIPTION_AND_ENTITLEMENTS, AUTHORIZATION_MATRIX (238=238 drift-green),
  industries README/templates/capabilities/INDUSTRY_CATALOG, reports README,
  REPORT_CATALOG, IMPLEMENTATION_STATUS, CURRENT_STATE, NEXT_ACTION, CHANGELOG

## Database migrations

- `0025_automotive_distribution.sql` — everything additive (15 tables,
  column adds, CHECK re-issues incl. the BR-008 relaxation
  `ck_sales_invoice_lines_net_positive: net > 0 OR foc_reason_code IS NOT
  NULL`, CoA markers 2150/5250 + 4200 SERVICE_REVENUE, two template seeds at
  v1.0.0, 7 permission seeds, plan/role grants). Rollback = dev-only schema
  revert; product rollback = disable entitlements (read-only history).

## API changes

62 new routes, all permission-guarded + feature-gated + Idempotency-Key'd:
- `GET/POST /api/v1/sales/job-cards`, `GET/PUT :id`, `POST :id/{quotation,
  approve, complete, invoice, cancel}`, `POST :id/lines/:lineId/log-hours` (10)
- `GET/POST /api/v1/partners/vehicles`, `GET/PUT :id`, `POST :id/archive`,
  `GET :id/service-history` (6)
- Distribution (31): routes CRUD + `:id/customers` + `:id/plan-visits`,
  visits board (`check-in|complete|skip`), vans + van-stock
  (`load-out|unload|transfers/:id/receive`), settlements
  (`count|approve|post|cancel`), tiers + free-goods-rules CRUD
- Commissions (7): `GET/PUT /api/v1/sales/reps/:id/commission-rule`,
  `GET/POST /api/v1/sales/commission-runs`, `GET :id`, `POST :id/{post,cancel}`
- `POST /api/v1/partners/partners/:id` (PATCH) — customerTierId field

## UI changes

Seven bilingual RTL screens (server page + client component, the
pos/terminals pattern): job-card workspace (list + create + lifecycle bar +
hours logging), vehicle registry (+ service-history timeline), routes &
visit board, van stock (fleet + balances + load-out/unload/receive),
settlements console (expected breakdown + count + variance + approve + post
+ deposit), tiers/free-goods editors, commissions (runs + per-rep rules).
Nav: 3 core NAV_ITEMS + template-derived groups (workshop/parts,
field/settle) + 7 report deep-links.

## Security changes

- 7 new permission keys seeded (matrix 238 = seed union drift-green);
  `distribution.settlements.approve` is the **risky** money-lock key
  (creator≠approver BR-034 enforced server-side, audited)
- 15 new RLS'd tenant tables (the PHASE-002 macro) — all registered in the
  isolation A-test registry with fixtures + mismatched-tenant attacks (768
  isolation tests green)
- Role-template grants: owner (full set), sales (job cards, commissions,
  tiers, FOC, settlement-create), warehouse (van ops + routes), accountant
  (settlement approve + commissions)

## Tests executed

```
pnpm typecheck                      # 6/6 packages
pnpm lint                           # 6/6 packages
pnpm run lint:depcruise             # 894 modules, 0 violations
pnpm run check:permissions-drift    # matrix 238 = seed 238
pnpm validate:manifests             # 5/5 manifests
pnpm test                           # api 267 + contracts 42 + domain-core 38 + ui 42 + sync-core 8
pnpm --filter @erp/api test:db      # FULL single-process suite (embedded PG16)
pnpm docs:validate                  # 29/29
pnpm run check:i18n-parity          # ar=2348, en=2348
pnpm run check:ui-catalog           # 37 exports ↔ 60 rows
pnpm run check:token-contrast       # all §16 pairs pass AA
pnpm run test:web-security          # 4/4 (CSP probe)
pnpm run test:visual-harness-run    # perf harness pass
pnpm run boundary:negative-test     # pass
pnpm run boundary:negative-ui-test  # pass
pnpm run boundary:negative-i18n-test # pass
pnpm run build                      # 6/6
```

## Actual test results

- **DB suite (the gate's step 7): 88 files / 1410 tests — ALL PASSED**
  (single process, embedded PostgreSQL 16, migrations 0001–0025, 76 s)
- Unit: api 267/267 (25 files) · contracts 42/42 · domain-core 38/38 ·
  ui 42/42 · sync-core 8/8
- The earlier **chunked** runs (30+23+19+12+5 files) surfaced two artifacts,
  both resolved: (1) `notifications-email.db.spec.ts` failed 3 tests when
  chunked immediately after billing (SMTP capture cross-talk) — **passes in
  the real single-process suite order and standalone (5/5)**; pre-existing
  order sensitivity, zero PHASE-017 files in that chunk; (2) stale hard-coded
  counts in `identity-flows` (231→238), `tenancy-http`/`tenancy-provisioning`
  (43→45 accounts, 17→20 purposes) — updated with 0025-accurate comments.
- All ten implementation-agent evidence reports carry per-task outputs in
  `agent-ctx/T25…T35`.

## Build results

- typecheck 6/6 · lint 6/6 · build 6/6 (turbo) · depcruise 0 violations

## Invariants covered

- **INV-001/002** (balanced journals): every new posting surface (job-card
  issue, card invoice two-nature settlement, settlement variance/deposit,
  commission accrual) goes through PostingService — engine-enforced
- **INV-009** (partner subledger): card invoices DR AR_CONTROL with
  partnerId (golden-asserted)
- **INV-013** (idempotency): settlement re-post + commission re-post → typed
  errors, no second journal; job-card issue re-run = no-op
- **INV-016** (allocation bounds): collections ride the existing receipt
  allocation path (commissions COLLECTED basis reads allocations)
- **INV-018** (transfer atomicity): load-out/unload through TransferService
  (two-leg, carried cost)
- **INV-019** (cash = movements): every settlement money leg writes a
  cash_movements row; the spec ties Σ movements to the GL balance
- **INV-021** (series immutability): JC- at creation, STL- at post —
  reserve/bind through NumberingService
- **BR-003** (tier precedence): own list > tier > base; quoted price never
  overridden (staleness gate re-resolves through the tier level) — spec-proven
- **BR-008** (FOC): zero-price reason-coded line inserts (0025 relaxation),
  zero revenue + full COGS + stock issue — spec-proven
- **BR-016** (in-transit never sellable): mirror 0 while IN_TRANSIT — asserted
- **BR-021** (variance always posts, never netted): settlement variance
  journal + reason + approval gate — golden-asserted
- **BR-034** (creator≠approver): settlement approve — asserted
- **BR-038** (additive switching): retail→automotive→retail zero data loss —
  asserted in templates-017.spec

## Acceptance criteria verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Both templates apply via the unmodified PHASE-015 engine, all seven per-template tests | **PASS** | templates-017.spec 6/6 (apply, series, pins, checklist, idempotent re-apply, switch safety retail→automotive→retail with archived_* snapshots + append-only series + back-switch, degraded entitlement missingChain, grocery tier liveness); manifests 5/5; golden effective-configs +6 pins AR+EN; zero engine-file forks (engine changes = the 2-a wiring: phase bump, FEATURE_DEPS, POLICY_REGISTRY — registrations, not forks) |
| 2 | Job-card posting goldens under BOTH policies, posted immutable | **PASS** | job-card-posting.spec 5/5: reserve (settlement two-nature + flow-B COGS at invoice + holds→CONSUMED), issue_immediate (COGS at approval, exactly ONE COGS journal), warranty CN (mirror journals + re-entry at original cost + job_card_id), PERIOD_LOCKED zero residue, INSUFFICIENT_STOCK atomic no-transition; posted cards reject cancel (corrections = credit notes) |
| 3 | Vehicle registry links cards/invoices/history | **PASS** | vehicles.spec 13/13 (registry CRUD, typed chassis/409/409, service-history UNION timeline with kind badges + sort; job-card/invoice rows linked) |
| 4 | Van stock conservation; VAN as ordinary warehouses (no journal when shared) | **PASS** | distribution/core.spec 6/6: conservation tie Σ signed moves = mirror; BR-016 mirror 0 in-transit; journal count unchanged through load-out/receive/unload (shared INVENTORY account — G-15 policy-none) |
| 5 | Settlements: variance always posts with reason + trail; POSTED locks; report reconciles | **PASS** | settlements.spec 4 packs: expected math exact, variance journal DR CASH_DIFFERENCE·CR rep cash + reason, deposit journal + movements (INV-019 tie), STL- at post, day-lock uq + POSTED-immutability, pending-documents gate, self-approval block; the rep_settlement report's settlement-gl-tie asserts journals == components (industry-017.spec) |
| 6 | Tier prices per BR-003 without overriding quoted; FOC posts COGS zero revenue | **PASS** | tiers-foc.spec 18/18: precedence chain (own 90 > tier 85 > base 100; manual 75 never overridden), engine property tests (multiples, caps, tier scoping, windows), FOC posting (draft inserts at net 0, DN zero-net posts stock+full COGS, invoice aggregation split) |
| 7 | Commission accrual only at run, excludes reversed, reconciles to report | **PASS** | commissions.spec 11/11: accrual journal exactly DR 5250·CR 2150 at run (32.0000 golden), base 1600 = 1800−200 credited, tiered math 28.0000, COLLECTED basis over allocations, re-post typed error, run immutable; commissions-total-tie in industry-017.spec (3.2000 = 3.2000) |
| 8 | Seven reports on the contract with GL tie-outs | **PASS** | registry 56→63, reporting-unit 42/42; industry-017.spec 10/10 with four tolerance-0 ties: jc-parts-cogs-tie, settlement-gl-tie, van-conservation-tie, commissions-total-tie |
| 9 | Permission keys seeded + roles + matrix tests; risky settlement approval audited | **PASS** | 7 seeds (matrix 238=238 drift-green), role grants (owner/sales/warehouse/accountant), isolation suite green incl. new-table attacks; approve is risky-keyed + audited + BR-034 |
| 10 | ENTITY_CATALOG/TABLES/ERD + POSTING_ENGINE §4 + FEATURE_CATALOG updated; docs green; van ops online-only | **PASS** | docs:validate 29/29; the 17 doc files listed above; OFFLINE_CAPABILITIES_MATRIX rows #9/#12/#27 verified unchanged (PHASE-022); zero sync-client code added (grep-verified: no new sync wire/schemas) |

## Evidence

- Command outputs above (run 2026-11-03 on the final tree, this box)
- Per-task evidence: `agent-ctx/T25-3a-job-cards.md`, `T26-3b-vehicles.md`,
  `T27-5a-distribution-core.md`, `T28-2a-templates.md`,
  `T29-4a-job-card-posting.md`, `T30-6a-settlements.md`,
  `T31-7a-commissions.md`, `T32-6b-tiers-foc.md`, `T33-8a-reports.md`,
  `T34-9a-auto-web.md`, `T35-9a-dist-web.md`
- Full-suite tail: `Test Files  88 passed (88)` / `Tests  1410 passed (1410)` /
  `Duration  76.39s`

## Known limitations

- **Labor cost is not tracked** (no payroll): job-card profitability =
  parts margin + labor revenue only — the report labels this honestly
- **Fitment matching stays manual** (item attributes only) — template limitation
- Settlement **rep attribution**: collections/expenses attribute by the rep
  cash account (no rep column on receipts/expenses); sales/refunds by
  sales_rep_id — documented in T30
- **Zero-variance POSTED settlements carry a sentinel variance_journal_id**
  (the ck_posted_shape demands NOT NULL; zero-amount journals are impossible
  — the posting-service zero-uuid precedent)
- **deposit movement source_id** = the deposit journal id (the
  uq_cash_movements_source_side shape) — documented in T30
- Line full-replace on job cards is **tombstone-based** (no DELETE grant on
  job_card_lines / commission_run_lines — the status-lifecycled grant model)
- The route-composition read is derived from planned visits (no dedicated
  GET) — UI-documented
- Commission runs exclude reps whose rule basis ≠ the run basis (exclusion
  note-lines) — by design, documented
- Playwright browsers were re-installed this session (sandbox reset) — the
  CSP probe then passed 4/4

## Deferred work

- Offline van selling / load-unload confirmation / field-credit-notes —
  **PHASE-022** on the PHASE-020 foundation (matrix rows #9/#12/#27
  deliberately untouched; zero sync-client code shipped here)
- `crm.service_contracts` — PHASE-019 (the §2.6 reconciliation: 019
  generalizes job cards into crm.service_orders, it does not fork)
- Manufacturing QC (automotive optional) — PHASE-018
- Trade-spend accrual accounting for supplier-funded promotions — reason
  codes + reports only (template known limitation)
- `k6/mvp-candidate.ts` staged hosted run — standing follow-up from PHASE-014

## Documentation updated

IMPLEMENTATION_STATUS (PHASE-017 → COMPLETE), CURRENT_STATE, NEXT_ACTION,
CHANGELOG, ENTITY_CATALOG (+15 tables, distribution ownership
reconciliation), TABLES/automotive-distribution.md, ERD/automotive-distribution.md,
POSTING_ENGINE §4 (commission accrual + job-card issue + settlement
variance/deposit rows), FEATURE_CATALOG (sales.job_cards + distribution §15 +
sales.commissions shipped), SUBSCRIPTION_AND_ENTITLEMENTS (add-on wiring),
AUTHORIZATION_MATRIX (§3.2/§3.8 — 238=238), industries README/templates
README/INDUSTRY_CATALOG/capabilities §2.4–2.6, reports README (7 rows),
REPORT_CATALOG, OFFLINE matrix rows verified unchanged.

## Risks

- No new RISK_REGISTER entries. RISK-009 (accounting bugs): mitigated by the
  four tolerance-0 GL ties + the golden packs. RISK-016 (boundary erosion):
  distribution calls published services only (TransferService, PostingService)
  — depcruise green over the new module. RISK-019 (implementing beyond
  phase): zero sync-client code shipped; completion report records it.

## Rollback instructions

Product-level: disable the automotive/distribution entitlements
(add-on removal → read-only historical access per
SUBSCRIPTION_AND_ENTITLEMENTS); posted documents/journals remain valid
ordinary sales/treasury documents. Dev-level: revert migration 0025
(`drizzle-kit` down / restore pre-0025 dump); revert the code tree to the
`phase/016` tag. No data migration is required for entitlement-only
rollback.

## Next eligible phase

**PHASE-018 — Manufacturing & Production** (PHASE-019 CRM parallel-eligible
per the dependency graph; identify only — NOT implemented here). The 018
agent needs the inventory batch/transfer baseline proven here (van
conservation) and the 019 agent needs the §2.6 job-card generalization note
plus the projects dimension from PHASE-007.
