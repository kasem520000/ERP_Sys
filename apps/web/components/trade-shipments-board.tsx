"use client";

/**
 * PHASE-051 (W-39 — T-14, D-17) — the shipments board (the /trade/shipments
 * screen body): the B/L register + the create act · the packing lists ·
 * THE CARRIER EVENT LOG (the append-only truth — the milestone POST runs
 * the fold on the linked B/L, the packing lists and the declaration; the
 * documents' shipment_status is NEVER writable here — D-14's own law) —
 * the 048/049/050 board patterns: the data-slot pane switch, the
 * typed-refusal panels with FULL payloads, the mono cells, every figure
 * an ENGINE OUTPUT rendered VERBATIM (the driven status rides the rows'
 * own strings — zero parallel computation).
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  Input,
  Select,
  useToast,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  TradeBlFindResult,
  TradeBlRow,
  TradePackingListRow,
  TradeTrackingEventRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedTradeError, tradeShipmentStatusLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KG_RE = /^\d+(\.\d{1,3})?$/;
const EVENT_AT_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const BL_DOC_TYPES = ["SEA", "AIR", "ROAD", "RAIL", "MULTIMODAL"] as const;
type BlDocType = (typeof BL_DOC_TYPES)[number];
const MILESTONES = ["BOOKED", "DEPARTED", "ARRIVED", "CLEARED", "DELIVERED"] as const;
type Milestone = (typeof MILESTONES)[number];

interface PackDraftLine {
  description: string;
  packages: string;
  grossKg: string;
  netKg: string;
}

const EMPTY_PACK_LINE: PackDraftLine = { description: "", packages: "", grossKg: "", netKg: "" };

function packLineValid(line: PackDraftLine): boolean {
  return (
    line.description.trim().length > 0 &&
    /^\d+$/.test(line.packages) &&
    Number(line.packages) > 0 &&
    KG_RE.test(line.grossKg) &&
    KG_RE.test(line.netKg) &&
    Number(line.grossKg) >= Number(line.netKg)
  );
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

function dashIfNull(value: string | null, title?: string): JSX.Element {
  if (value === null) {
    return <span className="text-xs text-gray-500">—</span>;
  }
  return monoCell(value, title);
}

type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};
function statusTone(status: string): ChipTone {
  switch (status) {
    case "DELIVERED":
      return "success";
    case "CLEARED":
      return "info";
    case "ARRIVED":
      return "warning";
    default:
      return "neutral";
  }
}
function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function TradeShipmentsBoard({
  locale,
  initialBls,
  blsError,
  initialPackingLists,
  packingListsError,
  initialEvents,
  eventsError,
  canManage,
}: {
  locale: Locale;
  initialBls: readonly TradeBlRow[] | null;
  blsError: ApiErrorBody | null;
  initialPackingLists: readonly TradePackingListRow[] | null;
  packingListsError: ApiErrorBody | null;
  initialEvents: readonly TradeTrackingEventRow[] | null;
  eventsError: ApiErrorBody | null;
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (bl · packing lists · events) --------------------------
  const [pane, setPane] = useState<"bl" | "packing" | "events">("bl");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the B/L register ----------------------------------------------------------
  const [bls, setBls] = useState<readonly TradeBlRow[] | null>(initialBls);
  const [blsRefusal, setBlsRefusal] = useState<ApiErrorBody | null>(blsError);
  const [blLoading, setBlLoading] = useState(false);

  // -- the B/L detail chain (the find's own output) --------------------------------
  const [blDetail, setBlDetail] = useState<TradeBlFindResult | null>(null);
  const [blDetailRefusal, setBlDetailRefusal] = useState<ApiErrorBody | null>(null);

  // -- the packing lists -----------------------------------------------------------
  const [packingLists, setPackingLists] = useState<readonly TradePackingListRow[] | null>(
    initialPackingLists,
  );
  const [packingListsRefusal, setPackingListsRefusal] = useState<ApiErrorBody | null>(
    packingListsError,
  );

  // -- the events log ------------------------------------------------------------------
  const [events, setEvents] = useState<readonly TradeTrackingEventRow[] | null>(initialEvents);
  const [eventsRefusal, setEventsRefusal] = useState<ApiErrorBody | null>(eventsError);

  // -- the B/L create form ----------------------------------------------------------------
  const [docType, setDocType] = useState<BlDocType>("SEA");
  const [carrierName, setCarrierName] = useState("");
  const [portOfLoading, setPortOfLoading] = useState("");
  const [portOfDischarge, setPortOfDischarge] = useState("");
  const [containerRefs, setContainerRefs] = useState("");
  const [blPurchaseOrderId, setBlPurchaseOrderId] = useState("");
  const [blDeliveryNoteId, setBlDeliveryNoteId] = useState("");

  // -- the packing list create form -----------------------------------------------------------
  const [plBillOfLadingId, setPlBillOfLadingId] = useState("");
  const [packLines, setPackLines] = useState<PackDraftLine[]>([{ ...EMPTY_PACK_LINE }]);

  // -- the event append form --------------------------------------------------------------------
  const [eventBl, setEventBl] = useState("");
  const [milestone, setMilestone] = useState<Milestone>("BOOKED");
  const [eventAt, setEventAt] = useState("");
  const [eventCarrierRef, setEventCarrierRef] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDeclarationId, setEventDeclarationId] = useState("");

  const blCreateReady =
    carrierName.trim().length > 0 &&
    containerRefs.split(",").filter((ref) => ref.trim() !== "").every((ref) => ref.trim().length >= 1) &&
    (blPurchaseOrderId.trim() === "" || UUID_RE.test(blPurchaseOrderId.trim())) &&
    (blDeliveryNoteId.trim() === "" || UUID_RE.test(blDeliveryNoteId.trim()));

  const plCreateReady =
    UUID_RE.test(plBillOfLadingId.trim()) && packLines.length > 0 && packLines.every(packLineValid);

  const eventAppendReady =
    UUID_RE.test(eventBl.trim()) && EVENT_AT_RE.test(eventAt.trim());

  // -- the loads ----------------------------------------------------------------------------------
  async function loadBls(): Promise<void> {
    setBlLoading(true);
    const result = await bffFetch<readonly TradeBlRow[]>("trade/transport/bl");
    setBlLoading(false);
    if (!result.ok) {
      setBlsRefusal(result.error);
      setBls(null);
      return;
    }
    setBlsRefusal(null);
    setBls(result.data);
  }

  async function openBl(id: string): Promise<void> {
    setBusy(`open-${id}`);
    setError(null);
    const result = await bffFetch<TradeBlFindResult>(`trade/transport/bl/${id}`);
    setBusy(null);
    if (!result.ok) {
      setBlDetailRefusal(result.error);
      setBlDetail(null);
      return;
    }
    setBlDetailRefusal(null);
    setBlDetail(result.data);
  }

  async function loadPackingLists(): Promise<void> {
    const result = await bffFetch<readonly TradePackingListRow[]>("trade/transport/packing-lists");
    if (!result.ok) {
      setPackingListsRefusal(result.error);
      setPackingLists(null);
      return;
    }
    setPackingListsRefusal(null);
    setPackingLists(result.data);
  }

  async function loadEvents(): Promise<void> {
    const result = await bffFetch<readonly TradeTrackingEventRow[]>("trade/shipments/events");
    if (!result.ok) {
      setEventsRefusal(result.error);
      setEvents(null);
      return;
    }
    setEventsRefusal(null);
    setEvents(result.data);
  }

  // -- the acts --------------------------------------------------------------------------------------
  async function createBl(): Promise<void> {
    if (!blCreateReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("bl");
    setError(null);
    const refs = containerRefs
      .split(",")
      .map((ref) => ref.trim())
      .filter((ref) => ref !== "");
    const result = await bffFetch<TradeBlRow>("trade/transport/bl", {
      method: "POST",
      body: {
        docType,
        carrierName,
        ...(portOfLoading.trim() !== "" ? { portOfLoading: portOfLoading.trim() } : {}),
        ...(portOfDischarge.trim() !== "" ? { portOfDischarge: portOfDischarge.trim() } : {}),
        ...(refs.length > 0 ? { containerRefs: refs } : {}),
        ...(blPurchaseOrderId.trim() !== "" ? { purchaseOrderId: blPurchaseOrderId.trim() } : {}),
        ...(blDeliveryNoteId.trim() !== "" ? { deliveryNoteId: blDeliveryNoteId.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeBlCreatedToast);
    toast({ tone: "success", title: d.tradeBlCreatedToast });
    await loadBls();
  }

  async function createPackingList(): Promise<void> {
    if (!plCreateReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("packing");
    setError(null);
    const result = await bffFetch<TradePackingListRow>("trade/transport/packing-lists", {
      method: "POST",
      body: {
        billOfLadingId: plBillOfLadingId.trim(),
        lines: packLines.map((line) => ({
          description: line.description,
          packages: Number(line.packages),
          grossKg: line.grossKg,
          netKg: line.netKg,
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradePlCreatedToast);
    toast({ tone: "success", title: d.tradePlCreatedToast });
    setPackLines([{ ...EMPTY_PACK_LINE }]);
    await loadPackingLists();
  }

  async function appendEvent(): Promise<void> {
    if (!eventAppendReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("event");
    setError(null);
    const result = await bffFetch<unknown>("trade/shipments/events", {
      method: "POST",
      body: {
        billOfLadingId: eventBl.trim(),
        milestone,
        eventAt: eventAt.trim(),
        ...(eventCarrierRef.trim() !== "" ? { carrierRef: eventCarrierRef.trim() } : {}),
        ...(eventLocation.trim() !== "" ? { location: eventLocation.trim() } : {}),
        ...(eventDeclarationId.trim() !== "" ? { declarationId: eventDeclarationId.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTradeError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.tradeEventAppendedToast);
    toast({ tone: "success", title: d.tradeEventAppendedToast });
    await loadEvents();
    await loadBls();
  }

  // -- the tables -----------------------------------------------------------------------------------------
  const blColumns: DataTableColumn<TradeBlRow>[] = [
    {
      id: "blNo",
      header: activeLocaleHeader(d.tradeBlColNo),
      accessor: (row) => row.blNo,
      render: (row) => monoCell(row.blNo),
    },
    {
      id: "docType",
      header: activeLocaleHeader(d.tradeBlColType),
      accessor: (row) => row.docType,
    },
    {
      id: "carrier",
      header: activeLocaleHeader(d.tradeBlColCarrier),
      accessor: (row) => row.carrierName,
    },
    {
      id: "loading",
      header: activeLocaleHeader(d.tradeBlColLoading),
      accessor: (row) => row.portOfLoading ?? "—",
      render: (row) => dashIfNull(row.portOfLoading),
    },
    {
      id: "discharge",
      header: activeLocaleHeader(d.tradeBlColDischarge),
      accessor: (row) => row.portOfDischarge ?? "—",
      render: (row) => dashIfNull(row.portOfDischarge),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.tradeBlColStatus),
      accessor: (row) => row.shipmentStatus,
      render: (row) => (
        <Chip tone={statusTone(row.shipmentStatus)}>
          {tradeShipmentStatusLabel(d, row.shipmentStatus)}
        </Chip>
      ),
    },
  ];

  const plColumns: DataTableColumn<TradePackingListRow>[] = [
    {
      id: "plNo",
      header: activeLocaleHeader(d.tradePlColNo),
      accessor: (row) => row.plNo,
      render: (row) => monoCell(row.plNo),
    },
    {
      id: "bl",
      header: activeLocaleHeader(d.tradePlColBl),
      accessor: (row) => row.billOfLadingId ?? "—",
      render: (row) =>
        row.billOfLadingId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(row.billOfLadingId.slice(0, 8), row.billOfLadingId)
        ),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.tradePlColStatus),
      accessor: (row) => row.shipmentStatus,
      render: (row) => (
        <Chip tone={statusTone(row.shipmentStatus)}>
          {tradeShipmentStatusLabel(d, row.shipmentStatus)}
        </Chip>
      ),
    },
    {
      id: "lines",
      header: activeLocaleHeader(d.tradePlColLines),
      accessor: (row) => String(row.lines.length),
      numeric: true,
      render: (row) => monoCell(String(row.lines.length)),
    },
  ];

  const eventColumns: DataTableColumn<TradeTrackingEventRow>[] = [
    {
      id: "milestone",
      header: activeLocaleHeader(d.tradeEventColMilestone),
      accessor: (row) => row.milestone,
      render: (row) => <Chip tone={statusTone(row.milestone)}>{tradeShipmentStatusLabel(d, row.milestone)}</Chip>,
    },
    {
      id: "at",
      header: activeLocaleHeader(d.tradeEventColAt),
      accessor: (row) => row.eventAt,
      render: (row) => monoCell(row.eventAt),
    },
    {
      id: "bl",
      header: activeLocaleHeader(d.tradeEventColBl),
      accessor: (row) => row.billOfLadingId.slice(0, 8),
      render: (row) => monoCell(row.billOfLadingId.slice(0, 8), row.billOfLadingId),
    },
    {
      id: "carrierRef",
      header: activeLocaleHeader(d.tradeEventColCarrierRef),
      accessor: (row) => row.carrierRef ?? "—",
      render: (row) => dashIfNull(row.carrierRef),
    },
    {
      id: "location",
      header: activeLocaleHeader(d.tradeEventColLocation),
      accessor: (row) => row.location ?? "—",
      render: (row) => dashIfNull(row.location),
    },
  ];

  // -- the render -------------------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.tradeShipmentsTitle}>
        <Button
          variant={pane === "bl" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "bl"}
          onClick={() => setPane("bl")}
        >
          {d.tradeShipmentsPaneBl}
        </Button>
        <Button
          variant={pane === "packing" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "packing"}
          onClick={() => setPane("packing")}
        >
          {d.tradeShipmentsPanePl}
        </Button>
        <Button
          variant={pane === "events" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "events"}
          onClick={() => setPane("events")}
        >
          {d.tradeShipmentsPaneEvents}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "bl" ? (
        <>
          <Card
            title={d.tradeShipmentsTitle}
            description={d.tradeShipmentsSubtitle}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={blLoading}
                onClick={() => void loadBls()}
              >
                {d.tradeRefresh}
              </Button>
            }
          >
            <p className="text-sm text-gray-600">{d.tradeShipmentsSubtitle}</p>
          </Card>

          {canManage ? (
            <Card title={d.tradeBlCreateTitle}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label={d.tradeBlCreateType}
                  value={docType}
                  onValueChange={(value) => setDocType(value as BlDocType)}
                  options={BL_DOC_TYPES.map((type) => ({
                    value: type,
                    label:
                      type === "SEA"
                        ? d.tradeBlDocTypeSea
                        : type === "AIR"
                          ? d.tradeBlDocTypeAir
                          : type === "ROAD"
                            ? d.tradeBlDocTypeRoad
                            : type === "RAIL"
                              ? d.tradeBlDocTypeRail
                              : d.tradeBlDocTypeMultimodal,
                  }))}
                />
                <Input label={d.tradeBlCreateCarrier} value={carrierName} onValueChange={setCarrierName} required />
                <Input label={d.tradeBlCreateLoading} value={portOfLoading} onValueChange={setPortOfLoading} />
                <Input label={d.tradeBlCreateDischarge} value={portOfDischarge} onValueChange={setPortOfDischarge} />
                <Input label={d.tradeBlCreateContainers} value={containerRefs} onValueChange={setContainerRefs} mono bidiIsolate />
                <Input label={d.tradeBlCreatePo} value={blPurchaseOrderId} onValueChange={setBlPurchaseOrderId} mono bidiIsolate />
                <Input label={d.tradeBlCreateDn} value={blDeliveryNoteId} onValueChange={setBlDeliveryNoteId} mono bidiIsolate />
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  loading={busy === "bl"}
                  disabled={!blCreateReady}
                  onClick={() => void createBl()}
                >
                  {d.tradePaneCreate}
                </Button>
              </div>
            </Card>
          ) : null}

          {blsRefusal !== null ? (
            <TypedRefusalPanel
              error={blsRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}

          {blsRefusal === null && bls !== null ? (
            bls.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={blColumns}
                rows={[...bls]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "open",
                    label: d.commonOpen,
                    onSelect: (row: TradeBlRow) => void openBl(row.id),
                  },
                ]}
              />
            )
          ) : null}

          {/* the B/L detail chain (the find's own output: the B/L + its packing lists + its events) */}
          {blDetailRefusal !== null ? (
            <TypedRefusalPanel
              error={blDetailRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}
          {blDetail !== null ? (
            <Card
              title={`${blDetail.bl.blNo} · ${tradeShipmentStatusLabel(d, blDetail.bl.shipmentStatus)}`}
              description={d.tradePaneDetail}
            >
              <p className="text-sm text-gray-600">
                {blDetail.bl.carrierName}
                {blDetail.bl.portOfLoading !== null ? ` · ${blDetail.bl.portOfLoading}` : ""}
                {blDetail.bl.portOfDischarge !== null ? ` → ${blDetail.bl.portOfDischarge}` : ""}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {d.tradeShipmentsPanePl}: {blDetail.packingLists.length} · {d.tradeShipmentsPaneEvents}:{" "}
                {blDetail.events.length}
              </p>
            </Card>
          ) : null}
        </>
      ) : null}

      {pane === "packing" ? (
        <>
          {canManage ? (
            <Card title={d.tradePlCreateTitle}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={d.tradePlCreateBl} value={plBillOfLadingId} onValueChange={setPlBillOfLadingId} mono bidiIsolate required />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {packLines.map((line, index) => (
                  <div key={index} className="grid gap-2 rounded-md border border-subtle p-3 sm:grid-cols-4">
                    <Input
                      label={d.tradePlLineDesc}
                      value={line.description}
                      onValueChange={(value) =>
                        setPackLines((prev) => prev.map((l, i) => (i === index ? { ...l, description: value } : l)))
                      }
                      required
                    />
                    <Input
                      label={d.tradePlLinePackages}
                      value={line.packages}
                      onValueChange={(value) =>
                        setPackLines((prev) => prev.map((l, i) => (i === index ? { ...l, packages: value } : l)))
                      }
                      inputMode="numeric"
                      mono
                      required
                    />
                    <Input
                      label={d.tradePlLineGross}
                      value={line.grossKg}
                      onValueChange={(value) =>
                        setPackLines((prev) => prev.map((l, i) => (i === index ? { ...l, grossKg: value } : l)))
                      }
                      inputMode="decimal"
                      mono
                      required
                    />
                    <Input
                      label={d.tradePlLineNet}
                      value={line.netKg}
                      onValueChange={(value) =>
                        setPackLines((prev) => prev.map((l, i) => (i === index ? { ...l, netKg: value } : l)))
                      }
                      inputMode="decimal"
                      mono
                      required
                    />
                    {packLines.length > 1 ? (
                      <div className="flex items-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setPackLines((prev) => prev.filter((_, i) => i !== index))}
                        >
                          {d.purchasingRemoveLine}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPackLines((prev) => [...prev, { ...EMPTY_PACK_LINE }])}
                  >
                    {d.tradePlAddLine}
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  loading={busy === "packing"}
                  disabled={!plCreateReady}
                  onClick={() => void createPackingList()}
                >
                  {d.tradePaneCreate}
                </Button>
              </div>
            </Card>
          ) : null}

          {packingListsRefusal !== null ? (
            <TypedRefusalPanel
              error={packingListsRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}

          {packingListsRefusal === null && packingLists !== null ? (
            packingLists.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={plColumns}
                rows={[...packingLists]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}
        </>
      ) : null}

      {pane === "events" ? (
        <>
          <Card title={d.tradeEventsTitle}>
            <p className="text-sm text-gray-600">{d.tradeShipmentsSubtitle}</p>
          </Card>

          {canManage ? (
            <Card title={d.tradeEventAppendTitle}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={d.tradeEventAppendBl} value={eventBl} onValueChange={setEventBl} mono bidiIsolate required />
                <Select
                  label={d.tradeEventAppendMilestone}
                  value={milestone}
                  onValueChange={(value) => setMilestone(value as Milestone)}
                  options={MILESTONES.map((value) => ({
                    value,
                    label: tradeShipmentStatusLabel(d, value),
                  }))}
                />
                <Input label={d.tradeEventAppendAt} value={eventAt} onValueChange={setEventAt} mono bidiIsolate required />
                <Input label={d.tradeEventAppendCarrierRef} value={eventCarrierRef} onValueChange={setEventCarrierRef} mono bidiIsolate />
                <Input label={d.tradeEventAppendLocation} value={eventLocation} onValueChange={setEventLocation} />
                <Input label={d.tradeEventAppendDeclaration} value={eventDeclarationId} onValueChange={setEventDeclarationId} mono bidiIsolate />
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  loading={busy === "event"}
                  disabled={!eventAppendReady}
                  onClick={() => void appendEvent()}
                >
                  {d.tradeEventAppendTitle}
                </Button>
              </div>
            </Card>
          ) : null}

          {eventsRefusal !== null ? (
            <TypedRefusalPanel
              error={eventsRefusal}
              title={d.tradeRefusalTitle}
              detailsLabel={d.tradeRefusalDetails}
            />
          ) : null}

          {eventsRefusal === null && events !== null ? (
            events.length === 0 ? (
              <p className="text-sm text-gray-600">{d.tradeEmpty}</p>
            ) : (
              <DataTable
                columns={eventColumns}
                rows={[...events]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
