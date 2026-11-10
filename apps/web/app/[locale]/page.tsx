/**
 * Root route (FR-PLT-007 / ADR-0003 / Journey A1): the split surface —
 *
 * - ANONYMOUS visitors get the public marketing landing (hero with the
 *   "ابدأ مجاناً / Start free" CTA into registration, the PROJECT_VISION
 *   feature pillars, the LIVE industry-template registry, and the plans
 *   teaser) — the "marketing site" Next.js hosts alongside the ERP UI.
 * - SESSIONED users keep the previous behavior verbatim: entitlements
 *   resolution redirects reporting users to /dashboard (the nav item's
 *   landing rule, T19-WEB), everyone else gets the admin tiles page.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState, Icon } from "../../components/client-ui";
import type { IconName } from "@erp/ui";

import { AppShell } from "../../components/app-shell";
import { Card } from "../../components/card";
import { DefList } from "../../components/def-list";
import { MarketingLanding } from "../../components/marketing-landing";
import { RetryButton } from "../../components/retry-button";
import { TenantSwitcher, type TenantOption } from "../../components/tenant-switcher";
import { getDictionary, isLocale, type Locale } from "../../i18n/dictionaries";
import type { CurrentSession, DerivedEntitlements, PublicPlanRow, RegistrationOptions } from "../../lib/api-types";
import { localizedApiError, localizedStatus, localizedName, formatMessage } from "../../lib/messages";
import { fetchApi, getSessionToken } from "../../lib/server-api";

const SCREEN_TILES: Array<{ path: string; labelKey: "navUsers" | "navRoles" | "navBranches" | "navSessions" | "navMfa" | "navSettings" | "navSupport" | "navOnboarding" | "navPassword"; icon: IconName }> = [
  { path: "users", labelKey: "navUsers", icon: "users" },
  { path: "roles", labelKey: "navRoles", icon: "users-round" },
  { path: "branches", labelKey: "navBranches", icon: "building" },
  { path: "sessions", labelKey: "navSessions", icon: "lock" },
  { path: "mfa", labelKey: "navMfa", icon: "shield" },
  { path: "settings", labelKey: "navSettings", icon: "settings" },
  { path: "support-sessions", labelKey: "navSupport", icon: "mail" },
  { path: "onboarding", labelKey: "navOnboarding", icon: "book-check" },
  { path: "settings/password", labelKey: "navPassword", icon: "log-in" },
];

export default async function HomePage({
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

  const token = await getSessionToken();
  if (token === undefined) {
    // Anonymous → the public marketing landing (Journey A1). Both public
    // reads run through the BFF exactly like the register/pricing pages;
    // a failed read degrades honestly (null sections never block the page).
    const [optionsResult, plansResult] = await Promise.all([
      fetchApi<RegistrationOptions>("platform/register/options"),
      fetchApi<readonly PublicPlanRow[]>("public/plans"),
    ]);
    return (
      <MarketingLanding
        locale={localeValue}
        options={optionsResult.ok ? optionsResult.data : null}
        plans={plansResult.ok ? plansResult.data : null}
      />
    );
  }

  const current = await fetchApi<CurrentSession>("identity/sessions/current");
  if (!current.ok) {
    if (current.status === 401) {
      redirect(`/${locale}/login`);
    }
    return (
      <AppShell locale={localeValue} pagePath="" title={d.appTitle}>
        <ErrorState
          title={localizedApiError(d, current.error, current.retryAfterSeconds)}
          retry={<RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  // T19-WEB (PHASE-014): entitled users land on the dashboard (the nav item's
  // own gate — reporting.dashboards feature + reporting.reports.run permission,
  // NAVIGATION_MODEL §5 role landing). Non-entitled visitors keep the tiles
  // page below; an entitlements failure falls through honestly (no redirect).
  const entitlements = await fetchApi<DerivedEntitlements>("tenancy/entitlements");
  if (
    entitlements.ok &&
    current.data.permissions.includes("reporting.reports.run") &&
    entitlements.data.featureKeys.includes("reporting.dashboards")
  ) {
    redirect(`/${locale}/dashboard`);
  }

  const session = current.data;
  const activeMembership = session.memberships.find(
    (membership) => membership.tenantId === session.activeTenantId,
  );
  const options: TenantOption[] = session.memberships.map((membership) => ({
    tenantId: membership.tenantId,
    label: localizedName(membership.tenantName, membership.tenantNameAr, localeValue),
    switchable: membership.membershipStatus === "ACTIVE" && membership.tenantStatus === "ACTIVE",
    isActive: membership.tenantId === session.activeTenantId,
    statusText: localizedStatus(d, membership.membershipStatus),
  }));

  const displayName = session.user.fullName === "" ? session.user.email : session.user.fullName;
  const roleKey = activeMembership?.roleKey ?? "—";

  return (
    <AppShell locale={localeValue} pagePath="" title={formatMessage(d.homeWelcome, { name: displayName })}>
      <div className="flex flex-col gap-6">
        <p className="font-mono text-sm text-gray-600">{session.user.email}</p>

        <Card ariaLabel={d.homeTenantLabel} className="w-full max-w-xl">
          <DefList
            items={[
              {
                term: d.homeTenantLabel,
                children:
                  activeMembership === undefined
                    ? "—"
                    : localizedName(
                        activeMembership.tenantName,
                        activeMembership.tenantNameAr,
                        localeValue,
                      ),
              },
              { term: d.homeRoleLabel, children: <span className="font-mono">{roleKey}</span> },
            ]}
          />
          <p className="mt-3 text-sm text-gray-600">
            {formatMessage(d.homePermissionsLabel, { count: session.permissions.length })}
          </p>
        </Card>

        <section aria-label={d.homeSwitchTenant} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.homeSwitchTenant}</h2>
          <TenantSwitcher locale={localeValue} options={options} activeTenantId={session.activeTenantId} />
        </section>

        <section aria-label={d.homeScreens} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.homeScreens}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {SCREEN_TILES.map((tile) => (
              <a
                key={tile.path}
                href={`/${locale}/${tile.path}`}
                className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-card p-4 shadow-e1 outline-none transition-colors duration-150 ease-standard hover:border-strong hover:bg-surface-sunken"
              >
                <Icon name={tile.icon} size={20} className="text-primary-700" />
                <span className="text-sm font-medium text-gray-900">{d[tile.labelKey]}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
