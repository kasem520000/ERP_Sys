/**
 * WEB-039 (PHASE-039) — /{locale}/sales/returns: the customer returns
 * workspace (matrix §3.2). The RMA registry load is gated by the seeded
 * matrix key sales.rma.read (a 403 renders the honest forbidden state);
 * the create/receive/inspect/complete/cancel actions carry sales.rma.manage,
 * approve carries sales.rma.approve, and the warranties tab carries
 * sales.warranties.manage — all enforced server-side; the workspace
 * re-checks the session-derived flags for every write.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { ReturnsWorkspace } from "../../../../components/returns-workspace";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CashAccountRow,
  CurrentSession,
  ItemRow,
  PartnerRow,
  RmaRow,
  SalesInvoiceRow,
  WarrantyRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SalesReturnsPage({
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

  const [rmas, warranties, customers, items, invoices, branches, cashAccounts, session] =
    await Promise.all([
      fetchApi<readonly RmaRow[]>("sales/returns?limit=200"),
      // The warranties tab rides the same screen behind its own manage key;
      // a user without the key never sees the tab (the workspace gates it on
      // the session-derived flag — the dunning agencies rule) and this fetch
      // degrades to [].
      fetchApi<readonly WarrantyRow[]>("sales/warranties?limit=200"),
      fetchApi<readonly PartnerRow[]>("partners/partners?kind=CUSTOMER&limit=100"),
      fetchApi<readonly ItemRow[]>("items/items?limit=100"),
      fetchApi<readonly SalesInvoiceRow[]>("sales/sales-invoices?status=POSTED&limit=100"),
      // The branch registry is a tenancy permission — on failure the create
      // dialog degrades to [] and the manager falls back to raw branch ids
      // (the zatca-devices rule).
      fetchApi<readonly BranchRow[]>("tenancy/branches"),
      fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts?limit=100"),
      fetchApi<CurrentSession>("identity/sessions/current"),
    ]);
  if ((!rmas.ok && rmas.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!rmas.ok) {
    const forbidden = rmas.status === 403 || rmas.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, rmas.error, rmas.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <ReturnsWorkspace
        locale={localeValue}
        initialRmas={rmas.data}
        initialWarranties={warranties.ok ? warranties.data : []}
        partners={customers.ok ? customers.data : []}
        items={items.ok ? items.data : []}
        invoices={invoices.ok ? invoices.data : []}
        branches={branches.ok ? branches.data : []}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        canManage={permissions.includes("sales.rma.manage")}
        canApprove={permissions.includes("sales.rma.approve")}
        canWarranties={permissions.includes("sales.warranties.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/returns" title={d.returnsTitle}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.returnsSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
