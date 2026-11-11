# PHASE-039 Completion Report — Returns & Collections

> **Status:** COMPLETE · **Date:** 2026-11-11 · **Phase doc:**
> [../PHASE-039.md](../PHASE-039.md) · **Register:** [CR-09](../../../planning/COMPLETENESS_REGISTER.md)
> (+ CR-46 v3.1 scope · CR-50 v3.2/R-03) · **Triple flip:** this report + the phase
> doc header + the IMPLEMENTATION_STATUS row flipped together (CR-48).

## 1. Executive summary

PHASE-039 delivered the returns & collections layer the audit found missing — the
H-12 verdict ("a return is a credit note with no operational process") and the
H-13 verdict ("no collection automation = dead receivables") are closed, together
with the three v3.1 additions (L1-10 credit reviews, L1-11 collection agencies,
L1-12 late fees) and the v3.2 addition (R-03 supplier RMA). The customer RMA
lifecycle (REQUESTED → APPROVED(SoD) → RECEIVED → INSPECTED → RESTOCKED/SCRAPPED/
REFUNDED) completes by driving the full credit-note lifecycle in-transaction —
exactly once (BR-064); the dunning ladder advances one step per sweep run, never
skipping or regressing (BR-065); the late-fee engine charges VAT-carrying fee
invoices through the sales engine with the REQUIRES_VERIFICATION discipline; the
agency layer carries hashed-token callbacks (the 038 portal pattern) and posts
G-39 commissions; and the supplier mirror auto-generates the AP debit note (G-38).
**Migrations 0055–0059 · schema_version 59 · 10 RLS'd tables · permissions
256 → 265 · feature keys +4 · report registry 88 → 90 · goldens G-35…G-39 ·
rules BR-064/BR-065.**

## 2. Mandatory code-evidence checklist (CR-48)

**New tables (SQL migration + Drizzle mirror + ENTITY_CATALOG row — CR-36 a):**

| Table | Migration | schema.ts (Drizzle) | Catalog |
|---|---|---|---|
| return_authorizations | 0055_rma_warranty.sql §1 | line 6792 | §"returns & collections" |
| return_authorization_lines | 0055 §2 | line 6851 | ✓ |
| warranty_registrations | 0055 §3 | line 6883 | ✓ |
| dunning_policies | 0056_dunning_collections.sql §1 | line 6919 | ✓ |
| dunning_letters | 0056 §2 | line 6953 | ✓ |
| collection_actions | 0056 §3 | line 6994 | ✓ |
| collection_agencies | 0058_collection_agencies.sql §1 | line 7027 | ✓ |
| collection_referrals | 0058 §2 | line 7061 | ✓ |
| supplier_return_authorizations | 0059_supplier_rma.sql §1 | line 7103 | ✓ |
| supplier_return_authorization_lines | 0059 §2 | line 7161 | ✓ |

Plus the additive partner credit-risk columns (L1-10): 0057_partner_credit_risk.sql
(credit_score_class A/B/C/D CHECK + the periodic review clock; the indexed
`(tenant_id, next_credit_review_at) WHERE NOT NULL` hot path). Catalog count
**217 → 227** (the planning +9 honestly corrected to +10 — the referral register
is a first-class table, not an action subtype).

**Migrations & manifest:** journal idx 54–58 appended to
`apps/api/migrations/meta/_journal.json` (59 entries); the manifest
`src/infra/db/migrations.ts` carries the five tags with the phase lineage
comments; `migrations.db.spec.ts` 7/7 (apply + re-apply no-op + RLS catalog
drift via `runChecks` + ownership + role defaults); `src/infra/db/migrations.spec.ts`
manifest pin → 0059_supplier_rma (4/4).

**Core services (line counts):**
- `sales/application/rma.ts` (607 lines) — ReturnsService: lifecycle + SoD +
  numbering (RMA-{YYYY}-{SEQ:6}) + the pure `computeReturnAvailability`
  (invoiced − credited − open-RMA) + `complete()` driving the CN create→approve→
  post in ONE transaction (G-35 linkage / G-36 / G-37) with exactly-once replay
  rejection (BR-064).
- `sales/application/warranties.ts` (223) — structured terms validation
  (durationMonths/coverage/basis/mileageLimitKm), whole-UTC-month end dates, the
  30/7/0 expiry sweep with per-window dedupe keys.
- `sales/application/dunning.ts` (1,348) — DunningService: policy validation,
  `resolveCurrentStep`/`advanceStep` pure ladder, the monotonic sweep
  (SAVEPOINT re-fire guard), bilingual letter rendering (EMAIL = snapshot + SENT,
  the register is the delivery evidence; WHATSAPP/SMS stored QUEUED, post-041),
  chargeLateFee (fee invoice via the sales engine's override arm — the G-04
  mirror with VAT), waiveFee (the trio), the agency chain to G-39, credit
  reviews + `runCreditReviewSweep`.
- `purchasing/application/supplier-rma.ts` (524) — the R-03 mirror to CREDITED:
  G-38 direct (DR AP_CONTROL / CR the mapped `purchasing.supplier_return_account`,
  fail-closed) + the DN document stamped POSTED against the journal; ship rides
  the movement engine (`manual_issue` + reason SUPPLIER_RETURN — the documented
  CHECK-domain note; a widening is the mechanical rename path when needed).
