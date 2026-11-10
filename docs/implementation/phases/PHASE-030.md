# PHASE-030 — Wholesale & Electronics Templates

> **Status:** COMPLETE · **Updated:** 2026-11-08 (delivered per
> [reports/PHASE-030-COMPLETION.md](reports/PHASE-030-COMPLETION.md); the
> task-table drift was corrected in-delivery: the migration is
> `0041_industry_wholesale_electronics.sql` (not 0030) and the test suites live
> under `apps/api/src/__db__/configuration/templates-030.spec.ts` +
> `apps/api/src/modules/configuration/__tests__/capability-matrix-reconciliation.spec.ts`
> + `apps/api/src/modules/reporting/__tests__/report-pack-wiring.spec.ts` — the
> repo conventions; T11's "UI composition" reduced to zero web code by the
> data-driven surfaces, exactly the phase's configuration-only ethos)

## 1. Phase Overview

- **Phase ID:** PHASE-030
- **Title:** Wholesale & Electronics Templates
- **Objective:** Deliver the first two Blueprint v2.0 industry templates —
  `industry.wholesale` and `industry.electronics` ([EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md)
  §B, ED-06) — as **versioned configuration artifacts over the existing modules**: manifests
  registered in the `industry_templates` seed registry per
  [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) L1, applied and switched
  through the **unmodified PHASE-015 engine** (additive-only per BR-038, graceful degradation
  when feature keys are absent or phase-gated), with terminology, menu emphasis, policy
  defaults, numbering series, inventory defaults, report pins, and onboarding checklists
  exactly as [wholesale.md](../../industries/templates/wholesale.md) and
  [electronics.md](../../industries/templates/electronics.md) define them. **This is an
  explicitly configuration-only phase** (register §B: "configuration over existing
  modules"): no new accounting rule, journal, table, column, or module code — templates are
  configuration, never a fork (INV-022), and any engine gap found here is a PHASE-015
  defect to fix there, not a fork to hide here.
- **Business value:** Wholesale traders and mobile/electronics retailers are the two largest
  v2.0 expansion segments named by the comparative research
  ([DR-003](../../decisions/product/DR-003-platform-expansion-v2.md)): B2B traders who live on
  quantity-break tiers, credit limits, statements, and post-dated cheques; and device
  retailers who live on the IMEI register, the repair bench, and trade-ins. Both get a
  workspace that speaks their language (عرض السعر، أمر التوريد، شريحة الكمية، سجل الأجهزة،
  بطاقة صيانة) on the same financial core — with zero new ledger surface, which is
  precisely what makes them cheap to ship and safe to switch.

## 2. Scope

In scope:

1. **Template applications via the PHASE-015 engine** (no engine changes expected — an
   engine gap found here is a PHASE-015 defect, not a fork):
   - `industry.wholesale` v1.0.0 per [wholesale.md](../../industries/templates/wholesale.md)
     / [manifest.wholesale.json](../../industries/templates/manifests/manifest.wholesale.json):
     terminology (`العميل / التاجر`, `فاتورة بيع جملة`, `عرض السعر`, `أمر التوريد`,
     `شريحة الكمية`, `سقف الائتمان`, `شيك مؤجل`, `كشف حساب العميل`…), trading +
     credit-and-collections navigation groups, policies (`credit_sale_credit_limit_enforced`,
     `qty_break_pricing_automatic`, `tier_price_automatic_by_partner`,
     `bulk_order_from_quote_one_click`, `delivery_before_credit_invoice`,
     `statement_monthly_by_default`, `pdc_note_requires_maturity_date`), series
     `QT/ORD/DLV/INV/CN/RCP/GRN/TRF`, WAC with all tracking off and negative stock
     forbidden, report pins (`notes.maturity-calendar` dashboard, `notes.aging`,
     `partners.ar_aging` dashboard, `inventory.stock_valuation`), onboarding steps
     (CoA with trade receivables + notes receivable, warehouses, price tiers, credit
     customers, opening stock, first cycle, first PDC note).
   - `industry.electronics` v1.0.0 per [electronics.md](../../industries/templates/electronics.md)
     / [manifest.electronics.json](../../industries/templates/manifests/manifest.electronics.json):
     terminology (`بيع بالتجزئة`, `بطاقة صيانة`, `الرقم التسلسلي (IMEI)`, `استلام الجهاز`,
     `شراء جهاز مستعمل`, `أجور الصيانة`…), counter + repair navigation groups, policies
     (`cash_sales_autopost`, `imei_capture_required_flagged_items`,
     `repair_parts_issue_mode: reserve`, `repair_card_labor_rate_source: price_list`,
     `tradein_purchase_at_branch`, `warranty_credit_note_requires_original_invoice`,
     `shift_variance_approval_required`), series `INV/POS/RC/CN/GRN`, WAC with **serial +
     IMEI tracking on** by default (new items only, §5 R3), pins (`retail.imei_register`
     dashboard, `pos.sales_by_terminal` dashboard, `pos.sales_by_hour`,
     `inventory.stock_valuation`), onboarding steps (branch + terminals, CoA with
     device/service/used-goods separation, IMEI-flagged categories, labor-rate lists,
     opening stock with IMEI capture, first repair card, first shift).
2. **What each template emphasizes — all existing features, zero new logic**:
   - Wholesale: quantity-break price tiers on `price_list_items.min_qty` with customer
     tiers resolved per BR-003 precedence (quoted price never overridden —
     [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) §2.5);
     credit-first trading (per-partner credit limits enforced before save per BR-001,
     monthly statements reconciling to AR control per INV-009/012); receivables settled by
     **post-dated cheques via `notes.received`** (G-24/G-25/G-26 — PHASE-027 module,
     phase-gated here per its `available_from_phase`, see item 5).
   - Electronics: the **IMEI serial register** (`inventory.serial_tracking`, PHASE-010 —
     capture at GRN and sale; sale of an unregistered IMEI blocked); **repair job cards via
     `crm.service_orders`** (PHASE-019 generalization of the PHASE-017 job-card pattern —
     labor lines priced from rate lists, parts lines reserved then invoiced, two revenue
     natures); **trade-in purchases as ordinary purchases** (used device = new
     serial-tracked item at branch GRN with condition-grade attribute — G-07/G-08 shape);
     **POS counter** (`pos.terminals`, `pos.sales`, `pos.offline_queue`, `pos.receipts` —
     PHASE-016 REQUIRED keys for this template, incl. the offline queue).
3. **Manifest registration**: both manifests seeded into `industry_templates` (data-only
   migration; the extracted JSONs in
   [industries/templates/manifests/](../../industries/templates/README.md) are the CI source
   of truth), validated against the [industries/README.md](../../industries/README.md) §3
   JSON Schema; `scripts/extract_manifests.py` TEMPLATES already carries both
   filename→family pairs (register §L/ED-17).
4. **Policy-registry keys**: the new `workflow_policies` keys above are registered as typed,
   whitelisted policy-registry rows (configuration-module seed data; unknown keys are
   rejected at manifest validation — NFR-011), with documented semantics and L1-default →
   L5-override resolution; **no policy may bypass an invariant** (INV-022) — the
   config-fuzz suite extends to both templates' apply/switch inputs.
5. **Phase-gating interplay with PHASE-027**: wholesale's REQUIRED `pdc_notes` capability
   declares `available_from_phase: PHASE-027` (as does electronics' OPTIONAL one). PHASE-027
   is **not** a blocking prereq here (register §B: 030 needs 015/017/019 only): if 030
   lands first, PDC-flavored entries ship phase-gated "coming with PHASE-027" and credit
   trading settles via ordinary receipts (documented
   [wholesale.md](../../industries/templates/wholesale.md) known limitation); once the
   `notes.*` keys are live platform-wide, the same entries activate with **zero template
   change** — activation is entitlement/phase state, never a manifest edit.
6. **Configuration-engine governance tests** — the seven per-template requirements of
   [industries/README.md §8](../../industries/README.md) run for **both** templates:
   manifest schema validation; feature-key resolution (fail-closed); golden onboarding
   fixture (AR + EN); workflow smoke with expected journals; switch safety; RTL visual set;
   degraded entitlement.
7. **Capability-matrix assertions**: CI cross-checks each manifest's
   `capability_prerequisites` against the WHL/ELC columns of
   [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) §1 — zero
   mismatches, explicitly asserting the `pdc_notes` (REQ/OPT), `installment_terms`
   (OPT/OPT), `imei_tracking` (OPT/REQ), and `job_cards` (N/A/REQ) rows (register §L
   reconciliation rule).
8. **Navigation patches per [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md)**: templates
   add items and relabel via the registry (ids namespaced by template id); they **never
   reorder groups or remove core items** — the test asserts the core item set (groups 1–10)
   is unchanged by any apply/switch. Every added item is bilingual, carries `feature_key`
   (hidden when unentitled), and resolves an existing permission.
9. **UI — screens composed from existing archetypes only** (ADR-0016): the bulk quick-order
   workspace (order-entry archetype preset with barcode quick-keys and tier/quantity-break
   resolution display), trade-in intake preset (GRN screen + serial capture + condition
   grade), IMEI register emphasis, PDC custody/maturity-calendar emphasis (existing notes
   screens relabeled), repair-card workspace relabel (`بطاقة صيانة` over the
   `crm.service_orders` workspace), onboarding checklists. **No new archetypes, no new
   module code, no API changes.**
10. **Report-pack wiring**: pinned reports land on dashboards/registry from **existing keys
    only** — the v2.0 report mapping of
    [industries/reports/README.md](../../industries/reports/README.md) introduces no new
    industry-flavored report keys; `notes.*` pins resolve because the reports registered at
    PHASE-027 (register §J).

Out of scope (explicit):

- **Any new module, table, column, enum, journal, or posting rule** — INV-022 is the phase's
  central constraint; the negative ledger proof (§6) is the gate that enforces it.
- E-commerce B2B portals and storefronts (external adapters only, PHASE-023).
- Telecom carrier integration (SIM activation, airtime commissions, carrier billing) — an
  electronics-template non-goal; third-party installment financing (bank BNPL, carrier
  installments) likewise.
- New reports beyond report-pack wiring (register §J is closed for 030; the templates pin
  existing keys only).
- PDC desk features (endorsement, discounting, collateral management) — owned by the `notes`
  module (PHASE-027); templates only surface entry points.
- Offline field sales, sync clients, POS terminal changes (PHASE-016/020/022 own these;
  the offline queue the electronics template pins already exists).
- Template-authoring UX for brand-new industries (product decision record territory,
  [DR-003](../../decisions/product/DR-003-platform-expansion-v2.md)).

## 3. Prerequisites

- **PHASE-025 COMPLETE (GA gate)**: stages 9–11 are additive post-GA releases
  ([EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) ED-01; §O safeguard 5); the gate's
  evidence (load, DR, pen-test, runbooks) is the baseline this phase inherits. Verified via
  the GA release checklist + [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md).
- **PHASE-015 consumed as-is** (the engine this phase exercises): ten-layer resolution,
  `industry_templates` registry + manifest schema validation, idempotent audited apply,
  additive-only switching (BR-038, §5 rules R1–R10), dependency closure (BR-040),
  terminology + navigation runtime, degraded-entitlement paths. An engine gap discovered by
  this phase is filed and fixed in PHASE-015 — never forked here.
- **PHASE-017 consumed as-is**: `distribution.customer_tiers` (wholesale's REQUIRED
  `customer_price_tiers` composes it), `sales.discount_management`/`distribution.free_goods`
  (OPTIONAL promotions for both templates), `sales.commissions` (OPTIONAL), the
  credit-discipline patterns (`credit_sale_credit_limit_enforced`,
  `warranty_credit_note_requires_original_invoice`, `shift_variance_approval_required` —
  policy keys whose semantics this phase reuses verbatim), and the settlement/credit
  enforcement points these templates emphasize.
- **PHASE-019 consumed as-is**: `crm.service_orders` — the generalized job card that the
  electronics template's repair cards (`repair_parts_issue_mode: reserve`, labor-rate price
  lists, warranty credit notes referencing the original invoice) run on without change.
- **Composed features consumed as-is**: PHASE-006 (price lists with `min_qty` tiers,
  partners/credit terms/statements), PHASE-010 (multi-warehouse, serials/IMEI, batches),
  PHASE-011 (GRN incl. trade-in intake), PHASE-012 (quote → order → delivery → credit
  invoice chain, credit limits, receipts/allocations), PHASE-013 (report contract + print),
  PHASE-016 (POS + cashier shifts), PHASE-027 (`notes.received`/`notes.pdc_calendar` +
  their reports — live when 030 executes after stage 9; phase-gated otherwise, §2 item 5).
- Required architecture decisions:
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (RLS untouched — no new
  tables; template state is tenant-scoped configuration data),
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (any journal
  this phase's workflows touch goes through the engine — and this phase adds **no** new
  journal shapes; INV-022),
  [ADR-0016](../../architecture/ADR/ADR-0016-ui-tailwind-radix.md) (all surfaced screens
  compose design-system components and existing archetypes, RTL-first),
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (pack mandates win
  over template numbering/invoice defaults — R7).
- Decision record: [DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)
  — the product umbrella authorizing ED-06 (templates as configuration-layer commercial
  additions; GA gate unchanged).
- Relevant documentation:
  [wholesale.md](../../industries/templates/wholesale.md),
  [electronics.md](../../industries/templates/electronics.md),
  [industries/README.md](../../industries/README.md) (§3 schema, §4 apply, §5 switching,
  §8 governance),
  [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) (§1 WHL/ELC
  columns, §2.5 tiers, §2.6 job cards, §2.9 `pdc_notes`/`installment_terms`),
  [industry-workflows.md](../../industries/workflows/industry-workflows.md) (g) and (h) —
  the signature flows this phase proves,
  [industries/reports/README.md](../../industries/reports/README.md) (v2.0 report mapping),
  [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) (§1 v2.0 note: **no
  engine changes required**),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (every required key resolves),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-001, BR-003, BR-038, BR-040),
  [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md) (INV-009/012/022),
  [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (G-24…G-26 — consumed, not
  modified),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.8
  (`configuration.templates.apply` — risky, audited; no new keys this phase),
  [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §2 (patch rules),
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md),
  [SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md)
  (templates never grant features — plans do),
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) (stage 10).

## 4. Design Impact

- **Database changes:** **none.** No new tables, columns, or enums. One **data-only** seed
  migration registers both manifests as `industry_templates` rows (key, name/name_ar,
  manifest jsonb, version 1.0.0, status ACTIVE) plus the typed policy-registry rows for the
  new workflow policies. `tenant_industry_config` records applied state on apply/switch as
  in PHASE-015. [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) is unchanged (no
  catalog entries — there is no new schema to catalog).
- **API changes:** none. The existing PHASE-015 endpoints are consumed as-is
  (`POST /configuration/templates/{id}/apply|switch|extend`, `preview`, registry reads);
  both templates are pure inputs to them. No new routes; contracts unchanged.
- **UI changes:** navigation patches (added groups/items: trading + credit for wholesale,
  counter + repair for electronics; relabels from terminology overrides), composed screen
  presets listed in §2 item 9, template home + onboarding checklist rendering. All screens
  instantiate existing archetypes (List + Search, Transaction/Entry workspace, Wizard,
  Document Detail, Dashboard) with AR/EN baselines.
- **Security & authorization:** **no new permission keys.** Template apply/switch stays
  behind the risky, audited `configuration.templates.apply`
  ([AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.8); added nav items
  resolve existing feature-implied permissions; the attack-test re-run asserts an
  unentitled user gets an opaque 404 on composed routes (BR-039 — server decides
  visibility, never the client).
- **Accounting implications:** **none gained** — the phase's defining property. The
  workflows this phase emphasizes post G-01/G-02/G-03 (sales chain), G-07/G-08 (trade-in
  intake), G-24/G-25/G-26 (PDC, once entitled) — all existing goldens through the engine;
  no posting-rule rows are added or edited (INV-022). The negative ledger proof (§6) makes
  "applying or switching a template creates zero journal rows and zero new posting
  shapes" machine-checked, and the INV-009/012 discipline (statements tie to AR control)
  is asserted on the wholesale fixtures.
- **Localization implications:** both manifests' full terminology sets (AR/EN) —
  Arabic-first labels like `أمر التوريد` and `بطاقة صيانة` render from template overrides;
  onboarding checklists, series previews, and prints are bilingual RTL
  ([RTL_AND_LTR.md](../../localization/RTL_AND_LTR.md)); golden onboarding fixtures
  snapshot AR + EN.
- **Offline implications:** none. Configuration writes remain ONLINE-ONLY
  ([OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md) row
  #36); the electronics template's `pos.offline_queue` pin surfaces the **existing**
  PHASE-016/022 capability — no sync work here.
- **Module dependencies:** `configuration` gains registry rows only; nothing changes in
  `items`, `partners`, `inventory`, `sales`, `purchasing`, `treasury`, `pos`, `crm`,
  `notes`, or `reporting` — they are consumed through their published features and
  services ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) untouched).
  Direction of dependency is unchanged: templates sit at L1 **above** features, below
  tenant settings — configuration selects, never overrides.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Seed both manifests into the `industry_templates` registry (data-only migration; source = extracted [manifest.wholesale.json](../../industries/templates/manifests/manifest.wholesale.json) / [manifest.electronics.json](../../industries/templates/manifests/manifest.electronics.json), ids `industry.wholesale`/`industry.electronics` v1.0.0) | `apps/api/migrations/0030_industry_wholesale_electronics.sql`, `apps/api/src/modules/configuration/infrastructure/seeds/industry-wholesale.ts`, `industry-electronics.ts` | migration fresh+regression; registry read API contract tests; re-seed idempotent |
| T2 | CI manifest validation: both manifests parse and pass the [industries/README.md](../../industries/README.md) §3 JSON Schema (extends the PHASE-015 `validate-manifests` script set) | `scripts/validate-manifests.ts` (registration), `packages/contracts/src/industry/**` | schema green on both; negative fixtures (bad enum, orphan module, non-const negative stock) still fail |
| T3 | Policy-registry typed keys for the new workflow policies (§2 item 4) with documented semantics + L1-default → L5-override resolution + conflict-table notes | `apps/api/src/modules/configuration/infrastructure/seeds/policy-registry.ts`, `docs/product/CONFIGURATION_ENGINE.md` (§4 key rows) | unknown-key rejection at manifest validation; precedence tests (tenant explicit > template default > platform); no key can alter an invariant (config-fuzz extension) |
| T4 | Wholesale apply/switch/degrade suite: golden onboarding fixture (nav tree, terminology, series `QT/ORD/DLV/INV/CN/RCP/GRN/TRF`, WAC defaults, report pins, checklist — AR + EN); degraded-entitlement paths (missing OPTIONAL keys hide; missing REQUIRED key blocks with plan guidance; `notes.*` phase-gated "coming with PHASE-027" pre-027, ordinary-receipts fallback) | `tests/configuration/wholesale-template.spec.ts`, `tests/configuration/fixtures/wholesale/**` | all seven governance tests green; re-apply idempotent; degraded paths each asserted |
| T5 | Electronics apply/switch/degrade suite (same seven; series `INV/POS/RC/CN/GRN`; serial+IMEI defaults **for new items only** — R3; `pos.*` REQUIRED entries phase-live via entitlement) | `tests/configuration/electronics-template.spec.ts`, `tests/configuration/fixtures/electronics/**` | all seven governance tests green; existing items keep tracking flags after apply (R3) |
| T6 | Switch-safety tests per template: apply `industry.retail` (or `industry.grocery`) → create items + post documents → switch/extend to wholesale, and to electronics → assert zero data loss, explicit tenant settings intact, series append-only (R5), archived capabilities read-only (R6), claim-free BR-038 audit diff | `tests/configuration/wholesale-switch-safety.spec.ts`, `electronics-switch-safety.spec.ts` | BR-038 proven by test: no deletes/truncations/re-posts in the switch transaction; audit event carries the diff |
| T7 | Capability-matrix cross-check: manifest `capability_prerequisites` ≡ [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) §1 WHL/ELC columns — explicit asserts on `pdc_notes` (REQ/OPT), `installment_terms` (OPT/OPT), `imei_tracking` (OPT/REQ), `job_cards` (N/A/REQ), `customer_price_tiers` (REQ/OPT) | `tests/configuration/capability-matrix-reconciliation.spec.ts` | zero mismatches; adding a manifest capability without a matrix row fails CI (and vice versa) |
| T8 | Navigation-patch tests: core item set (groups 1–10 of [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md) §1) unchanged by apply/switch; added items bilingual + `feature_key`-gated (hidden when unentitled); ids namespaced by template id (no collisions) | `tests/configuration/nav-patch-rules.spec.ts` | core-removal/reorder attempts rejected by the engine; unentitled item hidden server-side; archived groups read-only |
| T9 | Signature-workflow smoke tests with expected journals against the real engine — workflow (g) wholesale (quote → order → delivery → credit invoice with BR-001 limit + BR-003 tier/min-qty resolution → statement tie-out → PDC G-24 → collect G-25 → dishonor G-26 when entitled; ordinary receipts pre-027) and workflow (h) electronics (check-in → quote → reserve → invoice G-01/G-02 + G-03 → warranty credit note; trade-in GRN G-07/G-08 with serial capture) | `tests/configuration/wholesale-workflow-smoke.spec.ts`, `electronics-workflow-smoke.spec.ts` | fixture-asserted journal lines equal the **existing** golden shapes; ledger-delta assertion: template apply/switch produce **zero** journal rows (negative ledger proof) |
| T10 | Report-pack wiring: pins land as pinned reports + dashboard widgets from existing keys only (`notes.maturity-calendar`, `notes.aging`, `partners.ar_aging`, `inventory.stock_valuation`, `retail.imei_register`, `pos.sales_by_terminal`, `pos.sales_by_hour`); registry boot validation re-run | `tests/configuration/report-pack-wiring.spec.ts` | pins resolve in the report registry ([industries/reports/README.md](../../industries/reports/README.md) v2.0 mapping); a pin for a non-existent key fails apply loudly |
| T11 | UI composition + RTL visual set: quick-order workspace preset, trade-in intake preset, IMEI register emphasis, PDC screens relabeled, repair-card relabel, template homes, onboarding checklists — AR + EN screenshots through the visual harness | `apps/web/src/features/industry/wholesale/**`, `apps/web/src/features/industry/electronics/**`, `apps/web/src/app/(app)/industry/**` | RTL visual set green (§8 test 6); component a11y + keyboard journeys; zero new archetypes (archetype-instantiation lint) |
| T12 | Attack/permission re-checks: unentitled composed routes → opaque 404 (BR-039); apply/switch audit events present; `configuration.templates.apply` remains risky/audited; permission seeds unchanged | `tests/isolation/**`, `tests/security/**` | permission checklist green; no new permission keys seeded (assertion, not assumption) |
| T13 | Docs sync: templates README + [industries/README.md](../../industries/README.md) pointers (PHASE-030 shipped), INDUSTRY_CATALOG status lines, CONFIGURATION_ENGINE §4 policy-key rows, [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) cross-check (no new keys), acceptance criteria mirrored into [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) | `docs/**` | docs validation green (links, headings, catalog drift); phase-doc count 34 per ED-17 |

## 6. Verification

**Automated tests (required):**

- **The seven governance tests** ([industries/README.md §8](../../industries/README.md)) ×
  2 templates: (1) manifest schema validation in CI; (2) feature-key resolution — every
  `required_feature_keys` and prerequisite key resolves in
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) ∪ register §D, entitlement service
  fail-closed; (3) golden onboarding fixture snapshot (navigation, terminology, series,
  inventory defaults, report pins, checklist — AR + EN); (4) workflow smoke with
  fixture-asserted journals per
  [industry-workflows.md](../../industries/workflows/industry-workflows.md) (g)/(h);
  (5) switch safety with zero data loss; (6) RTL visual set; (7) degraded entitlement.
