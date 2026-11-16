import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  LeaveAccrualInvalidError,
  LeaveBalanceInsufficientError,
  LeaveRequestDecidedError,
  LeaveRequestInvalidError,
  LeaveRequestNotFoundError,
  LeaveSpanOverlapError,
  LeaveTypeInactiveError,
  LeaveTypeInvalidError,
  LeaveTypeNotFoundError,
} from "../domain/leave-errors";
import { EmployeeNotFoundError } from "../domain/hr-errors";
import * as atomic from "../infrastructure/atomic";
import * as store from "../infrastructure/leave.store";
import { employeeExists } from "../infrastructure/hr.store";

/**
 * PHASE-045 (T-07) — the leave engine: the type catalog (HR-02), the
 * per-year balance cells, the request lifecycle with the simple
 * approval (the full workflow engine is PHASE-052 by decision), the
 * accrual policy runs, and the carry-over rollover.
 *
 * INV-031 (the balance law): used never exceeds entitlement +
 * carried-forward at ANY moment — enforced at the APPROVE boundary
 * (the typed refusal BEFORE the decrement, never a negative remaining)
 * and preserved by the accrual recompute (a run that would LOWER an
 * entitlement below the already-used days is refused typed,
 * all-or-nothing).
 *
 * THE SHARED ATOMICITY FLOOR (T-20, the owner's concurrency review
 * round): the request creation and the approval take the employee's
 * SPAN lock before the two-leaves-at-once check (the law's both
 * doors — no two concurrent requests can both pass it), and every
 * balance writer — the approval, the encashment (G-51), the accrual
 * recompute, and the carry-over rollover — takes the SAME
 * (employee, type, year) CELL lock before it reads or writes the
 * cell. The cap decision reads the CELL's used_days UNDER the lock:
 * used_days is the source of truth (approved leaves AND encashments
 * ride it — never a side sum over the requests table), so a cashout
 * and an approval racing on one cell can never jointly push it past
 * the cap (the owner's used=25-on-20 proof, pinned by the permanent
 * concurrency suite). The rollover adds the toYear preservation
 * guard — the accrual recompute's mirror: never LOWER a cell's
 * carried below (used − entitlement).
 *
 * THE ACCRUAL LAW (the BR-055 discipline): a type accrues 0.00 until
 * the tenant configures it — the run computes entitlement =
 * accrual_days_per_year × months / 12 (SQL numeric round(x,2) — exact,
 * never float):
 *   - monthly_grant=false: the ANNUAL grant — months = the employment
 *     months in the year (12 for pre-year hires; the months from the
 *     hire month to December for mid-year joiners, the hire month
 *     counting fully — the documented convention; 0 for future hires);
 *   - monthly_grant=true: the entitlement vests through the run's
 *     asOfMonth — months = min(asOfMonth, employment months);
 *   - prorate_joiners=false: months = 12 for every hire within the
 *     year (the tenant's explicit choice — no hidden proration).
 * The entitlement is RECOMPUTED (never incremented) — the run is
 * idempotent; used stays.
 *
 * THE CARRY-OVER LAW: at rollover the new year's carried_forward =
 * min(remaining, carry_over_cap_days) — the excess TRUNCATES (the
 * audit line records it: hr.leave_rollover with the truncated count);
 * a cap of 0.00 carries nothing.
 *
 * THE CHARGE CONVENTION: a span's days charge the START year's cell
 * (a year-crossing span is one charge — the simple-approval phase's
 * documented convention; the period-close snapshot in T-10 reads the
 * cells as they stand). The days = the calendar span (end − start + 1,
 * exact integer days as a decimal string).
 *
 * THE SPAN LAW: an employee is never on two leaves at once — a
 * PENDING-or-APPROVED span never overlaps another (typed before any
 * write).
 *
 * Leave is NOT a ledger document (the posting canon's note — the
 * accrual LIABILITY posting is golden G-50, policy-gated, T-11).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[\w\-. ]{1,32}$/;
const DAYS_RE = /^\d{1,3}(\.\d{1,2})?$/;
const MS_PER_DAY = 86_400_000;

function isoDate(date: string, what: string): string {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new LeaveRequestInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${date}`);
  }
  return date;
}

/** A decimal-days string within (0, max] — exact string validation
 * (scaled integers), never Number() float parsing (ADR-0009). */
