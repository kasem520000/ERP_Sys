import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  currentMonthStart,
  freshQualitySupplier,
  seedSupplierDelivery,
  setupQualityFixture,
} from "./fixtures";
import { NcrService } from "../../modules/quality/application/ncr-service";
import { SupplierScoreService } from "../../modules/quality/application/supplier-score-service";
import { ScorecardService } from "../../modules/purchasing/application/scorecards";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";

/**
 * PHASE-050 (W-27 — T-10, 2026-11-23) `quality-supplier-scores.db.spec` —
 * THE SUPPLIER QUALITY ROLLING FOLD over real PG16 (the plan §4's own
 * arm; acceptance #6's score arms): the fold's evidence reads (the
 * SUPPLIER-source NCRs from the module's own register · the
 * goods-receipt FAIL inspections joined to the receipts' own supplier ·
 * the delivery window on the REAL POSTED receipts through the REAL
 * purchasing services — the 038 window read's own law verbatim), the
 * pinned blend on a hand-computed world, the idempotent upsert on the
 * (tenant, partner, period_start) natural key, the calendar-month floor,
 * the unmeasured zero shape, THE DOCUMENTED 038 FEED CONTRACT (the
 * consumer reads VERBATIM — the scorecard's detail carries the rows,
 * never a recomputation), and the RLS boundary.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const ncr = new NcrService(audit, posting, numbering);
const scores = new SupplierScoreService(audit);
const scorecards = new ScorecardService(audit);

beforeAll(async () => {
  await setupQualityFixture();
});

/** Day offsets off the month start (the window's own calendar law —
 * every date lands INSIDE the current month whatever day it is). */
