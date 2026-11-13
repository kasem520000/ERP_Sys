# PHASE-056 — Payments & Commerce Integrations

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 3 / Stage 14 · **Register:** [CR-26](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 H-09 · §17 N-03/N-04/N-05 · §26.1/§26.2 IN-01…IN-10 · §4 S-13 · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §1 commerce/integrations 3/10 row

## 1. Phase Overview

- **Phase ID:** PHASE-056
- **Title:** Payments & Commerce Integrations (المدفوعات وتكاملات التجارة)
- **Objective:** Resolve DR-002 by taking at least one regional payment provider
  (Moyasar / HyperPay / Tap / PayTabs) to production — the remaining candidates ship
  as sandboxed adapters behind the existing provider port — and build the money-in
  rail end to end: payment links that turn an invoice into a secure hosted checkout,
  webhook-driven reconciliation into receipt posting, refunds, and BNPL capture
  (Tamara/Tabby) with fee and installment cost accounting. On the commerce side,
  implement the existing commerce-port for real: Salla, Zid, Shopify, and WooCommerce
  connections with order staging into sales-invoice drafts, item match rules,
  product/stock push, and fulfillment write-back; document the marketplace ingestion
  paths (Amazon/Noon SP-API); integrate carriers (Aramex/SMSA/DHL) for labels, rates,
  and tracking milestones on invoices; and land aggregator bank-feed statement import
  into the existing bank reconciliation.
- **Business value:** The audit's commerce/integration score is 3/10 and DR-002 has
  been OPEN since 2026-10-27 — payment capability is the sellable-foundation promise
  this wave completes. Payment links convert receivables into one-click collections
  (the PayLink pattern the market expects); BNPL capture meets how Gulf consumers
  actually buy; store connectors eliminate double entry for the Salla/Zid/Shopify
  retail segment; carrier milestones answer "where is my order" inside the invoice;
  and bank feeds remove the last manual copy-paste from reconciliation.
- **الملخص التنفيذي (AR):** تحسم هذه المرحلة قرار DR-002 بتشغيل مزوّد دفع إقليمي واحد على الأقل (Moyasar أو HyperPay أو Tap أو PayTabs) في الإنتاج مع إبقاء البقية في بيئات التجريب، وتبني مسار تحصيل الأموال كاملاً: روابطُ دفع تحوّل الفاتورة إلى صفحة دفع آمنة مستضافة، تُسوّى عبر الويب-هوكس إلى إيصالٍ محاسبي، مع المرتجعات المالية والتقاط التمويل بالتقسيط (Tamara/Tabby) بمحاسبةِ الرسوم وتكلفة التقسيط (G-74). وفي جانب التجارة تُنفَّذ واجهة `commerce-port` فعلياً: اتصالات Salla وZid وShopify وWooCommerce، استيرادُ الطلبات إلى مسودات فواتير بيع بقواعد مطابقة أصناف، ودفعُ المنتجات والمخزون وكتابةُ حالة التنفيذ؛ مع توثيق مسارات أسواق Amazon/Noon، وتكامل شركات الشحن (Aramex/SMSA/DHL) بالملصقات والأسعار ومراحل التتبع على الفاتورة (S-13)، واستيرادُ كشوف البنوك عبر مجمّع يغذي التسوية المصرفية القائمة — كل ذلك فوق سجلِّ استيعاب أحداثٍ موثوقٍ (idempotent) يحفظ توازن الدفع (G-73).

## 2. Scope

In scope:

1. **Production payment provider adapter — DR-002 resolution** (H-09, N-03, IN-02):
   the owner's spike evidence selects one of Moyasar/HyperPay/Tap/PayTabs for
   production; the chosen adapter goes live behind the existing provider port, the
   other candidates ship as sandboxed adapters; the DR-002 record is updated with the
   resolution and evidence.
2. **`payment_links`** (IN-03): invoice → secure hosted link → checkout → webhook
   reconcile → receipt posting; link lifecycle (issued, paid, expired, cancelled)
   with INV-041 idempotency — one payment event posts exactly one receipt; delivery
   of the link through the communications channels (email/WhatsApp).
3. **Refunds flow**: refund requests against paid invoices posting reversal journals
   and marking link/invoice state; partial and full refunds.
4. **BNPL capture** (IN-04): Tamara/Tabby installment plans recorded at capture with
   fee/cost accounting (G-74) and reconciliation of provider settlements.
5. **`payment_provider_events`**: the idempotent webhook ingestion ledger — every
   provider callback recorded by provider event id, deduplicated, then processed;
   re-deliveries never double-post (feeds G-73).
6. **`commerce_channel_connections`** (N-04, IN-07): OAuth tokens per store for
   Salla, Zid, Shopify, WooCommerce — implementations of the existing commerce-port;
   connection health and token refresh surfaced in the integrations screen.
7. **`store_order_staging`**: store orders imported to a staging table mapped into
   sales-invoice drafts with item match rules (SKU/barcode/name+price fallback) —
   unmatched items queue for manual matching and never auto-post.
8. **Product/stock push jobs and fulfillment write-back**: catalog and stock pushed
   to connected stores on a job schedule; fulfillment/tracking status written back
   when shipments occur.
9. **Marketplace ingestion paths** (IN-08): the Amazon/Noon SP-API documented paths —
   connection model, order ingestion, and limitation notes; ingestion follows the
   same staging pipeline where the API permits.
10. **`carrier_shipments`** (S-13, IN-09, IN-10, N-05): Aramex/SMSA/DHL integrations
    — rate quotes, label generation, and tracking milestones attached to invoices;
    milestone events update the invoice shipment panel and notify customers.
11. **Bank feeds** (IN-01, N-09): aggregator statement import into the existing bank
    reconciliation — `bank_feed_imports` records the fetch, statement lines land in
    the existing reconciliation surfaces; no new reconciliation engine.

Out of scope: BNPL underwriting or risk scoring · full marketplace sync beyond the
documented SP-API paths · loyalty/gift cards (061) · customer-portal payment
surfaces (060 — links are invoice-side here) · subscription billing changes (shipped,
do not touch) · payroll/payout rails.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-041 (Communications Hub) COMPLETE | REQUIRED — payment-link delivery channels |
| PHASE-055 (Public API & Webhooks Platform) COMPLETE | REQUIRED — webhook ingestion ledger, scoped keys, delivery console |
| Payment provider adapter port + manual fallback | SHIPPED stages 1–11 (DR-002 context) — the port is implemented, not redesigned |
| commerce-port interface | SHIPPED — implementations land here |
| Bank reconciliation + `bank_statement_lines` baseline | SHIPPED — the feed target, unchanged |

Per [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5 both edges
are hard rules: 041 before 056 (delivery channels) and 055 before 056 (webhooks and
events feed commerce reconciliation).

## 4. Design Impact

- **Migrations**: 4, next in sequence — `0107_payment_links.sql` (links + provider
  events), `0108_commerce_channels.sql` (connections + staging),
  `0109_carriers.sql` (shipments + milestone events), `0110_bank_feeds.sql` (feed
  imports). The journal continues from the Wave sequence (expected 0049…0106 after
  phases 036–055); exact numbers assigned at implementation as the next free
  sequence, strictly increasing, with `_journal.json` + `migrations.ts/spec` updated.
- **Entities/catalog**: +7 tables (`payment_links`, `payment_provider_events`,
  `commerce_channel_connections`, `store_order_staging`, `carrier_shipments`,
  `carrier_shipment_events`, `bank_feed_imports`) — SQL + Drizzle mirror +
  `ENTITY_CATALOG.md` rows (CR-36 a).
- **Permissions**: +8 keys across `billing.*` and `integrations.*` (payment links,
  refunds, BNPL, channels, staging, carriers, bank feeds, marketplaces); zero-drift
  check re-extended (registry = seed, cumulative v3.0 count).
- **i18n**: ~200 new AR/EN keys (payment-link UI, refund flow, BNPL terms, channel
  connections, staging review queue, shipment panel, bank-feed import); parity check
  extended.
- **Docs** (reservations re-coordinated 2026-11-13 per [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md) — the original plan's G-74/G-75/INV-040 predate the 044 wave's consumption of those slots): `JOURNAL_RULES.md` (G-73/G-74),
  `ACCOUNTING_INVARIANTS.md` (INV-041),
  the DR-002 decision record update, `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`,
  `FEATURE_CATALOG.md`, `NAVIGATION_MODEL.md`, integration guides per provider and
  per commerce platform (the `docs/api/integrations` set), THREAT_MODEL update for
  hosted-checkout scope.
- **Reports**: +3 contracts — `billing.payment-links`, `integrations.store-imports`,
  `integrations.shipments` (catalog rows mandatory).
- **Feature flags**: `billing.payment_links`, `billing.bnpl`, `integrations.commerce`,
  `integrations.carriers`, `integrations.marketplaces`, `integrations.bank_feeds` —
  template-composable grants.
- **No architectural change** — adapters implement existing ports (payment provider
  port, commerce-port) inside the integrations module boundary; hosted checkout keeps
  the platform out of PCI scope (no card data stored or transited). Offline sync
  assessment: read-only shipment/payment status panels assessed for sync clients;
  all ingestion jobs are online-only (N/A recorded per CR-36 g).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations 0107–0110 + journal/spec updates | api |
| T-02 | Drizzle mirrors + `ENTITY_CATALOG.md` rows + RLS policies + attack tests A1–A10 | api |
| T-03 | DR-002 resolution: spike evidence review, provider selection, decision record update | docs |
| T-04 | Production payment adapter (selected provider) + sandboxed adapters for the remaining candidates | api |
| T-05 | Payment links: lifecycle, hosted checkout redirect, secure link delivery via 041 channels, INV-041 | api |
| T-06 | Payment reconciliation: `payment_provider_events` idempotent ingestion → receipt posting, G-73 | api |
| T-07 | Refunds flow (full/partial) with reversal journals | api |
| T-08 | BNPL capture: Tamara/Tabby plans, fee/installment cost accounting, G-74 | api |
| T-09 | Commerce connections: OAuth for Salla/Zid/Shopify/WooCommerce, token refresh, connection health | api |
| T-10 | Store order staging: import, item match rules, review queue, sales-invoice draft mapping | api |
| T-11 | Product/stock push jobs + fulfillment status write-back | api |
| T-12 | Marketplace SP-API documented paths (Amazon/Noon) + ingestion where permitted | api |
| T-13 | Carrier integrations: rates, labels, tracking milestones on invoices (S-13) | api |
| T-14 | Bank feeds: aggregator statement import into the existing bank reconciliation | api |
| T-15 | Screens: `/billing/payment-links`, `/integrations/channels`, `/integrations/carriers`, payment webhook console | web |
| T-16 | Docs: integration guides, goldens G-73/G-74, INV-041, catalog/report/feature/nav updates | docs |
| T-17 | Run full local gates (typecheck/lint/boundaries/tests/docs/i18n parity/permissions drift/manifests) and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0107–0110 apply cleanly; Drizzle mirrors and `ENTITY_CATALOG.md` rows
   present; RLS attack tests A1–A10 pass for all seven new tables.
2. DR-002 is resolved in the decision record with the spike evidence attached; the
   selected provider's adapter completes a sandbox end-to-end flow (authorize,
   capture, refund, webhook) and the production credentials path is documented;
   non-selected candidates remain functional sandboxed adapters behind the port.
3. Payment links: an invoice generates a hosted link; completing checkout fires the
   provider webhook; the receipt posts exactly once (INV-041) — a duplicated
   provider event delivery is proven inert by replaying it in tests.
4. Golden G-73: the payment reconciliation ledger ties provider events, receipts,
   and invoice balances — the seeded fixture set reconciles to zero variance.
5. Refunds: full and partial refunds post reversal journals and update link and
   invoice state; the refund never double-reverses on webhook replay.
6. BNPL: a Tamara/Tabby-style capture records the installment plan, posts the
   provider fee and BNPL cost entries (G-74), and reconciles against the settlement
   statement fixture.
7. Commerce: a Salla/Zid/Shopify/WooCommerce sandbox store connects via OAuth,
   imports orders into staging, maps them to sales-invoice drafts with item match
   rules; an unmatched SKU lands in the review queue and never auto-posts; a
   fulfillment write-back round-trips to the store.
8. Carriers: rate quote, label generation, and tracking milestones attach to an
   invoice; milestone updates notify the customer through the 041 channels — S-13
   closed.
9. Bank feeds: an aggregator statement import produces statement lines in the
   existing bank reconciliation and matches seeded transactions; all CR-36
   discipline gates green (catalog parity, permissions zero-drift, AR/EN parity,
   `docs:validate`, RLS tests, feature flags, sync-surface assessment recorded).
10. Completion report `reports/PHASE-056-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE056.zip` (OA-07).

## 7. Risks and Constraints

- **Money-movement correctness** — duplicate webhooks, partial captures, and refund
  races can double-post receipts; mitigated by the idempotent provider-event ledger,
  INV-041, G-73, and replay tests as acceptance criteria.
- **Provider sandbox drift and credential secrecy** — sandboxes behave differently
  from production; mitigated by fixture-based tests, the DR-002 evidence gate before
  production cutover, and secrets stored through the existing secrets baseline
  (never in plain columns or logs).
- **PCI scope** — any card data touching the platform expands compliance burden;
  mitigated by hosted-checkout-only integration (no card data stored, logged, or
  transited), documented in the threat model update.
- **Item-match ambiguity** — store catalogs drift from the ERP catalog; mitigated by
  confidence-scored match rules, a manual review queue, and the never-auto-post rule
  for unmatched items.
- **Third-party rate limits and outages** — carriers and stores throttle aggressive
  polling; mitigated by job-based scheduling with backoff and connection-health
  surfaces that degrade gracefully.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-056-COMPLETION.md`
  (evidence per criterion, gate output, the DR-002 resolution bundle, the provider
  sandbox evidence, the commerce/carrier/bank-feed integration matrices).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-056 row → COMPLETE; `NEXT_ACTION.md`
  → PHASE-057 (BI & Analytics) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE056.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-057».
- Handoff notes for PHASE-057: the payment and commerce event ledgers shipped here
  become first-class data sources for BI dashboards (revenue by channel, payment
  mix, BNPL cost); the delivery console pattern from PHASE-055 generalizes to the
  report-delivery subscription surfaces planned there.
