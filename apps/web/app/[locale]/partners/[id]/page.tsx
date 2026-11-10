/**
 * /{locale}/partners/[id] — partner detail (generic-detail archetype): the
 * edit form (PATCH + kind change), child sections (contacts, addresses,
 * attachments), the DRAFTS-only balance card and the archive action. 404 →
 * notFound; 401 → login; reference-list 403s degrade gracefully.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { ArchiveAction } from "../../../../components/archive-action";
import { AttachmentsSection } from "../../../../components/attachments-section";
import { ErrorState } from "../../../../components/client-ui";
import { PartnerAddresses } from "../../../../components/partner-addresses";
import { PartnerBalanceCard } from "../../../../components/partner-balance-card";
import { PartnerContacts } from "../../../../components/partner-contacts";
import { PartnerForm } from "../../../../components/partner-form";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AttachmentView,
  CreditTermsRow,
  PartnerAddressRow,
  PartnerBalanceRow,
  PartnerContactRow,
  PartnerRow,
  PriceListRow,
} from "../../../../lib/api-types";
import { localizedName, localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PartnerDetailPage({
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

  const [partner, creditTerms, priceLists] = await Promise.all([
    fetchApi<PartnerRow>(`partners/partners/${id}`),
    fetchApi<readonly CreditTermsRow[]>("partners/credit-terms"),
    fetchApi<readonly PriceListRow[]>("items/price-lists?kind=SALE"),
  ]);
  if (!partner.ok && partner.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!partner.ok && partner.status === 404) {
    notFound();
  }
  if (!partner.ok) {
    const forbidden = partner.status === 403 || partner.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`partners/${id}`} title={d.navPartnersDirectory}>
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, partner.error, partner.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }
  if (
    (!creditTerms.ok && creditTerms.status === 401) ||
    (!priceLists.ok && priceLists.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const detail = partner.data;
  const [contacts, addresses, balance, attachments] = await Promise.all([
    fetchApi<readonly PartnerContactRow[]>(`partners/partners/${id}/contacts`),
    fetchApi<readonly PartnerAddressRow[]>(`partners/partners/${id}/addresses`),
    fetchApi<PartnerBalanceRow>(`partners/partners/${id}/balance`),
    fetchApi<readonly AttachmentView[]>(`partners/partners/${id}/attachments`),
  ]);
  if (
    (!contacts.ok && contacts.status === 401) ||
    (!addresses.ok && addresses.status === 401) ||
    (!balance.ok && balance.status === 401) ||
    (!attachments.ok && attachments.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const archived = detail.status === "ARCHIVED";

  return (
    <AppShell
      locale={localeValue}
      pagePath={`partners/${id}`}
      title={localizedName(detail.name, detail.nameAr, localeValue)}
    >
      <div className="flex flex-col gap-6">
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <PartnerForm
            locale={localeValue}
            mode="edit"
            partner={detail}
            creditTerms={creditTerms.ok ? creditTerms.data : []}
            priceLists={priceLists.ok ? priceLists.data : []}
          />
          <div className="flex flex-col gap-6">
            {balance.ok && <PartnerBalanceCard locale={localeValue} balance={balance.data} />}
            <div className="flex items-center justify-end">
              <ArchiveAction
                locale={localeValue}
                archiveEndpoint={`partners/partners/${id}/archive`}
                redirectTo={`/${locale}/partners`}
                disabled={archived}
                labels={{
                  button: d.partnerArchiveButton,
                  confirmTitle: d.partnerArchiveConfirmTitle,
                  confirmBody: d.partnerArchiveConfirmBody,
                  successToast: d.partnerArchivedToast,
                }}
              />
            </div>
          </div>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <PartnerContacts
            locale={localeValue}
            partnerId={id}
            rows={contacts.ok ? contacts.data : []}
          />
          <PartnerAddresses
            locale={localeValue}
            partnerId={id}
            rows={addresses.ok ? addresses.data : []}
          />
        </div>
        <AttachmentsSection
          locale={localeValue}
          issuePath={`partners/partners/${id}/attachments`}
          rows={attachments.ok ? attachments.data : []}
        />
      </div>
    </AppShell>
  );
}
