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
  ],
})
export class InventoryModule implements OnModuleInit {
  constructor(@Inject(ReservationService) private readonly reservations: ReservationService) {}

  /**
   * Register the reservation-expiry sweep: the worker subscription (both
   * API and WORKER_MODE processes) + the nightly cron schedule. The
   * schedule registration is an idempotent upsert by name — re-booting
   * the app (or running API + worker side by side) replaces, never
   * duplicates. Failures never block module init (a down queue at boot
   * must not kill the HTTP plane); the next boot re-registers.
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
  }
}
