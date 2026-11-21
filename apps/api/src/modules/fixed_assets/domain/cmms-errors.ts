import { DomainError } from "@erp/domain-core";

/**
 * PHASE-049 (W-17 — T-05/T-06/T-07) CMMS domain errors. Codes are stable
 * API contracts (ERROR_MODEL §4); every constraint the wave's paths touch
 * refuses BY NAME — never a silent skip, never a silent truncation
 * (the owner's W-17 item 3: قيود BR-097 وR-10 وXOR السلم تُرفع للسطح
 * رفضًا مُنمّطًا بالاسم لا قصًّا صامتًا). The DB floors (0105/0109 CHECKs
 * and partial uniques) stay the structural last line; these typed
 * refusals are the service's FIRST line — the surfaced names the floors
 * would otherwise only whisper as constraint codes.
 */

// -- the work-order machine (D-03 — the ladder's XOR/stamp law) --------------

export class CmmsWorkOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("MAINTENANCE_WORK_ORDER_NOT_FOUND", `work order ${id} does not exist in this tenant`);
  }
}

/**
 * The ladder's own named refusal (the stamp XOR — 0105's
 * ck_maintenance_work_orders_stamps made typed): every illegal transition
 * refuses with the order's current state and the refused move — a
 * regression past IN_PROGRESS, a skipped state, a move out of the
 * terminal COMPLETED. The message names BOTH ends so the board can
 * render exactly what the machine refused.
 */
export class CmmsWorkOrderStateError extends DomainError {
  constructor(details: {
    workOrderId: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "WORK_ORDER_STATE_ERROR",
      `work order ${details.workOrderId} is ${details.from} — the move to ${details.to} is illegal (${details.reason}; the ladder is REQUESTED → PLANNED → IN_PROGRESS ↔ ON_HOLD → COMPLETED, forward-only, never a regression past IN_PROGRESS — D-03)`,
      details,
    );
  }
}

/**
 * The post-completion freeze (the evidence discipline): a COMPLETED order
 * is the posted record — lines, steps and stamps refuse every touch BY
 * NAME (the 0109 grants class carries the DELETE; this refusal is the
 * typed service's own law).
 */
export class CmmsWorkOrderCompletedError extends DomainError {
  constructor(details: { workOrderId: string; completedAt: string; action: string }) {
    super(
      "WORK_ORDER_COMPLETED",
      `work order ${details.workOrderId} completed at ${details.completedAt} — ${details.action} refuses on the posted record (the completion froze the order's lines and steps)`,
      details,
    );
  }
}

/**
 * D-01's authoring guard (the frozen-substrate law): disposed/written-off
 * assets open no work order, plan or transfer — the typed refusal at
 * every authoring path (the FK stays RESTRICT; the register row is never
 * the machine's to cascade).
 */
export class CmmsAssetNotOperableError extends DomainError {
  constructor(details: { assetId: string; status: string }) {
    super(
      "ASSET_NOT_OPERABLE",
      `asset ${details.assetId} is ${details.status} — a disposed/written-off asset opens no work order, plan or transfer (D-01, the frozen-substrate law) / الأصل ${details.assetId} حالةُ ${details.status} — لا أمر صيانة ولا خطة لأصلٍ مستبعد أو مشطوب`,
      details,
    );
  }
}

/**
 * BR-098's open-step gate: completion is BLOCKED while any checklist step
 * is open — the refusal carries the open count and the offending steps'
 * titles (never a silent partial).
 */
export class CmmsStepsOpenError extends DomainError {
  constructor(details: {
    workOrderId: string;
    openCount: number;
    openSteps: readonly { seq: number; title: string }[];
  }) {
    super(
      "WORK_ORDER_STEPS_OPEN",
      `work order ${details.workOrderId} cannot complete with ${details.openCount} open checklist step(s): ${details.openSteps
        .map((step) => `#${step.seq} ${step.title}`)
        .join("; ")} — record every step's result first (BR-098) / لا اكتمال مع خطوات قائمة فحص مفتوحة — سجّل نتيجة كل خطوة أولًا`,
      { workOrderId: details.workOrderId, openCount: details.openCount, openSteps: [...details.openSteps] },
    );
  }
}

