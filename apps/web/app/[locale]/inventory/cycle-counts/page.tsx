/**
 * /{locale}/inventory/cycle-counts — the ABC-frequency cycle-count
 * workspace (PHASE-044 T-14): schedules (create + run-now), count
 * documents with the DRAFT→COUNTED→VARIANCE_REVIEW→POSTED lifecycle, and
 * bin-aware line entry. Requires inventory.cycle_counts (0071 matrix row).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryCycleCounts } from "../../../../components/inventory-cycle-counts";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  WarehouseRow,
  WmsCycleCountDocumentRow,
  WmsCycleCountScheduleRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryCycleCountsPage({
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

  const [schedules, documents, warehouses, session] = await Promise.all([
    fetchApi<readonly WmsCycleCountScheduleRow[]>("inventory/wms/cycle-count-schedules?limit=100"),
    fetchApi<readonly WmsCycleCountDocumentRow[]>(
      "inventory/wms/cycle-count-documents?limit=100",
    ),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!schedules.ok && schedules.status === 401) ||
    (!documents.ok && documents.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!schedules.ok) {
    const forbidden = schedules.status === 403 || schedules.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, schedules.error, schedules.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!documents.ok) {
    const forbidden = documents.status === 403 || documents.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, documents.error, documents.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventoryCycleCounts
        locale={localeValue}
        warehouses={warehouses.ok ? warehouses.data : []}
        schedules={schedules.data}
        initialDocuments={documents.data}
        canManage={permissions.includes("inventory.cycle_counts")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/cycle-counts" title={d.wmsCcTitle}>
      {content}
    </AppShell>
  );
}
