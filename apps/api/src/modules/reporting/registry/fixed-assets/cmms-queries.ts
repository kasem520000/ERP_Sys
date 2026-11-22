import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { AuditService } from "../../../audit/api/audit";
import { DrizzleAuditStore } from "../../../audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../../accounting/application/posting-service";
import { NumberingService } from "../../../accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../../partners/application/subledger-service";
import { InboxService } from "../../../notifications/application/inbox-service";
import { addExact } from "../../../accounting/application/decimal-strings";
import { MaintenanceWorkOrderService } from "../../../fixed_assets/application/maintenance-work-order-service";
import { MaintenancePlanService } from "../../../fixed_assets/application/maintenance-plan-service";
import { AssetMetersService } from "../../../fixed_assets/application/asset-meters-service";
import { AssetExpirySweepService } from "../../../fixed_assets/application/asset-expiry-sweep-service";
import * as cmmsStore from "../../../fixed_assets/infrastructure/cmms.store";

/**
 * PHASE-049 (W-22 — T-16, dated 2026-11-22) · the CMMS query surface for
 * the four asset-maintenance report contracts (registry/fixed-assets/):
 * `assets.maintenance-costs` · `assets.maintenance-backlog` ·
 * `assets.meter-readings` · `assets.expiry-register` — the registry
 * query-service convention (the 042 manufacturing / 044 WMS pattern
 * verbatim): read-only over the ambient tenant transaction, composing
 * the W-17…W-19 ENGINES' OWN READS VERBATIM (the work-order register
 * with its own totals, the plans register, the meters + readings log,
 * the fleet-light register) with the presentation joins the report
 * plane needs (the asset brief through the store's own card read).
 *
 * THE ENGINE-VERBATIM LAW (the 048 W-14 precedent, D-15's descendant):
 * every figure rendered by the contracts is the engine's own string —
 * zero parallel computation. The only derivations are (a) the INV-034
 * tie read (Σ the DEBIT lines the G-59 entries actually landed per work
 * order — the live GL witness against the order's own source totals)
 * and (b) the backlog's day counts, derived from the DATABASE'S OWN
 * CURRENT_DATE inside the statement (the sweep's derived-step clock
 * law — no Date.now()+delta anywhere in this file).
 */

/** One maintenance-costs row: the work order's own figures + the asset
 * brief (the store's own card read) + the live INV-034 GL witness. */
export interface CmmsCostReportRow {
  readonly order: cmmsStore.WorkOrderRow;
  readonly assetCode: string;
  readonly assetName: string;
  readonly assetNameAr: string | null;
  readonly branchCode: string;
  /** Σ the DEBIT lines the G-59 entries landed for THIS order (null on
   * open orders — INV-034's "no posting before completion" arm). */
  readonly glDebits: string | null;
}

/** One backlog plan row: the plan's own figures + the DB-derived days
 * overdue (the engine's own nextDueDate against CURRENT_DATE). */
export interface CmmsBacklogPlanRow {
  readonly plan: cmmsStore.PlanRow;
  readonly assetCode: string;
  readonly assetName: string;
  readonly assetNameAr: string | null;
  readonly daysOverdue: number;
}

/** One backlog order row: the open order's own figures + the DB-derived
 * days open (the order's own createdAt against CURRENT_DATE). */
export interface CmmsBacklogOrderRow {
  readonly order: cmmsStore.WorkOrderRow;
  readonly assetCode: string;
  readonly assetName: string;
  readonly assetNameAr: string | null;
  readonly daysOpen: number;
}

/** The meter-readings log's per-meter block (the engine's own rows). */
export interface CmmsMeterLogBlock {
  readonly meter: cmmsStore.MeterRow;
  readonly assetCode: string;
  readonly assetName: string;
  readonly assetNameAr: string | null;
  readonly readings: readonly cmmsStore.ReadingRow[];
}

