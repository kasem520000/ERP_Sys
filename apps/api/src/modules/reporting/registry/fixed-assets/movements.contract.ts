import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import { drillRoute, intersectBranchScope } from "../../application/scope";
import {
  ISO_DATE,
  LOCALE,
  bilingual,
  col,
  defineReport,
  drill,
  moneyCol,
  source,
} from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-026 T11 · `fixed_assets.movements` (REPORT_CATALOG §9 row 230): the
 * per-period asset movement register — acquisitions (the G-21
 * capitalization entries), revaluations (BR-044, delta to the reserve),
 * depreciation (the G-22 run entries + their INV-014 reversals as signed
 * rows) and disposals (G-23 with the mandatory gain/loss mirror) — every
 * row carrying its JOURNAL PROVENANCE from the source rows
 * (depreciation_runs / asset_disposals / asset_revaluations
 * journal_entry_id; acquisitions via the G-21 entries themselves), with a
 * drill link into the journal (permission-filtered).
 *
 * Totals per kind: acquisitions Σ cost, revaluations Σ delta, depreciation
 * Σ (net of reversals), disposals Σ proceeds + Σ signed gain/loss. A
 * depreciation row is the RUN ENTRY (the journal is the movement; its
 * per-asset lines live in the run workspace and the register) — a run
 * appears when any of its line assets is inside the branch scope, and its
 * amount stays the whole-journal total (the note says so).
 *
 * Permission `fixed_assets.reports.view`. No GL assertion here (the
 * register owns the block-on-fail ties; this is the provenance register
 * the catalog documents).
 */

const DEPRECIATION_SCOPE_NOTE = bilingual(
  "صفوف الإهلاك هي قيود التشغيل (G-22) — قيد واحد لكل فترة مالية بغض النظر عن عدد الأصول، والقيد العكسي (INV-014) صف سالب يؤرخ بتاريخه؛ يظهر التشغيل حين يكون أي أصل من سطوره داخل نطاق الفرع ويبقى المبلغ إجمالي القيد كاملاً — تفصيل الأصول في مساحة عمل التشغيل والسجل",
  "Depreciation rows are the RUN entries (G-22) — one journal per fiscal period regardless of asset count, and the INV-014 reversal is a signed row dated by its own entry; a run appears when any of its line assets is inside the branch scope and the amount stays the whole-journal total — the per-asset detail lives in the run workspace and the register",
);

const MOVEMENT_KINDS = ["ACQUISITION", "REVALUATION", "DEPRECIATION", "DISPOSAL"] as const;

