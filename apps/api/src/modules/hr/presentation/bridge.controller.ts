import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { BridgeService } from "../application/bridge-service";

/**
 * PHASE-045 (T-09) — the employee ↔ user identity-bridge routes (HR-13).
 * The permission mapping (matrix §3.23's dated note): the link is
 * EMPLOYEE-MASTER maintenance — the routes ride the payroll employee
 * keys (`payroll.employees.manage` for the link/unlink, `.view` for the
 * bridge read), NOT any hr.* key and NEVER a user-administration key —
 * the SoD law: linking grants nothing; HR data visibility rides HR
 * permissions only. No dedicated key was seeded (0086) and none is
 * invented.
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const linkBody = z.object({ userId: UUID });

@Controller("api/v1/hr")
export class BridgeController {
  constructor(@Inject(BridgeService) private readonly bridge: BridgeService) {}

  @Post("employees/:id/link-user")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.employees.manage")
  async linkUser(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = linkBody.parse(body);
    return envelope(
      await this.bridge.link({
        employeeId: UUID.parse(id),
        userId: input.userId,
        actorId: identity.userId,
      }),
    );
  }

  @Post("employees/:id/unlink-user")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.employees.manage")
  async unlinkUser(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(
      await this.bridge.unlink({ employeeId: UUID.parse(id), actorId: identity.userId }),
    );
  }

  @Get("employees/:id/bridge")
  @RequirePermissions("payroll.employees.view")
  async getBridge(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.bridge.get(UUID.parse(id)));
  }
}
