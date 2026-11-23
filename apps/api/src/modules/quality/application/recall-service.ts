/**
 * PHASE-050 (W-28 — T-14, 2026-11-23) THE RECALL SERVICE — Q-09/Q-12:
 * the traceability drill batch → where-used → customers, built ON the
 * existing batch/serial ledger (D-14: the genealogy walk is the
 * manufacturing module's OWN read — consumed VERBATIM, zero parallel
 * computation; the customer resolution is this module's own doc→partner
 * lookup, the §10 boundary's designated consumer). THE DRILL RECORD IS
 * DISTINCT FROM THE DRILL QUERY (D-14): `drill()` is the LIVE read
 * (never writes); initiate/execute/close ride the registry's own CAS
 * ladder with the FROZEN snapshots landing at the execute act (the
 * executed paths' own record, single-use, never re-frozen).
 */
import { Inject, Injectable } from "@nestjs/common";

import { NumberingService } from "../../accounting/application/numbering-service";
import { AuditService } from "../../audit/api/audit";
import { GenealogyService } from "../../manufacturing/application/genealogy-service";

import { foldRecallCustomers, nextRecallMove, type DrillCustomerScope } from "../domain/recall-scope";
import {
  GenealogyBatchNotFoundError,
} from "../../manufacturing/domain/manufacturing-errors";
import {
  QualityInputInvalidError,
  RecallRecordNotFoundError,
  RecallStateError,
} from "../domain/quality-errors";
import * as store from "../infrastructure/quality.store";

/** Official recall numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention — the NCR precedent). */
export const RECALL_NUMBER_FORMAT = {
  prefix: "REC",
  format: "REC-{YYYY}-{SEQ:6}",
  docType: "recall_registry",
} as const;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new QualityInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

/** The live drill's answer (the query — never writes; the execute act
 * freezes this shape into the registry row). */
export interface RecallDrillResult {
  batch: { batchId: string; batchNo: string; itemId: string; sku: string; status: string };
  /** The where-used chain — the genealogy walk VERBATIM. */
  whereUsed: {
    productions: {
      level: number;
      fromBatchId: string;
      orderId: string;
      orderNo: string | null;
      fgBatchId: string | null;
      qty: string;
    }[];
    sales: {
      level: number;
      batchId: string;
      docType: "sales_invoice" | "delivery_note";
      docId: string;
      docDate: string;
      qty: string;
    }[];
  };
  /** The customers who received the batch — the fold's deduped shape. */
  customers: DrillCustomerScope[];
}

