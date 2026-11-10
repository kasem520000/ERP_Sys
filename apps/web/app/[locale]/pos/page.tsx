/**
 * /{locale}/pos — the POS counter (PHASE-016 T4/T10): terminal selector +
 * open-shift badge, scan/item grid, cart, tender dialog, receipt preview,
 * customer picker, POS returns, and the offline outbox. Server side loads
 * terminals (the primary resource — 403 renders the forbidden state),
 * items, customers, cash accounts, and the recent CASH invoices for the
 * returns quick-pick; `?checkId=` preloads a table check handed over from
 * the floor plan's Pay action.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { PosCounter } from "../../../components/pos-counter";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type {
  CashAccountRow,
  ItemRow,
  PartnerRow,
  PosTerminalRow,
  SalesInvoiceRow,
} from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function PosCounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const query = await searchParams;
  const checkIdParam = query.checkId;
  const initialCheckId =
    typeof checkIdParam === "string" && checkIdParam.trim() !== "" ? checkIdParam.trim() : null;

  const [terminals, items, customers, cashAccounts, recentInvoices] = await Promise.all([
    fetchApi<readonly PosTerminalRow[]>("pos/terminals"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    fetchApi<readonly PartnerRow[]>("partners/partners?kind=CUSTOMER&limit=100"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly SalesInvoiceRow[]>("sales/sales-invoices?limit=20&kind=CASH"),
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
      <PosCounter
        locale={localeValue}
        terminals={terminals.data}
        items={items.ok ? items.data : []}
        customers={customers.ok ? customers.data : []}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        recentInvoices={recentInvoices.ok ? recentInvoices.data : []}
        initialCheckId={initialCheckId}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="pos" title={d.posCounterTitle}>
      {content}
    </AppShell>
  );
}
