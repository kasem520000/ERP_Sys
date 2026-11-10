"use client";

/**
 * PHASE-017 T6 (9-a) — the per-partner vehicle registry: the searchable
 * list (plate / chassis / make / model / partner), a create dialog (owner
 * partner, identity fields, VIN-shaped chassis with the client-side
 * pre-check of the backend pattern, odometer), an archive confirm, and
 * the per-vehicle service-history dialog (job cards + invoices + warranty
 * credit notes — the timeline read model). Mutations ride bffFetch with
 * typed localized errors (vehicle error codes → dictionary); decimals
 * stay strings end-to-end (ADR-0009). Layout is logical-property based
 * so the same tree renders RTL (ar) and LTR (en).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, SearchInput, Select, Textarea } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PartnerRow, VehicleHistoryEntry, VehicleRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  jobCardStatusLabel,
  localizedVehicleError,
  localizedName,
  salesStatusLabel,
  vehicleHistoryKindLabel,
  vehicleStatusLabel,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** The backend VIN shape pre-check (no I/O/Q, 6–17). */
const CHASSIS_RE = /^[A-HJ-NPR-Z0-9]{6,17}$/;
const YEAR_RE = /^\d{4}$/;
const ODOMETER_RE = /^\d{1,11}(\.\d)?$/;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function mono(text: string): JSX.Element {
  return (
    <span className="font-mono text-sm" dir="ltr">
      {text}
    </span>
  );
}

const DASH: JSX.Element = <span className="text-muted-foreground">—</span>;

