# PHASE-031 — Healthcare Commercial Shell

> **Status:** COMPLETE (delivered 2026-11-08 — the evidence lives in
> [reports/PHASE-031-COMPLETION.md](reports/PHASE-031-COMPLETION.md)) · **Updated:** 2026-11-08

## 1. Phase Overview

- **Phase ID:** PHASE-031
- **Title:** Healthcare Commercial Shell
- **Objective:** Deliver the `industry.healthcare` template
  ([EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B, ED-07) as a **commercial
  shell** — "configuration + light extension" per the register's phase table, never a
  fork: the patient is a **partner FINANCIAL file only** (no clinical data — the bold
  boundary of ED-07/ED-11), insurers are partners with **per-claim open items
  مطالبات تأمينية** tracked through a single additive claim-reference field on the sales
  invoice, the pharmacy is a FEFO batch store reusing `inventory.batch_tracking`
  unchanged, and claims are settled by cheque or **post-dated note شيك مؤجل** through the
  PHASE-027 `notes` module (G-24/G-25/G-26). The shell applies and switches through the
  **unmodified PHASE-015 engine** (additive-only BR-038, graceful degradation), wires
  terminology, navigation emphasis, dunning/report packs, and onboarding — with
  **zero new accounting rules, journals, or document types** (INV-022).
- **Business value:** Clinics, polyclinics, medical centers' back offices, and pharmacies
  are commercially underserved in the Arabic-market ERP space while the vertical HIS
  systems stay expensive and clinical-first
  ([DR-003](../../decisions/product/DR-003-platform-expansion-v2.md)): the financial
  layer — who owes what per claim مطالبة, which batch expires first in the pharmacy
  صيدلية, when the insurer's cheque matures — is exactly what this platform's core
  already does well. The shell gives the medical billing desk a workspace that speaks its
  language without a single clinical claim being made (CD-05 anti-fabrication).

## 2. Scope

In scope:

1. **Template application via the PHASE-015 engine** (no engine changes expected — an
   engine gap found here is a PHASE-015 defect, not a fork): `industry.healthcare` v1.0.0
   per [healthcare.md](../../industries/templates/healthcare.md) /
   [manifest.healthcare.json](../../industries/templates/manifests/manifest.healthcare.json):
   terminology (`المريض (الملف المالي)`, `شركة التأمين`, `مطالبة تأمينية`, `صيدلية`,
   `الزيارة`, `فاتورة الخدمات الطبية`, `دفع مباشر`, `شيك مؤجل`, `التحصيل`), billing +
   pharmacy navigation groups, policies (`patient_file_financial_only`,
   `claim_ref_required_for_insured_invoices`, `insurance_invoice_billed_to_company_partner`,
   `pharmacy_fefo_enforced`, `dunning_by_claim_enabled`, `insurance_credit_limit_per_company`),
   series `INV/CN/RCP/GRN`, inventory defaults (WAC, **batch + expiry on, FEFO on**, serial
   off — new items only, §5 R3), report pins (`notes.aging` dashboard, `notes.maturity-calendar`
   dashboard, `partners.ar_aging`, `inventory.expiry_list`), onboarding steps (CoA with
   services/pharmacy/notes-receivable purposes, insurers with credit limits + contracted
   fee schedules, patient financial files, pharmacy items, service items, first visit,
   first claim cheque).
2. **Claim-reference light extension — the phase's single schema change**: one
   **additive, nullable** `claim_ref` column on `sales_invoices` (varchar; an external
   insurer reference, **not** a document number — ADR-0006/INV-021 untouched). Semantics:
   a `claim_ref`-carrying invoice is a **claim (insured) invoice** billed to the
   insurance-company partner; a null one is **self-pay دفع مباشر** billed to the patient
   partner. The blueprint provides no partner custom-field mechanism, so the invoice-side
   reference is the claim marker — per the capability's own rule that "the claim is a
   reference stamped on invoices/notes/allocations, not a claim document entity"
   ([CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) §2.9). No
   new tables, no new enums, no backfill; catalog note per conventions (§4).
3. **Claim-ref capture + enforcement (configuration-driven)**: the template's
   `claim_ref_required_for_insured_invoices` policy (L1 default true, L5 overridable)
   drives the sales-invoice save path through the **existing** policy-resolution
   mechanism: with the policy active, the invoice form surfaces the bilingual claim-ref
   field (مطالبة تأمينية); an invoice saved with insurance billing selected but an empty
   claim ref is rejected with a typed `CLAIM_REF_REQUIRED` error; self-pay invoices save
   with the field null. Insurance billing selection is the billed-to partner + claim ref —
   **no partner classification enum is added** (insurers are ordinary customer-kind
   partners; the tenant identifies them by use: they are the billed-to partners of claim
   invoices, and per-insurer statements/aging group by partner).
4. **Patient-as-partner financial file**: the patient is a partners-directory record with
   the template's terminology — financial fields only (identity, contacts, credit terms,
   opening balances). The `patient_file_financial_only` policy is the honest guard: the
   phase asserts the partner form surfaces **zero clinical inputs** (no diagnosis,
   prescription, appointment, or clinical-note fields exist anywhere in the shell —
   machine-checked, §6), and visit billing runs on `crm.service_orders` (PHASE-019) with
   service lines + dispensed pharmacy items — no clinical semantics.
