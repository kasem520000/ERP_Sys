"use client";

/**
 * PHASE-052 (W-48 — T-11 + the tasks lane, D-14) THE APPROVALS INBOX
 * BOARD — the PENDING work with the aging indicators and the quick
 * actions (acceptance #7's own surface): the data-slot pane switch
 * (never the Tabs primitive — the 045 recall, every 052 board immune
 * by construction), the typed-refusal panels with FULL payloads, and
 * THE ENGINE-OUTPUT LAW: the aging figures (`ageHours` · `overdue`) are
 * the DB's own clock's — rendered VERBATIM (zero client-side
 * recomputation, zero JS wall clocks).
 *
 * THE QUICK ACTIONS route through the engine's own act path (the same
 * floors the deep-link act rides — the G-67 floor, the delegation
 * resolution, the actor law, the CAS single-use stamp). The TASKS pane
 * is the tasks lane (D-11 — the tasks ARE the step instances; the
 * completion write-back is the step's own ACTED stamp).
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  Dialog,
  Input,
  useToast,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  WorkflowApprovalActOutcome,
  WorkflowApprovalView,
  WorkflowTaskView,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedWorkflowError,
  workflowDocLabel,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";
import { workflowDocDetailPath } from "./workflow-timeline";

type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};

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

type ActTarget = { row: WorkflowApprovalView; verdict: "APPROVE" | "REJECT" };

export function WorkflowInboxBoard({
  locale,
  initialApprovals,
  approvalsError,
  initialTasks,
  tasksError,
  canAct,
  initialPane = "approvals",
}: {
  locale: Locale;
  initialApprovals: readonly WorkflowApprovalView[] | null;
  approvalsError: ApiErrorBody | null;
  initialTasks: readonly WorkflowTaskView[] | null;
  tasksError: ApiErrorBody | null;
  canAct: boolean;
  initialPane?: "approvals" | "tasks";
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ----
  const [pane, setPane] = useState<"approvals" | "tasks">(initialPane);

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // -- the approvals pane ------------------------------------------------------
  const [approvals, setApprovals] = useState<readonly WorkflowApprovalView[] | null>(initialApprovals);
  const [approvalsRefusal, setApprovalsRefusal] = useState<ApiErrorBody | null>(approvalsError);
  const [listLoading, setListLoading] = useState(false);
  const [act, setAct] = useState<ActTarget | null>(null);
  const [comment, setComment] = useState("");

  // -- the tasks pane ----------------------------------------------------------
  const [tasks, setTasks] = useState<readonly WorkflowTaskView[] | null>(initialTasks);
  const [tasksRefusal, setTasksRefusal] = useState<ApiErrorBody | null>(tasksError);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [complete, setComplete] = useState<WorkflowTaskView | null>(null);
  const [taskComment, setTaskComment] = useState("");

  async function loadApprovals(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly WorkflowApprovalView[]>("workflow/approvals?limit=200");
    setListLoading(false);
    if (!result.ok) {
      setApprovalsRefusal(result.error);
      setApprovals(null);
      return;
    }
    setApprovalsRefusal(null);
    setApprovals(result.data);
  }

  async function loadTasks(): Promise<void> {
    setTasksLoading(true);
    const result = await bffFetch<readonly WorkflowTaskView[]>("workflow/tasks?limit=200");
    setTasksLoading(false);
    if (!result.ok) {
      setTasksRefusal(result.error);
      setTasks(null);
      return;
    }
    setTasksRefusal(null);
    setTasks(result.data);
  }

  async function submitAct(): Promise<void> {
    if (act === null) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<WorkflowApprovalActOutcome>(
      `workflow/approvals/${act.row.stepInstanceId}/act`,
      { method: "POST", body: { verdict: act.verdict, comment: comment.trim() === "" ? null : comment.trim() } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedWorkflowError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setAct(null);
    setComment("");
    setNotice(
      result.data.completed
        ? result.data.action === "approve"
          ? `${d.workflowActApproveDone} ${d.workflowActChainCompleted}`
          : `${d.workflowActRejectDone} ${d.workflowActChainCompleted}`
        : `${result.data.action === "approve" ? d.workflowActApproveDone : d.workflowActRejectDone} ${formatMessage(d.workflowActRemaining, { count: result.data.remaining })}`,
    );
    toast({
      tone: "success",
      title: result.data.action === "approve" ? d.workflowActApproveDone : d.workflowActRejectDone,
    });
    await loadApprovals();
  }

  async function submitTaskComplete(): Promise<void> {
    if (complete === null) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<{ taskStepId: string; completed: boolean; remaining: number }>(
      `workflow/tasks/${complete.taskStepId}/complete`,
      { method: "POST", body: { comment: taskComment.trim() === "" ? null : taskComment.trim() } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedWorkflowError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setComplete(null);
    setTaskComment("");
    setNotice(d.workflowTaskDone);
    toast({ tone: "success", title: d.workflowTaskDone });
    await loadTasks();
  }

  const approvalColumns: DataTableColumn<WorkflowApprovalView>[] = [
    {
      id: "step",
      header: activeLocaleHeader(d.workflowColStep),
      accessor: (row) => localizedName(row.stepName, row.stepNameAr, locale),
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-sm">{localizedName(row.stepName, row.stepNameAr, locale)}</span>
          {row.routedFromUserId !== null ? (
            <span className="text-xs text-gray-500">
              {formatMessage(d.workflowRoutedChip, {
                name: row.routedFromUserName ?? row.routedFromUserId.slice(0, 8),
              })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "doc",
      header: activeLocaleHeader(d.workflowColDoc),
      accessor: (row) => row.documentNo ?? row.documentId,
      render: (row) => (
        <div className="flex flex-col">
          <Chip tone="neutral">{workflowDocLabel(d, row.triggerEntity)}</Chip>
          <a className="mt-1 text-xs underline" href={workflowDocDetailPath(row.triggerEntity, row.documentId)}>
            {row.documentNo !== null ? monoCell(row.documentNo) : monoCell(row.documentId.slice(0, 8))}
          </a>
        </div>
      ),
    },
    {
      id: "amount",
      header: activeLocaleHeader(d.workflowColAmount),
      accessor: (row) => row.amountBase,
      numeric: true,
      render: (row) => (
        <div className="flex flex-col">
          {monoCell(row.amountBase)}
          <span className="text-xs text-gray-500" dir="ltr">
            {row.currency}
          </span>
        </div>
      ),
    },
    {
      id: "age",
      header: activeLocaleHeader(d.workflowColAge),
      accessor: (row) => String(row.ageHours),
      numeric: true,
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <Chip tone="neutral">{formatMessage(d.workflowAgeHoursValue, { hours: row.ageHours })}</Chip>
          {row.overdue ? <Chip tone="danger">{d.workflowOverdueChip}</Chip> : null}
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
      id: "actions",
      header: activeLocaleHeader(d.workflowColStatus),
      accessor: () => d.workflowPendingChip,
      render: (row) =>
        canAct ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => setAct({ row, verdict: "APPROVE" })}>
              {d.workflowActApprove}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAct({ row, verdict: "REJECT" })}>
              {d.workflowActReject}
            </Button>
          </div>
        ) : (
          <Chip tone="warning">{d.workflowPendingChip}</Chip>
        ),
    },
  ];

  const taskColumns: DataTableColumn<WorkflowTaskView>[] = [
    {
      id: "step",
      header: activeLocaleHeader(d.workflowColStep),
      accessor: (row) => localizedName(row.stepName, row.stepNameAr, locale),
      render: (row) => <span className="text-sm">{localizedName(row.stepName, row.stepNameAr, locale)}</span>,
    },
    {
      id: "doc",
      header: activeLocaleHeader(d.workflowColDoc),
      accessor: (row) => row.documentNo ?? row.documentId,
      render: (row) => (
        <div className="flex flex-col">
          <Chip tone="neutral">{workflowDocLabel(d, row.triggerEntity)}</Chip>
          <a className="mt-1 text-xs underline" href={workflowDocDetailPath(row.triggerEntity, row.documentId)}>
            {row.documentNo !== null ? monoCell(row.documentNo) : monoCell(row.documentId.slice(0, 8))}
          </a>
        </div>
      ),
    },
    {
      id: "amount",
      header: activeLocaleHeader(d.workflowColAmount),
      accessor: (row) => row.amountBase,
      numeric: true,
      render: (row) => (
        <div className="flex flex-col">
          {monoCell(row.amountBase)}
          <span className="text-xs text-gray-500" dir="ltr">
            {row.currency}
          </span>
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
          <div className="flex flex-col">
            <span className="text-xs" dir="ltr">
              {formatDateTime(row.dueAt, locale)}
            </span>
          </div>
        ),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.workflowColStatus),
      accessor: () => d.workflowTypeTask,
      render: (row) => (
        <Button variant="primary" size="sm" onClick={() => setComplete(row)}>
          {d.workflowTaskCompleteAct}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.workflowTitle}>
        <Button
          variant={pane === "approvals" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "approvals"}
          onClick={() => setPane("approvals")}
        >
          {d.workflowPaneApprovals}
        </Button>
        <Button
          variant={pane === "tasks" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "tasks"}
          onClick={() => setPane("tasks")}
        >
          {d.workflowPaneTasks}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "approvals" ? (
        <>
          <Card
            title={d.workflowTitle}
            description={d.workflowSubtitle}
            actions={
              <Button variant="secondary" size="sm" loading={listLoading} onClick={() => void loadApprovals()}>
                {d.workflowRefresh}
              </Button>
            }
          >
            {listLoading ? <p className="text-sm text-gray-600">{d.workflowTimelineLoading}</p> : null}
            {approvalsRefusal !== null ? (
              <TypedRefusalPanel
                error={approvalsRefusal}
                title={d.workflowRefusalTitle}
                detailsLabel={d.workflowRefusalDetails}
              />
            ) : null}
            {approvals !== null && approvalsRefusal === null ? (
              approvals.length === 0 ? (
                <p className="text-sm text-gray-600">{d.workflowEmpty}</p>
              ) : (
                <DataTable columns={approvalColumns} rows={[...approvals]} rowKey={(row) => row.stepInstanceId} />
              )
            ) : null}
          </Card>
        </>
      ) : (
        <>
          <Card
            title={d.workflowTasksTitle}
            description={d.workflowTasksSubtitle}
            actions={
              <Button variant="secondary" size="sm" loading={tasksLoading} onClick={() => void loadTasks()}>
                {d.workflowRefresh}
              </Button>
            }
          >
            {tasksLoading ? <p className="text-sm text-gray-600">{d.workflowTimelineLoading}</p> : null}
            {tasksRefusal !== null ? (
              <TypedRefusalPanel
                error={tasksRefusal}
                title={d.workflowRefusalTitle}
                detailsLabel={d.workflowRefusalDetails}
              />
            ) : null}
            {tasks !== null && tasksRefusal === null ? (
              tasks.length === 0 ? (
                <p className="text-sm text-gray-600">{d.workflowTasksEmpty}</p>
              ) : (
                <DataTable columns={taskColumns} rows={[...tasks]} rowKey={(row) => row.taskStepId} />
              )
            ) : null}
          </Card>
        </>
      )}

      {act !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setAct(null);
              setComment("");
            }
          }}
          title={act.verdict === "APPROVE" ? d.workflowActApproveTitle : d.workflowActRejectTitle}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {localizedName(act.row.stepName, act.row.stepNameAr, locale)} ·{" "}
              {workflowDocLabel(d, act.row.triggerEntity)}
            </p>
            <Input label={d.workflowActComment} value={comment} onValueChange={setComment} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="primary"
                loading={busy}
                onClick={() => {
                  void submitAct();
                }}
              >
                {act.verdict === "APPROVE" ? d.workflowActApprove : d.workflowActReject}
              </Button>
              <Button variant="ghost" onClick={() => setAct(null)}>
                {d.workflowActCancel}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {complete !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setComplete(null);
              setTaskComment("");
            }
          }}
          title={d.workflowTaskCompleteTitle}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {localizedName(complete.stepName, complete.stepNameAr, locale)} ·{" "}
              {workflowDocLabel(d, complete.triggerEntity)}
            </p>
            <Input label={d.workflowActComment} value={taskComment} onValueChange={setTaskComment} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="primary"
                loading={busy}
                onClick={() => {
                  void submitTaskComplete();
                }}
              >
                {d.workflowTaskCompleteAct}
              </Button>
              <Button variant="ghost" onClick={() => setComplete(null)}>
                {d.workflowActCancel}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
