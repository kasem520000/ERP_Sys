/**
 * /{locale}/trade/drawbacks — the drawback claims board (PHASE-052
 * W-48 — the fourth bound detail surface): the 051 engine's own
 * register + the lifecycle acts (BR-108's evidence gate at the
 * submission) + the chain view (the workflow timeline — the engine's
 * docDetailPath law lands the assignee here). trade.view is the
 * register's read key; the manage acts gate server-side on
 * trade.drawback.manage (the 0122-seeded keys, matrix §3.29).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TradeDrawbacksBoard } from "../../../../components/trade-drawbacks-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, TradeDrawbackClaimRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TradeDrawbacksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ doc?: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const { doc } = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const [claims, session] = await Promise.all([
    fetchApi<readonly TradeDrawbackClaimRow[]>("trade/drawback/claims"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!claims.ok && claims.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!claims.ok) {
    const forbidden = claims.status === 403 || claims.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.tradeDrawbackNoAccess
            : localizedApiError(d, claims.error, claims.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <TradeDrawbacksBoard
        locale={localeValue}
        initialClaims={claims.data}
        claimsError={null}
        canManage={permissions.includes("trade.drawback.manage")}
        initialChainDocId={doc ?? null}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="trade/drawbacks" title={d.tradeDrawbackTitle}>
      {content}
    </AppShell>
  );
}
