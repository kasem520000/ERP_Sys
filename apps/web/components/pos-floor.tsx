"use client";

/**
 * PHASE-016 T6 — the floor plan (table service): zone sections with table
 * cards (FREE/OCCUPIED derived from OPEN checks), the open-check dialog
 * (order type + guests), and the check editor — lines with qty steppers,
 * save (PUT lines), kitchen tickets (send + list), transfer, split, the
 * printable guest check, Pay (hands the check to the counter via
 * sessionStorage + ?checkId=), and cancel-with-reason. Unpaid checks hold
 * no ledger effect — payment posts through the counter's sale flow.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, Checkbox, Dialog, Input, Select, formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  PosCheckLine,
  PosCheckRow,
  PosFloorTable,
  PosFloorZone,
  PosKitchenTicketRow,
  PosOrderType,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { mulQtyPriceExact, stepQtyExact, sumExact } from "../lib/exact-money";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedPosCheckStatus,
  localizedPosError,
  localizedPosOrderType,
} from "../lib/messages";
import { writePosPreload } from "../lib/pos-outbox";
import { printHtmlDocument } from "../lib/print-frame";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";

const QTY_RE = /^\d+(\.\d{1,6})?$/;

interface DraftLine {
  itemId: string;
  name: string;
  nameAr: string | null;
  qty: string;
  unitPrice: string;
  sentToKitchen: boolean;
}

/** Minimal HTML escaping for names flowing into print documents. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Check lines → editor draft rows. */
function draftLinesOf(check: PosCheckRow): DraftLine[] {
  return check.lines.map((line) => ({
    itemId: line.itemId,
    name: line.name,
    nameAr: line.nameAr,
    qty: line.qty,
    unitPrice: line.unitPrice,
    sentToKitchen: line.sentToKitchen,
  }));
}

