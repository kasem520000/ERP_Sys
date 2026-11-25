/**
 * /{locale}/trade/shipments — the tracking board (PHASE-051 W-39, T-14,
 * D-17): the B/L register + the packing lists + the carrier event log
 * (the append-only truth whose POST runs the fold — the documents'
 * shipment_status is NEVER writable here, D-14's own law).
 * trade.shipments.view is the register's read key (the transport
 * family's OWN viewer key); the create/append acts gate server-side
 * on trade.shipments.manage.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { TradeShipmentsBoard } from "../../../../components/trade-shipments-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  TradeBlRow,
  TradePackingListRow,
  TradeTrackingEventRow,
} from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TradeShipmentsPage({
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

  const [bls, packingLists, events, session] = await Promise.all([
    fetchApi<readonly TradeBlRow[]>("trade/transport/bl"),
    fetchApi<readonly TradePackingListRow[]>("trade/transport/packing-lists"),
    fetchApi<readonly TradeTrackingEventRow[]>("trade/shipments/events"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!bls.ok && bls.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const permissions = session.ok ? session.data.permissions : [];
  const canManage = permissions.includes("trade.shipments.manage");

  return (
    <AppShell locale={localeValue} pagePath="trade/shipments" title={d.tradeShipmentsTitle}>
      <TradeShipmentsBoard
        locale={localeValue}
        initialBls={bls.ok ? bls.data : null}
        blsError={bls.ok ? null : bls.error}
        initialPackingLists={packingLists.ok ? packingLists.data : null}
        packingListsError={packingLists.ok ? null : packingLists.error}
        initialEvents={events.ok ? events.data : null}
        eventsError={events.ok ? null : events.error}
        canManage={canManage}
      />
    </AppShell>
  );
}
