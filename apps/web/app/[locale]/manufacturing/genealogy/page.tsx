/**
 * /{locale}/manufacturing/genealogy — the recall search (PHASE-018 T41,
 * MASTER-PLAN §14 §10): a read-only batch search surface (upstream
 * materials / downstream productions+sales / batch summary) over the
 * produced-batch provenance graph. There is NO primary resource — the
 * supporting reads are the item pool and the batch search pool; both
 * degrade to empty on failure (the screen still works via a pasted batch
 * UUID), and a 401 on any of them redirects to login (a dead session
 * means no search can run). The screen never mutates anything.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingGenealogy } from "../../../../components/manufacturing-genealogy";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { BatchRow, ItemRow } from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingGenealogyPage({
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

  const [items, batches] = await Promise.all([
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    // The batch search pool (the select's initial page); the screen works
    // without it — a pasted UUID and the per-item refetch carry the recall.
    fetchApi<readonly BatchRow[]>("inventory/batches?limit=500"),
  ]);
  if ((!items.ok && items.status === 401) || (!batches.ok && batches.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const content: JSX.Element = (
    <ManufacturingGenealogy
      locale={localeValue}
      items={(items.ok ? items.data : []).filter(
        (item) => item.kind === "STOCK" && item.trackBatch && item.deletedAt === null,
      )}
      initialBatches={batches.ok ? batches.data : []}
    />
  );

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/genealogy"
      title={d.mfgGenealogyTitle}
    >
      {content}
    </AppShell>
  );
}
