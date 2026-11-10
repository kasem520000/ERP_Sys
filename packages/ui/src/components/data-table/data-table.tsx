"use client";

/**
 * DataTable (COMPONENT_CATALOG §6.1 — NORMATIVE): the workhorse grid.
 *
 * - Virtualized windowed rendering (~20 overscan), row height from density
 *   token (32/40px); 10k-row scroll 60fps gate asserted by the Playwright suite.
 * - click-header sort (Shift-click multi-sort), per-column filter menu,
 *   tri-state selection, row actions menu, sticky header + sticky START
 *   column (logical `start-0`), horizontal scroll.
 * - role=grid + roving tabindex gridcell model; header announces sort state;
 *   selection announced politely ("تم تحديد N صفوف" — app string).
 * - numeric columns: tabular-nums + text-end, digits dir=ltr — decimal
 *   alignment unchanged in both directions (RTL §8).
 * - loading → skeleton rows; empty → EmptyState; error → ErrorState + retry;
 *   sort/filter re-render instant (0ms — MOTION §forbidden).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";

import { cn } from "../../utils/cn";
import { Icon } from "../../utils/icons";
import { Button } from "../button";
import { EmptyState, ErrorState, LoadingState } from "../states";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "../../primitives/popover";
import { DropdownContent, DropdownItem, DropdownRoot, DropdownTrigger } from "../../primitives/dropdown";
import { CheckboxPrimitive } from "../../primitives/checkbox";

export interface DataTableColumn<Row> {
  id: string;
  header: { ar: string; en: string };
  accessor: (row: Row) => string;
  align?: "start" | "end" | "center";
  width?: string;
  sortable?: boolean;
  filterable?: boolean;
  render?: (row: Row) => ReactNode;
  stickyStart?: boolean;
  mono?: boolean;
  /** numeric → tabular-nums + text-end + LTR digit run (§6.1/§8). */
  numeric?: boolean;
}

export interface DataTableSort {
  columnId: string;
  direction: "asc" | "desc";
}

export interface DataTableProps<Row> {
  columns: Array<DataTableColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  sort?: DataTableSort[];
  onSortChange?: (sort: DataTableSort[]) => void;
  /** Client-side simple filter (the common list path); server filtering via onFilterChange. */
  filters?: Record<string, string>;
  onFilterChange?: (filters: Record<string, string>) => void;
  selected?: Set<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  rowActions?: Array<{ id: string; label: string; onSelect: (row: Row) => void; danger?: boolean }>;
  empty?: { title: string; description?: string; primaryAction?: ReactNode };
  error?: { title: string; detail?: string; retry?: ReactNode };
  loading?: boolean;
  /** App string: "تم تحديد N صفوف" (announcement is the app's i18n). */
  selectionLabel?: (count: number) => string;
  /** App strings for the filter popover (AR/EN resolved). */
  filterLabels?: { placeholder: string; clear: string };
  rowActionsLabel?: string;
  className?: string;
}

