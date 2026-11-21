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

// ═══ W-18 (T-08/T-09/T-10) — the meters + spares + transfers plane ══════════

// -- the meters (D-07 — R-10's write-path arms, the monotonic law) ----------

/**
 * R-10's KM-only odometer law (0106's ck_asset_meters_odometer_gated made
 * typed): the odometer designation is the KM-type meter's — never a
 * hours/production/custom odometer (the fleet register reads THE odometer
 * of a vehicle-class asset).
 */
export class CmmsOdometerNotKmError extends DomainError {
  constructor(details: { meterId?: string; type: string; action: string }) {
    super(
      "ODOMETER_NOT_KM",
      `the odometer designation is the KM-type meter's — a ${details.type} meter never carries it (${details.action}; R-10's fleet-light binding: the register reads THE odometer of a vehicle-class asset) / تعيين عداد المسافة لعدّاد من نوع كم فقط — ربط أسطول R-10`,
      details,
    );
  }
}

/**
 * R-10's one-per-asset designation (0106's uq_asset_meters_tenant_asset_
 * odometer made typed): ONE odometer per asset — the second designation
 * refuses BY NAME carrying the standing one.
 */
export class CmmsOdometerAlreadyDesignatedError extends DomainError {
  constructor(details: {
    assetId: string;
    existingMeterId: string;
    existingMeterName: string;
    action: string;
  }) {
    super(
      "ODOMETER_ALREADY_DESIGNATED",
      `asset ${details.assetId} already carries its odometer (meter ${details.existingMeterName} — ${details.existingMeterId}); ONE odometer designation per asset (${details.action}; R-10) / عدّاد مسافة واحد لكل أصل — R-10`,
      details,
    );
  }
}

/**
 * D-07's monotonic law (the 0106 header's own W-18 assignment): a reading
 * below the meter's current snapshot refuses — the typed error carries
 * BOTH values (the snapshot and the refused reading).
 */
export class CmmsMeterRegressionError extends DomainError {
  constructor(details: { meterId: string; snapshotValue: string; readingValue: string }) {
    super(
      "METER_REGRESSION",
      `meter ${details.meterId} stands at ${details.snapshotValue} — the reading ${details.readingValue} is below the current snapshot (the monotonic law: a reading below the meter's snapshot refuses, both values named; a back-dated-but-HIGHER reading is legal and moves the snapshot) / قراءة أدنى من لقطة العدّاد تُرفض بالقيمتين — والقراءة المؤخّرة الأعلى قانونية وتحرّك اللقطة`,
      details,
    );
  }
}

/**
 * D-07's JOB-link law (0106's ck_asset_meter_readings_job_link made
 * typed): the JOB source and the work-order link exist together or not at
 * all — and the linked order is a COMPLETED one (the technician's
 * completion-time entry; a mid-job reading is the MANUAL source).
 */
export class CmmsReadingJobLinkError extends DomainError {
  constructor(details: {
    message: string;
    workOrderStatus?: string;
  }) {
    super("READING_JOB_LINK", details.message, details);
  }
}

/** A reading's linked work order must exist in this tenant (the FK's
 * typed first line). */
export class CmmsReadingWorkOrderNotFoundError extends DomainError {
  constructor(details: { workOrderId: string }) {
    super(
      "READING_WORK_ORDER_NOT_FOUND",
      `work order ${details.workOrderId} does not exist in this tenant — a JOB reading links a real work order (0106's FK)`,
      details,
    );
  }
}

// -- the spares BOM (D-05 — BR-099's save-time drift mitigation) -------------

export class CmmsSpareNotFoundError extends DomainError {
  constructor(id: string) {
    super("ASSET_SPARE_NOT_FOUND", `spare BOM line ${id} does not exist in this tenant`);
  }
}

/**
 * The phase doc's own drift mitigation, made typed: a discontinued item
 * refuses at BOM save — the BOM never points at a dead item (the parts
 * picking surface stays honest).
 */
