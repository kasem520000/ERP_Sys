import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  planIssue,
  applyIssue,
  resolveInventoryAccount,
  type IssuePlan,
} from "../../inventory/application/movement-core";
import { TrackingService } from "../../inventory/application/tracking-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/manufacturing.store";
import type { ProductionOrderRow } from "../infrastructure/manufacturing.store";
import {
  InspectionDispositionInvalidError,
  InspectionDispositionRequiredError,
  InspectionInputInvalidError,
  InspectionNotFoundError,
  InspectionTargetInvalidError,
  InspectionTargetNotFoundError,
  ProductionOrderNotFoundError,
  QcScrapBatchNotQuarantinedError,
  QcScrapEmptyBatchError,
} from "../domain/manufacturing-errors";

/**
 * Inspection service (PHASE-018 T39; MASTER-PLAN §4 — the QC gate): records
 * pass/fail decisions against COMPLETED production orders (their FG batch)
 * or goods receipts, and applies the gate's side effects through the real
 * surfaces — quarantine releases via TrackingService (NO journal), the
 * qc_scrap flow via the movement core + PostingService (§1 row 4).
 *
 * Disposition semantics (§4):
 *   PASS (no disposition or ACCEPT) — releases a QUARANTINED FG batch to
 *     ACTIVE; record-only when the batch is not held.
 *   FAIL + ACCEPT — the operator override: same release, audited as such.
 *   FAIL + REWORK — record-only (the batch stays QUARANTINED; a later
 *     inspection decides).
 *   FAIL + SCRAP — the qc_scrap flow: the WHOLE remaining quarantined
 *     on-hand leaves the FG warehouse as a stock issue (reason QC_FAILED)
 *     with the journal DR PRODUCTION_SCRAP · CR the FG warehouse inventory
 *     account (WIP is already zero at completion — §1 row 4). The batch
 *     STAYS QUARANTINED with zero on-hand (no status flip: an empty held
 *     batch remains visibly failed, unlike a written-off one).
 *   RETURN_TO_SUPPLIER — goods-receipt targets only, record-only.
 *
 * goods_receipt targets are ALWAYS record-only (the GRN's stock effects
 * belong to purchasing; the inspection documents the quality decision).
 *
 * Ordering discipline: the inspections row is inserted AFTER the side
 * effects — a release or qc_scrap that throws leaves no record (the whole
 * call runs in the caller's ambient tenant transaction, INV-018).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The FG batch as TrackingService reads it (no infrastructure import). */
type TrackedBatch = Awaited<ReturnType<TrackingService["findBatch"]>>;

export interface CreateInspectionInput {
  targetType: "production_order" | "goods_receipt";
  orderId?: string | null;
  grnId?: string | null;
  result: "PASS" | "FAIL";
  /** Whether the decision was made on a sample (sampleSize required then). */
  sampled?: boolean;
  sampleSize?: number | null;
  disposition?: "ACCEPT" | "SCRAP" | "REWORK" | "RETURN_TO_SUPPLIER" | null;
  /** ISO date; defaults to today. */
  inspectedAt?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

export interface CreateInspectionResult {
  inspection: store.InspectionRow;
  /** A quarantine hold was released (PASS/ACCEPT or the FAIL+ACCEPT override). */
  released: boolean;
  /** FAIL+SCRAP leg only — the qc_scrap journal (§1 row 4). */
  scrapJournalEntryId: string | null;
  scrapQty: string | null;
  scrapValue: string | null;
}

@Injectable()
export class InspectionService {
  constructor(
    // NOTE: every param carries an explicit @Inject — the vitest/esbuild
    // pipeline does not emit design:paramtypes, so bare type-annotated
    // params resolve to undefined holes (the JobCardService silent-undefined
    // precedent, mirrored from ProductionOrderService).
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(TrackingService) private readonly tracking: TrackingService,
  ) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<store.InspectionRow> {
    const row = await store.findInspectionById(id);
    if (row === undefined) throw new InspectionNotFoundError(id);
    return row;
  }

  async list(filter: { targetType?: string; orderId?: string; limit: number }): Promise<store.InspectionRow[]> {
    return store.listInspections(filter);
  }

  // -- create (the §4 gate decision) ---------------------------------------------

