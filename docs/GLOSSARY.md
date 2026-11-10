# Glossary

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28

Controlled vocabulary for the entire blueprint. All documents MUST use these terms with
these meanings. Arabic equivalents are the canonical user-facing Arabic strings used in the
product UI (see [../ui/DESIGN_TOKENS.md](ui/DESIGN_TOKENS.md) for typography and
[../localization/RTL_AND_LTR.md](localization/RTL_AND_LTR.md) for rendering rules).

## Platform & tenancy

| English term | Arabic | Definition |
|--------------|--------|------------|
| Platform | المنصة | The overall SaaS product described by this blueprint |
| Tenant | المستأجر | One customer organization; the unit of data isolation and subscription |
| Branch | الفرع | A tenant's physical/location operating unit |
| Warehouse | المستودع | A stock location; belongs to a branch or the tenant |
| Entitlement | الاستحقاق | A server-resolved grant of a feature key to a tenant |
| Industry template | قالب الصناعة | A manifest that configures modules, menus, terminology, workflows for a business activity |
| Jurisdiction pack | حزمة الدولة | Versioned configuration for a country's tax/legal/formatting requirements |
| Onboarding | التهيئة الأولى | Post-registration wizard that produces the initial workspace |
| Support access | وصول الدعم | Time-boxed, audited impersonation of a tenant user by platform staff |

## Accounting

| English term | Arabic | Definition |
|--------------|--------|------------|
| Chart of accounts | دليل الحسابات | The tenant's account tree; posting happens on leaf accounts only |
| Account type | نوع الحساب | ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE |
| Account purpose | غرض الحساب | System role of an account (e.g., AR_CONTROL) mapped onto the tenant's CoA |
| Journal entry | قيد اليومية | A balanced set of journal lines; the only object that posts to the GL |
| Journal line | بند القيد | One debit or credit line of a journal entry |
| Debit / Credit | مدين / دائن | Sides of a double-entry line |
| Posting | الترحيل | The irreversible act of making a journal entry affect account balances |
| Posting engine | محرك الترحيل | The single domain service that validates and posts journal entries ([ADR-0007](architecture/ADR/ADR-0007-centralized-posting-engine.md)) |
| General ledger (GL) | دفتر الأستاذ العام | Posted journal lines per account |
| Trial balance | ميزان المراجعة | Debit/credit totals per account for a period range |
| Fiscal year | السنة المالية | The tenant's accounting year |
| Fiscal period | الفترة المالية | Month (or custom) subdivision of a fiscal year; can be soft-closed or hard-locked |
| Opening balance | الرصيد الافتتاحي | Balance brought forward at tenant setup |
| Reversal | القيد العكسي | A counter-entry linked to an original posted entry; the only way to negate a posting |
| Control account | حساب المراقبة/الإجمالي | GL account aggregating a subledger (e.g., AR control) |
| Subledger | دفتر الأستاذ المساعد | Detail ledger (per partner, per item) reconciling to a control account |
| Accounts receivable (AR) | المدينون / ذمم العملاء | Money owed by customers |
| Accounts payable (AP) | الدائنون / ذمم الموردين | Money owed to suppliers |
| Cost center | مركز التكلفة | Analytical dimension for expenses/revenue |
| Base currency | العملة الأساسية | The single currency in which a tenant keeps its books |
| Document currency | عملة المستند | Currency of a transaction document; differs from base when FX applies |
| Exchange rate | سعر الصرف | Quoted as base-currency units per 1 unit of document currency |
| FX difference | فروق العملات | Realized/unrealized gain/loss from rate changes |
| Rounding difference | فروق التقريب | Residual from line/document rounding; posted to rounding accounts |
| Retained earnings | الأرباح المحتجزة | Equity account closed to at year-end |
| Period lock | إقفال الفترة | Hard lock preventing any posting into a period |

## Documents & trading