@Injectable()
export class RecallService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(GenealogyService) private readonly genealogy: GenealogyService,
  ) {}

  /** THE DRILL QUERY (D-14 — the live read): the genealogy walk + the
   * customer fold. Index-driven by construction (ix_stock_moves_
   * tenant_batch · ix_production_consumptions_tenant_batch — the OA-06
   * budget is W-31's EXPLAIN arm over this same read). */
  async drill(batchId: string): Promise<RecallDrillResult> {
    requireUuid(batchId, "batchId");
    let downstream;
    try {
      downstream = await this.genealogy.downstream(batchId);
    } catch (error) {
      if (error instanceof GenealogyBatchNotFoundError) {
        throw new QualityInputInvalidError({
          field: "batchId",
          reason: `batch ${batchId} does not exist in this tenant`,
        });
      }
      throw error;
    }
    const docRefs = downstream.sales.map((edge) => ({
      docType: edge.docType,
      docId: edge.docId,
    }));
    const docs = await store.listRecallDocCustomers(docRefs);
    const customers = foldRecallCustomers(downstream.sales, docs);
    return {
      batch: {
        batchId: downstream.batch.batchId,
        batchNo: downstream.batch.batchNo,
        itemId: downstream.batch.itemId,
        sku: downstream.batch.sku,
        status: downstream.batch.status,
      },
      whereUsed: {
        productions: downstream.productions.map((edge) => ({
          level: edge.level,
          fromBatchId: edge.fromBatchId,
          orderId: edge.orderId,
          orderNo: edge.orderNo,
          fgBatchId: edge.fgBatchId,
          qty: edge.qty,
        })),
        sales: downstream.sales.map((edge) => ({
          level: edge.level,
          batchId: edge.batchId,
          docType: edge.docType,
          docId: edge.docId,
          docDate: edge.docDate,
          qty: edge.qty,
        })),
      },
      customers,
    };
  }

  /** The drill's RECORD opens (the live query stays available beside
   * it): INITIATED, the official REC number. */
  async initiate(input: {
    batchId: string;
    reason: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.RecallRegistryRow> {
    requireUuid(input.batchId, "batchId");
    if (input.reason.trim().length === 0 || input.reason.length > 2000) {
      throw new QualityInputInvalidError({
        field: "reason",
        reason: "the recall reason is required (1…2000 chars)",
      });
    }
    // The batch's typed pre-check through the drill's own read (the
    // genealogy's not-found is the honest refusal).
    await this.drill(input.batchId);
    const year = String(new Date().getUTCFullYear());
    const acquired = await this.numbering.reserve({
      docType: RECALL_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: RECALL_NUMBER_FORMAT.format,
      prefix: RECALL_NUMBER_FORMAT.prefix,
      year,
    });
    const row = await store.insertRecall({
      recallNo: acquired.number,
      batchId: input.batchId,
      reason: input.reason,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.numbering.bind(RECALL_NUMBER_FORMAT.docType, acquired.number, row.id);
    await this.audit.record({
      action: "quality.recall_initiated",
      entityType: "recall_registry",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { recallNo: row.recallNo, batchId: row.batchId, reason: row.reason },
    });
    return row;
  }

  async list(filter: {
    status?: string;
    batchId?: string;
    limit?: number;
  }): Promise<store.RecallRegistryRow[]> {
    return store.listRecalls({
      status: filter.status,
      batchId: filter.batchId,
      limit: filter.limit ?? 200,
    });
  }

  async find(id: string): Promise<store.RecallRegistryRow> {
    const row = await store.findRecallById(requireUuid(id, "id"));
    if (row === undefined) throw new RecallRecordNotFoundError({ recallId: id });
    return row;
  }

  /** THE EXECUTE ACT: the drill runs LIVE and its answer FREEZES into
   * the registry row (the scope + the affected customers — the executed
   * paths' own record, single-use; a later drill never moves a stored
   * snapshot). */
  async execute(input: {
    recallId: string;
    actorId: string | null;
  }): Promise<store.RecallRegistryRow> {
    const current = await this.find(input.recallId);
    const verdict = nextRecallMove(current.status, "execute");
    if (!verdict.allowed) {
      throw new RecallStateError({
        recallId: input.recallId,
        status: current.status,
        reason: verdict.reason ?? "the execute move is not available on this rung",
      });
    }
    const drillResult = await this.drill(current.batchId);
    // THE SCOPE SNAPSHOT (0116's ck_recall_registry_scope_shape demands a
    // jsonb ARRAY — the honest shape): one kind-tagged entry per
    // where-used edge — the productions that consumed the batch and the
    // sales documents that shipped it — plus the frozenAt witness. The
    // customer side rides affected_customers (its own array).
    const scope = [
      ...drillResult.whereUsed.productions.map((edge) => ({
        kind: "production" as const,
        level: edge.level,
        fromBatchId: edge.fromBatchId,
        orderId: edge.orderId,
        orderNo: edge.orderNo,
        fgBatchId: edge.fgBatchId,
        qty: edge.qty,
      })),
      ...drillResult.whereUsed.sales.map((edge) => ({
        kind: "sale" as const,
        level: edge.level,
        batchId: edge.batchId,
        docType: edge.docType,
        docId: edge.docId,
        docDate: edge.docDate,
        qty: edge.qty,
      })),
      { kind: "witness" as const, frozenAt: new Date().toISOString() },
    ];
    const row = await store.stampRecallExecuted({
      id: input.recallId,
      scope,
      affectedCustomers: drillResult.customers,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new RecallStateError({
        recallId: input.recallId,
        status: current.status,
        reason: "the execute stamp raced — reload and retry",
      });
    }
    await this.audit.record({
      action: "quality.recall_executed",
      entityType: "recall_registry",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        recallNo: row.recallNo,
        customers: drillResult.customers.length,
        productions: drillResult.whereUsed.productions.length,
        sales: drillResult.whereUsed.sales.length,
      },
    });
    return row;
  }

  async close(input: { recallId: string; actorId: string | null }): Promise<store.RecallRegistryRow> {
    const current = await this.find(input.recallId);
    const verdict = nextRecallMove(current.status, "close");
    if (!verdict.allowed) {
      throw new RecallStateError({
        recallId: input.recallId,
        status: current.status,
        reason: verdict.reason ?? "the close move is not available on this rung",
      });
    }
    const row = await store.stampRecallClosed({
      id: input.recallId,
      updatedBy: input.actorId,
    });
    if (row === undefined) {
      throw new RecallStateError({
        recallId: input.recallId,
        status: current.status,
        reason: "the close stamp raced — reload and retry",
      });
    }
    await this.audit.record({
      action: "quality.recall_closed",
      entityType: "recall_registry",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { status: row.status, closedAt: row.closedAt },
    });
    return row;
  }
}
