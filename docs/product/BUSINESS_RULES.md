# Business Rules

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-10-28

The numbered, normative rule catalog for tenant-configurable business behavior. Rules are
referenced as `BR-xxx` across the blueprint (phases, tests, workflows). Each rule fixes a
**default** and names the **tenant policy key** that configures it. Two hard boundaries
apply to every rule:

1. **No rule may weaken an accounting invariant** — [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)
   (INV-022). Where a rule seems to allow something an invariant forbids, the invariant wins.
2. **No default or policy value here is a legal statement.** Rates, filing obligations, and
   document legal requirements live exclusively in jurisdiction packs
   ([../localization/TAX_ENGINE.md](../localization/TAX_ENGINE.md)) — this file never invents them.

**Policy namespace.** Tenant policies are typed keys in `tenant_settings` named
`<module>.<policy>` (e.g., `sales.credit_limit_action`). Defaults shown as
`key = value` are product defaults applied at onboarding; tenants may change them unless the
row says **fixed**. Enforcement is always server-side; the UI only reflects it.

## 1. Sales rules (BR-001 … BR-008)

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-001 | A credit sale to a customer whose (open balance + this invoice) exceeds the credit limit, or who has overdue invoices, is **blocked / warned / allowed** per the tenant's policy | Trust is commercial, not technical; the platform must make the decision explicit and auditable | `sales` at document approval (calls `partners` credit check) · `sales.invoices.post`; offline POS/van use cached snapshot + sync revalidation | `sales.credit_limit_action = warn`; per-partner override | INV-009, INV-016 |
| BR-002 | Line and document discounts are capped per role; above the cap the document requires an approver with a higher ceiling | Discounts are the most common shrink vector in cash businesses | `sales` pricing validation · `sales.discounts.apply`; ceilings per role template configurable | `sales.discount_ceiling.<role>` — cashier `0%`, sales `5%`, owner unlimited (product defaults, tenant-adjustable) | INV-007 |
| BR-003 | Selling price resolves by precedence: **customer's price list → customer-tier list (distribution) → branch default list → item base price**; manual override allowed within BR-002 | Predictable pricing beats clever pricing; exceptions must be visible | `items` price resolution service · `items.price_lists.manage` | `sales.price_override_allowed = true` (within ceilings) | INV-007 |
| BR-004 | A sales return (credit note with stock re-entry) must reference the original invoice and is allowed only within the tenant's return window | Returns without reference are theft laundering channels | `sales` credit-note validation · `sales.credit_notes.post` | `sales.return_window_days = 14` (0 = unlimited); default re-entry cost = original issue cost (**fixed** by accounting) | INV-010, INV-018 |
| BR-005 | Cash sales may auto-post on save (skip explicit approval); the states APPROVED→POSTED still occur and are recorded as policy-driven | Queue speed at retail counters; audit trail preserved | `sales` posting path · `sales.invoices.post` | `sales.cash_autopost = off` (back office), `pos.cash_autopost = on` (POS terminals) | INV-006, INV-021 |
| BR-006 | A quotation past its `valid_until` cannot be accepted or converted; it may be re-issued as a new quotation | Stale offers must not silently become binding orders | `sales` quotation service · `sales.quotations.manage` | `sales.quote_default_validity_days = 30` | — |
| BR-007 | Deliveries may precede invoicing, or invoices precede delivery, per template policy — both orders are first-class; stock and AR effects post at their own documents | Different industries legitimately invoice at different moments (retail = with sale; contracting = before delivery) | `sales` document chain policy · `sales.deliveries.manage` | `sales.doc_flow = delivery_then_invoice` (retail/distribution default) or `invoice_then_delivery` | INV-006, INV-010 |
| BR-008 | Free goods are zero-price lines with a free-goods reason, never negative lines or memo-only adjustments | Margin reports and VAT bases stay truthful | `sales` + `distribution` free-goods policies · `distribution.free_goods.manage` | `sales.free_goods_allowed = true`; policy rules per tier/promotion | INV-007 |