function daysString(value: unknown, what: string, max: number): string {
  if (typeof value !== "string" || !DAYS_RE.test(value)) {
    throw new LeaveTypeInvalidError(`${what} must be a decimal string like "21.00": ${String(value)}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = Number.parseInt(whole + fraction.padEnd(2, "0"), 10);
  if (scaled < 0 || scaled > max * 100) {
    throw new LeaveTypeInvalidError(`${what} must be within [0 … ${max}]: ${value}`);
  }
  return value;
}

function intParam(value: number | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** The calendar span in days (end − start + 1) as an exact decimal
 * string. */
function spanDays(startDate: string, endDate: string): string {
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY + 1;
  if (!Number.isInteger(days) || days <= 0 || days > 366) {
    throw new LeaveRequestInvalidError(
      `the span ${startDate} → ${endDate} must be 1–366 calendar days`,
    );
  }
  return `${days}.00`;
}

@Injectable()
export class LeaveService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- the type catalog -------------------------------------------------------------------

  async createType(input: {
    code: string;
    name: string;
    nameAr: string | null;
    paid: boolean;
    accrualDaysPerYear: string;
    monthlyGrant: boolean;
    prorateJoiners: boolean;
    carryOverCapDays: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<store.LeaveTypeRow> {
    if (!CODE_RE.test(input.code)) {
      throw new LeaveTypeInvalidError(`leave type code must be 1–32 chars (letters, digits, dash, dot, space): ${input.code}`);
    }
    if (input.name.length < 1 || input.name.length > 120) {
      throw new LeaveTypeInvalidError(`leave type name must be 1–120 chars: ${input.name}`);
    }
    const accrual = daysString(input.accrualDaysPerYear, "accrualDaysPerYear", 366);
    const cap = daysString(input.carryOverCapDays, "carryOverCapDays", 366);
    if ((await store.findLeaveTypeByCode(input.code)) !== undefined) {
      throw new LeaveTypeInvalidError(`leave type code ${input.code} is already used in this tenant`);
    }
    const created = await store.insertLeaveType({
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      paid: input.paid,
      accrualDaysPerYear: accrual,
      monthlyGrant: input.monthlyGrant,
      prorateJoiners: input.prorateJoiners,
      carryOverCapDays: cap,
      note: input.note,
      noteAr: input.noteAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.leave_type_created",
      entityType: "leave_type",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        accrualDaysPerYear: created.accrualDaysPerYear,
        monthlyGrant: created.monthlyGrant,
        prorateJoiners: created.prorateJoiners,
        carryOverCapDays: created.carryOverCapDays,
      },
    });
    return created;
  }

  async listTypes(filter: { active?: boolean; limit: number }): Promise<store.LeaveTypeRow[]> {
    return store.listLeaveTypes(filter);
  }

  async updateType(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      paid?: boolean;
      accrualDaysPerYear?: string;
      monthlyGrant?: boolean;
      prorateJoiners?: boolean;
      carryOverCapDays?: string;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<store.LeaveTypeRow> {
    const current = await store.findLeaveTypeById(id);
    if (current === undefined) throw new LeaveTypeNotFoundError(id);
    if (patch.name !== undefined && (patch.name.length < 1 || patch.name.length > 120)) {
      throw new LeaveTypeInvalidError(`leave type name must be 1–120 chars: ${patch.name}`);
    }
    const accrual = patch.accrualDaysPerYear === undefined ? undefined : daysString(patch.accrualDaysPerYear, "accrualDaysPerYear", 366);
    const cap = patch.carryOverCapDays === undefined ? undefined : daysString(patch.carryOverCapDays, "carryOverCapDays", 366);
    const updated = await store.patchLeaveType({
      id,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
      ...(patch.paid === undefined ? {} : { paid: patch.paid }),
      ...(accrual === undefined ? {} : { accrualDaysPerYear: accrual }),
      ...(patch.monthlyGrant === undefined ? {} : { monthlyGrant: patch.monthlyGrant }),
      ...(patch.prorateJoiners === undefined ? {} : { prorateJoiners: patch.prorateJoiners }),
      ...(cap === undefined ? {} : { carryOverCapDays: cap }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
      ...(patch.noteAr === undefined ? {} : { noteAr: patch.noteAr }),
    });
    if (updated === undefined) throw new LeaveTypeNotFoundError(id);
    await this.audit.record({
      action: "hr.leave_type_updated",
      entityType: "leave_type",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { code: current.code, accrualDaysPerYear: current.accrualDaysPerYear, carryOverCapDays: current.carryOverCapDays },
      after: { code: updated.code, accrualDaysPerYear: updated.accrualDaysPerYear, carryOverCapDays: updated.carryOverCapDays },
    });
    return updated;
  }

  async setTypeActive(id: string, active: boolean, actorId: string | null): Promise<store.LeaveTypeRow> {
    const current = await store.findLeaveTypeById(id);
    if (current === undefined) throw new LeaveTypeNotFoundError(id);
    const updated = await store.setLeaveTypeActive(id, active);
    if (updated === undefined) throw new LeaveTypeNotFoundError(id);
    await this.audit.record({
      action: active ? "hr.leave_type_activated" : "hr.leave_type_deactivated",
      entityType: "leave_type",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { code: updated.code, active },
    });
    return updated;
  }

  // -- the balances -------------------------------------------------------------------------

  async balances(filter: { employeeId?: string; year?: number }): Promise<store.LeaveBalanceRow[]> {
    if (filter.year !== undefined && (!Number.isInteger(filter.year) || filter.year < 2020 || filter.year > 2100)) {
      throw new LeaveRequestInvalidError(`year must be an integer 2020–2100: ${filter.year}`);
    }
    return store.listBalances(filter);
  }

  // -- the request lifecycle ------------------------------------------------------------------

  async createRequest(input: {
    employeeId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    note: string | null;
    actorId: string | null;
  }): Promise<store.LeaveRequestRow> {
    const startDate = isoDate(input.startDate, "startDate");
    const endDate = isoDate(input.endDate, "endDate");
    if (endDate < startDate) {
      throw new LeaveRequestInvalidError(`the span is inverted: ${startDate} → ${endDate}`);
    }
    const days = spanDays(startDate, endDate);
    if (!(await employeeExists(input.employeeId))) {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    const type = await store.findLeaveTypeById(input.leaveTypeId);
    if (type === undefined) throw new LeaveTypeNotFoundError(input.leaveTypeId);
    if (!type.active) throw new LeaveTypeInactiveError(input.leaveTypeId);
    // THE SPAN LOCK FIRST (T-20): every span writer of this employee
    // — creation AND approval — serializes here, so the
    // two-leaves-at-once check below always runs on the winner's
    // committed state (two concurrent requests can never both pass
    // it — the owner's overlapping-requests proof, pinned).
    await atomic.lockLeaveSpan(input.employeeId);
    // THE SPAN LAW: never two leaves at once (PENDING or APPROVED).
    const overlap = await store.findOverlappingLeave(input.employeeId, startDate, endDate);
    if (overlap !== undefined) {
      throw new LeaveSpanOverlapError(
        `the span ${startDate} → ${endDate} overlaps an existing ${overlap.status} leave under '${overlap.leaveTypeCode}' (${overlap.startDate} → ${overlap.endDate}) — an employee is never on two leaves at once`,
      );
    }
    const request = await store.insertLeaveRequest({
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate,
      endDate,
      days,
      note: input.note,
      requestedBy: input.actorId,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.leave_request_created",
      entityType: "leave_request",
      entityId: request.id,
      actorId: input.actorId ?? undefined,
      after: { employeeId: input.employeeId, leaveType: type.code, startDate, endDate, days },
    });
    return request;
  }

  /** The APPROVE decision (T-20's rework): the SPAN lock (the
   * two-leaves-at-once law's approve-boundary door) + the CELL lock
   * serialize this against every span writer and every balance
   * writer; the INV-031 check reads the CELL's used_days UNDER the
   * lock — used_days is the source of truth (approved leaves AND
   * encashments ride it, never a side sum) — then the typed refusal
   * BEFORE the decrement, the decided stamps + the balance write —
   * one ambient transaction. */
  async approve(id: string, note: string | null, actorId: string | null): Promise<store.LeaveRequestRow> {
    const request = await store.findLeaveRequestById(id);
    if (request === undefined) throw new LeaveRequestNotFoundError(id);
    if (request.status !== "PENDING") throw new LeaveRequestDecidedError(id, request.status);
    const year = Number(request.startDate.slice(0, 4));
    // THE SPAN LOCK FIRST (T-20) — then the span law re-checked at the
    // approve boundary (excluding this request's own span — it always
    // overlaps itself). A request that slipped past the create-boundary
    // check (or was seeded behind it) is refused HERE, never approved
    // into an overlap.
    await atomic.lockLeaveSpan(request.employeeId);
    const overlap = await store.findOverlappingLeave(
      request.employeeId,
      request.startDate,
      request.endDate,
      id,
    );
    if (overlap !== undefined) {
      throw new LeaveSpanOverlapError(
        `the span ${request.startDate} → ${request.endDate} overlaps the ${overlap.status} leave under '${overlap.leaveTypeCode}' (${overlap.startDate} → ${overlap.endDate}) — an employee is never on two leaves at once`,
      );
    }
    await store.ensureBalanceCell(request.employeeId, request.leaveTypeId, year);
    // THE CELL LOCK (T-20): the approval, the encashment (G-51), the
    // accrual recompute, and the carry-over rollover ALL serialize on
    // the (employee, type, year) cell — the cap check and the
    // increment below are one atomic step under the lock.
    await atomic.lockBalanceCell(request.employeeId, request.leaveTypeId, year);
    const cell = await store.findBalanceCell(request.employeeId, request.leaveTypeId, year);
    // INV-031 — exact scaled-integer comparison (never float) against
    // the CELL (used_days: the source of truth — leaves + encashments).
    const [uW, uF = ""] = cell!.usedDays.split(".");
    const usedScaled = Number.parseInt(uW + uF.padEnd(2, "0"), 10);
    const [rW, rF = ""] = request.days.split(".");
    const requestScaled = Number.parseInt(rW + rF.padEnd(2, "0"), 10);
    const [eW, eF = ""] = cell!.entitlementDays.split(".");
    const entitlementScaled = Number.parseInt(eW + eF.padEnd(2, "0"), 10);
    const [cW, cF = ""] = cell!.carriedForwardDays.split(".");
    const carriedScaled = Number.parseInt(cW + cF.padEnd(2, "0"), 10);
    if (usedScaled + requestScaled > entitlementScaled + carriedScaled) {
      throw new LeaveBalanceInsufficientError(
        `the approval would push ${request.employeeCode ?? "the employee"}'s ${request.leaveTypeCode} balance negative: used ${cell!.usedDays} + requested ${request.days} > entitlement ${cell!.entitlementDays} + carried ${cell!.carriedForwardDays} in ${year} (INV-031)`,
      );
    }
    await store.incrementUsedDays(request.employeeId, request.leaveTypeId, year, request.days);
    // The conditional decide (WHERE status = 'PENDING') is the
    // double-approve floor: a concurrent approval of THIS request
    // deciding first leaves this one zero rows — the typed DECIDED
    // refusal below rolls the whole UoW back (the increment with it).
    const decided = await store.decideLeaveRequest({
      id,
      status: "APPROVED",
      decidedBy: actorId,
      decisionNote: note,
    });
    if (decided === undefined) throw new LeaveRequestDecidedError(id, request.status);
    await this.audit.record({
      action: "hr.leave_request_approved",
      entityType: "leave_request",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "PENDING", days: request.days },
      after: { status: "APPROVED", days: decided.days, balanceAfter: `${cell!.usedDays} + ${request.days}` },
    });
    return decided;
  }

  /** REJECT / CANCEL — no balance change; the decided stamps ride the
   * 0083 CHECK (only PENDING carries none). */
  async decideAgainst(id: string, decision: "REJECTED" | "CANCELLED", note: string | null, actorId: string | null): Promise<store.LeaveRequestRow> {
    const request = await store.findLeaveRequestById(id);
    if (request === undefined) throw new LeaveRequestNotFoundError(id);
    if (request.status !== "PENDING") throw new LeaveRequestDecidedError(id, request.status);
    const decided = await store.decideLeaveRequest({
      id,
      status: decision,
      decidedBy: actorId,
      decisionNote: note,
    });
    if (decided === undefined) throw new LeaveRequestDecidedError(id, request.status);
    await this.audit.record({
      action: decision === "REJECTED" ? "hr.leave_request_rejected" : "hr.leave_request_cancelled",
      entityType: "leave_request",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "PENDING", days: request.days },
      after: { status: decision, note },
    });
    return decided;
  }

  async listRequests(filter: {
    from: string;
    to: string;
    employeeIds?: readonly string[];
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    rows: store.LeaveRequestRow[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const from = isoDate(filter.from, "from");
    const to = isoDate(filter.to, "to");
    if (filter.status !== undefined && !["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(filter.status)) {
      throw new LeaveRequestInvalidError(`unknown status filter: ${filter.status}`);
    }
    const page = Math.max(intParam(filter.page, 1), 1);
    const pageSize = Math.min(Math.max(intParam(filter.pageSize, 500), 1), 5000);
    const rows = await store.listLeaveRequests({
      from,
      to,
      employeeIds: filter.employeeIds,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = await store.countLeaveRequests({
      from,
      to,
      employeeIds: filter.employeeIds,
      ...(filter.status === undefined ? {} : { status: filter.status }),
    });
    return { rows, page, pageSize, total, hasMore: page * pageSize < total };
  }

  // -- the accrual run ---------------------------------------------------------------------------

  /** The accrual policy run (the entitlement recompute — idempotent;
   * the INV-031 preservation guards a lowering below the used days).
   * Returns the cells written + the per-employee entitlements for the
   * evidence log. */
  async runAccrual(input: {
    leaveTypeId: string;
    year: number;
    asOfMonth?: number;
    actorId: string | null;
  }): Promise<{ cellsWritten: number; employees: number; entitlements: { employeeCode: string; entitlementDays: string }[] }> {
    if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
      throw new LeaveAccrualInvalidError(`year must be an integer 2020–2100: ${input.year}`);
    }
    if (input.asOfMonth !== undefined && (!Number.isInteger(input.asOfMonth) || input.asOfMonth < 1 || input.asOfMonth > 12)) {
      throw new LeaveAccrualInvalidError(`asOfMonth must be an integer 1–12: ${input.asOfMonth}`);
    }
    const type = await store.findLeaveTypeById(input.leaveTypeId);
    if (type === undefined) throw new LeaveTypeNotFoundError(input.leaveTypeId);
    if (type.accrualDaysPerYear === "0.00") {
      throw new LeaveAccrualInvalidError(
        `leave type '${type.code}' accrues 0.00 days/year — the accrual is a TENANT POLICY, never a fabricated default (the BR-055 discipline); configure accrualDaysPerYear first`,
      );
    }
    const employment = await store.employmentMonthsInYear(input.year);
    // months per employee per the type's policy.
    const monthsFor = (employed: number): number => {
      if (type.prorateJoiners) {
        return type.monthlyGrant ? Math.min(input.asOfMonth ?? 12, employed) : employed;
      }
      // No joiner proration: a hire within the year still gets the
      // full window (12 for annual; asOfMonth for monthly).
      return type.monthlyGrant ? (input.asOfMonth ?? 12) : 12;
    };
    // The entitlement in scaled-integer math (hundredths), round-half-up
    // — the numeric round(x,2) mirror; never float division.
    const [aW, aF = ""] = type.accrualDaysPerYear.split(".");
    const accrualScaled = Number.parseInt(aW + aF.padEnd(2, "0"), 10); // hundredths
    const targets: { employeeId: string; entitlementDays: string }[] = [];
    for (const { employeeId, months: employed } of employment) {
      const months = monthsFor(employed);
      if (months <= 0) continue; // future hires accrue nothing
      // entitlement = round2(accrual × months / 12).
      const scaled = ((accrualScaled * months + 6) / 12) | 0;
      const entitlement = (scaled / 100).toFixed(2);
      targets.push({ employeeId, entitlementDays: entitlement });
    }
    // THE CELL LOCKS (T-20): ensure every target cell exists, then
    // lock them ALL (globally sorted — the atomic module's deadlock
    // law) BEFORE the preservation reads. An approval or encashment
    // racing this run on any cell serializes against it, so the
    // INV-031 preservation guard and the entitlement write are one
    // atomic step — a run that passed the guard on a stale used_days
    // can no longer lower the entitlement under a committed charge.
    for (const target of targets) {
      await store.ensureBalanceCell(target.employeeId, input.leaveTypeId, input.year);
    }
    await atomic.lockBalanceCells(
      targets.map((target) => ({
        employeeId: target.employeeId,
        leaveTypeId: input.leaveTypeId,
        year: input.year,
      })),
    );
    // The INV-031 preservation: a recompute may never lower an
    // entitlement below (used − carried) of the existing cell — read
    // UNDER the lock (the post-lock recompute, the CC-02 idiom).
    const violations: string[] = [];
    for (const target of targets) {
      const cell = await store.findBalanceCell(target.employeeId, input.leaveTypeId, input.year);
      if (cell === undefined) continue;
      const [uW, uF = ""] = cell.usedDays.split(".");
      const usedScaled = Number.parseInt(uW + uF.padEnd(2, "0"), 10);
      const [nW, nF = ""] = target.entitlementDays.split(".");
      const newScaled = Number.parseInt(nW + nF.padEnd(2, "0"), 10);
      const [cW, cF = ""] = cell.carriedForwardDays.split(".");
      const carriedScaled = Number.parseInt(cW + cF.padEnd(2, "0"), 10);
      if (usedScaled > newScaled + carriedScaled) {
        violations.push(
          `${cell.employeeCode}: used ${cell.usedDays} > the recomputed entitlement ${target.entitlementDays} + carried ${cell.carriedForwardDays}`,
        );
      }
    }
    if (violations.length > 0) {
      throw new LeaveAccrualInvalidError(
        `the accrual recompute would break INV-031 for ${violations.length} employee(s) — used may never exceed entitlement + carried: ${violations.slice(0, 3).join("; ")}${violations.length > 3 ? " …" : ""}`,
      );
    }
    const cellsWritten = await store.bulkUpsertEntitlements(targets, input.leaveTypeId, input.year);
    await this.audit.record({
      action: "hr.leave_accrual_run",
      entityType: "leave_type",
      entityId: input.leaveTypeId,
      actorId: input.actorId ?? undefined,
      after: {
        leaveType: type.code,
        year: input.year,
        asOfMonth: input.asOfMonth ?? null,
        employees: targets.length,
        cellsWritten,
      },
    });
    return { cellsWritten, employees: targets.length, entitlements: [] };
  }

  // -- the carry-over rollover ---------------------------------------------------------------------

  /** The year-end rollover (T-20's rework): the new year's
   * carried_forward = min(remaining, the cap) — the excess TRUNCATES
   * with the audit line; idempotent (the SET, never an increment).
   * BOTH years' cells of the type lock (globally sorted) BEFORE the
   * remaining is read and the carry written — a rollover that
   * computes on a stale remaining, or that lowers a toYear cell's
   * carried below (used − entitlement), is the typed refusal (the
   * accrual recompute's mirror — INV-031 holds at every moment). */
  async rollover(input: {
    leaveTypeId: string;
    fromYear: number;
    toYear: number;
    actorId: string | null;
  }): Promise<{ cellsWritten: number; truncatedCount: number; truncatedDays: string }> {
    for (const year of [input.fromYear, input.toYear]) {
      if (!Number.isInteger(year) || year < 2020 || year > 2100) {
        throw new LeaveAccrualInvalidError(`year must be an integer 2020–2100: ${year}`);
      }
    }
    if (input.toYear !== input.fromYear + 1) {
      throw new LeaveAccrualInvalidError(`the rollover moves exactly one year forward: ${input.fromYear} → ${input.toYear}`);
    }
    const type = await store.findLeaveTypeById(input.leaveTypeId);
    if (type === undefined) throw new LeaveTypeNotFoundError(input.leaveTypeId);
    // The pre-lock reads only decide WHICH employees this run touches
    // (the type's cells in either year).
    const fromCellsFirst = (await store.listBalances({ year: input.fromYear }))
      .filter((cell) => cell.leaveTypeId === input.leaveTypeId);
    const toCellsFirst = (await store.listBalances({ year: input.toYear }))
      .filter((cell) => cell.leaveTypeId === input.leaveTypeId);
    // THE CELL LOCKS (T-20): both years' cells of every touched
    // employee, globally sorted — the rollover, the approval, the
    // encashment, and the accrual recompute ALL serialize on the same
    // (employee, type, year) gates.
    const touchedEmployees = new Set([
      ...fromCellsFirst.map((cell) => cell.employeeId),
      ...toCellsFirst.map((cell) => cell.employeeId),
    ]);
    await atomic.lockBalanceCells(
      [...touchedEmployees].flatMap((employeeId) => [
        { employeeId, leaveTypeId: input.leaveTypeId, year: input.fromYear },
        { employeeId, leaveTypeId: input.leaveTypeId, year: input.toYear },
      ]),
    );
    // The remaining re-read UNDER the lock — a concurrent charge on
    // the fromYear cell that committed while we waited changes what
    // carries (never a stale carry).
    const fromCells = (await store.listBalances({ year: input.fromYear }))
      .filter((cell) => cell.leaveTypeId === input.leaveTypeId);
    const [cW, cF = ""] = type.carryOverCapDays.split(".");
    const capScaled = Number.parseInt(cW + cF.padEnd(2, "0"), 10);
    const carries: { employeeId: string; carriedForwardDays: string }[] = [];
    let truncatedCount = 0;
    let truncatedScaled = 0;
    for (const cell of fromCells) {
      const [rW, rF = ""] = cell.remainingDays.split(".");
      const remainingScaled = Number.parseInt(rW + rF.padEnd(2, "0"), 10);
      if (remainingScaled <= 0) continue;
      const carryScaled = Math.min(remainingScaled, capScaled);
      if (carryScaled < remainingScaled) {
        truncatedCount += 1;
        truncatedScaled += remainingScaled - carryScaled;
      }
      // A 0-cap (or a 0 carry) writes NO cell — nothing carried is not
      // a carried row.
      if (carryScaled <= 0) continue;
      carries.push({
        employeeId: cell.employeeId,
        carriedForwardDays: (carryScaled / 100).toFixed(2),
      });
    }
    // THE toYear PRESERVATION GUARD (T-20 — the accrual recompute's
    // mirror): the rollover may never LOWER a toYear cell's carried
    // below (used − entitlement) — INV-031 holds at every moment, so
    // a re-run after the new year consumed its opening carry is the
    // typed refusal (all-or-nothing), never a silent break.
    const carryViolations: string[] = [];
    for (const carry of carries) {
      const cell = await store.findBalanceCell(carry.employeeId, input.leaveTypeId, input.toYear);
      if (cell === undefined) continue;
      const [uW, uF = ""] = cell.usedDays.split(".");
      const usedScaled = Number.parseInt(uW + uF.padEnd(2, "0"), 10);
      const [eW, eF = ""] = cell.entitlementDays.split(".");
      const entitlementScaled = Number.parseInt(eW + eF.padEnd(2, "0"), 10);
      const [nW, nF = ""] = carry.carriedForwardDays.split(".");
      const newCarriedScaled = Number.parseInt(nW + nF.padEnd(2, "0"), 10);
      if (usedScaled > entitlementScaled + newCarriedScaled) {
        carryViolations.push(
          `${cell.employeeCode}: used ${cell.usedDays} > the toYear entitlement ${cell.entitlementDays} + the recomputed carry ${carry.carriedForwardDays}`,
        );
      }
    }
    if (carryViolations.length > 0) {
      throw new LeaveAccrualInvalidError(
        `the rollover would break INV-031 for ${carryViolations.length} employee(s) — used may never exceed entitlement + carried: ${carryViolations.slice(0, 3).join("; ")}${carryViolations.length > 3 ? " …" : ""}`,
      );
    }
    const cellsWritten = await store.bulkUpsertCarryForwards(carries, input.leaveTypeId, input.toYear);
    await this.audit.record({
      action: "hr.leave_rollover",
      entityType: "leave_type",
      entityId: input.leaveTypeId,
      actorId: input.actorId ?? undefined,
      after: {
        leaveType: type.code,
        fromYear: input.fromYear,
        toYear: input.toYear,
        cellsWritten,
        truncatedCount,
        truncatedDays: (truncatedScaled / 100).toFixed(2),
      },
    });
    return {
      cellsWritten,
      truncatedCount,
      truncatedDays: (truncatedScaled / 100).toFixed(2),
    };
  }
}
