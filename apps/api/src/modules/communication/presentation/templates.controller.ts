import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { AuditService } from "../../audit/api/audit";
import { UnauthenticatedError } from "../../identity/api/identity";
import { TemplateService } from "../application/template-service";

/**
 * PHASE-041 T-04 routes — the tenant template hub (FD-30, matrix §3.19,
 * all under `communication.templates.manage`): the effective list (tenant
 * overrides + builtin fallbacks flagged), the upsert/delete of overrides,
 * and the render preview (fail-closed — a preview that would fail at send
 * time fails at preview time with the same error).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const variableSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
  required: z.boolean(),
  description: z.string().max(500).optional(),
});

const upsertSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_.]{2,80}$/),
    channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]),
    locale: z.enum(["ar", "en"]),
    module: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
    subject: z.string().min(1).max(300).nullable().optional(),
    body: z.string().min(1).max(20_000),
    variables: z.array(variableSchema).max(50),
    isActive: z.boolean().default(true),
  })
  .strict();

const previewSchema = z
  .object({
    key: z.string().min(1).max(120),
    channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]),
    locale: z.enum(["ar", "en"]),
    variables: z.record(z.string().max(80), z.string().max(2000)),
  })
  .strict();

@Controller("api/v1/communication/templates")
export class TemplatesController {
  constructor(
    @Inject(TemplateService) private readonly templates: TemplateService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The effective catalog: tenant overrides + builtin fallbacks (flagged). */
  @Get()
  @RequirePermissions("communication.templates.manage")
  @RequireFeature("communication.templates")
  async list() {
    return envelope(await this.templates.listEffective());
  }

  /** Upsert a tenant override (deactivating one hides it — builtin resumes). */
  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communication.templates.manage")
  @RequireFeature("communication.templates")
  async upsert(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = upsertSchema.parse(body);
    const row = await this.templates.upsert(identity.userId, input);
    await this.audit.record({
      action: "communication.template.upserted",
      entityType: "message_template",
      entityId: `${input.key}|${input.channel}|${input.locale}`,
      actorId: identity.userId,
      after: {
        key: row.key,
        channel: row.channel,
        locale: row.locale,
        module: row.module,
        isActive: row.isActive,
      },
    });
    return envelope(row);
  }

  /** Delete a tenant override (the builtin fallback resumes). */
  @Delete()
  @RequirePermissions("communication.templates.manage")
  @RequireFeature("communication.templates")
  async remove(
    @Query("key") key: string,
    @Query("channel") channel: "EMAIL" | "WHATSAPP" | "SMS",
    @Query("locale") locale: "ar" | "en",
  ) {
    await this.templates.remove(key, channel, locale);
    return envelope({ removed: true });
  }

  /** The render preview (fail-closed: preview errors = send-time errors). */
  @Post("preview")
  @RequirePermissions("communication.templates.manage")
  @RequireFeature("communication.templates")
  async preview(@Body() body: unknown) {
    const input = previewSchema.parse(body);
    return envelope(await this.templates.render(input.key, input.channel, input.locale, input.variables));
  }
}