export class CmmsSpareItemDiscontinuedError extends DomainError {
  constructor(details: { itemId: string; sku: string; status: string }) {
    super(
      "SPARE_ITEM_DISCONTINUED",
      `item ${details.sku} (${details.itemId}) is ${details.status} — a discontinued item refuses at BOM save (the phase doc's own drift mitigation; the BOM never points at a dead item) / صنف موقوف لا يدخل قائمة قطع الغيار`,
      details,
    );
  }
}

// -- the transfers ladder (D-06 — BR-100/G-61) --------------------------------

export class CmmsTransferNotFoundError extends DomainError {
  constructor(id: string) {
    super("ASSET_TRANSFER_NOT_FOUND", `asset transfer ${id} does not exist in this tenant`);
  }
}

/**
 * The ladder's own named refusal (0107's ck_asset_transfers_stamps made
 * typed): every illegal move refuses with the transfer's current state
 * and the refused move — a submit on a submitted/approved/rejected row,
 * a verdict on a draft, a re-verdict on a decided row. Both ends named.
 */
export class CmmsTransferStateError extends DomainError {
  constructor(details: {
    transferId: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "TRANSFER_STATE_ERROR",
      `asset transfer ${details.transferId} is ${details.from} — the move to ${details.to} is illegal (${details.reason}; the ladder is DRAFT → SUBMITTED → APPROVED/REJECTED, the verdict XOR — never both) / حركة غير قانونية على سلم النقل`,
      details,
    );
  }
}

/** The raced/stale verdict (the CAS guard) — reload and retry. */
export class CmmsTransferRaceError extends DomainError {
  constructor(details: { transferId: string; action: string }) {
    super(
      "TRANSFER_RACE",
      `asset transfer ${details.transferId} left the expected state concurrently (${details.action}) — the verdict stamps are single-use; reload the transfer`,
      details,
    );
  }
}

/**
 * The honest-transfer floor: a transfer's from-branch is the asset's
 * CURRENT branch — a transfer authored (or idling) while the asset moved
 * on refuses BY NAME with both branches (never a silent wrong-side flip).
 */
export class CmmsTransferStaleError extends DomainError {
  constructor(details: {
    transferId: string;
    fromBranchId: string;
    assetBranchId: string;
  }) {
    super(
      "TRANSFER_STALE",
      `asset transfer ${details.transferId} departs branch ${details.fromBranchId} but the asset now sits in branch ${details.assetBranchId} — a stale transfer never flips (another approved transfer moved the asset; author a new transfer from its current branch) / نقل متقادم لا يُقلب الفرع — أنشئ نقلًا جديدًا من الفرع الحالي`,
      details,
    );
  }
}

/**
 * SoD (AUTHORIZATION_MATRIX §4, the disposal/treasury pattern): the
 * transfer's creator never approves their own transfer — the approver is
 * a second user (a system-created transfer with createdBy NULL never
 * trips).
 */
export class CmmsTransferSelfApprovalError extends DomainError {
  constructor(details: { transferId: string; userId: string }) {
    super(
      "TRANSFER_SELF_APPROVAL_BLOCKED",
      `the creator cannot approve their own transfer (SoD, AUTHORIZATION_MATRIX §4 — the G-61 approver must be a second user) / لا يعتمد منشئ النقل نقله بنفسه — فصل المهام`,
      details,
    );
  }
}

/**
 * G-61's mapping check (0107's own law, fail-closed BEFORE the flip): a
 * branch without its mapped asset account refuses BY NAME — the branch↔
 * account pair resolves through the EXISTING per-branch FIXED_ASSET
 * purpose mapping (`FIXED_ASSET_{BRANCH_CODE}`, the account_purposes
 * mechanism 0108 declared — "no new marker"); PURPOSE_NOT_MAPPED is the
 * name (the posting engine's own fail-closed vocabulary).
 */
export class CmmsTransferBranchUnmappedError extends DomainError {
  constructor(details: {
    branchId: string;
    branchCode: string;
    purposeKey: string;
  }) {
    super(
      "PURPOSE_NOT_MAPPED",
      `branch ${details.branchCode} has no mapped asset account — map the purpose ${details.purposeKey} to an active account first (G-61 fails closed until the tenant maps the branch↔account pair; the check runs BEFORE the flip, the 038/0077 discipline) / لا اعتماد قبل ربط فرع النقل بحساب أصوله — الفشل مغلق`,
      details,
    );
  }
}

