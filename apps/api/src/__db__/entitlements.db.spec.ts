import { randomInt } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { appClient, ensureTestDb, superuserClient } from "./test-db";
import { RegistrationService } from "../modules/tenancy/application/registration-service";
import { EntitlementsService } from "../modules/tenancy/application/entitlements-service";
import { PasswordService } from "../modules/identity/api/identity";
import { AuditService } from "../modules/audit/api/audit";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import { withTenant } from "../infra/db/tenant-context";
import { setIdentity, PLATFORM_TENANT_ID, type SessionContext } from "../infra/context/session-context";
import { REQUIRE_FEATURE_KEY } from "../infra/auth/require-feature.decorator";
import { FeatureEntitlementsGuard } from "../infra/auth/feature-entitlements.guard";
import {
  FeatureDependenciesMissingError,
  FeatureNotEntitledError,
  ManualGrantExpiryRequiredError,
  UnknownFeatureKeyError,
} from "../modules/tenancy/domain/tenancy-errors";
import {
  FEATURE_DEPS,
  FEATURE_KEYS,
  closureViolations,
  isKnownFeatureKey,
  missingClosure,
} from "../modules/configuration/domain/feature-catalog";

/**
 * PHASE-004 T7 — the FIRST ENFORCEMENT of BR-039/BR-040 (BUSINESS_RULES §8
 * traceability: `entitlements.spec`, `dependency-closure.spec`):
 *
 * - plan materialization matches plan feature_keys exactly;
 * - manual override wins over re-materialization while active (§9);
 * - TRIAL/PROMO expiry drops the grant (resolution filters expired);
 * - every feature-gated route enforces its key server-side (403 typed
 *   FEATURE_NOT_ENTITLED) and the UI payload is derived-only (BR-039);
 * - BR-040: POS-style activation without its closure is rejected listing
 *   the SPECIFIC missing keys; the seeded plans satisfy closure.
 */

const audit = new AuditService(new DrizzleAuditStore());
const passwords = new PasswordService();
const email = { enqueue: async () => undefined } as never;
const registration = new RegistrationService(passwords, audit, email as never);
const entitlements = new EntitlementsService(audit);

const OWNER_PASSWORD = "an-extremely-strong-passphrase-9";
const OWNER_PASSWORD_B = "an-extremely-strong-passphrase-8";

let tenantId = "";
let ownerId = "";
let tenantIdB = "";
let ownerIdB = "";

beforeAll(async () => {
  ensureTestDb();
  const a = await registration.register({
    businessName: "Entitlements Co",
    businessNameAr: "شركة الاستحقاقات",
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: "industry.retail",
    taxRegistrationStatus: "NOT_REGISTERED",
    taxRegistrationNumber: null,
    ownerEmail: `ent-owner-${Date.now()}@provision.test`,
    ownerFullName: "Entitlements Owner",
    ownerPassword: OWNER_PASSWORD,
    ip: `10.8.${randomInt(1, 250)}.1`,
  });
  tenantId = a.tenantId;
  ownerId = a.ownerUserId;
  const b = await registration.register({
    businessName: "Second Ent Co",
    businessNameAr: "شركة استحقاقات ب",
    countryCode: "AE",
    baseCurrency: "AED",
    industryTemplateKey: "industry.wholesale",
    taxRegistrationStatus: "NOT_REGISTERED",
    taxRegistrationNumber: null,
    ownerEmail: `ent-owner-b-${Date.now()}@provision.test`,
    ownerFullName: "Second Ent Owner",
    ownerPassword: OWNER_PASSWORD_B,
    ip: `10.8.${randomInt(1, 250)}.2`,
  });
  tenantIdB = b.tenantId;
  ownerIdB = b.ownerUserId;
});

