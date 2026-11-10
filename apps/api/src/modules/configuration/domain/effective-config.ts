import { DomainError } from "@erp/domain-core";
import type { WorkflowPolicyValue } from "@erp/contracts";

import { DOCUMENT_TYPES } from "@erp/contracts";

import {
  INTAKE_TARGET_PHASE,
  isKnownFeatureKey,
  isPhaseGatedIntakeKey,
} from "./feature-catalog";
import type { L1TemplateLayer, L2JurisdictionLayer } from "./layer-model";
import { POLICY_KEYS, parsePolicyValue } from "./policy-registry";
import { SETTINGS_REGISTRY, parseSettingValue } from "./settings-schema";

/**
 * Fail-closed validation of the MERGED result (CONFIGURATION_ENGINE §3 step
 * 2, §6 rule 6): unknown keys, type violations, or out-of-range values fail
 * resolution LOUDLY — resolution never silently drops keys, and a
 * partially-resolved config must never escape: the resolver either returns a
 * fully-valid config or throws.
 */

/**
 * The engine's typed failure: a layer could not load or the merged result
 * failed validation. Carries the offending layer name + cause (§6 rule 6
 * "the request receives a typed configuration error rather than a
 * partially-defaulted config").
 */
export class ConfigurationResolutionError extends DomainError {
  constructor(
    readonly layer: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super("configuration/resolution-failed", `L${layer}: ${message}`, { layer });
  }
}

/** Numbering policy key family: numbering.<doctype>.assign_at (§4). */
const NUMBERING_ASSIGN_AT = /^numbering\.([a-z][a-z0-9_]*)\.assign_at$/;
/** Approval policy key family: approvals.<doctype>.{mode|threshold|allow_self_approval} (§4, BR-034). */
const APPROVALS_KEY = /^approvals\.([a-z][a-z0-9_]*)\.(mode|threshold|allow_self_approval)$/;

/**
 * Validate every key in the merged policy map against the closed key
 * universe (§4): SETTINGS_REGISTRY ∪ POLICY_REGISTRY ∪ the numbering
 * assign_at family ∪ the approvals family. Values are re-validated against
 * their schema — a smuggled type violation is a typed failure, never a
 * silent drop.
 */
export function validateMergedPolicies(
  policies: Readonly<Record<string, WorkflowPolicyValue>>,
): void {
  for (const [key, value] of Object.entries(policies)) {
    if (Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key)) {
      // Re-validate (the loader already did; §3 step 2 is the backstop).
      try {
        parseSettingValue(key, value);
      } catch (error) {
        throw new ConfigurationResolutionError("merged", (error as Error).message, error);
      }
      continue;
    }
    if (POLICY_KEYS.includes(key)) {
      try {
        parsePolicyValue(key, value);
      } catch (error) {
        throw new ConfigurationResolutionError("merged", (error as Error).message, error);
      }
      continue;
    }
    const numbering = NUMBERING_ASSIGN_AT.exec(key);
    if (numbering !== null) {
      const docType = numbering[1]!;
      if (!(DOCUMENT_TYPES as readonly string[]).includes(docType)) {
        throw new ConfigurationResolutionError(
          "merged",
          `numbering policy references unknown document type "${docType}" (allowed: the ${DOCUMENT_TYPES.length} series-bearing types)`,
        );
      }
      if (value !== "approval" && value !== "posting") {
        throw new ConfigurationResolutionError(
          "merged",
          `numbering.${docType}.assign_at must be "approval" | "posting" (BR-029), got ${JSON.stringify(value)}`,
        );
      }
      continue;
    }
    const approval = APPROVALS_KEY.exec(key);
    if (approval !== null) {
      const docType = approval[1]!;
      const field = approval[2]!;
      if (!(DOCUMENT_TYPES as readonly string[]).includes(docType)) {
        throw new ConfigurationResolutionError(
          "merged",
          `approval policy references unknown document type "${docType}"`,
        );
      }
      if (field === "mode" && typeof value !== "string") {
        throw new ConfigurationResolutionError(
          "merged",
          `approvals.${docType}.mode must be a string (BR-034 modes), got ${typeof value}`,
        );
      }
      if (field === "threshold" && typeof value !== "string" && typeof value !== "number") {
        throw new ConfigurationResolutionError(
          "merged",
          `approvals.${docType}.threshold must be a decimal value (base currency), got ${typeof value}`,
        );
      }
      if (field === "allow_self_approval" && typeof value !== "boolean") {
        throw new ConfigurationResolutionError(
          "merged",
          `approvals.${docType}.allow_self_approval must be boolean (BR-034), got ${typeof value}`,
        );
      }
      continue;
    }
    throw new ConfigurationResolutionError(
      "merged",
      `unknown policy key "${key}" reached the merged result — keys must be registered (CONFIGURATION_ENGINE §4) or namespaced (numbering/approvals)`,
    );
  }
}

/**
 * L1 validation (§3 step 2 at the layer boundary): the applied manifest's
 * required_feature_keys must resolve in the feature catalog OR the declared
 * intake set (CAPABILITY_MATRIX §3) — anything else is registry drift and
 * fails closed (PHASE-015 §6 `industry-manifests.spec` contract).
 */
export function validateL1RequiredKeys(l1: L1TemplateLayer): void {
  for (const key of l1.manifest.required_feature_keys) {
    if (!isKnownFeatureKey(key) && !isPhaseGatedIntakeKey(key)) {
      throw new ConfigurationResolutionError(
        "1",
        `template ${l1.key} requires unknown feature key "${key}" — neither in FEATURE_CATALOG nor the CAPABILITY_MATRIX §3 intake set (${INTAKE_TARGET_PHASE})`,
      );
    }
  }
}

/**
 * L2 validation: the jurisdiction block must be well-formed (corruption
 * fails closed; pack values are facts, never defaults).
 */
export function validateL2Layer(l2: L2JurisdictionLayer): void {
  if (!/^[A-Z]{2}$/.test(l2.countryCode)) {
    throw new ConfigurationResolutionError(
      "2",
      `jurisdiction country code "${l2.countryCode}" is not ISO-3166 alpha-2`,
    );
  }
  if (l2.packVersion.length === 0) {
    throw new ConfigurationResolutionError("2", "jurisdiction pack version is empty");
  }
  if (l2.vatStatus.length === 0) {
    throw new ConfigurationResolutionError("2", "jurisdiction VAT status is empty");
  }
  if (
    l2.tenantRegistration !== "REGISTERED" &&
    l2.tenantRegistration !== "NOT_REGISTERED" &&
    l2.tenantRegistration !== "DEREGISTERED"
  ) {
    throw new ConfigurationResolutionError(
      "2",
      `tenant registration status "${l2.tenantRegistration}" is not one of REGISTERED | NOT_REGISTERED | DEREGISTERED`,
    );
  }
}
