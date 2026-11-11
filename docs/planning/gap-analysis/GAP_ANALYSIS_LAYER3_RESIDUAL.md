# Gap Analysis — Layer 3: The Residual 15 (R-01…R-15) — Owner's Final Sweep

> **Status:** ACCEPTED — OWNER DECISIONS FINAL (roadmap v3.2 · CR-49/CR-50/CR-51/CR-52) · **Owner:** Product Owner · **Date:** 2026-11-11
> **Origin:** the owner's final independent review of the consolidated v3.1 plan against
> the standards and domains that entered **no previous audit round** — performed in the
> owner's directive of 2026-11-11 (preserved verbatim-in-substance as
> [../../implementation/GAP_LAYER3_DIRECTIVE.md](../../implementation/GAP_LAYER3_DIRECTIVE.md)).
> The review found the functional and commercial coverage comprehensive, with exactly
> **15 residual items** (11 standards/functional + 4 UX/productivity) absent from any
> phase. The owner resolved every one of them **by final decision in the same message** —
> this file records those decisions as received (per CR-47: identifier + severity +
> effort + phase home in the same commit; no re-proposal, no awaiting further approval).
> **Companion files:** [GAP_ANALYSIS_LAYER1_23_GAPS.md](GAP_ANALYSIS_LAYER1_23_GAPS.md)
> (L1-01…L1-23) · [GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md)
> (L2-01…L2-20).

---

## 0. الملخص التنفيذي بالعربية

هذا الملف يوثّق **البنود الـ15 المتبقية** التي كشفها الفحص الختامي المستقل للمالك
لمخطط v3.1 — بنود لم تدخل أي جولة تدقيق سابقة ولا أي مرحلة من مراحل الخطة. **قرارات
المالك كلها نهائية وواردة نصاً في التوجيه** (محفوظ في
`docs/implementation/GAP_LAYER3_DIRECTIVE.md`) ولا تحتاج موافقة إضافية: **11 بنداً**
تُضاف الآن لنطاق مراحلها (R-01…R-05، R-07، R-10، R-12…R-15)، وبندان يُربطان بمعرّفهما
فقط لأن التغطية موجودة أصلاً (R-06 مشمول بالتصميم عبر محرك الفترات الاعتباطية،
وR-08 مشمول بنطاق 062 القائم على المستندات)، وبندان **non-goal بقرار مالك موثق**
(R-09 مُهيئ المنتجات وR-11 الأصول البيولوجية). **R-03 وحدها تؤثر على النطاق الفوري**
— مرتجعات الموردين ضُمّت لنطاق PHASE-039 قبل كتابة أي كود، فينتقل تقديرها من ~3 إلى
~4 أسابيع. الإضافة الكلية الصادقة: **+11–12 أسبوعاً** (CR-52).

## 1. Triage outcome (one disposition per gap — all final owner decisions)

| ID | Gap (EN / AR) | Severity | Effort | Disposition | Home |
|---|---|---|---|---|---|
| R-01 | Expected credit loss allowance (IFRS 9) / مخصص الخسائر الائتمانية المتوقعة | عالية | ~1.5 w | ADDED — the strongest remaining accounting gap | **066** |
| R-02 | Dual-book accounting (local Zakat ↔ IFRS) / الدفاتر المزدوجة | عالية | ~2–3 w | ADDED — a recognized Saudi/Gulf requirement | **053** |
| R-03 | Supplier RMA (return-to-vendor) / مرتجعات الموردين | عالية (mandatory pre-039) | ~1 w | ADDED — decided before any 039 code is written | **039** |
| R-04 | Borrowing costs capitalization (IAS 23) / تكاليف الاقتراض | منخفضة | ~0.5 w | ADDED | **048** |
| R-05 | Earnings per share (IAS 33) / ربحية السهم | منخفضة | ~0.5 w | ADDED | **054** |
| R-06 | Interim reporting (IAS 34) / التقارير المرحلية | — | ~0 (documentation) | **SHIPPED-BY-DESIGN** — arbitrary-period reporting already exists; ID bound to evidence below | closed (binding) |
| R-07 | Intercompany trade (auto-matched PO↔SO + clearance) / التداول بين الشركات | متوسطة | ~2 w | ADDED — the natural completion of consolidation & charged eliminations | **053** |
| R-08 | Central document management (DMS) / إدارة مستندات مركزية | — | 0 | **COVERED BY PLAN** — 062 already scopes "ECM-style document folders/versions"; ID bound | **062** |
| R-09 | Product configurator (CTO/CPQ) / مُهيئ المنتجات | — | — | **NON-GOAL** (owner decision — §3 below) | never planned |
| R-10 | Fleet depth (documents + odometer, light) / عمق الأسطول — نسخة خفيفة | متوسطة | ~0.5 w | ADDED (light version only — vehicle document expiry + odometer inside CMMS; full fuel/violations = sectoral non-goal) | **049** |
| R-11 | Biological assets at fair value (IAS 41) / الأصول البيولوجية | — | — | **NON-GOAL** (owner decision — §3 below) | never planned |
| R-12 | Calendar view (invoices/aging/visits/leaves) / عرض تقويمي | منخفضة | ~0.5 w | ADDED | **062** |
| R-13 | Route & customer maps / خرائط المسارات والعملاء | متوسطة | ~1 w | ADDED (serves field-sales distribution 017/060) | **062** |
| R-14 | Paste from Excel inside line grids / اللصق من Excel | عالية (most-requested ERP productivity feature per the owner) | ~1 w | ADDED | **062** |
| R-15 | Invoice-by-email (forward → OCR → AP draft) / فاتورة بالبريد | متوسطة | ~0.5 w | ADDED | **064** |

