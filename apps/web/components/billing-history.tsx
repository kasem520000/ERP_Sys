"use client";

/**
 * T19-WEB (PHASE-014) — the owner billing home (owner-only; page pre-fetches
 * GET /tenancy/subscriptions + GET /tenancy/usage through the BFF):
 *
 * - current plan card (name, PLACEHOLDER-badged price, period, status chip
 *   with the TRIAL/ACTIVE/PAST_DUE/GRACE_READ_ONLY/SUSPENDED vocabulary,
 *   trial countdown while TRIAL — the ⚠ placeholder trial-days note rides
 *   the payload);
 * - usage meters per counter: progress bar usage/limit, "∞ Unlimited" chip
 *   when unlimited, amber 80% / red 100% chips, and the API's own bilingual
 *   hard-block note per row (documents/month carries the INV-022 note —
 *   posting is never blocked);
 * - billing history table (invoices: number, plan, period, amount, status,
 *   due date, paidVia bilingual map) + the billing events timeline;
 * - plan-change CTA → /{locale}/checkout (works during read-only grace —
 *   it is the resolving action; the grace note says so).
 */
import type { JSX } from "react";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BillingHistoryData,
  UsageSnapshotData,
} from "../lib/api-types";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedBillingEvent,
  localizedStatus,
} from "../lib/messages";
import { useReadOnly } from "../lib/read-only";
import { cx } from "../lib/cx";
import { Card } from "./card";
import { InfoNotice } from "./notices";

type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";

const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};

function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4",
        CHIP_TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

function subscriptionTone(status: string): ChipTone {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "success";
    case "TRIAL":
      return "info";
    case "PAST_DUE":
    case "GRACE_READ_ONLY":
      return "warning";
    case "SUSPENDED":
      return "danger";
    default:
      return "neutral";
  }
}

function invoiceTone(status: string): ChipTone {
  switch (status) {
    case "OPEN":
      return "info";
    case "PAID":
      return "success";
    case "VOID":
      return "neutral";
    case "UNCOLLECTIBLE":
      return "danger";
    default:
      return "neutral";
  }
}

function paidViaLabel(
  d: ReturnType<typeof getDictionary>,
  paidVia: string | null,
): string {
  switch (paidVia) {
    case "provider_webhook":
      return d.billingPaidViaWebhook;
    case "manual_recorded":
      return d.billingPaidViaManual;
    default:
      return "—";
  }
}

/** Whole days from now until an ISO timestamp (never negative; integer
 *  arithmetic — |0 truncation mirrors the repo's rate-limiter convention,
 *  never float rounding helpers). */
function daysUntil(iso: string | null): number {
  if (iso === null) {
    return 0;
  }
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) {
    return 0;
  }
  const diff = Math.max(0, target - Date.now());
  return (diff + 86_399_999) / 86_400_000 | 0;
}

