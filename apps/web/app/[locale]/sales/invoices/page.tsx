/**
 * /{locale}/sales/invoices — sales-invoice workspace (G-01/G-02/G-03):
 * sales.invoices.view for the list; create/approve/post keys gate the
 * actions server-side (matrix §3.2 — post is risky; the BR-001 override
 * additionally needs sales.credit_check.override, verified server-side).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SalesInvoices } from "../../../../components/sales-invoices";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AccountRow,
  BranchRow,
  CashAccountRow,
  CurrentSession,
  ItemRow,
  PartnerRow,
  SalesInvoiceRow,
  TaxCodeRow,
  TenantProfile,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SalesInvoicesPage({
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

  const [invoices, customers, items, accounts, taxCodes, cashAccounts, branches, profile, session] =
    await Promise.all([
      fetchApi<readonly SalesInvoiceRow[]>("sales/sales-invoices?limit=200"),
      fetchApi<readonly PartnerRow[]>("partners?limit=500"),
      fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
      fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
      fetchApi<readonly TaxCodeRow[]>("tax/tax-codes?limit=200"),
      fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
      fetchApi<readonly BranchRow[]>("tenancy/branches"),
      fetchApi<TenantProfile>("tenancy/profile"),
      fetchApi<CurrentSession>("identity/sessions/current"),
    ]);
  if ((!invoices.ok && invoices.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!invoices.ok) {
    const forbidden = invoices.status === 403 || invoices.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, invoices.error, invoices.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SalesInvoices
        locale={localeValue}
        initialInvoices={invoices.data}
        customers={customers.ok ? customers.data : []}
        items={items.ok ? items.data : []}
        revenueAccounts={(accounts.ok ? accounts.data : []).filter((a) => a.type === "REVENUE")}
        taxCodes={taxCodes.ok ? taxCodes.data : []}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        branches={branches.ok ? branches.data : []}
        baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
        canCreate={permissions.includes("sales.invoices.create")}
        canApprove={permissions.includes("sales.invoices.approve")}
        canOverrideCredit={permissions.includes("sales.credit_check.override")}
        canPost={permissions.includes("sales.invoices.post")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/invoices" title={d.salesInvoicesTitle}>
      {content}
    </AppShell>
  );
}
