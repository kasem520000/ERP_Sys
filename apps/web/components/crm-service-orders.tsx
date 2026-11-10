"use client";

/**
 * PHASE-019 T50 — service orders (the job-card workspace pattern):
 *
 * - the SO- list (orderNo / partner / contract / status) with a status
 *   filter (server refetch);
 * - the create dialog: branch, partner, optional contract link, parts
 *   warehouse, note + the SERVICE/PARTS lines editor (SERVICE: item +
 *   estimated hours + per-hour rate; PARTS: item + qty + per-unit price);
 * - the workspace (GET :id): the header card + the lines table + the
 *   lifecycle bar — DRAFT: edit (PUT full-replace, line ids preserved) +
 *   approve (partsIssueMode: reserve | issue_immediate) + cancel;
 *   IN_PROGRESS: log-hours + complete + cancel; COMPLETED: invoice +
 *   cancel; INVOICED/CANCELLED read-only.
 *
 * Hours/qty/prices stay canonical ≤6dp strings (ADR-0009); the parts
 * issue policy is an approve-time choice (0027 has no column — T48).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  PartnerRow,
  ServiceContractReadRow,
  ServiceOrderDetailRow,
  ServiceOrderLineRow,
  ServiceOrderRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedCrmError,
  localizedServiceOrderLineStatus,
  localizedServiceOrderStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Hours/qty/prices ≤ 6dp. */
const QTY_RE = /^\d+(\.\d{1,6})?$/;

/** A line draft (SERVICE | PARTS). */
interface DraftLine {
  /** Preserved on the PUT full-replace (T48's shape). */
  id: string | null;
  lineType: "SERVICE" | "PARTS";
  itemId: string;
  description: string;
  /** SERVICE only — the billed quantity. */
  estimatedHours: string;
  /** PARTS only. */
  qty: string;
  /** SERVICE: the per-hour rate. PARTS: the per-unit price. */
  unitPrice: string;
}

const EMPTY_LINE: DraftLine = {
  id: null,
  lineType: "PARTS",
  itemId: "",
  description: "",
  estimatedHours: "",
  qty: "",
  unitPrice: "",
};

function lineValid(line: DraftLine): boolean {
  if (line.itemId === "") return false;
  if (line.unitPrice !== "" && !QTY_RE.test(line.unitPrice)) return false;
  if (line.lineType === "SERVICE") {
    return QTY_RE.test(line.estimatedHours) && Number(line.estimatedHours) > 0;
  }
  return QTY_RE.test(line.qty) && Number(line.qty) > 0;
}

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

function moneyCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {formatMoneyDisplay(value, 4)}
    </span>
  );
}

