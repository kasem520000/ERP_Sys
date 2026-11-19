import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/talent-alerts.store";
import {
  DEFAULT_EXPIRY_SWEEP_WINDOWS,
  expiryDedupeKey,
  normalizeSweepWindows,
  sweepBands,
  SWEEP_KEY_PLACEHOLDER,
  type ExpirySweepKind,
} from "../domain/talent-math";
import { findEmployeeBrief } from "../infrastructure/talent-org.store";
import type { HrAlertJobRow } from "../infrastructure/talent-alerts.store";

/**
 * PHASE-047 (W-3 — T-09, D-06) — the hr-expiry-sweep: ONE daily
 * pg-boss job (queue `hr-expiry-sweep`, the phase doc's own verbatim
 * name) in the inventory alerts precedent's exact shape —
 * `listActiveTenantIds` + `withTenant` per tenant; the FOUR PROBES
 * (documents, certifications, probation end, review-due windows);
 * one `InboxService` notification per pass with the BR-091 dedupe
 * key `hr:{kind}:{employeeId}:{documentId}:{threshold}` (the
 * notifications table's uq_notifications_dedupe makes the law
 * STRUCTURAL — the re-run is a no-op by construction); fail-closed
 * documented defaults when a tenant registers no config row (the 044
 * pattern — 30/7/0 per amendment A-2, tenant-configurable DATA,
 * never hard-coded law); run stats stamped; audited. Never a repair,
 * only the alert (D-06's own law — the sweep never writes a talent
 * row).
 *
 * THE BAND LAW (BR-091's "per threshold pass", made literal): the
 * configured windows fold into DISJOINT day-bands (the pure
 * sweepBands); every item sits in EXACTLY ONE band per pass — an
 * item descends band by band across nights (30 → 7 → 0), firing each
 * threshold's key exactly once; the tightest band's floor is open
 * (already-expired items stay caught — an expired iqama is exactly
 * the exposure the alert product exists for; the honest title says
 * "expired on {date}").
 *
 * THE PII LAW (the inventory's register rows, DATA_PROTECTION §3):
 * the notification body carries the employee CODE + NAME and the
 * kind + date — NEVER the document number (the payslips/remittance
 * precedent; the number never leaves the register's own permission
 * plane).
 *
 * THE TARGETING (the inventory notify() shape): the owner's inbox —
 * ownerTarget() once per tenant-pass, prefsFor("hr") gating (absent
 * prefs = on), one record per item per band with the structural key.
 */

/** The per-tenant-per-probe bound (bounded jobs — the warranty
 * precedent's SWEEP_BOUND). */
const PROBE_BOUND = 200;

export interface ExpirySweepOutcome {
  /** The effective window ladder (the config's, or the documented
   * defaults when no row registered). */
  readonly windows: readonly number[];
  readonly flagged: number;
  readonly notified: number;
  readonly perKind: Readonly<Record<ExpirySweepKind, number>>;
  /** True when an explicit inactive config row skipped the whole
   * pass (absent ≠ inactive — the inventory law). */
  readonly skippedInactive: boolean;
}

