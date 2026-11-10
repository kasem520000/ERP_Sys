/**
 * /{locale}/mfa — self-service TOTP setup: enroll (secret + otpauth shown
 * as plain text "QR data"), verify, recovery codes (shown once, with a
 * regenerate button). All calls run through the BFF proxy.
 *
 * PHASE-024 T4: `?enforced=1` marks the policy-mandated arrival — the login
 * form exchanged credentials for the 15-minute enrollment-only bootstrap
 * session and routed here; the page passes the flag down so the panel shows
 * the enforced-enrollment notice banner.
 */
import { notFound } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../components/app-shell";
import { MfaPanel } from "../../../components/mfa-panel";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import { requireSessionToken } from "../../../lib/server-api";

export default async function MfaPage({
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

  await requireSessionToken(localeValue);

  const enforced = (await searchParams).enforced === "1";

  return (
    <AppShell locale={localeValue} pagePath="mfa" title={d.mfaTitle}>
      <MfaPanel locale={localeValue} enforced={enforced} />
    </AppShell>
  );
}
