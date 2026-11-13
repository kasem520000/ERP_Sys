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
