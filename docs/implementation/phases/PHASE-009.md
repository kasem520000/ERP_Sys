# PHASE-009 — Tax Engine & Jurisdiction Packs

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-009
- **Title:** Tax Engine & Jurisdiction Packs
- **Objective:** Deliver the `tax` module per [TAX_ENGINE.md](../../localization/TAX_ENGINE.md)
  and [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md): the six
  distinct treatments, tenant tax codes and registrations, deterministic line→tax
  resolution with **rate snapshots stamped on document lines** and document tax
  summaries, jurisdiction packs for **all 10 countries** (SA/AE/BH/KW/OM/QA/YE/EG/JO/
  IQ) seeded as versioned rate tables carrying per-fact verification status, the
  inclusive/exclusive pricing policy, the NOT_REGISTERED/NO_VAT modes, the VAT return
  report v1 with the INV-012 GL cross-check, and the `EInvoicingAdapter` port with a
  fake adapter — no real integrations (those are PHASE-023 and gated on verified
  official specifications, RISK-005).
- **Business value:** Invoices must carry correct, frozen tax treatments from their
  first version — retrofitting tax lines into posted documents is impossible
  (immutability). This phase makes the platform sellable in every target jurisdiction
  while keeping every regulatory fact honestly labeled as research-baseline until
  verified against official sources.

## 2. Scope

In scope:

1. **Tax treatments** (seed, 6 — never conflated, TAX_ENGINE §1):
   `STANDARD_RATED`, `ZERO_RATED`, `EXEMPT`, `OUT_OF_SCOPE`, `REVERSE_CHARGE`,
   `NOT_SUBJECT` — with their distinct return-box semantics; Jordan's GST is modeled
   as VAT with local terminology recorded in the pack's regulatory notes.
2. **`tax_codes`** (tenant): code (tenant-unique), bilingual name, bound
   jurisdiction, default treatment, rate-snapshot policy; item-category defaults
   (consumed by items from this phase via the PHASE-006 reserved
   `items.tax_code_id` column — **this phase adds the FK + the item/category
   picker**).
3. **`tax_registrations`** (tenant): per-jurisdiction status
   `REGISTERED | NOT_REGISTERED | DEREGISTERED`, registration number, effective
   dates; **migrates the provisional `tax.registration.*` values captured at
   PHASE-004 onboarding** (expand-migrate-contract step documented in both phases).
4. **Jurisdiction packs for ALL 10 countries** per [COUNTRY_PACKS.md](../../localization/COUNTRY_PACKS.md)
   §5, seeded as `jurisdictions` + `jurisdiction_tax_rates`
   ([SEEDS/README.md](../../database/SEEDS/README.md) P-009 set): SA, AE, BH (VAT_IN_FORCE),
   OM, EG (VAT_IN_FORCE), JO (VAT_IN_FORCE, GST-named), QA (VAT_PLANNED), KW, YE, IQ
   (NO_VAT). Every rate row carries `treatment`, `rate`, `effective_from/to`,
   `source_ref`, and `verified_at = NULL` with the compliance-matrix
   **REQUIRES_VERIFICATION** status + official source — packs **load with
   verification flags**: UNVERIFIED items are allowed to load as configuration and
   the engine computes from them (baseline-research values), but **no pack may be
   marked `VERIFIED` without the per-fact checklist** in its
   [compliance-matrix/](../../localization/compliance-matrix/README.md) file (§4
   protocol); prior-rate history windows (e.g., SA before 2020-07) seed with
   `effective_to` so boundary tests pass.
5. **Resolution flow** (TAX_ENGINE §2, deterministic, side-effect-free): line (item,
   qty, price, discount) → item/category default tax code (overridable per
   document/partner type) → treatment + **rate at document date** from the pack
   version → tenant registration check (registered? compute; not registered →
   `NOT_SUBJECT`) → `line tax = round(base × rate, minor units, half-up)`
   ([ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)) → **rate snapshot
   JSONB stamped on the line** → document summary accumulated by (treatment, rate,
   tax code) → posting engine consumes the summary for `VAT_PAYABLE` /
   `VAT_RECOVERABLE` / `VAT_EXPENSED` lines (fail-closed purposes). Recomputation of
   a draft matches the original computation (golden-dataset determinism).
