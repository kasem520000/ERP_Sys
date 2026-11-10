"use client";

/**
 * DatePicker / DateRangePicker (COMPONENT_CATALOG §6.3 + RTL_DESIGN_RULES §7).
 *
 * - Typed input accepts canonical Gregorian `YYYY-MM-DD`; stored value is
 *   ALWAYS canonical Gregorian (A-004: fiscal years stay Gregorian).
 * - Calendar grid mirrors in RTL (week start at the start edge; Saturday for
 *   `ar-SA` default); day cells 32px; weekday header is a real row header.
 * - Dual-calendar when `hijriDisplay` (tenant setting `general.hijri_display`):
 *   primary large + secondary Hijri caption line per cell — never two grids.
 * - Range announced as ONE announcement; presets are the common path.
 */
import type { JSX } from "react";
import { useId, useMemo, useState } from "react";

import { cn } from "../utils/cn";
import {
  addMonths,
  daysInMonth,
  gregorianMonthName,
  hijriCaption,
  isoFromYMD,
  monthCaption,
  monthGrid,
  presetRange,
  weekdayHeaders,
  ymdFromIso,
  ymdToDate,
  dateToYmd,
  type CalendarSystem,
  type DateRangePresetId,
  type GregorianYMD,
} from "../utils/dates";
import { Icon } from "../utils/icons";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "../primitives/popover";
import { controlCx } from "../utils/direction";

function useCalendar(initialIso?: string): {
  view: GregorianYMD;
  setView: (ymd: GregorianYMD) => void;
  today: Date;
} {
  const today = useMemo(() => new Date(), []);
  const initial = initialIso !== undefined && ymdFromIso(initialIso) !== null ? ymdFromIso(initialIso) : undefined;
  const [view, setView] = useState<GregorianYMD>(initial ?? dateToYmd(today));
  return { view, setView, today };
}

