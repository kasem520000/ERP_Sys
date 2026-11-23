import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  InvalidSettingValueError,
  parseSettingValue,
  publishTenancyEvent,
} from "../../configuration/api";
import { InboxService } from "../../notifications/application/inbox-service";
import * as store from "../infrastructure/quality.store";
import {
  calibrationDedupeKey,
  calibrationSweepBands,
  calibrationSweepSeverity,
  normalizeCalibrationSweepWindows,
} from "../domain/calibration-sweep-math";
import { CalibrationSweepThresholdsInvalidError } from "../domain/quality-errors";

/**
 * PHASE-050 (W-26 — T-08, 2026-11-23) THE QUALITY-CALIBRATION SWEEP + ITS
 * SETTINGS SURFACE (D-08 — the 049 handoff verbatim: the expiry-sweep
 * pattern extends to calibration due dates; the AssetExpirySweepService
 * shape, the 0111 precedent's own settings keys):
 *
 *   THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة
 *   — لا Date.now()+دلتا أبدًا»): every date derives from the DATABASE'S
 *   OWN CURRENT_DATE inside the probe's SQL (the derived step —
 *   `due_date <= CURRENT_DATE + toDays`); NO Date.now()+delta anywhere in
 *   the sweep's path — the pure folds carry day-values only, the wall
 *   clock never enters JS.
 *
 *   NO ARMING, NO DOUBLE LAUNCH: the sweep never pre-creates state; the
 *   dedupe is STRUCTURAL (uq_notifications_dedupe on (tenant_id,
 *   dedupe_key) — D-08's own axes `quality:calibration:{assetId}:
 *   {threshold}:{dueDate}`), so re-runs, the nightly cron, and a raced
 *   concurrent pass all CONVERGE within a cycle — nothing accumulates,
 *   nothing fires twice; the per-cycle day axis (the DUE DATE the alert
 *   names) lets a re-calibrated instrument alert again in its NEXT
 *   cycle (the cmms once-ever shape would go silent after one cycle
 *   exactly where a calibration program lives on cycles — the declared
 *   W-26 interpretation).
 *
 *   THE SEALS AFTER SUCCESS (الأختام بعد النجاح في المعاملة نفسها): the
 *   run's audit record — `quality.calibration_sweep_run` carrying
 *   {windows, flagged, notified} — lands ONLY after the whole per-tenant
 *   pass succeeded, in the SAME ambient transaction (the audit plane IS
 *   the job log — acceptance #8's evidence; stamped even when nothing
 *   flagged: the run happened).
 *
 *   THE SETTINGS SURFACE (the FIRST 050 settings keys,
 *   `quality.calibration_sweep_thresholds`): the thresholds read stored
 *   ∪ registry default through the platform's effective-setting reader,
 *   then the pure fold normalizes (fail-closed to the documented
 *   [30,7,0]); the typed write validates through the SAME registry
 *   schema the generic surface uses (parseSettingValue — the zod refusal
 *   re-surfaced under the wave's own name) and lands in the SAME
 *   tenant_settings row with the SAME invalidation event
 *   (publishTenancyEvent) — one data home, one validation, one event,
 *   two typed surfaces. ZERO parallel accounting.
 */

const SETTING_KEY = "quality.calibration_sweep_thresholds";
/** The per-band probe bound (bounded jobs — the cmms precedent's 500). */
const PROBE_BOUND = 500;

export interface CalibrationSweepOutcome {
  windows: number[];
  flagged: number;
  notified: number;
}

