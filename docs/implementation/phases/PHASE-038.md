# PHASE-038 — Procurement Sourcing & Supplier Collaboration

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 1 / Stage 12 · **Register:** [CR-08](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-11) · §5 (P-01…P-15) · §29.1 (DF-52/53) · [gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md](../../planning/gap-analysis/ERP_COMPLETENESS_GAP_REPORT.md) §2 gap 5 (sourcing)

## 1. Phase Overview

- **Phase ID:** PHASE-038
- **Title:** Procurement Sourcing & Supplier Collaboration (دورة المنافسة الشرائية وتعاون الموردين)
- **Objective:** Build the missing **negotiation loop in front of the purchase
  order** — today the buying cycle starts at a purchase request and jumps
  straight to a PO (H-11: "no organized negotiation with suppliers = direct
  financial loss"). The phase delivers the full sourcing cycle: RFQ
  (`rfqs`/`rfq_lines`, open or invited suppliers) → supplier quotes
  (`supplier_quotes`/`supplier_quotes_lines`) → the award matrix
  (`quote_comparisons`) → awarding that GENERATES a purchase order or a
  blanket release; then the collaboration layer: blanket agreements
  (`blanket_orders`/`blanket_releases`), supplier scorecards
  (`supplier_ratings`), approved vendor lists (`approved_supplier_items`),
  budget-checked CAPEX requests (`capex_requests`), supplier advances and
  early-payment discounts (two NEW journal goldens G-33/G-34), public-tender
  intake records (`tender_intakes`), and the minimal supplier-portal
  skeleton (P-05: a quote-submission endpoint with scoped authentication —
  the full portal in 060 shares this infrastructure). The 3-bid rule ships
  as tenant policy (P-08).
- **Business value:** Structured competitive buying is measurable savings
  (the 3-bid discipline), audit-grade procurement for government-adjacent
  deals (DF-52/53), working-capital control through advances and
  early-payment discounts, and the answer to the audit's "biggest purchasing
  gap" — the completeness report's sourcing verdict stops applying.
- **الملخص التنفيذي (AR):** تُبنى حلقة التفاوض الشرائية الناقصة قبل أمر الشراء:
  طلبات عروض الأسعار (مفتوحة أو بدعوة موردين)، عروض الموردين، مصفوفة المقارنة
  والترسية التي تولِّد أمر شراء أو صرفاً من اتفاقية إطارية، ثم طبقة التعاون:
  الاتفاقيات الإطارية مع تتبع الرصيد، بطاقات تقييم الموردين (التسليم/الجودة/
  السعر)، قوائم الموردين المعتمدين لكل صنف، طلبات الشراء الرأسمالية بفحص
  الموازنة، سلف الموردين وخصومات الدفع المبكر بقاعدتي ترحيل جديدتين (G-33/G-34)
  على ترقيمٍ يواصل G-32، وسجلات استقبال المناقصات الحكومية، مع هيكل بوابة
  موردين أدنى (نقطة تقديم عرض واحد بنطاق مصادقة مقيَّد) تشاركها البوابة الكاملة
  لاحقاً، ودعم قاعدة العروض الثلاثة كسياسة مستأجر.

## 2. Scope

In scope:

1. **RFQ workflow** (`rfqs` + `rfq_lines`, H-11/P-01): lifecycle
   DRAFT → ISSUED → QUOTED → AWARDED → CLOSED with state-machine CHECKs;
   open-to-all-suppliers or invited-supplier modes; due dates and currency.
2. **Supplier quotes** (`supplier_quotes` + `supplier_quotes_lines`, P-02):
   supplier responses with line prices, lead time, validity windows, and
   terms — submitted through the portal endpoint or back-office entry.
3. **Award matrix** (`quote_comparisons`, P-02/P-08): the frozen comparison
   snapshot — line-level price/delivery/terms scoring and the award
   decision; 3-bid rule support as tenant policy (a configurable minimum
   quote count before award — BR-062).
4. **Awarding**: generates a purchase order or a blanket release from the
   awarded lines; one award per round and awarding closes the RFQ (BR-063);
   the generated documents stay traceable to their quotes.
5. **Blanket agreements** (`blanket_orders` + `blanket_releases`, P-03):
   validity windows, min/max commitments, price locking, release tracking
   against the remaining balance; over-release is a typed rejection.
6. **Supplier scorecards + approved lists** (`supplier_ratings`,
   `approved_supplier_items`, P-04): delivery/quality/price scores over a
   rolling window computed from live documents; the approved-vendor-per-item
   list gates vendor suggestions (the item-vendor mapping leg of P-09).
7. **CAPEX requests** (`capex_requests`, P-10/P-15): capital purchase
   requests with workflow states and the PHASE-028 budget control guard —
   advisory default, ENFORCE per tenant policy; SoD creator ≠ approver.
8. **Advances and early-payment discounts** (`supplier_advances`,
   `early_payment_discount_terms`, P-12/P-13): advance disbursement tracking
   and discount terms with TWO new journal goldens registered in
   JOURNAL_RULES.md — G-33 (supplier advance) and G-34 (early-payment
   discount capture) — numbering continues from G-32, the last shipped
   golden.
9. **Tender intake** (`tender_intakes`, P-14/DF-52/DF-53): public-tender
   intake records with government supplier-registration fields — intake
   records only, no bidding-platform claims (honesty discipline).
10. **Contract-linked purchasing** (P-06): additive `contract_id` linkage on
    purchase orders and blanket orders to `crm.service_contracts`.
11. **Supplier portal skeleton** (P-05): ONE quote-submission endpoint +
    scoped authentication for invited suppliers (audited, minimal,
    rate-limited); the full portal (060) shares this infrastructure per the
    roadmap. Permissions: `purchasing.rfqs.*`, `purchasing.suppliers.rate`,
    `purchasing.capex.*`.
12. **3-way matching tolerance** (P-11): configurable price/quantity
    tolerance bands on the existing matching engine (settings-registry
    keys — no new tables).

Out of scope: full supplier portal (060 — shares the P-05 infra) ·
automatic safety-stock replenishment suggestions (043) · supplier
e-commerce catalog (P-09's fuller catalog; the approved-item list ships
here) · tender bidding platform (intake records only) · customer-side
returns (039).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | planned — the v3.0 entry phase; hard ordering rule (roadmap §5: 035 ships first) |
| Purchasing chain + budgeting controls baseline (requests → orders → GRN → invoices; the 028 control guard) | delivered with the 34-phase baseline |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

No hard ordering binds this phase inside Wave 1 (siblings may run in
parallel); cumulative counters assume the sequential lineage
035 → 036 → 037 → 038 → …. PHASE-036 is recommended-before but not
required: RFQ entities can register into the custom-field substrate
retroactively in one line per the ADR-0019 additive rule.

## 4. Design Impact

- **Migrations**: `0051_rfq_quotes.sql` (rfqs, rfq_lines, supplier_quotes,
  supplier_quotes_lines, quote_comparisons) · `0052_blanket_orders.sql`
  (blanket_orders, blanket_releases + the additive
  `purchase_orders.contract_id`) · `0053_supplier_collaboration.sql`
  (supplier_ratings, approved_supplier_items, supplier_advances,
  early_payment_discount_terms) · `0054_capex_tenders.sql` (capex_requests,
  tender_intakes) — journal 50 → 54, next in sequence after PHASE-037's
  0050; all tables RLS'd; Drizzle journal/spec updated.
- **Entities**: +13 tables (ENTITY_CATALOG.md 204 → 217); Drizzle mirrors +
  typed stores under the purchasing module.
- **Permissions**: +7 keys — `purchasing.rfqs.read`, `purchasing.rfqs.manage`,
  `purchasing.rfqs.award`, `purchasing.suppliers.rate`,
  `purchasing.capex.read`, `purchasing.capex.manage`,
  `purchasing.capex.approve`; zero-drift extended (249 → 256; seed =
  mirror).
- **i18n**: ~220 new AR/EN keys (RFQ screens, comparison, scorecards,
  blanket management, capex, portal notices); parity gate as ever.
- **Reports**: +2 contracts — `purchasing.rfq_award_matrix` and
  `purchasing.supplier_scorecard` (registry 86 → 88); REPORT_CATALOG.md
  rows mandatory (CR-36).
- **Feature flags**: +5 keys — `purchasing.rfqs`, `purchasing.blanket_orders`,
  `purchasing.supplier_scorecards`, `purchasing.capex_requests`,
  `purchasing.supplier_portal` (business + enterprise, the tier-4
  financial-depth precedent; FEATURE_CATALOG.md rows + dependency edges).
- **Goldens**: G-33/G-34 registered in JOURNAL_RULES.md with posting-engine
  source types, worked examples, failure packs, and SoD (creator ≠
  approver); the numbering continues from G-32.
- **Rules**: BR-062 (3-bid policy enforcement) and BR-063 (award closes the
  RFQ) appended to BUSINESS_RULES.md (continues from BR-061 shipped with
  PHASE-037).
- **Docs**: JOURNAL_RULES.md · BUSINESS_RULES.md · ENTITY_CATALOG.md (+13) ·
  FEATURE_CATALOG.md (+5) · REPORT_CATALOG.md (+2) · DATA_DICTIONARY.md ·
  NAVIGATION_MODEL.md (+ purchasing group items).
- **Sync surface (CR-36 g)**: read-only feed projections for rfqs/blankets
  (additive); quote submission and awarding are online-only — N/A-recorded
  for offline writes.
- **Performance (OA-06)**: EXPLAIN-verified hot paths — RFQ list by
  (tenant, status), quote fetch by RFQ, scorecard aggregation window;
  command-palette entries for the new entities (OA-04).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations `0051`–`0054` (13 RLS'd tables + indexes + the additive contract_id) + Drizzle journal/spec | api |
| T-02 | RFQ lifecycle service (states, open/invited issue, due dates, close) + state-machine specs | api |
| T-03 | Supplier quotes service + the portal quote-submission endpoint with scoped, audited authentication | api |
| T-04 | Comparison/award-matrix service (frozen snapshot, scoring) + award → PO / blanket-release generation | api |
| T-05 | Blanket agreements service (balance tracking, expiry, over-release rejection) | api |
| T-06 | Scorecards + approved supplier items (rolling computation job + gating in item vendor suggestions) | api |
| T-07 | CAPEX requests service (workflow states, budget guard advisory/enforced, SoD) | api |
| T-08 | Supplier advances + early-payment discounts: G-33/G-34 posting integration + failure packs | api |
| T-09 | Tender intake records + government supplier-registration fields | api |
| T-10 | 3-way matching tolerance settings keys + matching-engine integration | api |
| T-11 | Web screens: `/purchasing/rfq` (list/detail/comparison), scorecards, blanket management, capex | web |
| T-12 | NAV_ITEMS + command palette + feature gating + AR/EN dictionaries | web |
| T-13 | Rule specs (BR-062/063, G-33/G-34, portal spoof battery) + RLS A1–A10 + docs wave + full gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0051–0054 apply cleanly; the 13 new tables are RLS'd with
   composite tenant FKs; Drizzle + ENTITY_CATALOG.md parity (217 rows).
2. RFQ lifecycle end-to-end: DRAFT → ISSUED (open AND invited modes) →
   QUOTED → AWARDED → CLOSED; invalid transitions are typed 409 failures
   with zero residue; state-machine CHECKs hold at the DB level.
3. 3-bid rule (BR-062): with the policy enforced, awarding below the
   configured minimum quote count is a typed rejection; advisory mode warns
   only — both modes tested.
4. Awarding generates the PO (or blanket release) with lines traceable to
   the awarded quotes; awarding closes the RFQ (BR-063); double-award
   attempts fail typed.
5. Blanket releases decrement the remaining commitment balance; over-release
   beyond max is a typed rejection; expiry blocks new releases.
6. Goldens: G-33 (supplier advance) and G-34 (early-payment discount) post
   through the posting engine with balanced worked examples and failure
   packs (unmapped control account → typed rejection, zero partial writes);
   SoD creator ≠ approver holds.
7. Scorecards compute delivery/quality/price scores from live documents in
   the rolling window; approved supplier items gate item-level vendor
   suggestions (an unapproved vendor suggestion is flagged or blocked per
   policy).
8. Portal skeleton: an invited supplier's scoped token can submit ONLY
   their quote for ONLY that RFQ — the spoof battery (other RFQs, other
   suppliers, cross-tenant, stale tokens) all fails typed; every submission
   is audited.
9. CAPEX requests check the budget control guard in advisory AND enforced
   modes (the 028 discipline); approval workflow with SoD; the
   `purchase_orders.contract_id` linkage resolves a live contract.
10. House gates green (CR-36) + completion: RLS A1–A10 for the 13 tables ·
    permissions drift 249 → 256 · i18n parity (~220 keys) · `docs:validate`
    · the 2 new report contracts render over seeded data with
    REPORT_CATALOG rows · completion report
    `docs/implementation/phases/reports/PHASE-038-COMPLETION.md` appended ·
    `IMPLEMENTATION_STATUS.md` row flipped · archive delivered as
    `ERP_PLATFORM_PHASE038.zip` (OA-07).

## 7. Risks and Constraints

- **Award-matrix complexity** — multi-line partial awards can spiral;
  mitigated by line-level award decisions and a comparison snapshot frozen
  at award time (the matrix is evidence, never recomputed).
- **Golden account-mapping prerequisites** — the advance and discount
  control accounts must be tenant-mapped; mitigated by fail-closed
  prechecks before any write (the payroll G-29 precedent) and typed
  failures until mapped.
- **The portal is a NEW external-facing surface** — kept minimal by design
  (one endpoint, scoped tokens, audited, rate-limited); full portal
  hardening lands with 060 on this infrastructure.
- **Government-tender breadth** — intake records only, documented; no
  bidding-workflow claims (the honesty discipline).
- **13 tables in one phase** — mitigated by the four-migration split, each
  carrying its own CR-36 gate evidence.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-038-COMPLETION.md`
  (evidence per acceptance criterion, the G-33/G-34 worked examples, the
  portal spoof battery output, gate output).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-038 row → COMPLETE;
  `NEXT_ACTION.md` → next eligible phase PHASE-039 (Returns & Collections)
  with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE038.zip`
  (OA-07); the owner continues with «ابدأ تنفيذ المرحلة PHASE-039».
- Handoff notes for PHASE-039: the partner credit-risk surfacing there
  reuses the scorecard aggregation pattern shipped here; for 043, blanket
  release schedules are planning inputs; for 050, supplier quality records
  extend `supplier_ratings`; for 060, the portal skeleton is the substrate
  to build the full supplier portal on.