5. **Insurance-company partners + per-claim tracking**: insurers are customer-kind
   partners with per-partner `credit_limit` enforced before invoice save by the existing
   PHASE-012 machinery (BR-001 — `insurance_credit_limit_per_company` sets the template's
   enforcement default; exposure per company is the existing partner subledger, INV-009)
   and contracted fee schedules via `items.price_lists` + `distribution.customer_tiers`
   (OPTIONAL; insured vs private rate lists). Each claim is its own open-item slice on
   the insurer subledger: claim invoices group by `(partner, claim_ref)` in statements,
   receipts allocate to them through the ordinary allocation machinery (INV-016), and
   `Σ per-claim open items = AR control per partner` is asserted (INV-009/012).
6. **Claim lifecycle through `notes` (PHASE-027 consumed as-is)**: the insurer pays by
   cheque/PDC — a received note bound to the claim invoice posts **G-24**
   (`DR NOTES_RECEIVABLE · CR AR_CONTROL`, settling the claim open item; the claim ref
   rides through the note's `source_type`/`source_id` reference to the invoice);
   maturity deposit/collect posts **G-25**; a dishonored claim cheque restores the claim
   open item **exactly** (**G-26**, BR-046, INV-024). No `notes`-module change — the
   shell consumes the module's published features (`notes.received`,
   `notes.pdc_calendar`).
