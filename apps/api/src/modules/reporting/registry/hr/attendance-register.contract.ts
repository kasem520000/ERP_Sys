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
import { ATTENDANCE_STATUSES, type AttendanceRegisterRow } from "./hr-queries";

/**
 * PHASE-045 T-16 (REPORT_CATALOG §9's PHASE-045 row 1):
 * `hr.attendance-register` — the daily register as a report contract:
 * one row per punch session (the ABSENT markers are the (null, null)
 * sessions the derivation synthesizes), the day's derived verdict, the
 * minute facts, and the exception flag — the register board's report
 * twin over the same module-owned tables.
 *
 * Attendance is NOT a ledger document (the posting canon's note) — no
 * ledger tie exists by design; the assertions are the shape laws the
 * register renders: the six-verdict vocabulary (the T-04 derivation
 * law) and the session window shape (INV-031's interval leg — a closed
 * session runs forward with non-negative worked minutes).
 *
 * Permission `hr.attendance` (matrix §3.23; REPORT_CATALOG §12
 * module-register reuse rule — the same key the /hr/attendance routes
 * ride).
 */

const STATUS_VOCABULARY = assertDecl(
  "attendance-status-vocabulary",
  "every derived status is one of PRESENT/LATE/ABSENT/MISSING_PUNCH/HOLIDAY/ON_LEAVE (the T-04 derivation law)",
  "حالة مشتقة خارج مفردات الاشتقاق الست (PRESENT/LATE/ABSENT/MISSING_PUNCH/HOLIDAY/ON_LEAVE)",
  "A derived status outside the six-verdict derivation vocabulary",
  "INV-031",
);

const SESSION_SHAPE = assertDecl(
  "attendance-session-shape",
  "every closed session runs forward (check_in < check_out) with non-negative worked minutes (INV-031's interval leg)",
  "جلسة مغلقة معكوسة أو دقائق عمل سالبة — خرق لقانون الفترات INV-031",
  "A closed session runs backwards or carries negative worked minutes — INV-031's interval law",
  "INV-031",
);

function statusVocabularyResult(rows: readonly AttendanceRegisterRow[]): AssertionResult {
  const ok = rows.every(
    (row) => row.derivedStatus === null || (ATTENDANCE_STATUSES as readonly string[]).includes(row.derivedStatus),
  );
  return {
    id: "attendance-status-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : {
          ar: "حالة مشتقة خارج المفردات — التصدير محجوب",
          en: "a derived status outside the vocabulary — export blocked",
        },
  };
}

function sessionShapeResult(rows: readonly AttendanceRegisterRow[]): AssertionResult {
  const ok = rows.every(
    (row) =>
      row.workedMinutes === null ||
      (row.workedMinutes >= 0 &&
        (row.checkIn === null || row.checkOut === null || row.checkIn < row.checkOut)),
  );
  return {
    id: "attendance-session-shape",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : {
          ar: "جلسة معكوسة أو دقائق سالبة — التصدير محجوب",
          en: "a reversed session or negative minutes — export blocked",
        },
  };
}

