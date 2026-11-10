# TABLES — Notes & Installments Cluster (PHASE-027)

> **Status:** DELIVERED (PHASE-027, migration `0038_notes_installments.sql`, schema_version
> 38) · **Owner:** Database Architecture · **Updated:** 2026-11-07 · Column-level specs for
> the PHASE-027 cluster (the notes register + its append-only custody log, installment
> plans + their lines), authored in-phase per the file header rule
> (ENTITY_CATALOG §notes/§installments is the catalog-level map; this file is the
> column-level truth). ADR-0009 precision discipline throughout: money quanta
> `numeric(19,4)`, note rates `numeric(19,6)` (decimal strings on the wire, never floats,
> no `Math.*` — see the rate note under §notes). All tables are status-lifecycled
> (SELECT/INSERT/UPDATE for `erp_app`) **except** `note_events` which is append-only 🔒
> by grants (SELECT/INSERT/DELETE with the `erp.note_events_guard()` trigger owning the
> DELETE policy — the `depreciation_lines`/INV-003 pattern) and `installment_lines`
> which carries DELETE for the DRAFT-plan edit path only (the service never deletes an
> activated plan's lines — immutability after activation is service discipline, BR-048).
> RLS macro on every table; the isolation registry covers each (A1–A10). No table here
> writes `journal_*` or `cash_movements` — every posting flows through the centralized
> posting engine (ADR-0007; INV-013 sources `note/post|collect|dishonor|discount|return`
> and `installment_line/late_fee`) and every money leg runs through the treasury store
> API (`cash_movements` is treasury-owned; source_type `'note'` per the 0038 widening).

## §notes — the register (T2)

One row per instrument. `kind` CHECK `CHEQUE|PROMISSORY_NOTE` + `direction` CHECK
`RECEIVED|ISSUED` (§9 enums; the custody enum is shared with mirrored semantics for
ISSUED). **BR-045**: `partner_id` (composite FK → partners, RESTRICT) and `maturity_date`
(date, §11) are NOT NULL — a note without partner and maturity can neither settle nor
appear on the calendar. `number` is the instrument's own number as data (ADR-0006 — no
official sequence fabricated) + `issuing_bank` text. Money: `amount` (19,4, CHECK > 0) +
`currency` (CHECK `^[A-Z]{3}$`) + `exchange_rate` (**19,6**, CHECK > 0, DEFAULT 1 —
stored INV-008, never recomputed; the six-decimal width matches the treasury read
paths' `amount × rate` products). `issue_date` date NULL; `status` CHECK
`IN_CUSTODY|ENDORSED_OUT|DEPOSITED|COLLECTED|DISHONORED|DISCOUNTED|RETURNED` (§9
`note_status`; default IN_CUSTODY — the resolved four are terminal per the custody
machine). `source_type`/`source_id` are polymorphic (CHECK the pair is both-NULL or
both-set AND `source_type IN ('sales_invoice','supplier_invoice')` — service-validated
own-tenant, never a fabricated FK). The delivered additions: **`cash_account_id`**
(composite FK → cash_accounts, RESTRICT — stored at DEPOSIT, used by the
G-25/G-27/discount/dishonor-fee money legs) and **`journal_entry_id`** (the G-24/G-27
create entry — the document↔journal chain, INV-006) + the `note`/`note_ar` memo pair.
Constraints: `uq_notes_id_tenant`. Indexes: `ix_notes_tenant_status_maturity` (the
calendar/aging surface), `ix_notes_tenant_direction_status`, `ix_notes_tenant_partner`,
`ix_notes_tenant_source`.

## §note_events 🔒 — the append-only custody log (T2)

The audit substrate of INV-024. `note_id` composite FK → notes (RESTRICT); `event_kind`
CHECK `ENDORSE|DEPOSIT|COLLECT|DISHONOR|DISCOUNT|RETURN|RECLASSIFY` (§9
`note_event_kind`); `event_date` is the **economic** date (statements render by it; the
recording date is `created_at`, audited separately); `refs` jsonb carries the event's
references (e.g. the repointed allocation list on dishonor/return); `journal_entry_id`
NULL **exactly** for the no-journal events — `ck_note_events_journal_shape` enforces
`(event_kind IN ('ENDORSE','DEPOSIT','RECLASSIFY')) = (journal_entry_id IS NULL)`
(BR-047 as a shape constraint); `memo`/`memo_ar` pair. **Grants give `erp_app`
SELECT/INSERT/DELETE only** (UPDATE never); the `trg_note_events_guard` trigger (BEFORE
UPDATE OR DELETE) blocks everyone except the offboarding purge path
(`erp.purge_mode` — the 0036/0037 discipline; even then only `erp_migrate` holds the
DELETE policy). RECLASSIFY records audited metadata corrections with no journal and no
custody change. Constraints: `uq_note_events_id_tenant`. Index:
`ix_note_events_tenant_note` (tenant, note, event_date — the custody-timeline source
and the as-of reconstruction input for the reports).

## §installment_plans — the collection overlay (T8)

A plan is an **amortization view of a source document, not a new obligation**: the AR
open item remains the credit sales invoice (PHASE-012) or the service contract
(PHASE-019 `crm.service_contracts`) — no new AR open items are created, so subledger =
control stays intact (Σ line collections ≤ invoice outstanding, the INV-016 tie).
`partner_id` composite FK → partners (RESTRICT); `source_type` CHECK
`sales_invoice|service_contract` + `source_id` + `source_no` (the document number for
display); **one plan per source document** (`uq_installment_plans_tenant_source`).
Money: `total_amount` (19,4, CHECK > 0) + `down_payment` (CHECK `0 ≤ down_payment <
total_amount`); `line_count` (CHECK ≥ 1); `start_date` date; `frequency` CHECK
`WEEKLY|BIWEEKLY|MONTHLY|QUARTERLY` (§9). **`status` is NULL = draft** (pre-activation
— the §9 `installment_plan_status` enum lists the activated lifecycle states only:
ACTIVE/CLOSED/DEFAULTED; the CHECK admits NULL and `ck_installment_plans_activated_shape`
ties `status IS NULL ⇔ activated_at IS NULL`). Activation is the BR-048 gate: plan total
must equal the source document total exactly, else typed `PLAN_TOTAL_MISMATCH`; after
activation the schedule is immutable (edit → 409 `SCHEDULE_IMMUTABLE`).
`late_fee_policy` jsonb NOT NULL (BR-049) — shape `{rate, cap, grace_days, auto_charge,
defaulted_after_lines}` with **PLACEHOLDER defaults per the OQ-002 family, never
silent**: `rate "0.0200"` (flat % of the line), `cap "500.0000"`, `grace_days 7`,
`auto_charge false`, `defaulted_after_lines 3` (the DEFAULTED flip after N consecutive
overdue lines). **Flat fees only** (DR-003 riba stance — no interest computation, no
compounding code path exists; negative-tested). Lifecycle stamps `activated_at`/
`activated_by`, `closed_at`, `defaulted_at` + `note`/`note_ar`. Constraints:
`uq_installment_plans_id_tenant`. Index: `ix_installment_plans_tenant_partner`
(tenant, partner, status).

## §installment_lines — the dues schedule (T9/T10)

One line per (plan, seq): `uq_installment_lines_plan_seq` (CHECK seq ≥ 1); `due_date`
date; `amount` (19,4, CHECK > 0). **`status` is job-derived ONLY** (§9
`installment_line_status`; the daily `installments.daily-sweep` pg-boss job, cron
`40 2 * * *`: PENDING → DUE at `due_date`, → OVERDUE after the policy grace, → PAID when
covered by attributed collections — no manual status write path exists) **except WAIVED**,
the sole manual transition (permission `installments.lines.waive` + reason + audit,
sticky under the sweep — `ck_installment_lines_waived_shape` ties
`status = 'WAIVED' ⇔ waived_at IS NOT NULL`; the waiver trio `waived_at`/`waived_by`/
`waive_reason`). `receipt_refs` jsonb DEFAULT `[]` accumulates the attributed receipt
slices `{receiptId, receiptNo, amount, valueDate}`; `collected_amount` (19,4, CHECK
`0 ≤ collected ≤ amount` — INV-016). The G-28 stamps: `late_fee_amount` /
`late_fee_entry_id` / `late_fee_charged_at` (shape CHECK: amount set ⇔ entry set; INV-013
`installment_line/late_fee` once per line). Composite FK → installment_plans (RESTRICT).
DELETE exists only for the DRAFT-plan edit path (the wizard restructures a draft
schedule; the service never deletes after activation). Indexes:
`ix_installment_lines_tenant_plan_due` (tenant, plan, due_date — the aging/sweep
surface), `ix_installment_lines_tenant_status_due`.

## The settle/restore algebra — `treasury_allocations.note_id` + the repoint (T3/T5)

- **Widening (0038)**: `treasury_allocations` ADD `note_id` uuid NULL (NULL for every
  pre-0038 row) + the **exactly-one-of-three** CHECK
  (`receipt_id` + `payment_id` + `note_id` counts to 1) + composite FK
  `(note_id, tenant_id)` → notes ON DELETE RESTRICT (notes are never deleted; the
  offboarding purge deletes allocations first — FK order) + the partial unique index
  `uq_treasury_allocations_note_item` `(tenant_id, note_id, open_item_id) WHERE note_id
  IS NOT NULL` (per-document uniqueness — NULLs are distinct in a plain UNIQUE, so the
  exactly-one-of-three CHECK needs one partial unique per doc kind; the note partial
  mirrors the receipt/payment pair) + `ix_treasury_allocations_tenant_note`.
- **Effective by presence**: a note's allocations settle open items exactly the way
  receipts/payments do — the settled-sum read models add the note branch
  (`OR (a.note_id IS NOT NULL)`) with **no status filter**: rows only exist while the
  note create posted atomically with its G-24/G-27 entry, and dishonor/return repoints
  them.
- **The repoint-restore mechanic (dishonor G-26 / return)**: (1) post the restore
  journal — RECEIVED: `DR AR_CONTROL (partner line — INV-009(a) forces the partner) ·
  CR NOTES_RECEIVABLE` (+ optional fee legs `DR BANK_CHARGES · CR cash` + a treasury
  movement OUT); ISSUED mirror: `DR NOTES_PAYABLE · CR AP_CONTROL (partner line)`;
  (2) the engine creates the journal's control debit subledger entry (E3); (3) DELETE
  the note's allocation rows and INSERT **one consolidated row** anchored at E3. The
  ORIGINAL open item's outstanding comes back **byte-equal** (its row is untouched —
  same id, partner, amount, original invoice refs); E3 is anchored (outstanding 0) so
  the aging never double-counts and `partner_balances` ties. Audit carries the
  before/after allocation lists; the `note_events` row carries `journal_entry_id` +
  refs.
