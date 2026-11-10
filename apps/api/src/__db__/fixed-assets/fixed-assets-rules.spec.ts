import { beforeAll, describe, expect, it } from "vitest";

import {
  F_ACTOR,
  F_APPROVER,
  TENANT_F,
  assets,
  categories,
  depreciation,
  disposals,
  periods,
  revaluations,
  runs,
  setupFixedAssetsFixture,
  su,
  withTenant,
  type FixedAssetsFixture,
} from "./fixtures";

/**
 * fixed-assets-rules.spec (BUSINESS_RULES §8 matrix row BR-041…BR-044 —
 * PHASE-026; ACCOUNTING_TESTS §1 conventions): the four fixed-assets
 * business rules exercised against real PostgreSQL through the module
 * services exactly as production code paths run — no direct register or
 * journal inserts; every posting flows through PostingService.post.
 *
 * - BR-041 category usability: a category is unusable until all three
 *   purposes (asset / accumulated-depreciation / expense) resolve to ACTIVE
 *   accounts — asset creation under an unmapped category is blocked with the
 *   typed bilingual CATEGORY_NOT_USABLE error naming the missing keys; an
 *   IN-USE category can never be steered onto an unmapped purpose; mapping
 *   the purpose makes the category usable.
 * - BR-042 depreciation posts only via runs: the G-22 journal carries the
 *   DEPRECIATION_RUN source (never a manual asset journal); posting is
 *   period-locked (LOCKED period → PERIOD_LOCKED, INV-011); one run per
 *   fiscal period (a second assembly after the run POSTS → 409
 *   DEPRECIATION_RUN_PERIOD_TAKEN).
 * - BR-043 the salvage floor + the disposal lock: an asset already at
 *   cost − salvage is excluded from the run and flips FULLY_DEPRECIATED;
 *   posting a disposal locks the asset DISPOSED (INV-023) and a second
 *   disposal is impossible (DISPOSED_ASSET_REUSE).
 * - BR-044 revaluation is audited: the NBV delta posts to
 *   REVALUATION_RESERVE (both legs asserted on the journal lines) with an
 *   audit event; revaluation on a DISPOSED asset is rejected.
 */

let fixture: FixedAssetsFixture;

/** The asset disposed by BR-043 — reused by BR-044's terminal-state probe. */
let disposedAssetId = "";

beforeAll(async () => {
  fixture = await setupFixedAssetsFixture();
});

