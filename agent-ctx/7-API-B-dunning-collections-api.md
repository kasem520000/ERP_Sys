# 7-API-B — Dunning & Collections API (PHASE-039, apps/api)

Task: PHASE-039 task 7-API-B per the task brief (dunning engine BR-065, late
fees L1-12, credit reviews L1-10, collection agencies L1-11 with G-39,
controllers + public agency callback, sweep job, reports 88→90, pins, specs,
gates). Scope guard honored: only `apps/api` touched; no web, no docs, no
migrations (0056/0057/0058 already applied at schema_version 59; the Drizzle
mirrors for the five dunning tables were already in the foundation commit).

## Audit of the interrupted run (per the brief's READ-FIRST instruction)

The previous run had written ALL production code + both specs uncommitted.
This run audited every file line-by-line against the task spec and the house
references (advances.ts, ar-queries.ts, invoices.ts, credit-limits.ts,
portal.controller.ts, scorecard-sweep.job.ts, inbox-service.ts, the reporting
registry kit). Findings:

1. Contract violations: NONE. Every deliverable item (1–9) was present and
   semantically correct: the 11 typed errors, the store surface (all CRUD +
   maxLetterStepForInvoice + overdueArItems mirroring the arOpenItemsAsOf
   allocation fold incl. POSTED receipts/payments + note-owned), the service
   (pure ladder exports, policy validation incl. terminal-only referToAgency,
   monotonic sweep, fee invoice through SalesInvoiceService itself, agency
   chain, credit reviews), both controllers, the job, the two report
   contracts, all pins.
2. ONE production defect found and FIXED by this run: `runSweep`'s BR-065
   re-fire guard caught the letters UNIQUE violation (23505) and `continue`d
   — but inside the ONE ambient `withTenant` UoW a 23505 ABORTS the
   PostgreSQL transaction, so under a real concurrent-sweep race every later
   statement would fail 25P02 and the whole sweep would throw/roll back (the
   catch-continue was a false promise). Fixed with the crm
   deferral-service SAVEPOINT discipline: per-item
   `SAVEPOINT dunning_letter_step` around insertLetter + the email mark,
   `ROLLBACK TO SAVEPOINT` (destroys it) then continue on 23505, `RELEASE`
   on success. Re-verified green.
3. Scratch removal: `src/__db__/tmp-probe/probe.spec.ts` (untracked, from an
   unrelated configuration debugging session — healthcare template apply
   probe) was the ONLY tsc error in the tree; deleted. No other spec or
   production file references it.

## Files (all uncommitted in apps/api; line counts after this run)

New (previous run, audited + the savepoint fix):
- `src/modules/sales/application/dunning.ts` (1348) — DunningService
  (AuditService, PostingService, InboxService, SalesInvoiceService); exports
  PURE `resolveCurrentStep`/`advanceStep` (+ `validateDunningSteps`,
  `validateLateFeeConfig`, `DunningStep`); G-39 doc-comment; deterministic
  bilingual render keyed off dunning.reminder.*/dunning.final
- `src/modules/sales/infrastructure/dunning.store.ts` (938) — the only
  writer of the five tables + the 0057 partner credit-risk block; drizzle
  over the schema tables, ambient-UoW discipline
- `src/modules/sales/infrastructure/dunning-sweep.job.ts` (76) — queue
  `sales.dunning-sweep`, cron `45 2 * * *` (BEFORE the sibling's 2:50
  warranty sweep), both sweeps, entitlement gate on `sales.dunning`
- `src/modules/sales/presentation/dunning.controller.ts` (524) —
  @Controller("/api/v1/sales"), @RequireFeature("sales.dunning") per method;
  zod at top, envelope, requireIdentity; all 21 routes (late-fee pair on
  sales.late-fees.manage, agencies/referrals on
  sales.collection-agencies.manage, the rest on sales.dunning.manage)
- `src/modules/sales/presentation/agency-portal.controller.ts` (116) —
  @Controller("/api/v1/portal/collection-agencies") PUBLIC POST callback:
  sha256 pre-GUC through erp.portal_resolve_agency_token, fixed-window
  10/min per token HASH, withTenant re-validation, audit