- Stores: `sales/infrastructure/returns.store.ts` (492),
  `sales/infrastructure/dunning.store.ts` (938),
  `purchasing/infrastructure/supplier-returns.store.ts` (329).
- Controllers: `sales/presentation/returns.controller.ts` (267),
  `sales/presentation/dunning.controller.ts` (524),
  `sales/presentation/agency-portal.controller.ts` (116 — the PUBLIC callback
  port: pre-GUC `erp.portal_resolve_agency_token(sha256)`, 10/min fixed-window
  limiter, withTenant re-validation, audited),
  `purchasing/presentation/supplier-returns.controller.ts` (177).
- Jobs: `sales/infrastructure/dunning-sweep.job.ts` (76, cron `45 2 * * *`) +
  `sales/infrastructure/warranty-expiry.job.ts` (77, cron `50 2 * * *`), both
  entitlement-gated per tenant.
- Credit-check interplay: `sales/application/credit-limits.ts` — the blocked
  class (setting `sales.credit_block_class`, default D) resolves to the same
  block posture as over-limit, reason `CREDIT_CLASS_BLOCKED` (the L1-10 spec
  asserts it). `sales/application/ar-queries.ts` — AgingRow gained the additive
  `dunningStep: number | null`.

**Web pages (paths):** `apps/web/app/[locale]/sales/returns/page.tsx` (RMA
workspace: customer tab + warranties tab), `apps/web/app/[locale]/sales/dunning/
page.tsx` (letters/policies/actions/credit-reviews/agencies), `apps/web/app/
[locale]/purchasing/returns/page.tsx` (supplier RMAs). Client components:
`returns-workspace.tsx` (1,414), `dunning-workspace.tsx` (2,367),
`supplier-returns-workspace.tsx` (814). Navigation: 3 NAV_ITEMS rows
(`packages/contracts/src/navigation.ts`) + 3 FALLBACK_CRUMBS. The two report
contracts surface on the registry-driven `/reports` index.

**Test files & counts:** unit — `sales/__tests__/rma-bounding.spec.ts` (7),
`sales/__tests__/dunning-ladder.spec.ts` (15), `configuration` golden pins
re-pinned (41) + drift spec (5). DB — `__db__/sales/returns.db.spec.ts` (5:
lifecycle/SoD/bounding/state-skips/SCRAP fail-closed→mapped/REFUND+cash-movement),
`__db__/purchasing/supplier-returns.db.spec.ts` (2), `__db__/sales/
dunning.db.spec.ts` (9: validation/monotonic-sweep/fees/waiver/STATUTORY_CAP
DB-CHECK/class-D-block/agency-chain/public-callback), the isolation A-suite
extended by the 10 tables (1,248/1,248). **Full DB suite: 173 files / 2,577
passed / 2 skipped / 0 failed. API unit suite: 520 passed (the single
zatca-qr-decode failure is the documented environmental Playwright-browser
absence — pre-existing, verified on clean HEAD by the returns agent).**

**Permission counts:** +9 keys seeded in 0056 §9 (sales.rma.read/manage/approve,
sales.dunning.manage, sales.warranties.manage, sales.late-fees.manage,
sales.collection-agencies.manage, purchasing.rma.read/manage) — the
identity-flows pin 256 → **265** with the lineage comment; the drift CLI agrees
(matrix 265 = seed 265 — both the CLI list and the unit spec's SEED_PATHS carry
0056); 21 new routes + the PUBLIC callback mirrored in route-permissions.ts.

**Feature flags:** +4 keys (sales.rma, sales.warranties, sales.dunning,
purchasing.rma) granted business + enterprise in 0056 §10 + the four
FEATURE_DEPS edges in `configuration/domain/feature-catalog.ts` (the BR-040
closure) — which re-pinned all 37 golden-effective-configs hashes with the
PHASE-039 review note (the P32 procedure).

**Reports:** `sales.rma_register` + `sales.dunning_status`
(`reporting/registry/operational/returns-dunning.ts`, 223 lines; queries in
`registry/sales/returns-dunning-queries.ts`) — registry **88 → 90**; the
`ar.aging` additive dunningStep column documented in REPORT_CATALOG §2.

**Goldens:** G-35/G-36/G-37/G-38 registered in JOURNAL_RULES §7 + note 12
(G-35…38 planned; G-39 the implementation-bound commission) with the
spec-pinned worked examples (re-entry 2×60.0000 · scrap 120.0000 · refund
230.0000 · G-38 12.5000 · G-39 100.0000). Rules: BR-064/BR-065 in
BUSINESS_RULES (the section now BR-060…065).

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

1. ✅ Migrations 0055–0059 apply cleanly; ten RLS'd tables with composite
   tenant FKs; Drizzle + ENTITY_CATALOG parity (227); partner columns additive.
2. ✅ RMA end-to-end RESTOCKED — the CN exists (POSTED, mirror totals), the
   re-entry journal posts at ORIGINAL cost, terminal stamps = the CN journal;
   replay → typed rejection (BR-064) — `returns.db.spec.ts` (a).
