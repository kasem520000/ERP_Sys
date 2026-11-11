# Gap Analysis — Layer 2: Advanced IFRS/IAS Compliance Gaps (L2-01…L2-20)

> **Status:** ACCEPTED — CONSOLIDATED INTO THE PLAN (roadmap v3.1 · CR-41/CR-42/CR-43/CR-45) · **Owner:** Product Owner · **Date:** 2026-11-11
> **Origin:** the second and third owner-directed audit rounds (post-`a249b1e`), performed
> outside the repository in prior working sessions — persisted here per the
> no-conversation-memory rule (CR-47). None of these 20 advanced-accounting concepts
> appears in the three first-round audit reports or in any pre-v3.1 planning document
> (verified: zero matches for IAS 24 / IAS 20 / IFRS 5 / IAS 40 / IFRS 3 / IFRS 2 /
> IAS 19 / IAS 29 / IAS 37 / IAS 36 / IFRS 15 contract balances / IFRS 10 / XBRL /
> impairment / hyperinflation / share-based / defined benefit / provisions across
> `docs/planning/`; the only pre-existing IFRS reference is **IFRS-16 leases** inside the
> fixed-assets family, FA-F-15 → PHASE-054 — untouched by this file).
> **Companion file:** [GAP_ANALYSIS_LAYER1_23_GAPS.md](GAP_ANALYSIS_LAYER1_23_GAPS.md) (L1-01…L1-23).

---

## 0. الملخص التنفيذي بالعربية

توثّق هذه الطبقة **الفجوات العشرين** في المعايير المحاسبية الدولية المتقدمة
(IAS/IFRS) التي لا تغطيها المراحل 035–065 إطلاقاً. الدمج تم عبر: **مرحلتين جديدتين**
— **PHASE-066** (الامتثال المتقدم الأول: القياسات والمخصصات — L2-01…05، L2-11،
L2-13، L2-19) و**PHASE-067** (الامتثال المتقدم الثاني: الأعمال والملكية والإفصاح —
L2-06…10، L2-16، L2-18) — و**ثلاث حالات خاصة** تُغلق داخل مراحل قائمة بقرار مبكر
موثق لأنها تبعيات مبكرة: **L2-12** (التكلفة المعيارية) ضُمّت لنطاق **PHASE-042**
قبل بدء التصنيع، و**L2-15** (الفوترة على مراحل المشاريع) و**L2-20** (التعاقد من
الباطن) تُغلقان داخل **PHASE-048** (نطاقهما موجود أصلاً)، و**L2-14/L2-17** (أصول/
التزامات العقود) وُضعَتا في **PHASE-068** الجديدة لأنهما تبنيان مباشرة على محرك
جداول الاعتراف/الإيراد المؤجل فيها. لا تُستبعد أي فجوة بسبب شدتها (سياسة CR-41).

**قاعدة الأمانة المحاسبية الحاكمة:** كل قاعدة قياس/معدل في هذه الطبقة تخضع لنظام
`REQUIRES_VERIFICATION` المعمول به في حزم الامتثال (BR-055/DR-005 سابقاً في
الرواتب): **لا معدلات ولا افتراضات مُختلَقة** — الأطر المعيارية تُبنى من النصوص
المعتمدة، والولايات غير الموثقة تعمل في وضع "ورقة عمل" وترفض الترحيل.

## 1. Triage outcome (one disposition per gap)

