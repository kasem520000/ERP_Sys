import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "@erp/domain-core";
import {
  hashManifestJson,
  type IndustryTemplateManifest,
  type LocalizedText,
  type NumberingRule,
  type WorkflowPolicyValue,
} from "@erp/contracts";

import { AuditService } from "../../../audit/api/audit";
import { ConfigRepository, CONFIG_REPOSITORY } from "../../infrastructure/config-repository";
import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { publishConfigurationEvent } from "../config-events";
import { GLOSSARY_DEFAULTS, resolveTerminology } from "../resolve/terminology";
import {
  buildOnboardingChecklist,
  buildReportPins,
  TemplateNotFoundError,
  compareVersions,
} from "../apply/apply-service";
import {
  checkPrerequisites,
  TemplatePrerequisitesBlockedError,
  type PrerequisiteCheck,
} from "../apply/prerequisites";
import {
  findAppliedStateRow,
  listSeriesDocTypes,
  parseAppliedOverrides,
  registerSeriesRow,
  upsertAppliedConfig,
  type AppliedOverrides,
  type AppliedStateRow,
  type ConflictNote,
} from "../apply/applied-state.store";

/**
 * Additive-only template switching (PHASE-015 T6; BR-038; industries/README
 * §5 rules R1–R10, §7 conflict rules, §8 #5 switch safety): switch/extend
 * may ADD menus, defaults, terminology, policies, series, pins — and may
 * NEVER delete tenant data, remove a tenant's explicit setting, change
 * accounts/purposes, or renumber documents (R5: posted numbers immutable —
 * nothing here touches journals, documents, or tenant_settings).
 *
 * - `preview` (R9): the "what will change" diff — NO writes.
 * - `switch`: archives the current template's terminology + navigation +
 *   capabilities (read-only history, R2/R6), swaps the primary template,
 *   records multi-template conflicts (most-recently-applied wins for UNSET
 *   keys only — explicit L5 values always survive), appends new numbering
 *   series, publishes `template.switched`, and audits
 *   `industry.template.switched` with the FULL diff as the after-state.
 * - `extend`: applies a second template additively — the PRIMARY
 *   template_key stays (the engine's L1 resolves one manifest); the
 *   extension's series/pins/checklist/terminology merge additively, its
 *   differing policy values are recorded as conflicts (primary stays
 *   effective), and the extension is recorded in
 *   `overrides.applied_extensions`.
 *
 * Switching back always succeeds: nothing was destroyed (§5).
 */

/** Switch/extend on a tenant with no applied template — apply owns that. */
export class TemplateNotAppliedError extends DomainError {
  constructor() {
    super(
      "configuration/template-not-applied",
      "No industry template is applied yet — use the apply flow (POST /templates/:key/apply) first",
    );
  }
}

/**
 * A REQUIRED-phase-gated difference exists between the current and target
 * templates ("coming with PHASE-0NN" entries): the switch proceeds only on
 * an explicit acknowledgement — the error carries the full preview diff so
 * the UI renders exactly what is being confirmed (R9).
 */
export class TemplateSwitchAcknowledgementRequiredError extends DomainError {
  constructor(readonly preview: TemplateSwitchPreview) {
    super(
      "configuration/template-switch-acknowledgement-required",
      `Switching to ${preview.toTemplate.key} includes REQUIRED capabilities that ship with a later phase ` +
        `(e.g. ${preview.acknowledgementPhases.join(", ")}) — acknowledge the coming-with-phase differences to proceed`,
      { preview },
    );
  }
}

// ---------------------------------------------------------------------------
// The preview/diff shape (R9 — the "what will change" contract)
// ---------------------------------------------------------------------------

export interface CapabilityDiffEntry {
  readonly capabilityId: string;
  readonly featureKeys: readonly string[];
  readonly phase?: string;
}

export interface RenamedLabelEntry {
  readonly termKey: string;
  readonly from: LocalizedText | null;
  readonly to: LocalizedText | null;
}

export interface NumberingSeriesEntry {
  readonly docType: string;
  readonly prefix: string;
  readonly format: string;
  readonly perBranch: boolean;
  readonly reserveOnApproval: boolean;
}

export interface InventoryDefaultChange {
  readonly key: string;
  readonly from: string | number | boolean;
  readonly to: string | number | boolean;
  /** R3: defaults apply to NEWLY created items only — never a mutation. */
  readonly note: "new-items-only";
}