type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const fixedAssetsMovementsContract = defineReport({
  id: "fixed_assets.movements",
  version: 1,
  title: bilingual("حركة الأصول", "Asset Movements"),
  category: "financial",
  description: bilingual(
    "حركة الأصول الثابتة في فترة: الاقتناءات وإعادات التقييم وتشغيلات الإهلاك (وعكوسها) والاستبعادات — كل صف بمرجعه المحاسبي (رقم القيد ومعرّفه من صفوف المصدر عبر محرك الترحيل) مع الإجماليات لكل نوع",
    "Fixed-asset movements in a window: acquisitions, revaluations, depreciation runs (and their reversals) and disposals — every row with its journal provenance (entry no + id from the source rows via the posting engine) and totals per kind",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    branchIds: z.array(z.string().uuid()).nullish(),
    movementKind: z.enum(MOVEMENT_KINDS).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "fixed_assets.reports.view",
  dataSources: [
    source(
      "fixed_assets",
      "fixedAssetsQueries.assetMovements (the posted movement register)",
      ["depreciation_runs", "asset_disposals", "asset_revaluations", "assets", "asset_categories"],
      "التشغيلات والاستبعادات وإعادات التقييم مع الأصول وفئاتها",
      "Runs, disposals and revaluations with their assets and categories",
    ),
    source(
      "accounting",
      "journal (the engine entries — provenance per row)",
      ["journal_entries", "journal_lines"],
      "قيود المحرك لكل حركة (G-21/G-22/G-23 وإعادة التقييم والعكس)",
      "The engine entries behind every movement (G-21/G-22/G-23 + revaluation + reversals)",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "forbidden", branches: "optional" },
  drillTargets: [
    drill(
      "journalEntryNo",
      "/{locale}/accounting/journals/{journalEntryId}",
      "القيد المحاسبي",
      "Journal entry",
      "accounting.journals.read",
    ),
  ],
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "amount", kind: "sum" }],
    sorting: [{ by: "date", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "journal.reversed"],
  },
  assertions: [],
  run: async (ctx, params) => {
    const { fixedAssets } = reportingServices();
    const scope = intersectBranchScope(ctx, params);
    const rows = await fixedAssets.assetMovements({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: scope.branchIds,
      kind: params.movementKind ?? null,
    });

    const totals: Record<MovementKind, { count: number; amount: string }> = {
      ACQUISITION: { count: 0, amount: "0.0000" },
      REVALUATION: { count: 0, amount: "0.0000" },
      DEPRECIATION: { count: 0, amount: "0.0000" },
      DISPOSAL: { count: 0, amount: "0.0000" },
    };
    let disposalGainLossTotal = "0.0000";
    for (const row of rows) {
      const bucket = totals[row.kind];
      bucket.count += 1;
      bucket.amount = addExact(bucket.amount, row.amount);
      if (row.kind === "DISPOSAL" && row.gainLoss !== null) {
        disposalGainLossTotal = addExact(disposalGainLossTotal, row.gainLoss);
      }
    }

    return {
      columns: [
        col("date", "التاريخ", "Date", "date"),
        col("kind", "النوع", "Kind", "status"),
        col("assetCode", "الأصل", "Asset"),
        col("category", "الفئة", "Category"),
        col("branch", "الفرع", "Branch"),
        moneyCol("amount", "المبلغ", "Amount"),
        moneyCol("proceeds", "المتحصلات", "Proceeds"),
        moneyCol("netBookValue", "صافي القيمة", "NBV"),
        moneyCol("gainLoss", "الربح/(الخسارة)", "Gain/(loss)"),
        moneyCol("delta", "فرق إعادة التقييم", "Revaluation delta"),
        moneyCol("newGrossValue", "القيمة الإجمالية الجديدة", "New gross"),
        col("assetCount", "عدد الأصول", "Assets", "text", true),
        col("docNo", "المرجع", "Reference"),
        col("journalEntryNo", "القيد", "Journal entry"),
        col("isReversal", "عكس", "Reversal", "status"),
      ],
      groups: [],
      rows: rows.map((row) => {
        const drillLinks: { label: { ar: string; en: string }; route: string }[] = [];
        const route = drillRoute(
          ctx,
          `/${params.locale}/accounting/journals/${row.journalEntryId}`,
          "accounting.journals.read",
        );
        if (route !== null) {
          drillLinks.push({
            label: bilingual("القيد المحاسبي", "Journal entry"),
            route,
          });
        }
        return {
          key: `${row.journalEntryId}:${row.kind}:${row.assetCode ?? ""}`,
          values: {
            date: row.date,
            kind: row.kind,
            assetCode: row.assetCode,
            category: row.categoryCode,
            branch: row.branchCode,
            amount: row.amount,
            proceeds: row.proceeds,
            netBookValue: row.netBookValue,
            gainLoss: row.gainLoss,
            delta: row.delta,
            newGrossValue: row.newGrossValue,
            assetCount: row.assetCount,
            docNo: row.docNo,
            journalEntryNo: row.journalEntryNo,
            isReversal: row.isReversal ? "true" : "false",
          },
          drillLinks,
        };
      }),
      totals: [
        {
          id: "acquisitionCount",
          kind: "sum",
          label: bilingual("عدد الاقتناءات", "Acquisitions"),
          amount: String(totals.ACQUISITION.count),
        },
        {
          id: "acquisitionTotal",
          kind: "sum",
          label: bilingual("إجمالي الاقتناءات (التكلفة)", "Total acquisitions (cost)"),
          amount: totals.ACQUISITION.amount,
        },
        {
          id: "revaluationCount",
          kind: "sum",
          label: bilingual("عدد إعادات التقييم", "Revaluations"),
          amount: String(totals.REVALUATION.count),
        },
        {
          id: "revaluationTotal",
          kind: "sum",
          label: bilingual("إجمالي فروق إعادة التقييم", "Total revaluation deltas"),
          amount: totals.REVALUATION.amount,
        },
        {
          id: "depreciationCount",
          kind: "sum",
          label: bilingual("عدد قيود الإهلاك", "Depreciation entries"),
          amount: String(totals.DEPRECIATION.count),
        },
        {
          id: "depreciationTotal",
          kind: "sum",
          label: bilingual("إجمالي الإهلاك (صافي العكوس)", "Total depreciation (net of reversals)"),
          amount: totals.DEPRECIATION.amount,
        },
        {
          id: "disposalCount",
          kind: "sum",
          label: bilingual("عدد الاستبعادات", "Disposals"),
          amount: String(totals.DISPOSAL.count),
        },
        {
          id: "disposalProceedsTotal",
          kind: "sum",
          label: bilingual("إجمالي متحصلات الاستبعاد", "Total disposal proceeds"),
          amount: totals.DISPOSAL.amount,
        },
        {
          id: "disposalGainLossTotal",
          kind: "sum",
          label: bilingual("إجمالي الربح/(الخسارة)", "Total gain/(loss)"),
          amount: disposalGainLossTotal,
        },
      ],
      assertionResults: [],
      notes: [
        DEPRECIATION_SCOPE_NOTE,
        bilingual(
          "كل صف يحمل مرجعه المحاسبي من صفوف المصدر عبر محرك الترحيل (ADR-0007: لا كتابة مباشرة لدفتر الأستاذ من الأصول الثابتة) — رقم القيد في العمود ورابط القيد في التفاصيل لمن يملك صلاحية القراءة",
          "Every row carries its journal provenance from the source rows via the posting engine (ADR-0007: fixed_assets never writes the ledger directly) — the entry number in the column and the journal drill link for holders of the read permission",
        ),
      ],
    };
  },
});
