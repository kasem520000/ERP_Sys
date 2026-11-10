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
    hash: "sha256:e525efeb78c15addcf6089697fec32ee8d6ff8cd97ec2d0fb74e3ce9573590b0",
  },
  "industry.retail × business": {
    template: RETAIL_MANIFEST,
    hash: "sha256:76cfe70a1863424e920f0ae682503f191dbc89fef1e0e0c69b1f121e77f8111a",
  },
  "industry.retail × enterprise": {
    template: RETAIL_MANIFEST,
    hash: "sha256:32ce5bb4ed1b60b637e983d1b8acfa2e3a230c456275f70f0d1d016c718598c2",
  },
  "industry.grocery × starter": {
    template: GROCERY_MANIFEST,
    hash: "sha256:fe7a524bf4bacad32abe91aeb601eb1b7d2640e84f201299757900c83e3cda12",
  },
  "industry.grocery × business": {
    template: GROCERY_MANIFEST,
    hash: "sha256:f933aa76ade35b77026b407b5fc5b0a0461a871d3352dd266f8f2669fdce9bbf",
  },
  "industry.grocery × enterprise": {
    template: GROCERY_MANIFEST,
    hash: "sha256:c35c56f026c82856e00bf68e05bf9cc13e8d0311732281a4b26b113641dab19c",
  },
  "industry.restaurant × starter": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:b2b0282ea77f357ed2cc76f055677b730dd4cff4f5928cefdd4dc4dc933dd08a",
  },
  "industry.restaurant × business": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:5de419c7db5ffd42e48d2adc702f457e7deeb43ea8f20ae82f216d6c09fb383c",
  },
  "industry.restaurant × enterprise": {
    template: RESTAURANT_MANIFEST,
    hash: "sha256:eb02e17f8d8fe5b5c3805a6293052071122a5c84d0b5018d58e1e656868af821",
  },
  // -- PHASE-017 pair (migration 0025 seeds; starter = degraded back-office)
  "industry.automotive × starter": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:1cb9c11baf7873e493709802ed201c7805903d3ee42741d6d630420638cc3666",
  },
  "industry.automotive × business": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:eeb8d38df03b9429acbef101c4da33520b4e97b1feba5c9002d199ce1f8498c9",
  },
  "industry.automotive × enterprise": {
    template: AUTOMOTIVE_TEMPLATE_MANIFEST,
    hash: "sha256:03b8d26a38f9c9196d5b35e76a04a436a33d952b70e69f9446634b17a39da7c4",
  },
  "industry.distribution × starter": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:c03f35e44d089ddda90af0069d043380b8f6c50b1da914a82324442e5b47d62f",
  },
  "industry.distribution × business": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:c47eae87192e852bbd8ffa720ebbce90b6388291d969c55a8379184bf59a589d",
  },
  "industry.distribution × enterprise": {
    template: DISTRIBUTION_TEMPLATE_MANIFEST,
    hash: "sha256:416ed4951a1f5f87efd9859a9949ed76fec4eac770bfc0a469a6493db38726bc",
  },
  // -- PHASE-018 (migration 0026 seed; starter = degraded back-office)
  "industry.food_manufacturing × starter": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:fb496de31b577e963da725fcbb9b1528988526fc84885dd5e5544c57d068b8e4",
  },
  "industry.food_manufacturing × business": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:b711c4cabc334377eee8bd95777519b6c7b9b0e446adf1335c86de822ba7ddc1",
  },
  "industry.food_manufacturing × enterprise": {
    template: FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
    hash: "sha256:4afb59513de1f79c68b257c8ddef608ae5551efaf91342ae4c67e629d9169308",
  },
  // -- PHASE-019 (migration 0027 seed; starter = degraded back-office)
  "industry.professional_services × starter": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:656b5db9953f991d981d6c57b4396190d94c64e35839a5818546513238a7c442",
  },
  "industry.professional_services × business": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:bfc5de91388b36f1dd81d2cd28bb29a9ac32721f569e7c1f9b756edd35a2caad",
  },
  "industry.professional_services × enterprise": {
    template: PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
    hash: "sha256:c55825f6c829a4a07516852cda2f456a5a42fa589b09d9f653bd72feb77a6ad6",
  },
  // -- PHASE-032 (migration 0039 seed; starter = degraded back-office —
  // the installments/crm REQUIRED chain is ungranted there, exactly the
  // tier-4 posture of the 0025/0026/0027 templates before it)
  "industry.education × starter": {
    template: EDUCATION_TEMPLATE_MANIFEST,
    hash: "sha256:fa31c73e510ae07f6df0bb9361798714d3c9b8e62150b7d832a65d6ab3789155",
  },
  "industry.education × business": {
    template: EDUCATION_TEMPLATE_MANIFEST,
    hash: "sha256:acb32d23b88f8e213cdf1651af666be2b5b4ad662bb59fd52c1ecf863b3833f6",
  },
  "industry.education × enterprise": {
    template: EDUCATION_TEMPLATE_MANIFEST,
    hash: "sha256:a2f3cd62b16184efd5852b55e47dad8f8676dec0099e3615ec3f70e15634ada1",
  },
  // -- PHASE-033 (migration 0040 seed; starter = degraded back-office —
  // the manufacturing/batch/projects REQUIRED chain is ungranted there,
  // exactly the tier-4 posture of the 0025/0026/0027/0039 templates
  // before it; ZERO existing pins move — see the review note above)
  "industry.agriculture × starter": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:ca0359cf03e3aacd523aa48c3adb7013b1ed47466f0288f74a5f0f67c6aaf835",
  },
  "industry.agriculture × business": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:0f3f944fa5e120dc739ca82ec411b91bb037d6608decc6bb0989136b4cab41bd",
  },
  "industry.agriculture × enterprise": {
    template: AGRICULTURE_TEMPLATE_MANIFEST,
    hash: "sha256:7549f4f7fbf2792ab94f9087c315d2c732fcc6351e5710ba79a5b09738360bba",
  },
  // -- PHASE-030 (migration 0044 seeds; starter = degraded back-office —
  // the notes chain + POS/service-order sets are business+enterprise)
  "industry.wholesale × starter": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:86a74c472b45bd52b31794ad6b9a6fab3bbcb900a0e80ca7272ccf0669b43f17",
  },
  "industry.wholesale × business": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:fa0c34154090df634ea2e68ffc3797ffc187c3c41fe9ab83498b1afb7c5f9d1c",
  },
  "industry.wholesale × enterprise": {
    template: WHOLESALE_TEMPLATE_MANIFEST,
    hash: "sha256:b8353a2c8ca4b2686b9801b32f478a61de536f48325ae4199f94936b78aa1821",
  },
  "industry.electronics × starter": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:f393b9dff0fe48d8320e4715a5c389739eb0bb5c649e7695fcb3af27cec9a628",
  },
  "industry.electronics × business": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:1d369bf0fdcd4b067fd5c60ac355c16cfa746394213d62427060fd53a4ce5b85",
  },
  "industry.electronics × enterprise": {
    template: ELECTRONICS_TEMPLATE_MANIFEST,
    hash: "sha256:c6c86737b958bf742f8b98dcabadaf0eb3fd3e4cdfcc67db8beef7ac315e834b",
  },
  "industry.healthcare × starter": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:40bae940339987ccffb511b7b7b84f114f68a89bd09ffa410037662e8da2536a",
  },
  "industry.healthcare × business": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:1dc0543e8cc6038c8b9e916b875f69009f4b9684624f413d018d7a9e4c6997d4",
  },
  "industry.healthcare × enterprise": {
    template: HEALTHCARE_TEMPLATE_MANIFEST,
    hash: "sha256:5e253f993406bbd8a30939e33cf2359b4e2ffb16d26882dd66f145d3ef65c950",
  },
  // The platform-default tenant (no template applied — L1 neutral).
  "(no template) × business": {
    template: null,
    hash: "sha256:560d08e51936a54edf65542af5a0266c0e73774fbeb49bb870f965ca4e171444",
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
    // them): the installments + crm REQUIRED chain is uncovered.
    const educationStarter = composeTenantStaticConfig(
      layerInputsFixture({ template: EDUCATION_TEMPLATE_MANIFEST, plan: "starter" }),
    );
    expect(educationStarter.layers.l4_entitlements.missing).toEqual([
      "crm.service_contracts",
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
