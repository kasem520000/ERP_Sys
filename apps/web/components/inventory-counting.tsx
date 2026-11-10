"use client";

/**
 * T14-UI (PHASE-010) — the count workspace (Transaction Entry Workspace §4
 * variant; Journey D): session list → create (warehouse + blind mode + item
 * picking) → the session sheet (frozen system-qty snapshot, line entry,
 * submit) → variance review (per-line diff + value impact, recount, approve
 * with supervisor flag) — approval posts the G-13/G-14 adjustment through
 * the engine. Blind mode hides the book quantities from the counter.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, DocumentStatusBadge, Input, SearchInput, Select, formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { CountLineRow, CountRow, ItemRow, WarehouseRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedDocumentStatus,
  localizedInventoryError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

function localizedCountStatus(d: ReturnType<typeof getDictionary>, status: string): string {
  switch (status) {
    case "COUNTED":
      return d.countingStatusCounted;
    case "VARIANCE_REVIEW":
      return d.countingStatusVarianceReview;
    default:
      return localizedDocumentStatus(d, status);
  }
}

/** The badge's fixed vocabulary: in-flight count states render warning. */
function countBadgeStatus(status: string): "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "CANCELLED" {
  switch (status) {
    case "COUNTED":
    case "VARIANCE_REVIEW":
      return "PENDING_APPROVAL";
    default:
      return status as "DRAFT" | "POSTED" | "CANCELLED";
  }
}

