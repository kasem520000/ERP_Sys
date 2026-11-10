import { describe, expect, it } from "vitest";

import {
  AGRICULTURE_TEMPLATE_MANIFEST,
  AUTOMOTIVE_TEMPLATE_MANIFEST,
  DISTRIBUTION_TEMPLATE_MANIFEST,
  EDUCATION_TEMPLATE_MANIFEST,
  ELECTRONICS_TEMPLATE_MANIFEST,
  GROCERY_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
  RENTAL_LOGISTICS_TEMPLATE_MANIFEST,
  RESTAURANT_MANIFEST,
  RETAIL_MANIFEST,
  WHOLESALE_TEMPLATE_MANIFEST,
} from "@erp/contracts";

import {
  CURRENT_SHIPPED_PHASE,
  TemplatePrerequisitesBlockedError,
  checkPrerequisites,
  phaseNumber,
} from "../application/apply/prerequisites";
import { PLAN_KEYS } from "./layer-fixtures";

/**
 * PHASE-015 T5/T7 unit tests — the §4 entitlement + phase-gate
 * classification and the BR-040 dependency-closure check
 * (`degraded-entitlement` + `dependency-closure` db specs exercise the same
 * rules end-to-end against a real tenant).
 */

const business = () => [...PLAN_KEYS.business];
const enterprise = () => [...PLAN_KEYS.enterprise];

function stateOf(check: ReturnType<typeof checkPrerequisites>, capabilityId: string) {
  return check.capabilities.find((state) => state.capabilityId === capabilityId);
}

describe("phase gate helpers", () => {
  it("parses PHASE-0NN gates numerically", () => {
    expect(phaseNumber("PHASE-010")).toBe(10);
    expect(phaseNumber("PHASE-015")).toBe(15);
    expect(phaseNumber("PHASE-016")).toBe(16);
    expect(phaseNumber("PHASE-017")).toBe(17);
    expect(phaseNumber("PHASE-018")).toBe(18);
    expect(phaseNumber("PHASE-019")).toBe(19);
    expect(() => phaseNumber("PHASE-16")).toThrow();
  });

  it("CURRENT_SHIPPED_PHASE is PHASE-034 (the restoration merge completed the 34-phase roadmap — 001–034 all live in this single build)", () => {
    expect(CURRENT_SHIPPED_PHASE).toBe("PHASE-034");
    expect(phaseNumber(CURRENT_SHIPPED_PHASE)).toBe(34);
    // THE RESTORATION NOTE: the stage-9/10 siblings 028–031 (budgeting /
    // payroll / wholesale+electronics / healthcare) were lost to
    // environment resets on the surviving lineage — which honestly kept
    // the gate at 027 while shipping 032 education / 033 agriculture /
    // 034 consolidation on top — and were RESTORED from the uploaded
    // PHASE-031 archive and merged onto PHASE-034 (migrations renumbered
    // 0042–0046, modules/templates/docs united). With 001–034 all
    // implemented in THIS build, the gate takes the roadmap's end: no
    // shipped manifest carries a capability past PHASE-034 (agriculture's
    // crop_cycle_costing @ 033 is the highest), so nothing phase-gates any
    // more — the §4 mechanism itself stays proven by the synthetic
    // post-roadmap PHASE-035 fixtures below.
  });
});

