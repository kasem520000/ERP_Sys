import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { parseIndustryTemplateManifest, type IndustryTemplateManifest } from "@erp/contracts";

import { contentHash } from "../domain/hashing";

import { getDb, type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Configuration-engine repository (PHASE-015 T1; DEPENDENCY_RULES §1
 * infrastructure layer): the drizzle reads behind the ten-layer resolution.
 * Access planes mirror the tenancy store:
 * - GLOBAL reference tables (industry_templates, jurisdictions,
 *   feature_flags, plans) read through the app pool — no RLS by design;
 * - TENANT-owned tables (tenant_industry_config, tenant_settings,
 *   entitlements, subscriptions, branches, numbering_sequences,
 *   approval_policies, tax_pack_bindings, tax_registrations) run inside the
 *   ambient tenant transaction (requireTenantContext + tx).
 *
 * Where a table is empty/absent the layer is NEUTRAL (undefined / [] — the
 * engine degrades that layer, never guesses). Fail-closed wrapping happens
 * in the resolve service (typed ConfigurationResolutionError per layer).
 */

const db = () => getDb();

/** Ambient tenant transaction (services run inside withTenant). */
function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("configuration repository access requires an ambient tenant scope");
  }
  return context.tx;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface TenantProfileRow {
  readonly id: string;
  readonly baseCurrency: string;
  readonly countryCode: string;
  readonly industryTemplateKey: string | null;
  readonly status: string;
}

export interface TenantIndustryConfigRow {
  readonly templateKey: string;
  readonly appliedVersion: string;
  readonly appliedManifestHash: string;
  readonly appliedAt: string;
  readonly status: string;
  readonly overrides: unknown;
  readonly updatedAt: string;
}

export interface IndustryTemplateRegistryRow {
  readonly key: string;
  readonly version: string;
  readonly manifest: IndustryTemplateManifest;
  readonly isActive: boolean;
  readonly status: string;
}

export interface TenantSettingRow {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: string;
}

export interface EntitlementRow {
  readonly featureKey: string;
  readonly source: string;
  readonly expiresAt: string | null;
}

export interface PlanRow {
  readonly planKey: string;
  readonly limits: unknown;
  readonly planUpdatedAt: string;
}

export interface BranchRow {
  readonly id: string;
  readonly code: string;
  readonly isActive: boolean;
}

export interface NumberingSequenceRow {
  readonly docType: string;
  readonly branchId: string;
  readonly format: string;
}

export interface ApprovalPolicyRow {
  readonly docType: string;
  readonly mode: string;
  readonly threshold: string | null;
  readonly allowSelfApproval: boolean;
  readonly appliesFrom: string;
}

export interface JurisdictionRow {
  readonly countryCode: string;
  readonly packVersion: string;
  readonly vatStatus: string;
}

export interface TaxPackBindingRow {
  readonly packVersion: string;
  readonly appliedAt: string;
}

export interface TaxRegistrationRow {
  readonly status: string;
}

export interface FeatureFlagRow {
  readonly key: string;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Tenant plane
// ---------------------------------------------------------------------------

@Injectable()
export class ConfigRepository {
  /** The tenant's own profile (tenants row, RLS-visible). */
  async getTenantProfile(): Promise<TenantProfileRow> {
    const rows = await tenantTx().execute(sql`
      SELECT id, base_currency AS "baseCurrency", country_code AS "countryCode",
             industry_template_key AS "industryTemplateKey", status
      FROM tenants LIMIT 1
    `);
    const row = (rows.rows as unknown as TenantProfileRow[])[0];
    if (row === undefined) {
      throw new Error("tenant row not visible in the ambient tenant scope");
    }
    return row;
  }

  /** The tenant's applied industry-template state (L1) — null when none. */
  async findTenantIndustryConfig(): Promise<TenantIndustryConfigRow | undefined> {
    const rows = await tenantTx().execute(sql`
      SELECT template_key AS "templateKey", applied_version AS "appliedVersion",
             applied_manifest_hash AS "appliedManifestHash",
             applied_at::text AS "appliedAt", status, overrides,
             updated_at::text AS "updatedAt"
      FROM tenant_industry_config LIMIT 1
    `);
    return (rows.rows as unknown as TenantIndustryConfigRow[])[0];
  }

