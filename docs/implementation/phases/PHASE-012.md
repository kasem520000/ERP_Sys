# PHASE-012 — Sales & Receivables

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-012
- **Title:** Sales & Receivables
- **Objective:** Deliver the quote-to-cash chain — quotations (SENT/ACCEPTED/REJECTED/
  EXPIRED with conversion), sales orders (with optional soft stock reservation), delivery
  notes (stock issue + COGS, converting to invoice), sales invoices (cash and credit,
  tax snapshots from the PHASE-009 engine, official numbering at posting, posting rules
  exactly per POSTING_ENGINE §4), credit notes (returns re-entering stock at original
  cost, allocating to invoices per policy), receipts (consuming the PHASE-008 treasury
  service) with allocations and on-account handling, server-side credit-limit
  enforcement at approval, AR aging and customer statements as deterministic as-of
  views, sales-rep attribution, return-window policy, and price-list resolution —
  completing Journey A's first-invoice path (steps A7–A8) with the full document chain.
- **Business value:** This is the revenue surface: a trader invoices a customer in
  Arabic, tax is stamped per the jurisdiction pack, stock and COGS post atomically,
  credit risk is enforced at approval, and every riyal of AR traces to the ledger
  (INV-009). It is the phase that makes the platform *usable for business* —
  personas P-01/P-05 (owner, sales).

## 2. Scope

In scope:

1. **Quotations (feature `sales.quotations`):** DRAFT → SENT → ACCEPTED (converts to
   sales order) / REJECTED / EXPIRED per
   [../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §3;
   no ledger effect; `valid_until` enforced (BR-006 — an expired quote cannot be
   accepted or converted; re-issue as a new quotation); default validity
   `sales.quote_default_validity_days = 30`.
2. **Sales orders (feature `sales.orders`):** confirmed orders with line-level optional
   **soft reservation** against the PHASE-010 availability service (expiry-honored,
   non-blocking); branch + warehouse targeting; source of deliveries and invoices.
3. **Delivery notes (feature `sales.deliveries`):** POSTED issues stock through
   `inventory.issueStock` + posts the COGS journal (`DR COGS · CR INVENTORY` at issue
   cost, golden G-03) **without AR**; converts to invoice later; document-flow policy
   BR-007 (`sales.doc_flow = delivery_then_invoice` default; `invoice_then_delivery`
   equally first-class — stock and AR effects post at their own documents).
4. **Sales invoices (features `sales.invoices`, `sales.discount_management`):**
   - Cash and credit kinds; lines with qty/UoM/unit price/discount/tax code; price
     resolution per BR-003 precedence (customer's price list → tier list → branch
     default → item base price) via the PHASE-006 items service; manual overrides within
     role ceilings (BR-002).
   - Tax lines from the PHASE-009 engine with **snapshots stamped per line** at posting;
     drafts recompute live; posting recomputes at the rate effective at posting per pack
     rules with warnings recorded on drafts spanning a rate change (BR-033); unregistered
     tenants compute `NOT_SUBJECT`.
   - Official numbering at posting per BR-029/A-010 (per tenant/branch/type sequence;
     voided numbers reserved, INV-021); cash invoices may auto-post on save per policy
     (`sales.cash_autopost = off` in back office; POS variant later — BR-005 records
     `approved_by = policy` distinctly from `posted_by`).
   - Posting rules **exactly** per
     [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4:
     credit → `DR AR_CONTROL (partner) · CR SALES_REVENUE · CR VAT_PAYABLE` (G-01);
     cash → `DR cash/bank · CR revenue · CR VAT_PAYABLE` (G-02); with-goods → COGS entry
     `DR COGS · CR INVENTORY` (G-03); sequencing per §5 (approve → issueStock → COGS
     post → tax stamp → AR post → subledger → audit — one transaction).
5. **Credit notes (feature `sales.credit_notes`):** returns and corrections referencing
   an invoice; return-window policy BR-004 (`sales.return_window_days = 14`, 0 =
   unlimited — the date check may be disabled, the reference requirement **never**);
   return stock **re-enters at the original issue cost** from the referenced invoice
   line per [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md)
   §2 (golden G-04 + worked example W-3: `DR INVENTORY · CR COGS` at original cost, batch
   preserved, serial binds the originally sold unit per BR-018); credit notes allocate
   to invoices explicitly (auto-apply-to-oldest policy default OFF) per
   [../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
   §3.4; standalone credit notes only when policy-flagged.
6. **Receipts (feature `sales.receipts`):** the `receipts` document (owned by sales,
   money movement via the PHASE-008 treasury service — `treasury.receipts_disbursements`);
   cash/bank/cheque methods, currency + FX rate stored (INV-008); posts `DR cash/bank ·
   CR AR_CONTROL (partner)` with **FX gain/loss residual lines** at settlement (G-05,
   W-2); DRAFT → POSTED (no approval by default; policy may add). (Blueprint v2.0
   reconciliation: "cheque" here is the payment-method flag only — the full
   cheque/notes custody lifecycle is delivered in PHASE-027 via the `notes` module
   per [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-03.)
7. **Allocations (feature `sales.allocations`):** explicit receipt↔invoice allocations
   with FIFO suggestion and manual override before posting; one receipt → many
   invoices; partial allocations; **on-account** remainders as explicit open items
   (BR-027, never silently netted); allocated totals never exceed the receipt or the
   invoice (INV-016); post-posting changes only via audited re-allocation documents;
   on-account advances may post to `DEPOSITS_RECEIVED` where tenant policy distinguishes
   them ([../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
   §4).
8. **Credit limits (features `sales.credit_limits` + `partners.credit_management`
   consumption):** server-side enforcement at **sales invoice approval** via the
   partners credit-check service (open balance + this invoice vs. limit; overdue
   invoices factored); policy `sales.credit_limit_action = warn` default, block/ignore
   per tenant; per-partner override; block posture disables the post button and offers
   escalation (partial shipment / cash conversion / owner approval recorded on the
   document — BR-001 worked example); override requires `sales.credit_check.override`
   (risky, audited); UI only reflects the server decision.
9. **AR aging + customer statements (feature `sales.receivables_aging`):** open-item
   aging buckets (not due, 1–30, 31–60, 61–90, 90+) and customer statements (running
   balance, aging column, document currency + base total) as **deterministic as-of
   recomputations** (BR-028) over the AR subledger; statement balance = partner
   subledger sum = partner's contribution to `AR_CONTROL` (INV-009) verified in the
   statement path; `invoice.overdue` job fires notifications; module screens ship here —
   report-contract registration + printing of `ar.aging`, `partner.statement`,
   `ar.allocations` is PHASE-013 scope over this phase's `arQueries.*`.
10. **Sales reps attribution (feature `sales.reps`):** `sales_reps` records + rep
    attribution on sales documents; **commissions are explicitly deferred to PHASE-017**
    (`sales.commissions`, per
    [../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §sales) — no
    commission computation ships here.
11. **UI screens:** full quote→order→delivery→invoice→credit-note chain workspaces,
    receipt allocation workspace (allocation panel with FIFO suggestion + on-account
    handling), aging/statement views (print deferred to PHASE-013 — noted in the UI with
    an honest "available at reporting release" state), approval queue with credit-limit
    warning presentation.
12. **API + permission seeds + numbering policies** per §4.

Out of scope (explicit):

- POS screens, terminal sessions, offline receipt numbers (PHASE-016 — the invoice
  schema's `offline_receipt_no` column exists but stays unused).
- Commissions computation and statements (PHASE-017).
- Customer tiers, free-goods policies (PHASE-017 distribution pack; free-goods
  zero-price line *format* is allowed here per BR-008 but no policy engine).
- Report-contract registration + PDF/XLSX/CSV/print of AR views (PHASE-013).
- Online payment links / portal payments (OQ-007, post-MVP).
- Quotation→invoice direct conversion skipping orders (policy simplification — chain
  goes through orders; revisit via decision record if design partners need it).
- E-invoicing submission (framework only exists since PHASE-009; adapters PHASE-023).

## 3. Prerequisites

- Required phases: **PHASE-011** COMPLETE — sales reuses the allocation/subledger
  patterns and posting discipline proven there (AP/AR symmetry,
  [../../planning/PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md)
  edge 011→012); the invoice chain consumes items/inventory/tax services. Transitive:
  PHASE-008 (treasury receipt service + FX difference mechanics), PHASE-009 (tax engine
  + snapshots), PHASE-010 (issueStock, availability, re-entry), PHASE-007 (engine,
  `AR_CONTROL`/`SALES_REVENUE`/`SALES_RETURNS`/`VAT_PAYABLE`/`COGS` purposes), PHASE-006
  (partners credit data, price lists, items).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (one
  transaction composes stock + tax + AR postings; sales never writes GL),
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (snapshots),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md).
- Relevant documentation:
  [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) (§4 rules —
  binding; §5 sequencing example),
  [../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
  (quotation/order/delivery/invoice/credit-note/receipt variations),
  [../../accounting/RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
  (AR subledger, allocations, credit management, statements),
  [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md)
  (§2 return re-entry at original cost; §4 COGS discipline),
  [../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) (§2 resolution,
  §3 versioning/snapshots),
  [../../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-001…BR-008,
  BR-027, BR-028, BR-029…BR-036),
  [../../product/USER_JOURNEYS.md](../../product/USER_JOURNEYS.md) (Journey A steps
  A7–A8 + edge branches; Journey C step C3),
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.2,
  [../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (G-01…G-06,
  W-1/W-2/W-3, RC-01/03/10, CC-01…CC-05).

## 4. Design Impact

- **Database changes:** new tenant-owned tables per
  [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §sales —
  `quotations`, `sales_orders` (with reservation references), `delivery_notes`,
  `sales_invoices` + `sales_invoice_lines` (tax_snapshot jsonb per line,
  `offline_receipt_no?` reserved for PHASE-016, `einvoice_status` reserved for
  PHASE-023), `credit_notes`, `sales_reps`; `receipts` gains AR-allocation rows/columns
  (entity from PHASE-008). All tables: RLS, tenant-first indexes, status checks,
  `uq_sales_invoices_tenant_branch_number` (INV-021), registry rows + A-tests.
- **API changes:** `/api/v1/sales/quotations` (+ `/send`, `/accept`, `/reject`,
  `/convert`); `/sales-orders` (+ `/approve`); `/delivery-notes` (+ `/post`,
  `/convert-to-invoice`); `/sales-invoices` (+ `/approve`, `/post`); `/credit-notes`
  (+ `/post`, `/allocate`); `/receipts` (+ `/post`, `/allocate`); `/ar/aging`,
  `/ar/statements`, `/ar/allocations` (module screens over `arQueries.*`);
  `POST /api/v1/partners/partners/{id}/credit-check` (published service consumed at
  approval). Idempotency-Key on all POST actions
  ([../../api/API_CONVENTIONS.md](../../api/API_CONVENTIONS.md)); typed error codes for
  credit-limit (`CREDIT_LIMIT_EXCEEDED` with math), stale-price/inactive-item (aligned
  with the sync reason registry vocabulary —
  [../../offline/SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md) §3.4 — so the same
  codes serve PHASE-020 rejections).
- **UI changes:** five transaction workspaces (quote, order, delivery, invoice, credit
  note) with live totals + tax preview; document-detail screens with status timeline;
  receipt allocation workspace (FIFO suggestion chips, partial/on-account states);
  aging + statement list screens; approval queue showing credit-limit warnings (BR-001
  presentation: block = disabled post + escalation, warn = hard warning with math);
  `DocumentStatusBadge` state map per lifecycle; AR+EN RTL-first with MoneyInput/
  DataTable norms ([../../ui/COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md)).
- **Security & authorization:** seed
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.2
  exactly: `sales.quotations.view/create/approve/convert`,
  `sales.orders.view/create/approve`, `sales.deliveries.view/create`,
  `sales.invoices.view/create/approve/post`, `sales.credit_notes.view/create/approve/
  post`, `sales.reps.manage`, `sales.credit_check.override` (risky), plus
  `sales.receipts.view/create/approve` for the money leg and
  `sales.receivables.read`/`partners.statements.view` for AR views. Branch scoping on
  documents; tenant scope on statements; approval limits evaluated server-side with
  tax-inclusive totals (BR-034).
- **Accounting implications:** engine operations exercised: G-01 (credit AR), G-02
  (cash), G-03 (COGS), G-04 (credit note + re-entry), G-05 (receipt), G-06 (receipt FX);
  invariants: INV-009 (AR subledger = control), INV-013 (idempotent posting — sync
  deliveries later depend on it), INV-016 (allocations), INV-021 (numbering), INV-007/
  011/012 inherited; sales-retains contra purpose aggregation feeds the IS later
  ([../../reporting/FINANCIAL_REPORT_RULES.md](../../reporting/FINANCIAL_REPORT_RULES.md)
  §3).
- **Localization implications:** canonical Arabic document titles (فاتورة ضريبية /
  إشعار دائن / سند القبض per [../../GLOSSARY.md](../../GLOSSARY.md)); tax-display per
  registration (unregistered → no VAT lines, honest books); numerals Western
  LTR-isolated; inclusive/exclusive pricing default per tenant setting with per-document
  override ([../../localization/TAX_ENGINE.md](../../localization/TAX_ENGINE.md) §5).
- **Offline implications:** none active — `sales_invoices` OC flag is "POS yes" and
  `receipts` "POS yes" (columns + idempotency keys ready for PHASE-016/020); back-office
  sales docs are online-only at MVP; recorded in
  [../../offline/OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md).
- **Module dependencies:** `sales` depends on `items` (pricing), `partners` (credit
  check, subledger), `inventory` (issueStock/re-entry/availability), `treasury` (money
  movement), `tax` (stamps/summaries), `accounting` (engine, numbering, periods),
  `audit`, `notifications` (overdue job); publishes invoice/credit-note services +
  `arQueries.*` consumed by PHASE-013 reporting and later POS/distribution
  ([../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migrations: sales tables + RLS + registry + numbering unique constraints (+ receipts AR columns) | `apps/api/migrations/NNNN_sales_core.sql`, `NNNN_sales_ar.sql` | fresh + regression apply; RLS check; INV-021 unique-index test |
| T2 | Quotation service: validity, states, convert-to-order (BR-006) | `apps/api/src/modules/sales/application/quotations.ts` | expiry rejection tests; conversion creates order with lines carried |
| T3 | Sales orders + soft reservation consumption (availability netting, expiry) | `apps/api/src/modules/sales/application/orders.ts` | reservation expiry behavior; availability respects holds; no hard lock |
| T4 | Delivery notes: issue + COGS posting + convert-to-invoice (BR-007 both flows) | `apps/api/src/modules/sales/application/deliveries.ts` | G-03 golden; conversion ties documents (source chain INV-006) |
| T5 | Invoice posting orchestration per POSTING_ENGINE §5 (stock → COGS → tax stamp → AR/cash → subledger → audit, one tx) | `apps/api/src/modules/sales/application/invoices.ts` | G-01/G-02/G-03 goldens + W-1 numbers; failure pack zero-residue |
| T6 | Tax snapshot stamping at posting + draft recompute + BR-033 stale-draft handling | `apps/api/src/modules/sales/application/tax-stamp.ts` | rate-change boundary fixtures (pack dates); draft warning recorded |
| T7 | Credit notes: reference + return window (BR-004), re-entry at original cost, allocation to invoices | `apps/api/src/modules/sales/application/credit-notes.ts` | G-04 + W-3 numbers; window boundary tests; INV-016 on credit allocations |
| T8 | Receipts via treasury service + FX difference lines | `apps/api/src/modules/sales/application/receipts.ts` | G-05/G-06 + W-2 both rate directions; INV-008 stored-rate asserts |
| T9 | Allocation service (FIFO suggestion, partial, on-account, re-allocation docs) | `apps/api/src/modules/sales/application/allocations.ts` | INV-016 property + CC-02 concurrency; on-account visibility |
| T10 | Credit-limit enforcement at approval (partners credit-check service; block/warn/ignore) | `apps/api/src/modules/sales/application/credit-limits.ts` | BR-001 matrix tests (3 postures × limit/overdue); override audited |
| T11 | AR subledger + aging + statements (deterministic as-of) + `invoice.overdue` job | `apps/api/src/modules/sales/application/ar-queries.ts`, `overdue-job.ts` | RC-01 exact tie; RC-03 drift → BROKEN; RC-10 determinism; overdue fires once per invoice |
| T12 | Sales reps registry + attribution fields on documents | `apps/api/src/modules/sales/application/reps.ts` | attribution propagates to journal memo/subledger; no commission code exists (grep-clean) |
| T13 | UI: chain workspaces, allocation workspace, aging/statement views, approval queue w/ credit warnings | `apps/web/app/{locale}/sales/**` | Playwright bilingual E2E (Journey A7–A8); visual snapshots AR+EN; a11y sweep |
| T14 | API routes + permission seeds + docs sync | `apps/api/src/modules/sales/api/**`, `docs/database/**` | docs validation; seed-vs-matrix drift check green |

## 6. Verification

**Automated tests (required):**

- **Golden posting tests (success):** G-01 credit invoice (W-1 exact numbers: AR 1,380.0000
  / revenue 1,200.0000 / VAT 180.0000), G-02 cash invoice, G-03 COGS entry (725.0000 at
  WAC issue), G-04 credit note with return (W-3: SALES_RETURNS 200.0000 · VAT_PAYABLE
  30.0000 DR · AR 230.0000 CR; re-entry INVENTORY 120.0000 · COGS 120.0000 at original
  cost — **never** current-average recompute), G-05 receipt + allocation, G-06 receipt
  with FX gain (W-2: gain 10.0000 explicit residual; mirror loss case). Each asserts
  journal lines, subledger, document state, official number, audit event.
- **Golden failure paths (zero residue, typed errors):**
  - *Credit limit:* block posture + over-limit invoice → approval rejected
    (`CREDIT_LIMIT_EXCEEDED` with the math 8,200 + 2,500 > 10,000 in the payload); warn
    posture → posted with warning recorded; ignore posture → no check; override with
    `sales.credit_check.override` → posted + audited.
  - *Period locked:* posting dated in a LOCKED period → `PERIOD_LOCKED` pre-write
    (INV-011), document stays APPROVED, no number consumed.
  - *Price stale / item inactive:* draft referencing an inactive item or a price no
    longer resolvable → typed error aligned with sync reason codes (PRICE_CHANGED /
    ITEM_INACTIVE vocabulary); draft recomputes on open; posting never reuses a stale
    tax snapshot (BR-033 draft-spanning-rate-change fixture with warning recorded).
  - Standard pack: unmapped purpose, unbalanced spec, duplicate post (`ALREADY_POSTED`,
    INV-013).
- **INV-013 idempotency:** CC-01 sequential + concurrent duplicate post of the same
  invoice → one entry set, loser returns stored result; retries of `/post` with same
  Idempotency-Key are safe.
- **INV-009 AR reconciliation:** RC-01 (20 randomized AR ops → `OK` exact); RC-03 seeded
  drift → `BROKEN` + notification + close blocked.
- **INV-016 allocations:** property tests (random partial allocations never exceed
  bounds at any interleaving); CC-02 concurrent receipts on one invoice.
- **INV-021 numbering:** CC-03 50 parallel posts → 50 unique numbers, no gaps/
  collisions; voided numbers stay reserved.
- **Return window:** BR-004 boundary tests (day 14 ok, day 16 rejected with window
  cited; `return_window_days = 0` disables dates but **never** the reference
  requirement).
- **Stock interplay:** CC-04 issue race (last units; default policy rejects the loser);
  FEFO/serial binding respected on invoice issues (BR-017/018); credit-note re-entry
  preserves batch and binds the original serial.
- **Tenant isolation:** A-tests for all new tables + API spoofing (cross-tenant customer
  id on invoice, cross-branch delivery) → 404/no-leak; credit-check endpoint cannot be
  used to probe other tenants' partner data.
- **Determinism:** RC-10 aging/statement re-run byte-identical; statement INV-009 footer
  check.

**Manual verification:**

1. Walk Journey A7–A8 on a staging tenant (KSA pack, registered): create a credit
   invoice, watch live tax preview, post → verify official number, balanced journals,
   stock moves, and the document→journal drill chain.
2. Walk a credit customer over their limit with policy `block`: observe the disabled
   post action + escalation options; switch to `warn`: observe the warning + posting.
3. Return flow: invoice posted, return 2 units within window → credit note posts,
   stock re-enters at original cost, margins report (screen) shows truthful COGS.
4. Receipt with FX: settle a USD invoice at a different rate → explicit FX gain line;
   allocate partially → on-account remainder visible on the statement.
5. Expire a quotation (set `valid_until` in the past) → accept/convert refused (BR-006).

**Acceptance criteria (objective):**

1. All sales tables exist with RLS + registry rows; migrations green (fresh +
   regression); numbering unique constraints proven under race (INV-021).
2. G-01…G-06 golden suites pass with W-1/W-2/W-3 exact figures, failure packs, and
   zero residue; posting sequencing matches POSTING_ENGINE §5 atomically.
3. Tax snapshots stamp per line at posting; drafts recompute; BR-033 stale-draft
   behavior verified; unregistered tenants produce `NOT_SUBJECT` documents cleanly.
4. Credit limits enforce BR-001 server-side at approval in all three postures with
   audited overrides; the UI only reflects server decisions.
5. Credit notes enforce BR-004 (window + mandatory reference) and re-enter stock at
   original issue cost with batch/serial preservation (G-04/W-3).
6. Receipts consume the treasury service; FX differences post explicitly (G-06/W-2);
   allocations honor INV-016 with on-account amounts as visible open items (BR-027).
7. AR aging + statements are deterministic as-of recomputations (RC-10) tying to
   `AR_CONTROL` (RC-01) with drift detection (RC-03).
8. INV-013 idempotency proven sequentially and concurrently (CC-01) — the contract
   PHASE-016/020 offline deliveries will rely on.
9. Rep attribution present on documents; **no commission computation exists** (scope
   guard for PHASE-017).
10. Acceptance rows mirrored in
     [../../planning/PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
     (PHASE-012 row) once that file lands.

**Performance & security considerations:** invoice posting p95 ≤ 300 ms (T-02) — the
critical engine path; aging/statement queries indexed `(tenant_id, partner_id,
due_date)` and EXPLAIN-verified at 100k AR documents; credit check runs inside the
approval transaction (no TOCTOU gap between check and post — the check re-verifies at
post). Security: approve/post/override are risky, audited, approval-limited (BR-034);
no endpoints mutate POSTED documents (INV-003); statement screens enforce partner-scope
rules.

**Migration & rollback:** expand-only migrations (new tables + additive receipts
columns). Dev rollback = revert + drop; production forward-only per
[../../database/MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md). Posted
invoices/journals/subledger rows are immutable from day one — no rollback path may
touch them.

## 7. Risks and Constraints

- RISK-009: the invoice post composes stock + tax + AR in one transaction — partial
  failure must roll back everything (INV-018 discipline); W-1/W-3 goldens are the
  control.
- RISK-011: every `/post` here is the future offline-sync target — idempotency keys and
  typed rejection codes must match the sync vocabulary exactly (tested now, chaos-tested
  in PHASE-020).
- RISK-006: rate changes mid-period — snapshots + BR-033 draft warnings keep posted
  history stable.
- RISK-014: aging at scale — read-model-friendly queries + T-02/T-01 smoke gates.
- RISK-016: sales must not write GL or stock tables directly (engine + inventory
  services only); boundary lint enforced.
- RISK-015: bidi/RTL in customer names + numerals — bilingual visual snapshots for every
  chain screen.
- Constraint: print/PDF of invoices and statements is **not** built here — the UI marks
  print actions as arriving with the PHASE-013 reporting release (honest state, no dead
  buttons that pretend).
- Constraint: commissions (PHASE-017) and POS flows (PHASE-016) must not leak in —
  "while I'm here" additions are review blockers per
  [../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) scope discipline.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-012-COMPLETION.md` with: golden outputs
  (G-01…G-06 + W-1/W-2/W-3 exact figures), failure-path outputs (credit limit ×3
  postures, period lock, stale price, duplicates), RC-01/03/10 outputs, CC-01/02/03
  outputs, isolation A-tests, T-02 posting latency, Journey-A7/8 E2E transcript, and a
  grep-clean proof that no commission/POS code was added.
- **Documentation updates required:** ENTITY_CATALOG §sales sync, TABLES sales specs,
  IMPLEMENTATION_STATUS (PHASE-012 → COMPLETE), CHANGELOG,
  [../../offline/OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  row updates (POS-pending columns documented), any BR deviation via decision record.
- **Exit criteria:** all acceptance criteria green with evidence; invariants newly
  covered listed (INV-009 AR, INV-013, INV-016, INV-021); docs validation green; zero
  TODOs.
- **Definition of Done:** `main` contains the full O2C chain with golden + isolation +
  concurrency + E2E suites green; bilingual screens with visual baselines; AR query
  services documented for PHASE-013 consumption.
- **Handoff instructions:** next agent reads the PHASE-012 completion report and the
  `arQueries.*`/`salesAnalytics.*` service contracts — PHASE-013 builds the report
  engine that consumes them. **Next eligible phase: PHASE-013 — Reporting Engine,
  Financial Statements & Printing** (identify only; do not implement).
