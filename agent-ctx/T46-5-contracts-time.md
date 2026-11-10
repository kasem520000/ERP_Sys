# T46 / Task 5 — Service contracts + schedule + time entries (PHASE-019)

**Agent:** T46 (contracts + time) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — code + the two DB specs green; all four gate commands
clean. See "Gate tails" below. (The original T46 run hit the turn limit after
the code landed; **T46b (follow-up)** wrote the missing
`apps/api/src/__db__/crm/contracts.spec.ts` + `apps/api/src/__db__/crm/time.spec.ts`,
fixed the four service bugs the specs surfaced, and finalized this file.)

## Scope (MASTER-PLAN §4 + §6 + §9 + §11 rows 18–29 + 32–36 + §15 + §16 T46)

The contract lifecycle (DRAFT → ACTIVE/CANCELLED/RENEWED; CT-{YYYY}-{SEQ:5}
reserve+bind at ACTIVATION — the JC pattern), the §4 billing-schedule grid
semantics (RETAINER clipped calendar months in advance / MILESTONE dated lines /
HOURLY arrears periods, amount NULL), advance tagging with the policy-gated
J-DEF reclass journal (§1 row 4 + §18 lesson 2), time entries + weekly review,
and the contracts/time controllers. §18 lessons 1 + 2 are baked in AND now
spec-pinned (see "Lesson compliance" + "T46b service fixes").

## Files created / changed (FINAL — what shipped)

