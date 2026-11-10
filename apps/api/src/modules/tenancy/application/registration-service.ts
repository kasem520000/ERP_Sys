import { Inject, Injectable } from "@nestjs/common";

import { env } from "../../../config/env";
import {
  EmailAlreadyRegisteredError,
  InvalidRegistrationInputError,
} from "../domain/tenancy-errors";
import * as store from "../infrastructure/tenancy.store";
import * as billingStore from "../infrastructure/billing.store";
import {
  parseSettingValue,
  validateTaxRegistrationPair,
} from "../../configuration/api";
import {
  RateLimiter,
  findUserByEmail,
  insertMembership,
  insertUser,
  findTenantRoleByKey,
  cloneSystemTemplate,
  systemClock,
} from "../../identity/api/identity";
import { PasswordService } from "../../identity/api/identity";
import { EMAIL_SERVICE } from "../../notifications/notifications.module";
import type { EmailService } from "../../notifications/application/email-service";
import { AuditService } from "../../audit/api/audit";
import { withPlatformScope, withTenantOnTx } from "../../../infra/db/tenant-context";
import { childLogger } from "../../../infra/observability/logger";

/**
 * Public registration flow (PHASE-004 §2.2/T4): one rate-limited anonymous
 * POST creating tenant + owner user + owner membership (system template
 * instantiation, SEEDS/README) + trial subscription + materialized
 * entitlements + registration settings + audit events — atomically in a
 * single platform-scope UoW.
 *
 * Anonymous-safety: the surface is per-IP + globally rate-limited (R-03
 * pattern) and validation is uniform; a duplicate owner email is the only
 * enumerable fact — same shape as every signup surface, and the rate
 * budget caps probing (reconciliation recorded in the completion report).
 *
 * Trial shape (SUBSCRIPTION §7): new tenants start on the BUSINESS plan
 * as a TRIAL entitlement set, duration PLACEHOLDER = 14 days (OQ-002
 * pricing pass owns the real number; documented in the seeds).
 */

const log = childLogger({ module: "tenancy-registration" });

/** PLACEHOLDER (SUBSCRIPTION §7 proposal) — real value lands with OQ-002. */
const TRIAL_DAYS = 14;

const IP_LIMITER = new RateLimiter(systemClock, 5, 60 * 60 * 1000);
const GLOBAL_LIMITER = new RateLimiter(systemClock, 60, 60 * 60 * 1000);

export interface RegistrationInput {
  businessName: string;
  businessNameAr: string | null;
  countryCode: string;
  baseCurrency: string;
  industryTemplateKey: string;
  taxRegistrationStatus: string;
  taxRegistrationNumber: string | null;
  ownerEmail: string;
  ownerFullName: string;
  ownerPassword: string;
  ip?: string;
}

