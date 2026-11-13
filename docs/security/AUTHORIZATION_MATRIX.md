# Authorization Matrix

> **Status:** STABLE · **Owner:** Security Architecture · **Updated:** 2026-11-13 (PHASE-041 — §3.19 communications hub; permission catalog 267 → 272 · PHASE-042 — §3.20 manufacturing execution; permission catalog 272 → 279 · PHASE-044 — §3.21 WMS & inventory intelligence; permission catalog 279 → 287 · PHASE-043 — §3.22 MRP & planning; permission catalog 287 → 291)

The normative permission catalog: every permission key, its description (EN + AR), the
minimal role template(s) that carry it, its scope, and whether it is approval-separated
(risky). Model: **roles → permissions → scope**, evaluated server-side on every request;
UI visibility is derived and never authoritative (directive §9). Implementation decisions:
[ADR-0005](../architecture/ADR/ADR-0005-multi-tenancy.md),
[ADR-0015](../architecture/ADR/ADR-0015-authentication.md). Enforcement is tested per route
([SECURITY_TEST_PLAN.md](SECURITY_TEST_PLAN.md) §permission-tests) and per seed
([../testing/REGRESSION_STRATEGY.md](../testing/REGRESSION_STRATEGY.md) §docs-drift).

## 1. Naming and model rules

