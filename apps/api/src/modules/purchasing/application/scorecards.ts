import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as collab from "../infrastructure/collaboration.store";
import { foldScorecard } from "./sourcing-math";
import { SupplierRatingNotFoundError } from "../domain/sourcing-errors";

/**
 * Supplier scorecards (PHASE-038 T-06; P-04): delivery/quality/price
 * scores computed from LIVE documents over the rolling window (default
 * 90 days):
 *
 *   delivery — the on-time GRN ratio (received ≤ the PO's expected date)
 *     over the window's POSTED receipts; zero receipts score 0 (an
 *     unmeasurable supplier is not a provably good one — the scorecard
 *     is evidence, never decoration).
 *   quality — 100 minus the debit-note drag (POSTED debit notes ÷ POSTED
 *     invoices, capped at 100).
 *   price — the qty-weighted invoice-vs-PO price variance fold (0% →
 *     100, ≥15% → 0; the sourcing-math fold).
 *   overall — delivery 40% · quality 40% · price 20% (the documented
 *     weights in sourcing-math).
 *
 * ONE row per supplier (recompute overwrites — the window moves). The
 * on-demand recompute runs here; the nightly sweep (pg-boss) calls the
 * same service per ACTIVE tenant for the entitled ones.
 */

export const SCORECARD_WINDOW_DAYS_DEFAULT = 90;

@Injectable()
export class ScorecardService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async find(supplierId: string) {
    const rating = await collab.findSupplierRating(supplierId);
    if (rating === undefined) throw new SupplierRatingNotFoundError(supplierId);
    return rating;
  }

  async list(limit: number) {
    return collab.listSupplierRatings(limit);
  }

  /**
   * Recompute one supplier's scorecard over the rolling window ending
   * today. Returns the stored row (detail carries the sample
   * decomposition — the evidence).
   */
  async recompute(input: {
    supplierId: string;
    windowDays?: number;
    computedBy: string | null;
  }) {
    const windowEnd = new Date().toISOString().slice(0, 10);
    const days = input.windowDays ?? SCORECARD_WINDOW_DAYS_DEFAULT;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - days);
    const windowStart = start.toISOString().slice(0, 10);

    const sample = await collab.readScorecardWindow(input.supplierId, windowStart, windowEnd);

    // Delivery: the on-time ratio; no receipts → 0 (unmeasurable ≠ good).
    const deliveryScore =
      sample.grnCount > 0
        ? new Decimal(sample.onTimeCount)
            .div(sample.grnCount)
            .times(100)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toFixed(2)
        : "0.00";
    // Quality: the debit-note drag over invoices (capped at 100).
    const qualityScore =
      sample.invoiceCount > 0
        ? Decimal.max(
            new Decimal(100).minus(
              new Decimal(sample.debitNoteCount).div(sample.invoiceCount).times(100),
            ),
            new Decimal(0),
          )
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toFixed(2)
        : "0.00";
    const { priceScore, overallScore } = foldScorecard({
      deliveryScore,
      qualityScore,
      priceVariancePct: sample.priceVariancePct,
    });

    await collab.upsertSupplierRating({
      supplierId: input.supplierId,
      windowStart,
      windowEnd,
      deliveryScore,
      qualityScore,
      priceScore,
      overallScore,
      sampleSize: sample.grnCount + sample.invoiceCount + sample.debitNoteCount,
      detail: {
        windowDays: days,
        grns: { total: sample.grnCount, onTime: sample.onTimeCount },
        invoices: sample.invoiceCount,
        debitNotes: sample.debitNoteCount,
        priceVariancePct: sample.priceVariancePct,
        weights: { delivery: 0.4, quality: 0.4, price: 0.2 },
      },
      computedBy: input.computedBy,
    });
    await this.audit.record({
      action: "purchasing.scorecard_recomputed",
      entityType: "supplier_rating",
      entityId: input.supplierId,
      actorId: input.computedBy ?? undefined,
      after: { windowStart, windowEnd, overallScore, sampleSize: sample.grnCount + sample.invoiceCount + sample.debitNoteCount },
    });
    return this.find(input.supplierId);
  }

  // -- approved supplier items (the P-04 gate's management surface) --------------------

  async listApprovedItems(filter: { supplierId?: string; itemId?: string; limit: number }) {
    return collab.listApprovedSupplierItems(filter);
  }

  async upsertApprovedItem(input: {
    supplierId: string;
    itemId: string;
    status: string;
    expiresAt: string | null;
    note: string | null;
    actorId: string | null;
  }) {
    if (input.status !== "APPROVED" && input.status !== "SUSPENDED") {
      throw new SupplierRatingNotFoundError("(status)");
    }
    const { requireSupplier } = await import("./orders");
    await requireSupplier(input.supplierId);
    const id = await collab.upsertApprovedSupplierItem({ ...input, approvedBy: input.actorId });
    await this.audit.record({
      action: "purchasing.approved_supplier_item_upserted",
      entityType: "approved_supplier_item",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        supplierId: input.supplierId,
        itemId: input.itemId,
        status: input.status,
      },
    });
    const row = await collab.findApprovedSupplierItem(id);
    if (row === undefined) throw new SupplierRatingNotFoundError(id);
    return row;
  }
}