7. **Pharmacy FEFO flows (reuse, not rebuild)**: `inventory.batch_tracking` with expiry
   and **FEFO picking enforced** (BR-017) — batch/expiry capture at pharmacy GRN,
   nearest-expiry batch proposed/forced at dispensing (visit service orders and the
   optional POS counter), dispensing never exceeds on-hand (negative stock forbidden),
   expiry write-off stays behind approval with reason `EXPIRED`
   ([INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §1–§4 discipline
   unchanged). `inventory.expiry_list` is pinned for الرقابة على الصلاحية.
8. **Dunning + report packs (wiring, not new reports)**: claim dunning composes the
   PHASE-027 reports — `notes.aging` and `notes.maturity-calendar` gain an **optional
   group-by-claim parameter** (grouping key: the source invoice's `claim_ref`; a
   report-contract parameter extension, **not** a new report key — register §J is closed
   and the v2.0 report mapping of
   [industries/reports/README.md](../../industries/reports/README.md) introduces none);
   `partners.statements` renders per-insurer statements with claim grouping on the same
   existing contract. Dunning runs per claim مطالبة, not only per insurer
   (`dunning_by_claim_enabled`).
9. **Navigation patches** per [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §2:
   the billing group (الزيارات وأوامر الخدمة → `crm.service_orders`, الفواتير (مريض /
   تأمين) → `sales.invoices`, المطالبات حسب الشركة → `partners.statements`) and the
   pharmacy group (الرقابة على الصلاحية → `inventory.expiry_list`, كاونتر الصيدلية →
   `pos.counter` OPTIONAL, شيكات المطالبات → `notes.received`); templates add and
   relabel, **never remove core items or reorder groups** — asserted across apply/switch.
10. **Zero clinical data — the bold out-of-scope boundary (ED-07, ED-11)**: clinical
    records/HIS (diagnoses, prescriptions, patient charts), appointments and clinical
    scheduling, lab results/LIS integration, and medical staff rostering are **not built
    here and never claimed** — deep-vertical operations remain non-goals until a future
    decision record adds them
    ([DR-003](../../decisions/product/DR-003-platform-expansion-v2.md)). Claims
    adjudication (approval rules, tariff engines) and rejection/appeal cycles beyond
    credit notes are likewise out — manual bookkeeping per the template's known
    limitations.

Out of scope (explicit):

- **Clinical anything**: HIS records, appointments/scheduling, LIS/analyzer feeds,
  clinical staff rostering (ED-11); the patient file carries no clinical field, and the
  zero-clinical-surface test (§6) enforces it.
- **New modules/tables/journals** (INV-022): no claim document entity, no claim-status
  state machine, no adjudication engine — the claim is a reference
  ([CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) §2.9
  extension rules); no new report keys (register §J); no `notes`-module changes.
- Patient payment plans beyond the OPTIONAL `installments.plans` composition (PHASE-027
  feature consumed as-is when entitled).
- E-prescription, drug-interaction, Nphies-style claim-submission gateways, and insurer
  EDI adapters (external integrations — PHASE-023 territory and a compliance decision
  record, not a template shell).
- Any engine change: apply/switch/degrade behavior comes from PHASE-015 unmodified.

## 3. Prerequisites

- **PHASE-025 COMPLETE (GA gate)**: post-GA additive staging per ED-01
  ([EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §O safeguard 5) — verified via the
  GA release checklist + [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md).
- **PHASE-015 consumed as-is** (the template engine): manifest registry + schema
  validation, idempotent audited apply, additive-only switching (BR-038, rules R1–R10),
  dependency closure (BR-040), terminology/navigation runtime, degraded entitlement. An
  engine gap discovered here is fixed in PHASE-015, never forked here.
- **PHASE-010 consumed as-is**: `inventory.batch_tracking` (batches, expiry dates, FEFO
  picking per BR-017), serial tracking available for equipment categories (OPTIONAL),
  multi-warehouse for the pharmacy store.
- **PHASE-012 consumed as-is**: the AR chain (credit invoices, open items, receipts,
  allocations with INV-016 bounds), per-partner credit limits + BR-001 enforcement,
  statements reconciling to AR control (INV-009/012) — the claim rides these unchanged.
- **PHASE-019 consumed as-is**: `crm.service_orders` as the visit document — service
  lines (consultation, procedure fees priced from rate lists) + dispensed parts lines
  (pharmacy items), invoiced through the standard chain with two revenue natures.
- **PHASE-027 consumed as-is (claims are collected by cheque/PDC)**: the `notes` module —
  G-24 receipt into custody settling the claim open item, the PDC maturity calendar,
  G-25 collection, G-26 dishonor restoring the claim exactly (INV-024), and the
  `notes.aging` / `notes.maturity-calendar` reports the shell's dunning composes. Because
  027 is a prereq, the healthcare template's REQUIRED `pdc_notes` keys are live at apply
  time — **no phase-gating fallback is needed for claims cheques** (unlike PHASE-030,
  whose register row deliberately does not gate on 027).
- Also consumed as-is: PHASE-006 (partners, credit terms, statements, price lists),
  PHASE-011 (GRN with batch/expiry capture), PHASE-013 (report contract + print/export),
  PHASE-016 (POS counter + cashier shifts — OPTIONAL pharmacy counter).
- Required architecture decisions:
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (the additive column
  lives under the existing `sales_invoices` row policy — RLS untouched; shell state is
  tenant-scoped configuration),
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (every
  journal the shell touches goes through the engine — and the shell adds **no** new
  journal shape; INV-022),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (no new money fields —
  `claim_ref` is a string reference; monetary behavior unchanged),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (`claim_ref` is an external
  reference, never an official document number — series immutability INV-021 untouched),
  [ADR-0016](../../architecture/ADR/ADR-0016-ui-tailwind-radix.md) (screens compose
  design-system components and existing archetypes, RTL-first).
- Decision records:
  [DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)
  (product umbrella; ED-07 bounds the shell to the commercial layer) and
  [DR-003-notes-and-installments.md](../../decisions/accounting/DR-003-notes-and-installments.md)
  (the accounting policy the claims-by-PDC flow executes — G-24/G-25/G-26, flat-fee
  discipline).
- Relevant documentation:
  [healthcare.md](../../industries/templates/healthcare.md),
  [industries/README.md](../../industries/README.md) (§3 schema, §4 apply, §5 switching,
  §8 governance),
  [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) (§1 HLT
  column, §2.9 `insurance_claim_billing` / `pdc_notes`),
  [industry-workflows.md](../../industries/workflows/industry-workflows.md) (i) — the
  signature flow this phase proves,
  [industries/reports/README.md](../../industries/reports/README.md) (v2.0 report
  mapping), [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) (§1 v2.0
  note; §4 policy keys; §6 safety),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-001, BR-003, BR-017, BR-038,
  BR-040, BR-045…047),
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md) (INV-009/012/016/021/022/024),
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (G-24…G-26 consumed, not
  modified),
  [INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) (§1 tracking
  conversions, §4 COGS discipline),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.8
  (`configuration.templates.apply` — risky, audited; no new keys this phase),
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §2,
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md),
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (`sales_invoices` row gains the
  catalog note), [DATA_DICTIONARY.md](../../database/DATA_DICTIONARY.md) §6 (string
  reference field conventions),
  [MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md) (additive-migration
  rules), [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (configuration writes ONLINE-ONLY, row #36),
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) (stage 10).

## 4. Design Impact

- **Database changes:** exactly one — additive nullable `sales_invoices.claim_ref`
  (varchar(64), NULL by default, no backfill, no default value, inherited by the
  existing row policy; indexed only as `(tenant_id, claim_ref)` for claim grouping —
  optional, additive). No new tables, enums, or purpose rows.
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) updates the `sales_invoices` row
  with the column + a catalog note ("external insurer claim reference — captured only
  when a template policy activates it; null = self-pay") per the grow-per-phase rule and
  [MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md) additive discipline.
  The `industry.healthcare` manifest is seeded as a **data-only** registry migration.
- **API changes:** additive optional field only: `claim_ref` appears on the existing
  sales-invoice create/edit payloads and responses (`packages/contracts` schema gain;
  older clients ignore it — read-compat per
  [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) §4 governance); the
  `CLAIM_REF_REQUIRED` rejection is a typed validation error on the existing endpoint.
  `notes.aging` / `notes.maturity-calendar` / `partners.statements` gain an optional
  `group_by_claim` boolean parameter within the PHASE-013 report contract — no new
  routes, no new report keys.
- **UI changes:** billing workspace (visit list → invoice with the policy-gated claim-ref
  field and payer picker), claims-by-insurer statement view (claim grouping), claim
  aging/dunning board (group-by-claim parameter), patient financial file (standard partner
  form relabeled — zero clinical inputs), pharmacy expiry-control emphasis, onboarding
  checklist. All screens instantiate existing archetypes (List + Search, Wizard,
  Transaction/Entry workspace, Document Detail, Report Page) — no new archetypes.
- **Security & authorization:** **no new permission keys** — claims views ride
  `sales.invoices.*` / `partners.statements` / `notes.notes.view` permissions; apply/
  switch stays behind the risky, audited `configuration.templates.apply`
  ([AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.8). The patient
  file is partner-class data (same protection as any partner — RLS + tenant isolation);
  because the shell holds **no clinical data**, no health-data class is introduced (the
  zero-clinical-surface test keeps it that way). Attack rows: cross-tenant claim refs
  rejected with typed 404; unentitled composed routes return opaque 404 (BR-039).
- **Accounting implications:** **none gained.** The claim flows post G-01/G-03 (visit
  invoice + dispensed-items COGS) and G-24/G-25/G-26 (claim cheque custody → collect →
  dishonor) — existing goldens through the engine; `claim_ref` is metadata that never
  enters a journal line; the negative ledger proof asserts apply/switch/claim-field edits
  produce zero journal rows (INV-022). INV-009/012 tie-out extends to claim grouping:
  per-insurer Σ claim open items = AR control balance; INV-016 bounds hold on claim
  allocations; INV-024 binds claim-cheque custody to its ledger effects (consumed from
  PHASE-027).
- **Localization implications:** the manifest's terminology set (AR/EN), Arabic-first
  labels (`مطالبة تأمينية`, `المريض (الملف المالي)`), bilingual claim-ref field +
  `CLAIM_REF_REQUIRED` error, RTL statements/aging prints, tafqit on invoices where
  existing prints use it; golden onboarding fixtures snapshot AR + EN
  ([RTL_AND_LTR.md](../../localization/RTL_AND_LTR.md)).
- **Offline implications:** none — billing/dunning are back-office, ONLINE-ONLY rows per
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (notes/consolidation-family discipline); the OPTIONAL pharmacy POS counter reuses the
  existing POS offline rows unchanged.
- **Module dependencies:** a **light extension inside `sales`** (claim_ref column +
  policy-gated save validation + claim grouping read model) and a **parameter extension
  inside `reporting`** (group-by-claim); `configuration` gains seed rows only;
  `partners`, `inventory`, `crm`, `notes`, `treasury`, `pos` are consumed as-is through
  published features ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)
  write matrix respected — nothing outside `sales`/`reporting`/`configuration` is
  touched).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migration `0031_healthcare_claim_ref.sql`: additive nullable `sales_invoices.claim_ref` + optional `(tenant_id, claim_ref)` index; no backfill; RLS untouched | `apps/api/migrations/0031_healthcare_claim_ref.sql`, `docs/database/ENTITY_CATALOG.md` (catalog note) | migration fresh+regression; expand-compatible per [MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md); A1–A10 isolation suite re-run on `sales_invoices` |
