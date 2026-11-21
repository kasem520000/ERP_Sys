import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as store from "../infrastructure/cmms.store";
import {
  CmmsAssetNotOperableError,
  CmmsInputInvalidError,
  CmmsMeterNotFoundError,
  CmmsPlanNotFoundError,
  CmmsPlanTaskNotFoundError,
  CmmsPlanTriggerShapeError,
  CmmsPlanWindowOpenError,
} from "../domain/cmms-errors";
import {
  calendarDue,
  generationDecision,
  meterDue,
  nextCalendarDue,
  type GenerationSkipReason,
} from "../domain/cmms-plan-math";
import { WORK_ORDER_NUMBER_FORMAT } from "./maintenance-work-order-service";

/**
 * PHASE-049 (W-17 — T-07) THE PLANS API: the preventive register (D-08)
 * — CALENDAR (interval days + the strict-cadence next_due) or METER (a
 * chosen meter + the delta threshold; the XOR shape law refused BY NAME
 * at every authoring path), the checklist template
 * (maintenance_plan_tasks), and THE EVALUATION + GENERATION ENGINE:
 *
 *   CALENDAR — due when today ≥ next_due (inclusive); the generation
 *   re-arms next_due := next_due + interval_days (the STRICT CADENCE —
 *   the plan's own calendar anchor, never wall-clock drift).
 *
 *   METER — due when reading.value − last_anchor_value ≥ threshold; the
 *   anchor is the GENERATION's own reading stamp, so a back-dated
 *   reading can never double-trigger (a window already generated never
 *   re-arms — acceptance #5's law). THE AUTHORING BASELINE: a METER plan
 *   snapshots the meter's current position (last_value) into the anchor
 *   at authoring — the first window measures from where the meter stood
 *   when the plan was defined (a 5,000-km plan authored at 10,000 km
 *   opens at 15,000, never immediately) — the declared interpretation,
 *   recorded in the spec and the evidence.
 *
 *   BR-097 — at most ONE open generated order per (asset, plan): the
 *   evaluation's decision fold skips BY NAME (PLAN_WINDOW_OPEN — the
 *   skip list the scheduled sweep reports); the FORCED path (generate
 *   on demand) refuses BY NAME; the 0105 partial unique is the raced
 *   floor (the 23505 surfaced as the same named refusal). A window
 *   re-arms when its open order completes.
 *
 *   THE CARRY-OVER — the generated order enters at PLANNED with the
 *   plan's ACTIVE checklist tasks COPIED onto it (the seq/title/
 *   instruction snapshot; a later plan edit never rewrites a generated
 *   order's carried steps).
 *
 * The evaluation is PURE-driven end to end (cmms-plan-math — zero
 * parallel computation): every due check, every cadence recompute and
 * every skip reason comes from the fold; this service owns only the
 * reads, the stamps and the generation act. The event-driven wiring
 * (the reading's own transaction) is W-18's; the daily sweep job is
 * W-19's — this wave exposes the explicit evaluation surface both will
 * call.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new CmmsInputInvalidError(`${what} must be a UUID: ${value}`);
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Pg constraint name over the drizzle cause chain. */
function pgConstraintOf(error: unknown): string | undefined {
  let candidate: unknown = error;
  for (let step = 0; step < 5 && candidate !== null && candidate !== undefined; step += 1) {
    const constraint = (candidate as { constraint?: string }).constraint;
    if (typeof constraint === "string") return constraint;
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return undefined;
}

/** D-08's XOR shape law — the authoring-side named refusal (the 0105
 * CHECK is the floor; this is the surfaced first line). */
function requireTriggerShape(input: {
  triggerType: "CALENDAR" | "METER";
  intervalDays: number | null;
  nextDueDate: string | null;
  meterId: string | null;
  thresholdDelta: string | null;
}): void {
  if (input.triggerType === "CALENDAR") {
    if (input.intervalDays === null || input.nextDueDate === null) {
      throw new CmmsPlanTriggerShapeError({
        message:
          "a CALENDAR plan carries interval_days AND next_due_date (both required) — the XOR shape law: a plan is EXACTLY ONE trigger kind / خطة التقويم تحمل الفاصل والتاريخ المستحق معًا",
      });
    }
    if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1 || input.intervalDays > 3650) {
      throw new CmmsInputInvalidError(`intervalDays must be an integer in [1, 3650]: ${input.intervalDays}`);
    }
    if (!DATE_RE.test(input.nextDueDate)) {
      throw new CmmsInputInvalidError(`nextDueDate must be an ISO date (yyyy-mm-dd): ${input.nextDueDate}`);
    }
    if (input.meterId !== null || input.thresholdDelta !== null) {
      throw new CmmsPlanTriggerShapeError({
        message:
          "a CALENDAR plan never carries a meter or a threshold (the XOR shape law) — a plan is EXACTLY ONE trigger kind / خطة التقويم لا تحمل عدّادًا ولا عتبة",
      });
    }
  } else {
    if (input.meterId === null || input.thresholdDelta === null) {
      throw new CmmsPlanTriggerShapeError({
        message:
          "a METER plan carries its meter AND the threshold delta (both required) — the XOR shape law / خطة العدّاد تحمل العدّاد والعتبة معًا",
      });
    }
    if (!QTY_RE.test(input.thresholdDelta) || new Decimal(input.thresholdDelta).lessThanOrEqualTo(0)) {
      throw new CmmsInputInvalidError(`thresholdDelta must be a positive decimal (≤ 6dp): ${input.thresholdDelta}`);
    }
    if (input.intervalDays !== null || input.nextDueDate !== null) {
      throw new CmmsPlanTriggerShapeError({
        message:
          "a METER plan never carries a calendar pair (the XOR shape law) — a plan is EXACTLY ONE trigger kind / خطة العدّاد لا تحمل زوج التقويم",
      });
    }
  }
}

