"use client";

/**
 * PHASE-052 (W-48 — T-12, PP-17) THE WORKFLOW TIMELINE — the document's
 * chain rendered as the FULL step history VERBATIM: state, assignee,
 * delegated_to, acted_at, comment (the frozen history is the record —
 * INV-037's terminal floor; the terminal record renders exactly as it
 * closed, never re-derived). The component is entity-generic: it takes
 * the bound registry's entity + the document id and reads the
 * engine's own timeline endpoint; it embeds on the four bound document
 * detail surfaces (the journal detail · the PO detail · the
 * contracting change-orders slot · the drawback claims board).
 *
 * THE ENGINE-OUTPUT LAW: every figure is the row's own string (the
 * amounts, the timestamps, the names) — zero client-side
 * recomputation. The no-chain document renders its honest no-chain
 * notice (the unbound doc type's own state — never an error).
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, type DataTableColumn } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApiErrorBody, WorkflowTimelineStepRow, WorkflowTimelineView } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  localizedName,
  workflowInstanceStatusLabel,
  workflowStepStateLabel,
  workflowStepTypeLabel,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};

function stateTone(status: string): ChipTone {
  switch (status) {
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "danger";
    case "PENDING":
      return "warning";
    case "DELEGATED":
      return "info";
    default:
      return "neutral";
  }
}

function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

function dashIfNull(value: string | null, title?: string): JSX.Element {
  if (value === null) {
    return <span className="text-xs text-gray-500">—</span>;
  }
  return monoCell(value, title);
}

/** The doc detail path (the engine's own routing law — the local copy,
 * W-47's task-lane precedent). */
export function workflowDocDetailPath(triggerEntity: string, documentId: string): string {
  switch (triggerEntity) {
    case "manual_journal":
      return `/accounting/journals/${documentId}`;
    case "purchase_order":
      return `/purchasing/orders?doc=${documentId}`;
    case "change_order":
      return `/projects/contracting?doc=${documentId}`;
    case "duty_drawback_claim":
      return `/trade/drawbacks?doc=${documentId}`;
    default:
      return `/`;
  }
}

