import * as fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GROCERY_MANIFEST,
  RESTAURANT_MANIFEST,
  RETAIL_MANIFEST,
  type IndustryTemplateManifest,
} from "@erp/contracts";

import {
  cachedTenantSettings,
  publishConfigurationEvent,
  publishTenancyEvent,
  resetConfigurationCache,
  storeTenantSettingsCache,
} from "../application/config-events";
import {
  cachedRequestOverlay,
  cachedTenantStatic,
  resolveCacheSizes,
  storeRequestOverlay,
  storeTenantStatic,
} from "../application/resolve/cache";
import { composeTenantStaticConfig } from "../application/resolve/compose";
import { DEFAULT_NAVIGATION, deriveNavigation } from "../application/resolve/derivation";
import { GLOSSARY_DEFAULTS, resolveTerminology } from "../application/resolve/terminology";
import {
  ResolveEffectiveConfigService,
  type PrincipalInput,
} from "../application/resolve/resolve-service";
import { closureViolations } from "../domain/feature-catalog";
import { ConfigurationResolutionError } from "../domain/effective-config";
import type { LayerInputs, L10ApprovalPolicy } from "../domain/layer-model";
import { UnknownPolicyKeyError } from "../domain/policy-registry";
import { TaxLayerViolationError } from "../domain/precedence";
import {
  SETTINGS_REGISTRY,
  SETTING_KEYS,
  UnknownSettingKeyError,
} from "../domain/settings-schema";
import type { ConfigRepository } from "../infrastructure/config-repository";
import {
  PLAN_KEYS,
  SHIPPED_TEMPLATES,
  layerInputsFixture,
  l1Of,
  l4Of,
  shuffleRecordKeyOrder,
} from "./layer-fixtures";

/**
 * PHASE-015 §6 `config-resolution.spec` — the ten-layer resolution engine:
 * determinism property (same inputs ⇒ identical output + identical
 * resolved_hash, key-order independent), the §3 precedence table per value
 * class, fail-closed unknown-key rejection (L5 + L1), fail-closed on a
 * corrupted/missing layer (typed error, no partial config, nothing cached),
 * L2-only tax ownership, terminology layering precedence, navigation
 * pruning (unentitled hidden / phase-gated marked / empty groups drop),
 * and the §9 cache + invalidation wiring through the service.
 */

// ---------------------------------------------------------------------------
// Deterministic settings-value pool: every candidate is validated against
// the SETTINGS_REGISTRY schema — the registry itself is the oracle.
// ---------------------------------------------------------------------------

const VALUE_CANDIDATES: unknown[] = [
  true, false, "ar", "en", "latn", "arab", 0, 1, 12, 30, 60, 365, 3650,
  "0.0000", "1.0000", "5000.0000", "warn", "block", "allow",
  "delivery_then_invoice", "invoice_then_delivery", "recoverable", "expensed",
  "REGISTERED", "NOT_REGISTERED", null, "300012345600003", "",
  { step: "completed", completed_at: null },
  { assign_at: "approval" },
  { country_code: "SA", pack_key: "sa", bound_at: "2026-01-01" },
];

const VALID_SETTING_VALUES: ReadonlyMap<string, readonly unknown[]> = new Map(
  Object.entries(SETTINGS_REGISTRY).map(([key, definition]) => [
    key,
    VALUE_CANDIDATES.filter((candidate) => definition.schema.safeParse(candidate).success),
  ]),
);

const settingEntryArbitraries: readonly fc.Arbitrary<readonly [string, unknown]>[] =
  SETTING_KEYS.flatMap((key) => {
    const pool = VALID_SETTING_VALUES.get(key) ?? [];
    // Keys with no valid candidate (none today — the guard keeps the
    // property future-proof against registry additions) never generate.
    if (pool.length === 0) {
      return [];
    }
    return [
      fc
        .constantFrom(...pool)
        .map((value): readonly [string, unknown] => [key, value]),
    ];
  });

const settingEntriesArbitrary: fc.Arbitrary<Record<string, unknown>> = fc
  .uniqueArray(fc.oneof(...settingEntryArbitraries), {
    minLength: 0,
    maxLength: SETTING_KEYS.length,
    selector: ([key]) => key,
  })
  .map((pairs) => Object.fromEntries(pairs.map(([key, value]) => [key, value])));

const branchLayerArbitrary: fc.Arbitrary<
  Record<string, { id: string; isActive: boolean; seriesFormats: Record<string, string> }>
> = fc
  .uniqueArray(fc.constantFrom("BR1", "BR2", "BR3"), { minLength: 0, maxLength: 3 })
  .map((codes) =>
    Object.fromEntries(
      codes.map((code, index) => [
        code,
        {
          id: `b${index}000000-0000-7000-8000-00000000000${index}`,
          isActive: true,
          seriesFormats: (code === "BR1"
            ? { pos_sale: "POS-BR1-{seq:5}" }
            : {}) as Record<string, string>,
        },
      ]),
    ),
  );

