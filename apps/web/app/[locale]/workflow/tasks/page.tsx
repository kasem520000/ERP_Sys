/**
 * /{locale}/workflow/tasks — the tasks lane (PHASE-052 W-48, T-11's
 * tasks half — D-11: the tasks ARE the step instances, no seventh
 * table): the caller's own document tasks, due-first, with the
 * completion write-back (the step's own ACTED stamp). The list rides
 * the tasks self plane (SESSION_ROUTES — every authenticated user
 * works their own lane; the actor law is the engine's own floor), the
 * flag `workflow.tasks` (D-04's composable unit). The board is the
 * inbox board's tasks pane (the same data-slot surface, the tasks NAV
 * row's own landing).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { WorkflowInboxBoard } from "../../../../components/workflow-inbox-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { CurrentSession, WorkflowApprovalView, WorkflowTaskView } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function WorkflowTasksPage({
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

  const [tasks, approvals, session] = await Promise.all([
    fetchApi<readonly WorkflowTaskView[]>("workflow/tasks?limit=200"),
    fetchApi<readonly WorkflowApprovalView[]>("workflow/approvals?limit=200"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!tasks.ok && tasks.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!tasks.ok) {
    const forbidden = tasks.status === 403 || tasks.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, tasks.error, tasks.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <WorkflowInboxBoard
        locale={localeValue}
        initialTasks={tasks.data}
        tasksError={null}
        initialApprovals={approvals.ok ? approvals.data : null}
        approvalsError={approvals.ok ? null : approvals.error}
        canAct={permissions.includes("workflow.approve")}
        initialPane="tasks"
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="workflow/tasks" title={d.workflowTasksTitle}>
      {content}
    </AppShell>
  );
}
