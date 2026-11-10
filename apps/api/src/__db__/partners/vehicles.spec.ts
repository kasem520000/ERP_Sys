import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PartnerNotFoundError } from "../../modules/partners/domain/partner-errors";
import {
  VehicleService,
  type CreateVehicleInput,
} from "../../modules/partners/vehicles/application/vehicle-service";
import {
  VehicleArchivedError,
  VehicleChassisInvalidError,
  VehicleDuplicateChassisError,
  VehicleNotFoundError,
} from "../../modules/partners/vehicles/domain/vehicle-errors";
import { superuserClient } from "../test-db";
import { S_ACTOR, TENANT_S, setupSalesFixture, type SalesFixture } from "../sales/fixtures";

/**
 * PHASE-017 §2 item 3 — the partners-owned vehicle registry on real
 * PostgreSQL 16 (tenant S from the sales fixtures): CRUD + archive
 * lifecycle + chassis natural-key/VIN-shape typed errors, and the
 * per-vehicle service-history read model over sales-owned job cards,
 * invoices and warranty credit notes (MODULE_BOUNDARIES read precedent —
 * the sales rows are seeded exactly the way the sales module's own
 * writes would produce them, via the ambient tenant transaction).
 */

const service = new VehicleService(new AuditService(new DrizzleAuditStore()));

/** A uuid that is well-formed but exists in no tenant (typed 404s). */
const MISSING_ID = "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e";
const MISSING_PARTNER = "1f1f1f1f-1f1f-411f-811f-1f1f1f1f1f1f";

let fixture: SalesFixture;

beforeAll(async () => {
  fixture = await setupSalesFixture();
});

async function createVehicle(overrides: Partial<CreateVehicleInput> = {}) {
  const input: CreateVehicleInput = {
    partnerId: fixture.customerId,
    make: "Toyota",
    model: "Hilux",
    modelYear: 2023,
    chassisNo: null,
    plateNo: null,
    color: null,
    engineNo: null,
    odometerKm: null,
    odometerAt: null,
    note: null,
    noteAr: null,
    ...overrides,
  };
  return withTenant(TENANT_S, () => service.create(S_ACTOR, input));
}

// ---------------------------------------------------------------------------
// Registry CRUD + typed errors
// ---------------------------------------------------------------------------

