# PHASE-011 — Purchasing & Payables

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-011
- **Title:** Purchasing & Payables
- **Objective:** Deliver the full procure-to-pay chain — `purchase_requests` →
  `purchase_orders` → `goods_receipts` → `supplier_invoices` → `debit_notes` — with
  goods receipts receiving stock through the PHASE-010 inventory services and posting
  the GRNI accrual, supplier invoices clearing GRNI and posting AP with VAT
  recoverable/expensed per the tax engine, three-way matching with tolerance policies
  recorded before approval, supplier payments with allocations mirroring the receipt
  pattern, AP aging and supplier statements as deterministic as-of views, landed-cost
  baseline allocation, supplier price lists, and settlement of opening AP balances.
- **Business value:** Purchasing is where money leaves the business; the three-way match
  (BR-009) plus GRNI discipline means a tenant can answer "what did we receive that
  isn't invoiced, and what did we pay that wasn't ordered" at any moment — and AP
  statements that tie to the `AP_CONTROL` account (INV-009) make supplier disputes
  resolvable with evidence (persona P-06, purchasing manager).

## 2. Scope

In scope:

1. **Document chain & lifecycles** per
   [../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §3:
   purchase requests (requisitions with approval routing → PO), purchase orders
   (DRAFT → ISSUED → CLOSED, amendments as linked revisions, supplier/branch/expected
   date, approval thresholds BR-010), goods receipts (POSTED receives stock + GRNI
   accrual), supplier invoices (POSTED clears GRNI, posts AP; **match outcome recorded
   before approval**), debit notes (mirror supplier-invoice corrections). All documents
   carry the core state machine (DRAFT/PENDING_APPROVAL/APPROVED/POSTED/REVERSED/
   CANCELLED) with per-type variations.
2. **Goods receipts (feature `purchasing.goods_receipts`):** GRN posts through
   PHASE-010's `receiveStock` (batches captured at receipt where items are tracked) and
   the posting engine: `DR INVENTORY (or expense/asset account) · CR GRNI` per
   [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4 (golden
   G-07); PO-less "direct purchase" receipts require explicit permission + reason and
   may be forbidden by policy (BR-012, `purchasing.allow_po_less_grn = true` default).
3. **Supplier invoices (feature `purchasing.supplier_invoices`):** record the supplier's
   own invoice number (uniqueness per BR-011 — `(supplier, number, amount)` duplicate →
   block, `(supplier, number)` with different amount → warn,
   `purchasing.duplicate_invoice_behavior = block` default); posting clears the matched
   GRNI lines and posts `DR INVENTORY/expense · DR VAT_RECOVERABLE (if eligible) · CR
   AP_CONTROL (partner)` (golden G-08); due date from supplier credit terms
   ([../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
   §2); tax lines come from the PHASE-009 engine with snapshots stamped per line.
4. **VAT recoverability resolution:** input VAT posts to `VAT_RECOVERABLE` or
   `VAT_EXPENSED` per treatment/eligibility rules from
   [../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) (recoverability
   depends on the tenant's registration status **and** the jurisdiction pack — e.g.,
   inputs related to exempt supplies are expensed; an unregistered tenant records
   `NOT_SUBJECT` and no VAT lines). Document tax summaries accumulate by (treatment,
   rate, tax code) for the INV-012 tie.
5. **Three-way matching (feature `purchasing.three_way_matching`):** PO ↔ GRN ↔ invoice
   consistency per BR-009 with tenant tolerances
   (`purchasing.match.qty_tolerance_pct = 0`, `purchasing.match.price_tolerance_pct = 0`
   — exact by default); variances within tolerance auto-pass with the variance recorded;
   above tolerance requires buyer disposition (accept-with-reason / debit note / GRN
   amendment) before approval; the `match_result` (per-line outcomes + dispositions) is
   stored on the supplier invoice pre-approval and is audit-visible; override requires
   `purchasing.matching.override` (risky).
6. **Debit notes (feature `purchasing.debit_notes`):** AP corrections mirroring supplier
   invoices (golden G-09: `DR AP_CONTROL · CR INVENTORY/expense · CR VAT_RECOVERABLE`),
   referencing the original invoice; corrections are always new documents (INV-003,
   BR-031).
7. **Payments + allocations (feature `purchasing.payments`):** the `payments` document
   (owned by purchasing, money movement via the PHASE-008 treasury service) posts
   `DR AP_CONTROL (partner) · CR cash/bank` (golden G-10) with FX-difference lines on
   settlement (mirroring receipt mechanics, INV-008); explicit allocations to open
   supplier invoices with FIFO suggestion and manual override, partial allocations and
   **on-account** remainders (BR-027); allocation totals never exceed the payment
   (INV-016); post-allocation re-allocation happens via audited re-allocation documents.
8. **AP subledger, aging & statements:** supplier open-item subledger
   ([../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
   §1/§7) — supplier invoices (+), debit notes (−), payments (−), FX-difference and
   adjustment entries; **aging buckets** (not due, 1–30, 31–60, 61–90, 90+) and
   **supplier statements** (running balance, aging column, document currency + base
   total) computed as deterministic recomputations from immutable entries at the as-of
   date (BR-028); module screens ship here — the report-contract registration and
   print/PDF of `ap.aging`, `supplier.statement`, `purchasing.grni`, `purchasing.po-status`,
   `purchasing.matching-exceptions` land with the PHASE-013 engine over this phase's
   query services (`apQueries.*`, `matchingQueries.*`, `poQueries.*` per
   [../../reporting/REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) §2/§3).
9. **GRNI register:** received-not-invoiced visibility per GRN line (received qty/cost −
   invoiced qty/cost) with the reconciliation tie to the `GRNI` account (RC-09;
   RECONCILIATION map row 8).
10. **Landed costs baseline (feature `purchasing.landed_costs`, baseline here per
    [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md)
    §3):** `landed_costs` rows on a GRN (cost_type: freight/customs/insurance/other)
    allocate across received lines **by value or by quantity** (tenant-configured),
    revaluing the affected WAC/layers **before any issue from that stock** where
    operationally possible; when stock was already issued at the lower cost, allocation
    applies to **remaining quantity** (remaining-qty constraint) and the difference
    posts to a COGS-adjustment purpose — documented, auditable, no silent back-dating.
    The full workflow UI + entitlement activation completes in PHASE-015.
11. **Supplier price lists:** purchase-kind price lists from PHASE-006
    (`price_lists.kind = 'purchase'`) consumed by PO/supplier-invoice line pricing via
    the items price-resolution service (BR-003 precedence, purchase-side analogue);
    price overrides within policy ceilings only.
12. **Opening AP balances settlement:** opening partner balances posted by PHASE-007
    (G-16, supplier side) become allocatable open items on the AP subledger; payments
    settle them like any invoice; statements/aging include them deterministically; a
    verification script proves the open-item sum equals `AP_CONTROL` from the first
    entry (INV-009).
13. **UI screens** per [../../ui/PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md):
    PR/PO/GRN/supplier-invoice/debit-note/payment transaction-entry workspaces (§4),
    document detail with match-result panel (§5), approval queue (§6), AP aging +
    supplier statement lists (§2), GRNI register list.
14. **API + permission seeds** per §4 below; official numbering per BR-029 (sequence per
    tenant/branch/type; assign-at policy; voided numbers stay reserved, INV-021).

Out of scope (explicit):

- Sales-side anything (PHASE-012) — including the AR mirror of allocations (built there,
  reusing this phase's allocation service patterns).
- Landed-cost full workflow UI, entitlement gating, and COGS-adjustment analytics
  (PHASE-015).
- Report-contract registration into the reporting engine + PDF/XLSX/CSV exports of AP
  reports (PHASE-013 — this phase ships the query services and simple screens).
- Purchase-order approval workflow beyond the standard threshold policy (BR-010) — no
  multi-level custom workflows at MVP.
- Supplier portal / personal-account supplier views (post-MVP, per
  [../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
  §6 — customer portal first).
- E-invoicing inbound (supplier XML ingestion) — PHASE-023 adapter framework only.
- Automatic PO creation from reorder alerts (explicitly not done, BR-019).

## 3. Prerequisites

- Required phases: **PHASE-010** COMPLETE — goods receipts call `inventory.receiveStock`
  and depend on stock layers/WAC for cost capture; verified via its completion report +
  green CI. Implicitly required (transitive): PHASE-008 (treasury money-movement service
  consumed by payments; `purchasing.payments.*` permissions), PHASE-009 (tax engine stamps
  on supplier-invoice lines), PHASE-007 (posting engine, `GRNI`/`AP_CONTROL`/
  `VAT_RECOVERABLE`/`VAT_EXPENSED` purposes, OPENING period), PHASE-006 (partners with
  supplier kind, credit terms, purchase price lists, items).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (purchasing
  composes engine calls in one transaction; it never writes GL tables),
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (VAT
  recoverability from pack + registration, never hard-coded),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (numbering).
- Relevant documentation:
  [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4 (GRN,
  supplier invoice, debit note, payment rules),
  [../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
  (per-type variations),
  [../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
  (AP subledger, aging, allocations mirror),
  [../../accounting/RECONCILIATION.md](../../accounting/RECONCILIATION.md) (rows 2, 8),
  [../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) (§2 resolution
  flow, §1 recoverable/expensed separation),
  [../../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-009…BR-012,
  BR-025…BR-028, BR-029…BR-036),
  [../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §purchasing,
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.3,
  [../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (G-07…G-10,
  G-16 AP side, RC-02/RC-03/RC-09, CC-01/CC-02).

## 4. Design Impact

- **Database changes:** new tenant-owned tables per
  [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §purchasing —
  `purchase_requests`, `purchase_orders`, `goods_receipts`, `supplier_invoices`,
  `debit_notes`, `landed_costs`; `payments` gains its AP-allocation columns/rows
  (entity introduced by PHASE-008 as generic disbursement). Key fields:
  `supplier_invoices.match_result` (jsonb of per-line match outcomes + dispositions),
  `invoice_no` (supplier's) + `internal_no`, `due_date`, `tax_summary`. All tables: RLS,
  tenant-first indexes, status check constraints; registry rows +
  A-test coverage mandatory. No changes to `stock_moves`/`journal_*` (other modules'
  territory).
- **API changes:** `/api/v1/purchasing/purchase-requests` (+ `/approve`);
  `/purchase-orders` (+ `/issue`, `/close`); `/goods-receipts` (+ `/post`);
  `/supplier-invoices` (+ `/match` preview, `/approve`, `/post`); `/debit-notes`
  (+ `/post`); `/payments` (+ `/post`, `/allocate`); `/ap/aging`, `/ap/statements`
  (module-screen read endpoints over `apQueries.*`). POST actions carry
  Idempotency-Key; errors use the typed envelope
  ([../../api/API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) §1–3,
  [../../api/ERROR_MODEL.md](../../api/ERROR_MODEL.md)).
- **UI changes:** six transaction workspaces + document details (match-result panel
  shows per-line PO/GRN/invoice triple with variance highlighting), approval queue
  entries for POs above threshold and match exceptions, AP aging + supplier statement
  screens with FilterBar + saved filters, GRNI register list; `DocumentStatusBadge`
  per lifecycle; AR+EN, RTL-first.
- **Security & authorization:** seed
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.3
  exactly: `purchasing.purchase_requests.view/create/approve`,
  `purchasing.purchase_orders.view/create/approve`,
  `purchasing.goods_receipts.view/create/approve`,
  `purchasing.supplier_invoices.view/create/approve/post`,
  `purchasing.debit_notes.view/create/approve/post`,
  `purchasing.matching.override` (risky), plus `purchasing.payments.view/create/approve`
  for the money leg; branch scoping on documents, tenant scoping on invoice posting
  (matrix rules); SoD: creator ≠ approver default (BR-034).
- **Accounting implications:** new engine operations exercised: GRN accrual (G-07),
  supplier invoice + GRNI clear (G-08), debit note (G-09), payment with FX (G-10);
  invariants: INV-009 (AP subledger = `AP_CONTROL`), INV-012 (input VAT ties),
  INV-016 (allocation bounds), INV-013/014/021 inherited; GRNI account becomes live —
  add reconciliation row 8 job coverage (RC-09).
- **Localization implications:** document titles, match-exception reasons, and state
  labels bilingual (AR canonical: سند استلام البضاعة، المطابقة الثلاثية per
  [../../GLOSSARY.md](../../GLOSSARY.md)); supplier statements show document currency +
  base totals; RTL tables with LTR-isolated numerals.
- **Offline implications:** none — purchasing documents are back-office; OC = no for all
  phase tables per ENTITY_CATALOG; recorded in
  [../../offline/OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  as not-offline at MVP.
- **Module dependencies:** `purchasing` depends on `inventory` (receiveStock), `items`
  (price resolution), `partners` (supplier lookup, credit terms, subledger), `treasury`
  (money movement for payments), `tax` (line stamps + summaries), `accounting`
  (PostingEngine, numbering, periods), `audit`; publishes `apQueries.*`,
  `matchingQueries.*`, `poQueries.*` for PHASE-013 and mirrors its allocation patterns
  forward to PHASE-012
  ([../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migrations: purchasing tables + RLS + registry + indexes (+ payments AP-allocation columns) | `apps/api/migrations/NNNN_purchasing_core.sql`, `NNNN_purchasing_ap.sql` | fresh + regression apply; RLS check green |
| T2 | Purchase requests + PO lifecycle (revisions, thresholds BR-010, numbering) | `apps/api/src/modules/purchasing/application/orders.ts` | lifecycle + threshold routing tests; INV-021 numbering tests |
| T3 | GRN service: lines → `inventory.receiveStock` (batch capture) + GRNI posting via engine | `apps/api/src/modules/purchasing/application/goods-receipts.ts` | G-07 golden + failure pack; PO-less GRN policy (BR-012) |
| T4 | Three-way matching service: tolerance policies, per-line outcomes, dispositions, `match_result` storage | `apps/api/src/modules/purchasing/application/matching.ts` | BR-009 tolerance matrix tests (exact/2% short-receipt/price variance); match-before-approval enforced |
| T5 | Supplier invoices: duplicate checks (BR-011), tax stamps, GRNI clear + AP posting | `apps/api/src/modules/purchasing/application/supplier-invoices.ts` | G-08 golden (incl. VAT recoverable AND expensed fixtures); RC-09 at each step |
| T6 | VAT recoverability wiring per pack + registration (VAT_RECOVERABLE vs VAT_EXPENSED vs NOT_SUBJECT) | `apps/api/src/modules/purchasing/application/tax-lines.ts` | per-pack fixture tests ([../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §6); INV-012 tie (RC-06) |
| T7 | Debit notes (mirror corrections, reference chain) | `apps/api/src/modules/purchasing/application/debit-notes.ts` | G-09 golden; reversal-pair integrity (INV-014) |
| T8 | Payments via treasury service + AP allocation service (FIFO suggestion, partial, on-account, re-allocation) | `apps/api/src/modules/purchasing/application/payments.ts`, `allocations.ts` | G-10 (+ FX mirror of W-2); INV-016 bounds (property + CC-02 concurrency) |
| T9 | AP subledger + aging + statements (deterministic as-of) + GRNI register queries | `apps/api/src/modules/purchasing/application/ap-queries.ts` | RC-02 exact tie; RC-03 seeded drift → BROKEN; determinism re-run (RC-10) |
| T10 | Landed-cost baseline allocation (value/qty, remaining-qty constraint, COGS-adjustment posting) | `apps/api/src/modules/purchasing/application/landed-costs.ts` | allocation property tests; issue-then-landed-cost case posts adjustment (documented) |
| T11 | Supplier price-list consumption in PO/invoice pricing | `apps/api/src/modules/purchasing/application/pricing.ts` | price-resolution precedence tests (BR-003 purchase-side) |
| T12 | Opening AP settlement verification + statement inclusion | `apps/api/src/modules/purchasing/application/opening-ap.ts` | G-16 AP side: open items from entry #1; INV-009 exact |
| T13 | UI workspaces + match panel + aging/statement/GRNI screens (AR+EN) | `apps/web/app/{locale}/purchasing/**` | Playwright bilingual smoke; visual snapshots; match-exception panel a11y |
| T14 | API routes + permission seeds + docs sync | `apps/api/src/modules/purchasing/api/**`, `docs/database/**` | docs validation; permission-seed-vs-matrix drift check green |

## 6. Verification

**Automated tests (required):**

- **Posting golden tests per operation** (each with expected journal lines by purpose,
  subledger effects, document state, audit event, and the standard failure pack —
  locked period, unmapped purpose, unbalanced, duplicate post — all zero-residue):
  - G-07 GRN: `DR INVENTORY Q×U · CR GRNI Q×U`; stock +Q layer/WAC update; GRNI
    register +Q×U.
  - G-08 supplier invoice: `DR INVENTORY/expense N · DR VAT_RECOVERABLE N×t · CR
    AP_CONTROL N×(1+t)` **and** the GRNI-clearing leg; AP +; GRNI −; match links
    recorded. Variants: VAT expensed (ineligible input), NOT_SUBJECT (unregistered).
  - G-09 debit note: mirror adjustment; AP −.
  - G-10 payment: `DR AP_CONTROL · CR CASH` + FX gain/loss residual line (mirror of
    worked example W-2 in
    [../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §3.2).
- **Failure paths (mandatory):**
  - *Match fail:* supplier invoice with 0% tolerance and price variance → approval
    blocked until disposition; `match_result` shows the failing line; posting without a
    recorded match outcome is rejected (service-level guard).
  - *Partial receipt:* GRN 98/100 → only received qty matchable; PO stays open for the
    remainder; supplier invoice for 100 → quantity exception on the 2-unit gap.
  - *Price variance:* invoice 51.00 vs PO 50.00 with 0% tolerance → exception; with 2%
    tolerance → auto-pass with variance recorded (BR-009 worked example).
  - *Duplicate invoice:* same (supplier, number, amount) → blocked; same number,
    different amount → warn (BR-011).
  - *Allocation over-run:* allocate beyond payment amount or invoice open → rejected,
    both sides unchanged (INV-016).
- **AP reconciliation:** RC-02 (20 randomized AP ops → `OK`, Σ subledger = AP_CONTROL
  exactly); RC-03 seeded subledger drift → `BROKEN` + notification + close blocked;
  RC-09 GRNI register = GRNI account at each step (GRN → invoice → partial invoice).
- **INV-012 input-tax tie:** RC-06 with recoverable + expensed mix per-pack fixtures;
  VAT return draft shows both sides equal.
- **INV-013 idempotency:** CC-01 duplicate posting (sequential + concurrent) → one
  entry set, loser gets stored result; payment/grn/supplier-invoice retry semantics.
- **Concurrency:** CC-02 two payments allocating one invoice → allocated total ≤ open;
  CC-03 numbering race; CC-05 period-lock race on supplier-invoice posting.
- **Tenant isolation:** A-tests for every new table + API spoofing (cross-tenant
  supplier id, cross-branch GRN) → 404/no-existence-leak.
- **Determinism:** aging/statement re-run at same as-of → byte-identical (RC-10).

**Manual verification:**

1. Run the full chain on a staging tenant: PR → PO (approve) → GRN (post; watch stock
   arrive and GRNI appear) → supplier invoice (match preview → approve → post; watch
   GRNI clear and AP open) → payment (allocate; watch the statement settle).
2. Break the match on purpose (price +2%) with 0% tolerance; walk the disposition flow
   (accept-with-reason) and verify the audit trail.
3. Open the supplier statement as-of a past date before and after posting a back-dated
   invoice; confirm determinism and the INV-009 footer badge on the screen.
4. Add a freight landed cost to a partially issued GRN; verify remaining-qty allocation
   and the explicit COGS-adjustment line (no silent back-dating).
5. Verify a PO-less GRN demands reason + permission; disable the policy and confirm it
   is refused (BR-012).

**Acceptance criteria (objective):**

1. All purchasing tables exist with RLS + registry rows; migration CI green (fresh +
   regression).
2. G-07/G-08/G-09/G-10 golden suites pass with failure packs and zero residue; the
   GRNI-clearing and FX legs are exact.
3. Three-way matching enforces BR-009 with both tolerance defaults (exact) and loosened
   values; `match_result` is recorded before approval on every supplier invoice; no
   posting path bypasses it.
4. VAT input lines resolve per tenant registration + pack (RECOVERABLE / EXPENSED /
   NOT_SUBJECT) with snapshots; INV-012 tie green on per-pack fixtures.
5. AP subledger = `AP_CONTROL` at all times (RC-02), seeded drift is detected (RC-03),
   and GRNI register ties (RC-09).
6. Aging + supplier statements are deterministic as-of recomputations (RC-10) including
   opening AP items; statements show document currency + base totals.
7. Allocations honor INV-016 under concurrency; on-account amounts are visible and
   allocatable later; re-allocations are audited documents.
8. Landed-cost baseline allocates by value or quantity with the remaining-qty
   constraint and explicit COGS-adjustment posting.
9. Duplicate-invoice checks behave per BR-011; PO approval thresholds per BR-010 route
   correctly with SoD (creator ≠ approver default).
10. All phase acceptance rows mirrored in
    [../../planning/PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
    (PHASE-011 row) once that file lands.

**Performance & security considerations:** supplier-invoice posting p95 within the T-02
posting budget (engine path); aging/statement queries index on
`(tenant_id, partner_id, due_date)` and must EXPLAIN-verify at 100k AP documents;
match preview runs on bounded line sets. Security: `purchasing.supplier_invoices.post`
and `purchasing.matching.override` are risky/audited; match dispositions carry reasons;
no document-mutation endpoints exist for POSTED docs (INV-003).

**Migration & rollback:** expand-only migrations (new tables + additive `payments`
columns). Rollback in dev = revert + drop phase tables; production forward-only per
[../../database/MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md). GRNI/AP
subledger rows written by posting are immutable from day one — no rollback may remove
them.

## 7. Risks and Constraints

- RISK-009: the GRNI clear + AP post is a two-sided ledger dance — golden tests with
  partial-invoice cases are the control; drift here is Sev-1.
- RISK-006 (tax rules change mid-development): pack-versioned rates + line snapshots
  keep posted invoices stable; drafts warn (BR-033).
- RISK-011 (double-posting): payment/invoice retries + future sync deliveries serialize
  on posting-operation keys (INV-013) — tested via CC-01.
- RISK-016: purchasing must not read `journal_lines` directly for statements — it uses
  its own subledger + engine results; boundary lint enforced.
- RISK-019/RISK-020 (agent drift/docs drift): completion report must list BR-009…BR-012,
  BR-025…BR-028 coverage with test names; docs sync in the same PR.
- Constraint: `landed_costs` here is the **baseline only** — allocation math + remaining-
  qty constraint; the full workflow UI and entitlement activation are PHASE-015 scope
  (FEATURE_CATALOG), not to be pulled forward without a decision record.
- Constraint: report contracts for AP views are NOT registered in this phase (engine
  arrives PHASE-013); the screens here are module-owned lists over `apQueries.*`.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-011-COMPLETION.md` with: golden suite
  outputs (G-07…G-10 incl. failure paths), match-disposition walkthrough output, RC-02/
  03/09 outputs, INV-012 per-pack tie, CC-01/02 outputs, migration CI logs, isolation
  A-test results, T-02 posting latency numbers.
- **Documentation updates required:** ENTITY_CATALOG §purchasing sync, TABLES specs for
  purchasing tables, IMPLEMENTATION_STATUS (PHASE-011 → COMPLETE), CHANGELOG; any
  deviation from BR/INV text needs a decision record before merge.
- **Exit criteria:** all acceptance criteria green with evidence; invariants with new
  coverage listed (INV-009 AP side, INV-012 input side, INV-016); docs validation green;
  zero TODOs.
- **Definition of Done:** `main` contains the full P2P chain with golden + isolation +
  concurrency suites green in CI; bilingual UI screens with visual baselines; the
  allocation-service patterns documented for PHASE-012's mirror.
- **Handoff instructions:** next agent reads the PHASE-011 completion report and the
  allocation/subledger service contracts — PHASE-012 mirrors them for AR and reuses the
  posting sequencing discipline. **Next eligible phase: PHASE-012 — Sales &
  Receivables** (identify only; do not implement).
