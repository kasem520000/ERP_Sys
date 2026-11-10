import { Body, Controller, Delete, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { MfaService } from "../application/mfa-service";
import { MfaBootstrapService } from "../application/mfa-bootstrap-service";
import { UnauthenticatedError } from "../domain/identity-errors";

/**
 * MFA routes (AUTHENTICATION §3): enroll → PENDING factor + secret shown
 * once; verify → confirmed only with a valid code; recovery codes
 * regenerate (hashed at rest); disable requires a valid code. All
 * self-scoped: identity.mfa.manage is granted to every authenticated user
 * for own resources (matrix §3.9 "every user (self)").
 *
 * PHASE-024 T4 adds the PUBLIC enrollment bootstrap: a policy-mandated
 * user with no confirmed factor exchanges credentials for a 15-minute
 * session restricted to these endpoints (ADR-0015 §4 enforcement — the
 * deadlock-breaker; eligibility enforced server-side).
 */

const codeSchema = z.object({ code: z.string().min(6).max(10) });
const disableSchema = z.object({ code: z.string().min(6).max(10) });
const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

@Controller("api/v1/identity/mfa")
export class MfaController {
  constructor(
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(MfaBootstrapService) private readonly bootstrap: MfaBootstrapService,
  ) {}

  /**
   * PHASE-024: the enrollment bootstrap (public — the full login
   * discipline re-verified: per-IP limiter, counters, lockout, argon2id;
   * audited `mfa.bootstrap_started`). Only eligible when policy mandates
   * MFA and no confirmed factor exists (409 otherwise).
   */
  @Post("bootstrap")
  @HttpCode(HttpStatus.OK)
  async startBootstrap(@Req() request: Request, @Body() body: unknown) {
    const input = bootstrapSchema.parse(body);
    const result = await this.bootstrap.bootstrap({
      email: input.email,
      password: input.password,
      ip: clientIp(request),
    });
    return envelope(result);
  }

  @Post("totp/enroll")
  @RequirePermissions("identity.mfa.manage", { self: true })
  @HttpCode(HttpStatus.OK)
  async enroll(@Req() request: Request) {
    const identity = requireIdentity(request);
    const result = await this.mfa.enroll(identity.userId);
    return envelope(result);
  }

  @Post("totp/verify")
  @RequirePermissions("identity.mfa.manage", { self: true })
  @HttpCode(HttpStatus.OK)
  async verify(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = codeSchema.parse(body);
    await this.mfa.verify(identity.userId, input.code);
    return envelope({ confirmed: true });
  }

  @Delete("totp")
  @RequirePermissions("identity.mfa.manage", { self: true })
  async disable(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = disableSchema.parse(body);
    await this.mfa.disable(identity.userId, input.code);
    return envelope({ disabled: true });
  }

  @Post("recovery-codes")
  @RequirePermissions("identity.mfa.manage", { self: true })
  @HttpCode(HttpStatus.OK)
  async regenerate(@Req() request: Request) {
    const identity = requireIdentity(request);
    const codes = await this.mfa.regenerateRecoveryCodes(identity.userId);
    return envelope({ codes });
  }
}

function requireIdentity(request: Request) {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

/** The sessions.controller client-ip convention (R-03/R-07 parity). */
function clientIp(request: Request): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim();
  }
  return request.ip;
}
