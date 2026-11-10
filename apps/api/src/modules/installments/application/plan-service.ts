import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  deleteLinesByPlan,
  findPlanById,
  findPlanSourceContract,
  findPlanSourceInvoice,
  insertLines,
  insertPlan,
  listLinesByPlan,
  listPlans,
  updatePlanActivation,
  updatePlanDraft,
  type InstallmentLineRow,
  type InstallmentPlanRow,
} from "../infrastructure/installments.store";
import {
  PlanSourceCurrencyUnsupportedError,
  PlanSourceInvalidError,
  PlanTotalMismatchError,
  ScheduleImmutableError,
  ScheduleInvalidError,
} from "../domain/installments-errors";

/**
 * PHASE-027 T8 — installment plan builder + activation (BR-048).
 *
 * The wizard computes the schedule; ACTIVATION requires plan total == source
 * document total EXACTLY (re-read live at activation — never trust the
 * draft snapshot); after activation the schedule is immutable (409
 * SCHEDULE_IMMUTABLE — corrections are waivers / audited plan close, never
 * silent recompute).
 *
 * Schedule math (flat, DR-003 — no interest, no compounding anywhere):
 *   lineAmount  = round4((total − down) / count)
 *   lastLine    = (total − down) − (count − 1) × lineAmount   (remainder
 *                 absorption — Σ lines == total − down EXACTLY, the
 *                 depreciation-kernel final-period precedent)
 * Due dates: start_date + (seq − 1) frequency steps (WEEKLY +7d, BIWEEKLY
 * +14d, MONTHLY/QUARTERLY calendar months with end-of-month clamping).
 *
 * Base-currency sources only in this phase (typed
 * PLAN_SOURCE_CURRENCY_UNSUPPORTED — honest deferral; the
 * education/healthcare flagship use-cases are base-currency).
 */
