/**
 * /{locale}/treasury/accounts/[id] — cash-account detail: the profile card
 * (type, GL code, currency, status, opened/closed dates, balance) and the
 * movement ledger drill-down (IN/OUT + base amounts, value-date filter).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { Card } from "../../../../../components/card";
import { DefList } from "../../../../../components/def-list";
import { RetryButton } from "../../../../../components/retry-button";
import { TreasuryAccountMovements } from "../../../../../components/treasury-account-movements";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { CashAccountRow, CashMovementRow } from "../../../../../lib/api-types";
import {
  formatDateTime,
  localizedApiError,
  localizedCashAccountType,
  localizedName,
} from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";
import { Badge } from "../../../../../components/client-ui";

export default async function TreasuryAccountDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const [account, movements] = await Promise.all([
    fetchApi<CashAccountRow>(`treasury/cash-accounts/${id}`),
    fetchApi<readonly CashMovementRow[]>(`treasury/cash-accounts/${id}/movements?limit=200`),
  ]);
  if (!account.ok && account.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!account.ok) {
    const forbidden = account.status === 403 || account.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, account.error, account.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const row = account.data;
    content = (
      <div className="flex flex-col gap-4">
        <Card
          title={localizedName(row.name, row.nameAr, localeValue)}
          actions={
            row.status === "ACTIVE" ? (
              <Badge tone="primary">{d.statusActive}</Badge>
            ) : (
              <Badge tone="neutral">{d.statusClosed}</Badge>
            )
          }
        >
          <DefList
            items={[
              { term: d.treasuryAccountType, children: localizedCashAccountType(d, row.type) },
              {
                term: d.treasuryColGlCode,
                children: (
                  <span className="font-mono text-sm" dir="ltr">{row.accountCode}</span>
                ),
              },
              {
                term: d.treasuryDocCurrency,
                children: (
                  <span className="font-mono text-sm" dir="ltr">{row.currencyCode}</span>
                ),
              },
              {
                term: d.treasuryAccountBalance,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.balance} {row.currencyCode}
                  </span>
                ),
              },
              { term: d.treasuryAccountOpenedAt, children: formatDateTime(row.openedAt, localeValue) },
              {
                term: d.treasuryAccountClosedAt,
                children:
                  row.closedAt === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatDateTime(row.closedAt, localeValue)
                  ),
              },
              {
                term: d.treasuryAccountCloseReason,
                children: row.closeReason ?? <span className="text-muted-foreground">—</span>,
              },
              { term: d.treasuryColMovements, children: String(row.movementCount) },
            ]}
          />
        </Card>

        <TreasuryAccountMovements
          locale={localeValue}
          cashAccountId={row.id}
          initialMovements={movements.ok ? movements.data : []}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath={`treasury/accounts/${id}`} title={d.treasuryAccountsTitle}>
      {content}
    </AppShell>
  );
}
