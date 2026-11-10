"use client";

/**
 * PHASE-016 T4+T10 — the POS counter (the heart): terminal selector with the
 * open-shift badge (open/close dialogs with denomination grids — close is a
 * BLIND count), scan-to-add (SKU lookup among the loaded items, perf note),
 * the item grid, the cart with exact string math (ADR-0009 — preview only,
 * final tax computes at posting), the tender dialog (cash/card split, change
 * due), the receipt preview (server HTML in an iframe + print), the customer
 * picker (walk-in default), POS returns, and the offline outbox: offline
 * sales store locally with an OFF- number and PENDING_SYNC state, drain via
 * POST pos/sales when back online — never presented as posted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Dialog,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CashAccountRow,
  CreditNoteRow,
  ItemRow,
  PartnerRow,
  PosCheckRow,
  PosOrderType,
  PosOutboxEntry,
  PosReceiptRender,
  PosSaleResult,
  PosTerminalRow,
  SalesInvoiceRow,
  ShiftRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  compareExact,
  isPositiveDecimal,
  mulCountExact,
  mulQtyPriceExact,
  stepQtyExact,
  subtractExact,
  sumExact,
} from "../lib/exact-money";
import {
  formatMessage,
  localizedName,
  localizedPosError,
  localizedShiftStatus,
} from "../lib/messages";
import {
  consumePosOutboxEditClientId,
  consumePosPreload,
  nextOfflineReceiptNo,
  readPosOutbox,
  updatePosOutboxEntry,
  writePosOutbox,
} from "../lib/pos-outbox";
import { printHtmlDocument } from "../lib/print-frame";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const COUNT_RE = /^\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Common cash denominations (SAR note/coin ladder) — display order. */
const DENOMINATIONS: readonly string[] = ["500", "200", "100", "50", "20", "10", "5", "1", "0.5", "0.25"];

interface CartLine {
  key: string;
  itemId: string;
  name: string;
  nameAr: string | null;
  qty: string;
  unitPrice: string;
  sentToKitchen: boolean;
}

interface TenderDraft {
  method: "CASH" | "CARD";
  amount: string;
}

interface ReturnLineDraft {
  invoiceLineId: string;
  label: string;
  qtyMax: string;
  qty: string;
}

interface DenominationCount {
  denomination: string;
  count: string;
}

/** The per-line total + document total — exact string math, preview only. */
function lineTotalOf(line: CartLine): string {
  return mulQtyPriceExact(line.qty, line.unitPrice);
}

