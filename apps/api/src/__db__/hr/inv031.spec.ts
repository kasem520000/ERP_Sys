import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import { AttendanceImportService } from "../../modules/hr/application/attendance-import-service";
import { DEFAULT_IMPORT_MAPPING } from "../../modules/hr/application/attendance-import-service";
import { FeedService } from "../../modules/hr/application/feed-service";
import { LeaveService } from "../../modules/hr/application/leave-service";
import { OvertimeService } from "../../modules/hr/application/overtime-service";
import { HrQueriesService } from "../../modules/reporting/registry/hr/hr-queries";
import { H_ACTOR, setupHrFixture } from "./fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-045 T-17 — THE INV-031 INVARIANT SUITE (the phase §6 criterion 2
 * property layer) + the BR-082…083 guards + the feed-totals tie:
 *
 * - P1 (non-overlap, BOTH paths): the capture law is ORDER-INDEPENDENT —
 *   six seeded permutations of one overlapping candidate set on one
 *   employee-day all leave a pairwise-disjoint accepted set, every
 *   refusal typed SESSION_OVERLAP; the IMPORT path shares the law (a
 *   session overlapping a manually-committed session quarantines at
 *   commit, never lands);
 * - P2 (balance caps): a generated 12-configuration matrix (hire month ×
 *   accrual × carry-over cap × grant policy × proration) through the
 *   REAL engine — accrual → spend-to-the-floor → the +1-day typed
 *   refusal → the year-boundary rollover — INV-031 asserted after every
 *   step (used ≤ entitlement + carried, remaining ≥ 0, both years);
 * - BR-083's guards (the leave charge law): the year-crossing span
 *   charges the START year's cell ONLY (the 2027 cell stays untouched),
 *   the next year's accrual starts clean;
 * - P3 (overtime non-negativity + the day cap): the cap bounds the
 *   SANCTIONABLE day-total (PENDING + APPROVED — REJECTED frees space),
 *   the typed refusal before any write, and every fold stays
 *   non-negative with the exception flag exactly (PENDING ∧ required);
 * - P4 (feed totals — one number, one truth): the variable feed, the
 *   T-16 report query surface, and an independent per-entry SQL
 *   enumeration agree EXACTLY on the BR-084 feeding folds;
 * - BR-082's consolidated window guards: the second checkout refusal,
 *   the derived-marker refusal, and the corrections-as-new-rows law.
 *
 * Isolation: the spec's own employees (EMP-V1/V2 + the per-config B
 * series — upserted by code, the fixtures precedent); the append-only
 * attendance table is reset for TENANT_H (the attendance.spec
 * precedent — capture is INSERT-only); the fiscal substrate reuses the
 * feed spec's fixed ids (ON CONFLICT DO NOTHING — idempotent from
 * either run order).
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const FY_H = "7a7a7a7a-aaaa-4000-8000-0000000000f1";
const PERIOD_FEED = "7a7a7a7a-aaaa-4000-8000-0000000000f2"; // 2026-03-01…31

const audit = new AuditService(new DrizzleAuditStore());
const attendanceSvc = new AttendanceService(audit);
const importSvc = new AttendanceImportService(audit, attendanceSvc);
const leaveSvc = new LeaveService(audit);
const overtimeSvc = new OvertimeService(audit);
const feedSvc = new FeedService(audit);
const hrQueries = new HrQueriesService();

let seq = 0;
function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

/** A deterministic PRNG (mulberry32) — the permutations are seeded,
 * reviewable, and re-runnable identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = (random() * (i + 1)) | 0;
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Exact hundredths on decimal strings (ADR-0009 — never float). */
function toHundredths(value: string): bigint {
  const neg = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const minor = BigInt(int) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0"));
  return neg ? -minor : minor;
}

interface InvFixture {
  employeeV1Id: string;
  employeeV2Id: string;
  employeeX1Id: string;
  requiredRuleId: string;
  postHocRuleId: string;
}

const spec: { fixture?: InvFixture } = {};

