# Feature Catalog

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-11-08

The canonical, exhaustive registry of product features. Every feature has exactly one
**feature key** (`module.feature_name`). This file is the single source of truth referenced by:

- [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md) — which plan grants which feature key.
- [CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) — feature-dependency closure and conflict rules.
- [INDUSTRY_CATALOG.md](INDUSTRY_CATALOG.md) — which features each industry template emphasizes.
- [BUSINESS_RULES.md](BUSINESS_RULES.md) and [USER_JOURNEYS.md](USER_JOURNEYS.md) — rule and journey traceability.
- [../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) — phase documents cite keys in their scope tables.

Modules mirror the bounded contexts in
[../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md). If a capability
is not listed here, it does not exist as an entitlement-bearing feature and adding it requires
the maintenance protocol in §25.

> **Permission key reconciliation note (normative).** Feature keys and permission keys
> (`module.resource.action`) are different identifiers serving different layers
> (entitlements vs authorization). The **canonical permission catalog is
> [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md)** — where a
> permission column in this file drifts from it, AUTHORIZATION_MATRIX wins and this file
> must be corrected. Known reconciliations: POS permissions are the `pos.*` set
> (`pos.terminals.manage`, `pos.sales.sell`, `pos.shifts.manage`,
> `pos.receipts.print` — matrix §3.8, migration 0024) plus the reused
> `sales.pos_session.*` session keys (matrix §3.2) the pos module's shift and
> sync routes enforce; template administration is
> `configuration.templates.*` (not `industry.templates.*`); BOM is
> `manufacturing.boms.*`; settlements use `distribution.settlements.approve`;
> device management is `sync.devices.register/revoke` + `identity.devices.manage`.
> Blueprint v2.0 financial-depth modules own their permission homes directly —
> `fixed_assets.*`, `notes.*`, `installments.*`, `budgeting.*`, `payroll.*`,
> `consolidation.*` (matrix sections §3.11…§3.15) per
> [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §K.
> Implementing phases must reconcile any drift in the same PR (per
> [../testing/REGRESSION_STRATEGY.md](../testing/REGRESSION_STRATEGY.md) §6 docs-drift check).

## 1. Feature key naming rules

1. **Format**: `module.feature_name` — lowercase module, a dot, then a `snake_case` feature
   name. Examples: `sales.invoices`, `inventory.multi_warehouse`, `pos.offline_queue`.
2. **Module segment** MUST be one of the 22 catalog modules below (which map 1:1 or as
   documented aggregates to the module catalog): `platform`, `accounting`, `partners`,
   `items`, `inventory`, `sales`, `purchasing`, `treasury`, `tax`, `reporting`, `crm`,
   `manufacturing`, `distribution`, `pos`, `offline`, `industry`, plus the Blueprint v2.0
   financial-depth modules `fixed_assets`, `notes`, `installments`, `budgeting`,
   `payroll`, `consolidation` (§19–§24, [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §D).
3. **Feature segment** is a noun or noun-phrase describing the user-visible capability
   (`invoices`, `stock_counts`, `bank_reconciliation`) — never a verb, never a phase, never a
   screen name.
4. **Permission keys are a related but distinct namespace**: `module.entity.action`
   (e.g., `sales.invoices.post`, `accounting.journal_entries.create`, `pos.shifts.manage`).
   A feature key usually implies several permission keys; the mapping is seeded in the
   `permissions` table (see [../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md)) and
   consumed by role templates (`owner`, `accountant`, `sales`, `purchasing`, `warehouse`,
   `cashier`, `viewer`).
5. **Industry template IDs** use `industry.<template>` (e.g., `industry.retail`) — see
   [INDUSTRY_CATALOG.md](INDUSTRY_CATALOG.md). Template IDs are configuration artifacts, not
   feature keys, and never appear in entitlement tables directly; plan **add-ons** bundle
   feature keys instead.
6. Keys are immutable once shipped: renaming a key requires a decision record plus a
   migration of `entitlements` rows — prefer never.
7. **No orphan keys**: every key must appear in at least one plan or add-on in
   [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md), and in at least one
   phase's scope.

## 2. Priority and phase legend

| Priority | Delivered by | Meaning |
|----------|--------------|---------|
| **MVP** | PHASE-006…014 (platform base PHASE-002…005) | Part of the Minimum Viable Commercial Release ([../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) MVP gate) |
| **1** | PHASE-015…019 | Industry expansion, POS, manufacturing, CRM |
| **2** | PHASE-020…022 | Offline sync foundation and native clients |
| **3** | PHASE-023…025 | Integrations, enterprise hardening, GA-tier features |
| **4** | PHASE-026…034 | Blueprint v2.0 post-GA expansion — financial depth, industry expansion II, enterprise consolidation ([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §B; MVP and GA gates unchanged — ED-01) |

Priority is derived from the delivering phase. Where [../PRODUCT_REQUIREMENTS.md](../PRODUCT_REQUIREMENTS.md)
groups a capability in a different tier (e.g., manufacturing at PHASE-018 is grouped with
tier-2 capabilities in FR-MFG-001), the phase-derived priority in this catalog is
authoritative for entitlement purposes. The **Phase** column is the first phase whose
acceptance criteria include the feature; a phase in parentheses (e.g., `006 (draft) / 007 (post)`)
marks a staged delivery.

## 3. Module: platform

Tenant lifecycle, administration, audit, notifications, and the commercial machinery. Backed
by the `tenancy`, `identity`, `audit`, `notifications`, and `files` modules.

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `platform.registration` | Registration · التسجيل | Public sign-up capturing business name (AR/EN), country, base currency, tax-registration status, and business activity; creates tenant + owner membership | MVP | 004 | public (rate-limited) | — |
| `platform.onboarding` | Onboarding wizard · معالج التهيئة الأولى | Guided setup producing the initial workspace: jurisdiction pack, CoA template, branches, numbering, terminology, opening-balance drafts | MVP | 004 (backend) / 014 (guided UX) | `platform.onboarding.manage` | `platform.registration` |
| `platform.tenant_lifecycle` | Tenant lifecycle · دورة حياة المستأجر | active / suspended / restored / offboarded states with per-transition audit; suspension kills sessions and rejects sync (see [../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §6) | MVP | 004 | `platform.tenants.manage` | `platform.registration` |
| `platform.branches` | Branch & warehouse registry · سجل الفروع والمستودعات | Register branches and their warehouses; per-branch codes feed numbering and scoping | MVP | 004 | `platform.branches.manage` | `platform.tenant_lifecycle` |
| `platform.users_roles` | Users, roles & invitations · المستخدمون والأدوار | Membership invitations, system role templates (owner, accountant, sales, purchasing, warehouse, cashier, viewer), branch-scoped membership | MVP | 003 / 004 | `platform.users.invite` | `platform.tenant_lifecycle` |
| `platform.audit_trail` | Audit trail · سجل التدقيق | Immutable `audit_events` with actor, time, before/after; filterable console per entity/actor/correlation id | MVP | 003 | `platform.audit.read` | — |
| `platform.entitlements` | Entitlement service · خدمة الاستحقاقات | Materializes effective feature grants per tenant (plan + add-ons + overrides); consumed server-side at module load and per action | MVP | 004 | `platform.entitlements.manage` | `platform.tenant_lifecycle` |
| `platform.subscriptions` | Subscriptions & billing · الاشتراك والفوترة | Plan assignment, checkout via payment-provider adapter with manual-invoicing fallback, renewal, dunning, plan-change history | MVP | 014 | `platform.subscriptions.manage` | `platform.entitlements` |
| `platform.payouts` | Refunds & payout reconciliation · الاستردادات وتسوية دفعات المزوّد | **SHIPPED PHASE-023** (migration 0035): the provider refund call on the sandbox adapter port (audited `payment.refunded` billing event — the invoice stays PAID, history append-only) + payout-batch reconciliation (sync provider-reported gross/fee/net batches; compare against settled platform payments in the window → RECONCILED or DRIFT with detail, never auto-corrected; the runPayoutReconciliation job). Sandbox depth until [product/DR-002](../decisions/product/DR-002-payment-provider-selection.md) decides the provider — no production cutover claim | 3 | 023 (sandbox depth; DR-002 OPEN) | `platform.subscriptions.manage` | `platform.subscriptions` |
| `platform.admin_console` | Platform admin console · وحدة تحكم المنصة | Internal staff console: tenant search, status changes, entitlement overrides, suspension, audit review — every action tenant-scoped + audited | MVP | 004 | `platform.admin.access` | `platform.entitlements` |
| `platform.support_access` | Support access · وصول الدعم | Time-boxed, reason-required, audited impersonation of a tenant user by platform staff; tenant-visible entry in audit trail | MVP | 004 | `platform.support.access` | `platform.admin_console` |
| `platform.support_review` | Support-access review report · تقرير مراجعة وصول الدعم | **SHIPPED PHASE-024** (T12; matrix §7): the platform review report over a window — every support session with its grant + end + proxied-read counts + the explicit gap list (expired-unclosed / zero-action / orphaned reads); platform-provided (never plan-metered — security tooling is not paywalled, the `platform.support_access` precedent) | MVP | 024 | `platform.support.access` | `platform.support_access` |
| `identity.mfa_policy` | MFA enforcement policy · سياسة إلزام المصادقة الثنائية | **SHIPPED PHASE-024** (T4; ADR-0015 §4): plan-level `mfa_required_role_keys` + the `identity.mfa.policy` tenant override (mode plan/custom), enforced at login (423 MFA_REQUIRED with `enrollmentRequired` until the 15-minute enrollment-bootstrap session completes) + admin-assisted reset (`identity.mfa.admin_reset`'s first route) + the WebAuthn decision record (DR-024-01: deferred post-GA); platform-provided (never plan-metered) | MVP | 024 | `tenancy.settings.manage` + `identity.mfa.admin_reset` | `platform.users_roles` |
| `audit.review_console` | Tenant audit review console · واجهة مراجعة سجل التدقيق للمستأجر | **SHIPPED PHASE-024** (T8): the tenant-admin audit review surface — actor/action/entity/correlation-id/time filters on `GET /audit/events`, the bounded audited CSV export (E-04), the correlation-id lookup, the web `/audit` screen (NAV gated `audit.view`); platform-provided (never plan-metered) | MVP | 024 | `audit.view` | `platform.audit_trail` |
| `platform.notifications` | Notifications · الإشعارات | In-app inbox + email at MVP; SMS/push adapters later. Event-driven (invoice.overdue, stock.below_reorder, einvoice failures, sync rejections). **Split note (PHASE-014): the billing-critical subset shipped 014** — in-app inbox + preferences + owner emails for limit warnings, subscription state changes, invoice.overdue, stock.below_reorder, reconciliation/assertion failures; **PHASE-015 generalized the in-app leg** (category domains widened to `stock` + `templates`: BR-019 reorder digests, template upgrade offers — never auto-applied); e-invoice/sync event integrations and SMS/push adapters remain with their owning phases (023/020+) | MVP | 003 (email) / 014 (billing-critical in-app) / 015 (generalized in-app) | `platform.notifications.manage` | — |
| `platform.files` | Attachments & files · المرفقات | Tenant-scoped file objects (receipts, contracts, exports) with signed URLs and upload validation | MVP | 002 (infra) / 006 (usage) | `platform.files.upload` | — |
| `platform.data_export` | Tenant data export · تصدير بيانات المستأجر | Full structured export (JSON + CSV per entity + document PDFs) used for offboarding and on-demand download | MVP | 014 | `platform.tenants.manage` | `platform.tenant_lifecycle` | *(marker corrected 004→014 per PHASE-004 §2: the export/offboarding flows land with the PHASE-014 billing/offboarding work; the `tenancy.export.request`/`tenancy.offboarding.execute` permissions exist in the PHASE-003 seed — corrected at PHASE-004 completion)* |

## 4. Module: accounting

The double-entry core. All features enforce the invariants in
[../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md); postings go
through the centralized engine ([ADR-0007](../architecture/ADR/ADR-0007-centralized-posting-engine.md)).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `accounting.chart_of_accounts` | Chart of accounts · دليل الحسابات | Bilingual hierarchical CoA; leaf-only posting; system purpose mapping (AR_CONTROL, VAT_PAYABLE, …) onto tenant accounts | MVP | 007 | `accounting.coa.manage` | `platform.onboarding` |
| `accounting.fiscal_calendar` | Fiscal calendar · السنة والفترات المالية | Fiscal years, monthly periods, OPEN / SOFT_CLOSED / LOCKED states with audited transitions | MVP | 007 | `accounting.periods.manage` | — |
| `accounting.journal_entries` | Journal entries · قيود اليومية | Manual journals with drafts, templates, bilingual memos; posted entries immutable (INV-003), reversal-only correction (INV-014) | MVP | 007 | `accounting.journal_entries.create` | `accounting.chart_of_accounts` |
| `accounting.recurring_journals` | Recurring journals · القيود الدورية | Scheduled pg-boss generation of draft entries from recurrence definitions; never auto-posts | MVP | 007 | `accounting.recurring_journals.manage` | `accounting.journal_entries` |
| `accounting.approvals` | Approval workflows · اعتماد المستندات | Per-document-type policies: none / single / two-step / amount-threshold; self-approval blocked by default; preview equals posting | MVP | 007 | `accounting.approvals.configure` | `accounting.journal_entries` |
| `accounting.general_ledger` | General ledger · دفتر الأستاذ العام | GL listing with account drill-down to source documents; filters mirror GL report parameters | MVP | 007 | `accounting.gl.read` | `accounting.journal_entries` |
| `accounting.opening_balances` | Opening balances · الأرصدة الافتتاحية | Draft opening balances for accounts, partners, cash, and stock (PHASE-006 drafts); posted once via opening period (PHASE-007) | MVP | 006 (draft) / 007 (post) | `accounting.opening_balances.post` | `accounting.fiscal_calendar` |
| `accounting.multi_currency` | Multi-currency · تعدد العملات | Dated exchange-rate table, per-document rate override, realized FX differences at settlement, optional unrealized revaluation run | MVP | 007 | `accounting.multi_currency` | `accounting.journal_entries` |
| `accounting.cost_centers` | Cost centers · مراكز التكلفة | Analytical dimension on journal lines; basic tree at PHASE-007 | MVP | 007 | `accounting.cost_centers.manage` | `accounting.journal_entries` |
| `accounting.projects` | Projects dimension · المشاريع | Second analytical dimension linked to service contracts and job costing | 1 | 019 (shipped 2026-11-03) | `accounting.projects.manage` | `accounting.cost_centers` |
| `accounting.period_close` | Period close · إقفال الفترة | System-verified close checklist (subledgers, bank recs, recurring journals, FX, counts, VAT) → SOFT_CLOSED → LOCKED; monitored reopen | MVP | 007 | `accounting.period_close` | `accounting.fiscal_calendar` |
| `accounting.year_end_close` | Year-end close · إقفال السنة | Closing entry to retained earnings, reversible as a unit; prior-year statements immutable | MVP | 007 | `accounting.year_end_close` | `accounting.period_close` |
| `accounting.reconciliation` | Reconciliation health center · مساحة المطابقة | Scheduled + on-demand subledger↔control checks (AR, AP, inventory, WIP, cash, VAT, GRNI) with drift triage; flagship screen | MVP | 007 (jobs) / 013 (workspace) | `accounting.reconciliation.run` | `accounting.general_ledger` |
| `accounting.fixed_assets` | Fixed assets & depreciation · الأصول الثابتة | Asset register and depreciation schedules | 3 | 025 (scope review) | `accounting.fixed_assets.manage` | `accounting.chart_of_accounts` |

## 5. Module: partners

Unified party model (customers, suppliers, both) — [../accounting/RECEIVABLES_AND_PAYABLES.md](../accounting/RECEIVABLES_AND_PAYABLES.md).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `partners.directory` | Partner directory · دليل جهات التعامل | Unified partners with bilingual names, tax numbers, contacts, addresses, kind (customer/supplier/both), status | MVP | 006 | `partners.manage` | `platform.onboarding` |
| `partners.credit_terms` | Credit terms · شروط الدفع | Payment terms (net 7/15/30/60/custom) assigned per partner; drive due dates | MVP | 006 | `partners.credit_terms.manage` | `partners.directory` |
| `partners.credit_management` | Credit management · إدارة الائتمان | Per-partner credit limit + overdue policy (block/warn/ignore) enforced at sales-document approval (BR-001) | MVP | 012 | `partners.credit.manage` | `partners.credit_terms` |
| `partners.statements` | Partner statements · كشوف الحسابات | Open items + activity with running balance and aging, bilingual RTL print, as-of determinism | MVP | 012 (data) / 013 (print) | `partners.statements.read` | `partners.directory` |
| `partners.personal_accounts` | Personal account views · الحسابات الشخصية | Shareable-documents-only mobile view of balance, invoices, receipts for the partner's own scope | 2 | 022 | customer-scoped token | `partners.statements` |
| `partners.customer_portal` | Customer self-service portal · بوابة العملاء | Web self-service: statements, invoice download, dispute messages | 3 | 023–025 | customer-scoped token | `partners.personal_accounts` |

## 6. Module: items

Item master data shared by all trading flows.

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `items.item_master` | Item master · بطاقة الصنف | Items (stock/service/composite) with bilingual names, category, default UoM, tax code, costing method, tracking flags, reorder defaults | MVP | 006 | `items.manage` | `platform.onboarding` |
| `items.categories` | Item categories · تصنيفات الأصناف | Hierarchical bilingual taxonomy; drives default tax codes and reporting | MVP | 006 | `items.categories.manage` | `items.item_master` |
| `items.units_of_measure` | Units of measure · وحدات القياس | UoM registry with conversion factors and per-UoM pricing/barcodes | MVP | 006 | `items.uom.manage` | `items.item_master` |
| `items.barcodes` | Barcodes · الباركود | Multiple barcodes per item, per UoM; consumed by POS scanning and count sheets | MVP | 006 | `items.barcodes.manage` | `items.item_master` |
| `items.price_lists` | Price lists · قوائم الأسعار | Sale/purchase price lists with validity, per-UoM prices, min-qty tiers; precedence per BR-003 | MVP | 006 | `items.price_lists.manage` | `items.item_master` |
| `items.import_export` | Import & export · الاستيراد والتصدير | XLSX/CSV import of partners, items, opening balances with dry-run validation and row-level error reports | MVP | 006 | `items.import` | `items.item_master`, `partners.directory` |
| `items.composite_products` | Composite products · المنتجات المركبة | Bundles and kits exploded into components at issue; recipe maintenance | 1 | 015 | `items.composites.manage` | `items.item_master`, `inventory.stock_ledger` |

## 7. Module: inventory

Stock ledger and valuation — accounting rules in
[../accounting/INVENTORY_ACCOUNTING.md](../accounting/INVENTORY_ACCOUNTING.md).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `inventory.multi_warehouse` | Multi-warehouse stock · تعدد المستودعات | Stock per warehouse per branch; branch-level visibility rules; van warehouses appear at PHASE-017 | MVP | 010 | `inventory.warehouses.manage` | `platform.branches` |
| `inventory.stock_ledger` | Stock ledger · سجل حركة المخزون | Immutable `stock_moves` (receipt/issue/transfer/adjust) with reason, valuation, source document; atomic with journals (INV-018) | MVP | 010 | `inventory.read` | `items.item_master`, `inventory.multi_warehouse` |
| `inventory.valuation` | Valuation (WAC/FIFO) · تقييم المخزون | Weighted average (default) or FIFO layers per tenant, consistent per item; method switch = dated revaluation posting (INV-017) | MVP | 010 | `inventory.valuation.read` | `inventory.stock_ledger` |
| `inventory.batch_tracking` | Batch & expiry tracking · تتبع الدفعات والصلاحية | Batches/lots with expiry; FEFO issuing for expiry-enabled items; expiry write-off workflow | MVP | 010 | `inventory.batches.manage` | `inventory.stock_ledger` |
| `inventory.serial_tracking` | Serial & IMEI tracking · الأرقام التسلسلية ورمز الجهاز | Per-unit serials/IMEI with in_stock/sold/returned status; sale and return bind units | MVP | 010 | `inventory.serials.manage` | `inventory.stock_ledger` |
| `inventory.stock_counts` | Stock counts · جرد المخزون | Count sessions (full/partial, blind option), snapshot of system qty, variance review, adjustment posting (BR-015) | MVP | 010 | `inventory.counts.manage` | `inventory.stock_ledger` |
| `inventory.stock_transfers` | Stock transfers · تحويل المخزون | Warehouse-to-warehouse moves with IN_TRANSIT state (visible, not sellable); two-leg stock effect | MVP | 010 | `inventory.transfers.manage` | `inventory.stock_ledger` |
| `inventory.reservations` | Stock reservations · حجوزات المخزون | Reservation pool for confirmed orders with expiry; hard/soft reservation policies (soft availability check exists from PHASE-012) | 1 | 015 | `inventory.reservations.manage` | `inventory.stock_ledger`, `sales.orders` |
| `inventory.reorder_levels` | Reorder levels · مستويات إعادة الطلب | Per-item-per-warehouse reorder points (fields from PHASE-010) with `stock.below_reorder` notifications and replenishment suggestions | 1 | 015 | `inventory.reorder.manage` | `inventory.stock_ledger`, `platform.notifications` |

## 8. Module: sales

Order-to-cash documents and receivables (job cards + commissions added by
**PHASE-017**, migration `0025_automotive_distribution.sql`; the former
CAPABILITY_MATRIX §3 intake key `sales.job_cards` is a full catalog row since 017 with
its plan grants per §25 step 3 — the CAPABILITY_MATRIX §2.6 reconciliation resolved:
job cards ship as a sales-module document with no contract dependency; PHASE-019
generalizes into `crm.service_orders`).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `sales.quotations` | Quotations · عروض الأسعار | DRAFT → SENT → ACCEPTED (converts to order) / REJECTED / EXPIRED; no ledger effect | MVP | 012 | `sales.quotations.manage` | `items.price_lists`, `partners.directory` |
| `sales.orders` | Sales orders · أوامر البيع | Confirmed orders with line reservations policy, branch + warehouse targeting; source of deliveries and invoices | MVP | 012 | `sales.orders.manage` | `sales.quotations`, `inventory.stock_ledger` |
| `sales.deliveries` | Delivery notes · إشعارات التسليم | Goods-out documents posting COGS without AR; convert to invoice later | MVP | 012 | `sales.deliveries.manage` | `sales.orders`, `inventory.stock_ledger` |
| `sales.invoices` | Sales invoices · فواتير البيع | Cash/credit invoices with tax snapshot per line, auto-post policy for cash sales (BR-005), official numbering (BR-029) | MVP | 012 | `sales.invoices.post` | `sales.orders`, `tax.engine` |
| `sales.credit_notes` | Credit notes · الإشعارات الدائنة | Returns and corrections referencing invoices; stock re-entry at original cost; return-window policy (BR-004) | MVP | 012 | `sales.credit_notes.post` | `sales.invoices` |
| `sales.receipts` | Receipts · سندات القبض | Cash/bank/cheque receipts with FX rates; AR posting and settlement | MVP | 012 | `sales.receipts.post` | `treasury.accounts` |
| `sales.allocations` | Allocations · التخصيصات | Explicit receipt↔invoice allocations, FIFO suggestion, partial + on-account amounts (INV-016) | MVP | 012 | `sales.allocations.manage` | `sales.receipts`, `sales.invoices` |
| `sales.credit_limits` | Credit limits · حدود الائتمان | Credit-limit + overdue enforcement configuration at sales approval (block/warn/ignore) — see BR-001 | MVP | 012 | `sales.credit_limits.configure` | `partners.credit_management` |
| `sales.receivables_aging` | Receivables aging · أعمار الديون | Aging buckets from open items at as-of date; overdue notifications (invoice.overdue) | MVP | 012 | `sales.receivables.read` | `sales.invoices`, `sales.allocations` |
| `sales.reps` | Sales representatives · مندوبو المبيعات | Rep records with attribution on sales documents (PHASE-012) | MVP | 012 | `sales.reps.manage` | `partners.directory` |
| `sales.commissions` | Commissions · العمولات | **SHIPPED PHASE-017** — per-rep rules (flat or tiered bands; INVOICED/COLLECTED basis), runs with accrual posting at run time (DR commissions expense · CR accrued commissions — POSTING_ENGINE §4), exclusion note-lines for basis mismatches, payouts via treasury payments; commissions never modify an invoice or its VAT | 1 | 017 | `sales.commissions.manage` | `sales.reps` |
| `sales.discount_management` | Discounts & free goods · الخصومات والسلع المجانية | Line/document discounts with role ceilings (BR-002) and free-goods lines; PHASE-017 adds reason-coded zero-price FOC lines (BR-008 — `foc_reason_code` on invoice lines; full COGS, zero revenue) + the rule-based engine lives at `distribution.free_goods` | MVP | 012 → 017 (FOC reason codes) | `sales.discounts.apply` | `sales.invoices` |
| `sales.job_cards` | Job cards · بطاقات العمل | Workshop work order (parts + labor lines) DRAFT → IN_PROGRESS → COMPLETED → INVOICED + CANCELLED; diagnosis quotation, reservation/issue linkage (reserve vs issue-immediate COGS), warranty credit notes — **SHIPPED PHASE-017** (migration `0025`; `industry.automotive`'s REQUIRED capability) | 1 | 017 | `sales.job_cards.manage` | `sales.quotations`, `inventory.reservations` |
| `sales.commerce_channels` | Commerce channel staging · استيراد طلبات قنوات التجارة | **SHIPPED PHASE-023** (migration 0035): e-commerce channel order import through the `CommerceChannelPort` (the fake adapter ships first — no real channel claimed; `ShippingPort` reserved with a fake): upsert by natural key per (tenant, channel, channel order id) with Idempotency-Key batches (duplicate batches replay the recorded outcome); financial-field drift on re-import flags CONFLICT for explicit human resolution (KEEP_EXISTING / TAKE_INCOMING — ADR-0012, never last-write-wins) | 3 | 023 | `sales.commerce.manage` | `partners.directory` |

## 9. Module: purchasing

Procure-to-pay documents and payables.

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `purchasing.requests` | Purchase requests · طلبات الشراء | Internal requisitions with approval routing to PO creation | MVP | 011 | `purchasing.requests.manage` | `items.item_master` |
| `purchasing.orders` | Purchase orders · أوامر الشراء | DRAFT → ISSUED → CLOSED with linked revisions; supplier, branch, expected date, approval thresholds (BR-010) | MVP | 011 | `purchasing.orders.manage` | `purchasing.requests`, `partners.directory` |
| `purchasing.goods_receipts` | Goods receipts · سندات استلام البضاعة | GRN posting stock + GRNI accrual; batch capture at receipt; landed-cost fields captured (full allocation at PHASE-015) | MVP | 011 | `purchasing.goods_receipts.manage` | `purchasing.orders`, `inventory.stock_ledger` |
| `purchasing.supplier_invoices` | Supplier invoices · فواتير الموردين | AP invoices clearing GRNI; supplier's own number recorded; match outcome before approval | MVP | 011 | `purchasing.supplier_invoices.post` | `purchasing.goods_receipts` |
| `purchasing.debit_notes` | Debit notes · الإشعارات المدينة | AP corrections mirroring supplier invoices | MVP | 011 | `purchasing.debit_notes.post` | `purchasing.supplier_invoices` |
| `purchasing.payments` | Payments · سندات الصرف | Supplier/payee payments with allocation to supplier invoices (mirror of receipts) | MVP | 011 | `purchasing.payments.post` | `treasury.accounts` |
| `purchasing.three_way_matching` | Three-way matching · المطابقة الثلاثية | Order ↔ receipt ↔ invoice consistency with tolerance rules and match outcomes recorded before approval (BR-009) | MVP | 011 | `purchasing.matching.review` | `purchasing.supplier_invoices` |
| `purchasing.landed_costs` | Landed costs · تكاليف الوصول | Freight/customs/insurance allocation by value or quantity into item cost; revalues layers before issue where possible (baseline allocation shipped 011; full workflow — UI + entitlement activation — 015) | 1 | 011 (baseline) / 015 (full workflow) | `purchasing.landed_costs.manage` | `purchasing.goods_receipts` |

## 10. Module: treasury

Cash, banking, expenses, shifts.

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `treasury.accounts` | Cash & bank accounts · الحسابات النقدية والبنكية | CASH/BANK/PETTY accounts linked to GL accounts; the account ledger IS the movements (INV-019) | MVP | 008 | `treasury.accounts.manage` | `accounting.chart_of_accounts` |
| `treasury.receipts_disbursements` | Receipts & disbursements · سندات القبض والصرف | Generic money-in/out documents consumed by AR/AP flows with method, currency, and value date | MVP | 008 | `sales.receipts.post` (money-leg service is treasury-owned; document permission follows table ownership — matrix §1.1) | `treasury.accounts` |
| `treasury.petty_cash` | Petty cash · الصندوق النقدي الصغير | Small-cash fund with its own account, reimbursement cycle, and limits (BR-020) | MVP | 008 | `treasury.petty_cash.manage` | `treasury.accounts` |
| `treasury.cash_transfers` | Cash transfers · التحويلات النقدية | Account↔account transfers with charges; DRAFT → POSTED | MVP | 008 | `treasury.transfers.post` | `treasury.accounts` |
| `treasury.expenses` | Expenses & claims · المصروفات والمطالبات | Expense categories, claims with receipt attachments, approval policies, payout posting (BR-023) | MVP | 008 | `treasury.expenses.submit` | `treasury.accounts`, `platform.files` |
| `treasury.expense_categories` | Expense categories · تصنيفات المصروفات | Bilingual categories mapped to expense accounts with per-category approval policy | MVP | 008 | `treasury.expense_categories.manage` | `treasury.expenses` |
| `treasury.cashier_shifts` | Cashier shifts · وردية الصندوق | Opening float, sales capture, closing count, difference posting (BR-021); POS-grade shift UX at PHASE-016 | MVP | 008 | `treasury.shifts.manage` | `treasury.accounts` |
| `treasury.bank_reconciliation` | Bank reconciliation · التسوية البنكية | Statement import (per-bank format adapters), auto-match + manual match, unmatched aging, per-account period lock | MVP | 008 | `treasury.bank_reconciliation.manage` | `treasury.accounts` |
| `treasury.bank_statement_parking` | Parked statement lines · الصفوف المتوقفة من كشف الحساب | **SHIPPED PHASE-023** (migration 0035): unparseable statement rows park for manual mapping — raw cells verbatim, amounts NEVER guessed; resolution writes + links the mapped line, discard records why; two new format families (`csv-debit-credit`, `csv-with-balances` with advisory balance-drift warnings — never silent corrections) + the seeded format-family registry (no bank-specific attribution without verified documentation) | 3 | 023 | `treasury.bank_reconciliation.manage` | `treasury.bank_reconciliation` |
| `treasury.cheques` | Cheques · الشيكات | Cheque payment method with status tracking (received/deposited/cleared/bounced) — no bank integration (A-014); **PHASE-008 deferred the full lifecycle (the `method` enum reserves the CHEQUE value; no half lifecycle inside receipts — phase doc §2 out-of-scope note) and the chain TERMINATES at PHASE-027: cheques are delivered by the `notes` module (accounting DR-003, [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) ED-03 — register §D re-points this key with exactly that note; the receipts `method` value stays a payment-method flag with no custody semantics)** | 4 | 027 (delivered by `notes`) | `treasury.cheques.manage` | `treasury.receipts_disbursements` |

## 11. Module: tax

Treatment model and jurisdiction packs — [../localization/TAX_ENGINE.md](../localization/TAX_ENGINE.md).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `tax.engine` | Tax engine · محرك الضريبة | Deterministic line→tax-lines resolution; treatments, snapshots at posting, summaries; no UI of its own | MVP | 009 | (internal; consumed via documents) | `accounting.journal_entries` |
| `tax.codes` | Tax codes · رموز الضريبة | Tenant tax codes binding items/lines to treatment + rate snapshot policy | MVP | 009 | `tax.codes.manage` | `tax.engine` |
| `tax.registrations` | Tax registrations · التسجيل الضريبي | Per-jurisdiction registration status; unregistered tenants compute `NOT_SUBJECT` cleanly | MVP | 009 | `tax.registrations.manage` | `tax.engine` |
| `tax.jurisdiction_packs` | Jurisdiction packs · حزم الدول | Versioned country packs: rates with effective dates, invoice requirements, numbering rules; includes no-VAT jurisdictions | MVP | 009 | platform-level (`tax.packs.apply`) | — |
| `tax.vat_return` | VAT return · الإقرار الضريبي | Per-period aggregation of tax summaries vs GL tax accounts (INV-012); ready-to-file gating; bilingual report | MVP | 009 | `tax.vat_return.read` | `tax.engine`, `accounting.general_ledger` |
| `tax.einvoicing_framework` | E-invoicing framework · إطار الفوترة الإلكترونية | **OPERATIONAL since PHASE-023** (migration `0035_external_integrations.sql`) — no longer architecture-only: the submission registry (1:N per adapter — one LIVE row per document × adapter; retry chains via `retry_of_submission_id`; sealed payload/response artifacts, AES-256-GCM via `EINVOICING_SECRET_KEY` falling back to `IDENTITY_SECRET_KEY`), the adapter-neutral state machine (PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED/REJECTED → REPORTED with capped retries + dead-letter alerting; illegal transitions rejected in code), pg-boss sign/submit/poll/reconcile jobs, the S-10 certificate registry + CertExpiry 30/14/7 ladder, per-tenant rollout flags default OFF (enablement gate = provisioned ACTIVE certificate + jurisdiction pack), funnel monitoring + `EInvoiceRejectSpike`, and the NON_AUTHORITATIVE compliance-archive builder. Registry status is the sole source of authority truth (directive §12); no adapter capability ships without a passed verification gate | MVP | 009 (schema) / 023 (operational) | `tax.einvoicing.manage` | `tax.engine`, `sales.invoices` |
| `tax.einvoicing_zatca` | ZATCA (KSA) adapter · محول فاتورة (السعودية) | **SHIPPED PHASE-023 as the UNVERIFIED refuse-to-submit stub** — the verification gate is honestly NOT_VERIFIED (no external access; nothing fabricated): GATE-1 spec/SDK pin, GATE-2 sandbox, GATE-3 sample-invoice validation, GATE-4 legal review are all unmet and named in every refusal ([DR-001](../decisions/compliance/DR-001-zatca-scope-and-timing.md) OPEN — option C, generation features at launch + certified adapter as fast-follow, recommended). The REAL operational substrate it plugs into is live and proven by the fake-zatca scenario matrix (submit/accept/reject/timeout/retry/dead-letter) | 3 | 023 (stub; real adapter pending DR-001 + the verification gate) | `tax.einvoicing.submit` | `tax.einvoicing_framework` |
| `tax.einvoicing_eta` | ETA (Egypt) adapter · محول مصلحة الضرائب المصرية | Egypt e-invoice/e-receipt evaluation track: **evaluation deferred PHASE-023** — [DR-003](../decisions/compliance/DR-003-egypt-eta-scope.md) (Egypt ETA scope) ships as the DEFERRED draft (e-invoice vs e-receipt scope is decided by record before any adapter work — RISK-007); the fake-eta harness proves the port fits ETA-shaped flows with zero wire-format knowledge; the adapter itself is NOT_STARTED until an approving record + a passed verification gate | 3 | 023 (evaluation pack; adapter NOT_STARTED) | `tax.einvoicing.submit` | `tax.einvoicing_framework` |

## 12. Module: reporting

Report contract, statements, printing — rendering rules in the reporting workstream docs.

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `reporting.engine` | Report engine · محرك التقارير | Report contract registry (params, scopes, permissions, currency, drill-down, export, version) + run records | MVP | 013 | `reporting.run` | `accounting.general_ledger` |
| `reporting.financial_statements` | Financial statements · القوائم المالية | Trial balance, income statement, balance sheet, cash flow — reconciled, drillable, bilingual | MVP | 013 | `reporting.financials.read` | `reporting.engine` |
| `reporting.operational_reports` | Operational reports · التقارير التشغيلية | Stock on hand/movements/valuation/expiry, sales & purchase analysis, AR/AP aging, profitability | MVP | 013 (core) | `reporting.operational.read` | `reporting.engine` |
| `reporting.print_templates` | Print templates · قوالب الطباعة | Versioned bilingual RTL-correct templates: A4 documents, statements, 80/58 mm receipts | MVP | 013 | `reporting.print` | `reporting.engine` |
| `reporting.exports` | Exports · التصدير | PDF/XLSX/CSV export of any report run with tenant-scoped signed files | MVP | 013 | `reporting.export` | `reporting.engine` |
| `reporting.dashboards` | Dashboards · لوحات المعلومات | Role-appropriate KPI dashboards with drill-down (owner/CEO view at PHASE-014) | MVP | 014 | `reporting.dashboards.read` | `reporting.engine` |
| `reporting.scheduled_reports` | Scheduled reports · التقارير المجدولة | Scheduled generation + email delivery | 3 | 025 | `reporting.schedule.manage` | `reporting.exports`, `platform.notifications` |

## 13. Module: crm

Leads-to-contract pipeline and service delivery (PHASE-019; shipped 2026-11-03).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `crm.leads` | Leads · العملاء المحتملون | Lead capture, status pipeline, source tracking, conversion to partner | 1 | 019 (shipped 2026-11-03) | `crm.leads.manage` | `partners.directory` |
| `crm.tasks_activities` | Tasks & activities · المهام والأنشطة | Follow-ups, calls, meetings linked to leads/partners/contracts | 1 | 019 (shipped 2026-11-03) | `crm.tasks.manage` + `crm.activities.manage` (migration 0027 seeds both) | `crm.leads` |
| `crm.service_contracts` | Service contracts · عقود الخدمة | Contract terms, coverage, billing schedule linked to partners | 1 | 019 (shipped 2026-11-03) | `crm.contracts.manage` | `partners.directory` |
| `crm.recurring_billing` | Recurring billing · الفوترة الدورية | Scheduled invoice generation from contract billing schedules; drafts → normal approval flow | 1 | 019 (shipped 2026-11-03) | `crm.contracts.bill` | `crm.service_contracts`, `sales.invoices` |
| `crm.service_orders` | Service orders · أوامر الخدمة | Service delivery documents (job cards) with parts consumption and labor lines | 1 | 019 (shipped 2026-11-03) | `crm.service_orders.manage` | `crm.service_contracts`, `inventory.stock_ledger` |

## 14. Module: manufacturing

Production execution + costing (PHASE-018; no MRP per [OQ-006](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md)).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `manufacturing.bom` | Bills of materials · قوائم المواد | Multi-level BOMs with scrap factors and versioning | 1 | 018 | `manufacturing.boms.manage` | `items.item_master` |
| `manufacturing.production_orders` | Production orders · أوامر الإنتاج | DRAFT → RELEASED → IN_PROGRESS → COMPLETED / CANCELLED; material consumption and FG receipt | 1 | 018 | `manufacturing.production_orders.view` | `manufacturing.bom`, `inventory.stock_ledger` |
| `manufacturing.wip` | Work in progress · تحت التشغيل | WIP account tracking per production order reconciling to GL (INV-010) | 1 | 018 | `manufacturing.production_orders.view` | `manufacturing.production_orders` |
| `manufacturing.costing` | Production costing · تكلفة الإنتاج | Actual costing of FG from consumed materials + recorded costs; variance to standard if used | 1 | 018 | `manufacturing.costing.read` | `manufacturing.wip` |
| `manufacturing.scrap` | Scrap · الهالك | Scrap reporting with reason codes posting to shrinkage | 1 | 018 | `manufacturing.production_orders.post` | `manufacturing.production_orders` |
| `manufacturing.batch_genealogy` | Batch genealogy · تسلسل الدفعات | Produced batch ↔ consumed batch linkage for traceability/recall | 1 | 018 | `manufacturing.genealogy.read` | `manufacturing.production_orders`, `inventory.batch_tracking` |
| `manufacturing.qc` | Quality control basics · أساسيات مراقبة الجودة | Inspections (pass/fail) on receipt and completion; failures route to scrap or return | 1 | 018 | `manufacturing.qc.manage` | `manufacturing.production_orders` |

## 15. Module: distribution

Van sales and field operations (**DELIVERED PHASE-017**, migration
`0025_automotive_distribution.sql`; online/back-office by design — offline van selling
arrives with the Android app, PHASE-022, on the PHASE-020 sync foundation).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `distribution.routes` | Routes · خطوط المسار | Route definitions with day patterns and assigned customers per rep | 1 | 017 | `distribution.routes.manage` | `partners.directory`, `sales.reps` |
| `distribution.van_stock` | Van stock · مخزون السيارة | Vehicle warehouses stocked by transfer; rep accountability from issue to settlement | 1 | 017 | `distribution.van_stock.manage` | `inventory.multi_warehouse`, `inventory.stock_transfers` |
| `distribution.settlements` | Rep settlements · تسويات المندوبين | Day-end settlement: cash counted vs collected, invoices/returns reconciliation, variance disposition (BR-021 family) | 1 | 017 | `distribution.settlements.manage` | `distribution.van_stock`, `sales.invoices`, `sales.receipts` |
| `distribution.customer_tiers` | Customer tiers · فئات العملاء | Tier assignment driving price-list precedence and visit frequency | 1 | 017 | `distribution.tiers.manage` | `partners.directory` |
| `distribution.free_goods` | Free-goods policies · سياسات السلع المجانية | Rule-based free goods (buy X get Y, per-tier) applied on van/POS sales | 1 | 017 | `distribution.free_goods.manage` | `sales.discount_management` |

## 16. Module: pos

Point of sale (**DELIVERED PHASE-016**, migration `0024_pos_core.sql`; offline sale
queue is the scoped precursor of general sync — A-011; the two former intake keys
`pos.table_service` / `pos.kitchen_display` are full catalog rows since 016 with their
plan grants per §25 step 3).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `pos.terminals` | Terminals · أجهزة نقاط البيع | Terminal registry per branch bound to devices; activate/deactivate | 1 | 016 | `pos.terminals.manage` | `platform.branches` |
| `pos.sales` | POS sale screen · شاشة البيع | Barcode-first fast sale flow, cash/card/cheque, cash customers, simplified invoices, returns | 1 | 016 | `pos.sales.sell` | `sales.invoices`, `items.barcodes` |
| `pos.shifts` | POS shifts · وردية الصندوق | Open shift with float, in-shift cash visibility, close count and variance posting | 1 | 016 | `pos.shifts.manage` | `treasury.cashier_shifts` |
| `pos.receipts` | Receipt printing · طباعة الإيصالات | 80 mm / 58 mm RTL-correct receipts with offline number when offline (BR-030) | 1 | 016 | `pos.receipts.print` | `pos.sales`, `reporting.print_templates` |
| `pos.barcode_scanning` | Barcode scanning · مسح الباركود | Keyboard-wedge and camera scanning; scale-barcode parsing for weighted goods | 1 | 016 | (capability of `pos.sales`) | `items.barcodes` |
| `pos.offline_queue` | Offline sale queue · قائمة البيع دون اتصال | Local completion of sales with `OFF-` numbering, honest pending-sync state, server-side reconciliation | 1 | 016 | (device capability) | `pos.sales`, `pos.shifts` |
| `pos.table_service` | Tables & floor plan · خريطة الطاولات | Floor plan with zones/tables, open checks, transfer/split, guest check; unpaid tables hold no ledger effect | 1 | 016 | `pos.sales.sell` | `pos.sales` |
| `pos.kitchen_display` | Kitchen tickets · تذاكر المطبخ | Kitchen ticket printing from open checks (screen KDS is a roadmap extension) | 1 | 016 | `pos.sales.sell` | `pos.table_service` |

## 17. Module: offline

General sync foundation and native clients (PHASE-020…022) —
[ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `offline.sync_protocol` | Sync protocol · بروتوكول المزامنة | Outbox/inbox, idempotency keys, per-entity cursors, tombstones, per-entity conflict policies; server authoritative for postings | 2 | 020 (shipped 2026-11-04) | `sync.settings.manage` (admin plane; data plane device-scoped self) | `platform.users_roles` |
| `offline.device_management` | Device management · إدارة الأجهزة | Device registry, activation, revocation, last-seen, per-device sync state | 2 | 020 (shipped 2026-11-04) | `identity.devices.manage` + `sync.devices.register`/`sync.devices.revoke` (migration 0029 seeds the sync-plane keys) | `offline.sync_protocol` |
| `offline.desktop_app` | Desktop application · تطبيق سطح المكتب | Tauri shell (Windows first): offline web-ERP cache, auto-update, keychain, printer integration — **shipped 2026-11-04**: the exported shell subset (Offline Console with the 9 OFFLINE-DRAFT flows + full rejection UX + unlock screen), dual-profile SQLCipher store (DR-P21-02), signed minisign auto-update with staged rollout + crash gates, OS-keychain credentials, ESC-POS reprint-from-cache; evidence: `docs/implementation/phases/reports/PHASE-021-COMPLETION.md` + [../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) §7 | 2 | 021 (shipped 2026-11-04) | (app install) | `offline.sync_protocol` |
| `offline.android_app` | Android application · تطبيق أندرويد | Expo app: personal accounts + field sales with offline cache and push — **shipped 2026-11-05**: the `@erp/mobile` runtime (ONE app, TWO capability experiences — `android-field` + `android-personal`, scoping at registration per ADR-0014) over the UNMODIFIED sync-core: the field flows (van sale capture with barcode + LOCAL-VALID pre-validation, collection, van load/unload, returns, count lines, route visits), the companion + personal read-cached homes, the FULL rejection UX (ParkedRejections), biometric/PIN unlock, the 128 MB byte-exact store with the §6.4 corruption drill, the FCM skeleton, staged rollout 10/50/100 + `minVersion` force-update; evidence: `docs/implementation/phases/reports/PHASE-022-COMPLETION.md` + [../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) §7 | 2 | 022 (shipped 2026-11-05) | (app install) | `offline.sync_protocol`, `distribution.van_stock` |
| `offline.mobile_accounts` | Mobile account views · الحسابات على الجوال | Cached, authorized, shareable-only partner data on Android — **shipped 2026-11-05**: the `android-personal` device class — pull-only partner-scoped feeds (statements/sales_invoices/receipts/notifications, server-side scope proven against tampered pulls), as-of labels, ZERO write affordances (import-graph + host guard + render, three layers), ≤ 256 KB background pulls; the linked-partner registration surface validates the link against the registering identity's authorization; evidence: `docs/implementation/phases/reports/PHASE-022-COMPLETION.md` | 2 | 022 (shipped 2026-11-05) | customer-scoped token | `partners.personal_accounts`, `offline.android_app` |

## 18. Module: industry

The industry template engine (PHASE-015) — templates detailed in
[INDUSTRY_CATALOG.md](INDUSTRY_CATALOG.md).

**Cross-check (PHASE-030, shipped 2026-11-08): ZERO new feature keys.** The
wholesale + electronics templates compose **pre-granted keys only** (wholesale:
`items.price_lists`, `partners.credit_terms`, `partners.statements`,
`sales.credit_limits`, `notes.received`…; electronics: `inventory.serial_tracking`,
`crm.service_orders`, the `pos.*` set, trade-in via purchasing) — the
configuration-only phase constraint (INV-022) held: no key, plan grant, or route was
added, and the key count above is unchanged (the CI cross-checks are
`capability-matrix-reconciliation.spec.ts` + the drift gate 245=245). The nine new
typed workflow-**policy** keys live in the policy registry
([CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) §4), not here.

**Cross-check (PHASE-031, shipped 2026-11-08): ZERO new feature keys again.** The
healthcare commercial shell composes **pre-granted keys only** (its claim chain:
`sales.invoices` + `notes.received` + `partners.statements` + `crm.service_orders` +
`inventory.batch_tracking` + `sales.credit_limits`) — the "configuration + light
extension" register pattern held: the single additive `sales_invoices.claim_ref`
column (migration 0042) carries no entitlement semantics, the `insurance_claim_billing`
capability is a CAPABILITY_MATRIX row over existing keys (NOT a catalog key), and no
plan grant, route, or permission key was added (drift stays 245=245). The six new typed
workflow-**policy** keys live in the policy registry
([CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) §4), not here; the group_by_claim
report parameter rides existing contracts (register §J stays closed).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `industry.template_engine` | Template engine · محرك قوالب الصناعة | Manifest schema, application at onboarding or later, versioned application records | 1 | 015 | `industry.templates.manage` | `platform.onboarding` |
| `industry.template_switching` | Template switching · تبديل القالب | Additive-only switch/extension with compatibility checks — never deletes tenant data (BR-038) | 1 | 015 | `industry.templates.switch` | `industry.template_engine` |
| `industry.terminology` | Terminology overrides · المصطلحات المخصصة | Per-template bilingual terminology (screen labels, document captions) layered over the glossary | 1 | 015 | `industry.terminology.manage` | `industry.template_engine` |
| `industry.addons` | Industry add-ons · إضافات الصناعة | Subscription add-on packs bundling template + feature keys per plan (see [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md) §4); **015 scope: wired to entitlement resolution only** (plan/billing machinery is PHASE-014's) | 1 | 015 | (plan + entitlements) | `industry.template_engine` |

## 19. Module: fixed_assets

Asset register, categories, monthly depreciation runs, revaluation, and disposal
(PHASE-026; INV-023, goldens G-21…G-23) — fixed by
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §D/ED-02. All postings go through the
centralized engine with INV-013 idempotency.

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `fixed_assets.register` | Asset register · سجل الأصول | Asset records with code, category, acquisition date/cost, salvage value, useful life, depreciation method, branch, custodian, status (NBV floor at salvage — INV-023) | 4 | 026 | `fixed_assets.assets.view/create/manage` | `accounting.chart_of_accounts` |
| `fixed_assets.categories` | Asset categories · تصنيفات الأصول | Categories defaulting useful life, method, and the asset / accumulated-depreciation / expense purpose accounts (BR-041) | 4 | 026 | `fixed_assets.assets.manage` | `fixed_assets.register` |
| `fixed_assets.acquisition` | Asset acquisition & capitalization · شراء ورسملة الأصول | Capitalization from GRN/purchase or direct entry posting golden G-21 into the category's asset account | 4 | 026 | `fixed_assets.assets.create` | `fixed_assets.categories` |
| `fixed_assets.depreciation` | Monthly depreciation runs · تشغيلات الإهلاك الشهرية | Period-locked batch runs (one journal per run, lines per asset) posting golden G-22 only via the engine — no manual asset journals (BR-042) | 4 | 026 | `fixed_assets.depreciation_runs.run/post` | `fixed_assets.acquisition`, `accounting.fiscal_calendar` |
| `fixed_assets.revaluation` | Revaluation · إعادة تقييم الأصول | Optional, audited revaluation; the delta posts to `REVALUATION_RESERVE` via the engine (BR-044) | 4 | 026 | `fixed_assets.assets.manage` (audited) | `fixed_assets.acquisition` |
| `fixed_assets.disposal` | Asset disposal · استبعاد الأصول | One-time SALE/SCRAP disposal locking the asset; gain/loss to `ASSET_DISPOSAL_GAIN`/`ASSET_DISPOSAL_LOSS` (golden G-23, BR-043) | 4 | 026 | `fixed_assets.disposals.approve` | `fixed_assets.depreciation` |
| `fixed_assets.reports` | Fixed-asset reports · تقارير الأصول الثابتة | Asset register, depreciation schedule, movements reports (`fixed_assets.asset-register`, `fixed_assets.depreciation-schedule`, `fixed_assets.movements`) | 4 | 026 | (reads under `fixed_assets.assets.view`) | `fixed_assets.depreciation` |

## 20. Module: notes

Cheques & promissory notes: received/issued custody, PDC maturity calendar, endorsement,
dishonor, discounting — **DELIVERED PHASE-027** (migration `0038_notes_installments.sql`,
shipped 2026-11-07; INV-024, goldens G-24…G-27). This module terminates the
v1.1 `treasury.cheques` deferral chain — the full PDC lifecycle is delivered here
([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) ED-03). Plan grants: the seven keys
join **business + enterprise** (the tier-4 financial-depth precedent — starter does NOT
get them).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `notes.received` | Received notes · الأوراق التجارية المستلمة | Cheques/promissory notes received into custody against invoices (golden G-24 settles the open item via the `treasury_allocations.note_id` substrate); partner + maturity mandatory (BR-045) | 4 | 027 (shipped 2026-11-07) | `notes.notes.view/create` | `treasury.receipts_disbursements`, `sales.invoices` |
| `notes.issued` | Issued notes · الأوراق التجارية الصادرة | Notes issued to suppliers clearing AP (golden G-27) with the paid-at-maturity mirror | 4 | 027 (shipped 2026-11-07) | `notes.notes.view/create` | `treasury.receipts_disbursements`, `purchasing.supplier_invoices` |
| `notes.pdc_calendar` | PDC maturity calendar · تقويم الاستحقاق | Auto-derived post-dated calendar of all in-custody notes by maturity date (BR-045) — job-derived cached read model (daily sweep 2:20 UTC + on-event invalidation; staleness labeled >26 h, never silent); no new canonical entity | 4 | 027 (shipped 2026-11-07) | (reads under `notes.notes.view`) | `notes.received`, `notes.issued` |
| `notes.endorsement` | Endorsement · التظهير | Custody transfer without journal effect — journals only on collect/dishonor/return/discount (BR-047; `ck_note_events_journal_shape` enforces the no-journal shape) | 4 | 027 (shipped 2026-11-07) | `notes.notes.endorse` | `notes.received` |
| `notes.dishonor` | Dishonor handling · معالجة ارتجاع الأوراق التجارية | Reason-required dishonor restoring the AR open item exactly (the repoint-restore algebra); optional bank fee via `BANK_CHARGES` (golden G-26, BR-046); RETURN hands the note back pre-resolution — same restore, no reason/fee (`notes.notes.return`) | 4 | 027 (shipped 2026-11-07) | `notes.notes.record_dishonor` (+ `notes.notes.return`) | `notes.received` |
| `notes.discounting` | Note discounting · خصم الأوراق التجارية | Bank discounting before maturity; the discount charge posts to `NOTES_DISCOUNT_EXPENSE` (fee explicit, never netted) — base-currency notes only this phase (typed `NOTE_DISCOUNT_CURRENCY_UNSUPPORTED`, the honest deferral: collect or return instead) | 4 | 027 (shipped 2026-11-07) | `notes.notes.discount` | `notes.received` |
| `notes.reports` | Notes reports · تقارير الأوراق التجارية | Maturity calendar, aging, dishonored-register reports (`notes.maturity-calendar`, `notes.aging`, `notes.dishonored-register` — registry 71→76, as-of determinism via the custody-log reconstruction, block-on-fail RC-11 ties) | 4 | 027 (shipped 2026-11-07) | (reads under `notes.notes.view`) | `notes.pdc_calendar` |

## 21. Module: installments

Payment plans and due schedules over credit source documents — **DELIVERED PHASE-027**
(migration `0038_notes_installments.sql`, shipped 2026-11-07; golden G-28). Plan grants:
the five keys join **business + enterprise** (starter does NOT get them).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `installments.plans` | Installment plans · خطط الأقساط | Plans over a source document (credit sales invoice or service contract) — plan total must equal source total (BR-048; status NULL = draft pre-activation); per-plan late-fee policy (BR-049) | 4 | 027 (shipped 2026-11-07) | `installments.plans.manage` | `sales.invoices`, `partners.credit_terms` |
| `installments.schedules` | Installment schedules · جداول الأقساط | Generated dues (WEEKLY…QUARTERLY) immutable after activation (BR-048); line statuses job-derived only by the daily sweep (WAIVED the sole manual transition) | 4 | 027 (shipped 2026-11-07) | (reads under `installments.plans.view`) | `installments.plans` |
| `installments.collections` | Installment collections · تحصيل الأقساط | Collection of due installments through receipts/allocations (`receipt_refs` attribution — plans never duplicate AR); waivers gated explicitly | 4 | 027 (shipped 2026-11-07) | `installments.lines.waive` (waiver); collections via `sales.receipts.post` | `installments.schedules`, `sales.receipts` |
| `installments.late_fees` | Late fees · رسوم التأخير | Per-plan policy (rate + cap + grace — PLACEHOLDER defaults, OQ-002 family) posting `LATE_FEE_INCOME` via the engine only (golden G-28); flat fees only — no interest computation or compounding path exists (DR-003) | 4 | 027 (shipped 2026-11-07) | (charge under `installments.plans.manage`; posting engine-only) | `installments.schedules` |
| `installments.reports` | Installment reports · تقارير الأقساط | Schedule and aging reports (`installments.schedule`, `installments.aging`) | 4 | 027 (shipped 2026-11-07) | (reads under `installments.plans.view`) | `installments.schedules` |

## 22. Module: budgeting

Versioned budgets by fiscal year over accounts/cost centers/projects/branches with
budget-vs-actual variance and **advisory** controls by default (PHASE-028,
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) ED-04).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `budgeting.budgets` | Budgets · الموازنات | Versioned budgets by fiscal year and scope; one ACTIVE version per (fiscal year, scope); revisions supersede, never edit (BR-050) | 4 | 028 | `budgeting.budgets.view/create/approve/activate` | `accounting.fiscal_calendar`, `accounting.chart_of_accounts` |
| `budgeting.cost_center_budgets` | Cost-center budgets · موازنات مراكز التكلفة | Budget lines scoped per cost center | 4 | 028 | (scope variant of `budgeting.budgets.create`) | `budgeting.budgets`, `accounting.cost_centers` |
| `budgeting.project_budgets` | Project budgets · موازنات المشاريع | Budget lines scoped per project | 4 | 028 | (scope variant of `budgeting.budgets.create`) | `budgeting.budgets`, `accounting.projects` |
| `budgeting.approvals` | Budget approvals · اعتماد الموازنات | DRAFT → PENDING_APPROVAL → ACTIVE lifecycle with explicit approval (approval-gated, SoD) | 4 | 028 | `budgeting.budgets.approve` | `budgeting.budgets` |
| `budgeting.controls` | Budget controls · ضوابط الموازنة | Budget-vs-actual checks at document approval — advisory by default; hard-block requires explicit tenant policy (BR-051) | 4 | 028 | `budgeting.budgets.activate` | `budgeting.approvals` |
| `budgeting.reports` | Budget reports · تقارير الموازنة | Budget-vs-actual and variance-analysis reports (`budgeting.budget-vs-actual`, `budgeting.variance-analysis`) | 4 | 028 | (reads under `budgeting.budgets.view`) | `budgeting.budgets`, `reporting.engine` |

## 23. Module: payroll

Payroll with **financial scope only**: employees, salary structures/components, monthly
runs, employee loans, end-of-service (EOS) provision (PHASE-029; INV-025, goldens
G-29…G-31). Attendance, leave, performance, and full HR remain non-goals; no
country-specific contribution rates are fabricated — components are tenant-configured
([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) ED-05).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `payroll.employees` | Employees · الموظفون | Employee records (code, national_id — sensitive C-PII, hire/termination dates, contract type, basic salary, structure, branch/cost center, bank fields); reads permission-restricted | 4 | 029 | `payroll.employees.view/manage` (read-restricted) | `platform.branches` |
| `payroll.salary_structures` | Salary structures · هياكل الرواتب | Structures of components (ALLOWANCE/DEDUCTION/EMPLOYER_CONTRIBUTION; FIXED/PERCENT_OF_BASIC/PERCENT_OF_GROSS) with GL accounts and EOS-base flag | 4 | 029 | (under `payroll.employees.manage`) | `payroll.employees` |
| `payroll.runs` | Payroll runs · تشغيلات الرواتب | Monthly runs per fiscal period with frozen per-employee component snapshots; gross − deductions = net exactly (INV-025, golden G-29) | 4 | 029 | `payroll.runs.view/create/approve/post` | `payroll.salary_structures`, `accounting.fiscal_calendar` |
| `payroll.approvals` | Payroll approvals · اعتماد الرواتب | DRAFT → PENDING_APPROVAL → POSTED run approval (approval-gated, SoD) | 4 | 029 | `payroll.runs.approve` | `payroll.runs` |
| `payroll.loans` | Employee loans · سلف الموظفين | Loans with per-period deductions capped at a percent of net (default 25% — PLACEHOLDER, BR-054) | 4 | 029 | `payroll.loans.manage` | `payroll.employees`, `payroll.runs` |
| `payroll.eos_provision` | End-of-service provision · مخصص نهاية الخدمة | EOS accrual per tenant policy table — no jurisdiction rates fabricated (BR-055); settlement at termination per golden G-31 | 4 | 029 | (posts via `payroll.runs.post`) | `payroll.employees`, `payroll.runs` |
| `payroll.cost_allocation` | Payroll cost allocation · توزيع تكلفة الرواتب | Allocation of run expense to cost centers/projects/branches on run lines | 4 | 029 | (allocation on run lines under `payroll.runs.post`) | `payroll.runs`, `accounting.cost_centers` |
| `payroll.reports` | Payroll reports · تقارير الرواتب | Payroll register, cost summary, EOS-provision reports (`payroll.register`, `payroll.cost-summary`, `payroll.eos-provision`); sensitivity-critical reads | 4 | 029 | (reads under `payroll.runs.view`) | `payroll.runs` |

## 24. Module: consolidation

Multi-entity consolidation: a legal entity = a tenant; consolidation is a read-run over
member books + elimination entries posted via the engine in the parent's consolidation
books; **zero cross-tenant writes** (PHASE-034; INV-026, golden G-32,
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) ED-10).

| Feature key | Name (EN · AR) | Description | Priority | Phase | Permission key | Depends on |
|---|---|---|---|---|---|---|
| `consolidation.groups` | Consolidation groups · مجموعات التوحيد | Groups owned by the parent tenant: member entities with ownership percent and include-from; group base currency | 4 | 034 | `consolidation.groups.manage` | `accounting.multi_currency`, `accounting.fiscal_calendar` |
| `consolidation.eliminations` | Elimination entries · قيود الاستبعاد | Intercompany eliminations (e.g., AR/AP pairs — golden G-32) posted as balanced journals in the consolidation books only; reversible only by counter-entry (BR-056) | 4 | 034 | `consolidation.eliminations.create/post` | `consolidation.groups` |
| `consolidation.runs` | Consolidation runs · تشغيلات التوحيد | Read-run over member books requiring closed member fiscal periods (BR-056); cross-tenant reads via an explicit, audited, read-only service — RLS never relaxed | 4 | 034 | `consolidation.runs.execute` | `consolidation.groups`, `consolidation.eliminations` |
| `consolidation.fx_translation` | FX translation · ترجمة العملات | Member statements translated to the group currency at dated FX rates (PHASE-007 rate table) | 4 | 034 | (part of `consolidation.runs.execute`) | `consolidation.runs`, `accounting.multi_currency` |
| `consolidation.reports` | Consolidated statements · القوائم الموحدة | Consolidated TB, income statement, balance sheet, eliminations log (`consolidation.consolidated-tb`, `consolidation.consolidated-is`, `consolidation.consolidated-bs`, `consolidation.eliminations-log`) | 4 | 034 | (reads under `consolidation.groups.manage`) | `consolidation.runs`, `reporting.financial_statements` |

## 25. Maintenance protocol

1. **Adding a feature**: decision record under [../decisions/](../decisions/) → add the row here
   (with all columns filled) → add to at least one plan/add-on in
   [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md) → seed its permission
   keys → reference from the delivering phase document.
2. **Changing a phase**: update the Phase column here and in the phase document; the roadmap
   index is corrected in the same change.
3. **Deprecating a feature**: mark `deprecated` in the row (never delete — entitlements
   history must survive), remove from plans at the next plan revision, provide a migration
   note for tenants holding the entitlement.
4. **Completeness rule**: phase completion reports must list every feature key their phase
   delivers and confirm each exists in this catalog — orphan keys fail review.
