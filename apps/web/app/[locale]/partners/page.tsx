/**
 * /{locale}/partners — partner directory (requires partners.view; 403 →
 * "no permission" state). The server fetches page one (paginated envelope
 * → rows + cursor meta); the client table owns filters, debounced search
 * and cursor pagination. All mutations happen on the detail page.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { PartnersTable } from "../../../components/partners-table";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { PartnerRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

const PAGE_LIMIT = 25;

export default async function PartnersPage({
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

  const partners = await fetchApi<readonly PartnerRow[]>(
    `partners/partners?limit=${PAGE_LIMIT}`,
  );
  if (!partners.ok && partners.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!partners.ok) {
    const forbidden = partners.status === 403 || partners.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, partners.error, partners.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <PartnersTable
        locale={localeValue}
        initialRows={partners.data}
        initialHasMore={partners.meta?.hasMore ?? false}
        initialNextCursor={partners.meta?.nextCursor}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="partners" title={d.navPartnersDirectory}>
      {content}
    </AppShell>
  );
}
