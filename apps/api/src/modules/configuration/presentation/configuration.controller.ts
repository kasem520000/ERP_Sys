import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/domain/identity-errors";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { effectivePermissions } from "../../identity/infrastructure/identity.store";
import { withTenant } from "../../../infra/db/tenant-context";
import { ResolveEffectiveConfigService } from "../application/resolve/resolve-service";
import { TemplateApplyService } from "../application/apply/apply-service";
import {
  TemplateSwitchService,
  type TemplateSwitchPreview,
} from "../application/switch/switch-service";
import { TemplateDriftService } from "../application/closure/drift-service";
import { checkPrerequisites } from "../application/apply/prerequisites";
import {
  SUPPORTED_ACTIVITIES,
  resolveTemplateForActivity,
} from "../application/apply/activity-mapping";
import { findAppliedStateRow } from "../application/apply/applied-state.store";
import { ConfigRepository, CONFIG_REPOSITORY } from "../infrastructure/config-repository";

/**
 * PHASE-015 T5–T7 configuration routes (PHASE-015 §4; matrix §3.8):
 *
 * - `GET /effective-config` — request-scoped resolution (tenant-static +
 *   L6 overlay + L9 derivation) for every authenticated member (BR-039
 *   derived-only payload; SESSION_ROUTES).
 * - `GET /templates` + `GET /templates/:key` — the registry (session
 *   routes: the onboarding wizard renders template cards before any
 *   permission-bearing apply; the detail adds the capability preview
 *   resolved against the CALLER's entitlements).
 * - `GET /templates/activity-map` — the bilingual activity catalog.
 * - `POST /templates/:key/apply` — permission `configuration.templates.apply`
 *   + feature `industry.template_engine` (the engine surface).
 * - `POST /templates/:key/preview|switch|extend` — permission
 *   `configuration.templates.apply` + feature `industry.template_switching`
 *   (BR-038 additive-only switching).
 * - `POST /templates/drift-check` — the §2-item-11 upgrade-offer check.
 *
 * Every handler runs inside the TenantContextInterceptor's tenant UoW; all
 * bodies are zod-validated (VALIDATION_ERROR on shape drift); typed domain
 * errors map through the shared ERROR_MODEL filter.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

/** Identity + active tenant (the tenant plane is mandatory here). */
function requireTenantIdentity(request: Request): SessionContext & { tenantId: string } {
  const identity = requireIdentity(request);
  if (identity.activeTenantId === null) {
    throw new UnauthenticatedError();
  }
  return { ...identity, tenantId: identity.activeTenantId };
}

const applyBodySchema = z
  .object({
    /** Accepted for shape parity with switch; apply itself never blocks on
     *  phase gates (back-office mode applies immediately, README §4). */
    acknowledged: z.boolean().optional(),
  })
  .strict();

const switchBodySchema = z
  .object({
    /** REQUIRED-phase-gated differences ("coming with PHASE-0NN") proceed
     *  only on an explicit acknowledgement (BR-038; R9). */
    acknowledged: z.boolean().optional(),
  })
  .strict();

const previewBodySchema = z
  .object({
    mode: z.enum(["switch", "extend"]),
  })
  .strict();

@Controller("api/v1/configuration")
export class ConfigurationController {
  constructor(
    @Inject(ResolveEffectiveConfigService)
    private readonly resolver: ResolveEffectiveConfigService,
    @Inject(TemplateApplyService) private readonly apply: TemplateApplyService,
    @Inject(TemplateSwitchService) private readonly switches: TemplateSwitchService,
    @Inject(TemplateDriftService) private readonly drift: TemplateDriftService,
    @Inject(CONFIG_REPOSITORY) private readonly repository: ConfigRepository,
  ) {}

  // -- effective config (L6 + L9; every authenticated member) ---------------

