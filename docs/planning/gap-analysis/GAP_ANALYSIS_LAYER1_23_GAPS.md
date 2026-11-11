# Gap Analysis — Layer 1: The 23 Second-Round Gaps (L1-01…L1-23)

> **Status:** ACCEPTED — CONSOLIDATED INTO THE PLAN (roadmap v3.1 · CR-41/CR-46) · **Owner:** Product Owner · **Date:** 2026-11-11
> **Origin:** the second and third owner-directed audit rounds (post-`a249b1e`), performed
> outside the repository in prior working sessions. This file persists that knowledge into
> the repository per the no-conversation-memory rule (CR-47): **gap knowledge never lives
> only in conversations.** None of these 23 gaps appears in the three first-round audit
> reports ([PROJECT_EVALUATION_2026-11-10.md](PROJECT_EVALUATION_2026-11-10.md) ·
> [ERP_COMPLETENESS_GAP_REPORT.md](ERP_COMPLETENESS_GAP_REPORT.md) ·
> [ERP_FULL_GAP_ANALYSIS.md](ERP_FULL_GAP_ANALYSIS.md)) — verified: zero matches in the
> first-round reports and in every pre-v3.1 planning document.
> **Companion file:** [GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) (L2-01…L2-20).

---

## 0. الملخص التنفيذي بالعربية

هذا الملف يوثّق **الفجوات الـ23** التي كشفتها جولتا التدقيق الثانية والثالثة (خارج
المستودع، في محادثات سابقة مع المالك) ولم تكن مدمجة في أي مرحلة من مراحل المخطط
v3.0. كل فجوة موثقة الآن بمعرّف واسم ثنائي اللغة ووصف وشدة وتقدير جهد وتبعيات
و**موضع نهائي في المخطط** (قرار CR-46). سياسة المالك الملزمة: **كل الفجوات بغض
النظر عن شدتها تدخل المخطط — لا استبعاد لأي فجوة لأنها "صغيرة"** (CR-41).

**قرار تسمية مهم (CR-41):** طلِب في التوجيه الأصلي ترقيم هذه الطبقة `N-01…N-23`،
لكن حرف `N` **محجوز أصلاً** لعائلة فجوات التكاملات `N-01…N-21` من تقرير
`ERP_FULL_GAP_ANALYSIS.md` §17 (وتُستهلك في المراحل 037/040/041/045/047/054/055/
056/061 — انظر `COMPLETENESS_ROADMAP.md` §6.2). اعتماد `N-xx` مرة ثانية كان سيخلق
تضارباً دائماً في الاستشهادات بين المستندات. لذلك رُقّمت هذه الطبقة **`L1-01…L1-23`**
(بالتقابل واحد-لواحد مع النumbs المطلوبة: L1-01 = N-01 المطلوبة، وهكذا)، كما أن
الطبقة الثانية `L2-01…L2-20` بلا تعارض أصلاً. هذا الانحراف الموثق عن حرف التوجيه
مقيد هنا ويصححه أي قرار لاحق من المالك.

## 1. Triage outcome (one disposition per gap, with evidence)

Legend: **SHIPPED** = delivered in the 34-phase baseline or a v3.0 phase — never
re-planned (roadmap §4 principle). **PARTIALLY SHIPPED** = the accounting/operational
backbone exists with cited evidence; the residual scope is planned. **ASSIGNED** = planned
into an existing phase (scope item added by roadmap v3.1). **NEW PHASE** = planned into a
newly created phase (066/067/068).

