/**
 * /{locale}/hr/attendance — the daily attendance register + the exception
 * board + the back-office capture (PHASE-045 T-12, PAGE_ARCHETYPES §2
 * List+Search — the payroll-runs pattern): the register date rides the
 * ?date= deep link (default today — the server page re-fetches on change);
 * the exception board pages the is_exception rows for a window through the
 * BFF (the API's own filter vocabulary — from/to/employeeId/page). The
 * employee directory reference (payroll/employees) degrades to the
 * register's own employees — the payroll pool may sit outside the HR
 * role's scope. 403 renders the honest forbidden state; 401 → login.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { HrAttendanceBoard } from "../../../../components/hr-attendance-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AttendanceExceptionsPage,
  AttendanceRecordRow,
  EmployeeListRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The exception board's default window: the trailing week ending at the
 * register date (a quarter is the API's derivation cap — a wider window
 * is a deliberate range change). */
function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export default async function HrAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const rawDate = query.date;
  const date =
    typeof rawDate === "string" && DATE_RE.test(rawDate)
      ? rawDate
      : new Date().toISOString().slice(0, 10);

  const [register, employees] = await Promise.all([
    fetchApi<{ date: string; rows: readonly AttendanceRecordRow[] }>(
      `hr/attendance/register?date=${date}`,
    ),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
  ]);
  if (
    (!register.ok && register.status === 401) ||
    (!employees.ok && employees.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  // The exception board's first page rides the same server fetch (the
  // trailing week; filter changes re-fetch through the BFF client-side).
  const exceptionsFrom = addDaysIso(date, -6);
  const exceptions = await fetchApi<AttendanceExceptionsPage>(
    `hr/attendance/exceptions?from=${exceptionsFrom}&to=${date}&pageSize=25`,
  );
  if (!exceptions.ok && exceptions.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!register.ok) {
    const forbidden = register.status === 403 || register.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, register.error, register.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrAttendanceBoard
        locale={localeValue}
        date={date}
        registerDate={register.data.date}
        initialRows={register.data.rows}
        initialExceptions={exceptions.ok ? exceptions.data : null}
        exceptionError={
          exceptions.ok
            ? null
            : {
                forbidden:
                  exceptions.status === 403 || exceptions.error.code === "FORBIDDEN",
                message: localizedApiError(d, exceptions.error, exceptions.retryAfterSeconds),
              }
        }
        employees={employees.ok ? employees.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/attendance" title={d.hrAttendanceTitle}>
      {content}
    </AppShell>
  );
}
