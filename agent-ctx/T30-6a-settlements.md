# T30 / Task 6-a — Rep settlements (STL- documents): PHASE-017 T10

**Agent:** 6-a (rep settlements) · **Task ID:** 6-a · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — `pnpm --filter @erp/api typecheck` exit 0 · `pnpm --filter @erp/api lint` (eslint .) exit 0 ·
spec **4/4 green** (isolated TMPDIR run) · 5-a regression `core.spec.ts` **6/6 green** (separate isolated run) ·
both distribution specs together **10/10 green** · route probe: all **23** mounted paths
(16 from 5-a + the 7 new settlement routes) match `ROUTE_PERMISSIONS` verbatim — paths, methods,
permission keys, and `@RequireFeature("distribution.settlements")`; the risky
`distribution.settlements.approve` key sits ONLY on `POST settlements/:id/approve`.

## Files

| File | Kind | Notes |
|---|---|---|
| `apps/api/src/modules/distribution/infrastructure/distribution.store.ts` | edit (add-only) | Settlement rows/CRUD + lines + the expected-cash read models + the pending-documents probe |
| `apps/api/src/modules/distribution/domain/distribution-errors.ts` | edit (add-only) | The 7 settlement errors (codes below) |
| `apps/api/src/modules/distribution/application/settlement-service.ts` | new | `SettlementService` — open / count / approve / post / cancel / find / findWithLines / list |
| `apps/api/src/modules/distribution/presentation/distribution.controller.ts` | edit (add-only) | The 7 settlement routes; `SettlementService` injected; docblock updated (6-b's tiers/free-goods still deferred) |
| `apps/api/src/modules/distribution/distribution.module.ts` | edit | +`AccountingModule` import (PostingService/NumberingService), +`SettlementService` provider/export |
| `apps/api/src/infra/http/error.filter.ts` | edit (add-only) | `SETTLEMENT_NOT_FOUND` → 404; `SETTLEMENT_STATE` + `SETTLEMENT_DAY_LOCKED` → 409 (policy-class 422s fall to the default) |
| `apps/api/src/__db__/distribution/settlements.spec.ts` | new | 4 db-backed packs on `setupSalesFixture()` tenant S |

Untouched (as instructed): sales module files, inventory, migrations, `src/db/schema.ts`,
`route-permissions.ts`, `app.module.ts` (DistributionModule was already registered by 5-a).

## Error surface (add-only)

`SETTLEMENT_NOT_FOUND` (404) · `SETTLEMENT_STATE` (409 — bad transitions, open-input validation,
deposit-shape problems, POSTED re-post) · `SETTLEMENT_VARIANCE_REASON_REQUIRED` (422) ·
`SETTLEMENT_APPROVAL_REQUIRED` (422 — beyond tolerance OR an active single-approver
`approval_policies` row on doc_type `rep_settlement`) · `SETTLEMENT_PENDING_DOCUMENTS` (422, details
carry the counts) · `SETTLEMENT_SELF_APPROVAL` (422 — BR-034 creator ≠ approver) ·
`SETTLEMENT_DAY_LOCKED` (409 — uq_rep_settlements_rep_day / POSTED immutability).

## Store surface (additions)

- **Settlements:** `insertSettlement`, `findSettlementById`, `listSettlements({status?, repId?, date?, limit})`,
  `findLiveSettlementForRepDay(repId, date)` (the day-lock probe), `patchSettlement(id, patch)` —
  dynamic `sql.join` SET with undefined=keep / null=clear semantics AND status-derived stamps
  (approved_at/by, posted_at/by, cancelled_at) exactly when the status flips (the
  `updateExpenseStatus` pattern).
- **Lines:** `listSettlementLines`, `upsertSettlementLine` (ON CONFLICT (tenant, settlement, line_no)
  DO UPDATE), `supersedeSettlementLinesAfter` (zeroed stale tail), `replaceSettlementLines` — see
  deviation #3 (no DELETE grant).
- **Read models (§6 read precedent, own SQL):**
  - `repDayCashSales(repId, date)` → `{invoiceId, invoiceNo, amount}[]` — POSTED CASH invoices by
    `sales_rep_id` + `invoice_date`; cash portion mirrors the invoice posting's own rule **exactly**
    (POS `tenders` jsonb non-empty → Σ method='CASH' amounts via `jsonb_array_elements`; else
    `total_gross`).
  - `repDayCollections(cashAccountId, date)` → `{receiptId, receiptNo, amount}[]` — POSTED receipts
    `WHERE cash_account_id = X AND value_date = date` (**account-attributed** — see deviations #4).
  - `repDayCashRefunds(repId, date)` → `{creditNoteId, noteNo, amount}[]` — POSTED credit notes by
    `sales_rep_id` + `note_date` JOIN sales_invoices `si.kind = 'CASH'` (amount = `total_gross`).
  - `repDayExpenses(cashAccountId, date)` → `{expenseId, expenseNo, amount}[]` — POSTED expenses
    from the rep cash account (posted = the money actually left the drawer; APPROVED-but-unposted
    hasn't).
  - `repPendingDocuments(repId, cashAccountId, date)` → `{salesInvoices, creditNotes, receipts}` —
    DRAFT/PENDING_APPROVAL counts: invoices + credit notes rep-attributed, receipts
    account-attributed.

## Service semantics

`SettlementService(@Inject(AuditService) audit, posting: PostingService, numbering: NumberingService)` —
the `ShiftService`/`TreasuryModule` DI shape; `DistributionModule` imports `AccountingModule` for the
two tokens (InventoryModule doesn't re-export them — the PosModule precedent).

- **`open({salesRepId, cashAccountId, vanWarehouseId?, settlementDate, openingCash, note?, noteAr?, actorId})`**
  — rep ACTIVE; cash account exists/ACTIVE/type CASH (a van, when given, must be VAN-type — reuses
  `VanNotFoundError`); optional open-shift linkage via `treasuryStore.findOpenShiftForAccount`
  (recorded `shift_id`, float kept independent per the task); one live settlement per (rep, date) —
  pre-check + 23505→`SettlementDayLockedError`; status DRAFT; **the rep cash account is persisted as
  the OPENING_CASH component line's source reference** (see deviation #5). Audits
  `distribution.settlement_opened`. Number reserved at POST (INV-021 posting-time — the task's
  explicit choice).
- **`count(id, {countedCash, varianceReason?, actorId})`** — DRAFT/COUNTED only (recount replaces
  lines; APPROVED is frozen — a different count would stale the approval; POSTED → day-locked).
  Pending-documents gate FIRST (`SettlementPendingDocumentsError` with the counts). Recomputes
  expected = opening + Σcash sales + Σcollections − Σrefunds − Σexpenses (exact BigInt decimal
  strings via accounting's `decimal-strings`); variance = counted − expected; direction
  SHORTAGE/SURPLUS/NONE; tolerance = setting `distribution.settlement_variance_tolerance`
  (readEffectiveSetting, default "0.0000" — the shiftSettings pattern, no registry edit); ANY
  non-zero variance requires a reason (matches `ck_rep_settlements_variance_reason`); beyond
  tolerance additionally means approval-required before post (derived `approvalRequired` flag on the
  row). Persists component lines SIGNED so **Σ lines = expected_cash** (CASH_REFUND/REP_EXPENSE
  negative), then the COUNTED patch. Audits `distribution.settlement_counted`.
- **`approve(id, {approverId})`** — COUNTED only; creator ≠ approver (`SettlementSelfApprovalError`);
  stamps approved_by/at. Audits `distribution.settlement_approved` (the risky key's trail).
- **`post(id, {depositAccountId?, depositAmount?, actorId})`** — POSTED re-post → typed
  `SettlementStateError` (documented choice over no-op); DRAFT/CANCELLED → state error; COUNTED
  posts only when within tolerance AND no forcing approval policy (`SettlementApprovalRequiredError`),
  APPROVED always proceeds. In the ambient UoW: (1) variance journal when variance ≠ 0 — shortage
  DR `CASH_DIFFERENCE` · CR rep cash GL / surplus DR rep cash · CR `CASH_DIFFERENCE`, source
  `{docType:"rep_settlement", docId, operation:"variance"}`, entryDate = settlement_date, currency =
  rep cash account currency (rate 1 when base, else `findRateForDate` fail-closed) + the variance
  `cash_movements` row (sourceType `rep_settlement`, sourceId = settlement id — the shift-service
  pattern); (2) deposit leg when given (amount required/positive/≤ counted; account ACTIVE + same
  currency): DR bank GL · CR rep cash GL, source operation `"deposit"`, + OUT movement on rep cash
  AND IN movement on the deposit account (see deviation #2); (3) `STL-{YYYY}-{SEQ:5}`
  reserve+bind (INV-021); (4) VARIANCE/BANK_DEPOSIT component lines appended (Σ ALL lines =
  counted − deposit); (5) POSTED patch incl. `variance_journal_id` (see deviation #1). Audits
  `distribution.settlement_posted`.
- **`cancel(id, {reason, actorId})`** — DRAFT/COUNTED/APPROVED only; POSTED → day-locked. Audits
  `distribution.settlement_cancelled`.
- **`find` / `findWithLines` / `list`** — decorated with the derived `approvalRequired` flag.

## API surface (all requireIdentity + envelope + zod; POSTs HttpCode 201 except the action routes)

```
GET    /api/v1/distribution/settlements              ?status&repId&date&limit   manage + feature
POST   /api/v1/distribution/settlements              {salesRepId, cashAccountId, vanWarehouseId?, settlementDate, openingCash, note?, noteAr?}
GET    /api/v1/distribution/settlements/:id          (findWithLines)
POST   /api/v1/distribution/settlements/:id/count    {countedCash, varianceReason?}
POST   /api/v1/distribution/settlements/:id/approve  (permission distribution.settlements.approve — RISKY; approver = the acting identity)
POST   /api/v1/distribution/settlements/:id/post     {depositAccountId?, depositAmount?}
POST   /api/v1/distribution/settlements/:id/cancel   {reason}
```

All 7 EXACTLY as registered in `route-permissions.ts` (probe evidence above).

## Test output

Isolated: `mkdir -p $HOME/tmp-6a && cd apps/api && TMPDIR=$HOME/tmp-6a npx vitest run --config
vitest.db.config.ts src/__db__/distribution/settlements.spec.ts`

```
 ✓ src/__db__/distribution/settlements.spec.ts (4 tests) 832ms
 Test Files  1 passed (1)   Tests  4 passed (4)
```

5-a regression (separate fresh-DB run): `core.spec.ts (6 tests)` ✓ 6/6. Both together: 10/10.

### Fixture (tenant S on the real services)

`setupSalesFixture()` + rep `STL-REP-01` (SalesRepService) + rep cash treasury account
(`AccountService.open` type CASH on novel GL 1113 under 1110) + deposit bank (type BANK on GL 1122
under 1120) + `CASH_DIFFERENCE → 5900` purpose mapping (mirrors the treasury fixture) + expense
category `STL-REP-EXP` (5220, approval_mode none) + settings
`treasury.expense_receipt_threshold = 10000.0000` and
`sales.credit_note_standalone_allowed = true` (a cash-return credit note references a CASH invoice
whose AR outstanding is 0 by design — the INV-016 standalone-credit policy is the sanctioned path
for exactly that shape).

### Exact journal/line fixtures asserted

1. **Expected-cash math (DAY 2026-03-05)** — seeded day: 3 cash sales (100/200/50, NS-tax service
   lines against the rep cash account), 2 credit sales (300/400 — must NOT count), 1 cash refund
   (credit note on cash sale #1 → 100), 2 collections (receipts 80/120 into rep cash), 1 posted
   expense (30). `open(openingCash 100)` → `count(countedCash 520)`:
   `cashSales 350.0000 · collections 200.0000 · cashRefunds 100.0000 · repExpenses 30.0000 ·
   expectedCash 520.0000 · variance 0.0000 · NONE · approvalRequired false`; lines EXACTLY
   `[OPENING_CASH 100.0000, CASH_SALE 100.0000, CASH_SALE 200.0000, CASH_SALE 50.0000,
   COLLECTION 80.0000, COLLECTION 120.0000, CASH_REFUND -100.0000, REP_EXPENSE -30.0000]`
   (Σ = 520.0000, every sourceId non-null). `post` (no deposit) → POSTED,
   `settlementNo ~ /^STL-\d{4}-\d{5}$/`, **NO variance journal** (`findEntryBySourceKey("rep_settlement",
   id, "variance")` undefined; `varianceJournalId` = the NO_JOURNAL sentinel — deviation #1),
   `depositJournalId` null. INV-019: Σ movements(rep cash) == GL base balance == 520.0000.
2. **Shortage always posts + deposit + day lock (DAY 2026-03-06)** — 1 cash sale 200 + 1 collection
   100, opening 50 → expected 350; counted 345 → shortage 5 beyond tolerance 0:
   count without reason → `SETTLEMENT_VARIANCE_REASON_REQUIRED`; with reason → COUNTED
   (`variance -5.0000`, SHORTAGE, `approvalRequired true`); approve by creator →
   `SETTLEMENT_SELF_APPROVAL`; approve by S_ACTOR → APPROVED; (side probe on a second day:
   COUNTED beyond-tolerance post → `SETTLEMENT_APPROVAL_REQUIRED`);
   `post(depositAccountId=bank, depositAmount 345)` →
   - variance journal lines EXACTLY `[[cashDifferenceGl, DEBIT, 5.0000], [repCashGl, CREDIT, 5.0000]]`
     (source rep_settlement/variance), `posted.varianceJournalId` = that entry;
   - deposit journal lines EXACTLY `[[bankGl, DEBIT, 345.0000], [repCashGl, CREDIT, 345.0000]]`
     (source rep_settlement/deposit), `depositJournalId`/`depositAmount` recorded;
   - movements: variance OUT 5.0000 (sourceId = settlement id) + deposit OUT 345.0000 (sourceId =
     deposit journal id — deviation #2) on rep cash; bank has exactly ONE movement IN 345.0000;
   - INV-019: Σ movements(rep cash) == GL balance; lines EXACTLY
     `[OPENING_CASH 50, CASH_SALE 200, COLLECTION 100, VARIANCE -5, BANK_DEPOSIT -345]`,
     Σ = 0.0000 = counted − deposit;
   - audit rows `distribution.settlement_approved` + `distribution.settlement_posted` exist;
   - second `open` same (rep, date) → `SETTLEMENT_DAY_LOCKED`; count/cancel on POSTED →
     `SETTLEMENT_DAY_LOCKED`; re-post → `SETTLEMENT_STATE`.
3. **Pending-documents gate (DAY 2026-03-07)** — a DRAFT cash invoice attributed to the rep →
   count → `SETTLEMENT_PENDING_DOCUMENTS` with `details {salesInvoices: 1, creditNotes: 0,
   receipts: 0}`; settlement stays DRAFT/uncounted.
4. **Surplus + within-tolerance skip-approve (DAY 2026-03-09, tolerance set to 10.0000)** —
   opening 20 + 1 cash sale 100 → expected 120; counted 125 → SURPLUS 5 within tolerance
   (`approvalRequired false`) → posts straight from COUNTED; variance journal lines EXACTLY
   `[[repCashGl, DEBIT, 5.0000], [cashDifferenceGl, CREDIT, 5.0000]]`; variance movement IN
   5.0000; Σ lines = 125.0000 = counted; INV-019 tie.

## Deviations / decisions (read before building on this)

1. **Zero-variance POSTED rows carry a sentinel `variance_journal_id`.**
   `ck_rep_settlements_posted_shape` demands `variance_journal_id IS NOT NULL` when POSTED, but a
   zero variance has nothing to post (the engine requires every line amount > 0 — a balanced
   zero journal is impossible). The service writes the exported constant
   `NO_VARIANCE_JOURNAL_ID = "00000000-0000-0000-0000-000000000000"` (the posting service's own
   zero-uuid precedent — the column has NO FK) when posting a perfect count. The LEDGER stays
   honest: no `rep_settlement/variance` journal exists, no CASH_DIFFERENCE entry, no movement.
   A future migration may relax the CHECK; until then the sentinel is the documented
   "no variance journal exists" marker (reports can detect it exactly).
2. **Deposit money-leg movements carry `source_id = the DEPOSIT JOURNAL entry id`** (still
   `source_type = 'rep_settlement'`). `uq_cash_movements_source_side` (0012: "a source document
   never yields two movements on the same account side") makes the task's literal plan impossible —
   a shortage variance (OUT on rep cash) + a deposit (OUT on rep cash) would collide on
   (rep_settlement, settlementId, repCash, OUT). The variance movement keeps the mandated
   settlement-id source (shift-service pattern); the deposit legs differentiate via the deposit
   journal id (traceable through `deposit_journal_id`). INV-019 holds leg-for-leg (asserted).
3. **`replaceSettlementLines` is an upsert-by-(settlement, line_no) + zeroed stale tail, NOT
   DELETE+INSERT** — migration 0025 grants erp_app NO DELETE on `rep_settlement_lines`
   ("status-lifecycled — no tombstone deletes"; only route_customers/van_stocks carry DELETE).
   Recount-shrink leftovers stay as visible `amount = 0, description 'superseded by recount'`
   tombstones that never pollute Σ. The task's DELETE+INSERT wording was written before the grant
   reality was checked.
4. **Rep-attribution model (the honest model, per the task's own analysis):** collections and
   expenses are attributed by the rep CASH ACCOUNT (receipts/expenses carry no rep column); cash
   sales and cash refunds by `sales_rep_id` (invoices/credit notes carry it). Store signatures
   follow the attribution: `repDayCollections(cashAccountId, date)` / `repDayExpenses(cashAccountId,
   date)` — the task's `repDayCollections(repId, date)` naming was rep-shaped but its described
   semantics are account-shaped; the signature deviation is deliberate. The refund model subtracts
   the credit note gross from expected cash even though the credit note itself posts AR-side only
   (CR AR_CONTROL) — the physical drawer refund is captured by the count; the AR cleanup is a
   separate document (INV-019 holds because neither the credit note nor the refund writes a rep-cash
   leg).
5. **The rep cash account is persisted as the OPENING_CASH component line's source reference**
   (`source_type='cash_account', source_id=<treasury cash account id>`), written at `open` and
   preserved through recounts. `rep_settlements` has NO `cash_account_id` column and no
   rep→account mapping exists anywhere (sales_reps carries none; the van binding is rep→warehouse),
   yet `count`/`post` must resolve the account without it being re-supplied — the line is the
   durable, schema-honest pointer; `resolveRepCashAccount` reads it (re-validates ACTIVE CASH).
6. **`open`-time input problems (unknown/inactive rep, unknown/closed/non-CASH account, negative
   float) throw `SettlementStateError`** rather than new error classes — the task's seven-name
   surface has no generic invalid-input error and the file is add-only-stable; the filter maps it
   to 409 like every lifecycle conflict.
7. **POSTED re-post is a typed `SETTLEMENT_STATE` rejection, not a no-op** (the task offered the
   choice; documented here) — count/cancel on POSTED use the more specific `SETTLEMENT_DAY_LOCKED`.
8. **The tolerance setting is read via `readEffectiveSetting` with a "0.0000" fallback** (the
   shiftSettings/document-support pattern). No registry edit was made —
   `distribution.settlement_variance_tolerance` is not in SETTINGS_REGISTRY; stored tenant rows
   still win (the spec proves it by raising tolerance to 10.0000 in pack 4).
9. **Reason required for ANY non-zero variance, not only beyond tolerance** — the DB CHECK
   (`ck_rep_settlements_variance_reason`: direction SHORTAGE/SURPLUS ⇒ reason NOT NULL) plus the
   shift-service precedent ("within tolerance but non-zero with tolerance 0: a reason documents
   it"). Beyond tolerance ADDITIONALLY gates posting on the approval hop.
10. **`cash_movements` writes go through `treasuryStore.insertCashMovement`** (treasury's own
    writer) with the 0025-widened `rep_settlement` source — the closest possible honoring of
    "cash_movements is written only by treasury services" while executing the migration's explicit
    widening; documented like 5-a's `insertVanWarehouse` VAN-slice exception.
11. **Count allows DRAFT→COUNTED and COUNTED→COUNTED (recount)** — replaces lines each time;
    APPROVED is frozen (stale-approval protection), POSTED day-locked.

## What Task 6-b / later tasks add (hand-off)

- 6-b: `tiers` + `free-goods-rules` controllers/providers on the same prefix — the controller
  docblock marks them as still deferred; `SettlementService` is exported from `DistributionModule`
  for reports/UI.
- T13 reports can consume `listSettlements` + `findWithLines` (Σ lines = expected; after post
  Σ lines = counted − deposit), `repPendingDocuments`, the movement tie
  (`treasuryStore.movementBalance(repCash) === glBaseBalanceAsOf(repCash.accountId)` — asserted in
  every monetary pack), and the sentinel detection (`varianceJournalId === NO_VARIANCE_JOURNAL_ID`).
- A future van-balance→settlement reconciliation (G7) can join `vanWarehouseId` (stored on the
  settlement) with `vanStockTotals`.