@Injectable()
export class CmmsQueriesService {
  private readonly audit = new AuditService(new DrizzleAuditStore());
  private readonly posting = new PostingService(this.audit, new PartnerSubledgerService());
  private readonly numbering = new NumberingService(this.audit);

  /** The engines themselves (the direct-construction graph the db
   * fixtures and the reporting services build — stateless readers over
   * the ambient tenant transaction). */
  readonly orders = new MaintenanceWorkOrderService(this.audit, this.posting, this.numbering);
  readonly plans = new MaintenancePlanService(this.audit, this.numbering);
  readonly meters = new AssetMetersService(this.audit, this.plans);
  readonly sweep = new AssetExpirySweepService(this.audit, new InboxService());

  /** The asset brief (the store's own card read — code, names, branch;
   * the same read the scan surface rides). */
  private async assetBrief(assetId: string): Promise<{
    code: string;
    name: string;
    nameAr: string | null;
    branchCode: string;
  }> {
    const card = await cmmsStore.findAssetCard(assetId);
    return {
      code: card?.code ?? "?",
      name: card?.name ?? "?",
      nameAr: card?.nameAr ?? null,
      branchCode: card?.branchCode ?? "?",
    };
  }

  // ── assets.maintenance-costs ────────────────────────────────────────────

  /** The work-order register with the engine's own totals + the asset
   * briefs + the live INV-034 GL witness per completed order. */
  async maintenanceCosts(filter: {
    assetId?: string;
    status?: string;
  }): Promise<readonly CmmsCostReportRow[]> {
    const orders = await this.orders.list(filter);
    const briefs = new Map<string, Awaited<ReturnType<CmmsQueriesService["assetBrief"]>>>();
    for (const assetId of new Set(orders.map((order) => order.assetId))) {
      briefs.set(assetId, await this.assetBrief(assetId));
    }
    const glDebits = await this.g59DebitTotals(
      orders.filter((order) => order.journalEntryId !== null).map((order) => order.id),
    );
    return orders.map((order) => {
      const brief = briefs.get(order.assetId)!;
      return {
        order,
        assetCode: brief.code,
        assetName: brief.name,
        assetNameAr: brief.nameAr,
        branchCode: brief.branchCode,
        glDebits: order.journalEntryId === null ? null : (glDebits.get(order.id) ?? "0"),
      };
    });
  }