const approvalsArbitrary: fc.Arbitrary<L10ApprovalPolicy[]> = fc
  .array(
    fc.record({
      docType: fc.constantFrom("purchase_order", "sales_invoice", "stock_adjustment"),
      mode: fc.constantFrom("none", "single-approver", "two-step", "amount-threshold"),
      threshold: fc.option(fc.constantFrom("1.0000", "5000.0000")),
      allowSelfApproval: fc.boolean(),
      appliesFrom: fc.constant("2026-01-01"),
    }),
    { maxLength: 3 },
  )
  .map((rows) =>
    rows.map((row) => ({
      docType: row.docType,
      mode: row.mode,
      threshold: row.threshold === null ? null : row.threshold,
      allowSelfApproval: row.allowSelfApproval,
      appliesFrom: row.appliesFrom,
    })),
  );

const layerInputsArbitrary: fc.Arbitrary<LayerInputs> = fc
  .record({
    template: fc.constantFrom<IndustryTemplateManifest | null>(
      null,
      ...SHIPPED_TEMPLATES,
    ),
    plan: fc.constantFrom<"starter" | "business" | "enterprise">(
      "starter",
      "business",
      "enterprise",
    ),
    settings: settingEntriesArbitrary,
    branches: branchLayerArbitrary,
    flags: fc.record({
      pos: fc.option(fc.boolean()),
      distribution: fc.option(fc.boolean()),
    }),
    approvals: approvalsArbitrary,
  })
  .map((draw) =>
    layerInputsFixture({
      template: draw.template,
      plan: draw.plan,
      settings: draw.settings,
      branches: draw.branches,
      flags: Object.fromEntries(
        Object.entries(draw.flags).filter(([, value]) => value !== undefined),
      ) as Record<string, boolean>,
      approvals: draw.approvals,
    }),
  );

// ---------------------------------------------------------------------------
// Determinism (§1 principle 2, §6 acceptance 1)
// ---------------------------------------------------------------------------

describe("determinism: identical inputs ⇒ identical config + stable hash", () => {
  it("property: randomized layer combinations resolve identically across runs", () => {
    fc.assert(
      fc.property(layerInputsArbitrary, (inputs) => {
        // The plan keys must satisfy BR-040 closure (the seeds do; the
        // property never fabricates entitlement sets beyond them).
        expect(closureViolations(inputs.l4.active)).toEqual([]);
        const first = composeTenantStaticConfig(inputs);
        const second = composeTenantStaticConfig(inputs);
        expect(second).toEqual(first);
        expect(second.resolved_hash).toBe(first.resolved_hash);
        expect(first.resolved_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }),
      { numRuns: 120 },
    );
  });

  it("property: key insertion order never changes the resolved hash", () => {
    fc.assert(
      fc.property(layerInputsArbitrary, (inputs) => {
        const first = composeTenantStaticConfig(inputs);
        const reordered = composeTenantStaticConfig(
          shuffleRecordKeyOrder(inputs) as LayerInputs,
        );
        expect(reordered).toEqual(first);
        expect(reordered.resolved_hash).toBe(first.resolved_hash);
      }),
      { numRuns: 120 },
    );
  });
});

// ---------------------------------------------------------------------------
// Precedence table (§3) per value class
// ---------------------------------------------------------------------------

describe("precedence: policy values L10 > L5 > L1 > platform default", () => {
  it("platform default: template-less tenant keeps sales.cash_autopost = false", () => {
    const config = composeTenantStaticConfig(layerInputsFixture({ template: null }));
    expect(config.policies["sales.cash_autopost"]).toBe(false);
    expect(config.tenant.industry_template).toBeNull();
  });

  it("L1 default: retail template sets cash autopost via the policy mapping", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST }),
    );
    // cash_sales_autopost → sales.cash_autopost (POLICY_REGISTRY mapping).
    expect(config.policies["sales.cash_autopost"]).toBe(true);
    // Registry-only workflow keys keep their policy-key names.
    expect(config.policies["shift_variance_approval_required"]).toBe(true);
    expect(config.policies["pos.return_requires_original_invoice"]).toBe(true);
  });

  it("L5 explicit wins over the L1 template default (BR-038: explicit settings survive)", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({
        template: RETAIL_MANIFEST,
        settings: { "sales.cash_autopost": false },
      }),
    );
    expect(config.policies["sales.cash_autopost"]).toBe(false);
  });

  it("L1 inventory default maps fefo_picking → inventory.fefo_for_expiry_items", () => {
    const retail = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST }),
    );
    const grocery = composeTenantStaticConfig(
      layerInputsFixture({ template: GROCERY_MANIFEST }),
    );
    expect(retail.policies["inventory.fefo_for_expiry_items"]).toBe(false);
    expect(grocery.policies["inventory.fefo_for_expiry_items"]).toBe(true);
  });

  it("L10 approval policies land above L5 (BR-034 keys are present and typed)", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({
        template: RETAIL_MANIFEST,
        approvals: [
          {
            docType: "purchase_order",
            mode: "amount-threshold",
            threshold: "5000.0000",
            allowSelfApproval: false,
            appliesFrom: "2026-01-01",
          },
        ],
      }),
    );
    expect(config.policies["approvals.purchase_order.mode"]).toBe("amount-threshold");
    expect(config.policies["approvals.purchase_order.threshold"]).toBe("5000.0000");
    expect(config.policies["approvals.purchase_order.allow_self_approval"]).toBe(false);
  });

  it("a null L10 threshold omits the key (never a null policy value)", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({
        approvals: [
          {
            docType: "sales_invoice",
            mode: "single-approver",
            threshold: null,
            allowSelfApproval: false,
            appliesFrom: "2026-01-01",
          },
        ],
      }),
    );
    expect(config.policies["approvals.sales_invoice.mode"]).toBe("single-approver");
    expect("approvals.sales_invoice.threshold" in config.policies).toBe(false);
  });
});

