/**
 * T19-WEB (PHASE-014) + PHASE-015 T11 (3-a) — /{locale}/onboarding
 * (session): the workspace wizard (Journey A), now opening with the industry
 * step. The server pre-checks the session (401 → login) and — since every
 * member may read the derived entitlements payload — hides the wizard with a
 * feature notice when `platform.onboarding` is not granted. The page also
 * resolves GET /tenancy/settings (journey resume state), the tenant profile
 * (base currency for the invoice step), and GET /configuration/effective-config
 * (the applied industry template — L1 — so a resumed wizard shows the honest
 * already-applied state instead of re-offering a selection); the wizard
 * itself posts to the BFF routes (provision, template apply, items, partners,
 * sales invoices, journey_state PUTs).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { InfoNotice } from "../../../components/notices";
import { OnboardingWizard, isJourneyStateValue } from "../../../components/onboarding-wizard";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import { ONBOARDING_FEATURE_KEY } from "../../../lib/constants";
import type {
  DerivedEntitlements,
  JourneyStateValue,
  TenantProfile,
  TenantSettingsMap,
} from "../../../lib/api-types";
import { appliedTemplateOf, fetchEffectiveConfig } from "../../../lib/effective-config";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function OnboardingPage({
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

  // The provision route needs tenancy.settings.manage — the same permission
  // as the profile read, so a profile 401/403 decides access up front.
  const profile = await fetchApi<TenantProfile>("tenancy/profile");
  if (!profile.ok && profile.status === 401) {
    redirect(`/${locale}/login`);
  }

  const [entitlements, settings, effective] = await Promise.all([
    fetchApi<DerivedEntitlements>("tenancy/entitlements"),
    fetchApi<TenantSettingsMap>("tenancy/settings"),
    // PHASE-015: the applied template (L1) — fail-open (undefined ⇒ no template
    // shown; the wizard's industry step still works from the registry reads).
    fetchEffectiveConfig(),
  ]);
  const canProvision =
    !entitlements.ok || entitlements.data.featureKeys.includes(ONBOARDING_FEATURE_KEY);

  let content: JSX.Element;
  if (!profile.ok) {
    const forbidden = profile.status === 403 || profile.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, profile.error, profile.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!canProvision) {
    content = <InfoNotice>{d.tenancyErrorFeatureNotEntitled}</InfoNotice>;
  } else {
    // Journey resume: the recorded milestone decides where the wizard starts.
    const rawJourney = settings.ok
      ? (settings.data["platform.onboarding.journey_state"] as unknown)
      : undefined;
    const initialJourney: JourneyStateValue | null =
      rawJourney !== undefined && isJourneyStateValue(rawJourney) ? rawJourney : null;
    content = (
      <OnboardingWizard
        locale={localeValue}
        baseCurrency={profile.data.baseCurrency}
        initialJourney={initialJourney}
        appliedTemplate={appliedTemplateOf(effective)}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="onboarding" title={d.onboardingTitle}>
      {content}
    </AppShell>
  );
}
