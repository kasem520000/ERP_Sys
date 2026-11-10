/**
 * WEB-037 (PHASE-037) — /{locale}/settings/tax/zatca-devices: the ZATCA
 * Phase-1 (QR) device registry — devices + chain verification + backfill
 * over the tax/zatca/devices routes. The page requires the seeded matrix
 * permission tax.einvoicing.devices.manage (the whole device surface is
 * manage-gated); the manager re-checks the session-derived canManage flag
 * for every write. The branch registry is a tenancy route (separate
 * permission) and degrades to [] — the manager falls back to raw branch
 * ids (the custom-fields entities pattern).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { ZatcaDevicesManager } from "../../../../../components/zatca-devices-manager";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  BranchRow,
  CurrentSession,
  ZatcaDeviceRow,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function ZatcaDevicesPage({
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

  const [devices, session, branches] = await Promise.all([
    fetchApi<{ devices: readonly ZatcaDeviceRow[] }>("tax/zatca/devices"),
    fetchApi<CurrentSession>("identity/sessions/current"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
  ]);
  if (!devices.ok && devices.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!devices.ok) {
    const forbidden = devices.status === 403 || devices.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, devices.error, devices.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <ZatcaDevicesManager
        locale={localeValue}
        initialDevices={devices.data.devices}
        branches={branches.ok ? branches.data : []}
        canManage={permissions.includes("tax.einvoicing.devices.manage")}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="settings/tax/zatca-devices"
      title={d.zatcaDevicesTitle}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.zatcaDevicesSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