describe("precedence: numbering series L7 > L5 > L1", () => {
  it("L1 default: restaurant PO reserves at approval → assign_at approval", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RESTAURANT_MANIFEST }),
    );
    expect(config.policies["numbering.purchase_order.assign_at"]).toBe("approval");
    expect(config.policies["numbering.pos_sale.assign_at"]).toBe("posting");
  });

  it("L5 tenant numbering.defaults beats the L1 reserve posture", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({
        template: RESTAURANT_MANIFEST,
        settings: { "numbering.defaults": { assign_at: "posting" } },
      }),
    );
    expect(config.policies["numbering.purchase_order.assign_at"]).toBe("posting");
  });

  it("L7 branch sequence format beats the L1 template default", () => {
    const inputs = layerInputsFixture({
      template: RETAIL_MANIFEST,
      branches: {
        BR1: {
          id: "b1000000-0000-7000-8000-000000000001",
          isActive: true,
          seriesFormats: { pos_sale: "POS-BR1-{yyyy}-{seq:6}" },
        },
      },
    });
    const config = composeTenantStaticConfig(inputs);
    // L7 wins for pos_sale; the L1 default survives for sales_invoice.
    expect(config.layers.l7_branch_defaults["BR1"]?.numbering_series["pos_sale"]).toBe(
      "POS-BR1-{yyyy}-{seq:6}",
    );
    expect(config.layers.l7_branch_defaults["BR1"]?.numbering_series["sales_invoice"]).toBe(
      "INV-{yyyy}-{seq:6}",
    );
  });

  it("default_warehouse / cash_account stay neutral until branch editors ship them", () => {
    const config = composeTenantStaticConfig(layerInputsFixture({}));
    expect(config.layers.l7_branch_defaults["BR1"]).toMatchObject({
      default_warehouse: null,
      cash_account: null,
    });
  });
});

