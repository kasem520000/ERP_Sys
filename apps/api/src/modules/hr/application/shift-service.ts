import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/hr.store";
import {
  EmployeeNotFoundError,
  RotationInvalidError,
  RosterCellInvalidError,
  ShiftCodeTakenError,
  ShiftInactiveError,
  ShiftInvalidError,
  ShiftNotFoundError,
} from "../domain/hr-errors";

/**
 * PHASE-045 (T-03) — the shift service: reusable shift templates
 * (HR-04), the employee × date roster grid, and the weekly rotation
 * pattern generator.
 *
 * THE SHIFT TEMPLATE LAW (the 0080 CHECKs, surfaced as typed errors
 * before any write): the code is unique per tenant (1–32 chars), the
 * name 1–120, grace 0–240 min, breaks 0–480 min, and the NIGHT flag
 * ⟺ end < start (the overnight crossing is EXPLICIT — a night shift is
 * declared, never inferred).
 *
 * THE ROSTER GRID LAW: ONE row per (employee, work_date) — the cell is
 * REPLACED on edit (never duplicated; the table unique enforces it).
 * MANUAL cells (the roster editor) always win: the rotation generator
 * bulk-writes source='ROTATION' rows but PRESERVES an existing MANUAL
 * cell — a human's explicit edit beats the pattern.
 *
 * Attendance, rosters, and shift templates are NOT ledger documents
 * (the posting canon's note — nothing here posts anything).
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[\w\-. ]{1,32}$/;
/** The rotation horizon cap: a bulk generate is bounded (a quarter) —
 * larger spans are multiple deliberate runs. */
const MAX_ROTATION_DAYS = 92;
/** Grid reads are bounded (a year of cells for one employee is ~366). */
const MAX_GRID_DAYS = 366;

