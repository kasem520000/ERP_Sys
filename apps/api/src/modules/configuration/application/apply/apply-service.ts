import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "@erp/domain-core";
import {
  hashManifestJson,
  type IndustryTemplateManifest,
  type NumberingRule,
} from "@erp/contracts";

import { AuditService } from "../../../audit/api/audit";
import { INTAKE_TARGET_PHASE, isPhaseGatedIntakeKey } from "../../domain/feature-catalog";
import {
  ConfigRepository,
  CONFIG_REPOSITORY,
  type IndustryTemplateRegistryRow,
} from "../../infrastructure/config-repository";
import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { publishConfigurationEvent } from "../config-events";
import {
  checkPrerequisites,
  CURRENT_SHIPPED_PHASE,
  phaseNumber,
  TemplatePrerequisitesBlockedError,
  type PrerequisiteCheck,
} from "./prerequisites";
import {
  findAppliedStateRow,
  listSeriesDocTypes,
  parseAppliedOverrides,
  registerSeriesRow,
  upsertAppliedConfig,
  type AppliedOverrides,
  type AppliedStateRow,
  type ChecklistStep,
  type ReportPin,
} from "./applied-state.store";

/**
 * Template application service (PHASE-015 T5; industries/README §4): one
 * idempotent, audited transaction that applies a registry manifest to the
 * ambient tenant — prerequisites first (blocked ⇒ typed error with the
 * missing chain + guidance, NEVER silent), then the additive writes:
 *
 * - upsert `tenant_industry_config` (template key, applied version, the
 *   canonical manifest hash, ACTIVE status, overrides = report pins +
 *   onboarding checklist with phase-gated flags + enabled modules; tenant
 *   terminology additions always preserved);
 * - register the manifest's numbering series as append-only tenant-level
 *   rows (doc types that already carry a series are SKIPPED — R5);
 * - NO tenant_settings writes (L1 defaults flow through the engine merge;
 *   L5 explicit values win by precedence — BR-038 R8);
 * - NO item mutations (inventory_policy_defaults apply to NEWLY created
 *   items only — R3 — and live in the manifest, resolved via the engine);
 * - NO journal/document writes (INV-022: posting is never touched).
 *
 * Then `template.applied` invalidates the caches and the
 * `industry.template.applied` audit event records the before/after diff.
 * Re-apply is idempotent: same template + version ⇒ `{ applied: false,
 * reason: "already-applied" }` with zero writes; a NEWER registry version
 * re-applies additively with the updated hash (archives + conflict notes
 * carried over untouched — an apply never rewrites history).
 */

/** Unknown (or non-ACTIVE) registry template key — fail closed (§4). */
export class TemplateNotFoundError extends DomainError {
  constructor(readonly templateKey: string, reason = "no ACTIVE registry row with this key") {
    super("configuration/template-not-found", `Template "${templateKey}" not found: ${reason}`, {
      templateKey,
      reason,
    });
  }
}

/**
 * apply() on a tenant that already has a DIFFERENT template applied — the
 * additive-only switch flow (BR-038) owns that transition.
 */
export class TemplateAlreadyAppliedError extends DomainError {
  constructor(
    readonly currentTemplateKey: string,
    readonly requestedTemplateKey: string,
  ) {
    super(
      "configuration/template-already-applied",
      `Template "${currentTemplateKey}" is already applied — switching to "${requestedTemplateKey}" ` +
        "goes through the additive switch flow (POST /templates/:key/switch), never a fresh apply",
      { currentTemplateKey, requestedTemplateKey },
    );
  }
}

/** The applied version is NEWER than the registry — registry corruption. */
export class TemplateRegistryBehindError extends DomainError {
  constructor(
    readonly templateKey: string,
    readonly appliedVersion: string,
    readonly registryVersion: string,
  ) {
    super(
      "configuration/template-registry-behind",
      `Applied template "${templateKey}" version ${appliedVersion} is newer than the registry ` +
        `version ${registryVersion} — the registry cannot have shipped less than what a tenant applied`,
      { templateKey, appliedVersion, registryVersion },
    );
  }
}

export interface TemplateApplyInput {
  readonly templateKey: string;
  readonly mode: "initial" | "reapply";
}

export interface TemplateApplyResult {
  readonly applied: boolean;
  readonly reason?: "already-applied";
  readonly templateKey: string;
  readonly version: string;
  readonly manifestHash: string;
  /** Doc types whose series rows were registered by THIS call (R5: append-only). */
  readonly addedSeries: readonly { docType: string; format: string }[];
  readonly prerequisiteCheck: PrerequisiteCheck;
}

// ---------------------------------------------------------------------------
// Pure builders (shared with the switch service — single source of truth)
// ---------------------------------------------------------------------------

