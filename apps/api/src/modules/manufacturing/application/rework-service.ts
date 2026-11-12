import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/manufacturing.store";
import type { ReworkOrderRow, RoutingOperationRow } from "../infrastructure/manufacturing.store";
import {
  ProductionOrderNotFoundError,
  ReworkCostZeroError,
  ReworkItemMismatchError,
  ReworkOrderNotFoundError,
  ReworkOrderStateError,
  RoutingNotFoundError,
} from "../domain/manufacturing-errors";

/**
 * Rework service (PHASE-042 M-14): rework orders reference a defective
 * batch/serial and their parent production order, carry their OWN routing,
 * and post their conversion cost to REWORK_EXPENSE — NEVER capitalized into
 * the parent FG layer (BR-069: the journal touches only REWORK_EXPENSE /
 * PRODUCTION_LABOR / PRODUCTION_OVERHEAD — the parent order's WIP/FG
 * accounts are byte-identical before/after; the rework spec pins it).
 *
 * Lifecycle: DRAFT → RELEASED (RW- number via NumberingService docType
 * "rework_order", prefix RW-, the PRD per-branch/year shape) → IN_PROGRESS
 * → COMPLETED | CANCELLED. The v1 simplicity rule (documented decision):
 * the rework item MUST equal the parent order's item — component rework
 * rides stock issues, not rework orders.
 *
 * Release freeze: the rework's single std_* column set carries the AGGREGATE
 * over its routing's operations at the rework qty — std_setup = Σ setup;
 * std_run = Σ (run × qty) (run_time is hours per UNIT); the rates are the
 * TIME-WEIGHTED blend over the operations (weight_i = setup_i + run_i ×
 * qty, rate from the override ?? the work center) so that
 * blended_rate × aggregate_time reproduces Σ per-operation cost before
 * rounding — honest for single-operation routings (the common case) and
 * documented for multi-operation ones. A rework WITHOUT a routing freezes
 * zeros — and can then never complete (rework_value > 0 is the completion
 * floor): a rework that cost nothing did not happen.
 *
 * Completion posts G-41 (source rework_order, operation "complete"):
 * DR REWORK_EXPENSE reworkValue · CR PRODUCTION_LABOR laborValue ·
 * CR PRODUCTION_OVERHEAD overheadValue (zero legs skipped; reworkValue > 0
 * guarantees at least one leg). INV-013: complete-on-COMPLETED returns the
 * stored row — never a second journal.
 */

const REWORK_FORMAT = { prefix: "RW", format: "RW-{YYYY}-{SEQ:5}", docType: "rework_order" };
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const TIME_RE = /^\d+(\.\d{1,6})?$/;

