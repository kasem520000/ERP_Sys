/**
 * T19-WEB (PHASE-014) — /{locale}/billing (session; owner): the billing home.
 * The server resolves GET /tenancy/subscriptions + GET /tenancy/usage through
 * the BFF (both carry tenancy.subscription.manage server-side — 403 renders
 * the honest forbidden state); the client component renders the plan card,
 * usage meters, billing history and events timeline. Read-only grace keeps
 * this page fully usable (reads + the resolving checkout CTA).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { BillingHistory } from "../../../components/billing-history";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { BillingHistoryData, UsageSnapshotData } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function BillingPage({
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

  const [billing, usage] = await Promise.all([
    fetchApi<BillingHistoryData>("tenancy/subscriptions"),
    fetchApi<UsageSnapshotData>("tenancy/usage"),
  ]);
  if ((!billing.ok && billing.status === 401) || (!usage.ok && usage.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!billing.ok) {
    const forbidden = billing.status === 403 || billing.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, billing.error, billing.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!usage.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, usage.error, usage.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <BillingHistory locale={localeValue} billing={billing.data} usage={usage.data} />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="billing" title={d.billingTitle}>
      {content}
    </AppShell>
  );
}