describe("precedence: feature availability is L4 only (reported, never granted)", () => {
  it("the active list is exactly L4 (sorted); missing = template required − active", () => {
    // Grocery on starter: distribution.customer_tiers is unentitled → the
    // degraded set names it; the ACTIVE set is never widened by the template.
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: GROCERY_MANIFEST, plan: "starter" }),
    );
    expect(config.layers.l4_entitlements.active).toEqual(l4Of("starter").active);
    expect(config.layers.l4_entitlements.missing).toContain("distribution.customer_tiers");
    expect(config.layers.l4_entitlements.missing).toContain("pos.terminals");
  });

  it("business plan carries the full retail closure — nothing missing", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST, plan: "business" }),
    );
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    expect(config.layers.l4_entitlements.sources["pos.sales"]).toBe("PLAN");
  });

  it("restaurant carries the 016 intake set on enterprise (0024 plan grants)", () => {
    // PHASE-016 flipped the phase gate: pos.table_service /
    // pos.kitchen_display / items.composite_products are granted by the
    // business/enterprise plans (0024) and resolve ACTIVE.
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RESTAURANT_MANIFEST, plan: "enterprise" }),
    );
    expect(config.layers.l4_entitlements.active).toContain("pos.table_service");
    expect(config.layers.l4_entitlements.active).toContain("pos.kitchen_display");
    expect(config.layers.l4_entitlements.active).toContain("items.composite_products");
  });

  it("BR-040 closure violations fail resolution (typed, fail closed)", () => {
    const inputs = layerInputsFixture({});
    const broken: LayerInputs = {
      ...inputs,
      l4: { active: ["pos.sales"], sources: { "pos.sales": "PLAN" } }, // missing closure
    };
    expect(() => composeTenantStaticConfig(broken)).toThrow(ConfigurationResolutionError);
    expect(() => composeTenantStaticConfig(broken)).toThrow(/dependency closure/);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed validation (§3 step 2, §6 rule 6)
// ---------------------------------------------------------------------------

describe("fail-closed: unknown keys are rejected loudly, never dropped", () => {
  it("L5 unknown settings key → typed error with the cause preserved", () => {
    const inputs = layerInputsFixture({
      settings: { "totally.unknown_key": true } as Record<string, unknown>,
    });
    let error: unknown;
    try {
      composeTenantStaticConfig(inputs);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationResolutionError);
    const resolutionError = error as ConfigurationResolutionError;
    expect(resolutionError.code).toBe("configuration/resolution-failed");
    expect(resolutionError.cause).toBeInstanceOf(UnknownSettingKeyError);
  });

  it("L1 unknown workflow-policy key → typed error", () => {
    const drifted: IndustryTemplateManifest = {
      ...RETAIL_MANIFEST,
      workflow_policies: { ...RETAIL_MANIFEST.workflow_policies, bogus_policy: true },
    };
    const inputs = layerInputsFixture({ template: drifted });
    let error: unknown;
    try {
      composeTenantStaticConfig(inputs);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationResolutionError);
    expect((error as ConfigurationResolutionError).cause).toBeInstanceOf(UnknownPolicyKeyError);
  });

  it("L1 required key outside the catalog ∪ intake set → typed error", () => {
    const drifted: IndustryTemplateManifest = {
      ...RETAIL_MANIFEST,
      required_feature_keys: [...RETAIL_MANIFEST.required_feature_keys, "logistics.trucks"],
    };
    expect(() =>
      composeTenantStaticConfig(layerInputsFixture({ template: drifted })),
    ).toThrow(/unknown feature key "logistics.trucks"/);
  });

  it("type violation smuggled into a policy key → typed error", () => {
    const drifted: IndustryTemplateManifest = {
      ...RETAIL_MANIFEST,
      workflow_policies: { ...RETAIL_MANIFEST.workflow_policies, cash_sales_autopost: "yes" },
    };
    expect(() =>
      composeTenantStaticConfig(layerInputsFixture({ template: drifted })),
    ).toThrow(/cash_sales_autopost/);
  });

  it("corrupt tenant terminology overrides → typed error", () => {
    const inputs = layerInputsFixture({
      template: RETAIL_MANIFEST,
      tenantTerminology: { "pos.terminal": { en: "Terminal" } as never }, // missing ar
    });
    expect(() => composeTenantStaticConfig(inputs)).toThrow(/bilingual/);
  });
});

describe("fail-closed: L2-only tax ownership (ADR-0010)", () => {
  it("an L5 tax-rate key is rejected with the typed TaxLayerViolationError", () => {
    const inputs = layerInputsFixture({
      settings: { "tax.rates.standard": "0.15" } as Record<string, unknown>,
    });
    let error: unknown;
    try {
      composeTenantStaticConfig(inputs);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationResolutionError);
    expect((error as ConfigurationResolutionError).cause).toBeInstanceOf(TaxLayerViolationError);
  });

  it("an L5 tax-treatment key is rejected the same way", () => {
    const inputs = layerInputsFixture({
      settings: { "tax.treatment.zero_rated": "ZERO" } as Record<string, unknown>,
    });
    let error: unknown;
    try {
      composeTenantStaticConfig(inputs);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationResolutionError);
    expect((error as ConfigurationResolutionError).cause).toBeInstanceOf(TaxLayerViolationError);
    expect((error as Error).message).toContain("L2-only");
  });

  it("no workflow-policy registry key can touch tax values (the registry is closed)", () => {
    // The L1 smuggling path dies at the registry: there is no tax policy key.
    const drifted: IndustryTemplateManifest = {
      ...RETAIL_MANIFEST,
      workflow_policies: { ...RETAIL_MANIFEST.workflow_policies, "tax.rate.vat": 15 },
    };
    let error: unknown;
    try {
      composeTenantStaticConfig(layerInputsFixture({ template: drifted }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationResolutionError);
    expect((error as ConfigurationResolutionError).cause).toBeInstanceOf(UnknownPolicyKeyError);
  });

  it("the l2 block comes only from L2 — legitimate tax.* settings still pass", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ settings: { "tax.pricing_inclusive_default": true } }),
    );
    // The jurisdiction facts are L2's; the pricing MODE is an L5 policy key.
    expect(config.layers.l2_jurisdiction_pack).toMatchObject({
      country_code: "SA",
      pack_version: "1.0.0-baseline",
      vat_status: "VAT_IN_FORCE",
      tenant_registration: "REGISTERED",
    });
    expect(config.policies["tax.pricing_inclusive_default"]).toBe(true);
    // No rate/treatment value ever enters the merged policies.
    for (const key of Object.keys(config.policies)) {
      expect(key).not.toMatch(/^tax\.(rate|rates|treatment|treatments)\./);
    }
  });
});

// ---------------------------------------------------------------------------
// Terminology layering (tenant addition > template > glossary)
// ---------------------------------------------------------------------------

