import { describe, expect, it } from "vitest";

import {
  AGRICULTURE_TEMPLATE_MANIFEST,
  AUTOMOTIVE_TEMPLATE_MANIFEST,
  DISTRIBUTION_TEMPLATE_MANIFEST,
  EDUCATION_TEMPLATE_MANIFEST,
  ELECTRONICS_TEMPLATE_MANIFEST,
  FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
  GROCERY_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
  RESTAURANT_MANIFEST,
  RETAIL_MANIFEST,
  WHOLESALE_TEMPLATE_MANIFEST,
  hashManifestJson,
  type IndustryTemplateManifest,
} from "@erp/contracts";

import { composeTenantStaticConfig } from "../application/resolve/compose";
import { PLAN_KEYS, layerInputsFixture, l1Of, type PlanKey } from "./layer-fixtures";

/**
 * PHASE-015 §6 golden effective-configs (CONFIGURATION_ENGINE §10 #2):
 * one pinned, hashed effective config per shipped template × plan ×
 * jurisdiction example — the twelve v1.0.0 manifests (retail / grocery /
 * restaurant + the PHASE-017 automotive / distribution pair + the
 * PHASE-018 food manufacturing template + the PHASE-019 professional
 * services template + the PHASE-032 education template + the PHASE-033
 * agriculture template + the PHASE-030 wholesale / electronics pair +
 * the PHASE-031 healthcare commercial shell — the two lineages' template
 * sets united by the restoration merge) × the plan seeds
 * (migration 0008/0021/0024/0025/0026/0027 + the PHASE-027 0038 grants)
 * × the SA jurisdiction seed (migration 0013, pack 1.0.0-baseline, VAT in
 * force, registered tenant).
 *
 * A resolution change that alters any golden hash fails CI unless the
 * change is a reviewed decision — that is this spec's entire job. The
 * structural assertions beside each pin exist so a mismatch is debuggable,
 * not so they can substitute for the pin.
 *
 * PHASE-048 (W-8, 2026-11-20) review note: ALL 37 pins re-pinned — 27 of
 * 37 moved, two reviewed changes together (the 047 W-1 procedure). (1)
 * Migration 0103 §3 composes the THREE FEATURE FLAGS (projects.wbs ·
 * projects.contracting · projects.fieldservice) into the two
 * project-carrying templates' required chains (professional_services +
 * automotive — the golden table carries no rental_logistics rows, the
 * twelve-manifest v1.0.0 set) — the L1 manifest hash moves, so those two
 * templates' STARTER rows move (the degraded chains gain the flags AND
 * their BR-040 closure dependencies: accounting.projects ·
 * sales.invoices · crm.service_orders). (2) Migration 0103 §2 grants the
 * same three flags to business + enterprise (the tier-4 precedent) — the
 * L4 layer folds plan feature_keys, so EVERY business/enterprise row
 * moves plus the no-template business row. feature-catalog.ts registers
 * the three FEATURE_DEPS edges (wbs → accounting.projects · contracting
 * → accounting.projects + sales.invoices · fieldservice →
 * crm.service_orders — the plan's D-16 substrate law). The 10 unmoved
 * rows are the plan-independent starter pins of the untouched templates.
 * The fourteen PERMISSION keys ride ROLES (0103 §1), never the plans —
 * matrix §3.26's entitlement/authorization divergence note; no
 * permission key is hashed content here. The IAS-23 settings register
 * (projects.ias23_capitalization_rate) is pin-neutral by construction
 * (null default omitted from the policies map — precedence.ts).
 *
 * PHASE-047 (W-1) review note: ALL 37 pins re-pinned — 31 of 37 moved,
 * two reviewed changes together. (1) Migration 0098 §3 composes the FOUR
 * FEATURE FLAGS (hr.performance · hr.recruitment · hr.training · hr.org)
 * into the four people-carrying templates' required chains
 * (professional_services/healthcare/education/food_manufacturing) — the
 * L1 manifest hash moves, so those four templates' STARTER rows move (the
 * degraded chains gain the flags). (2) Migration 0098 §2 grants the same
 * four flags to business + enterprise (the tier-4 precedent) — the L4
 * layer folds plan feature_keys, so EVERY business/enterprise row moves
 * (the 046/018 all-moved precedent) plus the no-template business row.
 * feature-catalog.ts registers the four FEATURE_DEPS edges (each flag →
 * payroll.employees, the 045 substrate law — the talent layer attaches to
 * the frozen employees substrate, the plan's D-01) — the dependency
 * closure is hashed content. The 12 PERMISSION keys ride ROLES (0098 §1),
 * never the plans — matrix §3.25's entitlement/authorization divergence
 * note; no permission key is hashed content here. The 6 unmoved rows are
 * the plan-independent starter pins of the eight untouched templates.
 *
 * PHASE-046 (W-1) review note: ALL 37 pins re-pinned — three reviewed
 * changes moved them together (the 039/042/044 combined procedure). (1)
 * Migration 0092 §2 grants the two compliance feature keys
 * (payroll.statutory/payroll.eosb) to business + enterprise (the 0086
 * precedent) — the L4 layer folds plan feature_keys, so every business/
 * enterprise row moves. (2) feature-catalog.ts registers the two
 * FEATURE_DEPS edges (statutory → payroll.runs; eosb → payroll.
 * eos_provision) — the dependency closure is hashed content; the BR-040
 * closure check itself surfaced the un-mirrored 029 substrate (salary_
 * structures/runs/eos_provision — granted by 0043, transcribed with this
 * wave for the same closure reason 0086 transcribed payroll.employees).
 * (3) The two PHASE-046 SETTINGS_REGISTRY policy keys
 * (payroll.variable.absence_deduction/late_deduction, BR-055 — off by
 * default) land in every tenant's policy map as platform defaults, so
 * the starter rows move with them (the 019/028/029 all-moved precedent).
 *
 * PHASE-044 (T-08) review note: ALL 37 pins re-pinned — one reviewed
 * change moved them: the new platform policy default
 * `inventory.quarantine_posting` (BR-077, G-43 — enum off/distinct,
 * default off) registers in POLICY_REGISTRY, so every resolved config's
 * policies map gains the key and the resolved_hash moves across every
 * template × plan row (the 039/042/044 re-pin procedure; no fixture
 * inputs changed — the default rides the registry closure).
 *
 * PHASE-044 review note: 27 pins re-pinned — two reviewed changes moved
 * them together. (1) Migration 0071 §3 grants the eight WMS feature keys
 * (inventory.wms/putaway/picking/cycle_counts/abc/serial_ledger/
 * quarantine/consignment) to business + enterprise (the 0066 precedent)
 * — the L4 layer folds plan feature_keys, so every business/enterprise
 * row moves. (2) Migration 0071 §4 appends the eight keys to the
 * distribution-bearing templates' REQUIRED chains (industry.distribution
 * + industry.wholesale manifests — the contracts copy moved in T-01),
 * so their STARTER rows move too (the starter plan does not grant the
 * keys: the WMS surface resolves degraded-missing, the honest starter
 * posture). The layer-fixtures transcribe the 0071 §3 block; the pins
 * were recomputed by re-running the compose pipeline over the post-0071
 * fixtures (the 039/042 re-pin procedure).
 *
 * PHASE-042 review note: ALL 37 pins re-pinned — three reviewed changes moved
 * them together. (1) Migration 0066 §8 grants the six manufacturing-execution
 * feature keys (routing/work_centers/shopfloor/rework/downtime/standard_costs)
 * to business + enterprise (the 0026 precedent) — the L4 layer folds plan
 * feature_keys, so those rows move. (2) feature-catalog.ts registers the six
 * FEATURE_DEPS edges (work_centers leaf · routing → item_master + work_centers
 * · shopfloor → routing + work_centers · rework → production_orders ·
 * downtime → work_centers · standard_costs → bom + routing) — the dependency
 * closure is hashed content. (3) The downtime_posting SETTINGS_REGISTRY key
 * lands in every tenant's policy map as a platform default (BR-070 — the
 * PHASE-018 all-moved precedent). Every pin was recomputed by running the
 * compose pipeline over the post-0065/0066 seeds (the old→new table lives in
 * the PHASE-042-COMPLETION report; recorded per the P32/039 re-pin procedure).
 *
 * PHASE-039 review note: ALL 37 pins re-pinned — two reviewed changes moved
 * them together. (1) Migration 0056 §10 grants the four returns &
 * collections keys (sales.rma, sales.warranties, sales.dunning,
 * purchasing.rma) to business + enterprise — the L4 layer folds plan
 * feature_keys, so those rows move; the composed policy map folds the
 * full plan registry, which is why the starter rows move with them (the
 * PHASE-018 all-moved precedent). (2) feature-catalog.ts gains the four
 * FEATURE_DEPS edges (sales.rma→sales.invoices · sales.warranties→
 * sales.rma · sales.dunning→sales.receivables_aging · purchasing.rma→
 * purchasing.goods_receipts) — the dependency closure is hashed content.
 * Every pin was recomputed by running the compose pipeline over the
 * post-0056 seeds (the old→new table lives in the PHASE-039-COMPLETION
 * report; recorded per the P32 re-pin procedure).
 *
 * PHASE-017 review note: the business/enterprise pins were re-pinned with
 * the 0025 plan grants (sales.job_cards + the distribution/commission set
 * + inventory.reservations on business) — the L4 layer is part of the
 * hashed content, so the reviewed seed change moves exactly those pins.
 *
 * PHASE-018 review note: every pin moved — the 0026 plan grants added the
 * seven manufacturing keys to business (enterprise already had them;
 * starter untouched), and the four manufacturing SETTINGS_REGISTRY keys
 * (qc_gate/scrap_reason_required/fg_batch_expiry_from_shelf_life/
 * consumption_variance_threshold_pct) land in every tenant's policy map
 * as platform defaults (SETTINGS_REGISTRY defaults are the lowest rung of
 * the hashed §5 policies). The three new food_manufacturing rows pin with
 * the rest.
 *
 * PHASE-019 review note: every pin moved again — the 0027 plan grants
 * added the six CRM+projects keys to business (enterprise already had
 * them; starter untouched), and the SEVEN new SETTINGS_REGISTRY keys (the
 * six crm.* policy keys + the platform-only crm.defer_advance_recognition)
 * land in every tenant's policy map as platform defaults (the §5 policies
 * map is part of the hashed content). The old→new table is recorded in
 * agent-ctx/T43-2-template.md; the three new professional_services rows
 * pin with the rest.
 *
 * PHASE-028 review note (restored lineage): every pin moved again — the
 * two SETTINGS_REGISTRY budgeting control keys (budgeting.controls.mode +
 * budgeting.controls.warn_threshold_percent, BR-051 — advisory-by-default
 * policy) land in every tenant's policy map as platform defaults, so all
 * pins re-pinned in-phase (the P28-A settings-key wave; the migration
 * 0042 plan grants add the six budgeting feature keys to business+
 * enterprise, moving those pins a second notch). Starter carries only the
 * policy-default shift (no new grants). Recorded in
 * agent-ctx/P28-B-budgeting-core.md.
 *
 * PHASE-029 review note (restored lineage): every pin moved again — the
 * four SETTINGS_REGISTRY payroll policy keys (payroll.loans.max_deduction_
 * percent / payroll.loans.control_account_id / payroll.eos.enabled /
 * payroll.eos.accrual_days_per_service_year, BR-054/BR-055) land in every
 * tenant's policy map as platform defaults, so all pins re-pinned
 * in-phase (the P29-A settings-key wave; the migration 0043 plan grants
 * add the eight payroll feature keys to business+enterprise, moving those
 * pins a second notch — the same two-notch pattern as 028). Starter
 * carries only the policy-default shift (no new grants). Recorded in
 * agent-ctx/P29-B-payroll-core.md.
 *
 * PHASE-030 review note (restored lineage): the fifteen business/
 * enterprise pins (7 templates × business + 7 × enterprise + the
 * no-template business row) moved — the layer fixtures mirror the 0038
 * notes + installments grant wave (twelve keys → business + enterprise,
 * transcribed because the wholesale template's REQUIRED pdc_notes chain
 * consumes it; the P28/P29 grant waves stay un-mirrored per the recorded
 * posture). Starter rows unchanged. The six new wholesale/electronics
 * rows pin with the 0044 seeds. The old→new table is recorded in
 * agent-ctx/P30-A-contracts-migration.md.
 *
 * PHASE-032 review note: the fifteen business/enterprise pins + the
 * no-template row moved — the fixtures now transcribe the PHASE-027 0038
 * plan grants (the twelve notes/installments keys → business + enterprise,
 * migration 0038's own UPDATE; starter untouched — its seven pins are
 * byte-stable) because the education template's REQUIRED chain
 * (installments.plans/collections/late_fees) and OPTIONAL pdc_notes entry
 * resolve through exactly those grants; the 0035/0037 grant blocks stay
 * untranscribed (no shipped template consumes them). The six new
 * education POLICY_REGISTRY keys carry NO settingsKey mapping (the
 * deliberate no-SETTINGS_REGISTRY-surface choice — the L1 manifest
 * defaults land under their raw policy-key names, so non-education
 * tenants' policy maps and pins are byte-stable). The three new education
 * rows pin with the rest; every pin below was recomputed by running the
 * compose pipeline over the updated fixtures (recorded in the
 * PHASE-032-COMPLETION report; the old→new table lives in
 * agent-ctx/P32-T5-golden-pins.md).
 *
 * PHASE-033 review note: ZERO existing pins move — the first shipped
 * template whose REQUIRED chain resolves ENTIRELY through the
 * already-transcribed grants (manufacturing.bom/production_orders @ the
 * 0026 block, inventory.batch_tracking + accounting.cost_centers @ the
 * 0008 base, purchasing/sales @ the starter base, accounting.projects @
 * the 0027 block), so layer-fixtures is byte-identical to the PHASE-032
 * transcription; and the four new agriculture POLICY_REGISTRY keys carry
 * NO settingsKey mapping (the 0039 precedent), so non-agriculture
 * tenants' policy maps are untouched. All 25 existing pins re-verified
 * byte-stable by re-running the compose pipeline (the education ×
 * business spot check: 29e14755…f7cbc unchanged); the three new
 * agriculture rows pin with the rest (recorded in the
 * PHASE-033-COMPLETION report; the reviewed table lives in
 * agent-ctx/P33-T5-golden-pins.md).
 *
 * PHASE-045 (T-11) review note: ALL 37 pins re-pinned — one reviewed
 * change moved them: the new platform policy default
 * `hr.leave_accrual_posting` (G-50, BR-055 — enum off/post, default off)
 * registers in POLICY_REGISTRY with a settingsKey, so every resolved
 * config's policies map gains the key and the resolved_hash moves across
 * every template × plan row (the 039/042/044 re-pin procedure; no
 * fixture inputs changed — the default rides the registry closure).
 *
 * PHASE-045 (T-15) review note: ALL 37 pins re-pinned — two reviewed
 * changes moved them together. (1) Migration 0088 (the workforce-
 * industry MANIFEST ENABLEMENT, the deferred kickoff decision):
 * required_feature_keys gains the hr block on the four workforce
 * templates (restaurant / automotive / food_manufacturing /
 * healthcare), so their STARTER rows move too (the starter plan grants
 * no hr key — the surface resolves degraded-missing, the honest
 * starter posture, the 0071 §4 precedent). (2) The layer-fixtures
 * transcription catches up with the 0086 §2 plan grants (the three hr
 * keys → business + enterprise; HR is not a starter feature) +
 * payroll.employees for the BR-040 closure (the hr keys' FEATURE_DEPS
 * substrate, granted by 0043): every BUSINESS/ENTERPRISE row's L4 plan
 * layer gains the keys — the fixture's documented role (the
 * template-relevant grant subset) honestly noted as catching up with
 * the seeds at its first consumer (0088), the 0071 wave's own shape.
 *
 * THE RESTORATION-MERGE review note: the stage-9/10 siblings 028–031
 * (budgeting / payroll / wholesale+electronics / healthcare) were
 * restored from the uploaded PHASE-031 archive and merged onto PHASE-034
 * — the twelve-template set is the union of the two lineages' rows (the
 * surviving lineage's education/agriculture rows + the restored
 * lineage's wholesale/electronics/healthcare rows), and the merged
 * SETTINGS_REGISTRY now carries the six 028/029 policy keys, so EVERY
 * pin (including the surviving lineage's 28) was recomputed by re-running
 * the compose pipeline over the merged fixtures — the same two-notch
 * 028/029 pattern the restored lineage recorded for its own rows, now
 * applied honestly to the united set. The wholesale/electronics/
 * healthcare pins carried over from the restored lineage are re-derived
 * under the merged tree (byte-identical inputs ⇒ byte-identical pins —
 * the cross-lineage consistency check); the education/agriculture pins
 * moved by exactly the six new platform policy defaults.
 *
 * PHASE-049 (W-16, 2026-11-21) review note: TWENTY-EIGHT pins re-pinned —
 * two reviewed changes moved them together. (1) Migration 0108 §3 (the
 * CMMS-plane MANIFEST ENABLEMENT, D-11/D-16): required_feature_keys gains
 * the TWO CMMS FLAGS on the four CMMS-carrying templates (automotive /
 * food_manufacturing / healthcare — rental_logistics carries no golden
 * rows), so their STARTER rows move too (the starter plan grants NO
 * assets key — the DECLARED NEUTRAL ZERO; the surface resolves
 * degraded-missing, the honest starter posture, the 0088 precedent's
 * own shape). (2) The layer-fixtures transcription catches up with the
 * 0108 §2 plan grants (the two flags → business + enterprise; starter
 * NEITHER) + fixed_assets.register for the BR-040 closure (the assets
 * keys' FEATURE_DEPS substrate, granted by 0037 — the 0088 catch-up
 * shape at its first consumer): EVERY BUSINESS/ENTERPRISE row's L4 plan
 * layer gains the keys — the same two-notch move the 0088 wave recorded.
 *
 * PHASE-050 (W-24, 2026-11-22) review note: TWENTY-EIGHT pins re-pinned —
 * two reviewed changes moved them together (the 049 W-16 procedure's
 * exact shape). (1) Migration 0116 §5c (the QMS-plane MANIFEST
 * ENABLEMENT, D-04): required_feature_keys gains `quality` on the FOUR
 * quality-carrying templates (food_manufacturing + electronics
 * additionally gain `quality.spc` — agriculture + healthcare compose
 * `quality` alone), so their STARTER rows move too (the starter plan
 * grants NEITHER quality key — the DECLARED NEUTRAL ZERO again; the
 * surface resolves degraded-missing, the honest starter posture). (2)
 * The layer-fixtures transcription catches up with the 0116 §5b plan
 * grants (the two flags → business + enterprise; starter NEITHER — the
 * closure substrate items.item_master is in EVERY plan including
 * starter, granted by 0008, so no catch-up row and no closure gap):
 * EVERY BUSINESS/ENTERPRISE row's L4 plan layer gains the keys. The
 * 8 unmoved rows are the starter pins of the eight untouched templates.
 * `quality` is the FIRST whole-module composable key (the manifest
 * schema's dated PHASE-050 amendment — exactly one bare module key
 * matches, the plan's D-04 binding shape).
 *
 * PHASE-051 (W-33, 2026-11-24) review note: TWENTY-EIGHT pins re-pinned
 * — two reviewed changes moved them together (the 049 W-16/050 W-24
 * procedure's exact shape). (1) Migration 0122 §5c (the trade-plane
 * MANIFEST ENABLEMENT, D-04): required_feature_keys gains the THREE
 * TRADE FLAGS (`trade` the second whole-module composable unit — the
 * manifest schema's dated PHASE-051 amendment + `trade.lc` +
 * `trade.customs`) on the THREE trade-carrying templates (wholesale ·
 * distribution · electronics — all three flags each), so their STARTER
 * rows move too (the starter plan grants NONE of the three — the
 * DECLARED NEUTRAL ZERO again; the surface resolves degraded-missing,
 * the honest starter posture). (2) The layer-fixtures transcription
 * catches up with the 0122 §5b plan grants (the three flags → business
 * + enterprise; starter NONE — the closure substrate
 * purchasing.landed_costs is in business+enterprise with its full
 * closure in every plan including starter, so no catch-up row and no
 * closure gap): EVERY BUSINESS/ENTERPRISE row's L4 plan layer gains the
 * keys (the no-template business row included). The 8 unmoved rows are
 * the starter pins of the eight untouched templates.
 *
 * PHASE-052 (W-43, 2026-11-27) review note: TWENTY-FIVE pins re-pinned —
 * ONE reviewed change moved them (the 049 W-16/050 W-24/051 W-33
 * procedure's exact shape): the layer-fixtures transcription catches up
 * with the 0130 §3 plan grants (the FIVE WORKFLOW FLAGS —
 * `workflow.engine` · `workflow.definitions` · `workflow.delegation` ·
 * `workflow.escalation` · `workflow.tasks` — → business + enterprise;
 * STARTER NONE, the DECLARED NEUTRAL ZERO — the engine is a HORIZONTAL
 * capability, not a starter feature; the closure substrate
 * platform.branches is granted to EVERY plan by the base seed, so no
 * catch-up row and no closure gap): EVERY BUSINESS/ENTERPRISE row's L4
 * plan layer gains the keys (the no-template business row included). NO
 * MANIFEST MOVE THIS WAVE (D-04: NO industry-template enablements — the
 * engine is plan-gated, never template-gated; the capabilities matrix
 * stays agreeing with zero delta), so EVERY STARTER PIN STANDS UNMOVED —
 * the 12 unmoved rows are the starter pins of the twelve templates.
 */

