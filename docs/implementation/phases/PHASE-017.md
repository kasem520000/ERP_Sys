# PHASE-017 — Industry Templates: Automotive & Distribution

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-017
- **Title:** Industry Templates: Automotive & Distribution
- **Objective:** Apply the PHASE-015 industry framework to two harder templates and ship
  the module features they require: **automotive/workshop** — job cards as a
  sales-module document combining parts issue and labor service lines, with a per-partner
  vehicle registry and warranty credit notes, posting exactly per the job-card workflow;
  and **distribution/field sales** — the `distribution` module with routes and visits,
  van stock as VAN-typed warehouses fed by ordinary stock transfers, day-end rep
  settlements that always post their variance, customer price tiers, rule-based free
  goods, and rep commissions. This phase is deliberately **back-office + data model**:
  the server stays authoritative; offline van selling arrives with the Android app
  (PHASE-022) on the generalized sync foundation (PHASE-020).
- **Business value:** Workshops and van-route distributors are the two largest MENA
  micro-market segments after counter retail; both live or die by accountability —
  parts+labor on one invoice, and money-and-stock settlement per rep per day — which
  this phase makes auditable end-to-end on the same financial core.

## 2. Scope

In scope:

1. **Template applications via the PHASE-015 engine** (no engine changes expected — a
   engine gap found here is a PHASE-015 defect to fix, not a fork):
   - `industry.automotive` v1.0.0 per
     [automotive-workshop.md](../../industries/templates/automotive-workshop.md):
     terminology (`بطاقة عمل`, `أجور العمل`, `المركبة`…), workshop/parts navigation
     groups, policies (`job_card_parts_issue_mode: reserve`,
     `quotation_validity_days: 7`, `warranty_credit_note_requires_original_invoice`,
     `shift_variance_approval_required`), series `JC/QT/INV/CN/PO`, WAC with
     per-category serial opt-in, pins `automotive.job_card_profitability`,
     `automotive.vehicle_service_history`, `inventory.stock_valuation`,
     `partners.ar_aging`, onboarding steps (bays, labor-rate lists, parts catalog,
     vehicle import, first job card).
   - `industry.distribution` v1.0.0 per
     [distribution-field-sales.md](../../industries/templates/distribution-field-sales.md):
     terminology (`خط السير`, `التحميل الصباحي`, `تسوية المندوب`…), field-operations
     and settlement navigation groups, policies (`van_loadout_requires_transfer`,
     `settlement_required_daily`, `tier_price_automatic_by_partner`,
     `credit_sale_credit_limit_enforced`, `free_goods_require_reason_code`), series
     `LOD/INV/CN/RCP/STL`, batch+expiry on with FEFO, pins
     `distribution.rep_settlement`, `distribution.van_stock_balances`,
     `distribution.route_visit_compliance`, `sales.discount_management_effectiveness`,
     `sales.commissions_due`, onboarding steps (fleet, tiers, route customers, first
     load-out→visits→settlement day).
2. **Job cards — `sales.job_cards`** (proposed key registered into
   [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) via the §5 intake protocol at
   the start of this phase, per the reconciliation note in
   [CAPABILITY_MATRIX §2.6](../../industries/capabilities/CAPABILITY_MATRIX.md)): a
   **sales-module** document type with no contract dependency — PHASE-019 generalizes
   it into `crm.service_orders`. Lifecycle per the template:
   DRAFT → IN_PROGRESS (on customer approval) → COMPLETED → INVOICED, plus CANCELLED
   (audited, no ledger). Line types: **parts lines** (stock items) and **labor lines**
   (non-stock service items priced from labor-rate price lists — no payroll module, so
   actual technician cost is not tracked; profitability = parts margin + labor revenue,
   documented limitation). Diagnosis quotation generated from the card (BR-006
   validity); parts policy `reserve` (default: reservation against the card via
   `inventory.reservations` from PHASE-015 — availability hold, COGS at invoice) or
   `issue_immediate` (COGS journal at issue, stock move references the job card);
   labor hours logged per line as billing data; completion invoices parts + labor
   through the standard sales invoice chain (two revenue natures: parts revenue vs
   labor/service revenue), with VAT per treatment; warranty credit note must reference
   the original invoice and re-enters returned parts at **original issue cost**
   ([industry-workflows.md](../../industries/workflows/industry-workflows.md) (b)).
