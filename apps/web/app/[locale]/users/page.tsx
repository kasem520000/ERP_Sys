/**
 * /{locale}/users — tenant users + invitations + invite form (requires
 * identity.users.view; 403 → "no permission" message). Data flows through
 * the BFF's internal fetch; all mutations go through the BFF proxy with
 * the CSRF echo handled by the client wrapper.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { Card } from "../../../components/card";
import { InvitationsTable } from "../../../components/invitations-table";
import { InviteForm } from "../../../components/invite-form";
import { ErrorNotice } from "../../../components/notices";
import { RetryButton } from "../../../components/retry-button";
import { UsersTable } from "../../../components/users-table";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { InvitationView, RolesData, TenantUserRow } from "../../../lib/api-types";
import { localizedApiError, localizedName } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function UsersPage({
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

  const users = await fetchApi<readonly TenantUserRow[]>("identity/users");
  if (!users.ok && users.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!users.ok) {
    const forbidden = users.status === 403 || users.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.usersNoPermission
            : localizedApiError(d, users.error, users.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const [invitations, roles] = await Promise.all([
      fetchApi<readonly InvitationView[]>("identity/invitations"),
      fetchApi<RolesData>("identity/roles"),
    ]);

    content = (
      <div className="flex flex-col gap-6">
        <section aria-label={d.usersTitle} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.usersTitle}</h2>
          <UsersTable locale={localeValue} rows={users.data} />
        </section>

        {roles.ok ? (
          <Card title={d.usersInviteTitle} ariaLabel={d.usersInviteTitle} className="w-full max-w-xl">
            <InviteForm
              locale={localeValue}
              roles={roles.data.tenantRoles.map((role) => ({
                id: role.id,
                label: localizedName(role.name, role.nameAr, localeValue),
                key: role.key,
              }))}
            />
          </Card>
        ) : (
          roles.status !== 403 && (
            <ErrorNotice>
              {localizedApiError(d, roles.error, roles.retryAfterSeconds)}
            </ErrorNotice>
          )
        )}

        <section aria-label={d.usersInvitationsTitle} className="flex flex-col gap-2">
          <h2 className="text-md font-semibold text-gray-900">{d.usersInvitationsTitle}</h2>
          {!invitations.ok ? (
            invitations.status !== 403 && (
              <ErrorNotice>
                {localizedApiError(d, invitations.error, invitations.retryAfterSeconds)}
              </ErrorNotice>
            )
          ) : (
            <InvitationsTable locale={localeValue} rows={invitations.data} />
          )}
        </section>
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="users" title={d.usersTitle}>
      {content}
    </AppShell>
  );
}