export function CrmServiceOrders({
  locale,
  initialRows,
  partners,
  contracts,
  branches,
  warehouses,
  items,
}: {
  locale: Locale;
  initialRows: readonly ServiceOrderRow[];
  partners: readonly PartnerRow[];
  contracts: readonly ServiceContractReadRow[];
  branches: readonly BranchRow[];
  warehouses: readonly WarehouseRow[];
  items: readonly ItemRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly ServiceOrderRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  // List filter (server-side refetch).
  const [statusFilter, setStatusFilter] = useState("");

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createBranchId, setCreateBranchId] = useState("");
  const [createPartnerId, setCreatePartnerId] = useState("");
  const [createContractId, setCreateContractId] = useState("");
  const [createWarehouseId, setCreateWarehouseId] = useState("");
  const [createNote, setCreateNote] = useState("");
  const [createLines, setCreateLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // Workspace state.
  const [selected, setSelected] = useState<ServiceOrderDetailRow | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  // DRAFT edit dialog (PUT full-replace).
  const [editOpen, setEditOpen] = useState(false);
  const [editNote, setEditNote] = useState("");
  const [editLines, setEditLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // Approve dialog (the parts issue policy).
  const [approveOpen, setApproveOpen] = useState(false);
  const [partsIssueMode, setPartsIssueMode] = useState<"reserve" | "issue_immediate">("reserve");

  // Log-hours dialog (SERVICE lines).
  const [hoursOpen, setHoursOpen] = useState(false);
  const [hoursLineId, setHoursLineId] = useState("");
  const [hoursValue, setHoursValue] = useState("");

  // Cancel dialog.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

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
  const activeContracts = useMemo(
    () => contracts.filter((row) => row.contract.status === "ACTIVE"),
    [contracts],
  );
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
  const branchById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) {
      map.set(branch.id, localizedName(branch.name, branch.nameAr, locale));
    }
    return map;
  }, [branches, locale]);
  const warehouseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const warehouse of warehouses) {
      map.set(warehouse.id, localizedName(warehouse.name, warehouse.nameAr, locale));
    }
    return map;
  }, [warehouses, locale]);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches]);
  const activeWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.isActive),
    [warehouses],
  );
  const stockItems = useMemo(
    () => items.filter((item) => item.kind === "STOCK" && item.deletedAt === null),
    [items],
  );
  const serviceItems = useMemo(
    () => items.filter((item) => item.kind === "SERVICE" && item.deletedAt === null),
    [items],
  );
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  /** The item pool per line type (the job-card mirror). */
  function itemOptionsFor(lineType: "SERVICE" | "PARTS") {
    const pool = lineType === "PARTS" ? stockItems : serviceItems;
    return pool.map((item) => ({
      value: item.id,
      label: itemLabelById.get(item.id) ?? item.sku,
    }));
  }

  const createReady =
    createBranchId !== "" &&
    createPartnerId !== "" &&
    createWarehouseId !== "" &&
    createLines.length >= 1 &&
    createLines.every(lineValid);
  const editReady = selected !== null && editLines.length >= 1 && editLines.every(lineValid);
  const hoursReady =
    selected !== null && hoursLineId !== "" && QTY_RE.test(hoursValue) && Number(hoursValue) > 0;
  const cancelReady = cancelReason.trim().length >= 1 && cancelReason.trim().length <= 500;

  const serviceLines = useMemo(
    () =>
      selected === null
        ? []
        : selected.lines.filter(
            (line) => line.lineType === "SERVICE" && line.status !== "VOID",
          ),
    [selected],
  );

  // -- list --------------------------------------------------------------------------

  async function loadList(status: string): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (status !== "") params.set("status", status);
    const result = await bffFetch<readonly ServiceOrderRow[]>(`crm/service-orders?${params.toString()}`);
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

  function draftToWire(line: DraftLine) {
    return {
      id: line.id,
      lineType: line.lineType,
      itemId: line.itemId,
      qty: line.lineType === "PARTS" ? line.qty : null,
      unitPrice: line.unitPrice === "" ? null : line.unitPrice,
      estimatedHours: line.lineType === "SERVICE" ? line.estimatedHours : null,
      description: line.description.trim() === "" ? null : line.description.trim(),
    };
  }

  async function createOrder(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<ServiceOrderRow>("crm/service-orders", {
      method: "POST",
      body: {
        branchId: createBranchId,
        partnerId: createPartnerId,
        contractId: createContractId === "" ? null : createContractId,
        warehouseId: createWarehouseId,
        note: createNote.trim() === "" ? null : createNote.trim(),
        lines: createLines.map(draftToWire),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setCreateBranchId("");
    setCreatePartnerId("");
    setCreateContractId("");
    setCreateWarehouseId("");
    setCreateNote("");
    setCreateLines([{ ...EMPTY_LINE }]);
    setNotice(formatMessage(d.crmServiceOrderCreatedToast, { no: result.data.orderNo ?? "—" }));
    await openWorkspace(result.data.id);
  }

  // -- workspace ------------------------------------------------------------------------

  async function openWorkspace(id: string): Promise<void> {
    setWorkspaceLoading(true);
    setError(null);
    const result = await bffFetch<ServiceOrderDetailRow>(`crm/service-orders/${id}`);
    setWorkspaceLoading(false);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setSelected(result.data);
  }

  async function refreshWorkspace(id: string): Promise<void> {
    const result = await bffFetch<ServiceOrderDetailRow>(`crm/service-orders/${id}`);
    if (result.ok) {
      setSelected(result.data);
      setRows((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    }
  }

  function openEdit(): void {
    if (selected === null) return;
    setEditNote(selected.note ?? "");
    setEditLines(
      selected.lines
        .filter((line) => line.status !== "VOID")
        .map((line) => ({
          id: line.id,
          lineType: line.lineType === "SERVICE" ? "SERVICE" : "PARTS",
          itemId: line.itemId,
          description: line.description ?? "",
          estimatedHours: line.estimatedHours ?? "",
          qty: line.lineType === "PARTS" ? line.qty : "",
          unitPrice: line.unitPrice,
        })),
    );
    setEditOpen(true);
  }

  async function saveEdit(): Promise<void> {
    if (selected === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<ServiceOrderRow>(`crm/service-orders/${selected.id}`, {
      method: "PUT",
      body: {
        note: editNote.trim() === "" ? null : editNote.trim(),
        lines: editLines.map(draftToWire),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEditOpen(false);
    setNotice(d.crmServiceOrderSavedToast);
    await refreshWorkspace(selected.id);
    await loadList(statusFilter);
  }

  async function approveOrder(): Promise<void> {
    if (selected === null) return;
    setBusy("approve");
    setError(null);
    const result = await bffFetch<ServiceOrderRow>(`crm/service-orders/${selected.id}/approve`, {
      method: "POST",
      body: { partsIssueMode },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setApproveOpen(false);
    setNotice(d.crmServiceOrderApprovedToast);
    await refreshWorkspace(selected.id);
    await loadList(statusFilter);
  }

  async function logHours(): Promise<void> {
    if (selected === null || !hoursReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("hours");
    setError(null);
    const result = await bffFetch<ServiceOrderRow>(`crm/service-orders/${selected.id}/log-hours`, {
      method: "POST",
      body: { lineId: hoursLineId, hours: hoursValue },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setHoursOpen(false);
    setHoursLineId("");
    setHoursValue("");
    setNotice(d.crmServiceOrderHoursToast);
    await refreshWorkspace(selected.id);
  }

  async function completeOrder(): Promise<void> {
    if (selected === null) return;
    setBusy("complete");
    setError(null);
    const result = await bffFetch<ServiceOrderRow>(`crm/service-orders/${selected.id}/complete`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.crmServiceOrderCompletedToast);
    await refreshWorkspace(selected.id);
    await loadList(statusFilter);
  }

  async function invoiceOrder(): Promise<void> {
    if (selected === null) return;
    setBusy("invoice");
    setError(null);
    const result = await bffFetch<{
      invoiceId: string;
      invoiceNo: string | null;
      journalEntryId: string;
      cogsJournalEntryId: string | null;
    }>(`crm/service-orders/${selected.id}/invoice`, { method: "POST", body: {} });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.crmServiceOrderInvoicedToast, {
        invoice: result.data.invoiceNo ?? shortId(result.data.invoiceId),
      }),
    );
    await refreshWorkspace(selected.id);
    await loadList(statusFilter);
  }

  async function cancelOrder(): Promise<void> {
    if (selected === null || !cancelReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("cancel");
    setError(null);
    const result = await bffFetch<ServiceOrderRow>(`crm/service-orders/${selected.id}/cancel`, {
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
    setNotice(d.crmServiceOrderCancelledToast);
    await refreshWorkspace(selected.id);
    await loadList(statusFilter);
  }

  // -- the lines table (shared by the workspace) -------------------------------------------

  function linesTable(lines: readonly ServiceOrderLineRow[]): JSX.Element {
    return (
      <table className="w-full text-sm" aria-label={d.crmServiceOrderLines}>
        <thead>
          <tr className="border-b border-subtle text-xs text-gray-600">
            <th scope="col" className="px-2 py-1 text-start">{d.crmServiceOrderColLineNo}</th>
            <th scope="col" className="px-2 py-1 text-start">{d.crmServiceOrderColLineType}</th>
            <th scope="col" className="px-2 py-1 text-start">{d.crmServiceOrderColItem}</th>
            <th scope="col" className="px-2 py-1 text-start">{d.crmServiceOrderColStatus}</th>
            <th scope="col" className="px-2 py-1 text-end">{d.crmServiceOrderColHours}</th>
            <th scope="col" className="px-2 py-1 text-end">{d.crmServiceOrderColLogged}</th>
            <th scope="col" className="px-2 py-1 text-end">{d.crmServiceOrderColQty}</th>
            <th scope="col" className="px-2 py-1 text-end">{d.crmServiceOrderColPrice}</th>
            <th scope="col" className="px-2 py-1 text-end">{d.crmServiceOrderIssueValue}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-subtle">
              <td className="px-2 py-1.5 font-mono" dir="ltr">
                {line.lineNo}
              </td>
              <td className="px-2 py-1.5">
                <Badge tone={line.lineType === "SERVICE" ? "primary" : undefined}>
                  {line.lineType === "SERVICE"
                    ? d.crmServiceOrderLineService
                    : d.crmServiceOrderLineParts}
                </Badge>
              </td>
              <td className="px-2 py-1.5">
                {itemLabelById.get(line.itemId) ?? shortId(line.itemId)}
                {line.description !== null ? (
                  <span className="block text-xs text-gray-500">{line.description}</span>
                ) : null}
              </td>
              <td className="px-2 py-1.5">
                <Badge tone={line.status === "INVOICED" ? "primary" : undefined}>
                  {localizedServiceOrderLineStatus(d, line.status)}
                </Badge>
              </td>
              <td className="px-2 py-1.5 text-end">
                {line.estimatedHours === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  qtyCell(line.estimatedHours)
                )}
              </td>
              <td className="px-2 py-1.5 text-end">{qtyCell(line.loggedHours)}</td>
              <td className="px-2 py-1.5 text-end">{qtyCell(line.qty)}</td>
              <td className="px-2 py-1.5 text-end">{qtyCell(line.unitPrice)}</td>
              <td className="px-2 py-1.5 text-end">
                {line.issueValue === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="flex flex-col">
                    {moneyCell(line.issueValue)}
                    {line.issueJournalId !== null && (
                      <span className="font-mono text-xs text-gray-500" dir="ltr">
                        {shortId(line.issueJournalId)}
                      </span>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  /** The lines editor (shared by create + edit). */
  function linesEditor(
    lines: DraftLine[],
    setLines: (next: DraftLine[]) => void,
  ): JSX.Element {
    return (
      <div className="flex flex-col gap-3 sm:col-span-2">
        <h3 className="text-sm font-semibold text-gray-900">{d.crmServiceOrderLines}</h3>
        {lines.map((line, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-6">
            <Select
              label={d.crmServiceOrderLineType}
              value={line.lineType}
              onValueChange={(value) => {
                const next = [...lines];
                next[index] = {
                  ...line,
                  lineType: value === "SERVICE" ? "SERVICE" : "PARTS",
                  itemId: "",
                  estimatedHours: "",
                  qty: "",
                };
                setLines(next);
              }}
              options={[
                { value: "SERVICE", label: d.crmServiceOrderLineService },
                { value: "PARTS", label: d.crmServiceOrderLineParts },
              ]}
            />
            <Select
              label={d.crmServiceOrderItem}
              value={line.itemId}
              onValueChange={(value) => {
                const next = [...lines];
                next[index] = { ...line, itemId: value };
                setLines(next);
              }}
              placeholder="—"
              options={itemOptionsFor(line.lineType)}
              required
            />
            <Input
              label={d.crmServiceOrderDescription}
              value={line.description}
              onValueChange={(value) => {
                const next = [...lines];
                next[index] = { ...line, description: value };
                setLines(next);
              }}
            />
            {line.lineType === "SERVICE" ? (
              <div className="w-32">
                <Input
                  label={d.crmServiceOrderHours}
                  value={line.estimatedHours}
                  onValueChange={(value) => {
                    const next = [...lines];
                    next[index] = { ...line, estimatedHours: value };
                    setLines(next);
                  }}
                  mono
                  required
                  error={
                    line.estimatedHours !== "" &&
                    (!QTY_RE.test(line.estimatedHours) || Number(line.estimatedHours) <= 0)
                      ? d.errorsValidation
                      : undefined
                  }
                />
              </div>
            ) : (
              <div className="w-32">
                <Input
                  label={d.crmServiceOrderQty}
                  value={line.qty}
                  onValueChange={(value) => {
                    const next = [...lines];
                    next[index] = { ...line, qty: value };
                    setLines(next);
                  }}
                  mono
                  required
                  error={
                    line.qty !== "" && (!QTY_RE.test(line.qty) || Number(line.qty) <= 0)
                      ? d.errorsValidation
                      : undefined
                  }
                />
              </div>
            )}
            <div className="w-32">
              <Input
                label={d.crmServiceOrderUnitPrice}
                value={line.unitPrice}
                onValueChange={(value) => {
                  const next = [...lines];
                  next[index] = { ...line, unitPrice: value };
                  setLines(next);
                }}
                mono
                error={
                  line.unitPrice !== "" && !QTY_RE.test(line.unitPrice)
                    ? d.errorsValidation
                    : undefined
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setLines(lines.length <= 1 ? lines : lines.filter((_, i) => i !== index));
                }}
              >
                {d.crmServiceOrderRemoveLine}
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={() => setLines([...lines, { ...EMPTY_LINE }])}>
            {d.crmServiceOrderAddLine}
          </Button>
        </div>
      </div>
    );
  }

  // -- render --------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.crmServiceOrdersTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.crmServiceOrdersNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={(value) => onFilterChange(value)}
            options={[
              { value: "", label: d.crmServiceOrdersAllStatuses },
              { value: "DRAFT", label: d.crmServiceOrderStatusDraft },
              { value: "IN_PROGRESS", label: d.crmServiceOrderStatusInProgress },
              { value: "COMPLETED", label: d.crmServiceOrderStatusCompleted },
              { value: "INVOICED", label: d.crmServiceOrderStatusInvoiced },
              { value: "CANCELLED", label: d.crmServiceOrderStatusCancelled },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "no",
                header: activeLocaleHeader(d.crmServiceOrderColNo),
                accessor: (row) => row.orderNo ?? row.id,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.orderNo ?? shortId(row.id)}
                  </span>
                ),
              },
              {
                id: "partner",
                header: activeLocaleHeader(d.crmServiceOrderColPartner),
                accessor: (row) => partnerLabelById.get(row.partnerId) ?? row.partnerId,
                render: (row) =>
                  partnerLabelById.get(row.partnerId) ?? shortId(row.partnerId),
              },
              {
                id: "contract",
                header: activeLocaleHeader(d.crmServiceOrderColContract),
                accessor: (row) => row.contractId ?? "",
                render: (row) =>
                  row.contractId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    (contractLabelById.get(row.contractId) ?? shortId(row.contractId))
                  ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "INVOICED" ? "primary" : undefined}>
                    {localizedServiceOrderStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "created",
                header: activeLocaleHeader(d.crmLeadColCreated),
                accessor: (row) => row.createdAt,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.createdAt.slice(0, 10)}
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
                  void openWorkspace(row.id);
                },
              },
            ]}
            empty={{ title: d.crmServiceOrdersEmpty }}
          />
        </div>
      </Card>

      {workspaceLoading && selected === null && (
        <Card title={d.crmServiceOrderWorkspace}>
          <p className="text-sm text-gray-500">…</p>
        </Card>
      )}

      {/* -- the workspace ------------------------------------------------------------- */}
      {selected !== null && (
        <Card
          title={`${d.crmServiceOrderWorkspace} · ${selected.orderNo ?? shortId(selected.id)}`}
          description={d.crmServiceOrderContractHint}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selected.status === "INVOICED" ? "primary" : undefined}>
                {localizedServiceOrderStatus(d, selected.status)}
              </Badge>
              <span className="text-sm text-gray-600">
                {d.crmServiceOrderColPartner}:{" "}
                {partnerLabelById.get(selected.partnerId) ?? shortId(selected.partnerId)}
              </span>
              {selected.contractId !== null && (
                <span className="text-sm text-gray-600">
                  {d.crmServiceOrderColContract}:{" "}
                  {contractLabelById.get(selected.contractId) ?? shortId(selected.contractId)}
                </span>
              )}
              <span className="text-sm text-gray-600">
                {branchById.get(selected.branchId) ?? shortId(selected.branchId)} ·{" "}
                {warehouseById.get(selected.warehouseId) ?? shortId(selected.warehouseId)}
              </span>
              {selected.note !== null && (
                <span className="text-sm text-gray-600">{selected.note}</span>
              )}
              {selected.cancelReason !== null && (
                <span className="text-sm text-gray-600">
                  {d.crmServiceOrderCancelReason}: {selected.cancelReason}
                </span>
              )}
            </div>

            {linesTable(selected.lines)}

            <div className="flex flex-wrap gap-2">
              {selected.status === "DRAFT" && (
                <>
                  <Button variant="secondary" onClick={openEdit}>
                    {d.commonSave}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setPartsIssueMode("reserve");
                      setApproveOpen(true);
                    }}
                  >
                    {d.crmServiceOrderApprove}
                  </Button>
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    {d.crmServiceOrderCancelAction}
                  </Button>
                </>
              )}
              {selected.status === "IN_PROGRESS" && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setHoursLineId(serviceLines[0]?.id ?? "");
                      setHoursValue("");
                      setHoursOpen(true);
                    }}
                    disabled={serviceLines.length === 0}
                  >
                    {d.crmServiceOrderLogHours}
                  </Button>
                  <Button variant="primary" onClick={() => void completeOrder()}>
                    {d.crmServiceOrderComplete}
                  </Button>
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    {d.crmServiceOrderCancelAction}
                  </Button>
                </>
              )}
              {selected.status === "COMPLETED" && (
                <>
                  <Button variant="primary" onClick={() => void invoiceOrder()}>
                    {d.crmServiceOrderInvoiceAction}
                  </Button>
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    {d.crmServiceOrderCancelAction}
                  </Button>
                </>
              )}
              <Button variant="ghost" onClick={() => setSelected(null)}>
                {d.commonClear}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* -- create dialog --------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.crmServiceOrderCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.mfgOrderBranch}
            value={createBranchId}
            onValueChange={setCreateBranchId}
            placeholder="—"
            options={activeBranches.map((branch) => ({
              value: branch.id,
              label: branchById.get(branch.id) ?? branch.code,
            }))}
            required
          />
          <Select
            label={d.crmServiceOrderPartner}
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
            label={d.crmServiceOrderContract}
            value={createContractId}
            onValueChange={setCreateContractId}
            placeholder="—"
            hint={d.crmServiceOrderContractHint}
            options={[
              { value: "", label: d.crmServiceOrderContract },
              ...activeContracts.map((row) => ({
                value: row.contract.id,
                label: contractLabelById.get(row.contract.id) ?? row.contract.title,
              })),
            ]}
          />
          <Select
            label={d.mfgOrderMaterialsWarehouse}
            value={createWarehouseId}
            onValueChange={setCreateWarehouseId}
            placeholder="—"
            options={activeWarehouses.map((warehouse) => ({
              value: warehouse.id,
              label: warehouseById.get(warehouse.id) ?? warehouse.code,
            }))}
            required
          />
          <div className="sm:col-span-2">
            <Input label={d.crmTaskNote} value={createNote} onValueChange={setCreateNote} />
          </div>
          {linesEditor(createLines, (next) => setCreateLines(next))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createOrder()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog (DRAFT full-replace) -------------------------------------------- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen} title={d.crmServiceOrderEditTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label={d.crmTaskNote} value={editNote} onValueChange={setEditNote} />
          </div>
          {linesEditor(editLines, (next) => setEditLines(next))}
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

      {/* -- approve dialog (the parts issue policy) -------------------------------------- */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen} title={d.crmServiceOrderApproveTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.crmServiceOrderIssueMode}
            value={partsIssueMode}
            onValueChange={(value) =>
              setPartsIssueMode(value === "issue_immediate" ? "issue_immediate" : "reserve")
            }
            options={[
              { value: "reserve", label: d.crmServiceOrderIssueReserve },
              { value: "issue_immediate", label: d.crmServiceOrderIssueImmediate },
            ]}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setApproveOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "approve"}
            onClick={() => void approveOrder()}
          >
            {d.crmServiceOrderApprove}
          </Button>
        </div>
      </Dialog>

      {/* -- log-hours dialog -------------------------------------------------------------- */}
      <Dialog open={hoursOpen} onOpenChange={setHoursOpen} title={d.crmServiceOrderLogHoursTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.crmServiceOrderLine}
            value={hoursLineId}
            onValueChange={setHoursLineId}
            placeholder="—"
            options={serviceLines.map((line) => ({
              value: line.id,
              label: `${line.lineNo} · ${
                itemLabelById.get(line.itemId) ?? shortId(line.itemId)
              } · ${line.loggedHours}`,
            }))}
            required
          />
          <div className="w-40">
            <Input
              label={d.crmServiceOrderHours}
              value={hoursValue}
              onValueChange={setHoursValue}
              mono
              required
              error={
                hoursValue !== "" && (!QTY_RE.test(hoursValue) || Number(hoursValue) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setHoursOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "hours"}
            disabled={!hoursReady}
            onClick={() => void logHours()}
          >
            {d.crmServiceOrderLogHours}
          </Button>
        </div>
      </Dialog>

      {/* -- cancel dialog ---------------------------------------------------------------- */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title={d.crmServiceOrderCancelTitle}>
        <Input
          label={d.crmServiceOrderCancelReason}
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
            onClick={() => void cancelOrder()}
          >
            {d.crmServiceOrderCancelAction}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