### 1.1 Worked examples — sales rules

**BR-001 (credit limit, `warn` posture).** Customer has limit 10,000, open balance 8,200,
overdue 0. A new credit invoice of 2,500 would take exposure to 10,700 → the approval
screen shows a hard warning (تجاوز حد الائتمان — credit limit exceeded) with the math
(8,200 + 2,500 > 10,000); with `block` the post button is disabled and the escalation path
offers: partial shipment, cash conversion, or owner approval recorded on the document.
Offline POS/van decisions use the cached snapshot and are re-validated at sync; a breach
found at sync returns an actionable error, never a silent merge.

**BR-002 (discount ceiling).** Cashier role ceiling 0%: a 5% line discount attempt shows
"يتطلب صلاحية أعلى" (higher permission required) and offers supervisor PIN. Sales role
ceiling 5%: a 7% attempt routes the document to the approval queue; the approver's own
ceiling is checked before the approval action is even offered. Ceilings compare the
discount **percentage per line** and the document-total discount percentage — both must
fit.

**BR-004 (return window).** Invoice posted 2026-10-01; window 14 days. A return dated
2026-10-18 is accepted (within window), a return dated 2026-10-20 is rejected with the
window cited; `sales.return_window_days = 0` disables the date check but **never** the
reference requirement. Re-entry values the returned units at the **original issue cost**
from the referenced invoice line — not at current average — so margins stay truthful.

**BR-005 (auto-post audit record).** A POS cash sale auto-posts; the document records
`approved_by = policy:pos.cash_autopost` distinct from `posted_by = <cashier user>` so the
two lifecycle states remain distinguishable in the audit trail (document lifecycle §2
rule 1).

## 2. Purchasing rules (BR-009 … BR-012)

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-009 | Supplier invoices are matched against PO and GRN (three-way) before approval; variances within tolerance auto-pass, variances above require buyer disposition (accept-with-reason / debit note / GRN amendment) | Exception-driven review scales; the match outcome is recorded on the invoice | `purchasing` matching service · `purchasing.matching.review` | `purchasing.match.qty_tolerance_pct = 0`, `purchasing.match.price_tolerance_pct = 0` (exact by default; tenants may loosen) | INV-012 |
| BR-010 | Purchase orders above the tenant's amount threshold require approval; the threshold is per branch and per document type | Spending control without strangling small buys | `purchasing` + `accounting` approval policies · `purchasing.orders.manage` | `approvals.purchase_order.<branch>.threshold` (no threshold by default at MVP for single-owner tenants) | — |
| BR-011 | A supplier invoice whose (supplier, supplier-invoice-number, amount) triple already exists is blocked; same (supplier, number) with a different amount warns | Duplicate AP entry is the classic double-payment bug | `purchasing` uniqueness check at submit · `purchasing.supplier_invoices.post` | `purchasing.duplicate_invoice_behavior = block` (warn allowed) | INV-013 |
| BR-012 | Goods receipts without a PO ("direct purchase") require an explicit permission and reason; tenants may forbid them entirely | Uncontrolled receiving defeats spend control | `purchasing` GRN service · `purchasing.goods_receipts.manage` | `purchasing.allow_po_less_grn = true` | INV-018 |

### 2.1 Worked example — BR-009 tolerance math

PO line: 100 units @ 50.00. GRN line: 100 units. Supplier invoice line: 100 units @ 51.00.
With `price_tolerance_pct = 0` the 1.00/unit variance (2%) is an **exception**: the buyer
dispositions it — accept-with-reason (posts the 51.00 cost), debit note for the difference,
or GRN amendment if the receipt was wrong. If the tenant sets tolerance to 2%, the same
invoice auto-passes with the variance recorded on the match result. Quantity behaves
identically: GRN 98/100 with 0% tolerance is an exception; short-receipts are legitimate
(only the **received** quantity is matchable) and the PO stays open for the remainder.

