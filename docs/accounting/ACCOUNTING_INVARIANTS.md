# Accounting Invariants

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-11-07

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

Definitions are canonical in [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §G (ED-13);
the INV-022 principle extends to them unchanged — no configuration, template, or entitlement
can disable or alter any invariant on this list. The golden postings that exercise them are
G-21…G-32 ([JOURNAL_RULES.md](JOURNAL_RULES.md) §7).

## Maintenance protocol

1. Adding an invariant: propose in a decision record (accounting/), add test-first, then
   enforcement, then update this file + [../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md).
2. Weakening/removing an invariant: requires product-owner decision record + ADR +
   migration plan (expected to never happen — these encode directive §5).
3. Every completion report must list which invariants gained new test coverage in the
   phase.
