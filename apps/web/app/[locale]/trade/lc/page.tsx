/**
 * /{locale}/trade/lc — the LC board (PHASE-051 W-39, T-14, D-17): the
 * register + the create act + the detail chain (the amendments + the
 * documents checklist with the discrepancy notes) + the lifecycle
 * acts. trade.lc.view is the register's read key (the LC plane's own
 * composable unit); the manage acts gate server-side on
 * trade.lc.manage.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { TradeLcBoard } from "../../../../components/trade-lc-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, TradeLcRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TradeLcPage({
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

  const [lcs, session] = await Promise.all([
    fetchApi<readonly TradeLcRow[]>("trade/lc"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!lcs.ok && lcs.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const permissions = session.ok ? session.data.permissions : [];
  const canManage = permissions.includes("trade.lc.manage");

  return (
    <AppShell locale={localeValue} pagePath="trade/lc" title={d.tradeLcTitle}>
      <TradeLcBoard
        locale={localeValue}
        initialLcs={lcs.ok ? lcs.data : null}
        lcsError={lcs.ok ? null : lcs.error}
        canManage={canManage}
      />
    </AppShell>
  );
}
