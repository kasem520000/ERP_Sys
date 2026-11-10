"use client";

/**
 * PHASE-018 T41 — the production-order workspace:
 *
 *   DRAFT → RELEASED (PRD number + BOM bind + level-1 plan freeze)
 *         → IN_PROGRESS → COMPLETED / CANCELLED (zero consumptions only)
 *
 * - the order list (order no, sku, status badge, planned/actual qty, FG
 *   value, completed-at) with the status filter;
 * - the create dialog (branch, FG item, optional explicit BOM version,
 *   planned qty/date, materials + FG warehouses, optional labor/overhead
 *   rates) — NO inline edit (edits are rare; a replacement order or an
 *   adjusted consumption is the documented correction path);
 * - the selected order's detail: the header card (WIP-relevant money
 *   fields + the produced batch), the plan-lines table (over_plan badge),
 *   the lifecycle action bar per status, the consume dialog (planned
 *   components only; optional explicit batch), the scrap dialog
 *   (reason-coded, value ≤ WIP) and the complete dialog (FG receipt + the
 *   completion summary), plus the consumptions/scraps tables. Money and
 *   quantities stay canonical decimal strings (ADR-0009).
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
  BatchRow,
  BomRow,
  BranchRow,
  CompletionResult,
  ConsumeResult,
  ItemRow,
  ProductionOrderDetail,
  ProductionOrderRow,
  ScrapResult,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedManufacturingError,
  localizedProductionOrderStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Quantities ≤ 6dp (planned/consumed/actual); rates ≤ 6dp; money ≤ 4dp. */
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const RATE_RE = /^\d+(\.\d{1,6})?$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** A consume-line draft (component limited to the order's planned set). */
interface ConsumeDraft {
  itemId: string;
  qty: string;
  batchId: string;
}

const EMPTY_CONSUME: ConsumeDraft = { itemId: "", qty: "", batchId: "" };

function consumeLineValid(line: ConsumeDraft): boolean {
  return line.itemId !== "" && QTY_RE.test(line.qty) && Number(line.qty) > 0;
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

function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * A warning chip (the over_plan flag) — the frozen @erp/ui Badge ships
 * neutral/primary only, so this composes the semantic warning token
 * classes the read-only banner / StatusChip precedent already use.
 */
function MfgWarningBadge({ children }: { children: string }): JSX.Element {
  return (
    <span className="inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
      {children}
    </span>
  );
}

export function ManufacturingOrders({
  locale,
  initialRows,
  items,
  warehouses,
  branches,
  boms,
  today,
}: {
  locale: Locale;
  initialRows: readonly ProductionOrderRow[];
  items: readonly ItemRow[];
  warehouses: readonly WarehouseRow[];
  branches: readonly BranchRow[];
  boms: readonly BomRow[];
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly ProductionOrderRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // List filter (server-side refetch).
  const [statusFilter, setStatusFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [itemId, setItemId] = useState("");
  const [bomId, setBomId] = useState("");
  const [plannedQty, setPlannedQty] = useState("");
  const [plannedDate, setPlannedDate] = useState(today);
  const [materialsWarehouseId, setMaterialsWarehouseId] = useState("");
  const [fgWarehouseId, setFgWarehouseId] = useState("");
  const [laborRate, setLaborRate] = useState("");
  const [overheadRate, setOverheadRate] = useState("");

  // Selected order workspace.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductionOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Consume dialog state.
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [consumeLines, setConsumeLines] = useState<ConsumeDraft[]>([{ ...EMPTY_CONSUME }]);
  const [consumedAt, setConsumedAt] = useState(today);
  const [batchesByItem, setBatchesByItem] = useState<ReadonlyMap<string, readonly BatchRow[]>>(
    new Map(),
  );
  const [batchesLoading, setBatchesLoading] = useState(false);

  // Scrap dialog state.
  const [scrapOpen, setScrapOpen] = useState(false);
  const [scrapQty, setScrapQty] = useState("");
  const [scrapReason, setScrapReason] = useState("");
  const [scrapValue, setScrapValue] = useState("");
  const [scrappedAt, setScrappedAt] = useState(today);

  // Complete dialog state.
  const [completeOpen, setCompleteOpen] = useState(false);
  const [actualQty, setActualQty] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [completedAt, setCompletedAt] = useState(today);

  // Cancel dialog state.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const stockItems = useMemo(
    () => items.filter((item) => item.kind === "STOCK" && item.deletedAt === null),
    [items],
  );
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);
  const skuById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, item.sku);
    }
    return map;
  }, [items]);
  const warehouseLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const warehouse of warehouses) {
      map.set(warehouse.id, `${warehouse.code} · ${localizedName(warehouse.name, warehouse.nameAr, locale)}`);
    }
    return map;
  }, [warehouses, locale]);
  const branchLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) {
      map.set(branch.id, `${branch.code} · ${localizedName(branch.name, branch.nameAr, locale)}`);
    }
    return map;
  }, [branches, locale]);
  const itemBoms = useMemo(
    () => boms.filter((row) => row.itemId === itemId),
    [boms, itemId],
  );

  const createReady =
    branchId !== "" &&
    itemId !== "" &&
    QTY_RE.test(plannedQty) &&
    Number(plannedQty) > 0 &&
    materialsWarehouseId !== "" &&
    fgWarehouseId !== "" &&
    (laborRate === "" || RATE_RE.test(laborRate)) &&
    (overheadRate === "" || RATE_RE.test(overheadRate));
  // The consume editor seeds one row per planned component; rows the user
  // leaves empty are simply not sent (at least one filled row is required).
  const consumeFilled = consumeLines.filter((line) => line.qty !== "");
  const consumeReady =
    consumeFilled.length >= 1 && consumeFilled.every(consumeLineValid);
  const scrapReady =
    QTY_RE.test(scrapQty) &&
    Number(scrapQty) > 0 &&
    scrapReason.trim() !== "" &&
    scrapReason.trim().length <= 40 &&
    MONEY_RE.test(scrapValue) &&
    Number(scrapValue) > 0;
  const completeReady = QTY_RE.test(actualQty) && Number(actualQty) > 0;

  // -- list ------------------------------------------------------------------------------

  async function loadList(status: string): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly ProductionOrderRow[]>(
      `manufacturing/production-orders?limit=200${status === "" ? "" : `&status=${status}`}`,
    );
    setListLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onStatusFilterChange(status: string): void {
    setStatusFilter(status);
    void loadList(status);
  }

  // -- create ------------------------------------------------------------------------------

  async function createOrder(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<ProductionOrderRow>("manufacturing/production-orders", {
      method: "POST",
      body: {
        branchId,
        itemId,
        bomId: bomId === "" ? null : bomId,
        plannedQty,
        plannedDate: plannedDate === "" ? null : plannedDate,
        materialsWarehouseId,
        fgWarehouseId,
        laborRate: laborRate === "" ? null : laborRate,
        overheadRate: overheadRate === "" ? null : overheadRate,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setBranchId("");
    setItemId("");
    setBomId("");
    setPlannedQty("");
    setPlannedDate(today);
    setMaterialsWarehouseId("");
    setFgWarehouseId("");
    setLaborRate("");
    setOverheadRate("");
    setNotice(d.mfgOrderCreatedToast);
    await selectOrder(result.data.id);
  }

  // -- selected workspace ---------------------------------------------------------------------

  async function selectOrder(id: string): Promise<void> {
    setSelectedId(id);
    setDetailLoading(true);
    setError(null);
    const result = await bffFetch<ProductionOrderDetail>(`manufacturing/production-orders/${id}`);
    setDetailLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    applyDetail(result.data);
    setActualQty(result.data.order.actualQty === "0.000000" ? "" : result.data.order.actualQty);
  }

  function applyDetail(next: ProductionOrderDetail): void {
    setDetail(next);
    setRows((current) => current.map((row) => (row.id === next.order.id ? next.order : row)));
  }

  async function refreshAfterAction(id: string, toast: string): Promise<void> {
    const result = await bffFetch<ProductionOrderDetail>(`manufacturing/production-orders/${id}`);
    if (result.ok) {
      applyDetail(result.data);
      setNotice(toast);
    }
  }

  async function lifecyclePost(
    action: "release" | "start" | "cancel",
    body: Record<string, unknown>,
    toast: string,
  ): Promise<void> {
    if (selectedId === null) return;
    setBusy(action);
    setError(null);
    const result = await bffFetch<ProductionOrderRow>(
      `manufacturing/production-orders/${selectedId}/${action}`,
      { method: "POST", body },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (action === "cancel") {
      setCancelOpen(false);
      setCancelReason("");
    }
    await refreshAfterAction(result.data.id, toast);
  }

  // -- consume ---------------------------------------------------------------------------------

  function openConsume(): void {
    if (detail === null) return;
    // Seed one line per planned component (the legal issue set).
    setConsumeLines(
      detail.lines.map((line) => ({
        itemId: line.componentItemId,
        qty: "",
        batchId: "",
      })),
    );
    setConsumedAt(today);
    setConsumeOpen(true);
    void loadBatches(detail.lines.map((line) => line.componentItemId));
  }

  /** Batch pool per component (the explicit-batch option; FEFO pick stays
   * the server default when the line leaves the batch empty). */
  async function loadBatches(itemIds: readonly string[]): Promise<void> {
    const missing = itemIds.filter((id) => !batchesByItem.has(id));
    if (missing.length === 0) return;
    setBatchesLoading(true);
    const next = new Map(batchesByItem);
    await Promise.all(
      missing.map(async (id) => {
        const result = await bffFetch<readonly BatchRow[]>(`inventory/batches?itemId=${id}&limit=200`);
        if (result.ok) {
          next.set(id, result.data);
        }
      }),
    );
    setBatchesByItem(next);
    setBatchesLoading(false);
  }

  async function consume(): Promise<void> {
    if (selectedId === null || !consumeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("consume");
    setError(null);
    const result = await bffFetch<ConsumeResult>(
      `manufacturing/production-orders/${selectedId}/consume`,
      {
        method: "POST",
        body: {
          lines: consumeFilled.map((line) => ({
            itemId: line.itemId,
            qty: line.qty,
            batchId: line.batchId === "" ? null : line.batchId,
          })),
          consumedAt: consumedAt === "" ? null : consumedAt,
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setConsumeOpen(false);
    await refreshAfterAction(
      selectedId,
      formatMessage(d.mfgConsumeToast, { journal: shortId(result.data.journalEntryId) }),
    );
  }

  // -- scrap ----------------------------------------------------------------------------------

  async function scrap(): Promise<void> {
    if (selectedId === null || !scrapReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("scrap");
    setError(null);
    const result = await bffFetch<ScrapResult>(`manufacturing/production-orders/${selectedId}/scrap`, {
      method: "POST",
      body: {
        qty: scrapQty,
        reasonCode: scrapReason.trim(),
        value: scrapValue,
        scrappedAt: scrappedAt === "" ? null : scrappedAt,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setScrapOpen(false);
    setScrapQty("");
    setScrapReason("");
    setScrapValue("");
    setScrappedAt(today);
    await refreshAfterAction(
      selectedId,
      formatMessage(d.mfgScrapToast, {
        value: formatMoneyDisplay(result.data.scrap.value, 4),
        journal: shortId(result.data.journalEntryId),
      }),
    );
  }

  // -- complete ---------------------------------------------------------------------------------

  async function complete(): Promise<void> {
    if (selectedId === null || !completeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("complete");
    setError(null);
    const result = await bffFetch<CompletionResult>(
      `manufacturing/production-orders/${selectedId}/complete`,
      {
        method: "POST",
        body: {
          actualQty,
          batchNo: batchNo.trim() === "" ? null : batchNo.trim(),
          completedAt: completedAt === "" ? null : completedAt,
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCompleteOpen(false);
    setBatchNo("");
    await refreshAfterAction(
      selectedId,
      formatMessage(d.mfgCompleteToast, {
        value: formatMoneyDisplay(result.data.fgValue, 4),
        batch: result.data.batchNo ?? "—",
      }),
    );
  }

  // -- render ---------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.mfgOrdersTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.mfgOrdersNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            options={[
              { value: "", label: d.mfgOrdersAllStatuses },
              { value: "DRAFT", label: d.mfgOrderStatusDraft },
              { value: "RELEASED", label: d.mfgOrderStatusReleased },
              { value: "IN_PROGRESS", label: d.mfgOrderStatusInProgress },
              { value: "COMPLETED", label: d.mfgOrderStatusCompleted },
              { value: "CANCELLED", label: d.mfgOrderStatusCancelled },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "no",
                header: activeLocaleHeader(d.mfgOrderNo),
                accessor: (row) => row.orderNo ?? "",
                mono: true,
                sortable: true,
                render: (row) =>
                  row.orderNo === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.orderNo}
                    </span>
                  ),
              },
              {
                id: "sku",
                header: activeLocaleHeader(d.itemsColSku),
                accessor: (row) => skuById.get(row.itemId) ?? row.itemId,
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "IN_PROGRESS" ? "primary" : undefined}>
                    {localizedProductionOrderStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "planned",
                header: activeLocaleHeader(d.mfgOrderPlannedQty),
                accessor: (row) => row.plannedQty,
                numeric: true,
                render: (row) => qtyCell(row.plannedQty),
              },
              {
                id: "actual",
                header: activeLocaleHeader(d.mfgOrderActualQty),
                accessor: (row) => row.actualQty,
                numeric: true,
                render: (row) => qtyCell(row.actualQty),
              },
              {
                id: "fgValue",
                header: activeLocaleHeader(d.mfgOrderFgValue),
                accessor: (row) => row.fgValue,
                numeric: true,
                render: (row) => moneyCell(row.fgValue),
              },
              {
                id: "completedAt",
                header: activeLocaleHeader(d.mfgOrderCompletedAt),
                accessor: (row) => row.completedAt?.slice(0, 10) ?? "",
                mono: true,
                render: (row) =>
                  row.completedAt === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.completedAt.slice(0, 10)}
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
                  void selectOrder(row.id);
                },
              },
            ]}
            empty={{ title: d.mfgOrdersEmpty }}
          />
        </div>
      </Card>

      {/* -- selected order workspace ------------------------------------------------- */}
      {detail !== null && (
        <Card
          title={`${d.mfgOrderDetail} · ${detail.order.orderNo ?? shortId(detail.order.id)}`}
          description={detail.order.status === "DRAFT" ? d.mfgOrderNoEditHint : undefined}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={detail.order.status === "IN_PROGRESS" ? "primary" : undefined}>
                {localizedProductionOrderStatus(d, detail.order.status)}
              </Badge>
              <span className="text-sm text-gray-600">
                {d.mfgBomItem}: {itemLabelById.get(detail.order.itemId) ?? detail.order.itemId}
              </span>
              <span className="text-sm text-gray-600">
                {d.mfgOrderBranch}: {branchLabelById.get(detail.order.branchId) ?? shortId(detail.order.branchId)}
              </span>
              <span className="text-sm text-gray-600">
                {d.mfgOrderMaterialsWarehouse}:{" "}
                {warehouseLabelById.get(detail.order.materialsWarehouseId) ??
                  shortId(detail.order.materialsWarehouseId)}
              </span>
              <span className="text-sm text-gray-600">
                {d.mfgOrderFgWarehouse}:{" "}
                {warehouseLabelById.get(detail.order.fgWarehouseId) ??
                  shortId(detail.order.fgWarehouseId)}
              </span>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [d.mfgOrderPlannedQty, detail.order.plannedQty, false],
                [d.mfgOrderActualQty, detail.order.actualQty, false],
                [d.mfgOrderFgValue, detail.completion.fgValue, true],
                [d.mfgOrderWipCredit, detail.completion.wipCredit, true],
                [d.mfgOrderLabor, detail.completion.labor, true],
                [d.mfgOrderOverhead, detail.completion.overhead, true],
              ].map(([label, value, isMoney]) => (
                <div
                  key={String(label)}
                  className="rounded-md border border-subtle bg-surface-sunken px-3 py-2"
                >
                  <dt className="text-xs text-gray-600">{String(label)}</dt>
                  <dd className="mt-0.5" dir="ltr">
                    {isMoney ? moneyCell(String(value)) : qtyCell(String(value))}
                  </dd>
                </div>
              ))}
            </dl>

            {detail.completion.batchNo !== null && (
              <p className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
                <span className="text-gray-600">{d.mfgOrderBatch}:</span>
                <span className="font-mono" dir="ltr">
                  {detail.completion.batchNo}
                </span>
                {detail.completion.expiry !== null && (
                  <>
                    <span className="text-gray-600">{d.mfgOrderExpiry}:</span>
                    <span className="font-mono" dir="ltr">
                      {detail.completion.expiry}
                    </span>
                  </>
                )}
              </p>
            )}

            {detail.order.cancelReason !== null && (
              <p className="text-sm text-gray-600">
                {d.mfgOrderCancelReason}: {detail.order.cancelReason}
              </p>
            )}

            <div>
              <h3 className="text-sm font-semibold text-gray-900">{d.mfgOrderPlanLines}</h3>
              {detail.lines.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">—</p>
              ) : (
                <table className="mt-2 w-full text-sm" aria-label={d.mfgOrderPlanLines}>
                  <thead>
                    <tr className="border-b border-subtle text-xs text-gray-600">
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgBomComponent}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.mfgOrderPlannedQty}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.mfgBomScrapPct}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.mfgOrderActualQty}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.accountingColStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr key={line.id} className="border-b border-subtle">
                        <td className="px-2 py-1.5">
                          {itemLabelById.get(line.componentItemId) ?? line.componentItemId}
                        </td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(line.plannedQty)}</td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(line.scrapPct)}</td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(line.actualQty)}</td>
                        <td className="px-2 py-1.5">
                          {line.overPlan ? <MfgWarningBadge>{d.mfgOrderOverPlan}</MfgWarningBadge> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {detail.order.status === "DRAFT" && (
                <>
                  <Button
                    variant="primary"
                    loading={busy === "release"}
                    onClick={() =>
                      void lifecyclePost(
                        "release",
                        {},
                        formatMessage(d.mfgOrderReleasedToast, {
                          no: detail.order.orderNo ?? shortId(detail.order.id),
                        }),
                      )
                    }
                  >
                    {d.mfgOrderRelease}
                  </Button>
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    {d.mfgOrderCancel}
                  </Button>
                </>
              )}
              {detail.order.status === "RELEASED" && (
                <>
                  <Button
                    variant="primary"
                    loading={busy === "start"}
                    onClick={() =>
                      void lifecyclePost(
                        "start",
                        {},
                        formatMessage(d.mfgOrderStartedToast, {
                          no: detail.order.orderNo ?? shortId(detail.order.id),
                        }),
                      )
                    }
                  >
                    {d.mfgOrderStart}
                  </Button>
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    {d.mfgOrderCancel}
                  </Button>
                </>
              )}
              {detail.order.status === "IN_PROGRESS" && (
                <>
                  <Button variant="primary" onClick={openConsume}>
                    {d.mfgOrderConsume}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setScrapQty("");
                      setScrapReason("");
                      setScrapValue("");
                      setScrappedAt(today);
                      setScrapOpen(true);
                    }}
                  >
                    {d.mfgOrderScrap}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setCompletedAt(today);
                      setCompleteOpen(true);
                    }}
                  >
                    {d.mfgOrderComplete}
                  </Button>
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    {d.mfgOrderCancel}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setDetail(null);
                  setSelectedId(null);
                }}
              >
                {d.commonClear}
              </Button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">{d.mfgConsumptions}</h3>
              {detail.consumptions.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">—</p>
              ) : (
                <table className="mt-2 w-full text-sm" aria-label={d.mfgConsumptions}>
                  <thead>
                    <tr className="border-b border-subtle text-xs text-gray-600">
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgBomComponent}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumptionBatch}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.stockColQty}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.mfgConsumptionUnitCost}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.mfgConsumptionValue}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumeAt}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumptionJournal}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.consumptions.map((row) => (
                      <tr key={row.id} className="border-b border-subtle">
                        <td className="px-2 py-1.5">
                          {itemLabelById.get(row.itemId) ?? row.itemId}
                        </td>
                        <td className="px-2 py-1.5">
                          {row.batchId === null ? (
                            <span className="text-gray-500">—</span>
                          ) : (
                            <span className="font-mono text-sm" dir="ltr">
                              {batchesByItem.get(row.itemId)?.find((batch) => batch.id === row.batchId)
                                ?.batchNo ?? shortId(row.batchId)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(row.qty)}</td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(row.unitCost)}</td>
                        <td className="px-2 py-1.5 text-end">{moneyCell(row.value)}</td>
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-sm" dir="ltr">
                            {row.consumedAt.slice(0, 10)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          {row.journalId === null ? (
                            <span className="text-gray-500">—</span>
                          ) : (
                            <span className="font-mono text-sm" dir="ltr">
                              {shortId(row.journalId)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">{d.mfgScraps}</h3>
              {detail.scraps.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">—</p>
              ) : (
                <table className="mt-2 w-full text-sm" aria-label={d.mfgScraps}>
                  <thead>
                    <tr className="border-b border-subtle text-xs text-gray-600">
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgScrapReason}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.mfgScrapQty}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.mfgScrapValue}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgScrapAt}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumptionJournal}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.scraps.map((row) => (
                      <tr key={row.id} className="border-b border-subtle">
                        <td className="px-2 py-1.5 font-mono" dir="ltr">
                          {row.reasonCode}
                        </td>
                        <td className="px-2 py-1.5 text-end">{qtyCell(row.qty)}</td>
                        <td className="px-2 py-1.5 text-end">{moneyCell(row.value)}</td>
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-sm" dir="ltr">
                            {row.scrappedAt.slice(0, 10)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          {row.journalId === null ? (
                            <span className="text-gray-500">—</span>
                          ) : (
                            <span className="font-mono text-sm" dir="ltr">
                              {shortId(row.journalId)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </Card>
      )}

      {detailLoading && selectedId !== null && detail === null && (
        <Card title={d.mfgOrderDetail}>
          <p className="text-sm text-gray-500">…</p>
        </Card>
      )}

      {/* -- create dialog ------------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.mfgOrdersNew}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.mfgOrderBranch}
            value={branchId}
            onValueChange={setBranchId}
            placeholder="—"
            options={branches.map((branch) => ({
              value: branch.id,
              label: branchLabelById.get(branch.id) ?? branch.code,
            }))}
            required
          />
          <Select
            label={d.mfgBomItem}
            value={itemId}
            onValueChange={(value) => {
              setItemId(value);
              setBomId("");
            }}
            placeholder="—"
            options={stockItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
            required
          />
          <Select
            label={d.mfgOrderBom}
            value={bomId}
            onValueChange={setBomId}
            placeholder="—"
            options={[
              { value: "", label: d.mfgOrderBomActive },
              ...itemBoms.map((bom) => ({
                value: bom.id,
                label: `v${bom.versionNo} · ${bom.status}`,
              })),
            ]}
          />
          <div className="w-40">
            <Input
              label={d.mfgOrderPlannedQty}
              value={plannedQty}
              onValueChange={setPlannedQty}
              mono
              required
              error={
                plannedQty !== "" && (!QTY_RE.test(plannedQty) || Number(plannedQty) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <DatePicker
            locale={locale}
            label={d.mfgOrderPlannedDate}
            value={plannedDate}
            onSelect={setPlannedDate}
          />
          <Select
            label={d.mfgOrderMaterialsWarehouse}
            value={materialsWarehouseId}
            onValueChange={setMaterialsWarehouseId}
            placeholder="—"
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: warehouseLabelById.get(warehouse.id) ?? warehouse.code,
            }))}
            required
          />
          <Select
            label={d.mfgOrderFgWarehouse}
            value={fgWarehouseId}
            onValueChange={setFgWarehouseId}
            placeholder="—"
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: warehouseLabelById.get(warehouse.id) ?? warehouse.code,
            }))}
            required
          />
          <div className="w-40">
            <Input
              label={d.mfgOrderLaborRate}
              value={laborRate}
              onValueChange={setLaborRate}
              mono
              error={laborRate !== "" && !RATE_RE.test(laborRate) ? d.errorsValidation : undefined}
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgOrderOverheadRate}
              value={overheadRate}
              onValueChange={setOverheadRate}
              mono
              error={overheadRate !== "" && !RATE_RE.test(overheadRate) ? d.errorsValidation : undefined}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">{d.mfgOrderRatesHint}</p>
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

      {/* -- consume dialog -------------------------------------------------------------- */}
      <Dialog open={consumeOpen} onOpenChange={setConsumeOpen} title={d.mfgOrderConsume}>
        <table className="w-full text-sm" aria-label={d.mfgOrderConsume}>
          <thead>
            <tr className="border-b border-subtle text-xs text-gray-600">
              <th scope="col" className="px-2 py-1 text-start">{d.mfgBomComponent}</th>
              <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumeQty}</th>
              <th scope="col" className="px-2 py-1 text-start">{d.mfgConsumeBatch}</th>
              <th scope="col" className="px-2 py-1 text-end">{d.mfgBomRemoveLine}</th>
            </tr>
          </thead>
          <tbody>
            {consumeLines.map((line, index) => (
              <tr key={`${line.itemId}-${index}`} className="border-b border-subtle">
                <td className="px-2 py-1.5">
                  <Select
                    aria-label={d.mfgBomComponent}
                    value={line.itemId}
                    onValueChange={(value) => {
                      setConsumeLines(
                        consumeLines.map((row, i) => (i === index ? { ...row, itemId: value } : row)),
                      );
                      void loadBatches([value]);
                    }}
                    placeholder="—"
                    options={(detail?.lines ?? []).map((plan) => ({
                      value: plan.componentItemId,
                      label: itemLabelById.get(plan.componentItemId) ?? plan.componentItemId,
                    }))}
                    required
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={d.mfgConsumeQty}
                    value={line.qty}
                    onValueChange={(value) =>
                      setConsumeLines(
                        consumeLines.map((row, i) => (i === index ? { ...row, qty: value } : row)),
                      )
                    }
                    mono
                    required
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Select
                    aria-label={d.mfgConsumeBatch}
                    value={line.batchId}
                    onValueChange={(value) =>
                      setConsumeLines(
                        consumeLines.map((row, i) => (i === index ? { ...row, batchId: value } : row)),
                      )
                    }
                    placeholder="—"
                    disabled={batchesLoading}
                    options={[
                      { value: "", label: d.mfgConsumeBatchAuto },
                      ...(batchesByItem.get(line.itemId) ?? []).map((batch) => ({
                        value: batch.id,
                        label: `${batch.batchNo}${batch.expiryDate !== null ? ` · ${batch.expiryDate}` : ""} · ${batch.status}`,
                      })),
                    ]}
                  />
                </td>
                <td className="px-2 py-1.5 text-end">
                  <Button
                    variant="ghost"
                    onClick={() => setConsumeLines(consumeLines.filter((_, i) => i !== index))}
                  >
                    {d.mfgBomRemoveLine}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2">
          <Button
            variant="secondary"
            disabled={detail === null || detail.lines.length === 0}
            onClick={() => {
              const first = detail?.lines[0];
              if (first === undefined) return;
              setConsumeLines([...consumeLines, { ...EMPTY_CONSUME, itemId: first.componentItemId }]);
              void loadBatches([first.componentItemId]);
            }}
          >
            {d.mfgConsumeAddLine}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <DatePicker
            locale={locale}
            label={d.mfgConsumeAt}
            value={consumedAt}
            onSelect={setConsumedAt}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConsumeOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "consume"}
            disabled={!consumeReady}
            onClick={() => void consume()}
          >
            {d.mfgOrderConsume}
          </Button>
        </div>
      </Dialog>

      {/* -- scrap dialog ------------------------------------------------------------------ */}
      <Dialog open={scrapOpen} onOpenChange={setScrapOpen} title={d.mfgScrapTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="w-40">
            <Input
              label={d.mfgScrapQty}
              value={scrapQty}
              onValueChange={setScrapQty}
              mono
              required
              error={
                scrapQty !== "" && (!QTY_RE.test(scrapQty) || Number(scrapQty) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Input
            label={d.mfgScrapReason}
            value={scrapReason}
            onValueChange={setScrapReason}
            required
            error={
              scrapReason.trim() === "" || scrapReason.trim().length > 40
                ? d.mfgErrScrapReasonRequired
                : undefined
            }
          />
          <MoneyInput
            label={d.mfgScrapValue}
            amount={scrapValue}
            onAmountChange={setScrapValue}
            currency="SAR"
            required
            error={
              scrapValue !== "" && (!MONEY_RE.test(scrapValue) || Number(scrapValue) <= 0)
                ? d.errorsValidation
                : undefined
            }
          />
          <DatePicker
            locale={locale}
            label={d.mfgScrapAt}
            value={scrappedAt}
            onSelect={setScrappedAt}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setScrapOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "scrap"}
            disabled={!scrapReady}
            onClick={() => void scrap()}
          >
            {d.mfgOrderScrap}
          </Button>
        </div>
      </Dialog>

      {/* -- complete dialog ----------------------------------------------------------------- */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen} title={d.mfgCompleteTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="w-40">
            <Input
              label={d.mfgCompleteActualQty}
              value={actualQty}
              onValueChange={setActualQty}
              mono
              required
              error={
                actualQty !== "" && (!QTY_RE.test(actualQty) || Number(actualQty) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <Input
            label={d.mfgCompleteBatchNo}
            value={batchNo}
            onValueChange={setBatchNo}
            mono
          />
          <DatePicker
            locale={locale}
            label={d.mfgOrderCompletedAt}
            value={completedAt}
            onSelect={setCompletedAt}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCompleteOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "complete"}
            disabled={!completeReady}
            onClick={() => void complete()}
          >
            {d.mfgOrderComplete}
          </Button>
        </div>
      </Dialog>

      {/* -- cancel dialog -------------------------------------------------------------------- */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title={d.mfgOrderCancelTitle}>
        <Input
          label={d.mfgOrderCancelReason}
          value={cancelReason}
          onValueChange={setCancelReason}
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "cancel"}
            disabled={cancelReason.trim() === ""}
            onClick={() =>
              void lifecyclePost("cancel", { reason: cancelReason.trim() }, d.mfgOrderCancelledToast)
            }
          >
            {d.mfgOrderCancel}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
