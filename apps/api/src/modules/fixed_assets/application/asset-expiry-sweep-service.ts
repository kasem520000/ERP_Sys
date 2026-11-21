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
import * as store from "../infrastructure/cmms.store";
import {
  ASSET_EXPIRY_CLASSES,
  type AssetExpiryClass,
  assetExpiryDedupeKey,
  normalizeSweepWindows,
  sweepBands,
  sweepSeverity,
} from "../domain/cmms-sweep-math";
import { CmmsInputInvalidError, CmmsSweepThresholdsInvalidError } from "../domain/cmms-errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PHASE-049 (W-19 — T-12) THE ASSET-EXPIRY SWEEP + ITS SETTINGS SURFACE +
 * THE FLEET-LIGHT REGISTER (D-10/R-10 — the owner's W-19 order: «الكنس
 * أعلى خطر زمني: عزل مسبق، ساعة مثبتة أو خطوة مشتقة (لا Date.now()+دلتا
 * أبدًا)، لا تسليح ولا إطلاق مزدوج، والأختام بعد النجاح في المعاملة
 * نفسها»):
 *
 *   THE CLOCK LAW (ساعة مثبتة أو خطوة مشتقة): the sweep's every date
 *   derives from the DATABASE'S OWN CURRENT_DATE inside the probes' SQL
 *   (the derived step — `expiry <= CURRENT_DATE + toDays`); NO
 *   Date.now()+delta anywhere in the sweep's path — the pure folds carry
 *   day-values only, the wall clock never enters JS.
 *
 *   NO ARMING, NO DOUBLE LAUNCH (لا تسليح ولا إطلاق مزدوج): the sweep
 *   never pre-creates state — no pending rows, no per-asset last-notified
 *   column; the dedupe is STRUCTURAL (uq_notifications_dedupe on
 *   (tenant_id, dedupe_key), the key `assets:{class}:{assetId}:
 *   {threshold}`), so re-runs, the nightly cron, and a raced concurrent
 *   pass all CONVERGE — nothing accumulates, nothing fires twice. The
 *   job registers once (the module's onModuleInit; pg-boss's named
 *   schedule is idempotent).
 *
 *   THE SEALS AFTER SUCCESS (الأختام بعد النجاح في المعاملة نفسها): the
 *   run's audit record — `assets.expiry_sweep_run` carrying
 *   {windows, flagged, notified, perClass} — lands ONLY after the whole
 *   per-tenant pass succeeded, in the SAME ambient transaction (a failure
 *   anywhere rolls the notifications and the seal back together; the
 *   audit plane IS the job log — acceptance #8's evidence — no parallel
 *   stats row).
 *
 *   THE SETTINGS SURFACE (the first 049 settings keys): the thresholds
 *   read stored ∪ registry default through the platform's effective-
 *   setting reader, then the pure fold normalizes (fail-closed to the
 *   documented [30,7,0]); the typed write validates through the SAME
 *   registry schema the generic surface uses (parseSettingValue — the
 *   zod refusal re-surfaced under the wave's own name) and lands in the
 *   SAME tenant_settings row with the SAME invalidation event
 *   (publishTenancyEvent — the cache-priming bus) — one data home, one
 *   validation, one event, two typed surfaces. ZERO parallel accounting.
 *
 *   THE FLEET-LIGHT REGISTER (R-10 — the owner's CR-50 light-only
 *   decision): the read model over the substrate — every ACTIVE asset
 *   with its four expiry chips (days-to-expiry derived in SQL from
 *   CURRENT_DATE) + the odometer binding; the vehicle-class grouping is
 *   the caller's category filter (categories are tenant data). Full
 *   fuel/violations management stays the recorded sectoral non-goal.
 */

const SETTING_KEY = "assets.expiry_sweep_thresholds";
/** The per-class probe bound (bounded jobs — the hr precedent's 500). */
const PROBE_BOUND = 500;
/** The fleet register's read bound. */
const FLEET_BOUND = 1_000;

const CLASS_LABELS: Record<AssetExpiryClass, { en: string; ar: string }> = Object.freeze({
  warranty: { en: "Warranty", ar: "الضمان" },
  insurance: { en: "Insurance", ar: "التأمين" },
  license: { en: "License", ar: "الترخيص" },
  inspection: { en: "Inspection", ar: "الفحص" },
});

export interface SweepRunOutcome {
  windows: number[];
  flagged: number;
  notified: number;
  perClass: Record<AssetExpiryClass, number>;
}

@Injectable()
export class AssetExpirySweepService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  // -- the sweep (D-10 — the four classes, the disjoint bands) --------------

  /**
   * ONE per-tenant pass (the ambient tenant's own transaction — the job
   * wraps this in withTenant; the spec drives it the same way): the four
   * classes × the disjoint bands, each hit recorded through the deduped
   * inbox (the owner target + the prefs gate — absent prefs mean in-app
   * on), then THE SEAL. ACTIVE assets only (a departed asset alerts no
   * renewal — D-01's spirit).
   */
  async runSweep(input?: { probeBound?: number }): Promise<SweepRunOutcome> {
    const bound = Math.min(Math.max(input?.probeBound ?? PROBE_BOUND, 1), 5_000);
    const stored = await readEffectiveSetting<readonly unknown[]>(SETTING_KEY);
    const windows = normalizeSweepWindows(Array.isArray(stored) ? stored : []);
    const bands = sweepBands(windows);
    const perClass: Record<AssetExpiryClass, number> = {
      warranty: 0,
      insurance: 0,
      license: 0,
      inspection: 0,
    };
    let flagged = 0;
    let notified = 0;
    // The owner target + prefs gate, ONCE per pass (the hr precedent's
    // shape: absent prefs rows mean in-app on; an owner with in-app off
    // skips the records but the flags still count and the run still seals).
    const target = await this.inbox.ownerTarget();
    const prefs = target === null ? null : await this.inbox.prefsFor(target.userId, "assets");
    const deliverable = target !== null && prefs !== null && prefs.inApp;

    for (const assetExpiryClass of ASSET_EXPIRY_CLASSES) {
      const label = CLASS_LABELS[assetExpiryClass];
      for (const band of bands) {
        for (const asset of await store.scanExpiringAssets({
          assetExpiryClass,
          band,
          limit: bound,
        })) {
          flagged += 1;
          perClass[assetExpiryClass] += 1;
          if (!deliverable) continue;
          const recorded = await this.inbox.record({
            category: "assets",
            severity: sweepSeverity(band.threshold),
            title: {
              en: `${label.en} expiry — ${asset.code}`,
              ar: `انتهاء ${label.ar} — ${asset.code}`,
            },
            body: {
              en: `The ${label.en.toLowerCase()} of asset ${asset.code} (${asset.name}) expires on ${asset.expiry} — ${band.threshold} day(s) ahead. Review the asset's expiry registers.`,
              ar: `ينتهي ${label.ar} للأصل ${asset.code} (${asset.nameAr ?? asset.name}) في ${asset.expiry} — قبل ${band.threshold} يومًا. راجع سجلات انتهاء الصلاحية للأصل.`,
            },
            actionLabel: { ar: "مراجعة السجلات", en: "Review registers" },
            actionUrl: "/assets/maintenance",
            dedupeKey: assetExpiryDedupeKey({
              assetExpiryClass,
              assetId: asset.id,
              threshold: band.threshold,
            }),
            userId: target.userId,
          });
          if (recorded.inserted) notified += 1;
        }
      }
    }

    // THE SEAL — after the whole pass succeeded, in the SAME ambient
    // transaction (a failure rolls everything back together; the audit
    // plane is the job log — stamped even when nothing flagged: the run
    // happened).
    await this.audit.record({
      action: "assets.expiry_sweep_run",
      entityType: "asset_expiry_sweep",
      entityId: requireTenantContext().tenantId,
      after: { windows, flagged, notified, perClass },
    });
    return { windows, flagged, notified, perClass };
  }

  // -- the settings surface (the first 049 settings keys) -------------------

  /** The effective ladder: stored ∪ registry default, normalized by the
   * pure fold (fail-closed to [30,7,0]) + the last run's seal. */
  async effectiveConfig(): Promise<{
    key: string;
    thresholds: number[];
    default: number[];
    stored: boolean;
    lastRun: { at: string; outcome: { windows: number[]; flagged: number; notified: number } } | null;
  }> {
    const row = await store.findSweepSetting();
    const stored = Array.isArray(row?.value) ? (row?.value as readonly unknown[]) : [];
    return {
      key: SETTING_KEY,
      thresholds: normalizeSweepWindows(stored),
      default: [30, 7, 0],
      stored: row !== undefined,
      lastRun: (await store.lastSweepRun()) ?? null,
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
        throw new CmmsSweepThresholdsInvalidError({
          message: error instanceof InvalidSettingValueError ? error.message : "schema validation failed",
        });
      }
      throw error;
    }
    const normalized = normalizeSweepWindows(parsed as readonly unknown[]);
    const before = await store.findSweepSetting();
    await store.upsertSweepSetting({ value: normalized, actorId: input.actorId });
    await this.audit.record({
      action: "assets.expiry_sweep_configured",
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

  // -- the fleet-light register (R-10 — the view over the substrate) --------

  /** The register: ACTIVE assets with the four expiry chips (the days
   * derived in SQL from CURRENT_DATE) + the odometer binding; the
   * category filter is the caller's (the vehicle-class grouping is
   * tenant data — never a hard-coded law). */
  async fleetLight(input: { categoryIds?: readonly string[] }): Promise<store.FleetLightRow[]> {
    for (const id of input.categoryIds ?? []) {
      if (!UUID_RE.test(id)) {
        throw new CmmsInputInvalidError(`categoryId must be a UUID: ${id}`);
      }
    }
    return store.fleetLightRegister({
      categoryIds: input.categoryIds,
      limit: FLEET_BOUND,
    });
  }
}
