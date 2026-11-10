import { sql } from "drizzle-orm";

import { childLogger } from "../observability/logger";
import { getDb } from "../db/client";

/**
 * RLS denial canary (PHASE-024; SECURITY_TEST_PLAN §3; RISK-010): a
 * synthetic job runs known-bad queries — as `erp_app`, WITHOUT the tenant
 * GUC — against the crown-jewel tenant tables and asserts 0 rows. RLS
 * makes the no-GUC read invisible by construction; any non-zero count is
 * an isolation BREACH and increments `erp_rls_denials_total`.
 *
 * The metric contract (SECURITY_AND_TENANT_ISOLATION §"production canary"):
 * `erp_rls_denials_total` must stay 0 — >0 is auto-SEV-1. The delivery
 * stack's OpenTelemetry providers are the documented no-op substrate, so
 * the counter lives in-process + every run logs it (the OBSERVABILITY
 * exporter swap picks the same name up); the canary ALSO writes a critical
 * log line per breach with the table + count for the on-call triage path.
 */

const log = childLogger({ module: "security-canary" });

/** Every 5 minutes (the §3 cadence). */
export const SECURITY_RLS_CANARY_QUEUE = "security.rls.canary";
export const SECURITY_RLS_CANARY_CRON = "*/5 * * * *";

/**
 * The crown-jewel sample (the §3 "known-bad queries"): financial truth,
 * master data, the audit trail, and the tenancy substrate. A rotating
 * full-registry walk would be strictly better for drift coverage — the
 * A-series suite already proves every registered table per run; the
 * canary's job is the cheap continuous probe between suites.
 */
const CANARY_TABLES: readonly string[] = [
  "journal_entries",
  "journal_lines",
  "partners",
  "items",
  "sales_invoices",
  "purchase_orders",
  "audit_events",
  "support_sessions",
  "subscriptions",
  "tenant_settings",
  "e_invoicing_submissions",
  "bank_statements",
];

/** The production metric (must stay 0). */
let rlsDenialsTotal = 0;

export function currentRlsDenialsTotal(): number {
  return rlsDenialsTotal;
}

export interface RlsCanaryResult {
  checked: number;
  breaches: { table: string; rows: number }[];
  rlsDenialsTotal: number;
}

/** The canary run: no-GUC counts over the sample — 0 rows everywhere. */
export async function runRlsCanary(): Promise<RlsCanaryResult> {
  const breaches: { table: string; rows: number }[] = [];
  for (const table of CANARY_TABLES) {
    if (!/^[a-z0-9_]+$/.test(table)) {
      throw new Error(`unsafe canary table name: ${table}`);
    }
    // Raw app-pool read with NO ambient tenant scope: RLS must make this
    // invisible. Identifier from the frozen constant list — the regex is
    // the belt.
    const result = await getDb().execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
    );
    const rows = (result.rows as unknown as { n: number }[])[0]?.n ?? 0;
    if (rows > 0) {
      // RISK-010: any anomaly is the SEV-1 class.
      rlsDenialsTotal += 1;
      breaches.push({ table, rows });
      log.fatal(
        { table, rows, metric: "erp_rls_denials_total", value: rlsDenialsTotal },
        "RLS CANARY BREACH: no-GUC read returned rows (auto-SEV-1, RISK-010) — investigate immediately",
      );
    }
  }
  if (breaches.length === 0) {
    log.debug(
      { checked: CANARY_TABLES.length, metric: "erp_rls_denials_total", value: rlsDenialsTotal },
      "rls canary green (0 rows on every no-GUC probe)",
    );
  }
  return { checked: CANARY_TABLES.length, breaches, rlsDenialsTotal };
}
