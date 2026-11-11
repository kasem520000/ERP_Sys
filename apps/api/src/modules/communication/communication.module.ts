import {
  Inject,
  Module,
  type OnModuleInit,
} from "@nestjs/common";

import { InfrastructureModule } from "../../infra/infra.module";
import { getBoss } from "../../infra/jobs/boss";
import { listActiveTenantIds } from "../../infra/jobs/system-tenants";
import { withTenant } from "../../infra/db/tenant-context";
import { childLogger } from "../../infra/observability/logger";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import type { InboxService } from "../notifications/application/inbox-service";
import { ProviderConfigService } from "./application/provider-config.service";
import { TemplateService } from "./application/template-service";
import { OutboxService } from "./application/outbox/outbox-service";
import { PreferencesService } from "./application/preferences-service";
import { DigestService, NudgeService } from "./application/digest-service";
import { UnifiedInboxService } from "./application/inbox-service";
import { ProvidersController } from "./presentation/providers.controller";
import { TemplatesController } from "./presentation/templates.controller";
import { PreferencesController } from "./presentation/preferences.controller";
import { InboxController } from "./presentation/inbox.controller";

const log = childLogger({ module: "communication" });

/** The outbound sweep queue (pg-boss; ADR-0008). */
export const OUTBOUND_SWEEP_QUEUE = "communication-outbound-sweep";
/** Every minute: the retry backoff floor is 1 minute. */
export const OUTBOUND_SWEEP_CRON = "* * * * *";
/** The daily digest: 03:30 UTC = 06:30 Riyadh (the house timezone). */
export const DIGEST_CRON = "30 3 * * *";
/** The deadline-ahead nudges: 04:00 UTC = 07:00 Riyadh. */
export const NUDGE_CRON = "0 4 * * *";

/**
 * PHASE-041 communications hub (CR-11): the channel-port adapters (BR-067),
 * the tenant template substrate (FD-30), the outbound send ledger +
 * pipeline, the notification-preference matrix (TB-23), the unified inbox
 * with call logging (UX-14/IN-16), the digest + nudge jobs (PP-13/PP-15),
 * and the Google/Outlook calendar connect (IN-17/IN-18).
 *
 * The outbound sweep (the reservation-sweep precedent): the worker
 * subscription + the every-minute cron are idempotent upserts by name —
 * re-booting (or API + worker side by side) replaces, never duplicates;
 * the handler runs one idempotent full pass over every ACTIVE tenant's
 * due queue. Failures never block module init (the next boot
 * re-registers; the sweep is also callable directly).
 */
@Module({
  imports: [InfrastructureModule, AuditModule, NotificationsModule],
  controllers: [
    ProvidersController,
    TemplatesController,
    PreferencesController,
    InboxController,
  ],
  providers: [
    ProviderConfigService,
    TemplateService,
    OutboxService,
    PreferencesService,
    DigestService,
    NudgeService,
    UnifiedInboxService,
  ],
  exports: [
    ProviderConfigService,
    TemplateService,
    OutboxService,
    PreferencesService,
    DigestService,
    NudgeService,
    UnifiedInboxService,
  ],
})
export class CommunicationModule implements OnModuleInit {
  constructor(
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DigestService) private readonly digest: DigestService,
    @Inject(NudgeService) private readonly nudges: NudgeService,
  ) {}

  async onModuleInit(): Promise<void> {
    const boss = getBoss();
    await boss.createQueue(OUTBOUND_SWEEP_QUEUE).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/exist/i.test(message)) {
        log.error({ err: message }, "outbound sweep queue creation failed");
        return;
      }
    });
    await boss
      .work<{ system?: boolean }>(OUTBOUND_SWEEP_QUEUE, async (jobs) => {
        for (let index = 0; index < jobs.length; index += 1) {
          await this.runSweep();
        }
      })
      .catch((error: unknown) => {
        log.warn({ err: error }, "outbound sweep worker registration failed");
      });
    await boss
      .schedule(OUTBOUND_SWEEP_QUEUE, OUTBOUND_SWEEP_CRON, { system: true })
      .catch(() => undefined);
    // The digest + nudge crons (PP-13/PP-15): daily, idempotent full
    // passes per ACTIVE tenant — the reservation-sweep precedent.
    await boss.createQueue("communication-digest").catch(() => undefined);
    await boss
      .work<{ system?: boolean }>("communication-digest", async (jobs) => {
        for (let index = 0; index < jobs.length; index += 1) {
          await this.runSystemPass(async () => this.digest.runDigest());
        }
      })
      .catch(() => undefined);
    await boss
      .schedule("communication-digest", DIGEST_CRON, { system: true })
      .catch(() => undefined);
    await boss.createQueue("communication-nudges").catch(() => undefined);
    await boss
      .work<{ system?: boolean }>("communication-nudges", async (jobs) => {
        for (let index = 0; index < jobs.length; index += 1) {
          await this.runSystemPass(async () => {
            await this.nudges.runInvoiceDueNudges();
            await this.nudges.runTaskDueNudges();
            await this.nudges.runContractRenewalNudges();
          });
        }
      })
      .catch(() => undefined);
    await boss
      .schedule("communication-nudges", NUDGE_CRON, { system: true })
      .catch(() => undefined);
  }

  /** One idempotent per-tenant pass (ADR-0005: one UoW per tenant). */
  private async runSystemPass(
    pass: () => Promise<unknown>,
  ): Promise<void> {
    const tenantIds = await listActiveTenantIds();
    for (const tenantId of tenantIds) {
      try {
        await withTenant(tenantId, () => pass());
      } catch (error) {
        log.error({ tenant_id: tenantId, err: error }, "communication scheduled pass failed");
      }
    }
  }

  /** One idempotent full pass: every ACTIVE tenant's due queue. */
  async runSweep(): Promise<{ tenants: number; processed: number }> {
    const tenantIds = await listActiveTenantIds();
    let processed = 0;
    for (const tenantId of tenantIds) {
      try {
        // One UoW per tenant (ADR-0005): a failure in one tenant never
        // blocks the rest.
        const outcome = await withTenant(tenantId, () => this.outbox.processDue());
        processed += outcome.processed;
      } catch (error) {
        log.error({ tenant_id: tenantId, err: error }, "outbound sweep failed for tenant");
      }
    }
    return { tenants: tenantIds.length, processed };
  }
}

/** Re-exported for the outbox factory wiring (the InboxService injection). */
export type { InboxService };
