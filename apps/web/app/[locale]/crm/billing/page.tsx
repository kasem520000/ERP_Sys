/**
 * /{locale}/crm/billing — recurring billing (PHASE-019 T50, MASTER-PLAN
 * §14): the runs history (over the crm.billing_run audit events — there is
 * NO billing_runs table, the documented §5 choice), the manual run dialog
 * (asOf picker + the dry preview over the ACTIVE contracts via the
 * per-contract billing-preview route) and the drafts review (the
 * contract_invoices listing with a deep-link to the sales invoices screen).
 * Billing runs are the primary resource (crm.contracts.bill +
 * crm.recurring_billing) — 403 renders the forbidden state; the contracts
 * and contract-invoices pools degrade to empty. The run NEVER auto-posts
 * (BR-034) — drafts flow the ordinary approval chain.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CrmBilling } from "../../../../components/crm-billing";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BillingRunSummaryRow,
  ContractInvoiceRow,
  ServiceContractReadRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CrmBillingPage({
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

  const [runs, contracts, contractInvoices] = await Promise.all([
    fetchApi<readonly BillingRunSummaryRow[]>("crm/billing-runs?limit=20"),
    // Supporting reads (degrade to empty): the ACTIVE-contract pool drives
    // the dry preview; the full pool labels the drafts review rows.
    fetchApi<readonly ServiceContractReadRow[]>("crm/contracts?limit=200"),
    fetchApi<readonly ContractInvoiceRow[]>("crm/contract-invoices?limit=200"),
  ]);
  if (!runs.ok && runs.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!runs.ok) {
    const forbidden = runs.status === 403 || runs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, runs.error, runs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <CrmBilling
        locale={localeValue}
        initialRuns={runs.data}
        contracts={contracts.ok ? contracts.data : []}
        initialContractInvoices={contractInvoices.ok ? contractInvoices.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="crm/billing" title={d.crmBillingTitle}>
      {content}
    </AppShell>
  );
}
