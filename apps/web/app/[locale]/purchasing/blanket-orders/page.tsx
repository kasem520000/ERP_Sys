/**
 * WEB-038 (PHASE-038) — /{locale}/purchasing/blanket-orders: the standing
 * agreements surface (matrix §3.16, P-03). Reading rides the seeded
 * purchasing.rfqs.read key; create/release/close carry purchasing.rfqs.manage
 * (enforced server-side; the component re-checks the session-derived flag).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { BlanketOrders } from "../../../../components/blanket-orders";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BlanketOrderRow,
  BranchRow,
  CurrentSession,
  PartnerRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function BlanketOrdersPage({
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

  const [blankets, suppliers, branches, session] = await Promise.all([
    fetchApi<readonly BlanketOrderRow[]>("purchasing/blanket-orders?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    // The branch registry is a tenancy permission — on failure the create
    // dialog degrades to [] (the zatca-devices rule).
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!blankets.ok && blankets.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!blankets.ok) {
    const forbidden = blankets.status === 403 || blankets.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, blankets.error, blankets.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <BlanketOrders
        locale={localeValue}
        initialBlankets={blankets.data}
        partners={suppliers.ok ? suppliers.data : []}
        branches={branches.ok ? branches.data : []}
        canManage={permissions.includes("purchasing.rfqs.manage")}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="purchasing/blanket-orders"
      title={d.sourcingBlanketTitle}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.sourcingBlanketSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
