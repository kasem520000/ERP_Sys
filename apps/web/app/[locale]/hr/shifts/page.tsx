/**
 * /{locale}/hr/shifts — the shift templates + the roster editor grid
 * (PHASE-045 T-13, PAGE_ARCHETYPES §2 List+Search + §4 grid workspace —
 * the payroll-runs pattern): the templates register (create/edit +
 * activate/deactivate) and the date × employee roster grid for the
 * current week by default (the API's paginated read — the joint-review
 * pagination law; the client walks pages when the range changes). The
 * employee directory reference degrades to the grid's own employees;
 * 403 renders the honest forbidden state; 401 → login.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { HrShiftsBoard } from "../../../../components/hr-shifts-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { EmployeeListRow, HrShiftRow, RosterPage } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The ISO week start (Monday) — the rotation pattern's anchor. */
function weekStartIso(date: string): string {
  const utc = new Date(`${date}T00:00:00Z`);
  const day = utc.getUTCDay(); // 0=Sun..6=Sat
  const delta = day === 0 ? -6 : 1 - day;
  return addDaysIso(date, delta);
}

export default async function HrShiftsPage({
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

  // The grid's default window: the running ISO week (Monday…Sunday).
  const today = new Date().toISOString().slice(0, 10);
  const from = weekStartIso(today);
  const to = addDaysIso(from, 6);

  const [shifts, roster, employees] = await Promise.all([
    fetchApi<readonly HrShiftRow[]>("hr/shifts?limit=500"),
    fetchApi<RosterPage>(`hr/roster?from=${from}&to=${to}&pageSize=5000`),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
  ]);
  if (
    (!shifts.ok && shifts.status === 401) ||
    (!roster.ok && roster.status === 401) ||
    (!employees.ok && employees.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!shifts.ok) {
    const forbidden = shifts.status === 403 || shifts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, shifts.error, shifts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrShiftsBoard
        locale={localeValue}
        initialShifts={shifts.data}
        initialFrom={from}
        initialTo={to}
        initialCells={roster.ok ? roster.data.rows : []}
        rosterTruncated={roster.ok ? roster.data.hasMore : false}
        employees={employees.ok ? employees.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/shifts" title={d.hrShiftsTitle}>
      {content}
    </AppShell>
  );
}
