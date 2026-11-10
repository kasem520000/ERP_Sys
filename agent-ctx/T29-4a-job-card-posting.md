# T29 / Task 4-a — Job-card posting path (PHASE-017 T4)

**Agent:** 4-a (job-card posting port + two revenue natures) · **Task ID:** 4-a · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — typecheck green, ESLint green (exit 0), own spec 5/5, 3-a spec 5/5, full sales+pos suite 57/57 (×3 consecutive runs), distribution 6/6 + vehicles 13/13.

## Files

| File | Kind | Notes |
|---|---|---|
| `apps/api/src/modules/sales/job-cards/application/posting/job-card-posting.ts` | new | `JobCardPosting implements JobCardPostingPort` — `issuePartsImmediate`, `invoiceCard`, `warrantyCreditNote` |
| `apps/api/src/modules/sales/application/invoices.ts` | edit (surgical) | `InvoiceLineInput.focReasonCode`; create input `jobCardId`/`vehicleId` (card existence-validated via the job-cards store read); **post() revenue-nature split**; flow-B issue planning skips SERVICE item lines |
| `apps/api/src/modules/sales/application/credit-notes.ts` | edit (surgical) | create input `jobCardId` (persisted to `credit_notes.job_card_id`); `post(id, actor, options?)` gains optional `reentryWarehouseId` → `resolveReentryWarehouse` chain (explicit → invoice → DN) |
| `apps/api/src/modules/sales/infrastructure/sales.store.ts` | edit (additive) | invoice rows/insert/columns: `jobCardId`+`vehicleId`; invoice-line rows/insert/SELECT: `focReasonCode` (0025 columns); credit-note rows/columns/insert: `jobCardId` |
| `apps/api/src/modules/sales/sales.module.ts` | edit | `JobCardPosting` provider + export |
| `apps/api/src/modules/sales/presentation/job-cards.controller.ts` | edit | injects `JobCardPosting`, registers `jobCards.setPostingPort(posting)` in its constructor (before any request) |
| `apps/api/src/__db__/sales/fixtures.ts` | edit (additive) | `gl.serviceRevenue` via `mapPurpose("SERVICE_REVENUE", "4200")` — belt-and-braces over 0025's template marker (`provisionCoaTemplate` already instantiates 4200 + the purpose); coexists with the parallel commission agent's 5250/2150 additions |
| `apps/api/src/__db__/sales/job-card-posting.spec.ts` | new | the 5 golden tests (below) |
| `apps/api/src/__db__/sales/golden.spec.ts` | edit (robustness only) | G-01's absolute on-hand asserts (`A=10`/`B=5`) made **delta-based** — pre-existing order fragility: any sibling spec consuming fixture items before golden.spec broke them (first exposed when my spec + commissions.spec joined the directory). W-1 semantics preserved: Δ−10 / Δ−5 at UNCHANGED WAC 60/25 |

Untouched: distribution module, pricing.ts, commissions (parallel agents own them), `error.filter.ts` (no new error types needed — reused `PERIOD_LOCKED`, `INSUFFICIENT_STOCK`, `JOB_CARD_*`).

## Exact golden journal fixtures asserted (persisted rows, `journal.listLines`)

Fixture numbers: parts 2 × item S-A @100 (STD 15%) + labor 1.5 h × S-LABOR @80/h (STD 15%); COGS at item A's WAC 60 (W-1 opening 20 @60); accounts AR_CONTROL 1130 · SALES_REVENUE 4100 · SERVICE_REVENUE 4200 · VAT_PAYABLE 2120 · SALES_RETURNS 4110 · COGS 5100 · INVENTORY 1140.

