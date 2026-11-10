# Accounting Tests

> **Status:** STABLE · **Owner:** Quality Engineering & Accounting Domain · **Updated:** 2026-11-07

The accounting test bible: (a) invariant suite mapping INV-001..INV-026, (b) golden tests
for every canonical posting rule in
[../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md) §4 with three fully
worked numeric examples, (c) property tests, (d) reconciliation tests, (e) concurrency
tests, (f) period-close tests. Rules of engagement (assert data, never screenshots;
failure cases mandatory; zero-residue on failure) come from
[TEST_STRATEGY.md](TEST_STRATEGY.md) §3. Invariant definitions:
[../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) — IDs
below are exact.

## 1. Suite layout and conventions

- Suites: `tests/accounting/invariants/` (§2), `tests/accounting/golden/` (§3),
  `tests/accounting/property/` (§4), `tests/accounting/reconciliation/` (§5),
  `tests/accounting/concurrency/` (§6), `tests/accounting/periods/` (§7).
- Module rule suites (per [../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md) §8):
  PHASE-026 adds `fixed-assets-rules.spec` (BR-041 category usability, BR-042
  run-only/period-locked depreciation, BR-043 salvage floor + disposal lock, BR-044
  audited revaluation to `REVALUATION_RESERVE`) alongside the fixed-assets S-04 spoof
  battery (foreign category/branch/custodian/asset/period references → typed 404s,
  zero partial creation). PHASE-027 adds the notes + installments suites
  (`notes/notes-rules.spec` 27 — BR-045…BR-047 + G-24…G-27 line-level asserts with the
  BASE-denominated base-amount + FX-residual conventions; `installments/installments-rules.spec`
  7 — BR-048/BR-049 + G-28; `notes/inv-024.spec` — custody equals ledger across the
  state graph; `notes/rc-11.spec`; `notes/pdc-calendar.spec` + the 100k-note perf spec;
  `installments/overdue-job.spec` — job-derived-only statuses, grace, DEFAULTED flip)
  alongside the two S-04 spoof batteries (notes ×5, installments ×5) and the four-table
  isolation-registry extension.
- Harness: real PostgreSQL via Testcontainers (`erp_app` role, RLS on); posting through
  module services exactly as production code paths do — **no direct journal inserts**.
