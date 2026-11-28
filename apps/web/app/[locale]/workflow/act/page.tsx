/**
 * /{locale}/workflow/act?token=… — THE DEEP-LINK LANDING (PHASE-052
 * W-48, T-06's web half — D-09): the email leg's own target (the
 * module's mail renders `${WEB_BASE_URL}/{locale}/workflow/act?token=…`).
 * THE LAW: the link AUTHORIZES, the session AUTHENTICATES — the page
 * requires the session (an unauthenticated visit lands on the login
 * and returns), then renders the token's own preview + act through the
 * engine's floors (a dead link previews as the typed refusal, never a
 * stale form).
 */
import { notFound } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { WorkflowActSurface } from "../../../../components/workflow-act-surface";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import { requireSessionToken } from "../../../../lib/server-api";

export default async function WorkflowActPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const { token } = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  return (
    <AppShell locale={localeValue} pagePath="workflow/approvals" title={d.workflowActPageTitle}>
      <WorkflowActSurface locale={localeValue} token={token ?? ""} />
    </AppShell>
  );
}