describe("terminology precedence: tenant addition > template > platform glossary", () => {
  it("template-less tenant speaks exactly the platform glossary rows", () => {
    const config = composeTenantStaticConfig(layerInputsFixture({ template: null }));
    expect(config.ui.terminology).toEqual(GLOSSARY_DEFAULTS);
  });

  it("template overrides beat the glossary default", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST }),
    );
    // Glossary default: "Sales invoice"; retail renames the POS document.
    expect(GLOSSARY_DEFAULTS["doc.sales_invoice_pos"]).toEqual({
      en: "Sales invoice",
      ar: "فاتورة البيع",
    });
    expect(config.ui.terminology["doc.sales_invoice_pos"]).toEqual({
      en: "POS sale",
      ar: "بيع نقطة البيع",
    });
  });

  it("tenant additions beat the template override", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({
        template: RETAIL_MANIFEST,
        tenantTerminology: {
          "doc.sales_invoice_pos": { en: "Counter sale", ar: "بيع الكاونتر" },
        },
      }),
    );
    expect(config.ui.terminology["doc.sales_invoice_pos"]).toEqual({
      en: "Counter sale",
      ar: "بيع الكاونتر",
    });
    // Untouched template keys survive.
    expect(config.ui.terminology["pos.terminal"]).toEqual({ en: "Terminal", ar: "الطرفية" });
  });

  it("grocery adds keys the glossary does not carry (industry language)", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: GROCERY_MANIFEST }),
    );
    expect(config.ui.terminology["item.scale_item"]).toEqual({
      en: "Scale item",
      ar: "صنف الميزان",
    });
    // The glossary-sourced key stays at its glossary value when the template
    // agrees with it (batch.expiry = the GLOSSARY.md row, verbatim).
    expect(config.ui.terminology["batch.expiry"]).toEqual({
      en: "Expiry date",
      ar: "تاريخ الانتهاء",
    });
  });

  it("resolveTerminology is directly testable per level", () => {
    const merged = resolveTerminology({
      glossary: GLOSSARY_DEFAULTS,
      template: { "inventory.writeoff": { en: "Write-off", ar: "الإعدام" } },
      tenantAdditions: { "inventory.writeoff": { en: "Disposal", ar: "التخلص" } },
    });
    expect(merged["inventory.writeoff"]).toEqual({ en: "Disposal", ar: "التخلص" });
  });
});

// ---------------------------------------------------------------------------
// L9 navigation derivation (prune by L4; phase-gate intake keys; drop empties)
// ---------------------------------------------------------------------------

describe("navigation pruning: L4 entitlements + L8 flags + phase gates", () => {
  it("unentitled feature_key hides the item (starter retail: POS entry hidden)", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST, plan: "starter" }),
    );
    const selling = config.ui.navigation_tree.find((group) => group.id === "selling");
    expect(selling?.items.map((item) => item.id)).toEqual(["returns", "receipts"]);
    // The summary + emphasis reflect the pruned tree.
    expect(config.ui.navigation).toContain("selling");
    expect(config.ui.emphasis).toEqual(["selling", "stock"]);
  });

  it("entitled feature_key keeps the item (business retail)", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RETAIL_MANIFEST, plan: "business" }),
    );
    const selling = config.ui.navigation_tree.find((group) => group.id === "selling");
    expect(selling?.items.map((item) => item.id)).toEqual(["pos", "returns", "receipts"]);
  });

  it("PHASE-016 shipped the intake set: table/kitchen items resolve LIVE (restaurant)", () => {
    // T14 activation flip: pos.table_service + pos.kitchen_display were
    // registered into FEATURE_CATALOG at 0024 (§25 protocol) and
    // CURRENT_SHIPPED_PHASE moved to 016 — the floor items are entitled
    // on business and resolve without any phase gate.
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: RESTAURANT_MANIFEST, plan: "business" }),
    );
    const floor = config.ui.navigation_tree.find((group) => group.id === "floor");
    expect(floor?.items.find((item) => item.id === "tables")).toMatchObject({
      feature_key: "pos.table_service",
    });
    expect(
      floor?.items.find((item) => item.id === "tables")?.phase_gated,
    ).toBeUndefined();
    expect(floor?.items.find((item) => item.id === "kitchen")).toMatchObject({
      feature_key: "pos.kitchen_display",
    });
    expect(
      floor?.items.find((item) => item.id === "kitchen")?.phase_gated,
    ).toBeUndefined();
    // quick_sale is entitled on business → visible, NOT phase-gated.
    expect(floor?.items.find((item) => item.id === "quick_sale")).toMatchObject({
      feature_key: "pos.sales",
    });
    expect(
      floor?.items.find((item) => item.id === "quick_sale")?.phase_gated,
    ).toBeUndefined();
  });

  it("a group whose every item is gated on an unentitled key drops entirely", () => {
    const synthetic: IndustryTemplateManifest = {
      ...GROCERY_MANIFEST,
      navigation_manifest: {
        groups: [
          {
            id: "pos_only",
            label: { en: "POS", ar: "نقطة البيع" },
            order: 1,
            items: [
              {
                id: "pos",
                label: { en: "Point of sale", ar: "نقطة البيع" },
                target: "pos.counter",
                feature_key: "pos.sales",
              },
            ],
          },
          {
            id: "selling",
            label: { en: "Selling", ar: "البيع" },
            order: 2,
            items: [
              {
                id: "tiers",
                label: { en: "Customer price tiers", ar: "فئات أسعار العملاء" },
                target: "items.tiers",
              },
            ],
          },
        ],
      },
    };
    const config = composeTenantStaticConfig(
      layerInputsFixture({ template: synthetic, plan: "starter" }),
    );
    expect(config.ui.navigation).toEqual(["selling"]); // pos_only dropped.
    expect(config.ui.emphasis).toEqual(["selling"]);
  });

  it("L8 module deactivation hides the module's items even when entitled", () => {
    const config = composeTenantStaticConfig(
      layerInputsFixture({
        template: RETAIL_MANIFEST,
        plan: "business",
        flags: { pos: false },
      }),
    );
    expect(config.layers.l8_installed["pos"]).toBe(false);
    const selling = config.ui.navigation_tree.find((group) => group.id === "selling");
    expect(selling?.items.map((item) => item.id)).toEqual(["returns", "receipts"]);
  });

  it("no template ⇒ the PHASE-005 core default navigation, ungated", () => {
    const config = composeTenantStaticConfig(layerInputsFixture({ template: null }));
    expect(config.ui.navigation).toEqual(DEFAULT_NAVIGATION.map((group) => group.id));
    expect(config.ui.navigation).toEqual([
      "home", "sales", "purchasing", "inventory",
      "accounting", "treasury", "reports", "settings",
    ]);
    for (const group of config.ui.navigation_tree) {
      for (const item of group.items) {
        expect(item.feature_key).toBeUndefined();
        expect(item.phase_gated).toBeUndefined();
      }
    }
    expect(config.ui.emphasis).toEqual([]); // Template-less tenants: no emphasis.
  });

  it("deriveNavigation orders groups by manifest order (stable on ties)", () => {
    const groups = deriveNavigation({
      template: l1Of(RESTAURANT_MANIFEST),
      activeEntitlements: new Set(PLAN_KEYS.business),
      installedModules: {},
    });
    expect(groups.map((group) => group.id)).toEqual(["floor", "day"]);
  });
});

