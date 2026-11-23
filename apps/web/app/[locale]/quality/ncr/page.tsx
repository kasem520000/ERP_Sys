/**
 * /{locale}/quality/ncr — the NCR board (PHASE-050 W-29, T-15): the
 * nonconformity register + the intake form + the G-62 disposition door +
 * the close. quality.view is the board's primary read key; the item pool
 * (the filters + the intake's select) degrades to [] on its own 403 (the
 * job-cards rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { QualityNcrBoard } from "../../../../components/quality-ncr-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ItemRow, NcrRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function QualityNcrPage({
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

  const [ncrs, items] = await Promise.all([
    fetchApi<readonly NcrRow[]>("quality/ncr"),
    fetchApi<readonly ItemRow[]>("items/items?limit=500"),
  ]);
  if (!ncrs.ok && ncrs.status === 401) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell locale={localeValue} pagePath="quality/ncr" title={d.qualityNcrTitle}>
      <QualityNcrBoard
        locale={localeValue}
        initialNcrs={ncrs.ok ? ncrs.data : null}
        ncrsError={ncrs.ok ? null : ncrs.error}
        items={items.ok ? items.data : []}
      />
    </AppShell>
  );
}
