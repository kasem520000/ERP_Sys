import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { CommissionService } from "./commissions/application/commission-service";
import { CommissionsController } from "./presentation/commissions.controller";

/**
 * Commissions module (PHASE-017 T7-a): per-rep commission rules + commission
 * runs with the run-time accrual journal (DR COMMISSION_EXPENSE · CR
 * COMMISSION_ACCRUAL — one journal per run, source commission_run:accrual).
 * Kept as a SEPARATE module from SalesModule (parallel T wiring): it composes
 * the accounting posting service + audit exactly like the treasury and
 * inventory modules do; the sales_reps commission columns are written only
 * through the commissions store. The orchestrator registers this module in
 * app.module.ts (this file deliberately does not touch sales.module.ts).
 */
@Module({
  imports: [AccountingModule, AuditModule],
  controllers: [CommissionsController],
  providers: [CommissionService],
  exports: [CommissionService],
})
export class CommissionsModule {}
