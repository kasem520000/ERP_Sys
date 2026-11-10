import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { InboxService } from "../application/inbox-service";

/**
 * PHASE-014 notifications center routes (PHASE-014 §2.8/§4; matrix self
 * plane): the per-user inbox + channel preferences. Session-authenticated
 * (SESSION_ROUTES — every user manages their own inbox; the matrix carries
 * no permission key for self surfaces). The tenant UoW comes from the
 * TenantContextInterceptor; rows are RLS-scoped to the tenant and the
 * service filters to the caller's rows + tenant broadcasts.
 */

const prefWriteSchema = z.object({
  // PHASE-015 T10: + stock (reorder alerts) and templates (upgrade offers).
  category: z.enum([
    "limits",
    "subscription",
    "reconciliation",
    "invoice_overdue",
    "stock",
    "templates",
  ]),
  inApp: z.boolean(),
  email: z.boolean(),
});

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

@Controller("api/v1/notifications")
export class NotificationsController {
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}

  /** The caller's inbox (own rows + tenant broadcasts). */
  @Get()
  async list(
    @Req() request: Request,
    @Query("unread") unread?: string,
    @Query("limit") rawLimit?: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : NaN;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
    return envelope(
      await this.inbox.listForUser(identity.userId, {
        unreadOnly: unread === "true" || unread === "1",
        limit,
      }),
    );
  }

  @Get("unread-count")
  async unreadCount(@Req() request: Request): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope({ count: await this.inbox.unreadCount(identity.userId) });
  }

  @Patch(":id/read")
  @HttpCode(HttpStatus.OK)
  async markRead(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    const updated = await this.inbox.markRead(id, identity.userId);
    return envelope({ read: updated });
  }

  /** The caller's per-category channel preferences (defaults on). */
  @Get("preferences")
  async preferences(@Req() request: Request): Promise<unknown> {
    const identity = requireIdentity(request);
    const rows = await this.inbox.prefsForUser(identity.userId);
    return envelope(rows);
  }

  @Put("preferences")
  async writePreference(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = prefWriteSchema.parse(body);
    await this.inbox.upsertPref(identity.userId, input);
    return envelope({ saved: true, ...input });
  }
}