| File | Content |
|---|---|
| `apps/api/src/modules/crm/domain/crm-errors.ts` | 12 typed errors: the 11 from the task card + TIME_ENTRY_INPUT_INVALID (the T45 per-slice input-class convention; documented deviation). |
| `apps/api/src/modules/crm/infrastructure/crm.store.ts` | The contract slice (insert/find/listContracts/patchContract incl. number+status stamps), the schedule slice (insert/list/find/patch, findScheduleGridFeeItem with optional entryType filter), contract_invoices (insert with the two partial-unique guards, list), advances (insert/find/list/patch, listHeldAdvancesForReceipt, sumTaggedAdvancesForReceipt), time entries (insert/find/list/patch/void/approveWeek/approveWeekTimeEntries/listPullableTimeEntries), read-only probes findReceiptForCrm + findItemForCrm. **T46b:** patchTimeEntry's `billable` CASE got the `?? null` parameter (broken-SQL fix); approveWeekTimeEntries now returns the flipped IDS (the batch-audit anchor). |
| `apps/api/src/modules/crm/application/contract-service.ts` | create/activate/cancel/renew/update/list/find (derived isExpired)/listSchedule/listContractInvoices/expandSchedule→applySchedule/tagAdvance/listAdvances/billingPreview + the exported preview types (the T47 contract). **T46b:** applySchedule got the undefined-milestones no-op + the SKIPPED→re-PLANNED restore (both milestone labels and period keys) — see "T46b service fixes". |
| `apps/api/src/modules/crm/application/time-entry-service.ts` | create/update/void/list/reviewTimesheet. **T46b:** reviewTimesheet's batch audit anchors on the first flipped row (NOT-NULL-uuid entity_id — the reservations-swept precedent); after-state carries {weekStart, weekEnd, reviewed, timeEntryIds}. |
| `apps/api/src/modules/crm/presentation/contracts.controller.ts` | §11 rows 18–29 (incl. row 29 contract-invoices listing) under @Controller("api/v1/crm"). |
| `apps/api/src/modules/crm/presentation/time.controller.ts` | §11 rows 32–36. |
| `apps/api/src/modules/crm/crm.module.ts` | + ContractService + TimeEntryService providers; + the two controllers. |
| `apps/api/src/infra/http/error.filter.ts` | The T46 CRM block: 404 (CONTRACT_NOT_FOUND, SCHEDULE_ENTRY_NOT_FOUND, TIME_ENTRY_NOT_FOUND), 409 (CONTRACT_STATE, ADVANCE_STATE, TIME_ENTRY_STATE), 422 (CONTRACT_INPUT_INVALID, CONTRACT_TERM_INVALID, ADVANCE_INSUFFICIENT_ON_ACCOUNT, TIME_ENTRY_CASE_REQUIRED, TIME_ENTRY_INPUT_INVALID, TIMESHEET_EMPTY). |
| `apps/api/src/__db__/crm/contracts.spec.ts` | **SHIPPED (T46b)** — 20 tests, dedicated tenant `6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a` (SAR; verified unused — 66666666 is TENANT_M). Four describes: (1) lifecycle + grid semantics — create→DRAFT with the §15 retainer grid AT CREATE, DRAFT edits + idempotent re-expansion (still 6), activate → **CT-2026-00001** + audit + derived isExpired, typed CONTRACT_STATE on illegal transitions, the §18 lesson-1 MILESTONES PATCH dance (full-replace omitting feeItemId; removed→SKIPPED; restored→re-PLANNED; a field-only PATCH never wipes the grid), the §15 canonical milestone grid, the 2028 leap-day + month-edge clip grids (+ DRAFT term-shortening SKIPPED/re-PLAN), the §9 billing-mode gate (mode flip via tenant_settings + fingerprint bump; HOURLY arrears grid amount NULL), renew (old→RENEWED + renewedToContractId; new DRAFT copy with carried milestones @+365d + fresh-term default; the renewal PATCH = lesson-1 shape b), cancel (reason required; terminal states refuse); (2) advance tagging — J-RCP for the posted on-account receipt, policy ON tag → J-DEF [DR AR_CONTROL 500.0000 (partnerId, projectId) · CR DEFERRED_REVENUE 500.0000 (partnerId NULL, projectId NULL — lesson 2)] asserted via journal.store findEntryBySourceKey + listLines + the AR line's partner_subledger_entries row (DEBIT, source_type contract_advance), insufficient (600 vs 500 held) → ADVANCE_INSUFFICIENT_ON_ACCOUNT zero residue, duplicate → ADVANCE_STATE, policy OFF → link-only (HELD, deferJournalId NULL, ZERO journals), DEFERRED_REVENUE unmapped (purpose row deleted) → PURPOSE_NOT_MAPPED fail-closed zero residue (mapping restored), DRAFT contract → CONTRACT_STATE, unknown receipt → ADVANCE_STATE; (3) billing preview — wouldInvoice per PLANNED entry ≤ asOf + the date boundary, guard rows skip entries (BOTH keys: periodKey on C1 + milestoneScheduleId on C2), periodLocked via PeriodService softClose→lock→reopen (order-independent); (4) HTTP rows 18–29 over the real AppModule pipeline (create 201 → PUT while DRAFT → activate 201 (CT shape) → schedule (6 entries) → preview → advances → contract-invoices → PUT-on-ACTIVE 409 CONTRACT_STATE → mode-refused create 422 CONTRACT_INPUT_INVALID → unknown id 404 CONTRACT_NOT_FOUND → cancel 201). |
| `apps/api/src/__db__/crm/time.spec.ts` | **SHIPPED (T46b)** — 7 tests, dedicated tenant `6b6b6b6b-6b6b-6b6b-6b6b-6b6b6b6b6b6b` (SAR; verified unused). The §15 hourly chain: an ACTIVE HOURLY contract (mode=hourly via a tenant_settings row; term 2026-03-01→06-30, FEE-HR @ a SALE price list 250.000000/h minQty 1 on partner P-000001, CASE-01): (1) case policy — no projectId → TIME_ENTRY_CASE_REQUIRED zero residue, with CASE-01 + manual rate → DRAFT + audited; (2) rate snapshot — the contract partner's price-list price (250.000000 — SALES_PRICE_LIST), manual wins (300.000000), FEE-CONSULT unresolvable without a manual rate → TIME_ENTRY_INPUT_INVALID, no-contract-no-rate → the other typed shape, non-SERVICE item refused; (3) weekly review — weeks 2026-03-23/03-30/04-06 flip counts 1/2/2, entries APPROVED, batch audit `crm.timesheet_reviewed` with after {weekStart, weekEnd, reviewed, timeEntryIds}; empty week → TIMESHEET_EMPTY; non-Monday → TIME_ENTRY_INPUT_INVALID; (4) void — DRAFT→VOID, re-void→TIME_ENTRY_STATE, APPROVED→VOID, BILLED (store-patched) → TIME_ENTRY_STATE + immutable for edits; (5) pullable set — listPullableTimeEntries returns exactly [E2, E3] for April (DRAFT/VOID/BILLED/no-contract/out-of-window all excluded) + the row-32 list filters; (6) preview HOURLY branch — Mar item wouldInvoice [Research 3.000000×250.000000], Apr item pullable [E2, E3] with needsNarrative [E3] and wouldInvoice [Drafting 2.000000×250.000000] — the narrative-less entry listed + skipped, never silently billed; periodStatus OPEN. |
| `agent-ctx/T46-5-contracts-time.md` | This file. |