| T2 | Seed the `industry.healthcare` manifest (data-only registry migration; source = extracted [manifest.healthcare.json](../../industries/templates/manifests/manifest.healthcare.json), id `industry.healthcare` v1.0.0) | `apps/api/migrations/0032_industry_healthcare.sql`, `apps/api/src/modules/configuration/infrastructure/seeds/industry-healthcare.ts` | registry read API contract tests; re-seed idempotent; schema validation green ([industries/README.md](../../industries/README.md) §3) |
| T3 | Policy-registry typed keys for the six workflow policies (§2 item 1) with documented semantics; L1-default → L5-override resolution; conflict-table notes | `apps/api/src/modules/configuration/infrastructure/seeds/policy-registry.ts`, `docs/product/CONFIGURATION_ENGINE.md` §4 rows | unknown-key rejection; precedence tests; config-fuzz extension — no policy alters an invariant (INV-022) |
| T4 | Sales claim-ref capture: contract field + policy-gated save validation (`CLAIM_REF_REQUIRED` when insurance billing selected with empty ref, policy from resolved config); claim grouping read model (`(partner, claim_ref)` open-item slices) | `apps/api/src/modules/sales/application/invoice-claim-ref.ts`, `packages/contracts/src/sales/**` | policy on/off tests; typed error with zero residue; claim grouping reconciles to AR control (INV-009) |
| T5 | Visit billing presets on `crm.service_orders`: service lines from rate lists + dispensed pharmacy items with FEFO batch proposal; invoice chain unchanged (G-01 + G-03) | `apps/api/src/modules/configuration/infrastructure/seeds/industry-healthcare.ts` (presets), `apps/web/src/features/industry/healthcare/**` | workflow smoke: visit → invoice journals exactly G-01/G-03; FEFO honors nearest-expiry batch; dispensing > on-hand rejected |
| T6 | Dunning/report wiring: `group_by_claim` parameter on `notes.aging`, `notes.maturity-calendar`, `partners.statements` (existing PHASE-013 contracts — parameter only, no new keys); dashboard pins land | `apps/api/src/modules/reporting/registry/notes/*.contract.ts`, `partners/*.contract.ts` | fixtures: claim aging buckets by `claim_ref` via note→invoice source join; footer tie Σ open notes = `NOTES_RECEIVABLE` unchanged; determinism byte-identical |
| T7 | Healthcare template suite — the seven governance tests of [industries/README.md §8](../../industries/README.md): schema validation, feature-key resolution (fail-closed), golden onboarding fixture (AR + EN), workflow smoke (signature flow (i)), switch safety, RTL visual set, degraded entitlement (missing OPTIONAL `pos.*`/`items.price_lists` hides cleanly; missing REQUIRED blocks with guidance) | `tests/configuration/healthcare-template.spec.ts`, `tests/configuration/fixtures/healthcare/**` | all seven green; re-apply idempotent; claim invoices remain valid ordinary invoices with the template off |
| T8 | Claim-lifecycle integration test: visit → self-pay invoice → insured invoice (limit enforced BR-001) → statement by insurer/claim → claim cheque into custody (G-24) → maturity collect (G-25) → dishonor restores the claim exactly (G-26, INV-024) → dunning per claim | `tests/configuration/healthcare-claim-lifecycle.spec.ts` | end-to-end journals line-asserted; per-claim open items = AR control after every step; zero residue on every failure path |
| T9 | Capability cross-check: manifest `capability_prerequisites` ≡ [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) §1 HLT column — explicit asserts on `insurance_claim_billing` (REQ), `pdc_notes` (REQ), `expiry_tracking_fefo` (REQ), `job_cards` (REQ), `installment_terms` (OPT) | `tests/configuration/capability-matrix-reconciliation.spec.ts` (HLT column added to the PHASE-030 harness) | zero mismatches both directions |
| T10 | Zero-clinical-surface enforcement: field-inventory test over the patient file form + all shell screens asserts no clinical inputs; `patient_file_financial_only` policy surfaces the honest "financial file" framing; grep-gate for clinical term keys in the shell's composition | `tests/configuration/healthcare-no-clinical-surfaces.spec.ts`, `apps/web/src/features/industry/healthcare/**` | machine-checked zero clinical fields; a clinical-named field/key in the shell fails CI |
| T11 | Navigation-patch + switch-safety tests: core nav (groups 1–10) unchanged; switch healthcare ↔ `industry.retail` (or back) on a tenant with posted claim invoices → zero data loss, `claim_ref` values retained and readable read-only, series append-only, BR-038 audit diff | `tests/configuration/healthcare-nav-switch.spec.ts` | core-removal rejected; archived claim views read-only; posted claim invoices immutable ordinary documents |
| T12 | Docs sync: ENTITY_CATALOG note, CONFIGURATION_ENGINE §4 key rows, INDUSTRY_CATALOG status, templates README pointer, FEATURE_CATALOG cross-check (no new keys), acceptance criteria mirrored into [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) | `docs/**` | docs validation green (links, headings, 34-phase set, 13 manifests per ED-17) |

