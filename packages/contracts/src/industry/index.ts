/**
 * @erp/contracts — industry-template manifest contracts (PHASE-015 T3):
 * the zod mirror of the industries/README §3 JSON Schema, the thirteen shipped
 * v1.0.0 template manifests (retail / grocery / restaurant + the PHASE-017
 * automotive / distribution pair + the PHASE-018 food manufacturing
 * template + the PHASE-019 professional services template + the PHASE-032
 * education template + the PHASE-033 agriculture template + the PHASE-030
 * wholesale / electronics pair + the PHASE-031 healthcare commercial
 * shell + the delivery-completion rental & logistics shell), fail-closed
 * parsing, and the deterministic canonical-JSON content hash behind
 * `applied_manifest_hash`.
 */
export {
  DOCUMENT_TYPES,
  INDUSTRY_FEATURE_KEY_PATTERN,
  INDUSTRY_SEMVER_PATTERN,
  INDUSTRY_TEMPLATE_ID_PATTERN,
  MODULE_NAMES,
  IndustryManifestValidationError,
  IndustryTemplateManifestSchema,
  canonicalManifestJson,
  documentNumberingDefaultsSchema,
  featureKeySchema,
  hashManifestJson,
  inventoryPolicyDefaultsSchema,
  localizedTextSchema,
  navigationManifestSchema,
  numberingRuleSchema,
  parseIndustryTemplateManifest,
  terminologyOverridesSchema,
  type CapabilityPrerequisite,
  type DocumentNumberingDefaults,
  type DocumentType,
  type IndustryTemplateManifest,
  type InventoryPolicyDefaults,
  type LocalizedText,
  type ModuleName,
  type NavigationGroup,
  type NavigationItem,
  type NavigationManifest,
  type NumberingRule,
  type OnboardingStep,
  type ReportDefault,
  type TerminologyOverrides,
  type WorkflowPolicyValue,
} from "./manifest";
export {
  AGRICULTURE_TEMPLATE_MANIFEST,
  AUTOMOTIVE_TEMPLATE_MANIFEST,
  DISTRIBUTION_TEMPLATE_MANIFEST,
  EDUCATION_TEMPLATE_MANIFEST,
  ELECTRONICS_TEMPLATE_MANIFEST,
  FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
  GROCERY_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
  RENTAL_LOGISTICS_TEMPLATE_MANIFEST,
  RESTAURANT_MANIFEST,
  RETAIL_MANIFEST,
  SHIPPED_TEMPLATE_MANIFESTS,
  WHOLESALE_TEMPLATE_MANIFEST,
} from "./templates";
