import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import type { LocalizedText, NumberingRule } from "@erp/contracts";

import type { TenantDb } from "../../../../infra/db/client";
import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * Applied-state writes (PHASE-015 T5/T6; MODULE_BOUNDARIES: `configuration`
 * owns `tenant_industry_config`). The engine's repository
 * (infrastructure/config-repository.ts) is deliberately read-only; these
 * are the apply/switch transaction's write legs — same access plane as the
 * tenancy store: everything runs inside the AMBIENT tenant transaction
 * (`withTenant` — one idempotent, audited UoW per apply/switch).
 *
 * Numbering series note (R5/ADR-0006 + the task's DB-access allowance): the
 * accounting module publishes no "create series" surface — `reserve()`
 * acquires numbers and lazily creates (branch, period)-scoped rows. The
 * apply/switch therefore registers the template's proposed series as
 * TENANT-LEVEL rows (branch NULL, period NULL) directly through the
 * ambient tx — within configuration's documented DB access — as the
 * series REGISTRY: append-only per doc type, never mutated, never
 * incremented by this module. Document consumers keep creating their own
 * (branch, period)-scoped acquisition rows; posted numbers are never
 * touched (INV-021/INV-022).
 *
 * R7 (jurisdiction packs win): no shipped jurisdiction pack carries a
 * programmatic numbering mandate today (the migration-0013 `descriptor`
 * jsonb has formats for dates/numbers/addresses but no numbering-format
 * key) — so the manifest series is stored AS-IS and R7 enforcement reads
 * the pack at SERIES-USE time (the numbering/posting surface renders the
 * pack-mandated format when a pack defines one; a future pack mandate
 * lands as a pack-descriptor key consumed there, never as a tenant write).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("applied-state writes require an ambient tenant scope (withTenant)");
  }
  return context.tx;
}

// ---------------------------------------------------------------------------
// The overrides jsonb shape (tenant_industry_config.overrides)
// ---------------------------------------------------------------------------

/** A materialized report pin (§3 report_defaults with `dashboard` default false). */
export interface ReportPin {
  readonly report_key: string;
  readonly pinned: boolean;
  readonly dashboard: boolean;
  readonly default_period?: string;
}

/** A checklist step built from manifest onboarding_steps (§4 step A6). */
export interface ChecklistStep {
  readonly id: string;
  readonly title: LocalizedText;
  readonly required: boolean;
  readonly hint?: LocalizedText;
  readonly featureKey?: string;
  /** visible | phase_gated ("coming with PHASE-0NN") | hidden (unentitled). */
  readonly status: "visible" | "phase_gated" | "hidden";
  readonly phase?: string;
}

/** An applied extension record (extend flow; additive, append-only). */
export interface AppliedExtension {
  readonly templateKey: string;
  readonly version: string;
  readonly manifestHash: string;
  readonly extendedAt: string;
}

/** The typed view over tenant_industry_config.overrides. */
export interface AppliedOverrides {
  readonly report_pins: readonly ReportPin[];
  readonly onboarding_checklist: readonly ChecklistStep[];
  readonly enabled_modules: readonly string[];
  /** Tenant terminology additions (BR-038 R2: survive apply/switch). */
  readonly terminology: Readonly<Record<string, LocalizedText>>;
  /** Extension records (extend flow); primary template stays template_key. */
  readonly applied_extensions: readonly AppliedExtension[];
}

/** One archived-template snapshot (BR-038 R2/R6 — read-only history). */
export interface ArchivedTemplateSnapshot {
  readonly templateKey: string;
  readonly version: string;
  readonly archivedAt: string;
}

export interface ArchivedTerminologySnapshot extends ArchivedTemplateSnapshot {
  readonly terminology: Readonly<Record<string, LocalizedText>>;
}

export interface ArchivedNavigationSnapshot extends ArchivedTemplateSnapshot {
  readonly groups: readonly unknown[];
}

