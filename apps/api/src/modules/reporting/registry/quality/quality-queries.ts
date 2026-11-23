import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { AuditService } from "../../../audit/api/audit";
import { DrizzleAuditStore } from "../../../audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../../notifications/application/inbox-service";
import { QualityCalibrationSweepService } from "../../../quality/application/quality-calibration-sweep-service";
import { calibrationSweepBands, type CalibrationSweepBand } from "../../../quality/domain/calibration-sweep-math";
import { capaCloseGate, type CapaAction } from "../../../quality/domain/capa-lifecycle";
import * as qualityStore from "../../../quality/infrastructure/quality.store";

/**
 * PHASE-050 (W-30 — T-17, dated 2026-11-23) · the QMS query surface for
 * the four quality report contracts (registry/quality/):
 * `quality.ncr-register` · `quality.capa-status` ·
 * `quality.calibration-due` · `quality.complaints-summary` — the registry
 * query-service convention (the 042 manufacturing / 044 WMS / 048
 * projects / 049 CMMS pattern verbatim): read-only over the ambient
 * tenant transaction, composing the quality module's OWN reads VERBATIM
 * (the sweep engine's effective config + probe for the due window, the
 * capa close gate's own fold for the pending-actions figures) with the
 * presentation joins the report plane needs (the item/partner briefs).
 *
 * THE ENGINE-VERBATIM LAW (D-18's own core): every figure rendered by
 * the contracts is the quality module's own — the register rows' own
 * strings, the folds the engine itself rides (capaCloseGate for the
 * BR-103 figures, calibrationSweepBands + scanCalibrationDue for the
 * due window), zero parallel computation. The only derivations are the
 * day counts anchored on the DATABASE'S OWN CURRENT_DATE inside the
 * statements (the sweep's derived-step clock law — no Date.now() or
 * Date.now()+delta anywhere in this file).
 */

/** One NCR register row: the record's own figures + the item brief. */
export interface QualityNcrReportRow {
  readonly ncrId: string;
  readonly ncrNo: string;
  readonly day: string;
  readonly status: string;
  readonly severity: string;
  readonly source: string;
  readonly itemSku: string;
  readonly itemName: string;
  readonly itemNameAr: string | null;
  readonly partnerName: string | null;
  readonly partnerNameAr: string | null;
  readonly problem: string;
  readonly affectedQty: string;
  readonly disposition: string | null;
  readonly closedAt: string | null;
}

/** One CAPA status row: the record's own figures + the BR-103 gate's own
 * verdict figures (the same fold the close act rides). */
export interface QualityCapaReportRow {
  readonly capaId: string;
  readonly capaNo: string;
  readonly title: string;
  readonly status: string;
  readonly ncrNo: string | null;
  readonly day: string;
  readonly dueDate: string | null;
  readonly rootCauseRecorded: boolean;
  readonly actionsTotal: number;
  readonly openActions: number;
  readonly pendingActions: number;
  readonly effectivenessRecorded: boolean;
  readonly effectivenessEffective: boolean | null;
  readonly externalCost: string;
  readonly closedAt: string | null;
}

/** The complaints summary's three grouped counts (status / channel /
 * severity — the register's own vocabularies). */
export interface QualityComplaintsSummary {
  readonly today: string;
  readonly total: number;
  readonly byStatus: readonly { key: string; n: number }[];
  readonly byChannel: readonly { key: string; n: number }[];
  readonly bySeverity: readonly { key: string; n: number }[];
}

@Injectable()
export class QualityReportQueriesService {
  private readonly audit = new AuditService(new DrizzleAuditStore());

  /** The sweep engine itself (the direct-construction graph the db
   * fixtures and the reporting services build — the 049 cmmsQueries
   * precedent; only its READ surfaces are consumed here: the effective
   * config, never runSweep — a report is never the alerting act). */
  readonly sweep = new QualityCalibrationSweepService(this.audit, new InboxService());

