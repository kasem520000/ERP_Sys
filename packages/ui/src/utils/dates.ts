/**
 * Date helpers for the pickers (COMPONENT_CATALOG §6.3, RTL_DESIGN_RULES §7).
 *
 * Stored/committed values are ALWAYS canonical Gregorian `YYYY-MM-DD`
 * (fiscal years stay Gregorian per A-004). Hijri display uses
 * `islamic-umalqura` via Intl — display-only, dual-calendar = primary large +
 * secondary caption line, never two side-by-side grids.
 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CalendarSystem = "gregory" | "islamic-umalqura";

export interface GregorianYMD {
  year: number;
  month: number; // 1-12
  day: number;
}

export function ymdToDate({ year, month, day }: GregorianYMD): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateToYmd(date: Date): GregorianYMD {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function isoFromYMD(ymd: GregorianYMD): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(ymd.year, 4)}-${pad(ymd.month)}-${pad(ymd.day)}`;
}

export function ymdFromIso(iso: string): GregorianYMD | null {
  if (!ISO_DATE.test(iso)) return null;
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d };
}

function safeFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return null;
  }
}

/** Gregorian month name for the active locale (`ar`, `en`). */
export function gregorianMonthName(month: number, locale: string): string {
  const fmt = safeFormatter(locale, { month: "long", timeZone: "UTC" });
  return fmt ? fmt.format(new Date(Date.UTC(2026, month - 1, 1))) : String(month);
}

/** Weekday short names starting at the week start (Saturday for `ar-SA` default per RTL §7). */
export function weekdayHeaders(locale: string, weekStartsOnSaturday: boolean): string[] {
  const fmt = safeFormatter(locale, { weekday: "short", timeZone: "UTC" });
  const names: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    // 2026-10-31 is a Saturday
    const day = weekStartsOnSaturday ? i : (i + 6) % 7;
    names.push(fmt ? fmt.format(new Date(Date.UTC(2026, 9, 31 + day))) : String(i));
  }
  return names;
}

/**
 * Hijri secondary caption line (`islamic-umalqura`) for a Gregorian day —
 * e.g. `١٤ جمادى الآخرة ١٤٤٨هـ` / `14 Jumada al-Akhirah 1448 AH`.
 */
export function hijriCaption(date: Date, locale: string): string {
  const cal = locale === "ar" ? "ar-SA-u-ca-islamic-umalqura" : "en-u-ca-islamic-umalqura";
  const fmt = safeFormatter(cal, { day: "numeric", month: "long", year: "numeric" });
  if (!fmt) return "";
  return fmt.format(date).replace(/ AH$/i, " AH");
}

/** Primary caption: month + year in the active calendar/locale. */
export function monthCaption(ymd: GregorianYMD, locale: string, calendar: CalendarSystem): string {
  if (calendar === "islamic-umalqura") {
    return hijriCaption(ymdToDate(ymd), locale);
  }
  return `${gregorianMonthName(ymd.month, locale)} ${ymd.year}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 6×7 grid of { ymd, inMonth } — stable geometry; first column = week start. */
export function monthGrid(
  ymd: GregorianYMD,
  weekStartsOnSaturday: boolean,
): Array<{ ymd: GregorianYMD; inMonth: boolean }> {
  const first = new Date(Date.UTC(ymd.year, ymd.month - 1, 1));
  let lead = first.getUTCDay(); // 0=Sun … 6=Sat
  if (weekStartsOnSaturday) lead = (lead + 1) % 7; // make Saturday the first column
  const cells: Array<{ ymd: GregorianYMD; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(first);
    d.setUTCDate(1 - lead + i);
    cells.push({ ymd: dateToYmd(d), inMonth: d.getUTCMonth() === ymd.month - 1 });
  }
  return cells;
}

export function addMonths(ymd: GregorianYMD, delta: number): GregorianYMD {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1 + delta, 1));
  return dateToYmd(d);
}

/** Typed date-range presets (COMPONENT_CATALOG §6.3): this month / quarter / fiscal year. */
export type DateRangePresetId = "this-month" | "this-quarter" | "fiscal-year";

export function presetRange(
  preset: DateRangePresetId,
  today: Date,
  fiscalYearStartMonth = 1,
): { start: GregorianYMD; end: GregorianYMD } {
  const t = dateToYmd(today);
  if (preset === "this-month") {
    return { start: { year: t.year, month: t.month, day: 1 }, end: { year: t.year, month: t.month, day: daysInMonth(t.year, t.month) } };
  }
  if (preset === "this-quarter") {
    // eslint-disable-next-line no-restricted-properties -- calendar quarter index, not money math.
    const q = Math.floor((t.month - 1) / 3);
    const startMonth = q * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      start: { year: t.year, month: startMonth, day: 1 },
      end: { year: t.year, month: endMonth, day: daysInMonth(t.year, endMonth) },
    };
  }
  // fiscal year: starts at fiscalYearStartMonth of the current cycle; the
  // cycle Jan–Dec ends within the same start year.
  const inCycle = t.month >= fiscalYearStartMonth;
  const startYear = inCycle ? t.year : t.year - 1;
  const endMonth = fiscalYearStartMonth === 1 ? 12 : fiscalYearStartMonth - 1;
  const endYear = fiscalYearStartMonth === 1 ? startYear : startYear + 1;
  return {
    start: { year: startYear, month: fiscalYearStartMonth, day: 1 },
    end: { year: endYear, month: endMonth, day: daysInMonth(endYear, endMonth) },
  };
}