3. ✅ SCRAPPED → G-36 (fail-closed unmapped: typed rejection, RMA stays
   INSPECTED, zero residue; mapped completion posts exactly) — (d).
4. ✅ Quantity bounding (invoiced − credited − open-RMA, inclusive boundary)
   and typed state-skip rejections — (b)/(c).
5. ✅ Warranty terms round-trip + the expiry sweep fires the per-window
   notifications with dedupe keys.
6. ✅ Dunning ladder monotonic: 200-day overdue still starts at step 1; one
   step per run; no re-fire (the UNIQUE is the evidence) — `dunning.db.spec.ts` (b).
7. ✅ Aging linkage: `dunningStep` additive on `ar.aging`;
   `sales.dunning_status` renders per overdue invoice (registry 90).
8. ✅ Credit risk: class D blocks like over-limit (reason CREDIT_CLASS_BLOCKED)
   — (d); the review sweep assigns via `collections` notifications.
9. ✅ Late fees: CONTRACT_RATE charges the fee invoice with VAT (the G-04
   mirror asserted exactly); STATUTORY_CAP without source is refused by the DB
   CHECK; the waiver records reason + approver — (c).
10. ✅ Agency referral: register → token (shown once, sha256 at rest) → refer →
    settle → G-39 commission (mapped account) → COMMISSION_POSTED; the public
    callback authenticates a valid token and rejects a bad one — (e)/(f).
11. ✅ Supplier RMA (R-03): to CREDITED with the DN stamped POSTED against the
    G-38 journal; SoD; bounding; replay typed — `supplier-returns.db.spec.ts`.
12. ✅ House gates: RLS A-suite for the ten tables (1,248/1,248) · typecheck
    (api + web + contracts) · lint · unit (520) · docs:validate 33/33 · i18n
    parity 4,699 → **5,019 = 5,019** (+320 keys ×3) · permissions drift
    256 → 265 · check:rls exit 0 over the migrated schema.
13. ✅ This report + the header flip + the status row + the archive (below).

## 4. Deviations & decisions (documented)

- **+10 tables, not the planning +9**: `collection_referrals` is a first-class
  table (the referral ladder + commission stamps are stateful compliance
  evidence — not an action-log subtype). The phase doc §4 carries the honest
  correction.
- **G-35 shape**: RESTOCK posts NO separate journal — the RMA drives the CN to
  POSTED and re-shelves through the CN's own `credit_note:{id}:reentry` at
  original cost (W-3); G-35 registers that linkage (the 0055 header + the
  JOURNAL_RULES note).
- **G-37 legs**: DR AR_CONTROL (partner) / CR the refund cash account + the
  cash movement (source `return_authorization`, rate 1) — per the migration's
  registered shape.
- **G-38 vs the DN service**: `DebitNoteService.post()` re-credits INVENTORY on
  stock the ship leg already wrote out (double count) — so credit posts G-38
  directly and creates the DN document through the store, stamped POSTED
  against that journal (0059's CHECK requires debit_note_id at CREDITED).
- **Ship moves** ride `manual_issue` (reason SUPPLIER_RETURN) — 0059 didn't
  widen the stock_moves CHECK; the rename path is documented in the service
  header (migrations frozen post-foundation-commit).
- **Fee invoice provenance**: created with a system actor then approved via the
  invoice service's documented override arm (audited
  `sales.credit_check_overridden`) — blocking a contractual fee on the
  delinquency it remedies would be circular.
- **EMAIL delivery**: the EmailService template union is closed — EMAIL letters
  store the deterministic bilingual snapshot + contact and mark SENT (the
  register IS the delivery evidence, 0056's columns); no email on file →
  FAILED, step consumed. WHATSAPP/SMS stay QUEUED for the 041 port.
- **Golden re-pins**: all 37 effective-config pins re-pinned (the 0056 grants +
  the four dep edges) with the PHASE-039 review note — the recorded P32
  procedure; the old→new table lives in this report's §2 (feature-flags item).
- **Isolation OWN_ROW**: the dunning agent's registry rows initially lacked the
  OWN_ROW/seed/MISMATCHED fixtures (the generated A-suite crashed at
  collection) — repaired in the gate wave with the sourcing-cluster pattern;
  the certificates spec flake in the first full-suite run was a knock-on of
  that crash (verified: passes alone, passes with the 039 specs, and the
  re-run full suite is 0-failed).
- **The environmental note**: `zatca-qr-decode.spec.ts` requires Playwright
  browsers absent from this sandbox — pre-existing (verified on clean HEAD),
  unrelated to 039, and the only non-green unit file.

## 5. Delivery

Repository state archived as **`ERP_PLATFORM_PHASE039.zip`** (OA-07). The
triple flip: this report + the PHASE-039.md header + the IMPLEMENTATION_STATUS
row + NEXT_ACTION → PHASE-040. **Stop point: per the owner's standing rule,
execution halts here and awaits the owner's go before PHASE-040 (Data
Onboarding & Migration Toolkit).**