| ID | Gap (EN / AR) | Severity | Effort | Disposition | Home |
|---|---|---|---|---|---|
| L1-01 | Deferred revenue / الإيرادات المؤجلة | عالية | ~1.5–2 w | NEW PHASE | **068** |
| L1-02 | Revenue recognition / الاعتراف بالإيرادات | عالية | ~2 w (rides L1-01) | NEW PHASE | **068** |
| L1-03 | Prepaid expenses / النفقات المدفوعة مسبقاً | متوسطة | ~1 w | NEW PHASE | **068** |
| L1-04 | Recurring invoices / الفواتير المتكررة | عالية | ~1 w | PARTIALLY SHIPPED + residual → 068 | **068** |
| L1-05 | Monthly accruals / الاستحقاقات الشهرية | عالية | ~1 w | PARTIALLY SHIPPED + residual → 068 | **068** |
| L1-06 | Petty cash / النقدية الصغيرة | — | — | **SHIPPED** (PHASE-008) | closed |
| L1-07 | Travel expenses / مصروفات السفر | متوسطة | ~1 w (residual) | PARTIALLY SHIPPED + residual → 053 | **053** |
| L1-08 | Mileage allowance / بدل الأميال | منخفضة | ~0.5 w | ASSIGNED | **053** |
| L1-09 | Corporate cards / بطاقات الشركات | متوسطة | ~1.5 w | ASSIGNED | **053** |
| L1-10 | Credit-limit periodic review / مراجعة حدود الائتمان الدورية | متوسطة | ~0.5 w | PARTIALLY SHIPPED + residual already in 039 scope item 6 | **039** |
| L1-11 | Collection-agency integration / وكالات التحصيل | متوسطة | ~1 w | ASSIGNED (new scope item) | **039** |
| L1-12 | Late-payment fees / غرامات التأخير | متوسطة | ~1 w | ASSIGNED (new scope item) | **039** |
| L1-13 | Signing-authority matrix / مصفوفة سلطة التوقيع | عالية | ~1 w (residual) | PARTIALLY SHIPPED + residual → 058 | **058** |
| L1-14 | Official customer/supplier statements / كشوف الحسابات الرسمية | — | — | **SHIPPED** (PHASE-011/012) | closed |
| L1-15 | Standing orders / الأوامر الدائمة | متوسطة | ~0.5 w (residual) | PARTIALLY SHIPPED (supplier side) + customer side → 068 | **068** |
| L1-16 | Subscription-contract billing / عقود الاشتراك | عالية | ~1.5 w (residual) | PARTIALLY SHIPPED + residual → 068 | **068** |
| L1-17 | Board-resolutions register / قرارات مجلس الإدارة | منخفضة | ~0.5 w | ASSIGNED | **058** |
| L1-18 | Corporate risk register / سجل المخاطر | متوسطة | ~1 w | ASSIGNED (already in 058 scope — ID now bound) | **058** |
| L1-19 | Contractual compliance tracking / الامتثال التعاقدي | متوسطة | ~1 w | PARTIALLY SHIPPED + residual → 058 | **058** |
| L1-20 | Returnable packaging deposits / التغليف القابل للإرجاع | متوسطة | ~1 w | ASSIGNED | **044** |
| L1-21 | Productivity: batch ops + import/export templates / أدوات الإنتاجية | متوسطة | ~1 w (split) | SPLIT: batch ops → 062 (already scoped there); import/export templates → 040 (already scoped there) | **062 + 040** |
| L1-22 | Intangible assets & amortization / الأصول غير الملموسة | عالية | ~1.5 w | ASSIGNED | **054** |
| L1-23 | EDI with major customers/suppliers / الربط الإلكتروني EDI | متوسطة | ~2 w | ASSIGNED | **055** |

**Totals:** 23 gaps → 2 SHIPPED (closed with evidence) · 6 PARTIALLY SHIPPED (residuals
planned) · 15 planned as new scope (10 into existing phases, 5 families concentrated into
the new PHASE-068). Every severity class (عالية/متوسطة/منخفضة) is represented in the
plan — per the owner's all-gaps policy (CR-41), nothing is excluded for being small.

## 2. Gap detail (one entry per gap)

Each entry: description (two lines), severity, effort, dependencies, disposition with
**code/doc evidence** where a shipped or partial-shipped claim is made.

---

### L1-01 — Deferred revenue / الإيرادات المؤجلة

