import { Inject, Module, OnModuleInit } from "@nestjs/common";

import { InfrastructureModule } from "../../infra/infra.module";
import { JobsService, getBoss } from "../../infra/jobs/boss";
import { childLogger } from "../../infra/observability/logger";
import { env } from "../../config/env";
import {
  EmailService,
  EMAIL_QUEUE,
  identitySenders,
  type EmailJobPayload,
} from "./application/email-service";
import { InboxService } from "./application/inbox-service";
import type { NotificationChannelPort } from "./application/channel-port";
import { PushChannelService } from "./application/push-channel-service";
import { FcmChannelAdapter } from "./adapters/fcm/fcm-adapter";
import { fcmTransportFromEnv } from "./adapters/fcm/fcm-transport";
import { NotificationsController } from "./presentation/notifications.controller";

/** DI tokens (exported for consumer modules). */
export const EMAIL_SERVICE = Symbol("EMAIL_SERVICE");
export const IDENTITY_EMAIL_SENDERS = Symbol("IDENTITY_EMAIL_SENDERS");
/**
 * PHASE-022 · DR-P22-07: the push channel port binding — FcmChannelAdapter
 * by default (disabled unless FCM_CREDENTIALS is set — the honest skeleton;
 * a future SMS implementor satisfies the same port, integrations §3.5).
 */
export const NOTIFICATION_CHANNEL = Symbol("NOTIFICATION_CHANNEL");
export type { EmailService } from "./application/email-service";
export type { IdentityEmailSenders } from "./application/email-service";
export type { NotificationChannelPort } from "./application/channel-port";
export type { PushChannelService } from "./application/push-channel-service";

const log = childLogger({ module: "notifications" });

/**
 * Notifications module (PHASE-003 email adapter + the PHASE-014 §2.8
 * in-app center, generalized at PHASE-015 T10 per FEATURE_CATALOG
 * `platform.notifications`): inbox rows + per-user preferences + owner
 * emails. Categories: the PHASE-014 billing-critical set plus `stock`
 * (the BR-019 reorder scan's in-app leg) and `templates` (industry
 * template upgrade offers). Registers the email job handler on both the
 * API and worker processes (WORKER_MODE selects what listens for HTTP;
 * jobs run in both).
 *
 * PHASE-022 · DR-P22-07: the FCM push channel joins — NOTIFICATION_CHANNEL
 * binds FcmChannelAdapter over the env-derived transport (disabled unless
 * FCM_CREDENTIALS is set — the DisabledSmtpTransport pattern; the init log
 * below surfaces the disabled flag), and PushChannelService (the §3.5
 * orchestrator: token + locale resolved before every channel call).
 */
@Module({
  imports: [InfrastructureModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: EMAIL_SERVICE,
      useFactory: (jobs: JobsService) =>
        new EmailService({
          jobs,
          webBaseUrl: env.WEB_BASE_URL,
          fromAddress: env.SMTP_FROM,
        }),
      inject: [JobsService],
    },
    {
      provide: IDENTITY_EMAIL_SENDERS,
      useFactory: (email: EmailService) => identitySenders(email, env.WEB_BASE_URL),
      inject: [EMAIL_SERVICE],
    },
    {
      // PHASE-022 · DR-P22-07: default binding = the FCM adapter over the
      // env transport (DisabledFcmTransport unless FCM_CREDENTIALS is set).
      provide: NOTIFICATION_CHANNEL,
      useFactory: () => new FcmChannelAdapter({ transport: fcmTransportFromEnv() }),
    },
    {
      provide: PushChannelService,
      useFactory: (channel: NotificationChannelPort) => new PushChannelService(channel),
      inject: [NOTIFICATION_CHANNEL],
    },
    InboxService,
  ],
  exports: [EMAIL_SERVICE, IDENTITY_EMAIL_SENDERS, InboxService, NOTIFICATION_CHANNEL, PushChannelService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
    @Inject(NOTIFICATION_CHANNEL) private readonly channel: FcmChannelAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    // PHASE-022 · DR-P22-07: the honest-skeleton flag surfaced at init —
    // disabled means sends are no-ops reported as ok:false (never throws).
    log.info(
      { channel: "fcm", disabled: this.channel.disabled },
      this.channel.disabled
        ? "fcm channel DISABLED (FCM_CREDENTIALS unset) — pushes are logged + dropped as ok:false"
        : "fcm channel enabled (FCM_CREDENTIALS set) — pushes go to the wire",
    );
    const boss = getBoss();
    await boss.work<EmailJobPayload>(EMAIL_QUEUE, async (jobs) => {
      // pg-boss v10 delivers batches; every job is handled idempotently.
      for (const job of jobs) {
        await this.email.handleJob(job.data);
      }
    });
  }
}
