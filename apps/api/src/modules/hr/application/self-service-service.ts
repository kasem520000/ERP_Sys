import { Inject, Injectable } from "@nestjs/common";

import { BridgeService } from "./bridge-service";
import { LeaveService } from "./leave-service";
import { SelfNotLinkedError } from "../domain/self-service-errors";
import { AttendanceRecordInvalidError } from "../domain/hr-errors";
import { LeaveRequestInvalidError, LeaveRequestNotFoundError } from "../domain/leave-errors";
import * as attendance from "../infrastructure/attendance.store";
import * as hrStore from "../infrastructure/hr.store";
import * as leaveStore from "../infrastructure/leave.store";

/**
 * PHASE-045 (T-14) — the employee self-service service: the OWN-ROWS
 * plane over the HR core (the plan's self-service tabs). THE SCOPE LAW
 * (the isolation law, the SoD note's read-side twin): the employee
 * scope is resolved from the ACTING USER through the identity bridge —
 * NEVER from a client-supplied id. A user with no link is nobody's
 * employee here (the field workforce / a pure back-office user): the
 * summary renders that honestly as `employee: null`, and every scoped
 * surface refuses with the same typed error (defense in depth — the
 * page gates on the summary, the API does not trust it).
 *
 * THE SURFACE (deliberately narrow — self-service is a READ-plus-one
 * plane, never an HR management backdoor):
 *   - the OWN attendance calendar (the register's columns, own rows
 *     over a bounded window — the derivation cap);
 *   - the OWN roster (the read-only grid; edits stay on /hr/shifts
 *     under hr.shifts);
 *   - the OWN leave world: balances, requests, the ACTIVE type catalog
 *     (the request form's axis — an inactive type is not requestable,
 *     the leave service's own law), the create-own-request path
 *     (employeeId resolved, never accepted from the body), and the
 *     cancel-own-PENDING decision — the ONE decision an employee owns
 *     (approve/reject stay with hr.leave, the simple-approval chain).
 *
 * A7 PARITY (the cancel path): a foreign tenant's request id and an
 * unknown id are INDISTINGUISHABLE — both render the leave family's
 * own LeaveRequestNotFoundError, never an ownership disclosure.
 */
@Injectable()
export class SelfServiceService {
  constructor(
    @Inject(BridgeService) private readonly bridge: BridgeService,
    @Inject(LeaveService) private readonly leave: LeaveService,
  ) {}

  /** The own-identity summary: the linked employee (or null — the
   * honest empty state the page renders, never an error). */
  async summary(userId: string): Promise<{
    employee: { id: string; code: string; name: string; nameAr: string | null; status: string } | null;
  }> {
    const linked = await this.bridge.resolveByUser(userId);
    if (linked === undefined) {
      return { employee: null };
    }
    return {
      employee: {
        id: linked.id,
        code: linked.code,
        name: linked.name,
        nameAr: linked.nameAr,
        status: linked.status,
      },
    };
  }

  /** The own attendance calendar: the register's rows for the RESOLVED
   * employee over a bounded window (the derivation cap — a wider span
   * is a deliberate range change). */
  async attendance(
    userId: string,
    range: { from: string; to: string },
  ): Promise<{
    employee: { id: string; code: string; name: string; nameAr: string | null; status: string };
    from: string;
    to: string;
    rows: attendance.AttendanceRecordRow[];
  }> {
    const employee = await this.requireLinked(userId);
    const from = selfIsoDate(range.from, "from");
    const to = selfIsoDate(range.to, "to");
    if (to < from) {
      throw new AttendanceRecordInvalidError(`the calendar range is inverted: ${from} → ${to}`);
    }
    if (selfDaysBetween(from, to) + 1 > SELF_MAX_WINDOW_DAYS) {
      throw new AttendanceRecordInvalidError(
        `the calendar range is too wide (max ${SELF_MAX_WINDOW_DAYS} days): ${from} → ${to}`,
      );
    }
    const rows = await attendance.listOwnCalendarRows({ employeeId: employee.id, from, to });
    return { employee: selfEmployeeCard(employee), from, to, rows };
  }