1. Permission keys are `module.resource.action`, all lowercase snake_case, module names
   matching [../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md)
   (`accounting`, `sales`, `purchasing`, `inventory`, `partners`, `items`, `treasury`,
   `tax`, `reporting`, `identity`, `tenancy`, `files`, `audit`, `configuration`,
   `industry` (template-engine keys — owned by the `configuration` module), `crm`,
   `manufacturing`, `distribution`, `pos`, `sync`, `platform`, plus the Blueprint v2.0 modules
   `fixed_assets`, `notes`, `installments`, `budgeting`, `payroll`, `consolidation` —
   [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §D/§K).
2. `view` is implied by any higher action on the same resource unless the table says
   otherwise (audit and financial reports have explicit `view` keys because they are often
   granted independently).
3. **Risky** permissions are approval-separated (§4) and always audited.
4. Scope: `tenant` (acts across all branches) or `branch` (acts only within granted
   branches). Branch scoping rules in §5.
5. Permissions live in the global `permissions` table (seeded); tenants cannot invent
   new keys — they compose roles from the catalog ([DATABASE seeds](../database/SEEDS/README.md)).

## 2. Role template definitions

Tenant-editable role templates (a tenant may clone and adjust within limits; risky
permissions cannot be granted to `viewer`-derived templates).

| Role (AR) | Purpose | Permission-set summary | Default scope |
|-----------|---------|------------------------|---------------|
| `owner` (المالك) | Tenant administrator | All tenant permissions incl. role assignment, settings, offboarding; approval limits highest | tenant |
| `accountant` (المحاسب) | Books and close | All `accounting.*`, `tax.*`, partner statements, reports, treasury view + approve, period close; from PHASE-017 also `distribution.settlements.approve` + `sales.commissions.manage`; no user management | tenant |
| `sales` (المبيعات) | Sell and invoice | `sales.*` documents up to approve/post per limits, partner view+create, items view, receipts create; from PHASE-017 also job cards, commission rules/runs, tiers, free-goods rules, and settlement create/count; from PHASE-023 also `sales.commerce.manage` (channel-order staging imports + conflict resolution) | branch |
| `purchasing` (المشتريات) | Buy and pay | `purchasing.*` documents up to approve per limits, partner view+create, items view, payments create | branch |
| `warehouse` (المستودع) | Stock operations | `inventory.*` operational actions (receive, issue, transfer, counts create/approve), items view; van operations from PHASE-017 (`distribution.van_stock.*`, `distribution.routes.manage`); no posting of financial adjustments | branch |
| `cashier` (أمين الصندوق) | POS terminal | POS-scoped subset: `pos.sales.sell`, `pos.shifts.manage`, `pos.receipts.print` + the `sales.pos_session.*` session keys, shift open/close, cash sales create+post via terminal, no approvals, no data exports | branch (terminal) |
| `viewer` (المشاهد) | Read-only | `view`-class permissions across modules the tenant enables; no writes, no approvals | tenant |
| `payroll_officer` (مسؤول الرواتب) | Prepare payroll (PHASE-029) | `payroll.employees` read + manage, `payroll.salary_structures.manage`, `payroll.runs` view + create, `payroll.loans.manage`; no run approve/post by default (three-way SoD, §4); every access audited (sensitivity-critical) | branch |
| `platform_admin` (مدير المنصة) | Platform staff | `platform.*` only; never holds tenant roles; every action audited with `via_platform_admin` | n/a (platform) |

## 3. Permission catalog by module

### 3.1 `accounting` (PHASE-007)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `accounting.journal_entries.view` | View journal entries and GL / عرض قيود اليومية ودفتر الأستاذ | viewer, accountant, owner | tenant | no |
| `accounting.journal_entries.create` | Draft manual journals / إنشاء قيود يدوية (مسودة) | accountant, owner | tenant | no |
| `accounting.journal_entries.approve` | Approve drafts for posting / اعتماد القيود للترحيل | accountant, owner | tenant | **yes** |
| `accounting.journal_entries.post` | Post approved entries via the engine / ترحيل القيود المعتمدة | accountant, owner | tenant | **yes** |
| `accounting.journal_entries.reverse` | Reverse posted entries (creates counter-entry) / عكس قيود مرحلة | accountant, owner | tenant | **yes** |
| `accounting.accounts.view` | View chart of accounts / عرض دليل الحسابات | viewer, accountant, owner | tenant | no |
| `accounting.accounts.manage` | Create/modify accounts, map purposes / إدارة الحسابات وربط الأغراض | accountant, owner | tenant | no (purpose mapping is audited) |
| `accounting.accounts.archive` | Archive accounts (blocked if mapped/posted — INV-015) / أرشفة الحسابات | owner | tenant | **yes** |
| `accounting.periods.lock` | Hard-lock fiscal periods / إقفال الفترات المالية | accountant, owner | tenant | **yes** |
| `accounting.periods.soft_close` | Soft-close periods / الإغلاق المؤقت للفترات | accountant, owner | tenant | no |
| `accounting.periods.reopen` | Reopen locked periods with reason (INV-020) / إعادة فتح فترات مقفلة | owner | tenant | **yes** |
| `accounting.periods.post_to_soft_closed` | Post into soft-closed period with reason / الترحيل في فترة مغلقة مؤقتاً | owner | tenant | **yes** |
| `accounting.fiscal_years.manage` | Create fiscal years/periods / إدارة السنوات المالية | accountant, owner | tenant | no |
| `accounting.exchange_rates.manage` | Maintain exchange-rate tables / إدارة أسعار الصرف | accountant, owner | tenant | no (audited) |
| `accounting.cost_centers.manage` | Maintain cost centers / إدارة مراكز التكلفة | accountant, owner | tenant | no |
| `accounting.projects.manage` | Maintain the projects dimension (PHASE-019) / إدارة بُعد المشاريع | accountant, owner | tenant | no (mirrors cost_centers; a CLOSED project rejects new journal-line stamps at the engine) |
| `accounting.opening_balances.create` | Draft opening balances / إعداد الأرصدة الافتتاحية | accountant, owner | tenant | no |
| `accounting.opening_balances.post` | Post opening-balance entry / ترحيل الأرصدة الافتتاحية | owner | tenant | **yes** |
| `accounting.year_end_close.execute` | Generate and post year-end closing entry / تنفيذ إقفال نهاية السنة | owner | tenant | **yes** |

### 3.2 `sales` (PHASE-012; POS in PHASE-016; job cards + commissions in PHASE-017)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `sales.quotations.view` / `.create` / `.approve` / `.convert` | Quote lifecycle / دورة عرض السعر | sales, owner | branch | no |
| `sales.orders.view` / `.create` / `.approve` | Sales-order lifecycle / دورة أمر البيع | sales, owner | branch | `.approve` yes |
| `sales.deliveries.view` / `.create` | Delivery notes / إشعارات التسليم | sales, warehouse, owner | branch | no |
| `sales.invoices.view` | View sales invoices / عرض فواتير البيع | sales, accountant, viewer, owner | branch | no |
| `sales.invoices.create` | Create invoices (draft) / إنشاء الفواتير | sales, owner | branch | no |
| `sales.invoices.approve` | Approve invoices for posting / اعتماد الفواتير للترحيل | owner (sales with limits) | branch | **yes** |
| `sales.invoices.post` | Post invoices (assign official numbers) / ترحيل الفواتير | owner (sales with limits) | branch | **yes** |
| `sales.credit_notes.view` / `.create` / `.approve` / `.post` | Credit-note lifecycle / دورة إشعار دائن | sales, accountant, owner | branch | `.approve`/`.post` **yes** |
| `sales.pos_session.open` / `.close` | Open/close POS terminal shift / فتح وإغلاق وردية الصندوق | cashier, owner | branch | no |
| `sales.pos_session.post` | Post POS sales from terminal queue / ترحيل مبيعات نقاط البيع | cashier (terminal-scoped), owner | branch | no (server re-validates) |
| `sales.credit_check.override` | Override credit-limit block / تجاوز حد الائتمان | owner | tenant | **yes** |
| `sales.reps.manage` | Manage sales reps / إدارة مندوبي المبيعات | owner | tenant | no |
| `sales.job_cards.manage` | Workshop job-card lifecycle / إدارة بطاقات العمل | sales, owner | branch | no (posting rides the invoice chain's approve/post keys) |
| `sales.commissions.manage` | Commission rules and runs / إدارة العمولات وتشغيلها | sales, accountant, owner | tenant | no (accrual posting is engine-gated INV-013 + audited; never touches invoices/VAT) |
| `sales.commerce.manage` | Import e-commerce channel orders + resolve import conflicts / استيراد طلبات قنوات التجارة الإلكترونية وحل تعارضات الاستيراد | sales, owner | tenant | no (staging surface only — conflict resolution is an explicit human decision ADR-0012; no posting from the import path) |

### 3.3 `purchasing` (PHASE-011)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `purchasing.purchase_requests.view` / `.create` / `.approve` | Requisition lifecycle / دورة طلب الشراء | purchasing, owner | branch | `.approve` yes |
| `purchasing.purchase_orders.view` / `.create` / `.approve` | PO lifecycle / دورة أمر الشراء | purchasing, owner | branch | `.approve` yes |
| `purchasing.goods_receipts.view` / `.create` / `.approve` | GRN lifecycle / دورة سند الاستلام | purchasing, warehouse, owner | branch | `.approve` yes |
| `purchasing.supplier_invoices.view` / `.create` | Supplier invoices / فواتير الموردين | purchasing, accountant, owner | branch | no |
| `purchasing.supplier_invoices.approve` / `.post` | Approve/post supplier invoices / اعتماد وترحيل فواتير الموردين | accountant, owner | tenant | **yes** |
| `purchasing.debit_notes.view` / `.create` / `.approve` / `.post` | Debit-note lifecycle / دورة إشعار مدين | purchasing, accountant, owner | branch | `.approve`/`.post` **yes** |
| `purchasing.matching.override` | Override three-way-match tolerance / تجاوز حدود المطابقة الثلاثية | owner | tenant | **yes** |

### 3.4 `treasury` (PHASE-008)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `treasury.accounts.view` | View cash/bank accounts and balances / عرض الحسابات النقدية والبنكية | accountant, viewer, owner | tenant | no |
| `treasury.accounts.manage` | Open/close cash & bank accounts / إدارة الحسابات النقدية والبنكية | accountant, owner | tenant | no (audited) |
| `sales.receipts.view` / `sales.receipts.create` | Record customer receipts / تسجيل سندات القبض | sales, accountant, owner | branch | no |
| `sales.receipts.approve` | Approve + post receipts (allocation applies) / اعتماد وترحيل سندات القبض | accountant, owner | tenant | **yes** |
| `purchasing.payments.view` / `.create` / `.approve` | Pay suppliers/payees / سندات الصرف | purchasing (create), accountant (approve), owner | branch / tenant | `.approve` **yes** |
| `treasury.expenses.view` / `.create` / `.approve` | Expense claims and approval / المصروفات واعتمادها | all staff (create own), accountant, owner | branch / tenant | `.approve` **yes** |
| `treasury.petty_cash.manage` | Manage petty-cash fund / إدارة الصندوق النقدي الصغير | accountant, owner | branch | no |
| `treasury.transfers.create` | Cash/bank transfers / التحويلات النقدية | accountant, owner | tenant | no |
| `treasury.transfers.approve` | Approve transfers (bank-charge posting follows) / اعتماد التحويلات | owner | tenant | **yes** |
| `treasury.shifts.manage` | Shift floats, closing counts, difference posting / إدارة الورديات | cashier (own shifts), owner | branch | no (differences audited) |
| `treasury.bank_reconciliation.manage` | Import statements, match, lock periods / التسوية البنكية | accountant, owner | tenant | no |
| `treasury.fx_revaluation.run` | Run dated FX revaluation / تنفيذ إعادة تقييم العملات | accountant, owner | tenant | **yes** |

### 3.5 `inventory` (PHASE-010)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `inventory.stock.view` | Stock on hand, availability / عرض المخزون المتاح | warehouse, sales, purchasing, viewer, owner | branch (visibility rules) | no |
| `inventory.moves.view` | Stock ledger / عرض حركات المخزون | warehouse, accountant, viewer, owner | branch | no |
| `inventory.receipts.create` / `inventory.issues.create` | Manual receipts/issues (docs drive the normal flow) / إدخال وإخراج مخزون | warehouse, owner | branch | no |
| `inventory.transfers.view` / `.create` / `.approve` | Warehouse transfers incl. in-transit / تحويلات المخزون | warehouse, owner | branch | `.approve` yes (in-transit receipt) |
| `inventory.counts.view` / `.create` / `.approve` | Stock counts and variance review / جرد المخزون | warehouse, owner | branch | `.approve` yes |
| `inventory.counts.post` | Post count variance adjustment (shrinkage/appreciation) / ترحيل فروقات الجرد | owner (warehouse with limits) | branch | **yes** |
| `inventory.adjustments.create` / `.post` | Direct stock adjustments / تسويات المخزون | warehouse (create), owner (post) | branch | `.post` **yes** |
| `inventory.warehouses.manage` | Warehouses, settings / إدارة المستودعات | owner | tenant | no |
| `inventory.items.method_switch` | Switch item valuation method (dated revaluation — INV-017) / تغيير طريقة التقييم | owner | tenant | **yes** |
| `inventory.tracking.manage` | Batches/serials/IMEI registration / إدارة التتبع | warehouse, owner | branch | no |

### 3.6 `partners` & `items` (PHASE-006; vehicle registry in PHASE-017)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `partners.view` | View partners / عرض جهات التعامل | all tenant roles | tenant | no |
| `partners.create` / `.update` / `.archive` | Maintain partner master / إدارة بيانات جهات التعامل | sales, purchasing, accountant, owner | tenant | no |
| `partners.credit_terms.manage` | Credit terms and limits per partner / إدارة شروط وحدود الائتمان | accountant, owner | tenant | no (audited) |
| `partners.statements.view` | Partner statements / كشوف الحسابات | sales, purchasing, accountant, owner | tenant | no |
| `partners.vehicles.manage` | Customer vehicle registry / سجل مركبات العملاء | owner | tenant | no (archive-only lifecycle; service history is read-only) |
| `items.view` | View items, prices, UoM / عرض الأصناف والأسعار | all tenant roles | tenant | no |
| `items.create` / `.update` / `.archive` | Maintain item master / إدارة بيانات الأصناف | warehouse, owner (sales for prices) | tenant | no |
| `items.price_lists.manage` | Price lists and discounts / إدارة قوائم الأسعار والخصومات | owner (sales with limits) | tenant | no (audited) |
| `items.import.run` | Bulk import (partners/items) with preview / استيراد جماعي | accountant, owner | tenant | no (preview-gated) |

### 3.7 `tax` (PHASE-009; e-invoicing PHASE-023)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `tax.codes.manage` | Tenant tax codes / إدارة رموز الضريبة | accountant, owner | tenant | no (audited) |
| `tax.registrations.manage` | VAT registrations per jurisdiction / إدارة التسجيل الضريبي | owner | tenant | **yes** |
| `tax.returns.view` / `.prepare` | VAT return data and drafts / بيانات الإقرار الضريبي | accountant, owner | tenant | no |
| `tax.returns.mark_filed` | Mark return as filed by the human accountant / تعليم الإقرار كمُقدَّم | owner | tenant | **yes** (audited; platform never files) |
| `tax.einvoicing.manage` | Enroll devices/certificates, monitor submissions / إدارة الفوترة الإلكترونية | owner | tenant | **yes** (certificate handling per [SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md) §6) |
| `tax.einvoicing.devices.manage` | Manage ZATCA EIAS devices and view their chain status (PHASE-037 — registration stays the NOT_REGISTERED placeholder until PHASE-054) / إدارة أجهزة الفوترة الإلكترونية وعرض حالة السلسلة | accountant, owner | tenant | no (audited; registration writes are Phase-2) |

### 3.8 `reporting`, `files`, `audit`, `configuration`, `industry`, `sync`, `crm`, `manufacturing`, `distribution`, `pos` (PHASE-016; distribution in PHASE-017; manufacturing keys completed in PHASE-018)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `reporting.reports.run` | Run reports incl. drill-down / تشغيل التقارير | viewer, accountant, owner | tenant | no |
| `reporting.reports.export` | Export PDF/XLSX/CSV (audited, signed URL) / تصدير التقارير | accountant, owner | tenant | no (audited) |
| `reporting.templates.manage` | Print templates AR/EN / إدارة قوالب الطباعة | owner | tenant | no |
| `reporting.schedules.manage` | Scheduled reports / التقارير المجدولة | owner | tenant | no |
| `reports.financial.tb.read` / `reports.financial.gl.read` / `reports.financial.is.read` / `reports.financial.bs.read` / `reports.financial.cf.read` | Financial statement reports (PHASE-013) / تقارير القوائم المالية | viewer, accountant, owner | tenant | no |
| `reports.financial.close.read` | Fiscal close pack (archive class) / حزمة إقفال الفترة | accountant, owner | tenant | no |
| `reports.accounting.cost-centers.read` | Cost center analysis / تحليل مراكز التكلفة | viewer, accountant, owner | tenant | no |
| `reports.ar.aging.read` / `reports.ap.aging.read` / `reports.ar-alloc.read` | AR/AP aging + allocations reports / تقارير أعمار الذمم والتخصيصات | viewer, accountant, owner | tenant | no |
| `reports.sales.by-item.read` / `reports.sales.by-customer.read` / `reports.sales.by-rep.read` / `reports.sales.by-paymethod.read` / `reports.sales.pipeline.read` / `reports.sales.by-branch.read` / `reports.sales.profitability.read` | Sales analysis reports (PHASE-013) / تقارير تحليل المبيعات | viewer, accountant, owner | tenant | no |
| `reports.purchasing.by-supplier.read` / `reports.purchasing.by-item.read` / `reports.purchasing.grni.read` / `reports.purchasing.matching.read` | Purchasing analysis reports / تقارير تحليل المشتريات | viewer, accountant, owner | tenant | no |
| `reports.treasury.fx.read` | FX differences report / تقرير فروق العملات | viewer, accountant, owner | tenant | no |
| `reports.tax.vat-return.read` / `reports.tax.summary.read` | VAT return v2 + treatment summary / الإقرار الضريبي والملخص | viewer, accountant, owner | tenant | no |
| `files.upload` / `files.view` | Attach and view documents / إرفاق وعرض الملفات | all tenant roles | branch/tenant | no |
| `files.manage` | Delete attachments (tombstone) / إدارة المرفقات | owner | tenant | no (audited) |
| `audit.view` | Read tenant audit trail / عرض سجل التدقيق | owner, accountant | tenant | no |
| `audit.export` | Export audit trail (audited) / تصدير سجل التدقيق | owner | tenant | no (audited) |
| `configuration.templates.apply` | Apply/switch industry template / تطبيق قالب الصناعة | owner | tenant | **yes** |
| `configuration.settings.manage` | Tenant settings, numbering, feature config / إعدادات المستأجر | owner | tenant | no |
| `configuration.custom_fields.read` | View custom-field definitions, picklists, form layouts (PHASE-036) / عرض الحقول المخصصة | accountant, owner | tenant | no |
| `configuration.custom_fields.manage` | Create/update/archive custom fields + picklists (PHASE-036) / إدارة الحقول المخصصة | owner | tenant | no (audited; values ride the owning entity's permission) |
| `configuration.form_layouts.manage` | Design per-entity form layouts + role overrides, BR-059 native protection (PHASE-036) / تصميم تخطيطات النماذج | owner | tenant | no (BR-059 guards mandatory native fields) |
| `industry.templates.manage` | Manage industry templates & registry reads / إدارة قوالب الصناعة | owner | tenant | no |
| `industry.templates.switch` | Switch/extend industry template (additive-only BR-038) / تبديل القالب (إضافي فقط) | owner | tenant | **yes** |
| `industry.terminology.manage` | Manage bilingual terminology overrides / إدارة المصطلحات ثنائية اللغة | owner | tenant | no |
| `sync.devices.register` / `sync.devices.revoke` | Register/revoke offline devices / تسجيل وإلغاء الأجهزة | owner (register delegated to device enrollment) | tenant | `revoke` **yes** (kills device data flow) |
| `sync.settings.manage` | Sync policies per entity / إعدادات المزامنة | owner | tenant | no |
| `crm.leads.manage` / `crm.tasks.manage` / `crm.activities.manage` | CRM basics (PHASE-019) / إدارة علاقات العملاء | sales, owner | branch | no |
| `crm.contracts.manage` / `crm.service_orders.manage` | Service contracts & orders / العقود وأوامر الخدمة | owner | tenant | no |
| `crm.contracts.bill` | Run recurring billing runs (PHASE-019) / تشغيل دورات الفوترة الدورية | owner, accountant | tenant | no (the run creates DRAFT/PENDING_APPROVAL invoices only — never auto-posts; posting is the ordinary approve+post chain, BR-034 SoD) |
| `manufacturing.boms.manage` | BOM maintenance / إدارة قوائم المواد | owner | tenant | no |
| `manufacturing.production_orders.view` / `.create` / `.approve` / `.post` | Production lifecycle (PHASE-018) / دورة أوامر الإنتاج | warehouse (create), owner | branch | `.approve`/`.post` **yes** |
| `manufacturing.qc.manage` | QC inspections and dispositions / إدارة فحوص الجودة | warehouse, owner | tenant | no (releasing quarantine has no journal; the qc_scrap stock issue rides the post keys) |
| `manufacturing.genealogy.read` | Batch genealogy reads / قراءة شجرة الدفعات | viewer, accountant, owner | tenant | no (read-only recall analytics — never mutates posted documents) |
| `manufacturing.costing.read` | Production costing reads / قراءة تكاليف الإنتاج | viewer, accountant, owner | tenant | no (WIP reconciliation + production-cost report) |
| `distribution.routes.manage` / `distribution.van_stock.view` | Van-sales operations (PHASE-017) / المبيعات الميدانية | sales, warehouse, owner | branch | no |
| `distribution.van_stock.manage` | Van load-out/unload operations / عمليات تحميل وتنزيل سيارات التوزيع | warehouse, owner | branch | no (stock moves ride the inventory transfer approvals) |
| `distribution.settlements.manage` | Create/count rep settlements / إدارة تسويات المناديب | sales, owner | branch | no (posting gated on the approve key / tolerance policy) |
| `distribution.settlements.approve` | Rep settlement approval / اعتماد تسويات المناديب | accountant, owner | tenant | **yes** |
| `distribution.tiers.manage` | Customer price tiers / إدارة فئات العملاء | sales, owner | tenant | no (BR-003 resolution is service-enforced; audited) |
| `distribution.free_goods.manage` | Free-goods promotion rules / إدارة قواعد السلع المجانية | sales, owner | tenant | no (rule engine never posts — the invoice path owns stock/COGS) |
| `pos.terminals.manage` | Register/activate terminals + enroll devices / إدارة أجهزة نقاط البيع | owner | tenant | no (audited) |
| `pos.sales.sell` | Counter sales + returns + tenders / البيع على الطرفية | cashier, owner | branch (terminal) | no (server re-validates stock/price/period) |
| `pos.shifts.manage` | Open/close terminal shifts / إدارة ورديات الطرفية | cashier, owner | branch (terminal) | no (BR-021 variance approval is the supervisor gate) |
| `pos.receipts.print` | Print/reprint 80/58 mm receipts / طباعة الإيصالات | cashier, owner | branch | no |

POS note (PHASE-016): the `pos.*` keys above are seeded by migration
`0024_pos_core.sql`; the POS shift endpoints reuse the `sales.pos_session.open` /
`.close` keys and the sync push path enforces `sales.pos_session.post` (§3.2) — both
sets are live on `pos` module routes. Device enrollment additionally requires
`sync.devices.register` / `.revoke` (rows above); revocation rejects pushes with
`DEVICE_REVOKED` before any command executes.

Distribution note (PHASE-017): the §3.8 `distribution.*` keys split across two seeds —
`distribution.routes.manage`, `distribution.van_stock.view`, and
`distribution.settlements.approve` arrive with the `0004` base seed (the phase's §3
prerequisites), while `distribution.settlements.manage`, `distribution.tiers.manage`,
`distribution.free_goods.manage`, and `distribution.van_stock.manage` are seeded by
migration `0025_automotive_distribution.sql` together with `sales.job_cards.manage`,
`sales.commissions.manage` (§3.2), and `partners.vehicles.manage` (§3.6) — the drift
checker reads the union (0004 + 0024 + 0025). Settlement approval is creator ≠
approver by default (BR-034); the `settlements.approve` key sits **only** on
`POST /distribution/settlements/:id/approve`.

Manufacturing note (PHASE-018): the §3.8 `manufacturing.*` family splits the same way —
`manufacturing.boms.manage` and the four `manufacturing.production_orders.*` suffix keys
sit on the pre-018 rows above (they predate the phase), while
`manufacturing.qc.manage`, `manufacturing.genealogy.read`, and
`manufacturing.costing.read` are seeded by migration `0026_manufacturing.sql`; the drift
checker reads the union (0004 + 0024 + 0025 + 0026). The RISKY pair stays
`.approve`/`.post` (release/start/cancel vs the posting surface); releasing a
quarantined FG batch has no journal, and the qc_scrap stock issue rides the post keys.
PHASE-042 extends the family again: the seven manufacturing-execution keys live in §3.20
(migrations 0065/0066 — the drift union grows to 279).

CRM note (PHASE-019): the `crm.*` family splits the same way — the five base keys
(`crm.leads.manage`, `crm.tasks.manage`, `crm.activities.manage`,
`crm.contracts.manage`, `crm.service_orders.manage`) sit on the `0004` base seed (the
phase's §3 prerequisites, re-asserted idempotently by 0027), while `crm.contracts.bill`
arrives with migration `0027_crm_projects.sql` together with
`accounting.projects.manage` (§3.1 — mirrors cost_centers; the drift checker reads the
union 0004 + 0024 + 0025 + 0026 + 0027). The billing key sits **only** on the
crm/billing-runs routes; the run's POLICY_ACTOR drafts can never self-approve (BR-034),
and a CLOSED project rejects new journal-line stamps at the engine (typed
PROJECT_CLOSED) — the key never bypasses either.

Sync credential-exchange note (PHASE-020 → PHASE-021, DR-P21-01): the device
credential plane has two **PUBLIC** (pre-auth) routes that carry no permission key by
design — the credential in the request body IS the authentication (the login pattern;
route-permissions `PUBLIC_ROUTES`): `POST /api/v1/devices/:id/refresh` (the rotating
refresh-token exchange, 020) and `POST /api/v1/devices/:id/enroll` (the one-time
enrollment-secret bootstrap, 021 — the sha256 proof clears `devices.device_key_hash`
on success and mints the first refresh token). Both derive their tenant scope from the
device row (device → user → ACTIVE membership, definer projection), never from a
session, and both fail with the same typed `DEVICE_REFRESH_INVALID` for wrong/expired
credentials (no existence leak). Revoked devices get `DEVICE_REVOKED` — the
`sync.devices.revoke` kill switch above stays authoritative; the exchanges can never
mint around it.

### 3.9 `identity` & `tenancy` (tenant-admin plane)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `identity.users.invite` / `.view` / `.manage` | User lifecycle / إدارة المستخدمين | owner | tenant | `manage` (deactivate) yes |
| `identity.roles.assign` | Assign roles/memberships / تعيين الأدوار | owner | tenant | **yes** |
| `identity.mfa.manage` | Manage own MFA / إدارة المصادقة الثنائية | every user (self) | self | no |
| `identity.mfa.admin_reset` | Reset another user's MFA / إعادة تعيين مصادقة مستخدم | owner | tenant | **yes** (audited) |
| `identity.sessions.revoke` | Revoke user sessions / إنهاء الجلسات | owner (self always) | tenant | **yes** |
| `identity.devices.manage` | Manage device registrations / إدارة تسجيل الأجهزة | owner | tenant | no |
| `tenancy.settings.manage` | Tenant profile, branding / إعدادات المستأجر | owner | tenant | no |
| `tenancy.branches.manage` | Branches & warehouses registry / إدارة الفروع | owner | tenant | no |
| `tenancy.subscription.manage` | Plan, billing, invoices of subscription / إدارة الاشتراك | owner | tenant | no |
| `tenancy.export.request` | Request full tenant export (offboarding) / طلب تصدير بيانات المستأجر | owner | tenant | **yes** (audited, rate-limited) |
| `tenancy.offboarding.execute` | Initiate offboarding purge / بدء حذف بيانات المستأجر | owner | tenant | **yes** (approval flow) |

### 3.10 `platform` (platform staff only — never assignable by tenants)

| Permission | Description EN / AR | Roles | Scope | Risky |
|------------|---------------------|-------|-------|-------|
| `platform.tenants.view` | Search/inspect tenants / عرض المستأجرين | platform_admin | platform | no (audited) |
| `platform.tenants.suspend` | Suspend a tenant (sessions die, sync stops) / تعليق المستأجر | platform_admin | platform | **yes** (approval flow) |
| `platform.tenants.restore` | Restore suspended tenant / إعادة تنشيط المستأجر | platform_admin | platform | no |
| `platform.tenants.offboard` | Execute offboarding purge after export / تنفيذ حذف بيانات المستأجر | platform_admin | platform | **yes** (two-person) |
| `platform.entitlements.manage` | Grant/change entitlements / إدارة الاستحقاقات | platform_admin | platform | no (audited) |
| `platform.subscriptions.manage` | Plans, billing overrides / إدارة الاشتراكات | platform_admin | platform | no (audited) |
| `platform.plans.manage` | Define plans/features / إدارة الخطط | platform_admin | platform | no |
| `platform.support.access` | Open time-boxed support session into tenant / فتح جلسة دعم محدودة المدة | platform_admin | platform | **yes** (§7) |
| `platform.audit.view` | Cross-tenant platform audit review / مراجعة تدقيق المنصة | platform_admin | platform | no |
| `platform.reporting.read` | Report runs history (tenant plane) / سجل تشغيل التقارير | platform_admin | platform | no |

### 3.11 `fixed_assets` (PHASE-026)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `fixed_assets.categories.manage` | Maintain asset categories and their purpose mappings (BR-041) / إدارة فئات الأصول وربط الأغراض | accountant, owner | tenant | no (purpose mapping audited) |
| `fixed_assets.assets.view` | View the asset register / عرض سجل الأصول الثابتة | viewer, accountant, owner | branch | no |
| `fixed_assets.assets.create` | Acquire/capitalize assets (G-21) / إدخال ورسملة الأصول | accountant, owner | branch | no |
| `fixed_assets.assets.manage` | Maintain assets (custodian, branch, status) / إدارة بيانات الأصول (العهدة، الفرع، الحالة) | accountant, owner | branch | no (audited) |
| `fixed_assets.depreciation_runs.view` | View depreciation runs / عرض تشغيلات الإهلاك | viewer, accountant, owner | tenant | no |
| `fixed_assets.depreciation_runs.run` | Execute the monthly depreciation run (G-22, BR-042) / تنفيذ تشغيل الإهلاك الشهري | accountant, owner | tenant | no (run = one journal, posts only after review) |
| `fixed_assets.depreciation_runs.post` | Post a depreciation run via the engine / ترحيل الإهلاك عبر محرك القيود | accountant, owner | tenant | **yes** |
| `fixed_assets.revaluations.create` | Draft an asset revaluation (BR-044) / إعداد إعادة تقييم الأصول | accountant, owner | tenant | no (audited) |
| `fixed_assets.revaluations.post` | Post the revaluation delta to `REVALUATION_RESERVE` / ترحيل إعادة التقييم | owner | tenant | **yes** |
| `fixed_assets.disposals.create` | Draft a disposal — sale/scrap (G-23) / إعداد استبعاد الأصول (بيع/كشط) | accountant, owner | branch | no |
| `fixed_assets.disposals.approve` | Approve a disposal / اعتماد استبعاد الأصول | owner | branch | **yes** |
| `fixed_assets.disposals.post` | Post the disposal journal (gain/loss per G-23) / ترحيل استبعاد الأصول | accountant, owner | branch | **yes** |
| `fixed_assets.reports.view` | View/run fixed-asset report keys ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md) §9) / تشغيل تقارير الأصول الثابتة | viewer, accountant, owner | tenant | no |

### 3.12 `notes` & `installments` (PHASE-027)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `notes.notes.view` | View cheques & promissory notes in custody / عرض الشيكات والأوراق التجارية | viewer, accountant, sales, purchasing, owner | tenant | no |
| `notes.notes.create` | Record a received/issued note (G-24/G-27) / تسجيل شيك أو ورقة تجارية | sales, purchasing, accountant, owner | tenant | no |
| `notes.notes.endorse` | Endorse out — custody moves, no journal (BR-047) / تظهير الشيك (انتقال العهدة دون قيد) | accountant, owner | tenant | no (audited) |
| `notes.notes.deposit` | Deposit a note at the bank / إيداع الشيك لدى البنك | accountant, owner | tenant | no |
| `notes.notes.record_dishonor` | Record dishonor — restores the open item exactly (G-26, BR-046) / تسجيل ارتداد الشيك (إعادة فتح الذمة) | accountant, owner | tenant | **yes** |
| `notes.notes.discount` | Discount a note at the bank (posts `NOTES_DISCOUNT_EXPENSE`) / خصم الورقة التجارية لدى البنك | accountant, owner | tenant | **yes** |
| `notes.notes.return` | Hand a note back pre-resolution — restores the open item exactly, no bounce reason/fee / إعادة الورقة قبل التحصيل (إعادة فتح الذمة دون سبب ارتداد أو رسوم) | accountant, owner | tenant | **yes** |
| `installments.plans.view` | View installment plans and schedules / عرض خطط الأقساط | sales, accountant, viewer, owner | branch | no |
| `installments.plans.manage` | Create/activate installment plans (BR-048) / إدارة خطط الأقساط | sales, owner | branch | no |
| `installments.lines.waive` | Waive an installment line (approval-gated) / إعفاء قسط (معتمد) | owner | branch | **yes** |

Installment **collections** are ordinary sales receipts allocated to installment lines —
they reuse the existing `sales.receipts.view` / `.create` / `.approve` keys (§3.4) under
the money-in ownership rule; no new receipt keys are introduced
([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §K).

### 3.13 `budgeting` (PHASE-028)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `budgeting.budgets.view` | View budgets and variance / عرض الموازنات والانحرافات | viewer, accountant, owner | tenant | no |
| `budgeting.budgets.create` | Draft budget versions (BR-050) / إعداد الموازنات (نسخ معتمدة) | accountant, owner | tenant | no |
| `budgeting.budgets.approve` | Approve a budget version / اعتماد الموازنة | owner | tenant | **yes** (SoD-guarded: creator ≠ approver) |
| `budgeting.budgets.activate` | Activate a budget (advisory controls — BR-051) / تفعيل الموازنة (رقابة استشارية) | owner | tenant | no (audited) |
| `budgeting.reports.view` | View/run budgeting report keys ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md) §9) / تشغيل تقارير الموازنات | viewer, accountant, owner | tenant | no |

### 3.14 `payroll` (PHASE-029)

Payroll data is **sensitivity-critical**: every access is audited, reads of
`payroll.employees.*` are role-restricted (not granted to `viewer`-derived templates by
default), and runs keep the three-way SoD split — create ≠ approve ≠ post.

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `payroll.employees.view` | View employees (sensitivity-critical) / عرض بيانات الموظفين (حساسية عالية) | payroll_officer, owner | branch | no (audited; role-restricted) |
| `payroll.employees.manage` | Maintain the employee master (bank fields, contract, salary) / إدارة بيانات الموظفين | payroll_officer, owner | branch | no (audited; role-restricted) |
| `payroll.salary_structures.manage` | Maintain salary structures and components (BR-052) / إدارة هياكل الرواتب ومكوناتها | payroll_officer, owner | tenant | no (audited) |
| `payroll.runs.view` | View payroll runs / عرض تشغيلات الرواتب | payroll_officer, accountant, owner | branch | no |
| `payroll.runs.create` | Create a monthly run draft (G-29) / إنشاء تشغيل رواتب (مسودة) | payroll_officer, owner | branch | no |
| `payroll.runs.approve` | Approve a run for posting / اعتماد الرواتب للترحيل | owner | tenant | **yes** |
| `payroll.runs.post` | Post the run's journals via the engine / ترحيل الرواتب عبر محرك القيود | accountant, owner | tenant | **yes** |
| `payroll.loans.manage` | Manage employee loans and deductions (cap BR-054) / إدارة سلف الموظفين | payroll_officer, owner | branch | no (audited) |
| `payroll.reports.view` | View/run payroll report keys ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md) §9) / تشغيل تقارير الرواتب | payroll_officer, accountant, owner | tenant | no (audited — `payroll.register` carries employee-level lines) |