| English term | Arabic | Definition |
|--------------|--------|------------|
| Quotation | عرض السعر | Non-binding sales proposal |
| Sales order | أمر البيع | Confirmed customer order |
| Delivery note | إشعار التسليم | Goods-out document |
| Sales invoice | فاتورة البيع | The billing document; may be tax invoice, simplified invoice, or non-tax invoice |
| Credit note | إشعار دائن | Reduces a previously issued invoice (returns, corrections) |
| Debit note | إشعار مدين | Increases a supplier invoice amount owed (purchase corrections) |
| Purchase request | طلب الشراء | Internal requisition |
| Purchase order | أمر الشراء | Order sent to a supplier |
| Goods receipt (GRN) | سند استلام البضاعة | Goods-in document |
| Supplier invoice | فاتورة المورد | The AP billing document |
| Receipt | سند القبض | Money received (from customer) |
| Payment | سند الصرف | Money paid (to supplier or payee) |
| Allocation | التخصيص | Linking a receipt/payment amount to specific invoices/documents |
| Three-way matching | المطابقة الثلاثية | Order ↔ receipt ↔ invoice consistency check |
| Landed cost | تكاليف الوصول | Freight/customs/insurance allocated into item cost |
| Stock movement | حركة المخزون | Immutable record of a quantity change with reason and valuation |
| Stock count | جرد المخزون | Physical count + variance → adjustment |
| Stock transfer | تحويل مخزون | Warehouse-to-warehouse move, with in-transit state |
| Batch / lot | الدفعة | Manufactured/received quantity group tracked together |
| Expiry date | تاريخ الانتهاء | Batch sellable-until date |
| Serial number | الرقم التسلسلي | Per-unit identifier |
| IMEI | رمز الجهاز | Device identifier (mobile-phone industry tracking) |
| Weighted average cost (WAC) | متوسط التكلفة المرجح | Valuation method: moving average per item |
| FIFO | الوارد أولاً صادر أولاً | Valuation method: cost layers consumed oldest-first |
| Cost of goods sold (COGS) | تكلفة المبيعات | Expense recognized when stock is issued |
| Shrinkage | الهالك / الفاقد | Inventory loss account/purpose |
| WIP | تحت التشغيل | Work-in-progress inventory |
| Bill of materials (BOM) | قائمة المواد | Recipe of materials for a produced item |
| Production order | أمر الإنتاج | Manufacturing execution document |
| Cashier shift | وردية الصندوق | One cashier's session: opening float, sales, closing count, variance |
| Petty cash | الصندوق النقدي الصغير | Small-cash fund with its own account |
| Bank reconciliation | التسوية البنكية | Matching bank statement lines to system cash/bank movements |

## Financial depth & consolidation (v2.0)

Terms introduced by the Blueprint v2.0 expansion
([EXPANSION_REGISTER.md](EXPANSION_REGISTER.md)); modules ship in stages 9–11
(PHASE-026…034).

| English term | Arabic | Definition |
|--------------|--------|------------|
| Fixed asset | الأصل الثابت | Long-lived asset registered in the `fixed_assets` module; capitalized and depreciated monthly via runs (PHASE-026) |
| Depreciation | الإهلاك | Systematic expensing of an asset's cost over its useful life; posts only via period-locked depreciation runs (BR-042) |
| Net book value (NBV) | القيمة الدفترية الصافية | Cost − accumulated depreciation (± revaluation); never below salvage value (INV-023) |
| Salvage value | القيمة التخريدية | The asset's recoverable floor; depreciation may never pass it (BR-043) |
| Post-dated cheque (PDC) | الشيك المؤجل | Cheque dated for a future maturity; held in custody until deposit/collection (`notes` module) |
| Promissory note | السند الإذني | Written unconditional payment undertaking; tracked with kind PROMISSORY_NOTE and maturity date |
| Endorsement | التظهير | Transfer of a note's custody to a third party; moves custody without a journal (BR-047) |
| Dishonor (cheque) | ارتجاع الشيك | A deposited note refused by the bank; restores the AR open item exactly (INV-024) |
| Cheque discounting | خصم الأوراق التجارية | Selling a note to a bank before maturity at a discount; expense posts to `NOTES_DISCOUNT_EXPENSE` |
| Maturity calendar | تقويم الاستحقاق | Auto-derived calendar of upcoming note maturities (BR-045) |
| Installment plan | خطة الأقساط | Flat-fee schedule over a source document's total; **no interest computation** (riba exclusion, BR-048) |
| Late fee | غرامة التأخير | Per-plan flat charge on overdue installments (rate + cap + grace; BR-049) |
| Budget (statement) | الموازنة التقديرية | Versioned planned amounts per fiscal year/scope; **not** a ledger document (DR-004) |
| Budget variance | انحراف الموازنة | Difference between budgeted and actual amounts per period/account/scope |
| Payroll run | مسير الرواتب | The monthly payroll posting document; the only payroll journal writer (BR-053, INV-025) |
| Salary structure | هيكل الرواتب | Versioned set of salary components (allowances, deductions, employer contributions; BR-052) |
| End-of-service (EOS) provision | مخصص نهاية الخدمة | Liability accrued for end-of-service entitlements per tenant policy (BR-055) |
| Employee loan | سلفة الموظف | Advance repaid via capped per-period deductions inside payroll runs (BR-054) |
| Elimination entry | قيد الاستبعاد | Balanced journal in the parent's consolidation books removing intercompany effects (G-32) |
| Consolidation (group) | التوحيد المجموعي | Read-only aggregation of member tenants' books into group statements (ADR-0018, INV-026) |
| Legal entity | الكيان القانوني | A company with its own statutory books; exactly one per tenant (ADR-0005/ADR-0018) |
| Insurance claim | المطالبة التأمينية | Healthcare receivable billed per claim to an insurer (`industry.healthcare` shell) |
| Tuition installments | أقساط الرسوم الدراسية | Education-shell use of installment plans for fees (`industry.education` shell) |
| Crop cycle | الدورة الزراعية | Agriculture production cycle modeled via BOM/production costing (`industry.agriculture` shell) |
| Harvest batch | دفعة الحصاد | Batch-tracked harvested output (`industry.agriculture` shell) |

