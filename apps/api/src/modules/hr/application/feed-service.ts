import { Inject, Injectable } from "@nestjs/common";

import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import { AuditService } from "../../audit/api/audit";
import { FeedInvalidError, FeedPeriodNotFoundError } from "../domain/feed-errors";
import * as store from "../infrastructure/feed.store";

/**
 * PHASE-045 (T-10) — the payroll variable-feed service: the per-pay-
 * period computation PHASE-046's statutory engine consumes as
 * variable-component inputs (the 029 baseline's payroll components stay
 * untouched — this is the READ-side handoff, never a writer into the
 * run machinery).
 *
 * THE FEEDING LAWS:
 * - OVERTIME (BR-084 at the feed boundary): an entry feeds when it is
 *   APPROVED, or when it is PENDING on a rule WITHOUT the
 *   pre-approval requirement (post-hoc worked time); REJECTED never
 *   feeds; a pre-approval-required rule's PENDING is the exception —
 *   NEVER silently fed (the exception board is its surface).
 * - ABSENCE/LATE: the attendance DERIVATION's verdicts are the truth —
 *   ABSENT days counted (a rostered past punchless day), LATE minutes
 *   summed exactly; MISSING_PUNCH is surfaced as its own count and
 *   NEVER folded into absence; HOLIDAY/ON_LEAVE are not absences.
 * - THE LEAVE SNAPSHOT at period close: the per-year balance CELLS
 *   (rows, not views — reconstructable by construction), remaining
 *   computed in SQL on the read.
 *
 * THE PERIOD LAW: the feed answers for a fiscal period of the acting
 * tenant (start_date…end_date); the snapshot year is the period's END
 * year (a period crossing a year boundary snapshots at its close —
 * the documented convention). All quantity math is SQL NUMERIC
 * (ADR-0009) crossing the API as DECIMAL STRINGS.
 */
export interface VariableFeedEmployeeRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  overtime: {
    totalHours: string;
    totalMultipliedHours: string;
    lines: store.OvertimeFeedLine[];
  };
  absenceDays: number;
  missingPunchDays: number;
  lateMinutes: number;
  leaveBalances: store.LeaveSnapshotCell[];
}

export interface VariableFeedResult {
  periodId: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  snapshotYear: number;
  /** The per-employee feed rows (only employees with at least one
   * non-empty section — a blank roster is not noise). */
  employees: VariableFeedEmployeeRow[];
}

@Injectable()
export class FeedService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The combined variable feed for one pay period (PHASE-046's input
   * shape). Sections fold per employee; an employee with no feeding
   * facts in the period is absent from the rows (never a zero-filled
   * roster). */
  async variableFeed(input: {
    periodId: string;
    employeeId?: string;
    actorId: string | null;
  }): Promise<VariableFeedResult> {
    const period = await findPeriodById(input.periodId);
    if (period === undefined) throw new FeedPeriodNotFoundError(input.periodId);
    if (input.employeeId !== undefined && !/^[0-9a-fA-F-]{36}$/.test(input.employeeId)) {
      throw new FeedInvalidError(`employeeId must be a uuid: ${input.employeeId}`);
    }

    const [overtimeLines, absenceLate, snapshotYear] = await Promise.all([
      store.overtimeFeedLines(period.startDate, period.endDate),
      store.absenceLateFeedRows(period.startDate, period.endDate),
      Promise.resolve(Number(period.endDate.slice(0, 4))),
    ]);
    const leaveCells = await store.leaveSnapshotCells(snapshotYear);

    // Fold per employee (map by id — the three reads share the employee
    // axis; sections join, never cross-contaminate).
    const byEmployee = new Map<string, VariableFeedEmployeeRow>();
    const rowOf = (employeeId: string, code: string, name: string): VariableFeedEmployeeRow => {
      let row = byEmployee.get(employeeId);
      if (row === undefined) {
        row = {
          employeeId,
          employeeCode: code,
          employeeName: name,
          overtime: { totalHours: "0.00", totalMultipliedHours: "0.00", lines: [] },
          absenceDays: 0,
          missingPunchDays: 0,
          lateMinutes: 0,
          leaveBalances: [],
        };
        byEmployee.set(employeeId, row);
      }
      return row;
    };

    for (const line of overtimeLines) {
      const row = rowOf(line.employeeId, line.employeeCode, line.employeeName);
      row.overtime.lines.push(line);
    }
    for (const feed of absenceLate) {
      const row = rowOf(feed.employeeId, feed.employeeCode, feed.employeeName);
      row.absenceDays = feed.absenceDays;
      row.missingPunchDays = feed.missingPunchDays;
      row.lateMinutes = feed.lateMinutes;
    }
    for (const cell of leaveCells) {
      const row = rowOf(cell.employeeId, cell.employeeCode, cell.employeeName);
      row.leaveBalances.push(cell);
    }

    // The overtime totals per employee — exact BigInt hundredth sums at
    // the feed's numeric(12,2) scale (integer math only — never float;
    // ADR-0009; the decimal-strings module's own fromMinor pattern).
    for (const row of byEmployee.values()) {
      let totalHundredths = 0n;
      let multipliedHundredths = 0n;
      for (const line of row.overtime.lines) {
        totalHundredths += toHundredths(line.hours);
        multipliedHundredths += toHundredths(line.multipliedHours);
      }
      row.overtime.totalHours = fromHundredths(totalHundredths);
      row.overtime.totalMultipliedHours = fromHundredths(multipliedHundredths);
    }

    let employees = [...byEmployee.values()].sort((a, b) =>
      a.employeeCode < b.employeeCode ? -1 : a.employeeCode > b.employeeCode ? 1 : 0,
    );
    if (input.employeeId !== undefined) {
      const wanted = input.employeeId.toLowerCase();
      employees = employees.filter((row) => row.employeeId === wanted);
    }

    await this.audit.record({
      action: "hr.payroll_feed_computed",
      entityType: "fiscal_period",
      entityId: input.periodId,
      actorId: input.actorId ?? undefined,
      after: {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        employeeCount: employees.length,
      },
    });

    return {
      periodId: period.id,
      periodName: period.name,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      snapshotYear,
      employees,
    };
  }
}

/** numeric(12,2) string → exact BigInt hundredths (integer math only —
 * never float; ADR-0009). */
function toHundredths(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scaled = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -scaled : scaled;
}

/** Exact BigInt hundredths → numeric(12,2) string. */
function fromHundredths(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