- **Negative ledger proof**: applying, switching, and extending either template produces
  zero `journal_entries` rows and zero posting-rule changes — asserted by ledger-delta
  snapshots around every apply/switch transaction (INV-022 made machine-checked).
- **Signature-workflow journals** are line-by-line the existing goldens: wholesale credit
  invoice G-01 (+G-03 at delivery) with BR-001 block/warn at save and BR-003 tier +
  `min_qty` resolution where an explicit quote never loses; PDC path G-24 → G-25 → G-26
  (restores the open item exactly, INV-024); electronics repair invoice G-01/G-02 + G-03
  under `reserve`, warranty credit note mirrors and re-enters parts at original cost;
  trade-in GRN G-07/G-08 with serial capture at intake. Failure of any fixture to match
  the canonical shape is a Sev-1 — the phase must not have introduced journal drift.
- **Switch-safety tests**: retail → wholesale and retail → electronics on tenants with
  posted POS history — zero data loss, archived capabilities read-only, numbering series
  append-only, explicit tenant settings never removed (BR-038, §5 R1–R10); the audited
  what-will-change diff is asserted against the applied manifest.
- **Capability cross-check** (T7): the `pdc_notes` / `installment_terms` / `imei_tracking`
  / `job_cards` rows (plus every other row) match the manifests exactly — CI fails on any
  drift in either direction.
