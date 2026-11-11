import { and, eq, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import * as schema from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-040 onboarding store (§2.3): the saved-mapping CRUD (import column
 * maps + export templates) and the import_jobs extras (mapping_id/options —
 * the 0060 additive columns). The job lifecycle itself reuses the items
 * module's job store functions verbatim (same table, same claim/update
 * semantics) — this store only owns what 0060 added.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("onboarding access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface ImportMappingRow {
  id: string;
  name: string;
  direction: "IMPORT" | "EXPORT";
  kind: string;
  entity: string | null;
  columnMap: Record<string, unknown>;
  options: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const MAPPING_COLUMNS = {
  id: schema.importMappings.id,
  name: schema.importMappings.name,
  direction: schema.importMappings.direction,
  kind: schema.importMappings.kind,
  entity: schema.importMappings.entity,
  columnMap: schema.importMappings.columnMap,
  options: schema.importMappings.options,
  createdBy: schema.importMappings.createdBy,
  createdAt: schema.importMappings.createdAt,
  updatedAt: schema.importMappings.updatedAt,
  version: schema.importMappings.version,
} as const;

export async function insertImportMapping(input: {
  name: string;
  direction: "IMPORT" | "EXPORT";
  kind: string;
  entity: string | null;
  columnMap: Record<string, unknown>;
  options: Record<string, unknown> | null;
  createdBy: string;
}): Promise<ImportMappingRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.importMappings)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(MAPPING_COLUMNS);
  return rows[0] as ImportMappingRow;
}

export async function findImportMappingById(id: string): Promise<ImportMappingRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(MAPPING_COLUMNS)
    .from(schema.importMappings)
    .where(eq(schema.importMappings.id, id))
    .limit(1);
  return (rows as ImportMappingRow[])[0];
}

export async function findImportMappingByName(
  direction: string,
  kind: string,
  name: string,
): Promise<ImportMappingRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(MAPPING_COLUMNS)
    .from(schema.importMappings)
    .where(
      and(
        eq(schema.importMappings.direction, direction),
        eq(schema.importMappings.kind, kind),
        eq(schema.importMappings.name, name),
      ),
    )
    .limit(1);
  return (rows as ImportMappingRow[])[0];
}

export async function listImportMappings(
  direction: string | undefined,
  kind: string | undefined,
): Promise<ImportMappingRow[]> {
  const tx = tenantTx();
  const filters = [
    direction === undefined ? undefined : eq(schema.importMappings.direction, direction),
    kind === undefined ? undefined : eq(schema.importMappings.kind, kind),
  ].filter((filter) => filter !== undefined);
  const rows = await tx
    .select(MAPPING_COLUMNS)
    .from(schema.importMappings)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(schema.importMappings.createdAt);
  return rows as ImportMappingRow[];
}

export async function updateImportMapping(
  id: string,
  patch: {
    name?: string;
    columnMap?: Record<string, unknown>;
    options?: Record<string, unknown> | null;
  },
): Promise<ImportMappingRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.importMappings)
    .set({
      ...patch,
      version: sql`${schema.importMappings.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.importMappings.id, id))
    .returning(MAPPING_COLUMNS);
  return (rows as ImportMappingRow[])[0];
}

export async function deleteImportMapping(id: string): Promise<boolean> {
  const tx = tenantTx();
  const rows = await tx
    .delete(schema.importMappings)
    .where(eq(schema.importMappings.id, id))
    .returning({ id: schema.importMappings.id });
  return rows.length > 0;
}

// -- import_jobs extras (the 0060 additive columns) ------------------------------

export async function stampImportJobExtras(
  jobId: string,
  extras: {
    mappingId: string | null;
    options: Record<string, unknown>;
    /** PHASE-040 (migration 0062): the effective-mapping snapshot. */
    mapping?: Record<string, string> | null;
  },
): Promise<void> {
  const tx = tenantTx();
  await tx
    .update(schema.importJobs)
    .set({
      mappingId: extras.mappingId,
      options: extras.options,
      ...(extras.mapping !== undefined ? { mapping: extras.mapping } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.importJobs.id, jobId));
}

export interface ImportJobExtras {
  mappingId: string | null;
  /** The preview-time snapshot (migration 0062); pre-0062 rows fall back
   *  to re-resolving the saved mapping by mappingId. */
  mapping: Record<string, string> | null;
  options: Record<string, unknown>;
}

export async function findImportJobExtras(jobId: string): Promise<ImportJobExtras | undefined> {
  const tx = tenantTx();
  const jobRows = await tx
    .select({
      mappingId: schema.importJobs.mappingId,
      options: schema.importJobs.options,
      // PHASE-040 (migration 0062): the preview-time snapshot — preferred
      // over re-resolving the saved mapping (BR-066 re-validation honesty).
      mappingSnapshot: schema.importJobs.mapping,
    })
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .limit(1);
  const row = jobRows[0];
  if (row === undefined) {
    return undefined;
  }
  let mapping =
    (row.mappingSnapshot as Record<string, string> | null) ?? null;
  if (mapping === null && row.mappingId !== null) {
    // Pre-0062 rows: re-resolve the saved mapping the way they always did.
    const saved = await findImportMappingById(row.mappingId);
    if (saved !== undefined && saved.direction === "IMPORT") {
      mapping = saved.columnMap as Record<string, string>;
    }
  }
  return {
    mappingId: row.mappingId,
    mapping,
    options: (row.options as Record<string, unknown> | null) ?? {},
  };
}
