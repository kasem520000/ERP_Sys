"use client";

/**
 * PHASE-017 T14 (9a-dist) — routes & the visit board:
 *
 * - the route registry table (code, rep, van, day-pattern badges, status)
 *   with the create dialog (weekday toggles MON..SUN, rep + van selects);
 * - the selected route's workspace: the customer composition editor
 *   (multi-add with visit order + pinning, full-replace save) and the
 *   plan-visits date picker (idempotent planning, weekday-gated);
 * - the day's visit board: date + status filters, rows grouped by route,
 *   check-in / complete (optional invoice/credit-note/receipt links + note)
 *   / skip actions. Planning data only — nothing here ever posts a journal.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  NumberInput,
  Select,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  PartnerRow,
  RouteCustomerRow,
  RouteDayCode,
  RoutePlanVisitsResult,
  RouteRow,
  RouteVisitRow,
  SalesRepRow,
  VanRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedDayCode,
  localizedDistributionError,
  localizedStatus,
  localizedVisitStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const CODE_RE = /^[A-Za-z0-9._-]{2,30}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_CODES: readonly RouteDayCode[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** A composition draft row (order + pin editable; save = full-replace). */
interface CompositionDraft {
  customerId: string;
  code: string | null;
  name: string;
  nameAr: string | null;
  visitOrder: number;
  isPinned: boolean;
}

function customerLabel(
  row: { code: string | null; name: string; nameAr: string | null },
  locale: Locale,
): string {
  const name = localizedName(row.name, row.nameAr, locale);
  return row.code === null ? name : `${name} · ${row.code}`;
}