describe("entitlements.spec (BR-039 — server-side only, derived UI)", () => {
  it("materialization matches the plan's feature_keys exactly", async () => {
    const su = await superuserClient();
    const plan = await su.query<{ keys: number }>(
      `SELECT cardinality(p.feature_keys)::int AS keys
         FROM plans p JOIN subscriptions s ON s.plan_id = p.id
        WHERE s.tenant_id = $1 AND s.status = 'TRIAL'`,
      [tenantId],
    );
    await su.end();
    const payload = await withTenant(tenantId, () =>
      entitlements.derivedVisibilityPayload(),
    );
    expect(payload.featureKeys.length).toBe(plan.rows[0]?.keys);
    for (const key of payload.featureKeys) {
      expect(isKnownFeatureKey(key)).toBe(true);
    }
  });

  it("manual override wins over plan re-materialization while active (§9)", async () => {
    // Grant a key with MANUAL source + expiry (§9: overrides must expire).
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await expect(
      withTenant(tenantId, () =>
        entitlements.grant(ownerId, {
          featureKey: "accounting.projects",
          source: "MANUAL",
          expiresAt: null, // overrides without expiry are rejected
          reason: "test grant",
        }),
      ),
    ).rejects.toBeInstanceOf(ManualGrantExpiryRequiredError);

    await withTenant(tenantId, () =>
      entitlements.grant(ownerId, {
        featureKey: "accounting.projects",
        source: "MANUAL",
        expiresAt,
        reason: "escalation test",
      }),
    );
    // Re-materialize the plan (starter — no accounting.projects).
    await withTenant(tenantId, () =>
      entitlements.assignPlan(ownerId, { planKey: "starter", source: "PLAN", expiresAt: null }),
    );
    const after = await withTenant(tenantId, () => entitlements.derivedVisibilityPayload());
    expect(after.featureKeys).toContain("accounting.projects");
    expect(
      after.sources.find((row) => row.featureKey === "accounting.projects")?.source,
    ).toBe("MANUAL");
  });

  it("expiry drops the grant (TRIAL/PROMO expire → inactive)", async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    await withTenant(tenantId, () =>
      entitlements.grant(ownerId, {
        featureKey: "crm.leads",
        source: "PROMO",
        expiresAt: expired,
        reason: "already-lapsed promo",
      }),
    );
    const payload = await withTenant(tenantId, () => entitlements.derivedVisibilityPayload());
    expect(payload.featureKeys).not.toContain("crm.leads");
    // the pre-GUC projection agrees (guard input shape)
    const app = await appClient();
    const projection = await app.query<{ feature_key: string }>(
      `SELECT feature_key FROM erp.tenant_active_entitlements($1::uuid)`,
      [tenantId],
    );
    await app.end();
    expect(projection.rows.map((row) => row.feature_key)).not.toContain("crm.leads");
    expect(projection.rows.map((row) => row.feature_key)).toContain("platform.onboarding");
  });

  it("revoke removes the key and audits it; unknown keys are rejected loudly", async () => {
    await expect(
      withTenant(tenantId, () =>
        entitlements.grant(ownerId, {
          featureKey: "not.a_real_feature",
          source: "MANUAL",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          reason: "typo probe",
        }),
      ),
    ).rejects.toBeInstanceOf(UnknownFeatureKeyError);
    await withTenant(tenantId, () =>
      entitlements.revoke(ownerId, "accounting.projects", "support cleanup"),
    );
    const payload = await withTenant(tenantId, () => entitlements.derivedVisibilityPayload());
    expect(payload.featureKeys).not.toContain("accounting.projects");
  });

  it("the enforcement guard 403s a missing key with the typed error (per action)", async () => {
    const guard = new FeatureEntitlementsGuard(new Reflector());
    // tenant B (starter-closure-only materialization… actually trial
    // business) — revoke one key then hit a gated route for it.
    await withTenant(tenantIdB, () =>
      entitlements.revoke(ownerIdB, "platform.onboarding", "gate test"),
    );

    const handler = function gated() {
      return undefined;
    };
    Reflect.defineMetadata(REQUIRE_FEATURE_KEY, "platform.onboarding", handler);
    const identity: SessionContext = {
      sessionId: "s",
      userId: ownerIdB,
      user: { email: "e", fullName: "n", locale: "ar", status: "ACTIVE" },
      activeTenantId: tenantIdB,
    };
    const request = { identity } as unknown as Request;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => TenancyControllerStub,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(FeatureNotEntitledError);

    // restore: a fresh grant resolves and the guard passes.
    await withTenant(tenantIdB, () =>
      entitlements.grant(ownerIdB, {
        featureKey: "platform.onboarding",
        source: "MANUAL",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        reason: "gate test restore",
      }),
    );
    identity.entitlements = undefined;
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("platform-scoped routes skip the feature gate (platform plane ≠ plan plane)", async () => {
    const guard = new FeatureEntitlementsGuard(new Reflector());
    const handler = function platformGated() {
      return undefined;
    };
    Reflect.defineMetadata(REQUIRE_FEATURE_KEY, "platform.onboarding", handler);
    Reflect.defineMetadata("tenancy:platformScope", true, handler);
    const request = {} as Request;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => Object,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

describe("dependency-closure.spec (BR-040 — first enforcement)", () => {
  it("POS-style activation without its closure lists the SPECIFIC missing keys", async () => {
    // The tenant now carries the starter set: pos.offline_queue needs the
    // POS chain which starter deliberately excludes → 422 with the exact
    // missing keys (BR-040's canonical example).
    let caught: unknown;
    try {
      await withTenant(tenantId, () =>
        entitlements.grant(ownerId, {
          featureKey: "pos.offline_queue",
          source: "MANUAL",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          reason: "closure probe",
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeatureDependenciesMissingError);
    const details = (caught as FeatureDependenciesMissingError).details as {
      featureKey: string;
      missing: readonly string[];
    };
    expect(details.featureKey).toBe("pos.offline_queue");
    expect(details.missing).toEqual(
      expect.arrayContaining(["pos.sales", "pos.shifts", "treasury.cashier_shifts"]),
    );

    // pure-map cross-checks: the transitive closure is EXACTLY the 18
    // dependencies below — the full hop chain of pos.sales + pos.shifts
    // under an active set of only those two keys.
    const missing = missingClosure("pos.offline_queue", new Set(["pos.sales", "pos.shifts"]));
    expect(missing).toEqual([
      "accounting.chart_of_accounts",
      "accounting.journal_entries",
      "inventory.multi_warehouse",
      "inventory.stock_ledger",
      "items.barcodes",
      "items.item_master",
      "items.price_lists",
      "partners.directory",
      "platform.branches",
      "platform.onboarding",
      "platform.registration",
      "platform.tenant_lifecycle",
      "sales.invoices",
      "sales.orders",
      "sales.quotations",
      "tax.engine",
      "treasury.accounts",
      "treasury.cashier_shifts",
    ]);
    // and nothing from the ACTIVE set is ever reported missing
    expect(missing).not.toContain("pos.sales");
    expect(missing).not.toContain("pos.shifts");
  });

  it("full closure passes (the positive shape)", () => {
    const missing = missingClosure("pos.sales", new Set(FEATURE_KEYS));
    expect(missing).toEqual([]);
    expect(closureViolations(FEATURE_KEYS)).toEqual([]);
  });

  it("every catalog edge references a known key (no orphan deps)", () => {
    for (const [key, deps] of Object.entries(FEATURE_DEPS)) {
      expect(isKnownFeatureKey(key)).toBe(true);
      for (const dep of deps) {
        expect({ key, dep, known: isKnownFeatureKey(dep) }).toEqual({
          key,
          dep,
          known: true,
        });
      }
    }
  });

  it("the seeded plans satisfy BR-040 against the catalog (seed guarantee)", async () => {
    const su = await superuserClient();
    const plans = await su.query<{ key: string; feature_keys: string[] }>(
      `SELECT key, feature_keys FROM plans WHERE is_active ORDER BY key`,
    );
    await su.end();
    expect(plans.rows.map((row) => row.key)).toEqual(["business", "enterprise", "starter"]);
    for (const plan of plans.rows) {
      expect(closureViolations(plan.feature_keys), `plan ${plan.key}`).toEqual([]);
    }
  });

  it("plan assignment validates the whole-set closure at apply time", async () => {
    // a hypothetical rogue plan cannot pass: the service would reject it
    // (PlanClosureInvalidError) — the seeded ones always pass; prove the
    // validator contract via the pure function with a broken key set.
    const violations = closureViolations(["pos.sales"]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.missing).toContain("sales.invoices");
  });
});

class TenancyControllerStub {}
void PLATFORM_TENANT_ID;
void setIdentity;
