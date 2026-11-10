import { beforeAll, describe, expect, it } from "vitest";

import {
  F_ACTOR,
  F_FOREIGN_ACTOR,
  FOREIGN_FIXTURE_IDS,
  TENANT_F,
  assets,
  categories,
  depreciation,
  disposals,
  revaluations,
  setupFixedAssetsFixture,
  su,
  withTenant,
  type FixedAssetsFixture,
} from "./fixtures";

/**
 * PHASE-026 spoof suite (SECURITY_TEST_PLAN §2, the PHASE-026 row): foreign
 * category / branch / custodian / asset / fiscal-period references in fixed-
 * assets payloads are rejected with typed 404-shaped errors and ZERO partial
 * creation (S-04) — the register row, its run, disposal, or revaluation all
 * roll back together, and every lookup is tenant-scoped so a foreign id is
 * indistinguishable from an unknown one (A7).
 *
 * The foreign ids come from the dedicated spoof-target tenant seeded by the
 * fixed-assets fixture (ids that exist in the database but belong to another
 * tenant — the treasury spoof precedent, self-seeded so this spec stays
 * order-independent within the serial db suite).
 */

const UNKNOWN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let fixture: FixedAssetsFixture;

beforeAll(async () => {
  fixture = await setupFixedAssetsFixture();
});

/** Count rows the attack must NOT have created (superuser, tenant-scoped). */
async function countRows(sql: string, params: unknown[]): Promise<number> {
  const client = await su();
  const result = await client.query<{ n: number }>(sql, params);
  await client.end();
  return result.rows[0]?.n ?? 0;
}

describe("S-04 — foreign references in fixed-assets payloads → typed rejection, zero partial creation", () => {
  it("an asset created against a foreign category id is rejected; no asset row survives", async () => {
    await expect(
      withTenant(TENANT_F, () =>
        assets.create({
          code: "F-SPOOF-CAT",
          name: "Spoof category probe",
          nameAr: "محاولة فئة أجنبية",
          categoryId: FOREIGN_FIXTURE_IDS.category,
          branchId: fixture.branchId,
          acquisitionDate: "2026-02-01",
          cost: "1000.0000",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ASSET_CATEGORY_NOT_FOUND" });
    // Zero partial creation: nothing in tenant F references the foreign
    // category (service lookup AND register scan).
    expect(
      await withTenant(TENANT_F, () =>
        assets.list({ categoryId: FOREIGN_FIXTURE_IDS.category, limit: 500 }),
      ),
    ).toHaveLength(0);
  });

  it("an asset created against a foreign branch id is rejected; zero partial creation", async () => {
    await expect(
      withTenant(TENANT_F, () =>
        assets.create({
          code: "F-SPOOF-BRANCH",
          name: "Spoof branch probe",
          nameAr: "محاولة فرع أجنبي",
          categoryId: fixture.vehicleCategoryId,
          branchId: FOREIGN_FIXTURE_IDS.branch,
          acquisitionDate: "2026-02-01",
          cost: "1000.0000",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BRANCH_NOT_FOUND" });
    expect(
      await withTenant(TENANT_F, () =>
        assets.list({ branchId: FOREIGN_FIXTURE_IDS.branch, limit: 500 }),
      ),
    ).toHaveLength(0);
  });

  it("a foreign-tenant user id as custodian is rejected (membership-scoped A7); no asset row survives", async () => {
    // The user EXISTS globally but holds no membership in tenant F — the
    // custodian lookup must render it exactly like an unknown id.
    await expect(
      withTenant(TENANT_F, () =>
        assets.create({
          code: "F-SPOOF-CUSTODIAN",
          name: "Spoof custodian probe",
          nameAr: "محاولة عهدة أجنبية",
          categoryId: fixture.vehicleCategoryId,
          branchId: fixture.branchId,
          acquisitionDate: "2026-02-01",
          cost: "1000.0000",
          custodianUserId: F_FOREIGN_ACTOR,
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(
      await withTenant(TENANT_F, () =>
        assets.list({ custodianUserId: F_FOREIGN_ACTOR, limit: 500 }),
      ),
    ).toHaveLength(0);
  });

  it("a disposal drafted against a foreign asset id is rejected; the disposal table stays clean", async () => {
    await expect(
      withTenant(TENANT_F, () =>
        disposals.createDraft({
          assetId: FOREIGN_FIXTURE_IDS.asset,
          kind: "SALE",
          disposalDate: "2026-05-15",
          proceeds: "500.0000",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM asset_disposals WHERE tenant_id = $1 AND asset_id = $2`,
        [TENANT_F, FOREIGN_FIXTURE_IDS.asset],
      ),
    ).toBe(0);
  });

  it("a revaluation drafted against a foreign asset id is rejected; zero partial creation", async () => {
    await expect(
      withTenant(TENANT_F, () =>
        revaluations.createDraft({
          assetId: FOREIGN_FIXTURE_IDS.asset,
          revaluationDate: "2026-05-20",
          newGrossValue: "13000.0000",
          newAccumulated: "0.0000",
          reason: "spoof revaluation",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM asset_revaluations WHERE tenant_id = $1 AND asset_id = $2`,
        [TENANT_F, FOREIGN_FIXTURE_IDS.asset],
      ),
    ).toBe(0);
  });

  it("a depreciation run assembled against a foreign fiscal period id is rejected; no run is created", async () => {
    await expect(
      withTenant(TENANT_F, () =>
        depreciation.assembleRun({
          fiscalPeriodId: FOREIGN_FIXTURE_IDS.fiscalPeriod,
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_NOT_FOUND" });
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM depreciation_runs WHERE tenant_id = $1 AND fiscal_period_id = $2`,
        [TENANT_F, FOREIGN_FIXTURE_IDS.fiscalPeriod],
      ),
    ).toBe(0);
  });

  it("A7 route id-probe parity: unknown-vs-foreign ids render identically (typed 404s)", async () => {
    const unknownAsset = await withTenant(TENANT_F, () =>
      assets.find(UNKNOWN_ID).catch((error: { code?: string }) => error.code),
    );
    const foreignAsset = await withTenant(TENANT_F, () =>
      assets.find(FOREIGN_FIXTURE_IDS.asset).catch((error: { code?: string }) => error.code),
    );
    expect(unknownAsset).toBe("ASSET_NOT_FOUND");
    expect(foreignAsset).toBe("ASSET_NOT_FOUND");

    const unknownCategory = await withTenant(TENANT_F, () =>
      categories.find(UNKNOWN_ID).catch((error: { code?: string }) => error.code),
    );
    const foreignCategory = await withTenant(TENANT_F, () =>
      categories.find(FOREIGN_FIXTURE_IDS.category).catch((error: { code?: string }) => error.code),
    );
    expect(unknownCategory).toBe("ASSET_CATEGORY_NOT_FOUND");
    expect(foreignCategory).toBe("ASSET_CATEGORY_NOT_FOUND");
  });
});