export function DistributionRoutes({
  locale,
  initialRoutes,
  initialVisits,
  boardDate,
  reps,
  vans,
  customers,
}: {
  locale: Locale;
  initialRoutes: readonly RouteRow[];
  initialVisits: readonly RouteVisitRow[];
  boardDate: string;
  reps: readonly SalesRepRow[];
  vans: readonly VanRow[];
  customers: readonly PartnerRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [routes, setRoutes] = useState<readonly RouteRow[]>(initialRoutes);
  const [visits, setVisits] = useState<readonly RouteVisitRow[]>(initialVisits);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [salesRepId, setSalesRepId] = useState("");
  const [vanWarehouseId, setVanWarehouseId] = useState("");
  const [days, setDays] = useState<Set<RouteDayCode>>(new Set(["MON", "TUE", "WED", "THU", "FRI"]));

  // Selected route workspace.
  const [selected, setSelected] = useState<RouteRow | null>(null);
  const [composition, setComposition] = useState<CompositionDraft[]>([]);
  const [addCustomerId, setAddCustomerId] = useState("");
  const [planDate, setPlanDate] = useState(boardDate);

  // Visit board state.
  const [boardDay, setBoardDay] = useState(boardDate);
  const [statusFilter, setStatusFilter] = useState("");
  const [boardLoading, setBoardLoading] = useState(false);

  // Complete dialog state.
  const [completing, setCompleting] = useState<RouteVisitRow | null>(null);
  const [linkInvoice, setLinkInvoice] = useState("");
  const [linkCreditNote, setLinkCreditNote] = useState("");
  const [linkReceipt, setLinkReceipt] = useState("");
  const [completeNote, setCompleteNote] = useState("");

  const activeReps = useMemo(() => reps.filter((rep) => rep.status === "ACTIVE"), [reps]);
  const activeVans = useMemo(() => vans.filter((van) => van.isActive), [vans]);
  const repNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const rep of reps) {
      map.set(rep.id, `${localizedName(rep.name, rep.nameAr, locale)} · ${rep.code}`);
    }
    return map;
  }, [reps, locale]);
  const vanLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const van of vans) {
      map.set(van.id, `${localizedName(van.name, van.nameAr, locale)} · ${van.code}`);
    }
    return map;
  }, [vans, locale]);

  const codeValid = CODE_RE.test(code.trim());
  const createReady = codeValid && name.trim() !== "" && days.size >= 1;
  const addableCustomers = useMemo(() => {
    const inComposition = new Set(composition.map((row) => row.customerId));
    return customers.filter((partner) => !inComposition.has(partner.id));
  }, [customers, composition]);

  // -- board loading -----------------------------------------------------------------

  async function loadBoard(date: string, status: string): Promise<void> {
    setBoardLoading(true);
    const query = `distribution/visits?date=${date}${status === "" ? "" : `&status=${status}`}`;
    const result = await bffFetch<readonly RouteVisitRow[]>(query);
    setBoardLoading(false);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setVisits(result.data);
  }

  function onBoardDayChange(date: string): void {
    setBoardDay(date);
    void loadBoard(date, statusFilter);
  }

  function onStatusFilterChange(status: string): void {
    setStatusFilter(status);
    void loadBoard(boardDay, status);
  }

  // -- route create ------------------------------------------------------------------

  async function createRoute(): Promise<void> {
    if (!createReady) {
      setError(codeValid ? d.errorsValidation : d.posTerminalsErrCodePattern);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<RouteRow>("distribution/routes", {
      method: "POST",
      body: {
        code: code.trim(),
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
        salesRepId: salesRepId === "" ? null : salesRepId,
        vanWarehouseId: vanWarehouseId === "" ? null : vanWarehouseId,
        dayPattern: DAY_CODES.filter((day) => days.has(day)),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRoutes((current) => [result.data, ...current]);
    setCreateOpen(false);
    setCode("");
    setName("");
    setNameAr("");
    setSalesRepId("");
    setVanWarehouseId("");
    setDays(new Set(["MON", "TUE", "WED", "THU", "FRI"]));
    setNotice(formatMessage(d.distRoutesCreatedToast, { code: result.data.code }));
  }

  // -- selected route workspace --------------------------------------------------------

  async function selectRoute(route: RouteRow): Promise<void> {
    setSelected(route);
    setPlanDate(boardDay);
    setAddCustomerId("");
    setError(null);
    // The registered surface has no GET for the composition — derive it from
    // the route's planned visits (first appearance across dates); a save is
    // the full-replace that makes the shown order authoritative.
    const result = await bffFetch<readonly RouteVisitRow[]>(`distribution/visits?routeId=${route.id}`);
    if (!result.ok) {
      setComposition([]);
      return;
    }
    const seen = new Map<string, CompositionDraft>();
    for (const visit of result.data) {
      if (seen.has(visit.customerId)) continue;
      seen.set(visit.customerId, {
        customerId: visit.customerId,
        code: visit.customerCode,
        name: visit.customerName ?? visit.customerId,
        nameAr: visit.customerNameAr,
        visitOrder: seen.size + 1,
        isPinned: false,
      });
    }
    setComposition([...seen.values()]);
  }

  function addToComposition(): void {
    const partner = customers.find((entry) => entry.id === addCustomerId);
    if (partner === undefined) return;
    setComposition((current) => [
      ...current,
      {
        customerId: partner.id,
        code: partner.code,
        name: partner.name,
        nameAr: partner.nameAr,
        visitOrder: current.length + 1,
        isPinned: false,
      },
    ]);
    setAddCustomerId("");
  }

  function removeFromComposition(customerId: string): void {
    setComposition((current) => {
      const next = current.filter((row) => row.customerId !== customerId);
      return next.map((row, index) => ({ ...row, visitOrder: index + 1 }));
    });
  }

  function setOrder(customerId: string, order: number): void {
    setComposition((current) =>
      current.map((row) => (row.customerId === customerId ? { ...row, visitOrder: order } : row)),
    );
  }

  function togglePinned(customerId: string, pinned: boolean): void {
    setComposition((current) =>
      current.map((row) => (row.customerId === customerId ? { ...row, isPinned: pinned } : row)),
    );
  }

  async function saveComposition(): Promise<void> {
    if (selected === null || composition.length === 0) {
      setError(d.distCompEmpty);
      return;
    }
    setBusy("composition");
    setError(null);
    const result = await bffFetch<readonly RouteCustomerRow[]>(
      `distribution/routes/${selected.id}/customers`,
      {
        method: "POST",
        body: {
          customers: composition.map((row) => ({
            customerId: row.customerId,
            visitOrder: row.visitOrder,
            isPinned: row.isPinned,
          })),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setComposition(
      result.data.map((row) => ({
        customerId: row.customerId,
        code: row.customerCode,
        name: row.customerName ?? row.customerId,
        nameAr: row.customerNameAr,
        visitOrder: row.visitOrder,
        isPinned: row.isPinned,
      })),
    );
    setNotice(formatMessage(d.distCompSavedToast, { count: result.data.length }));
  }

  async function planVisits(): Promise<void> {
    if (selected === null) return;
    setBusy("plan");
    setError(null);
    const result = await bffFetch<RoutePlanVisitsResult>(
      `distribution/routes/${selected.id}/plan-visits`,
      { method: "POST", body: { date: planDate } },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.distPlanToast, { planned: result.data.planned, skipped: result.data.skipped }));
    // Refresh the board at its own date (planning may have touched it).
    await loadBoard(boardDay, statusFilter);
  }

  // -- visit actions --------------------------------------------------------------------

  async function visitAction(visit: RouteVisitRow, action: "check-in" | "skip"): Promise<void> {
    setBusy(visit.id);
    setError(null);
    const result = await bffFetch<RouteVisitRow>(`distribution/visits/${visit.id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setVisits((current) => current.map((row) => (row.id === visit.id ? result.data : row)));
    setNotice(action === "check-in" ? d.distVisitCheckedInToast : d.distVisitSkippedToast);
  }

  function openComplete(visit: RouteVisitRow): void {
    setCompleting(visit);
    setLinkInvoice("");
    setLinkCreditNote("");
    setLinkReceipt("");
    setCompleteNote("");
  }

  async function completeVisit(): Promise<void> {
    if (completing === null) return;
    const invoice = linkInvoice.trim();
    const creditNote = linkCreditNote.trim();
    const receipt = linkReceipt.trim();
    const note = completeNote.trim();
    if (
      (invoice !== "" && !UUID_RE.test(invoice)) ||
      (creditNote !== "" && !UUID_RE.test(creditNote)) ||
      (receipt !== "" && !UUID_RE.test(receipt))
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("complete");
    setError(null);
    const result = await bffFetch<RouteVisitRow>(`distribution/visits/${completing.id}/complete`, {
      method: "POST",
      body: {
        salesInvoiceId: invoice === "" ? null : invoice,
        creditNoteId: creditNote === "" ? null : creditNote,
        receiptId: receipt === "" ? null : receipt,
        note: note === "" ? null : note,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setVisits((current) => current.map((row) => (row.id === completing.id ? result.data : row)));
    setCompleting(null);
    setNotice(d.distVisitCompletedToast);
  }

  // -- render ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.distributionRoutesTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.distRoutesCreate}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.distRoutesCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.code}
                </span>
              ),
            },
            {
              id: "name",
              header: activeLocaleHeader(d.distRoutesName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "rep",
              header: activeLocaleHeader(d.distRoutesRep),
              accessor: (row) => row.salesRepName ?? "—",
            },
            {
              id: "van",
              header: activeLocaleHeader(d.distRoutesVan),
              accessor: (row) => row.vanWarehouseCode ?? "—",
              mono: true,
              render: (row) =>
                row.vanWarehouseCode === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.vanWarehouseCode}
                  </span>
                ),
            },
            {
              id: "days",
              header: activeLocaleHeader(d.distRoutesDayPattern),
              accessor: (row) => row.dayPattern.join(","),
              render: (row) => (
                <span className="flex flex-wrap gap-1" aria-label={d.distRoutesDayPattern}>
                  {DAY_CODES.filter((day) => row.dayPattern.includes(day)).map((day) => (
                    <Badge key={day}>{localizedDayCode(d, day)}</Badge>
                  ))}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "ACTIVE" ? "primary" : undefined}>
                  {localizedStatus(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...routes]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row) => {
                void selectRoute(row);
              },
            },
          ]}
          empty={{ title: d.distRoutesEmpty }}
        />
      </Card>

      {selected !== null && (
        <Card
          title={`${d.distCompTitle} · ${selected.code}`}
          description={d.distCompDerivedHint}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-subtle bg-surface-sunken p-3">
              <DatePicker
                locale={locale}
                label={d.distPlanDate}
                value={planDate}
                onSelect={setPlanDate}
                required
              />
              <Button
                variant="primary"
                loading={busy === "plan"}
                disabled={planDate === ""}
                onClick={() => void planVisits()}
              >
                {d.distPlanBtn}
              </Button>
            </div>

            <p className="text-sm text-gray-600">{d.distCompHint}</p>

            {composition.length === 0 ? (
              <p className="rounded-md border border-subtle bg-surface-sunken p-3 text-sm text-gray-500">
                {d.distCompEmpty}
              </p>
            ) : (
              <table className="w-full text-sm" aria-label={d.distCompTitle}>
                <thead>
                  <tr className="border-b border-subtle text-start text-xs text-gray-600">
                    <th scope="col" className="px-2 py-1 text-start">{d.distCompOrder}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.distVisitCustomer}</th>
                    <th scope="col" className="px-2 py-1 text-start">{d.distCompPinned}</th>
                    <th scope="col" className="px-2 py-1 text-end">{d.distCompRemove}</th>
                  </tr>
                </thead>
                <tbody>
                  {composition.map((row) => (
                    <tr key={row.customerId} className="border-b border-subtle">
                      <td className="px-2 py-1.5">
                        <span className="w-24">
                          <NumberInput
                            value={String(row.visitOrder)}
                            onValueChange={(value) =>
                              setOrder(row.customerId, Math.max(1, Number(value) || 1))
                            }
                            min={1}
                            aria-label={d.distCompOrder}
                          />
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{customerLabel(row, locale)}</td>
                      <td className="px-2 py-1.5">
                        <Checkbox
                          label={d.distCompPinned}
                          checked={row.isPinned}
                          onCheckedChange={(checked) => togglePinned(row.customerId, checked === true)}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-end">
                        <Button variant="ghost" onClick={() => removeFromComposition(row.customerId)}>
                          {d.distCompRemove}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <Select
                label={d.distCompAddCustomer}
                value={addCustomerId}
                onValueChange={setAddCustomerId}
                placeholder="—"
                options={addableCustomers.map((partner) => ({
                  value: partner.id,
                  label: customerLabel(
                    { code: partner.code, name: partner.name, nameAr: partner.nameAr },
                    locale,
                  ),
                }))}
              />
              <Button
                variant="secondary"
                disabled={addCustomerId === ""}
                onClick={addToComposition}
              >
                {d.distCompAddCustomer}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                loading={busy === "composition"}
                disabled={composition.length === 0}
                onClick={() => void saveComposition()}
              >
                {d.distCompSave}
              </Button>
              <Badge tone="primary">{formatMessage(d.distCompCount, { count: composition.length })}</Badge>
              <Button variant="ghost" onClick={() => { setSelected(null); setComposition([]); }}>
                {d.commonClear}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card title={d.distBoardTitle}>
        <div className="flex flex-wrap items-end gap-3">
          <DatePicker
            locale={locale}
            label={d.distBoardDate}
            value={boardDay}
            onSelect={onBoardDayChange}
            required
          />
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            options={[
              { value: "", label: d.distBoardAllStatuses },
              { value: "PLANNED", label: d.distVisitPlanned },
              { value: "COMPLETED", label: d.distVisitCompleted },
              { value: "SKIPPED", label: d.distVisitSkipped },
              { value: "MISSED", label: d.distVisitMissed },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={boardLoading}
            columns={[
              {
                id: "route",
                header: activeLocaleHeader(d.distVisitRoute),
                accessor: (row) => row.routeCode ?? "",
                mono: true,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.routeCode ?? "—"}
                  </span>
                ),
              },
              {
                id: "customer",
                header: activeLocaleHeader(d.distVisitCustomer),
                accessor: (row) => localizedName(
                  row.customerName ?? row.customerId,
                  row.customerNameAr,
                  locale,
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "PLANNED" ? "primary" : undefined}>
                    {localizedVisitStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "checkin",
                header: activeLocaleHeader(d.distVisitCheckedIn),
                accessor: (row) => row.checkedInAt ?? "",
                render: (row) =>
                  row.checkedInAt === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    formatDateTime(row.checkedInAt, locale)
                  ),
              },
              {
                id: "note",
                header: activeLocaleHeader(d.distVisitNote),
                accessor: (row) => row.note ?? "",
                render: (row) =>
                  row.note === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span>{row.note}</span>
                  ),
              },
            ]}
            rows={[...visits]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "checkin",
                label: d.distVisitCheckIn,
                onSelect: (row) => {
                  if (row.status !== "PLANNED" || row.checkedInAt !== null) return;
                  void visitAction(row, "check-in");
                },
              },
              {
                id: "complete",
                label: d.distVisitComplete,
                onSelect: (row) => {
                  if (row.status !== "PLANNED") return;
                  openComplete(row);
                },
              },
              {
                id: "skip",
                label: d.distVisitSkip,
                danger: true,
                onSelect: (row) => {
                  if (row.status !== "PLANNED") return;
                  void visitAction(row, "skip");
                },
              },
            ]}
            empty={{ title: d.distVisitEmpty }}
          />
        </div>
      </Card>

      {/* -- create route dialog -------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.distRoutesCreate} size="lg">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.distRoutesCode}
            value={code}
            onValueChange={setCode}
            error={code !== "" && !codeValid ? d.posTerminalsErrCodePattern : undefined}
            mono
            bidiIsolate
            required
          />
          <Input label={d.distRoutesName} value={name} onValueChange={setName} required />
          <Input label={`${d.distRoutesName} (AR)`} value={nameAr} onValueChange={setNameAr} />
          <Select
            label={d.distRoutesRep}
            value={salesRepId}
            onValueChange={setSalesRepId}
            placeholder="—"
            options={activeReps.map((rep) => ({
              value: rep.id,
              label: repNameById.get(rep.id) ?? rep.code,
            }))}
          />
          <Select
            label={d.distRoutesVan}
            value={vanWarehouseId}
            onValueChange={setVanWarehouseId}
            placeholder="—"
            options={activeVans.map((van) => ({
              value: van.id,
              label: vanLabelById.get(van.id) ?? van.code,
            }))}
          />
        </div>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-gray-700">{d.distRoutesDayPattern}</legend>
          <p className="text-xs text-gray-600">{d.distRoutesDayPatternHint}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {DAY_CODES.map((day) => (
              <Checkbox
                key={day}
                label={localizedDayCode(d, day)}
                checked={days.has(day)}
                onCheckedChange={(checked) => {
                  setDays((current) => {
                    const next = new Set(current);
                    if (checked === true) {
                      next.add(day);
                    } else if (next.size > 1) {
                      next.delete(day);
                    }
                    return next;
                  });
                }}
              />
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createRoute()}
          >
            {d.distRoutesCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- complete visit dialog -------------------------------------------------- */}
      <Dialog
        open={completing !== null}
        onOpenChange={(open) => {
          if (!open) setCompleting(null);
        }}
        title={`${d.distCompleteTitle} · ${completing?.customerName ?? ""}`}
      >
        <p className="text-sm text-gray-600">{d.distCompleteHint}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input
            label={d.distCompleteInvoice}
            value={linkInvoice}
            onValueChange={setLinkInvoice}
            error={linkInvoice !== "" && !UUID_RE.test(linkInvoice) ? d.errorsValidation : undefined}
            mono
            bidiIsolate
          />
          <Input
            label={d.distCompleteCreditNote}
            value={linkCreditNote}
            onValueChange={setLinkCreditNote}
            error={linkCreditNote !== "" && !UUID_RE.test(linkCreditNote) ? d.errorsValidation : undefined}
            mono
            bidiIsolate
          />
          <Input
            label={d.distCompleteReceipt}
            value={linkReceipt}
            onValueChange={setLinkReceipt}
            error={linkReceipt !== "" && !UUID_RE.test(linkReceipt) ? d.errorsValidation : undefined}
            mono
            bidiIsolate
          />
          <Input label={d.distVisitNote} value={completeNote} onValueChange={setCompleteNote} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCompleting(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "complete"}
            disabled={
              (linkInvoice !== "" && !UUID_RE.test(linkInvoice)) ||
              (linkCreditNote !== "" && !UUID_RE.test(linkCreditNote)) ||
              (linkReceipt !== "" && !UUID_RE.test(linkReceipt))
            }
            onClick={() => void completeVisit()}
          >
            {d.distVisitComplete}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
