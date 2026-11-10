import { hashManifestJson } from "@erp/contracts";

import {
  ConfigurationResolutionError,
  validateL1RequiredKeys,
  validateL2Layer,
  validateMergedPolicies,
} from "../../domain/effective-config";
import {
  INVARIANTS_NOTE,
  type EffectiveLayers,
  type LayerInputs,
  type TenantStaticConfig,
} from "../../domain/layer-model";
import {
  mergeNumbering,
  mergePolicies,
  resolveFeatureAvailability,
  resolveInstalledModules,
} from "../../domain/precedence";
import { contentHash } from "../../domain/hashing";

import { deriveEmphasis, deriveNavigation, navigationSummary } from "./derivation";
import { GLOSSARY_DEFAULTS, resolveTerminology } from "./terminology";

/**
 * Pure composition of the tenant-static effective config (§3 steps 1–3 +
 * L9 derivation + hashing): merge the ten layer inputs per the precedence
 * table, validate the merged result fail-closed, derive the UI layer, and
 * hash the tenant-static portion. Deterministic: identical inputs ⇒
 * identical output ⇒ identical `resolved_hash`.
 */

/**
 * Build the tenant-static config from validated layer inputs. Throws a
 * typed ConfigurationResolutionError on any validation failure — a
 * partially-resolved config never escapes (§6 rule 6). Any underlying
 * typed domain error (unknown settings/policy key, tax-layer violation,
 * terminology corruption…) is wrapped with its cause preserved.
 */
export function composeTenantStaticConfig(inputs: LayerInputs): TenantStaticConfig {
  try {
    return composeUnsafe(inputs);
  } catch (error) {
    if (error instanceof ConfigurationResolutionError) {
      throw error;
    }
    throw new ConfigurationResolutionError(
      "merged",
      `the merged result failed validation: ${(error as Error).message}`,
      error,
    );
  }
}

function composeUnsafe(inputs: LayerInputs): TenantStaticConfig {
  // §3 step 2 at the layer boundaries, then the merged-result backstop.
  if (inputs.l1 !== null) {
    validateL1RequiredKeys(inputs.l1);
  }
  if (inputs.l2 !== null) {
    validateL2Layer(inputs.l2);
  }

  // L4: feature availability is reported, never granted; BR-040 closure is
  // asserted (apply-time checks make violations impossible in practice).
  const entitlements = resolveFeatureAvailability(inputs.l1, inputs.l4);

  // L8: rollout flags only — a missing flag row means enabled-by-entitlement.
  const installed = resolveInstalledModules(
    inputs.l1,
    { active: entitlements.active, sources: entitlements.sources },
    (module) => inputs.l8.modules[module],
  );

  // Policy values: L10 > L5 > L1 > platform default; numbering assign_at:
  // L5 > L1 reserve_on_approval > posting; branch series: L7 > L1.
  const policies = mergePolicies(inputs.l1, inputs.l5, inputs.l10);
  const numbering = mergeNumbering(inputs.l1, inputs.l5, inputs.l7);
  for (const [docType, assignAt] of Object.entries(numbering.assignAt)) {
    policies[`numbering.${docType}.assign_at`] = assignAt;
  }
  validateMergedPolicies(policies);

  // L9 derivation (navigation/emphasis/terminology — derived only).
  const navGroups = deriveNavigation({
    template: inputs.l1,
    activeEntitlements: new Set(entitlements.active),
    installedModules: installed,
  });
  const terminology = resolveTerminology({
    glossary: GLOSSARY_DEFAULTS,
    template: inputs.l1 === null ? undefined : inputs.l1.manifest.terminology_overrides,
    tenantAdditions: inputs.l1 === null ? undefined : inputs.l1.tenantTerminology,
  });

  const layers: EffectiveLayers = {
    l1_template:
      inputs.l1 === null
        ? null
        : {
            key: inputs.l1.key,
            version: inputs.l1.version,
            terminology_overrides: Object.keys(inputs.l1.manifest.terminology_overrides).length,
          },
    l2_jurisdiction_pack:
      inputs.l2 === null
        ? null
        : {
            country_code: inputs.l2.countryCode,
            pack_version: inputs.l2.packVersion,
            vat_status: inputs.l2.vatStatus,
            tenant_registration: inputs.l2.tenantRegistration,
          },
    l3_plan:
      inputs.l3 === null
        ? null
        : { key: inputs.l3.planKey, limits: inputs.l3.limits },
    l4_entitlements: {
      active: entitlements.active,
      missing: entitlements.missing,
      sources: entitlements.sources,
    },
    l7_branch_defaults: numbering.branchDefaults,
    l8_installed: installed,
  };

  const tenant = {
    id: inputs.tenantId,
    industry_template: inputs.l1 === null ? inputs.industryTemplatePreference : inputs.l1.key,
    jurisdiction: inputs.countryCode,
    base_currency: inputs.baseCurrency,
  };
  const ui = {
    navigation: navigationSummary(navGroups),
    navigation_tree: navGroups,
    emphasis: deriveEmphasis(inputs.l1, navGroups),
    terminology,
  };

  // §5: the tenant-static portion is what is hashed (request_overlay never
  // participates). The hash covers everything except itself.
  const resolved_hash = contentHash({
    config_version: 3,
    tenant,
    layers,
    policies,
    ui,
    invariants_note: INVARIANTS_NOTE,
  });

  return {
    config_version: 3,
    resolved_hash,
    tenant,
    layers,
    policies,
    ui,
    invariants_note: INVARIANTS_NOTE,
  };
}

/** Content hash of a resolved manifest (drift vs applied_manifest_hash). */
export function resolvedManifestHash(manifest: Parameters<typeof hashManifestJson>[0]): string {
  return hashManifestJson(manifest);
}

/** Re-exported for the service + specs (single import point). */
export { ConfigurationResolutionError };
