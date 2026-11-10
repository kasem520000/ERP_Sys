import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  planIssue,
  applyIssue,
  planReceipt,
  applyReceipt,
  resolveInventoryAccount,
  requireActiveWarehouse,
  stagePendingOverlay,
  type IssuePlan,
  type ReceiptPlan,
} from "../../inventory/application/movement-core";
import { TrackingService } from "../../inventory/application/tracking-service";
import { InboxService } from "../../notifications/application/inbox-service";
import {
  RESOLVE_EFFECTIVE_CONFIG_SERVICE,
  ResolveEffectiveConfigService,
} from "../../configuration/application/resolve/resolve-service";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/manufacturing.store";
import type { BomRow } from "../infrastructure/manufacturing.store";
import type { ProductionOrderRow } from "../infrastructure/manufacturing.store";
import { BomService } from "./bom-service";
import {
  BomNotFoundError,
  BomRequiredError,
  CompleteWithoutConsumptionError,
  ConsumptionNotPlannedError,
  FgShelfLifeRequiredError,
  OrderNotCancelableError,
  ProductionCostRoundingError,
  ProductionOrderInputInvalidError,
  ProductionOrderItemNotStockError,
  ProductionOrderNotFoundError,
  ProductionOrderStateError,
  ScrapExceedsWipError,
  ScrapReasonRequiredError,
} from "../domain/manufacturing-errors";