  /** The own roster (read-only): the grid cells for the RESOLVED
   * employee, paginated (the joint-review pagination law). */
  async roster(
    userId: string,
    range: { from: string; to: string; page?: number; pageSize?: number },
  ): Promise<{
    employee: { id: string; code: string; name: string; nameAr: string | null; status: string };
    from: string;
    to: string;
    rows: hrStore.RosterCellRow[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const employee = await this.requireLinked(userId);
    const from = selfIsoDate(range.from, "from");
    const to = selfIsoDate(range.to, "to");
    if (to < from) {
      throw new AttendanceRecordInvalidError(`the roster range is inverted: ${from} → ${to}`);
    }
    if (selfDaysBetween(from, to) + 1 > SELF_MAX_WINDOW_DAYS) {
      throw new AttendanceRecordInvalidError(
        `the roster range is too wide (max ${SELF_MAX_WINDOW_DAYS} days): ${from} → ${to}`,
      );
    }
    const page = Math.max(selfIntParam(range.page, 1), 1);
    const pageSize = Math.min(Math.max(selfIntParam(range.pageSize, 500), 1), 5000);
    const rows = await hrStore.listRosterCells({
      from,
      to,
      employeeIds: [employee.id],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = await hrStore.countRosterCells({ from, to, employeeIds: [employee.id] });
    return {
      employee: selfEmployeeCard(employee),
      from,
      to,
      rows,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  /** The ACTIVE leave type catalog (the request form's axis — the
   * leave service's own read, the active-only filter). */
  async leaveTypes(userId: string): Promise<readonly leaveStore.LeaveTypeRow[]> {
    await this.requireLinked(userId);
    return this.leave.listTypes({ active: true, limit: 500 });
  }

  /** The own balances for a year (the leave service's read, the
   * resolved employee's cells). */
  async leaveBalances(
    userId: string,
    year: number | undefined,
  ): Promise<leaveStore.LeaveBalanceRow[]> {
    const employee = await this.requireLinked(userId);
    return this.leave.balances({ employeeId: employee.id, ...(year === undefined ? {} : { year }) });
  }

  /** The own requests register (paginated — the joint-review law). */
  async leaveRequests(
    userId: string,
    range: { from: string; to: string; page?: number; pageSize?: number },
  ): Promise<{
    employee: { id: string; code: string; name: string; nameAr: string | null; status: string };
    rows: leaveStore.LeaveRequestRow[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const employee = await this.requireLinked(userId);
    const from = selfIsoDate(range.from, "from");
    const to = selfIsoDate(range.to, "to");
    if (to < from) {
      throw new LeaveRequestInvalidError(`the requests range is inverted: ${from} → ${to}`);
    }
    const page = Math.max(selfIntParam(range.page, 1), 1);
    const pageSize = Math.min(Math.max(selfIntParam(range.pageSize, 500), 1), 5000);
    const result = await this.leave.listRequests({
      from,
      to,
      employeeIds: [employee.id],
      page,
      pageSize,
    });
    return { employee: selfEmployeeCard(employee), ...result };
  }

  /** Create the OWN leave request: the employeeId is RESOLVED from the
   * bridge — never accepted from the body (a client-supplied id would
   * be someone else's leave). The leave service's own laws apply
   * unchanged (the span overlap law, the type's active law, the audit
   * trail with actorId = the acting user). */
  async createLeaveRequest(
    userId: string,
    input: { leaveTypeId: string; startDate: string; endDate: string; note: string | null },
  ): Promise<leaveStore.LeaveRequestRow> {
    const employee = await this.requireLinked(userId);
    return this.leave.createRequest({
      employeeId: employee.id,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note,
      actorId: userId,
    });
  }

  /** Cancel the OWN PENDING request — the ONE decision an employee
   * owns (approve/reject stay with hr.leave, the simple-approval
   * chain). A7 parity: a foreign/unknown id renders the leave family's
   * own not-found; a decided request renders its own decided refusal;
   * a PENDING request of ANOTHER employee reads as not-found too —
   * never an ownership disclosure. */
  async cancelLeaveRequest(
    userId: string,
    requestId: string,
    note: string | null,
  ): Promise<leaveStore.LeaveRequestRow> {
    const employee = await this.requireLinked(userId);
    const request = await leaveStore.findLeaveRequestById(requestId);
    if (request === undefined || request.employeeId !== employee.id) {
      // A7: unknown == foreign == not-own — one shape, no disclosure.
      throw new LeaveRequestNotFoundError(requestId);
    }
    return this.leave.decideAgainst(requestId, "CANCELLED", note, userId);
  }

  /** The own-identity resolver: the bridge's answer for the acting
   * user, or the typed refusal (every scoped surface — the summary is
   * the only route that renders the null state instead). */
  private async requireLinked(
    userId: string,
  ): Promise<{ id: string; code: string; name: string; nameAr: string | null; status: string }> {
    const linked = await this.bridge.resolveByUser(userId);
    if (linked === undefined) {
      throw new SelfNotLinkedError();
    }
    return selfEmployeeCard(linked);
  }
}

// -- the shape helpers ----------------------------------------------------------------

const SELF_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The self-service window cap (the derivation horizon's own bound —
 * the calendar/roster span is a quarter at most). */
const SELF_MAX_WINDOW_DAYS = 92;

interface SelfEmployeeLike {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  status: string;
}

function selfEmployeeCard(row: SelfEmployeeLike): SelfEmployeeLike {
  return { id: row.id, code: row.code, name: row.name, nameAr: row.nameAr, status: row.status };
}

function selfIsoDate(date: string, what: string): string {
  if (!SELF_DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new AttendanceRecordInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${date}`);
  }
  return date;
}

function selfDaysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

function selfIntParam(value: number | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
