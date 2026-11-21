# Accounting Invariants

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-11-10 (PHASE-037 — INV-027) · 2026-11-12 (PHASE-042 — INV-028) · 2026-11-12 (PHASE-044 — INV-029)

The testable, normative invariants of the financial core. Each invariant has an ID
referenced by module code comments, test names (`INV-xxx`), and phase acceptance
criteria. **These are non-negotiable**: no feature, configuration, industry template, or
entitlement may violate any invariant (directive §1.15). Test plan:
[../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md).

## Ledger integrity

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-001 | For every journal entry: Σ(debit) = Σ(credit) in document currency, within exact 0 tolerance. | Posting engine validation #7 · engine unit tests |
| INV-002 | For every journal entry: Σ(debit) = Σ(credit) in base currency (FX conversion applied per line, residuals explicit). | Engine validation #7 · FX tests |
| INV-003 | Posted journal entries and lines are immutable: no UPDATE/DELETE ever succeeds (including via repository misuse — guards + RLS). | Engine + DB triggers + attack tests |
| INV-004 | Journal lines target only active, postable leaf accounts. | Engine validation #5 |
| INV-005 | Currency-restricted accounts reject lines in other currencies. | Engine validation #5 |
| INV-006 | Every posted financial document references its journal entries and vice versa (`source` chain complete); a document can never be `POSTED` with zero journal entries. | Same-transaction writes · integration tests |
| INV-007 | Rounding residuals are never dropped: line tax + line nets + header totals reconcile exactly, differences post to rounding purposes. | Tax engine + engine · property tests |

## Idempotency and correction

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-013 | A posting operation `(tenant, source_type, source_id, operation)` executes at most once; retries and duplicate deliveries return the original result without new ledger effects. | Unique index + engine check · idempotency tests, sync chaos tests |
| INV-014 | A posted entry can be negated only by a reversal entry that mirrors it exactly (accounts, partners, items, tax codes, amounts) and links bidirectionally; an entry can be reversed at most once. | Engine `reverse()` · reversal tests |

## Period integrity

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-011 | No journal entry may exist with an entry date inside a `LOCKED` period; the engine rejects before write (and DB trigger double-checks). | Engine validation #4 + trigger · lock tests |
| INV-020 | Reopening a locked period requires an explicit permission + reason and writes an audit event; posting after reopen revalidates all invariants normally. | Period service · audit tests |

## Subledger integrity

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-009 | (a) Every journal line hitting AR/AP control purposes carries a partner; (b) at all times Σ partner subledger entries (base) = AR/AP control account balance. | Engine validation #6 · reconciliation job · drift tests |
| INV-010 | At all times Σ(qty × valuation) over stock ledger = inventory (and WIP) account balance(s); stock_moves and their journals are atomic (INV-018). | Inventory + engine · reconciliation job |
| INV-012 | Per period: Σ document tax summaries by treatment = movements of the corresponding GL tax accounts. | Tax engine + reconciliation job · VAT return tests |
| INV-016 | Allocations on a receipt/payment never exceed its amount; a document's allocated total never exceeds its total. | Allocation service · boundary tests |
| INV-019 | Every cash/bank account's balance equals the sum of its treasury movements (internal consistency; the account IS the ledger). | Treasury + reconciliation job |

## Inventory consistency

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-017 | An item's costing method never changes retroactively: method switches require a dated revaluation posting; past issues keep their original costs. | Inventory service · method-switch tests |
| INV-018 | Every stock move has its journal effect in the same transaction (or no journal when policy says none, e.g., same-account transfers) — never a move without its economic effect or vice versa. | Inventory + engine atomicity tests |

## Document lifecycle integrity

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-008 | Every foreign-currency entry stores its exchange rate; rate > 0; base amounts = document amounts × rate exactly as stored (no recomputation drift). | Engine validation #3 |
| INV-015 | An account with postings or children cannot be deleted; required-purpose accounts cannot be archived while mapped. | CoA service · guard tests |
| INV-021 | Official document numbers, once assigned, are unique per (tenant, type, branch) and immutable; voided numbers remain reserved. | Numbering service · concurrency tests |

## Configuration cannot override

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-022 | No tenant configuration, template, or entitlement can disable or alter any invariant above; configuration selects accounts (purposes), features, and policies — never accounting mathematics. | Architecture (engine centralization) · review checklist · config-fuzz tests |