## 6. Verification

**Automated tests (required):**

- **The seven governance tests** ([industries/README.md §8](../../industries/README.md))
  for `industry.healthcare`: manifest schema validation in CI; feature-key resolution
  fail-closed (every required key resolves in
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) — `notes.*` live per the 027
  prereq); golden onboarding fixture (nav tree, terminology, series `INV/CN/RCP/GRN`,
  batch+expiry+FEFO defaults for new items only, report pins, checklist — AR + EN);
  workflow smoke with expected journals; switch safety; RTL visual set; degraded
  entitlement.
- **Claim-lifecycle end-to-end** (T8): the acceptance-defining suite — visit (service
  order, no ledger) → insured invoice (`DR AR_CONTROL · CR services revenue · CR VAT` =
  G-01; `DR COGS · CR pharmacy inventory` = G-03; per-insurer limit enforced before
  save) → claim open item visible as its own `(insurer, claim_ref)` slice → statement
  reconciles (INV-009/012) → claim cheque into custody (G-24, claim ref carried via the
  note→invoice source ref) → maturity deposit + collect (G-25) → dishonor restores the
  claim **exactly** — amount, partner, claim references (G-26, BR-046, INV-024) →
  dunning per claim on the group-by-claim views. Every failure path (`CLAIM_REF_REQUIRED`,
  `PERIOD_LOCKED`, insufficient on-hand batch, over-limit insurer) leaves zero residue.
