/**
 * /{locale}/quality/coa — the COA board (PHASE-050 W-29, T-15): the
 * certificates register + the generate act (BR-104's gate door) + the
 * per-certificate print preview (the frozen snapshot VERBATIM through the
 * versioned a4-document template). quality.view is the register's read
 * key; the item pool (the generate form's select + the register's labels)
 * degrades to [] on its own 403 (the job-cards rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { QualityCoaBoard } from "../../../../components/quality-coa-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CoaDocumentRow, ItemRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function QualityCoaPage({
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

  const [certificates, items] = await Promise.all([
    fetchApi<readonly CoaDocumentRow[]>("quality/coa"),
    fetchApi<readonly ItemRow[]>("items/items?limit=500"),
  ]);
  if (!certificates.ok && certificates.status === 401) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell locale={localeValue} pagePath="quality/coa" title={d.qualityCoaTitle}>
      <QualityCoaBoard
        locale={localeValue}
        initialCertificates={certificates.ok ? certificates.data : null}
        certificatesError={certificates.ok ? null : certificates.error}
        items={items.ok ? items.data : []}
      />
    </AppShell>
  );
}
