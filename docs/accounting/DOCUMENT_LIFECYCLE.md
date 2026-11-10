# Document Lifecycle

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28

The unified state machine for business documents that carry financial/stock effects.
Applies to: sales invoices, credit notes, receipts, delivery notes, quotations, sales
orders, purchase orders, GRN, supplier invoices, debit notes, payments, stock
transfers/counts/adjustments, expenses, cash transfers, production orders. Variations per
type are noted below; any deviation requires a decision record.

From Blueprint v2.0 the machine also covers the financial-depth document types listed in §3
— depreciation runs, asset disposals and revaluations, notes, payroll runs, consolidation
eliminations — plus budget versions, which are explicitly **not** ledger documents (see
the note under §3).

## 1. Core state machine

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> PENDING_APPROVAL: submit (if approval policy applies)
  PENDING_APPROVAL --> APPROVED: approve
  PENDING_APPROVAL --> DRAFT: reject (with reason)
  DRAFT --> APPROVED: approve directly (policy: no approver required)
  APPROVED --> POSTED: post (assign official number + journals)
  DRAFT --> CANCELLED: cancel (before approval; audit-logged)
  PENDING_APPROVAL --> CANCELLED: cancel (permission + reason)
  POSTED --> REVERSED: reverse (creates counter-documents/journals)
  REVERSED --> [*]
  POSTED --> [*]
  CANCELLED --> [*]
