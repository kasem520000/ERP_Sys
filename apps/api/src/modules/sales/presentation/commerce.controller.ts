import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import {
  FakeCommerceChannel,
  importChannelOrders,
  listChannelOrders,
  resolveConflict,
  type CommerceChannelPort,
} from "../adapters/commerce/commerce-port";

/**
 * PHASE-023 T8 — commerce-channel routes (integrations README §3.7; phase
 * §2 item 9): channel order import behind the CommerceChannelPort. The
 * FAKE channel is the only registered implementation (contract testing —
 * no real platform API is integrated against unverified assumptions; a
 * real channel ships per the adapter authoring rules with its own decision
 * record + contract tests). Import carries the Idempotency-Key per batch
 * (duplicate batch = the recorded outcome replayed); conflicts resolve
 * through explicit server-decision actions (ADR-0012 — never LWW).
 */

/** The channel registry (fake-only today; per-channel credentials ship with real adapters). */
const CHANNELS = new Map<string, CommerceChannelPort>();
function channelRegistry(): Map<string, CommerceChannelPort> {
  if (CHANNELS.size === 0) {
    CHANNELS.set("fake-channel", new FakeCommerceChannel());
  }
  return CHANNELS;
}

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const importSchema = z.object({
  channelId: z.string().min(2).max(40),
  batchKey: z.string().min(8).max(120),
});

const resolveSchema = z.object({
  resolution: z.enum(["KEEP_EXISTING", "TAKE_INCOMING", "REJECT_BOTH"]),
});

@Controller("/api/v1/sales/commerce")
export class CommerceController {
  @Get("channels")
  @RequirePermissions("sales.commerce.manage")
  async listChannels(): Promise<unknown> {
    return envelope([...channelRegistry().keys()].map((id) => ({ id, live: false, kind: "fake" })));
  }

  @Post("import")
  @RequirePermissions("sales.commerce.manage")
  @HttpCode(HttpStatus.OK)
  async import(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = importSchema.parse(body);
    const channel = channelRegistry().get(input.channelId);
    if (channel === undefined) {
      return envelope({ error: "unknown channel", channelId: input.channelId });
    }
    return envelope(
      await importChannelOrders({ channel, batchKey: input.batchKey, actorId: identity.userId }),
    );
  }

  @Get("orders")
  @RequirePermissions("sales.commerce.manage")
  async orders(@Query("status") status?: string): Promise<unknown> {
    return envelope(await listChannelOrders({ status }));
  }

  @Post("orders/:id/resolve")
  @RequirePermissions("sales.commerce.manage")
  @HttpCode(HttpStatus.OK)
  async resolve(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = resolveSchema.parse(body);
    await resolveConflict({ channelOrderId: id, resolution: input.resolution, actorId: identity.userId });
    return envelope({ resolved: true });
  }
}
