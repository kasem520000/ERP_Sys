/**
 * /{locale}/accounting/projects — the projects dimension (PHASE-019 T50,
 * MASTER-PLAN §14): the cost-center mirror (code uq per tenant, name/nameAr,
 * parent link, status OPEN|CLOSED — a CLOSED project rejects new
 * journal-line stamps). List + create + patch (rename / status flip with
 * confirm). Projects are the primary resource (GET rides
 * accounting.journal_entries.view; POST/PATCH ride accounting.projects.manage)
 * — 403 renders the forbidden state on the write paths (the list still
 * renders; the create button is the surface that fails honestly).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AccountingProjects } from "../../../../components/accounting-projects";
import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ProjectRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function AccountingProjectsPage({
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

  const projects = await fetchApi<readonly ProjectRow[]>("accounting/projects");
  if (!projects.ok && projects.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!projects.ok) {
    const forbidden = projects.status === 403 || projects.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, projects.error, projects.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = <AccountingProjects locale={localeValue} initialRows={projects.data} />;
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/projects" title={d.accountingProjectsTitle}>
      {content}
    </AppShell>
  );
}
