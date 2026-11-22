/**
 * /{locale}/assets/scan — the QR scan surface (PHASE-049 W-21, T-14): the
 * signed tag-code resolver (the scan itself is CLIENT-side — the page needs
 * no primary fetch, and a 403 never blocks the page shell: the resolve
 * surfaces its own typed refusals through the panel).
 *
 * THE ROUTE NOTE (the plan's own shape): the tags admin — the signed-QR
 * tag register + the issue flow + the print sheet — mounts INSIDE this
 * same route, below the scan surface (the plan has no separate
 * /assets/tags route; the QR resolver and the tag register are the two
 * halves of the tags plane). The admin's asset pool
 * (fixed-assets/assets) degrades to [] on its own 403 (the job-cards
 * rule).
 */
import { notFound } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { AssetsScanSurface } from "../../../../components/assets-scan-surface";
import { AssetsTagsAdmin } from "../../../../components/assets-tags-admin";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { FixedAssetRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function AssetsScanPage({
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

  // The tags admin's asset pool (the issue dialog + the register select) —
  // a pool, never a gate: a 403 degrades to [] and the admin's own reads
  // surface their typed refusals.
  const assets = await fetchApi<readonly FixedAssetRow[]>("fixed-assets/assets?limit=200");

  return (
    <AppShell locale={localeValue} pagePath="assets/scan" title={d.assetsScanTitle}>
      <div className="flex flex-col gap-4">
        <AssetsScanSurface locale={localeValue} />
        <AssetsTagsAdmin locale={localeValue} assets={assets.ok ? assets.data : []} />
      </div>
    </AppShell>
  );
}
