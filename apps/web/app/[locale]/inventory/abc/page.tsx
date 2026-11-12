/**
 * /{locale}/inventory/abc — the ABC classification screen (PHASE-044
 * T-14): the latest generation table + the recompute card. Requires
 * inventory.abc (the analysis-tier read key — the viewer role holds it,
 * the 0071 §2c grant).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryAbc } from "../../../../components/inventory-abc";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, WmsAbcRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryAbcPage({
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

  const [rows, session] = await Promise.all([
    fetchApi<readonly WmsAbcRow[]>("inventory/wms/abc?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!rows.ok && rows.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!rows.ok) {
    const forbidden = rows.status === 403 || rows.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, rows.error, rows.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventoryAbc
        locale={localeValue}
        initialRows={rows.data}
        canManage={permissions.includes("inventory.abc")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/abc" title={d.wmsAbcTitle}>
      {content}
    </AppShell>
  );
}