| ID | Gap (EN / AR) | Standard | Severity | Effort | Disposition | Home |
|---|---|---|---|---|---|---|
| L2-01 | Related-party relationships & disclosures / الأطراف ذات العلاقة والإفصاح | IAS 24 | عالية | ~1 w | NEW PHASE | **066** |
| L2-02 | Government grants / المنح الحكومية | IAS 20 | متوسطة | ~1 w | NEW PHASE | **066** |
| L2-03 | Non-current assets held for sale & discontinued operations / الأصول المحتفظ بها للبيع | IFRS 5 | متوسطة | ~1 w | NEW PHASE | **066** |
| L2-04 | Investment property / العقارات الاستثمارية | IAS 40 | منخفضة | ~0.5–1 w | NEW PHASE | **066** |
| L2-05 | Goodwill recognition & measurement / الشهرة | IFRS 3 | متوسطة | ~1 w | NEW PHASE | **066** (annual-test machinery; balances arrive with 067) |
| L2-06 | Business combinations / اندماج الأعمال | IFRS 3 | متوسطة | ~1.5 w | NEW PHASE | **067** |
| L2-07 | Share-based payments / المدفوعات على أساس الأسهم | IFRS 2 | منخفضة | ~1 w | NEW PHASE | **067** |
| L2-08 | Defined-benefit employee benefits / مزايا الموظفين المحددة | IAS 19 | متوسطة | ~1.5 w | NEW PHASE | **067** |
| L2-09 | Actuarial assumptions & remeasurement / الافتراضات الاكتوارية | IAS 19 | متوسطة | ~1 w (rides L2-08) | NEW PHASE | **067** |
| L2-10 | Hyperinflationary-economy accounting / المحاسبة في اقتصادات التضخم المفرط | IAS 29 | منخفضة | ~1 w | NEW PHASE | **067** |
| L2-11 | Provisions & contingencies / المخصصات والأحداث الطارئة | IAS 37 | عالية | ~1.5 w | NEW PHASE | **066** |
| L2-12 | Standard costing & variance analysis / التكلفة المعيارية وانحرافاتها | — (management accounting) | عالية | ~2 w | ASSIGNED — **decided now, pre-042** (CR-45) | **042** (+043 consumes) |
| L2-13 | Impairment of assets / إضمحلال الأصول | IAS 36 | عالية | ~1.5 w | NEW PHASE | **066** |
| L2-14 | Contract assets (recognized > billed) / أصول العقود | IFRS 15 | متوسطة | ~1 w | ASSIGNED (dependency-driven, CR-45) | **068** |
| L2-15 | Milestone/progress billing alignment / الفوترة على مراحل المشاريع | IFRS 15 | متوسطة | ~0.5 w (alignment) | COVERED BY PLAN — ID bound (CR-45) | **048** |
| L2-16 | Non-controlling interests / الحصص غير المسيطرة | IFRS 10/IFRS 3 | منخفضة | ~1 w | NEW PHASE | **067** |
| L2-17 | Contract liabilities & remaining performance obligations / التزامات العقود والإيراد المتبقي غير المنفذ | IFRS 15 | متوسطة | ~1 w | ASSIGNED (dependency-driven, CR-45) | **068** |
| L2-18 | XBRL-tagged statutory reporting / تقارير XBRL | — | متوسطة | ~1.5 w | NEW PHASE | **067** |
| L2-19 | Going-concern assessment & disclosure / افتراض الاستمرارية | IAS 1 | متوسطة | ~0.5 w | NEW PHASE | **066** |
| L2-20 | Subcontracting accounting / التعاقد من الباطن | — | متوسطة | ~0 (already planned) | COVERED BY PLAN — ID bound (CR-45) | **048** (+043 tolling) |

**Totals:** 20 gaps → 15 into the two new IFRS phases (066: 8 · 067: 7) · 2 dependency-
driven into 068 (L2-14, L2-17) · 2 bound to existing PHASE-048 scope (L2-15, L2-20) · 1
early-binding decision into PHASE-042 (L2-12 — mandated by the owner to be decided before
042/043 start; CR-45 records it).

## 2. Gap detail (one entry per gap)

---

### L2-01 — Related-party relationships & disclosures / الأطراف ذات العلاقة (IAS 24)

Two-line description: no related-party registry (ownership/control/family/KMP
relationships) and no periodic related-party transaction disclosure report; only
transfer-pricing data extracts (X-13, 054) exist as a partial neighbor.
- **Severity:** عالية (HIGH) — mandatory IFRS disclosure; also feeds TP files.
- **Effort:** ~1 week (registry + relationship graph + disclosure report contract).
- **Dependencies:** PHASE-054 TP extracts (X-13) as the transaction-side feed ·
  PHASE-068 schedules for intercompany deferrals on RP trades.
- **Disposition:** NEW PHASE → **PHASE-066** (scope item 1).

### L2-02 — Government grants / المنح الحكومية (IAS 20)

Two-line description: no grant register (grant, conditions, vesting period) and no
recognition mechanics (deferred-income amortization vs deduction-from-asset), including
the Saudization-type employment subsidy family common in KSA.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week (register + the two recognition methods + condition tracking).
- **Dependencies:** PHASE-068 deferred-income engine (the grant amortization rides it) ·
  payroll data for employment-linked grants.
- **Disposition:** NEW PHASE → **PHASE-066**.

### L2-03 — Non-current assets held for sale & discontinued operations / الأصول المحتفظ بها للبيع (IFRS 5)

