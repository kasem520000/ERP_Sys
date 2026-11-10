# PHASE-063 — Gulf & Arabic Differentiators

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 4 / Stage 15 · **Register:** [CR-33](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) DF-01…DF-06 · DF-08 · DF-10 · DF-54 · IN-05 · [COMPLETENESS_REGISTER.md](../../planning/COMPLETENESS_REGISTER.md) §D (OA-01) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.3

## 1. Phase Overview

- **Phase ID:** PHASE-063
- **Title:** Gulf & Arabic Differentiators (المميزات الخليجية والعربية)
- **Objective:** Deliver the differentiators the audit says no global competitor offers in
  depth — the items that win Gulf RFPs outright. Concretely: **full Hijri calendar support**
  (DF-01) via an Umm al-Qura conversion service on verified tabular data with explicit
  REQUIRES_VERIFICATION honesty for edge dates, dual-calendar display everywhere, and
  Hijri-aware period filters and fiscal-closing notes; **Tafqeet (التفقيط)** (DF-03) promoted
  from a partial utility to a platform-wide money-to-Arabic-words service on every money
  surface — invoice prints, cheque prints, reports, receipts; **season planning** (DF-02) as
  Ramadan/Hajj/Eid packs — seasonal budget templates, demand profiles feeding the reorder
  suggestions from PHASE-043, seasonal shift patterns from PHASE-045, and season-over-season
  analytics; the **Murabaha/Tawarruq accounting template pack** (DF-10) — cost-of-goods plus
  fixed-markup receivable structures with zero interest postings, guarded by a new golden
  **G-80** (murabaha non-interest consistency) with a Sharia-board disclaimer and documented
  structures; the **country packs** (DF-05, DF-06, DF-54, IN-05) — the JoFotara (Jordan)
  e-invoicing adapter following the ZATCA GATE discipline (stub-until-verified), the Yemen
  market pack completion (sales-tax + Zakat al-Mal worksheets under the verification
  discipline), the GCC e-invoicing readiness matrix (BH/KW/OM/QA staged plan), and deeper
  Omani/Bahraini VAT packs; and **Arabic-Indic numerals rendering completion** (OA-01) across
  all numeric surfaces from the per-user preference framework delivered by PHASE-062.
- **Business value:** The audit's differentiator scoring is explicit: Hijri depth, season
  planning, and Islamic finance templates are capabilities «no global competitor offers» —
  they are the reason a Gulf buyer chooses this platform over an translated Western ERP;
  the Jordan e-invoicing and Yemen packs open two markets the global vendors do not serve;
  and Tafqeet is a legal-adjacent necessity on cheques across the region. This is the
  Stage-15 "differentiated" spine of the wave gate (CR-38).
- **الملخص التنفيذي (AR):** مرحلة التميّز الخليجي بامتياز: تقويمٌ هجري كامل عبر خدمة
  تحويل أم القرى على بياناتٍ جدولية موثّقة مع مصارحة REQUIRES_VERIFICATION لتواريخ
  الحدود، وعرضٌ مزدوج للتقويمين في كل مكان حسب تفضيل المستخدم، وفلاتر فترات هجرية
  وملاحظات إقفال مالي هجرية؛ والتفقيط خدمةً منصةً على كل سطحٍ مالي بأسلوبٍ عربي
  صحيح للعملات والكسور والمثنى والجمع؛ وتخطيط المواسم (رمضان/الحج/الأعياد) بقوالب
  موازنات موسمية وملفات طلبٍ تغذي اقتراحات إعادة الطلب ووردية موسمية وتحليلات
  موسم-مقابل-موسم؛ وحزمة قوالب المرابحة/التورق المحاسبية بلا أي فوائد — تكلفة البضاعة
  وهامش ربحٍ ثابت وربحٌ مؤجَّل بالتقسيط لا يُعيد تسعيره بالزمن — تحت القاعدة الذهبية
  الجديدة G-80 مع إخلاء مسؤولية مجلس الشريعة وهياكل موثقة؛ وحزم الدول: مهايئ فاتورة
  JoFotara الأردنية بانضباط بوابات ZATCA (كعب حتى التحقق)، واستكمال الحزمة اليمنية
  بورقتي ضريبة المبيعات وزكاة المال، ومصفوفة جاهزية الفاتورة الإلكترونية الخليجية،
  وتعميق حزمتي عُمان والبحرين؛ وأخيراً إكمال عرض الأرقام العربية الهندية لكل الأرقام
  وفق تفضيل المستخدم من المرحلة 062.

## 2. Scope

In scope:

1. **Hijri calendar** (DF-01):
   - **Umm al-Qura conversion service**: Gregorian ↔ Hijri conversion on a verified tabular
     data source shipped as data, with **REQUIRES_VERIFICATION honesty for edge dates** —
     the tabular Umm al-Qura approximation diverges from official moon-sighting
     announcements near month boundaries, so edge dates carry an explicit marker and a link
     to the official Umm al-Qura calendar source; no fiscal automation depends on an edge
     date without the marker surfacing.
   - **Dual-calendar display everywhere**: dates render both Gregorian and Hijri per the
     user preference delivered by PHASE-062 (`user_ui_preferences`) — lists, documents,
     prints, reports, timelines.
   - **Hijri-aware period filters** and **fiscal-closing notes**: period pickers accept
     Hijri ranges mapped to the existing Gregorian fiscal periods; the PHASE-062
     fiscal-closing checklist (PP-09) gains Hijri labels and closing notes.
   - **Prayer-time-aware scheduling hints** (optional flag): hints only — a deferred-post
     or batch-print job may show a prayer-time hint; nothing is ever blocked or automated
     by it.
2. **Tafqeet — التفقيط** (DF-03): a platform-wide money-to-Arabic-words service with
   correct Arabic number-narration grammar — currency units, fractions, dual and plural
   forms (مائتان · ثلاثمائة · ألفان · ريالان · هللتان) — versioned and pure; exposed on
   **every money surface**: invoice prints, cheque prints, reports, and receipts, in both
   the standard templates and tenant-designed templates from the PHASE-062 designer.
3. **Season planning** (DF-02): Ramadan/Hajj/Eid packs — seasonal budget templates;
   **demand profiles** (`season_demand_profiles`) feeding the reorder suggestions delivered
   by PHASE-043; **seasonal shift patterns** consuming the PHASE-045 roster engine;
   season-over-season analytics as a report contract over `season_packs` history.
4. **Islamic finance** (DF-10): the Murabaha/Tawarruq **accounting template pack** —
   cost-of-goods plus fixed-markup receivable structures; **no interest by construction**:
   deferred installment markup is recognized as fixed profit, never re-valued with time;
   documented structures (cost account, markup receivable, installment schedule) with a
   **Sharia-board disclaimer** on every surface and document; the new golden **G-80**
   (murabaha non-interest consistency) guards every posting set.
5. **Country packs** (DF-05, DF-06, DF-54, IN-05):
   - **JoFotara (Jordan) e-invoicing adapter** following the ZATCA GATE discipline
     delivered by PHASE-037 — **stub-until-verified**: generation-side scaffolding (UBL
     payload shapes, counters, QR) plus typed `REQUIRES_VERIFICATION` errors; no live
     clearance calls until the official endpoints and ruleset are verified against the
     published JoFotara documentation.
   - **Yemen market pack completion**: sales-tax and Zakat al-Mal worksheets as report
     contracts under the verification discipline — computation shapes shipped, rates and
     thresholds marked REQUIRES_VERIFICATION until confirmed against official sources.
   - **GCC e-invoicing readiness matrix** (DF-54): a documented staged plan for BH/KW/OM/QA
     (Bahrain, Kuwait, Oman, Qatar) — which platform pieces each mandate reuses, in the
     ZATCA/JoFotara pattern; documentation, not adapters.
   - **Deeper Omani/Bahraini VAT packs**: completing the VAT return worksheet depth for
     OM/BH on the existing tax engine.
6. **Arabic-Indic numerals rendering completion** (OA-01): the per-user preference from
   PHASE-062 now renders ٠١٢٣٤٥٦٧٨٩ across **all numeric surfaces** — lists, documents,
   prints, reports, KPI chips — with digit-shape correctness for Arabic-Indic vs Eastern
   Arabic-Indic forms verified per font, and exports retaining ASCII digits in machine
   fields (parsability preserved).

Out of scope: AI narration/copilot (064) · growth/partners/trust (065) · ZATCA Phase-2
clearance/CSID/XAdES and the Egypt ETA adapter (054) · KSA Zakat declaration support (054) ·
new interest-bearing financing features (excluded by design — G-80) · a second fiscal
calendar engine (fiscal periods remain Gregorian; Hijri is a display and filtering layer
plus closing notes).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-037 (ZATCA Phase-1 & QR Compliance) COMPLETE | hard prerequisite — the e-invoicing GATE discipline, counter chain, and real-QR substrate the JoFotara adapter follows |
| PHASE-045 (HR Core) COMPLETE | hard prerequisite — the shift/roster engine the seasonal shift patterns consume |
| PHASE-062 (UX Excellence) COMPLETE | hard prerequisite for rendering — the numerals preference flag, dual-calendar user preference, and print-template designer are its delivery surfaces |
| PHASE-043 (Manufacturing II — MRP) COMPLETE | advisory — demand profiles feed the 043 reorder suggestions |

