# T49 / Task 8 — Reports + dashboards: CrmQueriesService + phase019 contracts + registry wiring + industry-019.spec (PHASE-019)

**Agent:** T49 (reports + dashboards) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — `pnpm --filter @erp/api typecheck` clean · `run lint` clean ·
isolated `TMPDIR=$HOME/tmp-t49 … src/__db__/reporting/` **10 files / 66 tests green**
(industry-019 new: 11/11; render.spec's 2 browser tests run again — the
chromium_headless_shell-1248 binary was missing in THIS sandbox, installed via
`npx playwright install chromium-headless-shell`; T40's evidence documented the
same binary present in its sandbox) · `… src/__db__/crm/` **7 files / 79 tests green**
· app-boot specs (identity-http + readiness) 16/16 (the registry boot validation with
the new keys) · `pnpm --filter @erp/api test` **274/274 (25 files)** (the
reporting-unit.spec pins now 68) · `pnpm run lint:depcruise` **✔ no dependency
violations found (971 modules, 6662 dependencies cruised)** · `pnpm run
check:permissions-drift` OK (matrix 243, seed 243 — no new keys) ·
`pnpm docs:validate` **29/29**.

## Scope (MASTER-PLAN §13 + §16 T49 row + the T47 handoff, all delivered)

## Files created / changed

