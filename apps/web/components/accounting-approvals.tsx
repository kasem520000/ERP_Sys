"use client";

/**
 * P7-T18 — approvals queue (List+Search archetype; the @erp/ui
 * ApprovalsQueue pattern): pending manual journals with base-currency
 * totals (BR-034 thresholds compare BASE), inline Approve/Reject, the SoD
 * self-approval hint (server enforces), and the engine-generated preview
 * (journal-entries/:id/preview — the exact spec the engine will post, no
 * preview/post divergence). Current policies display read-only below.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { ApprovalsQueue, Badge, DataTable, formatMoneyDisplay } from "@erp/ui";
import type { ApprovalsQueueRow } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApprovalPolicyRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedAccountingError, localizedDocumentStatus } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function AccountingApprovals({
  locale,
  initialRows,
  policies,
  currentUserId,
}: {
  locale: Locale;
  initialRows: ApprovalsQueueRow[];
  policies: readonly ApprovalPolicyRow[];
  currentUserId: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<ApprovalsQueueRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labels = useMemo(
    () => ({
      title: d.accountingApprovalsTitle,
      empty: d.accountingApprovalsEmpty,
      approve: d.accountingApprove,
      reject: d.accountingReject,
      openPreview: d.accountingApprovalsPreview,
      totalBase: d.accountingApprovalsTotalBase,
      submittedBy: d.accountingApprovalsSubmittedBy,
      selfApprovalHint: d.accountingApprovalsSelfHint,
      statusLabel: d.statusPendingApproval,
    }),
    [d],
  );

  async function approve(id: string): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await bffFetch<{ id: string }>(`accounting/journal-entries/${id}/approve`, {
      method: "POST",
      body: { note: "approvals queue" },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.filter((row) => row.id !== id));
    setNotice(d.accountingApprove);
  }

  async function reject(id: string): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await bffFetch<{ id: string }>(`accounting/journal-entries/${id}/cancel`, {
      method: "POST",
      body: { reason: "rejected in approvals queue" },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.filter((row) => row.id !== id));
    setNotice(d.accountingReject);
  }

  async function openPreview(id: string): Promise<void> {
    setError(null);
    const result = await bffFetch<unknown>(`accounting/journal-entries/${id}/preview`);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    // The preview is the engine's own JournalSpec — rendered as formatted JSON
    // (a rich preview canvas is PHASE-013 report territory).
    setNotice(`${d.accountingPreviewTitle}: ${JSON.stringify(result.data).slice(0, 400)}…`);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <ApprovalsQueue
        rows={rows.map((row) => ({ ...row, isOwnSubmission: row.submittedBy === currentUserId }))}
        labels={labels}
        onApprove={(id) => void approve(id)}
        onReject={(id) => void reject(id)}
        onOpenPreview={(id) => void openPreview(id)}
        loading={busy && rows.length === 0}
        disabled={busy}
      />

      <Card title={d.accountingPoliciesTitle}>
        <DataTable
          columns={[
            {
              id: "docType",
              header: activeLocaleHeader(d.accountingSource),
              accessor: (row) => row.docType,
              render: (row) => <span className="font-mono text-xs" dir="ltr">{row.docType}</span>,
            },
            {
              id: "mode",
              header: activeLocaleHeader(d.accountingPolicyMode),
              accessor: (row) => row.policy.mode,
              render: (row) => <span className="font-mono text-xs" dir="ltr">{row.policy.mode}</span>,
            },
            {
              id: "threshold",
              header: activeLocaleHeader(d.accountingPolicyThreshold),
              accessor: (row) => row.policy.threshold ?? "",
              numeric: true,
              render: (row) =>
                row.policy.threshold === undefined || row.policy.threshold === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(row.policy.threshold, 2)}
                  </span>
                ),
            },
            {
              id: "from",
              header: activeLocaleHeader(d.accountingActiveFrom),
              accessor: (row) => row.appliesFrom,
              render: (row) => <span className="font-mono text-xs" dir="ltr">{row.appliesFrom}</span>,
            },
            {
              id: "sod",
              header: activeLocaleHeader("SoD"),
              accessor: (row) => (row.policy.allowSelfApproval === true ? "self" : "blocked"),
              render: (row) => (
                <Badge tone={row.policy.allowSelfApproval === true ? "neutral" : "primary"}>
                  {row.policy.allowSelfApproval === true
                    ? d.accountingApprovalsSelfHint
                    : localizedDocumentStatus(d, "APPROVED")}
                </Badge>
              ),
            },
          ]}
          rows={[...policies]}
          rowKey={(row) => row.id}
          empty={{ title: d.accountingPoliciesEmpty }}
        />
      </Card>
    </div>
  );
}
