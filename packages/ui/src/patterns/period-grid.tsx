"use client";

/**
 * PeriodGrid (PHASE-028 pattern; COMPONENT_CATALOG §6.3 row): the
 * period-column spreadsheet-style grid — one row per dimension key, one
 * column per fiscal period, a live row-total column and a totals footer
 * row. The budget workspace's grid variant (PAGE_ARCHETYPES §4 variant
 * with fiscal-period columns): keyboard navigation moves between cells
 * (Enter/↑/↓ move rows, ←/→ hop columns at the caret edge — mirrored
 * under RTL so the arrows follow the VISUAL direction), the dimension
 * column sticks to the inline-start edge during horizontal scroll, and
 * money cells are canonical decimal STRINGS (ADR-0009 — never floats)
 * rendered LTR-isolated with tabular-nums. `locale` drives the RTL
 * mirroring (`dir="rtl"` on the scroll wrapper) — the grid owns its own
 * direction because its column order is semantic (dimension → periods →
 * row total), so a locale switch must mirror the WHOLE strip. Headless
 * by contract: the app injects periods/rows/totals + localized labels
 * and owns the save; the grid never fetches and never validates business
 * rules (the API is authority).
 */
import { useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { Button } from "../components/button";
import { cn } from "../utils/cn";
import { addExact } from "../utils/exact-decimal";
import { formatMoneyDisplay, sanitizeMoneyInput } from "../utils/money";

/** One fiscal-period column (id + localized label). */
export interface PeriodGridColumn {
  id: string;
  label: string;
}

/** One grid row: a dimension key + its per-period amounts. */
export interface PeriodGridRowData {
  key: string;
  dimensionLabel: string;
  amounts: Record<string, string>;
}

/** The totals footer row: per-period sums (caller-owned, live). */
export interface PeriodGridTotals {
  label: string;
  amounts: Record<string, string>;
}

export interface PeriodGridLabels {
  /** Header of the sticky dimension column (defaults to "—"). */
  dimension?: string;
  /** Header of the live row-total column (defaults to the Σ glyph). */
  rowTotal?: string;
  /** Rendered when the grid carries no rows (never a fabricated row). */
  empty?: string;
  /** Accessible label of the trailing remove-row column (journal-grid pattern). */
  removeRow?: string;
}

export interface PeriodGridProps {
  /** Content locale — "ar" mirrors the grid (RTL column order). */
  locale: "ar" | "en";
  periods: readonly PeriodGridColumn[];
  rows: readonly PeriodGridRowData[];
  totalsRow: PeriodGridTotals;
  onCellChange?: (rowKey: string, periodId: string, value: string) => void;
  /** Remove-row control (editable grids only — the journal-grid pattern). */
  onRemoveRow?: (rowKey: string) => void;
  /** Read-only grids render formatted text cells (no inputs, no keyboard grid). */
  readOnly?: boolean;
  /** Editable but inert (saving state) — inputs render disabled. */
  disabled?: boolean;
  /** Minor units for money sanitize + display (budgets are 4dp; default 4). */
  minorUnits?: number;
  labels?: PeriodGridLabels;
  /** Accessible name for the grid region. */
  ariaLabel?: string;
  className?: string;
}

const MONEY_CELL_CLASSES = cn(
  "h-[var(--erp-density-control-height)] w-full min-w-20 rounded-md border border-default bg-surface-card px-2 text-end font-mono text-sm tabular-nums text-gray-900 outline-none",
  "hover:border-strong focus:border-primary-600 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
  "disabled:cursor-not-allowed disabled:border-subtle disabled:bg-surface-sunken disabled:text-gray-400",
);

/**
 * PeriodGrid — spreadsheet-style period columns. The row-total column and
 * the footer's year cell are computed HERE over the passed rows/totals
 * (exact 4-dp BigInt math — the UI can never disagree with the engine on
 * the same fixture); the per-period footer cells render the caller's
 * `totalsRow.amounts` verbatim (the caller keeps them live).
 */
export function PeriodGrid({
  locale,
  periods,
  rows,
  totalsRow,
  onCellChange,
  onRemoveRow,
  readOnly = false,
  disabled = false,
  minorUnits = 4,
  labels = {},
  ariaLabel,
  className,
}: PeriodGridProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const dimensionHeader = labels.dimension ?? "—";
  const rowTotalLabel = labels.rowTotal ?? "Σ";
  const emptyLabel = labels.empty ?? "—";
  const removeRowLabel = labels.removeRow ?? "×";
  const canRemove = onRemoveRow !== undefined && !readOnly;

  // Live row totals: Σ of the row's non-empty amounts (exact decimal math).
  const rowTotals = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      let sum = "0.0000";
      for (const period of periods) {
        const value = row.amounts[period.id] ?? "";
        if (value !== "") {
          sum = addExact(sum, value);
        }
      }
      map.set(row.key, sum);
    }
    return map;
  }, [rows, periods]);

  // The footer's year cell: Σ of the caller's per-period totals.
  const yearTotal = useMemo(() => {
    let sum = "0.0000";
    for (const period of periods) {
      const value = totalsRow.amounts[period.id] ?? "";
      if (value !== "") {
        sum = addExact(sum, value);
      }
    }
    return sum;
  }, [totalsRow, periods]);

  /** Moves focus to the (rowIndex, colIndex) cell; false when absent. */
  function focusCell(rowIndex: number, colIndex: number): boolean {
    const target = containerRef.current?.querySelector<HTMLInputElement>(
      `input[data-row="${rowIndex}"][data-col="${colIndex}"]`,
    );
    if (target === null || target === undefined) {
      return false;
    }
    target.focus();
    target.select();
    return true;
  }

  /**
   * Keyboard grid navigation (§4 spreadsheet model): Enter/↓ move down a
   * row, ↑ moves up, ←/→ hop columns at the caret edge. RTL mirrors the
   * horizontal hops so the arrows follow the VISUAL direction (Excel-RTL
   * precedent); vertical keys are direction-neutral.
   */
  function onCellKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    colIndex: number,
  ): void {
    const input = event.currentTarget;
    const caretStart = input.selectionStart ?? 0;
    const caretEnd = input.selectionEnd ?? 0;
    const atStart = caretStart === 0 && caretEnd === 0;
    const atEnd = caretStart === input.value.length && caretEnd === input.value.length;
    const forwardCol = locale === "ar" ? colIndex - 1 : colIndex + 1;
    const backCol = locale === "ar" ? colIndex + 1 : colIndex - 1;
    if (event.key === "Enter" || event.key === "ArrowDown") {
      if (focusCell(rowIndex + 1, colIndex)) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (focusCell(rowIndex - 1, colIndex)) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowRight" && atEnd) {
      if (focusCell(rowIndex, forwardCol)) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowLeft" && atStart) {
      if (focusCell(rowIndex, backCol)) {
        event.preventDefault();
      }
    }
  }

  function onCellInput(rowKey: string, periodId: string, raw: string): void {
    // Paste sanitization (§6.2): digits + one dot, clamped to minorUnits;
    // budget amounts are non-negative (the API MONEY contract).
    const sanitized = sanitizeMoneyInput(raw, minorUnits).replace(/^-/, "");
    onCellChange?.(rowKey, periodId, sanitized);
  }

  return (
    <div
      ref={containerRef}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={cn("overflow-x-auto rounded-lg border", className)}
    >
      <table
        role="grid"
        aria-label={ariaLabel ?? rowTotalLabel}
        data-testid="period-grid"
        className="w-full border-collapse text-sm"
      >
        <thead>
          <tr className="border-b bg-surface-muted" role="row">
            <th
              scope="col"
              role="columnheader"
              aria-label={dimensionHeader}
              className="sticky start-0 z-20 bg-surface-muted px-3 py-2 text-start font-medium"
            >
              {dimensionHeader}
            </th>
            {periods.map((period) => (
              <th
                key={period.id}
                scope="col"
                role="columnheader"
                className="px-3 py-2 text-end font-medium"
              >
                {period.label}
              </th>
            ))}
            <th
              scope="col"
              role="columnheader"
              className="px-3 py-2 text-end font-medium"
              aria-label={rowTotalLabel}
            >
              {rowTotalLabel}
            </th>
            {canRemove && (
              <th scope="col" role="columnheader" aria-label={removeRowLabel} className="px-2 py-2" />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr role="row">
              <td
                role="gridcell"
                colSpan={periods.length + 2 + (canRemove ? 1 : 0)}
                className="px-3 py-4 text-center text-sm text-muted-foreground"
                data-testid="period-grid-empty"
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={row.key}
                role="row"
                className={cn(
                  "border-b last:border-b-0",
                  focusedKey === row.key && "bg-surface-muted/60",
                )}
              >
                <td
                  role="gridcell"
                  className="sticky start-0 z-10 bg-surface px-3 py-1.5 text-start"
                >
                  {row.dimensionLabel}
                </td>
                {periods.map((period, colIndex) => {
                  const value = row.amounts[period.id] ?? "";
                  const cellName = `${row.dimensionLabel} · ${period.label}`;
                  return (
                    <td key={period.id} role="gridcell" className="px-1.5 py-1.5">
                      {readOnly ? (
                        <span
                          className="block text-end font-mono text-sm tabular-nums text-gray-900"
                          dir="ltr"
                        >
                          {value === "" ? <span className="text-gray-400">—</span> : formatMoneyDisplay(value, minorUnits)}
                        </span>
                      ) : (
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          style={{ unicodeBidi: "isolate" }}
                          data-row={rowIndex}
                          data-col={colIndex}
                          data-testid={`period-grid-cell-${rowIndex}-${colIndex}`}
                          value={value}
                          onChange={(event) => onCellInput(row.key, period.id, event.target.value)}
                          onKeyDown={(event) => onCellKeyDown(event, rowIndex, colIndex)}
                          onFocus={() => setFocusedKey(row.key)}
                          onBlur={() => setFocusedKey(null)}
                          disabled={disabled}
                          aria-label={cellName}
                          className={MONEY_CELL_CLASSES}
                        />
                      )}
                    </td>
                  );
                })}
                <td
                  role="gridcell"
                  className="px-3 py-1.5 text-end font-mono text-sm tabular-nums font-medium text-gray-900"
                  dir="ltr"
                  aria-label={`${row.dimensionLabel} · ${rowTotalLabel}`}
                >
                  {formatMoneyDisplay(rowTotals.get(row.key) ?? "0", minorUnits)}
                </td>
                {canRemove && (
                  <td role="gridcell" className="px-2 py-1.5 text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveRow?.(row.key)}
                      disabled={disabled}
                      aria-label={`${removeRowLabel} ${rowIndex + 1}`}
                    >
                      ×
                    </Button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr role="row" className="border-t bg-surface-muted">
            <th
              scope="row"
              className="sticky start-0 z-10 bg-surface-muted px-3 py-2 text-start font-medium"
            >
              {totalsRow.label}
            </th>
            {periods.map((period) => (
              <td
                key={period.id}
                role="gridcell"
                className="px-3 py-2 text-end font-mono text-sm tabular-nums text-gray-900"
                dir="ltr"
              >
                {formatMoneyDisplay(totalsRow.amounts[period.id] ?? "0", minorUnits)}
              </td>
            ))}
            <td
              role="gridcell"
              className="px-3 py-2 text-end font-mono text-sm tabular-nums font-semibold text-gray-900"
              dir="ltr"
            >
              {formatMoneyDisplay(yearTotal, minorUnits)}
            </td>
            {canRemove && <td role="gridcell" className="px-2 py-2" />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