describe("capability classification (industries/README §4)", () => {
  it("retail × business plan: fully satisfiable — POS capabilities included, no block", () => {
    const check = checkPrerequisites(RETAIL_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    // The business plan grants every pos.* key: barcode_pos + cashier_shifts
    // are classified included (their WORKFLOW ships 016, the keys resolve).
    expect(stateOf(check, "barcode_pos")?.status).toBe("included");
    expect(stateOf(check, "cashier_shifts")?.status).toBe("included");
    expect(stateOf(check, "imei_tracking")?.status).toBe("included");
    expect(stateOf(check, "landed_costs")?.status).toBe("included");
  });

  it("retail × starter plan: blocked with the exact uncovered required keys", () => {
    const check = checkPrerequisites(RETAIL_MANIFEST, [...PLAN_KEYS.starter]);
    expect(check.status).toBe("blocked");
    // PHASE-016 shipped the barcode_pos capability — it is no longer
    // phase-gated, so the starter plan's missing pos.* keys are honest
    // uncovered REQUIRED keys in the guided-plan-selection chain.
    expect(check.missingChain).toContain("industry.template_engine");
    expect(check.missingChain).toContain("pos.sales");
    expect(stateOf(check, "barcode_pos")).toMatchObject({ status: "blocked" });
    // Bilingual guidance names the chain (never silent degradation).
    expect(check.guidance?.ar).toContain("industry.template_engine");
    expect(check.guidance?.en).toContain("industry.template_engine");
  });

  it("grocery × business: customer_price_tiers is LIVE (PHASE-017 shipped + the 0025 grant)", () => {
    const check = checkPrerequisites(GROCERY_MANIFEST, business());
    expect(check.status).toBe("ok");
    // The "coming with PHASE-017" tier entry resolved available: the phase
    // shipped (CURRENT_SHIPPED_PHASE bumped 16 → 17) and migration 0025
    // granted distribution.customer_tiers to business/enterprise — the
    // REQUIRED capability is now INCLUDED, no acknowledgement needed.
    expect(stateOf(check, "customer_price_tiers")).toMatchObject({
      status: "included",
    });
    expect(stateOf(check, "expiry_tracking_fefo")?.status).toBe("included");
    expect(stateOf(check, "free_goods_promo")?.status).toBe("included");
    expect(check.requiresAcknowledgement).toBe(false);
    // The tier entry degrades to a HARD block only when the key is truly
    // missing on a shipped phase (guided plan selection, never a gate).
    const withoutTiers = business().filter((key) => key !== "distribution.customer_tiers");
    const degraded = checkPrerequisites(GROCERY_MANIFEST, withoutTiers);
    expect(degraded.status).toBe("blocked");
    expect(degraded.missingChain).toContain("distribution.customer_tiers");
    expect(stateOf(degraded, "customer_price_tiers")).toMatchObject({ status: "blocked" });
  });

  it("automotive × business: job_cards resolves LIVE at PHASE-017 (sales.job_cards intake + grant)", () => {
    const check = checkPrerequisites(AUTOMOTIVE_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    // The PHASE-017 intake key (sales.job_cards — registered in FEATURE_DEPS
    // with its quotations+reservations chain, granted by 0025) is LIVE.
    expect(stateOf(check, "job_cards")).toMatchObject({ status: "included" });
    expect(stateOf(check, "commissions")?.status).toBe("included");
    expect(stateOf(check, "landed_costs")?.status).toBe("included");
    // OPTIONAL later-phase capabilities label coming-soon (020 — the
    // rental-logistics intake horizon). The PHASE-018 qc_inspections entry
    // resolved LIVE at the 018 bump; the PHASE-019 service_contracts entry
    // resolved LIVE at THIS bump (the 0027 plan grants put crm.service_contracts
    // on business AND the phase shipped) — INCLUDED, not phase_gated.
    expect(stateOf(check, "service_contracts")).toMatchObject({
      status: "included",
      featureKeys: ["crm.service_contracts"],
    });
    expect(stateOf(check, "qc_inspections")).toMatchObject({
      status: "included",
      featureKeys: ["manufacturing.qc"],
    });
    expect(check.requiresAcknowledgement).toBe(false);
  });

  it("distribution × business: the full van-sales set is INCLUDED (0025 grants)", () => {
    const check = checkPrerequisites(DISTRIBUTION_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    for (const capabilityId of [
      "van_stock",
      "route_planning",
      "field_collections",
      "customer_price_tiers",
      "free_goods_promo",
      "commissions",
      "cashier_shifts",
      "expiry_tracking_fefo",
    ]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
    expect(stateOf(check, "landed_costs")?.status).toBe("included");
    expect(check.requiresAcknowledgement).toBe(false);
  });

  it("automotive without sales.job_cards: blocked with the exact missing chain (BR-040 closure named)", () => {
    const keys = business().filter((key) => key !== "sales.job_cards");
    const check = checkPrerequisites(AUTOMOTIVE_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toContain("sales.job_cards");
    expect(stateOf(check, "job_cards")).toMatchObject({
      status: "blocked",
      missingKeys: ["sales.job_cards"],
    });
  });

  it("restaurant × business: table_service LIVE (PHASE-016 shipped the §3 intake set)", () => {
    const check = checkPrerequisites(RESTAURANT_MANIFEST, business());
    expect(check.status).toBe("ok");
    // The intake keys registered at 0024 + granted by the business plan:
    // table_service + kitchen_display resolve INCLUDED, not phase-gated.
    expect(stateOf(check, "table_service")).toMatchObject({ status: "included" });
    expect(stateOf(check, "kitchen_display")?.status).toBe("included");
    // composite_kits ships PHASE-015 → already live.
    expect(stateOf(check, "composite_kits")?.status).toBe("included");
  });

  it("OPTIONAL missing hides cleanly — never blocks, never phase-labels", () => {
    // Retail's imei_tracking is OPTIONAL and SHIPPED (PHASE-010): a plan
    // without inventory.serial_tracking degrades it to hidden.
    const keys = business().filter((key) => key !== "inventory.serial_tracking");
    const check = checkPrerequisites(RETAIL_MANIFEST, keys);
    expect(check.status).toBe("ok");
    expect(stateOf(check, "imei_tracking")).toMatchObject({
      status: "hidden",
      missingKeys: ["inventory.serial_tracking"],
    });
    // An OPTIONAL capability whose roadmap phase has not shipped labels
    // coming-soon instead — hidden vs phase_gated is exactly the §4 optional
    // split. No shipped manifest carries an OPTIONAL capability past
    // PHASE-034 any more (the restoration merge completed the roadmap: the
    // 0027/0029 grants put the crm + offline sets on business, the
    // 0042/0043 budgeting/payroll keys granted, and the 030–033
    // wholesale/electronics/healthcare/education/agriculture chains all
    // cite ≤034 phases), so the later-phase example is a synthetic OPTIONAL
    // PHASE-035 entry (the post-roadmap maintenance-era intake horizon, §17
    // — crm.rental_contracts is not yet a catalog key).
    const autoWithLater = JSON.parse(JSON.stringify(AUTOMOTIVE_TEMPLATE_MANIFEST)) as typeof AUTOMOTIVE_TEMPLATE_MANIFEST;
    autoWithLater.capability_prerequisites.rental_logistics = {
      level: "OPTIONAL",
      feature_keys: ["crm.rental_contracts"],
      available_from_phase: "PHASE-035",
    };
    const laterCheck = checkPrerequisites(autoWithLater, keys);
    expect(stateOf(laterCheck, "rental_logistics")).toMatchObject({
      status: "phase_gated",
      phase: "PHASE-035",
    });
    // Retail's free_goods_promo (PHASE-017 keys) is now included on the
    // post-0025 business set — the gate lifted with the phase bump.
    expect(stateOf(check, "free_goods_promo")).toMatchObject({ status: "included" });
  });

  it("REQUIRED shipped-missing blocks with the capability's exact key named", () => {
    // Business minus inventory.batch_tracking: grocery's REQUIRED
    // expiry_tracking_fefo ships with PHASE-010 (shipped) — a hard block.
    const keys = business().filter((key) => key !== "inventory.batch_tracking");
    const check = checkPrerequisites(GROCERY_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toContain("inventory.batch_tracking");
    expect(stateOf(check, "expiry_tracking_fefo")).toMatchObject({
      status: "blocked",
      missingKeys: ["inventory.batch_tracking"],
    });
  });

  it("a REQUIRED capability beyond the shipped phase still phase-gates (the mechanism outlives the roadmap completion)", () => {
    // No shipped template carries a REQUIRED capability past PHASE-034 any
    // more (the restoration merge completed the 34-phase roadmap — the
    // highest manifest gate is agriculture's crop_cycle_costing @ 033), so
    // prove the §4 mechanism on a synthetic manifest: a REQUIRED
    // PHASE-035 capability whose key is off-plan ⇒ phase_gated +
    // requiresAcknowledgement — the switch flow's acknowledgement contract
    // (TemplateSwitchAcknowledgementRequiredError) keys off exactly this
    // flag. (A PHASE-028/032 synthetic no longer works: those phases
    // shipped — 028–031 with the restoration, 032/033 with the education
    // and agriculture shells — and no template requires a post-034 key, so
    // such a capability classifies on its keys alone, not gated. §18
    // lesson 5's pattern keeps the proof on a FUTURE phase key —
    // crm.rental_contracts @PHASE-035, the post-roadmap maintenance-era
    // intake horizon, not yet a catalog key.)
    const synthetic = JSON.parse(JSON.stringify(GROCERY_MANIFEST)) as typeof GROCERY_MANIFEST;
    synthetic.capability_prerequisites.rental_logistics = {
      level: "REQUIRED",
      feature_keys: ["crm.rental_contracts"],
      available_from_phase: "PHASE-035",
    };
    const check = checkPrerequisites(synthetic, business());
    expect(check.status).toBe("ok"); // phase-gated keys are satisfied-but-labeled
    expect(stateOf(check, "rental_logistics")).toMatchObject({
      status: "phase_gated",
      phase: "PHASE-035",
      missingKeys: ["crm.rental_contracts"],
    });
    expect(check.requiresAcknowledgement).toBe(true);
  });

  it("professional_services × business: the full practice set is INCLUDED (0027 grants)", () => {
    const check = checkPrerequisites(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    for (const capabilityId of ["service_contracts", "recurring_billing", "commissions", "job_cards"]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
    // The deposits_late_fees entry (OPTIONAL, crm.contract_deposits +
    // crm.late_fees — the §17 pending-intake set) degrades HIDDEN on the
    // shipped phase 19 (an ungrantable key on a shipped capability is an
    // upgrade path, never a coming-soon label).
    expect(stateOf(check, "deposits_late_fees")).toMatchObject({
      status: "hidden",
      missingKeys: ["crm.contract_deposits", "crm.late_fees"],
    });
    expect(check.requiresAcknowledgement).toBe(false);
  });

  it("education × business: the full tuition set is INCLUDED (0038 grants)", () => {
    const check = checkPrerequisites(EDUCATION_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    // The installment_terms backbone (PHASE-027 keys granted to business by
    // migration 0038) and the enrollment-contract source (crm 0027 grants)
    // both resolve LIVE — no phase gates anywhere (the highest education
    // gate is installment_terms/pdc_notes @ PHASE-027, already shipped).
    expect(stateOf(check, "installment_terms")).toMatchObject({
      status: "included",
      featureKeys: ["installments.plans", "installments.collections", "installments.late_fees"],
    });
    expect(stateOf(check, "service_contracts")).toMatchObject({ status: "included" });
    // The OPTIONAL set: pdc_notes rides the 0038 notes.received grant
    // (INCLUDED — parents paying by post-dated cheques), customer_price_tiers
    // rides the 0025 grants, cashier_shifts the 016 intake; the two §17
    // pending-intake keys (crm.contract_deposits + crm.late_fees) degrade
    // HIDDEN exactly like professional_services — an upgrade path, never a
    // coming-soon label (governance #7's degrade-cleanly posture).
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "included",
      featureKeys: ["notes.received"],
    });
    expect(stateOf(check, "recurring_billing")).toMatchObject({ status: "included" });
    expect(stateOf(check, "customer_price_tiers")).toMatchObject({ status: "included" });
    expect(stateOf(check, "cashier_shifts")).toMatchObject({ status: "included" });
    expect(stateOf(check, "deposits_late_fees")).toMatchObject({
      status: "hidden",
      missingKeys: ["crm.contract_deposits", "crm.late_fees"],
    });
    expect(check.requiresAcknowledgement).toBe(false);
  });

  it("education × starter: blocked with the exact uncovered tuition chain (guided plan selection)", () => {
    const check = checkPrerequisites(EDUCATION_TEMPLATE_MANIFEST, [...PLAN_KEYS.starter]);
    expect(check.status).toBe("blocked");
    // The tier-4 posture (0038 skipped starter): the installment_terms
    // REQUIRED keys + the crm source + the engine key itself are the honest
    // uncovered chain — none phase-gated (all shipped), so starter is a hard
    // block with bilingual guidance naming the exact keys.
    expect(check.missingChain).toContain("industry.template_engine");
    expect(check.missingChain).toContain("crm.service_contracts");
    expect(check.missingChain).toContain("installments.plans");
    expect(check.missingChain).toContain("installments.collections");
    expect(check.missingChain).toContain("installments.late_fees");
    expect(stateOf(check, "installment_terms")).toMatchObject({ status: "blocked" });
    expect(stateOf(check, "service_contracts")).toMatchObject({ status: "blocked" });
    // Bilingual guidance names the chain (never silent degradation).
    expect(check.guidance?.ar).toContain("installments.plans");
    expect(check.guidance?.en).toContain("installments.plans");
  });

  it("agriculture × business: the full season set is INCLUDED on the already-transcribed grants (0026/0027/0008 — ZERO new grants)", () => {
    const check = checkPrerequisites(AGRICULTURE_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    // The season backbone: crop_cycle_costing's keys (manufacturing.bom/
    // production_orders @ the 0026 grants + accounting.projects @ the 0027
    // grants) are ALL granted, so the REQUIRED capability classifies
    // INCLUDED — its available_from_phase PHASE-033 ≤ the 034 gate AND the
    // phase gate only ever engaged for MISSING keys anyway (the §4
    // decision tree: fully present ⇒ included, the roadmap marker never
    // labels a granted key coming-soon).
    expect(stateOf(check, "crop_cycle_costing")).toMatchObject({
      status: "included",
      featureKeys: ["manufacturing.bom", "manufacturing.production_orders", "accounting.projects"],
    });
    expect(stateOf(check, "harvest_batches")).toMatchObject({
      status: "included",
      featureKeys: ["inventory.batch_tracking", "manufacturing.batch_genealogy"],
    });
    expect(stateOf(check, "bom_production")).toMatchObject({ status: "included" });
    expect(stateOf(check, "expiry_tracking_fefo")).toMatchObject({ status: "included" });
    // The OPTIONAL set: livestock serials ride the 0008 base grant, the
    // genealogy/QC keys the 0026 grants, the tier/commission keys the 0025
    // grants, landed_costs the 0008 base, pdc_notes the 0038 grants, and
    // cashier_shifts the 016 intake — all INCLUDED. The one exception is
    // shipment_tracking: distribution.shipment_tracking is NOT a
    // plan-granted key (the §17 pending-intake posture — exactly like
    // professional_services' deposits_late_fees pair), so the entry
    // degrades HIDDEN — an upgrade path, never a coming-soon label
    // (governance #7's degrade-cleanly posture).
    expect(stateOf(check, "batch_genealogy")).toMatchObject({ status: "included" });
    expect(stateOf(check, "qc_inspections")).toMatchObject({ status: "included" });
    expect(stateOf(check, "customer_price_tiers")).toMatchObject({ status: "included" });
    expect(stateOf(check, "commissions")).toMatchObject({ status: "included" });
    expect(stateOf(check, "landed_costs")).toMatchObject({ status: "included" });
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "included",
      featureKeys: ["notes.received"],
    });
    expect(stateOf(check, "cashier_shifts")).toMatchObject({ status: "included" });
    expect(stateOf(check, "shipment_tracking")).toMatchObject({
      status: "hidden",
      missingKeys: ["distribution.shipment_tracking"],
    });
    expect(check.requiresAcknowledgement).toBe(false);
  });

  it("agriculture × starter: blocked with the exact uncovered season chain — crop_cycle_costing a hard block too post-restoration (its phase shipped with the 034 gate)", () => {
    const check = checkPrerequisites(AGRICULTURE_TEMPLATE_MANIFEST, [...PLAN_KEYS.starter]);
    expect(check.status).toBe("blocked");
    // The tier-4 posture (starter never carried the manufacturing/batch/
    // projects sets): the uncovered REQUIRED chain — harvest_batches
    // contributes both its keys (batch_tracking + batch_genealogy),
    // bom_production both of its, plus the uncovered engine key, the
    // uncovered cost-centers required key, and — since the 034 gate made
    // crop_cycle_costing's PHASE-033 SHIPPED — the capability's own
    // accounting.projects key (a shipped capability classifies on its keys
    // alone, so its missing keys join the chain like any hard block).
    // None of the blocked keys is phase-gated, so starter is a hard block
    // with bilingual guidance naming the exact keys.
    expect(check.missingChain).toEqual([
      "accounting.cost_centers",
      "accounting.projects",
      "industry.template_engine",
      "inventory.batch_tracking",
      "manufacturing.batch_genealogy",
      "manufacturing.bom",
      "manufacturing.production_orders",
    ]);
    expect(stateOf(check, "harvest_batches")).toMatchObject({
      status: "blocked",
      missingKeys: ["inventory.batch_tracking", "manufacturing.batch_genealogy"],
    });
    expect(stateOf(check, "bom_production")).toMatchObject({ status: "blocked" });
    expect(stateOf(check, "expiry_tracking_fefo")).toMatchObject({ status: "blocked" });
    // crop_cycle_costing — its keys are ungranted on starter and its owning
    // phase (PHASE-033) shipped with the template itself (the 034 gate: the
    // restoration merge completed the roadmap), so the §4 decision tree
    // labels it BLOCKED like any shipped capability — the honest statement
    // is the plan-upgrade path, never a "coming with PHASE-033" marker for
    // a phase that is already live.
    expect(stateOf(check, "crop_cycle_costing")).toMatchObject({
      status: "blocked",
      missingKeys: ["manufacturing.bom", "manufacturing.production_orders", "accounting.projects"],
    });
    // Bilingual guidance names the chain (never silent degradation).
    expect(check.guidance?.ar).toContain("manufacturing.bom");
    expect(check.guidance?.en).toContain("manufacturing.bom");
    expect(check.guidance?.ar).toContain("inventory.batch_tracking");
    expect(check.guidance?.en).toContain("inventory.batch_tracking");
  });

  it("agriculture without inventory.serial_tracking: the livestock surfaces hide cleanly — never blocks, never phase-labels (governance #7)", () => {
    // The OPTIONAL livestock posture: a business plan minus serial tracking
    // (the pre-PHASE-010 lineage, or a tenant category opt-out posture)
    // hides the OPTIONAL entries that need it while the REQUIRED season
    // chain stays fully INCLUDED — serial tracking is a leaf key (nothing
    // depends on it, FEATURE_DEPS §7), so the tenant-set closure stays
    // intact and nothing blocks.
    const keys = business().filter((key) => key !== "inventory.serial_tracking");
    const check = checkPrerequisites(AGRICULTURE_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    expect(stateOf(check, "crop_cycle_costing")).toMatchObject({ status: "included" });
    // The livestock register nav item + the livestock onboarding step ride
    // the OPTIONAL key — the capability matrix carries no livestock entry
    // (it is a nav/onboarding surface, not a capability_prerequisites
    // row), so the classification table simply never mentions it; the
    // hide happens at the navigation-pruning layer (deriveNavigation).
  });

  it("agriculture without manufacturing.bom (REQUIRED key): the apply blocks fail-loud with the exact key — governance #7's REQUIRED posture", () => {
    // The phase plan §6 example: a plan missing a REQUIRED key (e.g.,
    // manufacturing.bom) blocks onboarding with actionable guidance.
    // bom_production (018 ≤ 027, shipped) blocks on its missing key, so the
    // whole apply degrades with missingChain = ["manufacturing.bom"] and
    // bilingual guidance naming it. NOTE the honest difference from
    // education's torn notes cluster: the BR-040 closureViolations list
    // stays EMPTY here because the closure universe is the active set ∪
    // the manifest's own required keys — manufacturing.bom rides the
    // required set, so the union restores closure and the block surfaces
    // through the capability classification instead (education's
    // notes.received was OUTSIDE its required set, so tearing it orphaned
    // the four notes.* dependents in the closure list; a required key
    // cannot orphan anything — the apply itself refuses).
    const keys = business().filter((key) => key !== "manufacturing.bom");
    const check = checkPrerequisites(AGRICULTURE_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toEqual(["manufacturing.bom"]);
    expect(check.closureViolations).toEqual([]);
    // The capability posture beside the block: bom_production blocks on
    // its missing key (018 — shipped), and crop_cycle_costing blocks on
    // the SAME shared key (033 ≤ 034 — its owning phase shipped with the
    // template itself, so it classifies on its keys alone: blocked on
    // manufacturing.bom while its other two keys stay granted). What
    // blocks the apply is the named chain, never a silent partial season.
    expect(stateOf(check, "bom_production")).toMatchObject({
      status: "blocked",
      missingKeys: ["manufacturing.bom"],
    });
    expect(stateOf(check, "crop_cycle_costing")).toMatchObject({
      status: "blocked",
      missingKeys: ["manufacturing.bom"],
    });
    expect(check.guidance?.ar).toContain("manufacturing.bom");
    expect(check.guidance?.en).toContain("manufacturing.bom");
  });

  it("education without the notes family: pdc_notes hides cleanly — never blocks, never phase-labels", () => {
    // A plan that never carried the notes cluster (the honest governance-#7
    // posture — a pre-0038 lineage): removing the WHOLE notes family keeps
    // the set closed (only notes.* keys depend on notes.* keys, FEATURE_DEPS
    // §7), so the OPTIONAL pdc_notes entry degrades HIDDEN on its missing
    // key alone — a hidden menu, nothing else — while the REQUIRED tuition
    // chain (installments.*) stays fully INCLUDED.
    const keys = business().filter((key) => !key.startsWith("notes."));
    const check = checkPrerequisites(EDUCATION_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("ok");
    expect(check.closureViolations).toEqual([]);
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "hidden",
      missingKeys: ["notes.received"],
    });
    expect(stateOf(check, "installment_terms")).toMatchObject({ status: "included" });
  });

  it("education with a torn 0038 grant (business minus notes.received alone): the whole cluster blocks — BR-040 fail-loud", () => {
    // Removing ONE key from the closed notes cluster tears the tenant-set
    // closure: notes.pdc_calendar/endorsement/dishonor/discounting all
    // require notes.received (FEATURE_DEPS §7), so the check blocks with
    // the exact violations named — a plan is a closed grant cluster, and a
    // torn cluster is guided plan selection (bilingual guidance naming the
    // key), NEVER a silently-partial notes surface. The OPTIONAL pdc_notes
    // entry itself still classifies HIDDEN on its missing key alone — what
    // blocks is the tenant-set tear, not the OPTIONAL capability posture.
    const keys = business().filter((key) => key !== "notes.received");
    const check = checkPrerequisites(EDUCATION_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toEqual(["notes.received"]);
    expect(check.closureViolations).toContainEqual({
      featureKey: "notes.pdc_calendar",
      missing: ["notes.received"],
    });
    expect(check.closureViolations).toContainEqual({
      featureKey: "notes.endorsement",
      missing: ["notes.received"],
    });
    expect(check.closureViolations).toContainEqual({
      featureKey: "notes.dishonor",
      missing: ["notes.received"],
    });
    expect(check.closureViolations).toContainEqual({
      featureKey: "notes.discounting",
      missing: ["notes.received"],
    });
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "hidden",
      missingKeys: ["notes.received"],
    });
    expect(check.guidance?.ar).toContain("notes.received");
    expect(check.guidance?.en).toContain("notes.received");
  });

  it("wholesale × business: the full trading set is INCLUDED — the pdc_notes chain LIVE via the 0038 grants (0044)", () => {
    const check = checkPrerequisites(WHOLESALE_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    expect(check.requiresAcknowledgement).toBe(false);
    // The two REQUIRED differentiators: customer_price_tiers (0025 grants)
    // and pdc_notes (0038 grants — phase 027 shipped, keys on business).
    expect(stateOf(check, "customer_price_tiers")).toMatchObject({ status: "included" });
    expect(stateOf(check, "pdc_notes")).toMatchObject({ status: "included" });
    // The OPTIONAL trading surface rides the granted keys.
    for (const capabilityId of [
      "installment_terms",
      "barcode_pos",
      "cashier_shifts",
      "imei_tracking",
      "expiry_tracking_fefo",
      "free_goods_promo",
      "commissions",
      "landed_costs",
      "route_planning",
      "field_collections",
    ]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
    // shipment_tracking (distribution.shipment_tracking, the PHASE-019
    // rental-logistics intake horizon) is an ungrantable key on a SHIPPED
    // capability (its available_from_phase 019 ≤ 030, but no plan carries
    // the key) — the §18 lesson 5 posture: HIDDEN with the upgrade path,
    // never a coming-soon label.
    expect(stateOf(check, "shipment_tracking")).toMatchObject({
      status: "hidden",
      missingKeys: ["distribution.shipment_tracking"],
    });
  });

  it("wholesale × starter: blocked with the notes chain in the guided plan selection", () => {
    const check = checkPrerequisites(WHOLESALE_TEMPLATE_MANIFEST, [...PLAN_KEYS.starter]);
    expect(check.status).toBe("blocked");
    // Starter carries the classic sales chain but NOT the notes keys (the
    // 0038 tier-4 wave) nor distribution.customer_tiers (0025).
    expect(check.missingChain).toContain("notes.received");
    expect(check.missingChain).toContain("distribution.customer_tiers");
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "blocked",
      missingKeys: expect.arrayContaining(["notes.received", "notes.pdc_calendar"]),
    });
    expect(stateOf(check, "customer_price_tiers")).toMatchObject({ status: "blocked" });
    expect(check.guidance?.ar).toContain("notes.received");
    expect(check.guidance?.en).toContain("notes.received");
  });

  it("wholesale without notes.received (downgraded plan): blocked with the exact missing chain", () => {
    const keys = business().filter((key) => key !== "notes.received");
    const check = checkPrerequisites(WHOLESALE_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toContain("notes.received");
    // notes.received is BOTH a required_feature_key and the pdc_notes
    // capability's key — the chain names it once, honestly.
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "blocked",
      missingKeys: ["notes.received"],
    });
  });

  it("electronics × business: the full counter/repair set is INCLUDED (0044)", () => {
    const check = checkPrerequisites(ELECTRONICS_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    expect(check.requiresAcknowledgement).toBe(false);
    // The four REQUIRED capabilities: imei_tracking + job_cards +
    // barcode_pos + cashier_shifts — all LIVE (phases 010/019/016 ≤ 030,
    // keys granted by the base/0024/0027 seeds).
    for (const capabilityId of ["imei_tracking", "job_cards", "barcode_pos", "cashier_shifts"]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
    // The OPTIONAL repair-bench surface.
    for (const capabilityId of [
      "composite_kits",
      "customer_price_tiers",
      "free_goods_promo",
      "commissions",
      "landed_costs",
      "service_contracts",
      "pdc_notes",
      "installment_terms",
    ]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
  });

  it("electronics × starter: blocked with the POS + service-order chain named", () => {
    const check = checkPrerequisites(ELECTRONICS_TEMPLATE_MANIFEST, [...PLAN_KEYS.starter]);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toContain("pos.terminals");
    expect(check.missingChain).toContain("crm.service_orders");
    expect(stateOf(check, "barcode_pos")).toMatchObject({ status: "blocked" });
    expect(stateOf(check, "job_cards")).toMatchObject({ status: "blocked" });
    expect(check.guidance?.ar).toContain("crm.service_orders");
    expect(check.guidance?.en).toContain("crm.service_orders");
  });

  it("electronics without crm.service_orders: blocked with the job_cards capability naming its exact key", () => {
    const keys = business().filter((key) => key !== "crm.service_orders");
    const check = checkPrerequisites(ELECTRONICS_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toContain("crm.service_orders");
    expect(stateOf(check, "job_cards")).toMatchObject({
      status: "blocked",
      missingKeys: ["crm.service_orders"],
    });
  });

  it("healthcare × business: the full billing set is INCLUDED — insurance_claim_billing LIVE at its own release (0046)", () => {
    const check = checkPrerequisites(HEALTHCARE_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    expect(check.requiresAcknowledgement).toBe(false);
    // The four REQUIRED capabilities: insurance_claim_billing (the shell's
    // OWN capability, available_from_phase PHASE-031 ≤ 031 — LIVE on its
    // release day; sales.invoices + notes.received + partners.statements all
    // granted), pdc_notes (0038 grants — REQUIRED here, unlike wholesale's
    // OPTIONAL posture: claims settle by cheque/PDC so 027 is a prereq),
    // expiry_tracking_fefo (inventory.batch_tracking on business), and
    // job_cards (crm.service_orders via 0027 — the visit document).
    for (const capabilityId of [
      "insurance_claim_billing",
      "pdc_notes",
      "expiry_tracking_fefo",
      "job_cards",
    ]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
    // The OPTIONAL pharmacy-counter surface rides the granted keys (POS by
    // 0024, shifts by base, tiers by 0025, service contracts + installments
    // by 0027/0038).
    for (const capabilityId of [
      "barcode_pos",
      "cashier_shifts",
      "customer_price_tiers",
      "service_contracts",
      "installment_terms",
    ]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
  });

  it("healthcare × starter: blocked with the notes + service-order chain in the guided plan selection", () => {
    const check = checkPrerequisites(HEALTHCARE_TEMPLATE_MANIFEST, [...PLAN_KEYS.starter]);
    expect(check.status).toBe("blocked");
    // Starter carries the classic sales chain but NOT the notes keys (the
    // 0038 tier-4 wave) nor crm.service_orders (0027) nor
    // inventory.batch_tracking — the claim settlement chain (cheques/PDC)
    // is exactly what the higher plans unlock.
    expect(check.missingChain).toContain("notes.received");
    expect(check.missingChain).toContain("crm.service_orders");
    expect(check.missingChain).toContain("inventory.batch_tracking");
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "blocked",
      missingKeys: expect.arrayContaining(["notes.received", "notes.pdc_calendar"]),
    });
    expect(stateOf(check, "insurance_claim_billing")).toMatchObject({ status: "blocked" });
    expect(check.guidance?.ar).toContain("notes.received");
    expect(check.guidance?.en).toContain("notes.received");
  });

  it("healthcare without notes.received (downgraded plan): blocked with the exact claim chain", () => {
    const keys = business().filter((key) => key !== "notes.received");
    const check = checkPrerequisites(HEALTHCARE_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    expect(check.missingChain).toContain("notes.received");
    // notes.received is BOTH a required_feature_key and the key of TWO
    // REQUIRED capabilities (insurance_claim_billing + pdc_notes) — the
    // chain names it once, honestly.
    expect(stateOf(check, "insurance_claim_billing")).toMatchObject({
      status: "blocked",
      missingKeys: ["notes.received"],
    });
    expect(stateOf(check, "pdc_notes")).toMatchObject({
      status: "blocked",
      missingKeys: expect.arrayContaining(["notes.received"]),
    });
  });

  it("rental_logistics × business: the full rental set is INCLUDED — the shell composes ONLY live keys (0047)", () => {
    const check = checkPrerequisites(RENTAL_LOGISTICS_TEMPLATE_MANIFEST, business());
    expect(check.status).toBe("ok");
    expect(check.missingChain).toEqual([]);
    expect(check.closureViolations).toEqual([]);
    expect(check.requiresAcknowledgement).toBe(false);
    // The six REQUIRED capabilities — every one over LIVE granted keys (the
    // 0047 reconciliation): rental_contracts + service_contracts +
    // recurring_billing (crm set by 0027), deposits_late_fees (recurring
    // billing + receipts — the deferred crm.contract_deposits/crm.late_fees
    // intake pair is NEVER granted), shipment_tracking (the live
    // distribution routes/settlements pair by 0025), field_collections
    // (receipts by base).
    for (const capabilityId of [
      "rental_contracts",
      "service_contracts",
      "recurring_billing",
      "deposits_late_fees",
      "shipment_tracking",
      "field_collections",
    ]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
    // The OPTIONAL surface rides the granted keys (POS by 0024, shifts by
    // base, service orders + job cards by 0027, tiers by 0025, commissions
    // by 0025, pdc notes + installments by 0038).
    for (const capabilityId of [
      "barcode_pos",
      "cashier_shifts",
      "job_cards",
      "customer_price_tiers",
      "commissions",
      "route_planning",
      "pdc_notes",
      "installment_terms",
    ]) {
      expect(stateOf(check, capabilityId), capabilityId).toMatchObject({ status: "included" });
    }
  });

  it("rental_logistics × starter: blocked with the exact uncovered rental chain (guided plan selection)", () => {
    const check = checkPrerequisites(RENTAL_LOGISTICS_TEMPLATE_MANIFEST, [...PLAN_KEYS.starter]);
    expect(check.status).toBe("blocked");
    // Starter carries the classic trade chain (items.item_master,
    // partners.statements, treasury.accounts) but NOT the crm set (0027),
    // NOT inventory.serial_tracking, and NOT industry.template_engine —
    // the rental contract chain is exactly what the higher plans unlock.
    expect(check.missingChain).toContain("industry.template_engine");
    expect(check.missingChain).toContain("crm.service_contracts");
    expect(check.missingChain).toContain("crm.recurring_billing");
    expect(check.missingChain).toContain("inventory.serial_tracking");
    expect(stateOf(check, "rental_contracts")).toMatchObject({ status: "blocked" });
    expect(stateOf(check, "deposits_late_fees")).toMatchObject({ status: "blocked" });
    expect(check.guidance?.ar).toContain("crm.service_contracts");
    expect(check.guidance?.en).toContain("crm.service_contracts");
  });

  it("rental_logistics without inventory.serial_tracking (downgraded plan): blocked on the required fleet key — the capabilities stay included", () => {
    const keys = business().filter((key) => key !== "inventory.serial_tracking");
    const check = checkPrerequisites(RENTAL_LOGISTICS_TEMPLATE_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    // inventory.serial_tracking is a required_feature_key of the shell (the
    // fleet surface) — its absence blocks the APPLY even though every
    // capability's own key chain remains granted (rental_contracts rides
    // crm.service_contracts alone): the top-level chain names the exact
    // missing key, honestly.
    expect(check.missingChain).toEqual(["inventory.serial_tracking"]);
    expect(stateOf(check, "rental_contracts")).toMatchObject({ status: "included" });
    expect(stateOf(check, "shipment_tracking")).toMatchObject({ status: "included" });
    expect(check.guidance?.ar).toContain("inventory.serial_tracking");
    expect(check.guidance?.en).toContain("inventory.serial_tracking");
  });
});

describe("BR-040 dependency closure over required_feature_keys (§7)", () => {
  it("rejects a set activating pos.sales without its sales.invoices dependency", () => {
    const keys = business().filter((key) => key !== "sales.invoices");
    const check = checkPrerequisites(RETAIL_MANIFEST, keys);
    expect(check.status).toBe("blocked");
    // The closure names the exact missing chain (pos.sales → sales.invoices).
    expect(check.missingChain).toContain("sales.invoices");
    expect(check.closureViolations).toContainEqual({
      featureKey: "pos.sales",
      missing: ["sales.invoices"],
    });
  });

  it("a satisfiable set applies (enterprise carries the full closure)", () => {
    for (const manifest of [
      RETAIL_MANIFEST,
      GROCERY_MANIFEST,
      RESTAURANT_MANIFEST,
      AUTOMOTIVE_TEMPLATE_MANIFEST,
      DISTRIBUTION_TEMPLATE_MANIFEST,
      PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
      // PHASE-032: the education closure — enterprise carries the installments
      // + notes sets (0038) on top of the crm chain (0027).
      EDUCATION_TEMPLATE_MANIFEST,
      // PHASE-033: the agriculture closure — enterprise carries the
      // manufacturing (0026) + projects/cost-centers (0027/0008) + batch
      // (0008) chains; shipment_tracking stays HIDDEN (ungranted §17
      // pending-intake key — an OPTIONAL upgrade path, never a block).
      AGRICULTURE_TEMPLATE_MANIFEST,
      // PHASE-030/031 (restored lineage): the wholesale/electronics/
      // healthcare closures — enterprise carries the notes (0038) + pos
      // (0024) + crm (0027) chains they ride.
      WHOLESALE_TEMPLATE_MANIFEST,
      ELECTRONICS_TEMPLATE_MANIFEST,
      HEALTHCARE_TEMPLATE_MANIFEST,
    ]) {
      const check = checkPrerequisites(manifest, enterprise());
      expect(check.status, manifest.id).toBe("ok");
      expect(check.closureViolations, manifest.id).toEqual([]);
    }
  });

  it("the shipped intake keys grant cleanly on enterprise (BR-040 closure holds)", () => {
    // pos.table_service/pos.kitchen_display are full catalog keys since
    // 0024 with their closure (pos.sales) carried by the plan.
    const check = checkPrerequisites(RESTAURANT_MANIFEST, enterprise());
    expect(check.status).toBe("ok");
    expect(check.missingChain).not.toContain("pos.table_service");
    expect(check.missingChain).not.toContain("pos.kitchen_display");
  });
});

describe("the typed blocked error", () => {
  it("carries the chain + bilingual guidance + closure violations", () => {
    const check = checkPrerequisites(
      RETAIL_MANIFEST,
      business().filter((key) => key !== "sales.invoices"),
    );
    const error = new TemplatePrerequisitesBlockedError(
      RETAIL_MANIFEST.id,
      check.missingChain,
      check.guidance!,
      check.closureViolations,
    );
    expect(error.code).toBe("configuration/template-prerequisites-blocked");
    expect(error.missingChain).toContain("sales.invoices");
    expect(error.guidance.ar).toContain("sales.invoices");
    expect(error.guidance.en).toContain("sales.invoices");
  });
});
