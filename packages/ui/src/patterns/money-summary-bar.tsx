"use client";

/**
 * MoneySummaryBar (PHASE-007 pattern; COMPONENT_CATALOG §6.3 companion): the
 * sticky totals bar under a financial document grid — live Σdebit | Σcredit |
 * Δdifference (the UI mirror of INV-001). Δ≠0 renders the difference in
 * `finance-negative` with the bilingual warning; Δ=0 renders the balanced
 * confirmation tone. Values are canonical decimal STRINGS (ADR-0009 — never
 * floats); the bar computes with the shared exact-decimal helper so it can
 * never disagree with the engine on the same fixture.
 */
import type { JSX } from "react";

import { cn } from "../utils/cn";
import { subtractExact } from "../utils/exact-decimal";
import { formatMoneyDisplay } from "../utils/money";

export interface MoneySummaryBarProps {
  /** Σdebit (canonical decimal string, document currency). */
  debit: string;
  /** Σcredit (canonical decimal string, document currency). */
  credit: string;
  currency: string;
  /** From currency metadata (SAR=2, KWD=3 …). Default 2. */
  minorUnits?: number;
  labels: {
    debit: string;
    credit: string;
    difference: string;
    balanced: string;
    unbalanced: string;
  };
  /** Optional compact variant for dense toolbars. */
  compact?: boolean;
  className?: string;
}

export function MoneySummaryBar({
  debit,
  credit,
  currency,
  minorUnits = 2,
  labels,
  compact = false,
  className,
}: MoneySummaryBarProps): JSX.Element {
  const difference = subtractExact(debit, credit);
  const balanced = difference === "0.0000" || difference === "0" || difference === "-0";
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-lg border bg-surface px-4",
        compact ? "py-2" : "py-3",
        balanced ? "border-success/40" : "border-finance-negative/50",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-6">
        <SummaryCell label={labels.debit} value={formatMoneyDisplay(debit, minorUnits)} currency={currency} />
        <SummaryCell label={labels.credit} value={formatMoneyDisplay(credit, minorUnits)} currency={currency} />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{labels.difference}</span>
          <span
            className={cn(
              "font-mono text-sm tabular-nums",
              balanced ? "text-success" : "text-finance-negative",
            )}
            dir="ltr"
          >
            {formatMoneyDisplay(difference, minorUnits)}
          </span>
        </div>
      </div>
      <span
        className={cn(
          "rounded px-2 py-1 text-xs font-medium",
          balanced ? "bg-success/10 text-success" : "bg-finance-negative/10 text-finance-negative",
        )}
      >
        {balanced ? labels.balanced : labels.unbalanced}
      </span>
    </div>
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