/** Materialize §3 report_defaults with the JSON-Schema `dashboard: false` default. */
export function buildReportPins(manifest: IndustryTemplateManifest): readonly ReportPin[] {
  return manifest.report_defaults.map((pin) => ({
    report_key: pin.report_key,
    pinned: pin.pinned,
    dashboard: pin.dashboard ?? false,
    ...(pin.default_period === undefined ? {} : { default_period: pin.default_period }),
  }));
}

/** The first capability (by id order) that carries `featureKey`, if any. */
export function capabilityOfKey(
  manifest: IndustryTemplateManifest,
  featureKey: string,
): { id: string; phase: string } | null {
  for (const id of Object.keys(manifest.capability_prerequisites).sort()) {
    const capability = manifest.capability_prerequisites[id]!;
    if (capability.feature_keys.includes(featureKey)) {
      return { id, phase: capability.available_from_phase };
    }
  }
  return null;
}

/**
 * Build the bilingual onboarding checklist (§4 step A6): manifest steps in
 * order, each classified against the tenant's entitlements + the phase
 * gates — POS-flavored entries render "coming with PHASE-016" (phase_gated)
 * rather than hiding, so back-office onboarding stays complete.
 */
export function buildOnboardingChecklist(
  manifest: IndustryTemplateManifest,
  activeEntitlementKeys: ReadonlySet<string>,
): readonly ChecklistStep[] {
  return manifest.onboarding_steps.map((step) => {
    const base = {
      id: step.id,
      title: step.title,
      required: step.required,
      ...(step.hint === undefined ? {} : { hint: step.hint }),
    };
    if (step.feature_key === undefined) {
      return { ...base, status: "visible" } satisfies ChecklistStep;
    }
    const capability = capabilityOfKey(manifest, step.feature_key);
    if (
      capability !== null &&
      phaseNumber(capability.phase) > phaseNumber(CURRENT_SHIPPED_PHASE)
    ) {
      // The step's owning capability ships with a later phase — label it
      // "coming with PHASE-0NN" even when its key is already granted (the
      // business plan grants pos.* keys today; the POS workflow ships 016).
      return {
        ...base,
        featureKey: step.feature_key,
        status: "phase_gated",
        phase: capability.phase,
      } satisfies ChecklistStep;
    }
    if (isPhaseGatedIntakeKey(step.feature_key)) {
      return {
        ...base,
        featureKey: step.feature_key,
        status: "phase_gated",
        phase: INTAKE_TARGET_PHASE,
      } satisfies ChecklistStep;
    }
    return {
      ...base,
      featureKey: step.feature_key,
      status: activeEntitlementKeys.has(step.feature_key) ? "visible" : "hidden",
    } satisfies ChecklistStep;
  });
}

/** Semver ordering for version strings ("1.2.0" vs "1.10.0" ⇒ -1 | 0 | 1). */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10));
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  if (aMajor !== bMajor) return aMajor! < bMajor! ? -1 : 1;
  if (aMinor !== bMinor) return aMinor! < bMinor! ? -1 : 1;
  if (aPatch !== bPatch) return aPatch! < bPatch! ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export const TEMPLATE_APPLY_SERVICE = Symbol("TEMPLATE_APPLY_SERVICE");

