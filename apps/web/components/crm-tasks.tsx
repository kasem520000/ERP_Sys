"use client";

/**
 * PHASE-019 T50 — tasks & activities:
 *
 * - the follow-up list (title / status / due / remind / assignee / related)
 *   with a status filter (server refetch) and the OPEN-only edit dialog;
 * - complete / cancel actions (POST; legal replays are server no-ops);
 * - the create dialog: title, the related anchor (type + pool select),
 *   assignee, dueDate, remindAt (date + time — re-arms the sweep), note;
 * - the activity timeline of the SELECTED task's related record (fetched
 *   client-side via crm/activities?relatedType&relatedId) + the
 *   log-activity dialog (kind, occurredAt date+time, summary, duration).
 *
 * No money, no ledger effects (MASTER-PLAN §3). Times compose as ISO
 * UTC strings (`${date}T${time}:00Z` — the zod datetime contract).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CrmActivityRow,
  CrmTaskRow,
  LeadRow,
  PartnerRow,
  ServiceContractReadRow,
  ServiceOrderRow,
  TenantUserRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedActivityKind,
  localizedCrmError,
  localizedRelatedType,
  localizedTaskStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const RELATED_TYPES = ["LEAD", "PARTNER", "CONTRACT", "SERVICE_ORDER"] as const;
const ACTIVITY_KINDS = ["CALL", "MEETING", "EMAIL", "NOTE"] as const;

/** HH:MM (UTC) — the reminder/activity time leg of an ISO datetime. */
const DEFAULT_TIME = "09:00";
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** "2026-03-23 05:30:00+00" (pg text) → "09:00"-style HH:MM, or the default. */
function timeOfIsoText(value: string | null): string {
  if (value === null) return DEFAULT_TIME;
  const time = value.slice(11, 16);
  return TIME_RE.test(time) ? time : DEFAULT_TIME;
}

