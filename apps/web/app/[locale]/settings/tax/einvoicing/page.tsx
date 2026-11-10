/**
 * PHASE-023 T10 — /{locale}/settings/tax/einvoicing (tenant admin): the
 * e-invoicing status surface — per-document submission state FROM THE
 * REGISTRY (never inferred), the adapters panel with the UNVERIFIED
 * honesty note, and certificate countdowns (tax.einvoicing.manage).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { InfoNotice } from "../../../../../components/notices";
import { RetryButton } from "../../../../../components/retry-button";
import { EInvoicingStatus } from "../../../../../components/einvoicing-status";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  EInvoicingAdapterRow,
  EInvoicingCertificateRow,
  EInvoicingSubmissionRow,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function TaxEinvoicingPage({
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

  const [submissions, adapters, certificates] = await Promise.all([
    fetchApi<readonly EInvoicingSubmissionRow[]>("tax/einvoicing/registry/submissions"),
    fetchApi<readonly EInvoicingAdapterRow[]>("tax/einvoicing/adapters"),
    fetchApi<{ certificates: readonly EInvoicingCertificateRow[] }>("tax/einvoicing/certificates"),
  ]);
  if (!submissions.ok && submissions.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!submissions.ok) {
    const forbidden = submissions.status === 403 || submissions.error.code === "FORBIDDEN";
    content = forbidden ? (
      <InfoNotice>{d.platformNoAccess}</InfoNotice>
    ) : (
      <ErrorState
        title={localizedApiError(d, submissions.error, submissions.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <EInvoicingStatus
        locale={localeValue}
        d={d}
        initialSubmissions={submissions.data}
        adapters={adapters.ok ? adapters.data : []}
        certificates={certificates.ok ? certificates.data.certificates : []}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="settings/tax/einvoicing"
      title={d.einvoicingTitle}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.einvoicingSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
