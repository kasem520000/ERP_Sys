/**
 * /{locale}/settings/tax/codes — the tax codes manager (requires
 * tax.codes.manage for every route — the list, create, archive and the
 * resolve preview are one permission family). The jurisdiction packs load
 * best-effort (they gate on tax.returns.view) so the country select stays
 * optional; the list itself works without it.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { TaxCodes } from "../../../../../components/tax-codes";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { JurisdictionPackRow, TaxCodeRow } from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function TaxCodesPage({
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

  const [codes, packs] = await Promise.all([
    fetchApi<readonly TaxCodeRow[]>("tax/tax-codes"),
    fetchApi<readonly JurisdictionPackRow[]>("tax/packs"),
  ]);
  if (!codes.ok && codes.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!codes.ok) {
    const forbidden = codes.status === 403 || codes.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, codes.error, codes.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <TaxCodes locale={localeValue} initialCodes={codes.data} packs={packs.ok ? packs.data : []} />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="settings/tax/codes" title={d.taxCodesTitle}>
      {content}
    </AppShell>
  );
}
