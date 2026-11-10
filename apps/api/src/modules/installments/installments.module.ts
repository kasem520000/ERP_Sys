import { Module, type OnModuleInit } from "@nestjs/common";
import { Inject } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { getBoss } from "../../infra/jobs/boss";
import { PlanService } from "./application/plan-service";
import { InstallmentCollectionService } from "./application/collection-service";
import { registerInstallmentsJobs } from "./infrastructure/overdue.job";
import { InstallmentsController } from "./presentation/installments.controller";

/**
 * Installments module (PHASE-027; DR-003/ED-03 option A): installment plans
 * over credit sales invoices + service contracts (BR-048), the job-derived
 * line statuses (OVERDUE via the daily sweep; WAIVED the sole manual
 * transition), and the flat late fees (G-28 — engine-only, DR-003 riba
 * stance: no interest, no compounding anywhere).
 *
 * Dependencies (DEPENDENCY_RULES §2; phase §4): accounting (the posting
 * engine owns every journal — ADR-0007) + audit + notifications (DEFAULTED
 * dunning). Cross-module READ refs: sales invoices, service contracts +
 * their billing schedules, treasury allocations/receipts (attribution).
 */
@Module({
  imports: [AccountingModule, AuditModule, NotificationsModule],
  controllers: [InstallmentsController],
  providers: [PlanService, InstallmentCollectionService],
  exports: [PlanService, InstallmentCollectionService],
})
export class InstallmentsModule implements OnModuleInit {
  constructor(
    @Inject(InstallmentCollectionService)
    private readonly collections: InstallmentCollectionService,
  ) {}

  /** The daily sweep (2:40 UTC — collection attribution + OVERDUE/DEFAULTED + auto-charge). */
  async onModuleInit(): Promise<void> {
    await registerInstallmentsJobs(getBoss(), this.collections).catch((error) => {
      void error;
    });
  }
}
