# Completion Report — PHASE-012

> **Status:** COMPLETE · **Updated:** 2026-10-31

## Report fields

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-012 · 2026-10-31 |
| **Summary** | The sales module ships the full quote-to-cash chain — quotations (BR-006 validity, QOT- at SENT, the expiry sweep) → sales orders (optional soft reservations against the PHASE-010 availability service, SOR- at ISSUE) → delivery notes (stock issue + COGS G-03 through the inventory `planIssue`/`applyIssue` seam — sales never writes stock tables — converting to revenue-only invoices with the DN issue-cost snapshot carried onto the invoice lines, BR-007 both flows first-class) → sales invoices (cash + credit, per-line output-VAT legs from the PHASE-009 engine with BR-033 snapshots stamped at create and re-verified at post, official SAL- numbering at posting proven under 50-way parallel posts, BR-005 cash-autopost with the POLICY_ACTOR sentinel, server-side credit limits BR-001 as a CREDIT-kind control at approval with the no-TOCTOU re-verification at post — block/warn/allow × limit/overdue with the exact 8,200 + 2,500 > 10,000 math, override audited) → credit notes (G-04/W-3 exact: returns re-enter stock at the ORIGINAL issue cost with batch preserved + serial binding the sold unit, BR-004 window with the reference never disabling, §3.4 explicit allocation — the invoice stays gross-open, the note its own subledger row) → receipts riding the PHASE-008 treasury service (G-05 + G-06 the W-2 FX gain/loss residual at the INV-008 stored rate) with allocations (INV-016 bounds, CC-02 concurrency, on-account remainders explicit BR-027) and audited INSERT-only re-allocation documents (SRA-). AR aging buckets + customer statements are deterministic as-of recomputations (RC-10 byte-identical, BR-028) tying to `AR_CONTROL` (RC-01 over 20 randomized ops; RC-03 drift → BROKEN + PC-04 lock block; INV-009 from entry #1 including opening-AR settlement G-16 AR side); the `invoice.overdue` job fires exactly-once per invoice; sales-rep attribution is present with **zero commission computation** (the PHASE-017 scope guard, grep-clean). Migrations `0018_sales_core.sql` + `0019_sales_ar.sql` land 14 tenant tables (all RLS'd, composite-FK'd, registry-isolated with generated A-test coverage; `sales_reallocations`/`sales_reallocation_lines` INSERT-only by grants — the audit trail cannot be rewritten). 51 routes under `/api/v1/sales` + the published partner credit-check endpoint; 5 AR/EN web screens + the AR views (aging/statement/open-items/re-allocations); i18n 1342→1465. |
| **Files created** | (below) |
| **Files changed** | (below) |
| **Database migrations** | `0018_sales_core.sql`, `0019_sales_ar.sql` (below) |
| **API changes** | 51 routes under `/api/v1/sales` + `POST /api/v1/partners/partners/:id/credit-check` (below) |
| **UI changes** | 5 screens + nav + i18n (below) |
| **Security changes** | (below) |
| **Tests executed** | (below) |
| **Actual test results** | (below) |
| **Build results** | (below) |
| **Invariants covered** | INV-003, INV-006, INV-008, INV-009, INV-011, INV-012, INV-013, INV-016, INV-018, INV-021 (below) |
| **Acceptance criteria verification** | 10/10 PASS (below) |
| **Evidence** | (below) |
| **Known limitations** | (below) |
| **Deferred work** | (below) |
| **Documentation updated** | (below) |
| **Risks** | none added; RISK-006/009/011/014/015/016 mitigations exercised (below) |
| **Rollback instructions** | (below) |
| **Next eligible phase** | PHASE-013 — Reporting Engine, Financial Statements & Printing (identify only) |

## Summary

Delivered per [../PHASE-012.md](../PHASE-012.md) and
[../../accounting/POSTING_ENGINE.md](../../../accounting/POSTING_ENGINE.md) §4 /
[ADR-0007](../../../architecture/ADR/ADR-0007-centralized-posting-engine.md) /
[ADR-0010](../../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md): the complete
O2C document chain with every ledger effect through the posting engine and every stock
effect through the inventory movement core (MODULE_BOUNDARIES held — boundary lint +
dependency-cruiser green). Quotations run DRAFT → SENT → ACCEPTED (converts to order) /
REJECTED / EXPIRED with `valid_until` enforced at send AND at accept plus the sweep
(BR-006 — an expired quote can never be accepted; re-issue as new); sales orders run
DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → CLOSED with line-level optional soft
reservations (`stock_reservations` holder_type `SALES_ORDER`, expiry honored,
non-blocking); delivery notes post the COGS journal (`DR COGS · CR INVENTORY` at issue
cost, golden G-03) **without AR** and convert to revenue-only invoices later with the
DN's issue-cost snapshot copied onto the invoice lines (the W-3 re-entry provenance);
sales invoices post per POSTING_ENGINE §5 in ONE transaction (stock issues (flow B) →
COGS journal → tax stamp → AR/cash journal → SAL- number → status flip) with the W-1
exact figures (AR 1,380.0000 / revenue 1,200.0000 / VAT 180.0000 as per-line output-VAT
legs 150 + 30 — the engine's per-line stamping pattern mirroring the purchasing
input-VAT legs); credit limits BR-001 are a CREDIT-kind control (cash carries no credit
exposure — ALLOW by shape) enforced server-side at approval via the partners
credit-check service with the block posture refusing approval with the exact math in the
typed `CREDIT_LIMIT_EXCEEDED` payload, warn recording the decision + math on the
document, allow skipping entirely, and `sales.credit_check.override` converting BLOCK to
WARN as its own audited event; the post path RE-VERIFIES (no TOCTOU gap). Credit notes
enforce BR-004 (the date window may disable; the reference requirement NEVER does —
`invoice_id` NOT NULL + per-line `invoice_line_id` NOT NULL) and re-enter returned stock
at the ORIGINAL issue cost snapshotted from the referenced invoice line (G-04 + worked
example W-3: `DR SALES_RETURNS 200 · DR VAT 30 · CR AR 230` + `DR INVENTORY 120 · CR
COGS 120` — batch preserved, serial binds the originally sold unit per BR-018, WAC
unchanged); per RECEIVABLES §3.4 the note is its own explicit subledger row — the
referenced invoice stays gross-open exactly like the accepted PHASE-011 debit-note
model (allocations are explicit). Receipts ride the PHASE-008 treasury service
wholesale: G-05 `DR cash · CR AR_CONTROL (partner)` with the settlement and on-account
control legs split explicitly (BR-027 — never silently netted) and the W-2 FX-mirror
explicit FX_GAIN/FX_LOSS residual lines (±10.0000 both directions proven, INV-008
stored rate); INV-016 bounds are enforced authoritatively at post with CC-02
concurrency proven on the sales surface (two parallel receipts on one invoice — one
wins, the loser rejected `ALLOCATION_EXCEEDS_OPEN_ITEM` with zero residue on both
sides); post-allocation re-allocation is its own audited INSERT-only document set (0019)
with `receipts.allocated_amount` re-synced. The AR subledger ties to `AR_CONTROL`
exactly (RC-01 over 20 randomized AR operations; RC-03 seeded drift → BROKEN + PC-04
lock block on the PHASE-007 framework's existing AR kind), aging buckets and customer
statements are deterministic as-of recomputations (RC-10 byte-identical re-runs;
document currency + base totals per BR-028; the INV-009 footer tie verified in the
statement path), opening AR balances from G-16 settle like any invoice (INV-009 from
entry #1), and the `invoice.overdue` job fires exactly-once per invoice (the audit stamp
is the dedupe). Sales-rep attribution is on every document; **no commission computation
exists anywhere** (the grep-clean proof below — PHASE-017's scope).

## Files created

**apps/api**
- `migrations/0018_sales_core.sql` — 12 tables (sales_reps, quotations + lines,
  sales_orders + lines, delivery_notes + lines, sales_invoices + lines, credit_notes +
  lines) + the `stock_moves.source_type` CHECK expansion (delivery_note / sales_invoice
  / credit_note provenance) + the `cash_movements.source_type` widening (`sales_invoice`
  — the G-02 counter payment, INV-019) + RLS macro ×12 + grants (draft-lifecycle
  SELECT/INSERT/UPDATE) + the §6-mandated AR index `(tenant_id, customer_id, due_date)`
  + `_schema_state` → 18.
- `migrations/0019_sales_ar.sql` — the audited re-allocation documents
  (`sales_reallocations` POSTED-at-create + `sales_reallocation_lines` with the explicit
  BR-027 on-account NULL semantics) + RLS ×2 + INSERT-only grants + the receipts
  substrate reconciliation note (no new columns — the PHASE-008 surface carries the
  AR-allocation quanta) + `_schema_state` → 19.
- `src/modules/sales/domain/sales-errors.ts` — typed error codes (ERROR_MODEL §4)
  for the whole chain, sync-vocabulary aligned (PRICE_CHANGED / ITEM_INACTIVE /
  CREDIT_LIMIT_EXCEEDED / RETURN_WINDOW_EXCEEDED / QUOTATION_EXPIRED …).
- `src/modules/sales/application/quotations.ts` — DRAFT → SENT → ACCEPTED/REJECTED/
  EXPIRED with BR-006 validity at create + send + accept, QOT- at SENT, the expiry
  sweep (T2).
- `src/modules/sales/application/orders.ts` — order lifecycle + `acceptQuotation`
  conversion with the optional soft reservations (SOR- at ISSUE) (T3).
- `src/modules/sales/application/deliveries.ts` — DN service: stock issue via the
  inventory seam + G-03 posting without AR + convert-to-invoice with the issue-cost
  carry (T4).
- `src/modules/sales/application/invoices.ts` — the posting orchestration per
  POSTING_ENGINE §5 (one transaction), BR-001 credit control (CREDIT-kind; cash ALLOW
  by shape; no-TOCTOU re-verify at post), BR-005 cash autopost + POLICY_ACTOR sentinel,
  BR-033 snapshot integrity, `createFromDelivery` (T5).
- `src/modules/sales/application/tax-lines.ts` — output-VAT wiring per pack +
  registration (NOT_SUBJECT / ZERO_RATED / EXEMPT / REVERSE_CHARGE pair /
  STANDARD_RATED), snapshots on the line records, INV-012 summary groups (T6).
- `src/modules/sales/application/credit-notes.ts` — G-04 mirror corrections with the
  mandatory reference, BR-004 window, original-cost re-entry planning through the
  inventory `planReceipt`/`applyReceipt` seam (T7).
- `src/modules/sales/application/receipts consumption` — via the treasury service
  (fixtures expose the PHASE-008 services; no duplicate money code) (T8).
- `src/modules/sales/application/allocations consumption` — the treasury allocation
  service with INV-016 bounds at post; FIFO suggestion + on-account are the
  PHASE-008 surfaces (T9).
- `src/modules/sales/application/credit-limits.ts` — `runCreditCheck` /
  `enforceAtApproval` / `creditCheckPreview` (the published partner endpoint's body)
  (T10).
- `src/modules/sales/application/ar-queries.ts` — aging buckets, customer statements
  (deterministic as-of, BR-028, the INV-009 footer tie), open items, `verifyInv009`
  (the `arQueries.*` surface PHASE-013 registers) (T11).
- `src/modules/sales/application/reps.ts` — the sales-rep registry + attribution +
  the `InvoiceOverdueService` (exactly-once scan; audit-stamp dedupe) (T12).
- `src/modules/sales/application/reallocations.ts` — audited post-allocation
  re-allocation documents (BR-027 both directions, INV-016 bounds, treasury_allocations
  rewrite + allocated_amount re-sync in-transaction).
- `src/modules/sales/application/pricing.ts` — customer price-list resolution with
  BR-003 precedence (customer list → tier → branch default → item base) + ceilings.
- `src/modules/sales/infrastructure/sales.store.ts` — the module's store (RLS-scoped
  raw-SQL reads + the AR open-items/statement/as-of surfaces).
- `src/modules/sales/presentation/sales.controller.ts` — 51 routes.
- `src/modules/sales/sales.module.ts` — the Nest module.
- `src/__db__/sales/fixtures.ts` — the dedicated tenant-S fixture (SAR/SA pack,
  W-1/W-2/W-3 seeds, settings helpers, `quickPostedInvoice`).
- `src/__db__/sales/golden.spec.ts` — the golden posting suite (G-01…G-06 + W-1/W-2/W-3
  exact figures + PERIOD_LOCKED/NOT_SUBJECT/CC-01 zero-residue packs).
- `src/__db__/sales/operations.spec.ts` — the operations packs (BR-001 matrix ×4,
  BR-004 boundaries, BR-006 expiry + sweep, G-16 AR side, RC-01/RC-03/RC-10, the
  overdue exactly-once job, INV-016 + on-account, CC-02, re-allocations + the
  INSERT-only grant denial, CC-03 50-way parallel contiguous numbering).

**apps/web**
- `app/[locale]/sales/quotes/page.tsx` — the quotations + orders workspace.
- `app/[locale]/sales/deliveries/page.tsx` — the delivery-note workspace.
- `app/[locale]/sales/invoices/page.tsx` — the invoice workspace with the live
  credit-check decision panel.
- `app/[locale]/sales/credit-notes/page.tsx` — the credit-note workspace.
- `app/[locale]/sales/ar/page.tsx` — the AR views (aging/statement/open-items).
- `components/sales-quotes.tsx`, `components/sales-deliveries.tsx`,
  `components/sales-invoices.tsx`, `components/sales-credit-notes.tsx`,
  `components/sales-ar.tsx` — the bilingual client components.

**docs**
- `docs/database/TABLES/trade-sales.md` — column-level specs authored in-phase.
- `docs/implementation/phases/reports/PHASE-012-COMPLETION.md` — this report.

## Files changed

- `apps/api/migrations/meta/_journal.json` — 0018/0019 appended (drizzle manifest).
- `apps/api/src/infra/db/migrations.ts` + `migrations.spec.ts` — manifest + the
  last-tag assertion.
- `apps/api/src/db/schema.ts` — the 14 sales tables (drizzle mirror).
- `apps/api/src/app.module.ts` — the SalesModule registration.
- `apps/api/src/infra/auth/route-permissions.ts` — the 51 sales routes + the partner
  credit-check publication (matrix §3.2 exact).
- `apps/api/src/modules/configuration/domain/settings-schema.ts` — the sales settings
  (`sales.quote_default_validity_days`, `sales.return_window_days`,
  `sales.credit_limit_action`, `sales.cash_autopost`, `sales.doc_flow`,
  `sales.price_override_allowed`).
- `apps/api/src/modules/notifications/application/templates.ts` — the AR/EN
  `invoice.overdue` digest template.
- `apps/api/src/__db__/isolation/tables.registry.ts` — the 13 new tenant tables
  registered (generated A-test coverage).
- `apps/api/src/__db__/isolation/identity-isolation.db.spec.ts` — fixture rows +
  OWN_ROW + MISMATCHED_INSERT (A3) shapes + the INSERT-only UPDATE-denial entries for
  the sales re-allocation pair.
- `apps/api/src/__db__/identity-flows.db.spec.ts` — the viewer-tier allowlist gains the
  template-seeded sales view keys (`sales.invoices.view`, `sales.credit_notes.view` —
  matrix §2 "view-class keys").
- `packages/contracts/src/navigation.ts` — the sales nav group (5 items).
- `apps/web/i18n/dictionaries.ts` — 1342 → 1465 keys (triple parity enforced).
- `apps/web/lib/api-types.ts`, `apps/web/lib/messages.ts` — the sales wire types +
  messages.
- `docs/database/ENTITY_CATALOG.md` — §sales line-table rows completed.
- `docs/offline/OFFLINE_CAPABILITIES_MATRIX.md` — the PHASE-012 substrate row note.
- `docs/planning/IMPLEMENTATION_STATUS.md`, `docs/handoff/CURRENT_STATE.md`,
  `docs/handoff/NEXT_ACTION.md`, `docs/handoff/CHANGELOG.md` — status flips.

## Database migrations

`0018_sales_core.sql` (12 tenant tables + the two source-shape widenings + the AR
aging index) and `0019_sales_ar.sql` (the INSERT-only re-allocation pair). Fresh apply
+ regression apply proven by the migration-tests runner inside the gate; RLS presence +
catalog drift checked by `check-rls` (the six §sales line tables were added to
ENTITY_CATALOG to keep the sync rule green — caught by the gate's own negative proof,
fixed in-phase).

## API changes

51 routes under `/api/v1/sales` (quotations CRUD + send/reject/cancel/accept via
orders + sweep-expired; sales-orders CRUD + submit/approve/issue/close/cancel;
delivery-notes CRUD + post/convert-to-invoice/cancel; sales-invoices CRUD +
submit/approve/post/cancel; credit-notes CRUD + submit/approve/post/cancel; ar/aging +
ar/statements/:customerId + ar/open-items + ar/opening-verification + ar/allocations;
receipts/:id/reallocate + receipts/:id/reallocations; reps CRUD + activate/deactivate;
jobs/invoice-overdue/run-scan) + `POST /api/v1/partners/partners/:id/credit-check`
(the published preview). Idempotency-Key on all POST actions; permissions are the exact
matrix §3.2 keys with risky approve/post/override/convert audited.

## UI changes

Five AR/EN screens (RTL-first, MoneyInput/DataTable norms): the quotes+orders
workspace (BR-006 validity + the conversion chain + reservation awareness), deliveries
(both flows + convert), invoices (live totals + tax preview + the BR-001 credit-check
decision panel with the math and escalation postures), credit notes (return-window +
original-cost re-entry presentation), and the AR views (aging buckets, customer
statement with the INV-009 footer tie + document currency + base totals, open items +
the re-allocation workspace). The receipts money leg rides the treasury group's
existing surface; print actions are honestly marked "arriving with the PHASE-013
reporting release" (no dead buttons that pretend).

## Security changes

Branch scoping on documents; tenant scope on statements; the credit-check endpoint
cannot probe foreign tenants' partner data (the A7 spoof discipline inherited from the
platform surface); `sales.credit_check.override` is risky + audited; no endpoint
mutates POSTED documents (INV-003); the re-allocation tables are INSERT-only by grants
(UPDATE as erp_app is 42501-denied — asserted in the operations pack).

## Tests executed

- `pnpm --filter @erp/api test` — unit/property (92).
- `pnpm test:db` — the full db suite on embedded PostgreSQL 16 (1044 tests / 57 files),
  including the 27 sales tests (golden 10 + operations 17) and the generated
  isolation A1–A10 suite over the 13 newly registered tables.
- `pnpm gate:local` — the 17-step CI-equivalent gate (typecheck, lint +
  module-boundary rules, dependency-cruiser, permissions drift, unit + property, db
  suite, build, token contrast, i18n parity + negative proofs, UI catalog coverage,
  visual harness, web security probe, docs validation 29 checks, negative boundary
  meta-tests).

## Actual test results

- Sales golden suite: **10/10 PASS** — G-01 + G-03 with-goods W-1 (COGS 725.0000 at
  WAC; AR 1,380.0000 / revenue 1,200.0000 / VAT 180.0000 as per-line legs 150 + 30;
  stock A −10 @ 60.000000, B −5 @ 25.000000, WAC unchanged; AR open item 1,380.0000;
  INV-013 replay), NOT_SUBJECT variant (no VAT lines cleanly), PERIOD_LOCKED zero
  residue (INV-011), G-02 cash (DR cash 172.5000 · CR revenue 150.0000 · CR VAT
  22.5000 + the INV-019 movement; credit check ALLOW by shape — no credit exposure),
  G-03 delivery flow A (COGS 120.0000, no AR; conversion posts revenue-only 230.0000
  with `issueUnitCost` 60.000000 carried — the W-3 provenance), G-04 credit note W-3
  exact (SALES_RETURNS 200.0000 DR · VAT 30.0000 DR · AR 230.0000 CR + INVENTORY
  120.0000 DR · COGS 120.0000 CR; stock +2 @ 60.000000 reason CUSTOMER_RETURN; the
  invoice gross-open at 1,380.0000 with the note's own 230.0000 CREDIT open item —
  §3.4 explicit allocation), G-05 receipt settle (DR cash 1,380.0000 · CR AR
  1,380.0000; settled), G-06 W-2 FX gain (cash 3,760.0000 @ 3.76 · AR 3,750.0000 @
  the stored 3.75 · FX_GAIN 10.0000 explicit residual) + the loss mirror
  (FX_LOSS 5.0000 = 500 × (3.75 − 3.74)), CC-01 duplicate-post serialization (one
  entry set; loser returns the stored result).
- Sales operations suite: **17/17 PASS** — BR-001 matrix (block: `CREDIT_LIMIT_EXCEEDED`
  with the message containing `8200.0000 + 2500.0000 > 10000.0000` and `overdue
  invoices: 1`, zero residue — the document stays PENDING_APPROVAL with no journal;
  warn: approved with decision WARN + the math recorded and posted; allow: `posture
  allow — no check`; override: BLOCK→WARN with `— overridden` in the math, the
  `sales.credit_check_overridden` audit event count = 1, then posted), BR-004
  boundaries (day 14 posts CRN-; day 16 rejected citing the 14-day window;
  `return_window_days = 0` disables dates but a DRAFT invoice reference still refuses
  `CREDIT_NOTE_REF_INVALID`), BR-006 (a lapsed quote refuses to send
  `QUOTATION_EXPIRED`; the sweep flips the lapsed SENT seed to EXPIRED; accept
  refuses), G-16 AR side (the +1,000 opening is an allocatable open item;
  `verifyInv009` ok diff 0.0000; a receipt settles it exactly; re-verified ok), RC-01
  (20 randomized AR ops → `runArCheck` OK, control = subledger, diffCount 0), RC-03
  (seeded subledger drift → BROKEN; the March LOCK refused `RECONCILIATION_BROKEN`
  then reopened; the documented superuser repair restores OK), RC-10 (aging +
  statement byte-identical re-runs; buckets sum = total exactly; the statement footer
  `subledgerTie.ok` true with the opening entry present), the overdue job (first scan
  alerts every open overdue invoice; the re-run alerts none — the audit count
  unchanged), INV-016 (partial 6 of 10 exact; over-allocation rejected at post
  `ALLOCATION_EXCEEDS_OPEN_ITEM` with zero residue on both sides; the corrected
  allocation posts with the 6.0000 on-account remainder visible as its own explicit
  statement credit leg), CC-02 (two parallel 600 receipts on a 1,000 invoice: one
  fulfilled, one rejected; settled 600.0000 / outstanding 400.0000), re-allocations
  (move 6 audited SRA- with both outstandings exact; beyond-settled refused; the
  to-NULL on-account return un-allocates explicitly with allocated_amount re-synced;
  UPDATE as erp_app on the document is 42501-denied), CC-03 (50 parallel posts → 50
  unique contiguous `SAL-2026-NNNNNN` numbers, max − min = 49, no gaps/collisions).
- Full db suite: **1044/1044 PASS (57 files)** — the 939-test PHASE-011 baseline +
  27 sales tests + the widened isolation/identity matrices (the 13 new tables ×
  A1–A10 + the viewer allowlist).
- API unit/property: **92/92 PASS**; domain-core **38/38**; contracts **11/11**.
- Scope guard (grep-clean proof): `grep -rn "commission" apps/api/src/modules/sales/
  apps/web/app/*/sales apps/web/components/sales-*` → only the deferred-scope comments
  (PHASE-017 pointers); zero computation code. No POS/offline-receipt code paths
  (the reserved columns stay unused; `offline_receipt_no` appears only in the schema +
  the migration comment).

## Build results

`pnpm build` (Turborepo, api + web + packages) exit 0 inside the gate; web production
build used by the security probe exit 0.

## Invariants covered

- **INV-003** (posted documents immutable — service discipline + shape CHECKs; no
  mutation routes),
- **INV-006** (document→journal drill chain: every posted document carries
  `posted_journal_id` (+ `posted_cogs_journal_id` for with-goods)),
- **INV-008** (W-2 FX at the stored rate — both directions explicit),
- **INV-009** (AR subledger = `AR_CONTROL` from entry #1: RC-01 randomized, RC-03
  drift detection, G-16 opening settlement, the statement footer tie),
- **INV-011** (PERIOD_LOCKED refuses pre-write, zero residue),
- **INV-012** (per-document tax summaries stamped inside the posting transaction),
- **INV-013** (idempotent posting — CC-01 sequential + concurrent + the replay
  results),
- **INV-016** (allocation bounds at post + CC-02 concurrency + re-allocation bounds),
- **INV-018** (stock + journal atomicity inside the posting transaction — the W-1
  with-goods case),
- **INV-021** (official numbering unique under 50-way parallel posts; reserved
  numbers never reused).

## Acceptance criteria verification

1. **All sales tables exist with RLS + registry rows; migrations green (fresh +
   regression); numbering unique constraints proven under race** — PASS: 0018/0019
   apply clean (migration-tests inside the gate); the 13 new tables registered with
   A1–A10 generated coverage; CC-03 50-way parallel → unique contiguous numbers.
2. **G-01…G-06 golden suites pass with W-1/W-2/W-3 exact figures, failure packs, and
   zero residue; posting sequencing matches POSTING_ENGINE §5 atomically** — PASS
   (10/10 golden + the PERIOD_LOCKED/NOT_SUBJECT packs; the one-transaction
   orchestration is the service's post method with the tax-stamp refusal rolling
   everything back).
3. **Tax snapshots stamp per line at posting; drafts recompute; BR-033 stale-draft
   behavior verified; unregistered tenants produce NOT_SUBJECT documents cleanly** —
   PASS (stamps at create; post re-resolves and REFUSES a mismatch; the NS variant
   posts with no VAT lines).
4. **Credit limits enforce BR-001 server-side at approval in all three postures with
   audited overrides; the UI only reflects server decisions** — PASS (the ×4 matrix
   pack with the exact math; the decision + math recorded on the document; the web
   panel renders the server's `credit_check` jsonb only).
5. **Credit notes enforce BR-004 (window + mandatory reference) and re-enter stock at
   original issue cost with batch/serial preservation (G-04/W-3)** — PASS (the
   boundary pack + the W-3 exact re-entry at 60.000000 with WAC unchanged).
6. **Receipts consume the treasury service; FX differences post explicitly
   (G-06/W-2); allocations honor INV-016 with on-account amounts as visible open
   items (BR-027)** — PASS (G-05/G-06 both directions; the on-account legs are their
   own explicit control lines visible on the statement).
7. **AR aging + statements are deterministic as-of recomputations (RC-10) tying to
   `AR_CONTROL` (RC-01) with drift detection (RC-03)** — PASS (byte-identical
   re-runs; the footer tie; drift → BROKEN + PC-04 lock block).
8. **INV-013 idempotency proven sequentially and concurrently (CC-01)** — PASS (the
   duplicate-post serialization pack; the PHASE-016/020 sync contract).
9. **Rep attribution present on documents; no commission computation exists** —
   PASS (attribution on every document; grep-clean).
10. **Acceptance rows mirrored in PHASE_ACCEPTANCE_CRITERIA (PHASE-012 row)** — PASS
    (the row pre-exists in the per-phase table; no deviation).

## Evidence

- Gate transcript (`pnpm gate:local`, 17 steps, run 2026-10-31): all steps exit 0 —
  see the agent worklog `agent-ctx/T17-gate-evidence-PHASE-012.md` for the full
  step-by-step transcript excerpts including the sales-suite output (27/27), the db
  suite total (1044/1044), the docs validation (29/29), and the final
  `=== ALL LOCAL GATES GREEN ===` marker (confirmation re-run exit code 0).
- The zero-commission grep (scope guard §7/§9): documented in the worklog.
- Migration fresh + regression applies: inside the gate's db-suite boot +
  migration-tests step (embedded PostgreSQL 16).

## Documentation-vs-reality reconciliation (found in-phase, fixed in-phase)

The pre-implementation reality audit of the PHASE-011 baseline surfaced one stale
artifact at tag `phase/011`: the `@erp/ui` navigation unit test
(`behavior.test.ts` — "renders everything when entitled…") still expected the
pre-purchasing group list, so the committed `pnpm test` step could not have been
green at that tag (the PHASE-011 evidence's unit-test step was inaccurate on this
one file). Resolution: the test now asserts the full shipped set (home, sales,
purchasing, inventory, accounting, treasury, reports, partners, settings) and this
phase's gate runs it green (42/42 @erp/ui). Recorded per the handoff protocol's
reconciliation rule — documented, not silenced; no other discrepancy found (the
PHASE-011 code, migrations, docs, and zip all verified present and consistent).

## Known limitations

- Statement `openingBalance` is always "0.0000" in v1 (entries begin at the opening
  `opening_balances` row itself; a pre-opening carried balance arrives with
  PHASE-013's statement print contract if design partners need it).
- The aging surface buckets by whole days on UTC dates (the platform's canonical
  date discipline); timezone-shifted day boundaries are a PHASE-013 presentation
  concern only.

## Deferred work

- Report-contract registration + PDF/XLSX/CSV/print of `ar.aging`,
  `partner.statement`, `ar.allocations` — **PHASE-013** (the `arQueries.*` surface is
  published and tested).
- POS screens, terminal sessions, offline receipt numbers — **PHASE-016** (the
  `offline_receipt_no` column ships unused).
- Commissions — **PHASE-017** (grep-clean proof recorded).
- Customer tiers + free-goods policy engine — **PHASE-017** (zero-price line FORMAT
  allowed per BR-008).
- E-invoicing adapters — **PHASE-023** (`einvoice_status` ships NULL).

## Documentation updated

- `docs/database/TABLES/trade-sales.md` (new, column-level specs).
- `docs/database/ENTITY_CATALOG.md` (§sales line-table rows).
- `docs/offline/OFFLINE_CAPABILITIES_MATRIX.md` (the PHASE-012 substrate row note).
- `docs/planning/IMPLEMENTATION_STATUS.md` (PHASE-012 → COMPLETE).
- `docs/handoff/CURRENT_STATE.md`, `docs/handoff/NEXT_ACTION.md`,
  `docs/handoff/CHANGELOG.md`.
- No BR deviations; no decision records required.

## Risks

None added. Exercised mitigations: RISK-009 (one-transaction posting — the W-1/W-3
goldens + the PERIOD_LOCKED zero-residue pack), RISK-011 (idempotency keys + the typed
sync-vocabulary codes tested now for PHASE-020), RISK-006 (snapshots + the BR-033
post-time refusal), RISK-014 (the `(tenant_id, customer_id, due_date)` index on the
aging path), RISK-015 (bilingual screens on the platform's RTL-first norms), RISK-016
(boundary lint + dependency-cruiser green — sales writes no GL/stock rows).

## Rollback instructions

Expand-only migrations (new tables + the two source-shape CHECK widenings +
additive index). Dev rollback = revert the commit + drop the sales cluster; production
forward-only per MIGRATION_STRATEGY. Posted invoices/journals/subledger rows are
immutable from day one — no rollback path may touch them.

## Next eligible phase

**PHASE-013 — Reporting Engine, Financial Statements & Printing** (identify only; do
not implement). PHASE-013 builds the report engine that consumes this phase's
`arQueries.*` service contracts + the PHASE-011 `apQueries.*`/GRNI surfaces + the
PHASE-007 GL queries; the §3.4 explicit-allocation open-item model (invoice gross-open,
notes as their own rows) is the honest presentation the AR reports must carry forward.