3. **Vehicle registry** (partners-owned): per-partner vehicle records (make, model,
   chassis/VIN, plate, odometer at check-in/out) linked from job cards and invoices;
   per-vehicle service history timeline (`automotive.vehicle_service_history` source
   data). Fitment matching stays manual (item attributes only — template limitation).
4. **Distribution module — routes & visits** (`distribution.routes`): route definitions
   with day patterns and assigned customers per rep; `route_visits` recording planned
   vs actual visits (actuals from sales documents or explicit check-ins). Planning data
   only — drives no posting ([CAPABILITY_MATRIX §2.4](../../industries/capabilities/CAPABILITY_MATRIX.md)).
5. **Van stock** (`distribution.van_stock`): a van is a **warehouse of type VAN**
   assigned to a rep; load-out/unload are ordinary two-leg stock transfers
   (DRAFT → IN_TRANSIT → POSTED; in-transit visible, never sellable — BR-016) from/to
   the main warehouse; sales issue from the van warehouse through the normal sales
   posting path; `van_stocks` is a read-model mirror of `stock_moves` scoped to van
   warehouses; no valuation account of its own unless the tenant maps branch-distinct
   inventory accounts (then transfer posts DR dest · CR source per
   [INVENTORY_ACCOUNTING.md §2](../../accounting/INVENTORY_ACCOUNTING.md));
   end-of-day van balance must reconcile to the settlement (Journey G G7 optional
   recount becomes a variance line or count session per policy).
6. **Rep day & field collections**: the rep's session is a cashier shift on the rep cash
   account (treasury PHASE-008 mechanics); visit documents are ordinary sales-module
   documents attributed to the rep (`sales_reps` from PHASE-012): cash sales
   (DR rep cash · CR revenue · CR VAT + COGS from van stock), credit sales
   (tier-resolved price + free goods; **credit limit enforced before save** — BR-001,
   online at this phase), returns (credit note mirrors; stock re-enters the van at
   original cost), collections (receipts against open AR: DR rep cash · CR AR control,
   partner-tagged, allocated per INV-016).
7. **Rep settlements** (`distribution.settlements`) per
   [industry-workflows.md (c)](../../industries/workflows/industry-workflows.md):
   settlement document (`STL-{yyyy}-{seq:5}`) computing expected cash = opening cash +
   cash sales + collections − cash refunds − approved rep expenses vs counted cash;
   **variance always posts** (shortage DR cash-shortage expense · CR rep cash; surplus
   inverse) — approval-gated, never netted (BR-021 family); bank deposit leg
   (DR bank/main cash · CR rep cash); POSTED locks the rep's day — later corrections
   are new documents; the settlement cannot close while unsynced/pending documents
   exist (at this phase everything is online, so the gate asserts no draft/pending
   documents remain).
