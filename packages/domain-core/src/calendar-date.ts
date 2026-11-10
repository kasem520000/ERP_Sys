import { InvalidValueError } from "./errors";

const MS_PER_DAY = 86_400_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Calendar date (business date) per API_CONVENTIONS §7: ISO 8601 `YYYY-MM-DD`,
 * never a timestamp. Timezone semantics belong to the using field; this type
 * only guarantees a valid, unambiguous calendar date.
 */
export class CalendarDate {
  private constructor(
    readonly iso: string,
    private readonly epochDay: number,
  ) {}

  static fromString(iso: string): CalendarDate {
    if (typeof iso !== "string" || !ISO_DATE_PATTERN.test(iso)) {
      throw new InvalidValueError(`Invalid calendar date "${String(iso)}" — expected YYYY-MM-DD`);
    }
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const day = Number(iso.slice(8, 10));
    if (month < 1 || month > 12) {
      throw new InvalidValueError(`Invalid month in "${iso}"`, { iso });
    }
    if (day < 1 || day > daysInMonth(year, month)) {
      throw new InvalidValueError(`Invalid day in "${iso}"`, { iso });
    }
    // Valid UTC-midnight dates divide exactly — no rounding involved.
    const epochDay = Date.UTC(year, month - 1, day) / MS_PER_DAY;
    return new CalendarDate(iso, epochDay);
  }

  static fromEpochDay(epochDay: number): CalendarDate {
    const iso = new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
    return CalendarDate.fromString(iso);
  }

  /** Today in the given IANA timezone (defaults to system timezone). */
  static today(timeZone?: string): CalendarDate {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
    return CalendarDate.fromString(formatter.format(new Date()));
  }

  addDays(days: number): CalendarDate {
    return CalendarDate.fromEpochDay(this.epochDay + days);
  }

  daysBetween(other: CalendarDate): number {
    return other.epochDay - this.epochDay;
  }

  equals(other: CalendarDate): boolean {
    return this.epochDay === other.epochDay;
  }

  compare(other: CalendarDate): number {
    return Math.sign(this.epochDay - other.epochDay);
  }

  toJSON(): string {
    return this.iso;
  }

  toString(): string {
    return this.iso;
  }
}