/** One plan's evaluation verdict (the explicit surface's report row). */
export interface PlanEvaluationResult {
  planId: string;
  assetId: string;
  triggerType: string;
  generated: boolean;
  /** Present exactly when generated is false — the NAMED skip. */
  skipReason?: GenerationSkipReason | "PLAN_INACTIVE" | "METER_NO_READING";
  orderId?: string;
  orderNo?: string;
}

@Injectable()
export class MaintenancePlanService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  // -- the register (D-08) ------------------------------------------------------

  async create(input: {
    assetId: string;
    name: string;
    nameAr?: string | null;
    description?: string | null;
    descriptionAr?: string | null;
    triggerType: "CALENDAR" | "METER";
    intervalDays?: number | null;
    nextDueDate?: string | null;
    meterId?: string | null;
    thresholdDelta?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.PlanRow> {
    requireUuid(input.assetId, "assetId");
    if (input.name.trim().length === 0 || input.name.length > 200) {
      throw new CmmsInputInvalidError("name is required (1…200 chars)");
    }
    const intervalDays = input.intervalDays ?? null;
    const nextDueDate = input.nextDueDate ?? null;
    const meterId = input.meterId ?? null;
    const thresholdDelta = input.thresholdDelta ?? null;
    requireTriggerShape({ triggerType: input.triggerType, intervalDays, nextDueDate, meterId, thresholdDelta });

    // D-01's authoring guard: a disposed/written-off asset opens no plan.
    const asset = await store.findAssetStatus(input.assetId);
    if (asset === undefined) {
      throw new CmmsInputInvalidError(`asset ${input.assetId} does not exist in this tenant`);
    }
    if (asset.status === "DISPOSED" || asset.status === "WRITTEN_OFF") {
      throw new CmmsAssetNotOperableError({ assetId: input.assetId, status: asset.status });
    }

    // THE AUTHORING BASELINE (the declared interpretation): a METER plan
    // snapshots the meter's current position — the first window measures
    // from where the meter stood at plan definition (never an immediate
    // trigger on an existing meter's history).
    let lastAnchorValue: string | null = null;
    if (input.triggerType === "METER") {
      const meter = await store.findMeterSnapshot(meterId!);
      if (meter === undefined) {
        throw new CmmsMeterNotFoundError({ meterId: meterId! });
      }
      if (meter.assetId !== input.assetId) {
        throw new CmmsInputInvalidError(
          `meter ${meterId} belongs to asset ${meter.assetId}, not ${input.assetId} — a plan binds its own asset's meter`,
        );
      }
      lastAnchorValue = meter.lastValue;
    }

    const plan = await store.insertPlan({
      assetId: input.assetId,
      name: input.name,
      nameAr: input.nameAr ?? null,
      description: input.description ?? null,
      descriptionAr: input.descriptionAr ?? null,
      triggerType: input.triggerType,
      intervalDays,
      nextDueDate,
      meterId,
      thresholdDelta,
      lastAnchorValue,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "assets.maintenance_plan_created",
      entityType: "maintenance_plan",
      entityId: plan.id,
      actorId: input.actorId ?? undefined,
      after: {
        assetId: plan.assetId,
        triggerType: plan.triggerType,
        intervalDays: plan.intervalDays,
        meterId: plan.meterId,
        thresholdDelta: plan.thresholdDelta,
        lastAnchorValue: plan.lastAnchorValue,
      },
    });
    return plan;
  }

  async get(planId: string): Promise<store.PlanRow> {
    requireUuid(planId, "planId");
    const plan = await store.findPlanById(planId);
    if (plan === undefined) throw new CmmsPlanNotFoundError(planId);
    return plan;
  }

  async list(filter: { assetId?: string; activeOnly?: boolean }): Promise<store.PlanRow[]> {
    if (filter.assetId !== undefined) requireUuid(filter.assetId, "assetId");
    return store.listPlans(filter);
  }

  async patch(input: {
    planId: string;
    name?: string;
    nameAr?: string | null;
    description?: string | null;
    descriptionAr?: string | null;
    isActive?: boolean;
    intervalDays?: number | null;
    nextDueDate?: string | null;
    thresholdDelta?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.PlanRow> {
    const plan = await this.get(input.planId);
    // The trigger kind is the plan's identity — the shape can never be
    // swapped in place (the named refusal, never a silent kind flip).
    const nextInterval = input.intervalDays ?? plan.intervalDays;
    const nextDue = input.nextDueDate ?? plan.nextDueDate;
    const nextThreshold = input.thresholdDelta ?? plan.thresholdDelta;
    requireTriggerShape({
      triggerType: plan.triggerType as "CALENDAR" | "METER",
      intervalDays: nextInterval,
      nextDueDate: nextDue,
      meterId: plan.meterId,
      thresholdDelta: nextThreshold,
    });
    const patched = await store.patchPlan({
      planId: plan.id,
      name: input.name,
      nameAr: input.nameAr ?? undefined,
      description: input.description ?? undefined,
      descriptionAr: input.descriptionAr ?? undefined,
      isActive: input.isActive,
      intervalDays: input.intervalDays ?? undefined,
      nextDueDate: input.nextDueDate ?? undefined,
      thresholdDelta: input.thresholdDelta ?? undefined,
      note: input.note ?? undefined,
      noteAr: input.noteAr ?? undefined,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "assets.maintenance_plan_patched",
      entityType: "maintenance_plan",
      entityId: plan.id,
      actorId: input.actorId ?? undefined,
      before: { intervalDays: plan.intervalDays, nextDueDate: plan.nextDueDate, thresholdDelta: plan.thresholdDelta, isActive: plan.isActive },
      after: { intervalDays: patched?.intervalDays, nextDueDate: patched?.nextDueDate, thresholdDelta: patched?.thresholdDelta, isActive: patched?.isActive },
    });
    return patched ?? plan;
  }

  // -- the checklist template (D-08 — BR-098's source) ---------------------------

  async addTask(input: {
    planId: string;
    seq?: number;
    title: string;
    titleAr?: string | null;
    instruction?: string | null;
    instructionAr?: string | null;
    actorId: string | null;
  }): Promise<store.PlanTaskRow> {
    const plan = await this.get(input.planId);
    if (input.title.trim().length === 0 || input.title.length > 300) {
      throw new CmmsInputInvalidError("title is required (1…300 chars)");
    }
    const seq = input.seq ?? (await this.nextSeq(plan.id));
    if (!Number.isInteger(seq) || seq < 1) {
      throw new CmmsInputInvalidError(`seq must be a positive integer: ${seq}`);
    }
    const task = await store.insertPlanTask({
      planId: plan.id,
      seq,
      title: input.title,
      titleAr: input.titleAr ?? null,
      instruction: input.instruction ?? null,
      instructionAr: input.instructionAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "assets.maintenance_plan_task_added",
      entityType: "maintenance_plan_task",
      entityId: task.id,
      actorId: input.actorId ?? undefined,
      after: { planId: plan.id, seq: task.seq, title: task.title },
    });
    return task;
  }

  private async nextSeq(planId: string): Promise<number> {
    const tasks = await store.listPlanTasks(planId);
    return tasks.reduce((max, task) => Math.max(max, task.seq), 0) + 1;
  }

  async listTasks(planId: string): Promise<store.PlanTaskRow[]> {
    await this.get(planId);
    return store.listPlanTasks(planId);
  }

  async patchTask(input: {
    planId: string;
    taskId: string;
    title?: string;
    titleAr?: string | null;
    instruction?: string | null;
    instructionAr?: string | null;
    isActive?: boolean;
    actorId: string | null;
  }): Promise<store.PlanTaskRow> {
    await this.get(input.planId);
    requireUuid(input.taskId, "taskId");
    const existing = await store.listPlanTasks(input.planId);
    if (!existing.some((task) => task.id === input.taskId)) {
      throw new CmmsPlanTaskNotFoundError({ planId: input.planId, taskId: input.taskId });
    }
    const patched = await store.patchPlanTask({
      taskId: input.taskId,
      title: input.title,
      titleAr: input.titleAr ?? undefined,
      instruction: input.instruction ?? undefined,
      instructionAr: input.instructionAr ?? undefined,
      isActive: input.isActive,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "assets.maintenance_plan_task_patched",
      entityType: "maintenance_plan_task",
      entityId: input.taskId,
      actorId: input.actorId ?? undefined,
      after: { isActive: patched?.isActive, title: patched?.title },
    });
    return patched!;
  }

  async removeTask(input: { planId: string; taskId: string; actorId: string | null }): Promise<void> {
    await this.get(input.planId);
    requireUuid(input.taskId, "taskId");
    const existing = await store.listPlanTasks(input.planId);
    if (!existing.some((task) => task.id === input.taskId)) {
      throw new CmmsPlanTaskNotFoundError({ planId: input.planId, taskId: input.taskId });
    }
    // A task with CARRIED steps (generated orders) refuses the delete —
    // the pre-check (the FK stays the raced floor; the pre-check refuses
    // BEFORE any statement fails, keeping the transaction usable).
    const carried = await store.countCarriedSteps(input.taskId);
    if (carried > 0) {
      throw new CmmsInputInvalidError(
        `checklist task ${input.taskId} has ${carried} carried step(s) on generated orders (the source FK is RESTRICT) — deactivate the task instead (is_active = false)`,
      );
    }
    await store.deletePlanTask(input.taskId);
    await this.audit.record({
      action: "assets.maintenance_plan_task_removed",
      entityType: "maintenance_plan_task",
      entityId: input.taskId,
      actorId: input.actorId ?? undefined,
    });
  }

  // -- THE EVALUATION + GENERATION (D-08 — BR-097) -------------------------------

  /**
   * THE EXPLICIT EVALUATION (the surface W-18's event wiring and W-19's
   * sweep call): evaluates one plan against today (CALENDAR) or the
   * meter's latest reading (METER), applies the generation decision fold
   * (the NAMED skips), and — when the window is due and closed —
   * generates the order (PLANNED, the checklist carried) and stamps the
   * plan (the strict cadence / the generation's own anchor). All in the
   * caller's ambient transaction.
   */
  async evaluate(input: {
    planId: string;
    actorId: string | null;
    /** The evaluation day (ISO) — injectable for deterministic tests;
     * defaults to today. */
    today?: string;
  }): Promise<PlanEvaluationResult> {
    const plan = await this.get(input.planId);
    const today = input.today ?? todayIso();
    const base: Omit<PlanEvaluationResult, "generated" | "orderId" | "orderNo" | "skipReason"> = {
      planId: plan.id,
      assetId: plan.assetId,
      triggerType: plan.triggerType,
    };

    if (!plan.isActive) {
      return { ...base, generated: false, skipReason: "PLAN_INACTIVE" };
    }

    let due = false;
    let triggeringReadingValue: string | null = null;
    if (plan.triggerType === "CALENDAR") {
      due = calendarDue(today, plan.nextDueDate!);
    } else {
      const readings = await store.latestMeterReadings([plan.meterId!]);
      const reading = readings.get(plan.meterId!);
      if (reading === undefined) {
        return { ...base, generated: false, skipReason: "METER_NO_READING" };
      }
      due = meterDue(reading.value, plan.lastAnchorValue, plan.thresholdDelta!);
      triggeringReadingValue = reading.value;
    }

    // BR-097's fold — the named skip (the window re-arms when the open
    // order completes; the 0105 partial unique stays the raced floor).
    const openOrder = await store.findOpenGeneratedOrder(plan.assetId, plan.id);
    const decision = generationDecision({ due, openWindow: openOrder !== undefined });
    if (!decision.generate) {
      return { ...base, generated: false, skipReason: decision.skipReason };
    }

    const generated = await this.generate(plan, input.actorId, {
      nextDueDate: plan.triggerType === "CALENDAR"
        ? nextCalendarDue(plan.nextDueDate!, plan.intervalDays!)
        : null,
      lastAnchorValue: plan.triggerType === "METER" ? triggeringReadingValue : null,
    });
    return {
      ...base,
      generated: true,
      orderId: generated.id,
      orderNo: generated.orderNo,
    };
  }

  /**
   * THE FORCED GENERATION (the board's «generate now» — never a silent
   * skip): refuses BY NAME when the window holds an open order; a not-due
   * plan generates only when `force` is explicit (the operator's own
   * responsibility, audited with the flag).
   */
  async forceGenerate(input: {
    planId: string;
    actorId: string | null;
    force?: boolean;
  }): Promise<{ orderId: string; orderNo: string }> {
    const plan = await this.get(input.planId);
    const openOrder = await store.findOpenGeneratedOrder(plan.assetId, plan.id);
    if (openOrder !== undefined) {
      throw new CmmsPlanWindowOpenError({
        planId: plan.id,
        assetId: plan.assetId,
        openOrderId: openOrder.id,
        openOrderNo: openOrder.orderNo,
      });
    }
    let due = false;
    let triggeringReadingValue: string | null = null;
    if (plan.triggerType === "CALENDAR") {
      due = calendarDue(todayIso(), plan.nextDueDate!);
    } else {
      const readings = await store.latestMeterReadings([plan.meterId!]);
      const reading = readings.get(plan.meterId!);
      if (reading === undefined) {
        if (input.force !== true) {
          throw new CmmsInputInvalidError(
            `plan ${plan.id}'s meter has no readings yet — generate with force=true to open the window anyway (the operator's own responsibility)`,
          );
        }
      } else {
        due = meterDue(reading.value, plan.lastAnchorValue, plan.thresholdDelta!);
        triggeringReadingValue = reading.value;
      }
    }
    if (!due && input.force !== true) {
      throw new CmmsInputInvalidError(
        `plan ${plan.id} is not due yet (calendar ${plan.nextDueDate ?? "—"} / anchor ${plan.lastAnchorValue ?? "—"} + ${plan.thresholdDelta ?? "—"}) — generate with force=true to open the window anyway`,
      );
    }
    const generated = await this.generate(plan, input.actorId, {
      nextDueDate: plan.triggerType === "CALENDAR"
        ? nextCalendarDue(plan.nextDueDate!, plan.intervalDays!)
        : null,
      lastAnchorValue: plan.triggerType === "METER"
        ? (triggeringReadingValue ?? plan.lastAnchorValue)
        : null,
    });
    return { orderId: generated.id, orderNo: generated.orderNo };
  }

  /** The bulk sweep entry (the daily calendar walk's surface — W-19's
   * job calls this; the skips are NAMED in the report, never silent). */
  async evaluateAll(input: {
    actorId: string | null;
    today?: string;
  }): Promise<PlanEvaluationResult[]> {
    const plans = await store.listPlans({ activeOnly: true, limit: 1000 });
    const results: PlanEvaluationResult[] = [];
    for (const plan of plans) {
      results.push(await this.evaluate({ planId: plan.id, actorId: input.actorId, today: input.today }));
    }
    return results;
  }

  /** THE GENERATION ACT: the order enters at PLANNED (the plan link, the
   * plan stamp, the problem text from the plan's own name) with the
   * checklist carried (the ACTIVE tasks' snapshot) — then the plan's own
   * stamps move (the strict cadence / the generation's own anchor) in
   * the same ambient transaction. The raced double-generate surfaces the
   * 0105 partial unique as the NAMED window refusal. */
  private async generate(
    plan: store.PlanRow,
    actorId: string | null,
    stamps: { nextDueDate: string | null; lastAnchorValue: string | null },
  ): Promise<{ id: string; orderNo: string }> {
    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: WORK_ORDER_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: WORK_ORDER_NUMBER_FORMAT.format,
      prefix: WORK_ORDER_NUMBER_FORMAT.prefix,
      year,
    });
    let orderId = "";
    try {
      const order = await store.insertWorkOrder({
        assetId: plan.assetId,
        orderNo: acquired.number,
        problem: `Preventive: ${plan.name}`,
        problemAr: plan.nameAr === null ? null : `وقائية: ${plan.nameAr}`,
        priority: "MEDIUM",
        technicianEmployeeId: null,
        status: "PLANNED",
        planId: plan.id,
        plannedAt: nowIso(),
        note: plan.description,
        noteAr: plan.descriptionAr,
        createdBy: actorId,
      });
      orderId = order.id;
      await this.numbering.bind(WORK_ORDER_NUMBER_FORMAT.docType, acquired.number, order.id);
    } catch (error) {
      if (pgConstraintOf(error) === "uq_maintenance_work_orders_tenant_plan_open") {
        throw new CmmsPlanWindowOpenError({
          planId: plan.id,
          assetId: plan.assetId,
          openOrderId: "raced",
          openOrderNo: null,
        });
      }
      throw error;
    }
    // THE CARRY-OVER: the ACTIVE tasks copied (the snapshot law).
    const tasks = (await store.listPlanTasks(plan.id)).filter((task) => task.isActive);
    if (tasks.length > 0) {
      await store.insertOrderSteps(
        tasks.map((task) => ({
          workOrderId: orderId,
          sourceTaskId: task.id,
          seq: task.seq,
          title: task.title,
          titleAr: task.titleAr,
          instruction: task.instruction,
          instructionAr: task.instructionAr,
          createdBy: actorId,
        })),
      );
    }
    await store.stampPlanGenerated({
      planId: plan.id,
      nextDueDate: stamps.nextDueDate,
      lastAnchorValue: stamps.lastAnchorValue,
      generatedAt: nowIso(),
    });
    await this.audit.record({
      action: "assets.maintenance_plan_generated",
      entityType: "maintenance_work_order",
      entityId: orderId,
      actorId: actorId ?? undefined,
      after: {
        planId: plan.id,
        orderNo: acquired.number,
        carriedSteps: tasks.length,
        nextDueDate: stamps.nextDueDate,
        lastAnchorValue: stamps.lastAnchorValue,
      },
    });
    return { id: orderId, orderNo: acquired.number };
  }
}
