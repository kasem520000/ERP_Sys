-- PHASE-003 · migration 0005 · system role templates + template grants
--
-- The nine system role templates (TABLES §roles, tenant_id IS NULL,
-- is_system = true) with their template grant sets, seeded per
-- AUTHORIZATION_MATRIX.md §2 "Minimal roles" expansions. Tenants clone these
-- into tenant-owned role rows when provisioning (PHASE-004); memberships
-- always reference tenant-instantiated roles via the composite FK.
--
-- Template ids are fixed constants so the seed stays idempotent across
-- environments (roles.key is only unique per tenant scope — a plain
-- ON CONFLICT DO NOTHING would not converge without stable ids).
--
-- Grant mapping rules (matrix §3 "Minimal roles" column; the docs-drift
-- script checks KEY parity, this mapping is the documented expansion):
-- - owner: every tenant-plane key (all except platform.*) — matrix §2
--   "All tenant permissions". identity.mfa.manage is self-scope ("every
--   user (self)") and is granted at runtime by the permission evaluator,
--   never through a template.
-- - platform_admin: platform.* only ("never holds tenant roles").
-- - payroll_officer: the PHASE-029 payroll preparation set (three-way SoD:
--   runs.approve/post are NOT granted) + the all-tenant-role basics.
-- - cashier: the POS-scoped subset (§2 "no approvals, no data exports").
-- - viewer: view-class keys only.
-- - "all tenant roles" (partners.view, items.view, files.upload/view):
--   granted to every tenant template.
--
-- Runs as erp_migrate: the `template_seed` RLS policy (migration 0003)
-- allows exactly tenant_id IS NULL rows on roles/role_permissions — the app
-- role can never forge or mutate a template.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
INSERT INTO "roles" ("id", "tenant_id", "key", "name", "name_ar", "is_system") VALUES
  ('10000000-0000-4000-8000-000000000001', NULL, 'owner', 'Owner', 'المالك', true),
  ('10000000-0000-4000-8000-000000000002', NULL, 'accountant', 'Accountant', 'المحاسب', true),
  ('10000000-0000-4000-8000-000000000003', NULL, 'sales', 'Sales', 'المبيعات', true),
  ('10000000-0000-4000-8000-000000000004', NULL, 'purchasing', 'Purchasing', 'المشتريات', true),
  ('10000000-0000-4000-8000-000000000005', NULL, 'warehouse', 'Warehouse', 'المستودع', true),
  ('10000000-0000-4000-8000-000000000006', NULL, 'cashier', 'Cashier', 'أمين الصندوق', true),
  ('10000000-0000-4000-8000-000000000007', NULL, 'viewer', 'Viewer', 'المشاهد', true),
  ('10000000-0000-4000-8000-000000000008', NULL, 'payroll_officer', 'Payroll Officer', 'مسؤول الرواتب', true),
  ('10000000-0000-4000-8000-000000000009', NULL, 'platform_admin', 'Platform Admin', 'مدير المنصة', true)
ON CONFLICT ("id") DO UPDATE
  SET "key" = EXCLUDED."key", "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar", "is_system" = EXCLUDED."is_system";

--> statement-breakpoint
-- owner — every tenant-plane permission (matrix §2); templates are the
-- cloning source, tenant-instantiated copies remain tenant-editable.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
  AND p."key" NOT LIKE 'platform.%'
  AND p."key" <> 'identity.mfa.manage'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- accountant — books and close (§2): all accounting save owner-only risky
-- keys, partner/tax/report/notes surfaces, receipts approval, payroll posting.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'accounting.journal_entries.view', 'accounting.journal_entries.create',
  'accounting.journal_entries.approve', 'accounting.journal_entries.post',
  'accounting.journal_entries.reverse',
  'accounting.accounts.view', 'accounting.accounts.manage',
  'accounting.periods.lock', 'accounting.periods.soft_close',
  'accounting.fiscal_years.manage', 'accounting.exchange_rates.manage',
  'accounting.cost_centers.manage', 'accounting.opening_balances.create',
  'sales.invoices.view',
  'sales.credit_notes.view', 'sales.credit_notes.create', 'sales.credit_notes.approve', 'sales.credit_notes.post',
  'sales.receipts.view', 'sales.receipts.create', 'sales.receipts.approve',
  'purchasing.supplier_invoices.view', 'purchasing.supplier_invoices.create',
  'purchasing.supplier_invoices.approve', 'purchasing.supplier_invoices.post',
  'purchasing.debit_notes.view', 'purchasing.debit_notes.create',
  'purchasing.debit_notes.approve', 'purchasing.debit_notes.post',
  'purchasing.payments.view', 'purchasing.payments.approve',
  'treasury.accounts.view', 'treasury.accounts.manage',
  'treasury.expenses.view', 'treasury.expenses.create', 'treasury.expenses.approve',
  'treasury.petty_cash.manage', 'treasury.transfers.create',
  'treasury.bank_reconciliation.manage', 'treasury.fx_revaluation.run',
  'inventory.moves.view',
  'partners.view', 'partners.create', 'partners.update', 'partners.archive',
  'partners.credit_terms.manage', 'partners.statements.view',
  'items.view', 'items.import.run',
  'tax.codes.manage', 'tax.returns.view', 'tax.returns.prepare',
  'reporting.reports.run', 'reporting.reports.export',
  'reports.financial.tb.read', 'reports.financial.gl.read', 'reports.financial.is.read',
  'reports.financial.bs.read', 'reports.financial.cf.read', 'reports.financial.close.read',
  'reports.accounting.cost-centers.read',
  'reports.ar.aging.read', 'reports.ap.aging.read', 'reports.ar-alloc.read',
  'reports.sales.by-item.read', 'reports.sales.by-customer.read', 'reports.sales.by-rep.read',
  'reports.sales.by-paymethod.read', 'reports.sales.pipeline.read', 'reports.sales.by-branch.read',
  'reports.sales.profitability.read',
  'reports.purchasing.by-supplier.read', 'reports.purchasing.by-item.read',
  'reports.purchasing.grni.read', 'reports.purchasing.matching.read',
  'reports.treasury.fx.read', 'reports.tax.vat-return.read', 'reports.tax.summary.read',
  'files.upload', 'files.view', 'audit.view',
  'notes.notes.view', 'notes.notes.create', 'notes.notes.endorse',
  'notes.notes.deposit', 'notes.notes.record_dishonor', 'notes.notes.discount', 'notes.notes.return',
  'installments.plans.view',
  'budgeting.budgets.view', 'budgeting.budgets.create', 'budgeting.reports.view',
  'payroll.runs.post', 'payroll.reports.view',
  'fixed_assets.categories.manage', 'fixed_assets.assets.view',
  'fixed_assets.assets.create', 'fixed_assets.assets.manage',
  'fixed_assets.depreciation_runs.view', 'fixed_assets.depreciation_runs.run',
  'fixed_assets.depreciation_runs.post', 'fixed_assets.revaluations.create',
  'fixed_assets.disposals.create', 'fixed_assets.disposals.post',
  'fixed_assets.reports.view',
  'consolidation.eliminations.create', 'consolidation.runs.execute',
  'consolidation.reports.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- sales — sell and invoice (§2): sales documents up to approve/post per
-- limits, receipts create, partner master, price lists, CRM, van sales.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'sales.quotations.view', 'sales.quotations.create', 'sales.quotations.approve', 'sales.quotations.convert',
  'sales.orders.view', 'sales.orders.create', 'sales.orders.approve',
  'sales.deliveries.view', 'sales.deliveries.create',
  'sales.invoices.view', 'sales.invoices.create', 'sales.invoices.approve', 'sales.invoices.post',
  'sales.credit_notes.view', 'sales.credit_notes.create', 'sales.credit_notes.approve', 'sales.credit_notes.post',
  'sales.receipts.view', 'sales.receipts.create',
  'inventory.stock.view',
  'partners.view', 'partners.create', 'partners.update', 'partners.archive', 'partners.statements.view',
  'items.view', 'items.price_lists.manage',
  'crm.leads.manage', 'crm.tasks.manage', 'crm.activities.manage',
  'distribution.routes.manage', 'distribution.van_stock.view',
  'notes.notes.view', 'notes.notes.create',
  'installments.plans.view', 'installments.plans.manage',
  'files.upload', 'files.view'
)
WHERE r."key" = 'sales' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- purchasing — buy and pay (§2): requisitions/orders/GRNs, supplier
-- invoices, payments create, partner master.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'purchasing.purchase_requests.view', 'purchasing.purchase_requests.create', 'purchasing.purchase_requests.approve',
  'purchasing.purchase_orders.view', 'purchasing.purchase_orders.create', 'purchasing.purchase_orders.approve',
  'purchasing.goods_receipts.view', 'purchasing.goods_receipts.create', 'purchasing.goods_receipts.approve',
  'purchasing.supplier_invoices.view', 'purchasing.supplier_invoices.create',
  'purchasing.debit_notes.view', 'purchasing.debit_notes.create',
  'purchasing.payments.view', 'purchasing.payments.create',
  'inventory.stock.view',
  'partners.view', 'partners.create', 'partners.update', 'partners.archive', 'partners.statements.view',
  'items.view',
  'notes.notes.view', 'notes.notes.create',
  'files.upload', 'files.view'
)
WHERE r."key" = 'purchasing' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- warehouse — stock operations (§2): moves/transfers/counts, item master
-- maintenance, production order creation (approve/post stay owner-only).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'sales.deliveries.view', 'sales.deliveries.create',
  'purchasing.goods_receipts.view', 'purchasing.goods_receipts.create', 'purchasing.goods_receipts.approve',
  'inventory.stock.view', 'inventory.moves.view',
  'inventory.receipts.create', 'inventory.issues.create',
  'inventory.transfers.view', 'inventory.transfers.create', 'inventory.transfers.approve',
  'inventory.counts.view', 'inventory.counts.create', 'inventory.counts.approve', 'inventory.counts.post',
  'inventory.adjustments.create', 'inventory.tracking.manage',
  'items.view', 'items.create', 'items.update', 'items.archive',
  'manufacturing.production_orders.view', 'manufacturing.production_orders.create',
  'partners.view', 'files.upload', 'files.view'
)
WHERE r."key" = 'warehouse' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- cashier — POS terminal subset (§2): shift open/close, terminal posting,
-- own shift management; no approvals, no exports.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'sales.pos_session.open', 'sales.pos_session.close', 'sales.pos_session.post',
  'treasury.shifts.manage',
  'partners.view', 'items.view', 'files.upload', 'files.view'
)
WHERE r."key" = 'cashier' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- viewer — read-only (§2): view-class keys across the enabled modules.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'accounting.journal_entries.view', 'accounting.accounts.view',
  'sales.invoices.view', 'sales.credit_notes.view',
  'treasury.accounts.view',
  'inventory.stock.view', 'inventory.moves.view',
  'inventory.transfers.view', 'inventory.counts.view',
  'partners.view', 'items.view',
  'reporting.reports.run',
  'reports.financial.tb.read', 'reports.financial.gl.read', 'reports.financial.is.read',
  'reports.financial.bs.read', 'reports.financial.cf.read',
  'reports.accounting.cost-centers.read',
  'reports.ar.aging.read', 'reports.ap.aging.read', 'reports.ar-alloc.read',
  'reports.sales.by-item.read', 'reports.sales.by-customer.read', 'reports.sales.by-rep.read',
  'reports.sales.by-paymethod.read', 'reports.sales.pipeline.read', 'reports.sales.by-branch.read',
  'reports.sales.profitability.read',
  'reports.purchasing.by-supplier.read', 'reports.purchasing.by-item.read',
  'reports.purchasing.grni.read', 'reports.purchasing.matching.read',
  'reports.treasury.fx.read', 'reports.tax.vat-return.read', 'reports.tax.summary.read',
  'files.upload', 'files.view',
  'notes.notes.view', 'installments.plans.view',
  'fixed_assets.assets.view', 'fixed_assets.depreciation_runs.view', 'fixed_assets.reports.view',
  'budgeting.budgets.view', 'budgeting.reports.view',
  'consolidation.reports.view'
)
WHERE r."key" = 'viewer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- payroll_officer — prepare payroll (§2, PHASE-029): employee master,
-- salary structures, run creation; approve/post excluded (three-way SoD §4).
-- Payroll employee reads are role-restricted: never granted to viewer.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'payroll.employees.view', 'payroll.employees.manage',
  'payroll.salary_structures.manage',
  'payroll.runs.view', 'payroll.runs.create',
  'payroll.loans.manage', 'payroll.reports.view',
  'partners.view', 'items.view', 'files.upload', 'files.view'
)
WHERE r."key" = 'payroll_officer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- platform_admin — platform staff only (§3.10): never holds tenant roles;
-- every platform action is audited with via_platform_admin (PHASE-004).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" LIKE 'platform.%'
WHERE r."key" = 'platform_admin' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 5)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
