import { DomainError } from "@erp/domain-core";
import { sql } from "drizzle-orm";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-20, the owner's concurrency review round, 2026-11-16) —
 * THE HR SHARED ATOMICITY FLOOR. Hardened in PHASE-046 by the owner's
 * pinned technical notes (2026-11-16, the approval round): the CANONICAL
 * KEY LAW, the NO-EXPANSION LAW, and the DATABASE-GUARANTEED ACQUISITION
 * ORDER. Extended in PHASE-046 W-3 (D-09): the payroll namespaces join
 * the SAME one floor — `payroll.run|{runId}` and
 * `payroll.eosb-employee|{employeeId}` — the handoff contract's law that
 * every new payroll writer rides the T-20 mechanism (one module, one
 * acquisition, one order; the payroll module imports it directly — the
 * boundary review at W-3 found dep-cruise clean on the edge: no cycle,
 * no layering rule crosses, so NO promotion to src/infra/db/ is needed;
 * recorded in the W-3 evidence).
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
 *     span space: request creation's gate;
 *   balance cell     lockBalanceCell(s)     — the (employee, type,
 *     year) cell: the encashment (G-51), the accrual recompute, and
 *     the carry-over rollover ALL take it, and every cap decision
 *     re-reads the cell UNDER the lock — `used_days` is the source of
 *     truth (leaves + encashments), never a side sum;
 *   leave approval   lockLeaveApproval      — the span + the
 *     start-year cell TOGETHER, in ONE call (the approval is the one
 *     writer whose entity spans both families; the whole-set-in-one-
 *     call law below is why it can never deadlock against either
 *     family's own writers);
 *   employee link    the CONDITIONAL write  — `UPDATE employees SET
 *     user_id = … WHERE … AND user_id IS NULL` (bridge.store): the
 *     row lock the UPDATE itself takes is the gate, so the second
 *     concurrent linker matches ZERO rows and renders the typed
 *     BRIDGE_ALREADY_LINKED refusal — never a silent replacement.
 *
 * THE CANONICAL KEY LAW (the owner's pinned note a, 2026-11-16):
 * PostgreSQL treats `ABC…` and `abc…` (and the undashed 32-hex form)
 * as the SAME uuid, so two writers naming the same employee with
 * different letter cases MUST derive the SAME lock key — otherwise
 * the case variant is an open side door around every gate. Every uuid
 * component of every key is normalized to the CANONICAL lowercase
 * dashed form BEFORE the key is composed (`canonicalUuid`), and a
 * value that is not a uuid at all fails LOUD (never a silently
 * different key). The same law the c537113 round pinned for the
 * roster's duplicate-employee refusal, applied to the lock space.
 *
 * THE NO-EXPANSION LAW + THE DB-GUARANTEED ORDER (the owner's pinned
 * note b, 2026-11-16): deadlock freedom is a property of the ORDER
 * keys are acquired in, and the owner's directive is explicit — the
 * order may not rest on app-side sorting alone. Two mechanisms now
 * hold it:
 *
 *   1. WITHIN one acquisition the database itself enforces the order:
 *      the keys travel as an array, and the lock statement sorts them
 *      INSIDE PostgreSQL (`ORDER BY k COLLATE "C"` in a MATERIALIZED
 *      CTE) before any lock is taken — the executor evaluates the
 *      volatile lock function per row of the CTE scan, in the CTE's
 *      stored sorted order. `COLLATE "C"` is byte order, EXACTLY the
 *      same total order as the TypeScript `<` comparison on these
 *      ASCII keys, so the app-side ledger below and the DB-side
 *      acquisition agree on one order.
 *
 *   2. ACROSS acquisitions inside ONE transaction the reservation
 *      LEDGER forbids the deadlock recipe outright: a transaction may
 *      re-enter keys it already holds (advisory xact locks are
 *      re-entrant) and may EXPAND its set with keys that sort
 *      strictly AFTER everything it already holds (provably
 *      equivalent to having acquired the union in one sorted call),
 *      but an expansion at or before the held maximum throws the
 *      typed `HrLockOrderViolationError` BEFORE any lock statement
 *      runs. Two transactions that both expanded backwards could
 *      wait on each other in a cycle — the exact 40P01 recipe; the
 *      ledger makes the pattern unrepresentable, for this module's
 *      namespaces and for every future one (PHASE-046's payroll
 *      writers import this same floor).
 *
 * With both mechanisms the wait-for graph stays a forest: within a
 * namespace every acquirer locks in one globally-sorted order; across
 * namespaces no writer ever acquires out of that order (the ledger
 * refuses), so two overlapping acquisitions contend on their FIRST
 * shared key and the winner can always run to its commit.
 *
 * The keys embed the tenant id: advisory locks are cluster-global,
 * so the tenant prefix keeps two tenants' same-named days from
 * sharing a gate (a hash collision between tenants would only
 * over-serialize, never under-serialize — the same entity always
 * hashes to the same key).
 *
 * PHASE-046 (D-09) — THE PAYROLL GATES, the same floor's namespaces:
 *   payroll run       lockPayrollRun        — `payroll.run|{runId}`:
 *     the run's check-then-write windows serialize — calculate (the
 *     DRAFT reset + the line write), post (the G-29 fold + the stamp),
 *     reverse, the remittance settlement (the statutory_summary
 *     liability write), AND the salary payout (W-6/T-17 — the owner's
 *     F2 scope addition, recorded 2026-11-17 at 6387da9: the
 *     paid_net_total advance was a gate-less read-modify-write, so two
 *     concurrent partial payouts lost an update the 0043 CHECK
 *     0 ≤ paid ≤ net cannot catch) ALL take it, so a reset never eats a
 *     posted run's books, two remittances never double-settle the same
 *     liability, and two payouts never double-pay one outstanding;
 *   eosb employee     lockPayrollEosbEmployee — `payroll.eosb-employee|
 *     {employeeId}`: the true-up × true-up and the true-up × G-31
 *     settle interplay — the provision read + the delta write under
 *     ONE lock (a racing pair collapses to one G-54 delta + the
 *     settled employee's terminal stamp, never a double-counted
 *     provision).
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

// -- the canonical key law ----------------------------------------------------------

const CANONICAL_DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANONICAL_PLAIN = /^[0-9a-f]{32}$/;

/**
 * Normalize a uuid to PostgreSQL's canonical form (lowercase, dashed)
 * — the SAME canonical value for every accepted spelling (uppercase,
 * mixed case, undashed 32-hex). A non-uuid fails LOUD: a lock key
 * derived from a malformed id would silently diverge from the same
 * entity's canonical key, which is the hole the law exists to close.
 */
export function canonicalUuid(id: string): string {
  const lower = id.toLowerCase();
  if (CANONICAL_DASHED.test(lower)) return lower;
  if (CANONICAL_PLAIN.test(lower)) {
    return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
  }
  throw new Error(
    `hr atomicity floor: '${id}' is not a uuid — a lock key would not be canonical (the same entity must always derive the same key)`,
  );
}

/** The composed key space. `hashtextextended` (the treasury CC-02
 * idiom) hashes the composed key to the bigint advisory-lock space
 * inside PostgreSQL — never in TS. Every uuid component is
 * canonicalized BEFORE composition (the canonical key law). */
export const hrAtomicKeys = {
  attendanceDay(employeeId: string, workDate: string): string {
    return `hr.attendance-day|${canonicalUuid(employeeId)}|${workDate}`;
  },
  /** The derivation-unit bulk arm: keys already shaped
   * `${employeeId}|${workDate}` (the universe map's format — a uuid
   * contains no '|', so the split is exact; the employee component is
   * canonicalized on the way through). */
  attendanceDayKey(dayKey: string): string {
    const bar = dayKey.indexOf("|");
    if (bar === -1) {
      throw new Error(
        `hr atomicity floor: '${dayKey}' is not an employee|date universe key — refusing to derive a non-canonical lock key`,
      );
    }
    return `hr.attendance-day|${canonicalUuid(dayKey.slice(0, bar))}|${dayKey.slice(bar + 1)}`;
  },
  leaveSpan(employeeId: string): string {
    return `hr.leave-span|${canonicalUuid(employeeId)}`;
  },
  balanceCell(employeeId: string, leaveTypeId: string, year: number): string {
    return `hr.balance-cell|${canonicalUuid(employeeId)}|${canonicalUuid(leaveTypeId)}|${year}`;
  },
} as const;

/** PHASE-046 (D-09) — the payroll key space, the SAME floor: the run
 * gate and the eosb employee gate (see the header's protocol block). */
export const payrollAtomicKeys = {
  run(runId: string): string {
    return `payroll.run|${canonicalUuid(runId)}`;
  },
  eosbEmployee(employeeId: string): string {
    return `payroll.eosb-employee|${canonicalUuid(employeeId)}`;
  },
} as const;

/** PHASE-047 (W-2) — the talent key space, the SAME floor: the CYCLE
 * gate. Every performance-engine writer with a check-then-write window
 * over a cycle's state takes the cycle's ONE key BEFORE its guard
 * read — the lifecycle CAS transitions (activate/calibrate/close), the
 * review draft/submit/calibrate acts (the ACTIVE-window check), and
 * every goal write (the DRAFT/ACTIVE window check + the D-09
 * re-parent walk over the cycle's tree) — so a goal write can never
 * interleave with a calibrating transition and two re-parent moves can
 * never both pass the cycle guard on the same stale read (the payroll
 * run gate's exact discipline; the CAS UPDATE itself remains the state
 * machine's truth — the lock closes the window, the CAS refuses the
 * stale write). */
export const talentAtomicKeys = {
  cycle(cycleId: string): string {
    return `talent.cycle|${canonicalUuid(cycleId)}`;
  },
} as const;

// -- the reservation ledger (the no-expansion law) -----------------------------------

/** The typed refusal for the deadlock recipe: a transaction trying to
 * expand its reserved lock set with a key at or before its held
 * maximum. This is a programming-error guard — it fires BEFORE any
 * lock statement, so the transaction is still usable (the caller
 * restructures to one whole-set call, the only legal shape). */
export class HrLockOrderViolationError extends DomainError {
  constructor(key: string, maxHeld: string) {
    super(
      "hr/lock-order-violation",
      `the atomicity floor refused to expand this transaction's lock set: '${key}' sorts at or before the already-reserved '${maxHeld}' — acquire the transaction's whole key set in ONE call (re-entry and strictly-ascending expansion are the only legal shapes; a backwards expansion is the 40P01 deadlock recipe)`,
    );
  }
}

interface KeyReservation {
  /** The composed keys this transaction already holds (re-entrant). */
  held: Set<string>;
  /** The maximum (latest in the global order) key reserved so far. */
  maxHeld: string | undefined;
}

/** The per-transaction reservation ledger. Keyed on the live UoW
 * handle (`withTenant`/`withTenantOnTx` keep one identity per
 * transaction; the entry dies with the handle). */
const reservations = new WeakMap<object, KeyReservation>();

// -- the acquisition -----------------------------------------------------------------

/** Acquire the transaction-scoped advisory locks for the composed
 * keys — held until the ambient UoW commits/rolls back. The keys are
 * de-duplicated and GLOBALLY SORTED (TypeScript `<` — byte order on
 * these ASCII keys, the same total order as the statement's
 * `COLLATE "C"`), the DATABASE re-sorts and locks them in that one
 * order (the MATERIALIZED CTE — the order is guaranteed by the
 * engine, not by the array's shape), and the reservation LEDGER
 * refuses any call that would expand this transaction's set with a
 * key at or before its held maximum (the no-expansion law — the
 * deadlock recipe is unrepresentable). Each chunk is one statement,
 * so a bulk run costs a round trip per 500 keys. */
export async function lockHrKeys(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const tenantId = canonicalUuid(requireTenantContext().tenantId);
  const tx = tenantTx();
  const sorted = [...new Set(keys.map((key) => `${tenantId}|${key}`))].sort();

  let reservation = reservations.get(tx as object);
  if (reservation === undefined) {
    reservation = { held: new Set(), maxHeld: undefined };
    reservations.set(tx as object, reservation);
  }
  for (const key of sorted) {
    if (reservation.held.has(key)) continue; // re-entrant — already ours
    if (reservation.maxHeld !== undefined && key <= reservation.maxHeld) {
      throw new HrLockOrderViolationError(key, reservation.maxHeld);
    }
  }

  for (let start = 0; start < sorted.length; start += LOCK_CHUNK) {
    const chunk = sorted.slice(start, start + LOCK_CHUNK);
    // The DATABASE-GUARANTEED order (the owner's pinned note b): the
    // keys are sorted INSIDE PostgreSQL by the statement itself — the
    // MATERIALIZED CTE stores the sorted rows before the outer scan
    // evaluates the volatile lock function per row, and COLLATE "C"
    // pins the collation to byte order (the same total order as the
    // ledger's TypeScript comparisons — never a collation-dependent
    // divergence between app and engine).
    await tx.execute(sql`
      WITH ordered AS MATERIALIZED (
        SELECT k FROM unnest(ARRAY[${sql.join(
          chunk.map((key) => sql`${key}`),
          sql`, `,
        )}]::text[]) AS k ORDER BY k COLLATE "C"
      )
      SELECT pg_advisory_xact_lock(hashtextextended(k, 0)) FROM ordered
    `);
    for (const key of chunk) {
      reservation.held.add(key);
    }
    reservation.maxHeld = chunk[chunk.length - 1]!;
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

/** The leave-span gate (request creation — the two-leaves-at-once
 * law's first door). */
export async function lockLeaveSpan(employeeId: string): Promise<void> {
  await lockHrKeys([hrAtomicKeys.leaveSpan(employeeId)]);
}

/** The balance-cell gate (the encashment (G-51), the accrual
 * recompute, the carry-over rollover). */
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

/** The APPROVAL's whole set in ONE call (the no-expansion law's
 * canonical example): the employee's span gate AND the start-year
 * balance cell together — the span re-check and the cap re-read both
 * run under BOTH locks, so the approval serializes against the
 * create-boundary writers AND the cell writers (the encashment, the
 * accrual recompute, the rollover) in one sorted acquisition. */
export async function lockLeaveApproval(
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<void> {
  await lockHrKeys([
    hrAtomicKeys.leaveSpan(employeeId),
    hrAtomicKeys.balanceCell(employeeId, leaveTypeId, year),
  ]);
}

// -- the payroll gates (PHASE-046 D-09 — the same floor) ------------------------------

/** The RUN gate: calculate (the DRAFT reset + the line write), post,
 * reverse, the remittance settlement, and the salary payout (W-6/T-17 —
 * F2) serialize on the run's one key — the check-then-write windows
 * (status floor, outstanding liability, the paid_net_total advance)
 * never interleave. */
export async function lockPayrollRun(runId: string): Promise<void> {
  await lockHrKeys([payrollAtomicKeys.run(runId)]);
}

/** The EOSB EMPLOYEE gate: the true-up × true-up and the true-up ×
 * G-31 settle interplay — the provision read + the delta write under
 * one lock, so the standing provision never double-counts. */
export async function lockPayrollEosbEmployee(employeeId: string): Promise<void> {
  await lockHrKeys([payrollAtomicKeys.eosbEmployee(employeeId)]);
}

// -- the talent gates (PHASE-047 W-2 — the same floor) --------------------------------

/** THE CYCLE gate: the performance engine's serialization point —
 * every check-then-write window over a cycle's state (the lifecycle
 * CAS transitions, the review acts' ACTIVE-window check, the goal
 * writes' DRAFT/ACTIVE window + the D-09 re-parent walk) runs under
 * the cycle's ONE key, so the guard reads see committed state and the
 * CAS/conditional writes refuse anything raced or stale (the payroll
 * run gate's discipline — see talentAtomicKeys). */
export async function lockTalentCycle(cycleId: string): Promise<void> {
  await lockHrKeys([talentAtomicKeys.cycle(cycleId)]);
}
