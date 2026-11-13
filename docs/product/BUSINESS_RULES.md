# Business Rules

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-11-12 (PHASE-040 — BR-066 · PHASE-041 — BR-067 · PHASE-042 — BR-068…071 · PHASE-044 — BR-072…077)

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

## Blueprint v3.0 — extensibility rules (BR-057 … BR-059)

The three rules below are fixed by [../planning/COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md)
CR-06 and delivered by PHASE-036 (migration `0049_custom_fields.sql`) — the extensibility
core: typed custom fields (FD-18), per-entity form layouts (FD-19), tenant-managed
picklists (FD-20), on the ADR-0019 substrate
([../architecture/ADR/ADR-0019-custom-fields-typed-value-store.md](../architecture/ADR/ADR-0019-custom-fields-typed-value-store.md)).
Numbering continues from BR-056, the last shipped rule; boundary rules 1–2 above apply
unchanged (a UDF value never posts — INV-022; no rule here invents legal content). The
per-group table format applies; each rule's delivering phase is 036 and the feature key
is `platform.custom_fields`.

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-057 | Custom-field type integrity: a value row exists only for a definition of matching `data_type`, and exactly ONE typed column is non-null per row (the `num_nonnulls` DB law); archiving a definition hides its field but PRESERVES its values (history renders forever); archived picklist options are rejected for NEW values while their labels keep rendering for history | The typed store is the queryable, indexable, type-safe substrate (ADR-0019); values are business history — a definition retiring may never destroy recorded facts | `configuration` value guard (validate before entity insert — zero partial writes; full-replace semantics) · `configuration.custom_fields.manage` (writes ride the OWNING entity's permission) | (**fixed**) | INV-022 |
| BR-058 | Key namespace discipline: tenant keys are lowercase snake_case ≤ 64 chars (leading letter), never a reserved platform stem (`id`, `tenant_id`, `created_at`, `updated_at`, `version`, `created_by`, `status`, `custom_fields`/`customFields`, …), and never a native column of the target entity (the code-owned registry's native-field blocklist); future native columns are checked against the registry at design time | A custom key that shadows a platform stem or a native column silently forks the entity's own vocabulary and breaks every future native migration | `configuration` definition service at create (key guard) · `configuration.custom_fields.manage` | (**fixed**) | — |
| BR-059 | Form-layout native protection: every mandatory native field appears exactly ONCE in any saved layout and the mandatory fields keep their canonical registry order; role overrides layer on the default layout, never replace it | A layout that drops or reorders a mandatory field renders a form that cannot save — the designer composes presentation, never the entry contract | `configuration` form-layout service at upsert (guarded against the registry's mandatory list) · `configuration.form_layouts.manage` | (**fixed**) | — |

## Blueprint v3.0 — compliance rules (BR-060 … BR-077) + planning rules (BR-078 … BR-080)

The first two rules below are fixed by [../planning/COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md)
CR-07 and delivered by PHASE-037 (migration `0050_zatca_phase1.sql`) — the ZATCA
Phase-1 generation core (the TLV QR, the ICV/PIH chain, the fail-closed B2C guard);
BR-062/BR-063 continue the section — fixed by CR-08 and delivered by PHASE-038
(migrations `0051`–`0054`, the procurement sourcing cluster); BR-064/BR-065 —
fixed by CR-09 (scope extended by v3.1/CR-46 and v3.2/CR-50 · R-03) and delivered
by PHASE-039 (migrations `0055`–`0059`, the returns & collections cluster) — and
BR-066 — fixed by CR-10 (scope extended by the L1-21 export-templates half) and
delivered by PHASE-040 (migrations `0060`–`0063`, the data onboarding & migration
toolkit) — and BR-067 — fixed by CR-11 and delivered by PHASE-041 (migration `0064`,
the communications hub, Wave 1's closing phase) — and BR-068…BR-071 — fixed by CR-12
(scope extended by v3.1/CR-45 L2-12 standard costing) and delivered by PHASE-042
(migrations `0065`–`0066`, the manufacturing execution cluster) — close the section.
Numbering continues from BR-059, the last shipped rule; boundary rules 1–2 above apply
unchanged (BR-060 guards INV-027's chain — [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md);
no rule here invents legal content — the SA pack
([../localization/compliance-matrix/sa.md](../localization/compliance-matrix/sa.md)) stays
the legal source; the STATUTORY_CAP late-fee mode carries its own REQUIRES_VERIFICATION
discipline — a statutory rate without its verified jurisdiction citation refuses to
charge, worksheet mode). **Numbering note (PHASE-042, the 0064 D-1 precedent):** the
PHASE-042 document planned BR-057…BR-060 — those slots predate the 036/037…041 waves
(BR-057…059 shipped with PHASE-036's extensibility rules; BR-060…067 with 037…041), so
the honest slots are BR-068…071 (the phase doc's planned ≈0060…0066 migrations likewise
landed as 0065/0066). The per-group table format applies; the 037 rules' delivering phase is
037 and the entitlement is the existing `tax.einvoicing_zatca` feature key (no new flag);
the 038 rules deliver under the `purchasing.rfqs` feature key and the 0051 sourcing
permission keys; the 039 rules deliver under the `sales.rma`, `sales.warranties`,
`sales.dunning` and `purchasing.rma` feature keys and the nine 0056 permission keys
([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.17); the 040 rule delivers under the
`platform.data_migration` feature key (migration 0060 §8) and the two 0060
permission keys ([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.18); the 041 rule delivers under
the `communication.*` feature keys (§26) and the five 0064 permission keys
([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.19); the 042 rules deliver under the six
`manufacturing.*` execution feature keys (§27) and the seven 0065/0066 permission
keys ([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.20); the 044 rules — BR-072…BR-077 —
deliver under the eight `inventory.wms/putaway/picking/cycle_counts/abc/
serial_ledger/quarantine/consignment` feature keys (§19's WMS block, business +
enterprise plans, the distribution/wholesale templates require them by default) and
the eight 0071 permission keys ([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.21). The
PHASE-044 document planned BR-064…067 — consumed by 039/040/041 — so the honest
slots are BR-072…077 (the 042 numbering precedent).

| ID | Statement | Rationale | Enforcement point (module · permission) | Tenant policy (default) | Invariants |
|----|-----------|-----------|------------------------------------------|--------------------------|------------|
| BR-060 | ZATCA QR mandatory, fail-closed (PHASE-037): a KSA-VAT tenant (country SA + SA tax registration REGISTERED) cannot ISSUE (post) or PRINT a SIMPLIFIED invoice without a stored QR payload — typed ZATCA_QR_PAYLOAD_REQUIRED rejection at both surfaces, zero residue. STANDARD invoices carry the QR as well when a device is configured. | An unstamped SIMPLIFIED (B2C) invoice is legally non-issueable in KSA — compliance surfaces fail closed, never best-effort: a posted fact or a printed artifact without its QR must be impossible, and the rejection must leave zero partial residue (INV-027's all-or-nothing stamp rides the same transaction) | `sales` post guard (stamped INSIDE the post transaction after the numbering bind, using the STORED `posted_at` — typed `ZatcaQrPayloadRequiredError`) + `pos` `PosReceiptService` print guard (the QR image injected + re-checked at print) · rides the owning document permissions (`sales.invoices.post`, the POS shift flow) — no new key | (**fixed**) | INV-027 |
| BR-061 | Honest generation vocabulary (PHASE-037): the ZATCA adapter produces GENERATED/FAILED only; no clearance/reporting/acceptance claim exists before PHASE-054; the Phase-2 surface (submit, CSID lifecycle, UBL 2.1, XAdES) is a typed NOT_IMPLEMENTED placeholder; device registration_status stays NOT_REGISTERED in Phase-1. | RISK-005 no-fabrication: a status that says ACCEPTED before an authority said it is a fabricated compliance claim — Phase-1 is pure computation with zero external calls (the audit's verdict), so the only honest outcomes are computed (GENERATED) or not (FAILED); every submission refusal carries the unmet GATE-1..4 pack ([GATE-DISCIPLINE-ZATCA.md](../decisions/compliance/GATE-DISCIPLINE-ZATCA.md)) | `tax` adapter contract (`zatca-stub.ts` → `ZatcaGenerationAdapter`): `ZATCA_GENERATION_STATUS_VOCABULARY` (grep-pinned by the contract tests), `submit()` typed `ZATCA_PHASE2_NOT_IMPLEMENTED` with `ZATCA_UNMET_GATE_ITEMS` · `zatca_devices.registration_status` CHECK admits the Phase-2 lifecycle states but the Phase-1 surface writes `NOT_REGISTERED` only · `tax.einvoicing.devices.manage` (device CRUD, online-only) | (**fixed**) | INV-022 |
| BR-062 | The 3-bid rule (PHASE-038): awarding an RFQ below the tenant's configured minimum quote count (`purchasing.rfq.min_quote_count`) is a typed rejection in ENFORCED mode; ADVISORY warns once (one inbox notification + audit) and proceeds; OFF (default) ignores the floor. | Structured competitive buying is measurable savings — the discipline the H-11 audit finding demands. | purchasing award service + route (`purchasing.rfqs.award`) | (**policy** — tenant-configurable; default OFF) | threeBidDecision (sourcing-math) — both modes tested |
| BR-063 | One award per RFQ round (PHASE-038); awarding closes the round for quote activity (the comparison is frozen evidence, never recomputed; generated documents stay traceable through generated_docs). | A round renegotiated after award destroys the audit trail. | RFQ state machine + quote/award guards + the one-live-comparison DB unique | (**fixed**) | RFQ AWARDED/CLOSED reject submissions and second awards (typed 409) |
| BR-064 | RMA disposition gate + exactly-once completion (PHASE-039): a disposition is chosen only at/after INSPECTED (DB gate `ck_return_authorizations_disposition_gate`), completion fires only from INSPECTED, and the completion credit note — or the supplier mirror's AP debit note — is generated EXACTLY ONCE, atomically with the stock/refund (ship/credit) leg inside ONE ambient tenant UoW; a replayed completion is the typed `RMA_STATE_INVALID` / `SUPPLIER_RMA_STATE_INVALID` (the terminal-stamp CHECKs — terminal states imply `credit_note_id`/`debit_note_id` + `posted_journal_id` — are the DB floor, 0055/0059). Qty bounding: per line, return qty ≤ invoiced − already-credited − open-RMA (the three-way fold floored at zero — typed `RMA_QTY_EXCEEDS_INVOICED`; terminal RMAs count as credited, never double-subtracted); the purchasing mirror bounds ≤ purchased − open/returned supplier RMAs (typed `SUPPLIER_RMA_QTY_EXCEEDS_PURCHASED`; CREDITED rows stay in the fold — PO lines carry no credited twin). | A return that could re-fire its credit note, or skip inspection, is an AR-fraud channel; the bound keeps returns ≤ what was actually invoiced — BR-004's credit-note-reference law made operational | `sales` returns service (typed state machine + `computeReturnAvailability`) + `purchasing` supplier-returns service (the mirrored gate) · `sales.rma.manage` (+ `sales.rma.approve` — SoD creator ≠ approver) / `purchasing.rma.manage` | (**fixed**) | INV-013, INV-003 (the 0055/0059 lifecycle-stamp CHECKs) |
| BR-065 | The dunning ladder is monotonic (PHASE-039): steps advance ONE per sweep run — target = min(the step the days-overdue earned, last fired step + 1) — never skipping, never regressing; at most ONE letter per (invoice, step): `uq_dunning_letters_invoice_step` UNIQUE (tenant_id, invoice_id, step_no) IS the evidence (a unique violation under a concurrent sweep skips the item — the register already holds it, the per-item SAVEPOINT keeps the run alive); `referToAgency` may mark only the TERMINAL step (the ladder's last escalation is the agency handoff, L1-11); ladders carry 1..20 steps with strictly ascending days-overdue > 0, channels EMAIL/WHATSAPP/SMS. | An escalating collections process that can re-send, skip, or retreat destroys its own compliance history and harasses customers; the agency referral is the ladder's designed terminal state, never a mid-ladder shortcut | `sales` dunning service (`validateDunningSteps` + `resolveCurrentStep`/`advanceStep` + `runSweep`) + the letters UNIQUE · `sales.dunning.manage` | (**fixed**) | the UNIQUE is the invariant — the re-fire guard is unit + DB tested (BR-065 both sides) |
| BR-066 | An import commits only after a clean or explicitly-acknowledged dry-run, atomically (PHASE-040): the dry-run writes NOTHING (journal + entity counts byte-identical before/after — the spec's ledger snapshot), the commit's worker RE-VALIDATES inside ONE tenant UoW against EXACTLY the mapping the preview promised (the `import_jobs.mapping` snapshot, migration 0062 — an edited saved mapping cannot silently diverge), a mid-run failure rolls the WHOLE UoW back (the job returns to PREVIEW_READY with the failure recorded — zero partial state, a re-run converges), files carrying invalid or duplicate rows refuse to commit without `acknowledged: true` (the typed gate), and every apply rides the OWNING module's real service (COA/opening engine/assets/employees/price lists/contracts/the PHASE-028 budget grid) — no raw inserts, no journal bypass (the negative ledger proof holds around every commit). | A half-applied migration file is the worst onboarding outcome: a tenant that cannot tell what landed, on a ledger it cannot trust; the dry-run-then-atomic-commit discipline is the same INV-013/INV-003 all-or-nothing law the transactional engine already enforces, generalized to the import path (H-17) | `onboarding` toolkit engine (dry-run → ack-gated claim → pg-boss worker → per-kind appliers) · `configuration.imports.manage` (0060 §7; the hub route + job lifecycle) | (**fixed**) | the zero-write dry-run snapshot + the interrupted-commit probe + the re-run convergence are DB-tested (import-toolkit.db.spec, acceptance 2/6) |
| BR-067 | Channel-port isolation (PHASE-041): EVERY outbound send — email, WhatsApp, SMS, any producing surface (dunning letters, digests, nudges, notifications, manual) — flows through the channel port as a row in `outbound_messages` (queue → provider → status transitions with provider ref, cost, bounded retries with backoff); NO provider is called outside the port (the repo grep proof), and until a provider is BOTH selected AND fully credentialed the SANDBOX default serves every channel with ZERO external calls — a selection with incomplete credentials falls back to SANDBOX with the honest `blockedOnCredentials` state (never a half-configured live send). Provider credentials live sealed in tenant_settings under the secret-store discipline (never logged, never returned for display — only configured-state); paid-channel selections additionally require the channel's tier-4 entitlement at save time. | An outbound message that bypassed the ledger is unauditable and unbillable; a mis-configured provider silently draining money (or leaking credentials in logs) is the worst-case paid-channel failure; the SANDBOX default keeps every plan, test, and unconfigured environment honest — zero external calls by construction | `communication` module (the provider registry + `resolveChannelPort` + the outbox worker; every adapter speaks HTTP ONLY through the provider transport seam) · `communication.templates.manage` (the settings hub) + `communication.outbox.read` (the ledger/report) | (**fixed**) | the every-send-a-row law (status-evidence + cost-shape CHECKs are the DB floor) + the network-blocked SANDBOX proof (T-13) + the no-provider-outside-the-port grep gate |
| BR-068 | One ACTIVE routing per item + the frozen operation snapshot (PHASE-042): a routing is versioned exactly like a BOM (DRAFT → ACTIVE → ARCHIVED, `uq_routings_active_item` partial UNIQUE = one ACTIVE per item), and releasing a production order FREEZES one `production_order_operations` row per routing operation (std setup/run times + std rates from the routing's per-operation overrides ?? the work center) — later routing edits, new versions, or work-center rate changes NEVER move a live order. Routing-less orders keep the legacy flat-rate path byte-identical (the dual mode: release takes an explicit routingId — any version of the item, the BOM precedent; null opts out; undefined auto-binds the item's ACTIVE routing when one exists; the G-17/G-18 regression packs pin the legacy shape). | A live order whose economics drift under it mid-execution is un-auditable and un-costable — the freeze is the same discipline that makes BOM-backed orders reproducible; the dual mode guarantees existing tenants' orders behave exactly as before the phase | `manufacturing` routing service + `OperationExecutionService.freezeOrderOperations` (called by the production-order release) · `manufacturing.routings.manage` / `manufacturing.production_orders.view` (release) | (**fixed**) | INV-013, INV-028 (the 0065 floors; routing-execution.spec pins the freeze + the dual mode) |
| BR-069 | Rework cost posts to REWORK_EXPENSE — never capitalized into the parent FG layer (PHASE-042): a rework order references the defective batch/serial + its parent production order, carries its own frozen routing standard, and its completion posts golden G-41 (source `rework_order` op `complete`: DR `REWORK_EXPENSE` · CR `PRODUCTION_LABOR` · CR `PRODUCTION_OVERHEAD` at the frozen rates × actual setup + run hours) — the parent order's fg/wip/labor/overhead value columns stay byte-identical before and after (pinned, not just equal-to-whatever-they-were); a zero-conversion completion is the typed `REWORK_COST_ZERO` rejection. | Capitalizing rework into the parent finished-goods layer overstates inventory with cost the good output never carried — rework is a period cost of poor quality, and the parent's completion economics must never move under it | `manufacturing` rework service (RW- numbering, DRAFT → RELEASED → IN_PROGRESS → COMPLETED/CANCELLED) · `manufacturing.rework_orders.manage` | (**fixed**) | INV-013 (the G-41 exactly-once key; rework-costing.spec pins the parent byte-identical) |
| BR-070 | Downtime records are record-only by default (PHASE-042): every record carries a closed-vocabulary reason code (PLAN_SETUP/BREAKDOWN/MAINTENANCE/MATERIAL_SHORTAGE/QUALITY_HOLD/POWER_OUTAGE/CHANGEOVER/OPERATOR_ABSENT/OTHER), the work center, an optional (order, operation-sequence) link, and 0..1440 duration minutes; posting the non-value cost leg (G-42: DR `DOWNTIME_EXPENSE` · CR `PRODUCTION_OVERHEAD` at the center's full hourly rate × idle hours) is the EXPLICIT `manufacturing.downtime_posting='post'` opt-in — under the default the closed row carries ended_at + duration with `cost_amount`/`journal_id` NULL (the `ck_downtime_records_window` floor), and an uncosted center never posts even under 'post'. | Idle-capacity costing is a management-accounting choice, not a law — forcing it on every tenant would fabricate expense postings from availability logging; the OEE availability input stays honest (minutes always recorded) while the money leg stays opt-in | `manufacturing` downtime service (the `resolveTenantStatic` policies seam — the same seam the production-order service reads) · `manufacturing.downtime.log` | (**policy** — `manufacturing.downtime_posting` enum `off`/`post`, default **off**) | INV-013 (the `downtime_record:close` exactly-once key; downtime-oee.spec pins both policy sides) |
| BR-071 | Operation completion posts conversion at work-center rates × ACTUAL times (PHASE-042): golden G-40 (source `production_order` op `op_<seq>`) debits WIP with labor = (actual setup + run) × the frozen var rate and overhead = (actual setup + run) × the frozen fixed rate; the completion stamps the per-operation variance records — setup_variance = (actual_setup − std_setup) × (std_fixed + std_var), usage_variance = (actual_run − std_run × qtyBasis) × std_var with qtyBasis = the running actual qty mid-order (planned when none produced yet — the order-level yield variance catches the remainder), rate_variance = **0 in v1: the frozen std rates ARE the applied rates** (work-center rate changes mid-order are the PHASE-043 concern — the honest limitation, the column stays so the shape never moves) — and order completion stamps yield_variance = (planned_qty − actual_qty) × std_unit_cost (positive = produced-less-than-planned = unfavorable; NULL std leaves 0, the dual mode). Rounding residuals are explicit, never absorbed: the credit sum MUST equal the debit at 4dp (typed `OPERATION_COST_ROUNDING`), a zero leg is skipped, and an entirely uncosted operation records its times WITHOUT a journal. | Conversion cost that ignores actual times is fiction, and variance records that absorb rounding drift are unusable for improvement work — the explicit-residual law (INV-007's spirit) extended to the shop floor; the v1 rate-variance zero is documented honestly rather than silently computed as something else | `manufacturing` operation-execution service (`completeOp` + the order completion in the production-order service) · `manufacturing.shopfloor.execute` (operations) / `manufacturing.production_orders.post` (order completion) | (**fixed**) | INV-013, INV-028 (the `op_<seq>` exactly-once key; routing-execution + standard-costing db specs pin the worked variances) |
| BR-072 | The default-bin anchor (PHASE-044): every receipt without an explicit bin lands in the warehouse's DEFAULT bin (materialized lazily on first use — migration 0071 §5 backfills the DEFAULT zone → aisle A1 → rack R1 → bin chain for EXISTING warehouses, barcode `BIN-<WH>-DEFAULT`); every plan without `directedTakes`/`targetBinId` allocates from and lands on the default slot; zero-quantity bins are legitimate (structure without contents). | Tenants start bin-less — a hard "configure bins first" wall would strand every existing flow on upgrade; the lazy anchor keeps every pre-WMS surface working while the directed surfaces grow around it. | `movement-core` plan/apply (the `targetBinId ?? findDefaultBin` resolution) + `wms-store.findDefaultBin` · rides the owning document permissions | (**fixed**) | INV-029 (wms-core.spec — the lazy anchor + the fold) |
| BR-073 | One DEFAULT per floor (PHASE-044): at most ONE `is_default` bin and ONE `is_default` zone per warehouse — a second default is the typed zero-residue rejection (unset the existing one first); the cycle-count document generation is bin-aware (one line per (item × bin × batch) slot). | Two defaults is an ambiguous allocation target — the anchor must resolve to exactly one slot or directed ops become non-deterministic. | `WmsService.createBin`/`updateBin`/`createZone`/`updateZone` guards · `inventory.wms.locations` | (**fixed**) | INV-029 (wms-inv029.spec — the one-default floors) |
| BR-074 | Task-claim conflict discipline (PHASE-044): pick/putaway tasks carry a `version` column the field-sync conflict checks read; a scan confirmation reconciles against the STORED row — an idempotent replay (duplicate delivery) returns the stored state and never a second move; two devices claiming the same task converge on the first-write-wins row. | The field workforce syncs over flaky links — duplicate deliveries and racing devices must never double-pick or double-putaway; the version column is the single convergence point (the §7 field-sync risk mitigation). | `pick_tasks.version` + the sync inbox's `wms_task:confirm_pick`/`confirm_putaway` transport-only handlers (in-tx feed markers) · `inventory.wms.picking`/`inventory.wms.putaway` | (**fixed**) | INV-013 (the sync round-trip suite proves ACCEPT + duplicate + wrong-bin zero-residue) |
| BR-075 | Cycle-count variance approval threshold (PHASE-044): a document whose per-line value impact exceeds the schedule's `approval_threshold` (manual documents fall back to `inventory.count_variance_tolerance`) cannot post without the supervisor override — the typed `CYCLE_COUNT_THRESHOLD_EXCEEDED` names the count; recounts always re-enter the loop (DRAFT→COUNTED→VARIANCE_REVIEW→POSTED). | Count variances are the classic shrinkage fraud channel — a counting clerk who can post their own material variance closes their own blind spot; the threshold + the distinct supervisor flag is the BR-034 SoD pattern at the bin level. | `CycleCountService.approve` (the threshold fold + the supervisor gate) · `inventory.cycle_counts` | (**policy** — per-schedule `approval_threshold`, default 0 = every variance needs the override) | G-13/G-14 with CYCLE_COUNT reasons (wms-cycle-counts.spec) |
| BR-076 | Consignment/VMI ownership exclusion (PHASE-044): vendor-owned stock (bin_contents rows carrying `owner_partner_id`) NEVER enters the tenant's valuation or availability — no `item_stock`, no `stock_moves`, no journal on receive/return (the stock is the owner's asset, INV-010 stays the tenant's own); the INV-029 fold, the bin-level ATP, and the pick allocation source span tenant-owned rows only; consumption settles at the agreed price through G-44. | Booking a supplier's consignment stock as inventory overstates assets and COGS — the audit's I-10/I-11 finding; the structural exclusion is the only shape that keeps INV-010 honest by construction. | `ConsignmentService` (receive/return structural; consume settles) + the fold/ATP/pick queries' `owner_partner_id IS NULL` filters · `inventory.tracking.consignment` | (**fixed**) | INV-010, INV-029, G-44 (wms-consignment.spec — the exclusion set proven at every surface) |
| BR-077 | The mapped-control-account discipline for WMS valuations (PHASE-044): the G-43 quarantine leg (1290), the G-44 consignment settlement (2135), and the G-46 transfer-price difference (4990) post ONLY against tenant-MAPPED purposes — an unmapped purpose is the typed `PURPOSE_NOT_MAPPED` rejection with ZERO partial writes (the 038 discipline); the policies that gate them (`inventory.quarantine_posting` off/distinct) default to posting NOTHING. | A WMS valuation leg against a guessed account corrupts the chart of accounts silently — fail-closed until the tenant maps is the only honest default; the off-by-default quarantine policy keeps unconfigured tenants' ledgers byte-identical. | the posting engine's purpose resolution + the three services' pre-post mapping checks · `inventory.quarantine`/`inventory.tracking.consignment` | (**policy** — `inventory.quarantine_posting` enum `off`/`distinct`, default **off**) | INV-013, G-43…G-46 (the unmapped-1290 zero-residue probe + the operand discipline) |
| BR-078 | The MPS frozen-fence law (PHASE-043): an edit (qty/bucket move/create/remove) whose bucket falls inside the item's frozen fence requires BOTH the distinct `manufacturing.mps.frozen_edit` permission AND a reason of 1..300 chars — the reason rides the row (`last_edit_reason`) + the audit event, every in-fence write (the create included); outside the fence the reason stays optional. The fence anchors on the current date (frozen_fence_days from the item's planning policy; 0 = no fence). | The frozen fence exists so the shop floor can trust the plan — a silent in-fence MPS change re-plans released work without a trace; permission + reason makes the override deliberate and auditable. | `MpsService.upsert/remove` (the per-request permission resolution + the typed `MPS_FROZEN_EDIT`) + `ck_mps_entries` floors · `manufacturing.mps`/`manufacturing.mps.frozen_edit` | (**fixed**) | G-49-adjacent (planning-goldens.spec — the fence guards: permission AND reason for every in-fence write) |
| BR-079 | The suggestion decision discipline (PHASE-043): a suggestion converts EXACTLY ONCE (the idempotent one-click conversion — accept-on-ACCEPTED is a replay returning the ORIGINAL document, never a second one; the partial UNIQUE (tenant, converted_doc_type, converted_doc_id) is the DB floor — INV-030), and dismissal REQUIRES a reason of 1..300 chars (the DB CHECK mirrors it; the service error is the typed 422); SUPERSEDED is the engine's own flip on re-run (the coverage netting — prior SUGGESTED receipts subtract from net requirements and flip SUPERSEDED, never double-cover). | Double-clicked conversions create duplicate purchase orders — the audit's §7 duplicate-document risk; an unexplained dismissal destroys the planner's evidence trail and makes the plan un-auditable. | `MrpSuggestionsService.accept/dismiss` + `uq_mrp_suggestions_converted_doc` + `ck_mrp_suggestions_dismissed_shape` · `manufacturing.mrp` | (**fixed**) | INV-030 (planning-goldens.spec — the idempotent conversion retry returning the ORIGINAL MO, the reason-not-optional proof, the re-run supersede with exactly one live suggestion) |
| BR-080 | The conservative ATP exclusions are HARD rules (PHASE-043): quarantined/HOLD bin stock, ACTIVE reservations, and consignment-owned (owner-partner) stock NEVER promise — the ATP/CTP position and the sales-line stamps compute available = on-hand − quarantined − reserved (floored at 0), with each excluded class riding its own first-class evidence column (visible, never counted); over-promising is a WARNING stamp (`atp_status='SHORT'` + the CTP suggested date), never a block. | Promiseable quantity that includes quarantined or vendor-owned stock sells goods the tenant cannot ship — the audit's M-06/S-10 finding; the conservative exclusions are the only honest ATP shape, and the evidence columns make every exclusion auditable. | `AtpService`/`computeAtpPosition` + `stampSalesLineAtp` (the sales-line integration) + the `manufacturing.atp-position` report's exclusion arithmetic (asserted per row) · `manufacturing.mrp` | (**fixed**) | BR-076 (the consignment half), INV-029 (the bin-status states; planning-goldens.spec — reserved never promises, the FIFO policy reservation then SHORT at 4) |

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
