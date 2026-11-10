-- PHASE-004 · migration 0008 · platform seeds (plans skeleton, industry
-- template index, default CoA template)
--
-- Purpose (PHASE-004 §2.5/T3; SEEDS/README P-004 rows): the three DR-001
-- plan skeletons (starter/business/enterprise), the 13-template
-- industry index, and the bilingual default Chart of Accounts
-- (CHART_OF_ACCOUNTS §3, all 42 rows with their 16 purpose markers).
--
-- PLACEHOLDER ATTESTATION (acceptance 10, OQ-002, RISK-003): every price
-- and every limit below is a PLACEHOLDER pending the pricing decision
-- record (DR-001 status OPEN). No pricing surface is presented to users
-- anywhere in this phase; prices seed at 0.00 as explicit placeholders.
-- The MECHANISM (limits jsonb + feature_keys[]) is normative (DR-001
-- architecture counter-signature: no schema change needed at billing
-- time). Feature-key sets follow SUBSCRIPTION_AND_ENTITLEMENTS §2
-- (cumulative tiers) plus the closure-completing keys
-- (platform.tenant_lifecycle + platform.files in every tier — the
-- platform foundation keys the matrix's trade chains resolve through —
-- and sales.reps, sales.discount_management in Business) so every
-- seeded plan satisfies BR-040 against FEATURE_CATALOG — a plan whose
-- own keys violated closure would be rejected by this phase's own
-- validator.
--
-- Delivery note: the phase plan listed these as `apps/api/seeds/*.sql`
-- artifacts; the repository's seed convention (SEEDS/README "Applied by
-- migrations", established by 0004/0005) delivers reference data through
-- idempotent migrations — same content, canonical location (reconciled in
-- the completion report).
--
-- Idempotent by natural keys (plans.key, industry_templates.key,
-- chart_of_accounts_template.code).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Plans (DR-001 three self-serve tiers; PLACEHOLDER values).
--> statement-breakpoint
INSERT INTO "plans" ("id", "key", "name", "name_ar", "price_amount", "currency_code", "billing_period", "limits", "feature_keys") VALUES
  ('30000000-0000-4000-8000-000000000001', 'starter', 'Starter', 'البداية',
   0, 'SAR', 'MONTHLY',
   '{"users": 3, "branches": 1, "warehouses": 2, "documents_per_month": 500, "pos_terminals": 0, "offline_devices": 0, "industry_addons": 0, "support_level": "standard", "_placeholder": true}'::jsonb,
   ARRAY[
     'platform.registration', 'platform.onboarding', 'platform.branches',
     'platform.users_roles', 'platform.audit_trail', 'platform.data_export',
     'platform.tenant_lifecycle', 'platform.files',
     'accounting.chart_of_accounts', 'accounting.fiscal_calendar',
     'accounting.journal_entries', 'accounting.approvals', 'accounting.general_ledger',
     'accounting.opening_balances', 'accounting.period_close', 'accounting.year_end_close',
     'accounting.reconciliation',
     'partners.directory', 'partners.credit_terms', 'partners.statements',
     'items.item_master', 'items.categories', 'items.units_of_measure',
     'items.barcodes', 'items.price_lists',
     'inventory.stock_ledger', 'inventory.valuation', 'inventory.multi_warehouse',
     'sales.quotations', 'sales.orders', 'sales.deliveries', 'sales.invoices',
     'sales.credit_notes', 'sales.receipts', 'sales.allocations', 'sales.receivables_aging',
     'purchasing.requests', 'purchasing.orders', 'purchasing.goods_receipts',
     'purchasing.supplier_invoices', 'purchasing.debit_notes', 'purchasing.payments',
     'purchasing.three_way_matching',
     'treasury.accounts', 'treasury.receipts_disbursements', 'treasury.expenses',
     'treasury.expense_categories',
     'tax.engine', 'tax.codes', 'tax.registrations', 'tax.jurisdiction_packs', 'tax.vat_return',
     'reporting.engine', 'reporting.financial_statements', 'reporting.operational_reports',
     'reporting.print_templates', 'reporting.exports'
   ]),
  ('30000000-0000-4000-8000-000000000002', 'business', 'Business', 'الأعمال',
   0, 'SAR', 'MONTHLY',
   '{"users": 10, "branches": 3, "warehouses": 6, "documents_per_month": 5000, "pos_terminals": 3, "offline_devices": 5, "industry_addons": 1, "support_level": "standard", "_placeholder": true}'::jsonb,
   ARRAY[
     'platform.registration', 'platform.onboarding', 'platform.branches',
     'platform.users_roles', 'platform.audit_trail', 'platform.data_export',
     'platform.notifications', 'platform.tenant_lifecycle', 'platform.files',
     'accounting.chart_of_accounts', 'accounting.fiscal_calendar',
     'accounting.journal_entries', 'accounting.approvals', 'accounting.general_ledger',
     'accounting.opening_balances', 'accounting.period_close', 'accounting.year_end_close',
     'accounting.reconciliation', 'accounting.multi_currency', 'accounting.cost_centers',
     'partners.directory', 'partners.credit_terms', 'partners.statements',
     'partners.credit_management',
     'items.item_master', 'items.categories', 'items.units_of_measure',
     'items.barcodes', 'items.price_lists',
     'inventory.stock_ledger', 'inventory.valuation', 'inventory.multi_warehouse',
     'inventory.batch_tracking', 'inventory.serial_tracking', 'inventory.stock_counts',
     'inventory.stock_transfers',
     'sales.quotations', 'sales.orders', 'sales.deliveries', 'sales.invoices',
     'sales.credit_notes', 'sales.receipts', 'sales.allocations', 'sales.receivables_aging',
     'sales.credit_limits', 'sales.reps', 'sales.discount_management',
     'purchasing.requests', 'purchasing.orders', 'purchasing.goods_receipts',
     'purchasing.supplier_invoices', 'purchasing.debit_notes', 'purchasing.payments',
     'purchasing.three_way_matching', 'purchasing.landed_costs',
     'treasury.accounts', 'treasury.receipts_disbursements', 'treasury.expenses',
     'treasury.expense_categories', 'treasury.petty_cash', 'treasury.cash_transfers',
     'treasury.bank_reconciliation', 'treasury.cashier_shifts', 'treasury.cheques',
     'tax.engine', 'tax.codes', 'tax.registrations', 'tax.jurisdiction_packs', 'tax.vat_return',
     'reporting.engine', 'reporting.financial_statements', 'reporting.operational_reports',
     'reporting.print_templates', 'reporting.exports', 'reporting.dashboards',
     'pos.terminals', 'pos.sales', 'pos.shifts', 'pos.receipts',
     'pos.barcode_scanning', 'pos.offline_queue',
     'industry.template_engine', 'industry.terminology'
   ]),
  ('30000000-0000-4000-8000-000000000003', 'enterprise', 'Enterprise', 'المؤسسات',
   0, 'SAR', 'MONTHLY',
   '{"users": 50, "branches": "unlimited", "warehouses": "unlimited", "documents_per_month": 250000, "pos_terminals": "unlimited", "offline_devices": 100, "industry_addons": 3, "support_level": "priority", "_placeholder": true}'::jsonb,
   ARRAY[
     'platform.registration', 'platform.onboarding', 'platform.branches',
     'platform.users_roles', 'platform.audit_trail', 'platform.data_export',
     'platform.notifications', 'platform.tenant_lifecycle', 'platform.files',
     'accounting.chart_of_accounts', 'accounting.fiscal_calendar',
     'accounting.journal_entries', 'accounting.approvals', 'accounting.general_ledger',
     'accounting.opening_balances', 'accounting.period_close', 'accounting.year_end_close',
     'accounting.reconciliation', 'accounting.multi_currency', 'accounting.cost_centers',
     'accounting.projects',
     'partners.directory', 'partners.credit_terms', 'partners.statements',
     'partners.credit_management', 'partners.personal_accounts',
     'items.item_master', 'items.categories', 'items.units_of_measure',
     'items.barcodes', 'items.price_lists',
     'inventory.stock_ledger', 'inventory.valuation', 'inventory.multi_warehouse',
     'inventory.batch_tracking', 'inventory.serial_tracking', 'inventory.stock_counts',
     'inventory.stock_transfers', 'inventory.reservations', 'inventory.reorder_levels',
     'sales.quotations', 'sales.orders', 'sales.deliveries', 'sales.invoices',
     'sales.credit_notes', 'sales.receipts', 'sales.allocations', 'sales.receivables_aging',
     'sales.credit_limits', 'sales.reps', 'sales.discount_management', 'sales.commissions',
     'purchasing.requests', 'purchasing.orders', 'purchasing.goods_receipts',
     'purchasing.supplier_invoices', 'purchasing.debit_notes', 'purchasing.payments',
     'purchasing.three_way_matching', 'purchasing.landed_costs',
     'treasury.accounts', 'treasury.receipts_disbursements', 'treasury.expenses',
     'treasury.expense_categories', 'treasury.petty_cash', 'treasury.cash_transfers',
     'treasury.bank_reconciliation', 'treasury.cashier_shifts', 'treasury.cheques',
     'tax.engine', 'tax.codes', 'tax.registrations', 'tax.jurisdiction_packs', 'tax.vat_return',
     'tax.einvoicing_framework',
     'reporting.engine', 'reporting.financial_statements', 'reporting.operational_reports',
     'reporting.print_templates', 'reporting.exports', 'reporting.dashboards',
     'reporting.scheduled_reports',
     'pos.terminals', 'pos.sales', 'pos.shifts', 'pos.receipts',
     'pos.barcode_scanning', 'pos.offline_queue',
     'industry.template_engine', 'industry.terminology', 'industry.addons',
     'crm.leads', 'crm.tasks_activities', 'crm.service_contracts',
     'crm.recurring_billing', 'crm.service_orders',
     'manufacturing.bom', 'manufacturing.production_orders', 'manufacturing.wip',
     'manufacturing.costing', 'manufacturing.scrap', 'manufacturing.batch_genealogy',
     'manufacturing.qc',
     'distribution.routes', 'distribution.van_stock', 'distribution.settlements',
     'distribution.customer_tiers', 'distribution.free_goods',
     'offline.sync_protocol', 'offline.device_management', 'offline.desktop_app',
     'offline.android_app', 'offline.mobile_accounts'
   ])
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "price_amount" = EXCLUDED."price_amount", "currency_code" = EXCLUDED."currency_code",
      "billing_period" = EXCLUDED."billing_period", "limits" = EXCLUDED."limits",
      "feature_keys" = EXCLUDED."feature_keys", "is_active" = true,
      "updated_at" = now();

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Industry template index (13 templates; manifests land with the
-- PHASE-015 engine — BR-038). Rows are the selectable list only.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest") VALUES
  ('industry.retail', 'Retail Stores', 'متاجر التجزئة', '1.0.0',
   '{"phase": "015", "core_emphasis": {"en": "Counter selling, barcode, cash discipline", "ar": "البيع من الكاونتر، الباركود، الانضباط النقدي"}}'::jsonb),
  ('industry.grocery', 'Grocery & Supermarket', 'البقالات والسوبرماركت', '1.0.0',
   '{"phase": "015", "core_emphasis": {"en": "Volume retail, expiry, weighted goods", "ar": "تجزئة عالية الحجم، تواريخ الصلاحية، البضائع الموزونة"}}'::jsonb),
  ('industry.restaurant', 'Restaurant & Café', 'المطاعم والمقاهي', '1.0.0',
   '{"phase": "015", "core_emphasis": {"en": "Fast POS, daily cash, expiry waste", "ar": "نقاط بيع سريعة، نقدية يومية، هالك الصلاحية"}}'::jsonb),
  ('industry.automotive', 'Automotive & Workshop', 'قطع الغيار والورش', '1.0.0',
   '{"phase": "015", "core_emphasis": {"en": "Parts + service job cards, seriality", "ar": "قطع الغيار وبطاقات الصيانة، الأرقام التسلسلية"}}'::jsonb),
  ('industry.distribution', 'Distribution & Field Sales', 'التوزيع والمبيعات الميدانية', '1.0.0',
   '{"phase": "017", "core_emphasis": {"en": "Van stock, credit routes, settlements", "ar": "مخزون السيارات، مسارات الآجل، التسويات"}}'::jsonb),
  ('industry.food_manufacturing', 'Food Manufacturing', 'التصنيع الغذائي', '1.0.0',
   '{"phase": "018", "core_emphasis": {"en": "BOM, batches, genealogy, expiry, QC", "ar": "قوائم المواد، الدفعات، التتبع، الصلاحية، الجودة"}}'::jsonb),
  ('industry.professional_services', 'Professional Services', 'المكاتب المهنية', '1.0.0',
   '{"phase": "019", "core_emphasis": {"en": "Contracts, recurring billing, projects", "ar": "العقود، الفوترة الدورية، المشاريع"}}'::jsonb),
  ('industry.rental_logistics', 'Rental & Logistics', 'التأجير والخدمات اللوجستية', '1.0.0',
   '{"phase": "019", "core_emphasis": {"en": "Contracts, deposits, item availability", "ar": "العقود، الدفعات المقدمة، توفر الأصناف"}}'::jsonb),
  ('industry.wholesale', 'Wholesale & Trade', 'الجملة والتجارة', '1.0.0',
   '{"phase": "030", "core_emphasis": {"en": "Quantity-break tiers, credit limits, PDC receivables", "ar": "شرائح الكميات، حدود الائتمان، الأوراق المستلمة"}}'::jsonb),
  ('industry.electronics', 'Mobile & Electronics', 'الجوالات والإلكترونيات', '1.0.0',
   '{"phase": "030", "core_emphasis": {"en": "IMEI register, repair cards, trade-ins", "ar": "سجل IMEI، بطاقات الصيانة، الاستبدال"}}'::jsonb),
  ('industry.healthcare', 'Healthcare (Commercial Shell)', 'الرعاية الصحية — الغلاف التجاري', '1.0.0',
   '{"phase": "031", "core_emphasis": {"en": "Patient billing, insurance claims, pharmacy batches", "ar": "فوترة المرضى، مطالبات التأمين، دفعات الصيدلة"}}'::jsonb),
  ('industry.education', 'Education (Commercial Shell)', 'التعليم — الغلاف التجاري', '1.0.0',
   '{"phase": "032", "core_emphasis": {"en": "Tuition contracts, installments, sibling discounts", "ar": "عقود الرسوم، الأقساط، خصومات الأشقاء"}}'::jsonb),
  ('industry.agriculture', 'Agriculture (Commercial Shell)', 'الزراعة — الغلاف التجاري', '1.0.0',
   '{"phase": "033", "core_emphasis": {"en": "Crop-cycle costing, harvest batches, livestock serials", "ar": "تكاليف الدورات الزراعية، دفعات الحصاد، تسلسل المواشي"}}'::jsonb)
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "version" = EXCLUDED."version", "manifest" = EXCLUDED."manifest",
      "is_active" = true;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Default bilingual Chart of Accounts (CHART_OF_ACCOUNTS §3 — all 42 rows,
-- verbatim). is_group marks tree nodes (every parent row is a group per
-- V5: "is_postable = leaf ∧ not group" — the doc's "+ implied" resolved
-- structurally); purpose markers are exactly the §3 markers (16) — §2
-- purposes without a §3 marker row (CASH, PETTY_CASH, VAT_RECOVERABLE,
-- ROUNDING_*, OPENING_EQUITY) are NOT invented here: instantiation is
-- verbatim 1:1 and the fail-closed PURPOSE_NOT_MAPPED behavior begins in
-- PHASE-007 (gap recorded in the completion report).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1000', 'Assets', 'الأصول', 'ASSET', true, NULL, NULL),
  ('1100', 'Current assets', 'الأصول المتداولة', 'ASSET', true, '1000', NULL),
  ('1110', 'Cash on hand', 'النقدية بالصندوق', 'ASSET', true, '1100', NULL),
  ('1111', 'Cash — main', 'الصندوق الرئيسي', 'ASSET', false, '1110', NULL),
  ('1112', 'Petty cash', 'الصندوق النقدي الصغير', 'ASSET', false, '1110', NULL),
  ('1120', 'Banks', 'البنوك', 'ASSET', true, '1100', NULL),
  ('1121', 'Bank — current account', 'البنك — الحساب الجاري', 'ASSET', false, '1120', NULL),
  ('1130', 'Accounts receivable', 'العملاء (المدينون)', 'ASSET', false, '1100', 'AR_CONTROL'),
  ('1140', 'Inventory', 'المخزون', 'ASSET', false, '1100', 'INVENTORY'),
  ('1150', 'Other current assets', 'أصول متداولة أخرى', 'ASSET', true, '1100', NULL),
  ('1200', 'Fixed assets', 'الأصول الثابتة', 'ASSET', true, '1000', NULL),
  ('1210', 'Equipment', 'معدات وأجهزة', 'ASSET', false, '1200', NULL),
  ('1300', 'Other assets', 'أصول أخرى', 'ASSET', true, '1000', NULL),
  ('2000', 'Liabilities', 'الالتزامات', 'LIABILITY', true, NULL, NULL),
  ('2100', 'Current liabilities', 'الالتزامات المتداولة', 'LIABILITY', true, '2000', NULL),
  ('2110', 'Accounts payable', 'الموردون (الدائنون)', 'LIABILITY', false, '2100', 'AP_CONTROL'),
  ('2120', 'VAT payable', 'ض.ق.م المستحقة', 'LIABILITY', false, '2100', 'VAT_PAYABLE'),
  ('2130', 'Accrued expenses', 'مصاريف مستحقة', 'LIABILITY', false, '2100', NULL),
  ('2140', 'Customer deposits', 'دفعات مقدمة من العملاء', 'LIABILITY', false, '2100', 'DEPOSITS_RECEIVED'),
  ('2200', 'Long-term liabilities', 'التزامات طويلة الأجل', 'LIABILITY', true, '2000', NULL),
  ('3000', 'Equity', 'حقوق الملكية', 'EQUITY', true, NULL, NULL),
  ('3100', 'Capital', 'رأس المال', 'EQUITY', false, '3000', NULL),
  ('3110', 'Owner drawings / Current account', 'حساب الشريك / المسحوبات', 'EQUITY', false, '3000', NULL),
  ('3200', 'Retained earnings', 'الأرباح المحتجزة', 'EQUITY', false, '3000', 'RETAINED_EARNINGS'),
  ('3300', 'Current year result', 'نتيجة العام الحالي', 'EQUITY', false, '3000', 'CLOSING'),
  ('4000', 'Revenue', 'الإيرادات', 'REVENUE', true, NULL, NULL),
  ('4100', 'Sales revenue', 'إيرادات المبيعات', 'REVENUE', false, '4000', 'SALES_REVENUE'),
  ('4110', 'Sales returns', 'مردودات المبيعات', 'REVENUE', false, '4000', 'SALES_RETURNS'),
  ('4120', 'Sales discounts', 'خصومات المبيعات', 'REVENUE', false, '4000', 'SALES_DISCOUNTS'),
  ('4200', 'Service revenue', 'إيرادات الخدمات', 'REVENUE', false, '4000', NULL),
  ('4900', 'Other income / FX gain', 'إيرادات أخرى / أرباح فروق العملات', 'REVENUE', false, '4000', 'FX_GAIN'),
  ('5000', 'Expenses', 'المصروفات', 'EXPENSE', true, NULL, NULL),
  ('5100', 'COGS', 'تكلفة المبيعات', 'EXPENSE', false, '5000', 'COGS'),
  ('5110', 'Inventory shrinkage', 'هالك وفاقد المخزون', 'EXPENSE', false, '5000', 'INVENTORY_SHRINKAGE'),
  ('5200', 'Salaries & wages', 'الرواتب والأجور', 'EXPENSE', true, '5000', NULL),
  ('5210', 'Rent', 'الإيجار', 'EXPENSE', false, '5200', NULL),
  ('5220', 'Utilities', 'الكهرباء والمياه والاتصالات', 'EXPENSE', false, '5200', NULL),
  ('5230', 'Marketing', 'التسويق', 'EXPENSE', false, '5200', NULL),
  ('5240', 'Bank charges', 'مصاريف بنكية', 'EXPENSE', false, '5200', 'BANK_CHARGES'),
  ('5290', 'VAT expensed', 'ض.ق.م غير قابلة للخصم', 'EXPENSE', false, '5200', 'VAT_EXPENSED'),
  ('5300', 'Depreciation', 'الإهلاك', 'EXPENSE', false, '5000', NULL),
  ('5900', 'Other expenses / FX loss', 'مصروفات أخرى / خسائر فروق العملات', 'EXPENSE', false, '5000', 'FX_LOSS')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 8)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
