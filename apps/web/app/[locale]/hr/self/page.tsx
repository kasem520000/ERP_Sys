/**
 * /{locale}/hr/self — the employee self-service tabs (PHASE-045 T-14):
 * the OWN attendance calendar, the OWN leave world (requests + the
 * create form + the exact-decimal balances), and the OWN read-only
 * roster. The employee scope is resolved SERVER-side through the
 * identity bridge (GET hr/self/summary) — an account with no linked
 * employee file renders the honest not-linked state (the tabs never
 * load); 401 → login. The runtime grant (hr.self_service, self-scoped)
 * admits every authenticated user — the OWNERSHIP boundary is the
 * bridge, never a template key.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { Card } from "../../../../components/card";
import { HrSelfBoard } from "../../../../components/hr-self-board";
import { InfoNotice } from "../../../../components/notices";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  LeaveBalanceRow,
  LeaveTypeRow,
  SelfAttendanceRead,
  SelfLeaveRequestsPage,
  SelfRosterPage,
  SelfSummary,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export default async function HrSelfPage({
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

  const summary = await fetchApi<SelfSummary>("hr/self/summary");
  if (!summary.ok && summary.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!summary.ok) {
    const forbidden = summary.status === 403 || summary.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, summary.error, summary.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (summary.data.employee === null) {
    // THE HONEST NOT-LINKED STATE: the account is nobody's employee in
    // this tenant (the field workforce / a pure back-office user) — the
    // self-service surfaces have no identity to resolve.
    content = (
      <Card title={d.hrSelfNotLinkedTitle}>
        <InfoNotice>{d.hrSelfNotLinkedBody}</InfoNotice>
      </Card>
    );
  } else {
    // The default windows: the running month for the attendance
    // calendar, the trailing two weeks for the roster, and the running
    // calendar year for the leave world (the API's own pagination
    // defaults carry the page sizes).
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const monthFrom = `${today.slice(0, 7)}-01`;
    const attendanceFrom = DATE_RE.test(monthFrom) ? monthFrom : `${year}-01-01`;
    const rosterFrom = addDaysIso(today, -13);

    const [attendance, types, balances, requests, roster] = await Promise.all([
      fetchApi<SelfAttendanceRead>(
        `hr/self/attendance?from=${attendanceFrom}&to=${today}`,
      ),
      fetchApi<readonly LeaveTypeRow[]>("hr/self/leave/types"),
      fetchApi<readonly LeaveBalanceRow[]>(`hr/self/leave/balances?year=${year}`),
      fetchApi<SelfLeaveRequestsPage>(
        `hr/self/leave/requests?from=${year}-01-01&to=${year}-12-31&pageSize=25`,
      ),
      fetchApi<SelfRosterPage>(`hr/self/roster?from=${rosterFrom}&to=${today}&pageSize=25`),
    ]);
    if (
      (!attendance.ok && attendance.status === 401) ||
      (!types.ok && types.status === 401) ||
      (!balances.ok && balances.status === 401) ||
      (!requests.ok && requests.status === 401) ||
      (!roster.ok && roster.status === 401)
    ) {
      redirect(`/${locale}/login`);
    }

    if (!attendance.ok) {
      const forbidden = attendance.status === 403 || attendance.error.code === "FORBIDDEN";
      content = (
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, attendance.error, attendance.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      );
    } else {
      content = (
        <HrSelfBoard
          locale={localeValue}
          employee={summary.data.employee}
          today={today}
          initialAttendance={attendance.data}
          initialRequests={
            requests.ok
              ? requests.data
              : {
                  employee: attendance.data.employee,
                  rows: [],
                  page: 1,
                  pageSize: 25,
                  total: 0,
                  hasMore: false,
                }
          }
          initialTypes={types.ok ? types.data : []}
          initialBalances={balances.ok ? balances.data : []}
          initialRoster={
            roster.ok
              ? roster.data
              : {
                  employee: attendance.data.employee,
                  from: rosterFrom,
                  to: today,
                  rows: [],
                  page: 1,
                  pageSize: 25,
                  total: 0,
                  hasMore: false,
                }
          }
        />
      );
    }
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/self" title={d.hrSelfTitle}>
      {content}
    </AppShell>
  );
}