export interface WorkflowPolicyChange {
  readonly key: string;
  readonly from: WorkflowPolicyValue | null;
  readonly to: WorkflowPolicyValue;
  /** True when both templates set the key with different values (§7 conflict). */
  readonly conflict: boolean;
}

export interface TemplateSwitchPreview {
  readonly mode: "switch" | "extend";
  readonly fromTemplate: { key: string; version: string } | null;
  readonly toTemplate: { key: string; version: string; manifestHash: string };
  readonly addedCapabilities: {
    readonly included: readonly CapabilityDiffEntry[];
    readonly phaseGated: readonly CapabilityDiffEntry[];
    readonly optionalMissing: readonly CapabilityDiffEntry[];
  };
  /** Present in the current template but absent in the target (R6 archived). */
  readonly archivedCapabilities: readonly CapabilityDiffEntry[];
  /** Terminology keys whose effective label changes old → new (AR + EN). */
  readonly renamedLabels: readonly RenamedLabelEntry[];
  /** Series the operation would register (append-only; R5). */
  readonly newNumberingSeries: readonly NumberingSeriesEntry[];
  /** Target doc types that already carry a series — kept untouched. */
  readonly keptNumberingSeries: readonly { docType: string; format: string }[];
  readonly inventoryDefaultChanges: readonly InventoryDefaultChange[];
  readonly workflowPolicyChanges: readonly WorkflowPolicyChange[];
  readonly reportPinChanges: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly onboardingChecklistChanges: { readonly added: readonly string[]; readonly removed: readonly string[] };
  /** R10: blocked ⇒ the operation fails with the missing chain. */
  readonly blocked: boolean;
  readonly missingChain: readonly string[];
  /** REQUIRED-phase-gated differences exist ⇒ acknowledge before switching. */
  readonly acknowledgementRequired: boolean;
  readonly acknowledgementPhases: readonly string[];
}

export interface TemplateSwitchResult {
  readonly applied: boolean;
  readonly reason?: "already-applied";
  readonly diff: TemplateSwitchPreview;
}

// ---------------------------------------------------------------------------
// Diff computation (pure — the preview and the switch share one source)
// ---------------------------------------------------------------------------

interface DiffInput {
  readonly mode: "switch" | "extend";
  readonly currentRow: AppliedStateRow | undefined;
  /** The current PRIMARY manifest (null when no template applied). */
  readonly currentManifest: IndustryTemplateManifest | null;
  /** Extension manifests already applied (extend history). */
  readonly extensionManifests: readonly IndustryTemplateManifest[];
  readonly targetManifest: IndustryTemplateManifest;
  readonly targetVersion: string;
  readonly activeKeys: ReadonlySet<string>;
  readonly existingDocTypes: ReadonlySet<string>;
  readonly tenantAdditions: Readonly<Record<string, LocalizedText>>;
  readonly prerequisiteCheck: PrerequisiteCheck;
}

function effectiveTerminology(
  manifest: IndustryTemplateManifest | null,
  tenantAdditions: Readonly<Record<string, LocalizedText>>,
): Readonly<Record<string, LocalizedText>> {
  return resolveTerminology({
    glossary: GLOSSARY_DEFAULTS,
    template: manifest === null ? undefined : manifest.terminology_overrides,
    tenantAdditions,
  });
}

function capabilityDiffEntries(
  manifest: IndustryTemplateManifest,
): ReadonlyArray<{ capabilityId: string; featureKeys: readonly string[]; phase?: string }> {
  return Object.keys(manifest.capability_prerequisites)
    .sort()
    .map((capabilityId) => {
      const capability = manifest.capability_prerequisites[capabilityId]!;
      return { capabilityId, featureKeys: capability.feature_keys };
    });
}

function seriesEntry(docType: string, rule: NumberingRule): NumberingSeriesEntry {
  return {
    docType,
    prefix: rule.prefix,
    format: rule.format,
    perBranch: rule.per_branch,
    reserveOnApproval: rule.reserve_on_approval,
  };
}

