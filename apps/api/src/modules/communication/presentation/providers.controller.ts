import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
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
import { ProviderConfigService } from "../application/provider-config.service";
import { PROVIDER_IDS } from "../application/provider-registry";

/**
 * PHASE-041 T-03 routes — provider selection + credentials + per-market
 * senders (matrix §3.19): the masked catalog read (credential STATE, never
 * values) and the sealed write (secret fields sealed at rest; the audit
 * event records the selection change, never a credential value).
 *
 * Permission decision (documented in the completion report §4): provider
 * configuration rides `communication.templates.manage` — the
 * settings/communication back-office hub key (the phase's five-key budget
 * has no dedicated provider key; "provider management beyond selection +
 * credentials" is explicitly out of scope). Feature gating: the catalog is
 * visible on ALL plans (communication.outbound — the SANDBOX defaults show
 * honestly); the per-channel tier-4 entitlement check fires SERVER-SIDE in
 * the service at write time (a starter tenant cannot even save a paid
 * provider selection).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const providerIdSchema = z.string().refine(
  (value) => value === "" || PROVIDER_IDS.includes(value),
  { message: "unknown provider id" },
);

const updateSchema = z
  .object({
    selection: z
      .object({
        EMAIL: providerIdSchema.optional(),
        WHATSAPP: providerIdSchema.optional(),
        SMS: providerIdSchema.optional(),
      })
      .optional(),
    credentials: z
      .record(z.string().refine((id) => PROVIDER_IDS.includes(id), { message: "unknown provider id" }), z.record(z.string().max(2000), z.string().max(8192)))
      .optional(),
    markets: z
      .record(
        z.string().regex(/^[A-Z]{2}$/, "market keys are ISO-3166 alpha-2"),
        z
          .object({
            whatsappPhoneNumberId: z.string().min(1).max(200).optional(),
            smsSenderName: z.string().min(1).max(64).optional(),
            emailFromAddress: z.string().min(3).max(320).optional(),
          })
          .strict(),
      )
      .optional(),
    sendCap: z
      .object({
        dailyHardCap: z.number().int().min(1).max(1_000_000).nullable().optional(),
      })
      .optional(),
  })
  .strict();

@Controller("api/v1/communication/providers")
export class ProvidersController {
  constructor(
    @Inject(ProviderConfigService) private readonly providers: ProviderConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The masked catalog: registry metadata + selection state + market map. */
  @Get()
  @RequirePermissions("communication.templates.manage")
  @RequireFeature("communication.outbound")
  async catalog() {
    return envelope(await this.providers.readCatalog());
  }

  /** The sealed write: selection + credentials + markets + send cap. */
  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communication.templates.manage")
  @RequireFeature("communication.outbound")
  async update(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body);
    const before = await this.providers.readCatalog();
    const catalog = await this.providers.updateConfig(identity.userId, input);
    // Audit the selection change (NEVER credential values — the after
    // snapshot is the masked catalog shape).
    await this.audit.record({
      action: "communication.provider_config.updated",
      entityType: "communication_provider_config",
      entityId: "communication.providers",
      actorId: identity.userId,
      before: {
        channels: before.channels,
        sendCap: before.sendCap,
      },
      after: {
        channels: catalog.channels,
        markets: catalog.markets,
        sendCap: catalog.sendCap,
      },
    });
    return envelope(catalog);
  }
}
