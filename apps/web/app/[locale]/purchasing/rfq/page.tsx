/**
 * WEB-038 (PHASE-038) — /{locale}/purchasing/rfq: the RFQ negotiation
 * workspace (matrix §3.16). List/create gated by the seeded matrix key
 * purchasing.rfqs.read; the create/issue/quote/invite actions carry
 * purchasing.rfqs.manage and the award carries purchasing.rfqs.award —
 * all enforced server-side; the workspace re-checks the session-derived
 * flags for every write.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SourcingWorkspace } from "../../../../components/sourcing-workspace";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CurrentSession,
  ItemRow,
  PartnerRow,
  RfqRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SourcingRfqPage({
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

  const [rfqs, suppliers, items, branches, session] = await Promise.all([
    fetchApi<readonly RfqRow[]>("purchasing/rfqs?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
    // The branch registry is a tenancy permission — on failure the create
    // dialog degrades to [] and the manager falls back to raw branch ids
    // (the zatca-devices rule).
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!rfqs.ok && rfqs.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!rfqs.ok) {
    const forbidden = rfqs.status === 403 || rfqs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, rfqs.error, rfqs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SourcingWorkspace
        locale={localeValue}
        initialRfqs={rfqs.data}
        partners={suppliers.ok ? suppliers.data : []}
        items={items.ok ? items.data : []}
        branches={branches.ok ? branches.data : []}
        canManage={permissions.includes("purchasing.rfqs.manage")}
        canAward={permissions.includes("purchasing.rfqs.award")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="purchasing/rfq" title={d.sourcingRfqTitle}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.sourcingRfqSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
