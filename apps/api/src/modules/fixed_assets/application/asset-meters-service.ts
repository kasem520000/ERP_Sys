import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/cmms.store";
import {
  CmmsInputInvalidError,
  CmmsMeterNotFoundError,
  CmmsMeterRegressionError,
  CmmsOdometerAlreadyDesignatedError,
  CmmsOdometerNotKmError,
  CmmsReadingJobLinkError,
  CmmsReadingWorkOrderNotFoundError,
} from "../domain/cmms-errors";
import type { PlanEvaluationResult } from "./maintenance-plan-service";
import { MaintenancePlanService } from "./maintenance-plan-service";

/**
 * PHASE-049 (W-18 — T-08) THE METERS API: the register (D-07 —
 * HOURS/KM/PRODUCTION/CUSTOM with R-10's odometer designation) and the
 * READINGS LOG — the owner's W-18 order: «كتابة R-10 بالإسناد الواحد
 * ودلتا المرساة ورفض مُنمّط ولا تسليح للنوافذ المولَّدة»:
 *
 *   R-10's WRITE PATH (the typed translations of 0106's floors — the
 *   owner's W-17 reading declared these arms W-18's): the odometer
 *   designation is the KM-type meter's (ODOMETER_NOT_KM — never a
 *   hours/production/custom odometer) and ONE per asset
 *   (ODOMETER_ALREADY_DESIGNATED carrying the standing one — the partial
 *   unique's typed first line). «الإسناد الواحد» — the single
 *   designation.
 *
 *   THE MONOTONIC LAW (D-07 — the 0106 header's own W-18 assignment): a
 *   reading below the meter's current snapshot refuses BY NAME carrying
 *   BOTH values (METER_REGRESSION); a back-dated-but-HIGHER reading is
 *   LEGAL and moves the snapshot (D-07's effective-date semantics — the
 *   snapshot recomputes to the max, one guarded UPDATE in the reading's
 *   own transaction). The DB floor keeps value ≥ 0.
 *
 *   THE JOB-LINK XOR (0106's ck_asset_meter_readings_job_link made
 *   typed): the JOB source and the work-order link exist together or not
 *   at all; the linked order is a COMPLETED one (the declared reading of
 *   0106's «JOB readings arrive from completed work orders — the
 *   technician's entry»: the completion-time entry is the JOB source; a
 *   mid-job reading is the MANUAL source).
 *
 *   THE EVENT-DRIVEN EVALUATION («دلتا المرساة» + «لا تسليح للنوافذ
 *   المولَّدة»): the reading's OWN transaction evaluates the ACTIVE
 *   METER plans bound to the meter (the plan service's fold-driven
 *   evaluate — meterDue reads the anchor DELTA, the pure fold; the
 *   generation decision applies BR-097's named skips). A READING NEVER
 *   ARMS A GENERATED WINDOW: the anchor moves ONLY at the generation act
 *   (the plan service's own law — the generation's own reading stamp);
 *   this service never touches an anchor, a next_due, or a window — it
 *   only reports each plan's verdict (the named skips surfaced, never
 *   truncated). A raced window-open during the walk propagates (the
 *   aborted-transaction law: no catch-and-continue inside the reading's
 *   transaction — the W-17 plans-spec honest catch #2's own lesson); the
 *   reading retries and the fold then skips BY NAME.
 *
 * The meter starts at position ZERO (the declared interpretation: the
 * usage truth lives in the log — the snapshot never claims a position
 * the log does not carry; a meter installed mid-life takes its first
 * reading at its current position).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const METER_TYPES = ["HOURS", "KM", "PRODUCTION", "CUSTOM"] as const;
const SOURCES = ["MANUAL", "JOB", "IMPORT"] as const;

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new CmmsInputInvalidError(`${what} must be a UUID: ${value}`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

@Injectable()
export class AssetMetersService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MaintenancePlanService) private readonly plans: MaintenancePlanService,
  ) {}

  // -- the register (D-07 — R-10's write path) -----------------------------------

  async createMeter(input: {
    assetId: string;
    name: string;
    nameAr?: string | null;
    type: (typeof METER_TYPES)[number];
    unit: string;
    isOdometer?: boolean;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.MeterRow> {
    requireUuid(input.assetId, "assetId");
    if (input.name.trim().length === 0 || input.name.length > 200) {
      throw new CmmsInputInvalidError("name is required (1…200 chars)");
    }
    if (!(METER_TYPES as readonly string[]).includes(input.type)) {
      throw new CmmsInputInvalidError(`type must be one of ${METER_TYPES.join("/")}: ${input.type}`);
    }
    if (input.unit.trim().length === 0 || input.unit.length > 16) {
      throw new CmmsInputInvalidError("unit is required (1…16 chars — the 0106 floor)");
    }
    const asset = await store.findAssetStatus(input.assetId);
    if (asset === undefined) {
      throw new CmmsInputInvalidError(`asset ${input.assetId} does not exist in this tenant`);
    }
    // R-10's KM-only odometer law — the typed first line (the 0106 CHECK
    // is the floor).
    if (input.isOdometer === true && input.type !== "KM") {
      throw new CmmsOdometerNotKmError({
        type: input.type,
        action: "authoring the meter",
      });
    }
    // R-10's ONE-per-asset designation — the typed first line (the 0106
    // partial unique is the raced floor).
    if (input.isOdometer === true) {
      const standing = await store.findOdometerDesignation(input.assetId, null);
      if (standing !== undefined) {
        throw new CmmsOdometerAlreadyDesignatedError({
          assetId: input.assetId,
          existingMeterId: standing.id,
          existingMeterName: standing.name,
          action: "authoring a second odometer",
        });
      }
    }
    const meter = await store.insertMeter({
      assetId: input.assetId,
      name: input.name,
      nameAr: input.nameAr ?? null,
      type: input.type,
      unit: input.unit,
      isOdometer: input.isOdometer === true,
      lastValue: "0",
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "assets.asset_meter_created",
      entityType: "asset_meter",
      entityId: meter.id,
      actorId: input.actorId ?? undefined,
      after: {
        assetId: meter.assetId,
        type: meter.type,
        unit: meter.unit,
        isOdometer: meter.isOdometer,
      },
    });
    return meter;
  }

  async getMeter(meterId: string): Promise<store.MeterRow> {
    requireUuid(meterId, "meterId");
    const meter = await store.findMeterById(meterId);
    if (meter === undefined) throw new CmmsMeterNotFoundError({ meterId });
    return meter;
  }

  async listMeters(filter: { assetId?: string }): Promise<store.MeterRow[]> {
    if (filter.assetId !== undefined) requireUuid(filter.assetId, "assetId");
    return store.listMeters(filter);
  }

  /** The descriptive patch + the odometer designation's own write path
   * (R-10's arms — the type is the meter's identity and never changes;
   * the readings log is append-only by design). */
  async patchMeter(input: {
    meterId: string;
    name?: string;
    nameAr?: string | null;
    unit?: string;
    isOdometer?: boolean;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.MeterRow> {
    const meter = await this.getMeter(input.meterId);
    if (input.name !== undefined && (input.name.trim().length === 0 || input.name.length > 200)) {
      throw new CmmsInputInvalidError("name must be 1…200 chars");
    }
    if (input.unit !== undefined && (input.unit.trim().length === 0 || input.unit.length > 16)) {
      throw new CmmsInputInvalidError("unit must be 1…16 chars");
    }
    if (input.isOdometer === true) {
      if (meter.type !== "KM") {
        throw new CmmsOdometerNotKmError({
          meterId: meter.id,
          type: meter.type,
          action: "designating the odometer",
        });
      }
      if (!meter.isOdometer) {
        const standing = await store.findOdometerDesignation(meter.assetId, meter.id);
        if (standing !== undefined) {
          throw new CmmsOdometerAlreadyDesignatedError({
            assetId: meter.assetId,
            existingMeterId: standing.id,
            existingMeterName: standing.name,
            action: "designating a second odometer",
          });
        }
      }
    }
    const patched = await store.patchMeter({
      meterId: meter.id,
      name: input.name,
      nameAr: input.nameAr ?? undefined,
      unit: input.unit,
      isOdometer: input.isOdometer,
      note: input.note ?? undefined,
      noteAr: input.noteAr ?? undefined,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "assets.asset_meter_patched",
      entityType: "asset_meter",
      entityId: meter.id,
      actorId: input.actorId ?? undefined,
      before: { isOdometer: meter.isOdometer, unit: meter.unit },
      after: { isOdometer: patched?.isOdometer, unit: patched?.unit },
    });
    return patched ?? meter;
  }

  // -- the readings log (D-07 — the monotonic law + the event wiring) -----------

  /**
   * Record a reading — THE EVENT (the reading's own transaction):
   * (1) the typed floors (the JOB-link XOR + the linked order COMPLETED;
   * the monotonic law with both values); (2) the log insert + the
   * snapshot advance (recomputed to the max); (3) the ACTIVE METER plans
   * bound to this meter evaluated by the plan service's own folds (the
   * anchor delta; the named skips; NO ARMING — this service never moves
   * an anchor or a window). The report carries every plan's verdict.
   */
  async recordReading(input: {
    meterId: string;
    value: string;
    effectiveDate: string;
    source?: (typeof SOURCES)[number];
    workOrderId?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<{
    reading: store.ReadingRow;
    meter: store.MeterRow;
    evaluations: PlanEvaluationResult[];
  }> {
    requireUuid(input.meterId, "meterId");
    if (!QTY_RE.test(input.value)) {
      throw new CmmsInputInvalidError(`value must be a non-negative decimal (≤ 6dp): ${input.value}`);
    }
    if (!DATE_RE.test(input.effectiveDate)) {
      throw new CmmsInputInvalidError(`effectiveDate must be an ISO date (yyyy-mm-dd): ${input.effectiveDate}`);
    }
    const source = input.source ?? "MANUAL";
    if (!(SOURCES as readonly string[]).includes(source)) {
      throw new CmmsInputInvalidError(`source must be one of ${SOURCES.join("/")}: ${source}`);
    }
    const meter = await store.findMeterById(input.meterId);
    if (meter === undefined) {
      throw new CmmsMeterNotFoundError({ meterId: input.meterId });
    }

    // The JOB-link XOR (the typed first line; 0106's CHECK is the floor)
    // + the COMPLETED interpretation (the completion-time entry).
    let workOrderId: string | null = null;
    if (source === "JOB") {
      if (input.workOrderId == null) {
        throw new CmmsReadingJobLinkError({
          message:
            "a JOB reading carries its work-order link (the link exists exactly when the source is JOB — the 0106 XOR gate) / قراءة الوظيفة تحمل رابط أمر العمل — بوابة XOR",
        });
      }
      requireUuid(input.workOrderId, "workOrderId");
      workOrderId = input.workOrderId;
      const order = await store.findWorkOrderById(workOrderId);
      if (order === undefined) {
        throw new CmmsReadingWorkOrderNotFoundError({ workOrderId });
      }
      if (order.status !== "COMPLETED") {
        throw new CmmsReadingJobLinkError({
          message: `work order ${workOrderId} is ${order.status} — a JOB reading arrives from a COMPLETED work order (the technician's completion-time entry; a mid-job reading is the MANUAL source) / قراءة الوظيفة تأتي من أمر مكتمل — قراءة أثناء التنفيذ مصدرها يدوي`,
          workOrderStatus: order.status,
        });
      }
    } else if (input.workOrderId != null) {
      throw new CmmsReadingJobLinkError({
        message:
          `a ${source} reading never carries a work-order link (the link exists exactly when the source is JOB — the 0106 XOR gate's other side) / لا رابط أمر عمل إلا لقراءة الوظيفة`,
      });
    }

    // The monotonic law — both values named (a back-dated-but-HIGHER
    // reading is legal and moves the snapshot).
    if (new Decimal(input.value).lessThan(new Decimal(meter.lastValue))) {
      throw new CmmsMeterRegressionError({
        meterId: meter.id,
        snapshotValue: meter.lastValue,
        readingValue: input.value,
      });
    }

    const reading = await store.insertReading({
      meterId: meter.id,
      value: input.value,
      effectiveDate: input.effectiveDate,
      source,
      workOrderId,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await store.advanceMeterSnapshot({
      meterId: meter.id,
      value: input.value,
      at: nowIso(),
      actorId: input.actorId,
    });

    // THE EVENT-DRIVEN EVALUATION (the reading's own transaction): the
    // ACTIVE METER plans bound to this meter, each evaluated by the plan
    // service's folds (the anchor delta; BR-097's named skips). NO
    // ARMING: only a GENERATION moves an anchor — a reading never does.
    const bound = await store.activePlansByMeter(meter.id);
    const evaluations: PlanEvaluationResult[] = [];
    for (const plan of bound) {
      evaluations.push(
        await this.plans.evaluate({ planId: plan.id, actorId: input.actorId }),
      );
    }

    await this.audit.record({
      action: "assets.asset_meter_reading_recorded",
      entityType: "asset_meter_reading",
      entityId: reading.id,
      actorId: input.actorId ?? undefined,
      after: {
        meterId: meter.id,
        value: reading.value,
        effectiveDate: reading.effectiveDate,
        source: reading.source,
        evaluations: evaluations.map((verdict) => ({
          planId: verdict.planId,
          generated: verdict.generated,
          skipReason: verdict.skipReason ?? null,
        })),
      },
    });

    const advanced = await store.findMeterById(meter.id);
    return { reading, meter: advanced ?? meter, evaluations };
  }

  async listReadings(meterId: string): Promise<store.ReadingRow[]> {
    await this.getMeter(meterId);
    return store.listReadings(meterId);
  }
}
