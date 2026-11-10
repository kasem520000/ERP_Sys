# Receivables and Payables

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-27

The subledger architecture behind AR (customers) and AP (suppliers), shared by sales,
purchasing, and treasury. Control-account reconciliation is defined in
[RECONCILIATION.md](RECONCILIATION.md); posting mechanics in [POSTING_ENGINE.md](POSTING_ENGINE.md).

## 1. Subledger model

- Each partner balance is the sum of **subledger entries** (open-item accounting):
  invoices (+), credit notes (−), receipts (−) for AR; supplier invoices (+), debit
  notes (−), payments (−) for AP; plus FX-difference and adjustment entries.
- Every entry carries: partner, document ref, due date, currency, document amount,
  base amount, allocation state, and period. **Open items** drive aging and statements.
- Control accounts (`AR_CONTROL`, `AP_CONTROL`) aggregate these — partner-level lines in
  journals keep the 1:1 provenance (`partner_id` on journal line, INV-009).

## 2. Aging & due dates

- Due date = invoice date + credit terms (per partner or default: net 7/15/30/60/custom,
  or month-end rules later). Aging buckets: not due, 1–30, 31–60, 61–90, 90+ (configurable).
- Aging reports compute from open items at an as-of date; documents posted after the
  as-of date are excluded even if back-dated visible later (report determinism).

## 3. Allocations (settlement matching)

1. Receipts/payments allocate to open invoices explicitly (FIFO suggestion by default;
   manual override allowed before posting). One receipt may allocate many invoices;
   partial allocations allowed (remaining = unallocated/on-account).
2. **On-account amounts** (unallocated) remain open items with no invoice reference —
   visible on statements, allocatable later; never silently netted.
3. Allocation changes after posting happen via re-allocation documents (audited), not
   edits; total allocated can never exceed the receipt amount (INV-016).
4. Credit notes offset invoices by explicit allocation (or policy: auto-apply to oldest
   matching invoice — default OFF).

## 4. Credit management (AR)

- Credit limit + overdue-amount policy per partner: block / warn / ignore
  (default warn). Enforcement point: sales invoice approval (server-side; offline POS
  uses a cached limit snapshot + sync-time re-validation —
  [../offline/CONFLICT_RESOLUTION.md](../offline/CONFLICT_RESOLUTION.md)).
- On-account advances (customer deposits) post to `DEPOSITS_RECEIVED` when the tenant
  policy distinguishes them from AR; applied against invoices at invoicing.

## 5. Statements

- Customer/supplier statement: open items + activity over a date range, with running
  balance, aging column, original vs. due amounts, in document currency with base
  total; bilingual, RTL-correct print ([../reporting/PRINTING_AND_EXPORT.md](../reporting/PRINTING_AND_EXPORT.md)).
- Statement balance = subledger sum at as-of date; must equal the partner's ledger
  contribution to the control account (INV-009) — verified by automated reconciliation
  in the statement generation path.

## 6. Partner-facing views (personal accounts)

- Mobile/portal views show: balance, statement, invoices, receipts/payments, due dates
  — **only** documents flagged shareable, never internal memos, margins, or other
  partners' data (see [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md)
  §personal accounts; directive §13).
- Read-mostly, cached offline per ADR-0012.

## 7. AP specifics

- Supplier invoices may be posted from GRN flow (clearing `GRNI`) or standalone; debit
  notes adjust; payments allocate identically to receipts (mirror).
- Supplier balances aging drives payables planning reports
  ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md)).
