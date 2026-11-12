"use client";

/**
 * PHASE-044 (T-14) — the pick-wave board: waves with their release/
 * complete/cancel lifecycle, the wave's task list with the PP-11 scan
 * confirmation (the scanned barcode must resolve to the task's allocated
 * bin), the cluster route view, and the warehouse's strategy card
 * (FIFO/FEFO/NEAREST + allow-partial). Task confirms are BOOKKEEPING —
 * the economic move rides the delivery post (INV-029 holds either way).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  WarehouseRow,
  WmsPickStrategyRow,
  WmsPickWaveRow,
  WmsTaskRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedInventoryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const QTY_RE = /^\d+(\.\d{1,6})?$/;

export function InventoryPickWaves({
  locale,
  warehouses,
  initialWaves,
  initialStrategy,
  canPick,
}: {
  locale: Locale;
  warehouses: readonly WarehouseRow[];
  initialWaves: readonly WmsPickWaveRow[];
  initialStrategy: WmsPickStrategyRow | null;
  canPick: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const [waves, setWaves] = useState<readonly WmsPickWaveRow[]>(initialWaves);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);
  const [tasks, setTasks] = useState<readonly WmsTaskRow[]>([]);
  const [strategy, setStrategy] = useState<WmsPickStrategyRow | null>(initialStrategy);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The scan confirm (per task): barcode + optional short qty.
  const [scanTaskId, setScanTaskId] = useState("");
  const [scanBarcode, setScanBarcode] = useState("");
  const [scanQty, setScanQty] = useState("");

  // The strategy card.
  const [strategyWarehouseId, setStrategyWarehouseId] = useState("");
  const [strategyMethod, setStrategyMethod] = useState("FIFO");
  const [strategyPartial, setStrategyPartial] = useState(false);

  const [cancelReason, setCancelReason] = useState("");

  const waveStatusLabel = (status: string): string =>
    status === "DRAFT" ? d.wmsWavesStatusDraft :
    status === "RELEASED" ? d.wmsWavesStatusReleased :
    status === "COMPLETED" ? d.wmsWavesStatusCompleted : d.wmsWavesStatusCancelled;

  const taskStatusLabel = (status: string): string =>
    status === "PENDING" ? d.wmsTaskStatusPending :
    status === "ASSIGNED" ? d.wmsTaskStatusAssigned :
    status === "IN_PROGRESS" ? d.wmsTaskStatusInProgress :
    status === "COMPLETED" ? d.wmsTaskStatusCompleted : d.wmsTaskStatusCancelled;

  const methodLabel = (method: string | null): string =>
    method === "FEFO" ? d.wmsMethodFefo :
    method === "NEAREST" ? d.wmsMethodNearest : d.wmsMethodFifo;

  async function loadTasks(waveId: string): Promise<void> {
    setSelectedWave(waveId);
    setBusy(`tasks-${waveId}`);
    setError(null);
    const result = await bffFetch<readonly WmsTaskRow[]>(`inventory/wms/pick-waves/${waveId}/tasks`);
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTasks(result.data);
  }

  async function releaseWave(waveId: string): Promise<void> {
    setBusy(`release-${waveId}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsPickWaveRow>(`inventory/wms/pick-waves/${waveId}/release`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setWaves((rows) => rows.map((row) => (row.id === waveId ? result.data : row)));
    setNotice(d.wmsWavesReleasedToast);
  }

  async function completeWave(waveId: string): Promise<void> {
    setBusy(`complete-${waveId}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsPickWaveRow>(`inventory/wms/pick-waves/${waveId}/complete`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setWaves((rows) => rows.map((row) => (row.id === waveId ? result.data : row)));
    setNotice(d.wmsWavesCompletedToast);
  }

  async function cancelWave(waveId: string): Promise<void> {
    if (cancelReason.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(`cancel-${waveId}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsPickWaveRow>(`inventory/wms/pick-waves/${waveId}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCancelReason("");
    setWaves((rows) => rows.map((row) => (row.id === waveId ? result.data : row)));
    setNotice(d.wmsWavesCancelledToast);
  }

  async function startTask(taskId: string): Promise<void> {
    setBusy(`start-${taskId}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsTaskRow>(`inventory/wms/pick-tasks/${taskId}/start`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTasks((rows) => rows.map((row) => (row.id === taskId ? result.data : row)));
  }

  async function confirmPick(): Promise<void> {
    if (scanTaskId === "" || scanBarcode.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    if (scanQty.trim() !== "" && !QTY_RE.test(scanQty.trim())) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("confirm");
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsTaskRow>(`inventory/wms/pick-tasks/${scanTaskId}/confirm`, {
      method: "POST",
      body: {
        scannedBarcode: scanBarcode.trim(),
        ...(scanQty.trim() === "" ? {} : { qty: scanQty.trim() }),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTasks((rows) => rows.map((row) => (row.id === scanTaskId ? result.data : row)));
    setScanBarcode("");
    setScanQty("");
    setNotice(d.wmsWavesConfirmedToast);
  }

  async function saveStrategy(): Promise<void> {
    if (strategyWarehouseId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("strategy");
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsPickStrategyRow>("inventory/wms/pick-strategy", {
      method: "PUT",
      body: {
        warehouseId: strategyWarehouseId,
        method: strategyMethod,
        allowPartial: strategyPartial,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setStrategy(result.data);
    setNotice(d.wmsStrategySavedToast);
  }

  const selectedWaveRow = waves.find((row) => row.id === selectedWave) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.wmsWavesTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.wmsWavesColNo),
              accessor: (row) => row.waveNo ?? "",
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.waveNo ?? "—"}</span>
              ),
            },
            {
              id: "wh",
              header: activeLocaleHeader(d.wmsWavesFilterWarehouse),
              accessor: (row) => row.warehouseCode ?? row.warehouseId,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.wmsWavesColStatus),
              accessor: (row) => row.status,
              render: (row) => waveStatusLabel(row.status),
            },
            {
              id: "method",
              header: activeLocaleHeader(d.wmsWavesColMethod),
              accessor: (row) => row.method ?? "",
              render: (row) => methodLabel(row.method),
            },
            {
              id: "created",
              header: activeLocaleHeader(d.wmsWavesColCreated),
              accessor: (row) => row.createdAt.slice(0, 10),
            },
          ]}
          rows={[...waves]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "tasks",
              label: d.wmsWavesTasksTitle,
              onSelect: (row: WmsPickWaveRow) => {
                void loadTasks(row.id);
              },
            },
            ...(canPick
              ? [
                  {
                    id: "release",
                    label: d.wmsWavesRelease,
                    onSelect: (row: WmsPickWaveRow) => {
                      if (row.status !== "DRAFT") return;
                      void releaseWave(row.id);
                    },
                  },
                  {
                    id: "complete",
                    label: d.wmsWavesComplete,
                    onSelect: (row: WmsPickWaveRow) => {
                      if (row.status !== "RELEASED") return;
                      void completeWave(row.id);
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.wmsWavesEmpty }}
        />
        {canPick && (
          <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_auto_auto]">
            <Input
              label={d.wmsWavesCancelReasonLabel}
              value={cancelReason}
              onValueChange={setCancelReason}
            />
            <Button
              variant="danger"
              className="self-end"
              loading={busy?.startsWith("cancel-") ?? false}
              disabled={selectedWaveRow === null || (selectedWaveRow.status !== "DRAFT" && selectedWaveRow.status !== "RELEASED")}
              onClick={() => selectedWaveRow !== null && void cancelWave(selectedWaveRow.id)}
            >
              {d.wmsWavesCancel}
            </Button>
          </div>
        )}
      </Card>

      {selectedWaveRow !== null && (
        <Card title={`${d.wmsWavesTasksTitle} — ${selectedWaveRow.waveNo ?? selectedWaveRow.id.slice(0, 8)}`}>
          <DataTable
            columns={[
              {
                id: "seq",
                header: activeLocaleHeader(d.wmsWavesColTask),
                accessor: (row) => String(row.sequenceNo ?? 0),
                render: (row) => row.sequenceNo ?? "—",
              },
              {
                id: "item",
                header: activeLocaleHeader(d.wmsWavesColItem),
                accessor: (row) => row.itemSku ?? row.itemId,
                mono: true,
              },
              {
                id: "qty",
                header: activeLocaleHeader(d.wmsWavesColQty),
                accessor: (row) => row.qty,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.qtyDone !== "0.000000" && row.status === "COMPLETED" ? row.qtyDone : row.qty}
                  </span>
                ),
              },
              {
                id: "from",
                header: activeLocaleHeader(d.wmsWavesColFromBin),
                accessor: (row) => row.fromBinCode ?? "",
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">{row.fromBinCode ?? "—"}</span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.wmsWavesColStatus),
                accessor: (row) => row.status,
                render: (row) => taskStatusLabel(row.status),
              },
              {
                id: "scan",
                header: activeLocaleHeader(d.wmsScanLabel),
                accessor: (row) => (row.scanVerified ? "Y" : "N"),
                render: (row) => (row.scanVerified ? d.wmsScanSubmit : "—"),
              },
            ]}
            rows={[...tasks]}
            rowKey={(row) => row.id}
            rowActions={
              canPick
                ? [
                    {
                      id: "start",
                      label: d.wmsWavesStartTask,
                      onSelect: (row: WmsTaskRow) => {
                        if (row.status !== "PENDING" && row.status !== "ASSIGNED") return;
                        void startTask(row.id);
                      },
                    },
                    {
                      id: "select",
                      label: d.wmsWavesConfirmBtn,
                      onSelect: (row: WmsTaskRow) => {
                        setScanTaskId(row.id);
                      },
                    },
                  ]
                : []
            }
            empty={{ title: d.wmsWavesTasksEmpty }}
          />
          <p className="mt-3 text-xs text-muted-foreground">{d.wmsWavesClusterHint}</p>
        </Card>
      )}

      {canPick && (
        <Card title={d.wmsScanLabel}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label={d.wmsWavesColTask}
              value={scanTaskId}
              onValueChange={setScanTaskId}
              placeholder="—"
              options={tasks
                .filter((row) => row.status !== "COMPLETED" && row.status !== "CANCELLED")
                .map((row) => ({
                  value: row.id,
                  label: `#${row.sequenceNo ?? "—"} · ${row.itemSku ?? ""} → ${row.fromBinCode ?? ""}`,
                }))}
              required
            />
            <Input
              label={d.wmsScanLabel}
              value={scanBarcode}
              onValueChange={setScanBarcode}
              hint={d.wmsScanPlaceholder}
              mono
              bidiIsolate
              required
            />
            <Input
              label={d.wmsWavesConfirmQtyLabel}
              value={scanQty}
              onValueChange={setScanQty}
              inputMode="decimal"
            />
          </div>
          <Button variant="primary" className="mt-3 self-start" loading={busy === "confirm"} onClick={() => void confirmPick()}>
            {d.wmsWavesConfirmBtn}
          </Button>
        </Card>
      )}

      {canPick && (
        <Card title={d.wmsStrategyTitle}>
          {strategy !== null && (
            <p className="mb-3 text-sm text-muted-foreground" data-testid="wms-strategy-current">
              {d.wmsStrategyMethodLabel}: <span className="font-medium">{methodLabel(strategy.method)}</span>
              {" · "}
              {d.wmsStrategyPartialLabel}: {strategy.allowPartial ? d.wmsLocationsMixedYes : d.wmsLocationsMixedNo}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label={d.wmsWavesFilterWarehouse}
              value={strategyWarehouseId}
              onValueChange={setStrategyWarehouseId}
              placeholder="—"
              options={warehouses
                .filter((w) => w.isActive)
                .map((w) => ({ value: w.id, label: localizedName(w.name, w.nameAr, locale) }))}
              required
            />
            <Select
              label={d.wmsStrategyMethodLabel}
              value={strategyMethod}
              onValueChange={setStrategyMethod}
              options={[
                { value: "FIFO", label: d.wmsMethodFifo },
                { value: "FEFO", label: d.wmsMethodFefo },
                { value: "NEAREST", label: d.wmsMethodNearest },
              ]}
            />
            <Select
              label={d.wmsStrategyPartialLabel}
              value={strategyPartial ? "yes" : "no"}
              onValueChange={(value) => setStrategyPartial(value === "yes")}
              options={[
                { value: "no", label: d.wmsLocationsMixedNo },
                { value: "yes", label: d.wmsLocationsMixedYes },
              ]}
            />
          </div>
          <Button variant="primary" className="mt-3 self-start" loading={busy === "strategy"} onClick={() => void saveStrategy()}>
            {d.commonSave}
          </Button>
        </Card>
      )}
    </div>
  );
}
