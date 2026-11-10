# Journal Rules

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-11-07

Rules governing manual journals, recurring entries, approvals, FX entries, and rounding
entries. Posted-entry mechanics (immutability, reversal) are defined in
[ACCOUNTING_PRINCIPLES.md](ACCOUNTING_PRINCIPLES.md) and [POSTING_ENGINE.md](POSTING_ENGINE.md);
this file covers the user-facing journal workflows.

## 1. Manual journal entries

1. Created by users with `accounting.journal_entries.create`; lines specify accounts
   (leaf), direction, amounts, optional partner/item/cost center/tax code and bilingual
   memo. Foreign-currency entries require a rate (from the rate table default or manual
   override, recorded).
2. **Save as draft** → submit → approval (per §3) → post via the posting engine
   (source: `journal_entry`). Draft journals may be edited/deleted before posting
   (audit-logged).
3. Templates: a journal can be saved as a **template** (line structure without amounts)
   for reuse; templates are documents, not postings.
4. **Constraints**: cannot post into locked periods (INV-011); cannot target group
   accounts (INV-004); AR/AP-control lines require a partner; balanced in both
   currencies (INV-001/002).

## 2. Recurring journal entries

1. Definition: template + schedule (monthly/weekly/custom), start/end dates, next-run
   date, amount policy (fixed amounts vs. re-enter at generation).
2. A scheduled job (pg-boss, ADR-0008) generates **draft** entries per schedule — never
   posts directly; approvals apply as normal. The job skips when: period locked
   (surfaces to notification), template inactive, or end date passed.
3. Generated entries reference the recurrence definition (`recurrence_id`) — editing a
   definition affects future generations only.

## 3. Approval workflow

1. Policies (per tenant, per document/journal type): none | single-approver |
   two-step | amount-threshold. Threshold rules compare **total base-currency amount**
   of the document.
2. Segregation of duties: the creator cannot approve their own document unless
   explicitly allowed by policy (`allow_self_approval`, default OFF) — enforced
   server-side (see [../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md)).
3. Approvers see the full document effect preview (expected journal lines) — generated
   by the same engine code that will post (no divergence between preview and posting).
4. Delegation & escalation (post-MVP): approver vacations handled by admin reassignment
   (audited), not silent auto-approval.

## 4. FX handling journals

1. **Rate source**: dated `exchange_rates` table (per currency, per date, editable by
   `accounting.multi_currency` permission); manual override at document level stored on
   the document and journal.
2. **Realized FX differences** post automatically at settlement: e.g., invoice at rate
   r1 (AR = 100 × r1 base), receipt later at r2 → base cash = 100 × r2; difference posts
   to `FX_GAIN`/`FX_LOSS` with the partner + original document references.
3. **Unrealized revaluation (optional run)**: dated procedure computing open-item
   revaluation at a chosen rate; posts a self-reversing (dated) adjusting entry pair;
   requires `accounting.multi_currency` + reports both pre/post views. Default OFF per
   tenant; runs are audited and reversible as a unit.
4. Rounding: per-currency minor units (e.g., KWD 3 decimals); residuals from
   document-level rounding post to `ROUNDING_GAIN`/`ROUNDING_LOSS` — never absorbed
   into revenue/tax silently (INV-007).

## 5. Corrective patterns

| Situation | Correct pattern |
|-----------|-----------------|
| Wrong amount, posted invoice | Credit note for the wrong portion + new invoice (or full reversal + reissue) |
| Wrong account, manual journal | Reversal entry with memo, then correct entry |
| Duplicate document | Reverse one; keep audit trail of both |
| Wrong period (unlocked) | Reverse + re-enter in correct period; if locked → period must be unlocked by authorized admin (audited, time-boxed) or correction posted in open period with memo |
| Wrong partner on invoice | Credit note + reissue (partner subledger must stay exact — INV-009) |

## 6. Journal metadata and reporting

- Every entry carries: entry no, date, period, source ref, description (bilingual),
  currency + rate, status, reversal links, created/by/agent, approved-by, posted-by,
  device/origin (web/desktop/POS/sync).
