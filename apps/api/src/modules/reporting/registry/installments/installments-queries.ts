import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import { addExact, compareExact, subExact } from "../../../accounting/application/decimal-strings";
import { PlanNotFoundError } from "../../../installments/domain/installments-errors";
import {
  collectedTotalsByPlan,
  findPlanById,
  listLinesByPlan,
  listLinesForAging,
  postedAllocationsForItems,
  sourceOpenItemIdsForPlan,
  type InstallmentLineRow,
  type InstallmentPlanRow,
} from "../../../installments/infrastructure/installments.store";

/**
 * PHASE-027 wave E · the installments report queries (REPORT_CATALOG §9 rows
 * 234–235 — the queries behind `installments.schedule` and
 * `installments.aging`): reporting-facing, read-only, executed inside the
 * ambient tenant transaction exactly like the PHASE-026 fixed-assets
 * precedent (ADR-0011 — read-only over the PUBLISHED installments tables;
 * this surface never writes).
 *
 * ── As-of semantics (documented in both contracts) ────────────────────────
 *
 * Collections attribution is job-derived and time-varying (the sweep rebuilds
 * receipt_refs/collected from the source document's posted allocations), so
 * the lines render their CURRENT states — the plan register owns them — with
 * the asOf anchoring the POPULATION (plans activated ≤ asOf) and the due-date
 * buckets. Plan amounts are base-currency by construction this phase
 * (PLAN_SOURCE_CURRENCY_UNSUPPORTED otherwise), so every figure is the exact
 * 4dp quantum the rows carry.
 *
 * ── The INV-016 sanity tie (`installments-inv016-tie`) ────────────────────
 *
 * Per plan: Σ over ALL lines of collected_amount ≤ Σ source settled (the
 * posted receipt allocations on the plan's source open items — the same reads
 * the attribution recompute consumes). The service enforces the stronger
 * invariant (the down-payment slice is excluded before attribution), so this
 * read-only check can only surface drift (a manual collected write past the
 * settled stream), never the honest attribution. Tolerance 0, exact compare.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("installments report query requires an ambient tenant scope");
  }
  return context.tx;
}

/** The aging buckets (the ar-queries convention — the fixed shape). */
export type InstallmentAgingBucket = "notDue" | "1_30" | "31_60" | "61_90" | "90_plus";

/**
 * The aging bucket of (dueDate vs asOf) — the ar-queries convention:
 * notDue (overdueDays ≤ 0), 1–30, 31–60, 61–90, 90+ days overdue. Integral
 * day difference ((asOfMs − dueMs) / 86_400_000 | 0 — exact for whole dates).
 */
export function installmentAgingBucketOf(dueDate: string, asOf: string): InstallmentAgingBucket {
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();
  const dueMs = new Date(`${dueDate}T00:00:00Z`).getTime();
  const overdueDays = ((asOfMs - dueMs) / 86_400_000) | 0;
  if (overdueDays <= 0) return "notDue";
  if (overdueDays <= 30) return "1_30";
  if (overdueDays <= 60) return "31_60";
  if (overdueDays <= 90) return "61_90";
  return "90_plus";
}