export function PosFloor({
  locale,
  branches,
  initialBranchId,
  initialZones,
  initialChecks,
  items,
}: {
  locale: Locale;
  branches: readonly BranchRow[];
  initialBranchId: string;
  initialZones: readonly PosFloorZone[];
  initialChecks: readonly PosCheckRow[];
  items: readonly ItemRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [branchId, setBranchId] = useState(initialBranchId);
  const [zones, setZones] = useState<readonly PosFloorZone[]>(initialZones);
  const [checks, setChecks] = useState<readonly PosCheckRow[]>(initialChecks);
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<readonly PosKitchenTicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Editor draft state (saved explicitly — PUT replaces the whole list).
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [addItem, setAddItem] = useState("");

  // Dialogs.
  const [openTable, setOpenTable] = useState<PosFloorTable | null>(null);
  const [orderType, setOrderType] = useState<PosOrderType>("DINE_IN");
  const [guestCount, setGuestCount] = useState("2");
  const [addTableDialog, setAddTableDialog] = useState(false);
  const [tableZone, setTableZone] = useState("MAIN");
  const [tableZoneAr, setTableZoneAr] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [tableSeats, setTableSeats] = useState("4");
  const [tableSortKey, setTableSortKey] = useState("0");
  const [transferDialog, setTransferDialog] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [splitNos, setSplitNos] = useState<Set<number>>(new Set());
  const [guestCheckHtml, setGuestCheckHtml] = useState<string | null>(null);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);
  const sellableItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === "ACTIVE" && item.deletedAt === null && item.basePrice !== null && item.basePrice !== "",
      ),
    [items],
  );
  const selectedCheck = checks.find((check) => check.id === selectedCheckId) ?? null;
  const allTables = useMemo(() => zones.flatMap((zone) => zone.tables), [zones]);
  /** Open checks with no table (takeaway/delivery) — reachable from the list. */
  const tablelessChecks = useMemo(
    () => checks.filter((check) => check.tableId === null),
    [checks],
  );
  const selectedTable =
    selectedCheck?.tableId === null || selectedCheck === null
      ? null
      : allTables.find((table) => table.id === selectedCheck.tableId) ?? null;
  const freeTables = allTables.filter((table) => table.status === "FREE");
  const checkTotal = useMemo(
    () =>
      selectedCheck === null
        ? "0.0000"
        : sumExact(selectedCheck.lines.map((line) => mulQtyPriceExact(line.qty, line.unitPrice))),
    [selectedCheck],
  );

  async function loadBranch(nextBranchId: string): Promise<void> {
    setBranchId(nextBranchId);
    setLoading(true);
    setError(null);
    const [floor, checkList] = await Promise.all([
      bffFetch<readonly PosFloorZone[]>(`pos/floor?branchId=${nextBranchId}`),
      bffFetch<readonly PosCheckRow[]>(`pos/checks?branchId=${nextBranchId}&status=OPEN`),
    ]);
    setLoading(false);
    if (!floor.ok) {
      setError(localizedPosError(d, floor.error, floor.retryAfterSeconds));
      return;
    }
    setZones(floor.data);
    setChecks(checkList.ok ? checkList.data : []);
    setSelectedCheckId(null);
    setDraftLines([]);
    setTickets([]);
  }

  async function refreshChecks(keepCheckId: string | null): Promise<PosCheckRow | null> {
    if (branchId === "") {
      return null;
    }
    const [floor, checkList] = await Promise.all([
      bffFetch<readonly PosFloorZone[]>(`pos/floor?branchId=${branchId}`),
      bffFetch<readonly PosCheckRow[]>(`pos/checks?branchId=${branchId}&status=OPEN`),
    ]);
    if (floor.ok) {
      setZones(floor.data);
    }
    if (checkList.ok) {
      setChecks(checkList.data);
      const kept = keepCheckId === null ? null : checkList.data.find((check) => check.id === keepCheckId) ?? null;
      setSelectedCheckId(kept?.id ?? null);
      if (kept === null) {
        setDraftLines([]);
        setTickets([]);
      }
      return kept;
    }
    return null;
  }

  function selectCheck(check: PosCheckRow): void {
    setSelectedCheckId(check.id);
    setDraftLines(draftLinesOf(check));
    setSplitMode(false);
    setSplitNos(new Set());
    void bffFetch<readonly PosKitchenTicketRow[]>(`pos/checks/${check.id}/kitchen-tickets`).then((result) => {
      setTickets(result.ok ? result.data : []);
    });
  }

  async function openCheck(): Promise<void> {
    if (openTable === null || branchId === "") {
      return;
    }
    const guests = Number(guestCount);
    if (!Number.isInteger(guests) || guests < 1 || guests > 50) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("open-check");
    setError(null);
    const result = await bffFetch<PosCheckRow>("pos/checks", {
      method: "POST",
      body: {
        branchId,
        tableId: openTable.id,
        orderType,
        guestCount: guests,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setOpenTable(null);
    await refreshChecks(result.data.id);
    selectCheck(result.data);
    setNotice(`${d.posFloorOpenCheck} · ${result.data.checkNo}`);
  }

  async function saveLines(): Promise<void> {
    if (selectedCheck === null) {
      return;
    }
    if (draftLines.some((line) => !QTY_RE.test(line.qty))) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("save-lines");
    setError(null);
    const result = await bffFetch<PosCheckRow>(`pos/checks/${selectedCheck.id}/lines`, {
      method: "PUT",
      body: {
        lines: draftLines.map((line, index) => ({
          lineNo: index + 1,
          itemId: line.itemId,
          name: line.name,
          nameAr: line.nameAr,
          qty: line.qty,
          unitPrice: line.unitPrice,
          sentToKitchen: line.sentToKitchen,
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDraftLines(draftLinesOf(result.data));
    await refreshChecks(result.data.id);
    setNotice(d.posFloorLinesSaved);
  }

  async function sendKitchenTicket(): Promise<void> {
    if (selectedCheck === null) {
      return;
    }
    setBusy("kitchen");
    setError(null);
    const result = await bffFetch<PosKitchenTicketRow>(`pos/checks/${selectedCheck.id}/kitchen-ticket`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.posFloorKitchenSent, { no: result.data.ticketNo }));
    const kept = await refreshChecks(selectedCheck.id);
    if (kept !== null) {
      selectCheck(kept);
    }
  }

  async function transferCheck(): Promise<void> {
    if (selectedCheck === null || transferTarget === "") {
      return;
    }
    setBusy("transfer");
    setError(null);
    const result = await bffFetch<PosCheckRow>(`pos/checks/${selectedCheck.id}/transfer`, {
      method: "POST",
      body: { toTableId: transferTarget },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTransferDialog(false);
    setTransferTarget("");
    await refreshChecks(result.data.id);
    setNotice(d.posFloorTransferred);
  }

  async function splitCheck(): Promise<void> {
    if (selectedCheck === null || splitNos.size === 0) {
      return;
    }
    // Split runs on the SAVED line numbers — map draft rows back to the
    // server's lineNo (split mode always starts from the saved lines).
    const lineNos = [...splitNos]
      .map((index) => selectedCheck.lines[index - 1]?.lineNo)
      .filter((lineNo): lineNo is number => lineNo !== undefined);
    if (lineNos.length === 0) {
      return;
    }
    setBusy("split");
    setError(null);
    const result = await bffFetch<{ source: PosCheckRow; target: PosCheckRow }>(
      `pos/checks/${selectedCheck.id}/split`,
      {
        method: "POST",
        body: { lineNos },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setSplitMode(false);
    setSplitNos(new Set());
    await refreshChecks(result.data.source.id);
    setNotice(formatMessage(d.posFloorSplitDone, { n: result.data.target.lines.length }));
  }

  async function cancelCheck(): Promise<void> {
    if (selectedCheck === null || cancelReason.trim() === "") {
      return;
    }
    setBusy("cancel-check");
    setError(null);
    const result = await bffFetch<PosCheckRow>(`pos/checks/${selectedCheck.id}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCancelDialog(false);
    setCancelReason("");
    await refreshChecks(null);
    setNotice(d.posFloorCheckCancelled);
  }

  async function addTable(): Promise<void> {
    if (branchId === "" || tableLabel.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    const seats = Number(tableSeats);
    const sort = Number(tableSortKey);
    if (!Number.isInteger(seats) || seats < 1 || seats > 40 || !Number.isInteger(sort)) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("add-table");
    setError(null);
    const result = await bffFetch<PosFloorTable>("pos/floor/tables", {
      method: "POST",
      body: {
        branchId,
        zone: tableZone.trim() === "" ? "MAIN" : tableZone.trim(),
        zoneAr: tableZoneAr.trim() === "" ? null : tableZoneAr.trim(),
        label: tableLabel.trim(),
        seats,
        sortKey: sort,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setAddTableDialog(false);
    setTableLabel("");
    await refreshChecks(selectedCheckId);
    setNotice(d.posFloorTableAdded);
  }

  function payCheck(): void {
    if (selectedCheck === null) {
      return;
    }
    writePosPreload({
      checkId: selectedCheck.id,
      checkNo: selectedCheck.checkNo,
      orderType: selectedCheck.orderType,
      lines: selectedCheck.lines.map((line) => ({
        itemId: line.itemId,
        name: line.name,
        nameAr: line.nameAr,
        qty: line.qty,
        unitPrice: line.unitPrice,
        sentToKitchen: line.sentToKitchen,
      })),
    });
    router.push(`/${locale}/pos?checkId=${selectedCheck.id}`);
  }

  /** The printable guest-check document (pt units, RTL-aware, escaped). */
  function buildGuestCheckHtml(check: PosCheckRow): string {
    const dir = locale === "ar" ? "rtl" : "ltr";
    const rows = check.lines
      .map(
        (line: PosCheckLine) =>
          `<tr><td>${escapeHtml(localizedName(line.name, line.nameAr, locale))}</td>` +
          `<td class="n">${escapeHtml(line.qty)}</td>` +
          `<td class="n">${escapeHtml(formatMoneyDisplay(line.unitPrice, 2))}</td>` +
          `<td class="n">${escapeHtml(formatMoneyDisplay(mulQtyPriceExact(line.qty, line.unitPrice), 2))}</td></tr>`,
      )
      .join("");
    return `<!doctype html><html dir="${dir}" lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(
      d.posFloorGuestCheck,
    )}</title><style>body{font-family:monospace;font-size:10pt;margin:1em}table{width:100%;border-collapse:collapse}td,th{border-block-end:1pt solid silver;padding:2pt 4pt;text-align:start}th{font-weight:700}.n{direction:ltr;text-align:end}.total{font-size:13pt;font-weight:700}</style></head><body><h2>${escapeHtml(
      d.posFloorGuestCheck,
    )} · ${escapeHtml(check.checkNo)}</h2><p>${escapeHtml(d.posFloorCheckNo)}: ${escapeHtml(
      check.checkNo,
    )} · ${escapeHtml(d.posFloorOrderType)}: ${escapeHtml(localizedPosOrderType(d, check.orderType))} · ${escapeHtml(
      d.posFloorGuests,
    )}: ${check.guestCount}</p><table><thead><tr><th>${escapeHtml(
      d.posFloorLines,
    )}</th><th class="n">${escapeHtml(d.posCounterQty)}</th><th class="n">${escapeHtml(
      d.salesUnitPrice,
    )}</th><th class="n">${escapeHtml(d.salesTotalGross)}</th></tr></thead><tbody>${rows}</tbody></table><p class="total">${escapeHtml(
      d.posCounterTotal,
    )}: <span class="n">${escapeHtml(formatMoneyDisplay(checkTotal, 2))}</span></p><p>${escapeHtml(
      d.posCounterTaxNote,
    )}</p></body></html>`;
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.posFloorTitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {activeBranches.length > 0 && (
              <Select
                label={d.posFloorBranch}
                value={branchId}
                onValueChange={(value) => void loadBranch(value)}
                options={activeBranches.map((branch) => ({
                  value: branch.id,
                  label: localizedName(branch.name, branch.nameAr, locale),
                }))}
              />
            )}
            <Button variant="secondary" onClick={() => setAddTableDialog(true)} disabled={branchId === ""}>
              {d.posFloorAddTable}
            </Button>
          </div>
        }
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">{d.loading}</p>
        ) : zones.length === 0 || allTables.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.posFloorEmpty}</p>
        ) : (
          <div className="flex flex-col gap-6">
            {zones.map((zone) => (
              <section key={zone.zone} aria-label={localizedName(zone.zone, zone.zoneAr, locale)}>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">
                  {localizedName(zone.zone, zone.zoneAr, locale)}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {zone.tables.map((table) => (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => {
                        if (table.openCheckId !== null) {
                          const check = checks.find((candidate) => candidate.id === table.openCheckId);
                          if (check !== undefined) {
                            selectCheck(check);
                          }
                        } else if (table.status === "FREE") {
                          setOpenTable(table);
                        }
                      }}
                      className={`flex min-h-20 flex-col items-start gap-1 rounded-md border p-3 text-start hover:border-strong ${
                        table.openCheckId !== null || table.status === "OCCUPIED"
                          ? "border-warning-border bg-warning-bg text-warning-text"
                          : table.status === "FREE"
                            ? "border-success-border bg-success-bg text-success-text"
                            : "border-subtle bg-surface-sunken text-gray-500"
                      }`}
                    >
                      <span className="font-mono text-sm font-semibold" dir="ltr">
                        {table.label}
                      </span>
                      <span className="text-xs">
                        {table.openCheckId !== null || table.status === "OCCUPIED"
                          ? d.posFloorOccupied
                          : table.status === "FREE"
                            ? d.posFloorFree
                            : table.status}
                      </span>
                      <span className="font-mono text-xs" dir="ltr">
                        {d.posFloorSeats}: {table.seats}
                        {table.openCheckNo !== null ? ` · ${table.openCheckNo}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      {tablelessChecks.length > 0 && (
        <Card title={d.posFloorOpenChecks}>
          <div className="flex flex-wrap gap-2">
            {tablelessChecks.map((check) => (
              <button
                key={check.id}
                type="button"
                onClick={() => selectCheck(check)}
                className="flex min-h-11 items-center gap-2 rounded-md border border-default bg-surface-card px-3 py-2 text-start text-sm hover:border-strong"
              >
                <span className="font-mono text-xs" dir="ltr">
                  {check.checkNo}
                </span>
                <span>{localizedPosOrderType(d, check.orderType)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {selectedCheck !== null && (
        <Card
          title={`${d.posFloorCheckNo} ${selectedCheck.checkNo} · ${localizedPosOrderType(d, selectedCheck.orderType)}`}
          actions={<Badge tone="primary">{localizedPosCheckStatus(d, selectedCheck.status)}</Badge>}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <span>
                {d.posFloorGuests}: {selectedCheck.guestCount}
              </span>
              {selectedTable !== null && (
                <span className="font-mono" dir="ltr">
                  {d.posFloorTableLabel}: {selectedTable.label}
                </span>
              )}
              <span className="font-mono text-sm tabular-nums" dir="ltr">
                {d.posCounterTotal}: {formatMoneyDisplay(checkTotal, 2)}
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {draftLines.map((line, index) => (
                    <tr key={`${index}-${line.itemId}`} className="border-b border-subtle">
                      {splitMode && (
                        <td className="py-2 pe-2">
                          <Checkbox
                            aria-label={line.name}
                            checked={splitNos.has(index + 1)}
                            onCheckedChange={(checked) => {
                              setSplitNos((current) => {
                                const next = new Set(current);
                                if (checked === true) {
                                  next.add(index + 1);
                                } else {
                                  next.delete(index + 1);
                                }
                                return next;
                              });
                            }}
                          />
                        </td>
                      )}
                      <td className="py-2 pe-2 text-start">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {localizedName(line.name, line.nameAr, locale)}
                          </span>
                          {line.sentToKitchen ? (
                            <Badge tone="primary">{d.posFloorSent}</Badge>
                          ) : (
                            <Badge>{d.posFloorUnsent}</Badge>
                          )}
                        </div>
                        <div className="font-mono text-xs tabular-nums text-gray-600" dir="ltr">
                          {formatMoneyDisplay(line.unitPrice, 2)} × {line.qty}
                        </div>
                      </td>
                      <td className="py-2 pe-2">
                        {!splitMode && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setDraftLines((rows) =>
                                  rows.flatMap((candidate, i) => {
                                    if (i !== index) {
                                      return [candidate];
                                    }
                                    const next = stepQtyExact(candidate.qty, -1);
                                    return next === "0" ? [] : [{ ...candidate, qty: next }];
                                  }),
                                )
                              }
                            >
                              −
                            </Button>
                            <input
                              aria-label={d.posCounterQty}
                              className="w-16 rounded-md border border-default bg-surface-card px-2 py-1 text-center font-mono tabular-nums"
                              dir="ltr"
                              inputMode="decimal"
                              value={line.qty}
                              onChange={(event) =>
                                setDraftLines((rows) =>
                                  rows.map((candidate, i) => (i === index ? { ...candidate, qty: event.target.value } : candidate)),
                                )
                              }
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setDraftLines((rows) =>
                                  rows.map((candidate, i) =>
                                    i === index ? { ...candidate, qty: stepQtyExact(candidate.qty, 1) } : candidate,
                                  ),
                                )
                              }
                            >
                              +
                            </Button>
                          </div>
                        )}
                      </td>
                      <td className="py-2 pe-2 text-end font-mono tabular-nums text-gray-900" dir="ltr">
                        {formatMoneyDisplay(mulQtyPriceExact(line.qty, line.unitPrice), 2)}
                      </td>
                      <td className="py-2 text-end">
                        {!splitMode && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDraftLines((rows) => rows.filter((_, i) => i !== index))}
                          >
                            {d.posCounterRemove}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              {!splitMode && (
                <Select
                  label={d.posFloorAddItem}
                  value={addItem}
                  onValueChange={(value) => {
                    setAddItem("");
                    const item = sellableItems.find((candidate) => candidate.id === value);
                    if (item !== undefined) {
                      setDraftLines((rows) => [
                        ...rows,
                        {
                          itemId: item.id,
                          name: item.name,
                          nameAr: item.nameAr,
                          qty: "1",
                          unitPrice: item.basePrice ?? "0",
                          sentToKitchen: false,
                        },
                      ]);
                    }
                  }}
                  options={sellableItems.map((item) => ({
                    value: item.id,
                    label: `${localizedName(item.name, item.nameAr, locale)} · ${item.sku}`,
                  }))}
                  placeholder={d.posFloorAddItem}
                />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {!splitMode && (
                <Button variant="primary" loading={busy === "save-lines"} onClick={() => void saveLines()}>
                  {d.posFloorSaveLines}
                </Button>
              )}
              <Button variant="secondary" loading={busy === "kitchen"} onClick={() => void sendKitchenTicket()}>
                {d.posFloorKitchenSend}
              </Button>
              {!splitMode ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Split keys off the SAVED lines — reset unsaved edits first.
                    setDraftLines(draftLinesOf(selectedCheck));
                    setSplitMode(true);
                    setSplitNos(new Set());
                  }}
                  disabled={selectedCheck.lines.length < 2}
                >
                  {d.posFloorSplit}
                </Button>
              ) : (
                <>
                  <Button variant="secondary" loading={busy === "split"} onClick={() => void splitCheck()} disabled={splitNos.size === 0}>
                    {d.posFloorSplit}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSplitMode(false);
                      setSplitNos(new Set());
                    }}
                  >
                    {d.commonCancel}
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={() => setTransferDialog(true)} disabled={freeTables.length === 0}>
                {d.posFloorTransfer}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const html = buildGuestCheckHtml(selectedCheck);
                  setGuestCheckHtml(html);
                }}
              >
                {d.posFloorGuestCheck}
              </Button>
              <Button variant="primary" onClick={payCheck}>
                {d.posFloorPay}
              </Button>
              <Button variant="danger" onClick={() => setCancelDialog(true)}>
                {d.posFloorCancelCheck}
              </Button>
            </div>
            {splitMode && <p className="text-xs text-muted-foreground">{d.posFloorSplitHint}</p>}

            {tickets.length > 0 && (
              <div className="border-t border-subtle pt-3">
                <p className="mb-2 text-sm font-medium text-gray-900">{d.posFloorTickets}</p>
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                  {tickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs" dir="ltr">
                        {ticket.ticketNo}
                      </span>
                      <span className="text-xs text-gray-600">
                        {ticket.items.length} · {formatDateTime(ticket.printedAt, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* -- open-check dialog ---------------------------------------------------------- */}
      <Dialog
        open={openTable !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenTable(null);
          }
        }}
        title={`${d.posFloorOpenCheck} · ${openTable?.label ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <Select
            label={d.posFloorOrderType}
            value={orderType}
            onValueChange={(value) => {
              if (value === "DINE_IN" || value === "TAKEAWAY" || value === "DELIVERY" || value === "COUNTER") {
                setOrderType(value);
              }
            }}
            options={[
              { value: "DINE_IN", label: d.posFloorOrderDineIn },
              { value: "TAKEAWAY", label: d.posFloorOrderTakeaway },
              { value: "DELIVERY", label: d.posFloorOrderDelivery },
            ]}
          />
          <Input
            label={d.posFloorGuests}
            value={guestCount}
            onValueChange={setGuestCount}
            inputMode="numeric"
            mono
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpenTable(null)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" loading={busy === "open-check"} onClick={() => void openCheck()}>
              {d.posFloorOpenCheck}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- add-table dialog -------------------------------------------------------------- */}
      <Dialog open={addTableDialog} onOpenChange={setAddTableDialog} title={d.posFloorAddTable}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={d.posFloorZone} value={tableZone} onValueChange={setTableZone} mono bidiIsolate />
          <Input label={`${d.posFloorZone} (AR)`} value={tableZoneAr} onValueChange={setTableZoneAr} />
          <Input label={d.posFloorTableLabel} value={tableLabel} onValueChange={setTableLabel} mono bidiIsolate required />
          <Input label={d.posFloorSeats} value={tableSeats} onValueChange={setTableSeats} inputMode="numeric" mono />
          <Input label={d.posFloorSortKey} value={tableSortKey} onValueChange={setTableSortKey} inputMode="numeric" mono />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAddTableDialog(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "add-table"} onClick={() => void addTable()}>
            {d.posFloorAddTable}
          </Button>
        </div>
      </Dialog>

      {/* -- transfer dialog -------------------------------------------------------------- */}
      <Dialog open={transferDialog} onOpenChange={setTransferDialog} title={d.posFloorTransfer}>
        <div className="flex flex-col gap-3">
          <Select
            label={d.posFloorTransferTo}
            value={transferTarget}
            onValueChange={setTransferTarget}
            options={freeTables.map((table) => ({ value: table.id, label: table.label }))}
            placeholder="—"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTransferDialog(false)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={busy === "transfer"}
              disabled={transferTarget === ""}
              onClick={() => void transferCheck()}
            >
              {d.posFloorTransfer}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- guest-check preview ---------------------------------------------------------- */}
      <Dialog open={guestCheckHtml !== null} onOpenChange={() => setGuestCheckHtml(null)} title={d.posFloorGuestCheck} size="lg">
        <div className="flex flex-col gap-3">
          {guestCheckHtml !== null && (
            <iframe srcDoc={guestCheckHtml} title={d.posFloorGuestCheck} className="h-96 w-full rounded-md border border-subtle bg-white" />
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="primary"
              onClick={() => guestCheckHtml !== null && printHtmlDocument(guestCheckHtml)}
              disabled={guestCheckHtml === null}
            >
              {d.posReceiptPrint}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- cancel-check dialog ---------------------------------------------------------- */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog} title={d.posFloorCancelCheck}>
        <div className="flex flex-col gap-3">
          <Input label={d.posFloorCancelReason} value={cancelReason} onValueChange={setCancelReason} required />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelDialog(false)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="danger"
              loading={busy === "cancel-check"}
              disabled={cancelReason.trim() === ""}
              onClick={() => void cancelCheck()}
            >
              {d.posFloorCancelCheck}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
