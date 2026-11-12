import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/manufacturing.store";
import type { RoutingOperationRow, RoutingRow } from "../infrastructure/manufacturing.store";
import {
  RoutingActiveExistsError,
  RoutingNotFoundError,
  RoutingNotDraftError,
  RoutingOperationInvalidError,
  RoutingVersionConflictError,
  WorkCenterNotActiveError,
} from "../domain/manufacturing-errors";

/**
 * Routing service (PHASE-042 M-02): versioned routings per item — the BOM
 * discipline mirrored exactly (bom-service.ts): DRAFT → ACTIVE → ARCHIVED
 * with exactly one ACTIVE version per item (the partial unique index backs
 * the invariant; activate archives the previous ACTIVE in the same call),
 * versionNo monotonic per (tenant, item) across ALL versions (DRAFT
 * included), DRAFT-only full-replace edits (DELETE+INSERT on
 * routing_operations — the bom_lines precedent; routing_operations carries
 * the DELETE grant for exactly this).
 *
 * The routing NEVER posts a journal and never touches stock — it is planning
 * data (CAPABILITY_MATRIX §2.4 shape); only the order operations (the
 * release-time freeze in OperationExecutionService) reach the posting
 * engine, binding the version and snapshotting the std columns at release so
 * later routing edits never move a live order.
 *
 * Semantics (0065): setup_time is hours per BATCH, run_time is hours per
 * UNIT; the per-operation rate overrides are NULL = inherit the work
 * center's rates and travel as a pair (both or neither, ≥ 0). Sequences are
 * unique, 1..999. output_uom must equal the item's base uom (the PHASE-018
 * no-conversion-seam rule).
 */

const DECIMAL6_RE = /^\d+(\.\d{1,6})?$/;

/** 23505 = unique_violation; unwraps driver causes (the bom-service helper). */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

export interface RoutingOperationInput {
  sequence: number;
  workCenterId: string;
  /** Hours per batch — numeric(19,6) ≥ 0. */
  setupTime: string;
  /** Hours per unit — numeric(19,6) ≥ 0. */
  runTime: string;
  /** NULL = inherit the work center's rate; overrides travel as a pair. */
  fixedCostRate?: string | null;
  varCostRate?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
}

export interface CreateRoutingInput {
  itemId: string;
  outputUomId: string;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
  operations: readonly RoutingOperationInput[];
}

export interface UpdateRoutingInput {
  outputUomId?: string;
  note?: string | null;
  noteAr?: string | null;
  /** Full operation-set replace — DRAFT only. */
  operations?: readonly RoutingOperationInput[];
  actorId: string | null;
}

/** A service-validated operation (decimal strings normalized for the store). */
interface ValidatedOperation {
  sequence: number;
  workCenterId: string;
  setupTime: string;
  runTime: string;
  fixedCostRate: string | null;
  varCostRate: string | null;
  description: string | null;
  descriptionAr: string | null;
}

export interface RoutingDetail extends RoutingRow {
  operations: RoutingOperationRow[];
}

