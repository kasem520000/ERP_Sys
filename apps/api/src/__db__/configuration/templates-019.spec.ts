import { beforeAll, describe, expect, it } from "vitest";

import {
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
  RETAIL_MANIFEST,
  hashManifestJson,
} from "@erp/contracts";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import {
  findAppliedStateRow,
  parseAppliedOverrides,
} from "../../modules/configuration/application/apply/applied-state.store";
import {
  applyService,
  auditActions,
  postServiceInvoice,
  provisionBusinessTenant,
  resolver,
  revokeEntitlement,
  seedPostingSubstrate,
  switchService,
  tenantLevelSeries,
} from "./template-fixtures";

/**
 * PHASE-019 T2 db spec — the professional services template through the
 * UNMODIFIED PHASE-015 engine (industries/README §8 #3/#5/#7; the seven
 * per-template requirements):
 *
 * - `industry.professional_services` v1.0.0 applies cleanly to a fresh
 *   business-plan tenant (the 0027 plan grants cover the CRM+projects
 *   REQUIRED chain at CURRENT_SHIPPED_PHASE 19): the applied row pins the
 *   KNOWN migration-0027 content hash, the append-only series registry
 *   lands (contract_invoice INV-, receipt RCP-), report pins + bilingual
 *   onboarding checklist + enabled modules materialize (crm module ON),
 *   the apply is audited, and the derived navigation/terminology/policies
 *   resolve live (practice/billing, القضية / الملف, contract_billing_mode
 *   retainer_or_milestones).
 * - Re-apply is idempotent (zero writes).
 * - Switch safety (BR-038): retail → professional_services is
 *   additive-only — the posted back-office invoice survives byte-identical,
 *   series are the union (retail rows untouched, contract_invoice/receipt
 *   appended), archived_* snapshots for the retail set, switching BACK
 *   always succeeds, the archives hold BOTH templates, and the switches
 *   are audited.
 * - Degraded entitlement (§8 #7): a tenant without `crm.service_contracts`
 *   applying professional_services gets the typed prerequisite error with
 *   the exact missing chain — never a silent back-office apply; automotive
 *   WITHOUT the CRM add-on keeps its OPTIONAL service_contracts capability
 *   hidden cleanly (PHASE-019 shipped — hidden, not phase-gated); a
 *   starter-plan tenant blocks with the full chain.
 * - L5 beats L1 (BR-038 R8): an explicit `crm.time_entries_require_case`
 *   tenant setting overrides the manifest's true default.
 */

/** KNOWN hash — `pnpm validate:manifests` on the seven-template set (the
 *  constant is byte-identical to the migration 0027 registry seed and the
 *  docs mirror docs/industries/templates/manifests/
 *  manifest.professional_services.json). */
const KNOWN_HASH = "sha256:d000a1159335ce3fa0c327b3f72be2c93b3f3c029fadc90c8bdd30ef1e13429a";

/** The 0008 base-seed CRM set (the "CRM add-on") — the §18 lesson 5 rule:
 *  revoking the FULL set keeps the tenant's own BR-040 closure valid (a
 *  single-key revoke would strand recurring_billing/service_orders on a
 *  broken closure and the apply would block instead of hiding cleanly). */
const CRM_ADDON_KEYS: readonly string[] = [
  "crm.leads",
  "crm.tasks_activities",
  "crm.service_contracts",
  "crm.recurring_billing",
  "crm.service_orders",
];

// -- tenant A: professional_services apply -----------------------------------
let svcTenant = "";
let svcOwner = "";

// -- tenant B: switch safety (retail → professional_services → retail) ------
let switchTenant = "";
let switchOwner = "";
let switchInvoice!: {
  invoiceId: string;
  invoiceNo: string;
  journalEntryId: string;
};

// -- tenant C: degraded entitlement (no crm.service_contracts) ---------------
let degradedTenant = "";
let degradedOwner = "";

// -- tenant D: automotive without the CRM add-on -----------------------------
let autoTenant = "";
let autoOwner = "";

// -- tenant E: starter-plan degradation ---------------------------------------
let starterTenant = "";
let starterOwner = "";

