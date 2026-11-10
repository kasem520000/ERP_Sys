"use client";

/**
 * PHASE-019 T50 — service contracts:
 *
 * - the list (contractNo / partner / title / fee model / term / monthly
 *   amount / status + the derived isExpired chip) with a status filter
 *   (server refetch);
 * - the create dialog: partner, optional project, title/scope, fee model
 *   (RETAINER monthly amount | MILESTONES dated-lines editor | HOURLY),
 *   term dates, the default fee item (stamped into the grid rows);
 * - the workspace (GET :id): the header card, the §4 schedule grid, the
 *   read-only billing preview (asOf → due entries + wouldInvoice lines +
 *   pullable/needsNarrative time + period locks), the advances panel
 *   (list + tag dialog with the posted-receipt select), and the lifecycle
 *   bar — DRAFT: edit + activate; ACTIVE: cancel (reason) + renew; the
 *   terminal states read-only.
 *
 * Money stays canonical 4dp strings (formatMoneyDisplay); the contract
 * itself posts nothing (MASTER-PLAN §4).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BillingPreviewRow,
  ContractAdvanceRow,
  ItemRow,
  PartnerRow,
  ProjectRow,
  ScheduleEntryRow,
  ServiceContractReadRow,
  TreasuryDocRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedAdvanceStatus,
  localizedContractStatus,
  localizedCrmError,
  localizedFeeModel,
  localizedScheduleEntryType,
  localizedScheduleStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Monthly amounts + milestone amounts ≤ 4dp (the MONEY4 contract). */
const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** A milestone-line draft (the MILESTONES editor). */
interface MilestoneDraft {
  label: string;
  dueDate: string;
  amount: string;
}

const EMPTY_MILESTONE: MilestoneDraft = { label: "", dueDate: "", amount: "" };

function milestoneValid(line: MilestoneDraft): boolean {
  return (
    line.label.trim() !== "" &&
    line.dueDate !== "" &&
    MONEY_RE.test(line.amount) &&
    Number(line.amount) > 0
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function moneyCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {formatMoneyDisplay(value, 4)}
    </span>
  );
}

/** The billing-preview entry label: period key, milestone label, or —. */
function entryLabel(entry: ScheduleEntryRow, locale: Locale): string {
  if (entry.milestoneLabel !== null) {
    return locale === "ar" && entry.milestoneLabelAr !== null ? entry.milestoneLabelAr : entry.milestoneLabel;
  }
  return entry.periodKey ?? "—";
}

