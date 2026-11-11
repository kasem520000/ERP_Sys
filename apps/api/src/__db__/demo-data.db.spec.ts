/**
 * PHASE-040 T-11 — the demo-data evidence suite (§6 acceptance 7) on real
 * PostgreSQL 16: the one-click loader seeds EVERY one of the 13 shipped
 * industry templates — partners, items, price list, opening stock, 6
 * posted sales invoices (create→submit→approve→post, SoD through the
 * synthetic demo approver pair), 3 receipts — every journal through
 * PostingService, so the GL lights up with real data (reports/dashboards
 * non-empty), and a re-run is a zero-write no-op (idempotence).
 *
 * Each template gets its OWN registered tenant (the loader is one-seed-
 * per-tenant by design); the enterprise feature set is materialized per
 * tenant (the sandbox precedent — the showcase plan covers every
 * template's capability prerequisites, e.g. food manufacturing's
 * manufacturing.* keys that the business plan does not carry).
 */
import { randomInt } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { AppModule } from "../app.module";
import { withTenant, withPlatformScope } from "../infra/db/tenant-context";
import { closeDb } from "../infra/db/client";
import { stopBoss } from "../infra/jobs/boss";
import { RegistrationService, __resetRegistrationLimitersForTests } from "../modules/tenancy/application/registration-service";
import { DemoDataService } from "../modules/onboarding/application/demo-data-service";
import { DemoSeedRefusedError } from "../modules/onboarding/domain/onboarding-errors";
import * as tenancyStore from "../modules/tenancy/infrastructure/tenancy.store";

const OWNER_PASSWORD = "demo-owner-passphrase-4";

interface SeedSummary {
  templateKey: string;
  created: {
    partners: number;
    items: number;
    invoices: number;
    receipts: number;
    priceLists: number;
    warehouses: number;
    cashAccounts: number;
  };
  skipped: { reason: string } | null;
}

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let demo: DemoDataService;
let registration: RegistrationService;

