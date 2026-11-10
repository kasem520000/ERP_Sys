# T25 / Task 3-a — Job-card domain + API (PHASE-017 T3)

**Agent:** 3-a (job-card domain + API) · **Task ID:** 3-a · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — typecheck green, ESLint green (exit 0), spec 5/5 green (isolated TMPDIR run).

## Files

| File | Kind | Notes |
|---|---|---|
| `apps/api/src/modules/sales/job-cards/domain/job-card-errors.ts` | new | Typed DomainError set (see codes below) |
| `apps/api/src/modules/sales/infrastructure/job-cards.store.ts` | new | Function-module store (sales-owned `job_cards`/`job_card_lines` ONLY writer) |
| `apps/api/src/modules/sales/job-cards/application/job-card-service.ts` | new | `JobCardService` + `JobCardPostingPort` + `setPostingPort(port \| null)` |
| `apps/api/src/modules/sales/presentation/job-cards.controller.ts` | new | `@Controller("api/v1/sales/job-cards")`, all 10 routes |
| `apps/api/src/modules/sales/sales.module.ts` | edit (add-only) | `JobCardsController` → controllers; `JobCardService` → providers + exports |
| `apps/api/src/__db__/sales/job-cards.spec.ts` | new | 5 db-backed tests on `setupSalesFixture()` tenant S |

Untouched (as instructed): `route-permissions.ts`, migration `0025`, `src/db/schema.ts`, other modules' tables. Route-permissions entries for all 10 paths pre-existed and are matched VERBATIM (verified by a temporary AppModule boot probe — every path mounted, none 404; probe deleted after the run).

## Store surface (`job-cards.store.ts`)

