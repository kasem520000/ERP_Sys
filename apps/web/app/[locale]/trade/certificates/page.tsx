/**
 * /{locale}/trade/certificates — the certificate print surface
 * (PHASE-051 W-39, T-14, D-13/D-17): the register + the issue act
 * (the frozen snapshot's own door) + the per-certificate print
 * preview (the frozen snapshot rendered VERBATIM through the bi()
 * builder EXCLUSIVELY — the 050 COA print laws carried verbatim).
 * trade.view is the register's read key; the issue act gates
 * server-side on trade.shipments.manage (the transport-documents
 * cluster's own manage key, the 0120 family).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { TradeCertificatesBoard } from "../../../../components/trade-certificates-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, TradeCertificateRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TradeCertificatesPage({
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

  const [certificates, session] = await Promise.all([
    fetchApi<readonly TradeCertificateRow[]>("trade/certificates"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!certificates.ok && certificates.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const permissions = session.ok ? session.data.permissions : [];
  const canManage = permissions.includes("trade.shipments.manage");

  return (
    <AppShell locale={localeValue} pagePath="trade/certificates" title={d.tradeCertificatesTitle}>
      <TradeCertificatesBoard
        locale={localeValue}
        initialCertificates={certificates.ok ? certificates.data : null}
        certificatesError={certificates.ok ? null : certificates.error}
        canManage={canManage}
      />
    </AppShell>
  );
}
