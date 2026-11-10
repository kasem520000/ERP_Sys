import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../../infra/http/envelope";
import { RegistrationService } from "../../application/registration-service";
import * as store from "../../infrastructure/tenancy.store";

/**
 * Public registration surface (PHASE-004 §2.2/T4): anonymous, per-IP +
 * globally rate-limited (inside the service). `options` exposes exactly
 * the seeded reference data the form needs — no secrets, no tenant data.
 */

const registerSchema = z.object({
  businessName: z.string().min(1).max(200),
  businessNameAr: z.string().min(1).max(200).nullish(),
  countryCode: z.string().length(2),
  baseCurrency: z.string().length(3),
  industryTemplateKey: z.string().min(4).max(60),
  taxRegistrationStatus: z.enum(["REGISTERED", "NOT_REGISTERED", "DEREGISTERED"]),
  taxRegistrationNumber: z.string().min(3).max(50).nullish(),
  ownerEmail: z.string().email().max(200),
  ownerFullName: z.string().min(1).max(200),
  ownerPassword: z.string().min(10).max(200),
});

@Controller("api/v1/platform")
export class RegistrationController {
  constructor(
    @Inject(RegistrationService) private readonly registration: RegistrationService,
  ) {}

  /** Seeded form options: countries, currencies, industry templates. */
  @Get("register/options")
  async options(): Promise<unknown> {
    const [countries, currencies, templates] = await Promise.all([
      store.listCountries(),
      store.listCurrencies(),
      store.listIndustryTemplates(),
    ]);
    return envelope({
      countries: countries
        .filter((row) => row.isActive)
        .map((row) => ({
          code: row.code,
          name: row.name,
          nameAr: row.nameAr,
          currencyCode: row.currencyCode,
          defaultLocale: row.defaultLocale,
        })),
      currencies: currencies
        .filter((row) => row.isActive)
        .map((row) => ({
          code: row.code,
          name: row.name,
          nameAr: row.nameAr,
          minorUnits: row.minorUnits,
        })),
      industryTemplates: templates.map((row) => ({
        key: row.key,
        name: row.name,
        nameAr: row.nameAr,
        version: row.version,
      })),
    });
  }

  /** Anonymous tenant registration (rate-limited; see the service). */
  @Post("register")
  @HttpCode(HttpStatus.OK)
  async register(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const input = registerSchema.parse(body);
    const result = await this.registration.register({
      businessName: input.businessName,
      businessNameAr: input.businessNameAr ?? null,
      countryCode: input.countryCode.toUpperCase(),
      baseCurrency: input.baseCurrency.toUpperCase(),
      industryTemplateKey: input.industryTemplateKey,
      taxRegistrationStatus: input.taxRegistrationStatus,
      taxRegistrationNumber: input.taxRegistrationNumber ?? null,
      ownerEmail: input.ownerEmail,
      ownerFullName: input.ownerFullName,
      ownerPassword: input.ownerPassword,
      ip: request.ip,
    });
    // No session is issued: the owner signs in through the normal flow
    // (registration and authentication are deliberately separate).
    return envelope({
      tenantId: result.tenantId,
      ownerEmail: input.ownerEmail,
      trialExpiresAt: result.trialExpiresAt,
      next: "login",
    });
  }
}
