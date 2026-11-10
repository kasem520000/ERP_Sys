/**
 * /{locale}/distribution/settlements — the day-end rep settlements
 * (PHASE-017 T14 9a-dist): expected cash = opening + cash sales +
 * collections − cash refunds − rep expenses; variance = counted −
 * expected (BR-021: always posts, approval-gated, never netted). The
 * list (status filter) + open dialog; the detail workspace renders the
 * expected-cash component lines, the count form (reason required on a
 * non-zero variance), the approve hop (only when approval is required),
 * the post dialog (optional bank deposit leg) and cancel. Typed errors
 * (pending documents / day locked / approval required / self-approval)
 * render localized. Settlements are the primary resource — 403 renders
 * the forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { DistributionSettlements } from "../../../../components/distribution-settlements";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CashAccountRow,
  RepSettlementRow,
  SalesRepRow,
  VanRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function DistributionSettlementsPage({
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

  const today = new Date().toISOString().slice(0, 10);
  const [settlements, reps, cashAccounts, vans] = await Promise.all([
    fetchApi<readonly RepSettlementRow[]>("distribution/settlements"),
    fetchApi<readonly SalesRepRow[]>("sales/reps"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly VanRow[]>("distribution/vans"),
  ]);
  if (!settlements.ok && settlements.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!settlements.ok) {
    const forbidden = settlements.status === 403 || settlements.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, settlements.error, settlements.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <DistributionSettlements
        locale={localeValue}
        initialRows={settlements.data}
        reps={reps.ok ? reps.data : []}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        vans={vans.ok ? vans.data : []}
        today={today}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="distribution/settlements"
      title={d.distributionSettlementsTitle}
    >
      {content}
    </AppShell>
  );
}
