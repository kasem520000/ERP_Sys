import { Inject, Injectable } from "@nestjs/common";
import { DOCUMENT_TYPES, hashManifestJson } from "@erp/contracts";

import { ConfigurationResolutionError } from "../../domain/effective-config";
import type {
  EffectiveConfig,
  L1TemplateLayer,
  L2JurisdictionLayer,
  L3PlanLayer,
  L4EntitlementLayer,
  L5SettingsLayer,
  L7BranchLayer,
  L8InstalledLayer,
  L10PolicyLayer,
  L10ApprovalPolicy,
  LayerInputs,
  RequestOverlay,
  TenantStaticConfig,
} from "../../domain/layer-model";
import { parseSettingValue } from "../../domain/settings-schema";
import {
  ConfigRepository,
  CONFIG_REPOSITORY,
} from "../../infrastructure/config-repository";

import { composeTenantStaticConfig } from "./compose";
import {
  cachedRequestOverlay,
  cachedTenantStatic,
  storeRequestOverlay,
  storeTenantStatic,
} from "./cache";
import { parseTerminologyMap } from "./terminology";

/**
 * The ten-layer resolution engine (CONFIGURATION_ENGINE §3; PHASE-015 §2
 * item 1): `resolveTenantStatic(tenantId)` loads L1→L2→L3→L4→L5→L7→L8→L10
 * inside the ambient tenant scope, merges them per the §3 precedence table,
 * validates the merged result fail-closed, and caches the tenant-static
 * config keyed by an input fingerprint (§9: a hash mismatch forces
 * re-resolution). `resolve(tenantId, principal)` overlays L6 (permissions +
 * branch scope — computed per request, never cached across principals) and
 * derives L9.
 *
 * Fail-closed (§6 rule 6): any layer load or validation error becomes a
 * typed ConfigurationResolutionError carrying the layer name + cause —
 * never a partially-defaulted config.
 */

/** The principal as resolved by the caller (session/membership context). */
export interface PrincipalInput {
  readonly userId: string;
  readonly roleKey: string;
  readonly permissions: ReadonlySet<string> | readonly string[];
  /** Branch IDs in scope; null = tenant-wide. */
  readonly branchScope: readonly string[] | null;
}

/** BR-034 approval modes (accounting approval_policies.policy jsonb shape). */
const APPROVAL_MODES: ReadonlySet<string> = new Set([
  "none",
  "single-approver",
  "two-step",
  "amount-threshold",
]);

