import { sql } from "drizzle-orm";

import { withPlatformScope } from "../db/tenant-context";

/**
 * System-job tenant enumeration (PHASE-015 T9): the cross-tenant ids a
 * platform-plane scheduled job iterates — a pg-boss cron payload cannot
 * name every tenant, so handlers re-establish per-tenant UoWs (ADR-0005)
 * from this platform-scope read. Shared infra (the setting-reader
 * pattern): business modules import THIS, never each other's stores, so
 * the dependency graph stays clean (DEPENDENCY_RULES §2).
 *
 * Only ACTIVE tenants — suspended/read-only tenants keep their pools
 * frozen (their data is intact; the sweep is a maintenance pass, not a
 * billing action).
 */
export async function listActiveTenantIds(): Promise<string[]> {
  return withPlatformScope(async (tx) => {
    const rows = await tx.execute(sql`SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY created_at`);
    return (rows.rows as unknown as { id: string }[]).map((row) => row.id);
  });
}