describe("BR-041 — a category is unusable until all three purposes map to ACTIVE accounts", () => {
  const UNMAPPED_ACCUM_KEY = "FA_ACCUM_UNMAPPED";

  it("asset creation under a category with an unmapped purpose is blocked with the typed bilingual error", async () => {
    const staged = await withTenant(TENANT_F, () =>
      categories.create({
        code: "F-UNMAPPED",
        name: "Unmapped category (F)",
        nameAr: "فئة غير مربوطة (ف)",
        usefulLifeMonthsDefault: 36,
        depreciationMethodDefault: "STRAIGHT_LINE",
        assetPurposeKey: "FIXED_ASSET",
        accumDepreciationPurposeKey: UNMAPPED_ACCUM_KEY,
        expensePurposeKey: "DEPRECIATION_EXPENSE",
        note: null,
        noteAr: null,
        actorId: F_ACTOR,
      }),
    );
    // Staging the category is allowed (tenants may prepare before mapping)…
    expect(staged.active).toBe(true);
    // …but the shared posting gate fails closed, naming the missing key.
    await expect(
      withTenant(TENANT_F, async () => {
        const { assertCategoryUsable } = await import(
          "../../modules/fixed_assets/application/category-service"
        );
        await assertCategoryUsable(staged);
      }),
    ).rejects.toMatchObject({
      code: "CATEGORY_NOT_USABLE",
      details: { code: "F-UNMAPPED", missingPurposeKeys: [UNMAPPED_ACCUM_KEY] },
    });
    // …and the first asset use (registration) is blocked the same way.
    await expect(
      withTenant(TENANT_F, () =>
        assets.create({
          code: "F-BR041-BLOCKED",
          name: "BR-041 blocked probe",
          nameAr: "محاولة محظورة",
          categoryId: staged.id,
          branchId: fixture.branchId,
          acquisitionDate: "2026-02-01",
          cost: "1000.0000",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_USABLE" });
    expect(
      await withTenant(TENANT_F, () => assets.list({ categoryId: staged.id, limit: 500 })),
    ).toHaveLength(0);
  });

  it("an IN-USE category can never be steered onto an unmapped purpose (posting safety)", async () => {
    // A live asset under the good category (acquired far-future so it never
    // joins the 2026 runs — deterministic assembly math below).
    const seed = await withTenant(TENANT_F, () =>
      assets.create({
        code: "F-BR041-SEED",
        name: "BR-041 in-use seed",
        nameAr: "أصل الرصد",
        categoryId: fixture.vehicleCategoryId,
        branchId: fixture.branchId,
        acquisitionDate: "2026-12-01",
        cost: "500.0000",
        actorId: F_ACTOR,
      }),
    );
    expect(seed.status).toBe("ACTIVE");
    await expect(
      withTenant(TENANT_F, () =>
        categories.update(
          fixture.vehicleCategoryId,
          { accumDepreciationPurposeKey: UNMAPPED_ACCUM_KEY },
          F_ACTOR,
        ),
      ),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_USABLE" });
    // The failed update left the mapping intact.
    const unchanged = await withTenant(TENANT_F, () => categories.find(fixture.vehicleCategoryId));
    expect(unchanged.accumDepreciationPurposeKey).toBe("ACCUM_DEPRECIATION");
  });

  it("mapping the missing purpose makes the category usable — registration then succeeds", async () => {
    await withTenant(TENANT_F, async () => {
      const { insertAccountPurpose } = await import(
        "../../modules/tenancy/infrastructure/tenancy.store"
      );
      await insertAccountPurpose({
        purposeKey: UNMAPPED_ACCUM_KEY,
        accountId: fixture.accountIds.accumDepreciation,
        activeFrom: "2025-12-01",
      });
    });
    const unmappedCategory = (await withTenant(TENANT_F, () => categories.list({}))).find(
      (row) => row.code === "F-UNMAPPED",
    )!;
    const created = await withTenant(TENANT_F, () =>
      assets.create({
        code: "F-BR041-MAPPED",
        name: "BR-041 mapped probe",
        nameAr: "محاولة مربوطة",
        categoryId: unmappedCategory.id,
        branchId: fixture.branchId,
        acquisitionDate: "2026-12-01",
        cost: "1000.0000",
        actorId: F_ACTOR,
      }),
    );
    expect(created.status).toBe("ACTIVE");
  });
});

describe("BR-042 — depreciation posts only via runs (period-locked, one run per period)", () => {
  it("the run posts G-22 with the DEPRECIATION_RUN source; the journal legs hit the category accounts", async () => {
    const asset = await withTenant(TENANT_F, () =>
      assets.create({
        code: "F-BR042-VEH",
        name: "BR-042 vehicle",
        nameAr: "مركبة القاعدة",
        categoryId: fixture.vehicleCategoryId,
        branchId: fixture.branchId,
        acquisitionDate: "2026-01-15",
        cost: "12000.0000",
        salvageValue: "0.0000",
        usefulLifeMonths: 60,
        depreciationMethod: "STRAIGHT_LINE",
        actorId: F_ACTOR,
      }),
    );
    const february = fixture.periodIds["FY2026-02"]!;
    const assembled = await withTenant(TENANT_F, () =>
      depreciation.assembleRun({ fiscalPeriodId: february, actorId: F_ACTOR }),
    );
    // Next-month convention: the January acquisition depreciates from Feb.
    expect(assembled.lines.map((line) => line.assetId)).toEqual([asset.id]);
    expect(assembled.lines[0]!.periodAmount).toBe("200.0000");

    const posted = await withTenant(TENANT_F, () =>
      runs.postRun({ runId: assembled.run.id, actorId: F_ACTOR }),
    );
    expect(posted.run.status).toBe("POSTED");
    expect(posted.run.journalEntryId).not.toBeNull();
    expect(posted.idempotentReplay).toBe(false);

    // BR-042's structural proof: depreciation enters the ledger ONLY through
    // the run document — the journal's source key is DEPRECIATION_RUN:post
    // (the manual-journal surface carries no asset shortcuts; a manual
    // journal on FA purposes is a policy violation, not a system path).
    const entry = await withTenant(TENANT_F, async () => {
      const { findEntryBySourceKey, listLines } = await import(
        "../../modules/accounting/infrastructure/journal.store"
      );
      const found = await findEntryBySourceKey("depreciation_run", assembled.run.id, "post");
      expect(found).toBeDefined();
      const lines = await listLines(found!.id);
      expect(lines.map((line) => [line.accountId, line.direction, line.amount])).toEqual([
        [fixture.accountIds.depreciationExpense, "DEBIT", "200.0000"],
        [fixture.accountIds.accumDepreciation, "CREDIT", "200.0000"],
      ]);
      return found!;
    });
    expect(entry.entryDate).toBe("2026-02-28");
  });

  it("one run per fiscal period — a second assembly after the run POSTS is rejected 409", async () => {
    const february = fixture.periodIds["FY2026-02"]!;
    await expect(
      withTenant(TENANT_F, () =>
        depreciation.assembleRun({ fiscalPeriodId: february, actorId: F_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "DEPRECIATION_RUN_PERIOD_TAKEN" });
  });

  it("runs are period-locked — a LOCKED period rejects the post with PERIOD_LOCKED (INV-011)", async () => {
    const march = fixture.periodIds["FY2026-03"]!;
    const assembled = await withTenant(TENANT_F, () =>
      depreciation.assembleRun({ fiscalPeriodId: march, actorId: F_ACTOR }),
    );
    expect(assembled.run.status).toBe("DRAFT");
    await withTenant(TENANT_F, async () => {
      await periods.softClose(F_ACTOR, march);
      await periods.lock(F_ACTOR, march);
    });
    await expect(
      withTenant(TENANT_F, () => runs.postRun({ runId: assembled.run.id, actorId: F_ACTOR })),
    ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    // Cross-suite hygiene: restore the period to OPEN (INV-020 reopen).
    await withTenant(TENANT_F, async () => {
      await periods.reopen(F_ACTOR, march, "BR-042 rules probe: period-lock restore");
    });
  });
});

describe("BR-043 — NBV floors at salvage; disposal locks the asset (INV-023)", () => {
  it("an asset at the floor is excluded from the run and flips FULLY_DEPRECIATED", async () => {
    // cost − salvage = 100 and opening_accumulated = 100 → already at floor.
    const atFloor = await withTenant(TENANT_F, () =>
      assets.create({
        code: "F-BR043-FLOOR",
        name: "BR-043 at-floor asset",
        nameAr: "أصل مستهلك",
        categoryId: fixture.vehicleCategoryId,
        branchId: fixture.branchId,
        acquisitionDate: "2026-01-10",
        cost: "1000.0000",
        salvageValue: "900.0000",
        openingAccumulated: "100.0000",
        usefulLifeMonths: 36,
        actorId: F_ACTOR,
      }),
    );
    expect(atFloor.status).toBe("ACTIVE");
    const april = fixture.periodIds["FY2026-04"]!;
    const assembled = await withTenant(TENANT_F, () =>
      depreciation.assembleRun({ fiscalPeriodId: april, actorId: F_ACTOR }),
    );
    const excluded = assembled.excluded.find((row) => row.assetId === atFloor.id);
    expect(excluded?.reason).toBe("AT_FLOOR");
    expect(assembled.lines.some((line) => line.assetId === atFloor.id)).toBe(false);
    expect(assembled.flippedToFullyDepreciated).toContain(atFloor.id);
    const flipped = await withTenant(TENANT_F, () => assets.find(atFloor.id));
    expect(flipped.status).toBe("FULLY_DEPRECIATED");
  });

  it("posting a disposal locks the asset DISPOSED; a second disposal is impossible", async () => {
    const asset = await withTenant(TENANT_F, () =>
      assets.create({
        code: "F-BR043-DISP",
        name: "BR-043 disposal asset",
        nameAr: "أصل الاستبعاد",
        categoryId: fixture.vehicleCategoryId,
        branchId: fixture.branchId,
        acquisitionDate: "2026-01-20",
        cost: "10000.0000",
        salvageValue: "0.0000",
        usefulLifeMonths: 60,
        actorId: F_ACTOR,
      }),
    );
    const draft = await withTenant(TENANT_F, () =>
      disposals.createDraft({
        assetId: asset.id,
        kind: "SALE",
        disposalDate: "2026-05-15",
        proceeds: "8000.0000",
        actorId: F_ACTOR,
      }),
    );
    // The draft froze the register side (no posted runs on this asset).
    expect(draft.netBookValue).toBe("10000.0000");
    expect(draft.gainLoss).toBe("-2000.0000");
    // SoD backstop: the creator can never approve their own disposal.
    await expect(
      withTenant(TENANT_F, () => disposals.approve(draft.id, F_ACTOR)),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_BLOCKED" });
    await withTenant(TENANT_F, () => disposals.approve(draft.id, F_APPROVER));
    const posted = await withTenant(TENANT_F, () => disposals.post(draft.id, F_ACTOR));
    expect(posted.disposal.status).toBe("POSTED");
    expect(posted.disposalNo).toMatch(/^DSP-2026-\d{6}$/);

    // THE LOCK (INV-023): the asset left the register exactly once.
    disposedAssetId = asset.id;
    const locked = await withTenant(TENANT_F, () => assets.find(asset.id));
    expect(locked.status).toBe("DISPOSED");
    expect(locked.disposedAt).not.toBeNull();

    // G-23 journal legs (loss mirror mandatory): DR CASH 8000 ·
    // CR FIXED_ASSET 10000 · DR ASSET_DISPOSAL_LOSS 2000.
    await withTenant(TENANT_F, async () => {
      const { findEntryBySourceKey, listLines } = await import(
        "../../modules/accounting/infrastructure/journal.store"
      );
      const entry = await findEntryBySourceKey("asset_disposal", draft.id, "post");
      expect(entry).toBeDefined();
      const lines = await listLines(entry!.id);
      expect(lines.map((line) => [line.accountId, line.direction, line.amount])).toEqual([
        [fixture.accountIds.cash, "DEBIT", "8000.0000"],
        [fixture.accountIds.fixedAsset, "CREDIT", "10000.0000"],
        [fixture.accountIds.disposalLoss, "DEBIT", "2000.0000"],
      ]);
    });

    // Disposal happens exactly once: a second document is impossible.
    await expect(
      withTenant(TENANT_F, () =>
        disposals.createDraft({
          assetId: asset.id,
          kind: "SCRAP",
          disposalDate: "2026-06-15",
          proceeds: "0.0000",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "DISPOSED_ASSET_REUSE" });
  });
});

describe("BR-044 — revaluation is audited; the delta posts to REVALUATION_RESERVE", () => {
  it("a draft without a reason is rejected (audited event needs its narrative)", async () => {
    const asset = await withTenant(TENANT_F, () =>
      assets.create({
        code: "F-BR044-REV",
        name: "BR-044 revaluation asset",
        nameAr: "أصل إعادة التقييم",
        categoryId: fixture.vehicleCategoryId,
        branchId: fixture.branchId,
        acquisitionDate: "2026-01-25",
        cost: "10000.0000",
        salvageValue: "0.0000",
        usefulLifeMonths: 60,
        actorId: F_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_F, () =>
        revaluations.createDraft({
          assetId: asset.id,
          revaluationDate: "2026-05-20",
          newGrossValue: "12000.0000",
          newAccumulated: "0.0000",
          reason: "   ",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "FIXED_ASSET_LIFECYCLE_INPUT_INVALID" });

    const draft = await withTenant(TENANT_F, () =>
      revaluations.createDraft({
        assetId: asset.id,
        revaluationDate: "2026-05-20",
        newGrossValue: "12000.0000",
        newAccumulated: "0.0000",
        reason: "market valuation uplift",
        actorId: F_ACTOR,
      }),
    );
    // Frozen delta = (newGross − newAccum) − live NBV = 2000.
    expect(draft.delta).toBe("2000.0000");
    const posted = await withTenant(TENANT_F, () => revaluations.post(draft.id, F_ACTOR));
    expect(posted.revaluation.status).toBe("POSTED");

    // The journal: gross leg DR FIXED_ASSET · NBV delta CR REVALUATION_RESERVE
    // (never P&L) — both legs asserted on the engine-written lines.
    await withTenant(TENANT_F, async () => {
      const { findEntryBySourceKey, listLines } = await import(
        "../../modules/accounting/infrastructure/journal.store"
      );
      const entry = await findEntryBySourceKey("asset_revaluation", draft.id, "post");
      expect(entry).toBeDefined();
      const lines = await listLines(entry!.id);
      expect(lines.map((line) => [line.accountId, line.direction, line.amount])).toEqual([
        [fixture.accountIds.fixedAsset, "DEBIT", "2000.0000"],
        [fixture.accountIds.revaluationReserve, "CREDIT", "2000.0000"],
      ]);
    });

    // Audited (BR-044): the post wrote its audit event.
    const client = await su();
    const audit = await client.query(
      `SELECT 1 FROM audit_events
        WHERE tenant_id = $1 AND action = 'fixed_assets.asset_revaluation_posted'
          AND entity_id = $2`,
      [TENANT_F, draft.id],
    );
    await client.end();
    expect(audit.rows.length).toBe(1);
  });

  it("revaluation on a DISPOSED asset is rejected (INV-023 terminal states)", async () => {
    expect(disposedAssetId).not.toBe("");
    await expect(
      withTenant(TENANT_F, () =>
        revaluations.createDraft({
          assetId: disposedAssetId,
          revaluationDate: "2026-06-20",
          newGrossValue: "1000.0000",
          newAccumulated: "0.0000",
          reason: "post-disposal probe",
          actorId: F_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ASSET_STATUS_INVALID" });
  });
});
