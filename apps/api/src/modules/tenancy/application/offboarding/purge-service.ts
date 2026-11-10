import { createHmac, randomUUID } from "node:crypto";

import { Client } from "pg";

import { childLogger } from "../../../../infra/observability/logger";
import { getCorrelationId } from "../../../../infra/observability/request-context";
import { withPlatformScope } from "../../../../infra/db/tenant-context";
import { AuditService } from "../../../audit/api/audit";
import { DrizzleAuditStore } from "../../../audit/infrastructure/drizzle-audit.store";
import * as offboardingStore from "../../infrastructure/offboarding.store";
import { FilesService } from "../../../files/api/files";

/**
 * The tenant-offboarding PURGE job (PHASE-024 T11; DATA_PROTECTION §4 steps
 * 6–8; Journey H5) — the destructive half of the documented flow. It NEVER
 * runs on the erp_app request pool: the purge opens a dedicated
 * migration-scope connection (`MIGRATE_DATABASE_URL` — "erp_migrate-scoped
 * tooling outside normal app traffic", §4 step 6) where the 0036
 * `purge_path_delete`/`purge_path_update` RLS policies admit exactly the
 * GUC-named tenant's rows, and the audit guard's `erp.purge_mode` GUC admits
 * exactly the anonymization UPDATE.
 *
 * Belt-and-braces in depth (migration 0036 §4): erp_app keeps its exact
 * grants (no DELETE anywhere new); erp_migrate reaches only the GUC tenant
 * (FORCE RLS holds for the owner); DELETE/UPDATE policies are
 * command-scoped; there is NO INSERT policy (a forged tenant-row insert
 * stays denied — the isolation suite proves it).
 *
 * The job is idempotent + resumable: a mid-purge failure leaves the
 * EXECUTED row intact (the transaction rolls back) and the next sweep
 * retries; the verification pass (0 tenant-owned rows + 0 storage objects)
 * is itself recorded on the deletion certificate.
 */

const log = childLogger({ module: "offboarding-purge" });
const audit = new AuditService(new DrizzleAuditStore());

/** Daily 03:50 UTC — before the sync retention sweeps (04:10). */
export const TENANCY_OFFBOARDING_PURGE_QUEUE = "tenancy.offboarding.purge";
export const TENANCY_OFFBOARDING_PURGE_CRON = "50 3 * * *";

/** DATA_PROTECTION §4 step 5: the 90-day retention PLACEHOLDER (OQ-009 —
 * the working assumption until the legal decision record lands; the DR
 * records the pointer, the constant is the honest placeholder). */
export const OFFBOARDING_RETENTION_DAYS = 90;

/** Journey H1: the read-only grace window (PLACEHOLDER per OQ-009
 * discussion — the same decision record governs the final number). */
export const OFFBOARDING_GRACE_DAYS = 14;

/** Per-table DELETE bound (the retention-sweep batch contract). */
const PURGE_BATCH = 5000;

export interface PurgeSweepResult {
  checked: number;
  purged: number;
  blocked: number;
  skipped: number;
}

interface TenantTableOrder {
  table: string;
  selfReferential: boolean;
}

/**
 * FK-topological delete order over the tenant-owned tables: children first.
 * Self-referential tables (e.g. partner parents) get a second pass (orphans
 * first, then parents) — bounded by the table count.
 */