## Financial-depth integrity (Blueprint v2.0 — PHASE-026…029, 034)

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-023 | For every asset: Σ depreciation ≤ cost − salvage_value; NBV ≥ 0 always; disposal only once and only from status ACTIVE/FULLY_DEPRECIATED. | Fixed-assets run + disposal services (per-category purpose maps, BR-041…043) · INV-023 suite ([../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md) §2) |
| INV-024 | Note custody equals its journal effects: a COLLECTED/DISCOUNTED/RETURNED note carries zero `NOTES_RECEIVABLE` balance; a DISHONORED note restores the AR open item exactly (amount + references). | Notes custody machine (`custody-machine.ts` legal transitions) + dishonor/return services (the repoint-restore algebra over `treasury_allocations.note_id`; G-24…G-27, BR-045…047) · INV-024 property suite ([../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md) §2) + RC-11 notes reconciliation (kind `NOTES`, [RECONCILIATION.md](RECONCILIATION.md) §1 row 11) |
| INV-025 | Payroll run totals equal Σ lines (gross, deductions, net) and net = gross − deductions exactly; posted runs are immutable (reversal-only). | Payroll run service (same-transaction totals, BR-052/053) + posted-row guards · INV-025 suite |
| INV-026 | Consolidation runs never write member books; consolidated statement = Σ member statements (group currency, dated FX) − eliminations; every elimination is a balanced journal in the consolidation books. | Consolidation run service (read-only cross-tenant access, [../architecture/ADR/ADR-0018-multi-entity-consolidation.md](../architecture/ADR/ADR-0018-multi-entity-consolidation.md); BR-056) + engine · INV-026 suite |

## Compliance-chain integrity (Blueprint v3.0 — PHASE-037)

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-027 | ZATCA chain integrity (PHASE-037): per-device ICV strictly monotonic 1..N, zero gaps (partial UNIQUE (tenant, device, icv) as the DB floor); every PIH equals the predecessor's stored invoice_hash (genesis = base64(SHA-256(ASCII "0"))); the verification service re-derives every digest and FAILS CLOSED on any tamper with a typed failure pack. The stamp rides the invoice post transaction — never a partial chain. Digest carries a code-level version marker (invoice-hash-v1); PHASE-054's UBL 2.1 digest re-derives the full walk (PIH links survive). | `ZatcaPhase1Service` `stampForPost` (ICV minted via SELECT FOR UPDATE inside the post transaction — zero-journal, the negative ledger proof) + `verifyDeviceChain` (re-derives digests; typed `ZatcaChainBrokenError` failure pack) · DB floor `uq_sales_invoices_tenant_device_icv` + `ck_sales_invoices_zatca_stamp_shape` (all-stamp-or-all-null, migration `0050_zatca_phase1.sql`) · BR-060/BR-061 ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)) · INV-027 suite (`zatca-phase1.spec.ts` — chain 1..N + genesis PIH, tamper fail-closed) |

