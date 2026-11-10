import type { JSX } from "react";

import { Icon } from "./client-ui";
import type { IconName } from "@erp/ui";

import { getDictionary, otherLocale, type Locale } from "../i18n/dictionaries";
import type { PublicPlanRow, RegistrationOptions } from "../lib/api-types";
import { localizedName } from "../lib/messages";

/**
 * FR-PLT-007 / USER_JOURNEYS Journey A1 / ADR-0003 — the public marketing
 * landing surface anonymous visitors see at `/{locale}` (the "marketing site"
 * the blueprint's ADR-0003 says Next.js hosts alongside the ERP UI).
 *
 * Everything renders from LIVE platform data — no invented numbers:
 * - the industries section lists the ACTIVE registry templates exactly as
 *   `GET /platform/register/options` exposes them (the same public endpoint
 *   the register form consumes — the single source of truth);
 * - the plans teaser carries the plan-seed prices verbatim with the
 *   bilingual OQ-002 placeholder badge (the pricing page's honesty rule);
 * - copy pillars follow PROJECT_VISION (one rigorous core, Arabic-first,
 *   industry configuration, jurisdiction packs, offline-first, one console).
 *
 * Sessioned visitors never see this page — the root route redirects them to
 * the dashboard/tiles surface (NAVIGATION_MODEL §5 role landing).
 */

interface MarketingLandingProps {
  locale: Locale;
  options: RegistrationOptions | null;
  plans: readonly PublicPlanRow[] | null;
}

/** The four hero trust markers (PROJECT_VISION pillars, icon-labeled). */
const TRUST_MARKERS: ReadonlyArray<{ icon: IconName; key: "landingTrustCore" | "landingTrustBilingual" | "landingTrustIndustries" | "landingTrustOffline" }> = [
  { icon: "ledger", key: "landingTrustCore" },
  { icon: "languages", key: "landingTrustBilingual" },
  { icon: "layers", key: "landingTrustIndustries" },
  { icon: "cloud-off", key: "landingTrustOffline" },
];

/** The six feature cards (one per PROJECT_VISION pillar + the platform console). */
const FEATURE_CARDS: ReadonlyArray<{
  icon: IconName;
  titleKey: "landingFeatureCoreTitle" | "landingFeatureBilingualTitle" | "landingFeatureIndustriesTitle" | "landingFeatureJurisdictionTitle" | "landingFeatureOfflineTitle" | "landingFeaturePlatformTitle";
  bodyKey: "landingFeatureCoreBody" | "landingFeatureBilingualBody" | "landingFeatureIndustriesBody" | "landingFeatureJurisdictionBody" | "landingFeatureOfflineBody" | "landingFeaturePlatformBody";
}> = [
  { icon: "ledger", titleKey: "landingFeatureCoreTitle", bodyKey: "landingFeatureCoreBody" },
  { icon: "languages", titleKey: "landingFeatureBilingualTitle", bodyKey: "landingFeatureBilingualBody" },
  { icon: "layers", titleKey: "landingFeatureIndustriesTitle", bodyKey: "landingFeatureIndustriesBody" },
  { icon: "landmark", titleKey: "landingFeatureJurisdictionTitle", bodyKey: "landingFeatureJurisdictionBody" },
  { icon: "cloud-off", titleKey: "landingFeatureOfflineTitle", bodyKey: "landingFeatureOfflineBody" },
  { icon: "building", titleKey: "landingFeaturePlatformTitle", bodyKey: "landingFeaturePlatformBody" },
];

