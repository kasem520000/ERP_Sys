"use client";

/**
 * T19-WEB (PHASE-014) — the sandbox checkout workspace (owner-only content;
 * page pre-fetches billing + public plans server-side):
 *
 * (a) plan picker — public plan cards (highlight ribbon, PLACEHOLDER badges,
 *     current plan marked, ?plan= prefill);
 * (b) confirm → POST /tenancy/subscriptions/change-plan {planKey, periodMonths}:
 *     checkout_created ⇒ in-app redirect to /{locale}/checkout?session=…&invoice=…
 *     (the session ref parsed out of the returned provider URL — the sandbox
 *     adapter points it at the web base); downgrade_scheduled ⇒ honest info
 *     panel; 422 tenancy/downgrade-blocked ⇒ the per-blocker list rendered
 *     exactly (usage vs the target plan's ceiling);
 * (c) the open-invoice view — plan, period, amount (PLACEHOLDER badge), due
 *     date; "Pay now (sandbox)" + the clearly-labeled "Simulate payment
 *     failure" demo path → POST /tenancy/subscriptions/checkout/:ref/complete
 *     {outcome} → success / failure states (bilingual, next-step links);
 * (d) read-only grace: the checkout routes are exempt upstream (the resolving
 *     action) — this surface keeps working and says so.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import {
  isRecord,
  type BillingHistoryData,
  type ChangePlanOutcome,
  type CompleteCheckoutOutcome,
  type DowngradeBlocker,
  type PublicPlanRow,
  type SubscriptionInvoiceRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedBillingError } from "../lib/messages";
import { useReadOnly } from "../lib/read-only";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";

// downgrade_scheduled renders as an INFO panel (an honest scheduled change,
// not a success); payment success/failure use their dedicated states below.

type Phase = "picker" | "invoice" | "success" | "failure";

/** Narrow 422 downgrade-blocked details into blockers (storage is untrusted). */
function blockersOf(details: unknown): DowngradeBlocker[] {
  if (!isRecord(details) || !Array.isArray(details.blockers)) {
    return [];
  }
  return details.blockers.filter(
    (value): value is DowngradeBlocker =>
      isRecord(value) &&
      typeof value.limit === "string" &&
      typeof value.usage === "number" &&
      typeof value.limitValue === "number",
  );
}

function limitLabel(d: ReturnType<typeof getDictionary>, limit: string): string {
  switch (limit) {
    case "users":
      return d.checkoutLimitUsers;
    case "branches":
      return d.checkoutLimitBranches;
    case "warehouses":
      return d.checkoutLimitWarehouses;
    default:
      return limit;
  }
}