8. **Customer price tiers** (`distribution.customer_tiers`): tier assignment on
   partners driving price-list resolution at sale time per BR-003 precedence
   (customer's list → tier list → branch default → base); tier resolution never
   overrides an explicitly quoted price; discounts affect revenue only. Grocery's
   phase-gated tier entry now goes live.
9. **Free goods & promotions** (`distribution.free_goods` over
   `sales.discount_management`): rule-based free goods (buy-X-get-Y, per-tier, promo
   quantities) applied on van/POS sales; FOC lines are zero-price lines with a
   reason code (BR-008) — they still issue stock and post COGS; revenue side is zero;
   effectiveness reporting via `sales.discount_management_effectiveness`.
10. **Commissions** (`sales.commissions`): per-rep rules (percentage/tiered on
    collected or invoiced sales); commission runs compute from posted, non-reversed
    sales; accrual posting at run time (DR commission expense · CR commission accrual)
    — never a modification of the invoice or its VAT; payouts are ordinary treasury
    payments; `sales.commissions_due` report.
11. **Reports** per [industries/reports/README.md](../../industries/reports/README.md)
    (PHASE-017 rows, on the PHASE-013 report contract): `automotive.job_card_profitability`,
    `automotive.vehicle_service_history`, `distribution.rep_settlement`,
    `distribution.route_visit_compliance`, `distribution.van_stock_balances`,
    `sales.discount_management_effectiveness`, `sales.commissions_due` — monetary
    totals show GL tie-outs where they exist.
12. **Field-sales mobile-readiness (data model only)**: entities and permissions are
    designed so PHASE-022 can mirror the POS + van subsets (LOCAL_DATABASE §1.1 field
    row) without schema rework; no offline behavior is implemented here.

Out of scope (explicit):

- Offline van selling, collections, and load/unload confirmation (PHASE-022 on the
  PHASE-020 foundation); any sync client work.
- GPS/telematics for vans or vehicles; route optimization/TSP; merchandising asset
  tracking; DSD scheduling beyond visit plans.
- Technician payroll and shop-floor scheduling (platform non-goals); OBD/diagnostic-
  tool integrations; parts fitment databases.
- Trade-spend accrual accounting for supplier-funded promotions (reason codes +
  reports only, per the template's known limitations).
- `crm.service_contracts` (optional in the automotive manifest — arrives PHASE-019);
  manufacturing QC for automotive (PHASE-018 feature, optional there).

## 3. Prerequisites

- **PHASE-016 COMPLETE**: live POS flows (counter sale used by parts counters), cashier
  shift UX reused for rep sessions, `inventory.reservations` live from PHASE-015
  (job-card parts holds), and the sales/receipt posting paths this phase extends.
  Verified via completion report + green CI.
- Consumed as-is: PHASE-015 (template engine, switching, terminology, nav registry),
  PHASE-012 (quotations, invoices, credit notes, receipts, allocations, reps),
  PHASE-010 (transfers with in-transit, batches/FEFO, serials), PHASE-008 (cash
  accounts, shifts, variance), PHASE-013 (report contract/print).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (all
  journals through the engine),
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (labor/parts
  VAT per treatment — nothing hard-coded),
  [ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md) (offline is deferred —
  server authoritative at this phase).
- Relevant documentation:
  [automotive-workshop.md](../../industries/templates/automotive-workshop.md),
  [distribution-field-sales.md](../../industries/templates/distribution-field-sales.md),
  [industry-workflows.md](../../industries/workflows/industry-workflows.md) (b) and (c),
  [USER_JOURNEYS.md](../../product/USER_JOURNEYS.md) Journey G,
  [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) (§2.4–2.6,
  §3 intake for `sales.job_cards`),
  [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) (distribution module
  ownership), [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-001, BR-003,
  BR-004, BR-006, BR-008, BR-016, BR-021, BR-027),
  [INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) (§2 transfer
  journals, §4 COGS discipline), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  (§3.8 distribution/manufacturing-adjacent rows: `distribution.routes.manage`,
  `distribution.van_stock.view`, `distribution.settlements.approve`).

## 4. Design Impact

- **Database changes:** new sales-owned `job_cards` + lines (lifecycle, vehicle ref,
  parts/labor line types, issue-mode policy, linked quotation/invoice/credit-note ids);
  partners-owned `vehicles` (make/model/VIN/plate/odometer readings); distribution-owned
  `routes`, `route_visits`, `rep_settlements`, and `van_stocks` read model
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) — note the catalog
  currently lists `van_stocks` under sales with `routes`/`rep_settlements`; this phase
  reconciles module ownership to `distribution` per MODULE_BOUNDARIES and adds the
  missing `route_visits` row); `warehouses` gains type `VAN` + rep binding
  (inventory-owned, additive); `sales_reps` commission rule fields + commission runs.
  All new tables enter [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) this phase
  with RLS via the macro.