@Injectable()
export class RoutingService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<RoutingRow> {
    const routing = await store.findRoutingById(id);
    if (routing === undefined) throw new RoutingNotFoundError(id);
    return routing;
  }

  async getDetail(id: string): Promise<RoutingDetail> {
    const routing = await this.find(id);
    return { ...routing, operations: await store.listRoutingOperations(id) };
  }

  async list(filter: { itemId?: string; status?: string; limit: number }): Promise<RoutingRow[]> {
    return store.listRoutings(filter);
  }

  // -- createDraft (versionNo monotonic per item) ---------------------------------

  async createDraft(input: CreateRoutingInput): Promise<RoutingRow> {
    const item = await store.findItemForBom(input.itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new RoutingNotFoundError(`item ${input.itemId} does not exist in this tenant`);
    }
    if (input.outputUomId !== item.baseUomId) {
      throw new RoutingOperationInvalidError(
        `outputUomId must equal the item's base uom (${item.sku}: ${item.baseUomId}) — got ${input.outputUomId} (no UoM conversion seam — the PHASE-018 rule)`,
      );
    }
    const operations = await this.validateOperations(input.operations);

    const versions = await store.listRoutingsForItem(input.itemId);
    const versionNo = versions.reduce((max, row) => Math.max(max, row.versionNo), 0) + 1;
    let created: RoutingRow;
    try {
      created = await store.insertRouting({
        itemId: input.itemId,
        versionNo,
        outputUomId: input.outputUomId,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: input.actorId,
        operations,
      });
    } catch (error) {
      // uq_routings_tenant_item_version — a concurrent create won the same
      // (item, version) slot; the whole UoW rolls back.
      if (isUniqueViolation(error)) throw new RoutingVersionConflictError(input.itemId, versionNo);
      throw error;
    }
    await this.audit.record({
      action: "manufacturing.routing.created",
      entityType: "routing",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { itemId: input.itemId, versionNo, status: "DRAFT", operations: operations.length },
    });
    return created;
  }

  // -- update (DRAFT-only; full operation-set replace) -----------------------------

  async update(id: string, input: UpdateRoutingInput): Promise<RoutingRow> {
    const routing = await this.find(id);
    if (routing.status !== "DRAFT") {
      throw new RoutingNotDraftError(`routing ${id} is ${routing.status} — only DRAFT versions accept edits`);
    }
    if (input.outputUomId !== undefined) {
      const item = await store.findItemForBom(routing.itemId);
      if (item === undefined || item.deletedAt !== null) {
        throw new RoutingNotFoundError(`item ${routing.itemId} does not exist in this tenant`);
      }
      if (input.outputUomId !== item.baseUomId) {
        throw new RoutingOperationInvalidError(
          `outputUomId must equal the item's base uom (${item.sku}: ${item.baseUomId}) — got ${input.outputUomId}`,
        );
      }
    }
    if (input.operations !== undefined) {
      const operations = await this.validateOperations(input.operations);
      await store.replaceRoutingOperations(id, operations, input.actorId);
    }
    await store.patchRouting({ id, note: input.note, noteAr: input.noteAr });
    await this.audit.record({
      action: "manufacturing.routing.updated",
      entityType: "routing",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        fields: Object.keys(input).filter((key) => key !== "operations" && key !== "actorId"),
        operationsReplaced: input.operations?.length ?? 0,
      },
    });
    return this.find(id);
  }

  // -- activate (DRAFT → ACTIVE; archives the previous ACTIVE in the same call) ----

  async activate(id: string, input: { actorId: string | null }): Promise<RoutingRow> {
    const routing = await this.find(id);
    if (routing.status !== "DRAFT") {
      throw new RoutingNotDraftError(`routing ${id} is ${routing.status} — only DRAFT versions activate`);
    }
    // One-active invariant: archive the previous ACTIVE version first, in
    // this same call/transaction — the partial unique index never trips on
    // our own writes; the 23505 catch below is the concurrent-activate race.
    const previous = await store.findActiveRouting(routing.itemId);
    let archivedPrevious: { id: string; versionNo: number } | null = null;
    if (previous !== undefined && previous.id !== id) {
      await store.patchRouting({ id: previous.id, status: "ARCHIVED" });
      archivedPrevious = { id: previous.id, versionNo: previous.versionNo };
    }
    try {
      await store.patchRouting({ id, status: "ACTIVE" });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RoutingActiveExistsError(routing.itemId, previous?.id ?? null);
      }
      throw error;
    }
    await this.audit.record({
      action: "manufacturing.routing.activated",
      entityType: "routing",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { status: "ACTIVE", versionNo: routing.versionNo, archivedPrevious },
    });
    return this.find(id);
  }

  // -- copyFromRouting (a new DRAFT copying the source's operations) ---------------

  async copyFromRouting(sourceId: string, input: { actorId: string | null }): Promise<RoutingRow> {
    const source = await this.getDetail(sourceId);
    return this.createDraft({
      itemId: source.itemId,
      outputUomId: source.outputUomId,
      note: source.note !== null ? `${source.note} (copy of v${source.versionNo})` : `copy of routing v${source.versionNo}`,
      noteAr: source.noteAr,
      actorId: input.actorId,
      operations: source.operations.map((op) => ({
        sequence: op.sequence,
        workCenterId: op.workCenterId,
        setupTime: op.setupTime,
        runTime: op.runTime,
        fixedCostRate: op.fixedCostRate,
        varCostRate: op.varCostRate,
        description: op.description,
        descriptionAr: op.descriptionAr,
      })),
    });
  }

  // -- validation helpers (shared by create + the DRAFT full-replace) --------------

  private async validateOperations(operations: readonly RoutingOperationInput[]): Promise<ValidatedOperation[]> {
    if (operations.length < 1 || operations.length > 200) {
      throw new RoutingOperationInvalidError(`a routing carries 1..200 operations — got ${operations.length}`);
    }
    const validated: ValidatedOperation[] = [];
    const seen = new Set<number>();
    for (let index = 0; index < operations.length; index += 1) {
      const op = operations[index]!;
      const position = index + 1;
      if (!Number.isInteger(op.sequence) || op.sequence < 1 || op.sequence > 999) {
        throw new RoutingOperationInvalidError(`operation ${position}: sequence must be an integer 1..999 — got ${op.sequence}`);
      }
      if (seen.has(op.sequence)) {
        throw new RoutingOperationInvalidError(`operation ${position}: duplicate sequence ${op.sequence} — sequences are unique per routing`);
      }
      seen.add(op.sequence);
      const workCenter = await store.findWorkCenterById(op.workCenterId);
      if (workCenter === undefined) {
        throw new RoutingOperationInvalidError(`operation ${position}: work center ${op.workCenterId} does not exist in this tenant`);
      }
      if (workCenter.status !== "ACTIVE") {
        throw new WorkCenterNotActiveError(op.workCenterId, workCenter.status);
      }
      if (!DECIMAL6_RE.test(op.setupTime) || new Decimal(op.setupTime).lessThan(0)) {
        throw new RoutingOperationInvalidError(`operation ${position}: setupTime must be a non-negative decimal (≤ 6dp): ${op.setupTime}`);
      }
      if (!DECIMAL6_RE.test(op.runTime) || new Decimal(op.runTime).lessThan(0)) {
        throw new RoutingOperationInvalidError(`operation ${position}: runTime must be a non-negative decimal (≤ 6dp): ${op.runTime}`);
      }
      // The overrides travel as a pair (both or neither) — the 0065 CHECK
      // floor mirrored at the service layer.
      const fixedProvided = op.fixedCostRate !== undefined && op.fixedCostRate !== null;
      const varProvided = op.varCostRate !== undefined && op.varCostRate !== null;
      if (fixedProvided !== varProvided) {
        throw new RoutingOperationInvalidError(
          `operation ${position}: the rate overrides travel as a pair (fixedCostRate + varCostRate, both or neither)`,
        );
      }
      let fixedCostRate: string | null = null;
      let varCostRate: string | null = null;
      if (fixedProvided) {
        if (!DECIMAL6_RE.test(op.fixedCostRate!) || new Decimal(op.fixedCostRate!).lessThan(0)) {
          throw new RoutingOperationInvalidError(
            `operation ${position}: fixedCostRate must be a non-negative decimal (≤ 6dp): ${op.fixedCostRate}`,
          );
        }
        if (!DECIMAL6_RE.test(op.varCostRate!) || new Decimal(op.varCostRate!).lessThan(0)) {
          throw new RoutingOperationInvalidError(
            `operation ${position}: varCostRate must be a non-negative decimal (≤ 6dp): ${op.varCostRate}`,
          );
        }
        fixedCostRate = new Decimal(op.fixedCostRate!).toFixed(6);
        varCostRate = new Decimal(op.varCostRate!).toFixed(6);
      }
      validated.push({
        sequence: op.sequence,
        workCenterId: workCenter.id,
        setupTime: new Decimal(op.setupTime).toFixed(6),
        runTime: new Decimal(op.runTime).toFixed(6),
        fixedCostRate,
        varCostRate,
        description: op.description ?? null,
        descriptionAr: op.descriptionAr ?? null,
      });
    }
    // Deterministic insert order (sequence-ascending) — the store keeps the
    // uq slotting but listRoutingOperations orders by sequence regardless.
    validated.sort((a, b) => a.sequence - b.sequence);
    return validated;
  }
}
