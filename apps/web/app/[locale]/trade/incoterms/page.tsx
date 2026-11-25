/**
 * /{locale}/trade/incoterms — the Incoterms reference page (PHASE-051
 * W-39, T-14, D-17): the registry rows with the risk-hint matrix
 * rendered from each row's OWN data + the tenant additions.
 * trade.view is the register's read key (the whole-module viewer key,
 * the incoterms reads' own shape); the tenant additions gate
 * server-side on trade.collections.manage (the W-35 register-act key).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { TradeIncotermsBoard } from "../../../../components/trade-incoterms-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, TradeIncotermRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TradeIncotermsPage({
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

  const [incoterms, session] = await Promise.all([
    fetchApi<readonly TradeIncotermRow[]>("trade/incoterms"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!incoterms.ok && incoterms.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const permissions = session.ok ? session.data.permissions : [];
  const canManage = permissions.includes("trade.collections.manage");

  return (
    <AppShell locale={localeValue} pagePath="trade/incoterms" title={d.tradeIncotermsTitle}>
      <TradeIncotermsBoard
        locale={localeValue}
        initialIncoterms={incoterms.ok ? incoterms.data : null}
        incotermsError={incoterms.ok ? null : incoterms.error}
        canManage={canManage}
      />
    </AppShell>
  );
}