export function WorkflowTimeline({
  locale,
  triggerEntity,
  documentId,
}: {
  locale: Locale;
  triggerEntity: string;
  documentId: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [view, setView] = useState<WorkflowTimelineView | null>(null);
  const [refusal, setRefusal] = useState<ApiErrorBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => {
    setReloadTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      const result = await bffFetch<WorkflowTimelineView>(
        `workflow/timeline?entity=${encodeURIComponent(triggerEntity)}&documentId=${encodeURIComponent(documentId)}`,
      );
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setRefusal(result.error);
        setView(null);
        return;
      }
      setRefusal(null);
      setView(result.data);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [triggerEntity, documentId, reloadTick]);

  const columns: DataTableColumn<WorkflowTimelineStepRow>[] = [
    {
      id: "step",
      header: activeLocaleHeader(d.workflowColStep),
      accessor: (row) => `${row.stepOrder}. ${localizedName(row.stepName, row.stepNameAr, locale)}`,
      render: (row) => (
        <span className="text-sm">
          <span className="font-mono text-xs text-gray-500" dir="ltr">
            {row.stepOrder}.
          </span>{" "}
          {localizedName(row.stepName, row.stepNameAr, locale)}
        </span>
      ),
    },
    {
      id: "type",
      header: activeLocaleHeader(d.workflowColDocType),
      accessor: (row) => row.stepType,
      render: (row) => <Chip tone="neutral">{workflowStepTypeLabel(d, row.stepType)}</Chip>,
    },
    {
      id: "assignee",
      header: activeLocaleHeader(d.workflowColAssignee),
      accessor: (row) => row.assigneeName ?? row.assigneeUserId,
      render: (row) =>
        row.assigneeName !== null ? (
          <span className="text-sm">{row.assigneeName}</span>
        ) : (
          dashIfNull(row.assigneeUserId)
        ),
    },
    {
      id: "state",
      header: activeLocaleHeader(d.workflowColStatus),
      accessor: (row) => row.status,
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Chip tone={stateTone(row.status)}>{workflowStepStateLabel(d, row.status)}</Chip>
          {view?.instance?.status === "ACTIVE" && view.instance.currentStepOrder === row.stepOrder ? (
            <Chip tone="info">{d.workflowTimelineCurrentChip}</Chip>
          ) : null}
        </div>
      ),
    },
    {
      id: "delegatedTo",
      header: activeLocaleHeader(d.workflowTimelineDelegatedTo),
      accessor: (row) => row.delegatedToName ?? row.delegatedTo ?? "",
      render: (row) =>
        row.delegatedTo !== null ? (
          row.delegatedToName !== null ? (
            <span className="text-sm">{row.delegatedToName}</span>
          ) : (
            monoCell(row.delegatedTo)
          )
        ) : (
          <span className="text-xs text-gray-500">—</span>
        ),
    },
    {
      id: "actedAt",
      header: activeLocaleHeader(d.workflowColActedAt),
      accessor: (row) => row.actedAt ?? "",
      render: (row) =>
        row.actedAt === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <div className="flex flex-col">
            <span className="text-xs" dir="ltr">
              {formatDateTime(row.actedAt, locale)}
            </span>
            {row.actedByName !== null ? (
              <span className="text-xs text-gray-500">{row.actedByName}</span>
            ) : null}
          </div>
        ),
    },
    {
      id: "due",
      header: activeLocaleHeader(d.workflowColDue),
      accessor: (row) => row.dueAt ?? "",
      render: (row) =>
        row.dueAt === null ? (
          <span className="text-xs text-gray-500">{d.workflowNoDue}</span>
        ) : (
          <span className="text-xs" dir="ltr">
            {formatDateTime(row.dueAt, locale)}
          </span>
        ),
    },
    {
      id: "comment",
      header: activeLocaleHeader(d.workflowColComment),
      accessor: (row) => row.comment ?? "",
      render: (row) =>
        row.comment === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <span className="text-sm" title={row.comment}>
            {row.comment}
          </span>
        ),
    },
  ];

  return (
    <Card
      title={d.workflowTimelineTitle}
      description={d.workflowTimelineSubtitle}
      actions={
        <Button variant="secondary" size="sm" loading={loading} onClick={reload}>
          {d.workflowRefresh}
        </Button>
      }
    >
      {loading ? <p className="text-sm text-gray-600">{d.workflowTimelineLoading}</p> : null}
      {refusal !== null ? (
        <TypedRefusalPanel
          error={refusal}
          title={d.workflowRefusalTitle}
          detailsLabel={d.workflowRefusalDetails}
        />
      ) : null}
      {!loading && refusal === null && view !== null ? (
        view.instance === null ? (
          <p className="text-sm text-gray-600">{d.workflowTimelineNoChain}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {d.workflowTimelineChain}:{" "}
                {localizedName(view.instance.definitionName, view.instance.definitionNameAr, locale)}
              </span>
              <Chip
                tone={
                  view.instance.status === "ACTIVE"
                    ? "info"
                    : view.instance.status === "COMPLETED"
                      ? "success"
                      : "neutral"
                }
              >
                {workflowInstanceStatusLabel(d, view.instance.status)}
              </Chip>
              {view.instance.completedAt !== null ? (
                <span className="text-xs text-gray-500" dir="ltr">
                  {d.workflowTimelineCompletedAt}: {formatDateTime(view.instance.completedAt, locale)}
                </span>
              ) : null}
              <a
                className="text-xs underline"
                href={workflowDocDetailPath(triggerEntity, documentId)}
              >
                {d.workflowTimelineOpenDoc}
              </a>
            </div>
            <DataTable columns={columns} rows={[...view.steps]} rowKey={(row) => row.id} />
          </div>
        )
      ) : null}
      {!loading && refusal === null && view === null ? (
        <ErrorNotice>{d.workflowTimelineNoChain}</ErrorNotice>
      ) : null}
    </Card>
  );
}
