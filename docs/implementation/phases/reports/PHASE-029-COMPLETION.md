# PHASE-029 Completion Report — Payroll: Salaries, Loans & End-of-Service

> **Status:** COMPLETE · **Date:** 2026-11-08 · **Phase doc:**
> [../PHASE-029.md](../PHASE-029.md) · **Decision:**
> [DR-005](../../../decisions/accounting/DR-005-payroll-scope.md) (financial scope
> only) · **Commit:** `9b251a0` (baseline: PHASE-028 HEAD `f007d17`) ·
> **Honest note up front: the planning-docs flip (this report + the
> IMPLEMENTATION_STATUS row + the phase-doc status) was deferred at 029 commit
> time and is delivered with the PHASE-030 docs wave.**

## 1. The one-paragraph truth

PHASE-029 delivered the `payroll` module per DR-005's financial scope: migration
`0040_payroll.sql` (journal idx 39, schema_version 40) landed the seven RLS'd
tenant tables — `employees` the PII-restricted financial file (national_id C-PII
per DATA_DICTIONARY: masked in the UI, excluded from logs and non-payroll exports
by construction, every read an audit event), `salary_structures` +
`salary_components` with per-component GL accounts and `is_eos_base`, the
`payroll_runs` DRAFT→PENDING_APPROVAL→POSTED machine, `payroll_run_lines` 🔒
append-only through `erp.payroll_run_lines_guard` with the frozen
`component_snapshot` (posted history never depends on later structure edits),
and `employee_loans` + `employee_loan_lines` under the BR-054 cap — plus
`apply_tenant_policy` ×7, the 0036-pattern purge_path policies, the §9 enum
CHECKs, the CoA's six payroll purposes (2170/2180/2190/5270/5280/5295 — the
loan control account deliberately NOT a purpose: tenant-mapped via
`payroll.loans.control_account_id`, typed `LOAN_ACCOUNT_UNMAPPED` until mapped),
the `cash_movements` widening (`'payroll_payout'`, `'employee_loan'` — additive),
the notifications `'payroll'` category, the four settings-registry policy keys,
and the eight feature-key plan grants (§3.14 permissions were pre-seeded in
0004/0005 — the docs-as-contract head start, drift stays 245=245); the module
itself shipped the eight services (employee / structure / run-calculation /
approval-workflow / run-posting / payout / loan / eos) with G-29 posting exactly
one journal per run through the PHASE-007 engine behind a six-account
fail-closed precheck, the posting-engine BR-053 guard with the typed
`PAYROLL_ACCOUNT_ENGINE_ONLY` error, G-30 treasury payouts with the masked
payslips batch, BR-054 loan deductions capped at a percent of net, and the
BR-055 tenant-policy EOS accrual with G-31 settlement at termination (no
jurisdiction rates fabricated anywhere); three report contracts
(`payroll.register` / `payroll.cost-summary` / `payroll.eos-provision`) took the
registry 78→81, the web gained the `hr` navigation group
(الموظفون والرواتب / HR & Payroll) with twelve `/[locale]/payroll` screens at
i18n parity 4,069=4,069, and the suites prove the discipline end-to-end: the
818-line rule workbook (14 stories), the S-04 deception battery, and the
isolation registry +42 → the generated A-suite 1,062/1,062.

## 2. Task-by-task evidence

