/**
 * /{locale}/job-cards — the workshop job-card workspace (PHASE-017 T6, 9-a):
 * the card list (sales.job_cards.manage is the single matrix key; 403
 * renders the forbidden state) plus the supporting data for the create
 * dialog — customers (kind=CUSTOMER picker), items (STOCK parts + SERVICE
 * labor), branches, warehouses, and tax codes (optional per-line select).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { JobCards } from "../../../components/job-cards";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  JobCardRow,
  PartnerRow,
  TaxCodeRow,
  WarehouseRow,
} from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function JobCardsPage({
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

  const [cards, customers, items, branches, warehouses, taxCodes] = await Promise.all([
    fetchApi<readonly JobCardRow[]>("sales/job-cards?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners/partners?kind=CUSTOMER&limit=100"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
    fetchApi<readonly TaxCodeRow[]>("tax/tax-codes"),
  ]);
  if (!cards.ok && cards.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!cards.ok) {
    const forbidden = cards.status === 403 || cards.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, cards.error, cards.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <JobCards
        locale={localeValue}
        initialCards={cards.data}
        customers={customers.ok ? customers.data : []}
        items={items.ok ? items.data : []}
        branches={branches.ok ? branches.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
        taxCodes={taxCodes.ok ? taxCodes.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="job-cards" title={d.jobCardsTitle}>
      {content}
    </AppShell>
  );
}
