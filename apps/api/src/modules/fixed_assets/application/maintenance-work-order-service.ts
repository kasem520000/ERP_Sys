import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  applyIssue,
  planIssue,
  requireActiveWarehouse,
  requireStockItem,
  resolveInventoryAccount,
  stagePendingOverlay,
  type IssuePlan,
} from "../../inventory/application/movement-core";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/cmms.store";
import {
  CmmsAssetNotOperableError,
  CmmsCostLineNotFoundError,
  CmmsCostLineUnpricedError,
  CmmsInputInvalidError,
  CmmsPartsShortfallError,
  CmmsRateSnapshotError,
  CmmsStepNotFoundError,
  CmmsStepsOpenError,
  CmmsWorkOrderCompletedError,
  CmmsWorkOrderCompletionRaceError,
  CmmsWorkOrderNotFoundError,
  CmmsWorkOrderStateError,
  CmmsWorkOrderZeroTotalError,
} from "../domain/cmms-errors";
import { laborLineAmount, reconcileWorkOrderCosts, sumAmounts } from "../domain/cmms-plan-math";

/**
 * PHASE-049 (W-17 — T-05 + T-06) THE WORK-ORDER ENGINE: the status
 * machine (D-03 — one guarded CAS per transition, the stamps landing in
 * the same statement, every illegal move refused BY NAME), the cost
 * collectors (the three legs' lines with the snapshot pricing law), and
 * THE COMPLETION ACT — G-59's fused posting (D-04/D-05):
 *
 *   THE GATE (BR-098): completion is blocked while any carried checklist
 *   step is open (the refusal carries the open count and the titles) or
 *   any cost line is unpriced (the refusal names every offending line) —
 *   never a silent partial, never a fabricated rate.
 *
 *   THE ACT (ONE ambient transaction — all-or-nothing): the parts lines
 *   issue through the REAL WMS path (planIssue + applyIssue, G-60's
 *   discipline — the stock decrements in the same transaction as the
 *   journal) · the G-59 entry posts through the REAL engine (INV-013
 *   idempotent on source `maintenance_work_order:{id}:complete`; DR the
 *   purpose-mapped MAINTENANCE_EXPENSE total · CR the per-warehouse
 *   inventory accounts for the parts at the issue's own value · CR
 *   LABOR_CLEARING for the snapshotted labor · CR EXTERNAL_ACCRUAL for
 *   the external services — the asset's cost and every depreciation
 *   column UNTOUCHED) · the per-line issue stamps land (the W-3
 *   provenance) · the single-use completed_at + journal_entry_id + the
 *   three totals land in ONE guarded UPDATE (the 0105 journal gate
 *   satisfied by the same statement that consumes the stamp). A failure
 *   anywhere rolls the WHOLE act back — the order stays on its
 *   pre-completion state, zero residue (the merged G-59/G-60 atomicity,
 *   the owner's four-conditions ruling's second condition).
 *
 *   INV-034 (work-order cost integrity) holds BY CONSTRUCTION: the GL
 *   maintenance-expense debit is the exact 4-dp sum of the same source
 *   figures the three legs carry (sumAmounts over the same strings), and
 *   the reconciliation fold (cmms-plan-math.reconcileWorkOrderCosts) is
 *   the witness the golden transcripts read — one action, two
 *   witnesses: the journal entry AND the inventory issue (the ruling's
 *   third condition).
 *
 * The machine never invents a clock value: every stamp (planned_at,
 * started_at, completed_at) is computed once at the transition and
 * written by the CAS — the deterministic-stamp discipline (the W-8
 * clock-fix law extended to the CMMS plane).
 */