| # | Task | Delivered | Evidence |
|---|------|-----------|----------|
| T1 | Migration | `apps/api/migrations/0040_payroll.sql` (7 RLS'd tenant tables, `apply_tenant_policy` ×7, purge_path policies, §9 enum CHECKs, composite tenant FKs, the append-only `erp.payroll_run_lines_guard` (UPDATE never, DELETE only under the purge discipline), the CoA six payroll purposes 2170/2180/2190/5270/5280/5295, the additive `cash_movements` widening, notifications `'payroll'`, the 8 feature-key plan grants → business+enterprise, schema_version 40, journal idx 39) + the migrations.spec/migrations.ts pins in lockstep | isolation registry +7 tables (the generated A1–A10 suite +42 → **1,062/1,062**); migrations spec fresh+regression migrations.spec 4/4 (the 0040 tag pin + the per-migration schema-state upsert regex) |
| T2 | Employee file service | `application/employee-service.ts` — the PII discipline: `get()` audits `payroll.employee_read` BEFORE the controller wraps the result in masking (the access itself is the event); TERMINATED rows frozen except the note fields; branch scoping | payroll-rules.spec "PII read-audit: every employee read leaves the payroll.employee_read event"; spoof.spec foreign + unknown employee ids → identical typed 404s (reads + loans + eos) |
| T3 | Salary structure service | `application/structure-service.ts` — the BR-052 versioning machine (runs require ACTIVE structures; mid-period changes supersede; used structures never edited in place; ARCHIVED cannot enter a run) | payroll-rules.spec BR-052 story (freeze + successor version + ARCHIVED rejection) |
| T4 | Run calculation service | `application/run-calculation-service.ts` + `infrastructure/run-calculation.job.ts` (bounded pg-boss job, ids-only payload — no PII in queues per TENANT_ISOLATION §3) | INV-025 Σ lines == totals exactly; the BR-054 clamp (3,000 → 2,500 with the warning) + the partial-take split/carry; BR-055 enabled-without-basis the typed rejection, disabled ⇒ accrual 0 + no EOS legs |
| T5 | Run posting service | `application/run-posting-service.ts` — G-29 exactly ONE journal per run through the PHASE-007 PostingEngine with cost-center-allocated lines and the six-account fail-closed precheck (employer/salary component accounts all resolve BEFORE any write); INV-013 idempotency per run | the G-29 worked example (calculate → submit → approve (SoD) → post — the balanced 11,800 journal with every golden leg); failure packs PERIOD_LOCKED / empty population / one-live-run / approve-before-submit / PURPOSE_NOT_MAPPED ×6 (each unmap + restore, zero residue); double-post converges to the same journal |
| T6 | Approval workflow | `application/approval-workflow.ts` — DRAFT → PENDING_APPROVAL → POSTED with SoD (creator never approves; `payroll.runs.approve` the owner-only matrix key) | the worked-example path approves as a different user; every transition audited |
| T7 | Payout service | `application/payout-service.ts` — G-30 treasury payments per run (batch grouping, bank fields) + the masked per-run payslips batch (`GET /api/v1/payroll/runs/:id/payslips` — the payload never carries unmasked national_id/bank fields) | G-30 partial payout 5,000 → outstanding 3,500 → payout the rest → zero; INV-019 movements on the paying account; payslips count = the run's lines |
| T8 | Loan services | `application/loan-service.ts` — disbursement DR control · CR CASH with the INV-013 docId via the loan uuid (minted first; `journal_entries.source_id` is uuid-typed, codes cannot serve); schedule deductions recovered in-run; WAIVED / WRITE_OFF audited | BR-054 cap math + the unmapped-control-account guard (`LOAN_ACCOUNT_UNMAPPED`); recovery credits the tenant-mapped control account, never `DEDUCTIONS_PAYABLE` |
| T9 | EOS services | `application/eos-service.ts` — accrual in-run + termination settlement (G-31) + provision balances | G-31 story: run 2 accrues 4,200 → terminate → settle 4,000 (residual release 200) + the mirror case rejected |
| T10 | Reports | `registry/payroll/{payroll-queries,register.contract,cost-summary.contract,eos-provision.contract}.ts` + the registry wiring | **registry 78→81** (golden.spec pins 50 core + 18 industry + 3 fixed assets + 5 notes/installments + 2 budgeting + 3 payroll); the `payroll-register-tie` block-on-fail assertion (line sums vs run totals + the G-29 journal cost side, tolerance 0 — a broken tie blocks the export); the reports' ledger-ties story |
| T11 | UI + navigation group 10 | `apps/web/app/[locale]/payroll/**` — 12 pages (employees registry with masked PII + employee form/workspace, structure builder + structures table, runs console/table/form/workspace with calculate/approve/post/payout, loans workspace/form/table, reports) + the `hr` NAV group (الموظفون والرواتب / HR & Payroll — NAVIGATION_MODEL §1 group 10, pre-registered at PHASE-013 with zero items, filled with its four feature-key + permission-gated items incl. the sensitivity-critical `payroll.employees.view`) + breadcrumbs + typed error mapping + i18n | i18n AR+EN parity **4,069=4,069**; web typecheck green (turbo) · web vitest 73/73 (5 files) — the payslip print-template artifact honestly did not land (see §6) |
| T12 | Attack registration + docs sync | `__db__/payroll/{fixtures,payroll-rules.spec,spoof.spec}` + the isolation registry rows + the docs flip | spoof.spec 5/5 (foreign + unknown parity across structure/employee/run/loan+line; calculate/post/payout/reverse and waive/write-off reject; zero partial creation — no spoof-named rows anywhere); the docs flip honestly deferred at commit time, delivered with the PHASE-030 docs wave (this report + the IMPLEMENTATION_STATUS row + the phase-doc status + the CHANGELOG entry) |

## 3. Final gate (serial, foreground — recorded with the PHASE-030 wave)

- **typecheck**: typecheck 8/8 workspaces green
- **lint / depcruise**: lint 8/8 (turbo) · depcruise 0 violations / 1,518 modules / 10,655 dependencies
- **unit tests**: unit 8/8 green — api 392/392 (36 files, incl. the re-pinned golden effective-config hashes + the new capability-matrix 6 + report-pack-wiring 4 + template-prerequisites 26) · contracts 52/52 (2 files, +2 vs 029: the wholesale/electronics blocks) · web 73/73 (5 files) · ui 42/42 (3 files) · desktop 274/274 (16 files) · mobile 393/393 (27 files)
- **DB suite**: DB suite 159 files / 2,278 tests ALL GREEN (the full 0001–0041 chain fresh on embedded PG16, chunked foreground — six chunks; ZERO failures this run: even the documented environmental set (ga-full-load EXPLAIN + report-hammer p95 + the crm/time ordering sensitivity) measured green this sweep)
- **docs:validate**: docs:validate 29/29 · **permissions-drift**: 245=245
  (§3.14 pre-seeded in 0004/0005 — nothing to add) · **check:rls**: green — violations=[], 205 catalog
  tables (the seven 0040 tables included; the data-only 0041 changes nothing) · **i18n parity**:
  4,069=4,069 · **capabilities**: capabilities GREEN (25 PASS · 3 DEFERRED · 16 n/a — unchanged; PHASE-030 adds no offline capability rows)

## 4. Engineering notes paid for (the lessons worth carrying)

1. **The restricted read audits before masking returns**: `employee-service.get()`
   records `payroll.employee_read` before the controller wraps the payload in
   masking — the access itself is the event, regardless of what the response
   shows; the suite counts the events post-commit (the 028 §4.6
   audit-visibility discipline carried onto the read path).
2. **The loan uuid is minted FIRST**: the disbursement journal's INV-013 source
   key is `(employee_loan, loanId, disburse)` and `journal_entries.source_id`
   is uuid-typed, so employee/loan codes cannot serve as doc ids — the id
   precedes the JournalSpec, never the reverse.
3. **The six-account fail-closed precheck**: the run-posting service resolves
   every employer/salary component account (and the loan control account via
   its policy key) BEFORE any write — a `PURPOSE_NOT_MAPPED`/`LOAN_ACCOUNT_UNMAPPED`
   run fails with zero residue, not half a run.
4. **The payroll CoA purposes were a code-collision exercise**: 2170/2180/2190
   (current liabilities) + 5270/5280/5295 (the 52xx children) were verified
   against the whole 0001–0039 chain before landing — the 027 lesson
   (1160/2150 were taken) applied prospectively this time.

## 5. Findings (SF-029-xxx)

- **SF-029-001 (docs drift in the phase doc, corrected in-delivery)**: the
  phase contract's task table named `0029_payroll.sql`,
  `apps/web/src/app/(app)/payroll/**`, and `tests/payroll/**` — the actual repo
  conventions are `0040_payroll.sql` (the migration chain is at 40),
  `apps/web/app/[locale]/payroll/**`, and `apps/api/src/__db__/payroll/**`
  (the SF-028-001 family). The phase doc header now records the correction. No
  code impact.
- **Carried watch items (unchanged, not 029's)**: SF-026-001 (purge vs guards),
  SF-026-002 (RC-10 accum sign seeded-drift DB proof), the 028 deferral of the
  first production ControlGuard call-site, and the environmental runbook note
  (ga-full-load / report-hammer / notifications-email want dedicated
  small-chunk runs on slow boxes).

## 6. Honest deferrals (explicit, none silently shipped)

1. **"E2 pending"** — recorded verbatim at commit time as the deferred
   follow-up work item from the P29-E stage. No further specification exists in
   the repository (no P29-\* agent-ctx note names it); it is carried as
   recorded, not re-specified here. Resolving or retiring it is the first
   follow-up decision for the next phase's agent.
2. **The planning-docs flip** — this report, the IMPLEMENTATION_STATUS row, the
   phase-doc status flip, and the CHANGELOG entry were honestly deferred at 029
   commit time; they are delivered with the PHASE-030 docs wave (this document).
3. **The payslip print-template artifact**: payslips ship as the masked
   per-run batch consumed by the run workspace (AR/EN via the locale
   parameter); the phase doc T11's `packages/ui/print/templates/a4-payslip/**`
   artifact and a `print_templates` seed did not land — the RTL print template
   is the natural follow-up patch (the PHASE-013 print system is the surface).
4. **SIF/WPS bank transfer files** stay out per the phase doc §7 boundary
   (adapter decision-record territory); payouts ship as audited treasury
   payments, and support macros state the boundary.

## 7. Acceptance criteria ×11 — verdicts

1. ✅ All seven tables are tenant-owned + RLS and pass the isolation registry
   suite (the generated A1–A10 battery +42 → 1,062/1,062); the S-04 spoof
   battery 5/5 with foreign==unknown parity and zero partial creation; every
   restricted read leaves the `payroll.employee_read` audit event (asserted);
   report exports ride the PHASE-013 audited-export machinery.
2. ✅ BR-052 holds: runs require an ACTIVE structure; mid-period changes
   create the successor version; used structures are never edited in place;
   run lines freeze the `component_snapshot` (asserted + the DB guard).
3. ✅ G-29 posts exactly through the engine with the worked example's
   line-level asserts (11,800 = 11,800), official run numbers, cost-center
   allocation on every line, and INV-013 idempotency (double-post converges).
4. ✅ INV-025 is enforced: run totals equal Σ lines for gross/deductions/net,
   net = gross − deductions exactly, and posted runs are immutable at the DB
   level (reversal the only correction path).
5. ✅ BR-053 holds: manual journals on payroll-purpose accounts die typed
   (`PAYROLL_ACCOUNT_ENGINE_ONLY` — both the purpose-keyed and the
   explicit-accountId smuggles are negative-tested).
6. ✅ Payouts execute as treasury payments with the G-30 shape, INV-019
   movements on the paying account, exact remainder tracking (5,000 → 3,500 →
   0), and idempotency per run; payslips per the masked batch.
7. ✅ Loans enforce BR-054 (cap percent of net, default 25% PLACEHOLDER
   documented in the settings schema), recover through the tenant-mapped
   control account (`LOAN_ACCOUNT_UNMAPPED` until mapped — no new canonical
   purpose), and waive/write-off are audited, reason-required actions.
8. ✅ EOS follows BR-055: accrual per tenant policy (disabled by default; no
   shipped rates — enabled-without-basis is the typed rejection), G-31
   settlement with the residual rule (4,200 → 4,000 + 200 released; the mirror
   case rejected); the platform contains no jurisdiction rate tables.
9. ✅ The three reports are registered per REPORT_CONTRACT (registry 78→81,
   golden.spec) with provenance, the `payroll-register-tie` block-on-fail
   ledger tie, permission gating (employee detail requires
   `payroll.employees.view`), and export-blocked-on-assertion-failure.
10. ✅ All §3.14 permissions enforce on their routes (controller decorators;
    keys pre-seeded — drift 245=245); `payroll.runs.approve` is the SoD-guarded
    owner-only key, audited on use.
11. ✅ (with the honest carve-outs recorded) The `hr` group (group 10
    الموظفون والرواتب / HR & Payroll) renders with its four entitlement- and
    permission-gated items; the twelve screens ship bilingual at i18n parity
    4,069=4,069; the payslip print-template artifact and the phase doc's
    axe/RTL-print baseline claims are NOT evidenced — see §6 deferral 3 and the
    §3 placeholders. Criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

## 8. Handoff

Payroll data is available to the reporting engine (the three contracts) and to
future consumers the expansion names (repair profitability over technician cost
is the CAPABILITY_MATRIX §2.6 note the electronics template carries). The
`CURRENT_SHIPPED_PHASE` 029 leg is recorded as bookkeeping-only at the 030 bump
(`prerequisites.ts` moved 028→030 in one step — no template capability rides
payroll). **Next eligible: PHASE-030 (Wholesale & Electronics Templates)**
per EXPANSION_REGISTER §B sequencing (identify only; do not implement without a
fresh phase order). Recommended follow-ups (small, audited, any phase): resolve
or retire the recorded "E2" item (§6.1), the payslip print template (§6.3), and
the carried 026/028 watch items.
