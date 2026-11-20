/**
 * /{locale}/projects/fieldservice — the field-service dispatch board
 * (PHASE-048 W-13 T-16, matrix §3.26; archetype list-search): the
 * service orders' visits on ONE board — the status machine's own
 * stamps, the pause flag, the W-13 presentation join (the parent
 * order's own number + the technician's own names) — with the status
 * filter and THE SINGLE CLOCK's per-visit evaluation panel (the
 * engine's own readings; BR-096's escalations with their dedupe keys).
 * Every figure is an ENGINE OUTPUT rendered verbatim (zero parallel
 * computation; the hours view is display-only with the exact ms in the
 * titles). The first listing loads server-side (the mrp-page rule);
 * filtering re-fetches through the BFF.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ProjectsFieldserviceBoard } from "../../../../components/projects-fieldservice-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ServiceVisitRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ProjectsFieldservicePage({
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

  // The board's default listing (the pure read — no escalation side
  // effects; the SLA evaluation is the dedicated per-visit surface).
  const visits = await fetchApi<readonly ServiceVisitRow[]>("projects/fieldservice/visits");
  if (!visits.ok && visits.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!visits.ok) {
    const forbidden = visits.status === 403 || visits.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={forbidden ? d.errorsForbidden : localizedApiError(d, visits.error)}
      />
    );
  } else {
    content = (
      <ProjectsFieldserviceBoard
        locale={localeValue}
        initialVisits={visits.data}
        initialError={null}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="projects/fieldservice" title={d.projectsFieldserviceTitle}>
      {content}
    </AppShell>
  );
}
