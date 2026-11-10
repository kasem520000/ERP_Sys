# ACCOUNTING_ENGINE_SPECIFICATION — Double-Entry Core, Posting, and Financial Integrity

> **Status:** STABLE · **Owner:** Accounting Architecture · **Updated:** 2026-10-28 (consolidation pass)
> **Authority:** Consolidates the accounting rules. Normative detail remains in
> [ACCOUNTING_PRINCIPLES.md](ACCOUNTING_PRINCIPLES.md), [POSTING_ENGINE.md](POSTING_ENGINE.md),
> [ACCOUNTING_INVARIANTS.md](ACCOUNTING_INVARIANTS.md), [JOURNAL_RULES.md](JOURNAL_RULES.md),
> [CHART_OF_ACCOUNTS.md](CHART_OF_ACCOUNTS.md), [DOCUMENT_LIFECYCLE.md](DOCUMENT_LIFECYCLE.md),
> [PERIOD_CLOSING.md](PERIOD_CLOSING.md), [RECEIVABLES_AND_PAYABLES.md](RECEIVABLES_AND_PAYABLES.md),
> [INVENTORY_ACCOUNTING.md](INVENTORY_ACCOUNTING.md), [RECONCILIATION.md](RECONCILIATION.md).

## 1. Double-entry model

- `journal_entries` (1) → `journal_lines` (n); each line: account, direction
  (`DEBIT`/`CREDIT`), `amount > 0` (DB CHECK; sign lives in direction), document currency +
  stored FX rate + `base_amount`, optional `partner_id` (mandatory on AR/AP control lines),
  `tax_snapshot` reference.
- **A posted entry always balances** (ΣDr = ΣCr in document and base currency): enforced
  three ways — posting-engine validation #7 (INV-001/002), the **deferred DB constraint
  trigger** at commit (DEF-010), and the golden-test battery.
- Lines are one-sided by CHECK (`debit XOR credit` semantics via direction + positive amount).
- Manual journals require an explicit `manual` flag + approval (INV-003 class); no
  journal exists without a source document or that flag.

## 2. Posting engine (the only GL writer)

Contract, 8-step validation pipeline, typed error taxonomy, canonical 20-operation map:
[POSTING_ENGINE.md](POSTING_ENGINE.md). Key properties:

1. **Idempotency is structural:** `UNIQUE (tenant_id, source_type, source_id, operation)`
   — replays/duplicate sync deliveries return the original result (INV-013).
2. **Atomicity:** document state change + subledger rows + stock layers + tax summary +
   journal + audit event commit in **one transaction**; failures leave zero residue
   ("zero ledger residue" is a first-class test standard — [../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md) §1).
3. **Reversals mirror exactly, at most once**, via linked `reversal_of` documents
   (INV-014 class); posted rows are immutable.
4. **Purposes, not hard-coded accounts:** the engine resolves account **purposes**
   (`AR_CONTROL`, `VAT_PAYABLE`, `CASH`, `OPENING_EQUITY`, …) to tenant accounts via the
   one-active-account-per-purpose mapping and fails closed (`PURPOSE_NOT_MAPPED`) — never
   posts to a fallback. Canonical registry: [CHART_OF_ACCOUNTS.md](CHART_OF_ACCOUNTS.md) §2
   (DEF-006 aligned: golden tests seed exactly these keys).
5. **Effect-matrix gate (adopted from Folder 1):** every NEW operation must complete a
   seven-way effect matrix row — doc state, inventory, AR/AP, cash/bank, GL, tax, audit —
   before implementation approval ([POSTING_ENGINE.md](POSTING_ENGINE.md) §4 extension gate).

## 3. Invariants

22 numbered invariants INV-001…INV-022 with per-invariant enforcement layers and named
tests: [ACCOUNTING_INVARIANTS.md](ACCOUNTING_INVARIANTS.md). Notable:

- **INV-022 (configuration cannot override accounting):** the config-fuzz suite runs 50
  entitlement/template/flag permutations and requires byte-identical journals.