- **Phase-gating**: with `notes.*` keys unshipped (pre-PHASE-027 simulation fixture),
  wholesale onboarding completes in back-office mode with PDC entries labeled "coming
  with PHASE-027" and collections via ordinary receipts; with keys live, the same entries
  activate with no manifest change (entitlement/phase state only).
- **Permission/isolation re-runs**: unentitled feature routes return opaque 404 even with
  crafted requests (BR-039); apply/switch writes audit events; no new permission keys
  (seed diff assertion); config-fuzz extension over the two manifests' adversarial inputs
  (bad policy values, layer churn) never alters accounting mathematics or authorization.

**Manual verification:**

1. Onboard a fresh tenant as a wholesaler: walk the checklist (CoA with
   trade receivables/notes receivable, two warehouses, a price list with two quantity
   breaks and two customer tiers, credit customers with limits and opening balances,
   opening stock), then run the day: quote (tier + `min_qty` resolve and display) →
   one-click bulk order → delivery note → credit invoice (limit enforced) → monthly
   statement → PDC note into custody → maturity calendar → collect; in AR then EN.
2. Onboard a second tenant as a device retailer: create an IMEI-flagged category, capture
   serials at GRN, sell one unit over POS (shift open → sale → close with variance
   approval), take a trade-in at the branch, run a repair card end-to-end (check-in →
   quote → approve (reserved parts) → complete → invoice parts + labor → warranty credit
   note against the original invoice).
