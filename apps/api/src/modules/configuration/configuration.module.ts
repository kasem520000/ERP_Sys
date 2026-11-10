import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import {
  ConfigRepository,
  CONFIG_REPOSITORY,
} from "./infrastructure/config-repository";
import {
  ResolveEffectiveConfigService,
  RESOLVE_EFFECTIVE_CONFIG_SERVICE,
} from "./application/resolve/resolve-service";
import { TemplateApplyService } from "./application/apply/apply-service";
import { TemplateSwitchService } from "./application/switch/switch-service";
import { TemplateDriftService } from "./application/closure/drift-service";
import { ConfigurationController } from "./presentation/configuration.controller";

/**
 * The configuration module (MODULE_BOUNDARIES.md: owns
 * `industry_templates`, `tenant_industry_config`, `feature_flags`;
 * publishes `resolveEffectiveConfig(tenant)`).
 *
 * PHASE-004 shipped the feature-catalog mirror + BR-040 closure validation,
 * the settings key registry, and the §9 event bus. PHASE-015 T1 added the
 * ten-layer resolution engine: the drizzle repository, the resolve service
 * (tenant-static merge + L6 overlay + L9 derivation), the content-hash
 * caches, and the §9 lifecycle-event wiring.
 *
 * PHASE-015 T5–T7 add the template machinery on top (all additive
 * providers): the apply service (idempotent audited apply), the
 * additive-only switch/extend service (BR-038), the registry drift service
 * (upgrade offers through the notifications inbox), and the configuration
 * routes (effective-config, registry reads, apply/preview/switch/extend,
 * drift-check).
 */
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [ConfigurationController],
  providers: [
    ConfigRepository,
    { provide: CONFIG_REPOSITORY, useExisting: ConfigRepository },
    ResolveEffectiveConfigService,
    { provide: RESOLVE_EFFECTIVE_CONFIG_SERVICE, useExisting: ResolveEffectiveConfigService },
    TemplateApplyService,
    TemplateSwitchService,
    TemplateDriftService,
  ],
  exports: [
    ConfigRepository,
    CONFIG_REPOSITORY,
    ResolveEffectiveConfigService,
    RESOLVE_EFFECTIVE_CONFIG_SERVICE,
    TemplateApplyService,
    TemplateSwitchService,
    TemplateDriftService,
  ],
})
export class ConfigurationModule {}
