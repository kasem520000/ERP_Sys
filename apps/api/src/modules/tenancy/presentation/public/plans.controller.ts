import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";

import { envelope } from "../../../../infra/http/envelope";
import { RateLimiter, systemClock } from "../../../identity/api/identity";
import { listPublicPlans } from "../../infrastructure/billing.store";

/**
 * PHASE-014 public plan surface (PHASE-014 §2.5/§4): the pricing page's
 * data source — public, bilingual, rate-limited, and tenant-data-free.
 * Prices render from the plan seeds ONLY (PLACEHOLDER ⚠ OQ-002 — the
 * page never hard-codes a number; changing a seed changes the page).
 * Entitlement enforcement stays server-side (BR-039): this is marketing,
 * not an authority.
 */

const LIMITER = new RateLimiter(systemClock, 60, 60 * 1000);

@Controller("api/v1/public")
export class PublicPlansController {
  /** The pricing page payload: the three self-serve plans, seed-driven. */
  @Get("plans")
  @HttpCode(HttpStatus.OK)
  async listPlans(): Promise<unknown> {
    LIMITER.consume("anon:public-plans");
    const plans = await listPublicPlans();
    return envelope(
      plans.map((plan) => ({
        key: plan.key,
        name: plan.name,
        nameAr: plan.nameAr,
        positioning: plan.positioning,
        priceAmount: plan.priceAmount,
        annualPriceAmount: plan.annualPriceAmount,
        currencyCode: plan.currencyCode,
        billingPeriod: plan.billingPeriod,
        highlight: plan.highlight,
        sortOrder: plan.sortOrder,
        placeholderPrice: plan.priceAmount === "0.0000",
        limits: plan.limits,
        featureKeys: plan.featureKeys,
      })),
    );
  }
}
