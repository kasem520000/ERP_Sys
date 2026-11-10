"use client";

/**
 * PHASE-019 T50 — time entries:
 *
 * - the timeslips table (date / project / fee item / hours / the
 *   snapshotted rate / narrative / billable / fee earner / status) with
 *   from/to/project filters (server refetch — the row-32 query params);
 * - the create dialog (entryDate, hours, SERVICE fee item, the project
 *   with the case-policy hint, the optional contract, the fee earner, the
 *   optional manual rate, narrative, billable) + the DRAFT-only edit;
 * - the void action (DRAFT/APPROVED only — the typed guard is the belt);
 * - the weekly review dialog (Monday weekStart → the batch DRAFT →
 *   APPROVED flip that gates billing).
 *
 * Hours/rates stay canonical ≤6dp strings (ADR-0009); the rate is
 * snapshotted at recording and never recomputed (§6).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ItemRow,
  ProjectRow,
  ServiceContractReadRow,
  TenantUserRow,
  TimeEntryRow,
  TimesheetReviewResult,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedCrmError,
  localizedTimeEntryStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Hours + rates ≤ 6dp (the QTY6 contract). */
const QTY_RE = /^\d+(\.\d{1,6})?$/;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function qtyCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

/** A Monday ISO check (the review's server contract — the client mirror). */
function isMonday(date: string): boolean {
  return date !== "" && new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

export function CrmTime({
  locale,
  initialRows,
  projects,
  serviceItems,
  contracts,
  users,
}: {
  locale: Locale;
  initialRows: readonly TimeEntryRow[];
  projects: readonly ProjectRow[];
  serviceItems: readonly ItemRow[];
  contracts: readonly ServiceContractReadRow[];
  users: readonly TenantUserRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly TimeEntryRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  // List filters (server-side refetch — the row-32 params).
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState("");
  const [createHours, setCreateHours] = useState("");
  const [createFeeItemId, setCreateFeeItemId] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createContractId, setCreateContractId] = useState("");
  const [createEarnerId, setCreateEarnerId] = useState("");
  const [createRate, setCreateRate] = useState("");
  const [createNarrative, setCreateNarrative] = useState("");
  const [createBillable, setCreateBillable] = useState("true");

  // Edit dialog state (DRAFT only).
  const [editTarget, setEditTarget] = useState<TimeEntryRow | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editFeeItemId, setEditFeeItemId] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editContractId, setEditContractId] = useState("");
  const [editEarnerId, setEditEarnerId] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editNarrative, setEditNarrative] = useState("");
  const [editBillable, setEditBillable] = useState("true");

  // Weekly review dialog.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewWeek, setReviewWeek] = useState("");

  const projectLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, `${project.code} · ${localizedName(project.name, project.nameAr, locale)}`);
    }
    return map;
  }, [projects, locale]);
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of serviceItems) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [serviceItems, locale]);
  const contractLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of contracts) {
      map.set(
        row.contract.id,
        `${row.contract.contractNo ?? shortId(row.contract.id)} · ${row.contract.title}`,
      );
    }
    return map;
  }, [contracts]);
  const userLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      map.set(user.userId, user.fullName !== "" ? `${user.fullName} · ${user.email}` : user.email);
    }
    return map;
  }, [users]);

  const createReady =
    createDate !== "" &&
    QTY_RE.test(createHours) &&
    Number(createHours) > 0 &&
    createFeeItemId !== "" &&
    createProjectId !== "" &&
    (createRate === "" || QTY_RE.test(createRate));
  const editReady =
    editTarget !== null &&
    editDate !== "" &&
    QTY_RE.test(editHours) &&
    Number(editHours) > 0 &&
    editFeeItemId !== "" &&
    editProjectId !== "" &&
    (editRate === "" || QTY_RE.test(editRate));
  const reviewReady = isMonday(reviewWeek);

  // -- list --------------------------------------------------------------------------

  async function loadList(): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (fromFilter !== "") params.set("from", fromFilter);
    if (toFilter !== "") params.set("to", toFilter);
    if (projectFilter !== "") params.set("projectId", projectFilter);
    const result = await bffFetch<readonly TimeEntryRow[]>(`crm/time-entries?${params.toString()}`);
    setListLoading(false);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  // -- create --------------------------------------------------------------------------

  async function createTimeEntry(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<TimeEntryRow>("crm/time-entries", {
      method: "POST",
      body: {
        entryDate: createDate,
        hours: createHours,
        feeItemId: createFeeItemId,
        projectId: createProjectId,
        contractId: createContractId === "" ? null : createContractId,
        feeEarnerUserId: createEarnerId === "" ? null : createEarnerId,
        unitRate: createRate === "" ? null : createRate,
        narrative: createNarrative.trim() === "" ? null : createNarrative.trim(),
        billable: createBillable === "true",
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setCreateDate("");
    setCreateHours("");
    setCreateFeeItemId("");
    setCreateProjectId("");
    setCreateContractId("");
    setCreateEarnerId("");
    setCreateRate("");
    setCreateNarrative("");
    setCreateBillable("true");
    setNotice(d.crmTimeCreatedToast);
  }

  // -- edit (PUT, DRAFT only) ------------------------------------------------------------

  function openEdit(entry: TimeEntryRow): void {
    setEditTarget(entry);
    setEditDate(entry.entryDate);
    setEditHours(entry.hours);
    setEditFeeItemId(entry.feeItemId);
    setEditProjectId(entry.projectId ?? "");
    setEditContractId(entry.contractId ?? "");
    setEditEarnerId(entry.feeEarnerUserId ?? "");
    setEditRate(entry.unitRate);
    setEditNarrative(entry.narrative ?? "");
    setEditBillable(entry.billable ? "true" : "false");
  }

  async function saveEdit(): Promise<void> {
    if (editTarget === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<TimeEntryRow>(`crm/time-entries/${editTarget.id}`, {
      method: "PUT",
      body: {
        entryDate: editDate,
        hours: editHours,
        feeItemId: editFeeItemId,
        projectId: editProjectId === "" ? null : editProjectId,
        contractId: editContractId === "" ? null : editContractId,
        feeEarnerUserId: editEarnerId === "" ? null : editEarnerId,
        unitRate: editRate === "" ? null : editRate,
        narrative: editNarrative.trim() === "" ? null : editNarrative.trim(),
        billable: editBillable === "true",
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    setEditTarget(null);
    setNotice(d.crmTimeSavedToast);
  }

  // -- void (DRAFT/APPROVED) ----------------------------------------------------------------

  async function voidEntry(entry: TimeEntryRow): Promise<void> {
    setBusy(`void-${entry.id}`);
    setError(null);
    const result = await bffFetch<TimeEntryRow>(`crm/time-entries/${entry.id}/void`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    setNotice(d.crmTimeVoidedToast);
  }

  // -- the weekly review ------------------------------------------------------------------------

  async function reviewTimesheet(): Promise<void> {
    if (!reviewReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("review");
    setError(null);
    const result = await bffFetch<TimesheetReviewResult>("crm/time/timesheets/review", {
      method: "POST",
      body: { weekStart: reviewWeek },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setReviewOpen(false);
    setNotice(
      formatMessage(d.crmTimeReviewToast, {
        count: result.data.reviewed,
        week: result.data.weekStart,
      }),
    );
    await loadList();
  }

  // -- render --------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.crmTimeTitle}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setReviewOpen(true)}>
              {d.crmTimeReviewTitle}
            </Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {d.crmTimeNew}
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input
              label={d.accountingFromDate}
              value={fromFilter}
              onValueChange={setFromFilter}
              mono
              bidiIsolate
              placeholder="2026-01-01"
            />
          </div>
          <div className="w-40">
            <Input
              label={d.accountingToDate}
              value={toFilter}
              onValueChange={setToFilter}
              mono
              bidiIsolate
              placeholder="2026-12-31"
            />
          </div>
          <Select
            label={d.crmTimeProject}
            value={projectFilter}
            onValueChange={setProjectFilter}
            placeholder="—"
            options={[
              { value: "", label: d.crmTimeProject },
              ...projects.map((project) => ({
                value: project.id,
                label: projectLabelById.get(project.id) ?? project.code,
              })),
            ]}
          />
          <Button variant="secondary" onClick={() => void loadList()}>
            {d.commonOpen}
          </Button>
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "date",
                header: activeLocaleHeader(d.crmTimeColDate),
                accessor: (row) => row.entryDate,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.entryDate}
                  </span>
                ),
              },
              {
                id: "project",
                header: activeLocaleHeader(d.crmTimeColProject),
                accessor: (row) => row.projectId ?? "",
                render: (row) =>
                  row.projectId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    (projectLabelById.get(row.projectId) ?? shortId(row.projectId))
                  ),
              },
              {
                id: "feeItem",
                header: activeLocaleHeader(d.crmTimeColFeeItem),
                accessor: (row) => row.feeItemId,
                render: (row) => itemLabelById.get(row.feeItemId) ?? shortId(row.feeItemId),
              },
              {
                id: "hours",
                header: activeLocaleHeader(d.crmTimeColHours),
                accessor: (row) => row.hours,
                numeric: true,
                render: (row) => qtyCell(row.hours),
              },
              {
                id: "rate",
                header: activeLocaleHeader(d.crmTimeColRate),
                accessor: (row) => row.unitRate,
                numeric: true,
                render: (row) => qtyCell(row.unitRate),
              },
              {
                id: "narrative",
                header: activeLocaleHeader(d.crmTimeColNarrative),
                accessor: (row) => row.narrative ?? "",
                render: (row) => row.narrative ?? <span className="text-gray-500">—</span>,
              },
              {
                id: "billable",
                header: activeLocaleHeader(d.crmTimeColBillable),
                accessor: (row) => (row.billable ? "yes" : "no"),
                render: (row) => (row.billable ? d.crmTimeYes : d.crmTimeNo),
              },
              {
                id: "earner",
                header: activeLocaleHeader(d.crmTimeColEarner),
                accessor: (row) => row.feeEarnerUserId ?? "",
                render: (row) =>
                  row.feeEarnerUserId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    (userLabelById.get(row.feeEarnerUserId) ?? shortId(row.feeEarnerUserId))
                  ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "APPROVED" ? "primary" : undefined}>
                    {localizedTimeEntryStatus(d, row.status)}
                  </Badge>
                ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "edit",
                label: d.commonSave,
                onSelect: (row) => {
                  if (row.status === "DRAFT") openEdit(row);
                },
              },
              {
                id: "void",
                label: d.crmTimeVoid,
                onSelect: (row) => {
                  if (row.status === "DRAFT" || row.status === "APPROVED") void voidEntry(row);
                },
              },
            ]}
            empty={{ title: d.crmTimeEmpty }}
          />
        </div>
      </Card>

      {/* -- create dialog --------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.crmTimeCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            locale={locale}
            label={d.crmTimeEntryDate}
            value={createDate}
            onSelect={setCreateDate}
          />
          <div className="w-40">
            <Input
              label={d.crmTimeHours}
              value={createHours}
              onValueChange={setCreateHours}
              mono
              required
              error={
                createHours !== "" && (!QTY_RE.test(createHours) || Number(createHours) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Select
            label={d.crmTimeFeeItem}
            value={createFeeItemId}
            onValueChange={setCreateFeeItemId}
            placeholder="—"
            options={serviceItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
            required
          />
          <Select
            label={d.crmTimeProject}
            value={createProjectId}
            onValueChange={setCreateProjectId}
            placeholder="—"
            hint={d.crmTimeCaseHint}
            options={projects.map((project) => ({
              value: project.id,
              label: projectLabelById.get(project.id) ?? project.code,
            }))}
            required
          />
          <Select
            label={d.crmTimeContract}
            value={createContractId}
            onValueChange={setCreateContractId}
            placeholder="—"
            options={[
              { value: "", label: d.crmTimeContract },
              ...contracts.map((row) => ({
                value: row.contract.id,
                label: contractLabelById.get(row.contract.id) ?? row.contract.title,
              })),
            ]}
          />
          <Select
            label={d.crmTimeFeeEarner}
            value={createEarnerId}
            onValueChange={setCreateEarnerId}
            placeholder="—"
            options={[
              { value: "", label: d.crmTimeFeeEarner },
              ...users.map((user) => ({
                value: user.userId,
                label: userLabelById.get(user.userId) ?? user.email,
              })),
            ]}
          />
          <div className="w-40">
            <Input
              label={d.crmTimeRate}
              value={createRate}
              onValueChange={setCreateRate}
              mono
              hint={d.crmTimeRateHint}
              error={createRate !== "" && !QTY_RE.test(createRate) ? d.errorsValidation : undefined}
            />
          </div>
          <Select
            label={d.crmTimeBillable}
            value={createBillable}
            onValueChange={setCreateBillable}
            options={[
              { value: "true", label: d.crmTimeYes },
              { value: "false", label: d.crmTimeNo },
            ]}
          />
          <div className="sm:col-span-2">
            <Input
              label={d.crmTimeNarrative}
              value={createNarrative}
              onValueChange={setCreateNarrative}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createTimeEntry()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog (DRAFT only) ------------------------------------------------ */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={d.crmTimeEditTitle}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            locale={locale}
            label={d.crmTimeEntryDate}
            value={editDate}
            onSelect={setEditDate}
          />
          <div className="w-40">
            <Input
              label={d.crmTimeHours}
              value={editHours}
              onValueChange={setEditHours}
              mono
              required
              error={
                editHours !== "" && (!QTY_RE.test(editHours) || Number(editHours) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Select
            label={d.crmTimeFeeItem}
            value={editFeeItemId}
            onValueChange={setEditFeeItemId}
            placeholder="—"
            options={serviceItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
            required
          />
          <Select
            label={d.crmTimeProject}
            value={editProjectId}
            onValueChange={setEditProjectId}
            placeholder="—"
            hint={d.crmTimeCaseHint}
            options={projects.map((project) => ({
              value: project.id,
              label: projectLabelById.get(project.id) ?? project.code,
            }))}
            required
          />
          <Select
            label={d.crmTimeContract}
            value={editContractId}
            onValueChange={setEditContractId}
            placeholder="—"
            options={[
              { value: "", label: d.crmTimeContract },
              ...contracts.map((row) => ({
                value: row.contract.id,
                label: contractLabelById.get(row.contract.id) ?? row.contract.title,
              })),
            ]}
          />
          <Select
            label={d.crmTimeFeeEarner}
            value={editEarnerId}
            onValueChange={setEditEarnerId}
            placeholder="—"
            options={[
              { value: "", label: d.crmTimeFeeEarner },
              ...users.map((user) => ({
                value: user.userId,
                label: userLabelById.get(user.userId) ?? user.email,
              })),
            ]}
          />
          <div className="w-40">
            <Input
              label={d.crmTimeRate}
              value={editRate}
              onValueChange={setEditRate}
              mono
              hint={d.crmTimeRateHint}
              error={editRate !== "" && !QTY_RE.test(editRate) ? d.errorsValidation : undefined}
            />
          </div>
          <Select
            label={d.crmTimeBillable}
            value={editBillable}
            onValueChange={setEditBillable}
            options={[
              { value: "true", label: d.crmTimeYes },
              { value: "false", label: d.crmTimeNo },
            ]}
          />
          <div className="sm:col-span-2">
            <Input
              label={d.crmTimeNarrative}
              value={editNarrative}
              onValueChange={setEditNarrative}
            />
          </div>
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

      {/* -- the weekly review dialog ------------------------------------------------- */}
      <Dialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={d.crmTimeReviewTitle}
        description={d.crmTimeReviewHint}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            locale={locale}
            label={d.crmTimeReviewWeek}
            value={reviewWeek}
            onSelect={setReviewWeek}
            error={reviewWeek !== "" && !isMonday(reviewWeek) ? d.errorsValidation : undefined}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReviewOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "review"}
            disabled={!reviewReady}
            onClick={() => void reviewTimesheet()}
          >
            {d.commonConfirm}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
