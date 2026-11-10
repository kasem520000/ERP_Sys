/**
 * T19-WEB (PHASE-014) — /{locale}/checkout (session; owner-only content):
 * the sandbox checkout flow over the frozen billing API. The server resolves
 * the billing history + the public plans (through the BFF, envelope-
 * unwrapped) and hands them to the client workspace together with the
 * ?plan= (prefill) / ?session= (resume) / ?invoice= deep-link params.
 * `tenancy.subscription.manage` gates the route server-side (403 renders
 * the honest forbidden state); the checkout routes stay usable during
 * read-only grace upstream (the resolving action — SUBSCRIPTION §8).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { CheckoutWorkspace } from "../../../components/checkout-workspace";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { BillingHistoryData, PublicPlanRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, getSessionToken } from "../../../lib/server-api";

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && raw !== "" ? raw : null;
}

export default async function CheckoutPage({
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
  const query = await searchParams;

  const planParam = firstParam(query.plan);
  const sessionParam = firstParam(query.session);
  const invoiceParam = firstParam(query.invoice);

  // Checkout needs a session — carry the full query through to login.
  const token = await getSessionToken();
  if (token === undefined) {
    const next = `/${locale}/checkout${
      sessionParam !== null
        ? `?session=${encodeURIComponent(sessionParam)}`
        : planParam !== null
          ? `?plan=${encodeURIComponent(planParam)}`
          : ""
    }`;
    redirect(`/${locale}/login?next=${encodeURIComponent(next)}`);
  }

  const [billing, plans] = await Promise.all([
    fetchApi<BillingHistoryData>("tenancy/subscriptions"),
    fetchApi<readonly PublicPlanRow[]>("public/plans"),
  ]);
  if ((!billing.ok && billing.status === 401) || (!plans.ok && plans.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!billing.ok) {
    const forbidden = billing.status === 403 || billing.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={forbidden ? d.errorsForbidden : localizedApiError(d, billing.error, billing.retryAfterSeconds)}
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!plans.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, plans.error, plans.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <CheckoutWorkspace
        locale={localeValue}
        plans={plans.data}
        billing={billing.data}
        prefillPlan={planParam}
        sessionRef={sessionParam}
        invoiceNumber={invoiceParam}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="checkout" title={d.checkoutTitle}>
      {content}
    </AppShell>
  );
}