  async create(input: CreateInspectionInput): Promise<CreateInspectionResult> {
    // 1. Target validation: exactly one of orderId/grnId, matching the
    //    targetType; the order target must be a COMPLETED order (the gate
    //    attaches to completions — the FG batch exists only then).
    let order: ProductionOrderRow | undefined;
    if (input.targetType === "production_order") {
      if ((input.orderId ?? null) === null) {
        throw new InspectionTargetInvalidError(
          "a production_order inspection requires orderId (got none)",
          { targetType: input.targetType },
        );
      }
      if ((input.grnId ?? null) !== null) {
        throw new InspectionTargetInvalidError(
          "a production_order inspection cannot carry a grnId",
          { targetType: input.targetType, grnId: input.grnId ?? null },
        );
      }
      order = await store.findProductionOrderById(input.orderId!);
      if (order === undefined) throw new ProductionOrderNotFoundError(input.orderId!);
      if (order.status !== "COMPLETED") {
        throw new InspectionTargetInvalidError(
          `production order ${order.orderNo ?? order.id} is ${order.status} — inspections attach to COMPLETED orders (the FG batch exists only after completion)`,
          { orderId: order.id, status: order.status },
        );
      }
    } else {
      if ((input.grnId ?? null) === null) {
        throw new InspectionTargetInvalidError(
          "a goods_receipt inspection requires grnId (got none)",
          { targetType: input.targetType },
        );
      }
      if ((input.orderId ?? null) !== null) {
        throw new InspectionTargetInvalidError(
          "a goods_receipt inspection cannot carry an orderId",
          { targetType: input.targetType, orderId: input.orderId ?? null },
        );
      }
      const grn = await store.findGrnForInspection(input.grnId!);
      if (grn === undefined) throw new InspectionTargetNotFoundError(input.grnId!);
    }

    // 2. Result/disposition + sampled/date validation.
    const sampled = input.sampled ?? false;
    const disposition = input.disposition ?? null;
    const inspectedAt = input.inspectedAt ?? today();
    if (input.result === "FAIL" && disposition === null) {
      throw new InspectionDispositionRequiredError();
    }
    if (input.result === "PASS" && disposition !== null && disposition !== "ACCEPT") {
      throw new InspectionDispositionInvalidError(
        `a PASS inspection carries no disposition or ACCEPT — got ${disposition}`,
        { result: input.result, disposition },
      );
    }
    if (disposition === "RETURN_TO_SUPPLIER" && input.targetType === "production_order") {
      throw new InspectionDispositionInvalidError(
        "RETURN_TO_SUPPLIER applies to goods_receipt targets only — a production order's output cannot be returned to a supplier",
        { targetType: input.targetType, disposition },
      );
    }
    if (sampled && (input.sampleSize ?? null) === null) {
      throw new InspectionInputInvalidError("sampled inspections require sampleSize ≥ 1 (got none)");
    }
    if (!sampled && (input.sampleSize ?? null) !== null) {
      throw new InspectionInputInvalidError(
        `non-sampled inspections carry no sampleSize — got ${input.sampleSize}`,
      );
    }
    if (sampled && (!Number.isInteger(input.sampleSize!) || input.sampleSize! < 1)) {
      throw new InspectionInputInvalidError(
        `sampleSize must be an integer ≥ 1 — got ${input.sampleSize}`,
      );
    }
    if (!DATE_RE.test(inspectedAt) || Number.isNaN(Date.parse(`${inspectedAt}T00:00:00Z`))) {
      throw new InspectionInputInvalidError(
        `inspectedAt must be an ISO date (YYYY-MM-DD): ${inspectedAt}`,
      );
    }

    // 3. Side effects — production_order targets only (GRN targets are
    //    record-only by design).
    let released = false;
    let operatorOverride = false;
    let scrapJournalEntryId: string | null = null;
    let scrapQty: string | null = null;
    let scrapValue: string | null = null;
    let batch: TrackedBatch | undefined;
    if (input.targetType === "production_order") {
      const target = order!;
      batch = target.fgBatchId !== null ? await this.tracking.findBatch(target.fgBatchId) : undefined;

      if (input.result === "PASS" || disposition === "ACCEPT") {
        // PASS (null/ACCEPT) and the FAIL+ACCEPT operator override share the
        // release path — the override only changes the audit story.
        if (input.result === "FAIL") operatorOverride = true;
        if (batch !== undefined && batch.status === "QUARANTINED") {
          await this.tracking.releaseQuarantine(batch.id); // NO journal (§4)
          released = true;
        }
        // Batch not held → record-only (consistent with PASS on a released
        // batch: an inspection may be recorded at any time after completion).
      } else if (disposition === "REWORK") {
        // Record-only: the batch stays QUARANTINED; a later inspection
        // decides (release or scrap) after the rework.
      } else if (disposition === "SCRAP") {
        // The qc_scrap flow (MASTER-PLAN §1 row 4): the quarantined hold is
        // emptied — the WHOLE remaining on-hand leaves the FG warehouse.
        if (batch === undefined || batch.status !== "QUARANTINED") {
          throw new QcScrapBatchNotQuarantinedError({
            orderId: target.id,
            batchId: batch?.id ?? null,
            status: batch?.status ?? null,
          });
        }
        const onHand = await store.qcBatchOnHand(batch.id);
        if (new Decimal(onHand).lessThanOrEqualTo(0)) {
          throw new QcScrapEmptyBatchError({ batchId: batch.id, onHand });
        }
        const qty = new Decimal(onHand).toFixed(6); // canonical 6dp
        // The ONE caller allowed past the movement core's explicit-batch
        // quarantine hold (see movement-core planIssue) — the scrapping
        // inspection issues the held batch on purpose.
        const plan: IssuePlan = await planIssue({
          itemId: target.itemId,
          warehouseId: target.fgWarehouseId,
          qty,
          movedAt: inspectedAt,
          moveKind: "issue",
          sourceType: "production_order",
          sourceId: target.id,
          batchId: batch.id,
          allowQuarantinedBatch: true,
          reason: "QC_FAILED",
          memo: `Production order ${target.orderNo ?? target.id} — QC-failed batch scrapped`,
          memoAr: `أمر إنتاج ${target.orderNo ?? target.id} — إتلاف دفعة فاشلة في الفحص`,
        });
        const lines: JournalLineSpec[] = [
          {
            purpose: "PRODUCTION_SCRAP",
            direction: "DEBIT",
            amount: plan.valueAmount,
            memo: {
              en: `Production order ${target.orderNo ?? target.id} — QC-failed batch scrapped (QC_FAILED)`,
              ar: `أمر إنتاج ${target.orderNo ?? target.id} — إتلاف دفعة فاشلة في الفحص (QC_FAILED)`,
            },
          },
          {
            accountId: await resolveInventoryAccount(target.fgWarehouseId),
            direction: "CREDIT",
            amount: plan.valueAmount,
            memo: {
              en: `Production order ${target.orderNo ?? target.id} — QC-failed batch scrapped (QC_FAILED)`,
              ar: `أمر إنتاج ${target.orderNo ?? target.id} — إتلاف دفعة فاشلة في الفحص (QC_FAILED)`,
            },
          },
        ];
        const spec: JournalSpec = {
          source: { docType: "production_order", docId: target.id, operation: "qc_scrap" },
          entryDate: inspectedAt,
          description: {
            en: `Production order ${target.orderNo ?? target.id} — QC-fail scrap`,
            ar: `أمر إنتاج ${target.orderNo ?? target.id} — إتلاف فشل الفحص`,
          },
          currency: await ownTenantBaseCurrency(),
          lines,
        };
        const posted = await this.posting.post(spec, { postedBy: input.actorId });
        await applyIssue(plan, posted.journalEntryId);
        scrapJournalEntryId = posted.journalEntryId;
        scrapQty = plan.qty;
        scrapValue = plan.valueAmount;
        // The batch STAYS QUARANTINED with zero on-hand — no status change:
        // an emptied held batch remains visibly QC-failed (unlike a
        // WRITTEN_OFF batch), and the empty-batch guard above makes a
        // second scrap the typed QC_SCRAP_EMPTY_BATCH.
      }
    }

    // 4. The inspections row LAST — a failed side effect leaves no record.
    const row = await store.insertInspection({
      targetType: input.targetType,
      orderId: input.targetType === "production_order" ? order!.id : null,
      grnId: input.targetType === "goods_receipt" ? input.grnId! : null,
      fgBatchId: input.targetType === "production_order" ? (batch?.id ?? null) : null,
      result: input.result,
      sampled,
      sampleSize: sampled ? input.sampleSize! : null,
      disposition,
      inspectedAt,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });

    // 5. Audit: the inspection event (+ the qc_scrap leg on the order).
    await this.audit.record({
      action: "manufacturing.inspection.created",
      entityType: "inspection",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        targetType: input.targetType,
        orderId: row.orderId,
        grnId: row.grnId,
        result: input.result,
        disposition,
        sampled,
        sampleSize: row.sampleSize,
        released,
        ...(operatorOverride ? { operatorOverride: true } : {}),
      },
    });
    if (scrapJournalEntryId !== null) {
      await this.audit.record({
        action: "manufacturing.production_order.qc_scrapped",
        entityType: "production_order",
        entityId: order!.id,
        actorId: input.actorId ?? undefined,
        after: {
          orderNo: order!.orderNo,
          batchId: batch!.id,
          qty: scrapQty,
          value: scrapValue,
          reason: "QC_FAILED",
          journalEntryId: scrapJournalEntryId,
        },
      });
    }

    // 6. Done.
    return { inspection: row, released, scrapJournalEntryId, scrapQty, scrapValue };
  }
}