@Injectable()
export class QualityCalibrationSweepService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /**
   * ONE per-tenant pass (the ambient tenant's own transaction — the job
   * wraps this in withTenant; the spec drives it the same way): the
   * disjoint bands × the instruments' LATEST due dates, each hit
   * recorded through the deduped inbox (the owner target + the prefs
   * gate — absent prefs mean in-app on), then THE SEAL. ACTIVE
   * instruments only (a disposed instrument alerts no recalibration —
   * the cmms status-guard spirit).
   */
  async runSweep(input?: { probeBound?: number }): Promise<CalibrationSweepOutcome> {
    const bound = Math.min(Math.max(input?.probeBound ?? PROBE_BOUND, 1), 5_000);
    const stored = await readEffectiveSetting<readonly unknown[]>(SETTING_KEY);
    const windows = normalizeCalibrationSweepWindows(Array.isArray(stored) ? stored : []);
    const bands = calibrationSweepBands(windows);
    let flagged = 0;
    let notified = 0;
    // The owner target + prefs gate, ONCE per pass (the cmms precedent's
    // shape: absent prefs rows mean in-app on; an owner with in-app off
    // skips the records but the flags still count and the run still
    // seals).
    const target = await this.inbox.ownerTarget();
    const prefs = target === null ? null : await this.inbox.prefsFor(target.userId, "quality");
    const deliverable = target !== null && prefs !== null && prefs.inApp;

    for (const band of bands) {
      for (const instrument of await store.scanCalibrationDue({
        band: { threshold: band.threshold, fromDays: band.fromDays, toDays: band.toDays },
        limit: bound,
      })) {
        flagged += 1;
        if (!deliverable) continue;
        const recorded = await this.inbox.record({
          category: "quality",
          severity: calibrationSweepSeverity(band.threshold),
          title: {
            en: `Calibration due — ${instrument.code}`,
            ar: `استحقاق معايرة — ${instrument.code}`,
          },
          body: {
            en: `Instrument ${instrument.code} (${instrument.name}) is due for calibration on ${instrument.dueDate} — ${band.threshold} day(s) at the current band. Review the instrument's calibration register.`,
            ar: `الجهاز ${instrument.code} (${instrument.nameAr ?? instrument.name}) مستحق للمعايرة في ${instrument.dueDate} — قبل ${band.threshold} يومًا في النطاق الحالي. راجع سجل معايرة الجهاز.`,
          },
          actionLabel: { ar: "مراجعة السجل", en: "Review register" },
          actionUrl: "/quality/calibration",
          dedupeKey: calibrationDedupeKey({
            assetId: instrument.assetId,
            threshold: band.threshold,
            dueDate: instrument.dueDate,
          }),
          userId: target.userId,
        });
        if (recorded.inserted) notified += 1;
      }
    }

    // THE SEAL — after the whole pass succeeded, in the SAME ambient
    // transaction (a failure rolls everything back together).
    await this.audit.record({
      action: "quality.calibration_sweep_run",
      entityType: "quality_calibration_sweep",
      entityId: requireTenantContext().tenantId,
      after: { windows, flagged, notified },
    });
    return { windows, flagged, notified };
  }

  // -- the settings surface (the first 050 settings keys) ---------------------

  /** The effective ladder: stored ∪ registry default, normalized by the
   * pure fold (fail-closed to [30,7,0]) + the last run's seal. */
  async effectiveConfig(): Promise<{
    key: string;
    thresholds: number[];
    default: number[];
    stored: boolean;
    lastRun: {
      at: string;
      outcome: { windows: number[]; flagged: number; notified: number };
    } | null;
  }> {
    const row = await store.findCalibrationSweepSetting();
    const stored = Array.isArray(row?.value) ? (row?.value as readonly unknown[]) : [];
    return {
      key: SETTING_KEY,
      thresholds: normalizeCalibrationSweepWindows(stored),
      default: [30, 7, 0],
      stored: row !== undefined,
      lastRun: (await store.lastCalibrationSweepRun()) ?? null,
    };
  }

  /** The audited thresholds write — the SAME registry validation, the
   * SAME tenant_settings row, the SAME invalidation event as the generic
   * settings surface (one data home; the zod refusal re-surfaced under
   * the wave's own name). */
  async writeThresholds(input: {
    thresholds: readonly unknown[];
    actorId: string | null;
  }): Promise<{ thresholds: number[] }> {
    let parsed: unknown;
    try {
      parsed = parseSettingValue(SETTING_KEY, input.thresholds);
    } catch (error) {
      if (error instanceof InvalidSettingValueError || error instanceof Error) {
        throw new CalibrationSweepThresholdsInvalidError({
          message: error instanceof InvalidSettingValueError ? error.message : "schema validation failed",
        });
      }
      throw error;
    }
    const normalized = normalizeCalibrationSweepWindows(parsed as readonly unknown[]);
    const before = await store.findCalibrationSweepSetting();
    await store.upsertCalibrationSweepSetting({ value: normalized, actorId: input.actorId });
    await this.audit.record({
      action: "quality.calibration_sweep_configured",
      entityType: "tenant_setting",
      entityId: requireTenantContext().tenantId,
      actorId: input.actorId ?? undefined,
      before: before === undefined ? undefined : { thresholds: before.value },
      after: { thresholds: normalized },
    });
    publishTenancyEvent({
      type: "settings.changed",
      tenantId: requireTenantContext().tenantId,
      key: SETTING_KEY,
    });
    return { thresholds: normalized };
  }
}