function CalendarGrid({
  view,
  selected,
  onSelect,
  locale,
  hijriDisplay,
  inRange,
  min,
  max,
}: {
  view: GregorianYMD;
  selected?: string;
  onSelect: (iso: string) => void;
  locale: "ar" | "en";
  hijriDisplay: boolean;
  inRange?: (iso: string) => boolean;
  min?: string;
  max?: string;
}): JSX.Element {
  void 0;
  const weekStartsSaturday = locale === "ar";
  const headers = weekdayHeaders(locale, weekStartsSaturday);
  const cells = monthGrid(view, weekStartsSaturday);
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-7 text-center" role="row">
        {headers.map((h) => (
          <div key={h} role="columnheader" className="py-1 text-xs text-gray-500">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0" role="rowgroup">
        {cells.map(({ ymd, inMonth }) => {
          const iso = isoFromYMD(ymd);
          const isSel = iso === selected;
          const isInRange = inRange?.(iso) ?? false;
          const outOfRange =
            (min !== undefined && iso < min) || (max !== undefined && iso > max);
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              aria-selected={isSel}
              aria-disabled={outOfRange || undefined}
              onClick={() => !outOfRange && onSelect(iso)}
              className={cn(
                "flex h-8 w-8 flex-col items-center justify-center rounded-sm text-xs tabular-nums outline-none",
                inMonth ? "text-gray-800 hover:bg-primary-50" : "text-gray-400",
                isSel && "bg-primary-600 font-medium text-white hover:bg-primary-700",
                isInRange && !isSel && "bg-primary-50",
                outOfRange && "cursor-not-allowed text-gray-300 hover:bg-transparent",
              )}
            >
              <span dir="ltr">{ymd.day}</span>
            </button>
          );
        })}
      </div>
      {hijriDisplay && (
        <p className="mt-1 text-center text-xs text-gray-500">
          {hijriCaption(ymdToDate(view), locale)}
        </p>
      )}
    </div>
  );
}

function CalendarHeader({
  view,
  locale,
  calendar,
  onPrev,
  onNext,
}: {
  view: GregorianYMD;
  locale: "ar" | "en";
  calendar: CalendarSystem;
  onPrev: () => void;
  onNext: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 pb-1">
      <button type="button" aria-label="previous month" onClick={onPrev} className="rounded-md p-1 hover:bg-surface-sunken">
        <Icon name="chevron-start" size={16} className="text-gray-600" />
      </button>
      <p className="text-sm font-medium text-gray-900" aria-live="polite">
        {monthCaption(view, locale, calendar)}
      </p>
      <button type="button" aria-label="next month" onClick={onNext} className="rounded-md p-1 hover:bg-surface-sunken">
        <Icon name="chevron-end" size={16} className="text-gray-600" />
      </button>
    </div>
  );
}

export interface DatePickerProps {
  /** Canonical Gregorian YYYY-MM-DD. */
  value?: string;
  onSelect: (iso: string) => void;
  locale: "ar" | "en";
  /** Display calendar for the primary caption (default gregory). */
  calendar?: CalendarSystem;
  /** Tenant setting general.hijri_display — secondary Hijri caption line. */
  hijriDisplay?: boolean;
  min?: string;
  max?: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function DatePicker({
  value,
  onSelect,
  locale,
  calendar = "gregory",
  hijriDisplay = false,
  min,
  max,
  label,
  error,
  disabled,
  required,
  placeholder = "YYYY-MM-DD",
  className,
  id,
}: DatePickerProps): JSX.Element {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const { view, setView, today } = useCalendar(value);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(value ?? "");
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
      <PopoverRoot
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next && value !== undefined) {
            const parsed = ymdFromIso(value);
            if (parsed !== null) setView(parsed);
          }
        }}
      >
        <div className="relative flex w-full items-center">
          <input
            id={fieldId}
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            value={typed}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            aria-invalid={error !== undefined || undefined}
            onChange={(e) => {
              setTyped(e.target.value);
              const parsed = ymdFromIso(e.target.value);
              if (parsed !== null) {
                onSelect(e.target.value);
                setView(parsed);
              }
            }}
            className={cn(
              "w-full rounded-md border border-default bg-surface-card px-3 pe-9 font-mono text-sm tabular-nums text-gray-900 outline-none",
              "hover:border-strong focus:border-primary-600 disabled:bg-surface-sunken disabled:text-gray-400",
              "aria-[invalid=true]:border-danger-700",
              controlCx,
            )}
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="open calendar"
              disabled={disabled}
              className="absolute end-2 rounded-sm p-0.5 text-gray-500 hover:text-gray-700"
            >
              <Icon name="calendar" size={16} />
            </button>
          </PopoverTrigger>
        </div>
        <PopoverContent align="start" className="w-72">
          <CalendarHeader
            view={view}
            locale={locale}
            calendar={calendar}
            onPrev={() => setView(addMonths(view, -1))}
            onNext={() => setView(addMonths(view, 1))}
          />
          <CalendarGrid
            view={view}
            selected={value}
            onSelect={(iso) => {
              onSelect(iso);
              setTyped(iso);
              setOpen(false);
            }}
            locale={locale}
            hijriDisplay={hijriDisplay}
            min={min}
            max={max}
          />
          <p className="sr-only" aria-live="polite">
            {value !== undefined ? `${value}${hijriDisplay ? ` — ${hijriCaption(ymdToDate(ymdFromIso(value) ?? dateToYmd(today)), locale)}` : ""}` : ""}
          </p>
        </PopoverContent>
      </PopoverRoot>
      {error !== undefined && (
        <p className="text-xs text-danger-700" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export interface DateRangePickerProps {
  start?: string;
  end?: string;
  onSelect: (range: { start: string; end: string }) => void;
  locale: "ar" | "en";
  calendar?: CalendarSystem;
  hijriDisplay?: boolean;
  /** Presets (catalog: this month / quarter / fiscal year). */
  presets?: Array<{ id: DateRangePresetId; label: string }>;
  fiscalYearStartMonth?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function DateRangePicker({
  start,
  end,
  onSelect,
  locale,
  calendar = "gregory",
  hijriDisplay = false,
  presets,
  fiscalYearStartMonth = 1,
  label,
  disabled,
  className,
}: DateRangePickerProps): JSX.Element {
  const { view, setView, today } = useCalendar(start);
  const [open, setOpen] = useState(false);
  const effectivePresets = presets ?? [
    { id: "this-month" as DateRangePresetId, label: locale === "ar" ? "هذا الشهر" : "This month" },
    { id: "this-quarter" as DateRangePresetId, label: locale === "ar" ? "هذا الربع" : "This quarter" },
    { id: "fiscal-year" as DateRangePresetId, label: locale === "ar" ? "السنة المالية" : "Fiscal year" },
  ];
  const inRange = (iso: string): boolean => start !== undefined && end !== undefined && iso >= start && iso <= end;
  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      {label !== undefined && <span className="text-sm font-medium text-gray-700">{label}</span>}
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md border border-default bg-surface-card px-3 text-sm outline-none hover:border-strong",
              controlCx,
            )}
          >
            <span dir="ltr" className="font-mono text-xs tabular-nums text-gray-800">
              {start ?? "YYYY-MM-DD"} → {end ?? "YYYY-MM-DD"}
            </span>
            <Icon name="calendar" size={16} className="text-gray-500" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              {effectivePresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    const r = presetRange(p.id, today, fiscalYearStartMonth);
                    onSelect({ start: isoFromYMD(r.start), end: isoFromYMD(r.end) });
                  }}
                  className="rounded-full border border-subtle bg-surface-sunken px-2 py-0.5 text-xs text-gray-700 hover:border-strong"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <CalendarHeader
              view={view}
              locale={locale}
              calendar={calendar}
              onPrev={() => setView(addMonths(view, -1))}
              onNext={() => setView(addMonths(view, 1))}
            />
            <CalendarGrid
              view={view}
              selected={end ?? start}
              inRange={inRange}
              onSelect={(iso) => {
                if (start === undefined || (start !== undefined && end !== undefined)) {
                  onSelect({ start: iso, end: iso });
                } else {
                  // one announcement for the whole range (catalog §6.3)
                  const [lo, hi] = iso < start ? [iso, start] : [start, iso];
                  onSelect({ start: lo, end: hi });
                }
              }}
              locale={locale}
              hijriDisplay={hijriDisplay}
            />
            <p aria-live="polite" className="text-center text-xs text-gray-600 tabular-nums">
              {start !== undefined && end !== undefined ? `${start} → ${end}` : ""}
            </p>
          </div>
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}

export { gregorianMonthName, daysInMonth };