Two-line description: no held-for-sale classification (sale-active + likely-within-a-year
criteria), no measurement-to-carrying-value-minus-costs-to-sell, no discontinued-operations
presentation split in the income statement.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week (status + remeasurement + statement presentation).
- **Dependencies:** PHASE-026 fixed assets (shipped) · PHASE-054 intangibles (L1-22) —
  HFS applies to both asset families · statement rendering (shipped).
- **Disposition:** NEW PHASE → **PHASE-066**.

### L2-04 — Investment property / العقارات الاستثمارية (IAS 40)

Two-line description: no investment-property asset class with the fair-value/cost-model
choice and the disclosure pack (revaluations, rental income); today every property is
either fixed asset or nothing.
- **Severity:** منخفضة (LOW) — niche but in-plan per CR-41.
- **Effort:** ~0.5–1 week (asset-class flag + model election + disclosures).
- **Dependencies:** PHASE-026 fixed assets · L2-13 impairment interface · revaluation
  machinery (PHASE-026 shipped revaluation).
- **Disposition:** NEW PHASE → **PHASE-066**.

### L2-05 — Goodwill recognition & measurement / الشهرة (IFRS 3)

Two-line description: no goodwill register with allocation to CGUs and the annual
impairment-test discipline (no amortization, test-only); balances can only arise once
business combinations (067) exist, but the measurement/testing machinery belongs with the
impairment family.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week (register + CGU allocation + annual-test workflow).
- **Dependencies:** L2-13 impairment engine (same phase) · PHASE-067 L2-06 combinations
  (the balances source — sequenced note: 066 ships the machinery; goodwill balances
  populate when 067 records combinations).
- **Disposition:** NEW PHASE → **PHASE-066** (machinery) with the 067 sequencing note.

### L2-06 — Business combinations / اندماج الأعمال (IFRS 3)

Two-line description: no acquisition-transaction accounting — purchase-price allocation
(identifiable assets/liabilities at fair value), goodwill/non-goodwill split, contingent
consideration, and the acquirer's consolidation entry into the PHASE-034 machinery.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1.5 weeks (PPA worksheet + journal bridge to consolidation).
- **Dependencies:** PHASE-034 consolidation (shipped) · fair-value inputs (manual with
  sources — REQUIRES_VERIFICATION) · L2-16 NCI (same phase).
- **Disposition:** NEW PHASE → **PHASE-067**.

### L2-07 — Share-based payments / المدفوعات على أساس الأسهم (IFRS 2)

Two-line description: no equity-settled/cash-settled SBP plans (grants, vesting
conditions, fair value at grant, expense recognition over the vesting period) and no
forfeiture/dilution reporting.
- **Severity:** منخفضة (LOW) — rare for SME tenants, in-plan per CR-41.
- **Effort:** ~1 week (plan register + vesting schedule engine + journals).
- **Dependencies:** PHASE-068 recognition-schedule engine (the vesting recognition rides
  it) · payroll data for employee grants.
- **Disposition:** NEW PHASE → **PHASE-067**.

### L2-08 — Defined-benefit employee benefits / مزايا الموظفين المحددة (IAS 19)

Two-line description: end-of-service and pension plans are computed per local payroll
rules (029/046) but there is no DB-plan accounting layer — net defined-benefit
liability, service/interest components in P&L, remeasurements in OCI-style equity
reserve.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1.5 weeks (plan register + component split + remeasurement reserve).
- **Dependencies:** PHASE-029 payroll EOS machinery (shipped) · PHASE-046 payroll
  compliance · L2-09 actuarial engine.
- **Disposition:** NEW PHASE → **PHASE-067**.

### L2-09 — Actuarial assumptions & remeasurement / الافتراضات الاكتوارية (IAS 19)

Two-line description: no actuarial-assumption register (discount rate, salary growth,
mortality/turnover) with sensitivity analysis and a documented remeasurement run into the
L2-08 reserve.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week riding L2-08 (assumption versioning + sensitivity + run history).
- **Dependencies:** L2-08 · disclosure report contracts.
- **Disposition:** NEW PHASE → **PHASE-067**.

### L2-10 — Hyperinflationary-economy accounting / المحاسبة في اقتصادات التضخم المفرط (IAS 29)

Two-line description: no hyperinflation restatement mode (index-based restatement of the
historical-cost statements + gain/loss on net monetary position) for group entities
operating in a hyperinflationary economy.
- **Severity:** منخفضة (LOW) — no currently served market is designated
  hyperinflationary; kept in-plan per CR-41 as a preparedness capability.
