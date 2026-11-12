/**
 * /{locale}/manufacturing/routings — the versioned routing registry
 * (PHASE-042 T-10, matrix §3.20): pick an item → its routing versions; the
 * selected version's workspace shows the frozen operation set (sequence,
 * work center, setup/run times, optional rate overrides, bilingual
 * descriptions). DRAFT versions accept the full-replace PATCH through the
 * versioned operation editor; activation archives the item's previous
 * ACTIVE version in the same call (the confirm dialog carries the
 * warning); any version copies to a new DRAFT. Routings are the primary
 * resource — 403 renders the forbidden state; the items/uoms/work-centers
 * pools degrade to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingRoutings } from "../../../../components/manufacturing-routings";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ItemRow, RoutingRow, UomRow, WorkCenterRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingRoutingsPage({
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

  const [routings, items, uoms, workCenters] = await Promise.all([
    fetchApi<readonly RoutingRow[]>("manufacturing/routings?limit=200"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly UomRow[]>("items/uoms"),
    // Only ACTIVE centers may back new routing operations (0065 guard).
    fetchApi<readonly WorkCenterRow[]>("manufacturing/work-centers?status=ACTIVE&limit=200"),
  ]);
  if (!routings.ok && routings.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!routings.ok) {
    const forbidden = routings.status === 403 || routings.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, routings.error, routings.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ManufacturingRoutings
        locale={localeValue}
        initialRows={routings.data}
        items={(items.ok ? items.data : []).filter((item) => item.kind === "STOCK")}
        uoms={uoms.ok ? uoms.data : []}
        workCenters={workCenters.ok ? workCenters.data : []}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/routings"
      title={d.mfgRoutingsTitle}
    >
      {content}
    </AppShell>
  );
}