## 3. Inventory rules (BR-013 … BR-019)

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-013 | Issuing stock below zero is forbidden by default; when a tenant explicitly enables negative stock, issues price at the last known average and reports flag the negative state | Negative stock hides real-world leakage; some retailers need receiving-lag tolerance, knowingly | `inventory` issue validation · `inventory.read` (issue paths) | `inventory.allow_negative_stock = false` | INV-010, INV-018 |
| BR-014 | An item's costing method (WAC/FIFO) never changes retroactively; switching requires no in-flight transactions and a dated revaluation posting | Cost history integrity; retroactive re-costing destroys margin truth | `inventory` method-switch service · `inventory.valuation.read` (switch permission) | method fixed per item after first transaction (**fixed**) | INV-017 |
| BR-015 | Count variances require approval before the adjustment posts; above the tolerance a second counter or supervisor is required | Counting errors must not flow straight into the ledger | `inventory` count service · `inventory.counts.manage` | `inventory.count_variance_tolerance = 0` (all variances reviewed) | INV-010, INV-011 |
| BR-016 | Stock in IN_TRANSIT is visible but never sellable or reservable | Selling what is on a truck double-counts | `inventory` availability computation | (**fixed**) | INV-010 |
| BR-017 | Items flagged `has_expiry` are issued FEFO (first-expiry-first-out) at POS and order picking | Food safety and waste reduction | `inventory` issue ordering | `inventory.fefo_for_expiry_items = true` | — |
| BR-018 | Serial/IMEI-tracked sales bind specific units; returns must reference the originally sold unit | Device traceability (phones, appliances) deters warranty fraud | `inventory` serial service · `inventory.serials.manage` | (**fixed** for tracked items) | INV-010 |
| BR-019 | Stock at/below reorder level raises a `stock.below_reorder` notification; automatic PO creation is **not** performed at MVP | Alert, not autopilot — purchasing judgment stays human | `inventory` + `notifications` · `inventory.reorder.manage` | `inventory.reorder_enabled = true` (alerting from PHASE-015) | — |

### 3.1 Worked example — BR-013 negative-stock behavior when enabled

Item on hand 4 units, WAC 25.0000. An offline POS terminal sells 6 (receiving lag).
With `inventory.allow_negative_stock = false` (default) the sale is rejected at the
terminal: "الكمية غير متوفرة" (quantity unavailable). With the tenant having **explicitly
enabled** the policy: the issue prices 6 × 25.0000 = 150.00 (last known average), on-hand
becomes −2 flagged in reports (رصيد سالب), and the ledger still balances because COGS
debit equals inventory credit (INV-010/018 hold). The flag appears on the stock report and
the close checklist surfaces persistent negatives.

## 4. Treasury rules (BR-020 … BR-024)

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-020 | Petty cash disbursements are capped per-transaction and per-fund-balance; exceeding either requires reimbursement or an accountant override | Petty cash without limits becomes a second uncontrolled wallet | `treasury` petty-cash service · `treasury.petty_cash.manage` | `treasury.petty_cash.single_tx_limit` / `treasury.petty_cash.max_balance` — PLACEHOLDER product defaults (see [OQ-002](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) pricing/limits pass) | INV-019 |
| BR-021 | A cashier shift whose counted cash differs from the system total cannot close silently: within tolerance it posts the difference automatically; above tolerance a supervisor PIN + reason is required | Cash variance is the daily honesty signal of retail | `treasury` shift close · `treasury.shifts.manage` / `pos.shifts.manage` | `treasury.shift_variance_tolerance = 0` (any difference needs reason); `treasury.shift_auto_post_small_variance = true` | INV-019 |
| BR-022 | Reconciling a bank statement locks that statement period for the account; unmatched items are aged and listed — never absorbed by "tolerance" | Bank rec must be explainable to an auditor line-by-line | `treasury` bank rec · `treasury.bank_reconciliation.manage` | (**fixed**) | INV-019 |
| BR-023 | Expense claims route per category and amount thresholds; receipts are mandatory above the tenant's receipt threshold | Policy follows the receipt, not the person | `treasury` expense workflow · `treasury.expenses.submit` / `treasury.expenses.approve` | `treasury.expense_receipt_threshold = 0` (always required); per-category approvers | INV-001, INV-007 |
| BR-024 | Cheques carry a status lifecycle (issued/received → deposited → cleared or bounced); a bounce produces a **new** correction document, never an edit | Cheques are the region's reality; their failure must be auditable | `treasury` cheque tracking · `treasury.cheques.manage` | `treasury.cheque_auto_status_days` (reminders) — PLACEHOLDER | INV-003 |