@Injectable()
export class ResolveEffectiveConfigService {
  constructor(
    @Inject(CONFIG_REPOSITORY) private readonly repository: ConfigRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Tenant-static resolution (§3 steps 1–3, cached per tenant)
  // -------------------------------------------------------------------------

  async resolveTenantStatic(tenantId: string): Promise<TenantStaticConfig> {
    // §9 staleness guard first: the fingerprint is cheap; a stored entry
    // whose fingerprint no longer matches is stale and re-resolves.
    const fingerprint = await this.load("fingerprint", () =>
      this.repository.computeInputFingerprint(),
    );
    const cached = cachedTenantStatic(tenantId, fingerprint);
    if (cached !== undefined) {
      return cached;
    }
    const inputs = await this.loadLayerInputs(tenantId);
    const config = composeTenantStaticConfig(inputs);
    storeTenantStatic(tenantId, fingerprint, config);
    return config;
  }

  // -------------------------------------------------------------------------
  // Request-scoped resolution (§3 steps 4–5: L6 overlay + L9)
  // -------------------------------------------------------------------------

  async resolve(tenantId: string, principal: PrincipalInput): Promise<EffectiveConfig> {
    const staticConfig = await this.resolveTenantStatic(tenantId);
    const overlay = await this.resolveRequestOverlay(tenantId, staticConfig, principal);
    return { ...staticConfig, request_overlay: overlay };
  }

  /**
   * The L6 request overlay (§3 step 4): intersect the effective config with
   * the principal's permissions + branch scope. Cached per USER and never
   * shared across principals — `role.updated` / `membership.updated` drop
   * the entry (§9); the tenant-static cache is untouched by them.
   */
  private async resolveRequestOverlay(
    tenantId: string,
    staticConfig: TenantStaticConfig,
    principal: PrincipalInput,
  ): Promise<RequestOverlay> {
    const cached = cachedRequestOverlay(principal.userId, tenantId, staticConfig.resolved_hash);
    if (cached !== undefined) {
      return cached;
    }
    const branchScope = await this.load("L6", () =>
      this.resolveBranchScope(tenantId, principal),
    );
    const permissions =
      principal.permissions instanceof Set
        ? [...principal.permissions]
        : [...principal.permissions];
    permissions.sort();
    const overlay: RequestOverlay = {
      user_id: principal.userId,
      role: principal.roleKey,
      branch_scope: branchScope,
      actions: permissions,
    };
    storeRequestOverlay(principal.userId, tenantId, staticConfig.resolved_hash, overlay);
    return overlay;
  }

  /** Branch scope ∩ the tenant's ACTIVE branches, as branch codes (§5 form). */
  private async resolveBranchScope(
    _tenantId: string,
    principal: PrincipalInput,
  ): Promise<readonly string[]> {
    const branches = await this.repository.listBranches();
    const activeById = new Map(
      branches.filter((branch) => branch.isActive).map((branch) => [branch.id, branch.code]),
    );
    if (principal.branchScope === null) {
      return [...activeById.values()].sort();
    }
    const codes = principal.branchScope
      .filter((branchId) => activeById.has(branchId))
      .map((branchId) => activeById.get(branchId)!)
      .sort();
    return [...new Set(codes)];
  }

  // -------------------------------------------------------------------------
  // Layer loading (each layer fail-closed on its own name)
  // -------------------------------------------------------------------------

  private async loadLayerInputs(tenantId: string): Promise<LayerInputs> {
    // Tenant profile first — the anchor of the §5 tenant block.
    const profile = await this.load("tenant", () => this.repository.getTenantProfile());
    if (profile.id !== tenantId) {
      throw new ConfigurationResolutionError(
        "tenant",
        `ambient tenant scope is ${profile.id} but resolution was requested for ${tenantId} — resolve inside withTenant(tenantId)`,
      );
    }

    const l5 = await this.loadL5Settings();
    const [l1, l2, l3, l4, l7, l8, l10] = await Promise.all([
      this.loadL1Template(),
      this.loadL2Jurisdiction(profile.countryCode, l5),
      this.loadL3Plan(),
      this.loadL4Entitlements(),
      this.loadL7Branches(),
      this.loadL8Installed(),
      this.loadL10Policies(),
    ]);

    return {
      tenantId: profile.id,
      baseCurrency: profile.baseCurrency,
      countryCode: profile.countryCode,
      industryTemplatePreference: profile.industryTemplateKey,
      l1,
      l2,
      l3,
      l4,
      l5,
      l7,
      l8,
      l10,
    };
  }

  /** L1: applied template state + parsed registry manifest (null = none). */
  private async loadL1Template(): Promise<L1TemplateLayer | null> {
    return this.load("1", async () => {
      const applied = await this.repository.findTenantIndustryConfig();
      if (applied === undefined) {
        return null; // No template applied → L1 neutral, platform defaults.
      }
      const registry = await this.repository.findIndustryTemplate(applied.templateKey);
      if (registry === undefined) {
        throw new Error(
          `applied template "${applied.templateKey}" has no registry row (industry_templates) — the registry cannot have shipped less than what a tenant applied`,
        );
      }
      const overrides =
        applied.overrides === null || applied.overrides === undefined
          ? {}
          : applied.overrides;
      if (typeof overrides !== "object" || Array.isArray(overrides)) {
        throw new Error("tenant_industry_config.overrides is not a JSON object (corruption)");
      }
      const terminology = (overrides as Record<string, unknown>).terminology;
      const tenantTerminology =
        terminology === undefined
          ? {}
          : parseTerminologyMap("tenant_industry_config.overrides.terminology", terminology);
      return {
        key: registry.key,
        // The REGISTRY row's version is what resolves (the applied_version
        // pin is the BR-038 diff anchor for the switch/extend services;
        // registry drift is the T4 drift job's concern, never silent).
        version: registry.version,
        manifestHash: hashManifestJson(registry.manifest),
        manifest: registry.manifest,
        appliedAt: applied.appliedAt,
        status: applied.status,
        tenantTerminology,
      } satisfies L1TemplateLayer;
    });
  }

  /**
   * L2: jurisdiction facts — pack identity from the jurisdictions registry,
   * the tenant's pinned version from tax_pack_bindings, and the tenant's
   * registration from tax_registrations (falling back to the provisional
   * L5 `tax.registration.status` key during the PHASE-009 migration
   * window). Tax RATES/TREATMENTS are L2-only and never enter the config
   * as values — the block carries identity, not legal content.
   */
  private async loadL2Jurisdiction(
    countryCode: string,
    l5: L5SettingsLayer,
  ): Promise<L2JurisdictionLayer | null> {
    return this.load("2", async () => {
      const jurisdiction = await this.repository.findJurisdiction(countryCode);
      if (jurisdiction === undefined) {
        return null; // No pack for this country — L2 neutral.
      }
      const binding = await this.repository.findTaxPackBinding(countryCode);
      const registration = await this.repository.findTaxRegistration(countryCode);
      const provisional = l5.entries["tax.registration.status"];
      const tenantRegistration =
        registration?.status ??
        (typeof provisional === "string" ? provisional : "NOT_REGISTERED");
      return {
        countryCode: jurisdiction.countryCode,
        packVersion: binding?.packVersion ?? jurisdiction.packVersion,
        vatStatus: jurisdiction.vatStatus,
        tenantRegistration,
      } satisfies L2JurisdictionLayer;
    });
  }

  /** L3: current subscription → plan key + limits (null = no subscription). */
  private async loadL3Plan(): Promise<L3PlanLayer | null> {
    return this.load("3", async () => {
      const plan = await this.repository.findCurrentPlan();
      if (plan === undefined) {
        return null;
      }
      if (plan.limits === null || typeof plan.limits !== "object" || Array.isArray(plan.limits)) {
        throw new Error(`plan "${plan.planKey}" limits is not a JSON object (corruption)`);
      }
      return {
        planKey: plan.planKey,
        limits: plan.limits as Record<string, unknown>,
      } satisfies L3PlanLayer;
    });
  }

  /** L4: active entitlement rows → active keys + sources map. */
  private async loadL4Entitlements(): Promise<L4EntitlementLayer> {
    return this.load("4", async () => {
      const rows = await this.repository.listActiveEntitlements();
      const active = [...new Set(rows.map((row) => row.featureKey))].sort();
      const sources: Record<string, string> = {};
      for (const row of rows) {
        sources[row.featureKey] = row.source;
      }
      return { active, sources } satisfies L4EntitlementLayer;
    });
  }

  /**
   * L5: stored tenant_settings rows validated through SETTINGS_REGISTRY —
   * an unknown key or invalid value is a fail-closed typed error (§4).
   */
  private async loadL5Settings(): Promise<L5SettingsLayer> {
    return this.load("5", async () => {
      const rows = await this.repository.listTenantSettings();
      const entries: Record<string, unknown> = {};
      for (const row of rows) {
        // parseSettingValue throws UnknownSettingKeyError /
        // InvalidSettingValueError — wrapped into the typed layer failure.
        entries[row.key] = parseSettingValue(row.key, row.value);
      }
      return { entries } satisfies L5SettingsLayer;
    });
  }

  /** L7: ACTIVE branches + their numbering-sequence formats. Only the §3
   * series-bearing document types enter the layer: the runtime's
   * number-acquisition rows use internal doc types (e.g. the POS channel's
   * `pos_sales_invoice`, INV-021) that are NOT tenant policy — feeding them
   * into mergeNumbering would mint `numbering.<type>.assign_at` policy keys
   * the closed §4 universe correctly rejects. They stay in the numbering
   * table untouched; the L7 policy surface stays §3-typed. */
  private async loadL7Branches(): Promise<L7BranchLayer> {
    return this.load("7", async () => {
      const seriesBearing = new Set<string>(DOCUMENT_TYPES);
      const branches = await this.repository.listBranches();
      const sequences = await this.repository.listNumberingSequences();
      const byBranch = new Map<string, Record<string, string>>();
      for (const sequence of sequences) {
        if (!seriesBearing.has(sequence.docType)) {
          continue; // a runtime acquisition row, not a tenant series format
        }
        const formats = byBranch.get(sequence.branchId) ?? {};
        formats[sequence.docType] = sequence.format;
        byBranch.set(sequence.branchId, formats);
      }
      const layer: Record<string, { id: string; isActive: boolean; seriesFormats: Record<string, string> }> = {};
      for (const branch of branches) {
        if (!branch.isActive) {
          continue; // Deactivated branches are out of the effective config.
        }
        layer[branch.code] = {
          id: branch.id,
          isActive: branch.isActive,
          seriesFormats: byBranch.get(branch.id) ?? {},
        };
      }
      return { branches: layer } satisfies L7BranchLayer;
    });
  }

  /** L8: platform feature_flags (rollout control only). */
  private async loadL8Installed(): Promise<L8InstalledLayer> {
    return this.load("8", async () => {
      const flags = await this.repository.listFeatureFlags();
      const modules: Record<string, boolean> = {};
      for (const flag of flags) {
        modules[flag.key] = flag.enabled;
      }
      return { modules } satisfies L8InstalledLayer;
    });
  }

  /** L10: active approval policies (BR-034), corruption fails closed. */
  private async loadL10Policies(): Promise<L10PolicyLayer> {
    return this.load("10", async () => {
      const rows = await this.repository.listActiveApprovalPolicies();
      const approvals: L10ApprovalPolicy[] = [];
      for (const row of rows) {
        if (!APPROVAL_MODES.has(row.mode)) {
          throw new Error(
            `approval policy "${row.docType}" has unknown mode "${row.mode}" (BR-034 modes: ${[...APPROVAL_MODES].join(" | ")})`,
          );
        }
        if (
          row.threshold !== null &&
          !/^\d+\.\d{4}$/.test(row.threshold)
        ) {
          throw new Error(
            `approval policy "${row.docType}" threshold "${row.threshold}" is not a canonical 4-dp decimal string (ADR-0009)`,
          );
        }
        approvals.push({
          docType: row.docType,
          mode: row.mode,
          threshold: row.threshold,
          allowSelfApproval: row.allowSelfApproval,
          appliesFrom: row.appliesFrom,
        });
      }
      return { approvals } satisfies L10PolicyLayer;
    });
  }

  /** Wrap a layer load: any throw becomes the typed §6-rule-6 failure. */
  private async load<T>(layer: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ConfigurationResolutionError) {
        throw error;
      }
      throw new ConfigurationResolutionError(
        layer,
        `layer could not be loaded or validated: ${(error as Error).message}`,
        error,
      );
    }
  }
}

/** DI token (module wiring + cross-module consumption). */
export const RESOLVE_EFFECTIVE_CONFIG_SERVICE = Symbol("RESOLVE_EFFECTIVE_CONFIG_SERVICE");