@Injectable()
export class PlanService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async createPlan(input: {
    sourceType: "sales_invoice" | "service_contract";
    sourceId: string;
    totalAmount?: string | null;
    downPayment: string;
    count: number;
    startDate: string;
    frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
    lateFeePolicy?: Partial<InstallmentPlanRow["lateFeePolicy"]> | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<{ plan: InstallmentPlanRow; lines: InstallmentLineRow[] }> {
    const base = await ownTenantBaseCurrency();
    const source = await this.resolveSource(input.sourceType, input.sourceId, base);

    // The plan total: the source document total (BR-048's equality target).
    const totalAmount = input.totalAmount ?? source.total;
    if (compareExact(input.downPayment, "0.0000") < 0) {
      throw new ScheduleInvalidError({ reason: "down payment must be ≥ 0" });
    }
    if (compareExact(input.downPayment, totalAmount) >= 0) {
      throw new ScheduleInvalidError({ reason: "down payment must be < the plan total" });
    }
    if (input.count < 1 || input.count > 120) {
      throw new ScheduleInvalidError({ reason: "line count must be between 1 and 120" });
    }

    const schedule = computeSchedule({
      total: totalAmount,
      down: input.downPayment,
      count: input.count,
      startDate: input.startDate,
      frequency: input.frequency,
    });

    const policy = normalizePolicy(input.lateFeePolicy);
    const plan = await insertPlan({
      partnerId: source.partnerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNo: source.sourceNo,
      totalAmount,
      downPayment: input.downPayment,
      lineCount: input.count,
      startDate: input.startDate,
      frequency: input.frequency,
      lateFeePolicy: policy,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await insertLines(plan.id, schedule, input.actorId);
    await this.audit.record({
      action: "installments.plan_created",
      entityType: "installment_plan",
      entityId: plan.id,
      actorId: input.actorId ?? undefined,
      after: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        totalAmount,
        downPayment: input.downPayment,
        lineCount: input.count,
        frequency: input.frequency,
        lateFeePolicy: policy,
        schedule: schedule.map((line) => ({ seq: line.seq, dueDate: line.dueDate, amount: line.amount })),
      },
    });
    return { plan, lines: await listLinesByPlan(plan.id) };
  }

  /** BR-048 activation: plan total must equal the LIVE source total — exact. */
  async activatePlan(planId: string, actorId: string | null): Promise<InstallmentPlanRow> {
    const plan = await requirePlan(planId);
    if (plan.status !== null) {
      throw new ScheduleImmutableError(plan.id);
    }
    const base = await ownTenantBaseCurrency();
    const source = await this.resolveSource(plan.sourceType, plan.sourceId, base);
    if (compareExact(plan.totalAmount, source.total) !== 0) {
      throw new PlanTotalMismatchError({
        planId: plan.id,
        planTotal: plan.totalAmount,
        sourceTotal: source.total,
      });
    }
    // The stored schedule must still sum to total − down EXACTLY.
    const lines = await listLinesByPlan(plan.id);
    let sum = "0.0000";
    for (const line of lines) {
      sum = addExact(sum, line.amount);
    }
    const expected = subExact(plan.totalAmount, plan.downPayment);
    if (compareExact(sum, expected) !== 0) {
      throw new ScheduleInvalidError({
        reason: `stored lines sum ${sum} ≠ total − down ${expected} — rebuild the draft before activating`,
      });
    }
    const activated = await updatePlanActivation(plan.id, actorId);
    await this.audit.record({
      action: "installments.plan_activated",
      entityType: "installment_plan",
      entityId: plan.id,
      actorId: actorId ?? undefined,
      before: { status: null },
      after: { status: "ACTIVE", sourceTotal: source.total },
    });
    return activated ?? plan;
  }

  /** Draft-only restructure (the wizard's back button); 409 after activation. */
  async editDraft(
    planId: string,
    patch: {
      downPayment?: string;
      count?: number;
      startDate?: string;
      frequency?: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
      lateFeePolicy?: Partial<InstallmentPlanRow["lateFeePolicy"]> | null;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<{ plan: InstallmentPlanRow; lines: InstallmentLineRow[] }> {
    const existing = await requirePlan(planId);
    if (existing.status !== null) {
      throw new ScheduleImmutableError(planId);
    }
    const down = patch.downPayment ?? existing.downPayment;
    const count = patch.count ?? existing.lineCount;
    const startDate = patch.startDate ?? existing.startDate;
    const frequency = patch.frequency ?? (existing.frequency as "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY");
    const schedule = computeSchedule({
      total: existing.totalAmount,
      down,
      count,
      startDate,
      frequency,
    });
    const updated = await updatePlanDraft(planId, {
      downPayment: down,
      lineCount: count,
      startDate,
      frequency,
      lateFeePolicy: patch.lateFeePolicy ? normalizePolicy(patch.lateFeePolicy) : undefined,
      note: patch.note ?? undefined,
      noteAr: patch.noteAr ?? undefined,
    });
    await deleteLinesByPlan(planId);
    await insertLines(planId, schedule, actorId);
    await this.audit.record({
      action: "installments.plan_draft_edited",
      entityType: "installment_plan",
      entityId: planId,
      actorId: actorId ?? undefined,
      before: { lineCount: existing.lineCount, downPayment: existing.downPayment },
      after: { lineCount: count, downPayment: down, frequency },
    });
    return { plan: updated ?? existing, lines: await listLinesByPlan(planId) };
  }

  async listPlans(filter: {
    partnerId?: string;
    status?: string | null;
    sourceType?: string;
    limit: number;
  }): Promise<InstallmentPlanRow[]> {
    return listPlans(filter);
  }

  async getPlan(planId: string): Promise<{ plan: InstallmentPlanRow; lines: InstallmentLineRow[] }> {
    return { plan: await requirePlan(planId), lines: await listLinesByPlan(planId) };
  }

  /** Resolve + validate the source document (typed 404s — S-04 spoof parity). */
  private async resolveSource(
    sourceType: "sales_invoice" | "service_contract",
    sourceId: string,
    base: string,
  ): Promise<{ partnerId: string; total: string; sourceNo: string | null; currency: string }> {
    if (sourceType === "sales_invoice") {
      const invoice = await findPlanSourceInvoice(sourceId);
      if (invoice === undefined) {
        throw new PlanSourceInvalidError({ sourceType, sourceId, reason: "invoice not found (foreign or unknown)" });
      }
      if (invoice.status !== "POSTED" || invoice.kind !== "CREDIT") {
        throw new PlanSourceInvalidError({
          sourceType,
          sourceId,
          reason: `invoice is ${invoice.status}/${invoice.kind} — plans run over POSTED credit invoices`,
        });
      }
      if (invoice.currencyCode !== base) {
        throw new PlanSourceCurrencyUnsupportedError({ sourceType, currency: invoice.currencyCode, base });
      }
      return {
        partnerId: invoice.customerId,
        total: invoice.totalGross,
        sourceNo: invoice.invoiceNo,
        currency: invoice.currencyCode,
      };
    }
    const contract = await findPlanSourceContract(sourceId);
    if (contract === undefined) {
      throw new PlanSourceInvalidError({ sourceType, sourceId, reason: "contract not found (foreign or unknown)" });
    }
    if (contract.status !== "ACTIVE") {
      throw new PlanSourceInvalidError({
        sourceType,
        sourceId,
        reason: `contract is ${contract.status} — plans run over ACTIVE contracts`,
      });
    }
    if (contract.currencyCode !== base) {
      throw new PlanSourceCurrencyUnsupportedError({ sourceType, currency: contract.currencyCode, base });
    }
    if (compareExact(contract.scheduleTotal, "0.0000") <= 0) {
      throw new PlanSourceInvalidError({
        sourceType,
        sourceId,
        reason: "the contract's billing schedule carries no billable amount (Σ PLANNED+INVOICED = 0)",
      });
    }
    return {
      partnerId: contract.partnerId,
      total: contract.scheduleTotal,
      sourceNo: contract.contractNo,
      currency: contract.currencyCode,
    };
  }
}

async function requirePlan(planId: string): Promise<InstallmentPlanRow> {
  const plan = await findPlanById(planId);
  if (plan === undefined) {
    throw new PlanSourceInvalidError({ sourceType: "plan", sourceId: planId, reason: "plan not found (foreign or unknown)" });
  }
  return plan;
}

// -- the schedule kernel (pure, exported for the rules spec) ---------------------------

export interface ScheduleLine {
  seq: number;
  dueDate: string;
  amount: string;
}

export function computeSchedule(input: {
  total: string;
  down: string;
  count: number;
  startDate: string;
  frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
}): ScheduleLine[] {
  const spread = subExact(input.total, input.down);
  const perLine = new Decimal(spread).div(input.count).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  const lines: ScheduleLine[] = [];
  let allocated = "0.0000";
  for (let seq = 1; seq <= input.count; seq += 1) {
    const amount =
      seq === input.count
        ? // Remainder absorption on the last line: Σ == spread EXACTLY.
          subExact(spread, allocated)
        : perLine;
    if (compareExact(amount, "0.0000") <= 0) {
      throw new ScheduleInvalidError({
        reason: `line ${seq} computed a non-positive amount ${amount} — adjust the down payment or count`,
      });
    }
    allocated = addExact(allocated, amount);
    lines.push({ seq, dueDate: advanceDate(input.startDate, input.frequency, seq - 1), amount });
  }
  return lines;
}

/**
 * Calendar-step date math (UTC, string-to-string): WEEKLY +7d, BIWEEKLY
 * +14d; MONTHLY/QUARTERLY add calendar months with end-of-month clamping
 * (Jan 31 + 1 month = Feb 28/29). Pure integer Y/M/D arithmetic — no
 * locale, no Date mutation.
 */
export function advanceDate(startDate: string, frequency: string, steps: number): string {
  if (steps === 0) return startDate;
  if (frequency === "WEEKLY" || frequency === "BIWEEKLY") {
    const days = frequency === "WEEKLY" ? 7 : 14;
    const ms = new Date(`${startDate}T00:00:00Z`).getTime() + steps * days * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const months = frequency === "MONTHLY" ? 1 : 3;
  const y = Number(startDate.slice(0, 4));
  const m = Number(startDate.slice(5, 7));
  const d = Number(startDate.slice(8, 10));
  const total = (y * 12 + (m - 1)) + steps * months;
  // Integer month→year division without Math.* (ADR-0009 lint rule).
  const year = (total - (total % 12)) / 12;
  const month = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, daysInMonth);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** BR-049 PLACEHOLDER defaults (OQ-002 family — configuration, never silent). */
export const LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS: InstallmentPlanRow["lateFeePolicy"] = {
  rate: "0.0200",
  cap: "500.0000",
  grace_days: 7,
  auto_charge: false,
  defaulted_after_lines: 3,
};

export function normalizePolicy(
  partial: Partial<InstallmentPlanRow["lateFeePolicy"]> | null | undefined,
): InstallmentPlanRow["lateFeePolicy"] {
  const merged = { ...LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS, ...(partial ?? {}) };
  if (compareExact(merged.rate, "0.0000") < 0) {
    throw new ScheduleInvalidError({ reason: "late-fee rate must be ≥ 0 (flat, never negative)" });
  }
  if (compareExact(merged.cap, "0.0000") < 0) {
    throw new ScheduleInvalidError({ reason: "late-fee cap must be ≥ 0" });
  }
  if (merged.grace_days < 0) {
    throw new ScheduleInvalidError({ reason: "grace days must be ≥ 0" });
  }
  if (merged.defaulted_after_lines < 1) {
    throw new ScheduleInvalidError({ reason: "defaulted_after_lines must be ≥ 1" });
  }
  return merged;
}
