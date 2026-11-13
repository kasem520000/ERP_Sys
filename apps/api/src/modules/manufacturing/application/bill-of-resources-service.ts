import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/planning.store";
import * as mfgStore from "../infrastructure/manufacturing.store";
import { BomNotFoundError, BorInvalidError } from "../domain/manufacturing-errors";

/**
 * Bill-of-resources service (PHASE-043 T-07; M-25): the critical-resource
 * overlay per BOM — WORK_CENTER rows (hours per output unit) and
 * KEY_MATERIAL rows (qty per output unit) — plus the ROUGH-CUT capacity
 * check against PHASE-042 work-center capacities.
 *
 * Rough-cut is deliberately NOT finite scheduling (the phase's
 * expectation-management note): the check multiplies the proposed
 * production quantity by each WORK_CENTER row's consumption factor and
 * compares the resulting HOURS against the work center's daily capacity
 * (capacity_per_shift × shifts_per_day — the 0065 semantics) over the
 * bucket's working days. Overloads are WARNINGS in the returned report
 * (the planner decides — reschedule, split, or accept overtime), never
 * blocked writes; the report's rows are the evidence the UI renders.
 *
 * Rows are editable on DRAFT and ACTIVE BOMs alike (0075's overlay law:
 * the rough-cut check reads the ACTIVE BOM's rows at planning time).
 */

const FACTOR_RE = /^\d+(\.\d{1,6})?$/;

export interface BorRowInput {
  resourceKind: "WORK_CENTER" | "KEY_MATERIAL";
  workCenterId: string | null;
  itemId: string | null;
  consumptionFactor: string;
  note?: string | null;
}

export interface RoughCutCheckRow {
  kind: "WORK_CENTER" | "KEY_MATERIAL";
  /** The work center code or the item sku (the human key). */
  label: string;
  workCenterId: string | null;
  itemId: string | null;
  requiredQty: string;
  capacityQty: string | null;
  utilizationPct: string | null;
  overloaded: boolean;
  note: string | null;
}

export interface RoughCutCheckResult {
  bomId: string;
  itemId: string;
  proposedQty: string;
  horizonDays: number;
  rows: RoughCutCheckRow[];
  overloads: number;
}

