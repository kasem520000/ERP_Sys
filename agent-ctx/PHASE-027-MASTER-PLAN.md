# PHASE-027 Master Plan — Cheques, Promissory Notes & Installments

Owner: orchestrator (main agent). Phase doc: `docs/implementation/phases/PHASE-027.md`.
Authority chain: PHASE-027.md → DR-003 → EXPANSION_REGISTER §B/§C/§D/§E/§J/§K.

## Settled design decisions (from code research — binding for all waves)

1. **Migration `0038_notes_installments.sql`** (schema_version 38): 4 tables
   (`notes`, `note_events` 🔒, `installment_plans`, `installment_lines`) + 7 §9 enum
   CHECKs + composite tenant FKs + `erp.apply_tenant_policy` ×4 + 0036-pattern
   purge_path ×4 + guard trigger on `note_events` (UPDATE never; DELETE only under
   `erp.purge_mode`). **treasury_allocations widening**: ADD `note_id` NULL +
   composite FK→notes + replace `ck_treasury_allocations_exactly_one_doc` with
   exactly-one-of-three + partial unique `(tenant_id, note_id, open_item_id)` +
   tenant_note index. **reconciliation kind**: widen
   `ck_reconciliation_runs_kind_values` + 'NOTES' (RC-11). **notifications**:
   widen category CHECK + 'notes','installments'. **CoA template**: 1160
   NOTES_RECEIVABLE (ASSET leaf, parent 1100) · 2150 NOTES_PAYABLE (LIABILITY
   leaf, parent 2100) · 4920 LATE_FEE_INCOME (REVENUE leaf, parent 4900) · 5260
   NOTES_DISCOUNT_EXPENSE (EXPENSE leaf, parent 5200). **Permission**: NEW key
   `notes.notes.return` (0004 seed + 0005 accountant grant + §3.12 row) —
   drift 244→245. **Plan grants**: 12 keys (notes 7 + installments 5) →
   business+enterprise only (0037 precedent).
2. **Open-item settle/restore algebra (the critical mechanic)**:
   - G-24 creates `treasury_allocations` rows owned by the note (note_id),
     effective by presence (no status filter in the settled-sum subqueries —
     the four read sites `lockOpenItemAndSumPostedAllocations`,
     `findOpenItemById`, `listOpenItems`, `arOpenItemsAsOf` gain the note
     branch `OR (a.note_id IS NOT NULL)`).
   - **Dishonor/Return restore = repoint**: DELETE the note's allocation rows
     and INSERT one consolidated row (note → the G-26/RETURN journal's new
     control debit entry). Original open item E1: outstanding restored
     byte-equal (same row, original refs). The new entry E3 (required on the
     line by INV-009(a) engine validation #6) is anchored: outstanding 0 — no
     double count. Aging = true debt; `partner_balances.open_balance` ties.
     Audit carries before/after allocation lists; the note_events row carries
     `journal_entry_id` + refs.
   - On-account notes (no invoice): no allocations; dishonor posts E3 as a new
     explicit open item (documented).
   - G-24 CR AR_CONTROL lines carry partnerId (INV-009(a)); FX: note rate must
     equal the item's stored rate for allocated foreign notes (typed
     NOTE_RATE_MISMATCH); on-account portion at the note's stored rate r₀.
   - G-25 FX residual (received, foreign): cash at input rate r₁, note leg at
     r₀, residual → FX_GAIN (CR) / FX_LOSS (DR) — the receipt G-06 mirror.
3. **Custody machine** (per direction): RECEIVED: IN_CUSTODY →{ENDORSED_OUT,
   DEPOSITED, COLLECTED(G-25), DISHONORED(G-26), DISCOUNTED, RETURNED};
   ENDORSED_OUT/DEPOSITED → {COLLECTED, DISHONORED, RETURNED}. ISSUED:
   IN_CUSTODY → {COLLECTED(paid leg G-27 mirror), DISHONORED, RETURNED}.
   ENDORSE/DEPOSIT/RECLASSIFY: never a journal (BR-047; DEPOSIT stores
   cash_account_id).
4. **Journals** (INV-013 sources, snake_case): note/post (G-24|G-27 leg),
   note/collect (G-25|paid mirror), note/dishonor (G-26+fee legs: DR
   BANK_CHARGES fee · CR cash fee + movement OUT fee), note/discount (DR cash
   proceeds · DR NOTES_DISCOUNT_EXPENSE fee · CR NOTES_RECEIVABLE at r₀),
   note/return (repoint restore). installment_line/late_fee (G-28: DR
   AR_CONTROL partnerId (new open item) · CR LATE_FEE_INCOME; flat only).
5. **Notes schema additions** beyond register §C summary: `cash_account_id`
   (treasury cash account for money legs), `journal_entry_id` (the G-24/G-27
   entry), `note`/`note_ar` memo. Plans: status NULL = draft (§9 enum lists
   activated states only — register §I compliance); `activated_at/by`;
   `late_fee_policy` jsonb shape `{rate, cap, grace_days, auto_charge,
   defaulted_after_lines}` (PLACEHOLDER defaults OQ-002: 2%/10%-of-total/7d/
   false/3 — documented, never silent). Lines carry `late_fee_amount/
   entry_id/charged_at` + `receipt_refs` jsonb.
