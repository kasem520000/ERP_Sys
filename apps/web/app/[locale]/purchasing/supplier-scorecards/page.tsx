/**
 * WEB-038 (PHASE-038) — /{locale}/purchasing/supplier-scorecards: the
 * collaboration surface (matrix §3.16, P-04) — scorecard windows plus the
 * approved-vendor item list. Reading rides purchasing.rfqs.read; the
 * recompute carries purchasing.suppliers.rate and the AVL upsert carries
 * purchasing.rfqs.manage (both enforced server-side; the component
 * re-checks the session-derived flags).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SupplierScorecards } from "../../../../components/supplier-scorecards";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  PartnerRow,
  SupplierRatingRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SupplierScorecardsPage({
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

  const [ratings, suppliers, session] = await Promise.all([
    fetchApi<readonly SupplierRatingRow[]>("purchasing/supplier-ratings?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!ratings.ok && ratings.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!ratings.ok) {
    const forbidden = ratings.status === 403 || ratings.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, ratings.error, ratings.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SupplierScorecards
        locale={localeValue}
        initialRatings={ratings.data}
        partners={suppliers.ok ? suppliers.data : []}
        canRate={permissions.includes("purchasing.suppliers.rate")}
        canManage={permissions.includes("purchasing.rfqs.manage")}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="purchasing/supplier-scorecards"
      title={d.sourcingScorecardsTitle}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.sourcingScorecardsSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
