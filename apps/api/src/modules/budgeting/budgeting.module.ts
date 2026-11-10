import { Module, type OnModuleInit } from "@nestjs/common";
import { Inject } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { InboxService } from "../notifications/application/inbox-service";
import { getBoss } from "../../infra/jobs/boss";
import { ApprovalWorkflow } from "./application/approval-workflow";
import { BudgetGridService } from "./application/budget-grid-service";
import { BudgetVersionService } from "./application/budget-version-service";
import { ConsumptionService } from "./application/consumption-service";
import { ControlGuard } from "./application/control-guard";
import { ImportService } from "./application/import-service";
import { registerBudgetingJobs } from "./infrastructure/control-evaluation.job";
import { BudgetingController } from "./presentation/budgeting.controller";

/**
 * Budgeting module (PHASE-028; DR-004/ED-04 option A): versioned budgets
 * by fiscal year & scope (BR-050), the period grid, the DRAFT →
 * PENDING_APPROVAL → ACTIVE → REVISED/CLOSED lifecycle with SoD approval,
 * the read-only budget-vs-actual variance engine, the advisory controls
 * (BR-051), and the XLSX grid import/export.
 *
 * Dependencies (DEPENDENCY_RULES §2; phase §4): audit + notifications
 * ONLY — budgeting posts nothing, so it needs no accounting DI surface
 * (the GL read model runs through the ambient tenant UoW over the
 * accounting-owned tables, read-only). Cross-module READ refs: fiscal
 * years/periods, accounts, cost centers, projects, branches, journal
 * lines/entries + the branch-carrying source documents. budgeting NEVER
 * writes journal/stock/partner/cash tables — the module is structurally
 * ledger-incapable (ADR-0007/INV-022; the negative ledger proof).
 *
 * The declared edge (trade-document DRAFT-save flows MAY call
 * ControlGuard.evaluateDraftSave when budgeting.controls is entitled) is
 * exported here; production call-site wiring ships as the honest
 * documented follow-up (the completion report states it).
 */
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [BudgetingController],
  providers: [
    BudgetVersionService,
    BudgetGridService,
    ApprovalWorkflow,
    ConsumptionService,
    ControlGuard,
    ImportService,
  ],
  exports: [ControlGuard, ConsumptionService, BudgetGridService],
})
export class BudgetingModule implements OnModuleInit {
  constructor(
    @Inject(ConsumptionService)
    private readonly consumption: ConsumptionService,
    @Inject(InboxService)
    private readonly inbox: InboxService,
  ) {}

  /**
   * The daily job (ADR-0008 — the pdc-calendar registration shape): the
   * control-evaluation sweep (2:50 UTC — after the notes 2:20/2:30 and
   * installments 2:40 legs). Degrade-the-feature-never-the-platform.
   */
  async onModuleInit(): Promise<void> {
    await registerBudgetingJobs(getBoss(), this.inbox, this.consumption).catch((error) => {
      void error;
    });
  }
}
