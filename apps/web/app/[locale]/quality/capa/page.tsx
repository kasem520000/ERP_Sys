/**
 * /{locale}/quality/capa — the CAPA board (PHASE-050 W-29, T-15): the
 * corrective/preventive register + the root-cause act + the G-63
 * external-cost door + the BR-103 close. quality.view is the board's
 * primary read key; the NCR pool (the intake's select + the register's
 * link labels) degrades to [] on its own 403 (the job-cards rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { QualityCapaBoard } from "../../../../components/quality-capa-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CapaRow, NcrRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function QualityCapaPage({
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

  const [capas, ncrs] = await Promise.all([
    fetchApi<readonly CapaRow[]>("quality/capa"),
    fetchApi<readonly NcrRow[]>("quality/ncr"),
  ]);
  if (!capas.ok && capas.status === 401) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell locale={localeValue} pagePath="quality/capa" title={d.qualityCapaTitle}>
      <QualityCapaBoard
        locale={localeValue}
        initialCapas={capas.ok ? capas.data : null}
        capasError={capas.ok ? null : capas.error}
        ncrs={ncrs.ok ? ncrs.data : []}
      />
    </AppShell>
  );
}