@Injectable()
export class TalentAlertsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /**
   * THE SWEEP BODY — runs inside the ambient tenant UoW (the job
   * wrapper's withTenant; the DB spec calls it the same way). The
   * clock enters HERE only (new Date for the history stamps' `at` —
   * the probes' date math is the database's CURRENT_DATE, the one
   * clock the bands and the rows agree on).
   */
  async runExpirySweep(input?: { probeBound?: number }): Promise<ExpirySweepOutcome> {
    const bound = Math.min(Math.max(input?.probeBound ?? PROBE_BOUND, 1), 1_000);
    const job = await store.findAlertJob("EXPIRY_SWEEP");
    if (job !== undefined && !job.isActive) {
      return {
        windows: normalizeSweepWindows(job.thresholds),
        flagged: 0,
        notified: 0,
        perKind: { "document-expiry": 0, "certification-expiry": 0, "probation-end": 0, "review-due": 0 },
        skippedInactive: true,
      };
    }
    const windows = normalizeSweepWindows(job?.thresholds ?? DEFAULT_EXPIRY_SWEEP_WINDOWS);
    const bands = sweepBands(windows);
    const perKind: Record<ExpirySweepKind, number> = {
      "document-expiry": 0,
      "certification-expiry": 0,
      "probation-end": 0,
      "review-due": 0,
    };
    let flagged = 0;
    let notified = 0;
    // The owner target + prefs gate, ONCE per tenant-pass (the
    // inventory notify shape — absent prefs rows mean both channels
    // on; an owner with in-app off skips the records but the flags
    // still count and the run still stamps).
    const target = await this.inbox.ownerTarget();
    const prefs = target === null ? null : await this.inbox.prefsFor(target.userId, "hr");
    const deliverable = target !== null && prefs !== null && prefs.inApp;

    for (const band of bands) {
      // Probe 1 — employee documents (hr.document-expiry).
      for (const doc of await store.scanExpiringDocuments(band, bound)) {
        flagged += 1;
        perKind["document-expiry"] += 1;
        if (!deliverable) continue;
        const employee = await findEmployeeBrief(doc.employeeId);
        const recorded = await this.inbox.record({
          category: "hr",
          severity: band.threshold >= 30 ? "info" : "warning",
          title: {
            en: expiryTitle("Document", doc.kind, doc.expiresOn, band.threshold),
            ar: expiryTitleAr("وثيقة", doc.kind, doc.expiresOn, band.threshold),
          },
          body: {
            en: `The ${doc.kind} document of ${employee?.code ?? doc.employeeId} (${employee?.name ?? "employee"}) expires on ${doc.expiresOn} — ${band.threshold} day(s) ahead. Review the register.`,
            ar: `تنتهي وثيقة ${doc.kind} للموظف ${employee?.code ?? doc.employeeId} (${employee?.name ?? "الموظف"}) في ${doc.expiresOn} — قبل ${band.threshold} يومًا. راجع السجل.`,
          },
          actionLabel: { ar: "مراجعة الوثائق", en: "Review documents" },
          actionUrl: "/hr/self",
          dedupeKey: expiryDedupeKey({
            kind: "document-expiry",
            employeeId: doc.employeeId,
            documentId: doc.id,
            threshold: band.threshold,
          }),
          userId: target.userId,
        });
        if (recorded.inserted) notified += 1;
      }
      // Probe 2 — certifications (hr.certification-expiry).
      for (const cert of await store.scanExpiringCertifications(band, bound)) {
        flagged += 1;
        perKind["certification-expiry"] += 1;
        if (!deliverable) continue;
        const employee = await findEmployeeBrief(cert.employeeId);
        const recorded = await this.inbox.record({
          category: "hr",
          severity: band.threshold >= 30 ? "info" : "warning",
          title: {
            en: expiryTitle("Certification", cert.name, cert.expiryDate, band.threshold),
            ar: expiryTitleAr("شهادة", cert.name, cert.expiryDate, band.threshold),
          },
          body: {
            en: `The certification "${cert.name}" (issuer: ${cert.issuer}) of ${employee?.code ?? cert.employeeId} (${employee?.name ?? "employee"}) expires on ${cert.expiryDate} — ${band.threshold} day(s) ahead. Review the register.`,
            ar: `تنتهي شهادة "${cert.name}" (الجهة المانحة: ${cert.issuer}) للموظف ${employee?.code ?? cert.employeeId} (${employee?.name ?? "الموظف"}) في ${cert.expiryDate} — قبل ${band.threshold} يومًا. راجع السجل.`,
          },
          actionLabel: { ar: "مراجعة الشهادات", en: "Review certifications" },
          actionUrl: "/hr/self",
          dedupeKey: expiryDedupeKey({
            kind: "certification-expiry",
            employeeId: cert.employeeId,
            documentId: cert.id,
            threshold: band.threshold,
          }),
          userId: target.userId,
        });
        if (recorded.inserted) notified += 1;
      }
      // Probe 3 — probation end (hr.probation-end, amendment A-1 —
      // the FAIL-OPEN substrate: NULL probation_end rows never match,
      // no alert ever fabricated).
      for (const row of await store.scanProbationEnding(band, bound)) {
        flagged += 1;
        perKind["probation-end"] += 1;
        if (!deliverable) continue;
        const employee = await findEmployeeBrief(row.employeeId);
        const recorded = await this.inbox.record({
          category: "hr",
          severity: band.threshold >= 30 ? "info" : "warning",
          title: {
            en: expiryTitle("Probation", "period end", row.probationEnd, band.threshold),
            ar: expiryTitleAr("فترة التجربة", "نهاية", row.probationEnd, band.threshold),
          },
          body: {
            en: `The probation period of ${employee?.code ?? row.employeeId} (${employee?.name ?? "employee"}) ends on ${row.probationEnd} — ${band.threshold} day(s) ahead.`,
            ar: `تنتهي فترة التجربة للموظف ${employee?.code ?? row.employeeId} (${employee?.name ?? "الموظف"}) في ${row.probationEnd} — قبل ${band.threshold} يومًا.`,
          },
          actionLabel: { ar: "مراجعة الموظف", en: "Review employee" },
          actionUrl: "/hr/self",
          dedupeKey: expiryDedupeKey({
            kind: "probation-end",
            employeeId: row.employeeId,
            documentId: SWEEP_KEY_PLACEHOLDER,
            threshold: band.threshold,
          }),
          userId: target.userId,
        });
        if (recorded.inserted) notified += 1;
      }
      // Probe 4 — review due (hr.review-due, the cycle window closing:
      // the LIVE cycles only — DRAFT has not opened, CLOSED is
      // history; the cycle id rides the key's document axis, the
      // employee axis is the placeholder — no single employee owns a
      // cycle's due date).
      for (const cycle of await store.scanReviewDueCycles(band, bound)) {
        flagged += 1;
        perKind["review-due"] += 1;
        if (!deliverable) continue;
        const recorded = await this.inbox.record({
          category: "hr",
          severity: band.threshold >= 30 ? "info" : "warning",
          title: {
            en: expiryTitle("Review cycle", cycle.name, cycle.reviewDueDate, band.threshold),
            ar: expiryTitleAr("دورة التقييم", cycle.name, cycle.reviewDueDate, band.threshold),
          },
          body: {
            en: `The review window of cycle "${cycle.name}" (${cycle.status}) closes on ${cycle.reviewDueDate} — ${band.threshold} day(s) ahead. Reviews submit while the cycle is ACTIVE.`,
            ar: `تُغلق نافذة التقييم للدورة "${cycle.name}" (${cycle.status === "ACTIVE" ? "نشطة" : "معايرة"}) في ${cycle.reviewDueDate} — قبل ${band.threshold} يومًا. تُقدَّم التقييمات أثناء نشاط الدورة.`,
          },
          actionLabel: { ar: "مراجعة الدورة", en: "Review cycle" },
          actionUrl: "/hr/performance",
          dedupeKey: expiryDedupeKey({
            kind: "review-due",
            employeeId: SWEEP_KEY_PLACEHOLDER,
            documentId: cycle.id,
            threshold: band.threshold,
          }),
          userId: target.userId,
        });
        if (recorded.inserted) notified += 1;
      }
    }

    // The run-stats stamp + the audit record (the inventory law —
    // stamped even when nothing flagged: the run happened).
    await store.stampAlertRun({ jobKind: "EXPIRY_SWEEP", flagged });
    await this.audit.record({
      action: "hr.expiry_sweep_run",
      entityType: "hr_alert_jobs",
      // The inventory law: with no registered config row the audit's
      // entity anchor is the tenant itself (a uuid — the column's law).
      entityId: job?.id ?? requireTenantContext().tenantId,
      after: { windows, flagged, notified, perKind },
    });
    return { windows, flagged, notified, perKind, skippedInactive: false };
  }

  // ── the registration surface (the tenant-configurable thresholds) ────────

  async upsertJob(input: {
    thresholds: readonly number[];
    isActive: boolean;
    note: string | null;
    actorId: string | null;
  }): Promise<HrAlertJobRow> {
    // The pure law validates the ladder (fail-closed to the
    // documented defaults on an empty/garbage residue — the upsert
    // never silently disables the sweep either).
    const thresholds = normalizeSweepWindows(input.thresholds);
    const job = await store.upsertAlertJob({
      jobKind: "EXPIRY_SWEEP",
      thresholds,
      isActive: input.isActive,
      note: input.note,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.alert_job_upserted",
      entityType: "hr_alert_jobs",
      entityId: job.id,
      actorId: input.actorId ?? undefined,
      after: { thresholds, isActive: input.isActive },
    });
    return job;
  }

  async listJobs(): Promise<HrAlertJobRow[]> {
    const job = await store.findAlertJob("EXPIRY_SWEEP");
    return job === undefined ? [] : [job];
  }
}

/** The honest EN title — the 0-day band distinguishes "today" from
 * "already expired" (the tightest band's open floor). */
function expiryTitle(what: string, label: string, date: string, threshold: number): string {
  const today = new Date().toISOString().slice(0, 10);
  if (threshold === 0 && date < today) {
    return `${what} expired: ${label}`;
  }
  if (threshold === 0) {
    return `${what} expires today: ${label}`;
  }
  return `${what} expiring in ${threshold} days: ${label}`;
}

function expiryTitleAr(what: string, label: string, date: string, threshold: number): string {
  const today = new Date().toISOString().slice(0, 10);
  if (threshold === 0 && date < today) {
    return `${what} منتهية: ${label}`;
  }
  if (threshold === 0) {
    return `${what} تنتهي اليوم: ${label}`;
  }
  return `${what} تنتهي خلال ${threshold} يومًا: ${label}`;
}