function monthDay(offset: number): string {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

/** A full month earlier than the current one — the OUTSIDE-the-window
 * arm's own month (inside FY2026; when the current month is January the
 * arm rides March instead, never the current month). */
function outsideMonthDay(offset: number): string {
  const now = new Date();
  const start =
    now.getUTCMonth() === 0
      ? new Date(Date.UTC(now.getUTCFullYear(), 2, 1))
      : new Date(Date.UTC(now.getUTCFullYear(), 0, 2));
  return new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

describe("PHASE-050 W-27 — the supplier quality rolling fold over real PG16", () => {
  it("the pinned world: one NCR + one FAIL inspection + two POSTED deliveries (one late) → the fold's own figures", async () => {
    const world = await freshQualitySupplier("MAIN");
    const monthStart = currentMonthStart();
    // The deliveries: one ON TIME (expected = receipt), one LATE
    // (expected five days after the order, received fifteen days in) —
    // both inside the current month's window.
    await seedSupplierDelivery({
      world,
      code: "ONTIME",
      orderDate: monthStart,
      expectedDate: monthStart,
      receiptDate: monthStart,
    });
    const late = await seedSupplierDelivery({
      world,
      code: "LATE",
      orderDate: monthDay(1),
      expectedDate: monthDay(5),
      receiptDate: monthDay(15),
      failInspection: true,
    });
    expect(late.inspectionId).not.toBeNull();
    // The SUPPLIER-source NCR on the module's own register.
    await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "SUPPLIER",
        severity: "HIGH",
        itemId: world.itemId,
        partnerId: world.supplierId,
        problem: "Incoming lot viscosity out of band",
        affectedQty: "10",
        actorId: QL_ACTOR,
      }),
    );
    const { row, fold } = await withTenant(TENANT_QUALITY, () =>
      scores.recompute({ partnerId: world.supplierId, periodStart: monthStart, actorId: QL_ACTOR }),
    );
    // The evidence: ncrCount 1 · rejectionCount 1 · total 2 · onTime 1.
    expect(row.ncrCount).toBe(1);
    expect(row.rejectionCount).toBe(1);
    expect(row.totalDeliveries).toBe(2);
    expect(row.onTimeDeliveries).toBe(1);
    // THE PINNED BLEND (the pure fold's own arithmetic — hand-computed):
    // defect leg = 100 − (1+1)/2×100 = 0 · delivery leg = 1/2×100 = 50
    // score = 0.6×0 + 0.4×50 = 20.00.
    expect(fold.defectLeg).toBe("0.000000");
    expect(fold.deliveryLeg).toBe("50.000000");
    expect(fold.score).toBe("20.00");
    expect(row.score).toBe("20.00");
    expect(row.periodStart).toBe(monthStart);
  });

  it("the idempotent upsert: the same period recomputes to ONE row (the version advances, the natural key holds)", async () => {
    const world = await freshQualitySupplier("IDEM");
    const monthStart = currentMonthStart();
    await seedSupplierDelivery({
      world,
      code: "IDEM-1",
      orderDate: monthStart,
      expectedDate: monthStart,
      receiptDate: monthStart,
    });
    const first = await withTenant(TENANT_QUALITY, () =>
      scores.recompute({ partnerId: world.supplierId, periodStart: monthStart, actorId: QL_ACTOR }),
    );
    expect(first.row.score).toBe("100.00");
    const second = await withTenant(TENANT_QUALITY, () =>
      scores.recompute({ partnerId: world.supplierId, periodStart: monthStart, actorId: QL_ACTOR }),
    );
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.version).toBe(first.row.version + 1);
    const rows = await withTenant(TENANT_QUALITY, () =>
      scores.list({ partnerId: world.supplierId }),
    );
    expect(rows.filter((row) => row.periodStart === monthStart)).toHaveLength(1);
  });

  it("THE UNMEASURED ZERO: a supplier with no deliveries in the period scores 0.00 (evidence, never decoration)", async () => {
    const world = await freshQualitySupplier("UNMEAS");
    const monthStart = currentMonthStart();
    const { row, fold } = await withTenant(TENANT_QUALITY, () =>
      scores.recompute({ partnerId: world.supplierId, periodStart: monthStart, actorId: QL_ACTOR }),
    );
    expect(row.totalDeliveries).toBe(0);
    expect(row.score).toBe("0.00");
    expect(fold.unmeasured).toBe(true);
    expect(row.totalDeliveries).toBe(0);
  });

  it("the calendar-month floor + the partner-kind floor + the not-found — all typed, all named", async () => {
    const world = await freshQualitySupplier("FLOORS");
    await expect(
      withTenant(TENANT_QUALITY, () =>
        scores.recompute({
          partnerId: world.supplierId,
          periodStart: "2026-11-15",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SUPPLIER_SCORE_PERIOD_INVALID" });
    await expect(
      withTenant(TENANT_QUALITY, () =>
        scores.recompute({
          partnerId: "11111111-1111-4111-8111-111111111111",
          periodStart: currentMonthStart(),
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SUPPLIER_QUALITY_PARTNER_NOT_FOUND" });
    // The QL base fixture's partner is a CUSTOMER — the kind floor.
    const base = await setupQualityFixture();
    await expect(
      withTenant(TENANT_QUALITY, () =>
        scores.recompute({
          partnerId: base.partnerId,
          periodStart: currentMonthStart(),
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "QUALITY_INPUT_INVALID",
      details: { field: "partnerId" },
    });
  });

  it("THE DOCUMENTED 038 FEED CONTRACT: the scorecard's recompute detail carries the quality rows VERBATIM (the consumer reads, never re-computes)", async () => {
    const world = await freshQualitySupplier("FEED");
    const monthStart = currentMonthStart();
    await seedSupplierDelivery({
      world,
      code: "FEED-1",
      orderDate: monthStart,
      expectedDate: monthStart,
      receiptDate: monthStart,
    });
    const qualityRow = await withTenant(TENANT_QUALITY, () =>
      scores.recompute({ partnerId: world.supplierId, periodStart: monthStart, actorId: QL_ACTOR }),
    );
    // The CONSUMER's own recompute (the 038 service, in the same tenant):
    // its detail now carries the quality feed — the same rows, VERBATIM.
    const rating = await withTenant(TENANT_QUALITY, () =>
      scorecards.recompute({ supplierId: world.supplierId, windowDays: 90, computedBy: QL_ACTOR }),
    );
    const detail = rating.detail as unknown as {
      qualityFeed: { id: string; score: string; periodStart: string; ncrCount: number }[];
    };
    expect(Array.isArray(detail.qualityFeed)).toBe(true);
    expect(detail.qualityFeed).toHaveLength(1);
    expect(detail.qualityFeed[0]!.id).toBe(qualityRow.row.id);
    expect(detail.qualityFeed[0]!.score).toBe(qualityRow.row.score);
    expect(detail.qualityFeed[0]!.periodStart).toBe(monthStart);
    expect(detail.qualityFeed[0]!.ncrCount).toBe(0);
    // THE FEED DOOR (the provider's own read route — the same rows).
    const feed = await withTenant(TENANT_QUALITY, () => scores.feed(world.supplierId));
    expect(feed.map((row) => row.id)).toContain(qualityRow.row.id);
  });

  it("the feed contract's honest empty shape: a supplier the fold never ran for carries NO fabricated rows", async () => {
    const world = await freshQualitySupplier("EMPTY");
    const feed = await withTenant(TENANT_QUALITY, () => scores.feed(world.supplierId));
    expect(feed).toEqual([]);
    // The consumer's detail carries the honest empty array.
    const rating = await withTenant(TENANT_QUALITY, () =>
      scorecards.recompute({ supplierId: world.supplierId, windowDays: 90, computedBy: QL_ACTOR }),
    );
    const detail = rating.detail as unknown as { qualityFeed: unknown[] };
    expect(detail.qualityFeed).toEqual([]);
  });

  it("THE RLS BOUNDARY: the isolated tenant's list is empty and its feed read is the 404 shape", async () => {
    const world = await freshQualitySupplier("RLS");
    const monthStart = currentMonthStart();
    await seedSupplierDelivery({
      world,
      code: "RLS-1",
      orderDate: monthStart,
      expectedDate: monthStart,
      receiptDate: monthStart,
    });
    await withTenant(TENANT_QUALITY, () =>
      scores.recompute({ partnerId: world.supplierId, periodStart: monthStart, actorId: QL_ACTOR }),
    );
    const rlsRows = await withTenant(TENANT_QUALITY_RLS, () => scores.list({}));
    expect(rlsRows).toEqual([]);
    // The supplier does not exist in the isolated tenant (A7's shape).
    await expect(
      withTenant(TENANT_QUALITY_RLS, () => scores.feed(world.supplierId)),
    ).rejects.toMatchObject({ code: "SUPPLIER_QUALITY_PARTNER_NOT_FOUND" });
  });

  it("the periods' boundary: a delivery outside the window never counts (the calendar-month window law)", async () => {
    const world = await freshQualitySupplier("WINDOW");
    const monthStart = currentMonthStart();
    // A delivery dated in ANOTHER month (outside the current window).
    await seedSupplierDelivery({
      world,
      code: "OUT",
      orderDate: outsideMonthDay(0),
      expectedDate: outsideMonthDay(0),
      receiptDate: outsideMonthDay(5),
    });
    const { row } = await withTenant(TENANT_QUALITY, () =>
      scores.recompute({ partnerId: world.supplierId, periodStart: monthStart, actorId: QL_ACTOR }),
    );
    expect(row.totalDeliveries).toBe(0);
    expect(row.score).toBe("0.00");
  });
});