@Injectable()
export class TemplateApplyService {
  constructor(
    @Inject(CONFIG_REPOSITORY) private readonly repository: ConfigRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Load + parse a registry row (fail-closed on unknown/inactive keys). */
  async loadRegistryTemplate(templateKey: string): Promise<IndustryTemplateRegistryRow> {
    const row = await this.repository.findIndustryTemplate(templateKey);
    if (row === undefined) {
      throw new TemplateNotFoundError(templateKey);
    }
    if (!row.isActive || row.status !== "ACTIVE") {
      throw new TemplateNotFoundError(
        templateKey,
        `registry status is ${row.status} (isActive=${row.isActive}) — only ACTIVE templates apply`,
      );
    }
    return row;
  }

  /** The prerequisite check for a manifest against the ambient tenant's entitlements. */
  async prerequisiteCheckOf(manifest: IndustryTemplateManifest): Promise<PrerequisiteCheck> {
    const entitlements = await this.repository.listActiveEntitlements();
    return checkPrerequisites(
      manifest,
      entitlements.map((row) => row.featureKey),
    );
  }

  /**
   * Apply (or idempotently re-apply) a template to the ambient tenant.
   * MUST run inside `withTenant` — the whole apply is one transaction.
   */
  async apply(actorId: string | null, input: TemplateApplyInput): Promise<TemplateApplyResult> {
    const registry = await this.loadRegistryTemplate(input.templateKey);
    const manifestHash = hashManifestJson(registry.manifest);
    const previous = await findAppliedStateRow();

    // Idempotency (§4 "one idempotent transaction"):
    // - same template + version + hash ⇒ a pure no-op (zero writes);
    // - a DIFFERENT template already applied ⇒ the switch flow owns it;
    // - a NEWER registry version ⇒ additive re-apply with the updated hash.
    if (previous !== undefined) {
      if (previous.templateKey !== registry.key) {
        throw new TemplateAlreadyAppliedError(previous.templateKey, registry.key);
      }
      if (previous.appliedVersion === registry.version) {
        if (previous.appliedManifestHash === manifestHash) {
          return {
            applied: false,
            reason: "already-applied",
            templateKey: registry.key,
            version: registry.version,
            manifestHash,
            addedSeries: [],
            prerequisiteCheck: await this.prerequisiteCheckOf(registry.manifest),
          };
        }
        throw new TemplateRegistryBehindError(
          registry.key,
          previous.appliedVersion,
          `${registry.version} (same version, different content — the registry row mutated outside §8 governance)`,
        );
      }
      if (compareVersions(previous.appliedVersion, registry.version) > 0) {
        throw new TemplateRegistryBehindError(
          registry.key,
          previous.appliedVersion,
          registry.version,
        );
      }
    }

    // Prerequisites (§4): blocked ⇒ typed error with the chain — never silent.
    const entitlements = await this.repository.listActiveEntitlements();
    const activeKeys = new Set(entitlements.map((row) => row.featureKey));
    const check = checkPrerequisites(registry.manifest, [...activeKeys]);
    if (check.status === "blocked") {
      throw new TemplatePrerequisitesBlockedError(
        registry.key,
        check.missingChain,
        check.guidance!,
        check.closureViolations,
      );
    }

    // The additive writes. Archives + conflict notes carry over UNCHANGED
    // (an apply/re-apply never rewrites switch history); tenant terminology
    // additions survive (BR-038 R2).
    const previousOverrides =
      previous === undefined ? parseAppliedOverrides(undefined) : parseAppliedOverrides(previous.overrides);
    const overrides: AppliedOverrides = {
      report_pins: buildReportPins(registry.manifest),
      onboarding_checklist: buildOnboardingChecklist(registry.manifest, activeKeys),
      enabled_modules: registry.manifest.default_modules_enabled,
      terminology: previousOverrides.terminology,
      applied_extensions: previousOverrides.applied_extensions,
    };

    // Numbering series (R5 append-only; R7 pack mandates: see the store note).
    const existingDocTypes = new Set(await listSeriesDocTypes());
    const addedSeries: { docType: string; format: string }[] = [];
    for (const [docType, rule] of Object.entries(registry.manifest.document_numbering_defaults)) {
      if (existingDocTypes.has(docType)) {
        continue; // A series already exists for this doc type — never mutate.
      }
      await registerSeriesRow(docType, rule as NumberingRule);
      addedSeries.push({ docType, format: rule.format });
    }

    await upsertAppliedConfig({
      templateKey: registry.key,
      appliedVersion: registry.version,
      appliedManifestHash: manifestHash,
      appliedBy: actorId,
      status: "ACTIVE",
      overrides,
      archivedTerminology: previous?.archivedTerminology ?? [],
      archivedNavigation: previous?.archivedNavigation ?? [],
      archivedCapabilities: previous?.archivedCapabilities ?? [],
      conflictNotes: previous?.conflictNotes ?? [],
    });

    // Audit (§2 item 11): before/after diff; the correlation id flows from
    // the request scope through the store.
    await this.audit.record({
      action: "industry.template.applied",
      entityType: "tenant_industry_config",
      entityId: requireTenantContext().tenantId, // audit entityId is a uuid column — the one-row-per-tenant owner
      actorId: actorId ?? undefined,
      before:
        previous === undefined
          ? null
          : {
              templateKey: previous.templateKey,
              appliedVersion: previous.appliedVersion,
              appliedManifestHash: previous.appliedManifestHash,
              status: previous.status,
            },
      after: {
        templateKey: registry.key,
        appliedVersion: registry.version,
        appliedManifestHash: manifestHash,
        status: "ACTIVE",
        mode: input.mode,
        addedSeries,
        overrides,
      },
    });

    // §9 invalidation: the tenant-static cache drops on template.applied.
    publishConfigurationEvent({
      type: "template.applied",
      tenantId: requireTenantContext().tenantId,
      templateKey: registry.key,
      version: registry.version,
    });

    return {
      applied: true,
      templateKey: registry.key,
      version: registry.version,
      manifestHash,
      addedSeries,
      prerequisiteCheck: check,
    };
  }
}

/** Re-exported for the switch service + specs (single import point). */
export type { AppliedStateRow };
