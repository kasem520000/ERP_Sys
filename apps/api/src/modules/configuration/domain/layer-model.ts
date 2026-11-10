import type {
  DocumentNumberingDefaults,
  IndustryTemplateManifest,
  LocalizedText,
  NavigationManifest,
} from "@erp/contracts";
import type { WorkflowPolicyValue } from "@erp/contracts";

/**
 * Typed layer inputs + the effective-config output shape
 * (CONFIGURATION_ENGINE §2 layer table, §5 effective-config object).
 *
 * Ten layers, three input kinds:
 * - TENANT-STATIC (L1, L2, L3, L4, L5, L7, L8, L10) — loaded and merged by
 *   `resolveTenantStatic`, cached per tenant keyed by content hash (§3 step 6);
 * - REQUEST-SCOPED (L6) — the principal overlay, computed per request and
 *   never cached across principals;
 * - DERIVED (L9) — navigation/emphasis/terminology, computed from the merged
 *   tenant-static config + the L6 prune; never stored as truth.
 */

// ---------------------------------------------------------------------------
// L1 — industry template (industry_templates + tenant_industry_config)
// ---------------------------------------------------------------------------

/**
 * L1 input: the applied template's parsed manifest plus the tenant's applied
 * state. `null` when no template is applied — the tenant then runs on
 * platform defaults (L1 = neutral).
 */
export interface L1TemplateLayer {
  readonly key: string;
  readonly version: string;
  /** Content hash of the parsed manifest (applied_manifest_hash). */
  readonly manifestHash: string;
  readonly manifest: IndustryTemplateManifest;
  readonly appliedAt: string;
  readonly status: string;
  /**
   * Tenant terminology additions recorded on tenant_industry_config.overrides
   * (BR-038 R2 archives aside) — the highest terminology precedence below
   * nothing: tenant addition > template > platform glossary.
   */
  readonly tenantTerminology: Readonly<Record<string, LocalizedText>>;
}

// ---------------------------------------------------------------------------
// L2 — jurisdiction pack (ADR-0010: read-only to tenants)
// ---------------------------------------------------------------------------

/**
 * L2 input: the tenant's jurisdiction facts. Tax rates/treatments/invoice
 * legal fields are L2-ONLY (§3 precedence table) — no other layer may touch
 * them, so this layer carries the pack IDENTITY (country, version, VAT
 * posture, the tenant's registration) but never a configurable rate.
 */
export interface L2JurisdictionLayer {
  readonly countryCode: string;
  readonly packVersion: string;
  readonly vatStatus: string;
  /** Tenant registration posture in the jurisdiction (REGISTERED / NOT_REGISTERED / DEREGISTERED). */
  readonly tenantRegistration: string;
}

// ---------------------------------------------------------------------------
// L3 — subscription plan
// ---------------------------------------------------------------------------