- **Negative ledger proof**: template apply/switch and any claim-ref edit produce **zero
  journal rows** and zero posting-rule changes (INV-022) — ledger-delta snapshots around
  every configuration transaction.
- **Claim reconciliation**: after each operation set, per-insurer Σ claim open items =
  AR control balance; per-claim slices never double-count across partial allocations
  (INV-016 bounds); `notes.aging` footer tie Σ open notes = `NOTES_RECEIVABLE` holds
  with the group-by-claim parameter on and off.
- **Zero-clinical-surface test** (T10): machine-checked field inventory — the patient
  file exposes only standard partner fields; no diagnosis/prescription/appointment/
  clinical-note key exists in the shell's terminology, forms, or contracts.
- **Migration safety**: fresh + regression runs; the additive column is invisible to
  existing tenants (null by default, no behavior change until a template policy activates
  capture — proven by running the v1.1 sales suites unchanged).
- **Capability cross-check** (T9) and **navigation/switch tests** (T11) as specified.
- **Permission/isolation re-runs**: unentitled routes opaque 404 (BR-039); apply/switch
  audit events; no new permission keys (seed diff assertion); cross-tenant claim refs
  rejected typed-404 (A-series attack rows re-run on the touched tables).

**Manual verification:**

1. Onboard a clinic tenant: confirm the chart-of-accounts step (services revenue, pharmacy
   inventory, `NOTES_RECEIVABLE`), create two insurers with credit limits and contracted
   fee-schedule price lists, import patients as financial files, load pharmacy stock with
   batches + expiry.