If PHASE-063 is sequenced before PHASE-062 under roadmap §5 parallelism, the two
preference flags are added minimally here and the PHASE-062 document is corrected — the
register's phase-document-wins rule applies.

## 4. Design Impact

- **Migrations:** the next in sequence after the predecessors' last journal entry (~0130+
  at planning time; exact numbers bound at implementation start). Grouped SQL migrations +
  Drizzle mirrors for ~5 new tables: `season_packs`, `season_demand_profiles`,
  `islamic_finance_products`, `islamic_finance_contracts`,
  `islamic_finance_installments`. The Hijri conversion service and Tafqeet are pure
  services on shipped data — **no tables**; the JoFotara stub carries no tables until
  verification lifts the stub.
- **Entities/catalog parity:** +5 rows in `ENTITY_CATALOG.md`; SQL + Drizzle + catalog row
  for every table (CR-36 a).
- **Permissions:** +5 keys — `localization.seasons.manage`, `localization.calendar.manage`,
  `localization.islamic-finance.manage`, `localization.islamic-finance.post` (SoD:
  creator ≠ poster), `localization.country-packs.manage`; zero-drift check re-anchored
  (seed = catalog = matrix rows).
- **i18n:** AR/EN parity for the new surfaces; this phase is where the PHASE-062 locales
  substrate gains its first deep consumers — the Hijri/Tafqeet/numerals renderers are
  display layers over existing dictionaries; no new locale packs ship here (pack content
  is owner-planned data on the 062 substrate).
- **Goldens:** **G-80 — murabaha non-interest consistency** added to `JOURNAL_RULES.md`
  §7 and cross-referenced in `ACCOUNTING_INVARIANTS.md`: every murabaha/tawarruq posting
  set is interest-free by construction — cost plus fixed markup posts to the designated
  markup-receivable and Islamic-finance-profit accounts, zero postings to any
  interest-bearing purpose, and deferred installment markup is never re-valued with time.
  No other goldens/INV/BR rows.
- **Reports:** +3 contracts registered on the report engine and in `REPORT_CATALOG.md` —
  `localization.season-comparison` (season-over-season analytics),
  `localization.yemen-sales-tax`, `localization.yemen-zakat-al-mal` (the Yemen pack
  worksheets, REQUIRES_VERIFICATION-labeled).
- **Docs:** `FEATURE_CATALOG.md` (localization module) · `ENTITY_CATALOG.md` ·
  `REPORT_CATALOG.md` (+3) · `JOURNAL_RULES.md` (G-80) · `ACCOUNTING_INVARIANTS.md` ·
  `CHART_OF_ACCOUNTS.md` (markup-receivable + Islamic-finance-profit purposes) · the tax
  compliance pack (country packs + the GCC readiness matrix) · `NAVIGATION_MODEL.md` ·
  `IMPLEMENTATION_STATUS.md`.
- **Feature flags:** `localization.*`, `localization.hijri.*`, `localization.tafqeet.*`
  — dual-calendar display is per-user; `localization.jofotara` ships stub-gated
  (typed errors until verified); Tafqeet is default-on for Arabic document prints with a
  tenant off-switch.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Umm al-Qura conversion service on verified tabular data with REQUIRES_VERIFICATION edge markers + round-trip test suite | api |
| T-02 | Dual-calendar rendering everywhere (lists, documents, prints, reports, timelines) per user preference; Hijri-aware period filters; closing-note labels | web |
| T-03 | Optional prayer-time-aware scheduling hints flag (hints only, never blocking) | api |
| T-04 | Tafqeet platform service (currency units, fractions, dual/plural grammar) + golden test set of numbers → exact Arabic strings | api |
| T-05 | Tafqeet on every money surface: invoice prints, cheque prints, reports, receipts — standard and tenant-designed templates | web |
| T-06 | Season packs: seasonal budget templates + demand profiles feeding 043 reorder suggestions + seasonal shift patterns over the 045 roster engine | api |
| T-07 | `localization.season-comparison` report contract + season-over-season analytics surface | api |
| T-08 | Islamic finance pack: products/contracts/installments, posting templates, G-80 golden wiring, SoD create ≠ post | api |
| T-09 | Murabaha/Tawarruq authoring surfaces + Sharia-board disclaimer + documented structures pages | web |
| T-10 | JoFotara adapter stub under the ZATCA GATE discipline: payload shapes, counters, typed REQUIRES_VERIFICATION errors | api |
| T-11 | Yemen pack: `localization.yemen-sales-tax` + `localization.yemen-zakat-al-mal` worksheet contracts with verification-discipline labels | api |
| T-12 | GCC e-invoicing readiness matrix (BH/KW/OM/QA staged plan) + deeper Omani/Bahraini VAT packs | docs |
| T-13 | Arabic-Indic numeral rendering completion across all numeric surfaces, exports keep ASCII in machine fields | web |
| T-14 | Full local gates: typecheck, lint, tests, `docs:validate`, i18n parity, permissions zero-drift, RLS attack tests A1–A10 for new tables, evidence recording | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations apply cleanly with journal/spec/catalog parity; RLS attack tests A1–A10 pass
   for `season_packs`, `season_demand_profiles`, and the three Islamic-finance tables
   (CR-36 a, e).