export function CheckoutWorkspace({
  locale,
  plans,
  billing,
  prefillPlan,
  sessionRef,
  invoiceNumber,
}: {
  locale: Locale;
  plans: readonly PublicPlanRow[];
  billing: BillingHistoryData;
  prefillPlan: string | null;
  sessionRef: string | null;
  invoiceNumber: string | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { readOnly } = useReadOnly();
  const currentPlanKey = billing.plan?.key ?? null;

  const ordered = useMemo(
    () => [...plans].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
    [plans],
  );

  const [phase, setPhase] = useState<Phase>(sessionRef === null ? "picker" : "invoice");
  const [selectedKey, setSelectedKey] = useState<string | null>(
    prefillPlan !== null && ordered.some((plan) => plan.key === prefillPlan) ? prefillPlan : null,
  );
  const [periodMonths, setPeriodMonths] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<readonly DowngradeBlocker[]>([]);
  const [outcomeNotice, setOutcomeNotice] = useState<string | null>(null);
  const [paidInvoice, setPaidInvoice] = useState<SubscriptionInvoiceRow | null>(null);

  const selected = ordered.find((plan) => plan.key === selectedKey) ?? null;
  const targetPlan = (key: string): PublicPlanRow | undefined =>
    ordered.find((plan) => plan.key === key);

  // The invoice for ?session=… (by providerRef, falling back to ?invoice=…).
  const invoice = useMemo<SubscriptionInvoiceRow | null>(() => {
    if (sessionRef === null) {
      return null;
    }
    const byRef = billing.invoices.find((row) => row.providerRef === sessionRef);
    if (byRef !== undefined) {
      return byRef;
    }
    if (invoiceNumber !== null) {
      const byNumber = billing.invoices.find((row) => row.number === invoiceNumber);
      if (byNumber !== undefined) {
        return byNumber;
      }
    }
    return null;
  }, [billing.invoices, sessionRef, invoiceNumber]);

  const invoicePlan = invoice !== null ? targetPlan(invoice.planKey) ?? null : null;

  /** POST change-plan; navigate on checkout_created, honest states otherwise. */
  async function confirmChange(): Promise<void> {
    if (selected === null) {
      return;
    }
    setBusy(true);
    setError(null);
    setBlockers([]);
    setOutcomeNotice(null);
    const result = await bffFetch<ChangePlanOutcome>("tenancy/subscriptions/change-plan", {
      method: "POST",
      body: {
        planKey: selected.key,
        periodMonths: Number.parseInt(periodMonths, 10),
      },
    });
    setBusy(false);
    if (!result.ok) {
      if (result.error.code === "tenancy/downgrade-blocked") {
        setBlockers(blockersOf(result.error.details));
      }
      setError(localizedBillingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const outcome = result.data;
    if (outcome.action === "downgrade_scheduled") {
      setOutcomeNotice(outcome.message[locale]);
      setSelectedKey(null);
      return;
    }
    // checkout_created: the sandbox provider URL points at the web base —
    // parse the session ref out of it and continue in-app.
    let ref: string | null = null;
    if (outcome.checkoutUrl !== undefined) {
      try {
        const parsed = new URL(outcome.checkoutUrl);
        ref = parsed.searchParams.get("session");
      } catch {
        ref = null;
      }
    }
    if (ref === null || ref === "") {
      setError(d.checkoutErrorNoSessionRef);
      return;
    }
    const number = outcome.invoiceNumber ?? "";
    router.push(`/${locale}/checkout?session=${encodeURIComponent(ref)}&invoice=${encodeURIComponent(number)}`);
  }

  /** POST checkout/:ref/complete — the sandbox settle-through-webhook path. */
  async function complete(outcome: "succeeded" | "failed"): Promise<void> {
    if (invoice === null || sessionRef === null) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<CompleteCheckoutOutcome>(
      `tenancy/subscriptions/checkout/${encodeURIComponent(sessionRef)}/complete`,
      { method: "POST", body: { outcome } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedBillingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPaidInvoice(invoice);
    if (result.data.processed === "payment.succeeded" || result.data.processed === "duplicate") {
      setPhase("success");
    } else {
      setPhase("failure");
    }
  }

  const periodOptions = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: formatMessage(d.checkoutPeriodMonths, { months: index + 1 }),
  }));

  return (
    <div className="flex flex-col gap-6">
      {readOnly && <InfoNotice>{d.checkoutGraceNote}</InfoNotice>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {outcomeNotice !== null && <InfoNotice>{outcomeNotice}</InfoNotice>}

      {blockers.length > 0 && (
        <Card title={d.checkoutBlockersTitle} ariaLabel={d.checkoutBlockersTitle}>
          <ul className="flex flex-col gap-2">
            {blockers.map((blocker) => (
              <li key={`${blocker.limit}:${blocker.limitValue}`} className="text-sm text-gray-700">
                {formatMessage(d.checkoutBlockerLine, {
                  usage: blocker.usage,
                  limit: limitLabel(d, blocker.limit),
                  plan: targetPlan(selectedKey ?? "")?.name ?? selectedKey ?? "",
                  limitValue: blocker.limitValue,
                })}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {phase === "invoice" ? (
        invoice === null ? (
          <Card title={d.checkoutSessionTitle} ariaLabel={d.checkoutSessionTitle}>
            <p className="text-sm text-gray-600">{d.checkoutErrorSessionNotFound}</p>
            <div className="mt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setPhase("picker");
                  setError(null);
                }}
              >
                {d.checkoutBackToPlans}
              </Button>
            </div>
          </Card>
        ) : invoice.status !== "OPEN" ? (
          <Card title={d.checkoutSessionTitle} ariaLabel={d.checkoutSessionTitle}>
            <p className="text-sm text-gray-600">{d.checkoutAlreadySettled}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`/${locale}/billing`}
                className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-4 text-sm font-medium text-gray-800 hover:border-strong hover:bg-surface-sunken"
              >
                {d.checkoutGoBilling}
              </a>
            </div>
          </Card>
        ) : (
          <Card
            title={d.checkoutSessionTitle}
            description={formatMessage(d.checkoutInvoiceMeta, {
              number: invoice.number,
              plan: localizedName(
                invoicePlan?.name ?? invoice.planKey,
                invoicePlan?.nameAr ?? null,
                locale,
              ),
            })}
            ariaLabel={d.checkoutSessionTitle}
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-gray-600">{d.checkoutPeriod}</dt>
                <dd dir="ltr" className="font-mono text-sm text-gray-900">
                  {invoice.periodStart} → {invoice.periodEnd}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-gray-600">{d.checkoutDueDate}</dt>
                <dd dir="ltr" className="font-mono text-sm text-gray-900">
                  {invoice.dueDate}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-gray-600">{d.checkoutAmount}</dt>
                <dd className="flex flex-wrap items-baseline gap-2">
                  <span dir="ltr" className="font-mono text-2xl tabular-nums text-gray-900">
                    {invoice.amount} {invoice.currencyCode}
                  </span>
                  {invoice.placeholderPrice && (
                    <span className="inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
                      {d.pricingPlaceholderBadge}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="primary" loading={busy} onClick={() => void complete("succeeded")}>
                {d.checkoutPayNow}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void complete("failed")}>
                {d.checkoutSimulateFailure}
              </Button>
            </div>
            <p className="mt-3 text-xs text-gray-500">{d.checkoutSandboxNote}</p>
          </Card>
        )
      ) : phase === "success" ? (
        <Card title={d.checkoutSuccessTitle} ariaLabel={d.checkoutSuccessTitle}>
          <p className="text-sm text-gray-700">{d.checkoutSuccessBody}</p>
          {paidInvoice !== null && (
            <p dir="ltr" className="mt-2 font-mono text-sm text-gray-600">
              {paidInvoice.number} · {paidInvoice.amount} {paidInvoice.currencyCode}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/${locale}/billing`}
              className="inline-flex min-h-11 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700"
            >
              {d.checkoutGoBilling}
            </a>
            <a
              href={`/${locale}/dashboard`}
              className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-4 text-sm font-medium text-gray-800 hover:border-strong hover:bg-surface-sunken"
            >
              {d.checkoutGoDashboard}
            </a>
          </div>
        </Card>
      ) : phase === "failure" ? (
        <Card title={d.checkoutFailureTitle} ariaLabel={d.checkoutFailureTitle}>
          <p className="text-sm text-gray-700">{d.checkoutFailureBody}</p>
          {paidInvoice !== null && (
            <p dir="ltr" className="mt-2 font-mono text-sm text-gray-600">
              {paidInvoice.number} · {paidInvoice.amount} {paidInvoice.currencyCode}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/${locale}/billing`}
              className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-4 text-sm font-medium text-gray-800 hover:border-strong hover:bg-surface-sunken"
            >
              {d.checkoutGoBilling}
            </a>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPhase("picker");
                setError(null);
              }}
            >
              {d.checkoutBackToPlans}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <section aria-labelledby="checkout-plans-heading" className="flex flex-col gap-4">
            <h2 id="checkout-plans-heading" className="text-md font-semibold text-gray-900">
              {d.checkoutPlansHeading}
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {ordered.map((plan) => {
                const isCurrent = plan.key === currentPlanKey;
                const isSelected = plan.key === selectedKey;
                return (
                  <article
                    key={plan.key}
                    aria-label={localizedName(plan.name, plan.nameAr, locale)}
                    className={`relative flex flex-col gap-3 rounded-lg border bg-surface-card p-4 shadow-e1 ${
                      isSelected ? "border-primary-600" : "border-subtle"
                    } ${plan.highlight && !isSelected ? "shadow-e2" : ""}`}
                  >
                    {plan.highlight && (
                      <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-0.5 text-xs font-medium text-white">
                        {d.pricingHighlightBadge}
                      </span>
                    )}
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {localizedName(plan.name, plan.nameAr, locale)}
                      </h3>
                      {plan.positioning !== null && (
                        <p className="text-xs text-gray-600">{plan.positioning[locale]}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span dir="ltr" className="font-mono text-lg tabular-nums text-gray-900">
                        {plan.priceAmount} {plan.currencyCode}
                      </span>
                      {plan.placeholderPrice && (
                        <span className="inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
                          {d.pricingPlaceholderBadge}
                        </span>
                      )}
                    </div>
                    {isCurrent ? (
                      <span className="inline-flex min-h-11 items-center rounded-md border border-subtle bg-gray-100 px-4 text-sm font-medium text-gray-600">
                        {d.checkoutCurrentPlan}
                      </span>
                    ) : (
                      <Button
                        variant={isSelected ? "primary" : "secondary"}
                        onClick={() => {
                          setSelectedKey(plan.key);
                          setError(null);
                          setBlockers([]);
                          setOutcomeNotice(null);
                        }}
                      >
                        {isSelected ? d.checkoutSelected : d.checkoutChoose}
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {selected !== null && (
            <Card
              title={d.checkoutConfirmTitle}
              description={formatMessage(d.checkoutConfirmMeta, {
                plan: localizedName(selected.name, selected.nameAr, locale),
                price: `${selected.priceAmount} ${selected.currencyCode}`,
              })}
              ariaLabel={d.checkoutConfirmTitle}
            >
              <div className="flex flex-col gap-4 sm:max-w-md">
                <Select
                  id="checkout-period"
                  label={d.checkoutPeriodLabel}
                  value={periodMonths}
                  onValueChange={setPeriodMonths}
                  options={periodOptions}
                />
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" loading={busy} onClick={() => void confirmChange()}>
                    {d.checkoutConfirmButton}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setSelectedKey(null);
                      setBlockers([]);
                      setError(null);
                    }}
                  >
                    {d.checkoutCancelSelection}
                  </Button>
                </div>
                <p className="text-xs text-gray-500">{d.checkoutSandboxNote}</p>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