### 4.1 Worked example — BR-021 shift close

System shift total: cash sales 1,240.00, cash returns −60.00, opening float 200.00 →
expected drawer 1,380.00. Counted: 1,377.50. Variance −2.50. With
`treasury.shift_variance_tolerance = 0`, any difference requires reason; small-variance
auto-post posts DR cash-difference expense 2.50 · CR cash account 2.50 with the shift as
source (INV-019 stays intact: movements still sum to the account balance). A variance
beyond the (tenant-defined) supervisor threshold demands supervisor PIN + reason before
the shift can close at all.

## 5. Partner rules (BR-025 … BR-028)

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-025 | Partner codes are auto-numbered tenant-wide; manual codes must be unique; a partner's kind (customer/supplier/both) may change only while it has no postings | Identity stability keeps subledgers clean | `partners` directory service · `partners.manage` | `partners.code_autogenerate = true` | INV-009 |
| BR-026 | Credit terms changes affect **new documents only**; due dates of existing open items never move | Retroactive due dates falsify aging and collection promises | `partners` credit-terms service | (**fixed**) | INV-009 |
| BR-027 | Unallocated receipt/payment amounts remain explicit **on-account** open items — visible, allocatable later, never netted silently | "Advance payments" are common in the region and must stay traceable | `sales`/`purchasing` allocation service · `sales.allocations.manage` | `sales.on_account_allowed = true` | INV-016 |
| BR-028 | Partner statements are deterministic as-of: recomputation from immutable entries yields identical results; documents posted after the as-of date are excluded | A statement that changes on re-print destroys trust | `partners`/`reporting` statement path · `partners.statements.read` | (**fixed**) | INV-009 |

