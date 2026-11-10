# T48 / Task 7 — Service orders: the job-card generalization (PHASE-019)

**Agent:** T48 (service orders) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — all gates green (tails below). Evidence written early per
§18 lesson 7 and finalized after the gate pass.

## Scope (MASTER-PLAN §7 + §11 rows 37–45 + §15 service-order chain + §16 T48)

The job-card lifecycle generalized to the crm module as `service_orders`:
SO-{YYYY}-{SEQ:5} reserved at creation (docType `service_order`), lines
SERVICE (SERVICE-kind items, estimatedHours > 0) / PARTS (STOCK items, qty >
0), approve under `issue_immediate` (the `service_order:issue_parts` COGS
journal — DR COGS · CR INVENTORY) or `reserve` (SERVICE_ORDER-held
availability holds), logHours (SERVICE lines), complete, invoice through the
ordinary sales chain (SalesInvoiceService.create + POLICY_ACTOR auto-approve
+ post in-transaction — the invoiceCard pattern), cancel (releases ACTIVE
holds, refuses when invoiced/issued). Contract linkage does NOT alter any
journal — pinned line-for-line by the spec.

## Files

| File | Content |
|---|---|
| `apps/api/src/modules/crm/domain/crm-errors.ts` | + 5 typed errors (the job-card family mapped): SERVICE_ORDER_NOT_FOUND, SERVICE_ORDER_STATE (the NOT_CANCELABLE guard folded in — the T46 ADVANCE_STATE precedent), SERVICE_ORDER_INPUT_INVALID, SERVICE_ORDER_LINE_ERROR, SERVICE_ORDER_POSTING_NOT_CONFIGURED. |
| `apps/api/src/modules/crm/infrastructure/crm.store.ts` | + the service-order store slice (banner append): ServiceOrderRow/ServiceOrderLineRow + insertServiceOrder/findServiceOrderById/listServiceOrders (status/contractId)/patchServiceOrder (COALESCE + the 4 state-stamp CASEs + the dedicated cancel_reason column) + insertServiceOrderLine/listServiceOrderLines/findServiceOrderLineById/patchServiceOrderLine + replaceServiceOrderLines (DRAFT full-replace: negation-park renumbering, preserved ids, tombstones VOID — the replaceJobCardLines shape). T46's ItemProbeRow gained `status` (additive — the job-card ACTIVE gate). |
| `apps/api/src/modules/crm/application/service-order-service.ts` | The lifecycle: create (partner/contract/item validation; SO- number reserve+bind at creation) / update (DRAFT-only full document) / approve (the approve-time parts policy) / logHours / complete / invoice (through the port) / cancel (releases ACTIVE holds; refuses invoiced/issued) + the `ServiceOrderPostingPort` seam (`setPostingPort`). Audits crm.service_order.{created,updated,approved,hours_logged,completed,invoiced,cancelled}. |
| `apps/api/src/modules/crm/application/service-order-posting.ts` | The port implementation (the job-card-posting shape): issuePartsImmediate (planIssue + stagePendingOverlay + ONE COGS journal `service_order:issue_parts` + applyIssue + per-line snapshots; all-ISSUED re-run = no-op) + invoiceCard (SalesInvoiceService.create with the derived with-goods posture, POLICY_ACTOR auto-approve + post in-transaction, positional line links verified by itemId, markInvoiceLineIssued W-3 copy, hold consumption under reserve). |
| `apps/api/src/modules/crm/presentation/service-orders.controller.ts` | §11 rows 37–45 verbatim under @Controller("api/v1/crm") (list ?status&contractId&limit / POST / GET :id / PUT :id / approve / log-hours {lineId,hours} / complete / invoice / cancel); all `crm.service_orders.manage` + feature `crm.service_orders`; the port wired in the controller ctor (the JobCardsController precedent). |
| `apps/api/src/modules/crm/crm.module.ts` | + ServiceOrderService/ServiceOrderPosting providers, ServiceOrdersController, InventoryModule import (ReservationService). |
| `apps/api/src/modules/crm/application/related-target.ts` | + the SERVICE_ORDER probe (T45's documented handoff: "T48 the SERVICE_ORDER probe"); CONTRACT stays the one open gap (T46 shipped without it; tasks.spec pins the random-uuid acceptance). |
| `apps/api/src/infra/http/error.filter.ts` | + the T48 block: 404 (NOT_FOUND), 409 (STATE), 422 (INPUT_INVALID + LINE_ERROR), 503 (POSTING_NOT_CONFIGURED — a wiring fault, not client input). |
| `apps/api/src/modules/sales/application/invoices.ts` | **Deviation 2** (see below) — SalesInvoiceService's bare constructor params got explicit @Inject. |
| `apps/api/migrations/0028_crm_service_order_holder.sql` + `src/infra/db/migrations.ts` + `migrations/meta/_journal.json` + `migrations.spec.ts` | **Deviation 1** (see below) — the holder CHECK widening + its registration (append-only edits to T42-owned files). |
| `apps/api/src/__db__/crm/service-orders.spec.ts` | The DB spec — 15 tests, dedicated tenant `6c6c6c6c-6c6c-6c6c-6c6c-6c6c6c6c6c6c` (SAR; verified unused across the repo before adoption). |
| `agent-ctx/T48-7-service-orders.md` | This file. |

## DEVIATION 1 (read first) — migration 0028, the holder CHECK gap

**The 0027 DDL never widened `stock_reservations.holder_type` with
'SERVICE_ORDER'.** Verified by grep: the widest CHECK is 0025's
`ck_stock_reservations_holder_values IN ('MANUAL','SALES_ORDER','JOB_CARD')`;
0027 widened `stock_moves.source_type` (service_order ✓) and
`sales_invoices.service_order_id` (✓) but NOT the reservations holder CHECK.
The binding task card + MASTER-PLAN §7 both require `reserve` mode to write
holderType **"SERVICE_ORDER"** (job cards' 'JOB_CARD' arrived via 0025's
widening in the same migration that created job_cards; the equivalent for
0027 was simply missed — §18's lessons don't cover it; T48's first run was
lost with the repo).

Resolution (the repo's own precedent — T44's manual_journal_lines.project_id
gap was "folded into 0027 this time"; 0027 is now shipped + applied in every
DB and editing an applied migration desyncs drizzle's journal, so folding is
no longer possible): **migration `0028_crm_service_order_holder.sql`**
re-issues the holder CHECK with 'SERVICE_ORDER' added (the exact 0025 DROP +
ADD pattern), upserting `_schema_state` = 28. Registered in `MIGRATIONS`,
`meta/_journal.json`, and the `migrations.spec.ts` last-tag assertion —
append-only edits to T42-owned files, documented here. Proof it applies: the
reserve-mode spec inserts holderType 'SERVICE_ORDER' through the real chain
on a fresh global-setup DB (embedded postgres + drizzle-kit migrate) and
passes. The TS-side seam still uses the documented boundary cast
`"SERVICE_ORDER" as "MANUAL" | "SALES_ORDER"` (the job-card JOB_CARD cast
precedent — ReservationService's union predates 0028; inventory-owned file,
not widened).

## DEVIATION 2 — SalesInvoiceService's bare constructor params (latent AppModule bug)

HTTP row 44 (POST :id/invoice) was the **first AppModule-constructed drive
of `SalesInvoiceService.create`** in the repo's DB history — and it 500'd:
`resolver.resolveOne` on undefined. Root cause: the vitest/esbuild pipeline
does not emit `design:paramtypes`, so SalesInvoiceService's bare params
(posting/numbering/resolver) resolved undefined in the Nest graph (the
"JobCardService silent-undefined precedent" the ContractService note
documents; no earlier spec ever drove invoice creation over HTTP — T47's
HTTP billing-run POST returned `draftsCreated: []`, everything guarded).
Fix: explicit `@Inject` on all three params (the ContractService
convention) — identical resolution under tsc, correct under esbuild.
3-line additive change to a sales-module file, documented here.

## Design decisions (documented, within-card)

1. **The parts issue policy is an APPROVE-TIME input** (`{partsIssueMode}` on
   POST :id/approve, default `reserve`). 0027's service_orders has NO
   parts_issue_mode column (DDL binding) and the task card lists partsIssueMode
   only under approve. The choice is recorded in the approve audit's
   after-state; the persisted line stamps carry it forward — invoiceCard
   derives the invoice's with-goods posture from them (PARTS lines with an
   issue journal left at approval → revenue-only; on holds or no PARTS lines
   → with-goods/flow-B).