function isoDate(date: string, what: string): string {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new RosterCellInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${date}`);
  }
  return date;
}

function addDaysIso(date: string, days: number): string {
  // Exact UTC-midnight arithmetic (date-only strings parse at 00:00Z —
  // the day multiple needs no rounding; ADR-0009's decimal law is about
  // MONEY, and the linter's blanket rule is satisfied by staying exact).
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** ISO weekday: Monday = 0 … Sunday = 6 (the pattern's index). */
function isoWeekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function validateShiftShape(input: {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  breakMinutes: number;
  isNight: boolean;
}): void {
  if (!CODE_RE.test(input.code)) {
    throw new ShiftInvalidError(
      `shift code must be 1–32 chars (letters, digits, dash, dot, space): ${input.code}`,
    );
  }
  if (input.name.length < 1 || input.name.length > 120) {
    throw new ShiftInvalidError(`shift name must be 1–120 chars: ${input.name}`);
  }
  if (!TIME_RE.test(input.startTime)) {
    throw new ShiftInvalidError(`start time must be HH:MM or HH:MM:SS (24h): ${input.startTime}`);
  }
  if (!TIME_RE.test(input.endTime)) {
    throw new ShiftInvalidError(`end time must be HH:MM or HH:MM:SS (24h): ${input.endTime}`);
  }
  if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0 || input.graceMinutes > 240) {
    throw new ShiftInvalidError(`grace minutes must be an integer 0–240: ${input.graceMinutes}`);
  }
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes > 480) {
    throw new ShiftInvalidError(`break minutes must be an integer 0–480: ${input.breakMinutes}`);
  }
  const start = input.startTime.slice(0, 5);
  const end = input.endTime.slice(0, 5);
  const crosses = end < start;
  if (input.isNight !== crosses) {
    throw new ShiftInvalidError(
      `the night flag must match the crossing: isNight=${input.isNight} but ${start}→${end} ` +
        (crosses ? "CROSSES midnight (declare isNight=true or fix the times)" : "does not cross midnight (isNight must be false)"),
    );
  }
}

@Injectable()
export class ShiftService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- shift templates ------------------------------------------------------------

  async create(input: {
    code: string;
    name: string;
    nameAr: string | null;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    breakMinutes: number;
    isNight: boolean;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<store.ShiftRow> {
    validateShiftShape(input);
    if ((await store.findShiftByCode(input.code)) !== undefined) {
      throw new ShiftCodeTakenError(input.code);
    }
    const created = await store.insertShift({
      id: generateUuidV7(),
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      startTime: input.startTime.length === 5 ? `${input.startTime}:00` : input.startTime,
      endTime: input.endTime.length === 5 ? `${input.endTime}:00` : input.endTime,
      graceMinutes: input.graceMinutes,
      breakMinutes: input.breakMinutes,
      isNight: input.isNight,
      note: input.note,
      noteAr: input.noteAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.shift_created",
      entityType: "shift",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, name: created.name, startTime: created.startTime, endTime: created.endTime },
    });
    return created;
  }

  async find(id: string): Promise<store.ShiftRow> {
    const found = await store.findShiftById(id);
    if (found === undefined) throw new ShiftNotFoundError(id);
    return found;
  }

  async list(filter: { active?: boolean; limit: number }): Promise<store.ShiftRow[]> {
    return store.listShifts(filter);
  }

  async update(
    id: string,
    patch: {
      code?: string;
      name?: string;
      nameAr?: string | null;
      startTime?: string;
      endTime?: string;
      graceMinutes?: number;
      breakMinutes?: number;
      isNight?: boolean;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<store.ShiftRow> {
    const current = await this.find(id);
    const merged = {
      code: patch.code ?? current.code,
      name: patch.name ?? current.name,
      startTime: patch.startTime ?? current.startTime,
      endTime: patch.endTime ?? current.endTime,
      graceMinutes: patch.graceMinutes ?? current.graceMinutes,
      breakMinutes: patch.breakMinutes ?? current.breakMinutes,
      isNight: patch.isNight ?? current.isNight,
    };
    validateShiftShape(merged);
    if (patch.code !== undefined && patch.code !== current.code) {
      const existing = await store.findShiftByCode(patch.code);
      if (existing !== undefined && existing.id !== id) {
        throw new ShiftCodeTakenError(patch.code);
      }
    }
    const updated = await store.patchShift({
      id,
      code: patch.code,
      name: patch.name,
      nameAr: patch.nameAr,
      startTime: patch.startTime === undefined ? undefined : patch.startTime.length === 5 ? `${patch.startTime}:00` : patch.startTime,
      endTime: patch.endTime === undefined ? undefined : patch.endTime.length === 5 ? `${patch.endTime}:00` : patch.endTime,
      graceMinutes: patch.graceMinutes,
      breakMinutes: patch.breakMinutes,
      isNight: patch.isNight,
      note: patch.note,
      noteAr: patch.noteAr,
    });
    if (updated === undefined) throw new ShiftNotFoundError(id);
    await this.audit.record({
      action: "hr.shift_updated",
      entityType: "shift",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { code: current.code, name: current.name },
      after: { code: updated.code, name: updated.name, startTime: updated.startTime, endTime: updated.endTime },
    });
    return updated;
  }

  async setActive(id: string, active: boolean, actorId: string | null): Promise<store.ShiftRow> {
    await this.find(id);
    const updated = await store.setShiftActive(id, active);
    if (updated === undefined) throw new ShiftNotFoundError(id);
    await this.audit.record({
      action: active ? "hr.shift_activated" : "hr.shift_deactivated",
      entityType: "shift",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { code: updated.code, active },
    });
    return updated;
  }

  // -- the roster grid ------------------------------------------------------------

  private async requireEmployee(employeeId: string): Promise<void> {
    if (!(await store.employeeExists(employeeId))) {
      throw new EmployeeNotFoundError(employeeId);
    }
  }

  private async requireRosterableShift(shiftId: string): Promise<void> {
    const shift = await store.findShiftById(shiftId);
    if (shift === undefined) throw new ShiftNotFoundError(shiftId);
    if (!shift.active) throw new ShiftInactiveError(shiftId);
  }

  async setRosterCell(input: {
    employeeId: string;
    workDate: string;
    shiftId: string | null;
    note: string | null;
    actorId: string | null;
  }): Promise<store.RosterCellRow> {
    isoDate(input.workDate, "workDate");
    await this.requireEmployee(input.employeeId);
    if (input.shiftId !== null) {
      await this.requireRosterableShift(input.shiftId);
    }
    const cell = await store.upsertManualCell({
      employeeId: input.employeeId,
      workDate: input.workDate,
      shiftId: input.shiftId,
      note: input.note,
      createdBy: input.actorId,
    });
    if (cell === undefined) {
      throw new RosterCellInvalidError("the roster cell write failed");
    }
    await this.audit.record({
      action: "hr.roster_cell_set",
      entityType: "shift_rotation",
      entityId: cell.id,
      actorId: input.actorId ?? undefined,
      after: { employeeId: input.employeeId, workDate: input.workDate, shiftId: input.shiftId, source: "MANUAL" },
    });
    return cell;
  }

  async clearRosterCell(
    employeeId: string,
    workDate: string,
    actorId: string | null,
  ): Promise<{ cleared: boolean }> {
    isoDate(workDate, "workDate");
    await this.requireEmployee(employeeId);
    const cleared = await store.deleteRosterCell(employeeId, workDate);
    if (cleared) {
      await this.audit.record({
        action: "hr.roster_cell_cleared",
        entityType: "shift_rotation",
        entityId: employeeId,
        actorId: actorId ?? undefined,
        after: { employeeId, workDate },
      });
    }
    return { cleared };
  }

  async readGrid(input: {
    from: string;
    to: string;
    employeeIds?: readonly string[];
  }): Promise<store.RosterCellRow[]> {
    isoDate(input.from, "from");
    isoDate(input.to, "to");
    if (input.to < input.from) {
      throw new RosterCellInvalidError(`the grid range is inverted: ${input.from} → ${input.to}`);
    }
    if (daysBetween(input.from, input.to) + 1 > MAX_GRID_DAYS) {
      throw new RosterCellInvalidError(
        `the grid range is too wide (max ${MAX_GRID_DAYS} days): ${input.from} → ${input.to}`,
      );
    }
    return store.listRosterCells({
      from: input.from,
      to: input.to,
      employeeIds: input.employeeIds,
      limit: 5000,
    });
  }

  // -- the rotation pattern generator ----------------------------------------------

  /**
   * Apply a WEEKLY rotation pattern (Monday…Sunday, each entry a shift id
   * or null = an explicit rostered day off) to a set of employees over a
   * date range: every (employee, date) cell is written source=ROTATION —
   * EXCEPT an existing MANUAL cell, which is preserved (the human's edit
   * beats the pattern). Idempotent: re-running the same pattern rewrites
   * the same ROTATION cells (the same values) and still preserves MANUAL.
   */
  async applyRotation(input: {
    employeeIds: readonly string[];
    /** EXACTLY 7 entries, Monday…Sunday; null = a rostered day off. */
    pattern: readonly (string | null)[];
    startDate: string;
    endDate: string;
    actorId: string | null;
  }): Promise<{ cellsWritten: number; manualPreserved: number; days: number }> {
    if (input.employeeIds.length === 0) {
      throw new RotationInvalidError("a rotation needs at least one employee");
    }
    if (input.employeeIds.length > 200) {
      throw new RotationInvalidError("a rotation applies to at most 200 employees per run");
    }
    if (input.pattern.length !== 7 || input.pattern.some((entry) => entry === undefined)) {
      throw new RotationInvalidError(
        `the rotation pattern must be EXACTLY 7 entries (Monday…Sunday, a shift id or null): got ${input.pattern.length}`,
      );
    }
    const startDate = isoDate(input.startDate, "startDate");
    const endDate = isoDate(input.endDate, "endDate");
    if (endDate < startDate) {
      throw new RotationInvalidError(`the rotation range is inverted: ${startDate} → ${endDate}`);
    }
    const days = daysBetween(startDate, endDate) + 1;
    if (days > MAX_ROTATION_DAYS) {
      throw new RotationInvalidError(
        `the rotation range is too wide (max ${MAX_ROTATION_DAYS} days): ${startDate} → ${endDate}`,
      );
    }
    for (const employeeId of input.employeeIds) {
      await this.requireEmployee(employeeId);
    }
    const shiftIds = [...new Set(input.pattern.filter((entry): entry is string => entry !== null))];
    for (const shiftId of shiftIds) {
      await this.requireRosterableShift(shiftId);
    }

    const cells: { employeeId: string; workDate: string; shiftId: string | null; createdBy: string | null }[] = [];
    for (const employeeId of input.employeeIds) {
      for (let offset = 0; offset < days; offset += 1) {
        const workDate = addDaysIso(startDate, offset);
        cells.push({
          employeeId,
          workDate,
          shiftId: input.pattern[isoWeekday(workDate)] ?? null,
          createdBy: input.actorId,
        });
      }
    }
    const written = await store.bulkUpsertRotationCells(cells);
    const manualPreserved = cells.length - written.length;
    await this.audit.record({
      action: "hr.rotation_applied",
      entityType: "shift_rotation",
      // entity_id is a NOT NULL uuid — anchor on the first written row,
      // else on the first candidate cell (the payload carries the counts).
      entityId: written[0] ?? generateUuidV7(),
      actorId: input.actorId ?? undefined,
      after: {
        employees: input.employeeIds.length,
        startDate,
        endDate,
        days,
        cellsWritten: written.length,
        manualPreserved,
      },
    });
    return { cellsWritten: written.length, manualPreserved, days };
  }
}
