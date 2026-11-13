import { Inject, Injectable } from "@nestjs/common";
import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency, readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/inventory.store";
import * as cc from "../infrastructure/cycle-count.store";
import {
  AbcThresholdError,
  CycleCountDocumentNotFoundError,
  CycleCountDocumentStateError,
  CycleCountLineNotFoundError,
  CycleCountScheduleNotFoundError,
  CycleCountScheduleStateError,
  CycleCountThresholdError,
} from "../domain/inventory-errors";
import { applyIssue, applyReceipt, planIssue, planReceipt, resolveInventoryAccount } from "./movement-core";

/**
 * Cycle counting + ABC (PHASE-044 T-07; §2.6/§2.7, I-08/I-09/I-20):
 * ABC-frequency-based schedules generate bin-aware count documents
 * (DRAFT → COUNTED → VARIANCE_REVIEW → POSTED), variances post through
 * the EXISTING adjustment shapes (G-13/G-14) with CYCLE_COUNT_LOSS /
 * CYCLE_COUNT_GAIN reasons, and BR-075's approval threshold gates the
 * posting (a line's |value impact| over the schedule's threshold needs a
 * supervisor approval or a recount).
 *
 * The ABC recompute (§2.7): consumption value over a lookback window
 * (OUT moves of kind issue/adjust — transfers stay inside the company),
 * Pareto-ranked; A up to aPct of the cumulative value, B up to bPct, C
 * the tail (zero-consumption items are C). is_latest is the one-row
 * floor — a recompute demotes the previous generation wholesale.
 */
const ABC_DEFAULT_WINDOW_DAYS = 90;
const ABC_DEFAULT_A_PCT = "0.80";
const ABC_DEFAULT_B_PCT = "0.95";