## Manufacturing execution integrity (Blueprint v3.0 — PHASE-042)

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-028 | Operation sequence discipline (PHASE-042, migration 0065 — the phase doc's planned "INV-027" predates PHASE-037's ZATCA invariant, so the honest slot is INV-028; migrations 0065/0066, the 0064 D-1 precedent): on a routing-bound production order, operation N+1 cannot START before operation N reaches COMPLETED or SKIPPED (SKIPPED counts as sequence-satisfied); each operation COMPLETES at most once — an idempotent replay (re-scanned, re-called) returns the STORED row and never a second journal (the `op_<seq>` INV-013 source operation + the journal unique source index are the floor); `current_operation` advances exactly with the last resolved operation (start stamps it; completion/skip advances to the next non-terminal sequence, or stays at the last resolved one); SKIPPED requires a DISTINCT ACTIVE approver + a reason of 1..500 chars (SoD — the BR-034 house pattern: `SelfApprovalBlockedError`/`ApproverNotFoundError`); a COMPLETED operation never skips and a live order (not CANCELLED/COMPLETED) is the execution floor. | `OperationExecutionService` (`assertSequenceGate` — typed `OperationSequenceError` naming the blocking sequence; `completeOp` replay path returns `{operation, journalEntryId: op.journalId}`) · DB floors `uq_production_order_operations_order_sequence` (one row per order × sequence) + `ck_production_order_operations_state_evidence` (terminal states carry their timestamps; SKIPPED carries reason + approver) · G-40 posting (source `production_order`, operation `op_<seq>`) · BR-068…BR-071 ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)) · INV-028 suite (`__db__/manufacturing/routing-execution.spec.ts` — the gate, the one-journal replay, the skip SoD, the `current_operation` cursor, the routing-less dual mode) |
| INV-029 | Bin-content exactness (PHASE-044, migrations 0067–0073): Σ tenant-owned `bin_contents` = `item_stock` per (warehouse, item) AT ALL TIMES — every qty-changing economic move writes the bin rows in the SAME transaction as `item_stock` (the movement core's plan/apply pipeline; structural moves — status transitions, LPN moves — never touch `item_stock` because the qty never economically moved); the fold spans ALL bin statuses (AVAILABLE/QUARANTINE/HOLD — quarantine is a location state, not a valuation one) and EXCLUDES owner-partner (consignment) rows (BR-076: the owner's value never enters the tenant's `item_stock`); the blocking side is the movement core's typed `BinContentsShortError` (an under-stocked bin refuses the move), the detector is the nightly `inventory.bin-reconcile` probe (per ACTIVE tenant — a non-empty fold is ONE critical notification + a SYSTEM audit row; NOTHING is auto-repaired). **The migration-era grace:** an item with NO tenant-owned bin row in the warehouse still issues/receives through the movement core's binless path (the 0071 grace — pre-WMS stock stays spendable); that residue is placed ONLY by the operator-run backfill ([the WMS upgrade runbook](../operations/WMS_UPGRADE_BACKFILL_RUNBOOK.md)) — tracked items DISTRIBUTED per batch/serial from the proven `stock_moves` ledger, unprovable residue never invented (the probe keeps it visible). The grace may be retired ONLY after every ACTIVE tenant's backfill verification has passed (runbook §7) — never before. | `movement-core.ts` (`planReceipt`/`planIssue` + `applyReceipt`/`applyIssue` — same-transaction bin writes, directed takes/puts) · the `wms-store.reconcileBins` probe + `WmsService.reconcileAllTenants` (pg-boss `inventory.bin-reconcile`, nightly 01:45 UTC) · the `inventory.bin-contents` report's live fold assertion · BR-072…BR-077 ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)) · INV-029 suites (`__db__/inventory/wms-core.spec.ts` + `wms-inv029.spec.ts` — the fold asserted after EVERY movement kind, the exclusion rules, the serialized-completeness property) |

## Planning exactness (Blueprint v3.0 — PHASE-043)

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-030 | MRP netting exactness + the one-conversion law (PHASE-043, migrations 0074–0078): per bucket, net = (MPS + unreserved firm sales + safety-stock gap + BOM explosion) − (qualified on-hand − ACTIVE reservations) − (open POs + open MOs + inbound transfers + prior-run SUGGESTED receipts) computed in exact Decimal arithmetic (ADR-0009) with EVERY term snapshotted — the run's demand/supply lines ARE the input evidence and each suggestion carries the per-suggestion netting drill-down (the explanation-first law; a suggestion's quantity is reproducible from its netting jsonb alone); an expiry-bounded batch never covers a bucket starting on/after its expiry (M-10 — the FEFO-short supply never covers far demand); MRP runs and suggestions are NOT ledger documents (the budgeting precedent — no golden row for the run itself); a suggestion converts EXACTLY ONCE — the status-guarded claim + the partial UNIQUE (tenant, converted_doc_type, converted_doc_id) make the idempotent replay return the ORIGINAL document, never a second one (BR-079's floor). | `mrp-netting-core.netItem` (the pure walk; 40 pure-kernel oracle/property tests) + `MrpEngineService` (the snapshot writes — demand/supply lines + the params jsonb) + `MrpSuggestionsService.accept` (the status-guarded UPDATE + the unique index) · `ck_mrp_suggestions_converted_shape` + `uq_mrp_suggestions_converted_doc` · BR-079 ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)) · INV-030 db proofs (`__db__/manufacturing/planning-goldens.spec.ts` — the idempotent conversion retry returning the ORIGINAL MO, the snapshot-derived netting oracle, the re-run supersede with exactly one live suggestion) |

## Workforce exactness (Blueprint v3.0 — PHASE-045)

| ID | Invariant | Enforced by / tested at |
|----|-----------|------------------------|
| INV-031 | Attendance / leave / overtime exactness (PHASE-045, migrations 0080–0088): **(a) intervals never overlap per employee-day** — imported and manual alike (the capture law refuses an overlapping session typed `ATTENDANCE_SESSION_OVERLAP`; closing an open session re-checks the day's siblings; the import's DB floor quarantines the overlap — nothing lands silently); **(b) leave used never exceeds entitlement + carried-forward at any moment** — enforced at the APPROVE boundary (the typed `LEAVE_BALANCE_INSUFFICIENT` refusal BEFORE the same-transaction decrement, never a negative remaining), at the encash boundary (G-51's typed refusal), preserved by the accrual recompute (a lowering run is the typed all-or-nothing refusal), and re-asserted at the reader (the `hr.leave-balances` report's `leave-inv031-balance-cap` block-on-fail check); **(c) overtime hours are non-negative and within configured caps** — the per-day sanctionable total (PENDING + APPROVED) under one rule is bounded by `max_hours_per_day` (the typed refusal before any write; REJECTED never counts), every fold non-negative, and BR-084's feeding law holds at every surface (the pre-approval-required PENDING time NEVER silently fed — the exception board is its surface); attendance, rosters, and overtime entries are NOT ledger documents (the posting-canon note). | `AttendanceService.capture/checkout` + `AttendanceImportService.commit` (the overlap laws; `uq_attendance_records_dedupe` — the 0081 floor) · `LeaveService.approve/runAccrual/rollover` + `LeavePostingService.encash` (the balance caps) · `OvertimeService.createEntry/decide` (the day cap + BR-084) · BR-082…BR-084 ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)) · INV-031 suites (`__db__/hr/attendance.spec.ts` + `attendance-import.spec.ts` + `leave.spec.ts` + `overtime.spec.ts` + `leave-posting.spec.ts` — the writer-path pins; `__db__/hr/inv031.spec.ts` — the T-17 property layer: the order-independence of the non-overlap law across BOTH paths, the 12-configuration balance-cap matrix incl. mid-year joiners and carry-over boundaries, the day-cap sequences, and the feed/report/enumeration totals tie) · the `hr.leave-balances` + `hr.overtime-summary` report assertions (the reader-side re-checks) |

## Statutory exactness (Blueprint v3.0 — PHASE-046)

| # | Invariant | Enforcement / tests |
|---|-----------|---------------------|
| INV-032 | Statutory-computation exactness (PHASE-046, migrations 0089–0094): **(a) every statutory line equals rate × the CLAMPED wage base, exact 4dp** — the base folds from the frozen structure snapshot (basic + the profile's `contributory_keys` components), clamps to the row's own `[base_min, base_max]` (NULL = unbounded — the dual-cap law: one base clamps at every row's OWN cap), and the share is ONE half-up 4dp rounding point (recomputable independently with BigInt — the property wing proves it over the whole input space); an above-cap line is unrepresentable; **(b) the totals tie three ways** — Σ statutory lines == the run's statutory totals == an INDEPENDENT re-fold of the frozen jsonb breakdowns (tolerance 0; the PIT surfaces as its own line — a jurisdiction without VERIFIED brackets computes zero PIT with the explicit no-bracket note, never a fabricated rate); the `payroll.statutory-summary` report re-asserts the tie at render time and BLOCKS every export on drift (the safe direction); **(c) the EOSB true-up delta is exact** — delta = recalculated entitlement − standing provision (signed, 4dp), enforced AT THE TABLE LEVEL by `ck_eosb_calculations_delta` (a non-delta row cannot even be INSERTed); the standing provision = the 029 `balanceFor` balance + the accumulated G-54 deltas (the zero-delta law — a re-run with nothing changed posts NO journal); the statutory PROFILE tables are NOT ledger documents (the posting-canon note — their verification records live in the STATUTORY_VERIFICATION_REGISTER). | `StatutoryProfileService.resolveEmployee` + `PitEngine.compute` + `EosbService` (the engines; the PURE math in `domain/statutory-math.ts` — no clock, no store, no I/O) · BR-085…BR-087 ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)) · the `uq`/`ck` floors of migrations 0089–0090 · INV-032 suites (`__db__/payroll/statutory.spec.ts` + `pit.spec.ts` + `run-statutory.spec.ts` + `eosb.spec.ts` + `variable-lines.spec.ts` — the writer-path pins incl. the failure packs; `__db__/payroll/statutory-goldens.spec.ts` — the consolidated golden with INV-032(a) recomputed in-test with exact BigInt + the four wrong-shape RED packs; `__db__/payroll/__tests__/statutory-properties.spec.ts` — the 6-law property wing: the contribution law, the clamp law, the fold law (order-independent values), the PIT marginal law (no absorbed residual), the EOSB tier law (the exact rational), the signed delta law) · the `payroll.statutory-summary` + `payroll.eosb-liability` report assertions (the reader-side re-checks + the block-on-fail exports) |

## Projects exactness (Blueprint v3.0 — PHASE-048)

| # | Invariant | Enforcement / tests |
|---|-----------|---------------------|
| INV-033 | Projects cost-rollup exactness (PHASE-048, migrations 0100–0104): **per project, AC = labor + materials + subcontractor + allocated overhead, reconciling to the GL project dimension TO THE CENT** — labor = the APPROVED `crm_time_entries` × employee cost rates on the WBS dimension (the payroll read-only feed, D-01; the rate SNAPSHOTTED AT VALUATION; an unset divisor = the explicit UNPRICED warning, never a fabricated rate); materials = the 044 WMS issue paths read-only (the MOVE's own value via the posting's project stamp; **graceful degrade when absent — an honest zero, never a fabricated one**); subcontractor = the APPROVED certificates' NETS (the sole actuals source — the AP linkage's GL leg lands EXACTLY the collector's read); overhead = the tenant-configured allocation driver (the pure fold; the allocation postings credit the CLEARING account, never the pool); **the typed reconciliation service REFUSES to report on any residual** (the INV-032(b) tolerance-0 spirit — the output carries the per-leg breakdown and the residual; a poisoned world is the typed refusal, never a green lie), re-asserted after EACH projects posting (the engines' own law) and at the reader (the `projects.evm-summary` report's `evm-ac-gl-tie` BLOCK-ON-FAIL check — a residual FAILs the tie with the engine's own legs in `compared` and blocks the export); the postings that carry NO project stamp (G-56/G-58/the IAS-23 capitalization — commercial revaluations, never project cost) are green by construction and checked anyway. | `ProjectsActualsService` (the four collectors) + `ProjectsReconciliationService` (the typed tie — `domain/projects-math.ts`, pure, no clock/store/I/O) · BR-092…BR-096 ([../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md)) · G-55…G-58 ([JOURNAL_RULES.md](JOURNAL_RULES.md) §7 — the stamp laws) · INV-033 suites (`__db__/projects/projects-budgets-actuals.db.spec.ts` — the coherent four-leg world 820.3125 + 500 + 9,000 + 625 = 10,945.3125 = the GL dimension EXACTLY, every GL side through the REAL PostingService, + four refusal arms; `__db__/projects/projects-goldens.db.spec.ts` — the INV-033 golden with the poisoned world's typed refusal carrying the FULL per-leg payload (all-zero legs vs the 0.0100 dimension, residual −0.0100); `__db__/projects/projects-reports.db.spec.ts` — the report-side `evm-ac-gl-tie` FAIL arm blocking the export on its own poisoned world) · the engine-side re-checks after each posting (the contracting/change-orders/ias23 specs' INV-033 pins) |

Definitions are canonical in [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §G (ED-13);
the INV-022 principle extends to them unchanged — no configuration, template, or entitlement
can disable or alter any invariant on this list. The golden postings that exercise them are
G-21…G-42 ([JOURNAL_RULES.md](JOURNAL_RULES.md) §7).

## Maintenance protocol

1. Adding an invariant: propose in a decision record (accounting/), add test-first, then
   enforcement, then update this file + [../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md).
2. Weakening/removing an invariant: requires product-owner decision record + ADR +
   migration plan (expected to never happen — these encode directive §5).
3. Every completion report must list which invariants gained new test coverage in the
   phase.