## 6. Accounting operations rules (BR-029 … BR-036)

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-029 | Official document numbers come from per-(tenant, branch, type) sequences, are immutable once assigned, and voided numbers stay reserved; assignment happens at approval-reserve or posting per policy | Legal numbering discipline with documented gaps only | `accounting` numbering service (consumed by all doc modules) · per-document post permissions | `numbering.<doctype>.assign_at = posting` (POS uses offline sequence + reconciliation, A-010) | INV-021 |
| BR-030 | No posting into a LOCKED period; posting into a SOFT_CLOSED period needs `accounting.periods.post_to_soft_closed` + reason; every reopen is audited and old-period reopens alert | The lock must be real or the audit trail is theater | `accounting` posting engine validation #4 + DB trigger | (**fixed**) | INV-011, INV-020 |
| BR-031 | Posted documents and journals are corrected **only** by new documents (credit/debit notes, adjustments, reversals); reversals mirror the original exactly and link bidirectionally | Editable history is unauditable history | `accounting` posting engine · `accounting.journal_entries.create` (reverse path) | (**fixed**) | INV-003, INV-014 |
| BR-032 | Monetary amounts round per-currency to minor units (half-up default per [ADR-0009](../architecture/ADR/ADR-0009-money-precision.md)); residuals post to rounding gain/loss purposes — never absorbed into revenue or tax | Rounding must live somewhere honest | `tax` + `accounting` rounding at line/document level | `tax.rounding_mode = half_up` (pack exceptions only, verified) | INV-007 |
| BR-033 | Posted documents **reuse** their stored tax snapshots forever; jurisdiction pack upgrades and rate changes affect drafts (with warnings) and future documents only — posted lines are never recomputed | Retroactive tax re-computation would falsify filed history | `tax` snapshot enforcement; posting engine refuses recomputation | (**fixed**) | INV-012, INV-003 |
| BR-034 | Approval policies compare total **base-currency** amounts against thresholds; a document's creator cannot approve it unless policy explicitly allows; preview equals posting | Segregation of duties with no preview/post divergence | `accounting` approval service · `accounting.approvals.configure` | `approvals.allow_self_approval = false`; per-type thresholds unset at MVP | — |
| BR-035 | Opening balances post once through the OPENING period; corrections afterwards are normal journals in open periods | A reusable "opening" mechanism would corrupt history | `accounting` opening-balance service · `accounting.opening_balances.post` | (**fixed**) | INV-001, INV-002 |
| BR-036 | FX rates come from the dated rate table; a document may override the rate (stored on the document); realized FX differences post at settlement automatically; unrealized revaluation is an optional, audited, reversible run | Consistency of rate usage across AR/AP/treasury | `accounting` FX services · `accounting.multi_currency` | `accounting.fx_revaluation_enabled = false` | INV-002, INV-008 |

### 6.1 Worked examples — accounting operations

**BR-029 (numbering).** Sequence `INV-BR1-` at 1,042: the next posted invoice takes
1,043 and the number is immutable (INV-021). A DRAFT cancelled after approval-reserve
(numbering policy `assign_at = approval`) voids the reservation — 1,043 stays reserved
forever and the gap is queryable in the numbering audit view; no backfill, ever.

**BR-032 (rounding).** A 3-decimal currency invoice with three lines whose computed taxes
are 4.5674 + 4.5674 + 4.5674: line rounding (half-up to minor units) yields 4.567 +
4.567 + 4.567 = 13.701 vs the document-computed 13.7022→13.702; the residual 0.001 posts
to the rounding purpose — it is never absorbed into revenue or VAT payable (INV-007).

**BR-033 (snapshot reuse).** A rate change takes effect on the 15th (pack version bump,
rate r1→r2). An invoice posted on the 14th keeps r1 in its line snapshots forever: the
VAT return for that period reports r1-based tax for it, pack upgrades never rewrite it,
and a **draft** dated the 14th but still unposted at upgrade time is warned — posting it
after the change date recomputes at the rate effective **at posting** per pack rules,
with the warning recorded. The platform never “fixes” posted history (INV-003/012).

**BR-034 (thresholds).** A 12,000.00 journal with threshold 10,000 routes to the approver
queue; the creator (role accountant) does not see an approve action at all
(`allow_self_approval = false`); the approver's preview is generated by the same engine
code that will post.

## 7. Configuration & entitlement rules (BR-037 … BR-040)

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-037 | No tenant setting, industry template, plan, or entitlement can disable or alter any INV-xxx invariant or any authorization check | Configuration selects, never overrides | `configuration` resolution layer + engine centralization; config-fuzz test suite | (**fixed**) | INV-022 (and all) |
| BR-038 | Applying or switching an industry template is **additive-only**: it may add menus, defaults, terminology, and policies; it never deletes data, documents, or settings; incompatible switches are blocked with a migration manifest | Template switching must be safe for a live business | `configuration` template service · `industry.templates.switch` | (**fixed**) — see [CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) §6 | — |
| BR-039 | Feature entitlements resolve server-side (plan + add-ons + overrides) and are enforced at module load and per action; UI visibility is **derived-only**; offline devices cache entitlement snapshots with sync-time revalidation | A hidden button is not a control; the server is the authority | `tenancy` entitlement service + module guards · `platform.entitlements.manage` (admin) | (**fixed**) | — |
| BR-040 | Activating a feature requires its dependency closure from [FEATURE_CATALOG.md](FEATURE_CATALOG.md) to be satisfiable (e.g., `pos.*` requires `sales.invoices` + `inventory` features); conflicting activations are rejected with the specific conflict | No half-installed features producing broken screens | `configuration` dependency validation at entitlement apply | (**fixed**) | — |

