import { Module, type OnModuleInit } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DistributionModule } from "../distribution/distribution.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PartnersModule } from "../partners/partners.module";
import { PosModule } from "../pos/pos.module";
import { SalesModule } from "../sales/sales.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { getBoss } from "../../infra/jobs/boss";
import { DeviceRegistryService } from "./application/device-registry-service";
import { PushService } from "./application/push-service";
import { ReconciliationService } from "./application/reconciliation-service";
import { SyncHealthService } from "./application/health-service";
import {
  runCursorCompact,
  runFeedHealth,
  runInboxRetention,
  runTombstoneGc,
  SYNC_CURSOR_COMPACT_CRON,
  SYNC_CURSOR_COMPACT_QUEUE,
  SYNC_FEED_HEALTH_CRON,
  SYNC_FEED_HEALTH_QUEUE,
  SYNC_INBOX_RETENTION_CRON,
  SYNC_INBOX_RETENTION_QUEUE,
  SYNC_TOMBSTONE_GC_CRON,
  SYNC_TOMBSTONE_GC_QUEUE,
  type SyncSystemJobPayload,
} from "./application/maintenance-jobs";
import { DevicesController } from "./presentation/devices.controller";
import { SyncAdminController } from "./presentation/sync-admin.controller";
import { SyncController } from "./presentation/sync.controller";

/**
 * Sync module (PHASE-016 narrow slice → PHASE-020 generalized protocol):
 * device registry + credentials (devices controller), per-entity cursor
 * pull with feed groups + the C-12 resync directive, and batch push with
 * per-item semantics (v2 SyncCommand + the 016 legacy wire — §11 rule 3
 * byte-compat). The push handlers execute through the OWNING modules'
 * services (PosSaleService, PosShiftFlowService, SalesInvoiceService,
 * PartnerService) — sync adds transport, never a second business-logic
 * path. Reconciliation rides the same registry surface (revoked-device
 * pending-ops queue + drafts.reassign), and the admin plane adds the
 * health aggregate (GET /sync/admin/health) + the reconciliation queue
 * routes (T14; MASTER-PLAN §12).
 *
 * The four maintenance jobs (MASTER-PLAN §11) register here in the exact
 * crm.task-reminders-sweep shape: `boss.createQueue` + `boss.work` +
 * `boss.schedule` with `.catch` guards. Their payloads are
 * `{ system: true }` — the handlers iterate ACTIVE tenants and re-establish
 * each tenant scope through `withTenant` (ADR-0005; the job SQL runs as
 * erp_app inside the tenant transaction, so RLS scopes every statement).
 * `system: true` jobs run on BOTH the API and worker processes (the crm
 * comment: re-booting or running side by side replaces the schedule, never
 * duplicates it); failures never block module init — a down queue at boot
 * must not kill the HTTP plane, the next boot re-registers.
 */
@Module({
  // PHASE-021 · DR-P21-08: PartnersModule + TreasuryModule + InventoryModule
  // join the imports — PushService's constructor now injects the owning
  // services of the seven desktop write intents (PartnerService,
  // QuotationService, DeliveryNoteService, ExpenseService, the treasury +
  // inventory TransferServices, CountService). No owning module imports
  // sync (no cycle; DEPENDENCY_RULES §2.1).
  //
  // PHASE-022 · DR-P22-06: DistributionModule joins the imports — the
  // `van:confirm_load`/`van:confirm_unload` intents execute through the
  // 017 VanStockService (distribution owns the van semantics around the
  // ordinary inventory TransferService; same additive-import rule).
  imports: [
    AuditModule,
    PosModule,
    SalesModule,
    PartnersModule,
    TreasuryModule,
    InventoryModule,
    DistributionModule,
  ],
  controllers: [SyncController, DevicesController, SyncAdminController],
  providers: [PushService, DeviceRegistryService, ReconciliationService, SyncHealthService],
  exports: [PushService, DeviceRegistryService, ReconciliationService],
})
export class SyncModule implements OnModuleInit {
  /**
   * Register the four maintenance queues (the crm.task-reminders-sweep
   * registration shape, one block per queue). Every job is the same
   * idempotent full pass — one run per delivery, retries are safe (the
   * DELETEs are idempotent by predicate; the notification inserts are
   * dedupe-keyed).
   *
   * createQueue is deadlock-tolerant: the queue registration races the
   * shared boss's worker fetches (the DB suite boots several apps on ONE
   * process-bound singleton; four more boot-time registrations widened
   * the pg-boss maintenance-vs-createQueue window) — a 40P01 deadlock is
   * retriable by definition, so a short retry closes the flake without
   * masking real failures (every other error still throws).
   */
  private static async createQueueTolerant(
    boss: ReturnType<typeof getBoss>,
    queue: string,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await boss.createQueue(queue);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/exist/i.test(message)) return; // already created — idempotent
        if (attempt < 2 && /deadlock/i.test(message)) continue; // 40P01 — retry
        throw error;
      }
    }
  }

  async onModuleInit(): Promise<void> {
    const boss = getBoss();

    await SyncModule.createQueueTolerant(boss, SYNC_INBOX_RETENTION_QUEUE);
    await boss.work<SyncSystemJobPayload>(SYNC_INBOX_RETENTION_QUEUE, async (jobs) => {
      for (let index = 0; index < jobs.length; index += 1) {
        await runInboxRetention();
      }
    });
    await boss
      .schedule(SYNC_INBOX_RETENTION_QUEUE, SYNC_INBOX_RETENTION_CRON, {
        system: true,
      } satisfies SyncSystemJobPayload)
      .catch(() => undefined);

    await SyncModule.createQueueTolerant(boss, SYNC_TOMBSTONE_GC_QUEUE);
    await boss.work<SyncSystemJobPayload>(SYNC_TOMBSTONE_GC_QUEUE, async (jobs) => {
      for (let index = 0; index < jobs.length; index += 1) {
        await runTombstoneGc();
      }
    });
    await boss
      .schedule(SYNC_TOMBSTONE_GC_QUEUE, SYNC_TOMBSTONE_GC_CRON, {
        system: true,
      } satisfies SyncSystemJobPayload)
      .catch(() => undefined);

    await SyncModule.createQueueTolerant(boss, SYNC_CURSOR_COMPACT_QUEUE);
    await boss.work<SyncSystemJobPayload>(SYNC_CURSOR_COMPACT_QUEUE, async (jobs) => {
      for (let index = 0; index < jobs.length; index += 1) {
        await runCursorCompact();
      }
    });
    await boss
      .schedule(SYNC_CURSOR_COMPACT_QUEUE, SYNC_CURSOR_COMPACT_CRON, {
        system: true,
      } satisfies SyncSystemJobPayload)
      .catch(() => undefined);

    await SyncModule.createQueueTolerant(boss, SYNC_FEED_HEALTH_QUEUE);
    await boss.work<SyncSystemJobPayload>(SYNC_FEED_HEALTH_QUEUE, async (jobs) => {
      for (let index = 0; index < jobs.length; index += 1) {
        await runFeedHealth();
      }
    });
    await boss
      .schedule(SYNC_FEED_HEALTH_QUEUE, SYNC_FEED_HEALTH_CRON, {
        system: true,
      } satisfies SyncSystemJobPayload)
      .catch(() => undefined);
  }
}