beforeAll(async () => {
  const svc = await provisionBusinessTenant("svc-019", "industry.professional_services");
  svcTenant = svc.tenantId;
  svcOwner = svc.ownerId;

  // The switch-safety tenant: retail (back-office counter) applied over a
  // REAL posted invoice — the retail template's own data essence for the
  // back-office channel (a posted CREDIT service invoice through the real
  // sales flow: submit → approve (SoD) → post + AR subledger row).
  const switched = await provisionBusinessTenant("switch-svc", "industry.retail");
  switchTenant = switched.tenantId;
  switchOwner = switched.ownerId;
  const substrate = await seedPostingSubstrate(switchTenant, switchOwner, "SW019");
  switchInvoice = await postServiceInvoice(substrate, "pre-switch retainer invoice");
  const appliedRetail = await withTenant(switchTenant, () =>
    applyService.apply(switchOwner, { templateKey: "industry.retail", mode: "initial" }),
  );
  expect(appliedRetail.applied).toBe(true);

  const degraded = await provisionBusinessTenant("svc-degraded", "industry.professional_services");
  degradedTenant = degraded.tenantId;
  degradedOwner = degraded.ownerId;
  // The service-contracts capability's key off the entitlement set (0027
  // granted it to business; the revoke simulates the pre-grant / downgraded
  // plan).
  await revokeEntitlement(degradedTenant, "crm.service_contracts");

  const auto = await provisionBusinessTenant("auto-no-crm", "industry.automotive");
  autoTenant = auto.tenantId;
  autoOwner = auto.ownerId;
  // Automotive WITHOUT the CRM add-on: the whole 5-key set off (revoking
  // only crm.service_contracts would strand recurring_billing/service_orders
  // on a broken closure — the clean add-on removal keeps BR-040 valid).
  for (const key of CRM_ADDON_KEYS) {
    await revokeEntitlement(autoTenant, key);
  }

  const starter = await provisionBusinessTenant("svc-starter", "industry.professional_services");
  starterTenant = starter.tenantId;
  starterOwner = starter.ownerId;
  // Re-materialize the plan as starter (the real flow — no CRM/projects
  // entitlements at all).
  const { EntitlementsService } = await import(
    "../../modules/tenancy/application/entitlements-service"
  );
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const entitlements = new EntitlementsService(new AuditService(new DrizzleAuditStore()));
  await withTenant(starterTenant, () =>
    entitlements.assignPlan(starterOwner, { planKey: "starter", source: "PLAN", expiresAt: null }),
  );
  resetConfigurationCache();
});

