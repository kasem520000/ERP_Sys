/**
 * PHASE-040 T-08 — /{locale}/settings/imports (the data import & migration
 * hub; PAGE_ARCHETYPES §9 wizard archetype): the server resolves the kind
 * catalog, the recent jobs page, the saved mappings (both directions), the
 * IN-26 adapter registry, the DRAFT budget set (the BUDGETS grid option),
 * and the current session's permissions (the in-screen writes gate on
 * configuration.imports.manage — the route itself rides it, so 403 → the
 * forbidden state). Bilingual kind/adapter/template labels come FROM the
 * API (the catalog is bilingual by contract) — no dictionary duplication.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ImportsToolkitWorkspace } from "../../../../components/imports-toolkit-workspace";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BudgetListRow,
  CurrentSession,
  ToolkitAdapterInfo,
  ToolkitJobRow,
  ToolkitKindInfo,
  ToolkitMappingRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const JOBS_LIMIT = 25;

export default async function ImportsHubPage({
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

  const [kinds, jobs, mappings, adapters, budgets, session] = await Promise.all([
    fetchApi<readonly ToolkitKindInfo[]>("imports/kinds"),
    fetchApi<readonly ToolkitJobRow[]>(`imports/jobs?limit=${JOBS_LIMIT}`),
    fetchApi<readonly ToolkitMappingRow[]>("imports/mappings"),
    fetchApi<readonly ToolkitAdapterInfo[]>("imports/adapters"),
    // The BUDGETS grid option (DRAFT budgets only — BR-050 immutability);
    // fail-open to an empty set (the kind's select shows the honest empty).
    fetchApi<readonly BudgetListRow[]>("budgeting/budgets?status=DRAFT"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!kinds.ok && kinds.status === 401) ||
    (!jobs.ok && jobs.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!kinds.ok) {
    const forbidden = kinds.status === 403 || kinds.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, kinds.error, kinds.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!jobs.ok) {
    const forbidden = jobs.status === 403 || jobs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, jobs.error, jobs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <ImportsToolkitWorkspace
        locale={localeValue}
        canManage={permissions.includes("configuration.imports.manage")}
        kinds={kinds.data}
        adapters={adapters.ok ? adapters.data : []}
        budgets={budgets.ok ? budgets.data : []}
        initialJobs={jobs.data}
        initialMappings={mappings.ok ? mappings.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="settings/imports" title={d.toolkitTitle}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.toolkitSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
