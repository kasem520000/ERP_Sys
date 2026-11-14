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
    const dayCells = grid.rows.filter((cell) => cell.employeeId === f.employeeH1Id);
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
    expect(afterClear.rows).toHaveLength(0);
    expect(afterClear.total).toBe(0);
    expect(afterClear.hasMore).toBe(false);
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

    // THE PAGINATION SIGNAL (the joint review round): a bounded page
    // names the FULL grid (total 28, hasMore true) — nothing is
    // silently truncated anymore.
    const paged = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14", pageSize: 10 }),
    );
    expect(paged.total).toBe(28); // the truncation signal names the FULL grid
    expect(paged.rows).toHaveLength(10);
    expect(paged.hasMore).toBe(true); // 10 < 28 — page 2 exists
    // And walking the pages retrieves EVERY cell (28 = 10 + 10 + 8).
    const page2 = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14", pageSize: 10, page: 2 }),
    );
    const page3 = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14", pageSize: 10, page: 3 }),
    );
    expect(page2.rows).toHaveLength(10);
    expect(page3.rows).toHaveLength(8);
    expect(page3.hasMore).toBe(false);
    const walked = [...paged.rows, ...page2.rows, ...page3.rows];
    expect(new Set(walked.map((cell) => `${cell.employeeId}|${cell.workDate}`)).size).toBe(28);

    // The full-page read for the cell-level assertions.
    const grid = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14", pageSize: 5000 }),
    );
    expect(grid.rows).toHaveLength(28); // ONE row per cell — no duplicates
    // The MANUAL cell survived with its shift + source.
    const h2Wednesday = grid.rows.find(
      (cell) => cell.employeeId === f.employeeH2Id && cell.workDate === "2026-06-03",
    )!;
    expect(h2Wednesday.source).toBe("MANUAL");
    expect(h2Wednesday.shiftId).toBe(evening.id);
    // H1's Wednesday is the pattern's day shift.
    const h1Wednesday = grid.rows.find(
      (cell) => cell.employeeId === f.employeeH1Id && cell.workDate === "2026-06-03",
    )!;
    expect(h1Wednesday.source).toBe("ROTATION");
    expect(h1Wednesday.shiftId).toBe(day.id);
    // Saturday 2026-06-06 = the explicit rostered day off (a null-shift cell).
    const h1Saturday = grid.rows.find(
      (cell) => cell.employeeId === f.employeeH1Id && cell.workDate === "2026-06-06",
    )!;
    expect(h1Saturday.source).toBe("ROTATION");
    expect(h1Saturday.shiftId).toBeNull();
    // Monday 2026-06-08 (week 2) = day again — the pattern repeats.
    const h1Monday2 = grid.rows.find(
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
    expect(grid2.rows).toHaveLength(28);
    expect(grid2.total).toBe(28);
    expect(grid2.hasMore).toBe(false);

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

  it("(d) THE TENANT BOUNDARY (rewritten per the joint review round): NO assumption that a SHARED tenant is empty — the isolation is proven on TENANT H's OWN rows (by id, against the shared seeded tenant A AND against a dedicated ISOLATED tenant, empty by construction)", async () => {
    const f = spec.fixture!;
    // Tenant H's own world, captured by id (the specific-data law —
    // never an aggregate emptiness guess about somebody else's tenant).
    const hList = await withTenant(TENANT_H, () => shiftSvc.list({ limit: 500 }));
    expect(hList.length).toBeGreaterThan(0);
    const hShiftIds = new Set(hList.map((row) => row.id));
    const hGrid = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14", pageSize: 5000 }),
    );
    expect(hGrid.total).toBeGreaterThan(0); // H's roster cells exist

    // (d1) THE SHARED seeded tenant A: its world is whatever the rest of
    // the suite made it — the boundary assertion is BY ID: NONE of
    // tenant H's shifts or cells is visible there (pre-fix this arm
    // assumed A was EMPTY and would break the moment any suite seeded a
    // shift into A).
    const { TENANT_A } = await import("../test-db");
    const aList = await withTenant(TENANT_A, () => shiftSvc.list({ limit: 500 }));
    expect(aList.filter((row) => hShiftIds.has(row.id))).toHaveLength(0);
    const aGrid = await withTenant(TENANT_A, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14" }),
    );
    expect(
      aGrid.rows.filter((cell) => cell.employeeId === f.employeeH1Id),
    ).toHaveLength(0);

    // (d2) THE ISOLATED BOUNDARY TENANT (the fixture's dedicated
    // TENANT_H_RLS — empty BY CONSTRUCTION, nobody else writes to it):
    // the strong empty-world assertion is safe HERE.
    const { TENANT_H_RLS } = await import("./fixtures");
    const isolatedList = await withTenant(TENANT_H_RLS, () => shiftSvc.list({ limit: 500 }));
    expect(isolatedList).toHaveLength(0);
    const isolatedGrid = await withTenant(TENANT_H_RLS, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-06-14" }),
    );
    expect(isolatedGrid.rows).toHaveLength(0);
    expect(isolatedGrid.total).toBe(0);
    expect(isolatedGrid.hasMore).toBe(false);

    // (d3) BY-ID isolation under the isolated tenant: H's shift id is
    // not-found there, and H's employee cannot be addressed (A7 parity).
    const anHShiftId = [...hShiftIds][0]!;
    await expect(
      withTenant(TENANT_H_RLS, () => shiftSvc.find(anHShiftId)),
    ).rejects.toMatchObject({ code: "SHIFT_NOT_FOUND" });
    await expect(
      withTenant(TENANT_H_RLS, () =>
        shiftSvc.setRosterCell({
          employeeId: f.employeeH1Id,
          workDate: "2026-06-02",
          shiftId: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });
    // And the shared tenant A cannot address H's employee either.
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

  it("(e) THE DECLARED CEILING 200 × 92 (the joint review round): a full-size rotation run — 200 employees over 92 days = 18,400 cells, 92,000 bind parameters — succeeds under the CHUNKED write (pre-fix the single INSERT broke PostgreSQL's 65,535-parameter protocol limit) and the paginated grid retrieves EVERY cell", async () => {
    const f = spec.fixture!;
    // 200 dedicated employees (the declared per-run employee ceiling),
    // seeded directly on the payroll substrate (the fixtures'
    // ambient-tenant pattern), code-fixed for idempotence across runs.
    await withTenant(TENANT_H, async () => {
      const { requireTenantContext } = await import("../../infra/db/tenant-context");
      const { sql } = await import("drizzle-orm");
      await requireTenantContext().tx!.execute(sql`
        INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by)
        SELECT gen_random_uuid(), erp.current_tenant_id(),
               'EMP-CEILING-' || lpad(g::text, 3, '0'),
               'Ceiling employee ' || g, 'موظف الحد الأعلى ' || g,
               '2026-01-01', 'FULL_TIME', 8000, ${H_ACTOR}
        FROM generate_series(1, 200) AS g
        ON CONFLICT (tenant_id, code) DO NOTHING
      `);
    });
    const ceilingEmployees = await withTenant(TENANT_H, async () => {
      const { requireTenantContext } = await import("../../infra/db/tenant-context");
      const { sql } = await import("drizzle-orm");
      const rows = await requireTenantContext().tx!.execute<{ id: string }>(sql`
        SELECT id FROM employees WHERE code LIKE 'EMP-CEILING-%' ORDER BY code
      `);
      return rows.rows.map((row) => row.id);
    });
    expect(ceilingEmployees).toHaveLength(200);

    const day = await withTenant(TENANT_H, () =>
      shiftSvc.create({
        code: uniqueCode("CEILING-DAY"),
        name: "Ceiling rotation day shift",
        nameAr: "وردية الحد الأعلى النهارية",
        startTime: "08:00",
        endTime: "16:00",
        graceMinutes: 10,
        breakMinutes: 30,
        isNight: false,
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );

    // 2026-06-01 → 2026-08-31 = 92 days EXACTLY (30 + 31 + 31) — the
    // declared rotation horizon cap, at the declared employee cap.
    const applied = await withTenant(TENANT_H, () =>
      shiftSvc.applyRotation({
        employeeIds: ceilingEmployees,
        pattern: [day.id, day.id, day.id, day.id, day.id, null, null],
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        actorId: H_ACTOR,
      }),
    );
    expect(applied.days).toBe(92);
    expect(applied.cellsWritten).toBe(200 * 92); // 18,400 — the full ceiling

    // THE PAGINATED RETRIEVAL: the default-size grid read is bounded,
    // carries the FULL total (the explicit truncation signal — pre-fix
    // a silent LIMIT 5000 hid 13,400 of the cells), and walking the
    // pages fetches EVERY cell.
    const first = await withTenant(TENANT_H, () =>
      shiftSvc.readGrid({ from: "2026-06-01", to: "2026-08-31", employeeIds: ceilingEmployees }),
    );
    expect(first.total).toBe(18_400);
    expect(first.hasMore).toBe(true);
    let retrieved = first.rows.length;
    let page = 1;
    let guard = 0;
    while (first.hasMore && retrieved < first.total) {
      guard += 1;
      expect(guard).toBeLessThan(100);
      page += 1;
      const next = await withTenant(TENANT_H, () =>
        shiftSvc.readGrid({
          from: "2026-06-01",
          to: "2026-08-31",
          employeeIds: ceilingEmployees,
          page,
        }),
      );
      retrieved += next.rows.length;
      expect(next.hasMore).toBe(retrieved < first.total);
    }
    expect(retrieved).toBe(18_400);

    // Idempotent re-run at the ceiling: the same 18,400 rewrite, still
    // within the parameter budget.
    const rerun = await withTenant(TENANT_H, () =>
      shiftSvc.applyRotation({
        employeeIds: ceilingEmployees,
        pattern: [day.id, day.id, day.id, day.id, day.id, null, null],
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        actorId: H_ACTOR,
      }),
    );
    expect(rerun.cellsWritten).toBe(18_400);

    // THE OVER-THE-CEILING GUARDS still bind: 201 employees → typed.
    await expect(
      withTenant(TENANT_H, () =>
        shiftSvc.applyRotation({
          employeeIds: [...ceilingEmployees, f.employeeH1Id], // 201
          pattern: [day.id, day.id, day.id, day.id, day.id, null, null],
          startDate: "2026-06-01",
          endDate: "2026-06-07",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ROTATION_INVALID" });
    // 93 days → typed.
    await expect(
      withTenant(TENANT_H, () =>
        shiftSvc.applyRotation({
          employeeIds: ceilingEmployees.slice(0, 1),
          pattern: [day.id, day.id, day.id, day.id, day.id, null, null],
          startDate: "2026-06-01",
          endDate: "2026-09-01",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ROTATION_INVALID" });
  });
});
