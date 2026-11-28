/**
 * /{locale}/settings/workflows — the chain editor (PHASE-052 W-48,
 * T-10 — D-14's form-first shape: the ordered steps, the branch
 * conditions, the SLA, the assignee rules — the visual ordering, never
 * the free canvas). The register read gates on
 * `workflow.definitions.manage` (matrix §3.30 — the 0130-seeded key);
 * the flag is `workflow.definitions` (D-04's composable editor plane —
 * the API's @RequireFeature is the enforcement face).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { WorkflowDefinitionsBoard } from "../../../../components/workflow-definitions-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, WorkflowDefinitionView } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function WorkflowSettingsPage({
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

  const [definitions, session] = await Promise.all([
    fetchApi<readonly WorkflowDefinitionView[]>("workflow/definitions"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!definitions.ok && definitions.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!definitions.ok) {
    const forbidden = definitions.status === 403 || definitions.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, definitions.error, definitions.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <WorkflowDefinitionsBoard
        locale={localeValue}
        initialDefinitions={definitions.data}
        definitionsError={null}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="settings/workflows" title={d.workflowSettingsTitle}>
      {content}
    </AppShell>
  );
}