export function Vehicles({
  locale,
  initialRows,
  partners,
}: {
  locale: Locale;
  initialRows: readonly VehicleRow[];
  partners: readonly PartnerRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly VehicleRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [modelYear, setModelYear] = useState("");
  const [chassisNo, setChassisNo] = useState("");
  const [plateNo, setPlateNo] = useState("");
  const [color, setColor] = useState("");
  const [engineNo, setEngineNo] = useState("");
  const [odometer, setOdometer] = useState("");
  const [note, setNote] = useState("");

  // Archive confirm + service-history dialogs.
  const [archiveTarget, setArchiveTarget] = useState<VehicleRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<VehicleRow | null>(null);
  const [history, setHistory] = useState<readonly VehicleHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const partnerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, localizedName(partner.name, partner.nameAr, locale));
    }
    return map;
  }, [partners, locale]);

  const livePartners = useMemo(
    () => partners.filter((p) => p.deletedAt === null),
    [partners],
  );

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((row) => {
      const haystack = [
        row.plateNo ?? "",
        row.chassisNo ?? "",
        row.make,
        row.model,
        partnerNameById.get(row.partnerId) ?? "",
      ];
      return haystack.some((value) => value.toLowerCase().includes(needle));
    });
  }, [rows, search, partnerNameById]);

  function vehicleLabel(row: VehicleRow): string {
    const bits = [`${row.make} ${row.model}`];
    if (row.modelYear !== null) bits.push(String(row.modelYear));
    if (row.plateNo !== null && row.plateNo !== "") bits.push(row.plateNo);
    return bits.join(" · ");
  }

  function openCreate(): void {
    setPartnerId("");
    setMake("");
    setModel("");
    setModelYear("");
    setChassisNo("");
    setPlateNo("");
    setColor("");
    setEngineNo("");
    setOdometer("");
    setNote("");
    setError(null);
    setNotice(null);
    setCreateOpen(true);
  }

  const chassisValue = chassisNo.trim().toUpperCase();
  const chassisValid = chassisValue === "" || CHASSIS_RE.test(chassisValue);
  const yearValue = modelYear.trim();
  const yearValid = yearValue === "" || (YEAR_RE.test(yearValue) && Number(yearValue) >= 1900 && Number(yearValue) <= 2100);
  const odometerValue = odometer.trim();
  const odometerValid = odometerValue === "" || ODOMETER_RE.test(odometerValue);

  const createReady =
    partnerId !== "" &&
    make.trim() !== "" &&
    model.trim() !== "" &&
    chassisValid &&
    yearValid &&
    odometerValid;

  async function createVehicle(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    setNotice(null);
    const noteValue = note.trim();
    const plateValue = plateNo.trim();
    const result = await bffFetch<VehicleRow>("partners/vehicles", {
      method: "POST",
      body: {
        partnerId,
        make: make.trim(),
        model: model.trim(),
        modelYear: yearValue === "" ? null : Number(yearValue),
        chassisNo: chassisValue === "" ? null : chassisValue,
        plateNo: plateValue === "" ? null : plateValue,
        color: color.trim() === "" ? null : color.trim(),
        engineNo: engineNo.trim() === "" ? null : engineNo.trim(),
        odometerKm: odometerValue === "" ? null : odometerValue,
        // AR-first: the typed field lands in the locale-matched column so
        // the registry reads it back in either language.
        note: locale === "ar" || noteValue === "" ? null : noteValue,
        noteAr: locale === "en" || noteValue === "" ? null : noteValue,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedVehicleError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setNotice(d.vehNoticeCreated);
  }

  async function archiveVehicle(): Promise<void> {
    if (archiveTarget === null) return;
    const id = archiveTarget.id;
    setBusy(`archive-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<VehicleRow>(`partners/vehicles/${id}/archive`, { method: "POST", body: {} });
    setBusy(null);
    if (!result.ok) {
      setError(localizedVehicleError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === id ? result.data : row)));
    setArchiveTarget(null);
    setNotice(d.vehNoticeArchived);
  }

  async function openHistory(row: VehicleRow): Promise<void> {
    setHistoryTarget(row);
    setHistory(null);
    setHistoryLoading(true);
    setError(null);
    const result = await bffFetch<readonly VehicleHistoryEntry[]>(`partners/vehicles/${row.id}/service-history`);
    setHistoryLoading(false);
    if (!result.ok) {
      setError(localizedVehicleError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setHistory(result.data);
  }

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.vehiclesTitle}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {d.vehNew}
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <SearchInput value={search} onValueChange={setSearch} placeholder={d.vehSearchPlaceholder} />
        </div>
        <DataTable
          columns={[
            {
              id: "partner",
              header: activeLocaleHeader(d.vehPartner),
              accessor: (row: VehicleRow) => partnerNameById.get(row.partnerId) ?? row.partnerId,
              render: (row: VehicleRow) =>
                partnerNameById.has(row.partnerId) ? (
                  partnerNameById.get(row.partnerId)
                ) : (
                  mono(shortId(row.partnerId))
                ),
            },
            {
              id: "make",
              header: activeLocaleHeader(d.vehMake),
              accessor: (row: VehicleRow) => row.make,
            },
            {
              id: "model",
              header: activeLocaleHeader(d.vehModel),
              accessor: (row: VehicleRow) => row.model,
            },
            {
              id: "modelYear",
              header: activeLocaleHeader(d.vehModelYear),
              accessor: (row: VehicleRow) => (row.modelYear === null ? "—" : String(row.modelYear)),
            },
            {
              id: "plateNo",
              header: activeLocaleHeader(d.vehPlate),
              accessor: (row: VehicleRow) => row.plateNo ?? "—",
              mono: true,
              render: (row: VehicleRow) => (row.plateNo !== null ? mono(row.plateNo) : DASH),
            },
            {
              id: "chassisNo",
              header: activeLocaleHeader(d.vehChassis),
              accessor: (row: VehicleRow) => row.chassisNo ?? "—",
              mono: true,
              render: (row: VehicleRow) => (row.chassisNo !== null ? mono(row.chassisNo) : DASH),
            },
            {
              id: "odometer",
              header: activeLocaleHeader(d.vehOdometer),
              accessor: (row: VehicleRow) => row.odometerKm ?? "—",
              render: (row: VehicleRow) => (row.odometerKm !== null ? mono(row.odometerKm) : DASH),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.salesStatus),
              accessor: (row: VehicleRow) => row.status,
              render: (row: VehicleRow) => (
                <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                  {vehicleStatusLabel(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...visibleRows]}
          rowKey={(row: VehicleRow) => row.id}
          rowActions={[
            {
              id: "history",
              label: d.vehHistory,
              onSelect: (row: VehicleRow) => {
                void openHistory(row);
              },
            },
            {
              id: "archive",
              label: d.vehArchive,
              danger: true,
              onSelect: (row: VehicleRow) => {
                if (row.status !== "ACTIVE") return;
                setError(null);
                setNotice(null);
                setArchiveTarget(row);
              },
            },
          ]}
          empty={{ title: d.vehiclesEmpty }}
        />
      </Card>

      {/* -- create dialog ------------------------------------------------------ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.vehNew} size="lg">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label={d.vehPartner}
            value={partnerId}
            onValueChange={setPartnerId}
            options={[
              { value: "", label: "—" },
              ...livePartners.map((p) => ({ value: p.id, label: partnerNameById.get(p.id) ?? p.code })),
            ]}
            required
          />
          <Input label={d.vehMake} value={make} onValueChange={setMake} required />
          <Input label={d.vehModel} value={model} onValueChange={setModel} required />
          <Input
            label={d.vehModelYear}
            value={modelYear}
            onValueChange={setModelYear}
            inputMode="numeric"
            error={modelYear !== "" && !yearValid ? d.errorsValidation : undefined}
          />
          <Input
            label={d.vehChassis}
            value={chassisNo}
            onValueChange={(value) => setChassisNo(value.toUpperCase())}
            mono
            bidiIsolate
            error={chassisNo !== "" && !chassisValid ? d.vehErrChassisInvalid : undefined}
            hint={d.vehErrChassisInvalid}
          />
          <Input label={d.vehPlate} value={plateNo} onValueChange={setPlateNo} mono bidiIsolate />
          <Input label={d.vehColor} value={color} onValueChange={setColor} />
          <Input label={d.vehEngineNo} value={engineNo} onValueChange={setEngineNo} mono bidiIsolate />
          <Input
            label={d.vehOdometer}
            value={odometer}
            onValueChange={setOdometer}
            inputMode="decimal"
            mono
            bidiIsolate
            error={odometer !== "" && !odometerValid ? d.errorsValidation : undefined}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Textarea label={d.vehNote} value={note} onValueChange={setNote} rows={2} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createVehicle()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- archive confirm dialog ---------------------------------------------- */}
      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title={`${d.vehArchive} · ${archiveTarget !== null ? vehicleLabel(archiveTarget) : ""}`}
        description={d.vehArchiveHint}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setArchiveTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy !== null && busy.startsWith("archive-")}
            onClick={() => void archiveVehicle()}
          >
            {d.vehArchive}
          </Button>
        </div>
      </Dialog>

      {/* -- service-history dialog ---------------------------------------------- */}
      <Dialog
        open={historyTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryTarget(null);
            setHistory(null);
          }
        }}
        title={`${d.vehHistory} · ${historyTarget !== null ? vehicleLabel(historyTarget) : ""}`}
        size="lg"
      >
        {historyLoading ? (
          <p className="text-sm text-muted-foreground">{d.loading}</p>
        ) : history === null ? null : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.vehHistoryEmpty}</p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pe-1">
            {history.map((entry) => (
              <li
                key={`${entry.kind}-${entry.id}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-subtle bg-surface-card px-3 py-2"
              >
                <Badge tone={entry.kind === "JOB_CARD" ? "primary" : "neutral"}>
                  {vehicleHistoryKindLabel(d, entry.kind)}
                </Badge>
                <span className="font-mono text-sm" dir="ltr">
                  {entry.docNo ?? shortId(entry.id)}
                </span>
                <span className="text-muted-foreground">{entry.date}</span>
                <span>
                  {entry.kind === "JOB_CARD"
                    ? jobCardStatusLabel(d, entry.status)
                    : salesStatusLabel(d, entry.status)}
                </span>
                {entry.total !== null ? (
                  <span className="font-mono text-sm" dir="ltr">
                    {entry.total}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
