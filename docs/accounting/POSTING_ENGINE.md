# Posting Engine

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28

The single domain service that turns business operations into ledger effects
([ADR-0007](../architecture/ADR/ADR-0007-centralized-posting-engine.md)). Lives in the
`accounting` module, depends on no infrastructure, and is the **only** writer of
`journal_entries`/`journal_lines`.

## 1. Service contract

```ts
interface PostingEngine {
  /** Post a journal specification as part of the caller's transaction. */
  post(spec: JournalSpec, ctx: TenantContext): Promise<PostingResult>;
  /** Reverse a posted entry with a reason; creates the counter-entry. */
  reverse(input: ReverseInput, ctx: TenantContext): Promise<PostingResult>;
  /** Check whether a date is postable (open period) without posting. */
  isDatePostable(date: CalendarDate, ctx: TenantContext): Promise<boolean>;
}

type JournalSpec = {
  source: { docType: DocumentType; docId: UUID; operation: string };  // e.g. 'post' | 'reverse' | 'fx_diff'
  entryDate: CalendarDate;            // posting date (defaults to document date; validated)
  description: LocalizedText;
  reference?: string;                 // official doc number once assigned
  currency: CurrencyCode;             // document currency
  exchangeRate?: decimal;             // required if currency ≠ base; stored on entry
  lines: JournalLineSpec[];           // 2..N, at least one debit and one credit
  idempotencyKey: string;             // posting-operation key, unique per (tenant, source)
};

type JournalLineSpec = {
  purpose?: AccountPurpose;           // OR explicit:
  accountId?: UUID;                   // direct account (manual journals)
  direction: 'debit' | 'credit';
  amount: Money;                      // document currency, > 0
  partnerId?: UUID;                   // AR/AP subledger lines must carry partner
  itemId?: UUID; costCenterId?: UUID;
  projectId?: UUID;                   // PHASE-019 projects dimension stamp — unknown → PROJECT_NOT_FOUND, non-OPEN → PROJECT_CLOSED (account-resolution stage)
  taxCodeId?: UUID;                   // tax-effect lines carry the tax code
  memo?: LocalizedText;
};
```

**Result**: `{ journalEntryId, entryNo, lines: [{lineNo, accountId, debit, credit, baseAmount}] }`
— errors are typed (`PostingError` codes below), never strings.

## 2. Validation pipeline (in order; first failure aborts)

1. **Idempotency check**: existing entry for `(tenant, source.docType, source.docId,
   source.operation)`? → return the stored result (INV-013). No new entry.
2. **Schema-level**: 2+ lines, ≥1 debit, ≥1 credit, all amounts > 0.
3. **Currency/FX**: currency exists; if ≠ base, rate required and > 0; compute base
   amounts; **balance must hold in base currency** (line-level FX rounding may not
   create drift — the caller must pre-balance; engine verifies).
4. **Period check**: `entryDate` in an OPEN fiscal period (INV-011); rejected if
   soft-closed-with-hard-rules or locked.
5. **Account resolution**: purposes → active account mappings; accounts are postable
   leaves (INV-004), active, currency-compatible (INV-005).
6. **Subledger consistency**: lines hitting AR/AP control purposes MUST carry a
   `partnerId` (INV-009); tax lines carry `taxCodeId`.
7. **Balanced entry**: Σdebit = Σcredit in document currency AND base currency (INV-001,
   INV-002), within 0 tolerance (rounding residuals must be explicit lines).
8. **Write phase**: insert journal entry (`POSTED` — no intermediate ledger state;
   approval happened on the document) + lines + audit event; update source document
   status/`postedJournalId`; write subledger rows (module-owned, in same transaction).

Reversal: loads original (must be `POSTED`, not already reversed — INV-014), creates a
counter-entry with mirrored directions (same accounts/partners/items; new entry date ≤
today and in an open period; rate = original rate for the same-currency reversal),
links `reversal_of_id`/`reversed_by_id`, marks original `REVERSED` (still counted in
history; net effect zero).

## 3. Error taxonomy (stable codes, localized messages)

| Code | Meaning |
|------|---------|
| `ENTRY_NOT_BALANCED` | INV-001/002 failure |
| `PERIOD_LOCKED` / `PERIOD_NOT_FOUND` | INV-011 failure |
| `ACCOUNT_NOT_POSTABLE` / `ACCOUNT_ARCHIVED` | group node / archived target |
| `CURRENCY_MISMATCH` | INV-005 failure |
| `PURPOSE_NOT_MAPPED` | required purpose has no account mapping — fail closed |
| `MISSING_PARTNER_ON_CONTROL` | AR/AP line without partner |
| `MISSING_FX_RATE` | foreign currency without rate |
| `ALREADY_POSTED` / `ALREADY_REVERSED` | INV-013/014 |
| `INVALID_AMOUNT` | ≤ 0 or non-decimal |

