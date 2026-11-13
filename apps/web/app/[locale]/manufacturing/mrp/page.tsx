/**
 * /{locale}/manufacturing/mrp — the material-requirements-planning screen
 * (PHASE-043 T-13, matrix §3.20; archetype list-search): the run
 * configuration (warehouse, bucket size, horizon, mode, transfers, scope),
 * the run history table and the suggestions board (accept → converted
 * document; dismiss-with-reason — BR-079). Planning data only — no run ever
 * posts a journal; acceptance converts through the owning modules' own
 * services. Runs are the primary resource — 403 renders the forbidden
 * state; the suggestions board (same permission) rides along; the warehouse
 * + item pools degrade to empty (the boms-page rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingMrp } from "../../../../components/manufacturing-mrp";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ItemRow,
  MrpRunRow,
  MrpSuggestionRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingMrpPage({
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

  const [runs, suggestions, warehouses, items] = await Promise.all([
    fetchApi<readonly MrpRunRow[]>("manufacturing/mrp/runs?limit=50"),
    fetchApi<readonly MrpSuggestionRow[]>("manufacturing/mrp/suggestions?limit=200"),
    // Supporting reads: the run-config warehouse select + the item-scope
    // picker (STOCK items only) degrade to empty on failure.
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses?limit=100"),
    fetchApi<readonly ItemRow[]>("items/items?limit=200"),
  ]);
  if ((!runs.ok && runs.status === 401) || (!suggestions.ok && suggestions.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!runs.ok) {
    const forbidden = runs.status === 403 || runs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, runs.error, runs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ManufacturingMrp
        locale={localeValue}
        initialRuns={runs.data}
        initialSuggestions={suggestions.ok ? suggestions.data : []}
        warehouses={(warehouses.ok ? warehouses.data : []).filter((warehouse) => warehouse.isActive)}
        items={(items.ok ? items.data : []).filter((item) => item.kind === "STOCK")}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/mrp"
      title={d.mfgMrpTitle}
    >
      {content}
    </AppShell>
  );
}