## Blueprint v2.0 — financial-depth rules (BR-041 … BR-056)

The sixteen rules below are fixed by [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md)
§H/ED-15 and delivered by the Blueprint v2.0 financial-depth modules — `fixed_assets`
(PHASE-026), `notes` + `installments` (PHASE-027), `budgeting` (PHASE-028), `payroll`
(PHASE-029), `consolidation` (PHASE-034). They are backed by the v2.0 invariants
INV-023…INV-026 ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md),
per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §G) and goldens G-21…G-32
([../accounting/JOURNAL_RULES.md](../accounting/JOURNAL_RULES.md) §7 per
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §F); boundary rules 1–2 above apply
unchanged. The v1.1 `treasury.cheques` status-tracking rule (BR-024) remains in force —
its full PDC lifecycle terminates in the `notes` module (ED-03): BR-045…BR-047 govern that
lifecycle from PHASE-027. The table extends the per-group format with **Phase** and
**Feature keys** columns citing the delivering phase document and the feature keys in
[FEATURE_CATALOG.md](FEATURE_CATALOG.md) §19–§24.

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants | Phase | Feature keys |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|-------|--------------|
| BR-041 | Asset categories map asset / accumulated-depreciation / expense purposes before use | Depreciation and disposal postings resolve accounts by category purpose (`FIXED_ASSET` / `ACCUM_DEPRECIATION` / `DEPRECIATION_EXPENSE`); a category missing its mapping cannot produce valid journals | `fixed_assets` category service at category create/update and first asset use · `fixed_assets.assets.manage` | (**fixed**) | — | 026 | `fixed_assets.categories`, `fixed_assets.register` |
| BR-042 | Depreciation posts only via runs (no manual asset journals); runs are period-locked | Depreciation must be a reproducible batch — one journal per run, lines per asset (G-22) — never hand-made asset journals that bypass INV-023 | `fixed_assets` depreciation-run service + posting-engine validation · `fixed_assets.depreciation_runs.run/post` | (**fixed**) | INV-011, INV-013, INV-023 | 026 | `fixed_assets.depreciation` |
| BR-043 | Net book value floors at salvage; disposal locks the asset | Assets never depreciate below salvage and leave the books exactly once | `fixed_assets` depreciation + disposal services · `fixed_assets.disposals.approve` | (**fixed**) | INV-023 | 026 | `fixed_assets.depreciation`, `fixed_assets.disposal` |
| BR-044 | Revaluation is optional, audited; the delta posts to `REVALUATION_RESERVE` | Revaluation is a controlled equity event, not a P&L nudge | `fixed_assets` revaluation service (posts via the engine) · `fixed_assets.assets.manage` | optional capability; every revaluation is reason-recorded and audited | INV-003 | 026 | `fixed_assets.revaluation` |
| BR-045 | Notes require partner + maturity; the PDC calendar is auto-derived | A note without partner and maturity can neither settle nor appear on the maturity calendar | `notes` note service at create · `notes.notes.create` | (**fixed**) | INV-024 | 027 | `notes.received`, `notes.issued`, `notes.pdc_calendar` |
| BR-046 | Dishonor requires a reason, restores AR exactly, fee optional via `BANK_CHARGES` | A bounced note must return the exact open item it settled (G-26), with an auditable cause | `notes` dishonor event · `notes.notes.record_dishonor` | bank fee optional per event (posts to `BANK_CHARGES` purpose) | INV-003, INV-024 | 027 | `notes.dishonor` |
| BR-047 | Endorsement moves custody without journal (journal only on collect/dishonor/return/discount) | Custody is physical; the ledger moves only at settlement moments (G-24…G-27) | `notes` endorsement event · `notes.notes.endorse` | (**fixed**) | INV-024 | 027 | `notes.endorsement` |
| BR-048 | Installment plan total must equal source document total; schedule immutable after activation | The plan is an amortization view of the source document, not a new obligation; editing it would falsify aging | `installments` plan activation · `installments.plans.manage` | (**fixed**) | INV-003, INV-009 | 027 | `installments.plans`, `installments.schedules` |
| BR-049 | Late-fee policy is per plan (rate + cap + grace — PLACEHOLDER defaults, OQ-002 family) | Late fees are commercial terms, not legal ones; defaults stay explicit placeholders pending the pricing/limits pass | `installments` late-fee path (posts via engine only — G-28) · `installments.plans.manage` | `installments.late_fee.rate` / `.cap` / `.grace_days` — PLACEHOLDER ([OQ-002](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) family) | INV-007 | 027 | `installments.late_fees` |
| BR-050 | One ACTIVE budget version per (fiscal year, scope); revisions supersede, never edit | Budgets are comparable baselines; editing an active budget destroys variance truth | `budgeting` version service (supersedes chain) · `budgeting.budgets.create/activate` | (**fixed**) | INV-003 | 028 | `budgeting.budgets`, `budgeting.approvals` |
| BR-051 | Budget controls are advisory by default; hard-block requires explicit tenant policy | Budgets guide spending; hard spend-blocks on a live P&L are a deliberate act | `budgeting` control checks at document approval · `budgeting.budgets.activate` | `budgeting.control_mode = advisory`; hard-block = explicit tenant policy | — | 028 | `budgeting.controls` |
| BR-052 | Payroll runs require an ACTIVE salary structure; mid-period changes create a new structure version | Frozen per-run pay math (`component_snapshot`) requires a stable structure at run time | `payroll` run service · `payroll.runs.create` | (**fixed**) | INV-025 | 029 | `payroll.salary_structures`, `payroll.runs` |
| BR-053 | Payroll accounts post only via runs | Salary/deduction/EOS accounts must never receive manual journals (G-29/G-30 monopoly) | posting-engine validation on payroll purposes (`SALARIES_*`, `DEDUCTIONS_PAYABLE`, `EMPLOYER_CONTRIBUTIONS`, `EOS_PROVISION*`) · `payroll.runs.post` | (**fixed**) | INV-013, INV-025 | 029 | `payroll.runs` |
| BR-054 | Loan deduction per period ≤ cap percent of net (default 25% — PLACEHOLDER) | Protects net pay from over-deduction of loan recovery | `payroll` loan deduction in run lines · `payroll.loans.manage` | `payroll.loan_deduction_cap_pct = 25%` — PLACEHOLDER ([OQ-002](../ASSUMPTIONS_AND_OPEN_QUESTIONS.md) family) | INV-025 | 029 | `payroll.loans` |
| BR-055 | EOS accrual per tenant policy table; no jurisdiction rates fabricated | End-of-service formulas are jurisdiction/contract-specific; the platform provides the mechanism, the tenant provides the terms | `payroll` EOS accrual in runs (settlement G-31) · `payroll.runs.post` | tenant EOS policy table per contract type — **no product defaults** | INV-003, INV-025 | 029 | `payroll.eos_provision` |
| BR-056 | Consolidation members must have closed fiscal periods; eliminations reversible only by counter-entry | Consolidating open books produces moving targets; eliminations follow the reversal-only correction law (G-32) | `consolidation` run precheck + elimination posting · `consolidation.runs.execute` / `consolidation.eliminations.post` | (**fixed**) | INV-011, INV-014, INV-026 | 034 | `consolidation.runs`, `consolidation.eliminations` |