async function suCount(sql: string, params: unknown[] = []): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) q`, params);
  await su.end();
  return result.rows[0]?.n ?? 0;
}

/** Register a fresh tenant carrying the FULL enterprise feature set. */
async function registerShowcaseTenant(): Promise<{ tenantId: string; ownerId: string }> {
  const registered = await registration.register({
    businessName: `Demo Co ${Date.now()}`,
    businessNameAr: "شركة تجريبية",
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: "industry.professional_services",
    taxRegistrationStatus: "NOT_REGISTERED",
    taxRegistrationNumber: null,
    ownerEmail: `demo-${Date.now()}-${randomInt(1, 1e9)}@provision.test`,
    ownerFullName: "Demo Owner",
    ownerPassword: OWNER_PASSWORD,
    ip: `10.50.${randomInt(1, 250)}.${randomInt(1, 250)}`,
  });
  await withTenant(registered.tenantId, async () => {
    const plan = await tenancyStore.findPlanByKey("enterprise");
    expect(plan).toBeDefined();
    for (const featureKey of plan!.featureKeys) {
      await tenancyStore.insertEntitlement({ featureKey, source: "PLAN", expiresAt: null });
    }
  });
  return { tenantId: registered.tenantId, ownerId: registered.ownerUserId };
}

beforeAll(async () => {
  ensureTestDb();
  __resetRegistrationLimitersForTests();
  reloadEnv();
  const created = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  app = created;
  await created.init();
  demo = created.get(DemoDataService);
  registration = created.get(RegistrationService);
}, 240_000);

afterAll(async () => {
  __resetRegistrationLimitersForTests();
  if (app !== undefined) {
    await app.close();
  }
  await stopBoss();
  await closeDb();
});

describe("acceptance 7 — the 13-template one-click coverage", () => {
  // The 13 shipped industry templates (the migration-0008 registry set).
  const templates = [
    "industry.professional_services",
    "industry.retail",
    "industry.restaurant",
    "industry.grocery",
    "industry.wholesale",
    "industry.electronics",
    "industry.rental_logistics",
    "industry.healthcare",
    "industry.education",
    "industry.agriculture",
    "industry.automotive",
    "industry.distribution",
    "industry.food_manufacturing",
  ] as const;

  it("the registry exposes exactly these 13 keys (drift guard)", async () => {
    const rows = await withPlatformScope(() => tenancyStore.listIndustryTemplates());
    expect(new Set(rows.map((row) => row.key))).toEqual(new Set(templates));
  });

  for (const templateKey of templates) {
    it(`${templateKey}: seeds, posts through the engine, re-run is a no-op`, { timeout: 180_000 }, async () => {
      const { tenantId, ownerId } = await registerShowcaseTenant();

      // The one-click seed.
      const summary = (await withTenant(tenantId, () => demo.seed(ownerId, templateKey))) as SeedSummary;
      expect(summary.templateKey).toBe(templateKey);
      expect(summary.skipped).toBeNull();
      expect(summary.created.partners).toBeGreaterThanOrEqual(15);
      expect(summary.created.items).toBeGreaterThanOrEqual(8);
      expect(summary.created.invoices).toBe(6);
      expect(summary.created.receipts).toBe(3);

      // The GL lit up: posted journals + balanced legs (the dashboards'
      // substrate — every entry through the posting engine).
      const journals = await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId]);
      expect(journals).toBeGreaterThanOrEqual(9); // 6 invoices + 3 receipts
      const su = await superuserClient();
      const legs = await su.query<{ direction: string; amount: string }>(
        `SELECT l.direction, l.amount FROM journal_lines l
           JOIN journal_entries e ON e.id = l.journal_entry_id
          WHERE e.tenant_id = $1`,
        [tenantId],
      );
      await su.end();
      expect(legs.rows.length).toBeGreaterThan(0);
      const debit = legs.rows
        .filter((row) => row.direction === "DEBIT")
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const credit = legs.rows
        .filter((row) => row.direction === "CREDIT")
        .reduce((sum, row) => sum + Number(row.amount), 0);
      expect(debit).toBeCloseTo(credit, 4);

      // The tenant markers (the status surface).
      const suMarkers = await superuserClient();
      const markerRows = await suMarkers.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tenants WHERE id = $1 AND demo_template = $2 AND demo_seeded_at IS NOT NULL`,
        [tenantId, templateKey],
      );
      await suMarkers.end();
      expect(markerRows.rows[0]?.n).toBe(1);

      // The re-run: a zero-write no-op.
      const rerun = (await withTenant(tenantId, () => demo.seed(ownerId, templateKey))) as SeedSummary;
      expect(rerun.skipped).toEqual({ reason: "already-seeded" });
      expect(rerun.created.invoices).toBe(0);
      expect(await suCount(`SELECT * FROM journal_entries WHERE tenant_id = $1`, [tenantId])).toBe(journals);

      // A DIFFERENT template on the same tenant: the typed refusal.
      const other = templates.find((key) => key !== templateKey)!;
      await expect(
        withTenant(tenantId, () => demo.seed(ownerId, other)),
      ).rejects.toBeInstanceOf(DemoSeedRefusedError);
    });
  }

  it("a tenant carrying posted real documents (no demo markers) refuses the seed", { timeout: 120_000 }, async () => {
    const { tenantId, ownerId } = await registerShowcaseTenant();
    // Seed once (markers + journals land), then CLEAR the markers via the
    // superuser seam — fixture-only: the tenant now looks like a real
    // tenant with posted documents (the guardrail's exact target shape).
    await withTenant(tenantId, () => demo.seed(ownerId, "industry.retail"));
    const su = await superuserClient();
    await su.query(
      `UPDATE tenants SET demo_seeded_at = NULL, demo_template = NULL WHERE id = $1`,
      [tenantId],
    );
    await su.end();
    await expect(
      withTenant(tenantId, () => demo.seed(ownerId, "industry.retail")),
    ).rejects.toBeInstanceOf(DemoSeedRefusedError);
  });
});