@Injectable()
export class CycleCountService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  // -- schedules (§2.6) --------------------------------------------------------------

  async listSchedules(filter: { warehouseId?: string; activeOnly?: boolean; limit?: number }) {
    return cc.listSchedules({
      warehouseId: filter.warehouseId,
      activeOnly: filter.activeOnly,
      limit: filter.limit ?? 100,
    });
  }

  async createSchedule(input: {
    warehouseId: string;
    name: string;
    classADays: number;
    classBDays: number;
    classCDays: number;
    approvalThreshold: string;
    blind: boolean;
    note: string | null;
    actorId: string | null;
  }) {
    if (input.classADays < 1 || input.classBDays < 1 || input.classCDays < 1) {
      throw new CycleCountScheduleStateError("class intervals must be ≥ 1 day");
    }
    if (input.classADays > input.classBDays || input.classBDays > input.classCDays) {
      throw new CycleCountScheduleStateError(
        "class intervals must satisfy A ≤ B ≤ C days (fast movers count more often)",
      );
    }
    if (Number(input.approvalThreshold) < 0) {
      throw new CycleCountScheduleStateError("approval threshold must be ≥ 0 (BR-075)");
    }
    const siblings = await cc.listSchedules({ warehouseId: input.warehouseId, limit: 200 });
    if (siblings.some((s) => s.name === input.name)) {
      throw new CycleCountScheduleStateError(
        `schedule name ${input.name} already exists in this warehouse`,
      );
    }
    const schedule = await cc.insertSchedule({
      warehouseId: input.warehouseId,
      name: input.name,
      classADays: input.classADays,
      classBDays: input.classBDays,
      classCDays: input.classCDays,
      approvalThreshold: new Decimal(input.approvalThreshold).toFixed(4),
      blind: input.blind,
      note: input.note,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.cycle_count_schedule_created",
      entityType: "cycle_count_schedule",
      entityId: schedule.id,
      actorId: input.actorId ?? undefined,
      after: {
        warehouseId: schedule.warehouseId,
        name: schedule.name,
        classADays: schedule.classADays,
        classBDays: schedule.classBDays,
        classCDays: schedule.classCDays,
        approvalThreshold: schedule.approvalThreshold,
        blind: schedule.blind,
      },
    });
    return schedule;
  }

  async updateSchedule(
    id: string,
    patch: {
      classADays?: number;
      classBDays?: number;
      classCDays?: number;
      approvalThreshold?: string;
      blind?: boolean;
      isActive?: boolean;
      note?: string | null;
    },
    actorId: string | null,
  ) {
    const schedule = await cc.findScheduleById(id);
    if (schedule === undefined) throw new CycleCountScheduleNotFoundError(id);
    await cc.updateSchedule(id, patch);
    await this.audit.record({
      action: "inventory.cycle_count_schedule_updated",
      entityType: "cycle_count_schedule",
      entityId: id,
      actorId: actorId ?? undefined,
      after: patch,
    });
    return cc.findScheduleById(id);
  }

  // -- ABC (§2.7) ----------------------------------------------------------------------

  /**
   * Recompute the ABC generation: one LATEST row per STOCK item
   * (consumption over the window; zero-consumption items land C). The
   * previous generation demotes wholesale — the latest row is the floor
   * the schedule run reads.
   */
  async recomputeAbc(input: {
    windowDays?: number;
    aPct?: string;
    bPct?: string;
    actorId: string | null;
  }): Promise<{ windowDays: number; a: number; b: number; c: number; totalConsumption: string }> {
    const windowDays = input.windowDays ?? ABC_DEFAULT_WINDOW_DAYS;
    if (windowDays < 1) {
      throw new AbcThresholdError(String(windowDays), "—");
    }
    const aPct = new Decimal(input.aPct ?? ABC_DEFAULT_A_PCT);
    const bPct = new Decimal(input.bPct ?? ABC_DEFAULT_B_PCT);
    if (aPct.lte(0) || aPct.gte(bPct) || bPct.gt(1)) {
      throw new AbcThresholdError(aPct.toFixed(2), bPct.toFixed(2));
    }
    const consumption = await cc.consumptionByItem(windowDays);
    const stockItems = await cc.listStockItemIds();
    const valueByItem = new Map(consumption.map((row) => [row.itemId, row]));
    const total = consumption.reduce(
      (sum, row) => sum.plus(new Decimal(row.consumptionValue)),
      new Decimal(0),
    );

    const computedAt = new Date().toISOString();
    const rows: Parameters<typeof cc.insertAbcRows>[0] = [];
    // The Pareto walk over ranked consumers (rank 1 = the biggest).
    let cumulative = new Decimal(0);
    let rank = 0;
    for (const row of consumption) {
      rank += 1;
      const value = new Decimal(row.consumptionValue);
      if (value.lte(0)) continue; // defensive: OUT aggregates are ≥ 0
      const share = total.gt(0) ? cumulative.plus(value).div(total) : new Decimal(1);
      cumulative = cumulative.plus(value);
      const cls = share.lte(aPct) ? "A" : share.lte(bPct) ? "B" : "C";
      rows.push({
        id: generateUuidV7(),
        itemId: row.itemId,
        computedAt,
        windowDays,
        cls,
        consumptionValue: value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        totalQtyOut: new Decimal(row.totalQtyOut).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
        velocity: new Decimal(row.totalQtyOut)
          .div(windowDays)
          .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
          .toFixed(6),
        rankNo: rank,
      });
    }
    // Zero-consumption + never-moved items: class C, ranked after every
    // consumer (rank continues; velocity 0).
    for (const itemId of stockItems) {
      if (valueByItem.has(itemId)) continue;
      rank += 1;
      rows.push({
        id: generateUuidV7(),
        itemId,
        computedAt,
        windowDays,
        cls: "C",
        consumptionValue: "0.0000",
        totalQtyOut: "0.000000",
        velocity: "0.000000",
        rankNo: rank,
      });
    }

    await cc.demoteLatestClassifications();
    await cc.insertAbcRows(rows, input.actorId);
    await this.audit.record({
      action: "inventory.abc_recomputed",
      entityType: "abc_classifications",
      entityId: rows[0]?.id ?? "00000000-0000-0000-0000-000000000000",
      actorId: input.actorId ?? undefined,
      after: {
        windowDays,
        aPct: aPct.toFixed(2),
        bPct: bPct.toFixed(2),
        items: rows.length,
        a: rows.filter((r) => r.cls === "A").length,
        b: rows.filter((r) => r.cls === "B").length,
        c: rows.filter((r) => r.cls === "C").length,
      },
    });
    return {
      windowDays,
      a: rows.filter((r) => r.cls === "A").length,
      b: rows.filter((r) => r.cls === "B").length,
      c: rows.filter((r) => r.cls === "C").length,
      totalConsumption: total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    };
  }

  async listAbc(filter: { cls?: string; limit?: number }) {
    return cc.listLatestAbc({ cls: filter.cls, limit: filter.limit ?? 500 });
  }

  // -- the schedule run (§2.6) -----------------------------------------------------------

  /**
   * Run a schedule: every stocked item of the warehouse whose class
   * interval elapsed since its last POSTED count (never counted = due)
   * joins ONE generated document, A-class first, capped at maxItems.
   * Lines are the live (bin, batch) slots; binless legacy items get one
   * whole-position line.
   */
  async runSchedule(
    scheduleId: string,
    input: { maxItems?: number; actorId: string | null },
  ): Promise<{ documentId: string | null; dueItems: number; lines: number }> {
    const schedule = await cc.findScheduleById(scheduleId);
    if (schedule === undefined) throw new CycleCountScheduleNotFoundError(scheduleId);
    if (!schedule.isActive) {
      throw new CycleCountScheduleStateError(`schedule ${scheduleId} is inactive`);
    }
    const maxItems = Math.min(Math.max(input.maxItems ?? 50, 1), 200);
    const warehouseId = schedule.warehouseId;

    const abc = await cc.listLatestAbc({ limit: 1000 });
    const classByItem = new Map(abc.map((row) => [row.itemId, row.cls]));
    const rankByItem = new Map(abc.map((row) => [row.itemId, row.rankNo]));

    const stocked = await cc.stockedItemIds(warehouseId);
    const itemIds = stocked.map((row) => row.itemId);
    const qtyByItem = new Map(stocked.map((row) => [row.itemId, row.qty]));
    const lastCounted = await cc.lastCountedDates(warehouseId, itemIds);
    const today = Date.now();
    const due = itemIds.filter((itemId) => {
      const cls = classByItem.get(itemId) ?? "C";
      const intervalDays = cls === "A" ? schedule.classADays : cls === "B" ? schedule.classBDays : schedule.classCDays;
      const last = lastCounted.get(itemId);
      if (last === undefined) return true;
      const elapsedDays = (today - Date.parse(`${last}T00:00:00Z`)) / 86_400_000;
      return elapsedDays >= intervalDays;
    });
    // A-class first (the class rank), then the ABC rank, then id for determinism.
    const classRank = (cls: string) => (cls === "A" ? 0 : cls === "B" ? 1 : 2);
    due.sort((a, b) => {
      const clsA = classByItem.get(a) ?? "C";
      const clsB = classByItem.get(b) ?? "C";
      if (classRank(clsA) !== classRank(clsB)) return classRank(clsA) - classRank(clsB);
      const rankA = rankByItem.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rankB = rankByItem.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b);
    });
    const selected = due.slice(0, maxItems);
    await cc.touchScheduleRun(scheduleId);
    if (selected.length === 0) {
      // Nothing due at this frequency — no empty documents (the nightly
      // re-run stays a no-op until an interval elapses).
      return { documentId: null, dueItems: 0, lines: 0 };
    }

    const documentId = await cc.insertCountDocument({
      scheduleId,
      warehouseId,
      blind: schedule.blind,
      note: `generated by schedule ${schedule.name}`,
      createdBy: input.actorId,
    });
    let lineNo = 0;
    let lines = 0;
    for (const itemId of selected) {
      const slots = await cc.binSlotsOfItem(warehouseId, itemId);
      if (slots.length === 0) {
        // The binless legacy grace: one whole-position line.
        await cc.insertCountLine({
          documentId,
          lineNo: ++lineNo,
          itemId,
          binId: null,
          batchId: null,
          systemQty: qtyByItem.get(itemId) ?? "0.000000",
          createdBy: input.actorId,
        });
        lines += 1;
        continue;
      }
      for (const slot of slots) {
        await cc.insertCountLine({
          documentId,
          lineNo: ++lineNo,
          itemId,
          binId: slot.binId,
          batchId: slot.batchId,
          systemQty: slot.qty,
          createdBy: input.actorId,
        });
        lines += 1;
      }
    }
    await this.audit.record({
      action: "inventory.cycle_count_document_generated",
      entityType: "cycle_count_document",
      entityId: documentId,
      actorId: input.actorId ?? undefined,
      after: { scheduleId, dueItems: due.length, selected: selected.length, lines },
    });
    return { documentId, dueItems: due.length, lines };
  }

  // -- manual documents (the count workspace parity) --------------------------------------

  /**
   * The nightly system pass (pg-boss `inventory.cycle-count-generate`):
   * every ACTIVE schedule of every ACTIVE tenant runs its due-items pass.
   * One UoW per tenant (ADR-0005) — a failure in one tenant never blocks
   * the rest. The class intervals make re-runs no-ops for freshly
   * counted items (the due check is the idempotency).
   */
  async runActiveSchedules(actorId: string | null): Promise<{
    tenants: number;
    schedules: number;
    documents: number;
  }> {
    const tenantIds = await listActiveTenantIds();
    let schedules = 0;
    let documents = 0;
    for (const tenantId of tenantIds) {
      const result = await withTenant(tenantId, async () => {
        const active = await cc.listSchedules({ activeOnly: true, limit: 200 });
        let docs = 0;
        for (const schedule of active) {
          try {
            const run = await this.runSchedule(schedule.id, { maxItems: 50, actorId });
            schedules += 1;
            if (run.dueItems > 0) docs += 1;
          } catch (error) {
            // A failing schedule never blocks the pass — the run's own
            // audit row records the state; the next night retries.
            if (error instanceof CycleCountScheduleNotFoundError) continue;
            throw error;
          }
        }
        return docs;
      });
      documents += result;
    }
    return { tenants: tenantIds.length, schedules, documents };
  }

  async createDocument(input: {
    warehouseId: string;
    itemIds: string[];
    blind: boolean;
    note: string | null;
    actorId: string | null;
  }) {
    const documentId = await cc.insertCountDocument({
      scheduleId: null,
      warehouseId: input.warehouseId,
      blind: input.blind,
      note: input.note,
      createdBy: input.actorId,
    });
    let lineNo = 0;
    for (const itemId of input.itemIds) {
      const slots = await cc.binSlotsOfItem(input.warehouseId, itemId);
      if (slots.length === 0) {
        const stockRow = await store.findItemStock(itemId, input.warehouseId);
        await cc.insertCountLine({
          documentId,
          lineNo: ++lineNo,
          itemId,
          binId: null,
          batchId: null,
          systemQty: stockRow?.qty ?? "0.000000",
          createdBy: input.actorId,
        });
        continue;
      }
      for (const slot of slots) {
        await cc.insertCountLine({
          documentId,
          lineNo: ++lineNo,
          itemId,
          binId: slot.binId,
          batchId: slot.batchId,
          systemQty: slot.qty,
          createdBy: input.actorId,
        });
      }
    }
    await this.audit.record({
      action: "inventory.cycle_count_document_created",
      entityType: "cycle_count_document",
      entityId: documentId,
      actorId: input.actorId ?? undefined,
      after: { warehouseId: input.warehouseId, items: input.itemIds.length },
    });
    return this.findDocument(documentId);
  }

  async listDocuments(filter: { warehouseId?: string; scheduleId?: string; status?: string; limit?: number }) {
    return cc.listCountDocuments({
      warehouseId: filter.warehouseId,
      scheduleId: filter.scheduleId,
      status: filter.status,
      limit: filter.limit ?? 100,
    });
  }

  async findDocument(id: string) {
    const doc = await cc.findCountDocumentById(id);
    if (doc === undefined) throw new CycleCountDocumentNotFoundError(id);
    return doc;
  }

  async lines(id: string) {
    await this.findDocument(id);
    return cc.listCountLines(id);
  }

  // -- the lifecycle (§2.6: DRAFT → COUNTED → VARIANCE_REVIEW → POSTED) ------------------

  async enterCounts(input: {
    documentId: string;
    entries: { lineNo: number; countedQty: string }[];
    actorId: string | null;
  }) {
    const doc = await this.findDocument(input.documentId);
    if (doc.status !== "DRAFT") {
      throw new CycleCountDocumentStateError(
        `cycle-count document ${input.documentId} is ${doc.status} — entry needs DRAFT`,
      );
    }
    const existing = await cc.listCountLines(input.documentId);
    for (const entry of input.entries) {
      const line = existing.find((row) => row.lineNo === entry.lineNo);
      if (line === undefined) throw new CycleCountLineNotFoundError(input.documentId, entry.lineNo);
      if (!/^\d+(\.\d{1,6})?$/.test(entry.countedQty) || Number(entry.countedQty) < 0) {
        throw new CycleCountDocumentStateError(
          `counted qty must be a non-negative decimal: ${entry.countedQty}`,
        );
      }
      await cc.setCountedQty({
        documentId: input.documentId,
        lineNo: entry.lineNo,
        countedQty: new Decimal(entry.countedQty).toFixed(6),
        recounted: false,
        recountNote: null,
      });
    }
    await this.audit.record({
      action: "inventory.cycle_count_lines_entered",
      entityType: "cycle_count_document",
      entityId: input.documentId,
      actorId: input.actorId ?? undefined,
      after: { entries: input.entries.length },
    });
  }

  async recountLine(input: {
    documentId: string;
    lineNo: number;
    countedQty: string;
    recountNote: string;
    actorId: string | null;
  }) {
    const doc = await this.findDocument(input.documentId);
    if (doc.status !== "DRAFT" && doc.status !== "COUNTED" && doc.status !== "VARIANCE_REVIEW") {
      throw new CycleCountDocumentStateError(
        `cycle-count document ${input.documentId} is ${doc.status} — recount needs DRAFT/COUNTED/VARIANCE_REVIEW`,
      );
    }
    if (input.recountNote.trim().length === 0) {
      throw new CycleCountDocumentStateError("a recount requires a note");
    }
    const existing = await cc.listCountLines(input.documentId);
    const line = existing.find((row) => row.lineNo === input.lineNo);
    if (line === undefined) throw new CycleCountLineNotFoundError(input.documentId, input.lineNo);
    await cc.setCountedQty({
      documentId: input.documentId,
      lineNo: input.lineNo,
      countedQty: new Decimal(input.countedQty).toFixed(6),
      recounted: true,
      recountNote: input.recountNote,
    });
    if (doc.status === "VARIANCE_REVIEW") {
      const refreshed = await this.varianceOf(input.documentId, doc.warehouseId);
      const flipped = await cc.refreshDocumentVariance({
        id: input.documentId,
        lossValue: refreshed.lossValue,
        gainValue: refreshed.gainValue,
      });
      if (!flipped) throw new CycleCountDocumentStateError(`document ${input.documentId} review raced`);
    }
    await this.audit.record({
      action: "inventory.cycle_count_line_recounted",
      entityType: "cycle_count_document",
      entityId: input.documentId,
      actorId: input.actorId ?? undefined,
      after: { lineNo: input.lineNo, countedQty: input.countedQty, note: input.recountNote },
    });
  }

  async submit(id: string, actorId: string | null) {
    const doc = await this.findDocument(id);
    if (doc.status !== "DRAFT") {
      throw new CycleCountDocumentStateError(`cycle-count document ${id} is ${doc.status} — only DRAFT submits`);
    }
    const lines = await cc.listCountLines(id);
    const uncounted = lines.filter((line) => line.countedQty === null);
    if (uncounted.length > 0) {
      throw new CycleCountDocumentStateError(
        `document ${id} has ${uncounted.length} uncounted lines — enter or recount them first`,
      );
    }
    const flipped = await cc.markDocumentSubmitted(id, actorId);
    if (!flipped) throw new CycleCountDocumentStateError(`document ${id} submit raced`);
    await this.audit.record({
      action: "inventory.cycle_count_submitted",
      entityType: "cycle_count_document",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.findDocument(id);
  }

  /** Per-LINE value impact at current valuation + the reason stamp; the
   * document's loss/gain totals land on the row (the approval reads them). */
  private async varianceOf(documentId: string, warehouseId: string) {
    const lines = await cc.listCountLines(documentId);
    const impacts: { lineNo: number; valueImpact: string; reason: string | null }[] = [];
    let lossValue = "0.0000";
    let gainValue = "0.0000";
    for (const line of lines) {
      const variance = new Decimal(line.countedQty!).minus(new Decimal(line.systemQty));
      if (variance.isZero()) {
        impacts.push({ lineNo: line.lineNo, valueImpact: "0.0000", reason: null });
        continue;
      }
      const stockRow = await store.findItemStock(line.itemId, warehouseId);
      const avg = new Decimal(stockRow?.avgCost ?? "0");
      const impact = variance.times(avg).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      const reason = variance.lt(0) ? "CYCLE_COUNT_LOSS" : "CYCLE_COUNT_GAIN";
      impacts.push({ lineNo: line.lineNo, valueImpact: impact, reason });
      if (variance.lt(0)) {
        lossValue = new Decimal(lossValue).plus(new Decimal(impact).abs()).toFixed(4);
      } else {
        gainValue = new Decimal(gainValue).plus(impact).toFixed(4);
      }
    }
    await cc.setValueImpacts({ documentId, impacts });
    return { lossValue, gainValue };
  }

  async review(id: string, actorId: string | null) {
    const doc = await this.findDocument(id);
    if (doc.status !== "COUNTED") {
      throw new CycleCountDocumentStateError(
        `cycle-count document ${id} is ${doc.status} — review needs COUNTED`,
      );
    }
    const variance = await this.varianceOf(id, doc.warehouseId);
    const flipped = await cc.markDocumentUnderReview({ id, ...variance });
    if (!flipped) throw new CycleCountDocumentStateError(`document ${id} review raced`);
    await this.audit.record({
      action: "inventory.cycle_count_variance_reviewed",
      entityType: "cycle_count_document",
      entityId: id,
      actorId: actorId ?? undefined,
      after: variance,
    });
    return this.findDocument(id);
  }

  /**
   * Approval → the adjustment posting (G-13/G-14 shapes, CYCLE_COUNT_*
   * reasons, BR-075's threshold gate): per-ITEM aggregated variance (Σ
   * counted − Σ system across the item's lines) — ONE move per item, ONE
   * balanced journal per document. INV-029 holds: the plans ride the
   * movement core, so bin_contents move in the SAME transaction.
   */
  async approve(input: { id: string; supervisor: boolean; actorId: string | null }) {
    const doc = await this.findDocument(input.id);
    if (doc.status !== "VARIANCE_REVIEW") {
      throw new CycleCountDocumentStateError(
        `cycle-count document ${input.id} is ${doc.status} — approval needs VARIANCE_REVIEW`,
      );
    }
    // BR-075: the schedule's threshold; manual documents fall back to the
    // sibling count workspace's tolerance setting.
    let threshold: string;
    if (doc.scheduleId !== null) {
      const schedule = await cc.findScheduleById(doc.scheduleId);
      if (schedule === undefined) throw new CycleCountScheduleNotFoundError(doc.scheduleId);
      threshold = schedule.approvalThreshold;
    } else {
      threshold = (await readEffectiveSetting<string>("inventory.count_variance_tolerance")) ?? "0.0000";
    }
    const lines = await cc.listCountLines(input.id);
    const overThreshold = lines.filter(
      (line) =>
        line.valueImpact !== null &&
        new Decimal(line.valueImpact).abs().gt(new Decimal(threshold)) &&
        !line.recounted,
    );
    if (overThreshold.length > 0 && !input.supervisor) {
      throw new CycleCountThresholdError({
        documentId: input.id,
        overThreshold: overThreshold.length,
        threshold,
      });
    }

    // Aggregate per item: the posting unit is the ITEM (one move), the
    // lines keep the bin granularity of the sheet.
    const varianceByItem = new Map<string, Decimal>();
    for (const line of lines) {
      const variance = new Decimal(line.countedQty ?? line.systemQty).minus(new Decimal(line.systemQty));
      varianceByItem.set(line.itemId, (varianceByItem.get(line.itemId) ?? new Decimal(0)).plus(variance));
    }

    const postingDate = today();
    const lossPlans: { plan: Awaited<ReturnType<typeof planIssue>> }[] = [];
    const gainPlans: { plan: Awaited<ReturnType<typeof planReceipt>> }[] = [];
    for (const [itemId, variance] of varianceByItem) {
      if (variance.isZero()) continue;
      if (variance.lt(0)) {
        const plan = await planIssue({
          itemId,
          warehouseId: doc.warehouseId,
          qty: variance.abs().toFixed(6),
          movedAt: postingDate,
          moveKind: "adjust",
          sourceType: "cycle_count",
          sourceId: input.id,
          reason: "CYCLE_COUNT_LOSS",
        });
        lossPlans.push({ plan });
      } else {
        const stockRow = await store.findItemStock(itemId, doc.warehouseId);
        const plan = await planReceipt({
          itemId,
          warehouseId: doc.warehouseId,
          qty: variance.toFixed(6),
          unitCost: stockRow?.avgCost ?? "0.000000",
          movedAt: postingDate,
          moveKind: "adjust",
          sourceType: "cycle_count",
          sourceId: input.id,
          reason: "CYCLE_COUNT_GAIN",
        });
        gainPlans.push({ plan });
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

    const inventoryAccount = await resolveInventoryAccount(doc.warehouseId);
    const journalLines: JournalLineSpec[] = [];
    if (Number(lossTotal) !== 0) {
      journalLines.push(
        {
          purpose: "INVENTORY_SHRINKAGE",
          direction: "DEBIT",
          amount: lossTotal,
          memo: { en: "Cycle-count variance — shrinkage", ar: "فرق الجرد الدوري — هالك" },
        },
        {
          accountId: inventoryAccount,
          direction: "CREDIT",
          amount: lossTotal,
          memo: { en: "Cycle-count variance — shrinkage", ar: "فرق الجرد الدوري — هالك" },
        },
      );
    }
    if (Number(gainTotal) !== 0) {
      journalLines.push(
        {
          accountId: inventoryAccount,
          direction: "DEBIT",
          amount: gainTotal,
          memo: { en: "Cycle-count variance — appreciation", ar: "فرق الجرد الدوري — زيادة" },
        },
        {
          purpose: "INVENTORY_APPRECIATION",
          direction: "CREDIT",
          amount: gainTotal,
          memo: { en: "Cycle-count variance — appreciation", ar: "فرق الجرد الدوري — زيادة" },
        },
      );
    }

    let journalEntryId: string | null = null;
    let entryNo: string | null = null;
    if (journalLines.length > 0) {
      const spec: JournalSpec = {
        source: { docType: "cycle_count", docId: input.id, operation: "post" },
        entryDate: postingDate,
        description: {
          en: `Cycle-count adjustment — ${doc.warehouseCode ?? doc.warehouseId}`,
          ar: `تسوية الجرد الدوري — ${doc.warehouseCode ?? doc.warehouseId}`,
        },
        currency: await ownTenantBaseCurrency(),
        lines: journalLines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = result.journalEntryId;
      entryNo = result.entryNo;
    }

    for (const row of lossPlans) {
      await applyIssue(row.plan, journalEntryId);
    }
    for (const row of gainPlans) {
      await applyReceipt(row.plan, journalEntryId);
    }

    const acquired = await this.numbering.reserve({
      docType: "cycle_count",
      branchId: null,
      periodKey: postingDate.slice(0, 4),
      format: "CC-{YYYY}-{SEQ:6}",
      prefix: "CC",
      year: postingDate.slice(0, 4),
    });
    const flipped = await cc.markDocumentPosted({
      id: input.id,
      countNo: acquired.number,
      countDate: postingDate,
      approvedBy: input.actorId,
      supervisorOverride: input.supervisor,
      postedJournalId: journalEntryId,
    });
    if (!flipped) throw new CycleCountDocumentStateError(`document ${input.id} approval raced`);
    await this.audit.record({
      action: "inventory.cycle_count_posted",
      entityType: "cycle_count_document",
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
    return {
      countNo: acquired.number,
      journalEntryId,
      entryNo,
      lossValue: lossTotal,
      gainValue: gainTotal,
    };
  }

  async cancel(id: string, actorId: string | null) {
    const doc = await this.findDocument(id);
    if (doc.status !== "DRAFT") {
      throw new CycleCountDocumentStateError(`only DRAFT cycle-count documents cancel — ${id} is ${doc.status}`);
    }
    const cancelled = await cc.cancelDocument(id);
    if (!cancelled) throw new CycleCountDocumentStateError(`document ${id} cancel raced`);
    await this.audit.record({
      action: "inventory.cycle_count_cancelled",
      entityType: "cycle_count_document",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