const GOLDEN: Readonly<
  Record<string, { readonly template: IndustryTemplateManifest | null; readonly hash: string }>
> = Object.freeze({
  "industry.retail × starter": {
    template: RETAIL_MANIFEST,
    hash: "sha256:d161dc9f6ebbd0040b499f052e68fb5ef9e0cddfe7f70f1cfea5ee4a9f437541",
  },
  "industry.retail × business": {
    template: RETAIL_MANIFEST,
    hash: "sha256:c4d2acaeebd913216fb86a0264438c4ed6f64255b31b68853f13e4166484acca",
  },
  "industry.retail × enterprise": {
    template: RETAIL_MANIFEST,
    hash: "sha256:d360d29ec6375ffdc81cb54e53fd4e4ba172483bb624fdae187de760069476e4",
  },
  "industry.grocery × starter": {
    template: GROCERY_MANIFEST,
    hash: "sha256:09ab3b380f2b2f37df36b7ad93d3b0b7885270838d177487cd8e7655e8bea92c",
  },
  "industry.grocery × business": {
    template: GROCERY_MANIFEST,
    hash: "sha256:a9890214b24b28c9394abc7ae6a53d857e3effdf6d66252bb6e00e434a148112",
  },
  "industry.grocery × enterprise": {
    template: GROCERY_MANIFEST,
    hash: "sha256:2168bc4a782f7f1ecefd438fe9e61b80a64e770a08b5da377029c3feb5881155",
  },
  "industry.restaurant × starter": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:27157b132073823faad5bed9329cf842ed224c748653303d344c5c458c9450c3",
  },
  "industry.restaurant × business": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:81751e734012538ffb417fe27f2ca73f595e7a7e0f8cb269869064bceacc6273",
  },
  "industry.restaurant × enterprise": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:11943b2425715828fb5658477bc29307311051148f0d364a48f6fd9a3264e462",
  },
  // -- PHASE-017 pair (migration 0025 seeds; starter = degraded back-office)
  "industry.automotive × starter": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:6307eb33f63c3f1199d5762e1f53c290600f8870c43cb8ca24ae3b2f07b463a1",
  },
  "industry.automotive × business": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:3cce8bfff07373a874bd930da9fa35ecca130594fa1118ce09cb13cd3326bb16",
  },
  "industry.automotive × enterprise": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:eb194f2083cd386e37e88c343afb7232c363534a0e1077cd7ebdb6953e2c3c7c",
  },
  "industry.distribution × starter": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:408a76c82f402f51334deda79921f872705769b445fb3731f0ac5f7d49a5a46b",
  },
  "industry.distribution × business": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:6265bb590236704aa979e22a17c9ceb72f95e1a2414bba9928cb397c6d6a3dcb",
  },
  "industry.distribution × enterprise": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:1d19332b4774e64897cb67ff3a252eea5285e69fc1891e580c5926ed9fc58717",
  },
  // -- PHASE-018 (migration 0026 seed; starter = degraded back-office)
  "industry.food_manufacturing × starter": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:d98eee271e461d4bcf1487c7282abe1ca17afdf600b11fffa4ca0b2a19f04412",
  },
  "industry.food_manufacturing × business": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:b37352488c20fe749bf52e97fcfa1883b257b8e27b2494d08135cc16e0a72aaa",
  },
  "industry.food_manufacturing × enterprise": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:76df5a5d45a8a54239aeaf058d915d3eb53f058e194aa8b1b345e07603bb6ba0",
  },
  // -- PHASE-019 (migration 0027 seed; starter = degraded back-office)
  "industry.professional_services × starter": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:96d78c0e8789f885b134599768540fe02ba910f3079f9b7b1e8b9adaaa2313a9",
  },
  "industry.professional_services × business": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:71bbb69c129727e5ea2d3fba958656cd164769b435d999ee4486419a936f369e",
  },
  "industry.professional_services × enterprise": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:8e144975d86483e4b16f2e37b45e0aa9c6a41001f936285eb092b0b38c04d996",
  },
  // -- PHASE-032 (migration 0039 seed; starter = degraded back-office —
  // the installments/crm REQUIRED chain is ungranted there, exactly the
  // tier-4 posture of the 0025/0026/0027 templates before it)
  "industry.education × starter": {
    template: EDUCATION_TEMPLATE_MANIFEST,
    hash: "sha256:3b372725fb5a4d8ddd574a30986542c08577e4ee509bbd4a0272cf0a09b38c59",
  },
  "industry.education × business": {
    template: EDUCATION_TEMPLATE_MANIFEST,
    hash: "sha256:ca49a86ee09f3b01327612ee24234414ac8970abca401af3aa360dc708c7ec59",
  },
  "industry.education × enterprise": {
    template: EDUCATION_TEMPLATE_MANIFEST,
    hash: "sha256:364e05adb1af90c8b632fccbe91dec1802c197e2819ff1fd1ea2ca2e9a08e261",
  },
  // -- PHASE-033 (migration 0040 seed; starter = degraded back-office —
  // the manufacturing/batch/projects REQUIRED chain is ungranted there,
  // exactly the tier-4 posture of the 0025/0026/0027/0039 templates
  // before it; ZERO existing pins move — see the review note above)
  "industry.agriculture × starter": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:11daaac445c9afad0f17bffd03a4e912bd982eef9749285112ef085b929f2005",
  },
  "industry.agriculture × business": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:6c88d95d3662eb45893cc0034e49ab0f434c8115c9cd03d469a68f82d502b1ae",
  },
  "industry.agriculture × enterprise": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:afc2e7bc4fc3486cdc8a5f70db6c67d05b1798ea64032e3d1fd6b882c7b90b85",
  },
  // -- PHASE-030 (migration 0044 seeds; starter = degraded back-office —
  // the notes chain + POS/service-order sets are business+enterprise)
  "industry.wholesale × starter": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:93ce145d296f887cf213b766cc79b18dfec8111ae03d057e1554a6b83034c694",
  },
  "industry.wholesale × business": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:e38ba11226972a94bccd4b753cadab86675c89ef8db02aa83beb2140d0a80823",
  },
  "industry.wholesale × enterprise": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:8b5abe9f7b526dde235f25768e823d35bbb3ee643f875a745ef8bdbddd122ce1",
  },
  "industry.electronics × starter": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:00434f8dd79856b2a24b0d65e323f31901c4fd40ccf815c2ad8278543bb4cd1d",
  },
  "industry.electronics × business": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:cb1b0fdb2698312725f8b97661f95423214a0549d10af3568a22512a35b1b094",
  },
  "industry.electronics × enterprise": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:2411e6dd1ada92c3c7605d5b9ded042a7337eeadd35e8265f7bfbe100fe4b8c0",
  },
  "industry.healthcare × starter": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:0184804f51df2e4df741e3190d2e69aefaf4844c8663d9c7f17216cca1c302b1",
  },
  "industry.healthcare × business": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:cf919c3ea93fa50dbf7797a289798c3d87a95007954ef3c9f5c5761605bbc93e",
  },
  "industry.healthcare × enterprise": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:6c5ec98c6cd26c47165ac1f6df908927ce3bbfee1d58b1779c6bbe5ce3bbe188",
  },
  // The platform-default tenant (no template applied — L1 neutral).
  // PHASE-050 (W-24, 2026-11-22): re-pinned — the L4 plan layer gains the
  // two quality flags (the 0116 §5b business grant; the no-template row
  // rides the same move as every business/enterprise row).
  "(no template) × business": {
    template: null,
    hash: "sha256:796e51185917cc1ea43084def62cd90102438d93d312c62e8d11f7540b3ce719",
  },
});