const OVERSCAN = 20;

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  sort = [],
  onSortChange,
  filters = {},
  onFilterChange,
  selected,
  onSelectedChange,
  rowActions,
  empty,
  error,
  loading = false,
  selectionLabel,
  filterLabels,
  rowActionsLabel = "row actions",
  className,
}: DataTableProps<Row>): JSX.Element {
  const rowHeight = 32; // compact default; Playwright asserts real height from the density var
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [focusCell, setFocusCell] = useState<{ row: number; col: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // client-side sort + filter (instant — MOTION forbids animation here)
  const processed = useMemo(() => {
    let out = [...rows];
    for (const [columnId, needle] of Object.entries(filters)) {
      const column = columns.find((c) => c.id === columnId && c.filterable === true);
      if (column === undefined) continue;
      const q = needle.trim().toLowerCase();
      if (q === "") continue;
      out = out.filter((row) => column.accessor(row).toLowerCase().includes(q));
    }
    if (sort.length > 0) {
      out.sort((a, b) => {
        for (const s of sort) {
          const column = columns.find((c) => c.id === s.columnId);
          if (column === undefined) continue;
          const cmp = column.accessor(a).localeCompare(column.accessor(b), "en", { numeric: true });
          if (cmp !== 0) return s.direction === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }
    return out;
  }, [rows, columns, filters, sort]);

  const total = processed.length;
  // eslint-disable-next-line no-restricted-properties -- UI geometry (scroll offset → row index), not money math (ADR-0009).
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  // eslint-disable-next-line no-restricted-properties -- UI geometry (viewport height → visible row count), not money math.
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2;
  const window_ = processed.slice(firstVisible, firstVisible + visibleCount);

  // scroll handling: re-render ONLY when the virtual window actually shifts
  // (one state change per row-height of scroll, not per scroll event) — the
  // 10k-row 60fps gate depends on this.
  const windowKeyRef = useRef("");
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    const height = el.clientHeight;
    // eslint-disable-next-line no-restricted-properties -- scroll-offset → row-index geometry, not money math (ADR-0009).
    const first = Math.max(0, Math.floor(el.scrollTop / rowHeight) - OVERSCAN);
    const key = `${first}:${height}`;
    if (key !== windowKeyRef.current) {
      windowKeyRef.current = key;
      setScrollTop(el.scrollTop);
      if (height !== viewportHeight) setViewportHeight(height);
    }
  }, [viewportHeight]);

  const allSelected = selected !== undefined && selected.size > 0 && selected.size === total;
  const someSelected = selected !== undefined && selected.size > 0 && selected.size < total;

  function toggleSort(columnId: string, additive: boolean): void {
    if (onSortChange === undefined) return;
    const existing = sort.find((s) => s.columnId === columnId);
    const nextDirection = existing === undefined ? "asc" : existing.direction === "asc" ? "desc" : undefined;
    let next: DataTableSort[];
    if (nextDirection === undefined) {
      next = sort.filter((s) => s.columnId !== columnId);
    } else {
      next = [{ columnId, direction: nextDirection }];
      if (additive) {
        const rest = sort.filter((s) => s.columnId !== columnId);
        next = [...rest, ...next];
      }
    }
    onSortChange(next);
  }

  function gridKeyDown(e: React.KeyboardEvent, rowIndex: number, colIndex: number): void {
    const key = e.key;
    if (key === "ArrowDown") {
      e.preventDefault();
      setFocusCell({ row: Math.min(rowIndex + 1, total - 1), col: colIndex });
    } else if (key === "ArrowUp") {
      e.preventDefault();
      setFocusCell({ row: Math.max(rowIndex - 1, 0), col: colIndex });
    } else if (key === "ArrowLeft") {
      e.preventDefault();
      setFocusCell({ row: rowIndex, col: Math.max(0, colIndex - 1) });
    } else if (key === "ArrowRight") {
      e.preventDefault();
      setFocusCell({ row: rowIndex, col: Math.min(columns.length - 1, colIndex + 1) });
    } else if (key === "Home") {
      e.preventDefault();
      setFocusCell({ row: rowIndex, col: 0 });
    } else if (key === "End") {
      e.preventDefault();
      setFocusCell({ row: rowIndex, col: columns.length - 1 });
    }
  }

  return (
    <div className={cn("relative w-full overflow-hidden rounded-lg border border-subtle bg-surface-card", className)}>
      {selectionLabel !== undefined && selected !== undefined && selected.size > 0 && (
        <p aria-live="polite" className="absolute inset-x-0 top-0 z-[var(--erp-z-raised)] bg-primary-50 px-3 py-1 text-xs text-primary-800">
          {selectionLabel(selected.size)}
        </p>
      )}
      {loading ? (
        <div className="p-3">
          <LoadingState variant="table" rows={8} />
        </div>
      ) : error !== undefined ? (
        <ErrorState title={error.title} detail={error.detail} retry={error.retry} />
      ) : total === 0 && empty !== undefined ? (
        <EmptyState title={empty.title} description={empty.description} primaryAction={empty.primaryAction} />
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-[70vh] overflow-auto"
          role="grid"
          aria-rowcount={total}
          aria-colcount={columns.length + (selected !== undefined ? 1 : 0) + (rowActions !== undefined ? 1 : 0)}
        >
          <div
            role="row"
            className="sticky top-0 z-[var(--erp-z-raised)] grid bg-surface-sunken"
            style={{ gridTemplateColumns: gridTemplate(columns, selected !== undefined, rowActions !== undefined) }}
          >
            {selected !== undefined && onSelectedChange !== undefined && (
              <div role="columnheader" className="flex items-center px-3 py-2">
                <CheckboxPrimitive
                  aria-label="select all"
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={() => {
                    onSelectedChange(allSelected ? new Set() : new Set(processed.map(rowKey)));
                  }}
                />
              </div>
            )}
            {columns.map((column, colIndex) => {
              const sortState = sort.find((s) => s.columnId === column.id);
              return (
                <div
                  key={column.id}
                  role="columnheader"
                  aria-sort={sortState === undefined ? "none" : sortState.direction === "asc" ? "ascending" : "descending"}
                  className={cn(
                    "flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-600",
                    column.align === "end" || column.numeric === true ? "justify-end" : column.align === "center" ? "justify-center" : "justify-start",
                    column.stickyStart && "sticky start-0 bg-surface-sunken",
                  )}
                >
                  {column.sortable === true ? (
                    <button type="button" onClick={(e) => toggleSort(column.id, e.shiftKey)} className="flex items-center gap-0.5 hover:text-gray-800">
                      {column.header.en}
                      <Icon
                        name={sortState?.direction === "asc" ? "chevron-up" : sortState?.direction === "desc" ? "chevron-down" : "chevron-end"}
                        size={12}
                        className="text-gray-400"
                      />
                    </button>
                  ) : (
                    <span>{column.header.en}</span>
                  )}
                  {column.filterable === true && onFilterChange !== undefined && (
                    <PopoverRoot>
                      <PopoverTrigger asChild>
                        <button type="button" aria-label={`filter ${column.header.en}`} className="rounded-sm p-0.5 hover:bg-surface-card">
                          <Icon name="filter" size={12} className="text-gray-500" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-56">
                        <input
                          autoFocus
                          value={filters[column.id] ?? ""}
                          placeholder={filterLabels?.placeholder ?? ""}
                          onChange={(e) => {
                            onFilterChange({ ...filters, [column.id]: e.target.value });
                          }}
                          className="w-full rounded-md border border-default px-2 py-1 text-sm outline-none focus:border-primary-600"
                        />
                        <div className="mt-2 flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const next = { ...filters };
                              delete next[column.id];
                              onFilterChange(next);
                            }}
                          >
                            {filterLabels?.clear ?? "×"}
                          </Button>
                        </div>
                      </PopoverContent>
                    </PopoverRoot>
                  )}
                  <span className="sr-only">{` (column ${colIndex + 1})`}</span>
                </div>
              );
            })}
            {rowActions !== undefined && <div role="columnheader" className="px-3 py-2" aria-label={rowActionsLabel} />}
          </div>
          <div style={{ height: total * rowHeight }} className="relative">
            {window_.map((row, i) => {
              const rowIndex = firstVisible + i;
              // slot keying (virtualization): the slot component tree is reused
              // across window shifts — content updates via props, not remounts.
              const key = rowKey(row); // stable data key for selection semantics
              const slotKey = `slot-${rowIndex}`;
              return (
                <div
                  key={slotKey}
                  data-row-key={rowKey(row)}
                  role="row"
                  aria-rowindex={rowIndex + 1}
                  data-row-index={rowIndex}
                  className={cn(
                    "absolute inset-x-0 grid border-b border-subtle",
                    rowIndex % 2 === 1 && "bg-gray-50",
                    selected?.has(key) && "bg-primary-50",
                  )}
                  style={{ top: rowIndex * rowHeight, height: rowHeight, gridTemplateColumns: gridTemplate(columns, selected !== undefined, rowActions !== undefined) }}
                >
                  {selected !== undefined && onSelectedChange !== undefined && (
                    <div role="gridcell" className="flex items-center px-3">
                      <CheckboxPrimitive
                        aria-label={`select row ${rowIndex + 1}`}
                        checked={selected.has(key)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selected);
                          if (checked === true) next.add(key);
                          else next.delete(key);
                          onSelectedChange(next);
                        }}
                      />
                    </div>
                  )}
                  {columns.map((column, colIndex) => {
                    const isFocus = focusCell !== null && focusCell.row === rowIndex && focusCell.col === colIndex;
                    return (
                      <div
                        key={column.id}
                        role="gridcell"
                        tabIndex={isFocus ? 0 : -1}
                        onKeyDown={(e) => gridKeyDown(e, rowIndex, colIndex)}
                        onFocus={() => setFocusCell({ row: rowIndex, col: colIndex })}
                        style={{ width: column.width }}
                        className={cn(
                          "flex items-center overflow-hidden px-3 text-[length:var(--erp-density-cell-font)]",
                          column.align === "end" || column.numeric === true ? "justify-end" : column.align === "center" ? "justify-center" : "justify-start",
                          (column.mono === true || column.numeric === true) && "font-mono",
                          column.numeric === true && "tabular-nums",
                          column.stickyStart && "sticky start-0 z-[1] bg-inherit",
                          "truncate text-gray-800",
                        )}
                      >
                        {column.numeric === true ? (
                          <span dir="ltr" className="block truncate">
                            {column.render !== undefined ? column.render(row) : column.accessor(row)}
                          </span>
                        ) : column.render !== undefined ? (
                          column.render(row)
                        ) : (
                          column.accessor(row)
                        )}
                      </div>
                    );
                  })}
                  {rowActions !== undefined && (
                    <div role="gridcell" className="flex items-center justify-end px-3">
                      <DropdownRoot>
                        <DropdownTrigger asChild>
                          <button type="button" aria-label={rowActionsLabel} className="rounded-md p-1 text-gray-500 hover:bg-surface-sunken">
                            <Icon name="kebab" size={16} />
                          </button>
                        </DropdownTrigger>
                        <DropdownContent align="end">
                          {rowActions.map((action) => (
                            <DropdownItem key={action.id} tone={action.danger === true ? "danger" : "default"} onSelect={() => action.onSelect(row)}>
                              {action.label}
                            </DropdownItem>
                          ))}
                        </DropdownContent>
                      </DropdownRoot>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function gridTemplate<Row>(columns: Array<DataTableColumn<Row>>, hasSelection: boolean, hasActions: boolean): string {
  const parts: string[] = [];
  if (hasSelection) parts.push("2.5rem");
  for (const c of columns) parts.push(c.width ?? "minmax(8rem, 1fr)");
  if (hasActions) parts.push("3rem");
  return parts.join(" ");
}