@Injectable()
export class BillOfResourcesService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(bomId: string): Promise<store.BorRow[]> {
    return store.listBillOfResources(bomId);
  }

  /** Full-replace the overlay (DRAFT and ACTIVE BOMs alike — the 0075
   * overlay law). Line numbers are assigned 1..n in input order. */
  async replace(
    bomId: string,
    rows: readonly BorRowInput[],
    actorId: string | null,
  ): Promise<store.BorRow[]> {
    const bom = await mfgStore.findBomById(bomId);
    if (bom === undefined) throw new BomNotFoundError(bomId);
    if (bom.status === "ARCHIVED") {
      throw new BorInvalidError(`bill of materials ${bomId} is ARCHIVED — its resource overlay is frozen`);
    }
    if (rows.length < 1 || rows.length > 200) {
      throw new BorInvalidError(`a bill of resources carries 1..200 rows — got ${rows.length}`);
    }
    const validated: {
      lineNo: number;
      resourceKind: string;
      workCenterId: string | null;
      itemId: string | null;
      consumptionFactor: string;
      note: string | null;
    }[] = [];
    const seenWorkCenters = new Set<string>();
    const seenItems = new Set<string>();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const position = index + 1;
      if (row.resourceKind === "WORK_CENTER") {
        if (row.workCenterId === null || row.itemId !== null) {
          throw new BorInvalidError(`row ${position}: a WORK_CENTER row carries exactly a work center id (no item)`);
        }
        const wc = await mfgStore.findWorkCenterById(row.workCenterId);
        if (wc === undefined) {
          throw new BorInvalidError(`row ${position}: work center ${row.workCenterId} does not exist in this tenant`);
        }
        if (seenWorkCenters.has(row.workCenterId)) {
          throw new BorInvalidError(`row ${position}: work center ${wc.code} appears twice — one row per resource`);
        }
        seenWorkCenters.add(row.workCenterId);
      } else if (row.resourceKind === "KEY_MATERIAL") {
        if (row.itemId === null || row.workCenterId !== null) {
          throw new BorInvalidError(`row ${position}: a KEY_MATERIAL row carries exactly an item id (no work center)`);
        }
        const item = await store.findItemPlanning(row.itemId);
        if (item === undefined) {
          throw new BorInvalidError(`row ${position}: item ${row.itemId} does not exist in this tenant`);
        }
        if (seenItems.has(row.itemId)) {
          throw new BorInvalidError(`row ${position}: item ${item.sku} appears twice — one row per resource`);
        }
        seenItems.add(row.itemId);
      } else {
        throw new BorInvalidError(`row ${position}: resourceKind must be WORK_CENTER or KEY_MATERIAL`);
      }
      if (!FACTOR_RE.test(row.consumptionFactor) || new Decimal(row.consumptionFactor).lessThanOrEqualTo(0)) {
        throw new BorInvalidError(
          `row ${position}: consumptionFactor must be a positive decimal (≤ 6dp): ${row.consumptionFactor}`,
        );
      }
      validated.push({
        lineNo: position,
        resourceKind: row.resourceKind,
        workCenterId: row.workCenterId,
        itemId: row.itemId,
        consumptionFactor: new Decimal(row.consumptionFactor).toFixed(6),
        note: row.note ?? null,
      });
    }
    await store.replaceBillOfResources(bomId, validated);
    await this.audit.record({
      action: "manufacturing.bor.replaced",
      entityType: "bill_of_resources",
      entityId: bomId,
      actorId: actorId ?? undefined,
      after: { rows: validated.length, bomStatus: bom.status },
    });
    return store.listBillOfResources(bomId);
  }

  /**
   * The rough-cut check (M-25): the proposed production quantity against
   * the ACTIVE BOM's overlay. WORK_CENTER rows: hours required vs the
   * daily capacity × horizon days. KEY_MATERIAL rows: qty required vs the
   * warehouse's qualified available (the BR-080 basis). Overload = the
   * honest warning, never a block.
   */
  async roughCut(input: {
    itemId: string;
    warehouseId: string;
    proposedQty: string;
    horizonDays: number;
  }): Promise<RoughCutCheckResult> {
    if (!FACTOR_RE.test(input.proposedQty) || new Decimal(input.proposedQty).lessThanOrEqualTo(0)) {
      throw new BorInvalidError(`proposedQty must be a positive decimal (≤ 6dp): ${input.proposedQty}`);
    }
    if (input.horizonDays < 1 || input.horizonDays > 366) {
      throw new BorInvalidError(`horizonDays must be 1..366 — got ${input.horizonDays}`);
    }
    const bom = await mfgStore.findActiveBom(input.itemId);
    if (bom === undefined) {
      throw new BomNotFoundError(`item ${input.itemId} has no ACTIVE bill of materials`);
    }
    const rows = await store.listBillOfResources(bom.id);
    const proposed = new Decimal(input.proposedQty);
    const out: RoughCutCheckRow[] = [];
    for (const row of rows) {
      const required = proposed.times(new Decimal(row.consumptionFactor));
      if (row.resourceKind === "WORK_CENTER" && row.workCenterId !== null) {
        const wc = await mfgStore.findWorkCenterById(row.workCenterId);
        if (wc === undefined) continue;
        const dailyHours = new Decimal(wc.capacityPerShift).times(wc.shiftsPerDay);
        const capacity = dailyHours.times(input.horizonDays);
        const utilization = capacity.greaterThan(0)
          ? required.div(capacity).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : null;
        out.push({
          kind: "WORK_CENTER",
          label: wc.code,
          workCenterId: row.workCenterId,
          itemId: null,
          requiredQty: required.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          capacityQty: capacity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          utilizationPct: utilization === null ? null : utilization.toFixed(2),
          overloaded: required.greaterThan(capacity),
          note: row.note,
        });
      } else if (row.resourceKind === "KEY_MATERIAL" && row.itemId !== null) {
        const item = await store.findItemPlanning(row.itemId);
        if (item === undefined) continue;
        const surpluses = await store.listWarehouseSurpluses(row.itemId);
        const available = surpluses
          .filter((s) => s.warehouseId === input.warehouseId)
          .reduce((sum, s) => sum.plus(new Decimal(s.surplusQty)), new Decimal(0));
        const utilization = available.greaterThan(0)
          ? required.div(available).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : null;
        out.push({
          kind: "KEY_MATERIAL",
          label: item.sku,
          workCenterId: null,
          itemId: row.itemId,
          requiredQty: required.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          capacityQty: available.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          utilizationPct: utilization === null ? null : utilization.toFixed(2),
          overloaded: required.greaterThan(available),
          note: row.note,
        });
      }
    }
    return {
      bomId: bom.id,
      itemId: input.itemId,
      proposedQty: new Decimal(input.proposedQty).toFixed(6),
      horizonDays: input.horizonDays,
      rows: out,
      overloads: out.filter((row) => row.overloaded).length,
    };
  }
}

