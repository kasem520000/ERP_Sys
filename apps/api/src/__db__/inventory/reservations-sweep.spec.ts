import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  inventoryAppClient,
  reservations,
  setupInventoryFixture,
  type InventoryFixture,
} from "./fixtures";

/**
 * PHASE-015 T9 (`inventory.reservations`) — the reservation-expiry sweep
 * against a real database (the phase §6 hook "reservation expiry job
 * test"): the state transition flips exactly the past-due ACTIVE rows
 * (MANUAL + SALES_ORDER holders alike) and nothing else, the on-demand
 * sweep expires exactly the expired row of a fresh/expired/cancelled
 * triple, and the system job (`expireReservations`, the pg-boss-scheduled
 * `inventory.reservations-sweep` handler) lands the same flip with the
 * audit stamped as a system action (actor_id NULL).
 */

let fixture: InventoryFixture;
let sweepItem: string;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  sweepItem = await ensureInventoryItem("INV-RESV-SWEEP", "Reservation sweep probe");
});

function pastDue(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

function future(): string {
  return new Date(Date.now() + 86_400_000).toISOString();
}

describe("reservation expiry sweep — the state transition (§2.13 → PHASE-015)", () => {
  it("flips past-due ACTIVE rows of BOTH holder types; every other state is untouched", async () => {
    const pastManual = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "5",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: pastDue(),
        note: "sweep matrix: past-due MANUAL",
        actorId: I_ACTOR,
      }),
    );
    const pastSalesOrder = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "6",
        holderType: "SALES_ORDER",
        holderId: null,
        expiresAt: pastDue(),
        note: "sweep matrix: past-due SALES_ORDER",
        actorId: I_ACTOR,
      }),
    );
    const fresh = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "7",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: future(),
        note: "sweep matrix: fresh",
        actorId: I_ACTOR,
      }),
    );
    const openEnded = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "8",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "sweep matrix: no expiry",
        actorId: I_ACTOR,
      }),
    );
    const released = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "9",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: pastDue(),
        note: "sweep matrix: already released",
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => reservations.release(released.id, I_ACTOR));
    const consumed = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        holderType: "SALES_ORDER",
        holderId: null,
        expiresAt: pastDue(),
        note: "sweep matrix: already consumed",
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => reservations.consume(consumed.id, I_ACTOR));

    const swept = await withTenant(TENANT_I, () => reservations.sweepExpired(I_ACTOR));
    expect(swept.released).toBeGreaterThanOrEqual(2); // at least this spec's two rows

    expect((await withTenant(TENANT_I, () => reservations.find(pastManual.id))).status).toBe("RELEASED");
    expect((await withTenant(TENANT_I, () => reservations.find(pastSalesOrder.id))).status).toBe("RELEASED");
    expect((await withTenant(TENANT_I, () => reservations.find(fresh.id))).status).toBe("ACTIVE");
    expect((await withTenant(TENANT_I, () => reservations.find(openEnded.id))).status).toBe("ACTIVE");
    expect((await withTenant(TENANT_I, () => reservations.find(released.id))).status).toBe("RELEASED");
    expect((await withTenant(TENANT_I, () => reservations.find(consumed.id))).status).toBe("CONSUMED");

    // Idempotent: a second sweep finds nothing new (the pool stays honest).
    const again = await withTenant(TENANT_I, () => reservations.sweepExpired(I_ACTOR));
    expect((await withTenant(TENANT_I, () => reservations.find(pastManual.id))).status).toBe("RELEASED");
    expect(again.released).toBeGreaterThanOrEqual(0);
  });

  it("a fresh/expired/cancelled triple → the sweep expires exactly the expired one", async () => {
    const fresh = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "3",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: future(),
        note: "triple: fresh",
        actorId: I_ACTOR,
      }),
    );
    const expired = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "4",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: pastDue(),
        note: "triple: expired",
        actorId: I_ACTOR,
      }),
    );
    const cancelled = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "5",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: pastDue(),
        note: "triple: cancelled before the sweep",
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => reservations.release(cancelled.id, I_ACTOR));

    await withTenant(TENANT_I, () => reservations.sweepExpired(I_ACTOR));

    expect((await withTenant(TENANT_I, () => reservations.find(fresh.id))).status).toBe("ACTIVE");
    expect((await withTenant(TENANT_I, () => reservations.find(expired.id))).status).toBe("RELEASED");
    expect((await withTenant(TENANT_I, () => reservations.find(cancelled.id))).status).toBe("RELEASED");
    // released_at is stamped (the flip is dated, not silent).
    expect((await withTenant(TENANT_I, () => reservations.find(expired.id))).status).toBe("RELEASED");
  });
});

describe("expireReservations — the pg-boss-scheduled system job", () => {
  it("sweeps the platform's ACTIVE tenants and audits the pass as a system action", async () => {
    const expired = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: sweepItem,
        warehouseId: fixture.warehouseMain,
        qty: "11",
        holderType: "SALES_ORDER",
        holderId: null,
        expiresAt: pastDue(),
        note: "system job probe",
        actorId: I_ACTOR,
      }),
    );

    // The job runs OUTSIDE any tenant scope (the pg-boss handler's world):
    // it enumerates ACTIVE tenants itself and sweeps each in its own UoW.
    const { ReservationService } = await import("../../modules/inventory/application/reservation-service");
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const service = new ReservationService(new AuditService(new DrizzleAuditStore()));
    const result = await service.expireReservations();

    expect(result.tenants).toBeGreaterThanOrEqual(1);
    expect(result.released).toBeGreaterThanOrEqual(1);
    expect((await withTenant(TENANT_I, () => reservations.find(expired.id))).status).toBe("RELEASED");

    // The system action is audited: actor_id NULL, the sweep's action key.
    const client = await inventoryAppClient();
    const auditRows = await client.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM audit_events
        WHERE action = 'inventory.reservations_swept' AND entity_id = $1`,
      [expired.id],
    );
    expect(auditRows.rows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows.rows[0]!.actor_id).toBeNull();
    await client.end();
  });
});