2. Run the clinic day: open a visit (consultation + dispensed FEFO batch) → self-pay
   invoice (patient billed, cash receipt) → insured invoice (insurer billed, claim ref
   required — try saving without it and read the bilingual `CLAIM_REF_REQUIRED` error) →
   per-insurer statement grouped by claim → register the claim cheque into PDC custody →
   watch the maturity calendar → deposit + collect at maturity; then dishonor a second
   claim cheque and confirm the claim open item is restored exactly and appears in claim
   dunning. Repeat in EN.
3. Prove the boundary: attempt to record anything clinical (there is no field — note the
   honest "financial file" framing on the patient form); confirm the pharmacy write-off
   path still requires approval with reason `EXPIRED`.
4. Switch the tenant to `industry.retail`: diff preview → apply → claim invoices remain
   readable ordinary invoices; the claim views archive read-only; core navigation
   unchanged.

**Acceptance criteria (objective):** *(mirrored into
[PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) row 031 when
that file gains its v2.0 rows.)*

1. The shell applies and switches via the **unmodified PHASE-015 engine** per BR-038
   (additive-only, audited diff, zero data loss on switch-back) and passes all seven
   governance tests of industries/README §8, in AR and EN.
2. The claim billing workflow runs **end-to-end on a template tenant** — visit → invoice
   (self-pay and insured) → claim open item → claim cheque/PDC note → collection (and
   the dishonor path) — with every journal line-asserted to the existing goldens
   (G-01/G-03/G-24/G-25/G-26) and zero residue on every failure path.
3. The schema change is exactly one additive nullable column (`sales_invoices.claim_ref`)
   with the catalog note per conventions; fresh + regression migrations green; existing
   tenants' behavior unchanged with the template off.
4. `claim_ref_required_for_insured_invoices` enforcement is policy-driven (L1 default,
   L5 override): insured invoices cannot save without a claim ref (typed
   `CLAIM_REF_REQUIRED`); self-pay invoices save with null; toggling the policy changes
   only the capture behavior, never posting.
5. Per-claim tracking reconciles: `Σ per-insurer claim open items = AR control`
   (INV-009/012) at every step; claim allocations respect INV-016; claim cheques obey
   INV-024 (dishonor restores the claim exactly).
6. Dunning and report packs wire **existing** keys only — `notes.aging`,
   `notes.maturity-calendar`, `partners.ar_aging`, `partners.statements`,
   `inventory.expiry_list` — with the optional `group_by_claim` parameter inside the
   existing report contracts; **no new report key is registered** (register §J).
7. Pharmacy flows reuse `inventory.batch_tracking` unchanged: batch/expiry capture at
   GRN, FEFO proposed/forced at dispensing (BR-017), dispensing never exceeds on-hand,
   expiry write-off stays approval-gated with reason `EXPIRED`.
8. **Zero clinical data surfaces** — machine-checked: no clinical field, terminology
   key, or screen exists in the shell; the patient file is a partner financial file only
   (ED-07/ED-11 bolded in the template doc and enforced by CI).
9. Degraded entitlement is graceful: missing OPTIONAL keys (`pos.*`, price lists/tiers,
  `installments.plans`) hide cleanly with the upgrade path; a missing REQUIRED key blocks
  onboarding with actionable guidance; the capability cross-check (HLT column, including
  `insurance_claim_billing` REQ) is green.
10. Docs validation is green (34-phase set, 13 manifests, all links/headings per ED-17),
    with the `sales_invoices` catalog note and CONFIGURATION_ENGINE §4 policy rows landed.

**Performance & security considerations:** the claim grouping read model is a bounded
query over existing AR open items + one column — p95 ≤ 500 ms at the PHASE-012 list
budgets, index `(tenant_id, claim_ref)`; report parameter extension rides the existing
reporting cache (as-of determinism preserved). Security: patient financial files get
partner-class protection only (RLS + audit) — and the shell introduces no health-data
class because it holds none (the zero-clinical-surface test is the enforcement);
claim refs are tenant-scoped strings that never leak cross-tenant (attack rows);
apply/switch remains the single risky, audited configuration entry point.