- GL listing and drill-down render from journal lines; filters mirror GL report
  parameters ([../reporting/REPORT_CATALOG.md](../reporting/REPORT_CATALOG.md)).
- Journal lines are **never edited**; corrections are new entries (INV-003/006).

## 7. Financial-depth postings (PHASE-026…029, 034 — Blueprint v2.0)

The golden postings below extend the posting canon for the v2.0 financial-depth modules —
fixed assets, notes & installments, payroll, and consolidation — per
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §F (ED-14). Each row is the **only**
canonical shape for its event: every posting goes through the engine with its registered
source/operation keys ([POSTING_ENGINE.md](POSTING_ENGINE.md) §4.1) under INV-013
idempotency, purposes resolve per [CHART_OF_ACCOUNTS.md](CHART_OF_ACCOUNTS.md) §2
(fail-closed on `PURPOSE_NOT_MAPPED`), and each row is mirrored by a golden test with a
mandatory failure pack ([../testing/ACCOUNTING_TESTS.md](../testing/ACCOUNTING_TESTS.md)
§3).

| # | Event (source module) | Posting shape (DR · CR) | Phase |
|---|------------------------|--------------------------|-------|
| G-21 | Asset capitalization (from GRN/purchase or direct) — `fixed_assets` | DR `FIXED_ASSET` (category account) · CR `AP_CONTROL` or `CASH` | PHASE-026 |
| G-22 | Monthly depreciation run — `fixed_assets` | DR `DEPRECIATION_EXPENSE` · CR `ACCUM_DEPRECIATION` (per category account; run = one journal, lines per asset) | PHASE-026 |
| G-23 | Asset disposal — sale above NBV (loss mirror mandatory) — `fixed_assets` | DR `CASH` (proceeds) · DR `ACCUM_DEPRECIATION` (accumulated) · CR `FIXED_ASSET` (cost) · CR `ASSET_DISPOSAL_GAIN` (residual); loss mirror posts `ASSET_DISPOSAL_LOSS` | PHASE-026 |
| G-24 | Note received into custody (against an invoice) — `notes` | DR `NOTES_RECEIVABLE` · CR `AR_CONTROL` (settles open item) | PHASE-027 |
| G-25 | Note collected at maturity (deposited) — `notes` | DR CASH/BANK · CR `NOTES_RECEIVABLE` | PHASE-027 |
| G-26 | Note dishonored (received note bounces) — `notes` | DR `AR_CONTROL` (restore open item) · CR `NOTES_RECEIVABLE`; any bank fee via existing `BANK_CHARGES` | PHASE-027 |
| G-27 | Note issued (to supplier) — `notes` | DR `AP_CONTROL` · CR `NOTES_PAYABLE`; paid-at-maturity mirror: DR `NOTES_PAYABLE` · CR CASH/BANK | PHASE-027 |
| G-28 | Installment late-fee posting — `installments` | DR `AR_CONTROL` · CR `LATE_FEE_INCOME` (per plan policy; only via engine) | PHASE-027 |
| G-29 | Payroll run posting — `payroll` | DR component expense accounts (`SALARIES_EXPENSE`, `EMPLOYER_CONTRIBUTIONS`, `EOS_PROVISION_EXPENSE`) · CR `SALARIES_PAYABLE` (net) · CR `DEDUCTIONS_PAYABLE` (third-party deductions) | PHASE-029 |
| G-30 | Payroll payout — `payroll` | DR `SALARIES_PAYABLE` · CR CASH/BANK | PHASE-029 |
| G-31 | EOS settlement at termination — `payroll` | DR `EOS_PROVISION` (provision balance) · CR `CASH` (settled) — residual to `EOS_PROVISION_EXPENSE` | PHASE-029 |
| G-32 | Consolidation elimination (intercompany AR/AP) — `consolidation` | DR `AP_CONTROL` (entity B intercompany) · CR `AR_CONTROL` (entity A intercompany) — posted in the parent's consolidation books only | PHASE-034 |

