/**
 * T19-WEB (PHASE-014) — /{locale}/pricing (PUBLIC, route group (marketing)):
 * the bilingual pricing page driven by GET /api/v1/public/plans through the
 * BFF (public route — no session required; the register page's pattern).
 * Prices render from the plan seeds ONLY (PLACEHOLDER ⚠ OQ-002): every
 * number on this page comes from the payload verbatim and carries the
 * bilingual placeholder badge — nothing is hard-coded. Plan cards (highlight
 * ribbon on the seeded `highlight` row) + the honest feature matrix derived
 * from `featureKeys` (family rows per SUBSCRIPTION_AND_ENTITLEMENTS §2; the
 * cell shows the plan's key count over the three-plan union). CTAs head to
 * checkout honestly: anonymous visitors pass through
 * `login?next=/{locale}/checkout?plan=…` (signup entry); sessioned visitors
 * link straight into checkout.
 */
import { notFound } from "next/navigation";
import type { JSX } from "react";

import { ErrorNotice, InfoNotice } from "../../../../components/notices";
import { PublicShell } from "../../../../components/public-shell";
import { getDictionary, isLocale, type Dictionary, type Locale } from "../../../../i18n/dictionaries";
import type { PublicPlanRow } from "../../../../lib/api-types";
import { formatMessage, localizedName, localizedApiError } from "../../../../lib/messages";
import { fetchApi, getSessionToken } from "../../../../lib/server-api";

/**
 * Feature-matrix families (SUBSCRIPTION_AND_ENTITLEMENTS §2 "Feature keys
 * per plan"): every featureKeys entry lands in exactly one family by
 * prefix — the growth-tier row covers the remaining v2.0 keys so the matrix
 * never silently drops a key the plans actually carry.
 */
const FEATURE_FAMILIES: ReadonlyArray<{
  id: string;
  labelKey: keyof Dictionary;
  prefixes: readonly string[];
}> = [
  { id: "platform", labelKey: "pricingFamilyPlatform", prefixes: ["platform."] },
  { id: "accounting", labelKey: "pricingFamilyAccounting", prefixes: ["accounting."] },
  {
    id: "trade",
    labelKey: "pricingFamilyTrade",
    prefixes: ["partners.", "items.", "inventory.", "sales.", "purchasing."],
  },
  { id: "treasury-tax", labelKey: "pricingFamilyTreasuryTax", prefixes: ["treasury.", "tax."] },
  { id: "reporting", labelKey: "pricingFamilyReporting", prefixes: ["reporting."] },
  {
    id: "growth",
    labelKey: "pricingFamilyGrowth",
    prefixes: ["pos.", "industry.", "crm.", "manufacturing.", "distribution.", "offline."],
  },
];

function keysInFamily(plan: PublicPlanRow, prefixes: readonly string[]): string[] {
  return plan.featureKeys.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

/** The PLACEHOLDER badge (OQ-002) — bilingual, warning tone, always visible. */
function PlaceholderBadge({ d }: { d: Dictionary }): JSX.Element {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
      {d.pricingPlaceholderBadge}
    </span>
  );
}

