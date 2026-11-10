/**
 * /{locale}/inventory/serials — the serial/IMEI registry (PHASE-035 T-03;
 * List+Search §2): requires inventory.moves.view; register under
 * inventory.tracking.manage; the sold-at view (GET /serials/:id/sale) rides
 * the list permission. Items load best-effort for the register form.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InventorySerials } from "../../../../components/inventory-serials";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, ItemRow, SerialRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventorySerialsPage({
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

  const [serials, items, session] = await Promise.all([
    fetchApi<readonly SerialRow[]>("inventory/serials?limit=500"),
    fetchApi<readonly ItemRow[]>("items/items?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!serials.ok && serials.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!serials.ok) {
    const forbidden = serials.status === 403 || serials.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, serials.error, serials.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventorySerials
        locale={localeValue}
        initialRows={serials.data}
        items={items.ok ? items.data : []}
        canManage={permissions.includes("inventory.tracking.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/serials" title={d.serialsTitle}>
      {content}
    </AppShell>
  );
}
