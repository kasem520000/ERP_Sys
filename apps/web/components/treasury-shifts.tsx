"use client";

/**
 * T14-UI (PHASE-008) — cashier shifts (list-search + the @erp/ui
 * ShiftPanel pattern): the open-shift form (account + float), the shift
 * list (status, opening, captured in/out, expected, counted, difference),
 * and the selected shift's ShiftPanel console — capture posts the in/out
 * movement pair, close sends the counted amount (+ reason/supervisor when
 * the variance needs them — BR-021 enforced server-side), cancel prompts
 * for a reason. All money stays canonical decimal strings; the panel's
 * EXPECTED math is exact string arithmetic, never floats.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
  ShiftPanel,
  type ShiftClosePayload,
  type ShiftPanelData,
  type ShiftPanelLabels,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { CashAccountRow, ShiftRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  localizedName,
  localizedShiftStatus,
  localizedTreasuryError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function TreasuryShifts({
  locale,
  initialRows,
  cashAccounts,
}: {
  locale: Locale;
  initialRows: readonly ShiftRow[];
  cashAccounts: readonly CashAccountRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly ShiftRow[]>(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRows.find((row) => row.status === "OPEN")?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Open-shift form state.
  const [cashAccountId, setCashAccountId] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of cashAccounts) {
      map.set(account.id, localizedName(account.name, account.nameAr, locale));
    }
    return map;
  }, [cashAccounts, locale]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const openAccountIds = useMemo(
    () => new Set(rows.filter((row) => row.status === "OPEN").map((row) => row.cashAccountId)),
    [rows],
  );

  const labels = useMemo<ShiftPanelLabels>(
    () => ({
      title: d.treasuryShiftPanelTitle,
      statusOpen: d.treasuryShiftStatusOpen,
      statusClosed: d.treasuryShiftStatusClosed,
      statusCancelled: d.treasuryShiftStatusCancelled,
      opening: d.treasuryShiftOpeningAmount,
      capturedIn: d.treasuryShiftColCapturedIn,
      capturedOut: d.treasuryShiftColCapturedOut,
      expected: d.treasuryShiftExpected,
      counted: d.treasuryShiftCounted,
      difference: d.treasuryShiftDifference,
      balanced: d.treasuryShiftBalanced,
      varianceNote: d.treasuryShiftVarianceNote,
      closeReason: d.treasuryShiftReason,
      supervisor: d.treasuryShiftSupervisor,
      supervisorPin: d.treasuryShiftSupervisorPin,
      supervisorHint: d.treasuryShiftSupervisorHint,
      captureTitle: d.treasuryShiftCaptureTitle,
      captureHint: d.treasuryShiftCaptureHint,
      captureSubmit: d.treasuryShiftCaptureBtn,
      closeTitle: d.treasuryShiftCloseTitle,
      closeSubmit: d.treasuryShiftCloseBtn,
      closeVarianceJournal: d.treasuryShiftVarianceJournal,
      closedNote: d.treasuryShiftClosedNote,
    }),
    [d],
  );

  async function refreshShift(id: string): Promise<void> {
    const refreshed = await bffFetch<ShiftRow>(`treasury/shifts/${id}`);
    if (refreshed.ok) {
      const updated = refreshed.data;
      setRows((current) => current.map((row) => (row.id === id ? updated : row)));
    }
  }

  async function openShift(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("open");
    const created = await bffFetch<ShiftRow>("treasury/shifts", {
      method: "POST",
      body: {
        cashAccountId,
        openingAmount: openingAmount === "" ? "0" : openingAmount,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedTreasuryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data, ...current]);
    setSelectedId(created.data.id);
    setCashAccountId("");
    setOpeningAmount("");
    setNotice(d.treasuryShiftCreatedToast);
  }

  async function capture(cashIn: string, cashOut: string): Promise<void> {
    if (selectedId === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("panel");
    const captured = await bffFetch<ShiftRow>(`treasury/shifts/${selectedId}/capture`, {
      method: "POST",
      body: { cashIn, cashOut },
    });
    setBusy(null);
    if (!captured.ok) {
      setError(localizedTreasuryError(d, captured.error, captured.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === selectedId ? captured.data : row)));
    setNotice(d.treasuryShiftCaptureBtn);
  }

  async function close(payload: ShiftClosePayload): Promise<void> {
    if (selectedId === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("panel");
    const closed = await bffFetch<ShiftRow>(`treasury/shifts/${selectedId}/close`, {
      method: "POST",
      body: {
        countedAmount: payload.countedAmount,
        reason: payload.reason === "" ? undefined : payload.reason,
        supervisorId: payload.supervisorId === "" ? undefined : payload.supervisorId,
        supervisorPin: payload.supervisorPin === "" ? undefined : payload.supervisorPin,
      },
    });
    setBusy(null);
    if (!closed.ok) {
      setError(localizedTreasuryError(d, closed.error, closed.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === selectedId ? closed.data : row)));
    setNotice(d.treasuryShiftCloseToast);
  }

  async function cancelShift(): Promise<void> {
    if (cancelId === null) {
      return;
    }
    setError(null);
    setBusy(cancelId);
    const cancelled = await bffFetch<ShiftRow>(`treasury/shifts/${cancelId}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!cancelled.ok) {
      setError(localizedTreasuryError(d, cancelled.error, cancelled.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === cancelId ? cancelled.data : row)));
    setCancelId(null);
    setCancelReason("");
    setNotice(d.treasuryShiftCancelledToast);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {selected !== null && (
        <ShiftPanel
          shift={toPanelData(selected)}
          labels={labels}
          onCapture={(cashIn, cashOut) => void capture(cashIn, cashOut)}
          onClose={(payload) => void close(payload)}
          loading={busy === "panel"}
          error={undefined}
        />
      )}

      <Card title={d.treasuryShiftsTitle}>
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.treasuryShiftColShiftNo),
              accessor: (row) => row.shiftNo ?? "",
              mono: true,
              sortable: true,
              render: (row) =>
                row.shiftNo === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.shiftNo}</span>
                ),
            },
            {
              id: "account",
              header: activeLocaleHeader(d.treasuryDocCashAccount),
              accessor: (row) => accountNameById.get(row.cashAccountId) ?? row.cashAccountId,
            },
            {
              id: "openedAt",
              header: activeLocaleHeader(d.treasuryShiftColOpenedAt),
              accessor: (row) => row.openedAt,
              sortable: true,
              render: (row) => formatDateTime(row.openedAt, locale),
            },
            {
              id: "capturedIn",
              header: activeLocaleHeader(d.treasuryShiftColCapturedIn),
              accessor: (row) => row.capturedIn,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.capturedIn, 2)}
                </span>
              ),
            },
            {
              id: "capturedOut",
              header: activeLocaleHeader(d.treasuryShiftColCapturedOut),
              accessor: (row) => row.capturedOut,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.capturedOut, 2)}
                </span>
              ),
            },
            {
              id: "expected",
              header: activeLocaleHeader(d.treasuryShiftExpected),
              accessor: (row) => row.expectedAmount ?? "",
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.expectedAmount === null ? "—" : formatMoneyDisplay(row.expectedAmount, 2)}
                </span>
              ),
            },
            {
              id: "counted",
              header: activeLocaleHeader(d.treasuryShiftCounted),
              accessor: (row) => row.countedAmount ?? "",
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.countedAmount === null ? "—" : formatMoneyDisplay(row.countedAmount, 2)}
                </span>
              ),
            },
            {
              id: "difference",
              header: activeLocaleHeader(d.treasuryShiftDifference),
              accessor: (row) => row.difference ?? "",
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.difference === null ? "—" : formatMoneyDisplay(row.difference, 2)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "OPEN" ? "primary" : "neutral"}>
                  {localizedShiftStatus(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "select",
              label: d.commonOpen,
              onSelect: (row) => {
                setSelectedId(row.id);
                void refreshShift(row.id);
              },
            },
            {
              id: "cancel",
              label: d.treasuryShiftCancelBtn,
              danger: true,
              onSelect: (row) => {
                setCancelReason("");
                setCancelId(row.id);
              },
            },
          ]}
          empty={{ title: d.treasuryShiftsEmpty }}
        />
      </Card>

      {cancelId !== null && (
        <Card title={d.treasuryShiftCancelBtn}>
          <div className="flex flex-col gap-3">
            <Input
              label={d.treasuryCancelReason}
              value={cancelReason}
              onValueChange={setCancelReason}
              required
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={cancelShift}
                loading={busy === cancelId}
                disabled={cancelReason.trim().length < 3}
              >
                {d.treasuryShiftCancelBtn}
              </Button>
              <Button variant="ghost" onClick={() => setCancelId(null)}>
                {d.commonCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card title={d.treasuryShiftOpenTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.treasuryDocCashAccount}
            value={cashAccountId}
            onValueChange={setCashAccountId}
            placeholder="—"
            options={cashAccounts
              .filter(
                (account) =>
                  account.status === "ACTIVE" && !openAccountIds.has(account.id),
              )
              .map((account) => ({
                value: account.id,
                label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
              }))}
            required
          />
          <div className="sm:col-span-1">
            <MoneyInput
              label={d.treasuryShiftOpeningAmount}
              amount={openingAmount}
              onAmountChange={setOpeningAmount}
              currency={cashAccounts.find((account) => account.id === cashAccountId)?.currencyCode ?? "SAR"}
            />
          </div>
        </div>
        <Button
          variant="primary"
          onClick={() => void openShift()}
          loading={busy === "open"}
          disabled={cashAccountId === ""}
          className="mt-3 self-start"
        >
          {d.treasuryShiftOpenBtn}
        </Button>
      </Card>
    </div>
  );
}

/** Wire row → pattern data (CLOSED rows keep their server-computed values). */
function toPanelData(row: ShiftRow): ShiftPanelData {
  return {
    id: row.id,
    status: row.status,
    currency: row.currencyCode,
    openingAmount: row.openingAmount,
    capturedIn: row.capturedIn,
    capturedOut: row.capturedOut,
    expectedAmount: row.expectedAmount,
    countedAmount: row.countedAmount,
    difference: row.difference,
    closeReason: row.closeReason,
  };
}