export function PosCounter({
  locale,
  terminals,
  items,
  customers,
  cashAccounts,
  recentInvoices,
  initialCheckId,
}: {
  locale: Locale;
  terminals: readonly PosTerminalRow[];
  items: readonly ItemRow[];
  customers: readonly PartnerRow[];
  cashAccounts: readonly CashAccountRow[];
  recentInvoices: readonly SalesInvoiceRow[];
  initialCheckId: string | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const activeTerminals = useMemo(() => terminals.filter((t) => t.status === "ACTIVE"), [terminals]);
  const [terminalId, setTerminalId] = useState(activeTerminals[0]?.id ?? "");
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [activeCheck, setActiveCheck] = useState<{ id: string; checkNo: string; orderType: PosOrderType } | null>(null);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanPerfMs, setScanPerfMs] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);
  const pendingCheckIdRef = useRef<string | null>(initialCheckId);

  // Dialogs.
  const [shiftOpenDialog, setShiftOpenDialog] = useState(false);
  const [shiftCloseDialog, setShiftCloseDialog] = useState(false);
  const [customerDialog, setCustomerDialog] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [tenderDialog, setTenderDialog] = useState(false);
  const [returnDialog, setReturnDialog] = useState(false);

  // Shift-open dialog state.
  const [openingAmount, setOpeningAmount] = useState("0");
  const [openDenoms, setOpenDenoms] = useState<DenominationCount[]>(
    DENOMINATIONS.map((denomination) => ({ denomination, count: "" })),
  );

  // Shift-close dialog state (blind count + supervisor when the server asks).
  const [closeDenoms, setCloseDenoms] = useState<DenominationCount[]>(
    DENOMINATIONS.map((denomination) => ({ denomination, count: "" })),
  );
  const [supervisorAsked, setSupervisorAsked] = useState(false);
  const [supervisorId, setSupervisorId] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [closeReason, setCloseReason] = useState("");

  // Tender dialog state.
  const [tenderRows, setTenderRows] = useState<TenderDraft[]>([]);

  // Sale result + receipt.
  const [saleResult, setSaleResult] = useState<
    | { kind: "POSTED"; invoice: SalesInvoiceRow }
    | { kind: "PENDING_SYNC"; offlineReceiptNo: string }
    | null
  >(null);
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  // Returns dialog state.
  const [returnInvoiceRef, setReturnInvoiceRef] = useState("");
  const [returnInvoiceId, setReturnInvoiceId] = useState<string | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLineDraft[]>([]);
  const [returnReason, setReturnReason] = useState("");
  const [returnNote, setReturnNote] = useState("");

  // Offline outbox + connectivity.
  const [outbox, setOutbox] = useState<PosOutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const drainingRef = useRef(false);

  const terminal = terminals.find((t) => t.id === terminalId) ?? null;
  const currency =
    cashAccounts.find((account) => account.id === terminal?.cashAccountId)?.currencyCode ?? "SAR";

  const sellableItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === "ACTIVE" && item.deletedAt === null && item.basePrice !== null && item.basePrice !== "",
      ),
    [items],
  );

  const total = useMemo(() => sumExact(lines.map(lineTotalOf)), [lines]);
  const customerName = useMemo(() => {
    if (customerId === null) {
      return d.posCounterWalkIn;
    }
    const partner = customers.find((candidate) => candidate.id === customerId);
    return partner === undefined ? customerId : localizedName(partner.name, partner.nameAr, locale);
  }, [customerId, customers, d.posCounterWalkIn, locale]);

  const tenderSum = useMemo(
    () => sumExact(tenderRows.map((row) => (MONEY_RE.test(row.amount) ? row.amount : "0"))),
    [tenderRows],
  );
  const changeDue = compareExact(tenderSum, total) >= 0 ? subtractExact(tenderSum, total) : "0";
  const tenderRemaining = compareExact(total, tenderSum) >= 0 ? subtractExact(total, tenderSum) : "0";

  const openCountedTotal = useMemo(
    () =>
      sumExact(
        openDenoms
          .filter((row) => COUNT_RE.test(row.count) && row.count !== "0")
          .map((row) => mulCountExact(row.denomination, row.count)),
      ),
    [openDenoms],
  );
  const closeCountedTotal = useMemo(
    () =>
      sumExact(
        closeDenoms
          .filter((row) => COUNT_RE.test(row.count) && row.count !== "0")
          .map((row) => mulCountExact(row.denomination, row.count)),
      ),
    [closeDenoms],
  );

  const customersOnly = useMemo(
    () => customers.filter((partner) => partner.kind === "CUSTOMER" || partner.kind === "BOTH"),
    [customers],
  );
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (query === "") {
      return customersOnly;
    }
    return customersOnly.filter(
      (partner) =>
        partner.name.toLowerCase().includes(query) ||
        (partner.nameAr ?? "").includes(query) ||
        partner.code.toLowerCase().includes(query),
    );
  }, [customerSearch, customersOnly]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === "") {
      return sellableItems;
    }
    return sellableItems.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        (item.nameAr ?? "").toLowerCase().includes(query) ||
        item.sku.toLowerCase().includes(query),
    );
  }, [search, sellableItems]);

  // -- offline plumbing -------------------------------------------------------------

  /** One queued-sale submit: POST pos/sales with the OFF- provenance. */
  const submitQueuedSale = useCallback(
    async (
      entry: PosOutboxEntry,
    ): Promise<{ ok: true } | { ok: false; offline: boolean; code: string; message: string }> => {
      const result = await bffFetch<PosSaleResult>("pos/sales", {
        method: "POST",
        body: {
          terminalId: entry.terminalId,
          customerId: entry.sale.customerId,
          lines: entry.sale.lines,
          tenders: entry.sale.tenders,
          orderType: entry.sale.orderType,
          checkId: entry.sale.checkId ?? null,
          offlineReceiptNo: entry.offlineReceiptNo,
        },
      });
      if (result.ok) {
        return { ok: true };
      }
      return { ok: false, offline: result.status === 0, code: result.error.code, message: result.error.message };
    },
    [],
  );

  const drainOutbox = useCallback(async (): Promise<void> => {
    if (drainingRef.current || !navigator.onLine) {
      return;
    }
    drainingRef.current = true;
    let syncedCount = 0;
    try {
      const entries = readPosOutbox();
      for (const entry of entries) {
        if (entry.status !== "PENDING_SYNC" || entry.kept) {
          continue;
        }
        const outcome = await submitQueuedSale(entry);
        if (!outcome.ok && outcome.offline) {
          break; // connectivity dropped again — keep the remaining order
        }
        if (outcome.ok) {
          syncedCount += 1;
          updatePosOutboxEntry({ ...entry, status: "SYNCED", rejection: undefined });
        } else {
          // The typed rejection reason rides the error code (SYNC_PROTOCOL §11).
          updatePosOutboxEntry({
            ...entry,
            status: "REJECTED",
            rejection: { reason: outcome.code, message: outcome.message },
          });
        }
      }
      setOutbox([...readPosOutbox()]);
      if (syncedCount > 0) {
        setNotice(formatMessage(d.posOfflineSyncedToast, { n: syncedCount }));
      }
    } finally {
      drainingRef.current = false;
    }
  }, [d, submitQueuedSale]);

  // Mount: outbox + connectivity + preload hand-offs.
  useEffect(() => {
    setOutbox(readPosOutbox());
    setOnline(navigator.onLine);
    const goOnline = (): void => {
      setOnline(true);
      void drainOutbox();
    };
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [drainOutbox]);

  // Mount: "Edit & resend" hand-off (a rejected queued sale re-opened).
  useEffect(() => {
    const clientId = consumePosOutboxEditClientId();
    if (clientId === null) {
      return;
    }
    const entry = readPosOutbox().find((candidate) => candidate.clientId === clientId);
    if (entry === undefined) {
      return;
    }
    setEditingClientId(clientId);
    setTerminalId(entry.terminalId);
    setLines(
      entry.sale.lines.map((line, index) => ({
        key: `edit-${index}-${line.itemId}`,
        itemId: line.itemId,
        name: line.description ?? line.itemId,
        nameAr: line.descriptionAr ?? null,
        qty: line.qty,
        unitPrice: line.unitPrice,
        sentToKitchen: false,
      })),
    );
    setCustomerId(entry.sale.customerId);
  }, []);

  // Terminal change → open-shift badge (+ pending check resolution).
  useEffect(() => {
    if (terminalId === "") {
      setShift(null);
      return;
    }
    let cancelled = false;
    setShiftBusy(true);
    void bffFetch<ShiftRow | null>(`pos/terminals/${terminalId}/shift`).then((result) => {
      if (cancelled) {
        return;
      }
      setShiftBusy(false);
      // No open shift arrives as a 200 without a data member (envelope drops
      // undefined) — that is the "null" answer, not an error.
      if (result.ok) {
        setShift(result.data ?? null);
      } else if (result.status === 200) {
        setShift(null);
      } else {
        setShift(null);
        setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [d, terminalId]);

  // Pending check (floor → counter "Pay" without the sessionStorage payload).
  useEffect(() => {
    const checkId = pendingCheckIdRef.current;
    if (checkId === null || terminal === null || activeCheck !== null) {
      return;
    }
    const preload = consumePosPreload(checkId);
    if (preload !== null) {
      pendingCheckIdRef.current = null;
      setActiveCheck({ id: preload.checkId, checkNo: preload.checkNo, orderType: preload.orderType });
      setLines(
        preload.lines.map((line, index) => ({
          key: `check-${index}-${line.itemId}`,
          itemId: line.itemId,
          name: line.name,
          nameAr: line.nameAr,
          qty: line.qty,
          unitPrice: line.unitPrice,
          sentToKitchen: line.sentToKitchen,
        })),
      );
      return;
    }
    // Fallback: resolve through the branch's OPEN checks list.
    let cancelled = false;
    void bffFetch<readonly PosCheckRow[]>(`pos/checks?branchId=${terminal.branchId}&status=OPEN`).then((result) => {
      if (cancelled || !result.ok) {
        return;
      }
      const check = result.data.find((candidate) => candidate.id === checkId);
      if (check === undefined) {
        return;
      }
      pendingCheckIdRef.current = null;
      setActiveCheck({ id: check.id, checkNo: check.checkNo, orderType: check.orderType });
      setLines(
        check.lines.map((line, index) => ({
          key: `check-${index}-${line.itemId}`,
          itemId: line.itemId,
          name: line.name,
          nameAr: line.nameAr,
          qty: line.qty,
          unitPrice: line.unitPrice,
          sentToKitchen: line.sentToKitchen,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeCheck, terminal]);

  // -- cart actions -------------------------------------------------------------------

  function addItem(item: ItemRow): void {
    setError(null);
    setNotice(null);
    const price = item.basePrice ?? "0";
    setLines((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (existing !== undefined) {
        return current.map((line) =>
          line.itemId === item.id ? { ...line, qty: stepQtyExact(line.qty, 1) } : line,
        );
      }
      return [
        ...current,
        {
          key: `${item.id}-${Date.now()}`,
          itemId: item.id,
          name: item.name,
          nameAr: item.nameAr,
          qty: "1",
          unitPrice: price,
          sentToKitchen: false,
        },
      ];
    });
  }

  function stepLine(key: string, delta: 1 | -1): void {
    setLines((current) =>
      current.flatMap((line) => {
        if (line.key !== key) {
          return [line];
        }
        const next = stepQtyExact(line.qty, delta);
        return next === "0" ? [] : [{ ...line, qty: next }];
      }),
    );
  }

  function setLineQty(key: string, qty: string): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, qty } : line)));
  }

  function onScan(): Promise<void> {
    const code = scanValue.trim();
    if (code === "") {
      return Promise.resolve();
    }
    const startedAt = performance.now();
    const item = sellableItems.find(
      (candidate) => candidate.sku.toLowerCase() === code.toLowerCase(),
    );
    // lastScanAt perf note (raw ms — display only, never money).
    const elapsed = performance.now() - startedAt;
    setScanPerfMs(elapsed >= 1 ? elapsed : 1);
    setScanValue("");
    scanRef.current?.focus();
    if (item === undefined) {
      setError(d.posCounterScanNotFound);
      return Promise.resolve();
    }
    setError(null);
    addItem(item);
    return Promise.resolve();
  }

  // -- sale flow ----------------------------------------------------------------------

  function startPayment(): void {
    setError(null);
    setNotice(null);
    if (terminal === null) {
      setError(d.posCounterErrTerminalRequired);
      return;
    }
    if (terminal.status !== "ACTIVE") {
      setError(d.posCounterErrTerminalInactive);
      return;
    }
    if (
      lines.length === 0 ||
      lines.some((line) => !QTY_RE.test(line.qty) || !isPositiveDecimal(line.unitPrice))
    ) {
      setError(d.posCounterErrCartEmpty);
      return;
    }
    setTenderRows([{ method: "CASH", amount: total }]);
    setTenderDialog(true);
  }

  function queueOfflineSale(tenders: readonly TenderDraft[]): void {
    if (terminal === null) {
      return;
    }
    const salePayload = {
      customerId,
      orderType: (activeCheck?.orderType ?? "COUNTER") as PosOrderType,
      checkId: activeCheck?.id ?? null,
      lines: lines.map((line) => ({
        itemId: line.itemId,
        description: line.name,
        descriptionAr: line.nameAr,
        qty: line.qty,
        unitPrice: line.unitPrice,
      })),
      tenders: tenders.map((row) => ({ method: row.method, amount: row.amount })),
    };
    if (editingClientId !== null) {
      // Edit & resend while offline: keep the SAME OFF- number, update the payload.
      const existing = outbox.find((entry) => entry.clientId === editingClientId);
      if (existing !== undefined) {
        updatePosOutboxEntry({ ...existing, sale: salePayload, status: "PENDING_SYNC" });
        setOutbox([...readPosOutbox()]);
      }
      setTenderDialog(false);
      setSaleResult({ kind: "PENDING_SYNC", offlineReceiptNo: existing?.offlineReceiptNo ?? "" });
      setLines([]);
      setActiveCheck(null);
      setEditingClientId(null);
      setNotice(d.posReceiptOfflineNote);
      return;
    }
    const { offlineReceiptNo, clientId } = nextOfflineReceiptNo(terminal.code);
    const entry: PosOutboxEntry = {
      clientId,
      offlineReceiptNo,
      terminalId: terminal.id,
      terminalCode: terminal.code,
      createdAt: new Date().toISOString(),
      status: "PENDING_SYNC",
      kept: false,
      sale: salePayload,
    };
    const entries = [...readPosOutbox(), entry];
    writePosOutbox(entries);
    setOutbox([...entries]);
    setTenderDialog(false);
    setSaleResult({ kind: "PENDING_SYNC", offlineReceiptNo });
    setLines([]);
    setActiveCheck(null);
    setNotice(formatMessage(d.posCounterOfflineQueued, { no: offlineReceiptNo }));
  }

  async function confirmTender(): Promise<void> {
    if (terminal === null || tenderRows.length === 0) {
      return;
    }
    const invalid = tenderRows.some((row) => !MONEY_RE.test(row.amount) || row.amount === "0");
    if (invalid) {
      setError(d.posTenderErrInvalid);
      return;
    }
    if (compareExact(tenderSum, total) < 0) {
      setError(d.posTenderErrUnderpaid);
      return;
    }
    const tenders = tenderRows.map((row) => ({ method: row.method, amount: row.amount }));
    if (!online) {
      queueOfflineSale(tenders);
      return;
    }
    setBusy("tender");
    setError(null);
    const editingEntry = editingClientId === null ? null : outbox.find((e) => e.clientId === editingClientId) ?? null;
    const result = await bffFetch<PosSaleResult>("pos/sales", {
      method: "POST",
      body: {
        terminalId: terminal.id,
        customerId,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          description: line.name,
          descriptionAr: line.nameAr,
          qty: line.qty,
          unitPrice: line.unitPrice,
        })),
        tenders,
        orderType: activeCheck?.orderType ?? "COUNTER",
        checkId: activeCheck?.id ?? null,
        offlineReceiptNo: editingEntry === null ? null : editingEntry.offlineReceiptNo,
      },
    });
    setBusy(null);
    if (!result.ok && result.status === 0) {
      // The request never completed — queue with an OFF- number (T10).
      queueOfflineSale(tenders);
      return;
    }
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    // A rejected sale edited & resent through this path is now synced.
    if (editingEntry !== null) {
      updatePosOutboxEntry({ ...editingEntry, status: "SYNCED", rejection: undefined });
      setOutbox([...readPosOutbox()]);
      setEditingClientId(null);
    }
    setTenderDialog(false);
    setSaleResult({ kind: "POSTED", invoice: result.data.invoice });
    setLines([]);
    setActiveCheck(null);
    setNotice(formatMessage(d.posCounterSalePosted, { no: result.data.invoice.invoiceNo ?? "" }));
    // Receipt preview (same HTML the renderer prints).
    setReceiptLoading(true);
    setReceiptHtml(null);
    const receipt = await bffFetch<PosReceiptRender>(
      `pos/invoices/${result.data.invoice.id}/receipt?locale=${locale}`,
    );
    setReceiptLoading(false);
    if (receipt.ok) {
      setReceiptHtml(receipt.data.html);
    }
  }

  function newSale(): void {
    setSaleResult(null);
    setReceiptHtml(null);
    setEditingClientId(null);
    setLines([]);
    setActiveCheck(null);
    scanRef.current?.focus();
  }

  // -- shift dialogs ------------------------------------------------------------------

  async function openShift(): Promise<void> {
    if (terminal === null) {
      return;
    }
    const amount =
      openDenoms.some((row) => COUNT_RE.test(row.count) && row.count !== "0") && openCountedTotal !== "0.0000"
        ? openCountedTotal
        : openingAmount === ""
          ? "0"
          : openingAmount;
    if (!MONEY_RE.test(amount)) {
      setError(d.posTenderErrInvalid);
      return;
    }
    setBusy("shift-open");
    setError(null);
    const denominations: Record<string, string> = {};
    for (const row of openDenoms) {
      if (COUNT_RE.test(row.count) && row.count !== "0" && row.count !== "") {
        denominations[row.denomination] = row.count;
      }
    }
    const result = await bffFetch<{ shift: ShiftRow; alreadyOpen: boolean }>(
      `pos/terminals/${terminal.id}/shift/open`,
      {
        method: "POST",
        body: { openingAmount: amount, denominations },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setShift(result.data.shift);
    setShiftOpenDialog(false);
    if (result.data.alreadyOpen) {
      setNotice(d.posShiftAlreadyOpen);
    } else {
      setNotice(formatMessage(d.posShiftOpenedToast, { no: result.data.shift.shiftNo ?? "" }));
    }
  }

  async function closeShift(): Promise<void> {
    if (terminal === null || shift === null) {
      return;
    }
    const denominations: Record<string, string> = {};
    for (const row of closeDenoms) {
      if (COUNT_RE.test(row.count) && row.count !== "0" && row.count !== "") {
        denominations[row.denomination] = row.count;
      }
    }
    setBusy("shift-close");
    setError(null);
    const result = await bffFetch<ShiftRow>(`pos/terminals/${terminal.id}/shift/close`, {
      method: "POST",
      body: {
        shiftId: shift.id,
        denominations,
        reason: closeReason.trim() === "" ? undefined : closeReason.trim(),
        supervisorId: supervisorId.trim() === "" ? undefined : supervisorId.trim(),
        supervisorPin: supervisorPin.trim() === "" ? undefined : supervisorPin.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      if (result.error.code === "SHIFT_SUPERVISOR_REQUIRED") {
        setSupervisorAsked(true);
        setError(d.posShiftSupervisorRequired);
      } else {
        setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      }
      return;
    }
    setShift(null);
    setShiftCloseDialog(false);
    setSupervisorAsked(false);
    setSupervisorId("");
    setSupervisorPin("");
    setCloseReason("");
    setCloseDenoms(DENOMINATIONS.map((denomination) => ({ denomination, count: "" })));
    setNotice(formatMessage(d.posShiftClosedToast, { no: result.data.shiftNo ?? "" }));
  }

  // -- returns ------------------------------------------------------------------------

  async function loadReturnInvoice(): Promise<void> {
    setError(null);
    const reference = returnInvoiceRef.trim();
    if (reference === "") {
      return;
    }
    setBusy("return-load");
    let invoiceId = UUID_RE.test(reference) ? reference : null;
    if (invoiceId === null) {
      const byNo = recentInvoices.find(
        (invoice) => invoice.invoiceNo?.toLowerCase() === reference.toLowerCase(),
      );
      invoiceId = byNo?.id ?? null;
    }
    if (invoiceId === null) {
      setBusy(null);
      setError(d.posReturnErrInvoice);
      return;
    }
    const result = await bffFetch<SalesInvoiceRow & { lines: { id: string; description: string | null; descriptionAr: string | null; itemId: string | null; qty: string }[] }>(
      `sales/sales-invoices/${invoiceId}`,
    );
    setBusy(null);
    if (!result.ok) {
      setError(d.posReturnErrInvoice);
      return;
    }
    setReturnInvoiceId(result.data.id);
    setReturnLines(
      result.data.lines.map((line) => ({
        invoiceLineId: line.id,
        label:
          line.description ??
          (line.itemId !== null ? sellableItems.find((item) => item.id === line.itemId)?.name ?? line.itemId : line.id),
        qtyMax: line.qty,
        qty: "0",
      })),
    );
  }

  async function submitReturn(): Promise<void> {
    if (terminal === null || returnInvoiceId === null) {
      return;
    }
    const picked = returnLines.filter((line) => QTY_RE.test(line.qty) && line.qty !== "0");
    if (picked.length === 0) {
      setError(d.posReturnErrNoLines);
      return;
    }
    setBusy("return-submit");
    setError(null);
    const result = await bffFetch<CreditNoteRow>("pos/sales/returns", {
      method: "POST",
      body: {
        terminalId: terminal.id,
        invoiceId: returnInvoiceId,
        lines: picked.map((line) => ({
          invoiceLineId: line.invoiceLineId,
          qty: line.qty,
          reason: returnReason.trim() === "" ? undefined : returnReason.trim(),
        })),
        note: returnNote.trim() === "" ? undefined : returnNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setReturnDialog(false);
    setReturnInvoiceRef("");
    setReturnInvoiceId(null);
    setReturnLines([]);
    setReturnReason("");
    setReturnNote("");
    setNotice(formatMessage(d.posReturnPosted, { no: result.data.noteNo ?? "" }));
  }

  // -- outbox row actions ---------------------------------------------------------------

  async function retryEntry(entry: PosOutboxEntry): Promise<void> {
    updatePosOutboxEntry({ ...entry, status: "PENDING_SYNC", kept: false, rejection: undefined });
    setOutbox([...readPosOutbox()]);
    await drainOutbox();
  }

  function keepEntry(entry: PosOutboxEntry): void {
    updatePosOutboxEntry({ ...entry, kept: true });
    setOutbox([...readPosOutbox()]);
  }

  function removeEntry(clientId: string): void {
    writePosOutbox(readPosOutbox().filter((entry) => entry.clientId !== clientId));
    setOutbox([...readPosOutbox()]);
  }

  // -- render ---------------------------------------------------------------------------

  const pendingCount = outbox.filter((entry) => entry.status === "PENDING_SYNC" && !entry.kept).length;

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {!online && (
        <div role="status" className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text">
          {d.posOfflineBanner}
        </div>
      )}

      {terminals.length === 0 ? (
        <Card title={d.posCounterTitle}>
          <p className="text-sm text-gray-700">{d.posCounterNoTerminals}</p>
          <a
            href={`/${locale}/pos/terminals`}
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-3 text-sm font-medium text-gray-800 hover:border-strong"
          >
            {d.posCounterRegisterTerminal}
          </a>
        </Card>
      ) : (
        <>
          <Card title={d.posCounterTitle}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56">
                <Select
                  label={d.posCounterTerminalLabel}
                  value={terminalId}
                  onValueChange={setTerminalId}
                  options={activeTerminals.map((t) => ({
                    value: t.id,
                    label: `${t.code} · ${localizedName(t.name, t.nameAr, locale)}`,
                  }))}
                />
              </div>
              <div className="flex min-h-11 items-center gap-2">
                {shiftBusy ? (
                  <span className="text-sm text-muted-foreground">{d.loading}</span>
                ) : shift !== null ? (
                  <>
                    <Badge tone="primary" mono bidiIsolate>
                      {d.posCounterShiftOpen} · {shift.shiftNo ?? shift.id.slice(0, 8)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {localizedShiftStatus(d, shift.status)}
                    </span>
                  </>
                ) : (
                  <Badge>{d.posCounterShiftNone}</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {shift === null ? (
                  <Button variant="secondary" onClick={() => setShiftOpenDialog(true)} disabled={terminalId === ""}>
                    {d.posCounterOpenShiftBtn}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setShiftCloseDialog(true)}>
                    {d.posCounterCloseShiftBtn}
                  </Button>
                )}
                <a
                  href={`/${locale}/pos/reconciliation`}
                  className="inline-flex min-h-11 items-center rounded-md border border-default bg-surface-card px-3 text-sm font-medium text-gray-800 hover:border-strong"
                >
                  {d.posCounterZReportLink}
                </a>
                <Button variant="secondary" onClick={() => setCustomerDialog(true)}>
                  {d.posCounterCustomer}: {customerName}
                </Button>
                <Button variant="secondary" onClick={() => setReturnDialog(true)} disabled={terminalId === ""}>
                  {d.posCounterReturnBtn}
                </Button>
              </div>
            </div>
            {activeCheck !== null && (
              <p className="mt-3 text-sm text-info-text">
                {formatMessage(d.posCounterPreloadedCheck, { no: activeCheck.checkNo })}
              </p>
            )}
            {editingClientId !== null && (
              <p className="mt-3 text-sm text-warning-text">{d.posOfflineEditResend}</p>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={d.posCounterItemsTitle}>
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                    {d.posCounterScanLabel}
                    <input
                      ref={scanRef}
                      autoFocus
                      value={scanValue}
                      onChange={(event) => setScanValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void onScan();
                        }
                      }}
                      placeholder={d.posCounterScanPlaceholder}
                      aria-label={d.posCounterScanLabel}
                      className="w-full rounded-md border border-default bg-surface-card px-3 py-2 font-mono text-sm text-gray-900 outline-none placeholder:font-sans placeholder:text-gray-400 hover:border-strong focus:border-primary-600"
                    />
                  </label>
                  <Input
                    label={d.posCounterSearchPlaceholder}
                    value={search}
                    onValueChange={setSearch}
                  />
                </div>
                {scanPerfMs !== null && (
                  <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {formatMessage(d.posCounterScanPerf, { ms: scanPerfMs.toFixed(1) })}
                  </p>
                )}
                {filteredItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{d.posCounterItemsEmpty}</p>
                ) : (
                  <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {filteredItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addItem(item)}
                        className="flex min-h-11 flex-col items-start gap-1 rounded-md border border-default bg-surface-card p-3 text-start hover:border-strong"
                      >
                        <span className="text-sm font-medium text-gray-900">
                          {localizedName(item.name, item.nameAr, locale)}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-gray-600" dir="ltr">
                          {item.sku} · {formatMoneyDisplay(item.basePrice ?? "0", 2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card title={d.posCounterCartTitle}>
              <div className="flex flex-col gap-3">
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{d.posCounterCartEmpty}</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {lines.map((line) => (
                          <tr key={line.key} className="border-b border-subtle">
                            <td className="py-2 pe-2 text-start">
                              <div className="font-medium text-gray-900">
                                {localizedName(line.name, line.nameAr, locale)}
                              </div>
                              <div className="font-mono text-xs tabular-nums text-gray-600" dir="ltr">
                                {formatMoneyDisplay(line.unitPrice, 2)} × {line.qty}
                              </div>
                            </td>
                            <td className="py-2 pe-2">
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="secondary" onClick={() => stepLine(line.key, -1)}>
                                  −
                                </Button>
                                <input
                                  aria-label={d.posCounterQty}
                                  className="w-16 rounded-md border border-default bg-surface-card px-2 py-1 text-center font-mono tabular-nums"
                                  dir="ltr"
                                  inputMode="decimal"
                                  value={line.qty}
                                  onChange={(event) => setLineQty(line.key, event.target.value)}
                                />
                                <Button size="sm" variant="secondary" onClick={() => stepLine(line.key, 1)}>
                                  +
                                </Button>
                              </div>
                            </td>
                            <td className="py-2 pe-2 text-end font-mono tabular-nums text-gray-900" dir="ltr">
                              {formatMoneyDisplay(lineTotalOf(line), 2)}
                            </td>
                            <td className="py-2 text-end">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                              >
                                {d.posCounterRemove}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{d.posCounterTotal}</p>
                    <p className="font-mono text-2xl font-semibold tabular-nums text-gray-900" dir="ltr">
                      {formatMoneyDisplay(total, 2)}
                    </p>
                    <p className="text-xs text-muted-foreground">{d.posCounterTaxNote}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setLines([])} disabled={lines.length === 0}>
                      {d.posCounterClearBtn}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={startPayment}
                      disabled={lines.length === 0 || terminalId === ""}
                    >
                      {d.posCounterPayBtn}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {saleResult !== null && (
            <Card title={saleResult.kind === "POSTED" ? d.posReceiptTitle : d.posOfflineLocalReceiptTitle}>
              {saleResult.kind === "POSTED" ? (
                <div className="flex flex-col gap-3">
                  {receiptLoading && <p className="text-sm text-muted-foreground">{d.posReceiptLoading}</p>}
                  {!receiptLoading && receiptHtml === null && <ErrorNotice>{d.posReceiptErrLoad}</ErrorNotice>}
                  {receiptHtml !== null && (
                    <iframe
                      srcDoc={receiptHtml}
                      title={d.posReceiptTitle}
                      className="h-96 w-full rounded-md border border-subtle bg-white"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      onClick={() => receiptHtml !== null && printHtmlDocument(receiptHtml)}
                      disabled={receiptHtml === null}
                    >
                      {d.posReceiptPrint}
                    </Button>
                    <Button variant="secondary" onClick={newSale}>
                      {d.posCounterNewSale}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <InfoNotice>
                    {d.posReceiptOfflineNote} · <span className="font-mono">{saleResult.offlineReceiptNo}</span>
                  </InfoNotice>
                  <Button variant="secondary" onClick={newSale} className="self-start">
                    {d.posCounterNewSale}
                  </Button>
                </div>
              )}
            </Card>
          )}

          {outbox.length > 0 && (
            <Card
              title={formatMessage(d.posOfflineQueue, { n: pendingCount })}
              actions={
                <Button variant="secondary" onClick={() => void drainOutbox()} disabled={!online || pendingCount === 0}>
                  {d.posOfflineSyncNow}
                </Button>
              }
            >
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {outbox.map((entry) => (
                      <tr key={entry.clientId} className="border-b border-subtle">
                        <td className="py-2 pe-2 font-mono text-xs" dir="ltr">
                          {entry.offlineReceiptNo}
                        </td>
                        <td className="py-2 pe-2 font-mono text-xs tabular-nums text-gray-600" dir="ltr">
                          {formatMoneyDisplay(
                            sumExact(entry.sale.lines.map((line) => mulQtyPriceExact(line.qty, line.unitPrice))),
                            2,
                          )}
                        </td>
                        <td className="py-2 pe-2">
                          {entry.status === "SYNCED" ? (
                            <Badge tone="primary">{d.posOfflineSynced}</Badge>
                          ) : entry.status === "REJECTED" ? (
                            <Badge>{entry.kept ? d.posOfflineKept : d.posOfflineRejected}</Badge>
                          ) : (
                            <Badge>{entry.kept ? d.posOfflineKept : d.posOfflinePendingSync}</Badge>
                          )}
                        </td>
                        <td className="py-2 text-end">
                          <div className="flex flex-wrap justify-end gap-1">
                            {entry.status !== "SYNCED" && (
                              <Button size="sm" variant="secondary" onClick={() => void retryEntry(entry)}>
                                {d.posOfflineRetry}
                              </Button>
                            )}
                            {entry.status === "REJECTED" && !entry.kept && (
                              <Button size="sm" variant="secondary" onClick={() => keepEntry(entry)}>
                                {d.posOfflineKeep}
                              </Button>
                            )}
                            {(entry.status === "SYNCED" || entry.kept) && (
                              <Button size="sm" variant="secondary" onClick={() => removeEntry(entry.clientId)}>
                                {d.posOfflineRemove}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* -- shift open dialog ------------------------------------------------------- */}
      <Dialog
        open={shiftOpenDialog}
        onOpenChange={setShiftOpenDialog}
        title={formatMessage(d.posShiftOpenTitle, { terminal: terminal?.code ?? "" })}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <MoneyInput
            label={d.posShiftOpeningAmount}
            amount={openingAmount}
            onAmountChange={setOpeningAmount}
            currency={currency}
          />
          <DenominationGrid
            caption={`${d.posShiftDenominations} — ${d.posShiftCountedTotal}: ${formatMoneyDisplay(openCountedTotal, 2)}`}
            denominationLabel={d.posShiftDenomination}
            countLabel={d.posShiftCount}
            rows={openDenoms}
            onChange={setOpenDenoms}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShiftOpenDialog(false)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" loading={busy === "shift-open"} onClick={() => void openShift()}>
              {d.posShiftOpenAction}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- shift close dialog (blind count) ---------------------------------------- */}
      <Dialog open={shiftCloseDialog} onOpenChange={setShiftCloseDialog} title={d.posShiftCloseTitle} size="lg">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{d.posShiftBlindNote}</p>
          <DenominationGrid
            caption={`${d.posShiftDenominations} — ${d.posShiftCountedTotal}: ${formatMoneyDisplay(closeCountedTotal, 2)}`}
            denominationLabel={d.posShiftDenomination}
            countLabel={d.posShiftCount}
            rows={closeDenoms}
            onChange={setCloseDenoms}
          />
          {supervisorAsked && (
            <div className="grid gap-3 rounded-md border border-warning-border bg-warning-bg p-3 sm:grid-cols-2">
              <Input label={d.treasuryShiftSupervisor} value={supervisorId} onValueChange={setSupervisorId} />
              <Input
                label={d.treasuryShiftSupervisorPin}
                value={supervisorPin}
                onValueChange={setSupervisorPin}
                type="password"
                mono
                bidiIsolate
              />
              <div className="sm:col-span-2">
                <Input label={d.treasuryShiftReason} value={closeReason} onValueChange={setCloseReason} />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShiftCloseDialog(false)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" loading={busy === "shift-close"} onClick={() => void closeShift()}>
              {d.posShiftCloseAction}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- customer dialog ----------------------------------------------------------- */}
      <Dialog open={customerDialog} onOpenChange={setCustomerDialog} title={d.posCounterPickCustomer}>
        <div className="flex flex-col gap-3">
          <Input
            label={d.posCounterCustomerSearch}
            value={customerSearch}
            onValueChange={setCustomerSearch}
          />
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                setCustomerId(null);
                setCustomerDialog(false);
              }}
              className="flex min-h-11 w-full items-center justify-between rounded-md border border-default bg-surface-card px-3 py-2 text-start text-sm hover:border-strong"
            >
              {d.posCounterWalkIn}
            </button>
            {filteredCustomers.map((partner) => (
              <button
                key={partner.id}
                type="button"
                onClick={() => {
                  setCustomerId(partner.id);
                  setCustomerDialog(false);
                }}
                className="mt-1 flex min-h-11 w-full items-center justify-between rounded-md border border-default bg-surface-card px-3 py-2 text-start text-sm hover:border-strong"
              >
                <span>{localizedName(partner.name, partner.nameAr, locale)}</span>
                <span className="font-mono text-xs text-gray-600" dir="ltr">
                  {partner.code}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Dialog>

      {/* -- tender dialog --------------------------------------------------------------- */}
      <Dialog open={tenderDialog} onOpenChange={setTenderDialog} title={d.posTenderTitle} size="lg">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-subtle bg-surface-sunken p-3">
            <div>
              <p className="text-sm text-muted-foreground">{d.posCounterTotal}</p>
              <p className="font-mono text-xl font-semibold tabular-nums text-gray-900" dir="ltr">
                {formatMoneyDisplay(total, 2)}
              </p>
            </div>
            <div className="text-end">
              <p className="text-sm text-muted-foreground">{d.posTenderRemaining}</p>
              <p className="font-mono text-lg tabular-nums text-gray-900" dir="ltr">
                {formatMoneyDisplay(tenderRemaining, 2)}
              </p>
            </div>
            {changeDue !== "0.0000" && (
              <div className="text-end">
                <p className="text-sm text-muted-foreground">{d.posTenderChangeDue}</p>
                <p className="font-mono text-lg tabular-nums text-success-text" dir="ltr">
                  {formatMoneyDisplay(changeDue, 2)}
                </p>
              </div>
            )}
          </div>
          {tenderRows.map((row, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Select
                label={index === 0 ? d.posTenderMethod : undefined}
                value={row.method}
                onValueChange={(value) =>
                  setTenderRows((rows) =>
                    rows.map((candidate, i) =>
                      i === index ? { ...candidate, method: value === "CARD" ? "CARD" : "CASH" } : candidate,
                    ),
                  )
                }
                options={[
                  { value: "CASH", label: d.posTenderCash },
                  { value: "CARD", label: d.posTenderCard },
                ]}
              />
              <MoneyInput
                label={index === 0 ? d.posTenderAmount : undefined}
                amount={row.amount}
                onAmountChange={(amount) =>
                  setTenderRows((rows) => rows.map((candidate, i) => (i === index ? { ...candidate, amount } : candidate)))
                }
                currency={currency}
              />
              <div className="flex items-end">
                {tenderRows.length > 1 && (
                  <Button
                    variant="secondary"
                    onClick={() => setTenderRows((rows) => rows.filter((_, i) => i !== index))}
                  >
                    {d.posCounterRemove}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              setTenderRows((rows) => [...rows, { method: "CARD", amount: tenderRemaining }])
            }
            className="self-start"
          >
            {d.posTenderAddRow}
          </Button>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTenderDialog(false)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" loading={busy === "tender"} onClick={() => void confirmTender()}>
              {d.posTenderConfirm}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- returns dialog ---------------------------------------------------------------- */}
      <Dialog open={returnDialog} onOpenChange={setReturnDialog} title={d.posReturnTitle} size="lg">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              label={d.posReturnInvoiceLabel}
              value={returnInvoiceRef}
              onValueChange={setReturnInvoiceRef}
              mono
              bidiIsolate
            />
            <div className="flex items-end">
              <Button variant="secondary" loading={busy === "return-load"} onClick={() => void loadReturnInvoice()}>
                {d.posReturnLoad}
              </Button>
            </div>
          </div>
          {recentInvoices.length > 0 && returnInvoiceId === null && (
            <div className="max-h-32 overflow-y-auto">
              {recentInvoices.slice(0, 8).map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  onClick={() => {
                    setReturnInvoiceRef(invoice.id);
                    setReturnInvoiceId(null);
                  }}
                  className="mt-1 flex min-h-11 w-full items-center justify-between rounded-md border border-default bg-surface-card px-3 py-2 text-start text-sm hover:border-strong"
                >
                  <span className="font-mono text-xs" dir="ltr">
                    {invoice.invoiceNo ?? invoice.id.slice(0, 8)}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-gray-600" dir="ltr">
                    {formatMoneyDisplay(invoice.totalGross, 2)}
                  </span>
                </button>
              ))}
            </div>
          )}
          {returnLines.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-gray-900">{d.posReturnLines}</p>
              {returnLines.map((line, index) => (
                <div key={line.invoiceLineId} className="grid items-center gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <span className="truncate text-sm">{line.label}</span>
                  <span className="font-mono text-xs text-gray-600" dir="ltr">
                    ≤ {line.qtyMax}
                  </span>
                  <input
                    aria-label={d.posReturnLines}
                    className="w-24 rounded-md border border-default bg-surface-card px-2 py-1 text-center font-mono tabular-nums"
                    dir="ltr"
                    inputMode="decimal"
                    value={line.qty}
                    onChange={(event) =>
                      setReturnLines((rows) =>
                        rows.map((candidate, i) => (i === index ? { ...candidate, qty: event.target.value } : candidate)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {returnLines.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={d.posReturnReason} value={returnReason} onValueChange={setReturnReason} />
              <Input label={d.posReturnNote} value={returnNote} onValueChange={setReturnNote} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReturnDialog(false)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={busy === "return-submit"}
              disabled={returnInvoiceId === null}
              onClick={() => void submitReturn()}
            >
              {d.posReturnSubmit}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** The denomination grid (value × count) shared by the open/close dialogs. */
function DenominationGrid({
  caption,
  denominationLabel,
  countLabel,
  rows,
  onChange,
}: {
  caption: string;
  denominationLabel: string;
  countLabel: string;
  rows: DenominationCount[];
  onChange: (rows: DenominationCount[]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-900">{caption}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((row, index) => (
          <label key={row.denomination} className="flex flex-col gap-1">
            <span className="font-mono text-xs tabular-nums text-gray-700" dir="ltr">
              {denominationLabel} {row.denomination}
            </span>
            <input
              aria-label={`${countLabel} ${row.denomination}`}
              className="rounded-md border border-default bg-surface-card px-2 py-1.5 text-center font-mono tabular-nums"
              dir="ltr"
              inputMode="numeric"
              value={row.count}
              onChange={(event) => {
                const value = event.target.value;
                if (value !== "" && !COUNT_RE.test(value)) {
                  return;
                }
                onChange(rows.map((candidate, i) => (i === index ? { ...candidate, count: value } : candidate)));
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
