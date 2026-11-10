import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { withPlatformScope, withTenantOnTx } from "../../../infra/db/tenant-context";

/**
 * Offboarding store (PHASE-024 T11; DATA_PROTECTION §4; Journey H): the
 * flow-state rows, the subscription grace lever, and the platform legal-hold
 * flag. The PURGE itself never runs on this connection — it opens the
 * dedicated migration-scope connection (PurgeService; DATA_PROTECTION §4
 * step 6 "erp_migrate-scoped tooling outside normal app traffic").
 */

export type OffboardingStatus =
  | "REQUESTED"
  | "EXPORTED"
  | "EXECUTED"
  | "PURGED"
  | "CANCELLED";

export interface OffboardingRow {
  id: string;
  tenantId: string;
  status: OffboardingStatus;
  requestedBy: string;
  requestedAt: string;
  graceUntil: string | null;
  exportFileId: string | null;
  manifestChecksum: string | null;
  exportedAt: string | null;
  executedBy: string | null;
  executedAt: string | null;
  retentionUntil: string | null;
  purgedAt: string | null;
  cancelledAt: string | null;
}

const OFFBOARDING_COLUMNS = `id, tenant_id AS "tenantId", status, requested_by AS "requestedBy",
           requested_at AS "requestedAt", grace_until AS "graceUntil",
           export_file_id AS "exportFileId", manifest_checksum AS "manifestChecksum",
           exported_at AS "exportedAt", executed_by AS "executedBy",
           executed_at AS "executedAt", retention_until AS "retentionUntil",
           purged_at AS "purgedAt", cancelled_at AS "cancelledAt"`;

/** The live (non-cancelled) offboarding row of a tenant, if any. */
export async function findLiveOffboarding(tenantId: string): Promise<OffboardingRow | undefined> {
  return withPlatformScope(async (tx) => {
    const result = await tx.execute(sql`
      SELECT ${sql.raw(OFFBOARDING_COLUMNS)}
      FROM tenant_offboarding
      WHERE tenant_id = ${tenantId} AND status <> 'CANCELLED'
      ORDER BY requested_at DESC
      LIMIT 1
    `);
    return (result.rows as unknown as OffboardingRow[])[0];
  });
}

export async function insertOffboarding(input: {
  tenantId: string;
  requestedBy: string;
  graceUntil: string;
}): Promise<OffboardingRow> {
  return withPlatformScope(async (tx) =>
    withTenantOnTx(input.tenantId, tx, async () => {
      const result = await tx.execute(sql`
        INSERT INTO tenant_offboarding (id, tenant_id, status, requested_by, grace_until)
        VALUES (${generateUuidV7()}, ${input.tenantId}, 'REQUESTED', ${input.requestedBy},
                ${input.graceUntil}::timestamptz)
        RETURNING ${sql.raw(OFFBOARDING_COLUMNS)}
      `);
      return (result.rows as unknown as OffboardingRow[])[0]!;
    }),
  );
}

/** State-machine transitions + timestamp stamps on the live row. */
export async function updateOffboarding(
  tenantId: string,
  patch: {
    status?: OffboardingStatus;
    graceUntil?: string;
    exportFileId?: string;
    manifestChecksum?: string;
    exportedAt?: string;
    executedBy?: string;
    executedAt?: string;
    retentionUntil?: string;
    purgedAt?: string;
    cancelledAt?: string;
  },
): Promise<void> {
  await withPlatformScope(async (tx) =>
    withTenantOnTx(tenantId, tx, async () => {
      await tx.execute(sql`
        UPDATE tenant_offboarding SET
          status = COALESCE(${patch.status ?? null}::text, status),
          grace_until = COALESCE(${patch.graceUntil ?? null}::timestamptz, grace_until),
          export_file_id = COALESCE(${patch.exportFileId ?? null}::uuid, export_file_id),
          manifest_checksum = COALESCE(${patch.manifestChecksum ?? null}::text, manifest_checksum),
          exported_at = COALESCE(${patch.exportedAt ?? null}::timestamptz, exported_at),
          executed_by = COALESCE(${patch.executedBy ?? null}::uuid, executed_by),
          executed_at = COALESCE(${patch.executedAt ?? null}::timestamptz, executed_at),
          retention_until = COALESCE(${patch.retentionUntil ?? null}::timestamptz, retention_until),
          purged_at = COALESCE(${patch.purgedAt ?? null}::timestamptz, purged_at),
          cancelled_at = COALESCE(${patch.cancelledAt ?? null}::timestamptz, cancelled_at),
          updated_at = now(), version = version + 1
        WHERE tenant_id = ${tenantId} AND status <> 'CANCELLED'
      `);
    }),
  );
}

/** The offboarding read-only grace rides the PHASE-014 subscription state. */
export async function setSubscriptionGrace(
  tenantId: string,
  status: "GRACE_READ_ONLY" | "ACTIVE",
  graceEndsAt: string | null,
): Promise<void> {
  await withPlatformScope(async (tx) =>
    withTenantOnTx(tenantId, tx, async () => {
      await tx.execute(
        sql`UPDATE subscriptions SET status = ${status}, grace_ends_at = ${graceEndsAt},
                updated_at = now() WHERE tenant_id = ${tenantId} AND status NOT IN ('CANCELLED')`,
      );
    }),
  );
}

/** The Journey-H guardrail: the platform-level legal-hold flag. */
export async function setTenantLegalHold(
  tenantId: string,
  legalHold: boolean,
): Promise<{ name: string; status: string } | undefined> {
  return withPlatformScope(async (tx) => {
    const result = await tx.execute(sql`
      UPDATE tenants SET legal_hold = ${legalHold}, updated_at = now()
      WHERE id = ${tenantId}
      RETURNING name, status
    `);
    return (result.rows as unknown as { name: string; status: string }[])[0];
  });
}

export async function findTenantForPlatform(
  tenantId: string,
): Promise<{ id: string; name: string; status: string; legalHold: boolean } | undefined> {
  return withPlatformScope(async (tx) => {
    const result = await tx.execute(sql`
      SELECT id, name, status, legal_hold AS "legalHold" FROM tenants WHERE id = ${tenantId}
    `);
    return (result.rows as unknown as { id: string; name: string; status: string; legalHold: boolean }[])[0];
  });
}

/** EXECUTED rows whose retention window has elapsed — the purge sweep input. */
export async function findPurgeEligible(nowIso: string): Promise<OffboardingRow[]> {
  return withPlatformScope(async (tx) => {
    const result = await tx.execute(sql`
      SELECT ${sql.raw(OFFBOARDING_COLUMNS)}
      FROM tenant_offboarding
      WHERE status = 'EXECUTED' AND retention_until <= ${nowIso}::timestamptz
    `);
    return result.rows as unknown as OffboardingRow[];
  });
}

/** All live offboarding rows (the platform console list). */
export async function listOffboarding(): Promise<OffboardingRow[]> {
  return withPlatformScope(async (tx) => {
    const result = await tx.execute(sql`
      SELECT ${sql.raw(OFFBOARDING_COLUMNS)}
      FROM tenant_offboarding ORDER BY requested_at DESC LIMIT 200
    `);
    return result.rows as unknown as OffboardingRow[];
  });
}

