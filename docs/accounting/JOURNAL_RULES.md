# Journal Rules

> **Status:** STABLE · **Owner:** Accounting Domain Architecture · **Updated:** 2026-11-12 (PHASE-039 — goldens G-35…G-39, migrations 0055–0059 · PHASE-042 — goldens G-40…G-42, migrations 0065–0066 · PHASE-044 — goldens G-43…G-46, migrations 0067–0073)

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
| G-33 | Supplier advance disbursement + application — `purchasing` | DISBURSE: DR `ADVANCES_TO_SUPPLIERS` (the tenant-mapped control — `purchasing.supplier_advance_control_account`; fail-closed when unmapped) · CR CASH/BANK (the treasury movement, base at rate 1 — the G-30 pattern) · APPLY: DR `AP_CONTROL` (partner-stamped) · CR `ADVANCES_TO_SUPPLIERS` | PHASE-038 |
| G-34 | Early-payment discount capture — `purchasing` | DR `AP_CONTROL` (the discount share, partner-stamped — paid net early) · CR the tenant-mapped discount-income account (`purchasing.early_discount_income_account`; fail-closed when unmapped) — within the approved terms' window only (SoD: terms creator ≠ approver) | PHASE-038 |
| G-35 | RMA restock — the return-to-stock completion — `sales` | The RMA's INV-013 source family is `return_authorization:{id}:restock|scrap|refund` (migration 0055); the delivered RESTOCK leg posts **no separate journal** — completion drives the credit note create → approve → post in-transaction and re-shelves through the CN's OWN re-entry leg (`credit_note:{id}:reentry`): DR `INVENTORY` · CR `COGS` at the ORIGINAL issue cost snapshotted on the invoice line (W-3 — never a current-average recompute; batch preserved, the originally sold serial re-shelves, BR-017/BR-018); the RMA stamps the CN's journal + entry_no | PHASE-039 |
| G-36 | RMA scrap write-off — `sales` | DR the tenant-mapped scrap-loss account (`sales.scrap_loss_account`; fail-closed `SCRAP_LOSS_ACCOUNT_UNMAPPED` — the RMA stays INSPECTED, zero partial writes) · CR `COGS` at Σ qty × ORIGINAL issue cost (source `return_authorization:{id}:scrap`); the completion CN issues with re-entry SUPPRESSED — the goods never re-shelve; non-stock lines carry no cost (a zero-value scrap skips the journal) | PHASE-039 |
| G-37 | RMA refund — the cash-out leg — `sales` | DR `AR_CONTROL` (partner — reversing the CN's credit) · CR the refund cash account (source `return_authorization:{id}:refund`, at the CN's gross; the cash account is required at completion — fail-closed) + the treasury money movement OUT (`cash_movements.source_type = 'return_authorization'`, base at rate 1 — the G-33 disbursement pattern); the CN still re-enters stock exactly like G-35 (a refund puts the goods back) | PHASE-039 |
| G-38 | Supplier-return credit — the AP debit note — `purchasing` | SHIP (source `supplier_return_authorization:{id}:ship`): ONE inventory journal DR the tenant-mapped purchase-returns account (`purchasing.supplier_return_account`; fail-closed when unmapped) · CR `INVENTORY` at issue cost — the goods leave through the movement engine (no-negative-stock applies), the stock-move issues riding the generic `manual_issue` source with reason `SUPPLIER_RETURN` and source_id = the SRMA (the documented CHECK-domain deviation — 0059 did not widen the stock_moves source CHECK). CREDIT (source `supplier_return_authorization:{id}:credit`): DR `AP_CONTROL` (supplier, net) · CR the same mapped returns account (net — no VAT legs on a return credit); at cost == price the two journals net the returns account to zero, any cost/value difference stays in it (its documented purpose). The DN document is created + stamped POSTED against this journal in the same transaction — 0059's lifecycle CHECK requires `debit_note_id` at CREDITED (`debit_notes.ref_invoice_id` anchors it to the PO's earliest POSTED supplier invoice) | PHASE-039 |
| G-39 | Collection-agency commission at settlement — `sales` | DR the tenant-mapped collection-commission expense (`sales.collection_commission_account`; fail-closed `COMMISSION_ACCOUNT_UNMAPPED` — zero partial writes) · CR `AP_CONTROL` on the AGENCY's partner (source `collection_referral:{id}:commission`, posted exactly once at settlement); commission = PCT_OF_COLLECTED ? settled × pct/100 (4dp) : the flat fee — over the referral's snapshotted terms, never the register's live ones | PHASE-039 |
| G-40 | Operation completion — the conversion roll-up into WIP — `manufacturing` | Source `production_order`, operation `op_<seq>` (one journal per routing sequence, migration 0065): DR `WIP` (the conversion total — the typed sum of the two credit legs) · CR `PRODUCTION_LABOR` ((actual setup + run hours) × the FROZEN var rate) · CR `PRODUCTION_OVERHEAD` ((actual setup + run hours) × the FROZEN fixed rate) — the rates snapshot at release from the routing's per-operation overrides ?? the work center (later routing/work-center edits never move a live order, BR-068); a zero leg is skipped, an entirely uncosted operation (both legs 0) records its times WITHOUT a journal, and the credit sum MUST equal the debit at 4dp (typed `OPERATION_COST_ROUNDING` — rounding residuals explicit, never absorbed); the completion also stamps the per-operation setup/usage/rate variance columns (BR-071) | PHASE-042 |
| G-41 | Rework completion — the rework conversion roll-up — `manufacturing` | Source `rework_order`, operation `complete`: DR `REWORK_EXPENSE` (the rework roll-up = labor + overhead at the rework's frozen rates × actual setup + run hours) · CR `PRODUCTION_LABOR` · CR `PRODUCTION_OVERHEAD` — NEVER the parent FG layer (BR-069: the parent order's fg/wip/labor/overhead columns stay byte-identical before/after — pinned by the rework-costing db spec); a zero-conversion completion is the typed `REWORK_COST_ZERO` rejection (a rework that cost nothing did not happen); the COMPLETED row carries `rework_value > 0` + its `journal_id` (the `ck_rework_orders_completion` floor) | PHASE-042 |
| G-42 | Downtime close — the policy-gated non-value posting — `manufacturing` | Source `downtime_record`, operation `close` — GATED by the `manufacturing.downtime_posting` policy (enum `off`/`post`, default **off** — BR-070): with `post`, DR `DOWNTIME_EXPENSE` · CR `PRODUCTION_OVERHEAD` (idle capacity absorbed against applied overhead) at the work center's FULL hourly rate (fixed + var) × idle hours (duration_minutes/60, 4dp); under the default `off` the close is record-only — `cost_amount`/`journal_id` stay NULL (the `ck_downtime_records_window` floor), and an uncosted center (rate sum 0) never posts (the honest zero-value floor) | PHASE-042 |
| G-43 | Quarantine move — the policy-gated distinct-account leg — `inventory` | Source `bin_content`, operations `quarantine`/`release` — GATED by the `inventory.quarantine_posting` policy (enum `off`/`distinct`, default **off** — BR-077): with `distinct`, TO_QUARANTINE posts DR `QUARANTINE_INVENTORY` (1290) · CR the warehouse INVENTORY account at qty × avg cost, and the release mirrors it; under the default `off` the transition posts NOTHING (the G-15 policy-none mirror — the qty never economically moved, INV-029 folds ALL statuses); HOLD never posts (a legal hold, not a valuation state); an unmapped 1290 fails closed (`PURPOSE_NOT_MAPPED`, zero residue); the dispositions ride their own shapes (SCRAP = G-13 with the SCRAP serial event; RTV = the explicit-counter discipline; RELEASE structural) | PHASE-044 |
| G-44 | Consignment consumption settlement — `inventory` | Source `consignment_consumption:{id}:settle` (exactly-once per settlement): DR `COGS` · CR `CONSIGNATION_PAYABLE` (2135) at the AGREED unit price, the owner partner stamped on both legs; fail-closed `PURPOSE_NOT_MAPPED` until 2135 maps (the 038 discipline — BR-077); the receive/return legs are STRUCTURAL (owner rows never enter `item_stock`/`stock_moves`/the tenant ledger — BR-076; INV-010 stays the tenant's own) | PHASE-044 |
| G-45 | Warehouse kitting — the Σ-components roll-up — `inventory` | Source `kit_order` operation `post` (WK- numbering): the kit BOM snapshot lines issue from their directed bins (reason `KIT_CONSUMPTION`) and the kit receipts at Σ component costs EXACTLY — same-account by construction, so NO journal posts (the D-4/G-15 policy-none mirror); INV-029 holds on every leg (the plans ride the movement core — bins and `item_stock` move in the same transaction); serialized components/kits name their units at post (`KIT_OUT`/`KIT_IN` serial events — omitting them fails closed) | PHASE-044 |
| G-46 | Internal transfer-price valuation difference — `inventory` | The per-warehouse-pair policy (MARKUP % / FIXED price, migration 0070 — the operand discipline: exactly one of the two): the policy-priced transfer receipt posts the explicit valuation difference DR destination INVENTORY · CR `TRANSFER_PRICING_ADJUSTMENT` (4990) — fail-closed `PURPOSE_NOT_MAPPED` until 4990 maps; a policy-less transfer keeps the legacy G-15 shape byte-identical; the transit exceptions (I-22) post the G-13 shrinkage shape at the carried cost with their own exactly-once keys | PHASE-044 |

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
11. **G-33/G-34 delivered mechanics (PHASE-038, migrations 0053).** The advance control
    account and the discount income account are tenant-mapped SETTINGS (not engine
    purposes): unmapped → typed `SUPPLIER_ADVANCE_ACCOUNT_UNMAPPED` /
    `EARLY_DISCOUNT_INCOME_ACCOUNT_UNMAPPED`, zero partial writes (the payroll G-29
    loan-account precedent). The G-33 disbursement journal is BASE-denominated at rate 1
    with the treasury movement recorded through the treasury store API (INV-019 exact —
    base == the cash line); the application leg posts under source operation `apply` and
    nets the supplier's subledger. G-34 captures once per invoice (INV-013 source key
    (invoiceId, capture)); the capture verifies the treasury payment is POSTED, allocated
    onto the invoice's open item, inside the window, and ≥ the net-after-discount amount —
    the honesty floor: pay net early, then capture. SoD: an advance approves only by
    someone other than its creator; discount terms must be APPROVED (creator ≠ approver)
    before any capture posts.
