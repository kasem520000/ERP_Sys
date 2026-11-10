/**
 * /{locale}/partners/new — partner creation (Create-Edit archetype). Fetches
 * the reference lists the form needs (credit-terms + SALE price lists — a
 * 403 on either degrades to an empty list so partners-only roles can still
 * create); the form POSTs and routes to the new record's detail page.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { ErrorState } from "../../../../components/client-ui";
import { PartnerForm } from "../../../../components/partner-form";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CreditTermsRow, PriceListRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

/** A failed reference fetch degrades to an empty list on 403 (the form keeps working with "—" options). */
function isGracefulForbidden(status: number, code: string): boolean {
  return status === 403 || code === "FORBIDDEN";
}

export default async function NewPartnerPage({
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

  // Reference lists: credit terms + SALE price lists. A 403 on either
  // degrades to an empty list (the selects show "—") — a user with
  // partners.manage but no items.view can still create partners; any other
  // failure blocks the page (the form is unusable blind).
  const [creditTerms, priceLists] = await Promise.all([
    fetchApi<readonly CreditTermsRow[]>("partners/credit-terms"),
    fetchApi<readonly PriceListRow[]>("items/price-lists?kind=SALE"),
  ]);
  if (
    (!creditTerms.ok && creditTerms.status === 401) ||
    (!priceLists.ok && priceLists.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element | null = null;
  if (
    !creditTerms.ok &&
    !isGracefulForbidden(creditTerms.status, creditTerms.error.code)
  ) {
    content = (
      <ErrorState
        title={localizedApiError(d, creditTerms.error, creditTerms.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else if (
    !priceLists.ok &&
    !isGracefulForbidden(priceLists.status, priceLists.error.code)
  ) {
    content = (
      <ErrorState
        title={localizedApiError(d, priceLists.error, priceLists.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  }
  if (content === null) {
    content = (
      <PartnerForm
        locale={localeValue}
        mode="create"
        creditTerms={creditTerms.ok ? creditTerms.data : []}
        priceLists={priceLists.ok ? priceLists.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="partners/new" title={d.navPartnersNew}>
      {content}
    </AppShell>
  );
}
