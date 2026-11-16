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
import type { LeaveBalanceRow } from "./hr-queries";

/**
 * PHASE-045 T-16 (REPORT_CATALOG §9's PHASE-045 row 2):
 * `hr.leave-balances` — the per-year balance register as a report
 * contract: one row per (employee, type, year) cell — entitlement,
 * carried-forward, used, the SQL-computed remaining, and the PENDING
 * request days (the reviewer's uncommitted-span visibility; PENDING
 * never charges a cell).
 *
 * The footer carries the `leave-inv031-balance-cap` block-on-fail
 * assertion: used ≤ entitlement + carried-forward on EVERY cell —
 * INV-031's balance law, asserted at render time over the rows the
 * report ships (the approve-boundary enforcement is the writer's law;
 * this is the reader's independent re-check — a violation is a data
 * corruption the export must not launder).
 *
 * Permission `hr.leave` (matrix §3.23; REPORT_CATALOG §12
 * module-register reuse rule — the same key the /hr/leave routes ride).
 */

const BALANCE_CAP = assertDecl(
  "leave-inv031-balance-cap",
  "used days never exceed entitlement + carried-forward on any cell (INV-031's balance law)",
  "أيام مستخدمة تتجاوز الاستحقاق المرحَّل (خرق قانون الأرصدة INV-031) — التصدير محجوب",
  "Used days exceed entitlement + carried-forward (INV-031's balance law) — export blocked",
  "INV-031",
);

/** Exact 2dp decimal comparison on day strings (never float). */
function dayToMinor(value: string): bigint {
  const neg = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const minor = BigInt(int) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0"));
  return neg ? -minor : minor;
}

function balanceCapResult(rows: readonly LeaveBalanceRow[]): AssertionResult {
  const offenders = rows.filter(
    (row) => dayToMinor(row.usedDays) > dayToMinor(row.entitlementDays) + dayToMinor(row.carriedForwardDays),
  );
  const ok = offenders.length === 0;
  return {
    id: "leave-inv031-balance-cap",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: ok ? "0" : offenders[0]!.usedDays,
      right: ok
        ? "0"
        : `${offenders[0]!.entitlementDays}+${offenders[0]!.carriedForwardDays}`,
    },
    detail: ok
      ? undefined
      : {
          ar: `${offenders.length} خلية تتجاوز السقف — التصدير محجوب`,
          en: `${offenders.length} cell(s) over the cap — export blocked`,
        },
  };
}

function addDays2dp(a: string, b: string): string {
  const S = dayToMinor(a) + dayToMinor(b);
  const neg = S < 0n;
  const digits = (neg ? -S : S).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export const hrLeaveBalancesContract = defineReport({
  id: "hr.leave-balances",
  version: 1,
  title: bilingual("أرصدة الإجازات", "Leave Balances"),
  category: "hr",
  description: bilingual(
    "سجل أرصدة الإجازات لكل موظف/نوع/سنة: الاستحقاق والمرحَّل والمستخدم والمتبقي مع أيام الطلبات المعلقة — يحمل فحص سقف INV-031 الذي يمنع التصدير عند الفشل",
    "The per-employee/type/year leave balance register: entitlement, carried-forward, used, and remaining with the pending request days — carrying the INV-031 cap check that blocks exports on failure",
  ),
  parameters: z.object({
    year: z.number().int().min(2000).max(2999),
    employeeId: z.string().uuid().optional(),
    leaveTypeId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "hr.leave",
  dataSources: [
    source(
      "hr",
      "hrQueries.leaveBalances (the per-year balance cells + the pending spans)",
      ["leave_balances", "leave_types", "leave_requests"],
      "خلايا الأرصدة السنوية مع الطلبات المعلقة",
      "The per-year balance cells with the pending request spans",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: [],
  },
  assertions: [BALANCE_CAP],
  drillTargets: [
    drill(
      "employeeId",
      "/hr/leave",
      "لوحة الإجازات والأرصدة",
      "The leave requests + balances board",
      "hr.leave",
    ),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "remainingDays", kind: "balance" }],
    sorting: [{ by: "employeeCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "sum" },
  run: async (_ctx, params) => {
    const { hr } = reportingServices();
    const rows = await hr.leaveBalances({
      year: params.year as number,
      employeeId: params.employeeId,
      leaveTypeId: params.leaveTypeId,
    });
    const locale = params.locale === "en" ? "en" : "ar";

    let entitlementTotal = "0.00";
    let carriedTotal = "0.00";
    let usedTotal = "0.00";
    let remainingTotal = "0.00";
    for (const row of rows) {
      entitlementTotal = addDays2dp(entitlementTotal, row.entitlementDays);
      carriedTotal = addDays2dp(carriedTotal, row.carriedForwardDays);
      usedTotal = addDays2dp(usedTotal, row.usedDays);
      remainingTotal = addDays2dp(remainingTotal, row.remainingDays);
    }

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("leaveType", "نوع الإجازة", "Leave type"),
        col("year", "السنة", "Year"),
        qtyCol("entitlementDays", "الاستحقاق", "Entitlement"),
        qtyCol("carriedForwardDays", "المرحَّل", "Carried fwd"),
        qtyCol("usedDays", "المستخدم", "Used"),
        qtyCol("remainingDays", "المتبقي", "Remaining"),
        qtyCol("pendingDays", "طلبات معلقة", "Pending"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.balanceId,
        values: {
          employee:
            locale === "ar"
              ? `${row.employeeCode} — ${row.employeeName}`
              : `${row.employeeCode} — ${row.employeeName}`,
          leaveType:
            locale === "ar" && row.leaveTypeNameAr !== null
              ? `${row.leaveTypeCode} — ${row.leaveTypeNameAr}`
              : `${row.leaveTypeCode} — ${row.leaveTypeName}`,
          year: row.year,
          entitlementDays: row.entitlementDays,
          carriedForwardDays: row.carriedForwardDays,
          usedDays: row.usedDays,
          remainingDays: row.remainingDays,
          pendingDays: row.pendingDays,
        },
      })),
      totals: [
        {
          id: "entitlementTotal",
          kind: "sum",
          label: bilingual("إجمالي الاستحقاق", "Entitlement total"),
          amount: entitlementTotal,
        },
        {
          id: "carriedTotal",
          kind: "sum",
          label: bilingual("إجمالي المرحَّل", "Carried-forward total"),
          amount: carriedTotal,
        },
        {
          id: "usedTotal",
          kind: "sum",
          label: bilingual("إجمالي المستخدم", "Used total"),
          amount: usedTotal,
        },
        {
          id: "remainingTotal",
          kind: "sum",
          label: bilingual("إجمالي المتبقي", "Remaining total"),
          amount: remainingTotal,
        },
      ],
      assertionResults: [balanceCapResult(rows)],
    };
  },
});
