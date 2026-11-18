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
    hash: "sha256:a11fa3d61f4c2991cefefbd0191a069faa4e80e3a8ae7edf0be779705503f71e",
  },
  "industry.retail × enterprise": {
    template: RETAIL_MANIFEST,
    hash: "sha256:58f01d9c5d7598657983e444c8a2d040682666d0eaf00b7b1aa681eab4c0537a",
  },
  "industry.grocery × starter": {
    template: GROCERY_MANIFEST,
    hash: "sha256:09ab3b380f2b2f37df36b7ad93d3b0b7885270838d177487cd8e7655e8bea92c",
  },
  "industry.grocery × business": {
    template: GROCERY_MANIFEST,
    hash: "sha256:ab9ac789dab9242dd1f4ef602b03f24d9685481997b134e53638cd095aabeb68",
  },
  "industry.grocery × enterprise": {
    template: GROCERY_MANIFEST,
    hash: "sha256:3634cc2654c88610df3df8622c2d0ff94fcf94245fa271526af7c657aa20dcf9",
  },
  "industry.restaurant × starter": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:27157b132073823faad5bed9329cf842ed224c748653303d344c5c458c9450c3",
  },
  "industry.restaurant × business": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:51d23a51b777cb06635baa0107944103be15a2f2b436420271c97fdb3fb9e878",
  },
  "industry.restaurant × enterprise": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:cb1cc5b16f79f4d42e6132d8d21948f9e52a8f02396a0aa5311b06ff32bb8462",
  },
  // -- PHASE-017 pair (migration 0025 seeds; starter = degraded back-office)
  "industry.automotive × starter": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:52d54aeca1b380e541323efd4709479f625539d8b42fbaa8914504974ffc158a",
  },
  "industry.automotive × business": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:a5b39ef7ef75fec87ad3bf01b204ea3768d980a42168129f4004c97de9509686",
  },
  "industry.automotive × enterprise": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:50973e1f57e86b2e92bdbcdca38dff451179545617412df23a01fee8e40f7b7c",
  },
  "industry.distribution × starter": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:4548d21d72ca837825e9bbf12a84b723415218f808dbe1e96d4cb2734f4adf90",
  },
  "industry.distribution × business": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:7911a69709515dbd814d6de2bba0ae5356a2e8d3e1a006702714daf946d42a13",
  },
  "industry.distribution × enterprise": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:29d6b5a70cd75883264c2817de494dda386239adf280e382ec30f96c1fdc4226",
  },
  // -- PHASE-018 (migration 0026 seed; starter = degraded back-office)
  "industry.food_manufacturing × starter": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:af5b71092ef9c9fdc7cdd4272527b277f0acc5927e54d58a59f2fc0ee31fee2c",
  },
  "industry.food_manufacturing × business": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:684c92817f9ea9283a1181f7356308efba77452f74698f15d4ae3c161639fd29",
  },
  "industry.food_manufacturing × enterprise": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:a6fc4cdefc52f88d840bca88155a082c73c9baeb48d220e9dca9d3631a01104e",
  },
  // -- PHASE-019 (migration 0027 seed; starter = degraded back-office)
  "industry.professional_services × starter": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:646bd78506e33aefbe3f41f13024fc0a06fc6bf6b9a0502c5ee5b2e498176ee0",
  },
  "industry.professional_services × business": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:f566231d8480aef1b8fe060de47cb604d4b509a067b9ffd4c5a68ebf692964d5",
  },
  "industry.professional_services × enterprise": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:5de60f9ee4405dffdbab90c60daac8da5079a307b8a4b13134e66fdd14c87239",
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
    hash: "sha256:17299e2ece76bf84b54d1a5de7e4ad5ce34f94e8bfdfcf72383d42e73eaabacc",
  },
  "industry.education × enterprise": {
    template: EDUCATION_TEMPLATE_MANIFEST,
    hash: "sha256:dc9851d4267843a37f5f41f8a46b3734f296dd4c4594b1cd57b246efc2d079c1",
  },
  // -- PHASE-033 (migration 0040 seed; starter = degraded back-office —
  // the manufacturing/batch/projects REQUIRED chain is ungranted there,
  // exactly the tier-4 posture of the 0025/0026/0027/0039 templates
  // before it; ZERO existing pins move — see the review note above)
  "industry.agriculture × starter": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:9f83d7860d6c41c64e59208b80f16e44a6d227d9da9697e4056bc192f7f5d55b",
  },
  "industry.agriculture × business": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:f977ea99424f1fb9934b2db194eb22ac2d33f7fbae41b57412d276b1830a9859",
  },
  "industry.agriculture × enterprise": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:6ef0dfb616b8ec7ca4d42a624aced330ac8fb324bee4b2800324c9e7a04286dc",
  },
  // -- PHASE-030 (migration 0044 seeds; starter = degraded back-office —
  // the notes chain + POS/service-order sets are business+enterprise)
  "industry.wholesale × starter": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:5ea0ab9d85b3284a877f9e8273a3d41b13b71bcf431845eb282e4937af00e5e0",
  },
  "industry.wholesale × business": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:417c82eb3e48822977a9d85dd8d3878b05574cc8bf351dc3d3032ee0472f2fce",
  },
  "industry.wholesale × enterprise": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:41d260d8f688beafe745bfb77935d6207792530babcbaf1e7c70d5afc2eea22b",
  },
  "industry.electronics × starter": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:6562e14b791eb0dab51b82f3dcc38c7ae2a8d734edb76a179992163a6672959b",
  },
  "industry.electronics × business": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:27bf061dc1104b02451906ed0c4427107b9a0dd6fabb7b3366f6f43285ad5295",
  },
  "industry.electronics × enterprise": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:f9ecabe04a2c352b531bb70d54c43b91130fd35573c38eb06344d6174208f239",
  },
  "industry.healthcare × starter": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:deb2f51b8aa4462e06537aafd04ce90fc6c379705ecda4e2f28ecb5659cdea43",
  },
  "industry.healthcare × business": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:b3bb0cc7b650ae3560c71f557ca936c6d7ec90892a8acf12cd3584b34ef5b5d7",
  },
  "industry.healthcare × enterprise": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:d154f0ea52cf4d7e6f5e1400ee78dffedcd0903017991f8e076938af304893b7",
  },
  // The platform-default tenant (no template applied — L1 neutral).
  "(no template) × business": {
    template: null,
    hash: "sha256:a76e8de43fcfbf4a00c6a996b235cafd50913a7248fba7816661250686a65df7",
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
    expect(agricultureStarter.layers.l4_entitlements.missing).toEqual([
      "accounting.cost_centers",
      "accounting.projects",
      "industry.template_engine",
      "inventory.batch_tracking",
      "manufacturing.bom",
      "manufacturing.production_orders",
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