- **On-account notes** (no invoice): no allocations to repoint — the restore journal's
  partner line lands as a NEW explicit open item (the honest representation: the debt
  needs an item to age against; documented).
- **`cash_movements` source widening (0038, the P27-G fix)**: `source_type` CHECK gains
  `'note'` for the collection/discount/dishonor-fee movements — and the widening is
  **ADDITIVE**: the 0025 kinds (`'sales_invoice'`, `'rep_settlement'`) survive the
  re-declared CHECK (the first draft re-declared 0012's list + `'note'` only and every
  cash invoice G-02 violated the constraint — found by re-running the sales suite).

## RLS, the purge path & the platform widenings (0038)

- **RLS**: `erp.apply_tenant_policy` on all four tables (the house macro — FORCE RLS,
  `tenant_isolation` USING/WITH CHECK on `erp.current_tenant_id()`), each registered in
  the isolation suite's table registry with generated A1–A10 coverage (`note_events`
  registered `deleteGranted: true` — the append-only grant proof; `installment_lines`
  likewise for the draft-plan edit path).
- **Purge path (the 0036 discipline)**: `purge_path_delete`/`purge_path_update` policies
  for `erp_migrate` confined to the GUC-named tenant on every new table (idempotent
  drop+create) — the offboarding sweep only, never the app plane.