/** Partner identity batch read (the plan rows carry partner_id only). */
async function partnerNames(
  partnerIds: readonly string[],
): Promise<Map<string, { name: string | null; nameAr: string | null }>> {
  const names = new Map<string, { name: string | null; nameAr: string | null }>();
  if (partnerIds.length === 0) return names;
  const rows = await tenantTx().execute(sql`
    SELECT id, name, name_ar AS "nameAr" FROM partners
    WHERE id IN (${sql.join(
      partnerIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  for (const row of rows.rows as unknown as { id: string; name: string | null; nameAr: string | null }[]) {
    names.set(row.id, { name: row.name, nameAr: row.nameAr });
  }
  return names;
}

// -- installments.schedule -----------------------------------------------------------

/** The plan header of the schedule view (the register's own row). */
export interface SchedulePlanView {
  planId: string;
  partnerId: string;
  partnerName: string | null;
  partnerNameAr: string | null;
  sourceType: string;
  sourceNo: string | null;
  totalAmount: string;
  downPayment: string;
  lineCount: number;
  startDate: string;
  frequency: string;
  status: string | null;
  lateFeePolicy: InstallmentPlanRow["lateFeePolicy"];
  activatedAt: string | null;
}

/** One schedule line (the register's own current state — see the header). */
export interface ScheduleLineRow {
  lineId: string;
  seq: number;
  dueDate: string;
  amount: string;
  status: InstallmentLineRow["status"];
  collectedAmount: string;
  /** amount − collected (the outstanding). */
  residualAmount: string;
  lateFeeAmount: string | null;
}

export interface ScheduleView {
  plan: SchedulePlanView;
  lines: ScheduleLineRow[];
  asOf: string;
}

// -- installments.aging ----------------------------------------------------------------

/** One aging row (an uncollected line with its bucket + plan furniture). */
export interface InstallmentsAgingRow {
  lineId: string;
  planId: string;
  planSourceNo: string | null;
  planStatus: string;
  partnerName: string | null;
  partnerNameAr: string | null;
  seq: number;
  dueDate: string;
  lineStatus: InstallmentLineRow["status"];
  amount: string;
  collectedAmount: string;
  residualAmount: string;
  lateFeeAmount: string | null;
  bucket: InstallmentAgingBucket;
}

/** One plan's INV-016 tie fold (Σ line collected vs Σ source settled). */
export interface InstallmentsAgingTieRow {
  planId: string;
  planSourceNo: string | null;
  linesCollected: string;
  sourceSettled: string;
}

export interface InstallmentsAgingView {
  rows: InstallmentsAgingRow[];
  ties: InstallmentsAgingTieRow[];
}

/** The aging scan bound (the movements precedent). */
const AGING_ROW_LIMIT = 5_000;

@Injectable()
export class InstallmentsQueriesService {
  /**
   * `installments.schedule`: the plan's lines with seq/dueDate/amount/status
   * — the CURRENT line states (the plan register owns them; attribution is
   * job-derived and time-varying), the asOf recorded for freshness
   * semantics. Throws PLAN_NOT_FOUND for an unknown/foreign plan id (the
   * spoof-parity 404 shape).
   */
  async schedule(input: { planId: string; asOf: string }): Promise<ScheduleView> {
    const plan = await findPlanById(input.planId);
    if (plan === undefined) {
      throw new PlanNotFoundError(input.planId);
    }
    const [partner] = [...(await partnerNames([plan.partnerId])).values()];
    const lines = await listLinesByPlan(plan.id);
    return {
      plan: {
        planId: plan.id,
        partnerId: plan.partnerId,
        partnerName: partner?.name ?? null,
        partnerNameAr: partner?.nameAr ?? null,
        sourceType: plan.sourceType,
        sourceNo: plan.sourceNo,
        totalAmount: plan.totalAmount,
        downPayment: plan.downPayment,
        lineCount: plan.lineCount,
        startDate: plan.startDate,
        frequency: plan.frequency,
        status: plan.status,
        lateFeePolicy: plan.lateFeePolicy,
        activatedAt: plan.activatedAt,
      },
      lines: lines.map((line) => ({
        lineId: line.id,
        seq: line.seq,
        dueDate: line.dueDate,
        amount: line.amount,
        status: line.status,
        collectedAmount: line.collectedAmount,
        residualAmount: residualOf(line),
        lateFeeAmount: line.lateFeeAmount,
      })),
      asOf: input.asOf,
    };
  }

  /**
   * `installments.aging`: the uncollected lines (PENDING/DUE/OVERDUE) of the
   * activated, un-closed plans that were activated as-of, bucketed by
   * due_date vs asOf (the ar-queries convention) on the RESIDUAL
   * (amount − collected) — plus the per-plan INV-016 sanity fold
   * (`installments-inv016-tie`: Σ line collected ≤ Σ source settled).
   */
  async aging(input: { asOf: string; partnerId: string | null }): Promise<InstallmentsAgingView> {
    const lines = await listLinesForAging({
      asOf: input.asOf,
      partnerId: input.partnerId ?? undefined,
      limit: AGING_ROW_LIMIT,
    });
    const rows: InstallmentsAgingRow[] = lines.map((line) => ({
      lineId: line.lineId,
      planId: line.planId,
      planSourceNo: line.planSourceNo,
      planStatus: line.planStatus,
      partnerName: line.partnerName,
      partnerNameAr: line.partnerNameAr,
      seq: line.seq,
      dueDate: line.dueDate,
      lineStatus: line.status,
      amount: line.amount,
      collectedAmount: line.collectedAmount,
      residualAmount: line.residualAmount,
      lateFeeAmount: line.lateFeeAmount,
      bucket: installmentAgingBucketOf(line.dueDate, input.asOf),
    }));

    // The per-plan INV-016 fold over the DISTINCT plans in the population:
    // Σ over ALL their lines of collected_amount vs the source settled
    // stream (the same reads the attribution recompute consumes).
    const plansById = new Map<string, { sourceNo: string | null; sourceType: string; sourceId: string }>();
    for (const line of lines) {
      if (!plansById.has(line.planId)) {
        plansById.set(line.planId, {
          sourceNo: line.planSourceNo,
          sourceType: line.planSourceType,
          sourceId: line.planSourceId,
        });
      }
    }
    const collectedByPlan = new Map(
      (await collectedTotalsByPlan([...plansById.keys()])).map((row) => [row.planId, row.collected] as const),
    );
    const ties: InstallmentsAgingTieRow[] = [];
    for (const [planId, plan] of plansById) {
      const itemIds = await sourceOpenItemIdsForPlan({
        sourceType: plan.sourceType,
        sourceId: plan.sourceId,
      });
      let sourceSettled = "0.0000";
      for (const allocation of await postedAllocationsForItems(itemIds)) {
        sourceSettled = addExact(sourceSettled, allocation.amount);
      }
      ties.push({
        planId,
        planSourceNo: plan.sourceNo,
        linesCollected: collectedByPlan.get(planId) ?? "0.0000",
        sourceSettled,
      });
    }
    ties.sort((a, b) => (a.planSourceNo ?? a.planId).localeCompare(b.planSourceNo ?? b.planId));
    return { rows, ties };
  }
}

/** The line's outstanding: amount − collected, never below zero (the CHECK). */
function residualOf(line: InstallmentLineRow): string {
  const residual = subExact(line.amount, line.collectedAmount);
  return compareExact(residual, "0.0000") < 0 ? "0.0000" : residual;
}

/** Exact ≤ compare for the INV-016 sanity check (tolerance 0). */
export function collectedExceedsSettled(tie: InstallmentsAgingTieRow): boolean {
  return compareExact(tie.linesCollected, tie.sourceSettled) > 0;
}
