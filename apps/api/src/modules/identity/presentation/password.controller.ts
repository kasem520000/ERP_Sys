import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf } from "../../../infra/context/session-context";
import { RecoveryService } from "../application/recovery-service";
import { UnauthenticatedError } from "../domain/identity-errors";
import { newPasswordSchema } from "../domain/password-policy";

/**
 * Password routes (AUTHENTICATION §4): reset request always answers 200
 * (no account enumeration); reset consume is single-use + short-lived +
 * revokes every session; authenticated change keeps the current session.
 */

const requestSchema = z.object({ email: z.string().email() });
const consumeSchema = z.object({ newPassword: newPasswordSchema });
const changeSchema = z.object({
  current: z.string().min(1).max(200),
  next: newPasswordSchema,
});

@Controller("api/v1/identity")
export class PasswordController {
  constructor(@Inject(RecoveryService) private readonly recovery: RecoveryService) {}

  /** POST /api/v1/identity/password-resets — public, uniform 200 (R-05). */
  @Post("password-resets")
  @HttpCode(HttpStatus.OK)
  async requestReset(@Req() request: Request, @Body() body: unknown) {
    const input = requestSchema.parse(body);
    await this.recovery.requestReset(input.email, clientIp(request));
    return envelope({ accepted: true });
  }

  /** PUT /api/v1/identity/password-resets/:token — public single-use consume. */
  @Put("password-resets/:token")
  @HttpCode(HttpStatus.OK)
  async consumeReset(@Param("token") token: string, @Body() body: unknown) {
    const input = consumeSchema.parse(body);
    await this.recovery.consumeReset(token, input.newPassword);
    return envelope({ reset: true });
  }

  /** POST /api/v1/identity/password-change — session-authenticated change. */
  @Post("password-change")
  @HttpCode(HttpStatus.OK)
  async change(@Req() request: Request, @Body() body: unknown) {
    const identity = identityOf(request);
    if (identity === undefined) {
      throw new UnauthenticatedError();
    }
    const input = changeSchema.parse(body);
    await this.recovery.changePassword(identity.userId, input.current, input.next, identity.sessionId);
    return envelope({ changed: true });
  }
}

function clientIp(request: Request): string {
  const forwarded = request.header("x-forwarded-for");
  if (forwarded !== undefined && forwarded !== "") {
    return forwarded.split(",")[0]!.trim();
  }
  return request.ip ?? "unknown";
}
