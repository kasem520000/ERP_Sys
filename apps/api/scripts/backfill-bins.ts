/**
 * PHASE-044 T-20 — the legacy-stock backfill job (§7's mitigation):
 * stock that predates the bin substrate (item_stock rows with no matching
 * tenant-owned bin_contents) lands on each warehouse's DEFAULT bin so
 * INV-029 holds from the first post-upgrade night.
 *
 * Usage:
 *   pnpm --filter @erp/api exec tsx scripts/backfill-bins.ts --dry-run
 *   pnpm --filter @erp/api exec tsx scripts/backfill-bins.ts
 *
 * The DRY-RUN pass prints the per-warehouse/item shortfall report and
 * writes NOTHING; the live pass runs one UoW per ACTIVE tenant (ADR-0005),
 * writes the shortfall rows onto the default bins, and audits. Idempotent:
 * a second run finds no shortfall. A SURPLUS (bins > stock) is genuine
 * drift this job never touches — the nightly probe owns it.
 */
import { WmsService } from "../src/modules/inventory/application/wms.service";
import { AuditService } from "../src/modules/audit/api/audit";
import { DrizzleAuditStore } from "../src/modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../src/modules/notifications/application/inbox-service";
import { listActiveTenantIds } from "../src/infra/jobs/system-tenants";
import { withTenant } from "../src/infra/db/tenant-context";
import { ensureTestDb, superuserClient } from "../src/__db__/test-db";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `[backfill-bins] PHASE-044 T-20 — legacy stock → default bins (${dryRun ? "DRY-RUN" : "LIVE"})`,
  );
  ensureTestDb();
  const superuser = await superuserClient();
  const tenantIds = await listActiveTenantIds();
  await superuser.end();
  console.log(`[backfill-bins] ${tenantIds.length} ACTIVE tenant(s)`);

  const service = new WmsService(
    new AuditService(new DrizzleAuditStore()),
    new InboxService(),
  );
  let rows = 0;
  for (const tenantId of tenantIds) {
    const result = await withTenant(tenantId, () =>
      service.backfillDefaultBins({ dryRun, actorId: null }),
    );
    rows += result.rows;
    if (dryRun) {
      console.log(
        `[backfill-bins] tenant ${tenantId}: ${result.items} shortfall item(s) across ${result.warehouses} warehouse(s) — nothing written`,
      );
      for (const row of result.report.slice(0, 20)) {
        console.log(
          `  ${row.warehouseCode ?? "?"} · ${row.itemSku ?? "?"}: bins ${row.binQty} → stock ${row.stockQty} (shortfall ${row.shortfall})`,
        );
      }
      if (result.report.length > 20) {
        console.log(`  … and ${result.report.length - 20} more`);
      }
    } else {
      console.log(
        `[backfill-bins] tenant ${tenantId}: wrote ${result.rows} row(s) over ${result.warehouses} warehouse(s)`,
      );
    }
  }
  console.log(`[backfill-bins] done — ${rows} row(s) ${dryRun ? "would land" : "written"}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
