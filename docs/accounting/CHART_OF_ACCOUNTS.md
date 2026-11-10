# Chart of Accounts

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28

## 1. Structure

- Accounts form a **tree** (parent_id, cycle-checked). Only **leaf** accounts are
  postable (`is_postable = true` automatically for leaves that are not group nodes);
  group nodes exist for reporting hierarchy.
- Every account has: `code` (tenant-unique, sortable), `name`/`nameAr` (bilingual —
  Arabic display-first when locale = AR), `type` (ASSET, LIABILITY, EQUITY, REVENUE,
  EXPENSE), optional `subtype` (classification string, e.g., `CURRENT_ASSET`), `currency`
  (optional — restricts posting to that currency; base currency if null), `status`
  (ACTIVE, ARCHIVED), `is_system` (reserved by template), `parent_id`.
- Deletion is forbidden once an account has postings or children; archive hides it from
  pickers while preserving history (INV-015).

## 2. Account purposes (the mapping layer)

The posting engine never hard-codes account IDs. It references **purposes**, resolved to
the tenant's accounts via `account_purposes` (1 active account per purpose per tenant):

| Purpose key | Description (EN / AR) | Required |
|-------------|----------------------|----------|
| `AR_CONTROL` | Accounts receivable control / حساب العملاء (المدينون) | Yes |
| `AP_CONTROL` | Accounts payable control / حساب الموردين (الدائنون) | Yes |
| `INVENTORY` | Inventory asset / المخزون | Yes (with inventory module) |
| `WIP` | Work in progress / تحت التشغيل | Manufacturing |
| `COGS` | Cost of goods sold / تكلفة المبيعات | Yes (with inventory module) |
| `SALES_REVENUE` | Sales revenue / إيرادات المبيعات | Yes |
| `SALES_RETURNS` | Sales returns / مردودات المبيعات | Yes |
| `SALES_DISCOUNTS` | Sales discounts / مسموحات / خصومات المبيعات | Yes |
| `VAT_PAYABLE` | Output VAT / ضريبة القيمة المضافة المستحقة | VAT-registered tenants |
| `VAT_RECOVERABLE` | Input VAT / ضريبة القيمة المضافة على المشتريات | VAT-registered tenants |
| `VAT_EXPENSED` | Non-recoverable input VAT (expensed) / ض.ق.م غير القابلة للخصم | VAT-registered tenants |
| `CASH` | Cash & equivalents root purpose (each cash/bank account IS a GL account) | Yes |
| `PETTY_CASH` | Petty cash / الصندوق النقدي الصغير | Yes |
| `FX_GAIN` / `FX_LOSS` | FX differences / أرباح أو فروق العملات · خسائر فروق العملات | Yes |
| `ROUNDING_GAIN` / `ROUNDING_LOSS` | Rounding differences / فروق التقريب | Yes |
| `INVENTORY_SHRINKAGE` | Shrinkage/adjustment loss / الهالك والفاقد | Yes (with inventory module) |
| `INVENTORY_APPRECIATION` | Adjustment gain / مكاسب تسويات المخزون | Yes (with inventory module) |
| `RETAINED_EARNINGS` | Retained earnings / الأرباح المحتجزة | Yes |
| `OPENING_EQUITY` | Opening balances balancing account / حساب الأرصدة الافتتاحية | Yes (opening-balances posting, PHASE-007; target of the balancing line when declared opening balances are not pair-by-pair balanced) |
| `CLOSING` | Year-end closing account (P&L summary) | Yes |
| `GRNI` | Goods received not invoiced / بضاعة مستلمة غير مفوترة | Purchasing |
| `PRODUCTION_SCRAP` | Scrap/loss expense / التالف | Manufacturing |
| `PRODUCTION_LABOR` | Applied production labor / أجور الإنتاج المطبقة | Manufacturing (PHASE-018; required only when an order's labor rate > 0 — fails closed `PURPOSE_NOT_MAPPED` at completion) |
| `PRODUCTION_OVERHEAD` | Applied production overhead / مصاريف إنتاج غير مباشرة مطبقة | Manufacturing (PHASE-018; required only when an order's overhead rate > 0 — fails closed `PURPOSE_NOT_MAPPED` at completion) |
| `DEFERRED_REVENUE` | Deferred revenue / إيرادات مؤجلة | Service contracts |
| `DEPOSITS_RECEIVED` | Security deposits received / دفعات مقدمات مستلمة | Rental |
| `BANK_CHARGES` | Bank fees / مصاريف بنكية | Yes |
| `FIXED_ASSET` | Fixed assets / الأصول الثابتة | Fixed-assets module (PHASE-026) |
| `ACCUM_DEPRECIATION` | Accumulated depreciation / مجمع الإهلاك | Fixed-assets module (PHASE-026) |
| `DEPRECIATION_EXPENSE` | Depreciation expense / مصروف الإهلاك | Fixed-assets module (PHASE-026) |
| `ASSET_DISPOSAL_GAIN` / `ASSET_DISPOSAL_LOSS` | Asset disposal gain · loss / أرباح استبعاد الأصول · خسائر استبعاد الأصول | Fixed-assets module (PHASE-026) |
| `REVALUATION_RESERVE` | Revaluation reserve / احتياطي إعادة التقييم | Fixed-assets module (PHASE-026; optional revaluation, BR-044) |
| `NOTES_RECEIVABLE` | Notes receivable (incoming cheques & promissory notes) / الشيكات والأوراق التجارية الواردة | Notes module (PHASE-027) |
| `NOTES_PAYABLE` | Notes payable (issued cheques & promissory notes) / الأوراق التجارية الصادرة | Notes module (PHASE-027) |
| `NOTES_DISCOUNT_EXPENSE` | Note discounting expense / مصروف خصم الأوراق | Notes module (PHASE-027) |
| `LATE_FEE_INCOME` | Late-fee income / إيرادات الغرامات | Installments module (PHASE-027) |
| `SALARIES_EXPENSE` | Salaries expense / مصروف الرواتب | Payroll module (PHASE-029) |
| `SALARIES_PAYABLE` | Salaries payable / رواتب مستحقة | Payroll module (PHASE-029) |
| `DEDUCTIONS_PAYABLE` | Third-party deductions payable / استقطاعات مستحقة لأطراف ثالثة | Payroll module (PHASE-029) |
| `EMPLOYER_CONTRIBUTIONS` | Employer contributions / مساهمات صاحب العمل | Payroll module (PHASE-029) |
| `EOS_PROVISION` | End-of-service provision / مخصص نهاية الخدمة | Payroll module (PHASE-029) |
| `EOS_PROVISION_EXPENSE` | End-of-service provision expense / مصروف مخصص نهاية الخدمة | Payroll module (PHASE-029) |
| `CONSOLIDATION_ADJUSTMENT` | Consolidation adjustments / تسويات التوحيد | Consolidation module (PHASE-034) |

**Rules:** required purposes must be mapped before any module that uses them can post
(the engine fails closed with `PURPOSE_NOT_MAPPED`, never posts to a fallback). Purposes
may map to different accounts per branch only where the platform explicitly supports
branch-level inventory/cash splits (documented per module; default: tenant-level).

**Blueprint v2.0 rows** (per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §E,
ED-16) are module-conditional: each must be mapped before its owning module can post,
under the same fail-closed `PURPOSE_NOT_MAPPED` rule as the required purposes above.
Fixed-asset categories reference their asset / accumulated-depreciation / expense purpose
keys before use (BR-041); `CONSOLIDATION_ADJUSTMENT` is used only in the parent's
consolidation books (PHASE-034,
[../architecture/ADR/ADR-0018-multi-entity-consolidation.md](../architecture/ADR/ADR-0018-multi-entity-consolidation.md)).
The v2.0 goldens that consume these purposes are specified in
[JOURNAL_RULES.md](JOURNAL_RULES.md) §7 (G-21…G-32).

## 3. Default bilingual template

Instantiated at onboarding (editable; codes are suggestions). Arabic names shown; the
template ships `name` + `nameAr`.

| Code | Name (EN) | الاسم العربي | Type |
|------|-----------|--------------|------|
| 1000 | Assets | الأصول | ASSET (group) |
| 1100 | Current assets | الأصول المتداولة | ASSET (group) |
| 1110 | Cash on hand | النقدية بالصندوق | ASSET |
| 1111 | Cash — main | الصندوق الرئيسي | ASSET (cash account) |
| 1112 | Petty cash | الصندوق النقدي الصغير | ASSET (cash account) |
| 1120 | Banks | البنوك | ASSET (group) |
| 1121 | Bank — current account | البنك — الحساب الجاري | ASSET (bank account) |
| 1130 | Accounts receivable | العملاء (المدينون) | ASSET ← AR_CONTROL |
| 1140 | Inventory | المخزون | ASSET ← INVENTORY |
| 1150 | Other current assets | أصول متداولة أخرى | ASSET (group) |
| 1200 | Fixed assets | الأصول الثابتة | ASSET (group) |
| 1210 | Equipment | معدات وأجهزة | ASSET |
| 1300 | Other assets | أصول أخرى | ASSET (group) |
| 2000 | Liabilities | الالتزامات | LIABILITY (group) |
| 2100 | Current liabilities | الالتزامات المتداولة | LIABILITY (group) |
| 2110 | Accounts payable | الموردون (الدائنون) | LIABILITY ← AP_CONTROL |
| 2120 | VAT payable | ض.ق.م المستحقة | LIABILITY ← VAT_PAYABLE |
| 2130 | Deferred revenue | الإيرادات المؤجلة | LIABILITY ← DEFERRED_REVENUE (renamed from Accrued expenses by 0027; the pre-019 slot held a plain row — existing tenants map once, fail-closed `PURPOSE_NOT_MAPPED` until then) |
| 2140 | Customer deposits | دفعات مقدمة من العملاء | LIABILITY ← DEPOSITS_RECEIVED |
| 2200 | Long-term liabilities | التزامات طويلة الأجل | LIABILITY (group) |
| 3000 | Equity | حقوق الملكية | EQUITY (group) |
| 3100 | Capital | رأس المال | EQUITY |
| 3110 | Owner drawings / Current account | حساب الشريك / المسحوبات | EQUITY |
| 3200 | Retained earnings | الأرباح المحتجزة | EQUITY ← RETAINED_EARNINGS |
| 3300 | Current year result | نتيجة العام الحالي | EQUITY ← CLOSING |
| 4000 | Revenue | الإيرادات | REVENUE (group) |
| 4100 | Sales revenue | إيرادات المبيعات | REVENUE ← SALES_REVENUE |
| 4110 | Sales returns | مردودات المبيعات | REVENUE (contra) ← SALES_RETURNS |
| 4120 | Sales discounts | خصومات المبيعات | REVENUE (contra) ← SALES_DISCOUNTS |
| 4200 | Service revenue | إيرادات الخدمات | REVENUE |
| 4900 | Other income / FX gain | إيرادات أخرى / أرباح فروق العملات | REVENUE ← FX_GAIN |
| 5000 | Expenses | المصروفات | EXPENSE (group) |
| 5100 | COGS | تكلفة المبيعات | EXPENSE ← COGS |
| 5110 | Inventory shrinkage | هالك وفاقد المخزون | EXPENSE ← INVENTORY_SHRINKAGE |
| 5200 | Salaries & wages | الرواتب والأجور | EXPENSE |
| 5210 | Rent | الإيجار | EXPENSE |
| 5220 | Utilities | الكهرباء والمياه والاتصالات | EXPENSE |
| 5230 | Marketing | التسويق | EXPENSE |
| 5240 | Bank charges | مصاريف بنكية | EXPENSE ← BANK_CHARGES |
| 5290 | VAT expensed | ض.ق.م غير قابلة للخصم | EXPENSE ← VAT_EXPENSED |
| 5300 | Depreciation | الإهلاك | EXPENSE |
| 5900 | Other expenses / FX loss | مصروفات أخرى / خسائر فروق العملات | EXPENSE ← FX_LOSS |

Groups remain open for tenant extension; codes can be renumbered before first posting
only (after any posting, codes are frozen for posted accounts to keep statements stable).

## 4. Validation rules

- V1: purpose mappings are 1:1 per tenant per purpose (unique constraint, active).
- V2: account type cannot change once postings exist.
- V3: parent/child type must match (tree stays homogeneous).
- V4: an account with postings or children cannot be archived as a posting target for
  required purposes.
- V5: `is_postable` = leaf ∧ not group. Group nodes reject journal lines (INV-004).
- V6: currency-restricted accounts reject foreign-currency lines (INV-005).

## 5. Integration notes

- Onboarding (PHASE-004) instantiates the template; industry templates may add accounts
  (e.g., workshop labor revenue) — additions only, never removals of mapped accounts.
- Statements and trial balance group by tree; export preserves hierarchy.
- See [../database/TABLES/](../database/TABLES/core-accounting.md) for column specs.
