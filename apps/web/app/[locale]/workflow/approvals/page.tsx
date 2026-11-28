/**
 * /{locale}/workflow/approvals — the approvals inbox (PHASE-052 W-48,
 * T-11 — PP-17's inbox half): the PENDING work with the aging
 * indicators and the quick actions + the tasks lane pane (the data-slot
 * shape). The list read gates on `workflow.inbox.act` (matrix §3.30 —
 * the seeded 0130 key); the quick actions gate server-side on
 * `workflow.approve`; the flag is `workflow.engine` (D-04's base unit —
 * the API's @RequireFeature is the enforcement face).
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

export default async function WorkflowApprovalsPage({
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

  const [approvals, tasks, session] = await Promise.all([
    fetchApi<readonly WorkflowApprovalView[]>("workflow/approvals?limit=200"),
    fetchApi<readonly WorkflowTaskView[]>("workflow/tasks?limit=200"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!approvals.ok && approvals.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!approvals.ok) {
    const forbidden = approvals.status === 403 || approvals.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, approvals.error, approvals.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <WorkflowInboxBoard
        locale={localeValue}
        initialApprovals={approvals.data}
        approvalsError={null}
        initialTasks={tasks.ok ? tasks.data : null}
        tasksError={tasks.ok ? null : tasks.error}
        canAct={permissions.includes("workflow.approve")}
        initialPane="approvals"
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="workflow/approvals" title={d.workflowTitle}>
      {content}
    </AppShell>
  );
}
