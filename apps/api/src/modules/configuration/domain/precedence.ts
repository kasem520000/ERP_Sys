import { DomainError } from "@erp/domain-core";
import type { DocumentType, WorkflowPolicyValue } from "@erp/contracts";

import { closureViolations } from "./feature-catalog";
import type {
  BranchDefaults,
  L1TemplateLayer,
  L4EntitlementLayer,
  L5SettingsLayer,
  L7BranchLayer,
  L10PolicyLayer,
} from "./layer-model";
import { POLICY_REGISTRY, UnknownPolicyKeyError, parsePolicyValue } from "./policy-registry";
import { SETTINGS_REGISTRY, UnknownSettingKeyError } from "./settings-schema";

/**
 * The merge engine (CONFIGURATION_ENGINE §3 precedence table) — pure,
 * deterministic functions. `>` means "wins for that value class":
 *
 * | Value class       | Precedence                                        |
 * |-------------------|---------------------------------------------------|
 * | Policy values     | L10 > L5 > L1 (template default) > platform default |
 * | Numbering series  | L7 (branch) > L5 (tenant) > L1 default            |
 * | Tax rates/treatments | L2 ONLY — any other layer attempting to set one is a typed error |
 * | Feature availability | L4 only (the config reports, never grants)      |
 * | Terminology/menus | L1 > platform glossary; visibility pruned by L4/L8/L6 |
 *
 * Same inputs ⇒ same output (§1 principle 2): every function sorts or
 * preserves already-sorted collections and never reads the clock, the DB,
 * or any ambient state.
 */

// ---------------------------------------------------------------------------
// L2-only tax ownership (§3 + §6 rule 3: jurisdiction pack values are
// read-only to tenants)
// ---------------------------------------------------------------------------

/**
 * Key namespaces owned exclusively by L2 (ADR-0010): rates, treatments, and
 * invoice legal fields. The L5 settings registry has no tax-rate keys — this
 * guard makes any attempt to smuggle one through ANY tenant-layer input a
 * typed failure instead of a silent merge.
 */
const L2_ONLY_TAX_KEY = /^tax\.(rate|rates|treatment|treatments)(\.|$)/;

/** A non-L2 layer attempted to set a jurisdiction-pack-owned value. */
export class TaxLayerViolationError extends DomainError {
  constructor(readonly layer: string, readonly key: string) {
    super(
      "configuration/tax-layer-violation",
      `Layer ${layer} may not set "${key}": tax rates/treatments are L2-only (ADR-0010; CONFIGURATION_ENGINE §3, §6 rule 3)`,
      { layer, key },
    );
  }
}

/** Reject L2-owned keys appearing in a tenant-controlled layer (fail closed). */
export function assertL2TaxOwnership(layer: string, keys: Iterable<string>): void {
  for (const key of keys) {
    if (L2_ONLY_TAX_KEY.test(key)) {
      throw new TaxLayerViolationError(layer, key);
    }
  }
}

// ---------------------------------------------------------------------------
// Effective settings + policy merge (L10 > L5 > L1 > platform default)
// ---------------------------------------------------------------------------

/**
 * L1 template defaults expressed on the SETTINGS_REGISTRY surface: each
 * workflow_policies entry maps (via POLICY_REGISTRY.settingsKey) onto its
 * settings key, plus the single inventory-defaults mapping (fefo_picking →
 * inventory.fefo_for_expiry_items — industries/README §3 note). Defaults
 * apply ONLY for keys the tenant has not explicitly set (BR-038).
 */
export function templateSettingDefaults(l1: L1TemplateLayer): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [policyKey, rawValue] of Object.entries(l1.manifest.workflow_policies)) {
    // Fail closed: unknown policy keys and type violations never merge.
    const value = parsePolicyValue(policyKey, rawValue);
    const definition = POLICY_REGISTRY[policyKey]!;
    const targetKey = definition.settingsKey ?? policyKey;
    defaults[targetKey] = value;
  }
  defaults["inventory.fefo_for_expiry_items"] = l1.manifest.inventory_policy_defaults.fefo_picking;
  return defaults;
}

/**
 * The effective settings map: SETTINGS_REGISTRY defaults, refined by L1
 * template defaults, refined by explicit L5 rows. Unknown L5 keys and
 * L2-namespace smuggling are typed failures (never silently dropped).
 */
