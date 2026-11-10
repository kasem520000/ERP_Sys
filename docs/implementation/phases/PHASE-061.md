# PHASE-061 — POS & Retail Depth

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 4 / Stage 15 · **Register:** [CR-31](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §4 (S-08, S-09) · §17 (N-16, N-18, N-19) · §26.2 (IN-11, IN-12)

## 1. Phase Overview

- **Phase ID:** PHASE-061
- **Title:** POS & Retail Depth (عمق نقاط البيع والتجزئة)
- **Objective:** Complete the retail motion on top of the delivered POS module:
  loyalty programs (points, tiers, expiry) with per-customer accounts and a full
  earn/redeem/expiry ledger; gift cards as a real tender with liability accounting
  and a non-negative balance invariant; e-receipt dispatch over the PHASE-041 email
  and WhatsApp channels; an external POS API for third-party order push; and the
  cashier hardware layer — thermal printers (ESC/POS over WebUSB/WebSerial and the
  offline desktop bridge), cash-drawer kick, customer display line, and scale
  integration with EAN-13 weight-barcode prefix parsing, which finally completes the
  grocery weigh flow.
- **Business value:** Retail tenants judge an ERP POS on exactly the surfaces this
  phase ships: a loyalty program that keeps customers returning, gift cards that
  pull cash forward, receipts that arrive on WhatsApp, and a scale that just works
  at the fresh-produce counter (N-18). The external POS API (N-16/IN-11) unlocks
  third-party front-ends and marketplace devices without replacing the platform's
  back office.
- **الملخص التنفيذي (AR):** يُكمل هذا الطور حركةَ التجزئة فوق وحدة نقاط البيع
  المسلَّمة: برامج ولاء بقواعد كسب نقاط ومستويات وسياسة انتهاء، وحسابات ولاء لكل
  عميل مع سجل كسب/استبدال/انتهاء كامل، وبطاقات هدايا كطريقة دفع حقيقية مع محاسبة
  التزام وثابت عدم السالبية، وإيصالات إلكترونية بالبريد وواتساب عبر قنوات
  PHASE-041، وواجهة API لنقاط بيع خارجية تدفع الجلسات برموزٍ محدودة النطاق، وطبقة
  عتادة الكاشير: طابعات حرارية ESC/POS عبر WebUSB/WebSerial وجسر سطح المكتب، وفتح
  درج النقدية، وشاشة عرض العميل، وتكامل الموازين بتحليل باركود الوزن EAN-13 الذي
  يُكمل أخيراً تدفّق وزن البقالة — تحت القيود الذهبية G-78/G-79 والثابت INV-043.

## 2. Scope

In scope:

1. **Loyalty programs** (S-08): `loyalty_programs` (points earn rules — per-amount or
   per-item — tiers with thresholds, expiry policy) + `loyalty_accounts` (per
   customer) + `loyalty_transactions` (earn/redeem/expiry ledger with source-document
   links); earn and redeem at POS checkout and on sales invoices; expiry sweeps with
   notice; `/pos/loyalty` admin screen.
2. **Gift cards** (S-09): `gift_cards` (issue, balance, expiry, activation state) +
   `gift_card_transactions` (issue/top-up/redeem/expire ledger); gift card as a POS
   tender method; liability mapping to a deferred-revenue account; `/pos/gift-cards`
   screen.
3. **E-receipt dispatch**: email/WhatsApp receipt send through the PHASE-041 channel
   ports with a checkout toggle; rides existing channel templates, retries, and the
   consent-suppression check from PHASE-058 when present; dispatch records live in
   the existing channel message log.
4. **External POS API** (N-16, IN-11): `pos_api_tokens` — scoped, rotatable tokens
   with rate limits; third-party order push into POS sessions with idempotency keys
   and a documented payload contract (items, payments, discounts, customer ref).
5. **Cashier hardware** (IN-12): thermal printers via ESC/POS over WebUSB/WebSerial
   with the offline desktop bridge as fallback; cash-drawer kick command; customer
   display line; `pos_hardware_profiles` per station; hardware settings panel with
   capability detection and test actions.
6. **Scale integration** (N-18): weight-barcode parsing with configurable EAN-13
   prefix rules (embedded item code and weight or price) — completing the grocery
   weigh flow end-to-end from scale label to priced POS line.
7. **Label printing hardware path** (N-19): label printers driven through the same
   bridge/ESC-POS path; label template design stays with PHASE-062 (the honest split
   is recorded — hardware here, templates there).
8. **Retail accounting discipline**: loyalty points liability and gift card
   liability mapping with period-close checks — goldens G-78 (loyalty ledger balance:
   earned = redeemed + expired + outstanding per account) and G-79 (gift card
   liability GL balance equals Σ outstanding gift-card balances at close).

Out of scope: label template design (062) · carrier/shipment integrations (056) ·
AI anomaly detection on POS behavior (064) · new POS UI redesign (the delivered POS
checkout is extended, not rebuilt) · offline loyalty sync beyond the documented
server-side re-validation policy (the offline contracts themselves are on the "do
not touch" list and are only assessed per OA-02).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-041 (Communications Hub — email/WhatsApp channel ports for e-receipts) | PLANNED (Blueprint v3.0) — must be COMPLETE before this phase starts |
| Delivered POS module (sessions, checkout, payments, shift handling) + offline desktop bridge | shipped in stages 1–11 (audit §21 — do not touch) |
| PHASE-060 `sales_channels` registry (retail channel pricing anchor) | PLANNED — recommended soft edge; without it, POS channel pricing falls back to the delivered price lists (recorded) |

The 041 edge is hard: e-receipts are channel dispatches, and inventing a second
send path would violate the channel-port discipline the platform already decided.

## 4. Design Impact

- **Migrations:** next in sequence (≈0129…0131 at authoring time; exact numbers are
  bound at implementation start — counts and contents claimed, not fixed journal
  numbers): `loyalty` (loyalty_programs, loyalty_accounts,
  loyalty_transactions), `gift_cards` (gift_cards, gift_card_transactions),
  `pos_ext` (pos_api_tokens, pos_hardware_profiles, e-receipt settings columns).
  Drizzle mirror, `_journal.json`, and migration spec updated per house convention.
- **Entities/catalog parity:** +7 new tables (the seven above); every table ships
  SQL + Drizzle + an `ENTITY_CATALOG.md` row (CR-36 a).
- **Permissions:** +5 keys — `pos.loyalty`, `pos.gift_cards`, `pos.hardware`,
  `pos.api_tokens`, `pos.e_receipts`; zero-drift equality re-run at the extended
  running base (CR-36 b).
- **i18n:** ~150–190 new dictionary keys (loyalty admin, gift cards, hardware
  settings, e-receipt toggle and receipts) ×2 AR/EN; parity equality extended
  (CR-36 c). Receipts printed via ESC/POS follow the existing bilingual receipt
  template conventions.
- **Docs:** `NAVIGATION_MODEL.md` (POS group entries) · `POS_RETAIL.md` (loyalty
  program design, gift card liability accounting, hardware setup, scale prefix
  rules, external API contract) · `JOURNAL_RULES.md` and `ACCOUNTING_INVARIANTS.md`
  updated for G-78/G-79/INV-043 · `BUSINESS_RULES.md` rows for earn rules and
  expiry sweeps.
- **Reports:** +2 code-level contracts — `pos.loyalty-activity` (enrollment, earn/
  redeem/expiry flows) and `pos.gift-card-liability` (outstanding balances roll);
  catalog rows mandatory.
- **Feature flags:** `pos.retail_suite` — template-composable grant for
  retail-facing industry templates first (CR-36 f).
- **Goldens and invariants:** G-78 (loyalty ledger balance per account: earned =
  redeemed + expired + outstanding, at every sweep) · G-79 (gift card liability GL
  balance equals Σ outstanding gift-card balances at period close) · INV-043 (gift
  card balance can never be negative — redemption cannot exceed the remaining
  balance, and offline-synced redemptions are re-validated server-side with
  automatic reversal on over-spend).
- **Architecture:** no new ADR required — hardware access is a browser/desktop-bridge
  concern already decided; the external POS API follows the API-key discipline from
  PHASE-055 where present, otherwise a POS-scoped token table with identical
  semantics.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations (≈0129…0131) + Drizzle mirror + `ENTITY_CATALOG.md` rows | api |
| T-02 | Loyalty core: programs, accounts, earn/redeem engine with source-document links (G-78 ledger tests) | api |
| T-03 | Loyalty expiry sweep job + tier evaluation + customer tier display | jobs |
| T-04 | Gift cards: issue/top-up/redeem/expire ledger + POS tender integration (INV-043 tests) | api |
| T-05 | Gift card liability accounting: deferred-revenue mapping + close reconciliation (G-79 golden) | api |
| T-06 | E-receipt dispatch through the 041 channel ports + checkout toggle + dispatch records | api |
| T-07 | External POS API: `pos_api_tokens` auth, order-push endpoint with idempotency, payload contract + tests | api |
| T-08 | ESC/POS printer service over WebUSB/WebSerial + desktop-bridge fallback + receipt/test print | web |
| T-09 | Cash-drawer kick + customer display line commands + capability detection | web |
| T-10 | Scale integration: EAN-13 weight-barcode prefix rules config + parsing into priced lines | web/api |
| T-11 | Label printer hardware path via the same bridge (templates stay in 062 — recorded) | web |
| T-12 | `pos_hardware_profiles` + hardware settings panel with test actions | web |
| T-13 | Screens: `/pos/loyalty` admin, `/pos/gift-cards` + NAV/⌘K registration (OA-04) | web |
| T-14 | Offline assessment per OA-02: loyalty/gift-card tender in offline POS sessions — server-side re-validation and reversal policy documented and tested | all |
| T-15 | Docs (POS_RETAIL.md, rules, invariants, catalog rows) + RLS attack tests A1–A10 on all 7 tables + full local gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. A loyalty program with seeded earn rules accrues points on a POS checkout and on
   an invoice, redeems at a later checkout, and the per-account ledger satisfies
   G-78 exactly (earned = redeemed + expired + outstanding) after an expiry sweep.
2. A gift card is issued, topped up, redeemed partially, and expired on schedule;
   every redemption is bounded by the remaining balance (INV-043 negative-balance
   test passes, including a forced offline-sync over-spend that auto-reverses
   server-side).
3. At period close, the gift card liability GL balance equals Σ outstanding
   gift-card balances (G-79 golden run green) and the loyalty points liability
   valuation posts per the documented rate policy.
4. An e-receipt is dispatched by email and by WhatsApp through the PHASE-041
   channel ports with the checkout toggle honored; dispatch records (status,
   retries, fallbacks) appear in the channel message log.
5. An external system pushes an order into a POS session with a scoped
   `pos_api_tokens` credential; replay with the same idempotency key does not
   double-post; revoked or over-limit tokens are rejected with clear errors.
6. Hardware: a thermal printer prints a receipt over WebUSB or WebSerial (or the
   desktop bridge fallback), the cash drawer kicks on sale completion, and the
   customer display line renders the running total — each proven by the test
   actions in the hardware settings panel.
7. Scale integration: a seeded EAN-13 weight barcode with configured prefix rules
   parses into the correct item and priced weight line at checkout — the grocery
   weigh flow closes end-to-end.
8. RLS attack tests A1–A10 pass on all 7 new tables (loyalty accounts and gift
   cards are tenant-isolated; balances never leak cross-tenant).
9. CR-36 gates: SQL + Drizzle + `ENTITY_CATALOG.md` for all 7 tables · permissions
   zero-drift at the extended base · AR/EN parity equality · `docs:validate` green ·
   feature-flag gating · sync-surface assessment recorded per OA-02 (offline POS
   loyalty/gift-card policy documented and tested) · OA-06 EXPLAIN budgets for the
   loyalty/gift-card ledger hot paths.
10. Completion report `docs/implementation/phases/reports/PHASE-061-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive delivered
    as `ERP_PLATFORM_PHASE061.zip` (OA-07).

## 7. Risks and Constraints

- **Offline double-spend on gift cards and points** — offline POS sessions can
  redeem balances they cannot see. Mitigated by INV-043's server-side re-validation
  with automatic reversal, an offline balance ceiling per session, and the OA-02
  assessment documenting the residual risk honestly.
- **Hardware matrix fragmentation** — WebUSB/WebSerial support varies by browser
  and OS; printers and drawers diverge on ESC/POS dialects. Mitigated by capability
  detection, per-profile command overrides, the desktop bridge fallback, and test
  actions that prove each device at configuration time.
- **Weight-barcode variety** — scales embed weight or price with differing prefixes
  and decimals per produce type. Mitigated by configurable prefix rules per tenant
  with a parsing test matrix instead of hard-coded assumptions.
- **Liability accounting drift** — loyalty and gift card liabilities can silently
  diverge from the ledgers. Mitigated by G-78/G-79 as close-cycle goldens with
  reconciliation reports and a checklist entry at period close.
- **WhatsApp receipt template approval** — receipt templates are transactional but
  still subject to provider policy. Mitigated by per-channel capability flags and
  the email fallback recorded in the dispatch log.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-061-COMPLETION.md`
  (evidence per acceptance criterion, hardware test transcripts, G-78/G-79 golden
  outputs, INV-043 test output including the offline over-spend reversal, gate
  outputs).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-061 row → COMPLETE; `NEXT_ACTION.md`
  points to the next eligible phase PHASE-062 (UX Excellence & Document Design) per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE061.zip` (OA-07) and
  handed to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-062».
- Handoff notes for PHASE-062: the label-template designer consumes the label
  printer hardware path shipped here; loyalty/gift-card surfaces join the saved-views
  and bulk-action list operations from that phase; e-receipt templates become tenant
  customizable through the same print-template designer; the customer-display line
  gains theming with the white-label work.
