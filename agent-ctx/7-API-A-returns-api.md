# 7-API-A — Returns & Collections API (PHASE-039, apps/api)

Task: PHASE-039 task 7-API-A per the task brief (customer RMAs G-35/36/37,
warranties, supplier RMAs G-38, controllers, job, wiring, specs, gates).
Scope guard honored: only `apps/api` touched; no web, no docs, no migrations
(0055–0059 were already committed at schema_version 59; Drizzle mirrors in
`src/db/schema.ts` were already present).

## Context for later agents

- The production code for this task (errors, stores, services, controllers,
  job, wiring) had been written by a previous run but was uncommitted and
  MISSING both DB specs; this run audited every file against the task brief,
  found no contract violations, wrote the two DB specs, and drove all four
  gates to green.
- Tenant ids in play for the db specs: they reuse the SHARED family tenants —
  sales `TENANT_S` (src/__db__/sales/fixtures.ts) and purchasing `TENANT_P`
  (src/__db__/purchasing/fixtures.ts) — with delta-based stock asserts and
  per-test PO/invoice chains, per the fixtures' documented discipline.
- Deterministic spec dates live in FY2026-November (2026-11-04..11): inside
  the default 14-day `sales.return_window_days` and outside every
  PERIOD_LOCKED pack (March/December are the ones other files lock+reopen).
- Two NEW dedicated GL accounts created by the specs (find-or-create, root,
  postable): `5190` EXPENSE "Scrap loss (returns)" (tenant S) and `2145`
  LIABILITY "Purchase returns (RTV)" (tenant P), mapped through the
  `sales.scrap_loss_account` / `purchasing.supplier_return_account` settings.

## Files (this task's deliverables; all uncommitted in apps/api)

