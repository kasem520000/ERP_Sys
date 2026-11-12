import { Inject, Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { getBoss } from "../../infra/jobs/boss";
import { WarehouseService } from "./application/warehouse-service";
import { StockService } from "./application/stock-service";
import { AdjustmentService } from "./application/adjustment-service";
import { TransferService } from "./application/transfer-service";
import { CountService } from "./application/count-service";
import { TrackingService } from "./application/tracking-service";
import { ReservationService } from "./application/reservation-service";
import { ReorderService } from "./application/reorder-service";
import { InventoryReconciliationService } from "./application/reconciliation-service";
import { MethodSwitchService } from "./application/method-switch-service";
import { OpeningStockService } from "./application/opening-stock-service";
import { RevaluationService } from "./application/revaluation-service";
import { WmsService } from "./application/wms.service";
import { PutawayService } from "./application/putaway-service";
import { PickingService } from "./application/picking-service";
import { CycleCountService } from "./application/cycle-count-service";
import { InventoryController } from "./presentation/inventory.controller";

/**
 * The reservation-expiry sweep's queue name (ADR-0008): the pg-boss
 * schedule with this name enqueues into it nightly, and the handler below
 * drains it on BOTH the API and worker processes (same registration shape
 * as the email + items-import queues).
 */
export const RESERVATION_SWEEP_QUEUE = "inventory.reservations-sweep";

/** Nightly at 01:15 UTC — the documented sweep window before the reorder scan (§2.13). */
export const RESERVATION_SWEEP_CRON = "15 1 * * *";

/** The system sweep job's payload: no tenant id — the handler iterates ACTIVE tenants itself. */
export interface ReservationSweepJobPayload {
  system: true;
}

/**
 * PHASE-044 (INV-029): the bin-contents reconciliation probe's queue —
 * nightly at 01:45 UTC, after the reservation sweep, before 02:00.
 */
export const BIN_RECONCILE_QUEUE = "inventory.bin-reconcile";
export const BIN_RECONCILE_CRON = "45 1 * * *";

export interface BinReconcileJobPayload {
  system: true;
}

/**
 * PHASE-044 (§2.6): the cycle-count generation pass's queue — nightly at
 * 02:15 UTC, after the bin-reconcile probe; every ACTIVE schedule runs
 * its due-items pass (the class intervals gate what is due).
 */
export const CYCLE_COUNT_GENERATE_QUEUE = "inventory.cycle-count-generate";
export const CYCLE_COUNT_GENERATE_CRON = "15 2 * * *";

export interface CycleCountGenerateJobPayload {
  system: true;
}

/**
 * Inventory module (PHASE-010): warehouses, the append-only stock ledger
 * (INV-010), WAC/FIFO valuation with 6-decimal cost precision (ADR-0009),
 * opening-stock posting (G-16), two-leg transfers (BR-016/G-15), the count
 * workspace (BR-015/G-13/G-14), batch/expiry/serial tracking with FEFO
 * (BR-017/BR-018), soft reservations, reorder monitoring (BR-019), the
 * INV-010 reconciliation job, and the INV-017 method-switch service.
 * PHASE-015 T9 activates the reservation pool's entitlement surface
 * (`inventory.reservations`) and registers its scheduled expiry sweep on
 * pg-boss (ADR-0008 — the first cron schedule in the platform; the
 * reorder nightly window follows the same shape).
 *
 * Dependencies (DEPENDENCY_RULES §2; the phase §4): accounting (the
 * posting engine — inventory NEVER writes GL tables, ADR-0007; numbering;
 * the reconciliation framework) + audit + notifications (the BR-019
 * reorder email adapter). Published for PHASE-011/012: receiveStock /
 * issueStock / availability / valuation queries (MODULE_BOUNDARIES —
 * inventory exclusively owns stock_moves + stock_layers).
 */
@Module({
  imports: [AccountingModule, AuditModule, NotificationsModule],
  controllers: [InventoryController],
  providers: [
    WarehouseService,
    StockService,
    AdjustmentService,
    TransferService,
    CountService,
    TrackingService,
    ReservationService,
    ReorderService,
    InventoryReconciliationService,
    MethodSwitchService,
    OpeningStockService,
    RevaluationService,
    WmsService,
    PutawayService,
    PickingService,
    CycleCountService,
  ],
  exports: [
    WarehouseService,
    StockService,
    AdjustmentService,
    TransferService,
    CountService,
    TrackingService,
    ReservationService,
    InventoryReconciliationService,
    MethodSwitchService,
    OpeningStockService,
    RevaluationService,
    WmsService,
    PutawayService,
    PickingService,
    CycleCountService,
  ],
})
export class InventoryModule implements OnModuleInit {
  constructor(
    @Inject(ReservationService) private readonly reservations: ReservationService,
    @Inject(WmsService) private readonly wms: WmsService,
    @Inject(CycleCountService) private readonly cycleCounts: CycleCountService,
  ) {}

  /**
   * Register the reservation-expiry sweep: the worker subscription (both
   * API and WORKER_MODE processes) + the nightly cron schedule. The
   * schedule registration is an idempotent upsert by name — re-booting
   * the app (or running API + worker side by side) replaces, never
   * duplicates. Failures never block module init (a down queue at boot
   * must not kill the HTTP plane); the next boot re-registers.
   *
   * PHASE-044 (INV-029): the same shape registers the bin-contents
   * reconciliation probe (`inventory.bin-reconcile`, nightly 01:45 UTC).
   */
  async onModuleInit(): Promise<void> {
    const boss = getBoss();
    await boss
      .createQueue(RESERVATION_SWEEP_QUEUE)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!/exist/i.test(message)) throw error;
      });
    await boss.work<ReservationSweepJobPayload>(RESERVATION_SWEEP_QUEUE, async (jobs) => {
      // Every job is the same idempotent full pass — one run per delivery,
      // retries are safe.
      for (let index = 0; index < jobs.length; index += 1) {
        await this.reservations.expireReservations();
      }
    });
    await boss
      .schedule(RESERVATION_SWEEP_QUEUE, RESERVATION_SWEEP_CRON, {
        system: true,
      } satisfies ReservationSweepJobPayload)
      .catch(() => undefined);

    await boss
      .createQueue(BIN_RECONCILE_QUEUE)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!/exist/i.test(message)) throw error;
      });
    await boss.work<BinReconcileJobPayload>(BIN_RECONCILE_QUEUE, async (jobs) => {
      // Idempotent full pass per delivery — the probe is read-only.
      for (let index = 0; index < jobs.length; index += 1) {
        await this.wms.reconcileAllTenants();
      }
    });
    await boss
      .schedule(BIN_RECONCILE_QUEUE, BIN_RECONCILE_CRON, {
        system: true,
      } satisfies BinReconcileJobPayload)
      .catch(() => undefined);

    await boss
      .createQueue(CYCLE_COUNT_GENERATE_QUEUE)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!/exist/i.test(message)) throw error;
      });
    await boss.work<CycleCountGenerateJobPayload>(CYCLE_COUNT_GENERATE_QUEUE, async (jobs) => {
      // Idempotent full pass per delivery — the due check makes re-runs
      // no-ops for freshly counted items.
      for (let index = 0; index < jobs.length; index += 1) {
        await this.cycleCounts.runActiveSchedules(null);
      }
    });
    await boss
      .schedule(CYCLE_COUNT_GENERATE_QUEUE, CYCLE_COUNT_GENERATE_CRON, {
        system: true,
      } satisfies CycleCountGenerateJobPayload)
      .catch(() => undefined);
  }
}