- `insertJobCard` (card + inline lines, `erp.current_tenant_id()`), `findJobCardById`, `listJobCards({status?, customerId?, vehicleId?, limit})` (ORDER BY created_at DESC), `patchJobCard` (status transitions + fields; CASE-stamps approved_at/completed_at/invoiced_at/cancelled_at on the transition; COALESCE semantics — absent/null = untouched)
- `insertJobCardLine` (single; optional preserved `id`), `listJobCardLines(cardId)`, `patchJobCardLine` (status / reservationId / issue cost+value+journal / invoiceLineId / loggedHours / full field set), `findJobCardLineById`, `replaceJobCardLines(cardId, lines)` (DRAFT full-replace, see deviation #1)
- Types `JobCardRow` / `JobCardLineRow` match drizzle `jobCards`/`jobCardLines` 1:1 (decimals + timestamps as `::text`).

## Service semantics (`JobCardService`)

Constructor: `@Inject(AuditService) audit`, `Numbering numbering` — exactly as specified. State machine DRAFT → IN_PROGRESS (approve) → COMPLETED (complete) → INVOICED (invoice); CANCELLED from DRAFT/IN_PROGRESS only. No ledger before INVOICED anywhere (spec asserts journal-count invariance across the whole chain).

- `create`: PARTS→STOCK-kind item, LABOR→SERVICE-kind + `estimatedHours > 0` (billed quantity); qty > 0; unitPrice ≥ 0; discount ≤ 4dp ≥ 0. JC number at creation via `numbering.reserve({docType:"job_card", branchId:null, periodKey:year, format:"JC-{YYYY}-{SEQ:5}", prefix:"JC", year})` + `bind`. Audit `sales.job_card.created`.
- `update` (PUT): field patch DRAFT/IN_PROGRESS; optional `lines` full-replace DRAFT-only, provided ids validated to belong to the card.
- `generateQuotation`: DRAFT/IN_PROGRESS; PARTS → qty × unitPrice, LABOR → qty = estimatedHours at per-hour rate, through the REAL `QuotationService.create` (base currency via `ownTenantBaseCurrency`, validity default BR-006); stores `quotation_id`. Audit `sales.job_card.quotation_generated`.
- `approve`: `reserve` → one JOB_CARD-held reservation per PARTS line (`holderType: "JOB_CARD" as "MANUAL"|"SALES_ORDER"` — single documented `// JOB_CARD_HOLDER` boundary cast; DB CHECK widened in 0025), line → RESERVED; `issue_immediate` → port `issuePartsImmediate` (typed not-configured error if absent). Audit `sales.job_card.approved`.
- `logHours`: LABOR-only line, card IN_PROGRESS/COMPLETED; accumulates `logged_hours`; recomputes `card.labor_hours_total` from persisted LIVE lines. Audit `sales.job_card.hours_logged`.
- `complete`: IN_PROGRESS → COMPLETED + completed_at. Audit `sales.job_card.completed`.
- `invoice`: COMPLETED-only; delegates to port `invoiceCard`, stamps card (INVOICED, invoiced_at, invoice_id) + line statuses INVOICED (port links `invoice_line_id` — see port contract). Audit `sales.job_card.invoiced`.
- `cancel`: never-cancelable first (invoice linked OR any line ISSUED/issue-journal/issue-cost → `JOB_CARD_NOT_CANCELABLE`, "corrections are credit notes"); then DRAFT/IN_PROGRESS-only state gate; IN_PROGRESS releases ACTIVE JOB_CARD reservations; all lines → CANCELLED; reason recorded on `note` (required by `ck_job_cards_cancel_requires_reason`). Audit `sales.job_card.cancelled`.
- Audit entityType `"job_card"` throughout; bilingual `*_ar` fields honored.

## API surface (all `@RequirePermissions("sales.job_cards.manage")` + `@RequireFeature("sales.job_cards")`, requireIdentity + envelope, zod: UUID, QTY/PRICE/HOURS ≤ 6dp, MONEY ≤ 4dp, DATETIME via `z.string().datetime()`)

```
GET    /api/v1/sales/job-cards                      ?status&customerId&vehicleId&limit(≤500)
POST   /api/v1/sales/job-cards                       {branchId,customerId,vehicleId?,warehouseId,partsIssueMode=reserve|issue_immediate(default reserve),complaints?,complaintsAr?,odometerKm?,checkedInAt?,note?,noteAr?,lines:[{lineType:PARTS|LABOR,itemId,qty,unitPrice?,estimatedHours?,discountAmount?,taxCodeId?,description?,descriptionAr?,note?}]}
GET    /api/v1/sales/job-cards/:id                   (card + lines)
PUT    /api/v1/sales/job-cards/:id                   {complaints?,complaintsAr?,diagnosis?,diagnosisAr?,note?,noteAr?,odometerKm?,lines?: full-replace (DRAFT only; line.id preserved)}
POST   /api/v1/sales/job-cards/:id/quotation
POST   /api/v1/sales/job-cards/:id/approve
POST   /api/v1/sales/job-cards/:id/complete
POST   /api/v1/sales/job-cards/:id/invoice
POST   /api/v1/sales/job-cards/:id/cancel            {reason}
POST   /api/v1/sales/job-cards/:id/lines/:lineId/log-hours   {hours}
```

## JobCardPostingPort — the 4-a contract

```ts
export interface JobCardPostingPort {
  issuePartsImmediate(cardId: string, actorId: string | null): Promise<void>;
  invoiceCard(cardId: string, actorId: string | null): Promise<{
    invoiceId: string;
    invoiceNo: string | null;
    journalEntryId: string;
    cogsJournalEntryId: string | null;
  }>;
}
// registration: jobCardService.setPostingPort(port)   // null clears (tests)
```

- `issuePartsImmediate` runs INSIDE `approve` (same tx) under `issue_immediate`: post the COGS journal (DR COGS · CR inventory at issue cost) + stock move referencing the job card, and stamp per-line `issue_unit_cost` / `issue_value` / `issue_journal_id` + line status ISSUED (store: `patchJobCardLine`).
- `invoiceCard` runs INSIDE `invoice` (same tx) from a COMPLETED card: create the sales invoice (parts + labor revenue natures, VAT per treatment), post the revenue journal (+ COGS journal under `reserve`; none under `issue_immediate`), and MUST link `invoice_line_id` on each LIVE (non-CANCELLED) card line — the port owns the card-line ↔ invoice-line mapping; the service then stamps the card (INVOICED, invoiced_at, invoice_id) and flips live line statuses to INVOICED. Skip CANCELLED (tombstoned) lines.
- Absent port → typed `JobCardPostingNotConfiguredError` code `sales/job-card-posting-not-configured` (default DomainError status 422).
- Card fields the port may rely on: `partsIssueMode`, `warehouseId`, `branchId`, `customerId`, `cardNo`, line `qty`/`unitPrice`(per-hour for LABOR)/`estimatedHours`/`loggedHours`/`discountAmount`/`taxCodeId`.

## Test output (isolated: `TMPDIR=$HOME/tmp-3a npx vitest run --config vitest.db.config.ts src/__db__/sales/job-cards.spec.ts`)

```
 ✓ src/__db__/sales/job-cards.spec.ts (5 tests) 477ms
 Test Files  1 passed (1)   Tests 5 passed (5)
```

1. Happy path: create (PARTS 2×100 + LABOR 1.5h×80) → `JC-\d{4}-\d{5}` → diagnosis update → quotation (totalNet 320.0000, LABOR qty=1.5 at 80/h, card.quotationId linked) → approve reserve (reservation JOB_CARD-held/ACTIVE, lines RESERVED, journal count unchanged) → logHours 1 + 0.5 (laborHoursTotal 1.500000) → complete → invoice rejects `sales/job-card-posting-not-configured` → cancel rejects `JOB_CARD_STATE` (COMPLETED); journal count unchanged across the WHOLE chain.
2. Cancel: DRAFT clean (status CANCELLED, note=reason, lines CANCELLED); IN_PROGRESS reserve-mode releases holds (reservation RELEASED); stub-port INVOICED card (real service transition, lines INVOICED) then cancel rejects `JOB_CARD_NOT_CANCELABLE`.
3. Validations: PARTS-on-SERVICE, LABOR-on-STOCK, LABOR-without-hours all `JOB_CARD_LINE_INVALID`; logHours on PARTS line `JOB_CARD_LINE_INVALID`; logHours on DRAFT `JOB_CARD_STATE`.
4. Distinct JC- numbers for two cards.
5. PUT semantics: full-replace preserves the provided line id (patched in place at position 1), new line at position 2, unmentioned line tombstoned CANCELLED; replace on non-DRAFT rejects `JOB_CARD_STATE`.

Fixture note: the spec creates the SERVICE item `S-LABOR` via `items.store.insertItem` inside `withTenant(TENANT_S)` (base 80/h); everything else reuses `setupSalesFixture()`.

## Deviations / decisions (read before building on this)

1. **Full-replace is tombstone-based, not DELETE.** Migration 0025 grants erp_app only SELECT/INSERT/UPDATE on `job_card_lines` ("status-lifecycled — no tombstone deletes"); a DELETE-based replace failed live with `permission denied`. `replaceJobCardLines` therefore: (a) parks all existing rows at `-line_no` (unique-index-safe renumbering), (b) patches provided-id rows in place at their input position, (c) inserts id-less rows, (d) tombstones unmentioned rows `status=CANCELLED` (they keep negative line_no). All service consumers skip CANCELLED lines (approve reservations, quotation generation, hours totals, invoice status flips, logHours rejects them). 4-a MUST skip CANCELLED lines too (documented in the port contract).
2. **QuotationService is instantiated inside JobCardService** (`new QuotationService(audit, numbering)`, lazily once) — same pattern orders.ts uses for `new ReservationService(audit)`; keeps the constructor exactly `audit + numbering` as specified. ReservationService is likewise instantiated per-call via dynamic import in `approve`/`cancel` (orders.ts pattern), with the single `// JOB_CARD_HOLDER` cast for the pre-0025 TS union.
3. **invoice_line_id linkage is the port's job** (4-a) — the fixed port return shape carries no line mapping, so the service stamps card-level state + line statuses and the port stamps per-line `invoice_line_id` (JSDoc on the interface; repeated above).
4. **Cancel reason lives on `note`** — the migration CHECK demands non-NULL note + cancelled_at on CANCELLED rows and no dedicated reason column exists; the audit `after` payload carries the reason too.
5. Controller handlers `await` before `envelope(...)` (pos.controller style) — the sales.controller pattern of wrapping the raw promise is avoided deliberately.
6. LABOR lines' `qty` column stores the caller's qty (typically 1, line-count semantics); billing always rides `estimated_hours` — documented in `JobCardLineInput`.
7. `JobCardNotFoundError` maps like the sibling sales not-founds (A7 uniform shape; DomainError default status).
