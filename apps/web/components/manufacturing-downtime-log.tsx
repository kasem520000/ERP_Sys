"use client";

/**
 * PHASE-042 T-11 (M-15/M-16) — the downtime log + the OEE panel:
 *
 * - the filter bar (work center, from/to window) drives BOTH the record
 *   list and the OEE view (server-refetched together);
 * - the record table: started/ended stamps, the localized reason, minutes,
 *   the optional (order, sequence) link, the open/closed badge and the
 *   note; open rows expose the close action (ended-at + minutes — the
 *   final duration is the operator's honest entry, not a wall-clock
 *   derivation);
 * - the OEE panel: the daily/period granularity toggle over the two
 *   security_invoker views, with the three legs computed from the view
 *   facts — availability = (planned − downtime) / planned,
 *   performance = planned / actual, quality = completed ops share
 *   (the statistical floor; the PHASE-050 inspection hook extends the
 *   quality leg later), OEE = A × P × Q.
 *
 * The policy note renders on top: posting is OFF by default (BR-070) —
 * the cost/journal columns stay NULL while record-only.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  DowntimeRecordRow,
  OeeDailyRow,
  OeePeriodRow,
  ProductionOrderRow,
  WorkCenterRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedDowntimeReason,
  localizedManufacturingError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** ISO timestamp to the minute (the close dialog's default end). */
function nowToMinuteIso(): string {
  return new Date().toISOString().slice(0, 16);
}

function stampCell(value: string | null): JSX.Element {
  return value === null ? (
    <span className="text-gray-500">—</span>
  ) : (
    <span className="font-mono text-sm" dir="ltr">
      {value.slice(0, 16).replace("T", " ")}
    </span>
  );
}

/** The three OEE legs from one view row (nulls when the inputs are zero) —
 * accepts the daily or the period shape (the shared numeric fields). */
function oeeLegs(row: OeeDailyRow | OeePeriodRow): {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
} {
  const planned = Number(row.plannedHours);
  const actual = Number(row.actualHours);
  const downtimeHours = row.downtimeMinutes / 60;
  const availability =
    planned > 0 ? Math.max(0, (planned - downtimeHours) / planned) : null;
  const performance = actual > 0 ? planned / actual : null;
  const quality = row.totalOperations > 0
    ? (row.totalOperations - row.skippedOperations) / row.totalOperations
    : null;
  const oee =
    availability !== null && performance !== null && quality !== null
      ? availability * performance * quality
      : null;
  return { availability, performance, quality, oee };
}

function pctCell(value: number | null): JSX.Element {
  return value === null ? (
    <span className="text-gray-500">—</span>
  ) : (
    <span className="font-mono tabular-nums" dir="ltr">
      {(value * 100).toFixed(1)}%
    </span>
  );
}

