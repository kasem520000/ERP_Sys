/**
 * /{locale}/manufacturing/work-centers — the shop-floor capacity + rate
 * registry (PHASE-042 T-10, matrix §3.20): the list with status badges and
 * the capacity/rate columns, the create dialog (code shape, bilingual
 * names, per-shift capacity, shifts/day, fixed/variable cost rates), the
 * guarded PATCH edit, and the activate/deactivate flip (the two INACTIVE
 * guards — ACTIVE-routing references and live operations — surface as the
 * typed WORK_CENTER_IN_USE error). Work centers are the primary resource —
 * 403 renders the forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingWorkCenters } from "../../../../components/manufacturing-work-centers";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { WorkCenterRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingWorkCentersPage({
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

  const workCenters = await fetchApi<readonly WorkCenterRow[]>(
    "manufacturing/work-centers?limit=200",
  );
  if (!workCenters.ok && workCenters.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!workCenters.ok) {
    const forbidden = workCenters.status === 403 || workCenters.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, workCenters.error, workCenters.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = <ManufacturingWorkCenters locale={localeValue} initialRows={workCenters.data} />;
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/work-centers"
      title={d.mfgWcTitle}
    >
      {content}
    </AppShell>
  );
}
