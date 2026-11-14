import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { H_ACTOR, TENANT_H, setupHrFixture, shiftSvc, type HrFixture } from "./fixtures";

/**
 * PHASE-045 (T-03) — the shift templates + the roster grid + the weekly
 * rotation pattern generator (HR-04), pinned:
 *
 * - the SHIFT TEMPLATE LAW: the code is unique per tenant, the shape
 *   bounds hold (grace 0–240, breaks 0–480, name 1–120), and the NIGHT
 *   flag ⟺ end < start — the overnight crossing is DECLARED, never
 *   inferred (the 0080 CHECKs surfaced as typed errors);
 * - the ROSTER GRID LAW: ONE row per (employee, work_date) — an edit
 *   REPLACES the cell (never duplicates); inactive shifts are refused;
 * - the ROTATION GENERATOR: a 7-entry Monday…Sunday pattern (a shift id
 *   or null = an explicit rostered day off) applied per employee × date;
 *   MANUAL cells are PRESERVED (the human's explicit edit beats the
 *   pattern); re-running is idempotent;
 * - the tenant boundary: another tenant sees none of tenant H's world.
 */

const spec: { fixture?: HrFixture } = {};
let seq = 0;

function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

beforeAll(async () => {
  spec.fixture = await setupHrFixture();
});

