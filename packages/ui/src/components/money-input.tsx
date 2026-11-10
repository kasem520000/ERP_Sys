"use client";

/**
 * MoneyInput (COMPONENT_CATALOG §6.2 — NORMATIVE): the only legal way to
 * capture amounts.
 *
 * - `amount` is a canonical decimal STRING (ADR-0009 — never a float).
 * - Grouping on blur (`12,500.00`), raw digits on focus (caret-preserving).
 * - Paste sanitizes to [0-9.,-] + locale decimal (`,` decimal FORBIDDEN at
 *   MVP — '.' always, ',' thousands; RTL §8).
 * - Currency suffix chip (ISO + symbol, `SAR ر.س`) on the inline-end side.
 * - Negative red BY SIGN (§4) — never by debit/credit context; zero gray-600.
 * - Digits always LTR + isolated inside RTL; separators never mirror.
 */
import type { JSX } from "react";
import { useId, useState } from "react";

import { cn } from "../utils/cn";
import { controlCx } from "../utils/direction";
import { currencyChipLabel, moneyColorClass, sanitizeMoneyInput, stripMoneyGrouping, formatMoneyDisplay } from "../utils/money";

export interface MoneyInputProps {
  /** Canonical decimal string, e.g. "12500.50" — the ONLY contract. */
  amount: string;
  onAmountChange?: (amount: string) => void;
  currency: string;
  /** From currency metadata (SAR/USD=2, KWD/BHD=3 …). Default 2. */
  minorUnits?: number;
  allowNegative?: boolean;
  max?: string;
  error?: string;
  label?: string;
  /** Accessible name for the input when no visible <label> applies (grids). */
  ariaLabel?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  /** Stable play-function target (visual-harness conventions). */
  "data-testid"?: string;
}

export function MoneyInput({
  amount,
  onAmountChange,
  currency,
  minorUnits = 2,
  allowNegative = false,
  max,
  error,
  label,
  ariaLabel,
  hint,
  disabled,
  readOnly,
  required,
  id,
  name,
  className,
  "data-testid": dataTestId,
}: MoneyInputProps): JSX.Element {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [focused, setFocused] = useState(false);

  // display: grouped on blur; raw digits while focused (caret-preserving §6.2)
  const display = focused ? amount : formatMoneyDisplay(amount, minorUnits);

  function commit(next: string): void {
    let sanitized = sanitizeMoneyInput(next, minorUnits);
    if (!allowNegative) sanitized = sanitized.replace(/^-/, "");
    if (max !== undefined && sanitized !== "" && Number(sanitized) > Number(max)) {
      sanitized = stripMoneyGrouping(max);
    }
    onAmountChange?.(sanitized);
  }

  const invalid = error !== undefined;
  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      {label !== undefined && (
        <label htmlFor={fieldId} className="text-sm font-medium text-gray-700">
          {label}
          {required && (
            <span aria-hidden="true" className="text-danger-700">
              {" *"}
            </span>
          )}
        </label>
      )}
      <div
        role="group"
        aria-label={`${label ?? ""} ${currencyChipLabel(currency)}`.trim()}
        className={cn("relative flex w-full items-center")}
      >
        <input
          id={fieldId}
          name={name}
          data-testid={dataTestId}
          inputMode="decimal"
          dir="ltr"
          style={{ unicodeBidi: "isolate" }}
          aria-label={ariaLabel ?? `${label ?? ""} ${currencyChipLabel(currency)}`.trim()}
          value={display}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            // canonicalize trailing dot / empty on commit
            const raw = sanitizeMoneyInput(amount, minorUnits).replace(/\.$/, "");
            if (raw !== amount) onAmountChange?.(raw);
          }}
          onChange={(e) => commit(e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            commit(e.clipboardData.getData("text"));
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={hint !== undefined || error !== undefined ? `${fieldId}-hint ${fieldId}-error` : undefined}
          className={cn(
            "w-full rounded-md border border-default bg-surface-card px-3 font-mono text-sm tabular-nums text-gray-900 outline-none pe-24",
            "hover:border-strong focus:border-primary-600",
            "disabled:cursor-not-allowed disabled:border-subtle disabled:bg-surface-sunken disabled:text-gray-400",
            "aria-[invalid=true]:border-danger-700",
            controlCx,
            // §4: negative → finance-negative red; zero → gray-600; digits LTR stays
            moneyColorClass(amount),
          )}
        />
        <span
          aria-hidden="true"
          dir="ltr"
          className="pointer-events-none absolute end-2 rounded-sm border border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-600"
        >
          {currencyChipLabel(currency)}
        </span>
      </div>
      {hint !== undefined && (
        <p id={`${fieldId}-hint`} className="text-xs text-gray-600">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${fieldId}-error`} className="text-xs text-danger-700" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