### 3.15 `consolidation` (PHASE-034)

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `consolidation.groups.manage` | Maintain groups and member entities (ownership %, include-from) / إدارة مجموعات التوحيد والشركات التابعة | owner | tenant | no (audited) |
| `consolidation.eliminations.create` | Draft elimination entries / إعداد قيود الاستبعاد | accountant, owner | tenant | no |
| `consolidation.eliminations.post` | Post eliminations to the consolidation books (G-32) / ترحيل قيود الاستبعاد (دفاتر التوحيد) | owner | tenant | **yes** |
| `consolidation.runs.execute` | Execute a consolidation run — read-only over member books, zero cross-tenant writes (ADR-0018, INV-026) / تنفيذ التوحيد (قراءة فقط) | accountant, owner | tenant | no (audited) |
| `consolidation.reports.view` | View/run consolidated statement keys ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md) §10) / تشغيل التقارير الموحدة | viewer, accountant, owner | tenant | no |

### 3.16 `purchasing` sourcing & supplier collaboration (PHASE-038)

The negotiation loop in front of the purchase order (H-11): RFQ rounds,
quotes, the award matrix, blanket agreements, supplier scorecards, CAPEX,
advances/discounts, tender intake. The supplier-portal route (P-05) is
PUBLIC — the invitation token IS the credential (the enrollment pattern);
every portal submission is audited + rate-limited and scoped to exactly
(one RFQ × one supplier).

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `purchasing.rfqs.read` | View RFQs, quotes, comparisons, blanket orders, supplier collaboration / عرض طلبات عروض الأسعار والمقارنات والاتفاقيات الإطارية وتعاون الموردين | accountant, purchasing, owner | tenant | no |
| `purchasing.rfqs.manage` | Manage RFQs, quotes, blanket agreements, advances and tenders / إدارة طلبات عروض الأسعار وعروض الموردين والاتفاقيات الإطارية والسلف والمناقصات | purchasing, owner | tenant | no (audited) |
| `purchasing.rfqs.award` | Award RFQ rounds and generate orders/releases (BR-062/BR-063) / ترسية دورات المنافسة الشرائية وتوليد أوامر الشراء | purchasing, owner | tenant | **yes** (audited; the award closes the round) |
| `purchasing.suppliers.rate` | Compute and review supplier scorecards (P-04) / احتساب ومراجعة بطاقات تقييم الموردين | purchasing, owner | tenant | no (audited) |
| `purchasing.capex.read` | View CAPEX requests / عرض طلبات الشراء الرأسمالي | accountant, purchasing, owner | tenant | no |
| `purchasing.capex.manage` | Create and submit CAPEX requests (the 028 budget guard) / إنشاء وإرسال طلبات الشراء الرأسمالي | purchasing, owner | tenant | no (audited) |
| `purchasing.capex.approve` | Approve or reject CAPEX requests — creator ≠ approver / اعتماد أو رفض طلبات الشراء الرأسمالي (الفصل: المنشئ ≠ المعتمد) | owner | tenant | **yes** (SoD §4) |