3. Switch the wholesale tenant to `industry.electronics` (degraded: no `pos.*` in its
   plan): review the diff preview, apply, verify the trading group archived read-only,
   posted documents and series intact, core navigation unchanged.
4. Degraded-entitlement spot check: remove `notes.received` from a test plan and confirm
   wholesale's PDC entries hide cleanly with the upgrade path (الميزة غير مفعّلة في خطتك).

**Acceptance criteria (objective):** *(mirrored into
[PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) row 030 when
that file gains its v2.0 rows.)*

1. Both templates apply via the **unmodified PHASE-015 engine** — zero engine-code changes
   in this phase's diff — and each passes all seven governance tests of
   industries/README §8, in AR and EN.
2. Both manifests pass [industries/README.md](../../industries/README.md) §3 schema
   validation in CI; ids are exactly `industry.wholesale` / `industry.electronics`,
   version 1.0.0, registered in `industry_templates`.
3. Feature-key resolution is fail-closed and proven by test: every required key resolves;
   a missing OPTIONAL key hides cleanly; a missing REQUIRED key blocks onboarding with
   actionable plan guidance; `notes.*` entries phase-gate per their
   `available_from_phase` with the documented ordinary-receipts fallback pre-027.
4. Switch safety is proven per BR-038 by test: apply a prior template → post documents →
   switch/extend to each new template → zero data loss, explicit settings intact, series
   append-only, archived capabilities read-only, audit diff recorded.