export function MarketingLanding({ locale, options, plans }: MarketingLandingProps): JSX.Element {
  const d = getDictionary(locale);
  const other = otherLocale(locale);
  const registerHref = `/${locale}/register`;
  const pricingHref = `/${locale}/pricing`;
  const loginHref = `/${locale}/login`;
  const templates = options?.industryTemplates ?? [];
  const orderedPlans =
    plans === null ? [] : [...plans].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      {/* Marketing header: brand + language + the Journey-A1 start-free CTA. */}
      <header className="border-b border-subtle bg-surface-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-md font-semibold text-primary-900">{d.appTitle}</span>
          <nav className="flex flex-wrap items-center gap-2" aria-label={d.pricingHaveAccount}>
            <a
              lang={other}
              hrefLang={other}
              href={`/${other}`}
              className="rounded-md px-2 py-1 text-sm text-gray-700 underline-offset-2 outline-none hover:bg-surface-sunken hover:underline"
            >
              {d.switchLabel}
            </a>
            <a
              href={pricingHref}
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-800 underline-offset-2 outline-none hover:bg-surface-sunken hover:underline"
            >
              {d.pricingTitle}
            </a>
            <a
              href={loginHref}
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-800 underline-offset-2 outline-none hover:bg-surface-sunken hover:underline"
            >
              {d.pricingGoLogin}
            </a>
            <a
              href={registerHref}
              className="inline-flex min-h-11 items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white outline-none transition-colors duration-150 ease-standard hover:bg-primary-700"
            >
              {d.landingCtaStartFree}
            </a>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero (Journey A1: the ابدأ مجانًا entry into registration). */}
        <section className="border-b border-subtle bg-surface-card">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-12 sm:py-16">
            <div className="flex flex-col gap-3">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-subtle bg-surface-sunken px-3 py-1 text-xs font-medium text-gray-700">
                <Icon name="layers" size={14} className="text-primary-700" />
                {d.landingKicker}
              </span>
              <h1 lang={locale} className="max-w-3xl text-3xl font-bold leading-tight text-gray-900 sm:text-4xl">
                {d.landingHeroTitle}
              </h1>
              <p lang={locale} className="max-w-2xl text-base text-gray-600">
                {d.landingHeroSubtitle}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={registerHref}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary-600 px-6 py-3 text-base font-semibold text-white outline-none transition-colors duration-150 ease-standard hover:bg-primary-700"
                >
                  {/* (PHASE-035 gate repair: 18 isn't in the token ladder — 20
                  matches the CTA's prominence at this size.) */}
                  <Icon name="user-plus" size={20} />
                  {d.landingCtaStartFree}
                </a>
                <a
                  href={pricingHref}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-default bg-surface-card px-6 py-3 text-base font-medium text-gray-800 outline-none transition-colors duration-150 ease-standard hover:border-strong hover:bg-surface-sunken"
                >
                  {d.landingCtaPricing}
                </a>
              </div>
              <p className="text-sm text-gray-600">{d.landingCtaStartFreeNote}</p>
            </div>
            <ul className="grid w-full gap-3 sm:grid-cols-2">
              {TRUST_MARKERS.map((marker) => (
                <li key={marker.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <Icon name={marker.icon} size={16} className="shrink-0 text-primary-700" />
                  <span lang={locale}>{d[marker.key]}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Feature pillars (PROJECT_VISION). */}
        <section aria-labelledby="landing-features-heading" className="border-b border-subtle">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
            <div className="flex flex-col gap-2">
              <h2 id="landing-features-heading" lang={locale} className="text-2xl font-semibold text-gray-900">
                {d.landingFeaturesHeading}
              </h2>
              <p lang={locale} className="max-w-2xl text-sm text-gray-600">
                {d.landingFeaturesIntro}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {FEATURE_CARDS.map((card) => (
                <article
                  key={card.titleKey}
                  className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-card p-5 shadow-e1"
                >
                  <span className="flex size-10 items-center justify-center rounded-md bg-surface-sunken">
                    <Icon name={card.icon} size={20} className="text-primary-700" />
                  </span>
                  <h3 lang={locale} className="text-md font-semibold text-gray-900">
                    {d[card.titleKey]}
                  </h3>
                  <p lang={locale} className="text-sm leading-6 text-gray-600">
                    {d[card.bodyKey]}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Industries: the LIVE registry templates (the business activities). */}
        <section aria-labelledby="landing-industries-heading" className="border-b border-subtle bg-surface-card">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
            <div className="flex flex-col gap-2">
              <h2 id="landing-industries-heading" lang={locale} className="text-2xl font-semibold text-gray-900">
                {d.landingIndustriesHeading}
                {templates.length > 0 && (
                  <span dir="ltr" className="ms-2 align-middle font-mono text-base tabular-nums text-primary-700">
                    {templates.length}
                  </span>
                )}
              </h2>
              <p lang={locale} className="max-w-2xl text-sm text-gray-600">
                {d.landingIndustriesIntro}
              </p>
            </div>
            {templates.length === 0 ? (
              <p lang={locale} className="text-sm text-gray-600">
                {d.landingIndustriesUnavailable}
              </p>
            ) : (
              <>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {templates.map((template) => (
                    <li
                      key={template.key}
                      className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-page p-4 shadow-e1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span lang={locale} className="text-sm font-semibold text-gray-900">
                          {localizedName(template.name, template.nameAr, locale)}
                        </span>
                        <span
                          dir="ltr"
                          className="shrink-0 rounded-sm border border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-xs leading-4 text-gray-600"
                        >
                          v{template.version}
                        </span>
                      </div>
                      <span dir="ltr" className="font-mono text-xs text-gray-500">
                        {template.key}
                      </span>
                    </li>
                  ))}
                </ul>
                <a
                  href={registerHref}
                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-default bg-surface-card px-5 py-2.5 text-sm font-medium text-gray-800 outline-none transition-colors duration-150 ease-standard hover:border-strong hover:bg-surface-sunken"
                >
                  <Icon name="check" size={16} className="text-primary-700" />
                  {d.landingIndustriesCta}
                </a>
              </>
            )}
          </div>
        </section>

        {/* Plans teaser: the three self-serve plans, seed prices verbatim (OQ-002 badge). */}
        {orderedPlans.length > 0 && (
          <section aria-labelledby="landing-plans-heading" className="border-b border-subtle">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
              <div className="flex flex-col gap-2">
                <h2 id="landing-plans-heading" lang={locale} className="text-2xl font-semibold text-gray-900">
                  {d.landingPlansHeading}
                </h2>
                <p lang={locale} className="max-w-2xl text-sm text-gray-600">
                  {d.landingPlansIntro}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {orderedPlans.map((plan) => (
                  <article
                    key={plan.key}
                    className={`relative flex flex-col gap-3 rounded-lg border bg-surface-card p-5 shadow-e1 ${
                      plan.highlight ? "border-primary-600 shadow-e2" : "border-subtle"
                    }`}
                  >
                    {plan.highlight && (
                      <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-0.5 text-xs font-medium text-white">
                        {d.pricingHighlightBadge}
                      </span>
                    )}
                    <h3 lang={locale} className="text-md font-semibold text-gray-900">
                      {localizedName(plan.name, plan.nameAr, locale)}
                    </h3>
                    {plan.positioning !== null && (
                      <p lang={locale} className="text-sm text-gray-600">
                        {plan.positioning[locale]}
                      </p>
                    )}
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm text-gray-600">{d.pricingMonthly}</span>
                      <span dir="ltr" className="font-mono text-2xl tabular-nums text-gray-900">
                        {plan.priceAmount} {plan.currencyCode}
                      </span>
                    </div>
                    {plan.placeholderPrice && (
                      <span className="w-fit rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
                        {d.pricingPlaceholderBadge}
                      </span>
                    )}
                    <a
                      href={registerHref}
                      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium outline-none transition-colors duration-150 ease-standard ${
                        plan.highlight
                          ? "bg-primary-600 text-white hover:bg-primary-700"
                          : "border border-default bg-surface-card text-gray-800 hover:border-strong hover:bg-surface-sunken"
                      }`}
                    >
                      {d.pricingCta}
                    </a>
                  </article>
                ))}
              </div>
              <a
                href={pricingHref}
                className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-medium text-primary-700 underline-offset-2 hover:underline"
              >
                {d.landingPlansCta}
                <Icon name="arrow-end" size={16} />
              </a>
            </div>
          </section>
        )}
      </main>

      {/* Marketing footer (C-PUB public content). */}
      <footer className="mt-auto border-t border-subtle bg-surface-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p lang={locale} className="max-w-2xl text-sm text-gray-600">
            {d.landingFooterNote}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a href={pricingHref} className="text-primary-700 underline-offset-2 hover:underline">
              {d.pricingTitle}
            </a>
            <a href={loginHref} className="text-primary-700 underline-offset-2 hover:underline">
              {d.pricingGoLogin}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