  /** Stored tenant-settings rows (L5 raw — the engine validates them). */
  async listTenantSettings(): Promise<TenantSettingRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT key, value, updated_at::text AS "updatedAt"
      FROM tenant_settings ORDER BY key
    `);
    return rows.rows as unknown as TenantSettingRow[];
  }

  /** Active entitlement rows (L4 — the only source of feature truth). */
  async listActiveEntitlements(): Promise<EntitlementRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT feature_key AS "featureKey", source, expires_at::text AS "expiresAt"
      FROM entitlements
      WHERE expires_at IS NULL OR expires_at > now()
      ORDER BY feature_key
    `);
    return rows.rows as unknown as EntitlementRow[];
  }

  /** The current subscription's plan + limits (L3) — null when none. */
  async findCurrentPlan(): Promise<PlanRow | undefined> {
    const rows = await tenantTx().execute(sql`
      SELECT p.key AS "planKey", p.limits, p.updated_at::text AS "planUpdatedAt"
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.status <> 'CANCELLED'
      ORDER BY s.created_at DESC LIMIT 1
    `);
    return (rows.rows as unknown as PlanRow[])[0];
  }

  /** All branches (L7 — the engine keeps the active ones). */
  async listBranches(): Promise<BranchRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT id, code, is_active AS "isActive" FROM branches ORDER BY code
    `);
    return rows.rows as unknown as BranchRow[];
  }

  /** Numbering-sequence formats (L7 branch series; ADR-0006 store). */
  async listNumberingSequences(): Promise<NumberingSequenceRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT doc_type AS "docType", branch_id AS "branchId", format
      FROM numbering_sequences
      ORDER BY doc_type, branch_id
    `);
    return rows.rows as unknown as NumberingSequenceRow[];
  }

  /** Latest active approval policy per doc type (L10, BR-034). */
  async listActiveApprovalPolicies(): Promise<ApprovalPolicyRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT DISTINCT ON (doc_type)
             doc_type AS "docType",
             (policy->>'mode') AS mode,
             (policy->>'threshold') AS threshold,
             COALESCE((policy->>'allowSelfApproval')::boolean, false) AS "allowSelfApproval",
             applies_from::text AS "appliesFrom"
      FROM approval_policies
      WHERE is_active
      ORDER BY doc_type, applies_from DESC
    `);
    return rows.rows as unknown as ApprovalPolicyRow[];
  }

  /** The tenant's pinned jurisdiction pack (L2 binding) — null when none. */
  async findTaxPackBinding(countryCode: string): Promise<TaxPackBindingRow | undefined> {
    const rows = await tenantTx().execute(sql`
      SELECT pack_version AS "packVersion", applied_at::text AS "appliedAt"
      FROM tax_pack_bindings WHERE country_code = ${countryCode} LIMIT 1
    `);
    return (rows.rows as unknown as TaxPackBindingRow[])[0];
  }

  /** The tenant's tax registration for a country (L2) — null when none. */
  async findTaxRegistration(countryCode: string): Promise<TaxRegistrationRow | undefined> {
    const rows = await tenantTx().execute(sql`
      SELECT status FROM tax_registrations
      WHERE country_code = ${countryCode} LIMIT 1
    `);
    return (rows.rows as unknown as TaxRegistrationRow[])[0];
  }

  // ---------------------------------------------------------------------------
  // Global reference plane (app pool)
  // ---------------------------------------------------------------------------

  /**
   * A registry template row with its manifest PARSED through the §3 zod
   * schema (fail-closed: a corrupt registry row throws — no manifest ships
   * or resolves without passing validation).
   */
  async findIndustryTemplate(key: string): Promise<IndustryTemplateRegistryRow | undefined> {
    const rows = await db().execute(sql`
      SELECT key, version, manifest, is_active AS "isActive", status
      FROM industry_templates WHERE key = ${key} LIMIT 1
    `);
    const row = (rows.rows as unknown as { key: string; version: string; manifest: unknown; isActive: boolean; status: string }[])[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      key: row.key,
      version: row.version,
      manifest: parseIndustryTemplateManifest(row.manifest),
      isActive: row.isActive,
      status: row.status,
    };
  }

  /**
   * Every registry row (key-ordered), manifests parsed fail-closed. The
   * apply/switch surface and the registry list endpoint consume this; a
   * corrupt row fails the whole read loud (a registry that cannot parse
   * must never half-serve).
   */
  async listIndustryTemplates(): Promise<IndustryTemplateRegistryRow[]> {
    const rows = await db().execute(sql`
      SELECT key, version, manifest, is_active AS "isActive", status
      FROM industry_templates ORDER BY key
    `);
    return (rows.rows as unknown as { key: string; version: string; manifest: unknown; isActive: boolean; status: string }[]).map(
      (row) => ({
        key: row.key,
        version: row.version,
        manifest: parseIndustryTemplateManifest(row.manifest),
        isActive: row.isActive,
        status: row.status,
      }),
    );
  }

  /** The jurisdiction pack for a country (L2 identity) — null when none. */
  async findJurisdiction(countryCode: string): Promise<JurisdictionRow | undefined> {
    const rows = await db().execute(sql`
      SELECT country_code AS "countryCode", pack_version AS "packVersion", vat_status AS "vatStatus"
      FROM jurisdictions WHERE country_code = ${countryCode} AND is_active LIMIT 1
    `);
    return (rows.rows as unknown as JurisdictionRow[])[0];
  }

  /** Platform rollout flags (L8) — module-keyed, platform delivery only. */
  async listFeatureFlags(): Promise<FeatureFlagRow[]> {
    const rows = await db().execute(sql`
      SELECT key, enabled FROM feature_flags ORDER BY key
    `);
    return rows.rows as unknown as FeatureFlagRow[];
  }

  // ---------------------------------------------------------------------------
  // Input fingerprint (§9: hash mismatch ⇒ re-resolution)
  // ---------------------------------------------------------------------------

  /**
   * Cheap layer-input fingerprint: a hash of the layer CONTENT signals
   * (template hash + registry version, settings keys + updated_at stamps,
   * the active entitlement key list, plan key, branch codes + stamps, the
   * platform flag set, approval policies, pack binding, tax registration).
   * Content-level signatures — not bare counts — so no grant/revoke or
   * settings swap can hide from the §9 staleness check. A stored cache
   * entry whose fingerprint no longer matches is stale and must re-resolve.
   */
  async computeInputFingerprint(): Promise<string> {
    const applied = await this.findTenantIndustryConfig();
    const registryRow =
      applied === undefined ? undefined : await this.findIndustryTemplate(applied.templateKey);
    const plan = await this.findCurrentPlan();
    const tenantAggregates = await tenantTx().execute(sql`
      SELECT
        (SELECT string_agg(key || ':' || updated_at::text, ',' ORDER BY key)
           FROM tenant_settings) AS settings_sig,
        (SELECT string_agg(feature_key || ':' || source, ',' ORDER BY feature_key)
           FROM entitlements
           WHERE expires_at IS NULL OR expires_at > now()) AS entitlement_sig,
        (SELECT string_agg(code || ':' || updated_at::text, ',' ORDER BY code)
           FROM branches) AS branch_sig,
        (SELECT string_agg(doc_type || ':' || applies_from::text, ',' ORDER BY doc_type)
           FROM approval_policies WHERE is_active) AS approval_sig,
        (SELECT string_agg(doc_type || ':' || branch_id, ',' ORDER BY doc_type, branch_id)
           FROM numbering_sequences) AS sequence_sig,
        (SELECT max(updated_at)::text FROM tenants) AS tenant_updated
    `);
    const agg = (tenantAggregates.rows as unknown as Record<string, string | null>[])[0]!;
    const bindingRow = await this.findTaxPackBindingOfTenant();
    const registrationRow = await this.findPrimaryTaxRegistrationOfTenant();
    const flags = await this.listFeatureFlags();
    return contentHash({
      // Tenant profile revision (name/currency/country changes).
      tenant: agg.tenant_updated,
      // L1 — the applied state + the registry row actually resolved.
      l1: applied === undefined
        ? null
        : {
            templateKey: applied.templateKey,
            appliedVersion: applied.appliedVersion,
            appliedManifestHash: applied.appliedManifestHash,
            updatedAt: applied.updatedAt,
            registryVersion: registryRow?.version ?? null,
            registryActive: registryRow?.isActive ?? null,
          },
      // L2 — the pinned pack version + registration posture (upgrades
      // rewrite the binding; registration edits bump the row).
      l2: bindingRow === undefined
        ? null
        : { packVersion: bindingRow.packVersion, appliedAt: bindingRow.appliedAt },
      l2Registration: registrationRow ?? null,
      // L3 — plan key + the plan row's own revision timestamp.
      l3: plan === undefined ? null : { planKey: plan.planKey, updatedAt: plan.planUpdatedAt },
      // L4 — the active key list with sources (grants/revoke change it).
      l4: agg.entitlement_sig,
      // L5 — settings keys with their updated_at stamps.
      l5: agg.settings_sig,
      // L7 — branch codes + stamps + the branch-scoped series set.
      l7: { branches: agg.branch_sig, sequences: agg.sequence_sig },
      // L8 — the platform flag set.
      l8: flags.map((flag) => `${flag.key}:${flag.enabled}`),
      // L10 — active approval policies (docType + appliesFrom windows).
      l10: agg.approval_sig,
    });
  }

  /** The tenant's primary-country pack binding for the fingerprint. */
  private async findTaxPackBindingOfTenant(): Promise<TaxPackBindingRow | undefined> {
    const rows = await tenantTx().execute(sql`
      SELECT pack_version AS "packVersion", applied_at::text AS "appliedAt"
      FROM tax_pack_bindings
      ORDER BY applied_at DESC LIMIT 1
    `);
    return (rows.rows as unknown as TaxPackBindingRow[])[0];
  }

  /** The tenant's most recent tax registration for the fingerprint. */
  private async findPrimaryTaxRegistrationOfTenant(): Promise<string | undefined> {
    const rows = await tenantTx().execute(sql`
      SELECT status FROM tax_registrations ORDER BY updated_at DESC LIMIT 1
    `);
    return (rows.rows as unknown as TaxRegistrationRow[])[0]?.status;
  }
}

/** DI token (module wiring + cross-module consumption). */
export const CONFIG_REPOSITORY = Symbol("CONFIG_REPOSITORY");
