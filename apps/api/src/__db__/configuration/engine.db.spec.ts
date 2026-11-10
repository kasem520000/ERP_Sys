import { randomInt } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { RETAIL_MANIFEST, hashManifestJson } from "@erp/contracts";

import { ensureTestDb, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { generateUuidV7 } from "@erp/domain-core";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PasswordService } from "../../modules/identity/api/identity";
import { RegistrationService } from "../../modules/tenancy/application/registration-service";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import { cachedTenantStatic } from "../../modules/configuration/application/resolve/cache";

/**
 * PHASE-015 T1 — the resolution engine's repository against a real
 * PostgreSQL 16 (embedded suite; migration 0022 seeds the first three
 * template rows + 0025 the automotive/distribution pair, migration 0013
 * seeds the SA jurisdiction pack, migration 0008/0021 seed the three plans):
 *
 * 1. an apply-less tenant resolves the platform defaults (L1 null — the
 *    registration preference is surfaced, the APPLIED state is not);
 * 2. a tenant_industry_config row resolves L1 from the seeded registry
 *    (manifest parsed, hash-verified, terminology + navigation derived);
 * 3. an invalid tenant_settings row fails CLOSED (typed layer-5 error,
 *    nothing cached);
 * 4. an explicit L5 row beats the L1 template default (BR-038);
 * 5. resolve() overlays L6: branch scope maps to branch codes.
 */

const audit = new AuditService(new DrizzleAuditStore());
const passwords = new PasswordService();
const email = { enqueue: async () => undefined } as never;
const registration = new RegistrationService(passwords, audit, email as never);

const OWNER_PASSWORD = "an-extremely-strong-passphrase-7";

let tenantId = "";
let ownerId = "";
let branchId = "";

