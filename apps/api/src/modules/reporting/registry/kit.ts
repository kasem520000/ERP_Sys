import { z } from "zod";

import type {
  AssertionDecl,
  Bilingual,
  DataSourceDecl,
  DrillTargetDecl,
  ReportCategory,
  ReportColumn,
  ReportContent,
  ReportContract,
  ReportParams,
  RunContext,
} from "../application/contract";

/**
 * PHASE-013 · contract authoring kit: compact helpers so each contract is
 * a declarative module (REPORT_CONTRACT §1) with its executable `run()`.
 * The kit fills the invariant defaults (localization, posted-rates,
 * tenant scope) so a contract file states only what varies.
 */

export function bilingual(ar: string, en: string): Bilingual {
  return { ar, en };
}

export const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
export const ISO_DATETIME = z.string().min(10);
export const LOCALE = z.enum(["ar", "en"]).default("ar");

export const dateRangeParams = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
};

export const baseParams = {
  locale: LOCALE,
  zeroSuppression: z.boolean().optional().default(true),
};

export function col(
  id: string,
  ar: string,
  en: string,
  type: ReportColumn["type"] = "text",
  numeric = false,
  widthHint?: number,
): ReportColumn {
  return { id, label: bilingual(ar, en), type, numeric, widthHint };
}

export function moneyCol(id: string, ar: string, en: string, widthHint?: number): ReportColumn {
  return col(id, ar, en, "money", true, widthHint);
}

export function qtyCol(id: string, ar: string, en: string): ReportColumn {
  return col(id, ar, en, "qty", true);
}

export function assertDecl(
  id: string,
  check: string,
  ar: string,
  en: string,
  invariant?: string,
): AssertionDecl {
  return { id, check, onFailure: "block-export", message: bilingual(ar, en), invariant };
}

export function source(
  module: DataSourceDecl["module"],
  service: string,
  tables: readonly string[],
  ar: string,
  en: string,
): DataSourceDecl {
  return { module, service, tables, purpose: bilingual(ar, en) };
}

export function drill(
  from: string,
  route: string,
  ar: string,
  en: string,
  permission: string,
): DrillTargetDecl {
  return { from, route, label: bilingual(ar, en), permission };
}

/** The §11 minimum financial assertion messages (FINANCIAL_REPORT_RULES). */
export const FINANCIAL_ASSERTION_MESSAGES = {
  "tb-debits-equal-credits": bilingual(
    "غير متوازن: المدين لا يساوي الدائن",
    "Unbalanced: total debits do not equal total credits",
  ),
  "tb-closing-net-zero": bilingual(
    "صافي الأرصدة الختامية ليس صفراً",
    "Net closing balances are not zero",
  ),
  "gl-entry-balance": bilingual(
    "يوجد قيود غير متوازنة في الفترة",
    "Some entries in the period are unbalanced",
  ),
  "is-tb-tie": bilingual(
    "قائمة الدخل لا تطابق حركات ميزان المراجعة",
    "Income statement does not tie to trial-balance movements",
  ),
  "bs-tb-tie": bilingual(
    "قائمة المركز المالي لا تطابق أرصدة ميزان المراجعة",
    "Balance sheet does not tie to trial-balance closings",
  ),
  "bs-current-year-once": bilingual(
    "نتيجة السنة الجارية محتسبة مرتين أو غير محتسبة",
    "Current-year result is double-counted or missing",
  ),
  "is-net-equals-bs-current-result": bilingual(
    "صافي الدخل لا يساوي بند نتيجة السنة الجارية",
    "Net income does not equal the balance-sheet current-year line",
  ),
  "cf-cash-tie": bilingual(
    "صافي التغير المحسوب لا يطابق التغير الفعلي في النقدية",
    "Computed net change does not tie to the actual cash delta",
  ),
} as const;

/**
 * A report contract with the kit defaults applied. Categories, permissions,
 * data sources, aggregation, drill, assertions, and the run() stay
 * contract-specific — everything else is the frozen invariant surface.
 */
export function defineReport(input: {
  id: string;
  version: number;
  title: Bilingual;
  category: ReportCategory;
  description: Bilingual;
  parameters: z.ZodType<ReportParams>;
  requiredPermission: string;
  dataSources: readonly DataSourceDecl[];
  assertions: readonly AssertionDecl[];
  drillTargets?: readonly DrillTargetDecl[];
  executionClass?: "inline" | "job";
  exportFormats?: readonly ("pdf" | "xlsx" | "csv")[];
  printTemplate?: "a4-report" | "a4-document";
  freshness?: { semantics: "as-of" | "current"; cacheTtlSeconds: number; invalidationEvents?: readonly string[] };
  scopeRules?: Partial<ReportContract["scopeRules"]>;
  aggregation?: Partial<ReportContract["aggregation"]>;
  totals?: Partial<ReportContract["totals"]>;
  currencyPresentation?: "base" | "document" | "both";
  run: (ctx: RunContext, params: ReportParams) => Promise<ReportContent>;
}): ReportContract {
  return {
    id: input.id,
    version: input.version,
    title: input.title,
    category: input.category,
    description: input.description,
    parameters: input.parameters,
    scopeRules: {
      tenant: true,
      branches: input.scopeRules?.branches ?? "optional",
      warehouses: input.scopeRules?.warehouses,
      costCenters: input.scopeRules?.costCenters,
      dateRange: input.scopeRules?.dateRange ?? "required",
      asOf: input.scopeRules?.asOf ?? "optional",
    },
    requiredPermission: input.requiredPermission,
    currencyHandling: {
      presentation: input.currencyPresentation ?? "base",
      method: "posted-rates",
    },
    dataSources: input.dataSources,
    aggregation: {
      groupBy: input.aggregation?.groupBy ?? [],
      measures: input.aggregation?.measures ?? [{ id: "amount", kind: "sum" }],
      sorting: input.aggregation?.sorting ?? [],
      zeroSuppression: input.aggregation?.zeroSuppression ?? "rows",
    },
    totals: {
      rowTotals: input.totals?.rowTotals ?? false,
      grandTotals: input.totals?.grandTotals ?? "sum",
      subTotalsByGroup: input.totals?.subTotalsByGroup ?? false,
    },
    drillTargets: input.drillTargets ?? [],
    exportFormats: input.exportFormats ?? ["pdf", "xlsx", "csv"],
    printTemplate: input.printTemplate ?? "a4-report",
    localization: { numerals: "western", direction: "per-run-locale", labels: "registry-bilingual" },
    freshness: {
      semantics: input.freshness?.semantics ?? "as-of",
      cacheTtlSeconds: input.freshness?.cacheTtlSeconds ?? 3600,
      invalidationEvents:
        input.freshness?.invalidationEvents ?? ["journal.posted", "journal.reversed", "period.locked"],
    },
    assertions: input.assertions,
    executionClass: input.executionClass ?? "inline",
    run: input.run,
  };
}
