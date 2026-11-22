"use client";

/**
 * PHASE-049 (W-21 — T-14) — the meters board (the /assets/meters screen
 * body): the meters register + the readings log + the R-10 odometer
 * designation flows + the fleet register, cloned from the W-20 board
 * pattern (assets-maintenance-board) — the data-slot shape immune to the
 * 045 Tabs defect (two panes on a segmented switch, never the Tabs
 * primitive).
 *
 * THE ENGINE-OUTPUT LAW (carried as-is from the W-12/W-13/W-20 boards):
 * every figure is an ENGINE OUTPUT rendered VERBATIM — the meter's own
 * lastValue/lastReadingAt snapshot, each reading's own value/effectiveDate,
 * the record act's OWN evaluation report (generated orderNo or the NAMED
 * skip via BR-097's vocabulary), and the fleet register's SQL-derived
 * day counts (the database's own arithmetic, never a client-side date
 * computation). Zero client-side recomputation of any engine number.
 *
 * THE R-10 ODOMETER LAW (the engine's own): the odometer checkbox is a
 * KM-only affordance (disabled unless type=KM — ODOMETER_NOT_KM), one per
 * asset (ODOMETER_ALREADY_DESIGNATED), and undesignation is the PATCH
 * {isOdometer:false} — the board only opens the door; the engine decides.
 *
 * THE TYPED-REFUSAL PANEL (the shared piece): a refused action renders the
 * code + the message + the FULL details payload through the notices line's
 * localized summary; a refused list read renders the whole
 * TypedRefusalPanel — never a generic error.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Input,
  Select,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  AssetMeterReadingRow,
  AssetMeterRow,
  FleetLightRow,
  FixedAssetRow,
  MaintenancePlanEvaluationRow,
  MaintenanceWorkOrderRow,
  RecordReadingResult,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedCmmsTransferError,
  localizedMaintenanceSkipReason,
  localizedMeterType,
  localizedReadingSource,
  localizedName,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

/** Meter values ≤ 6dp (ADR-0009 — the engine's own regex). */
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const METER_TYPES = ["HOURS", "KM", "PRODUCTION", "CUSTOM"] as const;
const READING_SOURCES = ["MANUAL", "JOB", "IMPORT"] as const;

type MeterType = (typeof METER_TYPES)[number];
type ReadingSource = (typeof READING_SOURCES)[number];

/** The create-meter draft (the R-10 odometer checkbox is KM-only). */
interface MeterDraft {
  assetId: string;
  name: string;
  nameAr: string;
  type: MeterType;
  unit: string;
  isOdometer: boolean;
  note: string;
  noteAr: string;
}

const EMPTY_METER: MeterDraft = {
  assetId: "",
  name: "",
  nameAr: "",
  type: "HOURS",
  unit: "",
  isOdometer: false,
  note: "",
  noteAr: "",
};

/** The record-reading draft (the JOB link law: source=JOB names its order). */
interface ReadingDraft {
  value: string;
  effectiveDate: string;
  source: ReadingSource;
  workOrderId: string;
  note: string;
  noteAr: string;
}

const EMPTY_READING: ReadingDraft = {
  value: "",
  effectiveDate: "",
  source: "MANUAL",
  workOrderId: "",
  note: "",
  noteAr: "",
};

/** The meter workspace's composed reads: the readings log + the meter's
 * asset's COMPLETED work orders (the JOB reading link's own pool — the
 * engine has no combined endpoint, the board composes the reads). */
interface MeterWorkspaceState {
  meter: AssetMeterRow;
  readings: readonly AssetMeterReadingRow[];
  jobOrders: readonly MaintenanceWorkOrderRow[];
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

/** The semantic-tone chip (the fieldservice-board precedent). */
type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};
function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/** The fleet register's own day-count tone (the sweep's 30/7/0 bands). */
function daysChipTone(days: number): ChipTone {
  if (days <= 7) return "danger";
  if (days <= 30) return "warning";
  return "neutral";
}

