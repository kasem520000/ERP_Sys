import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { findPartnerById } from "../../partners/infrastructure/partners.store";

import * as store from "../infrastructure/quality.store";
import {
  foldSupplierQualityScore,
  type SupplierScoreFold,
} from "../domain/supplier-score";
import {
  QualityInputInvalidError,
  SupplierQualityPartnerNotFoundError,
  SupplierScorePeriodInvalidError,
} from "../domain/quality-errors";

/**
 * PHASE-050 (W-27 — T-10, 2026-11-23) THE SUPPLIER QUALITY SCORE SERVICE
 * (Q-06, D-13): the rolling fold — one row per supplier per calendar
 * month, built from the owning engines' own rows:
 *
 *   · ncrCount — the module's OWN register (ncr_records, SUPPLIER
 *     source, the partner's rows in the period);
 *   · rejectionCount — the goods-receipt-target FAIL inspections
 *     (the manufacturing module's inspections joined to the purchasing
 *     module's receipts — the incoming-lot rejections, read through
 *     the store's documented evidence reads, never re-computed);
 *   · the delivery window — THE 038 WINDOW READ'S OWN LAW VERBATIM
 *     (readSupplierDeliveryWindow mirrors collaboration.store's
 *     readScorecardWindow: POSTED receipts × their POs, on-time =
 *     receipt_date ≤ COALESCE(expected_date, receipt_date)).
 *
 * THE PURE FOLD IS THE ONLY SCORE COMPUTATION (the unit-first law): the
 * four counts go in, the pinned 0.60/0.40 blend comes out, and the row
 * stores its output VERBATIM.
 *
 * THE DOCUMENTED 038 FEED CONTRACT (D-13 — recorded in BOTH phase
 * surfaces: here the provider's record; the consumer's is
 * purchasing/application/scorecards.ts, which READS these rows through
 * the store's findSupplierQualityFeed and never re-computes): the feed
 * is the latest periods' rows for one supplier, read verbatim; absent
 * rows are the honest empty array (a tenant that never ran the fold
 * carries no quality history — never a fabricated score).
 *
 * THE CALENDAR-MONTH LAW (the declared interpretation): periodStart is
 * a month's first day (YYYY-MM-01) and the window is [periodStart,
 * next-month-start) — the natural key (tenant, partner, period_start)
 * is the 0115 unique's own grain; the recompute OVERWRITES in place
 * (the window moves, the fold re-runs — the 038 ONE-row-per-supplier
 * precedent at period grain).
 */

const MONTH_START = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/** The next month's first day (the window's exclusive end) — pure
 * calendar arithmetic on the validated YYYY-MM-01 shape. */
function nextMonthStart(periodStart: string): string {
  const year = Number(periodStart.slice(0, 4));
  const month = Number(periodStart.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

@Injectable()
export class SupplierScoreService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** THE ROLLING RECOMPUTE: read the evidence, fold the score, upsert
   * the period's row (idempotent — the same period recomputes to the
   * same row, version advancing). */
  async recompute(input: {
    partnerId: string;
    periodStart: string;
    actorId: string | null;
  }): Promise<{ row: store.SupplierQualityScoreRow; fold: SupplierScoreFold }> {
    const partner = await findPartnerById(input.partnerId);
    if (partner === undefined) {
      throw new SupplierQualityPartnerNotFoundError({ partnerId: input.partnerId });
    }
    if (partner.kind !== "SUPPLIER" && partner.kind !== "BOTH") {
      throw new QualityInputInvalidError({
        field: "partnerId",
        reason: `partner ${input.partnerId} is a ${partner.kind}, not a SUPPLIER (the quality rolling fold computes suppliers — the partners module's own kind is the floor)`,
      });
    }
    if (!MONTH_START.test(input.periodStart)) {
      throw new SupplierScorePeriodInvalidError({ periodStart: input.periodStart });
    }
    const periodEndExclusive = nextMonthStart(input.periodStart);
    const ncrCount = await store.countSupplierNcrs({
      partnerId: input.partnerId,
      periodStart: input.periodStart,
      periodEndExclusive,
    });
    const rejectionCount = await store.countSupplierRejections({
      partnerId: input.partnerId,
      periodStart: input.periodStart,
      periodEndExclusive,
    });
    const window = await store.readSupplierDeliveryWindow({
      partnerId: input.partnerId,
      periodStart: input.periodStart,
      periodEndExclusive,
    });
    const fold = foldSupplierQualityScore({
      ncrCount,
      rejectionCount,
      onTimeDeliveries: window.onTime,
      totalDeliveries: window.total,
    });
    const row = await store.upsertSupplierQualityScore({
      partnerId: input.partnerId,
      periodStart: input.periodStart,
      ncrCount,
      rejectionCount,
      onTimeDeliveries: window.onTime,
      totalDeliveries: window.total,
      score: fold.score,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "quality.supplier_score_recomputed",
      entityType: "supplier_quality_score",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        partnerId: row.partnerId,
        periodStart: row.periodStart,
        score: row.score,
        ncrCount,
        rejectionCount,
        onTimeDeliveries: window.onTime,
        totalDeliveries: window.total,
      },
    });
    return { row, fold };
  }

  async list(filter: { partnerId?: string; limit?: number }): Promise<store.SupplierQualityScoreRow[]> {
    return store.listSupplierQualityScores({
      partnerId: filter.partnerId,
      limit: filter.limit ?? 200,
    });
  }

  /** THE DOCUMENTED 038 FEED READ (D-13): the latest periods for one
   * supplier, VERBATIM — the consumer's own door. */
  async feed(partnerId: string, limit?: number): Promise<store.SupplierQualityScoreRow[]> {
    const partner = await findPartnerById(partnerId);
    if (partner === undefined) {
      throw new SupplierQualityPartnerNotFoundError({ partnerId });
    }
    return store.findSupplierQualityFeed(partnerId, limit ?? 12);
  }
}