### 3.17 `sales` / `purchasing` returns & collections (PHASE-039)

The returns & collections cluster (CR-09, scope extended by v3.1/CR-46 and v3.2/CR-50 ·
R-03): the customer RMA workflow to its completion credit note (goldens G-35/G-36/G-37),
the managed-warranty register, the BR-065 dunning ladder with its late-fee register
(L1-12), the periodic partner credit reviews (L1-10), and the collection-agency terminal
layer (L1-11, golden G-39) — plus the supplier RMA mirror to the AP debit note (G-38).
**All nine keys seed in migration `0056` §9 — the permission catalog extends 256 → 265
(seed = mirror, zero drift).** The **public agency-callback route**
(`POST /api/v1/portal/collection-agencies/callback`) is PUBLIC — the agency's callback
token IS the credential (the 038 supplier-portal pattern verbatim: a 256-bit random
hex value, sha256-hashed at rest, shown once at issuance, rotatable by re-issuing);
`erp.portal_resolve_agency_token` resolves the tenant pre-GUC (a read-only SECURITY
DEFINER projection), the service re-validates the same token under RLS inside the
tenant scope, and the route is fixed-window rate-limited (10/min per token hash) +
audited — a referral outside the agency's own book draws the SAME typed rejection as
an unknown token (no oracle).

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `sales.rma.read` | View customer RMAs and the returns workspace — both families feed `sales.rma_register` / عرض طلبات الإرجاع ومساحة عملها | accountant, sales, purchasing, owner | tenant | no |
| `sales.rma.manage` | Create and progress customer RMAs — receive, inspect, complete (the completion posts the CN + the G-36/G-37 legs atomically) / إنشاء وتسيير مرتجعات العملاء عبر دورة الحياة | sales, owner | tenant | no (audited; the completion's money legs ride the credit note's OWN SoD gate — the CN's creator is the RMA's requester, so completer ≠ requester) |
| `sales.rma.approve` | Approve customer RMAs (SoD: creator ≠ approver; reserves `RMA-{YYYY}-{SEQ:6}`) / اعتماد مرتجعات العملاء (الفصل: المنشئ ≠ المعتمد) | sales, owner | tenant | **yes** (SoD §4) |
| `sales.warranties.manage` | Manage warranty registrations and structured terms + the 30/7/0-day expiry sweep / إدارة تسجيلات الضمان وشروطها المهيكلة | sales, owner | tenant | no (audited; operational evidence — no ledger legs) |
| `sales.dunning.manage` | Manage dunning policies, run the BR-065 sweep, the letters register, collection actions, and the credit reviews / إدارة سياسات التحصيل والرسائل وإجراءات التحصيل والمراجعات الائتمانية | accountant, sales, owner | tenant | no (audited; the sweep only records — the fee charge and the commission post ride their own keys) |
| `sales.late-fees.manage` | Charge and waive late-payment fees (L1-12) / احتساب وإعفاء غرامات التأخير | accountant, owner | tenant | **yes** (audited; the charge posts a fee invoice through the sales engine with VAT on the tenant-mapped fee item — fail-closed; the waiver stamps its reason + approver trio) |
| `sales.collection-agencies.manage` | Manage collection agencies, referrals, and the G-39 commission postings (L1-11) / إدارة وكالات التحصيل والإحالات وقيود العمولة | accountant, owner | tenant | no (audited; the G-39 commission posts engine-gated exactly-once — the `sales.commissions.manage` precedent) |
| `purchasing.rma.read` | View supplier return authorizations (the RTV register) / عرض طلبات إرجاع الموردين | accountant, purchasing, owner | tenant | no |
| `purchasing.rma.manage` | Create and progress supplier RMAs to the G-38 debit note / إنشاء وتسيير مرتجعات الموردين حتى إشعار المدين | purchasing, owner | tenant | no (audited; the SoD creator ≠ approver gate is server-side on the approve hop — the route reuses the manage key; the G-38 credit + DN post engine-gated exactly-once) |

