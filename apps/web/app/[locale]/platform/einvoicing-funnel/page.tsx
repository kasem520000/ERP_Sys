/**
 * PHASE-023 T10 — /{locale}/platform/einvoicing-funnel (platform ops): the
 * e-invoicing funnel dashboard from GET /api/v1/tax/einvoicing/funnel
 * (submissions by state, latency, rejection reasons, dead letters, the
 * 15-minute rejection-rate gauge — MONITORING §1 PHASE-023).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InfoNotice } from "../../../../components/notices";
import { RetryButton } from "../../../../components/retry-button";
import { EInvoicingFunnel } from "../../../../components/einvoicing-funnel";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { EInvoicingFunnelWire } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function EinvoicingFunnelPage({
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

  const funnel = await fetchApi<EInvoicingFunnelWire>("tax/einvoicing/funnel");
  if (!funnel.ok && funnel.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!funnel.ok) {
    const forbidden = funnel.status === 403 || funnel.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, funnel.error, funnel.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = <EInvoicingFunnel locale={localeValue} d={d} funnel={funnel.data} />;
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="platform/einvoicing-funnel"
      title={d.einvoicingFunnelTitle}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.einvoicingFunnelSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