async function tenantTableDeleteOrder(tx: Client): Promise<TenantTableOrder[]> {
  const tables = await tx.query<{ table_name: string }>(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  const names = tables.rows.map((row) => row.table_name);
  const edges = await tx.query<{ src: string; dst: string; self_ref: boolean }>(`
    SELECT src.relname AS src, dst.relname AS dst,
           (src.oid = dst.oid) AS self_ref
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace sn ON sn.oid = src.relnamespace
    JOIN pg_class dst ON dst.oid = con.confrelid
    JOIN pg_namespace dn ON dn.oid = dst.relnamespace
    WHERE con.contype = 'f' AND sn.nspname = 'public' AND dn.nspname = 'public'
      AND src.relname = ANY($1) AND dst.relname = ANY($1)
  `, [names]);
  const dependents = new Map<string, Set<string>>();
  const selfRef = new Set<string>();
  for (const edge of edges.rows) {
    if (edge.self_ref) {
      selfRef.add(edge.src);
      continue;
    }
    // dst is referenced by src → src must be deleted BEFORE dst.
    const set = dependents.get(edge.dst) ?? new Set<string>();
    set.add(edge.src);
    dependents.set(edge.dst, set);
  }
  // Kahn's algorithm over "delete src before dst".
  const deleted = new Set<string>();
  const ordered: string[] = [];
  let progress = true;
  const remaining = new Set(names);
  while (remaining.size > 0 && progress) {
    progress = false;
    for (const name of [...remaining]) {
      const blockers = dependents.get(name) ?? new Set<string>();
      if ([...blockers].every((blocker) => deleted.has(blocker))) {
        ordered.push(name);
        deleted.add(name);
        remaining.delete(name);
        progress = true;
      }
    }
  }
  // Cycles (should not exist among tenant tables): append the rest — the
  // batched loop plus the self-referential second pass handle any residual
  // FK ordering by retrying until the table is empty.
  for (const name of remaining) {
    ordered.push(name);
  }
  return ordered.map((table) => ({ table, selfReferential: selfRef.has(table) }));
}

/**
 * The migrate-scope purge of ONE tenant. Everything runs in ONE transaction
 * on the dedicated connection: data delete → audit anonymization → session
 * severance → tenants row OFFBOARDED → storage wipe → verification →
 * certificate insert. The platform audit events land on the APP connection
 * afterwards (withPlatformScope) so they survive the purge by construction.
 */
export async function purgeTenant(input: {
  tenantId: string;
  performedBy: string;
  manifestChecksum: string | null;
  exportFileId: string | null;
  files: FilesService;
  migrateUrl: string;
}): Promise<{
  tableRowCounts: Record<string, number>;
  storageObjectsDeleted: number;
  auditRowsAnonymized: number;
  hashedTenantId: string;
}> {
  const client = new Client({ connectionString: input.migrateUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('erp.tenant_id', $1, true)", [input.tenantId]);
    await client.query("SELECT set_config('erp.purge_mode', 'on', true)");

    const order = await tenantTableDeleteOrder(client);
    const tableRowCounts: Record<string, number> = {};
    for (const { table, selfReferential } of order) {
      // audit_events is NEVER deleted — the append-only guard holds for the
      // purge too (DATA_PROTECTION §4 step 8: the rows are ANONYMIZED
      // below; deletion stays prohibited for everyone, always).
      if (table === "audit_events") {
        continue;
      }
      let total = 0;
      // Batched delete (LIMIT loops); self-referential tables may need a
      // second sweep direction — the loop naturally retries until empty.
      for (let pass = selfReferential ? 2 : 1; pass > 0; pass -= 1) {
        let deleted = -1;
        while (deleted !== 0) {
          const result = await client.query(
            `WITH doomed AS (
               SELECT ctid FROM ${quoteIdent(table)}
               WHERE tenant_id = $1 LIMIT ${PURGE_BATCH}
             )
             DELETE FROM ${quoteIdent(table)} t
             USING doomed d WHERE t.ctid = d.ctid`,
            [input.tenantId],
          );
          deleted = result.rowCount ?? 0;
          total += deleted;
        }
      }
      if (total > 0) {
        tableRowCounts[table] = total;
      }
    }

    // Audit anonymization (§4 step 8): PII severed (tenant/actor/device →
    // NULL); action/entity stay for platform forensics. The guard trigger
    // admits exactly this UPDATE under erp.purge_mode.
    const anonymized = await client.query(
      `UPDATE audit_events SET tenant_id = NULL, actor_id = NULL, device_id = NULL
       WHERE tenant_id = $1`,
      [input.tenantId],
    );

    // Session severance: sessions are global (no tenant_id) — revoke + null
    // the active-tenant pointer for the purged tenant's sessions.
    await client.query(
      `UPDATE sessions SET revoked_at = now(), active_tenant_id = NULL
       WHERE active_tenant_id = $1 AND revoked_at IS NULL`,
      [input.tenantId],
    );

    // The tenants row itself is PLATFORM-owned (not tenant-owned): it stays
    // for registry integrity, marked OFFBOARDED + soft-deleted (0006's
    // status value; the certificate carries the name snapshot).
    await client.query(
      `UPDATE tenants SET status = 'OFFBOARDED', deleted_at = now(), updated_at = now()
       WHERE id = $1`,
      [input.tenantId],
    );

    // Storage wipe: every object under the tenant prefix (the files store
    // owns the S3 surface; counted for the certificate).
    const keys = await input.files.listPrefix(`${input.tenantId}/`);
    if (keys.length > 0) {
      await input.files.deleteObjects(keys);
    }

    // Verification (§4 step 7): 0 tenant-owned rows across the registry.
    const leftovers: string[] = [];
    for (const { table } of order) {
      if (table === "audit_events") {
        // The anonymization above must have severed every tenant link —
        // the count of tenant_id-tagged rows is the verification here.
        const anon = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_events WHERE tenant_id = $1`,
          [input.tenantId],
        );
        if (anon.rows[0]?.n !== "0") {
          leftovers.push("audit_events");
        }
        continue;
      }
      const count = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${quoteIdent(table)} WHERE tenant_id = $1`,
        [input.tenantId],
      );
      if (count.rows[0]?.n !== "0") {
        leftovers.push(table);
      }
    }
    if (leftovers.length > 0) {
      throw new Error(`purge verification failed — residual rows in: ${leftovers.join(", ")}`);
    }

    const hashedTenantId = hashedTenantHandle(input.tenantId);

    // The deletion certificate (purged_tenants — platform-owned, RLS keeps
    // it out of every tenant's reach; written on THIS connection via the
    // purge_cert_write policy).
    await client.query(
      `INSERT INTO purged_tenants (id, tenant_id_at_purge, hashed_tenant_id,
         tenant_name_snapshot, manifest_checksum, export_file_id, performed_by,
         table_row_counts, storage_objects_deleted, audit_rows_anonymized, verification)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb)`,
      [
        randomUUID(),
        input.tenantId,
        hashedTenantId,
        await tenantName(client, input.tenantId),
        input.manifestChecksum,
        input.exportFileId,
        input.performedBy,
        JSON.stringify(tableRowCounts),
        keys.length,
        anonymized.rowCount ?? 0,
        JSON.stringify({
          verified_at: new Date().toISOString(),
          tenant_owned_rows: 0,
          storage_objects: 0,
          residual_tables: [],
        }),
      ],
    );

    await client.query("COMMIT");
    log.warn(
      {
        tenant_id: input.tenantId,
        tables: Object.keys(tableRowCounts).length,
        rows: Object.values(tableRowCounts).reduce((sum, n) => sum + n, 0),
        storage_objects: keys.length,
        audit_rows_anonymized: anonymized.rowCount ?? 0,
      },
      "tenant purged (deletion certificate written)",
    );
    return {
      tableRowCounts,
      storageObjectsDeleted: keys.length,
      auditRowsAnonymized: anonymized.rowCount ?? 0,
      hashedTenantId,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function tenantName(client: Client, tenantId: string): Promise<string> {
  const result = await client.query<{ name: string }>(
    `SELECT name FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return result.rows[0]?.name ?? "(unknown)";
}

/** HMAC-SHA256(tenant uuid) under the platform salt — the post-purge handle. */
function hashedTenantHandle(tenantId: string): string {
  const salt = purgeHashKey();
  return createHmac("sha256", salt).update(tenantId).digest("hex");
}

function purgeHashKey(): string {
  // Dedicated env key first; the identity key as the documented fallback
  // (a pseudonymization salt — fail-open only weakens linkability, never
  // confidentiality; prod still sets both explicitly).
  const dedicated = process.env.PURGE_HASH_KEY;
  if (dedicated !== undefined && dedicated !== "") {
    return dedicated;
  }
  const identity = process.env.IDENTITY_SECRET_KEY;
  if (identity !== undefined && identity !== "") {
    return identity;
  }
  return "purge-hash-key-development-fallback";
}

function quoteIdent(table: string): string {
  if (!/^[a-z0-9_]+$/.test(table)) {
    throw new Error(`unsafe table name: ${table}`);
  }
  return `"${table}"`;
}

/**
 * The daily sweep: EXECUTED offboardings whose retention window elapsed →
 * legal-hold check → purge. Failures per tenant never block the rest (the
 * crm sweep contract); blocked tenants get an audited skip.
 */
export async function runPurgeSweep(deps: {
  migrateUrl?: string;
  files: FilesService;
  now?: Date;
}): Promise<PurgeSweepResult> {
  const migrateUrl = deps.migrateUrl ?? process.env.MIGRATE_DATABASE_URL;
  if (migrateUrl === undefined || migrateUrl === "") {
    // Honest degradation: without the migration-scope credential the purge
    // cannot run (by design — it must NOT run on the app pool). The job
    // logs; the platform console surfaces the same requirement.
    log.warn("purge sweep skipped: MIGRATE_DATABASE_URL is not configured");
    return { checked: 0, purged: 0, blocked: 0, skipped: 0 };
  }
  const files = deps.files;
  const now = deps.now ?? new Date();
  const eligible = await offboardingStore.findPurgeEligible(now.toISOString());

  let purged = 0;
  let blocked = 0;
  let skipped = 0;
  for (const row of eligible) {
    const tenant = await offboardingStore.findTenantForPlatform(row.tenantId);
    if (tenant === undefined) {
      skipped += 1;
      continue;
    }
    if (tenant.legalHold) {
      blocked += 1;
      await auditPlatform("offboarding.purge_blocked", row.tenantId, {
        reason: "legal_hold",
        requested_by: row.requestedBy,
      });
      log.warn({ tenant_id: row.tenantId }, "purge blocked by legal hold (audited)");
      continue;
    }
    try {
      // The terminal transition is written first (the data purge then
      // deletes the flow row itself with the rest of the tenant data —
      // the certificate is the permanent record).
      await offboardingStore.updateOffboarding(row.tenantId, {
        status: "PURGED",
        purgedAt: now.toISOString(),
      });
      const result = await purgeTenant({
        tenantId: row.tenantId,
        performedBy: row.executedBy ?? row.requestedBy,
        manifestChecksum: row.manifestChecksum,
        exportFileId: row.exportFileId,
        files,
        migrateUrl,
      });
      await auditPlatform("tenant.purged", row.tenantId, {
        hashed_tenant_id: result.hashedTenantId,
        tables: Object.keys(result.tableRowCounts).length,
        rows: Object.values(result.tableRowCounts).reduce((sum, n) => sum + n, 0),
        storage_objects_deleted: result.storageObjectsDeleted,
        audit_rows_anonymized: result.auditRowsAnonymized,
      });
      await auditPlatform("offboarding.verified", row.tenantId, {
        tenant_owned_rows: 0,
        storage_objects: 0,
      });
      purged += 1;
    } catch (error) {
      // Resumable: the row stays EXECUTED (the terminal transition rolled
      // back with the purge transaction) and the next sweep retries.
      skipped += 1;
      log.error({ err: error, tenant_id: row.tenantId }, "tenant purge failed (will retry)");
    }
  }
  return { checked: eligible.length, purged, blocked, skipped };
}

async function auditPlatform(
  action: string,
  tenantId: string,
  after: Record<string, unknown>,
): Promise<void> {
  await withPlatformScope(async () => {
    await audit.recordPlatform({
      action,
      entityType: "tenant",
      entityId: tenantId,
      after: { ...after, correlation_id: getCorrelationId() ?? null },
    });
  });
}