export function effectiveSettings(
  l1: L1TemplateLayer | null,
  l5: L5SettingsLayer,
): Record<string, unknown> {
  // §3 step 2 defense: the loader validates rows, the merge re-asserts.
  assertL2TaxOwnership("L5", Object.keys(l5.entries));
  const templateDefaults = l1 === null ? {} : templateSettingDefaults(l1);
  const merged: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(SETTINGS_REGISTRY)) {
    merged[key] = definition.default;
  }
  for (const [key, value] of Object.entries(templateDefaults)) {
    if (key in l5.entries) {
      continue; // BR-038: a tenant's explicit setting always survives.
    }
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(l5.entries)) {
    if (!(key in SETTINGS_REGISTRY)) {
      throw new UnknownSettingKeyError(key);
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * The merged policy map (§5 `policies`): effective settings values + the
 * POLICY_REGISTRY keys that carry no settings mapping + L10 approval
 * policies. Numbering assign_at keys land here too (mergeNumbering).
 */
export function mergePolicies(
  l1: L1TemplateLayer | null,
  l5: L5SettingsLayer,
  l10: L10PolicyLayer,
): Record<string, WorkflowPolicyValue> {
  const settings = effectiveSettings(l1, l5);
  const policies: Record<string, WorkflowPolicyValue> = {};
  // Settings-surface keys (typed values, schema-validated upstream). The
  // §5 policy map is FLAT and scalar: structured settings (numbering.defaults
  // as an object, the onboarding journey state, the jurisdiction binding)
  // surface through their derived policy keys (numbering.<dt>.assign_at)
  // and the L5 snapshot — never as opaque objects here; unset (null) keys
  // are omitted, exactly like a null approval threshold.
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      policies[key] = value;
    }
  }
  // Registry-only workflow keys (no SETTINGS_REGISTRY mapping) keep their
  // policy-key name; L1 already provided their default through
  // templateSettingDefaults' targetKey = policyKey path above.
  // L10 approval policies sit ABOVE L5 (§3 precedence) — written last.
  for (const row of l10.approvals) {
    assertL2TaxOwnership("L10", [`approvals.${row.docType}`]);
    if (!/^[a-z][a-z0-9_]*$/.test(row.docType)) {
      throw new DomainError(
        "configuration/invalid-policy-doc-type",
        `Approval policy docType "${row.docType}" is not lower_snake_case (BR-034 policy key shape)`,
        { docType: row.docType },
      );
    }
    policies[`approvals.${row.docType}.mode`] = row.mode;
    // null threshold = no threshold (BR-010 default) — the key is absent,
    // never null-valued (§5 policies carry string | number | boolean).
    if (row.threshold !== null) {
      policies[`approvals.${row.docType}.threshold`] = row.threshold;
    }
    policies[`approvals.${row.docType}.allow_self_approval`] = row.allowSelfApproval;
  }
  return policies;
}

// ---------------------------------------------------------------------------
// Numbering merge (L7 > L5 > L1 default)
// ---------------------------------------------------------------------------

export interface MergedNumbering {
  /** docType → assign_at (L5 tenant default > L1 reserve_on_approval > posting). */
  readonly assignAt: Readonly<Record<string, "approval" | "posting">>;
  /** L1 proposed series, verbatim (tenant-level view; ADR-0006 immutability). */
  readonly tenantSeries: Readonly<Record<string, unknown>>;
  /** branch code → docType → resolved format (L7 sequence > L1 default). */
  readonly branchDefaults: Readonly<Record<string, BranchDefaults>>;
}

const POSTING: "approval" | "posting" = "posting";

/**
 * Merge numbering (§3 "Numbering series: L7 (branch) > L5 (tenant) > L1
 * default"): per-branch formats come from the branch sequence rows, falling
 * back to the template's proposed series; assign_at comes from the tenant's
 * numbering.defaults setting (L5), falling back to the template's
 * reserve_on_approval posture (L1), falling back to posting (platform
 * default, BR-029).
 */
