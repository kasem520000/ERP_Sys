"use client";

/**
 * PHASE-044 (T-14) — the quarantine/HOLD board: the held bin-content rows
 * (QUARANTINE by default, HOLD selectable), the G-43 status transitions
 * (policy-gated journal — off by default, BR-077), and the three
 * dispositions (RELEASE / RETURN_TO_VENDOR / SCRAP) riding the directed
 * issue discipline (INV-029 holds at every leg). PHASE-050's quality
 * holds bind at this surface.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  AccountRow,
  WmsBinContentRow,
  WmsQuarantineDisposeResult,
  WmsQuarantineTransitionResult,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedInventoryError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function InventoryQuarantine({
  locale,
  initialRows,
  glAccounts,
  canManage,
}: {
  locale: Locale;
  initialRows: readonly WmsBinContentRow[];
  glAccounts: readonly AccountRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly WmsBinContentRow[]>(initialRows);
  const [statusFilter, setStatusFilter] = useState("QUARANTINE");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The transition form.
  const [rowId, setRowId] = useState("");
  const [toStatus, setToStatus] = useState("AVAILABLE");
  const [note, setNote] = useState("");

  // The disposition form.
  const [disposeRowId, setDisposeRowId] = useState("");
  const [disposition, setDisposition] = useState("RELEASE");
  const [counterAccountId, setCounterAccountId] = useState("");

  const statusLabel = (status: string): string =>
    status === "AVAILABLE" ? d.wmsStatusAvailable :
    status === "QUARANTINE" ? d.wmsStatusQuarantine : d.wmsStatusHold;

  async function reloadBoard(status: string): Promise<void> {
    setStatusFilter(status);
    setBusy("reload");
    setError(null);
    const result = await bffFetch<readonly WmsBinContentRow[]>(
      `inventory/wms/quarantine-board?status=${status}&limit=200`,
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
    router.refresh();
  }

  async function transition(): Promise<void> {
    if (rowId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("transition");
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsQuarantineTransitionResult>(
      `inventory/wms/quarantine-board/${rowId}/transition`,
      {
        method: "POST",
        body: {
          toStatus,
          note: note.trim() === "" ? null : note.trim(),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(result.data.journalEntryId !== null ? d.wmsQJournalToast : d.wmsQTransitionedToast);
    setRowId("");
    setNote("");
    await reloadBoard(statusFilter);
  }

  async function dispose(): Promise<void> {
    if (disposeRowId === "" || (disposition === "RETURN_TO_VENDOR" && counterAccountId === "")) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("dispose");
    setError(null);
    setNotice(null);
    const result = await bffFetch<WmsQuarantineDisposeResult>(
      `inventory/wms/quarantine-board/${disposeRowId}/dispose`,
      {
        method: "POST",
        body: {
          disposition,
          note: note.trim() === "" ? null : note.trim(),
          counterAccountId: counterAccountId === "" ? null : counterAccountId,
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.wmsQDisposedToast);
    setDisposeRowId("");
    setCounterAccountId("");
    await reloadBoard(statusFilter);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.wmsQTitle}>
        <div className="max-w-xs">
          <Select
            label={d.wmsQFilterStatus}
            value={statusFilter}
            onValueChange={(value) => void reloadBoard(value)}
            options={[
              { value: "QUARANTINE", label: d.wmsStatusQuarantine },
              { value: "HOLD", label: d.wmsStatusHold },
              { value: "AVAILABLE", label: d.wmsStatusAvailable },
            ]}
          />
        </div>
        <div className="mt-4">
          <DataTable
            columns={[
              {
                id: "bin",
                header: activeLocaleHeader(d.wmsQColBin),
                accessor: (row) => row.binCode ?? "",
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">{row.binCode ?? "—"}</span>
                ),
              },
              {
                id: "item",
                header: activeLocaleHeader(d.wmsQColItem),
                accessor: (row) => row.itemSku ?? row.itemId,
                mono: true,
              },
              {
                id: "batch",
                header: activeLocaleHeader(d.wmsLocationsContentsColBatch),
                accessor: (row) => row.batchNo ?? "",
                render: (row) => row.batchNo ?? "—",
              },
              {
                id: "qty",
                header: activeLocaleHeader(d.wmsQColQty),
                accessor: (row) => row.qty,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">{row.qty}</span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.wmsQFilterStatus),
                accessor: (row) => row.status,
                render: (row) => statusLabel(row.status),
              },
              {
                id: "received",
                header: activeLocaleHeader(d.wmsQColReceived),
                accessor: (row) => row.receivedAt.slice(0, 10),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={
              canManage
                ? [
                    {
                      id: "transition",
                      label: d.wmsQTransitionTitle,
                      onSelect: (row: WmsBinContentRow) => {
                        setRowId(row.id);
                        setToStatus(row.status === "AVAILABLE" ? "QUARANTINE" : "AVAILABLE");
                      },
                    },
                    {
                      id: "dispose",
                      label: d.wmsQDisposeTitle,
                      onSelect: (row: WmsBinContentRow) => {
                        setDisposeRowId(row.id);
                      },
                    },
                  ]
                : []
            }
            empty={{ title: d.wmsQEmpty }}
          />
        </div>
      </Card>

      {canManage && (
        <>
          <Card title={d.wmsQTransitionTitle}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label={d.wmsQColItem}
                value={rowId}
                onValueChange={setRowId}
                placeholder="—"
                options={rows.map((row) => ({
                  value: row.id,
                  label: `${row.itemSku ?? row.itemId.slice(0, 8)} @ ${row.binCode ?? "—"} (${statusLabel(row.status)})`,
                }))}
                required
              />
              <Select
                label={d.wmsQToStatusLabel}
                value={toStatus}
                onValueChange={setToStatus}
                options={[
                  { value: "AVAILABLE", label: d.wmsStatusAvailable },
                  { value: "QUARANTINE", label: d.wmsStatusQuarantine },
                  { value: "HOLD", label: d.wmsStatusHold },
                ]}
                required
              />
              <Input label={d.wmsQNoteLabel} value={note} onValueChange={setNote} />
            </div>
            <Button variant="primary" className="mt-3 self-start" loading={busy === "transition"} onClick={() => void transition()}>
              {d.wmsQTransitionBtn}
            </Button>
          </Card>

          <Card title={d.wmsQDisposeTitle}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label={d.wmsQColItem}
                value={disposeRowId}
                onValueChange={setDisposeRowId}
                placeholder="—"
                options={rows.map((row) => ({
                  value: row.id,
                  label: `${row.itemSku ?? row.itemId.slice(0, 8)} @ ${row.binCode ?? "—"} (${statusLabel(row.status)})`,
                }))}
                required
              />
              <Select
                label={d.wmsQDispositionLabel}
                value={disposition}
                onValueChange={setDisposition}
                options={[
                  { value: "RELEASE", label: d.wmsQDispositionRelease },
                  { value: "RETURN_TO_VENDOR", label: d.wmsQDispositionRtv },
                  { value: "SCRAP", label: d.wmsQDispositionScrap },
                ]}
                required
              />
              <Select
                label={d.wmsQCounterAccountLabel}
                value={counterAccountId}
                onValueChange={setCounterAccountId}
                placeholder="—"
                options={glAccounts
                  .filter((account) => account.isPostable)
                  .map((account) => ({
                    value: account.id,
                    label: `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`,
                  }))}
              />
              <Input label={d.wmsQNoteLabel} value={note} onValueChange={setNote} />
            </div>
            <Button variant="danger" className="mt-3 self-start" loading={busy === "dispose"} onClick={() => void dispose()}>
              {d.wmsQDisposeBtn}
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
