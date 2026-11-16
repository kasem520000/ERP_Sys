import { sql } from "drizzle-orm";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-20, the owner's concurrency review round, 2026-11-16) —
 * THE HR SHARED ATOMICITY FLOOR.
 *
 * The owner's review (proven with temporary two-transaction DB tests at
 * fd61ff2) found every HR check-then-write boundary racy: two
 * overlapping attendance sessions accepted at once, two overlapping
 * leave requests accepted at once, two 15-day approvals driving a
 * 20-day balance to used=30, an encashment writer bypassing the cap
 * check the approver used, and two concurrent employee↔user links
 * silently replacing each other (two link events, no unlink). This
 * module is the ONE shared mechanism every HR writer rides — the same
 * law the treasury open-item allocations follow (CC-02: the
 * transaction-scoped advisory lock plus the POST-LOCK recompute).
 *
 * THE PROTOCOL (per family, all writers of an entity take the SAME
 * gate BEFORE the guard read, so the guard read runs on the winner's
 * COMMITTED state and the loser's refusal is typed):
 *
 *   attendance day   lockAttendanceDay(s)   — the day key
 *     `${employeeId}|${workDate}` (the derivation unit — the day is
 *     the unit, never the row): manual capture, the import commit,
 *     the anomaly-resolve correction, the one-shot checkout, and the
 *     derivation run (the ABSENT-marker synthesis included) ALL take
 *     it, so INV-031's non-overlap and the marker's exactly-once hold
 *     under any interleaving;
 *   leave span       lockLeaveSpan          — one employee's whole
 *     span space: request creation AND approval (the two-leaves-at-
 *     once law's both gates);
 *   balance cell     lockBalanceCell(s)     — the (employee, type,
 *     year) cell: the approval, the encashment (G-51), the accrual
 *     recompute, and the carry-over rollover ALL take it, and every
 *     cap decision re-reads the cell UNDER the lock — `used_days` is
 *     the source of truth (leaves + encashments), never a side sum;
 *   employee link    the CONDITIONAL write  — `UPDATE employees SET
 *     user_id = … WHERE … AND user_id IS NULL` (bridge.store): the
 *     row lock the UPDATE itself takes is the gate, so the second
 *     concurrent linker matches ZERO rows and renders the typed
 *     BRIDGE_ALREADY_LINKED refusal — never a silent replacement.
 *
 * DEADLOCK FREEDOM (by construction, the mfg cancel/complete
 * precedent's star argument): within a namespace every acquirer
 * locks the SAME globally-sorted key order (the bulk arms sort and
 * chunk), so two overlapping acquisitions contend on their FIRST
 * shared key and the winner can always run to its commit — no cycle
 * can form. Across namespaces there is exactly ONE ordered edge —
 * the leave approval takes the span lock BEFORE the balance-cell
 * lock — and no writer ever takes them in the reverse order, so the
 * wait-for graph stays a forest. Advisory xact locks are re-entrant
 * within a transaction (a capture's own post-write derive re-takes
 * the day key it already holds), and all of them release at the
 * ambient UoW's COMMIT/ROLLBACK.
 *
 * The keys embed the tenant id: advisory locks are cluster-global,
 * so the tenant prefix keeps two tenants' same-named days from
 * sharing a gate (a hash collision between tenants would only
 * over-serialize, never under-serialize — the same entity always
 * hashes to the same key).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The advisory-lock statement chunk ceiling (the anomaly-insert
 * chunk law's shape — a bulk lock run is one statement per chunk). */
const LOCK_CHUNK = 500;

/** The composed key space. `hashtextextended` (the treasury CC-02
 * idiom) hashes the composed key to the bigint advisory-lock space
 * inside PostgreSQL — never in TS. */
export const hrAtomicKeys = {
  attendanceDay(employeeId: string, workDate: string): string {
    return `hr.attendance-day|${employeeId}|${workDate}`;
  },
  /** The derivation-unit bulk arm: keys already shaped
   * `${employeeId}|${workDate}` (the universe map's format — a uuid
   * contains no '|', so the split is exact). */
  attendanceDayKey(dayKey: string): string {
    return `hr.attendance-day|${dayKey}`;
  },
  leaveSpan(employeeId: string): string {
    return `hr.leave-span|${employeeId}`;
  },
  balanceCell(employeeId: string, leaveTypeId: string, year: number): string {
    return `hr.balance-cell|${employeeId}|${leaveTypeId}|${year}`;
  },
} as const;

/** Acquire the transaction-scoped advisory locks for the composed
 * keys — held until the ambient UoW commits/rolls back. The keys are
 * de-duplicated and GLOBALLY SORTED before acquisition (the deadlock
 * law above); each chunk is one statement, so a bulk run costs a
 * round trip per 500 keys. */
export async function lockHrKeys(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const tenantId = requireTenantContext().tenantId;
  const sorted = [...new Set(keys.map((key) => `${tenantId}|${key}`))].sort();
  for (let start = 0; start < sorted.length; start += LOCK_CHUNK) {
    const chunk = sorted.slice(start, start + LOCK_CHUNK);
    // ARRAY[...] with one bound parameter per key (never a driver-side
    // array literal — the unnest preserves the sorted order, so the
    // locks are acquired in the SAME global order by every writer).
    await tenantTx().execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(k, 0))
      FROM unnest(ARRAY[${sql.join(
        chunk.map((key) => sql`${key}`),
        sql`, `,
      )}]::text[]) AS k
    `);
  }
}

// -- the family gates -----------------------------------------------------------------

/** The attendance-day gate (manual capture, checkout, the derivation
 * run, the resolve correction). */
export async function lockAttendanceDay(employeeId: string, workDate: string): Promise<void> {
  await lockHrKeys([hrAtomicKeys.attendanceDay(employeeId, workDate)]);
}

/** The derivation run's bulk arm: every `${employeeId}|${workDate}`
 * universe key at once, sorted. */
export async function lockAttendanceDays(dayKeys: readonly string[]): Promise<void> {
  await lockHrKeys(dayKeys.map((key) => hrAtomicKeys.attendanceDayKey(key)));
}

/** The import commit's bulk arm: the (employee, day) pairs of every
 * session the file would land. */
export async function lockAttendanceEmployeeDays(
  pairs: readonly { employeeId: string; workDate: string }[],
): Promise<void> {
  await lockHrKeys(pairs.map((pair) => hrAtomicKeys.attendanceDay(pair.employeeId, pair.workDate)));
}

/** The leave-span gate (request creation + approval — the
 * two-leaves-at-once law's both doors). */
export async function lockLeaveSpan(employeeId: string): Promise<void> {
  await lockHrKeys([hrAtomicKeys.leaveSpan(employeeId)]);
}

/** The balance-cell gate (approval, encashment, accrual recompute,
 * carry-over rollover). */
export async function lockBalanceCell(
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<void> {
  await lockHrKeys([hrAtomicKeys.balanceCell(employeeId, leaveTypeId, year)]);
}

/** The bulk balance-cell arm (the accrual run's targets, the
 * rollover's from+to cells). */
export async function lockBalanceCells(
  cells: readonly { employeeId: string; leaveTypeId: string; year: number }[],
): Promise<void> {
  await lockHrKeys(
    cells.map((cell) => hrAtomicKeys.balanceCell(cell.employeeId, cell.leaveTypeId, cell.year)),
  );
}