/** The verdict is never silent: a rejection carries its reason. */
export class CmmsTransferRejectReasonRequiredError extends DomainError {
  constructor(details: { transferId: string }) {
    super(
      "TRANSFER_REJECT_REASON_REQUIRED",
      `the rejection of transfer ${details.transferId} carries its reason (the verdict is never silent — 0107's stamp law) / الرفض لا يكون صامتًا — سبب الرفض مطلوب`,
      details,
    );
  }
}

// -- the signed tags + the expiry sweep (W-19 — T-11/T-12, D-09/D-10) ──────

/**
 * THE SIGNATURE REFUSAL (D-09's own mitigation, verbatim: «an
 * unsigned/forged code refuses at the signature, never at a lookup»):
 * the pre-lookup gate's named rejection — a malformed or wrongly-signed
 * code NEVER touches the database (no oracle, no lookup, no log noise
 * that would distinguish exists-from-not).
 */
export class CmmsTagCodeInvalidError extends DomainError {
  constructor() {
    super(
      "TAG_CODE_INVALID",
      `the presented code is not a valid signed tag token (the shape or the signature refused — an unsigned/forged code never reaches a lookup; only platform-signed codes resolve) / الرمز المعروض ليس رمز بطاقة موقّعًا صالحًا — الرفض عند التوقيع لا عند البحث`,
    );
  }
}

/**
 * THE TYPED 404 (D-09: «a foreign tenant's scan is a typed 404 — never a
 * cross-tenant oracle»): a validly-signed code this tenant never
 * registered — invisible under RLS, indistinguishable from a
 * never-issued code. The scan and the register reads share the name.
 */
export class CmmsTagNotFoundError extends DomainError {
  constructor(details: { tagId?: string; code?: string }) {
    super(
      "TAG_NOT_FOUND",
      `no tag ${details.tagId !== undefined ? `with id ${details.tagId}` : `for the presented code`} exists in this tenant (a validly-signed code resolves only against this tenant's own register — RLS) / لا توجد بطاقة بهذا المعرف أو الرمز في هذا المستأجر`,
      details,
    );
  }
}

/**
 * THE SINGLE-CONSUMPTION SEAL'S NAMED REFUSAL (the printed stamp's CAS —
 * the 0105 completion-stamp precedent's tags sibling): a tag already
 * printed refuses the re-print BY NAME carrying the standing stamp — the
 * honest alternative is a NEW tag (a fresh code; the old label dies with
 * its row).
 */
export class CmmsTagAlreadyPrintedError extends DomainError {
  constructor(details: { tagId: string; printedAt: string }) {
    super(
      "TAG_ALREADY_PRINTED",
      `tag ${details.tagId} was already printed at ${details.printedAt} — the printed stamp is single-use (print a NEW tag instead: a fresh signed code; the old label's code dies with its row) / البطاقة مطبوعة بالفعل — الختم أحادي الاستخدام؛ اطبع بطاقة جديدة برمز موقّع جديد`,
      details,
    );
  }
}

/**
 * The sweep's thresholds write refusal (the settings registry's typed
 * validation surfaced under the sweep's own name): a malformed ladder
 * never lands — the registry schema (an array of 1…12 integers ≥ 0) is
 * the floor; the pure fold normalizes what lands (dedup, descending).
 */
export class CmmsSweepThresholdsInvalidError extends DomainError {
  constructor(details: { message: string }) {
    super(
      "SWEEP_THRESHOLDS_INVALID",
      `the expiry-sweep threshold ladder is invalid (${details.message} — an array of 1…12 integer day-values ≥ 0; the documented default is [30,7,0]) / سلما عتبات الكنس غير صالحة — مصفوفة من قيم أيام صحيحة موجبة`,
      details,
    );
  }
}
