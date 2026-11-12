/**
 * PHASE-041 T-10 — /{locale}/communication/inbox: the unified inbox
 * (UX-14/IN-16). The server resolves the first timeline page (tenant-wide
 * — the workspace re-queries with partner/kind/channel/direction filters),
 * the partner list (the call logger's pick list), and the caller's own
 * preference matrix (TB-23 self plane — GET preferences/me is a session
 * route, no permission key). The route rides communication.inbox.read
 * (403 → the forbidden state).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { CommunicationInboxWorkspace } from "../../../../components/communication-inbox-workspace";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CommunicationInboxEntry,
  CommunicationPreferenceRow,
  PartnerRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function CommunicationsInboxPage({
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

  const [timeline, partners, prefs] = await Promise.all([
    fetchApi<readonly CommunicationInboxEntry[]>("communication/inbox?limit=100"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly CommunicationPreferenceRow[]>("communication/preferences/me"),
  ]);
  if ((!timeline.ok && timeline.status === 401) || (!partners.ok && partners.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!timeline.ok) {
    const forbidden = timeline.status === 403 || timeline.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, timeline.error, timeline.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <CommunicationInboxWorkspace
        locale={localeValue}
        initialTimeline={timeline.data}
        partners={partners.ok ? partners.data : []}
        // Fail-open to the code-default matrix (the tab re-fetches on
        // first toggle; defaults render honestly when the read fails).
        initialPrefs={prefs.ok ? prefs.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="communication/inbox" title={d.commInboxTitle}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.commInboxSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
