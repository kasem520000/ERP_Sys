/**
 * /{locale}/hr/leave — the leave screen (PHASE-045 T-13, PAGE_ARCHETYPES
 * §2 List+Search + §8 Settings — the payroll-runs pattern): the requests
 * register (a year window by default; status/employee/range filters +
 * pagination re-fetch through the BFF), the balances panel for a year,
 * the request-create form, the simple-approval actions (approve/reject/
 * cancel — PENDING only), the type catalog (+ create + activate/
 * deactivate), and the accrual/rollover runs. The employee directory
 * reference degrades to the requests' own employees; 403 renders the
 * honest forbidden state; 401 → login.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { HrLeaveBoard } from "../../../../components/hr-leave-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  EmployeeListRow,
  LeaveBalanceRow,
  LeaveRequestsPage,
  LeaveTypeRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function HrLeavePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  // The requests register's default window: the running calendar year
  // (the API's from/to are required — the overlap filter's range).
  const year = new Date().getUTCFullYear();
  const [requests, types, balances, employees] = await Promise.all([
    fetchApi<LeaveRequestsPage>(
      `hr/leave/requests?from=${year}-01-01&to=${year}-12-31&pageSize=25`,
    ),
    fetchApi<readonly LeaveTypeRow[]>("hr/leave/types"),
    fetchApi<readonly LeaveBalanceRow[]>(`hr/leave/balances?year=${year}`),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
  ]);
  if (
    (!requests.ok && requests.status === 401) ||
    (!types.ok && types.status === 401) ||
    (!balances.ok && balances.status === 401) ||
    (!employees.ok && employees.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!requests.ok) {
    const forbidden = requests.status === 403 || requests.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, requests.error, requests.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrLeaveBoard
        locale={localeValue}
        year={year}
        initialRequests={requests.data}
        initialTypes={types.ok ? types.data : []}
        initialBalances={balances.ok ? balances.data : []}
        employees={employees.ok ? employees.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/leave" title={d.hrLeaveTitle}>
      {content}
    </AppShell>
  );
}
