/**
 * /{locale}/quality/complaints — the complaints board (PHASE-050 W-29,
 * T-15): the customer-complaint register + the lifecycle acts (triage with
 * the optional NCR link, progress, resolve, close). quality.view is the
 * board's primary read key; the customer/item/NCR pools (the intake's
 * selects + the register's link labels) degrade to [] on their own 403s
 * (the job-cards rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { QualityComplaintsBoard } from "../../../../components/quality-complaints-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ComplaintRow, ItemRow, NcrRow, PartnerRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function QualityComplaintsPage({
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

  const [complaints, customers, items, ncrs] = await Promise.all([
    fetchApi<readonly ComplaintRow[]>("quality/complaints"),
    fetchApi<readonly PartnerRow[]>("partners/partners?kind=CUSTOMER&limit=200"),
    fetchApi<readonly ItemRow[]>("items/items?limit=500"),
    fetchApi<readonly NcrRow[]>("quality/ncr"),
  ]);
  if (!complaints.ok && complaints.status === 401) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="quality/complaints"
      title={d.qualityComplaintsTitle}
    >
      <QualityComplaintsBoard
        locale={localeValue}
        initialComplaints={complaints.ok ? complaints.data : null}
        complaintsError={complaints.ok ? null : complaints.error}
        customers={customers.ok ? customers.data : []}
        items={items.ok ? items.data : []}
        ncrs={ncrs.ok ? ncrs.data : []}
      />
    </AppShell>
  );
}