describe("templates-019 — professional_services through the PHASE-015 engine", () => {
  it("industry.professional_services v1.0.0 applies cleanly to a fresh business tenant", async () => {
    const result = await withTenant(svcTenant, () =>
      applyService.apply(svcOwner, { templateKey: "industry.professional_services", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.templateKey).toBe("industry.professional_services");
    expect(result.version).toBe("1.0.0");
    expect(result.manifestHash).toBe(hashManifestJson(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST));
    expect(result.manifestHash).toBe(KNOWN_HASH);

    // The PHASE-019 practice set resolves LIVE (phase 19 shipped + the
    // 0027 grants) — the two REQUIRED capabilities INCLUDED, nothing
    // gated, no acknowledgement.
    for (const capabilityId of ["service_contracts", "recurring_billing"]) {
      const capability = result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === capabilityId,
      );
      expect(capability, capabilityId).toMatchObject({ status: "included" });
    }
    expect(
      result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === "commissions",
      ),
    ).toMatchObject({ status: "included" });
    // The §17 pending-intake pair (crm.contract_deposits + crm.late_fees)
    // degrades HIDDEN — an upgrade path, never a coming-soon label (§18
    // lesson 5 posture).
    expect(
      result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === "deposits_late_fees",
      ),
    ).toMatchObject({
      status: "hidden",
      missingKeys: ["crm.contract_deposits", "crm.late_fees"],
    });
    expect(result.prerequisiteCheck.status).toBe("ok");
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // -- the applied row: key / version / KNOWN 0027 seed hash ------------
    const row = await withTenant(svcTenant, () => findAppliedStateRow());
    expect(row).toBeDefined();
    expect(row!.templateKey).toBe("industry.professional_services");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.status).toBe("ACTIVE");
    expect(row!.appliedBy).toBe(svcOwner);
    expect(row!.appliedManifestHash).toBe(hashManifestJson(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST));
    expect(row!.appliedManifestHash).toBe(KNOWN_HASH);

    // -- series registry: every services doc type (contract_invoice INV-)
    const series = await tenantLevelSeries(svcTenant);
    expect(series.map((entry) => entry.docType)).toEqual(
      Object.keys(PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.document_numbering_defaults).sort(),
    );
    const contractInvoice = series.find((entry) => entry.docType === "contract_invoice")!;
    expect(contractInvoice.format).toBe("INV-{yyyy}-{seq:6}");
    expect(contractInvoice.nextValue).toBe("1"); // acquisition-inert registry row (R5)
    expect(series.find((entry) => entry.docType === "receipt")?.format).toBe("RCP-{yyyy}-{seq:6}");
    expect(series.find((entry) => entry.docType === "credit_note")?.format).toBe("CN-{yyyy}-{seq:5}");
    expect(series.find((entry) => entry.docType === "sales_invoice")?.format).toBe("INV-{yyyy}-{seq:6}");

    // -- overrides: report pins + checklist + modules ----------------------
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual(
      PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.report_defaults.map((pin) => pin.report_key),
    );
    expect(overrides.report_pins[0]).toMatchObject({
      report_key: "services.contract_revenue_schedule",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.report_pins[2]).toMatchObject({
      report_key: "ar.aging", // the §12 doc reconciliation (partners.ar_aging → live key)
      pinned: true,
      dashboard: false,
    });
    expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
      PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.onboarding_steps.map((step) => step.id),
    );
    // No step carries a feature_key gate — everything visible (LIVE at 019).
    expect(overrides.onboarding_checklist.every((step) => step.status === "visible")).toBe(true);
    expect(overrides.enabled_modules).toEqual(
      PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST.default_modules_enabled,
    );
    expect(overrides.enabled_modules).toContain("crm");

    // -- audited ------------------------------------------------------------
    expect(await auditActions(svcTenant, "industry.template.applied")).toBe(1);

    // -- the derived config: practice/billing live, terminology AR + EN ---
    resetConfigurationCache();
    const config = await withTenant(svcTenant, () => resolver.resolveTenantStatic(svcTenant));
    expect(config.layers.l1_template?.key).toBe("industry.professional_services");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    expect(config.ui.navigation).toEqual(["practice", "billing"]);
    const practice = config.ui.navigation_tree.find((group) => group.id === "practice")!;
    expect(practice.items.map((item) => item.id)).toEqual(["cases", "timesheets", "contracts"]);
    expect(practice.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(
      config.ui.navigation_tree.find((group) => group.id === "billing")!.items.map(
        (item) => item.id,
      ),
    ).toEqual(["recurring", "invoices", "statements"]);
    expect(config.ui.terminology["svc.case"]).toEqual({
      en: "Case / Matter",
      ar: "القضية / الملف",
    });
    expect(config.ui.terminology["doc.contract"]).toEqual({
      en: "Service contract",
      ar: "عقد الخدمات",
    });
    // The crm module is INSTALLED (L8 from default_modules_enabled).
    expect(config.layers.l8_installed.crm).toBe(true);
    // The six PHASE-019 workflow policies land as L1 defaults (the manifest
    // ships them; L5 may override — see the last test).
    expect(config.policies["crm.contract_billing_mode"]).toBe("retainer_or_milestones");
    expect(config.policies["crm.time_entries_require_case"]).toBe(true);
    expect(config.policies["crm.unbilled_time_review_before_invoice"]).toBe(true);
    expect(config.policies["crm.invoice_approval_required"]).toBe(true);
    expect(config.policies["crm.invoice_numbering_per_series"]).toBe(false);
    expect(config.policies["crm.narrative_required_on_time_billing"]).toBe(true);
  });

  it("re-apply of the template is idempotent (zero writes)", async () => {
    const before = await withTenant(svcTenant, () => findAppliedStateRow());
    const seriesBefore = await tenantLevelSeries(svcTenant);

    const second = await withTenant(svcTenant, () =>
      applyService.apply(svcOwner, { templateKey: "industry.professional_services", mode: "reapply" }),
    );
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("already-applied");

    const after = await withTenant(svcTenant, () => findAppliedStateRow());
    expect(after!.appliedAt).toBe(before!.appliedAt);
    expect(after!.appliedManifestHash).toBe(KNOWN_HASH);
    expect(await tenantLevelSeries(svcTenant)).toHaveLength(seriesBefore.length);
    expect(await auditActions(svcTenant, "industry.template.applied")).toBe(1);
  });

  it("switch safety (BR-038): retail → professional_services is additive-only, posted history untouched, and back again", async () => {
    // The pre-switch registry: retail's own series (the posted invoice's
    // number row is branch-scoped — the tenant-level rows are the registry;
    // sales_invoice carries only the acquisition row, so the retail apply
    // skipped it exactly like template-switch.spec's retail tenant).
    const seriesBefore = await tenantLevelSeries(switchTenant);
    expect(seriesBefore.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "pos_sale",
      "stock_transfer",
    ]);

    // The pre-switch posted-history snapshot (byte-level).
    const historyBefore = await invoiceHistorySnapshot(switchTenant, switchInvoice);

    // The 0027 grants cover professional_services's REQUIRED chain on
    // business — the switch needs no acknowledgement (nothing REQUIRED is
    // gated).
    const switched = await withTenant(switchTenant, () =>
      switchService.switch(switchOwner, { targetTemplateKey: "industry.professional_services" }),
    );
    expect(switched.applied).toBe(true);

    const row = await withTenant(switchTenant, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.professional_services");
    expect(row!.appliedManifestHash).toBe(KNOWN_HASH);

    // -- ZERO data loss: the posted invoice is intact BYTE-IDENTICAL ------
    expect(await invoiceHistorySnapshot(switchTenant, switchInvoice)).toEqual(historyBefore);
    const su = await superuserClient();
    const invoice = await su.query<{ invoice_no: string; status: string; channel: string }>(
      `SELECT invoice_no, status, channel FROM sales_invoices WHERE id = $1`,
      [switchInvoice.invoiceId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({
      invoice_no: switchInvoice.invoiceNo,
      status: "POSTED",
      channel: "STANDARD",
    });

    // -- BR-038 archives: the retail snapshot is present, read-only --------
    expect(row!.archivedTerminology).toHaveLength(1);
    expect(row!.archivedTerminology[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedTerminology[0]!.terminology["doc.sales_invoice_pos"]).toEqual({
      en: "POS sale",
      ar: "بيع نقطة البيع",
    });
    expect(row!.archivedNavigation[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedNavigation[0]!.groups).toHaveLength(2); // selling + stock
    expect(row!.archivedCapabilities[0]).toMatchObject({ templateKey: "industry.retail" });
    expect(
      row!.archivedCapabilities[0]!.capabilities.map((cap) => cap.capabilityId).sort(),
    ).toEqual([
      "barcode_pos",
      "cashier_shifts",
      "composite_kits",
      "free_goods_promo",
      "imei_tracking",
      "landed_costs",
    ]);

    // -- additive-only numbering: retail rows untouched, contract_invoice/
    //    receipt appended; credit_note/sales_invoice skipped (rows exist) --
    const seriesAfter = await tenantLevelSeries(switchTenant);
    expect(seriesAfter.map((entry) => entry.docType)).toEqual([
      "contract_invoice",
      "credit_note",
      "pos_sale",
      "receipt",
      "stock_transfer",
    ]);
    expect(seriesAfter.find((entry) => entry.docType === "contract_invoice")?.format).toBe(
      "INV-{yyyy}-{seq:6}",
    ); // the services default (the posted invoice numbered from the
    // branch-scoped sales_invoice acquisition row, so the services
    // sales_invoice default was skipped — no row was mutated)
    expect(seriesAfter.find((entry) => entry.docType === "receipt")?.format).toBe("RCP-{yyyy}-{seq:6}");
    expect(seriesAfter.find((entry) => entry.docType === "credit_note")?.format).toBe(
      "CN-{yyyy}-{seq:5}",
    ); // the retail row, byte-for-byte
    expect(seriesAfter.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "POS-{branch}-{yy}{MM}-{seq:5}",
    ); // the retail row, byte-for-byte

    // -- the audited switch + the effective config ------------------------
    expect(await auditActions(switchTenant, "industry.template.switched")).toBe(1);
    resetConfigurationCache();
    const config = await withTenant(switchTenant, () =>
      resolver.resolveTenantStatic(switchTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.professional_services");
    expect(config.ui.navigation).toEqual(["practice", "billing"]);
    expect(config.ui.terminology["svc.case"]).toEqual({
      en: "Case / Matter",
      ar: "القضية / الملف",
    });

    // -- switching BACK always succeeds (nothing was destroyed) -----------
    const back = await withTenant(switchTenant, () =>
      switchService.switch(switchOwner, { targetTemplateKey: "industry.retail" }),
    );
    expect(back.applied).toBe(true);
    const restored = await withTenant(switchTenant, () => findAppliedStateRow());
    expect(restored!.templateKey).toBe("industry.retail");
    expect(restored!.appliedManifestHash).toBe(hashManifestJson(RETAIL_MANIFEST));
    // The archives hold BOTH template sets (append-only history, R2/R6).
    expect(restored!.archivedTerminology.map((entry) => entry.templateKey)).toEqual([
      "industry.retail",
      "industry.professional_services",
    ]);
    // The services series REMAIN (append-only — R5).
    const seriesBack = await tenantLevelSeries(switchTenant);
    expect(seriesBack.map((entry) => entry.docType)).toContain("contract_invoice");
    expect(seriesBack.map((entry) => entry.docType)).toContain("receipt");
    // The posted invoice is STILL untouched.
    expect(await invoiceHistorySnapshot(switchTenant, switchInvoice)).toEqual(historyBefore);
    expect(await auditActions(switchTenant, "industry.template.switched")).toBe(2);
  });

  it("degraded entitlement: professional_services without crm.service_contracts blocks with the typed missing chain", async () => {
    await expect(
      withTenant(degradedTenant, () =>
        applyService.apply(degradedOwner, {
          templateKey: "industry.professional_services",
          mode: "initial",
        }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      templateKey: "industry.professional_services",
      missingChain: ["crm.service_contracts"],
      guidance: {
        ar: expect.stringContaining("crm.service_contracts"),
        en: expect.stringContaining("crm.service_contracts"),
      },
    });
    // Never silent AND never partial: zero rows were written.
    expect(await withTenant(degradedTenant, () => findAppliedStateRow())).toBeUndefined();
    const su = await superuserClient();
    const series = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM numbering_sequences WHERE tenant_id = $1`,
      [degradedTenant],
    );
    await su.end();
    expect(series.rows[0]!.n).toBe("0");
    expect(await auditActions(degradedTenant, "industry.template.applied")).toBe(0);
  });

  it("automotive WITHOUT the CRM add-on: service_contracts hides cleanly (no phase label at 19)", async () => {
    // The OPTIONAL PHASE-019 capability degrades HIDDEN (not phase_gated —
    // the phase shipped, so an unentitled key is an upgrade path, never a
    // coming-soon label); the apply proceeds; nothing crashes. The FULL
    // 5-key set is revoked (§18 lesson 5): a single-key revoke would strand
    // recurring_billing/service_orders on a broken BR-040 closure and the
    // apply would block instead of hiding cleanly.
    const result = await withTenant(autoTenant, () =>
      applyService.apply(autoOwner, { templateKey: "industry.automotive", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    const svcCapability = result.prerequisiteCheck.capabilities.find(
      (capability) => capability.capabilityId === "service_contracts",
    );
    expect(svcCapability).toMatchObject({
      status: "hidden",
      missingKeys: ["crm.service_contracts"],
    });
    expect(svcCapability!.phase).toBeUndefined(); // no coming-soon label at PHASE-019
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // The workshop/parts navigation resolves with NO crm.* targets (the
    // automotive manifest carries none — the CRM add-on would compose
    // professional_services, §5 R10 hidden menus, no broken screen).
    resetConfigurationCache();
    const config = await withTenant(autoTenant, () =>
      resolver.resolveTenantStatic(autoTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.automotive");
    expect(config.ui.navigation).toEqual(["workshop", "parts"]);
    expect(
      config.ui.navigation_tree
        .flatMap((group) => group.items.map((item) => item.target))
        .filter((target) => target.startsWith("crm.")),
    ).toEqual([]);
    // The crm module is NOT installed for this tenant (the automotive
    // manifest does not enable it and no crm key is active — L4 stays the
    // single source of feature truth).
    expect(config.layers.l8_installed.crm).toBeUndefined();
  });

  it("starter-plan degradation: the full missing chain blocks the apply (guided plan selection)", async () => {
    // Starter carries none of the CRM/projects keys: the REQUIRED
    // capabilities block, the required_feature_keys backstop adds the
    // uncovered engine/projects keys, and BR-040 closure contributes
    // accounting.cost_centers (accounting.projects depends on it).
    await expect(
      withTenant(starterTenant, () =>
        applyService.apply(starterOwner, {
          templateKey: "industry.professional_services",
          mode: "initial",
        }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      templateKey: "industry.professional_services",
      missingChain: [
        "accounting.cost_centers",
        "accounting.projects",
        "crm.recurring_billing",
        "crm.service_contracts",
        "industry.template_engine",
      ],
      guidance: {
        ar: expect.stringContaining("crm.service_contracts"),
        en: expect.stringContaining("crm.service_contracts"),
      },
    });
    // Zero rows were written (fail closed — no partial state).
    expect(await withTenant(starterTenant, () => findAppliedStateRow())).toBeUndefined();
    const su = await superuserClient();
    const series = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM numbering_sequences WHERE tenant_id = $1`,
      [starterTenant],
    );
    await su.end();
    expect(series.rows[0]!.n).toBe("0");
    expect(await auditActions(starterTenant, "industry.template.applied")).toBe(0);
  });

  it("L5 tenant setting beats the L1 manifest default (BR-038 R8): time_entries_require_case off", async () => {
    // The manifest ships time_entries_require_case true (proven in the first
    // test); an explicit tenant_settings row wins per the §3 precedence
    // table (L10 > L5 > L1 > platform default).
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES (gen_random_uuid(), $1, 'crm.time_entries_require_case', 'false'::jsonb, now())
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [svcTenant],
    );
    await su.end();
    resetConfigurationCache();
    const config = await withTenant(svcTenant, () => resolver.resolveTenantStatic(svcTenant));
    expect(config.layers.l1_template?.key).toBe("industry.professional_services");
    expect(config.policies["crm.time_entries_require_case"]).toBe(false); // L5 wins
    // The untouched crm policies keep their L1 defaults.
    expect(config.policies["crm.contract_billing_mode"]).toBe("retainer_or_milestones");
    expect(config.policies["crm.unbilled_time_review_before_invoice"]).toBe(true);
    expect(config.policies["crm.invoice_approval_required"]).toBe(true);
    expect(config.policies["crm.invoice_numbering_per_series"]).toBe(false);
    expect(config.policies["crm.narrative_required_on_time_billing"]).toBe(true);
  });
});

/** Byte-level snapshot of the posted back-office invoice history (invoice
 * row + journal lines with the partner/project stamps) — the proof object
 * BR-038's zero-data-loss contract. */
async function invoiceHistorySnapshot(
  tenantId: string,
  posted: { invoiceId: string; journalEntryId: string },
): Promise<{
  invoice: { invoiceNo: string; status: string; channel: string; totalGross: string };
  journal: { direction: string; amount: string; accountId: string; partnerId: string | null; projectId: string | null }[];
}> {
  const su = await superuserClient();
  const invoice = await su.query<{
    invoice_no: string;
    status: string;
    channel: string;
    total_gross: string;
  }>(
    `SELECT invoice_no, status, channel, total_gross::text FROM sales_invoices WHERE id = $1`,
    [posted.invoiceId],
  );
  await su.end();
  const lines = await withTenant(tenantId, async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    return journal.listLines(posted.journalEntryId);
  });
  return {
    invoice: {
      invoiceNo: invoice.rows[0]!.invoice_no,
      status: invoice.rows[0]!.status,
      channel: invoice.rows[0]!.channel,
      totalGross: invoice.rows[0]!.total_gross,
    },
    journal: lines.map((line) => ({
      direction: line.direction,
      amount: line.amount,
      accountId: line.accountId,
      partnerId: line.partnerId,
      projectId: line.projectId,
    })),
  };
}