Two-line description: amounts billed (or received) before the service/subscription period
is delivered currently sit as plain AR/on-account balances with no period-release schedule;
the liability must be recognized as earned across the delivery periods, not at invoice
time.
- **Severity:** عالية (HIGH) — misstates revenue timing for any subscription/service
  tenant; an IFRS-15 correctness issue, not a nice-to-have.
- **Effort:** ~1.5–2 weeks (allocation-schedule engine + postings + screens + goldens).
- **Dependencies:** posting engine (shipped) · PHASE-053 analytic dimensions · PHASE-036
  custom fields on the schedule register.
- **Disposition:** NEW PHASE → **PHASE-068** (Accrual Engine & Recurring Commerce, CR-44).
  Evidence of absence: no `deferred*`/`unearned*` table or schedule in
  `apps/api/src/db/schema.ts` (grep 2026-11-11: zero matches); the only on-account
  liability machinery is `contract_advances` (HELD → RELEASED at the releasing invoice —
  a lump release, not period allocation — schema.ts `crm` cluster, PHASE-019).

### L1-02 — Revenue recognition / الاعتراف بالإيرادات

Two-line description: no recognition-schedule substrate (recognition over time by
milestone, ratable period, or deliverable) feeding controlled revenue journals; revenue
today is recognized at invoice posting only.
- **Severity:** عالية (HIGH).
- **Effort:** ~2 weeks riding the L1-01 allocation engine (same substrate, recognition
  rules layered on it).
- **Dependencies:** L1-01 · IFRS-15 five-step alignment hooks (L2-14/L2-17 in 068).
- **Disposition:** NEW PHASE → **PHASE-068**.

### L1-03 — Prepaid expenses / النفقات المدفوعة مسبقاً

Two-line description: prepaid invoices (rent, insurance, licenses) expense in full at
invoice posting; no amortization schedule releases the expense over the coverage periods.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week (the L1-01 engine in the expense direction + supplier-invoice link).
- **Dependencies:** L1-01 engine · AP invoice machinery (shipped).
- **Disposition:** NEW PHASE → **PHASE-068**.

### L1-04 — Recurring invoices / الفواتير المتكررة

Two-line description: tenants billing the same customer the same document every period
have no generic recurring-invoice template; only service contracts generate scheduled
invoices.
- **Severity:** عالية (HIGH) — billing-automation gap that hurts service/SaaS tenants.
- **Effort:** ~1 week (template + generation job + idempotency reuse).
- **Dependencies:** the `contract_invoices` idempotency precedent (shipped) · dunning
  (039) for failed recurring collections.
- **Disposition:** PARTIALLY SHIPPED + residual → **PHASE-068**. Evidence of the shipped
  backbone: `contract_billing_schedule` + `contract_invoices` with double-fire partial
  uniques ("the two partial uniques make concurrent double-fire a constraint violation ⇒
  graceful skip" — schema.ts lines ~5026–5060, PHASE-019); `recurring_journals`
  (PHASE-007, DRAFT-only). Residual: generic recurring sales-invoice templates not tied
  to a service contract (any customer, any document mix).

### L1-05 — Monthly accruals / الاستحقاقات الشهرية

Two-line description: period-end accruals (utilities, fees, unbilled services) are manual
one-off journals; no accrual templates with auto-reversal in the following period, and no
close checklist integration.
- **Severity:** عالية (HIGH) — month-end close correctness.
- **Effort:** ~1 week (auto-reversal pairs + close integration on the shipped engine).
- **Dependencies:** `recurring_journals` (shipped) · period close (shipped) · L1-01
  engine for the amortizing variant.
- **Disposition:** PARTIALLY SHIPPED + residual → **PHASE-068**. Evidence of the shipped
  backbone: `recurring_journals` table — "Recurring journal definitions (generation
  creates DRAFTs only)" (schema.ts lines 975–991; ENTITY_CATALOG row `recurring_journals`
  phase 007); GRNI accrual posting G-07 (goods-received-not-invoiced, shipped). Residual:
  auto-reversal pairing, accrual-template taxonomy, period-close checklist wiring, and the
  approval path from DRAFT (today drafts await manual posting).