beforeAll(async () => {
  await setupHrFixture();

  // The append-only reset (the attendance.spec precedent) + this
  // spec's OWN world reset: the import batches by fileName prefix (the
  // fingerprint floor), then the spec's employees by code (the FKs
  // CASCADE their attendance/leave/overtime rows) — a deterministic
  // re-run, never a residue.
  const su: Client = await superuserClient();
  await su.query(
    `DELETE FROM attendance_import_batches WHERE tenant_id = $1 AND file_name LIKE 'inv031-%'`,
    [TENANT_H],
  );
  await su.query(`DELETE FROM attendance_records WHERE tenant_id = $1`, [TENANT_H]);
  await su.query(
    `DELETE FROM employees WHERE tenant_id = $1 AND code IN
       ('EMP-V1','EMP-V2','EMP-X1','EMP-M0','EMP-M1','EMP-M2','EMP-M3','EMP-M4','EMP-M5',
        'EMP-M6','EMP-M7','EMP-M8','EMP-M9','EMP-M10','EMP-M11')`,
    [TENANT_H],
  );
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES
       ($1, $2, 'FY2026-H (feed spec)', '2026-01-01', '2026-12-31')
     ON CONFLICT (id) DO NOTHING`,
    [FY_H, TENANT_H],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status) VALUES
       ($1, $2, $3, 'FY2026-H-03 (feed spec)', 'REGULAR', '2026-03-01', '2026-03-31', 'OPEN')
     ON CONFLICT (id) DO NOTHING`,
    [PERIOD_FEED, TENANT_H, FY_H],
  );
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-V1', 'Victor Al-Overlap', 'فيكتور التداخل', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-V2', 'Vera Al-Window', 'فيرا النافذة', '2026-01-01', 'FULL_TIME', 9000, $2),
       (gen_random_uuid(), $1, 'EMP-X1', 'Xavier Al-Crossing', 'كسافيا العابر', '2026-01-01', 'FULL_TIME', 8500, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  await su.end();
  const byCode = new Map(employeeRows.rows.map((row) => [row.code, row.id]));

  const requiredRule = await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: uniqueCode("OT-INV-REQ"),
      name: "INV suite required 1.5x",
      nameAr: "إضافي بموافقة مسبقة (مواصفة INV)",
      tier: "WEEKDAY",
      multiplier: "1.50",
      preApprovalRequired: true,
      maxHoursPerDay: "4.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  const postHocRule = await withTenant(TENANT_H, () =>
    overtimeSvc.createRule({
      code: uniqueCode("OT-INV-POST"),
      name: "INV suite post-hoc 2x",
      nameAr: "إضافي لاحق (مواصفة INV)",
      tier: "WEEKDAY",
      multiplier: "2.00",
      preApprovalRequired: false,
      maxHoursPerDay: "8.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );

  spec.fixture = {
    employeeV1Id: byCode.get("EMP-V1")!,
    employeeV2Id: byCode.get("EMP-V2")!,
    employeeX1Id: byCode.get("EMP-X1")!,
    requiredRuleId: requiredRule.id,
    postHocRuleId: postHocRule.id,
  };
});

describe("PHASE-045 T-17 — the INV-031 invariant suite + the BR-082…083 guards + the feed-totals tie", () => {
  it("(P1a) the non-overlap law is ORDER-INDEPENDENT on the manual path — six seeded permutations, one disjoint accepted set each", async () => {
    const f = spec.fixture!;
    // Ten candidate sessions on one employee-day: [08:00+20i, 10:00+20i]
    // — a chain of overlaps with some disjoint pairs. Every permutation
    // must leave a pairwise-disjoint accepted set.
    const candidates = Array.from({ length: 10 }, (_, i) => {
      const startMinutes = 8 * 60 + i * 20;
      const endMinutes = startMinutes + 120;
      const at = (minutes: number): string =>
        `2026-05-20T${String((minutes / 60) | 0).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+03:00`;
      return { checkIn: at(startMinutes), checkOut: at(endMinutes) };
    });

    for (let permutation = 0; permutation < 6; permutation += 1) {
      const day = `2026-05-2${permutation}`; // 2026-05-20 … 2026-05-25
      const dayOf = (instant: string): string => instant.replace("2026-05-20", day);
      let accepted = 0;
      let refused = 0;
      for (const candidate of shuffled(candidates, 1000 + permutation)) {
        const outcome = await withTenant(TENANT_H, async () => {
          try {
            await attendanceSvc.capture({
              employeeId: f.employeeV1Id,
              workDate: day,
              checkIn: dayOf(candidate.checkIn),
              checkOut: dayOf(candidate.checkOut),
              source: "MANUAL",
              deviceRef: null,
              geoLat: null,
              geoLng: null,
              note: null,
              actorId: H_ACTOR,
            });
            return "accepted" as const;
          } catch (error) {
            expect((error as { code: string }).code).toBe("ATTENDANCE_SESSION_OVERLAP");
            return "refused" as const;
          }
        });
        if (outcome === "accepted") accepted += 1;
        else refused += 1;
      }
      // The day's accepted set is pairwise disjoint (INV-031).
      const register = await withTenant(TENANT_H, () => attendanceSvc.register(day));
      const sessions = register.rows
        .filter((row) => row.employeeCode === "EMP-V1" && row.checkIn !== null)
        .map((row) => ({
          in: Date.parse(row.checkIn!),
          out: Date.parse(row.checkOut ?? `${day}T23:59:59+03:00`),
        }))
        .sort((a, b) => a.in - b.in);
      expect(sessions.length).toBe(accepted);
      expect(refused).toBe(candidates.length - accepted);
      for (let i = 1; i < sessions.length; i += 1) {
        expect(sessions[i]!.in >= sessions[i - 1]!.out).toBe(true);
      }
    }
  });

  it("(P1b) the import path shares the law — a session overlapping a manually-committed session quarantines at commit, never lands", async () => {
    const f = spec.fixture!;
    // A manual session on 2026-05-27 [08:00, 12:00].
    await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeV2Id,
        workDate: "2026-05-27",
        checkIn: "2026-05-27T08:00:00+03:00",
        checkOut: "2026-05-27T12:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    // The import carries an OVERLAPPING session [09:00, 11:00] and a
    // disjoint later one [13:00, 15:00] — the overlap quarantines
    // (SESSION_OVERLAP), the disjoint session imports.
    const content = [
      "User ID,Timestamp,Direction,Device",
      "EMP-V2,2026-05-27 09:00:00,in,ZK-INV",
      "EMP-V2,2026-05-27 11:00:00,out,ZK-INV",
      "EMP-V2,2026-05-27 13:00:00,in,ZK-INV",
      "EMP-V2,2026-05-27 15:00:00,out,ZK-INV",
    ].join("\n");
    const batch = await withTenant(TENANT_H, () =>
      importSvc.commit({
        content,
        fileName: `inv031-overlap-${Date.now()}.csv`,
        mapping: DEFAULT_IMPORT_MAPPING,
        deviceRef: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(batch.importedCount).toBe(1);
    expect(batch.quarantineCount).toBe(1);
    const quarantine = await withTenant(TENANT_H, () =>
      importSvc.anomalies({ batchId: batch.id, status: "PENDING" }),
    );
    expect(quarantine.rows[0]!.reason).toBe("SESSION_OVERLAP");
    // The register still shows exactly TWO sessions: the manual one and
    // the imported disjoint one — the overlap never landed.
    const register = await withTenant(TENANT_H, () => attendanceSvc.register("2026-05-27"));
    const v2Sessions = register.rows.filter(
      (row) => row.employeeCode === "EMP-V2" && row.checkIn !== null,
    );
    expect(v2Sessions).toHaveLength(2);
    const sources = v2Sessions.map((row) => row.source).sort();
    expect(sources).toEqual(["IMPORT", "MANUAL"]);
  });

  it("(P2) the balance-cap property matrix — 12 generated configurations through the real engine, INV-031 after every step", async () => {
    // The seeded configuration sampler: hire month × accrual × cap ×
    // grant policy × proration — a deterministic, reviewable matrix.
    const random = mulberry32(45017);
    const configs = Array.from({ length: 12 }, () => ({
      hireMonth: 1 + ((random() * 12) | 0),
      accrualDays: 10 + ((random() * 21) | 0),
      carryCap: (random() * 13) | 0,
      monthlyGrant: random() < 0.5,
      prorateJoiners: random() < 0.5,
    }));

    for (const [index, config] of configs.entries()) {
      const su: Client = await superuserClient();
      const code = `EMP-M${index}`;
      const employeeRows = await su.query<{ id: string }>(
        `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, 'FULL_TIME', 8000, $6)
         ON CONFLICT (tenant_id, code) DO UPDATE SET hire_date = EXCLUDED.hire_date
         RETURNING id`,
        [
          TENANT_H,
          code,
          `Balance ${index}`,
          `الرصيد ${index}`,
          `2026-${String(config.hireMonth).padStart(2, "0")}-10`,
          H_ACTOR,
        ],
      );
      await su.end();
      const employeeId = employeeRows.rows[0]!.id;

      const type = await withTenant(TENANT_H, () =>
        leaveSvc.createType({
          code: uniqueCode(`LV-INV-${index}`),
          name: `INV matrix type ${index}`,
          nameAr: `نوع المواصفة ${index}`,
          paid: true,
          accrualDaysPerYear: `${config.accrualDays}.00`,
          monthlyGrant: config.monthlyGrant,
          prorateJoiners: config.prorateJoiners,
          carryOverCapDays: `${config.carryCap}.00`,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      );
      await withTenant(TENANT_H, () =>
        leaveSvc.runAccrual({ leaveTypeId: type.id, year: 2026, actorId: H_ACTOR }),
      );
      const cell2026 = (
        await withTenant(TENANT_H, () => leaveSvc.balances({ employeeId, year: 2026 }))
      ).find((row) => row.leaveTypeId === type.id);
      expect(cell2026, `config ${index}: the 2026 cell exists`).toBeDefined();
      const entitlement = toHundredths(cell2026!.entitlementDays);

      // Spend 1-day requests to the floor; INV-031 after every approve.
      let spendDay = 1;
      let spent = 0n;
      while (entitlement - spent >= 100n) {
        const date = `2026-08-${String(spendDay).padStart(2, "0")}`;
        const request = await withTenant(TENANT_H, () =>
          leaveSvc.createRequest({
            employeeId,
            leaveTypeId: type.id,
            startDate: date,
            endDate: date,
            note: null,
            actorId: H_ACTOR,
          }),
        );
        await withTenant(TENANT_H, () => leaveSvc.approve(request.id, null, H_ACTOR));
        spent += 100n;
        spendDay += 1;
        const mid = (
          await withTenant(TENANT_H, () => leaveSvc.balances({ employeeId, year: 2026 }))
        ).find((row) => row.leaveTypeId === type.id)!;
        expect(
          toHundredths(mid.usedDays) <= toHundredths(mid.entitlementDays) + toHundredths(mid.carriedForwardDays),
          `config ${index}: INV-031 mid-lifecycle (used ${mid.usedDays} ≤ ${mid.entitlementDays} + ${mid.carriedForwardDays})`,
        ).toBe(true);
      }

      // The +1-day request is the typed refusal (remaining < 1).
      const oneMore = await withTenant(TENANT_H, () =>
        leaveSvc.createRequest({
          employeeId,
          leaveTypeId: type.id,
          startDate: "2026-09-01",
          endDate: "2026-09-01",
          note: null,
          actorId: H_ACTOR,
        }),
      );
      await expect(
        withTenant(TENANT_H, () => leaveSvc.approve(oneMore.id, null, H_ACTOR)),
      ).rejects.toMatchObject({ code: "LEAVE_BALANCE_INSUFFICIENT" });

      // The year-boundary rollover: carried = min(remaining, cap) — a
      // 0-remaining or 0-cap carry writes NO cell (nothing carried is
      // not a carried row).
      const before = (
        await withTenant(TENANT_H, () => leaveSvc.balances({ employeeId, year: 2026 }))
      ).find((row) => row.leaveTypeId === type.id)!;
      await withTenant(TENANT_H, () =>
        leaveSvc.rollover({ leaveTypeId: type.id, fromYear: 2026, toYear: 2027, actorId: H_ACTOR }),
      );
      const cells2027 = await withTenant(TENANT_H, () =>
        leaveSvc.balances({ employeeId, year: 2027 }),
      );
      const cell2027 = cells2027.find((row) => row.leaveTypeId === type.id);
      const remaining = toHundredths(before.entitlementDays) + toHundredths(before.carriedForwardDays)
        - toHundredths(before.usedDays);
      const cap = BigInt(config.carryCap) * 100n;
      const expectedCarried = remaining < cap ? remaining : cap;
      if (expectedCarried > 0n) {
        expect(cell2027, `config ${index}: the 2027 cell exists`).toBeDefined();
        expect(toHundredths(cell2027!.carriedForwardDays)).toBe(expectedCarried);
        expect(toHundredths(cell2027!.usedDays)).toBe(0n);
        expect(
          toHundredths(cell2027!.usedDays) <= toHundredths(cell2027!.entitlementDays) + expectedCarried,
        ).toBe(true);
      } else {
        expect(cell2027, `config ${index}: nothing carried writes no cell`).toBeUndefined();
      }
      // INV-031 on the from-cell after the rollover.
      expect(toHundredths(before.usedDays) <= entitlement).toBe(true);
    }
  });

  it("(BR-083) the year-crossing span charges the START year's cell ONLY — the next year stays untouched", async () => {
    const f = spec.fixture!;
    const type = await withTenant(TENANT_H, () =>
      leaveSvc.createType({
        code: uniqueCode("LV-INV-X"),
        name: "INV crossing type",
        nameAr: "نوع العابر",
        paid: true,
        accrualDaysPerYear: "24.00",
        monthlyGrant: false,
        prorateJoiners: true,
        carryOverCapDays: "10.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      leaveSvc.runAccrual({ leaveTypeId: type.id, year: 2026, actorId: H_ACTOR }),
    );
    // The 4-day span 2026-12-30 → 2027-01-02 charges the 2026 cell.
    const crossing = await withTenant(TENANT_H, () =>
      leaveSvc.createRequest({
        employeeId: f.employeeX1Id,
        leaveTypeId: type.id,
        startDate: "2026-12-30",
        endDate: "2027-01-02",
        note: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () => leaveSvc.approve(crossing.id, null, H_ACTOR));
    const cell2026 = (
      await withTenant(TENANT_H, () => leaveSvc.balances({ employeeId: f.employeeX1Id, year: 2026 }))
    ).find((row) => row.leaveTypeId === type.id)!;
    expect(cell2026.usedDays).toBe("4.00");
    // The 2027 cell does NOT exist yet — the charge never touches the
    // next year (the documented START-year convention).
    const cells2027 = await withTenant(TENANT_H, () =>
      leaveSvc.balances({ employeeId: f.employeeX1Id, year: 2027 }),
    );
    expect(cells2027.find((row) => row.leaveTypeId === type.id)).toBeUndefined();
    // The next year's accrual starts clean: entitlement 24, used 0,
    // carried 0 (no rollover ran for this type) — INV-031 holds.
    await withTenant(TENANT_H, () =>
      leaveSvc.runAccrual({ leaveTypeId: type.id, year: 2027, actorId: H_ACTOR }),
    );
    const cell2027 = (
      await withTenant(TENANT_H, () => leaveSvc.balances({ employeeId: f.employeeX1Id, year: 2027 }))
    ).find((row) => row.leaveTypeId === type.id)!;
    expect(cell2027.entitlementDays).toBe("24.00");
    expect(cell2027.usedDays).toBe("0.00");
  });

  it("(P3) the overtime day-cap law over decision sequences — REJECTED frees space, the exception flag is exactly (PENDING ∧ required), folds non-negative", async () => {
    const f = spec.fixture!;
    const day = "2026-03-15";
    const entry1 = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId: f.employeeV1Id,
        workDate: day,
        hours: "1.50",
        ruleId: f.requiredRuleId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    const entry2 = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId: f.employeeV1Id,
        workDate: day,
        hours: "1.50",
        ruleId: f.requiredRuleId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    // The sanctionable day-total (PENDING + APPROVED) would reach 4.50 >
    // the 4.00 cap — the typed refusal BEFORE any write.
    await expect(
      withTenant(TENANT_H, () =>
        overtimeSvc.createEntry({
          employeeId: f.employeeV1Id,
          workDate: day,
          hours: "1.50",
          ruleId: f.requiredRuleId,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OVERTIME_ENTRY_INVALID" });
    // REJECT frees the sanctionable total (rejected time never counts).
    await withTenant(TENANT_H, () =>
      overtimeSvc.decide(entry2.id, { approve: false, note: "not sanctioned", actorId: H_ACTOR }),
    );
    const entry3 = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId: f.employeeV1Id,
        workDate: day,
        hours: "1.50",
        ruleId: f.requiredRuleId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(entry3.isException).toBe(true); // PENDING ∧ pre-approval-required
    // APPROVE clears the exception and stamps the approver.
    await withTenant(TENANT_H, () =>
      overtimeSvc.decide(entry1.id, { approve: true, note: null, actorId: H_ACTOR }),
    );
    const decided1 = await withTenant(TENANT_H, () =>
      overtimeSvc.listEntries({ from: day, to: day, employeeIds: [f.employeeV1Id] }),
    );
    const byId = new Map(decided1.rows.map((row) => [row.id, row]));
    expect(byId.get(entry1.id)!.status).toBe("APPROVED");
    expect(byId.get(entry1.id)!.isException).toBe(false);
    expect(byId.get(entry2.id)!.status).toBe("REJECTED");
    expect(byId.get(entry3.id)!.status).toBe("PENDING");
    expect(byId.get(entry3.id)!.isException).toBe(true);
    // A post-hoc PENDING on the no-pre-approval rule feeds (no exception).
    const entry4 = await withTenant(TENANT_H, () =>
      overtimeSvc.createEntry({
        employeeId: f.employeeV1Id,
        workDate: day,
        hours: "2.00",
        ruleId: f.postHocRuleId,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(entry4.isException).toBe(false);
  });

  it("(P4) the feed-totals tie — the variable feed, the T-16 report query, and an independent SQL enumeration agree EXACTLY (one number, one truth)", async () => {
    const f = spec.fixture!;
    // The world of (P3): approved 1.50 + rejected 1.50 + required-PENDING
    // 1.50 (the exception) on 2026-03-15 + post-hoc PENDING 2.00.
    // Feeding = 1.50 + 2.00 = 3.50; multiplied = 2.25 + 4.00 = 6.25.

    // (1) The variable feed (T-10).
    const feed = await withTenant(TENANT_H, () =>
      feedSvc.variableFeed({ periodId: PERIOD_FEED, employeeId: f.employeeV1Id, actorId: H_ACTOR }),
    );
    const feedRow = feed.employees.find((row) => row.employeeId === f.employeeV1Id);
    expect(feedRow).toBeDefined();
    const feedHours = feedRow!.overtime.lines.reduce(
      (sum, line) => sum + toHundredths(line.hours),
      0n,
    );
    const feedMultiplied = feedRow!.overtime.lines.reduce(
      (sum, line) => sum + toHundredths(line.multipliedHours),
      0n,
    );
    expect(feedHours).toBe(350n);
    expect(feedMultiplied).toBe(625n);

    // (2) The T-16 report query surface (an independent code path).
    const reportRows = await withTenant(TENANT_H, () =>
      hrQueries.overtimeSummary({
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
        employeeId: f.employeeV1Id,
      }),
    );
    const reportFeeding = reportRows.reduce(
      (sum, row) => sum + toHundredths(row.approvedHours) + toHundredths(row.pendingFeedingHours),
      0n,
    );
    const reportMultiplied = reportRows.reduce(
      (sum, row) => sum + toHundredths(row.multipliedFeedingHours),
      0n,
    );
    const reportException = reportRows.reduce(
      (sum, row) => sum + toHundredths(row.exceptionHours),
      0n,
    );
    expect(reportFeeding).toBe(feedHours);
    expect(reportMultiplied).toBe(feedMultiplied);
    expect(reportException).toBe(150n);

    // (3) An independent per-entry SQL enumeration (superuser, raw rows
    // summed in JS BigInt hundredths — the third surface).
    const su: Client = await superuserClient();
    const entries = await su.query<{ status: string; hours: string; multiplier: string; pre: boolean }>(
      `SELECT o.status, o.hours::text AS hours, r.multiplier::text AS multiplier, r.pre_approval_required AS pre
       FROM overtime_entries o JOIN overtime_rules r ON r.id = o.rule_id
       WHERE o.tenant_id = $1 AND o.employee_id = $2 AND o.work_date >= '2026-03-01' AND o.work_date <= '2026-03-31'`,
      [TENANT_H, f.employeeV1Id],
    );
    await su.end();
    let enumFeeding = 0n;
    let enumMultiplied = 0n;
    for (const entry of entries.rows) {
      if (entry.status === "APPROVED" || (entry.status === "PENDING" && !entry.pre)) {
        const hours = toHundredths(entry.hours);
        enumFeeding += hours;
        enumMultiplied += (hours * toHundredths(entry.multiplier)) / 100n;
      }
    }
    expect(enumFeeding).toBe(feedHours);
    expect(enumMultiplied).toBe(feedMultiplied);
  });

  it("(BR-082) the consolidated window guards — the second checkout refusal, the derived-marker refusal, the corrections-as-new-rows law", async () => {
    const f = spec.fixture!;
    // An open session on 2026-05-28 closes exactly once.
    const open = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeV2Id,
        workDate: "2026-05-28",
        checkIn: "2026-05-28T08:00:00+03:00",
        checkOut: null,
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_H, () =>
      attendanceSvc.checkout(open.id, "2026-05-28T16:00:00+03:00", H_ACTOR),
    );
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.checkout(open.id, "2026-05-28T17:00:00+03:00", H_ACTOR),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMMUTABLE" });

    // A derived absence marker carries no session — nothing to close.
    const su: Client = await superuserClient();
    const marker = await su.query<{ id: string }>(
      `INSERT INTO attendance_records (id, tenant_id, employee_id, work_date, check_in, check_out, source, derived_status, is_exception)
       VALUES (gen_random_uuid(), $1, $2, '2026-05-29', NULL, NULL, 'MANUAL', 'ABSENT', true)
       RETURNING id`,
      [TENANT_H, f.employeeV2Id],
    );
    await su.end();
    await expect(
      withTenant(TENANT_H, () =>
        attendanceSvc.checkout(marker.rows[0]!.id, "2026-05-29T16:00:00+03:00", H_ACTOR),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMMUTABLE" });

    // CORRECTIONS ARRIVE AS NEW ROWS: a disjoint new session on the
    // closed day is accepted (the append-only law), and the register
    // shows both — the correction never edits the committed punch.
    const correction = await withTenant(TENANT_H, () =>
      attendanceSvc.capture({
        employeeId: f.employeeV2Id,
        workDate: "2026-05-28",
        checkIn: "2026-05-28T17:30:00+03:00",
        checkOut: "2026-05-28T19:00:00+03:00",
        source: "MANUAL",
        deviceRef: null,
        geoLat: null,
        geoLng: null,
        note: "the corrected evening shift",
        actorId: H_ACTOR,
      }),
    );
    expect(correction.checkIn).not.toBeNull();
    const register = await withTenant(TENANT_H, () => attendanceSvc.register("2026-05-28"));
    const v2Sessions = register.rows.filter(
      (row) => row.employeeCode === "EMP-V2" && row.checkIn !== null,
    );
    expect(v2Sessions).toHaveLength(2);
    // The committed first session is untouched (08:00 → 16:00 +03:00).
    const first = v2Sessions.find(
      (row) => Date.parse(row.checkIn!) === Date.parse("2026-05-28T08:00:00+03:00"),
    )!;
    expect(Date.parse(first.checkOut!)).toBe(Date.parse("2026-05-28T16:00:00+03:00"));
  });
});
