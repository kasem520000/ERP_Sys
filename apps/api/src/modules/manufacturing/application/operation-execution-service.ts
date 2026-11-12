import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/manufacturing.store";
import type {
  ProductionOrderOperationRow,
  ProductionOrderRow,
  RoutingRow,
} from "../infrastructure/manufacturing.store";
import {
  ApproverNotFoundError,
  OperationCostRoundingError,
  OperationNotFoundError,
  OperationScrapReasonRequiredError,
  OperationSequenceError,
  OperationStateError,
  RoutingNotFoundError,
  ScanCodeFormatError,
  SelfApprovalBlockedError,
} from "../domain/manufacturing-errors";

/**
 * Operation-execution service (PHASE-042 M-02/M-17/M-18/M-13/M-19 — the
 * INV-028 core): the shop-floor state machine over the release-frozen
 * production_order_operations rows.
 *
 * Release binding rides ProductionOrderService.release (extended with the
 * routingInput param): this service owns freezeOrderOperations — the
 * operation-specific part — resolving the routing (explicit id, else the
 * item's ACTIVE when the caller didn't opt out), freezing one PENDING row
 * per routing operation (std_* from the routing + work-center rates where
 * the overrides are NULL), and stamping production_orders.routing_id +
 * current_operation=NULL + std_unit_cost (the item's ACTIVE standard, NULL
 * when none — the L2-12 dual mode). Routing-less orders keep the legacy
 * flat-rate path byte-identical (G-17/G-18).
 *
 * The machine: PENDING → RUNNING (start; started_at + operator) → PAUSED ↔
 * RUNNING (pause/resume) → COMPLETED | SKIPPED. INV-028 sequence gate: an
 * operation starts only when every lower-sequence operation is COMPLETED or
 * SKIPPED (OperationSequenceError). start-on-RUNNING / pause-on-PAUSED /
 * resume-on-RUNNING are idempotent no-ops returning the stored row.
 *
 * completeOp posts G-40 (source production_order, operation `op_<seq>`):
 * DR WIP (the conversion total = labor + overhead) · CR PRODUCTION_LABOR
 * (actual × var_rate) · CR PRODUCTION_OVERHEAD (actual × fixed_rate) — a
 * zero leg is skipped (the complete() precedent); an entirely uncosted
 * operation (both legs 0) records its times WITHOUT a journal. The credit
 * sum MUST equal the debit at 4dp (assert; OperationCostRoundingError).
 * INV-013: the `op_<seq>` source operation + the journal uq source index
 * make completeOp idempotent — a replay returns the stored row, never a
 * second journal.
 *
 * Variance columns (M-13/M-19, 4dp decimal strings, HALF_UP):
 *   setup_variance = (actual_setup − std_setup) × (std_fixed + std_var)
 *   usage_variance = (actual_run − std_run × qtyBasis) × std_var, where
 *     qtyBasis = the ORDER's actualQty when > 0 else plannedQty. RATIONALE
 *     (documented decision): usage variance needs the produced qty; at
 *     mid-order completion the running actual qty is the honest basis, and
 *     the order-level yield variance at completion catches the remainder.
 *   rate_variance = 0 in v1 — the std rates ARE the actual rates; work-
 *     center rate changes mid-order belong to PHASE-043 (honest limitation,
 *     mirrored in the phase spec).
 *
 * skipOp: the approver must be a distinct real ACTIVE user (SoD — the
 * BR-034 house pattern: SelfApprovalBlockedError / ApproverNotFoundError);
 * SKIPPED counts as sequence-satisfied for the gate.
 *
 * scan (M-17): OP:<orderId>:<seq>:<start|pause|resume|complete> — parse
 * (ScanCodeFormatError), route to the machine methods; complete-without-
 * explicit-times uses the elapsed started_at→now in hours at 6dp (the
 * elapsed lands on run time — setup is captured when the body says so).
 * Idempotent by construction: every action's replay path returns the
 * stored row without duplicate effects.
 */

const DECIMAL6_RE = /^\d+(\.\d{1,6})?$/;
const SCAN_RE = /^OP:([0-9a-fA-F-]{36}):(\d{1,3}):(start|pause|resume|complete)$/;

