/**
 * /{locale}/settings/tax/registrations — the per-jurisdiction registration
 * console (requires tax.registrations.manage on every route — the list and
 * the upsert are one RISKY, audited permission family). The jurisdiction
 * packs load best-effort (tax.returns.view) for the country select.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { TaxRegistrations } from "../../../../../components/tax-registrations";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { JurisdictionPackRow, TaxRegistrationRow } from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function TaxRegistrationsPage({
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

  const [registrations, packs] = await Promise.all([
    fetchApi<readonly TaxRegistrationRow[]>("tax/tax-registrations"),
    fetchApi<readonly JurisdictionPackRow[]>("tax/packs"),
  ]);
  if (!registrations.ok && registrations.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!registrations.ok) {
    const forbidden = registrations.status === 403 || registrations.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, registrations.error, registrations.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <TaxRegistrations
        locale={localeValue}
        initialRegistrations={registrations.data}
        packs={packs.ok ? packs.data : []}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="settings/tax/registrations"
      title={d.taxRegistrationsTitle}
    >
      {content}
    </AppShell>
  );
}