  /**
   * The request-scoped effective config (§5): tenant-static resolution +
   * the L6 overlay (this principal's permissions + branch scope) + the L9
   * derivation (navigation tree, emphasis, terminology). Never cached
   * across principals (BR-039: the server resolves, the client renders).
   */
  @Get("effective-config")
  async effectiveConfig(@Req() request: Request): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const permissions =
      identity.permissions ?? (await effectivePermissions(identity.userId, identity.tenantId));
    const config = await withTenant(identity.tenantId, () =>
      this.resolver.resolve(identity.tenantId, {
        userId: identity.userId,
        roleKey: identity.activeTenant?.roleKey ?? "member",
        permissions,
        branchScope: identity.activeTenant?.branchScope ?? null,
      }),
    );
    return envelope(config);
  }

  // -- registry reads (onboarding wizard + admin screens) --------------------

  /** The template registry (key, bilingual names, version, status, blurb). */
  @Get("templates")
  async listTemplates(): Promise<unknown> {
    const rows = await this.repository.listIndustryTemplates();
    return envelope(
      rows
        .filter((row) => row.isActive && row.status === "ACTIVE")
        .map((row) => ({
          key: row.key,
          name: row.manifest.name,
          nameAr: row.manifest.name_ar,
          version: row.version,
          status: row.status,
          description: row.manifest.description ?? null,
          descriptionAr: row.manifest.description_ar ?? null,
        })),
    );
  }

  /**
   * The bilingual activity catalog for the onboarding wizard's industry
   * step; `?activity=` adds the resolved suggestion (exact/suggested/null).
   */
  @Get("templates/activity-map")
  async activityMap(@Query("activity") activity?: string): Promise<unknown> {
    const resolution =
      activity === undefined || activity.trim().length === 0
        ? null
        : { activity, ...resolveTemplateForActivity(activity) };
    return envelope({ activities: SUPPORTED_ACTIVITIES, resolution });
  }

  /**
   * A template's full manifest + the capability preview resolved against
   * the CALLER's entitlements (included / optional-hidden / phase-gated /
   * blocked with the missing chain — the §4 onboarding screen).
   */
  @Get("templates/:key")
  async templateDetail(@Req() request: Request, @Param("key") key: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(
      await withTenant(identity.tenantId, async () => {
        const registry = await this.apply.loadRegistryTemplate(key);
        const entitlements = await this.repository.listActiveEntitlements();
        const check = checkPrerequisites(
          registry.manifest,
          entitlements.map((row) => row.featureKey),
        );
        const applied = await findAppliedStateRow();
        return {
          key: registry.key,
          version: registry.version,
          status: registry.status,
          manifest: registry.manifest,
          appliedHere:
            applied === undefined
              ? null
              : {
                  appliedVersion: applied.appliedVersion,
                  appliedManifestHash: applied.appliedManifestHash,
                  isPrimary: applied.templateKey === registry.key,
                },
          capabilityPreview: {
            status: check.status,
            missingChain: check.missingChain,
            guidance: check.guidance,
            capabilities: check.capabilities,
            closureViolations: check.closureViolations,
          },
        };
      }),
    );
  }

  // -- apply / switch / extend (permission + feature guarded) -----------------

  /**
   * Apply a template (onboarding's industry step or a first apply on a
   * template-less tenant). Idempotent; blocked prerequisites fail with the
   * typed missing chain + guidance (never silent).
   */
  @Post("templates/:key/apply")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.templates.apply")
  @RequireFeature("industry.template_engine")
  async applyTemplate(
    @Req() request: Request,
    @Param("key") key: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    applyBodySchema.parse(body ?? {});
    const result = await withTenant(identity.tenantId, () =>
      this.apply.apply(identity.userId, { templateKey: key, mode: "initial" }),
    );
    return envelope(result);
  }

  /** The switch/extend what-will-change diff (R9) — NO writes. */
  @Post("templates/:key/preview")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.templates.apply")
  @RequireFeature("industry.template_switching")
  async previewSwitch(
    @Req() request: Request,
    @Param("key") key: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = previewBodySchema.parse(body ?? { mode: "switch" });
    const diff: TemplateSwitchPreview = await withTenant(identity.tenantId, () =>
      this.switches.preview(identity.userId, { targetTemplateKey: key, mode: input.mode }),
    );
    return envelope(diff);
  }

  /**
   * Switch the primary template (BR-038 additive-only): archives the
   * previous terminology/navigation/capabilities, appends series, records
   * conflicts, publishes `template.switched`, audits the full diff.
   */
  @Post("templates/:key/switch")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.templates.apply")
  @RequireFeature("industry.template_switching")
  async switchTemplate(
    @Req() request: Request,
    @Param("key") key: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = switchBodySchema.parse(body ?? {});
    const result = await withTenant(identity.tenantId, () =>
      this.switches.switch(identity.userId, {
        targetTemplateKey: key,
        acknowledged: input.acknowledged,
      }),
    );
    return envelope(result);
  }

  /**
   * Extend with a second template (additive; the primary template_key
   * stays, the extension records in overrides.applied_extensions).
   */
  @Post("templates/:key/extend")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.templates.apply")
  @RequireFeature("industry.template_switching")
  async extendTemplate(
    @Req() request: Request,
    @Param("key") key: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = switchBodySchema.parse(body ?? {});
    const result = await withTenant(identity.tenantId, () =>
      this.switches.extend(identity.userId, {
        templateKey: key,
        acknowledged: input.acknowledged,
      }),
    );
    return envelope(result);
  }

  // -- registry drift (§2 item 11: offers recorded, never auto-applied) ------

  /** Compare applied vs registry version; record the upgrade offer on drift. */
  @Post("templates/drift-check")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.templates.apply")
  @RequireFeature("industry.template_engine")
  async driftCheck(@Req() request: Request): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const result = await withTenant(identity.tenantId, () =>
      this.drift.checkDrift(identity.tenantId),
    );
    return envelope(result);
  }
}