export function ManufacturingDowntimeLog({
  locale,
  initialRows,
  workCenters,
  orders,
  initialOee,
}: {
  locale: Locale;
  initialRows: readonly DowntimeRecordRow[];
  workCenters: readonly WorkCenterRow[];
  orders: readonly ProductionOrderRow[];
  initialOee: readonly OeeDailyRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Shared filters (both lists refetch on change).
  const [wcFilter, setWcFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  const [rows, setRows] = useState<readonly DowntimeRecordRow[]>(initialRows);

  // OEE state.
  const [granularity, setGranularity] = useState<"daily" | "period">("daily");
  const [oeeDaily, setOeeDaily] = useState<readonly OeeDailyRow[]>(initialOee);
  const [oeePeriod, setOeePeriod] = useState<readonly OeePeriodRow[]>([]);
  const [oeeLoading, setOeeLoading] = useState(false);

  // Close dialog state.
  const [closeRow, setCloseRow] = useState<DowntimeRecordRow | null>(null);
  const [closeEndedAt, setCloseEndedAt] = useState("");
  const [closeDuration, setCloseDuration] = useState("");

  const workCenterLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const wc of workCenters) {
      map.set(wc.id, `${wc.code} · ${localizedName(wc.name, wc.nameAr, locale)}`);
    }
    return map;
  }, [workCenters, locale]);
  const orderLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of orders) {
      map.set(order.id, order.orderNo ?? order.id.slice(0, 8));
    }
    return map;
  }, [orders]);

  const closeReady =
    closeRow !== null &&
    closeEndedAt.trim() !== "" &&
    /^\d{1,4}$/.test(closeDuration) &&
    Number(closeDuration) >= 0 &&
    Number(closeDuration) <= 1440;

  // -- filters (both lists refetch together) ---------------------------------------------

  async function applyFilters(workCenterId: string, from: string, to: string): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (workCenterId !== "") params.set("workCenterId", workCenterId);
    if (from !== "") params.set("from", from);
    if (to !== "") params.set("to", to);
    const result = await bffFetch<readonly DowntimeRecordRow[]>(
      `manufacturing/downtime?${params.toString()}`,
    );
    setListLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
    await loadOee(granularity, workCenterId, from, to);
  }

  async function loadOee(
    gran: "daily" | "period",
    workCenterId: string,
    from: string,
    to: string,
  ): Promise<void> {
    setOeeLoading(true);
    const params = new URLSearchParams({ granularity: gran, limit: "500" });
    if (workCenterId !== "") params.set("workCenterId", workCenterId);
    if (from !== "") params.set("from", from);
    if (to !== "") params.set("to", to);
    const result = await bffFetch<readonly OeeDailyRow[] | readonly OeePeriodRow[]>(
      `manufacturing/oee?${params.toString()}`,
    );
    setOeeLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (gran === "daily") {
      setOeeDaily(result.data as readonly OeeDailyRow[]);
    } else {
      setOeePeriod(result.data as readonly OeePeriodRow[]);
    }
  }

  function onFilterChange(patch: { wc?: string; from?: string; to?: string }): void {
    const next = {
      wc: patch.wc !== undefined ? patch.wc : wcFilter,
      from: patch.from !== undefined ? patch.from : fromFilter,
      to: patch.to !== undefined ? patch.to : toFilter,
    };
    setWcFilter(next.wc);
    setFromFilter(next.from);
    setToFilter(next.to);
    void applyFilters(next.wc, next.from, next.to);
  }

  function onGranularityChange(gran: "daily" | "period"): void {
    setGranularity(gran);
    if (gran === "period" && oeePeriod.length === 0) {
      void loadOee(gran, wcFilter, fromFilter, toFilter);
    }
  }

  // -- close ------------------------------------------------------------------------------

  async function closeRecord(): Promise<void> {
    if (closeRow === null || !closeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("close");
    setError(null);
    const result = await bffFetch<DowntimeRecordRow>(
      `manufacturing/downtime/${closeRow.id}/close`,
      {
        method: "POST",
        body: {
          endedAt: closeEndedAt.trim(),
          durationMinutes: Number(closeDuration),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === result.data.id ? result.data : row)));
    setCloseRow(null);
    setNotice(d.mfgDtClosedToast);
  }

  // -- render --------------------------------------------------------------------------------

  /** The shared DataTable row shape (daily or period granularity — the
   * columns read only the shared numeric fields through oeeLegs). */
  type OeeTableRow = { key: string; bucket: string; row: OeeDailyRow | OeePeriodRow };
  const oeeRows: OeeTableRow[] =
    granularity === "daily"
      ? oeeDaily.map((row) => ({ key: row.day, bucket: row.day, row }))
      : oeePeriod.map((row) => ({ key: row.periodStart, bucket: row.periodStart, row }));

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      <InfoNotice>{d.mfgDtPolicyNote}</InfoNotice>

      <Card title={d.mfgDowntimeTitle}>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgDtWorkCenter}
            value={wcFilter}
            onValueChange={(value) => onFilterChange({ wc: value })}
            placeholder="—"
            options={[
              { value: "", label: "—" },
              ...workCenters.map((wc) => ({
                value: wc.id,
                label: workCenterLabelById.get(wc.id) ?? wc.code,
              })),
            ]}
          />
          <DatePicker
            locale={locale}
            label={d.mfgDtFilterFrom}
            value={fromFilter}
            onSelect={(value) => onFilterChange({ from: value })}
          />
          <DatePicker
            locale={locale}
            label={d.mfgDtFilterTo}
            value={toFilter}
            onSelect={(value) => onFilterChange({ to: value })}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "startedAt",
                header: activeLocaleHeader(d.mfgDtStartedAt),
                accessor: (row) => row.startedAt.slice(0, 16),
                mono: true,
                sortable: true,
                render: (row) => stampCell(row.startedAt),
              },
              {
                id: "workCenter",
                header: activeLocaleHeader(d.mfgDtWorkCenter),
                accessor: (row) => workCenterLabelById.get(row.workCenterId) ?? row.workCenterId,
                render: (row) => workCenterLabelById.get(row.workCenterId) ?? row.workCenterId,
              },
              {
                id: "reason",
                header: activeLocaleHeader(d.mfgDtReason),
                accessor: (row) => row.reasonCode,
                render: (row) => localizedDowntimeReason(d, row.reasonCode),
              },
              {
                id: "duration",
                header: activeLocaleHeader(d.mfgDtDuration),
                accessor: (row) => String(row.durationMinutes),
                numeric: true,
                render: (row) => (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.durationMinutes}
                  </span>
                ),
              },
              {
                id: "order",
                header: activeLocaleHeader(d.mfgDtOrder),
                accessor: (row) => (row.orderId === null ? "" : orderLabelById.get(row.orderId) ?? row.orderId),
                mono: true,
                render: (row) =>
                  row.orderId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {orderLabelById.get(row.orderId) ?? row.orderId.slice(0, 8)}{" "}
                      {row.operationSequence !== null ? `#${row.operationSequence}` : ""}
                    </span>
                  ),
              },
              {
                id: "endedAt",
                header: activeLocaleHeader(d.mfgDtEndedAt),
                accessor: (row) => row.endedAt?.slice(0, 16) ?? "",
                mono: true,
                render: (row) => stampCell(row.endedAt),
              },
              {
                id: "state",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => (row.endedAt === null ? "OPEN" : "CLOSED"),
                render: (row) =>
                  row.endedAt === null ? (
                    <MfgOpenBadge>{d.mfgDtOpenBadge}</MfgOpenBadge>
                  ) : (
                    // A closed record ≈ the completed vocabulary (the order
                    // lifecycle word — no separate closed key by budget).
                    <Badge tone="primary">{d.mfgOrderStatusCompleted}</Badge>
                  ),
              },
              {
                id: "note",
                header: activeLocaleHeader(d.mfgDtNote),
                accessor: (row) => row.note ?? "",
                render: (row) =>
                  row.note === null ? <span className="text-gray-500">—</span> : row.note,
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "close",
                label: d.mfgDtClose,
                onSelect: (row) => {
                  setCloseRow(row);
                  setCloseEndedAt(nowToMinuteIso());
                  setCloseDuration(String(row.durationMinutes));
                },
              },
            ]}
            empty={{ title: d.mfgDtEmpty }}
          />
        </div>
      </Card>

      {/* -- the OEE panel (M-16) ---------------------------------------------------------- */}
      <Card
        title={d.mfgOeeTitle}
        actions={
          <div className="flex gap-2">
            <Button
              variant={granularity === "daily" ? "primary" : "secondary"}
              onClick={() => onGranularityChange("daily")}
            >
              {d.mfgOeeDaily}
            </Button>
            <Button
              variant={granularity === "period" ? "primary" : "secondary"}
              onClick={() => onGranularityChange("period")}
            >
              {d.mfgOeePeriod}
            </Button>
          </div>
        }
      >
        <DataTable
          loading={oeeLoading}
          columns={[
            {
              id: "workCenter",
              header: activeLocaleHeader(d.mfgDtWorkCenter),
              accessor: (row) => workCenterLabelById.get(row.row.workCenterId) ?? row.row.workCenterId,
              render: (row) =>
                workCenterLabelById.get(row.row.workCenterId) ?? row.row.workCenterId,
            },
            {
              id: "bucket",
              header: activeLocaleHeader(granularity === "daily" ? d.mfgOeeDay : d.mfgOeePeriodStart),
              accessor: (row) => row.bucket,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.bucket}
                </span>
              ),
            },
            {
              id: "planned",
              header: activeLocaleHeader(d.mfgOeePlannedHours),
              accessor: (row) => row.row.plannedHours,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {Number(row.row.plannedHours).toFixed(2)}
                </span>
              ),
            },
            {
              id: "actual",
              header: activeLocaleHeader(d.mfgOeeActualHours),
              accessor: (row) => row.row.actualHours,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {Number(row.row.actualHours).toFixed(2)}
                </span>
              ),
            },
            {
              id: "downtime",
              header: activeLocaleHeader(d.mfgOeeDowntimeMinutes),
              accessor: (row) => String(row.row.downtimeMinutes),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.row.downtimeMinutes}
                </span>
              ),
            },
            {
              id: "availability",
              header: activeLocaleHeader(d.mfgOeeAvailability),
              accessor: (row) => String(oeeLegs(row.row).availability ?? ""),
              numeric: true,
              render: (row) => pctCell(oeeLegs(row.row).availability),
            },
            {
              id: "performance",
              header: activeLocaleHeader(d.mfgOeePerformance),
              accessor: (row) => String(oeeLegs(row.row).performance ?? ""),
              numeric: true,
              render: (row) => pctCell(oeeLegs(row.row).performance),
            },
            {
              id: "quality",
              header: activeLocaleHeader(d.mfgOeeQuality),
              accessor: (row) => String(oeeLegs(row.row).quality ?? ""),
              numeric: true,
              render: (row) => pctCell(oeeLegs(row.row).quality),
            },
            {
              id: "oee",
              header: activeLocaleHeader(d.mfgOee),
              accessor: (row) => String(oeeLegs(row.row).oee ?? ""),
              numeric: true,
              render: (row) => pctCell(oeeLegs(row.row).oee),
            },
          ]}
          rows={oeeRows}
          rowKey={(row) => `${row.row.workCenterId}-${row.key}`}
          empty={{ title: d.mfgOeeEmpty }}
        />
      </Card>

      {/* -- close dialog ------------------------------------------------------------------- */}
      <Dialog
        open={closeRow !== null}
        onOpenChange={(open) => {
          if (!open) setCloseRow(null);
        }}
        title={d.mfgDtClose}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {/* The house datetime pattern (the sourcing due-at precedent): a
           * DatePicker + an HH:mm mono input — the base Input has no
           * datetime-local type. */}
          <DatePicker
            label={d.mfgDtEndedAt}
            value={closeEndedAt.slice(0, 10) === "" ? undefined : closeEndedAt.slice(0, 10)}
            onSelect={(iso) =>
              setCloseEndedAt(
                `${iso}T${closeEndedAt.slice(11, 16) === "" ? "00:00" : closeEndedAt.slice(11, 16)}`,
              )
            }
            locale={locale}
          />
          <div className="w-40">
            <Input
              label={`${d.mfgDtEndedAt} (HH:mm)`}
              value={closeEndedAt.slice(11, 16)}
              onValueChange={(value) =>
                setCloseEndedAt(
                  `${closeEndedAt.slice(0, 10) === "" ? new Date().toISOString().slice(0, 10) : closeEndedAt.slice(0, 10)}T${value.replace(/[^\d:]/g, "")}`,
                )
              }
              placeholder="HH:mm"
              mono
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgDtDuration}
              value={closeDuration}
              onValueChange={setCloseDuration}
              mono
              required
              inputMode="numeric"
              error={
                closeDuration !== "" &&
                (!/^\d{1,4}$/.test(closeDuration) || Number(closeDuration) > 1440)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCloseRow(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "close"}
            disabled={!closeReady}
            onClick={() => void closeRecord()}
          >
            {d.mfgDtClose}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** The open-record chip (warning tones — a record still accruing). */
function MfgOpenBadge({ children }: { children: string }): JSX.Element {
  return (
    <span className="inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
      {children}
    </span>
  );
}