export function buildSwitchDiff(input: DiffInput): TemplateSwitchPreview {
  const target = input.targetManifest;
  const current = input.currentManifest;

  // -- added capabilities, classified against the caller's entitlements ----
  const alreadyApplied = new Set<string>([
    ...(current === null ? [] : Object.keys(current.capability_prerequisites)),
    ...input.extensionManifests.flatMap((manifest) =>
      Object.keys(manifest.capability_prerequisites),
    ),
  ]);
  const included: CapabilityDiffEntry[] = [];
  const phaseGated: CapabilityDiffEntry[] = [];
  const optionalMissing: CapabilityDiffEntry[] = [];
  for (const state of input.prerequisiteCheck.capabilities) {
    const entry: CapabilityDiffEntry = {
      capabilityId: state.capabilityId,
      featureKeys: state.featureKeys,
      ...(state.phase === undefined ? {} : { phase: state.phase }),
    };
    if (input.mode === "extend" && alreadyApplied.has(state.capabilityId)) {
      continue; // The extension adds only NEW capabilities (additive).
    }
    if (state.status === "included") {
      included.push(entry);
    } else if (state.status === "phase_gated") {
      phaseGated.push(entry);
    } else if (state.status === "hidden") {
      optionalMissing.push(entry); // OPTIONAL missing ⇒ hidden menus, no block.
    }
    // "blocked" capabilities never reach a diff the UI can accept — the
    // operation itself is blocked (blocked/missingChain below).
  }

  // -- archived capabilities (R6): current-set capabilities the target lacks
  const archivedCapabilities: CapabilityDiffEntry[] = [];
  if (input.mode === "switch" && current !== null) {
    const targetCapabilities = new Set(Object.keys(target.capability_prerequisites));
    for (const entry of capabilityDiffEntries(current)) {
      if (!targetCapabilities.has(entry.capabilityId)) {
        archivedCapabilities.push(entry);
      }
    }
  }

  // -- renamed labels: effective terminology old → new ----------------------
  const before = effectiveTerminology(current, input.tenantAdditions);
  const after =
    input.mode === "switch"
      ? effectiveTerminology(target, input.tenantAdditions)
      : // Extend: the extension's labels land in the tenant-additions map
        // for keys the primary does not set (additive merge, §7).
        effectiveTerminology(current, {
          ...mergeExtensionTerminology(current, target, input.tenantAdditions).merged,
        });
  const renamedLabels: RenamedLabelEntry[] = [];
  const termKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const termKey of termKeys) {
    const from = before[termKey] ?? null;
    const to = after[termKey] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      renamedLabels.push({ termKey, from, to });
    }
  }

  // -- numbering series (R5 append-only) ------------------------------------
  const newNumberingSeries: NumberingSeriesEntry[] = [];
  const keptNumberingSeries: { docType: string; format: string }[] = [];
  for (const [docType, rule] of Object.entries(target.document_numbering_defaults)) {
    if (input.existingDocTypes.has(docType)) {
      keptNumberingSeries.push({ docType, format: rule.format });
    } else {
      newNumberingSeries.push(seriesEntry(docType, rule as NumberingRule));
    }
  }

  // -- inventory defaults (R3: new items only) ------------------------------
  const inventoryDefaultChanges: InventoryDefaultChange[] = [];
  if (input.mode === "switch" && current !== null) {
    const from = current.inventory_policy_defaults;
    const to = target.inventory_policy_defaults;
    for (const key of Object.keys(to) as readonly (keyof typeof to)[]) {
      if (from[key] !== to[key]) {
        inventoryDefaultChanges.push({
          key,
          from: from[key],
          to: to[key],
          note: "new-items-only",
        });
      }
    }
  }

  // -- workflow policies (§7 conflicts: most-recently-applied wins, unset only)
  const workflowPolicyChanges: WorkflowPolicyChange[] = [];
  if (current !== null) {
    for (const [key, toValue] of Object.entries(target.workflow_policies)) {
      const fromValue = current.workflow_policies[key];
      if (fromValue === undefined) {
        workflowPolicyChanges.push({ key, from: null, to: toValue, conflict: false });
      } else if (fromValue !== toValue) {
        workflowPolicyChanges.push({ key, from: fromValue, to: toValue, conflict: true });
      }
    }
  }

  // -- report pins + onboarding checklist ------------------------------------
  const currentPins = new Set(
    current === null ? [] : current.report_defaults.map((pin) => pin.report_key),
  );
  const targetPins = target.report_defaults.map((pin) => pin.report_key);
  const reportPinChanges = {
    added: targetPins.filter((key) => !currentPins.has(key)),
    removed: current === null ? [] : current.report_defaults
      .map((pin) => pin.report_key)
      .filter((key) => !targetPins.includes(key)),
  };

  const currentStepIds = new Set(
    current === null ? [] : current.onboarding_steps.map((step) => step.id),
  );
  const targetStepIds = target.onboarding_steps.map((step) => step.id);
  const onboardingChecklistChanges = {
    added: targetStepIds.filter((id) => !currentStepIds.has(id)),
    removed: current === null ? [] : current.onboarding_steps
      .map((step) => step.id)
      .filter((id) => !targetStepIds.includes(id)),
  };

  const acknowledgementPhases = [
    ...new Set(
      input.prerequisiteCheck.capabilities
        .filter((state) => state.level === "REQUIRED" && state.status === "phase_gated")
        .map((state) => state.phase!),
    ),
  ].sort();

  return {
    mode: input.mode,
    fromTemplate:
      input.currentRow === undefined
        ? null
        : { key: input.currentRow.templateKey, version: input.currentRow.appliedVersion },
    toTemplate: {
      key: target.id,
      version: input.targetVersion,
      manifestHash: hashManifestJson(target),
    },
    addedCapabilities: { included, phaseGated, optionalMissing },
    archivedCapabilities,
    renamedLabels,
    newNumberingSeries,
    keptNumberingSeries,
    inventoryDefaultChanges,
    workflowPolicyChanges,
    reportPinChanges,
    onboardingChecklistChanges,
    blocked: input.prerequisiteCheck.status === "blocked",
    missingChain: input.prerequisiteCheck.missingChain,
    acknowledgementRequired: input.prerequisiteCheck.requiresAcknowledgement,
    acknowledgementPhases,
  };
}