  /**
   * THE INV-034 TIE READ (the live GL witness): Σ the DEBIT lines the
   * journal actually landed per work order — read from the entries
   * SOURCED to the order (source_type 'maintenance_work_order'), which
   * by G-59's construction is the maintenance-expense debit. A coherent
   * completion lands exactly its source total; a drifted GL (a manual
   * adjustment entry the source lines cannot explain) surfaces here and
   * the report's block-on-fail assertion blocks the export.
   */
  async g59DebitTotals(orderIds: readonly string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();
    const rows = await requireTenantContext().tx!.execute<{
      sourceId: string;
      debits: string;
    }>(sql`
      SELECT je.source_id::text AS "sourceId", sum(jl.base_amount)::text AS debits
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.source_type = 'maintenance_work_order'
        AND je.source_id IN (${sql.join(
          orderIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        AND jl.direction = 'DEBIT'
      GROUP BY je.source_id
    `);
    const map = new Map<string, string>();
    for (const row of rows.rows) {
      map.set(row.sourceId, new Decimal(row.debits).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
    }
    return map;
  }

  // ── assets.maintenance-backlog ──────────────────────────────────────────

  /**
   * The backlog: the ACTIVE plans whose OWN nextDueDate is past (the
   * engine's evaluation anchor — the same date its generation rides)
   * and the OPEN work orders (every status the machine has not
   * completed), each with the day count derived from the DATABASE'S
   * OWN CURRENT_DATE inside the statement (the derived-step clock law
   * — the sweep's own pattern; the JS side never reads a clock).
   */
  async maintenanceBacklog(): Promise<{
    today: string;
    overduePlans: readonly CmmsBacklogPlanRow[];
    openOrders: readonly CmmsBacklogOrderRow[];
  }> {
    const tx = requireTenantContext().tx!;
    const todayRow = await tx.execute<{ today: string }>(sql`
      SELECT CURRENT_DATE::text AS today`);
    const today = todayRow.rows[0]!.today;

    const plans = await this.plans.list({ activeOnly: true });
    const overduePlans: CmmsBacklogPlanRow[] = [];
    for (const plan of plans) {
      if (plan.nextDueDate === null || plan.nextDueDate >= today) continue;
      const brief = await this.assetBrief(plan.assetId);
      overduePlans.push({
        plan,
        assetCode: brief.code,
        assetName: brief.name,
        assetNameAr: brief.nameAr,
        daysOverdue: datediff(plan.nextDueDate, today),
      });
    }
    overduePlans.sort((a, b) => b.daysOverdue - a.daysOverdue || a.plan.id.localeCompare(b.plan.id));

    const orders = await this.orders.list({});
    const openOrders: CmmsBacklogOrderRow[] = [];
    for (const order of orders) {
      if (order.status === "COMPLETED") continue;
      const brief = await this.assetBrief(order.assetId);
      openOrders.push({
        order,
        assetCode: brief.code,
        assetName: brief.name,
        assetNameAr: brief.nameAr,
        daysOpen: datediff(order.createdAt.slice(0, 10), today),
      });
    }
    openOrders.sort((a, b) => b.daysOpen - a.daysOpen || a.order.id.localeCompare(b.order.id));

    return { today, overduePlans, openOrders };
  }

  // ── assets.meter-readings ───────────────────────────────────────────────

  /** The readings log: per meter the engine's own rows (the same list
   * the board's readings pane renders), optionally narrowed to one
   * asset or one meter. */
  async meterReadingsLog(filter: {
    assetId?: string;
    meterId?: string;
  }): Promise<readonly CmmsMeterLogBlock[]> {
    if (filter.meterId !== undefined) {
      const meter = await this.meters.getMeter(filter.meterId);
      const brief = await this.assetBrief(meter.assetId);
      return [
        {
          meter,
          assetCode: brief.code,
          assetName: brief.name,
          assetNameAr: brief.nameAr,
          readings: await this.meters.listReadings(meter.id),
        },
      ];
    }
    const meters = await this.meters.listMeters({ assetId: filter.assetId });
    const blocks: CmmsMeterLogBlock[] = [];
    for (const meter of meters) {
      const brief = await this.assetBrief(meter.assetId);
      blocks.push({
        meter,
        assetCode: brief.code,
        assetName: brief.name,
        assetNameAr: brief.nameAr,
        readings: await this.meters.listReadings(meter.id),
      });
    }
    return blocks;
  }

  // ── assets.expiry-register ──────────────────────────────────────────────

  /**
   * R-10's fleet-light register VERBATIM (the W-19 engine's own read:
   * every ACTIVE asset with its four expiry chips — the days derived
   * from the database's CURRENT_DATE inside the statement — and the
   * ONE designated KM odometer's snapshot; the vehicle-class grouping
   * is the caller's category filter, tenant data by design).
   */
  async expiryRegister(filter: {
    categoryIds?: readonly string[];
  }): Promise<readonly cmmsStore.FleetLightRow[]> {
    return this.sweep.fleetLight({
      categoryIds: filter.categoryIds,
    });
  }

  /** The report-plane's own decimal fold (the same addExact the
   * asset-register contract rides): Σ the legs across rows. */
  static sumLeg(values: readonly string[]): string {
    return values.reduce((acc, value) => addExact(acc, value), "0.0000");
  }
}

/** Pure calendar difference (ISO date strings — the DB's own dates; no
 * clock is read here, the arithmetic is presentation-only and exact:
 * both anchors are UTC midnights, so the ms divide is whole — the
 * Decimal fold keeps it ADR-0009-clean). */
function datediff(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return new Decimal(to - from).div(86_400_000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}