- **Effort:** ~1 week (index series register + restatement run + monetary gain/loss).
- **Dependencies:** PHASE-034 consolidation FX machinery (the restatement is a sibling of
  translation) · jurisdiction designation rule (REQUIRES_VERIFICATION — no tenant country
  is flagged without a verified official designation).
- **Disposition:** NEW PHASE → **PHASE-067**.

### L2-11 — Provisions & contingencies / المخصصات والأحداث الطارئة (IAS 37)

Two-line description: no provision register (present obligation, probable outflow,
reliable estimate) with measurement and release/use tracking, and no contingency
disclosure (possible obligations); warranty provisions today are implicit, not registered.
- **Severity:** عالية (HIGH) — liability-side correctness (warranties, litigation,
  onerous contracts, restructuring).
- **Effort:** ~1.5 weeks (register + provision-type taxonomy + movements + disclosure).
- **Dependencies:** PHASE-039 warranties (shipped as planned scope — the provision layer
  formalizes warranty liability) · PHASE-068 schedules for time-based release · 066's
  own L2-13 (same estimate family).
- **Disposition:** NEW PHASE → **PHASE-066**.

### L2-12 — Standard costing & variance analysis / التكلفة المعيارية وانحرافاتها

Two-line description: work-center rates and operation variance records are planned in
042, but the item-level standard-cost layer is not: standard cost types, cost roll-up
over BOM + routing, standard freeze/activation, purchase-price-variance posting at
receipt, and stock revaluation at standard change.
- **Severity:** عالية (HIGH) — the manufacturing valuation backbone; without it, MRP
  (043) plans against unstable actual costs.
