import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { Request } from "express";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { FeedService } from "../application/feed-service";
import { FeedInvalidError } from "../domain/feed-errors";

/**
 * PHASE-045 (T-10) — the payroll variable-feed routes: the per-pay-
 * period overtime / absence / late feeds + the leave balance snapshot —
 * PHASE-046's variable-component inputs. The permission mapping
 * (matrix §3.23's dated note): the feed is the PAYROLL PREPARATION read
 * — it rides `payroll.runs.view` (the payroll_officer's run-surface
 * key), the consumer-side handoff of the hr cluster's facts; the feed
 * READS hr data but grants no hr management surface (the SoD law's
 * read-side complement).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

@Controller("api/v1/hr/feeds")
export class FeedController {
  constructor(@Inject(FeedService) private readonly feeds: FeedService) {}

  @Get("variable")
  @RequirePermissions("payroll.runs.view")
  async variableFeed(
    @Req() request: Request,
    @Query("periodId") periodId?: string,
    @Query("employeeId") employeeId?: string,
  ) {
    const identity = requireIdentity(request);
    if (periodId === undefined || periodId === "") {
      throw new FeedInvalidError("periodId is required");
    }
    return envelope(
      await this.feeds.variableFeed({
        periodId,
        ...(employeeId === undefined || employeeId === "" ? {} : { employeeId }),
        actorId: identity.userId,
      }),
    );
  }
}
