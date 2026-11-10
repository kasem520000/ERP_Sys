/**
 * Public surface of the configuration module (DEPENDENCY_RULES §1 `api/`):
 * the PHASE-004 skeleton — feature catalog + closure validation (BR-040),
 * the settings key registry (L5 typed keys), the industry-template
 * registry contract, and the in-process event bus (§9 cache
 * invalidation) — plus the PHASE-015 ten-layer resolution engine: layer
 * model + policy registry + precedence merge + fail-closed validation +
 * the resolve service, caches, L9 derivation, and terminology runtime.
 *
 * PHASE-015 T5–T7 add the template machinery: the activity→template
 * catalog + prerequisite/phase-gate/closure check + the idempotent
 * audited apply service, the additive-only switch/extend service
 * (BR-038) with its R9 preview-diff contract, and the registry drift
 * service (upgrade offers through the notifications inbox).
 */
export {
  FEATURE_DEPS,
  FEATURE_KEYS,
  PHASE_GATED_INTAKE_KEYS,
  INTAKE_TARGET_PHASE,
  closureViolations,
  isKnownFeatureKey,
  isPhaseGatedIntakeKey,
  missingClosure,
} from "../domain/feature-catalog";
export {
  InvalidSettingValueError,
  SETTING_KEYS,
  SETTINGS_REGISTRY,
  UnknownSettingKeyError,
  parseSettingValue,
  validateTaxRegistrationPair,
  type SettingDefinition,
} from "../domain/settings-schema";
export {
  cachedTenantSettings,
  invalidateTenantConfig,
  onConfigurationEvent,
  onTenancyEvent,
  publishConfigurationEvent,
  publishTenancyEvent,
  resetConfigurationCache,
  storeTenantSettingsCache,
  type ConfigurationLifecycleEvent,
  type TenancyEvent,
} from "../application/config-events";
// PHASE-015 T1 — the resolution engine.
export {
  canonicalJson,
  canonicalize,
  contentHash,
} from "../domain/hashing";
export {
  ConfigurationResolutionError,
  validateL1RequiredKeys,
  validateL2Layer,
  validateMergedPolicies,
} from "../domain/effective-config";
export type {
  BranchDefaults,
  DerivedNavGroup,
  DerivedNavItem,
  EffectiveConfig,
  EffectiveLayers,
  L1TemplateLayer,
  L10ApprovalPolicy,
  L10PolicyLayer,
  L2JurisdictionLayer,
  L3PlanLayer,
  L4EntitlementLayer,
  L5SettingsLayer,
  L7BranchLayer,
  L8InstalledLayer,
  LayerInputs,
  RequestOverlay,
  TenantStaticConfig,
} from "../domain/layer-model";
export {
  POLICY_KEYS,
  POLICY_REGISTRY,
  InvalidPolicyValueError,
  UnknownPolicyKeyError,
  isKnownPolicyKey,
  parsePolicyValue,
  type PolicyDefinition,
  type PolicyValueType,
} from "../domain/policy-registry";
export {
  CORE_MODULES,
  EntitlementGrantViolationError,
  TaxLayerViolationError,
  assertL2TaxOwnership,
  effectiveSettings,
  mergeNumbering,
  mergePolicies,
  resolveFeatureAvailability,
  resolveInstalledModules,
  templateSettingDefaults,
} from "../domain/precedence";
export { composeTenantStaticConfig } from "../application/resolve/compose";
export {
  ResolveEffectiveConfigService,
  RESOLVE_EFFECTIVE_CONFIG_SERVICE,
  type PrincipalInput,
} from "../application/resolve/resolve-service";
export {
  cachedTenantStatic,
  cachedRequestOverlay,
  dropRequestOverlay,
  dropRequestOverlaysForTenant,
  invalidateTenantStaticConfig,
  resolveCacheSizes,
  resetResolveCaches,
  storeTenantStatic,
  storeRequestOverlay,
} from "../application/resolve/cache";
export {
  DEFAULT_NAVIGATION,
  deriveEmphasis,
  deriveNavigation,
  navigationSummary,
  type NavigationDerivationInput,
} from "../application/resolve/derivation";
export {
  GLOSSARY_DEFAULTS,
  InvalidTerminologyError,
  parseTerminologyMap,
  resolveTerminology,
  type TerminologyInput,
} from "../application/resolve/terminology";
export {
  ConfigRepository,
  CONFIG_REPOSITORY,
} from "../infrastructure/config-repository";
// PHASE-015 T5 — the template application service.
export {
  TemplateApplyService,
  TEMPLATE_APPLY_SERVICE,
  TemplateNotFoundError,
  TemplateAlreadyAppliedError,
  TemplateRegistryBehindError,
  buildOnboardingChecklist,
  buildReportPins,
  compareVersions,
  type TemplateApplyInput,
  type TemplateApplyResult,
} from "../application/apply/apply-service";
export {
  SUPPORTED_ACTIVITIES,
  resolveTemplateForActivity,
  type ActivityCatalogEntry,
} from "../application/apply/activity-mapping";
export {
  CURRENT_SHIPPED_PHASE,
  TemplatePrerequisitesBlockedError,
  checkPrerequisites,
  phaseNumber,
  type PrerequisiteCapabilityState,
  type PrerequisiteCapabilityStatus,
  type PrerequisiteCheck,
  type PrerequisiteClosureViolation,
} from "../application/apply/prerequisites";
export {
  findAppliedStateRow,
  parseAppliedOverrides,
  type AppliedExtension,
  type AppliedOverrides,
  type AppliedStateRow,
  type ArchivedCapabilitySnapshot,
  type ArchivedNavigationSnapshot,
  type ArchivedTerminologySnapshot,
  type ChecklistStep,
  type ConflictNote,
  type ReportPin,
} from "../application/apply/applied-state.store";
// PHASE-015 T6 — additive-only switching (BR-038).
export {
  TemplateSwitchService,
  TEMPLATE_SWITCH_SERVICE,
  TemplateNotAppliedError,
  TemplateSwitchAcknowledgementRequiredError,
  buildSwitchDiff,
  type CapabilityDiffEntry,
  type InventoryDefaultChange,
  type NumberingSeriesEntry,
  type RenamedLabelEntry,
  type TemplateSwitchPreview,
  type TemplateSwitchResult,
  type WorkflowPolicyChange,
} from "../application/switch/switch-service";
// PHASE-015 T7 — registry drift + upgrade offers (BR-040 machinery).
export {
  TEMPLATE_DRIFT_SERVICE,
  TEMPLATES_ADMIN_URL,
  TemplateDriftService,
  driftKind,
  type DriftCheckResult,
  type DriftKind,
} from "../application/closure/drift-service";