## Parties

| English term | Arabic | Definition |
|--------------|--------|------------|
| Partner | جهة التعامل | Unified party: customer, supplier, or both |
| Customer | العميل | Partner to whom we sell |
| Supplier | المورد | Partner from whom we buy |
| Sales representative | مندوب المبيعات | User with sales attribution and (later) van-stock accountability |
| Price list | قائمة الأسعار | Customer/supplier-specific or default pricing |

## Tax & compliance

| English term | Arabic | Definition |
|--------------|--------|------------|
| Tax treatment | المعاملة الضريبية | Standard-rated, zero-rated, exempt, out-of-scope, reverse-charge, not-subject |
| Tax code | رمز الضريبة | Tenant-usable code binding items/documents to a treatment + rate snapshot |
| Tax rate | نسبة الضريبة | Percentage with jurisdiction + effective dates (versioned) |
| VAT | ضريبة القيمة المضافة | Value-added tax |
| VAT registration status | حالة التسجيل الضريبي | Tenant's registration in a jurisdiction (registered / not registered / deregistered) |
| Tax invoice | الفاتورة الضريبية | Full VAT invoice with buyer details |
| Simplified invoice | الفاتورة المبسطة | B2C VAT invoice (e.g., KSA simplified) |
| E-invoicing | الفوترة الإلكترونية | Regulatory electronic invoice generation/clearance regimes |
| ZATCA | هيئة الزكاة والضريبة والجمارك | Saudi tax authority (e-invoicing: "FATOORAH") |
| ETA | مصلحة الضرائب المصرية | Egyptian Tax Authority (e-invoice/e-receipt systems) |
| VAT return | الإقرار الضريبي | Periodic tax report reconciling output vs input tax to GL |

## UI, API & technical

| English term | Arabic | Definition |
|--------------|--------|------------|
| Design system | نظام التصميم | Shared component/token library ([../ui/DESIGN_SYSTEM.md](ui/DESIGN_SYSTEM.md)) |
| Design token | رمز التصميم | Named design value (color, spacing, type) |
| RTL / LTR | من اليمين لليسار / من اليسار لليمين | Text direction; the product is RTL-first |
| Page archetype | نمط الصفحة | Recurring page pattern (list, form, document, report…) |
| Feature key | مفتاح الميزة | `module.feature` identifier used by entitlements |
| Role | الدور | Named permission set (tenant-level, branch-scoped) |
| Permission | الصلاحية | Atomic action grant, e.g., `sales.invoices.post` |
| Audit event | حدث التدقيق | Immutable record of a state change with actor/time/before-after |
| Idempotency key | مفتاح منع التكرار | Client-supplied key guaranteeing one-time effect of a retry |
| Outbox | صندوق الإرسال | Local queue of pending offline operations |
| Inbox | صندوق الوارد | Local record of processed server results (dedupe) |
| Sync cursor | مؤشر المزامنة | Per-entity incremental pull position |
| Tombstone | علامة الحذف | Soft-delete marker replicated to offline clients |
| Device | الجهاز | Registered offline-capable client with its own credentials |
| RLS | — | PostgreSQL Row-Level Security (tenant isolation defense-in-depth) |
| Modular monolith | البنية أحادية المعيارية | Single deployable with enforced module boundaries ([ADR-0001](architecture/ADR/ADR-0001-modular-monolith.md)) |
| Bounded context | السياق المحدود | A module's owned domain concepts and tables |
| ADR | — | Architecture Decision Record |
| Completion report | تقرير الإنجاز | Evidence-based phase completion artifact ([../implementation/templates/COMPLETION_REPORT_TEMPLATE.md](implementation/templates/COMPLETION_REPORT_TEMPLATE.md)) |
| MVP | — | Minimum Viable Commercial Release = end of PHASE-014 |
| GA | — | General Availability = end of PHASE-025 |
