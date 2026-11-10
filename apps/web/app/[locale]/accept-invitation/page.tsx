/**
 * /{locale}/accept-invitation?token=... — public. Loads the invitation
 * view through the BFF (GET), shows tenant + role + invited email, and
 * renders the acceptance form. Errors map by code/reason:
 * NOT_FOUND → invalid link; VALIDATION_ERROR.reason → expired / revoked /
 * accepted.
 */
import { notFound } from "next/navigation";
import type { JSX } from "react";

import { AcceptInvitationForm } from "../../../components/accept-invitation-form";
import { DefList } from "../../../components/def-list";
import { PublicShell } from "../../../components/public-shell";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { InvitationView } from "../../../lib/api-types";
import { formatDateTime, localizedInvitationError, localizedName } from "../../../lib/messages";
import { fetchApi } from "../../../lib/server-api";
import { ErrorNotice } from "../../../components/notices";

export default async function AcceptInvitationPage({
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
  const d = getDictionary(locale);
  const localeValue = locale as Locale;

  const query = await searchParams;
  const rawToken = query.token;
  const token = typeof rawToken === "string" ? rawToken : undefined;

  if (token === undefined || token === "") {
    return (
      <PublicShell locale={locale} pagePath="accept-invitation" title={d.acceptTitle}>
        <ErrorNotice>{d.acceptErrorNotFound}</ErrorNotice>
      </PublicShell>
    );
  }

  const view = await fetchApi<InvitationView>(
    `identity/invitations/accept?token=${encodeURIComponent(token)}`,
  );

  if (!view.ok) {
    return (
      <PublicShell locale={locale} pagePath="accept-invitation" title={d.acceptTitle}>
        <ErrorNotice>{localizedInvitationError(d, view.error)}</ErrorNotice>
      </PublicShell>
    );
  }

  const invitation = view.data;
  return (
    <PublicShell locale={locale} pagePath="accept-invitation" title={d.acceptTitle}>
      <div className="flex flex-col gap-4">
        <DefList
          items={[
            {
              term: d.acceptTenantLabel,
              children: localizedName(invitation.tenantName, invitation.tenantNameAr, localeValue),
            },
            {
              term: d.acceptRoleLabel,
              children: (
                <span>
                  {localizedName(invitation.roleName, invitation.roleNameAr, localeValue)}{" "}
                  <span className="font-mono text-xs text-gray-500">({invitation.roleKey})</span>
                </span>
              ),
            },
            { term: d.acceptEmailLabel, children: invitation.email },
            { term: d.usersColExpires, children: formatDateTime(invitation.expiresAt, localeValue) },
          ]}
        />
        <AcceptInvitationForm locale={locale} token={token} />
      </div>
    </PublicShell>
  );
}
