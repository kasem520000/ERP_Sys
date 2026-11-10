/**
 * /{locale}/crm/contracts — service contracts (PHASE-019 T50, MASTER-PLAN
 * §14): the DRAFT → ACTIVE/CANCELLED/RENEWED lifecycle (CT- number at
 * activation), the fee-model create dialog (RETAINER monthly amount /
 * MILESTONES editor / HOURLY), the DRAFT-only edit, the §4 schedule grid
 * preview, the read-only billing preview (asOf) and the advances panel
 * (tag an on-account receipt). Contracts are the primary resource
 * (crm.contracts.manage + crm.service_contracts) — 403 renders the
 * forbidden state; the partners/projects/SERVICE-items/receipts pools
 * degrade to empty. The contract itself posts nothing (§4).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CrmContracts } from "../../../../components/crm-contracts";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ItemRow,
  PartnerRow,
  ProjectRow,
  ServiceContractReadRow,
  TreasuryDocRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CrmContractsPage({
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

  const [contracts, partners, projects, items, receipts] = await Promise.all([
    fetchApi<readonly ServiceContractReadRow[]>("crm/contracts?limit=200"),
    // Supporting reads (all degrade to empty): the partner select, the
    // project (case) select, the SERVICE fee items, and the posted
    // receipts pool for the advance-tag dialog.
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
    fetchApi<readonly ProjectRow[]>("accounting/projects"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly TreasuryDocRow[]>("treasury/receipts?limit=100"),
  ]);
  if (!contracts.ok && contracts.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!contracts.ok) {
    const forbidden = contracts.status === 403 || contracts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, contracts.error, contracts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <CrmContracts
        locale={localeValue}
        initialRows={contracts.data}
        partners={partners.ok ? partners.data : []}
        projects={projects.ok ? projects.data : []}
        serviceItems={(items.ok ? items.data : []).filter((item) => item.kind === "SERVICE")}
        receipts={receipts.ok ? receipts.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="crm/contracts" title={d.crmContractsTitle}>
      {content}
    </AppShell>
  );
}