export default async function PricingPage({
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

  // Public route — works with or without a session (like register options).
  const plans = await fetchApi<readonly PublicPlanRow[]>("public/plans");
  // Honest CTA: checkout needs a session. Anonymous → login?next=…; a
  // sessioned visitor links straight into the checkout prefill.
  const token = await getSessionToken();

  if (!plans.ok) {
    return (
      <PublicShell locale={localeValue} pagePath="pricing" title={d.pricingTitle}>
        <ErrorNotice>{localizedApiError(d, plans.error, plans.retryAfterSeconds)}</ErrorNotice>
      </PublicShell>
    );
  }

  const rows = plans.data;
  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

  return (
    <PublicShell locale={localeValue} pagePath="pricing" title={d.pricingTitle} layout="page">
      <p className="max-w-2xl text-sm text-gray-600">{d.pricingIntro}</p>
      <InfoNotice>{d.pricingPlaceholderNote}</InfoNotice>

      <section id="plans" aria-labelledby="pricing-plans-heading" className="flex flex-col gap-4">
        <h2 id="pricing-plans-heading" className="text-lg font-semibold text-gray-900">
          {d.pricingPlansHeading}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {ordered.map((plan) => {
            const ctaHref =
              token === undefined
                ? `/${locale}/login?next=${encodeURIComponent(`/${locale}/checkout?plan=${plan.key}`)}`
                : `/${locale}/checkout?plan=${encodeURIComponent(plan.key)}`;
            return (
              <article
                key={plan.key}
                aria-label={localizedName(plan.name, plan.nameAr, localeValue)}
                className={`relative flex flex-col gap-4 rounded-lg border bg-surface-card p-5 shadow-e1 ${
                  plan.highlight ? "border-primary-600 shadow-e2" : "border-subtle"
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-0.5 text-xs font-medium text-white">
                    {d.pricingHighlightBadge}
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  <h3 className="text-md font-semibold text-gray-900">
                    {localizedName(plan.name, plan.nameAr, localeValue)}
                  </h3>
                  {plan.positioning !== null && (
                    <p className="text-sm text-gray-600">{plan.positioning[localeValue]}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm text-gray-600">{d.pricingMonthly}</span>
                    <span dir="ltr" className="font-mono text-2xl tabular-nums text-gray-900">
                      {plan.priceAmount} {plan.currencyCode}
                    </span>
                    {plan.placeholderPrice && <PlaceholderBadge d={d} />}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm text-gray-600">{d.pricingAnnual}</span>
                    <span dir="ltr" className="font-mono text-sm tabular-nums text-gray-700">
                      {plan.annualPriceAmount} {plan.currencyCode}
                    </span>
                    {plan.placeholderPrice && <PlaceholderBadge d={d} />}
                  </div>
                  <span
                    dir="ltr"
                    className="w-fit rounded-sm border border-subtle bg-gray-100 px-1.5 py-0.5 font-mono text-xs leading-4 text-gray-600"
                  >
                    {plan.billingPeriod}
                  </span>
                </div>
                <a
                  href={ctaHref}
                  className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium outline-none transition-colors duration-150 ease-standard ${
                    plan.highlight
                      ? "bg-primary-600 text-white hover:bg-primary-700"
                      : "border border-default bg-surface-card text-gray-800 hover:border-strong hover:bg-surface-sunken"
                  }`}
                >
                  {d.pricingCta}
                </a>
              </article>
            );
          })}
        </div>
      </section>

      <section id="matrix" aria-labelledby="pricing-matrix-heading" className="flex flex-col gap-3">
        <h2 id="pricing-matrix-heading" className="text-lg font-semibold text-gray-900">
          {d.pricingMatrixHeading}
        </h2>
        <p className="max-w-2xl text-sm text-gray-600">{d.pricingMatrixHint}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 border-collapse text-sm">
            <thead>
              <tr className="border-b border-subtle">
                <th scope="col" className="px-3 py-2 text-start font-semibold text-gray-800">
                  {d.pricingMatrixArea}
                </th>
                {ordered.map((plan) => (
                  <th
                    key={plan.key}
                    scope="col"
                    className="px-3 py-2 text-end font-semibold text-gray-800"
                  >
                    {localizedName(plan.name, plan.nameAr, localeValue)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_FAMILIES.map((family) => {
                const union = new Set<string>();
                for (const plan of ordered) {
                  for (const key of keysInFamily(plan, family.prefixes)) {
                    union.add(key);
                  }
                }
                return (
                  <tr key={family.id} className="border-t border-subtle">
                    <th scope="row" className="px-3 py-2 text-start font-normal text-gray-700">
                      {d[family.labelKey]}
                    </th>
                    {ordered.map((plan) => {
                      const present = keysInFamily(plan, family.prefixes).length;
                      const total = union.size;
                      return (
                        <td key={plan.key} className="px-3 py-2 text-end">
                          <span dir="ltr" className="font-mono tabular-nums text-gray-900">
                            ✓ {present}/{total}
                          </span>
                          <span className="sr-only">
                            {formatMessage(d.pricingMatrixCellOf, { present, total })}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4 text-sm text-gray-600">
        <span>{d.pricingHaveAccount}</span>
        <a href={`/${locale}/login`} className="text-primary-700 underline-offset-2 hover:underline">
          {d.pricingGoLogin}
        </a>
      </p>
    </PublicShell>
  );
}
