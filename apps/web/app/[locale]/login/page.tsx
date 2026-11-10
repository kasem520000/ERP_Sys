/**
 * /{locale}/login — public. Already signed in → home. The form posts to the
 * dedicated BFF session route (POST /api/bff/session) which sets the
 * httpOnly session cookie; this component never touches the raw token.
 * T19-WEB (PHASE-014): `?next=…` (the pricing CTAs) redirects there after
 * login when it is an internal locale-prefixed path (shape-validated; any
 * other value is ignored — open-redirect safe).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { LoginForm } from "../../../components/login-form";
import { PublicShell } from "../../../components/public-shell";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import { getSessionToken } from "../../../lib/server-api";

/** Only internal locale-prefixed paths are honored (open-redirect guard). */
function safeNext(rawNext: string | string[] | undefined, locale: Locale): string | undefined {
  const value = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  if (value === undefined) {
    return undefined;
  }
  return value.startsWith(`/${locale}/`) && !value.startsWith(`/${locale}//`) ? value : undefined;
}

export default async function LoginPage({
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

  const token = await getSessionToken();
  if (token !== undefined) {
    redirect(`/${locale}`);
  }

  const next = safeNext((await searchParams).next, localeValue);

  return (
    <PublicShell locale={localeValue} pagePath="login" title={d.loginTitle}>
      <LoginForm locale={localeValue} next={next} />
      <p>
        <a
          href={`/${locale}/forgot-password`}
          className="text-sm text-primary-700 underline-offset-2 hover:underline"
        >
          {d.loginForgotLink}
        </a>
      </p>
      {/* Journey A1 funnel: visitors without an account head to the public
          registration (the marketing landing/pricing CTAs land there too). */}
      <p className="flex flex-wrap items-center gap-1 text-sm text-gray-600">
        <span>{d.loginNoAccount}</span>
        <a
          href={`/${locale}/register`}
          className="font-medium text-primary-700 underline-offset-2 hover:underline"
        >
          {d.landingCtaStartFree}
        </a>
      </p>
      {/* PHASE-024 T14: discreet link to the public security disclosure
          policy page (reachable without a session). */}
      <p className="text-xs text-gray-500">
        <a
          href={`/${locale}/security`}
          className="underline-offset-2 hover:text-gray-700 hover:underline"
        >
          {d.loginSecurityLink}
        </a>
      </p>
    </PublicShell>
  );
}