**Guarded routes** (ROUTE_PERMISSIONS, PHASE-039): sales — `/api/v1/sales/returns`
(GET/POST, `/:id`), `/:id/approve` (`sales.rma.approve`), `/:id/receive|inspect|complete|cancel`
(`sales.rma.manage`); `/api/v1/sales/warranties` (GET/POST, `/:id/void`);
`/api/v1/sales/dunning/policies` (GET/POST/PATCH, `/:id/activate|archive`),
`/api/v1/sales/dunning/run`, `/letters`, `/actions` (`sales.dunning.manage`);
`/api/v1/sales/dunning/charge-fee` + `/letters/:id/waive-fee` (`sales.late-fees.manage`);
`/api/v1/sales/credit-reviews` (GET, `/:partnerId` POST); `/api/v1/sales/collection-agencies`
(GET/POST, `/:id/issue-token|suspend|activate`) + `/api/v1/sales/collection-referrals`
(GET/POST, `/:id/settle|post-commission|close`) — all under `sales.collection-agencies.manage`;
purchasing — `/api/v1/purchasing/returns` (GET/POST, `/:id`, `/:id/approve|ship|credit|cancel`).
Role grants per 0056 §9: owner holds all nine; accountant gains the two RMA reads +
dunning + late-fees + agencies; sales gains the RMA trio + dunning + warranties;
purchasing gains the purchasing pair + `sales.rma.read`.

