import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { UnifiedInboxService } from "../application/inbox-service";

/**
 * PHASE-041 T-08 routes (UX-14/IN-16, matrix §3.19 — the unified inbox is
 * the sales/support surface): the per-partner interaction timeline with
 * filters + the call logging (create/edit by the logger). All under
 * `communication.inbox.read` (owner + accountant + sales).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const listQuery = z.object({
  partnerId: z.string().uuid().optional(),
  kind: z.enum(["MESSAGE", "CALL"]).optional(),
  channel: z.enum(["EMAIL", "WHATSAPP", "SMS", "CALL"]).optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const callSchema = z
  .object({
    partnerId: z.string().uuid(),
    at: z.string().datetime().optional(),
    direction: z.enum(["INBOUND", "OUTBOUND"]),
    outcome: z.enum(["COMPLETED", "NO_ANSWER", "BUSY", "VOICEMAIL", "FAILED", "SCHEDULED"]),
    summary: z.string().min(1).max(300),
    body: z.string().max(5000).nullable().optional(),
    durationMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    relatedType: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/).nullable().optional(),
    relatedId: z.string().uuid().nullable().optional(),
  })
  .strict();

const callPatchSchema = z
  .object({
    outcome: z.enum(["COMPLETED", "NO_ANSWER", "BUSY", "VOICEMAIL", "FAILED", "SCHEDULED"]).optional(),
    summary: z.string().min(1).max(300).optional(),
    body: z.string().max(5000).nullable().optional(),
    durationMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  })
  .strict();

@Controller("api/v1/communication/inbox")
export class InboxController {
  constructor(
    @Inject(UnifiedInboxService) private readonly inbox: UnifiedInboxService,
  ) {}

  /** The unified timeline: partner-scoped or tenant-wide, with filters. */
  @Get()
  @RequirePermissions("communication.inbox.read")
  async list(@Query() query: unknown) {
    const filter = listQuery.parse(query);
    return envelope(
      await this.inbox.list({
        partnerId: filter.partnerId,
        kind: filter.kind,
        channel: filter.channel,
        direction: filter.direction,
        fromAt: filter.from,
        toAt: filter.to,
        limit: filter.limit,
      }),
    );
  }

  /** Log a call (IN-16): outcome + duration linked to partner + user. */
  @Post("calls")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("communication.inbox.read")
  async logCall(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = callSchema.parse(body);
    return envelope(
      await this.inbox.logCall({
        actorId: identity.userId,
        partnerId: input.partnerId,
        at: input.at,
        direction: input.direction,
        outcome: input.outcome,
        summary: input.summary,
        body: input.body ?? null,
        durationMinutes: input.durationMinutes ?? null,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
      }),
    );
  }

  /** The logger edits their own call entry (log semantics — no deletes). */
  @Patch("calls/:id")
  @RequirePermissions("communication.inbox.read")
  async updateCall(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const patch = callPatchSchema.parse(body);
    return envelope(await this.inbox.updateCall(id, identity.userId, patch));
  }
}