const PLANS: Readonly<Record<string, PlanKey>> = Object.freeze({
  starter: "starter",
  business: "business",
  enterprise: "enterprise",
});

function planOf(caseName: string): PlanKey {
  const plan = caseName.split("×")[1]?.trim() as PlanKey | undefined;
  return PLANS[plan ?? ""] ?? "business";
}

describe("golden effective-configs: template × plan × jurisdiction SA (pinned hashes)", () => {
  for (const [caseName, golden] of Object.entries(GOLDEN)) {
    it(`${caseName} resolves to the pinned resolved_hash`, () => {
      const config = composeTenantStaticConfig(
        layerInputsFixture({ template: golden.template, plan: planOf(caseName) }),
      );
      // The pin: any resolution change that alters this hash fails CI
      // unless reviewed (§10 #2).
      expect(config.resolved_hash).toBe(golden.hash);
      // Re-composing is byte-stable.
      const again = composeTenantStaticConfig(
        layerInputsFixture({ template: golden.template, plan: planOf(caseName) }),
      );
      expect(again.resolved_hash).toBe(golden.hash);
      expect(again).toEqual(config);
    });
  }

  it("every golden fixture carries the §5 shape", () => {
    for (const [caseName, golden] of Object.entries(GOLDEN)) {
      const config = composeTenantStaticConfig(
        layerInputsFixture({ template: golden.template, plan: planOf(caseName) }),
      );
      expect(config.config_version).toBe(3);
      expect(config.tenant).toMatchObject({
        id: "01920000-0000-7000-8000-000000000001",
        jurisdiction: "SA",
        base_currency: "SAR",
      });
      expect(config.layers.l2_jurisdiction_pack).toMatchObject({
        country_code: "SA",
        pack_version: "1.0.0-baseline",
        vat_status: "VAT_IN_FORCE",
        tenant_registration: "REGISTERED",
      });
      expect(config.layers.l3_plan?.key).toBe(planOf(caseName));
      expect(config.layers.l3_plan?.limits).toMatchObject({
        users: { starter: 3, business: 10, enterprise: 50 }[planOf(caseName)],
      });
      expect(config.layers.l4_entitlements.active).toEqual(
        [...PLAN_KEYS[planOf(caseName)]].sort(),
      );
      expect(config.invariants_note).toContain("INV-022");
      // L1 block shape + manifest-hash provenance.
      if (golden.template === null) {
        expect(config.layers.l1_template).toBeNull();
        expect(config.tenant.industry_template).toBeNull();
      } else {
        expect(config.layers.l1_template).toEqual({
          key: golden.template.id,
          version: "1.0.0",
          terminology_overrides: Object.keys(golden.template.terminology_overrides).length,
        });
        expect(l1Of(golden.template).manifestHash).toBe(hashManifestJson(golden.template));
        // The retail/grocery/restaurant L1 defaults all auto-post cash
        // sales; the PHASE-017 pair (back-office workshop / van sales, not
        // POS-first) deliberately leaves the platform default in place.
        // PHASE-030 (restored): electronics auto-posts its counter cash sales
        // (POS-first like retail); wholesale is credit-first trading and
        // leaves the platform default in place.
        if (
          golden.template.id === "industry.retail" ||
          golden.template.id === "industry.grocery" ||
          golden.template.id === "industry.restaurant" ||
          golden.template.id === "industry.electronics"
        ) {
          expect(config.policies["sales.cash_autopost"]).toBe(true);
        } else {
          expect(config.policies["sales.cash_autopost"]).toBe(false);
        }
      }
    }
  });

  it("per-template golden structure (debuggability anchors beside the pins)", () => {
    // The platform-default tenant (no template) — computed once; the
    // manufacturing platform defaults anchor sits at the end of this test.
    const noTemplate = composeTenantStaticConfig(layerInputsFixture({ template: null }));
    expect(noTemplate.tenant.industry_template).toBeNull();

    // Retail on business: full closure, POS visible, no phase gates.
    const retail = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST, plan: "business" }),
    );
    expect(retail.layers.l4_entitlements.missing).toEqual([]);
    expect(retail.ui.navigation).toEqual(["selling", "stock"]);
    expect(retail.ui.emphasis).toEqual(["selling", "stock"]);
    expect(retail.ui.terminology["pos.terminal"]).toEqual({ en: "Terminal", ar: "الطرفية" });
    expect(retail.policies["inventory.fefo_for_expiry_items"]).toBe(false);

    // Grocery on starter: degraded (no POS, no batch tracking, no tiers).
    const grocery = composeTenantStaticConfig(
      layerInputsFixture({ template: GROCERY_MANIFEST, plan: "starter" }),
    );
    expect(grocery.layers.l4_entitlements.missing).toEqual([
      "distribution.customer_tiers",
      "industry.template_engine",
      "inventory.batch_tracking",
      "inventory.stock_counts",
      "pos.barcode_scanning",
      "pos.offline_queue",
      "pos.receipts",
      "pos.sales",
      "pos.terminals",
      "treasury.cashier_shifts",
    ]);
    // "selling" survives on the ungated tiers item (POS hides); "expiry"
    // items are all ungated core screens.
    expect(grocery.ui.navigation).toEqual(["selling", "expiry"]);
    expect(grocery.policies["inventory.fefo_for_expiry_items"]).toBe(true);
    expect(grocery.policies["expiry_writeoff_requires_approval"]).toBe(true);

    // Restaurant on business (PHASE-016 flipped): the floor entries are
    // LIVE (intake keys granted by the plan), nothing missing, RC combos on.
    const restaurant = composeTenantStaticConfig(
      layerInputsFixture({ template: RESTAURANT_MANIFEST, plan: "business" }),
    );
    expect(restaurant.layers.l4_entitlements.missing).toEqual([]);
    expect(restaurant.ui.navigation).toEqual(["floor", "day"]);
    expect(
      restaurant.ui.navigation_tree[0]?.items.filter((item) => item.phase_gated === "PHASE-016")
        .length,
    ).toBe(0);
    expect(restaurant.policies["numbering.purchase_order.assign_at"]).toBe("approval");
    expect(restaurant.policies["combo_explosion_at_posting"]).toBe(true);
    expect(restaurant.policies["service_charge_default_rate"]).toBe(0);

    // Automotive on business (PHASE-017): full closure on the 0025 plan
    // grants — the workshop set resolves LIVE (job cards included), the
    // workshop/parts navigation derives, and the job-card policies land.
    const automotive = composeTenantStaticConfig(
      layerInputsFixture({ template: AUTOMOTIVE_TEMPLATE_MANIFEST, plan: "business" }),
    );
    expect(automotive.layers.l4_entitlements.missing).toEqual([]);
    expect(automotive.ui.navigation).toEqual(["workshop", "parts"]);
    const workshop = automotive.ui.navigation_tree.find((group) => group.id === "workshop")!;
    expect(workshop.items.map((item) => item.id)).toEqual(["job_cards", "vehicles", "quotes"]);
    expect(workshop.items.every((item) => item.phase_gated === undefined)).toBe(true);
    const parts = automotive.ui.navigation_tree.find((group) => group.id === "parts")!;
    expect(parts.items.map((item) => item.id)).toEqual(["parts_stock", "purchasing", "counter"]);
    // Terminology: AR + EN workshop labels (template > glossary).
    expect(automotive.ui.terminology["svc.job_card"]).toEqual({
      en: "Job card",
      ar: "بطاقة عمل",
    });
    expect(automotive.ui.terminology["svc.labor"]).toEqual({ en: "Labor", ar: "أجور العمل" });
    expect(automotive.ui.terminology["vehicle.chassis_no"]).toEqual({
      en: "Chassis number (VIN)",
      ar: "رقم الهيكل",
    });
    // Workflow policies + numbering (PO reserved at approval).
    expect(automotive.policies["job_card_parts_issue_mode"]).toBe("reserve");
    expect(automotive.policies["job_card_labor_rate_source"]).toBe("price_list");
    expect(automotive.policies["quotation_validity_days"]).toBe(7);
    expect(automotive.policies["warranty_credit_note_requires_original_invoice"]).toBe(true);
    expect(automotive.policies["numbering.job_card.assign_at"]).toBe("posting");
    expect(automotive.policies["numbering.purchase_order.assign_at"]).toBe("approval");
    expect(automotive.policies["inventory.fefo_for_expiry_items"]).toBe(false);

    // Distribution on business (PHASE-017): the field/settle groups resolve
    // with the full distribution module enabled, tier + settlement policies
    // land, and the van-sales terminology carries the Arabic field labels.
    const distribution = composeTenantStaticConfig(
      layerInputsFixture({ template: DISTRIBUTION_TEMPLATE_MANIFEST, plan: "business" }),
    );
    expect(distribution.layers.l4_entitlements.missing).toEqual([]);
    expect(distribution.ui.navigation).toEqual(["field", "settle"]);
    expect(
      distribution.ui.navigation_tree.find((group) => group.id === "field")!.items.map(
        (item) => item.id,
      ),
    ).toEqual(["routes", "van_stock", "collections"]);
    expect(
      distribution.ui.navigation_tree.find((group) => group.id === "settle")!.items.map(
        (item) => item.id,
      ),
    ).toEqual(["rep_settlements", "commissions"]);
    expect(distribution.ui.terminology["route.route"]).toEqual({ en: "Route", ar: "خط السير" });
    expect(distribution.ui.terminology["van.load_out"]).toEqual({
      en: "Load-out",
      ar: "التحميل الصباحي",
    });
    expect(distribution.ui.terminology["settlement.rep_settlement"]).toEqual({
      en: "Rep settlement",
      ar: "تسوية المندوب",
    });
    expect(distribution.ui.terminology["hr.field_rep"]).toEqual({
      en: "Sales rep (van)",
      ar: "مندوب التوزيع",
    });
    expect(distribution.policies["van_loadout_requires_transfer"]).toBe(true);
    expect(distribution.policies["settlement_required_daily"]).toBe(true);
    expect(distribution.policies["tier_price_automatic_by_partner"]).toBe(true);
    expect(distribution.policies["free_goods_require_reason_code"]).toBe(true);
    expect(distribution.policies["inventory.fefo_for_expiry_items"]).toBe(true);
    expect(distribution.layers.l8_installed.distribution).toBe(true);

    // Food manufacturing on business (PHASE-018): the full manufacturing
    // set resolves LIVE on the 0026 grants — the production/trace groups
    // derive with the manufacturing module enabled, and the four §6
    // workflow policies land as L1 defaults (qc_gate required).
    const food = composeTenantStaticConfig(
      layerInputsFixture({ template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST, plan: "business" }),
    );
    expect(food.layers.l4_entitlements.missing).toEqual([]);
    expect(food.ui.navigation).toEqual(["production", "trace"]);
    const production = food.ui.navigation_tree.find((group) => group.id === "production")!;
    expect(production.items.map((item) => item.id)).toEqual(["recipes", "orders", "qc"]);
    expect(
      food.ui.navigation_tree.find((group) => group.id === "trace")!.items.map(
        (item) => item.id,
      ),
    ).toEqual(["genealogy", "expiry"]);
    expect(food.ui.terminology["mfg.recipe"]).toEqual({
      en: "Recipe (BOM)",
      ar: "الوصفة (قائمة المواد)",
    });
    expect(food.ui.terminology["mfg.qc_gate"]).toEqual({
      en: "QC gate",
      ar: "بوابة فحص الجودة",
    });
    expect(food.policies["manufacturing.qc_gate"]).toBe("required"); // L1 manifest default
    expect(food.policies["manufacturing.scrap_reason_required"]).toBe(true);
    expect(food.policies["manufacturing.fg_batch_expiry_from_shelf_life"]).toBe(true);
    expect(food.policies["manufacturing.consumption_variance_threshold_pct"]).toBe(5);
    expect(food.policies["inventory.fefo_for_expiry_items"]).toBe(true);
    expect(food.layers.l8_installed.manufacturing).toBe(true);

    // Professional services on business (PHASE-019): the full CRM+projects
    // set resolves LIVE on the 0027 grants — the practice/billing groups
    // derive with the crm module enabled, the §9 workflow policies land as
    // L1 defaults (contract_billing_mode retainer_or_milestones), and the
    // crm module installs (L8 from default_modules_enabled).
    const services = composeTenantStaticConfig(
      layerInputsFixture({ template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST, plan: "business" }),
    );
    expect(services.layers.l4_entitlements.missing).toEqual([]);
    expect(services.ui.navigation).toEqual(["practice", "billing"]);
    const practiceGroup = services.ui.navigation_tree.find((group) => group.id === "practice")!;
    expect(practiceGroup.items.map((item) => item.id)).toEqual(["cases", "timesheets", "contracts"]);
    expect(
      services.ui.navigation_tree.find((group) => group.id === "billing")!.items.map(
        (item) => item.id,
      ),
    ).toEqual(["recurring", "invoices", "statements"]);
    expect(services.ui.terminology["svc.case"]).toEqual({
      en: "Case / Matter",
      ar: "القضية / الملف",
    });
    expect(services.ui.terminology["doc.contract"]).toEqual({
      en: "Service contract",
      ar: "عقد الخدمات",
    });
    expect(services.policies["crm.contract_billing_mode"]).toBe("retainer_or_milestones"); // L1 manifest default
    expect(services.policies["crm.time_entries_require_case"]).toBe(true);
    expect(services.policies["crm.unbilled_time_review_before_invoice"]).toBe(true);
    expect(services.policies["crm.invoice_approval_required"]).toBe(true);
    expect(services.policies["crm.invoice_numbering_per_series"]).toBe(false);
    expect(services.policies["crm.narrative_required_on_time_billing"]).toBe(true);
    expect(services.policies["inventory.fefo_for_expiry_items"]).toBe(false);
    expect(services.layers.l8_installed.crm).toBe(true);

    // Education on business (PHASE-032): the tuition chain resolves LIVE on
    // the 0038 grants — the enrollment/billing groups derive with the crm +
    // installments modules enabled, the six education workflow policies land
    // as L1 defaults under their raw registry keys (no settingsKey mapping —
    // the deliberate 0039 choice), and invoice_approval_required reuses the
    // PHASE-019 crm key.
    const education = composeTenantStaticConfig(
      layerInputsFixture({ template: EDUCATION_TEMPLATE_MANIFEST, plan: "business" }),
    );
    expect(education.layers.l4_entitlements.missing).toEqual([]);
    expect(education.ui.navigation).toEqual(["enrollment", "billing"]);
    const enrollmentGroup = education.ui.navigation_tree.find(
      (group) => group.id === "enrollment",
    )!;
    expect(enrollmentGroup.items.map((item) => item.target)).toEqual([
      "crm.contracts",
      "partners.directory",
      "items.price_lists",
    ]);
    const tuitionGroup = education.ui.navigation_tree.find((group) => group.id === "billing")!;
    expect(tuitionGroup.items.map((item) => item.target)).toEqual([
      "installments.plans",
      "sales.invoices",
      "installments.collections",
      "treasury.receipts",
    ]);
    expect(enrollmentGroup.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(tuitionGroup.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(education.ui.terminology["partner.student"]).toEqual({
      en: "Student (financial file)",
      ar: "الطالب (الملف المالي)",
    });
    expect(education.ui.terminology["partner.guardian"]).toEqual({
      en: "Guardian (payer)",
      ar: "ولي الأمر (الدافع)",
    });
    expect(education.ui.terminology["doc.enrollment_contract"]).toEqual({
      en: "Enrollment contract",
      ar: "عقد الالتحاق",
    });
    expect(education.ui.terminology["billing.installment_plan"]).toEqual({
      en: "Installment plan",
      ar: "خطة الأقساط",
    });
    expect(education.policies["guardian_is_paying_partner"]).toBe(true); // L1 manifest default
    expect(education.policies["tuition_invoice_from_contract"]).toBe(true);
    expect(education.policies["installment_schedule_immutable_after_activation"]).toBe(true);
    expect(education.policies["late_fee_policy_per_plan"]).toBe(true);
    expect(education.policies["sibling_discount_line_level"]).toBe(true);
    expect(education.policies["dunning_cycle_before_late_fee"]).toBe(true);
    expect(education.policies["crm.invoice_approval_required"]).toBe(true); // the PHASE-019 reuse
    expect(education.policies["sales.cash_autopost"]).toBe(false); // back-office, never POS-first
    expect(education.policies["inventory.fefo_for_expiry_items"]).toBe(false);
    expect(education.layers.l8_installed.installments).toBe(true);
    expect(education.layers.l8_installed.crm).toBe(true);

    // Education on starter: degraded back-office — the tier-4 posture (the
    // 0038 grants skip starter exactly like the 0025/0026/0027 sets before
    // them): the installments + crm REQUIRED chain is uncovered. PHASE-047
    // (W-1): the four talent flags join the uncovered chain (0098 §3
    // composes them into education's required keys; starter does not carry
    // them — the tier-4 posture extends to the talent layer).
    const educationStarter = composeTenantStaticConfig(
      layerInputsFixture({ template: EDUCATION_TEMPLATE_MANIFEST, plan: "starter" }),
    );
    expect(educationStarter.layers.l4_entitlements.missing).toEqual([
      "crm.service_contracts",
      "hr.org",
      "hr.performance",
      "hr.recruitment",
      "hr.training",
      "industry.template_engine",
      "installments.collections",
      "installments.late_fees",
      "installments.plans",
    ]);
    // The nav groups stay (ungated core targets render; the feature-keyed
    // items hide at the navigation-pruning layer, config-resolution.spec).

    // Agriculture on business (PHASE-033): the season chain resolves LIVE
    // entirely on the already-transcribed grants — the season/harvest groups
    // derive with the manufacturing module enabled, the four agriculture
    // workflow policies land as L1 defaults under their raw registry keys
    // (no settingsKey mapping — the 0039 precedent), and the two reused
    // PHASE-018 manufacturing keys carry the manifest values (crop loss
    // reason-coded; the 5% variance threshold — both identical to the
    // platform defaults, the template asserting the posture).
    const agriculture = composeTenantStaticConfig(
      layerInputsFixture({ template: AGRICULTURE_TEMPLATE_MANIFEST, plan: "business" }),
    );
    expect(agriculture.layers.l4_entitlements.missing).toEqual([]);
    expect(agriculture.ui.navigation).toEqual(["season", "harvest"]);
    const seasonGroup = agriculture.ui.navigation_tree.find((group) => group.id === "season")!;
    expect(seasonGroup.items.map((item) => item.target)).toEqual([
      "accounting.projects",
      "manufacturing.bom",
      "manufacturing.orders",
    ]);
    const harvestGroup = agriculture.ui.navigation_tree.find((group) => group.id === "harvest")!;
    expect(harvestGroup.items.map((item) => item.target)).toEqual([
      "inventory.batches",
      "sales.invoices",
      "inventory.serials",
    ]);
    expect(seasonGroup.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(harvestGroup.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(agriculture.ui.terminology["crop.item"]).toEqual({
      en: "Crop",
      ar: "المحصول",
    });
    expect(agriculture.ui.terminology["crop.cycle"]).toEqual({
      en: "Crop cycle",
      ar: "الدورة الزراعية",
    });
    expect(agriculture.ui.terminology["mfg.recipe"]).toEqual({
      en: "Crop-cycle recipe (BOM)",
      ar: "وصفة الدورة الزراعية (قائمة المواد)",
    });
    expect(agriculture.ui.terminology["harvest.batch"]).toEqual({
      en: "Harvest batch",
      ar: "دفعة الحصاد",
    });
    expect(agriculture.ui.terminology["farm.field"]).toEqual({
      en: "Farm / Field",
      ar: "المزرعة / الحقل",
    });
    expect(agriculture.ui.terminology["livestock.head"]).toEqual({
      en: "Livestock head",
      ar: "رأس",
    });
    expect(agriculture.ui.terminology["mfg.scrap"]).toEqual({
      en: "Crop loss",
      ar: "الفاقد",
    });
    expect(agriculture.policies["cycle_order_per_field_project"]).toBe(true); // L1 manifest default
    expect(agriculture.policies["harvest_batch_genealogy_enabled"]).toBe(true);
    expect(agriculture.policies["field_cost_center_mandatory_on_cycle"]).toBe(true);
    expect(agriculture.policies["livestock_serial_per_head"]).toBe(true);
    expect(agriculture.policies["manufacturing.scrap_reason_required"]).toBe(true); // the PHASE-018 reuse
    expect(agriculture.policies["manufacturing.consumption_variance_threshold_pct"]).toBe(5); // the PHASE-018 reuse
    expect(agriculture.policies["numbering.production_order.assign_at"]).toBe("approval"); // CYC reserved at release
    expect(agriculture.policies["sales.cash_autopost"]).toBe(false); // back-office, never POS-first
    expect(agriculture.policies["inventory.fefo_for_expiry_items"]).toBe(true); // FEFO produce picking
    expect(agriculture.layers.l8_installed.manufacturing).toBe(true);

    // Agriculture on starter: degraded back-office — the tier-4 posture (no
    // 0040 grants: the manufacturing/batch/projects REQUIRED chain is
    // uncovered, exactly the 0025/0026/0027/0039 posture). The nav groups
    // stay (the ungated fields + produce-sales targets render; the
    // feature-keyed recipes/cycles/batches/livestock items hide).
    const agricultureStarter = composeTenantStaticConfig(
      layerInputsFixture({ template: AGRICULTURE_TEMPLATE_MANIFEST, plan: "starter" }),
    );
    // PHASE-050 (W-24, 2026-11-22 — the QMS-plane enablement, 0116 §5c):
    // the missing chain gains `quality` (agriculture composes the
    // whole-module flag; the SPC plane's own `quality.spc` NOT — the phase
    // doc's own division; the closure substrate items.item_master is in
    // starter, so exactly ONE key joins).
    expect(agricultureStarter.layers.l4_entitlements.missing).toEqual([
      "accounting.cost_centers",
      "accounting.projects",
      "industry.template_engine",
      "inventory.batch_tracking",
      "manufacturing.bom",
      "manufacturing.production_orders",
      "quality",
    ]);
    expect(
      agricultureStarter.ui.navigation_tree.find((group) => group.id === "season")!.items.map(
        (item) => item.target,
      ),
    ).toEqual(["accounting.projects"]);
    expect(
      agricultureStarter.ui.navigation_tree.find((group) => group.id === "harvest")!.items.map(
        (item) => item.target,
      ),
    ).toEqual(["sales.invoices"]);

    // The platform defaults (no template): the four manufacturing keys ride
    // the SETTINGS_REGISTRY defaults into every tenant's policy map — the
    // manufacturing services read them via resolved config (PHASE-018 §6);
    // likewise the SEVEN PHASE-019 keys (§18 lesson 5: ALL golden rows move
    // because these land in every tenant's policies map).
    expect(noTemplate.policies["manufacturing.qc_gate"]).toBe("off");
    expect(noTemplate.policies["manufacturing.scrap_reason_required"]).toBe(true);
    expect(noTemplate.policies["manufacturing.fg_batch_expiry_from_shelf_life"]).toBe(true);
    expect(noTemplate.policies["manufacturing.consumption_variance_threshold_pct"]).toBe(5);
    expect(noTemplate.policies["crm.contract_billing_mode"]).toBe("retainer_or_milestones");
    expect(noTemplate.policies["crm.time_entries_require_case"]).toBe(true);
    expect(noTemplate.policies["crm.unbilled_time_review_before_invoice"]).toBe(true);
    expect(noTemplate.policies["crm.invoice_approval_required"]).toBe(true);
    expect(noTemplate.policies["crm.invoice_numbering_per_series"]).toBe(false);
    expect(noTemplate.policies["crm.narrative_required_on_time_billing"]).toBe(true);
    expect(noTemplate.policies["crm.defer_advance_recognition"]).toBe(false); // platform-only key
  });

  it("distinct inputs produce distinct pins (the pins are content, not form)", () => {
    const hashes = new Set(Object.values(GOLDEN).map((golden) => golden.hash));
    expect(hashes.size).toBe(Object.keys(GOLDEN).length);
  });

  it("a reviewed change updates exactly its pin (retail × business differs from starter)", () => {
    const starter = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST, plan: "starter" }),
    );
    expect(starter.resolved_hash).not.toBe(GOLDEN["industry.retail × business"]?.hash);
    expect(starter.resolved_hash).toBe(GOLDEN["industry.retail × starter"]?.hash);
  });
});