- **API changes:** job-card CRUD + state transitions (`/approve`, `/issue-parts`,
  `/complete`, `/invoice`, `/cancel`), quotation-from-card, warranty credit-note link;
  vehicles CRUD under partners; routes/route_visits CRUD + compliance queries; van
  load-out/unload as stock-transfer invocations; settlement open/count/post;
  tiers + free-goods rule CRUD; commission rules + runs. All action-endpoint style per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) (verb sub-resources), contracts in
  `packages/contracts`.
- **UI changes:** job-card workspace (diagnosis → quote → approval → execution →
  invoice, per workflow (b)); vehicle registry + per-vehicle history; routes calendar +
  visit board; van stock balances screen; settlement screen (system totals vs counted,
  variance escalation); tier/free-goods rule editors; commission run + statement
  screens. List + workspace archetypes from
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md); all bilingual RTL-first.
- **Security & authorization:** new permission keys seeded and reconciled per
  AUTHORIZATION_MATRIX §3.8 — `distribution.routes.manage`, `distribution.van_stock.view`,
  `distribution.settlements.approve` (**risky** — money lock), feature-implied keys
  (`sales.job_cards.*` family, `distribution.settlements.manage`,
  `distribution.tiers.manage`, `distribution.free_goods.manage`,
  `sales.commissions.manage` from FEATURE_CATALOG); role templates updated (sales,
  warehouse, owner); settlement approval is creator≠approver by default (BR-034).
