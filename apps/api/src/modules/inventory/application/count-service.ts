import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";
import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/inventory.store";
import {
  CountLineNotFoundError,
  CountVarianceToleranceError,
  StockCountNotFoundError,
  StockCountStateError,
} from "../domain/inventory-errors";
import {
  applyIssue,
  applyReceipt,
  planIssue,
  planReceipt,
  resolveInventoryAccount,
} from "./movement-core";

/**
 * Stock counts (PHASE-010 T8; §2.10; BR-015; Journey D): DRAFT → COUNTED →
 * VARIANCE_REVIEW → POSTED sessions with the frozen system-qty snapshot at
 * session start, optional blind counting, variance review listing
 * post-snapshot movements, and approval that posts the adjustment
 * (G-13 loss / G-14 gain — one balanced journal per count).
 *
 * Tolerance (BR-015, `inventory.count_variance_tolerance`, default 0 =
 * everything reviewed): any line whose |value impact| exceeds the
 * tolerance requires a RECOUNT or supervisor approval — the approve call
 * carries the supervisor flag, the session records it, everything audits.
 */
@Injectable()
export class CountService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; warehouseId?: string; limit: number }) {
    return store.listCounts(filter);
  }

  async find(id: string) {
    const count = await store.findCountById(id);
    if (count === undefined) throw new StockCountNotFoundError(id);
    return count;
  }

  async lines(id: string) {
    await this.find(id);
    return store.listCountLines(id);
  }

  async postSnapshotMovements(id: string) {
    const count = await this.find(id);
    return store.listMovementsSince(id, count.warehouseId, count.snapshotAt);
  }

  /** Create a session: snapshot_at frozen now; lines snapshot at insert. */
  async create(input: {
    warehouseId: string;
    blind: boolean;
    itemIds: string[];
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    const id = generateUuidV7();
    await store.insertCount({
      id,
      warehouseId: input.warehouseId,
      blind: input.blind,
      note: input.note,
      noteAr: input.noteAr,
      createdBy: input.actorId,
      snapshotAt: new Date().toISOString(),
    });
    let lineNo = 0;
    for (const itemId of input.itemIds) {
      const stock = await store.findItemStock(itemId, input.warehouseId);
      await store.insertCountLine({
        countId: id,
        lineNo: ++lineNo,
        itemId,
        batchId: null,
        systemQty: stock?.qty ?? "0.000000",
      });
    }
    await this.audit.record({
      action: "inventory.count_created",
      entityType: "stock_count",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        warehouseId: input.warehouseId,
        blind: input.blind,
        lines: input.itemIds.length,
      },
    });
    return this.find(id);
  }

  /** Blind-safe line entry: counted qty lands, system qty stays frozen. */
  async enterCounts(input: {
    countId: string;
    entries: { lineNo: number; countedQty: string }[];
    actorId: string | null;
  }) {
    const count = await this.find(input.countId);
    if (count.status !== "DRAFT") {
      throw new StockCountStateError(`count ${input.countId} is ${count.status} — entry needs DRAFT`);
    }
    const existing = await store.listCountLines(input.countId);
    for (const entry of input.entries) {
      const line = existing.find((row) => row.lineNo === entry.lineNo);
      if (line === undefined) throw new CountLineNotFoundError(input.countId, entry.lineNo);
      if (!/^\d+(\.\d{1,6})?$/.test(entry.countedQty) || Number(entry.countedQty) < 0) {
        throw new StockCountStateError(`counted qty must be a non-negative decimal: ${entry.countedQty}`);
      }
      await store.setCountedQty({
        countId: input.countId,
        lineNo: entry.lineNo,
        countedQty: new Decimal(entry.countedQty).toFixed(6),
        recounted: false,
        recountNote: null,
      });
    }
    await this.audit.record({
      action: "inventory.count_lines_entered",
      entityType: "stock_count",
      entityId: input.countId,
      actorId: input.actorId ?? undefined,
      after: { entries: input.entries.length },
    });
  }

  /**
   * Recount a line with a mandatory note (BR-015's second counter). In
   * VARIANCE_REVIEW the recount also refreshes the line's value impact +
   * the session's variance summary (the approval reads them).
   */
  async recountLine(input: {
    countId: string;
    lineNo: number;
    countedQty: string;
    recountNote: string;
    actorId: string | null;
  }) {
    const count = await this.find(input.countId);
    if (count.status !== "DRAFT" && count.status !== "COUNTED" && count.status !== "VARIANCE_REVIEW") {
      throw new StockCountStateError(`count ${input.countId} is ${count.status} — recount needs DRAFT/COUNTED/VARIANCE_REVIEW`);
    }
    if (input.recountNote.trim().length === 0) {
      throw new StockCountStateError("a recount requires a note");
    }
    const existing = await store.listCountLines(input.countId);
    const line = existing.find((row) => row.lineNo === input.lineNo);
    if (line === undefined) throw new CountLineNotFoundError(input.countId, input.lineNo);
    await store.setCountedQty({
      countId: input.countId,
      lineNo: input.lineNo,
      countedQty: new Decimal(input.countedQty).toFixed(6),
      recounted: true,
      recountNote: input.recountNote,
    });
    if (count.status === "VARIANCE_REVIEW") {
      // Refresh the review math for the new counted qty.
      const refreshed = await this.varianceOf(input.countId, count.warehouseId);
      await store.markCountUnderReview({ id: input.countId, variance: refreshed });
    }
    await this.audit.record({
      action: "inventory.count_line_recounted",
      entityType: "stock_count",
      entityId: input.countId,
      actorId: input.actorId ?? undefined,
      after: { lineNo: input.lineNo, countedQty: input.countedQty, note: input.recountNote },
    });
  }

  /** Variance computation shared by review + post-recount refresh. */
  private async varianceOf(
    countId: string,
    warehouseId: string,
  ): Promise<{ lossLines: number; gainLines: number; lossValue: string; gainValue: string }> {
    const lines = await store.listCountLines(countId);
    const impacts: { lineNo: number; valueImpact: string }[] = [];
    let lossLines = 0;
    let gainLines = 0;
    let lossValue = "0.0000";
    let gainValue = "0.0000";
    for (const line of lines) {
      const variance = new Decimal(line.countedQty!).minus(new Decimal(line.systemQty));
      if (variance.isZero()) continue;
      const stockRow = await store.findItemStock(line.itemId, warehouseId);
      const avg = new Decimal(stockRow?.avgCost ?? "0");
      const impact = variance.times(avg).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      impacts.push({ lineNo: line.lineNo, valueImpact: impact });
      if (variance.lt(0)) {
        lossLines += 1;
        lossValue = new Decimal(lossValue).plus(new Decimal(impact).abs()).toFixed(4);
      } else {
        gainLines += 1;
        gainValue = new Decimal(gainValue).plus(impact).toFixed(4);
      }
    }
    await store.setValueImpacts({ countId, impacts });
    return { lossLines, gainLines, lossValue, gainValue };
  }

  async submit(id: string, actorId: string | null) {
    const count = await this.find(id);
    if (count.status !== "DRAFT") {
      throw new StockCountStateError(`count ${id} is ${count.status} — only DRAFT submits`);
    }
    const lines = await store.listCountLines(id);
    const uncounted = lines.filter((line) => line.countedQty === null);
    if (uncounted.length > 0) {
      throw new StockCountStateError(
        `count ${id} has ${uncounted.length} uncounted lines — enter or recount them first`,
      );
    }
    const flipped = await store.markCountSubmitted({ id, countedBy: actorId });
    if (!flipped) throw new StockCountStateError(`count ${id} submit raced`);
    await this.audit.record({
      action: "inventory.count_submitted",
      entityType: "stock_count",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  /** Variance review: per-line value impact at current valuation (§2.10). */
  async review(id: string, actorId: string | null) {
    const count = await this.find(id);
    if (count.status !== "COUNTED") {
      throw new StockCountStateError(`count ${id} is ${count.status} — review needs COUNTED`);
    }
    const variance = await this.varianceOf(id, count.warehouseId);
    const flipped = await store.markCountUnderReview({ id, variance });
    if (!flipped) throw new StockCountStateError(`count ${id} review raced`);
    await this.audit.record({
      action: "inventory.count_variance_reviewed",
      entityType: "stock_count",
      entityId: id,
      actorId: actorId ?? undefined,
      after: variance,
    });
    return this.find(id);
  }

  /**
   * Approval → the adjustment posting (BR-015 + G-13/G-14): per-line move
   * rows (loss OUT / gain IN at current valuation) + ONE balanced journal
   * for the whole session. INV-011: the engine rejects locked periods.
   */
  async approve(input: { id: string; supervisor: boolean; actorId: string | null }) {
    const count = await this.find(input.id);
    if (count.status !== "VARIANCE_REVIEW") {
      throw new StockCountStateError(`count ${input.id} is ${count.status} — approval needs VARIANCE_REVIEW`);
    }
    const tolerance = (await readEffectiveSetting<string>("inventory.count_variance_tolerance")) ?? "0.0000";
    const lines = (await store.listCountLines(input.id)).filter(
      (line) => line.valueImpact !== null && Number(line.valueImpact) !== 0,
    );
    const overTolerance = lines.filter(
      (line) =>
        new Decimal(line.valueImpact!).abs().gt(new Decimal(tolerance)) &&
        !line.recounted,
    );
    if (overTolerance.length > 0 && !input.supervisor) {
      throw new CountVarianceToleranceError({
        countId: input.id,
        overTolerance: overTolerance.length,
        tolerance,
      });
    }

    const postingDate = today();
    // PLAN every variance line (no writes): losses issue, gains receive —
    // the pending overlay composes multi-line (item, batch) documents.
    const lossPlans: { lineNo: number; plan: Awaited<ReturnType<typeof planIssue>> }[] = [];
    const gainPlans: { lineNo: number; plan: Awaited<ReturnType<typeof planReceipt>> }[] = [];
    for (const line of lines) {
      const stock = await store.findItemStock(line.itemId, count.warehouseId);
      const avg = stock?.avgCost ?? "0.000000";
      const variance = new Decimal(line.countedQty!).minus(new Decimal(line.systemQty));
      if (variance.lt(0)) {
        const plan = await planIssue({
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          qty: variance.abs().toFixed(6),
          movedAt: postingDate,
          moveKind: "adjust",
          sourceType: "stock_count",
          sourceId: input.id,
          reason: "COUNT_LOSS",
        });
        lossPlans.push({ lineNo: line.lineNo, plan });
      } else {
        const plan = await planReceipt({
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          qty: variance.toFixed(6),
          unitCost: avg,
          movedAt: postingDate,
          moveKind: "adjust",
          sourceType: "stock_count",
          sourceId: input.id,
          reason: "COUNT_GAIN",
        });
        gainPlans.push({ lineNo: line.lineNo, plan });
      }
    }
    const lossTotal = lossPlans
      .reduce((sum, row) => sum.plus(new Decimal(row.plan.valueAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    const gainTotal = gainPlans
      .reduce((sum, row) => sum.plus(new Decimal(row.plan.valueAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);

    const inventoryAccount = await resolveInventoryAccount(count.warehouseId);
    const journalLines: JournalLineSpec[] = [];
    if (Number(lossTotal) !== 0) {
      journalLines.push(
        {
          purpose: "INVENTORY_SHRINKAGE",
          direction: "DEBIT",
          amount: lossTotal,
          memo: { en: "Count variance — shrinkage", ar: "فروقات الجرد — هالك" },
        },
        {
          accountId: inventoryAccount,
          direction: "CREDIT",
          amount: lossTotal,
          memo: { en: "Count variance — shrinkage", ar: "فروقات الجرد — هالك" },
        },
      );
    }
    if (Number(gainTotal) !== 0) {
      journalLines.push(
        {
          accountId: inventoryAccount,
          direction: "DEBIT",
          amount: gainTotal,
          memo: { en: "Count variance — appreciation", ar: "فروقات الجرد — زيادة" },
        },
        {
          purpose: "INVENTORY_APPRECIATION",
          direction: "CREDIT",
          amount: gainTotal,
          memo: { en: "Count variance — appreciation", ar: "فروقات الجرد — زيادة" },
        },
      );
    }

    let journalEntryId: string | null = null;
    let entryNo: string | null = null;
    if (journalLines.length > 0) {
      const spec: JournalSpec = {
        source: { docType: "stock_count", docId: input.id, operation: "post" },
        entryDate: postingDate,
        description: {
          en: `Stock count adjustment — ${count.warehouseCode}`,
          ar: `تسوية جرد المخزون — ${count.warehouseCode}`,
        },
        currency: await ownTenantBaseCurrency(),
        lines: journalLines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = result.journalEntryId;
      entryNo = result.entryNo;
    }

    // APPLY: every variance line's rows, stamped with the count journal.
    for (const row of lossPlans) {
      await applyIssue(row.plan, journalEntryId);
    }
    for (const row of gainPlans) {
      await applyReceipt(row.plan, journalEntryId);
    }

    const acquired = await this.numbering.reserve({
      docType: "stock_count",
      branchId: null,
      periodKey: postingDate.slice(0, 4),
      format: "CNT-{YYYY}-{SEQ:6}",
      prefix: "CNT",
      year: postingDate.slice(0, 4),
    });
    const flipped = await store.markCountPosted({
      id: input.id,
      countNo: acquired.number,
      postingDate,
      approvedBy: input.actorId,
      supervisorOverride: input.supervisor,
      postedJournalId: journalEntryId,
    });
    if (!flipped) throw new StockCountStateError(`count ${input.id} approval raced`);
    await this.audit.record({
      action: "inventory.count_posted",
      entityType: "stock_count",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      after: {
        countNo: acquired.number,
        lossValue: lossTotal,
        gainValue: gainTotal,
        supervisor: input.supervisor,
        journalEntryId,
      },
    });
    return { countNo: acquired.number, journalEntryId, entryNo, lossValue: lossTotal, gainValue: gainTotal };
  }

  async cancel(id: string, actorId: string | null) {
    const count = await this.find(id);
    if (count.status !== "DRAFT") {
      throw new StockCountStateError(`only DRAFT counts cancel — ${id} is ${count.status}`);
    }
    await store.cancelCount(id);
    await this.audit.record({
      action: "inventory.count_cancelled",
      entityType: "stock_count",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