**Migration & rollback:** one additive column migration + one data-only seed migration —
both expand-compatible ([MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md));
no destructive change. Rollback: template deactivation (switch back — always possible,
nothing destroyed, BR-038); posted claim invoices/notes remain valid ordinary documents;
the nullable column may remain in place harmlessly (dev-only revert otherwise — never in
production, per the additive-migration rule).

## 7. Risks and Constraints

- **Clinical-data creep — the shell's defining product risk**: a request for "just one
  diagnosis field" is the thin edge of an HIS. Mitigation: the zero-clinical-surface CI
  gate (T10), the ED-07/ED-11 bolding carried through the template doc and this phase,
  and the [DR-003](../../decisions/product/DR-003-platform-expansion-v2.md) rule that
  reopening vertical operations requires a new product decision record, not a phase
  document.
- **Claim-entity creep (schema)**: the register sanctions "light extension", not a claims
  subsystem. Mitigation: exactly one column; the claim stays a reference — rejection/
  appeal cycles beyond credit notes are documented manual bookkeeping
  ([healthcare.md](../../industries/templates/healthcare.md) known limitations), and a
  future claim-document entity would need a register amendment (§C is closed).
- **RISK-009 extends here as reuse risk, not new-posting risk**: the shell posts nothing
  new — the danger is *mis-wiring* existing chains (e.g., claim dunning drifting from
  `notes` reality). Mitigated by the end-to-end claim-lifecycle suite with line-asserted
  journals, the INV-009 tie at every step, and the unchanged `notes.aging` footer tie.
- **Per-insurer exposure aggregation**: credit limits are per partner (per company) —
  cross-insurer or group-level exposure aggregation is **not fabricated**; tenants who
  need it use consolidation (PHASE-034) on separate legal entities. Constraint documented
  honestly rather than half-built.
- **Policy-key semantics** (`claim_ref_required_for_insured_invoices`,
  `insurance_credit_limit_per_company`): typed registry rows with documented semantics
  (NFR-011); the config-fuzz suite asserts neither key can bypass BR-001's block/warn
  machinery or INV-022 — enforcement selects, mathematics never changes.
- **Constraint — fee schedules**: insurer contracted rates are ordinary price lists +
  customer tiers (BR-003 precedence), not a claims-adjudication/tariff engine; versioned
  contracts are price-list versioning. The shell says so; sales claims must too (CD-05).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-031-COMPLETION.md` with: the seven governance
  test outputs (AR + EN), the end-to-end claim-lifecycle journal transcript (self-pay +
  insured + G-24/G-25/G-26 + dishonor restore), the claim reconciliation output
  (INV-009/012/024 ties), the zero-clinical-surface test output, migration fresh +
  regression evidence, capability cross-check (HLT) output, switch-safety diff, and the
  doc-sync summary.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-031 →
  COMPLETE per protocol), CHANGELOG,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) (`sales_invoices` claim_ref
  note), [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) §4 (six
  policy-key rows), [industries/templates/README.md](../../industries/templates/README.md)
  + [INDUSTRY_CATALOG.md](../../product/INDUSTRY_CATALOG.md) (shipped pointers),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) cross-check (no new keys),
  acceptance criteria into
  [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).
- **Exit criteria:** all 10 acceptance criteria green with evidence; the shell applies/
  switches per BR-038; the claim billing workflow runs end-to-end on a template tenant;
  zero clinical data surfaces (machine-checked); governance tests green.
- **Definition of Done:** one additive column, one seeded schema-valid template, six
  typed policy keys, composed screens from existing archetypes, and the claim lifecycle
  proven against the engine with existing goldens — zero new journals, tables, report
  keys, or permission keys; CI green; docs synchronized; zero TODOs in delivered scope.
- **Handoff instructions:** read the PHASE-031 completion report. The capability
  cross-check harness now carries the HLT column — PHASE-032/033 extend it with EDU/AGR
  as their shells land, and the `group_by_claim` report parameter is the pattern their
  statement/dunning wiring should reuse. Per
  [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B, the remaining stage-10 shells
  are prereq-clear (032 needs 015 + 027 — both COMPLETE by then; 033 needs 015 + 018).
  **Next eligible phase: PHASE-032 — Education Commercial Shell** (PHASE-033
  parallel-eligible; both identify-only — do not implement).
