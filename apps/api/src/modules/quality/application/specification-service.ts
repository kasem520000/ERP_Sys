import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  findInspectionById,
  findProductionOrderById,
} from "../../manufacturing/infrastructure/manufacturing.store";
import { findBatchById } from "../../inventory/infrastructure/inventory.store";
import { findItemForInventory } from "../../inventory/infrastructure/inventory.store";

import * as store from "../infrastructure/quality.store";
import { bandShapeValid } from "../domain/spec-tolerance";
import {
  QualityInspectionNotFoundError,
  QualityInputInvalidError,
  QualitySpecBandInvalidError,
  QualitySpecificationDuplicateError,
  QualitySpecificationNotFoundError,
} from "../domain/quality-errors";

/**
 * PHASE-050 (W-25 — T-05, 2026-11-23) THE SPECIFICATIONS SERVICE (Q-05):
 * the per-item parameter register's authoring surface (master data —
 * the 0113 grants carry DELETE by design, the COA/SPC readers' FK
 * RESTRICT protects the rows with history) + THE INSPECTION-RESULT
 * MAPPING CONTRACT (the plan W-25's own deliverable).
 *
 * THE MAPPING CONTRACT (feeds from the existing inspections module —
 * a documented contract, the engines' own rows, ZERO PARALLEL
 * COMPUTATION): the map binds an inspection row to the item's
 * specification parameters through the OWNING modules' own reads and
 * never re-derives anything —
 *   · the inspection row is read VERBATIM through the manufacturing
 *     store's `findInspectionById` (the engine's own row: result,
 *     sampled, sample_size, disposition — the 0026 surface);
 *   · the item resolves through the ENGINE'S OWN CHAIN: the FG batch
 *     (the inventory store's `findBatchById`) when the inspection
 *     carries one, else the production order (`findProductionOrderById`)
 *     for order-target inspections;
 *   · the specifications are this module's own register rows
 *     (`listQualitySpecs`, activeOnly), each carrying the tolerance
 *     band for the future tolerance evaluation (the pure fold of
 *     domain/spec-tolerance — THE ONLY evaluator; COA's BR-104 gate
 *     (W-27) reads it, never re-derives).
 * A goods-receipt-target inspection names NO single item (a GRN's
 * lines can carry many) — the map returns the inspection with
 * `item: null` and an empty parameter list, the recorded honest shape
 * (the declared interpretation; the COA surface (W-27) resolves
 * per-line).
 */

export interface CreateQualitySpecInput {
  itemId: string;
  parameter: string;
  parameterAr?: string | null;
  unit?: string | null;
  targetValue: string;
  ucl?: string | null;
  lcl?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

export interface UpdateQualitySpecPatch {
  parameterAr?: string | null;
  unit?: string | null;
  targetValue?: string;
  ucl?: string | null;
  lcl?: string | null;
  isActive?: boolean;
  note?: string | null;
  noteAr?: string | null;
}

/** The mapping contract's own read shape — every field is an owning
 * engine's own row (verbatim), never a recomputation. */
export interface InspectionSpecificationMap {
  /** The inspections module's own row (the 0026 surface, verbatim). */
  inspection: {
    id: string;
    targetType: string;
    orderId: string | null;
    grnId: string | null;
    fgBatchId: string | null;
    result: string;
    sampled: boolean;
    sampleSize: number | null;
    disposition: string | null;
    inspectedAt: string;
    note: string | null;
    noteAr: string | null;
  };
  /** The resolved item through the engine's own chain (null for
   * GRN-target inspections — the declared honest shape). */
  item: { id: string; sku: string; name: string } | null;
  /** The item's active specification rows (this module's register). */
  specifications: store.QualitySpecRow[];
  /** How the item was resolved — the contract's own disclosure field
   * (the chain walked: FG_BATCH | PRODUCTION_ORDER | NONE). */
  itemResolution: "FG_BATCH" | "PRODUCTION_ORDER" | "NONE";
}

@Injectable()
export class SpecificationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async create(input: CreateQualitySpecInput): Promise<store.QualitySpecRow> {
    const parameter = input.parameter.trim();
    if (parameter.length === 0 || parameter.length > 120) {
      throw new QualityInputInvalidError({
        field: "parameter",
        reason: "the parameter name is 1–120 characters",
      });
    }
    if (input.unit !== undefined && input.unit !== null && input.unit.length > 16) {
      throw new QualityInputInvalidError({
        field: "unit",
        reason: "the unit of measure is at most 16 characters",
      });
    }
    // THE NO-FABRICATION BAND FLOOR (the service-level refusal names the
    // parameter and both figures; the 0113 CHECK stays the authority).
    if (
      !bandShapeValid({
        ucl: input.ucl ?? null,
        lcl: input.lcl ?? null,
      })
    ) {
      throw new QualitySpecBandInvalidError({
        parameter,
        ucl: input.ucl ?? "null",
        lcl: input.lcl ?? "null",
      });
    }
    const item = await findItemForInventory(input.itemId);
    if (item === undefined) {
      throw new QualityInputInvalidError({
        field: "itemId",
        reason: `item ${input.itemId} does not exist in this tenant`,
      });
    }
    // The natural-key pre-check (the typed duplicate refusal — the 23505
    // never surfaces raw).
    const existing = await store.findQualitySpecByParameter(input.itemId, parameter);
    if (existing !== undefined) {
      throw new QualitySpecificationDuplicateError({ itemId: input.itemId, parameter });
    }
    const row = await store.insertQualitySpec({
      itemId: input.itemId,
      parameter,
      parameterAr: input.parameterAr ?? null,
      unit: input.unit ?? null,
      targetValue: input.targetValue,
      ucl: input.ucl ?? null,
      lcl: input.lcl ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "quality.specification_created",
      entityType: "quality_specification",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { itemId: row.itemId, parameter: row.parameter, targetValue: row.targetValue },
    });
    return row;
  }