export function mergeNumbering(
  l1: L1TemplateLayer | null,
  l5: L5SettingsLayer,
  l7: L7BranchLayer,
): MergedNumbering {
  // L5 wins only when the tenant EXPLICITLY set numbering.defaults — the
  // registry default ("posting") is the platform rung, below the L1
  // reserve_on_approval posture (§3 precedence; BR-029).
  const explicitL5 = l5.entries["numbering.defaults"] as { assign_at?: unknown } | undefined;
  const tenantAssignAt =
    explicitL5 !== null &&
    explicitL5 !== undefined &&
    typeof explicitL5 === "object" &&
    (explicitL5.assign_at === "approval" || explicitL5.assign_at === "posting")
      ? explicitL5.assign_at
      : undefined;

  const templateSeries = l1 === null ? {} : { ...l1.manifest.document_numbering_defaults };
  const docTypes = new Set<string>([...Object.keys(templateSeries)]);
  for (const branch of Object.values(l7.branches)) {
    for (const docType of Object.keys(branch.seriesFormats)) {
      docTypes.add(docType);
    }
  }

  const assignAt: Record<string, "approval" | "posting"> = {};
  for (const docType of [...docTypes].sort()) {
    const rule = templateSeries[docType as DocumentType];
    assignAt[docType] =
      tenantAssignAt ?? (rule !== undefined && rule.reserve_on_approval ? "approval" : POSTING);
  }

  const branchDefaults: Record<string, BranchDefaults> = {};
  for (const [code, branch] of Object.entries(l7.branches).sort(([a], [b]) => a.localeCompare(b))) {
    const series: Record<string, string> = {};
    for (const docType of [...docTypes].sort()) {
      const branchFormat = branch.seriesFormats[docType];
      const templateRule = templateSeries[docType as DocumentType];
      if (branchFormat !== undefined) {
        series[docType] = branchFormat; // L7 wins.
      } else if (templateRule !== undefined) {
        series[docType] = templateRule.format; // L1 default.
      }
    }
    branchDefaults[code] = {
      numbering_series: series,
      // Branch-scoped warehouse/cash defaults have no backing columns yet
      // (branch editor ships them with later phases) — the layer is neutral.
      default_warehouse: null,
      cash_account: null,
    };
  }
  return { assignAt, tenantSeries: templateSeries, branchDefaults };
}

// ---------------------------------------------------------------------------
// Feature availability (L4 only — the config reports, never grants)
// ---------------------------------------------------------------------------

/** A non-L4 input attempted to influence feature availability. */
export class EntitlementGrantViolationError extends DomainError {
  constructor(readonly layer: string) {
    super(
      "configuration/entitlement-grant-violation",
      `Layer ${layer} may not grant or revoke features: L4 entitlements are the only source of feature truth (CONFIGURATION_ENGINE §3, §6 rule 5)`,
      { layer },
    );
  }
}

/**
 * The §5 l4_entitlements block: active keys + sources + the applied
 * template's required-but-inactive keys (the degraded set the UI explains
 * with the upgrade path). BR-040 closure is asserted — violations are a
 * typed failure (apply-time checks make them impossible in practice).
 */
export function resolveFeatureAvailability(
  l1: L1TemplateLayer | null,
  l4: L4EntitlementLayer,
): {
  active: readonly string[];
  missing: readonly string[];
  sources: Readonly<Record<string, string>>;
} {
  const violations = closureViolations(l4.active);
  if (violations.length > 0) {
    throw new DomainError(
      "configuration/dependency-closure-violated",
      `Active entitlements violate BR-040 dependency closure: ${violations
        .map((v) => `${v.featureKey} missing [${v.missing.join(", ")}]`)
        .join("; ")}`,
      { violations },
    );
  }
  const activeSet = new Set(l4.active);
  const required = l1 === null ? [] : l1.manifest.required_feature_keys;
  const missing = required.filter((key) => !activeSet.has(key)).sort();
  return { active: [...l4.active].sort(), missing, sources: l4.sources };
}

// ---------------------------------------------------------------------------
// Installed modules (L8: rollout flags only — never tenant policy)
// ---------------------------------------------------------------------------

/**
 * The §5 l8_installed block. The universe is the always-present core modules
 * ∪ the applied template's default_modules_enabled ∪ the modules of the
 * active entitlement keys; each maps to `true` unless a platform feature
 * flag disables it. A missing flag row means enabled-by-entitlement only —
 * L4 stays the single source of feature truth (§6 rule 5).
 */
export function resolveInstalledModules(
  l1: L1TemplateLayer | null,
  l4: L4EntitlementLayer,
  flagEnabled: (module: string) => boolean | undefined,
): Record<string, boolean> {
  const universe = new Set<string>(CORE_MODULES);
  if (l1 !== null) {
    for (const module of l1.manifest.default_modules_enabled) {
      universe.add(module);
    }
  }
  for (const key of l4.active) {
    const dot = key.indexOf(".");
    if (dot > 0) {
      universe.add(key.slice(0, dot));
    }
  }
  const installed: Record<string, boolean> = {};
  for (const module of [...universe].sort()) {
    installed[module] = flagEnabled(module) ?? true;
  }
  return installed;
}

/**
 * The always-present runtime modules (MODULE_BOUNDARIES core): the platform
 * tenancy/configuration spine every tenant runs on.
 */
export const CORE_MODULES: readonly string[] = Object.freeze([
  "accounting",
  "configuration",
  "inventory",
  "items",
  "partners",
  "purchasing",
  "reporting",
  "sales",
  "tax",
  "treasury",
]);

// Re-exported for the composed validation pass (single import point).
export { UnknownPolicyKeyError };