export function CrmContracts({
  locale,
  initialRows,
  partners,
  projects,
  serviceItems,
  receipts,
}: {
  locale: Locale;
  initialRows: readonly ServiceContractReadRow[];
  partners: readonly PartnerRow[];
  projects: readonly ProjectRow[];
  serviceItems: readonly ItemRow[];
  receipts: readonly TreasuryDocRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly ServiceContractReadRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  // List filter (server-side refetch).
  const [statusFilter, setStatusFilter] = useState("");

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createPartnerId, setCreatePartnerId] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createTitleAr, setCreateTitleAr] = useState("");
  const [createScope, setCreateScope] = useState("");
  const [createFeeModel, setCreateFeeModel] = useState<"RETAINER" | "MILESTONES" | "HOURLY">("RETAINER");
  const [createStartDate, setCreateStartDate] = useState("");
  const [createEndDate, setCreateEndDate] = useState("");
  const [createMonthlyAmount, setCreateMonthlyAmount] = useState("");
  const [createFeeItemId, setCreateFeeItemId] = useState("");
  const [createNote, setCreateNote] = useState("");
  const [createMilestones, setCreateMilestones] = useState<MilestoneDraft[]>([{ ...EMPTY_MILESTONE }]);

  // Edit dialog state (DRAFT full-edit; the §18 lesson-1 PATCH shape).
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editScope, setEditScope] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editMonthlyAmount, setEditMonthlyAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editMilestones, setEditMilestones] = useState<MilestoneDraft[]>([{ ...EMPTY_MILESTONE }]);

  // Lifecycle dialogs.
  const [activateOpen, setActivateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewStart, setRenewStart] = useState("");
  const [renewEnd, setRenewEnd] = useState("");

  // Workspace state (the selected contract).
  const [selected, setSelected] = useState<ServiceContractReadRow | null>(null);
  const [schedule, setSchedule] = useState<readonly ScheduleEntryRow[]>([]);
  const [advances, setAdvances] = useState<readonly ContractAdvanceRow[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  // Billing preview dialog.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAsOf, setPreviewAsOf] = useState("");
  const [preview, setPreview] = useState<BillingPreviewRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Advance-tag dialog.
  const [tagOpen, setTagOpen] = useState(false);
  const [tagReceiptId, setTagReceiptId] = useState("");
  const [tagAmount, setTagAmount] = useState("");
  const [tagNote, setTagNote] = useState("");

  const customerPartners = useMemo(
    () =>
      partners.filter(
        (partner) =>
          (partner.kind === "CUSTOMER" || partner.kind === "BOTH") && partner.deletedAt === null,
      ),
    [partners],
  );
  const partnerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`);
    }
    return map;
  }, [partners, locale]);
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
  /** Posted receipts only — the taggable pool (the service re-validates). */
  const postedReceipts = useMemo(
    () => receipts.filter((receipt) => receipt.status === "POSTED"),
    [receipts],
  );

  const contract = selected?.contract ?? null;

  const createReady =
    createPartnerId !== "" &&
    createTitle.trim() !== "" &&
    createStartDate !== "" &&
    createEndDate !== "" &&
    createFeeItemId !== "" &&
    (createFeeModel === "RETAINER"
      ? MONEY_RE.test(createMonthlyAmount) && Number(createMonthlyAmount) > 0
      : true) &&
    (createFeeModel === "MILESTONES"
      ? createMilestones.length >= 1 && createMilestones.every(milestoneValid)
      : true);
  const editReady =
    selected !== null && editTitle.trim() !== "" && editStartDate !== "" && editEndDate !== "";
  const cancelReady = cancelReason.trim().length >= 1 && cancelReason.trim().length <= 500;
  const tagReady =
    contract !== null && tagReceiptId !== "" && MONEY_RE.test(tagAmount) && Number(tagAmount) > 0;
  const previewReady = previewAsOf !== "";

  function replaceRow(next: ServiceContractReadRow): void {
    setRows((current) => current.map((row) => (row.contract.id === next.contract.id ? next : row)));
  }

  // -- list --------------------------------------------------------------------------

  async function loadList(status: string): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (status !== "") params.set("status", status);
    const result = await bffFetch<readonly ServiceContractReadRow[]>(`crm/contracts?${params.toString()}`);
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

  // -- create --------------------------------------------------------------------------

  async function createContract(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<ServiceContractReadRow>("crm/contracts", {
      method: "POST",
      body: {
        partnerId: createPartnerId,
        projectId: createProjectId === "" ? null : createProjectId,
        title: createTitle.trim(),
        titleAr: createTitleAr.trim() === "" ? null : createTitleAr.trim(),
        scope: createScope.trim() === "" ? null : createScope.trim(),
        feeModel: createFeeModel,
        startDate: createStartDate,
        endDate: createEndDate,
        monthlyAmount:
          createFeeModel === "RETAINER" && MONEY_RE.test(createMonthlyAmount)
            ? createMonthlyAmount
            : null,
        feeItemId: createFeeItemId,
        milestones:
          createFeeModel === "MILESTONES"
            ? createMilestones.map((line) => ({
                label: line.label.trim(),
                labelAr: null,
                dueDate: line.dueDate,
                amount: line.amount,
                feeItemId: null,
              }))
            : null,
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
    setCreatePartnerId("");
    setCreateProjectId("");
    setCreateTitle("");
    setCreateTitleAr("");
    setCreateScope("");
    setCreateFeeModel("RETAINER");
    setCreateStartDate("");
    setCreateEndDate("");
    setCreateMonthlyAmount("");
    setCreateNote("");
    setCreateMilestones([{ ...EMPTY_MILESTONE }]);
    setNotice(d.crmContractCreatedToast);
    await openWorkspace(result.data.contract.id);
  }

  // -- workspace ------------------------------------------------------------------------

  async function openWorkspace(id: string): Promise<void> {
    setWorkspaceLoading(true);
    setError(null);
    const [contractResult, scheduleResult, advancesResult] = await Promise.all([
      bffFetch<ServiceContractReadRow>(`crm/contracts/${id}`),
      bffFetch<readonly ScheduleEntryRow[]>(`crm/contracts/${id}/schedule`),
      bffFetch<readonly ContractAdvanceRow[]>(`crm/contracts/${id}/advances`),
    ]);
    setWorkspaceLoading(false);
    if (!contractResult.ok) {
      setError(localizedCrmError(d, contractResult.error, contractResult.retryAfterSeconds));
      return;
    }
    setSelected(contractResult.data);
    setSchedule(scheduleResult.ok ? scheduleResult.data : []);
    setAdvances(advancesResult.ok ? advancesResult.data : []);
    setPreview(null);
  }

  async function refreshWorkspace(id: string): Promise<void> {
    const [contractResult, scheduleResult, advancesResult] = await Promise.all([
      bffFetch<ServiceContractReadRow>(`crm/contracts/${id}`),
      bffFetch<readonly ScheduleEntryRow[]>(`crm/contracts/${id}/schedule`),
      bffFetch<readonly ContractAdvanceRow[]>(`crm/contracts/${id}/advances`),
    ]);
    if (contractResult.ok) {
      setSelected(contractResult.data);
      replaceRow(contractResult.data);
    }
    if (scheduleResult.ok) setSchedule(scheduleResult.data);
    if (advancesResult.ok) setAdvances(advancesResult.data);
  }

  function openEdit(): void {
    if (contract === null) return;
    setEditTitle(contract.title);
    setEditScope(contract.scope ?? "");
    setEditStartDate(contract.startDate);
    setEditEndDate(contract.endDate);
    setEditMonthlyAmount(contract.monthlyAmount ?? "");
    setEditNote(contract.note ?? "");
    setEditMilestones(
      schedule
        .filter((entry) => entry.entryType === "MILESTONE")
        .map((entry) => ({
          label: entry.milestoneLabel ?? "",
          dueDate: entry.billDate,
          amount: entry.amount ?? "",
        })),
    );
    setEditOpen(true);
  }

  async function saveEdit(): Promise<void> {
    if (contract === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    // §18 lesson 1: omitted feeItemId resolves the STORED grid default;
    // milestones ride ONLY on the MILESTONES model (undefined = unchanged).
    const isMilestones = contract.feeModel === "MILESTONES";
    const milestones = isMilestones
      ? editMilestones.map((line) => ({
          label: line.label.trim(),
          labelAr: null,
          dueDate: line.dueDate,
          amount: line.amount,
          feeItemId: null,
        }))
      : undefined;
    const result = await bffFetch<ServiceContractReadRow>(`crm/contracts/${contract.id}`, {
      method: "PUT",
      body: {
        title: editTitle.trim(),
        scope: editScope.trim() === "" ? null : editScope.trim(),
        startDate: editStartDate,
        endDate: editEndDate,
        ...(contract.feeModel === "RETAINER" && MONEY_RE.test(editMonthlyAmount)
          ? { monthlyAmount: editMonthlyAmount }
          : {}),
        note: editNote.trim() === "" ? null : editNote.trim(),
        ...(milestones !== undefined ? { milestones } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEditOpen(false);
    setNotice(d.crmContractSavedToast);
    await refreshWorkspace(result.data.contract.id);
    await loadList(statusFilter);
  }

  async function activateContract(): Promise<void> {
    if (contract === null) return;
    setBusy("activate");
    setError(null);
    const result = await bffFetch<ServiceContractReadRow>(
      `crm/contracts/${contract.id}/activate`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setActivateOpen(false);
    setNotice(
      formatMessage(d.crmContractActivatedToast, { no: result.data.contract.contractNo ?? "—" }),
    );
    await refreshWorkspace(result.data.contract.id);
    await loadList(statusFilter);
  }

  async function cancelContract(): Promise<void> {
    if (contract === null || !cancelReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("cancel");
    setError(null);
    const result = await bffFetch<ServiceContractReadRow>(`crm/contracts/${contract.id}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCancelOpen(false);
    setCancelReason("");
    setNotice(d.crmContractCancelledToast);
    await refreshWorkspace(result.data.contract.id);
    await loadList(statusFilter);
  }

  async function renewContract(): Promise<void> {
    if (contract === null) return;
    setBusy("renew");
    setError(null);
    const result = await bffFetch<{
      renewed: ServiceContractReadRow;
      renewal: ServiceContractReadRow;
    }>(`crm/contracts/${contract.id}/renew`, {
      method: "POST",
      body: {
        ...(renewStart === "" ? {} : { startDate: renewStart }),
        ...(renewEnd === "" ? {} : { endDate: renewEnd }),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRenewOpen(false);
    setRenewStart("");
    setRenewEnd("");
    setNotice(
      formatMessage(d.crmContractRenewedToast, {
        no: result.data.renewal.contract.contractNo ?? "—",
      }),
    );
    await loadList(statusFilter);
    await openWorkspace(result.data.renewal.contract.id);
  }

  // -- the billing preview -------------------------------------------------------------

  async function runPreview(): Promise<void> {
    if (contract === null || !previewReady) {
      setError(d.errorsValidation);
      return;
    }
    setPreviewLoading(true);
    setError(null);
    const result = await bffFetch<BillingPreviewRow>(
      `crm/contracts/${contract.id}/billing-preview?asOf=${previewAsOf}`,
    );
    setPreviewLoading(false);
    if (!result.ok) {
      setPreview(null);
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPreview(result.data);
  }

  // -- advances --------------------------------------------------------------------------

  async function tagAdvance(): Promise<void> {
    if (contract === null || !tagReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("tag");
    setError(null);
    const result = await bffFetch<ContractAdvanceRow>(`crm/contracts/${contract.id}/advances`, {
      method: "POST",
      body: {
        receiptId: tagReceiptId,
        amount: tagAmount,
        note: tagNote.trim() === "" ? null : tagNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTagOpen(false);
    setTagReceiptId("");
    setTagAmount("");
    setTagNote("");
    setNotice(d.crmAdvanceTaggedToast);
    await refreshWorkspace(contract.id);
  }

  // -- render ------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.crmContractsTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.crmContractsNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={(value) => onFilterChange(value)}
            options={[
              { value: "", label: d.crmContractsAllStatuses },
              { value: "DRAFT", label: d.crmContractStatusDraft },
              { value: "ACTIVE", label: d.crmContractStatusActive },
              { value: "CANCELLED", label: d.crmContractStatusCancelled },
              { value: "RENEWED", label: d.crmContractStatusRenewed },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "no",
                header: activeLocaleHeader(d.crmContractColNo),
                accessor: (row) => row.contract.contractNo ?? row.contract.id,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.contract.contractNo ?? shortId(row.contract.id)}
                  </span>
                ),
              },
              {
                id: "partner",
                header: activeLocaleHeader(d.crmContractColPartner),
                accessor: (row) => partnerLabelById.get(row.contract.partnerId) ?? row.contract.partnerId,
                render: (row) =>
                  partnerLabelById.get(row.contract.partnerId) ?? shortId(row.contract.partnerId),
              },
              {
                id: "title",
                header: activeLocaleHeader(d.crmContractColTitle),
                accessor: (row) => row.contract.title,
                render: (row) => (
                  <span className="font-medium text-gray-900">
                    {localizedName(row.contract.title, row.contract.titleAr, locale)}
                  </span>
                ),
              },
              {
                id: "feeModel",
                header: activeLocaleHeader(d.crmContractColFeeModel),
                accessor: (row) => row.contract.feeModel,
                render: (row) => localizedFeeModel(d, row.contract.feeModel),
              },
              {
                id: "term",
                header: activeLocaleHeader(d.crmContractColTerm),
                accessor: (row) => `${row.contract.startDate}→${row.contract.endDate}`,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.contract.startDate} → {row.contract.endDate}
                  </span>
                ),
              },
              {
                id: "monthly",
                header: activeLocaleHeader(d.crmContractColMonthly),
                accessor: (row) => row.contract.monthlyAmount ?? "",
                numeric: true,
                render: (row) =>
                  row.contract.monthlyAmount === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    moneyCell(row.contract.monthlyAmount)
                  ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.contract.status,
                render: (row) => (
                  <span className="inline-flex items-center gap-1">
                    <Badge tone={row.contract.status === "ACTIVE" ? "primary" : undefined}>
                      {localizedContractStatus(d, row.contract.status)}
                    </Badge>
                    {row.isExpired && (
                      <Badge>{d.crmContractExpiredChip}</Badge>
                    )}
                  </span>
                ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.contract.id}
            rowActions={[
              {
                id: "open",
                label: d.commonOpen,
                onSelect: (row) => {
                  void openWorkspace(row.contract.id);
                },
              },
            ]}
            empty={{ title: d.crmContractsEmpty }}
          />
        </div>
      </Card>

      {workspaceLoading && selected === null && (
        <Card title={d.crmContractWorkspace}>
          <p className="text-sm text-gray-500">…</p>
        </Card>
      )}

      {/* -- the selected contract workspace -------------------------------------- */}
      {contract !== null && (
        <>
          <Card
            title={`${d.crmContractWorkspace} · ${contract.contractNo ?? shortId(contract.id)}`}
            description={localizedName(contract.title, contract.titleAr, locale)}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={contract.status === "ACTIVE" ? "primary" : undefined}>
                  {localizedContractStatus(d, contract.status)}
                </Badge>
                {selected !== null && selected.isExpired && <Badge>{d.crmContractExpiredChip}</Badge>}
                <Badge>{localizedFeeModel(d, contract.feeModel)}</Badge>
                <span className="text-sm text-gray-600">
                  {d.crmContractColPartner}:{" "}
                  {partnerLabelById.get(contract.partnerId) ?? shortId(contract.partnerId)}
                </span>
                {contract.projectId !== null && (
                  <span className="text-sm text-gray-600">
                    {d.crmContractProject}:{" "}
                    {projectLabelById.get(contract.projectId) ?? shortId(contract.projectId)}
                  </span>
                )}
                <span className="font-mono text-xs text-gray-600" dir="ltr">
                  {contract.startDate} → {contract.endDate}
                </span>
                {contract.monthlyAmount !== null && (
                  <span className="text-sm text-gray-600">
                    {d.crmContractColMonthly}: {moneyCell(contract.monthlyAmount)}
                  </span>
                )}
                {contract.note !== null && (
                  <span className="text-sm text-gray-600">{contract.note}</span>
                )}
                {contract.activatedAt !== null && (
                  <span className="text-sm text-gray-600">
                    {d.crmContractActivatedAt}:{" "}
                    <span className="font-mono text-xs" dir="ltr">
                      {contract.activatedAt.slice(0, 10)}
                    </span>
                  </span>
                )}
                {contract.renewedToContractId !== null && (
                  <span className="text-sm text-gray-600">
                    {d.crmContractRenewedTo}:{" "}
                    <span className="font-mono text-xs" dir="ltr">
                      {shortId(contract.renewedToContractId)}
                    </span>
                  </span>
                )}
                {contract.cancelReason !== null && (
                  <span className="text-sm text-gray-600">
                    {d.crmContractCancelReasonLabel}: {contract.cancelReason}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {contract.status === "DRAFT" && (
                  <>
                    <Button variant="secondary" onClick={openEdit}>
                      {d.commonSave}
                    </Button>
                    <Button variant="primary" onClick={() => setActivateOpen(true)}>
                      {d.crmContractActivate}
                    </Button>
                    <Button variant="danger" onClick={() => setCancelOpen(true)}>
                      {d.crmContractCancelAction}
                    </Button>
                  </>
                )}
                {contract.status === "ACTIVE" && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPreviewAsOf(contract.endDate);
                        setPreview(null);
                        setPreviewOpen(true);
                      }}
                    >
                      {d.crmPreviewTitle}
                    </Button>
                    <Button variant="primary" onClick={() => setRenewOpen(true)}>
                      {d.crmContractRenew}
                    </Button>
                    <Button variant="danger" onClick={() => setCancelOpen(true)}>
                      {d.crmContractCancelAction}
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  {d.commonClear}
                </Button>
              </div>
            </div>
          </Card>

          {/* -- the §4 schedule grid --------------------------------------------- */}
          <Card title={d.crmScheduleTitle}>
            {schedule.length === 0 ? (
              <p className="text-sm text-gray-500">{d.crmScheduleEmpty}</p>
            ) : (
              <table className="w-full text-sm" aria-label={d.crmScheduleTitle}>
                <thead>
                  <tr className="border-b border-subtle text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.crmScheduleColEntryType}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.crmScheduleColPeriod}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.crmScheduleColMilestone}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.crmScheduleColWindow}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.crmScheduleColBillDate}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.crmScheduleColAmount}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.crmContractFeeItem}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.accountingColStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((entry) => (
                    <tr key={entry.id} className="border-b border-subtle">
                      <td className="px-2 py-1.5">
                        {localizedScheduleEntryType(d, entry.entryType)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono text-xs" dir="ltr">
                          {entry.periodKey ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{entryLabel(entry, locale)}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono text-xs" dir="ltr">
                          {entry.periodStart ?? "—"} → {entry.periodEnd ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono text-xs" dir="ltr">
                          {entry.billDate}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-end">
                        {entry.amount === null ? (
                          <span className="text-gray-500">—</span>
                        ) : (
                          moneyCell(entry.amount)
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {itemLabelById.get(entry.feeItemId) ?? shortId(entry.feeItemId)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={entry.status === "INVOICED" ? "primary" : undefined}>
                          {localizedScheduleStatus(d, entry.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* -- the advances panel ------------------------------------------------- */}
          <Card
            title={d.crmAdvancesTitle}
            description={d.crmAdvancePolicyHint}
            actions={
              <Button variant="primary" onClick={() => setTagOpen(true)}>
                {d.crmAdvancesTag}
              </Button>
            }
          >
            {advances.length === 0 ? (
              <p className="text-sm text-gray-500">{d.crmAdvancesEmpty}</p>
            ) : (
              <table className="w-full text-sm" aria-label={d.crmAdvancesTitle}>
                <thead>
                  <tr className="border-b border-subtle text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.crmAdvanceColReceipt}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.crmAdvanceColAmount}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.crmAdvanceColStatus}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.crmAdvanceColJournals}</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map((advance) => (
                    <tr key={advance.id} className="border-b border-subtle">
                      <td className="px-2 py-1.5">
                        <span className="font-mono text-xs" dir="ltr">
                          {shortId(advance.receiptId)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-end">{moneyCell(advance.amount)}</td>
                      <td className="px-2 py-1.5">
                        <Badge tone={advance.status === "RELEASED" ? "primary" : undefined}>
                          {localizedAdvanceStatus(d, advance.status)}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono text-xs" dir="ltr">
                          {[
                            advance.deferJournalId === null ? null : `DEF ${shortId(advance.deferJournalId)}`,
                            advance.releasedJournalId === null
                              ? null
                              : `REL ${shortId(advance.releasedJournalId)}`,
                          ]
                            .filter((bit) => bit !== null)
                            .join(" · ") || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* -- create dialog --------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.crmContractCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.crmContractPartner}
            value={createPartnerId}
            onValueChange={setCreatePartnerId}
            placeholder="—"
            options={customerPartners.map((partner) => ({
              value: partner.id,
              label: partnerLabelById.get(partner.id) ?? partner.code,
            }))}
            required
          />
          <Select
            label={d.crmContractProject}
            value={createProjectId}
            onValueChange={setCreateProjectId}
            placeholder="—"
            options={[
              { value: "", label: d.crmContractProject },
              ...projects.map((project) => ({
                value: project.id,
                label: projectLabelById.get(project.id) ?? project.code,
              })),
            ]}
          />
          <Input
            label={d.crmContractTitleLabel}
            value={createTitle}
            onValueChange={setCreateTitle}
            required
            error={createTitle.trim() === "" ? d.errorsValidation : undefined}
          />
          <Input label={d.crmContractTitleAr} value={createTitleAr} onValueChange={setCreateTitleAr} />
          <div className="sm:col-span-2">
            <Input label={d.crmContractScope} value={createScope} onValueChange={setCreateScope} />
          </div>
          <div className="sm:col-span-2">
            <Input label={d.crmContractNote} value={createNote} onValueChange={setCreateNote} />
          </div>
          <Select
            label={d.crmContractFeeModel}
            value={createFeeModel}
            onValueChange={(value) => {
              const next = value === "MILESTONES" || value === "HOURLY" ? value : "RETAINER";
              setCreateFeeModel(next);
            }}
            options={[
              { value: "RETAINER", label: d.crmFeeModelRetainer },
              { value: "MILESTONES", label: d.crmFeeModelMilestones },
              { value: "HOURLY", label: d.crmFeeModelHourly },
            ]}
            required
          />
          <Select
            label={d.crmContractFeeItem}
            value={createFeeItemId}
            onValueChange={setCreateFeeItemId}
            placeholder="—"
            hint={d.crmContractFeeItemHint}
            options={serviceItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
            required
          />
          <DatePicker
            locale={locale}
            label={d.crmContractStartDate}
            value={createStartDate}
            onSelect={setCreateStartDate}
          />
          <DatePicker
            locale={locale}
            label={d.crmContractEndDate}
            value={createEndDate}
            onSelect={setCreateEndDate}
          />
          {createFeeModel === "RETAINER" && (
            <div className="sm:col-span-2">
              <MoneyInput
                label={d.crmContractMonthlyAmount}
                amount={createMonthlyAmount}
                onAmountChange={setCreateMonthlyAmount}
                currency={initialRows[0]?.contract.currencyCode ?? "SAR"}
                required
                error={
                  createMonthlyAmount !== "" &&
                  (!MONEY_RE.test(createMonthlyAmount) || Number(createMonthlyAmount) <= 0)
                    ? d.errorsValidation
                    : undefined
                }
              />
            </div>
          )}
          {createFeeModel === "MILESTONES" && (
            <div className="flex flex-col gap-3 sm:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900">{d.crmContractMilestones}</h3>
              {createMilestones.map((line, index) => (
                <div key={index} className="grid gap-3 sm:grid-cols-4">
                  <Input
                    label={d.crmContractMilestoneLabel}
                    value={line.label}
                    onValueChange={(value) => {
                      const next = [...createMilestones];
                      next[index] = { ...line, label: value };
                      setCreateMilestones(next);
                    }}
                  />
                  <DatePicker
                    locale={locale}
                    label={d.crmContractMilestoneDue}
                    value={line.dueDate}
                    onSelect={(value) => {
                      const next = [...createMilestones];
                      next[index] = { ...line, dueDate: value };
                      setCreateMilestones(next);
                    }}
                  />
                  <div className="w-40">
                    <MoneyInput
                      label={d.crmContractMilestoneAmount}
                      amount={line.amount}
                      onAmountChange={(value) => {
                        const next = [...createMilestones];
                        next[index] = { ...line, amount: value };
                        setCreateMilestones(next);
                      }}
                      currency={initialRows[0]?.contract.currencyCode ?? "SAR"}
                      error={
                        line.amount !== "" && !MONEY_RE.test(line.amount)
                          ? d.errorsValidation
                          : undefined
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setCreateMilestones((current) =>
                          current.length <= 1 ? current : current.filter((_, i) => i !== index),
                        );
                      }}
                    >
                      {d.crmContractRemoveMilestone}
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setCreateMilestones((current) => [...current, { ...EMPTY_MILESTONE }])}
                >
                  {d.crmContractAddMilestone}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createContract()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog (DRAFT only) ------------------------------------------------ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen} title={d.crmContractEditTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.crmContractTitleLabel}
            value={editTitle}
            onValueChange={setEditTitle}
            required
            error={editTitle.trim() === "" ? d.errorsValidation : undefined}
          />
          <div className="w-40">
            {contract?.feeModel === "RETAINER" && (
              <MoneyInput
                label={d.crmContractMonthlyAmount}
                amount={editMonthlyAmount}
                onAmountChange={setEditMonthlyAmount}
                currency={contract.currencyCode}
                error={
                  editMonthlyAmount !== "" && !MONEY_RE.test(editMonthlyAmount)
                    ? d.errorsValidation
                    : undefined
                }
              />
            )}
          </div>
          <DatePicker
            locale={locale}
            label={d.crmContractStartDate}
            value={editStartDate}
            onSelect={setEditStartDate}
          />
          <DatePicker
            locale={locale}
            label={d.crmContractEndDate}
            value={editEndDate}
            onSelect={setEditEndDate}
          />
          <div className="sm:col-span-2">
            <Input label={d.crmContractScope} value={editScope} onValueChange={setEditScope} />
          </div>
          <div className="sm:col-span-2">
            <Input label={d.crmContractNote} value={editNote} onValueChange={setEditNote} />
          </div>
          {contract?.feeModel === "MILESTONES" && (
            <div className="flex flex-col gap-3 sm:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900">{d.crmContractMilestones}</h3>
              {editMilestones.map((line, index) => (
                <div key={index} className="grid gap-3 sm:grid-cols-4">
                  <Input
                    label={d.crmContractMilestoneLabel}
                    value={line.label}
                    onValueChange={(value) => {
                      const next = [...editMilestones];
                      next[index] = { ...line, label: value };
                      setEditMilestones(next);
                    }}
                  />
                  <DatePicker
                    locale={locale}
                    label={d.crmContractMilestoneDue}
                    value={line.dueDate}
                    onSelect={(value) => {
                      const next = [...editMilestones];
                      next[index] = { ...line, dueDate: value };
                      setEditMilestones(next);
                    }}
                  />
                  <div className="w-40">
                    <MoneyInput
                      label={d.crmContractMilestoneAmount}
                      amount={line.amount}
                      onAmountChange={(value) => {
                        const next = [...editMilestones];
                        next[index] = { ...line, amount: value };
                        setEditMilestones(next);
                      }}
                      currency={contract.currencyCode}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditMilestones((current) =>
                          current.length <= 1 ? current : current.filter((_, i) => i !== index),
                        );
                      }}
                    >
                      {d.crmContractRemoveMilestone}
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setEditMilestones((current) => [...current, { ...EMPTY_MILESTONE }])}
                >
                  {d.crmContractAddMilestone}
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(false)}>
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

      {/* -- activate / cancel / renew dialogs ----------------------------------------- */}
      <Dialog
        open={activateOpen}
        onOpenChange={setActivateOpen}
        title={d.crmContractActivate}
        description={d.crmContractActivateHint}
      >
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setActivateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "activate"}
            onClick={() => void activateContract()}
          >
            {d.crmContractActivate}
          </Button>
        </div>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title={d.crmContractCancelTitle}>
        <Input
          label={d.crmContractCancelReasonLabel}
          value={cancelReason}
          onValueChange={setCancelReason}
          required
          error={
            cancelReason.trim().length > 500 || cancelReason.trim() === ""
              ? d.errorsValidation
              : undefined
          }
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "cancel"}
            disabled={!cancelReady}
            onClick={() => void cancelContract()}
          >
            {d.crmContractCancelAction}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={renewOpen}
        onOpenChange={setRenewOpen}
        title={d.crmContractRenewTitle}
        description={d.crmContractRenewHint}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            locale={locale}
            label={d.crmContractRenewStart}
            value={renewStart}
            onSelect={setRenewStart}
          />
          <DatePicker
            locale={locale}
            label={d.crmContractRenewEnd}
            value={renewEnd}
            onSelect={setRenewEnd}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRenewOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "renew"} onClick={() => void renewContract()}>
            {d.crmContractRenew}
          </Button>
        </div>
      </Dialog>

      {/* -- the billing-preview dialog ------------------------------------------------ */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen} title={d.crmPreviewTitle}>
        <div className="flex flex-wrap items-end gap-3">
          <DatePicker
            locale={locale}
            label={d.crmPreviewAsOf}
            value={previewAsOf}
            onSelect={setPreviewAsOf}
          />
          <Button
            variant="primary"
            loading={previewLoading}
            disabled={!previewReady}
            onClick={() => void runPreview()}
          >
            {d.crmPreviewRun}
          </Button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {preview === null ? (
            <p className="text-sm text-gray-500">{d.crmPreviewEmpty}</p>
          ) : preview.items.length === 0 ? (
            <p className="text-sm text-gray-500">{d.crmPreviewEmpty}</p>
          ) : (
            preview.items.map((item) => (
              <div key={item.entry.id} className="rounded-md border border-subtle p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{localizedScheduleEntryType(d, item.entry.entryType)}</Badge>
                  <span className="font-mono text-xs" dir="ltr">
                    {item.entry.periodKey ?? entryLabel(item.entry, locale)} · {item.entry.billDate}
                  </span>
                  {item.entry.amount !== null && <span>{moneyCell(item.entry.amount)}</span>}
                  {item.periodLocked && <Badge>{d.crmPreviewLockedChip}</Badge>}
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {item.wouldInvoice.map((line, index) => (
                    <li key={index} className="text-sm text-gray-700">
                      {itemLabelById.get(line.feeItemId) ?? shortId(line.feeItemId)} ·{" "}
                      <span className="font-mono tabular-nums" dir="ltr">
                        {line.qty} × {line.unitPrice ?? "—"}
                      </span>
                      {line.description !== null ? ` · ${line.description}` : ""}
                    </li>
                  ))}
                </ul>
                {item.pullableTimeEntries.length > 0 && (
                  <p className="mt-2 text-xs text-gray-600">
                    {d.crmPreviewPullable}:{" "}
                    <span className="font-mono tabular-nums" dir="ltr">
                      {item.pullableTimeEntries.length}
                    </span>
                  </p>
                )}
                {item.needsNarrative.map((entry) => (
                  <span
                    key={entry.id}
                    className="mt-1 inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text"
                    dir="ltr"
                  >
                    {d.crmPreviewNarrativeChip} · {entry.entryDate} · {entry.hours}h
                  </span>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            {d.commonCancel}
          </Button>
        </div>
      </Dialog>

      {/* -- the advance-tag dialog ---------------------------------------------------- */}
      <Dialog
        open={tagOpen}
        onOpenChange={setTagOpen}
        title={d.crmAdvancesTagTitle}
        description={d.crmAdvancePolicyHint}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.crmAdvanceReceipt}
            value={tagReceiptId}
            onValueChange={setTagReceiptId}
            placeholder="—"
            options={postedReceipts.map((receipt) => ({
              value: receipt.id,
              label: `${receipt.docNo ?? shortId(receipt.id)} · ${receipt.amount} ${receipt.currencyCode}`,
            }))}
            required
          />
          <div className="w-40">
            <MoneyInput
              label={d.crmAdvanceColAmount}
              amount={tagAmount}
              onAmountChange={setTagAmount}
              currency={contract?.currencyCode ?? "SAR"}
              required
              error={
                tagAmount !== "" && (!MONEY_RE.test(tagAmount) || Number(tagAmount) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Input label={d.crmAdvanceNote} value={tagNote} onValueChange={setTagNote} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTagOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "tag"}
            disabled={!tagReady}
            onClick={() => void tagAdvance()}
          >
            {d.crmAdvancesTag}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