5. The capability cross-check is green and CI-enforced: manifests ≡
   [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) §1 WHL/ELC
   columns, including the `pdc_notes`, `installment_terms`, `imei_tracking`, and
   `job_cards` rows.
6. Navigation patches obey [NAVIGATION_MODEL.md](../../ui/NAVIGATION_MODEL.md): labels may
   change, items may be added (bilingual, feature-key-gated, permission-resolving), core
   items and group order never change — asserted across apply and switch.
7. The negative ledger proof holds: zero journal rows and zero posting-rule changes from
   any apply/switch/extend of either template (INV-022); all signature-workflow journals
   match the existing goldens line-for-line.
8. Report-pack wiring lands from existing keys only (no new report keys introduced by the
   phase); every pinned report resolves in the registry and renders its GL tie-out where
   monetary.
9. All surfaced screens instantiate existing archetypes (zero new archetypes; zero new
   API routes); the RTL visual set passes for both industry homes and signature screens.
10. Docs validation is green, including the 34-phase document set and the 13-manifest
    extraction (ED-17).

**Performance & security considerations:** template apply/switch is a bounded
configuration transaction (p95 ≤ 2 s at the PHASE-015 budget) — both manifests are small
jsonb rows; effective-config cache invalidation fires per
[CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) §9 and is asserted.
Security: no new surface — apply/switch remains the single risky, audited entry point;
composed routes inherit existing permission checks (BR-039 server-side resolution);
the config-fuzz suite covers both templates' adversarial inputs; no tenant data crosses
tenants (ADR-0005 — template state is tenant-scoped configuration).

