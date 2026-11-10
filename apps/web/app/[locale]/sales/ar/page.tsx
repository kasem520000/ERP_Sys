/**
 * /{locale}/sales/ar — receivables views (list archetype §2): AR aging,
 * customer statements (with the INV-009 subledgerTie footer), and the
 * open-items surface for the receipts allocation context — module-owned
 * lists over arQueries.* (report contracts register in PHASE-013).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SalesAr } from "../../../../components/sales-ar";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ArAgingRow, ArOpenItemRow, CurrentSession, PartnerRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SalesArPage({
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

  const [aging, openItems, customers, session] = await Promise.all([
    fetchApi<readonly ArAgingRow[]>("sales/ar/aging"),
    fetchApi<readonly ArOpenItemRow[]>("sales/ar/open-items?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!aging.ok && aging.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!aging.ok) {
    const forbidden = aging.status === 403 || aging.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, aging.error, aging.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SalesAr
        locale={localeValue}
        initialAging={aging.data}
        initialOpenItems={openItems.ok ? openItems.data : []}
        customers={(customers.ok ? customers.data : []).filter(
          (p) => p.kind === "CUSTOMER" || p.kind === "BOTH",
        )}
        canRunScan={permissions.includes("sales.invoices.view")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/ar" title={d.salesArTitle}>
      {content}
    </AppShell>
  );
}
