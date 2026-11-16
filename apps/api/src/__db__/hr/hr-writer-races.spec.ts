import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Client } from "pg";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import {
  AttendanceImportService,
  DEFAULT_IMPORT_MAPPING,
} from "../../modules/hr/application/attendance-import-service";
import { BridgeService } from "../../modules/hr/application/bridge-service";
import { LeaveService } from "../../modules/hr/application/leave-service";
import { LeavePostingService } from "../../modules/hr/application/leave-posting-service";
import * as attendanceStore from "../../modules/hr/infrastructure/attendance.store";
import * as bridgeStore from "../../modules/hr/infrastructure/bridge.store";
import * as importStore from "../../modules/hr/infrastructure/attendance-import.store";
import * as leaveStore from "../../modules/hr/infrastructure/leave.store";
import * as tenancy from "../../modules/tenancy/infrastructure/tenancy.store";
import * as treasury from "../../modules/treasury/infrastructure/treasury.store";
import { insertUser } from "../../modules/identity/api/identity";
import { H_ACTOR, setupHrFixture, shiftSvc, superuserClient } from "./fixtures";

/**
 * PHASE-045 T-20 — THE OWNER'S CONCURRENCY REVIEW ROUND, pinned
 * permanently (2026-11-16). The owner reviewed origin/main at fd61ff2,
 * re-produced every check-then-write window with temporary
 * two-transaction DB tests (independent transactions + synchronization
 * barriers), and found all five races REAL:
 *
 *   1. ATTENDANCE — two overlapping punch sessions accepted for one
 *      employee-day (manual capture), and the daily derivation
 *      synthesizing the ABSENT marker TWICE under concurrency;
 *   2. LEAVES — two overlapping leave requests accepted at once (the
 *      two-leaves-at-once law passed twice on the same stale read);
 *   3. BALANCE — two 15-day approvals on a 20-day entitlement driving
 *      used_days to 30.00;
 *   4. BALANCE — the encashment's balance writer incrementing
 *      used_days without the cap check the approver used (an encashed
 *      10.00 + an approved 15.00 = 25.00 on a 20.00 entitlement);
 *   5. BRIDGE — two concurrent employee↔user links both accepted,
 *      silently replacing the first (two link events, no unlink).
 *
 * THE FIX UNDER TEST — the HR shared atomicity floor
 * (modules/hr/infrastructure/atomic.ts): every writer of an entity
 * takes the SAME transaction-scoped gate BEFORE its guard read — the
 * attendance-day lock (manual capture, import commit, anomaly-resolve
 * correction, checkout, and the derivation run), the leave-span lock
 * (creation + approval), the balance-cell lock (approval, encashment,
 * accrual recompute, carry-over rollover — with used_days as the
 * source of truth read UNDER the lock), and the bridge's conditional
 * compare-and-set write (`WHERE … AND user_id IS NULL`).
 *
 * THE DETERMINISTIC HARNESS (the mfg cancel/complete race precedent):
 * vi.spyOn splits the WINNER's UoW exactly at the owner's window —
 * AFTER the winner's write arm has run inside its transaction (every
 * gate held, nothing committed) — and starts the LOSER as a REAL
 * service call in its OWN withTenant UoW on its OWN pooled
 * connection. The world is then classified from committed reads:
 *   - "blocked" — the loser is WAITING on a lock the winner's UoW
 *     holds (the post-fix shape — the serialization engaged; the
 *     pre-fix world is "slipped", the loser settled inside the
 *     window, which is the owner's proof and FAILS these tests);
 *   - after the winner commits, the loser unblocks, re-reads the
 *     winner's COMMITTED state, and renders its typed refusal.
 * Every duel closes with the NO-ILLEGAL-STATE assertion — the exact
 * final state the owner demanded ("لا تبقى الحالة غير القانونية").
 *
 * Isolation: the whole suite runs on a DEDICATED tenant (CC) — the
 * LP golden-world precedent (a provisioning template, real postings,
 * no shared tenants' books) — with its own employees (the CC series),
 * its own leave types, and its own import files; the world is reset
 * by code prefix in beforeAll/afterAll (the inv031 precedent — the
 * FKs cascade the employees' attendance/leave/balance rows).
 */

const TENANT_CC = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7e5e";
const FY_CC = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7e6e";
const PERIOD_CC = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7e7e"; // 2026-01-01…12-31 (OPEN)

const audit = new AuditService(new DrizzleAuditStore());
const attendanceSvc = new AttendanceService(audit);
const importSvc = new AttendanceImportService(audit, attendanceSvc);
const leaveSvc = new LeaveService(audit);
const postingSvc = new LeavePostingService(
  audit,
  new PostingService(audit, new PartnerSubledgerService()),
  new ResolveEffectiveConfigService(new ConfigRepository()),
);
const bridgeSvc = new BridgeService(audit);

let seq = 0;
function unique(label: string): string {
  seq += 1;
  return `${label}-${Date.now() % 100000}-${seq}`;
}

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[],
): Promise<T[]> {
  const su: Client = await superuserClient();
  try {
    const result = await su.query<T>(text, params as never[]);
    return result.rows;
  } finally {
    await su.end();
  }
}

// -- the deterministic duel harness (the mfg race precedent) ---------------------------

/** Is ANY lock in the cluster ungranted (someone waiting)? pg_locks is
 * world-readable; in the single-fork sequential suite the only possible
 * waiter during the window is the raced loser. */