/**
 * Production order service (PHASE-018 T38b; MASTER-PLAN §1/§2/§3/§5): the
 * order lifecycle DRAFT → RELEASED (PRD number + BOM version bind + frozen
 * level-1 explosion snapshot) → IN_PROGRESS → COMPLETED / CANCELLED, with
 * the three posting legs (consume / scrap / complete) through the
 * centralized engine (ADR-0007) and every stock row through the movement
 * core (MODULE_BOUNDARIES — never a direct inventory/accounting write).
 *
 * Journals (source `production_order`):
 *   consume_N  DR WIP (purpose) · CR inventory (materials-warehouse account)
 *              — ONE journal per consume call, operation seq =
 *              countProductionConsumptions+1 (unique per event — INV-013's
 *              idempotency key must never collide across two consume calls;
 *              a multi-slice consume inserts several rows, so the seq only
 *              needs uniqueness, not contiguity). NOTE: the stored operation
 *              is `consume_<seq>` — journal_entries' ck_operation_shape
 *              forbids colons (the master plan's `consume:<seq>` spelling
 *              is adapted 1:1 to the schema).
 *   scrap_N    DR PRODUCTION_SCRAP · CR WIP — value ≤ running WIP balance,
 *              NO stock move (stock already left at consumption).
 *   complete   DR FG inventory · CR WIP (materials) · [CR PRODUCTION_LABOR ·
 *              CR PRODUCTION_OVERHEAD when the rates > 0] — FG receipt via
 *              planReceipt/applyReceipt (new batch, expiry = completedAt +
 *              shelf_life_days when the policy derives one), per-order WIP
 *              nets to EXACTLY zero.
 *
 * Variance review (MASTER-PLAN §5): after each consume, cumulative actual vs
 * the frozen plan; beyond planned × (1 + threshold/100) the line flags
 * over_plan ONCE + one inbox notification (dedupeKey) — consumption is NEVER
 * blocked. Idempotent replays (INV-013): release-on-RELEASED is a no-op
 * returning the current order (no second number); complete-on-COMPLETED
 * returns the stored completion result recomputed from the order row (no
 * second journal/batch). Policies come from the resolved effective config's
 * `config.policies` map — the four manufacturing keys are ALWAYS present
 * (T37's proof: SETTINGS_REGISTRY defaults ride into every tenant).
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const RATE_RE = /^\d+(\.\d{1,6})?$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Canonical rounding quanta (ADR-0009): qty/cost 6dp, money 4dp, half-up. */
function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}
function round4(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** UTC date math (deterministic — never rides the host clock/tz). */
function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** The four manufacturing policies (MASTER-PLAN §6) off `config.policies`. */
export interface MfgPolicies {
  qcGate: "required" | "off";
  scrapReasonRequired: boolean;
  expiryFromShelfLife: boolean;
  varianceThresholdPct: number;
}

export interface CreateProductionOrderInput {
  branchId: string;
  itemId: string;
  /** Explicit recipe version to bind at release; null = the item's ACTIVE. */
  bomId?: string | null;
  plannedQty: string;
  plannedDate?: string | null;
  materialsWarehouseId: string;
  fgWarehouseId: string;
  laborRate?: string | null;
  overheadRate?: string | null;
  costCenterId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

export interface UpdateProductionOrderInput {
  bomId?: string | null;
  plannedQty?: string;
  plannedDate?: string | null;
  materialsWarehouseId?: string;
  fgWarehouseId?: string;
  laborRate?: string | null;
  overheadRate?: string | null;
  costCenterId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

export interface ConsumeLineInput {
  itemId: string;
  qty: string;
  batchId?: string | null;
}

/** The completion result (complete + the INV-013 replay recomputation). */
export interface CompletionResult {
  order: ProductionOrderRow;
  journalEntryId: string | null;
  batchId: string | null;
  batchNo: string | null;
  expiry: string | null;
  fgValue: string;
  wipCredit: string;
  labor: string;
  overhead: string;
}

@Injectable()
export class ProductionOrderService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject — the vitest/esbuild
    // pipeline does not emit design:paramtypes, so bare type-annotated
    // params resolve to undefined holes (the JobCardService silent-undefined
    // precedent). All tokens are exported by the imported modules.
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(BomService) private readonly boms: BomService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(TrackingService) private readonly tracking: TrackingService,
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(RESOLVE_EFFECTIVE_CONFIG_SERVICE)
    private readonly resolveConfig: ResolveEffectiveConfigService,
  ) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<ProductionOrderRow> {
    return this.requireOrder(id);
  }

  async list(filter: { status?: string; itemId?: string; limit: number }): Promise<ProductionOrderRow[]> {
    return store.listProductionOrders(filter);
  }

  /** The full order shape: header + frozen plan + consumptions + scraps +
   * the completion summary (the fg fields + batch provenance). */
  async get(id: string): Promise<{
    order: ProductionOrderRow;
    lines: store.ProductionOrderLineRow[];
    consumptions: store.ProductionConsumptionRow[];
    scraps: store.ProductionScrapRow[];
    completion: Omit<CompletionResult, "order">;
  }> {
    const order = await this.requireOrder(id);
    return {
      order,
      lines: await store.listProductionOrderLines(id),
      consumptions: await store.listProductionConsumptions(id),
      scraps: await store.listProductionScraps(id),
      completion: await this.completionSummary(order),
    };
  }

  // -- create (DRAFT; NO number yet — release reserves it) ------------------------

  async create(input: CreateProductionOrderInput): Promise<ProductionOrderRow> {
    const plannedQty = this.canonicalPositiveQty(input.plannedQty, "plannedQty");
    const laborRate = this.canonicalRate(input.laborRate ?? "0", "laborRate");
    const overheadRate = this.canonicalRate(input.overheadRate ?? "0", "overheadRate");
    this.assertDate(input.plannedDate ?? null, "plannedDate");
    const item = await this.requireProductionItem(input.itemId);
    await requireActiveWarehouse(input.materialsWarehouseId);
    await requireActiveWarehouse(input.fgWarehouseId);
    if (input.bomId !== null && input.bomId !== undefined) {
      const bom = await this.boms.find(input.bomId);
      if (bom.itemId !== input.itemId) {
        throw new BomNotFoundError(`bill of materials ${input.bomId} is not a version of item ${input.itemId}`);
      }
    }
    const created = await store.insertProductionOrder({
      branchId: input.branchId,
      itemId: input.itemId,
      uomId: item.baseUomId,
      plannedQty,
      plannedDate: input.plannedDate ?? null,
      materialsWarehouseId: input.materialsWarehouseId,
      fgWarehouseId: input.fgWarehouseId,
      laborRate,
      overheadRate,
      costCenterId: input.costCenterId ?? null,
      bomId: input.bomId ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "manufacturing.production_order.created",
      entityType: "production_order",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        plannedQty,
        status: "DRAFT",
        materialsWarehouseId: input.materialsWarehouseId,
        fgWarehouseId: input.fgWarehouseId,
      },
    });
    return created;
  }

  // -- update (DRAFT-only; same validations) --------------------------------------

  async update(id: string, input: UpdateProductionOrderInput): Promise<ProductionOrderRow> {
    const order = await this.requireOrder(id);
    if (order.status !== "DRAFT") {
      throw new ProductionOrderStateError(
        `production order ${order.orderNo ?? id} is ${order.status} — only DRAFT orders accept edits`,
        { orderId: id, from: order.status, to: "DRAFT-edit" },
      );
    }
    const plannedQty = input.plannedQty !== undefined ? this.canonicalPositiveQty(input.plannedQty, "plannedQty") : undefined;
    // null rate input = reset to the 0 default; absent = keep (rates are
    // NOT NULL DEFAULT 0 — clearing means zeroing).
    const laborRate =
      input.laborRate === undefined ? undefined : this.canonicalRate(input.laborRate ?? "0", "laborRate");
    const overheadRate =
      input.overheadRate === undefined ? undefined : this.canonicalRate(input.overheadRate ?? "0", "overheadRate");
    this.assertDate(input.plannedDate ?? null, "plannedDate");
    if (input.materialsWarehouseId !== undefined) await requireActiveWarehouse(input.materialsWarehouseId);
    if (input.fgWarehouseId !== undefined) await requireActiveWarehouse(input.fgWarehouseId);
    if (input.bomId !== undefined && input.bomId !== null) {
      const bom = await this.boms.find(input.bomId);
      if (bom.itemId !== order.itemId) {
        throw new BomNotFoundError(`bill of materials ${input.bomId} is not a version of item ${order.itemId}`);
      }
    }
    await store.patchProductionOrder({
      id,
      // null bomId on a DRAFT edit = keep (release re-resolves the ACTIVE
      // version only when the order never carried an explicit one).
      bomId: input.bomId === null ? undefined : input.bomId,
      plannedQty,
      plannedDate: input.plannedDate,
      materialsWarehouseId: input.materialsWarehouseId,
      fgWarehouseId: input.fgWarehouseId,
      laborRate,
      overheadRate,
      costCenterId: input.costCenterId,
      note: input.note,
      noteAr: input.noteAr,
    });
    await this.audit.record({
      action: "manufacturing.production_order.updated",
      entityType: "production_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        fields: Object.keys(input).filter((key) => key !== "actorId"),
      },
    });
    return this.requireOrder(id);
  }

  // -- release (DRAFT → RELEASED: number + BOM bind + level-1 snapshot) -----------

  async release(id: string, actorId: string | null): Promise<ProductionOrderRow> {
    const order = await this.requireOrder(id);
    if (order.status === "RELEASED") {
      return order; // INV-013 idempotent replay — no second number
    }
    if (order.status !== "DRAFT") {
      throw new ProductionOrderStateError(
        `production order ${order.orderNo ?? id} is ${order.status} — only DRAFT orders release`,
        { orderId: id, from: order.status, to: "RELEASED" },
      );
    }

    // Resolve the version: the order's explicit bomId, else the item's ACTIVE
    // (none → the typed 422 — release is impossible without a recipe).
    let bom: BomRow;
    if (order.bomId !== null) {
      bom = await this.boms.find(order.bomId);
      if (bom.itemId !== order.itemId) {
        throw new BomNotFoundError(`bill of materials ${order.bomId} is not a version of item ${order.itemId}`);
      }
    } else {
      const active = await store.findActiveBom(order.itemId);
      if (active === undefined) throw new BomRequiredError(order.itemId);
      bom = active;
    }

    // The frozen level-1 snapshot (MASTER-PLAN §3): gross = round6(planned ×
    // qtyPerOutput × (1 + scrap/100) ÷ (yield/100)) — the SAME formula as
    // BomService.explode's level 1; deeper levels belong to chained
    // semi-finished orders, never this order.
    const bomLines = await store.listBomLines(bom.id);
    const yieldDivisor = new Decimal(bom.yieldPct).div(100);
    const planned = new Decimal(order.plannedQty);
    const snapshot: store.ProductionOrderLineInsert[] = [];
    for (const line of bomLines) {
      const component = await store.findItemForProduction(line.componentItemId);
      if (component === undefined || component.deletedAt !== null) {
        throw new BomNotFoundError(`component ${line.componentItemId} does not exist in this tenant`);
      }
      const gross = round6(
        planned
          .times(new Decimal(line.qtyPerOutput))
          .times(new Decimal(line.scrapPct).plus(100).div(100))
          .div(yieldDivisor),
      );
      snapshot.push({
        componentItemId: line.componentItemId,
        uomId: component.baseUomId,
        plannedQty: gross.toFixed(6),
        scrapPct: line.scrapPct,
        note: line.note,
        noteAr: line.noteAr,
      });
    }
    await store.insertProductionOrderLines(id, snapshot);

    // PRD number (INV-021): reserve + bind at release, per branch, year key.
    const year = today().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: "production_order",
      branchId: order.branchId,
      periodKey: year,
      format: "PRD-{YYYY}-{SEQ:5}",
      prefix: "PRD",
      year,
    });
    await this.numbering.bind("production_order", acquired.number, id);

    await store.patchProductionOrder({
      id,
      status: "RELEASED",
      orderNo: acquired.number,
      bomId: bom.id,
      yieldSnapshot: bom.yieldPct,
    });
    await this.audit.record({
      action: "manufacturing.production_order.released",
      entityType: "production_order",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: {
        status: "RELEASED",
        orderNo: acquired.number,
        bomId: bom.id,
        bomVersionNo: bom.versionNo,
        yieldPct: bom.yieldPct,
        lines: snapshot.length,
        lineQuantities: snapshot.map((line) => line.plannedQty),
      },
    });
    return this.requireOrder(id);
  }

  // -- start (RELEASED → IN_PROGRESS) ----------------------------------------------

  async start(id: string, actorId: string | null): Promise<ProductionOrderRow> {
    const order = await this.requireOrder(id);
    if (order.status !== "RELEASED") {
      throw new ProductionOrderStateError(
        `production order ${order.orderNo ?? id} is ${order.status} — only RELEASED orders start`,
        { orderId: id, from: order.status, to: "IN_PROGRESS" },
      );
    }
    await store.patchProductionOrder({ id, status: "IN_PROGRESS" });
    await this.audit.record({
      action: "manufacturing.production_order.started",
      entityType: "production_order",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "RELEASED" },
      after: { status: "IN_PROGRESS", orderNo: order.orderNo },
    });
    return this.requireOrder(id);
  }

  // -- consume (IN_PROGRESS; ONE journal per call; slices → rows) -------------------

  async consume(
    id: string,
    input: {
      lines: readonly ConsumeLineInput[];
      consumedAt?: string | null;
      note?: string | null;
      noteAr?: string | null;
      actorId: string | null;
    },
  ): Promise<{
    order: ProductionOrderRow;
    journalEntryId: string;
    consumptions: store.ProductionConsumptionRow[];
  }> {
    const order = await this.requireOrder(id);
    if (order.status !== "IN_PROGRESS") {
      throw new ProductionOrderStateError(
        `production order ${order.orderNo ?? id} is ${order.status} — materials are consumed on IN_PROGRESS orders only`,
        { orderId: id, from: order.status, to: "consume" },
      );
    }
    if (input.lines.length < 1 || input.lines.length > 200) {
      throw new ProductionOrderInputInvalidError(`a consumption carries 1..200 lines — got ${input.lines.length}`);
    }
    const consumedAt = input.consumedAt ?? today();
    this.assertDate(consumedAt, "consumedAt");

    // Only released components are consumable (the frozen plan is the legal
    // issue set — corrections are adjusted consumptions of planned items).
    const plannedLines = await store.listProductionOrderLines(id);
    const plannedByItem = new Map(plannedLines.map((line) => [line.componentItemId, line]));
    for (const line of input.lines) {
      this.canonicalPositiveQty(line.qty, "consume qty");
      if (!plannedByItem.has(line.itemId)) {
        throw new ConsumptionNotPlannedError(id, line.itemId);
      }
    }

    // PLAN every line up front (multi-line same-item correctness: each plan
    // sees the prior plans' pending position — stagePendingOverlay), then
    // ONE journal for the whole call, then apply + record per slice.
    const policies = await this.mfgPolicies();
    const plans: { line: ConsumeLineInput; plan: IssuePlan }[] = [];
    for (const line of input.lines) {
      const plan = await planIssue({
        itemId: line.itemId,
        warehouseId: order.materialsWarehouseId,
        qty: line.qty,
        movedAt: consumedAt,
        moveKind: "issue",
        sourceType: "production_order",
        sourceId: id,
        batchId: line.batchId ?? null,
        memo: `Production order ${order.orderNo ?? id} — material consumption`,
        memoAr: `أمر إنتاج ${order.orderNo ?? id} — استهلاك مواد`,
      });
      plans.push({ line, plan });
      stagePendingOverlay(plan);
    }

    const totalValue = plans
      .reduce((sum, { plan }) => sum.plus(new Decimal(plan.valueAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (totalValue.lessThanOrEqualTo(0)) {
      throw new ProductionOrderInputInvalidError(
        `consumption of production order ${order.orderNo ?? id} values to zero — nothing to post`,
      );
    }
    const inventoryAccount = await resolveInventoryAccount(order.materialsWarehouseId);
    // CRITICAL: the operation seq is unique per consume EVENT — a fixed
    // "consume" would collide on the second call (ALREADY_POSTED replay of
    // the FIRST journal). count+1 is unique because the count only grows.
    // (Underscore spelling — ck_journal_entries_operation_shape forbids
    // colons.)
    const seq = (await store.countProductionConsumptions(id)) + 1;
    const lines: JournalLineSpec[] = [
      {
        purpose: "WIP",
        direction: "DEBIT",
        amount: totalValue.toFixed(4),
        memo: {
          en: `Production order ${order.orderNo ?? id} — materials to WIP`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — مواد إلى تحت التشغيل`,
        },
      },
      {
        accountId: inventoryAccount,
        direction: "CREDIT",
        amount: totalValue.toFixed(4),
        memo: {
          en: `Production order ${order.orderNo ?? id} — materials issued from store`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — صرف مواد من المخزن`,
        },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "production_order", docId: id, operation: `consume_${seq}` },
      entryDate: consumedAt,
      description: {
        en: `Production order ${order.orderNo ?? id} — material consumption`,
        ar: `أمر إنتاج ${order.orderNo ?? id} — استهلاك المواد`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });

    for (const plan of plans.map((entry) => entry.plan)) {
      await applyIssue(plan, posted.journalEntryId);
      // One production_consumptions row per SLICE (batch-granular — the
      // genealogy upstream edges); a non-tracked item yields a single
      // batch-null slice, so the row shape is uniform.
      const rows: Parameters<typeof store.insertProductionConsumptions>[0] = plan.slices.map((slice) => ({
        orderId: id,
        itemId: plan.itemId,
        batchId: slice.batchId,
        qty: slice.qty,
        unitCost: slice.unitCost,
        value: slice.valueAmount,
        journalId: posted.journalEntryId,
        consumedAt,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: input.actorId,
      }));
      if (rows.length > 0) await store.insertProductionConsumptions(rows);
    }

    // Cumulative actual + the §5 variance review (flag ONCE + one inbox
    // notification; NEVER blocked). The cumulative map keeps same-item
    // repeat lines within one call correct.
    const cumulative = new Map<string, Decimal>(
      plannedLines.map((line) => [line.componentItemId, new Decimal(line.actualQty)]),
    );
    for (const { line } of plans) {
      const plannedLine = plannedByItem.get(line.itemId)!;
      const actual = (cumulative.get(line.itemId) ?? new Decimal(0)).plus(new Decimal(line.qty));
      cumulative.set(line.itemId, actual);
      let overPlan: boolean | undefined;
      if (!plannedLine.overPlan) {
        const limit = new Decimal(plannedLine.plannedQty).times(
          new Decimal(policies.varianceThresholdPct).plus(100).div(100),
        );
        if (actual.greaterThan(limit)) {
          overPlan = true;
          await this.inbox.record({
            category: "stock",
            severity: "warning",
            title: {
              en: "Consumption over plan",
              ar: "استهلاك يتجاوز الخطة",
            },
            body: {
              en: `Production order ${order.orderNo ?? id}: cumulative consumption of a component exceeded the plan by more than ${policies.varianceThresholdPct}% — review the order.`,
              ar: `أمر الإنتاج ${order.orderNo ?? id}: تجاوز الاستهلاك التراكمي لأحد المكونات الخطة بأكثر من ${policies.varianceThresholdPct}٪ — راجع الأمر.`,
            },
            actionUrl: "/manufacturing/orders",
            dedupeKey: `mfg-consumption-variance:${id}:${line.itemId}`,
          });
        }
      }
      await store.patchProductionOrderLine({
        id: plannedLine.id,
        actualQty: round6(actual).toFixed(6),
        ...(overPlan === undefined ? {} : { overPlan }),
      });
    }

    await this.audit.record({
      action: "manufacturing.production_order.consumed",
      entityType: "production_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        orderNo: order.orderNo,
        lines: plans.length,
        value: totalValue.toFixed(4),
        journalEntryId: posted.journalEntryId,
        consumedAt,
      },
    });
    return {
      order: await this.requireOrder(id),
      journalEntryId: posted.journalEntryId,
      consumptions: await store.listProductionConsumptions(id),
    };
  }

  // -- scrap (IN_PROGRESS; DR PRODUCTION_SCRAP · CR WIP; NO stock move) -------------

  async scrap(
    id: string,
    input: {
      qty: string;
      reasonCode?: string | null;
      value: string;
      scrappedAt?: string | null;
      note?: string | null;
      noteAr?: string | null;
      actorId: string | null;
    },
  ): Promise<{ order: ProductionOrderRow; journalEntryId: string; scrap: store.ProductionScrapRow }> {
    const order = await this.requireOrder(id);
    if (order.status !== "IN_PROGRESS") {
      throw new ProductionOrderStateError(
        `production order ${order.orderNo ?? id} is ${order.status} — WIP is scrapped on IN_PROGRESS orders only`,
        { orderId: id, from: order.status, to: "scrap" },
      );
    }
    this.canonicalPositiveQty(input.qty, "scrap qty");
    if (!MONEY_RE.test(input.value) || new Decimal(input.value).lessThanOrEqualTo(0)) {
      throw new ProductionOrderInputInvalidError(`scrap value must be a positive decimal (≤ 4dp): ${input.value}`);
    }
    const value = round4(new Decimal(input.value)).toFixed(4);
    const policies = await this.mfgPolicies();
    let reasonCode = (input.reasonCode ?? "").trim();
    if (reasonCode === "") {
      if (policies.scrapReasonRequired) {
        throw new ScrapReasonRequiredError();
      }
      // The column is NOT NULL — policy-off scrap without a reason carries
      // the explicit placeholder (the audit + journal still tell the story).
      reasonCode = "UNSPECIFIED";
    }
    if (reasonCode.length > 40) {
      throw new ProductionOrderInputInvalidError(`scrap reasonCode must be 1..40 chars — got ${reasonCode.length}`);
    }
    const balance = await store.sumOrderWip(id);
    if (new Decimal(value).greaterThan(new Decimal(balance))) {
      throw new ScrapExceedsWipError({ balance, requested: value });
    }
    const scrappedAt = input.scrappedAt ?? today();
    this.assertDate(scrappedAt, "scrappedAt");
    const seq = (await store.countProductionScraps(id)) + 1;
    const lines: JournalLineSpec[] = [
      {
        purpose: "PRODUCTION_SCRAP",
        direction: "DEBIT",
        amount: value,
        memo: {
          en: `Production order ${order.orderNo ?? id} — WIP scrap (${reasonCode})`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — تالف تحت التشغيل (${reasonCode})`,
        },
      },
      {
        purpose: "WIP",
        direction: "CREDIT",
        amount: value,
        memo: {
          en: `Production order ${order.orderNo ?? id} — WIP scrap (${reasonCode})`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — تالف تحت التشغيل (${reasonCode})`,
        },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "production_order", docId: id, operation: `scrap_${seq}` },
      entryDate: scrappedAt,
      description: {
        en: `Production order ${order.orderNo ?? id} — WIP scrap (${reasonCode})`,
        ar: `أمر إنتاج ${order.orderNo ?? id} — تالف تحت التشغيل (${reasonCode})`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    const scrap = await store.insertProductionScrap({
      orderId: id,
      reasonCode,
      qty: this.canonicalPositiveQty(input.qty, "scrap qty"),
      value,
      journalId: posted.journalEntryId,
      scrappedAt,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "manufacturing.production_order.scrapped",
      entityType: "production_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        orderNo: order.orderNo,
        reasonCode,
        qty: scrap.qty,
        value,
        journalEntryId: posted.journalEntryId,
        wipBalanceAfter: await store.sumOrderWip(id),
      },
    });
    return { order: await this.requireOrder(id), journalEntryId: posted.journalEntryId, scrap };
  }

  // -- complete (IN_PROGRESS → COMPLETED; FG receipt + the multi-credit journal) ----

  async complete(
    id: string,
    input: { actualQty: string; batchNo?: string | null; completedAt?: string | null; actorId: string | null },
  ): Promise<CompletionResult> {
    let order = await this.requireOrder(id);
    if (order.status === "COMPLETED") {
      // INV-013 idempotent replay: the stored result, recomputed from the
      // order row (+ the batch row) — NO second journal, NO second batch.
      return { order, ...(await this.completionSummary(order)) };
    }
    if (order.status !== "IN_PROGRESS") {
      throw new ProductionOrderStateError(
        `production order ${order.orderNo ?? id} is ${order.status} — only IN_PROGRESS orders complete`,
        { orderId: id, from: order.status, to: "COMPLETED" },
      );
    }
    const consumptionCount = await store.countProductionConsumptions(id);
    if (consumptionCount === 0) throw new CompleteWithoutConsumptionError(id);
    const actualQty = this.canonicalPositiveQty(input.actualQty, "actualQty");
    const completedAt = input.completedAt ?? today();
    this.assertDate(completedAt, "completedAt");
    const policies = await this.mfgPolicies();
    const item = await this.requireProductionItem(order.itemId);

    // The cost stack: WIP balance (materials net of scrap) + absorbed labor
    // + absorbed overhead — per-order WIP nets to EXACTLY zero at completion.
    const wipBalance = await store.sumOrderWip(id);
    const laborValue = round4(new Decimal(actualQty).times(new Decimal(order.laborRate))).toFixed(4);
    const overheadValue = round4(new Decimal(actualQty).times(new Decimal(order.overheadRate))).toFixed(4);
    const fgValue = round4(
      new Decimal(wipBalance).plus(new Decimal(laborValue)).plus(new Decimal(overheadValue)),
    ).toFixed(4);
    if (new Decimal(fgValue).lessThanOrEqualTo(0)) {
      throw new ProductionOrderInputInvalidError(
        `completion of production order ${order.orderNo ?? id} values to ${fgValue} — the FG value must be positive`,
        { fgValue, wipBalance, laborValue, overheadValue },
      );
    }
    const unitCost = round6(new Decimal(fgValue).div(new Decimal(actualQty))).toFixed(6);
    const reconstitution = round4(new Decimal(unitCost).times(new Decimal(actualQty))).toFixed(4);
    if (reconstitution !== fgValue) {
      // Honest fail-closed: a 6dp unit cost that cannot represent the FG
      // value at 4dp would strand a rounding residue in WIP.
      throw new ProductionCostRoundingError({ fgValue, unitCost, qty: actualQty });
    }

    // FG batch + expiry: the batch number defaults to the order number; the
    // expiry derives from shelf life when the policy is on (an expiry-tracked
    // item with no shelf life under the policy fails closed).
    const batchNo = item.trackBatch ? (input.batchNo ?? order.orderNo) : null;
    let expiry: string | null = null;
    if (policies.expiryFromShelfLife) {
      if (item.shelfLifeDays !== null) {
        expiry = addDaysIso(completedAt, item.shelfLifeDays);
      } else if (item.hasExpiry) {
        throw new FgShelfLifeRequiredError(item.id, completedAt);
      }
    }

    const receiptPlan: ReceiptPlan = await planReceipt({
      itemId: order.itemId,
      warehouseId: order.fgWarehouseId,
      qty: actualQty,
      unitCost,
      movedAt: completedAt,
      moveKind: "receipt",
      sourceType: "production_order",
      sourceId: id,
      batchNo,
      batchExpiry: expiry,
      memo: `Production order ${order.orderNo ?? id} — finished goods receipt`,
      memoAr: `أمر إنتاج ${order.orderNo ?? id} — استلام الإنتاج التام`,
    });

    const lines: JournalLineSpec[] = [
      {
        accountId: await resolveInventoryAccount(order.fgWarehouseId),
        direction: "DEBIT",
        amount: fgValue,
        memo: {
          en: `Production order ${order.orderNo ?? id} — finished goods at ${unitCost}/unit`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — إنتاج تام بسعر ${unitCost}/وحدة`,
        },
      },
      {
        purpose: "WIP",
        direction: "CREDIT",
        amount: wipBalance,
        memo: {
          en: `Production order ${order.orderNo ?? id} — WIP to finished goods`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — من تحت التشغيل إلى الإنتاج التام`,
        },
      },
    ];
    if (new Decimal(laborValue).greaterThan(0)) {
      lines.push({
        purpose: "PRODUCTION_LABOR",
        direction: "CREDIT",
        amount: laborValue,
        memo: {
          en: `Production order ${order.orderNo ?? id} — applied production labor`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — أجور إنتاج مطبقة`,
        },
      });
    }
    if (new Decimal(overheadValue).greaterThan(0)) {
      lines.push({
        purpose: "PRODUCTION_OVERHEAD",
        direction: "CREDIT",
        amount: overheadValue,
        memo: {
          en: `Production order ${order.orderNo ?? id} — applied production overhead`,
          ar: `أمر إنتاج ${order.orderNo ?? id} — مصاريف إنتاج غير مباشرة مطبقة`,
        },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "production_order", docId: id, operation: "complete" },
      entryDate: completedAt,
      description: {
        en: `Production order ${order.orderNo ?? id} — completion`,
        ar: `أمر إنتاج ${order.orderNo ?? id} — الإنجاز`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    await applyReceipt(receiptPlan, posted.journalEntryId);
    if (receiptPlan.createdBatch !== null) {
      // Produced-batch provenance (the genealogy edge) + the QC gate hold
      // (QUARANTINED until inspection releases it — T39's surface).
      await this.tracking.linkBatchProduction(receiptPlan.createdBatch.id, id);
      if (policies.qcGate === "required") {
        await this.tracking.quarantineBatch(receiptPlan.createdBatch.id);
      }
    }

    await store.patchProductionOrder({
      id,
      status: "COMPLETED",
      completedAt,
      actualQty,
      fgBatchId: receiptPlan.batchId,
      fgJournalId: posted.journalEntryId,
      fgValue,
      wipCreditValue: wipBalance,
      laborValue,
      overheadValue,
    });
    await this.audit.record({
      action: "manufacturing.production_order.completed",
      entityType: "production_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: "IN_PROGRESS" },
      after: {
        orderNo: order.orderNo,
        status: "COMPLETED",
        actualQty,
        fgValue,
        wipCreditValue: wipBalance,
        laborValue,
        overheadValue,
        unitCost,
        fgBatchId: receiptPlan.batchId,
        batchNo: receiptPlan.createdBatch?.batchNo ?? null,
        expiry,
        qcGate: policies.qcGate,
        journalEntryId: posted.journalEntryId,
      },
    });
    order = await this.requireOrder(id);
    return { order, ...(await this.completionSummary(order)) };
  }

  // -- cancel (DRAFT/RELEASED/IN_PROGRESS with ZERO consumptions; reason) -----------

  async cancel(
    id: string,
    input: { reason: string; actorId: string | null },
  ): Promise<ProductionOrderRow> {
    const order = await this.requireOrder(id);
    const reason = (input.reason ?? "").trim();
    if (reason === "" || reason.length > 500) {
      throw new ProductionOrderInputInvalidError("a cancel reason of 1..500 chars is required");
    }
    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw new ProductionOrderStateError(
        `production order ${order.orderNo ?? id} is ${order.status} — completed/cancelled orders never cancel`,
        { orderId: id, from: order.status, to: "CANCELLED" },
      );
    }
    const consumptionCount = await store.countProductionConsumptions(id);
    if (consumptionCount > 0) {
      // Corrections are adjusted consumptions — never cancels.
      throw new OrderNotCancelableError(id, consumptionCount);
    }
    await store.patchProductionOrder({ id, status: "CANCELLED", cancelReason: reason });
    await this.audit.record({
      action: "manufacturing.production_order.cancelled",
      entityType: "production_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: order.status },
      after: { status: "CANCELLED", orderNo: order.orderNo, reason },
    });
    return this.requireOrder(id);
  }

  // -- shared helpers ----------------------------------------------------------------

  private async requireOrder(id: string): Promise<ProductionOrderRow> {
    const order = await store.findProductionOrderById(id);
    if (order === undefined) throw new ProductionOrderNotFoundError(id);
    return order;
  }

  /** The FG item read: STOCK kind + not deleted (the create/update gate). */
  private async requireProductionItem(itemId: string): Promise<store.ProductionItemRow> {
    const item = await store.findItemForProduction(itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new ProductionOrderNotFoundError(`item ${itemId} does not exist in this tenant`);
    }
    if (item.kind !== "STOCK") {
      throw new ProductionOrderItemNotStockError(
        `the FG item of a production order must be STOCK — ${item.sku} is ${item.kind}`,
      );
    }
    return item;
  }

  /** The completion summary off the stored row (+ the batch row for
   * batchNo/expiry) — the complete() replay path and the GET :id detail. */
  private async completionSummary(order: ProductionOrderRow): Promise<Omit<CompletionResult, "order">> {
    let batchNo: string | null = null;
    let expiry: string | null = null;
    if (order.fgBatchId !== null) {
      const batch = await this.tracking.findBatch(order.fgBatchId);
      batchNo = batch.batchNo;
      expiry = batch.expiryDate;
    }
    return {
      journalEntryId: order.fgJournalId,
      batchId: order.fgBatchId,
      batchNo,
      expiry,
      fgValue: order.fgValue,
      wipCredit: order.wipCreditValue,
      labor: order.laborValue,
      overhead: order.overheadValue,
    };
  }

  /**
   * The four manufacturing policies off the resolved effective config —
   * `config.policies` carries them in EVERY tenant (SETTINGS_REGISTRY
   * defaults flatten into the §5 map; T37 pinned that proof), so no
   * readEffectiveSetting fallback is ever needed.
   */
  private async mfgPolicies(): Promise<MfgPolicies> {
    const tenantId = requireTenantContext().tenantId;
    const config = await this.resolveConfig.resolveTenantStatic(tenantId);
    const policies = config.policies;
    const threshold = policies["manufacturing.consumption_variance_threshold_pct"];
    return {
      qcGate: policies["manufacturing.qc_gate"] === "required" ? "required" : "off",
      scrapReasonRequired: policies["manufacturing.scrap_reason_required"] !== false,
      expiryFromShelfLife: policies["manufacturing.fg_batch_expiry_from_shelf_life"] !== false,
      varianceThresholdPct: typeof threshold === "number" ? threshold : 5,
    };
  }

  private canonicalPositiveQty(raw: string, what: string): string {
    if (!QTY_RE.test(raw) || new Decimal(raw).lessThanOrEqualTo(0)) {
      throw new ProductionOrderInputInvalidError(`${what} must be a positive decimal (≤ 6dp): ${raw}`);
    }
    return new Decimal(raw).toFixed(6);
  }

  private canonicalRate(raw: string, what: string): string {
    if (!RATE_RE.test(raw) || new Decimal(raw).lessThan(0)) {
      throw new ProductionOrderInputInvalidError(`${what} must be a non-negative decimal (≤ 6dp): ${raw}`);
    }
    return new Decimal(raw).toFixed(6);
  }

  private assertDate(value: string | null, what: string): void {
    if (value === null) return;
    if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      throw new ProductionOrderInputInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${value}`);
    }
  }
}
