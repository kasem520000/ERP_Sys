import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { PreferencesService } from "../application/preferences-service";

/**
 * PHASE-041 T-06 routes (TB-23): the preference matrix. The SELF plane
 * (a user reads/upserts their OWN rows — the notification_prefs precedent,
 * authenticated-only, no permission) and the TENANT-DEFAULT plane
 * (communication.preferences.manage). The dispatch resolver is a service
 * consumed by the digest/nudge jobs — no route of its own.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const moduleSchema = z.enum([
  "limits",
  "subscription",
  "reconciliation",
  "invoice_overdue",
  "stock",
  "templates",
  "crm",
  "einvoicing",
  "notes",
  "installments",
  "budgeting",
  "purchasing",
  "collections",
  "warranties",
  "digest",
]);

const channelSchema = z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"]);

const upsertSchema = z
  .object({
    module: moduleSchema,
    channel: channelSchema,
    enabled: z.boolean(),
  })
  .strict();

@Controller("api/v1/communication/preferences")
export class PreferencesController {
  constructor(@Inject(PreferencesService) private readonly preferences: PreferencesService) {}

  /** The caller's own matrix (self plane). */
  @Get("me")
  async myMatrix(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(await this.preferences.matrixForUser(identity.userId));
  }

  /** Upsert the caller's own row (self plane). */
  @Post("me")
  @HttpCode(HttpStatus.OK)
  async upsertMine(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = upsertSchema.parse(body);
    await this.preferences.upsertSelf(identity.userId, input);
    return envelope({ updated: true });
  }

  /** The tenant-default rows (the matrix the defaults plane manages). */
  @Get("defaults")
  @RequirePermissions("communication.preferences.manage")
  async defaults() {
    return envelope(await this.preferences.listDefaults());
  }

  /** Upsert a tenant-default row (communication.preferences.manage). */
  @Post("defaults")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communication.preferences.manage")
  async upsertDefault(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = upsertSchema.parse(body);
    await this.preferences.upsertDefault(identity.userId, input);
    return envelope({ updated: true });
  }
}
