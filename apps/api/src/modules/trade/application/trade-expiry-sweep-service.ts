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
import * as store from "../infrastructure/trade.store";
import {
  lcDiscrepancyDedupeKey,
  lcExpiryDedupeKey,
  lcSweepBands,
  lcSweepSeverity,
  normalizeLcSweepWindows,
} from "../domain/lc-sweep-math";
import { LcSweepThresholdsInvalidError } from "../domain/trade-errors";

/**
 * PHASE-051 (W-34 — T-06, 2026-11-25) THE TRADE-EXPIRY SWEEP + ITS
 * SETTINGS SURFACE (D-09 — BR-105's own engine, the 0111/calibration
 * pattern verbatim, the SIXTH standing isolate):
 *
 *   THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة
 *   — لا Date.now()+دلتا أبدًا»): every date derives from the DATABASE'S
 *   OWN CURRENT_DATE inside the probes' SQL (the derived step —
 *   `expiry_date <= CURRENT_DATE + toDays`); NO Date.now()+delta anywhere
 *   in the sweep's path — the pure folds carry day-values only, the wall
 *   clock never enters JS. THE EXPIRY TRANSITION rides the same law: the
 *   DB's own `expiry_date < CURRENT_DATE` decides, CAS-stamped per LC
 *   (idempotent — a re-run finds no ISSUED row and zero rows means
 *   nothing).
 *
 *   THE DECLARED INTERPRETATION (recorded at the claim site): the sweep
 *   owns the ladder's TERMINUS — the ISSUED → EXPIRED transition is
 *   time's own act, derived from the database's clock exactly as the
 *   alerts are; the alerts (the notification families) and the
 *   transition (the register's own rung) are the same law's two faces.
 *   The transition is NOT "pre-created state" — it is the status
 *   ladder's own expiry arm (the 0119 vocabulary's EXPIRED rung),
 *   CAS-stamped and audited per LC (`trade.lc_expired`), convergent by
 *   construction.
 *
 *   NO ARMING, NO DOUBLE LAUNCH: the sweep never pre-creates
 *   notification state; the dedupe is STRUCTURAL
 *   (uq_notifications_dedupe on (tenant_id, dedupe_key) — D-09's own
 *   axes `trade:lc:{lcId}:{threshold}:{expiryDate}`), so re-runs, the
 *   nightly cron, and a raced concurrent pass all CONVERGE within a
 *   cycle — nothing accumulates, nothing fires twice; the per-cycle day
 *   axis (the EXPIRY DATE the alert names) lets an amended instrument
 *   alert again in its NEXT cycle (the new expiry date forms new keys).
 *   THE DISCREPANCY FAMILY rides the same axes with its own marker
 *   (`trade:lc:{lcId}:disc:{threshold}:{expiryDate}`) — the open
 *   discrepancies (unverified checklist documents carrying notes) name
 *   the same instrument, band and day; the two families converge
 *   independently.
 *
 *   THE SEALS AFTER SUCCESS (الأختام بعد النجاح في المعاملة نفسها): the
 *   run's audit record — `trade.lc_expiry_sweep_run` carrying
 *   {windows, flagged, notified, expired} — lands ONLY after the whole
 *   per-tenant pass succeeded, in the SAME ambient transaction (the
 *   audit plane IS the job log — the acceptance's evidence; stamped
 *   even when nothing flagged: the run happened).
 *
 *   THE SETTINGS SURFACE (the trade module's own settings keys — the
 *   FIRST 051 trade key, `trade.lc_expiry_sweep_thresholds`): the
 *   thresholds read stored ∪ registry default through the platform's
 *   effective-setting reader, then the pure fold normalizes
 *   (fail-closed to the documented [30,14,7,1] — BR-105's own ladder);
 *   the typed write validates through the SAME registry schema the
 *   generic surface uses (parseSettingValue — the zod refusal
 *   re-surfaced under the wave's own name) and lands in the SAME
 *   tenant_settings row with the SAME invalidation event
 *   (publishTenancyEvent) — one data home, one validation, one event,
 *   two typed surfaces. ZERO parallel accounting.
 */

const SETTING_KEY = "trade.lc_expiry_sweep_thresholds";
/** The per-band probe bound (bounded jobs — the cmms precedent's 500). */
const PROBE_BOUND = 500;

export interface LcExpirySweepOutcome {
  windows: number[];
  flagged: number;
  notified: number;
  expired: number;
}

