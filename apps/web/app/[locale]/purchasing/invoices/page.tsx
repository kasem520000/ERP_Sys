/**
 * /{locale}/purchasing/invoices — supplier-invoice workspace with the
 * three-way-match panel (§4/§5): supplier_invoices.view for the list;
 * create/approve/post keys gate the actions (matrix §3.3 — post is risky).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { PurchasingInvoices } from "../../../../components/purchasing-invoices";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AccountRow,
  CurrentSession,
  ItemRow,
  PartnerRow,
  SupplierInvoiceRow,
  TaxCodeRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PurchasingInvoicesPage({
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

  const [invoices, suppliers, items, accounts, taxCodes, session] = await Promise.all([
    fetchApi<readonly SupplierInvoiceRow[]>("purchasing/supplier-invoices?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<readonly TaxCodeRow[]>("tax/tax-codes?limit=200"),
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
      <PurchasingInvoices
        locale={localeValue}
        initialInvoices={invoices.data}
        suppliers={suppliers.ok ? suppliers.data : []}
        items={items.ok ? items.data : []}
        expenseAccounts={(accounts.ok ? accounts.data : []).filter((a) => a.type === "EXPENSE")}
        taxCodes={taxCodes.ok ? taxCodes.data : []}
        canCreate={permissions.includes("purchasing.supplier_invoices.create")}
        canApprove={permissions.includes("purchasing.supplier_invoices.approve")}
        canPost={permissions.includes("purchasing.supplier_invoices.post")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="purchasing/invoices" title={d.purchasingInvoicesTitle}>
      {content}
    </AppShell>
  );
}