6. **Snapshot + summary contracts**: the `tax_snapshot` JSONB shape
   (treatment, rate, jurisdiction, pack version, effective window, verification
   status) and the document tax-summary shape are published in
   `packages/contracts`; consuming document tables (`sales_invoice_lines` etc.,
   PHASE-011/012) adopt the columns then — this phase tests the contracts at the
   service level. Posted documents **reuse their stored snapshots forever**
   (BR-033); pack upgrades affect drafts (warned) and future documents only.
7. **Inclusive/exclusive pricing policy**: tenant setting
   `tax.pricing_inclusive_default` (default `false`) + per-document override;
   extraction correctness (tax extracted from gross within the same rounding rules).
8. **NOT_REGISTERED / NO_VAT modes**: unregistered tenants compute `NOT_SUBJECT` —
   no VAT fields on documents, no VAT postings, clean registration transition; for
   NO_VAT jurisdictions (KW/YE/IQ — and QA while VAT_PLANNED) the whole tenant runs
   with tax fields absent and **no VAT postings**, treatments record `NOT_SUBJECT`,
   and documents print without VAT sections — absence of VAT ≠ absence of
   obligations (directive §6); other pack features (formats, identifiers) still
   apply.
9. **VAT return report v1** (`tax.vat_return` + `tax.summary-by-treatment` per
   [REPORT_CATALOG.md](../../reporting/REPORT_CATALOG.md) phase-009 rows): period +
   jurisdiction + registration selection; aggregates posted documents' tax summaries
   — output tax by treatment/category, input tax (recoverable vs expensed),
   reverse-charge amounts — and displays the **INV-012 GL cross-check side-by-side**
   (document summaries vs `VAT_PAYABLE`/`VAT_RECOVERABLE`/`VAT_EXPENSED` movements);
   **a mismatch blocks the ready-to-file status**; bilingual report data + screen
   rendering (DataTable-based v1; the formal report-contract engine renders from
   PHASE-013) + CSV/XLSX export via the files module; statuses draft → ready →
   filed-by-human with filing metadata recorded for audit
   (`tax.returns.mark_filed` — the platform **reports**, humans file).
10. **EInvoicingAdapter port + fake adapter** (`tax.einvoicing_framework`):
    the versioned port interface
    ([E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md) §1:
    payload builder → adapter → submission registry), the
    `e_invoicing_submissions` table (schema lands here; implementation PHASE-023),
    and a **fake adapter** for tests that exercises the submission lifecycle states
    (`PENDING → GENERATED → … → ACCEPTED/REJECTED`) without any external call; real
    adapters refuse to submit while their spec facts are `REQUIRES_VERIFICATION`
    (explicit `UNVERIFIED` stub behavior — RISK-005); dormant adapter slots for
    countries without regimes.
