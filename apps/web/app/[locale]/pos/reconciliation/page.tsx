/**
 * /{locale}/pos/reconciliation — shift-end reconciliation (PHASE-016
 * T12+T10): the Z report for branch + date (totals, by order type / tender
 * / terminal / hour, the OFF- ⇄ official pairs) with print, the open-checks
 * reminder, and the offline-outbox rejection triage. Branches are the
 * primary resource; the first active branch's report for today prerenders.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { PosReconciliation } from "../../../../components/pos-reconciliation";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  PosCheckRow,
  PosTerminalRow,
  PosZReport,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PosReconciliationPage({
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

  const today = new Date().toISOString().slice(0, 10);

  const [branches, terminals] = await Promise.all([
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly PosTerminalRow[]>("pos/terminals"),
  ]);
  if ((!branches.ok && branches.status === 401) || (!terminals.ok && terminals.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const activeBranches = branches.ok ? branches.data.filter((branch) => branch.isActive) : [];
  const initialBranchId = activeBranches[0]?.id ?? "";

  const [report, checks] =
    initialBranchId === ""
      ? [
          { ok: true as const, data: null as PosZReport | null },
          { ok: true as const, data: [] as readonly PosCheckRow[] },
        ]
      : await Promise.all([
          fetchApi<PosZReport>(`pos/z-report?branchId=${initialBranchId}&date=${today}`),
          fetchApi<readonly PosCheckRow[]>(`pos/checks?branchId=${initialBranchId}&status=OPEN`),
        ]);

  let content: JSX.Element;
  if (!branches.ok) {
    const forbidden = branches.status === 403 || branches.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, branches.error, branches.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <PosReconciliation
        locale={localeValue}
        branches={branches.data}
        terminals={terminals.ok ? terminals.data : []}
        initialBranchId={initialBranchId}
        initialChecks={checks.ok ? checks.data : []}
        initialReport={report.ok ? report.data : null}
        today={today}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="pos/reconciliation" title={d.posReconciliationTitle}>
      {content}
    </AppShell>
  );
}
