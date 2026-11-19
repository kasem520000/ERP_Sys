/**
 * /{locale}/hr/org-structure — the talent board's org family
 * (PHASE-047 T-13 + T-14's alert surfaces, PAGE_ARCHETYPES §8 — the
 * settings archetype): the cycle-safe org-unit tree + the position
 * register + the HR-10 documents & alerts plane (the tenant-wide
 * alert list + the sweep's registration surface). The first fetch
 * rides hr.org.view (a 403 renders the honest forbidden state); the
 * documents/alerts fetches degrade to null (hr.documents.manage
 * absent — the tab renders the honest no-permission notice).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { HrOrgBoard } from "../../../../components/hr-org-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  EmployeeDocumentRow,
  EmployeeListRow,
  HrAlertJobRow,
  OrgUnitRow,
  PositionRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function HrOrgStructurePage({
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

  const [units, positions, documents, alertJobs, employees] = await Promise.all([
    fetchApi<readonly OrgUnitRow[]>("hr/org/units"),
    fetchApi<readonly PositionRow[]>("hr/positions"),
    // The HR-10 plane degrades to null (hr.documents.manage absent).
    fetchApi<readonly EmployeeDocumentRow[]>("hr/documents?limit=500"),
    fetchApi<readonly HrAlertJobRow[]>("hr/alerts/expiry-sweep"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
  ]);
  if (
    (!units.ok && units.status === 401) ||
    (!positions.ok && positions.status === 401) ||
    (!documents.ok && documents.status === 401) ||
    (!alertJobs.ok && alertJobs.status === 401) ||
    (!employees.ok && employees.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!units.ok) {
    const forbidden = units.status === 403 || units.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, units.error, units.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrOrgBoard
        locale={localeValue}
        initialUnits={units.data}
        initialPositions={positions.ok ? positions.data : []}
        initialDocuments={documents.ok ? documents.data : null}
        initialAlertJob={alertJobs.ok ? (alertJobs.data[0] ?? null) : null}
        employees={employees.ok ? employees.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/org-structure" title={d.hrOrgStructureTitle}>
      {content}
    </AppShell>
  );
}