export interface RegistrationResult {
  tenantId: string;
  ownerUserId: string;
  trialExpiresAt: string;
}

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  private readonly clock = systemClock;

  async register(input: RegistrationInput): Promise<RegistrationResult> {
    IP_LIMITER.consume(`register:ip:${input.ip ?? "unknown"}`);
    GLOBAL_LIMITER.consume("register:global");

    const email = input.ownerEmail.trim().toLowerCase();
    const country = await store.findCountry(input.countryCode);
    if (country === undefined || !country.isActive) {
      throw new InvalidRegistrationInputError(
        `Unsupported country: ${input.countryCode}`,
      );
    }
    // The seeded country record carries its bookkeeping currency (COUNTRY_
    // PACKS §5); base currency IS the country currency (A-003 consistency).
    if (input.baseCurrency.toUpperCase() !== country.currencyCode) {
      throw new InvalidRegistrationInputError(
        `Base currency for ${country.code} must be ${country.currencyCode}`,
      );
    }
    const template = (await store.listIndustryTemplates()).find(
      (row) => row.key === input.industryTemplateKey,
    );
    if (template === undefined) {
      throw new InvalidRegistrationInputError(
        `Unknown industry template: ${input.industryTemplateKey}`,
      );
    }
    let taxStatus: string;
    let taxNumber: string | null;
    try {
      taxStatus = parseSettingValue(
        "tax.registration.status",
        input.taxRegistrationStatus,
      ) as string;
      taxNumber =
        input.taxRegistrationNumber === null || input.taxRegistrationNumber === ""
          ? null
          : (parseSettingValue("tax.registration.number", input.taxRegistrationNumber) as string);
      validateTaxRegistrationPair(taxStatus, taxNumber);
    } catch (error) {
      // The registration surface speaks InvalidRegistrationInputError
      // (422 tenancy/invalid-registration-input), not the settings-write
      // shape — one typed error per surface (ERROR_MODEL).
      throw new InvalidRegistrationInputError(
        error instanceof Error ? error.message : "invalid tax registration input",
      );
    }

    if ((await findUserByEmail(email)) !== undefined) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await this.passwords.hashFromNewPassword(input.ownerPassword);
    const now = this.clock.now();
    const periodStart = now.toISOString().slice(0, 10);
    const trialExpiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const periodEnd = trialExpiresAt.toISOString().slice(0, 10);
    const displayName = input.businessNameAr ?? input.businessName;

    const result = await withPlatformScope(async (tx) => {
      // Plan read inside the platform scope (RLS: plans are tenant-GUC or
      // platform-GUC visible — never pool-visible bare).
      const plan = await store.findPlanByKey("business");
      if (plan === undefined) {
        throw new Error("business plan seed missing — run migration 0008");
      }
      const tenant = await store.insertTenant({
        name: input.businessName.trim(),
        nameAr: input.businessNameAr,
        baseCurrency: country.currencyCode,
        countryCode: country.code,
        timezone: country.timeZone,
        industryTemplateKey: template.key,
      });
      // Platform-scope trail row (tenant_id NULL, §2.9).
      await this.audit.recordPlatform({
        action: "tenant.created",
        entityType: "tenant",
        entityId: tenant.id,
        after: {
          name: tenant.name,
          country: tenant.countryCode,
          industry_template: tenant.industryTemplateKey,
          via: "public-registration",
        },
      });
      await this.audit.recordPlatform({
        action: "plan.assigned",
        entityType: "tenant",
        entityId: tenant.id,
        after: { plan: plan.key, source: "TRIAL", trial_days: TRIAL_DAYS },
      });

      // Owner identity on the SAME transaction (atomicity, acceptance 1).
      const user = await insertUser(
        {
          email,
          fullName: input.ownerFullName.trim(),
          passwordHash,
          locale: country.defaultLocale,
          status: "ACTIVE",
        },
        tx,
      );

      const tenantScope = await withTenantOnTx(tenant.id, tx, async () => {
        // Owner membership through the system template instantiation
        // (SEEDS/README: the copy becomes tenant-owned, editable, auditable).
        const ownerRole =
          (await findTenantRoleByKey(tenant.id, "owner")) ??
          (await cloneSystemTemplate("owner", tenant.id));
        const membership = await insertMembership({
          tenantId: tenant.id,
          userId: user.id,
          roleId: ownerRole.id,
          createdBy: user.id,
        });
        await this.audit.record({
          action: "membership.created",
          entityType: "membership",
          entityId: membership.id,
          actorId: user.id,
          after: { role: "owner", via: "public-registration" },
        });
        await this.audit.record({
          action: "tenant.created",
          entityType: "tenant",
          entityId: tenant.id,
          actorId: user.id,
          viaPlatformAdmin: true,
          after: { name: tenant.name, country: tenant.countryCode },
        });

        // Trial subscription (PHASE-014 model: status TRIAL + trial_ends_at
        // + the billing event) + materialized entitlements (TRIAL source).
        await billingStore.insertSubscriptionRow({
          planId: plan.id,
          status: "TRIAL",
          periodStart,
          periodEnd,
          trialEndsAt: trialExpiresAt.toISOString(),
        });
        await billingStore.recordBillingEvent({
          type: "trial.started",
          payload: {
            plan: plan.key,
            trialDays: TRIAL_DAYS,
            trialEndsAt: trialExpiresAt.toISOString(),
          },
        });
        for (const featureKey of plan.featureKeys) {
          await store.insertEntitlement({
            featureKey,
            source: "TRIAL",
            expiresAt: trialExpiresAt.toISOString(),
          });
        }
        await this.audit.record({
          action: "plan.assigned",
          entityType: "tenant",
          entityId: tenant.id,
          actorId: user.id,
          viaPlatformAdmin: true,
          after: { plan: plan.key, source: "TRIAL", trial_days: TRIAL_DAYS },
        });
        await this.audit.record({
          action: "entitlements.materialized",
          entityType: "tenant",
          entityId: tenant.id,
          actorId: user.id,
          after: { plan: plan.key, keys: plan.featureKeys.length, source: "TRIAL" },
        });

        // Registration-scoped settings defaults (§2.2: tax registration
        // captured provisionally per TAX_ENGINE §1; general display defaults
        // derived from the country record).
        const defaults: Record<string, unknown> = {
          "general.default_locale": country.defaultLocale,
          "general.numeral_system": "latn",
          "general.hijri_display": true,
          "platform.support.opt_in": false,
          "tax.registration.status": taxStatus,
        };
        if (taxNumber !== null) {
          defaults["tax.registration.number"] = taxNumber;
        }
        const written: string[] = [];
        for (const [key, value] of Object.entries(defaults)) {
          const { created } = await store.upsertSettingDefault(key, value, user.id);
          if (created) {
            written.push(key);
          }
        }
        await this.audit.record({
          action: "settings.initialized",
          entityType: "tenant",
          entityId: tenant.id,
          actorId: user.id,
          after: { keys: written },
        });
        return { tenantId: tenant.id, userId: user.id };
      });

      return tenantScope;
    });

    // Welcome email (registration template — PHASE-004 §2.8 in-scope set).
    await this.email
      .enqueue(result.tenantId, {
        template: "registration_welcome",
        locale: country.defaultLocale === "en" ? "en" : "ar",
        recipient: email,
        variables: {
          tenantName: displayName,
          ownerName: input.ownerFullName,
          loginUrl: `${env.WEB_BASE_URL}/login`,
        },
      })
      .catch((error: unknown) => {
        log.warn({ err: error }, "registration welcome email enqueue failed");
      });

    log.info(
      { tenant_id: result.tenantId, country: country.code },
      "tenant registered via public flow",
    );
    return {
      tenantId: result.tenantId,
      ownerUserId: result.userId,
      trialExpiresAt: trialExpiresAt.toISOString(),
    };
  }
}