- **RC-11 widening**: `reconciliation_runs.kind` CHECK widened with `'NOTES'` (the 0012
  BANK_REC / 0037 FIXED_ASSETS pattern) so the notes register reconciliation registers
  in the PHASE-007 framework — Σ live notes (amount × stored rate) per purpose side ==
  the mapped `NOTES_RECEIVABLE`/`NOTES_PAYABLE` balance (issued side read
  credit-positive, the GRNI convention); seeded drift → `BROKEN` + notification + the
  PC-04 close block; NIGHTLY leg 2:30 UTC + ON_DEMAND
  `POST /api/v1/notes/reconciliation/notes-check`.
- **Notification categories (the 0023/0027/0035 widening pattern)**: `notifications` +
  `notification_prefs` category CHECKs gain `'notes'` (dishonor surfacing — audited +
  inbox, BR-046) and `'installments'` (DEFAULTED dunning + overdue surfacing).
- **CoA template markers**: `1170 NOTES_RECEIVABLE` (asset leaf, parent 1100), `2150
  NOTES_PAYABLE` (liability leaf, parent 2100), `4920 LATE_FEE_INCOME` (revenue, parent
  4900), `5260 NOTES_DISCOUNT_EXPENSE` (expense, parent 5200) — the onboarding
  instantiation copies them + their purposes into every provisioned tenant; existing
  tenants map via `account_purposes` (fail-closed `PURPOSE_NOT_MAPPED`).

## Grants & roles (migration 0038)

`SELECT, INSERT, UPDATE` for `erp_app` on `notes` and `installment_plans` (status
transitions + draft edits + activation/lifecycle flips; no DELETE — custody history is
the events log, plans are superseded never deleted); `SELECT, INSERT, DELETE` on
`note_events` (append-only 🔒 — the guard trigger owns the DELETE policy; UPDATE is
grant-denied outright); `SELECT, INSERT, UPDATE, DELETE` on `installment_lines` (DELETE
confined to the DRAFT-plan edit path by the service). `SELECT` for `erp_readonly` +
`erp_definer` on all four. Permission seeds (AUTHORIZATION_MATRIX §3.12 — 10 keys,
drift-checked 245=245): `notes.notes.view|create|endorse|deposit|record_dishonor|
discount|return` + `installments.plans.view|manage` + `installments.lines.waive`;
role grants: owner (every tenant-plane key), accountant (all ten incl. the risky
`record_dishonor`/`discount`/`return`), sales + purchasing (`notes.notes.view|create`),
viewer (`notes.notes.view`, `installments.plans.view`). Plan grants (FEATURE_CATALOG
§20/§21): the twelve PHASE-027 feature keys join business + enterprise (the tier-4
financial-depth precedent — fixed_assets 0037); starter does NOT get them. Collections
are ordinary sales receipts (no new receipt keys).
