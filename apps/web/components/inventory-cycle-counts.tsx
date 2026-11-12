"use client";

/**
 * PHASE-044 (T-14) — the cycle-count workspace: ABC-frequency schedules
 * (create + run-now), the generated count documents with their full
 * DRAFT → COUNTED → VARIANCE_REVIEW → POSTED lifecycle, bin-aware line
 * entry with recount, and the BR-075 supervisor approval gate. Variance
 * postings ride the G-13/G-14 shapes with CYCLE_COUNT_* reasons
 * server-side (INV-029 holds — the plans ride the movement core).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  WarehouseRow,
  WmsCycleCountDocumentRow,
  WmsCycleCountLineRow,
  WmsCycleCountScheduleRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedInventoryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;

export function InventoryCycleCounts({
  locale,
  warehouses,
  schedules,
  initialDocuments,
  canManage,
}: {
  locale: Locale;
  warehouses: readonly WarehouseRow[];
  schedules: readonly WmsCycleCountScheduleRow[];
  initialDocuments: readonly WmsCycleCountDocumentRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [documents, setDocuments] = useState<readonly WmsCycleCountDocumentRow[]>(initialDocuments);
  const [selectedDoc, setSelectedDoc] = useState<WmsCycleCountDocumentRow | null>(null);
  const [lines, setLines] = useState<readonly WmsCycleCountLineRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Counted-qty entry: map lineNo → string.
  const [entries, setEntries] = useState<Record<number, string>>({});

  // The schedule form.
  const [scheduleWarehouseId, setScheduleWarehouseId] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [classADays, setClassADays] = useState("30");
  const [classBDays, setClassBDays] = useState("90");
  const [classCDays, setClassCDays] = useState("365");
  const [threshold, setThreshold] = useState("0");
  const [blind, setBlind] = useState(false);

  const docStatusLabel = (status: string): string =>
    status === "DRAFT" ? d.wmsCcStatusDraft :
    status === "COUNTED" ? d.wmsCcStatusCounted :
    status === "VARIANCE_REVIEW" ? d.wmsCcStatusReview :
    status === "POSTED" ? d.wmsCcStatusPosted : d.wmsCcStatusCancelled;

  async function loadDoc(doc: WmsCycleCountDocumentRow): Promise<void> {
    setSelectedDoc(doc);
    setBusy(`lines-${doc.id}`);
    setError(null);
    const result = await bffFetch<readonly WmsCycleCountLineRow[]>(
      `inventory/wms/cycle-count-documents/${doc.id}/lines`,
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setLines(result.data);
    const initial: Record<number, string> = {};
    for (const line of result.data) {
      initial[line.lineNo] = line.countedQty ?? "";
    }
    setEntries(initial);
  }

  async function createSchedule(): Promise<void> {
    if (
      scheduleWarehouseId === "" ||
      scheduleName.trim() === "" ||
      !/^\d+$/.test(classADays) ||
      !/^\d+$/.test(classBDays) ||
      !/^\d+$/.test(classCDays) ||
      !MONEY_RE.test(threshold)
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("schedule");
    setError(null);
    setNotice(null);
    const created = await bffFetch("inventory/wms/cycle-count-schedules", {
      method: "POST",
      body: {
        warehouseId: scheduleWarehouseId,
        name: scheduleName.trim(),
        classADays: Number(classADays),
        classBDays: Number(classBDays),
        classCDays: Number(classCDays),
        approvalThreshold: threshold,
        blind,
        note: null,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setScheduleName("");
    setNotice(d.wmsCcCreatedToast);
    router.refresh();
  }

  async function runSchedule(id: string): Promise<void> {
    setBusy(`run-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch(`inventory/wms/cycle-count-schedules/${id}/run`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.wmsCcRunToast);
    router.refresh();
  }

  async function enterCounts(): Promise<void> {
    if (selectedDoc === null) return;
    const payload = Object.entries(entries)
      .filter(([, value]) => value.trim() !== "" && QTY_RE.test(value.trim()))
      .map(([lineNo, value]) => ({ lineNo: Number(lineNo), countedQty: value.trim() }));
    if (payload.length === 0) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("enter");
    setError(null);
    setNotice(null);
    const result = await bffFetch(`inventory/wms/cycle-count-documents/${selectedDoc.id}/enter`, {
      method: "POST",
      body: { entries: payload },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.wmsCcEnteredToast);
    await loadDoc(selectedDoc);
  }

  async function lifecycle(doc: WmsCycleCountDocumentRow, step: "submit" | "review" | "approve" | "cancel", supervisor = false): Promise<void> {
    setBusy(`${step}-${doc.id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch(`inventory/wms/cycle-count-documents/${doc.id}/${step}`, {
      method: "POST",
      body: step === "approve" ? { supervisor } : {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      step === "submit" ? d.wmsCcSubmittedToast :
      step === "review" ? d.wmsCcReviewedToast :
      step === "approve" ? d.wmsCcApprovedToast : d.wmsCcCancelledToast,
    );
    router.refresh();
    // Re-read the document row (statuses moved).
    const refreshed = await bffFetch<WmsCycleCountDocumentRow>(
      `inventory/wms/cycle-count-documents/${doc.id}`,
    );
    if (refreshed.ok) {
      setDocuments((rows) => rows.map((row) => (row.id === doc.id ? refreshed.data : row)));
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc(refreshed.data);
        await loadDoc(refreshed.data);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.wmsCcSchedulesTitle}>
        <DataTable
          columns={[
            {
              id: "wh",
              header: activeLocaleHeader(d.wmsCcColWarehouse),
              accessor: (row) => row.warehouseCode ?? row.warehouseId,
            },
            {
              id: "name",
              header: activeLocaleHeader(d.wmsCcColName),
              accessor: (row) => row.name,
            },
            {
              id: "intervals",
              header: activeLocaleHeader(d.wmsCcColIntervals),
              accessor: (row) => `${row.classADays}/${row.classBDays}/${row.classCDays}`,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.classADays}/{row.classBDays}/{row.classCDays}
                </span>
              ),
            },
            {
              id: "threshold",
              header: activeLocaleHeader(d.wmsCcColThreshold),
              accessor: (row) => row.approvalThreshold,
              mono: true,
            },
            {
              id: "blind",
              header: activeLocaleHeader(d.wmsCcColBlind),
              accessor: (row) => (row.blind ? "Y" : "N"),
              render: (row) => (row.blind ? d.wmsCcColBlind : "—"),
            },
            {
              id: "active",
              header: activeLocaleHeader(d.wmsCcColActive),
              accessor: (row) => (row.isActive ? "Y" : "N"),
              render: (row) => (row.isActive ? d.statusActive : "—"),
            },
            {
              id: "lastRun",
              header: activeLocaleHeader(d.wmsCcColLastRun),
              accessor: (row) => row.lastRunAt?.slice(0, 10) ?? "",
              render: (row) => row.lastRunAt?.slice(0, 10) ?? "—",
            },
          ]}
          rows={[...schedules]}
          rowKey={(row) => row.id}
          rowActions={
            canManage
              ? [
                  {
                    id: "run",
                    label: d.wmsCcRunNow,
                    onSelect: (row: WmsCycleCountScheduleRow) => {
                      if (!row.isActive) return;
                      void runSchedule(row.id);
                    },
                  },
                ]
              : []
          }
          empty={{ title: d.wmsCcSchedulesEmpty }}
        />
      </Card>

      {canManage && (
        <Card title={d.wmsCcCreateTitle}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label={d.wmsCcColWarehouse}
              value={scheduleWarehouseId}
              onValueChange={setScheduleWarehouseId}
              placeholder="—"
              options={warehouses
                .filter((w) => w.isActive)
                .map((w) => ({ value: w.id, label: localizedName(w.name, w.nameAr, locale) }))}
              required
            />
            <Input label={d.wmsCcNameLabel} value={scheduleName} onValueChange={setScheduleName} required />
            <Input label={d.wmsCcClassALabel} value={classADays} onValueChange={setClassADays} inputMode="numeric" required />
            <Input label={d.wmsCcClassBLabel} value={classBDays} onValueChange={setClassBDays} inputMode="numeric" required />
            <Input label={d.wmsCcClassCLabel} value={classCDays} onValueChange={setClassCDays} inputMode="numeric" required />
            <Input label={d.wmsCcThresholdLabel} value={threshold} onValueChange={setThreshold} inputMode="decimal" required />
            <Select
              label={d.wmsCcBlindLabel}
              value={blind ? "yes" : "no"}
              onValueChange={(value) => setBlind(value === "yes")}
              options={[
                { value: "no", label: "—" },
                { value: "yes", label: d.wmsCcColBlind },
              ]}
            />
          </div>
          <Button variant="primary" className="mt-3 self-start" loading={busy === "schedule"} onClick={() => void createSchedule()}>
            {d.commonCreate}
          </Button>
        </Card>
      )}

      <Card title={d.wmsCcDocumentsTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.wmsCcColNo),
              accessor: (row) => row.countNo ?? row.id.slice(0, 8),
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">{row.countNo ?? "—"}</span>
              ),
            },
            {
              id: "wh",
              header: activeLocaleHeader(d.wmsCcColWarehouse),
              accessor: (row) => row.warehouseCode ?? row.warehouseId,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.wmsCcColStatus),
              accessor: (row) => row.status,
              render: (row) => docStatusLabel(row.status),
            },
            {
              id: "snapshot",
              header: activeLocaleHeader(d.wmsCcColSnapshot),
              accessor: (row) => row.snapshotAt.slice(0, 10),
            },
            {
              id: "variance",
              header: activeLocaleHeader(d.wmsCcColVariance),
              accessor: (row) => row.varianceLossValue ?? "",
              mono: true,
              render: (row) =>
                row.varianceLossValue === null && row.varianceGainValue === null ? (
                  "—"
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.varianceLossValue ?? "0.0000"} / {row.varianceGainValue ?? "0.0000"}
                  </span>
                ),
            },
          ]}
          rows={[...documents]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "lines",
              label: d.wmsCcLinesTitle,
              onSelect: (row: WmsCycleCountDocumentRow) => {
                void loadDoc(row);
              },
            },
            ...(canManage
              ? [
                  {
                    id: "submit",
                    label: d.wmsCcSubmit,
                    onSelect: (row: WmsCycleCountDocumentRow) => {
                      if (row.status !== "DRAFT") return;
                      void lifecycle(row, "submit");
                    },
                  },
                  {
                    id: "review",
                    label: d.wmsCcReview,
                    onSelect: (row: WmsCycleCountDocumentRow) => {
                      if (row.status !== "COUNTED") return;
                      void lifecycle(row, "review");
                    },
                  },
                  {
                    id: "approve",
                    label: d.wmsCcApprove,
                    onSelect: (row: WmsCycleCountDocumentRow) => {
                      if (row.status !== "VARIANCE_REVIEW") return;
                      void lifecycle(row, "approve");
                    },
                  },
                  {
                    id: "approve-supervisor",
                    label: d.wmsCcApproveSupervisor,
                    onSelect: (row: WmsCycleCountDocumentRow) => {
                      if (row.status !== "VARIANCE_REVIEW") return;
                      void lifecycle(row, "approve", true);
                    },
                  },
                  {
                    id: "cancel",
                    label: d.wmsCcCancel,
                    danger: true,
                    onSelect: (row: WmsCycleCountDocumentRow) => {
                      if (row.status !== "DRAFT") return;
                      void lifecycle(row, "cancel");
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.wmsCcDocumentsEmpty }}
        />
      </Card>

      {selectedDoc !== null && (
        <Card title={`${d.wmsCcLinesTitle} — ${selectedDoc.countNo ?? selectedDoc.id.slice(0, 8)}`}>
          <p className="mb-3 text-sm text-muted-foreground">{d.wmsCcEnterHint}</p>
          <DataTable
            columns={[
              {
                id: "line",
                header: activeLocaleHeader(d.wmsCcColLine),
                accessor: (row) => String(row.lineNo),
              },
              {
                id: "item",
                header: activeLocaleHeader(d.wmsAbcColItem),
                accessor: (row) => row.itemSku ?? row.itemId,
                mono: true,
              },
              {
                id: "bin",
                header: activeLocaleHeader(d.wmsCcColBin),
                accessor: (row) => row.binCode ?? "",
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">{row.binCode ?? "—"}</span>
                ),
              },
              {
                id: "batch",
                header: activeLocaleHeader(d.wmsLocationsContentsColBatch),
                accessor: (row) => row.batchNo ?? "",
                render: (row) => row.batchNo ?? "—",
              },
              {
                id: "system",
                header: activeLocaleHeader(d.wmsCcColSystem),
                accessor: (row) => row.systemQty,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {selectedDoc.blind ? "—" : row.systemQty}
                  </span>
                ),
              },
              {
                id: "counted",
                header: activeLocaleHeader(d.wmsCcColCounted),
                accessor: (row) => row.countedQty ?? "",
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">{row.countedQty ?? "—"}</span>
                ),
              },
              {
                id: "impact",
                header: activeLocaleHeader(d.wmsCcColImpact),
                accessor: (row) => row.valueImpact ?? "",
                mono: true,
                render: (row) =>
                  row.valueImpact === null ? (
                    "—"
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.valueImpact} {row.reason === "CYCLE_COUNT_LOSS" ? `· ${d.wmsCcReasonLoss}` : row.reason === "CYCLE_COUNT_GAIN" ? `· ${d.wmsCcReasonGain}` : ""}
                    </span>
                  ),
              },
            ]}
            rows={[...lines]}
            rowKey={(row) => row.id}
            empty={{ title: d.wmsCcLinesEmpty }}
          />
          {canManage && selectedDoc.status === "DRAFT" && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {lines.slice(0, 8).map((line) => (
                  <Input
                    key={line.id}
                    label={`${d.wmsCcColLine} ${line.lineNo} · ${line.itemSku ?? ""}`}
                    value={entries[line.lineNo] ?? ""}
                    onValueChange={(value) =>
                      setEntries((current) => ({ ...current, [line.lineNo]: value }))
                    }
                    inputMode="decimal"
                  />
                ))}
              </div>
              <Button variant="primary" className="self-start" loading={busy === "enter"} onClick={() => void enterCounts()}>
                {d.wmsCcEnterSave}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