### 3.18 `configuration` data onboarding & migration toolkit (PHASE-040)

The PHASE-040 toolkit (CR-10, scope extended by v3.1/CR-46 — the L1-21 export-templates
half): the seven-kind import engine (COA, ACCOUNT_OPENING_BALANCES, FIXED_ASSETS,
EMPLOYEES, PRICE_LISTS, CONTRACTS, BUDGETS) with the dry-run → commit gate (BR-066),
the column-mapping wizard, saved mappings (both directions — import maps + export
templates), the QuickBooks/Odoo/Excel-generic migration adapters, the 13-template demo-data
loader, and the platform-plane SANDBOX tenant provisioning (OA-05). **Both keys seed in
migration `0060` §7 — the permission catalog extends 265 → 267 (seed = mirror, zero
drift).** Naming note (recorded deviation, PHASE-040 completion report §4): the phase doc
planned `platform.imports.manage`/`platform.demo_data.manage` — renamed because §3.10
and the identity-flows checklist pin `platform.*` as never tenant-assignable; the
platform-plane sandbox route (`POST /api/v1/platform/sandbox-tenants`) rides the existing
`platform.subscriptions.manage` (never plan-gated — the `platform.payouts` precedent).
The baseline items import console (`items.import.run`, §3.6) is untouched.

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `configuration.imports.manage` | Run the import toolkit: seven kinds, mapping wizard, saved mappings (import + export templates), migration adapters, error-report exports / تشغيل عدّة الاستيراد: سبعة أنواع ومعيّن ربط الأعمدة والخرائط المحفوظة ومحوّلات الترحيل وتصدير تقارير الأخطاء | owner, accountant | tenant | no (audited; the dry-run writes NOTHING — BR-066 zero-write gate; the commit is atomic per run with no partial state) |
| `configuration.demo_data.manage` | Seed one-click realistic demo data per industry template (idempotent; refuses tenants with posted real documents) and provision time-boxed SANDBOX demo tenants from the platform plane / تحميل البيانات التجريبية الواقعية لكل قالب قطاعي وإنشاء المستأجرين التجريبيين المحدودين المدة | owner | tenant (the loader); platform (`platform.subscriptions.manage` on the sandbox route) | **yes** (audited; demo data is flagged + idempotent; a sandbox tenant is quota-capped, time-boxed, and never a consolidation member) |

### 3.19 `communication` communications hub (PHASE-041)

The PHASE-041 Communications Hub (CR-11 · H-22 · N-06…N-08 · FD-30 · TB-23 · UX-14 · IN-16/IN-17):
the channel-port adapters (WhatsApp Business Cloud API, Unifonic/Msegat/Twilio SMS,
SMTP/SendGrid/SES/Mailgun email — ALL behind the port, BR-067: the SANDBOX default provider
makes zero external calls until a real one is configured and credentialed), the tenant
template hub (FD-30), the outbound send ledger, the preference matrix (TB-23), the unified
inbox with call logging, and the Google/Outlook calendar connect. **All five keys seed in
migration `0064` §9 — the permission catalog extends 267 → 272 (seed = mirror, zero
drift).** Users manage their OWN preference rows on the self plane (the `/me` route pattern
— `notification_prefs` precedent); `communication.preferences.manage` governs the TENANT
DEFAULT rows only.

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `communication.templates.manage` | Manage tenant message templates (channel × locale × module, typed variables, builtin-catalog fallback) / إدارة قوالب رسائل المستأجر (قناة × لغة × وحدة بمتغيرات مطبَّعة مع سقوطٍ على القوالب المدمجة) | owner, accountant | tenant | no (audited; templates are render-only data — a bad template cannot post or move money) |
| `communication.outbox.read` | Read the outbound send ledger (status transitions, provider references, cost, retries) and the delivery-log report / قراءة سجل الإرسال الخارجي (انتقالات الحالة ومراجع المزوّدين والتكلفة والإعادات) وتقرير سجل التسليم | owner, accountant | tenant | no (read-only over the ledger; costs are advisory inputs, never postings) |
| `communication.preferences.manage` | Manage the TENANT DEFAULT notification-preference rows (module × channel matrix); users self-manage their own rows / إدارة صفوف الافتراضات لتفضيلات الإشعار للمستأجر (مصفوفة الوحدة × القناة)؛ ويدير كل مستخدم صفوفه بنفسه | owner | tenant | no (preferences suppress only — they never fabricate events) |
| `communication.inbox.read` | Read the unified inbox (per-partner interaction timeline with filters) and log calls (outcome/duration linked to partner + user) / قراءة الصندوق الموحّد (خط تفاعلات كل شريك مع المرشحات) وتسجيل المكالمات (النتيجة والمدة مربوطة بالشريك والمستخدم) | owner, accountant, sales | tenant | no (audited; call entries are editable by their logger — log semantics, no delete) |
| `communication.calendar.connect` | Connect Google/Outlook calendars via OAuth (minimal scopes), write task/appointment events, opt into two-way contacts sync with match review (never auto-merge) / ربط تقويمات Google/Outlook عبر OAuth بأدنى الصلاحيات وكتابة أحداث المهام والمواعيد وتفعيل مزامنة جهات الاتصال ثنائية الاتجاه مع مراجعة المطابقة (لا دمج تلقائي أبداً) | owner | tenant | **yes** (OAuth tokens sealed in the secret store — never logged, masked in settings; rotation documented; contacts sync is per-tenant opt-in with review-only merging) |

### 3.20 `manufacturing` manufacturing execution (PHASE-042)

