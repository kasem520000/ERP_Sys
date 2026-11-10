# PHASE-026 — Fixed Assets & Depreciation

> **Status:** COMPLETE · **Updated:** 2026-11-07

## 1. Phase Overview

- **Phase ID:** PHASE-026
- **Title:** Fixed Assets & Depreciation
- **Objective:** Deliver the `fixed_assets` module per
  [DR-002](../../decisions/accounting/DR-002-fixed-assets.md) and
  [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-02: purpose-linked asset
  categories (BR-041), the asset register (`assets`, statuses + custodian),
  acquisition via the direct-capitalization journal **G-21** (purchases/GRN
  capitalization reuses the PHASE-011 documents), monthly depreciation runs
  (`depreciation_runs` + append-only `depreciation_lines`) computing STRAIGHT_LINE /
  DECLINING_BALANCE / UNITS_OF_PRODUCTION and posting **G-22** as a job-driven
  (ADR-0008), period-locked engine operation (BR-042, INV-023), optional audited
  revaluation (BR-044, delta to `REVALUATION_RESERVE`), disposal SALE/SCRAP with the
  mandatory loss mirror (**G-23**, BR-043, disposal locks the asset), 3 report
  contracts, and the الأصول الثابتة screens — every posting through the PHASE-007
  engine (INV-013 idempotency), with the register reconciled to its GL accounts
  (RECONCILIATION §1 row 10, activated here).
- **Business value:** Fixed assets are the depth gap the competitive research
  (2026-10-28) confirmed against every leading Arabic-market system: tenants run
  depreciation in spreadsheets that silently drift from the ledger. The accountant
  (P-02) gets a register answering "ماذا نملك؟ وما الذي كلفنا هذا الشهر؟" — cost,
  accumulated, and NBV machine-checked (INV-023), a month-end run producing exactly
  one journal, and disposal results landing in the income statement. ED-18 moves
  fixed assets from deliberate deferral to planned scope without touching the GA gate.

## 2. Scope

In scope:

1. **Asset categories** (`fixed_assets.categories`): `asset_categories` — `code`
   (tenant-scoped natural key, [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md)
   §12), `name`/`name_ar` (§3 bilingual rules), `useful_life_months_default`,
   `depreciation_method_default`, and the three purpose links `asset_purpose_key` ·
   `accum_depreciation_purpose_key` · `expense_purpose_key` (`FIXED_ASSET`,
   `ACCUM_DEPRECIATION`, `DEPRECIATION_EXPENSE` per register §E). **BR-041:** a
   category is unusable until all three purposes resolve to active accounts
   ([CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) §2); deactivation
   allowed, deletion not (INV-015); changes audited.
2. **Asset register** (`fixed_assets.register`): `assets` — `code` (tenant-scoped),
   `name`/`name_ar`, `category_id`, `acquisition_date`, `cost` (19,4),
   `salvage_value`, `useful_life_months`, `depreciation_method` (category default,
   per-asset override), `branch_id`, `custodian_user_id`, `status` (`asset_status`:
   ACTIVE, FULLY_DEPRECIATED, DISPOSED, WRITTEN_OFF — DATA_DICTIONARY §9), and
   `source_type`/`source_id` refs. List + search by code/name/category/branch/
   status/custodian; detail shows cost, accumulated-to-date, NBV, and the
   depreciation history (over `depreciation_lines`).
3. **Acquisition — direct capitalization** (`fixed_assets.acquisition`, **G-21**):
   a capitalization document binds (category, cost, funding) and posts
   `DR FIXED_ASSET (category account) · CR AP_CONTROL (partner)` — on credit — or
   `· CR CASH` — cash/bank — per register §F. The **opening variant** onboards
   existing assets: funding via `OPENING_EQUITY` plus an accumulated-to-date input
   `DR OPENING_EQUITY · CR ACCUM_DEPRECIATION`, so future runs resume from the true
   NBV (INV-023 from day one; PHASE-007 opening-balances discipline).
4. **Acquisition — purchases/GRN capitalization** (same feature): GRN lines flagged
   **capital-expense** route their debit to the category's `FIXED_ASSET` account
   instead of inventory (`DR FIXED_ASSET · CR GRNI`, PHASE-011 rule; net across GRN
   + supplier invoice = G-21); the supplier invoice completes the chain (clears GRNI
   → `AP_CONTROL`, VAT recoverable per PHASE-009) and binds the asset with PO/GRN/
   invoice refs. **CIP is deliberately manual** — G-21 documents accumulate it.
5. **Monthly depreciation runs** (`fixed_assets.depreciation`, **G-22**):
   `depreciation_runs` (`fiscal_period_id`, status DRAFT/POSTED, totals,
   `journal_entry_id`) + `depreciation_lines` 🔒 append-only (`run_id`, `asset_id`,
   `period_amount`, `accumulated_amount`, INV-003 pattern). **One run per (tenant,
   fiscal period)**; assembly = bounded **pg-boss job** per ADR-0008 (chunked,
   cancelable); posting explicit (`fixed_assets.depreciation_runs.post`). **BR-042:**
   depreciation posts only via runs — no manual asset journals; runs are
   **period-locked** (LOCKED period rejected — INV-011). **G-22:** one journal per
   run — `DR DEPRECIATION_EXPENSE · CR ACCUM_DEPRECIATION` (category accounts),
   lines per asset; posted runs reverse only via the engine (INV-014) — lines stay
   for audit.
6. **Methods & math** (same feature): **STRAIGHT_LINE** `(cost − salvage_value) /
   useful_life_months`; **DECLINING_BALANCE** — rate on opening NBV per
   [DR-002](../../decisions/accounting/DR-002-fixed-assets.md), floored so
   accumulated never exceeds the base (BR-043/INV-023); **UNITS_OF_PRODUCTION** —
   `(cost − salvage) × period_units / total_estimated_units`, usage **manual** per
   line in the run workspace (no metering). Month convention = the DR-002 default,
   encoded as golden fixtures. Half-up rounding per ADR-0009; the final period
   **absorbs the residual** so Σ over the life = cost − salvage exactly (property
   tests); at the floor the asset flips FULLY_DEPRECIATED and drops out of runs.
7. **Revaluation** (`fixed_assets.revaluation`, BR-044): `asset_revaluations`
   (`asset_id`, `revaluation_date`, `new_gross_value`, `new_accumulated`, `delta`,
   status DRAFT/POSTED, `journal_entry_id`). Optional, audited. Journal: `DR/CR
   FIXED_ASSET` (gross delta) · `DR/CR ACCUM_DEPRECIATION` (restatement) · residual
   **to `REVALUATION_RESERVE`** (net NBV delta) — both mirrors golden-tested;
   subsequent runs compute on the revalued basis per DR-002.
8. **Disposal** (`fixed_assets.disposal`, **G-23**): `asset_disposals` (`asset_id`,
   `disposal_date`, kind SALE/SCRAP, `proceeds`, `net_book_value`, `gain_loss`,
   status DRAFT/POSTED, `journal_entry_id`). Journal: `DR CASH (proceeds) · DR
   ACCUM_DEPRECIATION (accumulated) · CR FIXED_ASSET (cost)`, residual to
   `ASSET_DISPOSAL_GAIN` when proceeds > NBV — the **loss mirror posts
   `ASSET_DISPOSAL_LOSS`** (mandatory, register §F); SCRAP allows proceeds = 0 only
   as an explicit entry. **BR-043:** NBV respects the salvage floor; disposal
   **locks the asset** (DISPOSED; INV-023: once, only from ACTIVE/FULLY_DEPRECIATED).
   Official disposal numbers via the numbering service (ADR-0006, INV-021); posting
   requires `fixed_assets.disposals.approve` from a **second user** (SoD,
   [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §4).
9. **Register↔GL reconciliation (RC-10):** the fixed-asset check registers in the
   PHASE-007 framework — per category account: Σ gross current value = `FIXED_ASSET`
   balance; Σ accumulated = `ACCUM_DEPRECIATION` balance
   ([RECONCILIATION.md](../../accounting/RECONCILIATION.md) §1 row 10, currently
   "deferred" — activated here). Seeded drift → `BROKEN` + diff row + notification +
   close block (PC-04); the close checklist gains the advisory "depreciation run
   POSTED for the closing period" item ([PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) §2).
10. **Reports** (`fixed_assets.reports`, register §J): three contracts in the
    PHASE-013 registry, provenance = fixed_assets query services + owned tables
    (no source of truth → no report): `fixed_assets.asset-register` (as-of;
    category/branch/status/custodian filters; footer ties `fa-cost-tie` +
    `fa-accum-tie` block exports on failure), `fixed_assets.depreciation-schedule`
    (remaining schedule + posted-to-date), `fixed_assets.movements` (acquisitions,
    revaluations, depreciation, disposals per period); permissions per
    [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.11;
    PDF/XLSX/CSV via the PHASE-013 pipeline, as-of deterministic.
11. **UI per archetypes** ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)):
    asset List+Search (§2), asset Create/Edit (§3), categories under Settings (§8),
    **depreciation-run workspace** (§4 — assembly grid with editable
    UNITS_OF_PRODUCTION usage, `MoneySummaryBar` live totals, post), **disposal
    wizard** (§9), report pages (§7). NAVIGATION_MODEL group 5 المحاسبة gains
    **الأصول الثابتة / Fixed assets** (bilingual label, archetype, permission,
    featureKey per register §K/§D) — [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1.
12. **Attack + rule tests:** all six tables enter the isolation registry; spoof rows
    per [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 (PHASE-026
    row): asset create with foreign `category_id`/`branch_id`/`custodian_user_id`;
    disposal/revaluation on a foreign `asset_id`; a run against a foreign
    `fiscal_period_id` — typed **404** rejection, zero partial creation (S-04; A7).
    Rule suite `tests/fixed-assets/fixed-assets-rules.spec.ts` covers BR-041…044
    per the [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) §8 matrix.

Out of scope (explicit):

- Asset maintenance schedules and work orders (future decision record when evidence
  appears).
- Leasing (IFRS-16-style) accounting; revaluation-driven tax filings; IFRS-style
  recycling of `REVALUATION_RESERVE` to retained earnings at disposal — reserve
  balances remain; a manual equity journal is the tenant's tool (documented
  limitation, [DR-002](../../decisions/accounting/DR-002-fixed-assets.md)).
- CIP subledger automation — manual G-21 capitalization documents handle
  construction in progress; no automated CIP→asset conversion run.
- UNITS_OF_PRODUCTION metering/IoT integrations — usage is manual per run line;
  methods beyond the three registered ([DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md)
  §9 enum is exhaustive).
- Offline asset operations — no new OFFLINE_CAPABILITIES_MATRIX rows; posting stays
  engine-only (rows 15–18 discipline).

## 3. Prerequisites

- Required phases: **PHASE-025 COMPLETE (GA stage gate)** — expansion never reopens
  the GA gate ([EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-01);
  consumed artifacts: the GA release record + production-class envelope (posting
  p95 < 300 ms; month-end spike headroom) the new jobs must fit inside. Functional
  prereqs: **PHASE-007** — posting engine contract (`post`/`reverse`, error
  taxonomy, INV-013 idempotency, INV-014), purpose-mapping service (+ the six new
  v2.0 purpose keys, register §E), fiscal periods + checks (INV-011), numbering
  service (disposal numbers), reconciliation job framework (RC-10), approval policy
  service, GL drill-down. **PHASE-013** — report contract registry + boot validation
  ([REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md)), run orchestration
  (inline vs pg-boss), permission re-resolution, as-of determinism, block-on-fail
  assertions ([REPORT_RECONCILIATION.md](../../reporting/REPORT_RECONCILIATION.md)),
  print/export pipeline. Also consumed: branches (PHASE-004), custodian users
  (PHASE-003), purchasing docs (PHASE-011), tax codes (PHASE-009 — VAT recoverable
  completes acquisition cost), files (disposal attachments).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)
  (fixed_assets never writes GL tables — JournalSpec only),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (19,4 money;
  half-up; final-period residual),
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (RLS on all six
  tables), [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (official
  disposal numbers; `code`s are tenant-scoped natural keys, not official
  sequences), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)
  (assembly jobs — bounded, chunked, cancelable).
- Decision record: [DR-002-fixed-assets.md](../../decisions/accounting/DR-002-fixed-assets.md)
  — authority for method defaults, month conventions, declining-balance rate, and
  reserve policy; register entry ED-02.
- Relevant documentation: [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) §4
  (+ the seven-way **effect-matrix extension gate** — G-21/G-22/G-23 each complete a
  row before approval), [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7
  (G-21…G-23 — v2.0 addition),
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md) (INV-023
  new; INV-003/008/009/011/013/014/021 reused),
  [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §3,
  [RECONCILIATION.md](../../accounting/RECONCILIATION.md) §1 row 10 + §2–§3,
  [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) §2,
  [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) §2,
  [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §6/§9,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (fixed_assets section, ED-19),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (7 keys, §D),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-041…044) ·
  [BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §11 (§M) ·
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) ·
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.11 + §4 ·
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 ·
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md),
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) ·
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1.

## 4. Design Impact

- **Database changes:** six new tenant-owned tables — `asset_categories`, `assets`,
  `depreciation_runs`, `depreciation_lines` 🔒 (append-only, INV-003 pattern),
  `asset_disposals`, `asset_revaluations` — standard columns
  ([DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §1), UUIDv7 keys, RLS +
  composite tenant FKs, OC = no; five new §9 enums (`asset_status`,
  `depreciation_method`, `disposal_kind`, `revaluation_status`,
  `depreciation_run_status`). [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md)
  gains the fixed_assets section; the TABLES `fixed-assets.md` spec is authored
  in-phase (grow-per-phase rule); ERD refreshed.
- **API changes:** `/api/v1/fixed-assets/categories[/{id}]`, `/assets[/{id}]`,
  `/assets/{id}/capitalize`, `/depreciation-runs[/{id}/assemble|/post|/reverse]`,
  `/revaluations[/{id}/post]`, `/disposals[/{id}/post]` — per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md): POST actions with
  `Idempotency-Key`, 409 `IMMUTABLE_DOCUMENT`, typed 404 on foreign ids.
- **UI changes:** المحاسبة gains الأصول الثابتة (featureKey
  `fixed_assets.register`); six archetype screens; run workspace reuses
  `MoneySummaryBar`; disposal wizard ends in the `a4-document` voucher preview.
- **Security & authorization:** the §3.11 set activates
  (`fixed_assets.assets.view|create|manage|approve`,
  `fixed_assets.depreciation_runs.run|post`, `fixed_assets.disposals.approve`) with
  the §4 SoD row (creator ≠ approver, audited on use). Attack rows: foreign
  category/branch/custodian/asset/period references rejected with zero partial
  creation (S-04); every route A7-clean.
- **Accounting implications:** goldens **G-21** (credit + cash + opening variants),
  **G-22** (one journal per run, lines per asset), **G-23** (+ loss mirror,
  SCRAP-with-0-proceeds), each asserting all seven effect-matrix cells; purposes
  `FIXED_ASSET`, `ACCUM_DEPRECIATION`, `DEPRECIATION_EXPENSE`, `ASSET_DISPOSAL_GAIN`,
  `ASSET_DISPOSAL_LOSS`, `REVALUATION_RESERVE` (register §E); **INV-023** gained,
  enforced at every boundary; RC-10 registered; JOURNAL_RULES §7 + BUSINESS_RULES
  rows added by this phase's doc sync; failure packs mandatory (below).
- **Localization implications:** bilingual category/asset names; month names per
  locale; RTL-correct `a4-report` prints; tafqit on the disposal voucher; AR+EN
  baselines for every screen.
- **Offline implications:** no additions to
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md) —
  DRAFT-first/server-posted shapes keep future OFFLINE-DRAFT rows addable; posting
  stays engine-only (rows 15–18 discipline).