| File | Content |
|---|---|
| `apps/api/src/modules/reporting/registry/industry/crm-queries.ts` | NEW — `CrmQueriesService` (`@Injectable()`, read-only raw SQL inside the ambient tenant tx — the manufacturing-queries pattern verbatim: local `tenantTx()` throwing without an ambient scope, `sql` template, camelCase aliases, `::text` casts, `journal.accountsForPurposes` for the tie). `contractRevenueSchedule` (rows per contract × schedule entry with billDate in window: contracted (frozen grid amount; NULL on HOURLY), invoicedNet/Vat/Gross (POSTED only), draftNet (DRAFT/PENDING_APPROVAL/APPROVED), backlog = contracted − invoiced − draft (NULL where contracted NULL), overdue (the row's posted invoices' AR open items past due at asOf — the exact arOpenItemsAsOf settled lateral incl. the `outstanding > 0` openOnly filter)); `contractRevenueGlTie` (register side Σ total_net of the POSTED contract invoices linked to in-window entries vs GL side Σ CREDIT journal_lines on the SERVICE_REVENUE/SALES_REVENUE purpose accounts of those same invoices' posted journals — both sides scope to the identical invoice id set; no revenue account mapped → honest 0.0000); `timeBillingSummary` (per project × fee-earner: recorded/billable/invoiced hours + amounts = hours × snapshotted unitRate, 6dp hours / 4dp money). The invoice link predicate = the billing run's two guard keys (period_key for RETAINER/HOURLY periods, milestone_schedule_id for MILESTONE) — reused across all four queries as one `INVOICE_LINK` fragment. |
| `apps/api/src/modules/reporting/registry/industry/phase019.ts` | NEW — the two `defineReport` contracts (phase018.ts pattern: WINDOW_PARAMS, assertDecl + assertExact, source(), col/moneyCol/qtyCol, run() with rows/totals/assertionResults/notes). `services.contract_revenue_schedule` carries `contract-revenue-gl-tie` (INV-010, tolerance 0 via assertExact) + `schedule-reconciliation` (per contract, where contracted defined: Σ contracted == Σ invoiced + Σ draft + Σ backlog — computed per contract across the window's rows, the offender id in `compared.detail` on FAIL); 5 money totals; two bilingual notes (the overdue/asOf semantics + the HOURLY operational labeling). `services.time_billing_summary` is operational (no GL assertion — README rule 2) with 6 totals (hours at the 6-dp qty scale via a local BigInt `addQty`, amounts 4-dp via addExact). |
| `apps/api/src/modules/reporting/registry/index.ts` | REPORT_CONTRACTS += the two (66 → 68; §10 block). |
| `apps/api/src/modules/reporting/registry/runtime.ts` | SOURCE_MODULES += "crm"; MODULE_DATA_PHASE.crm = 19; REGISTERED_PHASE_WINDOW 18 → 19. **T43 did NOT pre-wire** (repo-grep verified: zero "crm" matches under modules/reporting before this change) — T49 completed the full wiring itself. |
| `apps/api/src/modules/reporting/application/contract.ts` | DataSourceModule union += "crm"; ReportParams typed keys `contractId?` + `projectId?` (the vehicleId/batchId precedent — without them `params.contractId` is the index-signature `unknown`). |
| `apps/api/src/modules/reporting/registry/services.ts` | CrmQueriesService import + the `crm:` interface entry + the lazy-bundle construction. |
| `apps/api/src/modules/reporting/reporting.module.ts` | KNOWN_PERMISSION_KEYS += `crm.contracts.manage` (the 0027 seed — T40 decision 7 discipline; boot-critical). |
| `apps/api/src/modules/reporting/__tests__/reporting-unit.spec.ts` | local KNOWN_PERMISSIONS += the key; the three count pins 66 → 68. |
| `apps/api/src/__db__/reporting/golden.spec.ts` | header comment + describe label + the two pins 66 → 68, "(50 core + 16 industry)" → "(50 core + 18 industry)". |
| `apps/api/src/__db__/reporting/fixtures.ts` | ALL_KNOWN_PERMISSIONS += `crm.contracts.manage`. |
| `apps/api/src/__db__/reporting/industry-018.spec.ts` | the registry-integration snapshot pin 66 → 68. |
| `apps/api/src/__db__/reporting/industry-019.spec.ts` | NEW — tenant R19 + 11 tests (below). |
| `docs/industries/reports/README.md` | registration note: the PHASE-019 services set (`services.contract_revenue_schedule`, `services.time_billing_summary`) live in the code registry — 68 contracts total; the rental pair + logistics board remain catalogued only. |
| `agent-ctx/T49-8-reports.md` | this file. |

Untouched (as instructed): the crm module internals (the queries read the
published tables read-only — the reporting precedent), migrations, schema.ts,
route-permissions (no new routes), the web (T50).

## The 2 report keys (registered in `registry/index.ts` §10, 66 → 68)

| Report key | AR title | Permission (0027 seed) | Assertions |
|---|---|---|---|
| `services.contract_revenue_schedule` | جدول إيرادات العقود | `crm.contracts.manage` | `contract-revenue-gl-tie` (GL, tolerance 0) + `schedule-reconciliation` (invariant) |
| `services.time_billing_summary` | ملخص وقت العمل والفوترة | `crm.contracts.manage` | — (operational, README rule-2 note) |

Both: category `industry`, bilingual AR-first, `executionClass inline` /
`printTemplate a4-report` (the kit defaults), money canonical 4dp strings
(hours 6dp), `currencyPresentation "base"`, freshness `current` 60 s TTL +
journal.posted/invoice.posted invalidation, no drillTargets (the PHASE-016/017
aggregate-first precedent).

## The reclass-pair netting decision (T47 deviation 9 — documented)

The per-row **overdue** column is scoped to the posted CONTRACT invoices' own
AR open items (partner_subledger DEBIT rows, source_type='sales_invoice' +
source_id=invoiceId, joined via posted_journal_id; outstanding = amount −
treasury_allocations of POSTED receipts/payments — the exact arOpenItemsAsOf
lateral, which picks up the J-REL release allocations automatically, so the
released invoice shows open = gross − released). The **J-DEF debit row is NOT
netted into per-invoice overdue**: it is not a contract-invoice row; the
advance-held exposure stays visible on the ar.aging/statement surfaces (the
spec pins both sides: at the report's asOf the J-DEF row is honestly absent —
its entry_date = the tag date "today" postdates a 2026-06-30 asOf — and at an
asOf after its posting it shows outstanding 500.0000 on the aging surface
while the report's overdue stays 1800.0000, never netting it).

## The R19 book (§15 fixture set on ONE tenant, staged so every run drafts exactly its chain)

Tenant `6d6d6d6d-6d6d-6d6d-6d6d-6d6d6d6d6d6d` (repo-grep verified unused), actor
R_ACTOR (the POLICY_ACTOR drafts are approved by R_ACTOR — no SoD conflict; no
second user needed). CoA template + the §15 purpose belt-and-braces map
(AR_CONTROL 1130 / SALES_REVENUE 4100 / SERVICE_REVENUE 4200 / VAT_PAYABLE 2120
/ DEFERRED_REVENUE 2130), FY2025+FY2026 OPEN, branch MAIN, STD 15%, partner
P-000001 NET30 (bilingual name), project CASE-01, fee items FEE-RET/FEE-MIL/
FEE-HR (SERVICE, STD), cash account. The service graph is manual with the
contract-billing port wired on the spec's OWN salesInvoices instance (§18
lesson 6). Sequencing (each run tenant-wide, so contracts are created in an
order that keeps earlier chains' future entries undrafted):

1. **C3 milestones** (Signing 5000 @ 2026-03-01, Delivery 7000 @ 2026-05-01) →
   run asOf 2026-03-01 drafts ONLY Signing (nothing else exists).
2. **C4 hourly** (2026-03-01→04-30, mode gate "hourly" set then reset): the
   §15 slips (3.0 h Research 03-28, 2.0 h Drafting 04-03, 1.5 h narrative-less
   04-10), weekly reviews; runs asOf 2026-04-15 (March 750) + asOf 2026-04-30
   (April 500, the narrative-less slip skipped+listed).
3. **C1 retainer** (2026-01-15→06-14, 1000/mo): run asOf 2026-02-01 → Jan+Feb
   drafts; the JANUARY draft approved+posted (J-INV), FEBRUARY stays DRAFT.
4. **C2 deferral retainer** (2026-01-15→02-14): receipt 500 on-account
   2025-12-15 (J-RCP) → tag with `crm.defer_advance_recognition` ON (J-DEF,
   entryDate = today) → run asOf 2026-02-01 → Jan+Feb drafts → FEBRUARY
   approved+posted (J-INV2 + **J-REL**; invoice open 650).

Final state: C1 6000/1000/1000/4000 · C2 2000/1000/1000/0 · C3 12000/0/5000/
7000 · C4 HOURLY rows (750 + 500 draft, contracted/backlog NULL).

## Test outputs (industry-019.spec, 11/11)

1. **The book sanity** — J-INV lines pinned [1130:DEBIT:1150 · 4200:CREDIT:1000
   · 2120:CREDIT:150]; J-DEF + J-REL exist; the February invoice's open item
   settled 500 / outstanding 650; C1 grid 6 entries (Jan+Feb INVOICED, Mar..Jun
   PLANNED); C4 grid amounts NULL.
2. **The revenue schedule** (window 2026-01-01..2026-06-30, asOf 2026-06-30) —
   12 rows; per-row pins (C1 Jan: contracted 1000.0000 / invoicedNet 1000.0000
   / Vat 150.0000 / Gross 1150.0000 / backlog 0.0000 / overdue 1150.0000;
   C2 Feb: overdue 650.0000; Signing: draft 5000 / backlog 0; Delivery:
   backlog 7000; C4 rows: contracted/backlog NULL, drafts 750/500); totals
   contractedTotal 20000.0000 / invoicedNetTotal 2000.0000 / draftNetTotal
   8250.0000 / backlogTotal 11000.0000 / overdueTotal 1800.0000; **GL tie PASS
   {left 2000.0000, right 2000.0000}**; **reconciliation PASS {20000.0000,
   20000.0000}** + independent spec-side math per contract (C1+C2+C3, C4
   excluded as HOURLY).
3. **Overdue == the AR open-item computation** (BR-028) — via
   salesStore.arOpenItemsAsOf(asOf): the two contract invoices past due sum
   1800.0000 == the report's overdueTotal; the J-DEV deviation-9 pins (absent
   at 2026-06-30, outstanding 500.0000 at today, never netted).
4. **BR-028 determinism** — two fresh-service recomputed runs byte-identical
   (rows/totals/assertions).
5. **contractId filter** — 6 rows, C1-only totals, tie {1000.0000, 1000.0000}.
6. **Empty window** — 0 rows, tie PASS {0.0000, 0.0000}.
7. **Time billing** — one row CASE-01 × Reporting Actor: recorded/billable/
   invoiced hours 6.500000/6.500000/5.000000, amounts 1625.0000/1625.0000/
   1250.0000, entryCount 3; the 6 totals; operational (0 assertions + the
   rule-2 note); the projectId filter.
8. **Empty window** (before the slips) — 0 rows.
9. **Registry integration** — the two keys category industry / permission
   crm.contracts.manage / inline; ALL_KNOWN_PERMISSIONS has the key; snapshot
   length 68.
10. **Permission gating** — a context with only reporting.reports.run →
    PermissionDeniedError on BOTH reports (thrown before params bind — the
    run-service's assertContractPermission); the crm.contracts.manage grant
    alone unlocks the run.
11. **CSV export** — contains "CT-2026-", "2000.0000",
    "contract-revenue-gl-tie,PASS", "schedule-reconciliation,PASS".

## Decisions / deviations

1. **T43's runtime wiring was NOT present** (the brief said verify): T49 did
   the full DataSourceModule/SOURCE_MODULES/MODULE_DATA_PHASE/window wiring
   itself (grep-verified before starting).
2. **The reclass-pair netting** — see the dedicated section above.
3. **Window semantics**: rows = schedule entries with billDate ∈ [dateFrom,
   dateTo] (the frozen grid's own billing calendar); both GL-tie sides scope
   to the identical posted-invoice id set (apples-to-apples by construction —
   the posting engine credits revenue exactly total_net, so the tie is a real
   drift detector, not a tautology across different scopes).
4. **Status classes**: invoiced = POSTED (a posted invoice never changes
   status — correction is a credit note, INV-003/BR-031); draft =
   DRAFT/PENDING_APPROVAL/APPROVED; CANCELLED drafts honestly excluded.
5. **entryStatus is exposed** (PLANNED/INVOICED/SKIPPED) alongside billDate —
   the honest grid state (a drafted-but-unposted period shows entryStatus
   INVOICED with the money in the draft column; the grid flipped at generation).
6. **Hours totals at 6dp**: addExact is the 4-dp money scale; the qty totals
   use a local BigInt `addQty` at the 6-dp qty scale (the same discipline).
7. **The J-DEF entry_date is today()** (the tag's journal spec) — so at a
   past asOf the reclass row is honestly absent from the open-items surface
   (as-of-correct); the spec pins both the absence and the today visibility.
8. **Dashboard** (scope item 5): T45's `GET /api/v1/crm/dashboard-summary`
   verified green (leads.spec's dashboard-summary test in the 79/79 crm run).
   The manifest's dashboard:true pins surface automatically: the
   professional-services manifest pins BOTH services.* keys `pinned:true,
   dashboard:true, default_period:"this_month"`
   (packages/contracts/src/industry/templates.ts:1702/1708) and
   `buildReportPins` materializes them at apply into the applied state's
   report_pins — the PHASE-014 report_defaults mechanism; the keys now EXIST
   in the code registry (the precondition). NO code needed — the web CRM
   section binding is T50's.
9. **The render.spec environment note**: the chromium headless shell was
   missing in this sandbox (T40's had it) — installed with
   `npx playwright install chromium-headless-shell` (a sandbox environment
   fix, not a repo change); render.spec's 2 browser tests now run green.

## Handoff notes for T50 (web)

- **The report keys + params for `/reports?report=…` deep-links +
  INDUSTRY_REPORT_TARGETS**: `services.contract_revenue_schedule` — params
  {dateFrom, dateTo, locale, contractId? (uuid), asOf? (ISO, default =
  dateTo)}; `services.time_billing_summary` — params {dateFrom, dateTo,
  locale, projectId? (uuid)}.
- **Row/column shapes** (values keyed by column id):
  - contract_revenue_schedule — contractNo, partnerName, partnerNameAr,
    projectCode, periodKey (null on milestones), milestoneLabel (null on
    periods), entryType (RETAINER_PERIOD|MILESTONE|HOURLY_PERIOD), billDate
    (date), entryStatus (PLANNED|INVOICED|SKIPPED), contracted (money,
    NULL on HOURLY), invoicedNet/invoicedVat/invoicedGross, draftNet,
    backlog (NULL on HOURLY), overdue; totals contractedTotal/
    invoicedNetTotal/draftNetTotal/backlogTotal/overdueTotal; assertions
    contract-revenue-gl-tie + schedule-reconciliation; two notes (render the
    overdue semantics + the HOURLY labeling).
  - time_billing_summary — projectCode, projectName, feeEarnerName,
    recordedHours/billableHours/invoicedHours (6dp), recordedAmount/
    billableAmount/invoicedAmount (4dp), entryCount; 6 totals; 0 assertions
    (render the operational note).
- **The dashboard CRM section** binds T45's `/api/v1/crm/dashboard-summary`
  + the two pinned reports (the applied template's report_pins carry
  dashboard:true for both keys — no new API).
- **Phase owner (docs)**: the industries/reports/README registration note is
  updated (68 total); PHASE-018-COMPLETION.md's historical "66" is a phase
  record and intentionally untouched.
