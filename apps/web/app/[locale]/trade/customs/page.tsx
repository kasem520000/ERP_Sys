/**
 * /{locale}/trade/customs — the customs board (PHASE-051 W-39, T-14,
 * D-17): the declarations register + the create act with the lines
 * editor + the detail chain (the lines + the fold's totals) + the
 * ladder acts + the HS registry pane. trade.customs.view is the
 * register's read key (the customs plane's own composable unit); the
 * manage acts gate server-side on trade.customs.manage.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { TradeCustomsBoard } from "../../../../components/trade-customs-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  TradeDeclarationRow,
  TradeHsCodeRow,
} from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TradeCustomsPage({
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

  const [declarations, hs, session] = await Promise.all([
    fetchApi<readonly TradeDeclarationRow[]>("trade/customs/declarations"),
    fetchApi<readonly TradeHsCodeRow[]>("trade/customs/hs"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!declarations.ok && declarations.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const permissions = session.ok ? session.data.permissions : [];
  const canManage = permissions.includes("trade.customs.manage");

  return (
    <AppShell locale={localeValue} pagePath="trade/customs" title={d.tradeCustomsTitle}>
      <TradeCustomsBoard
        locale={localeValue}
        initialDeclarations={declarations.ok ? declarations.data : null}
        declarationsError={declarations.ok ? null : declarations.error}
        initialHs={hs.ok ? hs.data : null}
        hsError={hs.ok ? null : hs.error}
        canManage={canManage}
      />
    </AppShell>
  );
}