export function InventoryCounting({
  locale,
  initialRows,
  warehouses,
  items,
  canCreate,
  canApprove,
}: {
  locale: Locale;
  initialRows: readonly CountRow[];
  warehouses: readonly WarehouseRow[];
  items: readonly ItemRow[];
  canCreate: boolean;
  canApprove: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly CountRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create form state.
  const [warehouseId, setWarehouseId] = useState("");
  const [blind, setBlind] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const [picked, setPicked] = useState<readonly string[]>([]);

  // Session workspace state.
  const [openId, setOpenId] = useState<string | null>(null);
  const [lines, setLines] = useState<readonly CountLineRow[]>([]);
  const [entries, setEntries] = useState<Record<number, string>>({});
  const [recountLine, setRecountLine] = useState<number | null>(null);
  const [recountQty, setRecountQty] = useState("");
  const [recountNote, setRecountNote] = useState("");

  const stockItems = useMemo(() => items.filter((item) => item.kind === "STOCK"), [items]);
  const openRow = rows.find((row) => row.id === openId);

  const pickResults = useMemo(() => {
    const needle = pickQuery.trim().toLowerCase();
    if (needle === "") return stockItems.slice(0, 10);
    return stockItems
      .filter(
        (item) =>
          item.sku.toLowerCase().includes(needle) ||
          item.name.toLowerCase().includes(needle) ||
          (item.nameAr ?? "").includes(needle),
      )
      .slice(0, 10);
  }, [stockItems, pickQuery]);

  const createReady = warehouseId !== "" && picked.length >= 1;

  async function createSession(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("create");
    const created = await bffFetch<CountRow>("inventory/counts", {
      method: "POST",
      body: {
        warehouseId,
        blind,
        itemIds: [...picked],
        note: null,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data, ...current]);
    setPicked([]);
    setPickQuery("");
    setNotice(d.countingCreatedToast);
    await openSession(created.data.id);
  }

  async function openSession(id: string): Promise<void> {
    setError(null);
    setBusy(id);
    const result = await bffFetch<readonly CountLineRow[]>(`inventory/counts/${id}/lines`);
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setOpenId(id);
    setLines(result.data);
    setEntries({});
    setRecountLine(null);
    setRecountQty("");
    setRecountNote("");
    router.refresh();
  }

  async function refreshOpen(): Promise<void> {
    if (openId === null) return;
    const [rowResult, lineResult] = await Promise.all([
      bffFetch<CountRow>(`inventory/counts/${openId}`),
      bffFetch<readonly CountLineRow[]>(`inventory/counts/${openId}/lines`),
    ]);
    if (rowResult.ok) {
      setRows((current) => current.map((row) => (row.id === openId ? rowResult.data : row)));
    }
    if (lineResult.ok) {
      setLines(lineResult.data);
    }
    router.refresh();
  }

  async function saveEntries(): Promise<void> {
    if (openId === null) return;
    const payload = Object.entries(entries)
      .filter(([, qty]) => qty.trim() !== "")
      .map(([lineNo, qty]) => ({ lineNo: Number(lineNo), countedQty: qty.trim() }));
    if (payload.length === 0) return;
    setError(null);
    setNotice(null);
    setBusy("save");
    const result = await bffFetch<CountRow>(`inventory/counts/${openId}/enter`, {
      method: "POST",
      body: { entries: payload },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === openId ? result.data : row)));
    setEntries({});
    setNotice(d.countingEntriesSavedToast);
    await refreshOpen();
  }

  async function sessionAction(
    action: "submit" | "approve" | "cancel",
    body?: unknown,
  ): Promise<void> {
    if (openId === null) return;
    setError(null);
    setNotice(null);
    setBusy(action);
    const result = await bffFetch<CountRow>(`inventory/counts/${openId}/${action}`, {
      method: "POST",
      body: body ?? {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === openId ? result.data : row)));
    if (action === "submit") setNotice(d.countingSubmittedToast);
    else if (action === "approve") setNotice(d.countingApprovedToast);
    else setNotice(d.countingCancelledToast);
    await refreshOpen();
  }

  async function submitRecount(): Promise<void> {
    if (openId === null || recountLine === null) return;
    setError(null);
    setNotice(null);
    setBusy("recount");
    const result = await bffFetch<CountRow>(`inventory/counts/${openId}/recount`, {
      method: "POST",
      body: { lineNo: recountLine, countedQty: recountQty.trim(), recountNote: recountNote.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === openId ? result.data : row)));
    setRecountLine(null);
    setRecountQty("");
    setRecountNote("");
    setNotice(d.countingRecountedToast);
    await refreshOpen();
  }

  const varianceSummary = (row: CountRow): string => {
    if (row.variance === null) return "—";
    return `${row.variance.lossLines} / ${row.variance.gainLines}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.countingTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.countingColNo),
              accessor: (row) => row.countNo ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.countNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.countNo}</span>
                ),
            },
            {
              id: "warehouse",
              header: activeLocaleHeader(d.stockColWarehouse),
              accessor: (row) => row.warehouseCode,
              mono: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.warehouseCode}</span>,
            },
            {
              id: "blind",
              header: activeLocaleHeader(d.countingColBlind),
              accessor: (row) => (row.blind ? "yes" : "no"),
              render: (row) => (row.blind ? d.countingBlindYes : d.countingBlindNo),
            },
            {
              id: "snapshot",
              header: activeLocaleHeader(d.countingSnapshotAt),
              accessor: (row) => row.snapshotAt,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.snapshotAt.slice(0, 10)}</span>
              ),
            },
            {
              id: "variance",
              header: activeLocaleHeader(d.countingColVariance),
              accessor: (row) => varianceSummary(row),
              render: (row) => <span className="font-mono text-sm" dir="ltr">{varianceSummary(row)}</span>,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <DocumentStatusBadge
                  status={countBadgeStatus(row.status)}
                  label={localizedCountStatus(d, row.status)}
                />
              ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.countingOpenSession,
              onSelect: (row: CountRow) => void openSession(row.id),
            },
          ]}
          empty={{ title: d.countingEmpty }}
        />
      </Card>

      {openRow !== undefined && (
        <Card
          title={`${openRow.countNo ?? openRow.id.slice(0, 8)} · ${openRow.warehouseCode}`}
          actions={
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              {d.countingCloseSession}
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            {openRow.status === "VARIANCE_REVIEW" && (
              <div className="rounded-sm border border-border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">{d.countingReviewTitle}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{d.countingReviewHint}</p>
                {openRow.variance !== null && (
                  <p className="mt-2 font-mono text-xs tabular-nums" dir="ltr">
                    −{formatMoneyDisplay(openRow.variance.lossValue, 2)} / +
                    {formatMoneyDisplay(openRow.variance.gainValue, 2)}
                  </p>
                )}
              </div>
            )}

            <h3 className="text-sm font-medium">{d.countingSessionLinesTitle}</h3>
            <DataTable
              columns={[
                {
                  id: "lineNo",
                  header: activeLocaleHeader(d.countingColLineNo),
                  accessor: (row) => String(row.lineNo),
                  numeric: true,
                  sortable: true,
                },
                {
                  id: "sku",
                  header: activeLocaleHeader(d.itemsColSku),
                  accessor: (row) => row.sku,
                  mono: true,
                  render: (row) => <span className="font-mono text-sm" dir="ltr">{row.sku}</span>,
                },
                {
                  id: "systemQty",
                  header: activeLocaleHeader(d.countingColSystemQty),
                  accessor: (row) => row.systemQty,
                  numeric: true,
                  render: (row) =>
                    openRow.blind && openRow.status === "DRAFT" ? (
                      <span className="text-muted-foreground" aria-label="blind">
                        •••
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums" dir="ltr">{row.systemQty}</span>
                    ),
                },
                {
                  id: "countedQty",
                  header: activeLocaleHeader(d.countingColCountedQty),
                  accessor: (row) => row.countedQty ?? "",
                  numeric: true,
                  render: (row) =>
                    row.countedQty === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.countedQty}
                        {row.recounted && <span className="text-muted-foreground"> ↻</span>}
                      </span>
                    ),
                },
                {
                  id: "diff",
                  header: activeLocaleHeader(d.countingColDiff),
                  accessor: (row) => row.valueImpact ?? "",
                  numeric: true,
                  render: (row) =>
                    openRow.status === "DRAFT" || row.countedQty === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {(Number(row.countedQty) - Number(row.systemQty)).toFixed(6)}
                      </span>
                    ),
                },
                {
                  id: "impact",
                  header: activeLocaleHeader(d.countingColValueImpact),
                  accessor: (row) => row.valueImpact ?? "",
                  numeric: true,
                  render: (row) =>
                    row.valueImpact === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {formatMoneyDisplay(row.valueImpact, 2)}
                      </span>
                    ),
                },
              ]}
              rows={[...lines]}
              rowKey={(row) => row.id}
              empty={{ title: d.countingEmpty }}
            />

            {openRow.status === "DRAFT" && canCreate && (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {lines.map((line) => (
                    <Input
                      key={line.id}
                      label={`${line.lineNo} · ${line.sku}`}
                      value={entries[line.lineNo] ?? ""}
                      onValueChange={(value) =>
                        setEntries((current) => ({ ...current, [line.lineNo]: value }))
                      }
                      inputMode="decimal"
                      mono
                      bidiIsolate
                    />
                  ))}
                </div>
                <div className="flex gap-2 self-start">
                  <Button
                    variant="secondary"
                    loading={busy === "save"}
                    onClick={() => void saveEntries()}
                  >
                    {d.countingSaveEntries}
                  </Button>
                  <Button
                    variant="primary"
                    loading={busy === "submit"}
                    onClick={() => void sessionAction("submit")}
                  >
                    {d.countingSubmit}
                  </Button>
                  <Button
                    variant="ghost"
                    loading={busy === "cancel"}
                    onClick={() => void sessionAction("cancel")}
                  >
                    {d.countingCancel}
                  </Button>
                </div>
              </div>
            )}

            {openRow.status === "VARIANCE_REVIEW" && canCreate && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {lines
                    .filter((line) => line.countedQty !== null)
                    .map((line) => (
                      <Button
                        key={line.id}
                        variant={recountLine === line.lineNo ? "primary" : "secondary"}
                        onClick={() => {
                          setRecountLine(line.lineNo);
                          setRecountQty(line.countedQty ?? "");
                          setRecountNote("");
                        }}
                      >
                        {`${line.lineNo} · ${line.sku}`}
                      </Button>
                    ))}
                </div>
                {recountLine !== null && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      label={d.countingRecountLineLabel}
                      value={String(recountLine)}
                      onValueChange={() => undefined}
                      mono
                      disabled
                    />
                    <Input
                      label={d.countingColCountedQty}
                      value={recountQty}
                      onValueChange={setRecountQty}
                      inputMode="decimal"
                      mono
                      bidiIsolate
                      required
                    />
                    <Input
                      label={d.countingRecountNoteLabel}
                      value={recountNote}
                      onValueChange={setRecountNote}
                      required
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2 self-start">
                  {recountLine !== null && (
                    <Button
                      variant="secondary"
                      loading={busy === "recount"}
                      disabled={recountQty.trim() === "" || recountNote.trim().length < 3}
                      onClick={() => void submitRecount()}
                    >
                      {d.countingRecountTitle}
                    </Button>
                  )}
                  {canApprove && (
                    <>
                      <Button
                        variant="primary"
                        loading={busy === "approve"}
                        onClick={() => void sessionAction("approve", { supervisor: false })}
                      >
                        {d.countingApprove}
                      </Button>
                      <Button
                        variant="secondary"
                        loading={busy === "approve"}
                        onClick={() => void sessionAction("approve", { supervisor: true })}
                      >
                        {d.countingApproveSupervisor}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    loading={busy === "cancel"}
                    onClick={() => void sessionAction("cancel")}
                  >
                    {d.countingCancel}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {canCreate && (
        <Card title={d.countingNewTitle}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={d.countingWarehouseLabel}
                value={warehouseId}
                onValueChange={setWarehouseId}
                placeholder="—"
                options={warehouses
                  .filter((warehouse) => warehouse.isActive)
                  .map((warehouse) => ({
                    value: warehouse.id,
                    label: `${warehouse.code} · ${warehouse.name}`,
                  }))}
                required
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={blind}
                  onChange={(event) => setBlind(event.target.checked)}
                  className="size-4"
                />
                {d.countingBlindLabel}
              </label>
            </div>

            <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
              <h3 className="text-sm font-medium">{d.countingPickItemsTitle}</h3>
              <SearchInput
                label={d.countingPickSearchPlaceholder}
                value={pickQuery}
                onValueChange={setPickQuery}
              />
              {pickResults.length === 0 ? (
                <p className="text-xs text-muted-foreground">{d.countingPickEmpty}</p>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {pickResults.map((item) => {
                    const selected = picked.includes(item.id);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setPicked((current) =>
                              selected
                                ? current.filter((id) => id !== item.id)
                                : [...current, item.id],
                            )
                          }
                          className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-start text-sm ${
                            selected ? "bg-primary/10" : "hover:bg-muted"
                          }`}
                          aria-pressed={selected}
                        >
                          <span className="font-mono text-xs" dir="ltr">{item.sku}</span>
                          <span className="truncate px-2">{item.name}</span>
                          <span aria-hidden>{selected ? "✓" : "+"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                {d.countingSelectedCount}: {picked.length}
              </p>
            </div>

            <Button
              variant="primary"
              className="self-start"
              loading={busy === "create"}
              disabled={!createReady}
              onClick={() => void createSession()}
            >
              {d.countingCreate}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