```

## 2. State semantics (normative)

| State | Meaning | Editable? | Numbered? | Ledger effect |
|-------|---------|-----------|-----------|----------------|
| DRAFT | Work in progress | Yes (line-level) | No (temporary display id) | None |
| PENDING_APPROVAL | Submitted to approver(s) | No | No | None |
| APPROVED | Approved; awaiting posting | No | Reserved or assigned at approval (per numbering policy) | None |
| POSTED | Effective — immutable | **No — never** | Official number assigned (immutable) | Journals committed |
| REVERSED | Negated by a reversal document | No | Original number retained + reversal doc carries its own | Net zero (both visible) |
| CANCELLED | Abandoned before effect | No | Number voided/reserved forever (gap documented) | None |

**Rules:**

1. Approve → post may be one user action for low-risk documents (policy); the states are
   still distinct for audit, with auto-post recorded as `approved_by` vs `posted_by`
   (+policy flag).
2. Posted corrections are always **new documents** (credit/debit note, adjustment,
   reversal) referencing the original; never in-place edits (INV-003, INV-006).
3. `posted_at`, `posted_by`, `journal_entry_ids` are set by the posting transaction;
   `reversed_by_doc_id` links reversal pairs.
4. Official numbers are assigned at the moment the document becomes effective
   (approval-reserve or posting-assign, per tenant numbering policy) — gaps only via
   voided reservations, which stay queryable for audit (ADR-0006).
5. Every transition writes an audit event with before/after + reason (when applicable).

## 3. Per-type variations

| Document type | Variations |
|----------------|-----------|
| Quotation | No ledger path; states DRAFT → SENT → ACCEPTED(converts to order)/REJECTED/EXPIRED |
| Sales order | No ledger effect until delivery/invoice; may reserve stock (inventory hold) |
| Delivery note | POSTED issues stock (COGS journal) without AR; converts to invoice later |
| Sales invoice | Full chain per §1; cash invoices may auto-post on save (policy: `cash_sales_autopost`, default ON for POS) |
| Credit note | Must reference an invoice (or be standalone policy-flagged); reverses AR/revenue/VAT; returns re-enter stock at original issue cost |
| Receipt / Payment | DRAFT → POSTED (no approval by default; policy may add) — money moved must be final |
| Purchase order | DRAFT → ISSUED → (amendments as new revision linked) → CLOSED; GRN references |
| Goods receipt | POSTED receives stock + GRNI accrual |
| Supplier invoice | POSTED clears GRNI, posts AP; three-way match outcome recorded before approval |
| Debit note | Mirrors supplier invoice corrections |
| Stock transfer | DRAFT → IN_TRANSIT → POSTED (two-leg stock effect; in-transit visible, not sellable) |
| Stock count | DRAFT → COUNTED → VARIANCE_REVIEW → POSTED (adjustment journals) |
| Expense claim | DRAFT → PENDING_APPROVAL → APPROVED → POSTED (payout may be separate) |
| Cash transfer | DRAFT → POSTED |
| Production order | DRAFT → RELEASED → IN_PROGRESS → COMPLETED (post FG/WIP journals) / CANCELLED (before consumption) |
| Depreciation run (fixed_assets, PHASE-026) | DRAFT → POSTED; one journal per run, lines per asset (G-22); posts only via the run — no manual asset journals (BR-042); posted run immutable |
| Asset disposal (fixed_assets, PHASE-026) | DRAFT → POSTED (SALE/SCRAP); posts G-23 with the mandatory loss mirror; POSTED locks the asset — disposal once, only from ACTIVE/FULLY_DEPRECIATED (INV-023, BR-043) |
| Asset revaluation (fixed_assets, PHASE-026) | DRAFT → POSTED; optional and audited; delta posts to `REVALUATION_RESERVE` (BR-044) |
| Note — cheque / promissory note (notes, PHASE-027) | Event-driven custody states (IN_CUSTODY → ENDORSED_OUT / DEPOSITED → COLLECTED / DISHONORED / DISCOUNTED / RETURNED); journal only on the economic transitions per G-24…G-27 — endorsement and deposit move custody without a journal (BR-047); events are append-only (`note_events`) |
| Payroll run (payroll, PHASE-029) | DRAFT → PENDING_APPROVAL → POSTED; posts G-29; posted runs immutable — corrections are reversal + new run (INV-025); payout is a separate step (G-30) |
| Budget version (budgeting, PHASE-028) | DRAFT → PENDING_APPROVAL → ACTIVE → REVISED → CLOSED; **not a ledger document** — never produces a journal (advisory controls by default, BR-051); one ACTIVE version per (fiscal year, scope); revisions supersede, never edit (BR-050) |
| Consolidation elimination (consolidation, PHASE-034) | DRAFT → POSTED in the parent's consolidation books only (G-32; zero cross-tenant writes — [../architecture/ADR/ADR-0018-multi-entity-consolidation.md](../architecture/ADR/ADR-0018-multi-entity-consolidation.md)); after POSTED, corrections are reversal-only counter-entries (BR-056) |

**Blueprint v2.0 additions** (rows above, per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md)
§C/§H/§I): the financial-depth document types extend the core machine with the variations
shown; none of them relaxes §1/§2 (POSTED stays immutable; approval and audit rules
unchanged). **Budgets are explicitly not ledger documents** — no budget state transition
ever creates a journal entry; the budgeting status chain exists for approval and version
discipline only. Note custody transitions are driven by append-only `note_events`; only the
economically effective transitions post (G-24…G-27), so endorsement and deposit never touch
the ledger.

## 4. Offline interactions (summary — full matrix in
[../offline/OFFLINE_CAPABILITIES_MATRIX.md](../offline/OFFLINE_CAPABILITIES_MATRIX.md))

- Offline-created documents enter as `DRAFT` with client-generated UUIDv7 + local
  display number; the server owns approval/posting/numbering.
- Exception (POS sales, PHASE-016): offline terminal completes a sale locally with an
  **offline receipt number** (`OFF-…`); sync converts to a posted invoice with the
  official number recorded alongside; the offline number remains printed on that receipt
  for reconciliation. Local state shows "pending sync" honestly (ADR-0012).
- Rejected pushes (period locked, price changed beyond tolerance, credit limit) return
  the document to the device as actionable errors — never silently merged.

## 5. Status → UI mapping

Status badges, actions, and allowed transitions per state are part of the design system
document status component ([../ui/COMPONENT_CATALOG.md](../ui/COMPONENT_CATALOG.md));
the transition table above is the source of truth for the component's behavior map.
