/**
 * /{locale}/roles — roles editor (identity.roles.assign plane): tenant
 * roles table + system templates table with clone buttons
 * (POST /api/bff/identity/roles/clone-template { templateKey }).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { RetryButton } from "../../../components/retry-button";
import { RolesTable } from "../../../components/roles-table";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { RolesData } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function RolesPage({
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

  const roles = await fetchApi<RolesData>("identity/roles");
  if (!roles.ok && roles.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!roles.ok) {
    content = (
      <ErrorState
        title={localizedApiError(d, roles.error, roles.retryAfterSeconds)}
        retry={<RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-6">
        <p className="text-sm text-gray-600">{d.rolesDescription}</p>
        <section aria-label={d.rolesTenantTitle} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.rolesTenantTitle}</h2>
          <RolesTable locale={localeValue} roles={roles.data.tenantRoles} withClone={false} emptyTitle={d.rolesEmpty} />
        </section>
        <section aria-label={d.rolesTemplatesTitle} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.rolesTemplatesTitle}</h2>
          <RolesTable locale={localeValue} roles={roles.data.systemTemplates} withClone emptyTitle={d.rolesEmpty} />
        </section>
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="roles" title={d.rolesTitle}>
      {content}
    </AppShell>
  );
}
