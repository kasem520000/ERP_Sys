/**
 * /{locale}/treasury/receipts/[id] — receipt detail (document-detail
 * archetype): profile summary, lifecycle actions (submit/approve/post/
 * reverse/cancel — permissions resolved server-side from the session), and
 * the AR allocation editor (PUT while DRAFT, read-only afterwards).
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

export default async function ReceiptDetailPage({
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

  const [receipt, cashAccounts, partners, session] = await Promise.all([
    fetchApi<TreasuryDocRow>(`treasury/receipts/${id}`),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (!receipt.ok && receipt.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!receipt.ok) {
    const forbidden = receipt.status === 403 || receipt.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, receipt.error, receipt.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <TreasuryDocDetail
        locale={localeValue}
        kind="receipts"
        side="AR"
        doc={receipt.data}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        partners={partners.ok ? partners.data : []}
        canSubmit={permissions.includes("sales.receipts.create")}
        canApprove={permissions.includes("sales.receipts.approve")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath={`treasury/receipts/${id}`} title={d.treasuryDocDetailTitle}>
      {content}
    </AppShell>
  );
}
