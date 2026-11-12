/**
 * PHASE-041 T-10 — /{locale}/settings/communication hub route: the server
 * resolves the effective template catalog (FD-30), the masked provider
 * catalog (BR-067 — credential STATE, never values), the tenant-default
 * preference rows (TB-23), and the current session's permissions (the
 * in-screen writes gate on communication.templates.manage /
 * communication.preferences.manage — the route itself rides
 * templates.manage, so 403 → the forbidden state). Bilingual provider and
 * field labels come FROM the API (the registry is bilingual by contract) —
 * no dictionary duplication.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CommunicationSettingsWorkspace } from "../../../../components/communication-settings-workspace";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CommunicationPreferenceDefault,
  CommunicationProviderCatalog,
  CommunicationTemplate,
  CurrentSession,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CommunicationsSettingsPage({
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

  const [templates, catalog, defaults, session] = await Promise.all([
    fetchApi<readonly CommunicationTemplate[]>("communication/templates"),
    fetchApi<CommunicationProviderCatalog>("communication/providers"),
    fetchApi<readonly CommunicationPreferenceDefault[]>("communication/preferences/defaults"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!templates.ok && templates.status === 401) ||
    (!catalog.ok && catalog.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!templates.ok) {
    const forbidden = templates.status === 403 || templates.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, templates.error, templates.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!catalog.ok) {
    const forbidden = catalog.status === 403 || catalog.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, catalog.error, catalog.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <CommunicationSettingsWorkspace
        locale={localeValue}
        canManage={permissions.includes("communication.templates.manage")}
        canManageDefaults={permissions.includes("communication.preferences.manage")}
        initialTemplates={templates.data}
        initialCatalog={catalog.data}
        // Fail-open to the empty matrix (the defaults tab fetches its own
        // refresh; the honest empty renders when the key is absent).
        initialDefaults={defaults.ok ? defaults.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="settings/communication" title={d.commTitle}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.commSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
