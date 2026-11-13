/**
 * PHASE-044 T-20 + post-closure audit fix — the legacy-stock → default-bins
 * backfill OPERATOR tool (the INV-029 upgrade runbook's engine,
 * docs/operations/WMS_UPGRADE_BACKFILL_RUNBOOK.md):
 * stock that predates the bin substrate (item_stock rows with no matching
 * tenant-owned bin_contents) lands on each warehouse's DEFAULT bin —
 * DISTRIBUTED per batch/serial from the proven stock_moves ledger for
 * tracked items, never a blind NULL-dimension row.
 *
 * Usage (production — the app-role connection, RLS enforced):
 *   pnpm --filter @erp/api backfill:bins -- --dry-run
 *   pnpm --filter @erp/api backfill:bins -- --dry-run --tenant=<uuid>
 *   pnpm --filter @erp/api backfill:bins -- --tenant=<uuid>
 *   pnpm --filter @erp/api backfill:bins            # every ACTIVE tenant
 *   pnpm --filter @erp/api backfill:bins -- --report=backfill-report.json
 *
 * Exit codes (the runbook's contract):
 *   0 — clean: no shortfall, or every shortfall fully resolved (WRITABLE);
 *       a dry-run always exits 0 — its report is the review artifact.
 *   1 — error: no DATABASE_URL, unreachable database, or a tenant UoW
 *       failed (that tenant rolled back whole; the run is resumable —
 *       re-invoke; already-healed tenants are no-ops).
 *   2 — the LIVE pass completed but unprovable residue remains
 *       (PARTIAL_UNATTRIBUTED) or sources disagreed (NON_RECONCILABLE):
 *       nothing unproven was written — the operator MUST review the report
 *       and either correct through a documented adjustment or accept the
 *       drift (the nightly probe keeps reporting it; see the runbook §5).
 *
 * Safety properties (tested in __db__/inventory/wms-tracked-backfill.spec):
 * - dry-run writes NOTHING;
 * - one tenant UoW per pass (ADR-0005) — a failure rolls back that tenant
 *   whole, never a partial write that hides the shortfall;
 * - per-tenant advisory lock — two concurrent invocations converge (the
 *   loser re-reads the healed fold and writes nothing);
 * - idempotent — a second run finds the proven parts already placed;
 * - NEVER automatic: nothing schedules this tool; the nightly
 *   inventory.bin-reconcile probe only DETECTS drift (the detector, never
 *   the repairer — INV-029's documented split).
 */
import { writeFileSync } from "node:fs";

import { config as loadDotenv } from "dotenv";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const tenantArg = args.find((a) => a.startsWith("--tenant="))?.slice("--tenant=".length) ?? null;
  const reportArg = args.find((a) => a.startsWith("--report="))?.slice("--report=".length) ?? null;

  // Production env discipline (main.ts's shape): .env is a dev convenience;
  // production values arrive via the environment. Loaded BEFORE the app
  // modules import (their env singleton parses process.env at import).
  loadDotenv();

  const { reloadEnv } = await import("../src/config/env");
  reloadEnv();

  console.log(
    `[backfill-bins] PHASE-044 T-20 + audit fix — legacy stock → default bins (${dryRun ? "DRY-RUN" : "LIVE"})`,
  );

  // The app-role connection ONLY (ADR-0005: RLS enforced, statement
  // timeout, never the migrate role). Fail fast with the runbook pointer.
  if (!process.env.DATABASE_URL) {
    console.error(
      "[backfill-bins] FATAL: DATABASE_URL is not set — the operator tool runs on the app-role connection " +
        "(erp_app, RLS enforced). See docs/operations/WMS_UPGRADE_BACKFILL_RUNBOOK.md §2 (prerequisites).",
    );
    process.exitCode = 1;
    return;
  }

  const { WmsService } = await import("../src/modules/inventory/application/wms.service");
  const { AuditService } = await import("../src/modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../src/modules/audit/infrastructure/drizzle-audit.store");
  const { InboxService } = await import("../src/modules/notifications/application/inbox-service");
  const { listActiveTenantIds } = await import("../src/infra/jobs/system-tenants");
  const { withTenant } = await import("../src/infra/db/tenant-context");
  const { closeDb } = await import("../src/infra/db/client");

  const service = new WmsService(new AuditService(new DrizzleAuditStore()), new InboxService());
  const allTenants = await listActiveTenantIds();
  const tenantIds = tenantArg === null ? allTenants : allTenants.filter((id) => id === tenantArg);
  if (tenantArg !== null && tenantIds.length === 0) {
    console.error(
      `[backfill-bins] FATAL: tenant ${tenantArg} is not an ACTIVE tenant (found ${allTenants.length} ACTIVE).`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[backfill-bins] ${tenantIds.length} ACTIVE tenant(s)${tenantArg !== null ? " (filtered)" : ""}`,
  );

  let unresolved = 0;
  let failures = 0;
  let rows = 0;
  const reportByTenant: Record<string, unknown> = {};
  for (const tenantId of tenantIds) {
    try {
      const result = await withTenant(tenantId, () =>
        service.backfillDefaultBins({ dryRun, actorId: null }),
      );
      rows += result.rows;
      unresolved += result.partialItems + result.nonReconcilableItems;
      reportByTenant[tenantId] = result;
      const summary =
        `${result.items} shortfall item(s) across ${result.warehouses} warehouse(s)` +
        ` — ${result.rows} row(s) ${dryRun ? "would land" : "written"}` +
        (result.partialItems + result.nonReconcilableItems > 0
          ? ` · UNRESOLVED: ${result.partialItems} partial, ${result.nonReconcilableItems} non-reconcilable`
          : "");
      console.log(`[backfill-bins] tenant ${tenantId}: ${summary}`);
      for (const row of result.report.slice(0, 20)) {
        console.log(
          `  ${row.warehouseCode ?? "?"} · ${row.itemSku ?? "?"} [${row.tracking}/${row.classification}]: ` +
            `bins ${row.binQty} → stock ${row.stockQty} (shortfall ${row.shortfall}, residue ${row.residueQty})`,
        );
        for (const write of row.plannedWrites) {
          console.log(
            `    planned: ${write.batchNo ?? write.serialNo ?? "untracked"} × ${write.qty}`,
          );
        }
        for (const note of row.notes.slice(0, 3)) {
          console.log(`    note: ${note}`);
        }
      }
      if (result.report.length > 20) {
        console.log(`  … and ${result.report.length - 20} more (see --report)`);
      }
    } catch (error) {
      // One tenant's UoW failed WHOLE (rolled back) — record it and let the
      // remaining tenants run; the operator re-invokes to resume (healed
      // tenants are no-ops).
      failures += 1;
      console.error(
        `[backfill-bins] tenant ${tenantId} FAILED (rolled back whole — resumable): ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (reportArg !== null) {
    writeFileSync(reportArg, JSON.stringify({ dryRun, tenants: reportByTenant }, null, 2));
    console.log(`[backfill-bins] full report written to ${reportArg}`);
  }

  await closeDb();
  console.log(
    `[backfill-bins] done — ${rows} row(s) ${dryRun ? "would land" : "written"}` +
      (unresolved > 0 ? ` · ${unresolved} UNRESOLVED item(s) — REVIEW THE REPORT (runbook §5)` : ""),
  );
  if (failures > 0) {
    process.exitCode = 1;
    return;
  }
  if (!dryRun && unresolved > 0) {
    process.exitCode = 2;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
