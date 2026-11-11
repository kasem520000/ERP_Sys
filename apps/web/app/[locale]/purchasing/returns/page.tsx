/**
 * WEB-039 (PHASE-039) — /{locale}/purchasing/returns: the supplier returns
 * workspace (matrix §3.3). The SRMA registry load is gated by the seeded
 * matrix key purchasing.rma.read (a 403 renders the honest forbidden
 * state); the create/approve/ship/credit/cancel actions carry
 * purchasing.rma.manage — all enforced server-side; the workspace
 * re-checks the session-derived flag for every write.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SupplierReturnsWorkspace } from "../../../../components/supplier-returns-workspace";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CurrentSession,
  ItemRow,
  PartnerRow,
  PurchaseOrderRow,
  SupplierRmaRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PurchasingReturnsPage({
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

  const [srmas, suppliers, items, purchaseOrders, branches, warehouses, session] =
    await Promise.all([
      fetchApi<readonly SupplierRmaRow[]>("purchasing/returns?limit=200"),
      fetchApi<readonly PartnerRow[]>("partners/partners?kind=SUPPLIER&limit=100"),
      fetchApi<readonly ItemRow[]>("items/items?limit=100"),
      fetchApi<readonly PurchaseOrderRow[]>("purchasing/purchase-orders?limit=100"),
      // The branch registry is a tenancy permission — on failure the create
      // dialog degrades to [] and the manager falls back to raw branch ids
      // (the zatca-devices rule).
      fetchApi<readonly BranchRow[]>("tenancy/branches"),
      fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
      fetchApi<CurrentSession>("identity/sessions/current"),
    ]);
  if ((!srmas.ok && srmas.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!srmas.ok) {
    const forbidden = srmas.status === 403 || srmas.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, srmas.error, srmas.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SupplierReturnsWorkspace
        locale={localeValue}
        initialSrmas={srmas.data}
        suppliers={suppliers.ok ? suppliers.data : []}
        items={items.ok ? items.data : []}
        purchaseOrders={purchaseOrders.ok ? purchaseOrders.data : []}
        branches={branches.ok ? branches.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
        canManage={permissions.includes("purchasing.rma.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="purchasing/returns" title={d.supplierReturnsTitle}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.supplierReturnsSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