describe("PHASE-045 T-03 — shifts, the roster grid, and the rotation pattern generator", () => {
  it("(a) THE SHIFT TEMPLATE: create/find/list with the bilingual name; the code is unique; deactivation filters the active list and blocks rostering", async () => {
    const code = uniqueCode("DAY-08");
    const day = await withTenant(TENANT_H, () =>
      shiftSvc.create({
        code,
        name: "Morning 08:00–16:00",
        nameAr: "صباحية ٠٨:٠٠–١٦:٠٠",
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
    expect(day.code).toBe(code);
    expect(day.startTime).toBe("08:00:00");
    expect(day.graceMinutes).toBe(15);
    expect(day.active).toBe(true);

    // The code is unique (HR-04).
    await expect(
      withTenant(TENANT_H, () =>
        shiftSvc.create({
          code,
          name: "duplicate",
          nameAr: null,
          startTime: "09:00",
          endTime: "17:00",
          graceMinutes: 0,
          breakMinutes: 0,
          isNight: false,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHIFT_CODE_TAKEN" });

    // The night law: end > start must NOT carry the night flag.
    await expect(
      withTenant(TENANT_H, async () =>
        shiftSvc.create({
          code: uniqueCode("BAD-NIGHT"),
          name: "not actually night",
          nameAr: null,
          startTime: "08:00",
          endTime: "16:00",
          graceMinutes: 0,
          breakMinutes: 0,
          isNight: true,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHIFT_INVALID" });

    // A real night shift: 22:00 → 06:00 crosses midnight — declared.
    const night = await withTenant(TENANT_H, () =>
      shiftSvc.create({
        code: uniqueCode("NIGHT-22"),
        name: "Night 22:00–06:00",
        nameAr: "ليلية ٢٢:٠٠–٠٦:٠٠",
        startTime: "22:00",
        endTime: "06:00",
        graceMinutes: 10,
        breakMinutes: 45,
        isNight: true,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    expect(night.isNight).toBe(true);

    // Grace out of range → typed.
    await expect(
      withTenant(TENANT_H, async () =>
        shiftSvc.create({
          code: uniqueCode("BAD-GRACE"),
          name: "too much grace",
          nameAr: null,
          startTime: "08:00",
          endTime: "16:00",
          graceMinutes: 999,
          breakMinutes: 0,
          isNight: false,
          note: null,
          noteAr: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHIFT_INVALID" });

    // Deactivation: the active list drops it, and rostering it refuses.
    await withTenant(TENANT_H, () => shiftSvc.setActive(night.id, false, H_ACTOR));
    const activeList = await withTenant(TENANT_H, () => shiftSvc.list({ active: true, limit: 500 }));
    expect(activeList.some((row) => row.id === night.id)).toBe(false);
    const allList = await withTenant(TENANT_H, () => shiftSvc.list({ limit: 500 }));
    expect(allList.some((row) => row.id === night.id)).toBe(true);
    await expect(
      withTenant(TENANT_H, () =>
        shiftSvc.setRosterCell({
          employeeId: spec.fixture!.employeeH1Id,
          workDate: "2026-06-01",
          shiftId: night.id,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHIFT_INACTIVE" });
    // Reactivated — rosterable again.
    await withTenant(TENANT_H, () => shiftSvc.setActive(night.id, true, H_ACTOR));
  });

  it("(b) THE ROSTER GRID: one cell per (employee, date) — an edit REPLACES; the grid read joins the shift dims; clear removes the cell", async () => {
    const f = spec.fixture!;
    const early = await withTenant(TENANT_H, () =>
      shiftSvc.create({
        code: uniqueCode("EARLY-06"),
        name: "Early 06:00–14:00",
        nameAr: "مبكرة ٠٦:٠٠–١٤:٠٠",
        startTime: "06:00",
        endTime: "14:00",
        graceMinutes: 5,
        breakMinutes: 20,
        isNight: false,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    const late = await withTenant(TENANT_H, () =>
      shiftSvc.create({
        code: uniqueCode("LATE-14"),
        name: "Late 14:00–22:00",
        nameAr: "متأخرة ١٤:٠٠–٢٢:٠٠",
        startTime: "14:00",
        endTime: "22:00",
        graceMinutes: 5,
        breakMinutes: 20,
        isNight: false,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );

    // Set → read → REPLACE (never duplicate) → read → clear.
    const first = await withTenant(TENANT_H, () =>
      shiftSvc.setRosterCell({
        employeeId: f.employeeH1Id,
        workDate: "2026-06-02",
        shiftId: early.id,
        note: "cover the morning",
        actorId: H_ACTOR,
      }),
    );
    expect(first.shiftId).toBe(early.id);
    expect(first.source).toBe("MANUAL");
    expect(first.shiftCode).toBe(early.code);
    expect(first.employeeCode).toBe("EMP-H1");

    const replaced = await withTenant(TENANT_H, () =>
      shiftSvc.setRosterCell({
        employeeId: f.employeeH1Id,
        workDate: "2026-06-02",
        shiftId: late.id,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(replaced.shiftId).toBe(late.id);

    const grid = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-07", employeeIds: [f.employeeH1Id] }),
    );
    const dayCells = grid.filter((cell) => cell.employeeId === f.employeeH1Id);
    expect(dayCells).toHaveLength(1); // ONE row per cell — the replace law
    expect(dayCells[0]!.shiftId).toBe(late.id);
    expect(dayCells[0]!.startTime).toBe("14:00:00");

    // A foreign employee id → the typed not-found (A7 parity).
    await expect(
      withTenant(TENANT_H, () =>
        shiftSvc.setRosterCell({
          employeeId: "7a7a7a7a-0000-4000-8000-00000000dead",
          workDate: "2026-06-02",
          shiftId: early.id,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });

    // Clear.
    const cleared = await withTenant(TENANT_H, () =>
      shiftSvc.clearRosterCell(f.employeeH1Id, "2026-06-02", H_ACTOR),
    );
    expect(cleared.cleared).toBe(true);
    const afterClear = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-07", employeeIds: [f.employeeH1Id] }),
    );
    expect(afterClear).toHaveLength(0);
  });

  it("(c) THE ROTATION GENERATOR: the Monday…Sunday pattern writes per employee × date (null = an explicit day off), PRESERVES manual cells, and is idempotent", async () => {
    const f = spec.fixture!;
    const day = await withTenant(TENANT_H, () =>
      shiftSvc.create({
        code: uniqueCode("ROT-DAY"),
        name: "Rotation day shift",
        nameAr: "وردية دوام نهاري",
        startTime: "09:00",
        endTime: "17:00",
        graceMinutes: 10,
        breakMinutes: 30,
        isNight: false,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    const evening = await withTenant(TENANT_H, () =>
      shiftSvc.create({
        code: uniqueCode("ROT-EVE"),
        name: "Rotation evening shift",
        nameAr: "وردية دوام مسائي",
        startTime: "13:00",
        endTime: "21:00",
        graceMinutes: 10,
        breakMinutes: 30,
        isNight: false,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );

    // A human's explicit edit INSIDE the range: Wednesday 2026-06-03.
    const manual = await withTenant(TENANT_H, () =>
      shiftSvc.setRosterCell({
        employeeId: f.employeeH2Id,
        workDate: "2026-06-03",
        shiftId: evening.id,
        note: "the supervisor's override",
        actorId: H_ACTOR,
      }),
    );
    expect(manual.source).toBe("MANUAL");

    // 2026-06-01 is a Monday. Pattern: Mon/Tue/Wed = day, Thu/Fri = day,
    // Sat/Sun = OFF (null) — 14 days = 2 full weeks.
    const applied = await withTenant(TENANT_H, () =>
      shiftSvc.applyRotation({
        employeeIds: [f.employeeH1Id, f.employeeH2Id],
        pattern: [day.id, day.id, day.id, day.id, day.id, null, null],
        startDate: "2026-06-01",
        endDate: "2026-06-14",
        actorId: H_ACTOR,
      }),
    );
    expect(applied.days).toBe(14);
    expect(applied.cellsWritten).toBe(28 - 1); // 2 employees × 14 days − the MANUAL cell
    expect(applied.manualPreserved).toBe(1);

    const grid = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14" }),
    );
    expect(grid).toHaveLength(28); // ONE row per cell — no duplicates
    // The MANUAL cell survived with its shift + source.
    const h2Wednesday = grid.find(
      (cell) => cell.employeeId === f.employeeH2Id && cell.workDate === "2026-06-03",
    )!;
    expect(h2Wednesday.source).toBe("MANUAL");
    expect(h2Wednesday.shiftId).toBe(evening.id);
    // H1's Wednesday is the pattern's day shift.
    const h1Wednesday = grid.find(
      (cell) => cell.employeeId === f.employeeH1Id && cell.workDate === "2026-06-03",
    )!;
    expect(h1Wednesday.source).toBe("ROTATION");
    expect(h1Wednesday.shiftId).toBe(day.id);
    // Saturday 2026-06-06 = the explicit rostered day off (a null-shift cell).
    const h1Saturday = grid.find(
      (cell) => cell.employeeId === f.employeeH1Id && cell.workDate === "2026-06-06",
    )!;
    expect(h1Saturday.source).toBe("ROTATION");
    expect(h1Saturday.shiftId).toBeNull();
    // Monday 2026-06-08 (week 2) = day again — the pattern repeats.
    const h1Monday2 = grid.find(
      (cell) => cell.employeeId === f.employeeH1Id && cell.workDate === "2026-06-08",
    )!;
    expect(h1Monday2.shiftId).toBe(day.id);

    // Idempotent re-run: the same pattern rewrites the same ROTATION
    // cells, the MANUAL cell still preserved, and the grid still 28.
    const rerun = await withTenant(TENANT_H, () =>
      shiftSvc.applyRotation({
        employeeIds: [f.employeeH1Id, f.employeeH2Id],
        pattern: [day.id, day.id, day.id, day.id, day.id, null, null],
        startDate: "2026-06-01",
        endDate: "2026-06-14",
        actorId: H_ACTOR,
      }),
    );
    expect(rerun.cellsWritten).toBe(27);
    expect(rerun.manualPreserved).toBe(1);
    const grid2 = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14" }),
    );
    expect(grid2).toHaveLength(28);

    // The pattern's shape is guarded: 6 entries → typed.
    await expect(
      withTenant(TENANT_H, () =>
        shiftSvc.applyRotation({
          employeeIds: [f.employeeH1Id],
          pattern: [day.id, day.id, day.id, day.id, day.id, null],
          startDate: "2026-06-01",
          endDate: "2026-06-07",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ROTATION_INVALID" });
    // Inverted range → typed.
    await expect(
      withTenant(TENANT_H, () =>
        shiftSvc.applyRotation({
          employeeIds: [f.employeeH1Id],
          pattern: [day.id, day.id, day.id, day.id, day.id, null, null],
          startDate: "2026-06-14",
          endDate: "2026-06-01",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ROTATION_INVALID" });
  });

  it("(d) THE TENANT BOUNDARY: another tenant's context sees none of tenant H's shifts or roster cells (RLS)", async () => {
    const f = spec.fixture!;
    const hList = await withTenant(TENANT_H, () => shiftSvc.list({ limit: 500 }));
    expect(hList.length).toBeGreaterThan(0);
    // The seeded tenant A (test-db's TENANT_A) sees an empty world.
    const { TENANT_A } = await import("../test-db");
    const aList = await withTenant(TENANT_A, () => shiftSvc.list({ limit: 500 }));
    expect(aList).toHaveLength(0);
    const aGrid = await withTenant(TENANT_A, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14" }),
    );
    expect(aGrid).toHaveLength(0);
    // And A cannot address H's employee by id (typed not-found).
    await expect(
      withTenant(TENANT_A, () =>
        shiftSvc.setRosterCell({
          employeeId: f.employeeH1Id,
          workDate: "2026-06-02",
          shiftId: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });
  });
});