/**
 * The extend-time terminology merge: the extension's labels land as tenant
 * additions for keys the PRIMARY manifest does not set (additive — primary
 * labels and existing tenant additions win, §7); shared keys with different
 * values are returned as conflicts (primary stays effective).
 */
function mergeExtensionTerminology(
  primary: IndustryTemplateManifest | null,
  extension: IndustryTemplateManifest,
  tenantAdditions: Readonly<Record<string, LocalizedText>>,
): {
  merged: Readonly<Record<string, LocalizedText>>;
  conflicts: ReadonlyArray<{ key: string; from: LocalizedText; to: LocalizedText }>;
} {
  const merged: Record<string, LocalizedText> = { ...tenantAdditions };
  const conflicts: { key: string; from: LocalizedText; to: LocalizedText }[] = [];
  const primaryKeys = new Set(
    primary === null ? [] : Object.keys(primary.terminology_overrides),
  );
  for (const [key, label] of Object.entries(extension.terminology_overrides)) {
    if (primaryKeys.has(key)) {
      if (
        primary !== null &&
        JSON.stringify(primary.terminology_overrides[key]) !== JSON.stringify(label)
      ) {
        conflicts.push({ key, from: primary.terminology_overrides[key]!, to: label });
      }
      continue; // Primary wins for extend (additive-only; no silent relabel).
    }
    if (tenantAdditions[key] === undefined) {
      merged[key] = label; // Additive: a label the primary does not carry.
    }
  }
  return { merged, conflicts };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export const TEMPLATE_SWITCH_SERVICE = Symbol("TEMPLATE_SWITCH_SERVICE");

@Injectable()
export class TemplateSwitchService {
  constructor(
    @Inject(CONFIG_REPOSITORY) private readonly repository: ConfigRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // -- preview (R9): the what-will-change diff, NO writes -------------------

  async preview(
    _actorId: string | null,
    input: { targetTemplateKey: string; mode: "switch" | "extend" },
  ): Promise<TemplateSwitchPreview> {
    return this.computeDiff(input.targetTemplateKey, input.mode);
  }

  // -- switch (BR-038 additive-only) -----------------------------------------

  async switch(
    actorId: string | null,
    input: { targetTemplateKey: string; acknowledged?: boolean },
  ): Promise<TemplateSwitchResult> {
    const target = await this.loadTarget(input.targetTemplateKey);
    const currentRow = await findAppliedStateRow();
    if (currentRow === undefined) {
      throw new TemplateNotAppliedError();
    }
    // Idempotent: switching to the exact applied template+version is a no-op.
    if (
      currentRow.templateKey === target.key &&
      currentRow.appliedVersion === target.version &&
      currentRow.appliedManifestHash === hashManifestJson(target.manifest)
    ) {
      return {
        applied: false,
        reason: "already-applied",
        diff: await this.computeDiff(input.targetTemplateKey, "switch"),
      };
    }

    const entitlements = await this.repository.listActiveEntitlements();
    const activeKeys = new Set(entitlements.map((row) => row.featureKey));
    const check = checkPrerequisites(target.manifest, [...activeKeys]);
    if (check.status === "blocked") {
      throw new TemplatePrerequisitesBlockedError(
        target.key,
        check.missingChain,
        check.guidance!,
        check.closureViolations,
      );
    }

    const diff = await this.computeDiff(input.targetTemplateKey, "switch");
    if (diff.acknowledgementRequired && input.acknowledged !== true) {
      throw new TemplateSwitchAcknowledgementRequiredError(diff);
    }

    // ---- the additive writes (one transaction, ambient tx) ----------------
    const now = new Date().toISOString();
    const currentRegistry = await this.repository.findIndustryTemplate(currentRow.templateKey);
    if (currentRegistry === undefined) {
      throw new TemplateNotFoundError(
        currentRow.templateKey,
        "the APPLIED template has no registry row — registry corruption (the engine fails closed on this too)",
      );
    }
    const currentManifest = currentRegistry.manifest;
    const previousOverrides = parseAppliedOverrides(currentRow.overrides);

    // R2/R6: archive the current template's terminology + navigation +
    // retired capabilities (append; read-only history — nothing deleted).
    const archivedTerminology = [
      ...currentRow.archivedTerminology,
      {
        templateKey: currentRow.templateKey,
        version: currentRow.appliedVersion,
        archivedAt: now,
        terminology: currentManifest.terminology_overrides,
      },
    ];
    const archivedNavigation = [
      ...currentRow.archivedNavigation,
      {
        templateKey: currentRow.templateKey,
        version: currentRow.appliedVersion,
        archivedAt: now,
        groups: currentManifest.navigation_manifest.groups,
      },
    ];
    const targetCapabilityIds = new Set(Object.keys(target.manifest.capability_prerequisites));
    const retiredCapabilities = capabilityDiffEntries(currentManifest).filter(
      (entry) => !targetCapabilityIds.has(entry.capabilityId),
    );
    const archivedCapabilities = [
      ...currentRow.archivedCapabilities,
      {
        templateKey: currentRow.templateKey,
        version: currentRow.appliedVersion,
        archivedAt: now,
        capabilities: retiredCapabilities,
      },
    ];

    // §7 conflicts: shared policy/inventory keys with different values —
    // the newly applied template wins for UNSET keys only (the engine's L1
    // swap); explicit L5 rows always survive (R8, asserted by the spec).
    const conflictNotes: ConflictNote[] = [...currentRow.conflictNotes];
    for (const change of diff.workflowPolicyChanges) {
      if (!change.conflict) {
        continue;
      }
      conflictNotes.push({
        kind: "workflow_policy",
        key: change.key,
        previousTemplate: currentRow.templateKey,
        newTemplate: target.key,
        from: change.from,
        to: change.to,
        resolution: "most-recently-applied-wins-unset-only",
        at: now,
      });
    }
    for (const change of diff.inventoryDefaultChanges) {
      conflictNotes.push({
        kind: "inventory_default",
        key: change.key,
        previousTemplate: currentRow.templateKey,
        newTemplate: target.key,
        from: change.from,
        to: change.to,
        resolution: "most-recently-applied-wins-unset-only",
        at: now,
      });
    }

    const overrides: AppliedOverrides = {
      report_pins: buildReportPins(target.manifest),
      onboarding_checklist: buildOnboardingChecklist(target.manifest, activeKeys),
      enabled_modules: [
        ...new Set([
          ...previousOverrides.enabled_modules,
          ...target.manifest.default_modules_enabled,
        ]),
      ],
      terminology: previousOverrides.terminology, // tenant additions survive (R2)
      applied_extensions: [], // the switch replaces the primary; history is the archives
    };

    const addedSeries = await this.registerMissingSeries(target.manifest);

    await upsertAppliedConfig({
      templateKey: target.key,
      appliedVersion: target.version,
      appliedManifestHash: hashManifestJson(target.manifest),
      appliedBy: actorId,
      status: "ACTIVE",
      overrides,
      archivedTerminology,
      archivedNavigation,
      archivedCapabilities,
      conflictNotes,
    });

    await this.audit.record({
      action: "industry.template.switched",
      entityType: "tenant_industry_config",
      entityId: requireTenantContext().tenantId, // audit entityId is a uuid column — the one-row-per-tenant owner
      actorId: actorId ?? undefined,
      before: {
        templateKey: currentRow.templateKey,
        appliedVersion: currentRow.appliedVersion,
        appliedManifestHash: currentRow.appliedManifestHash,
      },
      // R9: the FULL diff is the after-state the audit trail carries.
      after: { diff, addedSeries },
    });

    publishConfigurationEvent({
      type: "template.switched",
      tenantId: requireTenantContext().tenantId,
      fromTemplateKey: currentRow.templateKey,
      toTemplateKey: target.key,
    });

    return { applied: true, diff };
  }

  // -- extend (a second template, additive) ----------------------------------

  async extend(
    actorId: string | null,
    input: { templateKey: string; acknowledged?: boolean },
  ): Promise<TemplateSwitchResult> {
    const target = await this.loadTarget(input.templateKey);
    const currentRow = await findAppliedStateRow();
    if (currentRow === undefined) {
      throw new TemplateNotAppliedError();
    }
    if (currentRow.templateKey === target.key) {
      return {
        applied: false,
        reason: "already-applied",
        diff: await this.computeDiff(input.templateKey, "extend"),
      };
    }
    const previousOverrides = parseAppliedOverrides(currentRow.overrides);
    if (
      previousOverrides.applied_extensions.some(
        (extension) => extension.templateKey === target.key,
      )
    ) {
      return {
        applied: false,
        reason: "already-applied",
        diff: await this.computeDiff(input.templateKey, "extend"),
      };
    }

    const entitlements = await this.repository.listActiveEntitlements();
    const activeKeys = new Set(entitlements.map((row) => row.featureKey));
    const check = checkPrerequisites(target.manifest, [...activeKeys]);
    if (check.status === "blocked") {
      throw new TemplatePrerequisitesBlockedError(
        target.key,
        check.missingChain,
        check.guidance!,
        check.closureViolations,
      );
    }
    const diff = await this.computeDiff(input.templateKey, "extend");
    if (diff.acknowledgementRequired && input.acknowledged !== true) {
      throw new TemplateSwitchAcknowledgementRequiredError(diff);
    }

    // ---- the additive writes ----------------------------------------------
    const now = new Date().toISOString();
    const primaryRegistry = await this.repository.findIndustryTemplate(currentRow.templateKey);
    if (primaryRegistry === undefined) {
      throw new TemplateNotFoundError(
        currentRow.templateKey,
        "the APPLIED template has no registry row — registry corruption",
      );
    }

    // §7 conflicts (extend): shared policy keys with different values stay
    // PRIMARY-effective (additive-only — an extension never relabels or
    // re-defaults the primary); the note documents the divergence.
    const conflictNotes: ConflictNote[] = [...currentRow.conflictNotes];
    for (const change of diff.workflowPolicyChanges) {
      if (!change.conflict) {
        continue;
      }
      conflictNotes.push({
        kind: "workflow_policy",
        key: change.key,
        previousTemplate: currentRow.templateKey,
        newTemplate: target.key,
        from: change.from,
        to: change.to,
        resolution: "primary-template-wins",
        at: now,
      });
    }
    const terminologyMerge = mergeExtensionTerminology(
      primaryRegistry.manifest,
      target.manifest,
      previousOverrides.terminology,
    );
    for (const conflict of terminologyMerge.conflicts) {
      conflictNotes.push({
        kind: "terminology",
        key: conflict.key,
        previousTemplate: currentRow.templateKey,
        newTemplate: target.key,
        from: conflict.from,
        to: conflict.to,
        resolution: "primary-template-wins",
        at: now,
      });
    }

    // Additive merges: pins + checklist steps (id-deduped, primary wins),
    // modules (union), terminology (new keys only — see the merge).
    const pinnedKeys = new Set(previousOverrides.report_pins.map((pin) => pin.report_key));
    const reportPins = [
      ...previousOverrides.report_pins,
      ...buildReportPins(target.manifest).filter((pin) => !pinnedKeys.has(pin.report_key)),
    ];
    const stepIds = new Set(
      previousOverrides.onboarding_checklist.map((step) => step.id),
    );
    const onboardingChecklist = [
      ...previousOverrides.onboarding_checklist,
      ...buildOnboardingChecklist(target.manifest, activeKeys).filter(
        (step) => !stepIds.has(step.id),
      ),
    ];
    const overrides: AppliedOverrides = {
      report_pins: reportPins,
      onboarding_checklist: onboardingChecklist,
      enabled_modules: [
        ...new Set([
          ...previousOverrides.enabled_modules,
          ...target.manifest.default_modules_enabled,
        ]),
      ],
      terminology: terminologyMerge.merged,
      applied_extensions: [
        ...previousOverrides.applied_extensions,
        {
          templateKey: target.key,
          version: target.version,
          manifestHash: hashManifestJson(target.manifest),
          extendedAt: now,
        },
      ],
    };

    const addedSeries = await this.registerMissingSeries(target.manifest);

    await upsertAppliedConfig({
      templateKey: currentRow.templateKey, // the PRIMARY stays (task contract)
      appliedVersion: currentRow.appliedVersion,
      appliedManifestHash: currentRow.appliedManifestHash,
      appliedBy: currentRow.appliedBy,
      status: currentRow.status,
      overrides,
      archivedTerminology: currentRow.archivedTerminology,
      archivedNavigation: currentRow.archivedNavigation,
      archivedCapabilities: currentRow.archivedCapabilities,
      conflictNotes,
      touchAppliedAt: false, // the primary's application timestamp stays
    });

    await this.audit.record({
      action: "industry.template.extended",
      entityType: "tenant_industry_config",
      entityId: requireTenantContext().tenantId, // audit entityId is a uuid column — the one-row-per-tenant owner
      actorId: actorId ?? undefined,
      before: {
        templateKey: currentRow.templateKey,
        appliedVersion: currentRow.appliedVersion,
        applied_extensions: previousOverrides.applied_extensions,
      },
      after: { diff, addedSeries, overrides },
    });

    // §9: an extension is an additive apply — the template.applied row is
    // the invalidation event (template.switched is reserved for primary
    // swaps; both drop the tenant-static cache identically).
    publishConfigurationEvent({
      type: "template.applied",
      tenantId: requireTenantContext().tenantId,
      templateKey: target.key,
      version: target.version,
    });

    return { applied: true, diff };
  }

  // -- internals --------------------------------------------------------------

  private async loadTarget(templateKey: string) {
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

  /** The no-writes diff computation shared by preview/switch/extend. */
  private async computeDiff(
    targetTemplateKey: string,
    mode: "switch" | "extend",
  ): Promise<TemplateSwitchPreview> {
    const target = await this.loadTarget(targetTemplateKey);
    const currentRow = await findAppliedStateRow();
    const currentRegistry =
      currentRow === undefined
        ? undefined
        : await this.repository.findIndustryTemplate(currentRow.templateKey);
    const entitlements = await this.repository.listActiveEntitlements();
    const activeKeys = new Set(entitlements.map((row) => row.featureKey));
    const existingDocTypes = new Set(await listSeriesDocTypes());
    const tenantAdditions =
      currentRow === undefined ? {} : parseAppliedOverrides(currentRow.overrides).terminology;

    const extensionManifests: IndustryTemplateManifest[] = [];
    if (currentRow !== undefined && mode === "extend") {
      const previousOverrides = parseAppliedOverrides(currentRow.overrides);
      for (const extension of previousOverrides.applied_extensions) {
        const registry = await this.repository.findIndustryTemplate(extension.templateKey);
        if (registry !== undefined) {
          extensionManifests.push(registry.manifest);
        }
      }
    }

    const check = checkPrerequisites(target.manifest, [...activeKeys]);
    return buildSwitchDiff({
      mode,
      currentRow,
      currentManifest: currentRegistry?.manifest ?? null,
      extensionManifests,
      targetManifest: target.manifest,
      targetVersion: target.version,
      activeKeys,
      existingDocTypes,
      tenantAdditions,
      prerequisiteCheck: check,
    });
  }

  /** Register the manifest's series for doc types with no row yet (R5). */
  private async registerMissingSeries(
    manifest: IndustryTemplateManifest,
  ): Promise<{ docType: string; format: string }[]> {
    const existingDocTypes = new Set(await listSeriesDocTypes());
    const added: { docType: string; format: string }[] = [];
    for (const [docType, rule] of Object.entries(manifest.document_numbering_defaults)) {
      if (existingDocTypes.has(docType)) {
        continue;
      }
      await registerSeriesRow(docType, rule as NumberingRule);
      added.push({ docType, format: rule.format });
    }
    return added;
  }
}

// compareVersions is re-exported for the drift service + specs.
export { compareVersions };
