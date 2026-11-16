import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import {
  AttendanceDuplicatePunchError,
  AttendanceImmutableError,
  AttendanceRecordInvalidError,
  AttendanceRecordNotFoundError,
  AttendanceSessionOverlapError,
  EmployeeNotFoundError,
} from "../domain/hr-errors";
import { classifyCaptureConflict } from "../domain/attendance-classification";
import * as attendance from "../infrastructure/attendance.store";
import { employeeExists } from "../infrastructure/hr.store";

/**
 * PHASE-045 (T-04) — the attendance service: punch-session capture,
 * the DERIVED daily status (roster + holiday + leave), the exception
 * computation, and BR-082's immutability window.
 *
 * THE DERIVATION LAW (the day is the unit, never the row): a day's
 * verdict is computed from the union of the day's sessions against the
 * roster shift's instants (the TENANT's timezone; a declared night
 * crossing ends on work_date + 1):
 *
 *   HOLIDAY      a tenant-jurisdiction holiday covers the date (a
 *                holiday day is NEVER late/absent — the absence
 *                derivation's floor; worked/overtime facts still
 *                compute when someone worked the holiday — T-06's
 *                holiday-tier overtime consumes them);
 *   ON_LEAVE     an APPROVED leave request covers the date (priority
 *                under HOLIDAY — a holiday is not charged to the
 *                leave balance);
 *   ABSENT       no punch at all on an already-happened ROSTERED day —
 *                synthesized as a (null, null) marker row at derivation
 *                time (append-only; a later real punch re-derives the
 *                day and the marker follows the day's verdict);
 *   MISSING_PUNCH  any session still open (check_in without check_out)
 *                — an unclosed session is an exception until closed;
 *   LATE         the first check-in past the shift start + grace;
 *   PRESENT      everything else (an unrostered day with punches
 *                derives PRESENT with no shift-relative facts).
 *
 * THE EXCEPTION SET: ABSENT, MISSING_PUNCH, and LATE (past grace)
 * carry is_exception = true — the register board's feed; early leave
 * and overtime are recorded as FACTS without an invented threshold
 * (the BR-055 no-fabricated-defaults discipline — a threshold would be
 * a policy, and no such policy exists yet).
 *
 * BR-082 (the immutability window): check_in is immutable from
 * creation; check_out may be filled EXACTLY ONCE (completing the
 * session) and is immutable after; every other punch field is
 * append-only — corrections arrive as NEW rows (the import's
 * quarantine discipline, T-05). The only other write path is the
 * derivation write, which touches STATUS fields only (never punch
 * fields) and is idempotent (an unchanged verdict writes nothing — no
 * version churn).
 *
 * Attendance, rosters, and shifts are NOT ledger documents (the
 * posting canon's note — nothing here posts anything).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The derivation horizon cap: a backfill run is bounded (a quarter) —
 * larger spans are multiple deliberate runs (the rotation precedent). */
const MAX_DERIVE_DAYS = 92;
const MS_PER_MINUTE = 60_000;

