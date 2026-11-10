import { Inject, Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { PartnersModule } from "../partners/partners.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ConfigurationModule } from "../configuration/configuration.module";
import { AuditModule } from "../audit/audit.module";
import { SalesModule } from "../sales/sales.module";
import { SalesInvoiceService } from "../sales/application/invoices";
import { InventoryModule } from "../inventory/inventory.module";
import { getBoss } from "../../infra/jobs/boss";
import { LeadService } from "./application/lead-service";
import { TaskService } from "./application/task-service";
import { ActivityService } from "./application/activity-service";
import { ContractService } from "./application/contract-service";
import { TimeEntryService } from "./application/time-entry-service";
import { BillingRunService } from "./application/billing-run-service";
import { DeferralService } from "./application/deferral-service";
import { ServiceOrderService } from "./application/service-order-service";
import { ServiceOrderPosting } from "./application/service-order-posting";
import { LeadsController } from "./presentation/leads.controller";
import { TasksController } from "./presentation/tasks.controller";
import { ContractsController } from "./presentation/contracts.controller";
import { TimeController } from "./presentation/time.controller";
import { BillingController } from "./presentation/billing.controller";
import { ServiceOrdersController } from "./presentation/service-orders.controller";
import * as store from "./infrastructure/crm.store";

/**
 * The task-reminder sweep's queue name (ADR-0008; MASTER-PLAN §3): the
 * pg-boss schedule with this name enqueues into it daily, and the handler
 * below drains it on BOTH the API and worker processes (the
 * inventory.reservations-sweep registration shape).
 */
export const CRM_TASK_REMINDERS_SWEEP_QUEUE = "crm.task-reminders-sweep";

/** Daily at 05:30 UTC — the documented reminder window (MASTER-PLAN §3). */
export const CRM_TASK_REMINDERS_SWEEP_CRON = "30 5 * * *";

/** The system sweep job's payload: no tenant id — the handler iterates
 * ACTIVE tenants itself (the reservation-sweep contract). */
export interface CrmTaskRemindersSweepJobPayload {
  system: true;
}

/**
 * The recurring contract-billing run's queue name (MASTER-PLAN §5): the
 * monthly pg-boss schedule enqueues here; the handler runs the billing run
 * for every ACTIVE tenant (asOf = today) — idempotent by the
 * contract_invoices partial uniques (INV-013).
 */
export const CRM_CONTRACT_BILLING_RUN_QUEUE = "crm.contract-billing-run";

/** Monthly, the 1st at 03:00 UTC (MASTER-PLAN §5). */
export const CRM_CONTRACT_BILLING_RUN_CRON = "0 3 1 * *";

/** The system billing job's payload (the reminder-sweep contract). */
export interface CrmContractBillingRunJobPayload {
  system: true;
}

/**
 * CRM module (PHASE-019 T45 + T46 + T47 + T48 — the core slice: leads, tasks,
 * activities, the reminder sweep, and the dashboard summary; T46's service
 * contracts + schedule + advances + time entries; T47's recurring billing
 * runs + the deferred-revenue release; T48's service orders — the job-card
 * generalization: the SO- lifecycle with the two parts policies, invoicing
 * through the ordinary sales chain, and the posting port wired at the
 * ServiceOrdersController constructor (the JobCardsController precedent).
 * Leads are the intake pipeline (NEW → CONVERTED/LOST; conversion links a
 * partner forever — provenance, no ledger effects); tasks are future work
 * with the 05:30 reminder sweep (in-app inbox + owner email); activities
 * are the logged-past timeline. Contracts carry the CT- lifecycle + the §4
 * billing-schedule grid + the policy-gated advance reclass; time entries
 * feed contract billing only. The billing run drafts through the ordinary
 * sales chain (never auto-posts) and the advance release fires at contract
 * invoice posting through the §11 contract-billing port.
 *
 * Dependencies (DEPENDENCY_RULES §2): partners (PartnerService — lead
 * conversion creates/links the customer record, BR-025) + notifications
 * (InboxService + the email service — the reminder sweep's two legs + the
 * release-failure critical row) + audit (transactional audit events) +
 * accounting (PostingService / NumberingService / the projects + period
 * reads) + configuration (ResolveEffectiveConfigService — the §9 policy
 * reads) + sales (SalesInvoiceService — the billing run's draft chain; the
 * contract-billing port wiring below. Sales does NOT import crm — no
 * circularity, the JobCardsController port precedent) + inventory
 * (ReservationService — T48's `reserve`-mode holds + the posting port's
 * hold consumption; the SalesModule InventoryModule precedent — no
 * cycle, inventory never imports crm).
 */
@Module({
  imports: [
    AccountingModule,
    PartnersModule,
    NotificationsModule,
    ConfigurationModule,
    AuditModule,
    SalesModule,
    InventoryModule,
  ],
  controllers: [
    LeadsController,
    TasksController,
    ContractsController,
    TimeController,
    BillingController,
    ServiceOrdersController,
  ],
  providers: [
    LeadService,
    TaskService,
    ActivityService,
    ContractService,
    TimeEntryService,
    BillingRunService,
    DeferralService,
    ServiceOrderService,
    ServiceOrderPosting,
  ],
  exports: [LeadService, TaskService, ActivityService, ContractService, TimeEntryService, BillingRunService],
})
export class CrmModule implements OnModuleInit {
  constructor(
    @Inject(TaskService) private readonly tasks: TaskService,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    @Inject(DeferralService) private readonly deferral: DeferralService,
    @Inject(BillingRunService) private readonly billingRuns: BillingRunService,
  ) {
    // PHASE-019 (§11): the contract-billing port — wired at the composition
    // root exactly like the JobCardsController posting port (avoids circular
    // module imports). `validateContract` replaces the raw existence read
    // for contractId on sales-invoice create; `onContractInvoicePosted`
    // fires the J-REL advance release inside the posting UoW after the
    // POSTED flip (§1 row 5).
    this.invoices.setContractBillingPort({
      validateContract: async (contractId: string) =>
        (await store.findContractById(contractId)) !== undefined,
      onContractInvoicePosted: (contractId: string, invoiceId: string, actorId: string | null) =>
        this.deferral.onContractInvoicePosted(contractId, invoiceId, actorId),
    });
  }

  /**
   * Register the sweeps: the task-reminder queue (daily 05:30) + the
   * contract-billing run (monthly, the 1st at 03:00). Worker subscriptions
   * on BOTH the API and worker processes; the schedule registrations are
   * idempotent upserts by name — re-booting the app (or running API +
   * worker side by side) replaces, never duplicates. Failures never block
   * module init (a down queue at boot must not kill the HTTP plane); the
   * next boot re-registers.
   */
  async onModuleInit(): Promise<void> {
    const boss = getBoss();
    await boss.createQueue(CRM_TASK_REMINDERS_SWEEP_QUEUE).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/exist/i.test(message)) throw error;
    });
    await boss.work<CrmTaskRemindersSweepJobPayload>(CRM_TASK_REMINDERS_SWEEP_QUEUE, async (jobs) => {
      // Every job is the same idempotent full pass — one run per delivery,
      // retries are safe (notifiedAt + the dedupe key are the nets).
      for (let index = 0; index < jobs.length; index += 1) {
        await this.tasks.sweepAllReminders();
      }
    });
    await boss
      .schedule(CRM_TASK_REMINDERS_SWEEP_QUEUE, CRM_TASK_REMINDERS_SWEEP_CRON, {
        system: true,
      } satisfies CrmTaskRemindersSweepJobPayload)
      .catch(() => undefined);

    await boss.createQueue(CRM_CONTRACT_BILLING_RUN_QUEUE).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/exist/i.test(message)) throw error;
    });
    await boss.work<CrmContractBillingRunJobPayload>(CRM_CONTRACT_BILLING_RUN_QUEUE, async (jobs) => {
      // One idempotent full pass per delivery: the contract_invoices
      // guards make a retried sweep converge (0 new drafts).
      for (let index = 0; index < jobs.length; index += 1) {
        await this.billingRuns.sweepAllTenants();
      }
    });
    await boss
      .schedule(CRM_CONTRACT_BILLING_RUN_QUEUE, CRM_CONTRACT_BILLING_RUN_CRON, {
        system: true,
      } satisfies CrmContractBillingRunJobPayload)
      .catch(() => undefined);
  }
}