/** L3 input: the current subscription's plan key + its limits document. */
export interface L3PlanLayer {
  readonly planKey: string;
  readonly limits: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// L4 — feature entitlements (the ONLY source of feature truth)
// ---------------------------------------------------------------------------

/**
 * L4 input: materialized active entitlement rows + the source map. The
 * effective config never GRANTS features (§3 precedence: "Feature
 * availability: L4 only — the config reports, never grants").
 */
export interface L4EntitlementLayer {
  /** Sorted active feature keys. */
  readonly active: readonly string[];
  /** featureKey → grant source (PLAN / MANUAL / PROMO / TRIAL). */
  readonly sources: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// L5 — tenant settings (typed keys; SETTINGS_REGISTRY)
// ---------------------------------------------------------------------------

/**
 * L5 input: stored tenant_settings rows, each ALREADY validated through
 * SETTINGS_REGISTRY (unknown key / invalid value = fail-closed typed error
 * at load time — a partially-resolved config must never escape).
 */
export interface L5SettingsLayer {
  /** key → schema-validated stored value (only EXPLICIT rows; defaults merge later). */
  readonly entries: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// L7 — branch settings
// ---------------------------------------------------------------------------

/** Raw per-branch L7 input (as loaded from branches + numbering_sequences). */
export interface L7BranchInput {
  readonly id: string;
  readonly isActive: boolean;
  /** docType → numbering_sequences.format rows for THIS branch (L7 raw). */
  readonly seriesFormats: Readonly<Record<string, string>>;
}

/** L7 input: branch code → raw branch data (active branches only). */
export interface L7BranchLayer {
  readonly branches: Readonly<Record<string, L7BranchInput>>;
}

/** Per-branch resolved defaults (§5 l7_branch_defaults entry). */
export interface BranchDefaults {
  /** docType → resolved numbering series format (L7 sequence > L1 template default). */
  readonly numbering_series: Readonly<Record<string, string>>;
  readonly default_warehouse: string | null;
  readonly cash_account: string | null;
}

// ---------------------------------------------------------------------------
// L8 — installed / rollout-flagged modules
// ---------------------------------------------------------------------------

/**
 * L8 input: module → enabled. Values come from platform feature_flags
 * (rollout control ONLY — a flag may never emulate an entitlement, §6 rule 5).
 * A module with no flag row is enabled-by-entitlement only (recorded `true`;
 * L4 remains the sole source of feature truth).
 */
export interface L8InstalledLayer {
  readonly modules: Readonly<Record<string, boolean>>;
}

// ---------------------------------------------------------------------------
// L10 — workflow / policy config
// ---------------------------------------------------------------------------

/** One active approval policy row (BR-034) as the engine sees it. */
export interface L10ApprovalPolicy {
  readonly docType: string;
  readonly mode: string;
  readonly threshold: string | null;
  readonly allowSelfApproval: boolean;
  readonly appliesFrom: string;
}

/**
 * L10 input: approval-policy rows + numbering policy keys. Numbering SERIES
 * resolve through the L7 > L5 > L1 merge (precedence.ts); L10 carries the
 * tenant-managed policy rows that sit ABOVE L5 in policy precedence.
 */
export interface L10PolicyLayer {
  readonly approvals: readonly L10ApprovalPolicy[];
}

// ---------------------------------------------------------------------------
// L6 — request overlay input (never cached across principals)
// ---------------------------------------------------------------------------

/**
 * The principal as resolved by the caller (session/membership context):
 * user + role + permission set + branch scope. L6 never mutates tenant-level
 * values — it only intersects the config with what THIS user may do.
 */
export interface PrincipalInput {
  readonly userId: string;
  readonly roleKey: string;
  readonly permissions: ReadonlySet<string> | readonly string[];
  /** Branch IDs in scope; null = tenant-wide. */
  readonly branchScope: readonly string[] | null;
}

// ---------------------------------------------------------------------------
// L9 — derived UI (never stored as truth)
// ---------------------------------------------------------------------------

/** A pruned navigation item; `phase_gated` renders "coming with PHASE-016". */
export interface DerivedNavItem {
  readonly id: string;
  readonly label: LocalizedText;
  readonly target: string;
  readonly feature_key?: string;
  /** Intake keys (CAPABILITY_MATRIX §3) stay visible, marked with their intake phase. */
  readonly phase_gated?: string;
}

/** A navigation group after entitlement/flag pruning (groups with zero visible items drop). */
export interface DerivedNavGroup {
  readonly id: string;
  readonly label: LocalizedText;
  readonly order: number;
  readonly items: readonly DerivedNavItem[];
}

// ---------------------------------------------------------------------------
// The effective config (§5) — EXACT shape
// ---------------------------------------------------------------------------

/** §5 layers block (tenant-static input summary). */
export interface EffectiveLayers {
  readonly l1_template: {
    readonly key: string;
    readonly version: string;
    readonly terminology_overrides: number;
  } | null;
  readonly l2_jurisdiction_pack: {
    readonly country_code: string;
    readonly pack_version: string;
    readonly vat_status: string;
    readonly tenant_registration: string;
  } | null;
  readonly l3_plan: {
    readonly key: string;
    readonly limits: Readonly<Record<string, unknown>>;
  } | null;
  readonly l4_entitlements: {
    readonly active: readonly string[];
    readonly missing: readonly string[];
    readonly sources: Readonly<Record<string, string>>;
  };
  readonly l7_branch_defaults: Readonly<Record<string, BranchDefaults>>;
  readonly l8_installed: Readonly<Record<string, boolean>>;
}

/** §5 request_overlay block (request-scoped resolution only). */
export interface RequestOverlay {
  readonly user_id: string;
  readonly role: string;
  readonly branch_scope: readonly string[];
  readonly actions: readonly string[];
}

/**
 * The tenant-static effective config (§5 minus request_overlay) — this is
 * the portion that is CACHED and HASHED. `resolved_hash` covers
 * config_version + tenant + layers + policies + ui + invariants_note.
 */
export interface TenantStaticConfig {
  readonly config_version: 3;
  readonly resolved_hash: string;
  readonly tenant: {
    readonly id: string;
    readonly industry_template: string | null;
    readonly jurisdiction: string;
    readonly base_currency: string;
  };
  readonly layers: EffectiveLayers;
  /** Merged policy map (L10 > L5 > L1 > platform default per value class). */
  readonly policies: Readonly<Record<string, WorkflowPolicyValue>>;
  readonly ui: {
    /** Ordered ids of the derived (pruned) navigation groups — §5 summary form. */
    readonly navigation: readonly string[];
    /** Full L9 tree behind the summary (items carry phase_gated markers). */
    readonly navigation_tree: readonly DerivedNavGroup[];
    /** Derived menu emphasis: the template's visible navigation group order. */
    readonly emphasis: readonly string[];
    /** Effective label map: tenant addition > template > platform glossary. */
    readonly terminology: Readonly<Record<string, LocalizedText>>;
  };
  readonly invariants_note: string;
}

/** §5 full object: tenant-static + the request overlay. */
export interface EffectiveConfig extends TenantStaticConfig {
  readonly request_overlay: RequestOverlay | null;
}

export const INVARIANTS_NOTE =
  "INV-001…INV-022 are NOT part of config; they are enforced below it.";

/**
 * Merge input bundle for the tenant-static layers (§3 steps 1–3). Every
 * field is a loaded, ALREADY-VALIDATED layer; the merge itself is pure and
 * deterministic (same inputs ⇒ same output ⇒ same resolved_hash).
 */
export interface LayerInputs {
  readonly tenantId: string;
  readonly baseCurrency: string;
  readonly countryCode: string;
  /**
   * The registration-time template preference (tenants.industry_template_key,
   * the PHASE-004 wizard column). Used ONLY for the §5 tenant block when no
   * template is applied yet — the applied state itself is L1
   * (tenant_industry_config, written by the apply service).
   */
  readonly industryTemplatePreference: string | null;
  readonly l1: L1TemplateLayer | null;
  readonly l2: L2JurisdictionLayer | null;
  readonly l3: L3PlanLayer | null;
  readonly l4: L4EntitlementLayer;
  readonly l5: L5SettingsLayer;
  readonly l7: L7BranchLayer;
  readonly l8: L8InstalledLayer;
  readonly l10: L10PolicyLayer;
}

// Re-exports the layer-model consumers need (single import point).
export type {
  DocumentNumberingDefaults,
  IndustryTemplateManifest,
  LocalizedText,
  NavigationManifest,
};
