# T47 / Task 6 — Recurring billing runs + deferred-revenue release (PHASE-019)

**Agent:** T47 (billing + deferral) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — crm DB folder 64/64 (billing + deferral 19/19 new; leads/tasks/
contracts/time 45/45 stayed green), sales + jobs regressions 56/56, api unit 274/274,
typecheck clean, lint clean, depcruise 0 (950 modules). (The agent was cut by the
harness deadline after the specs went green but before finalizing this file; the plan
owner verified all gates and finalized the evidence — §18 lesson 7 discipline.)

## Scope (MASTER-PLAN §1 rows 1/4/5 + §5 + §9 + §11 rows 30–31 + §15 + §16 T47)

BillingRunService (run + preview + audit history over audit_events), the
DeferralService J-REL release through the §11 contract-billing port, port
wiring in CrmModule, the monthly pg-boss job, controller rows #30–#31, and
the two DB specs (billing + deferral). §18 lessons 2+3+6 baked in (see
"Lesson compliance").

## Files (planned → final)

| File | Content |
|---|---|
| `apps/api/src/modules/crm/infrastructure/crm.store.ts` | + the T47 slice (banner-style append): findMainBranchForCrm, findItemTaxCodeForCrm, findInvoiceForCrm, **findInvoiceArOpenItem** (lesson 3 — mirrors arOpenItemsAsOf's WHERE), upsertReceiptAllocation (+ exact receipt.allocated_amount recompute — the replacePostedReceiptAllocations mirror), markTimeEntryBilled. |
| `apps/api/src/modules/crm/application/billing-run-service.ts` | run({asOf, actorId}) + preview({asOf}) + listRuns(limit) + sweepAllTenants(). |
| `apps/api/src/modules/crm/application/deferral-service.ts` | onContractInvoicePosted (the port impl) — J-REL + allocation + RELEASED stamps + partial continuation; honest-failure posture. |
| `apps/api/src/modules/crm/crm.module.ts` | SalesModule import + port wiring in the constructor + BillingRunService/DeferralService providers + BillingController + the `crm.contract-billing-run` cron job. |
| `apps/api/src/modules/crm/presentation/billing.controller.ts` | rows #30–#31 (GET/POST /api/v1/crm/billing-runs, crm.contracts.bill + feature crm.recurring_billing). |
| `apps/api/src/__db__/crm/billing.spec.ts` | §15 retainer/milestone/hourly chains + idempotency + period lock + posting + credit-note cancellation + auto-submit policy. Tenant 68686868-…. |
| `apps/api/src/__db__/crm/deferral.spec.ts` | §15 deferral golden chain + partial + policy OFF + unmapped honest-failure + link-only + INV-013 replay. Tenant 69696969-…. |

## §18 lesson 3 verification (partner_subledger_entries — DONE FIRST, binding)

Read the REAL DDL (0011_journal_tables.sql:280) + the writer
(accounting/application/posting-service.ts writePlan):
- Columns: partner_id, journal_entry_id, journal_line_id, entry_date,
  direction ('DEBIT'|'CREDIT'), amount, base_amount, currency_code,
  source_type, source_id, memo. Append-only (UPDATE/DELETE trigger-refused).
- The writer stamps `sourceType = plan.spec.source.docType` and
  `sourceId = plan.spec.source.docId` — for a posted sales invoice the AR
  line's row is `source_type='sales_invoice' AND source_id=<invoiceId> AND
  direction='DEBIT'` (the G-01 DR leg is the ONLY partner-carrying DEBIT on
  that journal).
- The open-items read (sales.store arOpenItemsAsOf) additionally constrains
  the joined journal_line to the ACTIVE AR_CONTROL purpose account and
  computes settled/outstanding via the treasury_allocations lateral sum.
- `findInvoiceArOpenItem` mirrors that exact shape (see the spec's
  assert-J-REL-exists pin — lesson 3's verification-by-assertion).

## Allocation mechanics found + used (INV-016 + the ar.allocations tie)

`replacePostedReceiptAllocations` (sales.store:1466) is the sanctioned
writer shape: treasury_allocations rows keyed (receipt, open_item) with the
partial unique uq_treasury_allocations_receipt_item; the receipt's
denormalized allocated_amount is recomputed as `COALESCE(Σ allocations,
0)` after the write. The release writes the SAME shape additively: upsert
aggregating on (receipt, invoice open item) + the identical allocated_amount
recompute — so Σ allocations == Σ receipts.allocated_amount holds by
construction and the invoice's open = gross − released (the settled lateral
in arOpenItemsAsOf picks the allocation up automatically).

## Golden fixtures as computed (§15)

(to be filled from the spec run tails)

## Deviations / decisions (documented)

1. **Fee-line tax code**: the create flow resolves VAT ONLY from an explicit
   line taxCodeId (lines with null are filtered out of resolveOutputTaxLines
   — no VAT). The §15 golden (net 1000.0000 / gross 1150.0000 with 15% VAT)
   is BINDING, so the run resolves the line's taxCodeId from the fee ITEM's
   stored tax_code_id (the job-card pattern: the source row's tax code rides
   the invoice line — there the card line carries it; here the item row is
   the source of truth). The §15 fee items are created WITH the STD 15%
   code. An item with no tax code bills VAT-free (the honest absence).
2. **Run history over audit_events** (`crm.billing_run`) — NO billing_runs
   table (migration 0027 frozen); documented choice per §5.
3. **Fail-closed per-entry errors**: non-duplicate failures during a run
   roll back to the per-entry savepoint and rethrow (zero partial residue;
   the operator retries; duplicates are the graceful-skip class only).
4. **periodStatus "NONE"** (no covering fiscal period) is skipped +
   recorded as periodLocked (posting would fail — the preview's own comment;
   dead drafts refused like LOCKED).
5. **SOFT_CLOSED** drafts are created and carry periodStatus in the result
   rows (BR-030 posture noted — no separate warnings array; the shape stays
   the task card's).
6. **Release remaining = max(0, gross − settled-on-invoice)**: the task
   card's "remaining = gross" would double-release on port re-fire after a
   partial failure (held advances re-see the full gross). Subtracting the
   invoice open item's existing settled amount (prior releases + any manual
   receipt allocations) makes re-fire a true no-op and never over-settles.
7. **J-REL posting replay** (idempotentReplay=true): the journal is the
   truth — skip the allocation add (would double) and stamp RELEASED.
8. **Critical inbox**: InboxService.record (tenant broadcast, category
   "crm", severity "critical", dedupeKey `crm-advance-release-failed:
   <advanceId>`) — no email leg (no template exists in T42's enum; adding
   one is outside T47's file set — recorded for the plan owner).
9. **The J-DEF debit row on the open-items surface**: per §1 row 4 the
   reclass "nets the receipt's credit row" at the partner-BALANCE level; the
   DEBIT row itself stays an open item on the aging surface until J-REL's
   credit lands (same behavior as the receipt credit row on the CREDIT
   side). Noted for T49 (report queries may want to net reclass pairs).

## Handoff notes for T49 (reports + dashboards)

- **The §13 reconciliation invariant reads**: contracted = schedule rows (PLANNED +
  INVOICED, amount per entry; HOURLY entries compute from billed invoices instead —
  report them by their generated invoices only, labeled honestly); invoiced = the
  contract_invoices-linked sales_invoices with status POSTED (net + VAT from the
  invoice row); draft = the same join with status DRAFT/PENDING_APPROVAL/APPROVED;
  backlog = contracted − invoiced − draft. Store joins: contract_invoices (contractId,
  invoiceId, periodKey/milestoneScheduleId) → sales_invoices.
- **GL tie**: Σ invoiced net per (contract) == Σ journal_lines on purpose
  SERVICE_REVENUE/SALES_REVENUE accounts for the invoices' posted journals (entry ids
  from sales_invoices.posted_journal_id) — tolerance 0.
- **Overdue buckets**: join the posted contract invoices' AR open items (partner
  subledger DEBIT rows of source sales_invoice) net of settled (treasury_allocations +
  J-REL release credits) — matching `ar.aging` buckets for the same asOf; see deviation
  9 (the J-DEF debit row stays an open item on the aging surface until J-REL lands —
  the report may net reclass pairs when presenting "advance-held" separately).
- **services.time_billing_summary**: crm_time_entries (hours, unitRate snapshot,
  status, billedInvoiceId) grouped by project/fee-earner; recorded = all non-VOID;
  billable = billable flag; invoiced = billedInvoiceId set; amounts = hours × rate
  (operational labels — non-GL).
- **Dashboard-summary** (T45's route) already returns the counts; the web CRM section
  (T50) binds to it + the two pinned reports.
- **Billing-runs history**: audit_events action `crm.billing_run` (summary JSON in
  after-state) — newest-first, limit param.

## Gate tails (plan-owner verified, 2026-11-03 re-execution)

- `pnpm --filter @erp/api typecheck` — clean · `run lint` — clean.
- `TMPDIR=$HOME/tmp-t47 … src/__db__/crm/` — `Test Files 6 passed (6) / Tests 64
  passed (64)` (billing.spec + deferral.spec new: 19/19; leads 8 + tasks 10 +
  contracts 20 + time 7 unchanged).
- `TMPDIR=$HOME/tmp-t47 … src/__db__/sales/ src/__db__/jobs.db.spec.ts` —
  `Test Files 7 passed (7) / Tests 56 passed (56)` (the port hook + sales surface:
  zero regressions).
- `pnpm --filter @erp/api test` — 274/274 · `pnpm run lint:depcruise` —
  ✔ no dependency violations found (950 modules, 6401 dependencies cruised).
- readonly-sweep: rows 30–31 now answer; the remaining unmounted set = T48's
  service-order rows only.
