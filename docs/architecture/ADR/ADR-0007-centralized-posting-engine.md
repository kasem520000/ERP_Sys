# ADR-0007 — Centralized Posting Engine: the Only Writer of General-Ledger Data

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

Every financial operation (invoice, credit note, receipt, payment, expense, stock
adjustment, FX revaluation, production order) must affect the general ledger in exactly
one consistent way. Directive §5 forbids business modules from independently implementing
accounting logic: "Business modules must not independently implement incompatible
versions of accounting logic."

## Decision

A single **posting engine** domain service inside the `accounting` module is the **only**
code allowed to insert or update `journal_entries` and `journal_lines`. Business modules
never write GL tables; they call the posting engine with a **JournalSpec** — a typed
specification of intended postings — and the engine:

1. Resolves **account purposes** (e.g., `AR_CONTROL`, `VAT_PAYABLE`) to the tenant's
   actual accounts (see [../../accounting/CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md)).
2. Validates all invariants ([../../accounting/ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)):
   balanced debits/credits (per currency and in base currency), open fiscal period,
   postable leaf accounts, correct normal balance handling, document state prerequisites.
3. Executes document state transition + journal insert + subledger updates + audit event
   in **one database transaction**.
4. Is **idempotent** per document operation via posting-operation keys (e.g.,
   `sales_invoice:{id}:post`), so retries and duplicate sync deliveries cannot double-post.
5. Supports **reversal** (counter-entry linked to the original) as the only negation
   mechanism for posted entries; posted entries are never updated or deleted.

### JournalSpec contract (summary)

```ts
type JournalSpec = {
  source: { docType: DocumentType; docId: UUID; operation: PostingOperation };
  entryDate: CalendarDate; currency: CurrencyCode; exchangeRate?: decimal;
  lines: Array<{
    purpose: AccountPurpose | { accountId: UUID };
    direction: 'debit' | 'credit';
    amount: Money;              // document currency
    partnerId?: UUID; itemId?: UUID; costCenterId?: UUID;
    taxCodeId?: UUID; memo?: LocalizedText;
  }>;
};
```

Full specification: [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md).

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Each module posts its own journal rows | Guaranteed drift; audit impossible; violates directive §5. |
| Eventual/async posting (queue → ledger) | Loses atomicity between document and ledger; a posted invoice must ALWAYS have its journal in the same transaction. |
| Rules engine / configurable posting per tenant | Kept OUT of scope: posting templates are code + account purposes; tenant configuration selects accounts, not logic. Prevents "arbitrary configuration overriding accounting invariants" (directive §1.15). |

## Consequences

- One place to test accounting correctness; invariant tests target the engine plus each
  module's specs ([../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md)).
- Cross-module financial flows (invoice + stock + AR) compose as ONE engine call set
  inside one transaction, orchestrated by the owning module.
- Performance ceiling: all financial writes serialize through the engine — acceptable
  (engine work is pure validation + inserts, no remote calls).
- The engine has zero infrastructure dependencies (no HTTP, no queue) → unit-testable.

## Revisit triggers

- If posting throughput becomes a bottleneck, shard by tenant at the service level —
  the contract does not change.