/** Canonical rounding quanta (ADR-0009): times/rates 6dp, money 4dp. */
function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}
function round4(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export interface CreateReworkInput {
  parentOrderId: string;
  batchId?: string | null;
  defectRef: string;
  qty: string;
  routingId?: string | null;
  defectReasonCode?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class ReworkService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject (the vitest/esbuild
    // pipeline does not emit design:paramtypes — the T-13 boot lesson).
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<ReworkOrderRow> {
    const rework = await store.findReworkOrderById(id);
    if (rework === undefined) throw new ReworkOrderNotFoundError(id);
    return rework;
  }

  async list(filter: { status?: string; limit: number }): Promise<ReworkOrderRow[]> {
    return store.listReworkOrders(filter);
  }

  // -- create (DRAFT; NO number yet — release reserves it) ------------------------

  async create(input: CreateReworkInput): Promise<ReworkOrderRow> {
    const parent = await store.findProductionOrderById(input.parentOrderId);
    if (parent === undefined) throw new ProductionOrderNotFoundError(input.parentOrderId);
    if (parent.status !== "COMPLETED") {
      throw new ReworkOrderStateError(
        `parent production order ${input.parentOrderId} is ${parent.status} — rework attaches to COMPLETED orders only`,
        { parentOrderId: input.parentOrderId, parentStatus: parent.status },
      );
    }
    // The v1 rule: the rework item is the parent's item (enforced — the
    // caller does not even pass an item; the parent's row is the source).
    const itemId = parent.itemId;
    if (!QTY_RE.test(input.qty) || new Decimal(input.qty).lessThanOrEqualTo(0)) {
      throw new ReworkOrderStateError(`rework qty must be a positive decimal (≤ 6dp): ${input.qty}`);
    }
    const defectRef = (input.defectRef ?? "").trim();
    if (defectRef.length < 1 || defectRef.length > 120) {
      throw new ReworkOrderStateError(`defectRef must be 1..120 chars — got ${defectRef.length}`);
    }
    if (input.batchId != null) {
      const batch = await store.findBatchForRework(input.batchId);
      if (batch === undefined || batch.itemId !== itemId) {
        throw new ReworkItemMismatchError(itemId, batch?.itemId ?? input.batchId);
      }
    }
    if (input.routingId !== null && input.routingId !== undefined) {
      const routing = await store.findRoutingById(input.routingId);
      if (routing === undefined) throw new RoutingNotFoundError(input.routingId);
      if (routing.itemId !== itemId) {
        throw new RoutingNotFoundError(`routing ${input.routingId} is not a version of item ${itemId}`);
      }
    }
    const created = await store.insertReworkOrder({
      parentOrderId: input.parentOrderId,
      itemId,
      batchId: input.batchId ?? null,
      defectRef,
      qty: new Decimal(input.qty).toFixed(6),
      uomId: parent.uomId,
      routingId: input.routingId ?? null,
      defectReasonCode: input.defectReasonCode ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "manufacturing.rework_order.created",
      entityType: "rework_order",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { parentOrderId: input.parentOrderId, itemId, qty: created.qty, defectRef, status: "DRAFT" },
    });
    return created;
  }

  // -- release (DRAFT → RELEASED: RW- number + the aggregate std freeze) -----------

  async release(id: string, actorId: string | null): Promise<ReworkOrderRow> {
    const rework = await this.find(id);
    if (rework.status === "RELEASED") return rework; // INV-013 idempotent replay
    if (rework.status !== "DRAFT") {
      throw new ReworkOrderStateError(
        `rework order ${id} is ${rework.status} — only DRAFT rework orders release`,
        { reworkOrderId: id, from: rework.status, to: "RELEASED" },
      );
    }
    // The aggregate freeze over the rework's routing (see the class doc for
    // the formula + the time-weighted blend rationale).
    let stdSetupTime = "0";
    let stdRunTime = "0";
    let stdFixedRate = "0";
    let stdVarRate = "0";
    if (rework.routingId !== null) {
      const routing = await store.findRoutingById(rework.routingId);
      if (routing === undefined) throw new RoutingNotFoundError(rework.routingId);
      const frozen = await this.freezeAggregate(routing.id, rework.qty);
      stdSetupTime = frozen.stdSetupTime;
      stdRunTime = frozen.stdRunTime;
      stdFixedRate = frozen.stdFixedRate;
      stdVarRate = frozen.stdVarRate;
    }
    const parent = await store.findProductionOrderById(rework.parentOrderId);
    if (parent === undefined) throw new ProductionOrderNotFoundError(rework.parentOrderId);
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: REWORK_FORMAT.docType,
      branchId: parent.branchId,
      periodKey: year,
      format: REWORK_FORMAT.format,
      prefix: REWORK_FORMAT.prefix,
      year,
    });
    await this.numbering.bind(REWORK_FORMAT.docType, acquired.number, id);
    await store.patchReworkOrder({
      id,
      status: "RELEASED",
      reworkNo: acquired.number,
      stdSetupTime,
      stdRunTime,
      stdFixedRate,
      stdVarRate,
    });
    await this.audit.record({
      action: "manufacturing.rework_order.released",
      entityType: "rework_order",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: {
        status: "RELEASED",
        reworkNo: acquired.number,
        stdSetupTime,
        stdRunTime,
        stdFixedRate,
        stdVarRate,
      },
    });
    return this.find(id);
  }

  // -- start (RELEASED → IN_PROGRESS) ----------------------------------------------

  async start(id: string, actorId: string | null): Promise<ReworkOrderRow> {
    const rework = await this.find(id);
    if (rework.status === "IN_PROGRESS") return rework; // idempotent replay
    if (rework.status !== "RELEASED") {
      throw new ReworkOrderStateError(`rework order ${id} is ${rework.status} — only RELEASED rework orders start`, {
        reworkOrderId: id,
        from: rework.status,
        to: "IN_PROGRESS",
      });
    }
    await store.patchReworkOrder({ id, status: "IN_PROGRESS" });
    await this.audit.record({
      action: "manufacturing.rework_order.started",
      entityType: "rework_order",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "RELEASED" },
      after: { status: "IN_PROGRESS", reworkNo: rework.reworkNo },
    });
    return this.find(id);
  }

  // -- complete (IN_PROGRESS → COMPLETED; G-41) --------------------------------------

  async complete(
    id: string,
    input: { actualSetupTime: string; actualRunTime: string; actorId: string | null },
  ): Promise<{ rework: ReworkOrderRow; journalEntryId: string }> {
    let rework = await this.find(id);
    if (rework.status === "COMPLETED") {
      // INV-013 idempotent replay: the stored row — NO second journal.
      return { rework, journalEntryId: rework.journalId ?? "" };
    }
    if (rework.status !== "IN_PROGRESS") {
      throw new ReworkOrderStateError(
        `rework order ${id} is ${rework.status} — only IN_PROGRESS rework orders complete`,
        { reworkOrderId: id, from: rework.status, to: "COMPLETED" },
      );
    }
    if (!TIME_RE.test(input.actualSetupTime) || new Decimal(input.actualSetupTime).lessThan(0)) {
      throw new ReworkOrderStateError(`actualSetupTime must be a non-negative decimal (≤ 6dp): ${input.actualSetupTime}`);
    }
    if (!TIME_RE.test(input.actualRunTime) || new Decimal(input.actualRunTime).lessThan(0)) {
      throw new ReworkOrderStateError(`actualRunTime must be a non-negative decimal (≤ 6dp): ${input.actualRunTime}`);
    }
    const actualSetupTime = new Decimal(input.actualSetupTime).toFixed(6);
    const actualRunTime = new Decimal(input.actualRunTime).toFixed(6);
    // The same rate semantics as order operations: labor = actual × var,
    // overhead = actual × fixed, rework = the typed sum.
    const conversion = new Decimal(actualSetupTime).plus(new Decimal(actualRunTime));
    const laborValue = round4(conversion.times(new Decimal(rework.stdVarRate))).toFixed(4);
    const overheadValue = round4(conversion.times(new Decimal(rework.stdFixedRate))).toFixed(4);
    const reworkValue = round4(new Decimal(laborValue).plus(new Decimal(overheadValue))).toFixed(4);
    if (new Decimal(reworkValue).lessThanOrEqualTo(0)) {
      // ck_rework_orders_completion requires rework_value > 0 — honest
      // typed rejection before any SQL (a rework that cost nothing did not
      // happen).
      throw new ReworkCostZeroError(id);
    }
    const lines: JournalLineSpec[] = [
      {
        purpose: "REWORK_EXPENSE",
        direction: "DEBIT",
        amount: reworkValue,
        memo: {
          en: `Rework order ${rework.reworkNo ?? id} — rework conversion cost`,
          ar: `أمر إعادة تشغيل ${rework.reworkNo ?? id} — تكلفة إعادة التشغيل`,
        },
      },
    ];
    if (new Decimal(laborValue).greaterThan(0)) {
      lines.push({
        purpose: "PRODUCTION_LABOR",
        direction: "CREDIT",
        amount: laborValue,
        memo: {
          en: `Rework order ${rework.reworkNo ?? id} — rework labor`,
          ar: `أمر إعادة تشغيل ${rework.reworkNo ?? id} — أجور إعادة التشغيل`,
        },
      });
    }
    if (new Decimal(overheadValue).greaterThan(0)) {
      lines.push({
        purpose: "PRODUCTION_OVERHEAD",
        direction: "CREDIT",
        amount: overheadValue,
        memo: {
          en: `Rework order ${rework.reworkNo ?? id} — rework overhead`,
          ar: `أمر إعادة تشغيل ${rework.reworkNo ?? id} — مصاريف إعادة التشغيل`,
        },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "rework_order", docId: id, operation: "complete" },
      entryDate: new Date().toISOString().slice(0, 10),
      description: {
        en: `Rework order ${rework.reworkNo ?? id} — completion`,
        ar: `أمر إعادة تشغيل ${rework.reworkNo ?? id} — الإكمال`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    await store.patchReworkOrder({
      id,
      status: "COMPLETED",
      actualSetupTime,
      actualRunTime,
      laborValue,
      overheadValue,
      reworkValue,
      journalId: posted.journalEntryId,
    });
    await this.audit.record({
      action: "manufacturing.rework_order.completed",
      entityType: "rework_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: "IN_PROGRESS" },
      after: {
        status: "COMPLETED",
        reworkNo: rework.reworkNo,
        laborValue,
        overheadValue,
        reworkValue,
        journalEntryId: posted.journalEntryId,
      },
    });
    rework = await this.find(id);
    return { rework, journalEntryId: posted.journalEntryId };
  }

  // -- cancel (DRAFT/RELEASED/IN_PROGRESS; zero effects — nothing posted yet) --------

  async cancel(id: string, input: { reason: string; actorId: string | null }): Promise<ReworkOrderRow> {
    const rework = await this.find(id);
    const reason = (input.reason ?? "").trim();
    if (reason === "" || reason.length > 500) {
      throw new ReworkOrderStateError("a cancel reason of 1..500 chars is required");
    }
    if (rework.status === "COMPLETED") {
      throw new ReworkOrderStateError(
        `rework order ${id} is COMPLETED — the G-41 journal is posted; corrections are reversals, never cancels`,
        { reworkOrderId: id, from: rework.status, to: "CANCELLED" },
      );
    }
    if (rework.status === "CANCELLED") return rework; // idempotent replay
    // No journal was posted before completion — the cancel is pure state
    // (zero effects by construction).
    await store.patchReworkOrder({ id, status: "CANCELLED", cancelReason: reason });
    await this.audit.record({
      action: "manufacturing.rework_order.cancelled",
      entityType: "rework_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: rework.status },
      after: { status: "CANCELLED", reworkNo: rework.reworkNo, reason },
    });
    return this.find(id);
  }

  // -- the aggregate freeze ------------------------------------------------------------

  private async freezeAggregate(
    routingId: string,
    qty: string,
  ): Promise<{ stdSetupTime: string; stdRunTime: string; stdFixedRate: string; stdVarRate: string }> {
    const operations: RoutingOperationRow[] = await store.listRoutingOperations(routingId);
    let setupSum = new Decimal(0);
    let runSum = new Decimal(0);
    let fixedWeighted = new Decimal(0);
    let varWeighted = new Decimal(0);
    let weightSum = new Decimal(0);
    for (const op of operations) {
      const workCenter = await store.findWorkCenterById(op.workCenterId);
      const fixedRate = op.fixedCostRate ?? workCenter?.fixedCostRate ?? "0";
      const varRate = op.varCostRate ?? workCenter?.varCostRate ?? "0";
      const opSetup = new Decimal(op.setupTime);
      const opRun = new Decimal(op.runTime).times(new Decimal(qty));
      const weight = opSetup.plus(opRun);
      setupSum = setupSum.plus(opSetup);
      runSum = runSum.plus(opRun);
      fixedWeighted = fixedWeighted.plus(weight.times(new Decimal(fixedRate)));
      varWeighted = varWeighted.plus(weight.times(new Decimal(varRate)));
      weightSum = weightSum.plus(weight);
    }
    const blendedFixed = weightSum.isZero() ? new Decimal(0) : round6(fixedWeighted.div(weightSum));
    const blendedVar = weightSum.isZero() ? new Decimal(0) : round6(varWeighted.div(weightSum));
    return {
      stdSetupTime: round6(setupSum).toFixed(6),
      stdRunTime: round6(runSum).toFixed(6),
      stdFixedRate: blendedFixed.toFixed(6),
      stdVarRate: blendedVar.toFixed(6),
    };
  }
}
