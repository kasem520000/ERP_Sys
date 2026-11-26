import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { readEffectiveSetting } from "../../../../infra/settings/setting-reader";
import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { computeDeclarationTotals, type ComputedDutyVatLine } from "../../../trade/domain/duty-vat-fold";
import { lcSweepBandFor, lcSweepBands, normalizeLcSweepWindows, type LcSweepBand } from "../../../trade/domain/lc-sweep-math";
import { DRAWBACK_STATUSES } from "../../../trade/domain/drawback-fold";
import { LC_STATUSES } from "../../../trade/domain/lc-lifecycle";
import { SHIPMENT_MILESTONES } from "../../../trade/domain/tracking-fold";

/**
 * PHASE-051 (W-40 — T-15, dated 2026-11-26) · the foreign-trade query
 * surface for the four trade report contracts (registry/trade/):
 * `trade.lc-register` · `trade.customs-declaration-register` ·
 * `trade.shipment-status` · `trade.duty-drawback-status` — the registry
 * query-service convention (the 042 manufacturing / 044 WMS / 048
 * projects / 049 CMMS / 050 quality pattern verbatim): read-only over
 * the ambient tenant transaction, composing the trade module's OWN
 * reads and folds VERBATIM (the LC expiry band fold the sweep rides,
 * the duty/VAT line fold the completion act rides) with the
 * presentation joins the report plane needs (the PO / B/L /
 * declaration briefs).
 *
 * THE ENGINE-VERBATIM LAW (D-18's own core): every figure rendered by
 * the contracts is the trade module's own — the registers' rows' own
 * strings, the folds the engines themselves ride
 * (computeDeclarationTotals for the G-65 totals, the sweep's own
 * effective-config read + lcSweepBands + lcSweepBandFor for the expiry
 * band — the SAME fold, never running the sweep: a report is never
 * the alerting act), zero parallel computation. The only derivations
 * are the day counts anchored on the DATABASE'S OWN CURRENT_DATE
 * inside the statements (the derived-step clock law — no Date.now() or
 * Date.now()+delta anywhere in this file).
 */

/** One LC register row: the record's own figures + the PO brief + the
 * expiry band verdict through the sweep's own fold + the checklist's
 * own discrepancy count + the amendments count. */
export interface TradeLcReportRow {
  readonly lcId: string;
  readonly lcNo: string;
  readonly status: string;
  readonly currency: string;
  readonly amount: string;
  readonly marginAmount: string;
  readonly issuingBank: string;
  readonly beneficiaryName: string;
  readonly poNo: string | null;
  readonly day: string;
  readonly expiryDate: string;
  readonly daysToExpiry: number;
  /** The sweep's own band verdict (null = beyond every window — the
   * fold's own shape, never a recomputed ladder). */
  readonly bandThreshold: number | null;
  readonly openDiscrepancies: number;
  readonly amendments: number;
  readonly settledAt: string | null;
}

/** One declaration register row: the record's own figures + the linked
 * briefs + the line fold's OWN totals (the same computeDeclarationTotals
 * the completion act rides — rendered from the LINES, never a stored
 * parallel figure). */
export interface TradeDeclarationReportRow {
  readonly declarationId: string;
  readonly declarationNo: string;
  readonly day: string;
  readonly declarationType: string;
  readonly customsOffice: string;
  readonly status: string;
  readonly submittedAt: string | null;
  readonly acceptedAt: string | null;
  readonly completedAt: string | null;
  readonly shipmentStatus: string;
  readonly currency: string;
  readonly blNo: string | null;
  readonly poNo: string | null;
  readonly landedCostNo: string | null;
  readonly lines: number;
  readonly totalCustomsValue: string;
  readonly totalDuty: string;
  readonly totalImportVat: string;
  readonly totalLandedAmount: string;
}

/** One shipment-status row: the B/L's own figures + the event log's own
 * append-only truth (the latest milestone + the count) + the packing
 * lists under it. The shipment_status is the fold's own driven figure —
 * NEVER writable by hand (D-14's own law, the register's own column). */
export interface TradeShipmentReportRow {
  readonly blId: string;
  readonly blNo: string;
  readonly docType: string;
  readonly carrierName: string;
  readonly portOfLoading: string | null;
  readonly portOfDischarge: string | null;
  readonly containerCount: number;
  readonly poNo: string | null;
  readonly deliveryNoteNo: string | null;
  readonly shipmentStatus: string;
  readonly day: string;
  readonly events: number;
  readonly latestMilestone: string | null;
  readonly latestEventAt: string | null;
  readonly packingLists: number;
}