2. **Hijri conversion round-trip tests pass against the verified table**: every date in the
   shipped tabular range converts Gregorian → Hijri → Gregorian identically, and edge
   dates carry the REQUIRES_VERIFICATION marker with the official source linked (DF-01).
3. Dual-calendar display renders on a sampled set of surfaces (list, invoice print,
   report, timeline) per user preference; a Hijri period filter maps onto the existing
   Gregorian fiscal periods; the closing checklist shows Hijri labels and notes.
4. **Tafqeet golden test set passes**: a reviewed set of numbers → exact Arabic strings
   (currency units, fractions, dual/plural forms) including the audit's legal-adjacent
   cheque amounts; every money surface renders the narration (DF-03).
5. **A Murabaha contract walkthrough proves zero interest postings**: cost-of-goods +
   fixed markup receivable + installment schedule → every generated journal set satisfies
   G-80 (no interest-bearing purpose touched; deferred markup recognized once as fixed
   profit, never re-valued); the Sharia-board disclaimer appears on every surface and
   document (DF-10).
6. Season packs: a Ramadan profile lifts a seeded item's reorder suggestion through the
   043 engine; a seasonal shift pattern validates against the 045 roster engine;
   `localization.season-comparison` renders season-over-season for two seeded seasons
   (DF-02).
7. Country packs: the JoFotara stub produces a well-formed draft payload and **fails
   closed** with a typed `REQUIRES_VERIFICATION` error on any clearance attempt; the Yemen
   worksheets compute on seeded data with rate fields marked for verification; the GCC
   readiness matrix document exists and covers BH/KW/OM/QA (DF-05, DF-06, DF-54).
8. Arabic-Indic numerals render across all numeric surfaces for a user with the
   preference enabled, and CSV/Excel exports retain ASCII digits in machine-readable
   fields (OA-01 completion).
9. All house gates green (typecheck, lint, boundaries, unit tests, `docs:validate`, i18n
   parity, permissions zero-drift re-anchored, manifests); +3 report contracts registered
   with catalog rows (CR-36).
10. Completion report `reports/PHASE-063-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE063.zip` (OA-07).

## 7. Risks and Constraints

- **Hijri edge-date accuracy** — the tabular Umm al-Qura approximation diverges from
  official announcements near month boundaries: mitigated by REQUIRES_VERIFICATION
  markers on edge dates, the official source linked in-product, and no fiscal automation
  depending on unmarked edge dates.
- **Tafqeet grammar correctness** — Arabic number narration (dual/plural forms, currency
  agreement, fraction wording) is subtle and legally visible on cheques: mitigated by the
  golden test set with owner sign-off by a native-Arabic reviewer before merge, and a
  versioned pure service so corrections are deliberate.
- **Sharia interpretation risk** — the platform ships accounting structures, not religious
  rulings: mitigated by the Sharia-board disclaimer on every surface, documented posting
  structures, the G-80 invariant, and owner/legal review of the template pack before
  release.
- **Country-pack verification drift** (JoFotara, Yemen, GCC) — external rulesets change:
  mitigated by the ZATCA GATE discipline (stub-until-verified, fail closed, typed errors)
  and worksheet labels that make unverified rates impossible to mistake for confirmed ones.
- **Boundary with 054** — ZATCA Phase-2, ETA, and KSA Zakat declaration support live in
  PHASE-054 and must not be duplicated here: mitigated by the adapter following the 037
  pattern exactly and the register's one-owner-per-gap mapping.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-063-COMPLETION.md` — evidence
  per acceptance criterion, the Hijri round-trip test output, the Tafqeet golden test set
  with reviewer sign-off, the Murabaha walkthrough journals proving G-80, and the
  verification-discipline record for JoFotara/Yemen.
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-063 row → COMPLETE; `NEXT_ACTION.md` → next
  eligible phase PHASE-064 (AI Copilot & Intelligent Automation) with its prerequisites
  (PHASE-055, PHASE-041).
- Delivery: repository state archived as `ERP_PLATFORM_PHASE063.zip` (OA-07); the owner
  continues with «ابدأ تنفيذ المرحلة PHASE-064».
- Handoff notes for PHASE-064: the season demand profiles are the seasonality input for
  smart reorder recommendations; the numerals and dual-calendar renderers are available to
  any AI-generated surfaces; and the Tafqeet service is the canonical Arabic wording
  reference for narration features.