## 4. Posting rules by operation (canonical map)

| Operation (module) | Journal effect (debit / credit) |
|--------------------|----------------------------------|
| **Sales invoice — credit** (sales) | DR AR control (partner) · CR sales revenue (net) · CR VAT payable (per treatment) |
| **Sales invoice — cash** | DR cash/bank account · CR revenue · CR VAT payable |
| **Sales invoice — COGS** (with goods) | DR COGS · CR inventory (valuation at issue) |
| **Job-card invoice** (sales, PHASE-017) | Settlement as the sales-invoice rows above with **two revenue natures** — CR sales revenue (parts) · CR service revenue (labor, `SERVICE_REVENUE` 4200) · CR VAT payable per treatment; COGS under the `reserve` policy rides the invoice's own COGS row (flow B) |
| **Job-card parts issue — at approval** (sales, PHASE-017; source `job_card:issue_parts`) | DR COGS · CR inventory (valuation at issue) — the `issue_immediate` policy posts parts cost when the card is approved; the card's invoice then posts settlement only (no second COGS) |
| **Commission accrual** (sales, PHASE-017; source `commission_run:accrual` at run post) | DR commissions expense (`COMMISSION_EXPENSE`, 5250 — one line per earning rep) · CR accrued commissions (`COMMISSION_ACCRUAL`, 2150 — the run total); entry dated `period_to` (matching principle); never modifies an invoice or its VAT |
| **Credit note** (sales) | Mirror of invoice (incl. stock re-entry at original cost for returns; discounts contra) |
| **Receipt from customer** (treasury) | DR cash/bank · CR AR control (partner); FX difference on settlement → FX_GAIN/LOSS |
| **Purchase — GRN** (purchasing) | DR inventory (or expense/asset account) · CR GRNI accrual (until supplier invoice) |
| **Supplier invoice** (purchasing) | DR inventory/expense · DR VAT recoverable (if eligible) · CR AP control (partner); clears GRNI |
| **Debit note** (purchasing) | Mirror of supplier invoice adjustment |
| **Payment to supplier** (treasury) | DR AP control · CR cash/bank; FX difference as above |
| **Expense** (treasury) | DR expense account (+ VAT recoverable where eligible) · CR cash/bank/petty |
| **Cash transfer** (treasury) | DR destination cash · CR source cash (+ bank charges expense) |
| **Rep settlement — variance** (distribution, PHASE-017; source `rep_settlement:variance`) | DR cash-difference expense (`CASH_DIFFERENCE`) · CR rep cash account (shortage); surplus mirrors (DR rep cash · CR cash difference) — variance ALWAYS posts with a reason (BR-021 family), never nets; zero variance posts nothing |
| **Rep settlement — bank deposit** (distribution, PHASE-017; source `rep_settlement:deposit`) | DR bank account · CR rep cash account — the day's counted cash moved to the bank; money legs mirrored on `cash_movements` (INV-019) |
| **Stock adjustment — loss** (inventory) | DR shrinkage expense · CR inventory |
| **Stock adjustment — gain** (inventory) | DR inventory · CR appreciation account |
| **Stock transfer between valuation accounts** | DR inventory (dest. account) · CR inventory (source account) — only when branches map distinct accounts |
| **Opening balances** | Declared balances entry (DR customers/inventory/cash · CR suppliers/capital) with per-partner/per-item detail on subledgers |
| **Production order — consumption** (manufacturing, PHASE-018; source `production_order:consume`) | DR WIP (`WIP`, 1160 — purpose-mapped, fails closed `PURPOSE_NOT_MAPPED`) · CR inventory (the materials-warehouse account, per `resolveInventoryAccount`) at **actual issue cost per batch**; one journal per consume call; stock moves `planIssue`/`applyIssue` with `sourceType:"production_order"` (INV-018 atomic) |
| **Production order — completion** (manufacturing, PHASE-018; source `production_order:complete`) | DR finished goods inventory (the FG-warehouse account; FG receipt into a new batch, expiry = completedAt + `items.shelf_life_days` when the policy is on) · CR WIP (the consumed-materials value) · [CR applied production labor (`PRODUCTION_LABOR`, 5410) · CR applied production overhead (`PRODUCTION_OVERHEAD`, 5420) when the order's rates > 0 — absorbed in this single completion journal, no separate absorption entry]; FG unit cost = fgValue / actualQty (6dp); per-order WIP nets to **exactly zero** |
| **Production order — scrap (pre-completion)** (manufacturing, PHASE-018; source `production_order:scrap`) | DR production scrap expense (`PRODUCTION_SCRAP`, 5120) · CR WIP — user-entered value ≤ the order's current WIP balance, reason code required by policy; **no stock move** (the goods already left stock at consumption) |
| **QC-fail scrap of quarantined FG (post-completion)** (manufacturing, PHASE-018; source `production_order:qc_scrap`) | DR production scrap expense (`PRODUCTION_SCRAP`, reason `QC_FAILED`) · CR finished-goods inventory account — WIP is already zero at completion, so the credit is the FG warehouse account; the goods physically leave the FG warehouse (stock issue move of the whole remaining quarantined batch) |
| **Contract advance — reclass at tagging** (crm, PHASE-019; source `contract_advance:defer`, policy `crm.defer_advance_recognition` ON) | DR AR control (partner, project-stamped) · CR deferred revenue (`DEFERRED_REVENUE`, 2130) for the tagged amount — moves the on-account credit into the liability; the AR line's subledger debit row nets the receipt's credit row (INV-009 holds); policy OFF = link-only (stays a plain on-account credit, BR-027 pure) |
| **Contract advance — release at invoice posting** (crm, PHASE-019; source `contract_advance:release`, fired by the contract-billing port in the same posting UoW) | DR deferred revenue (`DEFERRED_REVENUE`) · CR AR control (partner, project-stamped) for the released amount — the AR credit line's subledger row is ALLOCATED to the contract invoice (the advance application); invoice open = gross − released; revenue is recognized ONLY by the invoice journal in the billed period (never a second time by the release) |
| **FX revaluation run** (optional, dated) | DR/CR FX gain/loss vs revalued AR/AP/cash lines |
| **Year-end close** (accounting) | DR revenue accounts · CR closing; DR closing · CR expense accounts; net → retained earnings |
| **Asset capitalization** (fixed_assets, PHASE-026) | DR fixed-asset account (`FIXED_ASSET`, per category) · CR AP control or cash (G-21) |
| **Depreciation run** (fixed_assets, PHASE-026) | DR depreciation expense (`DEPRECIATION_EXPENSE`) · CR accumulated depreciation (`ACCUM_DEPRECIATION`) — per category account; one journal per run, lines per asset (G-22; runs only — no manual asset journals, BR-042) |
| **Asset disposal** (fixed_assets, PHASE-026) | DR cash (proceeds) · DR accumulated depreciation (`ACCUM_DEPRECIATION`) · CR fixed-asset account (cost) · CR disposal gain (`ASSET_DISPOSAL_GAIN`) — loss mirror via `ASSET_DISPOSAL_LOSS` mandatory (G-23) |
| **Asset revaluation** (fixed_assets, PHASE-026) | Revaluation delta posts against the revaluation reserve (`REVALUATION_RESERVE`) — optional, audited (BR-044) |
| **Note events** (notes, PHASE-027) | Received into custody: DR notes receivable (`NOTES_RECEIVABLE`) · CR AR control (G-24) · collected: DR cash/bank · CR notes receivable (G-25) · dishonored: DR AR control · CR notes receivable, bank fee via `BANK_CHARGES` (G-26) · issued: DR AP control · CR notes payable (`NOTES_PAYABLE`); paid at maturity: DR notes payable · CR cash/bank (G-27) · return/discount post their economic effect (discount charge via `NOTES_DISCOUNT_EXPENSE`); endorse/deposit move custody without a journal (BR-047) |
| **Installment late fee** (installments, PHASE-027) | DR AR control · CR late-fee income (`LATE_FEE_INCOME`) — per plan policy, engine-only (G-28) |
| **Payroll run posting** (payroll, PHASE-029) | DR component expenses — salaries (`SALARIES_EXPENSE`), employer contributions (`EMPLOYER_CONTRIBUTIONS`), EOS accrual (`EOS_PROVISION_EXPENSE`) · CR salaries payable (`SALARIES_PAYABLE`, net) · CR third-party deductions payable (`DEDUCTIONS_PAYABLE`); posted runs immutable (G-29, INV-025) |
| **Payroll payout** (payroll, PHASE-029) | DR salaries payable (`SALARIES_PAYABLE`) · CR cash/bank (G-30) |
| **EOS settlement** (payroll, PHASE-029) | DR EOS provision (`EOS_PROVISION`) · CR cash (settled) — residual to EOS provision expense (`EOS_PROVISION_EXPENSE`) (G-31) |
| **Consolidation elimination** (consolidation, PHASE-034) | DR AP control (entity B intercompany) · CR AR control (entity A intercompany) — balanced journal in the parent's consolidation books only; zero member-book writes (G-32, INV-026) |

Every rule above is mirrored by a test fixture with **expected journal entries** (see
[../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md)).

**Extension gate (adopted from Folder 1):** every NEW posting operation added by a future
phase MUST complete a seven-way **effect matrix** row before implementation is approved —
(1) source-document state transition, (2) inventory/stock effect, (3) AR/AP subledger
effect, (4) cash/bank effect, (5) GL journal lines (the row of the table above),
(6) tax snapshot/summary effect, (7) audit event(s). The row is reviewed by the phase's
code review ([../implementation/templates/CODE_REVIEW_TEMPLATE.md](../implementation/templates/CODE_REVIEW_TEMPLATE.md)),
and the operation's G-scenario in the golden-test battery must assert all seven cells
(postconditions, not just journal lines). An operation whose matrix row cannot be
completed is not fully specified and may not ship.

### 4.1 Source registrations — Blueprint v2.0 financial depth (PHASE-026…029, 034)

The v2.0 modules register their sources below (per
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §F/§O.2 — additive; every v1.1 source
above is untouched). They post exactly like v1.1 sources — `PostingEngine.post` with
`source: { docType, docId, operation }` and INV-013 idempotency — and each owning module
writes its subledger rows in the same transaction (INV-006/INV-018 discipline). Every
registration completes the seven-way effect matrix required by the Extension gate above
and is mirrored by golden tests G-21…G-32 with mandatory failure packs
([../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md) §3); the canonical posting
shapes are normative in [JOURNAL_RULES.md](JOURNAL_RULES.md) §7.

| Source type (`source.docType`) | Module owner | Operation keys | Canonical effect |
|--------------------------------|--------------|----------------|------------------|
| `FIXED_ASSET_CAPITALIZATION` | fixed_assets (PHASE-026) | `post` | Asset capitalization — G-21 |
| `DEPRECIATION_RUN` | fixed_assets (PHASE-026) | `post` | Depreciation run — G-22 |
| `ASSET_DISPOSAL` | fixed_assets (PHASE-026) | `post` | Asset disposal with mandatory loss mirror — G-23 |
| `ASSET_REVALUATION` | fixed_assets (PHASE-026) | `post` | Revaluation delta to `REVALUATION_RESERVE` (BR-044) |
| `NOTE_EVENT` | notes (PHASE-027) | `receive` · `issue` · `collect` · `dishonor` · `return` · `discount` · `settle` | Note journals per G-24…G-27; endorse/deposit/reclassify events are custody-only — no journal (BR-047) |
| `INSTALLMENT_LATE_FEE` | installments (PHASE-027) | `post` | Late fee per plan policy — G-28 |
| `PAYROLL_RUN` | payroll (PHASE-029) | `post` · `payout` | Payroll run posting — G-29; payroll payout — G-30 |
| `EOS_SETTLEMENT` | payroll (PHASE-029) | `post` | EOS settlement with residual — G-31 |
| `CONSOLIDATION_ELIMINATION` | consolidation (PHASE-034) | `post` | Elimination in the parent's consolidation books only — G-32 |

The `budgeting` module (PHASE-028) intentionally registers **no** source type: budgets are
not ledger documents (advisory controls only, BR-051 — see
[DOCUMENT_LIFECYCLE.md](DOCUMENT_LIFECYCLE.md) §3).

## 5. Sequencing example (credit invoice with goods)

```
transaction:
  salesInvoice.approve()
    ├─ inventory.issueStock()        → stock_moves rows
    ├─ PostingEngine.post(cogsSpec)   → COGS/inventory journal
    ├─ taxEngine.stamp(doc)           → tax summary on document
    ├─ PostingEngine.post(arSpec)     → AR/revenue/VAT journal
    ├─ partners.addSubledgerEntries() → invoice rows on partner ledger
    └─ audit.record(...)             → audit_events
  COMMIT
```

Partial failure ⇒ full rollback; the document remains in its prior state with the
typed error surfaced.

## 6. Performance and concurrency

- Idempotency via unique index `(tenant_id, source_type, source_id, operation)` —
  concurrent duplicate posts serialize on insert conflict and return the existing entry.
- Entry numbering: per-tenant sequence (`JE-{yyyy}-{seq:6}`) assigned inside the
  transaction; contention is per-tenant only.
- All queries index on `(tenant_id, entry_date)` / `(tenant_id, account_id)`.

## 7. Out of scope (explicit)

- No user-defined posting formulas ("scriptable accounting") — purposes + module rules
  only (directive §1.15).
- No posting outside open periods, including "temporary" entries.
- No direct API to insert journal lines — even manual journals go through the engine's
  `post()` with source `journal_entry` (user-created, approval-gated).
