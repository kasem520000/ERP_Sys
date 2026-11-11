import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import { AuditService } from "../../audit/api/audit";
import { withPlatformScope, withTenantOnTx } from "../../../infra/db/tenant-context";
import { PasswordService, findUserByEmail, insertMembership, insertUser, findTenantRoleByKey, cloneSystemTemplate } from "../../identity/api/identity";
import * as store from "../../tenancy/infrastructure/tenancy.store";
import * as billingStore from "../../tenancy/infrastructure/billing.store";
import { DemoDataService } from "./demo-data-service";
import { SandboxProvisioningError } from "../domain/onboarding-errors";

/**
 * PHASE-040 sandbox provisioning (§2.6, OA-05): the platform-plane one-call
 * sales demo — a time-boxed, quota-capped, SANDBOX-flagged tenant carrying
 * the chosen industry template and fully seeded demo data (the T-06 loader),
 * with a one-time owner credential returned to the platform operator.
 *
 * Never plan-gated (the platform.payouts precedent — the route rides
 * `platform.subscriptions.manage`); never a consolidation member (the
 * typed refusal in the group service); invisible to cross-tenant probes
 * (RLS — the A-suite battery); the whole provisioning runs in ONE
 * platform-scope UoW (all-or-nothing).
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const DEFAULT_MAX_USERS = 3;

@Injectable()
export class SandboxService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(DemoDataService) private readonly demo: DemoDataService,
  ) {}

  async provision(
    actorId: string,
    input: {
      name: string;
      templateKey: string;
      ownerEmail: string;
      days?: number;
      maxUsers?: number;
      countryCode?: string;
    },
  ): Promise<unknown> {
    const days = Math.min(Math.max(input.days ?? DEFAULT_DAYS, 1), MAX_DAYS);
    const maxUsers = Math.min(Math.max(input.maxUsers ?? DEFAULT_MAX_USERS, 1), 10);
    const country = await store.findCountry(input.countryCode ?? "SA");
    if (country === undefined || !country.isActive) {
      throw new SandboxProvisioningError(`unsupported country ${input.countryCode ?? "SA"}`);
    }
    const templates = await store.listIndustryTemplates();
    const template = templates.find((row) => row.key === input.templateKey);
    if (template === undefined) {
      throw new SandboxProvisioningError(`unknown industry template ${input.templateKey}`);
    }
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      throw new SandboxProvisioningError("owner email shape is invalid");
    }
    const existingUser = await findUserByEmail(ownerEmail);
    if (existingUser !== undefined) {
      throw new SandboxProvisioningError(
        "this email already exists — sandboxes boot a FRESH owner (use a demo alias)",
      );
    }

    // The one-time credential: generated here, hashed for storage, returned
    // ONCE to the platform operator (never stored in plain, never emailed).
    const oneTimePassword = `Sbx-${randomBytes(9).toString("base64url")}!`;
    const passwordHash = await this.passwords.hashFromNewPassword(oneTimePassword);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = await withPlatformScope(async (tx) => {
      // The showcase plan: a sales demo must light up every capability the
      // chosen template touches (retail needs POS + stock transfers + the
      // template engine; manufacturing its own set) — the enterprise
      // feature set covers all 13 templates. TRIAL-sourced, never billed.
      const plan = await store.findPlanByKey("enterprise");
      if (plan === undefined) {
        throw new SandboxProvisioningError("enterprise plan seed missing — run migration 0008");
      }
      const tenant = await store.insertSandboxTenant({
        name: input.name.trim(),
        nameAr: null,
        baseCurrency: country.currencyCode,
        countryCode: country.code,
        timezone: country.timeZone,
        industryTemplateKey: template.key,
        sandboxExpiresAt: expiresAt,
        sandboxMaxUsers: maxUsers,
        sandboxOwnerEmail: ownerEmail,
      });
      await this.audit.recordPlatform({
        action: "tenant.created",
        entityType: "tenant",
        entityId: tenant.id,
        actorId,
        after: {
          name: tenant.name,
          country: tenant.countryCode,
          industry_template: tenant.industryTemplateKey,
          via: "sandbox-provisioning",
          kind: "SANDBOX",
          expires_at: expiresAt,
          max_users: maxUsers,
        },
      });
      // The owner identity on the SAME transaction (the registration shape).
      const user = await insertUser(
        {
          email: ownerEmail,
          fullName: `Demo Owner — ${input.name.trim()}`,
          passwordHash,
          locale: country.defaultLocale,
          status: "ACTIVE",
        },
        tx,
      );
      const tenantScope = await withTenantOnTx(tenant.id, tx, async () => {
        const ownerRole =
          (await findTenantRoleByKey(tenant.id, "owner")) ??
          (await cloneSystemTemplate("owner", tenant.id));
        const membership = await insertMembership({
          tenantId: tenant.id,
          userId: user.id,
          roleId: ownerRole.id,
          createdBy: user.id,
        });
        void membership;
        // Trial-shaped subscription on the starter plan + materialized
        // entitlements (TRIAL source) — the sandbox is never billed.
        await billingStore.insertSubscriptionRow({
          planId: plan.id,
          status: "TRIAL",
          periodStart,
          periodEnd,
          trialEndsAt: expiresAt,
        });
        await billingStore.recordBillingEvent({
          type: "trial.started",
          payload: {
            plan: plan.key,
            trialDays: days,
            trialEndsAt: expiresAt,
            via: "sandbox-provisioning",
          },
        });
        for (const featureKey of plan.featureKeys) {
          await store.insertEntitlement({
            featureKey,
            source: "TRIAL",
            expiresAt,
          });
        }
        // platform.demo_data rides every plan (0060 §8) — the sandbox IS
        // the demo surface; materialize it explicitly with the trial clock.
        await store.insertEntitlement({
          featureKey: "platform.demo_data",
          source: "TRIAL",
          expiresAt,
        });
        // Registration-scoped settings defaults (the registration shape).
        await store.upsertSettingDefault("general.default_locale", country.defaultLocale, user.id);
        await store.upsertSettingDefault("general.numeral_system", "latn", user.id);
        await store.upsertSettingDefault("general.hijri_display", true, user.id);
        await store.upsertSettingDefault("platform.support.opt_in", false, user.id);
        await store.upsertSettingDefault("tax.registration.status", "NOT_REGISTERED", user.id);
        // The one-click demo seed — the FULL T-06 pipeline (template apply +
        // realistic data through the posting engine) inside this same UoW.
        const summary = await this.demo.seed(user.id, template.key);
        return { tenantId: tenant.id, userId: user.id, summary };
      });
      return tenantScope;
    });

    const seedHash = createHash("sha256")
      .update(`${input.templateKey}:${result.tenantId}`)
      .digest("hex");
    await this.audit
      .recordPlatform({
        action: "onboarding.sandbox_provisioned",
        entityType: "tenant",
        entityId: result.tenantId,
        actorId,
        after: {
          template: input.templateKey,
          days,
          maxUsers,
          seed: result.summary,
        },
      })
      .catch(() => undefined);

    return {
      tenantId: result.tenantId,
      ownerUserId: result.userId,
      ownerEmail,
      oneTimePassword,
      expiresAt,
      maxUsers,
      templateKey: input.templateKey,
      seed: result.summary,
      seedHash,
    };
  }

  /** The platform-console listing: sandbox tenants + their state. */
  async list(): Promise<unknown> {
    return withPlatformScope(async () => {
      const tenants = await store.platformListTenants({ limit: 500 });
      return tenants
        .filter((row) => row.kind === "SANDBOX")
        .map((row) => ({
          tenantId: row.id,
          name: row.name,
          status: row.status,
          expiresAt: row.sandboxExpiresAt,
          expired: row.sandboxExpiresAt !== null && Date.parse(row.sandboxExpiresAt) < Date.now(),
        }));
    });
  }
}