The PHASE-042 manufacturing execution cluster (CR-12, scope extended by v3.1/CR-45
L2-12 · H-04 · M-02…M-19): work centers (per-shift capacity + fixed/var hourly cost
rates + the cost-center analytics link), versioned routings and their sequenced
operations, the release-frozen `production_order_operations` rows with the INV-028
sequence machine, the shop-floor scan terminal (`OP:<order>:<seq>:<action>` — the
touch-first execution surface), rework orders to their G-41 completion (BR-069), the
reason-coded downtime log with the policy-gated G-42 posting (BR-070), the OEE
security_invoker views, and the item standard costs (L2-12: roll-up over BOM +
routing, freeze/activate, PPV at receipt, stock revaluation). **All seven keys seed in
migrations `0065` §13 + `0066` §7 — the permission catalog extends 272 → 279 (seed =
mirror, zero drift).** Numbering note (the 0064 D-1 precedent, recorded in 0065 §13):
the phase doc planned a `manufacturing.costing` key — already live as
`manufacturing.costing.read` (0026, §3.8) — so the delivered set is the seven below;
the phase doc's planned migration numbers (≈0060…0066) likewise landed as 0065/0066
(039/040/041 consumed 0055…0064). The production order's own lifecycle keys stay in
§3.8 (`.view`/`.create`/`.approve`/`.post`); the operations read endpoint rides
`manufacturing.production_orders.view`.

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `manufacturing.work_centers.manage` | Manage work centers (capacity, rates, status, cost-center link) / إدارة مراكز العمل (السعة والمعدلات والوضع وربط مركز التكلفة) | owner, accountant | tenant | no (audited; master data — rate changes never move a live order's frozen standard, BR-068) |
| `manufacturing.routings.manage` | Manage versioned routings and their operations / إدارة مسارات التشغيل المرقّمة وعملياتها | owner, accountant | tenant | no (audited; one ACTIVE per item — the BOM discipline) |
| `manufacturing.shopfloor.execute` | Execute shop-floor operations (scan start/pause/complete, log scrap and downtime) / تنفيذ عمليات أرضية المصنع (بدء/إيقاف/إكمال بالمسح وتسجيل الهالك والتوقف) | owner, warehouse | tenant | no (audited; the G-40 completion posts engine-gated exactly-once under the `op_<seq>` key — INV-013/INV-028; the skip hop carries its own SoD approver, never this key alone) |
| `manufacturing.rework_orders.manage` | Manage rework orders (create from defect, release, complete) / إدارة أوامر إعادة التشغيل | owner, accountant | tenant | no (audited; the G-41 completion posts engine-gated exactly-once — rework expense, never the parent FG layer, BR-069) |
| `manufacturing.downtime.log` | Log and close downtime records with reason codes / تسجيل وإغلاق حالات التوقف بأكواد الأسباب | owner, warehouse | tenant | no (audited; record-only by default — the G-42 cost leg is the `manufacturing.downtime_posting='post'` opt-in, BR-070) |
| `manufacturing.oee.read` | Read OEE views and work-center utilization / قراءة مؤشرات OEE واستغلال مراكز العمل | owner, accountant, warehouse, viewer | tenant | no (read-only over the derived security_invoker views — RLS applies through them) |
| `manufacturing.standard_costs.manage` | Manage item standard costs (roll-up, freeze/activate, revaluation) / إدارة التكاليف المعيارية للأصناف (التجميع والتجميد والتفعيل وإعادة التقييم) | owner, accountant | tenant | no (audited; the stock revaluation on activate posts one batch journal engine-gated exactly-once — the STANDARD_REVALUATION contra, never a silent layer rewrite) |

**Guarded routes** (ROUTE_PERMISSIONS, PHASE-042): `/api/v1/manufacturing/work-centers`
(GET/POST, `/:id` PATCH, `/:id/status` — `manufacturing.work_centers.manage`);
`/api/v1/manufacturing/routings` (GET/POST, `/:id` PATCH + `/activate|copy` —
`manufacturing.routings.manage`); the order operations endpoint
`/api/v1/manufacturing/production-orders/:id/operations` (GET —
`manufacturing.production_orders.view`) plus
`/:seq/start|pause|resume|complete|skip` and `/api/v1/manufacturing/shopfloor/scan`
(`manufacturing.shopfloor.execute`); `/api/v1/manufacturing/downtime` (GET/POST,
`/:id/close` — `manufacturing.downtime.log`); `/api/v1/manufacturing/oee` (GET —
`manufacturing.oee.read`); `/api/v1/manufacturing/rework-orders` (GET/POST,
`/:id/release|start|complete|cancel` — `manufacturing.rework_orders.manage`);
`/api/v1/manufacturing/standard-costs` (GET/POST, `/roll-up`, `/:id/activate` —
`manufacturing.standard_costs.manage`). Role grants per 0065 §13 + 0066 §7: owner
holds all seven; accountant gains `work_centers.manage`, `routings.manage`,
`rework_orders.manage`, `oee.read` + `standard_costs.manage`; warehouse gains
`shopfloor.execute` + `downtime.log` + `oee.read` (the operational tier — the 0026
`qc.manage` precedent); viewer gains `oee.read` only.

### 3.21 `inventory` WMS & inventory intelligence (PHASE-044)

The PHASE-044 WMS cluster (CR-14 · H-07 · I-01…I-25 · PP-11/PP-12): the location tree
(zones/aisles/racks/bins with barcodes), bin-level contents with status/ownership, the
INV-029 same-transaction discipline, directed putaway with the PP-12 label, directed
picking (FIFO/FEFO/NEAREST, waves, cluster, scan confirms), cycle-count schedules and
their BR-075 threshold gate, ABC classification, the serial-movement ledger, the
quarantine/HOLD board with its G-43 policy gate, and the consignment/VMI substrate.
**All eight keys seed in migration `0071` §1–§2 — the permission catalog extends
279 → 287 (seed = mirror, zero drift).** The plan grants (0071 §3) put the eight
feature keys on business + enterprise; the distribution-bearing templates
(`industry.distribution` + `industry.wholesale`) require them by default (0071 §4).

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `inventory.wms.locations` | Manage the WMS location tree (zones/aisles/racks/bins, barcodes, pick sequence) / إدارة شجرة مواقع المستودع | owner, accountant, warehouse | tenant | no (audited; structural master data — the one-default floors are BR-073; the INV-029 reconciliation read rides this key) |
| `inventory.wms.putaway` | Execute directed putaway (suggested tasks, bin-label print, scan confirm) / تنفيذ التخزين الموجّه | owner, accountant, warehouse | tenant | no (audited; the scan confirm is a structural move — the wrong-bin scan is the typed zero-residue rejection; the economic write rode the receipt's own journal) |
| `inventory.wms.picking` | Execute directed picking (waves, strategies FIFO/FEFO/NEAREST, cluster + scan) / تنفيذ الانتقاء الموجّه | owner, accountant, warehouse | tenant | no (audited; task confirms are bookkeeping — the economic move rides the delivery post's directedTakes, INV-029 holds either way) |
| `inventory.cycle_counts` | Manage cycle-count schedules, documents, and variance approvals / إدارة الجداول والمستندات والاعتمادات | owner, accountant, warehouse | tenant | **yes** (posting variances adjusts the ledger — the BR-075 threshold forces the supervisor flag on material variances; the approval is SoD-shaped by design) |
| `inventory.abc` | Read ABC classifications and recompute schedules / قراءة تصنيفات ABC وإعادة احتسابها | owner, accountant, viewer | tenant | no (read + recompute of the derived generation — never a valuation write) |
| `inventory.tracking.serial_ledger` | Read the serial-movement ledger / قراءة دفتر الحركة التسلسلية | owner, accountant, warehouse, viewer | tenant | no (append-only ledger reads) |
| `inventory.quarantine` | Manage the quarantine/HOLD board and dispositions / إدارة اللوحة والتصرفات | owner, accountant, warehouse | tenant | **yes** (the SCRAP/RTV dispositions post through the movement core + engine — audited, exactly-once; the G-43 leg is the BR-077 policy gate) |
| `inventory.tracking.consignment` | Manage consignment/VMI stock (receive, settle) / إدارة مخزون الأمانة | owner, accountant, warehouse | tenant | **yes** (the G-44 consumption settlement posts COGS · CONSIGNATION_PAYABLE — fail-closed until 2135 maps, BR-077) |

**Guarded routes** (ROUTE_PERMISSIONS, PHASE-044): the `/api/v1/inventory/wms/*`
family — `zones` (+`/:id` PATCH, `/:id/aisles`), `aisles/:id/racks`, `bins`
(+`/barcode/:barcode`, `/:id` PATCH), `locations/tree`, `bin-contents`,
`availability-by-bin`, `reconcile`, `lpns` (+`/:id/close|bind|move|contents`) —
`inventory.wms.locations`; `serial-movements` — `inventory.tracking.serial_ledger`;
`putaway/rules` (+`/:id` PATCH), `putaway/tasks` (+`/:id/assign|confirm|cancel`,
`/:id/label`, `labels`) — `inventory.wms.putaway`; `pick-strategy`
(GET `/:warehouseId` + PUT), `pick-waves` (+`/:id`, `/:id/tasks`,
`/:id/cluster-route`, `/:id/release|complete|cancel`), `pick-tasks`
(+`/:id/assign|start|confirm|cancel`) — `inventory.wms.picking`;
`cycle-count-schedules` (+`/:id` PATCH, `/:id/run`), `cycle-count-documents`
(+`/:id`, `/:id/lines`, `/:id/enter|recount|submit|review|approve|cancel`) —
`inventory.cycle_counts`; `abc` + `abc/recompute` — `inventory.abc`;
`quarantine-board` (+`/:contentId/transition|dispose`) and the raw
`bin-contents/:id/transition` — `inventory.quarantine`; plus the delivery wave
`/api/v1/sales/delivery-notes/:id/pick-wave` — `inventory.wms.picking` (the 0071 §1
matrix row, not the sales create key). Role grants per 0071 §2: owner + accountant
hold all eight; warehouse holds the operational seven (abc stays the analysis tier);
viewer holds the read pair (`abc` + `serial_ledger` — the 042 oee.read precedent).

### 3.22 `manufacturing` MRP & planning (PHASE-043)

The PHASE-043 planning cluster (CR-13 · H-03 · M-01/M-05…M-11/M-21/M-22/M-24/M-25 ·
S-10 · I-14): the deterministic MRP engine and its run/suggestion lifecycle, the
master production schedule with its BR-078 frozen-fence law, the item planning
policies (lead time, safety stock, lot sizing, time fences), the ATP/CTP query with
the BR-080 hard exclusions, and the bill-of-resources rough-cut check. **All four
keys seed in migration `0078` §1 — the permission catalog extends 287 → 291
(seed = mirror, zero drift).** The plan grants (0078 §2) put the three feature keys
(`manufacturing.mrp` · `manufacturing.mps` · `manufacturing.planning`) on business +
enterprise only — planning is not a starter feature; the food_manufacturing template
requires them by default (0078 §4).

| Permission | Description EN / AR | Minimal roles | Scope | Risky |
|------------|---------------------|---------------|-------|-------|
| `manufacturing.mrp` | Run MRP and manage suggestions (accept / dismiss / convert) / تشغيل تخطيط الاحتياجات وإدارة الاقتراحات (قبول/رفض/تحويل) | owner, accountant, warehouse | tenant | no (audited; runs are read-only snapshots that post nothing — the INV-030 one-conversion law makes acceptance idempotent; the converted PO/MO/transfer posts through the owning module's exactly-once engine) |
| `manufacturing.mps` | Manage master production schedule entries / إدارة سطور الجدول الزمني للإنتاج الرئيسي | owner, accountant, warehouse | tenant | **yes** (MPS rows are demand input to every run — an in-fence edit requires the override key AND a reason, BR-078; the MpsFenceEdit audit rows carry both) |
| `manufacturing.planning_policies` | Manage item planning policies (lead time, safety stock, lot sizing, time fences) / إدارة سياسات تخطيط الصنف (زمن التوريد ومخزون الأمان والتحجم والأسوار الزمنية) | owner, accountant | tenant | no (audited master data — but policy edits change every later plan; the MRP exceptions report surfaces the data-readiness defects, M-01) |
| `manufacturing.mps.frozen_edit` | Edit MPS entries inside the frozen fence (with reason) / تعديل سطور الجدول داخل السياج المجمد (مع السبب) | owner, accountant | tenant | **yes** (the BR-078 override — DATA-DEPENDENT, resolved per request against the entry's bucket vs the item's frozen fence; never a bare route key, always paired with the reason the service requires) |

**Guarded routes** (ROUTE_PERMISSIONS, PHASE-043): the `/api/v1/manufacturing/mrp`
family — `runs` (GET, POST), `runs/:id` (GET), `suggestions` (GET),
`suggestions/:id/accept` + `suggestions/:id/dismiss` (POST) — `manufacturing.mrp`;
the `/mps` family — `entries` (GET, POST, PATCH), `readiness` (GET) —
`manufacturing.mps`; the `/planning` family — `lot-sizing-rules` (GET),
`policies/:itemId` (GET, PATCH) — `manufacturing.planning_policies`; `atp` (POST)
and `bor/rough-cut` (POST) — `manufacturing.mrp`. The cluster also guards its
existing-key routes: `planning/bor/:bomId` (GET, PUT), `boms/:id/substitutions`
(GET, PUT), `boms/:id/outputs` (GET, PUT) — `manufacturing.boms.manage`; the tolling
round trip `tolling/orders` (GET, POST), `tolling/orders/:id` (GET),
`tolling/orders/:id/issue|return|settle` (POST) — the `production_orders`
view/create/post keys; the MTO link `production-orders/:id/link-sales-order` (POST)
— `manufacturing.production_orders.create`; and the sales-side ATP probe
`/api/v1/sales/sales-orders/:id/lines/:lineId/atp` (GET) — `sales.orders.view`.
Role grants per 0078 §1: owner + accountant hold all four; the warehouse role (the
material planners' tier) holds `mrp` + `mps` — NOT the policy master data and NOT
the frozen-fence override; the viewer role holds none (runs are operational
screens — `oee.read` remains the viewer's manufacturing read surface).

## 4. Segregation of duties & approval limits

1. **Creator ≠ approver** for every approval-separated action, unless the tenant enables
   the `allow_self_approval` policy (default **off**). When on, self-approvals are still
   flagged in audit and excluded for: `accounting.periods.reopen`,
   `tenancy.offboarding.execute`, `identity.roles.assign`, `platform.*` (never).
2. `create` → `approve` → `post` are three distinct permissions; no role template below
   `owner` holds all three for high-risk resources by default; tenants may compose but the
   SoD warning fires at role-edit time.
3. **Approval limits**: risky money permissions carry an optional limit
   (`approval_limit` amount in base currency, per role, per permission). Examples:
   `sales.invoices.approve` ≤ 50,000 for a senior-sales role; above the limit the action
   routes to the next approver or fails with `APPROVAL_LIMIT_EXCEEDED`. Limits are
   evaluated server-side with the document total (tax inclusive) and audited. Business
   behavior: [../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md).
4. Period-lock and reopen actions are tenant-wide and always audited; reopen of a period
   older than 2 months raises an anti-fraud alert ([../accounting/PERIOD_CLOSING.md](../accounting/PERIOD_CLOSING.md) §2).
5. v2.0 approval-gated keys ([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §K):
   `fixed_assets.disposals.approve`, `budgeting.budgets.approve`, `payroll.runs.approve`,
   `consolidation.eliminations.post` — creator ≠ approver applies to each and none is
   grantable to `viewer`-derived templates. Every other key marked **yes** in §3.11–§3.15
   (e.g. `fixed_assets.depreciation_runs.post`, `notes.notes.record_dishonor`,
   `notes.notes.discount`, `notes.notes.return`, `installments.lines.waive`,
   `payroll.runs.post`) follows the same separation and audit
   rules; payroll keeps the full three-way split (`payroll.runs.create` ≠ `.approve` ≠
   `.post`) and payroll audit events record the acting user, run id, and totals.

## 5. Branch-scoping rules

| Rule | Detail |
|------|--------|
| Grant shape | A membership carries `(role, scope)` where scope = tenant-wide or a set of branch ids |
| Enforcement | Route decorator resolves branch scope; service checks re-verify for cross-branch references (e.g., transferring stock to a non-granted branch → 403) |
| Documents | A document belongs to a branch; users see documents of granted branches only; accountants default tenant-wide |
| Explicit exceptions | `accounting.*`, `tax.*`, `reporting.*` are tenant-scoped roles by design; `cashier` is terminal-scoped (one branch, one terminal during a shift) |
| Subledger visibility | Partner statements aggregate across granted branches only for branch-scoped roles |
| Payroll (PHASE-029) | Employees belong to a branch: `payroll.employees.*` and `payroll.runs.*` are branch-scoped (a run aggregates the granted branches only); every payroll read/write is audited (sensitivity-critical, §3.14) |
| Consolidation (PHASE-034) | Tenant-plane, never branch-scoped — groups, eliminations, runs, and consolidated statements act on the parent's consolidation books across member tenants ([../architecture/ADR/ADR-0018-multi-entity-consolidation.md](../architecture/ADR/ADR-0018-multi-entity-consolidation.md)) |

## 6. Personal-account (customer portal) permission set

Read-only, own-data-only. A portal identity links to exactly one partner record
(customer); every query is additionally constrained by `partner_id = own` (server-side,
RLS-equivalent check in the portal scope — cannot read other customers' data by id
enumeration → 404 policy).

| Permission | Description | Notes |
|------------|-------------|-------|
| `portal.account.view` | Own balance, credit terms | Read-only |
| `portal.invoices.view` / `portal.invoices.download` | Own invoices + PDF | Own documents only |
| `portal.statements.view` | Own statement | As-of recomputed, deterministic |
| `portal.receipts.download` | Own receipt documents | Read-only |
| `portal.payments.view` | Own payment history | Online payments deferred (OQ-007) |

Portal identities never hold tenant roles; they cannot see tenant users, items, stock,
or any other partner. (FR-PAS-004; app views FR-OFF-006.)

## 7. Support access (platform staff → tenant)

| Property | Rule |
|----------|------|
| Grant | Requires `platform.support.access` + tenant opt-in (tenant toggle) OR a declared incident with ticket id |
| Time-box | Default max 4 h, single extension requires re-approval; expires automatically |
| Acting identity | Actions execute as the support user with `via_platform_admin = true` on every audit event (never as a fabricated tenant user) |
| Permissions during session | Read-all + explicitly enumerated actions; risky tenant permissions (post, reopen, offboarding) remain with tenant users |
| Audit | Session open/close + every action audited; tenant owners can review the support-session audit trail afterwards |
| Revocation | Tenant can terminate an opt-in session at any time; suspension kills active sessions |

## 8. Enforcement layers (and what each one is NOT)

| Layer | Enforces | Notes / non-goals |
|-------|----------|-------------------|
| 1. Route decorator (`@RequirePermissions`) | Permission key + branch scope per route | Generated checklist per route; the ONLY place client requests are admitted |
| 2. Service-layer check | Domain rules (limits, SoD, state machines: `ALREADY_POSTED`, `APPROVAL_LIMIT_EXCEEDED`, `PERIOD_LOCKED`) | Decorators alone are insufficient — business state lives here |
| 3. RLS (PostgreSQL) | Tenant isolation regardless of bugs above | Not a permission system: a valid-tenant user with wrong permissions is stopped at layers 1–2, and RLS denies cross-tenant reach ([../database/TENANT_ISOLATION.md](../database/TENANT_ISOLATION.md)) |
| 4. UI visibility | Derived only, never authoritative | Hiding buttons is UX, never a control (directive §9); UI hides what the permission endpoint says the user lacks |

**Audit rule**: every risky permission use writes an audit event (actor, permission key,
target entity, before/after) in the same transaction as the state change
([../architecture/SECURITY_ARCHITECTURE.md](../architecture/SECURITY_ARCHITECTURE.md) §audit).

## 9. Maintenance protocol

1. New routes ship with their permission keys in the same PR; the CI checklist compares
   route registry ↔ this file (docs-drift check,
   [../testing/REGRESSION_STRATEGY.md](../testing/REGRESSION_STRATEGY.md)).
2. New permissions require: entry here + role-template update + permission tests + seed
   migration — in the same phase.
3. Changing a risky permission's rules (limits, SoD) requires a decision record under
   [../decisions/](../decisions/README.md).
4. Phase gating: each module's permissions activate with its phase
   ([../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md)); unused-before-phase
   keys exist in the catalog but their routes 404 until the phase completes.
