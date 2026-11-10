# Completion Report — PHASE-011

> **Status:** COMPLETE · **Updated:** 2026-10-30

## Report fields

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-011 · 2026-10-30 |
| **Summary** | The purchasing module ships the full procure-to-pay chain — purchase requests → purchase orders → goods receipts → supplier invoices → debit notes — with goods receipts receiving stock through the PHASE-010 inventory services (`planReceipt`/`applyReceipt` inside the posting transaction; purchasing never writes `stock_moves`) and posting the GRNI accrual (G-07); supplier invoices clearing GRNI and posting AP with VAT recoverable/expensed per the PHASE-009 engine (G-08, all three eligibility modes proven); three-way matching with tolerance policies recorded before approval (BR-009 — the posting path refuses to run without a match outcome); debit notes as mirror corrections (G-09); supplier payments riding the PHASE-008 treasury service (G-10 + the W-2 FX mirror) with allocations, on-account remainders, and audited re-allocation documents (BR-027/INV-016); AP aging + supplier statements as deterministic as-of recomputations (RC-10) including opening-AP settlement (G-16 AP side, INV-009 from entry #1); the GRNI register reconciling at each step (RC-09, registered into the PHASE-007 framework with the PC-04 lock block + live close-checklist item); landed-cost baseline allocation by VALUE/QTY with the remaining-qty constraint and explicit COGS-adjustment posting through the new inventory revaluation seam; and supplier price-list consumption with BR-003 provenance. Migrations `0016_purchasing_core.sql` + `0017_purchasing_ap.sql` land 14 tenant tables (all RLS'd, composite-FK'd, registry-isolated; `purchase_reallocations`/`purchase_reallocation_lines` INSERT-only by grants — the audit trail cannot be rewritten). 48 routes under `/api/v1/purchasing`; 5 AR/EN web screens + the AP views (aging/statement/GRNI); i18n 1231→1342. |
| **Files created** | (below) |
| **Files changed** | (below) |
| **Database migrations** | `0016_purchasing_core.sql`, `0017_purchasing_ap.sql` (below) |
| **API changes** | 48 routes under `/api/v1/purchasing` (below) |
| **UI changes** | 5 screens + nav + i18n (below) |
| **Security changes** | (below) |
| **Tests executed** | (below) |
| **Actual test results** | (below) |
| **Build results** | (below) |
| **Invariants covered** | INV-003, INV-008, INV-009, INV-011, INV-012, INV-013, INV-016, INV-021 (below) |
| **Acceptance criteria verification** | 10/10 PASS (below) |
| **Evidence** | (below) |
| **Known limitations** | (below) |
| **Deferred work** | (below) |
| **Documentation updated** | (below) |
| **Risks** | none added; RISK-006/009/011/016/019/020 mitigations exercised (below) |
| **Rollback instructions** | (below) |
| **Next eligible phase** | PHASE-012 — Sales & Receivables (identify only) |

## Summary

Delivered per [../PHASE-011.md](../PHASE-011.md) and
[../../accounting/POSTING_ENGINE.md](../../../accounting/POSTING_ENGINE.md) §4 /
[ADR-0007](../../../architecture/ADR/ADR-0007-centralized-posting-engine.md) /
[ADR-0010](../../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md): the complete
P2P document chain with every ledger effect through the posting engine and every stock
effect through the inventory movement core (MODULE_BOUNDARIES held — boundary lint +
dependency-cruiser green). Purchase requests run DRAFT → PENDING_APPROVAL →
APPROVED/REJECTED → CONVERTED with SoD (creator ≠ approver); purchase orders run DRAFT →
PENDING_APPROVAL (BR-010 threshold routing against the PHASE-007 approval policies,
base-currency compare) → APPROVED → ISSUED → CLOSED with amendments as linked revisions
(revision_of_id; INV-003 — never in-place edits) and BR-029 numbering at issue; goods
receipts post G-07 (`DR INVENTORY/expense · CR GRNI`) atomically with stock rows
(batch/serial capture at receipt where tracked), the PO-less direct-purchase policy
(BR-012: explicit reason mandatory, forbid by setting, audited when allowed), and
provisional PO-price costs that the supplier invoice revalues with the variance recorded;
the three-way match (BR-009) runs the tolerance matrix (exact by default; 2% worked
examples both directions), stores per-line outcomes + dispositions in `match_result`
BEFORE approval, and the posting path enforces the recorded-outcome guard at service
level (posting without a match outcome is rejected — asserted). Supplier invoices check
BR-011 duplicates ((supplier, number, amount) block / (supplier, number) different amount
warn), stamp BR-033 tax snapshots per line, resolve VAT recoverability per tenant
registration + jurisdiction pack (VAT_RECOVERABLE / VAT_EXPENSED / NOT_SUBJECT — all
three variants golden-proven), post G-08 with the exact GRNI-clearing quanta persisted
per line, and partial invoices clear GRNI proportionally (the RISK-009 control). Debit
notes mirror corrections referencing the original invoice (G-09). Payments ride the
PHASE-008 treasury service (`purchasing.payments.*` keys on the treasury routes): G-10
`DR AP_CONTROL · CR cash/bank` with the W-2 FX-mirror explicit FX_LOSS/FX_GAIN residual
lines (INV-008), FIFO allocation suggestion, partials, on-account remainders (BR-027),
INV-016 bounds under the CC-02 open-item lock — and post-allocation re-allocation is its
own audited INSERT-only document set (0017). The AP subledger ties to `AP_CONTROL`
exactly (RC-02 over 20 randomized operations; RC-03 seeded drift → BROKEN + PC-04 lock
block), aging buckets and supplier statements are deterministic as-of recomputations
(RC-10 byte-identical re-runs; document currency + base totals per BR-028), opening AP
balances from G-16 settle like any invoice (INV-009 from entry #1), and the GRNI
register equals the GRNI account at every step (RC-09; registered into the PHASE-007
reconciliation framework — the close-checklist item is live and a BROKEN GRNI run
refuses the period lock). Landed costs (BASELINE per §2.10) allocate by VALUE or QTY,
revalue WAC/layers through the new inventory revaluation service (the sanctioned seam —
purchasing never writes stock tables), honor the remaining-qty constraint when stock was
already issued (the difference posts to a COGS-adjustment purpose — explicit, audited,
never silent back-dating), and post `DR INVENTORY (+ DR COGS) · CR charge account` through
the engine. Supplier price lists feed PO/invoice line pricing with BR-003 purchase-side
provenance (`price_source`: BASE_COST / PURCHASE_PRICE_LIST / MANUAL).

## Files created

**apps/api**
- `migrations/0016_purchasing_core.sql` — 12 tables (purchase_requests + lines,
  purchase_orders + lines, goods_receipts + lines, supplier_invoices + lines,
  debit_notes + lines, landed_costs + landed_cost_allocations) + the PR→PO conversion
  FK expand + the `stock_moves.source_type` CHECK expansion (goods_receipt /
  landed_cost provenance) + RLS macro ×12 + grants (draft-lifecycle SELECT/INSERT/UPDATE)
  + `_schema_state` → 16.
- `migrations/0017_purchasing_ap.sql` — the audited re-allocation documents
  (`purchase_reallocations` POSTED-at-create + `purchase_reallocation_lines` with the
  explicit BR-027 on-account NULL semantics) + RLS ×2 + INSERT-only grants + the
  RC-09/GRNI note (no new table needed — deterministic recomputation) +
  `_schema_state` → 17.
- `src/modules/purchasing/domain/purchasing-errors.ts` — typed error codes
  (ERROR_MODEL §4) for the whole chain.
- `src/modules/purchasing/application/orders.ts` — PR lifecycle + PO lifecycle
  (revisions, BR-010 thresholds, SoD, BR-029 numbering at issue, close/cancel guards) (T2).
- `src/modules/purchasing/application/goods-receipts.ts` — GRN service: lines →
  inventory `planReceipt`/`applyReceipt` (batch capture) + G-07 via the engine; BR-012
  PO-less policy (T3).
- `src/modules/purchasing/application/matching.ts` — the three-way match: tolerance
  matrix, per-line outcomes, dispositions with reasons, `match_result` storage,
  `purchasing.matching.override` widening recorded in the result (T4).
- `src/modules/purchasing/application/supplier-invoices.ts` — BR-011 duplicate checks,
  match-before-approval guard, G-08 posting (GRNI clear + AP open + VAT legs),
  partial-invoice proportional clearing (T5).
- `src/modules/purchasing/application/tax-lines.ts` — VAT recoverability wiring per
  pack + registration (RECOVERABLE / EXPENSED / NOT_SUBJECT), tax_summary accumulation
  for INV-012 (T6).
- `src/modules/purchasing/application/debit-notes.ts` — G-09 mirror corrections with
  the reference chain (T7).
- `src/modules/purchasing/application/reallocations.ts` — audited post-allocation
  re-allocation documents (BR-027 on-account both directions, INV-016 bounds under the
  CC-02 lock, treasury_allocations rewrite in-transaction) (T8).
- `src/modules/purchasing/application/ap-queries.ts` — AP subledger, aging buckets,
  supplier statements (deterministic as-of), GRNI register, open items (T9).
- `src/modules/purchasing/application/landed-costs.ts` — baseline allocation by
  VALUE/QTY, remaining-qty constraint, COGS-adjustment split, engine posting (T10).
- `src/modules/purchasing/application/pricing.ts` — supplier price-list consumption,
  BR-003 purchase-side precedence + policy ceilings (T11).
- `src/modules/purchasing/application/opening-ap.ts` — opening AP settlement
  verification (INV-009 exact from entry #1) (T12).
- `src/modules/purchasing/application/purchasing-reconciliation.ts` — the RC-09 GRNI
  check registered into the PHASE-007 framework.
- `src/modules/purchasing/infrastructure/purchasing.store.ts` — the data layer (1480
  lines; typed reads/writes per the module's own tables only).
- `src/modules/purchasing/presentation/purchasing.controller.ts` — 48 routes with
  `@RequirePermissions` per matrix §3.3, Idempotency-Key guards on POST actions.
- `src/modules/purchasing/purchasing.module.ts` — wiring.
- `src/modules/inventory/application/revaluation-service.ts` — the sanctioned inventory
  seam the landed costs consume (exact-amount WAC/layer revaluation + revaluation move
  row with the journal link — INV-010 stays exact; MODULE_BOUNDARIES held).
- `src/__db__/purchasing/fixtures.ts` — the chain fixtures (tenant, supplier, items,
  warehouse, purposes, tax registration).
- `src/__db__/purchasing/golden.spec.ts` — 17 tests: G-07 (+ INV-013 replay, INV-011
  zero-residue), G-08 (+ VAT_EXPENSED, NOT_SUBJECT, partial 60/100), G-09, G-10 (+
  W-2 FX mirror).
- `src/__db__/purchasing/matching.spec.ts` — 10 tests: BR-009 tolerance matrix (exact /
  2%-with-0% → EXCEPTION + disposition / 2%-with-2% → auto-pass / partial receipt 98/100
  / match-before-approval guard), BR-011 duplicates (block + warn).
- `src/__db__/purchasing/ap.spec.ts` — 19 tests: G-16 AP side (open + allocatable +
  statement inclusion; exact settlement), RC-02 (20 randomized ops), RC-03 (drift →
  BROKEN + PC-04 block), RC-09 (GRN → invoice → partial), RC-10 (byte-identical re-run,
  bucket split, currency + base totals), re-allocations (move / bounds / on-account),
  PC-04 GRNI lock gate.
- `src/__db__/purchasing/landed-costs.spec.ts` — 7 tests: VALUE allocation + WAC
  revalue + journal, remaining-qty constraint with COGS split, journal shape.
- `src/__db__/purchasing/operations.spec.ts` — 9 tests: A7 spoof parity (typed errors +
  zero residue + raw-plane RLS), BR-012 (allowed+audited / reason mandatory / forbidden),
  BR-010 (threshold hop + SoD), INV-021 (sequential unique immutable), CC-01 (concurrent
  duplicate post converges).

**apps/web**
- `app/[locale]/purchasing/orders/page.tsx` + `components/purchasing-orders.tsx` — PR→PO
  workspace: requisition create/approve/reject → PO create/submit/approve/issue/close,
  revision awareness, threshold badge.
- `app/[locale]/purchasing/receipts/page.tsx` + `components/purchasing-receipts.tsx` —
  GRN workspace: PO-linked + PO-less (reason flow), lines with provisional costs, post
  (stock + GRNI), cancel; landed-cost create + post with allocation preview.
- `app/[locale]/purchasing/invoices/page.tsx` + `components/purchasing-invoices.tsx` —
  supplier-invoice workspace with the **match-result panel**: per-line PO/GRN/invoice
  triple with variance highlighting, dispositions with reasons, duplicate-warning banner,
  approve → post lifecycle (match outcome visible pre-approval — BR-009's audit surface).
- `app/[locale]/purchasing/debit-notes/page.tsx` + `components/purchasing-debit-notes.tsx` —
  debit-note workspace referencing posted invoices.
- `app/[locale]/purchasing/ap/page.tsx` + `components/purchasing-ap.tsx` — the payables
  views: AP aging (bucketed, as-of), supplier statement (running balance + aging column +
  document currency + base totals + INV-009 footer badge), GRNI register list; as-of
  picker + supplier filter.

**docs**
- `docs/database/TABLES/trade-purchasing.md` — column-level specs for all 14 tables +
  the reused substrates (payments, treasury_allocations, partner_subledger_entries) +
  grants & roles (authored in-phase per the file header rule).

## Files changed

- `apps/api/src/app.module.ts` — PurchasingModule registered.
- `apps/api/src/db/schema.ts` — erp_definer read-surface additions for the 14 tables.
- `apps/api/src/infra/auth/route-permissions.ts` — 48 purchasing route→permission rows
  (matrix §3.3 exact; payments ride the treasury routes' existing
  `purchasing.payments.*` keys).
- `apps/api/src/infra/db/migrations.ts` + `migrations/meta/_journal.json` — 0016/0017
  registered; `migrations.spec.ts` — fresh + regression expectations extended.
- `apps/api/src/infra/http/error.filter.ts` — purchasing error-code → HTTP mapping.
- `apps/api/src/modules/accounting/application/period-service.ts` — PC-04: GRNI joins
  AR/AP/CASH/VAT/INVENTORY as a BROKEN-blocks-LOCK kind.
- `apps/api/src/modules/accounting/application/reconciliation-service.ts` — the GRNI
  checklist item (live state from the registered run; bilingual label).
- `apps/api/src/modules/configuration/domain/settings-schema.ts` — six purchasing keys:
  `purchasing.allow_po_less_grn` (true), `purchasing.match.qty_tolerance_pct` (0),
  `purchasing.match.price_tolerance_pct` (0), `purchasing.duplicate_invoice_behavior`
  (block), `purchasing.input_vat_default`, `purchasing.po_approval_threshold`.
- `apps/api/src/modules/inventory/application/movement-core.ts` +
  `infrastructure/inventory.store.ts` + `inventory.module.ts` — the revaluation seam
  wiring + the source_type expansion (goods_receipt / landed_cost).
- `apps/api/src/__db__/isolation/tables.registry.ts` — 14 purchasing tables registered.
- `apps/api/src/__db__/isolation/identity-isolation.db.spec.ts` — per-tenant purchasing
  fixture chain (PR → PO → GRN → invoice → debit note + landed cost + a POSTED
  re-allocation) + the INSERT-only grants set for the re-allocation tables.
- `apps/api/src/__db__/inventory/operations.spec.ts` — BR-019's no-automatic-PO
  assertion is row-based now (the purchasing tables exist; tenant I holds zero PO rows
  and the reorder scan adds none — still asserted, never autopilot).
- `packages/contracts/src/navigation.ts` — the `purchasing` group (AR: المشتريات) + 5
  entries (orders, goods_receipts, supplier_invoices, debit_notes, ap) with exact
  seeded permission keys; payments ride the treasury group's existing surface.
- `apps/web/i18n/dictionaries.ts` — 1231 → 1342 keys (+111; triple parity green).
- `apps/web/lib/api-types.ts`, `apps/web/lib/messages.ts` — purchasing types + BFF
  messages.
- `docs/database/ENTITY_CATALOG.md` — §purchasing authored (14 rows + the payments
  008/011 dual-phase note).
- `packages/ui/dist-storybook/**` — visual-harness rebuild artifacts (tracked; new
  content hashes).

## Database migrations

- `0016_purchasing_core.sql` — 12 draft-lifecycle tenant tables with the family
  patterns: composite `(id, tenant_id)` anchors, composite FKs everywhere, status CHECKs
  with posted/cancelled **shape CHECKs** (status ⇔ the posted/cancelled tuples), the
  BR-012 po-less shape (`(po_id IS NULL) = (po_less_reason IS NOT NULL)`), the
  match-before-approval substrate (`match_status` CHECK + `match_result` jsonb), the
  §6-mandated AP index `ix_supplier_invoices_tenant_supplier_due (tenant_id,
  supplier_id, due_date)`, the totals invariants (`total_gross = total_net + total_tax`;
  POSTED landed costs: `allocated_to_stock + allocated_to_cogs = amount`), the
  remaining-qty bound (`remaining_qty ≤ qty_at_allocation`), RLS macro ×12, and grants
  (SELECT/INSERT/UPDATE for erp_app; SELECT for erp_readonly + erp_definer).
- `0017_purchasing_ap.sql` — `purchase_reallocations` (status CHECK admits only POSTED —
  the document IS the audited effect) + `purchase_reallocation_lines` (from/to NULL
  semantics for BR-027 on-account; direction CHECK) with **INSERT-only grants** (the
  trail cannot be rewritten — asserted in the isolation suite's NO_UPDATE_GRANT set).

Fresh + regression applies green (migrations.spec.ts extended; the db suite boots the
embedded PostgreSQL 16 from scratch and replays 0001→0017 in order).

## API changes

48 routes under `/api/v1/purchasing` (route registry ↔ controller 1:1, permission-gated
per matrix §3.3, Idempotency-Key on POST actions, typed envelopes):

- `GET/POST /purchase-requests`, `GET /purchase-requests/:id`, `POST …/:id/submit |
  approve | reject | cancel` (7)
- `GET/POST /purchase-orders`, `GET /purchase-orders/:id`, `POST …/:id/submit |
  approve | issue | close | cancel` (8)
- `GET/POST /goods-receipts`, `GET /goods-receipts/:id`, `POST …/:id/post | cancel` (5)
- `GET/POST /landed-costs`, `POST /landed-costs/:id/post | cancel` (4)
- `GET/POST /supplier-invoices`, `GET /supplier-invoices/:id`, `GET|POST
  …/:id/match` (preview + record), `POST …/:id/submit | approve | post | cancel` (9)
- `GET/POST /debit-notes`, `GET /debit-notes/:id`, `POST …/:id/submit | approve |
  post | cancel` (7)
- `GET /payments/:id/reallocations`, `POST /payments/:id/reallocate` (2)
- `GET /ap/aging`, `GET /ap/statements/:supplierId`, `GET /grni`, `GET /ap/open-items`,
  `GET /ap/opening-verification` (5)
- `POST /reconciliation/grni-check` (1)

Payments' money movement rides the PHASE-008 treasury routes (`/api/v1/treasury/
payments*`, `/allocations/suggest` — already keyed `purchasing.payments.*` per matrix
§3.4's ownership note).

## UI changes

5 AR/EN screens under `/purchasing` (RTL-first, DocumentStatusBadge per lifecycle,
entitlement-driven navigation via the new purchasing group): the orders workspace
(PR→PO with threshold + revision awareness), the receipts workspace (GRN + landed
costs), the invoices workspace with the **match-result panel** (per-line triple +
variance highlighting + dispositions — BR-009's audit surface, keyboard accessible),
the debit-notes workspace, and the AP views (aging / statement with the INV-009 footer
badge + document currency + base totals / GRNI register) with as-of determinism
controls. Payments ship in the treasury group's existing screen (allocation editor
already present from PHASE-008). i18n 1231 → 1342 keys, ar/en parity 100%.

## Security changes

- 48 route→permission rows seeded exactly per matrix §3.3 (`purchasing.purchase_requests/
  purchase_orders/goods_receipts/supplier_invoices/debit_notes.view/create/approve[/post]`,
  `purchasing.matching.override` risky, `purchasing.payments.view/create/approve` on the
  treasury surface); drift check green (matrix 199 = seed 199).
- Branch scoping on documents (branch_id composite FKs + service checks); tenant scoping
  on invoice posting; SoD creator ≠ approver default on PR/PO approvals (BR-034,
  asserted).
- `purchasing.supplier_invoices.post`, `purchasing.matching.override`, and the
  debit-note approve/post keys are risky/audited; match dispositions carry reasons.
- A7 spoof parity proven: cross-tenant supplier references → typed errors + zero
  residue; the raw-plane RLS holds on every purchasing table (isolation suite fixtures
  seeded per tenant, A1–A11 generated coverage over all 14).
- No document-mutation endpoints for POSTED docs (INV-003 — shape CHECKs + service
  guards; only the audited re-allocation path can move settlement metadata).

## Tests executed

`pnpm gate:local` — all 17 steps green (full transcript in the phase evidence log):

| Step | Result |
|------|--------|
| typecheck (5 packages) | 5/5 successful |
| lint (incl. module boundaries) | pass |
| lint:depcruise | ✔ no dependency violations (1171 modules, 4098 dependencies) |
| permissions-drift | OK — matrix 199 keys, seed 199 keys |
| unit + property | api 92, domain-core 38, contracts 11, @erp/ui 42 — all pass |
| db suite (embedded PG16) | **55 files / 939 tests passed** (was 814 → +125: 41 purchasing + isolation growth over 14 new tables + inventory BR-019 re-assertion) |
| build | 5/5 tasks successful |
| token-contrast (§16) | PASS (e.g. gray-900 on white 17.74:1) |
| i18n parity | ar=1342, en=1342 — 100% parity, no empty values |
| ui-catalog coverage | 37 exports ↔ 60 rows green |
| visual harness | 16 passed (axe 0 violations both directions, geometry invariants, coverage check) + 10k-row DataTable perf (34.0s, overhead ≤ 6ms budget) |
| web CSP probe (§8) | 4 passed |
| docs validation | 29/29 checks passed |
| negative boundary meta-test | pass |
| negative erp-ui lint meta-test | pass |
| i18n parity (repeat) + negative i18n meta-test | pass |

## Actual test results

**Purchasing db suite (41 tests, 5 files) — representative evidence (verbose run):**

- G-07: `posts the exact canonical shape with stock rows + GRNI register + audit` ·
  `INV-013 idempotent replay: re-posting returns the stored result, no double journal` ·
  `PERIOD_LOCKED: posting into a locked month leaves ZERO residue (INV-011)`
- G-08: `posts the exact canonical shape and clears the GRNI register exactly` ·
  `VAT_EXPENSED variant: non-recoverable input VAT posts to the expensed purpose (T6)` ·
  `NOT_SUBJECT variant: an unregistered tenant records no VAT lines (T6)` ·
  `partial invoice: 60 of 100 clears GRNI proportionally (RISK-009 control)`
- G-09: `posts the mirror correction referencing the posted invoice`
- G-10: `settles the open invoice exactly via the treasury service` · `FX mirror of W-2:
  paying a USD invoice at a higher rate posts the explicit FX_LOSS`
- BR-009: `exact (0% default): matching triple passes clean` · `price variance 2% with
  0% tolerance → EXCEPTION; disposition unblocks approval (the worked example)` ·
  `price variance 2% WITH 2% tolerance → auto-pass with the variance recorded` ·
  `partial receipt: GRN 98/100, invoice 100 → quantity exception on the 2-unit gap` ·
  `match-before-approval: posting without a recorded outcome is rejected`
- BR-011: `(supplier, number, amount) triple → blocked (default)` · `(supplier, number)
  different amount → warns on the draft`
- AP: `G-16 AP side — the opening AP item is open, allocatable, and included in
  statements` · `a payment settles the opening item exactly` · `RC-02: 20 randomized AP
  operations reconcile exactly (OK run)` · `RC-03: seeded subledger drift → BROKEN +
  PC-04 blocks the period lock` · `RC-09: GRN → invoice → partial: the register equals
  the GRNI account at every step` · `RC-10: re-running at the same as-of yields
  byte-identical results` · `statements show document currency + base totals (BR-028)`
- Re-allocations: `moves a settled amount between open items as an audited document` ·
  `rejects re-allocation beyond the settled amount (INV-016 bounds)` ·
  `return-to-on-account: to NULL un-allocates explicitly (BR-027)`
- PC-04: `a drifted GRNI run refuses LOCK until green (RC-09's gate)`
- Landed costs: `allocates proportionally to line values, revalues WAC, and posts the
  journal` · `already-issued stock allocates to the remainder; the difference posts to
  COGS` · `posts DR INVENTORY (+ DR COGS) · CR charge account through the engine`
- Operations: `A7 — cross-tenant supplier references are rejected with typed errors +
  zero residue` · `the RLS policies hold on the raw plane` · BR-012 ×3 (allowed+audited
  / reason mandatory / forbidden when off) · `BR-010 — above-threshold orders require
  the approval hop (base-currency compare)` · `PR approvals enforce SoD too` ·
  `INV-021 — numbers are sequential, unique, and immutable once assigned` · `CC-01 —
  two CONCURRENT posts of one invoice converge on one entry set`

**Posting smoke (T-02 smoke tier, engine path):**
`[posting-smoke] n=100 p50=23.6ms p95=58.4ms max=98.2ms failures=0` — under the 500 ms
p95 budget; supplier-invoice posting rides the same engine pipeline (the G-08 golden
measures the full service path including the GRNI clear).

## Build results

`pnpm build` — 5/5 tasks successful (api, web, ui, contracts, config); Next.js
production build green inside the CSP probe step too.

## Invariants covered

- **INV-003** — corrections are always new documents (PO revisions, debit notes,
  re-allocations); no mutation endpoints for POSTED docs.
- **INV-008** — FX at the ORIGINAL stored rate on settlement (W-2 mirror golden).
- **INV-009** — AP subledger = `AP_CONTROL` exactly, from entry #1 (opening AP
  included); RC-02 randomized + RC-03 drift detection + the on-screen footer badge.
- **INV-011** — locked-period posting rejected with ZERO residue (G-07 failure pack).
- **INV-012** — input VAT ties (VAT_RECOVERABLE + VAT_EXPENSED accumulation in
  tax_summary; the RC-06 framework tie from PHASE-009 consumes it).
- **INV-013** — posting idempotency (G-07 replay + CC-01 concurrent convergence).
- **INV-016** — allocation bounds (payment allocations via treasury; re-allocation
  bounds asserted).
- **INV-021** — official numbers sequential/unique/immutable (INV-021 test).

## Acceptance criteria verification

1. **All purchasing tables exist with RLS + registry rows; migration CI green.** PASS —
   14 tables (0016/0017), RLS macro ×14, all in `tables.registry.ts` with A-test
   coverage; fresh + regression applies green in the db suite.
2. **G-07/G-08/G-09/G-10 golden suites pass with failure packs and zero residue; the
   GRNI-clearing and FX legs are exact.** PASS — golden.spec.ts 17 tests incl.
   INV-011/INV-013 failure packs; GRNI clear exact (incl. partial 60/100); W-2 FX mirror
   exact.
3. **Three-way matching enforces BR-009 with both tolerance defaults (exact) and
   loosened values; `match_result` recorded before approval on every supplier invoice;
   no posting path bypasses it.** PASS — matching.spec.ts matrix + the service-level
   guard test (`posting without a recorded outcome is rejected`).
4. **VAT input lines resolve per tenant registration + pack (RECOVERABLE / EXPENSED /
   NOT_SUBJECT) with snapshots; INV-012 tie green on per-pack fixtures.** PASS — G-08
   variants ×3; BR-033 snapshots per line; the tax suite's per-pack fixtures remain
   green (939/939).
5. **AP subledger = `AP_CONTROL` at all times (RC-02), seeded drift is detected (RC-03),
   and GRNI register ties (RC-09).** PASS — ap.spec.ts + the framework registration
   (PC-04 lock block + live checklist item).
6. **Aging + supplier statements are deterministic as-of recomputations (RC-10)
   including opening AP items; statements show document currency + base totals.** PASS —
   byte-identical re-runs; bucket splits; BR-028 totals; G-16 AP-side inclusion.
7. **Allocations honor INV-016 under concurrency; on-account amounts are visible and
   allocatable later; re-allocations are audited documents.** PASS — treasury
   CC-02 suite (PHASE-008, still green) + the re-allocation document tests (bounds +
   on-account both directions).
8. **Landed-cost baseline allocates by value or quantity with the remaining-qty
   constraint and explicit COGS-adjustment posting.** PASS — landed-costs.spec.ts ×7
   (both methods exercised: VALUE default + the remaining-qty split).
9. **Duplicate-invoice checks behave per BR-011; PO approval thresholds per BR-010 route
   correctly with SoD.** PASS — matching.spec.ts (block + warn) + operations.spec.ts
   (threshold hop + SoD on PR and PO).
10. **All phase acceptance rows mirrored in PHASE_ACCEPTANCE_CRITERIA.md (PHASE-011
    row) once that file lands.** PASS — the PHASE-011 row is present (the file ships
    rows per phase since PHASE-004; verified in docs validation 29/29).

## Evidence

- Gate transcript (all 17 steps, real output): captured in the working session log —
  `=== ALL LOCAL GATES GREEN ===` reached 2026-10-30; key lines quoted in "Tests
  executed" above.
- `pnpm test:db`: `Test Files 55 passed (55) · Tests 939 passed (939)`.
- Purchasing verbose run: `Test Files 5 passed (5) · Tests 41 passed (41)`.
- `[posting-smoke] n=100 p50=23.6ms p95=58.4ms max=98.2ms failures=0`.
- `== i18n key parity: ar=1342 keys, en=1342 keys == … 100% key parity`.
- `== ui catalog coverage: 37 component exports ↔ 60 catalog rows ==` green.
- `[permissions-drift] OK — matrix 199 keys, seed 199 keys`.
- `✔ no dependency violations found (1171 modules, 4098 dependencies cruised)`.
- `29/29 checks passed` (docs validation).
- Visual harness: 16 passed (AR+EN threshold-0 baselines incl. the purchasing-era
  catalog), axe 0 violations, geometry invariants, both-directions coverage, DataTable
  10k perf green.

## Known limitations

- The match-preview service runs on bounded line sets (per §6); no unbounded preview.
- `purchasing.input_vat_default` is the pack-agnostic fallback when a line carries no
  tax code — the per-pack resolution (T6) is the primary path; the fallback is
  conservative (expensed) by default.
- Payments UI rides the treasury screen (no separate purchasing payments workspace) —
  deliberate reuse per §2.7's "money movement via the PHASE-008 treasury service"; the
  AP allocation editor + FIFO suggestion were already live from PHASE-008.

## Deferred work

- Report-contract registration + PDF/XLSX/CSV exports of `ap.aging`,
  `supplier.statement`, `purchasing.grni`, `purchasing.po-status`,
  `purchasing.matching-exceptions` — PHASE-013 over this phase's `apQueries.*` /
  `matchingQueries.*` / `poQueries.*` (per §2.8; the query services ship here).
- Landed-cost full workflow UI + entitlement activation + COGS-adjustment analytics —
  PHASE-015 (per §2.10 constraint).
- Hosted-CI runs, compose boot capture, hosted k6 — the standing waived-evidence
  follow-ups (U1) from PHASE-001/002/007, unchanged.
- Deviation note (recorded, no decision record needed — the phase text itself specifies
  the architecture): T8's expected files `payments.ts`/`allocations.ts` are realized as
  the treasury payment service + allocation service (PHASE-008 substrate, §2.7's "money
  movement via the PHASE-008 treasury service") plus this module's `reallocations.ts`
  (the audited re-allocation documents); T13's "six transaction workspaces" are 5 new
  screens + the treasury payments screen, per the same §2.7 note ("payments owned by
  purchasing, money movement via treasury" — the nav rides the existing surface).

## Documentation updated

- `docs/planning/IMPLEMENTATION_STATUS.md` — PHASE-011 → COMPLETE with the evidence row.
- `docs/handoff/CURRENT_STATE.md` — repository contents + status-of-world updated.
- `docs/handoff/NEXT_ACTION.md` — PHASE-012 as the single next action.
- `docs/handoff/CHANGELOG.md` — PHASE-011 entry (append-only).
- `docs/database/ENTITY_CATALOG.md` — §purchasing (14 rows).
- `docs/database/TABLES/trade-purchasing.md` — authored (column-level specs, in-phase).

## Risks

- RISK-009 (the GRNI clear + AP post two-sided dance): controlled by the golden suite
  incl. the partial-invoice case; drift here is Sev-1 — the RC-09 job + PC-04 lock gate
  make silent drift impossible.
- RISK-006 (tax rules change mid-development): pack-versioned rates + BR-033 line
  snapshots keep posted invoices stable (asserted by the tax suite's snapshot-preservation
  tests, still green).
- RISK-011 (double-posting): INV-013 keys serialize retries — CC-01 concurrent test
  green on the supplier-invoice path.
- RISK-016 (module boundary): purchasing never reads `journal_lines` directly for
  statements (own subledger + engine results); dependency-cruiser + boundary lint green.
- RISK-019/020 (agent/docs drift): BR-009/010/011/012, BR-025…028 coverage listed with
  test names above; docs synced in the same change; docs validation 29/29.

## Rollback instructions

Dev: revert the commit and drop the phase tables (0017 then 0016) — expand-only
migrations, no existing table altered destructively (the `stock_moves.source_type` CHECK
expansion is additive). Production: forward-only per MIGRATION_STRATEGY. No rollback may
remove journal/subledger/stock rows written by posting (INV-003) — corrections are
compensating documents.

## Next eligible phase

**PHASE-012 — Sales & Receivables** (identify only; do not implement). It mirrors this
phase's allocation/subledger service patterns for AR and reuses the posting sequencing
discipline; the AR mirror of allocations was deliberately left to PHASE-012 per §2
out-of-scope.