/** One drawback row: the claim's own figures + the evidence links' own
 * briefs (the honest dash when absent — the 0121 CHECK's own floor
 * means a non-DRAFT row always carries one, the render re-checks). */
export interface TradeDrawbackReportRow {
  readonly claimId: string;
  readonly claimNo: string;
  readonly status: string;
  readonly claimedAmount: string;
  readonly currency: string;
  readonly exportDeclarationNo: string | null;
  readonly exportBlNo: string | null;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly day: string;
}

/** The sweep's own setting key (the effective-config read — never the
 * alerting run). */
const LC_SWEEP_SETTING_KEY = "trade.lc_expiry_sweep_thresholds";

@Injectable()
export class TradeReportQueriesService {
  /** The database's own CURRENT_DATE (the derived-step clock law — no
   * JavaScript clock in the path). */
  async dbToday(): Promise<string> {
    const rows = await this.requireTx().execute<{ today: string }>(sql`
      SELECT CURRENT_DATE::text AS today`);
    return rows.rows[0]!.today;
  }

  private requireTx() {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("trade report access requires an ambient tenant scope");
    }
    return context.tx;
  }

  // ── trade.lc-register ───────────────────────────────────────────────────

  /**
   * The LC register over the period (by issued_at): the records' own
   * figures + the PO brief + the expiry band verdict through the
   * SWEEP'S OWN FOLD (the effective windows — the sweep's own
   * readEffectiveSetting read ∪ the documented default, normalized by
   * the sweep's own normalizeLcSweepWindows, folded into disjoint
   * bands — never running the sweep) + the checklist's own
   * open-discrepancy count + the amendments count.
   */
  async lcRegister(filter: {
    status?: string;
    from: string;
    to: string;
  }): Promise<{ today: string; rows: readonly TradeLcReportRow[] }> {
    const today = await this.dbToday();
    // The sweep's effective-config read (the SAME reader the sweep's
    // runSweep rides — its read surfaces only, never the run).
    const stored = await readEffectiveSetting<readonly unknown[]>(LC_SWEEP_SETTING_KEY);
    const windows = normalizeLcSweepWindows(Array.isArray(stored) ? stored : []);
    const bands: readonly LcSweepBand[] = lcSweepBands(windows);

    const raw = await this.requireTx().execute<Record<string, unknown>>(sql`
      SELECT l.id AS "lcId", l.lc_no AS "lcNo", l.status, l.currency,
             l.amount::text AS "amount", l.margin_amount::text AS "marginAmount",
             l.issuing_bank AS "issuingBank", l.beneficiary_name AS "beneficiaryName",
             po.order_no AS "poNo",
             (l.issued_at AT TIME ZONE 'UTC')::date::text AS day,
             l.expiry_date::text AS "expiryDate",
             (l.expiry_date - CURRENT_DATE) AS "daysToExpiry",
             (SELECT count(*)::int FROM lc_documents d
               WHERE d.lc_id = l.id AND d.tenant_id = l.tenant_id
                 AND d.discrepancy_notes IS NOT NULL AND d.verified = false) AS "openDiscrepancies",
             (SELECT count(*)::int FROM lc_amendments a
               WHERE a.lc_id = l.id AND a.tenant_id = l.tenant_id) AS amendments,
             l.settled_at::text AS "settledAt"
      FROM letters_of_credit l
      LEFT JOIN purchase_orders po ON po.id = l.purchase_order_id AND po.tenant_id = l.tenant_id
      WHERE l.issued_at >= ${filter.from}::date
        AND l.issued_at < (${filter.to}::date + 1)
        AND (${filter.status ?? null}::text IS NULL OR l.status = ${filter.status ?? null})
      ORDER BY l.issued_at DESC, l.id DESC
      LIMIT 5000`);

    const rows: TradeLcReportRow[] = [];
    for (const r of raw.rows as unknown as (Omit<TradeLcReportRow, "bandThreshold"> & {
      daysToExpiry: number | string;
    })[]) {
      const days = Number(r.daysToExpiry);
      const band = lcSweepBandFor(bands, days);
      rows.push({ ...r, daysToExpiry: days, bandThreshold: band === null ? null : band.threshold });
    }
    return { today, rows };
  }

  // ── trade.customs-declaration-register ──────────────────────────────────

  /**
   * The customs declarations register over the period: the records'
   * own figures + the linked briefs (the B/L · the PO · the landed-cost
   * document) + **the line fold's OWN totals per declaration** — the
   * SAME computeDeclarationTotals the completion act rides, rendered
   * from the declaration's OWN lines at every read (never a stored
   * parallel figure — D-06's zero-parallel-computation law).
   */
  async customsDeclarationRegister(filter: {
    status?: string;
    from: string;
    to: string;
  }): Promise<readonly TradeDeclarationReportRow[]> {
    const raw = await this.requireTx().execute<Record<string, unknown>>(sql`
      SELECT c.id AS "declarationId", c.declaration_no AS "declarationNo",
             (c.created_at AT TIME ZONE 'UTC')::date::text AS day,
             c.declaration_type AS "declarationType", c.customs_office AS "customsOffice",
             c.status, c.submitted_at::text AS "submittedAt",
             c.accepted_at::text AS "acceptedAt", c.completed_at::text AS "completedAt",
             c.shipment_status AS "shipmentStatus", c.currency,
             b.bl_no AS "blNo", po.order_no AS "poNo",
             c.landed_cost_no AS "landedCostNo"
      FROM customs_declarations c
      LEFT JOIN bills_of_lading b ON b.id = c.bill_of_lading_id AND b.tenant_id = c.tenant_id
      LEFT JOIN purchase_orders po ON po.id = c.purchase_order_id AND po.tenant_id = c.tenant_id
      WHERE c.created_at >= ${filter.from}::date
        AND c.created_at < (${filter.to}::date + 1)
        AND (${filter.status ?? null}::text IS NULL OR c.status = ${filter.status ?? null})
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 2000`);

    const ids = (raw.rows as unknown as { declarationId: string }[]).map((r) => r.declarationId);
    const lineMap = new Map<string, ComputedDutyVatLine[]>();
    if (ids.length > 0) {
      const lines = await this.requireTx().execute<Record<string, unknown>>(sql`
        SELECT declaration_id AS "declarationId", line_no AS "lineNo",
               hs_code AS "hsCode",
               customs_value::text AS "customsValue",
               duty_rate::text AS "dutyRate",
               duty_amount::text AS "dutyAmount",
               import_vat::text AS "importVat"
        FROM customs_declaration_lines
        WHERE declaration_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY line_no`);
      for (const line of lines.rows as unknown as {
        declarationId: string;
        lineNo: number;
        hsCode: string;
        customsValue: string;
        dutyRate: string;
        dutyAmount: string;
        importVat: string;
      }[]) {
        const bucket = lineMap.get(line.declarationId) ?? [];
        // The fold's input rides the STORED line figures verbatim (the
        // DB CHECK guarantees duty_amount = the fold's own 4dp output —
        // the register renders the stored figures, the fold re-derives
        // the totals from them, the tie asserted at the contract).
        bucket.push({
          customsValue: line.customsValue,
          dutyRate: line.dutyRate,
          importVat: line.importVat,
          dutyAmount: line.dutyAmount,
        });
        lineMap.set(line.declarationId, bucket);
      }
    }

    const rows: TradeDeclarationReportRow[] = [];
    for (const r of raw.rows as unknown as (Omit<
      TradeDeclarationReportRow,
      "lines" | "totalCustomsValue" | "totalDuty" | "totalImportVat" | "totalLandedAmount"
    >)[]) {
      const lines = lineMap.get(r.declarationId) ?? [];
      const totals = computeDeclarationTotals(lines);
      rows.push({
        ...r,
        lines: lines.length,
        totalCustomsValue: totals.totalCustomsValue,
        totalDuty: totals.totalDuty,
        totalImportVat: totals.totalImportVat,
        totalLandedAmount: totals.totalLandedAmount,
      });
    }
    return rows;
  }

  // ── trade.shipment-status ───────────────────────────────────────────────

  /**
   * The shipment-status board over the period: one row per bill of
   * lading — the B/L's own figures (the multimodal doc type, the
   * carrier, the ports, the container count) + the shipment_status the
   * FOLD drives (never writable by hand — the register's own column)
   * + the event log's own append-only truth (the latest milestone +
   * the count) + the packing lists under it.
   */
  async shipmentStatus(filter: {
    docType?: string;
    from: string;
    to: string;
  }): Promise<readonly TradeShipmentReportRow[]> {
    const rows = await this.requireTx().execute<Record<string, unknown>>(sql`
      SELECT b.id AS "blId", b.bl_no AS "blNo", b.doc_type AS "docType",
             b.carrier_name AS "carrierName",
             b.port_of_loading AS "portOfLoading", b.port_of_discharge AS "portOfDischarge",
             jsonb_array_length(b.container_refs) AS "containerCount",
             po.order_no AS "poNo", dn.delivery_no AS "deliveryNoteNo",
             b.shipment_status AS "shipmentStatus",
             (b.issued_at AT TIME ZONE 'UTC')::date::text AS day,
             (SELECT count(*)::int FROM shipment_tracking_events e
               WHERE e.bill_of_lading_id = b.id AND e.tenant_id = b.tenant_id) AS events,
             (SELECT e.milestone FROM shipment_tracking_events e
               WHERE e.bill_of_lading_id = b.id AND e.tenant_id = b.tenant_id
               ORDER BY e.event_at DESC, e.created_at DESC LIMIT 1) AS "latestMilestone",
             (SELECT e.event_at::text FROM shipment_tracking_events e
               WHERE e.bill_of_lading_id = b.id AND e.tenant_id = b.tenant_id
               ORDER BY e.event_at DESC, e.created_at DESC LIMIT 1) AS "latestEventAt",
             (SELECT count(*)::int FROM packing_lists pl
               WHERE pl.bill_of_lading_id = b.id AND pl.tenant_id = b.tenant_id) AS "packingLists"
      FROM bills_of_lading b
      LEFT JOIN purchase_orders po ON po.id = b.purchase_order_id AND po.tenant_id = b.tenant_id
      LEFT JOIN delivery_notes dn ON dn.id = b.delivery_note_id AND dn.tenant_id = b.tenant_id
      WHERE b.issued_at >= ${filter.from}::date
        AND b.issued_at < (${filter.to}::date + 1)
        AND (${filter.docType ?? null}::text IS NULL OR b.doc_type = ${filter.docType ?? null})
      ORDER BY b.issued_at DESC, b.id DESC
      LIMIT 2000`);
    return rows.rows as unknown as TradeShipmentReportRow[];
  }

  // ── trade.duty-drawback-status ──────────────────────────────────────────

  /**
   * The drawback claims register over the period: the claims' own
   * figures (the ladder, the claimed amount, the workflow stamps) +
   * the export evidence's own briefs (the declaration's own number,
   * the B/L's own number — the honest dash when absent; the 0121
   * CHECK's own floor means a non-DRAFT row always carries one).
   */
  async dutyDrawbackStatus(filter: {
    status?: string;
    from: string;
    to: string;
  }): Promise<readonly TradeDrawbackReportRow[]> {
    const rows = await this.requireTx().execute<Record<string, unknown>>(sql`
      SELECT k.id AS "claimId", k.claim_no AS "claimNo", k.status,
             k.claimed_amount::text AS "claimedAmount", k.currency,
             d.declaration_no AS "exportDeclarationNo",
             b.bl_no AS "exportBlNo",
             k.submitted_at::text AS "submittedAt",
             k.decided_at::text AS "decidedAt",
             (k.created_at AT TIME ZONE 'UTC')::date::text AS day
      FROM duty_drawback_claims k
      LEFT JOIN customs_declarations d ON d.id = k.export_declaration_id AND d.tenant_id = k.tenant_id
      LEFT JOIN bills_of_lading b ON b.id = k.export_bill_of_lading_id AND b.tenant_id = k.tenant_id
      WHERE k.created_at >= ${filter.from}::date
        AND k.created_at < (${filter.to}::date + 1)
        AND (${filter.status ?? null}::text IS NULL OR k.status = ${filter.status ?? null})
      ORDER BY k.created_at DESC, k.id DESC
      LIMIT 2000`);
    return rows.rows as unknown as TradeDrawbackReportRow[];
  }
}

/** The vocabularies re-declared for the contracts' block-on-fail
 * assertions (the 0119/0121/0122 CHECKs' own domains — a foreign value
 * means the register drifted from its floor and blocks the export). */
export const TRADE_REPORT_VOCABULARIES = Object.freeze({
  lcStatuses: LC_STATUSES,
  declarationStatuses: ["DRAFT", "SUBMITTED", "ACCEPTED", "COMPLETED", "CANCELLED"] as const,
  shipmentMilestones: SHIPMENT_MILESTONES,
  drawbackStatuses: DRAWBACK_STATUSES,
});
