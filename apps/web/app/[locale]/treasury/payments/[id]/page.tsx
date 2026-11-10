/**
 * /{locale}/treasury/payments/[id] — payment detail (document-detail
 * archetype): mirror of the receipt detail with the AP allocation editor;
 * lifecycle actions gated by purchasing.payments.* permissions.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { TreasuryDocDetail } from "../../../../../components/treasury-doc-detail";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  CashAccountRow,
  CurrentSession,
  PartnerRow,
  TreasuryDocRow,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const [payment, cashAccounts, partners, session] = await Promise.all([
    fetchApi<TreasuryDocRow>(`treasury/payments/${id}`),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (!payment.ok && payment.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!payment.ok) {
    const forbidden = payment.status === 403 || payment.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, payment.error, payment.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <TreasuryDocDetail
        locale={localeValue}
        kind="payments"
        side="AP"
        doc={payment.data}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        partners={partners.ok ? partners.data : []}
        canSubmit={permissions.includes("purchasing.payments.create")}
        canApprove={permissions.includes("purchasing.payments.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath={`treasury/payments/${id}`} title={d.treasuryDocDetailTitle}>
      {content}
    </AppShell>
  );
}