export interface ArchivedCapabilitySnapshot extends ArchivedTemplateSnapshot {
  readonly capabilities: ReadonlyArray<{
    capabilityId: string;
    featureKeys: readonly string[];
  }>;
}

/** One recorded multi-template conflict (§7): a switch resolves it
 *  most-recently-applied-wins for UNSET keys only; an extend keeps the
 *  primary template's value effective and records the extension's. */
export interface ConflictNote {
  readonly kind: "workflow_policy" | "inventory_default" | "terminology";
  readonly key: string;
  readonly previousTemplate: string;
  readonly newTemplate: string;
  readonly from: unknown;
  readonly to: unknown;
  readonly resolution: "most-recently-applied-wins-unset-only" | "primary-template-wins";
  readonly at: string;
}

/** Parse the overrides jsonb (corruption fails closed — typed error). */
export function parseAppliedOverrides(raw: unknown): AppliedOverrides {
  if (raw === null || raw === undefined) {
    return emptyOverrides();
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("tenant_industry_config.overrides is not a JSON object (corruption)");
  }
  const source = raw as Record<string, unknown>;
  const terminology =
    source.terminology === undefined || source.terminology === null
      ? {}
      : (source.terminology as Record<string, LocalizedText>);
  if (typeof terminology !== "object" || Array.isArray(terminology)) {
    throw new Error("tenant_industry_config.overrides.terminology is not a JSON object (corruption)");
  }
  return {
    report_pins: (source.report_pins as ReportPin[] | undefined) ?? [],
    onboarding_checklist: (source.onboarding_checklist as ChecklistStep[] | undefined) ?? [],
    enabled_modules: (source.enabled_modules as string[] | undefined) ?? [],
    terminology,
    applied_extensions: (source.applied_extensions as AppliedExtension[] | undefined) ?? [],
  };
}

function emptyOverrides(): AppliedOverrides {
  return {
    report_pins: [],
    onboarding_checklist: [],
    enabled_modules: [],
    terminology: {},
    applied_extensions: [],
  };
}

// ---------------------------------------------------------------------------
// tenant_industry_config reads (the WRITE-shape row: archives + conflicts)
// ---------------------------------------------------------------------------

/**
 * The full applied-state row (including the archived_* + conflict_notes
 * jsonb the engine's repository intentionally does not select — the apply/
 * switch flows own those columns).
 */
export interface AppliedStateRow {
  readonly templateKey: string;
  readonly appliedVersion: string;
  readonly appliedManifestHash: string;
  readonly appliedAt: string;
  readonly appliedBy: string | null;
  readonly status: string;
  readonly overrides: unknown;
  readonly archivedTerminology: readonly ArchivedTerminologySnapshot[];
  readonly archivedNavigation: readonly ArchivedNavigationSnapshot[];
  readonly archivedCapabilities: readonly ArchivedCapabilitySnapshot[];
  readonly conflictNotes: readonly ConflictNote[];
  readonly updatedAt: string;
}

