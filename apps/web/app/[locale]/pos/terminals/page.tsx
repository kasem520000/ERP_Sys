/**
 * /{locale}/pos/terminals — the POS terminal registry (PHASE-016 T2):
 * the terminal table, register (code pattern validation, branch + till
 * required), activate/deactivate, device enrollment (locally generated
 * key shown once), and revocation. Terminals are the primary resource —
 * 403 renders the forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { PosTerminals } from "../../../../components/pos-terminals";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CashAccountRow,
  PosTerminalRow,
  WarehouseRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PosTerminalsPage({
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

  const [terminals, branches, cashAccounts, warehouses] = await Promise.all([
    fetchApi<readonly PosTerminalRow[]>("pos/terminals"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly WarehouseRow[]>("inventory/warehouses"),
  ]);
  if (!terminals.ok && terminals.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!terminals.ok) {
    const forbidden = terminals.status === 403 || terminals.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, terminals.error, terminals.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <PosTerminals
        locale={localeValue}
        initialRows={terminals.data}
        branches={branches.ok ? branches.data : []}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        warehouses={warehouses.ok ? warehouses.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="pos/terminals" title={d.posTerminalsTitle}>
      {content}
    </AppShell>
  );
}