- **Effort:** ~2 weeks.
- **Dependencies:** PHASE-042 routings/work centers/rates (same phase — this is why the
  decision was made **before** 042 starts, per the owner's mandate) · PHASE-043 consumes
  the frozen standards for planning costing · G-13/G-14 adjustment shapes (shipped).
- **Disposition:** ASSIGNED → **PHASE-042** (new scope item, CR-45; effort 4–6 → 5–7
  weeks). The decision record: including standard costing in 043 would have coupled the
  planning engine to an unshipped costing substrate; including it in 042 keeps "Routing,
  Work Centers & Costing" (its literal title) self-contained and hands 043 a frozen
  standard to plan against. Evidence of the current boundary: PHASE-042.md scope items
  4–5 deliver actual operation costing + variance records only; no item-standard or
  roll-up concept exists in the repo (grep 2026-11-11: no `standard_cost` matches).

### L2-13 — Impairment of assets / إضمحلال الأصول (IAS 36)

Two-line description: no impairment machinery — indicators checklist, CGU definition and
allocation, recoverable-amount computation (higher of fair-value-less-costs and
value-in-use), impairment loss posting and reversal discipline.
- **Severity:** عالية (HIGH).
- **Effort:** ~1.5 weeks (CGU register + test workflow + loss/reversal journals).
- **Dependencies:** PHASE-026 fixed assets (shipped) · PHASE-054 intangibles (L1-22) ·
  L2-05 goodwill (same phase) · cash-flow projections from PHASE-053 forecasting.
- **Disposition:** NEW PHASE → **PHASE-066**.

### L2-14 — Contract assets / أصول العقود (IFRS 15)

Two-line description: revenue recognized ahead of billing (unbilled revenue — typically
progress contracting) has no contract-asset register with presentation and
impairment/credit-loss interface; today only 048's progress certificates exist on the
billing side.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week (contract-balance derivation + presentation + disclosure).
- **Dependencies:** PHASE-068 recognition schedules (L1-02 — the recognition>billed
  delta is computed there) · PHASE-048 progress certificates (the billing side) ·
  L2-13 impairment interface.
- **Disposition:** ASSIGNED → **PHASE-068** (dependency-driven: it rides the L1-01/02
  substrate; CR-45 records the distribution decision).

### L2-15 — Milestone/progress billing on projects / الفوترة على مراحل المشاريع (IFRS 15)

Two-line description: progress-certificated billing with retention and advance
amortization is already fully scoped in PHASE-048 (PR-11/PR-08, G-58) — what was missing
is only the IFRS-15 alignment (output-method consistency between certificates and
recognition).
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~0.5 weeks (alignment note + consistency rule between 048 certificates and
  068 recognition — an interface spec, not a rebuild).
- **Dependencies:** PHASE-048 (owner) · PHASE-068 L1-02 recognition (the consistency
  rule binds them).
- **Disposition:** COVERED BY PLAN → **PHASE-048** — the L2-15 ID is bound to 048 scope
  item 9 with the alignment note added (CR-45).

### L2-16 — Non-controlling interests / الحصص غير المسيطرة (IFRS 10/IFRS 3)

Two-line description: consolidation (034) nets member books at 100% with no ownership
split; NCI presentation (equity split, NCI share of P&L and OCI-style items, partial
goodwill allocation) is absent.
- **Severity:** منخفضة (LOW) — applies only to less-than-100% group structures.
- **Effort:** ~1 week (ownership-percent register per entity + split presentation).
- **Dependencies:** PHASE-034 consolidation (shipped — the ownership layer is additive) ·
  L2-06 combinations (same phase).
- **Disposition:** NEW PHASE → **PHASE-067**.

### L2-17 — Contract liabilities & remaining performance obligations / التزامات العقود والإيراد المتبقي غير المنفذ (IFRS 15)

Two-line description: billed-but-unearned amounts need the contract-liability
presentation feeding directly from the deferred-revenue schedules, plus the RPO
disclosure (transaction price allocated to unsatisfied performance obligations, expected
timing).
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1 week (derivation + disclosure contract).
- **Dependencies:** PHASE-068 L1-01 deferred-revenue engine (the direct substrate) ·
  L2-14 (the mirror balance).
- **Disposition:** ASSIGNED → **PHASE-068** (dependency-driven, CR-45).

### L2-18 — XBRL-tagged statutory reporting / تقارير XBRL

Two-line description: statutory financial statements cannot be exported as XBRL
(taxonomy mapping, tagged facts, validation) — increasingly demanded for regulator
filing (e.g., ZATCA Zakat/IR filers moving to structured data).
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~1.5 weeks (taxonomy mapping layer + fact tagging over the statement
  engine + validation report).
- **Dependencies:** statement engine (shipped, PHASE-013) · PHASE-054 SAF-T export (the
  export-wizard precedent) · PHASE-057 reporting surfaces.
- **Disposition:** NEW PHASE → **PHASE-067**.

### L2-19 — Going-concern assessment & disclosure / افتراض الاستمرارية (IAS 1)

Two-line description: no structured going-concern assessment at period close
(indicator checklist, management evaluation record, material-uncertainty disclosure
drafting) tied to the risk register.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~0.5 weeks (assessment template + close integration + disclosure).
- **Dependencies:** PHASE-058 risk register (L1-18) · period close (shipped) ·
  PHASE-053 cash-flow forecasting (the financial evidence source).
- **Disposition:** NEW PHASE → **PHASE-066**.

### L2-20 — Subcontracting accounting / التعاقد من الباطن

Two-line description: subcontractor agreements/certificates/retention are already fully
scoped in PHASE-048 (PR-06), and manufacturing tolling in PHASE-043 (M-21, contract
manufacturing) — the gap reduces to binding the ID and documenting the
inbound-subcontract purchase linkage.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~0 (already planned; the linkage note is documentation).
- **Dependencies:** PHASE-048 PR-06 (owner) · PHASE-043 M-21 tolling.
- **Disposition:** COVERED BY PLAN → **PHASE-048** — L2-20 bound to 048 scope item 7
  with the inbound-subcontract PO linkage note; 043's M-21 covers the tolling side
  (CR-45).

---

## 3. Sequencing decisions recorded (why these homes)

1. **L2-12 → 042 (not 043):** decided pre-042 per the owner's mandate. 042's literal
   title is "Routing, Work Centers & **Costing**" and its variance machinery (M-13/M-18/
   M-19) is the consumer; shipping item standards + roll-up in 042 hands 043 a frozen
   standard for planning. The alternative (043) would couple MRP to an unshipped costing
   substrate (CR-45).
2. **L2-14/L2-17 → 068 (not 066/067):** both balances derive mechanically from the
   recognition/deferral schedules that 068 itself ships — placing them in the IFRS
   phases would split one substrate across three phases (CR-45).
3. **L2-15/L2-20 → 048:** both were already inside 048's scoped items (9 and 7); the
   consolidation binds IDs and adds alignment notes rather than inventing parallel
   scope (CR-45).
4. **066 before 067:** the estimate/provision/impairment machinery (066, Wave 3 after
   053) is consumed by the transaction-heavy ownership phase (067, Wave 4 after 054);
   goodwill machinery (066) ships ahead of the combination balances (067) by design.

## 4. Change protocol

Any change to a disposition requires a new CR entry in
[../COMPLETENESS_REGISTER.md](../COMPLETENESS_REGISTER.md) with code/doc evidence
(CR-47).
