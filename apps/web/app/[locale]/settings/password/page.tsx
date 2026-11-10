/**
 * /{locale}/settings/password — authenticated password change
 * (POST /api/bff/identity/password-change { current, next }).
 */
import { notFound } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { ChangePasswordForm } from "../../../../components/change-password-form";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import { requireSessionToken } from "../../../../lib/server-api";

export default async function ChangePasswordPage({
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

  return (
    <AppShell locale={localeValue} pagePath="settings/password" title={d.passwordTitle}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.passwordDescription}</p>
        <ChangePasswordForm locale={localeValue} />
      </div>
    </AppShell>
  );
}
