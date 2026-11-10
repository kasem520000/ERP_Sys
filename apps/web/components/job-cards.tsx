"use client";

/**
 * PHASE-017 T6 (9-a) — the workshop job-card workspace: the card list
 * (status chips + search) with a check-in create dialog (customer, the
 * customer's vehicle, warehouse, parts-issue policy, complaints, mixed
 * PARTS/STOCK + LABOR/SERVICE lines), plus the selected card's detail
 * workspace — header info, the live lines table with per-line labor
 * hour-logging, and the lifecycle action bar gated by status:
 * quotation + approve + cancel (DRAFT), complete + cancel (IN_PROGRESS),
 * invoice (COMPLETED). Mutations ride bffFetch with typed localized
 * errors (job-card error codes → dictionary); money/qty/hours stay
 * decimal strings end-to-end (ADR-0009). Layout is logical-property
 * based so the same tree renders RTL (ar) and LTR (en).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, SearchInput, Select, Textarea } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiResult,
  BranchRow,
  ItemRow,
  JobCardRow,
  JobCardWithLines,
  PartnerRow,
  QuotationRow,
  TaxCodeRow,
  VehicleRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  jobCardStatusLabel,
  localizedJobCardError,
  localizedName,
} from "../lib/messages";
import { Card } from "./card";
import { DefList, type DefItem } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const QTY_RE = /^\d+(\.\d{1,6})?$/; // qty / hours / prices (≤ 6dp)
const MONEY_RE = /^\d+(\.\d{1,4})?$/; // discounts (≤ 4dp)
const ODOMETER_RE = /^\d{1,11}(\.\d)?$/; // odometer (≤ 1dp)

interface DraftLine {
  lineType: "PARTS" | "LABOR";
  itemId: string;
  qty: string;
  /** PARTS: per-unit price. LABOR: per-hour rate. */
  unitPrice: string;
  /** LABOR only — the billed quantity (required > 0). */
  estimatedHours: string;
  discount: string;
  taxCodeId: string;
}

const EMPTY_LINE: DraftLine = {
  lineType: "PARTS",
  itemId: "",
  qty: "",
  unitPrice: "",
  estimatedHours: "",
  discount: "",
  taxCodeId: "",
};

function lineValid(line: DraftLine): boolean {
  if (line.itemId === "" || !QTY_RE.test(line.qty)) return false;
  if (line.unitPrice !== "" && !QTY_RE.test(line.unitPrice)) return false;
  if (line.discount !== "" && !MONEY_RE.test(line.discount)) return false;
  if (line.lineType === "LABOR") {
    return QTY_RE.test(line.estimatedHours) && Number(line.estimatedHours) > 0;
  }
  return true;
}

/** Bilingual nullable text with locale-first fallback (complaints/diagnosis/note). */
function localizedText(value: string | null, valueAr: string | null, locale: Locale): string | null {
  const primary = locale === "ar" ? valueAr : value;
  const fallback = locale === "ar" ? value : valueAr;
  const text = primary ?? fallback;
  return text !== null && text.trim() !== "" ? text : null;
}

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