11. **INV-012 reconciliation check**: register the per-period
    Σ-document-tax-summaries vs GL-tax-movements check in the PHASE-007
    reconciliation framework (RC-06 + RC-07 seeded drift: a mutated summary blocks
    the return's ready status).
12. **Per-pack fixture tests** per the scenario lists in each
    [compliance-matrix/](../../localization/compliance-matrix/README.md) country
    file (e.g., [sa.md](../../localization/compliance-matrix/sa.md) §10) — the
    engine-level classes executable now: **standard-rated sale, zero-rated sale,
    exempt supply, mixed basket, credit note, rate-change boundary (day-before vs
    day-after snapshots), unregistered tenant** — plus NO_VAT-mode fixtures for
    KW/YE/IQ and at least one worked rounding example per minor-unit count (2-decimal
    and 3-decimal currencies). Test names carry the pack id
    (`golden/pack-sa/…` per ACCOUNTING_TESTS §8). Document-level per-pack goldens
    (real invoices, field sets, print outputs) extend in PHASE-012/013 and payload
    goldens are gated on PHASE-023 — the mapping of which scenario rows execute now
    vs later is recorded in the phase report.
13. **Pack upgrade mechanics**: version bump = new seed migration with changelog +
    verification record; staged preview → apply per tenant (admin diff preview);
    never retroactive (snapshots); drafts spanning an effective-date boundary are
    flagged on open (BR-033); pack version + rollout audited.

Out of scope (explicit):

- Real e-invoicing adapters (ZATCA/ETA), certificates, clearance/reporting flows,
  payload golden files — PHASE-023, gated on verified official specs (RISK-005/007).
- Document tables carrying tax columns (sales/purchase documents — PHASE-011/012
  adopt the snapshot/summary contracts) and invoice legal field-set enforcement
  (simplified vs tax invoice — PHASE-012/013 print).
- The full reporting engine + ReportViewer rendering + PDF (PHASE-013 — v1 here is
  the tax-module aggregation + screen + CSV/XLSX export).
- Excise, customs, withholding, Zakat — future pack features via decision record
  (ADR-0010 revisit triggers); verification of any rate against live official
  sources (a human compliance-owner task recorded in the worklog/verification log —
  the *plumbing* for verified_at/source_ref ships here).
- Tax UI beyond: tax codes manager, registrations manager, pack version viewer
  (preview/diff), VAT return screen.

## 3. Prerequisites

- Required phases: **PHASE-007 COMPLETE** — consumed artifacts: the posting engine
  (tax-effect lines via purposes, fail-closed), GL tax accounts +
  `account_purposes` (`VAT_PAYABLE`/`VAT_RECOVERABLE`/`VAT_EXPENSED`), periods +
  reconciliation framework (INV-012 check registration), numbering, PHASE-006's
  `items.tax_code_id` reserved column. PHASE-008 is NOT required (parallel-eligible
  per [PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md)
  §parallelism). Verified via completion report + green CI + IMPLEMENTATION_STATUS row.
- Required architecture decisions:
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (treatments,
  registrations, codes, snapshots; packs as versioned data; adapters isolated;
  NOT_APPLICABLE scheme), [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)
  (line-tax rounding half-up at minor units), [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)
  (tax posts only via the engine), [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md)
  (pack tables are global reference data — no tenant_id, read-only to `erp_app`,
  TENANT_ISOLATION §3).
- Relevant documentation: [TAX_ENGINE.md](../../localization/TAX_ENGINE.md)
  (normative model), [COUNTRY_PACKS.md](../../localization/COUNTRY_PACKS.md)
  (schema, lifecycle, per-country summary),
  [compliance-matrix/](../../localization/compliance-matrix/README.md) + the 10
  country files, [official-sources/README.md](../../localization/official-sources/README.md),
  [E_INVOICING_ARCHITECTURE.md](../../localization/E_INVOICING_ARCHITECTURE.md),
  [CURRENCY_AND_PRECISION.md](../../localization/CURRENCY_AND_PRECISION.md) §3
  (line-tax rounding), [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-007, INV-012, INV-022), [POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md)
  §4 (VAT lines), [ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §8
  (per-pack rule), [TEST_STRATEGY.md](../../testing/TEST_STRATEGY.md) §5 (per-pack
  fixtures), [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-032/BR-033),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §tax,
  [ERD/treasury-tax.md](../../database/ERD/treasury-tax.md),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.7,
  [SEEDS/README.md](../../database/SEEDS/README.md) (rule 2: verification records;
  rule 4: legal values read-only).

## 4. Design Impact

- **Database changes:** global reference tables `tax_treatments`, `jurisdictions`,
  `jurisdiction_tax_rates` (no tenant_id, no RLS, read-only to the app role —
  seeded with `verified_at NULL`); tenant-owned `tax_codes`, `tax_registrations`,
  `e_invoicing_submissions` (schema only, per catalog "023 (schema 009)"); FK added
  from `items.tax_code_id` (and category defaults) to `tax_codes`. All cataloged
  in-phase; the TABLES treasury-tax spec section (started in PHASE-008) gains the
  tax tables.
- **API changes:** `/api/v1/tax/tax-codes[/{id}]`, `/tax-registrations`,
  `/resolve-lines` (deterministic resolution preview for draft documents),
  `/vat-returns[/{id}/prepare|/mark-filed]`, `/packs[/{country}/versions|/preview|/apply]`,
  `/einvoicing/submissions` (registry queries; fake-adapter actions are test-only).
  Pack tables are read via public reference endpoints (no writes through the API —
  seed-only). All per [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md).
- **UI changes:** الإعدادات / Settings group gains tax codes + registrations
  screens; التقارير / Reports group gains the VAT return v1 screen (summary +
  side-by-side cross-check + export); pack version viewer with preview/diff. All on
  PHASE-005 components with AR+EN baselines.
- **Security & authorization:** §3.7 permissions activate:
  `tax.codes.manage` (audited), `tax.registrations.manage` (**risky** — audited),
  `tax.returns.view/prepare`, `tax.returns.mark_filed` (**risky**, audited — the
  platform never files), `tax.einvoicing.manage` (reserved risky key; only the port
  + fake adapter exist). New spoof rows per SECURITY_TEST_PLAN §2 PHASE-009:
  tax-code/rate id enumeration cross-tenant → 404; pack data is global read-only
  (A8-style join safety by construction). Registration numbers are C-PII-adjacent —
  redaction rules apply in logs.
- **Accounting implications:** INV-012 gains enforcement + tests (RC-06/RC-07);
  INV-007 coverage extends to tax residuals (property tests from PHASE-007 gain
  per-pack rate generators); the engine's VAT lines become exercisable end-to-end;
  INV-022: treatment semantics, snapshots, and GL mapping are **not configurable**
  (TAX_ENGINE §5 — configuration-fuzz extended with pack flips).
- **Localization implications:** the heart of the phase: per-country formats,
  identifiers (labels only; formats stay `null` until verified), bilingual
  treatment/tax-code names, Arabic GST terminology for JO (ضريبة المبيعات), VAT
  return rendering AR+EN with correct RTL tables; 3-decimal currency rounding
  fixtures (BHD/KWD/OMR/JOD/IQD).
- **Offline implications:** none active — resolution happens server-side at
  document time; offline devices later cache stamped snapshots (PHASE-016/020) and
  never recompute tax locally (matrix rows 4–5 remain READ-CACHED for prices/tax).
- **Module dependencies:** `tax` → `accounting` (posting engine, purposes) per
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) §2; consumed *by*
  sales/purchasing/treasury from their phases via the published `resolveTax`
  service + snapshot/summary contracts; pack seeds are platform-owned reference
  data (L2 in [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) —
  read-only to every other layer).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0010_tax.sql`: `tax_treatments`, `jurisdictions`, `jurisdiction_tax_rates` (global, read-only grants), `tax_codes`, `tax_registrations`, `e_invoicing_submissions` + items FK | `apps/api/migrations/0010_tax.sql` | migration fresh+regression; global-table grant assertions (no writes as `erp_app`); A1–A10 on tenant-owned tables |
| T2 | Seeds: 6 treatments + **10 packs** from the compliance-matrix files (versioned rates, `effective_to` history windows, `source_ref` + `verified_at NULL`) | `apps/api/seeds/tax_treatments.sql`, `seeds/jurisdictions/*.sql` | seed idempotency by natural keys; rate rows carry verification blocks; pack count = 10; NO_VAT packs ship fully (formats/identifiers) |
| T3 | Resolution domain service (pure): code → treatment + rate-at-date → registration check → rounding → snapshot + summary | `apps/api/src/modules/tax/domain/resolver/*` | determinism: same inputs → byte-identical outputs (golden dataset); draft recomputation matches; rounding per ADR-0009 (2- and 3-decimal worked examples) |
| T4 | Registration service + PHASE-004 settings migration (expand-migrate-contract) | `apps/api/src/modules/tax/application/registration-service.ts` | migrated values land in `tax_registrations`; transition fixture (NOT_REGISTERED → REGISTERED) computes cleanly |
| T5 | Tax codes service + item/category defaults + picker wiring | `apps/api/src/modules/tax/application/codes-service.ts`, `items` wiring | `items.tax_code_id` FK live; category default resolution; tenant-unique codes |
| T6 | Snapshot/summary contracts + posting integration (VAT_PAYABLE/RECOVERABLE/EXPENSED lines via engine) | `packages/contracts/src/tax/*`, `apps/api/src/modules/tax/application/posting-adapter.ts` | fail-closed `PURPOSE_NOT_MAPPED` when a VAT purpose is unmapped; INV-007 residual handling with engineered uneven fixtures |
| T7 | Inclusive/exclusive pricing policy + per-document override | `apps/api/src/modules/tax/domain/pricing-mode.ts` | extraction correctness on the same basket both ways (sa.md scenario 10) |
| T8 | NOT_REGISTERED / NO_VAT modes | `apps/api/src/modules/tax/domain/modes/*` | no VAT fields, no VAT postings, `NOT_SUBJECT` stamps; KW/YE/IQ fixtures; QA planned-mode behavior |
| T9 | VAT return v1: aggregation queries + INV-012 cross-check + ready-gating + statuses + CSV/XLSX export | `apps/api/src/modules/tax/application/vat-return-service.ts` | RC-06 (per-pack mixed period) + RC-07 drift blocks ready; filing metadata audited; determinism (re-run byte-identical) |
| T10 | EInvoicingAdapter port + fake adapter + submission registry schema | `apps/api/src/modules/tax/application/einvoicing/*`, `domain/adapter-port.ts` | fake adapter walks the full lifecycle states in tests; unverified paths refuse submission (RISK-005 stub rule) |
| T11 | Register INV-012 reconciliation check in the PHASE-007 framework | `apps/api/src/modules/accounting/application/reconciliation/*` (registration) | RC-06/RC-07 green; close-checklist tax item live ([PERIOD_CLOSING.md](../../accounting/PERIOD_CLOSING.md) §2 item 7) |
| T12 | **Per-pack fixture suites** (10 packs × the 7 engine-level scenario classes + NO_VAT extras + rounding worked examples) | `tests/tax/pack-{sa,ae,bh,kw,om,qa,ye,eg,jo,iq}/**` | every pack green before it can be enabled for tenants (ACCOUNTING_TESTS §8 rule); scenario-now-vs-later mapping recorded |
| T13 | Pack upgrade mechanics: version viewer, preview→apply, draft-spanning warnings, audit | `apps/api/src/modules/tax/application/pack-service.ts` | upgrade never rewrites posted snapshots (BR-033 test); drafts warned; apply audited with version + diff |
| T14 | UI screens (codes, registrations, VAT return v1, pack viewer) + baselines | `apps/web/src/app/(app)/settings/tax/**`, `(app)/reports/vat-return/**` | AR+EN baselines; axe + keyboard; RTL table rendering of the return |
| T15 | Attack registration + docs sync (compliance-matrix status notes, catalog, TABLES) | `tests/isolation/**`, `docs/database/**`, `docs/localization/**` | isolation + permission checklists green; docs validation green |

## 6. Verification

**Automated tests (required):**

- Per-pack fixtures (all 10): standard sale (line tax, summary, journal lines),
  zero-rated (0% in the correct box — never exempt), exempt (correct box, no input
  recovery assumption), mixed basket (treatment-grouped summary), credit note
  (negative amounts, mirror treatment), rate-boundary (day-before/day-after
  snapshots pin the correct rate — BR-033), unregistered tenant (`NOT_SUBJECT`,
  no VAT fields, clean transition fixture); NO_VAT packs (KW/YE/IQ): no VAT
  fields, no VAT postings, full-pack formats still apply; one worked rounding
  example per minor-unit count (2-dp SAR/AED/EGP/QAR/YER + 3-dp BHD/KWD/OMR/JOD/IQD).
- Determinism: resolution + VAT return recomputation byte-identical across re-runs
  (golden datasets per pack).
- INV-012: RC-06 (Σ summaries by treatment = GL tax-account movements per period,
  per-pack mixed fixtures) + RC-07 (seeded summary mutation blocks ready-to-file);
  check registered in the period-close framework.
- Posting integration: tax-effect lines post only via the engine with fail-closed
  purposes; INV-007 residuals are explicit lines (engineered uneven fixtures);
  config-fuzz extended: flipping entitlements/policies/pack previews never alters
  resolution math (INV-022).
- Security: tax-code/registration id enumeration cross-tenant → 404 (A7);
  `tax.registrations.manage` / `tax.returns.mark_filed` denials audited;
  global pack tables reject writes as `erp_app`.
- E-invoicing port: fake adapter drives the full submission state machine in tests;
  adapter refusal behavior for `REQUIRES_VERIFICATION` regimes is asserted.
- Migration: PHASE-004 `tax.registration.*` settings migrate into
  `tax_registrations` (dual-read window then contract per MIGRATION_STRATEGY §3).

**Manual verification:**

1. Enable the `sa` pack for a fixture tenant, set registration REGISTERED, create
   tax codes (STD15 + zero + exempt), assign an item default, and resolve a mixed
   basket preview — verify the summary groups by treatment and the stamp carries
   the pack version + verification status.
2. Flip the tenant to NOT_REGISTERED → the same basket resolves `NOT_SUBJECT` with
   no VAT fields; flip back — the transition leaves posted snapshots untouched.
3. Prepare the VAT return for a seeded period: both sides (summaries vs GL) agree →
   ready; mutate a summary row via test tooling → mismatch banner + ready blocked
   (RC-07).
4. Preview a pack version bump with a rate change → diff shown; apply → posted
   documents keep old snapshots; a draft spanning the boundary is flagged on open.
5. Switch a KW (NO_VAT) tenant through the same flows: no VAT sections anywhere, no
   VAT postings in the GL, treatments recorded honestly.

**Acceptance criteria (objective):**

1. All 10 jurisdiction packs are seeded with versioned rate rows carrying
   `source_ref` + `REQUIRES_VERIFICATION` status and `verified_at NULL`; prior-rate
   history windows exist where the compliance files record them; no pack can be
   flagged `VERIFIED` without the compliance-matrix checklist (enforced by the
   seed/verification plumbing, asserted by test).
2. The resolution service is deterministic and side-effect-free: identical inputs
   produce identical tax lines and snapshots (golden per pack); draft recomputation
   matches; rounding is half-up at minor units with 2-dp and 3-dp worked examples
   green in every pack.
3. The six treatments are never conflated: zero-rated reports in the correct box,
   exempt in its own, out-of-scope and reverse-charge distinct, `NOT_SUBJECT` for
   unregistered — proven by per-pack fixtures.
4. Rate snapshots are stamped on line contracts and frozen: a pack upgrade or rate
   change never rewrites a stamped snapshot (BR-033 test), and drafts spanning a
   boundary are warned.
5. NOT_REGISTERED and NO_VAT modes work end-to-end: no VAT fields, no VAT postings,
   `NOT_SUBJECT` recorded — with a clean registration-transition fixture.
6. The VAT return v1 renders output/input by treatment with the INV-012 cross-check
   side-by-side; mismatch blocks ready-to-file; filing is a human action recorded
   with metadata (`tax.returns.mark_filed`, audited); re-runs are byte-identical.
7. The EInvoicingAdapter port exists with a fake adapter exercising the submission
   lifecycle; no real integration code exists; unverified regimes refuse submission.
8. `items.tax_code_id` FK is live with category defaults; PHASE-004's provisional
   registration settings are migrated into `tax_registrations` (dual-read then
   contract).
9. Per-pack fixture suites are green for all 10 packs, and a pack without green
   fixtures cannot be enabled for tenants (CI rule); the scenario-now-vs-later
   mapping (document-level goldens → PHASE-012/013; payload goldens → PHASE-023)
   is recorded in the report.
10. All §3.7 permissions enforce on routes with audit on risky use; tax id
    enumeration cross-tenant → 404; new tables pass the isolation suite; screens
    have AR+EN baselines.

**Performance & security considerations:** resolution is pure and cacheable per
(tenant, code, date, registration) with content-hash keys; rate lookups index on
`(country_code, treatment, effective_from)`; return aggregation runs on indexed
period columns within statement timeouts; registration numbers redacted from logs;
pack tables are read-only reference data (TENANT_ISOLATION §3 — grant assertions in
CI); no external network calls exist in the module (fake adapter only).

**Migration & rollback:** additive migration `0010` + idempotent pack seeds; the
items FK is an expand step (nullable column existed since PHASE-006);
`tax_registrations` migration from settings is expand → dual-read → contract per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md) §3. Pack seed updates
ship as versioned migrations with changelog + verification records (SEEDS rule 2);
forward-only.

## 7. Risks and Constraints

- RISK-005 (misread requirements): every regulatory value ships as
  REQUIRES_VERIFICATION with its official source; nothing may be presented as
  compliance advice; verification is a human protocol this phase *enables*, never
  performs.
- RISK-006 (rates change mid-development): versioned rows + effective dates +
  snapshots + boundary fixtures make rate changes configuration events, not code
  events.
- RISK-008 (no-VAT assumptions wrong): NO_VAT packs carry their status as data;
  a VAT introduction is a pack version bump + verification task — no core change.
- Fixture-volume risk: 10 packs × 7+ scenarios is a large but mechanical suite —
  builders keep it maintainable (TEST_STRATEGY §5: fixtures are builders with
  expected outputs, never static dumps); CI budget respected by sharding per pack.
- Constraint: no document tables, no print templates, no real adapters here — the
  contracts must be finished and frozen so PHASE-011/012 adopt them without
  rework; treat the snapshot JSONB shape as a published contract.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-009-COMPLETION.md` with: per-pack
  fixture results (scenario × pack matrix), determinism golden outputs, RC-06/RC-07
  outputs, mode-switch (registered/unregistered/NO_VAT) evidence, pack-upgrade
  snapshot-preservation proof, fake-adapter lifecycle run, migration evidence
  (items FK + registrations), isolation + permission checklist results, screen
  baseline inventory, and the scenario-now-vs-later ledger.
- **Documentation updates required:** [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md)
  (PHASE-009 → COMPLETE + tag), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + TABLES treasury-tax spec +
  [ERD/treasury-tax.md](../../database/ERD/treasury-tax.md) refresh, the 10
  compliance-matrix files (implementation-status notes: pack seeded, fixtures
  executed, remaining scenarios mapped to PHASE-012/013/023),
  [COUNTRY_PACKS.md](../../localization/COUNTRY_PACKS.md) §5 status column if any
  baseline value changed during seeding (with decision record), FEATURE_CATALOG
  phase markers if adjusted. Acceptance criteria copied into
  `planning/PHASE_ACCEPTANCE_CRITERIA.md` (planned file — see PHASE-003 note).
- **Exit criteria:** all 10 acceptance criteria green with evidence; all 10 packs'
  fixture suites are blocking CI checks; the snapshot/summary contracts are frozen
  for PHASE-011/012; docs validation + drift checks green.
- **Definition of Done:** a tenant in any of the 10 jurisdictions gets honest,
  deterministic, snapshot-frozen tax treatment on every line it will ever post —
  with the platform's compliance posture (reports, never files; baseline-research
  values labeled until verified) enforced by code and tests.
- **Handoff instructions:** read the PHASE-009 completion report + the
  scenario-now-vs-later ledger. PHASE-010 (Inventory) requires PHASE-008 and this
  phase both COMPLETE — confirm PHASE-008 status before starting it. The
  resolveTax service, snapshot/summary contracts, and VAT-purpose posting adapter
  are the integration seams for PHASE-011/012; the adapter port is the seam for
  PHASE-023. **Next eligible phase: PHASE-010 — Inventory & Warehousing** (identify
  only; do not implement).