- Amounts: `NUMERIC(19,4)`; assertions compare exact decimals, tolerance **0.00**
  (reconciliation rules, [../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §2).
- Every golden test asserts: journal lines (purpose, direction, doc+base amount), GL
  balances, subledger effects, source-document state (`POSTED`, `postedJournalId`), and an
  audit event.
- Every failure test asserts the typed error code **and zero residue**: no journal rows,
  no subledger rows, document state unchanged, no sequence consumed for the document type
  where the engine assigns numbers only on success.

## 2. Invariant suite mapping (INV-001..INV-026)

| ID | Positive scenario (must hold) | Violation attempt (must fail, typed) | Test file |
|----|-------------------------------|--------------------------------------|-----------|
| INV-001 | Balanced spec posts: Σdebit=Σcredit in document currency, 0 tolerance | Spec off by 0.0001 → `ENTRY_NOT_BALANCED`, zero residue | `invariants/INV-001.spec.ts` |
| INV-002 | FX entry balances in base currency (per-line conversion) | Line-level FX rounding drift → engine rejects (caller must pre-balance) | `invariants/INV-002.spec.ts` |
| INV-003 | Posted entry: UPDATE via repository guard → error; direct SQL UPDATE/DELETE as `erp_app` → 0 rows/trigger error; repeat after simulated restore drill | Attempted UPDATE of a posted line, DELETE of entry | `invariants/INV-003.spec.ts` |
| INV-004 | Posting to active leaf account succeeds | Group (non-leaf) account → `ACCOUNT_NOT_POSTABLE`; archived → `ACCOUNT_ARCHIVED` | `invariants/INV-004.spec.ts` |
| INV-005 | SAR-restricted account accepts SAR line | Same account + USD line → `CURRENCY_MISMATCH` | `invariants/INV-005.spec.ts` |
| INV-006 | Posted invoice references journal entries and vice versa (`source` chain complete) | Attempt to mark document `POSTED` with zero journal entries (service-level sabotage) → impossible by API; integration asserts chain after every golden post | `invariants/INV-006.spec.ts` |
| INV-007 | Line tax + line nets + header totals reconcile exactly; residual → rounding purpose line | Feed amounts engineered to round unevenly (e.g., 3 lines × 33.333…): residual must appear as explicit rounding line, never dropped | `invariants/INV-007.spec.ts` |
| INV-008 | FX entry stores rate>0 and base = doc × rate exactly as stored | Missing rate → `MISSING_FX_RATE`; rate ≤ 0 → `INVALID_AMOUNT`; re-read returns stored values, no recomputation drift | `invariants/INV-008.spec.ts` |
| INV-009 | AR/AP lines carry partner; Σ partner subledger (base) = control account balance across 20 randomized ops | AR line without partner → `MISSING_PARTNER_ON_CONTROL`; seeded subledger drift detected by job (see §5) | `invariants/INV-009.spec.ts` |
| INV-010 | Σ(qty×valuation) over stock ledger = inventory account balance after each golden inventory op | Seeded orphan stock move (no journal) → reconciliation `BROKEN` (drift test §5) | `invariants/INV-010.spec.ts` |
| INV-011 | Entry in OPEN period posts | Entry dated in LOCKED period → `PERIOD_LOCKED` (engine) AND trigger double-check fires on direct insert attempt | `invariants/INV-011.spec.ts` |
| INV-012 | Per period Σ document tax summaries by treatment = GL tax-account movements | Seeded summary/GL mismatch → VAT return reconciliation flags (§5) | `invariants/INV-012.spec.ts` |
| INV-013 | Same `(tenant, source_type, source_id, operation)` posted twice sequentially → second returns original result, no new entry | Retry after success + concurrent duplicate (§6) → one entry only | `invariants/INV-013.spec.ts` |
| INV-014 | `reverse()` mirrors accounts/partners/items/amounts, links both ways; original marked `REVERSED` | Reverse twice → `ALREADY_REVERSED`; reverse a non-POSTED entry → error; mirror mismatch impossible by construction (assert full mirror) | `invariants/INV-014.spec.ts` |
| INV-015 | Delete account without postings/children succeeds (archival flow) | Delete account with postings → blocked; archive required-purpose mapped account → blocked | `invariants/INV-015.spec.ts` |
| INV-016 | Allocations ≤ receipt amount; document allocated total ≤ total | Over-allocation attempt (allocate 500 on 300 receipt; allocate beyond invoice total) → rejected, both sides unchanged | `invariants/INV-016.spec.ts` |
| INV-017 | Method switch runs dated revaluation posting; past issues keep original costs | Switch without revaluation/attempts to retro-restate → rejected; history query returns original issue costs | `invariants/INV-017.spec.ts` |
| INV-018 | Every stock move has its journal in the same transaction (or policy-none for same-account transfer) | Simulated crash between move and journal (test double aborts mid-transaction) → rollback leaves **neither**; move-without-journal impossible via API | `invariants/INV-018.spec.ts` |
| INV-019 | Cash account balance = Σ its treasury movements after receipts/payments/transfers/shifts | Seeded drift (movement row without ledger effect) → reconciliation `BROKEN` | `invariants/INV-019.spec.ts` |
| INV-020 | Reopen requires `accounting.periods.reopen` + reason; audit event written; subsequent posting revalidates all invariants | Reopen without permission → 403; reopen without reason → 400; missing audit event fails test | `invariants/INV-020.spec.ts` |
| INV-021 | Official numbers unique per (tenant, type, branch); voided numbers stay reserved | Two invoices racing for same number (§6); reuse of a voided number → rejected | `invariants/INV-021.spec.ts` |
| INV-022 | Fuzz: flip entitlements/templates/feature flags mid-dataset → posting math identical; no config path disables any invariant check | Fuzz corpus of 50 config permutations against golden dataset → byte-identical journals | `invariants/INV-022.spec.ts` |
| INV-023 | Asset depreciation stays within the floor: after every run Σ depreciation ≤ cost − salvage_value and NBV ≥ 0; disposal only once, only from ACTIVE/FULLY_DEPRECIATED | Depreciation engineered to cross the floor (method/period override) → `NBV_BELOW_SALVAGE`, run rejected zero-residue; second disposal of the same asset → `ASSET_ALREADY_DISPOSED`; disposal from DISPOSED/WRITTEN_OFF status → `ASSET_NOT_DISPOSABLE` | `invariants/INV-023.spec.ts` |
| INV-024 | COLLECTED/DISCOUNTED/RETURNED note carries zero `NOTES_RECEIVABLE` balance; DISHONORED note restores the AR open item exactly (amount + references) | Dishonor fixture with amount/reference drift vs the original open item → `DISHONOR_MISMATCH`, rejected zero-residue; collected note seeded with a residual balance → note-custody reconciliation `BROKEN` (diff row lists the note) | `invariants/INV-024.spec.ts` |
| INV-025 | Payroll run totals = Σ lines (gross, deductions, net); net = gross − deductions exactly (0 tolerance); posted runs immutable (reversal-only) | Seeded line-sum drift → run rejected before post; UPDATE/DELETE on a posted run as `erp_app` → 0 rows / trigger error; API edit-after-post impossible — reversal + new run only | `invariants/INV-025.spec.ts` |
| INV-026 | Consolidation run writes zero rows to member books; consolidated statement = Σ member statements (group currency, dated FX) − eliminations; eliminations are balanced journals in the consolidation books | Cross-tenant write attempt through the run service → rejected by the read-only consolidation role + RLS (0 rows); member-book hash identical before/after run; unbalanced elimination spec → `ENTRY_NOT_BALANCED` | `invariants/INV-026.spec.ts` |

## 3. Posting golden tests (canonical rule per [POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md) §4)

Seed conventions: mapped purposes `AR_CONTROL, AP_CONTROL, SALES_REVENUE, SALES_RETURNS,
VAT_PAYABLE, VAT_RECOVERABLE, COGS, INVENTORY, INVENTORY_SHRINKAGE,
INVENTORY_APPRECIATION, GRNI, WIP, PRODUCTION_SCRAP, CASH, PETTY_CASH, BANK_CHARGES,
FX_GAIN, FX_LOSS, ROUNDING_GAIN, ROUNDING_LOSS, RETAINED_EARNINGS, CLOSING, OPENING_EQUITY`;
per-document expense lines post to accounts chosen on the document (no purpose mapping).
`S` = seeded quantity/amount; amounts below are formulas unless the worked example fixes
them. Every row additionally runs the standard failure pack: locked period
(`PERIOD_LOCKED`), unmapped purpose (`PURPOSE_NOT_MAPPED`), unbalanced spec
(`ENTRY_NOT_BALANCED`), already-posted (`ALREADY_POSTED`) — all with zero-residue asserts.

**v2.0 goldens (G-21…G-32)** additionally map the module-conditional purposes per
[../accounting/CHART_OF_ACCOUNTS.md](../accounting/CHART_OF_ACCOUNTS.md) §2 and
[../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §E — `FIXED_ASSET` (per category
account), `ACCUM_DEPRECIATION`, `DEPRECIATION_EXPENSE`, `ASSET_DISPOSAL_GAIN` /
`ASSET_DISPOSAL_LOSS`, `REVALUATION_RESERVE`, `NOTES_RECEIVABLE`, `NOTES_PAYABLE`,
`NOTES_DISCOUNT_EXPENSE`, `LATE_FEE_INCOME`, `SALARIES_EXPENSE`, `SALARIES_PAYABLE`,
`DEDUCTIONS_PAYABLE`, `EMPLOYER_CONTRIBUTIONS`, `EOS_PROVISION`, `EOS_PROVISION_EXPENSE`,
`CONSOLIDATION_ADJUSTMENT` — run the same standard failure pack, and assert the
source-document state per §1 (`POSTED` + `postedJournalId`/`journal_entry_id` + audit
event); module-level rejection codes are asserted in the INV-023…INV-026 suites (§2).

| # | Operation (source) | Given seed | Action | Expected journal lines (DR/CR by purpose) | Subledger effects |
|---|--------------------|-----------|--------|-------------------------------------------|-------------------|
| G-01 | Sales invoice — credit (`sales_invoice:post`) | customer with credit terms; price P, tax t (per pack) | approve+post invoice, net N, tax T, total N+T | DR AR_CONTROL N+T (partner) · CR SALES_REVENUE N · CR VAT_PAYABLE T (per treatment; zero-rated → T=0 line omitted if pack says so) | partner AR +N+T; doc tax summary |
| G-02 | Sales invoice — cash (`sales_invoice:post`, cash path) | cash account with float | post cash invoice | DR CASH N+T · CR SALES_REVENUE N · CR VAT_PAYABLE T | cash movement +N+T; no AR |
| G-03 | Sales invoice — COGS (`sales_invoice:cogs`) | stock at cost C per unit, qty Q issued | same post as G-01 | DR COGS C×Q · CR INVENTORY C×Q (WAC current avg or FIFO layers oldest-first) | stock_moves −Q; INV-010 holds |
| G-04 | Credit note with return (`credit_note:post`) | posted invoice line (unit price P, original cost C) | post credit note qty R + return flag | CR AR_CONTROL R×P×(1+t) (partner) · DR SALES_RETURNS R×P (contra; mirrors SALES_REVENUE when unmapped) · DR VAT_PAYABLE R×P×t **and** DR INVENTORY R×C · CR COGS R×C (re-entry at **original** issue cost) | partner AR −credit; stock +R @C (reason RETURN); original invoice linked |
| G-05 | Receipt from customer (`receipt:post`) | open invoice (doc ccy = base) | receipt amount A, allocate to invoice | DR CASH A · CR AR_CONTROL A (partner) | allocation ≤ invoice open (INV-016); partner ledger settlement |
| G-06 | Receipt with FX difference (`receipt:post` + fx) | open USD invoice posted at rate r₀; current rate r₁ | settle full invoice | DR CASH A×r₁ · CR AR_CONTROL A×r₀ (original stored rate, INV-008) · **CR FX_GAIN A×(r₁−r₀)** (or DR FX_LOSS when r₁<r₀) | invoice open → 0; gain/loss explicit (never dropped) |
| G-07 | GRN (`goods_receipt:post`) | PO line qty Q at unit cost U | receive goods | DR INVENTORY Q×U · CR GRNI Q×U | stock +Q (layer/WAC); GRNI register +Q×U |
| G-08 | Supplier invoice (`supplier_invoice:post`) | GRN exists; VAT recoverable eligible, rate t | post supplier invoice net N | DR INVENTORY/expense N (absorbs stock revalue) · DR VAT_RECOVERABLE N×t · CR AP_CONTROL N×(1+t) (partner) **and** DR GRNI Q×U · CR INVENTORY Q×U (or direct clear per flow config) — net effect clears the accrual | AP +N×(1+t); GRNI −Q×U; three-way-match links |
| G-09 | Debit note (`debit_note:post`) | posted supplier invoice | post debit for adjustment ΔN | Mirror of G-08 adjustment: DR AP_CONTROL ΔN×(1+t) (partner) · CR INVENTORY/expense ΔN · CR VAT_RECOVERABLE ΔN×t | AP −ΔN×(1+t) |
| G-10 | Payment to supplier (`payment:post`) | open AP invoice (base ccy or FX) | pay amount A | DR AP_CONTROL A (partner) · CR CASH A; FX case mirrors G-06 (gain/loss line) | allocation; INV-016 |
| G-11 | Expense (`expense:post`) | expense account E, VAT recoverable t where eligible | record expense N paid from cash/petty | DR EXPENSE(E) N · DR VAT_RECOVERABLE N×t · CR CASH/PETTY_CASH N×(1+t) | treasury movement; INV-019 |
| G-12 | Cash transfer (`cash_transfer:post`) | source/destination accounts; fee F | transfer A | DR CASH(dest) A−F · DR BANK_CHARGES F · CR CASH(src) A | two treasury movements; INV-019 both sides |
| G-13 | Stock adjustment — loss (`stock_adjustment:post`) | on-hand qty X @ cost C | count variance −V | DR INVENTORY_SHRINKAGE V×C · CR INVENTORY V×C | stock_moves −V (reason COUNT_LOSS); INV-010 |
| G-14 | Stock adjustment — gain (`stock_adjustment:post`) | count variance +V | DR INVENTORY V×C · CR INVENTORY_APPRECIATION V×C | stock_moves +V |
| G-15 | Transfer between valuation accounts (`stock_transfer:post`) | branches map distinct inventory accounts | transfer qty Q cost C | DR INVENTORY(dest) Q×C · CR INVENTORY(src) Q×C — **no journal** when both branches map the same account (policy-none case asserted too) | moves + in-transit lifecycle |
| G-16 | Opening balances (`opening_balances:post`) | opening period OPEN; declared balances | post opening entry | DR customers AR_i (each partner) · DR INVENTORY (per-item detail) · DR CASH · CR suppliers AP_j · CR OPENING_EQUITY (balancing) — balanced pair-by-pair | per-partner subledger rows; per-item stock layers; INV-009/010 hold from entry #1 |
| G-17 | Production completion (`production_order:complete`) | WIP accumulated M (material+labor+overhead absorbed via consumption postings) | complete FG qty Q | DR INVENTORY(finished goods) M · CR WIP M | WIP −M; FG layer @M/Q; batch genealogy |
| G-18 | Production scrap (`production_order:scrap`) | WIP balance W, scrap qty S of order | record scrap | DR PRODUCTION_SCRAP W×(S/Q) · CR WIP W×(S/Q) | WIP reduced; reason coded |
| G-19 | FX revaluation run (`fx_revaluation:post`, optional dated) | open FX AR/AP/cash at stale rates | run revaluation date D | DR/CR FX_GAIN/FX_LOSS vs revalued control/cash lines (per rule config); fully reversible as a unit | no subledger mutations; memo references D |
| G-20 | Year-end close (`year_end_close:execute`) | year's periods LOCKED except CLOSING; revenue R₁..Rₙ, expenses E₁..Eₘ | generate closing entry | DR each REVENUE account Rᵢ · CR CLOSING ΣRᵢ; DR CLOSING ΣEⱼ · CR each EXPENSE Eⱼ; net profit → DR CLOSING · CR RETAINED_EARNINGS (loss reversed) | one entry per year, idempotent; reversible as a unit only |
| G-21 | Asset capitalization (`FIXED_ASSET_CAPITALIZATION:post`) | fixed_assets module (PHASE-026); asset category with BR-041 purpose maps (`FIXED_ASSET` category account, `ACCUM_DEPRECIATION`, `DEPRECIATION_EXPENSE`); acquisition cost C (from GRN/purchase or direct) | capitalize the asset | DR `FIXED_ASSET` C (category account) · CR `AP_CONTROL` C (partner — credit purchase) or CR `CASH` C (direct purchase) | asset ACTIVE, cost C, accumulated 0, NBV = C (INV-023 baseline); AP open +C or treasury movement (INV-019); `assets` row ↔ journal chain (INV-006) |
| G-22 | Monthly depreciation run (`DEPRECIATION_RUN:post`) | ACTIVE assets in an OPEN period; per-asset period amount dᵢ (method + useful life per category) | post the run for the fiscal period | DR `DEPRECIATION_EXPENSE` Σdᵢ (per category expense account) · CR `ACCUM_DEPRECIATION` Σdᵢ (per category account) — run = one journal, lines per asset | run DRAFT→POSTED with `journal_entry_id`; per-asset accumulated +dᵢ and NBV ≥ salvage after every line (INV-023); duplicate run → `ALREADY_POSTED` (INV-013); manual asset journal rejected (BR-042) |
| G-23 | Asset disposal — sale above NBV (`ASSET_DISPOSAL:post`) | asset cost K, accumulated A (NBV = K−A > 0), status ACTIVE/FULLY_DEPRECIATED; sale proceeds P > NBV | dispose (kind SALE) | DR `CASH` P · DR `ACCUM_DEPRECIATION` A · CR `FIXED_ASSET` K · CR `ASSET_DISPOSAL_GAIN` P−(K−A) (residual) | asset DISPOSED and locked (INV-023: once, only from ACTIVE/FULLY_DEPRECIATED); disposal doc POSTED; **loss-mirror fixture** asserted (P < NBV → DR `ASSET_DISPOSAL_LOSS` (K−A)−P replaces the gain line); SCRAP kind: proceeds 0 |
| G-24 | Note received into custody (`NOTE_EVENT:receive`) | notes module (PHASE-027); posted invoice with open amount N; incoming CHEQUE/PROMISSORY_NOTE for N with partner + maturity date (BR-045) | receive the note against the invoice | DR `NOTES_RECEIVABLE` N · CR `AR_CONTROL` N (partner — settles open item) | note IN_CUSTODY; invoice open → 0; partner ledger settled; PDC-calendar row at maturity; append-only `note_events` row |
| G-25 | Note collected at maturity (`NOTE_EVENT:collect`) | IN_CUSTODY note (amount N) deposited, maturity reached | collect the deposited note | DR `CASH` N (bank account) · CR `NOTES_RECEIVABLE` N | note COLLECTED carrying zero `NOTES_RECEIVABLE` balance (INV-024); treasury movement (INV-019); maturity-calendar entry cleared |
| G-26 | Note dishonored (`NOTE_EVENT:dishonor`) | deposited note (amount N) bounces; dishonor reason required (BR-046); optional bank fee F | record the dishonor | DR `AR_CONTROL` N (partner — restores the open item exactly, amount + references) · CR `NOTES_RECEIVABLE` N (+ DR `BANK_CHARGES` F · CR `CASH` F when a fee applies) | note DISHONORED; original invoice open item restored exactly (INV-024); dishonored-register row; fee explicit — never dropped |
| G-27 | Note issued to supplier (`NOTE_EVENT:issue`, then `:settle`) | open AP invoice amount N; issued CHEQUE/PROMISSORY_NOTE | issue the note; settle at maturity | DR `AP_CONTROL` N (partner) · CR `NOTES_PAYABLE` N (issue); paid-at-maturity mirror: DR `NOTES_PAYABLE` N · CR `CASH` N (settle) | AP open → 0; `NOTES_PAYABLE` rises then settles to zero; issued-notes register row; settlement treasury movement |
| G-28 | Installment late-fee posting (`INSTALLMENT_LATE_FEE:post`) | installments module (PHASE-027); OVERDUE line on an ACTIVE plan; plan late-fee policy rate + cap + grace (PLACEHOLDER defaults — BR-049, OQ-002 family) | post late fee L per plan policy | DR `AR_CONTROL` L (partner) · CR `LATE_FEE_INCOME` L (per plan policy; only via engine) | partner AR +L; line fee register; fee ≤ policy cap; manual late-fee journal rejected (posting-engine monopoly) |
| G-29 | Payroll run posting (`PAYROLL_RUN:post`) | payroll module (PHASE-029); ACTIVE salary structure (BR-052); per-employee component snapshot: gross G, employee deductions D (third-party D₃ + component-account deductions D_c, e.g. loan installments), employer contributions E, EOS accrual A_e (tenant policy, BR-055) | approve + post the monthly run | DR `SALARIES_EXPENSE` G · DR `EMPLOYER_CONTRIBUTIONS` E · DR `EOS_PROVISION_EXPENSE` A_e · CR `SALARIES_PAYABLE` G−D (net) · CR `DEDUCTIONS_PAYABLE` D₃+E (withheld + employer payables to third parties) · CR `EOS_PROVISION` A_e · CR component-configured accounts D_c | run DRAFT→PENDING_APPROVAL→POSTED with `journal_entry_id`; totals = Σ lines and net = gross − deductions exactly (INV-025); snapshots immutable after post; loan lines → DEDUCTED |
| G-30 | Payroll payout (`PAYROLL_RUN:payout`) | POSTED run with `SALARIES_PAYABLE` balance N′ = G−D | pay net salaries from bank | DR `SALARIES_PAYABLE` N′ · CR `CASH` N′ | payable → 0; treasury movement (INV-019); payout references the run (source chain, INV-006) |
| G-31 | EOS settlement at termination (`EOS_SETTLEMENT:post`) | payroll module (PHASE-029); TERMINATED employee; `EOS_PROVISION` balance P_e; entitlement due S | settle end-of-service | DR `EOS_PROVISION` P_e · CR `CASH` S — residual to `EOS_PROVISION_EXPENSE`: over-provision (P_e > S) adds CR `EOS_PROVISION_EXPENSE` P_e−S; under-provision (P_e < S) adds DR `EOS_PROVISION_EXPENSE` S−P_e | provision released to exactly 0; employee status TERMINATED; both residual directions asserted; balanced in doc + base currency (INV-001/002) |
| G-32 | Consolidation elimination (`CONSOLIDATION_ELIMINATION:post`) | consolidation module (PHASE-034); group with member tenants whose periods are closed (BR-056); intercompany balance X — entity A AR vs entity B AP (group currency, dated FX) | post the elimination in the parent's consolidation books | DR `AP_CONTROL` X (entity B intercompany, partner) · CR `AR_CONTROL` X (entity A intercompany, partner) — balanced journal in the consolidation books only | zero member-book writes (INV-026: member books byte-identical before/after run); eliminations-log row; consolidated TB nets intercompany to 0 |

### 3.1 Worked example W-1 — credit sales invoice, KSA 15% VAT

**Seed**: base currency SAR; purposes mapped; partner "شركة النور" (credit); Item A:
on-hand 20 @ WAC 60.0000; Item B: on-hand 10 @ WAC 25.0000; prices A=100.00, B=40.00;
tax code STD15 (standard 15%).

**Action**: post credit invoice SAL-000042, lines: (A ×10 @100.00 = 1,000.0000),
(B ×5 @40.00 = 200.0000). Net 1,200.0000; VAT 180.0000; total 1,380.0000.

**Expected journal — AR entry (`sales_invoice:post`)**:

| Line | Purpose | Direction | Amount (SAR) |
|------|---------|-----------|--------------|
| 1 | AR_CONTROL (partner النور) | debit | 1,380.0000 |
| 2 | SALES_REVENUE | credit | 1,200.0000 |
| 3 | VAT_PAYABLE (code STD15) | credit | 180.0000 |

**Expected journal — COGS entry (`sales_invoice:cogs`)**:

| Line | Purpose | Direction | Amount (SAR) |
|------|---------|-----------|--------------|
| 1 | COGS | debit | 725.0000 |
| 2 | INVENTORY | credit | 725.0000 |

**Subledger/effects asserts**: partner AR open +1,380.0000; stock moves A −10 @60.0000,
B −5 @25.0000; on-hand A=10, B=5 with unchanged WAC; balances: AR 1,380.0000, revenue
1,200.0000, VAT payable 180.0000, COGS 725.0000, inventory −725.0000; INV-010
reconciliation green; official number SAL-000042 assigned, unique, immutable (INV-021).

**Failure pack on this fixture**: post again → `ALREADY_POSTED` (INV-013); lock the
period then post a twin invoice → `PERIOD_LOCKED`; unmap VAT_PAYABLE →
`PURPOSE_NOT_MAPPED`; corrupt spec (line 2 = 1,199.0000) → `ENTRY_NOT_BALANCED` — each
with zero residue.

### 3.2 Worked example W-2 — receipt with FX gain

**Seed**: base SAR. Invoice SAL-000077 posted earlier: 1,000.0000 USD credit at rate
3.7500 → journal stored base amounts: DR AR_CONTROL 3,750.0000 (rate recorded on entry,
INV-008). Partner open amount 1,000.0000 USD.

**Action**: receipt RCP-000010 for 1,000.0000 USD into bank account at current rate
3.7600; allocate fully to SAL-000077.

**Expected journal (`receipt:post`)**:

| Line | Purpose | Direction | Doc (USD) | Base (SAR) |
|------|---------|-----------|-----------|------------|
| 1 | CASH | debit | 1,000.0000 | 3,760.0000 |
| 2 | AR_CONTROL (partner) | credit | 1,000.0000 | 3,750.0000 (original stored rate) |
| 3 | FX_GAIN | credit | — | 10.0000 (explicit residual) |

**Asserts**: entry balanced in both currencies (INV-001/002); rate>0 stored (INV-008);
invoice open amount 0.0000 USD; allocation total = invoice total (INV-016); partner
subledger settles 1,000.0000 USD; bank account = Σ movements (INV-019); FX gain appears
in the period's income statement lines.

**Mirror case**: rate 3.7400 → line 3 becomes DR FX_LOSS 10.0000 and cash 3,740.0000 —
asserted by the same test with a second fixture.

### 3.3 Worked example W-3 — credit note with stock return

**Seed**: W-1's posted invoice SAL-000042 (A ×10 @100.00). Customer returns 2 units of A
(damaged). WAC of A still 60.0000; original issue cost for the returned units = 60.0000.

**Action**: post credit note CN-000005: line A qty 2 @100.0000 = 200.0000 net; VAT 15% =
30.0000; credit total 230.0000; flag = return-to-stock.

**Expected journal — credit-note entry (`credit_note:post`)**:

| Line | Purpose | Direction | Amount (SAR) |
|------|---------|-----------|--------------|
| 1 | SALES_RETURNS (contra revenue) | debit | 200.0000 |
| 2 | VAT_PAYABLE (STD15) | debit | 30.0000 |
| 3 | AR_CONTROL (partner النور) | credit | 230.0000 |

**Expected journal — stock re-entry**:

| Line | Purpose | Direction | Amount (SAR) |
|------|---------|-----------|--------------|
| 1 | INVENTORY | debit | 120.0000 (2 × original cost 60.0000 — **not** current-average recompute) |
| 2 | COGS | credit | 120.0000 |

**Asserts**: partner AR open reduced by 230.0000 (or credit balance if already settled);
stock A +2 @60.0000 (reason RETURN, batch preserved); gross-margin report shows return at
original cost (COGS net 605.0000 for the original sale after this pair); INV-009/010/012
all green on the reconciliation run; the credit note references SAL-000042 (source chain,
INV-006).

## 4. Property tests (fast-check)

| Property | Generator | Invariant assertion |
|----------|-----------|---------------------|
| Rounding monotonicity | arbitrary line amounts at 2–4 decimals, split counts 2..50 | rounded(line sums) ≤ rounded(total) rounding direction consistent; Σ residuals = explicit rounding lines; re-rounding never changes result (idempotent) |
| Line-net/tax/header conservation | random nets + rates (0%, 5%, 14%, 15%) | Σ line tax = header tax; Σ line net = header net — INV-007, always exact |
| WAC recalculation | random receipt sequences (qty>0, cost>0) onto existing stock | new average strictly within [min(costs seen), max(costs seen)]; qtyOnHand × avg = valuation total within 6-decimal rounding; issue-then-receipt never mutates past issue costs (INV-017) |
| FIFO layer conservation | random issues/receipts | Σ layer qty = on-hand qty exactly; consumption order = oldest-first always; layers never negative; valuation = Σ layer qty×cost (INV-010) |
| FX base conversion | random doc amounts + rates | base = doc × rate exactly as stored; Σ base debits = Σ base credits when doc balanced (INV-002/008) |
| Allocation bounds | random partial allocations | allocated total never exceeds receipt amount nor invoice total at ANY interleaving (INV-016) |

## 5. Reconciliation tests (subledger vs control — INV-009/010/012 + drift detection)

| Test | Arrangement | Expected |
|------|-------------|----------|
| RC-01 (INV-009 AR) | 20 randomized AR ops (invoices, receipts, credit notes, allocations) | job result `OK`; Σ partner subledger = AR_CONTROL exactly |
| RC-02 (INV-009 AP) | mirror AP scenario | `OK` exact |
| RC-03 (INV-009 **drift**) | seed one partner-subledger row deleted (simulated corruption) | job result `BROKEN` with diff row listing the partner + amount; notification fired; period close blocked ([../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §3) |
| RC-04 (INV-010) | mixed inventory ops incl. transfer-without-journal case and landed cost | `OK`; Σ qty×valuation = INVENTORY account(s) per branch split |
| RC-05 (INV-010 **drift**) | insert orphan stock_move without journal (test tooling, not app code) | `BROKEN` with offending move id |
| RC-06 (INV-012) | period with standard/zero-rated/exempt mix (per-pack fixtures) | Σ document tax summaries by treatment = GL movements of VAT_PAYABLE/RECOVERABLE/EXPENSED; VAT return draft shows both sides equal |
| RC-07 (INV-012 **drift**) | mutate one document tax summary row | mismatch blocks "file" status of the return draft |
| RC-08 (INV-019) | treasury ops incl. transfers, fees, shift differences | every cash/bank balance = Σ movements |
| RC-09 (GRNI) | GRN without supplier invoice → invoice → partial | GRNI register = GRNI account at each step |
| RC-10 (determinism) | run statement/aging twice as-of same date | byte-identical results (no caching drift) |
| RC-10 (fixed assets — [../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §1 row 10, kind `FIXED_ASSETS`, PHASE-026) | capitalization ×2 paths (direct G-21 + purchase) → run G-22 → revaluation → disposal, then the register check after each op set | per category account Σ gross current value = `FIXED_ASSET` balance and Σ accumulated = `ACCUM_DEPRECIATION` balance, exact 0.00; seeded drift (register row without ledger effect) → `BROKEN` with the offending id + notification + period-close block (PC-04) |
| RC-11 (notes — [../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §1 row 11, kind `NOTES`, PHASE-027 — `notes/rc-11.spec`) | receive (G-24) → endorse/deposit → collect (G-25) / dishonor (G-26) / return / discount, then the register check after each event set; the issued mirror (G-27 pair) | per purpose side Σ live notes (amount × the stored rate, INV-008) = `NOTES_RECEIVABLE` / `NOTES_PAYABLE` balance (issued side read credit-positive — the GRNI convention), exact 0.00; resolved notes contribute zero (INV-024); seeded drift (a note row without its journal, or an external journal on a notes-purpose account) → `BROKEN` with the offending note + critical notification + period-close block (PC-04) |

## 6. Concurrency tests

| Test | Scenario | Expected |
|------|----------|----------|
| CC-01 Duplicate posting, same invoice | two parallel `post()` calls for the same source (two API requests, same idempotency semantics) | exactly ONE journal entry set; the loser returns the stored result (INV-013); no unique-violation leaks to the user; no partial subledger |
| CC-02 Concurrent receipts allocating to one invoice | two receipts allocate against the same invoice's open amount simultaneously | final allocated total ≤ invoice total (INV-016); one allocation may be partially accepted; no negative open amount ever |
| CC-03 Sequence numbering race | 50 parallel invoice posts in one branch | 50 unique official numbers, no gaps-collisions, INV-021; per-tenant sequence contention does not deadlock (assert with statement-timeout headroom) |
| CC-04 Stock issue race | two concurrent sales issuing the last 10 units | stock never negative (default policy): one wins, one fails `INSUFFICIENT_STOCK` cleanly (no ledger residue for the loser) |
| CC-05 Period lock race | post() racing a period LOCK command | either the entry commits before lock or gets `PERIOD_LOCKED`; never a posted entry inside a locked period (INV-011) |
| CC-06 Reversal vs re-post | reverse() racing a duplicate delivery of the original post command | at most one entry + at most one reversal (INV-013/014 interplay) |

## 7. Period-close tests

| Test | Scenario | Expected |
|------|----------|----------|
| PC-01 Lock enforcement | lock a period; attempt invoice post, manual journal, adjustment, reopen-less everything | all rejected `PERIOD_LOCKED` (engine); direct SQL insert into locked period blocked by trigger (INV-011) |
| PC-02 Soft-close discipline | soft-closed period + `accounting.periods.post_to_soft_closed` + reason | posting succeeds with audit; without permission/reason → rejected |
| PC-03 Reopen audit (INV-020) | reopen locked period with permission+reason | audit event with actor/reason; subsequent posting revalidates invariants normally; reopen of period older than 2 months raises anti-fraud alert ([../accounting/PERIOD_CLOSING.md](../accounting/PERIOD_CLOSING.md) §2) |
| PC-04 Close checklist gates | attempt LOCK with a BROKEN reconciliation (seeded RC-03) | lock refused until reconciliations green or explicitly waived per workflow |
| PC-05 Year-end correctness | seeded year: revenues R=10,000, expenses E=7,500 (multiple accounts) | closing entry: DR revenue accounts 10,000 · CR CLOSING 10,000; DR CLOSING 7,500 · CR expense accounts 7,500; DR CLOSING 2,500 · CR RETAINED_EARNINGS 2,500 — one entry, source `year_end_close`, net = prior-year IS net |
| PC-06 Year-end reversibility | reverse the closing entry (`year_end_close:reverse`) then regenerate | counter-entry mirrors exactly (INV-014); regenerated entry idempotent per year (INV-013); prior-year statements unchanged by the whole cycle |
| PC-07 Prior-year immutability | after year N close, post corrections in N+1 | statements of N never change; N+1 memo/disclosure path works; no restatement back-door |

## 8. Per-pack expansion rule

Every jurisdiction pack ships its own golden fixture pack (rates, treatments, invoice
requirements) — a pack without green posting-golden + VAT-return tests cannot be enabled
for tenants ([../localization/TAX_ENGINE.md](../localization/TAX_ENGINE.md) adapter
framework). Test names carry the pack id, e.g. `golden/pack-sa/G-01-credit-invoice-15pct`.

## 9. Maintenance protocol

1. New posting rule (new operation in POSTING_ENGINE.md §4) ⇒ new G-row here + golden
   test + failure pack, same PR.
2. New invariant ⇒ row in §2 test-first (ACCOUNTING_INVARIANTS.md protocol).
3. New jurisdiction pack ⇒ §8 fixture pack before tenant enablement.
4. Any drift incident (RISK-009) adds a seeded-drift test named after the incident ticket
   ([REGRESSION_STRATEGY.md](REGRESSION_STRATEGY.md) §5).