## 8. Enforcement & test matrix

Every rule's default behavior is covered by automated tests in the enforcing module; rule
changes are test-first (§10). The matrix below is the minimum expected coverage cited in
phase acceptance criteria:

| Rule group | Enforcing module(s) | Test suite anchor | Phase of first enforcement |
|---|---|---|---|
| BR-001…BR-008 | sales (+ partners, items, distribution) | `sales-rules.spec` (credit, discount, pricing, returns, autopost) | 012 (POS variants 016/017) |
| BR-009…BR-012 | purchasing (+ inventory) | `purchasing-rules.spec` (matching, thresholds, duplicates, GRN) | 011 |
| BR-013…BR-019 | inventory (+ notifications) | `inventory-rules.spec` (negative, method switch, counts, FEFO, serials) | 010 (alerting 015) |
| BR-020…BR-024 | treasury | `treasury-rules.spec` (petty cash, shifts, bank rec, expenses, cheques) | 008 |
| BR-025…BR-028 | partners (+ sales/purchasing/reporting) | `partner-rules.spec` (codes, terms, on-account, statement determinism) | 006–013 |
| BR-029…BR-036 | accounting (+ tax) | `accounting-ops-rules.spec` + invariant suite ([../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)) | 007–009 |
| BR-037…BR-040 | configuration + tenancy | `config-fuzz.spec` (override attempts), `entitlements.spec`, `dependency-closure.spec` | 004 / 015 |
| BR-041…BR-056 | fixed_assets, notes, installments, budgeting, payroll, consolidation (+ posting-engine validation) | `fixed-assets-rules.spec`, `notes-rules.spec`, `installments-rules.spec`, `budgeting-rules.spec`, `payroll-rules.spec`, `consolidation-rules.spec` (Blueprint v2.0 — [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §H) | 026–029 / 034 |

Offline variants (BR-001 cached-limit revalidation, BR-005 offline autopost, BR-021
POS shift close) are additionally exercised in the sync chaos tests per
[ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md).

## 9. Rule ↔ journey/workflow traceability

| Rules | Exercised in |
|-------|--------------|
| BR-001, BR-002, BR-003, BR-005, BR-007 | [USER_JOURNEYS.md](USER_JOURNEYS.md) A, B, G · [BUSINESS_WORKFLOWS.md](BUSINESS_WORKFLOWS.md) §1–2 |
| BR-004, BR-006, BR-008 | Journeys B, G · Workflow §2 |
| BR-009 … BR-012 | Journey (P-06 flows) · Workflow §3 |
| BR-013 … BR-019 | Journey D · Workflows §4–6 |
| BR-020 … BR-024 | Journeys B (shift), F (expenses) · Workflows §7, §9 |
| BR-025 … BR-028 | Journeys A, C, E, G |
| BR-029 … BR-036 | Journeys C, E, H · all posting workflows |
| BR-037 … BR-040 | [CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) · [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md) |
| BR-041 … BR-056 | [BUSINESS_WORKFLOWS.md](BUSINESS_WORKFLOWS.md) §10–15 (Blueprint v2.0: PDC note lifecycle, asset lifecycle, installment sale & collection, monthly payroll run, budget cycle, consolidation close) |

## 10. Maintenance protocol

1. **Adding a rule**: decision record → row here with all columns → test-first (the rule's
   default behavior is part of phase acceptance criteria) → reference from the enforcing
   module's test suite.
2. **Changing a default**: allowed via decision record; tenants that already changed the
   policy keep their value; migration notes required when a default change alters posting
   behavior.
3. **Marking a rule fixed**: only when backed by an INV-xxx invariant or an authorization
   control — "fixed" rows are the platform's non-negotiables and are covered by fuzz tests.
4. Phase completion reports must list which BR-xxx rules their features enforce and cite the
   test names proving enforcement.