**Migration & rollback:** one **data-only** seed migration (registry rows + policy keys);
no schema changes, so rollback = template deactivation: switch back is always possible
because nothing was destroyed (BR-038), and entitlement removal degrades to read-only
historical access per
[SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md).
Posted documents and journals made under either template are ordinary sales/purchasing/
treasury/notes documents — valid with or without the template active. Dev-only seed
revert otherwise.

## 7. Risks and Constraints

- **RISK-002 (template genericity)** — the standing template risk: a "wholesale" or
  "electronics" tenant whose real workflow diverges from the manifest. Mitigated by
  manifest terminology + policy defaults being tenant-overridable within guardrails (R8),
  and by the two design-partner validations the rollout requires before GA-marketing the
  shells (per [DR-003](../../decisions/product/DR-003-platform-expansion-v2.md) — shells
  are sold as commercial layers only, CD-05 anti-fabrication).
- **RISK-019 (implementing beyond phase)** — the tempting overreach here is *code*: a
  "quick" wholesale pricing tweak or a repair-card shortcut. The negative ledger proof +
  the zero-new-routes assertion (T12) are the gate; any feature gap found is either
  existing-module scope (PHASE-006/010/012/016/017/019/027 own their features) or a new
  product decision — never a template fork (INV-022).
- **Phase-gating drift**: if PHASE-030 executes before PHASE-027, the wholesale PDC
  emphasis is inert until the keys ship; the risk is a marketing or onboarding claim of
  PDC support before entitlement is real — mitigated by the phase-gated UI labeling
  ("coming with PHASE-027") and the degraded-entitlement test; activation after 027 needs
  zero template change (entitlement state, not manifest edit).
