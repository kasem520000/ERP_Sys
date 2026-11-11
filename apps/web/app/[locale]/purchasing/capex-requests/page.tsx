/**
 * WEB-038 (PHASE-038) — /{locale}/purchasing/capex-requests: the CAPEX
 * intake surface (matrix §3.16, P-10/P-15). Reading rides purchasing.capex.
 * read; create/submit carry purchasing.capex.manage and approve/reject
 * carry purchasing.capex.approve (enforced server-side; the component
 * re-checks the session-derived flags). The chart of accounts is a
 * separate accounting permission — on failure the create form degrades to
 * a plain account UUID input (the zatca branches rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { CapexRequests } from "../../../../components/capex-requests";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AccountRow,
  BranchRow,
  CapexRequestRow,
  CurrentSession,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CapexRequestsPage({
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

  const [requests, accounts, branches, session] = await Promise.all([
    fetchApi<readonly CapexRequestRow[]>("purchasing/capex-requests?limit=200"),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!requests.ok && requests.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!requests.ok) {
    const forbidden = requests.status === 403 || requests.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, requests.error, requests.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <CapexRequests
        locale={localeValue}
        initialRequests={requests.data}
        accounts={accounts.ok ? accounts.data : []}
        branches={branches.ok ? branches.data : []}
        canManage={permissions.includes("purchasing.capex.manage")}
        canApprove={permissions.includes("purchasing.capex.approve")}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="purchasing/capex-requests"
      title={d.sourcingCapexTitle}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.sourcingCapexSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