12. **G-35…G-39 delivered mechanics (PHASE-039, migrations 0055–0059).** Numbering: G-35
    …G-38 were planned in the PHASE-039 document (numbering continues from G-34 shipped
    with PHASE-038); G-39 is implementation-bound — the next free golden per the decision
    register's "continue per phase doc" rule. The scrap-loss, supplier-return and
    commission accounts are tenant-mapped SETTINGS (`sales.scrap_loss_account`,
    `purchasing.supplier_return_account`, `sales.collection_commission_account`)
    following the G-33/G-34 fail-closed settings precedent (the payroll G-29
    loan-account discipline): typed unmapped rejections BEFORE any ledger work, zero
    partial writes — the RMA/SRMA stays at its pre-completion status.
    Every completion runs in ONE ambient tenant UoW: the credit note (create → approve →
    post, the CN's creator = the RMA's requester so the CN's own SoD gate forces
    completer ≠ requester — a deliberate two-person shape on the money leg), the
    disposition journal, and the terminal stamps (disposition journal's `entry_no`,
    `credit_note_id`, `posted_journal_id`) commit together or not at all; INV-013 source
    keys (`return_authorization`/`supplier_return_authorization` × operation,
    `collection_referral:commission`) make every journal exactly-once. The late-fee
    charge (L1-12) deliberately posts **no** new golden: the fee is a one-line sales
    invoice (kind CREDIT) through the invoice service's own G-04 lineage with VAT on the
    tenant-mapped fee item (`sales.late_fee_item`, fail-closed); the waiver path never
    posts — it stamps the letter's waiver trio. Worked examples as pinned by the DB
    suites (`__db__/sales/returns.db.spec.ts`, `__db__/purchasing/supplier-returns.db.spec.ts`,
    `__db__/sales/dunning.db.spec.ts`): **G-35** 2 × 60.0000 — the re-entry leg re-shelves
    2 units at the invoice line's original issue-cost snapshot (WAC 60.0000) = 120.0000;
    **G-36** 2 × 60.0000 = 120.0000 (DR scrap-loss · CR COGS — the goods never re-shelve,
    the CN's `reentryValue` stays 0.0000); **G-37** 230.0000 — the CN's gross (2 × 100.0000
    net 200.0000 + 30.0000 VAT at STD 15%): DR `AR_CONTROL` · CR cash 230.0000 with the
    OUT treasury movement 230.0000 at rate 1; **G-38** 12.5000 — 5 × 2.5000 net (NS tax,
    no VAT legs): DR `AP_CONTROL` · CR the mapped returns account 12.5000, the DN created
    POSTED against that journal, and the ship journal carrying the same 12.5000 at
    cost == price so the returns account nets to zero; **G-39** 1000.0000 × 10% =
    100.0000 (PCT_OF_COLLECTED at full settlement): DR the mapped commission expense · CR
    `AP_CONTROL` on the agency's partner. The stock-move CHECK-domain note (G-38): the
    ship leg's inventory issues ride the generic `manual_issue` source with reason
    `SUPPLIER_RETURN` — documented in [../database/DATA_DICTIONARY.md](../database/DATA_DICTIONARY.md)
    §18 (the deviation 0059 chose over widening the source CHECK).
13. **G-40…G-42 delivered mechanics (PHASE-042, migrations 0065–0066).** Numbering: the
    PHASE-042 document planned G-38/G-39/G-40 and migrations ≈0060…0066 — those numbers
    predate the 039/040/041 waves (G-35…G-39 shipped with PHASE-039; migrations
    0060…0064 with 040/041), so the honest slots are G-40…G-42 over migrations 0065/0066
    (the 0064 D-1 precedent — recorded per golden here and in
    [ACCOUNTING_INVARIANTS.md](ACCOUNTING_INVARIANTS.md) INV-028 and
    [../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md) BR-068…071). Purpose
    mapping stays fail-closed: the four new purposes land as CoA template markers
    (0065: `5125 REWORK_EXPENSE`, `5430 DOWNTIME_EXPENSE`; 0066: `5990
    PURCHASE_PRICE_VARIANCE`, `5995 STANDARD_REVALUATION` — the 0026 additive pattern);
    existing tenants map once and stay `PURPOSE_NOT_MAPPED`-closed until then (the
    CARD_RECEIVABLE precedent, DR-016-02) — an unmapped rework/downtime close rejects
    typed BEFORE any ledger work, zero partial writes. Worked examples as pinned by the
    DB suites (`__db__/manufacturing/routing-execution.db.spec.ts`,
    `rework-costing.db.spec.ts`, `downtime-oee.db.spec.ts`): **G-40** 3h conversion ×
    (var 25 / fixed 15) → DR `WIP` 120.0000 · CR labor 75.0000 · CR overhead 45.0000,
    with setup_variance (1 − 0.5) × 40 = 20.0000 and usage_variance (2 − 0.1 × 100) × 25
    = −200.0000 (the qty basis is the running actual qty mid-order, planned when none
    produced yet; rate_variance 0.0000 in v1 — BR-071); **G-41** 3h × (var 30 / fixed
    10) → DR `REWORK_EXPENSE` 120.0000 · CR labor 90.0000 · CR overhead 30.0000;
    **G-42** 90 min = 1.5h × (fixed 30 + var 30) = 90.0000 → DR `DOWNTIME_EXPENSE` · CR
    `PRODUCTION_OVERHEAD`. The v3.1/CR-45 standard-costing legs (L2-12) ride TWO
    existing surfaces rather than new golden rows: (a) **PPV at receipt** — when the
    received item carries an ACTIVE standard (`item_standard_costs`), the G-07 GRN
    journal's inventory debit + stock plan ride the STANDARD total (WAC layers absorb
    at standard) and the SAME journal carries the `PURCHASE_PRICE_VARIANCE` leg for
    (actual − std) × qty (DR when actual > std, CR when below — one net purpose leg per
    receipt, the GRNI precedent), while the GRNI credit always rides the ACTUAL total so
    the journal balances by construction (std debits + PPV = actual); standard-less
    items keep the legacy two-line shape byte-identical (the dual mode — pinned by
    `__db__/manufacturing/standard-costing.db.spec.ts`: receive 100 @ 12 over std 10 →
    inventory 1,000.0000 · PPV 200.0000 · GRNI 1,200.0000, the layers at 10.000000).
    (b) **Stock revaluation on standard activate** — `activate(id, {revaluateStock})`
    posts source `item_standard_cost`, operation `revaluate`: ONE batch journal over
    every warehouse holding the item with qty > 0 — new > old: DR inventory ×
    (new − old) × qty · CR `STANDARD_REVALUATION`; new < old: the mirror (DR
    `STANDARD_REVALUATION` · CR inventory); a zero delta (new == the previous ACTIVE
    standard) is the typed `STANDARD_REVALUATION_ZERO` rejection and a no-stock
    activation is the documented no-op (no journal). Worked: (12 − 10) × 100 = 200.0000
    up → DR inventory · CR `STANDARD_REVALUATION` (the same spec).