export function BillingHistory({
  locale,
  billing,
  usage,
}: {
  locale: Locale;
  billing: BillingHistoryData;
  usage: UsageSnapshotData;
}): JSX.Element {
  const d = getDictionary(locale);
  const { readOnly, graceEndsAt } = useReadOnly();
  const subscription = billing.subscription;
  const plan = billing.plan;
  const planKey = plan?.key ?? usage.plan?.key ?? null;
  const planName =
    plan !== null
      ? plan.name
      : usage.plan !== null
        ? usage.plan.name
        : "";
  const planNameAr =
    plan !== null ? plan.nameAr : usage.plan !== null ? usage.plan.nameAr : null;
  const priceAmount = plan?.priceAmount ?? usage.plan?.priceAmount ?? "0";
  const currencyCode = plan?.currencyCode ?? usage.plan?.currencyCode ?? "SAR";
  const placeholderPrice = usage.plan !== null ? usage.plan.placeholderPrice : true;
  const trialDays = daysUntil(subscription?.trialEndsAt ?? null);

  return (
    <div className="flex flex-col gap-6">
      {readOnly && (
        <InfoNotice>
          {formatMessage(d.billingGraceNote, {
            date: graceEndsAt !== null ? formatDateTime(graceEndsAt, locale) : "—",
          })}
        </InfoNotice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={d.billingPlanCardTitle} ariaLabel={d.billingPlanCardTitle}>
          {subscription === null || planKey === null ? (
            <p className="text-sm text-gray-600">{d.billingNoSubscription}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-md font-semibold text-gray-900">
                  {localizedName(planName, planNameAr, locale)}
                </h3>
                <span dir="ltr" className="font-mono text-xs text-gray-500">
                  {planKey}
                </span>
                <Chip tone={subscriptionTone(subscription.status)}>
                  {localizedStatus(d, subscription.status)}
                </Chip>
              </div>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm text-gray-600">{d.billingPrice}</span>
                <span dir="ltr" className="font-mono text-xl tabular-nums text-gray-900">
                  {priceAmount} {currencyCode}
                </span>
                {placeholderPrice && (
                  <span className="inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
                    {d.pricingPlaceholderBadge}
                  </span>
                )}
              </div>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-gray-500">{d.billingPeriod}</dt>
                  <dd dir="ltr" className="font-mono text-sm text-gray-800">
                    {subscription.periodStart} → {subscription.periodEnd}
                  </dd>
                </div>
                {subscription.status === "TRIAL" && (
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-gray-500">{d.billingTrialEndsAt}</dt>
                    <dd className="text-sm text-gray-800">
                      {formatMessage(d.billingTrialCountdown, { days: trialDays })}
                      <span className="mt-1 block text-xs text-gray-500">
                        {formatMessage(d.billingTrialDaysNote, {
                          days: billing.trialDaysPlaceholder,
                        })}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <div className="mt-4 border-t border-subtle pt-4">
            <a
              href={`/${locale}/checkout`}
              className="inline-flex min-h-11 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors duration-150 ease-standard hover:bg-primary-700"
            >
              {d.billingChangePlan}
            </a>
          </div>
        </Card>

        <Card title={d.billingUsageTitle} ariaLabel={d.billingUsageTitle}>
          <ul className="flex flex-col gap-4">
            {usage.counters.map((counter) => {
              const unlimited = counter.limit === "unlimited";
              const limitValue: number = counter.limit === "unlimited" ? 0 : counter.limit;
              const ratio = limitValue <= 0 ? 0 : counter.usage / limitValue;
              // Visual meter only (never money) — |0 truncation per the
              // rate-limiter convention; ADR-0009 targets money math.
              const pct = Math.min(100, (ratio * 100) | 0);
              return (
                <li key={counter.key} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">
                      {counter.label[locale]}
                    </span>
                    <span dir="ltr" className="font-mono text-sm tabular-nums text-gray-700">
                      {counter.usage} / {unlimited ? "∞" : counter.limit}
                    </span>
                    {unlimited ? (
                      <Chip tone="neutral">{d.billingUnlimited}</Chip>
                    ) : counter.warn100 ? (
                      <Chip tone="danger">{d.billingWarn100}</Chip>
                    ) : counter.warn80 ? (
                      <Chip tone="warning">{d.billingWarn80}</Chip>
                    ) : null}
                  </div>
                  {!unlimited && (
                    <div
                      className="h-2 w-full max-w-md overflow-hidden rounded-full bg-gray-100"
                      role="progressbar"
                      aria-valuenow={counter.usage}
                      aria-valuemin={0}
                      aria-valuemax={limitValue}
                      aria-label={counter.label[locale]}
                    >
                      <div
                        className={cx(
                          "h-2 rounded-full",
                          counter.warn100 ? "bg-danger-700" : counter.warn80 ? "bg-warning-700" : "bg-primary-600",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {counter.note !== null && (
                    <p className="max-w-xl text-xs text-gray-500">{counter.note[locale]}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <section aria-labelledby="billing-invoices-heading" className="flex flex-col gap-3">
        <h2 id="billing-invoices-heading" className="text-md font-semibold text-gray-900">
          {d.billingInvoicesTitle}
        </h2>
        {billing.invoices.length === 0 ? (
          <p className="text-sm text-gray-600">{d.billingNoInvoices}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 border-collapse text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                    {d.billingColNumber}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                    {d.billingColPlan}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                    {d.billingColPeriod}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold text-gray-800">
                    {d.billingColAmount}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                    {d.usersColStatus}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                    {d.billingColDueDate}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                    {d.billingColPaidVia}
                  </th>
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-subtle">
                    <td dir="ltr" className="px-3 py-2 font-mono text-gray-900">
                      {invoice.number}
                    </td>
                    <td dir="ltr" className="px-3 py-2 font-mono text-xs text-gray-600">
                      {invoice.planKey}
                    </td>
                    <td dir="ltr" className="px-3 py-2 font-mono text-xs text-gray-600">
                      {invoice.periodStart} → {invoice.periodEnd}
                    </td>
                    <td className="px-3 py-2 text-end">
                      <span dir="ltr" className="font-mono tabular-nums text-gray-900">
                        {invoice.amount} {invoice.currencyCode}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={invoiceTone(invoice.status)}>
                        {invoice.status}
                      </Chip>
                    </td>
                    <td dir="ltr" className="px-3 py-2 font-mono text-xs text-gray-600">
                      {invoice.dueDate}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {paidViaLabel(d, invoice.paidVia)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="billing-events-heading" className="flex flex-col gap-3">
        <h2 id="billing-events-heading" className="text-md font-semibold text-gray-900">
          {d.billingEventsTitle}
        </h2>
        {billing.events.length === 0 ? (
          <p className="text-sm text-gray-600">{d.billingNoEvents}</p>
        ) : (
          <ol className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {billing.events.map((event) => (
              <li
                key={event.id}
                className="flex flex-col gap-0.5 border-s-2 border-subtle ps-3"
              >
                <span className="text-sm font-medium text-gray-800">
                  {localizedBillingEvent(d, event.type)}
                </span>
                <span dir="ltr" className="font-mono text-xs text-gray-500">
                  {formatDateTime(event.createdAt, locale)}
                  {event.viaPlatformAdmin ? ` · ${d.billingViaPlatformAdmin}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
