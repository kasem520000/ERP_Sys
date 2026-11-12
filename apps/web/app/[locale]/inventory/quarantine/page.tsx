/**
 * /{locale}/inventory/quarantine — the quarantine/HOLD board (PHASE-044
 * T-14): held bin-content rows, the G-43 policy-gated status transitions,
 * and the RELEASE / RETURN_TO_VENDOR / SCRAP dispositions. Requires
 * inventory.quarantine (the 0071 matrix row).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { InventoryQuarantine } from "../../../../components/inventory-quarantine";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { AccountRow, CurrentSession, WmsBinContentRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InventoryQuarantinePage({
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

  const [board, glAccounts, session] = await Promise.all([
    fetchApi<readonly WmsBinContentRow[]>("inventory/wms/quarantine-board?status=QUARANTINE&limit=200"),
    fetchApi<readonly AccountRow[]>("accounting/accounts?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!board.ok && board.status === 401) ||
    (!glAccounts.ok && glAccounts.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!board.ok) {
    const forbidden = board.status === 403 || board.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, board.error, board.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <InventoryQuarantine
        locale={localeValue}
        initialRows={board.data}
        glAccounts={glAccounts.ok ? glAccounts.data : []}
        canManage={permissions.includes("inventory.quarantine")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/quarantine" title={d.wmsQTitle}>
      {content}
    </AppShell>
  );
}
