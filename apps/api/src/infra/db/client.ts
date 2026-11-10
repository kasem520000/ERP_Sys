import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../db/schema";
import { env } from "../../config/env";

/**
 * App-role database access (ADR-0004 §4): a single lazily-created pool bound
 * to `DATABASE_URL` (role `erp_app`, non-owner, RLS enforced, statement
 * timeout 15s both at the pool and the role level — MIGRATION_STRATEGY
 * defense-in-depth). The migration connection is NEVER available from here.
 *
 * Pool sizing baseline: 20 connections (PHASE-002 §6 performance note);
 * revisit with per-tenant quotas post-NFR-006 load tests.
 */
export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: Database | undefined;

export function getPool(): Pool {
  if (pool === undefined) {
    if (!env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not configured: the app role connection is required (see .env.example)",
      );
    }
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    });
  }
  return pool;
}

export function getDb(): Database {
  if (database === undefined) {
    database = drizzle(getPool(), { schema });
  }
  return database;
}

/** Drizzle transaction handle passed through the tenant context. */
export type TenantDb = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/** Graceful shutdown (Nest lifecycle + process signals). */
export async function closeDb(): Promise<void> {
  if (database !== undefined) {
    database = undefined;
  }
  if (pool !== undefined) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