- **Policy-key sprawl**: both manifests add typed policy keys; the constraint is the
  policy registry — unknown keys are rejected at manifest validation (NFR-011), and each
  key's semantics are documented in
  [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) §4 before use. A key
  that would need an invariant bypass is a design error, not a configuration choice.
- **Constraint — pricing honesty**: quantity-break and tier resolution are exactly
  BR-003's precedence chain (`price_list_items.min_qty` tiers, per-tier lists); an
  explicitly quoted price always wins ([CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md)
  §2.5) — the template may emphasize this, never bend it. Labor cost remains untracked
  (PHASE-029 adds financial payroll) — repair profitability stays parts margin + labor
  revenue, labeled honestly per the §2.6 note.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-030-COMPLETION.md` with: the seven governance
  test outputs × both templates (AR + EN), switch-safety diffs (retail → wholesale and →
  electronics), the negative-ledger-proof output (zero journal rows across all apply/
  switch transactions), capability cross-check output, phase-gating evidence (pre-027
  fixture + post-027 activation), report-pack pin inventory, visual snapshots as secondary
  evidence, and the doc-sync diff summary.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-030 →
  COMPLETE per protocol), CHANGELOG,
  [industries/templates/README.md](../../industries/templates/README.md) +
  [industries/README.md](../../industries/README.md) (shipped pointers),
  [INDUSTRY_CATALOG.md](../../product/INDUSTRY_CATALOG.md) (template status),
  [CONFIGURATION_ENGINE.md](../../product/CONFIGURATION_ENGINE.md) §4 (new policy-key
  rows), [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (cross-check — no new
  keys), acceptance criteria into
  [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).
- **Exit criteria:** all 10 acceptance criteria green with evidence; both templates live
  via the unmodified PHASE-015 engine on tenants provisioned with the right feature keys
  and provably degraded-graceful without them; switching proven additive-only by test.
- **Definition of Done:** two seeded, schema-valid, seven-test-green templates whose
  entire diff is configuration data, composed UI presets, and tests — zero accounting,
  schema, or API changes; CI green; docs synchronized; zero TODOs in delivered scope.
- **Handoff instructions:** read the PHASE-030 completion report. The capability
  cross-check harness (T7) is the durable artifact — 031/032/033 add HLT/EDU/AGR columns
  to it as their shells land. Per
  [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B, the next stage-10 phases are
  all prereq-clear once 015/017/019 and their own functional prereqs are COMPLETE
  (031: 010/012/019/027; 032: 027; 033: 018). **Next eligible phase: PHASE-031 —
  Healthcare Commercial Shell** (PHASE-032/033 parallel-eligible after their deps;
  identify only, do not implement).
