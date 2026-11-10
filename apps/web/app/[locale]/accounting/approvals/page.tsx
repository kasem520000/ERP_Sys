/**
 * /{locale}/accounting/approvals — the approvals queue (requires
 * accounting.journal_entries.approve): pending manual journals with
 * base-currency totals, Approve/Reject actions, the SoD self-approval hint
 * (server-enforced), engine-generated previews (BR-034: preview equals
 * posting), and the active approval policies (read-only display).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AccountingApprovals } from "../../../../components/accounting-approvals";
import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ApprovalPolicyRow,
  CurrentSession,
  ManualJournalRow,
  TenantUserRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ApprovalsPage({
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

  const [queue, policies, session, users] = await Promise.all([
    fetchApi<readonly ManualJournalRow[]>("accounting/approvals/queue?limit=25"),
    fetchApi<readonly ApprovalPolicyRow[]>("accounting/approval-policies"),
    fetchApi<CurrentSession>("identity/sessions/current"),
    // Best effort — display names for submitters; falls back to short ids
    // when the viewer lacks identity.users.view.
    fetchApi<readonly TenantUserRow[]>("identity/users"),
  ]);
  if (
    (!queue.ok && queue.status === 401) ||
    (!policies.ok && policies.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!queue.ok) {
    const forbidden = queue.status === 403 || queue.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, queue.error, queue.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    // BR-034 decisions compare BASE totals — fetch each pending draft's
    // lines (queue is short by nature) and compute Σdebit × rate.
    const details = await Promise.all(
      queue.data.map((row) =>
        fetchApi<{ draft: ManualJournalRow; lines: Array<{ direction: string; amount: string }> }>(
          `accounting/journal-entries/${row.id}`,
        ),
      ),
    );
    const totalBaseOf = (id: string, rate: string | null): string => {
      const detail = details.find(
        (candidate) => candidate.ok && candidate.data.draft.id === id,
      );
      if (detail === undefined || !detail.ok) {
        return "0";
      }
      const multiplier = Number(rate ?? "1");
      const total = detail.data.lines
        .filter((line) => line.direction === "DEBIT")
        .reduce((sum, line) => sum + Number(line.amount), 0);
      return (total * (Number.isFinite(multiplier) ? multiplier : 1)).toFixed(4);
    };
    const nameOf = (userId: string | null): string => {
      if (userId === null) {
        return "—";
      }
      const user = users.ok ? users.data.find((candidate) => candidate.userId === userId) : undefined;
      if (user !== undefined) {
        return user.fullName === "" ? user.email : user.fullName;
      }
      return userId.slice(0, 8);
    };
    content = (
      <AccountingApprovals
        locale={localeValue}
        initialRows={queue.data.map((row) => ({
          id: row.id,
          title: row.description ?? row.descriptionAr ?? "—",
          description: row.reference ?? undefined,
          totalBase: totalBaseOf(row.id, row.exchangeRate),
          currency: row.currencyCode,
          submittedBy: nameOf(row.createdBy),
          submittedAt: row.entryDate,
          isOwnSubmission: false,
          status: "PENDING_APPROVAL" as const,
        }))}
        policies={policies.ok ? policies.data : []}
        currentUserId={session.ok ? session.data.user.id : ""}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/approvals" title={d.accountingApprovalsTitle}>
      {content}
    </AppShell>
  );
}