/**
 * BR-098's unpriced-line gate: completion is BLOCKED while any cost line
 * is unpriced — the refusal names EVERY offending line (leg + line no) —
 * never a fabricated rate, never a silent partial.
 */
export class CmmsCostLineUnpricedError extends DomainError {
  constructor(details: {
    workOrderId: string;
    unpriced: readonly { lineNo: number; legType: string; subject: string }[];
  }) {
    super(
      "COST_LINE_UNPRICED",
      `work order ${details.workOrderId} cannot complete with unpriced cost line(s): ${details.unpriced
        .map((line) => `line ${line.lineNo} (${line.legType} — ${line.subject})`)
        .join("; ")} — an unset labor rate or an unknown external amount is UNPRICED, never a fabricated value (BR-098; price the lines first) / لا اكتمال مع سطر تكلفة غير مسعّر — سعّر الأسطر أولًا`,
      { workOrderId: details.workOrderId, unpriced: [...details.unpriced] },
    );
  }
}

/**
 * The fused machine's zero-total law (the 0105 journal gate's own
 * consequence): every COMPLETED order carries its G-59 journal
 * (ck_maintenance_work_orders_journal_gated), and the posting engine
 * writes only positive amounts (POSTING_ENGINE §2) — so a zero-total
 * completion has no entry the engine can write. The refusal names the
 * three totals and demands at least one priced line.
 */
export class CmmsWorkOrderZeroTotalError extends DomainError {
  constructor(details: {
    workOrderId: string;
    laborTotal: string;
    partsTotal: string;
    externalTotal: string;
  }) {
    super(
      "WORK_ORDER_ZERO_TOTAL",
      `work order ${details.workOrderId} has a zero cost total (labor ${details.laborTotal} + parts ${details.partsTotal} + external ${details.externalTotal}) — the completion act IS the G-59 posting and every COMPLETED order carries its journal (the 0105 journal gate); record at least one priced cost line / الاكتمال هو نفسه ترحيل G-59 — سجّل سطر تكلفة مسعّرًا واحدًا على الأقل`,
      details,
    );
  }
}

/**
 * The completion's CAS guard (the raced double-complete): the single-use
 * stamp consumed concurrently — reload and look (the change-order
 * CAS refusal's shape).
 */
export class CmmsWorkOrderCompletionRaceError extends DomainError {
  constructor(details: { workOrderId: string }) {
    super(
      "WORK_ORDER_COMPLETION_RACE",
      `work order ${details.workOrderId} left the completable states concurrently — the completion stamp is single-use; reload the order`,
      details,
    );
  }
}

/** Input validation (the invalid-amount failure-pack class). */
export class CmmsInputInvalidError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CMMS_INPUT_INVALID", message, details);
  }
}

// -- the cost lines (D-03/D-05 — the collectors' own laws) ---------------------

export class CmmsCostLineNotFoundError extends DomainError {
  constructor(details: { workOrderId: string; lineId: string }) {
    super(
      "COST_LINE_NOT_FOUND",
      `cost line ${details.lineId} does not exist on work order ${details.workOrderId}`,
      details,
    );
  }
}

/**
 * D-03's snapshot law: a priced line's rate is FROZEN (the
 * crm_time_entries.unitRate precedent — snapshotted at line creation,
 * never recomputed). Re-pricing a priced line refuses BY NAME; only an
 * UNPRICED line (rate NULL) can receive its price.
 */