// ---------------------------------------------------------------------------
// Service: fail-closed layer loading + caching + §9 invalidation
// ---------------------------------------------------------------------------

type BrokenLayer =
  | "fingerprint" | "tenant" | "1" | "2" | "3" | "4" | "5" | "7" | "8" | "10";

/**
 * A fake repository over the fixtures: the service's layer loads can be
 * exercised (and broken) without a database. Every method is counted.
 */
function fakeRepository(
  breakages: { layer?: BrokenLayer } = {},
  options: { plan?: "starter" | "business" | "enterprise" } = {},
) {
  const fixture = layerInputsFixture({ plan: options.plan });
  const calls: Record<string, number> = {};
  const count = <T>(name: string, fn: () => T): T => {
    calls[name] = (calls[name] ?? 0) + 1;
    return fn();
  };
  const boom = (layer: string): never => {
    throw new Error(`layer ${layer} exploded (corruption test)`);
  };
  const repository = {
    computeInputFingerprint: () =>
      breakages.layer === "fingerprint"
        ? boom("fingerprint")
        : count("fingerprint", () => "fp-1"),
    getTenantProfile: () =>
      breakages.layer === "tenant"
        ? boom("tenant")
        : count("tenant", () => ({
            id: fixture.tenantId,
            baseCurrency: "SAR",
            countryCode: "SA",
            industryTemplateKey: "industry.retail",
            status: "ACTIVE",
          })),
    findTenantIndustryConfig: () =>
      breakages.layer === "1"
        ? boom("1")
        : count("l1", () => ({
            templateKey: "industry.retail",
            appliedVersion: "1.0.0",
            appliedManifestHash: fixture.l1 === null ? "" : fixture.l1.manifestHash,
            appliedAt: "2026-11-01T00:00:00.000Z",
            status: "ACTIVE",
            overrides: {},
            updatedAt: "2026-11-01T00:00:00.000Z",
          })),
    findIndustryTemplate: (key: string) =>
      count("l1registry", () => ({
        key,
        version: "1.0.0",
        manifest: RETAIL_MANIFEST,
        isActive: true,
        status: "ACTIVE",
      })),
    listTenantSettings: () =>
      breakages.layer === "5" ? boom("5") : count("l5", () => []),
    listActiveEntitlements: () =>
      breakages.layer === "4"
        ? boom("4")
        : count("l4", () =>
            fixture.l4.active.map((featureKey) => ({
              featureKey,
              source: "PLAN",
              expiresAt: null,
            })),
          ),
    findCurrentPlan: () =>
      breakages.layer === "3"
        ? boom("3")
        : count("l3", () => ({
            planKey: options.plan ?? "business",
            limits: {},
            planUpdatedAt: "2026-01-01T00:00:00.000Z",
          })),
    listBranches: () =>
      breakages.layer === "7"
        ? boom("7")
        : count("l7", () => [
            { id: "b1000000-0000-7000-8000-000000000001", code: "BR1", isActive: true },
          ]),
    listNumberingSequences: () => count("l7seq", () => []),
    listActiveApprovalPolicies: () =>
      breakages.layer === "10" ? boom("10") : count("l10", () => []),
    findJurisdiction: (countryCode: string) =>
      breakages.layer === "2"
        ? boom("2")
        : count("l2", () => ({
            countryCode,
            packVersion: "1.0.0-baseline",
            vatStatus: "VAT_IN_FORCE",
          })),
    findTaxPackBinding: () => count("l2binding", () => undefined),
    findTaxRegistration: () => count("l2reg", () => ({ status: "REGISTERED" })),
    listFeatureFlags: () =>
      breakages.layer === "8" ? boom("8") : count("l8", () => []),
  };
  return { repository: repository as unknown as ConfigRepository, calls };
}

