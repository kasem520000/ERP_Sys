/**
 * PHASE-015 T11 (task 3-a) — /{locale}/settings/templates (session): the
 * admin "Industry & templates" screen. The server resolves, in one parallel
 * batch (all session routes):
 *
 * - the current session (permissions — `configuration.templates.apply` gates
 *   every mutating action; the screen itself stays readable);
 * - the effective config (L1 applied template + the merged policy map);
 * - the ACTIVE template registry + each template's detail (manifest +
 *   capability preview resolved against the CALLER's entitlements, and — for
 *   the applied key — the appliedHere version/hash pin).
 *
 * The permission-bearing drift-check POST runs client-side only for holders
 * of `configuration.templates.apply` (it both checks and RECORDS the offer).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TemplatesAdmin } from "../../../../components/templates-admin";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  IndustryTemplateDetail,
  IndustryTemplateRow,
} from "../../../../lib/api-types";
import { fetchEffectiveConfig } from "../../../../lib/effective-config";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TemplatesPage({
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

  const [session, registry, effective] = await Promise.all([
    fetchApi<CurrentSession>("identity/sessions/current"),
    fetchApi<readonly IndustryTemplateRow[]>("configuration/templates"),
    fetchEffectiveConfig(),
  ]);
  if (!session.ok && session.status === 401) {
    redirect(`/${locale}/login`);
  }

  if (!session.ok) {
    const forbidden = session.status === 403 || session.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath="settings/templates" title={d.templatesTitle}>
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, session.error, session.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  // Per-template capability previews (+ appliedHere for the applied key).
  const registryRows = registry.ok ? registry.data : [];
  const details = await Promise.all(
    registryRows.map(async (row) => {
      const detail = await fetchApi<IndustryTemplateDetail>(
        `configuration/templates/${encodeURIComponent(row.key)}`,
      );
      return detail.ok ? ([row.key, detail.data] as const) : null;
    }),
  );
  const detailMap = new Map(
    details.filter((entry): entry is readonly [string, IndustryTemplateDetail] => entry !== null),
  );

  return (
    <AppShell locale={localeValue} pagePath="settings/templates" title={d.templatesTitle}>
      {registry.ok ? (
        <TemplatesAdmin
          locale={localeValue}
          canApply={session.data.permissions.includes("configuration.templates.apply")}
          registry={registryRows}
          details={detailMap}
          effective={effective ?? null}
        />
      ) : (
        <ErrorState
          title={localizedApiError(d, registry.error, registry.retryAfterSeconds)}
          retry={<RetryButton label={d.retryLabel} />}
        />
      )}
    </AppShell>
  );
}
