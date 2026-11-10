"use client";

/**
 * ShiftPanel (PHASE-008 treasury pattern; COMPONENT_CATALOG §6.3): the
 * cashier-shift console — one shift's float, captured IN/OUT totals, and the
 * live EXPECTED balance (opening + in − out, exact string math via the shared
 * decimal helper so it can never disagree with the engine's captured ledger).
 * The CLOSE flow captures the counted amount; variance (counted − expected)
 * renders with the balanced/explained tone and, when non-zero, surfaces the
 * supervisor id + PIN fields (BR-021 — the server enforces the tolerance
 * policy; the panel only presents the inputs). CLOSED shifts render the
 * read-only summary (final counts, difference, variance journal link hint).
 * Headless by contract: the app supplies the shift data + action handlers.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Button } from "../components/button";
import { Input } from "../components/input";
import { MoneyInput } from "../components/money-input";
import { cn } from "../utils/cn";
import { addExact, compareExact, isZeroExact, subtractExact } from "../utils/exact-decimal";
import { formatMoneyDisplay } from "../utils/money";

export type ShiftPanelStatus = "OPEN" | "CLOSED" | "CANCELLED";

export interface ShiftPanelData {
  id: string;
  status: ShiftPanelStatus;
  currency: string;
  /** Opening float (canonical decimal string). */
  openingAmount: string;
  /** Σ captured cash-in movements (canonical decimal string). */
  capturedIn: string;
  /** Σ captured cash-out movements (canonical decimal string). */
  capturedOut: string;
  /** Server-computed expected (CLOSED shifts); null while OPEN. */
  expectedAmount: string | null;
  /** Final counted amount (CLOSED shifts); null while OPEN. */
  countedAmount: string | null;
  /** counted − expected (CLOSED shifts); null while OPEN. */
  difference: string | null;
  /** BR-021 close reason (CLOSED/CANCELLED shifts). */
  closeReason: string | null;
}

/** The close payload the app forwards to POST treasury/shifts/:id/close. */
export interface ShiftClosePayload {
  countedAmount: string;
  reason: string;
  supervisorId: string;
  supervisorPin: string;
}

/** Optional initial values for the close form (re-showing after an error). */
export interface ShiftCloseDraft {
  countedAmount?: string;
  reason?: string;
  supervisorId?: string;
  supervisorPin?: string;
}

export interface ShiftPanelLabels {
  title: string;
  statusOpen: string;
  statusClosed: string;
  statusCancelled: string;
  opening: string;
  capturedIn: string;
  capturedOut: string;
  expected: string;
  counted: string;
  difference: string;
  balanced: string;
  varianceNote: string;
  closeReason: string;
  supervisor: string;
  supervisorPin: string;
  supervisorHint: string;
  captureTitle: string;
  captureHint: string;
  captureSubmit: string;
  closeTitle: string;
  closeSubmit: string;
  closeVarianceJournal: string;
  closedNote: string;
}

export interface ShiftPanelProps {
  shift: ShiftPanelData;
  labels: ShiftPanelLabels;
  /** OPEN shifts: capture a cash-in/cash-out movement pair. */
  onCapture?: (cashIn: string, cashOut: string) => void;
  /** OPEN shifts: close with the counted amount (+ supervisor when needed). */
  onClose?: (payload: ShiftClosePayload) => void;
  /** Initial close-form values (harness stories / error re-show). */
  initialCloseDraft?: ShiftCloseDraft;
  loading?: boolean;
  disabled?: boolean;
  /** Optional external error text (the app maps treasury error codes). */
  error?: string;
  minorUnits?: number;
  className?: string;
}

