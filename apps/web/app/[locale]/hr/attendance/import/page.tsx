/**
 * /{locale}/hr/attendance/import — the device-import wizard + the review
 * surface (PHASE-045 T-12, PAGE_ARCHETYPES §9 Wizard — the
 * budget-import-wizard pattern): the 3-step wizard (upload/paste CSV →
 * preview (ZERO writes) → commit) rides `hr.attendance.import`; the
 * committed-batches log + the anomaly quarantine ride `hr.attendance`
 * (the 0086 permission split). The mapping read (the wizard's defaults)
 * degrades to the forbidden note when the caller holds only the review
 * key — the review surface stays fully usable. 403 on the review primary
 * renders the honest forbidden state; 401 → login.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { HrAttendanceImport } from "../../../../../components/hr-attendance-import";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  AttendanceImportMappingRead,
  EmployeeListRow,
  ImportAnomaliesPage,
  ImportBatchesPage,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function HrAttendanceImportPage({
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

  const [batches, anomalies, mapping, employees] = await Promise.all([
    fetchApi<ImportBatchesPage>("hr/attendance/import/batches?pageSize=25"),
    fetchApi<ImportAnomaliesPage>("hr/attendance/import/anomalies?status=PENDING&pageSize=25"),
    fetchApi<AttendanceImportMappingRead>("hr/attendance/import/mapping"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
  ]);
  if (
    (!batches.ok && batches.status === 401) ||
    (!anomalies.ok && anomalies.status === 401) ||
    (!mapping.ok && mapping.status === 401) ||
    (!employees.ok && employees.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!batches.ok) {
    const forbidden = batches.status === 403 || batches.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, batches.error, batches.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrAttendanceImport
        locale={localeValue}
        initialBatches={batches.data}
        initialAnomalies={anomalies.ok ? anomalies.data : null}
        anomalyError={
          anomalies.ok
            ? null
            : {
                message: localizedApiError(d, anomalies.error, anomalies.retryAfterSeconds),
              }
        }
        mapping={mapping.ok ? mapping.data : null}
        mappingForbidden={!mapping.ok && (mapping.status === 403 || mapping.error.code === "FORBIDDEN")}
        employees={employees.ok ? employees.data : []}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="hr/attendance/import"
      title={d.hrAttendanceImportTitle}
    >
      {content}
    </AppShell>
  );
}