/** The tenant's applied state (all columns), or undefined when none. */
export async function findAppliedStateRow(): Promise<AppliedStateRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT template_key AS "templateKey", applied_version AS "appliedVersion",
           applied_manifest_hash AS "appliedManifestHash",
           applied_at::text AS "appliedAt", applied_by::text AS "appliedBy",
           status, overrides, archived_terminology AS "archivedTerminology",
           archived_navigation AS "archivedNavigation",
           archived_capabilities AS "archivedCapabilities",
           conflict_notes AS "conflictNotes", updated_at::text AS "updatedAt"
    FROM tenant_industry_config LIMIT 1
  `);
  return (rows.rows as unknown as AppliedStateRow[])[0];
}

// ---------------------------------------------------------------------------
// tenant_industry_config upsert (one row per tenant — UNIQUE tenant_id)
// ---------------------------------------------------------------------------

export interface UpsertAppliedConfigInput {
  readonly templateKey: string;
  readonly appliedVersion: string;
  readonly appliedManifestHash: string;
  readonly appliedBy: string | null;
  readonly status: string;
  readonly overrides: AppliedOverrides;
  readonly archivedTerminology: readonly ArchivedTerminologySnapshot[];
  readonly archivedNavigation: readonly ArchivedNavigationSnapshot[];
  readonly archivedCapabilities: readonly ArchivedCapabilitySnapshot[];
  readonly conflictNotes: readonly ConflictNote[];
  /**
   * True (default) when this write APPLIES/SWITCHES the primary template
   * (applied_at bumps to now); false for extends — the primary's original
   * application timestamp stays.
   */
  readonly touchAppliedAt?: boolean;
}

/**
 * Upsert the applied state. The caller computes the FULL post-write jsonb
 * arrays (archives appended, conflicts recorded, tenant terminology
 * preserved) — the SQL never merges jsonb itself, so the audit diff and the
 * stored row can never disagree.
 */
export async function upsertAppliedConfig(input: UpsertAppliedConfigInput): Promise<void> {
  const bumpAppliedAt = input.touchAppliedAt !== false;
  await tenantTx().execute(sql`
    INSERT INTO tenant_industry_config (
      id, tenant_id, template_key, applied_version, applied_manifest_hash,
      applied_at, applied_by, status, overrides,
      archived_terminology, archived_navigation, archived_capabilities, conflict_notes
    ) VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.templateKey},
      ${input.appliedVersion}, ${input.appliedManifestHash}, now(), ${input.appliedBy},
      ${input.status},
      ${JSON.stringify(input.overrides)}::jsonb,
      ${JSON.stringify(input.archivedTerminology)}::jsonb,
      ${JSON.stringify(input.archivedNavigation)}::jsonb,
      ${JSON.stringify(input.archivedCapabilities)}::jsonb,
      ${JSON.stringify(input.conflictNotes)}::jsonb
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      updated_at = now(),
      template_key = EXCLUDED.template_key,
      applied_version = EXCLUDED.applied_version,
      applied_manifest_hash = EXCLUDED.applied_manifest_hash,
      applied_at = ${bumpAppliedAt ? sql`now()` : sql`tenant_industry_config.applied_at`},
      applied_by = EXCLUDED.applied_by,
      status = EXCLUDED.status,
      overrides = EXCLUDED.overrides,
      archived_terminology = EXCLUDED.archived_terminology,
      archived_navigation = EXCLUDED.archived_navigation,
      archived_capabilities = EXCLUDED.archived_capabilities,
      conflict_notes = EXCLUDED.conflict_notes
  `);
}

// ---------------------------------------------------------------------------
// Numbering series registry (append-only; R5)
// ---------------------------------------------------------------------------

/** Distinct doc types that already carry a tenant series row (any scope). */
export async function listSeriesDocTypes(): Promise<readonly string[]> {
  const rows = await tenantTx().execute<{ doc_type: string }>(sql`
    SELECT DISTINCT doc_type FROM numbering_sequences ORDER BY doc_type
  `);
  return rows.rows.map((row) => row.doc_type);
}

/**
 * Register one tenant-level series row. `next_value` seeds at 1 — the
 * table's `ck_numbering_sequences_next` CHECK demands ≥ 1, and the row is
 * ACQUISITION-INERT by construction: every document consumer's `reserve()`
 * scopes its acquisition rows by branch and/or period (sales invoices, GRNs,
 * transfers, counts, adjustments, journal entries — all pass a non-null
 * `periodKey`), so none ever conflicts onto this (branch NULL, period NULL)
 * registry row and no number can be skipped (ADR-0006: gaps are only the
 * sanctioned void).
 */
export async function registerSeriesRow(docType: string, rule: NumberingRule): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO numbering_sequences (id, tenant_id, doc_type, branch_id, period_key, next_value, format)
    VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${docType}, NULL, NULL, 1, ${rule.format}
    )
    ON CONFLICT ("tenant_id", "doc_type",
                 COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE("period_key", ''))
    DO NOTHING
  `);
}