describe("vehicle registry — create / find / list + typed errors", () => {
  it("creates a vehicle on an existing customer and reads it back (decimal-string odometer, bilingual notes)", async () => {
    const created = await createVehicle({
      chassisNo: "MR0KB3CD102543210",
      plateNo: "ABC-1234",
      color: "White",
      engineNo: "2TR8820731",
      odometerKm: "48250.5",
      odometerAt: "2026-02-10",
      note: "Fleet vehicle",
      noteAr: "مركبة أسطول",
    });
    expect(created.status).toBe("ACTIVE");
    expect(created.tenantId).toBe(TENANT_S);
    expect(created.partnerId).toBe(fixture.customerId);
    expect(created.createdBy).toBe(S_ACTOR);
    expect(created.odometerKm).toBe("48250.5");
    expect(created.odometerAt).toBe("2026-02-10");
    expect(created.note).toBe("Fleet vehicle");
    expect(created.noteAr).toBe("مركبة أسطول");

    const found = await withTenant(TENANT_S, () => service.get(created.id));
    expect(found.id).toBe(created.id);
    expect(found.chassisNo).toBe("MR0KB3CD102543210");
  });

  it("lists scoped by partner, filtered by status, and searched across plate/chassis/make/model", async () => {
    const vehicle = await createVehicle({ chassisNo: "JTMHV05J204123456", plateNo: "SRCH-777" });

    const byPartner = await withTenant(TENANT_S, () => service.list({ partnerId: fixture.customerId }, 100));
    expect(byPartner.some((row) => row.id === vehicle.id)).toBe(true);

    const active = await withTenant(TENANT_S, () =>
      service.list({ partnerId: fixture.customerId, status: "ACTIVE" }, 100),
    );
    expect(active.some((row) => row.id === vehicle.id)).toBe(true);

    const byChassis = await withTenant(TENANT_S, () => service.list({ q: "JTMHV05J" }, 100));
    expect(byChassis.some((row) => row.id === vehicle.id)).toBe(true);

    const byPlate = await withTenant(TENANT_S, () => service.list({ q: "srch-777" }, 100));
    expect(byPlate.some((row) => row.id === vehicle.id)).toBe(true);

    const byMake = await withTenant(TENANT_S, () => service.list({ q: "toyota" }, 100));
    expect(byMake.some((row) => row.id === vehicle.id)).toBe(true);

    const byModel = await withTenant(TENANT_S, () => service.list({ q: "hilux" }, 100));
    expect(byModel.some((row) => row.id === vehicle.id)).toBe(true);

    // Another partner's scope excludes it.
    const foreign = await withTenant(TENANT_S, () => service.list({ partnerId: fixture.limitedCustomerId }, 100));
    expect(foreign.some((row) => row.id === vehicle.id)).toBe(false);
  });

  it("rejects a duplicate chassis tenant-wide (typed conflict), even for another partner", async () => {
    await createVehicle({ chassisNo: "SALVP12UXA5123456" });
    await expect(
      createVehicle({ chassisNo: "SALVP12UXA5123456", partnerId: fixture.limitedCustomerId }),
    ).rejects.toBeInstanceOf(VehicleDuplicateChassisError);
    await expect(
      createVehicle({ chassisNo: "SALVP12UXA5123456", partnerId: fixture.limitedCustomerId }),
    ).rejects.toMatchObject({ code: "VEHICLE_CHASSIS_TAKEN" });
  });

  it("rejects an unknown or deleted partner with the partner module's not-found error", async () => {
    await expect(createVehicle({ partnerId: MISSING_PARTNER })).rejects.toBeInstanceOf(PartnerNotFoundError);
    await expect(createVehicle({ partnerId: MISSING_PARTNER })).rejects.toMatchObject({ code: "PARTNER_NOT_FOUND" });
  });

  it("pre-checks the chassis VIN shape (6–17 chars, no I/O/Q) before the insert", async () => {
    await expect(createVehicle({ chassisNo: "IOQ123" })).rejects.toBeInstanceOf(VehicleChassisInvalidError);
    await expect(createVehicle({ chassisNo: "IOQ123" })).rejects.toMatchObject({ code: "VEHICLE_CHASSIS_INVALID" });
    await expect(createVehicle({ chassisNo: "AB12" })).rejects.toMatchObject({ code: "VEHICLE_CHASSIS_INVALID" });
    await expect(createVehicle({ chassisNo: "MR0KB3CD1025432107" })).rejects.toMatchObject({
      code: "VEHICLE_CHASSIS_INVALID",
    });

    // Chassis-less vehicles coexist (the unique index is partial — NULLs excluded).
    const first = await createVehicle({ plateNo: "NOCH-1" });
    const second = await createVehicle({ plateNo: "NOCH-2" });
    expect(first.id).not.toBe(second.id);
  });

  it("audits partners.vehicle_created with entityType vehicle", async () => {
    const created = await createVehicle({ chassisNo: "WP0ZZZ99ZTS102345" });
    const su = await superuserClient();
    const events = await su.query(
      `SELECT action, entity_type, after FROM audit_events WHERE entity_id = $1 AND action = 'partners.vehicle_created'`,
      [created.id],
    );
    await su.end();
    expect(events.rowCount).toBe(1);
    const row = events.rows[0] as { action: string; entity_type: string; after: { make: string; partner_id: string } };
    expect(row.entity_type).toBe("vehicle");
    expect(row.after.make).toBe("Toyota");
    expect(row.after.partner_id).toBe(fixture.customerId);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — update (ACTIVE only), archive, idempotent-error re-archive
// ---------------------------------------------------------------------------

describe("vehicle lifecycle — update (ACTIVE only) / archive / re-archive conflict", () => {
  it("updates attributes and the odometer reading on an ACTIVE vehicle (audited)", async () => {
    const vehicle = await createVehicle({ chassisNo: "JTMBFREV4JD012345", odometerKm: "1000.0" });
    const updated = await withTenant(TENANT_S, () =>
      service.update(S_ACTOR, vehicle.id, {
        odometerKm: "1500.5",
        odometerAt: "2026-03-01",
        color: "Silver",
        noteAr: "بعد الصيانة الدورية",
      }),
    );
    expect(updated.odometerKm).toBe("1500.5");
    expect(updated.odometerAt).toBe("2026-03-01");
    expect(updated.color).toBe("Silver");
    expect(updated.noteAr).toBe("بعد الصيانة الدورية");
    expect(updated.status).toBe("ACTIVE");

    const su = await superuserClient();
    const events = await su.query(
      `SELECT action, after FROM audit_events WHERE entity_id = $1 AND action = 'partners.vehicle_updated'`,
      [vehicle.id],
    );
    await su.end();
    expect(events.rowCount).toBe(1);
    const row = events.rows[0] as { after: { odometer_km: string } };
    expect(row.after.odometer_km).toBe("1500.5");
  });

  it("re-setting the own chassis is a no-op; another vehicle's chassis is a typed conflict", async () => {
    const first = await createVehicle({ chassisNo: "MR0HA3CD402543210" });
    await createVehicle({ chassisNo: "WVWZZZ1JZXW123456" });

    const same = await withTenant(TENANT_S, () =>
      service.update(S_ACTOR, first.id, { chassisNo: "MR0HA3CD402543210" }),
    );
    expect(same.chassisNo).toBe("MR0HA3CD402543210");

    await expect(
      withTenant(TENANT_S, () => service.update(S_ACTOR, first.id, { chassisNo: "WVWZZZ1JZXW123456" })),
    ).rejects.toMatchObject({ code: "VEHICLE_CHASSIS_TAKEN" });

    await expect(
      withTenant(TENANT_S, () => service.update(S_ACTOR, first.id, { chassisNo: "IOQ" })),
    ).rejects.toMatchObject({ code: "VEHICLE_CHASSIS_INVALID" });
  });

  it("archives once (ACTIVE → ARCHIVED, never a delete); the archived row is read-only and re-archive conflicts", async () => {
    const vehicle = await createVehicle({ chassisNo: "KNMHD25W4JU123456", plateNo: "ARCH-1" });

    const archived = await withTenant(TENANT_S, () => service.archive(S_ACTOR, vehicle.id));
    expect(archived.status).toBe("ARCHIVED");

    // The row stays (job cards + invoices reference it by FK).
    const found = await withTenant(TENANT_S, () => service.get(vehicle.id));
    expect(found.status).toBe("ARCHIVED");

    // Read-only: updates on an archived vehicle conflict.
    await expect(
      withTenant(TENANT_S, () => service.update(S_ACTOR, vehicle.id, { make: "Nope" })),
    ).rejects.toMatchObject({ code: "VEHICLE_ARCHIVED" });

    // Idempotent-error: archiving again is a conflict, never a second write.
    await expect(withTenant(TENANT_S, () => service.archive(S_ACTOR, vehicle.id))).rejects.toBeInstanceOf(
      VehicleArchivedError,
    );

    const archivedRows = await withTenant(TENANT_S, () => service.list({ status: "ARCHIVED" }, 100));
    expect(archivedRows.some((row) => row.id === vehicle.id)).toBe(true);
    const activeRows = await withTenant(TENANT_S, () =>
      service.list({ partnerId: fixture.customerId, status: "ACTIVE" }, 100),
    );
    expect(activeRows.some((row) => row.id === vehicle.id)).toBe(false);
  });

  it("unknown vehicle ids are typed not-founds on every operation", async () => {
    await expect(withTenant(TENANT_S, () => service.get(MISSING_ID))).rejects.toBeInstanceOf(VehicleNotFoundError);
    await expect(
      withTenant(TENANT_S, () => service.update(S_ACTOR, MISSING_ID, { make: "X" })),
    ).rejects.toMatchObject({ code: "VEHICLE_NOT_FOUND" });
    await expect(withTenant(TENANT_S, () => service.archive(S_ACTOR, MISSING_ID))).rejects.toMatchObject({
      code: "VEHICLE_NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// Per-vehicle service history (the automotive.vehicle_service_history source)
// ---------------------------------------------------------------------------

describe("per-vehicle service history — the MODULE_BOUNDARIES read model", () => {
  // Deterministic ids: the ON CONFLICT (id) DO NOTHING seeds stay idempotent.
  const JC_ID = "3b000000-0000-4000-8000-000000000001";
  const INV_ID = "3b000000-0000-4000-8000-000000000002";
  const CN_ID = "3b000000-0000-4000-8000-000000000003";

  it("merges job cards + invoices + warranty credit notes into one newest-first timeline", async () => {
    const vehicle = await createVehicle({ chassisNo: "WBA5A5C55ED444444" });
    await withTenant(TENANT_S, async (tx) => {
      await tx.execute(sql`
        INSERT INTO job_cards (id, tenant_id, branch_id, customer_id, vehicle_id, card_no, status,
                               warehouse_id, checked_in_at)
        VALUES (${JC_ID}, ${TENANT_S}, ${fixture.branchId}, ${fixture.customerId}, ${vehicle.id},
                'JC-3B-001', 'IN_PROGRESS', ${fixture.warehouseId}, '2026-02-10 08:30:00+00')
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sql`
        INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_no, invoice_date,
                                    due_date, currency_code, status, total_net, total_tax, total_gross,
                                    vehicle_id, job_card_id)
        VALUES (${INV_ID}, ${TENANT_S}, ${fixture.branchId}, ${fixture.customerId}, 'CREDIT', 'SAL-3B-0001',
                '2026-02-20', '2026-03-22', 'SAR', 'APPROVED', '640.0000', '0.0000', '640.0000',
                ${vehicle.id}, ${JC_ID})
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sql`
        INSERT INTO credit_notes (id, tenant_id, branch_id, customer_id, invoice_id, job_card_id, note_no,
                                  note_date, currency_code, status, total_net, total_tax, total_gross)
        VALUES (${CN_ID}, ${TENANT_S}, ${fixture.branchId}, ${fixture.customerId}, ${INV_ID}, ${JC_ID},
                'CRN-3B-0001', '2026-03-05', 'SAR', 'APPROVED', '100.0000', '0.0000', '100.0000')
        ON CONFLICT (id) DO NOTHING
      `);
    });

    const history = await withTenant(TENANT_S, () => service.serviceHistory(vehicle.id));
    expect(history.map((entry) => entry.kind)).toEqual(["CREDIT_NOTE", "INVOICE", "JOB_CARD"]);
    expect(history[0]).toMatchObject({
      kind: "CREDIT_NOTE",
      id: CN_ID,
      docNo: "CRN-3B-0001",
      date: "2026-03-05",
      status: "APPROVED",
      total: "100.0000",
    });
    expect(history[1]).toMatchObject({
      kind: "INVOICE",
      id: INV_ID,
      docNo: "SAL-3B-0001",
      date: "2026-02-20",
      status: "APPROVED",
      total: "640.0000",
    });
    expect(history[2]).toMatchObject({
      kind: "JOB_CARD",
      id: JC_ID,
      docNo: "JC-3B-001",
      date: "2026-02-10",
      status: "IN_PROGRESS",
      total: null,
    });
  });

  it("is empty for a vehicle with no documents", async () => {
    const quiet = await createVehicle({ plateNo: "QUIET-1" });
    const history = await withTenant(TENANT_S, () => service.serviceHistory(quiet.id));
    expect(history).toEqual([]);
  });

  it("unknown vehicle ids are a typed not-found — never an empty timeline", async () => {
    await expect(withTenant(TENANT_S, () => service.serviceHistory(MISSING_ID))).rejects.toMatchObject({
      code: "VEHICLE_NOT_FOUND",
    });
  });
});