## Lesson compliance (§18 lessons 1 + 2 — spec-pinned)

1. **Fee-item home = the schedule** (no contract-level column). BOTH shapes are
   now pinned by contracts.spec: (a) create MILESTONES (contract-level feeItemId
   + null-fee lines) → full-replace PATCH omitting feeItemId SUCCEEDS (removed
   label SKIPPED; restored re-PLANNED; a title-only PATCH keeps the grid) — the
   exact first-execution symptom class; (b) the same PATCH shape on a RENEWAL
   DRAFT copy (the renewal copy's grid carries the default). The FIRST run of
   the spec exposed that applySchedule did NOT actually honor "unchanged" —
   see T46b fix #1/#2 below.
2. **J-DEF's AR line carries the project stamp**: pinned by asserting
   journal_lines per line — AR_CONTROL DEBIT: partnerId + projectId=CASE-01;
   DEFERRED_REVENUE CREDIT: partnerId NULL, projectId NULL. Plus the AR line's
   partner_subledger_entries row (DEBIT, source contract_advance).

## Grid semantics as computed (§4 verbatim — spec-pinned)

- RETAINER 2026-01-15 → 2026-06-14, monthly 1000.0000 → EXACTLY 6 rows:
  `2026-01` (01-15→01-31, billDate 01-15), `2026-02` (02-01→02-28, billDate
  02-01), `2026-03`, `2026-04`, `2026-05`, `2026-06` (06-01→06-14, billDate
  06-01) — full 1000.0000 per period, NO proration, billDate = periodStart
  (advance). Written at CREATE; idempotent re-expansion (update touching the
  same term + the activation re-run) stays at exactly 6.
- Leap-day: term 2028-02-01 → 2028-03-31 → `2028-02` = 02-01→02-29 +
  `2028-03` = 03-01→03-31. Month-edge: term 2026-01-10 → 2026-03-15 → 3 rows
  with `2026-03` clipped at 03-15; a DRAFT term shortening flips the removed
  period SKIPPED, restoring re-PLANS (never deleted, never duplicated).
- MILESTONES: Signing 5000.0000 @2026-03-01 + Delivery 7000.0000 @2026-05-01
  → 2 labeled rows, periodKey NULL, billDate = the milestone date (listSchedule
  orders MILESTONE rows BY LABEL — Delivery before Signing).
- HOURLY: one HOURLY_PERIOD row per calendar month, billDate = periodEnd
  (arrears), amount NULL — pinned in BOTH files (contracts.spec's mode-gate
  describe + time.spec's beforeAll).
- Expansion is ADDITIVE + reconciling: insert missing keys, update existing
  PLANNED rows, flip removed keys to SKIPPED, NEVER delete, NEVER touch
  INVOICED. Runs at create, at update, and idempotently at activate.

## The advance J-DEF shape (§1 row 4 + lesson 2) — spec-pinned

`tagAdvance({receiptId, amount})` on an ACTIVE contract + POSTED receipt with
enough unallocated on-account credit (amount − allocated − Σ tagged advances),
policy `crm.defer_advance_recognition` ON (a tenant_settings row; read via
readEffectiveSetting):

```
source: {docType: "contract_advance", docId: <advance-row id>, operation: "defer"}
DR AR_CONTROL   500.0000  partnerId=<contract partner>, projectId=<contract project>
CR DEFERRED_REVENUE 500.0000   (no partner, NO projectId — lesson 2)
```

The posting service writes the partner subledger DEBIT row on the AR line
automatically (asserted). One journal per advance row (source-key
idempotency). DEFERRED_REVENUE unmapped → PURPOSE_NOT_MAPPED, fail-closed,
zero residue (the whole ambient UoW rolls back — asserted via advance/journal
count probes). Policy OFF → link-only (HELD, deferJournalId NULL, zero
journals). Duplicate (same receipt+contract+amount HELD) → ADVANCE_STATE.
DRAFT contract → CONTRACT_STATE.

## T46b service fixes (the bugs the specs surfaced — all in T46-owned crm files)

1. **applySchedule MILESTONES: `milestones: undefined` wiped the grid.** The
   code read `const lines = state.milestones ?? []` — so a field-only PATCH
   (title/scope/term, milestones OMITTED) built an EMPTY expected map and
   flipped every stored milestone row to SKIPPED, despite the comment claiming
   "undefined = unchanged → no-op". Fix: an early `return` when
   `state.milestones === undefined` (the grid stays exactly as stored). Pinned
   by the lesson-1 test's PATCH #3 (a title-only PATCH keeps both rows
   PLANNED).
2. **A removed-then-restored key stayed SKIPPED.** In BOTH branches the
   expected loop only handled `row === undefined` (insert) and
   `row.status === "PLANNED"` (patch); a SKIPPED row whose label/periodKey
   returned in the input was silently ignored — restores never re-PLANNED
   (and could not insert a duplicate: the partial uniques hold the keys
   forever). Fix: an `else if (row.status === "SKIPPED")` branch that patches
   the row back to PLANNED with the new line data — for MILESTONE labels AND
   RETAINER/HOURLY period keys. Pinned by the lesson-1 PATCH #2 (Delivery
   restored) + the month-edge term shortening/restore.