1. **reserve settlement** (`sales_invoice:post`): `DR AR_CONTROL 368.0000 · CR SALES_REVENUE 200.0000 · CR SERVICE_REVENUE 120.0000 · CR VAT_PAYABLE 30.0000 · CR VAT_PAYABLE 18.0000` (two revenue natures; per-line VAT in line order). Invoice totals net 320.0000 / tax 48.0000 / gross 368.0000; labor bills qty 1.5 at the per-hour rate.
2. **reserve COGS** (`sales_invoice:cogs`, flow B — the invoice's own issue): `DR COGS 120.0000 · CR INVENTORY 120.0000` (2 × 60); one OUT stock move `sales_invoice`-sourced, qty 2.000000 @ 60; invoice line issue snapshot 60.000000/120.0000; holds → CONSUMED at invoice; on-hand Δ−2, WAC unchanged.
3. **issue_immediate COGS at approval** (`job_card:issue_parts`): `DR COGS 120.0000 · CR INVENTORY 120.0000`; one OUT move `job_card`-sourced; card PARTS line ISSUED with `issue_unit_cost 60.000000 / issue_value 120.0000 / issue_journal_id` stamped; LABOR line untouched (PENDING, no reservation ever exists); re-running the port's issue = no-op (INV-013 probed: journal + move counts unchanged).
4. **issue_immediate invoice = settlement only** (exact shape as #1; `warehouseId NULL`, `postedCogsJournalId null`, no `sales_invoice:cogs` entry at all, zero `sales_invoice` stock moves, on-hand unchanged by invoicing) — exactly ONE COGS journal over the card's whole life (total journal Δ = +2: 1 issue COGS + 1 settlement). The card line's issue snapshot is copied onto the invoice PARTS line (W-3, `markInvoiceLineIssued` — the `createFromDelivery` pattern).
5. **warranty credit note** (`credit_note:post`): `DR SALES_RETURNS 100.0000 · DR VAT_PAYABLE 15.0000 (mirrored) · CR AR_CONTROL 115.0000` + re-entry (`credit_note:reentry`): `DR INVENTORY 60.0000 · CR COGS 60.0000` at the ORIGINAL issue cost (W-3); note `job_card_id` set; CRN- number; stock re-entered: on-hand +1 @ unitCost 60.000000, avg unchanged; note totals 100/15/115, `reentry_value 60.0000`.
6. **PERIOD_LOCKED zero residue**: lock today's period → `service.invoice` rejects `PERIOD_LOCKED`; journal count unchanged, ZERO `sales_invoices` rows for the card, on-hand unchanged, card stays COMPLETED, `invoiceId null`, holds still ACTIVE (nothing consumed). Period reopened in `finally`.
7. **Insufficient stock**: `issue_immediate` approve with qty 5000 ≫ on-hand → `INSUFFICIENT_STOCK`; the atomic UoW rolls back — card stays DRAFT, lines PENDING with no issue/reservation links, no journal, no `job_card` moves, on-hand unchanged.

## Test output (isolated runs, task command)

```
$ TMPDIR=$HOME/tmp-4a npx vitest run --config vitest.db.config.ts src/__db__/sales/job-card-posting.spec.ts
 ✓ src/__db__/sales/job-card-posting.spec.ts (5 tests) 700ms
 Test Files  1 passed (1)   Tests 5 passed (5)

$ ... src/__db__/sales/job-cards.spec.ts   (3-a regression)
 ✓ src/__db__/sales/job-cards.spec.ts (5 tests) 455ms
 Test Files  1 passed (1)   Tests 5 passed (5)

$ ... src/__db__/sales/ src/__db__/pos/    (whole directory, ×3 consecutive)
 Test Files  7 passed (7)   Tests 57 passed (57)   [×3]
$ ... src/__db__/distribution/core.spec.ts src/__db__/partners/vehicles.spec.ts
 Test Files  2 passed (2)   Tests 19 passed (19)
$ pnpm --filter @erp/api typecheck  → clean
$ pnpm --filter @erp/api lint       → clean (exit 0)
```

## Deviations / decisions (read before building on this)

1. **Port constructor** is `(posting: PostingService, invoices: SalesInvoiceService, creditNotes: CreditNoteService, reservations: ReservationService)` — not the suggested `(audit, invoices, reservationService, stockService)`. ADR-0007 forces a PostingService dependency for the `job_card:issue_parts` journal (no composed service exposes it); movement-core is the direct stock path (exactly the invoices.ts/deliveries.ts pattern — `StockService` exposes only manual-issue with a fixed shrinkage counter-account, wrong shape for COGS); the port needs no AuditService of its own (all audit records live in the composed services + the job-card service).
2. **`CreditNoteService.post` (not create) carries the warehouse hint**: `post(id, actorId, options?: { reentryWarehouseId?: string | null })`. The re-entry plan happens at post-time; only the job-card port needs it (issue_immediate invoices carry `warehouseId NULL` because stock left at approval). Backward compatible — every existing caller passes two args.
3. **issue_immediate invoices get the card's issue snapshots copied onto their PARTS lines** (`markInvoiceLineIssued` in `invoiceCard`) so warranty credit notes derive the W-3 re-entry cost uniformly from invoice lines, both modes.
4. **`invoices.post` flow-B planning skips SERVICE item lines** (revenue/VAT only — the COMPOSITE-shell pattern). Required: a with-goods invoice carrying a SERVICE item line (the job-card reserve invoice is the first ever) previously died at `planIssue` with `ItemNotStockedError`. STOCK/COMPOSITE behavior byte-identical (composites-golden still green).
5. **The revenue-nature split is platform-general**: any invoice with SERVICE item lines (job-card labor or otherwise) splits its settlement credits per purpose — `SALES_REVENUE` line first (existing memo/shape unchanged for goods-only invoices: golden/pos/composites all still green byte-identical), then `SERVICE_REVENUE` ("Service revenue (labor)"). Existing suites carry no SERVICE item lines on invoices (verified — service usage there is account lines) — no existing assertion changed by the split itself.
6. **Dates ride today** (UTC date) — the honest invoice/issue date; the port cannot know a fixture date. The PERIOD_LOCKED pack therefore locks *today's* period (November 2026 here) and reopens in `finally`; FY2026 spans it. `dueDate: null` at create → BR-026 computes from the customer's NET-30 terms.
7. **golden.spec G-01 on-hand asserts made delta-based** (robustness fix, not a semantic change): the absolute `A=10/B=5` asserts were order-fragile since before this task — any new consuming spec in the directory (mine, commissions) could run before golden.spec and break them. Now `Δ−10/Δ−5` at unchanged WAC, matching G-03/G-04's existing delta idiom.
8. **Idempotency**: `issuePartsImmediate` skips already-ISSUED lines (all-issued re-run = pure no-op, probed in test 2); the engine's source key `job_card:{cardId}:issue_parts` is exactly-once; a partial re-run (unreachable via the service — approve is DRAFT-only) replays the stored entry and applies fresh plans against it (documented in the port).
9. **Consumed-at-invoice semantics**: under `reserve` the invoice's own post issues the physical stock (flow B, `sales_invoice`-sourced); the port then flips the JOB_CARD holds to CONSUMED — the hold is an availability claim released exactly when the goods leave. Under `issue_immediate` NO reservation ever exists (3-a only reserves under `reserve`).
10. The port validates the card→invoice mapping defensively (length + per-line itemId) and refuses linkage on mismatch; CANCELLED (tombstoned) card lines are skipped everywhere (3-a's contract).