2. **The invoice linkage is inverted** (0027 gave service_orders no
   invoice_id column): the invoice row carries `service_order_id`; the
   order↔invoice-line mapping lives on `service_order_lines.invoice_line_id`
   (positional 1:1, itemId-verified by the port).
3. **SO lines carry no tax/discount columns** (0027): invoice lines resolve
   their tax code from the ITEM row (`findItemTaxCodeForCrm` — the T47
   billing-run precedent) and bill undiscounted.
4. **SERVICE lines store qty = 1** (the line count — the job-card LABOR
   convention; the DDL CHECK needs qty > 0 on every line); billing rides
   estimatedHours × unitPrice (the per-hour rate). PARTS lines store the
   parts quantity.
5. **The never-cancelable guard folds into SERVICE_ORDER_STATE** (no separate
   NOT_CANCELABLE code — the 5-code list is the card's; the T46 ADVANCE_STATE
   precedent; the message carries the credit-note honesty). SERVICE_ORDER_
   POSTING_NOT_CONFIGURED maps 503 (wiring fault, not client input; the
   module wires the port at controller construction so it is the belt).
6. **contractId validation** at create: unknown or non-ACTIVE (a DRAFT
   contract) → SERVICE_ORDER_INPUT_INVALID (422); the invoice path
   re-validates through the raw existence probe (sales.store). Partner
   validation: exists + CUSTOMER|BOTH + ACTIVE (the requireCustomer mirror).