- **Accounting implications:** no new posting rules beyond exercising existing ones with
  new document sources — job-card invoice (parts revenue + labor revenue + VAT, COGS
  per issue-mode), settlement variance (BR-021), commission accrual (new rule row: DR
  commission expense · CR commission accrual at run time — added to
  [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4 map with golden fixture),
  van transfers (journal only for branch-distinct accounts). Invariants: INV-001/002,
  INV-009 (partner subledger on credit sales/collections), INV-013 (idempotent
  operations), INV-016 (allocation bounds), INV-018 (transfer/issue atomicity),
  INV-019 (rep cash = movements), INV-021 (series immutability).
- **Localization implications:** full terminology sets from both manifests (AR/EN);
  settlement/commission/job-card prints bilingual RTL; Arabic-first labels like
  `تسوية المندوب` rendered from template overrides.
- **Offline implications:** none implemented — but the capabilities-matrix rows for the
  Android field class (#9, #12, #27 van rows) must remain consistent with this phase's
  data model; the completion report notes the phase deliberately ships online-only van
  operations (matrix rows for PHASE-022 unchanged).
- **Module dependencies:** new `distribution` module (routes, visits, settlements,
  van read model) depending on `inventory` (transfers), `treasury` (rep cash/shifts),
  `sales` (documents, reps, commissions), `partners` (tiers), `reporting`;
  `sales` gains job cards (its own document type) consuming `items` (labor service
  items), `inventory` (reservation/issue); `partners` gains vehicles. No module writes
  another's tables ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)
  cross-module write matrix respected).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | FEATURE_CATALOG intake: `sales.job_cards` row (depends on `sales.quotations`, `inventory.reservations`) + add-on wiring (automotive/distribution packs) | `docs/product/FEATURE_CATALOG.md`, `SUBSCRIPTION_AND_ENTITLEMENTS.md`, seeds | closure test: job cards require reservations + quotations; no orphan keys |
| T2 | Seed + apply both templates via the PHASE-015 engine (manifests, series, pins, checklists; grocery tier entry flips live) | `apps/api/src/modules/configuration/infrastructure/seeds/**` | golden onboarding fixtures for both templates (AR + EN) |
| T3 | Job-card domain + API: lifecycle, labor/parts lines, quotation-from-card, issue-mode policies, hours logging | `apps/api/src/modules/sales/job-cards/**` | state-machine tests (CANCELLED before consumption only; no ledger before INVOICED) |
| T4 | Job-card posting path: invoice with parts+labor revenue natures; COGS under `reserve` vs `issue_immediate`; warranty credit note | `apps/api/src/modules/sales/job-cards/application/posting/**` | **job-card posting golden tests**: journals per workflow (b) under both policies; failure cases (period locked, insufficient reserved stock) with zero residue |
| T5 | Vehicle registry + service history (partners-owned) + import | `apps/api/src/modules/partners/vehicles/**` | contract tests; history timeline fixture; per-vehicle drill |
| T6 | Job-card UI workspace + vehicle screens | `apps/web/src/features/job-cards/**`, `vehicles/**` | component tests AR/EN + visual snapshots; keyboard-complete card flow |
| T7 | Distribution module core: routes, route_visits, visit board | `apps/api/src/modules/distribution/{api,application,domain,infrastructure}/**` | planning-only assertion: no route/visit operation writes journals |
| T8 | Van stock: VAN warehouse type + rep binding; load-out/unload via stock transfers; `van_stocks` read model | `apps/api/src/modules/distribution/van-stock/**`, `apps/api/src/modules/inventory/**` (additive) | **van stock conservation tests**: load − sales − returns − unload − adjustments = 0; in-transit never sellable (BR-016); branch-distinct-account journal variant |
| T9 | Rep day documents: rep shifts on rep cash account; visit sales/returns/collections attributed to rep; credit-limit enforcement online | `apps/api/src/modules/distribution/rep-day/**` | BR-001 block/warn tests at save; receipt allocation boundary tests (INV-016) |
| T10 | Settlements: expected-cash computation, counted entry, variance posting, bank deposit, day lock | `apps/api/src/modules/distribution/settlements/**` | **settlement reconciliation tests**: variance always posts w/ reason; beyond-tolerance escalation; cannot close with pending documents; POSTED immutability (corrections = new docs) |
| T11 | Customer price tiers + free-goods rules + BR-003/BR-008 enforcement points | `apps/api/src/modules/{partners,items,sales,distribution}/**` | tier price resolution precedence tests; FOC zero-revenue + COGS test; quoted-price-never-overridden test |
| T12 | Commissions: rules, runs, accrual posting, statements | `apps/api/src/modules/sales/commissions/**` | accrual golden test (DR expense · CR accrual at run); recompute excludes reversed sales; payout via payment |
| T13 | Reports: the seven PHASE-017 industry reports on the report contract | `apps/api/src/modules/{distribution,sales,reporting}/**` | fixtures assert GL tie-outs (settlement cash↔journals; write-off/shrinkage style discipline) |
| T14 | UI: routes/visit board, van balances, settlement screen, tier/free-goods editors, commission screens | `apps/web/src/features/distribution/**` | component + a11y tests; settlement escalation flow test |
| T15 | Docs updates: ENTITY_CATALOG/TABLES/ERD (job_cards, vehicles, routes, route_visits, van_stocks, rep_settlements, commission runs; module-ownership reconciliation), POSTING_ENGINE §4 commission row | `docs/**` | docs validation green; catalog drift check green |

## 6. Verification

**Automated tests (required):**

- **Job-card posting golden tests**: full workflow (b) — check-in (no ledger) →
  diagnosis/quote (no ledger) → approval (`reserve`: availability hold only, no
  journal; `issue_immediate`: DR COGS · CR inventory at issue cost, move references the
  card) → completion invoice (DR AR/cash · CR parts revenue · CR labor/service revenue
  · CR VAT per treatment; under `reserve`: DR COGS · CR inventory at invoice) →
  receipt (DR cash/bank · CR AR) → warranty credit note (mirror journals + stock
  re-entry at original cost). Assert persisted journal lines + zero ledger residue on
  every failure path (`PERIOD_LOCKED`, insufficient reserved stock, unmapped revenue
  purpose).
- **Settlement reconciliation tests**: seeded rep day (load-out, 3 cash sales, 2 credit
  sales, 1 return, 2 collections, unload) → settlement expected cash = opening + cash
  sales + collections − refunds − approved expenses; counted ≠ expected ⇒ variance
  journal posts with reason; beyond tolerance ⇒ supervisor escalation recorded;
  settlement POSTED ⇒ rep/day locked; attempted edit after POSTED rejected
  (corrections are new documents); pending draft/pending-sync document blocks close.
- **Van stock conservation tests**: for each rep day fixture,
  Σ(load-out) − Σ(sales) − Σ(FOC issues) + Σ(returns) − Σ(unload) − Σ(adjustments) = 0
  across `stock_moves`; FEFO honored on the van for expiry items; in-transit stock
  excluded from availability (BR-016); branch-distinct account variant posts the
  transfer journal and shared-account variant posts none (INV-018 policy rows).
- **Tier/pricing/FOC tests**: BR-003 precedence chain; tier discount caps; explicit
  quoted price never overridden by tier; FOC lines zero-revenue with COGS + reason
  code (BR-008); free-goods rule engine (buy X get Y, per-tier, promo quantity)
  property tests on quantity math.
- **Commission tests**: accrual exactly at run time; base excludes reversed/credited
  sales; run idempotency (re-run creates no second accrual); statement ties to
  `sales.commissions_due` report fixture.
- **Template tests** (the seven per-template requirements of
  [industries/README.md §8](../../industries/README.md) re-run for the two new
  templates): schema validation, feature-key resolution, golden onboarding fixtures,
  workflow smoke with expected journals, switch safety (e.g., `industry.retail` →
  `industry.automotive` zero data loss), RTL visual set, degraded entitlement.
- **Report fixtures** for all seven reports with GL tie-outs where monetary.
- **Permission matrix tests** for every new route; settlement approve is risky +
  audited; SoD warning fires when one role holds create+approve+post for settlements.

**Manual verification:**

1. Run the workshop day: check in a vehicle → diagnose → quote → approve → technician
   logs hours → complete → invoice (parts + labor in AR) → receipt → warranty credit
   note; open `automotive.job_card_profitability` and drill to journals.
2. Run the van day per Journey G: load-out → visits (cash, credit with tier + free
   goods, return, collection) → unload → settlement count (introduce a −5.00 variance)
   → approve → bank deposit; inspect the settlement report and the rep's locked day.
3. Switch a live retail tenant to `industry.automotive`: diff preview matches; POS
   history intact; archived retail entries read-only.
4. Grocery tier entry now live: assign wholesale tier to a customer, verify price
   resolution at sale.

**Acceptance criteria (objective):** *(mirrored into `PHASE_ACCEPTANCE_CRITERIA.md`
row 017 when that file exists.)*

1. Both templates apply via the unmodified PHASE-015 engine and pass all seven
   per-template tests; no engine fork (a needed engine change is a PHASE-015 defect
   fixed there).
2. Job-card posting golden tests green under **both** parts-issue policies with
   exact journal fixtures; posted cards immutable; corrections only via credit notes.
3. Vehicle registry links cards/invoices/history; per-vehicle timeline complete.
4. Van stock conservation holds on all fixtures; VAN warehouses behave as ordinary
   warehouses for valuation (no journal when accounts shared).
5. Settlements: variance always posts with reason and approval trail; POSTED locks
   the rep/day; the settlement report reconciles counted/expected/posted to journals.
6. Tier prices resolve per BR-003 without overriding quoted prices; FOC lines post
   COGS with zero revenue and reason codes (BR-008).
7. Commission accrual posts only at run time, excludes reversed sales, and
   reconciles to the commissions-due report.
8. All seven PHASE-017 industry reports run on the report contract with GL tie-outs.
9. New permission keys seeded + role templates updated + matrix tests green; risky
   settlement approval audited.
10. ENTITY_CATALOG/TABLES/ERD + POSTING_ENGINE §4 (commission row) + FEATURE_CATALOG
    updated; docs validation green; van-operations remain online-only (matrix rows for
    PHASE-022 untouched).

**Performance & security considerations:** settlement computation over a full rep day
(≤ 200 documents) p95 ≤ 2 s; van balance queries indexed tenant+warehouse+item;
route calendars p95 ≤ 500 ms. Settlement approval is risky/audited; credit-limit
checks run server-side on every credit sale; free-goods rules are tenant-scoped and
validated against ceilings (BR-002 interplay); no rep can edit a posted settlement.

**Migration & rollback:** additive migrations only (new tables, warehouse-type enum
value, additive columns). Rollback = disable entitlements/templates (add-on removal →
read-only historical access per
[SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md));
posted documents/journals remain valid ordinary sales/treasury documents; dev-only
schema revert otherwise.

## 7. Risks and Constraints

- **RISK-009** (accounting bugs): the settlement variance and commission accrual are
  new posting surfaces — golden fixtures + invariant suite are the gate; drift between
  settlement report and journals is Sev-1 (INV-019 discipline).
- **RISK-016** (boundary erosion): `distribution` must not write inventory/treasury
  tables directly — van operations call published services; dependency-cruiser rules
  extended to the new module.
- **RISK-002** (template genericity): mitigated by manifest terminology + the two
  design-partner validations required at rollout.
- **RISK-019** (implementing beyond phase): the offline van flows are the tempting
  overreach — explicitly out of scope; the completion report must show zero sync-client
  code outside the PHASE-016 slice.
- Job-card catalog reconciliation risk (`sales.job_cards` at 017 vs `crm.service_orders`
  at 019): the intake note in CAPABILITY_MATRIX §2.6 is the recorded decision — this
  phase implements the sales-module document; PHASE-019 generalizes, it does not fork.
- Constraint: labor cost is not tracked (no payroll) — profitability reports must label
  the limitation honestly rather than imply costed labor.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-017-COMPLETION.md` with: golden posting
  outputs (job card both policies, settlement variance, commission accrual),
  conservation-test output, template test results (all seven × 2), report GL tie-outs,
  permission matrix output, docs validation, visual snapshots as secondary evidence.
- **Documentation updates required:** IMPLEMENTATION_STATUS (PHASE-017 → COMPLETE),
  CURRENT_STATE, CHANGELOG, ENTITY_CATALOG + TABLES/ERD (job_cards, vehicles, routes,
  route_visits, van_stocks, rep_settlements, commissions; distribution ownership
  reconciliation), POSTING_ENGINE §4 (commission accrual row), FEATURE_CATALOG
  (`sales.job_cards` shipped), INDUSTRY_CATALOG pointers, permission seeds note.
- **Exit criteria:** all acceptance criteria green with evidence; both templates live
  via the unmodified engine; settlement/commission posting provably correct; van model
  proven ready for PHASE-022 mirroring (data-model review note attached).
- **Definition of Done:** distribution module + job cards + vehicles + tiers +
  free goods + commissions + settlements + reports + UI + tests merged; CI green; docs
  synchronized; zero TODOs in delivered scope.
- **Handoff instructions:** manufacturing (018) and CRM (019) are both eligible next
  and may run in parallel per the dependency graph, though the agent protocol executes
  one at a time. The 018 agent needs the inventory batch/transfer baseline proven here
  (van conservation) and the 019 agent needs the job-card generalization note (§2.6
  reconciliation) plus the projects dimension from PHASE-007.
  **Next eligible phase: PHASE-018 — Manufacturing & Production** (PHASE-019 parallel-
  eligible; identify only, do not implement).
