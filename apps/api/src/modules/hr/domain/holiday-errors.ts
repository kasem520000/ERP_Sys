import { DomainError } from "@erp/domain-core";

/** PHASE-045 (T-08 — the holiday calendars) domain errors. */
export class HolidayCalendarNotFoundError extends DomainError {
  constructor(id: string) {
    super("HOLIDAY_CALENDAR_NOT_FOUND", `holiday calendar ${id} does not exist in this tenant`);
  }
}
export class HolidayCalendarInvalidError extends DomainError {
  constructor(message: string) {
    super("HOLIDAY_CALENDAR_INVALID", message);
  }
}
export class HolidayInvalidError extends DomainError {
  constructor(message: string) {
    super("HOLIDAY_INVALID", message);
  }
}
export class HolidayNotFoundError extends DomainError {
  constructor(id: string) {
    super("HOLIDAY_NOT_FOUND", `holiday ${id} does not exist in this tenant`);
  }
}
