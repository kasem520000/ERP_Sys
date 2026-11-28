import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { WorkflowDeepLinkService } from "../application/deep-link-service";

/**
 * PHASE-052 (W-47 — T-06, dated 2026-11-27) THE WORKFLOW ACT SURFACE —
 * the module's FIRST routes (the engine core was service-layer, W-44;
 * the routes land here per the plan's own sequencing). THE DEEP-LINK
 * LAW (D-09 — the acceptance #6 spine):
 *
 *   `GET /api/v1/workflow/act` — the LINK PREVIEW: the act page's own
 *   read (the step's rendering facts for a USABLE token — the same
 *   decode/expire/actor floors as the act; the W-48 web plane renders
 *   this, never the claims parsed client-side). Session-authenticated
 *   (SESSION_ROUTES — the notifications self-plane pattern: the link's
 *   user is the reader; the actor-mismatch floor still compares the
 *   session against the token's bound user).
 *
 *   `POST /api/v1/workflow/act` — THE ACT through the signed one-time
 *   token: session-authenticated (never an unauthenticated action
 *   surface — the risk §7 law), permission-guarded on `workflow.
 *   approve` (matrix §3.30 — the approve/reject act key), feature-
 *   gated on `workflow.engine` (D-04 — the base unit), Idempotency-
 *   Key'd by the global POST guard, and single-use by the step's own
 *   CAS stamp (the acted_at stamp is the ledger — NO token table).
 *
 * The typed refusals (the D-09 family, registered in error.filter.ts's
 * domainStatus chain in THIS increment — the PHASE-045 T-03 lesson):
 * WORKFLOW_TOKEN_EXPIRED (the claim's own deadline) ·
 * WORKFLOW_TOKEN_ACTOR_MISMATCH (the link's bound user vs the session)
 * · WORKFLOW_STEP_ALREADY_ACTED (the replay — the CAS single-use) ·
 * WORKFLOW_INPUT_INVALID (the tamper/shape class) ·
 * WORKFLOW_STEP_INSTANCE_NOT_FOUND (the A7 404 parity).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const actSchema = z.object({
  token: z.string().min(1).max(4_096),
  comment: z.string().max(2_000).nullable().optional(),
});

@Controller("api/v1/workflow")
export class WorkflowController {
  constructor(
    @Inject(WorkflowDeepLinkService) private readonly deepLinks: WorkflowDeepLinkService,
  ) {}

  /** The link preview — the act page's own read (SESSION_ROUTES: the
   * notifications self-plane pattern; the token's floors still run —
   * a dead link previews as the typed refusal, never a stale form). */
  @Get("act")
  async preview(@Req() request: Request, @Query("token") token?: string): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsed = actSchema.pick({ token: true }).parse({ token });
    return envelope(
      await this.deepLinks.previewToken({ token: parsed.token, actorId: identity.userId }),
    );
  }

  /** THE ACT through the signed one-time deep link (D-09): the approve
   * or reject lands through the engine's own act path — the G-67 floor,
   * the delegation resolution, the actor law, the CAS single-use stamp,
   * the pointer walk, the notifications, the bus. The comment captures
   * with the act (the acceptance #6's own record). */
  @Post("act")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("workflow.approve")
  @RequireFeature("workflow.engine")
  async act(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsed = actSchema.parse(body);
    return envelope(
      await this.deepLinks.actThroughToken({
        token: parsed.token,
        actorId: identity.userId,
        comment: parsed.comment ?? null,
      }),
    );
  }
}