- **Module dependencies:** `fixed_assets` → `accounting` (engine, periods,
  numbering, reconciliation framework) + `partners` (AP partner lines via the AR/AP
  services, INV-009) + `purchasing` (read refs; capital-expense GRN hook) +
  `identity` (custodian) + `reporting` (contracts) per
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2; nothing else
  writes `depreciation_lines`
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) write matrix).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0026_fixed_assets.sql`: 6 tables + 5 enums + RLS/composite FKs/indexes + append-only grants on `depreciation_lines` | `apps/api/migrations/0026_fixed_assets.sql` | migration fresh+regression; RLS catalog; A1–A10 suite on all six tables |
| T2 | Category service: CRUD, bilingual names, purpose completeness (BR-041), in-use guard, audit | `apps/api/src/modules/fixed_assets/application/category-service.ts` | BR-041: unmapped category unusable (creation + posting blocked, typed error) |
| T3 | Asset register service: create/edit, `code` uniqueness per tenant, status machine, branch/custodian binding, NBV read model | `apps/api/src/modules/fixed_assets/application/asset-service.ts` | status transitions legal set; foreign category/branch/custodian ids → 404, zero partial |
| T4 | Direct capitalization + opening variant: G-21 posts, `OPENING_EQUITY` accumulated-to-date path | `apps/api/src/modules/fixed_assets/application/capitalization-service.ts` | G-21 golden (credit, cash, opening); INV-013 idempotency; INV-009 partner line on credit |
| T5 | Purchasing capitalization hook: capital-expense GRN line → `FIXED_ASSET` account; supplier invoice binds the asset (PO/GRN/invoice refs) | `apps/api/src/modules/fixed_assets/application/purchase-capitalization.ts` + `purchasing` extension point | chain fixture GRN → supplier invoice → asset ACTIVE; net posting = G-21; VAT recoverable on the invoice leg |
| T6 | Depreciation calculation service + run assembly job (ADR-0008): 3 methods, salvage floor, final-period residual, one-run-per-period dedupe | `apps/api/src/modules/fixed_assets/application/depreciation-service.ts`, `infrastructure/depreciation-assembly.job.ts` | INV-023 property suite (fast-check); 10k-asset assembly bounded + cancelable; second assembly same period → 409 |
| T7 | Run post + reverse: G-22 journal, period-locked check, FULLY_DEPRECIATED flip, engine reversal | `apps/api/src/modules/fixed_assets/application/run-service.ts` | G-22 golden (multi-category, one journal, per-asset lines); PERIOD_LOCKED failure pack; reverse per INV-014 zero residue |
| T8 | Revaluation service: BR-044, DRAFT→POSTED, reserve journal both directions, subsequent-run basis | `apps/api/src/modules/fixed_assets/application/revaluation-service.ts` | up + down mirrors golden; revaluation on DISPOSED asset rejected; audited |
| T9 | Disposal service + approval: G-23 gain/loss/SCRAP, approval separation, asset lock | `apps/api/src/modules/fixed_assets/application/disposal-service.ts` | G-23 golden (+loss mirror, +0-proceeds SCRAP); second disposal rejected (INV-023); SoD: creator cannot post |
| T10 | RC-10 reconciliation check + period-close advisory item | `apps/api/src/modules/accounting/application/reconciliation/*` (registration), `fixed_assets/**` | RC-10 green after each op set; seeded drift → `BROKEN` + notification + close block (PC-04) |
| T11 | Report contracts ×3 + ledger-tie assertions + baselines | `apps/api/src/modules/reporting/registry/fixed-assets/*.contract.ts` | boot validation; `fa-cost-tie`/`fa-accum-tie` block exports on seeded mismatch; as-of determinism (byte-identical) |
| T12 | Golden + invariant + rule suites | `tests/accounting/golden/G-21*,G-22*,G-23*`, `tests/accounting/invariants/INV-023*`, `tests/fixed-assets/fixed-assets-rules.spec.ts` | all green (blocking); failure packs zero-residue |
| T13 | UI screens + baselines (list, create/edit, categories, run workspace, disposal wizard, reports) | `apps/web/src/app/(app)/fixed-assets/**` | AR+EN baselines; axe + keyboard journeys; run workspace live totals |
| T14 | Attack registration + docs sync (catalog, §3.11, §9 enums, nav, rules, workflows §11, SCOPE §74 per ED-18) | `tests/isolation/**`, `docs/database/**`, `docs/product/**`, `docs/security/**` | isolation + permission checklists green; docs validation green |

## 6. Verification

**Automated tests (required):**

- Golden posting tests with expected journal lines + document state + audit events
  ([ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §1 conventions), each
  asserting the seven effect-matrix cells: **G-21** (credit: `DR FIXED_ASSET 12,000 ·
  CR AP_CONTROL 12,000` with partner line; cash + opening variants), **G-22** (run
  journal: `DR DEPRECIATION_EXPENSE 200.00 · CR ACCUM_DEPRECIATION 200.00` for a
  12,000 cost / 0 salvage / 60-month asset; multi-category run = one journal,
  per-asset lines; run POSTED + `postedJournalId`), **G-23** (sale above NBV:
  `DR CASH · DR ACCUM_DEPRECIATION · CR FIXED_ASSET · CR ASSET_DISPOSAL_GAIN`; loss
  mirror `… DR ASSET_DISPOSAL_LOSS`; SCRAP with explicit 0 proceeds).
- Failure packs per golden — `PERIOD_LOCKED` (run in a LOCKED period, INV-011),
  `PURPOSE_NOT_MAPPED` (unmap each category purpose, disposal gain/loss, reserve),
  `ENTRY_NOT_BALANCED`, `ALREADY_POSTED` (duplicate run post — INV-013 returns the
  original result), `INVALID_AMOUNT` (negative cost; salvage > cost),
  `NBV_FLOOR_VIOLATION` (disposal below salvage; over-depreciation assembly) —
  each with zero ledger/line/document residue.
- INV-023 suite: across a method mix (SL, DB, UoP), Σ depreciation ≤ cost − salvage
  per asset; NBV ≥ 0 at every boundary; disposal exactly once, only from
  ACTIVE/FULLY_DEPRECIATED; final-period residual absorption makes Σ = base
  exactly (property tests, half-up per ADR-0009).
- RC-10: after each operation set (capitalization ×2 paths, run, revaluation,
  disposal) the register ties to `FIXED_ASSET`/`ACCUM_DEPRECIATION` per category;
  seeded drift (line row without ledger effect) → `BROKEN` with the offending id;
  period close blocked (PC-04).
- Rule tests: BR-041 (category unusable until mapped), BR-042 (no manual asset
  journals; period lock), BR-043 (salvage floor; disposal locks), BR-044
  (revaluation audited, delta to `REVALUATION_RESERVE`) — `fixed-assets-rules.spec`.
- Report contracts: boot validation; assertions block export on a seeded tie
  failure; as-of determinism (same `(scope, dates, asOf)` → byte-identical).
- Isolation: A1–A10 on all six tables; foreign category/branch/custodian/asset/
  period ids in nested payloads → typed 404, no partial creation (S-04); A7 on all
  routes; permission checklist for §3.11 incl. the disposal-approve SoD boundary
  and audit on use.

**Manual verification:**

1. Create two categories (vehicles 60 months SL, computers 36 months SL) mapping all
   three purposes; register an asset under a category with one purpose unmapped →
   blocked with the bilingual reason.
2. Capitalize a vehicle on credit (direct document) and a computer via a flagged
   GRN line + supplier invoice; drill down from the `FIXED_ASSET` GL account to
   each capitalization journal and its bound source documents.
3. Assemble and post the month's depreciation run → GL shows exactly one journal;
   both assets' accumulated + NBV match the schedule screen; INV-023 holds.
4. Depreciate a computer to its floor → status flips FULLY_DEPRECIATED and the next
   run excludes it; attempt a manual journal targeting `DEPRECIATION_EXPENSE` →
   rejected per the BR-042 policy note.
5. Revalue the vehicle upward → `REVALUATION_RESERVE` credited; the next run uses
   the new basis. Sell it above NBV (gain posts), scrap a fully-depreciated asset
   (loss mirror); both lock DISPOSED; posting needs a second approver.

**Acceptance criteria (objective):**

1. Every fixed_assets posting goes through the engine with its canonical G-row shape
   (G-21/G-22/G-23 + loss mirror green with line-level expected-vs-actual asserts),
   official disposal numbers from the numbering service (INV-021), and INV-013
   idempotency per `(tenant, source_type, source_id, operation)`.
2. BR-041 enforced and tested: categories are unusable until all three purposes map
   to active accounts; the check blocks both asset creation and posting.
3. BR-042 enforced and tested: depreciation posts only via runs; runs are
   period-locked (LOCKED periods rejected, INV-011); one run per fiscal period; no
   manual asset-journal path exists for FA purposes outside documents.
4. INV-023 enforced and tested: Σ depreciation ≤ cost − salvage with exact
   final-period absorption, NBV ≥ 0 always, disposal once and only from
   ACTIVE/FULLY_DEPRECIATED (`DISPOSED_ASSET_REUSE` rejection), and disposal locks
   the asset.
5. Both acquisition paths are green: direct capitalization (credit, cash, opening
   variant with accumulated-to-date) and purchases/GRN capitalization reusing
   PHASE-011 documents with the PO/GRN/invoice binding chain and net = G-21.
6. Revaluation per BR-044: audited, DRAFT → POSTED, net delta to
   `REVALUATION_RESERVE` in both directions, subsequent runs on the revalued basis.
7. RC-10 is green in the permanently-blocking CI set; seeded drift is detected as
   `BROKEN` with the offending row and blocks period LOCK (PC-04);
   RECONCILIATION §1 row 10 is no longer "deferred".
8. The three report contracts are registered with `fa-cost-tie`/`fa-accum-tie`
   block-on-fail assertions, as-of determinism, and contract-level permission
   re-resolution at execution.
9. All six tables are in the isolation registry with A1–A10 green; foreign
   references are rejected with typed 404s and zero partial creation; the §3.11
   permission checklist is green and disposal approval is SoD-guarded + audited.
10. Every screen instantiates a sanctioned archetype with AR+EN baselines, axe +
    keyboard journeys green; the الأصول الثابتة nav item is registered with
    bilingual label and featureKey.

**Performance & security considerations:** run assembly is a bounded pg-boss job —
10k-asset tenant assembles in one chunked job (p95 < 30 s target, cancelable,
idempotent per period); register listings index on
`(tenant_id, category_id, status, branch_id)`; reports reuse the reporting cache
(≤ 60 s "current" mode, as-of in the key); month-end concentration uses ADR-0008
queue priorities validated against the PHASE-025 spike envelope. `depreciation_lines`
is append-only (grants + trigger) so repository misuse cannot rewrite depreciation
history; audit covers category changes, run post/reverse, disposal approve,
revaluation post.

**Migration & rollback:** additive migration `0026_fixed_assets.sql` (+ append-only
grants/triggers); no destructive changes; posted runs/revaluations/disposals are
immutable so rollback = previous image (expand-compatible per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md)); corrections are
reversal-only (INV-014).

## 7. Risks and Constraints

- RISK-009 extends here: one wrong G-22 corrupts expense and accumulated depreciation
  across **every asset simultaneously** — mitigated by golden-first ordering, the
  INV-023 property suite, and RC-10 before any UI polish counts as done.
- Method-convention ambiguity (declining-balance rate, acquisition-month
  participation, salvage interactions): every default is fixed in
  [DR-002](../../decisions/accounting/DR-002-fixed-assets.md) and encoded as
  fixtures; any tenant-visible option ships with a documented default.
- Onboarding drift: without the opening variant, tenants re-depreciate old cost and
  overstate expense — the opening-variant golden + INV-023 tests block that failure
  mode; onboarding surfaces the accumulated-to-date field.
- Purchasing-path double-count risk (asset line also hitting inventory): the
  capital-expense flag is exclusive on the GRN line, and the chain fixture asserts
  inventory is untouched.
- Constraint: BR-042's "no manual asset journals" is an engine-level policy note —
  the manual-entry surface must not grow asset shortcuts; CIP remains manual by
  decision, not by omission.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-026-COMPLETION.md` with: golden outputs
  (G-21 all variants, G-22, G-23 + mirrors, failure packs), INV-023 + RC-10 outputs
  (incl. seeded-drift `BROKEN` evidence), run-assembly job evidence at volume, both
  acquisition-path chain fixtures, screen baselines, isolation + permission
  checklists, and the doc-sync diff summary.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-026 row per protocol), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + new TABLES
  `fixed-assets.md` spec + ERD refresh,
  [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §9 (5 enums),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (7 keys) ·
  [SCOPE_AND_NON_GOALS.md](../../SCOPE_AND_NON_GOALS.md) (ED-18 → planned scope) ·
  [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) (3 rows) ·
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.11 + §4 SoD ·
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) (المحاسبة += item) ·
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-041…044 + §8 rows) ·
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (G-21…G-23) ·
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md) (INV-023) ·
  [RECONCILIATION.md](../../accounting/RECONCILIATION.md) §1 row 10 (deferred →
  PHASE-026) · [BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §11 ·
  [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (suites + RC-10) ·
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §2 (PHASE-026 row) ·
  [PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) §2 (advisory item);
  acceptance criteria copied into
  [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).
- **Exit criteria:** all 10 acceptance criteria green with evidence; INV-023 and
  RC-10 in the permanently-blocking CI set; a tenant can categorize, register,
  capitalize (both paths), run a month's depreciation, revalue, and dispose — in AR
  and EN — with the register provably tied to the ledger.
- **Definition of Done:** every riyal of asset cost, accumulated depreciation,
  revaluation delta, gain, and loss has exactly one journal, one append-only line
  trail, and one auditable source document; NBV ≥ 0 is machine-checked everywhere.
- **Handoff instructions:** read the PHASE-026 completion report. The
  depreciation-run job and RC-10 extend the period-close contract; consolidation
  (PHASE-034) consumes fixed-asset books (register §B: 034 requires 013, 026, 029).
  **Next eligible phase: PHASE-027 / PHASE-028 / PHASE-029** — parallel-capable
  after GA per [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B (each
  depends only on pre-GA phases); the agent protocol executes one at a time — take
  PHASE-027 next (identify only; do not implement).