14. **G-43…G-46 delivered mechanics (PHASE-044, migrations 0067–0073).** Numbering: the
    PHASE-044 document planned G-47…G-50 — those numbers predate the v3.1/v3.2 scope
    extension decision that the WMS goldens take the next free slots after G-42 (the
    042 precedent), so the honest slots are G-43…G-46 over migrations 0067…0073. The
    cycle-count variance deliberately reuses the EXISTING G-13/G-14 shapes with
    `CYCLE_COUNT_LOSS`/`CYCLE_COUNT_GAIN` reasons (source `cycle_count`, one move per
    item + ONE balanced journal per document — no new golden row; the threshold
    approval is BR-075). Purpose mapping stays fail-closed: 0070 seeds the CoA template
    markers `1290 QUARANTINE_INVENTORY` + `4990 TRANSFER_PRICING_ADJUSTMENT`
    (+ `2135 CONSIGNATION_PAYABLE` where absent), and existing tenants stay
    `PURPOSE_NOT_MAPPED`-closed until they map (zero partial writes — the CARD_RECEIVABLE
    precedent). Worked examples as pinned by the DB suites
    (`__db__/inventory/wms-quarantine.db.spec.ts`, `wms-consignment.db.spec.ts`,
    `wms-kitting.db.spec.ts`, `wms-alerts-policies.db.spec.ts`): **G-43** 8 × 5.00 =
    40.0000 → DR 1290 · CR INVENTORY (release mirrors); **G-44** 20 × 7.500000 =
    150.0000 → DR `COGS` · CR 2135 (owner-stamped); **G-45** 20×3 + 30×5 = 210.0000 for
    10 kits → NO journal (kit at 21.000000/unit, same-account); **G-46** MARKUP 25% on
    a 4.00 carry → the receipt's margin leg at the explicit difference.