7. **`loggedHours` never feeds billing** (the job-card shape: the invoice
   bills estimatedHours); logged_hours is the work record on the line —
   service_orders has no labor_hours_total column (DDL), so no card-level
   recompute.

## The job-card generalization note (the §7 upgrade path — for the completion report)

Job cards remain valid documents — **no data migration, no fork**. The
service-order module is the byte-close generalization: same lifecycle states
(DRAFT→IN_PROGRESS→COMPLETED→INVOICED/CANCELLED), same line statuses
(PENDING/RESERVED/ISSUED/INVOICED/VOID — tombstone-based, no DELETE grant),
same two parts policies (`reserve` → holds consumed at invoice;
`issue_immediate` → ONE COGS journal at approval, the invoice revenue-only),
same posting-port seam (setPostingPort + controller-ctor wiring), same W-3
issue-snapshot copy onto invoice lines, same INV-013 idempotency (the
all-ISSUED re-run is a no-op; the engine's source key is exactly-once).
Differences (all §7/DDL-bound): the document lives in crm (contract linkage
optional — standalone by default); partnerId instead of customerId;
SERVICE/PARTS line types instead of LABOR/PARTS; `service_order:issue_parts`
instead of `job_card:issue_parts`; holderType SERVICE_ORDER instead of
JOB_CARD; orderNo SO- vs cardNo JC-; VOID instead of CANCELLED tombstones;
the policy is approve-time instead of a column; the invoice linkage is
inverted (sales_invoices.service_order_id). Journals are IDENTICAL in shape —
pinned by the standalone-vs-contract-linked comparison (line-for-line
toEqual). CAPABILITY_MATRIX §2.6 reconciliation note for the docs pass: the
service-order invoice posts through the ordinary sales chain — **no
posting-rule fork**; job cards (PHASE-017) stay as-is.

## Golden fixtures as computed (§15 — all spec-pinned)

Dedicated tenant 6c6c6c6c (SAR, MAIN branch, FY2026). Purposes:
AR_CONTROL→1130, SALES_REVENUE→4100, SERVICE_REVENUE→4200, VAT_PAYABLE→2120,
COGS→5100, INVENTORY→1140 (+ OPENING_EQUITY→3100 for the opening leg).
Partner P-000001 (CUSTOMER, NET-30). Warehouse W-SO with SO-PART (STOCK)
×100 @ 50.000000 WAC; SO-SVC (SERVICE, 150.000000/h); both items carry the
STD 15% tax code (the item row is the tax home — T47 precedent). Parts
price 90.000000 (2×90 = 180 net + VAT 27.0000).

**The §15 chain (1 SERVICE line 3 h @ 150 + 1 PARTS line qty 2 @ 90,
issue_immediate):**
- create → `SO-{YYYY}-{SEQ:5}` (docType service_order, reserve-at-creation).
- approve → **J-COGS [DR COGS 100.0000 · CR INVENTORY 100.0000]** — source
  `service_order:issue_parts`; stock on-hand −2 (delta-asserted, WAC
  unchanged); 1 OUT move sourced `service_order` (2.000000 @ 100.0000);
  PARTS line ISSUED (issueUnitCost 50.000000, issueValue 100.0000) + the
  SERVICE line untouched (PENDING).
- invoice (COMPLETED only) → invoice POSTED, revenue-only (warehouseId NULL,
  exactly ONE COGS journal over the life), totals net 630.0000 / tax 94.5000
  / gross 724.5000 + **J-SO [DR AR 724.5000 · CR SALES_REVENUE 180.0000 ·
  CR SERVICE_REVENUE 450.0000 · CR VAT 67.5000 · CR VAT 27.0000]** (the
  ordinary chain's settlement ordering — AR DR, SALES_REVENUE CR, then
  SERVICE_REVENUE CR, then VAT per line in line order); SO INVOICED; per-line
  invoice_line_id positional 1:1 (itemId-verified); the W-3 copy rides the
  invoice parts line (50.000000/100.0000); second invoice / PUT / cancel →
  typed SERVICE_ORDER_STATE.
- contract-linked variant: the J-COGS and J-SO are IDENTICAL line-for-line
  (toEqual the golden arrays) + invoice.contract_id set + the same stock
  deltas (contract linkage does NOT alter any journal).
- reserve mode: PARTS line RESERVED + a reservation row holderType
  SERVICE_ORDER (holderId = the order, ACTIVE, qty 2.000000, W-SO), zero
  journals, hold ≠ movement; the with-goods invoice at completion (settlement
  identical + the invoice's own COGS journal sales_invoice:cogs
  [DR COGS 100 · CR INVENTORY 100] + 1 OUT move sourced sales_invoice) with
  the holds CONSUMED at invoice; cancel releases the holds (RELEASED), lines
  VOID, cancel_reason on the row, zero ledger.
- guards: unknown/non-ACTIVE contractId → INPUT_INVALID (zero residue);
  SERVICE↔STOCK mismatches / missing hours / missing qty → LINE_ERROR;
  the DRAFT full-replace (preserved ids + renumber + VOID tombstones,
  loggedHours reset); PUT-after-approve → STATE; INSUFFICIENT_STOCK at
  issue_immediate approval → atomic rollback (order stays DRAFT, zero
  journals/moves, stock unchanged); INV-013 (the all-ISSUED re-run no-op).
- HTTP rows 37–45 over the real AppModule: list/create(201)/get/put/
  approve(201, reserve default)/log-hours/complete/invoice(201, with-goods
  over HTTP)/cancel-on-invoiced(409)/unknown-id(404)/malformed-line(422).

## Verification (repo root; DB runs used TMPDIR=$HOME/tmp-t48)

```
$ pnpm --filter @erp/api typecheck   → clean (tsc --noEmit, no output)
$ pnpm --filter @erp/api run lint    → clean (eslint ., no output)
$ TMPDIR=$HOME/tmp-t48 npx vitest run --config vitest.db.config.ts src/__db__/crm/
 ✓ src/__db__/crm/tasks.spec.ts (10 tests)
 ✓ src/__db__/crm/billing.spec.ts (12 tests)
 ✓ src/__db__/crm/service-orders.spec.ts (15 tests)   ← T48 (new)
 ✓ src/__db__/crm/contracts.spec.ts (20 tests)
 ✓ src/__db__/crm/deferral.spec.ts (7 tests)
 ✓ src/__db__/crm/time.spec.ts (7 tests)
 ✓ src/__db__/crm/leads.spec.ts (8 tests)
 Test Files  7 passed (7)
      Tests  79 passed (79)            ← 64 prior + 15 new

$ TMPDIR=$HOME/tmp-t48 npx vitest run --config vitest.db.config.ts \
    src/__db__/sales/job-cards.spec.ts src/__db__/sales/job-card-posting.spec.ts src/__db__/inventory/
 Test Files  11 passed (11)
      Tests  54 passed (54)            ← zero regressions

$ pnpm --filter @erp/api test
 Test Files  25 passed (25)
      Tests  274 passed (274)          ← includes migrations.spec (0028 registration)

$ pnpm run lint:depcruise
 ✔ no dependency violations found (954 modules, 6476 dependencies cruised)

$ pnpm run check:permissions-drift
 [permissions-drift] OK — matrix 243 keys, seed 243 keys

$ TMPDIR=$HOME/tmp-t48 npx vitest run --config vitest.db.config.ts src/__db__/billing/
 ✓ src/__db__/billing/readonly-sweep.db.spec.ts (6 tests)  ← violations → 0 (rows 37–45 now answer 403 read-only)
 ✓ src/__db__/billing/usage-limits.db.spec.ts (8 tests)
 ✓ src/__db__/billing/lifecycle.db.spec.ts (9 tests)
 ✓ src/__db__/billing/webhook-http.db.spec.ts (7 tests)
 Test Files  4 passed (4)
      Tests  30 passed (30)

$ pnpm run docs:validate        → 29/29 checks passed
$ TMPDIR=$HOME/tmp-t48 npx vitest run --config vitest.db.config.ts \
    src/__db__/migrations.db.spec.ts src/__db__/rls-attacks.db.spec.ts src/__db__/isolation/
 ✓ src/__db__/isolation/identity-isolation.db.spec.ts (876 tests)
 ✓ src/__db__/migrations.db.spec.ts (7 tests)   ← 0028 applies cleanly in the real chain
 ✓ src/__db__/isolation/platform-isolation.db.spec.ts (12 tests)
 ✓ src/__db__/rls-attacks.db.spec.ts (9 tests)
 Test Files  4 passed (4)
      Tests  904 passed (904)
```

The readonly-sweep gap is CLOSED: T47's handoff listed the remaining
unmounted set as "T48's service-order rows only" — all nine rows now answer
the typed 403 `tenancy/subscription-read-only` through the real pipeline
(the sweep spec passes fully). `check:rls` (the CI-harness gate) needs a
provisioned MIGRATE_DATABASE_URL; its substance is covered by the
rls-attacks + isolation + migrations runs above (0028 adds no table and no
policy — the catalog is untouched by it).