- Subledger ties: AR/AP partner sums == control accounts (INV-009 class), inventory
  layers == inventory control (INV-010 class) — continuously reconciled, drift = SEV-1
  ([../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) §1).

## 4. Document lifecycle (unified)

```
DRAFT → PENDING_APPROVAL → APPROVED → POSTED → (REVERSED by linked credit/debit note)
                (policy may skip stages; approval thresholds per role/limits)
```
- Official document numbers are allocated at **approval-reserve or posting** per policy
  (BR-029), immutable once assigned; voided numbers stay reserved (INV-021).
- Posted documents are never edited; corrections are new reversal documents.
- Full transition matrix + per-document financial effects:
  [DOCUMENT_LIFECYCLE.md](DOCUMENT_LIFECYCLE.md).

## 5. Periods, closing, year-end

Fiscal years → non-overlapping periods (DB `EXCLUDE`); posting into LOCKED periods is
rejected (INV-011 class); soft-close vs hard-lock; year-end closing entry posts through
the engine (revenue/expenses → CLOSING → RETAINED_EARNINGS), idempotent, reversible as a
unit; period reopen is a rare, elevated, audited action with anti-fraud alert when
older than 2 months ([PERIOD_CLOSING.md](PERIOD_CLOSING.md)).

## 6. Money, FX, and rounding

- Storage/transport per [../architecture/ADR/ADR-0009-money-precision.md](../architecture/ADR/ADR-0009-money-precision.md)
  (as corrected by DEF-001); rounding: half-up at currency minor units per line, per tax
  code; document totals = Σ rounded lines; FX converts at final posting step; realized
  FX gain/loss posts explicitly on settlement; unrealized via dated revaluation run.
- Rounding residuals (FX/tax-only cases) post to `ROUNDING_GAIN`/`ROUNDING_LOSS`
  purposes — **never dropped**. Worked examples W-1/W-2/W-3
  ([../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md) §3) are the canonical
  numeric reference, including the explicit FX residual line.

## 7. Inventory costing

Per-tenant policy: **WAC default** or FIFO (locked once transactions exist); cost layers
at 6-dp internal precision; COGS at issue; returns consume original layers when
traceable; landed costs into layer cost (PHASE-011); **costing is decoupled from picking**
(FEFO/serial/IMEI picking changes which units move, never the valuation math —
[INVENTORY_ACCOUNTING.md](INVENTORY_ACCOUNTING.md) §5, consolidated from Folder 4).
Negative stock requires explicit audited tenant opt-in.

## 8. Authoritative balances (no competing sources of truth)

| Balance | Source of truth |
|---------|-----------------|
| GL account balances | `journal_lines` (posted only) |
| AR/AP per partner | partner subledger rows (reconciled to control accounts, INV-009 class) |
| Stock on hand / value | `stock_layers` + `item_stock` (reconciled to inventory control) |
| Cash/bank | GL cash accounts themselves (cash accounts ARE GL accounts) |
| Tax liabilities | per-treatment tax summaries (reconciled to VAT purposes) |

Reports must compute from these sources or tie to them via assertions
([../reporting/REPORT_RECONCILIATION.md](../reporting/REPORT_RECONCILIATION.md));
stored aggregates are caches and are rebuildable on demand.

## 9. Corrections and error handling

Erroneous postings: reversal document (mirror), never un-post; reconciliation failures
are SEV-1 incidents with a defined investigation workflow
([RECONCILIATION.md](RECONCILIATION.md), [../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) §1).
Jurisdiction-dependent treatments (e.g., VAT on returns) are pack configuration, never
engine hard-coding — unknown cases fail closed and are escalated, never guessed
([../localization/TAX_ENGINE.md](../localization/TAX_ENGINE.md)).

## 10. Opening balances and historical migration

Opening-balance drafts post against the OPENING period with per-partner/per-item detail
(subledgers and stock layers populated from entry #1 — INV-009/010 class hold from the
first entry); the balancing line targets `OPENING_EQUITY` (purpose added by DEF-006).
Bulk historical-migration tooling is a PHASE-006 import concern with its own acceptance
tests; migrated data is never marked POSTED without passing the invariant battery.
