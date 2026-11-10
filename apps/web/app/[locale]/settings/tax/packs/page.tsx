/**
 * /{locale}/settings/tax/packs — the jurisdiction pack registry + version
 * viewer (requires tax.returns.view for the reads; the staged apply needs
 * tax.codes.manage and its button is permission-gated in-screen the same
 * way the API enforces it server-side).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { TaxPacks } from "../../../../../components/tax-packs";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { CurrentSession, JurisdictionPackRow } from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function TaxPacksPage({
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

  const [packs, session] = await Promise.all([
    fetchApi<readonly JurisdictionPackRow[]>("tax/packs"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (!packs.ok && packs.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!packs.ok) {
    const forbidden = packs.status === 403 || packs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, packs.error, packs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <TaxPacks
        locale={localeValue}
        initialPacks={packs.data}
        canApply={permissions.includes("tax.codes.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="settings/tax/packs" title={d.taxPacksTitle}>
      {content}
    </AppShell>
  );
}
