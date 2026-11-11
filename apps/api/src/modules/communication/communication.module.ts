import { Module } from "@nestjs/common";

import { InfrastructureModule } from "../../infra/infra.module";
import { AuditModule } from "../audit/audit.module";
import { ProviderConfigService } from "./application/provider-config.service";
import { ProvidersController } from "./presentation/providers.controller";

/**
 * PHASE-041 communications hub (CR-11): the channel-port adapters (BR-067),
 * the tenant template substrate (FD-30), the outbound send ledger +
 * pipeline, the notification-preference matrix (TB-23), the unified inbox
 * with call logging (UX-14/IN-16), the digest + nudge jobs (PP-13/PP-15),
 * and the Google/Outlook calendar connect (IN-17/IN-18).
 *
 * The module grows task by task (T-02 adapters, T-03 provider config;
 * templates/outbox/prefs/inbox/calendar services register with their
 * tasks). Every outbound send flows through the OutboundChannelPort — the
 * SANDBOX default keeps unconfigured tenants at ZERO external calls.
 */
@Module({
  imports: [InfrastructureModule, AuditModule],
  controllers: [ProvidersController],
  providers: [ProviderConfigService],
  exports: [ProviderConfigService],
})
export class CommunicationModule {}