describe("ResolveEffectiveConfigService: fail-closed + cache + overlay", () => {
  beforeEach(() => {
    resetConfigurationCache();
  });

  it("resolves the §5-shape tenant-static config end to end", async () => {
    const { repository } = fakeRepository();
    const service = new ResolveEffectiveConfigService(repository);
    const config = await service.resolveTenantStatic(
      "01920000-0000-7000-8000-000000000001",
    );
    expect(config.config_version).toBe(3);
    expect(config.tenant).toMatchObject({
      id: "01920000-0000-7000-8000-000000000001",
      industry_template: "industry.retail",
      jurisdiction: "SA",
      base_currency: "SAR",
    });
    expect(config.layers.l1_template).toMatchObject({
      key: "industry.retail",
      version: "1.0.0",
    });
    expect(config.layers.l2_jurisdiction_pack).toMatchObject({
      pack_version: "1.0.0-baseline",
      tenant_registration: "REGISTERED",
    });
    expect(config.invariants_note).toContain("INV-001");
    expect(cachedTenantStatic("01920000-0000-7000-8000-000000000001", "fp-1")).toBeDefined();
  });

  it("a corrupted layer fails closed with the typed error — nothing cached", async () => {
    const layers: BrokenLayer[] = [
      "fingerprint", "tenant", "1", "2", "3", "4", "5", "7", "8", "10",
    ];
    for (const layer of layers) {
      const { repository } = fakeRepository({ layer });
      const service = new ResolveEffectiveConfigService(repository);
      const promise = service.resolveTenantStatic("01920000-0000-7000-8000-000000000001");
      await expect(promise).rejects.toMatchObject({
        code: "configuration/resolution-failed",
        layer,
      });
      expect(resolveCacheSizes().tenantStatic).toBe(0);
    }
  });

  it("the tenant mismatch guard fails closed (defense in depth)", async () => {
    const { repository } = fakeRepository();
    const service = new ResolveEffectiveConfigService(repository);
    await expect(
      service.resolveTenantStatic("01929999-0000-7000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "configuration/resolution-failed", layer: "tenant" });
  });

  it("tenant-static is cached: a second resolve loads no layers again", async () => {
    const { repository, calls } = fakeRepository();
    const service = new ResolveEffectiveConfigService(repository);
    const first = await service.resolveTenantStatic("01920000-0000-7000-8000-000000000001");
    const second = await service.resolveTenantStatic("01920000-0000-7000-8000-000000000001");
    expect(second.resolved_hash).toBe(first.resolved_hash);
    expect(calls["l5"]).toBe(1);
    expect(calls["l1"]).toBe(1);
    expect(calls["l1registry"]).toBe(1);
  });

  it("a fingerprint mismatch forces re-resolution (§9 staleness guard)", async () => {
    const { repository, calls } = fakeRepository();
    let fingerprint = "fp-1";
    (repository as unknown as Record<string, unknown>)[
      "computeInputFingerprint"
    ] = () => {
      calls["fingerprint"] = (calls["fingerprint"] ?? 0) + 1;
      return fingerprint;
    };
    const service = new ResolveEffectiveConfigService(repository);
    await service.resolveTenantStatic("01920000-0000-7000-8000-000000000001");
    expect(calls["l5"]).toBe(1);
    fingerprint = "fp-2"; // e.g. a settings row changed without an event
    await service.resolveTenantStatic("01920000-0000-7000-8000-000000000001");
    expect(calls["l5"]).toBe(2); // re-resolved — a stale entry is never served.
  });

  it("resolve() overlays L6 (actions + branch scope), never caching across principals", async () => {
    const { repository } = fakeRepository();
    const service = new ResolveEffectiveConfigService(repository);
    const principal: PrincipalInput = {
      userId: "u1000000-0000-7000-8000-000000000001",
      roleKey: "cashier",
      permissions: new Set(["pos.sales.sell", "pos.shifts.manage"]),
      branchScope: ["b1000000-0000-7000-8000-000000000001"],
    };
    const config = await service.resolve("01920000-0000-7000-8000-000000000001", principal);
    expect(config.request_overlay).toEqual({
      user_id: "u1000000-0000-7000-8000-000000000001",
      role: "cashier",
      branch_scope: ["BR1"],
      actions: ["pos.sales.sell", "pos.shifts.manage"],
    });
    // A different principal gets a different, separate overlay entry.
    const other = await service.resolve("01920000-0000-7000-8000-000000000001", {
      userId: "u2000000-0000-7000-8000-000000000002",
      roleKey: "owner",
      permissions: ["settings.write"],
      branchScope: null,
    });
    expect(other.request_overlay?.actions).toEqual(["settings.write"]);
    expect(other.request_overlay?.branch_scope).toEqual(["BR1"]);
    expect(resolveCacheSizes().requestOverlays).toBe(2);
  });

  it("membership.updated drops exactly that user's overlay; tenant-static stays", async () => {
    const { repository } = fakeRepository();
    const service = new ResolveEffectiveConfigService(repository);
    const tenantId = "01920000-0000-7000-8000-000000000001";
    await service.resolve(tenantId, {
      userId: "u1000000-0000-7000-8000-000000000001",
      roleKey: "cashier",
      permissions: ["pos.sales.sell"],
      branchScope: null,
    });
    const staticHash = cachedTenantStatic(tenantId, "fp-1")?.resolved_hash;
    expect(staticHash).toBeDefined();
    publishConfigurationEvent({
      type: "membership.updated",
      tenantId,
      userId: "u1000000-0000-7000-8000-000000000001",
    });
    expect(resolveCacheSizes().requestOverlays).toBe(0);
    // The tenant-static cache is untouched by L6 events (§9 last rows).
    expect(cachedTenantStatic(tenantId, "fp-1")?.resolved_hash).toBe(staticHash);
    expect(resolveCacheSizes().tenantStatic).toBe(1);
  });

  it("role.updated sweeps the tenant's overlays (a role change affects all holders)", () => {
    const tenantId = "01920000-0000-7000-8000-000000000001";
    storeRequestOverlay("u1", tenantId, "sha256:x", {
      user_id: "u1",
      role: "cashier",
      branch_scope: [],
      actions: [],
    });
    storeRequestOverlay("u2", tenantId, "sha256:x", {
      user_id: "u2",
      role: "clerk",
      branch_scope: [],
      actions: [],
    });
    publishConfigurationEvent({ type: "role.updated", tenantId, roleId: "r1" });
    expect(resolveCacheSizes().requestOverlays).toBe(0);
    expect(cachedRequestOverlay("u1", tenantId, "sha256:x")).toBeUndefined();
  });

  it("template.applied drops the tenant-static cache; settings.changed drops both caches", async () => {
    const { repository } = fakeRepository();
    const service = new ResolveEffectiveConfigService(repository);
    const tenantId = "01920000-0000-7000-8000-000000000001";
    await service.resolveTenantStatic(tenantId);
    storeTenantSettingsCache(tenantId, {});
    expect(resolveCacheSizes().tenantStatic).toBe(1);

    publishConfigurationEvent({
      type: "template.applied",
      tenantId,
      templateKey: "industry.grocery",
      version: "1.0.0",
    });
    expect(resolveCacheSizes().tenantStatic).toBe(0);
    // §9: template events are NOT full-invalidate — the L5 snapshot stays.
    expect(cachedTenantSettings(tenantId)).toBeDefined();

    await service.resolveTenantStatic(tenantId);
    storeTenantSettingsCache(tenantId, {});
    publishTenancyEvent({
      type: "settings.changed",
      tenantId,
      key: "sales.cash_autopost",
    });
    expect(resolveCacheSizes().tenantStatic).toBe(0);
    expect(cachedTenantSettings(tenantId)).toBeUndefined();
  });

  it("pack.upgraded / module.installed / module.deactivated / policy.changed invalidate tenant-static", () => {
    const tenantId = "01920000-0000-7000-8000-000000000001";
    const events = [
      {
        type: "pack.upgraded",
        tenantId,
        countryCode: "SA",
        fromVersion: "1.0.0-baseline",
        toVersion: "1.1.0",
      },
      { type: "module.installed", tenantId, module: "pos" },
      { type: "module.deactivated", tenantId, module: "pos" },
      { type: "policy.changed", tenantId, scope: "approvals.purchase_order" },
    ] as const;
    for (const event of events) {
      storeTenantStatic(tenantId, "fp", composeTenantStaticConfig(layerInputsFixture({})));
      publishConfigurationEvent(event);
      expect(resolveCacheSizes().tenantStatic).toBe(0);
    }
  });
});