**Totals:** 15 items → **11 scope additions** (R-01…R-05, R-07, R-10, R-12…R-15 — every
one with a severity, an effort, and a phase home) · **1 covered-by-plan ID binding**
(R-08 → 062) · **1 shipped-by-design ID binding** (R-06) · **2 owner non-goals**
(R-09, R-11 — recorded with justification in §3). The effort sum of the additions is
**+11–12 weeks** (CR-52's honest re-estimate). No item is excluded for being small
(CR-41); the only exclusions are the two documented owner non-goals.

## 2. Gap detail (one entry per gap)

---

### R-01 — Expected credit loss allowance / مخصص الخسائر الائتمانية المتوقعة (IFRS 9)

Two-line description: AR is carried at gross with no expected-loss allowance; IFRS 9's
simplified approach (provision matrix over aging buckets) must generate the ECL
allowance for receivables with a periodic posting through the engine.
- **Severity:** عالية (HIGH) — per the owner: the strongest remaining accounting gap.
- **Effort:** ~1.5 weeks (matrix register + aging×rate computation + periodic posting
  + report).
- **Dependencies:** the `ar.aging` machinery (shipped) · PHASE-066's measurement family
  (rides the same REQUIRES_VERIFICATION discipline) · posting engine (shipped).
- **Disposition (owner, final):** ADDED → **PHASE-066** (scope item 10; CR-50). Loss
  rates are tenant-configured **with source evidence or the run refuses to post**
  (worksheet mode — no fabricated rates, the BR-055/DR-005 lineage).

### R-02 — Dual-book accounting (local Zakat ↔ IFRS) / الدفاتر المزدوجة

Two-line description: a second base layer for tenants reporting both a local Zakat
base and IFRS: **book-tagged reconciliation entries** (قيود تسوية موسومة بالكتاب) and
**dual reporting** rendering each book's statement set from the same journal substrate.
- **Severity:** عالية (HIGH) — a recognized Saudi/Gulf requirement per the owner.
- **Effort:** ~2–3 weeks (book tag + reconciliation-entry workflow + dual statement
  rendering + disclosure split).
- **Dependencies:** PHASE-053's own analytic-dimension storage (item 1) and statement
  machinery · the posting engine's extension gate (CD-01). This **resolves the v3.0
  "deferred decision" on duplicate statutory/management ledgers** recorded in
  PHASE-053 item 4 — the owner's decision is now: dual-book ships, as a
  reconciliation-entries layer (not a parallel ledger copy).
- **Disposition (owner, final):** ADDED → **PHASE-053** (scope item 17; CR-50).

### R-03 — Supplier RMA (return-to-vendor) / مرتجعات الموردين

Two-line description: the customer-side RMA has no purchasing mirror — a return
authorization to the supplier (approve → ship back) must auto-generate the **debit
note through the posting engine** (the AP counterpart of the customer credit note),
with inventory issue legs posting atomically.
- **Severity:** عالية (HIGH) — the owner mandated deciding it **before any 039 code is
  written** ("إلزامية قبل كتابة كود 039").
- **Effort:** ~1 week (supplier RMA tables + lifecycle + debit-note golden + screens).
- **Dependencies:** PHASE-039's own RMA state machine (the mirrored lifecycle) · the
  posting engine · purchasing receipts (shipped).
- **Disposition (owner, final):** ADDED → **PHASE-039** (scope item 13; CR-50) — the
  039 estimate moves from ~3 to **~4 weeks**. This **reverses 039's earlier
  "supplier-side return orders out of scope" line** — the owner's decision supersedes
  it in the same document.

### R-04 — Borrowing costs capitalization / تكاليف الاقتراض (IAS 23)

Two-line description: financing costs on qualifying construction assets are expensed
today; IAS 23 requires capitalizing them over the construction window at a
capitalization rate (weighted average of borrowings).
- **Severity:** منخفضة (LOW).
- **Effort:** ~0.5 weeks (rate register + window logic + posting rule).
- **Dependencies:** PHASE-048's WBS schedule (the construction window source) · the
  posting engine.
- **Disposition (owner, final):** ADDED → **PHASE-048** (scope item 12; CR-50).

### R-05 — Earnings per share / ربحية السهم (IAS 33)

Two-line description: no basic/diluted EPS computation exists; the statutory income
statement needs the EPS lines computed from weighted-average shares and dilutive
instruments.
- **Severity:** منخفضة (LOW).
- **Effort:** ~0.5 weeks (weighted-average computation + statement lines + disclosure).
- **Dependencies:** the statement machinery (shipped) · equity/share registers ·
  PHASE-067's instruments where dilutives exist (interface-only here).
- **Disposition (owner, final):** ADDED → **PHASE-054** (scope item 14; CR-50) —
  corporate/statutory reporting is 054's territory.

### R-06 — Interim reporting / التقارير المرحلية (IAS 34) — SHIPPED-BY-DESIGN

Two-line description: IAS 34 requires interim financial reporting over arbitrary
periods — the platform already renders every report over arbitrary date ranges by
design, so the gap is documentation-only: bind the ID to the existing evidence.
- **Severity:** — (no implementation gap).
- **Effort:** ~0 (this binding entry + the roadmap §4 exclusion row).
- **Evidence of the by-design coverage:** the reporting contract accepts arbitrary
  `dateFrom`/`dateTo` on every run (`apps/api/src/modules/reporting/application/
  contract.ts` lines 154–155 — any period, not just closed fiscal periods) and the
  statement contracts (`gl.income-statement`, `gl.balance-sheet`, `gl.trial-balance`
  et al. in `docs/reporting/REPORT_CATALOG.md` §2) render over those ranges; the
  fiscal-periods register (`fiscal_periods`, schema.ts line 888) supplies the calendar
  view beside them.
- **Disposition (owner, final):** **SHIPPED-BY-DESIGN — never planned** (CR-50; roadmap
  §4 row). If a tenant needs formal interim-statement presentation rules (condensed
  disclosure packs), that is 066/067 disclosure territory, not a period-engine gap.

### R-07 — Intercompany trade / التداول بين الشركات

Two-line description: a sales order in one entity and the mirrored purchase order in
the sister entity are entered twice today; intercompany trade needs **automatic
PO↔SO matching between entities** plus an **intercompany clearance statement**
(كشف مقاصة) netting the positions.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~2 weeks (matching service + clearance statement + charged-elimination
  feed).
- **Dependencies:** PHASE-053's own `intercompany_vouchers` (item 6) · the
  consolidation engine & charged eliminations (shipped, PHASE-031/034 lineage) · the
  platform-plane reader pattern (zero cross-tenant writes preserved).
- **Disposition (owner, final):** ADDED → **PHASE-053** (scope item 18; CR-50) — the
  natural completion of the consolidation & eliminations family.

### R-08 — Central document management (DMS) / إدارة مستندات مركزية — COVERED BY PLAN

Two-line description: a central document-management capability (folders, versions,
per-entity filing) — the v3.1/v3.2 plan already scopes exactly this in PHASE-062's
unified attachments panel; the ID binds to that item.
- **Severity:** — (no additional scope).
- **Effort:** 0 (ID binding).
- **Evidence of the plan coverage:** PHASE-062 scope item 3 — "**Unified attachments
  panel** (FD-17): one surface over the existing `file_objects` for every entity, with
  **ECM-style folders and versions** (the A-13 reading shared with the 053
  accounting-depth ECM surfaces)".
- **Disposition (owner, final):** **COVERED BY PLAN** — ID bound to PHASE-062 item 3
  (CR-50). No parallel scope may be invented for it.

### R-10 — Fleet depth, light version / عمق الأسطول — نسخة خفيفة

Two-line description: the owner reviewed full fleet management (fuel, violations,
licenses) and decided a **light version only**: vehicle-document expiry tracking
(license / insurance / inspection) and an odometer counter inside the CMMS; **full
fuel and violations management is a sectoral non-goal**.
- **Severity:** متوسطة (MEDIUM) for the light tracking scope.
- **Effort:** ~0.5 weeks (fleet register view grouping vehicles + document status +
  odometer binding — most substrate already ships: `warranty_expiry`/`insurance_
  expiry`/`license_expiry` columns + the `asset-expiry-sweep`, and `asset_meters`
  KM type).
- **Dependencies:** PHASE-049's own items 4 (meters) and 8 (expiry columns + sweep).
- **Disposition (owner, final):** ADDED (light only) → **PHASE-049** (scope item 10;
  CR-50). The full fuel/violations management exclusion is recorded in 049's
  out-of-scope with this ID.

### R-12 — Calendar view / عرض تقويمي

Two-line description: date-bearing worklists (invoice due dates, aging/commitments,
service visits, leaves) render only as tables; a **table↔calendar toggle** (month/
week views) gives ops teams the time dimension.
- **Severity:** منخفضة (LOW) — UX reach.
- **Effort:** ~0.5 weeks (one calendar component, four surfaces).
- **Dependencies:** PHASE-062's own surface work; leaves/visits data from 045/048.
- **Disposition (owner, final):** ADDED → **PHASE-062** (scope item 8; CR-50).

### R-13 — Route & customer maps / خرائط المسارات والعملاء

Two-line description: field-sales route visits and customer points have no spatial
view; a **map view of routes and customer locations** (over the 017/060 distribution
substrate) supports territory planning and field-team supervision.
- **Severity:** متوسطة (MEDIUM) — serves the field-sales distribution template (017)
  and Sales & CRM depth (060).
- **Effort:** ~1 week (map component over a documented tile provider, geocoded
  partner points, route overlay).
- **Dependencies:** the `routes`/`route_visits` substrate (shipped, distribution
  module) · partner geocoding (lightweight, tenant-entered or provider-geocoded with
  the 041/056 provider discipline).
- **Disposition (owner, final):** ADDED → **PHASE-062** (scope item 9; CR-50).

### R-14 — Paste from Excel inside line grids / اللصق من Excel داخل شبكات السطور

Two-line description: clerks re-key line data today; **pasting a copied Excel range
directly into line grids** (invoice lines, order lines, journal-entry lines) parses
rows/columns into the grid with validation — per the owner, among the most-requested
productivity features in ERP.
- **Severity:** عالية (HIGH) — per the owner's own framing of demand.
- **Effort:** ~1 week (clipboard parsing + column mapping + typed validation +
  budget error surfacing).
- **Dependencies:** PHASE-062's own grid work; the typed-validation machinery every
  grid already uses.
- **Disposition (owner, final):** ADDED → **PHASE-062** (scope item 10; CR-50).

### R-15 — Invoice-by-email / فاتورة بالبريد

Two-line description: AP clerks download attachments from email and upload them
manually; **forwarding a supplier-invoice email** into the platform must run the
**OCR ingestion pipeline (064) and land as an AP draft** — the email-intake front
door to the existing OCR scope.
- **Severity:** متوسطة (MEDIUM).
- **Effort:** ~0.5 weeks (inbound email intake → attachment extraction → existing OCR
  queue).
- **Dependencies:** PHASE-064's own OCR item (DF-26) — R-15 extends it; the 041
  channel substrate for the inbound address; human-confirmation gate unchanged
  (INV-044 class).
- **Disposition (owner, final):** ADDED → **PHASE-064** (scope item 5; CR-50).

## 3. Owner non-goals (final — recorded with justification, never planned)

| ID | Item | The owner's justification (verbatim-in-substance) |
|---|---|---|
| R-09 | **Product configurator (CTO/CPQ)** / مُهيئ المنتجات | An independent product category, not ERP completeness. Its alternatives are already planned: **BOM variants (PHASE-042)** + **custom fields (PHASE-036)**. Revisit after PHASE-065 only if needed. |
| R-11 | **Biological assets at fair value (IAS 41)** / الأصول البيولوجية بالقيمة العادلة | Rarely applicable to the target market. The agriculture template operates on **historical cost + shrinkage accounts** and stays exactly as `docs/industries/templates/agriculture.md` documents it. |

Both decisions are recorded in [COMPLETENESS_REGISTER.md](../COMPLETENESS_REGISTER.md)
(CR-51) with the same authority as an audited disposition; they may only be reversed
by a future owner decision recorded the same way.

## 4. Where everything landed (the one-command audit trail)

| Disposition | Count | Items |
|---|---|---|
| Scope additions (with severity/effort/home) | 11 | R-01→066 · R-02→053 · R-03→039 · R-04→048 · R-05→054 · R-07→053 · R-10→049 · R-12/R-13/R-14→062 · R-15→064 |
| Covered-by-plan ID bindings | 1 | R-08 → 062 item 3 (ECM-style folders/versions) |
| Shipped-by-design ID bindings | 1 | R-06 → arbitrary-period reporting (contract.ts 154–155 + statement contracts) |
| Owner non-goals | 2 | R-09 (configurator) · R-11 (IAS 41 fair value) |

Every item above appears in `COMPLETENESS_ROADMAP.md` §6.5 (the Layer-3 mapping) and
in its home phase document's scope; the effort totals enter CR-52's re-estimate. Per
CR-47, any gap discovered after this file enters through the same intake — identifier
+ severity + effort + home, same commit, no conversation-only knowledge.