  async find(id: string): Promise<store.QualitySpecRow> {
    const row = await store.findQualitySpecById(id);
    if (row === undefined) throw new QualitySpecificationNotFoundError({ specificationId: id });
    return row;
  }

  async list(filter: { itemId?: string; activeOnly?: boolean; limit?: number }): Promise<store.QualitySpecRow[]> {
    return store.listQualitySpecs({
      itemId: filter.itemId,
      activeOnly: filter.activeOnly,
      limit: filter.limit ?? 200,
    });
  }

  async update(id: string, patch: UpdateQualitySpecPatch, actorId: string | null): Promise<store.QualitySpecRow> {
    const current = await store.findQualitySpecById(id);
    if (current === undefined) throw new QualitySpecificationNotFoundError({ specificationId: id });
    // The MERGED band checked (the PATCH idiom: an explicit null clears an
    // end; the merged result must still be a real band when both ends
    // survive).
    const mergedUcl = patch.ucl !== undefined ? patch.ucl : current.ucl;
    const mergedLcl = patch.lcl !== undefined ? patch.lcl : current.lcl;
    if (!bandShapeValid({ ucl: mergedUcl, lcl: mergedLcl })) {
      throw new QualitySpecBandInvalidError({
        parameter: current.parameter,
        ucl: mergedUcl ?? "null",
        lcl: mergedLcl ?? "null",
      });
    }
    const row = await store.updateQualitySpec({
      id,
      parameterAr: patch.parameterAr,
      unit: patch.unit,
      targetValue: patch.targetValue,
      ucl: patch.ucl,
      lcl: patch.lcl,
      isActive: patch.isActive,
      note: patch.note,
      noteAr: patch.noteAr,
      actorId,
    });
    if (row === undefined) throw new QualitySpecificationNotFoundError({ specificationId: id });
    await this.audit.record({
      action: "quality.specification_updated",
      entityType: "quality_specification",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { targetValue: current.targetValue, ucl: current.ucl, lcl: current.lcl },
      after: { targetValue: row.targetValue, ucl: row.ucl, lcl: row.lcl },
    });
    return row;
  }

  async remove(id: string, actorId: string | null): Promise<void> {
    const current = await store.findQualitySpecById(id);
    if (current === undefined) throw new QualitySpecificationNotFoundError({ specificationId: id });
    const removed = await store.deleteQualitySpec(id);
    if (!removed) throw new QualitySpecificationNotFoundError({ specificationId: id });
    await this.audit.record({
      action: "quality.specification_deleted",
      entityType: "quality_specification",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { parameter: current.parameter, itemId: current.itemId },
    });
  }

  /**
   * THE INSPECTION-RESULT MAPPING CONTRACT's read (zero parallel
   * computation — every field is an owning engine's own row).
   */
  async inspectionMap(inspectionId: string): Promise<InspectionSpecificationMap> {
    const inspection = await findInspectionById(inspectionId);
    if (inspection === undefined) {
      throw new QualityInspectionNotFoundError({ inspectionId });
    }
    let itemId: string | null = null;
    let itemResolution: InspectionSpecificationMap["itemResolution"] = "NONE";
    if (inspection.fgBatchId !== null) {
      const batch = await findBatchById(inspection.fgBatchId);
      if (batch !== undefined) {
        itemId = batch.itemId;
        itemResolution = "FG_BATCH";
      }
    } else if (inspection.orderId !== null) {
      const order = await findProductionOrderById(inspection.orderId);
      if (order !== undefined) {
        itemId = order.itemId;
        itemResolution = "PRODUCTION_ORDER";
      }
    }
    let item: InspectionSpecificationMap["item"] = null;
    let specifications: store.QualitySpecRow[] = [];
    if (itemId !== null) {
      const itemRow = await findItemForInventory(itemId);
      if (itemRow !== undefined) {
        item = { id: itemRow.id, sku: itemRow.sku, name: itemRow.name };
      }
      specifications = await store.listQualitySpecs({ itemId, activeOnly: true, limit: 500 });
    }
    return {
      inspection: {
        id: inspection.id,
        targetType: inspection.targetType,
        orderId: inspection.orderId,
        grnId: inspection.grnId,
        fgBatchId: inspection.fgBatchId,
        result: inspection.result,
        sampled: inspection.sampled,
        sampleSize: inspection.sampleSize,
        disposition: inspection.disposition,
        inspectedAt: inspection.inspectedAt,
        note: inspection.note,
        noteAr: inspection.noteAr,
      },
      item,
      specifications,
      itemResolution,
    };
  }
}
