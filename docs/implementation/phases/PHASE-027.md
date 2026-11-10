# PHASE-027 — Cheques, Promissory Notes & Installments

> **Status:** COMPLETE · **Updated:** 2026-11-07

## 1. Phase Overview

- **Phase ID:** PHASE-027
- **Title:** Cheques, Promissory Notes & Installments
- **Objective:** Deliver the `notes` and `installments` modules per
  [DR-003-notes-and-installments.md](../../decisions/accounting/DR-003-notes-and-installments.md)
  and [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-03: a notes register
  (`notes` + append-only `note_events`) for CHEQUE / PROMISSORY_NOTE instruments,
  received and issued, with custody states (IN_CUSTODY / ENDORSED_OUT / DEPOSITED /
  COLLECTED / DISHONORED / DISCOUNTED / RETURNED) and engine-posted journals
  **G-24** (receipt into custody settling AR), **G-25** (collection at maturity),
  **G-26** (dishonor restoring AR **exactly** — INV-024), **G-27** (issued-note
  mirror pair); endorsement moves custody **without a journal** (BR-047) while
  discounting posts explicit `NOTES_DISCOUNT_EXPENSE`; a job-derived **PDC maturity
  calendar** (ADR-0008); a reason-required dishonor workflow (BR-046); installment
  plans over credit sales invoices and service contracts (`installment_plans` +
  `installment_lines`; plan total = source total — BR-048; immutable after
  activation; job-derived OVERDUE; FLAT late fees only, engine-posted as **G-28**,
  BR-049); 5 report contracts; and the الخزينة / المبيعات screens — every journal
  through the PHASE-007 engine (INV-013 idempotency) with custody and ledger
  effects provably equal (INV-024). **This phase terminates the v1.1
  `treasury.cheques` deferral chain** (PHASE-008 deferred → PHASE-012 kept it a
  receipt method; delivered here by the `notes` module per DR-003/ED-03).
- **Business value:** Post-dated cheques are the region's credit reality: a trader
  "collects" on delivery and prays on the maturity date. This phase gives الخزينة
  a maturity calendar answering "متى يُحصّل ما لنا؟ ومتى يُسحب ما علينا؟", makes a
  bounced cheque restore the customer's debt **exactly** instead of vanishing into
  a bank line, and lets education/healthcare-style businesses sell on installments
  (خطة أقساط) with overdue flags and flat late fees — the gaps the 2026-10-28
  research confirmed. INV-024 makes custody-vs-ledger equality machine-checked,
  and the riba stance is explicit: flat fees, never interest.

## 2. Scope

In scope:

1. **Notes register** (`notes.received`, `notes.issued`): `notes` — kind
   CHEQUE/PROMISSORY_NOTE, direction RECEIVED/ISSUED, `partner_id` +
   `maturity_date` **required** (BR-045), `number` (the instrument's own number),
   `issuing_bank`, `amount` + `currency` + `exchange_rate` (INV-008 — stored,
   never recomputed), `issue_date`, `status` (`note_status`: IN_CUSTODY,
   ENDORSED_OUT, DEPOSITED, COLLECTED, DISHONORED, DISCOUNTED, RETURNED), and
   `source_type`/`source_id` (origin invoice / supplier invoice). `note_events` 🔒
   is the append-only custody log (`note_id`, `event_kind` ENDORSE / DEPOSIT /
   COLLECT / DISHONOR / DISCOUNT / RETURN / RECLASSIFY, `event_date`, refs,
   `journal_entry_id`, `created_by`) — the audit substrate of INV-024; RECLASSIFY
   records audited metadata corrections with **no journal and no custody change**.
2. **Receipt into custody — G-24**: a received note recorded against a customer
   invoice posts `DR NOTES_RECEIVABLE · CR AR_CONTROL`, settling the open item via
   the standard allocation machinery (FIFO suggestion, partials, INV-016 bounds,
   INV-009 partner line); custody = IN_CUSTODY. On-account receipts (no invoice)
   settle as an explicit on-account open item (BR-027 discipline).
3. **Collection at maturity — G-25**: DEPOSIT moves custody IN_CUSTODY →
   DEPOSITED **without a journal** (the note is at the bank, still our balance);
   COLLECT posts `DR CASH/BANK · CR NOTES_RECEIVABLE` and creates the treasury
   money movement **through the treasury service API** (`cash_movements` is
   treasury-owned; notes never writes it) with INV-019 intact. Foreign-currency
   notes settle with the existing FX residual rules
   ([JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §4.2 / G-06 pattern —
   original stored rate on the control line; no new FX mechanics).
4. **Dishonor — G-26** (`notes.dishonor`, BR-046): a bounced received note posts
   `DR AR_CONTROL · CR NOTES_RECEIVABLE` **restoring the AR open item exactly** —
   amount, partner, and original invoice references (INV-024); the event requires
   a **reason**; an optional bank fee posts through the existing `BANK_CHARGES`
   purpose (treasury leg); custody = DISHONORED; audited + partner notification.
5. **Issued notes — G-27** (`notes.issued`): issuing a note to a supplier posts
   `DR AP_CONTROL · CR NOTES_PAYABLE` (settles the AP open item); the
   paid-at-maturity mirror posts `DR NOTES_PAYABLE · CR CASH/BANK`. The custody
   enum is shared with mirrored semantics for direction ISSUED: COLLECT at maturity
   posts the paid leg; RETURN/DISHONOR restore the AP open item exactly (the AP-side
   mirror of G-26).
6. **Endorsement — no journal** (`notes.endorsement`, BR-047): IN_CUSTODY →
   ENDORSED_OUT moves **custody only** — zero journal rows may appear (the note
   stays our `NOTES_RECEIVABLE` balance until the chain resolves by COLLECT /
   DISHONOR / RETURN, recorded when known); the golden ledger-delta test asserts
   the zero. **Return** hands the instrument back pre-resolution and restores AR/AP
   exactly (the G-26 restore side without bounce reason/fee); **discounting**
   (`notes.discounting`) posts `DR CASH (proceeds) · DR NOTES_DISCOUNT_EXPENSE
   (fee) · CR NOTES_RECEIVABLE (amount)` — custody DISCOUNTED, fee explicit, never
   netted silently (INV-024: zero balance).
7. **PDC maturity calendar** (`notes.pdc_calendar`, BR-045): job-derived from
   `maturity_date` — a daily pg-boss refresh plus on-event invalidation builds the
   `notes.pdcCalendar` buckets (overdue-in-custody, this week, 30/60/90-day
   horizons; by partner/bank/branch; received vs issued two-sided view). **No new
   canonical entity** — register §C deliberately lists no calendar table; it is a
   cached read model over `notes` + `note_events` with freshness stamps (stale is
   labeled, never guessed). Treasury nav item **تقويم الاستحقاق / Maturity
   calendar**.
8. **Installment plans** (`installments.plans`, BR-048): `installment_plans`
   (partner, `source_type`/`source_id` — credit sales invoice (PHASE-012) or
   service contract (PHASE-019 `crm.service_contracts`), `total_amount`,
   `down_payment`, `count`, `start_date`, `frequency` WEEKLY / BIWEEKLY / MONTHLY
   / QUARTERLY, `late_fee_policy` jsonb, status ACTIVE/CLOSED/DEFAULTED) +
   `installment_lines` (plan, seq, `due_date`, `amount`, status PENDING/DUE/PAID/
   OVERDUE/WAIVED, `receipt_refs`). The wizard computes the schedule; **activation
   requires plan total = source document total** (BR-048); the schedule is
   **immutable after activation**. Plans are a **collection overlay**: the AR open
   item remains the invoice — no new AR open items are created, so subledger =
   control stays intact (Σ line collections ≤ invoice outstanding, INV-016 tie);
   the down payment collects via a normal receipt against the invoice.
9. **Collections, OVERDUE, DEFAULTED** (`installments.schedules`,
   `installments.collections`): receipts allocate to plan lines reusing the
   PHASE-008/012 allocation service (line-level `receipt_refs`; INV-016 bounds);
   **OVERDUE is job-derived only** (daily ADR-0008 job: `due_date` past + grace
   elapsed + unpaid; idempotent recompute — no manual status writes exist); WAIVED
   is the single manual transition — `installments.lines.waive` permission +
   reason + audit; plan status DEFAULTED flips per policy after N consecutive
   overdue lines (PLACEHOLDER default, OQ-002 family) with a dunning notification.
10. **Late fees — G-28** (`installments.late_fees`, BR-049): per-plan policy jsonb
    (rate + cap + grace — **PLACEHOLDER defaults per the OQ-002 family**, never
    silent); the charge posts `DR AR_CONTROL · CR LATE_FEE_INCOME` **via the engine
    only**, creating a new AR open item against the partner (allocatable and
    reversible like any AR item); auto-charge policy default OFF; **flat fees
    only — no interest computation, no compounding** (explicit riba stance,
    DR-003).
11. **Reports** (`notes.reports`, `installments.reports`, register §J): five
    contracts in the PHASE-013 registry, provenance = notes/installments module
    query services + owned tables (no source of truth → no report):
    `notes.maturity-calendar` (report twin of the workspace), `notes.aging`
    (buckets by `maturity_date` on uncollected notes; footer tie: Σ open notes =
    `NOTES_RECEIVABLE` balance), `notes.dishonored-register` (per period/partner,
    drill to events), `installments.schedule` (plan lines + statuses + receipt
    refs, asOf), `installments.aging` (line buckets by `due_date`). Permissions
    per [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.12;
    block-on-fail ties per
    [REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md).
12. **UI per archetypes** ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)):
    note List+Search (§2; kind/direction/status/partner/maturity filters), note
    Create/Edit (§3; receive-against-invoice and issue-against-supplier-invoice
    pickers), note **Document Detail with custody timeline** (§5 — the
    `note_events` log rendered as a timeline; `TimelinePanel` pattern + catalog
    entry), **maturity calendar workspace** (§1 Dashboard variant + list drill),
    dishonor dialog on the note detail (reason required), **installment plan
    Wizard** (§9) over invoice/contract, schedule Document Detail (§5), aging
    lists (§2), report pages (§7).
13. **NAVIGATION additions** (register §K,
    [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1): group 6 الخزينة +=
    **الشيكات والأوراق التجارية / Cheques & notes** (featureKey `notes.received`)
    + **تقويم الاستحقاق / Maturity calendar** (featureKey `notes.pdc_calendar`);
    group 2 المبيعات += **خطة الأقساط / Installment plans** (featureKey
    `installments.plans`) — each with bilingual label, archetype, permission.
14. **`treasury.cheques` chain termination (ED-03 doc-sync):** the v1.1 deferral
    chain ends here — the `treasury.cheques` feature key re-points to PHASE-027
    with the "delivered by the `notes` module" note (register §D), and the
    PHASE-008 out-of-scope bullet + PHASE-012 receipt-method wording carry
    pointers to this phase (appended in this revision).
15. **Attack + rule tests:** all four tables enter the isolation registry; spoof
    rows per [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2
    (PHASE-027 row): note create with foreign `partner_id`/invoice id;
    endorse/dishonor/discount on a foreign note id; plan referencing a foreign
    invoice/contract id; waive on a foreign line — typed **404** rejection, zero
    partial creation (S-04; A7). Rule suites `tests/notes/notes-rules.spec.ts` +
    `tests/installments/installments-rules.spec.ts` cover BR-045…BR-049.

Out of scope (explicit):

- Bank-API cheque clearing integrations (external-adapter framework territory per
  PHASE-023; a future decision record would own it — none exists yet).
- Bill-of-exchange discounting **with third-party banks as an integration** — a
  discount is recorded through the existing purposes only; no bank connectivity.
- **Interest-bearing installments — riba concerns:** FLAT late fees only, no
  interest computation, no compounding, no effective-rate displays (explicit
  product stance per
  [DR-003-notes-and-installments.md](../../decisions/accounting/DR-003-notes-and-installments.md)).
- Endorsee-chain subledgers (ضمان/كفالة guarantee accounting), legal
  protest/noting-fee automation, and litigation management for dishonored notes —
  the register, reason, and fee fields are the whole surface.
- Personal-account portal payment of installments (matrix row 28 stays deferred
  per OQ-007); POS/field-collection flows for note events (no offline rows added).

## 3. Prerequisites

- Required phases: **PHASE-025 COMPLETE (GA stage gate)** — expansion never
  reopens the GA gate (ED-01); consumed artifacts: the GA release record +
  production-class envelope the calendar/overdue jobs must fit inside. Functional
  prereqs: **PHASE-008** — cash/bank accounts + `cash_movements` (INV-019) for
  the G-25/G-27 money legs via the treasury service API, `BANK_CHARGES` for
  dishonor fees, receipts/payments as the money documents, allocation service +
  INV-016. **PHASE-012** — AR open items, credit invoices, receipts + allocations
  (line-level allocation extends here), `arQueries` aging patterns; the AP twin
  arrives via PHASE-011 inside the same chain. **PHASE-013** — report contract
  registry + boot validation
  ([REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md)), run orchestration,
  permission re-resolution, as-of determinism, block-on-fail assertions
  ([REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md)),
  print/export. Also consumed: PHASE-019 `crm.service_contracts` (installments
  over contracts), PHASE-006 partners, PHASE-004 branches.
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)
  (notes/installments never write GL tables — JournalSpec only),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (decimals; FX
  residuals explicit per the existing settlement rules),
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (RLS on all four
  tables), [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (notes
  carry the instrument's own number as data — no official sequence fabricated;
  official numbering only where a tenant document prints, INV-021),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (PDC calendar + OVERDUE
  jobs — maturity-calendar derivation).
- Decision record:
  [DR-003-notes-and-installments.md](../../decisions/accounting/DR-003-notes-and-installments.md)
  — authority for custody semantics, the flat-fee stance, plan policy shape;
  register entry ED-03.
- Relevant documentation: [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md)
  §4 (+ seven-way effect-matrix rows for G-24…G-28),
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §4.2 (FX residuals) + §7
  (G-24…G-28 — v2.0 addition),
  [RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md)
  (open items, allocations, on-account),
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md) (INV-024
  new; INV-003/008/009/013/014/016 reused),
  [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §3,
  [RECONCILIATION.md](../../accounting/RECONCILIATION.md) §1 (notes subledger row
  added here) + §2–§3, [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md)
  §6/§9 (money; 7 new enums), [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md)
  (notes + installments sections, ED-19),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (12 keys + the
  `treasury.cheques` re-point, register §D),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-045…049 + §8 rows) ·
  [BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §10 (PDC note
  lifecycle) + §12 (installment sale & collection) — register §M ·
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (5 rows) ·
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.12 + §4 ·
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 ·
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) ·
  [CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md) §4–5 ·
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) (§1/§2/§3/§5/§7/§9) ·
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1 ·
  [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) (`TimelinePanel`) ·
  [MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md) ·
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md).

## 4. Design Impact

- **Database changes:** four new tenant-owned tables — `notes`, `note_events` 🔒
  (append-only, INV-003 pattern), `installment_plans`, `installment_lines` —
  standard columns ([DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §1),
  UUIDv7 keys, RLS + composite tenant FKs, OC = no. Seven new §9 enums (`note_kind`,
  `note_direction`, `note_status`, `note_event_kind`, `installment_frequency`,
  `installment_line_status`, `installment_plan_status`). The PDC calendar is a
  job-derived read model — deliberately **not** a new canonical entity (register
  §C). [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) gains the notes +
  installments sections; the TABLES `notes-installments.md` spec is authored
  in-phase (grow-per-phase rule); ERD refreshed.
- **API changes:** `/api/v1/notes[/{id}]`,
  `/notes/{id}/endorse|deposit|collect|dishonor|discount|return`,
  `/notes/pdc-calendar`, `/api/v1/installment-plans[/{id}]`,
  `/installment-plans/{id}/activate`,
  `/installment-plans/{id}/lines/{lineId}/waive`,
  `/installment-plans/{id}/lines/{lineId}/charge-late-fee` — per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md): POST actions with
  `Idempotency-Key`, 409 `IMMUTABLE_DOCUMENT` / `SCHEDULE_IMMUTABLE`, typed 404 on
  foreign ids.
- **UI changes:** الخزينة += الشيكات والأوراق التجارية + تقويم الاستحقاق;
  المبيعات += خطة الأقساط (register §K wording); `TimelinePanel` enters
  `packages/ui` with a catalog entry + AR+EN baselines (the `ShiftPanel`
  precedent in [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md)).
- **Security & authorization:** the §3.12 set activates (`notes.notes.view|create|
  endorse|deposit|record_dishonor`, `installments.plans.manage`,
  `installments.lines.waive` — register §K); this phase's doc sync completes the
  action keys for discount/return (`notes.notes.discount|return` — risk-flagged,
  audited). Attack rows: foreign partner/invoice/contract/note/line references →
  typed 404 + zero partial creation; dishonor of a foreign note never restores a
  foreign AR item (asymmetric-spoof test); every route A7-clean.
- **Accounting implications:** goldens **G-24**, **G-25**, **G-26**, **G-27**
  (both legs), **G-28**, each asserting the seven effect-matrix cells; purposes
  `NOTES_RECEIVABLE`, `NOTES_PAYABLE`, `NOTES_DISCOUNT_EXPENSE`, `LATE_FEE_INCOME`
  (register §E) + existing `AR_CONTROL`, `AP_CONTROL`, `CASH`, `BANK_CHARGES`;
  **INV-024** gained; **RC-11** reconciliation check — Σ open received-note
  balances = `NOTES_RECEIVABLE` balance (issued mirror on `NOTES_PAYABLE`),
  registered in the PHASE-007 framework; late fees create AR open items (INV-009
  partner lines); JOURNAL_RULES §7 + BUSINESS_RULES rows added by this phase's doc
  sync; failure packs mandatory (below).
- **Localization implications:** bilingual note kinds (شيك / كمبيالة), cheque
  number + bank names in both scripts, maturity-date formats per locale, RTL
  timeline rendering, tafqit on printed note vouchers, AR+EN baselines.
- **Offline implications:** no additions to
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  — custody events and postings are ONLINE-ONLY (server-owned posting
  discipline); DRAFT-first document shapes keep future offline rows addable.
- **Module dependencies:** `notes` → `accounting` (engine, periods,
  reconciliation framework) + `partners` (AR/AP open items via the
  sales/purchasing services) + `treasury` (cash movements + `BANK_CHARGES`) +
  `reporting`; `installments` → `sales` (invoices) + `crm` (service contracts) +
  `treasury` (receipt allocations) + `reporting` per
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2; nothing else
  writes `note_events`
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) write matrix).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0027_notes_installments.sql`: 4 tables + 7 enums + RLS/composite FKs/indexes + append-only grants on `note_events` | `apps/api/migrations/0027_notes_installments.sql` | migration fresh+regression; RLS catalog; A1–A10 suite on all four tables |
| T2 | Note register + custody state machine + append-only event log (legal transition table; RECLASSIFY without journal) | `apps/api/src/modules/notes/application/note-service.ts`, `domain/custody-machine.ts` | illegal transitions rejected (`INVALID_CUSTODY_TRANSITION`); event log immutable; foreign partner/invoice refs → 404 |
| T3 | G-24 receive-against-invoice + on-account variant; G-27 issue mirror pair | `apps/api/src/modules/notes/application/receive-service.ts`, `issue-service.ts` | G-24 golden (1,000.00 cheque settles invoice open item); INV-016 partial bounds; G-27 both legs |
| T4 | Deposit/collect legs (G-25) with treasury movement integration + FX residual reuse | `apps/api/src/modules/notes/application/collection-service.ts` | G-25 golden (incl. USD note at a moved rate → FX gain/loss residual per G-06 pattern); INV-019 both sides |
| T5 | Dishonor workflow (G-26): reason required, optional `BANK_CHARGES` fee, exact AR restore | `apps/api/src/modules/notes/application/dishonor-service.ts` | G-26 golden — restored open item equals the original (amount + partner + refs); reason-missing rejected; DISHONORED → zero note balance |
| T6 | Endorsement (no journal) + return (AR/AP restore) + discounting (`NOTES_DISCOUNT_EXPENSE`) | `apps/api/src/modules/notes/application/endorsement-service.ts`, `discount-service.ts` | BR-047: ledger-delta test = zero journal rows on ENDORSE; return/discount mirrors golden; discount fee explicit |
| T7 | PDC maturity calendar: daily job + on-event invalidation + read model + freshness stamps | `apps/api/src/modules/notes/infrastructure/pdc-calendar.job.ts`, `application/pdc-calendar-queries.ts` | job idempotent; buckets correct after every event kind; stale label on a skipped run; 100k-note fixture bounded |
| T8 | Installment plan builder + activation: BR-048 total equality, schedule immutability | `apps/api/src/modules/installments/application/plan-service.ts` | BR-048: total ≠ source → rejected; edit-after-activation → 409 `SCHEDULE_IMMUTABLE`; foreign invoice/contract id → 404 |
| T9 | OVERDUE/DEFAULTED jobs + derived statuses (no manual status writes) | `apps/api/src/modules/installments/infrastructure/overdue.job.ts` | job-derived only — manual status mutation path absent by construction; idempotent recompute; grace honored |
| T10 | Collections: receipt→line allocation reuse + WAIVE (permission + reason + audit) | `apps/api/src/modules/installments/application/collection-service.ts` | line `receipt_refs` accumulate; Σ line collections ≤ invoice outstanding (INV-016 tie); waive audited; foreign line → 404 |
| T11 | Late-fee service: policy jsonb (rate + cap + grace — PLACEHOLDER defaults), G-28 engine-only posting | `apps/api/src/modules/installments/application/late-fee-service.ts` | G-28 golden (2% of 500.00 = 10.00 → `DR AR_CONTROL · CR LATE_FEE_INCOME`); cap honored; no compounding path exists; OQ-002 defaults documented |
| T12 | RC-11 reconciliation check + five report contracts + block-on-fail ties | `apps/api/src/modules/accounting/application/reconciliation/*` (registration), `reporting/registry/notes-installments/*.contract.ts` | RC-11 green after each event; seeded drift → `BROKEN` + close block (PC-04); aging as-of determinism |
| T13 | Golden + invariant + rule suites | `tests/accounting/golden/G-24*,G-25*,G-26*,G-27*,G-28*`, `tests/accounting/invariants/INV-024*`, `tests/notes/notes-rules.spec.ts`, `tests/installments/installments-rules.spec.ts` | all green (blocking); failure packs zero-residue |
| T14 | UI screens + `TimelinePanel` pattern + baselines (note detail custody timeline, maturity calendar workspace, plan wizard, aging lists) | `apps/web/src/app/(app)/notes/**`, `apps/web/src/app/(app)/installments/**`, `packages/ui/src/patterns/timeline-panel/*` | AR+EN baselines; axe + keyboard; calendar staleness badge; wizard live schedule preview |
| T15 | Attack registration + docs sync (incl. `treasury.cheques` re-point per register §D + PHASE-008/012 pointer verification) | `tests/isolation/**`, `docs/product/FEATURE_CATALOG.md`, `docs/security/**`, `docs/ui/**` | isolation + permission checklists green; docs validation green |

## 6. Verification

**Automated tests (required):**

- Golden posting tests with expected journal lines + custody state + event row +
  audit events ([ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §1
  conventions), each asserting the seven effect-matrix cells: **G-24**
  (1,000.00 cheque received against invoice 1,000.00: `DR NOTES_RECEIVABLE 1,000 ·
  CR AR_CONTROL 1,000`, open item settled, note IN_CUSTODY), **G-25** (`DR CASH
  1,000 · CR NOTES_RECEIVABLE 1,000` at COLLECT; DEPOSIT posts nothing), **G-26**
  (`DR AR_CONTROL 1,000 · CR NOTES_RECEIVABLE 1,000` + optional fee 25.00 via
  `BANK_CHARGES`; restored open item byte-equal to the original), **G-27** (issue
  2,500: `DR AP_CONTROL · CR NOTES_PAYABLE`; maturity mirror `DR NOTES_PAYABLE ·
  CR CASH`), **G-28** (late fee 10.00: `DR AR_CONTROL · CR LATE_FEE_INCOME` as a new
  AR open item). FX mirrors: foreign-currency note collected at a moved rate →
  explicit `FX_GAIN`/`FX_LOSS` residual with the original stored rate honored
  (INV-008).
- Failure packs per golden — `PERIOD_LOCKED` (event in a LOCKED period, INV-011),
  `PURPOSE_NOT_MAPPED` (unmap `NOTES_RECEIVABLE` / `NOTES_PAYABLE` /
  `NOTES_DISCOUNT_EXPENSE` / `LATE_FEE_INCOME`), `ALREADY_POSTED` (duplicate
  dishonor — INV-013), `INVALID_CUSTODY_TRANSITION` (DISHONOR of a COLLECTED
  note), `DISHONOR_REASON_REQUIRED`, `PLAN_TOTAL_MISMATCH` (BR-048),
  `SCHEDULE_IMMUTABLE` (edit after activation), allocation exceeding the invoice
  outstanding (INV-016) — each with zero ledger/event/document residue.
- INV-024 suite (property tests over the whole custody graph): a note's
  `NOTES_RECEIVABLE` balance is the full amount in IN_CUSTODY/ENDORSED_OUT/
  DEPOSITED and **zero** in COLLECTED/DISHONORED/DISCOUNTED/RETURNED; the issued
  mirror holds on `NOTES_PAYABLE`; dishonor restores the AR open item **exactly**
  (amount + partner + references); endorsement produces zero journal rows
  (ledger-delta assert).
- RC-11: after each event set the notes subledger ties to `NOTES_RECEIVABLE` /
  `NOTES_PAYABLE`; seeded drift (event without journal) → `BROKEN` with the
  offending note id + period-close block (PC-04).
- PDC calendar: bucket correctness after every event kind; job idempotency
  (re-run → same buckets, no duplicates); staleness labeling when the job lags.
- Installment rules: OVERDUE job-derived only (no manual write path exists);
  grace + waiver interactions; DEFAULTED flip per policy; Σ plan remaining ties
  the invoice open item (INV-016); late-fee cap + flat-only (no compounding code
  path — negative test).
- Rule tests: BR-045 (partner + maturity required; calendar auto-derived),
  BR-046 (reason + exact restore + optional fee), BR-047 (no journal on
  endorsement), BR-048 (total equality + immutability), BR-049 (policy shape +
  PLACEHOLDER defaults) — `notes-rules.spec` + `installments-rules.spec`.
- Isolation: A1–A10 on all four tables; foreign partner/invoice/contract/note/
  line ids in nested payloads → typed 404, no partial creation (S-04); A7 on all
  routes; permission checklist for §3.12 incl. audited use of `record_dishonor`,
  `discount`, `return`, and `lines.waive`.

**Manual verification:**

1. Receive a 30-day cheque against a 1,000.00 open invoice → AR settles, the note
   shows IN_CUSTODY with the G-24 journal; the calendar's 30-day bucket updates.
2. Endorse the cheque to a supplier → custody ENDORSED_OUT, **no** journal appears
   (GL drill-down proof); later record the endorsee's collection → COLLECTED posts
   G-25.
3. Instead of step 2, deposit + collect at maturity → G-25 with the treasury
   movement visible in the INV-019 screen; then repeat with a bounced cheque:
   dishonor with reason → AR restored exactly (the customer statement shows the
   invoice open again), optional 25.00 fee in `BANK_CHARGES`.
4. Issue a promissory note to a supplier → AP settles; at maturity record payment
   → the G-27 paid leg posts and the note resolves.
5. Build a 10-month plan over a 12,000.00 credit invoice (2,000 down payment via
   receipt, 10 × 1,000): activation succeeds; editing a line → refused; pass a due
   date → the job marks OVERDUE; charge the late fee → G-28 open item; waive one
   line with a second user → audited.
6. Open `notes.aging` and `installments.aging` → as-of re-runs are byte-identical;
   the footer tie shows Σ open notes = `NOTES_RECEIVABLE` balance.

**Acceptance criteria (objective):**

1. Every notes/installments posting goes through the engine with its canonical
   G-row shape (G-24/G-25/G-26/G-27 both legs/G-28 green with line-level asserts),
   INV-013 idempotency per source/operation, and zero journal rows for
   endorsement/DEPOSIT/RECLASSIFY events.
2. INV-024 is enforced and tested: custody equals ledger effect across the full
   state graph; COLLECTED/DISHONORED/DISCOUNTED/RETURNED notes carry zero
   `NOTES_RECEIVABLE` balance; dishonor restores the AR open item exactly
   (amount, partner, references).
3. BR-046 enforced: dishonor requires a reason; the optional fee posts via
   `BANK_CHARGES`; the restored item appears in AR aging and the customer
   statement with its original references.
4. The PDC calendar is job-derived from `maturity_date` only, correct after every
   event, idempotent under re-runs, freshness-labeled — never stale-silent; no
   posting can originate from the calendar.
5. Installment plans enforce BR-048 (total = source document total, activation
   blocked otherwise) and schedule immutability after activation; plans never
   duplicate AR (Σ line collections ≤ invoice outstanding, INV-016 tie).
6. Line statuses are job-derived only (OVERDUE via the daily job honoring
   grace); WAIVED is the sole manual transition — permission-gated,
   reason-required, audited.
7. Late fees post only via the engine (G-28) per the plan's policy (rate + cap +
   grace with documented PLACEHOLDER defaults, OQ-002 family); flat fees only —
   no interest computation or compounding code path exists (negative test green).
8. RC-11 is green in the permanently-blocking CI set; seeded drift is detected as
   `BROKEN` with the offending note and blocks period LOCK (PC-04).
9. All four tables are in the isolation registry with A1–A10 green; foreign
   references are rejected with typed 404s and zero partial creation; the §3.12
   permission checklist is green with audit on risky actions.
10. The five report contracts are registered with block-on-fail ledger ties and
    as-of determinism; nav additions (الخزينة ×2, المبيعات ×1) carry bilingual
    labels + featureKeys; the `treasury.cheques` re-point and the PHASE-008/012
    pointers are in place (ED-03 chain closed).

**Performance & security considerations:** the calendar and OVERDUE jobs are
bounded pg-boss jobs (chunked per tenant; a 100k-note tenant's calendar refresh is
p95 < 30 s target); aging queries index on `(tenant_id, status, maturity_date)` /
`(tenant_id, plan_id, due_date)`; reports reuse the reporting cache with as-of
semantics in the key. `note_events` is append-only (grants + trigger) so custody
history cannot be rewritten; every custody action is audited; note-id enumeration
returns 404 (A7); no bank credentials or connectivity exist in this phase.

**Migration & rollback:** additive migration `0027_notes_installments.sql` (+
append-only grants/triggers on `note_events`); no destructive changes; posted
events are immutable so rollback = previous image (expand-compatible per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md)); corrections are
reversal-only (INV-014); the calendar/overdue read models are regenerable (re-run
the jobs after any rollback).

## 7. Risks and Constraints

- RISK-009 extends here: a wrong G-24/G-26 pair corrupts AR and the notes ledger
  **asymmetrically** (the exact failure INV-024 exists to catch) — mitigated by
  golden-first ordering, the INV-024 property suite, and RC-11 before any UI polish
  counts as done.
- Plan↔invoice divergence: a credit note raised after activation reduces the
  invoice's outstanding while the schedule is immutable — the wizard and docs
  state the explicit path: audited line waivers / manual plan CLOSE absorb credit
  notes; **never** silent recompute; residual zero closes the plan.
- Calendar job failure or lag → decisions on stale data: mitigated by freshness
  stamps, job-lag alerting, and the rule that no posting originates from the
  calendar (events only).
- Late-fee policy ambiguity: defaults are PLACEHOLDER (OQ-002 family) and
  documented in the settings schema; the OQ-002 pricing pass may revise defaults —
  configuration, not code; compounding is excluded by construction (riba stance).
- Endorsee-chain information lag (the tenant learns of collection/dishonor late):
  the event date is the economic date; the recording date is audited separately —
  statements render by event date; invariant checks are date-agnostic.
- Constraint: cheques are delivered by `notes` (ED-03) — treasury must not grow a
  parallel cheque lifecycle; the receipts `method` value stays a payment-method
  flag with no custody semantics.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-027-COMPLETION.md` with: golden
  outputs (G-24…G-28 incl. FX mirrors + failure packs), INV-024 + RC-11 outputs
  (incl. seeded-drift `BROKEN` evidence), custody-state transition matrix test
  output, calendar + OVERDUE job evidence at volume (idempotency + staleness),
  plan-wizard and custody-timeline baselines, isolation + permission checklists,
  and the doc-sync diff summary (incl. the `treasury.cheques` re-point).
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-027 row per protocol), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + new TABLES
  `notes-installments.md` spec + ERD refresh,
  [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §9 (7 enums),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (12 keys + the
  `treasury.cheques` re-point per register §D),
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (5 rows) ·
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.12 (+ §4
  rows if flagged) · [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md)
  (الخزينة + المبيعات items) ·
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-045…049 + §8 rows) ·
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (G-24…G-28) ·
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md) (INV-024)
  · [RECONCILIATION.md](../../accounting/RECONCILIATION.md) §1 (notes subledger
  row) · [BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §10 + §12 ·
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (suites + RC-11) ·
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 (PHASE-027 row)
  · [COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) (`TimelinePanel`);
  acceptance criteria copied into
  [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).
- **Exit criteria:** all 10 acceptance criteria green with evidence; INV-024 and
  RC-11 in the permanently-blocking CI set; a tenant can receive a cheque against
  an invoice, see it on the maturity calendar, deposit and collect it, dishonor it
  with the AR restored exactly, endorse without a journal, discount with an
  explicit expense, and sell on installments with overdue flags and flat late
  fees — in Arabic and English — with custody and ledger provably equal.
- **Definition of Done:** every note's custody state and its ledger effect are one
  and the same thing (INV-024); every installment riyal traces to exactly one
  invoice open item; no interest computation exists anywhere in the system.
- **Handoff instructions:** read the PHASE-027 completion report. The maturity
  calendar and RC-11 extend the treasury/period-close contracts; the G-24/G-26
  pair is the pattern future custody-style features must copy. **Consumers of
  this phase:** PHASE-030 (`industry.wholesale` flagship `notes.received`),
  PHASE-031 (healthcare claims cheques via notes), PHASE-032 (education tuition
  via `installments.plans`) per
  [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B/§L. **Next eligible
  phase: PHASE-028 / PHASE-029** — parallel-capable after GA (each depends only on
  pre-GA phases); the agent protocol executes one at a time (identify only; do
  not implement).
