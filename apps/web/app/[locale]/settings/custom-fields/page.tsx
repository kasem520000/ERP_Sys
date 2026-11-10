/**
 * /{locale}/settings/custom-fields — the custom-fields extensibility manager
 * (WEB-036 / PHASE-036): definitions, picklists and the form designer over
 * the configuration/custom-fields manager routes. The page requires
 * configuration.custom_fields.read (the seeded matrix key — accountant +
 * owner); the in-screen writes gate on configuration.custom_fields.manage /
 * configuration.form_layouts.manage via the session-derived flags. The
 * entity registry is a session route and degrades to [] on failure (the
 * manager falls back to raw entityType labels).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CustomFieldsManager } from "../../../../components/custom-fields-manager";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  CustomFieldDefinitionRow,
  CustomFieldEntityInfo,
  CustomPicklistRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CustomFieldsPage({
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

  const [definitions, picklists, entities, session] = await Promise.all([
    fetchApi<readonly CustomFieldDefinitionRow[]>("configuration/custom-fields/definitions"),
    fetchApi<readonly CustomPicklistRow[]>("configuration/custom-fields/picklists"),
    fetchApi<readonly CustomFieldEntityInfo[]>("configuration/custom-fields/entities"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!definitions.ok && definitions.status === 401) ||
    (!picklists.ok && picklists.status === 401) ||
    (!entities.ok && entities.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  const failure = !definitions.ok
    ? definitions
    : !picklists.ok
      ? picklists
      : null;
  if (failure !== null) {
    const forbidden = failure.status === 403 || failure.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, failure.error, failure.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!definitions.ok || !picklists.ok) {
    // Unreachable (failure covered above) — keeps the discriminant narrowed.
    content = <ErrorState title={d.errorsGeneric} />;
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <CustomFieldsManager
        locale={localeValue}
        initialDefinitions={definitions.data}
        initialPicklists={picklists.data}
        entities={entities.ok ? entities.data : []}
        canManage={permissions.includes("configuration.custom_fields.manage")}
        canManageLayouts={permissions.includes("configuration.form_layouts.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="settings/custom-fields" title={d.customFieldsTitle}>
      {content}
    </AppShell>
  );
}