/** Canonical rounding quanta (ADR-0009): times/rates 6dp, money 4dp. */
function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}
function round4(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Exact 4dp add (the accounting decimal-strings helper, inlined shape). */
function add4(a: string, b: string): string {
  return round4(new Decimal(a).plus(new Decimal(b))).toFixed(4);
}

export interface CompleteOperationInput {
  actualSetupTime: string;
  actualRunTime: string;
  scrapQty?: string | null;
  scrapReasonCode?: string | null;
  actorId: string | null;
}

export interface SkipOperationInput {
  reason: string;
  approvedBy: string;
  actorId: string | null;
}

export interface ScanInput {
  code: string;
  actualSetupTime?: string | null;
  actualRunTime?: string | null;
  scrapQty?: string | null;
  scrapReasonCode?: string | null;
  actorId: string | null;
}

@Injectable()
export class OperationExecutionService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject (the vitest/esbuild
    // pipeline does not emit design:paramtypes — the T-13 boot-regression
    // lesson).
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  // -- the release-time freeze (called by ProductionOrderService.release) ------------

  /**
   * Resolve + freeze: explicit routingId wins (any version of the item —
   * the BOM precedent; a what-if over a DRAFT is legitimate); null opts out
   * (the flat-rate dual mode); undefined auto-binds the item's ACTIVE
   * routing when one exists. Also stamps std_unit_cost from the item's
   * ACTIVE standard (NULL when none — independent of the routing bind).
   */
  async freezeOrderOperations(
    order: ProductionOrderRow,
    routingId: string | null | undefined,
    actorId: string | null,
  ): Promise<{ routingId: string | null; stdUnitCost: string | null }> {
    let routing: RoutingRow | null = null;
    if (routingId !== null && routingId !== undefined) {
      const resolved = await store.findRoutingById(routingId);
      if (resolved === undefined) throw new RoutingNotFoundError(routingId);
      if (resolved.itemId !== order.itemId) {
        throw new RoutingNotFoundError(`routing ${routingId} is not a version of item ${order.itemId}`);
      }
      routing = resolved;
    } else if (routingId === undefined) {
      routing = (await store.findActiveRouting(order.itemId)) ?? null;
    }

    if (routing !== null) {
      const operations = await store.listRoutingOperations(routing.id);
      const rows: store.ProductionOrderOperationInsert[] = [];
      for (const op of operations) {
        const workCenter = await store.findWorkCenterById(op.workCenterId);
        if (workCenter === undefined) {
          throw new RoutingNotFoundError(`work center ${op.workCenterId} of routing ${routing!.id} does not exist`);
        }
        rows.push({
          orderId: order.id,
          routingId: routing.id,
          sequence: op.sequence,
          workCenterId: op.workCenterId,
          // The freeze: routing times + (overrides ?? work-center rates).
          stdSetupTime: op.setupTime,
          stdRunTime: op.runTime,
          stdFixedRate: op.fixedCostRate ?? workCenter.fixedCostRate,
          stdVarRate: op.varCostRate ?? workCenter.varCostRate,
          actorId,
        });
      }
      await store.insertProductionOrderOperations(rows);
    }

    const standard = await store.findActiveStandardCost(order.itemId);
    const stdUnitCost = standard?.totalCost ?? null;
    await store.patchProductionOrder({
      id: order.id,
      routingId: routing?.id ?? null,
      currentOperation: null,
      stdUnitCost,
    });
    return { routingId: routing?.id ?? null, stdUnitCost };
  }

  // -- reads -----------------------------------------------------------------------

  /** The order's operation rows + the order header (the terminal's live view). */
  async listOperations(orderId: string): Promise<{ order: ProductionOrderRow; operations: ProductionOrderOperationRow[] }> {
    const order = await store.findProductionOrderById(orderId);
    if (order === undefined) {
      throw new RoutingNotFoundError(`production order ${orderId} does not exist in this tenant`);
    }
    return { order, operations: await store.listProductionOrderOperations(orderId) };
  }

  // -- the machine -------------------------------------------------------------------

  async startOp(orderId: string, sequence: number, actorId: string | null): Promise<ProductionOrderOperationRow> {
    const { order, op } = await this.requireOperation(orderId, sequence);
    if (op.status === "RUNNING") return op; // idempotent replay
    if (op.status !== "PENDING") {
      throw new OperationStateError(
        `operation ${sequence} of production order ${orderId} is ${op.status} — only PENDING operations start`,
        { orderId, sequence, from: op.status, to: "RUNNING" },
      );
    }
    this.assertOrderExecutable(order, sequence, "start");
    await this.assertSequenceGate(orderId, sequence);
    await store.patchProductionOrderOperation({
      id: op.id,
      status: "RUNNING",
      operatorUserId: actorId,
    });
    await store.patchProductionOrder({ id: orderId, currentOperation: sequence });
    await this.audit.record({
      action: "manufacturing.operation.started",
      entityType: "production_order_operation",
      entityId: op.id,
      actorId: actorId ?? undefined,
      before: { status: "PENDING" },
      after: { status: "RUNNING", sequence, orderId },
    });
    return this.requireOperationAfter(orderId, sequence);
  }

  async pauseOp(orderId: string, sequence: number, actorId: string | null): Promise<ProductionOrderOperationRow> {
    const { op } = await this.requireOperation(orderId, sequence);
    if (op.status === "PAUSED") return op; // idempotent replay
    if (op.status !== "RUNNING") {
      throw new OperationStateError(
        `operation ${sequence} of production order ${orderId} is ${op.status} — only RUNNING operations pause`,
        { orderId, sequence, from: op.status, to: "PAUSED" },
      );
    }
    await store.patchProductionOrderOperation({ id: op.id, status: "PAUSED" });
    await this.audit.record({
      action: "manufacturing.operation.paused",
      entityType: "production_order_operation",
      entityId: op.id,
      actorId: actorId ?? undefined,
      before: { status: "RUNNING" },
      after: { status: "PAUSED", sequence, orderId },
    });
    return this.requireOperationAfter(orderId, sequence);
  }

  async resumeOp(orderId: string, sequence: number, actorId: string | null): Promise<ProductionOrderOperationRow> {
    const { op } = await this.requireOperation(orderId, sequence);
    if (op.status === "RUNNING") return op; // idempotent replay
    if (op.status !== "PAUSED") {
      throw new OperationStateError(
        `operation ${sequence} of production order ${orderId} is ${op.status} — only PAUSED operations resume`,
        { orderId, sequence, from: op.status, to: "RUNNING" },
      );
    }
    await store.patchProductionOrderOperation({ id: op.id, status: "RUNNING" });
    await this.audit.record({
      action: "manufacturing.operation.resumed",
      entityType: "production_order_operation",
      entityId: op.id,
      actorId: actorId ?? undefined,
      before: { status: "PAUSED" },
      after: { status: "RUNNING", sequence, orderId },
    });
    return this.requireOperationAfter(orderId, sequence);
  }

  async completeOp(
    orderId: string,
    sequence: number,
    input: CompleteOperationInput,
  ): Promise<{ operation: ProductionOrderOperationRow; journalEntryId: string | null }> {
    const { order, op } = await this.requireOperation(orderId, sequence);
    if (op.status === "COMPLETED") {
      // INV-013 idempotent replay: the stored row — NO second journal (the
      // `op_<seq>` source operation + the uq journal index back this).
      return { operation: op, journalEntryId: op.journalId };
    }
    if (op.status !== "RUNNING" && op.status !== "PAUSED") {
      throw new OperationStateError(
        `operation ${sequence} of production order ${orderId} is ${op.status} — only RUNNING or PAUSED operations complete`,
        { orderId, sequence, from: op.status, to: "COMPLETED" },
      );
    }
    this.assertOrderExecutable(order, sequence, "complete");
    const actualSetupTime = this.canonicalTime(input.actualSetupTime, "actualSetupTime");
    const actualRunTime = this.canonicalTime(input.actualRunTime, "actualRunTime");
    const scrapQty = this.canonicalScrap(sequence, input.scrapQty ?? null, input.scrapReasonCode ?? null);

    // G-40 amounts (4dp): labor = actual × var_rate; overhead = actual ×
    // fixed_rate; the WIP debit is their exact typed sum (credits == debit
    // by construction; the assert below stays as the guard).
    const conversion = new Decimal(actualSetupTime).plus(new Decimal(actualRunTime));
    const laborValue = round4(conversion.times(new Decimal(op.stdVarRate))).toFixed(4);
    const overheadValue = round4(conversion.times(new Decimal(op.stdFixedRate))).toFixed(4);
    const debit = add4(laborValue, overheadValue);

    let journalEntryId: string | null = null;
    if (new Decimal(debit).greaterThan(0)) {
      const lines: JournalLineSpec[] = [
        {
          purpose: "WIP",
          direction: "DEBIT",
          amount: debit,
          memo: {
            en: `Production order ${order.orderNo ?? orderId} — operation ${sequence} conversion to WIP`,
            ar: `أمر إنتاج ${order.orderNo ?? orderId} — تحويل العملية ${sequence} إلى تحت التشغيل`,
          },
        },
      ];
      if (new Decimal(laborValue).greaterThan(0)) {
        lines.push({
          purpose: "PRODUCTION_LABOR",
          direction: "CREDIT",
          amount: laborValue,
          memo: {
            en: `Production order ${order.orderNo ?? orderId} — operation ${sequence} labor`,
            ar: `أمر إنتاج ${order.orderNo ?? orderId} — أجور العملية ${sequence}`,
          },
        });
      }
      if (new Decimal(overheadValue).greaterThan(0)) {
        lines.push({
          purpose: "PRODUCTION_OVERHEAD",
          direction: "CREDIT",
          amount: overheadValue,
          memo: {
            en: `Production order ${order.orderNo ?? orderId} — operation ${sequence} overhead`,
            ar: `أمر إنتاج ${order.orderNo ?? orderId} — مصاريف العملية ${sequence}`,
          },
        });
      }
      const creditsSum = add4(
        new Decimal(laborValue).greaterThan(0) ? laborValue : "0",
        new Decimal(overheadValue).greaterThan(0) ? overheadValue : "0",
      );
      if (creditsSum !== debit) {
        throw new OperationCostRoundingError({ debit, credits: creditsSum });
      }
      const spec: JournalSpec = {
        source: { docType: "production_order", docId: orderId, operation: `op_${sequence}` },
        entryDate: this.today(),
        description: {
          en: `Production order ${order.orderNo ?? orderId} — operation ${sequence} completion`,
          ar: `أمر إنتاج ${order.orderNo ?? orderId} — إكمال العملية ${sequence}`,
        },
        currency: await ownTenantBaseCurrency(),
        lines,
      };
      const posted = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = posted.journalEntryId;
    }

    // Variance columns (M-13/M-19) — see the class doc for the formulas and
    // the qtyBasis rationale (running actual qty mid-order; the order-level
    // yield variance at completion catches the rest). rate_variance = 0 in
    // v1: the std rates ARE the actual rates (work-center rate changes
    // mid-order are the PHASE-043 concern).
    const setupVariance = round4(
      new Decimal(actualSetupTime)
        .minus(new Decimal(op.stdSetupTime))
        .times(new Decimal(op.stdFixedRate).plus(new Decimal(op.stdVarRate))),
    ).toFixed(4);
    const qtyBasis = new Decimal(order.actualQty).greaterThan(0) ? order.actualQty : order.plannedQty;
    const usageVariance = round4(
      new Decimal(actualRunTime)
        .minus(new Decimal(op.stdRunTime).times(qtyBasis))
        .times(new Decimal(op.stdVarRate)),
    ).toFixed(4);

    await store.patchProductionOrderOperation({
      id: op.id,
      status: "COMPLETED",
      actualSetupTime,
      actualRunTime,
      setupVariance,
      usageVariance,
      rateVariance: "0.0000",
      ...(scrapQty === undefined ? {} : { scrapQty: scrapQty.qty, scrapReasonCode: scrapQty.reasonCode }),
      ...(journalEntryId === null ? {} : { journalId: journalEntryId }),
    });
    await this.advanceCurrentOperation(orderId, sequence);
    await this.audit.record({
      action: "manufacturing.operation.completed",
      entityType: "production_order_operation",
      entityId: op.id,
      actorId: input.actorId ?? undefined,
      before: { status: op.status },
      after: {
        status: "COMPLETED",
        sequence,
        orderId,
        actualSetupTime,
        actualRunTime,
        setupVariance,
        usageVariance,
        rateVariance: "0.0000",
        laborValue,
        overheadValue,
        debit,
        journalEntryId,
      },
    });
    return { operation: await this.requireOperationAfter(orderId, sequence), journalEntryId };
  }

  async skipOp(orderId: string, sequence: number, input: SkipOperationInput): Promise<ProductionOrderOperationRow> {
    const { op } = await this.requireOperation(orderId, sequence);
    if (op.status === "SKIPPED") return op; // idempotent replay
    if (op.status === "COMPLETED") {
      throw new OperationStateError(
        `operation ${sequence} of production order ${orderId} is COMPLETED — completed operations never skip`,
        { orderId, sequence, from: op.status, to: "SKIPPED" },
      );
    }
    const reason = (input.reason ?? "").trim();
    if (reason === "" || reason.length > 500) {
      throw new OperationStateError("a skip reason of 1..500 chars is required", { orderId, sequence });
    }
    // SoD (BR-034 house pattern): a real ACTIVE user, distinct from the actor.
    const approver = await store.findUserForApproval(input.approvedBy);
    if (approver === undefined) throw new ApproverNotFoundError(input.approvedBy);
    if (approver.status !== "ACTIVE") throw new ApproverNotFoundError(input.approvedBy);
    if (input.actorId !== null && input.approvedBy === input.actorId) {
      throw new SelfApprovalBlockedError(input.approvedBy);
    }
    await store.patchProductionOrderOperation({
      id: op.id,
      status: "SKIPPED",
      skipReason: reason,
      skipApprovedBy: input.approvedBy,
    });
    await this.advanceCurrentOperation(orderId, sequence);
    await this.audit.record({
      action: "manufacturing.operation.skipped",
      entityType: "production_order_operation",
      entityId: op.id,
      actorId: input.actorId ?? undefined,
      before: { status: op.status },
      after: { status: "SKIPPED", sequence, orderId, reason, approvedBy: input.approvedBy },
    });
    return this.requireOperationAfter(orderId, sequence);
  }

  // -- the shop-floor scan (M-17) ------------------------------------------------------

  async scan(input: ScanInput): Promise<{ operation: ProductionOrderOperationRow; journalEntryId: string | null; action: string }> {
    const match = SCAN_RE.exec(input.code.trim());
    if (match === null) throw new ScanCodeFormatError(input.code);
    const orderId = match[1]!;
    const sequence = Number(match[2]!);
    const action = match[3]! as "start" | "pause" | "resume" | "complete";
    if (action === "complete") {
      // Elapsed capture: started_at → now in hours at 6dp, landing on run
      // time (setup is captured when the body says so) — the elapsed lands
      // whole on the run leg; Decimal over the integer ms delta, no floats.
      const { op } = await this.requireOperation(orderId, sequence);
      let actualSetupTime = input.actualSetupTime ?? null;
      let actualRunTime = input.actualRunTime ?? null;
      if (actualRunTime === null) {
        const startedAt = op.startedAt !== null ? Date.parse(op.startedAt) : null;
        const elapsedHours =
          startedAt !== null && Number.isFinite(startedAt)
            ? round6(new Decimal(Date.now() - startedAt).div(3600000)).toFixed(6)
            : "0";
        actualRunTime = elapsedHours;
      }
      if (actualSetupTime === null) actualSetupTime = "0";
      const result = await this.completeOp(orderId, sequence, {
        actualSetupTime,
        actualRunTime,
        scrapQty: input.scrapQty ?? null,
        scrapReasonCode: input.scrapReasonCode ?? null,
        actorId: input.actorId,
      });
      return { ...result, action };
    }
    if (action === "start") {
      return { operation: await this.startOp(orderId, sequence, input.actorId), journalEntryId: null, action };
    }
    if (action === "pause") {
      return { operation: await this.pauseOp(orderId, sequence, input.actorId), journalEntryId: null, action };
    }
    return { operation: await this.resumeOp(orderId, sequence, input.actorId), journalEntryId: null, action };
  }

  // -- shared helpers -------------------------------------------------------------------

  private async requireOperation(
    orderId: string,
    sequence: number,
  ): Promise<{ order: ProductionOrderRow; op: ProductionOrderOperationRow }> {
    const order = await store.findProductionOrderById(orderId);
    if (order === undefined) {
      throw new OperationNotFoundError(orderId, sequence);
    }
    const op = await store.findProductionOrderOperation(orderId, sequence);
    if (op === undefined) throw new OperationNotFoundError(orderId, sequence);
    return { order, op };
  }

  /** Re-read one operation by (order, sequence) after a mutation — the
   * store keys operation reads by the order+sequence pair. */
  private async requireOperationAfter(
    orderId: string,
    sequence: number,
  ): Promise<ProductionOrderOperationRow> {
    const op = await store.findProductionOrderOperation(orderId, sequence);
    if (op === undefined) throw new OperationNotFoundError(orderId, sequence);
    return op;
  }

  /** The order must be live for shop-floor actions (not CANCELLED/COMPLETED). */
  private assertOrderExecutable(order: ProductionOrderRow, sequence: number, action: string): void {
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      throw new OperationStateError(
        `production order ${order.orderNo ?? order.id} is ${order.status} — operations cannot ${action}`,
        { orderId: order.id, sequence, orderStatus: order.status },
      );
    }
  }

  /** INV-028: every lower-sequence operation must be COMPLETED or SKIPPED. */
  private async assertSequenceGate(orderId: string, sequence: number): Promise<void> {
    const operations = await store.listProductionOrderOperations(orderId);
    for (const op of operations) {
      if (op.sequence < sequence && op.status !== "COMPLETED" && op.status !== "SKIPPED") {
        throw new OperationSequenceError({
          orderId,
          sequence,
          blockedBy: op.sequence,
          blockedByStatus: op.status,
        });
      }
    }
  }

  /** Advance current_operation to the next non-terminal sequence (or stay at
   * the last resolved one when none remain — completed or skipped). */
  private async advanceCurrentOperation(orderId: string, sequence: number): Promise<void> {
    const operations = await store.listProductionOrderOperations(orderId);
    const next = operations.find(
      (op) => op.sequence > sequence && op.status !== "COMPLETED" && op.status !== "SKIPPED",
    );
    await store.patchProductionOrder({ id: orderId, currentOperation: next?.sequence ?? sequence });
  }

  private canonicalTime(raw: string, what: string): string {
    if (!DECIMAL6_RE.test(raw) || new Decimal(raw).lessThan(0)) {
      throw new OperationStateError(`${what} must be a non-negative decimal (≤ 6dp): ${raw}`);
    }
    return new Decimal(raw).toFixed(6);
  }

  /** Scrap > 0 requires its reason (the 0065 CHECK floor mirrored). */
  private canonicalScrap(
    sequence: number,
    scrapQty: string | null,
    scrapReasonCode: string | null,
  ): { qty: string; reasonCode: string | null } | undefined {
    if (scrapQty === null) return undefined;
    if (!DECIMAL6_RE.test(scrapQty) || new Decimal(scrapQty).lessThan(0)) {
      throw new OperationStateError(`scrapQty must be a non-negative decimal (≤ 6dp): ${scrapQty}`);
    }
    const qty = new Decimal(scrapQty).toFixed(6);
    const reasonCode = (scrapReasonCode ?? "").trim();
    if (new Decimal(qty).greaterThan(0) && reasonCode === "") {
      throw new OperationScrapReasonRequiredError(sequence);
    }
    return { qty, reasonCode: reasonCode === "" ? null : reasonCode.slice(0, 40) };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