Notes:

1. Budgeting (PHASE-028) deliberately has **no** golden row — budgets are not ledger
   documents and never post a journal (BR-051; [DOCUMENT_LIFECYCLE.md](DOCUMENT_LIFECYCLE.md)
   §3).
2. Note custody is event-driven: journals post only on the economically effective
   transitions (collect/dishonor/return/discount, plus the initial recognition of G-24 and
   G-27); endorsement and deposit move custody without a journal (BR-047).
3. Depreciation posts only via runs — no manual asset journals (BR-042); payroll accounts
   post only via runs (BR-053); late fees post only via the engine (G-28).
4. Module invariants INV-023…INV-026 govern these rows
   ([ACCOUNTING_INVARIANTS.md](ACCOUNTING_INVARIANTS.md)); eliminations are reversible only
   by counter-entry (BR-056) and never write member books (ADR-0018).
5. **G-24…G-28 delivered mechanics (PHASE-027, migration 0038).** The note create
   journals (G-24 received / G-27 issued) are **BASE-denominated with explicit base line
   amounts** (the fx-settlement precedent — receipts post the same way): the GL is always
   base; document currencies enter via their stored rates. The allocated portion settles
   each open item at the **item's original stored rate** (INV-008) — for an allocated
   foreign note the note's stored rate must equal the item's (typed `NOTE_RATE_MISMATCH`
   otherwise; FX movement accrues to collection); the on-account portion (BR-027) posts at
   the note's own stored rate. The G-24/G-27 credit (debit for G-27) control lines carry
   the partner (INV-009(a)).
6. **FX residual at collection (G-25):** cash settles at the collection-day rate r₁ while
   the note leg derecognizes at the ORIGINAL stored rate r₀ — the residual is an explicit
   `FX_GAIN`/`FX_LOSS` line (the receipt G-06 mirror — never absorbed). The treasury money
   movement runs through the treasury store API with INV-019 exact and
   `cash_movements.source_type = 'note'`.
7. **Dishonor fee legs (G-26):** the optional bank fee posts `DR BANK_CHARGES · CR cash`
   plus a treasury movement OUT — the fee is explicit, never dropped; the reason is
   required (`DISHONOR_REASON_REQUIRED`, BR-046).
8. **Discounting (G-24 family) is base-currency-only this phase:** a foreign-currency note
   submitted for discount is rejected with typed `NOTE_DISCOUNT_CURRENCY_UNSUPPORTED` —
   the honest deferral (the phase pins no FX semantics for discounting; collect or return
   instead); documented in [TABLES/notes-installments.md](../database/TABLES/notes-installments.md).
9. **The repoint-restore algebra (G-26/RETURN):** dishonor/return restores the AR/AP open
   item **exactly** by repointing — the note's `treasury_allocations` rows are deleted and
   one consolidated row is inserted, anchored at the restore journal's control debit
   entry (required on the line by INV-009(a), anchored to outstanding 0). The ORIGINAL
   open item returns byte-equal while the new entry stays anchored, so aging never
   double-counts and `partner_balances` ties (INV-024). On-account notes have no
   allocations to repoint — the restore lands a new explicit open item.
10. **INV-013 source keys (lowercase snake_case per §4.1):** `note/post` (G-24/G-27
    create), `note/collect` (G-25 + the issued paid mirror), `note/dishonor`,
    `note/discount`, `note/return`, and `installment_line/late_fee` (G-28 — once per
    line). Every journal goes through the engine with the standard failure packs
    (`PERIOD_LOCKED`, `PURPOSE_NOT_MAPPED`, `ALREADY_POSTED`, zero residue); INV-024 and
    RC-11 (the notes register↔GL reconciliation, kind `NOTES`) are enforced and tested
    ([ACCOUNTING_INVARIANTS.md](ACCOUNTING_INVARIANTS.md) INV-024;
    [RECONCILIATION.md](RECONCILIATION.md) §1 row 11).

