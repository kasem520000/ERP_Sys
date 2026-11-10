/**
 * /{locale}/reports/vat-return — the VAT return workspace (requires
 * tax.returns.view for the list; create/prepare/export need
 * tax.returns.prepare and filing needs tax.returns.mark_filed — passed
 * down as canPrepare/canMarkFiled and enforced server-side on every
 * route). The jurisdiction packs load best-effort for the country select.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { VatReturn } from "../../../../components/vat-return";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, JurisdictionPackRow, VatReturnRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function VatReturnPage({
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

  const [returns, packs, session] = await Promise.all([
    fetchApi<readonly VatReturnRow[]>("tax/vat-returns"),
    fetchApi<readonly JurisdictionPackRow[]>("tax/packs"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (!returns.ok && returns.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!returns.ok) {
    const forbidden = returns.status === 403 || returns.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, returns.error, returns.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <VatReturn
        locale={localeValue}
        initialReturns={returns.data}
        packs={packs.ok ? packs.data : []}
        canPrepare={permissions.includes("tax.returns.prepare")}
        canMarkFiled={permissions.includes("tax.returns.mark_filed")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="reports/vat-return" title={d.vatReturnTitle}>
      {content}
    </AppShell>
  );
}