async function anyLockWaiter(): Promise<boolean> {
  return withTenant(TENANT_CC, async () => {
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_locks WHERE granted = false`,
    );
    return rows.rows[0]!.n > 0;
  });
}

interface WindowObservation {
  shape: "slipped" | "blocked";
  /** The loser's error, when it settled inside the window ("slipped"). */
  loserError?: unknown;
}

/** Watch the loser inside the winner's read→write window and classify
 * the world deterministically: "slipped" — the loser SETTLED (fulfilled
 * or refused) inside the window, the pre-fix shape (the owner's proof);
 * "blocked" — the loser is WAITING on a lock the winner's UoW holds,
 * the post-fix shape (the serialization engaged). */
async function observeTheWindow(loser: Promise<unknown>): Promise<WindowObservation> {
  let settled = false;
  let loserError: unknown;
  loser.then(
    () => {
      settled = true;
    },
    (error: unknown) => {
      settled = true;
      loserError = error;
    },
  );
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (settled) {
      return { shape: "slipped", loserError };
    }
    if (await anyLockWaiter()) {
      return { shape: "blocked" };
    }
    if (Date.now() > deadline) {
      throw new Error(
        "harness: the loser neither settled nor blocked within 15s — the window is not the raced one",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface DuelArm {
  observation: { value?: WindowObservation };
  loser: { promise?: Promise<unknown>; value?: unknown; error?: unknown };
  /** Restore the spy and settle the loser (never leak a spy, never leak
   * an unhandled rejection — the mfg precedent). */
  finish: () => Promise<void>;
}

/** Arm the duel: the spied write arm runs the REAL function, and with
 * the winner's gates held and its write uncommitted, the loser starts
 * in its own UoW and the window is classified. */
function armDuelSpy<A extends unknown[], R>(
  spy: MockInstance<(...args: A) => Promise<R>>,
  real: (...args: A) => Promise<R>,
  runLoser: () => Promise<unknown>,
): DuelArm {
  const arm: DuelArm = {
    observation: {},
    loser: {},
    finish: async () => {
      spy.mockRestore();
      if (arm.loser.promise !== undefined) {
        try {
          arm.loser.value = await arm.loser.promise;
        } catch (error) {
          arm.loser.error = error;
        }
      }
    },
  };
  spy.mockImplementationOnce(async (...args: A) => {
    const value = await real(...args);
    const loser = runLoser();
    arm.loser.promise = loser;
    arm.observation.value = await observeTheWindow(loser);
    return value;
  });
  return arm;
}

function loserCode(arm: DuelArm): string {
  return (arm.loser.error as { code: string } | undefined)?.code ?? "(fulfilled)";
}

// -- the committed-state readers (fresh superuser reads — RLS bypassed) ----------------

async function sessionRows(employeeId: string, workDate: string): Promise<
  { checkIn: string; checkOut: string | null }[]
> {
  return q<{ checkIn: string; checkOut: string | null }>(
    `SELECT check_in::text AS "checkIn", check_out::text AS "checkOut"
       FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2::uuid AND work_date = $3::date AND check_in IS NOT NULL
       ORDER BY check_in`,
    [TENANT_CC, employeeId, workDate],
  );
}

/** The pairwise-overlap count of one employee-day's sessions (INV-031's
 * direct SQL read — 0 is the law). */
async function overlapCount(employeeId: string, workDate: string): Promise<number> {
  const rows = await q<{ n: number }>(
    `WITH s AS (
       SELECT check_in, COALESCE(check_out, 'infinity'::timestamptz) AS check_out
       FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2::uuid AND work_date = $3::date AND check_in IS NOT NULL
     )
     SELECT count(*)::int AS n FROM s a JOIN s b
       ON a.check_in < b.check_in AND a.check_in < b.check_out AND b.check_in < a.check_out`,
    [TENANT_CC, employeeId, workDate],
  );
  return rows[0]!.n;
}

async function absentMarkerCount(employeeId: string, workDate: string): Promise<number> {
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM attendance_records
      WHERE tenant_id = $1 AND employee_id = $2::uuid AND work_date = $3::date
        AND check_in IS NULL AND note = 'DERIVED_ABSENT'`,
    [TENANT_CC, employeeId, workDate],
  );
  return rows[0]!.n;
}

async function leaveRequestStates(
  employeeId: string,
): Promise<{ id: string; status: string; days: string }[]> {
  return q<{ id: string; status: string; days: string }>(
    `SELECT id::text, status, days::text AS days FROM leave_requests
      WHERE tenant_id = $1 AND employee_id = $2::uuid ORDER BY start_date`,
    [TENANT_CC, employeeId],
  );
}

type CellRow = {
  year: number;
  entitlementDays: string;
  usedDays: string;
  carriedForwardDays: string;
};

async function balanceCells(
  employeeId: string,
  leaveTypeId: string,
): Promise<CellRow[]> {
  return q<CellRow>(
    `SELECT year, entitlement_days::text AS "entitlementDays", used_days::text AS "usedDays",
            carried_forward_days::text AS "carriedForwardDays"
       FROM leave_balances
       WHERE tenant_id = $1 AND employee_id = $2::uuid AND leave_type_id = $3::uuid
       ORDER BY year`,
    [TENANT_CC, employeeId, leaveTypeId],
  );
}

/** INV-031's direct SQL assertion over every cell the employee holds. */
async function expectInv031(employeeId: string): Promise<void> {
  const violations = await q<{ year: number }>(
    `SELECT year FROM leave_balances
      WHERE tenant_id = $1 AND employee_id = $2::uuid
        AND used_days > entitlement_days + carried_forward_days`,
    [TENANT_CC, employeeId],
  );
  expect(
    violations,
    `INV-031 violated for ${employeeId}: used exceeds entitlement + carried in ${violations.map((row) => row.year).join(", ")}`,
  ).toHaveLength(0);
}

async function auditCount(entityId: string, action: string): Promise<number> {
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND entity_id = $2::uuid AND action = $3`,
    [TENANT_CC, entityId, action],
  );
  return rows[0]!.n;
}

// -- the world -------------------------------------------------------------------------

interface ConcFixture {
  a1: string;
  a2: string;
  a3: string;
  a4: string;
  a5: string;
  b2: string;
  b3: string;
  b4: string;
  b5: string;
  b6: string;
  b7: string;
  c1: string;
  c2: string;
  c3: string;
  leaveTypeId: string;
  bankAccountId: string;
  u1: string;
  u2: string;
  u3: string;
}

const spec: { fixture?: ConcFixture } = {};

async function resetCcWorld(): Promise<void> {
  // The inv031 precedent: the import batches by fileName prefix, then
  // the spec's employees by code (the FKs CASCADE their
  // attendance/leave/balance rows), then the types.
  await q(
    `DELETE FROM attendance_import_batches WHERE tenant_id = $1 AND file_name LIKE 'cc-%'`,
    [TENANT_CC],
  );
  await q(`DELETE FROM employees WHERE tenant_id = $1 AND code LIKE 'CC-%'`, [TENANT_CC]);
  await q(`DELETE FROM leave_types WHERE tenant_id = $1 AND code LIKE 'LV-CC-%'`, [TENANT_CC]);
}

beforeAll(async () => {
  await setupHrFixture();
  // The deterministic re-run floor (the inv031 precedent): the spec's
  // OWN world resets by prefix before it is built.
  await resetCcWorld();
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant CC (concurrency duels)', 'مستأجر التزامن', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_CC],
  );
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES
       ($1, $2, 'FY2026-CC', '2026-01-01', '2026-12-31')
     ON CONFLICT (id) DO NOTHING`,
    [FY_CC, TENANT_CC],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status) VALUES
       ($1, $2, $3, 'FY2026-CC-FULL', 'REGULAR', '2026-01-01', '2026-12-31', 'OPEN')
     ON CONFLICT (id) DO NOTHING`,
    [PERIOD_CC, TENANT_CC, FY_CC],
  );
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'CC-A1', 'Adel Al-Capture', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'CC-A2', 'Amina Al-Import', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'CC-A3', 'Aref Al-Correction', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'CC-A4', 'Aziz Al-Absent', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'CC-A5', 'Alaa Al-Smoke', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'CC-B2', 'Bilal Al-Balance', '2026-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'CC-B3', 'Bassam Al-Cashout', '2026-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'CC-B4', 'Buthaina Al-Duel', '2026-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'CC-B5', 'Bakr Al-Accrual', '2026-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'CC-B6', 'Bashir Al-Rollover', '2026-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'CC-B7', 'Bayan Al-Smoke', '2026-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'CC-C1', 'Camel Al-Link', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'CC-C2', 'Dina Al-First', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'CC-C3', 'Faris Al-Second', '2026-01-01', 'FULL_TIME', 8000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_CC, H_ACTOR],
  );
  const byCode = new Map(employeeRows.rows.map((row) => [row.code, row.id]));

  // The bridge arms' users: U1/U2 (the same-employee duel), U3 (the
  // same-user duel) — active members of the CC tenant under an empty role.
  const stamp = Date.now() % 100000;
  const u1 = await insertUser({
    email: `cc-u1-${stamp}@fixture.test`,
    fullName: "CC User One",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const u2 = await insertUser({
    email: `cc-u2-${stamp}@fixture.test`,
    fullName: "CC User Two",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const u3 = await insertUser({
    email: `cc-u3-${stamp}@fixture.test`,
    fullName: "CC User Three",
    passwordHash: "x",
    status: "ACTIVE",
  });
  const roleId = (
    await su.query<{ id: string }>(
      `INSERT INTO roles (id, tenant_id, key, name) VALUES (gen_random_uuid(), $1, $2, 'CC empty role (T-20)')
       RETURNING id`,
      [TENANT_CC, `cc_empty_${stamp}`],
    )
  ).rows[0]!.id;
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES
       (gen_random_uuid(), $1, $2, $4), (gen_random_uuid(), $1, $3, $4), (gen_random_uuid(), $1, $5, $4)
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [TENANT_CC, u1.id, u2.id, roleId, u3.id],
  );
  await su.end();

  // The CC golden world: the provisioning CoA template (real purpose
  // mappings for the encashment's G-51 settlement) + the payout bank.
  const { bankGlAccountId } = await withTenant(TENANT_CC, async () => {
    await tenancy.provisionCoaTemplate();
    const accounts = await tenancy.listAccounts();
    const byCode = new Map(accounts.map((row) => [row.code, row.id]));
    return { bankGlAccountId: byCode.get("1121")! };
  });
  const bank = await withTenant(TENANT_CC, () =>
    treasury.insertCashAccount({
      name: "CC Duel Bank",
      nameAr: "بنك التزامن",
      type: "BANK",
      accountId: bankGlAccountId,
      branchId: null,
      currencyCode: "SAR",
      createdBy: H_ACTOR,
    }),
  );

  // The shared leave type: 20.00 days/year, carry cap 10.00 — the
  // 2026 accrual gives every CC employee a 20.00 cell (the duel canvas).
  const leaveType = await withTenant(TENANT_CC, () =>
    leaveSvc.createType({
      code: "LV-CC-ANNUAL",
      name: "Annual leave (concurrency duels)",
      nameAr: "إجازة سنوية (اختبارات التزامن)",
      paid: true,
      accrualDaysPerYear: "20.00",
      monthlyGrant: false,
      prorateJoiners: false,
      carryOverCapDays: "10.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_CC, () =>
    leaveSvc.runAccrual({ leaveTypeId: leaveType.id, year: 2026, actorId: H_ACTOR }),
  );

  // The ABSENT duel's roster: A4 on a day shift over a past punchless day.
  const dayShift = await withTenant(TENANT_CC, () =>
    shiftSvc.create({
      code: "CC-SHIFT-DAY",
      name: "CC duel day shift 08:00–16:00",
      nameAr: "وردية نهارية لاختبارات التزامن",
      startTime: "08:00",
      endTime: "16:00",
      graceMinutes: 15,
      breakMinutes: 30,
      isNight: false,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  await withTenant(TENANT_CC, () =>
    shiftSvc.setRosterCell({
      employeeId: byCode.get("CC-A4")!,
      workDate: "2026-11-05",
      shiftId: dayShift.id,
      note: null,
      actorId: H_ACTOR,
    }),
  );

  spec.fixture = {
    a1: byCode.get("CC-A1")!,
    a2: byCode.get("CC-A2")!,
    a3: byCode.get("CC-A3")!,
    a4: byCode.get("CC-A4")!,
    a5: byCode.get("CC-A5")!,
    b2: byCode.get("CC-B2")!,
    b3: byCode.get("CC-B3")!,
    b4: byCode.get("CC-B4")!,
    b5: byCode.get("CC-B5")!,
    b6: byCode.get("CC-B6")!,
    b7: byCode.get("CC-B7")!,
    c1: byCode.get("CC-C1")!,
    c2: byCode.get("CC-C2")!,
    c3: byCode.get("CC-C3")!,
    leaveTypeId: leaveType.id,
    bankAccountId: bank.id,
    u1: u1.id,
    u2: u2.id,
    u3: u3.id,
  };
});

afterAll(async () => {
  await resetCcWorld();
});

// -- the duels --------------------------------------------------------------------------

describe("PHASE-045 T-20 — the owner's concurrency review round: the attendance family", () => {
  it("(1) MANUAL CAPTURE — two overlapping sessions for one employee-day: the loser blocks on the day lock, then refuses typed; never two overlapping sessions", async () => {
    const f = spec.fixture!;
    const real = attendanceStore.insertAttendanceRecord;
    const spy = vi.spyOn(attendanceStore, "insertAttendanceRecord");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        attendanceSvc.capture({
          employeeId: f.a1,
          workDate: "2026-11-02",
          checkIn: "2026-11-02T10:00:00+03:00",
          checkOut: "2026-11-02T13:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    );
    let winner: Awaited<ReturnType<typeof attendanceSvc.capture>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        attendanceSvc.capture({
          employeeId: f.a1,
          workDate: "2026-11-02",
          checkIn: "2026-11-02T09:00:00+03:00",
          checkOut: "2026-11-02T12:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(Date.parse(winner!.checkIn!)).toBe(Date.parse("2026-11-02T09:00:00+03:00"));
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced (the owner's proof): the loser settled inside the window — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("ATTENDANCE_SESSION_OVERLAP");

    // NO ILLEGAL STATE: exactly ONE session, pairwise disjoint.
    const sessions = await sessionRows(f.a1, "2026-11-02");
    expect(sessions).toHaveLength(1);
    expect(Date.parse(sessions[0]!.checkIn)).toBe(Date.parse("2026-11-02T09:00:00+03:00"));
    expect(await overlapCount(f.a1, "2026-11-02")).toBe(0);
  });

  it("(2) IMPORT COMMIT — a manual capture racing the import's floor read: the capture blocks on the file's day lock, then refuses typed; the overlap never lands", async () => {
    const f = spec.fixture!;
    const content = [
      "User ID,Timestamp,Direction,Device",
      `CC-A2,2026-11-03 08:00:00,in,${unique("ZK-CC")}`,
      `CC-A2,2026-11-03 12:00:00,out,${unique("ZK-CC")}`,
    ].join("\n");
    const real = importStore.insertImportedRecord;
    const spy = vi.spyOn(importStore, "insertImportedRecord");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        attendanceSvc.capture({
          employeeId: f.a2,
          workDate: "2026-11-03",
          checkIn: "2026-11-03T10:00:00+03:00",
          checkOut: "2026-11-03T14:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    );
    let winner: Awaited<ReturnType<typeof importSvc.commit>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        importSvc.commit({
          content,
          fileName: `${unique("cc-import-duel")}.csv`,
          mapping: DEFAULT_IMPORT_MAPPING,
          deviceRef: null,
          note: null,
          actorId: H_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.importedCount).toBe(1);
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced: the capture slipped past the import's floor read — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("ATTENDANCE_SESSION_OVERLAP");

    // NO ILLEGAL STATE: exactly the imported session, disjoint.
    const sessions = await sessionRows(f.a2, "2026-11-03");
    expect(sessions).toHaveLength(1);
    expect(await overlapCount(f.a2, "2026-11-03")).toBe(0);
  });

  it("(3) THE CORRECTION (anomaly-resolve IMPORT) — a manual capture racing the corrected session's floor read: blocked, then typed; the correction lands exactly once", async () => {
    const f = spec.fixture!;
    // A committed file whose only lines name an UNKNOWN employee — a
    // PENDING anomaly the reviewer resolves with a corrected session.
    const nobody = unique("CC-NOBODY");
    const content = [
      "User ID,Timestamp,Direction,Device",
      `${nobody},2026-11-04 09:00:00,in,ZK-CC`,
      `${nobody},2026-11-04 12:00:00,out,ZK-CC`,
    ].join("\n");
    const batch = await withTenant(TENANT_CC, () =>
      importSvc.commit({
        content,
        fileName: `${unique("cc-anomaly-duel")}.csv`,
        mapping: DEFAULT_IMPORT_MAPPING,
        deviceRef: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const pending = await withTenant(TENANT_CC, () =>
      importSvc.anomalies({ batchId: batch.id, status: "PENDING" }),
    );
    expect(pending.rows).toHaveLength(2);

    const real = importStore.insertImportedRecord;
    const spy = vi.spyOn(importStore, "insertImportedRecord");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        attendanceSvc.capture({
          employeeId: f.a3,
          workDate: "2026-11-04",
          checkIn: "2026-11-04T10:00:00+03:00",
          checkOut: "2026-11-04T14:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    );
    let resolved: Awaited<ReturnType<typeof importSvc.resolve>> | undefined;
    try {
      resolved = await withTenant(TENANT_CC, () =>
        importSvc.resolve({
          anomalyId: pending.rows[0]!.id,
          action: "IMPORT",
          employeeId: f.a3,
          checkIn: "2026-11-04T09:00:00+03:00",
          checkOut: "2026-11-04T12:00:00+03:00",
          note: "the corrected session (T-20)",
          actorId: H_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(resolved!.status).toBe("RESOLVED");
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced: the capture slipped past the correction's floor read — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("ATTENDANCE_SESSION_OVERLAP");

    // NO ILLEGAL STATE: exactly the corrected session (source IMPORT),
    // disjoint; the capture never landed.
    const sessions = await sessionRows(f.a3, "2026-11-04");
    expect(sessions).toHaveLength(1);
    expect(await overlapCount(f.a3, "2026-11-04")).toBe(0);
  });

  it("(4) CHECKOUT — a sibling capture racing the one-shot fill: blocked, then typed; the session never closes INTO an overlap", async () => {
    const f = spec.fixture!;
    // An OPEN session [08:00 → ∞) the checkout will close at 13:00.
    const open = await withTenant(TENANT_CC, () =>
      attendanceSvc.capture({
        employeeId: f.a1,
        workDate: "2026-11-06",
        checkIn: "2026-11-06T08:00:00+03:00",
        checkOut: null,
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const real = attendanceStore.fillAttendanceCheckOut;
    const spy = vi.spyOn(attendanceStore, "fillAttendanceCheckOut");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        attendanceSvc.capture({
          employeeId: f.a1,
          workDate: "2026-11-06",
          checkIn: "2026-11-06T12:00:00+03:00",
          checkOut: "2026-11-06T18:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    );
    let winner: Awaited<ReturnType<typeof attendanceSvc.checkout>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        attendanceSvc.checkout(open.id, "2026-11-06T13:00:00+03:00", H_ACTOR),
      );
    } finally {
      await arm.finish();
    }
    expect(Date.parse(winner!.checkOut!)).toBe(Date.parse("2026-11-06T13:00:00+03:00"));
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced: the sibling capture slipped past the checkout's read — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("ATTENDANCE_SESSION_OVERLAP");

    // NO ILLEGAL STATE: the day holds ONLY the closed [08:00→13:00)
    // session — the sibling [12:00→18:00) never landed (pre-fix the
    // day ended with two overlapping sessions).
    const sessions = await sessionRows(f.a1, "2026-11-06");
    expect(sessions).toHaveLength(1);
    expect(Date.parse(sessions[0]!.checkOut!)).toBe(Date.parse("2026-11-06T13:00:00+03:00"));
    expect(await overlapCount(f.a1, "2026-11-06")).toBe(0);
  });

  it("(5) THE DERIVATION — two concurrent runs over one rostered punchless day: the loser blocks, re-reads the winner's marker, and synthesizes NOTHING — exactly one ABSENT marker", async () => {
    const f = spec.fixture!;
    const real = attendanceStore.insertDerivedAbsenceRow;
    const spy = vi.spyOn(attendanceStore, "insertDerivedAbsenceRow");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        attendanceSvc.deriveDays({
          from: "2026-11-05",
          to: "2026-11-05",
          employeeIds: [f.a4],
          actorId: H_ACTOR,
        }),
      ),
    );
    let winner: Awaited<ReturnType<typeof attendanceSvc.deriveDays>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        attendanceSvc.deriveDays({
          from: "2026-11-05",
          to: "2026-11-05",
          employeeIds: [f.a4],
          actorId: H_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.absentSynthesized).toBe(1);
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced (the owner's duplicate-marker proof): the loser settled inside the window — ${loserCode(arm)}`,
    ).toBe("blocked");
    const loserRun = arm.loser.value as { absentSynthesized: number };
    expect(loserRun.absentSynthesized).toBe(0);

    // NO ILLEGAL STATE: exactly ONE DERIVED_ABSENT marker for the day.
    expect(await absentMarkerCount(f.a4, "2026-11-05")).toBe(1);
  });

  it("(6) THE CAPTURE SMOKE — two overlapping captures in flight together: no deadlock, exactly ONE accepted, the loser typed, the day disjoint", async () => {
    const f = spec.fixture!;
    const settled = await Promise.allSettled([
      withTenant(TENANT_CC, () =>
        attendanceSvc.capture({
          employeeId: f.a5,
          workDate: "2026-11-07",
          checkIn: "2026-11-07T09:00:00+03:00",
          checkOut: "2026-11-07T12:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
      withTenant(TENANT_CC, () =>
        attendanceSvc.capture({
          employeeId: f.a5,
          workDate: "2026-11-07",
          checkIn: "2026-11-07T10:00:00+03:00",
          checkOut: "2026-11-07T13:00:00+03:00",
          source: "MANUAL",
          deviceRef: null,
          geoLat: null,
          geoLng: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ]);
    const fulfilled = settled.filter((outcome) => outcome.status === "fulfilled");
    const rejected = settled.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { status: "rejected"; reason: { code: string } }).reason.code).toBe(
      "ATTENDANCE_SESSION_OVERLAP",
    );
    expect(await sessionRows(f.a5, "2026-11-07")).toHaveLength(1);
    expect(await overlapCount(f.a5, "2026-11-07")).toBe(0);
  });
});

describe("PHASE-045 T-20 — the owner's concurrency review round: the leave span law", () => {
  it("(7) REQUEST CREATION — two overlapping requests at once: the loser blocks on the span lock, then refuses typed; exactly one request exists", async () => {
    const f = spec.fixture!;
    const real = leaveStore.insertLeaveRequest;
    const spy = vi.spyOn(leaveStore, "insertLeaveRequest");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        leaveSvc.createRequest({
          employeeId: f.b2,
          leaveTypeId: f.leaveTypeId,
          startDate: "2026-11-05",
          endDate: "2026-11-10",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    );
    let winner: Awaited<ReturnType<typeof leaveSvc.createRequest>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        leaveSvc.createRequest({
          employeeId: f.b2,
          leaveTypeId: f.leaveTypeId,
          startDate: "2026-11-03",
          endDate: "2026-11-07",
          note: null,
          actorId: H_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.status).toBe("PENDING");
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced (the owner's overlapping-requests proof): the loser settled inside the window — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("LEAVE_SPAN_OVERLAP");

    // NO ILLEGAL STATE: exactly one request (PENDING), no overlap pair.
    const requests = await leaveRequestStates(f.b2);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe("PENDING");
  });

  it("(8) THE APPROVE-BOUNDARY OVERLAP — a request seeded behind the create-boundary check is refused at APPROVAL (the law's second door)", async () => {
    const f = spec.fixture!;
    // The pending request under test…
    const pending = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b2,
        leaveTypeId: f.leaveTypeId,
        startDate: "2026-11-20",
        endDate: "2026-11-24",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    // …and an APPROVED span it overlaps, seeded directly (the state
    // the create boundary refuses to produce — the approve door must
    // still refuse it, the defense-in-depth the owner asked for).
    await q(
      `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, decided_by, decided_at, created_by)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3::uuid, '2026-11-22', '2026-11-28', 7.00, 'APPROVED', $4, now(), $4)`,
      [TENANT_CC, f.b2, f.leaveTypeId, H_ACTOR],
    );
    await expect(
      withTenant(TENANT_CC, () => leaveSvc.approve(pending.id, null, H_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAVE_SPAN_OVERLAP" });

    // NO ILLEGAL STATE: the pending request stayed PENDING (the
    // refusal rolled the whole UoW back), no balance was charged.
    const requests = await leaveRequestStates(f.b2);
    expect(requests.find((row) => row.id === pending.id)!.status).toBe("PENDING");
    const cells = await balanceCells(f.b2, f.leaveTypeId);
    expect(cells.find((row) => row.year === 2026)!.usedDays).toBe("0.00");
    await expectInv031(f.b2);
  });
});

describe("PHASE-045 T-20 — the owner's concurrency review round: the balance cell (used_days is the source of truth)", () => {
  it("(9) DOUBLE APPROVE — two 15-day approvals on a 20-day cell: the loser blocks on the cell lock, re-reads used=15.00, refuses typed; used lands at 15.00 never 30.00", async () => {
    const f = spec.fixture!;
    const requestA = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b2,
        leaveTypeId: f.leaveTypeId,
        startDate: "2026-12-01",
        endDate: "2026-12-15",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const requestB = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b2,
        leaveTypeId: f.leaveTypeId,
        startDate: "2026-12-18",
        endDate: "2027-01-01",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const real = leaveStore.incrementUsedDays;
    const spy = vi.spyOn(leaveStore, "incrementUsedDays");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () => leaveSvc.approve(requestB.id, null, H_ACTOR)),
    );
    let winner: Awaited<ReturnType<typeof leaveSvc.approve>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () => leaveSvc.approve(requestA.id, null, H_ACTOR));
    } finally {
      await arm.finish();
    }
    expect(winner!.status).toBe("APPROVED");
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced (the owner's used=30-on-20 proof): the second approval settled inside the window — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("LEAVE_BALANCE_INSUFFICIENT");

    // NO ILLEGAL STATE: used=15.00 (never 30.00), A APPROVED, B still
    // PENDING (the refusal rolled its whole UoW back), INV-031 holds.
    const cells = await balanceCells(f.b2, f.leaveTypeId);
    expect(cells.find((row) => row.year === 2026)!.usedDays).toBe("15.00");
    const requests = await leaveRequestStates(f.b2);
    expect(requests.find((row) => row.id === requestA.id)!.status).toBe("APPROVED");
    expect(requests.find((row) => row.id === requestB.id)!.status).toBe("PENDING");
    await expectInv031(f.b2);
  });

  it("(10) ENCASH THEN APPROVE (the owner's integrated scenario) — a committed 10.00-day cashout rides used_days; a 15.00-day approval on the 20.00 cell is the typed refusal, never used=25.00", async () => {
    const f = spec.fixture!;
    // The integrated cashout-then-approval: the REAL G-51 settlement
    // commits first (used 0.00 → 10.00)…
    const encashed = await withTenant(TENANT_CC, () =>
      postingSvc.encash({
        employeeId: f.b3,
        leaveTypeId: f.leaveTypeId,
        days: "10.00",
        cashAccountId: f.bankAccountId,
        entryDate: "2026-11-10",
        actorId: H_ACTOR,
      }),
    );
    expect(encashed.remainingDays).toBe("10.00");
    // …then the approval must answer on the CELL (used_days is the
    // source of truth — the old side-sum over approved requests read
    // 0.00 here and let 10.00 + 15.00 land on a 20.00 entitlement).
    const request = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b3,
        leaveTypeId: f.leaveTypeId,
        startDate: "2026-12-01",
        endDate: "2026-12-15",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_CC, () => leaveSvc.approve(request.id, null, H_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAVE_BALANCE_INSUFFICIENT" });

    // NO ILLEGAL STATE: used stays 10.00, the request PENDING, INV-031.
    const cells = await balanceCells(f.b3, f.leaveTypeId);
    expect(cells.find((row) => row.year === 2026)!.usedDays).toBe("10.00");
    const requests = await leaveRequestStates(f.b3);
    expect(requests.find((row) => row.id === request.id)!.status).toBe("PENDING");
    await expectInv031(f.b3);
  });

  it("(11) ENCASH VS APPROVE, CONCURRENT — a real G-51 cashout racing a real approval on one cell: the approval blocks on the cell lock, re-reads used=10.00, refuses typed", async () => {
    const f = spec.fixture!;
    const request = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b4,
        leaveTypeId: f.leaveTypeId,
        startDate: "2026-12-01",
        endDate: "2026-12-15",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const real = leaveStore.incrementUsedDays;
    const spy = vi.spyOn(leaveStore, "incrementUsedDays");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () => leaveSvc.approve(request.id, null, H_ACTOR)),
    );
    let winner: Awaited<ReturnType<typeof postingSvc.encash>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        postingSvc.encash({
          employeeId: f.b4,
          leaveTypeId: f.leaveTypeId,
          days: "10.00",
          cashAccountId: f.bankAccountId,
          entryDate: "2026-11-10",
          actorId: H_ACTOR,
        }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.remainingDays).toBe("10.00");
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced: the approval settled inside the window on a stale used_days — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("LEAVE_BALANCE_INSUFFICIENT");

    // NO ILLEGAL STATE: used=10.00 (the cashout), the request PENDING.
    const cells = await balanceCells(f.b4, f.leaveTypeId);
    expect(cells.find((row) => row.year === 2026)!.usedDays).toBe("10.00");
    const requests = await leaveRequestStates(f.b4);
    expect(requests.find((row) => row.id === request.id)!.status).toBe("PENDING");
    await expectInv031(f.b4);
  });

  it("(12) ACCRUAL RECOMPUTE — a lowering run racing an approval: the run blocks on the cell lock, re-reads used=15.00, and is the typed INV-031 preservation refusal; the entitlement is never lowered under a committed charge", async () => {
    const f = spec.fixture!;
    // A dedicated type: 20.00/year for 2026 (the lowering run targets 10.00).
    const type = await withTenant(TENANT_CC, () =>
      leaveSvc.createType({
        code: unique("LV-CC-ACCR"),
        name: "Accrual duel type (T-20)",
        nameAr: null,
        paid: true,
        accrualDaysPerYear: "20.00",
        monthlyGrant: false,
        prorateJoiners: false,
        carryOverCapDays: "0.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_CC, () =>
      leaveSvc.runAccrual({ leaveTypeId: type.id, year: 2026, actorId: H_ACTOR }),
    );
    const request = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b5,
        leaveTypeId: type.id,
        startDate: "2026-12-01",
        endDate: "2026-12-15",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    // Lower the accrual to 10.00 — the recompute's target entitlement.
    await withTenant(TENANT_CC, () =>
      leaveSvc.updateType(type.id, { accrualDaysPerYear: "10.00" }, H_ACTOR),
    );

    const real = leaveStore.incrementUsedDays;
    const spy = vi.spyOn(leaveStore, "incrementUsedDays");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        leaveSvc.runAccrual({ leaveTypeId: type.id, year: 2026, actorId: H_ACTOR }),
      ),
    );
    let winner: Awaited<ReturnType<typeof leaveSvc.approve>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () => leaveSvc.approve(request.id, null, H_ACTOR));
    } finally {
      await arm.finish();
    }
    expect(winner!.status).toBe("APPROVED");
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced: the accrual run settled inside the window on a stale used_days — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("LEAVE_ACCRUAL_INVALID");

    // NO ILLEGAL STATE: the entitlement was never lowered under the
    // committed charge — used=15.00 ≤ 20.00, INV-031 holds.
    const cells = await balanceCells(f.b5, type.id);
    expect(cells.find((row) => row.year === 2026)!.entitlementDays).toBe("20.00");
    expect(cells.find((row) => row.year === 2026)!.usedDays).toBe("15.00");
    await expectInv031(f.b5);
  });

  it("(13) CARRY-OVER ROLLOVER — a re-run that would lower a toYear cell's carried under its consumed opening carry: blocked, re-read under the lock, the typed preservation refusal; carried stays 10.00", async () => {
    const f = spec.fixture!;
    // A dedicated type: 20.00/year, carry cap 10.00.
    const type = await withTenant(TENANT_CC, () =>
      leaveSvc.createType({
        code: unique("LV-CC-ROLL"),
        name: "Rollover duel type (T-20)",
        nameAr: null,
        paid: true,
        accrualDaysPerYear: "20.00",
        monthlyGrant: false,
        prorateJoiners: false,
        carryOverCapDays: "10.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    // 2026: entitle 20.00, consume 10.00 (remaining 10.00) → the
    // first rollover carries 10.00 into 2027.
    await withTenant(TENANT_CC, () =>
      leaveSvc.runAccrual({ leaveTypeId: type.id, year: 2026, actorId: H_ACTOR }),
    );
    const first2026 = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b6,
        leaveTypeId: type.id,
        startDate: "2026-11-03",
        endDate: "2026-11-12",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_CC, () => leaveSvc.approve(first2026.id, null, H_ACTOR));
    await withTenant(TENANT_CC, () =>
      leaveSvc.rollover({ leaveTypeId: type.id, fromYear: 2026, toYear: 2027, actorId: H_ACTOR }),
    );
    // 2027: entitle 10.00 (the lowered accrual), consume 14.00 of the
    // 20.00 opening (ent 10 + carried 10)…
    await withTenant(TENANT_CC, () =>
      leaveSvc.updateType(type.id, { accrualDaysPerYear: "10.00" }, H_ACTOR),
    );
    await withTenant(TENANT_CC, () =>
      leaveSvc.runAccrual({ leaveTypeId: type.id, year: 2027, actorId: H_ACTOR }),
    );
    const in2027 = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b6,
        leaveTypeId: type.id,
        startDate: "2027-01-04",
        endDate: "2027-01-17",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_CC, () => leaveSvc.approve(in2027.id, null, H_ACTOR));
    // …then drain the 2026 remaining to 2.00 — the re-run rollover
    // would carry 2.00, and 14.00 > 10.00 + 2.00 breaks INV-031.
    const second2026 = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b6,
        leaveTypeId: type.id,
        startDate: "2026-11-15",
        endDate: "2026-11-22",
        note: null,
        actorId: H_ACTOR,
      }),
    );

    const real = leaveStore.incrementUsedDays;
    const spy = vi.spyOn(leaveStore, "incrementUsedDays");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        leaveSvc.rollover({ leaveTypeId: type.id, fromYear: 2026, toYear: 2027, actorId: H_ACTOR }),
      ),
    );
    let winner: Awaited<ReturnType<typeof leaveSvc.approve>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () => leaveSvc.approve(second2026.id, null, H_ACTOR));
    } finally {
      await arm.finish();
    }
    expect(winner!.status).toBe("APPROVED");
    expect(
      arm.observation.value!.shape,
      `the pre-fix shape reproduced: the rollover settled inside the window on a stale remaining — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("LEAVE_ACCRUAL_INVALID");

    // NO ILLEGAL STATE: the 2027 carry was never lowered under its
    // consumed opening — carried stays 10.00, INV-031 holds everywhere.
    const cells = await balanceCells(f.b6, type.id);
    const cell2026 = cells.find((row) => row.year === 2026)!;
    const cell2027 = cells.find((row) => row.year === 2027)!;
    expect(cell2026.usedDays).toBe("18.00");
    expect(cell2027.carriedForwardDays).toBe("10.00");
    expect(cell2027.usedDays).toBe("14.00");
    await expectInv031(f.b6);
  });

  it("(14) THE BALANCE SMOKE — approval + approval + encashment in flight together on one 20.00 cell: no deadlock, exactly ONE wins, the losers typed, INV-031 holds", async () => {
    const f = spec.fixture!;
    const requestA = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b7,
        leaveTypeId: f.leaveTypeId,
        startDate: "2026-12-01",
        endDate: "2026-12-15",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const requestB = await withTenant(TENANT_CC, () =>
      leaveSvc.createRequest({
        employeeId: f.b7,
        leaveTypeId: f.leaveTypeId,
        startDate: "2026-12-18",
        endDate: "2027-01-01",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const settled = await Promise.allSettled([
      withTenant(TENANT_CC, () => leaveSvc.approve(requestA.id, null, H_ACTOR)),
      withTenant(TENANT_CC, () => leaveSvc.approve(requestB.id, null, H_ACTOR)),
      withTenant(TENANT_CC, () =>
        postingSvc.encash({
          employeeId: f.b7,
          leaveTypeId: f.leaveTypeId,
          days: "10.00",
          cashAccountId: f.bankAccountId,
          entryDate: "2026-11-10",
          actorId: H_ACTOR,
        }),
      ),
    ]);
    const fulfilled = settled.filter((outcome) => outcome.status === "fulfilled");
    const rejected = settled.filter((outcome) => outcome.status === "rejected");
    // Any two of {15, 15, 10} exceed the 20.00 cell → exactly one wins.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    const codes = rejected.map(
      (outcome) => (outcome as { status: "rejected"; reason: { code: string } }).reason.code,
    );
    // The losers refuse in their OWN typed vocabulary: an approval
    // loser renders LEAVE_BALANCE_INSUFFICIENT, an encashment loser
    // renders LEAVE_ENCASHMENT_INSUFFICIENT (the same INV-031 cap,
    // each door's own code).
    for (const code of codes) {
      expect(["LEAVE_BALANCE_INSUFFICIENT", "LEAVE_ENCASHMENT_INSUFFICIENT"]).toContain(code);
    }

    // NO ILLEGAL STATE: used equals the winner's charge (10.00 or
    // 15.00), at most one request APPROVED, INV-031 holds. When an
    // approval won, the OTHER approval refuses on the balance and the
    // encashment refuses on its own floor; when the encashment won,
    // both approvals refuse on the balance.
    const cells = await balanceCells(f.b7, f.leaveTypeId);
    const used = cells.find((row) => row.year === 2026)!.usedDays;
    expect(["10.00", "15.00"]).toContain(used);
    if (used === "10.00") {
      expect(codes).toEqual(["LEAVE_BALANCE_INSUFFICIENT", "LEAVE_BALANCE_INSUFFICIENT"]);
    } else {
      expect(codes.sort()).toEqual(["LEAVE_BALANCE_INSUFFICIENT", "LEAVE_ENCASHMENT_INSUFFICIENT"]);
    }
    const requests = await leaveRequestStates(f.b7);
    const approved = requests.filter((row) => row.status === "APPROVED");
    expect(approved).toHaveLength(used === "15.00" ? 1 : 0);
    await expectInv031(f.b7);
  });
});

describe("PHASE-045 T-20 — the owner's concurrency review round: the employee ↔ user bridge", () => {
  it("(15) TWO USERS, ONE EMPLOYEE — the second concurrent link waits on the row lock, matches ZERO rows, and renders the typed refusal; the first link survives, exactly ONE link event, NO unlink event", async () => {
    const f = spec.fixture!;
    const real = bridgeStore.linkUser;
    const spy = vi.spyOn(bridgeStore, "linkUser");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        bridgeSvc.link({ employeeId: f.c1, userId: f.u2, actorId: H_ACTOR }),
      ),
    );
    let winner: Awaited<ReturnType<typeof bridgeSvc.link>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        bridgeSvc.link({ employeeId: f.c1, userId: f.u1, actorId: H_ACTOR }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.userId).toBe(f.u1);
    // The bridge's gate is the conditional write's OWN row lock — the
    // loser blocks on it (both pre- and post-fix); what the fix changes
    // is the OUTCOME: zero rows matched → the typed refusal, never the
    // silent replacement the owner's proof found (pre-fix BOTH
    // fulfilled, user_id ended as the second user's, two link events).
    expect(
      arm.observation.value!.shape,
      `the harness window is not the raced one — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("BRIDGE_ALREADY_LINKED");

    // NO ILLEGAL STATE: the FIRST link survives; exactly ONE link
    // event, ZERO unlink events.
    const rows = await q<{ userId: string | null }>(
      `SELECT user_id::text AS "userId" FROM employees WHERE tenant_id = $1 AND id = $2::uuid`,
      [TENANT_CC, f.c1],
    );
    expect(rows[0]!.userId).toBe(f.u1);
    expect(await auditCount(f.c1, "hr.employee_user_linked")).toBe(1);
    expect(await auditCount(f.c1, "hr.employee_user_unlinked")).toBe(0);
  });

  it("(16) ONE USER, TWO EMPLOYEES — the second concurrent link waits on the 0085 unique floor and renders the SAME typed refusal; the user maps to exactly ONE employee", async () => {
    const f = spec.fixture!;
    const real = bridgeStore.linkUser;
    const spy = vi.spyOn(bridgeStore, "linkUser");
    const arm = armDuelSpy(spy, real, () =>
      withTenant(TENANT_CC, () =>
        bridgeSvc.link({ employeeId: f.c3, userId: f.u3, actorId: H_ACTOR }),
      ),
    );
    let winner: Awaited<ReturnType<typeof bridgeSvc.link>> | undefined;
    try {
      winner = await withTenant(TENANT_CC, () =>
        bridgeSvc.link({ employeeId: f.c2, userId: f.u3, actorId: H_ACTOR }),
      );
    } finally {
      await arm.finish();
    }
    expect(winner!.userId).toBe(f.u3);
    expect(
      arm.observation.value!.shape,
      `the harness window is not the raced one — ${loserCode(arm)}`,
    ).toBe("blocked");
    expect(loserCode(arm)).toBe("BRIDGE_ALREADY_LINKED");

    // NO ILLEGAL STATE: the user maps to exactly ONE employee (the
    // first), the second employee carries no link.
    const linked = await q<{ code: string }>(
      `SELECT e.code FROM employees e WHERE e.tenant_id = $1 AND e.user_id = $2::uuid`,
      [TENANT_CC, f.u3],
    );
    expect(linked).toHaveLength(1);
    expect(linked[0]!.code).toBe("CC-C2");
    const rows = await q<{ userId: string | null }>(
      `SELECT user_id::text AS "userId" FROM employees WHERE tenant_id = $1 AND id = $2::uuid`,
      [TENANT_CC, f.c3],
    );
    expect(rows[0]!.userId).toBeNull();
  });
});
