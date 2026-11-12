import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import * as policies from "../infrastructure/policies.store";

/**
 * Inventory alert jobs (PHASE-044 T-12; §2.13, I-17/I-21/I-25): the two
 * daily pg-boss sweeps — the shelf-life probe (batches expiring within
 * the threshold that still carry on-hand) and the slow-movement probe
 * (stocked items with no outbound consumption in the window). Both fail
 * closed to the documented defaults when the tenant registers no
 * inventory_alert_jobs row, both stamp the run stats, and both surface
 * ONE `stock` notification in the owner's inbox per pass (the
 * bin-reconcile probe's shape) — never a repair, only the alert.
 */
const DEFAULT_SHELF_LIFE_DAYS = 14;
const DEFAULT_SLOW_MOVEMENT_DAYS = 90;

@Injectable()
export class AlertsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /** The shelf-life pass (pg-boss `inventory.shelf-life-alerts`, daily 02:30 UTC). */
  async runShelfLifeAlerts(): Promise<{ tenants: number; flagged: number }> {
    const tenantIds = await listActiveTenantIds();
    let flagged = 0;
    for (const tenantId of tenantIds) {
      const result = await withTenant(tenantId, async () => {
        const job = await policies.findAlertJob("SHELF_LIFE");
        if (job !== undefined && !job.isActive) return 0;
        const withinDays = job?.shelfLifeDays ?? DEFAULT_SHELF_LIFE_DAYS;
        const expiring = await policies.scanExpiringBatches(withinDays);
        await policies.stampAlertRun({ jobKind: "SHELF_LIFE", flagged: expiring.length });
        if (expiring.length === 0) return 0;
        await this.notify(tenantId, {
          severity: "warning",
          titleAr: `دفعات قاربت انتهاء الصلاحية (${expiring.length})`,
          titleEn: `${expiring.length} batch(es) near expiry`,
          bodyAr:
            `دفعات تنتهي خلال ${withinDays} يوماً وما زال بها رصيد (I-17): ` +
            expiring
              .slice(0, 5)
              .map((row) => `${row.itemSku ?? row.itemId} / ${row.batchNo} حتى ${row.expiryDate} (رصيد ${row.onHand})`)
              .join("؛ ") +
            (expiring.length > 5 ? " وغيرها" : ""),
          bodyEn:
            `Batches expiring within ${withinDays} days that still carry on-hand (I-17): ` +
            expiring
              .slice(0, 5)
              .map((row) => `${row.itemSku ?? row.itemId} / ${row.batchNo} by ${row.expiryDate} (on hand ${row.onHand})`)
              .join("; ") +
            (expiring.length > 5 ? " and more" : ""),
          actionUrl: "/inventory/batches",
          dedupeKey: `stock.shelf_life:${new Date().toISOString().slice(0, 10)}`,
        });
        await this.audit.record({
          action: "inventory.shelf_life_alerts_run",
          entityType: "inventory_alert_jobs",
          entityId: job?.id ?? tenantId,
          after: { withinDays, flagged: expiring.length },
        });
        return expiring.length;
      });
      flagged += result;
    }
    return { tenants: tenantIds.length, flagged };
  }

  /** The slow-movement pass (pg-boss `inventory.slow-movement-alerts`, daily 03:00 UTC). */
  async runSlowMovementAlerts(): Promise<{ tenants: number; flagged: number }> {
    const tenantIds = await listActiveTenantIds();
    let flagged = 0;
    for (const tenantId of tenantIds) {
      const result = await withTenant(tenantId, async () => {
        const job = await policies.findAlertJob("SLOW_MOVEMENT");
        if (job !== undefined && !job.isActive) return 0;
        const windowDays = job?.slowMovementDays ?? DEFAULT_SLOW_MOVEMENT_DAYS;
        const stale = await policies.scanSlowMovingItems(windowDays);
        await policies.stampAlertRun({ jobKind: "SLOW_MOVEMENT", flagged: stale.length });
        if (stale.length === 0) return 0;
        await this.notify(tenantId, {
          severity: "warning",
          titleAr: `أصناف بطيئة الحركة (${stale.length})`,
          titleEn: `${stale.length} slow-moving item(s)`,
          bodyAr:
            `أصناف لها رصيد دون أي صرف خلال ${windowDays} يوماً (I-21): ` +
            stale
              .slice(0, 5)
              .map((row) => `${row.itemSku ?? row.itemId} (رصيد ${row.onHand}${row.lastOutAt === null ? "، لم تُصرف أبداً" : ""})`)
              .join("؛ ") +
            (stale.length > 5 ? " وغيرها" : ""),
          bodyEn:
            `Stocked items with no outbound consumption in ${windowDays} days (I-21): ` +
            stale
              .slice(0, 5)
              .map((row) => `${row.itemSku ?? row.itemId} (on hand ${row.onHand}${row.lastOutAt === null ? ", never issued" : ""})`)
              .join("; ") +
            (stale.length > 5 ? " and more" : ""),
          actionUrl: "/inventory/stock",
          dedupeKey: `stock.slow_movement:${new Date().toISOString().slice(0, 10)}`,
        });
        await this.audit.record({
          action: "inventory.slow_movement_alerts_run",
          entityType: "inventory_alert_jobs",
          entityId: job?.id ?? tenantId,
          after: { windowDays, flagged: stale.length },
        });
        return stale.length;
      });
      flagged += result;
    }
    return { tenants: tenantIds.length, flagged };
  }

  /** The jobs' registration surface (thresholds per tenant). */
  async upsertJob(input: {
    jobKind: "SHELF_LIFE" | "SLOW_MOVEMENT";
    shelfLifeDays: number;
    slowMovementDays: number;
    isActive: boolean;
    note: string | null;
    actorId: string | null;
  }) {
    const job = await policies.upsertAlertJob({ ...input, createdBy: input.actorId });
    await this.audit.record({
      action: "inventory.alert_job_upserted",
      entityType: "inventory_alert_jobs",
      entityId: job.id,
      actorId: input.actorId ?? undefined,
      after: { jobKind: job.jobKind, shelfLifeDays: job.shelfLifeDays, slowMovementDays: job.slowMovementDays, isActive: job.isActive },
    });
    return job;
  }

  async listJobs() {
    const kinds: ("SHELF_LIFE" | "SLOW_MOVEMENT")[] = ["SHELF_LIFE", "SLOW_MOVEMENT"];
    const jobs = [];
    for (const kind of kinds) {
      jobs.push((await policies.findAlertJob(kind)) ?? null);
    }
    return jobs;
  }

  private async notify(
    _tenantId: string,
    input: {
      severity: "warning" | "critical";
      titleAr: string;
      titleEn: string;
      bodyAr: string;
      bodyEn: string;
      actionUrl: string;
      dedupeKey: string;
    },
  ): Promise<void> {
    const target = await this.inbox.ownerTarget();
    if (target === null) return;
    const prefs = await this.inbox.prefsFor(target.userId, "stock");
    if (!prefs.inApp) return;
    await this.inbox.record({
      category: "stock",
      severity: input.severity,
      title: { ar: input.titleAr, en: input.titleEn },
      body: { ar: input.bodyAr, en: input.bodyEn },
      actionLabel: { ar: "مراجعة المخزون", en: "Review stock" },
      actionUrl: input.actionUrl,
      dedupeKey: input.dedupeKey,
      userId: target.userId,
    });
  }
}
