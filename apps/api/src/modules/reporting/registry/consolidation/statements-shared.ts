import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual } from "../kit";
import type { ConsolidatedStatementSource } from "./consolidation-queries";

/**
 * PHASE-034 T8 · the shared consolidated-statement contract pieces: the
 * INV-026 headline assertion (REPORT_CATALOG §10 note — every consolidated
 * statement carries it in the footer and BLOCKS EXPORTS on failure), the
 * group-view labeling note (consolidated statements never replace member
 * statutory books — ADR-0018 consequences), and the shared parameter
 * schema (fiscal period + group + the elimination toggle).
 */

/** THE INV-026 headline assertion declaration (block-on-fail). */
export const INV026_ASSERTION = assertDecl(
  "inv026-consolidated-equals-members-minus-eliminations",
  "consolidated == Σ member statements (group currency, dated FX) − eliminations, line-by-line vs the run snapshot",
  "القوائم الموحدة لا تساوي مجموع قوائم الشركات (بعملة المجموعة وبأسعار الصرف المؤرخة) ناقص قيود الاستبعاد — خطاً بخط",
  "Consolidated statements do not equal Σ member statements (group currency, dated FX) − eliminations — line-by-line",
  "INV-026",
);

/** The TB balance assertion (FINANCIAL_REPORT_RULES §3, tolerance 0). */
export const TB_BALANCE_ASSERTION = assertDecl(
  "tb-debits-equal-credits",
  "Σ consolidated debits == Σ consolidated credits (tolerance 0)",
  "غير متوازن: المدين لا يساوي الدائن في الميزان الموحد",
  "Unbalanced: total debits do not equal total credits in the consolidated trial balance",
);

/** The group-view labeling note (every output carries it). */
export const GROUP_VIEW_NOTE = bilingual(
  "قوائم المجموعة — عرض موحد لأغراض التوحيد فقط، لا تحل محل الدفاتر النظامية لأي شركة (ADR-0018): القائمة = مجموع قوائم الشركات (بعملة المجموعة وبأسعار الصرف المؤرخة المخزنة INV-008) ناقص قيود الاستبعاد (INV-026)، وتُقرأ من لقطة تشغيل التوحيد المكتمل لا من الدفاتر الحية",
  "Group view — a consolidated presentation for consolidation purposes only; it never replaces any member's statutory books (ADR-0018): the statement = Σ member statements (group currency, dated stored FX per INV-008) − eliminations (INV-026), read from the completed run's snapshot, never from live books",
);

/** The FX method note (the OQ-V2-2 decision, surfaced per statement). */
export const FX_METHOD_NOTE = bilingual(
  "الترجمة بأسعار صرف مؤرخة مخزنة (INV-008 — لا يعاد حساب السعر أبداً) وفق طريقة المجموعة المُعلنة؛ الطريقة الافتراضية CLOSING_RATE وفق قرار OQ-V2-2 (DR-P34-FX-1 المُعدّل لـ DR-006 §4)",
  "Translation at dated stored rates (INV-008 — the rate is never recomputed) under the group's declared method; the default is CLOSING_RATE per the OQ-V2-2 decision (DR-P34-FX-1 amending DR-006 §4)",
);

/** The BR-056 note (member periods must be closed). */
export const BR056_NOTE = bilingual(
  "لا يُوحَّد أي شركة ذات فترة مالية مفتوحة (BR-056): فترات جميع الشركات مغلقة عند التشغيل — التحقق مزدوج عند الإنشاء وعند القراءة",
  "No member with an OPEN fiscal period is consolidated (BR-056): all member periods were closed at the run — verified twice, at creation and at read time",
);

/** The shared statement parameter schema (REPORT_CATALOG §10 shapes). */
export const statementParams = z.object({
  groupId: z.string().uuid(),
  fiscalPeriodId: z.string().uuid(),
  asOf: ISO_DATE.optional(),
  /** The elimination toggle (the TB/BS catalog rows): when false the
   * statement renders the PRE-elimination Σ members view (the note says
   * so — INV-026 still reconciles: eliminations subtract to zero). */
  includeEliminations: z.boolean().optional().default(true),
  locale: LOCALE,
});

/** The INV-026 assertion RESULT (the render-time line-by-line re-check). */
export function inv026Result(source: ConsolidatedStatementSource): AssertionResult {
  const ok = source.inv026.status === "PASS";
  return {
    id: "inv026-consolidated-equals-members-minus-eliminations",
    status: ok ? "PASS" : "FAIL",
    compared: source.inv026.compared,
    detail: ok
      ? undefined
      : {
          ar: `انحراف INV-026 على التشغيل ${source.runId}: ${source.inv026.brokenLines.slice(0, 5).join("؛ ")}${source.inv026.brokenLines.length > 5 ? "…" : ""}`,
          en: `INV-026 drift on run ${source.runId}: ${source.inv026.brokenLines.slice(0, 5).join("; ")}${source.inv026.brokenLines.length > 5 ? "…" : ""}`,
        },
  };
}

/** The TB-balance assertion result. */
export function tbBalanceResult(source: ConsolidatedStatementSource): AssertionResult {
  const ok = source.tbBalance.status === "PASS";
  return {
    id: "tb-debits-equal-credits",
    status: ok ? "PASS" : "FAIL",
    compared: { left: source.tbBalance.debit, right: source.tbBalance.credit },
  };
}
