# PHASE-060 — Sales & CRM Depth

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 4 / Stage 15 · **Register:** [CR-30](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §4 (S-01…S-07, S-10, S-11, S-12, S-17, S-18, S-20, S-21)

## 1. Phase Overview

- **Phase ID:** PHASE-060
- **Title:** Sales & CRM Depth (عمق المبيعات وإدارة العملاء)
- **Objective:** Open Wave 4 by turning the thin sales module (leads with three
  statuses, free-text channels, plain price lists) into a working CRM: an opportunity
  pipeline with configurable stages, probability, and value; campaigns with member
  attribution and ROI; targets, territories, and forecasting; volume-based rebate
  agreements with accruals; contract price agreements with periods, quantity bounds,
  and priority that supersede plain price lists; formula pricing (cost + margin +
  rounding); a channel registry with per-channel pricing; scheduled delivery
  windows; drop-ship order flow; a customer portal (the deferred S-20) sharing
  infrastructure with the supplier-portal skeleton; and partner credit scoring that
  complements the dunning engine from PHASE-039.
- **Business value:** The audit found the sales side to be "leads with three statuses
  and nothing after" (S-01…S-07): no pipeline value, no campaign ROI, no quotas, no
  rebates, no contract pricing. For a distribution-heavy regional market those are
  table stakes of the sales office, and the customer portal is the differentiator
  that removes phone-call statement requests. Every forecasting and target surface
  here also feeds the KPI engine from PHASE-057.
- **الملخص التنفيذي (AR):** يفتح هذا الطور الموجةَ الرابعة بتحويل وحدة المبيعات
  الرقيقة إلى CRM عاملة: فرص بيع بخط أنابيب قابل للتهيئة واحتمالية وقيمة ومصدر
  ومالك، حملات تسويقية بانتساب أعضاء وحساب عائد استثمار، أهداف ومناطق بيع
  ومقارنةً بالفعلي، اتفاقيات خصومات حجمية سنوية مع استحقاقات مرحلية، اتفاقيات
  أسعار تعاقدية بفترات وحدود كمية وأولوية تسبق قوائم الأسعار البسيطة، تسعير
  بالصيغة (تكلفة + هامش + تقريب)، سجل قنوات بيع بتسعير لكل قناة، جدولة نوافذ
  التسليم، بيع من الباطن من الطلب إلى شحن المورد إلى الفوترة، وبوابة عملاء
  (كشف الحساب/الفواتير/روابط الدفع/النزاعات) تتشارك بنية بوابة الموردين، مع
  تقييم ائتماني للشركاء — تحت القيود الذهبية G-75/G-76 والثابت INV-043.

## 2. Scope

In scope:

1. **Opportunity pipeline** (S-01): `opportunities` (stage, probability, value,
   expected close date, source lead link, owner) + `sales_pipeline_stages`
   (configurable per tenant, with per-stage probability defaults); pipeline board and
   list at `/crm/opportunities`.
2. **Campaigns with ROI** (S-02): `campaigns` + `campaign_members` (lead/partner
   attribution) + `campaign_costs`; ROI computed as attributed revenue versus cost
   per campaign; `/crm/campaigns`.
3. **Sales targets** (S-03): `sales_targets` — rep/team/territory × period, with
   vs-actual dashboards and drill-through to contributing documents; `/sales/targets`.
4. **Territories** (S-04): `territories` + `territory_assignments` — geographic or
   rule-based assignment of partners and reps; `/sales/territories`.
5. **Rebates with accruals** (S-05): `rebate_agreements` (volume-based yearly scales,
   settlement terms) + `rebate_accruals` (periodic accrual as qualification
   progresses, settlement by credit note) — golden G-75 guards the accrual posting.
6. **Contract price agreements** (S-06, S-18): `price_agreements` — customer/item,
   validity period, min/max quantity, priority; the price-resolution precedence
   (agreement > channel price > formula price list > base list) handles overlapping
   validity windows explicitly; `/pricing/agreements`.
7. **Formula pricing** (S-07): `price_list_rules` — cost + margin + rounding
   formulas on price lists with evaluation order and preview.
8. **Sales channels registry** (S-11): `sales_channels` — replaces free-text channel
   tags with a governed registry and per-channel pricing.
9. **Scheduled delivery** (S-12): `scheduled_date` and delivery-window fields on
   delivery notes, surfaced in fulfillment planning.
10. **Drop-ship flow** (S-21): `drop_ship_links` — customer order line → supplier
    direct-ship purchase order → customer billing, with COGS recognized at supplier
    ship-confirm (golden G-76 guards the timing).
11. **Sales forecasting** (S-17): weighted pipeline (Σ value × probability) plus
    history-based baseline; `sales_forecasts` snapshot records per period; invariant
    INV-043 keeps the weighted value consistent across board, list, forecast, KPI,
    and report surfaces.
12. **Customer portal** (S-20): `portal_accounts` — customer-contact scoped logins;
    statement, invoice, and payment-link views (payment links from PHASE-056 when
    present); dispute-case submission routed to the support/case pipeline; shares
    portal infrastructure with the PHASE-038 supplier-portal skeleton.
13. **Partner credit scoring** (credit-risk complement to PHASE-039):
    `partner_credit_scores` — score class, automated review triggers (payment
    behavior, exposure, aging), and review-task generation that complements the
    dunning ladder.
14. **ATP link** (S-10): order and opportunity surfaces consume the ATP engine from
    PHASE-043 when present (available-to-promise display on order lines); an honest
    fallback shows on-hand minus reserved until 043 lands, recorded as such.

Out of scope: the ATP computation engine itself (043) · shipping/carrier tracking
(056) · RMA and managed warranties (039) · FX-hedged pricing (053) · BI builder
surfaces (057 — forecasts and targets register as datasets there) · supplier-side
portal features beyond the shared skeleton (038).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-036 (Extensibility Core — custom fields surfaced on CRM/pricing entities) | PLANNED (Blueprint v3.0) — must be COMPLETE before this phase starts |
| PHASE-039 (Returns & Collections — dunning engine that credit scoring complements) | PLANNED (Blueprint v3.0) — must be COMPLETE before this phase starts |
| Delivered sales module (leads, quotes, orders, invoices, delivery notes, price lists) | shipped in stages 1–11 (audit §21 — do not touch) |
| PHASE-038 supplier-portal skeleton (shared portal infrastructure) | PLANNED — recommended soft edge; without it the customer portal ships on standalone infrastructure (recorded) |

The 036 edge is hard: opportunity/campaign/agreement entities surface custom fields
from day one. The 039 edge is hard because credit scoring shares the aging and
payment-behavior signals the dunning engine produces.

## 4. Design Impact

- **Migrations:** next in sequence (≈0124…0128 at authoring time; exact numbers are
  bound at implementation start — counts and contents claimed, not fixed journal
  numbers): `crm_core` (opportunities, sales_pipeline_stages, campaigns,
  campaign_members, campaign_costs), `sales_targets` (sales_targets, territories,
  territory_assignments, sales_forecasts), `pricing_depth` (price_agreements,
  price_list_rules, sales_channels, rebate_agreements, rebate_accruals),
  `sales_fulfillment` (drop_ship_links + delivery-note scheduling columns),
  `portal_credit` (portal_accounts, partner_credit_scores). Drizzle mirror,
  `_journal.json`, and migration spec updated per house convention.
- **Entities/catalog parity:** +17 new tables (the seventeen above) plus delivery-note
  column extensions; every table ships SQL + Drizzle + an `ENTITY_CATALOG.md` row
  (CR-36 a).
- **Permissions:** +11 keys — `crm.opportunities`, `crm.campaigns`, `sales.targets`,
  `sales.territories`, `sales.forecasts`, `sales.rebates`, `sales.channels`,
  `pricing.agreements`, `pricing.rules`, `partners.credit_scoring`,
  `portal.customer_accounts`; zero-drift equality re-run at the extended running
  base (CR-36 b).
- **i18n:** ~260–300 new dictionary keys (pipeline board, campaigns, targets,
  territories, pricing, portal, forecasting) ×2 AR/EN; parity equality extended
  (CR-36 c).
- **Docs:** `NAVIGATION_MODEL.md` (`crm` and `sales` groups) · `SALES_AND_CRM.md`
  (pipeline methodology, pricing resolution precedence, rebate accounting) ·
  `JOURNAL_RULES.md` and `ACCOUNTING_INVARIANTS.md` updated for G-75/G-76/INV-043 (reservations re-coordinated 2026-11-13 per [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md) — the original plan's G-76/G-77/INV-042 predate the 044 wave's consumption of those slots) ·
  `BUSINESS_RULES.md` rows for price resolution and credit review triggers.
- **Reports:** +4 code-level contracts — `sales.pipeline-forecast`,
  `sales.campaign-roi`, `sales.target-achievement`, `sales.rebate-accruals`;
  catalog rows mandatory.
- **Feature flags:** `crm.depth` and `sales.customer_portal` — template-composable
  grants (CR-36 f).
- **Goldens and invariants:** G-75 (rebate accrual: the accrued rebate liability
  matches the agreement's progress scale exactly at each period close) · G-76
  (drop-ship COGS timing: COGS recognized at supplier ship-confirm, not at order or
  billing, with the `drop_ship_links` audit chain) · INV-043 (pipeline value
  consistency: weighted pipeline value equals Σ value × probability across every
  surface, with identical stage sets and closed-won exclusions).
- **Architecture:** no new ADR required — pricing resolution and rebate posting
  follow decided engine patterns; the portal reuses the 038 skeleton decisions.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations (≈0124…0128) + Drizzle mirror + `ENTITY_CATALOG.md` rows | api |
| T-02 | Pipeline: `sales_pipeline_stages` config + `opportunities` CRUD + stage transitions with audit | api |
| T-03 | Pipeline board and list screens with drag-between-stages and KPI feed | web |
| T-04 | Campaigns: `campaigns`/`campaign_members`/`campaign_costs` CRUD + ROI computation | api |
| T-05 | Targets and territories: CRUD + vs-actual aggregation + drill-through | api |
| T-06 | Rebates: agreements + periodic accrual job + settlement credit notes (G-75 golden + tests) | api/jobs |
| T-07 | Pricing: `price_agreements` + resolution precedence engine + overlap/priority tests | api |
| T-08 | Pricing: `price_list_rules` formula evaluation (cost + margin + rounding) + preview | api |
| T-09 | `sales_channels` registry + per-channel pricing + migration off free-text channel | api |
| T-10 | Delivery-note scheduling fields + fulfillment planning surface | api/web |
| T-11 | Drop-ship flow: order → supplier PO → ship-confirm → billing, `drop_ship_links` chain (G-76 golden + tests) | api |
| T-12 | Forecasting: weighted pipeline + history baseline + `sales_forecasts` snapshots (INV-043 tests) | api |
| T-13 | Customer portal: `portal_accounts` + statement/invoice/payment-link views + dispute submission | web/api |
| T-14 | Credit scoring: `partner_credit_scores` + automated review triggers + review tasks | jobs |
| T-15 | Screens: `/crm/campaigns`, `/sales/targets`, `/sales/territories`, `/pricing/agreements` + NAV/⌘K registration (OA-04) | web |
| T-16 | Docs (rules, invariants, catalog rows) + RLS attack tests A1–A10 on all 17 tables + full local gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. The pipeline board renders configurable stages (per tenant), moves an opportunity
   between stages with audit history, and the weighted pipeline value on the board
   matches the list, the forecast surface, and the `sales.pipeline-forecast` report
   to the decimal (INV-043 test recorded).
2. A campaign with seeded members and costs computes ROI from attributed revenue;
   attribution rules (lead source, order link) are documented and tested.
3. Sales targets aggregate actuals by rep/team/territory per period with drill-through
   to the contributing documents.
4. Rebate accruals: with a seeded yearly volume agreement, each period close posts
   the accrual matching the progress scale exactly (G-75 golden run green), and
   settlement issues a credit note that clears the accrual.
5. Price resolution: for overlapping `price_agreements`, quantity-bounded and
   channel-specific cases, the precedence engine returns the documented winner in
   every golden test; formula price lists evaluate cost + margin + rounding with
   preview parity.
6. Drop-ship: a customer order generates the linked supplier PO, ship-confirm
   triggers COGS recognition at the documented timing (G-76 golden run green), and
   customer billing completes the chain with the `drop_ship_links` audit trail.
7. The customer portal: a contact-scoped login sees only its partner's statements,
   invoices, and payment links, submits a dispute case that lands in the case
   pipeline (RLS attack tests pass); portal sessions are isolated from staff
   sessions.
8. Credit scoring: automated triggers (aging/exposure thresholds) create review
   tasks with score-class changes audited; the surface complements — never
   duplicates — the dunning ladder from PHASE-039.
9. CR-36 gates: SQL + Drizzle + `ENTITY_CATALOG.md` for all 17 tables · permissions
   zero-drift at the extended base · AR/EN parity equality · `docs:validate` green ·
   RLS attack tests A1–A10 pass · feature-flag gating · sync-surface assessment
   (opportunity/board surfaces assessed for offline clients; portal is online-only;
   OA-02 records the decision) · OA-06 EXPLAIN budgets for the new hot paths
   (pipeline aggregation, price resolution).
10. Completion report `docs/implementation/phases/reports/PHASE-060-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive delivered
    as `ERP_PLATFORM_PHASE060.zip` (OA-07).

## 7. Risks and Constraints

- **Pricing resolution regressions** — layering agreements, channel prices, and
  formulas on top of shipped price lists can silently change every invoice. 
  Mitigated by a golden price-resolution test matrix, a resolution-trace breadcrumb
  on every priced line, and a feature-flag rollout per tenant.
- **Drop-ship COGS timing errors** — recognizing COGS at the wrong event overstates
  or understates margin for a period. Mitigated by G-76 as a golden with a
  full-chain fixture and a close-cycle checklist item.
- **Portal security scope** — customer-contact logins touch financial documents.
  Mitigated by contact-scoped accounts, RLS attack tests, no staff-capability
  inheritance, and rate-limited dispute submission.
- **Forecast credibility** — garbage probability inputs produce confident nonsense.
  Mitigated by per-stage probability defaults, a history-based baseline shown beside
  the weighted number, and visible forecast-versus-actual scoring over time.
- **Rebate accounting complexity** — retroactive scale changes and partial-period
  settlements invite disputes. Mitigated by append-only agreement versions, accrual
  recomputation evidence, and settlement previews before posting.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-060-COMPLETION.md`
  (evidence per acceptance criterion, the pricing-resolution test matrix, G-75/G-76
  golden outputs, INV-043 test output, portal security notes, gate outputs).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-060 row → COMPLETE; `NEXT_ACTION.md`
  points to the next eligible phase PHASE-061 (POS & Retail Depth) per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE060.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-061».
- Handoff notes for PHASE-061: `sales_channels` becomes the anchor for retail
  channel pricing at POS; the customer portal's contact-scoped login model extends
  to loyalty self-service views; campaign members feed loyalty enrollment targeting;
  the price-resolution engine must accept POS-specific rules (per-channel POS
  pricing) without re-architecture.