### L1-06 — Petty cash / النقدية الصغيرة — **SHIPPED, CLOSED**

Two-line description: petty-cash funds with per-transaction caps and per-fund balance
limits, disbursement through the treasury expense flow, replenishment/override discipline.
- **Disposition: SHIPPED — never re-plan** (roadmap §4). Evidence:
  - `docs/product/BUSINESS_RULES.md` **BR-020**: "Petty cash disbursements are capped
    per-transaction and per-fund-balance; exceeding either requires reimbursement or an
    accountant override" — treasury petty-cash service, permission
    `treasury.petty_cash.manage`, settings `treasury.petty_cash.single_tx_limit` /
    `treasury.petty_cash.max_balance`.
  - `docs/database/ENTITY_CATALOG.md` `cash_accounts` — "Cash/bank/petty accounts (linked
    to GL) … type (CASH/BANK/PETTY)" — phase 008, migration 0012 (schema.ts line ~1239
    header: "PHASE-008 — treasury cluster (migration 0012): cash/bank/petty accounts…").
  - Replenishment rides `cash_transfers` (account↔account) + the BR-020 cap discipline;
    the imprest cycle (disburse → replenish to float) is covered by these surfaces.
- The first-round note "partially shipped" is resolved as **fully shipped for fund
  accounting**; no residual scope is opened.

### L1-07 — Travel expenses / مصروفات السفر

Two-line description: the generic expense-claim workflow (categories, receipts, approval
thresholds) exists, but there is no travel layer — travel requests with pre-approval,
travel advances, per-diem tables, and trip settlement reconciling the advance.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week (residual layer).
- **Dependencies:** BR-023 expense workflow (shipped) · supplier-advance discipline
  (038, G-33) as the advance-accounting pattern.
- **Disposition:** PARTIALLY SHIPPED + residual → **PHASE-053**. Evidence of the shipped
  backbone: BR-023 "Expense claims route per category and amount thresholds; receipts are
  mandatory above the tenant's receipt threshold" (`docs/product/BUSINESS_RULES.md`);
  `expenses` + `expense_categories` tables with `approval_policy` (ENTITY_CATALOG, phase
  008). Residual: `travel_requests` + per-diem policy + advance issuance/settlement —
  added to PHASE-053 scope (roadmap v3.1).

### L1-08 — Mileage allowance / بدل الأميال

Two-line description: no mileage expense type computing distance × tenant rate with
odometer evidence; employee-owned-vehicle reimbursement is manual lump amounts.
- **Severity:** منخفضة (LOW) — kept in the plan per the all-gaps policy (CR-41).
- **Effort:** ~0.5 weeks (an expense category kind + rate table + distance field).
- **Dependencies:** L1-07 layer · `vehicles` registry (shipped, workshop partners-owned —
  odometer evidence source where applicable).
- **Disposition:** ASSIGNED → **PHASE-053** (rides the L1-07 travel/expense depth item).

### L1-09 — Corporate cards / بطاقات الشركات

Two-line description: company-issued cards have no program register (card accounts,
holders, limits), no statement import into per-card expense splits, and no card-charge
reconciliation against the existing bank-statement machinery.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1.5 weeks (card register + statement import reuse + split rules).
- **Dependencies:** `bank_statements`/`bank_statement_lines` import machinery (shipped) ·
  the card/gateway reconciliation item already in PHASE-053 scope (CR-23) — L1-09 extends
  it from acquiring reconciliation to the corporate-card spend program.
- **Disposition:** ASSIGNED → **PHASE-053**.

### L1-10 — Credit-limit periodic review / مراجعة حدود الائتمان الدورية

Two-line description: credit limits and blocking exist on the partner card, but review is
ad-hoc; no score class, no next-review date/reviewer, no review-due workflow.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~0.5 weeks.
- **Dependencies:** existing credit-management block (shipped with sales) · the 038
  scorecard sweep precedent (rolling-window fold over live documents).
