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
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { CalendarService } from "../application/calendar-service";

/**
 * PHASE-041 T-09 routes (IN-17/IN-18, matrix §3.19 — all under
 * `communication.calendar.connect`): the OAuth connect flow (consent URL
 * with the anti-CSRF state + the callback that exchanges the code and
 * seals the tokens), the task-event write, and the OPT-IN contacts sync
 * with the review-only proposals (accept applies, reject dismisses —
 * never an auto-merge).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const acceptSchema = z
  .object({ partnerId: z.string().uuid().optional() })
  .strict();

@Controller("api/v1/communication/calendar")
export class CalendarController {
  constructor(@Inject(CalendarService) private readonly calendar: CalendarService) {}

  /** The connectable providers + the caller's connection state (masked). */
  @Get("status")
  @RequirePermissions("communication.calendar.connect")
  async status(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(await this.calendar.status(identity.userId));
  }

  /** Begin the OAuth flow: the consent URL + the state nonce. */
  @Get("connect/:provider")
  @RequirePermissions("communication.calendar.connect")
  async beginConnect(
    @Req() request: Request,
    @Param("provider") provider: "google" | "outlook",
    @Query("redirectUri") redirectUri: string,
  ) {
    const identity = requireIdentity(request);
    if (provider !== "google" && provider !== "outlook") {
      throw new Error(`unknown calendar provider ${provider}`);
    }
    return envelope(
      await this.calendar.beginConnect(identity.userId, provider, redirectUri),
    );
  }

  /** The OAuth callback: state-verified code exchange + sealed tokens. */
  @Post("callback")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communication.calendar.connect")
  async completeConnect(
    @Req() request: Request,
    @Body() body: unknown,
    @Query("redirectUri") redirectUri: string,
  ) {
    const identity = requireIdentity(request);
    const input = callbackQuery.parse(body);
    return envelope(
      await this.calendar.completeConnect(identity.userId, {
        code: input.code,
        state: input.state,
        redirectUri,
      }),
    );
  }

  /** Write a task's event onto the caller's connected calendar. */
  @Post("events/task/:taskId")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("communication.calendar.connect")
  async writeTaskEvent(@Req() request: Request, @Param("taskId") taskId: string) {
    const identity = requireIdentity(request);
    return envelope(await this.calendar.writeTaskEventFromId(identity.userId, taskId));
  }

  /** The OPT-IN contacts sync (pull + match + queue for review). */
  @Post("contacts/sync")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communication.calendar.connect")
  async syncContacts(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(await this.calendar.syncContacts(identity.userId));
  }

  /** The review queue (pending first — NEVER auto-merged). */
  @Get("contacts/proposals")
  @RequirePermissions("communication.calendar.connect")
  async proposals() {
    return envelope(await this.calendar.listProposals());
  }

  /** Accept: apply the link/add through the partners store. */
  @Post("contacts/proposals/:id/accept")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communication.calendar.connect")
  async accept(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = acceptSchema.parse(body ?? {});
    return envelope(await this.calendar.acceptProposal(identity.userId, id, input.partnerId));
  }

  /** Reject: dismiss the proposal. */
  @Post("contacts/proposals/:id/reject")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("communication.calendar.connect")
  async reject(@Param("id") id: string) {
    return envelope(await this.calendar.rejectProposal(id));
  }
}