export const hrAttendanceRegisterContract = defineReport({
  id: "hr.attendance-register",
  version: 1,
  title: bilingual("سجل الحضور اليومي", "Attendance Register"),
  category: "hr",
  description: bilingual(
    "سجل الحضور والانصراف لكل موظف/يوم: حالة اليوم المشتقة والوقائع الدقيقة (تأخير، مغادرة مبكرة، دقائق العمل، الإضافي) ومصدر البصمة والاستثناءات",
    "The per-employee/day attendance register: the derived daily status with the minute facts (late, early leave, worked, overtime), the punch source, and the exceptions",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    employeeId: z.string().uuid().optional(),
    status: z.enum(ATTENDANCE_STATUSES).optional(),
    exceptionsOnly: z.boolean().optional().default(false),
    locale: LOCALE,
  }),
  requiredPermission: "hr.attendance",
  dataSources: [
    source(
      "hr",
      "hrQueries.attendanceRegister (the punch sessions + the derived day verdicts)",
      ["attendance_records", "shifts", "shift_rotations"],
      "جلسات البصمة مع أحكام الأيام المشتقة من الجدول والعطل والإجازات",
      "The punch sessions with the day verdicts derived from the roster, holidays, and leaves",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: [],
  },
  assertions: [STATUS_VOCABULARY, SESSION_SHAPE],
  drillTargets: [
    drill(
      "employeeId",
      "/hr/attendance",
      "لوحة الحضور والاستثناءات",
      "The attendance + exceptions board",
      "hr.attendance",
    ),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "workedMinutes", kind: "sum" }],
    sorting: [{ by: "workDate", dir: "desc" }],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "none" },
  run: async (_ctx, params) => {
    const { hr } = reportingServices();
    const rows = await hr.attendanceRegister({
      dateFrom: params.dateFrom!,
      dateTo: params.dateTo!,
      employeeId: params.employeeId,
      // The zod enum above already validated the value before run().
      status: params.status as (typeof ATTENDANCE_STATUSES)[number] | undefined,
      exceptionsOnly: params.exceptionsOnly ?? false,
    });
    const locale = params.locale === "en" ? "en" : "ar";

    const byStatus = new Map<string, number>();
    let exceptions = 0;
    for (const row of rows) {
      if (row.derivedStatus !== null) {
        byStatus.set(row.derivedStatus, (byStatus.get(row.derivedStatus) ?? 0) + 1);
      }
      if (row.isException) exceptions += 1;
    }
    const statusCounts = ATTENDANCE_STATUSES.map(
      (status) => `${status}: ${byStatus.get(status) ?? 0}`,
    ).join(" · ");

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("workDate", "اليوم", "Date", "date"),
        col("shift", "الوردية", "Shift"),
        col("checkIn", "الحضور", "Check-in", "date"),
        col("checkOut", "الانصراف", "Check-out", "date"),
        col("source", "المصدر", "Source"),
        col("status", "الحالة المشتقة", "Derived status", "status"),
        qtyCol("lateMinutes", "دقائق التأخير", "Late min"),
        qtyCol("earlyLeaveMinutes", "دقائق المغادرة المبكرة", "Early-leave min"),
        qtyCol("workedMinutes", "دقائق العمل", "Worked min"),
        qtyCol("overtimeMinutes", "دقائق الإضافي", "Overtime min"),
        col("exception", "استثناء", "Exception", "status"),
        col("deviceRef", "الجهاز", "Device"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.recordId,
        values: {
          employee:
            locale === "ar"
              ? `${row.employeeCode} — ${row.employeeName}`
              : `${row.employeeCode} — ${row.employeeName}`,
          workDate: row.workDate,
          shift: row.shiftCode ?? "—",
          checkIn: row.checkIn ?? "—",
          checkOut: row.checkOut ?? "—",
          source: row.source,
          status: row.derivedStatus ?? "—",
          lateMinutes: row.lateMinutes ?? 0,
          earlyLeaveMinutes: row.earlyLeaveMinutes ?? 0,
          workedMinutes: row.workedMinutes ?? 0,
          overtimeMinutes: row.overtimeMinutes ?? 0,
          exception: row.isException ? "✓" : "",
          deviceRef: row.deviceRef ?? "—",
        },
      })),
      totals: [
        {
          id: "register-summary",
          label: bilingual(
            `الجلسات: ${rows.length} · الاستثناءات: ${exceptions} · ${statusCounts}`,
            `sessions: ${rows.length} · exceptions: ${exceptions} · ${statusCounts}`,
          ),
          amount: "0",
          kind: "check",
        },
      ],
      assertionResults: [statusVocabularyResult(rows), sessionShapeResult(rows)],
    };
  },
});
