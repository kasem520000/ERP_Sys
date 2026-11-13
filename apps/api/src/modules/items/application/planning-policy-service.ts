import { Inject, Injectable } from "@nestjs/common";
import { Decimal, InvalidValueError } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/items.store";
import * as mfgPlanning from "../../manufacturing/infrastructure/planning.store";
import { ItemNotFoundError } from "../domain/items-errors";

/**
 * Item planning-policy service (PHASE-043 T-01's policy surface, M-01/
 * DF-24): the items module's own writer for the 0074 planning columns —
 * lead time, safety stock (MANUAL value or the AUTO z×σ×√LT policy),
 * lot sizing, and the time fences. The items module stays the one writer
 * of items rows (the module-boundary law); the manufacturing module's
 * planning controller exposes the HTTP surface under the
 * manufacturing.planning_policies permission and calls THIS service.
 *
 * The validation mirrors ck_items_planning_shape (migration 0074) at the
 * service layer with typed messages: FOQ needs fixed_order_qty,
 * ORDER_MULTIPLE needs order_multiple, PERIOD_SUPPLY needs
 * period_supply_buckets, AUTO safety stock needs its service level +
 * look-back + lead time. The DB constraint is the backstop, not the UX.
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PCT_RE = /^\d+(\.\d{1,2})?$/;

export interface PlanningPolicyPatch {
  leadTimeDays?: number | null;
  safetyStockPolicy?: "MANUAL" | "AUTO";
  safetyStockQty?: string | null;
  ssServiceLevelPct?: string | null;
  ssLookbackDays?: number | null;
  lotSizingRule?: "LOT_FOR_LOT" | "FIXED_ORDER_QTY" | "ORDER_MULTIPLE" | "PERIOD_SUPPLY";
  fixedOrderQty?: string | null;
  orderMultiple?: string | null;
  periodSupplyBuckets?: number | null;
  frozenFenceDays?: number;
  slushyFenceDays?: number;
}

@Injectable()
export class PlanningPolicyService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The planning projection of one item (the manufacturing store's
   * read-only projection — same tenant UoW, no second definition). */
  async get(itemId: string): Promise<mfgPlanning.ItemPlanningRow> {
    const item = await mfgPlanning.findItemPlanning(itemId);
    if (item === undefined) throw new ItemNotFoundError(itemId);
    return item;
  }

  /** The seeded lot-sizing rule catalog (read-only reference for the UI). */
  async lotSizingRules(): Promise<mfgPlanning.LotSizingRuleRow[]> {
    return mfgPlanning.listLotSizingRules();
  }

  async update(
    actorId: string | null,
    itemId: string,
    patch: PlanningPolicyPatch,
  ): Promise<mfgPlanning.ItemPlanningRow> {
    const existing = await mfgPlanning.findItemPlanning(itemId);
    if (existing === undefined) throw new ItemNotFoundError(itemId);

    // Merge the patch over the current policy (the shape validation sees
    // the RESULT — partial patches stay legal).
    const RULES = ["LOT_FOR_LOT", "FIXED_ORDER_QTY", "ORDER_MULTIPLE", "PERIOD_SUPPLY"] as const;
    type LotRule = (typeof RULES)[number];
    const currentRule: LotRule = (RULES as readonly string[]).includes(existing.lotSizingRule)
      ? (existing.lotSizingRule as LotRule)
      : "LOT_FOR_LOT";
    const mergedRule: LotRule = patch.lotSizingRule ?? currentRule;
    const merged = {
      leadTimeDays: patch.leadTimeDays !== undefined ? patch.leadTimeDays : existing.leadTimeDays,
      safetyStockPolicy:
        patch.safetyStockPolicy !== undefined ? patch.safetyStockPolicy : (existing.safetyStockPolicy as "MANUAL" | "AUTO"),
      safetyStockQty:
        patch.safetyStockQty !== undefined
          ? patch.safetyStockQty
          : (existing.safetyStockQty ?? null),
      ssServiceLevelPct:
        patch.ssServiceLevelPct !== undefined
          ? patch.ssServiceLevelPct
          : (existing.ssServiceLevelPct ?? null),
      ssLookbackDays:
        patch.ssLookbackDays !== undefined ? patch.ssLookbackDays : existing.ssLookbackDays,
      lotSizingRule: mergedRule,
      fixedOrderQty:
        patch.fixedOrderQty !== undefined ? patch.fixedOrderQty : (existing.fixedOrderQty ?? null),
      orderMultiple:
        patch.orderMultiple !== undefined ? patch.orderMultiple : (existing.orderMultiple ?? null),
      periodSupplyBuckets:
        patch.periodSupplyBuckets !== undefined
          ? patch.periodSupplyBuckets
          : existing.periodSupplyBuckets,
      frozenFenceDays: patch.frozenFenceDays !== undefined ? patch.frozenFenceDays : existing.frozenFenceDays,
      slushyFenceDays: patch.slushyFenceDays !== undefined ? patch.slushyFenceDays : existing.slushyFenceDays,
    };

    if (merged.leadTimeDays !== null && (merged.leadTimeDays < 0 || merged.leadTimeDays > 365)) {
      throw new InvalidValueError(`leadTimeDays must be 0..365 or null — got ${merged.leadTimeDays}`);
    }
    if (merged.safetyStockQty !== null && (!QTY_RE.test(merged.safetyStockQty) || new Decimal(merged.safetyStockQty).lessThan(0))) {
      throw new InvalidValueError(`safetyStockQty must be a non-negative decimal (≤ 6dp): ${merged.safetyStockQty}`);
    }
    if (merged.ssServiceLevelPct !== null && !["90", "95", "98", "99"].includes(merged.ssServiceLevelPct)) {
      throw new InvalidValueError(`ssServiceLevelPct must be one of 90, 95, 98, 99 — got ${merged.ssServiceLevelPct}`);
    }
    if (merged.ssLookbackDays !== null && (merged.ssLookbackDays < 30 || merged.ssLookbackDays > 1095)) {
      throw new InvalidValueError(`ssLookbackDays must be 30..1095 or null — got ${merged.ssLookbackDays}`);
    }
    if (merged.fixedOrderQty !== null && (!QTY_RE.test(merged.fixedOrderQty) || new Decimal(merged.fixedOrderQty).lessThanOrEqualTo(0))) {
      throw new InvalidValueError(`fixedOrderQty must be a positive decimal (≤ 6dp): ${merged.fixedOrderQty}`);
    }
    if (merged.orderMultiple !== null && (!QTY_RE.test(merged.orderMultiple) || new Decimal(merged.orderMultiple).lessThanOrEqualTo(0))) {
      throw new InvalidValueError(`orderMultiple must be a positive decimal (≤ 6dp): ${merged.orderMultiple}`);
    }
    if (merged.periodSupplyBuckets !== null && (merged.periodSupplyBuckets < 1 || merged.periodSupplyBuckets > 13)) {
      throw new InvalidValueError(`periodSupplyBuckets must be 1..13 or null — got ${merged.periodSupplyBuckets}`);
    }
    if (merged.frozenFenceDays < 0 || merged.frozenFenceDays > 90) {
      throw new InvalidValueError(`frozenFenceDays must be 0..90 — got ${merged.frozenFenceDays}`);
    }
    if (merged.slushyFenceDays < 0 || merged.slushyFenceDays > 180) {
      throw new InvalidValueError(`slushyFenceDays must be 0..180 — got ${merged.slushyFenceDays}`);
    }
    // ck_items_planning_shape, service-layer mirror (the UX messages).
    if (merged.lotSizingRule === "FIXED_ORDER_QTY" && merged.fixedOrderQty === null) {
      throw new InvalidValueError("FIXED_ORDER_QTY needs fixedOrderQty (a positive decimal)");
    }
    if (merged.lotSizingRule === "ORDER_MULTIPLE" && merged.orderMultiple === null) {
      throw new InvalidValueError("ORDER_MULTIPLE needs orderMultiple (a positive decimal)");
    }
    if (merged.lotSizingRule === "PERIOD_SUPPLY" && merged.periodSupplyBuckets === null) {
      throw new InvalidValueError("PERIOD_SUPPLY needs periodSupplyBuckets (1..13)");
    }
    if (
      merged.safetyStockPolicy === "AUTO" &&
      (merged.ssServiceLevelPct === null || merged.ssLookbackDays === null || merged.leadTimeDays === null)
    ) {
      throw new InvalidValueError(
        "the AUTO safety-stock policy needs ssServiceLevelPct (90/95/98/99), ssLookbackDays (30..1095), and leadTimeDays — the z×σ×√LT inputs",
      );
    }
    void PCT_RE;

    await store.updateItemPlanningPolicy(itemId, {
      leadTimeDays: merged.leadTimeDays,
      safetyStockPolicy: merged.safetyStockPolicy,
      safetyStockQty: merged.safetyStockQty,
      ssServiceLevelPct: merged.ssServiceLevelPct,
      ssLookbackDays: merged.ssLookbackDays,
      lotSizingRule: merged.lotSizingRule,
      fixedOrderQty: merged.fixedOrderQty,
      orderMultiple: merged.orderMultiple,
      periodSupplyBuckets: merged.periodSupplyBuckets,
      frozenFenceDays: merged.frozenFenceDays,
      slushyFenceDays: merged.slushyFenceDays,
    });
    await this.audit.record({
      action: "item.planning_policy_updated",
      entityType: "item",
      entityId: itemId,
      actorId: actorId ?? undefined,
      after: { ...merged },
    });
    return mfgPlanning.findItemPlanning(itemId) as Promise<mfgPlanning.ItemPlanningRow>;
  }
}
