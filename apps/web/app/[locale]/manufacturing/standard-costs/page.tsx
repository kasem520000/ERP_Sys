/**
 * /{locale}/manufacturing/standard-costs — the per-item standard-cost
 * surface (PHASE-042 T-10/L2-12, matrix §3.20): the versions list with
 * status badges (one ACTIVE per item), the create-manual dialog
 * (material/labor/overhead + effectiveFrom — the total is NEVER accepted
 * from the wire, the service derives it), the BOM/routing roll-up button
 * (a new ROLLED_UP draft), and the activation with the optional
 * revaluate-stock checkbox (the revaluation posts a stock-adjustment
 * journal across every warehouse — the warning label says so). Standard
 * costs are the primary resource — 403 renders the forbidden state; the
 * items pool degrades to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingStandardCosts } from "../../../../components/manufacturing-standard-costs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ItemRow, ItemStandardCostRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingStandardCostsPage({
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

  const [standards, items] = await Promise.all([
    fetchApi<readonly ItemStandardCostRow[]>("manufacturing/standard-costs?limit=200"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
  ]);
  if (!standards.ok && standards.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!standards.ok) {
    const forbidden = standards.status === 403 || standards.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, standards.error, standards.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ManufacturingStandardCosts
        locale={localeValue}
        initialRows={standards.data}
        items={(items.ok ? items.data : []).filter((item) => item.kind === "STOCK")}
        today={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/standard-costs"
      title={d.mfgStdCostsTitle}
    >
      {content}
    </AppShell>
  );
}