3. **crm.store.patchTimeEntry: the `billable` CASE rendered broken SQL.**
   `billable = CASE WHEN ${input.billable === undefined} THEN billable ELSE
   ${input.billable} END` — an omitted billable (EVERY status-only patch,
   e.g. the void path) left the ELSE branch with a bare `undefined` → drizzle
   emitted `… ELSE  END` → a syntax error on every such UPDATE. Fix:
   `ELSE ${input.billable ?? null} END` (the param is only ever SELECTED when
   defined — the `?? null` just gives the SQL a valid placeholder). Pinned by
   the whole void describe (previously every void threw).
4. **reviewTimesheet's batch audit inserted a DATE into a uuid column.**
   `entityId: weekStart` ("2026-03-23") — audit_events.entity_id is a NOT NULL
   uuid → the audit INSERT failed → the whole review UoW rolled back (the
   flips AND the audit; pullable/preview downstream saw no APPROVED rows).
   Fix: approveWeekTimeEntries now returns the flipped IDS; the audit anchors
   on the first flipped row (the reservations-swept precedent — "entity_id is
   a NOT NULL uuid — anchor the sweep's audit on the first flipped row"),
   with after-state {weekStart, weekEnd, reviewed, timeEntryIds}. Pinned by
   the weekly-review counts + the batch-audit asserts.

## T46b deviations / decisions (documented)

- **"unknown receipt → typed 422" (task card) vs the shipped contract**: the
  service throws ADVANCE_STATE (409 through the filter) for a well-formed
  uuid that exists nowhere — the stable API contract T46 shipped and mapped in
  error.filter. Changing it post-hoc would churn the recorded filter decision;
  the spec pins ADVANCE_STATE and the 422-class mode-refusal create covers the
  typed-422 path. Recorded here for review.
- **BR-040 entitlement closure**: the contracts tenant seeds the FULL
  4-key set (crm.service_contracts + partners.directory + platform.onboarding
  + platform.registration) — a single-key grant fails resolveTenantStatic's
  closure validation (the template-prerequisites spec's rule) with
  `configuration/resolution-failed`. The time tenant ships NO entitlements
  (its services never consult them).
- **Price-list tiers**: ck_price_list_items_min_qty enforces `min_qty > 0`, so
  the §15 rate fixture uses minQty 1 (the partial-free default tier); every
  list-resolved §15 quantity is ≥ 1 (0.5h slips carry manual rates).
- **Settings flips mid-suite**: the setSetting helper bumps `updated_at` on
  upsert — the resolve cache's fingerprint hashes `key || ':' || updated_at`,
  so a bare value-only UPDATE would serve the STALE cached static config (the
  setting-reader quirk; both specs carry the helper + comment).
- **HTTP action POSTs return 201** (activate/cancel/renew have no @HttpCode
  override — the T45 controller shape); only create is 201-by-declaration
  (HttpStatus.CREATED is the same code). The spec pins 201.
- **Milestone grid ordering**: listSchedule orders by
  COALESCE(period_key, milestone_label) — MILESTONE rows sort BY LABEL
  (Delivery before Signing); the toEqual arrays follow it.
- The earlier T46 deviations stand as shipped: TIME_ENTRY_INPUT_INVALID added
  beyond the 11 listed codes; related-target.ts untouched (the CONTRACT/SERVICE_ORDER
  probes stay deferred — T48 or the plan owner); crm.contract_billing_mode
  enforced at create/update as the §9 manifest key's consumer; removed period
  keys flip SKIPPED; pullable time entries require billable = true;
  retainer/hourly grids written at CREATE; row 29 mounted by T46; renewal copy
  semantics + the audit-action spellings (below) — all pinned by the specs.

## Audit actions (all spec-pinned)

crm.contract.{created,updated,activated,cancelled,renewed,renewal_created},
crm.contract_advance.tagged, crm.time_entry.{created,updated,voided},
crm.timesheet_reviewed (batch — anchored on the first flipped row, after-state
{weekStart, weekEnd, reviewed, timeEntryIds}).

## Gate tails (FINAL — T46b)

```
$ cd apps/api && TMPDIR=$HOME/tmp-t46 npx vitest run --config vitest.db.config.ts src/__db__/crm/
 ✓ src/__db__/crm/time.spec.ts (7 tests)
 ✓ src/__db__/crm/tasks.spec.ts (10 tests)          ← T45 stays green
 ✓ src/__db__/crm/contracts.spec.ts (20 tests)
 ✓ src/__db__/crm/leads.spec.ts (8 tests)           ← T45 stays green
 Test Files  4 passed (4)
      Tests  45 passed (45)
 Duration  16.01s

$ pnpm --filter @erp/api typecheck   → clean (tsc --noEmit, no output)
$ pnpm --filter @erp/api run lint    → clean (eslint ., no output)
$ pnpm --filter @erp/api test
 Test Files  25 passed (25)
      Tests  274 passed (274)
```

## Handoff notes for T47 (billing runs + deferral release)

1. **The preview IS the contract**: `ContractService.billingPreview(contractId,
   asOf)` → `ContractBillingPreview {contractId, asOf, items: readonly
   ContractBillingPreviewItem[]}` where each item = `{entry:
   store.ScheduleEntryRow; wouldInvoice: readonly PreviewInvoiceLine[]
   {feeItemId, qty, unitPrice, description}; pullableTimeEntries: readonly
   TimeEntryRow[]; needsNarrative: readonly TimeEntryRow[]; periodStatus:
   "OPEN"|"SOFT_CLOSED"|"LOCKED"|"NONE"; periodLocked: boolean}`. The run must
   mirror the preview exactly (§5): per due PLANNED entry (billDate ≤ asOf, no
   guard row) one DRAFT sales invoice with wouldInvoice as the lines; HOURLY
   lines are one per pullable entry (§6 snapshot rate × hours, narrative as
   the description); needsNarrative entries are skipped + listed (never
   silently billed); periodLocked entries are skipped + listed periodLocked.
2. **Store function names** (crm.store, the run's writer surface):
   `insertContractInvoice({contractId, invoiceId, periodKey, milestoneScheduleId,
   actorId})` (the two partial uniques make concurrent double-fire a graceful
   skip), `patchScheduleEntry({id, status, invoiceId})` for the INVOICED flip,
   `listContractInvoices({contractId, status, limit})` for the guard read,
   `listHeldAdvancesForReceipt` / `sumTaggedAdvancesForReceipt` /
   `patchContractAdvance({id, status, releasedJournalId, releasedInvoiceId})`
   for the J-REL release (§1 row 5), `listScheduleByContract` for the due scan.
3. **The pullable-time query**: `listPullableTimeEntries({contractId, fromDate,
   toDate})` — APPROVED ∧ billed_invoice_id IS NULL ∧ billable ∧ contract-linked
   ∧ entryDate within the period window (mirrors
   ix_crm_time_entries_pullable). The preview calls it per HOURLY period with
   the entry's periodStart/periodEnd.
4. **The J-DEF substrate is live and pinned** (contracts.spec tenant 6a6a…):
   tagAdvance posts `{docType: "contract_advance", docId: <advance id>,
   operation: "defer"}` — your J-REL (§1 row 5) should mirror the stamps
   (BOTH lines carry projectId per lesson 2 — J-DEF is the AR-line-only
   exception) and fire through the §11 contract-billing port inside the same
   posting UoW (lesson 6: wire `setContractBillingPort` on YOUR spec's
   salesInvoices instance exactly as CrmModule will).
5. **The §15 fixture reuse**: the contracts tenant (6a6a…) carries the mapped
   purposes (AR_CONTROL 1130, DEFERRED_REVENUE 2130, SALES_REVENUE 4100,
   SERVICE_REVENUE 4200, VAT_PAYABLE 2120), fee items FEE-RET/FEE-MIL/FEE-HR,
   partner P-000001 (price-list-less), CASE-01/02, FY2025+FY2026, a MAIN
   branch + the seeded sales invoice row for guard FK targets, and the
   DEFERRED_REVENUE purpose row (restored after the unmapped test). The
   deferral chain (§15: receipt 500 @2025-12-15, J-RCP, J-DEF, the February
   draft + J-REL) can adopt the same tenant family or its own — the numbering
   (CT-2026-0000N) is sequential per tenant.
6. **Policy knobs**: `crm.defer_advance_recognition` via tenant_settings
   (readEffectiveSetting — fresh reads, no cache concern);
   `crm.invoice_approval_required` gates your run's auto-submit (never
   auto-post — BR-034); `crm.narrative_required_on_time_billing` (default
   true) feeds needsNarrative. Mid-suite flips of resolve-layer policies MUST
   bump tenant_settings.updated_at (the fingerprint quirk — see the setSetting
   helper in contracts.spec).
7. **The monthly pg-boss job** (`crm.contract-billing-run`, cron `0 3 1 * *`)
   is yours to register (the CRM_TASK_REMINDERS_SWEEP_QUEUE pattern in
   crm.module.ts); the migration has NO billing_runs table — history rides
   audit events (the documented choice).