export function ShiftPanel({
  shift,
  labels,
  onCapture,
  onClose,
  initialCloseDraft,
  loading = false,
  disabled = false,
  error,
  minorUnits = 2,
  className,
}: ShiftPanelProps): JSX.Element {
  const [cashIn, setCashIn] = useState("");
  const [cashOut, setCashOut] = useState("");
  const [countedAmount, setCountedAmount] = useState(initialCloseDraft?.countedAmount ?? "");
  const [reason, setReason] = useState(initialCloseDraft?.reason ?? "");
  const [supervisorId, setSupervisorId] = useState(initialCloseDraft?.supervisorId ?? "");
  const [supervisorPin, setSupervisorPin] = useState(initialCloseDraft?.supervisorPin ?? "");

  // EXPECTED = opening + captured IN − captured OUT (exact string math —
  // the same 4-dp BigInt helpers MoneySummaryBar uses, ADR-0009).
  const expected =
    shift.expectedAmount ?? subtractExact(addExact(shift.openingAmount, shift.capturedIn), shift.capturedOut);
  const difference =
    shift.difference ?? (countedAmount === "" ? null : subtractExact(countedAmount, expected));
  const hasVariance = difference === null ? false : !isZeroExact(difference);
  const canClose = countedAmount !== "" && (!hasVariance || reason.trim().length >= 3);

  return (
    <section
      className={cn("rounded-lg border bg-surface", className)}
      aria-label={labels.title}
      data-testid="shift-panel"
      data-shift-status={shift.status}
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{labels.title}</h2>
        <span
          className={cn(
            "rounded px-2 py-1 text-xs font-medium",
            shift.status === "OPEN"
              ? "bg-primary-600/10 text-primary-700"
              : shift.status === "CLOSED"
                ? "bg-success/10 text-success"
                : "bg-surface-muted text-muted-foreground",
          )}
          data-testid="shift-panel-status"
        >
          {shift.status === "OPEN"
            ? labels.statusOpen
            : shift.status === "CLOSED"
              ? labels.statusClosed
              : labels.statusCancelled}
        </span>
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCell
          label={labels.opening}
          value={formatMoneyDisplay(shift.openingAmount, minorUnits)}
          currency={shift.currency}
        />
        <SummaryCell
          label={labels.capturedIn}
          value={formatMoneyDisplay(shift.capturedIn, minorUnits)}
          currency={shift.currency}
        />
        <SummaryCell
          label={labels.capturedOut}
          value={formatMoneyDisplay(shift.capturedOut, minorUnits)}
          currency={shift.currency}
        />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{labels.expected}</span>
          <span className="font-mono text-sm tabular-nums" dir="ltr">
            {formatMoneyDisplay(expected, minorUnits)}{" "}
            <span className="text-xs text-muted-foreground">{shift.currency}</span>
          </span>
        </div>
      </div>

      {shift.status === "OPEN" ? (
        <div className="flex flex-col gap-4 border-t px-4 py-4">
          <h3 className="text-sm font-semibold">{labels.captureTitle}</h3>
          <p className="text-xs text-muted-foreground">{labels.captureHint}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyInput
              label={labels.capturedIn}
              amount={cashIn}
              onAmountChange={setCashIn}
              currency={shift.currency}
              minorUnits={minorUnits}
              data-testid="shift-panel-cash-in"
            />
            <MoneyInput
              label={labels.capturedOut}
              amount={cashOut}
              onAmountChange={setCashOut}
              currency={shift.currency}
              minorUnits={minorUnits}
              data-testid="shift-panel-cash-out"
            />
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => onCapture?.(cashIn === "" ? "0" : cashIn, cashOut === "" ? "0" : cashOut)}
                loading={loading}
                disabled={disabled || (isZeroExact(cashIn === "" ? "0" : cashIn) && isZeroExact(cashOut === "" ? "0" : cashOut))}
                data-testid="shift-panel-capture-submit"
              >
                {labels.captureSubmit}
              </Button>
            </div>
          </div>

          <h3 className="mt-2 text-sm font-semibold">{labels.closeTitle}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyInput
              label={labels.counted}
              amount={countedAmount}
              onAmountChange={setCountedAmount}
              currency={shift.currency}
              minorUnits={minorUnits}
              required
              data-testid="shift-panel-counted"
            />
            <Input
              label={labels.closeReason}
              value={reason}
              onValueChange={setReason}
              data-testid="shift-panel-reason"
            />
            <Input
              label={labels.supervisor}
              value={supervisorId}
              onValueChange={setSupervisorId}
              hint={labels.supervisorHint}
              data-testid="shift-panel-supervisor"
            />
            <Input
              label={labels.supervisorPin}
              value={supervisorPin}
              onValueChange={setSupervisorPin}
              inputMode="numeric"
              data-testid="shift-panel-supervisor-pin"
            />
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
            role="status"
            aria-live="polite"
          >
            {difference === null ? (
              <span className="text-xs text-muted-foreground">{labels.varianceNote}</span>
            ) : hasVariance ? (
              <>
                <span className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{labels.difference}</span>
                  <span className="font-mono text-sm tabular-nums text-finance-negative" dir="ltr">
                    {formatMoneyDisplay(difference, minorUnits)} {shift.currency}
                  </span>
                </span>
                <span className="text-xs text-finance-negative">{labels.varianceNote}</span>
              </>
            ) : (
              <span className="text-xs font-medium text-success">{labels.balanced}</span>
            )}
            <Button
              variant="primary"
              onClick={() =>
                onClose?.({
                  countedAmount,
                  reason: reason.trim(),
                  supervisorId: supervisorId.trim(),
                  supervisorPin: supervisorPin.trim(),
                })
              }
              loading={loading}
              disabled={disabled || !canClose}
              data-testid="shift-panel-close-submit"
            >
              {labels.closeSubmit}
            </Button>
          </div>
          {error !== undefined && (
            <p className="text-sm text-finance-negative" role="alert" data-testid="shift-panel-error">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCell
              label={labels.counted}
              value={shift.countedAmount === null ? "—" : formatMoneyDisplay(shift.countedAmount, minorUnits)}
              currency={shift.countedAmount === null ? "" : shift.currency}
            />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{labels.difference}</span>
              <span
                className={cn(
                  "font-mono text-sm tabular-nums",
                  shift.difference !== null && compareExact(shift.difference, "0") !== 0
                    ? "text-finance-negative"
                    : "text-success",
                )}
                dir="ltr"
              >
                {shift.difference === null ? "—" : formatMoneyDisplay(shift.difference, minorUnits)}{" "}
                <span className="text-xs text-muted-foreground">{shift.currency}</span>
              </span>
            </div>
            <div className="flex flex-col sm:col-span-2">
              <span className="text-xs text-muted-foreground">{labels.closeReason}</span>
              <span className="text-sm">{shift.closeReason ?? "—"}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{labels.closedNote}</p>
        </div>
      )}
    </section>
  );
}

function SummaryCell({
  label,
  value,
  currency,
}: {
  label: string;
  value: string;
  currency: string;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums" dir="ltr">
        {value} <span className="text-xs text-muted-foreground">{currency}</span>
      </span>
    </div>
  );
}