- `src/modules/reporting/registry/sales/returns-dunning-queries.ts` (161)
  and `src/modules/reporting/registry/operational/returns-dunning.ts` (223)
  — sales.rma_register (perm sales.rma.read, BOTH families) +
  sales.dunning_status (perm sales.dunning.manage)
- `src/modules/sales/__tests__/dunning-ladder.spec.ts` (156; 15 pure tests)
- `src/__db__/sales/dunning.db.spec.ts` (948; 8 tests, returns-harness
  family: shared TENANT_S + dedicated partners S-CUST-DUN/S-CUST-CLS/
  S-AGENCY-01/02 + a TIER-SCOPED policy so the shared family stays invisible)

Modified (wiring/pins): sales-errors.ts (+72: the 11 errors),
ar-queries.ts (+13: AgingRow.dunningStep, additive), credit-limits.ts
(+19: blocked-class fold into the BR-001 trigger, reason
CREDIT_CLASS_BLOCKED via the math string, nothing else changes),
sales.store.ts (+6: CustomerRow.creditScoreClass), sales.module.ts (+21),
route-permissions.ts (+36: 21 routes + the PUBLIC callback), error.filter.ts
(+9: AgencyTokenInvalidError → 401), settings-schema.ts (+27:
sales.late_fee_item / sales.collection_commission_account /
sales.credit_block_class), schema.ts (+14: the 0057 partner columns the
foundation commit's mirror missed + the review index),
tables.registry.ts (+12: the dunning 5, NO deleteGranted), reporting
services/index/reporting.module (+23; KNOWN_PERMISSION_KEYS +=
sales.rma.read, sales.dunning.manage), pins 88→90 in golden/industry-018/
industry-019/report-pack-wiring/reporting-unit/consolidation-contracts,
identity-flows pin 256→265 with the nine-key lineage comment.

## Decisions (documented in code headers, restated)

1. Fee invoice: created with actorId NULL (system provenance — the letter
   invoked the charge, so approve's SoD gate can never fire), then
   `invoices.approve(id, actor, override=true)` — the service's documented
   override arm: the charging actor already holds sales.late-fees.manage at
   the controller; blocking the fee on the very delinquency it remedies
   would be circular, and the override is audited as
   sales.credit_check_overridden inside the invoice service. ONE line on
   sales.late_fee_item (SERVICE kind, STD tax code in the spec), qty 1,
   unitPrice = fee (4dp, capped), dueDate null → invoice date, channel
   STANDARD (default), VAT through the invoice's own tax machinery (G-04:
   DR AR gross · CR SERVICE_REVENUE net · CR VAT_PAYABLE).
2. Email delivery: the EmailService template union is CLOSED
   (invitation/password_reset/login_notification/registration_welcome/
   stock_below_reorder/invoice_overdue/limit_warning/subscription_state/
   task_reminder) — a dunning template cannot ride it. EMAIL letters store
   the deterministic bilingual snapshot + contact email on the row and are
   marked SENT (the register IS the delivery evidence — 0056's columns); a
   partner with no email on file FAILS the letter (step stays consumed).
   WHATSAPP/SMS stay QUEUED for the post-041 channel port.
3. G-39 (implementation-bound, next free after G-38): DR
   sales.collection_commission_account (readEffectiveSetting, unmapped →
   CommissionAccountUnmappedError BEFORE any ledger work) · CR AP_CONTROL
   with partnerId = the AGENCY's partner; INV-013 source key
   {docType:"collection_referral", docId, operation:"commission"};
   COMMISSION_POSTED stamp carries journal id + entry no. Foreign-currency
   referrals lean on the referred invoice's exchange rate; a foreign
   referral without one hits the engine's typed missingFxRate (fail-closed).
4. STATUTORY_CAP: the service validates the rate shape; the source citation
   is enforced by 0056's ck_dunning_policies_late_fee_shape at the DB layer
   (the DB spec proves the 23514 rejection) AND re-verified at charge time
   by validateLateFeeConfig (REQUIRES_VERIFICATION).
5. One ACTIVE default: a DRAFT may CLAIM the flag but only ACTIVATION (or an
   isDefault patch on an ACTIVE policy) demotes the others
   (demoteOtherDefaults); the spec battery archives its temporary default
   before sweeping so no standing default ever affects the shared tenant.

## Gate evidence (2026-11-11, apps/api)

- `npx tsc --noEmit -p tsconfig.json` — clean
- `npx eslint <all task files> --fix` — clean (no findings)
- `npx vitest run src/modules/sales/__tests__/dunning-ladder.spec.ts` —
  1 file / 15 tests passed
- `npx vitest run --config vitest.db.config.ts src/__db__/sales/dunning.db.spec.ts
  src/__db__/identity-flows.db.spec.ts` — 2 files / 29 tests passed
- Reporting pins (fast): golden 6, reporting-unit 42, report-pack-wiring 5,
  consolidation-contracts 6, industry-018 11, industry-019 11 — all green
  (86 pin assertions across the six files).
- Collateral (not required): sales/__tests__ 22, sales golden.db 10,
  returns.db 5 — green.

DB spec coverage: (a) every bad ladder shape typed + CONTRACT_RATE without
rate; (b) tier-resolution over default, 200-day item still STARTS at step 1,
one step per run (1→2→3), run 4 fires nothing (UNIQUE backstop), SENT letter
with the bilingual snapshot + contact email, collections escalation inbox
row, aging dunningStep=3; (c) grace typed, unmapped fee item typed with ZERO
partial (no stray invoice, letter unstamped), fee 1000×2.50%=25.0000 +
VAT 3.7500 = 28.7500 through the invoice service (exact G-04 mirror), the
register stamp, re-charge typed, waiver trio + double-waiver typed,
STATUTORY_CAP DB-CHECK 23514; (d) review A–D validation, class-D BLOCK with
CREDIT_CLASS_BLOCKED (decision BLOCK, wouldExceed false, overdueCount 0),
enforceAtApproval typed + override→WARN, non-blocked class ALLOW, review
clock sweep dedupe; (e) agency register + token (sha256 at rest, ≠ raw),
suspend/activate gating, referral snapshot + AGENCY_REFERRAL action,
PARTIAL→SETTLED, unmapped commission typed zero-partial (no journal, stays
PARTIAL), G-39 exact lines + agency partner on the credit leg, exactly-once
replay typed, CLOSED terminal + settle-after-close typed; (f) public
callback: bad token = AGENCY_TOKEN_INVALID (401-shaped), valid ACKNOWLEDGED
→ PARTIAL with settled stamps, over-report typed, cross-agency referral =
the same no-oracle rejection.

## Deviations / notes for the orchestrator

- The savepoint fix (audit finding #2) is the only production-code change
  this run made to the interrupted run's output; everything else was
  verified as-is.
- No exact role-grant count pins exist for accountant/sales/purchasing
  templates (only viewer=46, owner>150 — both unaffected by 0056), so the
  "role-grant pins if present" item had nothing to update; the owner
  ROUTE_PERMISSIONS loop over the new routes passes inside identity-flows.
- Pre-existing failures NOT caused by this task (unchanged from 7-API-A's
  report): migrations.spec pins the manifest's last tag to 0054 (foundation
  fallout), and zatca-qr-decode needs Playwright browsers (environmental —
  explicitly ignored per the brief).
- The dunning sweep reads `sales.credit_block_class` via
  `store.readSetting` (sales.store's thin re-export of
  readEffectiveSetting) inside credit-limits.ts — that file's house pattern
  for its other settings; semantically the brief's readEffectiveSetting.
- Deterministic spec dates: FY2026 April invoice → 200 days overdue at the
  2026-11-11 sweep; fee/commission entry dates default to the wall clock
  (November — outside the March/December PERIOD_LOCKED packs, same window
  discipline as 7-API-A).