  /** The database's own CURRENT_DATE (the derived-step clock law — the
   * backlog precedent's own read; no JavaScript clock in the path). */
  async dbToday(): Promise<string> {
    const rows = await this.requireTx().execute<{ today: string }>(sql`
      SELECT CURRENT_DATE::text AS today`);
    return rows.rows[0]!.today;
  }

  private requireTx() {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("quality report access requires an ambient tenant scope");
    }
    return context.tx;
  }

  // ── quality.ncr-register ────────────────────────────────────────────────

  /** The NCR register over the period: the records' own figures (status,
   * severity, source, the affected quantity, the disposition pair) with
   * the item + partner briefs, newest first. */
  async ncrRegister(filter: {
    status?: string;
    from: string;
    to: string;
  }): Promise<readonly QualityNcrReportRow[]> {
    const rows = await this.requireTx().execute<Record<string, unknown>>(sql`
      SELECT n.id AS "ncrId", n.ncr_no AS "ncrNo",
             (n.created_at AT TIME ZONE 'UTC')::date::text AS day,
             n.status, n.severity, n.source,
             i.sku AS "itemSku", i.name AS "itemName", i.name_ar AS "itemNameAr",
             p.name AS "partnerName", p.name_ar AS "partnerNameAr",
             n.problem, n.affected_qty::text AS "affectedQty",
             n.disposition, n.closed_at::text AS "closedAt"
      FROM ncr_records n
      JOIN items i ON i.id = n.item_id AND i.tenant_id = n.tenant_id
      LEFT JOIN partners p ON p.id = n.partner_id AND p.tenant_id = n.tenant_id
      WHERE n.created_at >= ${filter.from}::date
        AND n.created_at < (${filter.to}::date + 1)
        AND (${filter.status ?? null}::text IS NULL OR n.status = ${filter.status ?? null})
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 5000`);
    return rows.rows as unknown as QualityNcrReportRow[];
  }

  // ── quality.capa-status ─────────────────────────────────────────────────

  /**
   * The CAPA register over the period: the records' own figures + THE
   * BR-103 GATE'S OWN VERDICT FIGURES (capaCloseGate — the same fold the
   * close act rides: the open-action count, the pending count (an
   * undated open action or a future-dated one), the effectiveness
   * check's recorded state) — derived against the DATABASE'S OWN
   * CURRENT_DATE, exactly as the service's close act derives them.
   */
  async capaStatus(filter: {
    status?: string;
    from: string;
    to: string;
  }): Promise<{ today: string; rows: readonly QualityCapaReportRow[] }> {
    const today = await this.dbToday();
    const raw = await this.requireTx().execute<Record<string, unknown>>(sql`
      SELECT c.id AS "capaId", c.capa_no AS "capaNo", c.title, c.status,
             n.ncr_no AS "ncrNo",
             (c.created_at AT TIME ZONE 'UTC')::date::text AS day,
             c.due_date::text AS "dueDate", c.root_cause_at::text AS "rootCauseAt",
             c.actions, c.effectiveness, c.external_cost::text AS "externalCost",
             c.closed_at::text AS "closedAt"
      FROM capa_records c
      LEFT JOIN ncr_records n ON n.id = c.ncr_id AND n.tenant_id = c.tenant_id
      WHERE c.created_at >= ${filter.from}::date
        AND c.created_at < (${filter.to}::date + 1)
        AND (${filter.status ?? null}::text IS NULL OR c.status = ${filter.status ?? null})
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 5000`);
    const rows: QualityCapaReportRow[] = [];
    for (const row of raw.rows as unknown as {
      capaId: string;
      capaNo: string;
      title: string;
      status: string;
      ncrNo: string | null;
      day: string;
      dueDate: string | null;
      rootCauseAt: string | null;
      actions: unknown;
      effectiveness: unknown;
      externalCost: string;
      closedAt: string | null;
    }[]) {
      const actions = Array.isArray(row.actions) ? (row.actions as readonly CapaAction[]) : [];
      const verdict = capaCloseGate({ actions, effectiveness: row.effectiveness, today });
      const effectiveness =
        row.effectiveness !== null && typeof row.effectiveness === "object"
          ? (row.effectiveness as { effective?: unknown })
          : null;
      rows.push({
        capaId: row.capaId,
        capaNo: row.capaNo,
        title: row.title,
        status: row.status,
        ncrNo: row.ncrNo,
        day: row.day,
        dueDate: row.dueDate,
        rootCauseRecorded: row.rootCauseAt !== null,
        actionsTotal: actions.length,
        openActions:
          verdict.figures?.openActionCount ?? actions.filter((a) => a.completedAt === null).length,
        pendingActions: verdict.figures?.pendingCount ?? 0,
        effectivenessRecorded: row.effectiveness !== null,
        effectivenessEffective:
          effectiveness !== null && typeof effectiveness.effective === "boolean"
            ? effectiveness.effective
            : null,
        externalCost: row.externalCost,
        closedAt: row.closedAt,
      });
    }
    return { today, rows };
  }

  // ── quality.calibration-due ─────────────────────────────────────────────

  /**
   * THE SWEEP'S OWN DUE-WINDOW PROBE (D-18: the report rides the SAME
   * read the alerting sweep rides — the effective thresholds ladder
   * (stored ∪ the documented default [30,7,0], normalized by the pure
   * fold) folded into the DISJOINT bands, then ONE probe per band over
   * the instruments' LATEST due dates; the latest-first law is the
   * probe's own). The report NEVER runs the sweep — a report is never
   * the alerting act; it renders the same window the alerts name.
   */
  async calibrationDue(): Promise<{
    today: string;
    thresholds: readonly number[];
    bands: readonly {
      band: CalibrationSweepBand;
      instruments: readonly qualityStore.CalibrationDueRow[];
    }[];
  }> {
    const config = await this.sweep.effectiveConfig();
    const bands = calibrationSweepBands(config.thresholds);
    const probed: {
      band: CalibrationSweepBand;
      instruments: readonly qualityStore.CalibrationDueRow[];
    }[] = [];
    for (const band of bands) {
      probed.push({
        band,
        instruments: await qualityStore.scanCalibrationDue({
          band: { threshold: band.threshold, fromDays: band.fromDays, toDays: band.toDays },
          limit: 500,
        }),
      });
    }
    return { today: await this.dbToday(), thresholds: config.thresholds, bands: probed };
  }

  // ── quality.complaints-summary ──────────────────────────────────────────

  /**
   * The complaints summary: the register's own grouped counts — by status
   * (the 0114 ladder), by channel and by severity (the intake
   * vocabularies) — over the period, one GROUP BY per axis.
   */
  async complaintsSummary(filter: {
    from: string;
    to: string;
  }): Promise<QualityComplaintsSummary> {
    const tx = this.requireTx();
    const range = sql`
      created_at >= ${filter.from}::date AND created_at < (${filter.to}::date + 1)`;
    const byStatus = await tx.execute<{ key: string; n: number }>(sql`
      SELECT status AS key, count(*)::int AS n FROM complaints
      WHERE ${range} GROUP BY status ORDER BY status`);
    const byChannel = await tx.execute<{ key: string; n: number }>(sql`
      SELECT channel AS key, count(*)::int AS n FROM complaints
      WHERE ${range} GROUP BY channel ORDER BY channel`);
    const bySeverity = await tx.execute<{ key: string; n: number }>(sql`
      SELECT severity AS key, count(*)::int AS n FROM complaints
      WHERE ${range} GROUP BY severity ORDER BY severity`);
    const total = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM complaints
      WHERE ${range}`);
    return {
      today: await this.dbToday(),
      total: total.rows[0]!.n,
      byStatus: byStatus.rows as unknown as { key: string; n: number }[],
      byChannel: byChannel.rows as unknown as { key: string; n: number }[],
      bySeverity: bySeverity.rows as unknown as { key: string; n: number }[],
    };
  }
}