- **Disposition:** PARTIALLY SHIPPED + residual → **PHASE-039** — the residual is
  **already scope item 6** of PHASE-039 ("Partner credit-risk fields … credit score class
  + review rules (next review date, reviewer)"); this entry binds the L1-10 ID to that
  item (roadmap v3.1). Evidence of the shipped base: partners credit-management fields +
  over-limit blocking (PHASE-012 sales); the 038 handoff note names the scorecard sweep
  as the pattern for the credit-risk surfacing.

### L1-11 — Collection-agency integration / وكالات التحصيل

Two-line description: when internal dunning exhausts, there is no handoff — agency
referral, referred-balance tracking, commission accounting, and an integration port for
agency status callbacks are all absent.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week.
- **Dependencies:** PHASE-039 dunning engine (the ladder's terminal step) · the 038
  portal-token pattern for the agency callback port.
- **Disposition:** ASSIGNED → **PHASE-039** (new scope item, CR-46; effort 2–3 → ~3
  weeks).

### L1-12 — Late-payment fees / غرامات التأخير

Two-line description: dunning letters escalate but never charge; no late-fee rule engine
(contractual/statutory rate caps per jurisdiction), no fee invoice generation with correct
tax treatment, no waiver path with reason.
- **Severity:** متوسطة (MEDIUM) — common contractual practice in GCC B2B.
- **Effort:** ~1 week.
- **Dependencies:** PHASE-039 dunning policies (fee rules attach to ladder steps) · tax
  engine for fee-invoice VAT treatment · jurisdiction packs (REQUIRES_VERIFICATION
  discipline for statutory rate caps — no fabricated rates).
- **Disposition:** ASSIGNED → **PHASE-039** (new scope item, CR-46).

### L1-13 — Signing-authority matrix / مصفوفة سلطة التوقيع

Two-line description: per-doc-type approval policies with amount thresholds exist, but
there is no structured authority matrix (role × document type × amount × currency), no
time-boxed delegation of authority, and no single screen answering "who may sign what up
to how much".
- **Severity:** عالية (HIGH) — an SoD/governance control enterprise buyers audit.
- **Effort:** ~1 week (residual).
- **Dependencies:** `approval_policies` BR-034 (shipped) · PHASE-052 workflow engine
  (amount/department branching consumes the matrix) · PHASE-058 SoD matrix + e-signature.
- **Disposition:** PARTIALLY SHIPPED + residual → **PHASE-058**. Evidence of the shipped
  backbone: `approval_policies` — "Per-doc-type approval policies (BR-034)" with doc-type
  + amount routing (schema.ts lines ~995–1007; ENTITY_CATALOG phase 007). Residual: the
  consolidated authority matrix surface, delegation with expiry, 052-engine binding, and
  e-signature authority checks — added to PHASE-058 scope (roadmap v3.1).

### L1-14 — Official customer/supplier statements / كشوف الحسابات الرسمية — **SHIPPED, CLOSED**

Two-line description: official per-partner account statements (AR and AP) recomputed from
immutable entries at the as-of date, printable in document formats with drill-down to
source documents.
- **Disposition: SHIPPED — never re-plan.** Evidence:
  - `docs/reporting/REPORT_CATALOG.md` §2: **`partner.statement`** — "Customer Statement /
    كشف حساب العميل … `arQueries.partnerStatement` … PDF (`a4-document`) · XLSX · CSV —
    PHASE-012" and **`supplier.statement`** — "Supplier Statement / كشف حساب المورد …
    PHASE-011"; catalog note: "aging and statements **recompute from immutable entries at
    the as-of date** … statement rows drill to source documents".
- Adjacent delivery channels (email/WhatsApp dispatch) ride PHASE-041 templates; stamped/
  e-signed variants ride PHASE-058 e-signature — both already-planned scope, no new gap.

### L1-15 — Standing orders / الأوامر الدائمة

Two-line description: on the purchasing side, blanket agreements with release discipline
exist; customers cannot set a standing order generating a sales document automatically
each period.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~0.5 weeks (residual; the release/idempotency pattern transfers directly).
- **Dependencies:** `blanket_orders` + release ledger (038, shipped as planned scope) ·
  the 068 recurring-generation engine.
- **Disposition:** PARTIALLY SHIPPED (supplier side) + customer side → **PHASE-068**.
  Evidence of the shipped side: `blanket_orders` — "The standing supplier agreement
  (P-03) — validity window, min/max commitment amounts, price-locked lines, and the
  `released_amount` accumulator … over-release is a typed rejection" (ENTITY_CATALOG,
  phase 038).

### L1-16 — Subscription-contract billing / عقود الاشتراك

Two-line description: service contracts with retainer/milestone/hourly fee models and a
scheduled billing grid generating invoices idempotently exist; subscription-specific
mechanics — usage-based/metered billing, price escalation clauses, renewal repricing — do
not.
- **Severity:** عالية (HIGH).
- **Effort:** ~1.5 weeks (residual).
- **Dependencies:** `service_contracts` cluster (shipped) · L1-04 recurring engine ·
  L1-01 deferred revenue for billed-before-earned recognition.
- **Disposition:** PARTIALLY SHIPPED + residual → **PHASE-068**. Evidence of the shipped
  backbone: `service_contracts` ("The CT- document … fee_model (RETAINER/MILESTONES/
  HOURLY) … RENEWED (renew creates a new contract copy)" — ENTITY_CATALOG, phase 019) +
  `contract_billing_schedule` (period/milestone uniques) + `contract_invoices`
  (idempotency guard) + `contract_advances` (HELD → RELEASED). Residual: metered/usage
  billing lines, escalation clauses, renewal pricing automation.

### L1-17 — Board-resolutions register / قرارات مجلس الإدارة

Two-line description: no register of board/shareholder resolutions with effective dates,
minute attachments, and links to the transactions they authorize (dividends, guarantees,
major CAPEX).
- **Severity:** منخفضة (LOW) — kept in the plan per the all-gaps policy (CR-41).
- **Effort:** ~0.5 weeks (a governance register + attachments + audit trail).
- **Dependencies:** PHASE-058 governance registers (audit module) · document attachment
  machinery (shipped).
- **Disposition:** ASSIGNED → **PHASE-058** (new scope item, CR-46).

### L1-18 — Corporate risk register / سجل المخاطر

Two-line description: no tenant-level corporate risk register (risk catalog, owners,
likelihood/impact, mitigations, review cycles) feeding the internal-audit module.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week.
- **Dependencies:** PHASE-058 internal-audit module (CR-28 already scopes "internal audit
  module with risk register" — this entry binds the L1-18 ID).
- **Disposition:** ASSIGNED → **PHASE-058** (already in scope; ID bound by CR-46).

### L1-19 — Contractual compliance tracking / الامتثال التعاقدي

Two-line description: contracts carry derived expiry and CRM tasks, but there is no
obligation-level compliance register (each party's obligations, due dates, penalty
exposure, renewal windows) across contract families (service, purchasing, subcontract).
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week.
- **Dependencies:** `service_contracts` expiry discipline (shipped) · 038 contract-based
  POs (shipped) · 048 subcontractor agreements (planned) · PHASE-058 registers.
- **Disposition:** PARTIALLY SHIPPED + residual → **PHASE-058**. Evidence of the shipped
  base: "expiry is derived (isExpired in reads — no state-flip job)" on
  `service_contracts` (ENTITY_CATALOG, phase 019) + `crm_tasks` reminder sweep. Residual:
  the obligation register — added to PHASE-058 scope (roadmap v3.1).

### L1-20 — Returnable packaging deposits / التغليف القابل للإرجاع

Two-line description: pallets/containers/crates loaned to customers against deposits have
no tracking (issue, return, damage) and no deposit liability posting that releases on
return.
- **Severity:** متوسطة (MEDIUM) — routine in GCC distribution.
- **Effort:** ~1 week (deposit item handling + liability postings + container movement
  tracking).
- **Dependencies:** PHASE-044 bin/LPN machinery (container tracking) · posting engine ·
  sales delivery machinery (shipped).
- **Disposition:** ASSIGNED → **PHASE-044** (new scope item, CR-46; the deposit
  accounting rides the engine — issue posts a deposit liability, return releases it,
  damage writes it off).

### L1-21 — Productivity: batch operations + import/export templates / أدوات الإنتاجية

Two-line description: power users lack bulk operations (mass post/void/print/retag with
per-row permission re-checks) and reusable import/export templates (saved column maps for
both directions).
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week total (split across two already-planned surfaces).
- **Dependencies:** PHASE-062 bulk-actions engine · PHASE-040 import toolkit.
- **Disposition:** SPLIT, both halves already planned — IDs bound by CR-46:
  - **Batch operations → PHASE-062**: scope already contains "bulk actions … execution
    runs server-side as `bulk_operations` jobs with live progress … per-row permission
    re-check — no bulk privilege escalation" (PHASE-062.md §2/§4; the `bulk_operations`
    table). L1-21 binds to it.
  - **Import/export templates → PHASE-040**: scope item 3 already delivers **saved
    mappings** (`import_mappings` — "tenant-scoped named column maps reusable across
    files"); roadmap v3.1 extends the item explicitly to **export-side templates**
    (saved export column/format maps) so the L1-21 "templates" half is closed on both
    directions.

### L1-22 — Intangible assets & amortization / الأصول غير الملموسة

Two-line description: the fixed-assets module handles tangible assets with depreciation;
intangibles (software, licences, trademarks, capitalized development) have no asset class,
no amortization method, and no impairment interface.
- **Severity:** عالية (HIGH) — IFRS balance-sheet correctness.
- **Effort:** ~1.5 weeks (asset-class extension + amortization schedules + impairment
  interface stub).
- **Dependencies:** PHASE-026 fixed assets (shipped) · the FA-F→054 precedent (roadmap
  §6.2: F-10/F-14/F-15 extensions live in 054) · PHASE-066 L2-13 impairment (consumes the
  register).
- **Disposition:** ASSIGNED → **PHASE-054** (new scope item, CR-46; effort 5–7 → 6–8
  weeks). Evidence of absence: no `asset_class`/`intangible` concept in schema.ts or
  ENTITY_CATALOG (grep 2026-11-11: zero matches).

### L1-23 — EDI with major customers/suppliers / الربط الإلكتروني EDI

Two-line description: no EDI capability (X12 / EDIFACT document translation, partner
interchange agreements, 997/CONTRL acknowledgements) for the large accounts that demand
machine-to-machine ordering and invoicing.
- **Severity:** متوسطة (MEDIUM) — enterprise-account requirement.
- **Effort:** ~2 weeks (a translation-adapter family + interchange register + ack flows).
- **Dependencies:** PHASE-055 integration platform (API keys, webhooks, iPaaS substrate)
  · sales/purchasing document contracts (shipped).
- **Disposition:** ASSIGNED → **PHASE-055** (new scope item, CR-46; effort 3–4 → 4–5
  weeks). Evidence of absence: no EDI/EDIFACT/X12 code in `apps/api/src` (grep
  2026-11-11: zero matches).

---

## 3. What this layer does NOT reopen

Per roadmap §4 (never re-plan): petty-cash fund accounting (L1-06) and official partner
statements (L1-14) are closed as SHIPPED with the evidence cited above. The partial-shipped
entries (L1-04/05/07/10/13/15/16/19/21) open **residual scope only** — the shipped
backbones listed in each entry are treated as fixed prerequisites, never re-implemented.

## 4. Change protocol

Any change to a disposition in this file requires a new CR entry in
[../COMPLETENESS_REGISTER.md](../COMPLETENESS_REGISTER.md) citing code/doc evidence —
the same standard this file applies (CR-47).