function isoDate(date: string, what: string): string {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new AttendanceRecordInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${date}`);
  }
  return date;
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** A timestamp input: a parseable ISO-8601 instant (Z or offset) —
 * PostgreSQL casts it to timestamptz at the store; the shape is
 * refused typed here, never as a raw driver error. */
function isoInstant(at: string, what: string): string {
  if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(at) || Number.isNaN(Date.parse(at))) {
    throw new AttendanceRecordInvalidError(
      `${what} must be an ISO-8601 instant (e.g. 2026-06-01T08:05:00Z): ${at}`,
    );
  }
  return at;
}

function intParam(value: number | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Exact minute facts: integer floor division of an integer millisecond
 * DIFFERENCE via the house bitwise pattern (ADR-0009 bans Math.floor;
 * the operands are session-span differences, bounded by the 2-day
 * punch envelope — far inside the 2^31 safe range) — never float
 * rounding of money-shaped values. */
function minutesFromMs(ms: number): number {
  return (ms / MS_PER_MINUTE) | 0;
}

/** The day verdict written to every row of the (employee, work_date). */
interface DayVerdict {
  shiftId: string | null;
  derivedStatus: "PRESENT" | "LATE" | "ABSENT" | "MISSING_PUNCH" | "HOLIDAY" | "ON_LEAVE";
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  isException: boolean;
}

function verdictEqualsRow(verdict: DayVerdict, row: attendance.DerivationRow): boolean {
  return (
    row.derivedStatus === verdict.derivedStatus &&
    row.lateMinutes === verdict.lateMinutes &&
    row.earlyLeaveMinutes === verdict.earlyLeaveMinutes &&
    row.workedMinutes === verdict.workedMinutes &&
    row.overtimeMinutes === verdict.overtimeMinutes &&
    row.isException === verdict.isException &&
    row.shiftId === verdict.shiftId
  );
}

@Injectable()
export class AttendanceService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- capture -----------------------------------------------------------------------

  /** Capture a punch session (the back-office path — the import
   * pipeline is T-05): a session OPENS with a check-in (the 0081
   * session-shape law); an optional check-out records a complete
   * session after the fact. INV-031: the new interval must not overlap
   * any existing session of the same employee-day (an open session
   * extends to +∞ — it blocks every later session until closed). */
  async capture(input: {
    employeeId: string;
    workDate: string;
    checkIn: string;
    checkOut: string | null;
    source: "MANUAL" | "DEVICE";
    deviceRef: string | null;
    geoLat: number | null;
    geoLng: number | null;
    note: string | null;
    actorId: string | null;
  }): Promise<attendance.AttendanceRecordRow> {
    const workDate = isoDate(input.workDate, "workDate");
    const checkIn = isoInstant(input.checkIn, "checkIn");
    const checkOut = input.checkOut === null ? null : isoInstant(input.checkOut, "checkOut");
    if (input.source === "DEVICE" && (input.deviceRef === null || input.deviceRef.length === 0)) {
      throw new AttendanceRecordInvalidError("a DEVICE-source record requires a deviceRef (the 0081 device-shape law)");
    }
    if (input.source === "MANUAL" && input.deviceRef !== null) {
      throw new AttendanceRecordInvalidError("a MANUAL-source record carries no deviceRef (the 0081 device-shape law)");
    }
    if (input.geoLat !== null && (input.geoLat < -90 || input.geoLat > 90)) {
      throw new AttendanceRecordInvalidError(`geoLat must be within -90…90: ${input.geoLat}`);
    }
    if (input.geoLng !== null && (input.geoLng < -180 || input.geoLng > 180)) {
      throw new AttendanceRecordInvalidError(`geoLng must be within -180…180: ${input.geoLng}`);
    }
    if (!(await employeeExists(input.employeeId))) {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    const checkInMs = Date.parse(checkIn);
    const checkOutMs = checkOut === null ? null : Date.parse(checkOut);
    if (checkOutMs !== null && checkOutMs <= checkInMs) {
      throw new AttendanceRecordInvalidError("checkOut must be after checkIn (the 0081 interval law)");
    }
    // The punch envelope: both timestamps must fall on the work date or
    // the day after it (the tenant's timezone).
    if (!(await attendance.timestampInEnvelope(checkIn, workDate))) {
      throw new AttendanceRecordInvalidError(
        `checkIn must fall on ${workDate} or the day after (the tenant's timezone — the operational day's envelope): ${checkIn}`,
      );
    }
    if (checkOut !== null && !(await attendance.timestampInEnvelope(checkOut, workDate))) {
      throw new AttendanceRecordInvalidError(
        `checkOut must fall on ${workDate} or the day after (the tenant's timezone — the operational day's envelope): ${checkOut}`,
      );
    }
    // INV-031 + the dedupe floor, BEFORE any write. The classification
    // itself is the domain law (order-independent by construction — the
    // T-19 review round: listDerivationRows carries no ORDER BY, so a
    // single interleaved pass let PostgreSQL's heap order pick the typed
    // code; the exact-match floor now decides over the whole day first,
    // the import path's proven shape).
    const dayRows = await attendance.listDerivationRows({
      from: workDate,
      to: workDate,
      employeeIds: [input.employeeId],
    });
    const conflict = classifyCaptureConflict(dayRows, checkInMs, checkOutMs);
    if (conflict === "DUPLICATE_PUNCH") {
      throw new AttendanceDuplicatePunchError(
        `a session for this employee already opens at ${checkIn} on ${workDate} — the same employee + timestamp is ONE session (the 0081 dedupe floor)`,
      );
    }
    if (conflict === "SESSION_OVERLAP") {
      throw new AttendanceSessionOverlapError(
        `the session [${checkIn} → ${checkOut ?? "open"}] overlaps an existing session of this employee-day (INV-031: attendance intervals never overlap per employee-day)`,
      );
    }
    const created = await attendance.insertAttendanceRecord({
      employeeId: input.employeeId,
      workDate,
      checkIn,
      checkOut,
      source: input.source,
      deviceRef: input.deviceRef,
      geoLat: input.geoLat,
      geoLng: input.geoLng,
      note: input.note,
      createdBy: input.actorId,
    });
    // The day derives immediately on every write — a row never rests
    // with a stale verdict.
    await this.deriveDays({
      from: workDate,
      to: workDate,
      employeeIds: [input.employeeId],
      actorId: null,
    });
    await this.audit.record({
      action: "hr.attendance_captured",
      entityType: "attendance_record",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        employeeId: input.employeeId,
        workDate,
        checkIn,
        checkOut,
        source: input.source,
      },
    });
    return (await attendance.findAttendanceRecordById(created.id))!;
  }

  // -- the one-shot checkout (BR-082's only punch-mutating arm) -----------------------

  /** Complete the open session: check_out is filled EXACTLY ONCE. A
   * second fill — or a checkout of an already-complete session — is
   * the typed BR-082 refusal (the committed punch is immutable;
   * corrections arrive as new rows). */
  async checkout(
    recordId: string,
    checkOut: string,
    actorId: string | null,
  ): Promise<attendance.AttendanceRecordRow> {
    const at = isoInstant(checkOut, "checkOut");
    const record = await attendance.findAttendanceRecordById(recordId);
    if (record === undefined) {
      throw new AttendanceRecordNotFoundError(recordId);
    }
    // A synthesized ABSENT marker carries no session — there is nothing
    // to close (BR-082: it is a derived marker, never a punch).
    if (record.checkIn === null) {
      throw new AttendanceImmutableError(
        `attendance record ${recordId} is a derived absence marker — it carries no open session to close (BR-082)`,
      );
    }
    if (record.checkOut !== null) {
      throw new AttendanceImmutableError(
        `attendance record ${recordId} is already closed at ${record.checkOut} — a committed check-out is immutable (BR-082); corrections arrive as NEW rows`,
      );
    }
    const checkOutMs = Date.parse(at);
    if (checkOutMs <= Date.parse(record.checkIn!)) {
      throw new AttendanceRecordInvalidError("checkOut must be after checkIn (the 0081 interval law)");
    }
    if (!(await attendance.timestampInEnvelope(at, record.workDate))) {
      throw new AttendanceRecordInvalidError(
        `checkOut must fall on ${record.workDate} or the day after (the tenant's timezone — the operational day's envelope): ${at}`,
      );
    }
    // INV-031 against the day's OTHER sessions: closing [checkIn → ∞)
    // at `at` must not overlap a sibling session.
    const dayRows = await attendance.listDerivationRows({
      from: record.workDate,
      to: record.workDate,
      employeeIds: [record.employeeId],
    });
    const checkInMs = Date.parse(record.checkIn!);
    for (const row of dayRows) {
      if (row.id === recordId || row.checkInMs === null) continue;
      const siblingEnd = row.checkOutMs ?? Number.POSITIVE_INFINITY;
      if (row.checkInMs < checkOutMs && checkInMs < siblingEnd) {
        throw new AttendanceSessionOverlapError(
          `closing the session at ${at} would overlap a sibling session of this employee-day (INV-031)`,
        );
      }
    }
    const filled = await attendance.fillAttendanceCheckOut(recordId, at);
    if (filled === undefined) {
      throw new AttendanceImmutableError(
        `attendance record ${recordId} was already closed — a committed check-out is immutable (BR-082)`,
      );
    }
    await this.deriveDays({
      from: record.workDate,
      to: record.workDate,
      employeeIds: [record.employeeId],
      actorId: null,
    });
    await this.audit.record({
      action: "hr.attendance_checkout",
      entityType: "attendance_record",
      entityId: recordId,
      actorId: actorId ?? undefined,
      before: { checkOut: null },
      after: { checkOut: at },
    });
    return (await attendance.findAttendanceRecordById(recordId))!;
  }

  // -- the reads ----------------------------------------------------------------------

  /** The daily register: the day's rows (sessions + derived markers)
   * joined with the employee and shift dims, ordered for the board. */
  async register(date: string): Promise<{ date: string; rows: attendance.AttendanceRecordRow[] }> {
    return { date: isoDate(date, "date"), rows: await attendance.listRegisterRows(date) };
  }

  /** The exception board (paginated — the joint-review pagination law:
   * every page carries total + hasMore, the explicit truncation
   * signal; a caller walks pages until hasMore flips false). */
  async exceptions(input: {
    from: string;
    to: string;
    employeeIds?: readonly string[];
    page?: number;
    pageSize?: number;
  }): Promise<{
    rows: attendance.AttendanceRecordRow[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const from = isoDate(input.from, "from");
    const to = isoDate(input.to, "to");
    if (to < from) {
      throw new AttendanceRecordInvalidError(`the exception range is inverted: ${from} → ${to}`);
    }
    if (daysBetween(from, to) + 1 > MAX_DERIVE_DAYS) {
      throw new AttendanceRecordInvalidError(
        `the exception range is too wide (max ${MAX_DERIVE_DAYS} days): ${from} → ${to}`,
      );
    }
    const page = Math.max(intParam(input.page, 1), 1);
    const pageSize = Math.min(Math.max(intParam(input.pageSize, 500), 1), 5000);
    const rows = await attendance.listExceptionRows({
      from,
      to,
      employeeIds: input.employeeIds,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = await attendance.countExceptionRows({ from, to, employeeIds: input.employeeIds });
    return { rows, page, pageSize, total, hasMore: page * pageSize < total };
  }

  // -- the derivation run --------------------------------------------------------------

  /** Derive a range (the backfill): for every (employee, work_date)
   * that has rows OR a rostered shift in the window, compute the day
   * verdict and write it to the day's rows (status fields only). A
   * rostered, already-happened day with NO punch synthesizes its
   * ABSENT marker (append-only). Idempotent: an unchanged verdict
   * writes nothing (no version churn).
   *
   * The employeeIds law follows the rotation case law (c537113): the
   * ids are normalized to canonical lowercase before the uniqueness
   * comparison — a case-varied repeated id is refused typed. */
  async deriveDays(input: {
    from: string;
    to: string;
    employeeIds?: readonly string[];
    actorId: string | null;
  }): Promise<{ days: number; rowsUpdated: number; absentSynthesized: number }> {
    const from = isoDate(input.from, "from");
    const to = isoDate(input.to, "to");
    if (to < from) {
      throw new AttendanceRecordInvalidError(`the derivation range is inverted: ${from} → ${to}`);
    }
    if (daysBetween(from, to) + 1 > MAX_DERIVE_DAYS) {
      throw new AttendanceRecordInvalidError(
        `the derivation range is too wide (max ${MAX_DERIVE_DAYS} days): ${from} → ${to}`,
      );
    }
    let employeeIds = input.employeeIds;
    if (employeeIds !== undefined && employeeIds.length > 0) {
      const distinct = new Set(employeeIds.map((id) => id.toLowerCase()));
      if (distinct.size !== employeeIds.length) {
        throw new AttendanceRecordInvalidError(
          "employeeIds must be unique (case-insensitive uuid comparison) — a repeated id would derive the same employee-day twice",
        );
      }
    } else {
      employeeIds = undefined;
    }

    const window = await attendance.loadDerivationWindow({ from, to, employeeIds });
    const rows = await attendance.listDerivationRows({ from, to, employeeIds });

    // The universe: every (employee, date) with rows OR a rostered
    // shift (an unrostered, punchless day is nobody's absence).
    const universe = new Map<string, attendance.DerivationRow[]>();
    for (const row of rows) {
      const key = `${row.employeeId}|${row.workDate}`;
      const bucket = universe.get(key);
      if (bucket === undefined) universe.set(key, [row]);
      else bucket.push(row);
    }
    for (const key of window.roster.keys()) {
      if (!universe.has(key)) universe.set(key, []);
    }

    let rowsUpdated = 0;
    let absentSynthesized = 0;
    for (const [key, dayRows] of universe) {
      // `${employeeId}|${workDate}` — a uuid contains no '|', so the
      // FIRST separator splits the key exactly (no undefined arms under
      // noUncheckedIndexedAccess).
      const separator = key.indexOf("|");
      const employeeId = key.slice(0, separator);
      const workDate = key.slice(separator + 1);
      const holiday = window.holidays.has(workDate);
      const onLeave = window.leaves.some(
        (leave) => leave.employeeId === employeeId && leave.startDate <= workDate && workDate <= leave.endDate,
      );
      const shift = window.roster.get(key) ?? null;

      // The ABSENT synthesis: a rostered day that already happened,
      // with no punch, no holiday, no leave — recorded as the (null,
      // null) marker (append-only; a later punch re-derives the day and
      // the marker follows the verdict).
      if (
        dayRows.length === 0 &&
        shift !== null &&
        !holiday &&
        !onLeave &&
        workDate <= window.today
      ) {
        await attendance.insertDerivedAbsenceRow({
          employeeId,
          workDate,
          shiftId: shift.shiftId,
          createdBy: input.actorId,
        });
        absentSynthesized += 1;
        continue;
      }
      if (dayRows.length === 0) continue;

      const verdict = this.computeDayVerdict({ workDate, holiday, onLeave, shift, dayRows });
      for (const row of dayRows) {
        if (verdictEqualsRow(verdict, row)) continue;
        await attendance.updateAttendanceDerivation({
          id: row.id,
          shiftId: verdict.shiftId,
          derivedStatus: verdict.derivedStatus,
          lateMinutes: verdict.lateMinutes,
          earlyLeaveMinutes: verdict.earlyLeaveMinutes,
          workedMinutes: verdict.workedMinutes,
          overtimeMinutes: verdict.overtimeMinutes,
          isException: verdict.isException,
        });
        rowsUpdated += 1;
      }
    }

    // The audit trail anchors on the first row of the window (the
    // rotation precedent); the derive-for-capture path (actorId null)
    // skips the audit record — the capture/checkout actions already
    // carry their own.
    if (input.actorId !== null) {
      await this.audit.record({
        action: "hr.attendance_derived",
        entityType: "attendance_record",
        entityId: rows[0]?.id ?? generateUuidV7(),
        actorId: input.actorId,
        after: { from, to, days: daysBetween(from, to) + 1, rowsUpdated, absentSynthesized },
      });
    }
    return {
      days: daysBetween(from, to) + 1,
      rowsUpdated,
      absentSynthesized,
    };
  }

  // -- the verdict (pure) ---------------------------------------------------------------

  private computeDayVerdict(input: {
    workDate: string;
    holiday: boolean;
    onLeave: boolean;
    shift: attendance.RosterShiftFacts | null;
    dayRows: readonly attendance.DerivationRow[];
  }): DayVerdict {
    const sessions = input.dayRows.filter((row) => row.checkInMs !== null);
    const open = sessions.some((row) => row.checkOutMs === null);
    const shiftId = input.shift?.shiftId ?? null;

    // HOLIDAY > ON_LEAVE > the operational family (a holiday is never
    // charged to a leave balance; neither is ever late or absent).
    if (input.holiday || input.onLeave) {
      const facts = this.sessionFacts(sessions, input.shift);
      return {
        shiftId,
        derivedStatus: input.holiday ? "HOLIDAY" : "ON_LEAVE",
        lateMinutes: null,
        earlyLeaveMinutes: null,
        workedMinutes: facts.workedMinutes,
        overtimeMinutes: facts.overtimeMinutes,
        isException: false,
      };
    }

    // No real punch: the day's rows are markers only.
    if (sessions.length === 0) {
      return {
        shiftId,
        derivedStatus: "ABSENT",
        lateMinutes: null,
        earlyLeaveMinutes: null,
        workedMinutes: null,
        overtimeMinutes: null,
        isException: true,
      };
    }

    const firstInMs = Math.min(...sessions.map((row) => row.checkInMs!));
    const closedOuts = sessions.map((row) => row.checkOutMs).filter((out): out is number => out !== null);
    const lastOutMs = closedOuts.length > 0 ? Math.max(...closedOuts) : null;
    const totalSessionMs = sessions.reduce(
      (sum, row) => (row.checkOutMs === null ? sum : sum + (row.checkOutMs - row.checkInMs!)),
      0,
    );

    let lateMinutes: number | null = null;
    let earlyLeaveMinutes: number | null = null;
    let workedMinutes: number | null = null;
    let overtimeMinutes: number | null = null;

    if (input.shift !== null) {
      const lateMs = firstInMs - (input.shift.shiftStartMs + input.shift.graceMinutes * MS_PER_MINUTE);
      lateMinutes = lateMs > 0 ? minutesFromMs(lateMs) : 0;
      earlyLeaveMinutes = lastOutMs === null ? null : Math.max(0, minutesFromMs(input.shift.shiftEndMs - lastOutMs));
      workedMinutes = Math.max(
        0,
        minutesFromMs(totalSessionMs) - input.shift.breakMinutes,
      );
      overtimeMinutes = lastOutMs === null ? null : Math.max(0, minutesFromMs(lastOutMs - input.shift.shiftEndMs));
    } else {
      // Unrostered punches: PRESENT with the raw span — no
      // shift-relative facts (nothing to be late against; the BR-055
      // discipline: no fabricated defaults).
      workedMinutes = minutesFromMs(totalSessionMs);
    }

    const derivedStatus = open
      ? "MISSING_PUNCH"
      : lateMinutes !== null && lateMinutes > 0
        ? "LATE"
        : "PRESENT";
    return {
      shiftId,
      derivedStatus,
      lateMinutes,
      earlyLeaveMinutes,
      workedMinutes,
      overtimeMinutes,
      isException: derivedStatus === "MISSING_PUNCH" || derivedStatus === "LATE",
    };
  }

  /** The worked/overtime facts for HOLIDAY/ON_LEAVE days where someone
   * worked (T-06's holiday-tier overtime consumes them); late/early
   * stay NULL — a holiday is never late. */
  private sessionFacts(
    sessions: readonly attendance.DerivationRow[],
    shift: attendance.RosterShiftFacts | null,
  ): { workedMinutes: number | null; overtimeMinutes: number | null } {
    if (sessions.length === 0) return { workedMinutes: null, overtimeMinutes: null };
    const closedOuts = sessions.map((row) => row.checkOutMs).filter((out): out is number => out !== null);
    if (closedOuts.length === 0) return { workedMinutes: null, overtimeMinutes: null };
    const totalSessionMs = sessions.reduce(
      (sum, row) => (row.checkOutMs === null ? sum : sum + (row.checkOutMs - row.checkInMs!)),
      0,
    );
    const lastOutMs = Math.max(...closedOuts);
    return {
      workedMinutes: shift === null
        ? minutesFromMs(totalSessionMs)
        : Math.max(0, minutesFromMs(totalSessionMs) - shift.breakMinutes),
      overtimeMinutes:
        shift === null ? null : Math.max(0, minutesFromMs(lastOutMs - shift.shiftEndMs)),
    };
  }
}
