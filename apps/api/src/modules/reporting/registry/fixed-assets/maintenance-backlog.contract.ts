import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import type { CmmsBacklogOrderRow, CmmsBacklogPlanRow } from "./cmms-queries";
import { LOCALE, assertDecl, bilingual, col, defineReport, drill, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-049 (W-22 — T-16, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-049 row 2): `assets.maintenance-backlog` — the overdue planes
 * as a report contract, TWO SECTIONS on the engine's own registers:
 * (1) THE OVERDUE PLANS — every ACTIVE plan whose OWN nextDueDate is
 * past (the engine's evaluation anchor — the same date its generation
 * rides), the days overdue derived from the DATABASE'S OWN
 * CURRENT_DATE (the sweep's derived-step clock law: no Date.now()
 * anywhere in the report path); (2) THE OPEN ORDERS — every work order
 * the machine has not completed (the four open statuses), the days
 * open derived the same way from the order's own createdAt. ZERO
 * fabricated thresholds: a plan is "overdue" only by its own due date;
 * an order is "backlog" only while open — the machine's own states.
 *
 * The footer carries the honest-shape law as the block-on-fail
 * assertion (`backlog-honest-shape`): every plan row is ACTIVE and
 * overdue (nextDueDate < the DB's today), every order row is open
 * (status ≠ COMPLETED) — a completed order or an inactive/future plan
 * in the backlog is a shape violation and blocks the export.
 *
 * Permission `assets.maintenance.view` (matrix §3.27; the §12
 * module-register reuse rule — the same key the orders board rides).
 */

const BACKLOG_HONEST_SHAPE = assertDecl(
  "backlog-honest-shape",
  "The backlog's honest shape: every plan row is an ACTIVE plan whose own nextDueDate is past the database's today, and every order row is an open (not COMPLETED) order — no fabricated thresholds, no completed residue",
  "صف تراكم غير صادق: خطة غير نشطة أو غير مستحقة، أو أمر مكتمل — التصدير محجوب",
  "A dishonest backlog row: an inactive or not-yet-due plan, or a completed order — export blocked",
  "BR-097",
);

/** Build the honest-shape result with the offenders. */
function backlogShapeResult(
  today: string,
  plans: readonly CmmsBacklogPlanRow[],
  orders: readonly CmmsBacklogOrderRow[],
): AssertionResult {
  const offenders: string[] = [];
  for (const row of plans) {
    if (!row.plan.isActive || row.plan.nextDueDate === null || row.plan.nextDueDate >= today) {
      offenders.push(`plan ${row.plan.name}`);
    }
  }
  for (const row of orders) {
    if (row.order.status === "COMPLETED") {
      offenders.push(`order ${row.order.orderNo}`);
    }
  }
  const ok = offenders.length === 0;
  return {
    id: "backlog-honest-shape",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `صفوف غير صادقة: ${offenders.join("، ")}`,
          `Dishonest row(s): ${offenders.join(", ")}`,
        ),
  };
}

export const fixedAssetsMaintenanceBacklogContract = defineReport({
  id: "assets.maintenance-backlog",
  version: 1,
  title: bilingual("تراكم الصيانة", "Maintenance Backlog"),
  category: "financial",
  description: bilingual(
    "المستحق المتأخر من الصيانة على قسمين: الخطط الوقائية النشطة التي تجاوز تاريخ استحقاقها الخاص (الأيام مشتقة من تاريخ قاعدة البيانات نفسها) وأوامر الصيانة المفتوحة بأعمارها — بلا أي عتبات مختلقة: الخطة متأخرة بتاريخها الخاص والأمر تراكم ما دام مفتوحًا",
    "The overdue maintenance planes in two sections: the ACTIVE preventive plans past their OWN next-due date (the days derived from the database's own today) and the OPEN work orders with their ages — zero fabricated thresholds: a plan is overdue only by its own date, an order is backlog only while open",
  ),
  parameters: z.object({
    locale: LOCALE,
  }),
  requiredPermission: "assets.maintenance.view",
  dataSources: [
    source(
      "fixed_assets",
      "CmmsQueriesService.maintenanceBacklog (the plans engine's active register + the orders engine's open register, the days derived from the database's CURRENT_DATE)",
      ["maintenance_plans", "maintenance_work_orders", "assets", "asset_categories", "branches"],
      "سجلا الخطط النشطة والأوامر المفتوحة مع اشتقاق الأيام من تاريخ القاعدة",
      "The active-plans and open-orders registers with the day counts derived from the database's date",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  aggregation: {
    groupBy: ["section"],
    measures: [{ id: "days", kind: "sum" }],
    sorting: [{ by: "days", dir: "desc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "none", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 300,
    invalidationEvents: [],
  },
  assertions: [BACKLOG_HONEST_SHAPE],
  drillTargets: [
    drill("assetId", "/assets/maintenance", "لوحة أوامر الصيانة", "The maintenance orders board", "assets.maintenance.view"),
  ],
  run: async (_ctx, params) => {
    const { cmmsQueries } = reportingServices();
    const locale = params.locale === "en" ? "en" : "ar";
    const backlog = await cmmsQueries.maintenanceBacklog();

    const planRows = backlog.overduePlans.map((row) => ({
      key: row.plan.id,
      groupKey: "overdue-plans",
      values: {
        section: locale === "ar" ? "خطط متأخرة" : "Overdue plans",
        ref: row.plan.name,
        asset:
          locale === "ar"
            ? `${row.assetCode} · ${row.assetNameAr ?? row.assetName}`
            : `${row.assetCode} · ${row.assetName}`,
        trigger: row.plan.triggerType,
        due: row.plan.nextDueDate ?? "—",
        days: row.daysOverdue,
        detail:
          row.plan.triggerType === "CALENDAR"
            ? `${row.plan.intervalDays ?? "—"} d`
            : `${row.plan.thresholdDelta ?? "—"} Δ`,
      },
    }));

    const orderRows = backlog.openOrders.map((row) => ({
      key: row.order.id,
      groupKey: "open-orders",
      values: {
        section: locale === "ar" ? "أوامر مفتوحة" : "Open orders",
        ref: row.order.orderNo,
        asset:
          locale === "ar"
            ? `${row.assetCode} · ${row.assetNameAr ?? row.assetName}`
            : `${row.assetCode} · ${row.assetName}`,
        trigger: row.order.status,
        due: row.order.createdAt.slice(0, 10),
        days: row.daysOpen,
        detail:
          locale === "ar"
            ? (row.order.problemAr ?? row.order.problem)
            : row.order.problem,
      },
    }));

    return {
      columns: [
        col("ref", "المرجع", "Reference"),
        col("asset", "الأصل", "Asset"),
        col("trigger", "المُطلِق / الحالة", "Trigger / status", "status"),
        col("due", "الاستحقاق / الإنشاء", "Due / created", "date"),
        col("days", "الأيام", "Days", "qty"),
        col("detail", "التفصيل", "Detail"),
      ],
      groups: [
        {
          key: "overdue-plans",
          label: bilingual(
            `الخطط الوقائية المتأخرة (${backlog.overduePlans.length})`,
            `Overdue preventive plans (${backlog.overduePlans.length})`,
          ),
        },
        {
          key: "open-orders",
          label: bilingual(
            `أوامر الصيانة المفتوحة (${backlog.openOrders.length})`,
            `Open work orders (${backlog.openOrders.length})`,
          ),
        },
      ],
      rows: [...planRows, ...orderRows],
      totals: [
        {
          id: "overduePlans",
          kind: "sum",
          label: bilingual("خطط متأخرة", "Overdue plans"),
          amount: String(backlog.overduePlans.length),
        },
        {
          id: "openOrders",
          kind: "sum",
          label: bilingual("أوامر مفتوحة", "Open orders"),
          amount: String(backlog.openOrders.length),
        },
        {
          id: "asOf",
          kind: "check",
          label: bilingual("تاريخ القاعدة (مرجع الاشتقاق)", "Database date (the derivation anchor)"),
          amount: backlog.today,
        },
      ],
      assertionResults: [backlogShapeResult(backlog.today, backlog.overduePlans, backlog.openOrders)],
      notes: [
        bilingual(
          "الأيام مشتقة من تاريخ قاعدة البيانات نفسها (CURRENT_DATE) داخل الاستعلام — لا ساعة جافاسكربت في مسار التقرير. الخطة متأخرة بتاريخ استحقاقها الذي يقيسه محرك التوليد نفسه، والأمر تراكم ما دام مفتوحًا — الحالة المكتملة لا تدخل التراكم أبدًا",
          "The day counts derive from the database's own CURRENT_DATE inside the query — no JavaScript clock anywhere in the report path. A plan is overdue by the same due date the generation engine itself measures, and an order is backlog only while open — a COMPLETED order never enters the backlog",
        ),
      ],
    };
  },
});
