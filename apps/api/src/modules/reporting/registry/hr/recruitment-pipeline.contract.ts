import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import {
  LOCALE,
  assertDecl,
  bilingual,
  col,
  defineReport,
  drill,
  qtyCol,
  source,
} from "../kit";
import { reportingServices } from "../services";
import type { RecruitmentPipelineRow } from "./hr-queries";

/**
 * PHASE-047 (W-6, T-15 — REPORT_CATALOG §9's PHASE-047 row 2):
 * `hr.recruitment-pipeline` — the recruitment funnel as a report
 * contract: one row per vacancy with BR-088's FIXED stage ladder as
 * count columns — the aggregate view of the pipeline (how many at
 * each stage, how many hired, how many rejected), the vacancy's
 * headcount and status beside them.
 *
 * Amendment A-4's PII law holds structurally: the projection carries
 * COUNTS ONLY — the applicant's personal data (name/email/phone)
 * never crosses into the report; the attributed pipeline board stays
 * the in-app surface under hr.recruitment.view.
 *
 * The footer carries the `pipeline-stage-total-tie` block-on-fail
 * assertion: on every vacancy row, the six stage counts (the FIXED
 * ladder NEW/SCREEN/INTERVIEW/OFFER/HIRED/REJECTED) sum to exactly
 * the row's total applicant count — every applicant sits in exactly
 * one stage (the 0096 CHECK floor); a drift is a data corruption the
 * export must not launder.
 *
 * Permission `hr.recruitment.view` (matrix §3.25; REPORT_CATALOG §12
 * module-register reuse rule — the same key the /hr/recruitment
 * reads ride).
 */

const STAGE_TOTAL_TIE = assertDecl(
  "pipeline-stage-total-tie",
  "on every vacancy row the six FIXED-ladder stage counts sum to the total applicant count (each applicant in exactly one stage)",
  "مجموع مراحل السلم الثابت لا يساوي إجمالي المتقدمين — التصدير محجوب",
  "The FIXED-ladder stage counts do not sum to the total applicant count — export blocked",
  "BR-088",
);

function stageTotalTieResult(rows: readonly RecruitmentPipelineRow[]): AssertionResult {
  const offenders = rows.filter(
    (row) =>
      row.newCount + row.screenCount + row.interviewCount + row.offerCount + row.hiredCount + row.rejectedCount !==
      row.totalCount,
  );
  const ok = offenders.length === 0;
  return {
    id: "pipeline-stage-total-tie",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: ok ? "0" : String(offenders[0]!.totalCount),
      right: ok
        ? "0"
        : String(
            offenders[0]!.newCount +
              offenders[0]!.screenCount +
              offenders[0]!.interviewCount +
              offenders[0]!.offerCount +
              offenders[0]!.hiredCount +
              offenders[0]!.rejectedCount,
          ),
    },
    detail: ok
      ? undefined
      : {
          ar: `${offenders.length} وظيفة بمجموع مراحل منحرف — التصدير محجوب`,
          en: `${offenders.length} vacancy row(s) with a drifting stage sum — export blocked`,
        },
  };
}

export const hrRecruitmentPipelineContract = defineReport({
  id: "hr.recruitment-pipeline",
  version: 1,
  title: bilingual("مسار التوظيف", "Recruitment Pipeline"),
  category: "hr",
  description: bilingual(
    "مسار التوظيف التجميعي: صف لكل وظيفة شاغرة مع عدّادات السلم الثابت (جديد/فرز/مقابلة/عرض/تعيين/رفض) وحجم التوظيف وحالة الوظيفة — بيانات المتقدمين الشخصية لا تظهر إطلاقًا (قائمة عدّادات فقط)",
    "The aggregate recruitment funnel: one row per vacancy with the FIXED stage-ladder counts (new/screen/interview/offer/hired/rejected), the headcount, and the vacancy status — the applicants' personal data never appears (counts only)",
  ),
  parameters: z.object({
    vacancyId: z.string().uuid().optional(),
    status: z.enum(["OPEN", "ON_HOLD", "FILLED", "CANCELLED"]).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "hr.recruitment.view",
  dataSources: [
    source(
      "hr",
      "hrQueries.recruitmentPipeline (the per-vacancy stage folds — counts only)",
      ["vacancies", "applicants"],
      "طيّات المراحل لكل وظيفة شاغرة",
      "The per-vacancy stage folds",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: [],
  },
  assertions: [STAGE_TOTAL_TIE],
  drillTargets: [
    drill(
      "vacancyId",
      "/hr/recruitment",
      "لوحة التوظيف ومسار المتقدمين",
      "The recruitment board",
      "hr.recruitment.view",
    ),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "totalCount", kind: "sum" }],
    sorting: [{ by: "vacancyCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "sum" },
  run: async (_ctx, params) => {
    const { hr } = reportingServices();
    const rows = await hr.recruitmentPipeline({
      vacancyId: params.vacancyId,
      status: params.status,
    });

    let applicantTotal = 0;
    let hiredTotal = 0;
    for (const row of rows) {
      applicantTotal += row.totalCount;
      hiredTotal += row.hiredCount;
    }

    return {
      columns: [
        col("vacancy", "الوظيفة الشاغرة", "Vacancy"),
        col("status", "الحالة", "Status"),
        qtyCol("headcount", "حجم التوظيف", "Headcount"),
        qtyCol("newCount", "جديد", "New"),
        qtyCol("screenCount", "فرز", "Screen"),
        qtyCol("interviewCount", "مقابلة", "Interview"),
        qtyCol("offerCount", "عرض", "Offer"),
        qtyCol("hiredCount", "تعيين", "Hired"),
        qtyCol("rejectedCount", "رفض", "Rejected"),
        qtyCol("totalCount", "الإجمالي", "Total"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.vacancyId,
        values: {
          vacancy: row.vacancyCode,
          status: row.status,
          headcount: row.headcount,
          newCount: row.newCount,
          screenCount: row.screenCount,
          interviewCount: row.interviewCount,
          offerCount: row.offerCount,
          hiredCount: row.hiredCount,
          rejectedCount: row.rejectedCount,
          totalCount: row.totalCount,
        },
      })),
      totals: [
        {
          id: "applicantTotal",
          kind: "sum",
          label: bilingual("إجمالي المتقدمين", "Applicant total"),
          amount: applicantTotal.toString(),
        },
        {
          id: "hiredTotal",
          kind: "sum",
          label: bilingual("إجمالي التعيينات", "Hired total"),
          amount: hiredTotal.toString(),
        },
      ],
      assertionResults: [stageTotalTieResult(rows)],
    };
  },
});