export function JobCards({
  locale,
  initialCards,
  customers,
  items,
  branches,
  warehouses,
  taxCodes,
}: {
  locale: Locale;
  initialCards: readonly JobCardRow[];
  customers: readonly PartnerRow[];
  items: readonly ItemRow[];
  branches: readonly BranchRow[];
  warehouses: readonly WarehouseRow[];
  taxCodes: readonly TaxCodeRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [cards, setCards] = useState<readonly JobCardRow[]>(initialCards);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // List controls.
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [partsIssueMode, setPartsIssueMode] = useState<"reserve" | "issue_immediate">("reserve");
  const [odometer, setOdometer] = useState("");
  const [complaints, setComplaints] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [customerVehicles, setCustomerVehicles] = useState<readonly VehicleRow[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);

  // Detail workspace.
  const [selected, setSelected] = useState<JobCardWithLines | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  // Inline prompts: cancel-with-reason + log-hours.
  const [cancelTarget, setCancelTarget] = useState<JobCardRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [hoursTarget, setHoursTarget] = useState<JobCardRow | null>(null);
  const [hoursLineId, setHoursLineId] = useState("");
  const [hoursValue, setHoursValue] = useState("");

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      map.set(customer.id, localizedName(customer.name, customer.nameAr, locale));
    }
    return map;
  }, [customers, locale]);

  const customersOnly = useMemo(
    () => customers.filter((p) => (p.kind === "CUSTOMER" || p.kind === "BOTH") && p.deletedAt === null),
    [customers],
  );
  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);
  const activeWarehouses = useMemo(() => warehouses.filter((w) => w.isActive), [warehouses]);
  const stockItems = useMemo(
    () => items.filter((item) => item.kind === "STOCK" && item.status === "ACTIVE" && item.deletedAt === null),
    [items],
  );
  const serviceItems = useMemo(
    () => items.filter((item) => item.kind === "SERVICE" && item.status === "ACTIVE" && item.deletedAt === null),
    [items],
  );
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const visibleCards = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cards.filter((row) => {
      if (statusFilter !== "" && row.status !== statusFilter) return false;
      if (needle === "") return true;
      const cardNo = (row.cardNo ?? "").toLowerCase();
      const customer = (customerNameById.get(row.customerId) ?? "").toLowerCase();
      return cardNo.includes(needle) || customer.includes(needle);
    });
  }, [cards, statusFilter, search, customerNameById]);

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

  function vehicleLabel(vehicle: VehicleRow): string {
    const bits = [`${vehicle.make} ${vehicle.model}`];
    if (vehicle.modelYear !== null) bits.push(String(vehicle.modelYear));
    if (vehicle.plateNo !== null && vehicle.plateNo !== "") bits.push(vehicle.plateNo);
    return bits.join(" · ");
  }

  function itemOptionsFor(lineType: "PARTS" | "LABOR") {
    const pool = lineType === "PARTS" ? stockItems : serviceItems;
    return [
      { value: "", label: "—" },
      ...pool.map((item) => ({
        value: item.id,
        label: `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`,
      })),
    ];
  }

  function updateLine(index: number, patch: Partial<DraftLine>): void {
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function openCreate(): void {
    setBranchId("");
    setCustomerId("");
    setVehicleId("");
    setWarehouseId("");
    setPartsIssueMode("reserve");
    setOdometer("");
    setComplaints("");
    setNote("");
    setLines([{ ...EMPTY_LINE }]);
    setCustomerVehicles([]);
    setVehiclesLoading(false);
    setError(null);
    setNotice(null);
    setCreateOpen(true);
  }

  /** Fetches the selected customer's ACTIVE vehicles for the optional select. */
  async function loadCustomerVehicles(partnerId: string): Promise<void> {
    setCustomerVehicles([]);
    if (partnerId === "") {
      setVehiclesLoading(false);
      return;
    }
    setVehiclesLoading(true);
    const result = await bffFetch<readonly VehicleRow[]>(`partners/vehicles?partnerId=${partnerId}&status=ACTIVE`);
    setVehiclesLoading(false);
    // A 403 here (no partners.vehicles.manage) leaves the optional select
    // empty — a card can be opened without a vehicle.
    if (result.ok) {
      setCustomerVehicles(result.data);
    }
  }

  const createReady =
    branchId !== "" &&
    customerId !== "" &&
    warehouseId !== "" &&
    (odometer.trim() === "" || ODOMETER_RE.test(odometer.trim())) &&
    lines.length > 0 &&
    lines.every(lineValid);

  async function createCard(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    setNotice(null);
    const complaintsValue = complaints.trim();
    const noteValue = note.trim();
    const odometerValue = odometer.trim();
    const result = await bffFetch<JobCardRow>("sales/job-cards", {
      method: "POST",
      body: {
        branchId,
        customerId,
        vehicleId: vehicleId === "" ? null : vehicleId,
        warehouseId,
        partsIssueMode,
        // AR-first: the typed field lands in the locale-matched column so
        // the detail view reads it back in either language.
        complaints: locale === "ar" || complaintsValue === "" ? null : complaintsValue,
        complaintsAr: locale === "en" || complaintsValue === "" ? null : complaintsValue,
        odometerKm: odometerValue === "" ? null : odometerValue,
        checkedInAt: new Date().toISOString(),
        note: locale === "ar" || noteValue === "" ? null : noteValue,
        noteAr: locale === "en" || noteValue === "" ? null : noteValue,
        lines: lines.map((l) => ({
          lineType: l.lineType,
          itemId: l.itemId,
          qty: l.qty,
          unitPrice: l.unitPrice === "" ? null : l.unitPrice,
          estimatedHours: l.lineType === "LABOR" ? l.estimatedHours : null,
          discountAmount: l.discount === "" ? null : l.discount,
          taxCodeId: l.taxCodeId === "" ? null : l.taxCodeId,
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedJobCardError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCards((rows) => [result.data, ...rows]);
    setCreateOpen(false);
    setNotice(formatMessage(d.jcNoticeCreated, { no: result.data.cardNo ?? shortId(result.data.id) }));
    await openCard(result.data);
  }

  /** Loads the detail workspace: the card with lines + its vehicle (if any). */
  async function openCard(row: JobCardRow): Promise<void> {
    setSelected(null);
    setSelectedVehicle(null);
    setDetailBusy(true);
    setError(null);
    setNotice(null);
    const vehiclePromise: Promise<ApiResult<VehicleRow> | null> =
      row.vehicleId !== null ? bffFetch<VehicleRow>(`partners/vehicles/${row.vehicleId}`) : Promise.resolve(null);
    const [cardResult, vehicleResult] = await Promise.all([
      bffFetch<JobCardWithLines>(`sales/job-cards/${row.id}`),
      vehiclePromise,
    ]);
    setDetailBusy(false);
    if (!cardResult.ok) {
      setError(localizedJobCardError(d, cardResult.error, cardResult.retryAfterSeconds));
      return;
    }
    setSelected(cardResult.data);
    // The vehicle read rides partners.vehicles.manage — a failure there
    // falls back to the short id (state honesty, never a silent blank).
    setSelectedVehicle(vehicleResult !== null && vehicleResult.ok ? vehicleResult.data : null);
  }

  function closeCard(): void {
    setSelected(null);
    setSelectedVehicle(null);
    setDetailBusy(false);
  }

  /** Refetches the card (with lines) and replaces the list row in place. */
  async function refreshCard(id: string): Promise<void> {
    const result = await bffFetch<JobCardWithLines>(`sales/job-cards/${id}`);
    if (!result.ok) {
      setError(localizedJobCardError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setSelected(result.data);
    setCards((rows) => rows.map((row) => (row.id === id ? result.data : row)));
  }

  async function lifecycle(id: string, action: "quotation" | "approve" | "complete" | "invoice"): Promise<void> {
    setBusy(`${action}-${id}`);
    setError(null);
    setNotice(null);
    if (action === "quotation") {
      // BR-006: the diagnosis quotation answers with a quotation row.
      const result = await bffFetch<QuotationRow>(`sales/job-cards/${id}/quotation`, { method: "POST", body: {} });
      setBusy(null);
      if (!result.ok) {
        setError(localizedJobCardError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setNotice(formatMessage(d.jcNoticeQuotation, { no: result.data.quoteNo ?? shortId(result.data.id) }));
    } else {
      const result = await bffFetch<JobCardRow>(`sales/job-cards/${id}/${action}`, { method: "POST", body: {} });
      setBusy(null);
      if (!result.ok) {
        setError(localizedJobCardError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setNotice(d.jcNoticeUpdated);
    }
    await refreshCard(id);
  }

  async function confirmCancel(): Promise<void> {
    if (cancelTarget === null || cancelReason.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    const id = cancelTarget.id;
    setBusy(`cancel-${id}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<JobCardRow>(`sales/job-cards/${id}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedJobCardError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCancelTarget(null);
    setCancelReason("");
    setNotice(d.jcNoticeUpdated);
    await refreshCard(id);
  }

  async function confirmLogHours(): Promise<void> {
    if (hoursTarget === null || hoursLineId === "" || !QTY_RE.test(hoursValue) || Number(hoursValue) <= 0) {
      setError(d.errorsValidation);
      return;
    }
    const cardId = hoursTarget.id;
    setBusy(`hours-${cardId}`);
    setError(null);
    setNotice(null);
    const result = await bffFetch<JobCardRow>(`sales/job-cards/${cardId}/lines/${hoursLineId}/log-hours`, {
      method: "POST",
      body: { hours: hoursValue },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedJobCardError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setHoursTarget(null);
    setHoursLineId("");
    setHoursValue("");
    setNotice(d.jcNoticeHoursLogged);
    await refreshCard(cardId);
  }

  const chip = (value: string, label: string): JSX.Element => (
    <Button
      key={value === "" ? "all" : value}
      variant={statusFilter === value ? "primary" : "secondary"}
      onClick={() => setStatusFilter(value)}
    >
      {label}
    </Button>
  );

  const detailItems: DefItem[] = [];
  if (selected !== null) {
    const card = selected;
    detailItems.push({
      term: d.jcCustomer,
      children:
        customerNameById.get(card.customerId) ?? mono(shortId(card.customerId)),
    });
    detailItems.push({
      term: d.jcVehicle,
      children:
        selectedVehicle !== null
          ? vehicleLabel(selectedVehicle)
          : card.vehicleId !== null
            ? mono(shortId(card.vehicleId))
            : DASH,
    });
    detailItems.push({ term: d.jcBranch, children: branchById.get(card.branchId) ?? DASH });
    detailItems.push({ term: d.jcWarehouse, children: warehouseById.get(card.warehouseId) ?? DASH });
    detailItems.push({
      term: d.jcPartsIssueMode,
      children: card.partsIssueMode === "issue_immediate" ? d.jcModeIssueImmediate : d.jcModeReserve,
    });
    detailItems.push({ term: d.jcOdometer, children: card.odometerKm !== null ? mono(card.odometerKm) : DASH });
    detailItems.push({ term: d.jcLaborHoursTotal, children: mono(card.laborHoursTotal) });
    const complaintsText = localizedText(card.complaints, card.complaintsAr, locale);
    if (complaintsText !== null) {
      detailItems.push({ term: d.jcComplaints, children: complaintsText });
    }
    const diagnosisText = localizedText(card.diagnosis, card.diagnosisAr, locale);
    if (diagnosisText !== null) {
      detailItems.push({ term: d.jcDiagnosis, children: diagnosisText });
    }
    const noteText = localizedText(card.note, card.noteAr, locale);
    if (noteText !== null) {
      detailItems.push({ term: d.jcNote, children: noteText });
    }
    detailItems.push({
      term: d.jcCreated,
      children: (
        <span>
          {mono(card.cardNo ?? shortId(card.id))}
          {" · "}
          {formatDateTime(card.checkedInAt ?? card.createdAt, locale)}
        </span>
      ),
    });
  }

  const lineRowActions =
    selected !== null && (selected.status === "IN_PROGRESS" || selected.status === "COMPLETED")
      ? [
          {
            id: "logHours",
            label: d.jcLogHours,
            onSelect: (line: JobCardWithLines["lines"][number]) => {
              if (line.lineType !== "LABOR" || line.status === "CANCELLED") return;
              setHoursValue("");
              setHoursLineId(line.id);
              setHoursTarget(selected);
            },
          },
        ]
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.jobCardsTitle}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {d.jobCardsNew}
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {chip("", d.jcFilterAll)}
          {chip("DRAFT", d.jcStatusDraft)}
          {chip("IN_PROGRESS", d.jcStatusInProgress)}
          {chip("COMPLETED", d.jcStatusCompleted)}
          {chip("INVOICED", d.jcStatusInvoiced)}
          {chip("CANCELLED", d.jcStatusCancelled)}
          <div className="grow" aria-hidden="true" />
          <SearchInput value={search} onValueChange={setSearch} placeholder={d.jcSearchPlaceholder} />
        </div>
        <DataTable
          columns={[
            {
              id: "cardNo",
              header: activeLocaleHeader(d.jcCardNo),
              accessor: (row: JobCardRow) => row.cardNo ?? shortId(row.id),
              mono: true,
              sortable: true,
              render: (row: JobCardRow) => mono(row.cardNo ?? shortId(row.id)),
            },
            {
              id: "customer",
              header: activeLocaleHeader(d.jcCustomer),
              accessor: (row: JobCardRow) => customerNameById.get(row.customerId) ?? row.customerId,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.salesStatus),
              accessor: (row: JobCardRow) => row.status,
              render: (row: JobCardRow) => (
                <Badge tone={row.status === "INVOICED" || row.status === "CANCELLED" ? "neutral" : "primary"}>
                  {jobCardStatusLabel(d, row.status)}
                </Badge>
              ),
            },
            {
              id: "hours",
              header: activeLocaleHeader(d.jcLaborHoursTotal),
              accessor: (row: JobCardRow) => row.laborHoursTotal,
              render: (row: JobCardRow) => mono(row.laborHoursTotal),
            },
            {
              id: "created",
              header: activeLocaleHeader(d.jcCreated),
              accessor: (row: JobCardRow) => row.createdAt,
              sortable: true,
              render: (row: JobCardRow) => formatDateTime(row.createdAt, locale),
            },
          ]}
          rows={[...visibleCards]}
          rowKey={(row: JobCardRow) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row: JobCardRow) => {
                void openCard(row);
              },
            },
          ]}
          empty={{ title: d.jobCardsEmpty }}
        />
      </Card>

      {detailBusy && selected === null && (
        <Card title={d.jobCardsTitle}>
          <p className="text-sm text-muted-foreground">{d.loading}</p>
        </Card>
      )}

      {selected !== null && (
        <Card
          title={`${d.jcCardNo}: ${selected.cardNo ?? shortId(selected.id)}`}
          actions={
            <Button variant="ghost" onClick={closeCard}>
              {d.jcClose}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selected.status === "INVOICED" || selected.status === "CANCELLED" ? "neutral" : "primary"}>
                {jobCardStatusLabel(d, selected.status)}
              </Badge>
              <div className="grow" aria-hidden="true" />
              {selected.status === "DRAFT" && (
                <>
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    loading={busy === `quotation-${selected.id}`}
                    onClick={() => void lifecycle(selected.id, "quotation")}
                  >
                    {d.jcActionQuotation}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy !== null}
                    loading={busy === `approve-${selected.id}`}
                    onClick={() => void lifecycle(selected.id, "approve")}
                  >
                    {d.jcActionApprove}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy !== null}
                    onClick={() => {
                      setCancelReason("");
                      setCancelTarget(selected);
                    }}
                  >
                    {d.jcActionCancel}
                  </Button>
                </>
              )}
              {selected.status === "IN_PROGRESS" && (
                <>
                  <Button
                    variant="primary"
                    disabled={busy !== null}
                    loading={busy === `complete-${selected.id}`}
                    onClick={() => void lifecycle(selected.id, "complete")}
                  >
                    {d.jcActionComplete}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy !== null}
                    onClick={() => {
                      setCancelReason("");
                      setCancelTarget(selected);
                    }}
                  >
                    {d.jcActionCancel}
                  </Button>
                </>
              )}
              {selected.status === "COMPLETED" && (
                <Button
                  variant="primary"
                  disabled={busy !== null}
                  loading={busy === `invoice-${selected.id}`}
                  onClick={() => void lifecycle(selected.id, "invoice")}
                >
                  {d.jcActionInvoice}
                </Button>
              )}
            </div>

            <DefList items={detailItems} />

            <DataTable
              columns={[
                {
                  id: "lineType",
                  header: activeLocaleHeader(d.kindLabel),
                  accessor: (line) => line.lineType,
                  render: (line) =>
                    line.lineType === "LABOR" ? (
                      <Badge tone="primary">{d.jcLineLabor}</Badge>
                    ) : (
                      <Badge>{d.jcLineParts}</Badge>
                    ),
                },
                {
                  id: "item",
                  header: activeLocaleHeader(d.jcItem),
                  accessor: (line) => itemLabelById.get(line.itemId) ?? line.itemId,
                  render: (line) =>
                    itemLabelById.has(line.itemId) ? (
                      itemLabelById.get(line.itemId)
                    ) : (
                      mono(shortId(line.itemId))
                    ),
                },
                {
                  id: "qty",
                  header: activeLocaleHeader(d.jcQty),
                  accessor: (line) => line.qty,
                  render: (line) => mono(line.qty),
                },
                {
                  id: "price",
                  header: activeLocaleHeader(d.jcUnitPrice),
                  accessor: (line) => line.unitPrice,
                  render: (line) => mono(line.unitPrice),
                },
                {
                  id: "hours",
                  header: activeLocaleHeader(d.jcLoggedHours),
                  accessor: (line) => line.loggedHours,
                  render: (line) =>
                    line.lineType === "LABOR" ? (
                      <span className="font-mono text-sm" dir="ltr">
                        {line.estimatedHours ?? "—"} → {line.loggedHours}
                      </span>
                    ) : (
                      DASH
                    ),
                },
                {
                  id: "discount",
                  header: activeLocaleHeader(d.jcDiscount),
                  accessor: (line) => line.discountAmount,
                  render: (line) => mono(line.discountAmount),
                },
              ]}
              rows={[...selected.lines]}
              rowKey={(line) => line.id}
              rowActions={lineRowActions}
              empty={{ title: d.jobCardsEmpty }}
            />
          </div>
        </Card>
      )}

      {/* -- create dialog ------------------------------------------------------ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.jobCardsNew} size="lg">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label={d.jcBranch}
            value={branchId}
            onValueChange={setBranchId}
            options={[
              { value: "", label: "—" },
              ...activeBranches.map((b) => ({ value: b.id, label: branchById.get(b.id) ?? b.code })),
            ]}
            required
          />
          <Select
            label={d.jcCustomer}
            value={customerId}
            onValueChange={(value) => {
              setCustomerId(value);
              setVehicleId("");
              void loadCustomerVehicles(value);
            }}
            options={[
              { value: "", label: "—" },
              ...customersOnly.map((c) => ({ value: c.id, label: customerNameById.get(c.id) ?? c.code })),
            ]}
            required
          />
          <Select
            label={d.jcVehicle}
            value={vehicleId}
            onValueChange={setVehicleId}
            disabled={customerId === "" || vehiclesLoading}
            hint={vehiclesLoading ? d.loading : undefined}
            options={[
              { value: "", label: "—" },
              ...customerVehicles
                .filter((v) => v.status === "ACTIVE")
                .map((v) => ({ value: v.id, label: vehicleLabel(v) })),
            ]}
          />
          <Select
            label={d.jcWarehouse}
            value={warehouseId}
            onValueChange={setWarehouseId}
            options={[
              { value: "", label: "—" },
              ...activeWarehouses.map((w) => ({ value: w.id, label: warehouseById.get(w.id) ?? w.id })),
            ]}
            required
          />
          <Select
            label={d.jcPartsIssueMode}
            value={partsIssueMode}
            onValueChange={(value) => setPartsIssueMode(value === "issue_immediate" ? "issue_immediate" : "reserve")}
            options={[
              { value: "reserve", label: d.jcModeReserve },
              { value: "issue_immediate", label: d.jcModeIssueImmediate },
            ]}
          />
          <Input
            label={d.jcOdometer}
            value={odometer}
            onValueChange={setOdometer}
            inputMode="decimal"
            mono
            bidiIsolate
            error={odometer !== "" && !ODOMETER_RE.test(odometer.trim()) ? d.errorsValidation : undefined}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Textarea label={d.jcComplaints} value={complaints} onValueChange={setComplaints} rows={2} />
          <Textarea label={d.jcNote} value={note} onValueChange={setNote} rows={2} />
        </div>

        <div className="mt-4 space-y-3">
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[9rem_2fr_1fr_1fr_1fr_1fr_1fr_auto]"
            >
              <Select
                label={d.kindLabel}
                value={line.lineType}
                onValueChange={(value) => {
                  const lineType = value === "LABOR" ? "LABOR" : "PARTS";
                  updateLine(index, { lineType, itemId: "" });
                }}
                options={[
                  { value: "PARTS", label: d.jcLineParts },
                  { value: "LABOR", label: d.jcLineLabor },
                ]}
              />
              <Select
                label={d.jcItem}
                value={line.itemId}
                onValueChange={(value) => updateLine(index, { itemId: value })}
                options={itemOptionsFor(line.lineType)}
              />
              <Input
                label={d.jcQty}
                value={line.qty}
                onValueChange={(value) => updateLine(index, { qty: value })}
                inputMode="decimal"
                required
              />
              <Input
                label={line.lineType === "LABOR" ? d.jcHourlyRate : d.jcUnitPrice}
                value={line.unitPrice}
                onValueChange={(value) => updateLine(index, { unitPrice: value })}
                inputMode="decimal"
                mono
                bidiIsolate
              />
              {line.lineType === "LABOR" ? (
                <Input
                  label={d.jcEstimatedHours}
                  value={line.estimatedHours}
                  onValueChange={(value) => updateLine(index, { estimatedHours: value })}
                  inputMode="decimal"
                  required
                  error={
                    line.estimatedHours !== "" &&
                    !(QTY_RE.test(line.estimatedHours) && Number(line.estimatedHours) > 0)
                      ? d.errorsValidation
                      : undefined
                  }
                />
              ) : (
                <Input
                  label={d.jcDiscount}
                  value={line.discount}
                  onValueChange={(value) => updateLine(index, { discount: value })}
                  inputMode="decimal"
                  mono
                  bidiIsolate
                  error={line.discount !== "" && !MONEY_RE.test(line.discount) ? d.errorsValidation : undefined}
                />
              )}
              <Select
                label={d.jcTaxCode}
                value={line.taxCodeId}
                onValueChange={(value) => updateLine(index, { taxCodeId: value })}
                options={[
                  { value: "", label: "—" },
                  ...taxCodes
                    .filter((code) => code.status === "ACTIVE")
                    .map((code) => ({
                      value: code.id,
                      label: `${code.code} · ${localizedName(code.name, code.nameAr, locale)}`,
                    })),
                ]}
              />
              <div className="flex items-end">
                {lines.length > 1 && (
                  <Button
                    variant="secondary"
                    onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                  >
                    {d.jcRemoveLine}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setLines((rows) => [...rows, { ...EMPTY_LINE }])}>
            {d.jcAddLine}
          </Button>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createCard()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- cancel-with-reason dialog ------------------------------------------ */}
      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title={`${d.jcActionCancel} · ${cancelTarget?.cardNo ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <Input label={d.jcCancelReason} value={cancelReason} onValueChange={setCancelReason} required />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="danger"
              loading={busy !== null && busy.startsWith("cancel-")}
              disabled={cancelReason.trim() === ""}
              onClick={() => void confirmCancel()}
            >
              {d.jcActionCancel}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- log-hours dialog ---------------------------------------------------- */}
      <Dialog
        open={hoursTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHoursTarget(null);
            setHoursLineId("");
          }
        }}
        title={`${d.jcLogHours} · ${hoursTarget?.cardNo ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <Input
            label={d.jcEstimatedHours}
            value={hoursValue}
            onValueChange={setHoursValue}
            inputMode="decimal"
            required
            error={
              hoursValue !== "" && !(QTY_RE.test(hoursValue) && Number(hoursValue) > 0)
                ? d.errorsValidation
                : undefined
            }
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setHoursTarget(null);
                setHoursLineId("");
              }}
            >
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={busy !== null && busy.startsWith("hours-")}
              disabled={!(QTY_RE.test(hoursValue) && Number(hoursValue) > 0)}
              onClick={() => void confirmLogHours()}
            >
              {d.jcLogHours}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