@Injectable()
export class TradeExpirySweepService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /**
   * ONE per-tenant pass (the ambient tenant's own transaction — the job
   * wraps this in withTenant; the spec drives it the same way):
   * (1) THE EXPIRY TRANSITION — the DB's own clock decides, each
   * CAS-stamped and audited; (2) the ladder's disjoint bands × the live
   * instruments, each hit recorded through the deduped inbox (the owner
   * target + the 'trade' prefs gate — absent prefs mean in-app on),
   * with the discrepancy family riding the same band when the
   * instrument carries open discrepancies; (3) THE SEAL.
   */
  async runSweep(input?: { probeBound?: number }): Promise<LcExpirySweepOutcome> {
    const bound = Math.min(Math.max(input?.probeBound ?? PROBE_BOUND, 1), 5_000);
    const stored = await readEffectiveSetting<readonly unknown[]>(SETTING_KEY);
    const windows = normalizeLcSweepWindows(Array.isArray(stored) ? stored : []);
    const bands = lcSweepBands(windows);

    // (1) THE EXPIRY TRANSITION (the DB's own clock — the ladder's own
    // terminus; idempotent CAS, audited per LC; zero JS time anywhere).
    let expired = 0;
    for (const row of await store.scanExpiredLcs(bound)) {
      const stamped = await store.stampLcExpired(row.id);
      if (stamped !== undefined) {
        expired += 1;
        await this.audit.record({
          action: "trade.lc_expired",
          entityType: "letters_of_credit",
          entityId: row.id,
          before: { status: "ISSUED", expiryDate: row.expiryDate },
          after: { status: stamped.status, expiryDate: stamped.expiryDate },
        });
      }
    }

    // The owner target + prefs gate, ONCE per pass (the calibration
    // precedent's shape: absent prefs rows mean in-app on; an owner with
    // in-app off skips the records but the flags still count and the
    // run still seals).
    const target = await this.inbox.ownerTarget();
    const prefs = target === null ? null : await this.inbox.prefsFor(target.userId, "trade");
    const deliverable = target !== null && prefs !== null && prefs.inApp;

    let flagged = 0;
    let notified = 0;
    for (const band of bands) {
      for (const lc of await store.scanLcExpiry({
        band: { threshold: band.threshold, fromDays: band.fromDays, toDays: band.toDays },
        limit: bound,
      })) {
        flagged += 1;
        if (deliverable) {
          const recorded = await this.inbox.record({
            category: "trade",
            severity: lcSweepSeverity(band.threshold),
            title: {
              en: `LC expiry — ${lc.lcNo ?? lc.lcId}`,
              ar: `استحقاق اعتماد — ${lc.lcNo ?? lc.lcId}`,
            },
            body: {
              en: `Letter of credit ${lc.lcNo} (${lc.beneficiaryName}, ${lc.currency} ${lc.amount}) expires on ${lc.expiryDate} — ${band.threshold} day(s) at the current band. Review the LC register.`,
              ar: `الاعتماد المستندي ${lc.lcNo} (${lc.beneficiaryName}، ${lc.currency} ${lc.amount}) يستحق في ${lc.expiryDate} — قبل ${band.threshold} يومًا في النطاق الحالي. راجع سجل الاعتمادات.`,
            },
            actionLabel: { ar: "مراجعة السجل", en: "Review register" },
            actionUrl: "/trade/lc",
            dedupeKey: lcExpiryDedupeKey({
              lcId: lc.lcId,
              threshold: band.threshold,
              expiryDate: lc.expiryDate,
            }),
            userId: target.userId,
          });
          if (recorded.inserted) notified += 1;
          // THE DISCREPANCY FAMILY (BR-105's second arm): the open
          // discrepancies ride the same band — the unverified checklist
          // documents carrying notes, one alert naming the count.
          if (lc.openDiscrepancies > 0) {
            const discrepancyRecorded = await this.inbox.record({
              category: "trade",
              severity: "warning",
              title: {
                en: `LC document discrepancies — ${lc.lcNo ?? lc.lcId}`,
                ar: `أوجه خلاف في مستندات الاعتماد — ${lc.lcNo ?? lc.lcId}`,
              },
              body: {
                en: `Letter of credit ${lc.lcNo} expires on ${lc.expiryDate} and carries ${lc.openDiscrepancies} open document discrepancy(s) — unverified checklist documents with discrepancy notes. Review the documents checklist before the expiry.`,
                ar: `الاعتماد المستندي ${lc.lcNo} يستحق في ${lc.expiryDate} ويرفق به ${lc.openDiscrepancies} خلاف مستندي مفتوح — مستندات غير مُتحقَّق منها تحمل ملاحظات الخلاف. راجع قائمة المستندات قبل الاستحقاق.`,
              },
              actionLabel: { ar: "مراجعة المستندات", en: "Review checklist" },
              actionUrl: "/trade/lc",
              dedupeKey: lcDiscrepancyDedupeKey({
                lcId: lc.lcId,
                threshold: band.threshold,
                expiryDate: lc.expiryDate,
              }),
              userId: target.userId,
            });
            if (discrepancyRecorded.inserted) notified += 1;
          }
        }
      }
    }

    // (3) THE SEAL — after the whole pass succeeded, in the SAME ambient
    // transaction (a failure rolls everything back together).
    await this.audit.record({
      action: "trade.lc_expiry_sweep_run",
      entityType: "trade_lc_expiry_sweep",
      entityId: requireTenantContext().tenantId,
      after: { windows, flagged, notified, expired },
    });
    return { windows, flagged, notified, expired };
  }

  // -- the settings surface (the trade module's own settings keys) --------

  /** The effective ladder: stored ∪ registry default, normalized by the
   * pure fold (fail-closed to [30,14,7,1]) + the last run's seal. */
  async effectiveConfig(): Promise<{
    key: string;
    thresholds: number[];
    default: number[];
    stored: boolean;
    lastRun: {
      at: string;
      outcome: { windows: number[]; flagged: number; notified: number; expired: number };
    } | null;
  }> {
    const row = await store.findLcSweepSetting();
    const stored = Array.isArray(row?.value) ? (row?.value as readonly unknown[]) : [];
    return {
      key: SETTING_KEY,
      thresholds: normalizeLcSweepWindows(stored),
      default: [30, 14, 7, 1],
      stored: row !== undefined,
      lastRun: (await store.lastLcSweepRun()) ?? null,
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
        throw new LcSweepThresholdsInvalidError({
          message: error instanceof InvalidSettingValueError ? error.message : "schema validation failed",
        });
      }
      throw error;
    }
    const normalized = normalizeLcSweepWindows(parsed as readonly unknown[]);
    const before = await store.findLcSweepSetting();
    await store.upsertLcSweepSetting({ value: normalized, actorId: input.actorId });
    await this.audit.record({
      action: "trade.lc_expiry_sweep_configured",
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
