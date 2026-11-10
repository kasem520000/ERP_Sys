"use client";

/**
 * P7-T18 — journal entries list (List+Search archetype): manual journals
 * with the full draft → submit → approve → post → reverse lifecycle wired
 * to the engine routes. Posted rows show the immutable `JE-` number (drill
 * opens the GL entry detail); reverse prompts for date + reason (INV-014);
 * cancel prompts for a reason. The recurring section lists definitions with
 * pause/activate and the due-generation action (drafts only, never posts).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DocumentStatusBadge,
  Input,
  Select,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ManualJournalRow, RecurringJournalRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  localizedAccountingError,
  localizedDocumentStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { LinkButton } from "./link-button";
import { activeLocaleHeader } from "./table-header";

const STATUS_FILTERS = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED", "CANCELLED"] as const;

export function AccountingJournalsTable({
  locale,
  initialRows,
  recurringRows,
  canApprove,
  canPost,
  canReverse,
}: {
  locale: Locale;
  initialRows: readonly ManualJournalRow[];
  recurringRows: readonly RecurringJournalRow[];
  canApprove: boolean;
  canPost: boolean;
  canReverse: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly ManualJournalRow[]>(initialRows);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseDate, setReverseDate] = useState(new Date().toISOString().slice(0, 10));
  const [reverseReason, setReverseReason] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [recurring, setRecurring] = useState<readonly RecurringJournalRow[]>(recurringRows);

  const filtered = useMemo(
    () => (statusFilter === "" ? rows : rows.filter((row) => row.status === statusFilter)),
    [rows, statusFilter],
  );

  const actions = useMemo(
    () =>
      [
        {
          id: "open",
          label: d.commonOpen,
          onSelect: (row: ManualJournalRow) =>
            router.push(`/${locale}/accounting/journals/${row.id}`),
        },
        {
          id: "submit",
          label: d.accountingSubmit,
          onSelect: (row: ManualJournalRow) => void act(row.id, "submit"),
        },
        {
          id: "approve",
          label: d.accountingApprove,
          onSelect: (row: ManualJournalRow) => void act(row.id, "approve", { note: "screen approve" }),
        },
        {
          id: "post",
          label: d.accountingPost,
          onSelect: (row: ManualJournalRow) => void act(row.id, "post", {}),
        },
        canReverse
          ? {
              id: "reverse",
              label: d.accountingReverse,
              onSelect: (row: ManualJournalRow) => {
                setReverseDate(new Date().toISOString().slice(0, 10));
                setReverseId(row.id);
              },
            }
          : null,
        {
          id: "cancel",
          label: d.accountingCancel,
          danger: true,
          onSelect: (row: ManualJournalRow) => {
            setCancelReason("");
            setCancelId(row.id);
          },
        },
      ].filter((action): action is NonNullable<typeof action> => action !== null),
    [act, canReverse, d, locale, router],
  );

  async function act(id: string, action: "submit" | "approve" | "post", body?: unknown): Promise<void> {
    setError(null);
    setNotice(null);
    setBusyId(id);
    const result = await bffFetch<ManualJournalRow>(`accounting/journal-entries/${id}/${action}`, {
      method: "POST",
      body: body ?? {},
    });
    setBusyId(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === id ? result.data : row)));
    setNotice(action === "post" ? d.accountingPost : action === "approve" ? d.accountingApprove : d.accountingSubmit);
    router.refresh();
  }

  async function reverse(): Promise<void> {
    if (reverseId === null) {
      return;
    }
    setError(null);
    setBusyId(reverseId);
    const result = await bffFetch<ManualJournalRow>(`accounting/journal-entries/${reverseId}/reverse`, {
      method: "POST",
      body: { entryDate: reverseDate, reason: reverseReason },
    });
    setBusyId(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === reverseId ? result.data : row)));
    setReverseId(null);
    setReverseReason("");
    setNotice(d.accountingReverse);
    router.refresh();
  }

  async function cancel(): Promise<void> {
    if (cancelId === null) {
      return;
    }
    setError(null);
    setBusyId(cancelId);
    const result = await bffFetch<ManualJournalRow>(`accounting/journal-entries/${cancelId}/cancel`, {
      method: "POST",
      body: { reason: cancelReason },
    });
    setBusyId(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === cancelId ? result.data : row)));
    setCancelId(null);
    setCancelReason("");
    setNotice(d.accountingCancel);
    router.refresh();
  }

  async function setRecurringStatus(id: string, status: "ACTIVE" | "PAUSED"): Promise<void> {
    setError(null);
    setBusyId(id);
    const result = await bffFetch<RecurringJournalRow>(`accounting/recurring-journals/${id}/status`, {
      method: "POST",
      body: { status },
    });
    setBusyId(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRecurring((current) => current.map((row) => (row.id === id ? result.data : row)));
  }

  async function generateDue(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusyId("generate-due");
    const result = await bffFetch<{ generated: number }>("accounting/recurring-journals/generate-due", {
      method: "POST",
      body: {},
    });
    setBusyId(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(`${d.accountingRecurringGenerateDue}: ${result.data.generated}`);
    const refreshed = await bffFetch<readonly ManualJournalRow[]>("accounting/journal-entries?limit=100");
    if (refreshed.ok) {
      setRows(refreshed.data);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.accountingJournalsTitle}
        actions={
          <LinkButton href={`/${locale}/accounting/journals/new`} variant="primary">
            {d.accountingJournalsNew}
          </LinkButton>
        }
      >
        <div className="mb-3">
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: "", label: d.kindFilterAll },
              ...STATUS_FILTERS.map((value) => ({
                value,
                label: localizedDocumentStatus(d, value),
              })),
            ]}
            aria-label={d.accountingColStatus}
          />
        </div>
        <DataTable
          columns={[
            {
              id: "date",
              header: activeLocaleHeader(d.accountingColEntryDate),
              accessor: (row) => row.entryDate,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.entryDate}</span>,
            },
            {
              id: "description",
              header: activeLocaleHeader(d.accountingDescription),
              accessor: (row) => row.description ?? row.descriptionAr ?? "",
              render: (row) => {
                const text = row.description ?? row.descriptionAr ?? "—";
                return <span className="max-w-[24rem] truncate">{text}</span>;
              },
            },
            {
              id: "currency",
              header: activeLocaleHeader(d.accountingColCurrency),
              accessor: (row) => row.currencyCode,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.currencyCode}</span>,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={row.status}
                  label={localizedDocumentStatus(d, row.status)}
                />
              ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          rowActions={actions}
          empty={{
            title: d.accountingJournalsEmpty,
            primaryAction: (
              <LinkButton href={`/${locale}/accounting/journals/new`} variant="primary">
                {d.accountingJournalsNew}
              </LinkButton>
            ),
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {canApprove ? "" : d.accountingApprovalsSelfHint}
        </p>
      </Card>

      {reverseId !== null && (
        <Card title={d.accountingReverse}>
          <div className="flex flex-col gap-3">
            <Input
              label={d.accountingReversalDate}
              value={reverseDate}
              onValueChange={setReverseDate}
              mono
              bidiIsolate
            />
            <Input
              label={d.accountingReversalReason}
              value={reverseReason}
              onValueChange={setReverseReason}
              required
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={reverse}
                loading={busyId === reverseId}
                disabled={reverseReason.trim().length < 3}
              >
                {d.accountingReverse}
              </Button>
              <Button variant="ghost" onClick={() => setReverseId(null)}>
                {d.commonCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {cancelId !== null && (
        <Card title={d.accountingCancel}>
          <div className="flex flex-col gap-3">
            <Input
              label={d.accountingReversalReason}
              value={cancelReason}
              onValueChange={setCancelReason}
              required
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={cancel}
                loading={busyId === cancelId}
                disabled={cancelReason.trim().length < 3}
              >
                {d.accountingCancel}
              </Button>
              <Button variant="ghost" onClick={() => setCancelId(null)}>
                {d.commonCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card
        title={d.accountingRecurringTitle}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={generateDue}
            loading={busyId === "generate-due"}
            disabled={!canPost}
          >
            {d.accountingRecurringGenerateDue}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "name",
              header: activeLocaleHeader(d.accountingColName),
              accessor: (row) => row.name,
              render: (row) => row.name,
            },
            {
              id: "schedule",
              header: activeLocaleHeader(d.accountingRecurringSchedule),
              accessor: (row) => row.schedule,
              render: (row) => <span className="font-mono text-xs" dir="ltr">{row.schedule}</span>,
            },
            {
              id: "next",
              header: activeLocaleHeader(d.accountingRecurringNextRun),
              accessor: (row) => row.nextRunDate,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.nextRunDate}</span>,
            },
            {
              id: "last",
              header: activeLocaleHeader(d.accountingPostedAt),
              accessor: (row) => row.lastRunAt ?? "",
              render: (row) =>
                row.lastRunAt === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatDateTime(row.lastRunAt, locale)
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                  {row.status === "ACTIVE" ? d.accountingRecurringActivate : d.accountingRecurringPause}
                </Badge>
              ),
            },
          ]}
          rows={[...recurring]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "pause",
              label: d.accountingRecurringPause,
              onSelect: (row) => void setRecurringStatus(row.id, "PAUSED"),
            },
            {
              id: "activate",
              label: d.accountingRecurringActivate,
              onSelect: (row) => void setRecurringStatus(row.id, "ACTIVE"),
            },
          ]}
          empty={{ title: d.accountingRecurringEmpty }}
        />
      </Card>
    </div>
  );
}