export function CrmTasks({
  locale,
  initialRows,
  users,
  leads,
  partners,
  contracts,
  serviceOrders,
}: {
  locale: Locale;
  initialRows: readonly CrmTaskRow[];
  users: readonly TenantUserRow[];
  leads: readonly LeadRow[];
  partners: readonly PartnerRow[];
  contracts: readonly ServiceContractReadRow[];
  serviceOrders: readonly ServiceOrderRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly CrmTaskRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  // List filter (server-side refetch).
  const [statusFilter, setStatusFilter] = useState("");

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createRelatedType, setCreateRelatedType] = useState<"LEAD" | "PARTNER" | "CONTRACT" | "SERVICE_ORDER">("LEAD");
  const [createRelatedId, setCreateRelatedId] = useState("");
  const [createAssignee, setCreateAssignee] = useState("");
  const [createDueDate, setCreateDueDate] = useState("");
  const [createRemindDate, setCreateRemindDate] = useState("");
  const [createRemindTime, setCreateRemindTime] = useState(DEFAULT_TIME);
  const [createNote, setCreateNote] = useState("");

  // Edit dialog state (OPEN only).
  const [editTarget, setEditTarget] = useState<CrmTaskRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAssignee, setEditAssignee] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editRemindDate, setEditRemindDate] = useState("");
  const [editRemindTime, setEditRemindTime] = useState(DEFAULT_TIME);
  const [editNote, setEditNote] = useState("");

  // The selected task (drives the activity timeline).
  const [selected, setSelected] = useState<CrmTaskRow | null>(null);
  const [activities, setActivities] = useState<readonly CrmActivityRow[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);

  // Log-activity dialog state (anchored on the selected task's relation).
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityKind, setActivityKind] = useState<"CALL" | "MEETING" | "EMAIL" | "NOTE">("NOTE");
  const [activityDate, setActivityDate] = useState("");
  const [activityTime, setActivityTime] = useState(DEFAULT_TIME);
  const [activitySummary, setActivitySummary] = useState("");
  const [activityDuration, setActivityDuration] = useState("");

  const userLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      map.set(user.userId, user.fullName !== "" ? `${user.fullName} · ${user.email}` : user.email);
    }
    return map;
  }, [users]);

  /** The related-target pool + label per related type. */
  const relatedPool = useMemo(() => {
    switch (createRelatedType) {
      case "LEAD":
        return {
          options: leads.map((lead) => ({
            value: lead.id,
            label: localizedName(lead.name, lead.nameAr, locale),
          })),
          labels: new Map(leads.map((lead) => [lead.id, localizedName(lead.name, lead.nameAr, locale)] as const)),
        };
      case "PARTNER":
        return {
          options: partners.map((partner) => ({
            value: partner.id,
            label: `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`,
          })),
          labels: new Map(
            partners.map((partner) => [partner.id, `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`] as const),
          ),
        };
      case "CONTRACT":
        return {
          options: contracts.map((row) => ({
            value: row.contract.id,
            label: `${row.contract.contractNo ?? shortId(row.contract.id)} · ${row.contract.title}`,
          })),
          labels: new Map(
            contracts.map((row) => [row.contract.id, `${row.contract.contractNo ?? shortId(row.contract.id)} · ${row.contract.title}`] as const),
          ),
        };
      case "SERVICE_ORDER":
        return {
          options: serviceOrders.map((order) => ({
            value: order.id,
            label: `${order.orderNo ?? shortId(order.id)}`,
          })),
          labels: new Map(serviceOrders.map((order) => [order.id, order.orderNo ?? shortId(order.id)] as const)),
        };
    }
  }, [createRelatedType, leads, partners, contracts, serviceOrders, locale]);

  /** The label of ANY row's related anchor (best effort across pools). */
  const relatedLabel = useMemo(() => {
    const all = new Map<string, string>();
    for (const lead of leads) all.set(lead.id, localizedName(lead.name, lead.nameAr, locale));
    for (const partner of partners) {
      all.set(partner.id, `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`);
    }
    for (const row of contracts) {
      all.set(row.contract.id, `${row.contract.contractNo ?? shortId(row.contract.id)} · ${row.contract.title}`);
    }
    for (const order of serviceOrders) all.set(order.id, order.orderNo ?? shortId(order.id));
    return all;
  }, [leads, partners, contracts, serviceOrders, locale]);

  const createReady =
    createTitle.trim() !== "" && createRelatedId !== "" && TIME_RE.test(createRemindTime);
  const editReady = editTarget !== null && editTitle.trim() !== "" && TIME_RE.test(editRemindTime);
  const activityReady =
    selected !== null &&
    activitySummary.trim() !== "" &&
    activityDate !== "" &&
    TIME_RE.test(activityTime) &&
    (activityDuration === "" || /^\d+$/.test(activityDuration));

  // -- list --------------------------------------------------------------------------

  async function loadList(status: string): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (status !== "") params.set("status", status);
    const result = await bffFetch<readonly CrmTaskRow[]>(`crm/tasks?${params.toString()}`);
    setListLoading(false);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onFilterChange(status: string): void {
    setStatusFilter(status);
    void loadList(status);
  }

  // -- create ------------------------------------------------------------------------

  async function createTask(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<CrmTaskRow>("crm/tasks", {
      method: "POST",
      body: {
        title: createTitle.trim(),
        relatedType: createRelatedType,
        relatedId: createRelatedId,
        assigneeUserId: createAssignee === "" ? null : createAssignee,
        dueDate: createDueDate === "" ? null : createDueDate,
        remindAt:
          createRemindDate === "" ? null : `${createRemindDate}T${createRemindTime}:00Z`,
        note: createNote.trim() === "" ? null : createNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setCreateTitle("");
    setCreateRelatedId("");
    setCreateAssignee("");
    setCreateDueDate("");
    setCreateRemindDate("");
    setCreateRemindTime(DEFAULT_TIME);
    setCreateNote("");
    setNotice(d.crmTaskCreatedToast);
  }

  // -- edit (PUT, OPEN only) -----------------------------------------------------------

  function openEdit(task: CrmTaskRow): void {
    setEditTarget(task);
    setEditTitle(task.title);
    setEditAssignee(task.assigneeUserId ?? "");
    setEditDueDate(task.dueDate ?? "");
    setEditRemindDate(task.remindAt === null ? "" : task.remindAt.slice(0, 10));
    setEditRemindTime(timeOfIsoText(task.remindAt));
    setEditNote(task.note ?? "");
  }

  async function saveEdit(): Promise<void> {
    if (editTarget === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<CrmTaskRow>(`crm/tasks/${editTarget.id}`, {
      method: "PUT",
      body: {
        title: editTitle.trim(),
        assigneeUserId: editAssignee === "" ? null : editAssignee,
        dueDate: editDueDate === "" ? null : editDueDate,
        remindAt: editRemindDate === "" ? null : `${editRemindDate}T${editRemindTime}:00Z`,
        note: editNote.trim() === "" ? null : editNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    if (selected !== null && selected.id === result.data.id) {
      setSelected(result.data);
    }
    setEditTarget(null);
    setNotice(d.crmTaskSavedToast);
  }

  // -- complete / cancel ----------------------------------------------------------------

  async function completeTask(task: CrmTaskRow): Promise<void> {
    setBusy(`complete-${task.id}`);
    setError(null);
    const result = await bffFetch<CrmTaskRow>(`crm/tasks/${task.id}/complete`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    setNotice(d.crmTaskCompletedToast);
  }

  async function cancelTask(task: CrmTaskRow): Promise<void> {
    setBusy(`cancel-${task.id}`);
    setError(null);
    const result = await bffFetch<CrmTaskRow>(`crm/tasks/${task.id}/cancel`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    setNotice(d.crmTaskCancelledToast);
  }

  // -- the activity timeline (per the selected task's relation) ---------------------------

  async function selectTask(task: CrmTaskRow): Promise<void> {
    setSelected(task);
    setActivities([]);
    setActivitiesLoading(true);
    setError(null);
    const params = new URLSearchParams({
      relatedType: task.relatedType,
      relatedId: task.relatedId,
      limit: "100",
    });
    const result = await bffFetch<readonly CrmActivityRow[]>(`crm/activities?${params.toString()}`);
    setActivitiesLoading(false);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setActivities(result.data);
  }

  async function logActivity(): Promise<void> {
    if (selected === null || !activityReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("activity");
    setError(null);
    const result = await bffFetch<CrmActivityRow>("crm/activities", {
      method: "POST",
      body: {
        kind: activityKind,
        relatedType: selected.relatedType,
        relatedId: selected.relatedId,
        occurredAt: `${activityDate}T${activityTime}:00Z`,
        summary: activitySummary.trim(),
        ...(activityDuration === "" ? {} : { durationMinutes: Number(activityDuration) }),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setActivities((current) => [result.data, ...current]);
    setActivityOpen(false);
    setActivitySummary("");
    setActivityDuration("");
    setNotice(d.crmActivityLoggedToast);
  }

  // -- render ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.crmTasksTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.crmTasksNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={(value) => onFilterChange(value)}
            options={[
              { value: "", label: d.crmTasksAllStatuses },
              { value: "OPEN", label: d.crmTaskStatusOpen },
              { value: "DONE", label: d.crmTaskStatusDone },
              { value: "CANCELLED", label: d.crmTaskStatusCancelled },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "title",
                header: activeLocaleHeader(d.crmTaskColTitle),
                accessor: (row) => row.title,
                render: (row) => <span className="font-medium text-gray-900">{row.title}</span>,
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "OPEN" ? "primary" : undefined}>
                    {localizedTaskStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "due",
                header: activeLocaleHeader(d.crmTaskColDue),
                accessor: (row) => row.dueDate ?? "",
                mono: true,
                render: (row) =>
                  row.dueDate === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.dueDate}
                    </span>
                  ),
              },
              {
                id: "remind",
                header: activeLocaleHeader(d.crmTaskColRemind),
                accessor: (row) => row.remindAt ?? "",
                mono: true,
                render: (row) =>
                  row.remindAt === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-xs" dir="ltr">
                      {row.remindAt.slice(0, 16).replace("T", " ")}
                    </span>
                  ),
              },
              {
                id: "assignee",
                header: activeLocaleHeader(d.crmTaskColAssignee),
                accessor: (row) => row.assigneeUserId ?? "",
                render: (row) =>
                  row.assigneeUserId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    (userLabelById.get(row.assigneeUserId) ?? shortId(row.assigneeUserId))
                  ),
              },
              {
                id: "related",
                header: activeLocaleHeader(d.crmTaskColRelated),
                accessor: (row) => row.relatedType,
                render: (row) => (
                  <span className="text-sm">
                    {localizedRelatedType(d, row.relatedType)} ·{" "}
                    <span className="font-mono text-xs" dir="ltr">
                      {relatedLabel.get(row.relatedId) ?? shortId(row.relatedId)}
                    </span>
                  </span>
                ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "open",
                label: d.commonOpen,
                onSelect: (row) => {
                  void selectTask(row);
                },
              },
              {
                id: "edit",
                label: d.commonSave,
                onSelect: (row) => {
                  if (row.status === "OPEN") openEdit(row);
                },
              },
              {
                id: "complete",
                label: d.crmTaskComplete,
                onSelect: (row) => {
                  if (row.status === "OPEN") void completeTask(row);
                },
              },
              {
                id: "cancel",
                label: d.commonCancel,
                onSelect: (row) => {
                  if (row.status === "OPEN") void cancelTask(row);
                },
              },
            ]}
            empty={{ title: d.crmTasksEmpty }}
          />
        </div>
      </Card>

      {/* -- the activity timeline of the selected task's relation ------------------ */}
      {selected !== null && (
        <Card
          title={`${d.crmActivitiesTitle} · ${localizedRelatedType(d, selected.relatedType)} · ${
            relatedLabel.get(selected.relatedId) ?? shortId(selected.relatedId)
          }`}
          description={d.crmActivitiesHint}
          actions={
            <Button variant="primary" onClick={() => setActivityOpen(true)}>
              {d.crmActivityLogTitle}
            </Button>
          }
        >
          {activitiesLoading ? (
            <p className="text-sm text-gray-500">…</p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-gray-500">{d.crmActivitiesEmpty}</p>
          ) : (
            <table className="w-full text-sm" aria-label={d.crmActivitiesTitle}>
              <thead>
                <tr className="border-b border-subtle text-xs text-gray-600">
                  <th scope="col" className="px-2 py-1 text-start">{d.crmActivityColOccurredAt}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.crmActivityColKind}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.crmActivityColSummary}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.crmActivityColDuration}</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => (
                  <tr key={activity.id} className="border-b border-subtle">
                    <td className="px-2 py-1.5">
                      <span className="font-mono text-xs" dir="ltr">
                        {activity.occurredAt.slice(0, 16).replace("T", " ")}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge>{localizedActivityKind(d, activity.kind)}</Badge>
                    </td>
                    <td className="px-2 py-1.5">{activity.summary}</td>
                    <td className="px-2 py-1.5 text-end">
                      <span className="font-mono tabular-nums" dir="ltr">
                        {activity.durationMinutes ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* -- create dialog --------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.crmTaskCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.crmTaskTitleLabel}
            value={createTitle}
            onValueChange={setCreateTitle}
            required
            error={createTitle.trim() === "" ? d.errorsValidation : undefined}
          />
          <Select
            label={d.crmTaskRelatedType}
            value={createRelatedType}
            onValueChange={(value) => {
              const next = RELATED_TYPES.find((type) => type === value) ?? "LEAD";
              setCreateRelatedType(next);
              setCreateRelatedId("");
            }}
            options={RELATED_TYPES.map((type) => ({
              value: type,
              label: localizedRelatedType(d, type),
            }))}
            required
          />
          <Select
            label={d.crmTaskRelatedTarget}
            value={createRelatedId}
            onValueChange={setCreateRelatedId}
            placeholder="—"
            options={relatedPool.options}
            required
          />
          <Select
            label={d.crmTaskAssignee}
            value={createAssignee}
            onValueChange={setCreateAssignee}
            placeholder="—"
            options={[
              { value: "", label: d.crmTaskAssignee },
              ...users.map((user) => ({
                value: user.userId,
                label: userLabelById.get(user.userId) ?? user.email,
              })),
            ]}
          />
          <DatePicker
            locale={locale}
            label={d.crmTaskDueDate}
            value={createDueDate}
            onSelect={setCreateDueDate}
          />
          <DatePicker
            locale={locale}
            label={d.crmTaskRemindAt}
            value={createRemindDate}
            onSelect={setCreateRemindDate}
          />
          <div className="w-40">
            <Input
              label={d.crmTaskRemindTime}
              value={createRemindTime}
              onValueChange={setCreateRemindTime}
              mono
              bidiIsolate
              error={!TIME_RE.test(createRemindTime) ? d.errorsValidation : undefined}
              hint="HH:MM UTC"
            />
          </div>
          <Input label={d.crmTaskNote} value={createNote} onValueChange={setCreateNote} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createTask()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog (OPEN only) ------------------------------------------------ */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={d.crmTaskEditTitle}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.crmTaskTitleLabel}
            value={editTitle}
            onValueChange={setEditTitle}
            required
            error={editTitle.trim() === "" ? d.errorsValidation : undefined}
          />
          <Select
            label={d.crmTaskAssignee}
            value={editAssignee}
            onValueChange={setEditAssignee}
            placeholder="—"
            options={[
              { value: "", label: d.crmTaskAssignee },
              ...users.map((user) => ({
                value: user.userId,
                label: userLabelById.get(user.userId) ?? user.email,
              })),
            ]}
          />
          <DatePicker
            locale={locale}
            label={d.crmTaskDueDate}
            value={editDueDate}
            onSelect={setEditDueDate}
          />
          <DatePicker
            locale={locale}
            label={d.crmTaskRemindAt}
            value={editRemindDate}
            onSelect={setEditRemindDate}
          />
          <div className="w-40">
            <Input
              label={d.crmTaskRemindTime}
              value={editRemindTime}
              onValueChange={setEditRemindTime}
              mono
              bidiIsolate
              error={!TIME_RE.test(editRemindTime) ? d.errorsValidation : undefined}
              hint="HH:MM UTC"
            />
          </div>
          <Input label={d.crmTaskNote} value={editNote} onValueChange={setEditNote} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "edit"}
            disabled={!editReady}
            onClick={() => void saveEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- log-activity dialog ------------------------------------------------------ */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen} title={d.crmActivityLogTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.crmActivityKindLabel}
            value={activityKind}
            onValueChange={(value) => {
              const next = ACTIVITY_KINDS.find((kind) => kind === value) ?? "NOTE";
              setActivityKind(next);
            }}
            options={ACTIVITY_KINDS.map((kind) => ({
              value: kind,
              label: localizedActivityKind(d, kind),
            }))}
            required
          />
          <DatePicker
            locale={locale}
            label={d.crmActivityOccurredAt}
            value={activityDate}
            onSelect={setActivityDate}
          />
          <div className="w-40">
            <Input
              label={d.crmActivityOccurredTime}
              value={activityTime}
              onValueChange={setActivityTime}
              mono
              bidiIsolate
              error={!TIME_RE.test(activityTime) ? d.errorsValidation : undefined}
              hint="HH:MM UTC"
            />
          </div>
          <Input
            label={d.crmActivityDuration}
            value={activityDuration}
            onValueChange={setActivityDuration}
            mono
            inputMode="numeric"
            error={
              activityDuration !== "" && !/^\d+$/.test(activityDuration)
                ? d.errorsValidation
                : undefined
            }
          />
          <div className="sm:col-span-2">
            <Input
              label={d.crmActivitySummary}
              value={activitySummary}
              onValueChange={setActivitySummary}
              required
              error={activitySummary.trim() === "" ? d.errorsValidation : undefined}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setActivityOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "activity"}
            disabled={!activityReady}
            onClick={() => void logActivity()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
