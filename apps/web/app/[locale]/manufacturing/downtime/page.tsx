/**
 * /{locale}/manufacturing/downtime — the downtime log (PHASE-042 T-11,
 * M-15/M-16, matrix §3.20): the reason-coded record list with the
 * work-center + date-window filters (server-refetched), the close-open-
 * record action, the posting-off policy note (BR-070 — record-only by
 * default), and the OEE panel (the daily/period work-center views with
 * the availability × performance × quality legs). Downtime records are
 * the primary resource — 403 renders the forbidden state; the work
 * centers/orders/OEE pools degrade to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingDowntimeLog } from "../../../../components/manufacturing-downtime-log";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  DowntimeRecordRow,
  OeeDailyRow,
  ProductionOrderRow,
  WorkCenterRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingDowntimePage({
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

  const [downtime, workCenters, orders, oee] = await Promise.all([
    fetchApi<readonly DowntimeRecordRow[]>("manufacturing/downtime?limit=200"),
    fetchApi<readonly WorkCenterRow[]>("manufacturing/work-centers?limit=200"),
    fetchApi<readonly ProductionOrderRow[]>("manufacturing/production-orders?limit=200"),
    // The OEE daily view (degrades to empty when oee.read is absent).
    fetchApi<readonly OeeDailyRow[]>("manufacturing/oee?granularity=daily&limit=500"),
  ]);
  if (!downtime.ok && downtime.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!downtime.ok) {
    const forbidden = downtime.status === 403 || downtime.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, downtime.error, downtime.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ManufacturingDowntimeLog
        locale={localeValue}
        initialRows={downtime.data}
        workCenters={workCenters.ok ? workCenters.data : []}
        orders={orders.ok ? orders.data : []}
        initialOee={oee.ok ? oee.data : []}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/downtime"
      title={d.mfgDowntimeTitle}
    >
      {content}
    </AppShell>
  );
}
