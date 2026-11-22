import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import type { CmmsCostReportRow } from "./cmms-queries";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-049 (W-22 — T-16, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-049 row 1): `assets.maintenance-costs` — the work-order cost
 * register as a report contract: one row per work order on the W-17
 * engine's own listing (the register's own orderNo/stamps + the asset
 * brief through the store's own card read), each row carrying the
 * engine's OWN three legs verbatim (laborTotal / partsTotal /
 * externalTotal — the completion's own stamped figures, zero parallel
 * computation) and the row total folded with the same addExact the
 * asset-register contract rides.
 *
 * THE INV-034 LIVE TIE (the block-on-fail assertion
 * `inv034-expense-tie`): for every COMPLETED order the GL witness — Σ
 * the DEBIT lines the journal actually landed for the order's source —
 * must equal the order's own source total (labor + parts + external)
 * TO THE CENT; and NO open order may carry a posting (INV-034's "no
 * posting occurs before completion" arm). A drifted GL (a manual
 * adjustment the source lines cannot explain) FAILS the tie with the
 * per-order offenders in the detail and blocks the export.
 *
 * Permission `assets.maintenance.view` (matrix §3.27; the §12
 * module-register reuse rule — the same key the orders board and the
 * scan surface ride; INV-034's GL reconciliation plane is a read).
 */

const INV034_EXPENSE_TIE = assertDecl(
  "inv034-expense-tie",
  "INV-034 at the report: per COMPLETED work order the GL maintenance-expense debit (Σ the DEBIT lines landed for the order's source) equals labor + parts + external TO THE CENT, and no open order carries any posting — a drifted GL blocks the export",
  "مصروف الصيانة الدفتري لأمر صيانة مكتمل لا يطابق مجموع سطور تكاليفه (عمالة + قطع + خارجي) أو أمر مفتوح يحمل ترحيلًا — التصدير محجوب",
  "A completed work order's GL maintenance-expense debit does not tie to its labor + parts + external source lines, or an open order carries a posting — export blocked",
  "INV-034",
);

/** Build the INV-034 tie result with the per-order offenders (the first
 * offender's figures in `compared` — the INV-033 precedent). */
function inv034Result(rows: readonly CmmsCostReportRow[]): AssertionResult {
  const offenders: string[] = [];
  let firstSource = "";
  let firstGl = "";
  for (const row of rows) {
    const sourceTotal = addExact(
      addExact(row.order.laborTotal, row.order.partsTotal),
      row.order.externalTotal,
    );
    if (row.order.status === "COMPLETED") {
      const gl = row.glDebits ?? "0.0000";
      if (gl !== sourceTotal) {
        if (offenders.length === 0) {
          firstSource = sourceTotal;
          firstGl = gl;
        }
        offenders.push(`${row.order.orderNo} (GL ${gl} / source ${sourceTotal})`);
      }
    } else if (row.order.journalEntryId !== null || row.glDebits !== null) {
      offenders.push(`${row.order.orderNo} (open order with a posting)`);
    }
  }
  const ok = offenders.length === 0;
  return {
    id: "inv034-expense-tie",
    status: ok ? "PASS" : "FAIL",
    compared: ok ? undefined : { left: firstSource, right: firstGl },
    detail: ok
      ? undefined
      : bilingual(
          `أوامر غير مطابقة: ${offenders.join("، ")}`,
          `Unreconciled order(s): ${offenders.join(", ")}`,
        ),
  };
}

const ORDER_STATUSES = ["REQUESTED", "PLANNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] as const;

export const fixedAssetsMaintenanceCostsContract = defineReport({
  id: "assets.maintenance-costs",
  version: 1,
  title: bilingual("تكاليف الصيانة", "Maintenance Costs"),
  category: "financial",
  description: bilingual(
    "سجل تكاليف أوامر الصيانة: لكل أمر أرجله الثلاث بأرقام المحرك نفسها (العمالة والقطع والخارجي) مع الأصل والحالة والأختام وربط القيد — ويحمل مطابقة INV-034 الحية (مصروف الصيانة الدفتري مقابل سطور التكاليف إلى القلس) التي تمنع التصدير عند الفشل",
    "The work-order cost register: per order the engine's own three legs (labor, parts, external) with the asset, status, stamps and the journal link — carrying the live INV-034 tie (the GL maintenance expense vs the source lines to the cent) that blocks exports on failure",
  ),
  parameters: z.object({
    assetId: z.string().uuid().optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    dateFrom: ISO_DATE.optional(),
    dateTo: ISO_DATE.optional(),
    locale: LOCALE,
  }),
  requiredPermission: "assets.maintenance.view",
  dataSources: [
    source(
      "fixed_assets",
      "CmmsQueriesService.maintenanceCosts (the W-17 engine's own register + the asset brief through the store's card read + the live INV-034 GL witness)",
      [
        "maintenance_work_orders",
        "assets",
        "asset_categories",
        "branches",
        "maintenance_cost_lines",
      ],
      "سجل أوامر الصيانة بمجمعات تكاليفه وأرقام الأصول",
      "The work-order register with its cost collectors and the asset briefs",
    ),
    source(
      "accounting",
      "journal (the G-59 entries' DEBIT lines — INV-034's live GL witness per order source)",
      ["journal_entries", "journal_lines"],
      "قيود G-59 المرحّلة — شاهد INV-034 الحي",
      "The posted G-59 entries — INV-034's live witness",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "laborTotal", kind: "sum" },
      { id: "partsTotal", kind: "sum" },
      { id: "externalTotal", kind: "sum" },
      { id: "rowTotal", kind: "sum" },
    ],
    sorting: [{ by: "orderNo", dir: "desc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 300,
    invalidationEvents: ["journal.posted"],
  },
  assertions: [INV034_EXPENSE_TIE],
  drillTargets: [
    drill("assetId", "/assets/maintenance", "لوحة أوامر الصيانة", "The maintenance orders board", "assets.maintenance.view"),
  ],
  run: async (_ctx, params) => {
    const { cmmsQueries } = reportingServices();
    const locale = params.locale === "en" ? "en" : "ar";
    const allRows = await cmmsQueries.maintenanceCosts({
      assetId: params.assetId as string | undefined,
      status: params.status as string | undefined,
    });

    // The optional date window rides the engine's own createdAt stamp
    // (a pure presentation filter — never a recompute).
    const rows = allRows.filter((row) => {
      const created = row.order.createdAt.slice(0, 10);
      if (params.dateFrom !== undefined && created < params.dateFrom) return false;
      if (params.dateTo !== undefined && created > params.dateTo) return false;
      return true;
    });

    const laborTotal = CmmsQueriesSum(rows.map((row) => row.order.laborTotal));
    const partsTotal = CmmsQueriesSum(rows.map((row) => row.order.partsTotal));
    const externalTotal = CmmsQueriesSum(rows.map((row) => row.order.externalTotal));

    return {
      columns: [
        col("orderNo", "الأمر", "Order"),
        col("asset", "الأصل", "Asset"),
        col("branch", "الفرع", "Branch"),
        col("status", "الحالة", "Status", "status"),
        col("priority", "الأولوية", "Priority", "status"),
        col("problem", "المشكلة", "Problem"),
        col("createdAt", "الإنشاء", "Created", "date"),
        col("completedAt", "الإنجاز", "Completed", "date"),
        moneyCol("labor", "العمالة", "Labor"),
        moneyCol("parts", "القطع", "Parts"),
        moneyCol("external", "الخارجي", "External"),
        moneyCol("rowTotal", "الإجمالي", "Total"),
        col("journal", "قيد G-59", "G-59 entry"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.order.id,
        values: {
          orderNo: row.order.orderNo,
          asset:
            locale === "ar"
              ? `${row.assetCode} · ${row.assetNameAr ?? row.assetName}`
              : `${row.assetCode} · ${row.assetName}`,
          branch: row.branchCode,
          status: row.order.status,
          priority: row.order.priority,
          problem: locale === "ar" ? (row.order.problemAr ?? row.order.problem) : row.order.problem,
          createdAt: row.order.createdAt.slice(0, 10),
          completedAt: row.order.completedAt?.slice(0, 10) ?? "—",
          labor: row.order.laborTotal,
          parts: row.order.partsTotal,
          external: row.order.externalTotal,
          rowTotal: addExact(addExact(row.order.laborTotal, row.order.partsTotal), row.order.externalTotal),
          journal: row.order.journalEntryId === null ? "—" : "مرحّل / posted",
        },
      })),
      totals: [
        {
          id: "orders",
          kind: "sum",
          label: bilingual("عدد الأوامر", "Work orders"),
          amount: String(rows.length),
        },
        {
          id: "laborTotal",
          kind: "sum",
          label: bilingual("إجمالي العمالة", "Total labor"),
          amount: laborTotal,
        },
        {
          id: "partsTotal",
          kind: "sum",
          label: bilingual("إجمالي القطع", "Total parts"),
          amount: partsTotal,
        },
        {
          id: "externalTotal",
          kind: "sum",
          label: bilingual("إجمالي الخارجي", "Total external"),
          amount: externalTotal,
        },
        {
          id: "grandTotal",
          kind: "sum",
          label: bilingual("الإجمالي العام", "Grand total"),
          amount: addExact(addExact(laborTotal, partsTotal), externalTotal),
        },
      ],
      assertionResults: [inv034Result(rows)],
      notes: [
        bilingual(
          "الأرجل الثلاثة أرقام المحرك نفسها (مجمعات التكاليف المختومة عند الإنجاز)؛ إجمالي الصف والمطابقة مطويتان بالجمع العشري الدقيق نفسه. الشاهد الدفتري: مجموع السطور المدينة لقيود مصدرها هذا الأمر — المطابقة إلى القلس وتحجب التصدير عند الفشل (INV-034)",
          "The three legs are the engine's own figures (the totals stamped at completion); the row total and the tie fold with the same exact-decimal addition. The GL witness: Σ the DEBIT lines of the entries sourced to the order — the tie is to the cent and blocks the export on failure (INV-034)",
        ),
      ],
    };
  },
});

/** The report-plane's leg fold (addExact — the asset-register precedent). */
function CmmsQueriesSum(values: readonly string[]): string {
  return values.reduce((acc, value) => addExact(acc, value), "0.0000");
}
