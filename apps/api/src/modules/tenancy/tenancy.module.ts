import { Module, OnModuleInit } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/api/audit";
import { ConfigurationModule } from "../configuration/configuration.module";
import { IdentityModule } from "../identity/identity.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RegistrationService } from "./application/registration-service";
import { OnboardingService } from "./application/onboarding-service";
import { BranchService } from "./application/branch-service";
import { SettingsService } from "./application/settings-service";
import { EntitlementsService } from "./application/entitlements-service";
import { LifecycleService } from "./application/lifecycle-service";
import { SupportAccessService } from "./application/support-access-service";
import { PlatformConsoleService } from "./application/platform-console-service";
import { OffboardingPlatformController } from "./presentation/platform/offboarding.controller";
import { OffboardingService } from "./application/offboarding/offboarding-service";
import { FilesModule } from "../files/files.module";
import { FilesService } from "../files/api/files";
import { RegistrationController } from "./presentation/public/registration.controller";
import { PublicPlansController } from "./presentation/public/plans.controller";
import { TenancyController } from "./presentation/tenancy.controller";
import { PlatformConsoleController } from "./presentation/platform/platform.controller";
import { PlatformBillingController } from "./presentation/platform/billing.controller";
import { PlatformSloController } from "./presentation/platform/slo.controller";
import { BillingWebhookController } from "./presentation/platform/webhook.controller";
import { SubscriptionService } from "./application/billing/subscription-service";
import {
  UsageService,
  registerDocumentCounterSubscriber,
} from "./application/billing/usage-service";

/**
 * Tenancy module (PHASE-004; MODULE_BOUNDARIES.md): owns tenants,
 * branches, settings, plans, subscriptions, entitlements, support
 * sessions; publishes tenant context, resolveEntitlements and the branch
 * registry. Dependencies per DEPENDENCY_RULES §2: identity (memberships,
 * sessions, role templates) + audit + configuration (feature catalog,
 * settings schema, §9 events) + notifications (registration email).
 */
@Module({
  imports: [AuditModule, ConfigurationModule, FilesModule, IdentityModule, NotificationsModule],
  controllers: [
    RegistrationController,
    PublicPlansController,
    TenancyController,
    PlatformConsoleController,
    PlatformBillingController,
    PlatformSloController,
    BillingWebhookController,
    OffboardingPlatformController,
  ],
  providers: [
    RegistrationService,
    OnboardingService,
    BranchService,
    SettingsService,
    EntitlementsService,
    LifecycleService,
    SupportAccessService,
    PlatformConsoleService,
    SubscriptionService,
    UsageService,
    // PHASE-024 T11: the offboarding flow (request/export/execute/cancel +
    // legal hold) — the purge sweep is a plain-callable job registered in
    // onModuleInit (the sync maintenance-jobs pattern).
    {
      provide: OffboardingService,
      useFactory: (audit: AuditService, files: FilesService, lifecycle: LifecycleService) =>
        new OffboardingService({ audit, files, lifecycle }),
      inject: [AuditService, FilesService, LifecycleService],
    },
  ],
  exports: [
    RegistrationService,
    EntitlementsService,
    LifecycleService,
    SupportAccessService,
    SubscriptionService,
    UsageService,
  ],
})
export class TenancyModule implements OnModuleInit {
  constructor(
    private readonly usage: UsageService,
    private readonly offboardingFiles: FilesService,
  ) {}

  /**
   * The fail-safe documents counter subscriber (PHASE-014 §6): listens for
   * journal.posted ledger events and bumps the usage read model inside its
   * own UoW — INV-022 by construction (a broken counter never breaks the
   * posting transaction).
   */
  onModuleInit(): void {
    registerDocumentCounterSubscriber(this.usage);
    this.registerOffboardingPurgeJob().catch(() => undefined);
  }

  /**
   * PHASE-024 T11: the daily purge sweep (03:50 UTC — before the sync
   * retention sweeps). The sync maintenance-jobs registration shape:
   * createQueue tolerant + work + schedule with .catch guards; the
   * handler is the plain-callable runPurgeSweep (the spec drives it
   * directly). No-credential environments degrade honestly (the sweep
   * logs + skips — the purge must never run on the app pool).
   */
  private async registerOffboardingPurgeJob(): Promise<void> {
    const { getBoss } = await import("../../infra/jobs/boss");
    const {
      TENANCY_OFFBOARDING_PURGE_CRON,
      TENANCY_OFFBOARDING_PURGE_QUEUE,
      runPurgeSweep,
    } = await import("./application/offboarding/purge-service");
    const boss = getBoss();
    await boss.createQueue(TENANCY_OFFBOARDING_PURGE_QUEUE).catch(() => undefined);
    await boss.work(TENANCY_OFFBOARDING_PURGE_QUEUE, async (jobs) => {
      for (let index = 0; index < jobs.length; index += 1) {
        await runPurgeSweep({ files: this.offboardingFiles });
      }
    });
    await boss
      .schedule(TENANCY_OFFBOARDING_PURGE_QUEUE, TENANCY_OFFBOARDING_PURGE_CRON, {
        system: true,
      })
      .catch(() => undefined);
  }
}