export class CmmsRateSnapshotError extends DomainError {
  constructor(details: { lineId: string; legType: string; action: string }) {
    super(
      "COST_RATE_SNAPSHOT",
      `cost line ${details.lineId} (${details.legType}) refuses ${details.action}: the rate/amount snapshot is frozen once priced (the crm_time_entries.unitRate law — reprice by removing the line while the order is open and adding the corrected one)`,
      details,
    );
  }
}

/**
 * D-05's line-creation floor (BR-099's first half): the no-negative-stock
 * check AT LINE CREATION — the refusal names the shortfall and the
 * warehouse (never a silent backorder inside a work order). The issue
 * itself re-asserts at the completion act (planIssue's own guard).
 */
export class CmmsPartsShortfallError extends DomainError {
  constructor(details: {
    itemId: string;
    warehouseId: string;
    onHand: string;
    requested: string;
  }) {
    super(
      "PARTS_SHORTFALL",
      `item ${details.itemId} in the warehouse has only ${details.onHand} on hand — the work order's parts lines claim ${details.requested} (the no-negative-stock floor is checked at line creation; never a silent backorder inside a work order — D-05/BR-099) / الكمية المتاحة لا تكفي — لا صرفٍ سالب داخل أمر صيانة`,
      details,
    );
  }
}

// -- the step results (D-08 — the carry-over's results) ------------------------

export class CmmsStepNotFoundError extends DomainError {
  constructor(details: { workOrderId: string; stepId: string }) {
    super(
      "WORK_ORDER_STEP_NOT_FOUND",
      `checklist step ${details.stepId} does not exist on work order ${details.workOrderId}`,
      details,
    );
  }
}

// -- the plans (D-08 — BR-097 + the XOR trigger shape) --------------------------

export class CmmsPlanNotFoundError extends DomainError {
  constructor(id: string) {
    super("MAINTENANCE_PLAN_NOT_FOUND", `maintenance plan ${id} does not exist in this tenant`);
  }
}

/**
 * D-08's XOR shape law (0105's ck_maintenance_plans_trigger_shape made
 * typed): a plan is EXACTLY ONE trigger kind — CALENDAR carries
 * interval_days + next_due_date and never a meter; METER carries the
 * meter FK + the delta threshold and never a calendar pair.
 */
export class CmmsPlanTriggerShapeError extends DomainError {
  constructor(details: { message: string }) {
    super("PLAN_TRIGGER_SHAPE", details.message, details);
  }
}

/**
 * BR-097's single-open window (0105's partial unique made typed): at
 * most ONE open generated order per (asset, plan) — the forced
 * generation path refuses BY NAME (the scheduled evaluation reports the
 * same name in its skip list); the window re-arms when the open order
 * completes.
 */
export class CmmsPlanWindowOpenError extends DomainError {
  constructor(details: {
    planId: string;
    assetId: string;
    openOrderId: string;
    openOrderNo: string | null;
  }) {
    super(
      "PLAN_WINDOW_OPEN",
      `plan ${details.planId} already holds an open generated order for this asset (${details.openOrderNo ?? details.openOrderId}) — at most one open order per asset per trigger window (BR-097); the window re-arms when it completes / نافذة مفتوحة واحدة كحد أقصى لكل أصل وخطة حتى يُنجز أمرها`,
      details,
    );
  }
}

export class CmmsPlanTaskNotFoundError extends DomainError {
  constructor(details: { planId: string; taskId: string }) {
    super(
      "MAINTENANCE_PLAN_TASK_NOT_FOUND",
      `checklist task ${details.taskId} does not exist on plan ${details.planId}`,
      details,
    );
  }
}

/** A meter referenced by a METER plan must exist in this tenant (the
 * additive 0106 FK's typed first line). */
export class CmmsMeterNotFoundError extends DomainError {
  constructor(details: { meterId: string }) {
    super(
      "ASSET_METER_NOT_FOUND",
      `asset meter ${details.meterId} does not exist in this tenant — a METER trigger plan binds a real meter (0106's FK)`,
      details,
    );
  }
}