New (previous run + this run's audit):
- `src/modules/sales/domain/sales-errors.ts` (280 lines; +92 appended: the
  11 typed errors — RmaNotFound/RmaStateInvalid{current,attempted}/
  RmaQtyExceedsInvoiced{lineId,qty,available}/RmaDispositionRequired/
  ScrapLossAccountUnmapped/WarrantyNotFound/WarrantyTermsInvalid/
  SupplierRmaNotFound/SupplierRmaStateInvalid/SupplierRmaQtyExceedsPurchased/
  SupplierReturnAccountUnmapped)
- `src/modules/sales/infrastructure/returns.store.ts` (492) — drizzle-orm
  store over returnAuthorizations/Lines + warrantyRegistrations; open-RMA
  fold excludes terminal RMAs (their CN already counts as credited);
  creditedQtyByInvoiceLine replicates credit-notes.ts as one GROUP BY
- `src/modules/sales/application/rma.ts` (607) — ReturnsService; exported
  pure `computeReturnAvailability`; complete() = ONE ambient UoW driving
  CreditNoteService create→approve→post (CN creator = RMA requester, so the
  CN's own SoD forces completer ≠ requester)
- `src/modules/sales/application/warranties.ts` (223) — terms validation,
  whole-UTC-month endDate, 30/7/0 sweep with per-window dedupe keys
- `src/modules/sales/infrastructure/warranty-expiry.job.ts` (77) — queue
  `sales.warranty-expiry-sweep`, cron `50 2 * * *`, entitlement gate
- `src/modules/sales/presentation/returns.controller.ts` (267) — zod at top,
  envelope, requireIdentity, @RequireFeature sales.rma / sales.warranties
- `src/modules/purchasing/application/supplier-rma.ts` (524) —
  SupplierReturnsService to CREDITED
- `src/modules/purchasing/infrastructure/supplier-returns.store.ts` (329)
- `src/modules/purchasing/presentation/supplier-returns.controller.ts` (177)
- `src/modules/sales/__tests__/rma-bounding.spec.ts` (39; 7 pure tests)
- NEW THIS RUN `src/__db__/sales/returns.db.spec.ts` (600; 5 tests)
- NEW THIS RUN `src/__db__/purchasing/supplier-returns.db.spec.ts` (442; 2 tests)

Modified (wiring): sales.module.ts (+33/-2), purchasing.module.ts (+13/-1),
route-permissions.ts (+25: 8 sales RMA + 3 warranties + 7 purchasing RTV
routes), tables.registry.ts (+11: the 5 tables, deleteGranted only on the
two line tables), settings-schema.ts (+19: the two fail-closed account
settings), notifications inbox-service.ts (+6: categories collections +
warranties).

## Decisions (documented in code headers, restated here)

1. SCRAPPED re-entry: `CreditNoteService.create` only persists a draft; the
   W-3 original-cost re-entry machinery lives in its `post()` step
   (`credit_note:reentry` + planReceipt/applyReceipt). Completion therefore
   drives the FULL CN lifecycle in-transaction (create → approve → post) —
   RESTOCK/REFUND set returnToStock=true on stock lines and let the CN's own
   leg re-shelve (G-35 = that linkage, no re-implementation in the RMA);
   SCRAP sets returnToStock=false and posts G-36 directly
   (`return_authorization:scrap`: DR sales.scrap_loss_account · CR COGS at
   Σ qty × the invoice line's issueUnitCost snapshot; unmapped setting →
   ScrapLossAccountUnmappedError BEFORE any ledger work, RMA stays
   INSPECTED).
2. Supplier DN at CREDITED: `DebitNoteService` does NOT fit the return
   shape — its create() demands a POSTED supplier-invoice reference and its
   post() emits the generic G-09 mirror (DR AP gross · CR INVENTORY/expense
   · CR VAT), while a return credit is DR AP_CONTROL · CR the mapped returns
   account at net with no VAT legs. `credit()` posts G-38 directly and
   creates the DN document through the debit-notes STORE
   (insertDebitNote + updateDebitNoteStatus) stamped POSTED against the
   G-38 journal — required because 0059's lifecycle CHECK demands
   debit_note_id at CREDITED; the DN references the PO's earliest POSTED
   supplier invoice (ref_invoice_id is NOT NULL).
3. Supplier ship inventory source: the stock_moves source CHECK was NOT
   widened; the issue rides the generic `manual_issue` source with
   reason `SUPPLIER_RETURN` and source_id = the SRMA.
4. Ship journal: ONE inventory journal for the whole shipment — DR the
   mapped `purchasing.supplier_return_account` · CR warehouse INVENTORY at
   the issue value; G-38 then credits the same account at net, so
   cost==price nets it to zero and any difference stays in the returns
   account (its documented purpose).
5. G-37 cash movement rides the G-33 pattern verbatim: currency = base,
   exchangeRate "1", baseAmount = gross, source return_authorization; the
   table's (tenant, source_type, source_id, cash_account_id, direction)
   UNIQUE makes it exactly-once on the treasury side.

## Gate evidence (2026-11-11, apps/api)

- `npx tsc --noEmit -p tsconfig.json` — clean (no output)
- `npx eslint src/modules/sales src/modules/purchasing
  src/infra/auth/route-permissions.ts src/__db__/isolation/tables.registry.ts
  --fix` — clean (no findings)
- `npx vitest run src/modules/sales/__tests__/rma-bounding.spec.ts` —
  1 file / 7 tests passed
- `npx vitest run --config vitest.db.config.ts src/__db__/sales/returns.db.spec.ts
  src/__db__/purchasing/supplier-returns.db.spec.ts` — 2 files / 7 tests
  passed (embedded PG 16 boots itself ~7s)

DB spec coverage: customer (a) full ladder with SoD rejection + RESTOCKED
completion asserting the CN (POSTED, CRN-2026-n, exact G-04-mirror totals),
the exact `credit_note:reentry` journal at 2 × issueUnitCost, stock +2
delta, terminal stamps = the CN's journal, BR-064 replay typed, and the
`collections` inbox notification; (b) qty bound incl. open-RMA fold and the
inclusive boundary; (c) typed state skips + cancel gates; (d) SCRAP unmapped
→ ScrapLossAccountUnmappedError, RMA stays INSPECTED with zero stray CNs,
then mapped → SCRAPPED with the exact G-36 journal and NO re-entry; (e)
REFUND requires the cash account (typed), then posts the exact G-37 journal
(DR AR_CONTROL / CR cash) + the OUT cash movement (amount/baseAmount gross,
rate "1.00000000") and keeps the G-35 re-entry linkage. Supplier: full
ladder with SoD + unmapped failure pack, manual_issue move with the
SUPPLIER_RETURN marker, ship journal == the move's value, exact G-38
journal, DN POSTED against that journal, replay typed; bounding with
open-fold, cancel-frees-qty, and the state gates.

## Deviations / notes for the orchestrator

- Pre-existing failures NOT caused by this task (verified on clean HEAD via
  `git stash`): `src/infra/db/migrations.spec.ts` still pins the manifest's
  last tag to `0054_capex_tenders` while the foundation commit added
  0055–0059 (foundation fallout — fixing it means touching a migration-suite
  expectation owned by the foundation/docs tasks); and
  `src/modules/tax/__tests__/zatca-qr-decode.spec.ts` needs Playwright
  browsers not installed in this sandbox (PHASE-037 area, environment).
- The warranty-expiry `expiringWarranties` store gate reads "not notified
  today" (last_notified_at::date < CURRENT_DATE) + the per-window inbox
  dedupe key `warranty-expiry:{id}:{window}`; windows run tightest-first
  inside one run, so a warranty expiring today fires only the 0-day warning
  in that run (documented in warranties.ts).
- `sales.return_window_days` (default 14) applies to the completion CN via
  CreditNoteService; the specs stay inside it with fixed November dates. A
  tenant returning beyond the window gets the CN's own typed
  ReturnWindowExceededError — surfaced as-is from complete().
- Unit/full-suite collateral check: `npx vitest run` = 505 passed / 3
  skipped, only the two pre-existing failures above.
