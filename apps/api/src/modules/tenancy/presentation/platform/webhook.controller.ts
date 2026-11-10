import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { envelope } from "../../../../infra/http/envelope";
import { SubscriptionService } from "../../application/billing/subscription-service";

/**
 * PHASE-014 provider webhook surface (PHASE-014 §4; SECRETS §webhook):
 * `POST /api/v1/platform/billing/webhook` — PUBLIC by necessity (a payment
 * provider cannot hold a session; the HMAC signature + timestamp window
 * ARE the authentication). Registered in PUBLIC_ROUTES; idempotency is
 * EXEMPT here per IDEMPOTENCY §1.5's provider-delivery class (duplicate
 * deliveries are deduplicated by the billing_events idempotency key —
 * INV-013 discipline — and the raw-body re-serialization note below).
 *
 * Raw body: express.json parses the payload; the sandbox provider's bytes
 * are canonical JSON.stringify output, and JSON.parse/stringify round-trips
 * preserve key order, so `JSON.stringify(request.body)` reproduces the
 * signed bytes exactly. A production provider with non-canonical bytes
 * needs raw-body capture (`NestFactory.create(..., { rawBody: true })`) —
 * documented as the adapter port's integration note (OQ-003 decision).
 */
@Controller("api/v1/platform/billing")
export class BillingWebhookController {
  constructor(
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {}

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() request: Request, @Body() _body: unknown): Promise<unknown> {
    const signature =
      request.header("billing-signature") ?? request.header("webhook-signature") ?? "";
    const rawBody = JSON.stringify(request.body ?? {});
    const outcome = await this.subscriptions.ingestWebhook(rawBody, signature);
    return envelope(outcome);
  }
}