export function AssetsMetersBoard({
  locale,
  initialMeters,
  metersError,
  initialFleet,
  fleetError,
  assets,
}: {
  locale: Locale;
  initialMeters: readonly AssetMeterRow[] | null;
  metersError: ApiErrorBody | null;
  initialFleet: readonly FleetLightRow[] | null;
  fleetError: ApiErrorBody | null;
  assets: readonly FixedAssetRow[];
}): JSX.Element {
  const d = getDictionary(locale);

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ------
  const [pane, setPane] = useState<"meters" | "fleet">("meters");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the meters pane ---------------------------------------------------------
  const [meters, setMeters] = useState<readonly AssetMeterRow[] | null>(initialMeters);
  const [metersRefusal, setMetersRefusal] = useState<ApiErrorBody | null>(metersError);
  const [listLoading, setListLoading] = useState(false);
  const [assetFilter, setAssetFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [meterDraft, setMeterDraft] = useState<MeterDraft>({ ...EMPTY_METER });
  const [workspace, setWorkspace] = useState<MeterWorkspaceState | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [readingDraft, setReadingDraft] = useState<ReadingDraft>({ ...EMPTY_READING });
  const [evaluations, setEvaluations] = useState<readonly MaintenancePlanEvaluationRow[] | null>(null);

  // -- the fleet pane ------------------------------------------------------------
  const [fleet, setFleet] = useState<readonly FleetLightRow[] | null>(initialFleet);
  const [fleetRefusal, setFleetRefusal] = useState<ApiErrorBody | null>(fleetError);
  const [fleetLoading, setFleetLoading] = useState(false);

  // -- the derived pools -----------------------------------------------------------
  const assetLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) {
      map.set(asset.id, `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)}`);
    }
    return map;
  }, [assets, locale]);

  const createReady =
    meterDraft.assetId !== "" &&
    meterDraft.name.trim().length >= 1 &&
    meterDraft.name.trim().length <= 200 &&
    meterDraft.unit.trim().length >= 1 &&
    meterDraft.unit.trim().length <= 50 &&
    (!meterDraft.isOdometer || meterDraft.type === "KM");

  const recordReady =
    QTY_RE.test(readingDraft.value) &&
    DATE_RE.test(readingDraft.effectiveDate) &&
    (readingDraft.source !== "JOB" || readingDraft.workOrderId !== "");

  // -- the meters list ------------------------------------------------------------

  async function loadMeters(): Promise<void> {
    setListLoading(true);
    const query = assetFilter === "" ? "" : `?assetId=${encodeURIComponent(assetFilter)}`;
    const result = await bffFetch<readonly AssetMeterRow[]>(`assets/meters${query}`);
    setListLoading(false);
    if (!result.ok) {
      setMetersRefusal(result.error);
      setMeters(null);
      return;
    }
    setMetersRefusal(null);
    setMeters(result.data);
  }

  async function createMeter(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<AssetMeterRow>("assets/meters", {
      method: "POST",
      body: {
        assetId: meterDraft.assetId,
        name: meterDraft.name.trim(),
        nameAr: meterDraft.nameAr.trim() === "" ? null : meterDraft.nameAr.trim(),
        type: meterDraft.type,
        unit: meterDraft.unit.trim(),
        ...(meterDraft.isOdometer && meterDraft.type === "KM" ? { isOdometer: true } : {}),
        note: meterDraft.note.trim() === "" ? null : meterDraft.note.trim(),
        noteAr: meterDraft.noteAr.trim() === "" ? null : meterDraft.noteAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreateOpen(false);
    setMeterDraft({ ...EMPTY_METER });
    setNotice(d.assetsMetersCreatedToast);
    await loadMeters();
  }

  // -- the meter workspace (two reads composed) -------------------------------------

  async function openMeterWorkspace(meter: AssetMeterRow): Promise<void> {
    setWorkspaceLoading(true);
    setError(null);
    setEvaluations(null);
    const [readingsResult, ordersResult] = await Promise.all([
      bffFetch<readonly AssetMeterReadingRow[]>(`assets/meters/${meter.id}/readings`),
      // The JOB reading link's own pool — the asset's COMPLETED orders only
      // (the engine's own law: a JOB reading names a COMPLETED order).
      bffFetch<readonly MaintenanceWorkOrderRow[]>(
        `assets/maintenance/orders?assetId=${encodeURIComponent(meter.assetId)}&status=COMPLETED`,
      ),
    ]);
    setWorkspaceLoading(false);
    if (!readingsResult.ok) {
      setError(localizedCmmsTransferError(d, readingsResult.error, readingsResult.retryAfterSeconds));
      return;
    }
    setWorkspace({
      meter,
      readings: readingsResult.data,
      jobOrders: ordersResult.ok ? ordersResult.data : [],
    });
  }

  async function refreshReadings(meterId: string): Promise<readonly AssetMeterReadingRow[]> {
    const result = await bffFetch<readonly AssetMeterReadingRow[]>(`assets/meters/${meterId}/readings`);
    return result.ok ? result.data : [];
  }

  /** The R-10 designation flows (one door: PATCH isOdometer; the engine decides). */
  async function setOdometerDesignation(meter: AssetMeterRow, next: boolean): Promise<void> {
    setBusy("designate");
    setError(null);
    const result = await bffFetch<AssetMeterRow>(`assets/meters/${meter.id}`, {
      method: "PATCH",
      body: { isOdometer: next },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.assetsMetersDesignatedToast);
    setWorkspace((current) => (current === null ? current : { ...current, meter: result.data }));
    setMeters((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
  }

  /** THE RECORD ACT — the reading + the engine's OWN evaluation report. */
  async function recordReading(): Promise<void> {
    if (workspace === null || !recordReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("record");
    setError(null);
    const result = await bffFetch<RecordReadingResult>(`assets/meters/${workspace.meter.id}/readings`, {
      method: "POST",
      body: {
        value: readingDraft.value,
        effectiveDate: readingDraft.effectiveDate,
        source: readingDraft.source,
        ...(readingDraft.source === "JOB" ? { workOrderId: readingDraft.workOrderId } : {}),
        note: readingDraft.note.trim() === "" ? null : readingDraft.note.trim(),
        noteAr: readingDraft.noteAr.trim() === "" ? null : readingDraft.noteAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsTransferError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRecordOpen(false);
    setReadingDraft({ ...EMPTY_READING });
    setNotice(d.assetsMetersRecordedToast);
    // The engine's own advanced snapshot (the meter row) + the evaluations'
    // own report rows — rendered verbatim, never recomputed.
    setWorkspace({
      meter: result.data.meter,
      readings: await refreshReadings(workspace.meter.id),
      jobOrders: workspace.jobOrders,
    });
    setEvaluations(result.data.evaluations);
    setMeters((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.meter.id ? result.data.meter : row)),
    );
  }

  // -- the fleet register ------------------------------------------------------------

  async function loadFleet(): Promise<void> {
    setFleetLoading(true);
    const result = await bffFetch<readonly FleetLightRow[]>("assets/fleet-light");
    setFleetLoading(false);
    if (!result.ok) {
      setFleetRefusal(result.error);
      setFleet(null);
      return;
    }
    setFleetRefusal(null);
    setFleet(result.data);
  }

  // -- the meters table ---------------------------------------------------------------

  const meterColumns: DataTableColumn<AssetMeterRow>[] = [
    {
      id: "asset",
      header: activeLocaleHeader(d.assetsMetersColAsset),
      accessor: (row) => assetLabelById.get(row.assetId) ?? shortId(row.assetId),
    },
    {
      id: "name",
      header: activeLocaleHeader(d.assetsMetersColName),
      accessor: (row) => localizedName(row.name, row.nameAr, locale),
    },
    {
      id: "type",
      header: activeLocaleHeader(d.assetsMetersColType),
      accessor: (row) => localizedMeterType(d, row.type),
      render: (row) => <Badge tone="neutral">{localizedMeterType(d, row.type)}</Badge>,
    },
    {
      id: "unit",
      header: activeLocaleHeader(d.assetsMetersColUnit),
      accessor: (row) => row.unit,
      render: (row) => monoCell(row.unit),
    },
    {
      id: "odometer",
      header: activeLocaleHeader(d.assetsMetersColOdometer),
      accessor: (row) => (row.isOdometer ? d.assetsMetersColOdometer : "—"),
      render: (row) =>
        row.isOdometer ? <Chip tone="success">{d.assetsMetersColOdometer}</Chip> : <span className="text-xs text-gray-500">—</span>,
    },
    {
      id: "lastValue",
      header: activeLocaleHeader(d.assetsMetersColLastValue),
      accessor: (row) => row.lastValue,
      render: (row) => monoCell(row.lastValue),
    },
    {
      id: "lastReadingAt",
      header: activeLocaleHeader(d.assetsMetersColLastReading),
      accessor: (row) => row.lastReadingAt ?? "—",
      render: (row) => (row.lastReadingAt === null ? <span className="text-xs text-gray-500">—</span> : monoCell(row.lastReadingAt)),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.assetsMaintenanceColActions),
      accessor: () => d.assetsMetersOpen,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => void openMeterWorkspace(row)}>
          {d.assetsMetersOpen}
        </Button>
      ),
    },
  ];

  // -- the fleet table ------------------------------------------------------------------

  /** One expiry column: the engine's own date + the SQL-derived days chip
   * (the tone bands are the sweep's own 30/7/0 — display, never arithmetic). */
  function expiryCell(date: string | null, days: number | null): JSX.Element {
    if (date === null) {
      return <span className="text-xs text-gray-500">{d.assetsFleetNone}</span>;
    }
    return (
      <span className="flex flex-col gap-0.5">
        {monoCell(date)}
        {days !== null ? <Chip tone={daysChipTone(days)}>{`${days} ${d.assetsFleetDays}`}</Chip> : null}
      </span>
    );
  }

  const fleetColumns: DataTableColumn<FleetLightRow>[] = [
    {
      id: "code",
      header: activeLocaleHeader(d.assetsFleetColCode),
      accessor: (row) => row.code,
      render: (row) => monoCell(row.code),
    },
    {
      id: "name",
      header: activeLocaleHeader(d.colName),
      accessor: (row) => localizedName(row.name, row.nameAr, locale),
    },
    {
      id: "category",
      header: activeLocaleHeader(d.assetsFleetColCategory),
      accessor: (row) => row.categoryName,
    },
    {
      id: "branch",
      header: activeLocaleHeader(d.assetsFleetColBranch),
      accessor: (row) => row.branchName,
    },
    {
      id: "warranty",
      header: activeLocaleHeader(d.assetsFleetColWarranty),
      accessor: (row) => row.warrantyExpiry ?? "—",
      render: (row) => expiryCell(row.warrantyExpiry, row.warrantyDays),
    },
    {
      id: "insurance",
      header: activeLocaleHeader(d.assetsFleetColInsurance),
      accessor: (row) => row.insuranceExpiry ?? "—",
      render: (row) => expiryCell(row.insuranceExpiry, row.insuranceDays),
    },
    {
      id: "license",
      header: activeLocaleHeader(d.assetsFleetColLicense),
      accessor: (row) => row.licenseExpiry ?? "—",
      render: (row) => expiryCell(row.licenseExpiry, row.licenseDays),
    },
    {
      id: "inspection",
      header: activeLocaleHeader(d.assetsFleetColInspection),
      accessor: (row) => row.inspectionExpiry ?? "—",
      render: (row) => expiryCell(row.inspectionExpiry, row.inspectionDays),
    },
    {
      id: "odometer",
      header: activeLocaleHeader(d.assetsFleetColOdometer),
      accessor: (row) => row.odometerValue ?? "—",
      render: (row) =>
        row.odometerValue === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <span className="flex flex-col gap-0.5">
            {monoCell(row.odometerValue)}
            <span className="text-xs text-gray-600">{row.odometerUnit ?? ""}</span>
          </span>
        ),
    },
  ];

  // -- the readings log table (the workspace's own piece) ---------------------------------

  function readingsTable(readings: readonly AssetMeterReadingRow[]): JSX.Element {
    return (
      <div className="overflow-x-auto">
        <table aria-label={d.assetsMetersReadingsTitle} className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle">
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMetersColValue}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMetersColEffectiveDate}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMetersColSource}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMetersColWorkOrder}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMetersReadingNote}</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((reading) => (
              <tr key={reading.id} className="border-b border-subtle/60">
                <td className="px-2 py-1.5">{monoCell(reading.value)}</td>
                <td className="px-2 py-1.5">{monoCell(reading.effectiveDate)}</td>
                <td className="px-2 py-1.5">{localizedReadingSource(d, reading.source)}</td>
                <td className="px-2 py-1.5">
                  {reading.workOrderId === null ? (
                    <span className="text-xs text-gray-500">—</span>
                  ) : (
                    monoCell(shortId(reading.workOrderId), reading.workOrderId)
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-gray-600">
                  {localizedName(reading.note ?? "—", reading.noteAr, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // -- the render ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.assetsMetersTitle}>
        <Button
          variant={pane === "meters" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "meters"}
          onClick={() => setPane("meters")}
        >
          {d.assetsMetersPaneMeters}
        </Button>
        <Button
          variant={pane === "fleet" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "fleet"}
          onClick={() => setPane("fleet")}
        >
          {d.assetsMetersPaneFleet}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "meters" ? (
        <>
          <Card
            title={d.assetsMetersPaneMeters}
            description={d.assetsMetersSubtitle}
            actions={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                {d.assetsMetersCreate}
              </Button>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {d.assetsMetersColAsset}
                <select
                  className="rounded-md border border-default bg-surface-card px-3 py-2"
                  value={assetFilter}
                  onChange={(event) => {
                    setAssetFilter(event.target.value);
                  }}
                >
                  <option value="">{d.assetsMaintenanceAssetAll}</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {assetLabelById.get(asset.id) ?? asset.code}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="secondary" onClick={() => void loadMeters()}>
                {d.assetsMaintenanceRefresh}
              </Button>
            </div>
          </Card>

          {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {metersRefusal !== null ? (
            <TypedRefusalPanel
              error={metersRefusal}
              title={d.assetsMaintenanceRefusalTitle}
              detailsLabel={d.assetsMaintenanceRefusalDetails}
            />
          ) : null}

          {metersRefusal === null && meters !== null ? (
            meters.length === 0 ? (
              <p className="text-sm text-gray-600">{d.assetsMetersEmpty}</p>
            ) : (
              <DataTable columns={meterColumns} rows={[...meters]} rowKey={(row) => row.id} />
            )
          ) : null}

          {workspaceLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {workspace !== null ? (
            <Card title={localizedName(workspace.meter.name, workspace.meter.nameAr, locale)}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{localizedMeterType(d, workspace.meter.type)}</Badge>
                  {workspace.meter.isOdometer ? <Chip tone="success">{d.assetsMetersColOdometer}</Chip> : null}
                  <span className="text-sm text-gray-600">
                    {assetLabelById.get(workspace.meter.assetId) ?? shortId(workspace.meter.assetId)}
                  </span>
                  <span className="text-sm text-gray-600">
                    {d.assetsMetersColLastValue}: {monoCell(workspace.meter.lastValue)} {workspace.meter.unit}
                  </span>
                  {workspace.meter.lastReadingAt !== null ? (
                    <span className="text-sm text-gray-600">
                      {d.assetsMetersColLastReading}: {monoCell(workspace.meter.lastReadingAt)}
                    </span>
                  ) : null}
                </div>

                {workspace.meter.note !== null || workspace.meter.noteAr !== null ? (
                  <DefList
                    items={[
                      {
                        term: d.assetsMetersReadingNote,
                        children: localizedName(
                          workspace.meter.note ?? "—",
                          workspace.meter.noteAr,
                          locale,
                        ),
                      },
                    ]}
                  />
                ) : null}

                {/* THE ODOMETER DESIGNATION FLOWS — the R-10 law's own door */}
                <div className="flex flex-wrap gap-2">
                  {!workspace.meter.isOdometer && workspace.meter.type === "KM" ? (
                    <Button
                      variant="secondary"
                      loading={busy === "designate"}
                      onClick={() => void setOdometerDesignation(workspace.meter, true)}
                    >
                      {d.assetsMetersDesignate}
                    </Button>
                  ) : null}
                  {workspace.meter.isOdometer ? (
                    <Button
                      variant="secondary"
                      loading={busy === "designate"}
                      onClick={() => void setOdometerDesignation(workspace.meter, false)}
                    >
                      {d.assetsMetersUndesignate}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    onClick={() => {
                      setReadingDraft({ ...EMPTY_READING });
                      setRecordOpen(true);
                    }}
                  >
                    {d.assetsMetersRecord}
                  </Button>
                  <Button variant="ghost" onClick={() => setWorkspace(null)}>
                    {d.commonClear}
                  </Button>
                </div>

                {/* THE READINGS LOG — the engine's own rows, verbatim */}
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{d.assetsMetersReadingsTitle}</h3>
                  {workspace.readings.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.assetsMetersReadingsEmpty}</p>
                  ) : (
                    readingsTable(workspace.readings)
                  )}
                </div>

                {/* THE EVALUATION REPORT — the record act's own rows: the
                    generated orderNo or the NAMED skip (BR-097's vocabulary). */}
                {evaluations !== null ? (
                  <Card title={d.assetsMetersEvaluations}>
                    {evaluations.length === 0 ? (
                      <p className="text-sm text-gray-600">{d.assetsMaintenancePlansEmpty}</p>
                    ) : (
                      <ul className="flex flex-col gap-2 text-sm">
                        {evaluations.map((row, index) => (
                          <li
                            key={`${row.planId}:${index}`}
                            className="flex flex-col gap-1 rounded-md border border-subtle px-3 py-2"
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <Chip tone={row.generated ? "success" : "neutral"}>
                                {row.generated
                                  ? formatMessage(d.assetsMaintenanceEvaluationGenerated, {
                                      no: row.orderNo ?? "—",
                                    })
                                  : `${d.assetsMaintenanceEvaluationSkipped} ${localizedMaintenanceSkipReason(d, row.skipReason ?? "")}`}
                              </Chip>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ) : null}
              </div>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card
            title={d.assetsFleetTitle}
            actions={
              <Button variant="secondary" size="sm" onClick={() => void loadFleet()}>
                {d.assetsMaintenanceRefresh}
              </Button>
            }
          >
            <p className="text-sm text-gray-600">{d.assetsFleetSubtitle}</p>
          </Card>

          {fleetLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {fleetRefusal !== null ? (
            <TypedRefusalPanel
              error={fleetRefusal}
              title={d.assetsMaintenanceRefusalTitle}
              detailsLabel={d.assetsMaintenanceRefusalDetails}
            />
          ) : null}

          {fleetRefusal === null && fleet !== null ? (
            fleet.length === 0 ? (
              <p className="text-sm text-gray-600">{d.assetsFleetEmpty}</p>
            ) : (
              <DataTable columns={fleetColumns} rows={[...fleet]} rowKey={(row) => row.assetId} />
            )
          ) : null}
        </>
      )}

      {/* -- the create-meter dialog (the R-10 odometer checkbox is KM-only) -------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.assetsMetersCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.assetsMetersColAsset}
            value={meterDraft.assetId}
            onValueChange={(value) => setMeterDraft((prev) => ({ ...prev, assetId: value }))}
            placeholder="—"
            options={assets.map((asset) => ({
              value: asset.id,
              label: assetLabelById.get(asset.id) ?? asset.code,
            }))}
            required
          />
          <Select
            label={d.assetsMetersType}
            value={meterDraft.type}
            onValueChange={(value) =>
              setMeterDraft((prev) => ({
                ...prev,
                type: value as MeterType,
                // The R-10 law's own floor: a non-KM type cannot carry the
                // designation — the checkbox resets with the type.
                isOdometer: value === "KM" ? prev.isOdometer : false,
              }))
            }
            placeholder="HOURS"
            options={METER_TYPES.map((type) => ({
              value: type,
              label: localizedMeterType(d, type),
            }))}
          />
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMetersName}
              value={meterDraft.name}
              onValueChange={(value) => setMeterDraft((prev) => ({ ...prev, name: value }))}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMetersNameAr}
              value={meterDraft.nameAr}
              onValueChange={(value) => setMeterDraft((prev) => ({ ...prev, nameAr: value }))}
            />
          </div>
          <Input
            label={d.assetsMetersUnit}
            value={meterDraft.unit}
            onValueChange={(value) => setMeterDraft((prev) => ({ ...prev, unit: value }))}
            required
          />
          <div className="flex items-center pt-5">
            <Checkbox
              label={d.assetsMetersOdometer}
              checked={meterDraft.isOdometer}
              onCheckedChange={(checked) =>
                setMeterDraft((prev) => ({ ...prev, isOdometer: checked === true }))
              }
              disabled={meterDraft.type !== "KM"}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMetersReadingNote}
              value={meterDraft.note}
              onValueChange={(value) => setMeterDraft((prev) => ({ ...prev, note: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={`${d.assetsMetersReadingNote} (AR)`}
              value={meterDraft.noteAr}
              onValueChange={(value) => setMeterDraft((prev) => ({ ...prev, noteAr: value }))}
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
            onClick={() => void createMeter()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- the record-reading dialog (the JOB link law: source=JOB names its order) -- */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen} title={d.assetsMetersRecordTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.assetsMetersValue}
            value={readingDraft.value}
            onValueChange={(value) => setReadingDraft((prev) => ({ ...prev, value: value }))}
            inputMode="decimal"
            mono
            required
          />
          <Input
            label={d.assetsMetersEffectiveDate}
            value={readingDraft.effectiveDate}
            onValueChange={(value) => setReadingDraft((prev) => ({ ...prev, effectiveDate: value }))}
            mono
            bidiIsolate
            hint="YYYY-MM-DD"
            required
          />
          <Select
            label={d.assetsMetersSource}
            value={readingDraft.source}
            onValueChange={(value) =>
              setReadingDraft((prev) => ({
                ...prev,
                source: value as ReadingSource,
                workOrderId: value === "JOB" ? prev.workOrderId : "",
              }))
            }
            placeholder="MANUAL"
            options={READING_SOURCES.map((source) => ({
              value: source,
              label: localizedReadingSource(d, source),
            }))}
          />
          {readingDraft.source === "JOB" ? (
            <Select
              label={d.assetsMetersJobOrder}
              value={readingDraft.workOrderId}
              onValueChange={(value) => setReadingDraft((prev) => ({ ...prev, workOrderId: value }))}
              placeholder="—"
              options={workspace === null ? [] : workspace.jobOrders.map((order) => ({
                value: order.id,
                label: `${order.orderNo} · ${localizedName(order.problem, order.problemAr, locale)}`,
              }))}
              required
            />
          ) : null}
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMetersReadingNote}
              value={readingDraft.note}
              onValueChange={(value) => setReadingDraft((prev) => ({ ...prev, note: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={`${d.assetsMetersReadingNote} (AR)`}
              value={readingDraft.noteAr}
              onValueChange={(value) => setReadingDraft((prev) => ({ ...prev, noteAr: value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRecordOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "record"}
            disabled={!recordReady}
            onClick={() => void recordReading()}
          >
            {d.assetsMetersRecord}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