6. **PDC calendar**: in-module in-memory cached read model
   (`Map<tenantId, Snapshot>`); read path serves snapshot + `computedAt` +
   `stale` flag (>26h ⇒ labeled, never silent); on-event invalidation deletes
   the entry (every custody event); daily `notes.pdc-calendar.sweep` job
   (cron `20 2 * * *`, system payload, ACTIVE tenants) recomputes +
   replaces — idempotent. Buckets: OVERDUE(<asOf), THIS_WEEK[0,7), D30[7,30),
   D60[30,60), D90[60,90), BEYOND[90,∞); two-sided received/issued; by
   partner/bank. No table (register §C). 100k-note perf spec p95<30s.
7. **Installments attribution**: daily `installments.daily-sweep` (cron
   `40 2 * * *`): per ACTIVE plan, rebuild line states from source data —
   PAID (covered via receipt_refs attribution from the invoice's posted
   allocations, down-payment portion excluded), DUE (due_date ≤ today),
   OVERDUE (grace elapsed + uncovered), WAIVED sticky (sole manual
   transition, permission + reason + audit); DEFAULTED flip after N
   consecutive OVERDUE (policy) + dunning notification; auto-charge late
   fees when policy.auto_charge (G-28 via the same service — INV-013 once
   per line). Lines: base-currency source invoices only (typed
   PLAN_SOURCE_CURRENCY_UNSUPPORTED — honest deferral documented).
   BR-048: activation requires plan.total == source.totalGross exact;
   schedule immutable after activation (409 SCHEDULE_IMMUTABLE); last-line
   remainder absorption (Σ == total − down EXACTLY).
8. **RC-11** (kind NOTES): expected = Σ live notes (IN_CUSTODY/ENDORSED_OUT/
   DEPOSITED) amount×r₀ per purpose side (received→NOTES_RECEIVABLE,
   issued→NOTES_PAYABLE) == GL balance; + GL-without-register side; BROKEN ⇒
   audit + critical inbox (category reconciliation) + PC-04 close block;
   kind lists widened in reconciliation-service.ts + period-service.ts;
   closeChecklist item + advisory rows.
9. **Reports** (5, registry 71→76): notes.maturity-calendar/aging/
   dishonored-register (perm notes.notes.view), installments.schedule/aging
   (perm installments.plans.view). Aging buckets mirror sales ar-queries
   (notDue/1-30/31-60/61-90/90+ by integral day diff). SOURCE_MODULES +
   `notes:27`/`installments:27` + REGISTERED_PHASE_WINDOW 26→27;
   KNOWN_PERMISSION_KEYS += the two perms; counts 71→76 in
   reporting-unit.spec + golden header.
10. **Web**: apps/web/app/[locale]/notes/{page,new,[id],calendar} +
    installments/{page,new,[id]} + reports tabs via ReportWorkspace prefix;
    TimelinePanel in packages/ui patterns + COMPONENT_CATALOG row; NAV_ITEMS
    +3 (treasury.cheques-notes /notes, treasury.pdc-calendar /notes/calendar
    both featureKey-gated; sales.installment-plans /installments); i18n
    +~200 keys/locale (3599→~3800, parity check).
11. **Isolation**: registry +4 (note_events deleteGranted:true); fixture ids
    `nt0/nt1` (notes, note_events) + `ip0/ip1` (plans, lines) hex pattern;
    S-04 spoof specs (foreign partner/invoice/note/plan/line → typed 404,
    zero partial creation); A1-A10 auto-extend (+24 its).
12. **Error filter**: register notes/installments DomainErrors in
    `error.filter.ts` domainStatus() (404/409/422) AND record the pre-existing
    fixed_assets gap as SF-027 finding (register those classes too — the
    honest fix, logged as a finding with the 026 note).

## Wave order

- **P27-A** (orchestrator): migration 0038 + schema.ts mirror + 0004/0005
  seed edits + isolation registry/fixtures + notifications TS union.
- **P27-B** (orchestrator): notes module core (T2-T6) + controller.
- **P27-C** (orchestrator): installments module (T8-T11) + controller.
- **P27-D** (orchestrator): PDC calendar + RC-11 + kind-list wiring (T7/T12).
- **P27-E** (subagent, after B-D): report contracts + registry wiring.
- **P27-G** (orchestrator, after B-D): test suites — notes-rules (G-24..G-27
  line-level + failure packs), installments-rules (G-28 + BR-048/049),
  inv-024, rc-11, pdc-calendar + staleness, overdue job, spoof ×2, 100k perf.
- **P27-F** (subagent, parallel with G): web screens + TimelinePanel + nav +
  i18n.
- **P27-H** (orchestrator): docs sync (14 docs + TABLES spec + ERD +
  PHASE_ACCEPTANCE_CRITERIA), error filter, security findings row,
  PHASE-027-COMPLETION.md, CURRENT_SHIPPED_PHASE → "PHASE-027", commit.
- Final sweep: typecheck 8/8, lint, depcruise, unit suites, DB suite
  (foreground chunked), docs:validate 30/29→(check), permissions-drift
  245=245, check:rls 203 catalog tables, i18n parity, capabilities.

## Gates (gated-shipping — any open DR/finding stops)

No open decision records block 027 (DR-003 ACCEPTED; OQ-002 family stays
PLACEHOLDER by design — configuration not code). Watch items: SF-026-001
(pre-existing purge-vs-guards — named accounting follow-up, not 027's),
SF-026-002 (RC-10 accum sign seeded-drift DB proof — RC-11 lands the same
framework; keep the 026 finding open unless re-tested).
