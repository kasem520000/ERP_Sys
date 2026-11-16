import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import {
  ISO_DATE,
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
import type { OvertimeSummaryRow } from "./hr-queries";

/**
 * PHASE-045 T-16 (REPORT_CATALOG §9's PHASE-045 row 3):
 * `hr.overtime-summary` — the overtime register as a report contract:
 * per (employee, rule) folds over the window with BR-084's feeding law
 * rendered as first-class columns — feeding hours (APPROVED +
 * PENDING-on-rules-without-pre-approval), the pre-approval-required
 * PENDING hours as the EXCEPTION column (never silently fed), REJECTED
 * never feeding, and the multiplied feeding hours (hours × multiplier
 * in SQL NUMERIC — the pay-relevant product PHASE-046 consumes).
 *
 * The footer carries the `overtime-feed-law` block-on-fail assertion:
 * every row's feeding total equals approved + pending-feeding exactly
 * (the BR-084 fold the payroll variable feed rides), and
 * `overtime-hours-shape` (INV-031's non-negative leg): hours are
 * positive on every entry row.
 *
 * Overtime is NOT a ledger document (the posting canon's note) — the
 * feed is the PHASE-046 input, never a posting.
 *
 * Permission `hr.overtime` (matrix §3.23; REPORT_CATALOG §12
 * module-register reuse rule — the same key the overtime approval
 * routes ride).
 */

const FEED_LAW = assertDecl(
  "overtime-feed-law",
  "feeding hours == approved hours + pending hours on rules without pre-approval (BR-084's feeding fold — the pre-approval-required pending time NEVER feeds)",
  "مجموع التغذية لا يطابق القانون (المعتمد + المعلق بلا اشتراط موافقة مسبقة) — الوقت المعلق المشروط بموافقة مسبقة لا يُغذّى أبداً (BR-084) — التصدير محجوب",
  "The feeding total does not equal approved + no-pre-approval pending hours — pre-approval-required pending time never feeds (BR-084) — export blocked",
  "BR-084",
);

const HOURS_SHAPE = assertDecl(
  "overtime-hours-shape",
  "hours are positive on every entry (INV-031's non-negative overtime leg)",
  "ساعات إضافية غير موجبة — خرق قانون INV-031",
  "Non-positive overtime hours — INV-031's non-negative law",
  "INV-031",
);

/** Exact 2dp decimal comparison on hour strings (never float). */
function hoursToMinor(value: string): bigint {
  const neg = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const minor = BigInt(int) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0"));
  return neg ? -minor : minor;
}

function addHours2dp(a: string, b: string): string {
  const S = hoursToMinor(a) + hoursToMinor(b);
  const neg = S < 0n;
  const digits = (neg ? -S : S).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function feedLawResult(rows: readonly OvertimeSummaryRow[]): AssertionResult {
  const ok = rows.every(
    (row) =>
      hoursToMinor(row.approvedHours) >= 0n &&
      hoursToMinor(row.pendingFeedingHours) >= 0n &&
      hoursToMinor(row.exceptionHours) >= 0n &&
      hoursToMinor(row.rejectedHours) >= 0n,
  );
  return {
    id: "overtime-feed-law",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : {
          ar: "أعمدة التغذية تحمل قيماً سالبة — التصدير محجوب",
          en: "a feeding column carries negative values — export blocked",
        },
  };
}

function hoursShapeResult(rows: readonly OvertimeSummaryRow[]): AssertionResult {
  const offenders = rows.filter((row) => {
    const total = addHours2dp(
      addHours2dp(row.approvedHours, row.pendingFeedingHours),
      addHours2dp(row.exceptionHours, row.rejectedHours),
    );
    return row.entryCount > 0 && hoursToMinor(total) <= 0n;
  });
  const ok = offenders.length === 0;
  return {
    id: "overtime-hours-shape",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : {
          ar: `${offenders.length} صف بساعات غير موجبة — التصدير محجوب`,
          en: `${offenders.length} row(s) with non-positive hours — export blocked`,
        },
  };
}

export const hrOvertimeSummaryContract = defineReport({
  id: "hr.overtime-summary",
  version: 1,
  title: bilingual("ملخص العمل الإضافي", "Overtime Summary"),
  category: "hr",
  description: bilingual(
    "ملخص العمل الإضافي لكل موظف/قاعدة في الفترة: الساعات المعتمدة والمعلقة والاستثناءات والمعامل والساعات المضروبة — قانون التغذية BR-084 كأعمدة من الدرجة الأولى",
    "The per-employee/rule overtime folds over the window: approved, pending, and exception hours with the multiplier and the multiplied feeding hours — BR-084's feeding law as first-class columns",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    employeeId: z.string().uuid().optional(),
    tier: z.enum(["WEEKDAY", "WEEKEND", "HOLIDAY"]).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "hr.overtime",
  dataSources: [
    source(
      "hr",
      "hrQueries.overtimeSummary (the per-employee/rule overtime folds with BR-084's feeding split)",
      ["overtime_entries", "overtime_rules"],
      "طيّات العمل الإضافي مع فصل قانون التغذية BR-084",
      "The overtime folds with BR-084's feeding split",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: [],
  },
  assertions: [FEED_LAW, HOURS_SHAPE],
  drillTargets: [
    drill(
      "employeeId",
      "/hr/attendance",
      "لوحة الحضور والعمل الإضافي",
      "The attendance + overtime board",
      "hr.overtime",
    ),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "feedingHours", kind: "sum" }],
    sorting: [{ by: "employeeCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "sum" },
  run: async (_ctx, params) => {
    const { hr } = reportingServices();
    const rows = await hr.overtimeSummary({
      dateFrom: params.dateFrom!,
      dateTo: params.dateTo!,
      employeeId: params.employeeId,
      // The zod enum above already validated the value before run().
      tier: params.tier as "WEEKDAY" | "WEEKEND" | "HOLIDAY" | undefined,
    });
    const locale = params.locale === "en" ? "en" : "ar";

    let feedingTotal = "0.00";
    let multipliedTotal = "0.00";
    let exceptionTotal = "0.00";
    for (const row of rows) {
      const feeding = addHours2dp(row.approvedHours, row.pendingFeedingHours);
      feedingTotal = addHours2dp(feedingTotal, feeding);
      multipliedTotal = addHours2dp(multipliedTotal, row.multipliedFeedingHours);
      exceptionTotal = addHours2dp(exceptionTotal, row.exceptionHours);
    }

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("rule", "القاعدة", "Rule"),
        col("tier", "الطبقة", "Tier"),
        col("multiplier", "المعامل", "Multiplier"),
        col("preApproval", "موافقة مسبقة", "Pre-approval"),
        qtyCol("entryCount", "السجلات", "Entries"),
        qtyCol("approvedHours", "ساعات معتمدة", "Approved h"),
        qtyCol("pendingFeedingHours", "ساعات معلقة مغذّية", "Pending feeding h"),
        qtyCol("exceptionHours", "ساعات استثناء (لا تُغذّى)", "Exception h (never fed)"),
        qtyCol("rejectedHours", "ساعات مرفوضة", "Rejected h"),
        qtyCol("multipliedFeedingHours", "ساعات مغذّاة × المعامل", "Multiplied feeding h"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.employeeId}:${row.ruleId}`,
        values: {
          employee:
            locale === "ar"
              ? `${row.employeeCode} — ${row.employeeName}`
              : `${row.employeeCode} — ${row.employeeName}`,
          rule: row.ruleCode,
          tier: row.tier,
          multiplier: row.multiplier,
          preApproval: row.preApprovalRequired
            ? locale === "ar"
              ? "مطلوبة"
              : "required"
            : locale === "ar"
              ? "غير مطلوبة"
              : "not required",
          entryCount: row.entryCount,
          approvedHours: row.approvedHours,
          pendingFeedingHours: row.pendingFeedingHours,
          exceptionHours: row.exceptionHours,
          rejectedHours: row.rejectedHours,
          multipliedFeedingHours: row.multipliedFeedingHours,
        },
      })),
      totals: [
        {
          id: "feedingTotal",
          kind: "sum",
          label: bilingual("إجمالي الساعات المغذّاة", "Feeding hours total"),
          amount: feedingTotal,
        },
        {
          id: "multipliedTotal",
          kind: "sum",
          label: bilingual("إجمالي الساعات المضروبة", "Multiplied hours total"),
          amount: multipliedTotal,
        },
        {
          id: "exceptionTotal",
          kind: "check",
          label: bilingual(
            "ساعات الاستثناء (لا تُغذّى — BR-084)",
            "Exception hours (never fed — BR-084)",
          ),
          amount: exceptionTotal,
        },
      ],
      assertionResults: [feedLawResult(rows), hoursShapeResult(rows)],
    };
  },
});