beforeAll(async () => {
  ensureTestDb();
  resetConfigurationCache();
  const provisioned = await registration.register({
    businessName: "Config Engine Co",
    businessNameAr: "شركة محرك الإعداد",
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: "industry.retail",
    taxRegistrationStatus: "REGISTERED",
    taxRegistrationNumber: "310000000000003",
    ownerEmail: `cfg-owner-${Date.now()}@provision.test`,
    ownerFullName: "Config Engine Owner",
    ownerPassword: OWNER_PASSWORD,
    ip: `10.31.${randomInt(1, 250)}.1`,
  });
  tenantId = provisioned.tenantId;
  ownerId = provisioned.ownerUserId;

  // A branch for the L6 branch-scope case (registration itself provisions
  // no branches — onboarding does; the spec seeds one directly).
  branchId = generateUuidV7();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO branches (id, tenant_id, code, name, updated_at)
     VALUES ($1, $2, 'BR1', 'Main branch', now())`,
    [branchId, tenantId],
  );
  await su.end();
});

function service(): ResolveEffectiveConfigService {
  return new ResolveEffectiveConfigService(new ConfigRepository());
}

describe("configuration engine over the real database", () => {
  it("an apply-less tenant resolves platform defaults (L1 null, preference surfaced)", async () => {
    resetConfigurationCache();
    const config = await withTenant(tenantId, () => service().resolveTenantStatic(tenantId));
    expect(config.config_version).toBe(3);
    // No tenant_industry_config row ⇒ L1 is NEUTRAL.
    expect(config.layers.l1_template).toBeNull();
    // The registration-time preference still names the industry (§5 tenant
    // block) — the APPLIED state is what L1 tracks, and none exists yet.
    expect(config.tenant.industry_template).toBe("industry.retail");
    // Registration assigns the business plan (TRIAL) + materialized keys.
    expect(config.layers.l3_plan?.key).toBe("business");
    expect(config.layers.l4_entitlements.active).toContain("pos.sales");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    // Default navigation (PHASE-005 core set), no template emphasis.
    expect(config.ui.navigation).toEqual([
      "home", "sales", "purchasing", "inventory",
      "accounting", "treasury", "reports", "settings",
    ]);
    expect(config.ui.emphasis).toEqual([]);
    // The SA jurisdiction seed (migration 0013) + the registration's tax
    // posture flow into L2.
    expect(config.layers.l2_jurisdiction_pack).toMatchObject({
      country_code: "SA",
      pack_version: "1.0.0-baseline",
      vat_status: "VAT_IN_FORCE",
      tenant_registration: "REGISTERED",
    });
  });

  it("a tenant_industry_config row resolves L1 from the seeded registry", async () => {
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_industry_config
         (id, tenant_id, template_key, applied_version, applied_manifest_hash,
          applied_at, applied_by, status, overrides)
       VALUES ($1, $2, 'industry.retail', '1.0.0', $3, now(), $4, 'ACTIVE',
               '{"terminology": {"pos.terminal": {"en": "Register", "ar": "الصندوق"}}}'::jsonb)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [generateUuidV7(), tenantId, hashManifestJson(RETAIL_MANIFEST), ownerId],
    );
    await su.end();
    resetConfigurationCache();

    const config = await withTenant(tenantId, () => service().resolveTenantStatic(tenantId));
    expect(config.layers.l1_template).toEqual({
      key: "industry.retail",
      version: "1.0.0",
      terminology_overrides: 6,
    });
    // L1 defaults land (retail: cash autopost via the policy mapping).
    expect(config.policies["sales.cash_autopost"]).toBe(true);
    expect(config.policies["inventory.fefo_for_expiry_items"]).toBe(false);
    // Navigation derives from the template manifest (business plan: POS
    // entitled; IMEI entitled through inventory.serial_tracking).
    expect(config.ui.navigation).toEqual(["selling", "stock"]);
    // The tenant terminology addition wins over the template label.
    expect(config.ui.terminology["pos.terminal"]).toEqual({
      en: "Register",
      ar: "الصندوق",
    });
    // No registry drift: the applied hash pins the same manifest content
    // the engine resolved.
    const registryRow = await withTenant(tenantId, () =>
      new ConfigRepository().findIndustryTemplate("industry.retail"),
    );
    expect(hashManifestJson(registryRow!.manifest)).toBe(hashManifestJson(RETAIL_MANIFEST));
    // Caching: a second resolve is a cache hit with the same hash.
    const fingerprint = await withTenant(tenantId, () =>
      new ConfigRepository().computeInputFingerprint(),
    );
    expect(cachedTenantStatic(tenantId, fingerprint)?.resolved_hash).toBe(config.resolved_hash);
  });

  it("an invalid tenant_settings row fails closed — typed layer error, nothing cached", async () => {
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES ($1, $2, 'totally.bogus_key', 'true'::jsonb, now())
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [generateUuidV7(), tenantId],
    );
    await su.end();
    resetConfigurationCache();

    await expect(
      withTenant(tenantId, () => service().resolveTenantStatic(tenantId)),
    ).rejects.toMatchObject({
      code: "configuration/resolution-failed",
      layer: "5",
    });
    // Nothing cached — a partial config never escapes (§6 rule 6).
    const fingerprint = await withTenant(tenantId, () =>
      new ConfigRepository().computeInputFingerprint(),
    );
    expect(cachedTenantStatic(tenantId, fingerprint)).toBeUndefined();

    // Cleanup so later specs on this tenant stay deterministic.
    const cleanup = await superuserClient();
    await cleanup.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'totally.bogus_key'`, [
      tenantId,
    ]);
    await cleanup.end();
  });

  it("an explicit L5 row beats the L1 template default (BR-038)", async () => {
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES ($1, $2, 'sales.cash_autopost', 'false'::jsonb, now())
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'false'::jsonb, updated_at = now()`,
      [generateUuidV7(), tenantId],
    );
    await su.end();
    resetConfigurationCache();

    const config = await withTenant(tenantId, () => service().resolveTenantStatic(tenantId));
    expect(config.layers.l1_template?.key).toBe("industry.retail");
    expect(config.policies["sales.cash_autopost"]).toBe(false); // L5 explicit wins.
  });

  it("resolve() overlays L6: permissions + branch scope as codes", async () => {
    const config = await withTenant(tenantId, () =>
      service().resolve(tenantId, {
        userId: ownerId,
        roleKey: "owner",
        permissions: new Set(["sales.invoices.post", "settings.write"]),
        branchScope: [branchId],
      }),
    );
    expect(config.request_overlay).toMatchObject({
      user_id: ownerId,
      role: "owner",
      branch_scope: ["BR1"],
      actions: ["sales.invoices.post", "settings.write"],
    });
    // The tenant-static portion is unchanged by the overlay (same hash as
    // the plain resolve).
    const plain = await withTenant(tenantId, () => service().resolveTenantStatic(tenantId));
    expect(config.resolved_hash).toBe(plain.resolved_hash);
  });
});
