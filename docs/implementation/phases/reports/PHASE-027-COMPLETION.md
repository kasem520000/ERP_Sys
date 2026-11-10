# PHASE-027 Completion Report — Cheques, Promissory Notes & Installments

> **Status:** COMPLETE · **Date:** 2026-11-07 · **Migration:** `0038_notes_installments.sql`
> (schema_version 38) · **Phase doc:** `docs/implementation/phases/PHASE-027.md`
> (T1–T15 all green) · **Decision authority:** DR-003 (notes & installments) — ACCEPTED;
> ED-03 closes the v1.1 `treasury.cheques` deferral chain here.

## 1. What shipped (the one-paragraph truth)

The `notes` + `installments` modules per DR-003/ED-03: **four tenant-owned tables**
(`notes` with `cash_account_id` + `journal_entry_id` + bilingual memos, `note_events` 🔒
append-only with the policy-owning guard trigger, `installment_plans` with status NULL =
draft + `late_fee_policy` jsonb, `installment_lines` with `receipt_refs` attribution +
`late_fee_*` stamps), all RLS'd (tenant_isolation + the 0036-pattern purge_path policies)
with composite tenant FKs; **the settle/restore substrate**: `treasury_allocations.note_id`
(exactly-one-of-three) so notes settle AR/AP open items exactly like receipts/payments,
with dishonor/return restoring the original item **byte-equal via the repoint** (DELETE
the note's rows, INSERT one consolidated row anchored at the restore journal's control
debit entry — outstanding 0, aging never double-counts); the custody machine (legal
transitions per direction, resolved statuses terminal); the golden posting flows
**G-24** (receive — BASE-denominated, allocated at the items' original stored rates),
**G-25** (collect — explicit `FX_GAIN`/`FX_LOSS` residual r₁ vs r₀, treasury movement
`source_type 'note'`), **G-26** (dishonor — reason required, optional `BANK_CHARGES` fee
legs), **G-27** (issue + paid mirror), **G-28** (flat late fees, engine-only); the PDC
maturity calendar (job-derived cached read model — deliberately no new canonical entity;
daily sweep 2:20 UTC + on-event invalidation + >26 h staleness labeling); **RC-11**
(kind `NOTES`: Σ live notes amount×r₀ per purpose side == the mapped
`NOTES_RECEIVABLE`/`NOTES_PAYABLE` balance, issued side credit-positive; seeded drift →
`BROKEN` + PC-04 close block; NIGHTLY 2:30 UTC + ON_DEMAND
`POST /api/v1/notes/reconciliation/notes-check`); the installments plan builder (BR-048
total equality, schedule immutability, one plan per source), the daily sweep (2:40 UTC —
job-derived line states only; WAIVED the sole manual transition; DEFAULTED flip +
dunning), collections via the allocation reuse (plans never duplicate AR); **the four
v2.0 CoA purposes** (1170/2160/4920/5260 — provisioned tenants resolve all four from day
one); **the NEW permission key `notes.notes.return`** (0004 edited in-phase + 0005
accountant grant — matrix↔seed parity **244→245**); **plan grants** (12 feature keys →
business + enterprise, the tier-4 precedent; starter NOT); **5 report contracts**
(`notes.maturity-calendar`/`notes.aging`/`notes.dishonored-register` +
`installments.schedule`/`installments.aging` — **registry 71→76**, as-of determinism via
the custody-log reconstruction, block-on-fail RC-11 ties); the web screens (`/notes` ×4,
`/installments` ×3) + the `TimelinePanel` pattern (AR+EN baselines) + the 3 NAV_ITEMS +
i18n **3,599→3,799/locale**.

## 2. Task-by-task evidence (T1–T15)

| # | Task | Evidence |
|---|------|----------|
| T1 | Migration `0038_notes_installments.sql` | 4 tables + 7 §9 enum CHECKs (the `installment_plans` status CHECK admits NULL = draft) + RLS (tenant_isolation + purge_path ×4) + the `note_events` guard trigger + grants + 4 CoA rows (1170/2160/4920/5260 — the first draft collided with 0026 WIP 1160 + 0025 COMMISSION_ACCRUAL 2150; the tenancy-provisioning counters caught it, codes moved) + the `notes.notes.return` seed edit + plan grants + the `treasury_allocations.note_id` widening (exactly-one-of-three + partial unique + composite FK) + the `cash_movements` source widening (`'note'`, ADDITIVE — the 0025 kinds preserved) + the RC-11 kind widening + the notifications categories. Verified live: schema_version 38, `check:rls` **203 catalog tables OK** (199 + the four 0038 tables, pre-catalogued at blueprint level ED-19 — no drift), migrations apply cleanly on the embedded PG 16 chain 0001–0038. |
| T2 | Note register + custody machine + append-only log | `note-service.ts` + `custody-machine.ts` (102 LOC — the legal transition tables both directions; resolved statuses terminal; typed `INVALID_CUSTODY_TRANSITION`) + `notes.store.ts` (repointNoteAllocations + findControlEntryForJournal); `note_events` immutable by grants + `trg_note_events_guard` (UPDATE never; DELETE only under `erp.purge_mode`); `ck_note_events_journal_shape` (no-journal events carry no journal, BR-047 as a shape constraint); foreign partner/invoice refs → typed 404 (spoof.spec ×5). |
| T3 | G-24 receive + G-27 issue | `receive-service.ts` + `issue-service.ts` + `note-allocations.ts` (310 LOC — the shared allocation machinery: explicit allocations or the single-source default, remainder on-account BR-027, INV-016 both bounds under the CC-02 advisory lock with the SAME typed treasury codes, `NOTE_RATE_MISMATCH` for foreign notes whose stored rate ≠ the item's); the create journals are BASE-denominated with explicit base line amounts (the fx-settlement precedent); G-24/G-27 legs asserted in notes-rules.spec. |
| T4 | Deposit/collect (G-25) + FX reuse | `collection-service.ts` (297 LOC) — DEPOSIT stores `cash_account_id`, no journal; COLLECT posts `DR CASH · CR NOTES_RECEIVABLE` with cash at r₁ vs the note leg at r₀ → explicit `FX_GAIN`/`FX_LOSS` (the receipt G-06 mirror); the treasury movement through the store API (INV-019 exact, `source_type 'note'`); the ISSUED paid-at-maturity mirror. |
| T5 | Dishonor (G-26) | `dishonor-service.ts` (357 LOC) — reason required (`DISHONOR_REASON_REQUIRED`), optional fee legs `DR BANK_CHARGES · CR cash` + movement OUT, **the repoint-restore algebra** (restored open item byte-equal — asserted; the anchored entry at outstanding 0; `partner_balances` ties), audited + inbox notification (category `notes`); DISHONORED → zero note balance. |
| T6 | Endorsement + return + discount | `endorsement-service.ts` (custody only — the ledger-delta test asserts zero journal rows) + `returnNote` (the restore side without reason/fee — `notes.notes.return`) + `discount-service.ts` (`DR cash proceeds · DR NOTES_DISCOUNT_EXPENSE · CR NOTES_RECEIVABLE`; fee explicit; base-currency only this phase — typed `NOTE_DISCOUNT_CURRENCY_UNSUPPORTED`, the honest deferral). |
| T7 | PDC maturity calendar | `pdc-calendar.job.ts` (cron `20 2 * * *` + the RC-11 sweep `30 2 * * *`) + `pdc-calendar-queries.ts` (183 LOC — the per-tenant cached snapshot: buckets OVERDUE/THIS_WEEK/D30/D60/D90/BEYOND two-sided, by-partner/by-bank drills, `computedAt` + `stale` >26 h labeled never silent, on-event invalidation); `pdc-calendar.spec` 8 + the 100k-note perf spec. |
| T8 | Installment plan builder | `plan-service.ts` (384 LOC) — the wizard schedule computation with last-line remainder absorption (Σ == total − down EXACTLY), BR-048 total equality at activation (`PLAN_TOTAL_MISMATCH`), schedule immutability (409 `SCHEDULE_IMMUTABLE`), one plan per source (`uq_installment_plans_tenant_source`), base-currency sources only (typed `PLAN_SOURCE_CURRENCY_UNSUPPORTED` — honest deferral), `late_fee_policy` normalization with the PLACEHOLDER defaults (rate 2% / cap 500 / grace 7 d / auto_charge off / defaulted_after 3 — OQ-002 family, never silent). |
| T9 | OVERDUE/DEFAULTED jobs | `overdue.job.ts` (`installments.daily-sweep`, cron `40 2 * * *`) — line states rebuilt from source data (PENDING → DUE at due_date → OVERDUE after grace → PAID via `receipt_refs` attribution); no manual status write path exists; WAIVED sticky; DEFAULTED flip after N consecutive overdue + dunning notification (category `installments`); `overdue-job.spec` 4 (idempotent recompute, grace honored). |
| T10 | Collections + WAIVE | `installments/collection-service.ts` (326 LOC) — receipts allocate to plan lines reusing the PHASE-008/012 allocation service (`receipt_refs` accumulate; Σ line collections ≤ invoice outstanding — the INV-016 tie); WAIVED permission-gated + reason + audit; late-fee charge `DR AR_CONTROL · CR LATE_FEE_INCOME` engine-only. |
| T11 | Late-fee service (G-28) | In `collection-service.ts` (source `installment_line/late_fee`, INV-013 once per line; cap honored; flat only — no compounding code path exists, negative-tested); the G-28 golden (2% of 500.00 = 10.00) in installments-rules.spec 7. |
| T12 | RC-11 + 5 report contracts | `notes-reconciliation.ts` (295 LOC — kind NOTES; the register fold exported for the INV-024 spec; `NOTES_PAYABLE` read credit-positive the GRNI convention; GL-without-register side surfaced; BROKEN → audit + critical inbox + PC-04; the close-checklist item `reconciliation.notes`) + `registry/notes/` + `registry/installments/` (1,800 LOC — 5 contracts, permissions `notes.notes.view`/`installments.plans.view`, as-of reconstruction from the append-only custody log, the RC-11 block-on-fail ties); registry snapshot **76** (50 core + 18 industry + 3 fixed assets + 5 notes/installments) in golden.spec + the unit meta. |
| T13 | Golden + invariant + rule suites | `notes-rules.spec` 27 (BR-045…047 + G-24…G-27 line-level asserts + failure packs: `PERIOD_LOCKED`, `PURPOSE_NOT_MAPPED`, `ALREADY_POSTED`, `INVALID_CUSTODY_TRANSITION`, `DISHONOR_REASON_REQUIRED`, `NOTE_RATE_MISMATCH`, zero residue) + `installments-rules.spec` 7 (BR-048/049 + G-28 + `PLAN_TOTAL_MISMATCH`/`SCHEDULE_IMMUTABLE` packs) + `inv-024.spec` 3 (custody equals ledger across the state graph; endorsement zero-journal ledger-delta) + `rc-11.spec` 2 (green per event set; seeded drift → `BROKEN` + PC-04) + `pdc-calendar.spec` 8 + perf + `overdue-job.spec` 4 + the spoof batteries ×5+×5. |
| T14 | UI screens + `TimelinePanel` | `apps/web/app/[locale]/notes/{page,new,[id],calendar}` + `installments/{page,new,[id]}` + the components (notes-table/form/detail/tabs, pdc-calendar, installments-table/tabs, the plan wizard + detail) + `packages/ui/src/patterns/timeline-panel.tsx` (COMPONENT_CATALOG row + 6 AR+EN visual baselines — the `note_events` custody timeline the first consumer) + the 3 NAV_ITEMS (`treasury.cheques-notes` /notes list-search, `treasury.pdc-calendar` /notes/calendar dashboard, `sales.installment-plans` /installments list-search) + i18n 3,599→3,799/locale (parity check green). |
| T15 | Attack registration + docs sync | The isolation registry +4 tables (A1–A10 generated coverage; `note_events` + `installment_lines` registered deleteGranted with the grant proofs) + SECURITY_TEST_PLAN §2 the PHASE-027 row + the docs sync: IMPLEMENTATION_STATUS row, PHASE_ACCEPTANCE_CRITERIA the ten §6 criteria copied, ENTITY_CATALOG → delivered (0038) + the new TABLES/notes-installments.md spec, DATA_DICTIONARY §9/§14, FEATURE_CATALOG §20/§21 DELIVERED + the `treasury.cheques` re-point per register §D (ED-03 chain closed) + plan-grants note, AUTHORIZATION_MATRIX §3.12 the `notes.notes.return` row (drift 245=245) + §4, NAVIGATION_MODEL §1.1 verified (pdc-calendar archetype → the shipped §1 dashboard), JOURNAL_RULES §7 the delivered posting notes, ACCOUNTING_INVARIANTS INV-024 enforced-by, RECONCILIATION §1 row 11 + §3 close-block, BUSINESS_WORKFLOWS §10/§12, ACCOUNTING_TESTS §1/§5, CHANGELOG — plus the error-filter registration (the notes taxonomy + the SF-027-001 honest 026 repair). |

## 3. Final gate (serial, orchestrator-only — ALL GREEN)

- `pnpm -r typecheck`: **8/8** packages green.
- Root `pnpm run lint` + `lint:depcruise`: **green, 0 violations**.
- Unit suites: **api 370** (incl. the reporting-unit 76-contract meta; the
  permissions-drift docs↔seed spec green after the §3.12 `notes.notes.return` row) ·
  web 73 · desktop 274 · mobile 393.
- **DB suite (chunked foreground, embedded PG 16):** **154 spec files — every one green**
  (~2,094 tests; migrations 0001–0038): the nine new 027 files (notes ×6, installments
  ×3) + the four-table isolation-registry extension in the generated A1–A10 suite.
  Runbook honesty (pre-existing, unchanged by 027): `notifications-email.db.spec`
  (real SMTP session) and `performance/ga-full-load.db.spec`'s §4 EXPLAIN probe are
  timing-sensitive under LARGE batches — both pass in dedicated runs (5/5 and 13/13
  measured) and failed only inside 39+ file chunks; the suite keeps those two in
  dedicated runs (the 025 chunked-foreground discipline already noted the same class).
- Drift battery: `docs:validate` **29/29** · `check:permissions-drift` **245=245** (the
  new `notes.notes.return` key, matrix parity exact) · `check:rls` **203 catalog tables
  OK** (199 + the four 0038 tables — no drift; pre-catalogued at blueprint level ED-19) ·
  `check:capabilities-matrix` **PASS** (rows: 25 PASS · 3 DEFERRED · 16 n/a — #40
  online-only as shipped, #41/#42 honestly deferred) · `check:i18n-parity`
  **3,799=3,799** · `check:observability` **GREEN**.
- Commit-time close-out legs (the 025→026 precedent — bumped in the same commit):
  `CURRENT_SHIPPED_PHASE` 026→027
  (`configuration/application/apply/prerequisites.ts`) + the `migrations.spec`
  last-migration pin 0037→0038. Both are the only two red unit pins at docs-sync time;
  everything else above is green at HEAD.

## 4. Engineering notes (the lessons this phase paid for)

1. **CHECK widenings must be ADDITIVE**: the first draft of the `cash_movements` source
   widening re-declared 0012's list + `'note'` only — every cash invoice post (the sales
   golden G-02) violated `ck_cash_movements_source_shape` because the 0025 kinds
   (`'sales_invoice'`, `'rep_settlement'`) were dropped. Found by re-running the sales
   suite after the notes suites landed: **every widening re-declares the FULL current
   list**.
2. **RC-11's GL read must negate `NOTES_PAYABLE`**: the purpose is credit-natured (G-27
   credits it), so its signed DEBIT−CREDIT balance reads negative while the register
   fold is positive — negate through Decimal (a naive `-${value}` on an already-negative
   string double-flips), exactly the GRNI/fixed-assets accum convention. The drift diff
   is the honest signed GL−register delta, never the absolute GL value.
3. **The repoint beats a "restore journal + counter-allocation" pair**: restoring by
   inserting a second allocation row would double-count in aging (two rows against the
   same open item); anchoring one consolidated row at the restore journal's control
   debit entry keeps the ORIGINAL item byte-equal (same row, original refs) with the new
   entry at outstanding 0 — `partner_balances` ties, INV-024 holds, and the audit
   carries the before/after allocation lists.
4. **On-account notes need a landing item**: an on-account note has no allocations to
   repoint — the dishonor/return partner line lands as a NEW explicit open item (the
   debt needs an item to age against). Documented rather than special-cased.
5. **Report-registry counts are frozen snapshots** — 71→76 across golden.spec + the
   unit meta (the 026 lesson re-applied); `SOURCE_MODULES` gains `notes`/`installments`
   and `REGISTERED_PHASE_WINDOW` 26→27.
6. **CoA template codes are GLOBAL — grep the whole chain, not the founding seed**:
   the first draft picked `1160`/`2150` for NOTES_RECEIVABLE/NOTES_PAYABLE — codes
   ALREADY TAKEN by migration 0026 (`1160` = manufacturing WIP) and 0025 (`2150` =
   automotive COMMISSION_ACCRUAL). The upsert's ON CONFLICT DO UPDATE silently
   HIJACKED those template accounts (WIP would have become "Notes receivable").
   The tenancy-provisioning counters caught it — a provisioned tenant measured 56
   accounts, not 58 — and the fix moved the leaves to `1170`/`2160` (verified free
   across the full chain; fresh tenants now provision 58 accounts / 35 purposes).
   The 026 lesson said "numeric codes collide across migrations"; 027's sharpening:
   the collision check must cover EVERY migration's codes, and the provisioning
   counters are the tripwire that proves it.

## 5. Findings (the honest log)

- **SF-027-001 (pre-existing, found + fixed in-phase):** the 026 `fixed_assets` error
  classes were never registered in the HTTP `domainStatus` map — they surfaced over
  HTTP with the 422 fallback while the codes stayed typed at the service level
  (verified at 027 HEAD). Fixed as the honest in-phase repair: the fixed_assets 404s +
  409s registered exactly as the depreciation-errors header documents, alongside the
  notes + installments taxonomies (`error.filter.ts` — the SF-027-001 comment carries
  the record).
- **Deferral (documented, by design):** discounting is base-currency only this phase
  (typed `NOTE_DISCOUNT_CURRENCY_UNSUPPORTED` — the phase pins no FX semantics for
  discounting; collect or return instead); installment source documents are
  base-currency only (typed `PLAN_SOURCE_CURRENCY_UNSUPPORTED`); the late-fee defaults
  are PLACEHOLDER (OQ-002 family — configuration, not code; the OQ-002 pricing pass may
  revise them). The PDC calendar is a cached read model — a canonical entity would be
  register §C territory and none is listed.
- **Watch items carried:** SF-026-001 (the offboarding purge vs the pre-existing
  INV-003/010 guards — the accounting follow-up, untouched by 027: the 0038
  `note_events` guard carries the purge_mode exception like `depreciation_lines`) and
  SF-026-002 (the RC-10 live-check accum sign — RC-11 landed the same framework with
  the correct negated convention from day one; the RC-10 seeded-drift DB proof remains
  the 026-named accounting pass).

## 6. Acceptance criteria — all 10 green

1. ✅ Every notes/installments posting through the engine with the canonical G-row
   shapes (G-24/G-25/G-26/G-27 both legs/G-28 — line-level asserts in the rules
   suites), INV-013 per source/operation (`note/post|collect|dishonor|discount|return`,
   `installment_line/late_fee`), zero journal rows for
   endorsement/DEPOSIT/RECLASSIFY (the shape CHECK + the ledger-delta test).
2. ✅ INV-024 enforced + tested across the state graph (`inv-024.spec` — resolved notes
   carry zero balance both sides; dishonor restores the AR item exactly: amount,
   partner, references — the repoint assertions).
3. ✅ BR-046 enforced (reason required; the optional fee via `BANK_CHARGES` with the
   movement OUT; the restored item carries its original references — asserted in the
   rules suite + the aging/statement reads).
4. ✅ The PDC calendar job-derived from `maturity_date` only (no posting can originate
   from it — it is a pure read model), correct after every event kind, idempotent under
   re-runs, freshness-labeled >26 h (the staleness spec).
5. ✅ BR-048 enforced (`PLAN_TOTAL_MISMATCH`; `SCHEDULE_IMMUTABLE`); plans never
   duplicate AR (Σ line collections ≤ invoice outstanding — the INV-016 tie asserted).
6. ✅ Line statuses job-derived only (the sweep rebuilds from source data; no manual
   write path exists); WAIVED the sole manual transition — permission-gated,
   reason-required, audited, sticky.
7. ✅ Late fees engine-only (G-28) per the plan policy with the documented PLACEHOLDER
   defaults; flat only — no interest computation or compounding code path exists
   (negative test green).
8. ✅ RC-11 in the blocking CI set (green after each event set); seeded drift → `BROKEN`
   with the offending note + the PC-04 close block (the rc-11.spec drift pack incl. the
   period-lock restore).
9. ✅ All four tables in the isolation registry (A1–A10 green; foreign references →
   typed 404s + zero partial creation — the spoof batteries incl. the
   asymmetric-dishonor probe + A7 parity); the §3.12 checklist green with audit on the
   risky actions (`record_dishonor`, `discount`, `return`, `lines.waive`).
10. ✅ The five report contracts registered (registry 76) with block-on-fail RC-11 ties
    + as-of determinism; the nav additions bilingual with featureKeys
    (`treasury.cheques-notes`, `treasury.pdc-calendar`, `sales.installment-plans`); the
    `treasury.cheques` re-point in FEATURE_CATALOG per register §D (ED-03 chain closed).

## 7. Handoff

Next eligible per the register §B (parallel-capable post-GA): **PHASE-028 (Budgeting) /
PHASE-029 (Payroll)** — the agent protocol executes one at a time; take PHASE-028 next
(identify only). **Consumers of this phase:** PHASE-030 (`industry.wholesale` flagship
`notes.received`), PHASE-031 (healthcare claims cheques via notes), PHASE-032 (education
tuition via `installments.plans`) per EXPANSION_REGISTER §B/§L. The G-24/G-26
receive/restore pair + the repoint are the pattern future custody-style features must
copy; the RC-11 registration extends the treasury/period-close contracts.