/** Official work-order numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention, docType `maintenance_work_order`). */
export const WORK_ORDER_NUMBER_FORMAT = {
  prefix: "MO",
  format: "MO-{YYYY}-{SEQ:6}",
  docType: "maintenance_work_order",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const RATE_RE = /^\d+(\.\d{1,6})?$/;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new CmmsInputInvalidError(`${what} must be a UUID: ${value}`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The D-01 operability guard (the frozen-substrate law): disposed/
 * written-off assets open no work order — the typed refusal at every
 * authoring path. */
async function requireOperableAsset(assetId: string): Promise<void> {
  const asset = await store.findAssetStatus(assetId);
  if (asset === undefined) {
    throw new CmmsInputInvalidError(`asset ${assetId} does not exist in this tenant`);
  }
  if (asset.status === "DISPOSED" || asset.status === "WRITTEN_OFF") {
    throw new CmmsAssetNotOperableError({ assetId, status: asset.status });
  }
}

@Injectable()
export class MaintenanceWorkOrderService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  // -- the register (T-05) ------------------------------------------------------

  async create(input: {
    assetId: string;
    problem: string;
    problemAr?: string | null;
    priority?: string;
    technicianEmployeeId?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.WorkOrderRow> {
    requireUuid(input.assetId, "assetId");
    if (input.problem.trim().length === 0 || input.problem.length > 2000) {
      throw new CmmsInputInvalidError("problem is required (1…2000 chars)");
    }
    const priority = input.priority ?? "MEDIUM";
    if (!(PRIORITIES as readonly string[]).includes(priority)) {
      throw new CmmsInputInvalidError(`priority must be one of ${PRIORITIES.join("/")}: ${priority}`);
    }
    if (input.technicianEmployeeId !== null && input.technicianEmployeeId !== undefined) {
      requireUuid(input.technicianEmployeeId, "technicianEmployeeId");
      const employee = await store.findEmployeeLite(input.technicianEmployeeId);
      if (employee === undefined) {
        throw new CmmsInputInvalidError(
          `technician employee ${input.technicianEmployeeId} does not exist in this tenant (the HR read — 049 never writes an HR table)`,
        );
      }
    }
    await requireOperableAsset(input.assetId);

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: WORK_ORDER_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: WORK_ORDER_NUMBER_FORMAT.format,
      prefix: WORK_ORDER_NUMBER_FORMAT.prefix,
      year,
    });
    const order = await store.insertWorkOrder({
      assetId: input.assetId,
      orderNo: acquired.number,
      problem: input.problem,
      problemAr: input.problemAr ?? null,
      priority,
      technicianEmployeeId: input.technicianEmployeeId ?? null,
      status: "REQUESTED",
      planId: null,
      plannedAt: null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.numbering.bind(WORK_ORDER_NUMBER_FORMAT.docType, acquired.number, order.id);
    await this.audit.record({
      action: "assets.maintenance_work_order_created",
      entityType: "maintenance_work_order",
      entityId: order.id,
      actorId: input.actorId ?? undefined,
      after: { orderNo: order.orderNo, assetId: order.assetId, priority: order.priority },
    });
    return order;
  }

  async get(orderId: string): Promise<store.WorkOrderRow> {
    requireUuid(orderId, "workOrderId");
    const order = await store.findWorkOrderById(orderId);
    if (order === undefined) throw new CmmsWorkOrderNotFoundError(orderId);
    return order;
  }

  async list(filter: {
    assetId?: string;
    status?: string;
    planId?: string;
  }): Promise<store.WorkOrderRow[]> {
    if (filter.assetId !== undefined) requireUuid(filter.assetId, "assetId");
    if (filter.planId !== undefined) requireUuid(filter.planId, "planId");
    return store.listWorkOrders(filter);
  }

  // -- the machine (D-03 — one CAS per move, refused BY NAME) -------------------

  /** REQUESTED → PLANNED (the plan stamp lands in the same statement). */
  async plan(orderId: string, actorId: string | null): Promise<store.WorkOrderRow> {
    return this.transition(orderId, "PLANNED", ["REQUESTED"], actorId, {
      reason: "only a REQUESTED order plans",
      plannedAt: nowIso(),
    });
  }

  /** PLANNED → IN_PROGRESS (the start stamp). */
  async start(orderId: string, actorId: string | null): Promise<store.WorkOrderRow> {
    return this.transition(orderId, "IN_PROGRESS", ["PLANNED"], actorId, {
      reason: "only a PLANNED order starts",
      startedAt: nowIso(),
    });
  }

  /** IN_PROGRESS → ON_HOLD (the pause — the clock keeps its start stamp). */
  async hold(orderId: string, actorId: string | null): Promise<store.WorkOrderRow> {
    return this.transition(orderId, "ON_HOLD", ["IN_PROGRESS"], actorId, {
      reason: "only an IN_PROGRESS order pauses (the pause exists on the started plane)",
    });
  }

  /** ON_HOLD → IN_PROGRESS (the resume — the pause both-ways law). */
  async resume(orderId: string, actorId: string | null): Promise<store.WorkOrderRow> {
    return this.transition(orderId, "IN_PROGRESS", ["ON_HOLD"], actorId, {
      reason: "only an ON_HOLD order resumes",
    });
  }

  private async transition(
    orderId: string,
    to: string,
    from: readonly string[],
    actorId: string | null,
    extra: { reason: string; plannedAt?: string; startedAt?: string },
  ): Promise<store.WorkOrderRow> {
    requireUuid(orderId, "workOrderId");
    const current = await store.findWorkOrderById(orderId);
    if (current === undefined) throw new CmmsWorkOrderNotFoundError(orderId);
    if (current.status === "COMPLETED") {
      throw new CmmsWorkOrderCompletedError({
        workOrderId: orderId,
        completedAt: current.completedAt ?? "unknown",
        action: `the move to ${to}`,
      });
    }
    if (!from.includes(current.status)) {
      throw new CmmsWorkOrderStateError({
        workOrderId: orderId,
        from: current.status,
        to,
        reason: extra.reason,
      });
    }
    const moved = await store.casWorkOrderStatus({
      id: orderId,
      from,
      to,
      plannedAt: extra.plannedAt ?? null,
      startedAt: extra.startedAt ?? null,
      actorId,
    });
    if (moved === undefined) {
      throw new CmmsWorkOrderStateError({
        workOrderId: orderId,
        from: current.status,
        to,
        reason: "the state left the expected window concurrently — reload and retry (the CAS guard)",
      });
    }
    await this.audit.record({
      action: "assets.maintenance_work_order_transitioned",
      entityType: "maintenance_work_order",
      entityId: orderId,
      actorId: actorId ?? undefined,
      before: { status: current.status },
      after: { status: to },
    });
    return moved;
  }

  // -- the cost collectors (D-03/D-05 — the lines) ------------------------------

  async addLine(input: {
    workOrderId: string;
    legType: "LABOR" | "PARTS" | "EXTERNAL";
    employeeId?: string | null;
    hours?: string | null;
    unitRate?: string | null;
    itemId?: string | null;
    warehouseId?: string | null;
    qty?: string | null;
    partnerId?: string | null;
    amount?: string | null;
    description?: string | null;
    descriptionAr?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.CostLineRow> {
    const order = await this.requireOpenOrder(input.workOrderId, "adding a cost line");
    let unitRate: string | null = null;
    let amount: string | null = null;
    if (input.legType === "LABOR") {
      if (input.employeeId == null || input.hours == null) {
        throw new CmmsInputInvalidError(
          "a LABOR line carries the technician employeeId and the hours",
        );
      }
      requireUuid(input.employeeId, "employeeId");
      if (!QTY_RE.test(input.hours) || new Decimal(input.hours).lessThanOrEqualTo(0)) {
        throw new CmmsInputInvalidError(`hours must be a positive decimal (≤ 6dp): ${input.hours}`);
      }
      const employee = await store.findEmployeeLite(input.employeeId);
      if (employee === undefined) {
        throw new CmmsInputInvalidError(
          `technician employee ${input.employeeId} does not exist in this tenant (the HR read — 049 never writes an HR table)`,
        );
      }
      if (input.unitRate != null) {
        if (!RATE_RE.test(input.unitRate)) {
          throw new CmmsInputInvalidError(
            `unitRate must be a non-negative decimal (≤ 6dp): ${input.unitRate}`,
          );
        }
        // The SNAPSHOT pricing: amount = hours × rate, ONE half-up 4dp
        // rounding — the pure fold (zero parallel computation).
        unitRate = input.unitRate;
        amount = laborLineAmount(input.hours, input.unitRate);
      }
      // rate omitted ⇒ UNPRICED (amount NULL) — BR-098's gate refuses the
      // completion naming this line; never a fabricated rate.
    } else if (input.legType === "PARTS") {
      if (input.itemId == null || input.warehouseId == null || input.qty == null) {
        throw new CmmsInputInvalidError("a PARTS line carries the itemId, the warehouseId and the qty");
      }
      requireUuid(input.itemId, "itemId");
      requireUuid(input.warehouseId, "warehouseId");
      if (!QTY_RE.test(input.qty) || new Decimal(input.qty).lessThanOrEqualTo(0)) {
        throw new CmmsInputInvalidError(`qty must be a positive decimal (≤ 6dp): ${input.qty}`);
      }
      await requireStockItem(input.itemId);
      await requireActiveWarehouse(input.warehouseId);
      await this.assertPartsAvailability({
        workOrderId: input.workOrderId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        qty: input.qty,
        excludeLineId: null,
      });
    } else if (input.legType === "EXTERNAL") {
      if (input.partnerId == null) {
        throw new CmmsInputInvalidError("an EXTERNAL line carries the supplier partnerId");
      }
      requireUuid(input.partnerId, "partnerId");
      const partner = await store.findPartnerLite(input.partnerId);
      if (partner === undefined) {
        throw new CmmsInputInvalidError(`supplier partner ${input.partnerId} does not exist in this tenant`);
      }
      if (input.amount != null) {
        if (!MONEY_RE.test(input.amount) || new Decimal(input.amount).lessThan(0)) {
          throw new CmmsInputInvalidError(
            `amount must be a non-negative decimal (≤ 4dp): ${input.amount}`,
          );
        }
        amount = input.amount;
      }
      if (input.description == null || input.description.trim().length === 0) {
        throw new CmmsInputInvalidError("an EXTERNAL line carries its own description (the service billed)");
      }
    } else {
      throw new CmmsInputInvalidError(`legType must be LABOR/PARTS/EXTERNAL: ${input.legType}`);
    }

    const line = await store.insertCostLine({
      workOrderId: input.workOrderId,
      legType: input.legType,
      employeeId: input.employeeId ?? null,
      hours: input.hours ?? null,
      unitRate,
      itemId: input.itemId ?? null,
      warehouseId: input.warehouseId ?? null,
      qty: input.qty ?? null,
      partnerId: input.partnerId ?? null,
      amount,
      description: input.description ?? null,
      descriptionAr: input.descriptionAr ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "assets.maintenance_cost_line_added",
      entityType: "maintenance_cost_line",
      entityId: line.id,
      actorId: input.actorId ?? undefined,
      after: {
        workOrderId: order.id,
        lineNo: line.lineNo,
        legType: line.legType,
        amount: line.amount,
      },
    });
    return line;
  }

  /**
   * Price an UNPRICED line (the NULL→value transition only): a LABOR
   * line receives its rate (the amount computed by the same fold); an
   * EXTERNAL line its amount. A priced line refuses BY NAME — the
   * snapshot is frozen (the crm_time_entries.unitRate law).
   */
  async priceLine(input: {
    workOrderId: string;
    lineId: string;
    unitRate?: string | null;
    amount?: string | null;
    actorId: string | null;
  }): Promise<store.CostLineRow> {
    const order = await this.requireOpenOrder(input.workOrderId, "pricing a cost line");
    const line = await store.findCostLine(input.workOrderId, input.lineId);
    if (line === undefined) {
      throw new CmmsCostLineNotFoundError({ workOrderId: input.workOrderId, lineId: input.lineId });
    }
    let unitRate: string | null = null;
    let amount: string | null = null;
    if (line.legType === "LABOR") {
      if (input.unitRate == null) {
        throw new CmmsInputInvalidError("a LABOR line prices on its unitRate");
      }
      if (!RATE_RE.test(input.unitRate)) {
        throw new CmmsInputInvalidError(`unitRate must be a non-negative decimal (≤ 6dp): ${input.unitRate}`);
      }
      unitRate = input.unitRate;
      amount = laborLineAmount(line.hours!, input.unitRate);
    } else if (line.legType === "EXTERNAL") {
      if (input.amount == null) {
        throw new CmmsInputInvalidError("an EXTERNAL line prices on its amount");
      }
      if (!MONEY_RE.test(input.amount)) {
        throw new CmmsInputInvalidError(`amount must be a non-negative decimal (≤ 4dp): ${input.amount}`);
      }
      amount = input.amount;
    } else {
      throw new CmmsInputInvalidError(
        `a PARTS line's value is the completion act's own issue — it never prices by hand (D-05)`,
      );
    }
    const priced = await store.priceCostLine({
      lineId: line.id,
      unitRate,
      amount,
      actorId: input.actorId,
    });
    if (priced === undefined) {
      throw new CmmsRateSnapshotError({
        lineId: line.id,
        legType: line.legType,
        action: "re-pricing",
      });
    }
    await this.audit.record({
      action: "assets.maintenance_cost_line_priced",
      entityType: "maintenance_cost_line",
      entityId: line.id,
      actorId: input.actorId ?? undefined,
      after: { workOrderId: order.id, lineNo: line.lineNo, amount: priced.amount },
    });
    return priced;
  }

  async removeLine(input: {
    workOrderId: string;
    lineId: string;
    actorId: string | null;
  }): Promise<void> {
    await this.requireOpenOrder(input.workOrderId, "removing a cost line");
    const line = await store.findCostLine(input.workOrderId, input.lineId);
    if (line === undefined) {
      throw new CmmsCostLineNotFoundError({ workOrderId: input.workOrderId, lineId: input.lineId });
    }
    await store.deleteCostLine(line.id);
    await this.audit.record({
      action: "assets.maintenance_cost_line_removed",
      entityType: "maintenance_cost_line",
      entityId: line.id,
      actorId: input.actorId ?? undefined,
      before: { workOrderId: input.workOrderId, lineNo: line.lineNo, legType: line.legType },
    });
  }

  /** D-05's line-creation floor: the on-hand vs THIS order's cumulative
   * claims (the earlier unissued parts lines claim too) — the named
   * shortfall refusal, never a silent backorder. */
  private async assertPartsAvailability(input: {
    workOrderId: string;
    itemId: string;
    warehouseId: string;
    qty: string;
    excludeLineId: string | null;
  }): Promise<void> {
    const claims = await store.pendingPartsClaims(input.workOrderId, input.excludeLineId);
    const mine = claims.find(
      (claim) => claim.itemId === input.itemId && claim.warehouseId === input.warehouseId,
    );
    const requested = new Decimal(input.qty).plus(mine?.qty ?? 0);
    const onHandMap = await store.onHandQuantities([
      { itemId: input.itemId, warehouseId: input.warehouseId },
    ]);
    const onHand = onHandMap.get(`${input.itemId}:${input.warehouseId}`) ?? "0";
    if (requested.greaterThan(new Decimal(onHand))) {
      throw new CmmsPartsShortfallError({
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        onHand,
        requested: requested.toDecimalPlaces(6).toFixed(6),
      });
    }
  }

  // -- the step results (BR-098's other half) ------------------------------------

  async recordStep(input: {
    workOrderId: string;
    stepId: string;
    result: "PASS" | "FAIL";
    resultNote?: string | null;
    resultNoteAr?: string | null;
    actorId: string | null;
  }): Promise<store.StepRow> {
    await this.requireOpenOrder(input.workOrderId, "recording a step result");
    const step = await store.findOrderStep(input.workOrderId, input.stepId);
    if (step === undefined) {
      throw new CmmsStepNotFoundError({ workOrderId: input.workOrderId, stepId: input.stepId });
    }
    const recorded = await store.recordStepResult({
      stepId: step.id,
      result: input.result,
      resultNote: input.resultNote ?? null,
      resultNoteAr: input.resultNoteAr ?? null,
      recordedAt: nowIso(),
      recordedBy: input.actorId,
    });
    await this.audit.record({
      action: "assets.maintenance_step_recorded",
      entityType: "maintenance_work_order_step",
      entityId: step.id,
      actorId: input.actorId ?? undefined,
      after: { workOrderId: input.workOrderId, seq: step.seq, result: input.result },
    });
    return recorded ?? step;
  }

  async listLines(orderId: string): Promise<store.CostLineRow[]> {
    await this.get(orderId);
    return store.listCostLines(orderId);
  }

  async listSteps(orderId: string): Promise<store.StepRow[]> {
    await this.get(orderId);
    return store.listOrderSteps(orderId);
  }

  // -- THE COMPLETION ACT (T-06 — G-59's fused posting) --------------------------

  async complete(input: {
    workOrderId: string;
    solution?: string | null;
    solutionAr?: string | null;
    actorId: string | null;
  }): Promise<{
    order: store.WorkOrderRow;
    journalEntryId: string;
    /** INV-034's witness: the per-leg reconciliation of the posted entry. */
    reconciliation: ReturnType<typeof reconcileWorkOrderCosts>;
    /** The parts lines' issue move ids (G-60's discipline — the second
     * witness; empty when the order carries no parts). */
    issueMoveIds: string[];
  }> {
    const orderId = requireUuid(input.workOrderId, "workOrderId");
    const order = await store.findWorkOrderById(orderId);
    if (order === undefined) throw new CmmsWorkOrderNotFoundError(orderId);
    if (order.status === "COMPLETED") {
      // The replay is the typed refusal (INV-013's document-side twin:
      // the single-use stamp already consumed).
      throw new CmmsWorkOrderCompletedError({
        workOrderId: orderId,
        completedAt: order.completedAt ?? "unknown",
        action: "the completion (the stamp is single-use — the G-59 entry already stands)",
      });
    }
    if (order.status !== "IN_PROGRESS" && order.status !== "ON_HOLD") {
      throw new CmmsWorkOrderStateError({
        workOrderId: orderId,
        from: order.status,
        to: "COMPLETED",
        reason: "only a started order completes (plan it, then start it, first)",
      });
    }

    // BR-098's gate — the open steps (the count + the titles, by name).
    const steps = await store.listOrderSteps(orderId);
    const openSteps = steps.filter((step) => step.result === null);
    if (openSteps.length > 0) {
      throw new CmmsStepsOpenError({
        workOrderId: orderId,
        openCount: openSteps.length,
        openSteps: openSteps.map((step) => ({ seq: step.seq, title: step.title })),
      });
    }

    // BR-098's gate — the unpriced lines (every offending line, by name).
    const lines = await store.listCostLines(orderId);
    const unpriced = lines.filter(
      (line) =>
        (line.legType === "LABOR" && line.amount === null) ||
        (line.legType === "EXTERNAL" && line.amount === null),
    );
    if (unpriced.length > 0) {
      throw new CmmsCostLineUnpricedError({
        workOrderId: orderId,
        unpriced: unpriced.map((line) => ({
          lineNo: line.lineNo,
          legType: line.legType,
          subject:
            line.legType === "LABOR"
              ? `technician ${line.employeeId ?? "?"} · ${line.hours ?? "?"}h — the rate is unset`
              : `supplier ${line.partnerId ?? "?"} — the expected bill amount is unset`,
        })),
      });
    }

    // THE PARTS ISSUES (G-60's discipline — the stock decrements through
    // the REAL WMS path in the same ambient transaction as the journal;
    // the no-negative-stock floor re-asserted here by planIssue itself).
    const today = todayIso();
    const issuePlans: { line: store.CostLineRow; plan: IssuePlan }[] = [];
    for (const line of lines.filter((row) => row.legType === "PARTS")) {
      const plan = await planIssue({
        itemId: line.itemId!,
        warehouseId: line.warehouseId!,
        qty: line.qty!,
        movedAt: today,
        moveKind: "issue",
        sourceType: "maintenance_work_order",
        sourceId: orderId,
        memo: `Work order ${order.orderNo} — parts issue (line ${line.lineNo})`,
        memoAr: `أمر صيانة ${order.orderNo} — صرف قطع (سطر ${line.lineNo})`,
      });
      issuePlans.push({ line, plan });
      stagePendingOverlay(plan); // later lines see the earlier pending issues
    }

    // THE TOTALS (the same pure folds the reconciliation reads — zero
    // parallel computation; INV-034 balanced by construction).
    const laborTotal = sumAmounts(
      lines.filter((line) => line.legType === "LABOR").map((line) => line.amount!),
    );
    const externalTotal = sumAmounts(
      lines.filter((line) => line.legType === "EXTERNAL").map((line) => line.amount!),
    );
    const partsTotal = sumAmounts(issuePlans.map(({ plan }) => plan.valueAmount));
    const grandTotal = sumAmounts([laborTotal, partsTotal, externalTotal]);
    if (new Decimal(grandTotal).lessThanOrEqualTo(0)) {
      throw new CmmsWorkOrderZeroTotalError({
        workOrderId: orderId,
        laborTotal,
        partsTotal,
        externalTotal,
      });
    }

    // THE G-59 ENTRY (D-04's fused shape): DR MAINTENANCE_EXPENSE (the
    // total) · CR the per-warehouse inventory accounts (the parts at the
    // issue's own value — G-60's law on the credit leg) · CR
    // LABOR_CLEARING (the snapshotted labor) · CR EXTERNAL_ACCRUAL (the
    // external services). The asset's cost and every depreciation column
    // are UNTOUCHED — maintenance is an expense, never a capitalization.
    const inventoryByAccount = new Map<string, string>();
    for (const { plan } of issuePlans) {
      const inventoryAccount = await resolveInventoryAccount(plan.warehouseId);
      inventoryByAccount.set(
        inventoryAccount,
        new Decimal(inventoryByAccount.get(inventoryAccount) ?? "0")
          .plus(new Decimal(plan.valueAmount))
          .toFixed(4),
      );
    }
    const journalLines: JournalLineSpec[] = [
      {
        purpose: "MAINTENANCE_EXPENSE",
        direction: "DEBIT",
        amount: grandTotal,
        memo: {
          en: `Work order ${order.orderNo} — maintenance expense (G-59)`,
          ar: `أمر صيانة ${order.orderNo} — مصروف الصيانة (G-59)`,
        },
      },
    ];
    for (const [accountId, amount] of [...inventoryByAccount.entries()].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      if (amount === "0.0000") continue;
      journalLines.push({
        accountId,
        direction: "CREDIT",
        amount,
        memo: {
          en: `Work order ${order.orderNo} — parts issued at completion (G-60's leg)`,
          ar: `أمر صيانة ${order.orderNo} — صرف القطع عند الإنجاز (ساق G-60)`,
        },
      });
    }
    if (new Decimal(laborTotal).greaterThan(0)) {
      journalLines.push({
        purpose: "LABOR_CLEARING",
        direction: "CREDIT",
        amount: laborTotal,
        memo: {
          en: `Work order ${order.orderNo} — technician labor (the snapshotted rates)`,
          ar: `أمر صيانة ${order.orderNo} — أجور الفنيين (الأسعار الملتقطة)`,
        },
      });
    }
    if (new Decimal(externalTotal).greaterThan(0)) {
      journalLines.push({
        purpose: "EXTERNAL_ACCRUAL",
        direction: "CREDIT",
        amount: externalTotal,
        memo: {
          en: `Work order ${order.orderNo} — external services accrued (the supplier bill supersedes when it lands)`,
          ar: `أمر صيانة ${order.orderNo} — خدمات خارجية مستحقة (فاتورة المورّد تعوّضها عند ورودها)`,
        },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "maintenance_work_order", docId: orderId, operation: "complete" },
      entryDate: today,
      description: {
        en: `Work order ${order.orderNo} — G-59 maintenance completion`,
        ar: `أمر صيانة ${order.orderNo} — إنجاز G-59`,
      },
      currency: await ownTenantBaseCurrency(),
      lines: journalLines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });

    // THE ISSUES APPLY (the same transaction; the per-line W-3 stamps).
    const completedAt = nowIso();
    const issueMoveIds: string[] = [];
    for (const { line, plan } of issuePlans) {
      issueMoveIds.push(...(await applyIssue(plan, posted.journalEntryId)));
      const unitCost = new Decimal(plan.qty).greaterThan(0)
        ? new Decimal(plan.valueAmount).div(new Decimal(plan.qty)).toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        : new Decimal(0);
      await store.stampCostLineIssued({
        lineId: line.id,
        amount: new Decimal(plan.valueAmount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        issueUnitCost: unitCost.toFixed(6),
        issuedAt: completedAt,
      });
    }

    // THE SINGLE-USE STAMP + THE TOTALS + THE JOURNAL LINK — ONE guarded
    // UPDATE (the 0105 journal gate satisfied by the same statement; a
    // failure above rolled the whole act back — the order still stands
    // on its pre-completion state, zero residue).
    const completed = await store.completeWorkOrderStamp({
      id: orderId,
      journalEntryId: posted.journalEntryId,
      laborTotal,
      partsTotal,
      externalTotal,
      completedAt,
      actorId: input.actorId,
    });
    if (completed === undefined) {
      throw new CmmsWorkOrderCompletionRaceError({ workOrderId: orderId });
    }

    // INV-034's witness — the per-leg reconciliation of what just posted.
    const reconciliation = reconcileWorkOrderCosts({
      laborTotal,
      partsTotal,
      externalTotal,
      glExpenseDebit: grandTotal,
    });

    await this.audit.record({
      action: "assets.maintenance_work_order_completed",
      entityType: "maintenance_work_order",
      entityId: orderId,
      actorId: input.actorId ?? undefined,
      before: { status: order.status },
      after: {
        status: "COMPLETED",
        journalEntryId: posted.journalEntryId,
        laborTotal,
        partsTotal,
        externalTotal,
        issueMoves: issueMoveIds.length,
      },
    });
    return { order: completed, journalEntryId: posted.journalEntryId, reconciliation, issueMoveIds };
  }

  /** The open-order guard (the evidence freeze): lines, pricing and step
   * results refuse on a COMPLETED order BY NAME. */
  private async requireOpenOrder(
    workOrderId: string,
    action: string,
  ): Promise<store.WorkOrderRow> {
    const order = await this.get(workOrderId);
    if (order.status === "COMPLETED") {
      throw new CmmsWorkOrderCompletedError({
        workOrderId,
        completedAt: order.completedAt ?? "unknown",
        action,
      });
    }
    return order;
  }
}
